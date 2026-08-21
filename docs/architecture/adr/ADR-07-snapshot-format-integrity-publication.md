# ADR-07：快照格式、完整性与发布方式

- 状态：已接受
- 日期：2026-08-20
- 决策主题：`ADR-TOPIC-07`
- 前置决策：[ADR-01](./ADR-01-desktop-runtime-ui-boundary.md)、[ADR-02](./ADR-02-process-thread-deployment.md)、[ADR-03](./ADR-03-sqlite-active-data-transactions.md)、[ADR-04](./ADR-04-schema-migration-compatibility.md)、[ADR-05](./ADR-05-library-watching-index-file-operations.md)、[ADR-06](./ADR-06-resource-preview-system-open.md)
- 上游规范：[PRD](../../product/PRD.md)、[MVP_SCOPE](../../product/MVP_SCOPE.md)、[User Flow](../../superpowers/specs/2026-08-17-user-flow-design.md)、[UI 规格](../../superpowers/specs/2026-08-18-courseflow-ui-wireframes-page-spec-design.md)、[Architecture](../ARCHITECTURE.md)、[Module Contracts](../MODULE_CONTRACTS.md)
- 调研证据：[快照格式、完整性与发布方式一手资料研究](../../research/adr-07-snapshot-format-integrity-publication-research.md)

## 1. 背景

CourseFlow 的活动 SQLite 数据库与真实 Library 文件位于不同位置，不能用一次文件系统操作取得跨两者的原子快照。用户选择的云盘同步目录又由外部工具异步上传：另一设备可能先看见目录、manifest 或部分成员，目录出现和时间戳都不能证明快照完整。

[ADR-03](./ADR-03-sqlite-active-data-transactions.md) 已决定用 SQLite Online Backup 产生数据库副本，并以副本实际包含的 revision 为准；[ADR-04](./ADR-04-schema-migration-compatibility.md) 已决定 schema/format 兼容轴、canonical JSON 与未知版本停止；[ADR-05](./ADR-05-library-watching-index-file-operations.md) 已决定 Library marker、RootGeneration、PathKey、完整扫描、verified record 和物理操作状态；[ADR-06](./ADR-06-resource-preview-system-open.md) 已明确快照保存原始文件，不保存 preview cache、lease 或解析投影。

本 ADR 必须在这些边界之上决定：

- 快照的物理容器、成员闭包与身份；
- manifest 的 canonical bytes、摘要覆盖和输入上限；
- checkpoint、暂存、验证、发布、成功水位与崩溃收敛顺序；
- 多设备/多配置下的 BackupSet 隔离；
- 已发布快照的保留、清理、候选状态和软件更新兼容；
- checksum 能与不能证明的安全属性。

`ATTEMPT.md` 是归档旧实现证据，不是快照格式、兼容或恢复目标。本文批准技术设计，不授权开始实现，也不补齐 ADR-08–10。

### 1.1 追溯边界

- Requirement：`A-DATA-002–006`、`B-FILE-012`、`STATE-002`、`NFR-003`；
- Module：`MOD-PROTECT`、`MOD-DATA`、`MOD-LIBRARY`、`MOD-PLATFORM`；
- Interface：`IF-BACKUP-CHECKPOINT`、`IF-PROTECT-COMMAND/QUERY`、`IF-DATA-EXPORT`、`IF-LIBRARY-MANIFEST`、`IF-FILESYSTEM`，以及 `IF-RESTORE-SESSION` 的候选验证接缝；
- Flow：`FLOW-04`，以及 `FLOW-05` 的激活前验证；
- 质量约束：`Q-TRUTH-01`、`Q-PROTECT-01`、`Q-ISOLATE-01`、`Q-LOCAL-01`、`Q-PORTABLE-01`、`Q-RESPOND-01`、`Q-EVOLVE-01`、`Q-CONTINUITY-01`、`Q-DIAG-01`；
- 验收：`TEST-PROTECT-001–006`、`TEST-DATA-004/006`、`TEST-LIBRARY-001–006`、`TEST-FLOW-04-BACKUP-FAILURE`、`TEST-FLOW-05-RESTORE-RECOVERY`、`G2/G4/G5/G6/G7`。

稳定 ID 和可观察结果的语义仍由 [Module Contracts](../MODULE_CONTRACTS.md) 拥有；本文只记录满足它们的技术选择。

## 2. 决议摘要

CourseFlow v1 采用**无压缩、自包含、不可变目录快照 + canonical manifest + SHA-256 + 同父目录暂存/验证/rename 发布**：

1. 每项本地持久 BackupConfiguration 拥有稳定 `BackupSetId`；每个集合独立编号、保留和清理，不跨设备或其他配置推断“最新”。
2. 每个快照是一个自包含目录，不使用 ZIP/TAR、压缩、增量、共享对象、去重或 current pointer。
3. DATA 用 SQLite Online Backup 产生实际 revision `R` 的 `workspace.sqlite`；只要 LIBRARY 模块存在，快照必须包含根 marker 和数据库在 `R` 声明的全部 active/unassigned、已验证普通文件。任何缺失、未验证或复制期间变化都会停止整份快照。
4. `manifest.json` 使用 `courseflow-snapshot-manifest-v1` schema 和 ADR-04 的 `courseflow-canonical-json-v1`；原始 bytes 必须与严格解析后的 canonical 重编码完全相同。
5. 每个成员的原始 bytes 使用 Node core SHA-256；manifest root digest 覆盖除自身 value 外的 canonical manifest。它检测损坏和同步不一致，不提供认证、抗恶意篡改或保密。
6. `SnapshotFormatLimitsV1` 固定 manifest、文件数、成员数、总字节、PathKey 和字符串上限；任一 one-over 都停止，不降级成部分快照。
7. operation 按 `queued → database-checkpoint → library-copy → staging-validation → publishing → published-pending-record → succeeded` 前进。final rename 后仍须全量重验并提交成功记录/水位，才可向用户报告成功。
8. 成功只表示所选目录的本地 final snapshot 已发布并验证；不表示 iCloud、OneDrive 或其他同步器已经上传完成，也不承诺绝对断电耐久。
9. 每个 BackupSet 保留 `backupSequence` 最大的两份已验证快照。清理在新快照和水位成功后进行；失败不回滚新快照，未知、其他集合或身份不匹配条目不自动删除。
10. 所有恢复候选都按不可信输入验证；只有 `verified` 进入 [ADR-08](./ADR-08-restore-activation-recovery.md)。既有快照不就地升级，软件更新必须继续识别支持的旧格式并严格停止未知未来版本。

## 3. 所有权与不越界

### 3.1 `MOD-PROTECT`

PROTECT 是以下语义的唯一所有者：

- BackupConfiguration、BackupSetId、集合内 backupSequence；
- snapshot/manifest/limits/digest 版本与格式；
- 备份 operation、发布、final validation、success watermark、retention 和 cleanup；
- 候选分类与交给 RestoreSession 前的验证结果。

PROTECT 不解释课程、标签或 FileOperation 的业务含义，只比较 DATA/LIBRARY 已发布的版本化事实与闭包。

### 3.2 `MOD-DATA`

DATA 仍唯一拥有活动数据库和 transaction：

- 通过 SQLite Online Backup 写 `workspace.sqlite`；
- 从副本读出 `application_id`、schema level、WorkspaceId、actual Revision 和模块/operation/follow-up 版本；
- 执行数据库完整性、外键与 compatibility 检查；
- 在 final validation 后原子登记 SnapshotId、最后成功和 `backupSucceededThrough=R`；
- 在崩溃恢复时幂等补记 `published-pending-record`。

PROTECT 不复制活动 `.db`、`-wal` 或 `-shm`，也不直接查询表或选择 SQLite PRAGMA。

### 3.3 `MOD-LIBRARY`

LIBRARY 仍唯一拥有 LibraryRootId、RootGeneration、marker、FileId、PathKey、verification 和 FileOperation：

- 为数据库副本的实际 revision `R` 提供完整 active/unassigned verified closure；
- 为每个 FileId 提供只读、短期 content source 和 source-before/source-after 证据；
- 在 marker/root generation、完整扫描或物理操作未收敛时拒绝 checkpoint；
- 不把绝对路径、平台对象证据或 preview lease 变成跨设备身份。

### 3.4 `MOD-PLATFORM` 与云盘工具

PLATFORM 只提供窄文件系统能力：安全枚举、lstat/containment、流式读写、文件 sync/close、rename 和受限清理，并将 macOS/Windows 结果映射为规范 problem。它不决定 snapshot 成功、保留数量或兼容性。

外部云盘工具不属于 CourseFlow。CourseFlow 不读取提供商私有“已上传”状态，也不把本地目录 rename 解释为远端事务。

## 4. 受管理仓库、BackupSet 与目录布局

### 4.1 规范布局

用户选择的 backup destination 下，CourseFlow 只管理以下子树：

```text
<backup destination>/CourseFlow/
  repository-v1.json
  <WorkspaceId>/
    <BackupSetId>/
      .staging-<OperationId>-<nonce>/
      .quarantine-<OperationId>-<SnapshotId>/
      snapshot-<SnapshotId>/
        manifest.json
        workspace.sqlite
        library/
          root-marker
          content/
            <FileId>
```

`repository-v1.json` 是 canonical 的最小格式/所有权 marker，只声明 `schema: courseflow-backup-repository-v1`。它不是 secret、签名、snapshot index 或 current pointer，也不列举用户数据。若 `CourseFlow` 目录已存在但没有可验证 marker，配置必须停止并要求改选/明确处理，不能取得其中内容的所有权。

WorkspaceId 与 BackupSetId 目录只建立隔离边界；实际候选仍以 manifest 和 full validator 为准。PROTECT 不枚举或删除 `<backup destination>` 中的其他条目，也不把未知 Workspace/BackupSet 当作当前配置。

### 4.2 `BackupSetId`

BackupSetId 由 Node `crypto.randomUUID()` 生成，属于本机的一项持久 BackupConfiguration：

- 同一配置跨重启和软件更新保持；
- 用户建立新的独立配置时生成新值；
- 从另一设备恢复的目的地能力与路径证据失效，重新选择目的地会建立新的本地配置/BackupSet；
- 两个 BackupSet 即使 WorkspaceId 相同，也不互相选新、计数或清理。

这不是多设备同步协议，只是避免不同写入者用目录时间或相同 WorkspaceId 删除彼此快照。

### 4.3 `SnapshotId`、`backupSequence` 与临时目录

SnapshotId 使用 Node `crypto.randomUUID()` 生成的 RFC 4122 v4 UUID。operation 可以预留候选值并持久记录；临时目录不获得正式 Snapshot 身份。只有 staging 已验证并 rename 为 final 后，该值才成为已发布候选的稳定身份；这仍不等于备份成功，成功必须等待 final 重验和记录提交。日期、标题、revision、目录位置和 digest 都不替代 SnapshotId。

`backupSequence` 是 BackupSet 内由 PROTECT 申请、经 DATA 持久化分配的 canonical 非负十进制整数，并受 ADR-04 非负 signed-64-bit counter 上限约束：

- 每次已接受 operation 分配一个更大值，失败或取消产生间隙；
- 值不因重试、重启、时钟回拨或时区改变而复用；
- 它只决定同一 BackupSet 内已验证快照的 retention 顺序，不跨集合比较。

同一 BackupSet 中若出现“相同 sequence、不同 SnapshotId”“相同 SnapshotId、不同 root digest”或与本机成功记录矛盾的组合，单个候选仍可独立验证，但集合产生 `identity-conflict`：不得自动判断最新或执行 retention，只能展示、诊断并由用户选择恢复候选。

`.staging-*` 不具有 Snapshot 身份，也不进入恢复候选。nonce 只避免同一 operation 的临时名称冲突，不是授权。`snapshot-<SnapshotId>` 必须在发布前不存在；CourseFlow 串行化同一 BackupSet writer、使用随机身份并在 rename 前后检查冲突，绝不有意覆盖既有 final。已存在、同卷条件不满足或结果身份不符都停止并保留诊断。

## 5. 快照内容闭包

### 5.1 必须包含

一份声明 Library present 的 v1 snapshot 必须自包含：

1. `workspace.sqlite`：DATA Online Backup 产生、已关闭且验证的实际 revision `R` 数据库；
2. `library/root-marker`：当前 marker 的原始 bytes；
3. `library/content/<FileId>`：数据库副本在 `R` 中声明的每个 active 或 unassigned、verified regular file 的原始 bytes；
4. 数据库中的课程/分类/CustomTag 映射、FileOperation、DurableFollowUp 和其他正式元数据；
5. manifest 中足以证明数据库、marker、FileId 成员集合与各自版本一致的元数据。

若某发行物未交付 LIBRARY，manifest 必须用明确的 absent variant 声明模块不存在，且不能出现 `library/*` 成员。只要声明 LIBRARY present，就没有“跳过一个失败文件”的 partial variant。

### 5.2 明确排除

v1 不包含或引用：

- 活动 `.db`、`-wal`、`-shm`；manifest/member locator 不保存活动数据库、Library 或备份目的地的绝对路径。完整 `workspace.sqlite` 中既有的设备路径/目的地/operation 字段仍可能作为历史元数据存在，但不构成 capability 或成员引用，恢复前必须失效并重新授权；
- preview cache、PDF/image/text 解析投影、lease、MessagePort、Blob、canvas 或临时资源；
- watcher event、可重建索引缓存、diagnostic 原始内容；
- symlink、junction/reparse link、special entry、外部 URL/文件、操作 staging/recovery/quarantine；
- 平台 handle、权限 token、`dev/ino` 等设备对象证据作为跨设备定位；
- archive、压缩流、共享 chunk 或另一 snapshot 的成员引用。

### 5.3 operation 与 follow-up 闭包

以下状态说明物理真相尚未收敛，会阻止 snapshot：

- `disk-applied`、`reconciliation-required`；
- Library root cutover/迁移正在进行；
- operation-owned recovery file 仍是唯一恢复依据；
- 任何无法由当前 build 解释的 operation/follow-up version。

纯 `planned` 或 `waiting-decision` 且尚无物理效果的已知版本记录可以随数据库进入快照。本次 BackupOperation 也必然出现在它正在生成的数据库副本中，因此 database/library/validation 阶段采用**已完成阶段标记**：Online Backup 执行期间持久状态仍为没有 source/final 效果的 `queued`；它最多拥有可安全丢弃的 operation staging。只有副本关闭并验证成立后，活动数据库中的 operation 才推进到 `database-checkpoint`。这样 snapshot 内不会携带一个指向原设备 final 或可盲目重放的物理阶段。

恢复到新位置后，所有 BackupConfiguration 目的地能力、backup/cleanup operation、绝对路径、对象证据、权限和旧 RootGeneration 都失效；[ADR-08](./ADR-08-restore-activation-recovery.md) 只能让所有者重新配置、验证、重新决定或取消，不能盲目重放。已知 pending DurableFollowUp 保留其幂等身份和版本，外部副作用在恢复后仍须重新验证前提；未知 operation/follow-up version 仍为 incompatible。

## 6. `SnapshotManifestV1`

### 6.1 编码与顶层结构

`manifest.json` 是无 BOM 的 UTF-8 `courseflow-canonical-json-v1`。规范顶层字段为：

```text
schema: "courseflow-snapshot-manifest-v1"
snapshotFormatVersion: "1"
manifestFormatVersion: "1"
manifestEncoding: "courseflow-canonical-json-v1"
limitsVersion: "snapshot-format-limits-v1"
snapshotId
backupSetId
backupSequence
createdAt
workspaceId
database { applicationId, schemaLevel, actualRevision, memberPath }
modules [{ moduleId, formatVersion }]
library: { state: "absent" } |
         { state: "present", markerFormat, libraryRootId, rootGeneration,
           pathKeyEncoding, markerMemberPath }
members [{ path, role, fileId?, byteLength, sha256 }]
totals { memberCount, libraryFileCount, rawBytes }
digest { algorithm: "sha-256", encoding: "lowercase-hex", value }
```

applicationId、snapshot/manifest 数字版本、schemaLevel、actualRevision、backupSequence、count 和 byte length 使用 ADR-04 canonical 非负十进制字符串，不经过 JavaScript Number。limitsVersion、manifestEncoding、module formatVersion、markerFormat 与 pathKeyEncoding 使用各自所有者冻结的 canonical 标识 grammar。`createdAt` 使用规范 UTC RFC 3339 字符串，只供显示和诊断，不参与身份或 retention 顺序。WorkspaceId、BackupSetId、SnapshotId、LibraryRootId 和 FileId 使用 ADR-04 的 canonical lowercase UUID 文本；RootGeneration 使用 ADR-05 冻结的 canonical 表示，不能被目录名或时间替代。

`modules` 以 `moduleId` UTF-8 bytes 升序且无重复；它精确声明实际存在模块及其格式版本。database/application/schema、module format、Library marker/PathKey、operation/follow-up 与 snapshot/manifest/limits 是独立兼容轴，不能互相替代。

### 6.2 成员规则

`members` 不包含 `manifest.json` 自身，并按 canonical relative path 的 UTF-8 bytes 升序。合法 role 与路径关系固定为：

| role | path | 额外字段 |
|---|---|---|
| `database` | `workspace.sqlite` | 无 `fileId`，必须且仅一项 |
| `library-marker` | `library/root-marker` | 无 `fileId`；Library present 时必须且仅一项 |
| `library-content` | `library/content/<FileId>` | `fileId` 必须与最后一段相同且全局唯一 |

path 必须是 `/` 分隔的 canonical relative string；不接受空 component、`.`、`..`、反斜线、绝对路径、drive/UNC、NUL、百分号/Unicode 等价替换或大小写折叠。成员名称不保存用户文件名；真实布局由数据库中的 FileId/PathKey/映射在恢复 staging 中重建。

`byteLength` 是实测原始字节数；`sha256` 是 64 个 lowercase hex 字符，覆盖完整、未压缩 raw bytes。manifest FileId 集合必须与数据库副本中的 active/unassigned verified FileId 集合精确相等，不能多、少或重复。

### 6.3 strict parse、canonical bytes 与 root digest

validator 按以下固定顺序处理 manifest：

1. 在 manifest byte limit 内读取 raw bytes；拒绝 BOM、无效 UTF-8、lone surrogate 和 JSON 语法错误；
2. 按 v1 schema 拒绝 unknown/missing field、错误 variant/type、重复 ID/path、float、负数、前导零、`-0`、NaN/Infinity 和越限字符串；
3. 用 ADR-04 encoder 对完整对象重新 canonicalize；raw bytes 必须逐字节等于结果。普通 JSON 空白、不同 key 顺序、escape 变体或 duplicate key 因此不能被接受；
4. 复制 manifest object 并**删除 `digest.value` 字段**，对余下对象 canonicalize 为 UTF-8；Node `createHash('sha256')` 计算 root digest；
5. root digest 必须等于 `digest.value`；再验证每个 member digest、totals、数据库与 Library 闭包。

root digest 通过成员表中的 SHA-256 间接覆盖所有 member bytes；不把 manifest 自身列入 members，避免循环依赖。实现不得改为“对人类格式化文件 hash”、把 value 置空字符串或排除整个 digest object。

### 6.4 安全属性

SHA-256 用于检测随机损坏、短/长读、成员替换和部分同步。任何能修改目录的攻击者也能重算无密钥摘要，所以 UI、日志和文档不得称其为签名、认证、防恶意篡改或加密。

MVP 不增加签名密钥、账户、密钥恢复或 snapshot-at-rest 加密。若产品以后需要保密或抵御恶意云端，必须新建安全 ADR，决定密钥所有权、算法、轮换、丢失恢复、旧快照和 UI；不能静默改变 v1。

## 7. `SnapshotFormatLimitsV1`

以下上限是**包含端点**的格式/信任边界，不是性能承诺：

| 项目 | v1 上限 | 计数规则 |
|---|---:|---|
| manifest raw bytes | 64 MiB = 67,108,864 bytes | `manifest.json` 本身 |
| Library content files | 100,000 | 唯一 `library-content` FileId 数 |
| members | 100,002 | database + marker + 最多 100,000 Library files；不含 manifest |
| total raw member bytes | 1 TiB = 1,099,511,627,776 bytes | 全部 members 的实测 byteLength 之和；不含 manifest |
| PathKey components | 128 | 从数据库/Library metadata 解码后的 component 数 |
| canonical PathKey UTF-8 bytes | 32 KiB = 32,768 bytes | 完整版本化 PathKey 编码 |
| manifest 任一 string UTF-8 bytes | 32 KiB = 32,768 bytes | 解码后 canonical UTF-8；digest 等固定字段仍须满足自身 grammar |

validator 不能信任 declared totals：在打开 SQLite、复制或遍历大量数据前先做可得的 manifest/目录 preflight，实际枚举和读取时再维护独立计数器。exact-limit 必须通过，one-over 必须停止并返回 `snapshot-format-limit`；不得截断、跳过或只恢复前 N 项。

这些 ceiling 只界定 v1 可安全解析的最大输入。G7 仍须用真实参考工作区校准可支持规模、耗时、RSS、磁盘放大和后台影响。改变任何 ceiling 需要新的 limits/snapshot 版本和兼容 fixture，不能让同一 version 在不同 build 中含义漂移。

## 8. checkpoint、复制与发布协议

### 8.1 状态机

```text
queued
  -> database-checkpoint
  -> library-copy
  -> staging-validation
  -> publishing
  -> published-pending-record
  -> succeeded
```

| 状态 | 已持久证明的事实 |
|---|---|
| `queued` | operation/身份/目标已登记；没有 source/final 效果，可能只有可丢弃 staging |
| `database-checkpoint` | SQLite 副本已关闭、重开并验证，actual R 已知 |
| `library-copy` | 全部必需 Library members 已复制/sync/close，且 source-after 重验通过 |
| `staging-validation` | canonical manifest 与完整 staging full validator 已通过 |
| `publishing` | rename 前置条件已复核并持久化发布意图；尚未声明 rename 完成 |
| `published-pending-record` | final 名称已出现；仍须 final full validation 与 success transaction |
| `succeeded` | final verified 且 SnapshotId/last-success/watermark transaction 已提交 |

任一阶段可进入 `failed`。如果已经存在必须在启动时判定、收敛或安全清理的物理结果，则进入 `recovery-required` 而不是伪装成 failed 终态。除 publishing 的持久 rename 意图外，阶段名表示其输出已经验证成立；因此阶段推进前崩溃可以从上一安全标记幂等重做。每次转移都持久保存 OperationId、BackupSetId、backupSequence、候选 SnapshotId、目标 revision、实际 revision（可得后）、路径的受控相对身份、当前阶段和下一安全动作。

### 8.2 从目标 revision 到完整 staging

1. PROTECT 合并 `backupNeededThrough` 得到目标 `T`，持久创建 operation、分配不复用的 backupSequence 和候选 SnapshotId；不推进 success watermark，也不清理旧快照。
2. DATA 在 `.staging-*` 中执行 SQLite Online Backup，关闭副本后以 read-only 重新打开；取得实际 `R` 并验证 `R >= T`、application/schema/WorkspaceId/module/operation/follow-up compatibility、`integrity_check` 与 `foreign_key_check`。
3. 若活动 revision 已超过 R，只把更高范围保持 pending；当前 snapshot 仍诚实声明 R。
4. LIBRARY 对 R 完成 checkpoint precondition：marker/RootGeneration 不变、完整扫描成功、所有 required record verified、没有 §5.3 的阻塞状态。
5. 对 marker 与每个 FileId：重新验证 containment/type/permission/stamp，打开 source，流式复制同时计算 SHA-256 和精确 size，sync 并 close destination，再重新取得 source stamp/object/containment。before/after 任一变化、short/long read、权限/close/sync/hash 失败都会停止整份 operation。
6. 所有 member 完成后，从 staging 独立递归枚举，拒绝额外、缺失、重复、link/reparse/special 和越界项；重新计算 digest/size/totals，并与数据库/marker/FileId closure 比较。
7. 根据实测结果生成 manifest，最后写入、file sync、close；再按 §6–7 从 raw bytes 开始执行完整 staging validator。

所有 file sync/close 是发布前置条件，失败即不发布。平台 adapter 在支持时 best-effort flush staging/parent metadata；不支持或失败须进入诊断，但不能被描述成绝对掉电保证，也不能替代 final validator。

### 8.3 本地发布与成功记录

1. staging 与 final 位于同一个 `<WorkspaceId>/<BackupSetId>` 父目录；发布前再次确认 final 不存在且 staging identity/closure 未变。
2. 使用同父目录 directory rename 把 staging 变成 `snapshot-<SnapshotId>`。rename 是本机 namespace publication point，不是云盘事务或用户可见成功点。
3. 进入 `published-pending-record`，从 final 路径重新打开并执行与 staging 完全相同的 full validator；不复用内存中的“已验证”布尔值。
4. final verified 后，DATA transaction 才登记 SnapshotId、BackupSetId、backupSequence、canonical root digest、last-success 与 `backupSucceededThrough=R`。
5. transaction 成功后状态进入 `succeeded`；只有此时 UI 可显示“备份成功”。如果响应丢失，Command/Operation 查询返回同一已提交结果。
6. 期间产生更高 revision 时，`backupNeededThrough > R` 保持 pending 并安排后续 operation。

若 rename 前崩溃，staging 不是候选；重启只按精确 operation identity 恢复或安全清理。若 rename 后、success record 前崩溃，重启找到持久候选 SnapshotId，重新 full-validate final：一致则幂等补记成功，不一致则不推进水位并进入 recovery/cleanup。不得重新分配 sequence、双计快照或仅凭目录存在补记。

### 8.4 成功承诺边界

CourseFlow 的“备份成功”只保证在本机所选 destination 上：

- final directory 已发布；
- full validator 刚刚通过；
- SnapshotId 与 success watermark 已持久登记。

它不保证外部同步器已扫描、上传或在另一设备完整落地，也不保证任意硬件/文件系统在突然断电后绝不丢失。Node `FileHandle.sync()`、平台 metadata flush 和 same-parent rename 都只能按各平台公开语义及实际测试报告。

## 9. 不可信候选验证与状态

### 9.1 统一 validator

创建、final recheck、列表刷新和 Restore 选择必须使用同一版本化 validator。输入视为可被用户、同步器或其他进程修改：

1. 从受管理 repository/Workspace/BackupSet 边界开始 lstat/realpath containment；每层拒绝 link/junction/reparse link、special/unclassified 和逃逸；
2. 严格解析 repository marker、目录名和 manifest；先应用 §7 上限，再做深层读取；
3. 递归枚举与 manifest 精确对账；拒绝 extra、duplicate、missing、case/Unicode/path grammar 冲突；
4. 对每个 regular member 按实际长度重算 SHA-256，不跟随外部路径；
5. 只读打开 SQLite，检查 application/schema/WorkspaceId/actual Revision、integrity/FK、module/operation/follow-up version，并核对副本内 queued source BackupOperation 的 BackupSetId/backupSequence/candidate SnapshotId 与 manifest 一致；
6. 比较数据库 FileId 集合、manifest members、LibraryRootId/marker format/marker bytes/RootGeneration/PathKey encoding 与 totals；
7. Restore 只把 raw bytes 复制进 [ADR-08](./ADR-08-restore-activation-recovery.md) 的隔离 staging；验证期间不 preview、system-open、execute、跟随 URL 或调用 snapshot 内数据指示的外部路径。

writer 只创建独立 regular files，不主动创建 symlink 或 hard link。Node core 无法把所有平台私有 reparse/object 语义提升成通用安全身份；可观测类型无法安全分类时必须停止，不能猜成普通文件。

### 9.2 候选状态

| 状态 | 判定 | 可进入 Restore |
|---|---|---|
| `verified` | 本次 full validator 全部通过 | 是；进入前仍保留验证结果版本/时间并在 stage 再验 |
| `incomplete-or-sync-pending` | `snapshot-<UUID>` 可识别，但 manifest 或一个或多个声明成员尚不可见/读取未完成，没有证据证明内容矛盾 | 否；等待同步后重验 |
| `corrupt` | canonical、digest、size、extra/duplicate、SQLite、marker 或 closure 出现明确矛盾 | 否；选择其他快照 |
| `incompatible` | snapshot/manifest/limits/database/module/marker/PathKey/operation/follow-up 是当前 build 不支持的版本 | 否；使用兼容版本或明确迁移路径 |
| `unknown-entry` | 不是 repository grammar 下可识别的候选，或目录身份与 manifest 的 WorkspaceId/BackupSetId/SnapshotId 矛盾 | 否；不自动删除 |

“missing”在云盘接收端无法可靠区分永久损坏与尚未同步，因此先显示 incomplete/sync-pending；一旦成员存在但 digest/结构明确不符，显示 corrupt。其他结构正确的 BackupSet 仍按自身集合验证和展示，只是不参与当前配置的 retention。目录 mtime/ctime、createdAt 和名称排序都不改变这些判定，也不自动选择“最新”。

## 10. 保留与安全清理

### 10.1 选择规则

Retention 只在新 SnapshotId、root digest 与 `backupSucceededThrough` transaction 已提交后启动：

本 ADR 的 routine backup snapshot 无论由 watermark 自动触发还是用户选择“立即备份”，都进入同一两份保留政策；ADR-10 的更新前 safety copy 不属于 BackupSet retention。

1. 只枚举当前 WorkspaceId + BackupSetId 下、由本机成功记录精确登记的 snapshot；
2. 对每项重新 full-validate；只有 verified 项计入数量；
3. 按 backupSequence 降序保留前两份；createdAt、目录时间和 SnapshotId 文本不参与；
4. 更旧 verified snapshot 才可成为 cleanup candidate；至少两份好快照永不为当前备份腾空间而预删。

其他 BackupSet、unknown-entry、unregistered、incomplete、corrupt、incompatible、身份/digest 冲突都不自动删除，也不计入“两份”。这可能占用空间，但比误删用户或其他设备数据更符合保护边界。

### 10.2 quarantine 协议

对每个候选：

1. 持久创建 cleanup operation，记录 WorkspaceId、BackupSetId、SnapshotId、backupSequence、预期 root digest 和相对路径；
2. 再次验证 final identity、closure、父目录 containment 和不属于保留前两份；
3. 同父目录 rename 到唯一 `.quarantine-<OperationId>-<SnapshotId>`；此后它不再出现在 Restore 列表；
4. 删除前重新枚举 quarantine；若出现额外、未知、link、身份冲突或越界，停止并进入 `cleanup-pending`，只暴露诊断与再次安全检查；
5. 只有精确匹配 operation-owned closure 时递归删除，并持久完成状态；中断后从相同阶段恢复。

cleanup 失败只报告 `cleanup-pending`，不回滚新 snapshot、success watermark 或本地正式数据。storage full 返回 `storage-full`；不得删除当前最后/倒数第二份已验证快照制造重试空间。终态 operation 精确拥有的 staging/quarantine 可按同样身份规则清理；名字相似但没有持久记录的目录视为 unknown。

## 11. 软件更新与格式兼容

### 11.1 独立版本轴

以下版本必须分别检查：

- repository schema；
- snapshotFormatVersion、manifestFormatVersion、manifestEncoding、limitsVersion、digest algorithm/encoding；
- database application_id、schema level、actual Revision encoding；
- module format；
- Library marker、PathKey；
- operation 与 DurableFollowUp payload。

一个轴已知不能授权忽略另一个未知轴。未知未来版本返回 `incompatible`，不重置、不猜字段、不回退到“尽力恢复”。旧版本若有显式、测试过的 staged migration，按 ADR-04 先在隔离副本迁移；激活仍由 [ADR-08](./ADR-08-restore-activation-recovery.md) 决定。

### 11.2 immutable old snapshot

已发布 v1 snapshot 永不就地改写、补 manifest、重压缩或迁移。软件更新若引入 v2：

- 必须继续读取所有仍在支持范围内的旧 snapshot，并以 old/current/future fixtures 验证；
- 新 writer 只能在新的 ADR/format version 下产生 v2；
- 迁移发生在 Restore staging 的副本，不改变备份原件；
- 旧应用遇到 v2 可以明确 incompatible，但不得把它显示为损坏或删除；
- 放弃旧 reader 支持需要产品迁移/导出政策和新的决议，不能由依赖升级或重构暗中发生。

因此本设计兼容正常软件更新：稳定的 V1 reader、严格版本门、不可变旧快照和 staged migration 共同防止更新后静默丢失用户备份。它不承诺新格式可被旧应用向后读取。

### 11.3 发布门

ADR-10 必须把 snapshot reader/writer、Node/SQLite/fs/crypto 运行时与双平台 packaged fixture 纳入同一更新集合。任何 Electron/Node/SQLite/OS 变化都重跑 Online Backup、sync/close、same-parent rename、partial cloud、old/current/future format、operation recovery、retention 和 G7；mixed build/protocol 不运行普通备份。

## 12. 失败语义与诊断

| 失败 | 结果 |
|---|---|
| DB backup/compatibility/integrity/FK 失败 | 不进入 Library copy；旧 snapshots 与水位不变 |
| marker/root/stamp/source before-after 变化，missing/unverified | 整份失败，不写 complete manifest，不发布部分闭包 |
| manifest/limit/digest/extra/link/special 失败 | staging/final 不成为 verified；活动数据 unchanged |
| rename 前中断 | staging 不是候选；按 operation 恢复或安全清理 |
| rename 后、成功记录前中断 | `published-pending-record`；重启 full-validate 后补记或保持 recovery，不推进虚假水位 |
| 云端部分到达 | `incomplete-or-sync-pending`，不能 Restore |
| storage full | 旧两份 verified 保留；释放空间/换目录/重试 |
| retention/quarantine/delete 失败 | 新 snapshot 仍成功，状态 `cleanup-pending` |
| unknown/future version | `incompatible` 或 `unknown-entry`；不自动删除或激活 |

诊断至少记录稳定 code、operation phase、Workspace/BackupSet/Snapshot 的安全关联引用、版本、count/size bucket、耗时、dataEffect 和下一步；文件名、用户路径、内容、标签和原始数据库字段的收集/保留/导出由 ADR-09 决定。没有 ADR-09 前不得自动上传诊断。

## 13. 依赖政策与未选择方案

### 13.1 依赖政策

v1 只使用已批准运行时中的 Node core `fs`、`crypto` 与 DATA 的 `node:sqlite` 能力。没有新增 archive、compression、canonical JSON、hash、UUID、cloud SDK 或 native addon 依赖。canonical encoder 复用 ADR-04 的项目内受限实现，不引入通用 serializer。

### 13.2 未选择 ZIP/TAR 或压缩 archive

单文件在云端同样不是原子上传；Node core 没有完整安全 archive writer/extractor。ZIP/TAR 会新增 entry name、duplicate、symlink、Zip64、path traversal、bomb、压缩比、解压 staging、依赖/CVE 和版本测试，而 PDF/JPEG/PNG/WebP/SQLite 未证明有足够收益。

### 13.3 未选择 content-addressed/shared object store

去重会引入 chunk identity、引用计数、reachability、GC、corruption fan-out、跨快照删除事务和部分上传协议。当前没有增量/去重产品需求，且它会破坏每份 snapshot 自包含的恢复边界。

### 13.4 未选择 mutable latest 目录或 current pointer

原地更新会让同步器/崩溃暴露旧新混合成员；current pointer 丢失或抢写会变成第二个提交协议。不可变目录和逐项验证已能满足恢复选择，不需要额外指针。

### 13.5 未选择签名或加密

当前产品没有密钥、账户、恢复和威胁模型。把 SHA-256 称为签名会产生虚假安全；静默加密又会让密钥丢失变成数据丢失。二者留给独立安全决策。

## 14. 结果、代价与限制

### 14.1 正面结果

- 每份 snapshot 自包含、可流式复制和独立验证，没有 archive extractor 或共享对象 GC；
- 数据库 actual revision、Library marker/FileId closure 与 manifest 形成可判定一致性；
- staging、final recheck、success record 和 crash reconciliation 避免目录出现即伪成功；
- BackupSetId 与 backupSequence 避免多配置用时钟互删；
- 保留两份 verified snapshot，单次新快照损坏/同步异常时仍有上一份；
- 旧 snapshot immutable，版本门和 staged migration 支持正常软件更新；
- 无新增依赖，攻击面与发布矩阵保持最小。

### 14.2 代价与限制

- 每次是全量、无压缩快照，最坏临时空间和 I/O 接近一份完整数据；发布后到 retention 完成可能同时存在三份以上；
- 目录成员会在云端逐步到达，另一设备必须等待 full verification；
- checksum 不抵御能重写目录的攻击者，也不隐藏内容；
- unknown/corrupt/unregistered 条目不自动删除，可能需要用户处理空间；
- Node/OS sync 与 rename 不提供绝对掉电或远端持久保证；
- 100,000 files/1 TiB 是格式 ceiling，不代表当前参考设备在 G7 下都能达到可接受性能。

## 15. 验收与证据门

ADR-07 只有在以下证据通过后才视为已落实：

1. **Canonical fixture**：固定 manifest golden bytes/root digest；key order、空白、BOM、duplicate/unknown field、escape/Unicode、lone surrogate、数字表示和 digest self-exclusion 的 positive/negative vectors。
2. **Limits**：64 MiB manifest、100,000 Library files、100,002 members、1 TiB total、128 PathKey components、32 KiB PathKey/string 的 exact/one-over；declared 与实测 totals 不一致。
3. **Checkpoint closure**：Online Backup actual `R >= T`、新 revision pending；marker/root generation/stamp/source before-after 改变；missing/unverified/link/special；active/unassigned 精确 FileId/标签映射。
4. **Publish failpoints**：每个 state transition、member write/sync/close、manifest write、staging validation、rename 前后、final validation、success transaction/response 丢失；重启不双计、不提前水位。
5. **Hostile candidate**：path traversal、extra/duplicate/case/Unicode 冲突、symlink/junction/reparse/special、short/long read、digest mismatch、SQLite corruption/FK/Workspace/marker/closure mismatch；不执行/预览/打开内容。
6. **云同步状态**：final 目录、manifest、DB 或任一 member 分批到达；missing 显示 incomplete/sync-pending，明确矛盾显示 corrupt，全部到达后可重新变 verified。
7. **BackupSet/retention**：两个相同 WorkspaceId 的 BackupSet 同目录并存；每套独立 sequence；保留最近两份；unknown/other/unregistered/corrupt/incompatible 不删除；cleanup quarantine 每阶段中断可恢复。
8. **失败空间**：目的地不可写、权限撤销、空间满、final 冲突、cleanup 拒绝；不删除最后两份、旧 snapshot 与本地成功不回滚。
9. **兼容与 Restore seam**：old/current/future snapshot/manifest/limits/database/module/marker/PathKey/operation/follow-up；only verified 到 ADR-08 staging；planned/waiting 外部证据失效，物理未收敛状态阻止 snapshot。
10. **平台/更新**：打包后的 macOS 与 Windows 真实本地和已批准云盘目录上验证 sync/close、same-parent directory rename、Unicode/空格、权限、崩溃重开与 signed update 前后 V1 reader。
11. **G7**：版本化参考工作区记录 DB backup、hash、manifest/final validation、publish/cleanup p50/p95/p99、峰值 RSS、临时/最终磁盘放大、utility event-loop delay、CPU/I/O 和恢复时间；后台备份不阻塞 PLAN 核心交互。

证据归入 `TEST-PROTECT-001–006`、`TEST-DATA-004/006`、`TEST-LIBRARY-001–006`、`TEST-FLOW-04-BACKUP-FAILURE`、`TEST-FLOW-05-RESTORE-RECOVERY` 与 `G2/G4/G5/G6/G7`，不新建平行 test family。无法在某平台或真实同步器执行时必须标记未验证，不能推断通过。

## 16. 后续 ADR 边界

- **[ADR-08 恢复激活](./ADR-08-restore-activation-recovery.md)**：决定 RestoreSession staging、跨 database/Library activation checkpoint、RootGeneration/epoch、continue/rollback 与启动恢复。ADR-07 只交付 verified raw snapshot，不把目录 rename 冒充跨位置激活。
- **ADR-09 诊断**：决定本地日志格式、保留、脱敏和用户导出；不得把 snapshot 内容、文件名/路径或用户数据自动上传。
- **ADR-10 打包更新**：锁定 Electron/Node/SQLite、签名/公证、更新器、runtime manifest、发布回滚和更新前 safety-copy 生命周期，并执行 §11.3/§15 的 packaged gate。

未来的签名、加密、archive/compression、incremental/dedupe 或 shared object store 都需要新的产品需求、格式版本、迁移/密钥/恢复政策和 ADR；不得作为 v1 的兼容实现细节加入。

## 17. 重新评审条件

出现以下任一情况必须重开 ADR-07 或建立明确替代 ADR：

- G7 证明全量无压缩目录在已批准参考规模下无法满足磁盘、时间、内存或核心隔离预算；
- 产品要求超过 v1 ceiling、增量备份、去重、压缩、单文件导出或跨平台 archive；
- 产品需要备份保密、签名认证、抗恶意云端、密钥轮换或账户恢复；
- 需要多个设备主动写入同一 BackupSet，必须引入 writer identity、lease/冲突和远端一致性协议；
- Node/SQLite/平台取消或改变 Online Backup、SHA-256、sync、same-parent rename 等依赖语义；
- 保留数量、合规期限或用户删除政策改变；
- ADR-08/09/10 只能通过就地修改 snapshot、自动删除 unknown、执行 snapshot 内容、泄露活动路径或把远端部分上传冒充成功才能实现。

重新评审必须先说明受影响 Requirement/MOD/IF/FLOW/Q/TEST、旧 snapshot/operation 兼容、失败半径、双平台证据与回退路径；不得用实现偏差替代新决议。

## 18. 参考资料

- [SQLite Online Backup API](https://www.sqlite.org/backup.html)
- [SQLite PRAGMA integrity/foreign key checks](https://sqlite.org/pragma.html#pragma_integrity_check)
- [Node.js File system API](https://nodejs.org/api/fs.html)
- [Node.js `FileHandle.sync()`](https://nodejs.org/api/fs.html#filehandlesync)
- [Node.js `crypto.createHash()`](https://nodejs.org/api/crypto.html#cryptocreatehashalgorithm-options)
- [Node.js `crypto.randomUUID()`](https://nodejs.org/api/crypto.html#cryptorandomuuidoptions)
- [RFC 8785 JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785.html)
- [NIST FIPS 180-4 Secure Hash Standard](https://nvlpubs.nist.gov/nistpubs/fips/nist.fips.180-4.pdf)
- [POSIX `rename()`](https://pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html)
- [Microsoft Moving Directories](https://learn.microsoft.com/en-us/windows/win32/fileio/moving-directories)
- [Microsoft `FlushFileBuffers`](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers)
- [Microsoft File Caching](https://learn.microsoft.com/en-us/windows/win32/fileio/file-caching)
- [Apple `fsync(2)`](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fsync.2.html)
- [Node.js Zlib](https://nodejs.org/api/zlib.html)
- [PKWARE ZIP APPNOTE](https://support.pkware.com/pkzip/appnote)
