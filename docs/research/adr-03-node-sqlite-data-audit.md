# ADR-03 方案 A：`node:sqlite` 活动数据、事务与并发正式审计

> 审计日期：2026-08-19
> 审计对象：Workspace utility process 内 `node:sqlite` + 单一 `DatabaseSync` 活动连接 + 直接 prepared SQL + WAL/`synchronous=FULL`
> 候选来源：[ADR-03 前置调研](./sqlite-typescript-electron-adr-research.md)
> 前置决议：[ADR-01](../architecture/adr/ADR-01-desktop-runtime-ui-boundary.md)、[ADR-02](../architecture/adr/ADR-02-process-thread-deployment.md)
> 后续决议：[ADR-03 已接受](../architecture/adr/ADR-03-sqlite-active-data-transactions.md)
> 结论类型：架构可行性与需求覆盖审计，不代替实现、打包或发布测试
> 后续约束：[ADR-09](../architecture/adr/ADR-09-no-production-diagnostics.md) 已删除本研究当时假设的 diagnosticRef/日志/导出；错误只映射为当前 typed StructuredProblem。

## 1. 审计结论

**方案 A 在纳入本审计列出的强制约束后，可以承载当前全部已批准产品、逻辑架构与模块契约要求。没有发现要求引入 ORM、第三方 SQLite binding、reader pool、多数据库、事件溯源或第二种项目自有语言的现有需求。建议把方案 A 提交为 `ADR-TOPIC-03` 的正式决议。**

这是一项“架构可行性通过”，不是“实现已经通过”。当前仓库尚无 Electron packaged 应用、数据库 schema、迁移或 DATA contract suite，因此 `TEST-DATA-*`、`TEST-PROTECT-*`、macOS/Windows 打包和 G7 性能证据仍是未执行的实现门禁。正式 ADR 可以接受该技术方向，但不得把这些门禁写成已完成。

审计新增了前置调研中需要进一步收紧的两个条件：

1. **全局单 owner**：进程内 FIFO 只约束一个 utility，不能阻止用户双开应用。Electron Main 必须在 spawn Workspace utility 前取得应用单实例锁；未取得锁的实例不得打开活动数据库。SQLite 文件锁仍保留为最后保护，但不是多实例业务协调协议。
2. **checkpoint revision 重新绑定**：Online Backup 在另一连接写入时可能自动重启并得到更新的数据库快照。PROTECT 必须从完成后的副本读取 actual revision，并让 Library manifest/内容验证绑定该 actual revision；不得把触发时或请求时 revision 冒充快照实际覆盖范围。

## 2. 正式候选的完整定义

通过审计的不是单独的 npm/API 选择，而是以下不可拆分的组合：

1. Electron Main 在启动 Workspace 前取得全局单实例所有权；第二实例只唤醒第一实例并退出。
2. 活动数据库只由 ADR-02 的 Workspace utility process 内 `MOD-DATA` adapter 打开。
3. 初始实现只有一个长期 read-write `DatabaseSync` 活动连接；普通读取复用该连接，不建立 reader pool。
4. 所有正式写入经过一个有界 FIFO；事务体同步执行，禁止 `await`、IPC、文件 I/O、通知、backup 或领域 worker 调用。
5. 所有不可信值使用 prepared statement 参数；SQL 标识符来自固定代码，不使用 `SQLTagStore`、ORM、运行时 extension 或任意动态 SQL。
6. 每个命令以 `BEGIN IMMEDIATE` 开始，在一个事务中完成 receipt 检查、版本校验、事实、entity versions、一次 revision 推进、`CommandReceipt`、`DurableFollowUp`、Operation 和 backup watermark，再 `COMMIT`。
7. 只有 `COMMIT` 已确定成功或读取到匹配 receipt 才返回 `committed`；结果不确定时不得返回终态 `CommandOutcome`，新 epoch 通过 receipt 收敛，无法安全判定时进入 `recovery-required`，不能返回 `not-committed` 冒充已回滚。
8. `ReadSnapshot` 使用同一连接上的短 read transaction，先读当前 revision，再完全物化本次查询事实后结束；不承诺任意历史 revision 的 time-travel 读取。
9. Revision、EntityVersion 和其他 SQLite 64 位整数以 `bigint` 精确读取；Workspace DTO 使用可往返编码，禁止静默转换为 JavaScript `Number`。
10. 活动库位于本机受支持文件系统，采用 WAL + `synchronous=FULL`；连接打开时设置并验证 foreign keys、trusted schema、defensive、extension、DQS、busy timeout 等安全与持久性选项。
11. checkpoint 是唯一允许额外打开活动库连接的常规路径：使用一个短期 read-only source connection 调用 SQLite Online Backup API，输出唯一 staging 文件，完成后立即关闭。
12. checkpoint 只有在副本自身的 actual revision、数据库完整性、格式以及相同 revision 的 Library manifest/content 全部验证后才能发布。
13. restore candidate 只在独立 staging 路径以 read-only/defensive 方式验证；不得 `ATTACH` 到活动库。激活前必须停止新命令、drain 并关闭 writer、backup 和 validation 连接。
14. `node:sqlite` 类型不得越过 `MOD-DATA`；`IF-WORKSPACE`、领域模块和 IPC DTO 不出现 `DatabaseSync`、`StatementSync` 或 SQLite 错误类型。
15. 精确锁定 Electron 运行时；每次 Electron 更新都视为 Node/SQLite runtime 更新，重新执行 DATA contract、故障注入和 packaged 双平台门禁。

## 3. 审计依据与边界

审计重新核对了当前规范层级：

- 产品结果：[PROJECT_BRIEF](../product/PROJECT_BRIEF.md)、[PRD](../product/PRD.md)、[MVP_SCOPE](../product/MVP_SCOPE.md)；
- 用户行为：[User Flow](../superpowers/specs/2026-08-17-user-flow-design.md)、[UI 页面规格](../superpowers/specs/2026-08-18-courseflow-ui-wireframes-page-spec-design.md)；
- 逻辑架构：[ARCHITECTURE](../architecture/ARCHITECTURE.md)；
- Interface、状态机、FLOW、Problem 和 TEST：[MODULE_CONTRACTS](../architecture/MODULE_CONTRACTS.md)；
- 已接受运行时/部署边界：ADR-01、ADR-02；
- 生态事实：Node、Electron、SQLite 官方文档和候选库官方仓库，详见前置调研。

First Principles 边界如下：

| 问题 | 审计答案 |
|---|---|
| 用户真正需要什么 | 本地提交真实成功、重启后不丢不重、读取一致、备份失败不影响本地、恢复不产生部分成功 |
| 正式真相在哪里 | 一个本地活动 SQLite 数据库中的结构化事实，以及独立 LibraryRoot 中经验证的真实文件 |
| 信任边界在哪里 | Renderer/Main/worker 不接触活动 SQLite；restore candidate 和云盘快照是待验证输入 |
| 哪些成功不可伪造 | DB commit、Library index-committed、snapshot publish、restore reopened/reconciled |
| 如何判定方案完成 | `TEST-DATA-001–006`、`TEST-PROTECT-001–006`、相关 FLOW/Q/Gate 和双平台 packaged 证据可定位并通过 |

本审计不决定：

- table/column、constraint、index、migration、`application_id`、schema version 或 payload canonical encoding（ADR-04）；
- Watcher、文件替换和资源访问实现（ADR-05/06）；
- snapshot manifest、Library 内容打包、digest、压缩与发布（ADR-07）；
- 数据库 + Library 的 activation marker、目录切换、继续/回滚（ADR-08）；
- 错误呈现与生产日志/导出边界（后续 ADR-09 已决定不建设后两者）；
- 安装包、签名、公证和更新通道（ADR-10）。

## 4. 产品 Requirement 逐项审计

### 4.1 数据、平台与完成定义

| Requirement | 结果 | 方案 A 的落实方式与边界 |
|---|---|---|
| `A-DATA-001` 本机正式数据 | 通过 | SQLite 活动库只位于本地活动数据目录；运行和读取不依赖账户、网络或远程服务。 |
| `A-DATA-002` 三位置分离 | 通过 | 活动库拒绝云盘/LibraryRoot 路径；路径重叠与可用性由 PROTECT/PLATFORM 校验。WAL/SHM 只存在活动目录。 |
| `A-DATA-003` 未配置云盘合法 | 通过 | 本地事务与备份目的地无关；backup-needed 可持久存在，但未配置状态不循环报错、不阻塞保存。 |
| `A-DATA-004` 保存后异步备份 | 通过 | commit 只原子登记 watermark/follow-up，返回后 Online Backup 异步执行；备份失败不回滚已提交 revision。 |
| `A-DATA-005` 手工导入恢复 | 通过但依赖 ADR-07/08 | `node:sqlite` 支持独立 read-only validation 与一致数据库副本；候选验证、跨文件 stage/activate 仍由后续 ADR 完成。 |
| `A-DATA-006` 不自动合并 | 通过 | 恢复只允许显式选择整库替换；方案不引入复制日志、多主写入或 merge engine。 |
| `A-PLATFORM-001` macOS/Windows | 有条件通过 | 使用 Electron 随附的同一 Node core API，不新增 native addon；仍须真实 packaged 双平台门。 |
| `A-ATTEND-006` 外围故障不阻塞核心 | 不受阻 | ATTEND 事实可与其他结构化事实共库，但业务异常在事务前隔离；DATA 故障才按架构正确影响核心读写。 |
| `B-FILE-009` 文件失败不伪成功 | 通过 | `FileOperation` 阶段持久化在同库；磁盘动作与 index commit 不虚构为一个 SQLite 事务。 |
| `B-FILE-012` 快照包含文件及映射 | 通过但依赖 ADR-07 | DB checkpoint 提供 actual revision 的索引元数据；Library 内容必须逐项验证后才进入同 revision manifest。 |
| `MVP-DOD-002` 多视图同组正式数据 | 通过 | 一个当前 `ReadSnapshot` 和 revision 为所有模块提供一致事实；具体领域投影仍由 PLAN 等模块负责。 |
| `MVP-DOD-005` 重启完整、离线可用 | 通过 | SQLite crash recovery + receipt/operation/follow-up 持久化；运行不依赖网络。 |
| `MVP-DOD-006` 保存/备份/导入失败不损坏 | 通过但须故障注入 | 事务回滚、staging + verify + publish、activation checkpoint 分别覆盖三个失败边界。 |
| `MVP-DOD-007` 双平台同验收 | 有条件通过 | 领域和 DATA adapter 一套 TypeScript 实现；不能以 Node 本地探针代替 packaged macOS/Windows。 |
| `MVP-DOD-008` 无账户/云/AI 前置 | 通过 | binding、事务和备份源均为本机能力。 |

### 4.2 NFR 与共同状态

| Requirement | 结果 | 说明 |
|---|---|---|
| `NFR-001` 离线与不擅自上传 | 通过 | `node:sqlite` 不需要网络；Online Backup 只先写本地 staging，云盘发布由用户配置和 PROTECT 控制。 |
| `NFR-002` 可恢复写入、无伪成功 | 通过 | `COMMIT`/receipt 是唯一结构化成功证据；commit outcome unknown 不降格为普通失败。 |
| `NFR-003` 位置、版本、完整性 | 通过但依赖 ADR-04/07 | 本 ADR 决定活动库/一致 checkpoint seam；格式版本和 snapshot digest 后续决定。 |
| `NFR-004/005/008/009/011` 时间、未知、来源、规则与出席语义 | 不受阻 | SQLite 可精确保留这些类型，但含义、constraint 和 evaluator 属于领域/schema ADR，不由 binding 重定义。 |
| `NFR-006/007` 无障碍与高影响预览 | 不受阻 | DATA 返回稳定 outcome/problem/revision；Shell/Workspace 仍拥有呈现和 preview。 |
| `NFR-010` 权限/云盘失败仍可解释 | 通过 | PROTECT/LIBRARY 失败不关闭活动 DB；活动 DB 自身不可写时进入 read-only，而不是伪造 ready。 |
| `STATE-002` 失败保留输入并声明 dataEffect | 通过 | validation/rollback 返回 unchanged；commit uncertain 暂不返回成功/失败，后续通过 receipt 或 `recovery-required` 收敛；draft 生命周期不由 DATA 错误删除。 |

## 5. `MOD-DATA` 八条不变量逐项审计

| 不变量 | 结果 | 机制 | 必须验证 |
|---|---|---|---|
| 1. facts + versions + revision + receipt + follow-up 全有或全无 | 通过 | 单数据库、单 `BEGIN IMMEDIATE` transaction；所有 SQL 在同步事务体内 | 每个 statement 前后及 COMMIT 前 kill |
| 2. CommandId 幂等；不同 payload 冲突 | 通过 | receipt 表保存 CommandId、canonical payload digest、revision 和可重放 outcome；同事务写入 | 相同/不同 payload、并发与重启重放 |
| 3. commit 后通知；通知丢失不丢义务 | 通过 | follow-up/watermark 在事务内；`PostCommitChange` 在 COMMIT 返回后发送 | 通知丢失、重复、utility 退出 |
| 4. ReadSnapshot 不混 revision | 通过 | 短 read transaction 先读 revision，再物化全部事实；JS 同步段不可交错 | 并发 writer、分页、长读与 stale preview |
| 5. 失败不推进 revision/Undo/backup success | 通过 | revision、receipt、watermark 同事务；rollback 后不发通知 | constraint、BUSY、FULL、IOERR、permission |
| 6. 已知 schema/format；未知新版本停止 | 可实现，细节留 ADR-04 | open 前读取固定 header/version，未知版本进入 incompatible/recovery，不自动建空库覆盖 | 旧版、当前版、未知新版、损坏 header |
| 7. export/stage/activation 有 revision 与检查点 | 通过但依赖 ADR-07/08 | Online Backup 产生一致 DB staging；stage 与活动路径隔离；activation 前关闭连接 | backup/activation 每阶段 kill 与回滚 |
| 8. 可读不可写 read-only；不可读/激活不确定 recovery | 通过 | 分离 read-write open、read-only reopen、integrity/version/activation 检查；错误映射为 Workspace mode | 权限切换、只读卷、损坏、遗留 checkpoint |

### 5.1 `ReadSnapshot` 的能力边界

当前产品和契约要求“一个查询只使用一个 revision”，没有要求随时重开任意旧 revision。SQLite read transaction 能满足当前 snapshot，但不会自动保存历史版本。因此正式 ADR 必须写明：

- `ReadSnapshot` 建立并返回当前数据库 revision；
- preview/confirmation 绑定旧 revision 时，执行阶段重新核对；过期返回 stale/conflict 并重新预览；
- 不允许先读 revision、结束事务，再用普通查询拼接同一 envelope；
- 若未来产品要求历史 time-travel，必须新增历史事实模型并重新打开数据 ADR，不能声称 SQLite 当前 snapshot 已经支持。

## 6. `MOD-PROTECT` 与跨资源一致性审计

### 6.1 十条 PROTECT 不变量

| 不变量 | 结果 | 方案 A 的责任 |
|---|---|---|
| 1. 未配置目录合法 | 通过 | 不影响本地 commit；watermark 可存在但不重试轰炸。 |
| 2. 三位置不重叠 | 通过 | 活动 DB 路径在 open 前验证；具体路径身份/符号链接策略由 PLATFORM/ADR-07。 |
| 3. commit/index 原子推进 needed 水位 | 通过 | watermark 与相应 DB revision/index ChangeSet 同事务。 |
| 4. 合并请求但声明实际 revision/manifest | 通过，新增强制条件 | 从完成副本读取 actual revision，并以此重建/验证 manifest。 |
| 5. 临时写、验证后发布 | 通过但依赖 ADR-07 | Online Backup 目的地使用唯一 staging；ADR-07 决定原子发布和 digest。 |
| 6. 失败保留本地和旧快照 | 通过 | staging 从不覆盖上一 SnapshotId；失败不更新 success watermark。 |
| 7. 恢复完整阶段 | 通过但依赖 ADR-07/08 | `node:sqlite` 覆盖 DB stage/validation seam；安全快照与跨文件 activation 后续决定。 |
| 8. 激活前 unchanged，激活中断 recovery | 通过但依赖 ADR-08 | 所有连接先关闭；activation marker 决定 resume/rollback。 |
| 9. 不自动选最新/不合并 | 通过 | 单活动 DB + 显式用户选择。 |
| 10. B 文件与映射一致 | 通过但依赖 ADR-07 | actual revision 的 DB 索引、Library verification 与 manifest 必须同一 checkpoint。 |

### 6.2 正确的 checkpoint 组合顺序

并发安全的候选协议必须是：

```text
1. 读取/合并 backupNeededThrough 目标 T，但不把 T 当成最终快照 revision
2. 用短期 read-only source connection Online Backup 到唯一 DB staging
3. 完成后只读打开 DB staging，读取 actual revision R
4. 验证 R >= T、format/schema、quick_check/integrity_check、foreign_key_check
5. 从 DB staging 中读取 R 对应的 Library index/verification records
6. LIBRARY 按这些 records 复制并重新验证实际文件；变化、缺失或 stamp 不符则失败/重试
7. ADR-07 生成声明 R 的 manifest 并验证完整 snapshot
8. 发布 SnapshotId；仅此时推进 backupSucceededThrough 至 R
9. 若活动 revision 已超过 R，保留新的 pending 水位
```

SQLite 官方说明，使用不同连接写入时增量 backup 可能自动重启；完成结果是一致且更新的快照，但频繁写入也可能使 backup 长时间不能完成。[SQLite Online Backup](https://www.sqlite.org/backup.html) · [SQLite backup API](https://www.sqlite.org/c3ref/backup_finish.html)

这个协议避免两个错误：

- 在 backup 开始前读取 revision R，完成后仍宣称副本是 R；
- 先固定旧 Library manifest，再把已经包含新文件索引 revision 的 DB 副本与它一起发布。

### 6.3 恢复与 WAL sidecar

WAL 模式不是恢复障碍，但要求 ADR-08 遵守以下 seam：

- 不在活动连接打开时替换 `.db`；
- 不把活动 `-wal`/`-shm` 当普通备份文件 raw-copy；
- activation 前停止命令并关闭 writer、backup、validation 连接；
- staged candidate 自身完成数据库检查，不能继承活动库 sidecar；
- 数据库与 Library 文件的跨资源切换不宣称是一个 SQLite transaction，必须依赖可恢复 activation checkpoint。

## 7. 连接、并发与持久性审计

### 7.1 单 owner 与连接拓扑

```text
Electron Main
  └─ app single-instance lock
      └─ one Workspace utility process
          └─ MOD-DATA
              ├─ one long-lived read-write DatabaseSync
              └─ at most one short-lived read-only backup/validation connection
```

Electron 官方 `app.requestSingleInstanceLock()` 在当前实例取得锁时返回 true；未取得锁表示已有主实例，当前实例应立即退出。这可以直接实现全局 DATA owner 门。[Electron app API](https://www.electronjs.org/docs/latest/api/app#apprequestsingleinstancelockadditionaldata)

单实例锁不能替代 SQLite 锁；SQLite 锁也不能替代应用所有权。前者阻止第二套 Workspace/PROTECT 状态机并行运行，后者保护异常重入或外部进程下的数据库文件。

### 7.2 写入调度

- FIFO 必须有队列上限、背压和关闭/drain 语义；
- `BEGIN IMMEDIATE` 在入口取得 writer 能力，瞬时 `BUSY` 可在 bounded timeout 内等待；
- timeout 后 `BUSY` 返回 retryable `not-committed`，不能无限重试或把等待当成功；
- transaction helper 在回调返回前检查事务状态；异常时 rollback，但 COMMIT 附近的 I/O/进程故障仍按 ADR-02 的 outcome-unknown 暂态处理，不能立即返回终态失败；
- 领域验证尽可能在事务前完成；事务内只重查会竞争的 versions/token/receipt 和执行必要 SQL；
- 不为“以后可能有并发”预建 reader pool、第二 writer 或 driver abstraction。

### 7.3 WAL、checkpoint 与长查询

WAL + `synchronous=FULL` 满足本项目“commit 返回后不能在掉电时轻易丢失最近提交”的持久性目标；`NORMAL` 只保证一致性，不满足这一成功承诺。WAL 仍只有一个 writer，且长 read transaction 会阻碍 checkpoint。[SQLite WAL](https://www.sqlite.org/wal.html) · [SQLite synchronous](https://www.sqlite.org/pragma.html#pragma_synchronous)

因此必须：

- 所有 read transaction 有明确页限/窗口和持续时间预算；
- 不把 iterator 或 transaction 句柄返回给领域层/IPC；
- 监测 WAL 大小、checkpoint 结果、最老 read 和 commit p99；
- 依据 G7 决定 bounded auto/manual checkpoint 参数，不在 ADR 中猜测魔法数字；
- macOS `fullfsync` 等平台参数只在真实掉电/故障实验与设备档案支持时启用；
- active DB 拒绝网络文件系统、云盘同步目录和不受支持的锁语义。

`DatabaseSync` 无法让一个正在执行的长 SQL 为其他 utility 请求让出 event loop；方案可行依赖窗口化查询、索引、短事务和真实 G7。如果这些措施仍不能达标，应先证明瓶颈，再重新审议读取拓扑，而不是预先引入 pool。

## 8. 七条 FLOW 审计

| Flow | 结果 | 方案 A 的落实/边界 |
|---|---|---|
| `FLOW-00` 激活 | 通过 | open 时检查路径、版本、integrity、writability、activation marker；加载持久 operation/follow-up 后才发布 Workspace mode。 |
| `FLOW-01` 结构化命令 | 通过 | 单事务覆盖 ChangeSet/revision/receipt/follow-up；response loss 由 CommandId receipt 判定。 |
| `FLOW-02` 统一投影 | 通过 | 当前短 ReadSnapshot 提供同一 revision；领域 evaluator 在物化事实上运行。 |
| `FLOW-03` 文件对账 | 通过 | planned/disk-applied/index-committed 状态在 DB 中持久；SQLite 不伪造跨文件原子性。 |
| `FLOW-04` 异步备份 | 通过但依赖 actual revision 协议 | commit 不等待 backup；Online Backup + Library verification + ADR-07 publish 后才更新成功水位。 |
| `FLOW-05` 显式恢复 | 通过但依赖 ADR-07/08 | stage/DB validation 可实现；跨 DB/Library activation 必须按后续 ADR 继续/回滚。 |
| `FLOW-06` 确定性结果 | 不受阻 | 同一 DB snapshot 可提供 PLAN/ATTEND/GRADE 输入；计算语义仍归各模块。 |

## 9. 十五条质量约束与七个 Gate

### 9.1 `Q-*`

| Quality | 结果 | 说明 |
|---|---|---|
| `Q-TRUTH-01` | 通过 | COMMIT/receipt、index-committed、snapshot publish 各有独立证据，不把“已调用”当成功。 |
| `Q-CONSIST-01` | 通过 | 一个短 read transaction 对应一个 revision。 |
| `Q-TIME-01` | 不受阻 | 精确存储能力存在；TermZone 语义和编码由领域/ADR-04。 |
| `Q-STATE-01` | 不受阻 | SQLite NULL/整数不是领域状态模型；adapter 必须保留显式 union，不自行折叠。 |
| `Q-PROTECT-01` | 通过但依赖 ADR-07/08 | 一致 DB checkpoint seam 已满足；完整 snapshot 与 activation 后续决定。 |
| `Q-ISOLATE-01` | 通过 | backup failure 只降级 PROTECT；ATTEND/GRADE/LIBRARY 事务前业务故障不击穿 PLAN。DATA 故障按规定影响核心。 |
| `Q-LOCAL-01` | 通过 | 无网络、远程后端或账户依赖。 |
| `Q-PROVENANCE-01` | 不受阻 | schema/领域事实可保存版本与来源，不由 driver 推断。 |
| `Q-ACCESS-01` | 不受阻 | 稳定 outcome/problem 可供 Shell 宣布；数据库类型不进入 UI。 |
| `Q-PORTABLE-01` | 有条件通过 | 同一 core binding 和 adapter；须 packaged macOS/Windows 实测。 |
| `Q-RESPOND-01` | 有条件通过 | DB 离开 Main/Renderer，backup 异步；utility event-loop、长 SQL 和 checkpoint 仍须 G7。 |
| `Q-EVOLVE-01` | 可实现，依赖 ADR-04 | SQLite 支持版本标识和事务迁移；未知新版停止策略尚未正式定义。 |
| `Q-USABILITY-01` | 不受阻 | 本地短提交可支持设置流程；具体预算由 G7/用户旅程。 |
| `Q-CONTINUITY-01` | 通过 | receipt、operation、follow-up、draft checkpoint 可持久；重启从 DB 恢复。 |
| `Q-DIAG-01` | 通过但需错误映射 | SQLite result/extended code 在 owner 内存中映射为稳定 ProblemCode + typed safe details 后丢弃原始异常；没有 diagnosticRef。 |

### 9.2 `G1–G7`

| Gate | 审计状态 | 所需证据 |
|---|---|---|
| `G1` 追溯 | 通过 | 本报告映射 Requirement/MOD/FLOW/Q/TEST，不新增产品语义。 |
| `G2` 依赖 | 通过 | `node:sqlite` 只存在于 DATA adapter；Main/Renderer/worker 无连接。 |
| `G3` 语义 | 不受阻 | 领域状态/规则不由 binding 或 ORM 重定义。 |
| `G4` 恢复 | 方案支持，待执行 | transaction、backup、file/index、activation 全阶段 failpoint。 |
| `G5` 隔离 | 方案支持，待执行 | PROTECT/LIBRARY/ATTEND/GRADE 分别失败；PLAN 与本地 DB 按 capability 继续。 |
| `G6` 产品环境 | 未验证 | packaged macOS/Windows、禁网、权限、双开、签名/公证后的 utility SQLite。 |
| `G7` 性能基线 | 未校准 | cold open、query/commit p50/p95/p99、event-loop delay、WAL、backup、integrity check、内存。 |

## 10. `TEST-DATA-*` 与 `TEST-PROTECT-*` 证据计划

当前只有前置调研中的 Node 机制探针，没有产品实现，因此下表状态均为“方案可覆盖，正式证据待实现”。

| Test | 最小可判定证据 |
|---|---|
| `TEST-DATA-001` | transaction 每个 SQL 前后、revision/receipt/follow-up 后、COMMIT 前后 kill；重开后只能全有或全无。 |
| `TEST-DATA-002` | 同 CommandId+同 digest 并发/跨重启返回原 outcome；同 ID+不同 digest 返回 integrity/conflict。 |
| `TEST-DATA-003` | stale EntityVersion 不写；writer 并发时 ReadSnapshot 的所有实体与 envelope revision 一致。 |
| `TEST-DATA-004` | PostCommitChange 丢失、重复、乱序、utility 重启后 follow-up 仍幂等完成一次。 |
| `TEST-DATA-005` | 目录只读、数据库只读、permission、corrupt page/header、WAL recovery；分别进入 read-only/recovery，不建新空库。 |
| `TEST-DATA-006` | 当前/旧/未知新 schema、backup export、stage、activation marker、继续/回滚跨重启。 |
| `TEST-PROTECT-001` | 未配置合法；活动/Library/backup 相同、包含、Node 可观察符号链接/junction 或解析后重叠均拒绝；平台无法分类的范围不得伪装为已验证。 |
| `TEST-PROTECT-002` | 多次 needed 水位合并；unique staging → DB actual R → manifest R → verify → publish → successThrough R。 |
| `TEST-PROTECT-003` | destination exists/readonly/full/disconnected；当前 DB 和旧 SnapshotId 不变，pending/last success 正确。 |
| `TEST-PROTECT-004` | 损坏、外来、旧/未知新格式在 activation 前停止；不 `ATTACH`/写入活动库。 |
| `TEST-PROTECT-005` | RestoreSession 每阶段 kill，特别是连接关闭、activation marker、DB/Library 切换和 reopen；只 resume/rollback。 |
| `TEST-PROTECT-006` | backup 期间数据库与 Library 文件并发变化；发布物的 DB revision、records、digests、文件和标签映射完全一致。 |

额外 ADR-02/03 交叉测试：

1. COMMIT 后、utility 回应前 kill，Main/Shell 不显示成功或失败；IPC 层保持 outcome unknown，重启后以 receipt 收敛；
2. 同时启动两个 packaged app，只有持锁实例 spawn Workspace utility，第二实例不打开 DB；
3. 关闭/更新期间有 queued command、active transaction、backup 和 validation 时，有界 drain 或安全 kill 后均可恢复；
4. 记录 `process.versions.electron/node/sqlite`，验证实际打包环境所需 API 与配置读回值。

## 11. 运行时、安全与供应链审计

### 11.1 `node:sqlite` 风险

Node 官方仍把 `node:sqlite` 标为 Stability 1.2 / Release Candidate。这表示 API 已接近稳定，但仍不能按稳定核心 API 的变更承诺对待。[Node SQLite API](https://nodejs.org/docs/v24.17.0/api/sqlite.html) · [Node Stability Index](https://nodejs.org/api/documentation.html#stability-index)

截至 2026-08-19，Electron 43.4.1 随附 Node 24.18.1；Node 2026-07 安全公告中的 `SQLTagStore` iterator 问题已在 Node 24.18.1 修复。本方案仍禁止 `SQLTagStore`，只使用直接 prepared statements。[Electron stable releases](https://releases.electronjs.org/?channel=stable) · [Node 2026-07 security release](https://nodejs.org/en/blog/vulnerability/july-2026-security-releases)

控制措施：

- 精确锁定 Electron，而不是只写“Node 24”；
- DATA adapter 使用窄 API 子集：`DatabaseSync`、`prepare`、statement bind/run/get/all、`backup`、`isTransaction`、必要的 authorizer/limits；
- 不把 RC 类型泄露出 DATA，不预建通用 driver interface；
- Electron 更新必须记录 Node/SQLite 版本差异、安全公告、迁移/备份兼容和完整 contract 结果；
- 如果目标 stable Electron 缺少 API、存在未修复安全问题或 packaged 门失败，通过新 ADR 切换到预先评估的 `better-sqlite3`；运行时不得自动 fallback。

### 11.2 打开与查询安全基线

每个相关连接按用途设置并读回：

```text
read-write activity:
  readOnly=false
  defensive=true
  allowExtension=false
  enableDoubleQuotedStringLiterals=false
  enableForeignKeyConstraints=true
  bounded timeout
  PRAGMA journal_mode=WAL
  PRAGMA synchronous=FULL
  PRAGMA foreign_keys=ON
  PRAGMA trusted_schema=OFF

read-only backup/validation:
  readOnly=true
  defensive=true
  allowExtension=false
  enableDoubleQuotedStringLiterals=false
  PRAGMA trusted_schema=OFF
```

另外：

- 所有 Revision/EntityVersion statement 开启 `setReadBigInts(true)`；
- restore validation 只执行固定白名单查询、版本/完整性检查和必要 authorizer；
- extension 永不因用户数据库内容开启；
- 活动路径、staging 路径和 publish 路径使用 canonical identity 验证，不用字符串前缀比较安全边界；
- 数据库原始错误只在 DATA owner 内存中用于一次映射，随后丢弃；不进入 diagnosticRef、持久日志或上传，也不携带用户课程/成绩/路径内容。

## 12. 实际证据与未验证项

前置调研已在本地 bundled Node 24.19.0 / SQLite 3.53.3 临时目录运行 throwaway probe，证明：

- WAL/FULL + `BEGIN IMMEDIATE` 可原子保存 revision、receipt、follow-up；
- 独立 read-only source connection 可以 Online Backup，副本 `integrity_check=ok`；
- backup 期间另一个连接提交后，backup 可完成并得到一致的新 revision。

探针没有创建或修改项目代码/依赖，临时目录已清理。它只验证机制，不证明：

- Electron 43.4.1/Node 24.18.1 packaged utility 的实际行为；
- macOS Apple Silicon/Intel 与目标 Windows 架构；
- 签名、公证、ASAR、安装/更新；
- 全部故障码、掉电、磁盘满、权限、杀进程；
- CourseFlow 真实 schema、Library manifest、Restore activation；
- G7 参考数据规模和设备预算。

## 13. Findings 与处置

| ID | 严重度 | Finding | 处置 |
|---|---|---|---|
| `ADR03-AUDIT-F01` | 通过 | 没有现有 Requirement/MOD/FLOW/Q/TEST 与单本地 SQLite + 单 writer 冲突 | 可提交正式决议 |
| `ADR03-AUDIT-F02` | 强制条件 | 进程内 FIFO 不能阻止第二 app instance | Main 单实例锁必须先于 utility/DB open |
| `ADR03-AUDIT-F03` | 强制条件 | Online Backup 的最终 revision 可能晚于触发 revision | 从副本读取 actual R，并把 Library manifest 重新绑定 R |
| `ADR03-AUDIT-F04` | 明确能力边界 | SQLite current snapshot 不是历史 revision 存储 | stale 重新 query；未来 time-travel 需新 ADR |
| `ADR03-AUDIT-F05` | 风险门 | `node:sqlite` 仍是 RC 且跟随 Electron runtime | 精确版本锁、窄 adapter、升级重审、`better-sqlite3` 仅作新决议回退 |
| `ADR03-AUDIT-F06` | 性能门 | 同步长 SQL、checkpoint、频繁 backup restart 可阻塞 utility 或增加尾延迟 | 窗口/分页/索引、短 read、WAL 监测、G7；证据失败则重开拓扑 |
| `ADR03-AUDIT-F07` | 后续 ADR | SQLite 事务不能原子切换 DB + Library | ADR-08 activation checkpoint；不得承诺部分恢复成功 |

**阻断项：0。**

**正式接受前必须写入 ADR-03 的强制条件：F02–F06 以及第 2 节的完整候选定义。F07 必须作为 ADR-08 的明确义务保留，不能被 ADR-03 宣称已经解决。**

## 14. 建议正式决议

审计建议下一步把以下内容写入正式 ADR-03：

> CourseFlow 将正式结构化活动数据存放在一个本地 SQLite 数据库中。应用通过 Electron 单实例所有权确保只有一个活动 Workspace utility process；只有该进程内的 `MOD-DATA` adapter 可以打开活动库。初始实现使用 Electron 随附 Node 的 `node:sqlite`、一个长期 `DatabaseSync` read-write 连接、一个同步有界 writer FIFO 和直接 prepared SQL，不使用 ORM、连接池或 `SQLTagStore`。活动库采用 WAL + `synchronous=FULL`；写命令以不可跨 `await` 的 `BEGIN IMMEDIATE` 事务原子提交事实、entity versions、revision、receipt 与 follow-up；`ReadSnapshot` 使用有界当前 read transaction；64 位版本值精确往返。一致 checkpoint 使用短期 read-only 连接和 SQLite Online Backup API，并从完成副本读取 actual revision 后绑定相同 revision 的 Library manifest。`node:sqlite` 的 RC 与内嵌 runtime 风险由精确版本锁、DATA 边界、安全补丁基线、故障注入、G7 和 packaged macOS/Windows 门禁控制；门禁失败时以新 ADR 评估 `better-sqlite3`，不得静默降级。

用户已确认本审计推荐；规范性技术决议以 [ADR-03](../architecture/adr/ADR-03-sqlite-active-data-transactions.md) 为准，本报告继续作为前置审计证据。
