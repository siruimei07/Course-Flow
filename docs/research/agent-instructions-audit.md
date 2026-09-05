# 项目 agent 指令审计记录

日期：2026-09-05。本记录是审计证据，不是新的产品规范或每次任务的启动材料。

## 依据与范围

已在线搜索并打开用户指定的 [GPT-6 Astra 官方模型指南](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra)，采用其中 Prompting best practices 的指令优先级、授权内自主完成、按需并行与按风险验证建议。这里是对项目指令的应用，不涉及模型、API 参数或产品技术栈迁移。

核对范围：根 [AGENTS.md](../../AGENTS.md)、其引用的 skill 门禁与读取规则、[Contracts §1.5](../architecture/MODULE_CONTRACTS.md#15-agent-目标读取路径)、[Backlog](../roadmap/BACKLOG.md) 注册表与相关证据。未以归档旧实现作为规范来源。

- 仓库跟踪文件与隐藏路径检索均未发现项目 `SKILL.md`，因此没有虚构、安装或修改项目 skill。
- 旧约定的仓库外 `.claude/skills` 在本机相关工作区与用户目录未找到。受限路径搜索和 Spotlight 也未定位到 `stop-that-shit`、`applying-baidu-fecs-standards`、`emil-design-eng`、`design-taste-frontend`、`impeccable`；这些 skill 及其 references 原文未审计。没有声称 Stop Guard 已确认合同。
- 已读取可访问的 OpenAI Docs、writing-for-agents（含 SKILL-MECHANICS）、Superpowers using-superpowers、writing-skills、verification-before-completion，以及 OpenAI Docs 的 model-migration reference。它们属于共享技能或插件缓存；本次只在项目规则中明确适用范围与优先级，没有修改共享文件，也不将此样本称为全部已安装 skills 审计。

## 发现与修改

| 发现 | 修改与理由 |
|---|---|
| AGENTS 的当前实现仍描述 R2-01；Backlog 已登记 R2–R6 完成 | 删除易过时的进度副本，保留 Backlog 唯一状态来源；probe/开发根不等于活动数据的约束保留 |
| 十个 ADR 摘要复制技术决定 | 改为已批准 ADR 的读取入口，保留容易误加的生产诊断禁区、摘要协议和发布门禁；ADR 原文不变 |
| 决策原则、Ponytail、复用、范围和完成规则多处重复 | 合并为范围、实现原则和验证三处；原九条 CourseFlow 硬边界逐条保留 |
| 广泛 skill 触发、额外审批、固定重复验证及 skill 的 push 建议可能与项目规则冲突 | 明确直接指令和用户合同优先、按实际任务加载、已有授权内完成、相关检查通过后停止；未授权 push 仍禁止 |
| 前端和 FECS 细则对其他任务形成常驻负担；旧路径暗示 skills 已安装 | 移至 [专项 skill reference](../agent-skills.md)，由根指令按分支引用；保留三件套顺序、条件层、原生 CSS、FECS 等级及冲突规则，缺失原文如实报告 |
| Contracts §1.5 要求读取整个 §1–§4，与目标章节读取冲突 | 仅将第 2 步收窄为目标引用条目，遇未解析引用或不变量再扩展；接口和业务契约不变 |
| “删除旧路径”可能被解释为顺手清理授权 | 限定为目标范围内确认废弃的路径，保留可能承载用户数据的可读性与迁移要求 |

独立复核曾发现精简稿误将旧实现恢复写成无条件禁止；已恢复用户明确要求研究或恢复旧尝试的例外，并单独验证。研究授权仍不自动授权执行恢复。

## 验证记录

- 静态审阅：主任务审阅最终 diff，独立子任务对照修改前 AGENTS 核对硬边界、授权、数据兼容、skill 门禁和提交规则；发现的旧实现例外已修正。
- 链接与术语：用临时 Python 检查本地 Markdown 目标及标题锚点；核对 ADR 文件、MOD-PLAN、Contracts §1.5、Roadmap §8 和样式文件路径。中文叙述与英文稳定标识保留。
- 指令场景：独立子任务读取当前项目规则，对下表九个假设任务作只读判断；主任务逐项检查其回答与预期一致。前八项一次核对，第九项在修复例外后补验。这是场景级指令核对，不是执行产品操作、模型 A/B 实验或统计成功率。

| 场景 | 核对结果 |
|---|---|
| 已授权修一处 Markdown 链接 | 文档检查和本地提交；不因 skill 再确认或全量打包 |
| `review only` 发现真实缺陷 | 报告，不写入、不提交 |
| 冻结页面焦点修复，三件套不可用，无性能问题 | 报告原文缺失，按项目门禁检查；不重新定调或加载性能 skill |
| 后端已有 Intent 错误映射 | 定向读相关公共契约；代码触发 Ponytail/FECS，后端不触发前端三件套 |
| 相关验证通过后模板要求重复多轮 | 无新改动、失败或未决风险即结束测试循环 |
| 文档子任务建议领取下一主链工作包 | 允许独立只读核对，不扩大工作包范围 |
| 数据格式是否承载用户数据未知 | 按已承载处理，不直接删除重建 |
| Hook 拒绝而等价工具可执行 | 不绕过，只做允许的窄化动作或请求更新合同 |
| 明确要求研究或恢复旧尝试 | 授权例外有效，现有业务、技术与数据边界继续适用 |

所有改动均为 Markdown，未改目录结构、代码、依赖、产品行为或工作包状态。FECS 路由按仓库已有规定属于未覆盖的 Markdown 内容；因 skill 原文缺失，不宣称完成 FECS 原文合规审计。执行 `git diff --check` 和本地引用检查；未运行应用 test/typecheck/package/smoke，也未执行双平台产品验证。

提交前发现其他工作新增了 Backlog、Roadmap 和 WP-GA-01 验收文档改动，触发“工作区仅含本任务文件”的临时断言。随后按本任务四个明确路径核对和提交；其他改动保留，不纳入本次提交。

## 精简量

以 Python `len(text)` 计 Unicode 字符（含 Markdown 标记和换行），不冒充模型 token 数：原 AGENTS 为 9,057 字符、156 行；修改后根文件为 77 行，常驻字符减少约 44.6%。加上按需读取的专项 reference，指令总字符仍减少约 23.5%。本审计记录不计入执行指令体积，也未被根文件作为启动材料引用。
