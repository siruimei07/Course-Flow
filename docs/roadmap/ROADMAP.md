# CourseFlow 首个公开版本实施 Roadmap

> 状态：已批准，进入执行
> 基线日期：2026-08-21
> 发布范围：MVP-A + MVP-A-P + MVP-B；明确排除 C1/C2
> 工作包台账：[BACKLOG.md](./BACKLOG.md)
> 首份执行计划：[R0–R1 Implementation Plan](../superpowers/plans/2026-08-21-courseflow-r0-r1-implementation.md)

## 1. Roadmap 的职责

本文件只拥有实现顺序、里程碑、工作包分组、依赖关系和晋级门禁。它不重新定义产品行为、模块所有权、接口、测试义务或技术选择；发生分歧时按下列上游规范处理：

- 产品目标与总边界：[PROJECT_BRIEF.md](../product/PROJECT_BRIEF.md)
- 详细产品行为与 Requirement ID：[PRD.md](../product/PRD.md)
- MVP 分层、非目标、NFR 与完成定义：[MVP_SCOPE.md](../product/MVP_SCOPE.md)
- 用户流程与 UI 行为：[User Flow](../superpowers/specs/2026-08-17-user-flow-design.md) 与 [UI Page Spec](../superpowers/specs/2026-08-18-courseflow-ui-wireframes-page-spec-design.md)
- 模块、依赖、FLOW、Q 与 Gate：[ARCHITECTURE.md](../architecture/ARCHITECTURE.md)
- 接口、状态机、Problem、TEST 与追溯：[MODULE_CONTRACTS.md](../architecture/MODULE_CONTRACTS.md)
- 技术实现选择：[ADR 目录](../architecture/adr/)
- 本 Roadmap 的已批准设计：[Implementation Roadmap Design](../superpowers/specs/2026-08-21-courseflow-implementation-roadmap-design.md)

执行者必须先从 [BACKLOG.md](./BACKLOG.md) 领取一个处于 `Ready` 的工作包，再按该包引用的稳定 ID 定位规范。不得以 Roadmap 中的摘要替代上游定义。

## 2. 首发范围校准

首个公开版本一次性交付当前 PRD/MVP 中除 C1/C2 外的全部范围：

| 发布剖面 | 纳入内容 | Requirement 数 | UI 表面 |
|---|---|---:|---:|
| MVP-A | 学期、课程、课表、任务、Today/Week、Calendar、Agenda、结构化数据保护 | 42 | 14 个非 Grade 表面中的核心部分 |
| MVP-A-P | 点名与出勤统计 | 6 | 由现有课程/统一计划表面承载 |
| MVP-B | 本地资料库、文件操作、预览、搜索、完整备份/恢复 | 13 | 5 |
| 首发合计 | MVP-A + MVP-A-P + MVP-B | 61 | 19 |

首发主导航固定为：`Today`、`Courses`、`Calendar`、`Tasks`、`Files`。

下列 21 条 Requirement 不进入首发：`C-GRADE-001`–`C-GRADE-014` 与 `C-TARGET-001`–`C-TARGET-007`。首发不得创建 Grade schema、导航、空页面、占位接口、功能开关或兼容层。C1/C2 的已批准产品设计继续保留在其语义所有者中，但不形成首发工作包。

R0 必须先把以下已批准校准写回语义所有者，之后才允许进入代码：

- “临近截止”是待办且未跳过、截止已知、按 `TermZone` 当前日期判断，并落在明天至第 7 天的闭区间；当天属于 Today/overdue 判定，第 8 天及以后不属于临近截止。
- 首发测试和 UI 追溯按 19 个表面验收，同时保留完整产品设计的 24 个表面计数。
- 移除没有交互、没有状态且不在首发范围内的主题切换预留位。
- Architecture、Contracts 与 User Flow 的状态升级为已批准实现基线。

## 3. 执行原则

### 3.1 纵向切片

每个里程碑都必须在已有可运行产品上增加一个用户可见、可持久化或可验证的闭环。不得先铺设未被当前工作包使用的横向框架，也不得为未来 C1/C2 建空模块。

### 3.2 依赖类型

- **硬依赖**：前置工作包必须为 `Done`，后续包才可进入 `Ready`。
- **证据依赖**：功能可先实现，但在指定证据补齐前不得通过对应里程碑 Gate。
- **平台证据**：涉及 macOS/Windows 的结论必须来自相应平台实际运行；单平台结果不得推断另一平台通过。

### 3.3 完成边界

工作包只有在目标 Requirement、MOD/IF/FLOW/Q 和所有目标 `TEST-*` 义务均可定位且通过时才可为 `Done`。实现代码、测试、规范追溯和必要的运行证据属于同一工作包，不留“后补测试”或“后补文档”。

### 3.4 数据与发布边界

- R1–R10 只允许使用明确标记为可丢弃、从未公开发布的开发/测试数据来纠正未冻结 schema。
- R11 冻结首发 schema、fixture、快照闭包和恢复候选格式；冻结后只允许遵循 ADR-04 的前向迁移。
- 任何里程碑都不得触碰用户已发布数据格式而不提供显式、可测试迁移。
- Git 提交、构建和测试证据不等于发布；只有 R12 完成双平台签名制品和 G8 才能公开发布。

## 4. 里程碑总览

| 里程碑 | 工作包 | 用户/工程结果 | 进入条件 | 退出条件与 Gate |
|---|---|---|---|---|
| R0 实现就绪 | `WP-R0-01`–`03` | 首发剖面、规范状态、工具与发布资源事实可判定 | 已批准 Roadmap 设计 | 产品/架构/契约无首发歧义；版本与发布资源矩阵有证据 |
| R1 可打包 Walking Skeleton | `WP-R1-01`–`05` | Electron/React/TypeScript 壳、单一 Workspace utility process、稳定开发数据根与 SQLite 运行时探针可打包运行 | R0 完成 | Windows 与 macOS 的边界、隐私和打包烟测证据齐全 |
| R2 首次真实保存 | `WP-R2-01`–`04` | setup → 当前学期 → 课程 → 首次 meeting → 重启仍存在 | R1 核心完成且 R1 证据 Gate 可关闭 | 第一条真实 `FLOW-01-COMMIT` 前置数据链闭环 |
| R3 可用课表 | `WP-R3-01`–`04` | 学期范围、重复 occurrence、冲突与假期规则可用 | R2 完成 | 课表边界、时间语义和重启投影通过 |
| R4 完整 MVP-A 计划核心 | `WP-R4-01`–`06` | 任务、重复实例、Today/Week、Calendar/Agenda、可访问核心路径闭环 | R3 完成 | MVP-A 计划功能与基础可用性测试通过 |
| R5 结构化备份内核 | `WP-R5-01`–`03` | 可配置目的地、不可变结构化快照、保留与状态语义可用 | R4 完成 | ADR-07 的结构化快照子集通过；尚不声称整库保护完成 |
| R6 恢复/迁移/回退内核 | `WP-R6-01`–`05` | 安全恢复集、整库激活、迁移安全副本、精确版本回退与维护态闭环 | R5 完成 | ADR-04/08/10 的内核恢复路径通过 |
| G-A MVP-A 内部门 | `WP-GA-01` | 不含 Attendance/Library 的 A-only 安装包通过 G1–G7 | R6 完成 | 仅作为内部剖面证据；其数据保护结论会在 R11/R12 被完整证据替代 |
| R7 出勤 | `WP-R7-01`–`03` | 点名窗口、标记、统计、统一计划降级闭环 | G-A 完成 | MVP-A-P 六条 Requirement 与四条 Attendance 测试通过 |
| R8 资料库身份与索引 | `WP-R8-01`–`04` | 根身份、分类、扫描/FileId 对账、标签与搜索闭环 | R7 完成 | Library 索引在外部变更和重启后可恢复 |
| R9 可恢复文件操作 | `WP-R9-01`–`03` | 导入、重命名、移动、回收站、冲突/替换闭环 | R8 完成 | ADR-05 文件事实提交边界与恢复路径通过 |
| R10 预览与系统打开 | `WP-R10-01`–`03` | 资源 lease、受验证预览、系统打开和打包流程闭环 | R9 完成 | ADR-06 数据面、安全边界与跨平台流程通过 |
| R11 完整数据保护 | `WP-R11-01`–`03` | 资料库闭包纳入快照，完整恢复后对账，模块健康隔离 | R10 完成 | 冻结公开 schema/fixture；G1–G7 以完整首发剖面重跑通过 |
| R12 双平台公开发布 | `WP-R12-01`–`06` | 平台一致性、离线/隐私、安装迁移/回退、签名 macOS/Windows 制品和发布 manifest | R11 完成 | G8 通过；双平台安装、升级、回退、重新下载均有真实证据 |

## 5. 关键依赖链

主交付链为：

`R0 → R1 → R2 → R3 → R4 → R5 → R6 → G-A → R7 → R8 → R9 → R10 → R11 → R12`

R12 中 `WP-R12-04`（macOS）与 `WP-R12-05`（Windows）在 `WP-R12-03` 完成后可并行；`WP-R12-06` 必须等待二者均为 `Done`。其余硬依赖以 [BACKLOG.md](./BACKLOG.md) 的逐包登记为准。

R1 的双平台烟测是 R2 之后所有实现的持续证据依赖。若某一平台暂时缺少主机或签名资源，代码工作可以继续到不依赖该资源的下一个包，但对应 Gate 不得宣称通过，且 R12 不能发布。

## 6. Gate 使用规则

Architecture 定义 G1–G8 的语义，本文件只规定何时运行：

| Gate | 首次完整运行 | 后续要求 |
|---|---|---|
| G1–G7（A-only 剖面） | G-A | 只证明 MVP-A 内部剖面，不替代首发证据 |
| G1–G7（完整首发剖面） | R11 | R12 任何影响运行时、数据或打包的变更后重跑受影响 Gate |
| G8 | R12 | 两个平台签名安装包、manifest、回退与重新下载证据同时满足后通过 |

Gate 失败时，修复归入造成失败的最小语义所有者工作包；不得新建泛化“收尾”包来掩盖归属。

## 7. 工作包推进规则

Backlog 生命周期为 `Ready → In Progress → Verification → Done`，遇到真实外部阻塞时可标记 `Blocked`。尚未进入生命周期的已登记工作包显示为 `—`，它不是额外状态。

推进一个工作包时必须：

1. 确认所有硬依赖 `Done`，并记录仍开放的证据依赖。
2. 按 `MODULE_CONTRACTS.md` §1.5 只读取目标稳定 ID 所需章节。
3. 在实现前写出或更新会先失败的最小测试证据。
4. 完成最短正确纵向切片，不实现未列入目标的扩展。
5. 运行包内最小验证，再运行受影响 Gate/平台检查。
6. 在 Backlog 登记证据、未验证项和最终状态；代码与证据同批提交。

任何新增 Requirement、跨模块依赖、公共格式或技术选型都必须先回到其上游规范或 ADR 审批，再调整本 Roadmap。仅改变执行顺序、拆分粒度或资源安排时，才直接修改 Roadmap/Backlog。

## 8. 当前执行点

当前唯一 `Ready` 工作包是 `WP-R0-01`。其余 52 个工作包已经登记但尚未进入生命周期。执行顺序和逐步命令见 [2026-08-21-courseflow-r0-r1-implementation.md](../superpowers/plans/2026-08-21-courseflow-r0-r1-implementation.md)。
