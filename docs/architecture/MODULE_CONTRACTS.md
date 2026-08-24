# CourseFlow 模块与接口契约

> 状态：已批准实现基线
> 版本：0.18
> 日期：2026-08-21
> 配套总览：[ARCHITECTURE.md](./ARCHITECTURE.md)
> 首发运行时剖面：MVP-A、MVP-A-P、MVP-B；本文保留已批准的 MVP-C1 契约，C1 不进入首发构建。

## 1. 契约约定

本文是 CourseFlow 逻辑接口的规范来源。类型和伪代码只表达语义，不指定编程语言、序列化格式、进程边界或存储实现。

### 1.1 规范用语

- **MUST / 必须**：实现不满足即违反架构；
- **MUST NOT / 不得**：硬边界；
- **SHOULD / 应**：默认要求，偏离时必须记录理由并证明不破坏适用 `Q-*`；
- **MAY / 可以**：允许但不要求。

### 1.2 单一来源与引用规则

- 产品语义以 PROJECT_BRIEF、PRD、MVP_SCOPE、User Flow 和 UI 规格的权限层次为准；
- 模块所有权、依赖、FLOW 与 Q 以 [ARCHITECTURE.md](./ARCHITECTURE.md) 为准；
- 本文定义字段、状态机、接口行为、错误和测试义务；
- ADR 可以映射逻辑类型到具体技术，但不得删除状态、合并未知语义或放宽成功边界；
- roadmap/backlog 只引用 Requirement/MOD/IF/FLOW/Q/TEST ID。

同一含义只在一个规范位置定义。其他章节通过链接或 ID 引用，不复制一套近似定义。

### 1.3 已识别的上游来源差异与裁定

以下差异不能由实现或 ADR 自行解释。本契约按 PRD、MVP_SCOPE 与 User Flow 的较高权限收敛当前 MVP，并保留原始差异供产品文档后续修正：

1. **课节时间 TBA**：`PRD A-COURSE-004` 要求周期课节具有星期、本地开始/结束时间，只允许地点未知时显示 TBA；UI 规格 §9.4 另写了“开启 TBA 后不要求星期与时间”。当前采用 PRD：MVP 周期课节的时间必须确定，只有地点可以是 TBA。
2. **授课人所有权**：User Flow §5.2 明确教授/授课人是 Course 级可选信息，MVP 不提供课节级覆盖；UI 规格 §9.3/§9.4 又把教授列为课节字段。当前采用 User Flow：Meeting 投影可以引用 Course instructor，但 MeetingSegment 不保存独立 instructor。
3. **课节类型集合**：PRD、MVP_SCOPE 与 User Flow 的当前验收只定义 LEC、TUT、PRA；UI 规格 §9.3 另提“用户可读自定义类型”。当前 MVP 只接受三个规范 code，并同时提供可理解全称；自定义类型须先进入产品范围与验收。

若产品要采用 UI 规格中的另一口径，必须先同步修改 PRD、MVP_SCOPE、User Flow 与 UI 规格，再扩展 PLAN 类型和测试，不得仅由实现增加隐藏兼容分支。

`GAP-PRODUCT-01`（已解决）：产品语义所有者已在 [PRD.md §3.4“临近截止规则”](../product/PRD.md#临近截止规则) 中完成确定裁定（`WP-R0-01`）。PLAN 保持 `near-due` 的单一规则位置，Shell 不得自行定义或复制该规则；契约只引用 PRD，不重复其算法。

### 1.4 契约实现完成标准

一个 `MOD-*` 或 `IF-*` 只有在以下条件全部满足时才可称为已实现：

1. 所有入站意图、查询和结果类型可表达本契约列出的状态；
2. 所有不变量在模块边界内执行，调用者无需重复实现；
3. 所有失败返回稳定 `StructuredProblem` 与正确 `dataEffect`；
4. 所有适用 `TEST-*` 产生可重复证据；
5. Requirement → MOD/IF/FLOW/Q/TEST 追溯已更新；
6. 未引入本文禁止的反向依赖、UI/存储类型泄漏或未决技术选择。

### 1.5 Agent 目标读取路径

执行一个模块工作包时按以下顺序读取，不需要先把所有其他模块细节装入上下文：

1. [ARCHITECTURE.md](./ARCHITECTURE.md) 的目标 `MOD-*`、相关 `FLOW-*` 与 `Q-*`；
2. 本文 §1–§4 的共同约定、类型与接口注册表；
3. 目标模块的 §5.x；
4. 相关 Intent/Query（§6）、状态机（§7）和 FLOW（§8）；
5. 对应 Problem（§9）、`TEST-*`（§10）与追溯行（§11）。

完成标准是目标工作包指定的所有 TEST obligation 可定位且通过，而不是“已阅读全文”。

## 2. 规范词汇、身份与状态

### 2.1 稳定身份

| 类型 | 创建者 | 稳定性要求 |
|---|---|---|
| `WorkspaceId` | `MOD-WORKSPACE` | 一个活动本地数据集的身份；恢复激活是否保留或替换由恢复语义显式决定 |
| `TermId` | `MOD-PLAN` | 跨当前/历史切换和日期修正稳定 |
| `CourseId` | `MOD-PLAN` | 跨重命名、归档和资料库文件夹变化稳定 |
| `HolidayRangeId` | `MOD-PLAN` | 一个命名连续范围的身份，不拆成每日记录 |
| `MeetingSeriesId` | `MOD-PLAN` | 跨规则分段稳定；分段具有独立 `SegmentId` |
| `TaskSeriesId` | `MOD-PLAN` | 单次和每周任务都具有稳定系列身份；分段具有独立 `SegmentId` |
| `MeetingOccurrenceId` | `MOD-PLAN` | 同一逻辑课节实例在重算、视图和应用重启后稳定 |
| `TaskOccurrenceId` | `MOD-PLAN` | 同一逻辑任务实例在状态变化、重算和应用重启后稳定 |
| `AttendanceWindowId` | `MOD-ATTEND` | 每次启用形成明确窗口；关闭后窗口历史保留 |
| `GradeSchemeId` | `MOD-GRADE` | 一门课程评分方案的身份 |
| `GradingItemId` | `MOD-GRADE` | 跨排序、改名和成绩录入稳定；显示顺序或标题不是身份 |
| `GradeScaleVersionId` | `MOD-GRADE` | 规则版本不可被就地静默改写 |
| `LibraryRootId` | `MOD-LIBRARY` | 一个逻辑资料库的稳定身份；正常迁移和匹配 marker 的整库重新授权保持不变 |
| `RootGeneration` | `MOD-LIBRARY` | 每次活动根切换、重新授权或 marker 修复后产生新值；旧 watcher、扫描和操作结果不得提交到新根代 |
| `FileId` | `MOD-LIBRARY` | 跨应用内重命名/移动稳定；路径不是身份 |
| `BackupSetId` | `MOD-PROTECT` | 一项持久 BackupConfiguration 下快照集合的身份；跨重启与软件更新稳定，不同配置/设备不得据此互相清理 |
| `SnapshotId` | `MOD-PROTECT` | 已发布快照的身份；操作可以预留候选值，但临时目录或未完成发布不获得正式 Snapshot 身份 |
| `RestoreSessionId` | `MOD-PROTECT` | 一次候选选择、预览、确认、激活与恢复决定的身份；跨重启稳定，不由候选路径或 UI 页面表示 |
| `SafetySetId` | `MOD-PROTECT` | 一次 RestoreSession 独占的恢复前本地保护集身份；不等于 SnapshotId，不进入 BackupSet 序号或保留计数 |
| `AppBuildId` | release build / `MOD-WORKSPACE` 验证 | 同一 production 版本与完整 source commit 的精确身份；Main/Renderer/Workspace utility 必须完全相等，不等于 schema level |
| `MigrationSafetyCopyId` | `MOD-DATA` | 最近一次前向 schema migration 前的已关闭结构化数据副本身份；不等于 SnapshotId/SafetySetId，物理路径不是身份 |
| `MigrationRollbackSessionId` | `MOD-PROTECT` | 一次 safety copy 预览、确认、等待精确 build、完成或取消的身份；跨应用替换和重启稳定 |
| `OperationId` | 启动操作的模块 | 扫描、文件、备份、恢复、迁移回退等长操作跨重启稳定 |
| `CommandId` | Workspace Interface 调用方 | 同一用户意图的重试复用，保证幂等 |
| `Revision` | `MOD-DATA` | 每次正式结构化提交后单调推进，不代表墙上时钟 |
| `EntityVersion` | 对应事实所有者 / DATA 协议 | 用于精确冲突检测，不以全局 revision 代替全部实体版本 |

身份必须是不可变值对象。路径、文件名、标题、日期文本、UI 行号、缓存键和数组位置不得替代稳定身份。

### 2.2 时间与未知值

| 类型 | 合法状态 | 规则 |
|---|---|---|
| `TermZone` | 明确 IANA/等价时区身份 | 学期日期、重复、启用日期和自动归档按该 Zone 解释 |
| `Deadline` | `date-only(LocalDate)` / `timed(Instant + displayed zone context)` / `TBA` | TBA 不产生虚构日期、倒计时或逾期 |
| `MeetingTime` | `weekday + localStart + localEnd + endDayOffset(0|1)` | MVP 周期课节必须确定；结束时刻在 TermZone 中必须晚于开始时刻；跨日课节显式使用 next-day offset |
| `MeetingLocation` | `known(text)` / `TBA` | 地点 TBA 不影响课节时间格或冲突判断 |
| `Weight` | `known(percentage)` / `unknown` | unknown 不按 0，不参与需要已知权重的分母 |
| `Score` | `ungraded` / `scored-zero` / `scored-nonzero` / `incomplete-input` | 明确 0 分是成绩事实；未出分不是 0 |
| `Coverage` | `known(value, numerator, denominator)` / `unknown(reason)` | 分母不足时保持 unknown，不显示 0% |
| `FileVerification` | `verified(stamp)` / `missing` / `unverified(reason)` / `pending(operation)` / `reconciliation-required` | 只有 verified 可宣称当前可用 |
| `LibraryPlacement` | `mapped(TermId, CourseId, CategoryId)` / `unassigned` | unassigned 仍是真实资料库文件，不从文件夹名称猜测稳定引用 |
| `LocationAssessment` | `verified-local(evidence)` / `known-cloud-or-remote(evidence)` / `unknown(limitations)` | known-cloud-or-remote 必须拒绝；unknown 只有展示检测限制并记录用户确认后才可按本地资料库政策接受 |

`Instant` 用于真实时刻，`LocalDate`/`LocalTime` 用于学期时区内的日历语义。调用者不得用系统默认时区替代 `TermZone`。

### 2.3 核心领域词汇

| 词汇 | 规范定义 |
|---|---|
| `Workspace` | 一个本地数据集，可包含多个历史 Term，最多一个 Current Term |
| `WorkspaceLifecycle` | 初始化、设置进度、启动验证、当前路由、日期边界协调和可恢复操作概览 |
| `SetupProgress` | 已完成正式步骤、明确跳过/稍后决策、当前最低可用条件与 `everReachedMinimum` 里程碑；不得仅由页面序号表示，也不得因学期归档而抹掉曾完成事实 |
| `DraftCheckpoint` | Shell 可恢复的版本化未提交编辑状态；不是领域事实，不参与投影与备份完成语义，除非产品明确将草稿纳入快照 |
| `Term` | 名称、开始/结束 LocalDate、TermZone 和当前/历史状态 |
| `HolidayRange` | Term 内一个命名、包含起止日的连续区间 |
| `Course` | Term 内课程身份、展示字段、教学范围、归档状态和可选学分 |
| `MeetingSeries` | 课程的一条周期课节身份；由一个或多个不重叠规则段表达历史演进 |
| `MeetingSegment` | 在明确生效范围内的类型、星期、当地开始/结束时间、结束日偏移、地点和其他课节字段 |
| `TaskSeries` | 与 Course 关联的一次性或每周任务身份；由规则段表达未来修改 |
| `TaskSegment` | 规模、截止语义、重复范围、是否跟随教学周及其他任务字段 |
| `Occurrence` | 从系列、段、范围、假期和覆盖事实确定性派生的单次实例 |
| `OccurrenceOverride` | “仅本次”的修改、取消或状态事实；不得修改相邻实例 |
| `GradeTaskRef` | `none`、`task-series(TaskSeriesId)` 或 `task-occurrence(TaskOccurrenceId)`；只能由用户显式建立，标题相同不构成关联 |
| `GradeProjection` | `CourseGradeProjection` 的版本化只读导出，携带 CourseId、input revision、GradeScaleVersionId、result source、coverage、warnings 与估算标识 |
| `FinalCourseOutcome` | 仅在存在 calculated-final、manual-final 或 user-attested school-record 时导出其值、来源、provenance、credits 与绑定模板；current-estimate 不能冒充最终结果 |
| `LibraryRoot` | 当前唯一活动根的本地位置、LibraryRootId、RootGeneration、能力与健康；绝对路径不是根身份 |
| `LibraryMarker` | 根级保留控制文件，绑定 marker format、WorkspaceId 与 LibraryRootId；不是权限凭证或用户资料 |
| `PathKey` | 在一个 RootGeneration 内指向当前位置的版本化相对组件编码；原样保留大小写/Unicode，不作为 FileId 或 containment 证明 |
| `VerificationStamp` | 最近一次验证的 RootGeneration、PathKey、类型、size、mtime 与可选版本化对象证据；不是内容摘要或永久身份 |
| `FileEntryAssessment` | `regular-file` / `directory` / `link-unsupported` / `special-unsupported` / `unclassified`；平台适配器不得泄露原始 API 类型，unclassified 不能冒充普通条目 |
| `BackupSet` | 一个 Workspace 在一项持久 BackupConfiguration 下的独立不可变快照序列；`backupSequence` 在集合内单调、可有间隙，只用于确定已验证快照的保留顺序 |
| `SnapshotManifest` | 一份已发布快照的版本化 canonical 成员闭包、来源兼容元数据、限制和完整性摘要；它不是认证签名、活动事实或云端上传回执 |
| `RestoreSafetySet` | RestoreSession 在激活前创建并验证的完整本地恢复证据；属于该会话，不发布到 BackupSet，不被常规快照保留策略计数或清理 |
| `RestoreSession` | 绑定候选、当前事实、资料库目标、影响预览、保护方式、阶段、下一步能力和最终回执的可恢复长操作；成功前不产生部分活动结果 |
| `MigrationSafetyCopy` | 前向 migration 写入前的最近一份关闭 DATA 副本；不是 BackupSet/RestoreSafetySet，不包含 Library 文件 |
| `MigrationRollbackSession` | 绑定 safety copy、当前迁移后数据、精确 source/target build、影响预览、handoff、阶段和终态的可恢复长操作；不等于 RestoreSession |
| `ApplicationReleaseDescriptor` | 当前安装构建的不可变逻辑投影：application identity、release/AppBuildId、source commit、平台/架构、运行时与协议/格式支持范围；不是更新 feed，技术序列化由 ADR-10 决定 |
| `MigrationSafetyCopyStatus` | 最近一份 safety copy 的只读投影：身份、源 revision/schema、创建时刻、大小、验证状态、exact rollback release 与是否可删除/回退；不暴露路径或 DataSlot |
| `MigrationRollbackPreview` | 绑定 safety copy、当前 migrated DATA、source/target AppBuildId、结构化数据影响、Library 不回退说明与确认令牌的高影响预览 |
| `MigrationRollbackStatus` | 会话阶段、source/target build、当前 AppBuildId 分类、allowed actions、dataEffect 与终态的只读投影；不暴露物理交换细节 |
| `ImpactPreview` | 基于一个 revision 对高影响意图的影响、选择、警告和确认令牌 |
| `ReadSnapshot` | 一个 revision 上的一致逻辑读取视图 |
| `Projection` | 可从正式事实重建的只读结果；缓存不是事实 |
| `DurableFollowUp` | 与主提交一起记录、必须在崩溃后继续的后续义务 |
| `PostCommitChange` | 提交后唤醒投影与后台工作者的提示；不是事实源 |

### 2.4 状态枚举

#### Task occurrence

`pending | completed | skipped`

- completed 与 skipped 是不同事实；
- 两者均可通过显式更正恢复为 pending；
- 大任务 completed 时显示 100%，恢复时还原完成前的自报进度；
- deleted 不是任务状态，而是带影响范围的领域操作。

#### Attendance

`outside-window | unmarked | attended | missed | cancelled | holiday-suppressed`

- unmarked 可以是派生义务，不要求存为一条“未知记录”；
- cancelled、holiday-suppressed、未开始实例不进入已结束出席分母；
- outside-window 不产生待确认项或统计义务。

#### Result source

`current-estimate | calculated-final | manual-final | school-record`

MVP-C1 可以产生 current-estimate、calculated-final，或保存用户明确输入的 manual-final / user-attested school-record。`school-record` 必须带“由用户声明”的 provenance；它不表示 CourseFlow 已接入或验证学校系统。

#### Capability

`available | disabled-by-user | unavailable | recovering`

disabled-by-user 不是故障；unavailable/recovering 必须附 `StructuredProblem` 或 `OperationHandle`。

#### Module health

`healthy | degraded | unavailable | recovery-required`

health 是可重建的当前状态投影，不替代模块正式事实。Workspace 将模块 health 聚合到投影，不持久化 health 历史。

#### Workspace mode

`ready | limited | read-only | maintenance | recovery`

maintenance 表示已确认的 Restore/MigrationRollback 正在准备、等待外部版本或收敛，普通读写、文件操作和备份关闭；recovery 表示证据不确定或检查点后未收敛。模式切换规则见 [§9](#9-错误传播降级与工作区模式)。

#### Operation

`accepted | running | waiting-decision | recovery-required | succeeded | failed | cancelled`

progress 可以未知；未知进度不得显示为 0%。succeeded 和 failed/cancelled 是终态；recovery-required 不是终态。

### 2.5 规则分段与实例稳定性

- “仅本次”创建或更新 `OccurrenceOverride`；
- “本次及未来”在目标 Occurrence 的逻辑日期处分割系列：旧段在此前结束，新段从该实例生效；
- 整个规则操作必须从规则详情发起，并预览未来实例、历史状态、单次例外、出席记录和显式成绩关联；
- 已完成、已跳过或已记录出席的历史实例不得被未来段修改静默覆盖；
- 重算必须为仍代表同一逻辑实例的 occurrence 复用稳定 ID；
- 假期抑制只影响周期课节和明确选择“跟随教学周”的重复任务；一次性任务、考试和明确截止事项保留。

## 3. Workspace Interface

`IF-WORKSPACE` 是 Shell 唯一可见的应用接口。以下伪模式只表示逻辑形态：

```text
WorkspaceInterface
  query(request)          -> QueryOutcome<ProjectionEnvelope<T>>
  execute(command)        -> CommandOutcome
  preview(request)        -> PreviewOutcome<ImpactPreview>
  observe(subscription)   -> ChangeNotice stream
  accessResource(request) -> ResourceAccessOutcome
```

实际调用可以同步或异步、同进程或跨进程；这些是 ADR 决策。

### 3.1 `query`

`query` 接收命名的 `WorkspaceQuery` 变体及其范围参数。每次成功查询返回：

```text
ProjectionEnvelope<T> {
  workspaceRevision: Revision
  evaluatedAt: Instant
  termZone: TermZone | none
  applicableDate: LocalDate | none
  capabilities: Map<CapabilityName, CapabilityState>
  moduleHealth: Map<ModuleId, ModuleHealth>
  staleness: current | explicitly-stale(verifiedAtRevision, reason)
  data: T
}
```

规则：

- envelope 内所有正式数据必须来自同一 `ReadSnapshot`；
- `evaluatedAt`、`termZone` 与 `applicableDate` 决定倒计时、Today、启用日和自动归档语义；
- 无当前学期时返回 none 和真实空状态原因，不选择任意历史 TermZone；
- 可选模块可以作为 `available(data)`、`unavailable(problem)` 或 `explicitly-stale(data, problem)` 的投影片段组合；
- PLAN 所需核心投影失败时，查询返回 problem 或明确 stale 结果，不返回空列表冒充“今天无事项”；
- 查询不得产生正式领域写入。日期边界需要归档时，Workspace 发起可审计的生命周期 Intent，经 FLOW-01 提交。

### 3.2 `execute`

```text
CommandEnvelope {
  commandId: CommandId
  expectedEntityVersions: Map<EntityId, EntityVersion>
  confirmationToken: ConfirmationToken | none
  intent: WorkspaceIntent
}
```

- 同一逻辑重试必须复用 commandId；
- DATA 协议必须让重复 commandId 返回原 outcome 或语义等价结果，不重复应用变化；
- expectedEntityVersions 不匹配时返回 conflict，不做 last-write-wins；
- 需要影响确认的 Intent 没有有效 token 时返回 decision-required；
- token 与当前 revision/选择不一致时不得提交；
- 正式成功必须返回新 revision 或已存在的幂等提交 receipt。

`CommandOutcome` 是以下互斥变体：

| 变体 | 语义 |
|---|---|
| `committed` | 正式事实已提交；包含 revision、effects、可选 UndoCapability 和 follow-up 状态 |
| `accepted` | 长操作已持久接受；包含 OperationHandle；此时不得声称最终业务成功 |
| `not-committed` | 正式事实未改变；包含 StructuredProblem |
| `conflict` | 版本冲突，正式事实未改变；包含当前版本和重查/合并提示 |
| `decision-required` | 需要 preview/选择；正式事实未改变 |
| `recovery-required` | 当前物理/激活状态需要继续、补偿或回滚；包含 problem/OperationHandle |

`committed` 可以包含 `pendingFollowUps`。这表示主事实已提交，但整体跨模块工作尚未完成；Shell 必须同时显示已提交事实与待处理范围。

### 3.3 `preview`

高影响意图包括删除/归档重要事实、规则范围变化、当前学期切换、资料库根目录变化、文件替换、快照恢复，以及模块声明需要影响确认的其他操作。

```text
ImpactPreview {
  basedOnRevision: Revision
  affectedEntities: [EntityRef]
  effects: [Effect]
  warnings: [StructuredWarning]
  choices: [ResolutionChoice]
  defaultChoice: ResolutionChoice | none
  recoverability: reversible | compensatable | permanent(reason)
  unresolvedReferences: [ReferenceImpact]
  confirmationToken: ConfirmationToken
}
```

preview 不写正式事实。confirmationToken 必须绑定 revision、意图摘要和已选 ResolutionPlan；任何绑定内容变化都使 token 失效。若存在归档、系统废纸篓、显式恢复或 Undo 等可恢复路径，应优先提供；无法恢复的操作必须标 `permanent(reason)`，不得用普通成功文案弱化风险。

### 3.4 `observe`

允许观察：

- `RevisionAdvanced`
- `OperationChanged`
- `ModuleHealthChanged`
- `CapabilityChanged`

通知只携带重查所需最小上下文，如最新 revision、OperationId 或受影响 capability。通知可能合并或重复；调用方必须通过 query 获取真相。不得依赖通知完整历史重建正式数据。

### 3.5 `accessResource`

```text
ResourceAccessRequest {
  fileId: FileId
  expectedVerificationStamp: VerificationStamp
  mode: preview | system-open | reveal-in-folder
}

PreviewDescriptor {
  kind: pdf | png | jpeg | webp | text
  byteLength: canonical unsigned decimal string
  encoding?: utf-8 | utf-16le-bom | utf-16be-bom
  animated?: boolean
  detectionPolicyVersion: Version
  limitProfileVersion: Version
}

ResourceAccessOutcome =
  PreviewReady(descriptor, localSession)
  | PreviewUnavailable(reason, allowedActions)
  | PlatformActionRequested(system-open | reveal-in-folder)
  | ResourceAccessProblem(StructuredProblem)
```

执行每一种 mode 前都必须独立重新验证 FileId 对应路径仍位于当前根目录、资源存在、权限允许且 stamp 未过期。`localSession` 是 Shell 侧不可枚举、用途限定、可取消且不跨重启的抽象能力；它不包含真实路径、URL、平台 handle 或进程类型，也不是可持久事实。普通 `ProjectionEnvelope` 和普通 request/response DTO 不携带大文件二进制内容。

`PreviewUnavailable` 的稳定 reason 至少区分 unsupported、type-mismatch、password-required、limit-exceeded、parse-failed、timeout、stale、permission、not-found 和 launch-risk；allowedActions 只能来自当前重新验证结果。通道关闭、epoch/protocol 不匹配、无默认关联和平台调用失败使用 `ResourceAccessProblem`。`PlatformActionRequested` 只证明请求已交给操作系统：system-open 不证明第三方应用已加载内容，reveal-in-folder 是无成功回执的 best-effort 请求。所有资源访问结果的 `dataEffect=unchanged`，不得返回 committed 或 disk-applied。

支持预览且非高风险的普通文件也可以独立请求 system-open。不支持或预览失败但经启动风险政策判为非高风险的普通文件仍可 system-open/reveal；已知可启动的高风险文件只允许 reveal-in-folder，system-open 必须以 launch-risk 拒绝且不提供应用内绕过。文件、根、权限、stamp、epoch 或协议变化使现有 preview session 失效；Shell 必须显示已失效并由用户显式 reload，不得静默切换到新对象。

### 3.6 `DraftCheckpoint`

```text
DraftCheckpoint {
  draftId: DraftId
  kind: DraftKind
  scope: EntityRef | setup-step | none
  schemaVersion: Version
  updatedAt: Instant
  opaquePayload: ShellOwnedDraft
}
```

- Shell 拥有 payload 含义与当前编辑模型；Workspace 负责版本化保存、读取、删除和大小/兼容性保护；
- Draft 可以无效或不完整；不得进入领域查询、统计或正式备份成功语义；
- 正式命令失败时 Draft 保留；成功后 Shell/Workspace 按明确关联删除或标记已消费；
- Draft 版本不兼容时必须解释并允许用户安全丢弃或导出，不得猜测成正式事实。

### 3.7 `UndoCapability`

只有可逆、已提交操作可以返回：

```text
UndoCapability {
  undoToken: UndoToken
  committedRevision: Revision
  validThrough: time/revision policy
  inverseIntentKind: IntentKind
}
```

UndoToken 一次性使用，受后续冲突与有效期约束。UI 对完成/跳过等操作提供 6 秒撤销 Toast；Toast 消失不删除正常的更正/恢复命令，也不把高影响操作降级为仅靠 Toast 保护。

## 4. 公共协议

### 4.1 `IF-STRUCTURED-PROBLEM`

```text
StructuredProblem {
  code: ProblemCode
  scope: field | operation | module | workspace
  dataEffect: unchanged | committed(Revision) | disk-applied | activation-pending
  affectedCapabilities: [CapabilityName]
  allowedActions: [ProblemAction]
  context: { revision?, entityVersions?, operationId? }
  details: ProblemDetailsByCode
}
```

`ProblemAction` 是公共协议版本拥有的封闭 action token；可以随协议版本显式扩展，但不是任意字符串。`allowedActions` 可以为空，尤其用于 recovery 证据不足且任何物理动作都不安全的状态。Shell 将 code/details 映射为可访问文案和焦点，但不得自行推断 dataEffect 或增补 action。`ProblemDetailsByCode` 必须由 code owner 定义为封闭 typed variant；每个字段都必须改变用户文案、状态判定或允许动作，不得使用任意 string/map、原始异常、stack、SQL、路径/内容转储或秘密。

按 [ADR-09](./adr/ADR-09-no-production-diagnostics.md)，生产应用不建立诊断/日志/崩溃收集/遥测/支持包接口或存储。底层 OS/Node/SQLite/解析错误只在 owner 内存中短暂映射为稳定 Problem 后丢弃。Problem 只有在它属于 Operation、FileOperation、RestoreSession 等正式当前状态时才随该状态持久化，且不得形成历史事件流。CommandReceipt、Operation、manifest、activation journal 等由既有 ADR 明确要求的记录仍服务于幂等与恢复，不是诊断日志，也不得附加任意调试字段。

### 4.2 `IF-OPERATION-HANDLE`

```text
OperationHandle {
  operationId: OperationId
  kind: OperationKind
  state: OperationState
  phase: stable phase code
  progress: known(value) | unknown(reason)
  dataEffect: DataEffect
  capabilities: { retry, resume, cancel, rollback, decide }
  problem: StructuredProblem | none
}
```

扫描、跨资源文件操作、备份和恢复可以返回 OperationHandle。状态与用户决策必须持久化到足以在应用重启后继续；取消只有在模块声明 safe 时可用。

### 4.3 `IF-DURABLE-FOLLOWUP`

主提交可以原子记录：

- `backup-needed-through(Revision)`；
- 投影失效范围；
- 资料库映射/对账义务；
- 其他已命名、幂等、可重试的模块后续动作。

Follow-up 必须具有稳定 ID、所有者、前置 revision、状态、重试/决策信息。崩溃不能丢失义务；完成必须幂等。

### 4.4 `IF-POST-COMMIT-CHANGE`

`PostCommitChange` 只能在正式提交或资料库 index-committed 后发出，用于唤醒投影失效和后续工作。它可以丢失、合并或重复，因为 DurableFollowUp/backup watermark 才是恢复真相。

### 4.5 `IF-REVISION-ENVELOPE`

所有跨模块复合读取必须声明 ReadSnapshot revision。模块只返回该 revision 的事实/投影或显式 unavailable/stale，不在 Workspace 中隐式混合多个 revision。

### 4.6 `IF-IMPACT-PREVIEW`

模块向 Workspace 返回自身 ReferenceImpact 与可选 ResolutionChoice；Workspace 只组合，不自行猜测模块内部级联语义。执行时每个模块重新验证 preview 前提。

### 4.7 接口注册表

| Namespace | 稳定接口 | 所有者 / 用途 |
|---|---|---|
| Workspace | `IF-WORKSPACE` | WORKSPACE；Shell 唯一应用入口，包含 query/execute/preview/observe/accessResource |
| Public protocols | `IF-STRUCTURED-PROBLEM`、`IF-OPERATION-HANDLE`、`IF-DURABLE-FOLLOWUP`、`IF-POST-COMMIT-CHANGE`、`IF-REVISION-ENVELOPE`、`IF-IMPACT-PREVIEW` | 跨模块共同语义；定义位于 §3–§4 |
| PLAN | `IF-PLAN-COMMAND`、`IF-PLAN-QUERY`、`IF-PLAN-IDENTITY`、`IF-PLAN-IMPACT` | PLAN；事实变化、投影、稳定引用与影响 |
| ATTEND | `IF-ATTEND-COMMAND`、`IF-ATTEND-QUERY`、`IF-ATTEND-IMPACT` | ATTEND；启停/记录、结果投影与引用影响 |
| LIBRARY | `IF-LIBRARY-COMMAND`、`IF-LIBRARY-QUERY`、`IF-LIBRARY-RESOURCE`、`IF-LIBRARY-MANIFEST`、`IF-LIBRARY-IMPACT` | LIBRARY；根/文件/索引、资源、快照清单与影响 |
| GRADE | `IF-GRADE-COMMAND`、`IF-GRADE-QUERY`、`IF-GRADE-EXPORT`、`IF-GRADE-IMPACT` | GRADE；成绩事实、结果、扩展输出与引用影响 |
| PROTECT | `IF-PROTECT-COMMAND`、`IF-PROTECT-QUERY`、`IF-BACKUP-CHECKPOINT`、`IF-RESTORE-SESSION`、`IF-PROTECT-MIGRATION-ROLLBACK` | PROTECT；备份、整库恢复和迁移回退会话 |
| DATA | `IF-DATA-READ`、`IF-DATA-COMMIT`、`IF-DATA-RECEIPT`、`IF-DATA-EXPORT`、`IF-DATA-MIGRATION`、`IF-DATA-STAGE-ACTIVATE`、`IF-DATA-OPERATION` | DATA；一致读取、提交、幂等、导出、schema migration/safety copy 与激活 |
| PLATFORM | `IF-CLOCK`、`IF-ZONE-RULES`、`IF-FILESYSTEM`、`IF-WATCHER`、`IF-DIRECTORY-CHOOSER`、`IF-LOCAL-LOCATION-CLASSIFIER`、`IF-SYSTEM-TRASH`、`IF-SYSTEM-OPEN`、`IF-RESOURCE-PREVIEW` | PLATFORM；窄操作系统能力 |
| State machines | `IF-FILE-OPERATION`、`IF-MIGRATION-ROLLBACK`、`IF-REVISION-INVALIDATION` | LIBRARY/PROTECT/跨模块；详细状态见 §7 |

名称以本表为准。表中的 `IF-*-*` 不是通配运行时接口；实现工作包必须引用一个或多个具体接口 ID。

## 5. 模块契约

### 5.1 `MOD-SHELL` — 桌面呈现

**Purpose**

把 Workspace 投影、能力、问题和操作状态呈现为产品文档定义的桌面体验，并收集明确用户意图。

**Owns**

- 页面、抽屉、模态框、Toast、导航上下文和当前编辑模型；
- 键盘、焦点、屏幕阅读器状态消息、文字/图标状态表达；
- `DraftCheckpoint.opaquePayload` 的解释和兼容迁移；
- 页面级筛选、滚动、选择等非领域状态。

**Does not own**

- Term/Course/Task/File/Grade/Attendance 事实或公式；
- 是否提交成功、影响范围、冲突、降级或 dataEffect 的推断；
- 路径访问、文件预览权限、时区换算或缓存一致性。

**Interfaces**

- Inbound：`ProjectionEnvelope`、`ImpactPreview`、`CommandOutcome`、`StructuredProblem`、`OperationHandle`、ResourceAccessOutcome；
- Outbound：只调用 `IF-WORKSPACE` 的五种能力。

**Invariants**

1. 只有 committed 后更新正式界面状态；accepted 显示操作状态而非最终成功。
2. 验证失败、冲突和保存失败保留当前输入；正式数据变化由 dataEffect 原样表达。
3. 空状态包含缺少内容与可执行下一步；unavailable/stale 不显示为真实空列表。
4. 状态不只依赖颜色、hover 或拖拽；所有核心动作有键盘路径。
5. 高影响操作使用 ImpactPreview/确认；完成/跳过等可逆小操作可以附 6 秒 Undo Toast。
6. Shell 不缓存一套独立领域计算；切换页面后结果仍来自 Workspace query。
7. 资源预览只按 `PreviewDescriptor` 呈现只读内容和文字状态；不得执行文件中的链接、脚本、表单或标记。session 失效后停止读取并要求显式 reload；平台 action 只显示 requested/failed，不推断第三方应用成功。

**Problems / Degradation**

Shell 局部渲染失败只能影响相应表面，不得提交补偿性领域命令。无法解释的新 ProblemCode 必须显示安全的通用错误、已有 dataEffect、受影响能力和 owner 已给出的安全动作；不得索取原始错误或自行补出 retry/resume/rollback。

**Test seams**

以固定 Workspace contract driver 注入每个 outcome、capability、health、空/未知/stale/problem 状态；执行键盘、焦点、状态公告和窄桌面验收。

**Trace**

`NFR-006`、`STATE-001–007`、全部 UI 表面；`Q-ACCESS-01`、`Q-DIAG-01`；`TEST-SHELL-001–005`。

### 5.2 `MOD-WORKSPACE` — 应用边界与编排

**Purpose**

提供唯一应用接口，在不夺取领域语义的前提下协调生命周期、修订、模块调用、影响预览、长操作、降级和投影组合。

**Owns**

- `WorkspaceLifecycle`、`SetupProgress`、DraftCheckpoint 保存协议；
- production `AppBuildId`/Workspace protocol exact-match 判定和启动 build 分类；
- Workspace mode、Capability/Health 聚合；
- `CommandEnvelope` 路由、版本/确认前置检查和 CommandOutcome 组合；
- `ImpactPreview` 的跨模块组合；
- `ProjectionEnvelope` 的 revision/EvaluationContext；
- 跨模块 OperationHandle 汇总与当前路由（welcome/setup/today/maintenance/recovery）。

**Does not own**

- PLAN 重复/假期/冲突规则；
- ATTEND 或 GRADE 公式；
- LIBRARY 磁盘—索引对账；
- PROTECT 快照/恢复/迁移回退内部状态机；
- DATA 原子机制或 PLATFORM API。

**Interfaces**

- Inbound：`IF-WORKSPACE`；
- Outbound：`IF-PLAN-*`、`IF-ATTEND-*`、`IF-LIBRARY-*`、`IF-GRADE-*`、`IF-PROTECT-*`、`IF-DATA-*` 与窄 PLATFORM capability 查询。

**Invariants**

1. Shell 的每个正式意图最多路由到一个语义主所有者；其他模块只贡献影响、投影或 DurableFollowUp。
2. 复合 query 在一个 ReadSnapshot 上完成；无法满足时返回明确 problem/stale，而非混合 revision。
3. 所有自动行为（如日期越过 Term end 的归档）仍以可审计 Intent 经 FLOW-01 提交。
4. 次级/外围模块失败只修改相关 capability/health；不把全 Workspace 无条件设为失败。
5. Workspace 不吞掉模块 ProblemCode，不把 error 转为空，不改写 dataEffect。
6. Setup 当前最低条件由正式事实计算：存在 Current Term、至少一门 Course、至少一条 MeetingSeries 或课程 Task；第一次达到时持久推进 `everReachedMinimum`。当前事实后来不满足（包括学期自动归档）不得抹掉该里程碑。
7. 从未达标的 Workspace 重启默认回到 setup，但仍可明确提前进入 Today；曾达标的 Workspace 重启默认进入 Today，即使当前无 Current Term，并显示“学期已结束/需要新学期”的真实状态与历史/创建入口。
8. 应用重启后先恢复持久 Operation/DurableFollowUp，再决定普通路由。
9. 打开 DATA 或启动 Library watcher 前必须先取得 PROTECT 对 Restore 与 MigrationRollback 的统一启动判定；未终结 handoff、激活未收敛、证据冲突或未知协调版本只能路由 maintenance/recovery，不得让 Workspace、Shell 或 Main 解释物理阶段。
10. Main/Renderer/Workspace utility 的 AppBuildId/协议必须 exact match；不匹配时不发送业务 query/command。等待 migration rollback 的 exact source build 只能取消/等待，exact target build 只能按会话继续，其他 build 不进入普通 Workspace。
11. 普通软件更新不是运行时 Intent；Workspace 不查询 release feed、不下载或安装应用，只消费内嵌 release identity 和当前本地操作状态。

**Problems / Degradation**

- 模块 unavailable → `limited`，相关投影片段 unavailable；
- DATA 可读不可写 → `read-only`；
- DATA 不可读、版本不兼容、Restore/MigrationRollback activation 不确定 → `recovery`；
- PLAN 核心投影失败 → 相关核心查询失败或明确 stale，不降级成“没有事项”。

**Test seams**

使用可替换的 healthy/slow/failing/recovering 模块 driver、可控 Clock 和版本冲突 DATA driver；验证每个 Workspace mode、Envelope、一致 revision、幂等、preview 和 follow-up 状态。

**Trace**

`UF-A-01–09`、`UF-A-P01`、跨模块 STATE/NFR；`FLOW-00–07`；`Q-CONSIST-01`、`Q-ISOLATE-01`、`Q-CONTINUITY-01`、`Q-DIAG-01`、`Q-RELEASE-01`；`TEST-WORKSPACE-001–007`。

### 5.3 `MOD-PLAN` — 学习计划核心

**Purpose**

拥有学期、课程、假期、课节和任务的正式语义，并从规则段、范围、假期与实例覆盖确定性地产生统一计划投影。

**Owns**

- Term、HolidayRange、Course；
- MeetingSeries/MeetingSegment/MeetingOccurrence/MeetingOverride；
- TaskSeries/TaskSegment/TaskOccurrence/TaskOccurrenceState；
- Current Term 约束、自动归档领域判断、课程/规则范围；
- Today/Week/Calendar/TBA 所需的计划实例与时间/状态分类；
- 时间重叠 warning 和删除/归档/分段 ReferenceImpact。

Course 的正式字段为 code、name、可选 section、instructor、color、credits、courseNote 和教学范围；instructor 只有 Course 级一个来源。MeetingSegment 保存规范 type、星期、当地开始/结束时间、地点、可选 meetingNote 和有效范围，不保存独立 instructor。Task 的正式字段至少包含 title、CourseId、用户明确选择的 small/large、Deadline、单次/每周规则、followTeachingWeek 和大任务可选进度。

Task schedule 只有两种当前变体：

- `once(deadline: Deadline)`；
- `weekly(startDate, weekday, localDeadlineTime, confirmedEndDate, followTeachingWeek)`。

每周规则的起止日均包含在范围内，且必须位于 Course 教学范围；`confirmedEndDate` 可以采用系统建议的 Course end，也可以由用户缩短，但未确认前不得产生正式系列。TBA 是单次 Task 的显式 Deadline 状态；当前每周规则必须具有可派生实例的星期和当地截止时间。

周期实例的唯一派生口径是：在 Term/Course/Segment 有效范围交集（包含首尾日期）内选取匹配 weekday 的日期，应用 HolidayRange 抑制，再应用单次 override；边界日不匹配 weekday 时从范围内第一个匹配日开始、到最后一个匹配日结束。Meeting 与 weekly Task 共享这套窗口/范围算法，仅由 `followTeachingWeek` 决定 Task 是否受 HolidayRange 抑制。

**Does not own**

- 出席记录、文件、成绩、备份或页面布局；
- 当前系统时区、真实 Clock 实现、持久化技术；
- C2/C3、工作量、计时或任务关系的未来事实。

**Interfaces**

- `IF-PLAN-COMMAND`：验证 PlanIntent 并产生领域 ChangeSet、warnings、ReferenceImpact；
- `IF-PLAN-QUERY`：按 ReadSnapshot/EvaluationContext 产生计划投影；
- `IF-PLAN-IDENTITY`：向外围模块提供稳定 Term/Course/Task/Occurrence 引用及存在性/版本校验；
- `IF-PLAN-IMPACT`：说明删除、归档、切换、规则变化对自身和已知引用的影响。

**Invariants**

1. Workspace 最多一个 Current Term；历史 Term 不因切换或归档删除。
2. Term end 不早于 start；Course 教学范围默认继承 Term 且位于 Term；Meeting/Task 周期范围默认继承 Course 且可明确缩短。
3. Meeting type 为 LEC、TUT 或 PRA，并向投影提供稳定 code 与可理解全称；星期和当地开始/结束时间必填；结束时刻在 TermZone 中晚于开始，可显式跨至次日；地点可 TBA。Meeting 只引用 Course instructor，不提供课节级覆盖。
4. 同一 Series 在任一逻辑日期最多一个有效 Segment；分段不重写此前 Segment。
5. OccurrenceId 在同一逻辑实例上稳定；override 只影响目标实例。
6. Reading Week/其他 HolidayRange 抑制周期 Meeting 和明确 followTeachingWeek 的重复 Task；一次性事项保留。
7. 时间冲突是带对象和时间的 warning，不自动移动、删除或阻止用户明确继续。
8. 新 Task 必须关联 Current Term 中的 Course，并由用户明确选择 small/large；系统不从标题或截止时间猜测规模。对历史 Term 的修改必须是明确的历史更正路径。
9. Deadline 的 date-only、timed、TBA 保持不同；TBA 不进入倒计时、逾期或虚构日历格。
10. TaskOccurrence 的 pending/completed/skipped 分开；大任务进度为可选 0–100%，completed 显示 100%，恢复后还原完成前进度；进度不参与 Grade 计算。
11. 每周 Task 的结束条件默认建议 Course 教学结束日，只有用户确认或明确缩短后才建立；不得静默生成越过 Course 范围的实例。
12. Course 归档后默认不进入当前投影，历史事实和引用保留；自动 Term 归档只在 TermZone 当前日期超过 end 时发生，修正日期并满足唯一 Current Term 约束后可显式恢复。
13. 创建新 Term 不自动复制历史 Course、MeetingSeries 或 TaskSeries；任何未来复用能力必须是新的显式 preview/confirm intent。
14. timed Task 在截止 Instant 后逾期；date-only Task 在 TermZone 该 LocalDate 结束后逾期；TBA 不逾期。
15. Today 任务计数按任务截止/实例日期归属：属于今天且 completed 的计完成，属于今天且 pending 的计待完成；提前完成的未来任务、今天才完成的历史逾期任务、skipped、TBA 和此前逾期任务不混入两项计数。
16. ATTEND disabled 时，今天已结束且未取消的 Meeting 计计划完成，进行中/未来 Meeting 计待完成；取消和 holiday-suppressed 不计。跨日 Meeting 归入开始日期，并在实际结束 Instant 前保持进行中。ATTEND available 时由其 overlay 替换有效窗口内课节的计数语义。
17. Term progress 使用包含首尾两日的公式 `clamp((applicableDate - start + 1) / (end - start + 1), 0, 1)`；Holiday 不从分母扣除。
18. HolidayRange 在周日历投影中按每个可见周最多一个连续片段输出，在 Agenda 中输出一个带起止日的范围事项；不得派生成每日假期记录。
19. 应用内提醒只由 Today/Week、倒计时和临近分类投影构成；应用关闭时不承诺系统通知、邮件或后台推送。
20. `next-small` 与 `next-large` 分别只从 Current Term 中 pending、未 skipped 且日期已知的对应规模 TaskOccurrence 选择；timed 使用真实截止 Instant，date-only 使用 TermZone 当日结束作为排序边界，TBA 不参与；无候选时返回带原因的真实空状态。并列时使用稳定身份产生确定顺序。
21. Today/Week/Calendar/Agenda 投影必须携带同一 occurrence identity、文字类型、时间分类和来源引用。Meeting 至少区分 upcoming、in-progress、ended、cancelled、holiday-suppressed；Task 至少区分 overdue、today、near-due、future、completed、skipped、TBA。Today 摘要同时返回 Task/Meeting 的贡献明细以及 skipped、missed、unmarked 等未计入项。
22. 投影按照请求窗口计算，不要求扫描所有历史；缓存可删除重建。

**Problems / Degradation**

字段/范围错误返回 validation；版本变化返回 conflict；非阻塞重叠作为 warning。无法产生一致核心投影时返回 integrity/recovery problem，不返回空数据。

**Test seams**

ClockPort、ZoneRules、确定性 ID、任意日期窗口与纯 evaluator；性质测试覆盖正常周、DST、Reading Week、仅本次、本次及未来、历史状态、TBA、冲突和日期归档。

**Trace**

`A-TERM-001–005`、`A-COURSE-001–007`、`A-TASK-001–010`、`A-VIEW-001–006`、`A-CALENDAR-001–003`；`FLOW-00–02`；`Q-CONSIST-01`、`Q-TIME-01`、`Q-STATE-01`；`TEST-PLAN-001–008`。

### 5.4 `MOD-ATTEND` — 可选出席记录

**Purpose**

在不改变 PLAN 课表事实的前提下，按明确启用周期保存自报出席并产生可解释统计。

**Owns**

- AttendanceWindow（以 Instant 表达、半开区间 `[effectiveFrom, closedAt)` 的启用窗口，同时记录开启时的 TermZone LocalDate）；
- attended/missed 的 AttendanceRecord 与显式更正；
- unmarked 义务、课程计数、出席率、覆盖率和 Today 覆盖投影。

**Does not own**

- MeetingOccurrence 身份、时间、取消或假期抑制；
- 定位、二维码、教师验证、后台自动判断或学校正式考勤；
- PLAN 的 Today/Calendar 基础投影。

**Interfaces**

- `IF-ATTEND-COMMAND`：EnableAttendance、DisableAttendance、MarkAttended、MarkMissed、ResetToUnmarked；
- `IF-ATTEND-QUERY`：TodayOverlay、CourseAttendanceProjection、CapabilityState；
- `IF-ATTEND-IMPACT`：Meeting/Term 变化对记录引用的核对影响。

**Invariants**

1. 默认 disabled；首次 Enable，或上一个窗口在更早 TermZone LocalDate 已关闭时，`effectiveFrom` 为本地当天 00:00，包含当天较早已结束课节但不回溯更早日期。
2. Disable 在该命令的 commit Instant 关闭当前窗口；MeetingOccurrence 的开始 Instant 不早于 `closedAt` 时不产生义务。关闭前已经具备资格或已有记录的实例保留。
3. 再次 Enable 建立新窗口且不补写关闭间隙；若前一窗口在同一 TermZone LocalDate 关闭，`effectiveFrom` 为本次 Enable 的 commit Instant，否则按第 1 条取当天 00:00。窗口不得重叠且最多一个未关闭窗口。
4. 只有开始 Instant 落入某个有效窗口、已经开始且应上课的 MeetingOccurrence 可标记；取消、假期抑制、窗口外和未来实例不产生记录义务。
5. unmarked 保持未知，不存成 missed。
6. `attendanceRate = attended / (attended + missed)`；分母为零则 unknown。
7. `coverageRate = (attended + missed) / eligibleEndedOccurrencesInWindows`；分母为零则 unknown。
8. Today 在 capability available 时：attended 计完成，已结束 unmarked 待确认，missed 单列，未来/进行中待完成；disabled/unavailable 时退回 PLAN 时间语义。
9. ATTEND 失败不得阻止 PLAN query/command。

**Problems / Degradation**

feature-disabled、outside-window、occurrence-ineligible、conflict、not-committed 和 calculation-unavailable 均保持明确。统计失败使 ATTEND 投影 unavailable，不修改记录事实或 PLAN。

**Test seams**

可控 Clock/Zone、MeetingOccurrence fixture、窗口开关历史、分母为零、取消/假期、失败模块 driver。

**Trace**

`A-ATTEND-001–006`、`A-VIEW-006`、`STATE-006`；`FLOW-01/02/06`；`Q-STATE-01`、`Q-TIME-01`、`Q-ISOLATE-01`；`TEST-ATTEND-001–004`。

### 5.5 `MOD-LIBRARY` — 文件资料库

**Purpose**

管理一个符合本地资料库位置政策的根目录，使根身份、磁盘文件、稳定索引、目录派生标签和自定义标签保持可解释一致。

**Owns**

- LibraryRootId、RootGeneration、marker、根配置与健康；
- FileId/LibraryRecord、PathKey、验证标记、placement 和最后完整扫描状态；
- Term/Course/Category 文件夹映射、建议/自定义分类；
- 目录派生标签与独立 CustomTag；
- FileOperation、扫描/对账、同名/身份冲突、marker 修复、资源访问前置验证、版本化预览/启动风险分类和短期资源 lease。

**Does not own**

- Term/Course 的名称与生命周期；只保存稳定引用和文件夹映射；
- 文件系统/watcher/回收站实现、选择器、系统默认应用；
- 备份快照发布或恢复激活；
- 文件内容的 AI 分类。

**Interfaces**

- `IF-LIBRARY-COMMAND`：创建/迁移/重新授权根、当前路径 marker 修复、分类/标签、复制导入、重命名、移动、删除、扫描、冲突/身份决策；
- `IF-LIBRARY-QUERY`：根健康、搜索/筛选、列表、详情、FileOperation/对账状态；
- `IF-LIBRARY-RESOURCE`：FileId + stamp 的预览/系统打开/定位验证；
- `IF-LIBRARY-MANIFEST`：向 PROTECT 提供已验证 manifest/content source，向 restore 提供暂存/对账；
- `IF-LIBRARY-IMPACT`：Course/Term/Root 变化的文件夹和引用影响。

**Invariants**

1. MVP 同时只管理一个根目录。默认 Documents 和用户候选都先取得 LocationAssessment：known-cloud-or-remote 拒绝；unknown 必须展示“无法识别任意第三方同步”的限制并记录用户确认；任何候选还必须 preview、验证读写能力，且与活动数据/备份位置既不相同也不互为祖先/后代。
2. 正常 ChangeRoot 只迁移到 CourseFlow 新建或确认为空的新根；Reauthorize 只接受匹配 WorkspaceId + LibraryRootId marker 的非空原资料库。RepairLibraryMarker 只允许数据库当前路径，经只读完整扫描、影响预览和确认后执行。任一路径在提交前后都只有一个 current RootGeneration。
3. 真实文件内容与存在性以磁盘为准；索引只声明最后验证事实。LibraryRootId、FileId、PathKey、对象证据和内容摘要彼此不可替代。
4. PathKey 原样保留目录枚举返回的大小写与 Unicode；不以 lowercase、Unicode normalization、字符串前缀或跨 root 键比较决定身份、containment 或重名。名称无法在当前平台表示与 UTF-8 scalar 序列间严格 round-trip 时不得以替换字符造键，受影响范围标 unverified。
5. 当前根或受管理树中被 PLATFORM 分类为 `link-unsupported` 的条目（目标平台可识别的 symlink/junction）不得跟随；解析后越出 current root 或被分类为 `special-unsupported` 的条目也拒绝。当前平台能力不承诺识别操作系统的每一种特殊文件元数据；无法枚举或分类的范围必须标 unverified。普通 hard-link 路径分别获得 FileId，共享对象证据时不得自动关联为移动。
6. Watcher 事件只是 scan-required hint。启动、用户重扫、watcher 异常和应用持续运行期间最迟每五分钟启动的完整核对使用同一 ScanOperation；扫描串行，RootGeneration 改变或枚举不完整时不得提交完整结果。
7. FileOperation 遵循 `planned → disk-applied → index-committed`，payload/version 持久化且同一根的应用管理 mutation 串行；中断后按磁盘实况继续、补偿或进入 reconciliation-required。
8. 文件操作只有 index-committed 后才面向用户完整成功；disk-applied 必须说明磁盘可能已改变。operation-owned 临时项只有与持久 Operation 精确匹配时才可从用户索引排除。
9. 应用导入复制原文件，不移动源文件；复制前后必须验证源未变化并验证目标字节，源文件后续变化不影响资料库副本。
10. 应用内 rename/move 保留源 FileId。同名文件不得覆盖，直到用户选择 keep-both、replace 或 cancel；keep-both 先预览名称且执行时仍使用非覆盖语义。replace 的逻辑身份跟随操作源，原目标 retired，其 CustomTag 不转移。
11. Delete 只通过系统废纸篓/回收站执行；平台失败不得降级为永久删除。结果丢失且只能证明原路径消失时进入 reconciliation，不宣称可恢复删除成功。
12. 外部移动只有在当前根/卷内的版本化对象证据唯一且无冲突时自动保留 FileId；证据不足时进入等待决定，不以文件名、size、mtime 或 content hash 单独猜测。可靠对象证据证明同路径物理替换时获得新 FileId；同路径 stamp 已变化但对象证据缺失或不可靠时，旧 record 标 unverified 并进入 `ambiguous-file-identity`，用户确认前不得自动转移 FileId、历史或 CustomTag。
13. 已验证根内但不属于既有 Term/Course/Category mapping 的普通文件仍建立 record，placement=unassigned、CustomTag 为空，并进入 manifest；不得从文件夹名称创建或匹配 PLAN 身份。
14. 默认建议分类为“考试、笔记、作业、练习、其他”；用户可以增删或重命名分类。删除非空分类前必须 preview 文件数与目标路径，并只接受“移动到用户选择的其他分类”或 cancel；分类变化不得静默删除文件。目录派生标签随已验证路径变化；CustomTag 独立保存，不因移动或分类更名删除。
15. 课程重命名以 CourseId 保持映射。物理目录后续动作失败时核心课程事实可以已提交，但 Library 必须显示 pending/reconciliation 状态，不声称整体完成。
16. 根迁移在旧根完成扫描且无其他未决文件操作后复制/验证新根；新根完整对账并提交新 RootGeneration 后才启动新 watcher。清理旧根前再次验证 marker、最终 manifest/stamps 和 cutover 后变化；任何新增/变化、验证或回收失败都只产生明确的非活动副本 follow-up，不删除未知变化，也不恢复双活动根。
17. 任意文件类型可以保存；PDF、PNG、JPEG、WebP 和纯文本候选只有通过版本化类型政策后才获得只读内置预览。加密、类型不一致、超限、解析失败或 session 失效不显示部分内容。经启动风险政策判为非高风险的普通文件无论是否支持预览，都可在每次完整重验后请求 system-open/reveal；已知可启动的高风险文件只可 reveal，不得由 CourseFlow 启动或在应用内绕过。
18. 权限、marker 或根可用性丢失时索引标 unverified；不得继续显示“可用”，但旧列表上下文可保留并明确状态。只有 watcher 降级且五分钟扫描仍可用时，经逐次验证的文件能力可以继续。
19. 搜索/组合筛选只返回索引中的真实记录及验证状态，不合成示例文件。
20. marker format、PathKey encoding、ObjectEvidence provider 和 FileOperation payload 均版本化；未知仍在生命周期内的版本使 LIBRARY recovery，不重置 FileId、索引或磁盘。
21. Restore candidate 含 Library 时，RestoreSession 复用健康且可安全切换的当前根并保持同一用户可见位置；没有当前根、根不可用或目标父目录不满足恢复切换前提时，只接受符合位置政策的新建或空本地根。candidate 明确 Library absent 时不要求虚构新根，旧根若存在则保持原位但不再活动。恢复后的 present 根使用新的当前设备 RootGeneration；完整扫描、marker/身份验证和文件闭包对账完成前不得恢复 watcher 或宣称恢复成功。

**Problems / Degradation**

permission、root-unavailable、root-not-local、root-overlap、root-identity-mismatch、marker-missing、entry-link-unsupported、entry-type-unsupported、entry-name-unsupported、watcher-degraded、scan-incomplete、resource-stale、resource-timeout、resource-channel-closed、resource-epoch-mismatch、preview-type-mismatch、preview-password-required、preview-limit-exceeded、preview-parse-failed、launch-risk-blocked、platform-no-association、platform-open-failed、ambiguous-file-identity、name-conflict、trash-failed、disk-applied、reconciliation-required、operation-version-unsupported、not-found 和 unsupported-preview。不得把解析失败命名为“文件损坏”，除非独立验证已经证明该事实。普通 LIBRARY unavailable 时其他结构化模块继续，文件写操作关闭，适用的重新授权、当前路径 marker 修复、扫描或换根入口保留；已经成为未收敛 Restore participant 时按 PROTECT/WORKSPACE 契约进入全局 recovery。

**Test seams**

虚拟 FileSystemPort、Watcher、LocalLocationClassifier、SystemTrash、五分钟可控时钟、权限变化、路径大小写/Unicode/分隔差异、link/hard-link fixture、逐阶段 failpoint、同名/身份策略、外部移动/替换、marker 损坏/修复、重启扫描、资源 stamp/epoch/root 失效、类型/启动风险 fixture、有界 range/lease driver 和 macOS/Windows conformance。

**Trace**

`B-FILE-001–013`、`NFR-001/002/003/006/010`；`FLOW-03–05`；`Q-TRUTH-01`、`Q-PROTECT-01`、`Q-ISOLATE-01`、`Q-LOCAL-01`、`Q-ACCESS-01`、`Q-RESPOND-01`、`Q-PORTABLE-01`、`Q-EVOLVE-01`、`Q-DIAG-01`；`TEST-LIBRARY-001–007`。

### 5.6 `MOD-GRADE` — 成绩与当前学期 SGPA

**Purpose**

保存直接权重评分事实与版本化等级模板，并从一个 ReadSnapshot 产生带来源、覆盖范围和未知原因的单科结果与当前学期估算 SGPA。

**Owns**

- GradingScheme、GradingItem、ScoreResult；
- GradeScaleVersion、来源、适用年份、核对日期和课程绑定；
- SGPA 结果来源选择、用户输入的最终成绩及其 provenance；
- GradeProjection、CurrentTermGradeOverview 和未覆盖清单。

**Does not own**

- Course/Task 身份或 Task 完成状态；评分项只保存显式 Task 引用；
- Course credits；它是 PLAN 的 Course 事实，GRADE 只在同一 ReadSnapshot 中读取；
- 任务进度、目标成绩 C2、Academic History C3；
- 学校正式记录连接；
- UI 自行取整或显示策略。

**Interfaces**

- `IF-GRADE-COMMAND`：方案/评分项、成绩录入、模板复制/编辑、课程绑定、显式任务关联、结果来源；课程学分更新仍使用 PLAN 的 Course intent；
- `IF-GRADE-QUERY`：CourseGradeProjection、CurrentTermGradeOverview、GradeScaleProjection；
- `IF-GRADE-EXPORT`：版本化 GradeProjection、FinalCourseOutcome、GradeScaleVersion 只读接缝；
- `IF-GRADE-IMPACT`：Task/Course/Scale 删除或修改的引用影响。

**Invariants and formulas**

1. MVP 评分方案为直接权重项；每项权重 known 或 unknown。已知权重合计不等于 100% 时 warning，不自动归一化或补足。
2. 成绩可以由 earned/max 或直接百分比明确录入；max 缺失、ungraded 与 scored-zero 分开。
3. 对每个已出分且权重已知的项 `i`：`weightedPoints_i = weight_i × scorePercent_i / 100`。
4. `earnedWeightedPoints = Σ weightedPoints_i`。
5. `gradedCoverageWeight = Σ weight_i`（只含已出分且权重已知项）。
6. `gradedPortionPercent = earnedWeightedPoints / gradedCoverageWeight × 100`；coverage 为零时 unknown。
7. 未出分、max 缺失或权重 unknown 的项不按零计入；必须列入未覆盖/警告。
8. GradeScaleVersion 包含按顺序的 A+、A、A−、B+、B、B−、C+、C、C−、D+、D、D−、F；分数线连续、单调、无重叠，映射使用未经自动向上取整的原百分比。
9. 内置 UTM Undergraduate 2026–2027 模板记录来源、适用年份和核对日期，规范 fixture 必须逐档匹配 [PRD §5.1](../product/PRD.md#51-utm-默认模板) 与 [UTM 核对记录](../research/utm-grading-gpa-rules.md)；编辑产生个人副本/新版本，不就地改写历史绑定。
10. 每门 Course 显式绑定 GradeScaleVersion；更换 Term 默认模板不静默改写已完成课程绑定。
11. current-estimate 的 percentage 是 `gradedPortionPercent`；calculated-final 只在直接权重方案完整、已知权重合计 100% 且所需成绩全部已知时产生；manual-final 与 user-attested school-record 使用用户明确输入的最终 percentage。任何选择都必须显示 result source；calculated-final 不得标为 school-record。
12. `SGPA = Σ(courseGradePoint × courseCredits) / Σ(includedCourseCredits)`；F 以 0.0 纳入；缺学分或可用成绩的课程列入未覆盖，不加入分母。
13. 只称当前学期估算 SGPA，不输出学期总百分比、AGPA 或 CGPA。
14. CourseGradeProjection 明确输出 percentage、letter grade、grade point、credits、result source/provenance、GradeScaleVersionId、earned weighted points、graded portion percent、coverage、估算标识和 warnings。
15. CurrentTermGradeOverview 输出 `estimatedSgpa: known|unknown(reason)`、纳入学分、未覆盖 Course/原因清单和估算/学校正式记录说明；对每门 Course 输出 percentage、letter grade、grade point、credits、result source 和 coverage，并与单科读取同一个版本化 GradeProjection。不得分别重算或虚构学期总百分比；没有可纳入课程时 SGPA 为 unknown，不显示 0.00。
16. GradingItem 的可选关联使用 `GradeTaskRef`，只能指向同一 Course 的现存 TaskSeries/TaskOccurrence。Task 标题、完成/跳过状态和自报进度不得自动建立关联或改变 ScoreResult；删除/分割被引用 Task 时必须预览并显式保留、重绑或解除引用，不得级联删除成绩。

**Problems / Degradation**

unknown-weight、incomplete-score、invalid-scale、coverage-insufficient、source-missing、conflict 和 calculation-unavailable。计算失败不修改成绩事实；上次结果若显示必须标 explicitly-stale，不能冒充当前。

**Test seams**

纯 Grade evaluator、官方模板 fixture、0 分/未出分/unknown weight、合计非 100%、等级边界、84.5 不取整、各 result source、GradeTaskRef、F=0、缺学分和总览一致性。

**Trace**

`C-GRADE-001–014`、`STATE-003/005`；`FLOW-01/06`；`Q-STATE-01`、`Q-PROVENANCE-01`、`Q-EVOLVE-01`；`TEST-GRADE-001–007`。

### 5.7 `MOD-PROTECT` — 备份、恢复与迁移回退

**Purpose**

在不阻塞本地正式保存的前提下生成完整、不可变且可独立验证的快照，通过显式、可恢复会话替换整个活动数据集，并协调 migration safety copy 的精确应用版本回退。

**Owns**

- BackupConfiguration、BackupSetId、集合内 backupSequence、backup-needed/success watermarks、最后成功/错误；
- BackupCheckpoint、SnapshotManifest、Snapshot 发布/验证/保留/清理状态；
- RestoreSession、影响预览、RestoreSafetySet 生命周期、恢复激活协调状态与暂存/验证/激活编排；
- MigrationRollbackSession、回退影响预览、ActivityControl handoff、exact-build allowed actions 与全局数据切换互斥；
- “不自动合并副本”的恢复策略。

**Does not own**

- 活动结构化提交、Library 文件真相；
- 云盘同步工具、提供商上传完成状态或远程一致性；
- 用户业务数据的语义迁移规则；
- schema migration、MigrationSafetyCopy/DataSlot 的物理生成、验证与切换；
- 安装器、GitHub release、应用下载或外部程序替换；
- 当前 Workspace 路由和 UI。

**Interfaces**

- `IF-PROTECT-COMMAND`：配置/清除目的地、立即备份、重试，以及恢复的开始、选择资料库目标、确认、检查点前取消、继续和回滚；
- `IF-PROTECT-QUERY`：备份状态、分 BackupSet 的 SnapshotList/Detail 与 `verified | incomplete-or-sync-pending | corrupt | incompatible | unknown-entry` 状态、清理状态、RestoreSession；
- `IF-BACKUP-CHECKPOINT`：从 DATA 获取一致 revision，从 LIBRARY 获取已验证 manifest/content；
- `IF-RESTORE-SESSION`：启动前检查、执行封闭恢复命令、查询 RestoreSession，并协调 DATA/LIBRARY 的暂存、验证、激活与回执。
- `IF-PROTECT-MIGRATION-ROLLBACK`：查询 safety copy、预览/确认/继续/取消回退、启动前检查 MigrationRollback handoff，并协调 DATA 重开与 LIBRARY 对账。

**Invariants**

1. 未配置备份目录是合法“仅保存在本机”，不是持续错误。
2. 目的地不得与活动数据目录或 LibraryRoot 重叠；PROTECT 只管理带当前 repository/Workspace/BackupSet 身份的边界，不取得同目录其他文件的所有权。
3. 每项持久 BackupConfiguration 拥有稳定 BackupSetId 和独立、单调但允许间隙的 backupSequence；不同 BackupSet 不互相计数、选新或自动清理。
4. 正式结构化提交或 Library index-committed 原子推进 backup-needed 水位；PostCommitChange 只负责唤醒。
5. 备份可以合并多个 revision 请求，但发布快照必须声明 DATA Online Backup 的实际 revision 和与该副本完全一致的文件闭包。
6. B 已交付时，闭包包含根 marker、全部 active/unassigned 且已验证的普通文件及数据库中的课程/分类/自定义标签映射；任一项缺失、未验证、复制期间变化或存在未收敛物理操作时整份停止，不发布部分快照。
7. 快照自包含且发布后不可变；manifest/member locator 不引用共享对象、外部绝对路径或活动文件，不包含 preview cache、lease、解析投影和操作临时产物。完整数据库副本中既有的设备路径/目的地/operation 字段只作待失效的历史元数据，不构成 snapshot capability 或成员引用。
8. SnapshotManifest、成员摘要、格式上限和兼容轴均版本化；严格格式、SHA-256 覆盖、无压缩目录布局及数值上限由 [ADR-07](./adr/ADR-07-snapshot-format-integrity-publication.md) 唯一决定。checksum 只证明损坏/不一致检测，不声明认证或保密。
9. 发布遵循持久 operation、同 BackupSet 临时写、完整 staging 验证、发布到此前不存在且不得有意覆盖的本地 final 名称、final 全量重验、成功记录/水位提交的顺序；任一步失败都不得提前显示成功。
10. “备份成功”只表示所选目录的 final snapshot 已在本机发布、重新验证并记录；不得解释为外部云盘工具已上传完成。
11. 新快照成功记录后，每个 BackupSet 只保留 backupSequence 最大的两份已验证快照。清理只处理本机精确登记且身份一致的旧快照，并先同父目录改名到 operation-owned quarantine，再可恢复地删除。
12. 清理失败不回滚新快照或水位；其他 BackupSet、未知、无法验证、身份冲突或未登记条目永不自动删除。空间不足不得通过删除该集合最后或倒数第二份已验证快照强行制造成功。
13. 快照选择每次重新验证；只有 `verified` 可以进入 RestoreSession。缺失成员是 `incomplete-or-sync-pending`，明确摘要/数据库/闭包矛盾是 `corrupt`，未知未来版本是 `incompatible`，不能按目录时间自动选择最新。
14. 恢复依次执行选择、候选验证、影响预览、确认、RestoreSafetySet、目标绑定暂存、完整验证、激活检查点、重新打开/对账、成功回执与协调状态收敛。候选验证所用的迁移副本不等于确认后的目标绑定激活暂存。
15. 确认令牌必须绑定候选身份/完整性、资料库目标和影响摘要；健康 current state 绑定 Workspace revision 与 Library RootGeneration，restricted-waived current state 绑定显式 unavailable/damaged variant 与 owner raw-evidence fingerprint。任一变化返回 impact-changed 并要求重新预览，不自动合并。
16. 最终确认后立即进入 maintenance：停止普通写入、文件操作、备份和新预览，使既有资源 lease 失效；Watcher 只能产生待重验 hint。activation checkpoint 前允许取消，之后只允许证据支持的继续或回滚；两者都不安全时保持 recovery 且不提供物理动作。
17. 当前 DATA 与已配置 Library 健康时必须先创建并验证完整 RestoreSafetySet。DATA 损坏/只读或已配置 Library 无法完整读取时，只有原始 DATA/Library/恢复协调证据能保持不变且恢复协调位置可写，才可经独立警告与确认进入 restricted-waived；否则停止。容量不足必须在 checkpoint 前停止，不得删除安全集或既有好快照强行继续。
18. activation checkpoint 前失败保持原活动 DATA/Library 不变；checkpoint 后任何未收敛状态禁止打开普通 Workspace 或混合的新旧 DATA/Library。启动只可自动检查并补记磁盘证据唯一证明、且不改变 DATA/Library 的观察或终态记录；物理继续/回滚等待用户决定。
19. 只有候选 DATA 重新打开并通过格式/完整性/Workspace 身份验证，LIBRARY 完成 marker/RootGeneration/完整闭包对账，设备相关路径/能力/证据失效，且 FLOW-00 路由完成后，才能记录 succeeded。面向用户只承诺可恢复的逻辑全有或全无，不承诺跨资源操作系统事务。
20. checkpoint 后、succeeded 前可以回滚；回滚也必须重开、对账并恢复路由后才完成。succeeded 后返回旧数据必须发起新的完整 RestoreSession，不存在绕过验证/预览的一键回滚。
21. RestoreSafetySet 至少保留到恢复后首份常规快照发布并验证成功；未配置备份时保留为可见的独立本地恢复点，直到用户明确清理。恢复成功后的临时清理失败只进入 cleanup-pending，不回滚成功；未知、身份不匹配或无法验证的条目不得自动删除。
22. MVP 不自动扫描并选择“最新云盘副本”，不双向合并不同副本。checkpoint 候选禁止携带会改变活动 DATA/Library 闭包的 disk-applied、reconciliation、root cutover、recovery-file 等物理未收敛操作；纯 planned/waiting-decision 记录可以随数据库保存。本次 backup operation 在副本中只允许处于没有 source/final 效果、最多存在 operation-owned staging 的 queued 状态。恢复后所有目的地能力、外部路径/证据和 backup/cleanup operation 均失效，只能重配、重验、重新决定或取消，绝不盲目重放；未知 operation/follow-up 版本不兼容。
23. RestoreSession 与 MigrationRollbackSession 是不同封闭协议，但共享 PROTECT 对 ActivityControlRoot 的唯一所有权；任一 nonterminal DATA activation 存在时拒绝开始另一项，不嵌套、不并行。
24. PROTECT 只为当前已验证 MigrationSafetyCopy 创建 rollback preview；preview 必须绑定 copy ID/WorkspaceId/source revision/schema/digest、当前 migrated DATA identity/revision/schema/fingerprint、LibraryRootId/RootGeneration 或显式 unavailable、source/target AppBuildId 与影响摘要。任一变化返回 impact-changed。
25. preview 必须明确迁移后结构化变化丢失且不合并、真实 Library 文件保持原位并重新扫描，以及唯一 target version/tag/artifact；不得提供任意旧版本选择。
26. confirm 后进入 maintenance，停止普通 DATA/LIBRARY mutation、backup 和新 preview，使旧 lease/epoch 失效；PROTECT 只有在 DATA 证明 safety/current slots 完整、本地同卷和峰值容量足够后才允许达到 rollback checkpoint。
27. MigrationRollback handoff 是 bounded/versioned/canonical 正确性状态，只保存 session/operation/build/copy/slot identity、schema/revision/digest、phase、typed physical evidence 与 receipt；不得保存真实路径、任意 map、message、stack、raw error 或事件历史。
28. rollback checkpoint 前取消保持当前 migrated data；checkpoint 后 exact source AppBuildId 可以按证据取消并恢复 retained migrated slot，exact target AppBuildId 可以继续完成 safety data，其他 build 只返回 build-mismatch 和所需版本，不打开普通 Workspace。
29. 启动只能自动补记现有证据唯一证明且不改变活动数据的 observed/terminal 记录；任何 DATA rename/delete/continue/cancel 等物理动作等待用户明确命令。
30. target success 和 source cancel 都必须重新打开 DATA、验证身份/schema/revision、使旧设备能力失效、由 LIBRARY 完成全量扫描/FileId 对账并完成 FLOW-00 后才成为终态；不得报告部分成功。
31. succeeded 后 safety copy 已成为活动 DATA，不保留同内容第二份 safety copy；operation-owned sibling/handoff 只在 owner 重新验证清理资格后删除。rollback 不做 reverse migration、dual-write、任意 downgrade 或数据 merge。

**Problems / Degradation**

destination-unset、permission、snapshot-incomplete、snapshot-corrupt、snapshot-format-limit、incompatible-version、storage-full、cleanup-pending、identity-conflict、impact-changed、staging-failed、activation-pending、migration-safety-unavailable、rollback-target-unavailable、rollback-build-mismatch、rollback-required、recovery-required。Backup unavailable 或 cleanup pending 只使保护能力 degraded；已发布快照与活动数据不回滚。Restore/MigrationRollback activation 不确定使 Workspace recovery。只有会改变当前状态说明或安全动作的底层阶段才能进入该 code 的 typed safe details；不得泄露真实路径、原始错误或要求 Shell 解释物理交换。

**Test seams**

可替换 checkpoint source/destination、恢复/迁移回退协调状态、目录枚举/同步/rename、success receipt、quarantine/delete 与每阶段 failpoint；canonical golden vectors、每个格式上限 exact/one-over、source-before/after 变化、两个 BackupSet、部分云同步、按卷空间 exact/one-over、健康/缺失/只读/损坏的当前数据、资料库目标变体、旧/当前/未来/错误 AppBuildId、应用重启、激活每阶段中断、重复命令/响应丢失、继续/取消、安全集/迁移副本保留清理和 Library 大清单 fixtures。

**Trace**

`A-DATA-002–007`、`A-PLATFORM-002–004`、`B-FILE-012`、`STATE-002/007`、`NFR-003/012`；`FLOW-04/05/07`；`Q-TRUTH-01`、`Q-PROTECT-01`、`Q-ISOLATE-01`、`Q-LOCAL-01`、`Q-PORTABLE-01`、`Q-RESPOND-01`、`Q-EVOLVE-01`、`Q-CONTINUITY-01`、`Q-DIAG-01`、`Q-RELEASE-01`；`TEST-PROTECT-001–007`。

### 5.8 `MOD-DATA` — 活动数据协议

**Purpose**

为领域模块提供版本化、一致、幂等、可恢复的正式结构化数据提交与读取协议，不取得领域语义所有权。

**Owns**

- Revision、ReadSnapshot、EntityVersion 和 CommandReceipt；
- 原子逻辑 commit、幂等 command receipt；
- PROTECT/其他模块所定义 DurableFollowUp 与 backup watermark 的原子持久化协议；DATA 不拥有其业务含义或完成策略；
- export checkpoint、restore staging、activation checkpoint 和格式版本；
- schema/current-build compatibility、逐级前向 migration、最近一份 MigrationSafetyCopy 及其验证/替换/显式删除；
- MigrationRollback 所需 current/safety DataSlot 的同卷准备、切换、观察和重开；
- 持久操作状态的最低恢复能力。

**Does not own**

- Term/Course/Task/Attendance/Grade/File/Backup 的业务不变量；
- 哪些影响需要用户确认；
- 数据库、文件格式或事务算法的架构级预选。

**Interfaces**

- `IF-DATA-READ`：按一个 revision 提供一致 ReadSnapshot；
- `IF-DATA-COMMIT`：提交领域 ChangeSet + expected versions + commandId + DurableFollowUp；
- `IF-DATA-RECEIPT`：读取幂等命令结果；
- `IF-DATA-EXPORT`：生成一致、版本化活动数据 checkpoint；
- `IF-DATA-MIGRATION`：检查 schema/build 兼容、创建/查询/删除 MigrationSafetyCopy、执行逐级迁移并为精确回退准备/观察 DataSlot；
- `IF-DATA-STAGE-ACTIVATE`：暂存、验证、激活、继续/回滚；
- `IF-DATA-OPERATION`：保存/查询可恢复 Operation 状态。

**Invariants**

1. 一个成功 commit 要么同时写入全部领域事实、entity versions、new revision、receipt 和 follow-up，要么完全不成立。
2. 相同 CommandId 不重复应用；不同 payload 复用同一 CommandId 返回 conflict/integrity problem。
3. PostCommitChange 只能在 commit 完成后发出；通知失败不丢 follow-up。
4. ReadSnapshot 内所有事实对应一个 revision；长 query 不混入中途提交。
5. 提交失败不推进 revision，不触发正式 Undo 或 backup success。
6. schema/format 版本可识别；未知新版本停止打开并返回 incompatible-version，不自动重置。
7. export 声明 revision 和格式；stage 不改变活动真相；activation 具有可恢复检查点。
8. DATA 可读但不可写时提供 read-only 能力；不可读或激活不确定时只提供 recovery 接口。
9. Restore activation 前必须完成写入 drain、未决 statement/iterator/backup/validator 释放、SQLite WAL/sidecar 状态检查、checkpoint 与关闭；重新打开后必须重新验证格式、完整性、WorkspaceId/Revision 和 RestoreSession 回执。任何持有旧 epoch 的资源不得提交到新活动数据。
10. ActivityControlRoot/DataSlotsParent 必须由 PLATFORM 证明为受支持本地位置且同卷；unknown/remote、路径重解析越界或不能证明同卷时停止，不选择 fallback。
11. current schema 无需 migration 时不得创建 safety copy；supported old schema 在任何 schema write 前必须先产生原先不存在、已 checkpoint/关闭/sync、重新打开并完整验证的 copy。
12. MigrationSafetyCopy metadata 必须封闭且版本化，至少绑定 copy ID、WorkspaceId/source revision/schema、创建时间/size、closed-slot digest、createdBy AppBuildId 与 exact rollback target；摘要只识别精确副本/损坏，不声明认证。
13. 创建新 safety copy 期间旧 copy 保持；只有新 copy 和 metadata 完整验证/登记成功后才能替换旧 copy。每个数据根最多一份，不定时/按空间自动删除；用户删除失败保持原 copy。
14. schema migration 仍只按 ADR-04 `vN → vN+1` 逐级前向执行；每级中断以已提交 user_version 继续，不跳级、reverse、dual-write、旧 schema adapter、删除重建或自动 merge。
15. MigrationRollback 的 safety/current slot 操作使用同卷、write-ahead intent 后 owner observation；checkpoint 后 current migrated slot 保持为 operation-owned rollback sibling，直到 target success 或 source cancel 完整收敛。
16. exact target data 只有在重开验证 application/schema/WorkspaceId/Revision/integrity 后才能交给 LIBRARY/FLOW-00；exact source cancel 同样必须完整验证 retained migrated data。其他 AppBuildId 不得调用物理切换。
17. 涉及真实 Library marker/布局/文件切换的升级不属于 IF-DATA-MIGRATION，必须进入 ADR-08 的完整 staged activation。

**Problems / Degradation**

validation 由领域模块产生；DATA 产生 conflict、permission、integrity、incompatible-version、activation-pending、migration-safety-unavailable、rollback-build-mismatch 和 recovery-required。禁止把底层异常字符串当稳定 ProblemCode。

**Test seams**

CommitPort failpoint 覆盖提交每个阶段、幂等重放、并发版本冲突、通知丢失、重启 follow-up、只读、损坏、未知版本、copy-before-write、每级 migration、安全副本替换/删除、DataSlot 激活及 source/target build 继续/取消。

**Trace**

`A-DATA-001–007`、`A-PLATFORM-003`、`STATE-007`、`NFR-002/003/012`、`MVP-DOD-005/006/009`；`FLOW-00/01/04/05/07`；`Q-TRUTH-01`、`Q-CONSIST-01`、`Q-PROTECT-01`、`Q-EVOLVE-01`、`Q-CONTINUITY-01`、`Q-RELEASE-01`；`TEST-DATA-001–007`。

### 5.9 `MOD-PLATFORM` — 操作系统能力端口

**Purpose**

把 macOS/Windows 的时间、文件、选择器和系统打开差异封装为窄能力，使领域模块只处理规范语义。

**Owns**

- `IF-CLOCK`、`IF-ZONE-RULES`；
- `IF-FILESYSTEM`、`IF-WATCHER`、`IF-DIRECTORY-CHOOSER`、`IF-LOCAL-LOCATION-CLASSIFIER`；
- `IF-SYSTEM-TRASH`；
- `IF-SYSTEM-OPEN`、`IF-RESOURCE-PREVIEW` 的窄平台兑现能力；
- 平台 capability 与结构化错误映射。

**Does not own**

- 学期时区选择、文件冲突决策、根目录合法性业务规则、备份/更新/发行策略；
- 领域身份、索引、快照或页面文案；
- 通用 service locator。

**Interfaces**

- 时间：`IF-CLOCK`、`IF-ZONE-RULES`；
- 文件：`IF-FILESYSTEM`、`IF-WATCHER`、`IF-DIRECTORY-CHOOSER`、`IF-LOCAL-LOCATION-CLASSIFIER`、`IF-SYSTEM-TRASH`；
- 资源：`IF-SYSTEM-OPEN`、`IF-RESOURCE-PREVIEW`；前者只接受一次性 system-open/reveal 动作，后者只兑现已授权、有界且可取消的读取，不暴露原始平台 handle。

这些接口只返回规范 capability/result/problem；调用方不得依赖原始平台异常或路径 API。

**Invariants**

1. Clock/ZoneRules 可注入并在两个平台产生相同领域日期语义。
2. 文件操作准确报告 planned request 的物理结果、权限和路径；不得把失败报告为成功。
3. Watcher 明确是 best-effort hint，不提供“已完整扫描”保证。
4. 文件条目检查只返回 `FileEntryAssessment`；`unclassified` 不得降级为 regular-file/directory，平台特有的原始类型或错误不进入领域分支。
5. location classifier 只报告 `verified-local | known-cloud-or-remote | unknown` 及证据/限制；不得把 unknown 伪装为已证明 local。LIBRARY 是否按其产品政策接受 unknown 由 LIBRARY 决定；ActivityControlRoot/DataSlotsParent 必须 verified-local 且 same-volume，unknown/remote 直接停止，不允许用户确认绕过。
6. system trash 准确区分 completed、failed 与 outcome-unknown；不得自行 permanent-delete fallback。
7. 选择器取消是用户取消，不是 permission error。
8. system-open/preview 只处理已由 LIBRARY 为当前用途重新验证的资源描述；system-open 不接收命令行参数、URL 动作或被判定为高风险的可启动资源。
9. system-open 只区分 requested 与 failed，不把平台 API 接受请求解释为第三方应用成功；reveal-in-folder 是 best-effort requested。无默认关联与平台失败保持不同稳定原因。
10. 平台错误映射为稳定 capability/problem，不泄露为领域分支所依赖的原始异常类型。

**Problems / Degradation**

permission、not-found、temporarily-unavailable、location-not-local、location-unknown、trash-failed、trash-outcome-unknown、unsupported-preview、resource-timeout、resource-channel-closed、platform-no-association、platform-open-failed、user-cancelled。能力故障只传播到实际消费者；Clock/ZoneRules 无法可信计算时，时间相关核心投影 unavailable，而非使用猜测时区。

**Test seams**

Fake Clock/Zone/FS/Watcher/Chooser/LocationClassifier/Trash/Open/BoundedResource，外加打包后的 macOS 与 Windows 同一 conformance suite、真实权限、位置分类、回收站、默认应用/无关联、文件夹定位、Unicode/空格路径和资源取消 E2E。

**Trace**

`A-PLATFORM-001–004`、`B-FILE-009/010`、`NFR-001/002/004/006/010/012`；全部涉及时间/文件的 FLOW；`Q-TRUTH-01`、`Q-TIME-01`、`Q-LOCAL-01`、`Q-ACCESS-01`、`Q-PORTABLE-01`、`Q-RESPOND-01`、`Q-EVOLVE-01`、`Q-DIAG-01`、`Q-RELEASE-01`；`TEST-PLATFORM-001–005`、`TEST-RELEASE-001–005`。

## 6. Intent 与 Query 目录

本节列出 Shell/Agent 可拆分实现的逻辑变体。字段遵守对应模块词汇；新增变体必须保留语义所有者，更新追溯与测试义务。

### 6.1 Workspace lifecycle

| Intent | 主要所有者 | Preview / Operation 规则 |
|---|---|---|
| `InitializeWorkspace` | WORKSPACE + DATA | 创建活动数据失败则停留 welcome；不创建半初始化正式 Workspace |
| `SaveDraftCheckpoint` / `DiscardDraftCheckpoint` | WORKSPACE | 不是领域提交；版本不兼容返回明确问题 |
| `RecordSetupDecision` | WORKSPACE | 只记录明确 skip/later/choice，不伪造领域步骤完成 |
| `ReconcileWorkspaceLifecycle` | WORKSPACE + PLAN | 系统发起；需要归档时经正式 commit |
| `ResumeOperation` / `RetryOperation` / `CancelOperation` | 操作所有者 | 仅按 OperationHandle capabilities 开放 |
| `ResolveOperationDecision` | 操作所有者 | 选择绑定 operation version，过期需重新查询 |

Queries：`WorkspaceStatus`、`ApplicationBuildStatus`、`SetupProjection`、`OperationStatus`、`CapabilityProjection`、`ModuleHealthProjection`。

`ApplicationBuildStatus` 返回当前 `ApplicationReleaseDescriptor`、Main/Renderer/Workspace utility 的 exact-match 结果，以及存在 MigrationRollbackSession 时当前 build 的 `source | target | other` 分类；它不查询网络或发布渠道。

### 6.2 PLAN

| Intent family | 变体 |
|---|---|
| Term | `CreateTerm`、`UpdateTerm`、`SetCurrentTerm`、`ArchiveTerm`、`RestoreTermAsCurrent` |
| Holiday | `CreateHolidayRange`、`UpdateHolidayRange`、`DeleteHolidayRange` |
| Course | `CreateCourse`、`CreateCourseWithFirstMeeting`、`UpdateCourse`、`ArchiveCourse`、`RestoreCourse` |
| Meeting | `CreateMeetingSeries`、`UpdateMeetingSeries`、`ChangeMeetingOccurrence(scope=only-this|this-and-future)`、`CancelMeetingOccurrence`、`DeleteMeetingSeries` |
| Task | `CreateTaskSeries`、`UpdateTaskSeries`、`ChangeTaskOccurrence(scope=only-this|this-and-future)`、`DeleteTaskOccurrenceOrSeries` |
| Task state | `SetTaskOccurrenceStatus(pending|completed|skipped)`、`SetTaskProgress` |

Queries：`TermList/TermDetail`、`CourseList/CourseDetail`、`MeetingSeriesDetail`、`TaskList/TaskDetail/TaskSeriesDetail`、`TodayProjection`、`WeekProjection`、`CalendarWindowProjection`、`AgendaProjection`、`TbaProjection`、`PlanImpactProjection`。

`CreateCourseWithFirstMeeting` 是 `WP-R2-03` 的原子 setup 变体：在已有 Current Term 中一次创建 Course 与首个 MeetingSeries。当前命令显式携带 `endDayOffset` 和 `overlapDecision=review|continue`；旧 schema 命令只用于持久回执重放。它不表示 Meeting 拥有 instructor override，也不扩展 occurrence、规则分段或多个 meeting 的生命周期语义。

### 6.3 ATTEND

Intents：`EnableAttendance`、`DisableAttendance`、`MarkAttended`、`MarkMissed`、`ResetAttendanceToUnmarked`。启停时刻由 Workspace 的可信 Clock 在正式 commit 边界确定，不接受 Shell 自报时刻。

Queries：`AttendanceCapability`、`TodayAttendanceOverlay`、`CourseAttendanceProjection`、`AttendanceImpactProjection`。

### 6.4 LIBRARY

| Intent family | 变体 |
|---|---|
| Root | `CreateDefaultLibraryRoot`、`ChangeLibraryRoot`、`ReauthorizeLibraryRoot`、`RepairLibraryMarker` |
| Taxonomy | `CreateCategory`、`RenameCategory`、`DeleteCategoryWithResolution`、`AddCustomTag`、`RenameCustomTag`、`RemoveCustomTag` |
| File mutation | `CopyFileIntoLibrary`、`RenameFile`、`MoveFile`、`DeleteFile` |
| Conflict | `ResolveNameConflict(keep-both|replace|cancel)` |
| Reconciliation | `StartLibraryScan`、`ResumeFileOperation`、`ResolveReconciliation`、`ResolveExternalFileIdentity` |

Queries：`LibraryRootStatus`、`LibrarySearch`、`LibraryFileDetail`、`FileOperationStatus`、`LibraryConflicts`、`LibraryImpactProjection`。文件预览/系统打开使用 `accessResource`，不是普通 Query。

`ResolveExternalFileIdentity` 对同路径歧义只接受 `same-file | replacement-file`：前者在重新验证后保留旧 FileId/历史/CustomTag，后者 retire 旧 record、创建新 FileId 且不继承 CustomTag；确认前旧 record 保持 unverified，不能通过 `accessResource` 冒充已验证资源。

### 6.5 GRADE

| Intent family | 变体 |
|---|---|
| Scheme | `CreateGradingScheme`、`UpdateGradingScheme`、`AddGradingItem`、`UpdateGradingItem`、`RemoveGradingItem` |
| Result | `RecordScore`、`ClearScoreToUngraded`、`SetFinalResult(source=manual-final|school-record)`、`UseCalculatedResult` |
| Scale | `CreateGradeScale`、`CopyGradeScaleVersion`、`UpdateGradeScaleAsNewVersion`、`SetTermDefaultScale`、`BindCourseScaleVersion` |
| References | `LinkGradingItemToTask(GradeTaskRef)`、`UnlinkGradingItemFromTask` |

Queries：`CourseGradeProjection`、`CurrentTermGradeOverview`、`GradeScaleList/Detail`、`GradeImpactProjection`。

成绩页面若编辑 Course credits，Shell 仍提交 PLAN 的 `UpdateCourse`；Workspace 在新 revision 上重新查询 GRADE。不得为了页面方便在 GRADE 中复制第二份 credits。

### 6.6 PROTECT

PROTECT-owned Intents：`ConfigureBackupDestination`、`ClearBackupDestination`、`StartBackupNow`、`RetryBackup`、`SelectRestoreCandidate`、`ConfirmRestore`、`ResumeRestore`、`RollbackRestore`、`CancelRestoreBeforeActivation`、`ConfirmMigrationRollback`、`ContinueMigrationRollback`、`CancelMigrationRollback`。

同一数据保护表面还暴露 DATA-owned `DeleteMigrationSafetyCopy`；它使用通用 ImpactPreview/confirmationToken，但不把副本所有权转移给 PROTECT。

Previews：`PreviewMigrationRollback`。

Queries：`DataProtectionStatus`、`SnapshotList/Detail`、`RestorePreview`、`RestoreOperationStatus`、`MigrationSafetyCopyStatus`、`MigrationRollbackStatus`。

### 6.7 不直接暴露给 Shell 的接口

DATA 与 PLATFORM 不具有页面级 Intent/Query。它们只通过各模块所需的窄端口被调用。任何让 Shell 直接选择事务、路径写法、Watcher 或系统异常处理的接口都违反 `G2`。

## 7. 跨模块状态机与恢复协议

### 7.1 `IF-FILE-OPERATION`

```text
planned -> disk-applied -> index-committed -> succeeded
    |            |                |
    +------------+----------------+-> recovery-required
```

| 状态 | 已知真相 | 允许动作 |
|---|---|---|
| `planned` | 用户意图和预期源/目标已持久化；磁盘尚未声明改变 | execute、cancel |
| `disk-applied` | 平台报告磁盘动作已发生；索引尚未确认 | verify、commit-index、reconcile；不得向用户报完整成功 |
| `index-committed` | FileId/path/tags/verification 与新 revision 已提交；backup follow-up 已记录 | publish PostCommitChange、完成 |
| `recovery-required` | 物理与索引状态无法自动判定一致 | rescan、resume、compensate、user decision |
| `succeeded` | 对应磁盘与索引状态已验证 | 无；后续新变化创建新 operation |

规则：

- 每个阶段变更必须幂等并可从持久状态恢复；
- 磁盘动作开始前必须持久化 operation kind/version、RootGeneration、expected stamps、源/目标、resolution 和精确 operation-owned 临时/恢复位置；
- 同一根的应用管理磁盘 mutation 串行；外部变化仍可发生，因此每个动作前后都重新验证；
- disk-applied 之后取消只有在存在安全补偿时可用；
- 外部文件管理器变化不伪造 planned operation，而由 Scan/ReconciliationOperation 发现并产生明确索引 ChangeSet；
- 删除使用系统废纸篓/回收站且不永久删除 fallback；replace 先保留 operation-owned recovery 文件，再发布操作源，身份跟随源；
- 启动恢复不得盲目重放 delete/replace；只根据持久计划与磁盘实况继续、补偿或等待决定；
- 具体平台适配、PathKey/marker encoding、transfer digest、扫描协调与发布步骤以 [ADR-05](./adr/ADR-05-library-watching-index-file-operations.md) 为准。

### 7.2 `IF-BACKUP-CHECKPOINT`

`BackupCheckpoint` 至少包含：

```text
BackupCheckpoint {
  checkpointId
  operationId
  backupSetId
  backupSequence
  targetRevision
  activityRevision
  activityFormatVersion
  structuredDataSource
  libraryManifest { markerFormat, WorkspaceId, LibraryRootId, RootGeneration, pathKeyEncoding, activeOrUnassignedRecords, verificationStamps, contentSources }
  createdAt
}
```

备份 operation 的规范阶段为：

```text
queued -> database-checkpoint -> library-copy -> staging-validation
       -> publishing -> published-pending-record -> succeeded
```

任一阶段可以进入 `failed`；已产生需要启动收敛的物理结果时进入 `recovery-required`。`published-pending-record` 表示 final 目录已在本机命名空间发布、但成功记录/水位尚未提交，不等于面向用户的成功。

协议：

1. PROTECT 持久化没有 source/final 效果的 queued OperationId、BackupSetId、不可复用的 backupSequence、候选 SnapshotId 与合并后的目标 revision T，但不清除水位；database/library/validation 阶段在对应输出验证成立后才推进，publishing 是 rename 前的持久意图；
2. DATA 通过 Online Backup 建立一致 structured export，并从副本重新读出实际 revision R、WorkspaceId、格式/schema 与完整性；R 不得早于 T；
3. LIBRARY 只在 marker/root generation 稳定、完整扫描成功且没有未决 disk-applied/reconciliation/root cutover/recovery-file 时，提供与 R 对应的全部 active/unassigned 索引元数据和逐文件已验证状态；
4. PROTECT 对每个必需普通文件和 marker 执行 source-before 验证、流式复制/摘要、目标同步/关闭和 source-after 重验。任一未验证、缺失、变化或失败都停止整份快照；
5. PROTECT 在同一 BackupSet 的 operation-owned 临时目录中最后写 canonical manifest，并以不信任输入的同一 validator 枚举全部成员、拒绝额外/重复/链接/特殊项、检查版本/上限/摘要/数据库/Library 闭包；
6. staging 全量验证后才发布到此前不存在的 final SnapshotId 目录；发布后重新打开 final 并执行同一全量验证；
7. final 验证通过后，DATA transaction 才登记 SnapshotId、最后成功和 `backupSucceededThrough=R`。若在本地发布后、登记前中断，重启按持久 operation 与候选身份全量验证后幂等补记或保持失败/恢复，不重复计数；
8. 新 snapshot 与水位提交后才按同 BackupSet 最近两份已验证快照执行 retention；cleanup pending 不回滚成功；
9. `backupNeededThrough` 大于 R 时仍显示 pending 并安排下一次。

备份目的地未配置时，watermark 可以记录“本地有未保护 revision”，但用户状态是合法“仅保存在本机”，不是无限重试错误。备份查询不得把外部云盘上传状态推断为成功；候选列表必须按 `verified | incomplete-or-sync-pending | corrupt | incompatible | unknown-entry` 区分，且不得以目录时间替代 backupSequence 或验证结果。

### 7.3 `IF-RESTORE-SESSION`

```text
inspectBeforeWorkspaceOpen() -> RestoreBootState
execute(RestoreCommand)      -> OperationHandle
query(RestoreSessionId)      -> RestoreSessionView
```

`RestoreCommand` 是封闭 union：`start(candidateRef)`、`choose-library-target(targetRef)`、`confirm(previewToken)`、`cancel-before-checkpoint`、`resume`、`rollback`。`start` 携带 CommandId 并幂等创建 RestoreSessionId/OperationId；其余命令显式携带 RestoreSessionId、CommandId 和 expected SessionVersion。OperationHandle 返回相应稳定 ID 与可查询状态；同一 CommandId + canonical payload 的重试返回同一逻辑结果，不同 payload 复用必须拒绝。候选与目录使用不透明引用；接口不得泄露 SQLite/WAL、真实路径、进程/平台 handle 或物理交换阶段。`query` 无副作用；长工作始终通过 OperationHandle 观察。

```text
selected -> validated -> previewed -> confirmed
    -> protection-established -> staged -> stage-validated
    -> activation-checkpoint -> activated -> reopened/reconciled -> succeeded
```

终态/异常：

- validated 前发现损坏、不兼容或不可读：failed，活动数据 unchanged；
- preview 绑定的候选、健康 current revision/RootGeneration、restricted raw-evidence fingerprint、资料库目标或影响发生变化：waiting-decision/impact-changed，重新 preview；
- activation-checkpoint 前失败：failed/cancelled，活动数据 unchanged；
- activation-checkpoint 后中断：recovery-required，普通 Workspace 写入关闭；
- activated 后重开/对账失败：recovery-required；可继续完成或回滚到旧副本/RestoreSafetySet；
- 回滚经重新打开、对账和 FLOW-00 后进入 rolled-back；候选与旧状态无法唯一分类时保持 recovery-required；
- 只有 reopened/reconciled、RestoreSession success receipt 与外部协调终态一致后才返回 succeeded；成功后的临时清理失败是 cleanup-pending，不改变 succeeded。

RestoreSession 必须持久保存候选身份、版本、验证结果、预览选择、资料库目标、保护方式（`required | not-required | restricted-waived`）、RestoreSafetySet、当前阶段、下一步能力和终态回执。欢迎页恢复与设置页恢复使用同一接口和状态机；模块从当前活动真相推导是否存在旧副本和是否需要安全集，不接受 `welcome | replace` 模式提示。具体同卷暂存、激活协调、交换顺序、启动判定和版本规则由 [ADR-08](./adr/ADR-08-restore-activation-recovery.md) 唯一决定。

### 7.4 跨模块主事实与后续动作

某些意图的主事实与物理后续动作无法共享一个物理事务，例如 Course 重命名与目录重命名。逻辑契约为：

1. ImpactPreview 明确主事实和后续动作；
2. FLOW-01 提交主事实时同时记录 DurableFollowUp；
3. CommandOutcome 返回 committed + pendingFollowUps；
4. Follow-up 所有者按稳定 CourseId 执行并更新状态；
5. 完成前 Library 继续使用最后已验证映射，并明确 pending；
6. Follow-up 失败不会反向伪造主事实未提交；是否补偿主事实必须是新的显式决策/命令。

若产品要求某操作对用户表现为全有或全无，Workspace 应返回 accepted OperationHandle，直到所有关键阶段完成，而不是提前 committed-as-complete。

### 7.5 `IF-REVISION-INVALIDATION`

模块 ChangeSet 可以携带投影失效 key，例如受影响 Term/Course/Series/日期窗口。它们用于优化重算，不是正确性的前提。缺失或丢失失效通知时，下一 query 仍必须从 revision 事实产生正确结果。

### 7.6 `IF-MIGRATION-ROLLBACK`

```text
inspectBeforeWorkspaceOpen(AppBuildId) -> MigrationRollbackBootState
preview(MigrationSafetyCopyId)         -> MigrationRollbackPreview
execute(MigrationRollbackCommand)      -> OperationHandle
query(MigrationRollbackSessionId)      -> MigrationRollbackStatus
```

`MigrationRollbackCommand` 是封闭 union：`confirm(previewToken)`、`continue-as-target`、`cancel-as-source`。每条命令携带 MigrationRollbackSessionId（confirm 创建时除外）、CommandId、expected SessionVersion 和当前 AppBuildId；同一 CommandId + canonical payload 幂等返回原结果，不同 payload 复用拒绝。`DeleteMigrationSafetyCopy` 是独立 DATA-owned 高影响 intent，不能在 nonterminal rollback/restore 中执行。

```text
planned -> prepared -> armed -> awaiting-target-build
                                  |                 |
                                  v                 v
                              completing        cancelling
                                  |                 |
                              succeeded          cancelled

任一无法唯一分类阶段 -> recovery-required
```

- `planned/prepared` 取消不改变 current migrated data；
- `armed` 是 rollback checkpoint：safety slot 已验证为可激活，current migrated slot 已受保护为 operation-owned sibling，handoff 已持久并重开验证；
- `awaiting-target-build` 只允许 exact target `continue-as-target` 或 exact source `cancel-as-source`；其他 AppBuildId 的 allowed actions 为空；
- target succeeded 与 source cancelled 都必须经过 DATA reopen、LIBRARY full reconciliation 和 FLOW-00；
- 启动检查只能自动补记不会改变 DATA/Library 的唯一 observed/terminal 事实，物理 continue/cancel 等待命令；
- 状态 DTO 不暴露 DataSlot、真实路径、平台安装 API、journal sequence 或原始错误。具体磁盘/handoff 协议由 [ADR-10](./adr/ADR-10-packaging-signing-update.md) 决定。

## 8. 八条 FLOW 的规范步骤

### 8.1 `FLOW-00` — Workspace 激活与生命周期

**Trigger**：应用启动、恢复后重开、用户切换活动 Workspace，或 TermZone 日期边界。

1. PROTECT 在打开 DATA、解释活动 LibraryRoot 或启动 watcher 前调用统一 `inspectBeforeWorkspaceOpen(AppBuildId)`，验证 Restore/MigrationRollback 协调版本、证据和未终结会话；不自动扫描云盘或网络选择副本/版本。
2. 若 Restore 激活或 MigrationRollback handoff 未收敛，Workspace 按 exact build 与 allowed actions 进入 maintenance/recovery，停止普通路由。启动只可补记由现有磁盘证据唯一证明且不会改变 DATA/Library 的观察或完成记录；物理继续/回滚/取消等待用户明确命令。
3. 启动判定为 clear 后，PLATFORM 解析并验证 ActivityControlRoot/DataSlotsParent 等应用位置能力，再解析活动资料库能力；正式控制/数据根必须 verified-local 且同卷。
4. Main/Workspace utility 完成 exact AppBuildId/protocol handshake；DATA 检查可读/可写、格式版本、完整性和与协调状态一致的 activation/receipt 事实。future/unknown/mixed build 或不一致进入 recovery。
5. 加载 WorkspaceLifecycle、SetupProgress、DraftCheckpoint、Operation 和 DurableFollowUp。
6. 恢复或标记每个非终态 Operation；唤醒 pending follow-up/backup watermark。
7. PLAN 使用 TermZone/evaluatedAt 检查 Current Term；需要自动归档时发起 `ReconcileWorkspaceLifecycle`，经 FLOW-01 正式提交。
8. 计算 setup 当前最低条件、`everReachedMinimum` 与默认路由：无活动数据 → welcome；从未达标 → setup（仍可显式进入 Today）；曾达标 → Today。曾达标但当前无 Current Term 时，Today 返回“学期已结束/需要新学期”的真实状态及历史/创建入口，不退回首次设置；若原因是日期越界自动归档，最近结束学期的日期进度显示 100%。恢复未决始终 → recovery。
9. ATTEND/LIBRARY/GRADE/PROTECT 分别报告 capability/health；Library 扫描、watcher 和 backup 只在普通路由完成后异步启动。

**Completion criterion**：Workspace mode、route、revision、capabilities、operations 和 pending follow-ups 全部可查询；核心可用不等待 Library scan/backup。

**Failure semantics**：次级模块失败 → limited；DATA 只读 → read-only；完整性/激活不确定 → recovery。

### 8.2 `FLOW-01` — 结构化命令与本地提交

**Trigger**：用户或系统提交正式 WorkspaceIntent。

1. Shell 保留当前 draft，并在需要时调用 preview。
2. Workspace 验证 confirmationToken、CommandId、expected entity versions 和 capability。
3. 语义主模块验证 Intent、产生 ChangeSet/warnings/ReferenceImpact；其他模块只贡献影响或 follow-up。
4. 任何 validation/conflict/decision-required 在此返回，正式数据 unchanged，draft 保留；时间重叠的 decision-required 携带双方稳定对象与 Instant 窗口，只有同版本的明确 continue 才可按原时间重新提交。
5. Workspace 将领域 ChangeSet、CommandReceipt、DurableFollowUp/backup watermark 交给 DATA。
6. DATA 原子逻辑提交并推进 revision R+1；失败则不推进、不唤醒备份。
7. 提交后发出 PostCommitChange；通知失败不影响已记录 follow-up。
8. 返回 committed（含 effects、UndoCapability?、pendingFollowUps）或长操作 accepted。
9. Shell 重新 query 新 ProjectionEnvelope 后更新正式界面；draft 按关联消费。

**Completion criterion**：outcome 的 dataEffect、revision、follow-up 和 UI 展示一致；同 CommandId 重试不产生第二次变化。

**Failure semantics**：提交前 validation/conflict/decision-required 均 unchanged 且保留 draft；DATA commit 失败不推进 revision；主提交后 follow-up 失败保留 committed 主事实并将相关能力标 pending/degraded，不伪造回滚。

### 8.3 `FLOW-02` — 统一计划投影

**Trigger**：Today、Week、Calendar、Agenda、TBA、课程/任务摘要查询。

1. Workspace 从 Clock/Term 形成 `evaluatedAt + termZone + applicableDate + requestedWindow`。
2. DATA 提供 ReadSnapshot R。
3. PLAN 在 R 上选择 Term/Course/Series segments，展开窗口内 occurrences，应用 HolidayRange、OccurrenceOverride 和 Task state。
4. PLAN 产生统一时间/状态分类、next small/large、Today counts、warnings；所有页面查询复用同一规则实现。
5. ATTEND available 时读取同一 R 的窗口/记录，产生 Today overlay；disabled/unavailable 时返回 capability 或 problem。
6. Workspace 组合 Envelope R；不受影响部分可以继续，任何 unavailable/stale 明确标注。
7. Shell 只排序/布局，不重算领域分类。

**Completion criterion**：Today/Week/Calendar/Agenda 对同一窗口中的实例身份、假期、状态和时间分类一致。

**Failure semantics**：ATTEND 失败退回基础时间语义；PLAN 失败返回核心 projection problem，不伪空。

### 8.4 `FLOW-03` — 资料库对账与受验证资源访问

**Trigger**：资料库根创建/更换、应用内文件操作、Watcher/启动扫描线索，或 FileId 的 preview/system-open/reveal 请求。

**Root setup/change branch**

1. preview 目标本地性、三位置重叠、权限、marker 和已知映射影响；
2. CreateDefault 仅在 Documents=`verified-local`，或 Documents=`unknown` 且已展示限制并记录用户确认时创建；`known-cloud-or-remote` 拒绝。ChangeRoot 只接受新建/空目录；Reauthorize 只接受匹配 marker 的非空原资料库；RepairMarker 只允许数据库当前路径并先展示只读完整扫描差异；
3. PLATFORM 验证目录能力，LIBRARY 持久化带旧/新 RootGeneration、manifest 与精确 staging/cleanup 的 Operation；
4. ChangeRoot 在旧根无其他未决 mutation 且刚完成扫描后复制并以 source-before/source-after stamp + ADR 选定的版本化 transfer digest 验证全部普通文件和 marker；最终 cutover 期间再次对账 dirty 变化；
5. LIBRARY 只有在新根完整验证后才提交唯一 current RootGeneration、映射和 stamps，再安装新 watcher；
6. 已提交后先重验旧根 marker、最终 manifest/stamps 和 cutover 后变化；只有精确一致才送入系统回收站。新增/变化、验证或回收失败都留下明确非活动副本 follow-up。提交前失败保留旧根，未知物理结果进入 recovery，任何时刻不宣称两个活动 root。

**App-managed mutation branch**

1. preview 同名/删除/移动影响并收集 ResolutionChoice，绑定 RootGeneration 与 expected stamps；
2. 持久化带版本、源/目标和临时/恢复位置的 FileOperation planned；
3. PLATFORM 执行非覆盖 Copy/Rename、系统 Trash 或 staged Replace；Copy/Replace 验证源未变化和目标字节；
4. 标记 disk-applied，重新验证 containment、对象证据和最终位置；
5. 提交 LibraryRecord/PathKey/placement/tags/verification 与 backup/cleanup follow-up；replace 保留源 FileId 并 retire 原目标；
6. 达到 index-committed 后返回成功。平台结果丢失或磁盘组合矛盾只进入 reconciliation。

**External discovery branch**

1. 启动、用户命令、watcher hint/error 或五分钟兜底期限产生 scan-required；watcher 事件本身不解释为文件动作；
2. 串行 ScanOperation 在一个 RootGeneration 内验证 marker，并枚举受管理 root；不跟随 `link-unsupported`，拒绝解析后越界和 `special-unsupported`，`unclassified` 范围标 unverified；扫描期间新 hint 只设置 dirty 并在完成后安排下一轮；
3. exact-path/object continuity、唯一同卷对象移动、外部替换、新文件、missing 和 unassigned 按契约产生 ChangeSet；外部移动证据不足，或同路径 stamp 变化但对象证据缺失/不可靠时进入 waiting-decision，确认前不转移身份或标签；
4. 枚举错误只把受影响范围标 unverified，不把未观察到的记录批量判 missing，也不推进最后完整扫描时间；
5. 完整结果在 RootGeneration 仍匹配时 index commit，发布新 revision/最后完整扫描时间。

**Resource access branch**

1. Shell 提交 FileId + verification stamp + 单一 mode；Workspace 校验调用方、版本、epoch 和请求边界；
2. LIBRARY 为该 mode 重新验证 current RootGeneration、root containment、普通文件、路径、对象、存在性、权限和 stamp；preview 还执行版本化类型/限制政策，system-open 还执行版本化启动风险政策；
3. preview 返回 `PreviewReady` 与有界、可取消 session，或带当前 allowedActions 的 `PreviewUnavailable`。大字节只经资源数据面读取；每次 range 仍验证 session、purpose、边界和当前对象；
4. system-open/reveal 不复用 preview session。非高风险普通文件的 system-open 通过窄 PLATFORM adapter 提交一次性平台请求；高风险可启动文件拒绝 system-open 且只保留 reveal。结果只可为 requested 或稳定 problem，不能宣称第三方应用成功；
5. 文件/根/权限/stamp/epoch/protocol 变化、页面离开、超时或进程退出会撤销 session。旧画面只保留“已失效”说明，用户显式 reload 后从第 1 步重新开始。

**Completion criterion**：每个展示为可用的文件都有当前 RootGeneration 的 verified stamp；每个中断操作都有可查询的真实阶段和恢复动作；根可访问且应用持续运行时完整核对最迟每五分钟启动。资源请求只返回当前验证对应的受控 preview、requested 平台动作或可解释 problem，不产生正式数据效果。

**Failure semantics**：planned 失败保持磁盘/索引 unchanged；disk-applied 后失败进入 reconciliation-required 并说明物理变化；任何预览、数据通道、system-open 或 reveal 失败均保持 dataEffect unchanged，只影响当前资源表面。普通运行中的权限/根不可用使 LIBRARY degraded，而 PLAN、ATTEND、GRADE 与结构化本地数据继续；作为未收敛 Restore participant 执行重开/对账时失败则保持全局 recovery，不开放混合工作区。

### 8.5 `FLOW-04` — 异步备份

**Trigger**：结构化 commit 或 Library index-committed 推进 `backupNeededThrough`，或用户手工启动。

1. PROTECT 合并待备份 revision T，在当前 BackupSet 中持久化 operation、backupSequence 与候选身份，但不清除水位。
2. DATA 生成 Online Backup 并验证副本，取得实际 revision R；LIBRARY 为 R 建立完整、稳定且无物理未决操作的 verified closure。
3. PROTECT 向同 BackupSet 的临时目标复制结构化数据、root marker 和全部必需普通文件；逐成员摘要、同步/关闭并重验来源，最后写 canonical manifest。
4. 使用同一 hostile-input validator 全量验证 staging 的格式、版本、上限、成员集合、摘要、数据库与 Library 闭包；任何一项失败都不发布部分快照。
5. staging 通过后在同一父目录发布到唯一 final SnapshotId；重新打开 final 并再次全量验证。
6. final 验证通过后才记录 SnapshotId、最后成功时间与 `backupSucceededThrough=R`。发布后、记录前崩溃由持久 operation 幂等收敛。
7. 成功记录后保留该 BackupSet 中 backupSequence 最大的两份已验证快照；旧快照清理失败只进入 cleanup pending，不回滚新快照或水位。
8. 若期间有新 revision，继续保持其 pending 水位并安排下一次。

**Completion criterion**：final snapshot 可独立验证其实际 revision、canonical manifest、全部成员与 Library 闭包，成功记录已提交，水位准确说明已保护/未保护范围。“成功”只覆盖所选目录的本地发布与验证，不声明云盘上传完成。

**Failure semantics**：当前本地数据、既有已验证快照和 pending 水位不变；显示具体阶段、最后成功与 retry/free-space/change-destination。空间不足不删除最后两份好快照；其他 BackupSet、未知、无法验证或身份冲突条目不自动清理。

### 8.6 `FLOW-05` — 显式整库恢复

**Trigger**：welcome 或设置页选择用户指定快照。

1. 以不透明 candidateRef 创建 RestoreSession 和 OperationHandle；欢迎页与设置页走同一状态机。
2. 重新验证候选可读、格式/版本/完整性，并在不修改备份原件的独立副本上完成必要 schema migration；失败即停止。此 candidate-validation 副本不等于确认后的 activation staging。
3. PROTECT 根据当前活动真相决定资料库目标：candidate Library present 时，健康且可安全切换的当前根保持同一用户可见位置，否则要求用户选择符合政策的新建/空本地根；candidate 明确 Library absent 时记录 absent，不虚构根，旧根若存在则保持原位但不再活动。
4. 按受影响位置预检当前数据、安全集、候选暂存和回滚副本的峰值容量；不足时返回 storage-full，活动事实不变。
5. 健康 current 在当前 revision/RootGeneration 上预览 Term/Course/Task/File/设置影响；restricted current 以明确 unavailable 范围和 raw-evidence fingerprint 代替无法读取的事实，不填模拟差异。把候选、current variant、资料库目标和影响摘要绑定到 confirmation token；用户明确选择完整替换，不提供自动合并。
6. confirm 后 Workspace 立即进入 maintenance，停止普通 DATA/LIBRARY mutation、backup、validator/new preview，drain 已开始工作并使旧 lease/epoch 失效；checkpoint 前仍可取消。
7. 当前 DATA 与已配置 Library 健康时创建并完整验证 RestoreSafetySet。DATA 损坏/只读或已配置 Library 无法完整读取时仅按 §5.7 的 restricted-waived 前提和额外确认继续；否则停止。
8. DATA/LIBRARY 在已确认的最终目标约束下建立 activation staging 并完整验证。健康 current revision/RootGeneration、restricted raw-evidence fingerprint、目标、候选或外部事实变化返回 impact-changed，不合并。
9. checkpoint 前 drain DATA statement/iterator/backup/validator，停止 watcher，验证 SQLite WAL/sidecar 状态、checkpoint/关闭结果和最终 DATA/Library fingerprints；任一不满足都不进入 checkpoint。
10. 持久化并重验 activation checkpoint 后，按 [ADR-08](./adr/ADR-08-restore-activation-recovery.md) 激活完整 Library 与 DATA；任何中断保持 recovery，禁止打开混合的新旧 pair。
11. 候选 DATA 重开并验证格式、完整性、WorkspaceId、Revision 与 RestoreSession；LIBRARY 取得新设备 RootGeneration 并执行 marker/身份/全部文件闭包的完整扫描与对账。
12. 失效恢复副本中的设备路径、备份目的地能力、对象证据、permission/lease 和不安全的外部 operation 前提；执行 FLOW-00，恢复 Current Term、SetupProgress、health 与 route。
13. DATA 持久化幂等 RestoreSession success receipt；PROTECT 再使外部协调状态达到 committed。两者和磁盘证据一致后才返回 succeeded。
14. RestoreSafetySet 按 §5.7 保留；成功后的临时清理单独进行，失败只返回 cleanup-pending。

**Completion criterion**：只有一个已证明的活动正式数据集；RestoreSession success receipt、恢复协调终态、DATA 身份/修订、Library marker/RootGeneration/文件与标签闭包、失效的设备能力以及 Workspace 路由全部一致。此边界是跨资源可恢复的逻辑全有或全无，不是单一文件系统事务。

**Failure semantics**：候选验证、预览、安全集或 staging 在 checkpoint 前失败/取消时保持原活动数据；checkpoint 后中断进入 recovery，只开放当前证据支持的 resume/rollback。rollback 也必须重开、对账与 FLOW-00 后才完成；证据冲突、协调状态损坏、未知版本或结果无法唯一分类时只展示当前可证明状态，不提供不安全动作、不猜测、不降级为跨卷复制删除。succeeded 后返回旧数据必须创建新的完整 RestoreSession。

### 8.7 `FLOW-06` — 模块自有的确定性结果投影

**Trigger**：课程出席统计、单科成绩、成绩总览或 SGPA 查询。

1. Workspace 建立 ReadSnapshot R 与 EvaluationContext。
2. ATTEND 从 PLAN occurrence refs + 自有窗口/记录产生计数、率、coverage/unknown reason。
3. GRADE 从自有 scheme/results/scale version/source 与同一 ReadSnapshot 中 PLAN 拥有的 Course credits 产生 CourseGradeProjection 和 CurrentTermGradeOverview。
4. 每个模块返回 input revision、规则/模板版本、来源、coverage、warnings 和 unavailable/unknown reason。
5. Workspace 只组合 Envelope；不建立泛化规则引擎；Shell 不重算。

**Completion criterion**：详情与总览使用同一版本化结果；缺失输入停止或限定计算并解释范围。

**Failure semantics**：模块 projection unavailable/stale 不改变原始事实，也不阻塞 PLAN；旧估算不能无标记显示为当前。

### 8.8 `FLOW-07` — 应用更新、数据迁移与精确版本回退

**Trigger**：用户在应用外安装/替换 CourseFlow 后启动；或用户对最近一份 MigrationSafetyCopy 发起删除/回退。

**普通启动与前向迁移**：

1. 安装器只替换程序制品；应用按 FLOW-00 前四步验证 AppBuildId、稳定本地根和未终结 handoff。
2. DATA 读取 application ID、current schema level、format/integrity 和 release descriptor 支持范围。future/unknown、只读但需要 migration 或不兼容 build 停止，不 reset/猜读。
3. current schema 无需 migration 时直接重开，不创建 MigrationSafetyCopy。
4. supported old schema 需要 migration 时，DATA 在任何 schema write 前创建原先不存在、已 checkpoint/关闭/sync 的 safety copy，重开验证 WorkspaceId/source Revision/schema/size/digest，并绑定 exact rollback target。
5. 新 copy 完整登记后才替换旧 copy；逐级执行 ADR-04 forward migration。每级失败/中断保持最后已提交 user_version 与 safety copy，重启按证据继续或 recovery。
6. current DATA 迁移完成后关闭/重开，验证 application/schema/WorkspaceId/Revision/integrity；LIBRARY 对现存真实根执行必要全量扫描/FileId 对账，再完成 FLOW-00。

**显式删除**：

7. `DeleteMigrationSafetyCopy` 先重新验证 copy identity 和无 nonterminal Restore/MigrationRollback，preview/确认失效时拒绝；删除失败保持 copy，成功后不再提供该迁移的 app rollback。

**显式回退**：

8. PROTECT 重新验证 safety/current DATA 与 Library 状态，生成绑定 copy/current/source/target build 和影响摘要的 preview；用户确认结构化数据损失、不合并和真实 Library 文件保持原位。
9. confirm 后进入 maintenance 并使旧 epoch/lease 失效；DATA 验证本地同卷、容量和两份完整 slots，PROTECT 按 `IF-MIGRATION-ROLLBACK` 持久 handoff，在 checkpoint 后使 safety 成为待 target 验证的 active、current migrated 成为 rollback sibling，然后应用退出。
10. 用户在应用外替换程序：Windows 卸载当前 MSI 后安装 exact target MSI；macOS 替换 `/Applications` 中 app。安装器不读写数据。
11. exact target build 启动后只在用户明确 `continue-as-target` 时验证/打开 safety DATA，LIBRARY 对现存文件全量对账并完成 FLOW-00；随后记录 succeeded 并安全清理 operation-owned migrated sibling/handoff。
12. exact source build 可以由用户 `cancel-as-source`，重新激活并验证 retained migrated DATA、对账 Library、完成 FLOW-00 后记录 cancelled。其他 build 停止普通打开并只返回所需版本。

**Completion criterion**：无迁移更新继续使用同一活动数据；migration 只在 current DATA 重开/对账/路由完成后成功；rollback/cancel 只在 exact build、DATA 身份/schema/revision、Library generation/扫描和 FLOW-00 全部一致后终结。任何时点只有一个可打开的正式 DATA。

**Failure semantics**：copy/迁移 checkpoint 前失败保持原活动数据与既有 safety copy；逐级 migration 中断保留最后已提交 level；rollback checkpoint 前取消保持 current migrated data；checkpoint 后中断进入 maintenance/recovery，只允许 source/target build 和证据支持的动作。handoff/slot/digest/build 冲突、未知版本或结果不唯一时 allowed actions 可以为空；不自动 forward-migrate、reverse、merge、删除重建或报告部分成功。

## 9. 错误传播、降级与工作区模式

### 9.1 稳定 ProblemCode

| Code | 常见 scope | dataEffect | 典型 allowedActions |
|---|---|---|---|
| `validation` | field/operation | unchanged | correct |
| `conflict` | operation | unchanged | requery/decide/retry |
| `decision-required` | operation | unchanged | preview/decide |
| `feature-disabled` | module | unchanged | enable or continue without |
| `permission` | operation/module | unchanged 或 disk-applied（必须明确） | reauthorize/retry |
| `not-found` | operation/module | unchanged | rescan/correct |
| `resource-stale` | operation/module | unchanged | requery/rescan |
| `name-conflict` | operation | unchanged | keep-both/replace/cancel |
| `integrity` | module/workspace | 明确实际阶段 | retry/restore/recovery |
| `snapshot-incomplete` | operation/module | unchanged | wait-for-sync/revalidate/choose-other |
| `snapshot-corrupt` | operation/module | unchanged | choose-other |
| `snapshot-format-limit` | operation/module | unchanged | reduce-source/choose-supported-snapshot |
| `incompatible-version` | operation/workspace | unchanged | choose other/migrate/restore |
| `migration-safety-unavailable` | operation/module | activity data unchanged；migration 未开始 | free-space/retry/install-compatible-version；不得无副本继续 migration |
| `rollback-target-unavailable` | operation/module | unchanged | retain-copy/wait-for-exact-release |
| `rollback-build-mismatch` | workspace | rollback handoff unchanged | install-exact-target/install-exact-source；不能安全动作时为空 |
| `storage-full` | operation/module | unchanged | free-space/change-destination/retry |
| `cleanup-pending` | module | 主成功边界已越过；operation-owned 临时资源仍保留 | retry-cleanup |
| `calculation-unavailable` | module | unchanged | correct/retry |
| `operation-in-progress` | operation | 当前 handle dataEffect | observe/resume/cancel-if-safe |
| `reconciliation-required` | module | disk-applied 或未知物理差异 | rescan/decide/resume |
| `recovery-required` | module/workspace | activation/migration-rollback pending 或明确阶段 | 无未决 activation 时可 restore；nonterminal Restore/MigrationRollback 只允许 exact build 与证据支持的 resume/rollback/continue/cancel；没有安全动作时为空 |

模块可以新增稳定子 code，但必须映射到 scope、dataEffect、affectedCapabilities 和 allowedActions。原始异常文本只可在 owner 内存中用于一次映射，随后丢弃；不持久化、不跨普通 DTO，也不作为调用方分支。

### 9.2 Workspace mode 计算

1. 若 DATA/Restore/MigrationRollback 证据冲突、未知、不完整，活动数据不可读或无法判定兼容性 → `recovery`。
2. 否则若存在已验证的 confirmed Restore/MigrationRollback，正在准备、执行或等待 exact build → `maintenance`。
3. 否则若 DATA 可读但不可安全写 → `read-only`。
4. 否则若任一已交付/已启用外围模块 degraded/unavailable/recovering → `limited`。
5. 否则 → `ready`。

disabled-by-user 的 ATTEND 不使 Workspace limited。备份目的地未配置也不使 Workspace limited；配置后失败使 PROTECT degraded/Workspace limited，但本地保存仍 ready-capable。

### 9.3 读取降级规则

- 核心 PLAN query：成功 current、明确 stale 或失败；不得以空替代失败。
- 可选投影片段：available、unavailable(problem) 或 explicitly-stale(data, verified revision, problem)。
- 旧索引/结果只有在 UI 清楚标注未验证/过期时可以保留上下文；用户不得据此执行需要 verified/current 的动作。
- unknown 是合法数据状态，unavailable 是计算/访问失败；两者不得互换。

### 9.4 写入降级规则

- 对 unavailable capability 的命令返回 feature-disabled/unavailable，dataEffect unchanged；
- read-only Workspace 拒绝所有正式命令，但允许 query、草稿本地保留策略、恢复/导出能力；
- maintenance Workspace 只允许当前 Restore/MigrationRollback OperationHandle 声明的查询、检查点前取消、exact source cancel 或 exact target continue；普通写入、文件操作、备份和新预览关闭；
- recovery Workspace 只允许 OperationHandle 声明的恢复动作；无未决 activation 时可提供 restore，nonterminal Restore/MigrationRollback 只可提供 exact build 与证据支持的 resume/rollback/continue/cancel，不得嵌套开始另一会切换 DATA 的会话；没有安全动作时保持 recovery 并只展示当前状态；
- pending follow-up 不阻止无关核心命令，但影响相关 capability 的完成状态。

## 10. 测试义务

`TEST-*` 是逻辑证据 ID，不预先规定测试框架或文件名。一个测试可以满足多个义务，但报告必须能按 ID 定位结果。

### 10.1 SHELL 与 WORKSPACE

| ID | 必须证明 |
|---|---|
| `TEST-SHELL-001` | 每个空、unknown、unavailable、stale、problem 和 Operation state 有文字原因、dataEffect 与下一步 |
| `TEST-SHELL-002` | 所有核心旅程可键盘完成；焦点不被顶栏/抽屉/Toast 遮挡；状态消息可感知；文件预览的页码/缩放/适合页面、失效/扫描件/动画暂停/失败提示和适用文本结构可由键盘与辅助技术使用 |
| `TEST-SHELL-003` | not-committed/conflict/decision-required 保留输入；committed 后才更新正式状态；Undo Toast 语义正确 |
| `TEST-SHELL-004` | 首发剖面的 19 个正式页面/表面只使用 `IF-WORKSPACE` 五种能力及其 outcome，不绕过到领域/平台能力，也不包含独立领域公式；完整已批准产品设计仍有 24 个表面，MVP-C1 不进入首发构建。 |
| `TEST-SHELL-005` | MigrationSafetyCopy/rollback preview、结构化数据损失确认、planned/prepared/awaiting-target/wrong-build/completing/recovery 状态及 source cancel/target continue 具备准确文字、键盘、焦点与状态公告；不暴露路径/DataSlot/journal 或提供应用内下载 |
| `TEST-WORKSPACE-001` | 每个复合 Envelope 使用单一 revision/EvaluationContext，跨页面结果一致 |
| `TEST-WORKSPACE-002` | CommandId 幂等、entity conflict、preview token 过期、recoverability 声明和 UndoCapability 一次性 |
| `TEST-WORKSPACE-003` | healthy/degraded/unavailable/recovering 模块组合以及 Restore/MigrationRollback maintenance/recovery/cleanup-pending 产生正确 capability、health 与 Workspace mode；维护期间普通写入、文件操作、备份和旧 lease 均关闭 |
| `TEST-WORKSPACE-004` | welcome/setup/today/maintenance/recovery 路由、最低设置条件、提前进入、everReachedMinimum、自动归档后 Today 结束状态；Restore/MigrationRollback 启动检查先于 DATA open/Library watcher，未决激活不能进入普通路由 |
| `TEST-WORKSPACE-005` | Draft/Operation/follow-up/RestoreSession/MigrationRollbackSession 在所有持久中间态重启后恢复且不重复；启动自动动作只补记唯一可证明的无副作用记录，物理 resume/rollback/continue/cancel 等待用户命令 |
| `TEST-WORKSPACE-006` | 主事实 committed + pending follow-up 的显示与后续完成/失败不伪造整体结果 |
| `TEST-WORKSPACE-007` | Main/Renderer/Workspace utility exact AppBuildId/protocol；普通更新、source/target/other build 对 nonterminal rollback 的启动分类与 allowed actions；mixed/wrong/future build 不发送业务请求或自动 migration |

### 10.2 PLAN

| ID | 必须证明 |
|---|---|
| `TEST-PLAN-001` | Term/Course/Meeting/Task 范围与最多一个 Current Term 不变量 |
| `TEST-PLAN-002` | 正常周、LEC/TUT/PRA code+全称、Course instructor 引用、较短课程/规则范围、精确时间边界、TBA 地点仍占时间格、带双方对象/Instant 的重叠 warning，以及明确 continue 后不移动或删除课节 |
| `TEST-PLAN-003` | HolidayRange 抑制周期课节和 followTeachingWeek 任务，但保留一次性事项 |
| `TEST-PLAN-004` | only-this override 不影响其他实例；this-and-future 分段保留历史 |
| `TEST-PLAN-005` | OccurrenceId 在重算、视图、重启与不改变逻辑实例的编辑后稳定 |
| `TEST-PLAN-006` | date-only/timed/TBA、逾期/今天/未来/完成分类，weekly 确认范围及 next small/large 候选/排序规则 |
| `TEST-PLAN-007` | TermZone 跨日、DST、启用日、date-only 日末和自动归档边界 |
| `TEST-PLAN-008` | Today/Week/Calendar/Agenda/TBA 对同一 revision 的实例、Today 明细/计数、学期进度与假期连续片段一致 |

### 10.3 ATTEND

| ID | 必须证明 |
|---|---|
| `TEST-ATTEND-001` | 默认关闭；跨日启用从 TermZone 当天 00:00 生效且不回溯更早日期；关闭在 commit Instant 立即生效并保留关闭前资格/记录；同日重开从重开 Instant 生效；任何重开都不补关闭间隙 |
| `TEST-ATTEND-002` | attended/missed/unmarked 更正，取消/假期/未来实例资格 |
| `TEST-ATTEND-003` | 出席率、覆盖率、分母为零 unknown 和 Today overlay 公式 |
| `TEST-ATTEND-004` | ATTEND 保存/统计/整个模块失败时 PLAN 核心旅程继续 |

### 10.4 LIBRARY

| ID | 必须证明 |
|---|---|
| `TEST-LIBRARY-001` | Documents verified-local/known-cloud-or-remote/unknown 默认根、unknown 限制确认、三位置不重叠、ChangeRoot/恢复备用目标只接受新建或空根、健康恢复根保持用户可见路径、唯一/新设备 RootGeneration、旧根 cutover 后变化/验证/回收失败不误删、匹配 marker reauthorize、当前路径 marker 预览修复及错误 Workspace marker |
| `TEST-LIBRARY-002` | versioned planned/disk-applied/index-committed、operation-owned temp/recovery 每个 failpoint、响应丢失、kill/restart、未知旧 operation version 停止而不重置 |
| `TEST-LIBRARY-003` | 应用复制导入、外部放入/编辑/删除/唯一与模糊移动、同路径证据连续/明确替换/证据缺失歧义及用户选择、关闭期间变化、watcher 丢失/null/error 和五分钟完整核对 |
| `TEST-LIBRARY-004` | keep-both 预览名竞争、replace 身份跟随源且目标标签不继承、cancel、Trash 成功/失败/结果未知、rename/move 失败不伪成功 |
| `TEST-LIBRARY-005` | 五个建议分类、布局外文件 unassigned、非空分类持久批量 move-or-cancel、目录派生标签与 CustomTag 独立、Course 重命名 pending follow-up |
| `TEST-LIBRARY-006` | 大小写/Unicode/分隔、名称编码 round-trip 失败、hard link、平台可识别 symlink/junction 拒绝、解析后越界、特殊类型、无法分类范围 unverified、操作系统特殊元数据不作全识别承诺、权限丢失、watcher-degraded、reauthorize/reconcile；恢复维护停止 watcher、旧 hint/lease 不跨 RootGeneration、全量对账后才恢复能力 |
| `TEST-LIBRARY-007` | 任意类型保存；PDF/PNG/JPEG/WebP/纯文本的真/伪后缀、header/结构、严格 UTF-8 与 BOM UTF-16、加密 PDF、动画 WebP、截断/畸形/超限输入；PDF 脚本/XFA/表单/链接/附件不执行且预览不联网；unsupported/type-mismatch/password/limit/parse/timeout 的 allowedActions；高风险可启动文件只 reveal；stamp/root/permission/object/epoch 变化撤销 lease 且显式 reload；range/credit/并发/超时边界与 no-partial-content |

### 10.5 GRADE

| ID | 必须证明 |
|---|---|
| `TEST-GRADE-001` | earned/max 与 direct percent；ungraded、scored-zero、incomplete 分开 |
| `TEST-GRADE-002` | unknown weight、合计非 100%、不归一化、weighted points/coverage 公式 |
| `TEST-GRADE-003` | GradeScale 连续/单调/无重叠、官方 UTM fixture、84.5 不向上取整 |
| `TEST-GRADE-004` | 模板复制版本、课程绑定、默认模板变化不改历史绑定 |
| `TEST-GRADE-005` | current/calculated/manual/user-attested-school source、单科与总览共享结果、覆盖/警告，且不伪称学校连接 |
| `TEST-GRADE-006` | SGPA 学分加权、F=0、缺学分/成绩未覆盖、不输出总百分比/AGPA/CGPA |
| `TEST-GRADE-007` | GradeTaskRef 只显式关联同 Course 的稳定身份；Task 状态/标题/进度不改成绩，删除/分段不静默级联 |

### 10.6 PROTECT 与 DATA

| ID | 必须证明 |
|---|---|
| `TEST-PROTECT-001` | 未配置目录合法；配置目录验证与三位置隔离；repository/Workspace/BackupSet 身份隔离且两个 BackupSet 互不选择、计数或清理 |
| `TEST-PROTECT-002` | backup watermark 持久与请求合并；actual revision；canonical manifest golden vectors；全部格式上限 exact/one-over；逐成员摘要；每个临时写/验证/发布/final 验证/成功登记 failpoint 顺序与重启收敛 |
| `TEST-PROTECT-003` | 目的地不可写/空间满/备份或清理失败保留本地成功、最近两份已验证快照、最后成功与 pending；quarantine 重启恢复，未知/其他集合/身份冲突条目不自动删除 |
| `TEST-PROTECT-004` | 同步中或不完整、损坏、当前/旧/未来不兼容和未知候选状态严格区分；只有重新验证的 snapshot 在激活前继续；候选迁移验证不修改备份原件且不冒充 activation staging；候选/修订/root generation/目标/影响变化使确认失效 |
| `TEST-PROTECT-005` | Restore 从 select 到 success/rollback/cleanup 的每阶段 failpoint、响应丢失、CommandId 重放、重启启动判定、checkpoint 前取消/不改变、checkpoint 后显式继续/回滚或无安全动作、receipt 与协调终态任一先落盘、证据冲突/协调记录损坏/未知版本、无部分成功 |
| `TEST-PROTECT-006` | B 已交付时 root marker、全部 active/unassigned verified 文件与课程/分类/自定义标签映射形成精确闭包；missing/unverified/source-changed/未收敛 operation 均整份停止；健康/缺失/不可安全原位替换根、候选 absent、恢复后全量对账与新 RootGeneration 均保持 snapshot/restore 一致 |
| `TEST-PROTECT-007` | MigrationRollback preview/confirm/handoff 的封闭字段、格式上限、CommandId 重放、Restore 全局互斥、每个 write-ahead/物理阶段 failpoint、planned/prepared cancel、source build cancel、target build continue、other build stop、响应丢失、未知/损坏/冲突证据、成功/取消无部分结果 |
| `TEST-DATA-001` | commit 每阶段 failpoint：全成或全不成，revision/receipt/follow-up 一致 |
| `TEST-DATA-002` | 同 CommandId 重放返回同结果；不同 payload 复用被拒绝 |
| `TEST-DATA-003` | expected entity conflict、并发 ReadSnapshot 和不混 revision |
| `TEST-DATA-004` | PostCommitChange 丢失/重复时 DurableFollowUp 仍完成一次 |
| `TEST-DATA-005` | 可读不可写进入 read-only；不可读/损坏进入 recovery，不自动重置 |
| `TEST-DATA-006` | 格式版本、未知新版本、export/candidate-validation/activation-stage/activation/rollback 跨重启；未释放 statement/iterator、WAL checkpoint/关闭失败、旧 epoch、重开完整性/WorkspaceId/Revision、success receipt 与外部终态先后顺序 |
| `TEST-DATA-007` | current schema 不建 copy；每个公开旧 schema copy-before-write、closed-slot metadata/digest、逐级 migration failpoint、重启继续、旧 copy 直到新 copy 验证后才替换、最多一份/无自动清理/显式删除；rollback same-volume slot、source/target build 重开与 Library 对账前不成功 |

### 10.7 PLATFORM、跨 FLOW 与产品环境

| ID | 必须证明 |
|---|---|
| `TEST-PLATFORM-001` | macOS/Windows Clock/ZoneRules 通过同一日期/DST conformance |
| `TEST-PLATFORM-002` | 两平台文件权限、路径/Unicode、local/known-cloud-or-remote/unknown 分类、选择器取消、Watcher hint/error、系统 Trash completed/failed/unknown 语义一致；同父/同卷 rename、跨卷拒绝、目录被外部程序占用/修改、同步/关闭与冲突错误稳定映射，不降级 copy-delete |
| `TEST-PLATFORM-003` | 打包后的两平台支持类型 preview 数据面取消/释放且无网络读取；非高风险普通文件 system-open 只返回 requested/failed，reveal 为 best-effort；高风险 system-open 请求不会到达平台；无默认关联、权限、消失、平台失败、Unicode/空格路径与错误映射稳定 |
| `TEST-PLATFORM-004` | 禁网运行全部 MVP-A 核心旅程及完整恢复/启动 recovery，应用不要求账户/远程/AI |
| `TEST-PLATFORM-005` | production/dev identity 与数据根隔离；macOS Application Support、Windows LocalAppData 的 ActivityControl/DataSlots verified-local/same-volume；remote/unknown/reparse 越界停止且无 Documents/Roaming/install-dir/user-choice fallback；安装/升级/卸载不改变每用户数据 |
| `TEST-PRIVACY-001` | 开发构建及 macOS/Windows packaged build 不创建 CourseFlow 自有诊断/log/crash/telemetry artifact，不提供诊断/支持包入口，错误不触发网络请求；每个可达失败仍返回安全 StructuredProblem、准确 dataEffect 与 owner 允许的动作；正式 receipt/operation/manifest/activation/迁移回退 handoff 只含其协议白名单字段 |
| `TEST-RELEASE-001` | 两平台 release identity、full source commit、AppBuildId、ApplicationReleaseDescriptor、实际 bundled runtime、Workspace/schema/format 支持范围与最终 manifest 精确一致；dirty/mixed build 拒绝；具体格式和工具链按 ADR-10 |
| `TEST-RELEASE-002` | ADR-10 macOS lane 的嵌套签名、公证/staple、标准安装、断网平台信任首启及 packaged E2E 全部通过 |
| `TEST-RELEASE-003` | ADR-10 Windows lane 的 payload/MSI 信任、标准安装、升级、直接降级阻止、卸载、数据保留、精确回退版本重装及 packaged E2E 全部通过 |
| `TEST-RELEASE-004` | ADR-10 的 package content 与 production runtime hardening 基线通过篡改/外部覆盖/调试入口测试；无运行时更新/下载、生产诊断、崩溃收集或遥测能力 |
| `TEST-RELEASE-005` | 同一源提交的完整双平台制品与 manifest 集合齐备；rollback target 可取得；draft 上传后重新下载并完成字节、平台信任和安装复核；无单平台发布，公开 tag/asset 不覆盖 |
| `TEST-FLOW-00-LIFECYCLE` | 新建、未完成设置、重启、自动归档后不退回首次设置、历史与空白新学期路由；所有 Restore/MigrationRollback 协调状态与 AppBuildId 在 DATA/watcher 前判定，唯一证据可补记、歧义保持 recovery |
| `TEST-FLOW-01-COMMIT` | preview/confirm/commit/undo/conflict/follow-up 的完整数据效果 |
| `TEST-FLOW-02-UNIFIED-PLAN` | 多视图同源、Reading Week、TBA 和 ATTEND 降级 |
| `TEST-FLOW-03-LIBRARY-RECOVERY` | 根 marker/generation、扫描/五分钟兜底、外部变化、每种 disk-applied 中断、根迁移、对账；受验证 preview/system-open/reveal 的独立重验、session 撤销、utility/Renderer 退出、协议/epoch 更新和 unchanged 失败语义 |
| `TEST-FLOW-04-BACKUP-FAILURE` | 本地成功/备份失败、旧快照、水位、source change、partial cloud、两个 BackupSet、retention/cleanup、重试和每阶段重启 |
| `TEST-FLOW-05-RESTORE-RECOVERY` | 不完整/损坏/不兼容候选；健康/无/不可用资料库根；健康与损坏/只读当前数据；容量 exact/one-over；预览过期；维护隔离；安全集与 target-bound stage；每个 activation 中断；显式继续/回滚；success receipt/协调终态；首份恢复后快照前后保留与 cleanup-pending |
| `TEST-FLOW-06-DERIVED-RESULTS` | ATTEND/GRADE 来源、coverage、unknown、stale 与隔离 |
| `TEST-FLOW-07-UPDATE-ROLLBACK` | 外部手动更新、无 migration reopen、copy-before-migration、每级中断、safety copy 展示/删除、rollback preview/confirm、source cancel/target continue/other build stop、Library 文件保留/全量对账及两个平台真实安装旅程 |
| `TEST-USABILITY-001` | 首次用户约 20 分钟完成参考最低设置，可提前进入并继续 |

### 10.8 Q → Test evidence

| Q | 最小证据集合 |
|---|---|
| `Q-TRUTH-01` | DATA-001/002/007、LIBRARY-002/004/007、PROTECT-002–005/007、FLOW-03/07 |
| `Q-CONSIST-01` | WORKSPACE-001、PLAN-008、FLOW-02 |
| `Q-TIME-01` | PLAN-003/006/007、ATTEND-001–003、PLATFORM-001 |
| `Q-STATE-01` | SHELL-001/005、PLAN-006、ATTEND-002/003、GRADE-001/002、FLOW-07 |
| `Q-PROTECT-01` | LIBRARY-001、PROTECT-001–007、DATA-007、FLOW-05/07 |
| `Q-ISOLATE-01` | WORKSPACE-003、ATTEND-004、LIBRARY-006/007、PROTECT-003 |
| `Q-LOCAL-01` | PLATFORM-003–005、PRIVACY-001、RELEASE-004、FLOW-00/03/04/05/07 的无网络变体 |
| `Q-PROVENANCE-01` | GRADE-003–007、FLOW-06 |
| `Q-ACCESS-01` | SHELL-001–005、LIBRARY-007 的 PDF/文本/状态公告变体、两个平台核心 E2E |
| `Q-PORTABLE-01` | PLATFORM-001–005、RELEASE-002/003、所有已交付模块的 macOS/Windows E2E |
| `Q-RESPOND-01` | FLOW-00 不等待、窗口化 PLAN query、LIBRARY/PROTECT OperationHandle、LIBRARY-007 资源限制与 G7 |
| `Q-EVOLVE-01` | DATA-006/007、PROTECT-004/005/007、GRADE-004、LIBRARY-007/PLATFORM-003 的策略/协议更新 fixture |
| `Q-USABILITY-01` | USABILITY-001、WORKSPACE-004 |
| `Q-CONTINUITY-01` | WORKSPACE-005/007、LIBRARY-002、PROTECT-002/005/007、DATA-004/006/007、FLOW-07 |
| `Q-DIAG-01` | SHELL-001/003/005、WORKSPACE-003/006/007、LIBRARY-007、PLATFORM-003、PRIVACY-001、全部 failpoint 的 Problem/dataEffect 断言 |
| `Q-RELEASE-01` | RELEASE-001–005、PLATFORM-005、DATA-007、PROTECT-007、FLOW-07、G8 |

## 11. 完整追溯矩阵

### 11.1 已批准完整设计功能需求（75；首发 61）

为保持密集矩阵可读，§11 的 TEST 列允许省略共同前缀：例如 `PLAN-001/007` 精确展开为 `TEST-PLAN-001` 与 `TEST-PLAN-007`。roadmap、backlog、测试报告和 Agent 工作包必须使用 §10 定义的完整 `TEST-*` ID。

首发剖面追溯 MVP-A、MVP-A-P 与 MVP-B 的 61 条需求；`C-GRADE-001–014` 的 14 条需求保留在完整已批准设计中，作为 MVP-C1 的未来契约，不进入首发构建。

| Requirement | MOD owner / coordinator | IF | FLOW | 关键 Q | TEST obligation |
|---|---|---|---|---|---|
| `A-TERM-001–003` | PLAN / WORKSPACE | IF-PLAN-COMMAND/QUERY、IF-WORKSPACE | 00、01、02 | TRUTH、TIME、CONTINUITY | PLAN-001/007、WORKSPACE-004、FLOW-00 |
| `A-TERM-004–005` | PLAN | IF-PLAN-COMMAND/QUERY | 01、02 | CONSIST、TIME、STATE | PLAN-003/008、FLOW-02 |
| `A-COURSE-001` | PLAN / WORKSPACE | IF-PLAN-COMMAND、IF-IMPACT-PREVIEW | 01 | TRUTH、PROTECT | PLAN-001、WORKSPACE-002/006 |
| `A-COURSE-002–004` | PLAN | IF-PLAN-COMMAND/QUERY | 01、02 | TIME、STATE、ACCESS | PLAN-001/002/007 |
| `A-COURSE-005–007` | PLAN | IF-PLAN-COMMAND/IMPACT | 01、02 | CONSIST、TRUTH、TIME | PLAN-002/004/005 |
| `A-TASK-001–003` | PLAN | IF-PLAN-COMMAND/QUERY | 01、02 | STATE、TRUTH | PLAN-001/006 |
| `A-TASK-004–007` | PLAN | IF-PLAN-COMMAND/QUERY | 01、02 | CONSIST、TIME | PLAN-003–006 |
| `A-TASK-008–010` | PLAN | IF-PLAN-COMMAND/QUERY、IF-WORKSPACE | 01、02 | STATE、TRUTH、DIAG | PLAN-004/006/008、SHELL-003 |
| `A-VIEW-001–004` | PLAN / WORKSPACE / SHELL | IF-PLAN-QUERY、IF-WORKSPACE | 02 | CONSIST、TIME、STATE、ACCESS | PLAN-006/008、WORKSPACE-001、FLOW-02 |
| `A-VIEW-005–006` | PLAN / ATTEND / WORKSPACE | IF-PLAN-QUERY、IF-ATTEND-QUERY | 02、06 | CONSIST、TIME、ISOLATE | PLAN-008、ATTEND-003/004 |
| `A-CALENDAR-001–003` | PLAN / WORKSPACE / SHELL | IF-PLAN-QUERY、IF-WORKSPACE | 02 | CONSIST、TIME、ACCESS、RESPOND | PLAN-003/006/008、FLOW-02 |
| `A-DATA-001–003` | DATA / PROTECT / WORKSPACE | IF-DATA-*、IF-PROTECT-QUERY | 00、01 | LOCAL、TRUTH、PROTECT | DATA-001/005、PROTECT-001、PLATFORM-004 |
| `A-DATA-004` | PROTECT / DATA / LIBRARY | IF-DURABLE-FOLLOWUP、IF-BACKUP-CHECKPOINT | 01、03、04 | TRUTH、PROTECT、RESPOND、EVOLVE、CONTINUITY | PROTECT-002/003、DATA-004、FLOW-04 |
| `A-DATA-005` | PROTECT / WORKSPACE / DATA / LIBRARY / PLATFORM | IF-RESTORE-SESSION、IF-DATA-STAGE-ACTIVATE、IF-LIBRARY-MANIFEST | 00、03、05 | TRUTH、PROTECT、LOCAL、PORTABLE、RESPOND、EVOLVE、CONTINUITY、DIAG | PROTECT-004–006、DATA-006、WORKSPACE-003–005、LIBRARY-001/002/006、PLATFORM-002/004、FLOW-00/03/05 |
| `A-DATA-006` | PROTECT / WORKSPACE / DATA / LIBRARY | IF-RESTORE-SESSION、IF-IMPACT-PREVIEW | 05 | PROTECT、CONTINUITY、DIAG | PROTECT-004/005、WORKSPACE-005、FLOW-05 |
| `A-DATA-007` | DATA / PROTECT / WORKSPACE / LIBRARY / PLATFORM | IF-DATA-MIGRATION、IF-PROTECT-MIGRATION-ROLLBACK、IF-MIGRATION-ROLLBACK | 00、03、07 | TRUTH、PROTECT、LOCAL、PORTABLE、EVOLVE、CONTINUITY、DIAG、RELEASE | DATA-007、PROTECT-007、WORKSPACE-005/007、PLATFORM-005、SHELL-005、FLOW-07 |
| `A-PLATFORM-001` | PLATFORM / all shipped modules | IF-CLOCK/ZONE/FILESYSTEM/CHOOSER/SYSTEM-OPEN | 00–07 | PORTABLE、ACCESS、LOCAL | PLATFORM-001–005、RELEASE-002/003、G6/G8 |
| `A-PLATFORM-002` | WORKSPACE / external release gate | IF-WORKSPACE、内嵌 ApplicationBuildStatus；无 updater 接口 | 00、07 | LOCAL、RELEASE、DIAG | RELEASE-001/004/005、PLATFORM-004、PRIVACY-001、FLOW-07 |
| `A-PLATFORM-003` | PLATFORM / DATA / PROTECT / WORKSPACE | IF-LOCAL-LOCATION-CLASSIFIER、IF-FILESYSTEM、IF-DATA-MIGRATION | 00、07 | TRUTH、PROTECT、LOCAL、PORTABLE、CONTINUITY、RELEASE | PLATFORM-002/005、DATA-007、PROTECT-007、RELEASE-002/003 |
| `A-PLATFORM-004` | all shipped modules / external G8 | ApplicationReleaseDescriptor/ApplicationBuildStatus、IF-WORKSPACE | 00、07 | PORTABLE、ACCESS、LOCAL、RELEASE | RELEASE-001–005、PLATFORM-004/005、G6/G8 |
| `A-ATTEND-001` | ATTEND / WORKSPACE | IF-ATTEND-COMMAND/QUERY | 00、01、06 | TIME、STATE、CONTINUITY | ATTEND-001、WORKSPACE-004 |
| `A-ATTEND-002–003` | ATTEND | IF-ATTEND-COMMAND/QUERY | 01、02 | STATE、TRUTH | ATTEND-001/002 |
| `A-ATTEND-004–005` | ATTEND / PLAN / WORKSPACE | IF-ATTEND-QUERY | 02、06 | STATE、TIME、PROVENANCE | ATTEND-003、FLOW-06 |
| `A-ATTEND-006` | ATTEND / DATA / PROTECT / WORKSPACE | IF-ATTEND-*、IF-DATA-COMMIT | 01、04、06 | ISOLATE、TRUTH | ATTEND-004、WORKSPACE-003 |
| `B-FILE-001` | LIBRARY / PLATFORM / WORKSPACE | IF-LIBRARY-COMMAND、IF-IMPACT-PREVIEW、IF-LOCAL-LOCATION-CLASSIFIER | 03 | PROTECT、PORTABLE、DIAG | LIBRARY-001、PLATFORM-002、FLOW-03 |
| `B-FILE-002–003` | LIBRARY / PLAN refs | IF-LIBRARY-COMMAND/IMPACT | 01、03 | TRUTH、CONTINUITY | LIBRARY-005、WORKSPACE-006 |
| `B-FILE-004–005` | LIBRARY / PLATFORM | IF-FILE-OPERATION、IF-WATCHER | 03 | TRUTH、RESPOND、PORTABLE | LIBRARY-002/003、FLOW-03 |
| `B-FILE-006–008` | LIBRARY | IF-LIBRARY-COMMAND/QUERY | 03 | CONSIST、STATE | LIBRARY-003/005/006 |
| `B-FILE-009–011` | LIBRARY / PLATFORM / SHELL | IF-FILE-OPERATION、IF-SYSTEM-TRASH、IF-LIBRARY-RESOURCE、IF-SYSTEM-OPEN、IF-RESOURCE-PREVIEW | 03 | TRUTH、PROTECT、ISOLATE、LOCAL、ACCESS、RESPOND、PORTABLE、EVOLVE、DIAG | LIBRARY-002/004/007、PLATFORM-002/003、FLOW-03、SHELL-001–004 |
| `B-FILE-012` | LIBRARY / PROTECT | IF-LIBRARY-MANIFEST、IF-BACKUP-CHECKPOINT、IF-RESTORE-SESSION | 04、05 | PROTECT、EVOLVE | PROTECT-006、FLOW-04/05 |
| `B-FILE-013` | LIBRARY | IF-LIBRARY-COMMAND/QUERY | 03 | PROTECT、DIAG | LIBRARY-001 |
| `C-GRADE-001–004` | GRADE | IF-GRADE-COMMAND/QUERY | 01、06 | STATE、PROVENANCE、TRUTH | GRADE-001/002/005/007 |
| `C-GRADE-005–007` | GRADE | IF-GRADE-COMMAND/QUERY/EXPORT | 01、06 | PROVENANCE、EVOLVE | GRADE-003/004 |
| `C-GRADE-008–009` | GRADE / PLAN refs | IF-GRADE-COMMAND/QUERY | 01、06 | STATE、PROVENANCE | GRADE-005/006 |
| `C-GRADE-010–011` | GRADE | IF-GRADE-QUERY | 06 | PROVENANCE、STATE、DIAG | GRADE-006、FLOW-06 |
| `C-GRADE-012–014` | GRADE | IF-GRADE-COMMAND/QUERY/EXPORT | 01、06 | CONSIST、PROVENANCE、EVOLVE | GRADE-003–007 |

`WP-R2-03` 只关闭 `A-COURSE-001–004` 中“创建 Course 与首个周期 Meeting”的纵向切片；Course 编辑/归档、同一 Course 的多个 Meeting 及其后续生命周期仍由后续工作包验收，不因本切片 `Done` 而声称完整 Requirement 已关闭。

完整已批准设计计数：PLAN/View/Calendar 31 + DATA/PLATFORM 11 + ATTEND 6 + FILE 13 + GRADE 14 = 75。首发计数：PLAN/View/Calendar 31 + DATA/PLATFORM 11 + ATTEND 6 + FILE 13 = 61；C1 的 GRADE 14 条不进入首发构建。C-TARGET-001–007 不计入完整设计或首发功能覆盖，映射到 `EXT-C2`。

“已覆盖”表示架构边界、接口和证据位置存在，不伪称上游参数已经完整。`A-VIEW-004/005` 的 `near-due` 由 PLAN 单点实现，并引用 PRD 的已裁定产品规则。

### 11.2 共享状态与 NFR（19）

| Requirement | 主要契约 | Q / Gate | TEST |
|---|---|---|---|
| `STATE-001` | IF-WORKSPACE query、IF-STRUCTURED-PROBLEM、MOD-SHELL | Q-STATE、Q-DIAG、G1 | SHELL-001/004 |
| `STATE-002` | CommandOutcome、FileOperation、Backup/Restore/MigrationRollback、DraftCheckpoint；activation 后 recovery actions | Q-TRUTH、Q-CONTINUITY、Q-DIAG、G4 | SHELL-003/005、WORKSPACE-003–007、PROTECT-005/007、全部 failpoint |
| `STATE-003` | Deadline/Weight/Score 状态类型 | Q-STATE、G3 | PLAN-006、GRADE-001/002 |
| `STATE-004` | IF-IMPACT-PREVIEW、规则分段 | Q-PROTECT、Q-DIAG、G3 | PLAN-004、WORKSPACE-002 |
| `STATE-005` | ResultSource、GradeProjection | Q-PROVENANCE、G3 | GRADE-005/006 |
| `STATE-006` | Attendance 状态枚举与统计 | Q-STATE、Q-ISOLATE、G3/G5 | ATTEND-001–004 |
| `STATE-007` | MigrationSafetyCopyStatus、MigrationRollbackStatus、Workspace maintenance/recovery 与 exact-build allowed actions | Q-STATE、Q-CONTINUITY、Q-DIAG、Q-RELEASE、G4/G8 | SHELL-005、WORKSPACE-003/005/007、DATA-007、PROTECT-007、FLOW-07 |
| `NFR-001` | MOD-DATA/PROTECT/PLATFORM、无远程业务依赖/updater、ADR-09 无生产诊断/遥测 | Q-LOCAL、G6/G8 | PLATFORM-003–005、RELEASE-004、PRIVACY-001 |
| `NFR-002` | IF-DATA-COMMIT/MIGRATION、IF-FILE-OPERATION、IF-LIBRARY-RESOURCE、IF-RESTORE-SESSION、IF-MIGRATION-ROLLBACK | Q-TRUTH、G4 | DATA-001/007、LIBRARY-002/007、PLATFORM-003、PROTECT-005/007 |
| `NFR-003` | 三位置边界、BackupSet、BackupCheckpoint/Manifest/retention、RestoreSafetySet 与 MigrationSafetyCopy 独立生命周期 | Q-PROTECT、G4 | LIBRARY-001、PROTECT-001–007、DATA-007、FLOW-05/07 |
| `NFR-004` | TermZone、Clock/ZoneRules、PLAN evaluator | Q-TIME、G3/G6 | PLAN-007、PLATFORM-001 |
| `NFR-005` | 显式未知状态 | Q-STATE、G3 | SHELL-001、PLAN-006、GRADE-001/002 |
| `NFR-006` | MOD-SHELL 呈现契约 | Q-ACCESS、G6/G8 | SHELL-001–005、LIBRARY-007 |
| `NFR-007` | IF-IMPACT-PREVIEW、Undo/恢复/迁移回退协议 | Q-PROTECT、G3/G4 | WORKSPACE-002、PLAN-004、LIBRARY-004、PROTECT-007、FLOW-05/07 |
| `NFR-008` | GradeProjection/EXT-C2 输出契约 | Q-PROVENANCE、G3 | GRADE-003–007 |
| `NFR-009` | PLAN 单一 evaluator、RevisionEnvelope | Q-CONSIST、G2/G3 | PLAN-008、WORKSPACE-001、FLOW-02 |
| `NFR-010` | LIBRARY/PLATFORM degradation | Q-ISOLATE、Q-DIAG、G5/G6 | LIBRARY-006/007、PLATFORM-003、WORKSPACE-003 |
| `NFR-011` | ATTEND 窗口、记录与 fallback | Q-ISOLATE、Q-STATE、G5 | ATTEND-001–004 |
| `NFR-012` | external G8、ApplicationReleaseDescriptor、stable data root、平台受信任制品、release manifest、人工上传后重新下载、不可变 public assets 与 rollback target retention | Q-PORTABLE、Q-LOCAL、Q-RELEASE、G6/G8 | RELEASE-001–005、PLATFORM-005、DATA-007、PROTECT-007、PRIVACY-001 |

### 11.3 完成定义（13）

| Requirement | 证据路径 |
|---|---|
| `MVP-DOD-001` | Q-USABILITY；TEST-USABILITY-001、WORKSPACE-004 |
| `MVP-DOD-002` | FLOW-02；TEST-WORKSPACE-001、PLAN-008 |
| `MVP-DOD-003` | TEST-PLAN-003/008、FLOW-02 |
| `MVP-DOD-004` | TEST-PLAN-004/005、FLOW-01/02 |
| `MVP-DOD-005` | Q-LOCAL/Q-CONTINUITY；TEST-WORKSPACE-005、DATA-006、PLATFORM-004 |
| `MVP-DOD-006` | Q-TRUTH/Q-PROTECT；TEST-DATA-001/006、PROTECT-002–005、LIBRARY-002/006、FLOW-05 |
| `MVP-DOD-007` | Q-PORTABLE、G6；TEST-PLATFORM-001–003 和两平台核心 E2E |
| `MVP-DOD-008` | Q-LOCAL；TEST-PLATFORM-004 |
| `MVP-DOD-009` | Q-PORTABLE/Q-RELEASE、G6/G8；TEST-RELEASE-001–005、DATA-007、PROTECT-007、WORKSPACE-007、FLOW-07 |
| `MVP-A-P-DOD-001` | TEST-ATTEND-001 |
| `MVP-A-P-DOD-002` | TEST-ATTEND-001/002 |
| `MVP-A-P-DOD-003` | TEST-ATTEND-003 |
| `MVP-A-P-DOD-004` | TEST-ATTEND-004、WORKSPACE-003 |

### 11.4 User Flow（10）

| User Flow | MOD / FLOW | TEST |
|---|---|---|
| `UF-A-01` 首次启动/恢复选择 | WORKSPACE/PROTECT；FLOW-00/05 | FLOW-00-LIFECYCLE、FLOW-05-RESTORE-RECOVERY |
| `UF-A-02` 可恢复首次设置 | WORKSPACE/PLAN；FLOW-00/01 | USABILITY-001、WORKSPACE-004/005 |
| `UF-A-03` Today 日常闭环 | PLAN/ATTEND；FLOW-01/02 | FLOW-01-COMMIT、FLOW-02-UNIFIED-PLAN |
| `UF-A-04` 课程/周期课表维护 | PLAN；FLOW-01/02 | PLAN-001–005 |
| `UF-A-05` 任务与重复实例 | PLAN；FLOW-01/02 | PLAN-004–006 |
| `UF-A-06` Week/Calendar/Holiday/TBA | PLAN；FLOW-02 | PLAN-003/006/008、FLOW-02 |
| `UF-A-07` 保存/备份/恢复 | DATA/PROTECT；FLOW-01/04/05 | FLOW-04、FLOW-05、DATA-001 |
| `UF-A-08` 学期结束/历史/新学期 | WORKSPACE/PLAN；FLOW-00/01/02 | FLOW-00、PLAN-001/007 |
| `UF-A-09` 手动更新/迁移/精确版本回退 | WORKSPACE/DATA/PROTECT/LIBRARY/PLATFORM；FLOW-00/03/07 | RELEASE-001–005、DATA-007、PROTECT-007、WORKSPACE-007、SHELL-005、FLOW-07 |
| `UF-A-P01` 出席 | ATTEND；FLOW-01/02/06 | ATTEND-001–004、FLOW-06 |

### 11.5 UI 表面（首发 19 / 完整设计 24）

所有 UI 表面由 `MOD-SHELL` 拥有，只通过 `IF-WORKSPACE`。首发剖面验收 19 个表面，即下表中除 `UI-GRADE-01` 至 `UI-GRADE-05` 外的表面；这五个表面与其 `MOD-GRADE` 契约保留为已批准的 MVP-C1 设计，不进入首发构建。下表指定主要 Query/Intent；详细布局仍以 UI 规格为准。

| UI surface | 主要契约 |
|---|---|
| `UI-ENTRY-01` | Restore/MigrationRollbackBootState、WorkspaceStatus、InitializeWorkspace、SelectRestoreCandidate；maintenance/recovery 未收敛时只呈现 allowed actions |
| `UI-SETUP-01` | SetupProjection、DraftCheckpoint、PLAN intents、RecordSetupDecision |
| `UI-TODAY-01` | TodayProjection、TodayAttendanceOverlay、Task/Attendance intents |
| `UI-COURSE-01`、`UI-COURSE-02` | 首发：CourseList/Detail、CourseAttendanceProjection、Course/Meeting intents；完整已批准 MVP-C1 设计才包含 CourseGradeProjection |
| `UI-MEETING-01` | MeetingSeriesDetail、PlanImpactProjection、scope intents |
| `UI-TASK-01`、`UI-TASK-02` | TaskList/Detail、Task state/progress/scope intents |
| `UI-REPEAT-01` | TaskSeriesDetail、PlanImpactProjection、series intents |
| `UI-CALENDAR-01`、`UI-CALENDAR-02` | CalendarWindowProjection、AgendaProjection、TbaProjection |
| `UI-FILE-01` | LibraryRootStatus、LibrarySearch、Library intents/OperationStatus |
| `UI-FILE-02` | LibraryFileDetail、accessResource、file intents |
| `UI-FILE-03` | LibraryConflicts、FileOperationStatus、ResolveNameConflict/Reconciliation/ExternalFileIdentity、Change/ReauthorizeRoot、RepairLibraryMarker |
| `UI-GRADE-01` | CurrentTermGradeOverview |
| `UI-GRADE-02` | CourseGradeProjection、Grade intents |
| `UI-GRADE-03` | DraftCheckpoint、RecordScore/ClearScore |
| `UI-GRADE-04` | GradingScheme query/intents、GradeImpactProjection |
| `UI-GRADE-05` | GradeScaleList/Detail、versioning intents |
| `UI-SETTINGS-01` | Workspace/PLAN/ATTEND capability queries and configuration intents |
| `UI-DATA-01` | DataProtectionStatus、RestoreSafetySetStatus、MigrationSafetyCopyStatus、backup destination/trigger/安全清理/删除副本/回退 preview intents |
| `UI-DATA-02` | SnapshotList/Detail、RestorePreview（target/capacity/protection）、RestoreOperationStatus、recovery allowed actions 与 restore intents |
| `UI-DATA-03` | MigrationRollbackPreview/Status、ApplicationBuildStatus、confirm/continue-as-target/cancel-as-source 与 exact-build allowed actions |
| `UI-TERM-01` | TermList/Detail、set/archive/restore current intents、PlanImpactProjection |

首发为 19 个正式页面/表面；完整已批准产品设计按 UI 规格目录展开为 24 个正式页面/表面。抽屉、模态框和 Toast 是这些表面的交互形态，不建立新的领域模块或数据接口。

### 11.6 非当前范围与未来接缝

下表用于后续文档对齐，不计入当前 75 条功能需求、当前 Gate 或 backlog：

| Source item | Extension seam | 进入实现前必须补充 |
|---|---|---|
| `C-TARGET-001–007` | `EXT-C2` | 独立产品设计、目标/假设事实、可达性公式、专属 TEST 与估算/coverage 质量证据 |
| `FUTURE-GRADE-001` | `EXT-C3` | 重修/SAC、CR/NCR、转学分、跨项目边界、历史规则版本和缺口语义 |
| `FUTURE-HOME-001` | `EXT-WORKLOAD` | 估时/实际用时事实、未知规则、周边界和历史稳定性 |
| `FUTURE-HOME-002` | `EXT-TIMER` | 暂停/恢复/取消、睡眠/重启/后台限制和是否保存历史 |
| PROJECT_BRIEF 后续任务能力 | `EXT-TASK-RELATIONS` | 子任务/依赖产品语义及对实例/历史的影响 |
| PROJECT_BRIEF 后续 AI/import | `EXT-CANDIDATE-INTAKE` | Candidate 来源、确认、隐私、失败和禁止直写正式事实的测试 |
| 新文件预览/处理 | `EXT-FILE-PROCESSOR` | 支持格式、资源安全、失败隔离和平台证据 |
| 多设备/协作 | `EXT-COLLABORATION-BREAK` | 新身份、授权、远程隐私、同步、一致性、冲突与离线合并架构；不能直接套用当前接缝 |

## 12. 扩展、Agent 工作包与变更完成标准

### 12.1 未来模块接入模板

任何 `EXT-*` 在变成当前模块前必须建立独立产品设计，并填写：

```text
ExtensionContract {
  extensionId
  productRequirementIds
  semanticOwner
  ownedFacts / derivedResults
  referencedStableIds
  inboundInterfaces / outboundInterfaces
  criticality: core | optional | secondary | protection
  applicableQualityIds / extensionSpecificQualityIds
  unknownAndProvenanceRules
  failureRadius / degradedFallback
  restartAndOperationSemantics
  formatAndMigrationVersion
  platformAndAccessibilityEvidence
  performanceBaselineDelta
  explicitlyUnsupportedInteractions
}
```

接入判定：

- C2 读取版本化 GradeProjection，拥有目标/假设，不写 C1；
- C3 读取 FinalCourseOutcome + GradeScaleVersion，独立拥有历史/缺口/累计；
- 复杂评分先作为新的版本化 GradingScheme/evaluator 变体进入 GRADE，不能改变既有直接权重结果；只有出现独立事实、生命周期或失败边界时才重新评审模块拆分；
- Workload/Timer 引用 TaskOccurrenceId 并拥有明确估时/计时事实；
- AI/import 先产生 Candidate/Draft，经用户确认后才进入 FLOW-01；
- Collaboration 不使用此轻量模板直接接入，必须先重做身份、远程隐私、一致性与冲突质量模型。

### 12.2 Agent 实现工作包模板

本模板用于后续 backlog/实施计划引用，本身不创建任务、优先级或排期。

```text
WorkPacket
  Target IDs:
    Requirement:
    Primary MOD:
    IF:
    FLOW:
    Q / Gate:
    TEST obligations:

  Semantic scope:
    Owns:
    Does not own:
    Inputs:
    Outputs:
    Invariants:

  Allowed dependencies:
  Forbidden boundary crossings:
  Problems / dataEffect / degradation:
  Restart and idempotency behavior:
  Required test seams and evidence:
  ADR dependencies or open ADR-TOPIC IDs:
  Traceability rows to update:
```

工作包完成标准：目标契约实现、所有指定 TEST 通过、追溯更新、无越界依赖、无未经 ADR 的具体跨切面选型。一个工作包不得顺手改变两个模块的所有权或实现未来 EXT；这类变化先回到架构评审。

### 12.3 变更分类

| 变化 | 必须更新 |
|---|---|
| 产品行为/范围/验收变化 | 产品文档 → ARCHITECTURE → 本文 → tests |
| 模块所有权、依赖、事实真相、FLOW、Q 变化 | ARCHITECTURE → 本文 → trace/tests |
| 既有边界内新增 Intent/Query/Problem/TEST | 本文 → trace/tests |
| 技术实现选择/替换 | ADR；引用受影响 MOD/IF/FLOW/Q，不复制契约 |
| 实现顺序与工作切片 | roadmap/backlog；引用 WorkPacket IDs |

### 12.4 文档终审清单

- [ ] 首发 61 条功能需求和完整已批准设计 75 条功能需求全部出现在 §11.1；C2/C3 未计入两者覆盖；
- [ ] 7 条 STATE、12 条 NFR、13 条 DOD、10 条 User Flow、首发 19 个 UI 表面及完整设计 24 个 UI 表面全部可追溯；
- [ ] 九个模块都包含 Purpose、Owns、Does not own、Interfaces、Invariants、Problems、Test seams、Trace；
- [ ] 八条 FLOW 都定义 Trigger、步骤、成功边界和失败/降级语义；
- [ ] 16 条 Q 均有 TEST evidence，G1–G8 均可判定；
- [ ] 没有 UI、存储、进程或平台实现类型泄漏到领域接口；
- [ ] 没有具体技术选型、ADR 结论、roadmap、backlog 或未来占位实现；
- [ ] 上游差异已显式记录，未靠架构猜测同时支持互相冲突的产品语义。
- [ ] `GAP-PRODUCT-01` 已解决并引用 PRD 的唯一产品规则所有者；A-VIEW-004/005 不再由未校准参数阻止发布验收。
