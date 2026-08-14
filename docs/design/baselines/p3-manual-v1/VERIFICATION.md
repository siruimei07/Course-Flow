# P3 Manual 验证记录

验证日期：2026-08-14。像素权威仍继承 `ui-v1`；本文件记录真实生产 view model、交互与允许偏差。P4 已把本手工路径确认为唯一发布模式。

| Check | Result | Evidence |
|---|---|---|
| 1280×900 Sources | pass | canonical E2E 在 ready Source 状态生成 [`sources--ready--light.png`](./screenshots/1280x900/sources--ready--light.png)，SHA-256 `F2E22D40EDDB3DD7B7EC863671978EBE193B50E453EFC47F1DB01A1F2ED390BB`；Browser 复核真实 production build 的 shell、Sources 空态、语义层级与主操作 |
| 200% zoom functional retention | pass | Browser `640x450` 等效 viewport：`scrollWidth=clientWidth=640`，标题/导航/主操作可见 |
| keyboard/focus | pass | canonical E2E 以 Tab 聚焦 skip link，并跳到 `#main-content`；Source 预览和手工表单入口可用键盘到达 |
| upload → preview → manual form → Timeline/Dashboard | pass | production canonical E2E 1/1（最终 14.8s）：真实 PDF PUT、预览字节相等、Source context 打开既有事项表单、正式提交后两处回读 |
| owner isolation and delete | pass | PostgreSQL/LocalStack contract：owner/stranger、zero-write upload、preview、manual item、delete、`cleanup_status=pending→complete`、preview 404、正式 item 保留 |
| console/framework overlay | pass | Browser 在成功加载的 production Sources 页面为 0 error/0 warn、无 `nextjs-portal` overlay；1280/640 均无页面横向溢出 |

P4 后补充证明由 `pnpm test:manual-only` 提供：已拒绝路径、组件、表/config 标识在发布面为零，手工 Sources 必需文件保持存在。
