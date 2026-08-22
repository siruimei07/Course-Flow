# CourseFlow 首个公开版本工作包 Backlog

> 状态：已批准，执行中
> 基线日期：2026-08-21
> 顺序与门禁：[ROADMAP.md](./ROADMAP.md)
> 已批准设计：[Implementation Roadmap Design](../superpowers/specs/2026-08-21-courseflow-implementation-roadmap-design.md)

## 1. 使用规则

本台账登记首发的 53 个工作包及其唯一的 Requirement/TEST 主所有者。Requirement 与 `TEST-*` 的完整语义仍分别由 [PRD.md](../product/PRD.md) 和 [MODULE_CONTRACTS.md](../architecture/MODULE_CONTRACTS.md) 拥有。

状态只允许：

- `Ready`：硬依赖完成，规范与验收可判定，可以领取。
- `In Progress`：执行者已经领取且正在修改。
- `Verification`：实现完成，正在收集包内测试、平台或 Gate 证据。
- `Done`：目标测试和证据全部满足，变更已提交。
- `Blocked`：存在已记录且无法在包内解决的真实外部阻塞。
- `—`：工作包已登记但尚未进入生命周期；不是正式状态。

同一时刻只推进一个主链工作包；只有 Roadmap 明确允许的独立平台包可以并行。状态变更必须在“证据台账”记录提交、命令、结果和未验证项。

## 2. 工作包注册表

### R0 — 实现就绪

| WorkPacket | 可验证结果 | 硬依赖 | 证据依赖 | 主 Requirement | 主 TEST | 状态 |
|---|---|---|---|---|---|---|
| `WP-R0-01` | 首发剖面、19 个 UI 表面、五项主导航和“临近截止”规则写回产品语义所有者；移除无功能主题预留位 | — | — | — | — | `Ready` |
| `WP-R0-02` | Architecture、Contracts、User Flow 与追溯状态统一为已批准实现基线，测试描述能区分 19/24 表面 | `WP-R0-01` | — | — | — | — |
| `WP-R0-03` | 开发工具/依赖版本复核完成，双平台主机、签名、发布与回退资源均有事实状态 | `WP-R0-01` | — | — | — | — |

### R1 — 可打包 Walking Skeleton

| WorkPacket | 可验证结果 | 硬依赖 | 证据依赖 | 主 Requirement | 主 TEST | 状态 |
|---|---|---|---|---|---|---|
| `WP-R1-01` | pnpm、Electron、Forge Vite、React、TypeScript 精确锁定并可重复安装、类型检查和构建 | `WP-R0-02`, `WP-R0-03` | — | — | — | — |
| `WP-R1-02` | Main/preload/renderer 最小安全壳可在开发与打包产物中打开，Renderer 无 Node/Electron 能力 | `WP-R1-01` | — | — | — | — |
| `WP-R1-03` | Main 监督单一 Workspace utility process；精确 `appBuildId` 握手和最小 Query DTO 可验证 | `WP-R1-02` | — | — | — | — |
| `WP-R1-04` | 开发 app identity、稳定开发数据根、单实例和内存 SQLite 运行时探针在打包产物中通过 | `WP-R1-03` | — | — | — | — |
| `WP-R1-05` | Windows 与 macOS 的进程边界、隐私、启动/退出和打包烟测证据登记完成 | `WP-R1-04` | 对应平台主机 | — | — | — |

### R2 — 首次真实保存

| WorkPacket | 可验证结果 | 硬依赖 | 证据依赖 | 主 Requirement | 主 TEST | 状态 |
|---|---|---|---|---|---|---|
| `WP-R2-01` | DATA commit、schema/迁移、事务和幂等摘要基础可持久化并在重启后重开 | `WP-R1-04` | `WP-R1-05` | `A-DATA-001` | `TEST-DATA-001`, `TEST-DATA-002`, `TEST-DATA-003`, `TEST-DATA-005` | — |
| `WP-R2-02` | 首次 setup 可创建并选择当前学期，重启后保持稳定身份 | `WP-R2-01` | — | `A-TERM-001`, `A-TERM-002` | — | — |
| `WP-R2-03` | 用户可创建课程和首个 meeting，并保留课程核心字段与 TBA 区分 | `WP-R2-02` | — | `A-COURSE-001`–`A-COURSE-004` | — | — |
| `WP-R2-04` | setup → 当前学期 → 课程 → meeting → 重启的 UI 纵向切片通过 | `WP-R2-03` | `WP-R1-05` | — | — | — |

### R3 — 可用课表

| WorkPacket | 可验证结果 | 硬依赖 | 证据依赖 | 主 Requirement | 主 TEST | 状态 |
|---|---|---|---|---|---|---|
| `WP-R3-01` | 学期生命周期和有效日期范围约束课程/meeting 投影 | `WP-R2-04` | — | `A-TERM-003`, `A-COURSE-007` | — | — |
| `WP-R3-02` | 重复 meeting 产生稳定 occurrence/segment，跨重启身份不漂移 | `WP-R3-01` | — | `A-COURSE-005` | — | — |
| `WP-R3-03` | 时间、TermZone、冲突和 TBA 语义完整且不把未知值默认化 | `WP-R3-02` | — | `A-COURSE-006` | `TEST-PLAN-002` | — |
| `WP-R3-04` | 假期设置与 holiday skip 对课表投影生效，边界日期可判定 | `WP-R3-03` | — | `A-TERM-004`, `A-TERM-005` | — | — |

### R4 — 完整 MVP-A 计划核心

| WorkPacket | 可验证结果 | 硬依赖 | 证据依赖 | 主 Requirement | 主 TEST | 状态 |
|---|---|---|---|---|---|---|
| `WP-R4-01` | 课程/全局任务的创建、编辑、完成与稳定身份闭环 | `WP-R3-04` | — | `A-TASK-001`–`A-TASK-003` | `TEST-PLAN-001` | — |
| `WP-R4-02` | 重复任务、适用范围、假期规则与实例展开闭环 | `WP-R4-01` | — | `A-TASK-004`, `A-TASK-007`, `A-TASK-010` | `TEST-PLAN-003` | — |
| `WP-R4-03` | 实例状态、单次/后续范围、跳过与撤销按事实提交边界工作 | `WP-R4-02` | — | `A-TASK-005`, `A-TASK-006`, `A-TASK-008`, `A-TASK-009` | `TEST-SHELL-003`, `TEST-PLAN-004`, `TEST-PLAN-005`, `TEST-FLOW-01-COMMIT` | — |
| `WP-R4-04` | Today、Week 与临近截止投影遵循统一计划和已批准日期边界 | `WP-R4-03` | — | `A-VIEW-001`–`A-VIEW-006` | `TEST-WORKSPACE-001`, `TEST-PLAN-006`, `TEST-PLAN-007` | — |
| `WP-R4-05` | Calendar 与 Agenda 共享稳定事件身份并正确呈现冲突/TBA | `WP-R4-04` | — | `A-CALENDAR-001`–`A-CALENDAR-003` | `TEST-PLAN-008` | — |
| `WP-R4-06` | 首次设置与五项主导航的键盘、焦点、非颜色状态和基础可用性通过 | `WP-R4-05` | Windows/macOS 输入环境 | — | `TEST-USABILITY-001` | — |

### R5 — 结构化备份内核

| WorkPacket | 可验证结果 | 硬依赖 | 证据依赖 | 主 Requirement | 主 TEST | 状态 |
|---|---|---|---|---|---|---|
| `WP-R5-01` | 备份目的地配置和活动 DATA/资料库/备份三类位置隔离可证明 | `WP-R4-06` | — | `A-DATA-002` | `TEST-PROTECT-001` | — |
| `WP-R5-02` | 正式 DATA commit 可异步产生结构化不可变快照，失败不回滚本地成功 | `WP-R5-01` | — | — | `TEST-PROTECT-002`, `TEST-DATA-004` | — |
| `WP-R5-03` | 最近两份已验证结构化快照、待备份和未配置状态准确持久化 | `WP-R5-02` | — | `A-DATA-003` | `TEST-PROTECT-003` | — |

### R6 — 恢复、迁移与回退内核

| WorkPacket | 可验证结果 | 硬依赖 | 证据依赖 | 主 Requirement | 主 TEST | 状态 |
|---|---|---|---|---|---|---|
| `WP-R6-01` | 备份候选分类、安全恢复集和“只整库替换、不自动合并”边界闭环 | `WP-R5-03` | — | `A-DATA-006` | `TEST-WORKSPACE-002`, `TEST-PROTECT-004` | — |
| `WP-R6-02` | 同卷暂存、检查点、外部激活协调记录和确定性继续/回滚状态机闭环 | `WP-R6-01` | 故障注入环境 | — | `TEST-DATA-006` | — |
| `WP-R6-03` | 迁移安全副本、handoff 与中断恢复内核遵循 ADR-04/08/10 | `WP-R6-02` | 精确旧/新开发 build fixture | — | — | — |
| `WP-R6-04` | 精确版本回退入口、影响说明、删除安全副本和恢复导航闭环 | `WP-R6-03` | 精确兼容 build fixture | — | `TEST-SHELL-005`, `TEST-WORKSPACE-007`, `TEST-PROTECT-007` | — |
| `WP-R6-05` | 启动、maintenance、recovery、模块不可用和重启生命周期路由可判定 | `WP-R6-04` | — | — | `TEST-WORKSPACE-004`, `TEST-FLOW-00-LIFECYCLE` | — |

### G-A — MVP-A 内部门

| WorkPacket | 可验证结果 | 硬依赖 | 证据依赖 | 主 Requirement | 主 TEST | 状态 |
|---|---|---|---|---|---|---|
| `WP-GA-01` | 不含 Attendance/Library 的 A-only 打包剖面通过 G1–G7，并明确其保护证据会在 R11/R12 被替代 | `WP-R6-05` | `WP-R1-05`, 当前双平台 A-only 包 | — | — | — |

### R7 — 出勤

| WorkPacket | 可验证结果 | 硬依赖 | 证据依赖 | 主 Requirement | 主 TEST | 状态 |
|---|---|---|---|---|---|---|
| `WP-R7-01` | 可点名 occurrence、点名窗口和 eligibility 使用稳定身份且边界准确 | `WP-GA-01` | — | `A-ATTEND-001`, `A-ATTEND-002` | `TEST-ATTEND-001` | — |
| `WP-R7-02` | 出勤标记、统计与课程覆盖层保持未知/未标记/零的区分 | `WP-R7-01` | — | `A-ATTEND-003`–`A-ATTEND-005` | `TEST-ATTEND-002`, `TEST-ATTEND-003`, `TEST-FLOW-06-DERIVED-RESULTS` | — |
| `WP-R7-03` | Attendance 降级不阻塞 Plan；统一计划流和失败隔离通过 | `WP-R7-02` | 故障注入环境 | `A-ATTEND-006` | `TEST-ATTEND-004`, `TEST-FLOW-02-UNIFIED-PLAN` | — |

### R8 — 资料库身份与索引

| WorkPacket | 可验证结果 | 硬依赖 | 证据依赖 | 主 Requirement | 主 TEST | 状态 |
|---|---|---|---|---|---|---|
| `WP-R8-01` | 单一资料库根身份、稳定本地边界和重定位语义闭环 | `WP-R7-03` | Windows/macOS 文件系统 | `B-FILE-001`, `B-FILE-013` | `TEST-LIBRARY-001` | — |
| `WP-R8-02` | 课程/分类目录、待归类与根内合法路径规则闭环 | `WP-R8-01` | Windows/macOS 文件系统 | `B-FILE-002`, `B-FILE-003` | `TEST-WORKSPACE-006`, `TEST-LIBRARY-005` | — |
| `WP-R8-03` | 全量扫描、watcher hint、FileId 对账和外部变更恢复闭环 | `WP-R8-02` | Windows/macOS 文件系统与 watcher | `B-FILE-005`, `B-FILE-006` | `TEST-LIBRARY-003` | — |
| `WP-R8-04` | 自定义标签、目录派生标签和组合搜索只使用真实索引 | `WP-R8-03` | — | `B-FILE-007`, `B-FILE-008` | — | — |

### R9 — 可恢复文件操作

| WorkPacket | 可验证结果 | 硬依赖 | 证据依赖 | 主 Requirement | 主 TEST | 状态 |
|---|---|---|---|---|---|---|
| `WP-R9-01` | copy-in 导入和 journal 在中断/重启后确定性完成或回滚 | `WP-R8-04` | Windows/macOS 文件系统 | `B-FILE-004` | `TEST-LIBRARY-002` | — |
| `WP-R9-02` | 重命名、移动、系统回收站和系统打开请求不报告虚假成功 | `WP-R9-01` | Windows/macOS 原生适配器 | `B-FILE-009` | `TEST-PLATFORM-002` | — |
| `WP-R9-03` | 同名冲突的保留两份、替换、取消及逻辑身份规则闭环 | `WP-R9-02` | Windows/macOS 文件系统 | `B-FILE-011` | `TEST-LIBRARY-004` | — |

### R10 — 预览与系统打开

| WorkPacket | 可验证结果 | 硬依赖 | 证据依赖 | 主 Requirement | 主 TEST | 状态 |
|---|---|---|---|---|---|---|
| `WP-R10-01` | 受验证资源描述符、lease 生命周期和预览数据面不泄露真实路径 | `WP-R9-03` | — | — | — | — |
| `WP-R10-02` | 支持格式只读预览、限制、解析失败和高风险文件政策闭环 | `WP-R10-01` | 恶意/超限 fixture | `B-FILE-010` | `TEST-LIBRARY-007` | — |
| `WP-R10-03` | 打包产物中的预览、定位、系统打开请求和 Library recovery 流在双平台通过 | `WP-R10-02` | Windows/macOS 打包产物 | — | `TEST-SHELL-002`, `TEST-PLATFORM-003`, `TEST-FLOW-03-LIBRARY-RECOVERY` | — |

### R11 — 完整数据保护

| WorkPacket | 可验证结果 | 硬依赖 | 证据依赖 | 主 Requirement | 主 TEST | 状态 |
|---|---|---|---|---|---|---|
| `WP-R11-01` | 每次 DATA/Library 提交触发的快照完整包含结构化数据、根身份和所有必需文件 | `WP-R10-03` | 可控云盘目录 fixture | `A-DATA-004`, `B-FILE-012` | `TEST-FLOW-04-BACKUP-FAILURE` | — |
| `WP-R11-02` | 完整恢复在重新打开 DATA、全量资料库对账和启动路由后才报告成功 | `WP-R11-01` | 故障注入与完整快照 fixture | `A-DATA-005` | `TEST-LIBRARY-006`, `TEST-PROTECT-005`, `TEST-PROTECT-006`, `TEST-FLOW-05-RESTORE-RECOVERY` | — |
| `WP-R11-03` | Shell/Workspace 模块健康、降级隔离、19 表面边界和完整首发 G1–G7 通过；冻结公开 schema/fixture | `WP-R11-02` | Windows/macOS 完整首发包 | — | `TEST-SHELL-001`, `TEST-SHELL-004`, `TEST-WORKSPACE-003`, `TEST-WORKSPACE-005` | — |

### R12 — 双平台公开发布

| WorkPacket | 可验证结果 | 硬依赖 | 证据依赖 | 主 Requirement | 主 TEST | 状态 |
|---|---|---|---|---|---|---|
| `WP-R12-01` | macOS 与 Windows 在共享领域契约下完成完整首发闭环 | `WP-R11-03` | 两个平台真实主机 | `A-PLATFORM-001` | `TEST-PLATFORM-001` | — |
| `WP-R12-02` | 离线、无账户、无远程后端/AI、无应用内更新和无生产诊断边界通过 | `WP-R12-01` | 断网与制品检查环境 | `A-PLATFORM-002` | `TEST-PLATFORM-004`, `TEST-PRIVACY-001`, `TEST-RELEASE-004` | — |
| `WP-R12-03` | 稳定数据根、已安装升级/迁移、精确版本回退和卸载保留数据在双平台通过 | `WP-R12-02` | 旧/新签名候选制品 | `A-DATA-007`, `A-PLATFORM-003` | `TEST-DATA-007`, `TEST-PLATFORM-005`, `TEST-FLOW-07-UPDATE-ROLLBACK` | — |
| `WP-R12-04` | 签名、notarized 的 macOS arm64 原生制品通过安装、替换与 Gate | `WP-R12-03` | macOS arm64 主机、Apple 签名/notary | — | `TEST-RELEASE-002` | — |
| `WP-R12-05` | 签名的 Windows x64 WiX 原生制品通过 per-machine 安装、升级、卸载与 Gate | `WP-R12-03` | Windows x64 主机、Windows 代码签名 | — | `TEST-RELEASE-003` | — |
| `WP-R12-06` | GitHub Release manifest、双平台资产、重新下载验证和 G8 全部通过 | `WP-R12-04`, `WP-R12-05` | GitHub Releases 发布权限与干净下载环境 | `A-PLATFORM-004` | `TEST-RELEASE-001`, `TEST-RELEASE-005` | — |

## 3. 首发 TEST 主所有权校验

注册表必须满足：

- 65 个首发适用 `TEST-*` 各出现且只作为一个工作包的主 TEST；包括 Attendance 分支的 `TEST-FLOW-06-DERIVED-RESULTS`。
- `TEST-GRADE-001`–`TEST-GRADE-007` 不进入任何首发工作包。
- 工作包可以重跑上游测试作为回归证据，但不得改变其主所有者；重跑记录写入证据台账。

按族计数为：Shell 5、Workspace 7、Plan 8、Attendance 4、Library 7、Protect 7、Data 7、Platform 5、Privacy 1、Release 5、Flow 8、Usability 1，共 65。

## 4. 首发 Requirement 主所有权校验

注册表必须满足：

- 42 条 MVP-A、6 条 MVP-A-P、13 条 MVP-B Requirement 各有且只有一个主工作包，共 61 条。
- `C-GRADE-001`–`C-GRADE-014` 与 `C-TARGET-001`–`C-TARGET-007` 明确排除，且不得由无 Requirement 的基础工作包暗中实现。
- 没有主 Requirement 的工作包只建设当前纵向切片必需的部署、契约、测试或安全边界，不拥有新的产品行为。

## 5. 发布资源矩阵

`WP-R0-03` 必须通过实际检查更新本表。`未验证` 是事实状态，不等于可用；任何依赖它的 Gate 在证据产生前保持开放。

| 资源 | 当前事实状态 | 关闭条件 | 影响工作包 |
|---|---|---|---|
| Windows x64 构建/安装主机 | 未验证 | 记录 OS/架构，并实际运行打包与安装烟测 | `WP-R1-05`, `WP-R12-01`, `WP-R12-05` |
| macOS arm64 构建/安装主机 | 未验证 | 记录 OS/架构，并实际运行打包与安装烟测 | `WP-R1-05`, `WP-R12-01`, `WP-R12-04` |
| Apple Developer ID 与 notarization | 未验证 | 候选制品签名、notarize、staple 和 Gatekeeper 验证通过 | `WP-R12-04` |
| Windows 代码签名能力 | 未验证 | WiX 制品签名和干净机器验证通过 | `WP-R12-05` |
| GitHub Releases 发布权限 | 未验证 | 能创建候选 Release、上传资产/manifest 并从公开端重新下载 | `WP-R12-06` |
| 旧版 → 新版安装/迁移条件 | 未验证 | 保留精确旧候选制品与独立测试数据，完整升级/迁移矩阵通过 | `WP-R12-03` |
| 新版 → 精确旧版回退条件 | 未验证 | 精确兼容制品、迁移安全副本和独立测试数据齐备并通过 | `WP-R12-03` |

工具和依赖版本的复核结果也由 `WP-R0-03` 记录，但最终发布候选必须在 `WP-R12-04`/`05` 再次按 ADR-10 复核，不能沿用过期查询。

## 6. 证据台账

每次状态变化在下表追加一行；不得覆盖失败或未验证事实。

| 日期 | WorkPacket | 状态变化 | 提交/制品 | 实际运行的验证 | 结果与未验证项 |
|---|---|---|---|---|---|
| 2026-08-21 | `WP-R0-01` | `— → Ready` | Roadmap 基线提交 | 文档链接、ID/计数、`git diff --check` | 等待执行 R0 产品校准 |

## 7. 拆包与变更规则

- 工作包过大时可以拆成带稳定后缀的子包，但父包在全部子包 `Done` 前不得 `Done`，且 Requirement/TEST 主所有权必须保持唯一。
- 仅实现顺序、资源或证据安排变化时更新本文件和 Roadmap。
- 产品行为变化先更新 PRD/MVP；模块边界/FLOW/Q 变化先更新 Architecture；接口/Problem/TEST 变化先更新 Contracts；技术选择变化先建立或修订 ADR。
- 任何拆包都不得创建“通用框架”“未来扩展”“收尾”或 C1/C2 占位工作包。
