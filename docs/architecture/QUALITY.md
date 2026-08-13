# 质量、安全与运行要求

CourseFlow 管理可能影响学生提交和考试安排的数据。质量门槛围绕“错误可见、来源可查、重试安全、时间正确”设计。

## 1. 测试策略

测试面是模块 interface，不是每个 helper。每个风险由最低、最快且能真实证明它的层负责；同一事实不在 unit、component 和 E2E 重复断言。普通功能先完成最短可运行代码，再在离开切片前补最低充分测试；已发生回归和日期、权限、审核原子性等高风险规则先用测试稳定复现。优先级从快到慢：

| 层                    | 运行环境                               | 验证内容                          | 示例                                        |
| --------------------- | -------------------------------------- | --------------------------------- | ------------------------------------------- |
| 领域/纯模块测试       | Vitest，无 I/O                         | 值对象、不变量、投影 policy       | temporal union、评分 warning、冲突、热力图  |
| interface 测试        | core + in-memory adapter               | 完整 command/query 行为           | review 原子性、所有权、幂等、版本冲突       |
| adapter contract 测试 | 临时 PostgreSQL/对象存储               | concrete adapter 与 port 契约一致 | transaction、索引约束、签名 URL、队列重投   |
| contract/golden 测试  | Zod/serializer                         | 稳定 JSON、AI schema、ICS         | union variants、Problem Details、折行/转义  |
| 组件测试              | Testing Library                        | 用户可见行为和 a11y               | Source 预览/手工入口；条件性审核/错误焦点    |
| E2E                   | Playwright + 真实 web/worker            | 关键旅程                          | 上传→预览→手工表单→正式投影                 |
| 条件性 AI contract/eval | fake + 冻结 corpus；最终受控真实调用  | 门禁、抽取/助手质量和模型升级回归 | precision/recall、Evidence、越权与草稿安全   |

### 1.1 必测领域场景

- LocalDate 在不同时区仍显示同一课程日期；exact instant 按显示时区正确换日。
- DST gap/overlap 的本地输入不被静默接受。
- 周期课节只在有效日期/星期展开；Reading Week 默认不生成实例，`kept/rescheduled/cancelled` 单次例外按优先级覆盖，改期仍使用稳定 occurrence identity。
- Meeting Exception 不能指向原规则不会发生的日期；一次性 Office Hour 等安排走 interval 事项，不污染课节重复规则。
- 学期教学周编号在 Reading Week 前后连续且无 off-by-one；学期开始于周中与不同 `week_starts_on` 有固定样例。
- “下一节课”在开始前、进行中、今日无后续课程和跨日四种状态下选择一致；dashboard 与 calendar 使用同一实例集合和地点/TBA。
- `[start, end)` 相邻考试不算重叠，真正交叉才是 `hard_overlap`。
- `unscheduled` 不进热力图、日历格或 ICS，但出现在 TBA count/list。
- 替代评分方案分别计算 warning；未知权重不是 0；bonus/合计异常允许保存并提示。
- Grade Result 未录入时不按 0 分；当前成绩同时核对已获总评百分点、已出分部分百分比与覆盖权重；未知 weight 的已出分项单独标记。
- Gradebook 使用整数/有理数中间值并只在展示边界 half-up rounding；多项小数分数不会因逐项四舍五入产生累计偏差。
- A/B/C/D/F 边界必须完整且单调；未配置表时不猜字母等级，课程学分不触发 GPA/已获学分推断。
- 用户不能把另一用户的 Letter Grade Scale 关联到课程；私有 scale ID 与其他资源相同按 404 处理。
- 自定义任务标签不能跨学期关联；大小写折叠重复被拒绝；短期/中长期分组由同一固定 Clock/policy 重算而非持久化。
- Course Item 自报进度与 Grade Result 百分比保持不同字段/文案；标记 completed 不会生成成绩。
- 同一审核命令重放只创建一份正式记录；不同 payload 使用同 key 被拒绝。
- 已被决定或来源已删除的 Candidate 不能再次产生 Review Decision；正式 target version 冲突整体回滚。
- 新版资料匹配已有事项时，`update_existing` 更新目标且写一条 Review Application；`create` 产生独立项；`duplicate` 不修改目标，三者不可混淆。
- 所有模式下 Source Document 都能上传、owner-scoped 预览并从旁进入既有手工表单；上传/预览本身零正式写入。
- 仅 `AI_ENABLED` 测试：未配置/撤销 key 不得创建卡住的 Import Run；任何普通 query/DOM/log/trace/queue/artifact 都拿不到明文；Assistant 只读授权正式 snapshot，放弃 Draft 零写入。
- `MANUAL_ONLY` 测试：route manifest、client bundle、migration/schema、依赖、环境变量、DOM 和产品文案中没有密钥/助手/AI 抽取/Candidate 功能；Source 手工 canonical E2E 仍通过。
- 归档课程默认不出现在 dashboard；取消/删除事项不进入当前 ICS。
- 用户 A 猜到用户 B 的每一种资源 ID 均读不到，包括 Evidence page preview。

### 1.2 Fixture 与时间

- 测试使用注入的 `Clock` 和 ID generator；不读取真实 `Date.now()` 或随机 UUID 来断言。
- 文档 fixture 必须自创、获授权或去身份化，不提交真实学生姓名、学号、邮箱和未获授权课程资料。
- AI 日常 CI 使用 deterministic fake adapter 和 golden artifact；P3 不运行真实 DeepSeek。P4 最终评审才由用户临时提供 key，经受保护 secret input 调用，完成立即撤销；未提供或未完成视为 `UNVERIFIED` 并进入 `MANUAL_ONLY`。
- P3 对每个 Prompt Registry entry 做版本/golden 测试：purpose 只能选择已知 spec，HTTP/数据库/资料文本不能覆盖 instructions/schema/provider 参数，数据 payload 保留页码/opaque ID 且被标为不可信。prompt/schema 任一变化必须显式升版本并使对应 gold/eval 重新运行。
- DeepSeek seam contract 覆盖 completed 单一 `output_text`、incomplete/failed、多 message、function/web output、空/非法 JSON、取消与 400/401/402/422/429/500/503；只有通过本地 schema、citation/Evidence allowlist 和领域 validator 的结果能生成 Candidate/Draft view model。
- `AiResultRegion` 浏览器测试使用 fake view model 覆盖 idle/generating/completed/cancelled/failed：不出现原始 HTML/Markdown/reasoning/provider error，错误保留问题与恢复操作，键盘/focus/aria-live/200% zoom 可用，`MANUAL_ONLY` route/DOM/bundle 中不存在该区域。
- migration integration test 从空库迁移到最新，并至少验证上一 release schema 到最新。开发早期没有上一 release 时固定初始 snapshot。

## 2. CI 质量门

每个 PR 的 required checks：

1. lockfile frozen install。
2. formatting check。
3. ESLint，包括模块依赖和禁止深 import。
4. TypeScript strict typecheck。
5. unit/interface/component tests。
6. PostgreSQL adapter 与 migration integration tests。
7. production build。
8. 一条随阶段扩展或替换的关键 Playwright smoke journey；不按页面、端点或小功能堆叠同义 E2E。
9. dependency/license/secret scan 和已知高危漏洞检查。

文档-only 变更可跳过昂贵 E2E，但 Markdown link/diagram lint 要通过。合并前本地和 CI 使用相同 package scripts，脚本名在初始化后以 `package.json` 为真相，不复制到本文。

## 3. 安全模型

### 3.1 信任区

不可信输入包括：浏览器 body/query/header、文件名/MIME、PDF/图片、OCR 文本、AI 输出、Evidence quote、日历文本。每次跨 seam 都解析/校验，不能因“来自我们的模型”而信任。

### 3.2 身份与授权

- auth provider 只建立 `auth_subject -> internal user`，领域记录使用内部 ID。
- 生产数据库使用分离角色：web role 执行已授权业务命令；worker role 只读所需课程/来源信息并写 ingestion/queue 范围，数据库层拒绝其写正式 Course Item、课程和评分表。
- 每个 repository operation 带 `UserScope`；route 中先 auth 不代表深层 query 可以无作用域。
- private object 预览在生成签名 URL 前重新鉴权；禁止把永久 URL存数据库。
- 对不存在和无权限的私有资源默认同样返回 404。
- 若未来使用 PostgreSQL Row Level Security，作为 defense-in-depth，而不是替代 application authorization。

### 3.3 Web 防护

- same-site、secure、httpOnly session cookie；mutation 检查 Origin/CSRF 机制。
- 安全 headers：CSP（逐步收紧、避免任意 inline script）、HSTS、`nosniff`、Referrer-Policy、frame ancestor 限制。
- 受控 Markdown/纯文本渲染；不渲染资料中的 HTML。React escaping 不被 `dangerouslySetInnerHTML` 绕过。
- 课节地点首版按纯文本渲染；看似 URL 的不可信地点不自动变成可点击链接。
- 导出文件的标题/描述做 ICS escaping；Content-Disposition 文件名净化。
- 对登录、上传计划、完成上传、retry、AI 导入和导出做用户/IP 合理限流；返回 `Retry-After`。

### 3.4 文件与远程 AI

Source 文件要求始终适用；远程 AI 条目只在 `AI_ENABLED` 适用。完整要求见 [导入流水线](./INGESTION.md) 和 [AI 去留门禁](./AI_ASSISTANT.md#3-deepseek-ai-去留门禁)。额外要求：

- 解析库和 worker 定期更新；处理进程使用最小权限和临时空间配额。
- 对象 key、数据库 URL、API key、完整 prompt 不进入前端、错误响应或 analytics。
- 用户 DeepSeek key 只经 same-origin HTTPS 到 server；以独立表的认证加密密文保存，master key/KMS 与数据库分离。固定官方 endpoint，不接受用户 base URL、代理或任意模型名。
- credential verifier 只能证明认证与模型可见性；401 标无效、402 标余额不足，429/5xx 不应把正确 key 永久标无效。密钥显隐/复制控件不得把已保存明文重新送回浏览器。
- `AI_ENABLED` 前必须确认 DeepSeek 数据保留策略；首版禁止上传 provider File，不能因未来接口出现就绕过重新评审。
- Prompt injection 被当作文档内容；抽取调用不开放 web、code、MCP 或写工具。
- 供应商 response 先过 strict schema，再过本地领域 validator；拒绝/截断/不完整状态必须显式处理。
- `AI_ENABLED` 的 DeepSeek 调用只发送页级文本或有界正式 planning context；官方 API 不支持 PDF/图片/file 输入。Assistant 默认关闭 web search，模型只产解释/草稿，没有应用草稿或审核 Candidate 的工具。
- 最终评审任一能力、安全、隐私、质量、可靠性或 UI 硬门禁失败，或仍未验证，必须执行 `MANUAL_ONLY` 清理；不能切换其他模型、隐藏后保留 route，或用 fake 宣称可用。

## 4. 隐私与数据生命周期

- 收集最少信息：首版不需要学号、学校账号密码或通讯录。
- `AI_ENABLED` 时，在首次远程解析前告知哪些文本会发送给 DeepSeek；`MANUAL_ONLY` 不出现远程发送文案。隐私文案和实际 composition 必须一致。
- 个人中心在保存 key 和首次调用前说明会发送哪些课程文本、用途、供应商和撤销方式；`store:false`/stateless 不得宣传成零留存保证。
- 用户可撤销 DeepSeek key并删除短期助手历史；撤销后新调用立即失败，正在执行的调用在安全检查点停止。备份中的密文按保留/轮换策略过期。
- 用户可删除 Source Document；对象、页图、provider file 和正文 artifact 通过可观察 cleanup job 删除。
- 用户可导出/删除账号数据；账号删除是幂等 saga，任何残留步骤可重试。
- 普通日志不含课程正文、原文件名（如可能含姓名）、Evidence quote、邮箱或签名 URL。必要调试内容使用显式受限、安全过期的诊断机制。
- analytics 事件采用低基数和无内容字段，例如 `import_completed {pageBucket, candidateCountBucket}`。

## 5. 性能与容量基线

这些是首版设计目标，真实数据上线后用 telemetry 校正：

| 场景                                  | 目标                                                       |
| ------------------------------------- | ---------------------------------------------------------- |
| 已缓存/普通 dashboard server response | p95 < 500 ms（不含用户网络）                               |
| 普通 command                          | p95 < 750 ms，不含对象直传                                 |
| 首屏                                  | 主要内容尽快 server render；交互 JS 只发送必要岛           |
| 进度 query                            | 小 payload，indexed read，支持 304                         |
| PDF/image 导入                        | 异步；UI 不承诺固定秒数，显示阶段和心跳                    |
| 数据规模设计点                        | 每用户 20 学期、每学期 20 课程、每课程 1000 事项仍有界查询 |

- 防 N+1：dashboard 通过专用 query 一次/少数几次加载 term snapshot。
- 课节实例按请求日期范围展开，不预生成整个课程历史；展开算法受学期和最大查询跨度限制。
- 热力图/冲突用有界日期范围；先在应用层纯计算，profile 证明瓶颈后再 SQL 聚合/缓存。
- 图片预览生成合适尺寸，不把原始超大页面塞进列表；Evidence viewer 按页懒加载。
- 上传浏览器直传对象存储，web 不缓冲整份文件。
- worker 并发按 CPU 和用户公平性控制；`AI_ENABLED` 时再加入供应商限额，同一用户不能占满全局 worker。

## 6. 可观测性

### 6.1 标识传播

每个 web 请求有 `requestId`，Import Run 有 `runId`，队列 attempt 有 `jobId/attempt`。提交 run 时记录关联，worker 日志/trace 携带 runId。模型调用有内部 `providerCallId`，只记录供应商返回的非秘密 request ID。

### 6.2 结构化事件

至少记录：

- `source_upload_started/completed/rejected`
- `import_stage_started/completed/failed`
- `candidate_reviewed`（仅 kind/decision/warning count，不含 payload）
- `calendar_exported`（范围和数量，不含标题）
- `cleanup_started/completed/failed`

字段使用固定 schema 和 error code。禁止用自由文本日志承载唯一诊断信息。

### 6.3 指标与告警

- 请求量、错误率、p50/p95/p99 latency。
- 队列深度、最老 queued age、stage duration、retry/failure/cancel rate、stale heartbeat。
- `AI_ENABLED` 时记录每页/每 run token 与成本、schema failure、provider 429/5xx。
- `AI_ENABLED` 时记录 Assistant 请求/完成/取消/失败、credential 配置/验证/撤销结果（只含安全 code）、请求 alias 与 Responses `id`/实际 `model` 变化；fingerprint 仅在实际返回时 nullable 记录。
- Candidate accepted/edited/rejected/duplicate 比例，作为质量信号但不把用户行为当 gold truth。
- cleanup backlog 与删除失败。

告警聚焦可行动问题：导入失败率突增、队列 age 超阈值、provider schema failure、对象删除持续失败、认证异常。单次用户输入错误不报警。

## 7. 可靠性与恢复

- PostgreSQL 是权威源，按部署环境建立自动 backup 和恢复演练；对象存储启用合适 durability/lifecycle。
- deployment 采用 expand/migrate/contract：先兼容 schema，再部署代码，最后清理旧列；不要同一次部署做不可兼容 rename。
- worker 优雅停止：停止 claim 新任务，完成或释放当前 lease；run heartbeat 允许崩溃后恢复。
- 外部 provider 超时、有限重试、指数退避 + jitter；circuit breaker 只有 telemetry 证明需要时添加。
- 派生投影可从正式数据重算，不纳入灾难恢复真相集合。
- migration、prompt/schema/policy 都有版本，发生回归可停止新 run 并保留旧结果可审核。

## 8. 无障碍与浏览器质量

- 目标 WCAG 2.2 AA；关键 journeys 至少用 axe 自动检查加人工键盘/屏幕阅读器 spot check。
- `1280x900` 是视觉回归基线，200% zoom 是功能性无障碍检查：关键任务不得丢内容、控件或错误，除日历/热力图等明确二维容器外不得出现 document 级水平滚动；不要求像素相同或建立移动端布局。
- 支持当前和前一个稳定版本的 Chrome、Edge、Firefox、Safari；不基于 user-agent 分支核心逻辑。
- 热力图提供非视觉等价列表；图表有可读标题、范围和 summary。
- 文件 dropzone 同时有标准 file input；粘贴/拖拽不是唯一入口。
- 导入进度使用 `aria-live` 克制更新，不每两秒朗读全部页面。
- 日期和错误文案不只依靠格式/颜色；显示时区并对缩写歧义提供完整 IANA/城市说明。
- TUT/PRA 在首次/紧凑空间外显示完整类型名称或可访问名称；课节、截止事项、短期/中长期和成绩覆盖口径都有非颜色文字标识。

## 9. Definition of Done

一个纵向功能只有同时满足以下条件才完成：

- 领域术语和不变量与 `CONTEXT.md`/数据模型一致。
- command/query interface 有可观察行为测试，adapter 有必要 contract test。
- HTTP/AI/文件输入在 seam 校验；授权覆盖正反路径。
- 页面包含 loading、empty、error、success，以及该功能可能的 stale/partial 状态。
- 键盘、`1280x900` 正常横屏桌面视觉参考、200% zoom 功能保留、长文本和本地化数据经过验证。
- P4 已形成无未决项的 `AI_GO` 或 `MANUAL_ONLY`；若为后者，AI 代码/route/table/config/UI 清理证明与手工 Source E2E 已通过。
- 日志/指标足以定位失败且不泄漏正文/凭据。
- migration/config/docs 同步；没有 mock 数据、临时 route、死代码或被替代实现残留。
- CI required checks 全绿。
