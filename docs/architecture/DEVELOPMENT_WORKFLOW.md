# CourseFlow Agent 开发执行流程

本文把 [实施计划](./IMPLEMENTATION_PLAN.md) 中的 P0–P6 转成 Agent 可逐项执行的开发流程。实施计划负责阶段状态和解锁，本文件负责每个切片怎么实现、在哪里保留最低限度的防御、用什么证据验收。产品、数据和 interface 的语义仍以本目录的专门文档为准。

## 1. 执行目标

每次开发交付一个**最小正确切片**：一个用户可观察行为，从入口经过目标 module 的公开 interface，抵达真实持久化或真实查询投影，并在页面上呈现结果。P0 的基础设施工作可以横向进行；P1 起不以“先建完所有表”“先搭完所有组件”代替纵向结果。

Agent 采用以下工作方式：

- **代码优先**：先明确 interface、输入输出和一个关键失败，再实现最短可运行路径；测试在离开该切片前补齐，不为普通功能强制完整 TDD。修复回归、日期/审核等高风险规则时，先写能稳定复现问题的红灯测试。
- **边界防御**：只在不可信输入、权限、跨进程/供应商 seam、持久化事务和领域不变量处防御。已经通过 contract 的内部类型化调用直接使用，不重复解析，不用多层 `try/catch` 包裹同一错误。
- **证据最少但充分**：一个行为由最低层、最快且能真实证明它的测试负责。跨栈 smoke 只保留阶段关键旅程，不为每个页面和端点复制 E2E。
- **按需扩展**：为已实现能力留下稳定 interface、discriminated union、versioned policy 或 adapter seam；不创建空目录、空表、通用工厂或假想插件平台。
- **显式失败**：超出当前范围或不可恢复的错误以稳定错误码和可操作页面状态暴露；不以静默 fallback、猜测数据或吞错维持表面成功。

## 2. 最低限度的防御边界

| 边界               | 当前切片必须做                                                                    | 当前切片通常不做                                                          |
| ------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| HTTP/Server Action | session、`UserScope`、Zod contract、稳定错误映射；mutation 做 Origin/CSRF 基线    | 同一 DTO 在 handler、service、repository 重复校验；捕获所有异常后返回成功 |
| Core command/query | 所有权、领域不变量、`expectedVersion`；跨 aggregate 写入使用明确 transaction      | 校验 UI 展示细节；为理论上的第二调用方增加 service 层                     |
| PostgreSQL         | FK/check/unique 等能表达事实的约束；多写操作原子提交；migration 可重放到目标版本  | 用数据库 trigger 复制 core 规则；为未来查询提前建表和索引                 |
| 文件/AI 输出       | 类型、大小/页数等资源上限；strict schema；本地 deterministic normalizer/validator | 信任 MIME、OCR 或模型置信度；为单一 provider 建通用插件系统               |
| 队列/远程调用      | timeout；只对 transient error 有限重试；job/artifact 幂等                         | 用户输入错误重试；无 telemetry 依据的 circuit breaker 或无限补偿框架      |
| UI                 | 只消费 view model；文本安全渲染；关键操作有 loading/error/conflict；键盘可达      | 在组件重算领域规则；为每个内部状态加全局 error boundary                   |

无论“低防御性”如何取舍，以下正确性不能削减：

1. Candidate 经用户 Review Decision 后才能进入正式课程数据。
2. 每次正式读写携带 `UserScope`；私有资源越权与不存在使用相同 not-found 语义。
3. `unscheduled/date/deadline/interval` 保持不同时间语义；DST 歧义不静默选择。
4. 未知权重保持未知；成绩占比使用整数基点，`10000 = 100%`。
5. 审核写入、重试敏感命令和版本更新分别保持 transaction、幂等和乐观并发语义。
6. Evidence、原始 Candidate 和版本元数据可追踪；编辑后的 final payload 不覆盖原始提取结果。
7. 密钥、正文、Evidence quote、签名 URL 和供应商原始错误不进入普通日志或前端响应。

## 3. 单个纵向切片的固定顺序

### 步骤 1：定位阶段和变更面

1. 读取 `AGENTS.md`、`CONTEXT.md`、架构索引、实施计划和该任务触发的专门文档。
2. 检查 `git status`、现有代码、测试、migration 和 `package.json` 脚本，保留无关工作区改动。
3. 确认当前 `next` 阶段以及本切片所属 module、公开 interface 和调用者。
4. 写出本次不处理的相邻能力；只列真实边界，不列长篇未来愿望。

完成条件：Agent 能用不超过数行说明“用户会看到什么、哪个 interface 拥有行为、哪一个失败最危险、准备怎样证明”。阶段未解锁时只做用户明确授权的顺序调整或隔离 UI 原型。

### 步骤 2：定义可观察契约

为切片确定：

- 一个主场景和一个最重要失败场景；
- 输入、输出、错误 code、所有权和版本要求；
- 需要写入的最小 schema/migration；
- 页面需要到达的状态，而不是机械生成所有状态；
- 最小证明集：由哪一层测试负责哪个风险。

可逆的命名、布局和局部实现由 Agent 按现有约定决定。只有会改变产品语义、删除数据、引入新外部服务、改变隐私边界或形成不可逆架构选择时才暂停询问。

完成条件：调用方无需了解数据库或供应商类型；同一行为只有一个 module 负责；测试计划没有同义重复。

### 步骤 3：处理 UI 输入或补全缺失设计

如果本次收到网站、截图、HTML/CSS/JS 或组件代码，先执行第 4 节的 UI 流程。如果没有新输入，则读取 [UI 整合记录](../design/UI_INTEGRATION_LOG.md) 和已落地 token，从已确认页面提取的风格补全当前页面，不临时发明第二套视觉语言。

完成条件：页面结构服从 `SCOPE.md` 的职责，视觉和动效服从已确认风格；硬编码示例数据只存在于隔离 fixture/demo/test。

### 步骤 4：实现最短真实路径

按依赖方向写代码：

1. 收紧或增加目标 module 的公开类型与 command/query。
2. 实现纯领域规则和结果类型。
3. 实现当前切片实际需要的 repository/remote port 与 concrete adapter；需要多写一致性时再引入 transaction。
4. 增加 contract mapper 和 transport adapter；handler 只做 auth、parse、call、map。
5. 接入 Server Component 和最小 Client island，用真实 view model 呈现主场景及适用失败状态。

先采用语言、框架和浏览器原生能力。只有已经出现第二个真实使用点且语义相同时才抽取共享组件；只有已有库明显不能满足已确认交互时才增加依赖。

完成条件：应用能从真实入口演示该行为；生产 route 没有 mock；`core` 没有反向依赖；没有只为后续阶段存在的空实现。

### 步骤 5：补最小证明集

选择能最便宜地证明风险的层：

| 变更类型                         | 默认测试证据                                                          |
| -------------------------------- | --------------------------------------------------------------------- |
| 纯值对象/policy                  | 一个表驱动 Vitest，覆盖有效边界和一个无效边界                         |
| command/query                    | interface 测试，断言用户可观察结果、所有权或原子性；不穿透私有 helper |
| PostgreSQL/对象存储/队列 adapter | 针对该 port 的 contract test；只覆盖 concrete adapter 可能偏离的行为  |
| HTTP/DTO                         | schema/mapper contract test；只有跨浏览器行为才升级为 E2E             |
| 复杂 UI 交互                     | Testing Library 验证键盘、焦点和可见状态；静态排版以视觉检查为主      |
| ICS/稳定序列化                   | golden test                                                           |
| AI 抽取                          | deterministic fixture + gold/eval；日常 CI 不调用真实模型             |
| 已发生 bug                       | 先稳定复现，再修复；测试留在拥有该行为的最低层                        |

同一事实不同时在 unit、component 和 E2E 重复断言。覆盖率数字不是新增测试的理由；权限、时间语义、审核原子性和幂等是理由。

完成条件：目标测试先通过；若测试失败，错误能指向一个公开行为而不是 DOM 结构或 mock 调用次数。

### 步骤 6：验收和收尾

1. 先运行受影响 package 的 format/lint/typecheck/test/build，再按当前阶段门禁运行仓库脚本。
2. 对变更页面做适用 viewport、键盘、长文本、中文/英文和 reduced-motion 检查；只对关键页面保存视觉基线。
3. 删除临时 route、生产 mock、重复样式、无用 adapter、调试日志和被替代实现。
4. 更新真实行为涉及的文档、migration、UI 整合记录和阶段状态。
5. 交付报告列出结果、验证命令与结果、未验证项、UI 条目状态和下一阶段是否解锁。

完成条件：本切片独立可演示且仓库相关门禁全绿。只有阶段内全部条目通过时，才把该阶段标为 `done`、下一阶段标为 `next`；部分完成保持原状态并记录具体缺口。

## 4. 网站、HTML/CSS 和不完整 UI 的接入流程

UI 的架构规则和冲突优先级见 [前端与 UI 整合](./FRONTEND.md)。本节规定收到设计输入后的执行顺序。

### 4.1 登记原始输入

- 在 [UI 整合记录](../design/UI_INTEGRATION_LOG.md) 分配 `UI-xxxx`，记录 URL、附件/代码路径、收到日期、目标 route 和用户明确要求。
- 网站输入记录关键 viewport 的截图或可追踪描述；代码输入保留原文件，不把整段源码复制进日志。
- 用户未授权复用的第三方实现只作为视觉/交互参考；项目代码重新实现其设计意图。

完成条件：未来 Agent 能找到输入来源、知道它服务哪个页面，并能区分“必须保留”和“可适配”。

### 4.2 拆成三层并提取风格指纹

1. **视觉层**：字体尺度、色彩、间距、圆角、边框、阴影、密度、图标和响应式构图。
2. **交互层**：导航、筛选、展开、拖拽、表单、反馈、焦点和动画的状态变化。
3. **数据层**：示例字段、列表、图表和 mock 状态，逐项映射到 CourseFlow contract。

在 UI 条目中记录风格指纹：`geometry / typography / color / depth / density / motion`。第一批有代表性的 UI 形成基线；以后未被设计的页面复用同一指纹和 token，而不是照搬示例页面的业务结构。

完成条件：每个明显决定归入“保留、适配、待确认”；示例数据没有被误认成产品规则。

### 4.3 兼容 HTML/CSS 输入

- 把完整 HTML document 拆成 React/Next.js 的 route shell、feature 组件和最小 Client island；保留语义 HTML。
- 把全局色值、尺寸、圆角和 motion 合并为 CSS variables/Tailwind semantic token；局部独特构图留在 feature 内。
- 移除 CDN script、页面级 reset、全局 tag selector 和内联事件；依赖由 workspace 显式管理，样式作用域不能污染其他 route。
- CSS 动画优先使用 `transform`/`opacity` 和项目 motion token；复杂手势确有需要时再选库。
- 以当前及前一个稳定版本的 Chrome、Edge、Firefox、Safari 为兼容范围。实验 CSS 必须有可接受 fallback，核心操作不依赖 hover。

完成条件：隔离 demo 可编译，原设计的层级和交互可辨认，且没有第二套路由壳、token 源或 server truth。

### 4.4 圆角和动画基线

所有新页面保持圆角软件界面。若用户尚未提供精确数值，默认从以下语义 token 起步，收到参考后只调整 token：

- control `10px`、panel/card `16px`、dialog/sheet `20px`、pill `999px`；
- 可交互容器保持可见 focus，避免用 `overflow: hidden` 裁掉 focus ring；
- 微交互 `140–180ms`，panel/overlay `200–240ms`，页面空间变化不超过 `280ms`；
- 默认缓动 `cubic-bezier(0.2, 0.8, 0.2, 1)`，进入以不超过 `8px` 的位移加淡入表达层级，退出略短；
- `prefers-reduced-motion` 下移除非必要位移/缩放，只保留即时或短淡变；状态含义始终由文字、结构或图标同时表达。

动画服务状态、因果和空间关系；普通数据刷新不做整页入场，长列表不做大规模 stagger。

完成条件：页面有一致而克制的动态反馈，静止截图仍能完整理解；圆角、focus 和滚动容器不互相破坏。

### 4.5 补全用户没有设计的页面

Agent 按以下顺序推导：已确认 token → 已确认 primitive/pattern → 相邻页面的信息密度和布局 → `SCOPE.md` 页面职责 → 本文件规定的页面状态。补全内容包括 768/1280 桌面布局、200% zoom、loading/empty/error/conflict、长文本、键盘路径和 reduced-motion，不要求用户逐像素设计；不另行推导移动端或窄屏专用布局。

若参考视觉与领域 contract 冲突，保留视觉意图并改写 mock/data wiring；只有确实需要新产品行为时才向用户说明影响并请求决定。

完成条件：未提供设计的页面看起来属于同一产品，且不会为了像参考图而伪造数据或绕过审核。

### 4.6 接真实数据并验证

原型通过后，按 `contract -> feature props` 接入真实数据，移除生产 hard-code；验证 768/1280 桌面参考 viewport、200% zoom、键盘、中文/英文、长内容及所有适用状态。更新 UI 条目为 `integrated`，视觉、行为和无障碍检查通过后改为 `verified`。

完成条件：原始视觉意图逐项有结论，旧实现被清理，生产 route 只依赖真实 query/command。

## 5. 已知能力的后续扩展位置

“留扩展位置”指当前 MVP 已使用的小型 seam，不指预建未来系统。

| 能力                           | 当前稳定扩展位置                                                           | 后续新增方式                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 登录/身份                      | web composition root 中的 auth session port                                | 选定 provider 后新增 adapter；core 继续只接收 `UserScope`                                     |
| 学期与课程                     | `AcademicsCommands/Queries` 和 module `index.ts`                           | 新行为增加意图明确的 command/query；不暴露通用 CRUD repository                                |
| 课表与校历例外                 | Academics 的 `MeetingPattern/Exception` + Schedule 的 occurrence expansion | 新课节类型/例外先扩展 enum/union 和展开测试；不预生成每周实例表                               |
| 课程事项/标签/评分             | `PlanningCommands/Queries`、temporal union、label 与 grading aggregate     | 新 kind/规则先更新领域类型、migration、contract 和 interface 测试；任务分组和当前成绩保持派生 |
| PDF/图片及未来格式             | `DocumentPreparationPort`                                                  | 每种新格式增加 adapter；统一输出 `PreparedDocument`                                           |
| AI/OCR 供应商                  | `ExtractionPort`/可选 OCR port                                             | 新 provider 只在 infrastructure/composition 替换；core 不接 SDK 类型                          |
| 对象存储/任务队列              | 使用模块拥有的 port                                                        | 增加 concrete adapter；不建立运行时插件市场                                                   |
| Evidence 展示/定位             | versioned Evidence locator contract 与 `EvidenceViewer` view model         | 新坐标/媒介 variant 先扩展 union 和 mapper；页面不读取 raw provider output                    |
| Source 删除/数据清理           | ingestion lifecycle command、对象清理 port、幂等 cleanup job               | 新派生产物登记到清理清单；正式记录是否保留由显式产品规则决定                                  |
| 审核策略                       | versioned schema、normalizer、confidence policy                            | 发布新版本并保留旧 run 的解释元数据                                                           |
| 今日课表/任务/雷达/热力图/冲突 | `ScheduleSnapshot` 和 versioned pure policy                                | 新投影从同一正式 snapshot 计算；不复制下一节课、分组或页面口径                                |
| ICS/未来导出                   | 中立 `CalendarEvent[]` 与 serializer adapter                               | 新格式增加 serializer；通知功能另立产品 contract 后再实现                                     |
| 统计洞察                       | `InsightQueries` + 显式 calculator registry                                | 每个已定义 Insight 增加纯计算器、定义和测试；不接受动态 SQL                                   |
| UI/新页面                      | semantic token、primitives、patterns、feature view model                   | 第二个真实复用点出现后提升组件；设计输入走 UI log                                             |
| 设置、语言和显示               | profile/settings command、message key、`Intl`、locale/time-zone view model | 新偏好先定义影响预览和默认值；领域值不存本地化字符串                                          |
| 可观测性                       | 固定 event schema、`requestId/runId/jobId` context                         | 新 stage 增加低基数事件字段；正文和凭据保持在日志边界之外                                     |
| 部署与供应商配置               | 类型化 config 与 web/worker composition root                               | 通过 adapter/config 更换平台；不把部署选择写入 core                                           |

## 6. P0–P6 详细实现与门禁

### P0：仓库与质量骨架

按顺序实现：

1. 建立 pnpm workspace、根脚本和锁文件；创建能实际启动的 `apps/web`、`apps/worker` 与最小 `packages/core`，不批量创建空 feature。
2. 开启 TypeScript strict、formatter、ESLint 和模块依赖限制；`core` 禁止导入 React/Next/Drizzle/供应商 SDK，模块间禁止深路径 import。
3. 配置 Vitest、Testing Library、Playwright 和固定 `Clock`/ID generator；测试工具只进入 test-support。
4. 建立 Drizzle schema/migration 入口、PostgreSQL 与 S3-compatible 本地依赖；空库可迁移，web/worker 使用各自 composition root。
5. 建立启动时一次性 Zod config、结构化 logger、`requestId` 传播、health/readiness；错误日志不含 secrets。
6. 建立最小 web app shell、CSS token 文件和可访问 focus 基线。没有 UI 参考时保持中性，不在 P0 猜完整设计。
7. 建立 CI 和 README 唯一启动路径；安装、格式、lint、typecheck、unit、migration、build 和一个“应用可打开”的 Playwright smoke 使用与本地相同脚本。

最低证明集：config 的一个失败样例、core 依赖限制的故意违规 fixture、空库 migration、web/worker health、一个浏览器启动 smoke。

阶段验收：全新工作区按 README 能启动依赖、web 和 worker；所有门禁通过；没有业务 mock 页面冒充已完成功能。通过后把 P0 标为 `done`、P1 标为 `next`。

### P1：学期、课程、课表、任务与成绩闭环

按纵向切片实现：

1. 用开发身份 adapter 打通 auth seam，所有 repository operation 接受 `UserScope`；生产 provider 保持可替换但不做空工厂。
2. 实现 Academic Term、Academic Calendar Exception、Course、Meeting Pattern/Exception 值与 commands/queries，包括 IANA 时区、Reading Week、Lecture/TUT/PRA、多个课节、地点、学分、active term、归档和 `expectedVersion`。
3. 实现 `CourseItemTemporal` 四种 variant、Course Item 状态/负荷、Task Label、Grading Scheme、Grade Result 和 Letter Grade Scale；权重/bonus/等级边界异常返回明确 warning/error。
4. 完成手工创建/编辑/取消/删除事项、标签关联、保存评分方案与手工成绩结果的 command，使用真实 transaction 和版本控制；不把未出分当零分。
5. 增加 Zod HTTP contract、Problem Details mapper 与薄 Route Handler；Server Component 直接调用相同 query interface。
6. 完成 `/terms`、`/courses`、`/courses/new` 分步添加多个课节、课程总览、timeline、Gradebook 和 dashboard 从空状态到课程摘要的真实页面；表单保留输入并显示 validation/version conflict。`/tasks` 先以真实事项/标签列表完成基础闭环，P2 再接派生分组与优先级。
7. 在进入大量页面实现前固化第一版全局 UI 风格指纹、圆角、字体、颜色、导航和 motion token；用户已宣布设计完成时，先按 [前端设计基线与冻结](../design/DESIGN_BASELINE.md) 引用已确认版本和页面/状态矩阵，未覆盖状态由 Agent 在同一系统中补全。

最低证明集：

- 一个表驱动领域测试覆盖四种 temporal、课节/Reading Week/DST gap-overlap、成绩覆盖与等级边界；
- Academics/Planning interface 测试覆盖成功、另一用户不可读和 version conflict；
- PostgreSQL migration/ownership contract；
- 一个 canonical E2E：创建学期/Reading Week → 创建含多个课节的课程 → 新增带标签事项 → 录入一个成绩结果 → 刷新后在课程/timeline/Gradebook 可见。

阶段验收：真实持久化、无生产 mock；另一用户猜 ID 读不到；课节/例外、四种事项时间语义、标签、未出分/成绩覆盖与评分 warning 可观察；768px 桌面参考 viewport、200% zoom 与键盘主路径可用。通过后解锁 P2。

### P2：总览、任务分组、热力图、冲突与 ICS

按顺序实现：

1. 定义有界 `ScheduleSnapshot` 查询，一次读取当前范围内正式课节规则/例外、课程事项、课程身份和显示设置；候选永不进入 snapshot。
2. 实现纯 Meeting Expansion、Term Progress、TaskGroupingPolicy、WorkloadPolicy、ConflictPolicy 和日期分桶；明确 Reading Week、单次改期/取消、TBA、归档、completed、cancelled/deleted 语义。
3. 用同一 snapshot 完成 dashboard 学期进度/今日课表/下一节课、`/tasks` 的“先完成/本周推进/持续准备”、热力图明细、hard overlap/deadline cluster、单课程 timeline 和 `/calendar`。
4. 构建中立 `CalendarEvent[]` 与 ICS serializer；稳定 UID、all-day、exact interval、escaping/folding、skipped TBA summary 均由 contract 表达。
5. 为热力图提供文本等价视图，为冲突提供非颜色标签；页面只显示 policy 计算结果。
6. 在阶段结束前完成常规 MVP 页面的 UI 定型：dashboard、课程、timeline、calendar、表单、导航、响应式和 motion。导入审核的专有细节可留到 P3。

最低证明集：policy 表驱动测试覆盖 Reading Week/课节例外、下一节课状态、时区换日、短期 7 天边界、`[start,end)`、TBA 和归档/取消；ICS golden；ScheduleQueries interface 测试；扩展 P1 的 canonical E2E 到 dashboard/tasks/日历下载，不另建同义 smoke。

阶段验收：同一正式课节/事项在所有投影语义一致；Reading Week 不生成常规课节，下一节倒计时目标正确；TBA 不进热力图/具体日历格/ICS；短期/中长期和标签筛选一致；热力图可非视觉理解；重新导出 UID 稳定。通过后解锁 P3。

### P3：上传、确定性导入与审核闭环

按顺序实现：

1. 实现 Source Document、ordered Asset、Import Run、Artifact、Evidence、Candidate、Review Decision/Application schema、状态机和 migration。
2. 实现对象存储 port 与 production/local/test adapter；浏览器预签名直传，complete 时服务端重新验证对象 metadata 与所有权。
3. 实现 PostgreSQL queue、worker claim/heartbeat/lease/retry/cancel 和 artifact 幂等键；worker 角色不能写正式 planning 表。
4. 先接 `FixtureExtractionAdapter`，让获授权测试 PDF/图片确定性产生 Prepared Document、Evidence 和 Candidate，不调用真实 AI。
5. 实现上传计划、导入进度/历史、ETag 轮询和可恢复失败状态。
6. 实现 `reviewCandidate` transaction：锁定 Candidate，验证 decision/application，调用 `planning.applyReviewedCandidate`，原子写正式记录和审核记录；覆盖 create/update_existing/reject/duplicate 与 idempotency/version conflict。
7. 完成全局 `/sources`、`/courses/[courseId]/sources` 和 `/imports/[runId]`。默认使用候选/编辑与 Evidence 双区；200% zoom 等受限桌面呈现切换或纵向排列 pane；所有决策明确写入目标和影响。
8. 在 P3 结束前把全局资料入口、上传、进度、审核、Evidence 及其 loading/empty/error/conflict UI 定型，并清理隔离 demo。

最低证明集：状态机/审核 interface 测试覆盖重放、same-key different-body、target version rollback 和来源删除；对象/队列/PostgreSQL contract；一个 canonical E2E：上传 fixture → worker → 审核四类决定中的代表路径 → 正式 timeline/dashboard。它取代冗余上传 smoke。

阶段验收：审核前所有正式视图不变；审核后 Evidence、Decision 与正式记录可追溯；worker 重放不重复写；失败可安全 retry；UI 能完成键盘审核。通过后解锁 P4。

### P4：真实 PDF/图片与 AI 提取

按顺序实现：

1. 实现受资源限制的 PDF text/page image 和 ordered image `DocumentPreparationPort` adapter；页码从 1 开始，顺序不靠文件名猜测。
2. 定义并版本化 strict extraction JSON Schema、prompt 和 provider request mapper；模型只产 Candidate 草稿与 Evidence locator。
3. 实现首个真实 `ExtractionPort` adapter，配置 pinned model、timeout、并发、有限 transient retry 和 provider file cleanup。
4. 实现纯 normalizer/validator：Unicode、枚举、明确日期、bps、Evidence bbox/path、fingerprint、重复/匹配/warning；歧义保持 TBA。
5. 建立去身份化 fixture corpus、gold JSON/Evidence 和 baseline report，覆盖文本 PDF、扫描件、截图、表格、相对日期、替代评分和中英混合。
6. 增加 stage/cost/schema failure telemetry，日志只记录 ID、版本、耗时、计数和错误 code。
7. UI 只补真实 provider 带来的 warning、失败和数据质量状态；P4 不重新设计主导航或核心页面结构。

最低证明集：normalizer 表驱动测试、provider adapter contract（成功/timeout/schema failure）、全 corpus eval；沿用 P3 浏览器旅程和 deterministic fake，真实模型 eval 作为受控门禁，不新增易波动浏览器 smoke。

阶段验收：关键字段有 Evidence 或 `EVIDENCE_UNVERIFIED`；旧 run 可由版本解释；provider failure 不产生正式数据；cleanup 和数据保留可验证；baseline 达到团队在首次报告中记录的阈值。通过后解锁 P5。

### P5：UI 整合与体验打磨

按顺序实现：

1. 补完 Grade Component 与 Course Item 关联、复杂 `ruleText`、alternative scheme、成绩覆盖/等级表 partial 状态和 update diff 的真实 UI，不把规则扁平为错误数字，不扩展成 GPA/预测。
2. 清点 UI log，把所有 `received/mapped/prototyped/frozen` 条目逐个整合或明确 superseded；晚到 UI 作为迁移，不另建页面壳。
3. 合并同义 token/primitive，清理旧 CSS、重复图标、临时 fixture 和被替代组件；保持页面独特构图。
4. 完成中文/英文文案结构、长 Unicode、768/1280 桌面参考 viewport、200% zoom、键盘/focus、对比度、reduced-motion 和热力图等价视图。
5. 对 dashboard/import review 做真实数据 profile，只修复已测得的 N+1、过量 client JS、图片加载或渲染瓶颈。
6. 为核心 route 建立少量稳定视觉基线和 axe 检查；保留一个 canonical product E2E，不扩张成每页 smoke 套件。

最低证明集：非原生复杂交互的 component/a11y 测试；核心 viewport 视觉基线；canonical E2E；production build/bundle 与真实数据 profile 记录。

阶段验收：所有 UI 输入有最终映射；核心 route 属于同一风格、保持圆角和克制动画；生产无 mock/旧实现；关键浏览器与可访问性检查通过。通过后仅在 Insight 已明确时解锁 P6。

### P6：已定义统计洞察

P6 只有在用户明确首批 Insight 的名称、决策用途、输入范围、口径和最小数据量后开始。

1. 为每个 Insight 写 definition、范围、data-quality 与不足状态。
2. 基于正式 `ScheduleSnapshot` 或专用只读 snapshot 实现纯 calculator。
3. 用显式 registry 接入 `InsightQueries`；不执行数据库中保存的 SQL/代码。
4. 按 `InsightValue` 类型选择表格/图表，显示定义、范围和数据质量；不足时显示真实空状态。
5. 使用小型人工 fixture 对算式和可视化逐项核对。

最低证明集：每个 calculator 一个可手算 fixture 与边界；query interface test；图表的文本等价和 component test。除非新增了跨页面关键旅程，不增加 E2E。

阶段验收：每个数字可解释、可复算且只来自正式数据；没有虚构图表、动态 SQL 或通用插件框架。

## 7. 阶段交付格式

Agent 完成切片或阶段时按以下顺序报告：

1. **结果**：用户现在能完成什么。
2. **范围**：所属阶段、module/interface、明确未做内容。
3. **验证**：实际运行的命令及通过/失败/未运行原因；不要只写“测试通过”。
4. **UI**：相关 UI ID、验证 viewport、键盘/reduced-motion 结果。
5. **门禁**：逐项说明阶段完成标准，未满足即不标 `done`。
6. **下一步**：已解锁阶段或唯一具体缺口。

提交、推送、部署、外部消息和数据删除仍需用户明确授权；阶段完成本身不隐含这些操作。
