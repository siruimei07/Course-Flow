# `p3-manual-v1` route / 状态矩阵

| Route / surface | Data states | Interaction / recovery | Ownership | Freeze status |
|---|---|---|---|---|
| `/sources` | empty, uploading, ready, rejected, upload error, delete error | filter/search, upload, safe preview, delete, retry | production route + Source VM/commands | **frozen** |
| `/tasks?courseId&sourceId` | existing form default/error/success | course preselected; user types; submit existing planning command | production tasks feature | **frozen** |
| `/courses/[courseId]/timeline` | empty/success/TBA | formal readback only after submit | schedule projection | **frozen** |
| `/dashboard` | priority/heatmap/conflict projections | formal readback only after submit | schedule projection | **frozen** |

P4 已选择 `MANUAL_ONLY`。自动解析、审核与模型结果不属于本基线，也不存在 production route/component。
