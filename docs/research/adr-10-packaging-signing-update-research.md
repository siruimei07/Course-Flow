# ADR-10 打包、签名与手动更新一手资料研究

> 状态：研究完成，供 ADR-10 探讨；本文不构成 ADR 决定
> 检索日期：2026-08-21
> 范围：Electron 运行时与平台支持、macOS/Windows 打包和签名、直接分发、无内置更新条件下的完整安装包升级、稳定活动数据路径、无诊断发行门与最小测试矩阵
> 证据政策：只引用 Apple、Microsoft、Electron/Forge、Node.js、WiX、electron-builder/NSIS 等上游项目的一手资料；所有随版本、服务或平台生命周期变化的结论均以 2026-08-21 为截点
> 阅读约定：文中明确区分“官方事实”“工程推论”“研究建议”；最终规范选择仍由 ADR-10 决定

## 1. First Principles 与仓库约束

ADR-10 的真实用户结果不是“能生成一个安装包”，而是：学生能在受支持的 macOS 或 Windows 上取得可信、完整、可离线运行的 CourseFlow；以后手动安装完整新版本时，应用代码可以替换，但本地真相、恢复证据与正式协议不能因安装器或路径漂移丢失；发行版也不能偷偷引入网络更新、诊断日志、崩溃收集或遥测。

现有规范已经固定以下边界，ADR-10 不能重新定义：

- [PRD](../product/PRD.md) 的 `A-PLATFORM-001` 要求首版支持 macOS 与 Windows；[MVP Scope](../product/MVP_SCOPE.md) 的 `MVP-DOD-007/008` 要求双平台核心行为一致且核心路径离线；
- [Architecture](../architecture/ARCHITECTURE.md) 的 `ADR-TOPIC-10` 拥有打包、签名、更新与平台发布；`G6` 必须使用真实打包应用、真实权限和禁网环境，`G7` 必须版本化参考设备与性能预算；
- [ADR-03](../architecture/adr/ADR-03-sqlite-active-data-transactions.md) 已选 bundled `node:sqlite`，因此 Electron/Node/SQLite 不是三个可独立漂移的发行组件；
- [ADR-04](../architecture/adr/ADR-04-schema-migration-compatibility.md) 已要求逐版本迁移、迁移前已验证安全副本、新版本读旧 schema、旧版本拒绝 future schema；
- [ADR-05](../architecture/adr/ADR-05-library-watching-index-file-operations.md) 与 [ADR-08](../architecture/adr/ADR-08-restore-activation-recovery.md) 已要求路径/文件系统能力复验，并固定跨更新稳定的 `ActivityControlRoot`、同卷 sibling `DataSlotsParent` 与启动先恢复；
- [ADR-06](../architecture/adr/ADR-06-resource-preview-system-open.md) 与 [ADR-07](../architecture/adr/ADR-07-snapshot-format-integrity-publication.md) 要求运行时变化重跑 packaged preview、备份、恢复和格式兼容门；
- [ADR-09](../architecture/adr/ADR-09-no-production-diagnostics.md) 已决定生产环境不建设诊断、持久日志、崩溃收集、遥测或支持包；`TEST-PRIVACY-001` 同时覆盖开发构建和双平台 packaged build。

因此本研究把“应用位”“活动数据”“用户选择的 Library”“备份目的地”和“安装/操作系统自己的记录”视为不同所有权边界。安装器只能替换应用位；它不能打开、迁移、删除或“清理” CourseFlow 活动数据。

## 2. Electron 运行时、最低 OS 与 CPU 架构

### 2.1 2026-08-21 的当前事实

截至 2026-08-21，[Electron 官方只支持最新三个 stable major](https://www.electronjs.org/docs/latest/tutorial/electron-timelines#version-support-policy)，并且只维护每条 major 的最新 minor/patch；将某个永恒 major 写死到 ADR 会很快进入 EOL。

[官方发布索引](https://releases.electronjs.org/releases.json) 与 [v43.4.1 release tag](https://github.com/electron/electron/releases/tag/v43.4.1) 显示，当天最新 stable 是 Electron `43.4.1`，其打包运行时为 Chromium `150.0.7871.224`、Node.js `24.18.1`。Electron v43.4.1 的[平台支持声明](https://github.com/electron/electron/blob/v43.4.1/README.md#platform-support)为：

| 平台 | Electron v43.4.1 官方最低 OS | 官方 CPU 架构 |
|---|---|---|
| macOS | macOS Monterey 12+ | `x64`、`arm64` |
| Windows | Windows 10+ | `ia32`、`x64`、`arm64` |

这张表只是**当前 Electron 二进制的技术下限**，不是 CourseFlow 应承诺的产品支持下限。

截至同一检索日，[Electron release schedule](https://releases.electronjs.org/schedule) 把 v44.0.0 stable 排在 2026-08-25；未来日期可能调整。Electron 的[计划 breaking changes](https://www.electronjs.org/docs/latest/breaking-changes)说明 v44 将不再支持 macOS 12，并停止发布 Windows `ia32`。所以首发若在 v44 后冻结运行时，合理技术基线会自然变为 macOS 13+、Windows `x64/arm64`；不能用 v43 的短期尾部支持倒推出长期首发承诺。

`node:sqlite` 也必须跟随该精确 runtime：v43.4.1 所带 Node `24.18.1` 源码中的 [SQLite header](https://github.com/nodejs/node/blob/v24.18.1/deps/sqlite/sqlite3.h#L149) 标明 SQLite `3.53.1`。这是锁定上游 tag 的静态证据，不是 CourseFlow 最终二进制已测结果；发行门仍必须在 packaged app 中记录 `process.versions` 并执行 `select sqlite_version()`，不一致就停止发行。Node 的 [July 2026 security release](https://github.com/nodejs/nodejs.org/blob/main/apps/site/pages/en/blog/vulnerability/july-2026-security-releases.md)还包含 `node:sqlite` 修复，证明“只锁 Electron major、不验 patch 内 Node/SQLite”不足以构成发行基线。

**工程推论：** ADR-10 应固定“发行时选择仍受 Electron 支持、通过全套 gate 的精确 stable patch”的政策，并把当天的 v43.4.1 仅当研究快照；不能在距 v44 stable 四天时把 v43.4.1 永久批准为实现版本。若现在必须做 packaging spike，可以精确 pin `43.4.1` 作为可复现的研究基线；真正 release candidate 则必须在发行时重选当时受支持的精确 stable patch，并从头跑完 runtime、平台、打包、格式和 G6/G7 复验，不将 spike 通过自动继承为发行证据。

### 2.2 产品 OS 下限不应等于 runtime 下限

截至 2026-08-21，[Microsoft 已于 2025-10-14 结束 Windows 10 的常规支持](https://support.microsoft.com/en-us/windows/deployment/updates-lifecycle/windows-10-support-has-ended-on-october-14-2025)；个别 ESU 设备不等于普通消费者支持仍然继续。研究建议把 CourseFlow 首发 Windows 产品下限定为 **Windows 11**，而不是因为 Electron v43 还能启动就承诺 Windows 10。

Windows 11 feature release 的服务期又随 edition 不同：[Home/Pro 生命周期](https://learn.microsoft.com/en-us/lifecycle/products/windows-11-home-and-pro)在检索日仍服务 24H2、25H2 等版本，而 [Enterprise/Education 生命周期](https://learn.microsoft.com/en-us/lifecycle/products/windows-11-enterprise-and-education)仍可能服务更早的 23H2。大学用户可能同时使用 Home、Pro 与 Education，因而 ADR 需要选择一种可持续策略：

- 永久 ADR 只承诺“Windows 11 中仍受 Microsoft 支持的 edition/version 组合”，每个 release manifest 记录实际最低/最新测试版本；或
- 明确列出所支持 edition，并在 ADR 中写一个固定 feature release 下限，承担每次上游生命周期变化时修订 ADR 的成本。

**研究建议：** 采用前一种生命周期策略，并在首次 release plan 中给出可复现的 edition/build 清单。它既不把即将 EOL 的 24H2 永久写死，也不会含糊地把未实测的所有 Windows 11 都算作“支持”。是否把 Education 纳入首发承诺仍需用户决定。

macOS 方面，当前 stable 的下限是 12，但 v44 已计划提高到 13。**研究建议：** 直接以 macOS 13+ 为 CourseFlow 首发产品下限，减少上线前后立即换基线的风险；最终仍须以冻结的 Electron stable 和真实设备 gate 为准。

### 2.3 CPU 架构与 universal 的事实

[`@electron/packager`](https://github.com/electron/packager#supported-platforms)能产出 Windows `x64/arm64` 和 macOS `x64/arm64/universal`，但 macOS 签名必须在 macOS host 上执行。Electron 的 [`@electron/universal`](https://github.com/electron/universal)不是单一 CPU 翻译层，而是把已经各自能工作的 x64 与 arm64 `.app` 合并；上游明确提醒 universal 结果通常接近两份应用的体积，ASAR merge 只能减少部分重复。

[Windows on Arm 官方文档](https://learn.microsoft.com/en-us/windows/arm/apps-on-arm-x86-emulation)说明 Windows 11 on Arm 能模拟 x86 与 x64 应用，而 Windows 10 on Arm 只模拟 x86；原生 arm64 通常能获得更好的性能和兼容性。模拟能力只能说明 x64 artifact 可能在 Windows 11 Arm 上运行，不能替代 CourseFlow 对该组合的 packaged G6/G7，也不能把它宣传成原生 arm64 支持。

工程边界因此是：

- 不首发 `ia32`：v44 已计划移除，Windows 10 也已结束常规支持；
- macOS universal 必须先分别通过 x64、arm64 native fixture，再验证合并、签名、公证和两个 CPU 上的最终 DMG；
- Windows arm64 只有在完整安装器、内层二进制签名、文件/SQLite/preview/恢复和性能 gate 都有原生设备证据时才可列入支持；
- “x64 在 Arm 仿真下能启动”可以作为额外兼容观察，不能悄悄扩大支持矩阵。

## 3. 分发通道：直接下载还是 Store

### 3.1 官方事实

Electron 同时允许 Store 与 Store 外分发，但两条路不是同一个 artifact。[Electron 的 Mac App Store 指南](https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide)要求 MAS 专用 Electron build、App Sandbox、Apple Distribution 签名和 Store review；它还列出 MAS build 的 API/行为差异。CourseFlow 当前的用户选择 Library root、系统打开、文件 watcher 与恢复路径因此都需要一套独立 sandbox entitlement 和 packaged conformance，不能假定 Developer ID build 的证据可复用。

[Microsoft packaging overview](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/packaging/)区分 MSIX/package identity、sparse package 和没有 package identity 的传统 Win32。MSIX 会改变安装、更新和一部分文件系统/注册表语义；传统未打包 Win32 则继续由 MSI/EXE 负责安装与升级。当前 CourseFlow 没有通知、后台任务、share target 等必须依赖 Windows package identity 的需求。

Store 还可能由平台管理更新；这虽然不是 CourseFlow 代码调用 `autoUpdater`，却与本轮已经指定的“用户取得完整安装包并手动就地升级”不是同一发布协议。

### 3.2 研究建议

首发只做**官方站点直接分发**的一个 macOS artifact family 和一个 Windows artifact family，理由是它完整覆盖当前需求且不引入第二套 sandbox/package-identity/Store review/update 语义。macOS 使用 Developer ID 路线；Windows 使用受信任 Authenticode 路线。Store 不是永远禁止，但以后若有真实发现性、学校 MDM 或平台能力需求，必须以新的发行变体重开 ADR，并单独通过 G6/G7，而不是把同一二进制改扩展名后上传。

这是研究建议，不是已决定的渠道政策。

## 4. macOS：arm64/x64/universal、DMG、Developer ID 与公证

### 4.1 适合当前范围的容器

[Apple 的 macOS distribution packaging 指南](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)说明：

- ZIP 本身不能代码签名；
- DMG 可以签名，且对单个 app bundle 是最简单的直接分发容器；
- flat installer package 适合多个组件、指定安装位置或安装脚本。

[Forge DMG maker](https://www.electronforge.io/config/makers/dmg)实现标准“把 `.app` 拖入 `/Applications`”体验，并且只能在 macOS 上构建。CourseFlow 没有多组件、特权 helper、内核扩展或安装脚本需求，因此**研究建议**选 DMG，不选 PKG；避免用安装脚本接触 Application Support 数据。

### 4.2 正确的签名与公证链

[Apple notarization 文档](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)要求 Store 外发行使用 Developer ID 签名，把软件提交给 notary service 检查，再把 ticket 附着到可 stapling 的发行物。对 CourseFlow，最小链路是：

1. 在受控 macOS build host 上生成每个目标架构的 `.app`；universal 先由已通过 native smoke 的 x64/arm64 app 合并；
2. 使用 **Developer ID Application** 签所有 nested executable、framework、helper 和最终 `.app`，启用 hardened runtime、secure timestamp，并只保留 Electron 正常运行所需的最小 entitlements；
3. 创建并签最终 DMG；Apple 的[常见公证问题指南](https://developer.apple.com/documentation/security/resolving-common-notarization-issues)明确区分 Developer ID Application 与只用于 flat PKG 的 Developer ID Installer，不能因为文件名含 installer 就给 DMG 使用 Installer certificate；
4. 使用 `notarytool` 提交实际发布物并等待 accepted；旧 `altool` 流程不再作为发行依据；
5. 对支持 stapling 的 app/最终 DMG 附着 ticket，并使用 `stapler validate`、`codesign --verify --deep --strict`、`spctl --assess --type exec` 验证；
6. 在没有开发证书、没有构建缓存的干净 Mac 上，从最终 DMG 复制到 `/Applications`，断网后首次启动并执行 G6。

[Apple 的自定义 notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)说明 stapling 让 Gatekeeper 在离线时取得 ticket；ZIP 不能直接 staple。因此“notary service 返回 accepted”不是 CourseFlow 离线门的完成条件，最终 DMG 的 stapling 与断网验证不可省略。

[Forge macOS signing guide](https://www.electronforge.io/guides/code-signing/code-signing-macos)可通过 `osxSign`/`osxNotarize`驱动 app signing/notarization，但 ADR-10 仍需验证**最终用户下载的 DMG**，不能把“Forge 某个中间 hook 成功”当作发行证据。证书、Apple API key/private key 与密码只存在于签名环境，不进入 app、ASAR、release manifest 或仓库。

### 4.3 macOS 身份稳定性

以下值一旦首发即成为数据连续性或平台信任的一部分，不能随显示名称改变：bundle identifier、Team ID/签名身份、Application Support namespace、可执行文件身份以及 universal 两个 slice 的 app identity。显示名可以以后本地化，但不能借改名把用户带到一套空数据目录。

## 5. Windows：签名与完整安装包格式

### 5.1 Authenticode 的当前事实

截至 2026-08-21，[Microsoft 的 Windows code-signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)给出以下直接分发事实：

- 公共 MSI/EXE 应使用链到受信任根的签名；self-signed 只适合开发或由组织预先部署信任的受管设备；
- Azure Artifact Signing 是 Microsoft 推荐的非 Store 服务，但组织/个人可用地区有限，并且新文件仍可能出现初始 SmartScreen reputation 提示；
- OV 证书是地域更广的正式选项，SmartScreen 同样按文件建立 reputation；
- EV 自 2024 年起不再立即绕过 SmartScreen，不能为“首发零提示”而把 EV 写成硬要求。

这比 Electron 页面中可能滞后的 EV 简化表述更权威。签名供应商的最终选择取决于发布者法律身份和地区，属于 ADR-10 未决项。

[Microsoft SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool)要求现代 SDK 显式给出 `/fd` 和 `/td`，并推荐 SHA-256。发行门应签名并时间戳 app 内所有相关 PE/support binaries 与最终 MSI/EXE，再用 Default Authentication Policy、时间戳和完整证书链验证；只签外层安装器不能证明解包后的 app 位可信。

### 5.2 Squirrel Setup.exe 的适配性与阻塞项

[Electron 官方维护的 `electron-winstaller`](https://github.com/electron/windows-installer)由 Squirrel 生成 `.exe` installer、full `.nupkg` 与 `RELEASES`，并要求应用在启动最早期处理 `--squirrel-install`、`--squirrel-updated`、`--squirrel-uninstall` 和 `--squirrel-obsolete` 等额外生命周期。它的优势是面向消费者、通常无需管理员权限，Forge 也把它作为常规 Windows maker。

但这不是纯粹“复制完整 app”的薄安装器：安装目录包含 `Update.exe`，输出模型与增量/更新 feed 同源。即使 CourseFlow 不调用任何更新检查，也必须保留并测试 Squirrel lifecycle surface。

更重要的是，[Squirrel.Windows 官方 FAQ](https://github.com/Squirrel/Squirrel.Windows/blob/develop/docs/faq.md)明确让用户从 `%LocalAppData%\SquirrelTemp\SquirrelSetup.log` 读取初始安装日志。现有一手配置文档没有给出完全禁用该持久安装日志的受支持选项。它很可能违反 ADR-09/用户已确认的“无本地诊断、日志”边界；不能以“这是第三方默认”绕过 `TEST-PRIVACY-001`。

**研究结论：** 在日志边界未由 ADR-09 owner 明确判定、且没有可证明的禁用能力前，不应批准 Squirrel 为 CourseFlow 首发安装器。

### 5.3 Forge WiX MSI 的适配性与阻塞项

[Forge WiX MSI maker](https://www.electronforge.io/config/makers/wix-msi)生成传统 standalone MSI；其 [config API](https://js.electronforge.io/interfaces/_electron_forge_maker_wix.MakerWixConfig.html)说明 `autoUpdate`/`autoLaunch` 默认关闭，并要求复用稳定 `upgradeCode` 才能无冲突升级。从语义看，它比 Squirrel 更接近“用户手动运行新的完整安装包、应用本身无更新功能”。为了防未来默认漂移，CourseFlow 仍应显式写 `features: false`，而不只依赖默认值。

然而当前 Forge maker 委托给 [`electron-wix-msi`](https://github.com/electron-userland/electron-wix-msi)，后者明确要求 **WiX Toolset v3**，且 `arch` 文档只列 `x86`/`x64`。[WiX 官方 v3 仓库](https://github.com/wixtoolset/wix3)已归档并声明 v3 退出社区支持；[WiX 官方生命周期公告](https://github.com/orgs/wixtoolset/discussions/8864)给出的 consumer support end date 是 2025-02-06。于是该 maker 在检索日同时存在两项阻塞：已停止社区支持的构建依赖，以及没有 Windows arm64 installer contract。

**研究结论：** 不能仅凭 MSI 语义较干净就直接批准 Forge WiX maker。若首发只做 Windows x64，它仍需明确接受/缓解 WiX v3 工具链风险；若首发要求 arm64，则当前上游文档已经不足。

### 5.4 electron-builder + NSIS 第三候选

截至 2026-08-21，[electron-builder NSIS 一手文档](https://github.com/electron-userland/electron-builder/blob/master/website/docs/nsis.md)区分了默认 `nsis` 和需下载 payload 的 `nsis-web`：默认 `nsis` 把应用 payload 嵌入安装器，能产出一个完整离线 `.exe`；同一机制可把 x64+arm64 放入一个根据当前 CPU 选择 payload 的 installer。它因此是真正值得 spike 的第三候选，但仍不能从“可生成 EXE”直接推导为已满足全部边界。

**安装 scope 与数据隔离：** [`NsisOptions`](https://www.electron.build/docs/api/electron-builder.interface.nsisoptions/)的 `oneClick` 默认 `true`、`perMachine` 默认 `false`，即默认每用户安装且不需管理员；改成 assisted installer 后，`perMachine:false` 反而会显示 per-user/per-machine 选择页。CourseFlow 若要一个可判定的 no-admin contract，必须显式锁定 `oneClick:true, perMachine:false`，不依赖默认。`deleteAppDataOnUninstall` 默认 `false`，上游[旧版卸载路径源码](https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/templates/nsis/include/installUtil.nsh)也在升级时传入 `/KEEP_APP_DATA`；候选配置仍应显式写 `deleteAppDataOnUninstall:false`，并确保本文第 7 节的活动 root 从不属于 install directory/custom uninstall hook。

**不内置更新的边界：** [electron-builder 的 Auto Update 文档](https://www.electron.build/docs/features/auto-update/)明确把更新实现放在单独的 `electron-updater` package、publish metadata 与 app 中的检查调用。因此单纯构建 `nsis` 不会自动让 app 检查、下载或安装更新；CourseFlow 必须不安装/不 import `electron-updater`、不配置 publish/update provider、不生成或分发 update metadata、不嵌入 endpoint。

但默认 NSIS 目标仍携带两个“为 updater 留的支撑面”：`packElevateHelper` 默认 `true`，文档明说该 helper 供 `electron-updater` 在某些 scope 使用；此外当前 [installer template](https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/templates/nsis/include/installer.nsh)会把嵌入式 installer 复制到每用户 `LocalAppData` 下的 `${APP_INSTALLER_STORE_FILE}`（构建宏通常是 updater-named 目录），未找到禁用该复制的受支持配置项。前者可显式 `packElevateHelper:false`；后者不是网络更新功能，也不是诊断日志，但是一个未使用的持久 installer artifact。它是 NSIS spike 的**明确未决项**：必须确定可否以最小 include 安全去除且不破坏升级/卸载，或由 ADR owner 明确它是不具备更新行为的 installer-owned state；本研究不伪称它不存在。

**日志：** `NsisOptions` 说明 `debugLogging` 必须提供特制的 debug-enabled `makensis`，electron-builder 自带编译器不支持；[NSIS common template](https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/templates/nsis/common.nsh)中的 `LogSet`/`LogText` 又只在 `ENABLE_LOGGING_ELECTRON_BUILDER` 宏开启时生效。因此一手源码中**未发现默认生产持久 NSIS 安装日志的路径**，与 Squirrel 官方确认的 log 不同。这仍只是静态证据：候选必须显式不用 custom NSIS binary/script logging，并以 clean-profile install/upgrade/failure/uninstall diff 证明最终 artifact 不落 app-owned log。

**升级、降级与身份：** `NsisOptions.guid` 由稳定 `appId` 确定并用于 upgrade/uninstall，上游明确警告更改 `appId` 会破坏现有安装的静默升级。当前 template 能查找并卸载同一登记身份的旧版，并写入 `DisplayVersion`；但配置 API 没有“手动完整 EXE 禁止降级”选项，`electron-updater.allowDowngrade` 与本模型无关，当前已读 template 也没有给出可依赖的版本比较契约。因而“运行旧的完整 Setup.exe 会被默认拒绝”**未被证明**；需在 spike 中以多个 semver/MSI-compatible 版本实测，若确实不拒绝，再评审一个最小 `preInit`/include 比较，不得为此引入网络 updater。

**签名与构建器边界：** [electron-builder Windows signing](https://www.electron.build/docs/features/code-signing/code-signing-win/)可组织内层 PE 与最终 installer 签名，但仍须用第 5.1 节的 Microsoft SignTool 规则验证精确内容与 SHA-256/timestamp。[electron-builder 的 Forge integration](https://www.electron.build/docs/features/electron-forge/)确实提供 `electron-forge-maker-nsis`，但上游同页明说 code signing 只在 electron-builder 作为主构建工具时可用。所以签名 NSIS 候选要么批准 electron-builder 成为发行主工具，要么另行证明一个完整 signing phase；不能只加 maker 就声称内外层已签名。

最后，当前上游曾出现[NSIS 解包时静默缺失 PE 文件的回归](https://github.com/electron-userland/electron-builder/issues/9983)。这不证明所有版本都有故障，但证明发行门不能只看 installer exit code：必须锁精确 electron-builder/NSIS 版本，解包后核对预期文件集并从最终安装位启动。

### 5.5 现代 WiX 的受维护路径

必须先纠正版本命名造成的误导。截至 2026-08-21，[WiX 官方 servicing table](https://docs.firegiant.com/wix/)列出 v4 的 consumer security fixes 于 2025-02-05 结束，v5 于 2026-02-05 结束，v6 到 2027-02-05；[官方 release notes](https://docs.firegiant.com/wix/whatsnew/releasenotes/)和 [GitHub releases](https://github.com/wixtoolset/wix/releases/)则确认 v7.0.0 于 2026-04-06 发布并为当前 release。因此“现代且当前受维护的 WiX v4/v5”路径并不存在；候选应是 **WiX v7**，或在有明确过渡计划时短期使用仍有安全修复窗口的 v6。

这条路在技术上可行：[WiX 官方当前用法](https://docs.firegiant.com/wix/using-wix/)支持 `<Project Sdk="WixToolset.Sdk/7.0.0">` + `dotnet build` 或 `.NET` tool `wix build`；[MSBuild 参考](https://docs.firegiant.com/wix/tools/msbuild/)的 `InstallerPlatform` 明确支持 `x86`/`x64`/`arm64`；[当前 `Package` schema](https://docs.firegiant.com/wix/schema/wxs/package/)可固定 per-user scope；[`MajorUpgrade`](https://docs.firegiant.com/wix/schema/wxs/majorupgrade/)默认禁止低版本覆盖高版本，但必须正确提供稳定产品身份、版本和 `DowngradeErrorMessage`。它能表达 CourseFlow 所需的 per-user/no-admin、x64/arm64 和 downgrade block，仍需在 Windows 11 x64/Arm 真机上证明这些实际安装语义。

MSI 日志也应区分产品与平台：[Microsoft Windows Installer logging](https://learn.microsoft.com/en-us/windows/win32/msi/logging)说明日志由 `/L`、`MsiEnableLog` 或系统 policy 启用；policy 开启时由 Windows Installer 在 `%TEMP%` 写 `MSI*.LOG`。CourseFlow 的 WiX project 可以不启用日志、不建 custom logger，但不能阻止管理员的 OS policy 或用户显式 `/L`；这类 OS-owned 记录应与 Squirrel 无条件的 app-installer-owned log 区分，并由 ADR-09 的既有 substrate 边界裁定。

这不是零代价候选：[WiX OSMF 官方条款页](https://docs.firegiant.com/wix/osmf/)说明 OSMF 自 v6 引入、v7 强制显式 EULA acceptance，并按其定义对年收入超过 USD 10,000 的组织要求 sponsorship。这是必须在选型前完成的许可/成本确认，本研究不代替法律判断。而且当前 Forge WiX maker 和 `electron-wix-msi` 仍锁 WiX v3，未找到 Electron/Forge/electron-builder 一方维护的 WiX v7 turnkey maker；若选此路，需一个最小自有 `.wixproj`/构建适配，仅从 Forge packaged app 输出生成 MSI，不把任何安装逻辑放进应用。

同时，不能把 electron-builder 自带的 `msi` 目标误认为上述现代 WiX：当前 [`MsiTarget.ts`](https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/targets/win/MsiTarget.ts)仍下载名为 `wix-4.0.0.5512.2` 的旧 `candle.exe`/`light.exe` bundle，源码还明说该 bundle 不支持 arm64，会把 arm64 暂时映射为 x64 MSI。当前 WiX v7 是 `wix.exe`/.NET SDK 工具链；名字中出现“4.0”不能替代维护性和 native-arm64 证据。

### 5.6 Windows 安装器的建议决策方式

ADR-10 应在锁格式前做一个**有界 installer spike**，只验证以下候选，不扩展产品功能：

| 候选 | 当前优点 | 当前阻塞/代价 |
|---|---|---|
| Squirrel `Setup.exe` | Forge 常规消费级路径、per-user/低摩擦 | `Update.exe`/Squirrel events；官方确认写 `SquirrelSetup.log`，与 ADR-09 冲突 |
| Forge WiX MSI | 完整 standalone MSI；autoUpdate 可显式关闭；稳定 `UpgradeCode` | 依赖已退出社区支持的 WiX v3；上游只声明 x86/x64 |
| electron-builder + `nsis` | 单个自包含离线 EXE；per-user/no-admin；x64+arm64 可同一 installer；未发现默认持久 log | 需确认主构建/签名边界；去除 elevate helper；未使用的 LocalAppData installer 副本和手动 downgrade block 未决；必须做解包后文件门 |
| WiX v7 + 最小自有 `.wixproj`/构建适配 | 当前受维护；标准 MSI；per-user、x64/arm64、downgrade block 均可正式表达 | 没有现成 Forge maker；新增小型构建模块；必须批准 OSMF EULA/可能费用并实测签名、scope、升降级与 Arm64 |

当前一手证据已足以排除“不做 spike 直接选 Squirrel 或 Forge WiX v3”，但不足以在 NSIS 与 WiX v7 之间代用户作规范决定。前者 turnkey 程度高但要收紧默认 updater-oriented 残留和自补 downgrade gate；后者 upgrade/downgrade 语义更正式，但引入自有 packaging module 与 OSMF 决策。

MSIX 暂不进入首发最小候选：Microsoft 文档表明它引入 package identity、虚拟化和平台更新模型，而当前需求没有必须使用这些能力的证据。若以后学校 MDM/Store 形成真实需求再重开，不预建 sparse package 或双安装体系。

### 5.7 不论最终格式都必须冻结的 MSI/安装身份

如果最终采用 MSI，[Microsoft 的 major-upgrade 指南](https://learn.microsoft.com/en-us/windows/win32/msi/preparing-an-application-for-future-major-upgrades)要求新 major-upgrade package 使用新的 package/ProductCode、提升 ProductVersion，并用稳定 UpgradeCode 识别同一产品族；[UpgradeCode 说明](https://learn.microsoft.com/en-us/windows/win32/msi/using-an-upgradecode)也把它定义为相关产品的共享标识。[Microsoft 还提供显式阻止旧包覆盖新版本的模式](https://learn.microsoft.com/en-us/windows/win32/msi/preventing-an-old-package-from-installing-over-a-newer-version)。

所以 ADR/发行配置必须冻结 publisher/product namespace、UpgradeCode、安装 scope、安装位与 app data namespace，明确 major upgrade 与 downgrade-block 规则。`electron-wix-msi` 自己宣称允许 downgrade，不能把它的默认行为直接当作 CourseFlow 政策。

Windows Installer 的 [RemoveFiles action](https://learn.microsoft.com/en-us/windows/win32/msi/removefiles-action)只删除由安装表显式拥有的文件/目录。因此安装位与活动数据必须物理分离，安装数据库、自定义 action 和卸载规则都不得声明 `ActivityControlRoot`、`DataSlotsParent` 或用户 Library。系统根据 policy/命令产生的 Windows Installer 记录属于 OS/installer substrate；CourseFlow 不额外建立自己的安装日志。

## 6. 手动完整安装包升级、数据保留与回退边界

### 6.1 “就地升级”的精确定义

无内置更新检查/下载/安装意味着：

- app 不导入或调用 Electron `autoUpdater`，不含 `electron-updater`、update feed、release polling、后台下载、restart-to-update 或更新设置 UI；
- 用户从 app 外部取得完整、已签名的 DMG 或 Windows installer，并主动运行/替换；
- 安装器只把新 app 位安装到同一产品身份；它不执行 CourseFlow schema migration、Library layout migration、快照重写或用户数据删除；
- 首次启动的新 app 才按 ADR-04/05/07/08 的正式协议判断、备份、迁移、恢复或停止。

macOS 拖换 `/Applications/CourseFlow.app` 与 Windows major upgrade 都可以保留位于独立 app-local root 的数据。这里的“可以”依赖发行配置没有脚本/custom action 触碰数据；不是容器格式自动替 CourseFlow保证。

### 6.2 新 app 第一次启动的次序

研究建议 ADR-10 将以下顺序固定为 release invariant：

1. 在打开 DATA、创建 watcher 或启动普通 Workspace 前解析稳定 `ActivityControlRoot` 与 `DataSlotsParent`；
2. 若 ADR-08 activation journal/session 有 nonterminal operation，先执行确定性 continue/rollback/stop；
3. Main 与唯一 Workspace utility process 完成 exact build/protocol handshake，mixed build 不进入正常流程；
4. 读取 application/schema/format version；future version 立即安全停止；
5. 只有需要写格式迁移时，先创建并验证 ADR-04 migration safety copy，再逐版本迁移；
6. 迁移成功后关闭、重开、做正式 integrity/FK/version 检查，随后恢复临时 lease/watcher/session；
7. 完成相应 packaged smoke 前不把该构建标记为可发布。

“迁移前安全副本”在外部手动安装模型中指**新二进制第一次准备写旧 DATA 之前**，不是在 DMG/MSI 覆盖程序位之前；安装器没有资格读取 CourseFlow schema。

不改变任何持久格式的代码更新无需为了安心而复制整库；一旦 schema、snapshot reader/writer、Library marker/layout 或 activation protocol 会写新格式，就必须走拥有该格式的既有 ADR。Library marker/layout 变化尤其不能混入 DB migration，仍须走 ADR-08 staged activation。

### 6.3 版本回退的硬边界

ADR-04 已决定旧 app 不得打开 future schema。因此：

- **二进制回退不等于产品回退。** macOS 用户可手动放回旧 `.app`，Windows 也可能尝试旧安装包，但旧 app 必须因 future schema 明确拒绝普通打开；
- Windows installer 应默认阻止 downgrade，避免先换成旧程序后才发现数据不可读；macOS 没有安装器级同等强制门，必须依赖 app 的 future-schema gate；
- 真正回退必须把“受信任的旧签名 app 位”和“与其兼容、已验证的 pre-migration safety copy”作为一个显式恢复操作；不能用旧 app 直接猜测性逆迁移；
- 回到迁移前副本会丢弃迁移后产生的新事实，不能声称可自动 merge；
- 常规 ADR-07 BackupSet 与 migration safety copy 的用途不同，不能用保留中的任意云端 snapshot 代替更新回退证据。

### 6.4 safety-copy 生命周期仍需决定

ADR-04 把 migration safety-copy 保留/清理交给 ADR-10，但没有产品证据支持任意天数。本研究能证明的最小安全规则是：

- 新格式写入前必须先创建并验证副本；
- 新 app 成功迁移、关闭、重开和验证之前绝不清理；
- 替换上一份 rollback copy 时，必须先让新副本完整可验证；
- migration 代码本身不在“成功”分支顺手删除唯一副本；
- 清理策略不能依赖生产诊断或后台服务。

仍需用户在 ADR-10 决定以下之一：

1. 保留最近一次 verified pre-migration copy，直到下一次格式迁移已经产生新的 verified copy或用户显式删除；回退窗口最长，但占用本地磁盘；
2. 在“新版本已通过完整 reopen + 至少一份当前格式的已验证 ADR-07 snapshot + 明确的版本/时间窗口”后删除；磁盘可控，但没有配置备份时需要另一个明确停止条件；
3. 首发不承诺跨版本产品回退，只保留 safety copy 供迁移失败自动恢复，并在文档中明确“升级成功后只能继续向前”；实现最小，但用户保护最弱。

这三种是决策输入，不是本文替用户选择的规范。

## 7. `ActivityControlRoot`、`DataSlotsParent` 与 Electron 路径语义

### 7.1 Electron 默认路径不能直接当作数据契约

[Electron `app.getPath`](https://www.electronjs.org/docs/latest/api/app#appgetpathname)定义：

- `appData` 在 Windows 是 `%APPDATA%`，在 macOS 是 `~/Library/Application Support`；
- `userData` 默认是 `appData` 加应用名，按惯例保存配置；Electron 特别提醒某些环境会把它备份到云端，不宜放大文件；
- `sessionData` 默认等于 `userData`，其中 Chromium cache/state 可能很大，可在 app ready 前改到别处；
- 访问 `logs` path 会创建 log directory，ADR-09 下生产代码不应调用 `app.getPath('logs')` 或 `app.setAppLogsPath()`。

所以 Windows 上直接接受默认 `userData` 会落到 roaming `%APPDATA%`，与 ADR-08 的稳定本地、非 known-cloud-or-remote、同卷要求不够吻合；把 Chromium session/cache 与活动恢复 journal 混在同一目录也会污染所有权和清理边界。

### 7.2 平台一手语义

[Microsoft Known Folder 文档](https://learn.microsoft.com/en-us/windows/win32/shell/knownfolderid)把 `FOLDERID_LocalAppData` 定义为 `%LOCALAPPDATA%` 对应的本机每用户应用数据，把 `FOLDERID_RoamingAppData` 定义为 `%APPDATA%` 对应的 roaming 数据。CourseFlow 的本地活动真相不应跟随 roaming profile。

[Apple File System Programming Guide](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/FileSystemProgrammingGuide/AccessingFilesandDirectories/AccessingFilesandDirectories.html)要求应用通过系统 API 取得 user-domain Application Support，并在其下使用 app bundle identifier；不能把 `~/Library/...` 的字符串硬编码成协议。

### 7.3 候选布局与边界

**研究建议**以平台 API 解析一个稳定 `StableAppLocalRoot`：

```text
macOS:   user-domain Application Support/<stable bundle identifier>/
Windows: FOLDERID_LocalAppData/<stable publisher>/<stable product identifier>/

<StableAppLocalRoot>/
  activity-control-v1/       # ADR-08 ActivityControlRoot
  data-slots-v1/             # ADR-08 DataSlotsParent，同一受支持本地卷
  chromium-profile/          # Electron userData/Chromium profile，非正式领域真相
  chromium-session/          # sessionData/cache，可重建且独立清理
```

该布局有三项仍需实现验证，不能只凭字符串满足：

- Windows TypeScript/Electron 层如何通过最窄的平台 adapter 可靠解析 `FOLDERID_LocalAppData`；若使用环境变量，缺失/相对/重定向时必须停止，不能 fallback 到 roaming；
- 解析后的绝对路径仍要按 ADR-05 的 location evidence 判断 local/known-cloud-or-remote/unknown，并证明 `DataSlotsParent` sibling 同卷；
- 首发 bundle/product namespace 一旦登记，显示名、本地化或安装格式变化都不得自动迁移到新 root；若以后真要换 root，必须新 ADR + staged migration，不做隐藏 fallback/双写。

`ActivityControlRoot` 与 `DataSlotsParent` 不是用户可选择的第四、第五个目录；Library 与 backup destination 仍保持各自既有选择和验证协议。安装器不得把整个 `StableAppLocalRoot` 作为其 owned component。

## 8. 发行配置如何保证无遥测、崩溃报告与诊断日志

### 8.1 Electron 的 opt-in 边界

[Electron `crashReporter`](https://www.electronjs.org/docs/latest/api/crash-reporter)只有调用 `crashReporter.start()` 后才收集崩溃；即使 `uploadToServer: false`，它仍会在本地收集/保存 Crashpad 数据，而且 start 后不能在本次 app 生命周期中关闭。故正确做法是**完全不 import/start**，不是 `start({ uploadToServer: false })`。

[Electron 环境变量文档](https://www.electronjs.org/docs/latest/api/environment-variables)列出的 `ELECTRON_ENABLE_LOGGING`、`ELECTRON_LOG_FILE`、`ELECTRON_LOG_ASAR_READS`、`ELECTRON_ENABLE_STACK_DUMPING`属于调试能力；[command-line switches](https://www.electronjs.org/docs/latest/api/command-line-switches)中的 `--enable-logging=file`、`--log-file`、`--log-net-log`同样会创建持久文件。生产 launcher、shortcut、installer 与 CI release config 均不得注入这些开关。

同时不引入 Sentry 等 crash/telemetry SDK，不调用 `contentTracing`、`netLog`、`process.report` 或 app log path，不配置 Forge publisher/update feed，不允许失败路径发出网络请求。正式 operation receipt、manifest、activation journal 和 migration record 是正确性真相，继续受各 owner 白名单约束，不能扩大为事件日志。

### 8.2 可判定的 release gate

仅审查源代码不足以证明第三方打包器没有 artifact。每个最终签名 artifact 都应在 clean profile 上执行：

1. 静态审计 ASAR、unpacked files、native support binaries、installer tables/config 与依赖锁，拒绝 crash/telemetry/update/logging SDK、endpoint、Squirrel updater/log surface或调试开关；
2. clean install → 多个代表性成功/失败 → process crash → restart recovery → upgrade → uninstall/reinstall，全程禁网；
3. 前后比较 app-owned 目录与网络请求，证明没有 CourseFlow-owned diagnostic/log/crash/telemetry artifact，只存在既有正式协议记录；
4. 明确区分 macOS Gatekeeper/notary、Windows Installer/Event Log/OS crash UI 等 OS-owned 记录：CourseFlow 不读取、导出、关联或依赖它们；
5. 任何安装器主动创建的自有 log 都算候选不合格，除非 ADR-09 owner 已明确证明它属于不可控制的 OS substrate；不能在测试后删除来伪造“没有创建”。

这正是 `TEST-PRIVACY-001` 在 ADR-10 的 packaged 落地，不新建一套诊断测试体系。

## 9. 候选首发 OS/CPU/artifact 矩阵

以下矩阵只是让取舍可见；每一行都假定 macOS 13+、Windows 11 中已声明且仍受 Microsoft 支持的 edition/version，且 runtime 是 release 时仍受 Electron 支持的精确 stable patch。

| 候选 | macOS artifact | Windows artifact | 原生 CPU lanes | 收益 | 代价/风险 |
|---|---|---|---:|---|---|
| A. 最小可证明 | arm64 DMG | x64 完整 installer | 2 | 最少 build/sign/test surface；与当前主流新 Mac、绝大多数 Windows 对齐 | 不支持 Intel Mac；Win Arm 只可作为未承诺的 x64 仿真观察 |
| B. macOS 覆盖均衡 | universal DMG | x64 完整 installer | 3 | 一个 DMG 同时覆盖 Intel/Apple Silicon | universal 近两份 app 体积；必须有真实 Intel Mac 与 Apple Silicon gate |
| C. 双平台广覆盖 | universal DMG | x64 + arm64 完整 installers | 4 | 两个平台都原生覆盖主流 CPU | Windows arm64 installer/toolchain 仍未证明；签名、恢复、preview、性能和 reference device 成本最高 |

**研究建议但非决定：**

- 若团队有可持续的真实 Intel Mac reference device，B 是覆盖与复杂度较均衡的候选；没有该设备时，诚实发布 A 比“构建了 universal 但没在 Intel 验证”更符合 G6；
- Windows 首发先做 x64；Windows arm64 只有安装器 spike 与原生设备全套 gate 通过后进入 C；
- 不发布 Windows ia32；
- 不把 Windows x64-on-Arm 仿真或 Rosetta 观察写成 native support。

### 9.1 每个受支持 lane 的最小测试点

每个 native CPU lane 至少覆盖：

- 产品声明中的最老受支持 OS/edition 与该 CPU 上最新受支持 OS；若同一实体设备无法覆盖，用版本化 VM/额外 reference device，但签名、硬件/文件系统和性能结论仍需真实设备；
- final DMG/installer 的 clean install、断网首次启动、重启、uninstall/reinstall；
- 从每个仍受 CourseFlow 支持的已发布版本执行完整手动升级；至少保留 earliest-supported、previous、current schema/format fixtures；
- downgrade installer 拒绝、future schema app gate、migration failure 自动恢复与显式 safety-copy 回退边界；
- `TEST-PLATFORM-001–004`、`TEST-PRIVACY-001`、ADR-04/05/06/07/08 的 packaged obligations；
- Unicode/空格/长路径、权限撤销、同卷/跨卷、文件占用、禁网、系统打开/preview、backup/restore/failpoint；
- G7 的冷启动、迁移、备份/恢复、峰值 RSS/磁盘与核心交互影响；
- macOS `codesign`/`spctl`/stapler 和 Windows SignTool/installer identity 的机器可验证结果。

“构建成功”或模拟器启动不能替代这一矩阵。

## 10. 发行 manifest、升级集合与复验策略

每个 release 应记录而不是推测：

- CourseFlow semantic version、build identity、Git commit、Workspace protocol、schema/application/format/limits versions；
- Electron、Chromium、Node、V8、SQLite 的 packaged 实际值；运行测试同时检查 `process.versions` 与 `select sqlite_version()`，不能只抄 `package-lock`；
- PDF.js/worker 与其他影响 preview/格式的精确版本；
- Packager、Forge、maker/installer toolchain、signing/notarization tool version；
- artifact OS、CPU arch、容器格式、签名 identity、timestamp/notary result；
- stable bundle identifier、Windows product/publisher namespace 与 UpgradeCode；
- 实际通过的 OS edition/version/build 与 reference-device profile。

manifest 只含版本和可公开发行元数据，不含证书、私钥、token、绝对用户路径、文件内容或诊断事件。

任何 Electron/Node/SQLite/PDF.js、installer toolchain、签名策略、最低 OS/CPU 或持久格式变化都形成一个完整 requalification set：不能只跑 UI smoke。Electron 每八周 major、三条 stable 的支持节奏意味着 ADR 应规定“如何滚动并重验”，而不是假装初始版本永不升级。

## 11. 仍需 ADR-10 决定的问题

1. 直接分发是否获批为唯一首发渠道；Store 是否明确延后到新 ADR；
2. macOS 首发 A（arm64-only）还是 B（universal），以及是否有可持续 Intel reference device；
3. Windows 首发是否只承诺 x64；何种证据才触发 arm64；
4. Windows 支持哪些 edition，采用“仍受 Microsoft 服务”策略还是固定 feature-release floor；
5. Windows installer spike 选择：Squirrel 是否因持久安装日志直接淘汰；Forge WiX v3 是否因 EOL 直接淘汰；electron-builder + NSIS 能否去除默认 elevate helper 和未使用的 LocalAppData installer 副本、以最小 include 可靠拒绝手动降级；还是批准 WiX v7 的最小自有 `.wixproj`/构建适配及其 OSMF EULA/成本；
6. Windows 签名主体能否使用 Azure Artifact Signing，还是因地区/主体条件选择 OV；如何在 release CI 隔离 signing secret；
7. stable macOS bundle ID、Windows publisher/product namespace、UpgradeCode 与 app-data namespace 的首发登记值；
8. Windows `FOLDERID_LocalAppData` 的最窄解析 adapter，以及无法证明 local/same-volume 时的停止行为；
9. migration safety-copy 的保留窗口、清理触发和用户可见回退承诺；
10. “支持的旧 CourseFlow 版本集合”是上一 public version、最近 N 个版本，还是按 schema/format reader window；
11. 最终 runtime 应在 v44 stable 后重新资格认证，还是先锁 v43.4.1；无论哪种都必须记录精确 patch 并遵守 Electron EOL；
12. 真实 macOS Intel/Apple Silicon、Windows x64/Arm reference devices 与 G7 预算由谁提供和维护。

## 12. 研究结论

一手资料支持以下方向，但仍不替用户作规范决定：

- 首发产品下限宜为 macOS 13+ 与 Windows 11，不把 Electron v43 的 macOS 12/Windows 10 技术尾部支持升级成产品承诺；
- macOS 直接分发最简闭环是 native slices → 必要时 universal → Developer ID Application/hardened runtime/timestamp → signed DMG → notarytool → staple/validate → clean Mac 离线首次启动；
- Windows 必须签内层 PE 与外层完整 installer，保持稳定产品身份并拒绝 downgrade；Squirrel 的主动本地安装日志与 Forge WiX maker 的 EOL WiX v3 依赖都构成真实阻塞；electron-builder + NSIS 是可生成单个 per-user/no-admin 离线 EXE 的候选，但未使用的 LocalAppData installer 副本和 downgrade block 仍未解；WiX v7 是受维护的 MSI 路径，但需自有最小 packaging module 与 OSMF 批准；两者都必须先做有界 installer spike；
- 完整安装包只替换 app 位，数据迁移属于新 app 首启时的 ADR-04/08 协议；二进制回退不能越过 future-schema gate；
- Windows 活动真相宜置于 LocalAppData 而非 Electron 默认 Roaming userData，macOS 宜使用系统解析的 user-domain Application Support；Chromium profile/session 与正式控制/数据槽分离；
- 无诊断要求必须审计最终安装器和第三方 support binaries，不能只确认业务代码没调用 `crashReporter`；
- 最小可诚实发布矩阵是 macOS arm64 + Windows x64；universal Mac 或 Windows arm64 都应以真实设备和完整 packaged gate 扩展，而不是仅凭能构建就宣称支持。

本研究没有运行真实签名、公证、SmartScreen reputation、installer upgrade、clean-profile artifact diff、macOS/Windows native device、failpoint 或 G7 实验；这些仍是 ADR-10 决定后的实现验收义务，不是已通过结果。
