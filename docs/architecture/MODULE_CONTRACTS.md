# CourseFlow 模块与接口契约

> 状态：候选规范（设计已确认，待文档终审）
> 版本：0.9
> 日期：2026-08-19
> 配套总览：[ARCHITECTURE.md](./ARCHITECTURE.md)

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

`GAP-PRODUCT-01`：上游要求“即将到期/临近提示”，但没有定义阈值、边界等于时的归类或可配置范围。PLAN 已为 `near-due` 保留单一分类规则位置，Shell 不得自行设阈值；在该状态进入发布验收前，产品文档必须补充确定值与示例。该缺口不是 ADR 可决定的技术参数。

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
| `FileId` | `MOD-LIBRARY` | 跨应用内重命名/移动稳定；路径不是身份 |
| `SnapshotId` | `MOD-PROTECT` | 已发布快照的身份；临时文件不获得正式 SnapshotId |
| `OperationId` | 启动操作的模块 | 扫描、文件、备份、恢复等长操作跨重启稳定 |
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
| `MeetingSegment` | 在明确生效范围内的类型、星期、当地开始/结束时间、地点和其他课节字段 |
| `TaskSeries` | 与 Course 关联的一次性或每周任务身份；由规则段表达未来修改 |
| `TaskSegment` | 规模、截止语义、重复范围、是否跟随教学周及其他任务字段 |
| `Occurrence` | 从系列、段、范围、假期和覆盖事实确定性派生的单次实例 |
| `OccurrenceOverride` | “仅本次”的修改、取消或状态事实；不得修改相邻实例 |
| `GradeTaskRef` | `none`、`task-series(TaskSeriesId)` 或 `task-occurrence(TaskOccurrenceId)`；只能由用户显式建立，标题相同不构成关联 |
| `GradeProjection` | `CourseGradeProjection` 的版本化只读导出，携带 CourseId、input revision、GradeScaleVersionId、result source、coverage、warnings 与估算标识 |
| `FinalCourseOutcome` | 仅在存在 calculated-final、manual-final 或 user-attested school-record 时导出其值、来源、provenance、credits 与绑定模板；current-estimate 不能冒充最终结果 |
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

health 是可重建诊断，不替代模块正式事实。Workspace 将模块 health 聚合到投影。

#### Workspace mode

`ready | limited | read-only | recovery`

模式切换规则见 [§9](#9-错误传播降级与工作区模式)。

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
```

执行前必须重新验证 FileId 对应路径仍位于当前根目录、资源存在、权限允许且 stamp 未过期。结果可以是受控预览描述、系统打开确认或 StructuredProblem；普通 `ProjectionEnvelope` 不携带大文件二进制内容。

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
  resolution: correct | retry | reauthorize | decide | resume | rollback | restore | cancel
  context: { revision?, entityVersions?, operationId?, diagnosticRef? }
  details: structured, non-UI fields
}
```

Shell 将 code/details 映射为可访问文案和焦点，但不得自行推断 dataEffect。诊断引用不得包含自动上传承诺。

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
| PROTECT | `IF-PROTECT-COMMAND`、`IF-PROTECT-QUERY`、`IF-BACKUP-CHECKPOINT`、`IF-RESTORE-SESSION` | PROTECT；备份/恢复入口和跨模块会话 |
| DATA | `IF-DATA-READ`、`IF-DATA-COMMIT`、`IF-DATA-RECEIPT`、`IF-DATA-EXPORT`、`IF-DATA-STAGE-ACTIVATE`、`IF-DATA-OPERATION` | DATA；一致读取、提交、幂等、导出与激活 |
| PLATFORM | `IF-CLOCK`、`IF-ZONE-RULES`、`IF-FILESYSTEM`、`IF-WATCHER`、`IF-DIRECTORY-CHOOSER`、`IF-SYSTEM-OPEN`、`IF-RESOURCE-PREVIEW` | PLATFORM；窄操作系统能力 |
| State machines | `IF-FILE-OPERATION`、`IF-REVISION-INVALIDATION` | LIBRARY/跨模块；详细状态见 §7 |

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

**Problems / Degradation**

Shell 局部渲染失败只能影响相应表面，不得提交补偿性领域命令。无法解释的新 ProblemCode 必须显示安全的通用错误、dataEffect 和 diagnosticRef，并保留恢复动作。

**Test seams**

以固定 Workspace contract driver 注入每个 outcome、capability、health、空/未知/stale/problem 状态；执行键盘、焦点、状态公告和窄桌面验收。

**Trace**

`NFR-006`、`STATE-001–006`、全部 UI 表面；`Q-ACCESS-01`、`Q-DIAG-01`；`TEST-SHELL-001–004`。

### 5.2 `MOD-WORKSPACE` — 应用边界与编排

**Purpose**

提供唯一应用接口，在不夺取领域语义的前提下协调生命周期、修订、模块调用、影响预览、长操作、降级和投影组合。

**Owns**

- `WorkspaceLifecycle`、`SetupProgress`、DraftCheckpoint 保存协议；
- Workspace mode、Capability/Health 聚合；
- `CommandEnvelope` 路由、版本/确认前置检查和 CommandOutcome 组合；
- `ImpactPreview` 的跨模块组合；
- `ProjectionEnvelope` 的 revision/EvaluationContext；
- 跨模块 OperationHandle 汇总与当前路由（welcome/setup/today/recovery）。

**Does not own**

- PLAN 重复/假期/冲突规则；
- ATTEND 或 GRADE 公式；
- LIBRARY 磁盘—索引对账；
- PROTECT 快照/恢复内部状态机；
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

**Problems / Degradation**

- 模块 unavailable → `limited`，相关投影片段 unavailable；
- DATA 可读不可写 → `read-only`；
- DATA 不可读、版本不兼容、Restore activation 不确定 → `recovery`；
- PLAN 核心投影失败 → 相关核心查询失败或明确 stale，不降级成“没有事项”。

**Test seams**

使用可替换的 healthy/slow/failing/recovering 模块 driver、可控 Clock 和版本冲突 DATA driver；验证每个 Workspace mode、Envelope、一致 revision、幂等、preview 和 follow-up 状态。

**Trace**

`UF-A-01–08`、`UF-A-P01`、跨模块 STATE/NFR；`FLOW-00–06`；`Q-CONSIST-01`、`Q-ISOLATE-01`、`Q-CONTINUITY-01`、`Q-DIAG-01`；`TEST-WORKSPACE-001–006`。

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

- AttendanceWindow（启用日起至关闭前的区间）；
- attended/missed 的 AttendanceRecord 与显式更正；
- unmarked 义务、课程计数、出席率、覆盖率和 Today 覆盖投影。

**Does not own**

- MeetingOccurrence 身份、时间、取消或假期抑制；
- 定位、二维码、教师验证、后台自动判断或学校正式考勤；
- PLAN 的 Today/Calendar 基础投影。

**Interfaces**

- `IF-ATTEND-COMMAND`：EnableFromDate、DisableAtDate、MarkAttended、MarkMissed、ResetToUnmarked；
- `IF-ATTEND-QUERY`：TodayOverlay、CourseAttendanceProjection、CapabilityState；
- `IF-ATTEND-IMPACT`：Meeting/Term 变化对记录引用的核对影响。

**Invariants**

1. 默认 disabled；Enable 从 TermZone 当天生效，包含当天较早已结束课节，不回溯更早日期。
2. Disable 保留已有窗口和记录；再次 Enable 建立新窗口，不补写关闭期间。
3. 只有有效窗口内、已开始且应上课的 MeetingOccurrence 可标记；取消、假期抑制和未来实例不产生记录义务。
4. unmarked 保持未知，不存成 missed。
5. `attendanceRate = attended / (attended + missed)`；分母为零则 unknown。
6. `coverageRate = (attended + missed) / eligibleEndedOccurrencesInWindows`；分母为零则 unknown。
7. Today 在 capability available 时：attended 计完成，已结束 unmarked 待确认，missed 单列，未来/进行中待完成；disabled/unavailable 时退回 PLAN 时间语义。
8. ATTEND 失败不得阻止 PLAN query/command。

**Problems / Degradation**

feature-disabled、outside-window、occurrence-ineligible、conflict、not-committed 和 calculation-unavailable 均保持明确。统计失败使 ATTEND 投影 unavailable，不修改记录事实或 PLAN。

**Test seams**

可控 Clock/Zone、MeetingOccurrence fixture、窗口开关历史、分母为零、取消/假期、失败模块 driver。

**Trace**

`A-ATTEND-001–006`、`A-VIEW-006`、`STATE-006`；`FLOW-01/02/06`；`Q-STATE-01`、`Q-TIME-01`、`Q-ISOLATE-01`；`TEST-ATTEND-001–004`。

### 5.5 `MOD-LIBRARY` — 文件资料库

**Purpose**

管理一个本地资料库根目录，使磁盘文件、稳定索引、目录派生标签和自定义标签保持可解释一致。

**Owns**

- LibraryRoot 配置与健康；
- FileId/LibraryRecord、验证标记和最后扫描状态；
- Term/Course/Category 文件夹映射、建议/自定义分类；
- 目录派生标签与独立 CustomTag；
- FileOperation、扫描/对账、同名冲突和资源访问前置验证。

**Does not own**

- Term/Course 的名称与生命周期；只保存稳定引用和文件夹映射；
- 文件系统实现、选择器、系统默认应用；
- 备份快照发布或恢复激活；
- 文件内容的 AI 分类。

**Interfaces**

- `IF-LIBRARY-COMMAND`：配置/更换根目录、分类/标签、复制导入、重命名、移动、删除、扫描、冲突决策；
- `IF-LIBRARY-QUERY`：根健康、搜索/筛选、列表、详情、FileOperation/对账状态；
- `IF-LIBRARY-RESOURCE`：FileId + stamp 的预览/系统打开/定位验证；
- `IF-LIBRARY-MANIFEST`：向 PROTECT 提供已验证 manifest/content source，向 restore 提供暂存/对账；
- `IF-LIBRARY-IMPACT`：Course/Term/Root 变化的文件夹和引用影响。

**Invariants**

1. MVP 同时只管理一个根目录；根目录可更换但必须先 preview、验证可读写且不与活动数据/备份目录重叠。
2. 真实文件内容与存在性以磁盘为准；索引只声明最后验证事实。
3. Watcher 事件是 hint；启动或用户重扫必须能够发现关闭期间的变化。
4. FileOperation 遵循 `planned → disk-applied → index-committed`；中断后进入 reconciliation-required。
5. 文件操作只有 index-committed 后才面向用户完整成功；disk-applied 必须说明磁盘可能已改变。
6. 应用导入复制原文件，不移动源文件；源文件后续变化不影响资料库副本。
7. 同名文件不得覆盖，直到用户选择 keep-both、replace 或 cancel；keep-both 先预览新名称。
8. 默认建议分类为“考试、笔记、作业、练习、其他”；用户可以增删或重命名分类。删除非空分类前必须 preview 文件数与目标路径，并只接受“移动到用户选择的其他分类”或 cancel；分类变化不得静默删除文件。目录派生标签随已验证路径变化；CustomTag 独立保存，不因移动或分类更名删除。
9. 课程重命名以 CourseId 保持映射。物理目录后续动作失败时核心课程事实可以已提交，但 Library 必须显示 pending/reconciliation 状态，不声称整体完成。
10. 任意文件类型可以保存；PDF、PNG、JPEG、WebP 和纯文本提供内置预览，其他类型仍可 system-open/reveal。
11. 权限丢失时索引标 unverified；不得继续显示“可用”，但旧列表上下文可保留并明确状态。
12. 搜索/组合筛选只返回索引中的真实记录及验证状态，不合成示例文件。

**Problems / Degradation**

permission、root-unavailable、resource-stale、name-conflict、disk-applied、reconciliation-required、not-found 和 unsupported-preview。LIBRARY unavailable 时其他结构化模块继续；文件写操作关闭，重新授权/扫描/换根入口保留。

**Test seams**

虚拟 FileSystemPort、Watcher、权限变化、路径大小写/分隔差异、逐阶段 failpoint、同名策略、外部移动、重启扫描、资源 stamp 失效和 macOS/Windows conformance。

**Trace**

`B-FILE-001–013`、`NFR-003/010`；`FLOW-03–05`；`Q-TRUTH-01`、`Q-PROTECT-01`、`Q-ISOLATE-01`、`Q-RESPOND-01`、`Q-PORTABLE-01`；`TEST-LIBRARY-001–007`。

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

### 5.7 `MOD-PROTECT` — 备份与恢复

**Purpose**

在不阻塞本地正式保存的前提下生成可验证快照，并通过显式、可恢复会话替换整个活动数据集。

**Owns**

- BackupConfiguration、backup-needed/success watermarks、最后成功/错误；
- BackupCheckpoint、SnapshotManifest、Snapshot 发布状态；
- RestoreSession、影响预览、安全快照、暂存/验证/激活编排；
- “不自动合并副本”的恢复策略。

**Does not own**

- 活动结构化提交、Library 文件真相；
- 云盘同步工具或远程一致性；
- 用户业务数据的语义迁移规则；
- 当前 Workspace 路由和 UI。

**Interfaces**

- `IF-PROTECT-COMMAND`：配置/清除目的地、立即备份、重试、开始恢复、确认、继续、回滚、取消；
- `IF-PROTECT-QUERY`：备份状态、快照目录、RestoreSession；
- `IF-BACKUP-CHECKPOINT`：从 DATA 获取一致 revision，从 LIBRARY 获取已验证 manifest/content；
- `IF-RESTORE-SESSION`：协调 DATA/LIBRARY 的暂存、验证与激活。

**Invariants**

1. 未配置备份目录是合法“仅保存在本机”，不是持续错误。
2. 目的地不得与活动数据目录或 LibraryRoot 重叠。
3. 正式结构化提交或 Library index-committed 原子推进 backup-needed 水位；PostCommitChange 只负责唤醒。
4. 备份可以合并多个 revision 请求，但发布快照必须声明实际覆盖 revision 和文件 manifest。
5. 快照先写临时目标，完成格式/manifest/完整性验证后才发布并推进成功水位。
6. 备份失败保留本地成功和上一有效快照；错误、最后成功时间和待备份水位可查询。
7. 恢复依次执行选择、版本/完整性验证、影响预览、确认、安全快照、暂存、验证、激活检查点、重新打开/对账。
8. 激活前失败保持原活动数据；激活中断进入 recovery，可继续或回滚；不返回部分成功。
9. MVP 不自动扫描并选择“最新云盘副本”，不双向合并不同副本。
10. B 已交付时，快照包含 Library 文件及课程/分类/自定义标签映射；恢复后必须一致。

**Problems / Degradation**

destination-unset、permission、snapshot-corrupt、incompatible-version、impact-changed、staging-failed、activation-pending、rollback-required。Backup unavailable 只使保护能力 degraded；Restore activation 不确定使 Workspace recovery。

**Test seams**

可替换 checkpoint source/destination、临时发布与每阶段 failpoint；损坏、旧/新版本、目录不可写、应用重启、激活中断、回滚和 Library 大清单 fixtures。

**Trace**

`A-DATA-002–006`、`B-FILE-012`、`STATE-002`；`FLOW-04/05`；`Q-TRUTH-01`、`Q-PROTECT-01`、`Q-EVOLVE-01`、`Q-CONTINUITY-01`；`TEST-PROTECT-001–006`。

### 5.8 `MOD-DATA` — 活动数据协议

**Purpose**

为领域模块提供版本化、一致、幂等、可恢复的正式结构化数据提交与读取协议，不取得领域语义所有权。

**Owns**

- Revision、ReadSnapshot、EntityVersion 和 CommandReceipt；
- 原子逻辑 commit、幂等 command receipt；
- PROTECT/其他模块所定义 DurableFollowUp 与 backup watermark 的原子持久化协议；DATA 不拥有其业务含义或完成策略；
- export checkpoint、restore staging、activation checkpoint 和格式版本；
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

**Problems / Degradation**

validation 由领域模块产生；DATA 产生 conflict、permission、integrity、incompatible-version、activation-pending 和 recovery-required。禁止把底层异常字符串当稳定 ProblemCode。

**Test seams**

CommitPort failpoint 覆盖提交每个阶段、幂等重放、并发版本冲突、通知丢失、重启 follow-up、只读、损坏、未知版本和激活继续/回滚。

**Trace**

`A-DATA-001–006`、`NFR-002/003`、`MVP-DOD-005/006`；`FLOW-00/01/04/05`；`Q-TRUTH-01`、`Q-CONSIST-01`、`Q-EVOLVE-01`、`Q-CONTINUITY-01`；`TEST-DATA-001–006`。

### 5.9 `MOD-PLATFORM` — 操作系统能力端口

**Purpose**

把 macOS/Windows 的时间、文件、选择器和系统打开差异封装为窄能力，使领域模块只处理规范语义。

**Owns**

- `IF-CLOCK`、`IF-ZONE-RULES`；
- `IF-FILESYSTEM`、`IF-WATCHER`、`IF-DIRECTORY-CHOOSER`；
- `IF-SYSTEM-OPEN`、`IF-RESOURCE-PREVIEW`；
- 平台 capability 与结构化错误映射。

**Does not own**

- 学期时区选择、文件冲突决策、根目录合法性业务规则、备份策略；
- 领域身份、索引、快照或页面文案；
- 通用 service locator。

**Interfaces**

- 时间：`IF-CLOCK`、`IF-ZONE-RULES`；
- 文件：`IF-FILESYSTEM`、`IF-WATCHER`、`IF-DIRECTORY-CHOOSER`；
- 资源：`IF-SYSTEM-OPEN`、`IF-RESOURCE-PREVIEW`。

这些接口只返回规范 capability/result/problem；调用方不得依赖原始平台异常或路径 API。

**Invariants**

1. Clock/ZoneRules 可注入并在两个平台产生相同领域日期语义。
2. 文件操作准确报告 planned request 的物理结果、权限和路径；不得把失败报告为成功。
3. Watcher 明确是 best-effort hint，不提供“已完整扫描”保证。
4. 选择器取消是用户取消，不是 permission error。
5. system-open/preview 只处理已由 LIBRARY 重新验证的资源描述。
6. 平台错误映射为稳定 capability/problem，不泄露为领域分支所依赖的原始异常类型。

**Problems / Degradation**

permission、not-found、temporarily-unavailable、unsupported-preview、user-cancelled。能力故障只传播到实际消费者；Clock/ZoneRules 无法可信计算时，时间相关核心投影 unavailable，而非使用猜测时区。

**Test seams**

Fake Clock/Zone/FS/Watcher/Chooser/Open，外加 macOS 与 Windows 同一 conformance suite 和真实权限 E2E。

**Trace**

`A-PLATFORM-001`、`NFR-004/010`；全部涉及时间/文件的 FLOW；`Q-TIME-01`、`Q-PORTABLE-01`、`Q-RESPOND-01`；`TEST-PLATFORM-001–004`。

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

Queries：`WorkspaceStatus`、`SetupProjection`、`OperationStatus`、`CapabilityProjection`、`ModuleHealthProjection`。

### 6.2 PLAN

| Intent family | 变体 |
|---|---|
| Term | `CreateTerm`、`UpdateTerm`、`SetCurrentTerm`、`ArchiveTerm`、`RestoreTermAsCurrent` |
| Holiday | `CreateHolidayRange`、`UpdateHolidayRange`、`DeleteHolidayRange` |
| Course | `CreateCourse`、`UpdateCourse`、`ArchiveCourse`、`RestoreCourse` |
| Meeting | `CreateMeetingSeries`、`UpdateMeetingSeries`、`ChangeMeetingOccurrence(scope=only-this|this-and-future)`、`CancelMeetingOccurrence`、`DeleteMeetingSeries` |
| Task | `CreateTaskSeries`、`UpdateTaskSeries`、`ChangeTaskOccurrence(scope=only-this|this-and-future)`、`DeleteTaskOccurrenceOrSeries` |
| Task state | `SetTaskOccurrenceStatus(pending|completed|skipped)`、`SetTaskProgress` |

Queries：`TermList/TermDetail`、`CourseList/CourseDetail`、`MeetingSeriesDetail`、`TaskList/TaskDetail/TaskSeriesDetail`、`TodayProjection`、`WeekProjection`、`CalendarWindowProjection`、`AgendaProjection`、`TbaProjection`、`PlanImpactProjection`。

### 6.3 ATTEND

Intents：`EnableAttendanceFromToday`、`DisableAttendanceAtToday`、`MarkAttended`、`MarkMissed`、`ResetAttendanceToUnmarked`。

Queries：`AttendanceCapability`、`TodayAttendanceOverlay`、`CourseAttendanceProjection`、`AttendanceImpactProjection`。

### 6.4 LIBRARY

| Intent family | 变体 |
|---|---|
| Root | `CreateDefaultLibraryRoot`、`ChangeLibraryRoot`、`ReauthorizeLibraryRoot` |
| Taxonomy | `CreateCategory`、`RenameCategory`、`DeleteCategoryWithResolution`、`AddCustomTag`、`RenameCustomTag`、`RemoveCustomTag` |
| File mutation | `CopyFileIntoLibrary`、`RenameFile`、`MoveFile`、`DeleteFile` |
| Conflict | `ResolveNameConflict(keep-both|replace|cancel)` |
| Reconciliation | `StartLibraryScan`、`ResumeFileOperation`、`ResolveReconciliation` |

Queries：`LibraryRootStatus`、`LibrarySearch`、`LibraryFileDetail`、`FileOperationStatus`、`LibraryConflicts`、`LibraryImpactProjection`。文件预览/系统打开使用 `accessResource`，不是普通 Query。

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

Intents：`ConfigureBackupDestination`、`ClearBackupDestination`、`StartBackupNow`、`RetryBackup`、`SelectRestoreCandidate`、`ConfirmRestore`、`ResumeRestore`、`RollbackRestore`、`CancelRestoreBeforeActivation`。

Queries：`DataProtectionStatus`、`SnapshotList/Detail`、`RestorePreview`、`RestoreOperationStatus`。

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
- 磁盘动作开始前必须持久化 planned；
- disk-applied 之后取消只有在存在安全补偿时可用；
- 外部文件管理器变化不伪造 planned operation，而由 Scan/ReconciliationOperation 发现并产生明确索引 ChangeSet；
- 删除/替换优先使用产品允许的可恢复方式；具体平台实现由 ADR 决定。

### 7.2 `IF-BACKUP-CHECKPOINT`

`BackupCheckpoint` 至少包含：

```text
BackupCheckpoint {
  checkpointId
  activityRevision
  activityFormatVersion
  structuredDataSource
  libraryManifest { rootIdentity, records, verification stamps, content sources }
  createdAt
}
```

协议：

1. DATA 在 revision R 建立一致结构化 export；
2. LIBRARY 提供与 R 对应的索引元数据和逐文件已验证状态；
3. 未验证/缺失文件必须列为问题或根据已确认策略停止，不能静默遗漏后仍声称完整；
4. PROTECT 写临时快照；
5. 验证格式、manifest 和完整性；
6. 仅验证通过后发布 SnapshotId 并推进 `backupSucceededThrough`；
7. `backupNeededThrough` 大于成功水位时仍显示 pending/failed。

备份目的地未配置时，watermark 可以记录“本地有未保护 revision”，但用户状态是合法“仅保存在本机”，不是无限重试错误。

### 7.3 `IF-RESTORE-SESSION`

```text
selected -> validated -> previewed -> confirmed
    -> safety-snapshot -> staged -> stage-validated
    -> activation-checkpoint -> activated -> reopened/reconciled -> succeeded
```

终态/异常：

- validated 前发现损坏、不兼容或不可读：failed，活动数据 unchanged；
- preview revision 或候选发生变化：waiting-decision，重新 preview；
- activation-checkpoint 前失败：failed/cancelled，活动数据 unchanged；
- activation-checkpoint 后中断：recovery-required，普通 Workspace 写入关闭；
- activated 后重开/对账失败：recovery-required；可继续完成或回滚 safety snapshot；
- 只有 reopened/reconciled 成功后才返回 succeeded。

RestoreSession 必须持久保存候选身份、版本、验证结果、预览选择、安全快照、当前阶段和下一步能力。具体原子替换机制由 ADR 决定，但面向 Workspace 的状态不得改变。

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

## 8. 七条 FLOW 的规范步骤

### 8.1 `FLOW-00` — Workspace 激活与生命周期

**Trigger**：应用启动、恢复后重开、用户切换活动 Workspace，或 TermZone 日期边界。

1. PLATFORM 解析活动数据位置的能力，不自动扫描云盘选择副本。
2. DATA 检查可读/可写、格式版本、完整性和 activation checkpoint。
3. 若不可读/不兼容/激活未决，Workspace 进入 recovery，停止普通路由。
4. 加载 WorkspaceLifecycle、SetupProgress、DraftCheckpoint、Operation 和 DurableFollowUp。
5. 恢复或标记每个非终态 Operation；唤醒 pending follow-up/backup watermark。
6. PLAN 使用 TermZone/evaluatedAt 检查 Current Term；需要自动归档时发起 `ReconcileWorkspaceLifecycle`，经 FLOW-01 正式提交。
7. 计算 setup 当前最低条件、`everReachedMinimum` 与默认路由：无活动数据 → welcome；从未达标 → setup（仍可显式进入 Today）；曾达标 → Today。曾达标但当前无 Current Term 时，Today 返回“学期已结束/需要新学期”的真实状态及历史/创建入口，不退回首次设置；若原因是日期越界自动归档，最近结束学期的日期进度显示 100%。恢复未决始终 → recovery。
8. ATTEND/LIBRARY/GRADE/PROTECT 分别报告 capability/health；Library 扫描和 backup 在路由完成后异步启动。

**Completion criterion**：Workspace mode、route、revision、capabilities、operations 和 pending follow-ups 全部可查询；核心可用不等待 Library scan/backup。

**Failure semantics**：次级模块失败 → limited；DATA 只读 → read-only；完整性/激活不确定 → recovery。

### 8.2 `FLOW-01` — 结构化命令与本地提交

**Trigger**：用户或系统提交正式 WorkspaceIntent。

1. Shell 保留当前 draft，并在需要时调用 preview。
2. Workspace 验证 confirmationToken、CommandId、expected entity versions 和 capability。
3. 语义主模块验证 Intent、产生 ChangeSet/warnings/ReferenceImpact；其他模块只贡献影响或 follow-up。
4. 任何 validation/conflict/decision-required 在此返回，正式数据 unchanged，draft 保留。
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

1. preview 目标、重叠、权限和已知映射影响；
2. PLATFORM 验证目录能力；
3. accepted Operation 迁移/采用/重建映射；
4. LIBRARY 对账并在 index commit 后切换 current root；
5. 失败保留原 root 或进入明确 recovery，不同时宣称两个活动 root。

**App-managed mutation branch**

1. preview 同名/删除/移动影响并收集 ResolutionChoice；
2. 持久化 FileOperation planned；
3. PLATFORM 执行磁盘动作；
4. 标记 disk-applied，验证结果；
5. 提交 LibraryRecord/path/tags/verification 与 backup follow-up；
6. 达到 index-committed 后返回成功。

**External discovery branch**

1. Watcher/启动产生 scan hint；
2. ScanOperation 枚举受管理 root 并与索引比较；
3. 无歧义变化产生确定性 ChangeSet；同名/身份歧义进入 waiting-decision；
4. index commit 后发布新 revision/最后扫描时间。

**Resource access branch**

1. Shell 提交 FileId + verification stamp + mode；
2. LIBRARY/PLATFORM 重新验证 root containment、路径、存在性、权限和 stamp；
3. 返回受控 preview/system-open/reveal，或 resource-stale/permission problem。

**Completion criterion**：每个展示为可用的文件都有当前 verified stamp；每个中断操作都有可查询的真实阶段和恢复动作。

**Failure semantics**：planned 失败保持磁盘/索引 unchanged；disk-applied 后失败进入 reconciliation-required 并说明物理变化；权限/根不可用使 LIBRARY degraded，但 PLAN、ATTEND、GRADE 与结构化本地数据继续。

### 8.5 `FLOW-04` — 异步备份

**Trigger**：结构化 commit 或 Library index-committed 推进 `backupNeededThrough`，或用户手工启动。

1. PROTECT 合并待备份 revision，但不清除水位。
2. DATA/LIBRARY 建立 BackupCheckpoint。
3. PROTECT 向临时目标写结构化数据、manifest 和文件内容。
4. 验证格式、版本、清单和完整性。
5. 发布 SnapshotId，更新最后成功时间和 success watermark。
6. 若期间有新 revision，继续保持其 pending 水位并安排下一次。

**Completion criterion**：已发布快照可独立验证其 revision 与 manifest；水位准确说明已保护/未保护范围。

**Failure semantics**：当前本地数据与上一有效快照不变；显示原因、最后成功和 retry/change destination。

### 8.6 `FLOW-05` — 显式整库恢复

**Trigger**：welcome 或设置页选择用户指定快照。

1. 创建 RestoreSession 和 OperationHandle。
2. 验证候选可读、格式/版本/完整性；失败即停止。
3. 在当前 revision 上预览 Term/Course/Task/File/设置影响；用户明确选择替换，不提供自动合并。
4. 当前活动数据可读写时创建恢复前 safety snapshot。
5. DATA/LIBRARY 在临时位置 stage 候选并完整验证。
6. 进入 activation checkpoint；Workspace 切到 recovery/maintenance，停止普通写入。
7. 激活结构化数据与 Library，重开并对账；重新计算 Current Term、SetupProgress、health 和 projections。
8. 全部成功后返回 succeeded；否则继续或回滚。

**Completion criterion**：只有一个活动正式数据集；恢复结果、Library 文件/标签映射和 Workspace 路由均经过验证。

**Failure semantics**：候选验证、预览或 staging 失败保持原活动数据；activation checkpoint 后中断进入 recovery，只开放 resume/rollback/diagnostic，直到能证明原数据或新数据是唯一活动真相。

### 8.7 `FLOW-06` — 模块自有的确定性结果投影

**Trigger**：课程出席统计、单科成绩、成绩总览或 SGPA 查询。

1. Workspace 建立 ReadSnapshot R 与 EvaluationContext。
2. ATTEND 从 PLAN occurrence refs + 自有窗口/记录产生计数、率、coverage/unknown reason。
3. GRADE 从自有 scheme/results/scale version/source 与同一 ReadSnapshot 中 PLAN 拥有的 Course credits 产生 CourseGradeProjection 和 CurrentTermGradeOverview。
4. 每个模块返回 input revision、规则/模板版本、来源、coverage、warnings 和 unavailable/unknown reason。
5. Workspace 只组合 Envelope；不建立泛化规则引擎；Shell 不重算。

**Completion criterion**：详情与总览使用同一版本化结果；缺失输入停止或限定计算并解释范围。

**Failure semantics**：模块 projection unavailable/stale 不改变原始事实，也不阻塞 PLAN；旧估算不能无标记显示为当前。

## 9. 错误传播、降级与工作区模式

### 9.1 稳定 ProblemCode

| Code | 常见 scope | dataEffect | 典型 resolution |
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
| `incompatible-version` | operation/workspace | unchanged | choose other/migrate/restore |
| `calculation-unavailable` | module | unchanged | correct/retry |
| `operation-in-progress` | operation | 当前 handle dataEffect | observe/resume/cancel-if-safe |
| `reconciliation-required` | module | disk-applied 或未知物理差异 | rescan/decide/resume |
| `recovery-required` | module/workspace | activation-pending 或明确阶段 | resume/rollback/restore |

模块可以新增稳定子 code，但必须映射到 scope、dataEffect、affectedCapabilities 和 resolution。原始异常文本仅用于 diagnosticRef，不作为调用方分支。

### 9.2 Workspace mode 计算

1. 若 DATA/Restore 报 activation-pending、活动数据不可读或无法判定兼容性 → `recovery`。
2. 否则若 DATA 可读但不可安全写 → `read-only`。
3. 否则若任一已交付/已启用外围模块 degraded/unavailable/recovering → `limited`。
4. 否则 → `ready`。

disabled-by-user 的 ATTEND 不使 Workspace limited。备份目的地未配置也不使 Workspace limited；配置后失败使 PROTECT degraded/Workspace limited，但本地保存仍 ready-capable。

### 9.3 读取降级规则

- 核心 PLAN query：成功 current、明确 stale 或失败；不得以空替代失败。
- 可选投影片段：available、unavailable(problem) 或 explicitly-stale(data, verified revision, problem)。
- 旧索引/结果只有在 UI 清楚标注未验证/过期时可以保留上下文；用户不得据此执行需要 verified/current 的动作。
- unknown 是合法数据状态，unavailable 是计算/访问失败；两者不得互换。

### 9.4 写入降级规则

- 对 unavailable capability 的命令返回 feature-disabled/unavailable，dataEffect unchanged；
- read-only Workspace 拒绝所有正式命令，但允许 query、草稿本地保留策略、恢复/导出能力；
- recovery Workspace 只允许 OperationHandle 声明的 resume/rollback/restore/diagnostic 动作；
- pending follow-up 不阻止无关核心命令，但影响相关 capability 的完成状态。

## 10. 测试义务

`TEST-*` 是逻辑证据 ID，不预先规定测试框架或文件名。一个测试可以满足多个义务，但报告必须能按 ID 定位结果。

### 10.1 SHELL 与 WORKSPACE

| ID | 必须证明 |
|---|---|
| `TEST-SHELL-001` | 每个空、unknown、unavailable、stale、problem 和 Operation state 有文字原因、dataEffect 与下一步 |
| `TEST-SHELL-002` | 所有核心旅程可键盘完成；焦点不被顶栏/抽屉/Toast 遮挡；状态消息可感知 |
| `TEST-SHELL-003` | not-committed/conflict/decision-required 保留输入；committed 后才更新正式状态；Undo Toast 语义正确 |
| `TEST-SHELL-004` | 23 个正式页面/表面只使用 Workspace 投影和命令，不包含独立领域公式 |
| `TEST-WORKSPACE-001` | 每个复合 Envelope 使用单一 revision/EvaluationContext，跨页面结果一致 |
| `TEST-WORKSPACE-002` | CommandId 幂等、entity conflict、preview token 过期、recoverability 声明和 UndoCapability 一次性 |
| `TEST-WORKSPACE-003` | healthy/degraded/unavailable/recovering 模块组合产生正确 capability、health 与 Workspace mode |
| `TEST-WORKSPACE-004` | welcome/setup/today/recovery 路由、最低设置条件、提前进入、everReachedMinimum、自动归档后 Today 结束状态 |
| `TEST-WORKSPACE-005` | Draft/Operation/follow-up 在所有持久中间态重启后恢复且不重复 |
| `TEST-WORKSPACE-006` | 主事实 committed + pending follow-up 的显示与后续完成/失败不伪造整体结果 |

### 10.2 PLAN

| ID | 必须证明 |
|---|---|
| `TEST-PLAN-001` | Term/Course/Meeting/Task 范围与最多一个 Current Term 不变量 |
| `TEST-PLAN-002` | 正常周、LEC/TUT/PRA code+全称、Course instructor 引用、较短课程/规则范围和时间重叠 warning |
| `TEST-PLAN-003` | HolidayRange 抑制周期课节和 followTeachingWeek 任务，但保留一次性事项 |
| `TEST-PLAN-004` | only-this override 不影响其他实例；this-and-future 分段保留历史 |
| `TEST-PLAN-005` | OccurrenceId 在重算、视图、重启与不改变逻辑实例的编辑后稳定 |
| `TEST-PLAN-006` | date-only/timed/TBA、逾期/今天/未来/完成分类，weekly 确认范围及 next small/large 候选/排序规则 |
| `TEST-PLAN-007` | TermZone 跨日、DST、启用日、date-only 日末和自动归档边界 |
| `TEST-PLAN-008` | Today/Week/Calendar/Agenda/TBA 对同一 revision 的实例、Today 明细/计数、学期进度与假期连续片段一致 |

### 10.3 ATTEND

| ID | 必须证明 |
|---|---|
| `TEST-ATTEND-001` | 默认关闭、当天启用不回溯、关闭保留、再次启用不补关闭期 |
| `TEST-ATTEND-002` | attended/missed/unmarked 更正，取消/假期/未来实例资格 |
| `TEST-ATTEND-003` | 出席率、覆盖率、分母为零 unknown 和 Today overlay 公式 |
| `TEST-ATTEND-004` | ATTEND 保存/统计/整个模块失败时 PLAN 核心旅程继续 |

### 10.4 LIBRARY

| ID | 必须证明 |
|---|---|
| `TEST-LIBRARY-001` | 根目录创建/更换、三位置不重叠、不可写和恢复原 root |
| `TEST-LIBRARY-002` | planned/disk-applied/index-committed 每个 failpoint 与重启恢复 |
| `TEST-LIBRARY-003` | 应用复制导入、外部放入/移动、关闭期间变化和重新扫描 |
| `TEST-LIBRARY-004` | 同名 keep-both/replace/cancel、删除/移动失败不伪成功 |
| `TEST-LIBRARY-005` | 五个建议分类、非空分类 move-or-cancel、目录派生标签与 CustomTag 独立、Course 重命名 pending follow-up |
| `TEST-LIBRARY-006` | 权限丢失、unverified 索引、reauthorize/reconcile 和其他模块继续 |
| `TEST-LIBRARY-007` | 任意类型保存，PDF/PNG/JPEG/WebP/纯文本预览，其他类型 system-open/reveal，stamp 失效阻止访问 |

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
| `TEST-PROTECT-001` | 未配置目录合法；配置目录验证与三位置隔离 |
| `TEST-PROTECT-002` | backup watermark 持久、请求合并、临时写/验证/发布顺序 |
| `TEST-PROTECT-003` | 目的地不可写/备份失败保留本地成功、旧快照、最后成功与 pending |
| `TEST-PROTECT-004` | 损坏/不兼容快照在激活前停止，原数据 unchanged |
| `TEST-PROTECT-005` | Restore 每个阶段中断、重启继续/回滚、无部分成功 |
| `TEST-PROTECT-006` | B 已交付时 snapshot/restore 文件与课程/分类/自定义标签映射一致 |
| `TEST-DATA-001` | commit 每阶段 failpoint：全成或全不成，revision/receipt/follow-up 一致 |
| `TEST-DATA-002` | 同 CommandId 重放返回同结果；不同 payload 复用被拒绝 |
| `TEST-DATA-003` | expected entity conflict、并发 ReadSnapshot 和不混 revision |
| `TEST-DATA-004` | PostCommitChange 丢失/重复时 DurableFollowUp 仍完成一次 |
| `TEST-DATA-005` | 可读不可写进入 read-only；不可读/损坏进入 recovery，不自动重置 |
| `TEST-DATA-006` | 格式版本、未知新版本、export/stage/activation/rollback 跨重启 |

### 10.7 PLATFORM、跨 FLOW 与产品环境

| ID | 必须证明 |
|---|---|
| `TEST-PLATFORM-001` | macOS/Windows Clock/ZoneRules 通过同一日期/DST conformance |
| `TEST-PLATFORM-002` | 两平台文件权限、路径、选择器取消、Watcher hint 语义一致 |
| `TEST-PLATFORM-003` | 两平台支持类型 preview、其他类型 system-open/reveal，错误映射稳定 |
| `TEST-PLATFORM-004` | 禁网运行全部 MVP-A 核心旅程，应用不要求账户/远程/AI |
| `TEST-FLOW-00-LIFECYCLE` | 新建、未完成设置、重启、自动归档后不退回首次设置、历史与空白新学期路由 |
| `TEST-FLOW-01-COMMIT` | preview/confirm/commit/undo/conflict/follow-up 的完整数据效果 |
| `TEST-FLOW-02-UNIFIED-PLAN` | 多视图同源、Reading Week、TBA 和 ATTEND 降级 |
| `TEST-FLOW-03-LIBRARY-RECOVERY` | 根、扫描、变更、disk-applied 中断、对账与受验证访问 |
| `TEST-FLOW-04-BACKUP-FAILURE` | 本地成功/备份失败、旧快照、水位、重试和重启 |
| `TEST-FLOW-05-RESTORE-RECOVERY` | 损坏候选、预览过期、stage/activation 中断、继续/回滚 |
| `TEST-FLOW-06-DERIVED-RESULTS` | ATTEND/GRADE 来源、coverage、unknown、stale 与隔离 |
| `TEST-USABILITY-001` | 首次用户约 20 分钟完成参考最低设置，可提前进入并继续 |

### 10.8 Q → Test evidence

| Q | 最小证据集合 |
|---|---|
| `Q-TRUTH-01` | DATA-001/002、LIBRARY-002/004、PROTECT-002–005 |
| `Q-CONSIST-01` | WORKSPACE-001、PLAN-008、FLOW-02 |
| `Q-TIME-01` | PLAN-003/006/007、ATTEND-001–003、PLATFORM-001 |
| `Q-STATE-01` | SHELL-001、PLAN-006、ATTEND-002/003、GRADE-001/002 |
| `Q-PROTECT-01` | LIBRARY-001、PROTECT-001–006、FLOW-05 |
| `Q-ISOLATE-01` | WORKSPACE-003、ATTEND-004、LIBRARY-006、PROTECT-003 |
| `Q-LOCAL-01` | PLATFORM-004、FLOW-00/04/05 的无网络变体 |
| `Q-PROVENANCE-01` | GRADE-003–007、FLOW-06 |
| `Q-ACCESS-01` | SHELL-001–004、两个平台核心 E2E |
| `Q-PORTABLE-01` | PLATFORM-001–003、所有已交付模块的 macOS/Windows E2E |
| `Q-RESPOND-01` | FLOW-00 不等待、窗口化 PLAN query、LIBRARY/PROTECT OperationHandle 契约测试 |
| `Q-EVOLVE-01` | DATA-006、PROTECT-004/005、GRADE-004 |
| `Q-USABILITY-01` | USABILITY-001、WORKSPACE-004 |
| `Q-CONTINUITY-01` | WORKSPACE-005、LIBRARY-002、PROTECT-002/005、DATA-004/006 |
| `Q-DIAG-01` | SHELL-001/003、WORKSPACE-003/006、全部 failpoint 的 Problem/dataEffect 断言 |

## 11. 完整追溯矩阵

### 11.1 当前功能需求（71）

为保持密集矩阵可读，§11 的 TEST 列允许省略共同前缀：例如 `PLAN-001/007` 精确展开为 `TEST-PLAN-001` 与 `TEST-PLAN-007`。roadmap、backlog、测试报告和 Agent 工作包必须使用 §10 定义的完整 `TEST-*` ID。

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
| `A-DATA-004` | PROTECT / DATA / LIBRARY | IF-DURABLE-FOLLOWUP、IF-BACKUP-CHECKPOINT | 01、03、04 | TRUTH、PROTECT、RESPOND、CONTINUITY | PROTECT-002/003、DATA-004、FLOW-04 |
| `A-DATA-005` | PROTECT / DATA / LIBRARY | IF-RESTORE-SESSION | 05 | TRUTH、PROTECT、EVOLVE、CONTINUITY | PROTECT-004–006、DATA-006、FLOW-05 |
| `A-DATA-006` | PROTECT / WORKSPACE | IF-RESTORE-SESSION、IF-IMPACT-PREVIEW | 05 | PROTECT、DIAG | PROTECT-004/005、FLOW-05 |
| `A-PLATFORM-001` | PLATFORM / all shipped modules | IF-CLOCK/ZONE/FILESYSTEM/CHOOSER/SYSTEM-OPEN | 00–06 | PORTABLE、ACCESS、LOCAL | PLATFORM-001–004、G6 |
| `A-ATTEND-001` | ATTEND / WORKSPACE | IF-ATTEND-COMMAND/QUERY | 00、01、06 | TIME、STATE、CONTINUITY | ATTEND-001、WORKSPACE-004 |
| `A-ATTEND-002–003` | ATTEND | IF-ATTEND-COMMAND/QUERY | 01、02 | STATE、TRUTH | ATTEND-001/002 |
| `A-ATTEND-004–005` | ATTEND / PLAN / WORKSPACE | IF-ATTEND-QUERY | 02、06 | STATE、TIME、PROVENANCE | ATTEND-003、FLOW-06 |
| `A-ATTEND-006` | ATTEND / DATA / PROTECT / WORKSPACE | IF-ATTEND-*、IF-DATA-COMMIT | 01、04、06 | ISOLATE、TRUTH | ATTEND-004、WORKSPACE-003 |
| `B-FILE-001` | LIBRARY / PLATFORM / WORKSPACE | IF-LIBRARY-COMMAND、IF-IMPACT-PREVIEW | 03 | PROTECT、PORTABLE、DIAG | LIBRARY-001、FLOW-03 |
| `B-FILE-002–003` | LIBRARY / PLAN refs | IF-LIBRARY-COMMAND/IMPACT | 01、03 | TRUTH、CONTINUITY | LIBRARY-005、WORKSPACE-006 |
| `B-FILE-004–005` | LIBRARY / PLATFORM | IF-FILE-OPERATION、IF-WATCHER | 03 | TRUTH、RESPOND、PORTABLE | LIBRARY-002/003、FLOW-03 |
| `B-FILE-006–008` | LIBRARY | IF-LIBRARY-COMMAND/QUERY | 03 | CONSIST、STATE | LIBRARY-003/005/006 |
| `B-FILE-009–011` | LIBRARY / PLATFORM / SHELL | IF-FILE-OPERATION、IF-LIBRARY-RESOURCE | 03 | TRUTH、PROTECT、ACCESS、DIAG | LIBRARY-002/004/007、SHELL-003 |
| `B-FILE-012` | LIBRARY / PROTECT | IF-LIBRARY-MANIFEST、IF-BACKUP-CHECKPOINT、IF-RESTORE-SESSION | 04、05 | PROTECT、EVOLVE | PROTECT-006、FLOW-04/05 |
| `B-FILE-013` | LIBRARY | IF-LIBRARY-COMMAND/QUERY | 03 | PROTECT、DIAG | LIBRARY-001 |
| `C-GRADE-001–004` | GRADE | IF-GRADE-COMMAND/QUERY | 01、06 | STATE、PROVENANCE、TRUTH | GRADE-001/002/005/007 |
| `C-GRADE-005–007` | GRADE | IF-GRADE-COMMAND/QUERY/EXPORT | 01、06 | PROVENANCE、EVOLVE | GRADE-003/004 |
| `C-GRADE-008–009` | GRADE / PLAN refs | IF-GRADE-COMMAND/QUERY | 01、06 | STATE、PROVENANCE | GRADE-005/006 |
| `C-GRADE-010–011` | GRADE | IF-GRADE-QUERY | 06 | PROVENANCE、STATE、DIAG | GRADE-006、FLOW-06 |
| `C-GRADE-012–014` | GRADE | IF-GRADE-COMMAND/QUERY/EXPORT | 01、06 | CONSIST、PROVENANCE、EVOLVE | GRADE-003–007 |

计数：PLAN/View/Calendar 31 + DATA/PLATFORM 7 + ATTEND 6 + FILE 13 + GRADE 14 = 71。C-TARGET-001–007 不计入当前功能覆盖，映射到 `EXT-C2`。

“已覆盖”表示架构边界、接口和证据位置存在，不伪称上游参数已经完整。`A-VIEW-004/005` 的 `near-due` 可由 PLAN 单点实现，但其数值验收在 `GAP-PRODUCT-01` 解决前保持未校准。

### 11.2 共享状态与 NFR（17）

| Requirement | 主要契约 | Q / Gate | TEST |
|---|---|---|---|
| `STATE-001` | IF-WORKSPACE query、IF-STRUCTURED-PROBLEM、MOD-SHELL | Q-STATE、Q-DIAG、G1 | SHELL-001/004 |
| `STATE-002` | CommandOutcome、FileOperation、Backup/Restore、DraftCheckpoint | Q-TRUTH、Q-CONTINUITY、Q-DIAG、G4 | SHELL-003、WORKSPACE-005/006、全部 failpoint |
| `STATE-003` | Deadline/Weight/Score 状态类型 | Q-STATE、G3 | PLAN-006、GRADE-001/002 |
| `STATE-004` | IF-IMPACT-PREVIEW、规则分段 | Q-PROTECT、Q-DIAG、G3 | PLAN-004、WORKSPACE-002 |
| `STATE-005` | ResultSource、GradeProjection | Q-PROVENANCE、G3 | GRADE-005/006 |
| `STATE-006` | Attendance 状态枚举与统计 | Q-STATE、Q-ISOLATE、G3/G5 | ATTEND-001–004 |
| `NFR-001` | MOD-DATA/PROTECT/PLATFORM、无远程业务依赖 | Q-LOCAL、G6 | PLATFORM-004 |
| `NFR-002` | IF-DATA-COMMIT、IF-FILE-OPERATION、IF-RESTORE-SESSION | Q-TRUTH、G4 | DATA-001、LIBRARY-002、PROTECT-005 |
| `NFR-003` | 三位置边界、BackupCheckpoint/Manifest | Q-PROTECT、G4 | LIBRARY-001、PROTECT-001/002/006 |
| `NFR-004` | TermZone、Clock/ZoneRules、PLAN evaluator | Q-TIME、G3/G6 | PLAN-007、PLATFORM-001 |
| `NFR-005` | 显式未知状态 | Q-STATE、G3 | SHELL-001、PLAN-006、GRADE-001/002 |
| `NFR-006` | MOD-SHELL 呈现契约 | Q-ACCESS、G6 | SHELL-001–004 |
| `NFR-007` | IF-IMPACT-PREVIEW、Undo/恢复协议 | Q-PROTECT、G3/G4 | WORKSPACE-002、PLAN-004、FLOW-05 |
| `NFR-008` | GradeProjection/EXT-C2 输出契约 | Q-PROVENANCE、G3 | GRADE-003–007 |
| `NFR-009` | PLAN 单一 evaluator、RevisionEnvelope | Q-CONSIST、G2/G3 | PLAN-008、WORKSPACE-001、FLOW-02 |
| `NFR-010` | LIBRARY/PLATFORM degradation | Q-ISOLATE、Q-DIAG、G5/G6 | LIBRARY-006、WORKSPACE-003 |
| `NFR-011` | ATTEND 窗口、记录与 fallback | Q-ISOLATE、Q-STATE、G5 | ATTEND-001–004 |

### 11.3 完成定义（12）

| Requirement | 证据路径 |
|---|---|
| `MVP-DOD-001` | Q-USABILITY；TEST-USABILITY-001、WORKSPACE-004 |
| `MVP-DOD-002` | FLOW-02；TEST-WORKSPACE-001、PLAN-008 |
| `MVP-DOD-003` | TEST-PLAN-003/008、FLOW-02 |
| `MVP-DOD-004` | TEST-PLAN-004/005、FLOW-01/02 |
| `MVP-DOD-005` | Q-LOCAL/Q-CONTINUITY；TEST-WORKSPACE-005、DATA-006、PLATFORM-004 |
| `MVP-DOD-006` | Q-TRUTH/Q-PROTECT；TEST-DATA-001、PROTECT-003–005、LIBRARY-002 |
| `MVP-DOD-007` | Q-PORTABLE、G6；TEST-PLATFORM-001–003 和两平台核心 E2E |
| `MVP-DOD-008` | Q-LOCAL；TEST-PLATFORM-004 |
| `MVP-A-P-DOD-001` | TEST-ATTEND-001 |
| `MVP-A-P-DOD-002` | TEST-ATTEND-001/002 |
| `MVP-A-P-DOD-003` | TEST-ATTEND-003 |
| `MVP-A-P-DOD-004` | TEST-ATTEND-004、WORKSPACE-003 |

### 11.4 User Flow（9）

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
| `UF-A-P01` 出席 | ATTEND；FLOW-01/02/06 | ATTEND-001–004、FLOW-06 |

### 11.5 UI 表面（23）

所有 UI 表面由 `MOD-SHELL` 拥有，只通过 `IF-WORKSPACE`。下表指定主要 Query/Intent；详细布局仍以 UI 规格为准。

| UI surface | 主要契约 |
|---|---|
| `UI-ENTRY-01` | WorkspaceStatus、InitializeWorkspace、SelectRestoreCandidate |
| `UI-SETUP-01` | SetupProjection、DraftCheckpoint、PLAN intents、RecordSetupDecision |
| `UI-TODAY-01` | TodayProjection、TodayAttendanceOverlay、Task/Attendance intents |
| `UI-COURSE-01`、`UI-COURSE-02` | CourseList/Detail、CourseAttendanceProjection、CourseGradeProjection、Course/Meeting intents |
| `UI-MEETING-01` | MeetingSeriesDetail、PlanImpactProjection、scope intents |
| `UI-TASK-01`、`UI-TASK-02` | TaskList/Detail、Task state/progress/scope intents |
| `UI-REPEAT-01` | TaskSeriesDetail、PlanImpactProjection、series intents |
| `UI-CALENDAR-01`、`UI-CALENDAR-02` | CalendarWindowProjection、AgendaProjection、TbaProjection |
| `UI-FILE-01` | LibraryRootStatus、LibrarySearch、Library intents/OperationStatus |
| `UI-FILE-02` | LibraryFileDetail、accessResource、file intents |
| `UI-FILE-03` | LibraryConflicts、FileOperationStatus、ResolveNameConflict/Reconciliation |
| `UI-GRADE-01` | CurrentTermGradeOverview |
| `UI-GRADE-02` | CourseGradeProjection、Grade intents |
| `UI-GRADE-03` | DraftCheckpoint、RecordScore/ClearScore |
| `UI-GRADE-04` | GradingScheme query/intents、GradeImpactProjection |
| `UI-GRADE-05` | GradeScaleList/Detail、versioning intents |
| `UI-SETTINGS-01` | Workspace/PLAN/ATTEND capability queries and configuration intents |
| `UI-DATA-01` | DataProtectionStatus、backup destination/trigger intents |
| `UI-DATA-02` | SnapshotList/Detail、RestorePreview、RestoreOperationStatus、restore intents |
| `UI-TERM-01` | TermList/Detail、set/archive/restore current intents、PlanImpactProjection |

计数按 UI 规格目录展开为 23 个正式页面/表面。抽屉、模态框和 Toast 是这些表面的交互形态，不建立新的领域模块或数据接口。

### 11.6 非当前范围与未来接缝

下表用于后续文档对齐，不计入当前 71 条功能需求、当前 Gate 或 backlog：

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

- [ ] 71 条当前功能需求全部出现在 §11.1，C2/C3 未计入当前覆盖；
- [ ] 6 条 STATE、11 条 NFR、12 条 DOD、9 条 User Flow 和 23 个 UI 表面全部可追溯；
- [ ] 九个模块都包含 Purpose、Owns、Does not own、Interfaces、Invariants、Problems、Test seams、Trace；
- [ ] 七条 FLOW 都定义 Trigger、步骤、成功边界和失败/降级语义；
- [ ] 15 条 Q 均有 TEST evidence，G1–G7 均可判定；
- [ ] 没有 UI、存储、进程或平台实现类型泄漏到领域接口；
- [ ] 没有具体技术选型、ADR 结论、roadmap、backlog 或未来占位实现；
- [ ] 上游差异已显式记录，未靠架构猜测同时支持互相冲突的产品语义。
- [ ] `GAP-PRODUCT-01` 已由产品文档补值，或被明确标为阻止 A-VIEW-004/005 发布验收。
