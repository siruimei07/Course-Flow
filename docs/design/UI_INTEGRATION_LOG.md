# CourseFlow UI 整合记录

本文件追踪用户分批提供的页面代码、截图或设计说明如何进入统一 UI。详细执行步骤见 [前端架构与 UI 代码整合](../architecture/FRONTEND.md#6-用户提供-ui-代码的整合协议)。
视觉稿被用户确认后，按 [前端设计基线与冻结](./DESIGN_BASELINE.md) 制作不可变基线；`prototyped` 不等于 `frozen`。

## 已确认的全局偏好

- 以桌面 Web 应用为主，参考 viewport 为 `768x1024` 与 `1280x900`；不承诺移动端或窄屏专用布局，但仍验证键盘与 200% browser zoom。接收网站、截图以及 HTML/CSS/JS/组件代码作为输入。
- 软件表面、卡片、控件和 overlay 使用一致的语义圆角；具体数值可由后续设计统一校准。
- 界面包含服务状态与空间关系的动画，并为 `prefers-reduced-motion` 提供等价体验。
- 用户没有完整设计的页面，按已确认批次的风格指纹补全，不另起一套视觉语言。

## 总览

| ID      | 页面/功能                   | 输入形式           | 状态       | 目标位置                                                           | 条目                                   |
| ------- | --------------------------- | ------------------ | ---------- | ------------------------------------------------------------------ | -------------------------------------- |
| UI-0001 | CourseFlow 多页面视觉实验室 | 单文件 HTML/CSS/JS | verified | 全局 shell、dashboard、courses、calendar、tasks、sources、insights | [条目](#ui-0001-courseflow-visual-lab) |

ID 使用 `UI-0001` 递增；状态只用 `received/mapped/prototyped/frozen/integrated/verified/superseded`。`frozen` 表示已经建立用户确认、Git 可追踪的设计基线，但尚不表示生产 route 已接入；被替代条目保留并指向新 ID，避免未来 agent 又恢复旧实现。

## UI-0001：CourseFlow visual lab

- 输入：仓库根目录 `courseflow-visual-lab.html`；本地可变且被 `.gitignore` 排除
- 登记/重核日期：2026-08-12
- 用户明确要求：不改变已有 UI 设计；先登记并拆分视觉/交互/数据职责，再判断原型或接入；HTML/CSS 迁移为 CourseFlow React/Next.js、semantic token 与最小 Client island；原稿未覆盖的页面和状态只按同一风格推导；不把 mock 或页面自带规则写入正式模型；只有新增产品行为才请求确认。冻结期间补充确认：产品不承诺移动端或窄屏应用布局，只验收 768/1280 桌面参考 viewport 与 200% browser zoom。
- 版本证据：[ui-v1 基线](./baselines/ui-v1/BASELINE.md)；`207974` bytes；SHA-256 `88A968C3241AE704E23CFE1F531A2D4AC10806AC89D8DE4A2C6BE150B33A991A`；冻结时间 `2026-08-12T18:03:02+08:00`
- 目标 route/feature：全局 app shell；`/dashboard`；`/courses` 与课程支持 route；`/calendar`；`/tasks`；`/sources`、`/courses/[courseId]/sources` 与 `/imports/[runId]`；`/insights`
- 当前状态：verified（P1 范围；P2–P6 页面仍按各自阶段接入）

### 生产映射与未来替换通道

- P1 生产实现以本条目的不可变 `ui-v1` 快照为源码素材：保留 app shell、导航、panel、表单、课程列表/详情和任务行的 HTML/CSS family，改写为 React/Next.js route、feature 与最小 Client island；只替换 fixture、hash 导航和内联脚本，不重新选择视觉方向。
- 生产 CSS 只消费 `packages/ui/tokens.css` 的语义 token。`ui-v1` 的颜色、字体、圆角、阴影与 motion 已在 P1 开始前完整落入该文件；页面独特构图留在对应 feature，不另建第二套 token。
- 未来设计替换不得修改 `docs/design/baselines/ui-v1/`。流程固定为：冻结新的 `ui-vN` → 在新基线写相对 `ui-v1` 的 change/deviation ledger → 只调整语义 token、primitive 或明确受影响的 feature → 在相同 route/state/viewport 做新旧参考与生产截图比对 → 用户确认后更新本条目指向并保留旧版本。
- 领域 contract、PostgreSQL schema 和 view model 不依赖具体基线版本；因此未来视觉替换可以更换 presentation，而不迁移正式课程记录或复制业务规则。

### 当前阶段判定

- 结论：**`ui-v1` 保持冻结且 P1 范围已完成生产接入与验证**。route/状态矩阵与冻结前审计见 [SCREEN_MATRIX](./baselines/ui-v1/SCREEN_MATRIX.md) 和 [BASELINE](./baselines/ui-v1/BASELINE.md)；生产实现不修改该只读目录。
- P1 映射：全局 shell、主题、课程列表/详情、任务行和表单 family 已迁移到真实 route；`/terms`、课程向导、课节例外、Timeline 与 Gradebook 是按同一 token family 推导的新增 surface。所有正式数字来自 auth-scoped view model/PostgreSQL，不迁移原稿 fixture。
- 阶段边界：P2–P6 的派生任务分组、日历实例、导入与 Insight 仍显示诚实的阶段状态，不为追求视觉填充而迁移原稿 mock。它们在各自 contract 解锁后沿同一替换流程接入。
- 偏差：参考稿的搜索、通知、近期事项和候选统计不属于 P1 contract，未伪造；真实验收数据只有 1 门课程，因此列表密度低于参考稿；英文课程名和 Gradebook 标签保留领域术语。以上均为范围/数据真实性偏差，不是新视觉方向。

### P1 视觉验证（2026-08-13）

- 概念权威：`docs/design/baselines/ui-v1/reference/courseflow.html`；对照截图为 `1280x900/courses--selected-course--light.png`、`768x1024/courses--selected-course--light.png` 与任务页对应状态。
- 最新实现：Playwright 在生产构建、真实 PostgreSQL journey 完成后，以原生 viewport 生成截图，并固化为 `docs/design/verification/p1/courses--selected-course--light--1280x900.png` 与 `docs/design/verification/p1/tasks--manual-item--light--768x1024.png`；另由 Codex In-app Browser 在 768×1024/1280×900 做交互与控制台检查。
- 五点比对：胶囊顶栏与六入口导航一致；暖白画布/黄色主操作和深色主题一致；shell/panel/control 圆角层级一致；课程色轨、列表—深色详情卡关系一致；标题/元数据/状态标签的层级与中等密度一致。768 下栅格顺序改为纵向但无横向溢出，1280 下保留左右主从结构。
- 文案差异：参考稿 fixture 的 `CSC258H5`、候选数、近期事项与模拟百分比全部替换为 canonical journey 的 `CSC-P1`、三类真实课节、Reading Week、手工事项和成绩口径；没有把 copy diff 写回领域规则。
- 验证结论：P1 可见范围对 `ui-v1` 达到高保真；差异均来自真实 contract、可访问性或阶段范围。Browser 最终 console 为 0 error/0 warn，skip link 可聚焦，主题切换成功；视觉替换 seam 保持可用。

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

原稿中涉及领域语义的演示行为按以下方式隔离：任务按钮只改变原型局部展示；35 分钟专注计时不是已确认 Course Item 规则；统计页的 term/year 数组及 `heatLevel` 不是 Insight 计算器；“接受候选后正式计划已更新”的演示文案在原型迁移中改为明确的预览反馈，直到 P3 有真实 review transaction。

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
- [x] 768/1280 桌面参考 viewport 与 200% zoom
- [x] 键盘、focus、语义和非颜色表达
- [x] P1 中文/英文、长文本和真实 contract
- [x] P1 视觉回归、测试和被替换生产实现清理

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
- [ ] 768/1280 桌面参考 viewport 与 200% zoom
- [ ] 键盘、focus、语义和非颜色表达
- [ ] 中文/英文、长文本和真实 contract
- [ ] 视觉回归、测试和旧实现清理
```
