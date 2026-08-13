# ADR-0006：DeepSeek 通过硬门禁后才启用；失败则纯手工

- 状态：Accepted
- 日期：2026-08-13

## 决策

CourseFlow 的 AI 是条件性能力，不是 MVP 的必备依赖。最终评审只允许两个发布结果：

- `AI_ENABLED`：DeepSeek 的官方能力、真实受控评测、质量/延迟/费用、凭据安全、数据条款与 UI 审核全部通过，并由产品所有者签署 `AI_GO`。此时真实 AI 使用用户在个人中心配置的 DeepSeek API Key，只调用固定官方 endpoint 的 allowlist 模型。
- `MANUAL_ONLY`：任一硬门禁失败，或最终评审仍为 `UNVERIFIED`。此时删除密钥配置、AI 助手、AI 抽取/Candidate 审核、DeepSeek adapter、AI 专用 contract 与数据结构；课程事实全部由用户通过既有表单手工录入。不以其他模型、平台共享 key、自定义代理或隐藏 feature flag 顶替。

即使启用 AI，资料抽取也只生成 Candidate/Evidence；个人助手只读取有界正式 snapshot 并输出解释或可放弃的 Planning Draft。模型没有写工具，任何正式变更都必须经用户核对并提交既有 command。

## 原因

DeepSeek 当前公开 API 足以支持文本 Responses 与 JSON Schema，但不原生接收 PDF/图片；真实效果、供应商稳定性和适用于下游最终用户的数据条款仍需受控验证。把 AI 设为硬门禁后的可选能力，可以避免 CourseFlow 的课程计划闭环依赖尚未证明的供应商能力，同时保持唯一、清晰的正式数据写入边界。

## 后果

- 开发和普通 CI 不使用真实 key；真实调用只发生在最终能力评审，凭据不进入仓库、日志、数据库或报告。
- `AI_GO` 前只允许隔离原型、provider-neutral contract、fake 与本地资料处理；AI 不进入生产 UI 冻结。
- `MANUAL_ONLY` 可保留安全的 Source 文件存储与预览，以及 P1/P2 已有手工表单和确定性投影；不保留死的 AI seam 或“以后可能用”的表。
- 若失败决定前已产生 AI 支持数据，清理不得删除或改写已确认的正式 Term、Course、Course Item、Gradebook 或课表数据。

详细门禁和清理清单见 [个人 AI 配置与规划助手](../architecture/AI_ASSISTANT.md#3-deepseek-ai-去留门禁)。
