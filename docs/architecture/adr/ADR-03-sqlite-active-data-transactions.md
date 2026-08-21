# ADR-03：SQLite 活动数据、事务与并发控制

- 状态：已接受
- 日期：2026-08-19
- 决策主题：`ADR-TOPIC-03`
- 前置决策：[ADR-01](./ADR-01-desktop-runtime-ui-boundary.md)、[ADR-02](./ADR-02-process-thread-deployment.md)
- 前置调研：[SQLite 与 TypeScript/Electron 生态调研](../../research/sqlite-typescript-electron-adr-research.md)
- 审计证据：[方案 A 正式审计](../../research/adr-03-node-sqlite-data-audit.md)

## 1. 背景

ADR-01 已选择 Electron + React + TypeScript；ADR-02 已把 `MOD-WORKSPACE`、领域 Module、`MOD-PROTECT` 和 `MOD-DATA` 部署到受 Main 监督的单一 Workspace utility process，并规定 Main、Renderer 和 worker 不得打开活动数据库。

当前还需决定正式结构化活动数据的存储、SQLite binding、活动连接、事务、读取与数据库 checkpoint seam，同时满足：

- facts、entity versions、revision、`CommandReceipt`、`DurableFollowUp` 和 backup watermark 全有或全无；
- 同 `CommandId` 重试不重复提交，不同 payload 复用同 ID 被拒绝；
- 一个 `ReadSnapshot` 不混合多个 revision；
- COMMIT 或响应丢失后不伪造成功或失败；
- 本地提交不等待异步备份，备份失败不回滚本地成功；
- snapshot 声明实际 revision，restore 在验证与可恢复激活前不改变活动真相；
- 数据不可写、不可读、损坏或版本未知时进入正确的 Workspace mode；
- macOS 与 Windows 使用同一 TypeScript/Workspace 实现；
- 个人 + Codex 可以维护，且不为当前不存在的规模或替换需求预建复杂数据层。

## 2. 决议

CourseFlow 的正式结构化活动数据存放在**一个本地 SQLite 数据库**中。初始实现使用 Electron 随附 Node 的 `node:sqlite`、一个长期 `DatabaseSync` read-write 活动连接、直接 prepared SQL 和一个同步有界 writer FIFO；不使用 ORM、连接池、`SQLTagStore` 或运行时 driver fallback。

活动库采用 WAL + `synchronous=FULL`。每个正式命令在不可跨 `await` 的 `BEGIN IMMEDIATE` 事务中原子提交；一致读取使用有界的当前 read transaction；数据库 checkpoint 使用短期 read-only source connection 和 SQLite Online Backup API。

### 2.1 全局所有权与连接拓扑

```text
Electron Main
  └─ application single-instance ownership
      └─ one Workspace utility process
          └─ MOD-DATA adapter
              ├─ one long-lived read-write DatabaseSync
              └─ at most one short-lived read-only backup source
```

规则：

1. Electron Main 必须在 spawn Workspace utility 前取得应用单实例锁。未取得锁的第二实例不得打开活动数据库，只能通知并唤醒主实例后退出。
2. 只有 Workspace utility process 内的 `MOD-DATA` adapter 可以打开活动库；Main、Renderer、worker 和其他 Module 不得取得连接。
3. 普通 command、query 和 `ReadSnapshot` 共用一个长期 read-write `DatabaseSync`；初始实现不建立 reader pool。
4. Online Backup 可以创建至多一个有界、短期、read-only source connection；完成、失败或取消后必须关闭。
5. restore candidate validation 打开的是独立 staging 数据库，不是第二个活动库 owner。
6. SQLite 文件锁保留为最后保护，但不替代应用单实例所有权、writer FIFO 或恢复独占模式。
7. 活动库只能位于本机受支持文件系统；不得放在云盘同步目录、网络文件系统、LibraryRoot 或 backup destination 中运行。

### 2.2 Binding 与 DATA 边界

- 使用 Electron 内嵌 Node 提供的 `node:sqlite` 和同步 `DatabaseSync` API，不增加第三方 `.node` native addon。
- `node:sqlite`、`DatabaseSync`、`StatementSync`、SQLite result code 和 pragma 不得越过 `MOD-DATA`。
- `IF-WORKSPACE`、领域接口、`ChangeSet` 和 IPC DTO 只表达 CourseFlow 语义，不泄露 table、SQL、ORM 或 binding 类型。
- DATA adapter 只使用经门禁验证的窄 API 子集：open/close、prepared statements、transaction state、Online Backup、必要的 authorizer/limits 和精确整数读取。
- 所有不可信值使用 prepared statement 参数；动态标识符只能来自固定代码白名单。
- 不使用 `SQLTagStore`。不因未来可能替换而预建通用 driver interface、factory 或第二套实现；现有 `MOD-DATA` 已是替换边界。
- `node:sqlite` 门禁失败时不得自动 fallback。切换到 `better-sqlite3` 或其他 binding 必须重新打开本 ADR 或由替代 ADR 明确取代。

`node:sqlite` 在接受本 ADR 时仍为 Stability 1.2 / Release Candidate。实现必须精确锁定一个受支持的 Electron 版本；所带 Node 必须包含接受日已知的 `node:sqlite` 安全修复，基线不得早于已修复 2026-07 `SQLTagStore` 问题的 Node 24.18.1。采用更晚的 Electron/Node 仍须重新执行本 ADR 的运行时、数据与 packaged 门禁。

### 2.3 打开、安全与持久性基线

长期活动连接的基线配置必须设置并读回：

```text
DatabaseSync:
  readOnly = false
  timeout = bounded non-zero
  enableForeignKeyConstraints = true
  enableDoubleQuotedStringLiterals = false
  allowExtension = false
  defensive = true
  allowUnknownNamedParameters = false

PRAGMA:
  journal_mode = WAL
  synchronous = FULL
  foreign_keys = ON
  trusted_schema = OFF
```

每个新连接都必须设置连接级选项，不能假定首次建库时设置一次即可。extension loading 保持关闭；restore candidate 不能通过数据库内容开启 extension 或任意代码。

Revision、EntityVersion 和其他 SQLite 64 位整数必须以 `bigint` 精确读取，例如在相关 statement 上启用 `setReadBigInts(true)`。[ADR-04](./ADR-04-schema-migration-compatibility.md) 已决定 Workspace/IPC 使用 canonical unsigned decimal string；任何边界都不得静默转换为 JavaScript `Number`。

busy timeout、WAL auto/manual checkpoint、cache、page size 和 macOS `fullfsync` 等参数不在本 ADR 中猜测固定值；它们必须根据 G7、掉电/故障实验和两个平台的设备档案校准。无论参数如何，`synchronous=NORMAL` 都不是活动库允许的降级配置。

### 2.4 写事务、revision 与幂等

所有正式 write transaction 经过同一进程内 FIFO。FIFO 必须有队列上限、背压、关闭时停止接收和有界 drain 语义。

事务体必须完全同步，禁止 `await`、IPC、文件系统、backup、通知、worker 调用或不可预测的领域计算。可在事务前完成的领域校验应提前完成；会竞争的 receipt、entity versions 和 confirmation 前提必须在事务内重查。

规范顺序为：

```text
BEGIN IMMEDIATE
  1. 查询 CommandId receipt
     - 同 canonical payload digest：返回既有 outcome，不写、不推进 revision
     - 不同 digest：integrity/conflict，正式数据 unchanged
  2. 重查 confirmation/revision 与 expected EntityVersion
  3. 应用全部领域 ChangeSet
  4. 推进一次全局 Revision，并更新受影响 EntityVersion
  5. 写入 CommandReceipt（digest、revision、可重放 outcome）
  6. 写入/更新 DurableFollowUp、Operation 与 backup-needed watermark
COMMIT
commit 后才发送 PostCommitChange 并返回 committed
```

canonical payload digest 和 receipt schema 由 [ADR-04](./ADR-04-schema-migration-compatibility.md) 决定；本 ADR 只规定它必须稳定、版本化并与 receipt 同事务持久化。

`BEGIN IMMEDIATE` 用于在事务入口获取 writer 能力。瞬时 `BUSY` 可以在 bounded timeout 内等待；最终 `BUSY` 返回可重试且 `dataEffect=unchanged` 的问题，不得无限重试。

constraint、明确 rollback 或 COMMIT 前可证明的失败不推进 revision、不产生 Undo、不发送通知、不推进 backup success。若 COMMIT 附近发生 I/O 错误、utility 退出或响应丢失，Main/Shell 不得立即显示成功或失败；新 `workspaceEpoch` 完成 `FLOW-00` 后用原 `CommandId` 查询 receipt。只有匹配 receipt 能重放 `committed`；无法安全判定时进入 `recovery-required`。

### 2.5 `ReadSnapshot`

```text
BEGIN
  read current Revision R
  read and fully materialize all facts required by this query
COMMIT
evaluate projection from immutable in-memory facts
return ProjectionEnvelope at R
```

规则：

- read transaction 不得跨 `await`、IPC 或领域异步工作；
- iterator、statement 或 transaction handle 不得离开 DATA adapter；
- 同一 `ProjectionEnvelope` 的所有正式事实必须来自 R；
- 长列表按窗口/页读取，每一页明确携带自身 revision；
- preview/confirmation 绑定的旧 revision 已过期时返回 stale/conflict 并重新预览，不混读新旧事实；
- 本 ADR 不提供任意历史 revision 的 time-travel 读取。未来若需要历史快照查询，必须新增事实/历史模型并重新打开数据 ADR。

普通读取复用长期活动连接。只有真实 G7 证明窗口化查询、索引和短事务仍无法满足预算时，才重新审议有界只读连接；不得在初始实现预建 pool。

### 2.6 异步数据库 checkpoint

本地 commit 只原子登记 `backupNeededThrough`/follow-up，然后即可返回本地成功。PROTECT 后台流程不得在 command transaction 中运行 backup。

规范的数据库 checkpoint 顺序为：

1. 合并待保护目标 revision T，但不把 T 预先声明为最终 snapshot revision；
2. 在本地唯一、原先不存在的 staging 路径创建目的数据库；
3. 以短期 read-only source connection 调用 `node:sqlite.backup()`；
4. 完成后只读打开副本，读取 actual revision R；
5. 验证 R 不早于 T，并检查 format/schema compatibility、`quick_check` 或 `integrity_check`、`foreign_key_check`；
6. 从副本读取 R 对应的 Library index/verification records，让 `MOD-LIBRARY` 复制并重新验证对应文件；
7. [ADR-07](./ADR-07-snapshot-format-integrity-publication.md) 生成声明 R 的 manifest，完成 digest、临时写入和完整性验证；
8. 只有发布 `SnapshotId` 后才推进 `backupSucceededThrough` 至 R；
9. 若活动 revision 已超过 R，保留其 pending 水位并安排下一次。

Online Backup 期间活动 writer 可以继续提交。不同 source connection 上的写入可能使 backup 自动重启，因此最终覆盖范围必须从副本读取，不能沿用请求时 revision。频繁重启、`BUSY`、空间不足、目的文件已存在、权限或 I/O 错误都使本次 checkpoint 失败；staging 不发布，上一有效 snapshot 和 pending 水位保持。

不得 raw-copy 打开的活动 `.db`、`-wal` 或 `-shm`。`VACUUM INTO` 不是默认后台 checkpoint；`serialize()` 不作为默认方案，因为它把整库复制到内存。

### 2.7 Stage、validation 与 activation seam

- restore candidate 只能写入独立 staging 路径，stage 不改变活动库。
- validation 连接使用 read-only、defensive、extensions off、trusted schema off 和固定白名单查询；检查候选身份、格式/schema version、数据库完整性、foreign keys 与实际 revision。
- 候选数据库不得 `ATTACH` 到活动库，不执行候选自带的任意 extension 或不受信 SQL。
- preview 和用户确认仍由 `MOD-PROTECT`/`MOD-WORKSPACE` 所有。
- activation 前 Workspace 停止新命令、drain，并关闭 writer、backup 和 validation 连接。
- SQLite transaction 只能保证数据库内部原子性，不能原子替换“数据库 + Library 文件 + 外部激活协调记录”。[ADR-08](./ADR-08-restore-activation-recovery.md) 定义跨文件 activation、继续与回滚；ADR-03 不把部分切换报告为成功。
- activation 后必须重新打开、验证并执行 `FLOW-00`。不确定时只允许 ADR-08 证据支持的 resume 或 rollback；若两者都不安全则保持 recovery 并展示当前可证明状态。

### 2.8 错误、模式与当前问题

DATA adapter 将 SQLite primary/extended result、操作阶段和实际 transaction state 映射为稳定 `StructuredProblem`；原始异常字符串不作为调用方分支。

- validation/constraint/conflict/最终 `BUSY` 且可证明未提交：`dataEffect=unchanged`；
- 活动 DB 可读但不可安全写：Workspace `read-only`；
- 数据不可读、损坏、版本未知、COMMIT 无法判定或 activation 未决：`recovery`/`recovery-required`；
- backup destination/发布失败：PROTECT degraded，活动 DB 与 PLAN 核心继续；
- `PostCommitChange` 丢失、合并或重复：通过持久 follow-up/watermark 恢复；
- 只有会改变当前问题分类、dataEffect 或允许动作的 SQLite code、operation/epoch 和版本可以进入封闭 typed problem details。原始异常映射后丢弃；按 [ADR-09](./ADR-09-no-production-diagnostics.md) 不建立持久诊断、日志或上传。

## 3. Architecture 映射

### 3.1 Module 与 Interface

| 覆盖项 | 本 ADR 的落实 |
|---|---|
| `MOD-DATA` | 唯一 SQLite owner；一个活动连接、事务、revision、receipt、ReadSnapshot、checkpoint/stage seam |
| `MOD-WORKSPACE` | writer 调度的用例入口、current revision、outcome unknown 收敛、Workspace mode |
| `MOD-PROTECT` | backup watermarks、数据库 checkpoint 使用者、restore session；不取得活动连接所有权 |
| `MOD-LIBRARY` | index ChangeSet 与 revision 同事务；snapshot manifest 绑定 DB 副本 actual revision |
| PLAN/ATTEND/GRADE | 通过 DATA ChangeSet/ReadSnapshot 使用正式事实；不依赖 SQL/table |
| `MOD-SHELL` / Electron Main / worker | 无 SQLite 权限；Main 只负责全局单实例门和 utility 生命周期 |
| `IF-DATA-READ` | 当前有界 read transaction |
| `IF-DATA-COMMIT` / `IF-DATA-RECEIPT` | `BEGIN IMMEDIATE` 原子提交与 CommandId 重放 |
| `IF-DATA-EXPORT` | Online Backup 产生实际 revision 的 DB checkpoint |
| `IF-DATA-STAGE-ACTIVATE` | staging/validation/close-before-activate seam；跨文件机制见 [ADR-08](./ADR-08-restore-activation-recovery.md) |
| `IF-DATA-OPERATION` / `IF-DURABLE-FOLLOWUP` | Operation、follow-up 与相关 revision 同事务持久 |

### 3.2 FLOW

| Flow | 本 ADR 的责任 |
|---|---|
| `FLOW-00` | 打开时验证路径、版本、integrity、writability、activation state 与 pending receipt/operation/follow-up |
| `FLOW-01` | 单事务提交、revision、receipt、follow-up、commit 后通知和未知结果收敛 |
| `FLOW-02` | 同一当前 ReadSnapshot/Revision 的正式事实 |
| `FLOW-03` | FileOperation planned/index-committed 状态可持久；不虚构跨文件事务 |
| `FLOW-04` | watermark、Online Backup、actual revision 与数据库 checkpoint seam |
| `FLOW-05` | stage/validation/连接关闭；activation 机制见 [ADR-08](./ADR-08-restore-activation-recovery.md) |
| `FLOW-06` | 为 PLAN/ATTEND/GRADE 提供同一 revision 的事实输入 |

### 3.3 Quality 与 Gate

本 ADR 直接约束 `Q-TRUTH-01`、`Q-CONSIST-01`、`Q-PROTECT-01`、`Q-LOCAL-01`、`Q-PORTABLE-01`、`Q-RESPOND-01`、`Q-EVOLVE-01`、`Q-CONTINUITY-01`、`Q-DIAG-01`，并不得妨碍其他 `Q-*` 的领域语义。

验证重点是 `G2`、`G4`、`G6`、`G7`。`G6` 与 `G7` 在接受本 ADR 时仍未通过；它们是“ADR 已选择、实现尚未落实”的门禁，不是已完成事实。

## 4. 后果

### 4.1 正向

- 与 ADR-01 的单一 TypeScript 项目语言和 ADR-02 的独立 utility process 对齐；
- 不增加第三方 native addon、Electron ABI rebuild、ASAR unpack 或额外签名面；
- 一个数据库事务可直接满足跨 Module 结构化事实、revision、receipt 和 follow-up 的原子性；
- 同步 API 让事务体易于禁止跨 `await`，并把阻塞限制在 Workspace utility；
- prepared SQL、单连接和无 ORM 保持数据协议可审计；
- WAL 允许短期 backup source 与 writer 并存，同时保持单 writer；
- Online Backup 避免 raw-copy 活动 DB/WAL 的损坏风险；
- 现有 `MOD-DATA` 已隔离 RC binding，未来替换不需要改变 Workspace/领域接口。

### 4.2 代价与风险

- `node:sqlite` 仍是 Release Candidate，并与 Electron 内嵌 Node/SQLite 版本耦合；
- `DatabaseSync` 的长 SQL 会阻塞 utility event loop，不能用“离开 Main”掩盖长查询；
- WAL 有 `-wal`/`-shm`、checkpoint 和长 reader 管理成本；
- 增量 backup 在并发写入下可能重启，频繁写入时尾延迟或完成时间可能上升；
- 单连接降低初始复杂度，也意味着读取与普通写入由 utility 顺序调度；
- SQLite 不提供任意历史 revision time-travel；
- 数据库事务不解决 Library 文件与活动 DB 的跨资源原子切换；
- 每次 Electron 更新都触发数据库 runtime、安全、兼容和 packaged 回归审查。

这些风险通过窄 DATA adapter、当前需求的短查询/单用户规模、故障注入、actual revision 协议和硬门控制。若实测证明控制无效，应重新打开本 ADR，而不是在实现中悄悄增加 pool、driver 或 fallback。

## 5. 被否决的方案

### 5.1 `better-sqlite3` 作为首选

它具有成熟同步 API、transaction helper、BigInt 和 Online Backup，但增加 native addon、跨平台二进制、ASAR、签名、公证和供应链面。当前 `node:sqlite` 能力足够，不为 API convenience 承担该成本。

`better-sqlite3` 是门禁失败时已研究的首要替代候选，但不是已启用备用实现；切换必须通过新决议。

### 5.2 `node:sqlite` + rollback DELETE/EXTRA

rollback journal 的 quiescent 文件状态更简单，但 reader/writer 与 Online Backup 更易互相阻塞。CourseFlow 已要求异步 checkpoint 且活动库只在本机，WAL/FULL 在当前约束下更均衡。

### 5.3 ORM 或 query builder

Drizzle、Kysely 或自建 repository 不能替代 CourseFlow 的 revision、receipt、follow-up、checkpoint 和 activation 协议。当前 schema 尚未决定，且只有一个 DATA implementation；为类型化 CRUD 增加 ORM/第二层 RC 或通用 abstraction 没有验收收益。

### 5.4 `node-sqlite3`

项目已 deprecated/unmaintained，callback/排队模型也使同步事务与错误边界更难审计，不适合作为新项目基线。

### 5.5 SQLite WASM、JSON、事件溯源、多数据库或 reader pool

- WASM/OPFS 与 ADR-02 的 Node utility + 真实本地活动目录不匹配；
- JSON 需要重新实现事务、锁、索引、崩溃恢复和 live backup；
- 完整 event sourcing 没有当前审计/time-travel/多设备产品需求；
- per-Module database 会把跨 Module commit 与一致 snapshot 变成分布式协调；
- reader pool/第二 writer 只有在 G7 证明单连接失败后才有讨论依据。

## 6. 验证义务

在本 ADR 可视为“已落实”前，必须产生以下证据：

1. 目标 packaged Electron 在 macOS 与 Windows 的 Workspace utility 中加载 `node:sqlite`，记录 `process.versions.electron/node/sqlite` 并验证所需窄 API；
2. 双开 packaged 应用时只有取得单实例锁的 Main spawn utility/open DB；
3. `TEST-DATA-001`：每个事务阶段、COMMIT 前后 kill，facts/versions/revision/receipt/follow-up 只能全有或全无；
4. `TEST-DATA-002`：同 CommandId/同 digest 跨并发与重启重放原 outcome；不同 digest 被拒绝；
5. `TEST-DATA-003`：expected version conflict 不写；并发 writer 时 ReadSnapshot 不混 revision；
6. `TEST-DATA-004`：通知丢失/重复、utility 重启后 follow-up 仍幂等完成；
7. `TEST-DATA-005`：read-only、permission、BUSY、FULL、IOERR、损坏和 WAL recovery 进入正确模式且不自动重置；
8. `TEST-DATA-006`：当前/旧/未知新格式、export、stage、activation/rollback 跨重启；
9. COMMIT 后、响应前 kill，Shell 不显示成功/失败；新 epoch 通过 receipt 收敛；
10. Online Backup 并发写入、中途 kill、频繁 restart、目的文件已存在、空间不足和权限失败不发布 staging、不损坏上一 snapshot；
11. `TEST-PROTECT-002/006`：完成副本 actual revision、DB index records、Library manifest/content/digest 和 success watermark 一致；
12. restore candidate 的损坏、不兼容、恶意 schema/extension、`ATTACH` 尝试和 activation 前后 failpoint 被正确拒绝或恢复；
13. G7 测量 cold open、query/commit p50/p95/p99、utility event-loop delay、WAL 大小/checkpoint、backup、integrity check 和内存；
14. Electron/runtime 更新重复执行以上 DATA contract、backup/restore compatibility 和 packaged 双平台门；
15. 静态依赖守卫证明 `node:sqlite` 只被 DATA adapter 导入，Main、Renderer、worker 和领域 Module 不依赖 binding。

当前前置调研的本地 Node 探针只证明 WAL/FULL、原子事务和 Online Backup 机制可用，不替代上述 Electron packaged、产品 schema、故障与性能证据。

## 7. 相邻与后续决策

- `ADR-TOPIC-04`（[ADR-04 已接受](./ADR-04-schema-migration-compatibility.md)）：schema、table/column、constraint/index、migration、canonical digest、版本兼容和 Workspace DTO 数值编码；
- `ADR-TOPIC-05`（[ADR-05 已接受](./ADR-05-library-watching-index-file-operations.md)）：文件操作、Watcher 与路径身份；
- `ADR-TOPIC-06`（[ADR-06 已接受](./ADR-06-resource-preview-system-open.md)）：资源访问、预览与平台打开行为；
- `ADR-TOPIC-07`（[ADR-07 已接受](./ADR-07-snapshot-format-integrity-publication.md)）：snapshot manifest、Library 内容、digest、无压缩不可变目录、临时发布与保留；
- `ADR-TOPIC-08`（[ADR-08 已接受](./ADR-08-restore-activation-recovery.md)）：外部 activation journal、数据库/Library 切换、继续、回滚和启动恢复；
- `ADR-TOPIC-09`（[ADR-09 已接受](./ADR-09-no-production-diagnostics.md)）：无生产诊断/日志/导出；只保留 typed StructuredProblem 与本 ADR 的正式正确性记录；
- `ADR-TOPIC-10`：Electron 精确版本、打包、签名、公证、安装与更新。

这些相邻与后续 ADR 不得绕过单一 DATA owner、放宽 COMMIT 成功边界、把云盘变成活动库、把 binding 类型泄露出 DATA，或把跨文件 activation 伪装成 SQLite 原子事务。

## 8. 重新打开条件

出现以下任一证据时必须重新打开本 ADR：

- 受支持 Electron 无法提供包含必要安全修复和 API 的 `node:sqlite`；
- packaged macOS/Windows 任一目标不能稳定加载、提交、备份、恢复或升级；
- 在完成索引、分页、短事务和 checkpoint 调优后，G7 仍证明单连接 `DatabaseSync` 无法满足批准的响应预算；
- WAL/FULL 在目标本地文件系统无法满足持久性或恢复要求；
- Online Backup 无法在参考工作区内产生与 Library manifest 一致的可发布 checkpoint；
- 产品新增多设备实时合并、协作写入、任意历史 revision time-travel 或网络文件系统活动库；
- `TEST-DATA-*` / `TEST-PROTECT-*` 的正确性只能通过违反当前 DATA/Workspace 边界才能实现。

重新打开时优先评估 `better-sqlite3` 或受控读取拓扑；不得以未记录的实现偏差取代架构决议。
