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
| `WP-R0-01` | 首发剖面、19 个 UI 表面、五项主导航和“临近截止”规则写回产品语义所有者；移除无功能主题预留位 | — | — | — | — | `Done` |
| `WP-R0-02` | Architecture、Contracts、User Flow 与追溯状态统一为已批准实现基线，测试描述能区分 19/24 表面 | `WP-R0-01` | — | — | — | `Done` |
| `WP-R0-03` | 开发工具/依赖版本复核完成，双平台主机、签名、发布与回退资源均有事实状态 | `WP-R0-01` | — | — | — | `Done` |

### R1 — 可打包 Walking Skeleton

| WorkPacket | 可验证结果 | 硬依赖 | 证据依赖 | 主 Requirement | 主 TEST | 状态 |
|---|---|---|---|---|---|---|
| `WP-R1-01` | pnpm、Electron、Forge Vite、React、TypeScript 精确锁定并可重复安装、类型检查和构建 | `WP-R0-02`, `WP-R0-03` | — | — | — | `Done` |
| `WP-R1-02` | Main/preload/renderer 最小安全壳可在开发与打包产物中打开，Renderer 无 Node/Electron 能力 | `WP-R1-01` | — | — | — | `Done` |
| `WP-R1-03` | Main 监督单一 Workspace utility process；精确 `appBuildId` 握手和最小 Query DTO 可验证 | `WP-R1-02` | — | — | — | `Done` |
| `WP-R1-04` | 开发 app identity、稳定开发数据根、单实例和内存 SQLite 运行时探针在打包产物中通过 | `WP-R1-03` | — | — | — | `Done` |
| `WP-R1-05` | Windows 与 macOS 的进程边界、隐私、启动/退出和打包烟测证据登记完成 | `WP-R1-04` | 对应平台主机 | — | — | `Done` |

### R2 — 首次真实保存

| WorkPacket | 可验证结果 | 硬依赖 | 证据依赖 | 主 Requirement | 主 TEST | 状态 |
|---|---|---|---|---|---|---|
| `WP-R2-01` | DATA commit、schema/迁移、事务和幂等摘要基础可持久化并在重启后重开 | `WP-R1-04` | `WP-R1-05` | `A-DATA-001` | `TEST-DATA-001`, `TEST-DATA-002`, `TEST-DATA-003`, `TEST-DATA-005` | `Done` |
| `WP-R2-02` | 首次 setup 可创建并选择当前学期，重启后保持稳定身份 | `WP-R2-01` | — | `A-TERM-001`, `A-TERM-002` | — | `Done` |
| `WP-R2-03` | 用户可创建课程和首个 meeting，并保留课程核心字段与 TBA 区分 | `WP-R2-02` | — | `A-COURSE-001`–`A-COURSE-004` 的创建/首个 meeting 切片 | `TEST-PLAN-001`, `TEST-PLAN-002`, `TEST-PLAN-007`, `TEST-DATA-001`–`TEST-DATA-006` | `In Progress` |
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
| Windows x64 构建/安装主机 | 构建主机已验证、安装环境未验证（2026-08-22：Windows 11 `10.0.26200` / build `26200` / `AMD64` 从 clean commit `cd3a2fd66bca0fbd7e51c9eadef4dac1393484a2` 完成 package、packaged smoke 与可见窗口启动/退出；未执行 WiX 安装、干净机器或 SAC-On 验证） | 记录 OS/架构，并实际运行打包与安装烟测 | `WP-R1-05`, `WP-R12-01`, `WP-R12-05` |
| macOS arm64 构建/安装主机 | 构建主机已验证、安装环境未验证（2026-08-23：macOS `26.5.2` / build `25F84` / `arm64` / `Mac15,12` 从同一 clean commit `cd3a2fd66bca0fbd7e51c9eadef4dac1393484a2` 完成 package、packaged smoke 与可见窗口启动/退出；未执行 Developer ID 签名、公证、DMG 安装或 Gatekeeper 验证） | 记录 OS/架构，并实际运行打包与安装烟测 | `WP-R1-05`, `WP-R12-01`, `WP-R12-04` |
| Apple Developer ID 与 notarization | 未验证（2026-08-22：未在 macOS 对候选制品执行 Developer ID 签名、notarize、staple 或 Gatekeeper 检查） | 候选制品签名、notarize、staple 和 Gatekeeper 验证通过 | `WP-R12-04` |
| Windows 代码签名能力 | 未验证（2026-08-22：当前 development package 未签名且只在保持 SAC Off 的开发环境运行；未对 WiX 制品执行证书签名、SAC-On 或干净机器验证，当前主机未发现 `signtool`） | WiX 制品签名和干净机器验证通过 | `WP-R12-05` |
| GitHub Releases 发布权限 | 未验证（2026-08-22：`gh auth status` 已确认登录，但未实际创建候选 Release、上传资产/manifest 或重新下载） | 能创建候选 Release、上传资产/manifest 并从公开端重新下载 | `WP-R12-06` |
| 旧版 → 新版安装/迁移条件 | 未验证（2026-08-22：尚无精确旧/新候选制品、独立测试数据或完整升级/迁移矩阵） | 保留精确旧候选制品与独立测试数据，完整升级/迁移矩阵通过 | `WP-R12-03` |
| 新版 → 精确旧版回退条件 | 未验证（2026-08-22：尚无精确兼容制品、迁移安全副本或独立回退测试数据） | 精确兼容制品、迁移安全副本和独立测试数据齐备并通过 | `WP-R12-03` |

工具和依赖版本的复核结果也由 `WP-R0-03` 记录，但最终发布候选必须在 `WP-R12-04`/`05` 再次按 ADR-10 复核，不能沿用过期查询。

## 6. 证据台账

每次状态变化在下表追加一行；不得覆盖失败或未验证事实。

| 日期 | WorkPacket | 状态变化 | 提交/制品 | 实际运行的验证 | 结果与未验证项 |
|---|---|---|---|---|---|
| 2026-08-21 | `WP-R0-01` | `— → Ready` | Roadmap 基线提交 | 文档链接、ID/计数、`git diff --check` | 等待执行 R0 产品校准 |
| 2026-08-22 | `WP-R0-01` | `Ready → In Progress` | 本工作包 | `rg -n "GAP-PRODUCT-01|固定浅色|外观预留|六个主导航|六项主导航|临近截止|即将到期" docs/product docs/superpowers/specs/2026-08-18-courseflow-ui-wireframes-page-spec-design.md docs/architecture/MODULE_CONTRACTS.md` | 命中 `GAP-PRODUCT-01` 的未定义 near-due 阈值、UI 的三处固定浅色/外观预留位和六个主导航；开始产品语义校准。 |
| 2026-08-22 | `WP-R0-01` | `In Progress → Done` | `23497eaed1e1b2924fb75326bb925e28986730be` (`docs: calibrate first release profile`)；后续验收修正 `b688645d578499a33e362a41024a60f49e3f25bf` (`docs: clarify near-due acceptance`) | `rg -n "today \+ 1|today \+ 7|today \+ 8|TermZone|61 条|19 个|Today.*Courses.*Calendar.*Tasks.*Files" docs/product/PRD.md docs/product/MVP_SCOPE.md docs/superpowers/specs/2026-08-18-courseflow-ui-wireframes-page-spec-design.md`；`rg -n "固定浅色|外观预留|六个主导航|六项主导航" docs/superpowers/specs/2026-08-18-courseflow-ui-wireframes-page-spec-design.md`；`git diff --check`；`git diff -- docs/product docs/superpowers/specs docs/roadmap/BACKLOG.md` | 首条命中 near-due 全部边界、61/19/5 与五项导航；第二条无输出（exit 1，表示无残留）；`git diff --check` 通过且最终 diff 已审阅，确认仅更新产品/UI 语义所有者和 Backlog，五个 `UI-GRADE-*` 页面仍保留且标为 C1 未来设计。 |
| 2026-08-22 | `WP-R0-02` | `Ready → In Progress` | 本工作包 | `rg -n "待用户审阅书面规格|候选架构基线|候选规范|GAP-PRODUCT-01|24 个正式页面|24 个 UI 表面" docs/superpowers/specs/2026-08-17-user-flow-design.md docs/architecture` | 命中三份待终审状态、开放 `GAP-PRODUCT-01` 和首发验收硬编码 24 个表面；开始实现基线与首发追溯校准。 |
| 2026-08-22 | `WP-R0-02` | `In Progress → Done` | `913a60dd99cf606db8efcf0ae8d2d6205199cf3b` (`docs: approve implementation baseline`)；后续契约修正 `0122ab2398aa4714657e79753a7d644d8bdab5f7` (`docs: clarify release profile contracts`) | `rg -n "已批准实现基线|首发 19|完整.*24|GAP-PRODUCT-01.*已解决" docs/superpowers/specs/2026-08-17-user-flow-design.md docs/architecture`；`rg -n "候选架构基线|候选规范|待用户审阅书面规格|24 个正式页面只使用" docs/superpowers/specs/2026-08-17-user-flow-design.md docs/architecture`；稳定 ID 前后集合比较；`git diff --check` | 首条定位三份已批准状态、已解决 GAP、首发 19 / 完整设计 24；第二条无输出（exit 1，表示无旧状态或旧首发硬编码）；User Flow/Architecture/Contracts 的稳定 ID 集合分别保留 38/56/264 项；`git diff --check` 通过。 |
| 2026-08-22 | `WP-R0-03` | `Ready → In Progress` | 本工作包 | `Get-Command node,npm,pnpm -ErrorAction SilentlyContinue`；临时添加 Workspace dependency runtime 的 Node `bin` 后运行 `node --version`、`pnpm --version`、`git --version`、`[System.Environment]::OSVersion`、`$env:PROCESSOR_ARCHITECTURE`；`Get-Command signtool,codesign,notarytool,gh -ErrorAction SilentlyContinue`；`gh auth status` | 初始 PATH 只有 Workspace runtime 的 `pnpm`，没有 `node`/`npm`；临时 runtime 得到 Node `v24.19.0`、pnpm `11.19.0`、Git `2.55.0.windows.4`、Microsoft Windows NT `10.0.26200.0`、`AMD64`。仅发现 `gh`；已登录状态不是候选 Release 创建/上传/重新下载证据，未将其推断为发布权限。 |
| 2026-08-22 | `WP-R0-03` | `In Progress → Done` | 本工作包 | 运行 10 条指定 `pnpm view` 查询（Electron `43.4.1`、Forge CLI/Vite `7.11.2`、React/React DOM `19.2.8`、TypeScript `7.0.2`、Vite `8.2.2`、`@types/node` `24.13.3`、`@types/react` `19.2.18`、`@types/react-dom` `19.2.4`）；查阅 [Electron releases](https://releases.electronjs.org/)、[Forge Vite plugin](https://www.electronforge.io/config/plugins/vite)、[utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)、[parentPort](https://www.electronjs.org/docs/latest/api/parent-port)、[Node test runner](https://nodejs.org/api/test.html) 和 [Node SQLite](https://nodejs.org/api/sqlite.html)；`git diff --check` | 全部精确版本可解析。Registry：Electron `>=22.12.0`/MIT；Forge CLI `>=16.4.0`/MIT；Forge Vite 无 peerDependencies/MIT；React/React DOM MIT；TypeScript `>=16.20.0`/Apache-2.0；Vite `^20.19.0 || >=22.12.0`/MIT；Node `24.19.0` 满足所有已声明 engine。官方资料确认 Electron `43.4.1` 为 stable、Forge Vite 构建 main/renderer、`utilityProcess`/`parentPort` 支持主进程与 utility 通信、`node:test` 稳定、`node:sqlite` 为 RC；资源矩阵按实际证据更新，macOS、签名、Release、升级和回退 Gate 仍开放。 |
| 2026-08-22 | `WP-R1-01` | `Ready → In Progress` | 本工作包 | `Test-Path package.json`；`Test-Path pnpm-lock.yaml` | 均为 `False`，证明尚无实现工具链；开始建立精确锁定的最小桌面工具链。 |
| 2026-08-22 | `WP-R1-01` | `In Progress → Blocked` | 未提交 | `pnpm exec tsc --ignoreConfig --noEmit --target ES2023 --module ESNext --moduleResolution Bundler --types node build/read-development-build-id.ts forge.config.ts vite.node.config.ts vite.renderer.config.ts`；检查 `@electron-forge/plugin-vite@7.11.2` 的 `src/Config.ts`、`src/ViteConfig.ts` | 简报强制的 `{ entry: 'src/workspace.ts', config: 'vite.node.config.ts', target: 'workspace' }` 与精确锁定的 Forge Vite `7.11.2` 不兼容：其类型只允许 `main`/`preload`，运行时对 `workspace` 直接抛出 `Unknown target`。不能在不改变锁定版本、配置语义或添加不安全类型断言的情况下通过配置编译；等待上游澄清。 |
| 2026-08-22 | `WP-R1-01` | `Blocked → In Progress` | 未提交 | pnpm `11.19.0` CHANGELOG、`@electron-forge/plugin-vite@7.11.2` 的 `Config.ts`/`ViteConfig.ts`；干净重装后的 `pnpm config get --location project --json nodeLinker/saveExact/blockExoticSubdeps`；配置编译门 | 根因已裁定并单变量验证：pnpm 11 只从 workspace YAML 读取 linker/save 策略；Forge Vite 的 Workspace entry 使用 `main` Node/Worker 模板。`nodeLinker: hoisted` 恢复 `@electron-forge/shared-types` 可见性。`blockExoticSubdeps: false` 为整个 workspace 关闭 exotic transitive dependency 拦截；当前锁文件唯一此类条目是 Forge 固定 commit 的官方 `@electron/node-gyp` tarball，任何未来依赖或锁文件变更都必须重新审查 exotic sources；配置编译通过。 |
| 2026-08-22 | `WP-R1-02` | `Ready → In Progress` | 本工作包 | 创建 bootstrap DTO 的失败测试 | 开始定义 `IF-WORKSPACE` bootstrap Query 的最小只读 DTO；尚未实现 production code。 |
| 2026-08-22 | `WP-R1-01` | `In Progress → Done` | `build: establish desktop toolchain` | `pnpm install --frozen-lockfile`；`pnpm list --depth 0`；`pnpm exec tsc --version`；`pnpm exec electron --version`；三个 `pnpm config get --location project --json`；修正后的配置编译门；禁止直接依赖核对；`git diff --check` | 冻结安装、顶层精确版本、pnpm workspace 策略、配置编译与禁止依赖核对均通过。未运行完整 `pnpm typecheck`/`pnpm package`：Task 5 尚未创建 Main/preload/renderer 入口；未验证 Vite generator（本机 Application Control 阻断 rolldown 原生绑定）、Windows/macOS 打包/安装、签名与发布资源，未将这些事项推断为已通过。 |
| 2026-08-22 | `WP-R1-02` | `In Progress` | 未提交 | 新基线 `74e95a3` 上先运行 `pnpm test`（RED：仅缺少 `src/shared/bootstrap-contract.ts`）；实现后运行 `pnpm test`、`pnpm typecheck`、`git diff --check` | Task 4 的 `build: use supported Node test resolution` 已消除先前 TS5108；bootstrap 契约 4/4 测试通过，完整类型检查和 diff 检查通过。工作包保持 In Progress，尚未验证开发/打包壳、Windows/macOS 或签名资源。 |
| 2026-08-22 | `WP-R1-02` | `In Progress → In Progress` | 本工作包 | 新增 Renderer/Main 静态架构边界测试，待运行 RED | 领取安全 desktop shell 切片；测试将分别捕获 Renderer 重新获得 Node/Electron/IPC/路径能力，以及 Main 取消窗口隔离、sandbox 或关闭 Node integration 的回归。 |
| 2026-08-22 | `WP-R1-02` | `In Progress → Done` | Windows package `out/CourseFlow Dev-win32-x64/CourseFlow Dev.exe` | `pnpm test`（6/6）；`pnpm typecheck`；`pnpm package`；启动 packaged EXE（PID 35760，窗口标题 `CourseFlow`）并通过该 PID 正常关闭 | 当前 Windows x64 package/launch 已验证，无开发服务器启动；Renderer 静态边界和 Main 窗口安全设置受测试保护。macOS、安装、签名、发布及 Workspace utility/Query 仍未验证或未实现；`WP-R1-03` Ready。 |
| 2026-08-22 | `WP-R1-02` | `Done → In Progress` | 独立审查 round 1/5；上游 `98bcf7d` | 审查发现先前 packaged 证据只验证窗口 handle/title，未验证 asar 内 renderer 内容；且缺少 ADR-01 CSP、navigation/new-window/permission 硬化，原顶层 Renderer 守卫不能覆盖嵌套或所有导入形式 | 原 Done 证据被审查推翻并重开。本轮先在测试/计划中登记 RED 和修复门；`98bcf7d` 已修正 renderer output layout，仍须以本轮 package 的 asar 清单和真实窗口内容复验，`WP-R1-03` 在验收前不 Ready。 |
| 2026-08-22 | `WP-R1-02` | `In Progress → Done` | Windows x64 package / asar / 内容 QA | `pnpm test` 10/10、`pnpm typecheck`、`pnpm package`；实际 `app.asar` 清单含 Main/preload、`main_window/index.html`、renderer CSS/JS，并与 Main loadFile、Forge name、Vite outDir 一致；无 dev server 的 handle 截图实际显示三项壳文案 | 审查重开项已修复：CSP、navigation/new-window/session permission 拒绝和递归 AST Renderer 边界均受测试保护，nested side-effect import mutation 确认会失败。截图 run 的 PID `9928` 在关闭调用前已退出；独立有界关闭 smoke PID `17904` 的 `CloseMainWindow()` 返回 True、无残留精确 EXE 进程。仅当前 Windows x64 证据；不推断 macOS、安装、签名或发布。`WP-R1-03` 恢复 `Ready`。 |
| 2026-08-22 | `WP-R1-03` | `Ready → In Progress` | 本工作包 | 新增 Workspace supervisor 与进程边界测试，待运行 RED | 开始单一 Workspace utility process、精确 bootstrap handshake 和窄 Renderer capability 切片；不实现 SQLite、真实数据根或重启策略。 |
| 2026-08-22 | `WP-R1-03` | `In Progress → Done` | Windows x64 package `out/CourseFlow Dev-win32-x64` | `pnpm test` 16/16；`pnpm typecheck`；`pnpm package`；`rg -n 'utilityProcess\\.fork' src` 仅 Main 一处；Renderer 特权 IPC/import query 无命中 | Main/preload 使用 shared `WORKSPACE_QUERY_CHANNEL`，Renderer 只使用冻结 query capability；supervisor 覆盖 ready、malformed response、5 秒 timeout、child exit 和 dispose。Forge 产出 Workspace entry。打包 EXE 的真实 GUI handshake 未验证：Computer Use `ShellExecuteW` 错误 5，随后精确 EXE 启动被 Windows 应用控制策略阻断；不将其或 SQLite/真实数据根标为已验证。`WP-R1-04` Ready。 |
| 2026-08-22 | `WP-R1-03` | `Done → Blocked` | 独立审查 round 1/5；Windows application control | Electron `UtilityProcess.error` 处理测试 RED 后修复为 GREEN；现有 package asar 清单含 Main/preload/renderer/workspace，并嵌入 `development:c522feb87d9…`。已存在 Electron runtime 启动该精确 asar（PID `49408`）后无窗口/无子进程，随后仅停止该 PID | `error` 已安全收敛为 unavailable；但 asar runtime 入口未产生可见 ready/build handshake，不能视为最终 unsigned wrapper EXE 的等价启动。wrapper 的 Computer Use `ShellExecuteW` 错误 5 和精确 `Start-Process` 应用控制策略阻断仍在。mandatory GUI 证据未达成，故 WP-R1-03 Blocked、WP-R1-04 不得 Ready；未声称 SQLite/数据根。 |
| 2026-08-22 | `WP-R1-03` | `Blocked → Done` | Windows x64 final wrapper `out/CourseFlow Dev-win32-x64/CourseFlow Dev.exe`；截图 `.superpowers/sdd/2026-08-21-courseflow-r0-r1-implementation/task-7-packaged-handshake.png` | 用户手动关闭 Smart App Control 后，clean `38e177ad0ee565d2078d25b337715aecef57dd99` 的 `pnpm package` 通过；asar 含 Main/preload/workspace/renderer，三端 build ID 精确为 `development:38e177…` 且无 `:dirty`；Computer Use 从唯一最终 wrapper 窗口读取 `Workspace 进程已就绪` 和 `Build 38e177ad0ee5`，Alt+F4 后无残留 wrapper/utility 进程 | 真实最终 wrapper GUI handshake 已验证，先前 application-control blocker 被此证据取代；未将 unsigned/SAC compatibility 推断为发行签名验收，SQLite、真实数据根、macOS、安装和发布仍不在 WP-R1-03 已验证范围。`WP-R1-04` Ready。 |
| 2026-08-22 | `WP-R1-04` | `Ready → In Progress` | 本工作包 | 跨平台开发根、SQLite 版本和严格 probe DTO 测试已加入，待运行 RED | 仅实现开发根、单实例和内存 SQLite probe；不创建正式 DATA/schema/migration/文件数据库。 |
| 2026-08-22 | `WP-R1-04` | `In Progress → Done` | Windows x64 final wrapper `out/CourseFlow Dev-win32-x64/CourseFlow Dev.exe` | `pnpm test` 25/25、`pnpm typecheck`、`pnpm package` 均通过；真实 `--courseflow-smoke` stdout 恰有一个非空 JSON 行（其余仅 Electron pre-JS CRLF 空白）：`{"kind":"courseflow.smoke","ok":true,"appBuildId":"development:ee5a32169bc421b0fd07d69a2e501c548ce1aad4:dirty","sqliteVersion":"3.53.1","dataRootClass":"verified-local"}`、exit 0、stderr 空；正常模式 stdout 仅 Electron pre-JS `0D 0A` 空白（2 bytes）、stderr 空且 exit 0 | Main 在 ready 前仅创建 `CourseFlow Dev` 下 ActivityControl、DataSlots、Chromium/Session 开发根，设置开发 AppUserModelId 和单实例锁；probe 经真实 preload/IPC/utility/`node:sqlite` 内存连接返回版本与 `verified-local`，无路径进入 DTO。两次运行均无残留 exact wrapper/utility 子进程。当前 Windows unsigned 测试环境的 SAC 已由用户暂时关闭；这不是签名或 SAC compatibility 证据，后者仍属于 `WP-R1-05`/Task 9。macOS、签名、安装和发布仍未验证。`WP-R1-05` 与 `WP-R2-01` Ready（前者的平台/签名证据依赖仍开放）。 |
| 2026-08-22 | `WP-R1-05` | `Ready → In Progress` | 未提交 | 新增 `tests/architecture/runtime-boundaries.test.ts` 后运行 `pnpm test`（RED：34 项中 33 通过、1 失败） | 进程/Renderer/preload/BrowserWindow/依赖与开发身份边界全部通过；唯一失败为 `scripts/run-packaged-smoke.mjs must exist`，证明 smoke runner 尚未实现且 RED 原因精确。 |
| 2026-08-22 | `WP-R1-05` | `In Progress → Blocked` | clean source `812acba1b14cf72803ede651a19b160b82606466`；Windows x64 final wrapper `out/CourseFlow Dev-win32-x64/CourseFlow Dev.exe` | Windows 11 `10.0.26200` / build `26200` / `AMD64`；Node `v24.19.0`、pnpm `11.19.0`、Electron `v43.4.1`、SQLite `3.53.1`；`pnpm install --frozen-lockfile`、`pnpm test` 34/34、`pnpm typecheck`、`pnpm package`、`pnpm smoke:packaged` 均通过，runner 报 `PASS packaged smoke win32/x64 development:812acba1b14cf72803ede651a19b160b82606466 SQLite 3.53.1 verified-local`；独立 raw capture 为前置 `0D 0A` 空白、唯一非空 JSON 行、结尾 `0A`，exit 0/stderr 0 bytes；唯一可见 `CourseFlow` 窗口实际显示 ready、Build `812acba1b14c`、SQLite `3.53.1` 与开发数据根已验证，定向 Alt+F4 后窗口列表为空且 exact wrapper/utility process count 为 0 | Windows development package 的进程/隐私/启动/退出证据通过；唯一 R1 blocker 是没有真实 macOS arm64 主机和同 commit 实际结果。`WP-R2-01` 保持 `Ready`，但其 `WP-R1-05` evidence dependency 与最终 release Gate 保持开放。当前制品未安装、未签名且 SAC 保持 Off，不是公开候选；macOS 签名/notarization、Windows WiX/签名/SAC-On/干净机器及发布均未验证。 |
| 2026-08-22 | `WP-R1-05` | `Blocked → Blocked` | clean source `591542d3a27cabdd2c9b12b6049901dd5950076c`；Windows x64 final wrapper `out/CourseFlow Dev-win32-x64/CourseFlow Dev.exe`；可见窗口截图 `.superpowers/sdd/2026-08-21-courseflow-r0-r1-implementation/final-head-591542d-gui.png` | Node `v24.19.0`、pnpm `11.19.0`、Electron `v43.4.1`、SQLite `3.53.1`；root 在该 clean source 上 fresh 运行 `pnpm install --frozen-lockfile`、`pnpm test` 37/37、`pnpm typecheck`、`pnpm package`、`pnpm smoke:packaged` 均通过，runner 报 `PASS packaged smoke win32/x64 development:591542d3a27cabdd2c9b12b6049901dd5950076c SQLite 3.53.1 verified-local`；raw stdout 为 166 bytes，前缀 `0D 0A`，恰有一个非空 JSON 行，完整 build ID 精确为 `development:591542d3a27cabdd2c9b12b6049901dd5950076c`、不含序列化路径，stderr 为 0 bytes；截图已由 root 实际查看，显示 `CourseFlow`、`Workspace is ready`、Build `591542d3a27c`、SQLite `3.53.1` 与 verified development root；对 exact window 发送 `WM_CLOSE` 后 exit 0，正常模式 stdout 仅 `0D 0A`、stderr 为 0 bytes，最终 exact wrapper/utility process count 为 0 | 本行为追加证据，不覆盖 clean source `812acba1b14cf72803ede651a19b160b82606466` 的历史行。Task 9 仅覆盖 development platform 的进程/隐私/启动/退出/package smoke；macOS 签名/notarization 与 Windows WiX/签名/SAC-On/干净机器/安装/发布属于 `WP-R12-03`–`WP-R12-06`，均未验证。`WP-R1-05` 仍为 `Blocked`，唯一原因是缺少同一 source commit `591542d3a27cabdd2c9b12b6049901dd5950076c` 的真实 macOS arm64 结果；`WP-R2-01` 保持 `Ready` 且 evidence dependency 保持开放。该制品 unsigned、uninstalled 且 SAC 保持 Off，不是 public candidate。 |
| 2026-08-22 | `WP-R1-05` | `Blocked → Blocked` | clean source `cd3a2fd66bca0fbd7e51c9eadef4dac1393484a2`；Windows x64 final wrapper `out/CourseFlow Dev-win32-x64/CourseFlow Dev.exe` | Windows 11 `10.0.26200` / build `26200` / `AMD64`；Node `v24.19.0`、pnpm `11.19.0`、Electron `v43.4.1`、SQLite `3.53.1`；在该 clean source 上运行 `pnpm install --frozen-lockfile`、`pnpm test` 37/37、`pnpm typecheck`、`pnpm package`、`pnpm smoke:packaged` 均通过，runner 报 `PASS packaged smoke win32/x64 development:cd3a2fd66bca0fbd7e51c9eadef4dac1393484a2 SQLite 3.53.1 verified-local`；独立 raw stdout 为 166 bytes，前缀 `0D 0A`、恰有一个非空 JSON 行、结尾 `0A`，完整 build ID 精确为 `development:cd3a2fd66bca0fbd7e51c9eadef4dac1393484a2`、不含序列化路径，stderr 为 0 bytes；唯一可见 `CourseFlow` 窗口实际显示 Workspace 进程已就绪、Build `cd3a2fd66bca`、SQLite `3.53.1` 与本地开发数据根已验证；对 exact window 定向 Alt+F4 后 exit 0，正常模式 stdout 仅 `0D 0A`、stderr 为 0 bytes；最终 exact package process、fixture process 和 fixture temp directory count 均为 0 | 这是 drive-qualified Windows root 修复后的最新 Windows evidence，保留 clean source `812acba1b14cf72803ede651a19b160b82606466` 与 `591542d3a27cabdd2c9b12b6049901dd5950076c` 的历史证据。`WP-R1-05` 仍为 `Blocked`，唯一原因是缺少同一 source commit `cd3a2fd66bca0fbd7e51c9eadef4dac1393484a2` 的真实 macOS arm64 结果；`WP-R2-01` 保持 `Ready` 且 evidence dependency 保持开放。该制品 unsigned、uninstalled 且 SAC 保持 Off，不是 public candidate；macOS 签名/notarization 与 Windows WiX/签名/SAC-On/干净机器/安装/发布属于 `WP-R12-03`–`WP-R12-06`，均未验证。 |

| 2026-08-23 | `WP-R2-01` | `Ready → In Progress` | 本工作包 Task 1 | 新增 TEST-DATA-002 canonical digest golden vector 测试，待实现 `courseflow-canonical-json-v1` 与 SHA-256 digest | 先固定 canonical DTO、受限编码和 digest；不实现 DATA store/schema/迁移或后续工作包。 |
| 2026-08-23 | `WP-R2-01` | `In Progress → Done` | 完整 Task 1–6 source range `54a02f6857c3ec7862ece1e5d6d429f474ef222c`..`5b5bd2717b3311e1f7950550e5bc0703af01db77`；实现/修正 commits：`279061644595e24629c48e2837b41dd464f71820`、`787285dee8b0c83cae396d58bc0c2f48cec58d2c`、`df979838b43bed41358f2433775c95572486e048`、`15ecdb02c39fb44db66ba299e2bdf31bf3eb1a94`、`421c7c944e845d761b060b2bdafc6fec4b802349`、`ebf46bb660b1fd7dbdb8b2c94f7d26bca1bc7123`、`e0ba8c283bc47a9517a9b0713b0b53e33c8a2f45`、`b7907f92bb942b06076632eb88077423550761c7`、`621a42de43ce4cc9c71f74c8476de36a9547593e`、`fde1298d83764b3522ee10c9de244f340232043f`、`5b5bd2717b3311e1f7950550e5bc0703af01db77` | `pnpm test` 73/73 PASS（四个 `TEST-DATA-001`/`002`/`003`/`005` 均命名 PASS）、`pnpm typecheck` PASS、clean source 上 `pnpm package` Windows x64 PASS、`pnpm smoke:packaged` PASS：`PASS packaged smoke win32/x64 development:5b5bd2717b3311e1f7950550e5bc0703af01db77 SQLite 3.53.1 verified-local`；runner 验证唯一精确 smoke JSON、空 stderr、无路径/WorkspaceId/revision 字段泄露。schema level 1 且仅六张共同表：`workspace_state`、`setup_state`、`command_receipts`、`receipt_effects`、`durable_followups`、`protection_watermarks`。canonical `courseflow-canonical-json-v1` digest golden/replay、同 ID 不同语义拒绝、semantic pre-COMMIT failpoint 全不改变事实、post-COMMIT response loss 仅经 reopen/restart receipt 收敛、stale EntityVersion/queued writer snapshot 边界、read-only/recovery/wrong ID/missing manifest/FK/future/corrupt/nonempty-level-0 与无 reset 分类均通过。protocol v2 的 path-free `workspaceData` 只经单一 Workspace utility owner 集成；`node:sqlite` 仅 DATA schema/store，package/lockfile 无 diff、无 ORM/连接池（禁止扫描唯一 `protection_watermarks`/`term` 词法命中已人工排除）。`WP-R2-02` 因此 Ready；但 `WP-R1-05` 仍 Blocked，真实 macOS arm64 证据未验证，Done 不关闭最终双平台 release Gate，也不交付 C1/C2、未来模块、迁移、备份或恢复。 |
| 2026-08-23 | `WP-R2-01` | `Done → Done` | final-review fix `736bbb9eab70cb881f6112442749db24185de16f` | 先证实 `TEST-DATA-003` 64-bit exhaustion RED 为 0/3，再在修复后通过 focused 3/3、sqlite-data-store 26/26、`pnpm test` 76/76、`pnpm typecheck` 与 `git diff --check`；clean source `736bbb9eab70cb881f6112442749db24185de16f` 的 `pnpm package` Windows x64 PASS，`pnpm smoke:packaged` 报 `PASS packaged smoke win32/x64 development:736bbb9eab70cb881f6112442749db24185de16f SQLite 3.53.1 verified-local`；独立 scoped re-review 为 1 addressed / 0 open，Critical/Important/Minor 均无 | Revision 或 setup EntityVersion 到 `9223372036854775807` 时在任何事实写入前 rollback 并终止当前 DATA owner，queued/future 写拒绝且持久事实、receipt、follow-up 与 watermark 不变。该修正不改变 level-1 六表范围、DTO/digest/failpoint/open classification，不新增依赖、ORM、连接池、C1/C2、未来模块、迁移、备份或恢复；`WP-R2-02` 保持 Ready，`WP-R1-05` 的真实 macOS arm64 阻塞与 release Gate 仍开放。 |
| 2026-08-23 | `WP-R1-05` | `Blocked → Done` | clean source `cd3a2fd66bca0fbd7e51c9eadef4dac1393484a2`；macOS arm64 final wrapper `out/CourseFlow Dev-darwin-arm64/CourseFlow Dev.app` | macOS `26.5.2` / build `25F84` / `arm64` / `Mac15,12`；Node `v24.19.0`、pnpm `11.19.0`、Electron `v43.4.1`、SQLite `3.53.1`；在隔离 worktree 的该 clean source 上运行 `pnpm install --frozen-lockfile`、`pnpm test`（36 pass、0 fail、1 个 Windows 专属 skip）、`pnpm typecheck`、`pnpm package`、`pnpm smoke:packaged` 均通过，runner 报 `PASS packaged smoke darwin/arm64 development:cd3a2fd66bca0fbd7e51c9eadef4dac1393484a2 SQLite 3.53.1 verified-local`；正常模式以 `open -n` 启动同一 app，CoreGraphics 观察到 owner `CourseFlow Dev` 的 layer 0 on-screen 窗口 `CourseFlow`，随后通过应用 quit 正常退出，最终 exact wrapper/helper process count 为 0 | macOS 与既有 Windows x64 证据绑定同一 clean source commit，进程/隐私/启动/退出/package smoke 的双平台 R1 Gate 因此关闭。当前 app unsigned、unnotarized、uninstalled，不是 public candidate；macOS 签名/公证/DMG、Windows WiX/签名/SAC-On/干净机器、安装、迁移/回退与发布继续由 `WP-R12-03`–`WP-R12-06` 验证。屏幕捕获权限与 Accessibility 未授予自动化进程，因此没有把截图像素或辅助功能树内容列为证据；真实 on-screen window、完整 smoke handshake 与无残留进程均已独立观察。 |

| 2026-08-23 | `WP-R2-02` | `Ready → In Progress` | 本工作包 | 新增 Term DTO、DATA、迁移和 Workspace restart 测试后运行 `pnpm run clean:test`、`pnpm run test:compile`（RED，exit 2） | 测试编译精确失败于尚不存在的 `workspace-term-contract`、`WorkspaceApplication`、`openWorkspaceDataWithMigrations` 与 `readSetupProjection`；开始首次 setup 当前学期纵向切片，未实现课程、meeting 或完整导航。 |
| 2026-08-23 | `WP-R2-02` | `In Progress → Done` | clean implementation source `c14310457052ef1f27ab7a9bb0f32f6478b187e1`；Windows x64 package `out/CourseFlow Dev-win32-x64` | Windows 11 `10.0.26200` / build `26200` / x64；Node `v24.19.0`、pnpm `11.19.0`、Electron `v43.4.1`、SQLite `3.53.1`；targeted 52/52 PASS；`pnpm test` 101/101 PASS；`pnpm typecheck`、`git diff --check`、clean source `pnpm package` 均 PASS；`pnpm smoke:packaged` 报 `PASS packaged smoke win32/x64 development:c14310457052ef1f27ab7a9bb0f32f6478b187e1 SQLite 3.53.1 verified-local` | level 2 仅交付 Term/Current Term：规范化名称/LocalDate/IANA zone、随机稳定 TermId、唯一 current、同一 ReadSnapshot、Revision/plan EntityVersion、canonical digest/receipt/follow-up/watermark 和 pre/post-COMMIT 收敛均有证据；level 1 receipt/follow-up 经已验证 safety copy 和独立事务迁移保留，迁移中断不重建/重置；read-only/recovery 拒绝写入。首次 setup UI 只经冻结 preload capability → Main → 单一 Workspace utility → DATA，DTO/Renderer 无数据库、路径、Node/Electron/platform 类型。未实现课程、meeting、完整 Today/导航、深色模式或后续模块；macOS 本轮未重新打包/烟测，不从既有平台证据推断本提交通过。dirty source 的首次 smoke 尝试按 clean build ID 门禁被预期拒绝，随后在上述 clean implementation source 重新 package/smoke 通过。 |
| 2026-08-23 | `WP-R2-02` | `Done → Done` | clean implementation source `c14310457052ef1f27ab7a9bb0f32f6478b187e1` 的 Windows x64 packaged app；隔离的临时 `LOCALAPPDATA` | 真实可见窗口通过键盘/日期选择器填写名称 `2026 Fall`、`2026-09-08`、`2026-12-19`、`America/Toronto` 并执行“创建并继续”；完成面显示 canonical UUID `TermId`。关闭窗口、确认无 CourseFlow 窗口后，以同一隔离数据根重新启动；名称、日期、时区与同一个 `TermId` 逐字一致 | packaged Renderer → preload → Main → Workspace → DATA 的首次设置和进程重启持久化取得实际 Windows E2E 证据；没有触碰既有开发数据根。macOS packaged 交互 E2E 仍未在本提交上执行。 |
| 2026-08-23 | `WP-R2-03` | `— → Ready` | `WP-R2-02` clean implementation source `c14310457052ef1f27ab7a9bb0f32f6478b187e1` | `WP-R2-02` registry/证据已为 `Done`；`WP-R2-03` 无额外证据依赖 | `WP-R2-03` 成为唯一 `Ready` 工作包；课程与 meeting 仍未实现。 |
| 2026-08-23 | `WP-R2-03` | `Ready → In Progress` | 本工作包 | Course/首个 Meeting 的 contract、DATA、迁移、Workspace 与 setup UI 失败测试待写入和运行 | 开始当前学期下 Course 与首个 Meeting 的原子持久化纵向切片；不实现 occurrence、规则分段、冲突检测、假期 skip、Today/Calendar 或完整导航。 |
| 2026-08-23 | `WP-R2-03` | `In Progress → In Progress` | TDD RED | `pnpm run clean:test` 后 `pnpm run test:compile` exit 2：缺少 `workspace-course-contract`，`SetupProjection.courses` 与 Course/Meeting 双 effect command 类型尚不存在；随后定向 `setup-ui.test` 为 1 pass / 1 fail，精确失败于缺少课程字段和 `createCourseWithMeeting` UI capability | RED 先固定 PLAN/DATA/schema/Workspace/IPC/UI 义务，再在共同语义所有者处实现；未用模拟数据或扩大到 occurrence/分段/冲突/假期。 |

## 7. 拆包与变更规则

- 工作包过大时可以拆成带稳定后缀的子包，但父包在全部子包 `Done` 前不得 `Done`，且 Requirement/TEST 主所有权必须保持唯一。
- 仅实现顺序、资源或证据安排变化时更新本文件和 Roadmap。
- 产品行为变化先更新 PRD/MVP；模块边界/FLOW/Q 变化先更新 Architecture；接口/Problem/TEST 变化先更新 Contracts；技术选择变化先建立或修订 ADR。
- 任何拆包都不得创建“通用框架”“未来扩展”“收尾”或 C1/C2 占位工作包。
