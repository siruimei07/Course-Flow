# CourseFlow UI 整合记录

本文件追踪用户分批提供的页面代码、截图或设计说明如何进入统一 UI。详细执行步骤见 [前端架构与 UI 代码整合](../architecture/FRONTEND.md#6-用户提供-ui-代码的整合协议)。
视觉稿被用户确认后，按 [前端设计基线与冻结](./DESIGN_BASELINE.md) 制作不可变基线；`prototyped` 不等于 `frozen`。

## 已确认的全局偏好

- 只面向正常横屏桌面 Web，像素参考 viewport 为 `1280x900`；竖屏、移动端和窄屏不建立产品布局。200% zoom 不作像素基线，但按 WCAG 2.2 AA 验证关键内容、控件、错误与键盘路径不丢失。接收网站、截图以及 HTML/CSS/JS/组件代码作为输入。
- 软件表面、卡片、控件和 overlay 使用一致的语义圆角；具体数值可由后续设计统一校准。
- 界面包含服务状态与空间关系的动画，并为 `prefers-reduced-motion` 提供等价体验。
- 用户没有完整设计的页面，按已确认批次的风格指纹补全，不另起一套视觉语言。

## 总览

| ID      | 页面/功能                   | 输入形式           | 状态       | 目标位置                                                           | 条目                                   |
| ------- | --------------------------- | ------------------ | ---------- | ------------------------------------------------------------------ | -------------------------------------- |
| UI-0001 | CourseFlow 多页面视觉实验室 | 单文件 HTML/CSS/JS | verified | 全局 shell、dashboard、courses、calendar、tasks、sources、insights | [条目](#ui-0001-courseflow-visual-lab) |
| UI-0002 | 个人中心与条件性 AI 助手     | 行为需求 + 本地视觉实验室初稿 | prototyped | 头像 overlay；AI 部分仅 conditional，等待 P4 去留门禁 | [条目](#ui-0002-个人中心与-ai-助手) |
| UI-0003 | 模糊玻璃前端与设置中心       | 单文件 HTML/CSS/JS | prototyped | 最新全局材质、设置与偏好、账户与隐私、AI 配置 | [条目](#ui-0003-模糊玻璃前端与设置中心) |
| UI-0004 | P3 Sources 手工闭环 | `ui-v1` 派生 + P3 contract | frozen | `/sources` → 既有手工表单 → Timeline/Dashboard；AI 仅 conditional | [p3-manual-v1](./baselines/p3-manual-v1/BASELINE.md) |

ID 使用 `UI-0001` 递增；状态只用 `received/mapped/prototyped/frozen/integrated/verified/superseded`。`frozen` 表示已经建立用户确认、Git 可追踪的设计基线，但尚不表示生产 route 已接入；被替代条目保留并指向新 ID，避免未来 agent 又恢复旧实现。

## UI-0001：CourseFlow visual lab

- 输入：仓库根目录 `courseflow-visual-lab.html`；本地可变且被 `.gitignore` 排除
- 登记/重核日期：2026-08-12
- 用户明确要求：不改变已有 UI 设计；先登记并拆分视觉/交互/数据职责，再判断原型或接入；HTML/CSS 迁移为 CourseFlow React/Next.js、semantic token 与最小 Client island；原稿未覆盖的页面和状态只按同一风格推导；不把 mock 或页面自带规则写入正式模型；只有新增产品行为才请求确认。2026-08-13 最新确认：产品像素验收使用 `1280x900` 正常横屏桌面，不建立竖屏、窄屏或移动端基线；200% zoom 只做 WCAG 功能保留检查。
- 版本证据：[ui-v1 基线](./baselines/ui-v1/BASELINE.md)；`207974` bytes；SHA-256 `88A968C3241AE704E23CFE1F531A2D4AC10806AC89D8DE4A2C6BE150B33A991A`；冻结时间 `2026-08-12T18:03:02+08:00`
- 目标 route/feature：全局 app shell；`/dashboard`；`/courses` 与课程支持 route；`/calendar`；`/tasks`；`/sources`、`/courses/[courseId]/sources` 与 `/imports/[runId]`；`/insights`
- 当前状态：verified（P1–P2 范围及 P3 的 Sources 增量；其余 P4–P6 页面仍按各自阶段接入）

### 生产映射与未来替换通道

- P1 生产实现以本条目的不可变 `ui-v1` 快照为源码素材：保留 app shell、导航、panel、表单、课程列表/详情和任务行的 HTML/CSS family，改写为 React/Next.js route、feature 与最小 Client island；只替换 fixture、hash 导航和内联脚本，不重新选择视觉方向。
- 生产 CSS 只消费 `packages/ui/tokens.css` 的语义 token。`ui-v1` 的颜色、字体、圆角、阴影与 motion 已在 P1 开始前完整落入该文件；页面独特构图留在对应 feature，不另建第二套 token。
- 未来设计替换不得修改 `docs/design/baselines/ui-v1/`。流程固定为：冻结新的 `ui-vN` → 在新基线写相对 `ui-v1` 的 change/deviation ledger → 只调整语义 token、primitive 或明确受影响的 feature → 在相同 route/state/viewport 做新旧参考与生产截图比对 → 用户确认后更新本条目指向并保留旧版本。
- 领域 contract、PostgreSQL schema 和 view model 不依赖具体基线版本；因此未来视觉替换可以更换 presentation，而不迁移正式课程记录或复制业务规则。

### 当前阶段判定

- 结论：**`ui-v1` 保持冻结且 P1 范围已完成生产接入与验证**。route/状态矩阵与冻结前审计见 [SCREEN_MATRIX](./baselines/ui-v1/SCREEN_MATRIX.md) 和 [BASELINE](./baselines/ui-v1/BASELINE.md)；生产实现不修改该只读目录。
- P1 映射：全局 shell、主题、课程列表/详情、任务行和表单 family 已迁移到真实 route；`/terms`、课程向导、课节例外、Timeline 与 Gradebook 是按同一 token family 推导的新增 surface。所有正式数字来自 auth-scoped view model/PostgreSQL，不迁移原稿 fixture。
- 阶段边界：P1–P2 的正式课程与 schedule 投影、P3 Source 上传/预览/手工录入均已接入；导入/审核只在 P4 `AI_GO` 后接入，Insight 留到 P6。不为追求视觉填充而迁移原稿 mock。
- 偏差：参考稿的搜索、通知、近期事项和候选统计不属于 P1 contract，未伪造；真实验收数据只有 1 门课程，因此列表密度低于参考稿；英文课程名和 Gradebook 标签保留领域术语。以上均为范围/数据真实性偏差，不是新视觉方向。

### P1 视觉验证（2026-08-13）

- 概念权威：`docs/design/baselines/ui-v1/reference/courseflow.html`；当前对照以 `1280x900/courses--selected-course--light.png` 与任务页对应横屏状态为准。旧 `768x1024` 文件仅为不可变冻结版本的历史证据，不再作为当前或后续验收要求。
- 最新实现：Playwright 在生产构建、真实 PostgreSQL journey 完成后，以 `1280x900` 正常横屏 viewport 生成代表截图；旧竖屏截图与检查记录已退役，不得复制为新测试。
- 五点比对：胶囊顶栏与六入口导航一致；暖白画布/黄色主操作和深色主题一致；shell/panel/control 圆角层级一致；课程色轨、列表—深色详情卡关系一致；标题/元数据/状态标签的层级与中等密度一致。`1280x900` 下保留左右主从结构。
- 文案差异：参考稿 fixture 的 `CSC258H5`、候选数、近期事项与模拟百分比全部替换为 canonical journey 的 `CSC-P1`、三类真实课节、Reading Week、手工事项和成绩口径；没有把 copy diff 写回领域规则。
- 验证结论：P1 可见范围对 `ui-v1` 达到高保真；差异均来自真实 contract、可访问性或阶段范围。Browser 最终 console 为 0 error/0 warn，skip link 可聚焦，主题切换成功；视觉替换 seam 保持可用。

### P2 视觉验证（2026-08-13）

- 概念权威：`ui-v1` 的 `dashboard--success`、`calendar--week`、`calendar--agenda` 与 `tasks--all` 参考截图；最新实现由同一 Playwright canonical journey 在真实 PostgreSQL 数据写入后生成 `1280x900` Dashboard/Calendar/Courses/Tasks 截图，并由 Codex In-app Browser 复核真实生产构建。
- Fidelity：保留胶囊顶栏与六入口导航、暖白画布和黄色主操作、深色高关注面板、课程色轨、低对比边框、shell/panel/control 圆角层级和 220ms 内的轻量 view motion；Dashboard 保持“今日/下一步/负荷/风险/中长期”的可扫描关系，Calendar 保持周/议程双视图，Tasks 保持行动优先级分区。
- 正式数据替换：参考稿的专注计时、通知/搜索、候选审核数、mock 课程和模拟负荷没有进入生产；页面显示 canonical `CSC-P1`、正式课节/事项、真实冲突与策略版本。热力图遵守已确认的 `workload-v1` 周粒度而非参考稿演示图形，并补充逐周文字表格；这属于 contract/无障碍必要偏差，不是新视觉方向。
- 响应与交互：`1280x900` 保留 Dashboard 两列和 Calendar 七列结构；Browser 验证 Calendar 周/议程切换、课程/事件类型筛选、Tasks 标签/分组 URL、浅深主题，热力图有 `role=img` 摘要与 `<table>` 等价表达。
- 结论：常规 MVP 页面在 P2 结束前完成 `ui-v1` 定型；P3 Sources 手工路径现由 `p3-manual-v1` 增量冻结并验收，import review 只在 P4 `AI_GO` 后进入生产，Insights 指标属 P6。P2 与 P3 手工路径均没有 severity 3/4 UI 问题，`ui-v1` 未被改写。

### 视觉意图

- 保留：顶部主导航与明确当前项；温暖中性色表面和黄色主强调；课程辅助色；大圆角 shell/卡片/控件；软阴影与少量 liquid-glass 强调；浅深主题；候选与正式数据、TBA 与确定日期的可见区分。
- 适配：原型 hash 页面改为真实 route；单文件结构拆为 route/feature/primitive 和最小 Client island；Google Fonts/CDN 与 inline script 改为受控生产加载；hard-coded 课程、日期、权重、统计数字改为 contract fixture，生产接真实 view model。
- 已由需求基线确认：保留六个一级入口及全局 `/tasks`、`/sources`；总览的今日课程/下一节课/学期进度、任务短期/中长期分组和课程成绩组成入口均接真实 contract，不再视为范围待定。
- 可按 `ui-v1` 推导但尚未逐像素覆盖：`/terms`、添加课程分步表单、课节/Reading Week 例外编辑、timeline、Gradebook 成绩录入与 A/B/C/D/F 等级表、settings、完整导入进度/错误；statistics 的 fixture 数字仍须由已定义 Insight 替换或显示空状态。具体状态边界以冻结矩阵为准。

### 风格指纹

- Geometry（构图、间距、圆角）：居中的大圆角 app shell、固定顶部导航、面板化响应式栅格；shell `2.25rem`、panel `1.5rem`、control `0.875rem` 为当前原型值。
- Typography：`Poppins` + `Noto Sans SC`，系统无衬线 fallback；中等字重、紧凑数据标签与清晰标题层级。
- Color：canvas `#fafaf8`、white/soft neutral surface、主黄 `#ffcc3d`，蓝/绿/紫/橙/红作为课程与语义辅助色；已有 dark theme token。
- Depth（边框、阴影、层级）：低对比边框、柔和外投影和局部内高光；高关注风险卡使用受限玻璃/发光效果。
- Density：中等偏高的 dashboard 信息密度，由留白、标题和面板尺度维持可扫描性。
- Motion：导航/筛选/主题/overlay/反馈使用 CSS 与小型 JS 动效；已有 `prefers-reduced-motion`、`prefers-reduced-transparency` 和 `prefers-contrast` 分支。

### 视觉 / 交互 / 数据职责拆分

| 层   | 原稿表达                                                                                                         | React/Next.js 归属                                                                                                                                                   | 边界                                                                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 视觉 | app shell、六入口导航、panel/card 构图、课程辅助色、圆角、阴影、玻璃层、浅深主题、桌面断点、图标与图表外观       | `packages/ui/styles/tokens.css` 提供 semantic token；原型 layout/pattern 与各 feature presentation 保留页面独特构图                                                  | 不复制整页 reset/CDN/内联样式；`ui-v1` 为只读视觉权威，普通实现不得静默偏离                                                             |
| 交互 | route 切换、主题、筛选/搜索、选中课程/资料项目、日历周/列表、dialog、toast、局部完成状态、专注计时、统计范围切换 | 真实 route/link 负责导航；只把需要浏览器事件和短暂状态的最小子树做 Client island；URL 保存可分享状态                                                                 | 原型交互只证明呈现和键盘路径；专注计时、完成状态、审核动作与统计切换不创建正式 command，也不模拟持久化成功                               |
| 数据 | 示例课程、课节、事项、资料、Candidate/Evidence、日期、权重、负荷与统计值                                         | 原型专用、显式命名的 typed fixture/view props；未来分别映射 `DashboardSnapshot`、`TaskBoardSnapshot`、`GradebookSnapshot`、Schedule/Source/Import/Insight view model | fixture 不进入 `packages/core`、数据库或 production route；短期/中长期、Reading Week、成绩、冲突、Insight 口径仍由正式 module/query 决定 |

原稿中涉及领域语义的演示行为按以下方式隔离：任务按钮只改变原型局部展示；35 分钟专注计时不是已确认 Course Item 规则；统计页的 term/year 数组及 `heatLevel` 不是 Insight 计算器；Candidate/Review 仍是 conditional 原型，只有 P4 `AI_GO` 后才可接真实 transaction，否则从发布 UI 删除。

### 映射

| 输入组件/数据/交互                      | 目标 token、primitive、feature 或 contract               | 处理                                                                                                  |
| --------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 根 `:root` 颜色、半径、阴影与 easing    | `packages/ui/styles/tokens.css`                          | 冻结时语义化并记录精确值；不让页面各自复制                                                            |
| app shell、品牌与顶部导航               | `apps/web/app` layout + `packages/ui` navigation pattern | 保留构图；hash 状态改为 route/URL 状态                                                                |
| overview                                | dashboard feature + `DashboardSnapshot`                  | 视觉布局保留；近期事项、负荷、风险、审核数来自真实查询                                                |
| courses/calendar                        | courses、schedule features                               | 按 `SCOPE.md` 拆 route；时间与冲突判断留在 core/query                                                 |
| tasks                                   | `/tasks` + `TaskBoardSnapshot`                           | 保留“先完成 / 本周推进 / 持续准备”构图；短期/中长期为派生分组，自定义标签使用既有 badge family        |
| sources + review dialog                 | sources/imports feature + Evidence/Candidate view model  | 保留候选警示和 Evidence 双区；审核通过前不写正式数据                                                  |
| statistics                              | insights feature                                         | 构图可作参考；未定义 Insight 时只显示真实空状态，不迁移 mock 数字                                     |
| 今日课程/周课表                         | schedule feature + `MeetingOccurrenceView`               | 保留 dashboard/calendar 构图；Lecture/TUT/PRA、地点、Reading Week 与下一节倒计时来自同一正式 snapshot |
| 课程成绩组成入口                        | grading feature + `GradebookSnapshot`                    | 现有摘要接真实权重；缺失的录分/等级表 surface 按同一 token 与交互 family 补齐，不改一级导航           |
| inline dataset、DOM 状态与 localStorage | route/search params、typed props、最小 Client state      | 按分享/持久化需求拆分，不复制领域 server truth                                                        |

### 验收

- [x] 已按 `docs/design/DESIGN_BASELINE.md` 建立用户明确要求的 `ui-v1` 冻结版本
- [x] loading/empty/partial/error/success 等适用状态已在矩阵标为 covered/derived/pending
- [x] `1280x900` 正常横屏桌面参考 viewport
- [x] 键盘、focus、语义和非颜色表达
- [x] P1 中文/英文、长文本和真实 contract
- [x] P1 视觉回归、测试和被替换生产实现清理
- [x] P2 Dashboard/Calendar/Tasks/Timeline 真实 snapshot 与视觉回归
- [x] P2 热力图文字等价、周/议程与浅深主题
- [x] P3 `p3-manual-v1` Sources 上传/安全预览/删除/既有手工表单闭环
- [x] P3 `MANUAL_ONLY` / `AI_ENABLED` 两套矩阵已审计；只冻结前者，后者保留 conditional

## UI-0004：P3 Sources 手工闭环

- 输入：用户明确要求先冻结并交付不依赖 AI 的 Sources 闭环；视觉继承 `ui-v1`，产品/安全行为来自 P3 Source contract。
- 当前状态：`frozen` 且 production integration 已由 canonical E2E 验证；冻结权威为 [`p3-manual-v1`](./baselines/p3-manual-v1/BASELINE.md)，最终实证见其 [`VERIFICATION.md`](./baselines/p3-manual-v1/VERIFICATION.md)。
- `MANUAL_ONLY` 审计：`ux-heuristics` 9/10，severity 4/3/2 均为 0；上传状态、零正式写入说明、安全预览、删除确认/错误和三个既有表单入口均可识别并可恢复。`typeui-fundamentals` 确认继承 token、单一 primary、持久 label、可见 focus、44px target、非颜色状态及 200% 功能保留。
- `AI_ENABLED` 审计：只在隔离 harness 覆盖 Import Review 与 `AiResultRegion` 的 idle/generating/completed/cancelled/failed、重试/配置/手工恢复；最高 severity 2，来源是 DeepSeek 真实能力、隐私与最终产品门禁仍为 `UNVERIFIED`。通过不进入 production manifest/migration、只接受 safe view model、原问题保留和原始 provider 内容不进 DOM，将其限制为可评审 contract；**未冻结为产品 UI**。
- 实际结果：production canonical E2E 完成上传 → 预览 → 对照资料打开既有事项表单 → 手工提交 → Timeline/Dashboard 回读 → 删除后预览撤销且正式事项保留。Browser 在 1280 和 200% 等效 viewport 无页面横向溢出，成功页 0 error/0 warn、无 framework overlay。
- 删除恢复：metadata 先标记 deleted 并把 `cleanup_status` 置为 pending，因此预览立即 fail closed；对象删除成功后标 complete，失败时同版本重试继续清理。AI harness 的视觉不是冻结承诺，P4 `MANUAL_ONLY` 时连同相关模块删除，`AI_GO` 时再按冻结流程形成新基线。

## UI-0002：个人中心与 AI 助手

- 输入：2026-08-13 的产品行为说明，以及视觉实验室中的个人菜单首轮初稿。右上角头像打开账户 overlay；首轮覆盖账户摘要、AI 未配置状态、设置入口与快速偏好。
- 当前状态：`prototyped`，尚未冻结。个人菜单与设置中心的最新初稿位于被 `.gitignore` 排除的 `courseflow-visual-lab-glass.html`，不是 `ui-v1` 的 derived state；不得在 `docs/design/baselines/ui-v1/` 原地补图或把临时实现宣称为已冻结设计。
- 产品条件：当前为 `AI_PENDING`。P3 已只冻结 Source 手工路径；账户/普通设置仍可在后续非 AI 基线中冻结，密钥配置、解析/Candidate/Review、助手和 AI 错误状态继续标 `conditional`。只有 P4 `AI_GO` 才能冻结并集成；`MANUAL_ONLY` 时从设计与生产矩阵删除，个人中心不留下永久不可用卡片。
- 已确认行为：凭据输入与提问输入分离；无 key 时显示“AI 功能暂不可用，请先配置 DeepSeek API Key”；配置/替换/撤销只在 server 处理；助手可解释正式计划并生成可放弃的草稿，不能自动写正式数据。
- 初稿已覆盖：头像锚定 overlay、明确标题/关闭入口、未配置 AI 的持久状态、设置与偏好、账户与隐私、专用 password field、凭据显隐/验证中/可用/替换/撤销、浅/深色及周起始日偏好；姓名与头像只在账户与隐私修改。`1280x900` 正常横屏、44px 控件、Escape/focus return、非颜色选中标记与 reduced-motion 基础路径纳入验收。
- AI_GO 后待设计：无效凭据/余额不足/限流/供应商失败、聊天/生成中与取消反馈、引用与假设、草稿预览和表单衔接、错误恢复与完整动画参数；结构化结果不展示未校验的 token delta。
- 冻结门禁：先用 `ux-heuristics` 与 `typeui-fundamentals` 联合审计；若采用新视觉方向或改变头像/全局 shell，建立 `ui-v2` 并由用户确认。AI_GO 前的新版本不能包含生产 AI surface。
- 当前联合评分：**8/10**，最高 severity 2。账户/设置的信息层级、关闭/focus、字段边界和撤销确认清晰，无 severity 3/4；缺口是能力/条款未验证、助手与供应商错误状态未完整设计，以及 pending AI 若可见会形成死入口。通过 conditional 冻结规则规避严重流程风险；只有真实门禁、完整状态、浏览器和无障碍验收后才可到 10/10。
- TypeUI 验收点：密码与提问输入各自持久 label/说明；每个 panel 单一主动作；label-input-error proximity 清晰；输入/按钮同高且相邻动作不换行；44px 目标、可见 focus、非颜色状态、Escape/focus return、reduced-motion 和 200% 功能保留。

## UI-0003：模糊玻璃前端与设置中心

- 输入：用户指定 `courseflow-visual-lab-glass.html` 为最新前端设计方向，并要求沿用模糊玻璃材质完成设置与偏好、账户与隐私、AI 配置页面。
- 当前状态：`prototyped`，尚未冻结。该文件被 `.gitignore` 排除；`ui-v1` 保持只读历史基线，不因本条目改变。
- 视觉边界：玻璃只用于 shell、overlay 和信息表面；输入框使用更实底色与静止边框，正文不置于高噪声背景。支持 `prefers-reduced-transparency`、`prefers-reduced-motion` 和高对比模式。
- 交互边界：三个页面位于头像触发的同一设置中心，不新增一级导航；API 点击直接打开独立配置页。无凭据时持续显示不可用及唯一恢复入口，有凭据时显示可信 server metadata 中的提供商、目标模型和验证时间。
- 账户边界：姓名与头像只在“账户与隐私”修改；API Key 只在“AI 配置”的 password field 提交，不与 AI 提问字段共用，也不写入浏览器本地存储。
- 联合审计：账户/普通设置部分无 severity 3/4；关键动作有反馈、破坏操作有确认、层级/间距/标签/焦点与 44px 目标满足当前正常横屏范围。AI 部分仍是 conditional，沿用 UI-0002 的 8/10 结论，不能因原型可点击就宣称冻结。
- 浏览器证据：`1280x900` 浅/深主题检查设置、账户、API 三页；原型走通未配置 → 验证中 → available（DeepSeek / `deepseek-v4-pro`）→ 撤销；密钥字段提交后清空；关闭设置后焦点回到头像；控制台无 error/warning。该证据只证明原型交互，不证明真实 API 能力或生产可用。200% 功能检查尚未完成，属于冻结前缺口。

## 条目模板

为每个重要片段复制以下小节；一个含多个相关页面的同一设计批次可以共用条目。

```md
## UI-0001：名称

- 输入：对话日期、附件/代码路径或可追踪说明
- 目标 route/feature：
- 当前状态：received

### 视觉意图

- 保留：
- 适配：
- 待确认：

### 风格指纹

- Geometry（构图、间距、圆角）：
- Typography：
- Color：
- Depth（边框、阴影、层级）：
- Density：
- Motion：

### 映射

| 输入组件/数据/交互 | 目标 token、primitive、feature 或 contract | 处理 |
| ------------------ | ------------------------------------------ | ---- |
|                    |                                            |      |

### 验收

- [ ] loading/empty/partial/error/success 等适用状态
- [ ] `1280x900` 正常横屏桌面参考 viewport
- [ ] 键盘、focus、语义和非颜色表达
- [ ] 中文/英文、长文本和真实 contract
- [ ] 视觉回归、测试和旧实现清理
```
