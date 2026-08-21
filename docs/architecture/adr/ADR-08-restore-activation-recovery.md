# ADR-08：恢复激活、回滚与启动恢复

- 状态：已接受
- 日期：2026-08-21
- 决策主题：`ADR-TOPIC-08`
- 前置决策：[ADR-01](./ADR-01-desktop-runtime-ui-boundary.md)、[ADR-02](./ADR-02-process-thread-deployment.md)、[ADR-03](./ADR-03-sqlite-active-data-transactions.md)、[ADR-04](./ADR-04-schema-migration-compatibility.md)、[ADR-05](./ADR-05-library-watching-index-file-operations.md)、[ADR-06](./ADR-06-resource-preview-system-open.md)、[ADR-07](./ADR-07-snapshot-format-integrity-publication.md)
- 上游规范：[PRD](../../product/PRD.md)、[MVP_SCOPE](../../product/MVP_SCOPE.md)、[User Flow](../../superpowers/specs/2026-08-17-user-flow-design.md)、[UI 规格](../../superpowers/specs/2026-08-18-courseflow-ui-wireframes-page-spec-design.md)、[Architecture](../ARCHITECTURE.md)、[Module Contracts](../MODULE_CONTRACTS.md)
- 调研证据：[恢复激活、回滚与启动恢复一手资料研究](../../research/adr-08-restore-activation-recovery-research.md)
- 讨论记录：[ADR-08 Superpowers 设计讨论](../../superpowers/specs/2026-08-21-adr-08-restore-activation-recovery-design.md)

## 1. 背景

CourseFlow 的一份完整活动真相由两个不同物理资源共同组成：

- `MOD-DATA` 拥有的本地 SQLite 活动数据库；
- `MOD-LIBRARY` 拥有的真实本地资料库根及其 marker、文件和映射闭包。

它们可能位于不同卷。POSIX/macOS/Windows 都没有一个可让 SQLite database slot 与任意 Library 目录跨卷共同提交的文件系统事务；Node copy 不是原子操作，Windows cross-volume move 可退化为 copy-delete，SQLite WAL 又不能在活动连接仍存在时与数据库文件分离。详细证据见[研究记录](../../research/adr-08-restore-activation-recovery-research.md)。

ADR-03 已决定 SQLite WAL + `synchronous=FULL`、单 writer、Online Backup 和可恢复 activation seam；ADR-04 已决定候选在独立副本上迁移/验证、恢复候选 WorkspaceId 成为激活后身份；ADR-05 已决定 LibraryRootId、RootGeneration、marker、watcher hint、FileId 对账和可恢复 FileOperation；ADR-07 已决定快照是经过 hostile-input validator 验证的完整不可变目录。

本 ADR 必须在这些边界上决定：

- 一个同时覆盖 DATA 与 Library 的 RestoreSession 如何拥有状态、接口与确认；
- 恢复前安全保护、目标选择、容量和 maintenance；
- 候选如何从备份卷到达各自最终卷旁的 staging；
- 如何用外部协调状态包围多个非事务性 rename；
- crash/restart 如何唯一分类物理结果并显式继续或回滚；
- 新工作区何时才算 succeeded，旧副本与安全集何时可清理；
- v1 如何为未来资源留出有约束的版本升级，而不预建通用 2PC/plugin 框架。

`ATTEMPT.md` 是归档旧实现证据，不是恢复目标或实现来源。本文批准技术设计，不授权开始实现，也不替 ADR-09/10 决定诊断保留、绝对平台位置、打包或更新。

### 1.1 追溯边界

- Requirement：`A-DATA-001–006`、`A-PLATFORM-001`、`B-FILE-001/012/013`、`STATE-002`、`NFR-001/002/003/006/007/010`、`MVP-DOD-005–008`；
- User/UI：`UF-A-01`、`UF-A-07`、`UI-ENTRY-01`、`UI-DATA-01/02`；
- Module：`MOD-WORKSPACE`、`MOD-PROTECT`、`MOD-DATA`、`MOD-LIBRARY`、`MOD-PLATFORM`；Shell 只经 Workspace；
- Interface：`IF-WORKSPACE`、`IF-RESTORE-SESSION`、`IF-IMPACT-PREVIEW`、`IF-OPERATION-HANDLE`、`IF-STRUCTURED-PROBLEM`、`IF-DATA-STAGE-ACTIVATE`、`IF-DATA-OPERATION`、`IF-LIBRARY-MANIFEST` 与窄 `IF-FILESYSTEM`；
- Flow：`FLOW-05`，启动依赖 `FLOW-00`，Library 重开对账依赖 `FLOW-03`，安全集/恢复后快照与 `FLOW-04` 生命周期相邻但不混用；
- Quality：`Q-TRUTH-01`、`Q-PROTECT-01`、`Q-ISOLATE-01`、`Q-LOCAL-01`、`Q-ACCESS-01`、`Q-PORTABLE-01`、`Q-RESPOND-01`、`Q-EVOLVE-01`、`Q-CONTINUITY-01`、`Q-DIAG-01`；
- Test：`TEST-PROTECT-004–006`、`TEST-DATA-005/006`、`TEST-WORKSPACE-003–005`、`TEST-LIBRARY-001/002/006`、`TEST-PLATFORM-002/004`、`TEST-FLOW-00-LIFECYCLE`、`TEST-FLOW-03-LIBRARY-RECOVERY`、`TEST-FLOW-05-RESTORE-RECOVERY` 与 `G4/G6/G7`。

稳定 ID、可观察产品状态和逻辑接口语义仍由上游文档拥有；本文是恢复物理机制、格式与顺序的唯一技术真相。

## 2. 决议摘要

CourseFlow v1 采用**深 Restore Module + RestoreSession 专属安全恢复集 + 最终卷同父 sibling staging + 外部 append-only write-ahead activation journal + DATA commit-last + 启动先判定 + 显式继续/回滚**：

1. 不新增 top-level module。`MOD-PROTECT` 内部 Restore Module 独占会话、保护方式、协调记录与最终成功语义。
2. welcome 和设置恢复使用同一个 `IF-RESTORE-SESSION`；调用者不传 `welcome | replace` 模式，Module 从当前活动真相推导旧副本与安全需求。
3. 候选选择/迁移验证与 activation staging 是两个阶段。前者在 preview 前完成并不修改备份原件；后者在 confirm 与安全集之后，把完整候选复制到最终目标所在卷的 sibling。
4. 当前 DATA 与已配置 Library 均健康时，先创建完整、不可变、RestoreSession 专属的 `RestoreSafetySetV1`。它不是 Snapshot/BackupSet，不计入最近两份保留。
5. 当前 DATA 损坏/只读或已配置 Library 无法完整读取时，只有原始 DATA/Library/诊断证据可保持不变且稳定控制位置可写，才允许带明确警告的 `restricted-waived`；否则停止。
6. 最终确认绑定候选、Library target、impact digest，以及健康 current 的 revision/RootGeneration 或 restricted current 的 raw evidence fingerprint。确认后立即进入 maintenance；checkpoint 前可取消，外部变化要求重新 preview。
7. `ActivityControlRoot` 位于不会随 DATA slot、LibraryRoot 或 backup destination 一起切换的稳定本地应用控制区域。确切 macOS/Windows 基址留给 ADR-10，但其跨更新稳定、先于 DATA 打开可读、不得位于云盘/Library/可交换 DataSlot 是 ADR-08 硬约束。
8. DATA candidate/rollback 与活动 DataSlot 同父同卷；Library candidate 与最终 LibraryRoot 同父同卷。从备份卷到 sibling staging 只用 checkpoint 前流式 copy + full validation，activation 永不 cross-volume copy-delete。
9. `ActivationPlanV1` 是封闭的 `database + optional library`；每个资源用 typed present/absent/target/disposition variant，不接受 plugin、hook 或任意 participant list。
10. 外部 activation journal 是 canonical、append-only、hash-chained、write-ahead。每个物理动作先持久 intent，动作后重新观察磁盘再写 observed。
11. `armed` 记录持久、重开验证并通过最终 fingerprints 后即为 activation checkpoint。此后普通 Workspace 不可打开，直到 journal、磁盘与一个完整 pair 收敛。
12. 激活顺序为 Library retire/install、旧 DATA retire、新 DATA install；新 DATA 是 commit-last participant。journal pending 时禁止打开任何可能混合的新旧 pair。
13. 启动先检查 external journal，再打开 DATA 或启动 watcher。它只可自动补记由磁盘证据唯一证明且不改变 DATA/Library 的 observed/committed 记录；任何物理 resume/rollback 等待用户明确决定。
14. 成功必须经过 candidate DATA 重开/完整验证、Library 全量 reconcile/新 RootGeneration、设备能力失效、FLOW-00 路由、DATA success receipt 和 external `committed`。
15. checkpoint 后、succeeded 前允许 rollback；rollback 也需重开、对账和 FLOW-00。succeeded 后返回旧数据是新的完整 RestoreSession，不提供 shortcut rollback。
16. RestoreSafetySet 至少保留到恢复后第一份常规 snapshot 发布并验证成功；未配置 backup 时保留为独立本地恢复点，直到用户明确清理。成功后的 transient cleanup failure 只产生 `cleanup-pending`。
17. v1 只承诺**可恢复的逻辑全有或全无**与经 failpoint 证明的 process-crash/restart recovery，不宣称多个目录的 OS 原子事务、云端原子性或绝对掉电耐久。

## 3. 所有权与深模块边界

### 3.1 `MOD-PROTECT`

PROTECT 是以下语义的唯一所有者：

- RestoreSessionId、OperationId、SessionVersion、会话状态与 allowed actions；
- candidateRef 的选择状态、candidate validation 结果和 impact preview 绑定；
- `RestoreSafetySetV1` 身份、格式、验证、保留与清理资格；
- `ActivityControlRoot` 中的 session/plan/journal 所有权与 hostile validation；
- activation/rollback 全局顺序、checkpoint、启动分类和 success/rolled-back/cleanup-pending；
- public problem 映射和不泄露路径的 diagnosticRef。

PROTECT 不直接读写领域表、不解释 PathKey/FileId、SQLite WAL 或平台错误。它通过 owner 接口取得 typed evidence 并编排。

### 3.2 `MOD-WORKSPACE`

WORKSPACE 仍拥有：

- `maintenance`、`recovery`、`ready/read-only/limited` 模式；
- WorkspaceEpoch、capability/health 聚合与旧 lease 撤销；
- Shell 命令路由、影响预览组合和 welcome/setup/today/recovery route；
- 恢复成功前对普通工作区的封锁。

WORKSPACE 不解释 journal record、DataSlot 或 rename 次序。Shell 只看到 RestoreSessionView、OperationHandle、StructuredProblem 与 allowed actions。

### 3.3 `MOD-DATA`

DATA 仍拥有：

- candidate DB 的 ADR-04 copy/migrate/validate；
- activation DataSlot 的建立、格式/完整性/FK/WorkspaceId/Revision 验证；
- writer/readers/statements/iterators/Online Backup/validator drain；
- WAL checkpoint、活动 connection close、DataSlot retire/install/reopen；
- typed RestoreSession success/rollback receipt 与 old WorkspaceEpoch 拒绝。

PROTECT 不 raw-copy 活动 `.sqlite`/`-wal`/`-shm`，不直接执行 PRAGMA，也不推断 connection 是否安全关闭。

### 3.4 `MOD-LIBRARY`

LIBRARY 仍拥有：

- 当前 LibraryRootId、RootGeneration、marker、target eligibility 与 root health；
- candidate 的 PathKey 布局重建、marker、FileId/metadata closure；
- watcher stop/start、resource lease invalidation、root retire/install；
- reopen 后完整扫描、身份验证、对账和新设备 RootGeneration；
- old root 的 `sibling-rollback | preserved-in-place | absent` disposition。

PROTECT 不从文件名/mtime 猜测身份，也不直接启动 watcher 或提交索引。

### 3.5 `MOD-PLATFORM`

PLATFORM 只提供窄能力：

- local/same-volume/same-parent 与权限/空间能力判定；
- 安全枚举、lstat/containment、流式 copy、file sync/close；
- 目的地应不存在的 sibling rename、重新打开与 typed error；
- operation-owned quarantine/cleanup。

PLATFORM 不决定 checkpoint、成功、继续或回滚，不把 cross-volume 失败降级为 copy-delete。Main 只负责 ADR-02 的生命周期/进程监督，不理解这些物理动作。

## 4. `IF-RESTORE-SESSION`

唯一公共恢复接缝为：

```ts
interface RestoreSession {
  inspectBeforeWorkspaceOpen(): Promise<RestoreBootState>;
  execute(command: RestoreCommand): Promise<OperationHandle>;
  query(sessionId: RestoreSessionId): Promise<RestoreSessionView>;
}
```

`RestoreCommand` 是封闭 union：

```text
start(candidateRef)
choose-library-target(targetRef)
confirm(previewToken)
cancel-before-checkpoint
resume
rollback
```

规则：

1. `start` 携带 canonical `CommandId` 并幂等创建 RestoreSessionId/OperationId；其余 command 显式携带 RestoreSessionId、canonical `CommandId` 与 expected `SessionVersion`。OperationHandle 返回对应的 RestoreSessionId、OperationId 与可查询状态。
2. 同 CommandId + 同 canonical payload 的重试返回同一 OperationHandle/结果；不同 payload 复用返回 conflict。
3. `candidateRef`、`targetRef`、`diagnosticRef` 是不透明、短期、会话绑定引用；Shell DTO 不包含绝对路径。
4. `previewToken` 绑定 candidate identity/root digest、current state、target、protection mode、impact digest 与 SessionVersion。健康 current state 使用 WorkspaceId/Revision 与 LibraryRootId/RootGeneration；restricted-waived 使用显式 unavailable/damaged variant 和 owner 产生的 raw evidence fingerprint，不用空值或猜测 identity。
5. `query` 无副作用。`inspectBeforeWorkspaceOpen` 可以验证并追加唯一可证明的 observed/committed bookkeeping，但不得改变 DATA 或 Library。
6. 所有执行都返回 OperationHandle；不为“通常很快”增加同步物理 API。
7. 接口不暴露 `welcome | replace`、SQLite/WAL、DataSlot、journal sequence、进程 handle 或操作系统路径。

`RestoreBootState` 至少区分：

- `clear`：没有 nonterminal activation，可继续 FLOW-00；
- `pre-checkpoint-session`：原活动真相未改变；有旧工作区时可打开原工作区，没有旧工作区时保持 welcome，并显示 retry/cancel；
- `recovery-required`：普通打开禁止，包含 allowed `resume | rollback | diagnostic` 子集；
- `cleanup-pending`：已 committed，可正常打开新工作区，保护能力 degraded。

## 5. RestoreSession 与 checkpoint 前协议

### 5.1 状态机

稳定正常路径为：

```text
selected
  -> validated
  -> previewed
  -> confirmed
  -> protection-established
  -> staged
  -> stage-validated
  -> activation-checkpoint
  -> activated
  -> reopened/reconciled
  -> succeeded
```

辅助/终态包括：

```text
waiting-decision
cancelled
failed
recovery-required
rolling-back
rolled-back
cleanup-pending
```

`validated` 的 candidate-validation staging 来自 ADR-04：从 ADR-07 snapshot 复制数据库、执行支持的旧 schema migration、验证 candidate，但不修改 snapshot 原件。`staged` 则是 confirm 后在真实目标卷旁建立的 activation staging。两者不能共用“已经验证过”跳过目标位置的完整验证。

### 5.2 Library target

PROTECT 向 LIBRARY 取得 typed target plan：

| 当前/候选 | target 决策 | old disposition |
|---|---|---|
| 当前根健康、候选 Library present、父目录可安全切换 | 保持同一用户可见 root path；candidate stage 位于同父 sibling | `sibling-rollback` |
| 无当前根、当前根不可用或父目录不能安全切换；候选 present | 用户选择经 LocationAssessment、重叠、权限与空目录验证的新建/空本地 root；stage 位于其同父 sibling | 旧根若存在则 `preserved-in-place` |
| 候选 Library absent | 恢复结果明确无活动 LibraryRoot | 旧根若存在则 `preserved-in-place`，不删除用户文件 |
| 当前无根且候选 absent | 无 Library participant 的物理切换 | `absent` |

用户选择的空目标目录在 activation 时作为 target reservation 处理；需要保持路径时先安全退到 operation-owned sibling，再安装 candidate，rollback 恢复 reservation。任何父目录不可写、不可 rename、非本地、与活动/备份位置重叠或 same-volume 无法证明都在 checkpoint 前停止。

### 5.3 容量预检

PROTECT 按卷计算并显示保守峰值：

- 当前 DATA/Library；
- `RestoreSafetySetV1`；
- candidate validation/activation staging；
- 同卷 rollback/quarantine 与 journal overhead。

普通健康恢复可能接近三个完整数据集。声明 size 只用于早期拒绝；实际 copy 独立计数并在 checkpoint 前再次读取剩余空间。exact requirement 必须通过，one-over 必须 `storage-full`。不得删除 RestoreSafetySet、当前数据、最近两份已验证 snapshot、未知目录或其他 BackupSet 来强行继续。

### 5.4 confirm 与 maintenance

最终 `confirm(previewToken)` 成功受理后：

1. WORKSPACE 原子进入 maintenance 并推进 maintenance epoch；
2. 普通 command、FileOperation、backup、validator、scan 和新 restore preview 被拒绝；
3. 旧 resource preview/system-open lease、MessagePort 和 epoch 失效；
4. watcher 被停止或只收集不能提交事实的 dirty hint；
5. 已开始工作被 drain；状态与进度经 OperationHandle 查询；
6. activation checkpoint 前 `cancel-before-checkpoint` 可恢复原能力；
7. candidate、健康 current 的 revision/RootGeneration、restricted current 的 raw evidence fingerprint、target、权限、空间或外部事实变化时返回 `impact-changed`，退出本次确认并要求重新 preview。

不允许在 maintenance 中 merge current 与 candidate。

## 6. `RestoreSafetySetV1`

### 6.1 语义

健康当前工作区在 checkpoint 前必须产生一份完整、自包含、不可变且重新验证的 RestoreSafetySet：

- `SafetySetId` 与 RestoreSessionId 绑定；
- 使用独立 schema `courseflow-restore-safety-set-v1`；
- 包含 DATA Online Backup 产生的 source WorkspaceId/Revision 数据库；
- Library present 时包含当前 marker、全部 active/unassigned verified regular files 和与数据库一致的闭包；
- 使用 ADR-04 `courseflow-canonical-json-v1`、ADR-07 的成员 grammar、SHA-256、hostile validator 与 `SnapshotFormatLimitsV1`；
- 不含 BackupSetId、backupSequence、SnapshotId 或云盘目的地能力；
- 不发布到 backup destination，不计入最近两份 snapshot，不由 FLOW-04 retention 删除。

它可以作为以后新 RestoreSession 的本地候选，但不能在 succeeded 后绕过 select/validate/preview/confirm。

### 6.2 保护方式

`ProtectionModeV1` 为封闭 union：

- `required(SafetySetId)`：当前 DATA 与已配置 Library 均健康，完整安全集已验证；
- `not-required`：没有旧活动 DATA/Library 可保护；
- `restricted-waived(evidenceRef, warningVersion)`：旧 DATA 损坏/只读或已配置 Library 无法完整读取，因而不能形成完整安全集，但原始 DATA、Library 和诊断证据保持原位不变，稳定控制区域仍可写，用户确认独立警告。

`restricted-waived` 不是“忽略错误”：

- 不能修改、repair、checkpoint 或删除损坏的旧原件；
- candidate 必须完全独立 stage/validate；
- 旧证据不能可靠保留、ActivityControlRoot 不可写或容量不足时停止；
- warningVersion/protection mode 进入 preview token 与 ActivationPlan；
- rollback 只能使用实际可验证的 old artifacts 或安全集，不能把 raw evidence 冒充可恢复工作区。

### 6.3 保留

成功后：

1. 先重新验证安全集 identity/root digest；
2. 直到新工作区的第一份常规 ADR-07 snapshot 在其 BackupSet 中发布、final 验证并登记成功，安全集不得自动清理；
3. 达到该门后，它才成为 PROTECT 精确所有的 cleanup candidate；
4. 未配置 backup 时保留为 UI 可见的独立本地恢复点，只接受用户明确 cleanup；
5. cleanup 失败只产生 `cleanup-pending`；身份冲突、unknown、unverifiable 或未登记条目不自动删除。

## 7. 活动位置与 staging

### 7.1 稳定控制区域

ADR-10 将为每个平台选定绝对 app-local base path；ADR-08 规定逻辑布局和不变量：

```text
<stable app-local activity area>/
  <ActivityControlRoot>/                 # 永不随 DataSlot/Library 切换
    restore/<OperationId>/
      session/                           # checkpoint 前 bounded operation records
      safety/<SafetySetId>/              # 若 protection=required
      activation-plan-v1
      journal/
        <sequence>-<kind>-<recordDigest>

  <DataSlotsParent>/                     # 同一受支持本地卷
    <active DataSlot>
    <candidate sibling>
    <rollback sibling>
    <quarantine sibling>
```

约束：

- ActivityControlRoot 属于 app-owned activity control boundary，不是第四个用户选择的位置；
- 它必须在 DATA open 前可定位，跨正常软件更新稳定，并位于所有可交换 DataSlot 之外；
- 它不得位于 LibraryRoot、backup destination、known cloud/remote location 或会被恢复替换的目录；
- DataSlot 是一个完整目录，包含关闭的 `workspace.sqlite` 及 owner 认可的 sidecar 状态；不交换仍在使用的单个 DB 文件；
- 所有 operation-owned sibling 名称携带 OperationId/nonce，且开始前必须不存在或与同 operation 的已验证记录精确匹配；
- 用户路径不进入 Shell DTO、普通 projection 或 diagnostic export。

### 7.2 candidate staging

1. DATA 从已验证 candidate-validation 副本流式复制到 `<candidate DataSlot sibling>`，sync/close 后重新打开验证。
2. LIBRARY 从 snapshot raw members 重建到最终 target 同父的 candidate sibling；按 candidate DB 的 PathKey/映射创建目录，写 marker 与原始文件，逐项摘要并 full-enumerate。
3. candidate WorkspaceId 保持 snapshot 身份；恢复不是把候选 merge 到 current WorkspaceId。
4. candidate LibraryRootId 按 snapshot/marker 合法身份保留；RootGeneration 不跨设备复用，激活后产生新的当前设备值。
5. snapshot 中的绝对路径、BackupConfiguration/BackupSet capabilities、permission/object evidence、watcher/lease、preview cache 和外部 operation 前提不成为 staging capability。
6. staging 验证至少覆盖：database application/schema/integrity/FK/WorkspaceId/Revision、known operation/follow-up versions、marker、FileId/PathKey 集合、普通文件 bytes、无 extra/link/special、target containment 与 capacity。
7. staging 全部关闭，且重新检查健康 current 的 typed fingerprints 或 restricted current 的 raw evidence fingerprints 仍与 preview 一致后，才可准备 checkpoint。

## 8. `ActivationPlanV1` 与 activation journal

### 8.1 封闭 plan

`activation-plan-v1` 是无 BOM UTF-8、ADR-04 canonical JSON、严格 schema、不可变文件。它至少包含：

```text
schema: "courseflow-activation-plan-v1"
limitsVersion: "activation-journal-limits-v1"
operationId
restoreSessionId
sessionVersion
preCheckpointSessionDigest
candidate { snapshotId | safetySetId, rootDigest, sourceSchemaLevel,
            postMigrationSchemaLevel, workspaceId, revision }
protection { required(safetySetId, rootDigest) |
             not-required |
             restricted-waived(evidenceFingerprint, warningVersion) }
database {
  old: absent |
       validated(workspaceId, revision, slotFingerprint) |
       raw-evidence(evidenceFingerprint, reason)
  candidate: present(workspaceId, revision, slotFingerprint)
  privateLocations { active, candidateSibling, rollbackSibling, quarantineSibling }
}
library: absent |
  present {
    old: absent |
         validated(libraryRootId, rootGeneration, markerFingerprint,
                   closureFingerprint, disposition) |
         raw-evidence(evidenceFingerprint, reason, disposition)
    candidate: absent | present(libraryRootId, markerFingerprint,
                                closureFingerprint, target)
    postRestoreRootGeneration
    privateLocations { finalTarget?, candidateSibling?, rollbackSibling?,
                       quarantineSibling?, preservedOld? }
  }
versions { canonicalEncoding, databaseFormat, markerFormat, pathKeyEncoding,
           operationFormats, planVersion, journalVersion }
planDigest
```

`planDigest` 是 64 个 lowercase hex 字符：复制完整 plan object、删除 `planDigest` 字段，对其余对象执行 `courseflow-canonical-json-v1`，再计算 SHA-256。不得把该字段保留为空字符串，也不得对人类格式化后的文件 bytes 计算。

`privateLocations` 是本机恢复所需的内部 capability/fingerprint 记录，不进入公共 DTO/诊断。路径字符串本身不是身份；owner fingerprint、Workspace/Root identities、closure digest 与现场验证共同决定动作合法性。mtime、标题或目录顺序不得代替 identity。

v1 participant set 固定为 database 与 optional library。`library: absent` 只表示发行物没有 Library participant；Library participant 内的 candidate/old `absent` 表示本次恢复结果或旧状态没有根。不得在 v1 plan 添加 unknown participant、任意 action DAG、动态 hook 名称或脚本。

### 8.2 journal record

每个 activation record 为独立 canonical JSON，至少包含：

```text
schema: "courseflow-activation-journal-record-v1"
operationId
sequence
kind
previousRecordDigest
planDigest
expectedFingerprints
observedFingerprints
createdAt
recordDigest
```

规则：

1. `sequence` 是从 1 开始、连续、不可复用的 canonical 正整数；`createdAt` 只供显示，不排序。
2. `recordDigest` 是 64 个 lowercase hex 字符：复制完整 record object、删除 `recordDigest` 字段，对其余对象执行 `courseflow-canonical-json-v1`，再计算 SHA-256；不得保留空值或 hash 人类格式化 bytes。
3. 第一条 record 的 `previousRecordDigest` 必须为显式 `null`；后续必须等于上一条 record 的已验证 `recordDigest`，形成 hash chain。
4. 文件名包含 sequence、kind 与 recordDigest；文件名只用于早期筛选，内容验证才是事实。
5. 发布顺序为：唯一 temp → write exact bytes → file sync → close → 同父目的地应不存在的 publish/rename → reopen → strict parse/canonical bytes/digest/chain revalidation。
6. CourseFlow 单实例 + 单 nonterminal activation 串行写入。目标意外存在、身份不同、publish 结果不明或 post-open 不匹配都停止；不得覆盖未知记录。
7. 每个物理动作前必须有 `intent-*`，动作后由磁盘 owner 重新观察并写 `observed-*`。响应丢失时重试先观察，不能盲目再次 rename。
8. 只在观察结果唯一匹配 intent 的 expected before/after identity 时，启动可以补记缺失 `observed-*`。
9. unknown kind/version/key、sequence gap/duplicate/conflict、hash break、plan mismatch 或额外 nonterminal journal 使 Workspace recovery。

### 8.3 limits

`ActivationJournalLimitsV1` 是包含端点的 trust boundary：

| 项目 | v1 上限 |
|---|---:|
| `activation-plan-v1` raw bytes | 256 KiB = 262,144 bytes |
| 单条 journal record raw bytes | 64 KiB = 65,536 bytes |
| 一个 OperationId 的 session + activation records 合计 | 256 |
| 同一 ActivityControlRoot 的 nonterminal activation | 1 |

parser 还必须使用 ADR-04 的 canonical integer/string/UUID grammar、拒绝 BOM/无效 UTF-8/duplicate 或 unknown field、限制 JSON depth/字符串长度，并在分配大量内存、打开 SQLite 或递归扫描前先做可得的 size/version 检查。exact-limit 通过，one-over 停止；不 compact、截断或跳过旧 record。

checkpoint 前 `session/` 使用独立的 `courseflow-restore-session-control-v1` append-only hash chain，并复用 journal 的 unique-temp/sync/close/non-overwrite-publish/reopen 验证程序、64 KiB 单记录上限与同 operation 总记录上限；最后一条 session digest 冻结进 ActivationPlan。session record 只保存候选/target/preview/protection/phase 的有界 bootstrap evidence，不能授权任何物理 activation action。健康 DATA 可用时，ADR-04 要求的 typed RestoreSession/Operation tables 仍保存语义状态；ActivityControlRoot 中的 session record 只是让 welcome、损坏/只读 DATA 和启动检查都可定位同一 operation 的 bootstrap mirror，不以通用 JSON payload 代替 DATA typed tables。两边身份/SessionVersion 不一致时重新验证或停止，不能任选一边。`armed` 后全部必要状态冻结进 ActivationPlan，plan + activation journal 成为跨 DATA/Library 的唯一物理协调真相，不能回退到活动数据库中的旧 RestoreSession phase。

## 9. activation checkpoint 与交换顺序

### 9.1 checkpoint 前最终门

在写 `armed` 前必须全部成立：

1. previewToken、candidate、target，以及健康 current 的 revision/RootGeneration 或 restricted current 的 raw evidence fingerprint 仍有效；
2. required RestoreSafetySet 已完整验证，或 restricted-waived/not-required 仍满足；
3. candidate DATA/Library target-bound staging 完整关闭并验证；
4. per-volume capacity、权限、same-parent/same-volume、目标/reservation/rollback sibling identities 重验；
5. WORKSPACE maintenance 生效，普通命令和 lease 已拒绝；
6. DATA writer/read transaction/statement/iterator/Online Backup/validator drain 完成，WAL checkpoint 结果通过，活动 DB 关闭；
7. LIBRARY FileOperation 已收敛、watcher 停止，最终完整 fingerprint 与 preview 一致；
8. `ActivationPlanV1` 写入、sync/close、发布、重开并验证；
9. 没有另一 nonterminal activation 或未知 control artifact。

随后写入并重验 `armed`。`armed` 是 activation checkpoint：从此任何启动都先进入 recovery inspection，普通 DATA/Library 不得打开。

任一门失败都停在 checkpoint 前；活动真相保持原样，清理只处理本 operation 精确登记且可验证的 staging。

### 9.2 正向动作

对每步都执行 `intent → owner action → disk observation → observed`。按 plan variant 跳过不适用动作，但 absent/preserved 结果必须显式记录：

1. **retire old Library**
   - same visible target：当前 root rename 到 rollback sibling；
   - new target 或 candidate absent：旧 root 保持原位且标为 `preserved-in-place`，不跨卷搬、不删除；
   - no old root：记录 absent。
2. **install candidate Library**
   - candidate present：若目标是既有空 reservation，先把 reservation 安全退到 sibling；candidate sibling rename 到 final target；
   - candidate absent：记录 post-restore Library absent。
3. **retire old DATA**
   - active DataSlot present：rename 到 rollback sibling；
   - no active DATA：记录 absent。
4. **install candidate DATA — commit-last**
   - candidate DataSlot sibling rename 到 canonical active DataSlot；
   - reopen 前只做现场 identity observation，不启动普通 Workspace。
5. 全部 after fingerprints 与 plan 一致后写 `candidate-installed`。

中间任何时点都可能同时存在 old rollback、candidate final 或空 canonical slot；外部 journal 是阻止混合打开的门。不存在“Library rename 成功就部分提交”或“DATA 已装上就返回成功”。

### 9.3 不声称的属性

- 每个 sibling rename 只给一个 namespace action 的可见性，不形成跨资源事务；
- file sync、close、rename 和 reopen 不等于所有硬件/文件系统上的绝对断电持久；
- CourseFlow 不使用 TxF、cross-volume move、copy-delete fallback、database-attached 伪 2PC 或云盘事务；
- v1 的可验证承诺是 process kill/crash/restart 下的确定性 recovery；G6/G7/ADR-10 必须报告真实 packaged platform/power-loss evidence。

## 10. 启动检查与恢复矩阵

### 10.1 启动算法

在 spawn/打开活动 DATA 或解释 LibraryRoot 前：

1. 定位稳定 ActivityControlRoot；不可定位/读取且已知存在 nonterminal operation 时返回 `recovery-required`；
2. 枚举精确登记的 restore operation；检测多 nonterminal activation；
3. 对 plan/records 先检查 raw size、版本、UTF-8/canonical/schema，再检查 plan digest、sequence/hash chain；
4. 请求 DATA/LIBRARY/PLATFORM 以只读方式观察 plan 中 active/candidate/rollback/quarantine/preserved locations；
5. 比较 expected/observed fingerprints，不用 mtime 猜测；
6. 若一个缺失 observed/committed record 可由唯一物理结果证明，追加并重验该 bookkeeping；
7. 产生 RestoreBootState 与 allowed actions；
8. 只有状态 clear/committed，才允许 FLOW-00 打开唯一 DATA pair；watcher 在 DATA/Library 验证和普通路由之后启动。

inspection 不 repair SQLite、不 move/copy/delete DATA/Library，也不为了“继续启动”跳过 unknown record。

### 10.2 决策矩阵

| journal / 磁盘状态 | 启动结果 | 自动允许 | 用户动作 |
|---|---|---|---|
| checkpoint 前 session 中断；旧 DATA/Library 完整或原本不存在旧工作区 | 有旧则打开旧工作区，无旧则保持 welcome；restore operation 显示可重试/取消 | 标记/补记安全的 pre-checkpoint 状态 | retry 或 cancel |
| `armed`，尚无 swap | recovery | 只读检查/补 observed | resume 或 rollback |
| 部分 swap，before/after identities 唯一 | recovery | 补记缺失 observed | resume 或 rollback |
| candidate installed，尚未重开/对账 | recovery | 只读验证 | resume；旧/安全集有效时 rollback |
| candidate DATA 有 matching success receipt，plan/磁盘/最后 precommit record 全匹配，外部 terminal 丢失 | 完成 committed 后普通启动 | 追加/re验 `committed` | 无 |
| candidate invalid，old 或 SafetySet valid | recovery，推荐 rollback | 不做物理 rollback | rollback |
| old invalid，candidate valid | recovery，推荐 resume | 不做物理 resume | resume |
| old/candidate/safety identities 冲突、journal 损坏/越限/未知版本、物理结果无法唯一分类 | diagnostic recovery | 无 | diagnostic；不猜测 |
| committed，只有 transient cleanup 失败 | 正常打开新工作区，PROTECT degraded | 重试无歧义 cleanup 可以是后台 operation | retry cleanup |

外部 `committed` 存在但 candidate DATA success receipt 缺失/不匹配是 identity conflict，不能按 terminal 文件单独宣称成功。

## 11. 重开、成功回执与完成边界

`candidate-installed` 后仍处于 maintenance：

1. WORKSPACE 分配新的 candidate WorkspaceEpoch；
2. DATA 打开 canonical candidate slot，验证 `application_id`、schema level、integrity、foreign keys、WorkspaceId、candidate/post-migration Revision、operation/follow-up versions 与 RestoreSession；
3. LIBRARY 对 final target 执行完整扫描，验证 marker、LibraryRootId、candidate FileId/PathKey/bytes closure，并提交新的当前设备 RootGeneration；candidate absent 必须验证 DATA 声明和物理 target plan 一致；
4. 失效 snapshot 中的绝对路径、旧 RootGeneration、BackupConfiguration/BackupSet destination capability、permission/object evidence、watcher/resource lease、preview session 与不再安全的外部 operation precondition；
5. 在 maintenance 内运行 FLOW-00 的 candidate 验证/路由计算，得到 SetupProgress、Current Term、health 与 welcome/setup/today 目标；此时不向普通 Shell 暴露 ready；
6. DATA transaction 持久化 typed `RestoreSuccessReceiptV1`；
7. PROTECT 追加并重验 external `committed` record；
8. WORKSPACE 才退出 maintenance，以新 epoch 和已计算 route 对外返回 succeeded。

`RestoreSuccessReceiptV1` 至少包含：

- OperationId、RestoreSessionId；
- source SnapshotId 或 SafetySetId 与 root digest；
- source schema level、post-migration schema level、final actual Revision；
- activated WorkspaceId；
- Library `absent | present(LibraryRootId, RootGeneration, closure fingerprint)`；
- target plan digest；
- ProtectionMode/SafetySetId；
- 最后一条 precommit journal sequence/digest（通常为 `candidate-installed`）；
- route 与需重新配置的 capability 摘要；
- receipt format/version 与 receipt digest。

receipt 不包含真实路径。它引用 precommit journal digest，随后 `committed` record 再引用 receipt digest，避免循环。若 receipt 已提交而 `committed` 丢失，启动可在全部 plan/磁盘证据匹配时补记 terminal；反向不匹配必须 recovery。

## 12. rollback

rollback 只在 activation checkpoint 后、succeeded 前执行；checkpoint 前使用 cancel。

按 write-ahead journal：

1. candidate Library final 移到 operation-owned quarantine，或验证 candidate absent；
2. `sibling-rollback` old Library 恢复到原 final；`preserved-in-place` old Library 只重验原位；若 old artifact 不完整但 RestoreSafetySet valid，则从安全集在目标卷重新 stage/validate 后恢复；
3. candidate DATA active slot 移到 quarantine；
4. old DATA rollback sibling 恢复到 canonical active slot；若不完整则从 RestoreSafetySet 重建目标 sibling，再 commit-last 安装；
5. 如果原先没有活动 DATA，canonical active 保持 absent，结果路由 welcome；
6. 若 old DATA present，则打开/验证 old DATA、重建 old current-device epoch，Library 重新取得 RootGeneration、完整对账并启动 FLOW-00；若 old DATA absent，则验证 canonical active 仍 absent 并完成 welcome 路由；
7. 写 rollback receipt 与 external `rolled-back`，然后才退出 recovery。

任一动作仍使用 intent/observed；candidate quarantine 在 rollback 完成前不删除。证据不足、old/safety 均不可验证或结果不唯一时保持 recovery，不做 copy-delete、就地 repair 或“选择看起来较新的一边”。

succeeded 后不会保留可绕过新恢复的 rollback command。RestoreSafetySet/旧数据若仍存在，只能作为下一次 `start(candidateRef)` 的候选，重新走验证、目标、preview、confirm、maintenance 与 activation。

## 13. cleanup

### 13.1 可自动管理

PROTECT 只可处理本 operation 精确登记且 identity/root digest 一致的：

- candidate/rollback/reservation sibling；
- failed candidate quarantine；
- terminal session/plan/journal 的受管保留副本；
- 已满足 §6.3 门的 RestoreSafetySet。

开始 transient cleanup 前必须再次验证 succeeded/rolled-back receipt、external terminal 与仍需保留的 RestoreSafetySet。cleanup 使用 operation-owned quarantine 与可恢复删除；失败记录 `cleanup-pending`，不回滚已证明的成功。

### 13.2 不自动管理

以下永不自动删除：

- `preserved-in-place` 的原用户 LibraryRoot；
- unknown/unregistered/identity-conflict/unverifiable 条目；
- 仍是唯一 rollback/safety evidence 的副本；
- 其他 RestoreSession、BackupSet 或用户目录；
- 未配置 backup 时尚未由用户明确选择 cleanup 的安全恢复点。

## 14. Problem 与诊断边界

复用现有稳定 public ProblemCode，不把每个物理动作变成 Shell API：

| 时点 | public code |
|---|---|
| checkpoint 前 | `impact-changed`、`permission`、`storage-full`、`staging-failed` |
| checkpoint 后 | `activation-pending`、`rollback-required`、`identity-conflict`、`incompatible-version`、`recovery-required` |
| succeeded 后 | `cleanup-pending` |

每个 StructuredProblem 必须准确给出 scope、dataEffect、affectedCapabilities、allowedActions、RestoreSessionId/OperationId 和 diagnosticRef。Shell 只按这些字段呈现。

ADR-08 的最小 diagnostic payload 可以包含：

- plan/journal/receipt format version；
- OperationId/SessionId 的受控表示；
- public code 与内部非路径 subcode；
- 最后已验证 sequence/kind、expected/observed state category；
- participant kind、计数/size bucket、耗时、platform/runtime version；
- integrity/permission/capacity/identity check 的布尔/枚举结果。

不得包含真实路径、课程/文件名称、PathKey、文件内容、数据库行、标签、URL、token 或原始系统错误文本；不得自动上传。保留期限、用户导出与 redaction 格式由 ADR-09 决定。

## 15. 失败注入与验收证据

实现不得只测 happy path。至少覆盖：

### 15.1 candidate、目标与保护

- verified/incomplete/corrupt/old/current/future/unknown snapshot；
- ADR-04 migration 每步失败、原 snapshot bytes 不变；
- current Library 健康同路径、无根、不可用、父目录不可 rename、candidate absent、新建/空目标、目标在另一卷；
- current DATA/Library 健康、只读、损坏、权限中途撤销；
- required/not-required/restricted-waived；
- safety member/manifest/closure 任一步失败；
- candidate/current/安全集每卷 capacity exact 与 one-over；
- confirm 后健康 current 的 revision/RootGeneration、restricted current 的 raw evidence、target、权限或外部文件变化；
- checkpoint 前 cancel 与响应丢失。

### 15.2 maintenance 与 SQLite

- 普通 command/FileOperation/backup/new preview 被拒；
- watcher hint 不提交，旧 lease/epoch 不可用；
- 未结束 read transaction、statement、iterator、Online Backup、validator；
- WAL checkpoint busy/error、close/sidecar/slot verification failure；
- maintenance 重启和 long-operation progress。

### 15.3 plan/journal

- plan/record raw limit exact/one-over；
- invalid UTF-8/BOM/noncanonical/duplicate/unknown field/depth/string limit；
- plan/record digest golden vectors：digest 字段整体省略而非空值、lowercase-hex、首 record 的 `previousRecordDigest=null` 与后续链；
- sequence gap/duplicate/conflict、hash-chain break、plan digest mismatch；
- record temp/write/sync/close/publish/reopen 每个 failpoint；
- 相同 CommandId/response loss/idempotent observed；
- 两个 nonterminal activation；
- journal/plan/receipt old/current/future version；
- control root permission/full/unavailable；
- journal 本身丢失或损坏，不回退 mtime/猜测。

### 15.4 physical activation

对每个 intent 前、rename 中/后、observed 前/后 kill：

- old Library sibling retire；
- empty target reservation retire；
- candidate Library install/absent；
- old DATA retire；
- candidate DATA commit-last install；
- candidate-installed；
- DATA reopen/integrity/FK/identity；
- Library marker/full reconcile/new RootGeneration；
- device capability invalidation；
- success receipt transaction；
- external committed；
- rollback 每个对称动作；
- candidate quarantine 与 cleanup。

还要覆盖目录被外部程序持有、Windows rename 拒绝、外部修改、same-volume 判断变化、cross-volume 明确拒绝，以及启动时缺 observed 但物理结果唯一/不唯一。

### 15.5 lifecycle

- welcome 无 old DATA/Library 的 success/rollback-to-welcome；
- settings restore 的 old/safety rollback；
- receipt 已有/committed 丢失自动补记；
- committed 有/receipt 缺失保持 conflict；
- succeeded 后旧数据必须新 RestoreSession；
- 第一份恢复后常规 snapshot 前/后安全集保留；
- no backup 的 explicit cleanup；
- transient cleanup failure 正常启动 + PROTECT degraded；
- unknown/preserved-in-place old root 不自动删除。

G6 必须在签名/打包的目标 macOS 与 Windows 运行相同行为；G7 必须版本化参考 workspace/device，测量 candidate validation、copy/hash、maintenance 时长、journal fsync/rename、reopen/reconcile、resume/rollback、峰值 RSS/磁盘与 recovery time。未运行的平台、filesystem 或 power-loss 条件必须明确报告，不能推断通过。

## 16. 被拒绝的方案

### 16.1 在活动数据库中保存唯一 activation journal

DATA 自己会被 retire/install；只在旧或新 DB 中的 journal 无法在 swap 中始终可见，会产生“先打开哪一个才能知道该打开哪一个”的循环。拒绝。

### 16.2 先提交 DATA，再异步迁移 Library

会把新结构化事实配旧 Library 暴露为正常状态，违反无部分成功。普通 DurableFollowUp 适合可独立失败的后续动作，不适合整库恢复。拒绝。

### 16.3 cross-volume move/copy-delete

Node copy 非原子，Windows 明确可 copy 成功而 delete 失败；会破坏旧证据与 rollback。只允许 checkpoint 前 copy 到目标卷 staging。拒绝。

### 16.4 单一 current pointer

指针可以原子选择一个 plan，但 DATA 和 Library 的物理路径仍可能部分完成；所有普通打开者还必须遵循外部协调。额外 pointer 不消除 journal，反而增加第三份可能冲突的真相。v1 拒绝。

### 16.5 generic 2PC、resource DAG、plugin/hooks

当前没有第三类共同激活资源，文件系统 participant 也不能提供真正 prepare/commit isolation。通用框架扩大 wire/state/test/compatibility 表面。v1 使用封闭 typed plan；未来正式升级 V2。拒绝。

### 16.6 成功后保留一键 rollback

成功后用户可能已产生新提交/文件，旧 rollback sibling 不再是安全的反向操作；它会绕过 preview 和当前事实检查。只保留 RestoreSafetySet 作为新恢复候选。拒绝。

### 16.7 自动 repair/猜测

mtime、目录名、单个 marker、单边 receipt 或“看起来能打开”不能证明完整 pair。未知/冲突/无法分类只给 diagnostic，不重置、repair、删除或择新。拒绝。

## 17. 后果

### 17.1 正面

- crash 后始终有一个不随参与者切换的协调入口；
- welcome/settings 共用同一深接口，物理复杂度不泄露给 Shell/Main；
- 每个 rename 的前因/后果可检查，响应丢失可幂等收敛；
- DATA commit-last 与启动门阻止混合 pair 被当作正常工作区；
- safety、rollback、success 和 cleanup 生命周期可证明；
- v1 只实现当前两个资源，格式版本又为未来正式扩展留门。

### 17.2 成本

- 普通恢复可能需要约三份完整数据的峰值空间；
- confirm 后存在可见 maintenance 窗口，Library 全量复制/对账可能较长；
- append-only journal、fingerprint、failpoint 和两平台验证增加实现/测试工作；
- `ActivityControlRoot` 与 DataSlot 稳定布局成为 ADR-10 的发布约束；
- Windows/macOS 的目录占用与持久化差异不能靠单元测试完全证明。

这些成本来自真实数据安全边界，不能通过隐藏部分成功、跨卷 copy-delete或把 rename 称为全局事务来消除。

## 18. 演进与重新评审

### 18.1 `ActivationPlanV2`

未来新增共同激活资源时，不得给 v1 plan 添加 unknown key 或动态 hook。新 ADR 必须定义 V2：

1. resource owner 与稳定 identity；
2. old/candidate/absent variants 和 target policy；
3. safety closure 与 capacity；
4. stage/full validation/fingerprint；
5. commit order 与为何不破坏 DATA commit-last；
6. rollback/quarantine/startup classification；
7. preview/confirmation/maintenance/diagnostic；
8. v1 read/recovery compatibility；
9. Requirement/FLOW/Q/TEST 与两平台 evidence。

未知 future plan/journal/receipt 只能返回 `incompatible-version`/recovery，不猜测执行。

### 18.2 重新评审条件

以下任一条件触发 ADR-08 重开：

- 产品批准自动 merge、多活动 workspace 或多 active Library roots；
- 活动真相迁移到远程/多设备后端；
- 威胁模型要求抵御恶意本地 actor，而非当前本机用户/非恶意外部程序；
- 目标平台不能可靠提供所需 sibling swap、控制记录发布或启动前稳定控制位置；
- 新资源必须与 DATA/Library 共同激活；
- 产品改变 safety 保留、success、rollback 或无部分成功承诺；
- packaged failpoint/power-loss evidence 证明当前 journal/flush/order 不足。

### 18.3 仍待其他 ADR

- `ADR-TOPIC-09`：诊断事件格式、保留、用户导出、redaction 与隐私；
- `ADR-TOPIC-10`：ActivityControlRoot/DataSlotsParent 的绝对平台路径、bundled Electron/Node/SQLite、代码签名、公证、安装/更新、平台 filesystem capability 与 packaged G6/G7 gate。

## 19. 覆盖审阅结论

在接受本 ADR 前已读完当时仓库全部 31 个 Markdown 文档，并按规范所有权更新产品、User Flow/UI、Architecture、Contracts 与测试追溯。审阅结果：

- `A-DATA-005/006` 的手动选择、验证、预览、显式替换、不 merge 和失败语义全部覆盖；
- `B-FILE-012` 的数据库 + Library 完整闭包在 staging、安全集、激活与重开保持；
- `STATE-002` 在 checkpoint 前/后准确区分 dataEffect；
- `NFR-002/003/007` 的可恢复写入、三位置/安全集边界和确认绑定得到具体机制；
- `NFR-001/006/010` 的离线、键盘/文字状态与文件系统降级不被破坏；
- WORKSPACE/PROTECT/DATA/LIBRARY/PLATFORM 所有权保持单向，Shell 不绕过 IF-WORKSPACE；
- FLOW-00/03/04/05 的启动、对账、常规备份与恢复生命周期没有混成一个通用事务；
- 既有 ADR-01–07 的 runtime、process、SQLite、schema、Library、preview 和 snapshot 决策均未被改写；
- 未来扩展使用 V2 + 新 ADR，不预建 `EXT-*`、plugin、DAG 或兼容 fallback。

未发现必须新增产品 Requirement ID 或 top-level Module 才能满足当前范围；未决的 `GAP-PRODUCT-01` near-due 数值与 ADR-08 无关。

## 20. 实际检查与实现边界

- 已审阅全部现有规范、ADR、research、Superpowers 记录和归档 `ATTEMPT.md`；后者未作为依据。
- 已检索并引用 SQLite、Node/libuv、POSIX、Apple 与 Microsoft 一手资料。
- 已用三种独立模块边界方案进行 Design It Twice 比较，并选择深 Restore Module。
- 已逐层完成 Requirement → MOD → IF → FLOW → Q → TEST 覆盖审阅。
- 当前没有运行应用、Electron packaged build、真实 APFS/NTFS、kill/power-loss 或性能实验；§15 列出的是实现后必须提供的证据，不是已通过结果。
- 本 ADR 不授权实现、implementation plan、新依赖、ADR-09 或 ADR-10。
