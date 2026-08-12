# `ui-v1` route / 状态矩阵

本矩阵把冻结原型内部画面映射为产品 route。`verified` 只表示原型/reference 已完成本轮视觉、交互和无障碍核验，不表示生产 route 已实现。

## 已覆盖参考画面

| Route / surface | Reference state | Viewports | Themes | Data states | Interaction | Ownership | Status | Screenshot |
|---|---|---|---|---|---|---|---|---|
| `/dashboard` | `#overview` 初始画面；固定 2026-08-12 fixture | 768×1024, 1280×900, 200% zoom | light；dark 代表图 | success；empty/loading/error derived | 六入口、go-to task/calendar、task local toggle、focus timer visual-only | route + dashboard feature + `DashboardSnapshot` | verified | `768x1024/dashboard--success--light.png`; `1280x900/dashboard--success--light.png`; `1280x900/dashboard--success--dark.png` |
| `/courses` | `#courses`，CSC258H5 已选，列表 + 摘要 | 768×1024, 1280×900, 200% zoom | light；dark inherited | success/selected；empty/loading/error derived | 选中课程、课程支持入口；选中状态应进入 URL | route + courses feature + course summary VM | verified | `768x1024/courses--selected-course--light.png`; `1280x900/courses--selected-course--light.png` |
| `/courses/[courseId]` | 与 `/courses` 的选中课程详情区共享视觉 | 同上 | inherited | success/partial/error derived | 真实 route 替代仅内存 selection | course route + academics/grading/schedule projections | derived | 与 courses reference 共用，不新建重复截图 |
| `/calendar` · week | `#calendar` 初始周视图 | 1280×900, 200% zoom | light；dark inherited | success + TBA；empty/loading/error derived | 今天、周切换、event feedback、week/agenda switch | route + schedule feature + `ScheduleSnapshot` | verified | `1280x900/calendar--week--light.png` |
| `/calendar` · agenda | `#calendar` → “列表” | 768×1024, 200% zoom | light；dark inherited | success + TBA | `aria-pressed` view switch；二维周视图可内部滚动 | calendar presentation | verified | `768x1024/calendar--agenda--light.png` |
| `/tasks` | `#tasks`，全部筛选 | 768×1024, 1280×900, 200% zoom | light；dark inherited | success；filtered empty/loading/error derived | all/near/major/TBA filter、search、local complete preview | route + planning feature + `TaskBoardSnapshot` | verified | `768x1024/tasks--all--light.png`; `1280x900/tasks--all--light.png` |
| `/sources` | `#sources`，CSC258 labs project selected | 768×1024, 1280×900, 200% zoom | light；dark inherited | success/processing/pending-review；empty/error derived | course rail、project select、search、document/review entry | route + sources feature + bounded source query | verified | `768x1024/sources--library--light.png`; `1280x900/sources--library--light.png` |
| `/courses/[courseId]/sources` | `/sources` 的课程过滤/项目详情视觉 | 同上 | inherited | source list/import summary states derived | URL 固化 course context；不建第二套 source truth | courses/sources projection | derived | 与 sources reference 共用 |
| `/insights` | `#statistics`，本学期 fixture | 768×1024, 1280×900, 200% zoom | light；dark inherited | **visual fixture only**；production empty until definition | term/year presentation switch；“查看这一周”到 tasks | route + insights query seam | verified visual / pending data | `768x1024/insights--fixture--light.png`; `1280x900/insights--fixture--light.png` |
| add Course Item overlay | dashboard/tasks/calendar → “添加事项” | 1280×900；768/zoom derived | light；dark inherited | default/required；server error/conflict/success derived | native dialog、显式 label、close/cancel/submit、focus return | planning form feature + command contract | verified visual | `1280x900/overlay-add-item--default--light.png` |
| candidate/Evidence overlay | sources → “查看候选与证据” | 768×1024, 1280×900, 200% zoom | light；dark inherited | pending candidate + Evidence；conflict/error derived | native dialog；reject/edit/accept controls；不模拟正式持久化 | imports review feature + Evidence/Candidate VM | verified visual | `768x1024/overlay-review--candidate-evidence--light.png`; `1280x900/overlay-review--candidate-evidence--light.png` |

## 可推导但当前快照未逐像素覆盖

| Route / surface | Reference source | Required states | Ownership | Status / 边界 |
|---|---|---|---|---|
| `/terms` | app shell + form family | empty/loading/default/error/success/conflict | academics route/command | derived；不得新建一级入口 |
| `/courses/new` | add-item form family + courses density | step default/back/validation/conflict/success；200% zoom 单列 | course wizard + academics command | derived；课节、Reading Week 与例外语义服从 contract |
| `/courses/[courseId]/timeline` | courses + dashboard timeline | empty/loading/partial/error/success/TBA | planning/schedule projection | derived |
| `/courses/[courseId]/gradebook` | course summary + form/status family | no-scheme/unknown-weight/ungraded/partial/error/conflict/success | grading feature + `GradebookSnapshot` | derived；无 GPA/预测 |
| `/imports/[runId]` | sources + review overlay | queued/processing/retryable error/terminal error/ready/stale/version conflict/success | ingestion route + import/review contract | derived；完整事务到 P3 |
| `/settings` | app shell + form family | loading/default/validation/error/success | settings route/command | derived |

## 明确 pending / 非产品行为

| Prototype interaction/data | Status | 生产处理 |
|---|---|---|
| hash-based page switch | pending production | 改为真实 route/link；URL 保存选择和筛选 |
| focus timer | pending product behavior | 只复用视觉；不得自行创建事项、提醒或持久化规则 |
| local task completion / review-count decrement | pending command | 只作为 state styling 参考；生产由真实 command + snapshot 回读 |
| statistics arrays, `heatLevel`, percentages | pending Insight definition | 无定义时用真实空状态；不得迁移 mock 计算 |
| candidate “accept” preview | pending P3 transaction | 仅冻结 Evidence/decision UI；正式写入须经审核事务、幂等与 version check |

## Interaction / a11y 状态覆盖

| State | Reference / 派生规则 | 结果 |
|---|---|---|
| default / hover / active | HTML CSS control families | covered；production primitive 保持等价 |
| focus-visible | 全局 `3px` focus token；截图中的 blue outline 是测试时焦点 | verified |
| keyboard navigation | native buttons/links/inputs，skip link，dialog focus | verified；生产真实 router 仍需 E2E |
| disabled | 未在主参考图强制展示 | derived from semantic disabled + muted surface；不可只降 opacity 到不可读 |
| field error / error summary | add-item 只有 required 基础态 | derived；错误紧邻字段并把焦点移至 summary，保留输入 |
| loading / stale / version conflict | 未逐像素展示 | derived from panel/status/banner families；必须持久、非 toast-only |
| empty | tasks/search/Insight 等各 route 按真实 contract 派生 | derived；保持 route 标题与主恢复操作 |
| reduced motion | `prefers-reduced-motion` CSS branch | verified code path；无新构图 |
| reduced transparency | opaque fallback | verified code path；无新构图 |
| high contrast | stronger line/focus token path | derived/verified code path |
| 200% zoom | 1280 桌面等价 640 CSS px | verified；document 无水平溢出，二维内容仅容器内滚动 |

## 截图清单

### `screenshots/1280x900/`

- `dashboard--success--light.png`
- `dashboard--success--dark.png`
- `courses--selected-course--light.png`
- `calendar--week--light.png`
- `tasks--all--light.png`
- `sources--library--light.png`
- `insights--fixture--light.png`
- `overlay-add-item--default--light.png`
- `overlay-review--candidate-evidence--light.png`

### `screenshots/768x1024/`

- `dashboard--success--light.png`
- `courses--selected-course--light.png`
- `calendar--agenda--light.png`
- `tasks--all--light.png`
- `sources--library--light.png`
- `insights--fixture--light.png`
- `overlay-review--candidate-evidence--light.png`

没有 `360x800` 目录：项目所有者在冻结期间明确排除移动端/窄屏应用场景；该决定已同步到 `SCOPE.md`、`REQUIREMENTS.md`、前端/质量/开发流程和 `DESIGN_BASELINE.md`。
