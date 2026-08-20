# ADR-04 Schema、迁移与兼容设计讨论记录

> 状态：讨论已由用户逐段确认
> 日期：2026-08-19
> 方法：Superpowers brainstorming + primary-source research
> 权限：非规范性过程记录；技术结论以 [ADR-04](../../architecture/adr/ADR-04-schema-migration-compatibility.md) 为唯一真相

## 1. 讨论目标

本轮在 ADR-01、ADR-02、ADR-03 已接受的边界内，决定 `ADR-TOPIC-04`，重点回答：

- 正式数据如何建模而不混淆未知、缺失、零值、派生值和历史；
- 第一个公开 schema 如何冻结，后续软件更新如何迁移用户数据；
- current、旧、future、损坏、只读和恢复候选如何停止或继续；
- Workspace/IPC 如何表达精确整数、小数、版本与幂等命令；
- 哪些内容必须留给 ADR-05、ADR-07、ADR-08 和 ADR-10。

## 2. 决策前审阅

作出选择前，已重新枚举并审阅仓库中的产品、范围、User Flow、UI、Architecture、Module Contracts、既有 ADR、研究材料、根级指令和归档旧尝试。`.superpowers` 的运行状态文件只作为工具运行产物检查，不作为需求来源；`ATTEMPT.md` 只作为已归档历史证据，不继承其技术栈。

研究证据位于 [ADR-04 一手资料研究](../../research/adr-04-schema-migration-compatibility-research.md)，覆盖 SQLite header/version/STRICT/FK/CHECK/事务迁移、Electron/Node structured clone 与 BigInt、Node core SHA-256、canonical encoding，以及与快照、恢复激活和打包更新 ADR 的边界。

## 3. 方案比较

讨论比较了三组主要方向：

1. 以通用 JSON/EAV 为中心并在应用层解释；
2. 按领域归一化关系表、派生 Occurrence/Projection、连续 forward-only migration；
3. 以 append-only event store 为中心重建当前状态。

第 2 组最直接满足当前单用户、本地唯一真相、事务、精确状态、窗口查询和可测试升级需求；第 1 组削弱约束并制造自建 schema 协议，第 3 组没有当前审计/time-travel/协作需求支撑。

版本记账还比较了仅 `user_version`、`user_version + bootstrap metadata`、再加 per-database migration ledger。最终保留 `user_version` 作为唯一 schema level，并以单例 Workspace metadata 保存业务身份，不增加第二份 migration ledger。

兼容策略比较了 forward-only、双向迁移/双写和长期旧 schema adapter。最终选择逐级 forward-only migration、迁移前安全副本和未知新版停止；这支持软件更新读取并升级旧数据，同时明确不承诺升级后的库可由旧软件继续编辑。

## 4. 逐段确认范围

用户逐段确认了以下设计面，随后确认可以落档：

1. 数据库身份、schema level、正式 v1 冻结与启动模式；
2. 共同 commit/recovery 表族与 Revision 边界；
3. PLAN 的 Term/Course/Holiday、Series/Segment/Occurrence/override/state；
4. ATTEND 的半开有效窗口、即时关闭、跨日开启与同日重开；
5. LIBRARY 的验证索引、目录映射、标签和 typed FileOperation；
6. GRADE 的直接权重事实、精确小数、immutable scale 与 provenance；
7. exact IPC/build handshake、版本化 DTO 与 64 位数值编码；
8. 受限 canonical JSON、SHA-256 与 receipt 生命周期；
9. 初始化、逐级迁移、安全副本、失败续接和降级边界；
10. SQLite 物理类型、STRICT、FK/CHECK/RESTRICT 与索引政策；
11. Draft、Operation、FollowUp、watermark 与正式 Revision 的区分；
12. snapshot/restore staged migration 及 ADR-07/08/10 划界；
13. TEST obligation、packaged 双平台门和重新打开条件。

讨论中发现产品文档对 ATTEND 关闭时刻不够精确。用户确认“关闭在 commit Instant 立即生效；关闭前资格/记录保留；同日重开从实际重开时刻生效；关闭间隙不回填”，因此该行为先更新到 PRD/MVP Scope/User Flow/UI，再同步 Module Contracts 和 ADR。

## 5. 产物与后续边界

- 规范性技术决议：[ADR-04](../../architecture/adr/ADR-04-schema-migration-compatibility.md)
- 一手资料与时效风险：[研究记录](../../research/adr-04-schema-migration-compatibility-research.md)
- ADR 状态索引：[Architecture §12](../../architecture/ARCHITECTURE.md#12-adr-主题与变更规则)
- 逻辑接口与 TEST：[Module Contracts](../../architecture/MODULE_CONTRACTS.md)

本记录不复制 ADR 的 schema catalog、migration 算法或编码规则，以免形成第二份技术真相。下一项 ADR 仍须重新执行相同的边界审阅和逐段确认；当前没有授权进入代码实现。
