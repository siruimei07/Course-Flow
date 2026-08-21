# ADR-09：生产环境不建设诊断、日志与支持包子系统

- 状态：已接受
- 日期：2026-08-21
- 决策主题：`ADR-TOPIC-09`
- 前置决策：[ADR-01](./ADR-01-desktop-runtime-ui-boundary.md)、[ADR-02](./ADR-02-process-thread-deployment.md)、[ADR-03](./ADR-03-sqlite-active-data-transactions.md)、[ADR-04](./ADR-04-schema-migration-compatibility.md)、[ADR-05](./ADR-05-library-watching-index-file-operations.md)、[ADR-06](./ADR-06-resource-preview-system-open.md)、[ADR-07](./ADR-07-snapshot-format-integrity-publication.md)、[ADR-08](./ADR-08-restore-activation-recovery.md)
- 上游规范：[PRD](../../product/PRD.md)、[MVP_SCOPE](../../product/MVP_SCOPE.md)、[User Flow](../../superpowers/specs/2026-08-17-user-flow-design.md)、[UI 规格](../../superpowers/specs/2026-08-18-courseflow-ui-wireframes-page-spec-design.md)、[Architecture](../ARCHITECTURE.md)、[Module Contracts](../MODULE_CONTRACTS.md)
- 讨论记录：[ADR-09 Superpowers 设计讨论](../../superpowers/specs/2026-08-21-adr-09-no-production-diagnostics-design.md)

## 1. 背景

`ADR-TOPIC-09` 原本预留给本地诊断、日志、脱敏、保留和用户导出。用户明确决定 CourseFlow 不涉及这些产品能力，并要求开发过程尽力减少缺陷。

这不是“暂时还没选日志库”，而是一项产品与架构负向决策：首版生产应用不建立诊断数据面、诊断存储、日志管线、崩溃报告收集、遥测或支持包。未来实现不得因为常见桌面应用通常带日志而自行补建。

与此同时，现有需求仍要求错误可理解、数据效果可判定、恢复状态可继续或回滚，且 ADR-03–08 已建立 receipt、Operation、FileOperation、snapshot manifest 与 restore activation journal 等正确性记录。删除诊断能力不能删除这些正式协议，也不能让错误退化为无说明的“出错了”。

本 ADR 因而必须区分：

- 面向用户当前任务的结构化问题与可执行状态；
- 为数据正确性、幂等和恢复所必需的正式记录；
- 被明确排除的诊断、日志、崩溃收集、遥测和支持包；
- 只存在于开发/测试过程、不会随产品交付或留存在用户设备上的临时输出。

本 ADR 不选择诊断技术，所以没有外部技术调研或依赖候选。此前启动的一手资料调研在用户否决该能力后终止；不创建一份假装存在技术选型的 research 文档。

### 1.1 追溯边界

- Requirement：`STATE-001/002`、`NFR-001/002/005/006/010`、`MVP-DOD-005–008`；
- User/UI：`UF-A-01/07`、`UI-ENTRY-01`、`UI-DATA-01/02` 及所有显示失败、降级、未知状态的表面；
- Module：全部现有模块；不新增 `MOD-DIAG` 或同义模块；
- Interface：`IF-WORKSPACE`、`IF-STRUCTURED-PROBLEM`、`IF-OPERATION-HANDLE` 以及 ADR-03–08 已批准的正式正确性记录；不新增日志/诊断/支持包接口；
- Flow：`FLOW-00–06` 的失败语义，重点是 `FLOW-03/04/05`；
- Quality：`Q-TRUTH-01`、`Q-PROTECT-01`、`Q-ISOLATE-01`、`Q-LOCAL-01`、`Q-ACCESS-01`、`Q-PORTABLE-01`、`Q-CONTINUITY-01`、`Q-DIAG-01`；
- Test：`TEST-SHELL-001/003/004`、`TEST-WORKSPACE-003–006`、`TEST-LIBRARY-002/006/007`、`TEST-PROTECT-002–006`、`TEST-DATA-001–006`、`TEST-PLATFORM-003/004`、`TEST-PRIVACY-001` 与所有相关 failpoint。

`Q-DIAG-01` 是已发布的稳定架构 ID，本 ADR 保留该 ID，但把它的规范含义限定为“当前状态可解释且可操作”，不表示存在 diagnostic subsystem。

## 2. 决议摘要

CourseFlow v1 采用**无生产诊断子系统 + 结构化当前问题 + 正确性记录白名单 + 开发时验证门禁**：

1. 不新增生产诊断、日志、崩溃报告、遥测、分析或支持包模块、服务、接口、页面、设置、存储、后台任务或依赖。
2. CourseFlow 自有生产代码不创建或轮转 app-owned log 文件，不建立事件历史、trace、span、breadcrumb、metric 或 crash dump/report 存储。
3. 应用不收集、读取、管理、导出或上传崩溃报告/转储，也不主动启用相关运行时收集能力。操作系统或运行时在 CourseFlow 控制外产生的记录不成为 CourseFlow 产品数据；ADR-10 必须验证打包配置没有主动开启收集路径。
4. 应用不进行遥测、分析、错误上报或静默网络传输，也不提供 opt-in 开关或预留 hook。
5. 不提供“查看诊断”、日志查看器、诊断导出、支持包生成、复制 debug info 或类似产品动作。
6. `StructuredProblem` 继续作为当前请求、能力或恢复状态的唯一公共错误语义；它必须给出稳定 code、scope、dataEffect、affectedCapabilities、允许动作和最小 typed details。
7. `StructuredProblem` 不含 `diagnosticRef`、stack、原始异常、任意字符串 map、SQL、真实路径、文件内容、课程/成绩/标签数据或秘密。Shell 不展示或索取底层错误转储。
8. OS/Node/SQLite/解析器错误只在其事实所有者内存中短暂用于映射稳定 ProblemCode 与当前 dataEffect；映射完成即丢弃，不写入持久状态、普通 DTO 或上传通道。
9. Problem 可以随当前 `OperationHandle` 或正式恢复状态持久存在，但只能保存其安全的规范字段，生命周期由该正式状态的 owner 决定；不得额外形成问题历史。
10. CommandReceipt、Operation/DurableFollowUp、FileOperation、snapshot manifest、backup/restore receipt、RestoreSession、ActivationPlan/journal 等继续存在，因为它们决定幂等、事实提交、恢复与清理资格。它们是正式正确性协议，不是诊断日志。
11. 正确性记录只保存其 ADR/契约明确要求的封闭字段；不得附加 message、stack、rawError、path dump、breadcrumb 或“以防以后排查”的扩展 map。
12. 开发、测试和 CI 可以把编译错误、测试失败、断言和故障注入结果临时输出到开发者终端或 CI 界面；这些输出不打包进应用、不由应用保存、不构成用户数据或产品能力。
13. 生产应用代码不依赖 `console.*` 或 logger 获得正确性。开发工具是否显示第三方运行时的临时 stderr 不改变本决议，但 CourseFlow 不捕获或落盘它。
14. “尽力做到无 Bug”落实为可验证工程门禁，而不是无法证明的零缺陷承诺：静态类型/依赖守卫、契约测试、边界/性质测试、失败路径、failpoint/重启、双平台 packaged E2E 和最终差异审阅。
15. 未知或不能安全分类的状态不得猜测、自动修复或伪成功；Shell 显示当前能证明的状态和空的或受限的 allowed actions。没有安全动作时，保持当前 recovery 状态并明确说明原因。
16. 未来若产品确实需要日志、崩溃收集、遥测或支持包，必须先新增明确产品 Requirement、隐私/保留/用户控制/平台行为与测试，再由新 ADR 替代本决议；不得预建未启用实现。

## 3. 明确不建设的生产能力

### 3.1 禁止的所有权与接口

不得建立：

- `MOD-DIAG`、`MOD-LOG`、`MOD-TELEMETRY`、support service 或同义模块；
- `IF-DIAGNOSTICS`、`IF-LOG-SINK`、`IF-CRASH-REPORT`、`IF-SUPPORT-BUNDLE` 或通用事件上报接口；
- 诊断数据库表、JSONL/text log、rotating file、trace store、crash directory 或用户可配置保留期；
- 日志级别、采样率、debug mode、诊断 consent、上传 endpoint 或环境开关；
- 诊断面板、导出入口、支持包、自动附加系统信息或一键复制调试资料；
- 为未来这些能力保留的 provider、adapter、hook、feature flag、空页面或空目录。

模块应直接返回其拥有的 typed outcome/problem。Workspace 聚合 capability/health，Shell 映射可访问文案；中间不经过另一个诊断层。

### 3.2 网络边界

错误、失败、崩溃、性能和使用行为都不得触发网络请求。生产依赖也不得以默认行为发送这些信息。ADR-10 的 dependency/configuration/package audit 必须证明交付物中没有 CourseFlow 主动启用的 telemetry、crash upload 或 error-report endpoint。

这不改变用户明确选择的本地文件操作、系统打开或未来另行批准的网络功能；当前 MVP 核心仍按 `NFR-001` 禁网运行。

## 4. 当前问题契约

### 4.1 `StructuredProblem`

规范形态为：

```text
StructuredProblem {
  code: ProblemCode
  scope: field | operation | module | workspace
  dataEffect: unchanged | committed(Revision) | disk-applied | activation-pending
  affectedCapabilities: [CapabilityName]
  allowedActions: [ProblemAction]
  context: { revision?, entityVersions?, operationId? }
  details: ProblemDetailsByCode
}
```

`ProblemAction` 是公共协议版本拥有的封闭 token，`allowedActions` 允许为空；Shell 不得自行添加动作。`ProblemDetailsByCode` 必须是由 ProblemCode owner 定义的封闭、版本化或兼容演进的 typed variant。每个字段都必须改变用户文案、允许动作或状态判定；仅供日后排查的字段不得进入。

Shell 可以把未知 ProblemCode 映射为安全通用文案，但仍必须显示已有的 dataEffect、受影响能力和 owner 给出的 allowed actions。Shell 不得要求底层原始错误，也不得把未知状态转成 retry、resume 或 rollback。

### 4.2 生命周期

- 普通请求的 Problem 随当前请求/投影生命周期结束，不形成历史列表。
- 若 Problem 属于持久 Operation、FileOperation、RestoreSession 或其他正式状态，它可以随该状态保存，以保证重启后仍能呈现当前真实阶段。
- 状态推进后，只保留新状态规范要求的字段；不得把旧 Problem 追加成事件历史。
- Product/UI 中的“状态详情”只是当前 `StructuredProblem`/Operation 状态的可访问展开，不是诊断视图。

### 4.3 原始错误映射

每个 owner adapter 在信任边界完成一次映射：

```text
platform/runtime error
  -> owner observes actual phase and data effect
  -> stable ProblemCode + typed safe details + allowed actions
  -> raw error discarded
```

若 owner 不能证明 dataEffect 或安全动作，必须返回明确 unknown/activation-pending/recovery-required 变体并保持能力关闭，不能因缺少日志而猜测成功或自动重试。

## 5. 正确性记录不是诊断日志

| 正式记录 | 唯一用途 | 必须保留的边界 | 禁止扩展 |
|---|---|---|---|
| CommandReceipt / Revision | 幂等提交和事实版本 | ADR-03/04 指定的 command digest、outcome、revision | 任意异常文本、stack、请求内容转储 |
| Operation / DurableFollowUp | 长操作与提交后动作重启恢复 | owner 状态机、phase、dataEffect、decision | breadcrumb、debug message、调用轨迹 |
| FileOperation / reconciliation state | 判断磁盘已应用还是索引已提交 | ADR-05 的 typed state、FileId/RootGeneration/证据 | 原始 OS 错误、目录转储 |
| Snapshot manifest / success record | 验证快照闭包、身份、发布与保留 | ADR-07 canonical manifest、digest、sequence | 运行日志、用户内容样本 |
| RestoreSession / ActivationPlan / activation journal / receipts | 启动前分类、继续/回滚、成功边界 | ADR-08 的 canonical typed records、fingerprint 与 hash chain | message、stack、任意 key、诊断附件 |

这些记录可能包含 `createdAt`、phase、code、计数、摘要或平台事实，因为后续动作依赖它们。字段是否合法只看其所有者 ADR/契约是否要求以及它是否改变恢复/正确性动作，不能以“看起来像日志”为由删除，也不能以“有助排查”为由扩张。

## 6. 用户体验与可访问性

- 所有失败、降级、unknown 和 recovery 状态用文字说明原因类别、dataEffect、影响能力与下一步；不能只靠颜色、图标、hover 或动画。
- 页面可以展开“当前状态详情”，但仅展示当前 Problem/Operation 的安全规范字段；没有历史时间线、原始错误、文件路径转储或导出。
- recovery 页只显示证据当前允许的 `resume`、`rollback` 或其他封闭动作。若没有安全物理动作，则显示原因并保持 recovery；不存在独立 `diagnostic` action。
- 用户输入在 not-committed/failed 状态按既有契约保留；没有日志不降低草稿、恢复或 dataEffect 说明要求。
- 清理待完成、备份失败和外围模块降级继续保持局部状态，不因无法导出诊断而扩大到全局失败。

## 7. 开发质量与验证门禁

零缺陷无法作为可判定交付条件。CourseFlow 把“尽力做到无 Bug”转换为以下可审计证据：

1. 编译与静态检查阻止跨模块越界、未处理 discriminated union、生产 logger/telemetry/crash-collector 依赖和被禁 API/configuration。
2. 每个 Requirement 仍按 `Requirement → MOD → IF → FLOW → Q → TEST` 追溯；不能以日志补偿缺少测试或不明确契约。
3. 时间、规则、未知状态、成绩等纯逻辑使用边界/性质测试；持久化、文件、备份和恢复覆盖每个可达失败阶段。
4. CommandId、revision、receipt、operation 和 restore 状态覆盖重复请求、响应丢失、进程终止与重启。
5. 所有失败断言同时验证 ProblemCode、dataEffect、affectedCapabilities、allowed actions、输入保留和“不得伪成功”。
6. `TEST-PRIVACY-001` 在开发构建与 macOS/Windows packaged build 中证明：CourseFlow 不创建 app-owned 诊断/log/crash/telemetry artifact，不提供诊断导出入口，不因错误发起网络请求；当前错误仍能通过 StructuredProblem 完整呈现。
7. `G6` 在两个目标平台以真实权限、禁网和 packaged runtime 执行；无法在某平台验证时必须报告未验证，不推断通过。
8. 完成前运行目标测试、扩大到受影响回归、检查最终 diff/status，并只报告实际证据。

开发者终端、测试 runner 与 CI 的临时输出用于立即修复失败，不成为应用功能，也不允许替代上述自动化断言。

## 8. 备选方案

### 8.1 采用本决议：不建设生产诊断能力

优点：完全符合用户范围；减少隐私面、持久数据、UI、依赖、打包和跨平台生命周期；迫使正确性通过 typed contracts 与测试证明。

代价：发布后不能要求用户导出支持包；现场问题只能由可重现步骤、当前安全错误信息和开发侧复现处理。该代价由用户明确接受。

### 8.2 本地脱敏支持包

方案原拟保存有限事件并由用户显式导出。它仍需要 schema、保留、redaction、路径/内容审计、UI、跨版本读取和测试，并可能让敏感信息进入持久文件。用户已明确拒绝。

### 8.3 opt-in 丰富日志、崩溃转储或遥测

这会引入 consent、网络、身份、保留、安全、平台 crash facility、第三方服务和支持流程，明显超出本地优先 MVP，也违反本轮直接决定。拒绝。

### 8.4 预留 logger facade 但默认 no-op

即使 no-op，也会预建接口、调用点、配置和未来兼容负担，并使业务代码依赖一个没有当前用户结果的横切层。违反 YAGNI；拒绝。

## 9. 后果与未来扩展

### 9.1 正向后果

- 没有新的 top-level module、数据格式、保留策略、页面、后台任务或依赖；
- 生产隐私边界简单：错误不会形成另一个用户数据副本；
- 模块错误契约必须足以驱动真实 UI/恢复动作，不能把语义推给日志；
- 正确性记录仍能在重启后确定性恢复，不因“无日志”被误删。

### 9.2 约束与成本

- 用户和支持人员不能查看/导出历史错误；
- 无法重现的问题不能依靠已保存日志事后追查；
- 实现必须在开发阶段投入更强的自动化测试、failpoint 和双平台验证；
- 第三方依赖升级必须持续审查默认 telemetry/crash/reporting 行为。

### 9.3 重新评审条件

只有以下任一条件成立，才可用新 ADR 替代本决议：

- 产品新增明确的支持包、崩溃报告、遥测或合规审计 Requirement；
- 已发布产品出现无法通过可复现测试和当前 StructuredProblem 处理、且用户明确接受新增隐私/存储成本的问题类别；
- 目标发布渠道强制要求特定崩溃收集或运行记录，并且产品决定接受；
- 法律、安全或组织支持流程产生新的可验证保留/导出义务。

新决议必须重新定义用户控制、默认值、数据分类、最小字段、保留/删除、加密/访问、离线行为、跨平台差异、依赖、导出/上传和 TEST，不得复用本 ADR 未建立的空接缝。

## 10. 覆盖审阅结论

作出本决议前，已按语义所有权审阅当时仓库 33 份当前 Markdown 文档；`ATTEMPT.md` 按仓库规则作为归档旧实现而排除，不作为当前需求或技术来源。审阅结果：

- `STATE-001/002` 仍由 StructuredProblem、Operation 与 recovery 当前状态完整覆盖；
- `NFR-001` 的离线/无远程依赖因不建设上报而加强；
- `NFR-002/003` 的数据安全与恢复不变量由正式正确性记录保持，不依赖日志；
- `NFR-005/006` 的显式状态与无障碍文案没有因删除诊断动作而退化；
- `NFR-010` 的模块降级继续通过 capability/health/problem 表达；
- ADR-03–08 的 transaction receipt、operation、snapshot 和 restore journal 均被判定为正确性协议并保留；
- 所有公共 `diagnosticRef` 和独立 `diagnostic` action 已从现行契约移除；
- `Q-DIAG-01` 保留稳定 ID，但唯一含义是当前状态可解释、dataEffect 明确且下一步可执行；
- 未来扩展只保留“通过新产品 Requirement + 替代 ADR 重新决策”的演进规则，不预建代码接缝。

本决议无需新增功能 Requirement 或 top-level Module；MVP_SCOPE 仅新增明确非目标，避免实现时重新引入被拒能力。

## 11. 实现边界

- 本 ADR 批准技术与产品负向边界，不授权开始应用实现、implementation plan 或新增依赖。
- ADR-10 必须把禁用主动 crash/telemetry/reporting、无诊断 artifact 和 packaged `TEST-PRIVACY-001` 纳入打包发布证据。
- 当前唯一仍待决定的初始跨切面主题是 `ADR-TOPIC-10`：运行时版本基线、平台路径、打包、签名、公证、安装、更新与发布。
