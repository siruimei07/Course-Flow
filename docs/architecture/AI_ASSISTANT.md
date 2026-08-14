# P4 远程 AI 去留门禁归档

> 状态：`MANUAL_ONLY`，2026-08-14 已签署。本文件只解释历史决策，不是当前模块设计或后续开发入口。

## 1. 最终裁决

P4 在第一次真实供应商请求前触发硬失败：冻结语料只有 5 条抽象 manifest，没有可发送输入、逐字段金标或可计算的 locator；冻结运行器只支持 `--dry-run`。同时，适用于 CourseFlow 下游用户的精确保留期、API 账户级可审计训练退出，以及 DPA/子处理者附件仍为 `UNVERIFIED`。

门禁规则规定任一失败或 `UNVERIFIED` 都必须选择 `MANUAL_ONLY`。因此没有真实模型调用，没有请求正文、响应、推理内容、token 或费用记录，也没有为通过而修改冻结样本、阈值、prompt、schema 或预算。

完整签署与清理证据见 [P4 MANUAL_ONLY 签署](../quality/P4_MANUAL_ONLY_SIGNOFF.md)，第一方资料核验见 [P4 官方尽调](../research/deepseek-p4-official-due-diligence-2026-08-14.md)。

## 2. 当前产品约束

- 不提供模型凭据配置、个人规划助手、自动资料解析、结构化候选或审核工作台。
- 不包含供应商 transport/adapter、prompt/schema/budget registry、评测 runner、专用 route/module/table/migration/config 或发布文案。
- 不以其他模型、自定义 endpoint、代理、隐藏 flag 或未接线“以后可能用”的 seam 替代。
- Sources 只负责私有上传、安全预览、下载与删除。用户从预览旁打开既有手工表单，明确提交后才写正式记录。
- 已确认的 Term、Course、Meeting、Course Item、Gradebook 和 Source 数据不因 P4 清理被删除或改写。

## 3. 保留范围

只保留研究记录、ADR 与本签署归档，用于证明为什么没有该能力。它们不得被生产代码导入，也不得出现在运行时导航、配置或数据库 schema 中。

改变 `MANUAL_ONLY` 需要用户明确提出新的产品决策、重新建立独立版本与法律依据，并新增 ADR；普通功能开发不得恢复已删除实现。
