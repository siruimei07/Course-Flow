# ADR-04：Schema、迁移与兼容性一手资料研究

> 研究日期：2026-08-19
>
> 对象：`ADR-TOPIC-04`（研究时尚未决；已接受结论见 [ADR-04](../architecture/adr/ADR-04-schema-migration-compatibility.md)）
>
> 结论类型：技术事实、约束与候选方案；**不替代项目负责人作 ADR 决定**。
> 外部来源限制：仅 SQLite、Node.js、Electron 官方文档及 IETF/ECMA 标准规范。
> 后续约束：[ADR-09](../architecture/adr/ADR-09-no-production-diagnostics.md) 已决定不建设生产诊断/日志/支持包；本文中相关候选仅是历史研究，不得实现为持久诊断能力。

## 1. 研究边界与当前契约

本题的用户结果是：升级、重启、备份与恢复后，CourseFlow 只能在能识别的正式数据上继续工作；无法识别或无法安全证明兼容性时，停止普通写入并给出可解释的恢复路径。它服务于 `Q-EVOLVE-01`、`FLOW-00/01/04/05`、`TEST-DATA-006` 与 `TEST-PROTECT-004/005`。

已接受的 [ADR-03](../architecture/adr/ADR-03-sqlite-active-data-transactions.md) 已决定单一活动 SQLite owner、`BEGIN IMMEDIATE` 原子提交和 `CommandReceipt` 同事务持久化；它明确把 table/column/constraint/index、migration、canonical digest、版本兼容与 Workspace DTO 数值编码交给 ADR-04。当前 [Architecture ADR 索引](../architecture/ARCHITECTURE.md#12-adr-主题与变更规则) 同时把 snapshot format/publish 留给 `ADR-TOPIC-07`，把数据库与 Library 的 activation marker、continue/rollback 留给 `ADR-TOPIC-08`，把打包/升级运行时门留给 `ADR-TOPIC-10`。因此，本研究不把 SQLite 事务误说成 DB + Library 的跨文件原子切换。

`MOD-DATA` 已拥有 format version、export checkpoint、stage/activation seam 和 `CommandReceipt`；`MOD-PROTECT` 拥有 snapshot/restore session。启动必须在打开活动数据前判定 format/version/integrity/activation state；未知新版本必须返回 `incompatible-version`，不得自动重置。详见 [MODULE_CONTRACTS §5.7–5.8、§7.2–7.3、§8.1/8.4/8.5](../architecture/MODULE_CONTRACTS.md)。

## 2. SQLite 身份、版本与约束：可直接依赖的事实

### 2.1 三个 header 字段不应混用

| 字段 | SQLite 的定义 | 对 CourseFlow 的含义 | 不适合承担的含义 |
|---|---|---|---|
| `application_id` | database header offset 68 的 32-bit signed big-endian Application ID；SQLite 建议将它设为应用独有整数，以便工具识别文件类型。[SQLite PRAGMA](https://www.sqlite.org/pragma.html#pragma_application_id) | 快速拒绝“不是 CourseFlow 活动库/候选库”的身份哨兵；仅是**文件族**标记。 | 具体业务 schema 兼容性、snapshot manifest 身份、授权或防篡改证明。 |
| `user_version` | header offset 60 的 application-owned integer；SQLite 本身完全不使用它。[SQLite PRAGMA](https://www.sqlite.org/pragma.html#pragma_user_version) | 可作为单调的 CourseFlow structured-data format/schema level，随每个成功 migration 同事务推进。 | SQLite 内部 schema change detector；版本之外的迁移历史、feature/capability matrix。 |
| `schema_version` | header offset 40 的 schema cookie；SQLite 会在 schema 变化时自动递增，用于检查 prepared statement 是否过期。手工改值可能导致旧 schema 执行和损坏；defensive mode 下写入是 silent no-op。[SQLite PRAGMA](https://www.sqlite.org/pragma.html#pragma_schema_version) | 只读观察项。 | 绝不可作为 product migration version，绝不可由应用写入。 |

SQLite file-format 还区分自身的 schema format number（offset 44）与 WAL/rollback 的 read/write file-format version（offset 18/19）；二者都是 SQLite 文件格式，不等于 CourseFlow 逻辑格式。[SQLite database file format](https://www.sqlite.org/fileformat.html#the_database_header) 因此启动判定至少要把「SQLite 文件可读」与「CourseFlow 身份、data format、迁移能力可判定」分开。

### 2.2 `STRICT`、外键与 `CHECK` 的能力和限制

`STRICT` 是 SQLite 3.37.0（2021-11-27）起的逐表模式。它要求列显式类型，允许类型仅为 `INT`、`INTEGER`、`REAL`、`TEXT`、`BLOB`、`ANY`；非 `ANY` 写入只有在可无损转换时才接受，否则得到 `SQLITE_CONSTRAINT_DATATYPE`。`integrity_check`/`quick_check` 也会检查 STRICT 列类型。[SQLite STRICT Tables](https://www.sqlite.org/stricttables.html) `STRICT` 不改变外键、`CHECK`、`UNIQUE`、索引的语义，且 on-disk table format 相同；但带有 `STRICT` keyword 的 schema 不能被 SQLite 3.37.0 之前的 runtime 正常打开。[SQLite STRICT backward compatibility](https://www.sqlite.org/stricttables.html#backwards_compatibility)

SQLite FK 必须在**每个连接**上显式 `PRAGMA foreign_keys=ON`；默认 historically OFF 且未来/编译时默认可变，不能依赖默认值。该 pragma 不能在 multi-statement transaction 中改变；即时外键默认在 statement 末检查，`DEFERRABLE INITIALLY DEFERRED` 的外键则在 outer `COMMIT` 检查。[SQLite foreign keys](https://www.sqlite.org/foreignkeys.html#fk_enable) [SQLite deferred FKs](https://www.sqlite.org/foreignkeys.html#fk_deferred) `PRAGMA foreign_key_check` 可列出违反 FK 的记录；`integrity_check` **不会**发现 FK 错误，二者不能互相替代。[SQLite PRAGMA](https://www.sqlite.org/pragma.html#pragma_foreign_key_check) [integrity_check](https://www.sqlite.org/pragma.html#pragma_integrity_check)

`CHECK` 是写入时验证，读取时不会重新验证；亦可被 `PRAGMA ignore_check_constraints=ON` 暂时关闭。其默认冲突行为是 `ABORT`，且 table-level `ON CONFLICT` 对 CHECK 无效。[SQLite CREATE TABLE](https://www.sqlite.org/lang_createtable.html#check_constraints) 因而 `CHECK`/FK/STRICT 都是数据库内的强约束，不替代跨表领域规则、DTO runtime validation 或 restore candidate 的白名单验证。

### 2.3 表约束候选，而非预先建模

| 候选 | 获得的性质 | 代价、门或未决点 |
|---|---|---|
| 所有 CourseFlow owned tables 使用 `STRICT`，用 `TEXT` 表示 IDs/ISO time/decimal 语义，用 `INTEGER` 表示精确整数，少量原始不透明载荷用 `BLOB` 或 `ANY` | 尽早拒绝错误储存类；integrity check 也可发现类型异常。 | 必须把 SQLite >= 3.37.0 设为 `ADR-10` packaged runtime gate；各字段的真实领域类型尚未由 schema/ADR-04 决定。 |
| 只对 `Revision`、`EntityVersion`、`CommandReceipt`、operation/restore/backup 元数据等基础 DATA 表严格化 | 先为恢复和幂等边界建最强约束，降低首版迁移面。 | 同一领域会得到不一致的类型保护；需要明确哪些表不严格的理由。 |
| 正式关系使用 FK，跨 Module 稳定 ID 由 FK 或 owning module validation 保证 | 数据库可防止关键孤儿记录；在 migration/restore 时可用 `foreign_key_check` 验证。 | FK 要逐连接启用并读回；不能用 FK 偷渡模块所有权或不适当的级联删除。`CASCADE` 是否符合每项业务语义仍是 schema 决策。 |
| `NOT NULL`、`UNIQUE`、有限枚举/范围等稳定局部不变量使用 CHECK | 让非法持久状态不能通过正常写入。 | 迁移现有数据、NULL 与默认值需要显式策略；CHECK 不会在读取时补救历史/外来库。 |

## 3. 启动身份、版本与未知新版的停止策略

### 3.1 建议 ADR 需选择的判定层次

下列顺序是可讨论的启动 gate，不是已作出的格式设计：

1. 以 read-only、defensive、extensions-off 的连接打开候选；若 SQLite header/页面不可读，直接进入 `recovery`，不创建新空库。
2. 读取 `application_id`，不匹配则认定非 CourseFlow 候选（活动路径属于 L3；用户手选 restore candidate 则为 activation 前拒绝），不依赖 `user_version` 猜测。
3. 读取 application-owned format/schema level（若选择 `user_version`）及内置 `schema_migrations` 记录（若选择维护 migration ledger），检查它是否在当前 app 的 supported range。
4. 若版本等于当前，验证必需 schema shape/metadata，再做完整 `integrity_check`，**另做** `foreign_key_check`；只有正常启动的性能证据另行证明需要时，才讨论以 `quick_check` 作为较快但覆盖较少的预筛。候选 snapshot/restore activation 不应仅以 `quick_check` 接受。
5. 若旧且每一 upgrade migration 均可用，先建立可恢复前置条件，再迁移；若较新、缺失、重复或 migration chain 不可判定，返回 `incompatible-version`/`recovery-required`，不普通写入、不重置、不尝试“向下迁移”。

这符合当前 `FLOW-00` 的 mode 计算：不可读、兼容性无法判定或 activation-pending 必须进入 `recovery`；无未决 activation 时可 restore，nonterminal activation 只开放证据支持的 resume/rollback，若均不安全则不提供物理动作。[MODULE_CONTRACTS §8.1、§9.2–9.4](../architecture/MODULE_CONTRACTS.md)

### 3.2 可以采用的版本记账方案

| 方案 | 形式 | 优势 | 缺口/风险 |
|---|---|---|---|
| A：仅 `user_version` | 一个 application-owned 单调整数 | SQLite 内建、备份后自然携带、无额外表；适合严格 forward-only chain。 | 无 migration identity、applied timestamp、代码/format compatibility audit；仅靠单个数字不能解释“为何不能继续”。 |
| B：`user_version` + Bootstrap metadata | header level + 单行 CourseFlow metadata（如 Workspace identity、format contract、creation lineage） | identity、format 与 business WorkspaceId 可分离；启动能给更精确的失败分类。 | 要定义 bootstrap table 的存在/shape/不变量，并防止它被误作版本真相的第二来源。 |
| C：B + append-only `schema_migrations` ledger | user_version 是已达 level；ledger 记录 migration ID、from/to、app build、完成事实 | 支持审计、故障分类、duplicate/gap detection 与 fixture 断言。 | 有两处要保持一致；必须在同一 SQLite transaction 中写 DDL/data transform、ledger 与 user_version，且规定恢复逻辑绝不“猜补”记录。 |

SQLite 明确把 `user_version` 留给应用，而把 `schema_version` 留给 SQLite 内部机制；这支持 A/B/C 的分层，但不在官方文档中规定 CourseFlow 必选哪一种。[SQLite PRAGMA](https://www.sqlite.org/pragma.html#pragma_user_version) [SQLite schema_version warning](https://www.sqlite.org/pragma.html#pragma_schema_version)

## 4. Forward-only migration、失败中断与验证

### 4.1 SQLite 能够保证什么

所有 SQL 读写均处于 transaction；显式 `BEGIN ... COMMIT` 可把多条 DDL/DML 作为一个 unit，关闭 DB 或指定 rollback error 时会 rollback。SQLite 允许多读者但仅一个同时 writer；`BEGIN IMMEDIATE` 会立即尝试取得 write transaction，在其他 writer 已活动时可能返回 `SQLITE_BUSY`。[SQLite transactions](https://www.sqlite.org/lang_transaction.html) [transaction modes](https://www.sqlite.org/lang_transaction.html#deferred_immediate_and_exclusive_transactions)

SQLite `ALTER TABLE` 的直接能力有限（rename table/column、add column、drop column；新版本还可能增加能力），任意重构的官方安全流程是：停用 FK、开始 transaction、创建 `new_X`、复制数据、drop old、rename new、重建 index/trigger/view、`foreign_key_check`、commit，再恢复 FK。它特别警告“先改旧表名”的常见流程可能破坏 trigger/view/FK reference；完整流程也适用于加/删约束、改 type 等变更。[SQLite ALTER TABLE](https://www.sqlite.org/lang_altertable.html#making_other_kinds_of_table_schema_changes)

**重要边界**：上述官方通用流程要求在 migration 中暂时 `foreign_keys=OFF`，而 SQLite 同时规定 FK enforcement 不能在 transaction 内开关。因此若选择此流程，ADR 必须规定它在 transaction 开始前关闭、成功后重新开启并读回，以及 crash/异常时启动 gate 如何确保新连接仍显式开启 FK；不能把 `foreign_keys=OFF` 当常规 connection policy。[SQLite PRAGMA](https://www.sqlite.org/pragma.html#pragma_foreign_keys) 这是迁移专用、受限窗口，而不是放宽 ADR-03 的正常数据安全基线。

### 4.2 Forward-only 的候选政策

| 候选 | 行为 | 与当前契约的贴合度 | 需要负责人确认 |
|---|---|---|---|
| F1：活动库 in-place、每个 migration 一个不可跨 await 的事务、只升不降 | 旧版本逐级升至 current；失败则 transaction rollback，版本/ledger 不推进。 | 最小化实现；符合 ADR-03 单 writer、启动前可判定与 `TEST-DATA-006`。 | migration 是否允许很长数据 transform；migration 前是否总先做 safety backup。 |
| F2：先以 SQLite Online Backup 复制活动库到 local staging，再在 staged copy 迁移、验证，最后由 ADR-08 activation | 原库保持 active truth，migration 将用 restore-style activation 替换。 | 对不可逆/耗时 migration 的失败隔离最强，也自然复用 recovery 语义。 | 大幅接近 ADR-08 的跨文件 activation；是否值得把普通升级都变成 operation，需另决。 |
| F3：F1 为小/可证明事务，F2 仅用于已标注 high-risk migration | 根据 migration manifest 的风险级别选择。 | 风险与复杂度折中。 | 必须定义风险分类、测试和可解释规则；不要让实现自行临时选择。 |

不论选项，建议把 migration 视作普通 `CommandReceipt` 外的启动维护状态，而不是让旧命令重放时隐式触发 schema 写入。它需要自己的 deterministic migration IDs、严格 `fromVersion → toVersion` chain、目标 SQLite runtime minimum、precondition/postcondition 与 validation plan。发布后的 schema history 一旦存在用户库，只追加新 migration；不编辑或重新编号旧 migration，也不提供 silent down migration。旧 app 遇到新库按 `incompatible-version` 停止，而不是降级写入。

### 4.3 失败、中断、备份与 restore 验证

对 F1，SQLite transaction 是 database 内的原子边界：kill/异常发生在 COMMIT 前，migration DDL/DML、version 与 ledger 都应不成立；COMMIT 后则都成立。应用依旧必须在重启时重新检查 identity/version/schema/`integrity_check`/`foreign_key_check`，因为“进程没有返回结果”不等于知道 COMMIT 结果。对 F2/F3 的 staged activation，COMMIT 只解决 staged DB 内部一致，跨 DB/Library/marker 的继续或回滚仍归 ADR-08。

SQLite Online Backup 的基本成功语义是 destination 成为 source 在 copy 开始时的 bit-wise snapshot；其官方示例也说明另一个 thread/process 可同时使用 source，并需要处理 `BUSY`/`LOCKED` 和 error result。[SQLite Backup API](https://www.sqlite.org/backup.html) 并发写入可能使 copy 重新开始，故 CourseFlow 仍须从**完成副本**读取 actual `Revision`，不能沿用请求时 revision。snapshot/restore candidate 也不可因“文件能打开”即被接受：仍应执行 identity、format range、declared manifest、完整 `integrity_check`、FK checks 与 actual `Revision` cross-check；这延续 ADR-03 的 validation seam，并对应 `TEST-PROTECT-004–005`。

建议 ADR 定义的最小 failpoint evidence：

- 每个 migration 的 transaction 前、DDL 后、data transform 后、version/ledger 写前后、COMMIT 后 response 前 kill；重开结果只能是上一完整 level 或下一完整 level。
- 候选为旧、current、future、identity mismatch、缺 bootstrap metadata、ledger gap/duplicate、被篡改 version、violating FK/STRICT/CHECK、损坏的 DB/WAL recovery。
- 升级前 safety checkpoint、migration 后 checkpoint、snapshot export、stage validation、activation marker 前后 kill；只验 DB 的测试不能声称验证了 Library restore。
- 把 migration fixtures 随应用版本保留：至少能从所有仍承诺支持的 historical format 迁至 current，并验证实际 packaged macOS/Windows runtime。

## 5. IPC protocol version、structured clone 与 BigInt

ADR-02 要求 Renderer→Main 和 Main→utility 皆带 IPC protocol version、request/correlation ID、`workspaceEpoch`、版本化 DTO 与 capability；二者是独立 trust seam。它没有规定 wire representation 或 version negotiation，因此 ADR-04 必须给出停止规则，而不是假定 packaged components 永远同步。

Electron IPC 采用 HTML Structured Clone Algorithm；DOM、Node C++-backed 和 Electron C++-backed 对象不可 serialize。Electron 8 转向 structured clone，并在 Electron 9 删除旧 serialization fallback；从此发送非 cloneable object 会抛错。Electron 的变更记录还表明 BigInt 会正确 serialize，而 Buffer 到另一端表现为 `Uint8Array`。[Electron IPC guide](https://www.electronjs.org/docs/latest/tutorial/ipc) [Electron breaking changes](https://www.electronjs.org/docs/latest/breaking-changes)

Node `MessagePort`/worker message 同样按 HTML structured clone；它会去掉 prototype、non-enumerable property 与 accessor，Buffer 接收侧是 plain `Uint8Array`，class instance 是 plain object。消息在 post 时立即 clone，反序列化失败会出现 `messageerror`。[Node worker_threads](https://nodejs.org/api/worker_threads.html) 所以“cloneable”不是“保留业务类型”；跨所有 seam 仍应只接受 plain, acyclic, versioned DTO，并拒绝 function、class instance、`Error`、Map/Set、Date、Buffer/typed array（除非某个字段标准明确允许）和任意 unknown key。

### 5.1 版本协商候选

| 候选 | 规则 | 优势 | 不足 |
|---|---|---|---|
| P1：exact protocol version | Main 与 utility handshake 必须完全相等，否则 Main 不发布 ready；Renderer facade 也仅发送当前 version。 | 最少状态；最符合“打包的进程版本必须一致、未知协议停止”的 ADR-02。 | 遇到滚动替换/意外混装直接不可用；但 CourseFlow 当前没有独立 component rollout 需求。 |
| P2：version range + capability negotiation | handshake 宣告 `minSupported/maxSupported` 与 feature set，在交集内选一版。 | 以后可在短期 mixed-version 中保持兼容。 | 要维护两套 DTO/decoder、feature matrix 与回归；目前是 YAGNI，容易形成 silent downgrade。 |
| P3：exact major + independently evolved message types | envelope 的 protocol major 必须相同；每个 request/response type 有 type ID + minor/shape version，未知 type/field 明确拒绝或仅按规则忽略。 | 在同一 packaged deployment 中允许有界扩展。 | 必须精确定义 field compatibility，不能只靠 TypeScript type。 |

无论哪项，建议 handshake 在任何业务消息前完成并记录 `protocolVersion`、Electron/Node/SQLite versions、utility build ID、`workspaceEpoch`。协议不匹配应是明确 `incompatible-version`/unavailable，而非把 DTO decode exception 转为 empty result。对于 `Revision`、`EntityVersion` 等 64-bit 值，虽然当前 Electron structured clone 可传 BigInt，仍需决定 public DTO 的稳定表示：

- **BigInt-native**：在两个当前 Electron seam 上可精确传输，但 SDK/test tooling、JSON logging/export、future transport 与 command digest 都须有额外 BigInt rule。
- **decimal-string**：在 structured clone、Workspace DTO 与 manifest 中均可表示；decode 时必须是 canonical integer grammar 并做 range check，禁止转 `Number`。
- **safe Number only**：只在产品明确把每个此类值限制在 `Number.MAX_SAFE_INTEGER` 内才成立；与 ADR-03 的“不得静默转 Number”不相容，除非另有严格上限与 exhaustion plan。

## 6. `CommandReceipt` canonical payload encoding 与 digest

### 6.1 需求与官方能力

ADR-03 的幂等规则要求同一 `CommandId` + 同 canonical payload digest 重放既有 outcome；同 ID + 不同 digest 拒绝。digest 的任务不是认证攻击者，而是稳定辨别两个逻辑 command payload。它必须包含所有影响 command 语义的 field（至少 intent discriminant/payload、expected entity versions、confirmation binding 与 encoding version），并排除 transport-only requestId、timeout、observability metadata；`CommandId` 本身可由 receipt key 持有，是否进入 preimage 必须一次决定后固定。

Node core `node:crypto` 已提供 `createHash('sha256')`、`hash.update()` 与 hex/binary digest；`update` 直接接受 UTF-8 string、Buffer、TypedArray 或 DataView。它足以计算小型 command preimage 的 SHA-256，不需要新增 hashing dependency。[Node crypto](https://nodejs.org/api/crypto.html#hashupdatedata-inputencoding) 因此“hash library”不是当前的新增依赖理由。

但 `JSON.stringify` 本身不是 canonical protocol：ECMAScript 会对 BigInt 抛 `TypeError`，而普通 JSON object property order 也不是跨语言/cross-version canonicalization contract。ECMA 的算法只有在 value 自带 `toJSON` 或 replacer 改写时才能处理 BigInt；直接 BigInt 会抛错。[ECMA-262 JSON serialization](https://tc39.es/ecma262/#sec-serializejsonproperty) RFC 8785（JCS，Informational）定义了递归 key sorting、无空白、ECMAScript JSON primitive serialization 的 hashable JSON；但仅接受 IEEE-754 double 可表示的 number，并建议大整数表达为 JSON string。[RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html)

### 6.2 可选编码方案

| 方案 | 描述 | 新依赖 | 关键条件 |
|---|---|---|---|
| D1：受限自有 canonical JSON + `node:crypto` | 定义受限 DTO domain：null/bool/string、finite safe number（如仍允许）、canonical decimal integer string、array（保序）、plain object（UTF-16 code-unit key sort），拒绝 undefined/holes/NaN/Infinity/-0/function/symbol/class/cycle/Map/Set/Date/typed array；以 UTF-8 bytes SHA-256。 | 无 | 必须有固定 golden vectors 和 property tests；不要把它包装成通用 serialization framework。 |
| D2：完整 RFC 8785 JCS + BigInt-as-decimal-string contract | payload 在 digest input projection 中将所有 64-bit `bigint` 显式转 canonical decimal string；按 JCS 递归 sorting。 | 可为零（小型、严格依据 RFC 的 implementation），也可引入 audited library。 | RFC 8785 是 informational；需测试 Unicode/number edge vectors，严格区分 business string 与 typed integer string，避免 global `BigInt.prototype.toJSON` mutation。 |
| D3：tagged canonical binary encoding | 规范 scalar tag、length、UTF-8、array/object field order 和 signed 64-bit bytes，再 SHA-256。 | 可为零 | 消除 JSON number/BigInt ambiguity，但自定义 binary spec、debuggability 和跨语言审计成本更高；当前无多语言/remote protocol 需求。 |

在当前 Electron + TypeScript 单应用、payload 规模小、没有网络 interop 的范围内，D1 或严格取子集的 D2 都能避免依赖；是否要宣称 RFC compatibility 是项目负责人选择。无论选项，digest record 需持久保存 `digestAlgorithm`、`canonicalEncodingVersion` 和 digest bytes/hex，而非只保存裸 hash：未来改变 encoding 时，同 `CommandId` 比较必须仍能确定使用的旧规则，或按明确 incompatible policy 停止。

## 7. 数据格式、快照/恢复与 ADR-07/08/10 的边界

| 问题 | ADR-04 可定义 | 必须留给其他 ADR |
|---|---|---|
| 活动 SQLite identity / structured format | `application_id` 的分配与验证、format/schema version 含义、supported range、migration chain、unknown future stop、receipt canonical encoding、IPC DTO encoding。 | 活动目录选择、文件系统 canonical identity（ADR-05/06）。 |
| snapshot format | snapshot 所含 DB 要与声明的 CourseFlow format 兼容；restore validation 要检查其 identity/version/migration possibility。 | manifest layout、文件内容、content digest、compression、temporary write 与 publish-atomicity（ADR-07）。 |
| restore | staged DB 能否打开、format migration/validation 何时发生、incompatible candidate 的 Problem。 | safety snapshot、activation marker、DB + Library 切换、crash 后 resume/rollback 的跨资源 state machine（ADR-08）。 |
| shipped runtime/update | migration requires which SQLite syntax/features、IPC minimum version、upgrade/downgrade app policy 与 test matrix。 | Electron exact version、signing/notarization/installer/updater、retained historical app support window（ADR-10）。 |

这意味着 snapshot manifest 应在 ADR-07 中明确声明至少 `snapshotFormatVersion`、structured DB `application_id`/format version、actual revision、manifest digest algorithm/version；ADR-04 只定义被它引用的 structured data compatibility predicate，不能独自断言“snapshot 已可发布”。Restore 应在 activation 前先验证候选；若候选较旧，可选择「先 stage 后 migrate」或「先 migrate staged DB 后 activation」，但 activation 的唯一真相与 rollback checkpoint 仍由 ADR-08 负责。

## 8. 当前性、版本风险与需要按发布复核的事实

1. SQLite 官方明确警告 PRAGMA 集合会随 release 改动，未知 pragma 静默忽略；所以应用必须对安全/required pragmas **set then read back**，而不是仅发出字符串。[SQLite PRAGMA caveats](https://www.sqlite.org/pragma.html) `foreign_keys` default 也明确可能变化，必须逐连接设置。
2. `STRICT` 的最小 SQLite runtime 是 3.37.0；若接受它，`ADR-10` 必须把 packaged Electron embedded SQLite 实际版本纳入 macOS/Windows gate。SQLite 3.53.0 在 2026-04 新增 `ALTER TABLE ... ALTER COLUMN`，说明不可在 ADR-04 假设历史/未来 Electron 所带 SQLite 都有新 DDL；migration 应优先使用已验证的兼容子集或按 runtime gate 锁定。[SQLite ALTER TABLE](https://www.sqlite.org/lang_altertable.html)
3. Electron official `latest` docs 指向开发前沿，官方 README 明说若非稳定对应版本，文档可能含与安装 Electron 不兼容的 API；本研究的 structured-clone/BigInt 历史事实适用于 Electron 9+，但 release 仍应以锁定版本的 docs 与 packaged probe 复验。[Electron docs guide](https://www.electronjs.org/docs/latest/README)
4. `node:sqlite`、Electron bundled Node 与 bundled SQLite 会一起随 Electron 升级；ADR-03 已把 `node:sqlite` 定为 RC，并要求精确 runtime version 与升级回归。ADR-04 不得以网页研究代替 packaged runtime 对 `application_id`、STRICT、FK、DDL、BigInt clone、digest vectors 与 historical migration fixtures 的实际验证。
5. RFC 8785 是 Informational 而非 Standards Track，适合用作明确 canonical JSON 算法来源，但项目须自行版本化其 profile，特别是 BigInt/decimal-string tagging 和拒绝的 JavaScript values。[RFC 8785 status](https://www.rfc-editor.org/rfc/rfc8785.html)

## 9. 未决选择清单（供 ADR-04 决策）

1. 采用 A/B/C 哪个 version ledger；`application_id` 的唯一常量如何登记、Workspace identity 放 header 还是 metadata。
2. 是否全表 `STRICT`，以及 ADR-10 要锁定的 SQLite minimum；FK 覆盖范围、deferred FK 的准入规则和级联删除政策。
3. F1/F2/F3 哪个 migration execution policy；哪些 migration 需要 pre-migration safety snapshot、staging 或 explicit recovery operation。
4. current/old/future/malformed/identity-mismatch 的精确 Workspace mode、ProblemCode 和用户可用动作；旧 app 打开新格式时是否一律 read refusal（研究建议：是）。
5. P1/P2/P3 哪个 IPC compatibility contract；DTO 是否将 all 64-bit semantic values 统一为 decimal string，或使用 BigInt-native。
6. D1/D2/D3 哪个 `CommandReceipt` canonical encoding；payload inclusion/exclusion list、encoding/version persistence、SHA-256 digest representation 与 golden test vectors。
7. ADR-07 manifest 需要声明哪些 ADR-04 structured compatibility fields，以及 restore candidate 的 migration 在 stage 前、stage 内还是仅新建 snapshot 后发生。
8. ADR-10 支持多少历史 application/data formats、Electron/Node/SQLite 版本锁与升级 rollback policy；这些决定 migration fixture 的长期维护量。

## 10. 建议 ADR-04 后续验证证据

- `TEST-DATA-006`：每个 supported old level upgrade 至 current、current reopen、future/unknown/malformed level stop、application ID mismatch、version ledger gap/duplicate、FK/STRICT/CHECK/integrity failure。
- `TEST-DATA-001/002`：migration transaction 与 `CommandReceipt` canonical digest 彼此不破坏；同 `CommandId` same logical payload 重放原 outcome、不同 typed payload 被拒绝，并包括 BigInt/decimal boundary、key ordering、Unicode、optional-field presence/absence vectors。
- `TEST-PROTECT-004/005`：旧/current/future snapshot candidate 的 validation、staged migration、activation marker 前后 failpoint、resume/rollback；确认 DB-only migration 没被误报为完整 Library restore。
- IPC contract：Renderer↔Main、Main↔utility handshake mismatch、unknown message/type/field、clone failure、BigInt/decimal exactness、epoch change 与 response lost；每项在 locked packaged macOS/Windows runtime 执行。
- 每次 Electron/Node/SQLite 更新：记录 `process.versions`，重跑 migration fixtures、schema/open validation、online backup/restore candidate validation、canonical digest golden vectors 与 IPC exactness probe。
