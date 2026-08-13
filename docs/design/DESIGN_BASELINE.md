# CourseFlow 前端设计基线与冻结

本文规定如何把持续修改的网页视觉稿变成后续 Agent 必须遵守的、可追踪且可验证的 UI 合约。页面的数据职责、React/Next.js 分层和 UI 片段迁移仍以 [前端架构与 UI 整合](../architecture/FRONTEND.md) 为准。

## 1. 三类工件

| 工件       | 用途                                            | 是否权威               | 是否允许原地修改   |
| ---------- | ----------------------------------------------- | ---------------------- | ------------------ |
| 视觉实验室 | 设计对话中快速修改 HTML/CSS/JS                  | 否                     | 是                 |
| 冻结基线   | 用户确认版本的 HTML、截图、token、页面/状态矩阵 | 是，约束具体视觉与交互 | 否；变更建立新版本 |
| 生产实现   | React/Next.js、真实 contract 和可访问交互       | 必须匹配冻结基线       | 按开发流程变更     |

当前最新视觉实验室是仓库根目录的 `courseflow-visual-lab-glass.html`。它被 `.gitignore` 排除，采用用户确认继续发展的模糊玻璃方向，适合继续设计，但后续 Agent、CI 和历史版本都不能稳定依赖它。`courseflow-visual-lab.html` 保留为此前非玻璃实验稿；已冻结的 `ui-v1` 仍是唯一 Git 可追踪视觉权威。玻璃稿登记为 `UI-0003 / prototyped`，尚未冻结；设计完成前保持它为本地可变文件。

冻结基线负责视觉事实，产品和领域文档负责行为事实。冲突按 [前端冲突处理优先级](../architecture/FRONTEND.md#7-冲突处理优先级) 裁决；无障碍、安全、隐私与领域正确性不会为了像素相似而降级。

## 2. 基线目录

每次确认建立一个不可变版本，不覆盖旧版本：

```text
docs/design/baselines/ui-v1/
├─ BASELINE.md                 # 版本、来源 hash、覆盖范围、token、允许差异
├─ SCREEN_MATRIX.md            # route、状态、viewport、主题、交互与截图映射
├─ reference/
│  └─ courseflow.html          # 从视觉实验室逐字复制的冻结快照
└─ screenshots/
   └─ 1280x900/
```

程序化视觉测试在应用初始化后放入既有 Playwright 测试结构；不要为了符合上面的示意另建第二套测试框架。基线截图是人工可读的设计事实，测试快照是生产实现的回归门禁，两者必须在 `SCREEN_MATRIX.md` 中能互相对应。

## 3. 冻结流程

只有用户明确说“设计完成/冻结为某版本”后执行本节。冻结不是把实验室直接改成生产代码。

### 第一步：锁定范围

登记：

- 基线版本，例如 `ui-v1`，以及对应 UI ID。
- 已确认页面、弹窗、导航、主题和关键交互。
- 用户明确允许 Agent 按同一系统推导的页面或状态。
- 尚未决定的产品行为、文案和数据口径。

将原型页面映射到 `SCOPE.md` 的真实 route。原型新增了产品范围中没有的 route 或行为时，先更新产品范围并获得用户确认；视觉稿里的链接不能偶然定义产品架构。

完成标准：每个可达页面和主要交互都有“已覆盖 / 可推导 / 待确认”之一，没有含糊的“差不多都算确认”。

### 第二步：建立页面与状态矩阵

`SCREEN_MATRIX.md` 每行至少记录：

| 字段            | 含义                                                       |
| --------------- | ---------------------------------------------------------- |
| Route / surface | 生产 route 或 overlay，不使用原型内部名称代替              |
| Reference state | 基线 HTML 中到达该画面的步骤                               |
| Viewports       | 需要截图和验收的宽高                                       |
| Themes          | light/dark/high-contrast 中实际承诺的集合                  |
| Data states     | loading/empty/partial/error/success/stale 中真实可达的集合 |
| Interaction     | 点击、键盘、focus、返回、滚动与 reduced-motion 结果        |
| Ownership       | route、feature、primitive、view model/contract 的目标归属  |
| Status          | covered/derived/pending/verified                           |

CourseFlow 只面向正常横屏桌面浏览器，像素基准 viewport 为 `1280x900`；不建立竖屏、移动端或窄屏产品布局，也不把 200% zoom 当作像素比对基线。只为能改变布局或任务结果的代表状态截图，不生成页面 × 状态 × 主题的无意义全排列。为兑现 WCAG 2.2 AA，200% zoom 仍做功能检查：关键内容、表单、错误和操作不得丢失，明确二维容器之外不得出现 document 级水平滚动。

`ui-v1` 已冻结目录中的 `768x1024` 与 200% zoom 截图属于旧版本的不可变历史证据；不得删除或改写，也不得把它们复制成新像素基线。自本规则起的增量截图只记录正常横屏桌面，但 200% 功能检查结果仍写入验收记录。

完成标准：导航、首屏、主要 overlay 和正常横屏桌面下的核心任务都能落到明确矩阵行。

### 第三步：冻结前审计

1. 使用 `ux-heuristics` 对导航、信息架构、表单和核心旅程做启发式检查并给出 severity；severity 3/4 必须修复后再冻结，保留的 severity 1/2 写入基线已知问题。
2. 在设计 token 已明确的前提下使用 `typeui-fundamentals`，按其规定顺序检查 spacing → UI hierarchy/controls → typography，并执行 accessibility 模块；具体值仍由基线决定。至少验证 focus、键盘、对比度、touch target、`1280x900` 正常横屏桌面参考 viewport、非颜色表达和 motion safety。
3. 只有交互确实使用手势、弹簧、sheet、动量、空间层级或半透明材质时才使用 `apple-design` 做 Web 适配检查。
4. `apple-human-interface-guidelines` 只用于原生 Apple 平台目标，不作为当前 Web 基线的通用审核器。
5. 检查字体、图标、图片、参考组件和第三方代码的来源、许可与生产加载方案。外部 CDN、内联 script 和原型许可注释不能在迁移时丢失。

完成标准：没有未解决的严重可用性问题；WCAG 2.2 AA 硬要求有实现路径；所有第三方视觉来源可追踪。

### 第四步：制作不可变快照

1. 将视觉实验室原样复制到 `docs/design/baselines/<version>/reference/courseflow.html`；复制动作本身不重排或清理源码。
2. 在 `BASELINE.md` 记录原文件名、冻结时间、字节数和 SHA-256。
3. 记录渲染环境：浏览器、操作系统、locale、时区、viewport、主题、zoom、字体是否加载完成和 fixture 版本。
4. 使用确定性 fixture 打开每个矩阵状态，等待字体和动画稳定后截图。截图文件名使用 `<route-or-surface>--<state>--<theme>.png`。
5. 截图前固定当前时间、随机数、数据顺序和动画；无法固定的区域在矩阵中说明，不用大面积 mask 掩盖真实布局。

完成标准：Git 可追踪 HTML 快照、清单与每个必要矩阵行的参考截图，且清单 hash 能验证快照未被改写。

### 第五步：提取可实现的设计合约

在 `BASELINE.md` 记录而不只依赖截图猜测：

- 颜色、表面、字体、间距、圆角、边框、阴影、层级和 motion token。
- app shell、内容宽度、栅格、密度、桌面断点与 browser zoom 重排规则。
- 导航、按钮、表单、卡片、列表、overlay、状态提示、图标的 component family 和 variant。
- hover/focus/active/selected/disabled/loading/error/success 等交互状态。
- 可保留的精确文案、可以来自 contract 的动态内容，以及禁止由 mock 决定的产品行为。
- 关键动画的目的、持续时间、easing、打断行为和 reduced-motion 等价状态。
- 每项已知偏差、未覆盖状态和允许推导范围。

视觉实验室中的 hard-coded 课程、日期、百分比和统计数字只是 fixture；除非产品文档另有定义，它们不是业务规则或生产内容。

完成标准：Agent 无需重新做审美选择，就能从基线确定重复组件的具体值和页面独特构图。

### 第六步：确认冻结

把 [UI 整合记录](./UI_INTEGRATION_LOG.md) 对应条目标为 `frozen`，链接到基线目录，并让用户确认版本、覆盖范围与待确认项。以下条件全部成立才算冻结完成：

- 基线工件已被 Git 跟踪，而不是只存在于被忽略的视觉实验室。
- 页面/状态/route 映射完整，产品范围冲突已经决定或明确排除。
- severity 3/4 可用性问题为零，无障碍硬约束有清晰处理。
- token、交互、响应式和许可信息可查。
- 用户明确确认该版本是后续实现依据。

## 4. 冻结后的实现顺序

当前实施计划已经完成 P3，P4 为 `next`，产品模式仍是 `AI_PENDING`。设计冻结后不要跳阶段：只读 `ui-v1` 继续作为全局像素权威，`p3-manual-v1` 只冻结 Sources 手工增量；P4 最终结论前，条件性 AI harness 不是生产视觉事实。

每个前端切片按以下顺序：

1. **引用基线**：在任务和 UI log 中写明基线版本、UI ID 与本次矩阵行。
2. **落 token 与 primitive**：把冻结值放入 `packages/ui` 的语义 token 和可访问 primitive；页面独特构图留在 feature。
3. **拆分网页职责**：HTML 结构变成 route/feature/component，内联 JS 变成最小 Client island，hash 导航变成真实 route；不把完整 document、全局 reset 或 CDN script 粘进生产页面。
4. **先用 contract fixture 对齐画面**：fixture 只放测试、story 或隔离 demo，覆盖本切片的确定性状态。先让浏览器渲染与参考截图一致，再接远端数据。
5. **接真实 view model/command**：Server Component 默认读取 query；客户端只管理必要交互。移除生产 route 的 hard-coded 课程、日期、权重和统计数字。
6. **验证可见结果**：使用 `build-web-apps:frontend-testing-debugging`，在 Browser 中检查目标旅程、console、桌面/移动截图和 mismatch ledger；React/Next.js 代码同时应用 `build-web-apps:react-best-practices`。
7. **关闭切片**：运行相关 component/a11y/visual/E2E 与仓库 quality gates，更新矩阵状态，删除临时实现与重复样式。

阶段映射仍由实施计划决定：P1 实现学期、课程/多个课节、Reading Week、手工事项/标签、基础 Gradebook 和相关页面；P2 接今日/下一节课、任务分组、雷达、热力图、冲突、日历与 ICS；P3 接 Source 上传/预览/手工录入并只隔离设计 AI 候选；P4 `AI_GO` 后才接导入进度、审核和 Evidence，否则将这些 surface 删除。`/insights` 只有定义真实 Insight 后才显示指标。不能因为视觉实验室已经画出页面，就用 mock 提前伪装功能完成。

## 5. 防止后续开发漂移

### 5.1 变更控制

- 已冻结目录只读。要改变已确认视觉，复制为 `ui-v2`，写明相对 `ui-v1` 的变更，并由用户确认；旧版本保留。
- 未覆盖的小状态先从冻结 token、component family 和邻近矩阵行推导，并把结果补入当前版本的派生状态记录；新的导航、页面构图或视觉方向建立新版本。
- 正确性、安全、隐私、领域 contract、浏览器能力或无障碍要求需要偏离时，优先做正确实现，并在 `BASELINE.md` 的 deviation ledger 记录“参考、原因、实现、用户影响、验证”。
- 设计技能只解决基线未定义的问题。它们的默认审美不能覆盖已确认色彩、字体、构图、密度、图标、文案或交互。

### 5.2 每个可见变更的门禁

- PR/交付说明引用基线版本、UI ID 和受影响矩阵行。
- 参考图与最新实现图在同一 viewport、主题、locale、时区和 fixture 下比较。
- mismatch ledger 至少检查文案、布局、排版、颜色、间距/容器、图标、交互与响应式；可修差异清零，保留差异进入 deviation ledger。
- 核心旅程有键盘、focus、reduced-motion、非颜色表达和移动验证。
- 生产 route 无 mock；组件只消费 view model/contract；图表有文本等价。
- build、typecheck、lint 和本切片最低充分测试通过。构建成功不能替代浏览器视觉验收。

## 6. `UI-0001` 当前冻结前缺口

当前 HTML 已包含 `overview / courses / calendar / tasks / sources / statistics` 六个主要画面、浅深主题、响应式断点、review dialog，以及 reduced-motion / reduced-transparency / increased-contrast 处理。冻结前仍需明确：

| 原型画面     | 预期产品位置                                                  | 冻结前决定                                                           |
| ------------ | ------------------------------------------------------------- | -------------------------------------------------------------------- |
| `overview`   | `/dashboard`                                                  | 确认首屏结构与待审核/风险模块的代表状态                              |
| `courses`    | `/courses/[courseId]` 等课程页面                              | 明确列表、课程总览、timeline、grading 如何拆 route                   |
| `calendar`   | `/calendar`                                                   | 确认周/月模式、TBA 区与 ICS 入口状态                                 |
| `tasks`      | `/tasks`                                                      | 已确认保留全局行动视图；冻结时覆盖短期/中长期/TBA/标签筛选的代表状态 |
| `sources`    | `/sources`、`/courses/[courseId]/sources`、`/imports/[runId]` | 保留全局资料入口，同时把课程上下文和审核工作台拆清楚                 |
| `statistics` | `/insights`                                                   | 当前数字仅作视觉 fixture；Insight 未定义前生产只显示真实空状态       |

`/terms`、`/courses/new` 分步添加课节、Reading Week/单次例外、课程 timeline、Gradebook 成绩录入，以及完整 import progress/error 等核心 surface 仍未在该单文件中逐一覆盖。设置中心现已覆盖显示时区、周起始日、默认等级表、账户资料和 AI 凭据主路径，但供应商错误与助手状态仍不完整。冻结时必须把其余 surface 标成“新增设计 / 可按系统推导 / 当前版本不覆盖”，不能默认为已经确认。按系统推导的表单除了复用 token，还必须记录默认/hover/focus/disabled/error/success、键盘焦点、输入与按钮等高及相邻操作不换行；无障碍结构优先于视觉压缩。

2026-08-13 新增的头像个人中心、设置与偏好、账户与隐私、DeepSeek API Key 配置、AI 可用状态、提问/生成中回答与规划草稿明确属于 `UI-0002 / UI-0003 / prototyped`，不在 `ui-v1` 的 derived 范围内。当前产品模式为 `AI_PENDING`：账户/普通设置和 Source 手工录入可以进入下一基线；密钥、AI 抽取、Candidate/Review 与助手必须标 `conditional`，P4 `AI_GO` 前不得冻结为生产承诺。若最终 `MANUAL_ONLY`，新基线删除全部 AI surface，只保留普通个人中心及手工资料路径；不得留下永久 disabled AI 卡片。

## 7. 项目所有者的下一条指令

设计真正完成后，可直接发送：

```text
前端设计已完成。请读取 AGENTS.md、docs/design/DESIGN_BASELINE.md、FRONTEND.md、SCOPE.md 和 UI_INTEGRATION_LOG.md，把当前 courseflow-visual-lab-glass.html 冻结为 ui-v2。当前 AI 为 AI_PENDING：只冻结账户/普通设置、Sources 上传预览和手工录入；把 DeepSeek 密钥、AI 抽取、Candidate/Review 与助手状态登记为 conditional，不纳入生产基线。先做 route/状态矩阵与 ux-heuristics/typeui-fundamentals/无障碍审计；severity 3/4 或产品范围冲突未解决时不要宣布冻结。通过后保存 HTML 快照、hash、token/交互清单、1280x900 参考截图和 200% 功能检查，更新 UI 条目。不要开始生产页面实现。
```

`p3-manual-v1` 已冻结并验证，仓库当前正确的开发起点是实施计划中标为 `next` 的 P4。任何真实调用必须继续使用已冻结的 `ai-eval-policy-v1`，完成真实能力/隐私/成本评测与三方签署后，只能选择 `AI_GO` 或 `MANUAL_ONLY`；目前仍是 `AI_PENDING`。

历史上用于启动 P3 的指令保留如下，不能再据此重复实现或绕过 P4：

```text
ui-v2 已确认冻结。请按 IMPLEMENTATION_PLAN.md 和 DEVELOPMENT_WORKFLOW.md 执行当前 next 的 P3：先做 Sources 上传/预览/手工录入闭环；AI 仍按 conditional contract/fake 隔离，未经过 P4 AI_GO 不装配生产 route、migration 或 UI。所有可见实现引用 ui-v2 矩阵行，先对齐 contract fixture，再接真实 view model；不得静默重设计或把原型 mock 带入生产。
```
