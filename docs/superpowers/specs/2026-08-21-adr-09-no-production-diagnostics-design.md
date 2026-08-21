# ADR-09 生产环境不建设诊断、日志与支持包设计讨论记录

> 状态：边界已由用户明确批准
> 日期：2026-08-21
> 方法：Superpowers brainstorming + First Principles / YAGNI
> 权限：非规范性过程记录；技术结论以 [ADR-09](../../architecture/adr/ADR-09-no-production-diagnostics.md) 为唯一真相

## 1. 分类与目标

本议题会改变所有模块的错误接口、恢复动作、隐私边界和未来实现许可，因此按 **Architectural** 路径处理。它不是选择某个 logger 的小改动。

用户在原 ADR-09 探讨开始后明确覆盖先前方向：

> 不涉及本地诊断，日志，等内容，开发时需要尽力做到无bug

随后用户确认该边界并要求进入 ADR-10。

## 2. 决策前审阅

本轮沿用 ADR 基线阶段的完整文档审阅：按规范所有权检查了当时仓库 33 份当前 Markdown 文档，覆盖产品目标/PRD/MVP 范围、User Flow/UI、Architecture/Contracts、ADR-01–08、全部 research 与既有 Superpowers 记录，以及 `AGENTS.md`。`ATTEMPT.md` 依仓库规则是归档旧实现，不是当前规范来源，未据其补建日志能力。

重点复核：

- `STATE-001/002` 是否要求用户得到可解释错误与恢复动作；
- `Q-DIAG-01` 是否被误读为必须建设诊断子系统；
- `StructuredProblem.diagnosticRef` 和 `diagnostic` recovery action 的所有出现；
- ADR-03 的 receipt/operation、ADR-05 的 FileOperation、ADR-07 的 manifest/success record、ADR-08 的 activation journal 是否属于正确性状态；
- `NFR-001/002/003/006/010`、`MVP-DOD-005–008` 和 G2/G4/G6 的覆盖是否会因删除诊断能力而破坏；
- UI/User Flow 中是否残留“查看诊断”入口。

结论是：产品从未要求历史诊断、日志查看、崩溃上报、遥测或支持包；真正要求的是当前状态可解释、dataEffect 准确、输入保留和安全恢复。因此可以完整删除诊断产品面，同时保留所有需求。

## 3. First Principles 边界

- 真实用户结果：发生失败时，用户知道发生了什么类别、正式数据是否改变、哪些能力受影响以及现在能做什么。
- 当前范围：本地优先、离线、无账户、无远程支持后端的首版桌面应用。
- 不变量：不能伪成功、不能静默损坏、不能因缺少日志猜测恢复动作、不能删除正确性记录。
- 信任/数据边界：原始 OS/Node/SQLite/文件错误不得成为另一个持久用户数据副本；跨边界只传 typed safe problem。
- 可验证完成：无生产诊断 artifact、入口、网络或依赖；全部失败路径仍给出稳定 problem/dataEffect/action；双平台 packaged gate 可证明。

“零 Bug”不是可证明的产品状态。可执行解释是：设计把缺陷尽量提前转化为类型错误、契约失败、边界测试、failpoint/restart 测试与两平台验收失败，并且不把日志当作缺少正确性的补偿。

## 4. 比较过的方案

### A. 不建设生产诊断能力（采用）

只保留当前 StructuredProblem 和 ADR 已要求的正式正确性状态；开发/CI 仅使用临时输出。最符合用户明确范围，隐私和实现成本最低，也迫使接口承担完整错误语义。

### B. 本地脱敏支持包（拒绝）

保存有限事件，由用户主动导出。即使不上传，仍需事件 schema、redaction、保留、删除、UI、跨版本兼容与敏感字段审计，属于用户明确排除的本地诊断/日志。

### C. opt-in 崩溃报告/遥测（拒绝）

需要 consent、网络、第三方服务、保留和平台 crash 配置，扩大隐私与发布边界，违反本地优先 MVP 和直接决定。

### D. no-op logger facade（拒绝）

它没有当前用户结果，却会留下依赖、调用点、配置和未来兼容接缝。删除测试优先于抽象设计，因此不做 Design It Twice 的模块深化，也不派生诊断接口方案。

## 5. 批准的设计

1. 生产应用无诊断/log/crash/telemetry/support-bundle 模块、接口、存储、页面、设置、后台任务或依赖。
2. `StructuredProblem` 删除 `diagnosticRef`；`details` 由每个 ProblemCode owner 定义成封闭 typed variant，只含驱动用户状态/动作的字段。
3. 原始异常只在 owner 内存中映射一次，随后丢弃；不持久化、不跨普通 DTO、不上传。
4. recovery 不再提供 `diagnostic` 动作。证据允许时显示 resume/rollback；证据不足时保持 recovery，显示当前可证明状态而不执行物理动作。
5. 正确性记录白名单继续存在。它们的字段决定提交、幂等、对账、继续、回滚或清理，不是排障历史；不得追加任意日志字段。
6. 状态详情只展开当前安全字段；不建设历史、导出或支持包。
7. 开发/测试/CI 可临时显示编译、断言、测试和 failpoint 输出，但产品不保存这些输出。
8. 新增 `TEST-PRIVACY-001`，并让 ADR-10 在 packaged macOS/Windows 交付物中验证无主动 crash/telemetry/reporting 与无 app-owned diagnostic artifact。
9. 若未来要增加这些能力，必须先修改产品需求并用替代 ADR 重新决定；当前不留 hook。

## 6. 文档同步范围

规范更新遵循单一语义所有权：

- MVP_SCOPE：新增明确非目标；完成定义不再使用“诊断状态”。
- PRD：恢复动作只含证据允许的继续/回滚；无安全动作时展示当前状态。
- User Flow/UI：删除“查看诊断”动作，以当前状态详情取代。
- Architecture：不新增模块；`Q-DIAG-01` 明确为当前问题可解释；ADR-09 标为已接受。
- Module Contracts：删除 `diagnosticRef`/`diagnostic` action，收紧 typed details，增加无生产诊断能力与测试义务。
- ADR-01–08：将未决 ADR-09 引用同步为本负向决议，保留其正式正确性记录。
- 历史 research/讨论记录：不重写当时研究结论；在相关记录中标注诊断提案已被 ADR-09 后续决议取代。

## 7. 覆盖与扩展审阅

覆盖结果：

- 所有当前 Requirement 仍有 MOD/IF/FLOW/Q/TEST 路径；
- 无诊断子系统不会影响 PLAN 核心、Library、Grade、Backup/Restore 的事实所有权；
- 恢复的 unknown/conflict 仍安全停住，且不会因为没有 diagnostic action 而猜测；
- 隐私、本地、可访问性、跨平台和数据安全边界均未降低；
- 正确性记录与 app-owned diagnostic log 已有可判定区分；
- 未来可通过新 Requirement + 替代 ADR 扩展，但没有当前空实现或兼容负担。

## 8. 权限边界

本轮只记录 ADR-09 并同步规范，不授权实现代码、建立 implementation plan 或新增依赖。用户已明确要求在记录后进入 ADR-10；下一轮从打包/更新模型的首个产品决策开始。
