# ADR-07 快照格式、完整性与发布方式设计讨论记录

> 状态：讨论已由用户逐项、逐段确认
> 日期：2026-08-20
> 方法：Superpowers brainstorming + primary-source research + Ponytail dependency check
> 权限：非规范性过程记录；技术结论以 [ADR-07](../../architecture/adr/ADR-07-snapshot-format-integrity-publication.md) 为唯一真相

## 1. 讨论目标

本轮在 ADR-01–06 已接受的边界内决定 `ADR-TOPIC-07`，重点回答：

- SQLite actual revision 与无法事务冻结的 Library 文件如何形成完整 checkpoint；
- 快照采用目录、archive 还是共享对象，如何处理同步器只上传部分内容；
- manifest 如何 canonicalize、摘要和限制不可信输入；
- staging、rename、final validation、成功水位与崩溃如何收敛；
- 同一 Workspace 的不同设备/配置如何避免互相清理；
- 保留多少快照、如何安全清理、空间不足时保护什么；
- 损坏、未同步、不兼容和未知条目如何区分；
- 正常软件更新如何继续读取既有快照，以及哪些边界留给 ADR-08/09/10。

## 2. 决策前审阅

作出 ADR-07 选择前，已重新枚举当时仓库中的 99 个非 Git 文件。全部 Markdown 与 HTML 原型均按规范层级和可见产品语义审阅；ignore/runtime-state 只核对路径、大小和摘要，不读取或披露 token/port。随后新增的一手研究记录也在决策前完整审阅。`ATTEMPT.md` 仅作为归档旧实现证据，不继承其技术栈、需求或兼容承诺。

重点追溯了 `A-DATA-002–006`、`B-FILE-012`、`STATE-002`、`NFR-003`、`UI-DATA-01/02`、`MOD-PROTECT/DATA/LIBRARY/PLATFORM`、`IF-BACKUP-CHECKPOINT`、`IF-DATA-EXPORT`、`IF-LIBRARY-MANIFEST`、`FLOW-04/05`、适用 Q、`TEST-PROTECT-001–006`、`TEST-DATA-004/006`、`TEST-LIBRARY-001–006` 与 G2/G4/G5/G6/G7。

一手资料研究位于 [ADR-07 研究记录](../../research/adr-07-snapshot-format-integrity-publication-research.md)，覆盖 SQLite Online Backup/PRAGMA、Node fs/crypto/randomUUID/zlib、POSIX rename、Windows MoveFileEx/FlushFileBuffers/cache、Apple fsync、NIST SHA-256、RFC 8785 canonical JSON 与 ZIP APPNOTE。研究只引用官方规范、平台/项目文档或上游资料，没有把搜索摘要或旧项目实现当作证据。

## 3. First Principles 与方案比较

讨论先固定五个不可破坏边界：

1. 用户结果是“成功快照可以独立验证并进入显式恢复”，不是在云盘中维护活动数据库或实时同步协议；
2. 本地保存成功与异步备份结果分离，备份失败不能回滚本地事实或破坏上一份好快照；
3. DATA、LIBRARY 和 PROTECT 各自保留事实所有权，快照必须证明跨边界闭包而不是复制活动文件；
4. 目录、manifest 或成员先到达另一设备都不能冒充完整；所有候选按不可信输入验证；
5. 完成必须能通过 exact format limits、每阶段 failpoint、两平台打包环境、partial cloud、更新兼容和 G7 证据判定。

在此基础上比较了三种物理方案：

1. 每个 SnapshotId 一份无压缩 immutable directory；
2. 单一 ZIP/压缩 archive；
3. content-addressed chunks + manifest pointers。

用户接受第 1 种。它可以用 Node core 流式复制/摘要、保留 SQLite 与用户文件原始 bytes、直接枚举不完整云同步，且不需要 extractor、Zip64、bomb 或共享对象 GC。第 2 种不会让远端上传原子，却增加 archive writer/extractor 与压缩版本；第 3 种会引入引用/回收事务和 corruption fan-out，当前没有去重/增量需求。

Ponytail 依赖检查据此不批准新依赖：v1 使用现有 Node core `fs`、`crypto` 和 DATA 的 `node:sqlite`；canonical encoder 复用 ADR-04 的项目内受限实现。没有 ZIP/TAR、compression、cloud SDK、hash/UUID/canonical JSON package 或 native addon。

## 4. 用户逐项确认

用户逐项接受并确认：

1. 任一 Library 必需文件 missing、unverified 或复制期间变化时停止整份 snapshot；MVP 不提供部分快照。
2. v1 只使用 checksum；不增加签名、加密、密钥、账户或恢复政策，也不把 SHA-256 称为认证。
3. 每个 Workspace 的每个 BackupSet 保留最近两份 verified automatic snapshots；后续 [ADR-10](../../architecture/adr/ADR-10-packaging-signing-update.md) 只在真实前向 migration 前创建的 safety copy 使用独立生命周期。
4. 物理格式为 uncompressed immutable directory，不使用 archive、压缩或共享 object store。
5. PROTECT 拥有 manifest、发布与 retention；DATA 提供 Online Backup；LIBRARY 提供完整 verified closure；PLATFORM 只提供窄文件系统能力。
6. 受管理目录按 repository → WorkspaceId → BackupSetId → staging/final 分层；SnapshotId 使用 UUIDv4，候选在正式发布前不获得正式身份。
7. 快照包含完整数据库副本、Library root marker raw bytes、所有 active/unassigned verified regular files，以及数据库中的元数据/operation/follow-up；排除 preview/cache/lease、外部路径/文件、link/special 和临时恢复产物。
8. manifest 使用 `courseflow-snapshot-manifest-v1` 与 ADR-04 canonical encoder；raw bytes 必须等于 strict parse 后的 canonical 重编码，拒绝 duplicate/unknown/非 canonical 表达。
9. 每个 member 使用 SHA-256；root digest 排除且只排除自身 value 后计算。snapshot/manifest/limits、DB schema、module、marker/PathKey、operation/follow-up 是独立兼容轴。
10. `SnapshotFormatLimitsV1` 固定为 64 MiB manifest、100,000 Library files、100,002 members、1 TiB total raw bytes、PathKey 128 components/32 KiB canonical UTF-8、manifest 任一 string 32 KiB；上限是 trust boundary，不是性能承诺。
11. 引入每项本地持久备份配置的 BackupSetId，避免不同设备/配置按时间戳或 WorkspaceId 互相清理；backupSequence 在集合内单调且允许间隙。
12. 发布顺序为持久 operation → DATA actual R → Library copy/revalidation → staging full validation → same-parent rename → final full validation → success record/watermark；rename 后、记录前崩溃由启动幂等补记或保持 recovery。
13. file sync/close 是前置条件；父目录 metadata flush 只在平台支持时 best-effort，不能承诺绝对掉电耐久。备份成功只表示所选目录本地发布并验证，不表示云盘上传完成。
14. operation 阶段固定为 `queued → database-checkpoint → library-copy → staging-validation → publishing → published-pending-record → succeeded`，另有 failed/recovery-required。
15. disk-applied/reconciliation/root cutover/recovery-file 阻止快照。planned/waiting-decision 可保存，但恢复后外部路径/证据失效，只能重验、决定或取消；未知 operation/follow-up version 不兼容。
16. retention 只在新 snapshot 与水位成功后启动；只清理同一 BackupSet、本机精确登记且 verified 的旧 snapshot。先同父目录 rename 到 operation-owned quarantine，再可恢复删除。
17. cleanup 失败不回滚成功；unknown/other BackupSet/unregistered/unverifiable/identity conflict 不自动删除；storage full 不删除最后或倒数第二份好快照强行成功。
18. 候选状态区分 `verified`、`incomplete-or-sync-pending`、`corrupt`、`incompatible` 和 `unknown-entry`；不按目录时间自动选最新。
19. snapshot 始终是不可信输入：lstat/realpath/containment、links/reparse/special/extra/duplicate、limits、members、hash、SQLite、marker 和闭包必须重新验证；验证期间不 execute/preview/system-open。
20. 只有 verified raw snapshot 到 ADR-08；ADR-04 staged migration 和 ADR-08 activation 均不修改备份原件。未来签名、加密、archive/compression、incremental/dedupe/shared objects 需要新格式和 ADR。

用户随后逐段确认了：所有权/目录/闭包、manifest 与精确上限、checkpoint/发布/成功语义、operation/retention/候选状态，以及 hostile validation/软件更新/测试与后续边界。

## 5. 审阅中发现并补回的上游行为

现有产品规范只要求“带版本和完整性信息的快照”，没有回答四项会直接改变用户预期的行为：

- 一个资料库文件失败时是部分快照还是整份失败；
- 保留多少份，以及不同设备/配置是否互相清理；
- “备份成功”是否暗示云盘上传完成；
- 同步中或不完整、明确损坏、不兼容和未知条目如何显示。

讨论确认了完整失败、每 BackupSet 最近两份、本地发布成功边界和五类候选状态。因此先同步 PRD、MVP Scope、User Flow 与 UI 规格，再同步 Architecture 的所有权/Q/FLOW/ADR 状态和 Module Contracts 的 IF/Problem/TEST。正式 ADR 只保存满足这些行为的技术选择，没有把产品语义埋入实现细节。

审阅还发现以 WorkspaceId 作为唯一 retention 边界会使两个设备或重新建立的配置互相删除。BackupSetId 因此被加入上游事实/身份模型；它不是同步协议，也不改变 MVP 不做自动合并的边界。

落盘自审又发现当前 BackupOperation 本身会被 SQLite Online Backup 复制进正在生成的 `workspace.sqlite`。为满足用户已确认的“恢复不得盲目重放外部 operation”边界，正式 ADR 将 database/library/validation 阶段定义为已完成阶段标记：Online Backup 期间副本只看到没有 source/final 效果、最多拥有可丢弃 staging 的 `queued`，活动库在副本关闭并验证后才推进 `database-checkpoint`；`publishing` 则是 rename 前的持久意图。这只消除自引用的可重放物理状态，不改变已确认的状态集合、成功边界或模块所有权。

## 6. 产物与后续边界

- 规范性技术决议：[ADR-07](../../architecture/adr/ADR-07-snapshot-format-integrity-publication.md)
- 一手资料与时效风险：[研究记录](../../research/adr-07-snapshot-format-integrity-publication-research.md)
- ADR 状态索引：[Architecture §12](../../architecture/ARCHITECTURE.md#12-adr-主题与变更规则)
- 逻辑接口、FLOW、Problem 与 TEST：[Module Contracts](../../architecture/MODULE_CONTRACTS.md)

本记录不复制 manifest wire schema、digest preimage、目录 grammar 或 cleanup algorithm，以免形成第二份技术真相。当前没有授权进入实现、选择具体 runtime/package 版本、编写 implementation plan 或提交 Git；下一项 ADR 必须重新从适用上游语义、未决边界、一手资料与逐项确认开始。
