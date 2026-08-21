# CourseFlow 活动数据、SQLite 与 TypeScript/Electron 生态调研（ADR-03 前置材料）

> 调研日期：2026-08-19
> 状态：候选研究，不是已接受决议
> 决策主题：`ADR-TOPIC-03`——活动数据存储、事务与并发控制
> 前置决策：[ADR-01](../architecture/adr/ADR-01-desktop-runtime-ui-boundary.md)、[ADR-02](../architecture/adr/ADR-02-process-thread-deployment.md)
> 后续决议：[ADR-03 已接受](../architecture/adr/ADR-03-sqlite-active-data-transactions.md)
> 方法：已重新核对全部产品、用户流程、UI、Architecture 与 Module Contract 文档；外部事实只采用 SQLite、Node.js、Electron 与候选库的官方文档或官方仓库。文中的“推荐/推断”是对 CourseFlow 约束的判断，不是上游项目承诺。
> 后续约束：[ADR-09](../architecture/adr/ADR-09-no-production-diagnostics.md) 已决定不建设生产诊断/日志/支持包；本文早期预留的诊断读取/导出不得实现。

## 先给决策者的结论

三套方案都能实现 SQLite 内的原子提交，但综合 CourseFlow 的“个人 + Codex”、单一 TypeScript 代码栈、ADR-02 独立 Workspace utility process，以及 macOS/Windows 打包成本，默认推荐：

**方案 A：在 Workspace utility process 内使用 Electron 随附 Node 的 `node:sqlite`，以一个 `DatabaseSync` 活动连接和直接 prepared SQL 访问单一 SQLite 活动库；采用 WAL + `synchronous=FULL`、显式短事务、SQLite Online Backup API，不引入 ORM。**

这不是“SQLite 默认设置即可”。正式候选还必须包含：

- 活动库只允许一个 read-write 连接和一个 writer 调度入口；普通读取也使用该连接，不建立连接池；
- 每个命令用同步、不可跨 `await` 的 `BEGIN IMMEDIATE` 事务，将领域事实、entity versions、new revision、`CommandReceipt`、`DurableFollowUp` 与 backup watermark 一起提交；
- `ReadSnapshot` 在一个短 read transaction 内读出目标事实并全部物化，事务不得跨 IPC 或领域异步工作；
- 后台 checkpoint 使用短期只读源连接与 Online Backup API，输出到唯一 staging 文件；活动数据库文件不得用普通文件复制；
- 恢复候选只能在独立路径验证；激活前关闭全部 SQLite 连接，数据库与资料库的跨文件切换仍由 ADR-08 定义；
- `node:sqlite` 仍是 Stability 1.2 / Release Candidate，必须锁定 Electron 运行时、只使用经验证的窄 API 子集，并以真实 packaged macOS/Windows 测试作为硬门。

若该硬门失败，首要回退是 **方案 B：`better-sqlite3` + 相同的数据协议**。不得在运行时悄悄切换驱动，也不为未来替换预建第二套活跃实现；已有 `MOD-DATA` 边界足以把替换限制在 adapter 内。

## 决策必须满足的既有契约

ADR-03 不是单纯选择一个 npm 包。以下现有约束必须由“存储模型 + 连接模型 + 事务协议 + checkpoint/activation 边界”整体满足：

| 来源 | 不可削弱的要求 | 对 ADR-03 的直接含义 |
|---|---|---|
| `A-DATA-001–003`、`Q-LOCAL-01` | 无登录、离线完整可用；活动数据在本地；活动库、资料库、云盘备份目录分离 | 单一本地活动数据库；不把数据库放在云盘、网络盘或同步目录中运行 |
| `MOD-DATA` invariant 1/5 | 事实、entity versions、revision、receipt、follow-up 全成或全不成；失败不推进 revision | 所有结构化提交必须进入一个 SQLite transaction |
| `MOD-DATA` invariant 2 | 同 `CommandId` 重放不重复；同 ID 不同 payload 必须冲突 | receipt 与稳定 payload digest 和结果同事务持久化，不能只依赖内存去重 |
| `MOD-DATA` invariant 3 | 只在 commit 后通知；通知丢失不能丢 follow-up | outbox/follow-up 是数据库事实，`PostCommitChange` 只是提交后提示 |
| `MOD-DATA` invariant 4、`Q-CONSIST-01` | 一个 `ReadSnapshot` 不混 revision | 显式短 read transaction；先读取 revision，再在同一 snapshot 读取所需事实 |
| `A-DATA-004`、`Q-RESPOND-01` | 本地成功后异步备份，备份失败不回滚本地成功 | commit 不等待 snapshot 发布；同事务只登记 follow-up/目标水位 |
| `A-DATA-005/006`、`FLOW-05` | 显式整库恢复、验证后替换、不自动合并 | export/stage/activate 接缝明确；不设计复制合并或冲突解决数据库 |
| `Q-CONTINUITY-01`、`TEST-DATA-001–006` | utility/应用重启后 receipt、operation、follow-up、恢复会话仍可判定 | 所有恢复真相在 SQLite 或 ADR-08 的外部 activation checkpoint，不依赖进程内队列 |
| ADR-02 | 只有 Workspace utility process 的 DATA adapter 可打开活动库；Main/Renderer/worker 不得打开 | 同步 SQLite API 不阻塞窗口/Main；worker 也不能取得数据库连接 |

结构化正式事实、设置、资料库索引、revision、receipts、operations 与 follow-ups 应位于同一 SQLite 数据库。真实课程文件仍在独立资料库根目录；SQLite 只保存其身份、路径映射、verification 与操作状态。按 Module 拆多个数据库会破坏跨模块原子 commit 和一致 checkpoint，当前没有相应收益。

## 生态现状与可验证事实

### Electron 与 `node:sqlite`

Electron 的 `utilityProcess` 在独立进程中提供 Node.js 和 MessagePort；官方说明该进程可使用完整 Node API。这与 ADR-02 的 Workspace 部署直接相容。[Electron：utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process) · [Electron：Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model)

截至调研日，最新稳定 Electron 43.4.1 随附 Node 24.18.1；这也是修复 2026 年 7 月 Node 安全公告的版本。公告中的 `node:sqlite` 问题只涉及 `SQLTagStore` iterator 复用，但它说明 Electron 内嵌 Node 的补丁版本必须进入安全基线，不能只写“Node 24”。本候选不用 `SQLTagStore`，只使用显式 prepared statements。[Electron stable releases](https://releases.electronjs.org/?channel=stable) · [Node.js 2026-07 security release](https://nodejs.org/en/blog/vulnerability/july-2026-security-releases)

Node 24.17 文档所示的所需 API 已包括：

- 全同步的 `DatabaseSync`、prepared statements 与 `isTransaction`；
- open-time busy timeout、read-only、foreign key、double-quoted literal、extension、BigInt、defensive 与 runtime limits 选项；
- 默认开启 defensive、默认关闭 extension loading 和 double-quoted string literals；
- `setAuthorizer`、`serialize`/`deserialize`；
- 基于 SQLite Online Backup API 的异步 `backup()`，并报告进度和页数。

[Node 24.17：SQLite API](https://nodejs.org/docs/v24.17.0/api/sqlite.html)

但 Node 官方仍将整个模块标为 **Stability 1.2 / Release Candidate**：预计不再发生 breaking change，但仍可能依据反馈变化；实验 API 不受完整语义版本兼容承诺。这是方案 A 的主要风险，而不是可以省略的脚注。[Node：Stability Index](https://nodejs.org/api/documentation.html#stability-index)

### `better-sqlite3`

`better-sqlite3` 提供成熟的同步 prepared statement、`.transaction().immediate`、嵌套 SAVEPOINT、64 位整数与 Online Backup API；其官方 API 也明确 transaction callback 不能是 async，且不应让事务跨 event-loop tick。[better-sqlite3 API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)

它仍是 native addon。Electron 官方说明 native Node module 可能需要针对 Electron 重新构建；目标平台/架构、ASAR unpack、代码签名与公证都进入交付矩阵。[Electron：Native Node Modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules) · [Electron：ASAR archives](https://www.electronjs.org/docs/latest/tutorial/asar-archives)

`better-sqlite3` 13.0.0 于 2026-07 首次迁到 Node-API，目标是让预编译二进制跨 Node/Electron 版本复用。这减轻 ABI 风险，但该大版本很新，且 native binary 的平台、打包与签名测试仍不能删除。[better-sqlite3 releases](https://github.com/WiseLibs/better-sqlite3/releases)

### 不进入 shortlist 的绑定与 ORM

- `node-sqlite3` 官方仓库已明确标为 deprecated、unmaintained，并于 2026-07-01 归档；其 callback/排队模型也让显式事务错误传播更难审计，因此不是新项目可接受候选。[TryGhost/node-sqlite3](https://github.com/TryGhost/node-sqlite3)
- Drizzle 可以接 `node:sqlite`，但当前官方指南要求安装 ORM/Kit 的 `@rc` 包；它不能替代 revision、receipt、follow-up、Online Backup 或 activation 协议。为了类型化 CRUD 再叠加第二个 RC 不符合当前单人项目的最小依赖原则。[Drizzle：Node SQLite](https://orm.drizzle.team/docs/sqlite/connect-node-sqlite)
- SQLite WASM 的官方持久化路线以浏览器 Worker/OPFS 为中心；CourseFlow 已把活动库所有权放在 Node utility process 和真实本地目录中，增加 WASM 文件系统层没有验收收益。[SQLite Wasm：Persistence](https://sqlite.org/wasm/doc/trunk/persistence.md)

## 三套完整可行方案

### 方案 A：`node:sqlite` + WAL/FULL + 单活动连接 + 直接 SQL（推荐）

**组成**

- 一个 `DatabaseSync` read-write 活动连接，位于 Workspace utility process；
- 同步 writer FIFO；普通 query 复用同一连接；无 reader pool；
- `journal_mode=WAL`、`synchronous=FULL`；
- hand-authored prepared SQL 和一个最小 transaction helper；
- checkpoint 时最多创建一个短期 read-only source connection；
- 无 ORM、无 driver abstraction、无 native npm addon。

**优势**

- 运行时已随 Electron 分发，不增加 `.node` 文件、ABI rebuild、ASAR unpack 或额外签名面；
- 同步 API 与独立 utility process 正好组合：事务可完整同步执行，Renderer/Main 不被阻塞；
- 所需 defensive、foreign keys、BigInt、authorizer、limits 和 Online Backup 均已存在；
- 数据访问被现有 `MOD-DATA` 深边界隐藏，未来若替换驱动，不影响 `IF-WORKSPACE` 或领域类型。

**代价/风险**

- API 仍是 Release Candidate，且 SQLite 版本随 Electron/Node 更新，不能独立升级；
- Node 没有 `better-sqlite3` 那样的 transaction wrapper，需要维护一个很小但关键的同步 helper；
- 同一 utility 中的长 SQL 会延迟其他 Workspace 请求，必须依赖索引、分页、短 snapshot 和 G7，而不是预建连接池；
- 每次 Electron 更新都同时是 Node/SQLite runtime 更新，必须跑完整 DATA contract 和 packaged smoke tests。

**适用判断**

这是满足当前需求所需的最少技术面。RC 风险是版本/验证风险，不是当前已经发现的契约缺口；对锁定运行时的桌面应用，它可以被严格门禁控制。

### 方案 B：`better-sqlite3` + WAL/FULL + 单活动连接 + 直接 SQL（首要回退）

**组成**

事务、连接、journal、checkpoint 与恢复协议和方案 A 相同，只把 Node 核心 binding 换成 `better-sqlite3`。

**优势**

- API 与 transaction helper 更成熟；Online Backup 与 BigInt 支持明确；
- 可以独立于 Electron 更新 SQLite/binding；
- 同步模型同样适合 utility process 的单 writer。

**代价/风险**

- 新增 native addon、平台/架构二进制与供应链；
- 开发和 CI 需要验证 native module 安装/重建、ASAR unpack、macOS signing/notarization 和 Windows packaging；
- Node-API 化刚发生在 v13，不能把“理论上跨 ABI”当作免测承诺；
- 仅为 transaction helper 引入 native dependency 不划算。

**适用判断**

若方案 A 在真实 Electron utility、API 稳定性门、运行时安全基线或双平台 packaged smoke test 中失败，方案 B 是能力最接近、架构变化最小的回退。回退必须通过更新 ADR 明确发生。

### 方案 C：`node:sqlite` + rollback DELETE/EXTRA + 单活动连接（保守文件状态备选）

**组成**

驱动和直接 SQL 与方案 A 相同，但使用默认 rollback `journal_mode=DELETE` 和 `synchronous=EXTRA`，不保留 WAL/SHM sidecar。

**优势**

- quiescent 状态只有一个数据库文件，checkpoint/激活的文件状态最容易解释；
- 不增加第三方 native addon；
- SQLite 官方 durability matrix 中，rollback + EXTRA 包含删除 journal 后的目录同步，是 rollback 模式的完整持久性配置。

**代价/风险**

- reader 会阻塞 writer，writer 也会阻塞 reader；即使 DATA 普通访问串行，在线 backup 和任何额外长读取也更容易抬高写入尾延迟；
- CourseFlow 要求备份异步且本地保存及时，WAL 更自然地允许 read-only backup source 与 writer 并存；
- 以 sidecar 更少换来的主要是实现观感，而非产品能力。

**适用判断**

如果真实 G7/故障实验显示 rollback 的写入延迟可接受，并且团队把最简单的磁盘文件状态置于后台 backup 并发之上，它仍是正确方案。当前证据不足以让它优于 A。

### 对比

| 维度 | A：node:sqlite + WAL | B：better-sqlite3 + WAL | C：node:sqlite + DELETE |
|---|---|---|---|
| 满足 DATA 不变量 | 是 | 是 | 是 |
| Electron 打包面 | 最小 | 最大 | 最小 |
| binding API 成熟度 | RC，需锁版本 | 成熟；v13 N-API 路线较新 | RC，需锁版本 |
| 后台 checkpoint 与写入并存 | 最自然 | 最自然 | 可行但争锁更明显 |
| quiescent 文件状态 | DB + 可能的 WAL/SHM | DB + 可能的 WAL/SHM | 单 DB，无活动事务时无 journal |
| 独立升级 SQLite | 否，跟随 Electron/Node | 是 | 否，跟随 Electron/Node |
| 单人维护成本 | **最低** | 中高 | 低 |
| 当前结论 | **推荐** | 首要回退 | 有条件备选 |

## 推荐方案的数据与并发协议

本节是方案可行性的必要组成，不提前决定 ADR-04 的具体表、字段、迁移文件或格式编码。

### 1. 活动连接与调度

- Workspace utility process 是唯一活动数据库 owner。
- 初始实现只有一个长期 read-write `DatabaseSync`；Main、Renderer、worker 和其他进程不得打开活动库。
- 所有 write transaction 经过一个进程内 FIFO；transaction body 必须同步执行，禁止 `await`、IPC、文件 I/O、通知、backup、解析或领域 worker 调用。
- 普通 ReadSnapshot 复用同一连接并在同步函数内物化结果；不建立 reader pool。
- checkpoint/restore validation 可以各自使用一个有界、短期 read-only 连接；它们不取得 writer 权限，完成后必须关闭。
- SQLite 的锁仍是最后保护，但不是多实例协作协议。应用只支持一个活动 Workspace owner；恢复/激活时必须取得独占 Workspace 模式。

### 2. 打开时安全与 durability 基线

对方案 A，候选配置是：

```text
DatabaseSync options:
  readOnly = false
  timeout = bounded non-zero
  enableForeignKeyConstraints = true
  enableDoubleQuotedStringLiterals = false
  allowExtension = false
  defensive = true
  allowUnknownNamedParameters = false

verified pragmas:
  journal_mode = WAL
  synchronous = FULL
  foreign_keys = ON
  trusted_schema = OFF

prepared statements that read Revision/EntityVersion:
  setReadBigInts(true)
```

所有持久连接都要设置并读回连接级选项；不能只在首次建库时执行一次。具体 busy timeout、WAL checkpoint threshold、cache 与 macOS `fullfsync` 是否启用属于 G7/故障实验后的参数，不应靠猜测固定。

SQLite `INTEGER` 是有符号 64 位值，而 JavaScript `Number` 只能精确表示安全整数范围内的值。DATA adapter 必须把 Revision、EntityVersion 和其他 64 位标识读为 `bigint`，并在 Workspace DTO 边界采用明确、可往返的编码；不得静默转成 `Number`。具体 DTO 编码由 ADR-04 决定。

SQLite 官方说明 WAL 允许 readers 与 writer 同时工作，但仍只有一个 writer；WAL 不能用于多主机网络文件系统，且长 read transaction 会阻碍 checkpoint。`synchronous=NORMAL` 在 WAL 下不会损坏数据库，但掉电后可能丢失已返回 commit，因此 CourseFlow 选 `FULL`。[SQLite：WAL](https://www.sqlite.org/wal.html) · [SQLite：PRAGMA synchronous](https://www.sqlite.org/pragma.html#pragma_synchronous)

活动目录必须位于本地受支持文件系统。云盘目录只接收已经验证、准备发布的 snapshot，不直接承载活动 DB、`-wal` 或 `-shm`。

### 3. 写命令与幂等边界

每个命令的 DATA 阶段如下：

```text
BEGIN IMMEDIATE
  1. 以 CommandId 查 receipt
     - 同 payload digest：返回既有 outcome，不重新写，不推进 revision
     - 不同 payload digest：integrity/conflict
  2. 校验 expected EntityVersion
  3. 应用全部领域 ChangeSet
  4. 推进一次全局 Revision，并更新受影响 EntityVersion
  5. 插入 CommandReceipt（含 digest、revision、可重放 outcome）
  6. 插入/合并 DurableFollowUp、Operation 与 backup target watermark
COMMIT
随后才发送 PostCommitChange 并返回 committed outcome
```

`BEGIN IMMEDIATE` 在 transaction 开始时取得 writer 能力，避免先读后升级时才发现竞争。[SQLite：Transactions](https://www.sqlite.org/lang_transaction.html)

预期版本冲突、constraint 或明确 rollback 成功可以返回 `dataEffect=none`。若 COMMIT 周围出现 I/O 错误、进程退出或响应丢失，不能直接声称失败；应进入 outcome-unknown/recovery 路径，重开后用原 `CommandId` 查 receipt。只有读到匹配 receipt 才能重放成功。

### 4. `ReadSnapshot`

```text
BEGIN                 -- read transaction
  read current Revision R
  read and materialize all facts required by this query
COMMIT
evaluate projection from immutable in-memory facts and return revision R
```

事务中不得 `await` 或把 iterator 暴露给领域层/IPC；任何分页 query 的一页自身保持同一 revision。SQLite 的 read transaction 保证当前 snapshot，不提供任意历史 revision 的自动重开；如果调用方绑定的 preview revision 已过期，应返回 stale/conflict 并重新预览，而不是混读新旧事实。

### 5. 异步 checkpoint

正式 commit 只持久化 backup follow-up 与目标水位，然后即可向用户确认“本地已保存”。后台 PROTECT 流程：

1. 在本地 staging 目录创建唯一、原先不存在的目的文件；绝不覆盖上一有效 snapshot。
2. 打开短期 read-only 源连接，以 `node:sqlite.backup()` 增量复制。
3. 写入期间仍允许活动 writer commit；不同源连接的变化会让 Online Backup 重新开始，结果仍保持一致。完成后必须从副本自身读取 actual revision，不能预先把触发时 revision 写成事实。
4. 以只读/defensive 模式打开副本，检查 format/schema compatibility、`quick_check` 或 `integrity_check`、`foreign_key_check`，并核对 actual revision。
5. 把验证后的数据库 checkpoint 交给 ADR-07 的 manifest、资料库内容、digest、临时上传和发布协议。
6. 只有发布完成后才推进 last successful backup watermark；失败保留上一有效 snapshot 与待处理目标水位。

SQLite 官方明确 Online Backup API 能从 live database 生成一致 snapshot；普通文件复制可能遗漏 hot journal/WAL，产生丢提交或损坏。[SQLite：Online Backup](https://www.sqlite.org/backup.html) · [SQLite：How To Corrupt](https://www.sqlite.org/howtocorrupt.html)

本地探针在 Node 24.19.0 / SQLite 3.53.3 上验证了：

- `WAL + synchronous=FULL + BEGIN IMMEDIATE` 成功把 revision、receipt、follow-up 原子写入；
- 独立 read-only source connection 可生成 Online Backup，副本 `integrity_check=ok`；
- 备份进行中由活动 writer 推进 revision 后，backup 正常完成，副本包含新的 revision 且完整性仍为 `ok`。

该探针只证明机制可用，不替代 Electron packaged macOS/Windows 证据。

### 6. stage 与 activation 边界

- restore candidate 先复制/解包到独立 staging 路径；stage 过程不得改活动库。
- validation 连接使用 read-only、defensive、extensions off、trusted schema off；检查 snapshot manifest、应用/格式/schema version、数据库完整性、foreign keys 与实际 revision。
- 预览从 staging 读取并与活动 ReadSnapshot 比较，但不得用 `ATTACH` 把两库混成一次写事务。
- 用户确认并完成恢复前安全 snapshot 后，Workspace 停止新命令、drain、关闭 writer/backup/validation 连接，再交给 ADR-08 的 activation checkpoint 与文件替换协议。
- SQLite transaction 只能保证数据库内部原子性，不能原子替换“数据库 + 资料库文件 + 外部 activation marker”；ADR-03 不虚构跨文件事务。
- 激活后重新打开并验证；中断时只允许继续、回滚或 recovery，不开放普通写入。

`VACUUM INTO` 可以产生紧凑一致副本，但 CPU/I/O 更重且中断时目的文件可能不完整；`serialize()` 会把整库复制到内存。两者都不是默认后台 checkpoint。[SQLite：VACUUM INTO](https://sqlite.org/lang_vacuum.html) · [SQLite：serialize](https://www.sqlite.org/c3ref/serialize.html)

## 为什么不采用更复杂的数据模型

- **完整 event sourcing**：revision、receipt 与 follow-up 不是要求保存每个领域事件并重放全部投影。当前没有审计追溯、多设备合并或 time-travel 产品要求；事件 schema、projection rebuild、compaction 与迁移只增加故障面。
- **整库 JSON/文档文件**：要自行实现 fsync、atomic rename、锁、partial query、索引、receipt/follow-up 一致性和 live backup，实质上重写 SQLite 已解决的能力。
- **每 Module 一个数据库**：跨 PLAN/ATTEND/GRADE/LIBRARY/PROTECT commit、同 revision ReadSnapshot 和全局 snapshot 都会变成分布式协调。
- **通用 repository/driver interface + 两套实现**：当前只有一个生产实现，`MOD-DATA` 已经是替换边界；再造一层不会提高验收能力。
- **预建 reader pool**：普通数据库阶段很短且在独立 utility 中；只有真实 G7 证明单连接失败时才考虑有界只读连接，且仍不得增加 writer。

## 方案 A 的硬门与失败条件

以下证据缺一不可；任何失败都意味着不能把方案 A 写成“已落实”，并应先评估方案 B，而不是把数据库移入 Main/Renderer：

1. **运行时门**：目标 Electron 必须是受支持的稳定版本，内嵌 Node 至少包含已知 `node:sqlite` 安全修复；记录 `process.versions.electron/node/sqlite`，验证 `DatabaseSync`、prepared statements、64 位整数精确往返、`backup`、defensive、read-only 和 `isTransaction`。
2. **打包门**：真实 packaged macOS（Apple Silicon，若支持 Intel 则另测）与 Windows 目标架构能在 utility process 中打开、提交、备份和重开；签名、公证、ASAR 后行为一致。
3. **原子门**：对事务每一步设置 failpoint；COMMIT 前/后 kill utility；验证 facts、versions、revision、receipt、follow-up 全有或全无。
4. **幂等门**：COMMIT 后响应前 kill；相同 CommandId/同 payload 重放原 outcome；同 ID/不同 payload 必须冲突。
5. **snapshot 门**：并发写入期间 ReadSnapshot 不混 revision；事务不能跨 `await`；长 query 有分页/时限。
6. **durability 门**：进程崩溃、磁盘满、read-only、permission、BUSY、IOERR 与损坏都不伪成功、不静默重置；未知 commit outcome 通过 receipt/recovery 判定。
7. **backup 门**：backup 并发写入、中途 kill、目的文件已存在、空间不足、云盘不可用时不发布临时副本，上一有效 snapshot 不受影响。
8. **性能门 G7**：测 Workspace event-loop delay、query/commit p50/p95/p99、WAL 大小/checkpoint、backup progress、冷启动和内存；只在证据显示单连接不足时重新审议读取拓扑。

## 与后续 ADR 的边界

ADR-03 若采用方案 A，只决定 SQLite binding、活动库形态、连接所有权、journal/durability、transaction/ReadSnapshot/Online Backup/activation seam。以下内容继续留给既定主题：

- `ADR-TOPIC-04`：具体 schema、table/column、迁移文件、`application_id`/schema version、payload digest canonical encoding、兼容停止；
- `ADR-TOPIC-05/06`：文件操作状态机、watcher/权限与资源访问；
- `ADR-TOPIC-07`：snapshot manifest、资料库打包、digest、临时写入与发布；
- `ADR-TOPIC-08`：activation marker、目录/文件切换、继续与回滚；
- `ADR-TOPIC-09`（[ADR-09 已接受](../architecture/adr/ADR-09-no-production-diagnostics.md)）：不建设本地诊断、生产日志或用户支持包导出；
- `ADR-TOPIC-10`：Electron runtime 更新、签名、公证和安装包验证。

## 建议进入讨论的决议句

> CourseFlow 的正式结构化活动数据存放在单一本地 SQLite 数据库中。只有 Workspace utility process 内的 DATA adapter 可访问活动库；初始实现使用 Electron 随附 Node 的 `node:sqlite` 与一个长期 `DatabaseSync` read-write 连接，直接执行 prepared SQL，不使用 ORM 或连接池。活动库采用 WAL + `synchronous=FULL`，写命令以同步 `BEGIN IMMEDIATE` 事务原子持久化 facts、versions、revision、receipt 与 follow-up；ReadSnapshot 使用有界短 read transaction；一致 checkpoint 使用短期只读连接和 SQLite Online Backup API。`node:sqlite` 的 RC 风险由安全补丁基线、精确运行时锁定、DATA 边界和 packaged 双平台门控制；硬门失败时通过新决议切换到 `better-sqlite3`，不得静默降级。

本节保留当时进入审计的候选措辞。用户已在正式审计后确认方案 A；规范性决议以 [ADR-03](../architecture/adr/ADR-03-sqlite-active-data-transactions.md) 为准。
