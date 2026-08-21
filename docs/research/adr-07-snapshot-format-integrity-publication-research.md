# ADR-07：快照格式、完整性与发布方式一手资料研究

- 日期：2026-08-20
- 状态：研究记录，含推荐但**不构成 ADR 决议**
- 决策主题：`ADR-TOPIC-07`
- 资料方法：仅引用标准、操作系统/API 官方文档或上游项目源码/文档；未使用二手文章或旧实现。
- 后续约束：[ADR-09](../architecture/adr/ADR-09-no-production-diagnostics.md) 已决定不建设生产诊断/日志/支持包；本文关于“留给 ADR-09”的历史表述由该负向决议收口。

## 1. First-principles 边界与已有契约

用户结果是：一次已显示为成功的云盘快照在另一设备/新安装上可以独立验证并进入显式恢复，同时云盘中断、部分上传、应用/设备崩溃或某个资料库文件在复制时变化，都不得让本地正式数据或上一有效快照失真。快照是**可验证副本**，不是活动数据库、资料库根或同步协议。

当前规范已经固定以下不变量：

- `MOD-PROTECT` 拥有 `SnapshotManifest`、`SnapshotId`、backup watermarks 与 RestoreSession；活动结构化事实仍由 DATA、真实文件仍由 LIBRARY 拥有。[Architecture §4–5](../architecture/ARCHITECTURE.md#4-数据真相身份与派生)
- `BackupCheckpoint` 必须在 revision `R` 取一致 structured export；LIBRARY 只在 root/marker/generation 稳定、完整扫描成功、没有 `disk-applied/reconciliation` 时提供 verified 内容闭包；未验证/缺失项不得被静默遗漏。临时写、验证、发布 `SnapshotId`、再推进 `backupSucceededThrough` 是既定顺序。[Contracts `IF-BACKUP-CHECKPOINT`](../architecture/MODULE_CONTRACTS.md#72-if-backup-checkpoint)、[FLOW-04](../architecture/MODULE_CONTRACTS.md#85-flow-04--异步备份)
- DATA 已选择 SQLite Online Backup 产生 actual revision 的数据库副本，而非 raw-copy 活动 `.db/-wal/-shm`；副本之后需读出实际 revision、验证 schema/`integrity_check`/`foreign_key_check`，并使 Library manifest 对应该副本。[ADR-03](../architecture/adr/ADR-03-sqlite-active-data-transactions.md)、[SQLite Online Backup](https://www.sqlite.org/backup.html)、[SQLite PRAGMA](https://sqlite.org/pragma.html#pragma_integrity_check)。
- ADR-04 已定义 snapshot manifest 至少声明 `snapshotFormatVersion`、database `application_id`、source schema level、`WorkspaceId`、actual source Revision、模块/格式版本、digest algorithm/version；`snapshotFormatVersion` 绝不等于 `user_version`。它也已规定候选先 stage/verify/必要时迁移，不能先覆盖活动数据。[ADR-04 §10](../architecture/adr/ADR-04-schema-migration-compatibility.md#10-snapshot恢复与跨文件边界)。
- ADR-05 已定义 Library checkpoint 的 marker、RootGeneration、verified active/unassigned records、content source 与版本；不可把 platform ObjectEvidence 当作跨设备/快照的永久身份。它把 manifest encoding、content digest、压缩、临时发布、保留和 pending operation 项明确留给 ADR-07。[ADR-05 §12](../architecture/adr/ADR-05-library-watching-index-file-operations.md#12-后续-adr-边界)。
- ADR-06 要求快照保存原始 Library 文件和可验证 manifest，而**不**保存 preview cache、lease 或解析投影；其 runtime/version 门归 ADR-10。[ADR-06 §14](../architecture/adr/ADR-06-resource-preview-system-open.md#14-后续-adr-边界)。

本 ADR 因而决定：可独立验证的快照容器/目录、manifest canonical bytes 与完整性覆盖、暂存到发布、保留/清理和其 failpoint。它**不**决定 DATA schema/migration（ADR-04）、文件扫描与资料库身份（ADR-05）、预览（ADR-06）、restore 的 staging/activation/continue/rollback（ADR-08），也不冻结 Electron/Node 版本、签名、更新器或发布策略（ADR-10）；当时留给 ADR-09 的日志/导出问题已由后续决议以“不建设”解决。

## 2. 一手事实与设计影响

### 2.1 一致数据库与资料库闭包不是一次普通拷贝

SQLite Online Backup 的 destination 是 source database 在 backup 完成时的 snapshot；它允许 source 同时被修改，必要时会重新开始读取。因此 checkpoint 只能以**实际写入副本**读出的 revision 为准，不能沿用请求时的 revision。[SQLite Backup API](https://www.sqlite.org/backup.html)。这与 ADR-03 的 existing actual-revision 规则一致。

资料库是独立文件树，不能由 SQLite transaction 原子冻结。故对每个 checkpoint content source，最小可证明步骤是：取 DB index record/stamp → 打开已验证普通文件 → 流式复制并算 digest → close/sync destination → 再取得 source stamp/对象/containment。前后证据任一不匹配、文件缺失或权限失败，整个 checkpoint 不能声明完整；应丢弃 staging 或留下可恢复 operation，保留旧 published snapshot 与 pending watermark。Node `copyFile` 也只保证尽力清除失败时已创建的目标，不能作为“失败后无残留”的协议替代。[Node `copyFile`](https://nodejs.org/api/fs.html#fspromisescopyfilesrc-dest-mode)。

因此所谓 Library 闭包应是：数据库副本所含 `LibraryRecord`/mapping/tag 与 manifest 声明的 `FileId → immutable snapshot member` 一一对应，外加根 marker 的原始 bytes/版本；包括 active 和 unassigned ordinary files，排除 links、special entries、operation-owned temp/recovery、未验证/missing 与 preview transient。历史绝对根路径和 node `dev/ino` 只能作为待失效的历史设备元数据，恢复到新设备时仍必须重新授权/扫描，不能成为内容定位依据。

### 2.2 哈希能证明完整性，不能凭空提供身份认证或保密

SHA-256 是标准的 256-bit secure hash；NIST 的定义是任意消息变化以极高概率得到不同 digest。[FIPS 180-4](https://nvlpubs.nist.gov/nistpubs/fips/nist.fips.180-4.pdf)。Node core 可用 `createHash('sha256')` 流式计算文件，无需把资料库内容放进内存。[Node crypto](https://nodejs.org/api/crypto.html#cryptocreatehashalgorithm-options)。

但是无密钥 SHA-256 只检测意外损坏/不一致：能够修改快照目录的攻击者也能重算 manifest digest。当前产品没有定义签名密钥、账户、密钥恢复、端到端加密或不可信云对手模型；ADR-07 不应把 checksum 写成“防篡改认证”或暗中引入密钥。若产品需要抗恶意云篡改/保密，必须单独决定密钥所有权、算法、轮换、丢失恢复和 UI，而不是把它藏进 snapshot format。

### 2.3 canonical manifest 需要独立、有限的编码定义

普通 JSON 的对象顺序/数字表达不是稳定 digest preimage。RFC 8785 说明 canonical representation 是可重复 hash/sign 的前提，要求 deterministic key sorting、无 duplicate name、有效 Unicode；但它基于 IEEE-754 number，建议更大整数改用 JSON string。[RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html)。这与 ADR-04 对 64-bit 值使用 canonical decimal string 的已接受政策一致。

可选做法是复用 ADR-04 的受限 `courseflow-canonical-json-v1` 规则，而不是引入 JCS package 或另造通用 JSON serializer；但 snapshot 的 grammar/version 必须在 manifest 自身显式写出，且维护 golden vector。合理的 canonical manifest input 禁止 duplicate/unknown key、float、`-0`、NaN/Infinity、lone surrogate、prototype/class、压缩包内部名称歧义；所有 size、revision、mtime、count 使用 ADR-04 canonical decimal string，所有 member path 使用版本化、`/` 分隔的 ASCII/UTF-8 relative grammar。

### 2.4 写入、flush、rename 的承诺边界

Node `FileHandle.sync()` 请求将 open descriptor data flush 到 storage device；它明确说具体实现依 OS/device。`writeFile({flush:true})` 在成功写完时会调用 sync，但取消是 best-effort，可能已有字节写入。所有 `FileHandle` 都须显式 close，不能依赖 GC 自动回收。[Node fs sync/writeFile/close](https://nodejs.org/api/fs.html#filehandlesync)、[Node fs promise cautions](https://nodejs.org/api/fs.html#promises-api)。

POSIX `rename()` 在成功时是原子名称切换；Windows 的 `MoveFileEx` 移动目录要求 source/destination 同 drive 且 destination 不存在，并可请求 `MOVEFILE_WRITE_THROUGH`。二者都支持「同一 backup root 下，从唯一 staging 目录 rename 到此前不存在的 final SnapshotId 目录」这一 namespace publication 模式。[POSIX rename](https://pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html)、[Windows moving directories](https://learn.microsoft.com/en-us/windows/win32/fileio/moving-directories)。

但它们不能证明电源故障下所有硬件、文件系统、云同步器都持久或远程可见。macOS 的 `fsync` 文档特别说明 drive 可延迟/重排写入，`F_FULLFSYNC` 也只是请求更强 flush 且 Node core 没有跨平台公开开关；Windows 同样将数据/metadata 缓存与 `FlushFileBuffers`、write-through 的成本和硬件限制分开说明。[Apple `fsync`](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fsync.2.html)、[Windows FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers)、[Windows file caching](https://learn.microsoft.com/en-us/windows/win32/fileio/file-caching)。

因此可承诺的是「经过同步尝试、完成本机同目录 rename 后的 published candidate 可被完整验证」；不可承诺「磁盘掉电永不损坏」或「iCloud/任意云同步器原子上传整个目录」。云同步中另一台设备可能先看到 final directory 的部分成员，故它在逐成员 digest、数量/上限、manifest 和 DB 校验全部通过前只能是 incomplete/invalid candidate，绝不能依目录出现或时间戳视为 snapshot 成功。

### 2.5 压缩/归档不是免费容器

Node `zlib` 提供 gzip/deflate/Brotli/Zstd 压缩流，但不提供 ZIP/TAR 多成员 archive writer、member 索引或安全 extractor；Zstd 在当前 Node 文档仍为 experimental。引入 archive format 还须处理其 entry name、重复条目、symlink、解压后总量、异常中央目录和兼容版本。[Node zlib](https://nodejs.org/api/zlib.html)。ZIP 的 APPNOTE 采用 local entries 加尾部 central directory，意味着完整性/成员清单/安全解包仍要由 CourseFlow 重复验证，不能把“能解压”当作 manifest 验证。[PKWARE APPNOTE](https://support.pkware.com/pkzip/appnote)。

压缩对 PDF/JPEG/PNG/WebP/SQLite 等通常已经压缩的数据没有既定用户价值；它增加 CPU、失败点、解压炸弹、依赖/版本与恢复前 staging 成本。当前没有包体、流量或空间预算强制它，故应先不压缩。未来若 G7/存储测量证明必需，可在新的 `snapshotFormatVersion` 加入**可选但有严格压缩/解压 size ratio、entry count、算法版本和无 fallback**的 variant；不可悄悄改变 v1。

## 3. 候选方案比较

| 方案 | 物理布局/发布 | 优点 | 主要缺点 |
|---|---|---|---|
| S1：immutable directory（推荐） | 一个 `SnapshotId` 一个目录；写入 sibling staging dir，逐文件验证，写 canonical `manifest.json`，sync 后 rename 为此前不存在的 final dir。 | 无新依赖；保留原始 SQLite/文件 bytes；可流式复制/校验；manifest 直接列成员，读取/partial-cloud detection 简单；不需要解压。 | 多文件目录在云端会非原子到达；需明确 staging 名、递归验证、目录枚举/retain 规则。 |
| S2：单一 ZIP/压缩 archive | 打到临时 archive，成员表/manifest 验证后 rename 单文件。 | 本地发布对象少；若文件可压缩可能节省云空间。 | Node core 不提供完整 archive；ZIP/deflate entry、重复名、Zip64、path traversal、symlink、bomb 与 extractor 必须新增依赖/测试；重新验证/restore 必须解压 staging。单文件 rename 不会使云端上传原子。 |
| S3：content-addressed chunks + manifest pointers | 将文件切块去重，snapshot 只发布 manifest/root pointer。 | 跨多份大资料可能节省空间。 | 引入 chunk identity、GC/reachability、引用计数、partial upload、corruption fan-out、compaction 与跨快照删除事务；没有当前 dedupe/incremental 产品需求。 |

基于 YAGNI/KISS，**S1 是建议 ADR-07 接受的最小方案**：uncompressed immutable directory + canonical manifest + SHA-256 完整性清单 + temporary-then-verify-then-rename。它没有把压缩/去重当作格式要求，也没有把目录 rename 误称为云端事务。该建议不替项目负责人作决策。

## 4. S1 可供 ADR 采用的精确轮廓

### 4.1 目录与 SnapshotId

在已验证的独立 backup root 下，published snapshot 是唯一直接子目录，例如：

```text
<backup-root>/
  snapshot-<SnapshotId>/
    manifest.json
    workspace.sqlite
    library/root-marker
    library/content/<FileId>
```

`SnapshotId` 应由 Node `crypto.randomUUID()` 生成；该 API 使用加密伪随机数生成 RFC 4122 v4 UUID。[Node randomUUID](https://nodejs.org/api/crypto.html#cryptorandomuuidoptions)。它是 published snapshot 的稳定身份而非时间字符串、目录位置或 manifest hash。日期只作 manifest metadata/display；时钟碰撞/时区不参与身份。

内容文件以 opaque `FileId` 命名，而不是用户原路径/文件名；恢复时由 verified DB record + manifest mapping 重新建立布局。这减少路径穿越、保留名、Unicode/大小写冲突与云端工具改名的格式耦合。`library/root-marker` 保存 marker 的原始 bytes；manifest/DB 分别声明其 version/identity。snapshot 目录内不得有 symlink/junction/reparse point、special file、hard-link policy loophole、可执行 code、preview cache、lease、temp/recovery artifact 或不在 manifest 的普通成员。

staging 目录必须在**相同 backup-root parent**下，以 hidden/reserved exact operation name（例如 `.courseflow-staging-<OperationId>-<nonce>`）创建且 never candidate；它不获得 `SnapshotId`。final `snapshot-<SnapshotId>` 必须原先不存在，以独占 create/rename 防止覆盖用户/另一进程内容。冲突、根不在同一卷、权限、同步或 rename 失败都使此次 operation failed/pending，旧 published snapshot 不变。

### 4.2 `SnapshotManifestV1` 与哈希覆盖

建议 `manifest.json` 为 UTF-8、无 BOM、无无意义空白的 canonical JSON，并带以下至少字段：

```text
snapshotFormatVersion: 1
manifestEncoding: courseflow-canonical-json-v1
snapshotId
createdAt
workspaceId
source: { applicationId, schemaLevel, actualRevision }
modules: [{ moduleId, formatVersion }]
library: { markerFormat, libraryRootId, rootGeneration, pathKeyEncoding }
digest: { algorithm: sha-256, encoding: lowercase-hex, value }
members: [
  { path, kind: database | marker | library-content,
    fileId?, byteLength, sha256, sourceStampVersion? }
]
limits: { memberCount, totalBytes }
```

`members` 以 canonical relative `path` 的 bytewise order 排序，精确列举 `workspace.sqlite`、marker 与每个 Library content；不允许重复 path 或 duplicate `FileId`、`..`、空 component、反斜线、绝对/drive/UNC 名、NUL、Unicode normalisation substitution 或未声明成员。`byteLength`/revision/count 一律字符串而非 JS Number。`sourceStampVersion` 仅说明此次 copy/closure evidence，不把 OS object evidence/绝对 path 作为 cross-device identity。

每个 member 的 `sha256` 覆盖其完整、未压缩的 raw bytes；`totalBytes` 与 entry count 防止伪造 manifest 要求无界枚举。`digest.value` 定义为：从 manifest object 移除 `digest.value` 后，按 `manifestEncoding` canonicalize 成 UTF-8，计算 SHA-256。验证器必须先严格 parse/schema validate、拒绝 unknown/duplicate/越界字段，再按同一算法重算；不要 hash 人类格式化的 JSON 文件，亦不要将 manifest 自身加入 `members` 造成循环依赖。

此 root digest 加每 member digest 覆盖完整成员表及所有 member bytes。它提供损坏/不一致检测但不提供签名认证；未知 `snapshotFormatVersion`、encoding/digest algorithm 或 module/format version 必须 stop with incompatible，不能忽略字段后“尽力恢复”。

### 4.3 checkpoint → staging → validation → publication

推荐的单方向操作状态如下，具体持久 Operation/恢复表仍由 DATA/PROTECT 所有：

1. 合并 `backupNeededThrough`，生成 `OperationId`，但绝不提前推进 success watermark 或删除旧 snapshot。
2. DATA 创建 SQLite Online Backup 到 staging `workspace.sqlite`；以 read-only 打开该副本，读出 actual `application_id/schema level/WorkspaceId/revision`，跑完整性/FK 检查。
3. LIBRARY 为该 actual revision 建立 checkpoint closure。逐一 verify source，复制到 staged opaque content member，流式 SHA-256、精确 size、close/sync，再 verify source before/after stamp。marker 同样复制/hash/validate。任一项失败就不生成 complete manifest。
4. 对已写 members 再从 staging 枚举：拒绝 unexpected/member mismatch/link/special/size/count/total-byte 越限，重算 SHA-256；从实测结果产生 canonical manifest 和 root digest，写入、sync、close；再验证 manifest 自己可重新 canonicalize 且完整 closure 与 DB/library metadata 相符。
5. 可选择在 staging 父目录上执行平台可用的目录 metadata flush；Node 跨平台不能承诺该能力，flush 不支持/失败必须记录，不能伪称断电强保证。仅在整个 staging 已验证后，same-parent `rename` 为唯一 final name；`rename` 成功是本机 namespace 的 published commit point。
6. rename 后重新打开 final directory，执行同一 full validator。验证成功才在 DATA transaction 中持久 `SnapshotId`/last-success/`backupSucceededThrough=actualRevision`。如果此 transaction 或响应在 rename 后丢失，重启时以 OperationId/SnapshotId 扫描/验证已发布目录，幂等补记 success；无法验证则不推进 watermark。
7. 只有新 snapshot 已发布、DB success commit 已完成后才发起 retention cleanup。cleanup 失败不回滚已发布快照/水位，只形成明确、可操作的 storage cleanup pending。

此顺序使「rename 后但 watermark 前崩溃」成为可收敛的安全重复备份，而不是丢失唯一可恢复副本或声称未写入。

### 4.4 读取/验证与 hostile input 限制

所有 backup root 中的条目都可被用户、同步器或其他设备改写，故验证器输入必须不信任：

- 首先 `lstat`/realpath containment，并仅接受 final dir、regular manifest/database/content members；递归枚举中任何 link/reparse/special 条目、额外成员、missing member 或 symlink escape 都使候选无效。复用 ADR-05 已批准的 links/containment policy，不另造“archive safe path”的第二套语义。
- 在打开/解码 JSON、读 SQLite 或复制到 restore staging 前检查版本、manifest byte limit、member count、每 member size、总 size、路径 component 长度与 nested depth；所有上限以 `SnapshotFormatLimitsV1` 版本化，不信任目录的 declared count/size。
- 读取每个 member 精确到 manifest declared byte length 后计算 hash；short/long read、digest mismatch、duplicate FileId/path、DB source tuple/Library root mismatch、marker mismatch、SQLite corruption/FK failure均为 `invalid-snapshot`，活动 workspace unchanged。
- 不从 snapshot 执行脚本、打开文档、解析预览、跟随 URL、跟随外部路径或导入任何 node/electron handle；restore 只把 raw bytes放入 ADR-08 的独立 staging。

这些限制同样防止 archive variant 的 path traversal/zip bomb，但 S1 的无压缩目录使 v1 不需要 extractor、Zip64 或 compression-ratio policy。

### 4.5 保留与清理

保持每份 published snapshot self-contained/immutable；备份根不维护「唯一 current pointer」或可丢失 index。列举 `snapshot-<UUID>` 后逐个 full-validate；任何 staging/未知/损坏目录不是可恢复 snapshot，也不得自动删除，除非其精确名称/OperationId 与已持久化、终止的 operation 关联并满足安全清理规则。

具体 retention 数量/年龄是产品保留政策，当前 PRD 未授权 ADR 自行编造数值。ADR 至少应锁定顺序：新 snapshot verified + watermark committed 后才按已批准 retention 选择候选；永远保留至少一个 latest fully valid snapshot；无法验证的目录不计入保留数量；删除采用可恢复/明确的清理策略，并在成功前不将它从 restore list 移除。空间不足或 cleanup 失败保持新/旧 published snapshot 和本地事实，返回 `storage-full`/`cleanup-pending`，不做“为了备份成功删除唯一好副本”的补偿。

## 5. 失败矩阵与测试输入

| 注入点/输入 | 必须观察到的结果 | 主要证据 |
|---|---|---|
| DB online backup 前/中/后，actual revision 与请求 revision 不同，DB integrity/FK/schema/WorkspaceId 失败 | 未发布 SnapshotId；watermark 不前进；上一有效快照与本地事实不变 | `TEST-PROTECT-002/003/004`、`TEST-DATA-006` |
| library root/marker/generation/stamp 在 copy 前后变化；missing/unverified、link/special、operation pending、source read/close/sync/hash 失败 | 不构成 closure；staging 不被当候选；解释 problem/retry | `TEST-LIBRARY-001–006`、`TEST-PROTECT-006` |
| staging member/manifest 部分写、同步失败、manifest encode/hash mismatch、extra/duplicate/path traversal/Unicode collision、size/count/total limit 超出 | full validator stop；不得发布/选择 restore；不执行内容 | `TEST-PROTECT-002/004`、`G4` |
| final rename 前 kill、rename 失败、cross-volume/已存在 target、rename 后 kill/DB response 丢失 | 前者没有 published snapshot；后者 restart 以 OperationId/SnapshotId full-verify 后幂等记录或保持 pending，绝不双计/伪成功 | `TEST-PROTECT-002/003`、`TEST-FLOW-04-BACKUP-FAILURE` |
| 云端/另一设备先见 final 的部分文件、同步延迟/冲突、恶意或损坏 manifest/bytes | 只能显示 unavailable/invalid；所有 digest/SQLite/closure 校验成功才进入 restore preview | `TEST-PROTECT-004/005`、`Q-PROTECT-01` |
| retention 前/中/后 kill、删除被拒、存储满、staging orphan/unknown user directory | 不回滚已确认新快照；保留至少一个 verified snapshot；未知目录不自动删；状态可解释/恢复 | `TEST-PROTECT-003/005` |
| restore candidate current/old/future format | ADR-04 stage/migrate/validate；ADR-08 activation 前原 workspace unchanged，activation 后只 continue/rollback | `TEST-PROTECT-004/005`、`TEST-FLOW-05-RESTORE-RECOVERY` |

G7 还应以版本化参考工作区测量：DB backup、每个/总 content hash、manifest validation、publish/cleanup latency、utility event-loop delay、峰值 RSS/磁盘占用与失败恢复时间。备份后台工作不得等待核心 commit 或阻塞 PLAN；无法在 macOS 或 Windows packaged runtime 复现的 fsync/rename/cloud destination 行为必须明确标为未验证。

## 6. ADR-10 时效/发布风险

S1 依赖的是 Node `fs`、`crypto`、`node:sqlite` 与 OS filesystem 的组合，而非语言层面的“atomic cloud backup”。每次 Electron/Node/SQLite/OS 更新、打包资源/ASAR 政策或 cloud destination 支持范围变化，都应在 ADR-10 的 signed packaged macOS/Windows gate 重跑：

- actual bundled `process.versions` 上的 Online Backup、SQLite validation、SHA-256/UUID、`FileHandle.sync`、same-parent directory rename；
- 本地及已批准 cloud backup root 的 staging visibility、partial sync、冲突、权限撤销、空间满、停机/重启与 retention recovery；
- old/current/future `snapshotFormatVersion`、manifest encoding/digest/member grammar、module formats 和 DB schema-level fixture；
- static dependency review：v1 没有 archive/native/compression dependency，只有 Node core；若以后加入 ZIP/compressor，其版本、CVE、bomb/limit fixture 与双平台 unpack 必须成为 release assets。

Apple 和 Windows 的官方资料都说明 flush/persistent media受设备缓存、性能和硬件限制；因此发布报告只能声称运行过的 failpoint/packaged tests，不能把 `sync` 或 rename 写成绝对掉电/云端原子保证。[Apple fsync](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fsync.2.html)、[Windows FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers)。

## 7. 尚待 ADR 决策/上游确认的问题

1. 是否接受 S1 为 v1，采用 uncompressed immutable directory、opaque FileId content members、canonical manifest + SHA-256，并拒绝 archive/dedupe？
2. `SnapshotFormatLimitsV1` 的具体上限（manifest bytes、members、total bytes、path depth/length）及 retention 数量/年龄仍缺产品/G7 依据；它们应由谁、何时校准？
3. 资料库 closure 遇到一个未验证/missing/拷贝中变化的文件时，v1 是否一律停止整个 snapshot（研究建议），还是产品要允许「部分资料库快照」并改变 `B-FILE-012`/恢复承诺？
4. 当前 checksum 只给损坏检测。用户是否需要防恶意云篡改或 backup-at-rest 保密？若是，需要新安全/密钥决策，不能在 ADR-07 默默宣称实现。
5. cleanup 应采用平台 Trash、可恢复 backup-root quarantine，还是只允许显式用户删除？该选择涉及 retention UX/安全承诺，不能由本研究自行确定。

## 8. 实际检查

- 已审阅当前 `PROJECT_BRIEF`、`PRD`、`MVP_SCOPE`、`ARCHITECTURE`、`MODULE_CONTRACTS`、ADR-01 至 ADR-06，以及 ADR-04/05/06 的 research/design；未把 `ATTEMPT.md` 作为规范或依据。
- 已检索并引用 Node、SQLite、POSIX、Apple、Microsoft、NIST、RFC Editor、PKWARE 的一手文档/规范。
- 本文件是唯一新增文件；未运行应用、打包构建或跨平台/掉电/云同步实验。文中所列测试和发布门均是将来必须提供的证据。
