# CourseFlow UI 整合记录

本文件追踪用户提供的页面/设计如何进入统一 UI。视觉稿确认后按 [设计冻结流程](./DESIGN_BASELINE.md) 建立不可变版本；`prototyped` 不等于 `frozen`。

## 全局偏好

- 正常横屏桌面 Web，像素参考 `1280x900`；200% zoom 做 WCAG 2.2 AA 功能保留检查。
- 表面、卡片、控件和 overlay 使用一致语义圆角；动效克制并提供 reduced-motion 等价。
- 未完整设计页面从冻结风格指纹补全，不另起视觉语言。
- P4 已签署 `MANUAL_ONLY`；当前/未来矩阵不包含远程模型配置、自动解析/审核或助手。

## 总览

| ID | 页面/功能 | 状态 | 当前目标 |
| --- | --- | --- | --- |
| UI-0001 | CourseFlow 多页面视觉实验室 | superseded-partial | P4 tombstone；仅保留非 AI Calendar/Tasks/Insights 历史截图 |
| UI-0002 | 个人中心初稿 | superseded-rejected | 与被拒绝的条件 surface 混合；P4 已删除本地原型 |
| UI-0003 | 模糊玻璃与设置中心 | superseded-rejected | 与被拒绝的条件 surface 混合；P4 已删除本地原型 |
| UI-0004 | P3 Sources 手工闭环 | frozen + verified | `/sources` → 既有手工表单 → Timeline/Dashboard |
| UI-0005 | P5 Tasks 完成闭环 | integrated + verified | `/tasks` → `planning.setCourseItemState` → `schedule.getTaskBoard` |

状态只用 `received/mapped/prototyped/frozen/integrated/verified/superseded` 加必要限定。被替代条目保留历史说明，但不进入当前 route/状态矩阵。

## UI-0001：CourseFlow visual lab

- P4 后状态：[ui-v1 tombstone](./baselines/ui-v1/BASELINE.md)；不再是完整可执行基线。
- 保留：顶部导航、温暖中性色表面、黄色主强调、课程辅助色、大圆角 shell/card/control、软阴影、浅深主题、桌面密度。
- 生产替换：示例课程/日期/百分比/统计全部由真实 view model 替换；专注计时、通知、mock 完成状态不伪装正式 command。
- P1/P2 已接 Term/Course/Meeting/Planning/Gradebook、Dashboard/Tasks/Calendar/Timeline/Workload/Conflict/ICS。
- P3 已由 UI-0004 接真实 Sources 手工闭环。
- 历史 reference、受污染的页面截图与 review overlay 已删除；不能从 Git 历史据此恢复 route/component。

映射原则：overview → Dashboard snapshot；courses/calendar/tasks → 各正式 feature；sources → Source VM + 手工入口；statistics → 只有指标定义后才接真实 Insight。fixture 永不进入 core/database/production route。

## UI-0004：P3 Sources 手工闭环

- 输入：`ui-v1` 派生 + P3 Source contract。
- 当前状态：`frozen` 且 production canonical E2E 已验证。
- 权威：[p3-manual-v1](./baselines/p3-manual-v1/BASELINE.md)；[状态矩阵](./baselines/p3-manual-v1/SCREEN_MATRIX.md)；[验证](./baselines/p3-manual-v1/VERIFICATION.md)。
- UX：9/10，severity 4/3/2 均为 0。上传状态、零正式写入说明、安全预览、删除确认/错误和既有表单入口均可识别/恢复。
- TypeUI：继承 token、单一 primary、持久 label、可见 focus、44px target、非颜色状态及 200% 功能保留。
- 实际路径：上传 → 预览 → 打开事项表单 → 手工提交 → Timeline/Dashboard 回读 → 删除后预览撤销且正式事项保留。
- P4 清理后，页面 copy 明确 Source 是原文容器；不出现解析、候选数量、审核或助手操作。

## UI-0005：P5 Tasks 完成闭环

- 输入/矩阵：`ui-v1` tombstone 中保留的 `/tasks`、`1280x900`、light 行；dark 与 200% 只做功能等价检查，不建立竞争性视觉方向。
- 用户场景：用户用圆形控件或键盘把待办事项标记为完成；成功后事项离开待办分组并显示持久状态，Timeline 与正式记录仍保留。版本陈旧时原行不消失，显示可恢复的冲突提示且不覆盖新版本。
- interface：交互只调用 Course Item state HTTP contract；route adapter 进入 `planning.setCourseItemState(expectedVersion)`，刷新后的页面只从 `schedule.getTaskBoard` 读取投影。
- 数据边界：production 不含 task fixture/mock；完成状态来自用户明确操作，未直接读取数据库实体或写第二套 task 真相。
- 可见映射：复用冻结圆形完成 affordance、44px target、既有颜色/token 与 focus ring；编辑、取消、软删除仍是独立正式 command。
- 验证：1280x900 浅/深主题、200% 等效视口、键盘 focus/Enter、成功与 409 冲突、console、截图、canonical E2E 与 MANUAL_ONLY 门禁。

## UI-0002：个人中心

- 历史输入把头像 overlay、账户摘要和普通偏好与未冻结的条件方案混在同一原型。
- P4 已删除该本地混合原型；整个条目为 `superseded-rejected`，不再是后续冻结输入。
- 如需普通账户与偏好，重新从当前手工模式设计；不得带回永久 disabled 卡片、凭据字段、提问框或相关错误状态。

## UI-0003：模糊玻璃与设置中心

- 该本地混合原型已在 P4 删除，视觉材质和设置中心均未冻结，不覆盖 `ui-v1`。
- 其过去的点击、截图或浏览器结果不构成当前验收证据；未来新方向必须建立不含拒绝 surface 的干净原型。

## P4 设计清理记录（2026-08-14）

- 删除隔离 import harness、结果区域组件、审核 workbench 及专用 CSS。
- 删除两个被 `.gitignore` 排除、混入条件 AI surface 的页面级视觉实验稿，并从忽略规则移除；无 AI 的局部组件样式实验页保留。
- 当前生产 Sources 文案改为“原文容器 / 手工核对 / 预览页序”。
- `p3-manual-v1` 矩阵只保留四条手工 route/surface。
- `ui-v1` 的可执行 HTML、两个专用 review screenshot，以及会直接或在背景中呈现候选/审核的 Dashboard/Courses/Sources/add-item 截图均已删除；只保留像素复核无 AI 的 Calendar/Tasks/Insights 历史图。
- 新可见实现需通过 Browser 检查、canonical E2E 与 `pnpm test:manual-only`。

## 条目模板

```md
## UI-XXXX：名称

- 输入/日期：
- 目标 route/feature：
- 当前状态：received
- 基线/矩阵：
- 视觉意图：geometry / typography / color / depth / density / motion
- 映射：token / primitive / feature / view model / action
- 验收：1280x900 / 200% / keyboard / themes / states / Browser / tests
```
