# 前端架构与 UI 代码整合

本文规定页面如何读取 CourseFlow 数据，以及如何把用户分批提供的页面代码整合为一个一致产品。目标是保留用户的视觉意图，同时让页面共享 token、primitives、状态模型和真实 contract。

## 1. 前端分层

```text
apps/web/
├─ app/                         # URL、layout、loading/error/not-found、Route Handler
├─ features/
│  ├─ dashboard/
│  ├─ courses/
│  ├─ tasks/
│  ├─ grading/
│  ├─ imports/
│  ├─ sources/
│  ├─ calendar/
│  └─ insights/
│     ├─ components/            # 只服务该 feature
│     ├─ mappers/               # contract -> UI-specific props（确有需要时）
│     ├─ actions/               # 客户端 mutation 协调，不含领域规则
│     └─ state/                 # 交互状态；不得复制 server truth
└─ composition/                 # query/command adapter 装配

packages/ui/
├─ styles/tokens.css            # 色彩、字体、间距、圆角、阴影、motion token
├─ primitives/                  # Button、Dialog、Tabs、Field、Tooltip 等
├─ patterns/                    # PageHeader、EmptyState、StatusBanner、DataTable
└─ courseflow/                  # CourseBadge、DateBadge、EvidenceViewer 等跨 feature 组件
```

依赖方向：route 组合 feature；feature 使用 `packages/ui` 和 `packages/contracts`；`packages/ui` 不 import feature、core 或 Next.js route。业务组件属于 feature，只有在第二个真实 feature 复用且语义相同后才提升。

## 2. Server 与 Client Component

- `page.tsx`、`layout.tsx` 默认 Server Component，负责 auth 后的 query、权限作用域和首屏组合。
- 只有需要事件、局部表单状态、拖拽、浏览器文件 API、canvas/测量或实时交互的最小子树标记 `"use client"`。
- Server Component 将 JSON-safe view model 传给客户端岛；不传 repository、class instance、数据库 Date 或 server function 集合。
- mutation 可以通过 Route Handler 或小型 Server Action adapter 调用同一 command interface。上传进度、多步审核和需要可观察 HTTP contract 的操作优先 Route Handler。
- 客户端 cache 只管理服务器状态的读取体验，不成为第二真相；mutation 成功后按 route/tag 失效或更新明确 cache key。
- URL 保存可分享状态：当前 tab、course filter、日期范围、审核 filter。短暂视觉状态（弹窗、hover）留在本地。

## 3. View model，而非数据库实体

页面只接收针对任务的 view model。例如：

```ts
type DashboardSnapshot = {
  term: TermHeaderView;
  generatedAt: string;
  displayTimeZone: string;
  termProgress: TermProgressView;
  todayMeetings: MeetingOccurrenceView[];
  nextMeeting: NextMeetingView | null;
  upcoming: UpcomingItemView[];
  workload: WorkloadCellView[];
  conflicts: ConflictView[];
  pendingReview: PendingReviewSummary;
  dataQuality: DashboardDataQuality;
  policyVersions: { workload: string; conflict: string };
};
```

组件不自己重新判断“某事项是否临近”“某周有多忙”“两个考试是否冲突”。这些字段由 `schedule` module 计算，组件只负责选择恰当视觉表现。格式化层可以按 locale 显示时间，但不能改变时间语义。

同样地，页面不自行展开周期课节、跳过 Reading Week、挑选下一节课、把任务分成短期/中长期，或计算当前成绩。对应真相分别来自 `ScheduleSnapshot`、`TaskBoardSnapshot` 和 `GradebookSnapshot`。客户端倒计时只根据 `nextMeeting.startsAt` 与 `generatedAt` 平滑更新，定期/重新聚焦后刷新 server snapshot。

## 4. 页面组合模式

每个 route 实现其数据流和交互中实际可达的以下状态，而不只实现 happy path；不为不可达状态增加模拟分支：

| 状态                     | 呈现要求                                                 |
| ------------------------ | -------------------------------------------------------- |
| `loading`                | 保持最终布局轮廓，关键卡片 skeleton 尺寸稳定             |
| `empty`                  | 说明为什么为空，并给唯一主要下一步；不放虚构数据         |
| `partial`                | 部分卡片可用，局部错误留在局部；显示数据质量提示         |
| `error`                  | 可恢复错误给 retry；request ID 可复制；不暴露内部详情    |
| `stale/conflict`         | 保留用户输入，展示最新 server truth 并允许重新应用       |
| `offline`                | 明确说明变更未保存；MVP 不宣称离线同步                   |
| `success`                | 操作结果靠页面状态变化可见；toast 只是补充，不是唯一反馈 |
| `unauthorized/not-found` | 私有资源统一 not-found 语义，避免泄露存在性              |

`loading.tsx`/`error.tsx` 只处理 route segment 级状态；表格、Evidence preview、图表等局部模块使用自己的 error/loading presentation。

## 5. 设计系统约定

### 5.1 Token 层

视觉值先命名再使用。`tokens.css` 至少定义：

- 语义表面：`--surface-canvas/raised/sunken/overlay`
- 文本：`--text-primary/secondary/muted/inverse/danger`
- 边框与 focus：`--border-subtle/strong`、`--focus-ring`
- 状态：info/success/warning/danger 的背景、前景、边框三元组
- 课程色板：固定数量的可访问 `course-1..N` 语义键及其浅色背景
- 字体：display/body/mono family、size、line-height、weight
- 空间、圆角、阴影、z-index 和 motion duration/easing

业务代码使用语义 token，不写孤立 hex、任意 `z-[9999]` 或每页一套 shadow。若用户提供片段含新视觉值，先判断它代表新语义还是现有 token 的不同写法；只有新语义才扩展 token。

### 5.2 Primitive 层

Primitive 负责键盘行为、焦点、ARIA 和基础 variant；不理解课程或截止日期。优先级：

1. 复用现有 primitive。
2. 扩展现有 primitive 的通用 variant。
3. 引入项目持有的可访问 primitive。
4. 只有行为/语义确实不同才新建。

### 5.3 CourseFlow 语义组件

建议在出现真实使用时逐步建立：

- `CourseBadge`：课程代码、颜色和无色辅助标识。
- `MeetingTypeBadge`：Lecture/Tutorial/Practical 的全称、可选缩写与非颜色区分。
- `MeetingTimePlace`：课节实例的起止时间、地点/TBA 和改期/停课状态。
- `TemporalLabel`：date/deadline/interval/unscheduled 的一致显示和 tooltip。
- `ConfidenceIndicator`：置信度及文字，不只用颜色。
- `EvidenceViewer`：页图、bbox、quote、字段关联和键盘导航。
- `ImportStatus`：状态机的用户语言映射。
- `WorkloadLegend`：分钟、来源和 policy 的解释。
- `ConflictCard`：硬冲突、拥挤提醒和数据质量提示的不同语义。
- `GradeCoverageSummary`：已获总评百分点、已出分部分百分比、已覆盖权重和数据质量。
- `TaskLabelList`：系统标签与自定义标签的可访问展示；不承担筛选规则。

这些组件只消费 view model，不调用 fetch 或 core。

### 5.4 当前全局视觉与兼容基线

当前已有 [UI-0001 visual lab](../design/UI_INTEGRATION_LOG.md#ui-0001-courseflow-visual-lab)，但它仍是可变原型而非冻结权威。设计期间以其风格指纹作为工作方向；用户明确完成设计后，必须先按 [前端设计基线与冻结](../design/DESIGN_BASELINE.md) 建立 Git 可追踪版本，生产实现才以该版本的具体 token、构图和交互为准：

- 产品以桌面 Web 应用为主，用户提供的 HTML/CSS/JS 需要拆成 React/Next.js route、feature 和最小 Client island，不能把完整 document、全局 reset、CDN script 或内联事件直接粘入生产页面。
- 软件界面保持圆角。无明确参考时使用 control `10px`、panel/card `16px`、dialog/sheet `20px`、pill `999px` 的语义 token；收到设计后可以统一校准，但不让页面各自选择半径。
- 页面应有克制动画。简单反馈优先 CSS `transform`/`opacity`，微交互约 `140–180ms`、overlay 约 `200–240ms`，并提供 `prefers-reduced-motion` 等价体验；状态含义不依赖动画。
- 兼容当前及前一个稳定版本的 Chrome、Edge、Firefox、Safari。实验 CSS 有可接受 fallback，核心操作支持键盘和非 hover 输入。
- 未被用户完整设计的页面，从已确认 UI 的 geometry、typography、color、depth、density 和 motion 推导相同风格，再按 `SCOPE.md` 补齐内容和状态。

## 6. 用户提供 UI 代码的整合协议

每次收到页面、组件或样式代码后，agent 按下面顺序执行。未完成当前步骤的完成标准前，不进入下一步。

每个重要片段在 [UI 整合记录](../design/UI_INTEGRATION_LOG.md) 建立一行，并在同文件的条目区保存视觉意图、映射和验收结论。微小样式修正可以合并进已有条目，避免为每次对话制造文档碎片。

用户宣布一批设计完成时，先执行 [设计冻结流程](../design/DESIGN_BASELINE.md#3-冻结流程)，再开始本节的生产接入；不能把被忽略的本地实验文件直接当作长期 contract。

### 第一步：记录视觉意图

在改代码前列出该片段表达的：页面任务、信息层级、关键布局、交互、响应式意图、色彩/字体/间距、圆角和 motion，以及 loading/empty/error 是否存在。网站输入记录 URL、日期和关键 viewport；代码输入保留原文件位置，不在日志复制整段代码。

完成标准：每个明显设计决策都被归入“保留、适配、待确认”之一，并形成 `geometry / typography / color / depth / density / motion` 风格指纹；不能仅凭截图相似度开写。

### 第二步：建立映射清单

将片段逐项映射到现有系统：

| 片段内容         | 目标                                        |
| ---------------- | ------------------------------------------- |
| 页面/route shell | `apps/web/app` 的既有 layout/route          |
| 可复用视觉基础   | `packages/ui/primitives` 或 `patterns`      |
| 页面业务组合     | 对应 `features/<feature>`                   |
| hard-coded 数据  | contract fixture，随后替换为真实 view model |
| 随机颜色/尺寸    | 现有 token；若无匹配则提出一个新语义 token  |
| fetch/状态逻辑   | 既有 query/action；不得复制 core 规则       |

完成标准：每个顶层组件、数据字段和交互都有唯一归属；没有两套路由壳、导航或 token 源。

### 第三步：隔离并验证原型

若代码不完整或依赖未知，先放入开发专用 route/story/demo，以 fixture contract 渲染；修正编译、响应式、键盘和依赖问题。HTML/CSS 输入先移除页面级 reset、全局 tag selector、CDN/inline script 和内联事件，再映射 semantic token。开发 demo 不进入生产导航，不 import 生产 repository。

完成标准：原型能独立渲染所有状态，且未改变正式页面数据流。

### 第四步：提取 token 与 primitive

只提升确有跨页面复用价值的视觉基础；保留页面独特构图。合并同义 token/variant，不把整张页面拆成几十个薄 wrapper。

完成标准：新代码没有重复现有 primitive 行为；token 命名表达语义；删除已被替代的局部实现。

### 第五步：接入真实 contract

用 feature adapter 把 view model 接入组件。移除 hard-coded 课程、日期和百分比；fixture 只保留在测试/story 中。所有 mutation 使用稳定 command contract 并处理 validation/version conflict。

完成标准：生产 route 中没有 mock 数据；页面不 import infrastructure；成功、空、错误和冲突状态均可由真实 contract 到达。

### 第六步：视觉回归与清理

在桌面和移动 viewport 截图比对，运行 a11y/E2E，检查长课程名、中文/英文、极端日期和大量候选。删除旧页面、未使用样式、重复图标和临时 adapter。

完成标准：视觉意图清单逐项验证；旧实现只有在仍有独立职责时保留；测试和 lint 通过。

## 7. 冲突处理优先级

用户提供的代码与现有系统冲突时，按以下顺序裁决：

1. 正确性、安全、隐私和无障碍硬约束。
2. `CONTEXT.md`、领域不变量和 contract。
3. 用户明确说明的视觉/交互意图。
4. 已确认的设计 token 与全局导航行为。
5. 片段中的具体实现技巧和临时 mock。

视觉差异不会成为重写领域/数据层的理由。若保留设计意图需要改变产品行为，agent 应指出具体冲突和影响，再请求决定；样式层面的合理映射可以直接完成。

## 8. 关键页面结构

### 8.1 Dashboard

按当前已确认 UI 保持以下信息层级：

1. 当前本地日期、当前学期与学期进度摘要。
2. 今日课程及下一节课倒计时/地点；没有后续课程、正在上课和 Reading Week 都有稳定状态。
3. “下一步”、本周负荷与临期小任务。
4. 待审核/风险提示，以及接下来若干周的重要评估。
5. 由真实 snapshot 支撑的课程/计划入口。

构图、卡片次序和响应式重排服从 UI 基线。语义上首先回答“下一步是什么”；课节与任务不能混成同一种可勾选行。

### 8.2 Import Review

默认采用“候选列表/编辑 + Evidence 预览”的双区结构；200% zoom 等受限桌面呈现可切换或纵向排列 pane，不能压缩到信息或操作不可用。

- 顶部：资料名、状态、总进度、筛选和退出提示。
- 候选：类型、标题、日期、权重、confidence、warning、字段级 Evidence 入口；匹配已有项时展示字段差异。
- 决策栏：作为新记录接受、更新已有记录、编辑后接受、拒绝、仅标重复；更新显示目标名称/version，destructive/批量动作需要明确范围。
- Evidence：显示页码、quote、bbox；quote 与图像不匹配时标注未验证。
- 键盘：候选前后切换、打开 Evidence、保存决定均可达；快捷键不能覆盖文本输入。

### 8.3 Timeline/Calendar

- Calendar 同时容纳派生的 `MeetingOccurrence` 和有确定日期的 `CourseItem`；卡片显示“Lecture/Tutorial/Practical”或“截止/考试”等文字类型，不能只靠课程色。
- Timeline/任务包含有日期区和 TBA 区，按课程色彩但同时显示课程代码。
- Reading Week 抑制的课节不显示成普通事件；明确改期/保留的实例显示状态。Today/next meeting 与 calendar 必须来自同一 occurrence 集合。
- Calendar cell 中优先显示紧迫事项；溢出用 “+N” 打开可访问列表。
- 不在客户端重新计算时区分桶。服务端 view model 提供 display date/time 和排序 key。
- ICS 下载前显示过滤范围、显示时区和 skipped TBA 数量。

### 8.4 Insights

路由和页面框架可以先上线：标题、范围 selector、指标解释位置和无足够数据状态。没有已定义 Insight 时显示建设中的真实说明，不插入随机图表。后续每个 Insight 组件接收通用 `InsightValue` union（number/duration/percentage/distribution 等）和 definition，而不是直接查询数据库。

### 8.5 Courses、Tasks 与 Gradebook

- `/courses` 保持当前 UI 的“课程列表 + 选中课程摘要”；真实 route 可让选中课程进入 URL/search params，不能只存在内存。
- 添加课程使用分步表单：学期/基本信息 → 多个课节 → Reading Week/冲突预览 → 核对保存。每一步可返回且保留输入；课程允许无课节保存。
- `/tasks` 保持当前 UI 的“先完成 / 本周推进 / 持续准备”和筛选栏。分组、倒计时与重要性由 `TaskBoardSnapshot` 给出；自定义标签追加在现有 badge family 中，不生成竞争性布局。
- Gradebook 作为课程支持 surface 接入当前课程页的“成绩组成”入口。每项结果表单录入 earned/possible；摘要同时显示总评百分点、已出分百分比和覆盖权重。长期任务上的 `progress` 明确标为准备进度，不能复用成绩百分比组件。无等级表、未知权重或未出分都用明确空/partial 状态。
- 课程学分只作为课程元数据展示；首版 UI 不出现 GPA 或“已获得学分”的误导性结论。

当前 UI 未覆盖的添加课程与 Gradebook surface 按设计基线 token 补齐，并遵守 `typeui-fundamentals` 的结构性约束：每步只有一个清晰主操作；相关字段用 proximity 成组；输入在静止态就有可见边界；同排输入/按钮等高、相邻按钮同尺寸且标签不换行；200% zoom 等受限桌面呈现改为单列并把操作移到可见 footer，不横向压缩表单。步骤标题、说明、错误摘要和字段标签保持真实语义层级，不能用 placeholder 替代 label。

### 8.6 Sources

- `/sources` 保持当前 UI 的全局资料库构图：按课程筛选、项目文件夹、原始资料列表与审核队列；它使用有界的用户/学期资料 query。
- `/courses/[courseId]/sources` 是同一 sources feature 的课程上下文投影，负责上传、历史批次和课程内审核入口；不维护第二套资料实体或样式系统。
- `/imports/[runId]` 承担完整进度/错误/审核工作台。全局资料页只摘要状态并导航，不把复杂审核 transaction 塞进列表卡片。

## 9. 表单与反馈

- React Hook Form 等库只在复杂客户端表单有真实收益时引入；简单 server form 使用原生表单和 contract schema。
- client/server 共用输入 Zod schema 的可序列化部分，但 server 永远重新校验。
- 字段错误紧邻字段，同时在提交处提供 error summary 并移动焦点。
- 日期编辑器必须允许键盘直接输入；UI calendar 只是辅助。
- 长任务返回 Import Run，不让按钮旋转到超时。上传和解析分别显示状态。
- destructive action 显示具体对象名和影响；归档与删除使用不同文案。
- toast 用于跨页面确认或次要反馈；关键错误和结果在页面中持久展示。

## 10. 桌面适配、国际化与无障碍

- 产品不提供移动端或窄屏专用应用布局；以 `768x1024` 和 `1280x900` 为桌面参考 viewport。浏览器缩放导致空间受限时按内容优先级重排；本质二维的表格、日历和热力图可在语义完整的自身容器内横向滚动。
- 支持至少 `zh-CN` 和英文文案结构；禁止用字符串拼接构造带变量句子。日期/数字用 `Intl` 和用户 locale。
- 课程标题、老师名、Evidence quote 可包含任意 Unicode；布局测试长词和 CJK。
- WCAG 2.2 AA 为目标：语义 HTML、可见 focus、键盘完整、对比度、44px 左右 touch target、错误不只靠颜色。
- Focus indicator 立即出现且不被 sticky header/footer 遮挡；向导切步后把焦点移到新步骤标题，校验失败移到错误摘要并保留所有输入。
- 动画只说明状态/空间关系，尊重 `prefers-reduced-motion`；导入/审核的状态不能依赖动画才能理解。
- 热力图提供文本/列表等价视图和数值 tooltip；颜色强度之外显示可读等级或分钟。

## 11. 前端验证清单

每个完成的 route 至少验证：

- `768x1024`、`1280x900` 桌面参考 viewport；200% zoom（不把缩放后的布局定义为移动端设计）。
- 键盘从页面头到主操作无陷阱，Dialog 关闭后焦点返回触发点。
- light/dark（若当前版本承诺 dark）和高对比状态。
- 中文、英文、超长课程名、0 条/1 条/大量条目。
- loading、empty、partial、error、version conflict、success。
- temporal 四种 variant；时区与 DST 边缘示例。
- 无颜色截图仍能区分课程、confidence 和 conflict severity。
