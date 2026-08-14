# `ui-v1` P4 tombstone

`ui-v1` 于 2026-08-12 冻结，但其单文件 reference、Dashboard、Courses、Sources 与 add-item 背景同时包含后来未通过 P4 门禁的自动解析、候选审核或相关计数。P4 在 2026-08-14 签署 `MANUAL_ONLY` 后，不能继续把这些可执行或可见工件作为现行 UI 合约。

## P4 处理

- 删除 `reference/courseflow.html`，因为它可直接运行候选/Evidence 审核交互。
- 删除 Dashboard、Courses、Sources、review overlay 与 add-item overlay 截图，因为它们直接或在背景中呈现被拒绝 surface。
- 保留经像素复核不含模型、自动解析、候选或审核 UI 的 Calendar、Tasks 与 Insights 历史截图；它们只保留普通视觉 token 与构图证据。
- 原始 snapshot hash `88A968C3241AE704E23CFE1F531A2D4AC10806AC89D8DE4A2C6BE150B33A991A` 仅作被删除对象的审计标识，不能用于恢复文件。
- Sources 当前唯一权威增量是 [`p3-manual-v1`](../p3-manual-v1/BASELINE.md)；生产 shell/token 以当前代码和该手工基线为准。

## 保留工件

- `screenshots/1280x900/calendar--week--light.png`
- `screenshots/1280x900/tasks--all--light.png`
- `screenshots/1280x900/insights--fixture--light.png`
- `screenshots/768x1024/calendar--agenda--light.png`
- `screenshots/768x1024/tasks--all--light.png`
- `screenshots/768x1024/insights--fixture--light.png`

这些截图中的课程、日期、负荷和统计数字仍只是历史 fixture，不是领域规则或正式数据。任何新冻结版本必须从当前 `MANUAL_ONLY` 生产页面建立，不能从 Git 历史恢复被删除 reference 或 surface。
