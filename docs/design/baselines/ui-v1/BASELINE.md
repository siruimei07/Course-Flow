# CourseFlow UI 基线 `ui-v1`

## 版本证据

| 字段 | 冻结值 |
|---|---|
| UI 条目 | `UI-0001` |
| 状态 | `frozen` |
| 冻结日期 | 2026-08-12 |
| 冻结时间 | `2026-08-12T18:03:02+08:00` |
| 可变来源 | 仓库根目录 `courseflow-visual-lab.html` |
| 不可变快照 | `reference/courseflow.html` |
| 快照字节数 | `207974` bytes |
| SHA-256 | `88A968C3241AE704E23CFE1F531A2D4AC10806AC89D8DE4A2C6BE150B33A991A` |

来源与快照在冻结时逐字节相同，SHA-256 一致。以后实现只读本目录；根目录视觉实验室仍是可变输入，不得覆盖本版本。任何设计方向变化新建 `ui-v2`，不得改写本目录。

## 冻结范围

- 冻结六个一级入口的视觉与可观察交互：`/dashboard`、`/courses`、`/calendar`、`/tasks`、`/sources`、`/insights`。
- 冻结 add-item 与 candidate/Evidence review 两个 overlay 的构图、控件族和焦点行为。
- 冻结 light/dark 主题；high-contrast、reduced-motion、reduced-transparency 是无障碍派生状态，不建立竞争性视觉方向。
- 冻结 viewport 为 `768x1024` 与 `1280x900`。CourseFlow 不承诺移动端或 320/360px 窄屏应用布局；仍验收 200% browser zoom。本质二维的日历、资料轨和热力图可在自身容器滚动。
- 参考截图是进入页面后的首个 viewport，而非 full-page 拼接。内置 Browser 为滚动条预留空间，因此 PNG 实际像素为 `753x1004` 与 `1265x889`；目录名记录请求的 browser viewport。
- 精确 route/state/截图对应关系见 [SCREEN_MATRIX.md](./SCREEN_MATRIX.md)。

### 可按同一系统推导

`/terms`、`/courses/new`、`/courses/[courseId]`、课程 timeline、Gradebook、Reading Week/课节例外、`/courses/[courseId]/sources`、完整 `/imports/[runId]` 和 `/settings` 可复用本基线 token、primitive 与密度；其真实数据状态、表单错误、冲突和命令语义仍由对应阶段 contract 决定。推导不得新增一级导航或第二套视觉语言。

### 不属于冻结的产品行为

- 示例课程、日期、权重、倒计时、热力值、统计值与完成状态都是原型 fixture，不是正式领域数据或计算规则。
- 35 分钟专注计时只冻结呈现，不定义 `CourseItem`、提醒或持久化行为。
- 原型 hash 导航只证明页面切换；生产必须使用真实 route/link 和可分享 URL 状态。
- candidate 接受/拒绝只冻结审核控件与 Evidence 构图。原型接受反馈已改为“尚未写入正式计划”；生产写入必须等待 P3 的 `reviewCandidate` transaction。
- `/insights` 数字只作视觉 fixture。Insight 未定义或数据不足时，生产显示真实空状态，不迁移这些数字或数组。
- add-item overlay 只冻结视觉/字段 family；生产是否直接写入以及失败、冲突与版本处理服从正式 command contract，关键结果不能只用 toast。

## Token 清单

### 色彩与表面

| Token | Light | Dark | 用途 |
|---|---|---|---|
| `--outer` | `#aeb7c3` | `#9da9a5` | app shell 外背景 |
| `--canvas` | `#fafaf8` | `#11110f` | 页面 canvas、skip-link 前景 |
| `--surface` | `#ffffff` | `#242321` | 默认 panel/card |
| `--surface-soft` | `#f3f3ef` | `#302f2c` | 次级表面/控件 |
| `--surface-warm` | `#fff7da` | `#343020` | 温暖提示表面 |
| `--surface-elevated` | `#ffffff` | `#292826` | overlay/浮层 |
| `--surface-inset` | `#f7f7f3` | `#1b1a18` | 内嵌区域 |
| `--header-surface` | `rgba(250,250,248,.86)` | `rgba(18,18,16,.84)` | 半透明 header |
| `--on-dark` | `#ffffff` | `#f8f7f2` | 深色卡片主文字 |
| `--on-dark-muted` | `#c6c8c2` | `#c8c7c1` | 深色卡片次文字 |
| `--ink` | `#171816` | `#f4f3ee` | 主文字/深浅反转 |
| `--ink-soft` | `#2a2b28` | `#0e0e0d` | 强调深表面 |
| `--muted` | `#62645f` | `#c0bfb9` | 次文字 |
| `--muted-light` | `#aeb1aa` | `#93928c` | 弱提示 |
| `--line` | `#dedfd9` | `#3f3e3a` | 默认边框 |
| `--line-strong` | `#c6c8c1` | `#7b7972` | hover/强调边框 |
| `--yellow` | `#ffcc3d` | `#f6d85b` | 主操作/核心强调 |
| `--yellow-strong` | `#e3a900` | `#f2c940` | 黄色加强 |
| `--blue` | `#5a92ee` | `#75a7ff` | 课程/信息辅助色 |
| `--green` | `#70b778` | `#7bd38b` | 课程/成功辅助色 |
| `--purple` | `#865ddd` | `#a98aff` | 课程辅助色 |
| `--orange` | `#ef7e34` | `#ff9b58` | 课程/注意辅助色 |
| `--red` | `#bd4438` | `#ff7b70` | 风险/错误辅助色 |
| `--focus` | `#235ee7` | `#9bc0ff` | `3px` focus outline |

颜色只作辅助。课程始终同时显示课程代码，calendar 同时显示 `Lecture`/`Office Hour`/`截止`/`计划完成` 等文字类型，candidate/TBA/risk 均有文本标签。

### 排版、尺寸与空间

- 字体栈：`Poppins`, `Noto Sans SC`, `PingFang SC`, `Microsoft YaHei`, `ui-sans-serif`, `system-ui`, `sans-serif`；根字号 `16px`，正文行高 `1.5`。
- 字重：正文 `400/500`，标签与控件约 `600–660`，标题/数字约 `700`；标题层级保持每 route 一个可见 `h1`，panel 用 `h2/h3`。
- 圆角：shell `--shell-radius: 2.25rem`；panel `--panel-radius: 1.5rem`；control `--control-radius: .875rem`。药丸和圆形只用于状态、头像、图例或图标操作。
- 控件最小高度 `2.75rem`；图标/头像按钮固定 `2.75rem × 2.75rem`，不得被 flex 压缩。文本输入保持静态可见边框与显式 label。
- 空间以 `0.5/0.6/0.75/0.85/0.9/1/1.15/1.5/2rem` 组合为主；相邻关系用一致 gap，不以空行伪造层级。
- 关键断点：`74rem`（主栅格收拢）、`58rem`（shell 去外框、header 两行、单栏结构）、`40rem`（受限空间单列）、`32rem/23.5rem` 为遗留防溢出保护，不构成移动端产品承诺。

### 边框、阴影、层级与材质

- shell shadow：light `0 2rem 5rem rgba(38,45,54,.22)`；dark `0 2rem 5rem rgba(0,0,0,.48)`。
- float shadow：light `0 1rem 2.5rem rgba(35,35,31,.12)`；dark `0 1rem 2.5rem rgba(0,0,0,.36)`。
- panel shadow：light 双向柔光 + `inset 0 1px 0 rgba(255,255,255,.72)`；dark 使用低亮度外影和轻微上下 inset。
- skip link/toast 等系统级反馈使用 `z-index: 100` 级；native modal dialog 保持 top-layer。不得新增无清单的 z-index 竞争。
- 玻璃/模糊只用于 header、主题开关和少量风险强调；不堆叠多层可交互 glass。`prefers-reduced-transparency` 下回退到不透明表面。

### Motion

- easing：`cubic-bezier(.22,1,.36,1)`。
- route/page enter `280ms`；calendar view 与 toast enter `220ms`；控件 hover/press 多为 `160–360ms`；focus breathe `2.4s`；主题云层 `6s`、星点 `2s`。
- motion 只表达状态和空间关系；focus outline 立即出现。`prefers-reduced-motion` 把动画/过渡压到 `0.01ms`、单次执行，并停用主题和 focus 循环动画。

## Component 与交互清单

| Family | 冻结 variants / 状态 | 交互约束 |
|---|---|---|
| App shell / header | light/dark、宽桌面/两行 header、当前 route | 六入口不增删；当前项同时有 `aria-current="page"` 与视觉状态 |
| Button | primary/secondary/dark/ghost/icon/profile、hover/active/focus/disabled 派生 | 默认 ≥44px 高；键盘 Enter/Space 与 pointer 等价 |
| Panel/card | neutral/warm/dark/risk/review、selected | 保留页面独特构图，不抽成一个万能卡片 |
| Badge/status | neutral/warning/success/TBA/course | 文本与颜色并用 |
| Navigation/control group | route nav、calendar week/agenda、task filters、insight range | 单选状态用 `aria-current` 或 `aria-pressed`；真实产品状态进入 URL/search params |
| Task item | near/mid-long、complete/not complete、TBA | fixture toggle 只说明局部视觉；生产由 snapshot/command 决定 |
| Calendar event | MeetingOccurrence/CourseItem、week/agenda | 显示课程代码和文字类型；二维周视图可内部横向滚动 |
| Sources | course rail、folder/project、document row、review queue | candidate 明确不是正式数据；Evidence 保留页码和原文 |
| Form | input/select/date/time/textarea、required、focus、error/success 派生 | label 不由 placeholder 代替；错误持久展示并移焦，不只 toast |
| Native dialog | add-item、candidate/Evidence review | `showModal`、首焦点可见、焦点限制在 modal、关闭后返回触发点 |
| Toast | status、optional undo | 仅次要/跨页反馈；关键成功错误保留页面内状态 |
| Theme | light/dark + reduced-* 派生 | 使用受控持久化；生产加载不得闪烁或依赖不受控 CDN |
| Insight visuals | heatmap/rhythm/course distribution/ring | fixture 只冻视觉；生产须有文字/列表等价视图和数值说明 |

## 冻结前 UX / 无障碍审计

审计按 `ux-heuristics`、`typeui-fundamentals`、Web 化 `apple-design` 材质原则与浏览器交互检查执行。整体评分 **9/10**；冻结门禁通过，未解决 severity 3/4 为 **0**，产品范围冲突为 **0**。

| 项目 | 结果 | 证据/处理 |
|---|---|---|
| 导航与 IA | 通过 | 六入口名称、当前态、route 标题与唯一可见 `h1` 一致；所有可达 surface 已进入矩阵 |
| 核心旅程 | 通过 | dashboard → task/calendar、sources → candidate/Evidence、theme/filter/view switch 可达 |
| Candidate 边界 | 通过 | 接受动作改为“原型预览…尚未写入正式计划”，不再声称 mock 已持久化 |
| 键盘与 focus | 通过 | 可见 focus；skip link；native dialog 首焦点/关闭焦点返回；控件使用原生 button/input 语义 |
| 对比度 | 通过 | light/dark route 实测无有文字内容的 AA 失败；暗色 skip link 改为 `canvas` on `ink` |
| target | 通过（桌面） | 图标/头像按钮锁定 44px；focus panel 两按钮实测约 42px 高，见已知 S1 |
| 非颜色表达 | 通过 | 课程代码、事项类型、deadline/TBA/candidate/risk 文字标签齐全；漏标 Lecture 已补齐 |
| 768 / 1280 | 通过 | 六 route 无 document 级横向溢出；参考图已目检 |
| 200% zoom | 通过 | 以 1280 桌面等价 `640x450` CSS viewport 验证；主任务不丢失，日历/资料仅容器内滚动 |
| Dialog / form | 通过（冻结范围） | native modal、显式 label、required 标题、Escape/关闭与触发点返回；生产错误/冲突为 derived |
| Motion / transparency | 通过 | reduced-motion、reduced-transparency、prefers-contrast 分支存在；无动画依赖任务完成 |
| Console / DOM | 通过 | 六 route 无页面 console error/warn；无重复 ID、无可见未命名交互控件、无应用错误 overlay |
| 视觉稳定性 | 通过 | 固定 fixture/date、timer 未启动、字体 `loaded` 后截图；light/dark 与两档 viewport 已目检 |

### 已知非阻塞问题

| Severity | 范围 | 结论 |
|---|---|---|
| S2 | `/insights` 热力图 | 原型的高层文字摘要可读，但逐日数值/列表等价视图未完整画出。冻结为 **derived accessibility state**；生产 P2 必须实现文本/列表等价视图后方可 `verified`。 |
| S2 | 未画出的业务 surface | `/terms`、course wizard、Gradebook、完整 import progress/error/conflict 没有逐像素参考。已全部标为 derived/pending，不得误称已覆盖；状态矩阵和正式 contract 是实施门禁。 |
| S1 | dashboard focus panel | 两个文本按钮实测高度约 `42.2px`，低于项目“44px 左右”目标但高于 WCAG 2.2 AA 24px 最低目标；生产 primitive 统一到 44px，不改变构图。 |
| S1 | 参考 PNG 尺寸 | 内置 Browser 的可见滚动条/viewport chrome 使 PNG 比请求尺寸少量缩减（768 请求为 `753x1004`，1280 请求为 `1265x889`）；目录、矩阵和渲染说明已记录，视觉内容不受影响。 |

这些问题都不阻止完成当前原型所覆盖的桌面核心任务；没有遗留需要产品所有者决定的行为。

## 第三方来源与许可

- Google Fonts：`Poppins` 与 `Noto Sans SC`，冻结原型从 `fonts.googleapis.com` / `fonts.gstatic.com` 加载；两者按 SIL Open Font License 1.1 分发。生产应使用框架受控加载或自托管，并保留字体许可文件；不得复制未知来源二进制。
- Uiverse 研究：`adamgiebl/strong-zebra-87`、`vinodjangid07/tender-fireant-6`、`RiccardoRapelli/jolly-chicken-91`、`Cobp/mighty-pig-13`、`dylanharriscameron/stupid-mole-90`；原型头注释标记 MIT。迁移时保留此来源清单，并在采用具体片段前核对当时页面的 MIT 许可文本。
- 图标为快照内联 SVG symbol，没有外部运行时包；若生产改用图标库，须另记版本、许可并避免同时保留重复图标实现。
- 基线没有外部图片资产；Evidence 文档预览为 CSS/HTML fixture，不是真实课程文件。
- 本次许可核验基于冻结 HTML 内的来源注释与仓库许可记录；受限环境未重新访问第三方页面。生产采用前仍须按上两条重新核对字体/片段原页的版本与许可文本。

## 渲染环境与复现

- Windows + Codex in-app Browser（Chromium）；语言 `zh-CN`，DPR `1`，默认 contrast/reduced-motion/reduced-transparency 均关闭。
- 页面通过本地 HTTP 服务加载；截图前等待 `document.fonts.status === "loaded"` 和至少 180ms 的稳定时间；focus timer 未启动。
- 截图文件名格式为 `<route-or-surface>--<state>--<theme>.png`。快照自带固定 fixture 和日期 `2026-08-12`，不得在生产实现中沿用。
- HTML 完整性复核：

```powershell
Get-FileHash -Algorithm SHA256 docs/design/baselines/ui-v1/reference/courseflow.html
```

预期值：`88A968C3241AE704E23CFE1F531A2D4AC10806AC89D8DE4A2C6BE150B33A991A`。
