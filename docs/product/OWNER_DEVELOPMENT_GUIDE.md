# CourseFlow 项目所有者开发使用指南

本指南用于给 Agent 下达下一阶段任务。当前权威状态见 [实施计划](../architecture/IMPLEMENTATION_PLAN.md)：P0–P4 已完成，P4 签署 `MANUAL_ONLY`，P5 为 `next`。

## 开始任何任务

要求 Agent 先读取 `AGENTS.md`、`CONTEXT.md`、需求基线和架构索引，再按任务类型读取专门文档；检查 dirty worktree，保留无关改动，并通过模块公开 interface 交付最小纵向切片。

对于可见 UI 变化，明确引用冻结基线/矩阵，使用 React best practices，并在完成后用内置 Browser 验证 `1280x900`、200% zoom、键盘、主题、console 与 screenshot。不要把本地 visual lab 或 fixture 当 production contract。

## 当前发布约束

- 所有正式课程事实来自用户明确提交的手工表单。
- Sources 只提供私有上传、安全预览、删除和从旁打开既有表单；上传不改变计划。
- 日期、Reading Week、任务分组、成绩、负荷、冲突与 ICS 由 core 的正式 snapshot 派生。
- P4 已删除远程模型凭据、自动解析/审核、助手、route/module/adapter/prompt/schema/table/migration/config/UI/文案；不得换模型、增加代理或用隐藏 flag 恢复。
- 研究/ADR 是历史证据，不是 backlog 或实现入口。

## P5 推荐指令

```text
请读取 AGENTS.md、CONTEXT.md、REQUIREMENTS.md、IMPLEMENTATION_PLAN.md、DEVELOPMENT_WORKFLOW.md、FRONTEND.md、QUALITY.md 和当前设计基线，执行 P5 中一个最小完整纵向切片。先明确用户可观察场景、目标模块公开 interface 和冻结矩阵行，再接真实 view model/command；production 不带 mock。保持 P4 MANUAL_ONLY：不得新增模型凭据、远程调用、自动解析/审核、助手或替代供应商。可见变化完成后用 Browser 验证 1280x900、200% zoom、键盘/focus、主题、console 和 screenshot；运行目标测试及 pnpm gate:p4。报告结果、范围、实际命令、UI 证据、门禁与下一步。
```

## 新设计批次

若普通账户/设置或其他页面设计完成：

```text
请按 DESIGN_BASELINE.md 冻结新版本。只纳入当前 MANUAL_ONLY 产品范围，删除 visual lab 中历史上被 P4 拒绝的模型配置、自动解析/审核和助手画面。先完成 route/状态矩阵、ux-heuristics、typeui-fundamentals 与无障碍审计；severity 3/4 或范围冲突未解决时不要宣布冻结。保存可追踪 HTML 快照、hash、token/交互清单、1280x900 参考截图与 200% 功能检查，更新 UI_INTEGRATION_LOG；不要同时开始 production 实现。
```

## P6 前置确认

统计工作开始前，项目所有者需逐项给出：Insight 名称、用户决策用途、正式输入范围、公式/单位、最小数据量、数据质量与不足状态、是否需要图表及其非视觉等价。缺少这些定义时保持真实空状态，不让 Agent发明指标。

## 验收提问

交付后要求 Agent 回答：

1. 用户现在能完成什么，失败时看到什么？
2. 哪个 module/interface 拥有规则，哪些只是 adapter/UI？
3. 实际运行了哪些命令，退出状态是什么？
4. 哪个冻结 UI ID/矩阵行被验证，Browser 证据是什么？
5. `pnpm test:manual-only` 与 secret scan 是否通过？
6. 是否有未满足门禁；下一步为何已解锁或仍锁定？

## 不应接受的交付

- 只说“测试通过”但不给实际命令/范围。
- 用截图、mock 或 fake 冒充真实持久化与正式投影。
- 在页面、Route Handler 或 adapter 复制日期/成绩/负荷规则。
- 为未来能力创建空表、通用 provider、BaseService 或第二套真相。
- 把 P4 归档研究当成恢复被拒绝功能的许可。
