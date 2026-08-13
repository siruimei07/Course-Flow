# CourseFlow 实施计划

按阶段完成可运行的纵向切片。后阶段依赖前阶段的 interface 和验收；agent 不应因为未来路线存在就提前创建空模块、抽象或数据库表。每一步的实现顺序、低防御边界、最小测试集和详细门禁见 [Agent 开发执行流程](./DEVELOPMENT_WORKFLOW.md)；项目所有者按阶段投喂任务时可使用 [开发使用指南](../product/OWNER_DEVELOPMENT_GUIDE.md)。

## 当前状态

| 阶段                                   | 状态     | 解锁条件                                  |
| -------------------------------------- | -------- | ----------------------------------------- |
| P0：仓库与质量骨架                     | `done`   | 全部门禁已通过                            |
| P1：学期、课程、课表、任务与成绩闭环   | `done`   | P0 为 `done`                              |
| P2：总览、任务分组、热力图、冲突和 ICS | `done`   | P1 为 `done`                              |
| P3：资料手工闭环与条件性 DeepSeek 候选 | `done`   | P2 为 `done`；非 AI UI 与手工路径已验收    |
| P4：DeepSeek 最终去留门禁               | `next`   | P3 为 `done`；真实评测仍需临时 key 与评审授权 |
| P5：UI 整合与体验打磨                  | `locked` | P4 形成 `AI_GO` 或 `MANUAL_ONLY` 并为 `done` |
| P6：统计扩展 seam                      | `locked` | P5 为 `done`，且首批 Insight 已由产品明确 |

本文用 P0–P6 作为“阶段 0–6”的简写。完成一个阶段时，执行 agent 必须在同一变更中把该阶段标为 `done`、满足解锁条件的下一阶段标为 `next`，并记录尚未满足的完成项。用户明确指定的 UI 探索可以提前放入隔离 demo，但不能绕过对应领域/contract 阶段接入生产 route。

### P0 门禁记录（2026-08-12）

P0 标为 `done`，P1 解锁为 `next`。在 Node 24.14.0、pnpm 11.16.0、Docker Engine 29.1.3、Compose 2.40.3、PostgreSQL 17.10、LocalStack Community 4.14.0 和 Chrome 151.0.7922.110 环境中，`pnpm gate:p0` 以退出码 0 完整通过。

实际证明：frozen install 与 S3 bucket 准备通过；format、lint、strict typecheck 通过；Vitest 3 个测试文件/3 个测试通过；全新 PostgreSQL 数据库迁移到 P0 baseline；worker 与 Next.js production build 通过；Playwright 1 条 canonical smoke 通过，覆盖首屏、键盘焦点、request ID、Web/Worker liveness 与 PostgreSQL/S3 readiness；秘密扫描 104 个源码文件、生产依赖许可证 68 个包通过，`pnpm audit --audit-level high` 通过（仍报告 1 low、1 moderate，不触发 high 阈值）。此前缺少容器运行时、锁定 Chromium 下载超时和依赖不可达的阻塞均已解除；P0 无未满足完成项。

### P1 门禁记录（2026-08-13）

P1 标为 `done`，P2 解锁为 `next`。P0 证据先经复核：阶段记录与同一基线的 format、lint、strict typecheck、unit、production build 门禁均保持通过，故 P1 开工条件成立。

P1 实际证明：先把 `ui-v1` 的全局风格指纹及颜色、字体、圆角、阴影、motion/reduced-motion 固化到 `packages/ui/tokens.css`，再以真实 auth scope、PostgreSQL repository、Zod HTTP contract 和 React/Next.js 页面完成纵向切片。全新数据库可迁移到 14 张 P1 表；PostgreSQL contract 在断开并重连后验证 owner/stranger 隔离、版本冲突、Lecture/TUT/PRA、Reading Week、四种事项时间语义、标签、评分方案与手工结果持久化；其中纯日期保持 `2026-09-30`，不经 UTC 午夜转换。Vitest 6 个文件/13 个最小测试通过，覆盖权限、同源写入边界、DST/课节语义、Reading Week 保留例外、成绩整数不变量/未知权重及版本冲突。

生产构建 Playwright canonical journey 通过 1/1：创建学期和 Reading Week → 创建含 3 条 Lecture/TUT/PRA 周期规则的课程 → 创建学期标签和手工事项 → 从 Timeline 回读 → 创建 20%/80% 评分方案并录入 `80/100` → Gradebook 显示已获总评 `16%`、已出分部分 `80%`、覆盖权重 `20%` → 刷新后仍存在；同时验证 health/readiness、键盘 skip link、浅深主题、焦点和控制台，最终无 error/warn。production build、frozen install、format、lint、typecheck、秘密扫描 180 个源码文件、69 个生产依赖许可证和 `pnpm audit --audit-level high` 均通过（仍仅 1 low、1 moderate）。P1 明确未实现 GPA 或最终成绩预测；无未满足完成项。

### P2 门禁记录（2026-08-13）

P2 标为 `done`，P3 解锁为 `next`。开工前复核 P1 的阶段记录、领域测试、真实 PostgreSQL contract 与 canonical journey：正式数据回读、owner/stranger 隔离、Lecture/TUT/PRA、Reading Week、四种事项时间语义、标签与 Gradebook 的 `16% / 80% / 20%` 覆盖口径均保持通过。

P2 以 owner-scoped、单事务 `REPEATABLE READ READ ONLY` 的 `ScheduleSnapshot` repository 作为唯一读取入口；Dashboard、Tasks、Calendar、课程 Timeline、热力图、冲突与 ICS 均由同一 snapshot identity 和 `term-progress-v1`、`task-grouping-v1`、`workload-v1`、`conflict-v1` 投影。正式 PostgreSQL contract 在重连后验证 4 种事项、display timezone、owner 隔离及跨投影 snapshotId；Vitest 10 个文件/28 个测试通过，覆盖 7 天边界、Reading Week 教学周暂停、今日/进行中/跨日/无下一节、半开区间相邻不冲突、hard overlap、deadline cluster、TBA/归档/cancelled、工作量来源与 band、ICS all-day/instant/interval、稳定 UID、UTF-8 75-octet 折行和转义。

原有单条 Playwright canonical journey 扩展后通过 1/1，未新增页面 smoke：在 P1 闭环上追加短期/中长期/TBA、精确截止、占用区间与同日集中事项，验证 Dashboard 学期进度/今日与下一节/热力图/冲突，Tasks 四组，Calendar 周视图与 Reading Week 空周，两个 P2 API 的 snapshotId 与 Dashboard 一致，两次 ICS 字节一致、UID 唯一且 TBA 被计数跳过。`ui-v1` 常规 MVP 页面按冻结 token 完成生产接入，Browser 验证周/议程切换、课程/类型筛选、浅深主题和文字等价热力图；视觉偏差仅来自正式数据、周粒度政策与不迁移 mock 的范围约束。frozen install、format、lint、strict typecheck、production build、迁移、PostgreSQL contract、canonical E2E、秘密/许可证扫描及 high-level audit 均通过；P2 无未满足完成项。

### P3 门禁记录（2026-08-14）

P3 标为 `done`，P4 解锁为 `next`，但产品模式仍是 `AI_PENDING`。`p3-manual-v1` 只冻结 `MANUAL_ONLY`：Sources 私有上传、服务端 sniff/hash/owner 校验、安全预览、删除，以及带 Source/course 上下文打开既有手工表单。production canonical journey 通过 1/1（最终 14.8s）：PDF 上传与预览字节相等，上传/预览本身零正式写入，用户手工提交 `Problem Set 1` 后 Timeline/Dashboard 从同一正式记录回读；删除 Source 后预览为 404，正式事项仍保留。真实 PostgreSQL/LocalStack contract 同时验证 owner/stranger 隔离、版本、`cleanup_status=pending→complete` 与删除独立性。

AI 侧在第一次真实调用前冻结 `ai-eval-policy-v1`、5 个去身份化 corpus 样本、8 个阈值和 7 个零容忍项；ingestion/assistant 分别持有源码内 prompt/schema/budget v1。45 个 unit tests 覆盖本地 PDF/OCR/page locator、正式 snapshot/短期对话裁剪、资料/问题注入不能覆盖 registry control、完整 JSON Schema/DeepSeek allowlist、completed-only 唯一 `output_text`、逐字段置信度/推断说明/Evidence、citation/领域校验、安全 Candidate/Draft view model，以及 Source 对象清理的 pending/complete 恢复。isolated deterministic fake harness 通过 1/1（2.5s），覆盖 `AiResultRegion` 五态与恢复，原始 response/markup/reasoning/provider 字段不进 DOM。eval runner dry-run 通过，`liveCall=false`；三个签署仍为 `UNVERIFIED`。

默认 production build 的 route manifest 只有手工 Sources/既有页面，无 AI/import/assistant route；默认 migration 只有 Source tables，无 AI/Candidate/assistant 表；默认 composition 不装配 live adapter，`.env.example`、CI、E2E 和截图不含真实 key。`ux-heuristics` 最终为 9/10、severity 4/3 均为 0；`typeui-fundamentals` 在 1280 与 200% 等效视口通过，Browser 成功页为 0 error/0 warn、无 framework overlay。P4 必须在冻结 policy 下真实评测并完成三方签署后，才能选择 `AI_GO` 或 `MANUAL_ONLY`；目前不得安装生产 AI UI、route、migration 或 live adapter。

## 阶段 0：仓库与质量骨架

### 工作

- 初始化 pnpm workspace、TypeScript strict、Next.js web、Node worker。
- 配置 formatter、ESLint、Vitest、Playwright 和模块依赖限制。
- 建立 `core`、`ui`、composition root 的最小真实目录；不创建空 feature 集合。
- 保留设计期视觉实验室；用户宣布设计完成时按 [前端设计基线与冻结](../design/DESIGN_BASELINE.md) 建立只读版本，不把被忽略的本地 HTML 当作生产 contract。
- 配置 PostgreSQL、Drizzle migration、开发 compose（数据库和 S3-compatible store）。
- 建立类型化 config、结构化 logger、request ID、health/readiness endpoint。
- 增加 `.env.example`、CI、测试 clock/ID generator。

### 完成标准

新开发者用 README 的唯一启动路径能运行 web、worker 和依赖；空库 migration、typecheck、lint、unit test、production build、Playwright smoke 在 CI 通过；core 的禁止依赖规则有失败样例验证。

## 阶段 1：学期、课程、课表、任务与成绩闭环

### 工作

- 实现 auth seam 和最小登录/开发身份 adapter（生产 provider 未定时不硬耦合）。
- Academics commands/queries、表与 migration。
- Academics 的 Academic Calendar Exception、Meeting Pattern/Exception、课程学分、命令、表与 migration；支持 Reading Week 和 Lecture/TUT/PRA。
- Planning 的 Course Item temporal union、Task Label、Grading Scheme/Grade Result/Letter Grade Scale aggregate、命令、表和版本控制。
- 学期/课程页面、分步添加课程与多个课节、课程时间线、手工事项/标签表单和 Gradebook 页面。
- 明确 empty/loading/error/version conflict；`1280x900` 正常横屏桌面参考 viewport 和键盘基本可用。
- 若已有冻结 UI 基线，每个可见切片引用对应页面/状态矩阵并做同 viewport 截图比对；未冻结时只使用可整体替换的中性 token。

### 完成标准

真实用户可以创建学期、Reading Week、带多个 Lecture/TUT/PRA 课节的课程、四种 temporal variant 的事项/标签和替代评分方案；可手工录入 Grade Result 并看到覆盖权重口径；刷新后数据存在；另一用户无法读取；日期/DST/课节/权重/等级表 warning 与版本冲突测试通过；生产页面无 mock 数据。

## 阶段 2：总览、任务分组、热力图、冲突和 ICS

### 工作

- 实现 `ScheduleSnapshot` 及有界 query adapter，统一展开课节实例与课程事项。
- 建立 Meeting Expansion、Term Progress、Task Grouping、WorkloadPolicy、ConflictPolicy 和纯测试。
- Dashboard 的学期进度/今日课表/下一节倒计时、`/tasks` 短期与中长期分组、热力图详情、冲突卡片、calendar/timeline view。
- 实现 ICS 中立模型、序列化 adapter 和下载页面。
- 对 Reading Week、课节改期/取消、TBA、归档、cancelled/deleted 和显示时区建立一致规则。

### 完成标准

同一正式课节/事项在 dashboard、tasks、timeline、calendar、heatmap、conflict 和 ICS 中遵守同一语义；Reading Week 不生成常规课节，下一节课状态正确；hard overlap 与 deadline cluster 可区分；稳定 UID/all-day/转义 golden tests 通过；热力图有列表等价视图。

## 阶段 3：资料手工闭环与条件性 DeepSeek 候选

### 工作

1. 冻结 P3 的**非 AI** UI：`/sources` 上传、校验、资料预览、删除，以及“在新/现有手工表单中录入”的明确主操作。AI 原型标 `conditional`，不进入生产基线。
2. 实现最小 `source-library` 纵向切片：Source Document/ordered Asset、对象存储 production/local/test adapters、预签名直传、server-side metadata/hash/owner 校验和受限预览。上传和删除均不改变正式计划。
3. 复用 P1 的 Course Item、课程/课表与 Gradebook 表单；从 Source 预览带 `returnTo`/course context 打开表单，用户提交仍只调用既有公开 command。不得复制领域判断或建立第二套“资料事项”。
4. 在任何真实调用前冻结 `ai-eval-policy-v1`：去身份化 corpus、gold/Evidence、评分脚本、质量/延迟/费用阈值、零容忍项和签署人。开发、CI、E2E、截图中没有真实 key。
5. 按 [专项可行性研究](../research/deepseek-local-text-prompt-ui-slot-feasibility.md) 冻结暂定内部链：`Local Preparation → Feature Prompt Registry → DeepSeek Responses Port → Local Result Validation → Safe View Model → UI Result Region`。记录为“接口形态可行、真实能力待 P4”，不能把研究结论当 `AI_GO`。
6. 实现本地输入侧：资料抽取由 worker 完成 PDF 文本提取、必要的受限页图/OCR、有序图片、页码/locator、分块和输入 hash；助手由 `PlanningContextPort` 完成 owner/范围、正式 snapshot、短期对话裁剪与 token budget。进入 prompt 的文本仍会发送给 DeepSeek，测试/文案不得称为零外传。
7. 在 `ingestion` 和 `assistant` 内分别实现 source-controlled Prompt Registry。每个 purpose 绑定 prompt/schema/budget version、instructions builder、input serializer、JSON Schema、parser/validator；页面、HTTP、数据库和资料文本都不能覆盖这些规则。改 prompt/schema 必须升版本并使 gold/eval 重新运行。
8. 只在隔离 composition 中实现内部 `DeepSeekResponsesPort`、deterministic fake、固定 live adapter contract、Import Run/Artifact/Candidate/Evidence/Review 和助手草稿。v1 request 使用字段 allowlist，固定 `deepseek-v4-pro`、`stream=false`、`reasoning.effort=none`、`json_schema`、`tools=[]`、`tool_choice=none`，并省略不支持的 `store`/会话字段；P3 不装配 live adapter。P3 可评审 AI schema，但不把 AI migration 加入默认 migration chain；P4 `AI_GO` 后才生成并提交生产 migration。
9. 实现本地输出侧：只接受 completed 的唯一完整 `output_text`，再过同版本 JSON/Zod、citation/Evidence allowlist、日期/时区/bps/目标版本 validator；失败不产生部分 Candidate/Draft。mapper 只输出 `ImportReviewView`/`AssistantTurnView`，不泄漏 prompt、provider 类型、原始 response、reasoning、HTML 或错误正文。
10. 用 fake 完成上传→解析→Candidate/Evidence→审核和助手问题→安全结果/草稿的 interface tests；模型没有 tool/写权限，草稿只预填现有表单。准备可一次性运行的受控真实 smoke/eval，但 P3 不要求填入真实 key 或执行外部调用。
11. 继续优化 UI-0002/0003 时同时画 `AI_ENABLED` 与 `MANUAL_ONLY` 页面矩阵。条件性 `AiResultRegion` 覆盖 idle/generating/completed/cancelled/failed，关键错误持久显示并保留问题、重试/配置/手工恢复；不逐 token 或直接渲染供应商输出。个人 AI 只有 P4 `AI_GO` 才能冻结为正式功能。

### 完成标准

不依赖 AI 的 Source 上传→预览→打开手工表单→提交→正式 Timeline/Dashboard 闭环真实通过；上传/预览本身零正式写入，另一用户不能读取。AI 框架在隔离 composition 中能由 fake 证明本地输入最小化、受控 prompt 选择、固定 DeepSeek request、completed-only 本地验证、安全 view model 与 UI 状态恢复；测试证明 client/资料不能覆盖 prompt/schema/provider 参数，供应商原始输出不进入 DOM。默认 production composition、route manifest 和 migration chain不暴露密钥、助手、解析、Candidate 或 AI 表；eval policy 和受控运行手册齐全，但仓库和环境没有真实 key。`ux-heuristics`/`typeui-fundamentals` 对手工路径无 severity 3/4，AI/手工两套条件矩阵已登记但 AI 尚未宣称冻结。满足后解锁 P4 最终决策。

## 阶段 4：DeepSeek 最终去留门禁

### 工作

1. 产品所有者临时提供真实 DeepSeek key；只通过受保护的 secret input 注入受控评测，完成后立即撤销/删除。未提供、不可用或评测中断均记为 `UNVERIFIED`。
2. 不改 `ai-eval-policy-v1` 的 corpus/阈值，用暂定框架的固定 prompt/schema/budget versions 运行 extraction/assistant smoke、完整 eval 和红队；验证实际 request 的模型/工具/联网/stream/预算与 P3 contract 一致。记录 Responses `id`/实际 `model`、token、延迟、成本及安全错误，不记录 key、正文或 Chain of Thought。
3. 确认适用于下游最终用户的数据保留、训练使用/退出、处理地域、DPA/条款、披露、删除与事件响应；不能把 stateless 或 `store=false` 当零留存。
4. 按 [AI 去留门禁](./AI_ASSISTANT.md#3-deepseek-ai-去留门禁) 逐项签署，只能选择 `AI_GO` 或 `MANUAL_ONLY`。
5. `AI_GO`：把通过评测的 prompt/schema/budget versions 和 live adapter 加入生产 composition，生成 AI migration，完成凭据轮换与撤销、Candidate 审核、助手草稿、错误恢复、`AiResultRegion` UI 冻结和真实/fixture 回归；仍不允许模型直接写正式数据。
6. `MANUAL_ONLY`：删除 AI 配置/助手/解析/候选 UI、所有 AI route/module/adapter/prompt/schema/eval runtime 和 AI 专用表/migration；移除宣传与环境变量。若已有支持数据，先证明正式记录独立，再用显式清理 migration/job 删除；不触碰正式手工数据。保留 Source 上传/预览和手工录入闭环。

### 完成标准

有一份产品所有者签署的门禁报告且没有 `UNVERIFIED`。若为 `AI_GO`，冻结阈值全部达标，所有展示 Candidate 有可验证 Evidence，Responses `id`/实际 `model` 与版本元数据可追踪，凭据/隐私/UI/清理演练均通过。若为 `MANUAL_ONLY`，代码、route、依赖、migration、数据库、UI、文案与配置扫描证明 AI 已全部移除，Source 手工 canonical E2E 仍通过。两种结果都把 P4 标为 `done` 并解锁 P5；不得停在“继续受控开发但产品保留 AI 入口”。

## 阶段 5：UI 整合与体验打磨

### 工作

- 完善 Course Item 与 Grade Component 的可选关联、复杂 ruleText 展示和导入评分方案的差异审核体验。
- 完善课节例外、任务标签、成绩覆盖口径、A/B/C/D/F 等级表和课程学分的极端/partial 状态，不扩展为 GPA 或最终成绩预测。
- 整合用户后续提供的页面代码，严格执行 [UI 整合协议](./FRONTEND.md#6-用户提供-ui-代码的整合协议)。
- 统一 token/primitives，完成视觉回归、国际化和无障碍审计。
- 优化 dashboard/import review 的真实数据性能。

### 完成标准

复杂评分方案不会被错误扁平化，合计 warning 解释清楚；所有已提供 UI 片段都有映射记录且旧实现被清理；核心页面在目标 viewport、语言和键盘旅程通过。

## 阶段 6：统计扩展 seam

此阶段只在首批 Insight 被产品明确后开始。

### 工作

- 为每个已定义 Insight 写口径、适用范围、最小数据量和 data quality 规则。
- 以纯计算器 + 显式 registry 接到 `InsightQueries`。
- 统计页面用匹配数据类型的 chart/table，并展示定义、范围和不足提示。
- 对照正式数据 fixture 验证口径和可视化。

### 完成标准

每个显示数字都能指出输入范围、计算定义和数据质量；没有动态 SQL/通用插件框架；空数据不显示虚构图表。

## 每项任务的切片方法

agent 领取一个阶段内任务时按以下顺序：

1. 写出一个用户可观察场景和失败场景。
2. 定义或收紧目标 module interface 与 contract。
3. 实现最短可运行路径：纯领域行为、所需 repository/remote adapter、transport 与 UI。普通功能不强制测试先行；回归和高风险不变量先稳定复现。
4. 在 interface 上补最低充分的可观察行为测试；测试不穿透 implementation，不在多层重复同一断言。
5. 只覆盖该功能实际可达且有决策价值的页面状态，不机械制造状态组合。
6. 运行目标测试，再运行阶段 quality gates；更新与真实行为相关的文档。

完成标准：切片从用户入口走到持久化/投影并可独立演示；不以“先把所有表建好”或“先搭全部组件”代替纵向结果。

## UI 片段到达时的插入策略

- 若用户宣布设计完成：先执行 [前端设计基线与冻结](../design/DESIGN_BASELINE.md)，通过审计并获得用户确认后才把该版本作为生产实现依据。
- 若对应阶段尚未开始：保存为受控设计 reference/demo，并记录映射；不为它提前打穿未完成领域层。
- 若对应 feature 正在开发：以该片段的视觉意图替换/完善当前 presentation，contract 仍由架构定义。
- 若对应 feature 已完成：把整合视为迁移任务，先建立视觉/行为基线，接入后删除被替代实现并运行回归。
- 若片段暗示新的产品行为：先更新 `SCOPE.md` 和相关 interface/验收，再改页面，避免 UI 偶然定义业务。

## 暂不建设清单

除非产品范围发生明确变化，agent 不创建：

- 微服务拆分、Kafka/事件总线、Redis cache/queue。
- GraphQL 或第二套 HTTP API 栈；Next.js web 已承担首版 BFF。
- 通用 repository、通用 CRUD controller、BaseService 层。
- 运行时统计 DSL、插件 SDK、通用 workflow engine。
- AI 自动接受规则、无 Evidence 的“智能补全”。
- 模型直写/自动执行工具、默认联网搜索、任意用户自定义 AI endpoint、把 AI Planning Draft 当正式数据。
- 为未来 LMS/邮件同步预留的空表和 provider factory。
