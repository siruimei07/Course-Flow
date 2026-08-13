# `p3-manual-v1` route / 状态矩阵

| Mode | Route / surface | Data states | Interaction / recovery | Ownership | Freeze status |
|---|---|---|---|---|---|
| `MANUAL_ONLY` | `/sources` | empty, uploading, ready, rejected, upload error, delete error | filter/search, upload, safe preview, delete, retry | production route + `SourceLibrary` VM/commands | **frozen** |
| `MANUAL_ONLY` | `/tasks?courseId&sourceId` | existing form default/error/success | course preselected; user types; submit existing planning command | production tasks feature | **frozen** |
| `MANUAL_ONLY` | `/courses/[courseId]/timeline` | empty/success/TBA | formal readback only after submit | schedule projection | **frozen** |
| `MANUAL_ONLY` | `/dashboard` | priority/heatmap/conflict projections | formal readback only after submit | schedule projection | **frozen** |
| `AI_ENABLED` | Source extraction / review | idle, preparing, generating, awaiting review, failed, cancelled | retry/config/manual recovery; Candidate never formal by itself | isolated import harness | conditional, **not frozen** |
| `AI_ENABLED` | `AiResultRegion` | idle, generating, completed, cancelled, failed | preserve question; retry/config/manual recovery; draft opens existing form | isolated harness safe VM | conditional, **not frozen** |

`AI_ENABLED` 的矩阵只证明 contract 和可恢复性，不是 production UI 承诺。默认 production web 不包含这些 route 或组件。
