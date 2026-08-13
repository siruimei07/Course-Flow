# CourseFlow 开发使用指南（给项目所有者）

按 P0 → P6 一阶段一阶段推进（P0 就是实施计划中的阶段 0，以此类推）。需求与开放问题以 [需求基线](./REQUIREMENTS.md) 为入口；每次只把下面对应的一段提示词发给 Agent，等它给出门禁报告并更新 [实施计划](../architecture/IMPLEMENTATION_PLAN.md) 后，再发下一段。详细执行标准由 [Agent 开发流程](../architecture/DEVELOPMENT_WORKFLOW.md) 负责，你不必把技术要求反复复制到每次对话。

## UI 应在什么时候提供

| 时间点            | 你需要决定什么                                              | 可以留给 Agent 的部分                  |
| ----------------- | ----------------------------------------------------------- | -------------------------------------- |
| P0 开始前/进行中  | 有参考就发；没有也不阻塞                                    | 工程骨架和中性 token                   |
| P1 大量页面开写前 | 全局方向：导航、字体、色彩、圆角感、卡片/表单风格、动画气质 | loading/empty/error、正常横屏桌面和小交互 |
| P2 结束前         | dashboard、课程页、timeline、calendar 的主要布局和信息层级  | 极端数据、无障碍和响应式细节           |
| P3 开始前/进行中  | 上传、预览、手工录入；AI/密钥/审核/结果区只作 conditional 方案 | 结果区 idle/generating/completed/failed 等状态与受限桌面 pane 重排 |
| **P4 最终评审**   | 提供临时 DeepSeek key 并签署 `AI_GO` 或 `MANUAL_ONLY`；仅通过后定型 AI UI | 文案微调、边距、动效参数和可访问性修正 |
| P5                | 接入晚到片段、统一和打磨                                    | 不能把 P5 当第一次设计全部页面         |

“几乎所有”不等于每个像素都由你画完。最迟在 P4 前，你需要确认全局视觉语言和所有核心页面的结构；未设计的状态和次要页面由 Agent 按已确认风格补齐。所有界面默认保持圆角，并带有克制、支持 reduced-motion 的动画。

## 当前网页设计完成后

当前根目录 `courseflow-visual-lab.html` 是持续修改的视觉实验室，并被 `.gitignore` 排除。设计过程中保持这样即可；当你确认设计完成时，不要直接让 Agent “照这个 HTML 开始写生产页面”，先让它按 [前端设计基线与冻结](../design/DESIGN_BASELINE.md) 建立新基线。冻结会把 HTML 的精确快照、hash、token、route/状态矩阵和 `1280x900` 正常横屏桌面参考截图纳入 Git，并先处理严重可用性、无障碍与产品范围冲突。

发送下面这段即可：

```text
前端设计已完成。请按 docs/design/DESIGN_BASELINE.md 把当前 courseflow-visual-lab.html 冻结为新的 UI 基线。先做 route/状态矩阵与冻结前审计；severity 3/4 或产品范围冲突未解决时不要宣布冻结。通过后保存可追踪的 HTML 快照、hash、token/交互清单和 `1280x900` 正常横屏桌面参考截图，更新对应 UI 条目。不要开始生产页面实现。
```

你确认冻结报告后，再按实施计划从当前 `next` 阶段推进。P3 已完成并只冻结 `p3-manual-v1` 的 Source 上传/预览/手工录入；当前 `next` 是 P4，AI 页面继续 conditional，必须先按冻结 policy 做最终去留门禁。每个可见切片都必须引用相应基线，在同 viewport/主题/fixture 下做截图比对；改变已确认视觉时建立新版本，不原地改写旧基线。这样后续开发锁定的是可版本化、可测试的设计合约，而不是某个 Agent 对网页文件的主观理解。

## 发送网站、页面或 HTML/CSS 时

把网站链接、截图、附件和代码尽量放在同一条消息，附上这段：

```text
这是 CourseFlow 的一批 UI 输入。

输入：<网站 URL / 截图 / 附件路径 / HTML-CSS-JS 或组件代码>
目标页面：<route 或功能；不确定可写“请你判断”>
必须保留：<最喜欢的布局、色彩、圆角、字体、动画或交互>
允许调整：<可以适配的部分>
代码授权：<可直接复用 / 只作视觉参考>

请先按 docs/architecture/FRONTEND.md 和 UI 整合记录登记、拆分视觉/交互/数据职责并提取风格指纹，再决定当前阶段是原型还是接入。HTML/CSS 要转换为 CourseFlow 的 React/Next.js、semantic token 和最小 Client island；不要把 mock 数据或页面自带业务规则接进正式模型。对我没提供的页面和状态，按同一风格补全，保持圆角、动画、响应式和键盘可用。只有涉及新产品行为时再向我确认。
```

同一风格的新参考可以继续发；如果它推翻旧风格，请明确写“替代 UI-xxxx”，否则 Agent 会优先把它视为现有设计系统的补充。

## DeepSeek 暂定接入方式

专项可行性研究的当前结论是：**接口形态有条件可行，但尚未通过真实能力门禁**。DeepSeek 可以接收 CourseFlow 本地准备的有界文本，并按 JSON Schema 返回结构化答案；它不能直接读取 PDF/图片，也不能替代本地 Evidence、日期、成绩、权限和正式写入校验。完整证据见 [本地文本—提示词—UI 插槽可行性研究](../research/deepseek-local-text-prompt-ui-slot-feasibility.md)，实现权威见 [个人 AI 架构](../architecture/AI_ASSISTANT.md#41-暂定实现框架)。

暂定数据流只有这一条：

```text
本地 PDF/OCR/正式课程 snapshot 与短期对话裁剪
→ feature 内固定、版本化 Prompt Registry
→ 固定 DeepSeek Responses JSON Schema 请求
→ 本地 schema、引用/Evidence 与领域校验
→ 安全 view model
→ 条件性 AI 结果区或 Candidate 审核页
```

你需要把握四个决策点：

1. **P3 不提供真实 key。** Agent 只能用 deterministic fake 证明框架、错误与界面状态，不得把 fake 或官方文档当成真实效果。
2. **第一次真实调用前批准 `ai-eval-policy-v1`。** 先锁定去身份化样本、准确率/Evidence/安全阈值、p95 延迟、费用和失败率；看到结果后不为通过而改阈值。
3. **确认数据发送说明。** “本地处理”只表示文件解析、OCR、裁剪和校验在 CourseFlow 完成；最终放进 prompt 的最小文本仍会发送给 DeepSeek，界面必须如实说明。
4. **P4 只签一个结论。** 全部门禁通过才签 `AI_GO`；任一失败或未验证即签 `MANUAL_ONLY`，删除 AI，不换供应商。

如果你提供 AI 结果区的网页代码或截图，请把它标为 `conditional`，并至少画出：未开始、生成中/取消、完成回答、带引用/假设、带表单草稿、失败与手工恢复。页面预留的是 `AiResultRegion`，不是空白卡片；生产实现只渲染 server 已校验的 view model，不直接插入 DeepSeek 原始文本、Markdown/HTML 或逐 token JSON。

## 阶段提示词

### 第一次：开始 P0

```text
请读取 AGENTS.md、CONTEXT.md、架构索引、IMPLEMENTATION_PLAN.md 和 DEVELOPMENT_WORKFLOW.md，检查当前工作区后只执行 P0：仓库与质量骨架。按“代码优先、边界防御、最小证明集”工作，不创建空的未来模块。完成后运行 P0 门禁，更新实施计划状态，并按阶段交付格式报告实际验证结果；有未通过项就保持 P0 未完成。
```

P0 不需要等 UI。如果你已有代表性的网页或代码，可以在 P0 期间用上一节的 UI 提示词另发一条。

### P0 完成后：进入 P1

开始前最好已经提供至少一组能代表全局风格的 UI；没有时 Agent 会先做一致、可替换的基线。

```text
请先审计 P0 的完成证据；门禁满足后执行 P1：学期、课程/多个 Lecture-TUT-PRA 课节、Reading Week、手工事项/标签与成绩闭环。先固化全局 UI 风格指纹和圆角/motion token，再按纵向切片接真实 auth scope、PostgreSQL、contract 和页面。完成 Gradebook 手工结果与覆盖权重口径，但不做 GPA/最终预测。只为权限、时间/课节语义、成绩不变量和版本冲突补最低充分测试。完成后更新阶段状态并报告 P1 每项验收证据。
```

### P1 完成后：进入 P2

这一步前应确认 dashboard、课程页、表单、timeline/calendar 的大方向。

```text
请先核对 P1 已标 done 且真实数据、权限、课节/Reading Week、四种事项时间语义、标签、成绩覆盖和 canonical E2E 都通过，然后执行 P2：ScheduleSnapshot、学期进度、今日/下一节课程、tasks 短期/中长期分组、热力图、冲突和 ICS。所有投影必须来自同一正式数据 snapshot。沿用并扩展现有 canonical E2E，不为每个页面增加烟测。P2 结束前完成常规 MVP 页面的 UI 定型，按门禁验收并解锁 P3。
```

### P2 完成后：进入 P3

此时 P1/P2 UI 已基本确定。P3 先完成不依赖 AI 的资料上传、预览和手工录入；个人中心/密钥/助手可继续优化，但必须标为 conditional，不能在最终门禁前冻结成产品承诺。

```text
请先审计 P2 门禁和 UI 整合记录，并读取 DeepSeek 本地文本—提示词—UI 插槽可行性研究。执行 P3：先冻结并实现 Sources 上传、安全预览、删除和“对照资料打开既有手工表单”，走通上传→预览→手工录入→Timeline/Dashboard；这条闭环不得依赖 AI。然后在真实调用前冻结 ai-eval-policy-v1，只在隔离 composition 中实现 `Local Preparation → Feature Prompt Registry → DeepSeek Responses Port → Local Result Validation → Safe View Model → UI Result Region`。资料侧本地 PDF/OCR/分页/locator，助手侧本地正式 snapshot/短期对话裁剪；ingestion 与 assistant 分别持有源码内版本化 prompt/schema/budget，client/数据库/资料不能覆盖。DeepSeek contract 用正向字段 allowlist 固定官方 endpoint、deepseek-v4-pro、non-streaming、reasoning none、JSON Schema 和无 tools/web，并省略不支持的 store/会话字段；日常只用 deterministic fake。只接受 completed 的唯一完整 output_text，经本地 schema、citation/Evidence 与领域校验后生成 Candidate/Draft view model；原始 response/HTML/Markdown/reasoning/error 不进入 DOM。条件性 AiResultRegion 覆盖 idle/generating/completed/cancelled/failed，并保留重试/配置/手工恢复。开发、CI、E2E、截图不得填入真实 key，也不得把 live adapter、AI route/migration/UI 装入默认生产。用 ux-heuristics 与 typeui-fundamentals 审核 MANUAL_ONLY 和 AI_ENABLED 两套矩阵，P3 只冻结前者。完成后报告手工 canonical E2E、prompt/input/output/UI fake 证明、默认生产隔离、eval runner dry-run 和仍为 AI_PENDING 的状态。
```

### P3 完成后：进入 P4（DeepSeek 最终去留门禁）

这是唯一允许使用真实 key 的最终评审。你需要临时提供可用 key；评测后立即撤销。若能力、质量、延迟/费用、安全、隐私条款或 UI 任一硬门禁失败，或者仍未验证，就选择 `MANUAL_ONLY`，删除 AI 全部功能，不接其他模型。

```text
执行 P4 DeepSeek 最终去留门禁。先确认 ai-eval-policy-v1、corpus、阈值和 P3 的 prompt/schema/budget versions 已在第一次真实调用前冻结，再通过受保护 secret input 使用我临时提供的 key。用同一版本运行 extraction/assistant smoke、完整 eval、错误 contract 与 prompt-injection/越权红队，验证实际 request 确实固定官方 endpoint、deepseek-v4-pro、JSON Schema、无 tools/web、non-streaming 和预算；统计结构成功率、关键字段 precision/recall、Evidence/citation 命中、p50/p95 延迟、终态失败率、token 和费用。同时核对适用于下游用户的数据保留、训练使用/退出、处理地域、DPA/条款与披露。评测后立即撤销 key，不记录 key、正文或 CoT，不得为了通过修改样本、阈值或 prompt/schema。最终只能提交 AI_GO 或 MANUAL_ONLY：AI_GO 时只启用已评测版本的 live adapter/migration，完成凭据/审核/助手安全、AiResultRegion 浏览器验收和 AI UI 冻结；任一失败或 UNVERIFIED 时删除 AI 配置、助手、解析/候选 UI、route/module/adapter/prompt/schema/table/migration/config/文案，不换模型，并回归 Sources 手工闭环。更新 P4 状态后报告签署结果和清理/启用证据。
```

### P4 完成后：进入 P5

如果此时再提供 UI，最好明确它是局部优化还是替代已有 UI ID。

```text
请审计 P4 的 corpus baseline、Evidence、provider failure 和 cleanup 门禁，然后执行 P5：UI 整合与体验打磨。清空 UI log 中尚未处理的条目，统一 token/primitives，完成评分方案差异、国际化、`1280x900` 正常横屏桌面、键盘、WCAG、reduced-motion、视觉基线和基于实测的性能优化。保持圆角和既定动画风格；删除生产 mock、旧 CSS、临时 route 和被替代实现。不要扩张成每页 E2E。完成后给出最终 UI/质量验收矩阵。
```

### P5 完成后：是否进入 P6

如果首批统计洞察还没定义，停在 P5，P6 保持 locked。定义时先填这些内容：洞察名称、它帮助做什么决定、输入范围、公式/口径、最少数据量、数据不足时怎么显示。

```text
P5 已完成。请先判断下面的 Insight 定义是否足够具体；不足就只列必须补充的问题，不写假数据或通用统计框架。

Insight 定义：
- 名称：<填写>
- 决策用途：<填写>
- 输入范围：<填写>
- 计算口径：<填写>
- 最少数据量：<填写>
- 数据不足状态：<填写>

定义完整后执行 P6：用纯 calculator、显式 registry 和 InsightQueries 实现，只读取正式数据。每个数字显示定义、范围和数据质量，用可手算 fixture 验收；不实现动态 SQL 或插件系统。
```

## 中途修正的提示词

如果某阶段验收失败，不要直接让 Agent 进入下一阶段，使用：

```text
保持当前阶段状态不变。请根据上次门禁报告只修复这些未满足项：<粘贴缺口>。按最低风险所在层补代码和测试，不扩大范围。全部通过后重新给出完整门禁证据，再决定是否解锁下一阶段。
```

如果你想调整阶段顺序，使用：

```text
我希望把 <功能> 提前到 P<n>。请先根据 IMPLEMENTATION_PLAN 和架构文档说明它依赖哪些尚未完成的 interface、会改变哪些阶段状态，以及能否作为隔离 UI 原型完成。先给最小调整方案；未获我确认前不要打穿被锁定的领域/数据阶段。
```
