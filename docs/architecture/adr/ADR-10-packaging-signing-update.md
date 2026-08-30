# ADR-10：打包、签名、更新与平台发布

- 状态：已接受
- 日期：2026-08-21
- 决策主题：`ADR-TOPIC-10`
- 前置决策：[ADR-01](./ADR-01-desktop-runtime-ui-boundary.md)、[ADR-02](./ADR-02-process-thread-deployment.md)、[ADR-03](./ADR-03-sqlite-active-data-transactions.md)、[ADR-04](./ADR-04-schema-migration-compatibility.md)、[ADR-05](./ADR-05-library-watching-index-file-operations.md)、[ADR-06](./ADR-06-resource-preview-system-open.md)、[ADR-07](./ADR-07-snapshot-format-integrity-publication.md)、[ADR-08](./ADR-08-restore-activation-recovery.md)、[ADR-09](./ADR-09-no-production-diagnostics.md)
- 上游规范：[PRD](../../product/PRD.md)、[MVP_SCOPE](../../product/MVP_SCOPE.md)、[User Flow](../../superpowers/specs/2026-08-17-user-flow-design.md)、[UI 规格](../../superpowers/specs/2026-08-18-courseflow-ui-wireframes-page-spec-design.md)、[Architecture](../ARCHITECTURE.md)、[Module Contracts](../MODULE_CONTRACTS.md)
- 调研证据：[打包、签名、更新与平台发布一手资料研究](../../research/adr-10-packaging-signing-update-research.md)
- 讨论记录：[ADR-10 Superpowers 设计讨论](../../superpowers/specs/2026-08-21-adr-10-packaging-signing-update-design.md)

## 1. 背景

ADR-01–09 已确定 CourseFlow 的 Electron/React/TypeScript 桌面边界、单一 Workspace utility process、活动数据事务、schema/迁移、资料库、预览、备份、整库恢复以及“无生产诊断子系统”。第一个公开版本仍缺少最后一个跨切面闭环：如何把同一应用构建成用户实际安装的 macOS/Windows 制品，如何建立平台信任，手动更新时如何持续定位同一活动数据，以及前向 schema migration 后如何回到一个确切兼容版本。

这些问题不能留给安装脚本临时选择。安装位置、应用 ID、数据根、Electron/SQLite 版本、签名身份、ASAR/fuses、更新方式和 migration safety copy 生命周期都会改变 `FLOW-00`、`Q-PORTABLE-01`、`Q-EVOLVE-01`、`Q-CONTINUITY-01` 与数据恢复承诺。

本 ADR 决定：

- 公开平台、架构、版本身份、渠道和完整发布边界；
- Electron Forge 与 WiX v7 的职责；
- macOS Developer ID/公证和 Windows Authenticode；
- 稳定每用户应用数据位置及安装器所有权；
- migration safety copy 的保留、删除与精确版本回退；
- 正式包 ASAR/fuses、内容和调试/运行时下载边界；
- release manifest、受控原生主机、人工上传与重新下载验证。

本 ADR 不实现自动更新、商店发布、额外架构、签名 CI、远程 release service、账户、日志、诊断、遥测或支持包，也不授权开始应用实现或实际发布。

### 1.1 追溯边界

- Requirement：`A-DATA-001/002/005/007`、`A-PLATFORM-001–004`、`STATE-002/007`、`NFR-001–003/006/007/012`、`MVP-DOD-005–009`、`NG-018/019`；
- User/UI：`UF-A-01/07/09`、`UI-ENTRY-01`、`UI-DATA-01/02/03`；
- Module：`MOD-SHELL`、`MOD-WORKSPACE`、`MOD-PROTECT`、`MOD-DATA`、`MOD-LIBRARY`、`MOD-PLATFORM`；不新增 UPDATE/RELEASE 模块；
- Interface：`IF-WORKSPACE`、`IF-DATA-MIGRATION`、`IF-DATA-STAGE-ACTIVATE`、`IF-PROTECT-MIGRATION-ROLLBACK` 与窄平台位置/文件系统能力；
- Flow：`FLOW-00/03/05/07`；
- Quality：`Q-TRUTH-01`、`Q-PROTECT-01`、`Q-LOCAL-01`、`Q-ACCESS-01`、`Q-PORTABLE-01`、`Q-EVOLVE-01`、`Q-CONTINUITY-01`、`Q-DIAG-01`、`Q-RELEASE-01`、`G4/G6/G7/G8`；
- Test：`TEST-RELEASE-001–005`、`TEST-DATA-006/007`、`TEST-PROTECT-005/007`、`TEST-WORKSPACE-005/007`、`TEST-SHELL-005`、`TEST-PLATFORM-002/004/005`、`TEST-PRIVACY-001` 与两个平台的 packaged E2E。

### 1.2 First Principles 不变量

1. 正式结构化数据和真实资料库是本地真相；安装器、GitHub 和 release manifest 都不是活动数据源。
2. 用户必须能在没有账户、远程后端、更新服务或联网启动的条件下使用应用。
3. 安装器只拥有程序制品；活动数据、资料库、备份、安全副本和 ActivityControl 状态由应用内相应 owner 管理。
4. Main、Renderer 与 Workspace utility process 只能来自同一 exact `appBuildId`，不支持 mixed build。
5. 前向 migration 在任何 schema 写入前必须产生已关闭、可重新验证的安全副本；该副本无条件产生，绑定精确回退版本是可选事实，只有当前构建携带已发布的兼容前置版本时才成立。旧应用不得猜读已升级数据。
6. 公开制品必须由目标平台原生构建、签名并以最终安装形态验证；签名、公证或任一平台失败时不存在部分发布或 unsigned fallback。
7. 生产应用不检查、下载或安装更新，不创建诊断/日志/崩溃/遥测数据面，也不在首次启动下载运行时二进制。
8. 只有最终公开资产重新下载并再次验证后，版本才达到发布成功边界。

## 2. 决议摘要

CourseFlow v1 采用**外部手动更新 + GitHub Releases 唯一渠道 + 双平台原生受控构建 + 平台签名/公证 + 稳定每用户数据根 + 最近一份 migration safety copy + exact-build 显式回退 + 人工发布后复核**：

1. 正式应用 ID 永久固定为 `io.github.siruimei07.courseflow`。
2. 公开版本使用 `MAJOR.MINOR.PATCH` 和 `vMAJOR.MINOR.PATCH` tag；`appBuildId` 绑定版本与完整 Git commit。
3. v1 公开制品仅有 macOS arm64 DMG 与 Windows 11 x64 MSI；每次发布冻结当时最新稳定 OS 的精确 build 和参考设备。
4. GitHub Releases 是唯一公开渠道；应用没有 updater、feed、检查、下载或安装入口。
5. macOS 使用 Electron Forge 打包、嵌套签名和 arm64 DMG；Windows 使用 Forge packaged app + 最小自有 WiX Toolset SDK v7 MSI。
6. Windows MSI 是 x64 per-machine Program Files 安装，使用稳定 UpgradeCode、每版新 ProductCode、major upgrade、直接 downgrade 阻断且无 custom action。
7. macOS 使用 Developer ID Application、Hardened Runtime、最小 entitlement、最终 DMG notarization/stapling；Windows 使用硬件隔离 OV Authenticode 对全部最终 PE 与 MSI 签名。
8. 每用户数据根固定在 Application Support/LocalAppData 的应用 ID 名称空间，安装器和卸载器不读写或删除它。
9. 只有真实前向 migration 才创建一份 safety copy；最多保留最近一份，直到下一次迁移替换或用户明确删除。
10. rollback 只允许 safety copy 绑定的最新已签名兼容 CourseFlow build；副本未绑定回退版本时不提供 rollback，只提供查看与显式删除。不做 reverse migration、任意 downgrade、dual write 或合并。
11. 正式应用代码进入 ASAR，启用 embedded ASAR integrity/only-load-from-ASAR，禁用 RunAsNode、NODE_OPTIONS 与 CLI inspect fuses；不从用户可写位置加载代码。
12. 两个平台嵌入 `BuildDescriptorV1`，最终制品由 `courseflow-release-manifest-v1.json` 绑定源提交、工具链、签名、平台证据、格式版本、回退目标与最终字节。
13. 签名和公证只在受控原生主机执行；GitHub Actions 只运行无秘密检查。
14. 用户把 DMG、MSI、manifest 手工上传到 draft release；重新下载验证后才公开。公开 tag/资产不可原地替换。
15. 所有可能作为 migration rollback target 的公开签名制品长期保留。

## 3. 发布身份、版本与平台矩阵

### 3.1 稳定身份

以下值从第一个公开版本开始不可静默改变：

| 用途 | 值/规则 |
|---|---|
| canonical repository | `https://github.com/siruimei07/Course-Flow.git` |
| public release channel | `https://github.com/siruimei07/Course-Flow/releases` |
| application ID | `io.github.siruimei07.courseflow` |
| macOS bundle ID | application ID |
| Windows AppUserModelID | application ID |
| stable data namespace | application ID |
| display name | `CourseFlow` |

Windows MSI `UpgradeCode` 在安装器工程建立时生成一次并永久冻结；它不是 application ID、WorkspaceId 或证书身份。Apple Team ID 与 Windows publisher subject 在首次签名发布前冻结并写入 release manifest；其改变触发 §19 的重新评审。

### 3.2 版本与 `appBuildId`

- 公共版本严格使用无 prerelease/build suffix 的三段 SemVer `X.Y.Z`。
- Git tag 固定为 `vX.Y.Z`，必须指向唯一完整 commit。
- macOS `CFBundleShortVersionString`、`CFBundleVersion` 和 Windows MSI `ProductVersion` 使用同一 `X.Y.Z`。
- production `appBuildId` canonical form 为 `io.github.siruimei07.courseflow/<X.Y.Z>/<40位小写十六进制commit>`。
- `appBuildId` 在 Main、Renderer、Workspace utility、`BuildDescriptorV1` 和 manifest 中逐字节一致；dirty worktree 不得生成 production build。
- 同一版本号或 tag 不得绑定第二个 commit；任何修复使用新 patch。

`appBuildId` 是同一安装包组件集合的精确握手值，不代替 schema level、snapshot format、certificate identity 或 WorkspaceId。

### 3.3 首发平台与支持声明

| Lane | 架构 | 公开制品 | 原生构建主机 |
|---|---|---|---|
| macOS | arm64 | `CourseFlow-<version>-macOS-arm64.dmg` | 受控 Apple Silicon Mac |
| Windows | x64 | `CourseFlow-<version>-Windows-x64.msi` | 受控 Windows 11 x64 主机 |

- 不发布 macOS Intel/universal、Windows arm64/ia32、zip/portable、PKG、MSIX、Squirrel 或 NSIS 变体。
- 每次 release freeze 重新确认当时最新公开稳定 macOS arm64 与 Windows 11 x64，记录精确 OS version/build、参考设备型号和验证日期；不记录序列号、用户名或本机路径。
- 支持声明只覆盖 manifest 中冻结的环境；旧 OS、Insider/beta OS、其他架构和未来 OS build 不被推断为已验证。
- 两个平台共享领域与 Workspace 契约，但拥有独立原生 build/sign/test lane。
- 任一 lane 未通过时，该版本整体不得公开。

### 3.4 版本基线与重新冻结

研究/开发基线：

| 组件 | 2026-08-21 基线 |
|---|---|
| Electron | 43.4.1 |
| Electron Forge | 7.11.2 |
| WiX Toolset SDK | 7.0.0 |

公开 release freeze 必须：

1. 重新查询并选择当时最新稳定 Electron patch，精确 pin，不使用范围或 `latest`；
2. 精确 pin Forge、WiX、Node package lock 和平台 SDK/toolchain；
3. 在最终 app 中读取实际 `process.versions.electron`、`process.versions.chrome`、`process.versions.node` 与 SQLite `sqlite_version()`，不从 package metadata 猜测；
4. 证明 SQLite 不低于 ADR-04 要求的 3.37.0 且全部 STRICT schema/migration/backup/restore 测试通过；
5. 任一 Electron/Chromium/Node/SQLite/Forge/WiX/SDK 变化都重跑全部 packaged gates，不复用旧结论。

WiX v7 的 OSMF 使用条件属于已接受的工具链约束；release freeze 仍须确认所使用版本的官方许可与支持状态。若不能继续接受，必须重新选择 Windows installer 技术并更新 ADR。

## 4. 稳定数据根与安装器所有权

### 4.1 production 每用户根

| 平台 | 稳定根 |
|---|---|
| macOS | `~/Library/Application Support/io.github.siruimei07.courseflow/` |
| Windows | `%LOCALAPPDATA%\io.github.siruimei07.courseflow\` |

根内固定一级名称空间：

```text
io.github.siruimei07.courseflow/
├── activity-control-v1/
├── data-slots-v1/
├── chromium-profile/
└── chromium-session/
```

- `ActivityControlRoot = activity-control-v1/`，由 PROTECT 按 ADR-08/10 管理，必须先于 DATA 打开可读。
- `DataSlotsParent = data-slots-v1/`，由 DATA 管理，并与 ActivityControlRoot 位于同一受支持本地卷。
- `chromium-profile/` 是 Electron/Chromium 非领域状态；`chromium-session/` 是可重建 session/cache 状态。二者不得成为课程、任务、成绩、资料库索引、备份或恢复事实源。
- 正式目录中不创建 diagnostics、logs、crashes、telemetry、support 或同义子目录。

应用必须通过平台 API 定位基址，在创建 BrowserWindow、Session、DATA 或 watcher 前设置 Electron `userData`/`sessionData` 路径并读回验证。实现还必须验证本地位置、重解析结果和 ActivityControlRoot/DataSlotsParent 同卷；无法证明时返回安全问题并停止普通 Workspace，不回退到 Documents、安装目录、Roaming AppData、LibraryRoot、backup destination 或用户自选目录。

### 4.2 development 隔离

- 非 production 构建使用 `io.github.siruimei07.courseflow.dev`、`CourseFlow Dev` 和完全独立的数据/Chromium根。
- production/dev 身份是构建期常量，运行时参数、环境变量或设置不能切换。
- dev/unsigned build 不得打开、迁移、备份、恢复或清理 production 根。
- production release candidate 只在受控干净测试账户/设备上验证，不以开发者个人 production 数据作测试夹具。

### 4.3 macOS 安装边界

- DMG 只承载签名的 `CourseFlow.app` 和必要展示资源；用户手动复制到 `/Applications`。
- 应用替换不改变每用户数据根。
- v1 不提供 PKG、安装 daemon、LaunchAgent、登录项、自启动或卸载工具。
- 删除 `/Applications/CourseFlow.app` 不删除用户数据；用户数据清理只能由后续明确产品动作决定，当前不提供自动清除。

### 4.4 Windows MSI 边界

- x64、per-machine、`Program Files` 安装，需要 UAC/管理员授权；同一机器所有用户共享应用版本，每个用户使用独立 LocalAppData。
- MSI 只拥有程序文件、快捷方式和 Add/Remove Programs 登记。
- 稳定 UpgradeCode + 每版新 ProductCode + major-upgrade 语义；允许升级，阻止在现有新版仍安装时直接 downgrade。
- 不使用 custom action 执行应用数据迁移、清理、网络下载、启动应用或自定义脚本。
- uninstall 只删除 MSI 拥有的资源，保留全部每用户数据、LibraryRoot、BackupSet、RestoreSafetySet、migration safety copy 和 ActivityControl 状态。
- CourseFlow 不生成自有 installer log；Windows Installer/操作系统自行维护的系统记录不成为 CourseFlow 产品数据。

## 5. 更新后启动与 migration safety copy

### 5.1 启动顺序

手动替换/升级应用后，Main 必须按固定顺序启动：

1. 解析并验证 production identity、稳定根、ActivityControlRoot 与 DataSlotsParent；
2. 由 PROTECT 在打开 DATA、解释 LibraryRoot 或启动 watcher 前检查 ADR-08 Restore activation 与 ADR-10 MigrationRollback handoff；
3. 若存在 nonterminal operation，按 owner evidence 路由 maintenance/recovery，不打开普通 Workspace；
4. Main 与 Workspace utility 完成 exact protocol/`appBuildId` 握手；
5. DATA 检查 application ID、当前 schema level、格式、完整性、可写性和支持范围；future/unknown 立即停止；
6. current schema 无需 migration 时正常重开，不创建 safety copy；
7. supported old schema 需要 migration 时，先创建并完整验证 safety copy，再逐级执行 ADR-04 forward migration；
8. migration 后关闭/重新打开 DATA，复核 schema、WorkspaceId、Revision、完整性、FK、manifest 与当前 build；
9. LIBRARY 对现存根执行必要的全量扫描/FileId 对账，随后完成 `FLOW-00` 路由。

安装器不参与任何一步。涉及真实 Library marker、路径或物理布局变化的升级仍必须使用 ADR-08 跨资源 staged activation，不得伪装成普通 DB migration。

### 5.2 `MigrationSafetyCopyV1`

Migration safety copy 是 DATA 拥有的关闭结构化数据保护对象：

- 使用 ADR-03 一致 checkpoint seam 生成原先不存在的完整 DataSlot/DB copy；完成 WAL checkpoint、statement/iterator/backup/validator drain、sync/close 后再验证。
- 它不包含 Library 文件，不是 BackupSet snapshot、RestoreSafetySet、用户导出或诊断副本。
- 它拥有稳定 `MigrationSafetyCopyId`，物理路径不是身份。
- 它只在至少一个 schema level 将被写入时创建；应用代码、UI 或 Chromium 更新不创建。
- 创建期间旧 safety copy 保持不变；新 copy 和 metadata 全部写入、sync、关闭、重开并验证后，才允许原子登记新 copy 并清理旧 copy。

封闭 metadata 至少包含：

| 字段 | 用途 |
|---|---|
| format/limits/digest version | hostile validation 与未来停止 |
| MigrationSafetyCopyId | 稳定引用 |
| WorkspaceId、source Revision | 确认原始数据身份 |
| source schema level | 选择能打开它的 release |
| createdAt、byte size | 用户影响和容量 |
| closed DataSlot SHA-256 | 重新验证精确副本；只检测变化/损坏，不宣称认证 |
| createdBy appBuildId | 证明创建协议版本 |
| rollback releaseVersion/tag/appBuildId | 唯一允许目标 build |
| per-platform artifact name/SHA-256 | 让用户识别精确公开制品 |

不得加入 stack、raw error、路径 dump、课程/文件名称、任意 map 或问题历史。

### 5.3 保留与用户动作

- 每个 production 数据根最多保留最近一份已验证 safety copy。
- 保留到下一次 migration 的新 copy 完整替换，或用户在 `UI-DATA-01` 明确删除。
- 没有按天数、版本数、启动次数、空间阈值或后台任务自动清理。
- 删除前说明将失去该 migration 的应用版本回退能力；删除只在副本身份和当前状态仍匹配时执行。
- 删除失败保持副本与状态，不报告已删除。
- safety copy 损坏/缺失时不得提供 rollback；当前已迁移数据不受影响，并返回安全 StructuredProblem。

## 6. 精确版本回退协议

### 6.1 语义所有权

- DATA 拥有 safety copy 验证、schema、DataSlot、当前/回退槽位和物理同卷切换。
- PROTECT 拥有 `MigrationRollbackSessionV1`、impact preview、确认、ActivityControlRoot handoff、全局维护互斥与 allowed actions。
- WORKSPACE 拥有 maintenance/recovery mode、epoch 失效、exact-build 分类和启动路由。
- LIBRARY 不移动或删除真实文件；回退完成时按安全副本中的旧索引/映射与当前磁盘事实全量对账。
- PLATFORM 只提供 location assessment、sync/close 与同父/同卷 rename 等窄能力，不解释回退阶段。
- SHELL 只看到 `MigrationRollbackPreview/Status`、OperationHandle、StructuredProblem 和 allowed actions。

不新增 `MOD-UPDATE`、`MOD-RELEASE` 或第二套通用恢复模块。MigrationRollbackSession 不是 RestoreSession，但与 ADR-08 RestoreSession/activation 共用 PROTECT 对 ActivityControlRoot 的唯一所有权和全局互斥：任一会切换活动 DATA 的 nonterminal operation 存在时，另一项不能开始。

### 6.2 rollback target mapping

每个可能执行 forward migration 的 production build 必须在内嵌 release descriptor 中提供封闭、版本化映射：

```text
source schema/format set
  -> newest signed compatible releaseVersion
  -> exact target appBuildId/tag
  -> macOS/Windows artifact name + SHA-256
```

- 目标必须是能原生打开 source schema、实现 `MigrationRollbackHandoffV1` reader 且仍在 GitHub Releases 保留的最新已签名 CourseFlow release。
- 第一个公开 release 即实现 V1 reader，即使当时没有可回退前代。
- 未来 handoff V2 若仍需回退到 V1 target，写入方必须生成严格 V1 core；不得要求旧 target 忽略未知键或猜测新字段。
- release gate 必须在发布 migration-capable build 前重新下载并验证所有声明 target；缺失目标阻断发布。

### 6.3 预览与确认

用户从 `UI-DATA-01` 选择 safety copy 后，PROTECT 生成一次性 preview token，至少绑定：

- safety copy ID、WorkspaceId、source revision/schema/digest；
- 当前 migrated WorkspaceId/Revision/schema/DataSlot fingerprint；
- source/current appBuildId 与 exact target appBuildId；
- LibraryRootId/RootGeneration 或明确 absent/unavailable 状态；
- 将丢失的范围说明、当前磁盘文件保留/重新对账语义；
- session version 与 impact digest。

确认文案必须说明：

- rollback 会用迁移前结构化数据替换当前结构化数据；migration 后新增/修改的结构化事实不会合并；
- 真实 Library 文件保持原位，不会被回退流程删除，但旧结构化索引/映射将按当前磁盘重新扫描；
- 用户必须在应用外安装指定 tag 的确切签名制品；
- Windows 必须先卸载当前 MSI 再安装目标旧 MSI，macOS 手动替换应用；
- 任意其他旧版、未签名制品或 future build 都不能完成操作。

任一绑定事实变化使 token 失效并要求重新预览。

### 6.4 `MigrationRollbackHandoffV1`

确认后 Workspace 进入 maintenance，停止普通写入、文件操作、备份和新预览，使旧 resource lease/epoch 失效。PROTECT 在 ActivityControlRoot 建立有界、canonical、write-ahead 的 V1 handoff；它是正确性状态，不是诊断日志。

V1 只保存决定动作所需的封闭字段：

- format/limits version、MigrationRollbackSessionId、OperationId；
- source/current/target appBuildId 与 release version；
- safety/current DataSlot identity、WorkspaceId、schema、Revision、size/digest；
- preview/confirmation digest；
- phase、sequence、前一 record digest和当前 allowed actor build；
- DATA owner 对每个 intent 后物理观察产生的 typed fingerprint；
- terminal outcome/receipt digest。

不保存真实路径、文件/课程名称、任意 payload、耗时事件、原始错误或调试字段。记录采用明确大小/数量上限、unique-temp/sync/close/non-overwrite publish/reopen validation；每个 DataSlot 物理动作先持久 intent，再由 DATA 重新观察并写 observed。响应丢失时先观察，不能盲目重复 rename。

核心 phase：

```text
planned
  -> prepared
  -> armed
  -> awaiting-target-build
  -> completing
  -> succeeded

planned/prepared -> cancelled
armed 之后由 exact source build -> cancelling -> cancelled
任一不可唯一分类状态 -> recovery-required
```

- `armed` 前取消保持当前 migrated data 不变。
- `armed` 是 DATA 切换 checkpoint：safety slot 已验证可成为 active，当前 migrated slot 已成为 operation-owned rollback sibling，handoff 已重开验证。
- 到达 `awaiting-target-build` 后应用退出；普通 Workspace 不得打开。

### 6.5 启动分类与 allowed actions

任何 build 启动时先读取 handoff：

| 当前 build | 允许行为 |
|---|---|
| exact target appBuildId | 验证 safety active slot；用户明确继续后完成旧 schema 打开、Library 全量对账和 `FLOW-00` |
| exact source/current appBuildId | 不重新 migration；允许等待或显式取消并恢复 retained migrated slot |
| 其他 build | 停止普通打开，只显示所需 target/source 版本与空的或受限 allowed actions |

启动可以自动补记由现有磁盘证据唯一证明、且不改变活动数据的 observed/terminal 记录；任何 rename、删除、继续或取消物理动作都等待用户明确命令。

### 6.6 成功、取消和失败边界

- target build 只有在 safety 数据完整重开、schema/WorkspaceId/Revision 验证、LibraryRoot 重新取得当前 generation 并完成全量扫描/FileId 对账、设备相关能力失效且 `FLOW-00` 路由完成后才记录 succeeded。
- succeeded 后 safety copy 已成为 active data，不保留同内容第二份 safety copy；operation-owned migrated rollback sibling 与 terminal handoff 只有在重新验证清理资格后删除。
- source build cancel 只有在 retained migrated slot 完整验证并重新激活、Library 对账和 `FLOW-00` 完成后才报告 cancelled。
- 证据冲突、handoff 损坏/未知、slot 缺失、digest 不符、关闭/sync/rename 结果不明或 target 不匹配时保持 recovery-required，不猜测、不自动 forward-migrate、不返回部分成功。
- rollback 完成后用户未来安装新版本，可以重新走正常 forward migration；不提供反向迁移、任意历史浏览、dual-write 或数据 merge。

## 7. 打包拓扑与 Windows MSI

### 7.1 共同构建约束

- 使用干净 checkout、精确 commit、已批准 package manager 的 frozen lockfile 和精确工具版本；不从归档旧实现假定命令。
- production 版本/身份只能由 release configuration 产生；构建前验证 worktree clean、tag/version/appBuildId 一致。
- 每个平台只在其受控原生主机构建正式制品，不交叉构建签名 release。
- 所有运行时依赖随制品交付；install/first run 不执行 npm install、postinstall download 或远程 binary fetch。
- 同一 source commit 的两个 lane 分别产生 platform descriptor，release gate 对共享 release identity 逐字段比对。

### 7.2 macOS Forge lane

Electron Forge 7.11.2 是开发基线；其正式职责限于：

- Electron Packager 的 arm64 `.app` 组装；
- macOS nested code signing/notarization 配置接缝；
- arm64 DMG maker。

不使用 Forge publisher、auto updater、PKG maker、额外平台 maker 或未使用模板。Forge 升级只有在一手资料审阅和全部 release gates 通过后才能进入 release freeze。

### 7.3 Windows Forge + WiX v7 lane

- Forge 只生成 x64 packaged app directory，不生成 Windows installer。
- 一个最小自有 `WixToolset.Sdk` 7.0.0 `wixproj/wxs` 消费该目录并生成 MSI。
- WiX source 明确声明 x64/per-machine、Program Files 位置、稳定 UpgradeCode、版本/ProductCode、快捷方式、ARP metadata、major upgrade 和 downgrade block。
- 不使用 Forge WiX v3 maker、Squirrel、NSIS、Burn bundle、custom action、自动启动或运行时 updater。
- 安装器工程只描述它拥有的程序资源，不枚举 LocalAppData、LibraryRoot、BackupSet 或 ActivityControlRoot。

## 8. 制品内容、ASAR 与 Electron fuses

### 8.1 内容白名单

正式包只包含：

- 编译后的 Main/Renderer/Workspace/preload 代码；
- 运行所需静态资源、许可/notice；
- 精确 production dependencies 和实际需要的 native binaries；
- `BuildDescriptorV1` 与平台 metadata。

排除 test/fixture/source map、开发依赖、编译缓存、包管理器缓存、示例、未使用 maker/publisher/updater、debug server、日志/崩溃/telemetry 配置和开发证书。JS 应用代码默认进入 `app.asar`；只有经过 packaged runtime 证明必须解包的 native module/resource 才进入 `app.asar.unpacked`。

任何可执行内容都不能从 data root、LibraryRoot、backup destination、临时下载、环境变量指定目录或其他用户可写位置加载。资料库允许保存任意文件不意味着 CourseFlow 会执行其中内容；ADR-06 的高风险文件边界保持不变。

### 8.2 fuse 基线

使用 Forge fuses plugin，在最终代码签名前设置并读回：

| Fuse | production 值 |
|---|---|
| `EmbeddedAsarIntegrityValidation` | enabled |
| `OnlyLoadAppFromAsar` | enabled |
| `RunAsNode` | disabled |
| `EnableNodeOptionsEnvironmentVariable` | disabled |
| `EnableNodeCliInspectArguments` | disabled |

Workspace 必须继续由 `utilityProcess` 创建，不能为了 `RunAsNode` fuse 改回 `child_process.fork`。fuse 名称/API 随 Electron 版本变化时，release freeze 以当时官方文档和实际读回值为准；缺失或不能证明等价行为即阻断升级。

### 8.3 正式调试和篡改边界

- production UI 不提供 DevTools、debug mode、inspect、日志查看器、诊断导出或支持包入口。
- production 启动不依赖 `console.*`、logger 或外部 debug service 获得正确性。
- packaged test 在一次性制品副本上修改 ASAR、尝试外部 app directory 覆盖、设置 NODE_OPTIONS/ELECTRON_RUN_AS_NODE/inspect 参数和替换 unpacked native binary；应用必须拒绝加载或被平台签名/ASAR验证阻止。
- ASAR integrity 不代替平台代码签名；manifest SHA-256 也不代替签名。三者分别服务于 packaged loader、平台信任和精确字节关联。

## 9. macOS 签名与公证

### 9.1 签名配置

- 使用 Apple Developer ID Application certificate 和固定 Team ID。
- `.app` 内 framework、helper app、XPC、dylib、native module 及其他 code object 按由内向外顺序签名，最终 app 具有一致有效的 nested signature。
- 启用 Hardened Runtime 与安全 timestamp；拒绝 ad-hoc、过期无有效 timestamp 或 identity 混合。
- 不启用 App Sandbox，不包含 `get-task-allow`。
- entitlement 只包含冻结 Electron/SQLite/utilityProcess 实际运行且官方支持所需的最小集合；`disable-library-validation` 等放宽项不得默认添加，只有 packaged evidence 证明必要并重新审阅后才能加入。
- 最终 DMG 也以 Developer ID Application 签名。

### 9.2 固定公证顺序

1. 验证 nested `.app` signatures、Hardened Runtime、entitlements、bundle ID、arm64 和版本；
2. 生成并签名最终 DMG；
3. 使用 `notarytool --wait` 提交最终 DMG；
4. 只有 Apple 返回 accepted 才继续；
5. 对最终 DMG staple 并执行 `stapler validate`；
6. 再执行 codesign/Gatekeeper assessment；
7. 在干净参考设备挂载 DMG、复制到 `/Applications`，断网后首次启动并完成 packaged E2E。

manifest 的 DMG size/SHA-256 只能在签名、公证和 staple 全部完成后计算。公证拒绝、超时、票据不能 staple、Gatekeeper 失败或离线首启失败均阻断发布，不上传未公证 fallback。

## 10. Windows Authenticode 与 MSI 验证

### 10.1 证书与签名顺序

- 使用受信 CA 签发的 OV code-signing certificate；publisher subject 在首发前冻结。
- 私钥不可导出，位于 hardware token、受控 signing appliance 或具有等价隔离和人工授权的 provider HSM。
- 对最终 payload 内全部 Authenticode-capable PE（主 exe、helper、DLL、`.node` 等）附加有效 CourseFlow signature；存在上游 signature 时使用可保留的附加签名方式，不无理由覆盖。
- PE 逐一验证后才生成 MSI；最终 MSI 再签名和验证。
- file digest 与 RFC 3161 timestamp digest 都使用 SHA-256；timestamp 必须在证书有效期内由受信时间戳服务产生。
- 签名工具不得把私钥导出为仓库或普通磁盘中的 PFX。

### 10.2 平台验证

在干净 Windows 11 x64 参考环境中验证：

- 每个 PE 与 MSI 的 signature chain、publisher、certificate fingerprint、file digest 和 RFC 3161 timestamp；
- x64/per-machine、Program Files、ARP、shortcut、stable UpgradeCode/new ProductCode；
- fresh install、major upgrade、直接 downgrade block、uninstall 和 reinstall rollback target；
- 所有每用户 data roots 在 upgrade/uninstall 后逐字节保持，应用随后正确重开；
- 断网首次启动、SQLite/native module、Workspace utility process 和核心 E2E。

OV Authenticode 证明 publisher 与 signed bytes，不承诺 Microsoft SmartScreen 已积累信誉或永不显示警告；产品、release notes 和验收不得作此保证。

## 11. 密钥、凭据与受控主机

- Apple signing identity/notary credential 只供受控 Apple Silicon release host 使用；Windows private key 只供受控 Windows signing host 调用。
- key、PIN、token、notary credential、provider secret 不进入 Git、安装包、manifest、应用数据、普通 `.env`、CI artifact 或无秘密隔离的 GitHub Actions。
- release host 使用干净 checkout、最小 operator 权限、精确工具版本和人工发起；钥匙不复制到另一平台或个人开发机。
- GitHub Actions 只能执行无秘密 lint/type/test、manifest schema validation 或 dev-identity unsigned package checks；不得签名、公证、上传或发布 production artifact。
- 签名/公证服务产生的 receipt 属于仓库外 release evidence，不进入用户设备或应用数据，也不形成 CourseFlow 运行日志。
- signing/timestamp/notary service 不可用时延后 release，不用自签名、ad-hoc、关闭验证或旧制品改名继续。

正常证书 renewal 在 Apple Team ID 或 Windows publisher subject 不变且全部门禁重跑时属于运营动作。Team ID、publisher subject、key custody/trust boundary 变化，或 key compromise/revocation，必须停止发布并按 §19 重新决策。

## 12. `BuildDescriptorV1` 与 release manifest

### 12.1 内嵌 `BuildDescriptorV1`

`BuildDescriptorV1` 是 Module Contracts 中 `ApplicationReleaseDescriptor` 的技术序列化；它服务于本地构建握手与发行验证，不是运行时更新 feed。每个 app artifact 内嵌只读、版本化 descriptor，至少包含：

- descriptor version、application ID、release version、tag、appBuildId、full source commit；
- platform、arch、production/dev variant；
- Workspace protocol、current/supported schema、snapshot/backup/restore/migration handoff format versions；
- 实际 Electron/Chromium/Node/SQLite 与 packaging tool versions；
- 对支持 source schema 的 rollback target mapping。

它由代码签名覆盖，供 Main/Workspace 握手、启动分类和 release verification 使用。它不包含最终 artifact hash，因为把包含自身的制品 hash 嵌回制品会形成循环。

### 12.2 `courseflow-release-manifest-v1.json`

manifest 在最终 DMG/MSI 均不可再修改后生成，采用封闭 V1 schema，至少记录：

- manifest version、release version/tag/appBuildId/full source commit、application ID；
- 每个 lane 的 platform/arch、实际 runtime/package/toolchain/SDK versions；
- Workspace/schema/snapshot/backup/restore/migration formats；
- 精确支持 OS version/build、参考设备型号与验证日期；
- artifact filename、exact byte size、SHA-256；
- macOS Team ID、certificate identity、timestamp、notary accepted/stapled/validated 状态；
- Windows publisher、certificate fingerprint、signature/timestamp verification 状态；
- source schema/format → exact rollback target version/appBuildId/tag/artifact/hash mapping；
- 执行的 `TEST-RELEASE-*` 和其他 release gate ID/pass 状态；
- manifest 不写入尚未发生的 `publishedAt`；实际公开时间由 GitHub Release 元数据作为外部发布记录，公开后不得为补时间而回写 manifest。

manifest 不包含 secret、credential、username、serial number、absolute path、test log、stack、raw error、课程/文件数据或任意扩展 map。V1 未知 required key/version 由 validator 拒绝；未来扩展使用新 manifest version 或明确版本化 optional namespace，不改变 V1 字段含义。

### 12.3 信任语义

- Apple/Windows 平台签名是可执行制品来源和 signed-bytes 完整性的信任根。
- manifest SHA-256 用于 release asset 逐字节关联、下载核对和 rollback target 识别，只检测是否是声明字节；不提供独立作者认证、保密或恶意 GitHub owner 防护。
- GitHub repository/release 权限与 HTTPS 提供发布渠道控制。v1 不增加 detached manifest signature、第二套 release key 或 transparency service。
- manifest 是公开发行记录，不是 update feed；production CourseFlow 不联网获取、轮询、解析或缓存它。

## 13. 受控人工发布协议

### 13.1 release freeze

1. 选择尚未使用的 `X.Y.Z`，同步版本与 release metadata；
2. 确认 source commit、工作树 clean、lockfile frozen、全部 Requirement/TEST 已实现；
3. 重新审阅 Electron/Forge/WiX/SDK 当前一手资料，冻结精确版本；
4. 冻结两个平台精确 OS build、参考设备与 release gate matrix；
5. 对 migration-capable release 验证所有 rollback target 仍公开、签名有效且能读取 V1 handoff。

### 13.2 两个平台原生 lane

每个 lane 从同一 commit 独立执行：

1. clean dependency install 与静态/契约/单元/性质/failpoint tests；
2. production identity package；
3. ASAR/fuses/content audit；
4. native code signing/notarization；
5. install/upgrade/migration/rollback/offline/packaged E2E；
6. artifact/BuildDescriptor/runtime probe evidence 冻结。

两边共享 release identity/commit/protocol/format 必须一致；platform/arch/toolchain evidence 可以按 lane 不同。任一 lane 失败，整个 release candidate 失败。

### 13.3 draft、重新下载与公开

1. 对最终 DMG/MSI 生成 canonical manifest；
2. tag 固定到同一 commit并建立 GitHub draft release；
3. 用户手动上传且只上传：
   - `CourseFlow-<version>-macOS-arm64.dmg`
   - `CourseFlow-<version>-Windows-x64.msi`
   - `courseflow-release-manifest-v1.json`
4. 从 draft release 重新下载全部资产，核对名称、size、SHA-256、BuildDescriptor、签名、公证和 exact tag/commit；
5. 在两个干净平台从下载资产重新安装并完成离线首启/关键 E2E；
6. 用户手动把 draft 公开；只有此时且三个 public asset 再次可取，release 才成功。

不使用 Forge publisher、GitHub release bot、自动上传或自动发布。用户手动上传最终完整版本的工作方式是本 ADR 的正式边界。

### 13.4 公开后的不可变性与保留

- public tag、asset filename/content 和 manifest 不得覆盖、替换或重新签名；错误以新 patch release 修复。
- draft 阶段可以在未公开前删除失败 candidate 并从头生成；公开后不做原地热修。
- 所有可能被 migration safety copy 引用的已签名 release 资产默认长期保留。因为应用无遥测，无法证明所有用户已不再持有某个副本。
- release 可以在严重问题时标记 withdrawn/not recommended，但 rollback target 默认仍保留。若证书撤销或安全事件要求移除，必须先作出应急数据兼容/恢复决策，不能静默破坏现有 handoff。

## 14. 发布与回归门禁

### 14.1 `TEST-RELEASE-*`

| TEST | 必须证明 |
|---|---|
| `TEST-RELEASE-001` | version/tag/full commit/appBuildId、两个 BuildDescriptor、实际 Electron/Chromium/Node/SQLite、格式版本与 manifest 精确一致；dirty/mixed build 拒绝 |
| `TEST-RELEASE-002` | macOS arm64 nested signing、Hardened Runtime/entitlements、DMG signing、notary accepted、staple/validate、`/Applications` 安装、断网 Gatekeeper 首启与 packaged E2E |
| `TEST-RELEASE-003` | Windows x64 全 PE/MSI Authenticode、RFC 3161、per-machine fresh install/major upgrade/downgrade block/uninstall、数据保留、rollback reinstall 与 packaged E2E |
| `TEST-RELEASE-004` | package allowlist、ASAR/fuses、tamper/override/debug env/inspect 拒绝、无 updater/publisher/runtime download/crash/telemetry/diagnostic artifact |
| `TEST-RELEASE-005` | 两平台同 commit、完整三资产、draft 手工上传、重新下载逐字节/签名/安装复核、无单平台发布、public asset 不覆盖及 rollback target 可用 |

### 14.2 migration/rollback gates

- current schema 更新不创建 safety copy；
- 每个公开旧 schema → current 的 copy-before-write、逐级 migration、每阶段 kill/power-loss/restart；
- 新 safety copy 验证失败时旧 copy 不被替换；最多一份、无定时清理、显式删除；
- storage exact/one-over、WAL/sidecar 未收敛、statement/iterator/validator 未释放、sync/close/rename 失败；
- preview binding 变化、confirm 响应丢失、planned/prepared cancel；
- armed 后 source build cancel、target build continue、其他 build stop；
- handoff 每 record/physical action failpoint、unknown/损坏/冲突/缺失 evidence；
- target success 和 source cancel 都必须 DATA reopen + Library full reconcile + `FLOW-00` 后才完成；
- Library physical files 在 rollback 前后不被删除，迁移后结构化事实不被暗中 merge。

### 14.3 共同 Gate

- `G6`：精确 macOS/Windows、禁网、真实权限、键盘/焦点/状态公告、无生产诊断/遥测 artifact；
- `G7`：参考 workspace/device 与 cold start、migration、package start、rollback/reconcile、峰值空间/RSS/时长预算；
- `G8`：最终签名制品、installer ownership、stable roots、manifest、人工发布/重新下载和 rollback target evidence。

单元测试、未签名 app directory、开发服务器或一个平台的结果都不能代替 final installed artifact evidence。无法运行的平台/OS/filesystem/power-loss 条件必须报告未验证并阻断相应 release claim。

## 15. 用户体验与可访问性

### 15.1 外部手动更新

- 应用不显示“有新版本”、自动检查、下载进度、重启安装或 release feed。
- 用户在应用外访问唯一 GitHub Releases 页面并手动安装。
- 正常无 migration 更新无需额外 UI；启动后继续使用同一数据根。
- app version/build 可以作为 migration rollback 的必要事实显示，但不提供“复制诊断信息”或支持包动作。

### 15.2 safety copy 与 rollback UI

`UI-DATA-01` 显示一张独立 migration safety copy 卡：source schema/revision、创建时间、size、exact rollback release、验证状态及“删除”“回退”动作。它与 BackupSet/RestoreSafetySet 分开，不计入快照保留。

`UI-DATA-03` 呈现：

- rollback impact preview 和结构化数据损失警告；
- exact tag、platform artifact filename 与手工替换步骤；
- planned/prepared/armed/awaiting-target/completing/recovery 状态；
- owner 提供的 continue/cancel/wait 或空 allowed actions；
- wrong build 时精确需要的 target/source 版本，不提供猜测性按钮；
- success 只在 DATA/Library/FLOW-00 全部完成后显示。

核心动作可键盘完成；模态确认锁定焦点且不能外部点击误关；状态不只依赖颜色、动画或文件名；长阶段使用可访问状态公告，不逐条展示内部物理记录。

## 16. ADR-09 隐私与无日志约束

- production 不调用或配置 CourseFlow crash/telemetry/error-report endpoint，不创建 app-owned log/crash/support artifact。
- Electron/Chromium/OS 在 CourseFlow 控制外可能产生的系统记录不成为 CourseFlow 产品数据；CourseFlow 不收集、读取、管理、导出或上传它。
- MigrationSafetyCopy metadata、MigrationRollback handoff、BuildDescriptor 和 release manifest 是正确性/发行白名单记录，只保存本 ADR 明确字段，不附加 message/stack/rawError/path dump/breadcrumb。
- build/test/sign/notary 的终端或 CI 输出只存在于开发者控制面，不随应用交付。
- Module Contracts 中“数据库日志”统一改称 SQLite WAL/sidecar 状态；WAL 是活动数据库一致性文件，不是诊断日志。
- `TEST-PRIVACY-001` 在 dev 和最终 installed DMG/MSI 上验证无 CourseFlow 自有 diagnostics/logs/crashes/telemetry/support artifacts、入口和错误触发网络请求。

## 17. 备选方案

### 17.1 采用本决议：外部手动更新 + 双平台签名原生制品

与离线、本地真相、人工发布和当前单开发者密钥控制边界一致；运行时更新面最小，同时提供可证明的数据迁移与回退。

### 17.2 Electron autoUpdater/Squirrel

拒绝。它要求更新 feed、远程目录签名、下载/install state machine、更多 Windows installer 语义和失败恢复。当前无自动更新 Requirement，预建会扩大数据/网络/测试面。

### 17.3 应用商店渠道

拒绝。Mac App Store/Microsoft Store 会改变 sandbox、身份、entitlements、安装和更新协议。未来可以增加独立 lane，但不能把当前 Developer ID/MSI 悄然替换。

### 17.4 Forge WiX v3 maker、Squirrel、NSIS 或 MSIX

拒绝。当前选择 WiX v7 self-owned MSI 以保持最新工具链、稳定 per-machine major upgrade 和最小 installer ownership；其他格式没有当前产品收益。

### 17.5 unsigned portable/zip、自签名或签名失败 fallback

拒绝。它们不能满足平台信任、稳定安装身份、升级/卸载和 G8 完整发布边界。

### 17.6 保留多个 migration copy、自动 reverse migration 或 dual-write

拒绝。它们扩大用户选择、格式义务和合并损坏面。v1 只保留最近一份 safety copy，并回到一个 exact compatible signed release。

### 17.7 把 migration rollback 当作 BackupSet restore

拒绝。safety copy 只保护迁移前结构化数据，真实 Library 文件保持原位；把它伪装成完整快照会错误承诺资料库时间点恢复。它有独立 session 语义，但复用现有 owner 和 DATA 同卷 primitives。

### 17.8 为 manifest 增加第二套签名密钥

拒绝。当前平台 code signature 已认证可执行制品，GitHub 控制公开渠道，manifest hash 只做字节关联。没有 signed update catalog 或离线独立验证产品需求，不增加另一把长期密钥。

## 18. 后果

### 18.1 正向后果

- 运行时保持完全离线、无更新服务和最小网络/隐私面；
- 安装器与用户数据所有权彻底分开，升级/卸载不触碰本地真相；
- 每个公开制品有平台身份、exact source/runtime 和安装后证据；
- migration 与 app rollback 从首发即有明确副本、目标版本、handoff、失败和成功边界；
- dev build 不会误开 production 数据；
- manifest/BuildDescriptor/目录/handoff 版本化，为未来增加 lane 或新协议提供显式演进点；
- 不引入 updater framework、publisher service、store abstraction 或未来占位模块。

### 18.2 成本与限制

- 每次 release 需要两台受控原生主机、Apple Developer 身份、Windows OV certificate、人工密钥操作和手工上传；
- 首发只覆盖 macOS arm64 与 Windows x64，且每版支持声明很窄；
- Windows per-machine 安装需要管理员权限；不同用户不能自行保持不同 CourseFlow app 版本；
- 用户回退需要手动替换应用，Windows 还需卸载/重装；
- schema migration 后新增结构化事实不会合并回 safety copy；
- 长期保留 rollback target 增加 GitHub asset 管理义务；
- OV certificate 不保证 SmartScreen reputation，Developer ID/notarization 也不能代替功能正确性测试；
- signing/notary/timestamp 服务故障会延后 release；没有 unsigned fallback。

## 19. 重新评审与未来扩展

以下变化必须新建或替代 ADR，而不是在实现中添加隐藏分支：

- 自动检查、下载、差分更新、silent install 或 signed update catalog；
- Mac App Store、Microsoft Store、Homebrew/winget 等新公开渠道；
- macOS Intel/universal、Windows arm64/ia32、Linux、portable/zip、PKG/MSIX；
- public beta/nightly/channel switching 或一个版本只发布单一平台；
- GitHub Actions/云服务签名、公证、自动上传或自动发布；
- Apple Team ID、Windows publisher subject、应用 ID、UpgradeCode 或 key custody/trust boundary 改变；
- 多份 migration history、任意版本 downgrade、reverse migration、dual-write 或 merge；
- migration safety copy 需要包含/回退真实 Library 文件；这必须回到 ADR-08/新 snapshot 语义；
- manifest 需要独立签名、透明日志、加密或运行时 fetch；
- Electron/Forge/WiX/平台变更无法继续满足 ASAR/fuse、utilityProcess、SQLite 或 installer 不变量；
- public asset 因证书撤销/安全事件必须删除并会破坏已存在 rollback target。

允许的版本化扩展：

- 新架构/渠道在批准后增加独立 native lane 和 manifest platform entry；
- manifest/BuildDescriptor/handoff 使用新版本，并保持已发布 V1 reader/writer 兼容义务；
- 正常 certificate renewal 保持同一 Team ID/publisher，记录新 fingerprint 并重跑门禁；
- 新 Electron stable patch 在 release freeze 重选并通过全部证据后替换开发基线。

不得预建 updater provider、store adapter、release service、plugin participant、任意 manifest map、disabled page 或 feature flag。

## 20. 覆盖审阅结论

在接受本 ADR 前，已读取当时仓库全部 36 份现行 Markdown 文档；按仓库规则排除归档 `ATTEMPT.md`，并验证 286 个本地 Markdown 链接均有目标。同步产品、User Flow/UI、Architecture、Contracts 与追溯后：

- `A-DATA-007` 覆盖 copy-before-migration、最近一份 safety copy、显式删除与 exact-build rollback；
- `A-PLATFORM-002–004` 覆盖 GitHub 手动更新、安装器/数据边界和双平台完整发行；
- `STATE-007`、`UF-A-09`、`UI-DATA-01/03` 覆盖等待版本、maintenance、错误 build、继续/取消与可访问状态；
- `NFR-012`、`Q-RELEASE-01` 与 `G8` 覆盖签名、公证、manifest、资产不可变和重新下载成功边界；
- `FLOW-07` 与 DATA/PROTECT/WORKSPACE/LIBRARY contracts 覆盖 migration/rollback 的 owner、启动和无部分成功；
- ADR-04 的 forward-only/schema exactness、ADR-08 的 ActivityControl/恢复所有权和 ADR-09 的无诊断/日志边界均未被改写；
- release pipeline 位于应用 runtime architecture 外，不建立 MOD-RELEASE/UPDATE；
- 未来扩展通过版本化协议 + 新 ADR 增加独立 lane，不预建当前不可达能力。

唯一术语修正是把 Module Contracts 两处“数据库日志”明确为 SQLite WAL/sidecar/checkpoint/close 状态；它不改变既有恢复语义。

## 21. 实现边界

- 本 ADR 批准技术、产品和发行边界，不授权立即创建 app、installer、签名脚本、证书、密钥或 GitHub Release。
- 后续实现必须先建立 roadmap/work package，引用目标 Requirement/MOD/IF/FLOW/Q/G/TEST，并从最小可工作的纵向切片开始。
- 新增 Electron/Forge/WiX/npm dependency 前必须核对实际官方文档、类型、许可证和 lockfile；不得从 research 日期推断 release 日期仍是同一版本。
- 证书购买、Apple Developer 加入、硬件 token/HSM 选择和实际 release 上传是外部状态变化，需要用户单独授权。
- 完成标准是所有适用 `TEST-RELEASE-*`、migration/rollback failpoint、两个平台 final installed E2E、trace/link/diff 验证实际通过，不是“配置文件已经存在”或“开发目录能启动”。
