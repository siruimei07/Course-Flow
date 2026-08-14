# 模块与 HTTP Interface

本文定义 P4 `MANUAL_ONLY` 发布面的模块调用与传输约定。页面、Route Handler 和 adapter 都只能经过模块公开入口；数据库实体不是 interface。

## 1. Interface 原则

- command 接收 `UserScope`、显式 input、可选 idempotency key 与 expected version。
- query 返回页面需要的 view model/snapshot，不暴露数据库 row 或 storage credential。
- 所有跨 owner ID 都在 repository/core 边界拒绝；不存在无 scope 的查找。
- 时间、成绩、负荷和冲突规则在 core；Route Handler 只做 auth、parse、invoke、error mapping。
- P4 发布面没有远程模型、自动解析、候选审核或助手 interface。

## 2. Core interface

### 2.1 Academics

```ts
interface AcademicsService {
  createTerm(scope: UserScope, input: CreateTermInput): Promise<TermView>;
  updateTerm(scope: UserScope, input: UpdateTermInput): Promise<TermView>;
  setActiveTerm(scope: UserScope, termId: TermId): Promise<void>;
  createCourseSetup(scope: UserScope, input: CreateCourseSetupInput): Promise<CourseView>;
  saveMeetingException(scope: UserScope, input: SaveMeetingExceptionInput): Promise<void>;
}
```

### 2.2 Planning

```ts
interface PlanningService {
  createCourseItem(scope: UserScope, input: CreateCourseItemInput): Promise<CourseItemView>;
  updateCourseItem(scope: UserScope, input: UpdateCourseItemInput): Promise<CourseItemView>;
  setCourseItemState(scope: UserScope, input: SetCourseItemStateInput): Promise<CourseItemView>;
  saveTaskLabel(scope: UserScope, input: SaveTaskLabelInput): Promise<TaskLabelView>;
  saveGradingScheme(scope: UserScope, input: SaveGradingSchemeInput): Promise<GradebookView>;
  saveGradeResult(scope: UserScope, input: SaveGradeResultInput): Promise<GradebookView>;
}
```

### 2.3 Sources

```ts
interface SourcesService {
  beginUpload(scope: UserScope, input: BeginSourceUploadInput): Promise<SourceUploadGrant>;
  completeUpload(
    scope: UserScope,
    sourceId: SourceDocumentId,
    expectedVersion: number,
  ): Promise<SourceView>;
  listSources(scope: UserScope, filter: SourceFilter): Promise<SourceView[]>;
  getPreview(scope: UserScope, sourceId: SourceDocumentId, assetId: SourceAssetId): Promise<Preview>;
  deleteSource(
    scope: UserScope,
    sourceId: SourceDocumentId,
    expectedVersion: number,
  ): Promise<void>;
}
```

`completeUpload` 只让原文进入 ready，不创建或修改课程事实。用户在预览旁打开已有 Planning/Academics 表单，并通过对应 command 提交。

### 2.4 Schedule

```ts
interface ScheduleQueryService {
  getDashboard(scope: UserScope, query: ScheduleQuery): Promise<DashboardSnapshot>;
  getTaskBoard(scope: UserScope, query: TaskBoardQuery): Promise<TaskBoardSnapshot>;
  getCalendar(scope: UserScope, query: CalendarQuery): Promise<CalendarSnapshot>;
  exportCalendar(scope: UserScope, query: CalendarQuery): Promise<CalendarExport>;
}
```

这些 query 消费相同正式 snapshot/policy；页面不能分别重算课节、Reading Week、任务分组或冲突。

### 2.5 Insights

只有指标定义包含输入范围、公式、最小数据量、质量说明与版本后，才通过 `getInsights(scope, query)` 暴露。未定义指标返回稳定空状态，不返回 fixture。

## 3. HTTP 约定

- JSON API 位于 `/api/v1`；页面 server query 可直接调用 composition 中的 core service。
- mutation 使用明确资源/命令名、`Content-Type: application/json`、CSRF/same-origin 防护和 request ID。
- 上传分 begin/complete 两步；文件正文通过私有 object storage 授权传输。
- 私有响应默认 `Cache-Control: private, no-store`；Source 预览还设置 `X-Content-Type-Options: nosniff` 与安全 disposition。
- 所有 schema 在 `packages/contracts` 以 Zod 为单一来源；未知字段按 contract 明确 strip 或 reject。

推荐资源：

```text
POST   /api/v1/terms
POST   /api/v1/courses
POST   /api/v1/course-items
PATCH  /api/v1/course-items/:itemId
POST   /api/v1/sources/uploads
POST   /api/v1/sources/:sourceId/complete
GET    /api/v1/sources/:sourceId/assets/:assetId/preview
DELETE /api/v1/sources/:sourceId
GET    /api/v1/calendar/export.ics
```

实现可以在 Server Action/Route Handler 间调整，但公开 contract、auth、version 与错误语义保持一致。

## 4. JSON 与错误

成功响应使用 `{ data, meta? }`；问题响应使用稳定 problem shape：

```ts
type Problem = {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  requestId: string;
};
```

映射基线：

- 400：JSON/字段/领域输入非法。
- 401：未认证。
- 403：已认证但无 owner 权限；不得泄露资源存在性时可返回 404。
- 404：当前 scope 看不到资源。
- 409：expected version、idempotency hash 或唯一约束冲突。
- 413/415/422：文件容量、类型或内容签名不符合上传 contract。
- 429：明确限流；安全 mutation 不无限重试。
- 500/503：未知内部或依赖失败，响应不含堆栈、存储 URL 或正文。

## 5. 日期 Contract

- 纯日期用 `YYYY-MM-DD`；不能序列化成午夜 instant。
- instant 用带 offset ISO 8601；显示时另带 IANA zone。
- interval 明确 start/end；deadline 只有一个 due instant。
- server snapshot 带 `generatedAt` 与 policy version，客户端倒计时只做显示并定期以 server truth 校正。
- query range 有上限；所有日期由 Zod 和 core 双重校验。

## 6. 幂等、并发、列表与缓存

- create/complete/delete 等关键 mutation 接受 idempotency key；相同 key + 不同 request hash 返回 409。
- update/delete 使用 expected version；失败不覆盖其他标签页的更新。
- 列表默认稳定排序和有界 limit；游标包含排序键与 ID。
- private server snapshot 可短时缓存，key 包含 owner、term、range 与 policy/source versions；mutation 精确失效。
- Source preview 与包含个人计划的响应不进入共享缓存。

## 7. ICS Interface

`schedule.exportCalendar` 先构建中立 `CalendarEvent[]`，serializer 只负责 RFC 5545：

- UID 从稳定正式 ID/课节 occurrence identity 生成。
- 纯日期使用 `VALUE=DATE` 且 DTEND 为次日；deadline 不虚构时长。
- cancelled/deleted 与 unscheduled 默认跳过，并在页面返回遗漏摘要。
- 文本正确转义、折行；生成时间与记录 version 驱动 DTSTAMP/LAST-MODIFIED/SEQUENCE。

## 8. Contract 演进

- 可选响应字段通常兼容；删字段、改语义或修改 union 需要版本/迁移窗口。
- 数据库 row、HTTP DTO 和 UI view model 使用明确 mapper，不复用一个 schema 到所有层。
- contract tests 覆盖时间 union、problem response、owner scope、Source 上传/预览/删除、Dashboard snapshot 与 ICS golden file。
- `pnpm test:manual-only` 是 P4 发布 contract 的一部分，防止已删除的远程模型 surface 回流。
