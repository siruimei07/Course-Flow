# ADR-08 恢复激活、回滚与启动恢复设计讨论记录

> 状态：设计与产品取舍已由用户逐项、逐段批准
> 日期：2026-08-21
> 方法：Superpowers brainstorming + Codebase Design / Design It Twice + primary-source research
> 权限：非规范性过程记录；技术结论以 [ADR-08](../../architecture/adr/ADR-08-restore-activation-recovery.md) 为唯一真相
> 后续约束：[ADR-09](../../architecture/adr/ADR-09-no-production-diagnostics.md) 已决定不建设生产诊断/日志/支持包；ADR-08 的 journal/receipt 仍是正式恢复正确性记录。

## 1. 讨论目标

本轮在 ADR-01–07 已接受的边界内决定 `ADR-TOPIC-08`，重点回答：

- 同时替换 SQLite 活动数据与真实 Library 时，用户可依赖的成功/失败边界是什么；
- welcome 恢复与已有工作区恢复是否需要两套模式；
- 恢复前安全恢复集保存什么、保留多久、是否等同于 BackupSet；
- 当前数据损坏、只读、资料库根缺失/不可用和空间不足时是否允许继续；
- 从最终确认到成功期间，普通写入、watcher、backup、preview 与资源 lease 如何隔离；
- 不同卷上无法共享文件系统事务时，如何暂存、激活、继续和回滚；
- 应用启动如何在打开 DATA/Library 前判断未完成激活；
- 新工作区什么时候才真正 succeeded，成功后是否允许一键反悔；
- 如何为未来正式参与恢复的第三类资源留出版本化升级路径，而不预建通用 2PC/DAG/plugin framework。

## 2. 决策前完整审阅

作出设计选择前，已检查干净的 Git 工作树并枚举当时 32 个 tracked entries：31 个 Markdown 文档全部读完，`.gitignore` 核对但不作为需求来源。审阅顺序遵循仓库规范：

1. 产品目标、PRD、MVP 范围与未来 memo；
2. User Flow、UI 页面规格和既有 Superpowers ADR 讨论记录；
3. Architecture、Module Contracts、ADR-01–07；
4. 全部既有 research records；
5. `AGENTS.md` 的所有权/追溯/完成规则；
6. `ATTEMPT.md` 仅作为归档旧实现证据，不继承其需求、技术栈或恢复目标。

审阅的 31 个 Markdown 文档为：

- 根目录：`AGENTS.md`、`ATTEMPT.md`；
- 产品：`PROJECT_BRIEF.md`、`PRD.md`、`MVP_SCOPE.md`、`FUTURE_MEMO.md`；
- 架构：`ARCHITECTURE.md`、`MODULE_CONTRACTS.md`、ADR-01 至 ADR-07；
- 研究：进程部署、Node/SQLite、schema/迁移、Library、资源预览、快照，以及桌面 UI 生态、SQLite/TypeScript/Electron、UTM 成绩规则共 9 份记录；
- Superpowers 设计：产品定义、User Flow、UI 页面规格、ADR-04/05/06/07 共 7 份记录。

重点逐项追溯了：

- Requirement：`A-DATA-001–006`、`A-PLATFORM-001`、`B-FILE-001/012/013`、`STATE-002`、`NFR-001/002/003/006/007/010`、`MVP-DOD-005–008`；
- User/UI：`UF-A-01`、`UF-A-07`、`UI-ENTRY-01`、`UI-DATA-01/02`；
- Module：`MOD-WORKSPACE/PROTECT/DATA/LIBRARY/PLATFORM`，以及只经 Workspace 进入的 `MOD-SHELL`；
- Interface：`IF-WORKSPACE`、`IF-RESTORE-SESSION`、`IF-IMPACT-PREVIEW`、`IF-OPERATION-HANDLE`、`IF-STRUCTURED-PROBLEM`、`IF-DATA-STAGE-ACTIVATE`、`IF-DATA-OPERATION`、`IF-LIBRARY-MANIFEST` 与窄文件系统能力；
- Flow：`FLOW-00/03/04/05`；
- Quality：`Q-TRUTH/PROTECT/ISOLATE/LOCAL/ACCESS/PORTABLE/RESPOND/EVOLVE/CONTINUITY/DIAG`；
- Test：`TEST-PROTECT-004–006`、`TEST-DATA-005/006`、`TEST-WORKSPACE-003–005`、`TEST-LIBRARY-001/002/006`、`TEST-PLATFORM-002/004`、`TEST-FLOW-00/03/05` 与 G4/G6/G7。

一手资料研究位于 [ADR-08 研究记录](../../research/adr-08-restore-activation-recovery-research.md)，覆盖 SQLite WAL/close/checkpoint/Backup、Node copy/sync、libuv Windows rename、POSIX rename、Apple fsync、Windows MoveFileEx/ReplaceFile/FlushFileBuffers 与 TxF 弃用。

## 3. First Principles 边界

讨论先固定七个不可破坏结果：

1. 用户需要的是“重启后仍能确定地得到完整新工作区或完整旧工作区”，不是一句无法证明的“跨文件原子”；
2. 恢复候选、当前 DATA、Library 和备份原件分别有事实所有者；PROTECT 只编排，不越过 owner 直接解释 SQLite 或文件身份；
3. checkpoint 前失败必须保持活动 DATA/Library 不变；checkpoint 后不能打开混合的新旧 pair；
4. 成功必须在新 DATA 重开、Library 全量对账、设备能力失效与 FLOW-00 路由之后；
5. 所有长工作可查询、跨重启、幂等；Shell 和 Main 不解释物理阶段；
6. 当前无通用 resource participant 需求，只需要 `database + optional library`；
7. 完成必须能由每阶段 failpoint、macOS/Windows packaged evidence、容量边界、重启与外部变化判定。

由此把“物理原子性”明确改写为“外部协调下可恢复的逻辑全有或全无”。这是对旧文档中“原子替换”措辞的纠正，不降低数据安全目标。

## 4. Design It Twice 方案比较

### 4.1 方案 A：深 Restore Module（采用）

`MOD-PROTECT` 内部拥有一个深的 Restore Module，对外只暴露：

```text
inspectBeforeWorkspaceOpen()
execute(RestoreCommand)
query(RestoreSessionId)
```

welcome 与设置恢复使用同一 `start → preview → confirm → activate` 语义。Module 根据活动真相自行判断旧数据是否存在、是否需要 RestoreSafetySet、资料库能否原位切换和哪些 recovery actions 合法。

优点：

- Shell、Main、Workspace 不需要理解数据库/WAL、目录交换或 journal phase；
- startup、正常恢复、继续和回滚共用一个事实所有者；
- 命令 union 封闭，当前复杂度与需求匹配；
- 未来 V2 可以显式增加 participant，而不会让 v1 接口提前暴露通用事务框架。

代价是 PROTECT 内部实现较深，但这正是恢复复杂度的真实归属。

### 4.2 方案 B：通用资源 participant / DAG / 2PC（拒绝）

该方案让 DATA、LIBRARY 和未来模块注册 prepare/commit/rollback hook，由通用 coordinator 构造依赖图。

拒绝原因：

- 当前只有 database 与 optional library 两个已知参与者；
- 文件系统没有真正可 prepare/commit 的跨卷事务，通用 2PC 不会创造原子性；
- hook ordering、capability negotiation、版本升级与 partial participant recovery 会扩大公共协议和测试矩阵；
- 它为未确认的 `EXT-*` 预建框架，违反 YAGNI。

未来出现第三类正式活动资源时，应建立 `ActivationPlanV2` 与新 ADR，而不是让未知资源加载到 v1 hook。

### 4.3 方案 C：最小 Workspace 脚本式编排（拒绝）

该方案复用现有 DATA/LIBRARY 端点，让 Workspace 或 Main 按顺序调用 stage/rename/reopen，少建一个内部模块。

拒绝原因：

- startup、正常路径和 recovery 路径会复制阶段解释；
- Shell/Main 容易看到真实路径或物理状态，破坏单一 Workspace Interface；
- crash 后缺少外部事实所有者，DATA 内 journal 又会随 DATA 一起交换；
- “少接口”只是把复杂度泄漏给调用者，并非真正更简单。

## 5. 用户批准的产品取舍

### 5.1 恢复前安全保护

用户批准：

- 使用 RestoreSession 专属的完整本地 `RestoreSafetySetV1`，不是 BackupSet snapshot；
- 至少保留到恢复后第一份常规快照发布并验证成功；
- 未配置备份时作为独立本地恢复点保留，直到用户明确清理；
- succeeded 后不提供 shortcut rollback；回到旧数据必须发起新的完整恢复。

### 5.2 Library 目标

用户批准：

- candidate 含 Library 且当前根健康、其父目录可安全切换时，保持同一用户可见路径；
- candidate 含 Library，但无当前根、根不可用或父目录不能安全切换时，要求经过验证的新建或空本地根；
- candidate 明确 Library absent 时不要求虚构新根，旧根若存在则保持原位但不再活动；
- target/current variant 绑定 preview/confirm；
- activation 不使用跨卷 copy-delete。

### 5.3 损坏/只读当前数据

用户批准受限恢复：

- 如果不能建立完整安全集，但可以保持原始 DB、Library 和恢复协调证据不变，且稳定恢复控制位置可写，可以经独立警告/确认继续；
- 候选仍必须完全独立暂存和验证；
- 不能保护旧证据或控制位置不可写时停止，不以“救援模式”覆盖原始证据。

### 5.4 峰值空间

用户接受普通恢复可能同时占用当前数据、安全集与候选/回滚副本，近似三个完整集合。应用按卷预检；不足时在 checkpoint 前停止，不删除安全集或好快照强行继续。

### 5.5 维护窗口

用户批准最终确认后立即进入 maintenance：

- 停止普通写入、文件操作、backup、validator 和新 preview；
- 既有 lease/epoch 失效；
- watcher 只能留下待重验 hint；
- 长阶段通过 OperationHandle 查询；
- checkpoint 前可取消；
- 外部变化使 preview 过期，不 merge。

### 5.6 启动动作

用户批准：

- pending activation 时启动可自动读取、验证与观察磁盘；
- 只可补记由现有证据唯一证明且不改变 DATA/Library 的 observed/committed 记录；
- 任何仍会改变 DATA/Library 的 continue/rollback 必须停在 recovery 页面等待用户决定。

## 6. 分节批准结果

用户逐节批准了六部分完整设计：

1. 所有权、深模块与三方法接口；
2. candidate validation 与 activation staging 分离的 checkpoint 前状态机；
3. `ActivityControlRoot`、append-only write-ahead journal、同卷 sibling swap 和 DATA commit-last；
4. 重开、success receipt、rollback 与 safety/cleanup 生命周期；
5. 启动矩阵、ProblemCode、journal trust limits 与当前问题最小化；
6. Requirement → MOD → IF → FLOW → Q → TEST 覆盖、未来 V2、拒绝项与重新评审条件。

正式字段、记录顺序、limits 和物理协议只在 ADR-08 中定义，本记录不复制成第二份技术真相。

## 7. 覆盖审阅与补回

全量审阅发现两处旧表述与批准设计冲突：

1. User Flow 把任何“恢复中断”都写成“继续原数据”。这只在 activation checkpoint 前成立；之后必须进入 recovery 并显式 continue/rollback。
2. UI 把恢复写成“原子替换”。跨 DATA 与 Library 没有单一 OS transaction；应写成“可恢复的逻辑全有或全无”。

还缺少以下产品可观察行为：

- RestoreSafetySet 与 BackupSet 不同的保留/清理；
- 健康、无、不可安全原位替换的 Library target；
- 当前 DATA 损坏/只读时的 restricted-waived 门；
- 按卷峰值空间；
- confirm 后 maintenance 与 checkpoint 前取消；
- startup 只自动补记无副作用事实；
- succeeded 的 reopen/reconcile/FLOW-00/receipt/commit 边界；
- success 后 cleanup-pending 与“返回旧数据需新恢复”。

因此按产品 → User Flow/UI → Architecture → Contracts → ADR 的顺序同步，没有让 ADR 静默创造用户行为。

## 8. 正式覆盖结论

| 层级 | 覆盖结论 |
|---|---|
| Requirement | A-DATA-005/006 的验证、显式替换、不 merge 和失败语义被完整细化；A-DATA-001–004、B-FILE-012/013、STATE-002 与相关 NFR/DOD 保持兼容 |
| Module | PROTECT 拥有会话/安全集/协调；WORKSPACE 拥有 mode/epoch/route；DATA、LIBRARY、PLATFORM 只提供各自深能力；无新 top-level MOD |
| Interface | Shell 只经 IF-WORKSPACE；IF-RESTORE-SESSION 保持封闭 command union、opaque refs、OperationHandle 与无副作用 query |
| Flow | FLOW-05 直接覆盖；FLOW-00 先检查恢复；FLOW-03 负责重开后的 Library reconcile；FLOW-04 与安全集生命周期相邻但不混用 |
| Quality | 真相、保护、隔离、本地、可访问、跨平台、响应、演进、连续性与当前问题说明均有明确不变量 |
| Test | 候选/目标/容量/损坏/maintenance/journal/swap/启动/receipt/rollback/cleanup/两平台 failpoint 都有 TEST obligation |

审阅未发现 ADR-08 需要改变 PLAN、ATTEND、GRADE 的事实所有权，也不需要新增账户、云端、AI、实时合并、archive、加密或签名。

## 9. 未来扩展边界

v1 的 `ActivationPlanV1` 是封闭的 `database + optional library`。未来第三类正式活动资源必须：

1. 明确事实所有者和活动身份；
2. 定义 safety closure、target/stage、验证、commit order、rollback 与 startup fingerprint；
3. 说明其与 preview/confirmation/maintenance 的关系；
4. 迁移到新版本 plan/journal/receipt，并保持 v1 可读；
5. 新增 Requirement/FLOW/Q/TEST 与 packaged failpoint；
6. 经新的 ADR 批准。

只有以下条件出现才重开 ADR-08：

- 产品要求自动 merge 或多 active roots；
- 活动真相移到远程/多设备后端；
- 威胁模型加入恶意本地进程/用户；
- 平台无法可靠执行所需 sibling swap 或 non-overwrite journal publication；
- 新的正式资源必须与 DATA/Library 共同激活；
- 成功/回滚/安全集保留产品承诺改变。

当时留给 ADR-09 的诊断导出/保留/隐私细节，已由后续 [ADR-09](../../architecture/adr/ADR-09-no-production-diagnostics.md) 以“不建设该能力”解决；绝对平台位置、bundled runtime、签名、更新与 packaged evidence 仍属于 ADR-10。

## 10. 产物

- 规范性技术决议：[ADR-08](../../architecture/adr/ADR-08-restore-activation-recovery.md)
- 一手资料与时效风险：[ADR-08 研究记录](../../research/adr-08-restore-activation-recovery-research.md)
- 产品行为：[PRD](../../product/PRD.md)、[MVP_SCOPE](../../product/MVP_SCOPE.md)
- 用户行为：[User Flow](./2026-08-17-user-flow-design.md)、[UI 规格](./2026-08-18-courseflow-ui-wireframes-page-spec-design.md)
- 所有权与契约：[Architecture](../../architecture/ARCHITECTURE.md)、[Module Contracts](../../architecture/MODULE_CONTRACTS.md)

本轮当时只批准和记录 ADR-08；不授权实现、implementation plan 或替后续 ADR 作决定。ADR-09 的后续独立决议不改变本记录的历史权限边界。
