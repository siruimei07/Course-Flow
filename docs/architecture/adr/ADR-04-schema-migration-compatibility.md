# ADR-04：Schema、迁移与兼容策略

- 状态：已接受
- 日期：2026-08-19
- 决策主题：`ADR-TOPIC-04`
- 前置决策：[ADR-01](./ADR-01-desktop-runtime-ui-boundary.md)、[ADR-02](./ADR-02-process-thread-deployment.md)、[ADR-03](./ADR-03-sqlite-active-data-transactions.md)
- 后续已接受决策：[ADR-05](./ADR-05-library-watching-index-file-operations.md)（补充 LIBRARY root/path/operation 持久字段语义，不改变本 ADR 的 schema level 与迁移政策）
- 上游规范：[PRD](../../product/PRD.md)、[MVP_SCOPE](../../product/MVP_SCOPE.md)、[Architecture](../ARCHITECTURE.md)、[Module Contracts](../MODULE_CONTRACTS.md)
- 调研证据：[Schema、迁移与兼容性一手资料研究](../../research/adr-04-schema-migration-compatibility-research.md)

## 1. 背景

ADR-03 已选择一个由 `MOD-DATA` 独占的本地 SQLite 活动库、`BEGIN IMMEDIATE` 正式提交、全局 `Revision`、实体版本、幂等 `CommandReceipt`、持久 follow-up 和一致 checkpoint seam。它有意没有决定：

- CourseFlow 数据库身份、schema level、表/列/约束/索引；
- 首次建库、升级、降级、损坏和未知新版的启动行为；
- PLAN、ATTEND、LIBRARY、GRADE 与共同恢复协议如何映射到关系 schema；
- 跨 IPC/worker seam 的精确整数、精确小数和版本化 DTO；
- `CommandReceipt` payload 的 canonical encoding 与 digest；
- 旧活动库、旧快照和新应用之间的兼容边界。

这些决定必须同时满足 `Q-TRUTH-01`、`Q-CONSIST-01`、`Q-EVOLVE-01`、`Q-CONTINUITY-01`、`Q-PROTECT-01`、`Q-LOCAL-01`、`Q-PORTABLE-01` 与 `Q-DIAG-01`。CourseFlow 还没有需要继承的正式旧库；`ATTEMPT.md` 是归档证据，不是兼容基线。但从第一个公开安装包开始，数据库、备份、快照或公共接口一旦可能承载用户数据，就必须保持可读或具有显式、可测试的迁移，绝不静默重置。

## 2. 决议摘要

CourseFlow 采用**按领域归一化的关系 schema、单调连续的 schema level、逐级前向迁移和严格停止策略**：

1. 固定 `application_id` 标识 CourseFlow SQLite 文件族；`PRAGMA user_version` 是 schema level 的唯一真相。
2. 所有 CourseFlow 自有表均为 `STRICT`；正常连接始终启用即时外键，删除默认 `RESTRICT`。
3. 正式事实存入领域关系表；Occurrence 与投影按窗口确定性派生。除版本化草稿 payload 外，不使用通用 JSON、EAV、事件仓库或 `extra_json`。
4. schema migration 仅按 `vN → vN+1` 前向执行。迁移前生成并验证本地安全数据库副本，每一级在独立 `BEGIN IMMEDIATE` 事务内完成。
5. 新应用可升级已支持的旧库；升级后的库不会被旧应用打开。降级必须由用户显式恢复迁移前安全副本，不自动反向迁移。
6. Renderer ↔ Main 与 Main ↔ Workspace 使用精确 protocol/build handshake；不允许混合版本组件或范围协商。
7. 64 位整数与精确小数在公共 DTO 中使用 canonical 十进制字符串；持久小数使用规范化 coefficient + scale，不使用 SQLite `REAL` 或 JavaScript 浮点数作为事实。
8. Command digest 使用项目自有的受限 `courseflow-canonical-json-v1` + Node core SHA-256，并永久记录 encoding 与 algorithm 版本。
9. Snapshot format、跨数据库/Library 激活和 packaged runtime 分别由 [ADR-07](./ADR-07-snapshot-format-integrity-publication.md)、[ADR-08](./ADR-08-restore-activation-recovery.md)、[ADR-10](./ADR-10-packaging-signing-update.md) 完成；本 ADR 只规定它们必须引用和验证的 structured-data compatibility predicate。

## 3. 数据库身份、版本与首发冻结

### 3.1 文件身份

CourseFlow 活动库和候选数据库使用：

```text
application_id = 0x43464C57
decimal        = 1128680535
ASCII hint     = CFLW
```

该值在接受日未出现在 SQLite 官方 [Application File-Format Magic Numbers](https://sqlite.org/src/artifact?ci=trunk&filename=magic.txt) 列表中。它在首个公开 v1 前仍必须重新核对并按 SQLite 建议登记；若届时发生冲突，可在尚无公开数据前修订本 ADR。首个公开库发布后，此值永久冻结。

`application_id` 只是文件族哨兵，不是 Workspace 身份、schema level、安全签名或 snapshot format。`WorkspaceId` 存在 `workspace_state` 中。

### 3.2 Schema level

- `PRAGMA user_version` 是 CourseFlow structured-data schema level 的唯一真相。
- level 为连续正整数：`1, 2, 3, ...`；不得跳级、复用或按产品 SemVer 编码。
- `PRAGMA schema_version` 仅由 SQLite 管理，CourseFlow 不写入，也不把它当迁移版本。
- 不建立 per-database `schema_migrations` ledger。迁移 ID、from/to、代码、校验和历史 fixture 随应用源代码和安装包保存。
- `workspace_state` 不复制 schema level，避免两个版本真相。
- 文件不存在或由当前初始化流程明确创建的空 staging 库可以处于 level 0。任何已经存在且非空的 level-0 文件都不得被自动“收养”为 CourseFlow 库。

### 3.3 正式 v1 冻结

公开 schema level 1 只包含第一个公开安装包**实际交付**的模块：

- `MVP-A` 必须存在；
- `MVP-A-P`、`MVP-B`、`MVP-C1` 只有在该安装包真实交付时才进入 level 1；
- 未交付模块不预建空表、空字段、能力开关或兼容层；
- 后续真实交付通过新的连续 migration 增加；
- 已公开后，即使功能后来移除，其用户数据仍须被读取、保留并随链迁移。

公开基线冻结前，开发数据库可以重建；公开基线冻结后，历史 migration 与 fixture 只能追加，不能改写。

## 4. Schema 总体形态

### 4.1 关系模型与事实边界

- 每个领域拥有自己的归一化关系表；跨模块只保存 Architecture 已批准的稳定 ID 引用。
- 正式投影、Today/Week/Calendar、成绩汇总、出席统计、目录标签和 setup 当前完整度都可从事实重建，不作为第二份真相持久化。
- 不建立通用 entity registry、EAV、event store、通用 property bag、通用 operation payload 或预留字段。
- 不使用 `extra_json`。确有新事实时，通过 migration 建立带所有者、约束与查询理由的字段或表。
- 唯一允许的不透明核心 payload 是 `draft_checkpoints.payload`。它以有界 BLOB 保存，由 `draft_kind + draft_schema_version` 解释；DATA 不查询其业务字段，也不把它提升为正式事实。
- common operation/follow-up 表只保存共同状态；各 owner 的业务细节进入有类型的 detail 表。
- 每个可独立并发修改的 aggregate root 持有自己的 `EntityVersion`；Segment、band 等只随 aggregate 一起修改的 child row 跟随 root version，不建立通用实体/version registry。

### 4.2 共同协议表

下表规定最低持久语义；实际 DDL 可以选择不改变语义的列名组织，但不得删除约束、合并不同状态或增加通用 payload：

| 表族 | 必须持久的语义 | 关键约束 |
|---|---|---|
| `workspace_state` | 单例键、`WorkspaceId`、当前 `Revision` | 恰好一行；WorkspaceId 不变；Revision 非负并只在正式边界推进 |
| `command_receipts` | `CommandId`、intent schema、canonical encoding、digest algorithm、32-byte digest、committed revision、可选 OperationId | CommandId 唯一；一经提交终身保留；不存 UI 文案 |
| `receipt_effects` | receipt、稳定 effect code、顺序、typed `EntityRef` | effect 顺序稳定；引用随 receipt 保留 |
| `durable_followups` | FollowUpId、owner、kind、prerequisite revision、state、retry/terminal 状态、own version | owner/kind 判别式受约束；业务字段进入 typed detail |
| `operations` | OperationId、owner、kind、phase/state、operation version、data effect、capabilities | phase 变化幂等；文件/备份/恢复细节分表 |
| `draft_checkpoints` | DraftId、kind、draft schema version、payload、byte size、draft version | 有界；不推进 Revision；不参与正式投影 |
| `protection_watermarks` | 单例 `backupNeededThrough` 与 `backupSucceededThrough` | succeeded 不超过当前 Revision；成功水位不因失败倒退 |
| `setup_state` | `everReachedMinimum`、显式 skip/later 与 setup decision version | 当前 setup 完整度从领域事实派生；不以页面序号为事实 |
| `backup_configurations` / `backup_state` | 用户确认的保护配置、能力状态与所引用的 typed destination | 设备资源仍需 PLATFORM 再验证；不复制 snapshot manifest |
| typed backup/restore detail | common OperationId、候选身份/版本、验证与 preview binding、RestoreSafetySet reference、stage 和 next capability | 与 `operations` 一对一/受约束关联；不使用通用 manifest JSON |

validation、conflict、constraint 或明确未提交的命令不写 receipt，因为没有可重放效果；调用方必须在当前事实上重新校验。已提交 receipt 不按时间清理。

### 4.3 PLAN

PLAN schema 至少由下列关系组成：

| 表族 | 必须持久的事实 |
|---|---|
| `plan_state` | 单例可选 `current_term_id`；最多一个 Current Term 的自然事实 |
| `terms` | TermId、名称、起止 LocalDate、IANA TermZone、EntityVersion、历史保留状态 |
| `courses` | CourseId、TermId、展示字段、归档状态、EntityVersion、教学范围意图（inherit-term 或 explicit）及精确/未知 credits |
| `holiday_ranges` | HolidayRangeId、TermId、名称、包含首尾的起止 LocalDate、tombstone/EntityVersion |
| `meeting_series` / `meeting_segments` | 稳定 SeriesId、CourseId、retired/version；不重叠规则段、有效范围意图、LEC/TUT/PRA、weekday、本地起止时刻、跨日 offset、地点 union |
| `task_series` / `task_segments` | 稳定 SeriesId、CourseId、retired/version；once/weekly 判别式、规模、Deadline union、范围与 followTeachingWeek |
| meeting/task occurrence override | SeriesId + 原始 logical anchor；inherit/replaced/TBA/cancelled 等显式判别式 |
| `task_occurrence_states` | TaskSeriesId + 原始 anchor 的当前 pending/completed/skipped、可选 progress、EntityVersion |
| `task_state_history` | 只保存状态/进度更正与 Undo 所需历史，不成为通用 event store |

规则：

1. Term、Course、Holiday、Series、Segment 与 override 都使用稳定身份；标题、日期文本、排序和投影行号不是身份。
2. Course 与 Series 必须同时保存“继承上级范围”或“显式范围”的意图，不能只保存当时算出的有效日期。
3. 同一 Series 的 Segment 不得重叠。“本次及未来”在 logical anchor 处分割旧段，旧段在锚点前结束，新段从锚点开始；历史段不被覆盖。
4. 普通 Occurrence 不落表。其逻辑身份是 `(SeriesId, originalLogicalAnchor)`；Meeting/weekly Task 的 anchor 是原始 LocalDate，once Task 的 anchor 是稳定标记 `once`。物理引用保存这个 typed tuple，不以当前显示日期生成新身份。
5. Deadline 使用 `TBA | date-only(LocalDate) | timed(Instant + display ZoneId)` 判别联合；Location 的 known/TBA 也显式区分。
6. 未触碰 TaskOccurrence 没有 state row，等价 pending。显式完成、跳过、进度与恢复保持不同；完成投影为 100%，Undo 恢复完成前进度。
7. HolidayRange 每个连续范围一行，不展开成每日事实。
8. Course 只归档；Holiday 删除保留 tombstone/revision，以支持 receipt、影响与历史。被外围记录引用的 Series/Occurrence 不级联删除。
9. Course/Term/Segment 范围包含关系、Segment 不重叠和跨表 union 由 PLAN 在同一正式事务中验证；数据库以外键与局部 CHECK 作为最后防线。

### 4.4 ATTEND

ATTEND schema 只在 `MVP-A-P` 实际交付的 schema level 出现：

| 表族 | 必须持久的事实 |
|---|---|
| `attendance_windows` | AttendanceWindowId、openedAt Instant、TermZone opening LocalDate、effectiveFrom Instant、可空 closedAt Instant、EntityVersion |
| `attendance_records` | MeetingSeriesId + original LocalDate anchor、unmarked/attended/missed、changedAt、EntityVersion |

规则：

1. 不保存 `enabled` boolean；最多一个 `closedAt IS NULL` 的窗口就是当前启用事实，窗口不得重叠。
2. 窗口为半开区间 `[effectiveFrom, closedAt)`。首次开启，或前一窗口在更早 TermZone LocalDate 关闭时，`effectiveFrom` 是开启日本地 00:00；同日关闭后重开则是实际重开 commit Instant。
3. Disable 的 `closedAt` 是该命令的 commit Instant。开始 Instant 不早于它的 Occurrence 不产生义务；此前已经具备资格或已有记录的 Occurrence 保留。
4. 缺少 eligible record 表示隐式 unmarked；用户执行 reset 后保留显式 unmarked row，以保存 EntityVersion 与 Undo 语义。
5. Occurrence 是派生值，不能被 SQLite FK 引用。record 外键引用 MeetingSeries，并保存 original anchor；ATTEND 用 PLAN 同一 ReadSnapshot 验证 canonical occurrence、窗口、取消和假期资格。
6. 后续 PLAN 变化使旧 record 不再 eligible 时，记录仍保留并在投影中排除或标记 invalidated，不静默删除。
7. 出席率、覆盖率和 Today overlay 从同一 Revision 派生；ATTEND 只依赖 PLAN，PLAN 不依赖 ATTEND。

### 4.5 LIBRARY

LIBRARY schema 只在 `MVP-B` 实际交付的 schema level 出现：

| 表族 | 必须持久的事实 |
|---|---|
| `library_state` | 单例 LibraryRootId、RootGeneration、current root、marker/path-key/object-evidence version、LocationAssessment/必要 attestation、capability、last complete scan、EntityVersion；不保存目录内容 |
| category 与 directory mapping | 可修改的五个默认分类，以及 Term/Course/Category 各自的稳定目录映射 |
| `library_records` | FileId、current root、versioned canonical relative-path key、file name、mapped refs 或 unassigned placement、lifecycle、versioned verification/object evidence、EntityVersion |
| `custom_tags` / `file_custom_tags` | 用户标签和 FileId 多对多关系 |
| typed `file_operations` | operation kind/payload version、RootGeneration、planned/disk-applied/index-committed/reconcile、精确 temp/recovery role 与恢复 capability 所需字段 |

规则：

1. “考试、笔记、作业、练习、其他”是普通可修改的 seeded category data，不是写死在通用字段中的特殊分支。
2. 同一 root 内 active record 的 canonical relative-path key 唯一；编码、大小写/Unicode、对象证据、marker 和 RootGeneration 语义以 [ADR-05](./ADR-05-library-watching-index-file-operations.md) 为准。
3. Term/Course/Category 的目录派生标签不重复存入 custom tag 关系。
4. 外部缺失产生 missing/unverified；布局外普通文件保存 unassigned placement；应用内删除产生 retired tombstone。Watcher 只是重扫提示，scan 只有在磁盘验证后提交索引事实。
5. 数据库不保存文件内容、预览、绝对路径列表或搜索结果真相。首版使用有索引的文件名/窗口查询；没有证据前不增加 FTS。

### 4.6 GRADE

GRADE schema 只在 `MVP-C1` 实际交付的 schema level 出现：

| 表族 | 必须持久的事实 |
|---|---|
| `grading_schemes` | GradeSchemeId、CourseId、direct-weight kind、active/retired、EntityVersion |
| `grading_items` | GradingItemId、scheme、名称/顺序、known/unknown weight、score union、可选 typed GradeTaskRef、EntityVersion |
| `grade_scale_versions` / band rows | immutable GradeScaleVersionId、source kind/URL/year/verified date/parent，以及固定 A+…F bands 的 exact minimum/GPA |
| term default / course binding | Term 的 future-default 选择；Course 对一个确切 immutable GradeScaleVersionId 的显式绑定 |
| manual final / school record facts | 用户手工 final 与 user-attested school record 分表保存各自时刻、来源和 EntityVersion |

规则：

1. 每个 Course 最多一个 active direct-weight scheme。
2. Weight 为 known exact decimal 或 unknown。Score 为 `ungraded | points-incomplete | points(earned,max) | direct-percent`；零分是明确 scored fact。
3. points 的 max 必须大于 0；earned 与 direct-percent 非负并可高于 100，以表达 extra credit。
4. GradeTaskRef 只能是 `none | task-series | task-occurrence`；occurrence ref 保存 series + anchor，并验证同 Course。
5. GradeScaleVersion 不就地编辑；修改创建新 ID。bands 的 code、连续性、minimum 单调和 GPA 对应由 GRADE 验证，数据库约束局部类型/唯一性/范围。
6. 修改 Term default 只影响未来新建的显式 binding，不重绑既有 Course。
7. 单科结果、coverage、weighted points 与 SGPA 从同一 ReadSnapshot 派生；不保存 current-result cache 或 Term overall percentage。
8. 不为 `EXT-C2/C3` 创建字段、表或空入口。

## 5. 物理值、约束与索引

### 5.1 SQLite 类型

所有 CourseFlow 自有表都以 `STRICT` 创建。[ADR-10](./ADR-10-packaging-signing-update.md) 要求锁定实际 bundled SQLite，并在 packaged macOS/Windows 中验证其不低于 3.37.0；运行时不满足时停止启动，不以非 STRICT schema fallback。

| 语义 | 物理表示 |
|---|---|
| 稳定实体 ID | lowercase canonical UUID syntax 的 `TEXT`；Occurrence 使用 typed SeriesId + anchor tuple |
| Revision / EntityVersion / 其他 64 位计数 | 非负 SQLite `INTEGER`，由 `node:sqlite` 以 `bigint` 读取；接近 signed 64-bit 上限时停止写入并进入 recovery |
| exact decimal | `coefficient INTEGER + scale INTEGER`；`0 ≤ scale ≤ 6`、最多 18 个 significant digits、规范值不得保留小数尾零 |
| LocalDate | canonical `YYYY-MM-DD TEXT` |
| LocalTime | canonical `HH:mm TEXT` |
| Instant | canonical UTC RFC 3339 millisecond `YYYY-MM-DDTHH:mm:ss.SSSZ TEXT` |
| ZoneId | canonical IANA identifier `TEXT`，由锁定 tzdb/ZoneRules 验证 |
| boolean | `INTEGER` 0/1 + CHECK |
| enum / union | 稳定 text discriminator + CHECK；不适用的分支列必须 NULL，适用列必须 NOT NULL |
| digest / opaque draft | 定长 digest 或有界 payload 使用 `BLOB` |

精确小数不以 SQLite `REAL`、JavaScript `Number` 或预先舍入的显示值保存。所有等级边界、权重、分数、学分和 GPA 先进行精确运算，最后仅在 UI 格式化。

### 5.2 约束政策

- 所有局部必填、enum、union、非负、范围、coefficient/scale、date/time 形状使用 NOT NULL/CHECK/UNIQUE。
- 所有 ownership/reference 使用外键；外键默认为即时检查、`ON DELETE RESTRICT`，并为 child FK 建立查询所需索引。
- 不使用 deferred FK、级联删除、业务 trigger、generated column、`writable_schema` 或 `WITHOUT ROWID`。
- 跨行、跨表、时间区、重叠、等级连续性、权重汇总和跨模块资格由语义 owner 验证，并与 expected EntityVersion 在事务内重查。
- NULL 只表示该 union 分支不适用或字段确实未提供；unknown、TBA、ungraded、unmarked、missing、failed 和 not-applicable 必须使用不同判别状态。
- ID、protocol code 和 enum 使用 binary equality；不以 SQLite `NOCASE` 定义用户文本或跨平台路径身份。
- 不增加通用 `created_at/updated_at/deleted_at` 审计列。只有产品、恢复、来源或状态机实际需要时才保存相应 Instant。
- 索引只服务已定义的 current-term、窗口化投影、稳定引用、receipt/operation lookup、active uniqueness 和 Library 查询。G7 证据出现后再增加或修改索引。

## 6. Revision、草稿与操作边界

下列用户或系统 intent 产生正式结构化事实时，必须经 command receipt 原子推进一次 Revision：

- PLAN、ATTEND、GRADE 的用户确认事实；
- LIBRARY 经磁盘验证后的索引提交；
- Workspace/setup/PROTECT 的明确配置、skip/later 或 formal setup decision。

Migration 不是可由调用方重放的业务 command，因此不伪造 CommandId 或 receipt；每个成功的 `vN → vN+1` 仍是一个独立正式边界，在同一 migration transaction 中推进一次 Revision 和 `backupNeededThrough`。

下列变化不推进全局 Revision：

- 未提交 DraftCheckpoint 的保存、删除和 draft version；
- Operation 的计划、执行、retry、problem、terminal phase 变化；
- DurableFollowUp 的 retry/完成状态；
- `backupSucceededThrough` 推进、健康状态、workspaceEpoch、页面筛选或缓存；
- 纯投影和 watcher 提示。

如果一个 Operation 到达正式事实边界，该边界本身仍通过一个正式 commit 推进 Revision；后续物理阶段只推进 operation version。`backupNeededThrough` 只在正式 commit 或 migration 中推进。SQLite checkpoint 可能物理包含 DraftCheckpoint，但 snapshot success 只承诺正式事实、持久 operation/follow-up 和恢复协议；不兼容草稿必须可导出或丢弃，不能使正式快照无效。

单一 DATA writer 仍把正式 fact transaction、draft transaction 与 operation/follow-up transaction 作为三类边界处理；不得为复用一个全局事务 helper 而让草稿或 retry 意外推进 Revision。

## 7. 初始化、打开与迁移

### 7.1 新建 Workspace

1. 在本地唯一且原先不存在的 staging 路径创建数据库。
2. 设置 `application_id`，从 code-owned `0 → 1 → ... → current` 链建立实际交付模块。
3. 写入唯一 `workspace_state`、初始 Revision 和必要 bootstrap facts。
4. 设置并读回 `user_version`，执行完整 schema/identity/integrity/FK/manifest 校验。
5. 只有验证通过后，才按 [ADR-08](./ADR-08-restore-activation-recovery.md) 的激活协议成为活动库。

不得把部分 level-0 或半初始化数据库作为活动 Workspace 打开。

### 7.2 每次打开的验证顺序

每次活动库、backup DB checkpoint 或 restore candidate 打开都至少验证：

1. 路径和文件种类符合调用场景，SQLite 可只读打开；
2. `application_id` 精确匹配；
3. `user_version` 属于 current、code-owned supported old levels 或明确 future；
4. 当前 level 对应的 required table、column、FK 与 index manifest 精确匹配；
5. `workspace_state` 单例、WorkspaceId、Revision、watermark 与关键 bootstrap 不变量；
6. `integrity_check` 与 `foreign_key_check`；STRICT/CHECK/union 不变量按 manifest/领域验证补足；
7. 正常连接的 `foreign_keys=ON`、`trusted_schema=OFF` 等 ADR-03 设置已经 set/read-back；
8. 是否可安全写以及 ADR-08 external activation coordination 是否未决。

只验证“能执行 SELECT”不构成兼容。缺表、缺索引、未知列形态、篡改 level、wrong ID 或不一致 bootstrap 都停止领域访问。

### 7.3 Forward-only migration

对一个可识别、可写且属于 supported old level 的活动库：

1. 停止新领域命令并 drain DATA writer。
2. 使用 ADR-03 的一致 checkpoint seam 生成本地、独立、原先不存在的 migration safety DB copy。
3. 只读重开副本，验证 application ID、source level、WorkspaceId、actual Revision、`integrity_check` 与 `foreign_key_check`。
4. 对每一级依次执行 code-owned `vN → vN+1`：
   - `BEGIN IMMEDIATE`；
   - 重查实际 `user_version = N` 和 manifest；
   - 执行该级 DDL/DML 与数据不变量转换；
   - 推进一次 Revision，更新 `backupNeededThrough`；
   - 设置 `user_version = N+1`；
   - 验证目标 manifest 与领域不变量；
   - `COMMIT`。
5. 全链完成后，以新连接重新执行 §7.2 完整验证；只有通过后 Workspace 才可 ready/read-only。

若某一级需要 SQLite 官方 table-rebuild 流程，maintenance connection 可以在事务外临时设置并读回 `foreign_keys=OFF`，但必须只执行 code-owned SQL，在 COMMIT 前运行 `foreign_key_check`；COMMIT 后重新设置并读回 `foreign_keys=ON`，随后立即关闭该连接。任何正常业务连接都不得继承该例外。

每一级独立原子，因此中断后以已提交的 `user_version` 继续下一步，不猜测、跳级或回放已提交级别。任何失败保留原活动库或明确的最后提交 level 以及已验证 safety copy，并进入 recovery；绝不删库重建。

迁移 safety copy 的保留、精确应用版本回退和用户显式清理政策已由 [ADR-10](./ADR-10-packaging-signing-update.md) 决定，migration 代码不得自行删除。涉及真实 Library 目录变换的升级不是普通 SQLite migration，必须通过 [ADR-08](./ADR-08-restore-activation-recovery.md) 的 staged activation/rollback 协议。

### 7.4 更新与降级兼容

- 新版本应用必须携带从每个仍可能存在的公开 level 到 current 的完整连续 migration 和永久 fixture。
- 更新前可以由旧应用继续读写旧库；更新成功迁移后只由新 schema 的应用打开。
- 旧应用看到更高 `user_version` 时返回 `incompatible-version`，不尝试读取旧字段子集、不写入、不自动 downgrade。
- 用户若要回到旧应用，必须显式选择迁移前 safety copy，并接受迁移后新增事实不会出现在旧副本中。
- 不提供 bidirectional migration、dual-write、shadow schema、旧 schema read adapter 或自动合并。
- Electron/Node/SQLite/IPC/schema 作为一个经过 [ADR-10](./ADR-10-packaging-signing-update.md) 验证的应用组件集合发布；不支持 Main、Renderer、Workspace utility 混用不同 build。

这保证“软件更新可兼容已有用户数据”，但不承诺“升级后的数据可被旧软件继续编辑”。

## 8. Workspace/IPC DTO 与协议版本

### 8.1 Handshake 与 Envelope

Renderer ↔ Main 和 Main ↔ Workspace utility 都必须在任何业务消息前完成 handshake：

- exact `protocolVersion`；
- exact `appBuildId`；
- seam kind；
- 新 Workspace 启动后生成的 `workspaceEpoch`。

任一不匹配即不进入 ready，不发送业务 query/command，也不做版本范围、downgrade 或 capability negotiation。Capabilities 只表达同一 build 内模块是否交付、健康和可用，不用于兼容不同协议。

每个业务 envelope 至少含 `protocolVersion`、message discriminator、request/correlation ID 与 `workspaceEpoch`。旧 epoch 的响应被丢弃。未知 message、intent、字段或 intent schema version 返回稳定 incompatible/validation problem。

### 8.2 DTO 值域

- DTO 只允许有界、无环、plain object 的 discriminated union。
- 拒绝 class instance、`Error`、`Date`、`Map`、`Set`、`Buffer`/typed array、function、symbol、accessor、prototype-dependent value、cycle 和 unknown key。
- `Revision`、`EntityVersion` 以及所有 64 位协议值使用 canonical unsigned decimal string：`0` 或非零数字开头、无正号、无前导零；DATA 内部才使用 `bigint`，绝不转为 JavaScript `Number`。
- exact decimal 使用 canonical decimal string：无正号、无 exponent、整数部分必有数字、除零外无前导零、小数部分无尾零；最多 6 位小数和 18 位 significant digits。具体字段的正负与范围由领域判别式限制。
- UUID、LocalDate、LocalTime、Instant 与 ZoneId 必须满足 §5 的 canonical grammar 后才进入 domain。
- 每个 persisted intent 独立携带 `intentSchemaVersion`。某版本的字段含义、optional/absent 语义和 digest projection 一经发布永久不变；新增或改义必须提升版本。

## 9. CommandReceipt canonical digest

### 9.1 Encoding profile

CourseFlow 定义最小的 `courseflow-canonical-json-v1`，只用于已验证 command digest projection，不宣称支持任意 JSON 或完整 RFC 8785。

允许的值：

- `null`、boolean、Unicode string；
- 非负或字段允许的负 safe integer，拒绝 `-0`；
- dense array，保持原顺序；
- 无 prototype-dependent 行为的 plain object。

规则：

1. 先按具体 `intentSchemaVersion` 拒绝 unknown/缺失字段，并把 64 位整数、exact decimal、ID 与时间正规化。
2. object key 按 UTF-16 code unit 序递归排序；array 不排序。
3. string 使用 ECMAScript JSON string escaping；拒绝 lone surrogate。
4. safe integer 使用无 exponent 的最短十进制形式。
5. 输出无 BOM、无空白的 UTF-8 bytes。
6. 拒绝 `undefined`、sparse array、float、`NaN`、`Infinity`、`-0`、function、symbol、class、cycle、Map/Set/Date/typed array。

实现必须是项目内有界函数，不增加 canonicalization 或 hash dependency。

### 9.2 Digest projection

digest preimage 必须包含：

- canonical encoding version；
- intent kind 与 `intentSchemaVersion`；
- 完整 normalized payload，包括 absent/present 有语义差异的字段；
- expected Revision/EntityVersion；
- confirmation token、preview binding 与用户选择，只要它们影响提交语义。

必须排除：

- `CommandId` 本身；
- transport request/correlation ID、protocol version、workspaceEpoch；
- 开发/测试临时 timeout、trace、性能与观测字段；生产应用按 [ADR-09](./ADR-09-no-production-diagnostics.md) 不持久化这些数据。

使用 Node core `createHash('sha256')` 计算 32-byte digest。receipt 保存 algorithm code、canonical encoding version 和原始 32-byte BLOB，而不是只存未标版本的 hex。

同一 CommandId + 同一 digest 重放既有 committed outcome，不写入也不推进 Revision；同一 CommandId + 不同 digest 返回 command-id-reused/integrity conflict。历史 receipt 使用其记录的旧 encoding 规则比较；若当前应用不能解释数据库中仍在生命周期内的 encoding，Workspace 进入 recovery，不猜测相等。

实现前必须建立跨进程 golden vectors，覆盖 key order、Unicode、absent/null、array order、64-bit 边界、decimal 边界、confirmation selection 和所有拒绝值。

## 10. Snapshot、恢复与跨文件边界

### 10.1 Structured-data compatibility predicate

[ADR-07](./ADR-07-snapshot-format-integrity-publication.md) 的 snapshot manifest 必须独立声明并校验至少：

- `snapshotFormatVersion`；
- database `application_id` 与 source schema level；
- `WorkspaceId`；
- 数据库副本的 actual source Revision；
- 实际包含的模块与各自 format/version；
- [ADR-07](./ADR-07-snapshot-format-integrity-publication.md) 决定的 manifest/content digest algorithm 与 version。

`snapshotFormatVersion` 与 `user_version` 是不同轴，不能互相替代。manifest 的精确文件布局、压缩、发布和 content digest 由 [ADR-07](./ADR-07-snapshot-format-integrity-publication.md) 决定。

### 10.2 Restore candidate

旧 snapshot 恢复顺序固定为：

1. 将 snapshot 内容复制到独立 staging，原 snapshot 和活动 Workspace 不变。
2. 验证 manifest、database identity、schema level、WorkspaceId、source Revision、完整性和 Library 内容声明。
3. 如果是 supported old level，只迁移 staging DB；不得先迁移或覆盖活动库。
4. 迁移完成后记录 post-migration staged Revision，并重新执行完整验证。
5. 基于 staged current facts 生成影响预览；明确区分 source Revision 与 post-migration Revision。
6. 用户确认后按 ADR-08 创建 RestoreSafetySet，再进入 activation。

future level、wrong application ID、WorkspaceId/manifest 不一致、损坏、FK/integrity 失败都在 preview/activation 前停止。恢复 candidate 的 WorkspaceId 成为激活后的身份；若与当前 Workspace 不同，UI 必须说明这是完整替换，不做 merge。

snapshot 中的 Library root、backup destination 和其他设备路径只作为历史配置证据；恢复后必须在当前设备重新验证和授权，不能直接信任为可用路径。

RestoreSession、backup configuration/state/operation 使用 typed columns/detail tables；不以通用 manifest JSON 代替活动恢复状态。跨 DB + Library 的 external ActivationPlan/journal 属于 [ADR-08](./ADR-08-restore-activation-recovery.md)。只有数据库与 Library 完成激活、重新打开、验证和 reconcile 后才报告 restore succeeded，不存在部分成功。

迁移 safety DB copy、ADR-08 RestoreSafetySet 与已发布 backup snapshot 是三个不同对象，生命周期与用户承诺不得混用。

## 11. 启动模式与稳定问题

| 输入状态 | 允许结果 |
|---|---|
| 文件不存在、显式新建 | staging 初始化并验证；激活前不 ready |
| current、完整、可写 | `ready` |
| current、完整、文件系统只读 | `read-only`，仅开放一致查询、导出与恢复能力 |
| supported old、可写 | 先 safety copy，再迁移至 current；全链验证后 ready |
| supported old、只读 | 不用旧 schema adapter 读取领域事实；`recovery`，提供复制到可写位置/恢复 |
| future level | `incompatible-version` + recovery/export/raw-copy 能力；不读写领域事实 |
| wrong application ID | 拒绝为 CourseFlow 库；活动路径进入 recovery，手选 candidate 在激活前失败 |
| existing nonempty level 0、缺表/列/FK/index、篡改 level | `integrity`/`recovery-required`；不自动补表或重建 |
| integrity/FK/STRICT/CHECK/关键领域验证失败 | `recovery-required`；不开放普通读写 |
| migration 某级失败或中断 | 保持最后已提交 level 与 safety copy；重开后从该 level 继续或显式恢复 |
| ADR-08 external activation journal nonterminal、损坏或不兼容 | `recovery-required`；只允许证据支持的 resume/rollback；若都不安全则不提供物理动作 |
| IPC protocol/build mismatch | seam unavailable；不启动 Workspace 业务能力 |

稳定问题至少携带 `code`、`scope`、`dataEffect`、`affectedCapabilities`、`actual/required version` 与可执行 next actions。原始 SQLite/OS 异常和真实路径只在 owner 内存中用于映射，随后丢弃；不持久化、不作为 UI 分支或上传内容。

## 12. Architecture 映射

### 12.1 Module 与 Interface

| 覆盖项 | 本 ADR 的落实 |
|---|---|
| `MOD-DATA` | application/schema identity、STRICT relational schema、migration chain、receipt encoding、current/open validation |
| `MOD-WORKSPACE` | exact handshake、workspace mode、setup facts、migration/restore 编排与 update/downgrade 说明 |
| `MOD-PLAN` | normalized Term/Course/Series/Segment/Override/State；Occurrence 派生 |
| `MOD-ATTEND` | half-open windows、sparse records、PLAN identity validation、即时关闭与同日重开 |
| `MOD-LIBRARY` | typed verified index、mapping/tag/file operation schema；路径细节留 ADR-05 |
| `MOD-GRADE` | exact decimal inputs、immutable scale version、derived result/SGPA |
| `MOD-PROTECT` | watermark、typed restore state、structured-data compatibility predicate |
| `IF-WORKSPACE` / IPC | exact protocol/build handshake、versioned bounded DTO、canonical numeric strings |
| `IF-DATA-COMMIT/RECEIPT` | lifetime receipt、typed effects、versioned SHA-256 digest |
| `IF-DATA-EXPORT/STAGE-ACTIVATE` | old DB stage/migrate/validate seam；snapshot layout/activation 分属 [ADR-07](./ADR-07-snapshot-format-integrity-publication.md)/[ADR-08](./ADR-08-restore-activation-recovery.md) |

### 12.2 FLOW

| Flow | 本 ADR 的责任 |
|---|---|
| `FLOW-00` | identity/level/manifest/integrity validation、migration、mode selection、exact seam handshake |
| `FLOW-01` | schema constraints、EntityVersion/Revision、receipt/digest、follow-up typed persistence |
| `FLOW-02` | normalized facts与窗口化派生投影；不保存第二份真相 |
| `FLOW-03` | verified Library index 与 typed FileOperation；路径/Watcher 留 ADR-05 |
| `FLOW-04` | backup watermark、actual DB level/revision、manifest compatibility inputs |
| `FLOW-05` | candidate stage、旧 level migration、完整验证；外部激活协调记录与切换见 [ADR-08](./ADR-08-restore-activation-recovery.md) |
| `FLOW-06` | ATTEND/GRADE 从同一 Revision 的 exact facts 派生 |

### 12.3 Quality 与 Gate

本 ADR 直接约束 `Q-TRUTH-01`、`Q-CONSIST-01`、`Q-PROTECT-01`、`Q-LOCAL-01`、`Q-PORTABLE-01`、`Q-STATE-01`、`Q-TIME-01`、`Q-EVOLVE-01`、`Q-CONTINUITY-01` 与 `Q-DIAG-01`。实现证据必须进入 `G2`、`G4`、`G6`、`G7`；“ADR 已接受”不表示这些实现门已经通过。

## 13. 后果

### 13.1 正向

- 公开数据只沿一个明确方向演进，软件更新路径容易解释、故障注入和永久回归；
- `application_id + user_version + code-owned manifest` 能区分 wrong file、旧、current、future 和结构篡改；
- STRICT、精确整数/小数、显式 union 与即时 FK 在数据库边界再次阻止状态折叠；
- 领域关系表直接支持当前窗口化查询，不引入 event sourcing、EAV、ORM schema 魔法或 JSON 查询；
- sparse occurrence/attendance 状态避免为多年日历预生成大量派生行；
- exact handshake 和 canonical DTO 消除 Electron structured clone 的 prototype/BigInt/Buffer 歧义；
- Node core hashing 与项目内有界 canonicalizer 不增加依赖和供应链面；
- staged old-snapshot migration 在影响预览前完成，不把恢复试验施加到活动真相。

### 13.2 代价与风险

- 升级是非对称的：旧应用不能打开已升级库；回退依赖迁移前副本，迁移后新增数据不会自动合并回旧副本；
- 每个公开 schema level、intent schema 和 digest encoding 都形成长期兼容义务；
- 没有 migration ledger；失败分类与兼容性证明依赖精确 user_version、code-owned chain、manifest 和 fixture；
- STRICT 绑定 SQLite 最低版本，并要求每次 Electron 更新重新验证 bundled SQLite；
- 关系 DDL 与显式 migration 比通用 JSON 更冗长，但错误和 ownership 更可见；
- application ID 在首发前仍有一次官方登记/冲突复核门；
- migration、snapshot、Library activation 与 app rollback 分属不同 ADR，任何一个缺失都不能宣称完整更新/恢复已经实现。

这些成本是保护本地唯一用户真相的必要成本，不得通过静默 reset、旧 schema 猜读或混合组件版本规避。

## 14. 被否决的方案

### 14.1 通用 JSON/EAV 或事件溯源

它们把字段、union、外键、索引和 owner 变成应用自建协议，却没有协作、审计 time-travel 或可插拔 schema 的产品需求。当前投影可从关系事实确定性重建，完整 event store 只增加兼容面。

### 14.2 预建所有 MVP/未来表

未交付模块的空表、`EXT-C2/C3` 字段和通用扩展槽会冻结未经验证的兼容承诺。首发只冻结实际交付能力，后续用真实 migration 增加。

### 14.3 `user_version + schema_migrations` 双记账

单机、严格连续、forward-only chain 不需要 per-database 审计 ledger。两个版本事实会增加 gap/duplicate/修复分支；历史迁移身份和 fixture 由代码仓库与安装包负责。

### 14.4 自动 downgrade、dual-write 或旧 schema adapter

这些方案要求每个新事实同时适配旧语义，仍不能保证旧应用理解新状态，并扩大数据损坏面。CourseFlow 选择 forward-only migration + 显式 safety-copy rollback。

### 14.5 SemVer、SQLite `schema_version` 或 feature flags 作为 schema level

产品版本、SQLite 内部 schema cookie 和运行时 capability 是不同轴。混用会使 restore、失败分类和逐级 migration 无法判定。

### 14.6 浮点事实

SQLite `REAL`/JavaScript `Number` 会让权重、学分、分数、GPA 和等级边界产生不可审计舍入。规范 coefficient/scale 与 decimal string 更适合当前上限。

### 14.7 宽松 IPC 协商

同一桌面安装包没有滚动部署需求。范围协商、字段忽略和 mixed-build compatibility 会隐藏部分更新；exact protocol/build match 更简单、更安全。

### 14.8 完整 JCS 或自定义二进制协议

CourseFlow 没有跨语言网络互操作需求。完整 RFC 8785 profile 仍需定义 BigInt-as-string，binary encoding 又增加调试成本；受限 typed projection 已足够稳定。

### 14.9 Trigger、cascade 与通用审计列

业务 trigger 隐藏事实变更，cascade 可能删除被 receipt/外围模块引用的历史，通用 audit 列则重复不存在的要求。当前选择 owner validation + immediate FK/RESTRICT + 必要的显式 history/tombstone。

## 15. 验证义务

在本 ADR 可视为“已落实”前，必须产生以下新鲜证据：

1. `TEST-DATA-001`：每个正式 schema 的约束失败全回滚；migration 每一级在 DDL/DML、Revision、watermark、user_version 的任意 failpoint 只能全有或全无。
2. `TEST-DATA-002`：canonical digest golden vectors 跨 Renderer/Main/Workspace 一致；同 CommandId 同 payload 重放，不同 payload、expected version 或 confirmation 被拒绝。
3. `TEST-DATA-003`：64-bit boundary 全程 bigint/decimal-string，实体冲突与 ReadSnapshot 不混 Revision。
4. `TEST-DATA-004`：receipt、follow-up、operation typed state 跨通知丢失和重启保持幂等。
5. `TEST-DATA-005`：read-only、wrong ID、非空 level 0、缺 manifest、FK/STRICT/CHECK/integrity 损坏进入正确模式且不 reset。
6. `TEST-DATA-006`：每个公开旧 level 到 current、current reopen、future stop、partial chain、migration kill、safety-copy rollback、旧 snapshot staged migration。
7. `TEST-WORKSPACE-001–006`：new/current/old/future/recovery/read-only/mixed-build 的 mode、capability、epoch 与 next action。
8. `TEST-PLAN-001–008`：Term/Course 范围意图、Segment split/no-overlap、Occurrence tuple 稳定、sparse override/state、Holiday 与所有窗口投影。
9. `TEST-ATTEND-001–004`：默认关闭、跨日当天 00:00 开启、即时关闭、关闭前资格保留、同日重开实际时刻、关闭间隙不回填、统计与 PLAN 隔离。
10. `TEST-LIBRARY-001–007`：实际交付 level 的 root/category/mapping/index/tag/tombstone/file-operation schema、verified uniqueness 与跨重启 reconcile。
11. `TEST-GRADE-001–007`：decimal 18/6 边界、zero/ungraded/unknown、extra credit、immutable scale/binding、manual/attested provenance、精确等级边界与 SGPA。
12. `TEST-PROTECT-001–006`：actual level/revision manifest、旧/current/future candidate、staging migration、source/post-migration revision、WorkspaceId replacement 与 activation 前不变。
13. 每个 CourseFlow 自有表的 manifest test：STRICT、列/type、PK/FK、CHECK、UNIQUE、required index、RESTRICT/no trigger/no unexpected object。
14. canonical encoding property/golden tests：Unicode/key order、lone surrogate、absent/null、dense/sparse array、safe integer、`-0`、NaN/Infinity、64-bit/decimal 边界和 rejected prototypes。
15. Renderer ↔ Main 与 Main ↔ Workspace IPC probe：BigInt 不进入公共 DTO、Buffer/class/unknown fields 被拒、protocol/build mismatch 不 ready。
16. packaged macOS 与 Windows 对实际 `process.versions.electron/node/sqlite` 执行建库、所有历史 migration、打开校验、IPC、online backup、restore candidate 与更新/回退旅程。
17. G7 使用当前 schema/index 测量 cold open、migration、current-term/window queries、commit、integrity/FK check、数据库大小和内存；没有证据不得预加 FTS/cache/pool。
18. 静态依赖/SQL 审查证明 schema/migration/canonicalizer 只在批准 owner 内，领域/IPC 不泄露 SQLite/ORM/path 类型。

历史 migration fixture、canonical vector 和 intent fixture 是永久发布资产；重构不能删除。任何无法在某一目标平台执行的门必须明确标记未验证，不能推断通过。

## 16. 下游决策

- `ADR-TOPIC-05`（[ADR-05 已接受](./ADR-05-library-watching-index-file-operations.md)）：路径 canonical identity、大小写/Unicode、Watcher、扫描和文件替换细节；
- `ADR-TOPIC-06`（[ADR-06 已接受](./ADR-06-resource-preview-system-open.md)）：预览与系统打开、资源授权和 platform handle；
- `ADR-TOPIC-07`（[ADR-07 已接受](./ADR-07-snapshot-format-integrity-publication.md)）：snapshot manifest 的精确编码、目录布局、压缩、digest、临时发布和保留；
- `ADR-TOPIC-08`（[ADR-08 已接受](./ADR-08-restore-activation-recovery.md)）：external activation journal、数据库/Library 可恢复的逻辑全有或全无切换、continue/rollback；
- `ADR-TOPIC-09`（[ADR-09 已接受](./ADR-09-no-production-diagnostics.md)）：无生产日志、diagnosticRef 或诊断导出；StructuredProblem 只携带 typed safe details；
- [`ADR-TOPIC-10`](./ADR-10-packaging-signing-update.md)：Electron/Node/SQLite release 基线、application identity、安装更新、safety-copy 保留/清理、签名与双平台发布；已接受。

这些下游 ADR 可以细化自己的物理协议，但不得改变本 ADR 的 schema level 单一真相、forward-only 数据政策、unknown-future stop、exact DTO/digest 或“无部分成功”边界。

## 17. 重新打开条件

出现以下任一事实时必须重新打开本 ADR：

- 产品要求旧版本应用继续写入新版本数据，或要求自动双向降级/合并；
- 产品新增多设备协作、append-only 审计、任意历史 revision 查询或需要 event sourcing 的法律要求；
- 已批准 exact decimal 上限不能表达真实学校规则；
- packaged Electron 无法提供满足 STRICT/FK/backup/migration 的受支持 SQLite；
- 永久历史 migration/receipt encoding 无法在安全修复后继续解释；
- G7 在合理索引与窗口查询后仍证明当前关系 schema 无法满足批准预算；
- ADR-05/07/08/10 的真实平台限制只能通过改变本 ADR 的事实所有权或兼容承诺解决；
- 任何 `TEST-DATA-*`、`TEST-PROTECT-*` 或领域 TEST 只能通过 silent reset、浮点事实、mixed build 或旧 schema 猜读才能通过。

重新打开必须先说明受影响的公开 level、用户数据、rollback 路径、fixture 与 Requirement/TEST；不得以未记录实现偏差取代新决议。
