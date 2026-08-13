# P3 Manual 验证记录

验证日期：2026-08-14。像素权威仍继承 `ui-v1`；本文件记录真实生产 view model、交互与允许偏差。`MANUAL_ONLY` 已冻结；`AI_ENABLED` 仍只是隔离的 conditional contract harness。

| Check | Result | Evidence |
|---|---|---|
| 1280×900 Sources | pass | canonical E2E 在 ready Source 状态生成 [`sources--ready--light.png`](./screenshots/1280x900/sources--ready--light.png)，SHA-256 `F2E22D40EDDB3DD7B7EC863671978EBE193B50E453EFC47F1DB01A1F2ED390BB`；Browser 复核真实 production build 的 shell、Sources 空态、语义层级与主操作 |
| 200% zoom functional retention | pass | Browser `640x450` 等效 viewport：`scrollWidth=clientWidth=640`，标题/导航/主操作可见；AI harness 同宽 review reflow 也无溢出 |
| keyboard/focus | pass | canonical E2E 以 Tab 聚焦 skip link，并跳到 `#main-content`；isolated review 以 `Alt+ArrowDown` 与 `e` 到达 Candidate/Evidence |
| upload → preview → manual form → Timeline/Dashboard | pass | production canonical E2E 1/1（最终 14.8s）：真实 PDF PUT、预览字节相等、Source context 打开既有事项表单、正式提交后两处回读 |
| owner isolation and delete | pass | PostgreSQL/LocalStack contract：owner/stranger、zero-write upload、preview、manual item、delete、`cleanup_status=pending→complete`、preview 404、正式 item 保留 |
| console/framework overlay | pass | Browser 在成功加载的 production Sources 页面为 0 error/0 warn、无 `nextjs-portal` overlay；1280/640 均无页面横向溢出 |

补充证明：isolated deterministic fake harness 1/1（2.5s），覆盖 `idle/generating/completed/cancelled/failed`、逐字段置信度/推断说明、重试/配置/手工恢复、reduced-motion；DOM 不包含 raw response id、`output_text`、provider model fixture 或不安全 provider markup。该证明不冻结 AI UI，也不构成 `AI_GO`。
