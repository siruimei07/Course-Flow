# CourseFlow 实施计划

按阶段完成可运行的纵向切片。后阶段依赖前阶段的 interface 和验收；agent 不应因为未来路线存在就提前创建空模块、抽象或数据库表。每一步的实现顺序、低防御边界、最小测试集和详细门禁见 [Agent 开发执行流程](./DEVELOPMENT_WORKFLOW.md)；项目所有者按阶段投喂任务时可使用 [开发使用指南](../product/OWNER_DEVELOPMENT_GUIDE.md)。

## 当前状态

| 阶段                                   | 状态     | 解锁条件                                  |
| -------------------------------------- | -------- | ----------------------------------------- |
| P0：仓库与质量骨架                     | `done`   | 全部门禁已通过                            |
| P1：学期、课程、课表、任务与成绩闭环   | `next`   | P0 为 `done`                              |
| P2：总览、任务分组、热力图、冲突和 ICS | `locked` | P1 为 `done`                              |
| P3：上传与确定性导入骨架               | `locked` | P2 为 `done`                              |
| P4：真实 PDF/图片与 AI 提取            | `locked` | P3 为 `done`，且 MVP UI 硬门禁通过        |
| P5：UI 整合与体验打磨                  | `locked` | P4 为 `done`                              |
| P6：统计扩展 seam                      | `locked` | P5 为 `done`，且首批 Insight 已由产品明确 |

本文用 P0–P6 作为“阶段 0–6”的简写。完成一个阶段时，执行 agent 必须在同一变更中把该阶段标为 `done`、满足解锁条件的下一阶段标为 `next`，并记录尚未满足的完成项。用户明确指定的 UI 探索可以提前放入隔离 demo，但不能绕过对应领域/contract 阶段接入生产 route。

### P0 门禁记录（2026-08-12）

P0 标为 `done`，P1 解锁为 `next`。在 Node 24.14.0、pnpm 11.16.0、Docker Engine 29.1.3、Compose 2.40.3、PostgreSQL 17.10、LocalStack Community 4.14.0 和 Chrome 151.0.7922.110 环境中，`pnpm gate:p0` 以退出码 0 完整通过。

实际证明：frozen install 与 S3 bucket 准备通过；format、lint、strict typecheck 通过；Vitest 3 个测试文件/3 个测试通过；全新 PostgreSQL 数据库迁移到 P0 baseline；worker 与 Next.js production build 通过；Playwright 1 条 canonical smoke 通过，覆盖首屏、键盘焦点、request ID、Web/Worker liveness 与 PostgreSQL/S3 readiness；秘密扫描 104 个源码文件、生产依赖许可证 68 个包通过，`pnpm audit --audit-level high` 通过（仍报告 1 low、1 moderate，不触发 high 阈值）。此前缺少容器运行时、锁定 Chromium 下载超时和依赖不可达的阻塞均已解除；P0 无未满足完成项。

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
- 明确 empty/loading/error/version conflict；768/1280 桌面参考 viewport、200% zoom 和键盘基本可用。
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

## 阶段 3：上传与确定性导入骨架

### 工作

- Source Document/Asset/Import Run/Artifact/Candidate/Evidence/Review Decision/Review Application schema。
- 对象存储 production/local/test adapters；预签名直传和 server-side validation。
- PostgreSQL queue adapter、worker claim/heartbeat/retry/cancel。
- 先实现 `FixtureExtractionAdapter`：对测试文件返回固定 artifact，不调用真实 AI。
- 全局 `/sources` 资料库、课程 Source history、Import progress 和 Review workspace。
- 审核 transaction 调用 `planning.applyReviewedCandidate`，覆盖四种 decision 与 create/update_existing 两种 application。

### 完成标准

E2E 使用 fixture 文件完成：上传→排队→worker→候选→Evidence→接受/修改/拒绝/重复→正式时间线。重放 job/审核不会重复写；中途失败能安全 retry；审核前正式视图完全不受候选影响。

## 阶段 4：真实 PDF/图片与 AI 提取

### 工作

- 实现受限 PDF 文本/页图准备和有序图片准备。
- 定义并版本化 strict extraction JSON Schema、prompt 和 deterministic normalizer。
- 实现 OpenAI Responses Extraction adapter；远程 timeout/rate limit/retry/cleanup。
- 建立去身份化 fixture corpus、gold output 和 eval report。
- 补齐冲突资料、相对日期、替代评分、表格、多语言等 warning/审核体验。
- 记录成本、stage latency、schema failure 等无正文 telemetry。

### 完成标准

fixture corpus 达到团队在首次 baseline 后记录的质量阈值；所有关键字段有 Evidence 或明确 unverified warning；模型/normalizer 版本可追踪；provider failure 不污染正式数据；数据保留和文件清理路径已验证。

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
- 为未来 LMS/邮件同步预留的空表和 provider factory。
