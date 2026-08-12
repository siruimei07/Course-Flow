# CourseFlow Agent Guide

CourseFlow 把课程资料转成可核对的课程计划。任何自动抽取结果都只是候选数据；用户确认后，才可写入正式课程记录。

## 开始任务

1. 阅读 [CONTEXT.md](./CONTEXT.md)，使用其中的领域术语。
2. 阅读 [需求基线](./docs/product/REQUIREMENTS.md) 与 [架构索引](./docs/architecture/README.md)，再按任务类型打开该索引指向的专门文档。
3. 检查现有代码、测试和工作区改动；保留用户未要求修改的内容。
4. 确定本次变更所属模块及其公开 interface。跨模块调用只经过目标模块的公开入口。
5. 实现最小完整纵向切片，并在该 interface 上补齐可观察行为测试。

完成标准：相关文档约束全部满足，仓库已经提供的类型检查、测试和 lint 通过，且没有把 mock 数据、供应商类型或未确认的抽取结果泄漏到正式领域模型。

## 按任务读取

- 产品行为、开放问题、页面职责或验收标准变化：先读 [需求基线](./docs/product/REQUIREMENTS.md)，再读 [产品范围](./docs/product/SCOPE.md)。
- 表、关系、日期、成绩或来源证据变化：读 [数据模型](./docs/architecture/DATA_MODEL.md)。
- 上传、PDF/OCR、AI 抽取、重试或审核变化：读 [导入流水线](./docs/architecture/INGESTION.md)。
- HTTP、命令、查询、错误或模块调用变化：读 [接口契约](./docs/architecture/INTERFACES.md)。
- 页面、交互、样式或用户提供的 UI 代码变化：读 [前端与 UI 整合](./docs/architecture/FRONTEND.md)。
- 冻结网页原型、变更已确认视觉、建立视觉回归或把 HTML 迁移为生产 UI：读 [前端设计基线与冻结](./docs/design/DESIGN_BASELINE.md)。
- 测试、安全、性能、无障碍或可观测性变化：读 [质量要求](./docs/architecture/QUALITY.md)。
- 领取后续开发任务：读 [实施计划](./docs/architecture/IMPLEMENTATION_PLAN.md)，按当前已解锁阶段工作；用户明确调整优先级时，先同步阶段状态与依赖影响。
- 执行阶段开发、选择最小测试集、验收交接或处理 UI 批次：读 [Agent 开发执行流程](./docs/architecture/DEVELOPMENT_WORKFLOW.md)。

## 前端技能路由

已冻结设计先于任何技能的默认审美；只在下列触发条件成立时加载对应 skill：

- 设计冻结前的整体验收，或导航、表单、信息架构、核心流程发生变化：使用 `ux-heuristics`；仍有 severity 3/4 问题时不得冻结。
- 设计基线没有给出答案，或需要检查层级、间距、排版、响应式与无障碍冲突：先读设计基线，再使用 `typeui-fundamentals`；具体视觉值服从已冻结 token，无障碍硬约束优先。
- 编写、评审或重构 React/Next.js 页面、组件、数据读取与 bundle：使用 `build-web-apps:react-best-practices`。
- 任何可见前端变更完成后：使用 `build-web-apps:frontend-testing-debugging`，优先在内置 Browser 中按冻结的 viewport、主题和状态做交互及截图比对。
- 项目存在 `components.json`，或任务明确操作 shadcn 组件/registry：使用 `build-web-apps:shadcn`；“shadcn 风格”本身不触发 CLI 或依赖变更。
- 热力图、时间线、统计图表或 Insight 可视化的选择、实现与验收：使用 `build-web-data-visualization:data-visualization`，保留移动端和非视觉等价表达。
- Web 交互明确涉及手势、弹簧、sheet、动量、空间层级或半透明材质：使用 `apple-design`，把原则适配到 Web 语义并保留 reduced-motion 等价体验。
- 仅当任务是原生 iOS、iPadOS、macOS、watchOS 或 visionOS 设计/实现/审计时使用 `apple-human-interface-guidelines`；普通响应式网页不触发它。
- 整页/整应用的设计转代码或大范围视觉实现：使用 `build-web-apps:frontend-app-builder`；已有冻结基线时把它当作已批准 concept，只执行 fidelity 工作，不生成新概念。
- 只有在冻结前由 Agent 新建设计方向，或用户明确批准重设计时，才使用 `example-skills:frontend-design`。冻结后只补齐同一设计系统，不得生成竞争性视觉方向。

## 稳定规则

- `packages/core` 是领域规则的单一来源；页面、Route Handler、worker 和数据库 adapter 不复制领域判断。
- 模块对外暴露少量高杠杆 interface；数据库、对象存储、队列、OCR 和 AI 供应商位于 seam 的 adapter 一侧。
- 正式数据只来自用户手工输入或已审核候选。低置信度只影响展示优先级，不能绕过审核。
- 日期按课程时区解释；纯日期保持纯日期，不能用 UTC 午夜伪装。
- 课表保存周期课节与例外，具体课节实例按范围派生；Reading Week 不通过删除课节规则实现。
- 成绩使用整数基点：`10000 = 100%`。未知值保持未知，不用 `0` 代替。
- 任务短期/中长期分组与当前成绩都是正式数据的派生投影，不另建第二套真相；未出分成绩不按零分。
- 每个抽取字段保留来源证据、置信度与推断说明；原始候选不可被后续编辑覆盖。
- UI 只依赖 view model/contract，不直接读取数据库实体。用户提供的页面代码先拆分视觉、交互和数据职责，再接入真实模块。
- 冻结 UI 基线是具体视觉和交互的只读权威；普通实现不得静默改写。正确性、安全、隐私、领域 contract 或无障碍要求造成的偏差必须记录，新的视觉方向必须由用户确认并生成新基线版本。
- 统计页保留稳定入口和查询 seam；指标未定义前不建立通用插件系统或虚构统计表。
- 新的不可逆架构取舍满足 ADR 条件时写入 `docs/adr/`；领域词义变化同步更新 `CONTEXT.md`。
