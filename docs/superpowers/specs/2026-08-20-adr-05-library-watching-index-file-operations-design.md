# ADR-05 资料库监听、索引与文件操作设计讨论记录

> 状态：讨论已由用户逐段确认
> 日期：2026-08-20
> 方法：Superpowers brainstorming + primary-source research + Ponytail dependency check
> 权限：非规范性过程记录；技术结论以 [ADR-05](../../architecture/adr/ADR-05-library-watching-index-file-operations.md) 为唯一真相

## 1. 讨论目标

本轮在 ADR-01–04 已接受的边界内决定 `ADR-TOPIC-05`，重点回答：

- 单一资料库根如何创建、迁移、重新授权和修复身份；
- watcher、完整扫描、索引和磁盘真相如何分工；
- PathKey、FileId、verification stamp 与外部移动证据如何区分；
- Copy/Rename/Move/Delete/Replace、分类批处理与根迁移如何处理崩溃和恢复；
- symlink/reparse、大小写、Unicode、hard link、回收站和平台差异如何收口；
- 软件更新如何继续解释持久 marker、PathKey 和 FileOperation；
- ADR-05 与 ADR-06/07/08/10 的边界在哪里。

## 2. 决策前审阅

作出选择前，已重新枚举并审阅仓库中的根级指令、产品与范围文档、User Flow、UI 规格、Architecture、Module Contracts、ADR-01–04、全部研究材料、Superpowers 可视稿及归档旧尝试。`.superpowers` state 文件只作为工具运行产物核对；`ATTEMPT.md` 只作为归档证据，不继承其实现。

一手资料研究位于 [ADR-05 研究记录](../../research/adr-05-library-watching-index-file-operations-research.md)，覆盖 Node/libuv watcher、Windows overflow、path/realpath/lstat、Unicode、reparse point、platform object evidence、copy/rename/replace/sync、Electron system trash、本地/云位置识别能力边界及 Chokidar 候选。

## 3. 方案比较

讨论比较了三条 watcher/收敛路线：

1. Node core `fs.watch` 只作提示，事件批次触发串行全根扫描，并以启动、手工、异常和五分钟完整核对兜底；
2. Chokidar 归一化事件，但仍保留相同完整扫描与状态机；
3. 不使用 watcher，只依赖周期 polling 扫描。

用户接受第 1 条。Chokidar 不能消除磁盘扫描、containment 或 FileOperation 的任何正确性复杂度；仅 polling 则牺牲正常发现延迟。Ponytail 依赖检查因此选择 Node/Electron 内建能力，不新增 watcher/native 依赖。

## 4. 用户逐项确认

用户依次确认：

1. 正常换根只迁移当前资料库到新建/空根；手工整库搬迁通过 Reauthorize，不采用任意已有目录；
2. 根及受管理树不跟随 symlink、junction/reparse point；
3. 外部移动只有唯一可靠对象证据时自动保留 FileId，否则等待用户确认；
4. 删除只进入系统 Trash/Recycle Bin，失败不永久删除；
5. replace 身份跟随操作源，被替换目标的 CustomTag 不继承；
6. 原生 watcher + 扫描收敛 + 运行期低频完整核对；
7. 布局外普通文件进入索引和备份并标“待归类”；
8. 根迁移验证新根、提交唯一活动根后，把旧根送入回收站；清理失败只留下非活动副本；
9. watcher 事件完全丢失时，根可访问且应用持续运行最迟每五分钟启动完整核对；
10. 默认优先 Documents；已知云/远程位置拒绝，无法排除任意第三方同步时透明说明限制并记录确认；
11. 根使用版本化 marker 证明 LibraryRootId/WorkspaceId；重新授权要求匹配；
12. 当前数据库路径 marker 误删可经只读完整扫描、影响预览和确认修复；不同路径不能使用修复流程；
13. 可行性复核发现 Node core 没有通用 Windows reparse-tag 查询面。用户接受保留无 native 依赖：拒绝 `lstat` 可观察链接、解析后越界和非普通类型；无法分类的范围保持 unverified，不宣称识别全部非链接 reparse tag；
14. 同路径 stamp 变化但缺少可靠对象证据时，采用最保守的用户决策：旧 record 保持 unverified，确认前不转移 FileId、历史或 CustomTag；确认“同一文件”才保留身份，确认“替换文件”则建立新身份。

随后用户逐段确认了：事实所有权与成功边界、根/路径/扫描、文件身份与外部对账、一般文件操作、replace/复合操作、根身份/启动恢复，以及更新兼容/跨 ADR/测试门。

## 5. 审阅中发现并补回的上游行为

讨论发现原产品规范没有明确以下用户可观察行为：

- Documents 被云盘重定向或无法排除第三方同步时的处理；
- watcher 完全丢事件时的五分钟完整核对上限；
- 布局外普通文件的待归类状态；
- 删除的回收站语义与失败时无永久 fallback；
- replace 后 FileId/CustomTag 的归属；
- 手工整库搬迁、根 marker 和当前路径 marker 修复。

这些行为先同步到 PRD、MVP Scope 和 UI 规格，再同步 Architecture、Module Contracts、FLOW-03、Intent、Problem 与 TEST obligation；ADR 只保存满足这些行为的技术选择。

## 6. 产物与后续边界

- 规范性技术决议：[ADR-05](../../architecture/adr/ADR-05-library-watching-index-file-operations.md)
- 一手资料与时效风险：[研究记录](../../research/adr-05-library-watching-index-file-operations-research.md)
- ADR 状态索引：[Architecture §12](../../architecture/ARCHITECTURE.md#12-adr-主题与变更规则)
- 逻辑接口、FLOW 与 TEST：[Module Contracts](../../architecture/MODULE_CONTRACTS.md)

本记录不复制 marker encoding、PathKey binary grammar、扫描算法或 FileOperation 物理步骤，以免形成第二份技术真相。当前没有授权进入实现或编写 implementation plan；下一项仍从 ADR-06 的全仓审阅与逐项确认开始。
