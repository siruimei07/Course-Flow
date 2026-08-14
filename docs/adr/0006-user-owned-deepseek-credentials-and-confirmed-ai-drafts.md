# ADR-0006：DeepSeek 通过硬门禁后才启用；失败则纯手工

- 状态：Accepted，P4 已选择 `MANUAL_ONLY`
- 日期：2026-08-13；最终裁决：2026-08-14

## 决策

P4 已按本 ADR 的二选一规则签署 `MANUAL_ONLY`。发布面删除模型密钥配置、助手、自动抽取/审核、供应商 adapter、专用 contract/schema/table/config/UI；课程事实全部由用户通过既有表单手工录入。不以其他模型、平台共享 key、自定义代理或隐藏 feature flag 顶替。

## 原因

第一次真实请求前，冻结 eval corpus 被发现只有抽象 manifest，没有实际输入、逐字段 gold 或 locator；冻结 runner 也只有 dry-run。修补它们会改变冻结版本。与此同时，下游输入精确保留期、API 账户级可审计训练退出、DPA/子处理者附件仍为 `UNVERIFIED`。任一项都足以触发本 ADR 的失败分支。

## 后果

- 没有执行真实供应商调用；临时 key 未注入 workspace/process/network/log/database/report。
- 保留安全 Source 文件存储与预览、既有手工表单和确定性投影；不保留死 seam 或“以后可能用”的表。
- 清理不删除或改写已确认的 Term、Course、Course Item、Gradebook、课表或 Source metadata。
- 改变该约束必须由用户明确授权新的产品决策并新增 ADR；普通开发不得恢复。

详细门禁、哈希和清理清单见 [P4 签署报告](../quality/P4_MANUAL_ONLY_SIGNOFF.md)；历史研究入口见 [P4 归档](../architecture/AI_ASSISTANT.md)。
