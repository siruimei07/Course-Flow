# 模块与 HTTP Interface

本文规定调用者必须知道的 interface：命令、查询、contract、错误和并发语义。实现应围绕这些行为，而不是生成每张表的通用 CRUD。

## 1. Interface 原则

- 命令按用户意图命名，返回业务结果；`updateEntity(data)` 之类无语义方法不进入 core。
- 查询返回只读 snapshot/view model，页面不拼 repository entity。
- ID、当前用户和请求输入都在 transport 边缘校验；core 仍验证所有权与业务不变量。
- 命令不返回数据库模型或 `Response`；HTTP adapter 完成 DTO/状态码映射。
- 远程/存储 port 位于使用它的模块内部；供应商 adapter 实现它，测试用 fake adapter。
- 仅在 web/worker composition root 构造 concrete adapter。

## 2. Core interface 草图

最终类型名可微调，但行为和深度不得被拆成浅层 helper 链。

### 2.1 Academics

```ts
interface AcademicsCommands {
  createTerm(scope: UserScope, input: CreateTerm): Promise<Term>;
  updateTerm(scope: UserScope, input: UpdateTerm): Promise<Term>;
  setActiveTerm(scope: UserScope, termId: TermId): Promise<void>;
  createCourse(scope: UserScope, input: CreateCourse): Promise<Course>;
  updateCourse(scope: UserScope, input: UpdateCourse): Promise<Course>;
  saveCalendarException(
    scope: UserScope,
    input: SaveCalendarException,
  ): Promise<AcademicCalendarException>;
  deleteCalendarException(scope: UserScope, input: DeleteCalendarException): Promise<void>;
  saveMeetingPattern(scope: UserScope, input: SaveMeetingPattern): Promise<MeetingPattern>;
  setMeetingPatternArchived(
    scope: UserScope,
    input: SetMeetingPatternArchived,
  ): Promise<MeetingPattern>;
  setMeetingException(scope: UserScope, input: SetMeetingException): Promise<MeetingException>;
  deleteMeetingException(scope: UserScope, input: DeleteMeetingException): Promise<void>;
  setCourseArchived(scope: UserScope, input: SetCourseArchived): Promise<Course>;
}

interface CourseSetupCommands {
  createCourseWithSchedule(
    scope: UserScope,
    input: CreateCourseWithSchedule,
  ): Promise<CourseSetupView>;
}

interface AcademicsQueries {
  listTerms(scope: UserScope): Promise<TermSummary[]>;
  getCourse(scope: UserScope, courseId: CourseId): Promise<CourseDetail | null>;
  getCourseSetup(scope: UserScope, courseId: CourseId): Promise<CourseSetupView | null>;
}
```

`CourseSetupCommands` 是 academics 模块公开入口的一部分，用一个 transaction 组合课程、课节和所需学期例外引用，供分步表单最终提交；它不是跨模块 workflow engine。`Update*`/`save*` 必须对已有目标携带 `expectedVersion`。`timeZone` 接受 IANA zone；学期范围、课节本地起止时间和例外 target 非法返回 validation error，且不把课节规则复制进 Course entity。

### 2.2 Planning

```ts
interface PlanningCommands {
  createCourseItem(scope: UserScope, input: CreateCourseItem): Promise<CourseItem>;
  updateCourseItem(scope: UserScope, input: UpdateCourseItem): Promise<CourseItem>;
  setCourseItemState(scope: UserScope, input: SetCourseItemState): Promise<CourseItem>;
  deleteCourseItem(scope: UserScope, input: DeleteCourseItem): Promise<void>;
  saveGradingScheme(scope: UserScope, input: SaveGradingScheme): Promise<GradingScheme>;
  saveGradeResult(scope: UserScope, input: SaveGradeResult): Promise<GradeResult>;
  deleteGradeResult(scope: UserScope, input: DeleteGradeResult): Promise<void>;
  saveLetterGradeScale(scope: UserScope, input: SaveLetterGradeScale): Promise<LetterGradeScale>;
  saveTaskLabel(scope: UserScope, input: SaveTaskLabel): Promise<TaskLabel>;
  deleteTaskLabel(scope: UserScope, input: DeleteTaskLabel): Promise<void>;
  setCourseItemLabels(scope: UserScope, input: SetCourseItemLabels): Promise<CourseItem>;
  applyReviewedCandidate(
    tx: TransactionContext,
    input: ReviewedCandidateApplication,
  ): Promise<AppliedRecords>;
}

interface PlanningQueries {
  getCoursePlanning(scope: UserScope, courseId: CourseId): Promise<CoursePlanningDetail>;
  getGradebook(scope: UserScope, courseId: CourseId): Promise<GradebookSnapshot>;
}
```

`applyReviewedCandidate` 只在 Ingestion 的审核 transaction 中调用，不暴露到 HTTP。输入明确 `create` 或 `update_existing(targetId, expectedVersion)`；它重新执行与手工命令相同的日期、评分、目标兼容性和所有权规则。

`GradebookSnapshot` 同时返回 `earnedCourseBps`（已获总评百分点）、`gradedPortionPercentBps`、`gradedWeightBps`、未知权重/未出分计数与可选 `currentLetter`；`currentLetter` 只按 graded portion 换算并且不能脱离覆盖权重单独显示。`CourseItem.progressBps` 是行动进度，不进入 Gradebook。

### 2.3 Ingestion

见 [导入流水线](./INGESTION.md)。额外 query：

```ts
interface IngestionQueries {
  listSources(scope: UserScope, query: SourceLibraryQuery): Promise<SourceLibrarySnapshot>;
  listCourseSources(scope: UserScope, courseId: CourseId): Promise<SourceSummary[]>;
  getImportRun(scope: UserScope, runId: ImportRunId): Promise<ImportRunView | null>;
  getImportReview(scope: UserScope, runId: ImportRunId): Promise<ImportReviewView | null>;
}
```

### 2.4 Schedule

```ts
interface ScheduleQueries {
  getDashboard(scope: UserScope, query: DashboardQuery): Promise<DashboardSnapshot>;
  getTodaySchedule(scope: UserScope, query: TodayScheduleQuery): Promise<TodayScheduleSnapshot>;
  getTaskBoard(scope: UserScope, query: TaskBoardQuery): Promise<TaskBoardSnapshot>;
  getCourseTimeline(scope: UserScope, query: CourseTimelineQuery): Promise<CourseTimeline>;
  getCalendar(scope: UserScope, query: CalendarQuery): Promise<CalendarSnapshot>;
  exportCalendar(scope: UserScope, query: CalendarQuery): Promise<CalendarFile>;
}
```

所有输出带 `generatedAt`、显示 `timeZone` 和相关 `policyVersions`。`DashboardSnapshot`/`CalendarSnapshot` 的课节实例由 academics 的正式 `MeetingPattern`、校历例外和单次例外统一展开；`termProgress` 同时返回状态、百分比、教学周编号和当前例外；`nextMeeting` 返回目标 instant、状态和地点，客户端不得另选“下一节”。查询范围有限制，例如 dashboard 最长一学期、任意自定义范围不超过配置上限。

### 2.5 Insights

```ts
type Insight = {
  key: string;
  titleKey: string;
  descriptionKey: string;
  value: InsightValue;
  definitionKey: string;
  dataQuality: "complete" | "partial" | "insufficient";
};

interface InsightQueries {
  getTermInsights(scope: UserScope, termId: TermId): Promise<Insight[]>;
}
```

首版可以返回空数组和 `insufficient` 页面状态。新增 Insight 是在代码中添加一个纯计算器及测试，并由显式 registry 组合；不执行存储在数据库中的代码/SQL，也不建立动态插件系统。

## 3. HTTP 约定

基础路径 `/api/v1`。浏览器使用 same-origin session cookie；所有 mutation 要有 CSRF 防护（框架/同源策略加显式 Origin 校验），不接受客户端传 `userId`。

### 3.1 资源与命令端点

| 方法与路径                                                  | 用途                                | 成功响应                         |
| ----------------------------------------------------------- | ----------------------------------- | -------------------------------- |
| `GET /terms`                                                | 学期列表                            | `200 { data: TermSummary[] }`    |
| `POST /terms`                                               | 创建学期                            | `201 { data: TermView }`         |
| `PATCH /terms/:termId`                                      | 带 version 修改                     | `200`                            |
| `PUT /profile/active-term`                                  | 设置当前学期                        | `204`                            |
| `POST /courses`                                             | 创建课程                            | `201`                            |
| `POST /course-setups`                                       | 原子创建课程及零到多个课节          | `201`                            |
| `GET /courses/:courseId`                                    | 课程详情                            | `200`                            |
| `PATCH /courses/:courseId`                                  | 修改课程                            | `200`                            |
| `POST /terms/:termId/calendar-exceptions`                   | 新增 Reading Week 等校历例外        | `201`                            |
| `PUT /terms/:termId/calendar-exceptions/:exceptionId`       | 带 version 修改例外                 | `200`                            |
| `DELETE /terms/:termId/calendar-exceptions/:exceptionId`    | 带影响预览删除校历例外              | `204`                            |
| `POST /courses/:courseId/meeting-patterns`                  | 新增 Lecture/TUT/PRA 课节           | `201`                            |
| `PUT /courses/:courseId/meeting-patterns/:patternId`        | 带 version 修改课节                 | `200`                            |
| `DELETE /courses/:courseId/meeting-patterns/:patternId`     | 归档课节规则                        | `204`                            |
| `PUT /meeting-patterns/:patternId/exceptions/:localDate`    | 取消、改期或显式保留一次课          | `200`                            |
| `DELETE /meeting-patterns/:patternId/exceptions/:localDate` | 删除单次覆盖、恢复派生规则          | `204`                            |
| `POST /courses/:courseId/items`                             | 手工新增事项                        | `201`                            |
| `PATCH /course-items/:itemId`                               | 修改事项                            | `200`                            |
| `DELETE /course-items/:itemId`                              | 软删除事项                          | `204`                            |
| `POST /courses/:courseId/grading-schemes`                   | 创建完整评分 aggregate              | `201`                            |
| `PUT /courses/:courseId/grading-schemes/:schemeId`          | 带 version 替换评分 aggregate       | `200`                            |
| `PUT /grade-components/:componentId/result`                 | 手工新增/替换出分结果               | `200/201`                        |
| `DELETE /grade-components/:componentId/result`              | 删除误录结果，使其恢复未知          | `204`                            |
| `PUT /profile/letter-grade-scales/:scaleId`                 | 保存 A/B/C/D/F 边界                 | `200/201`                        |
| `POST /terms/:termId/task-labels`                           | 创建自定义任务标签                  | `201`                            |
| `DELETE /task-labels/:labelId`                              | 删除标签并移除关联，不删除事项      | `204`                            |
| `PUT /course-items/:itemId/labels`                          | 原子替换事项标签集合                | `200`                            |
| `POST /courses/:courseId/source-uploads`                    | 获取上传计划                        | `201`                            |
| `POST /source-documents/:sourceId/complete`                 | 完成上传并排队                      | `202 { data: ImportRunSummary }` |
| `POST /source-documents/:sourceId/retry`                    | 新建重试 run                        | `202`                            |
| `DELETE /source-documents/:sourceId`                        | 取消活动 run、撤销预览并排队清理    | `202/204`                        |
| `GET /import-runs/:runId`                                   | 轻量进度轮询                        | `200`，支持 ETag                 |
| `POST /import-runs/:runId/cancel`                           | 请求在安全检查点取消                | `202`                            |
| `GET /import-runs/:runId/review`                            | 候选审核模型                        | `200`                            |
| `PUT /candidates/:candidateId/decision`                     | 幂等提交审核决定                    | `200/201`                        |
| `GET /dashboard?termId=...`                                 | 雷达 snapshot                       | `200`                            |
| `GET /calendar?termId=...`                                  | 日历 snapshot                       | `200`                            |
| `GET /tasks?termId=...`                                     | 短期/中长期任务 snapshot 与标签筛选 | `200`                            |
| `GET /courses/:courseId/gradebook`                          | 评分组成、结果与覆盖口径            | `200`                            |
| `GET /calendar/export.ics?...`                              | ICS                                 | `200 text/calendar`              |
| `GET /terms/:termId/insights`                               | 统计洞察                            | `200`                            |

Next.js Server Components 可以在进程内直接调用相同 query interface，避免自请求 HTTP；Client Component、上传和外部集成使用上述 contract。两条路径必须共享同一 mapper/schema，不能返回两种页面模型。

### 3.2 JSON 形状

成功：

```json
{
  "data": {},
  "meta": {
    "requestId": "req_opaque"
  }
}
```

失败遵循 Problem Details 风格：

```json
{
  "type": "https://courseflow.local/problems/validation",
  "title": "提交内容无效",
  "status": 422,
  "code": "VALIDATION_FAILED",
  "detail": "请检查标出的字段。",
  "requestId": "req_opaque",
  "errors": [{ "path": "/temporal/date", "code": "INVALID_LOCAL_DATE", "message": "日期不存在。" }]
}
```

- `code` 稳定、可供前端分支；`message/detail` 可本地化，不作为逻辑条件。
- `errors.path` 使用 JSON Pointer。
- 生产响应不含 stack、SQL、对象键、供应商错误正文或模型 prompt。

### 3.3 状态码映射

| 领域结果                 | HTTP                                                 |
| ------------------------ | ---------------------------------------------------- |
| 未认证                   | `401`                                                |
| 已认证但无权访问         | 对私有 ID 默认 `404`，避免枚举；明确权限操作才 `403` |
| 不存在                   | `404`                                                |
| schema/领域输入无效      | `422`                                                |
| version/idempotency 冲突 | `409`                                                |
| 上传过大                 | `413`                                                |
| MIME 不支持              | `415`                                                |
| 限流                     | `429` + `Retry-After`                                |
| 外部依赖暂不可用         | 同步入口 `503`；异步导入通常记录 run failure/retry   |

## 4. 日期 Contract

JSON 不用一个含糊 `dueDate`：

```json
{ "kind": "unscheduled", "note": "Week 6; exact date TBA" }
```

```json
{ "kind": "date", "date": "2026-10-10", "note": null }
```

```json
{
  "kind": "deadline",
  "at": "2026-10-11T03:59:00Z",
  "timeZone": "America/Toronto",
  "note": "Due 11:59 PM local course time"
}
```

```json
{
  "kind": "interval",
  "startsAt": "2026-10-10T17:00:00Z",
  "endsAt": "2026-10-10T19:00:00Z",
  "timeZone": "America/Toronto",
  "note": null
}
```

LocalDate 必须是严格 Gregorian `YYYY-MM-DD`；instant 必须含 offset，server 规范化为 UTC `Z` 输出。view model 可额外返回已格式化标签，但标签不是可回传真相。

## 5. 幂等与并发

- 创建上传、完成上传、审核决定等重试敏感 mutation 接受 `Idempotency-Key` header；作用域为 `(user, endpoint intent)`，服务端保存 request hash 和 response 摘要。
- 同 key 不同 body 返回 `409 IDEMPOTENCY_MISMATCH`。
- 可变实体 update body 含 `expectedVersion`；成功后版本 +1。
- 表单得到 `409 VERSION_CONFLICT` 时保留用户输入，显示服务端最新版本并让用户决定覆盖/合并；不能静默 last-write-wins。
- background job 通过 run state 和 artifact unique key 保持幂等，不依赖 HTTP idempotency 表。

## 6. 列表、筛选与缓存

- 列表使用 opaque cursor，不用 offset；稳定排序如 `(createdAt desc, id desc)`。
- `limit` 默认 25、最大 100。页面需要“全部当前学期事项”时使用有界 term snapshot，而不是无限列表。
- 私有响应默认 `Cache-Control: private, no-store`。Server Component 可按用户/term 做短生命周期缓存，但 mutation 必须按 tag 精确失效。
- ImportRun 轻量轮询返回 `ETag`；`If-None-Match` 未变化时 `304`。
- 所有日期范围、course IDs 和 include flags 通过 Zod 白名单，禁止把 query 参数直接拼入 SQL。

## 7. ICS Interface

`schedule.exportCalendar` 先构建中立 `CalendarEvent[]`，ICS adapter 只负责序列化：

- `UID` 从 stable Course Item ID 和应用域生成，重复导出不变。
- 课节实例可按导出筛选包含，UID 从 Meeting Pattern ID + 原 occurrence date 生成；Reading Week/取消实例不导出，改期沿用原 occurrence UID。
- `DTSTAMP` 是生成时刻；`LAST-MODIFIED` 来自事项 `updated_at`。
- `SEQUENCE` 使用正式记录 version，便于兼容客户端识别更新。
- `date` 使用 `VALUE=DATE` 且 `DTEND` 为次日（非 inclusive）。
- `deadline` 在 MVP 导出为带 `DTSTART=dueAt`、不含 `DTEND` 的零时长 VEVENT，标题前缀为本地化的“截止”；不虚构占用时长。
- `interval` 导出起止 instant/时区。
- exact instant/interval 默认用 UTC `...Z` 序列化，避免不完整 `VTIMEZONE`；说明中保留 CourseFlow 显示时区。若未来改用 `TZID`，serializer 必须同时生成正确 `VTIMEZONE` 并新增跨客户端 golden tests。
- cancelled/deleted 不进入普通下载；未来订阅 feed 需要用 `STATUS:CANCELLED` 传播删除时另立 contract。
- `unscheduled` 跳过，export summary 返回 skipped 数量和原因；下载页面先提示。
- 文本按 RFC 5545 转义和折行，防止内容注入破坏文件。
- MVP 不写 `VALARM`；以后加入默认提醒时必须由用户设置驱动并更新 export contract。

MVP 提供授权后即时 `.ics` 下载，不提供带长期秘密 URL 的订阅 feed。

## 8. Contract 演进

- `/api/v1` 内新增可选 response 字段是兼容变更；删除、改义或变更 union 需要新版本/迁移期。
- Zod schema 与导出的 TypeScript DTO 在 `packages/contracts` 为单一来源。
- 数据库 entity、AI schema 和 HTTP schema 是三个不同层次，使用明确 mapper；不把一个 Zod object 到处复用。
- contract tests 固定关键示例：所有 temporal variant、problem response、review decision、dashboard snapshot、ICS golden file。
