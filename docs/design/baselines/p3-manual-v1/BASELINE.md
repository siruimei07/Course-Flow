# `p3-manual-v1` Sources 手工路径冻结

冻结日期：2026-08-13。用户本轮明确授权先冻结并实现 P3 `MANUAL_ONLY` 路径；本增量基线继承只读 `ui-v1` 的 token、app shell、按钮、表单、panel 和 motion contract，不建立新视觉方向。

## 冻结范围

- `/sources`：空态、课程筛选、上传中反馈、服务端校验完成、ready 原文详情、安全预览、删除失败/确认和手工录入入口。
- `/tasks?courseId&sourceId`：从 Source 进入既有 Course Item 表单，保留课程上下文；Source 不预填事实。
- `/courses/[courseId]/timeline` 与 `/dashboard`：只有用户提交既有表单后回读正式事项。
- 正常横屏参考 viewport `1280x900`；200% zoom 做内容/键盘/操作保留检查，不作为新像素截图基准。

明确不冻结：任何远程模型凭据、自动解析/审核、助手状态。P4 最终选择 `MANUAL_ONLY` 后，这些未冻结 surface 已从代码和当前设计矩阵删除；本基线只约束 Sources 手工路径。

## 设计合约

- 主操作顺序固定为“添加原文 → 查看原始文件 → 从原文手工录入”；上传成功文案持续说明“没有自动创建正式课程数据”。
- 上传使用显式 label、允许类型/大小说明和持久 `aria-live` 状态；错误保留表单输入并说明恢复动作。
- ready 资料显示课程、类型、文件、页数、内容指纹与版本。非 ready 状态不提供预览，并明确正式数据未变化。
- 手工录入卡只有一个 primary（课程事项）；课节、评分方案是 secondary。链接携带 Source/course 上下文，但既有表单仍由用户填写并提交。
- 删除是破坏性操作，提交前明确确认；成功后撤销预览，失败在控件附近持久展示。
- 状态同时用文字、形状/图标和颜色表达；所有交互目标保持 `ui-v1` 的 44px/focus contract；reduced-motion 不影响完成任务。

## 冻结前联合审计

`ux-heuristics` 评分 **9/10**；severity 4 = 0，severity 3 = 0，severity 2 = 0，severity 1 = 1。`typeui-fundamentals` 按 token → spacing → hierarchy/controls → typography → accessibility 顺序审核。

| 项目 | 结果 | 处理 |
|---|---|---|
| 系统状态 | 通过 | 上传计划、传输、校验、成功、失败均为持久页面状态 |
| 用户控制 | 通过 | 预览新标签页、浏览器返回、删除确认、失败重试与手工路径都保留 |
| 识别而非回忆 | 通过 | Source 旁直接显示三个既有表单入口并固定课程上下文 |
| 错误预防/恢复 | 通过 | client 限类型、server sniff/hash/owner、错误解释原因与下一步 |
| 正式数据边界 | 通过 | 上传/预览/删除零正式 planning 写入；只有既有表单 submit 写入 |
| spacing/hierarchy | 通过 | 继承 `ui-v1` token；label–input 紧、field-group 松，单一 primary |
| typography | 通过 | 标题/元数据/状态三层；长文件名允许换行，不用占位符代替 label |
| keyboard/focus | 通过 | 原生 link/button/input/select；skip link、可见 focus、无 hover-only 信息 |
| 200% zoom | 通过 | Browser 以 `640x450` 检查 200% 等效 CSS viewport：无页面横向溢出，标题、导航、空态和主操作均保留；资料表格只在自身容器滚动 |
| 删除撤销 | pass | metadata 先 fail closed 撤销预览并把 `cleanup_status` 标为 pending；对象删除成功后原子标 complete，失败可由同版本幂等重试继续清理 |
| 外部预览标签页 | severity 1 | 链接文案明确“查看原始文件”；浏览器可关闭返回 |

完成实现后的 Browser 与 canonical E2E 证据见 `VERIFICATION.md`。最终复核没有 severity 2/3/4；本版本保持 frozen。
