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
| MVP-A | 学期、课程、课表、任务、Today/Week、Calendar、Agenda、结构化数据保护 | 43 | 14 个非 Grade 表面中的核心部分 |
| MVP-A-P | 点名与出勤统计 | 6 | 由现有课程/统一计划表面承载 |
| MVP-B | 本地资料库、文件操作、预览、搜索、完整备份/恢复 | 13 | 5 |
| 首发合计 | MVP-A + MVP-A-P + MVP-B | 62 | 19 |

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
| G-A MVP-A 内部门 | `WP-GA-01` | 完成已批准桌面窗口 UI 优化，不含 Attendance/Library 的 A-only 安装包通过 G1–G7 | R6 完成 | 双平台 packaged UI 验收与 A-only G1–G7 通过；数据保护结论会在 R11/R12 被完整证据替代 |
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

`WP-GA-01` 先执行 [Backlog 中已批准的桌面窗口 UI 优化计划](./BACKLOG.md#wp-ga-01-桌面窗口-ui-优化-implementation-plan)：显式增大默认恢复窗口、消除客户区内的嵌套外框、固定四边一致的单一窗口外壳，并把隐藏 scrollbar 的可用滚动限制在内容区。双平台 packaged 人工验收通过后才运行 A-only G1–G7；不得用增大窗口掩盖底边随文档滚动的问题，也不得移除 Windows Snap/resize 所需的原生 `thickFrame`。

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

2026-08-28 已批准 Course、Task、Attendance 与 Grade 的整体验证目标：Task 由 `small/large` 转为
Coursework/Assessment 分组与类型，Course 创建支持零至多条 Time Slot，Attendance 使用五状态，C1 Grade
支持直接评分项和一层等权分类。该批准只改变后续实现目标；当前运行时、既有 Done 工作包和下方历史证据仍如实
描述已交付旧模型。具体实施切片与生命周期必须另行登记到 Backlog，不能从本段推断已经实现或排期。

R0 与 R1 已经 `Done`。`WP-R1-05` 已在同一源码提交 `cd3a2fd66bca0fbd7e51c9eadef4dac1393484a2` 上取得 Windows x64 与 macOS arm64 的开发 package 证据并关闭 R1 Gate；签名、安装和公开发布仍由 R12 的独立门禁负责。

`WP-R2-01`–`WP-R2-04`、`WP-R3-01`–`WP-R3-04` 与 `WP-R4-01`–`WP-R4-06` 已经 `Done`，R2、R3、R4 里程碑关闭。R3 已交付学期生命周期、Course/Meeting 有效日期范围、跨重启身份稳定的重复 Meeting occurrence/segment、显式 TermZone 的跨日/DST 时间和非阻塞冲突/TBA 语义，以及命名 HolidayRange 对周期 Meeting 的确定性抑制；R4 已进一步交付 once/weekly Task、稳定 `TaskOccurrenceId`、独立 pending/completed/skipped、large 可选进度、only-this/this-and-future 分段、范围删除、精确影响预览、一次性 Undo，以及共享 revision/EvaluationContext 和稳定 occurrence identity 的 Today、Week、Calendar、Agenda、临近截止、next-small/next-large、计数、学期日期进度与独立 TBA 投影。Calendar/Agenda 已完成确定性排序、非突变冲突 warning 和 HolidayRange 连续片段。[`WP-R4-06`](./BACKLOG.md#r4--完整-mvp-a-计划核心) 已实现可中断/恢复/提前进入 Today 的首次设置、Term + Course + Meeting 或 Task 最低条件、五项键盘导航、真实空状态及固定浅色响应式可访问视觉；implementation source `7ae3368a2a9526616d75c7ddd8b7404e30b5b113` 已取得 Windows x64 与 macOS arm64 package/smoke、真实 packaged 交互和同根重启持久化证据，并实际完成 Windows Narrator/系统 High Contrast/透明与动画设置、macOS 全局菜单/traffic lights/VoiceOver/Increase Contrast/Reduce Transparency/Reduced Motion 验证。clean Windows package identity `adc71ccf77784b5f455e4fcc6ac68a249b9c4e41` 又取得 packaged `<6 s` Undo、Toast hover/键盘焦点暂停、Today/Tasks/Calendar 同步与同根重启保持，以及最大合法 Term `0001-01-01`–`9999-12-31` 的 Today/PLAN、Calendar/Agenda 数值样本；规范没有毫秒门槛，未自创性能结论。最终真实首次用户从空隔离数据根完成参考最低设置并进入 Today，耗时 `4 分 07.797 秒`、阻塞点为“无”；真实物理鼠标标题栏拖拽及左、右边缘 Snap 均通过。`WP-R4-06` 因此关闭，R4 里程碑完成。

`WP-R5-01` 已交付合法未配置状态、备份目的地配置、三位置隔离和 repository/Workspace/BackupSet 身份隔离，并以 clean source `708fa4febbc20cf6b498f952b288e7048955c299` 取得 Windows x64 package/smoke 后关闭；`WP-R5-02` 已以 clean source `e2745ebea8909820344270d89d21a4a877f753ef` 交付正式 DATA commit 的异步不可变结构化 snapshot、actual revision、持久 operation/watermark 与崩溃收敛，并取得 Windows x64 package/smoke 后关闭；`WP-R5-03` 已以 clean source `274b86a1a2a15623ee78801c0a74aa8fb78aefba` 交付 schema level 14、合法 unconfigured/pending/current、last success、最近两份 fresh verified snapshot、exact verified-candidate retention 与 restartable quarantine/delete，并取得 Windows x64 package/smoke 后关闭。R5 因此完成。`WP-R6-01` 已以 feature source `9d9df5790640ca3ce80fff4b19657aaa5ddc1a52` 和 clean source `f7af771c31a30846f019abd2eb910f20230016c0` 交付五类候选重新验证、verified-only RestoreSession、健康 current 的 A-only RestoreSafetySet，以及绑定候选/current revision/Library root/target/impact 的完整替换且不自动合并预览，并取得 Windows x64 package/smoke 后关闭。`WP-R6-02` 已以 clean source `3616fbf591af741d6515db2d0216d3bbcbeb9ab2` 交付 A-only DATA 的同卷 sibling staging、ActivityControlRoot 外部 write-ahead activation journal、armed checkpoint，以及重启后证据驱动的继续/回滚状态机；物理动作遵循 intent → 执行 → 重验 → observed，checkpoint 前不替换活动 DATA，checkpoint 后禁止普通打开，DATA commit-last，成功与回滚均重开验证，并已取得 Windows x64 package/smoke 后关闭。`WP-R6-03` 已以 clean implementation source `f3b46238008f87fc3d812af44d5ec47e80a2f761` 交付 MigrationSafetyCopyV1、MigrationRollbackHandoffV1 及其中断/重启恢复内核：迁移首写前保留并验证唯一安全副本，handoff 绑定 exact source/target build，以 owner 内同卷 write-ahead 物理状态和 Restore 全局互斥阻止普通启动越过恢复边界。原精确开发 build fixture 固定 old `2361554e7e0a18c11ed0ce3b4b1da7bab52a6940` 与 new `f3b46238008f87fc3d812af44d5ec47e80a2f761`，且如实证明 pinned old 没有 HandoffV1 reader。`WP-R6-04` 已从 `c5673306e5c65409c52ecb686c86f607d42dd1b7` 推进，并以 clean implementation source `ae3bd3c8571aec31b4dd27a9ff7a8bd590e3c1bb` 交付 path-free ApplicationBuildStatus、MigrationSafetyCopy 展示/显式删除、绑定 copy/current DATA/Library/source-target build/影响摘要的 rollback preview-confirm，以及完整 maintenance/recovery Shell 导航；source cancel、target continue、other/mixed stop 均保持 exact-build 分类、外部手动换包和无部分成功。兼容 fixture 固定 rollback target `5b18515eae0f9f80e1f7a2fcafbf008bb3326979` 与 source `ae3bd3c8571aec31b4dd27a9ff7a8bd590e3c1bb`，两端使用自己的 descriptor/readers/package，在 Windows x64 通过独立 DATA/control 场景、跨进程终态重启及 package/smoke；R6-04 因此 `Done`。`WP-R6-05` 已以 clean implementation source `c6c7a351cc2771998a1085e8b6a68b05cff54d1f` 交付统一 pre-DATA PROTECT 判定、protocol 3 lifecycle、持久 operation/follow-up 恢复、mode/capability/health 与五路由聚合、自动归档重启语义和显式 welcome 初始化，并修复满载 packaged-smoke 的事件循环清理根因；Windows x64 package/smoke 已通过，R6 因此完成。上述为 R6 完成时的历史证据；R7、R11/R12 仍未进入，G-A 与后续双平台验证的当前状态见下一段。当时尚未覆盖 macOS arm64、真实 OS 强杀/掉电、真实跨卷拒绝、目标 packaged UI 实际回退交互、签名、安装与公开发布；通用 macOS 回归已另有后续台账，不能替代精确回退或发行专项；Library-present RestoreSafetySet 完整闭包仍属于 R11。

用户随后批准将显式增大默认窗口、隐藏右侧可见垂直滚动条、消除客户区内嵌套外框和让底边在较矮窗口中始终可见的单一外壳方案归入 `WP-GA-01`。2026-08-29 用户又逐项授权一组桌面显示缺陷修复，`WP-UI-01` 因此在切片 2 中实现了该 UI 方案的两个代码切片（默认窗口改为用户指定的 `1280×800` 并新增最小 `960×640`、单一客户区外壳与内容区独占滚动），并新增含左侧分类导航的独立设置表面；`WP-GA-01` 计划文本已同步这些数值，其状态已在 2026-09-04 收口任务中推进为 `Verification`。同一 clean `b39124d` 的双平台 package/smoke 已齐，用户确认 macOS 测试完成；新增内核修复的 clean `df9841e` 另通过 Windows package/smoke，host 默认/月窗口查询各 100 次的 p95 为 45.28/48.93 ms。相同 752 项测试串行运行 751 通过、1 权限跳过；两次默认并行运行的清理超时及浏览器 EBUSY 失败仍保留。G2–G5 的 A-only 内核证据已归并；用户已确认 G1 按已交付 A-only 模型验收，新模型另行登记后续工作包；最新默认并行复验 758 项中 757 通过、0 失败、1 权限跳过，typecheck 通过。恢复后旧备份授权已修复；e2ea721 Windows 无备份端点通过，但完整后台预算失败。备份调度修复已通过自动化，正待同源打包复测。当前仍待 G6 当前 Windows 真人/实际禁网、G7 修复后双平台基线与后台预算、剩余适用 ADR 运行时测量，详见 [G-A 验收记录](./WP-GA-01-ACCEPTANCE.md)。`WP-RF-01` 已依据 Windows 四项门禁关闭；`WP-UI-01` 与 `WP-RF-02` 仍在验证。`WP-R6-05` 已完成且 R6 已关闭；工作包生命周期仍只以 [Backlog 注册表与证据台账](./BACKLOG.md#6-证据台账) 为准，本段仅同步当前指针。
