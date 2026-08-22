# CourseFlow 首个公开版本实施 Roadmap 设计规格

> 状态：已批准
> 日期：2026-08-21
> 目标版本：CourseFlow 首个公开版本
> 方法：Superpowers brainstorming + writing-for-agents

## 1. 分类与目标

本轮属于架构级实施规划，不开始产品代码实现。目标是把现有产品、交互、逻辑架构、模块契约和 ADR 基线转换为一条可由 Agent 持续执行、逐包验证和可靠交接的实施 Roadmap。

用户确认首个公开版本必须满足整个 PRD 与 MVP，但明确排除 C1 和 C2。因此本规格需要同时解决四件事：

1. 锁定首发范围及不进入首发的能力；
2. 选择能尽早形成真实可运行闭环的里程碑顺序；
3. 定义 Agent 可执行的工作包、上下文、验证和提交协议；
4. 定义 Roadmap、Backlog 与即时细化实施计划的语义所有权。

Roadmap 只拥有实施顺序、依赖和放行条件。产品行为、架构边界、模块契约和技术选择仍由各自上游规范拥有，不在 Roadmap 中复制近似定义。

## 2. 形成设计前的仓库审阅

设计前完成了以下审阅：

- 阅读仓库当时全部 40 个非 Git 文件，包括 39 份 Markdown；
- 复核 `PROJECT_BRIEF.md`、`PRD.md`、`MVP_SCOPE.md`、User Flow、UI 规格、Architecture、Module Contracts、ADR-01–10 及 research；
- 只把 `ATTEMPT.md` 作为归档证据阅读，未从中继承需求、架构、技术栈或实现；
- 检查现有本地 Markdown 链接，未发现缺失目标；
- 核对 75 项当前功能 Requirement 的 Architecture/Contracts 追溯，未发现缺失或多余映射；
- 核对 9 个 `MOD-*`、8 个 `FLOW-*`、16 个 `Q-*`、G1–G8、10 条 User Flow 和 24 个已设计 UI 表面；
- 识别出唯一已知的产品数值缺口 `GAP-PRODUCT-01`：`A-VIEW-004/005` 没有定义 `near-due` 的阈值和边界；
- 识别出 User Flow、Architecture 与 Module Contracts 中若干已经过期的“待审阅/候选”状态；
- 确认当前 Git 工作树在规划开始时干净，既有分支提交属于用户，不在本轮改写或合并。

这些结果是规划证据，不改变语义所有权。R0 负责把已批准的产品决定同步回正式上游文档。

本规格使用以下规范来源：

| 语义 | 规范来源 |
|---|---|
| 产品目标与总边界 | [PROJECT_BRIEF](../../product/PROJECT_BRIEF.md) |
| Requirement 与验收 | [PRD](../../product/PRD.md) |
| MVP 分层、NFR 与 DOD | [MVP_SCOPE](../../product/MVP_SCOPE.md) |
| 用户路径 | [User Flow](2026-08-17-user-flow-design.md) |
| 页面和交互 | [UI 规格](2026-08-18-courseflow-ui-wireframes-page-spec-design.md) |
| 模块、依赖、FLOW、Q 与 Gate | [Architecture](../../architecture/ARCHITECTURE.md) |
| 接口、Problem、TEST 与追溯 | [Module Contracts](../../architecture/MODULE_CONTRACTS.md) |
| 技术选择 | [ADR-01](../../architecture/adr/ADR-01-desktop-runtime-ui-boundary.md)、[ADR-02](../../architecture/adr/ADR-02-process-thread-deployment.md)、[ADR-03](../../architecture/adr/ADR-03-sqlite-active-data-transactions.md)、[ADR-04](../../architecture/adr/ADR-04-schema-migration-compatibility.md)、[ADR-05](../../architecture/adr/ADR-05-library-watching-index-file-operations.md)、[ADR-06](../../architecture/adr/ADR-06-resource-preview-system-open.md)、[ADR-07](../../architecture/adr/ADR-07-snapshot-format-integrity-publication.md)、[ADR-08](../../architecture/adr/ADR-08-restore-activation-recovery.md)、[ADR-09](../../architecture/adr/ADR-09-no-production-diagnostics.md)、[ADR-10](../../architecture/adr/ADR-10-packaging-signing-update.md) |

## 3. First Principles 边界

### 3.1 真实用户结果

首发用户必须能够在 macOS arm64 或 Windows x64 上安装 CourseFlow，在无需账户和网络的情况下：

- 建立学期、课程、多条 LEC/TUT/PRA 课节、假期和任务；
- 在 Today、Week、Calendar、Tasks 等一致视图中管理学习计划；
- 可选地启用并使用手工出席记录；
- 管理一个真实的本地文件资料库，包括导入、整理、预览和系统打开；
- 在关闭、重启、失败、备份、恢复、升级和精确版本回退后得到契约规定的真实状态；
- 通过外部 GitHub Releases 手工取得完整、签名的平台制品。

### 3.2 不变量

- Renderer/Shell 只通过 `IF-WORKSPACE` 工作，不绕过 Workspace 访问领域、数据或平台能力。
- `MOD-PLAN` 不依赖 ATTEND、LIBRARY、GRADE 或 PROTECT。
- 正式结构化数据与真实资料库文件是本地真相；备份目录不是活动数据位置。
- 稳定 ID、未知状态、事实提交边界、离线能力、键盘可达性和跨平台契约不得因实施切片而弱化。
- 外围能力失败不得伪装为空数据，也不得阻塞无依赖的 MVP-A 核心能力。
- 任何备份、恢复、文件操作或更新成功都必须越过其正式契约定义的成功边界。
- 路线中的中间能力可以尚未构成完整产品 Requirement，但不得提前把 Requirement 标为完成。

### 3.3 可验证完成条件

首个公开版本只有在以下条件全部成立时完成：

- 首发 61 项功能 Requirement 均有唯一主要 WorkPacket、适用 `TEST-*` 和通过证据；
- 19 个首发 UI 表面均只使用 `IF-WORKSPACE`，不存在 Grade 入口或占位表面；
- G1–G8 全部可判定并通过；
- macOS arm64 DMG 与 Windows x64 MSI 均在原生目标平台完成签名、安装、离线启动和适用核心 E2E；
- 备份与恢复闭包同时包含正式结构化数据、资料库根身份、全部必需文件及映射；
- 没有把未运行、未验证、部分成功或预计可行报告为通过。

## 4. 首个公开版本范围

### 4.1 纳入范围

| 层级 | Requirement | 数量 | 首发结果 |
|---|---|---:|---|
| MVP-A 核心 | `A-TERM-001–005`、`A-COURSE-001–007`、`A-TASK-001–010`、`A-VIEW-001–006`、`A-CALENDAR-001–003`、`A-DATA-001–007`、`A-PLATFORM-001–004` | 42 | 完整学习计划、本地数据保护与双平台能力 |
| MVP-A-P | `A-ATTEND-001–006` | 6 | 默认关闭、可切换且与核心隔离的手工出席记录 |
| MVP-B | `B-FILE-001–013` | 13 | 单一本地资料库、文件操作、预览、系统打开及完整保护 |
| 合计 | — | 61 | 首个公开版本的功能验收范围 |

首发主导航固定为：

1. Today
2. Courses
3. Calendar
4. Tasks
5. Files

Settings、初始化、维护、恢复和错误表面按现有 UI 规范进入相应流程，但不增加第六个领域主导航入口。

### 4.2 明确排除

- C1：`C-GRADE-001–014`
- C2：`C-TARGET-001–007`
- `EXT-*`、C3、账号、云后端、实时同步、AI、自动更新、后台通知和商店分发

C1/C2 可以继续保留在产品和架构规范中，但首发不创建：

- `MOD-GRADE` 生产实现；
- Grade schema、迁移、种子数据或测试夹具；
- Grade 导航、页面、禁用入口、空状态或 feature flag；
- 为 C2 预留的目标、工作量、关系图或兼容层。

首发公开 schema 只包含实际交付模块。首发 UI 表面数为现有 24 个表面减去 5 个 Grade 表面，即 19 个。R0 必须同步修正当前把全部 24 个表面作为实现前提的契约/测试描述，使其能准确表达首发范围，而不删除 C1 的未来设计。

## 5. Roadmap 总体策略

### 5.1 比较过的方案

#### A. 纵向能力列车（采用）

从真实打包环境和第一条持久化用户闭环开始，依次扩展计划、数据保护、出席、资料库和发行。每站形成可运行、可重启、可验证的能力。

采用原因：

- 最早暴露 Electron、utility process、SQLite 和打包环境中的真实集成风险；
- 每个阶段都有用户可观察结果或可验证的恢复能力；
- 符合仓库要求的最小端到端纵向切片；
- 适合 Agent 按 WorkPacket 连续实现和交接。

#### B. 技术风险优先

先完成存储、恢复、文件协议和发布基础，再接 UI。该方案有利于集中消除高风险协议，但会长期缺少真实用户闭环，容易让接口在没有调用者时过度设计，因此不作为主线。其风险项被嵌入纵向列车的早期检查和故障测试。

#### C. UI 优先

先完成全部页面和交互，再接真实模块。该方案能快速形成视觉结果，但容易产生模拟数据、重复领域公式和 Renderer 绕过 Workspace，因此拒绝。

### 5.2 主依赖链

`R0 → R1 → R2 → R3 → R4 → R5 → R6 → G-A → R7 → R8 → R9 → R10 → R11 → R12`

`G-A` 是 MVP-A 内部稳定检查点，不替代 Architecture 定义的 G1–G8，也不构成公开发布。

### 5.3 里程碑

| 里程碑 | 可观察结果 | 主要实施/验证边界 |
|---|---|---|
| R0 规范可实现 | 首发范围、导航、`near-due`、文档状态和发布资源均可判定 | 产品/架构/契约/UI 同步；首发 trace profile；G1；不写产品代码 |
| R1 Packaged Walking Skeleton | 两平台目标包可离线启动，Main 监督单一 Workspace utility，Renderer 只见 Workspace | `MOD-SHELL/WORKSPACE/DATA/PLATFORM`、`FLOW-00`、稳定数据根、single instance、真实 `node:sqlite` 打包加载、同一 `appBuildId` |
| R2 第一条真实保存闭环 | 新用户创建学期、课程和首条课节；重启后 Today/Course 仍显示同一事实 | 首次设置、Intent/receipt/revision、输入错误、重启确定性；`A-TERM-001/002` 与适用 `A-COURSE-*` 的最小闭环 |
| R3 课程与课表规则 | 多条 LEC/TUT/PRA、教学范围、假期和本次/未来变更在各视图一致 | PLAN 时间、DST、OccurrenceId、规则分段、冲突和 `FLOW-02` |
| R4 任务与统一计划视图 | 一次性/重复/TBA 任务、倒计时、Today/Week/Calendar/Agenda、完成/跳过/恢复形成完整核心体验 | 全部适用 TASK/VIEW/CALENDAR、`UF-A-02/03/05/06/08`、一致性与可访问性 |
| R5 结构化数据保护内核 | 本地提交后可异步生成不可变、验证过的结构化数据快照，失败保留本地成功和旧快照 | BackupSet、水位线、不可变目录、保留、`FLOW-04`、DATA/PROTECT failpoint；不提前提供 `A-DATA-004` 的最终首发证据 |
| R6 恢复、迁移与回退内核 | 可验证候选、影响预览、维护/恢复路由、前向迁移安全副本和精确版本 handoff 可中断恢复 | `FLOW-05/07`、错误 build、各阶段 failpoint、启动判定；涉及资料库闭包的最终首发证据保持未完成 |
| G-A MVP-A 内部稳定门 | 在尚未交付 Library 的 A-only profile 下，42 项 MVP-A 的适用行为在真实打包环境形成完整内部候选 | A-only profile 的 G1–G7；`A-DATA-004/005/007` 证据具有 profile 限定，必须在 R11/R12 被包含 Library 的证据取代 |
| R7 出席记录 | 用户可启用/关闭、标记、更正并查看真实覆盖率和出席率 | `A-ATTEND-001–006`、`FLOW-06`、`TEST-ATTEND-001–004`、G5 隔离 |
| R8 资料库根与磁盘对账 | 选择一个真实本地根，外部变化、watcher 丢失和重启后可全量收敛 | `B-FILE-001–003`、`B-FILE-005–008`、`B-FILE-013`；Root/FileId/PathKey、扫描、映射、五分钟上限、权限/Unicode/link/降级 |
| R9 可恢复文件操作 | 导入、移动、重命名、替换和回收站操作具有明确冲突决策和重启收敛 | `B-FILE-004/009/011`、文件 operation phases、响应丢失和幂等 |
| R10 预览与系统打开 | PDF、图片、文本在受验证资源通道中预览；普通文件系统打开；高风险文件只揭示 | `B-FILE-010` 为主要归属，并重跑 `B-FILE-009` 的系统打开条款；lease、私有 MessagePort、PDF.js、资源限制、无网络与平台失败 |
| R11 完整数据保护 | 快照和整库恢复覆盖结构化数据、根身份、全部已验证资料及映射 | 完整关闭 `A-DATA-004/005`、`B-FILE-012` 及其他依赖 Library 对账的恢复/回退验收；G4/G5 |
| R12 双平台公开发布 | 同一版本的签名 DMG/MSI 可安装、升级、离线运行和按精确版本回退 | `A-PLATFORM-004`、`NFR-012`、`MVP-DOD-009`、全部 61 Requirement、G1–G8 |

R5 和 R6 是完整保护协议的早期纵向内核。G-A 可以证明尚未交付 Library 时的 A-only 产品 profile，但它不是对首发范围的提前豁免。R11 才能在真实 Library 存在后证明快照闭包、整库恢复和回退后全量对账；R12 再以最终平台制品复核。

### 5.4 跨切面规则

- 每个含平台敏感行为的里程碑都更新 Windows/macOS 原生或打包证据，不把所有风险推迟到 R12。
- Roadmap 区分代码硬依赖和发布证据依赖。某平台资源缺失时，无关 WP 可以继续，但对应验证 WP、里程碑 Gate 和 G8 保持未完成。
- R11 冻结首个公开 schema level、快照格式和发布 fixture。此前只允许丢弃尚未公开、明确属于开发/测试的内部数据，并可修正初始 schema；冻结后严格执行 ADR-04 的前向迁移和兼容规则。
- 任何已经承载用户数据或无法证明为可丢弃的数据始终按已发布数据处理，不适用上述内部修正规则。

## 6. `GAP-PRODUCT-01` 的批准结论

### 6.1 单一分类规则

对 pending、未 skipped 且 Deadline 已知的 TaskOccurrence，使用 `ProjectionEnvelope.evaluatedAt`、`termZone` 与 `applicableDate` 分类：

1. completed、skipped 和 TBA 保持各自状态；
2. timed Deadline 在截止 Instant 之后为 `overdue`；
3. date-only Deadline 在 TermZone 截止 LocalDate 结束之后为 `overdue`；
4. 尚未逾期且截止 LocalDate 等于 `applicableDate` 时为 `today`；
5. 截止 LocalDate 位于 `[applicableDate + 1 日, applicableDate + 7 日]` 时为 `near-due`，两端包含；
6. 更晚的已知截止日期为 `future`。

首个公开版本不提供阈值配置。该规则由 `MOD-PLAN` 单点拥有，Today、Week、Calendar、Agenda 和倒计时只消费同一投影。日期边界变化触发重新求值，不产生领域写入。

### 6.2 边界示例

若学期日期为 2026-08-21：

- 2026-08-21 的未逾期 Deadline：`today`
- 2026-08-22 至 2026-08-28：`near-due`
- 2026-08-29 及以后：`future`
- 2026-08-21 当天已经越过真实截止 Instant 的 timed Deadline：`overdue`

R0 必须先把此结论写入 `PRD.md`，再将 Module Contracts 中的缺口标记为已解决并补充 exact-boundary、DST、date-only、timed、TBA、completed 和 skipped 测试。

## 7. Agent WorkPacket 设计

### 7.1 粒度

每个里程碑拆成可独立验证的纵向 WorkPacket（WP）。默认闭环为：

`用户入口 → IF-WORKSPACE → 语义所属模块 → DATA/PLATFORM 边界 → UI 结果 → 失败与重启证据`

- 一个 WP 只负责一个明确用户结果或架构能力。
- 按目标 `TEST-*` 能否独立验证划分，不按文件数或主观完成百分比划分。
- 基础设施 WP 必须直接支撑紧随其后的产品闭环并拥有独立测试。
- 跨模块 WP 保持单一语义所有者，不借机改变模块边界。
- C1/C2 不产生 WP、占位代码、schema 或入口。

### 7.2 必填字段

每个 WP 沿用 `MODULE_CONTRACTS.md §12.2`，并提供 Agent 执行信息：

- WP ID、所属里程碑和硬前置/证据前置；
- 精确 `Requirement / MOD / IF / FLOW / Q / Gate / TEST`；
- 用户可观察结果；
- `Owns / Does not own`；
- 输入、输出、不变量和事实提交边界；
- 允许依赖与禁止跨越；
- `StructuredProblem`、降级、重启和幂等语义；
- 精确规范章节、真实代码入口和预期修改路径；
- 测试命令、验收证据和平台要求；
- 适用 ADR；
- 完成后的本地 commit hash。

### 7.3 最小上下文包

Agent 执行 WP 时只预载：

1. 当前有效的 `AGENTS.md`；
2. 当前 WP；
3. WP 引用的精确 Requirement/MOD/IF/FLOW/Q/TEST/ADR 章节；
4. 目标代码入口、直接调用者、状态和失败路径；
5. 必要的前置 WP 结果。

不得把全部规范、全部 ADR 或 `ATTEMPT.md` 作为默认上下文。需要扩大阅读范围时，必须由发现的依赖或冲突触发。

### 7.4 执行循环

1. 做简短 First Principles 边界检查。
2. 追踪真实入口、调用者、状态、提交边界和失败路径。
3. 涉及代码设计、修改或依赖决策时执行 Ponytail `full`。
4. 先建立会失败的最小测试证据。
5. 实现满足当前 WP 的最小纵向闭环。
6. 先运行目标检查，再按风险扩展到重启、failpoint、打包或双平台检查。
7. 检查追溯、最终 diff 和 `git status`。
8. 创建独立本地 commit，并登记 hash 与证据。

状态只使用：

`Ready → In Progress → Verification → Done`

存在真实阻塞时使用 `Blocked`，并记录缺少的产品决定、ADR、平台环境或前置证据。

- WP `Done`：目标 TEST 全部可定位并通过，证据和 commit 已登记。
- 里程碑完成：所属硬依赖 WP 完成，且该里程碑要求的 Gate/平台证据通过。
- 未验证的平台只能记录为 `unverified`，不能推断通过。

`Done` 只适用于 WP 声明的能力和产品 profile，不自动表示同一 Requirement 在扩大的首发 profile 中已经取得最终证据。G-A 的 A-only 保护证据必须在 R11/R12 由包含 Library 的证据取代。

### 7.5 并行与变更控制

- 默认由 Agent 按依赖顺序连续完成。
- 只有不共享 schema、接口、迁移、快照格式、发布配置或测试 fixture 的 WP 才可并行。
- 发现产品歧义时返回产品语义所有者；发现架构/契约缺口时先评审对应文档或 ADR。
- 不通过临时代码、双实现、fallback 或未来 feature flag 绕过阻塞。

## 8. Roadmap 文档体系

### 8.1 持久化文件

| 文件 | 单一职责 |
|---|---|
| `docs/superpowers/specs/2026-08-21-courseflow-implementation-roadmap-design.md` | 保存本轮批准的设计依据 |
| `docs/roadmap/ROADMAP.md` | 首发范围、R0–R12 顺序、依赖、里程碑出口和 G1–G8 放行规则 |
| `docs/roadmap/BACKLOG.md` | 有序 WP 注册表、状态、前置、目标 ID、计划链接、commit 和证据 |
| `docs/superpowers/plans/` | Agent 可直接执行的即时细化实施计划 |

不创建重复的 Requirement、Architecture、Contract、ADR 或 trace 语义来源。

### 8.2 完整 Roadmap、即时细化计划

- `BACKLOG.md` 在建立时覆盖 R0–R12 的全部预期 WP。
- 每个首发 Requirement 和适用 `TEST-*` 有一个主要归属 WP；跨切面测试可以在 Gate 重跑，但不产生多个语义所有者。
- C1/C2 只记录为首发排除，不创建实现任务。
- 未来里程碑不预建空文件、虚构代码路径或长期失真的逐文件步骤。
- 整体 Roadmap 和 Backlog 完成后，立即为 R0–R1 编写第一份 Agent 可执行计划。
- 后续里程碑在开始前，根据当时真实代码结构生成下一份详细计划。

### 8.3 状态与证据

`ROADMAP.md` 相对稳定；日常进度只更新 `BACKLOG.md`：

- WP 状态；
- 实际执行的验证命令和结果摘要；
- 验证平台；
- 本地 commit hash；
- 构建、安装包或 Gate 证据位置；
- 未验证项或阻塞原因。

不把大段终端日志复制进文档，只保存足以复现和审计的证据索引。

### 8.4 规范变更顺序

- 产品范围或行为变化：先更新 Product，再同步 Roadmap。
- 模块、接口、FLOW、Q 或事实所有权变化：先更新 Architecture 并同步 Contracts。
- 技术选择变化：先建立或更新 ADR。
- 仅实施顺序变化：只更新 Roadmap/Backlog。
- 测试描述硬编码 24 个表面等首发范围不一致项，由 R0 在其语义所有者中显式修正。

## 9. R0 发布资源与版本前置

R0 建立发布资源矩阵，但不得在仓库中记录密钥、证书内容或其他秘密：

- macOS arm64 原生构建/测试环境；
- Apple Developer ID 签名和公证能力；
- Windows x64 原生构建/测试环境；
- Windows Authenticode 签名能力；
- GitHub Releases 发布权限；
- 安装、升级和精确版本回退测试条件。

每项状态只能是 `available`、`unavailable` 或 `unverified`。缺失资源不阻止无关代码 WP，但对应平台验证 WP、Gate 和 G8 不得完成。

R1 建立首次可打包骨架时，Agent 必须依据 ADR-10 和官方一手资料重新核验 Electron、Node、`node:sqlite`、Electron Forge、WiX 等兼容版本。R12 发布前再次核验。研究阶段版本号不是永久冻结的未来发布版本。

## 10. 验证与 Gate 策略

### 10.1 追溯

- G1 必须证明 61 项首发 Requirement → WP → MOD/IF/FLOW/Q/TEST → evidence 的闭环。
- C1/C2 必须显示为明确排除，而不是追溯缺失。
- 每项 Requirement 只有一个主要 WP；共享 `TEST-*` 由一个 WP 首次关闭，在后续 Gate 中重跑。
- R5/R6 的保护内核和 G-A 的 A-only profile 不得被登记为 `A-DATA-004/005/007` 或相关 DOD 的最终首发证据。

### 10.2 分层证据

Agent 按风险逐层扩大验证：

1. 纯领域和 canonical vector 测试；
2. 模块契约、进程边界和 DATA 集成测试；
3. failpoint、响应丢失、重启、幂等和错误 build 测试；
4. 真实资料库、文件系统、资源通道和打包运行时测试；
5. 原生 macOS/Windows 安装、升级、回退、离线和签名测试；
6. G1–G8 与发布制品复核。

### 10.3 不可伪造的状态

- “代码写完”不是 `Done`。
- 构建成功不替代打包后运行。
- 单平台通过不替代双平台通过。
- 结构化数据快照不替代包含 Library 的完整快照。
- 恢复到 DATA 可打开不替代 Library 全量对账与启动路由恢复。
- 未执行、环境缺失或证据过期始终保持未验证。

## 11. 主要风险与控制

| 风险 | 控制 |
|---|---|
| 当前没有真实代码树，远期逐文件计划容易失效 | Roadmap/Backlog 全量，详细计划即时细化 |
| Electron 原生依赖只在开发环境工作 | R1 即进入真实 packaged runtime，并在后续平台敏感里程碑持续复测 |
| 备份/恢复在 Library 交付前被误报完整 | R5/R6 标为协议内核；完整产品 Requirement 只在 R11 关闭 |
| macOS、签名或发布权限晚期缺失 | R0 登记资源状态；证据 WP 和 G8 保持硬阻塞 |
| C1/C2 渗入首发 schema 或 UI | 首发 profile、19 表面检查、schema/导航负向测试 |
| 规范状态和测试数字仍使用全量 C1 口径 | R0 在 Product/UI/Architecture/Contracts 中统一首发 profile |
| 版本与官方工具链漂移 | R1 和 R12 重新核验一手资料，不从研究日期永久冻结 |
| Agent 上下文过大或从旧尝试继承实现 | WorkPacket 精确引用；默认禁止读取 `ATTEMPT.md` |

## 12. 本规划任务的交付与验收

本规划任务交付：

1. 本设计规格；
2. `docs/roadmap/ROADMAP.md`；
3. `docs/roadmap/BACKLOG.md`；
4. 第一份 R0–R1 Agent 可执行实施计划。

本规划任务不交付产品代码，也不开始 R0/R1 执行。

Roadmap 交付完成必须满足：

- 本规格通过用户书面复核；
- Roadmap 准确记录 R0–R12、硬依赖、证据依赖和 Gate；
- Backlog 覆盖全部 61 项首发 Requirement 和适用 `TEST-*`，且没有 C1/C2 实现任务；
- R0–R1 计划包含精确目标路径、测试先行步骤、命令、证据和本地提交边界；
- 所有新增/修改文档通过链接、稳定 ID、术语、规范层级和 `git diff --check` 检查；
- 每次仓库变更形成独立本地 commit，不 push、不 amend 用户提交。

书面规格批准后，下一步使用 Superpowers `writing-plans` 生成 Roadmap、Backlog 和第一份实施计划；只有用户另行要求执行时，才进入产品代码实现。
