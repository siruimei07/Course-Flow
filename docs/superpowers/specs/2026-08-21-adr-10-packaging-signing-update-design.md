# ADR-10 打包、签名、更新与平台发布设计讨论记录

> 状态：已批准
> 日期：2026-08-21
> 决策主题：`ADR-TOPIC-10`
> 正式决议：[ADR-10](../../architecture/adr/ADR-10-packaging-signing-update.md)
> 调研证据：[ADR-10 一手资料研究](../../research/adr-10-packaging-signing-update-research.md)

## 1. 分类与目标

本轮使用 Superpowers brainstorming 工作流，决定 CourseFlow 第一个公开版本的发行边界，而不是开始实现安装器或发布脚本。目标是让用户能够从唯一可信渠道取得完整、可验证的 macOS/Windows 版本，手动更新后继续使用原有本地数据，并在前向 schema migration 后仍拥有一个明确、可中断、可恢复的显式回退路径。

决策范围包括：

- 首发平台、架构和每版支持声明；
- 应用身份、版本、`appBuildId` 与制品命名；
- Electron/Forge/WiX 的打包职责；
- macOS Developer ID、公证和 Windows Authenticode；
- 安装器与稳定每用户数据根的所有权；
- migration safety copy 的保留、删除与精确版本回退；
- ASAR、Electron fuses、正式包内容和调试入口；
- GitHub Releases 人工发布、manifest、重新下载验证和成功边界；
- 产品、架构、契约、UI 与测试追溯。

不在本轮实现自动更新、商店分发、额外架构、签名 CI、诊断/日志、账号或远程发布服务。

## 2. 决策前审阅

在形成决策前完成以下审阅：

1. 读取当时仓库全部 36 份现行 Markdown 文档；按仓库规则排除已归档 `ATTEMPT.md`，不从旧实现继承技术选择。
2. 复核 `PROJECT_BRIEF`、`PRD`、`MVP_SCOPE`、User Flow、UI 规格、Architecture、Module Contracts、ADR-01–09 及现行 research。
3. 检查 286 个本地 Markdown 链接，未发现缺失目标。
4. 以 Electron、Electron Forge、Apple、Microsoft、WiX Toolset、GitHub 等一手资料建立独立 research 文档；版本事实以 2026-08-21 为研究日期，正式发布时必须重新冻结。
5. 确认 ADR-04 已把 migration safety copy 的保留/清理与应用回退留给 ADR-10，ADR-08 已把 `ActivityControlRoot`/`DataSlotsParent` 的绝对平台位置留给 ADR-10，ADR-09 要求正式制品证明无生产诊断、日志、崩溃收集、遥测和支持包。

审阅只发现一项术语歧义：Module Contracts 两处“数据库日志检查”实际指 SQLite WAL/sidecar 与关闭状态，必须改名，避免与 ADR-09 的诊断日志混淆。

## 3. First Principles 边界

### 3.1 用户结果

- 用户只需在 GitHub Releases 手动取得一个完整版本，不需要账户、更新服务或后台网络。
- 安装、升级、卸载和回退不会让安装器取得用户数据所有权。
- 新版本需要迁移数据时，任何 schema 写入前都有已验证安全副本。
- 回退只指向一个确切、已签名、能解释该副本的 CourseFlow 版本，不让用户猜测安装包。
- 两个平台只有在最终安装形态均通过后才形成一个公开版本。

### 3.2 不变量

- 正式结构化数据和真实资料库仍是本地真相；GitHub 只分发程序制品。
- Main、Renderer 与 Workspace utility process 必须来自同一 `appBuildId`。
- 安装器不读取、迁移、恢复或删除活动数据、资料库、备份、安全副本或 ActivityControl 状态。
- 旧应用不得打开未来 schema；新应用不得在没有安全副本时执行前向迁移。
- 任何公开制品都必须经过目标平台原生签名/公证和安装后验证；没有未签名 fallback。
- 生产应用不检查更新、不下载制品、不启动 updater，也不创建诊断或日志数据面。

### 3.3 完成证据

- 原生目标平台上最终 DMG/MSI 的签名、安装、离线首次启动与核心 E2E；
- migration/rollback 每阶段 failpoint、重启、错误 build、取消与成功边界；
- ASAR/fuse/篡改/调试入口和无运行时下载检查；
- GitHub draft 手工上传后重新下载的逐字节、签名与安装复核；
- Requirement → MOD/IF/FLOW/Q/G/TEST 完整追溯。

## 4. 比较过的总体方案

### A. GitHub Releases + 外部手动更新 + 原生签名双平台制品（采用）

运行时没有更新器；Forge 负责 Electron app packaging 和 macOS DMG，Windows 用独立 WiX v7 MSI。两台受控原生主机各自签名，用户手工上传，发布后重新下载验证。该方案与离线、无账户、最小网络面和用户手工发布方式一致。

### B. Electron `autoUpdater` + Squirrel（拒绝）

需要 feed、下载、安装状态机、签名更新目录、失败恢复和额外 Windows 安装体系；当前没有自动更新产品 Requirement，也会扩大网络与兼容面。

### C. Mac App Store / Microsoft Store（拒绝）

引入 sandbox、商店身份、审核、打包格式和更新语义，改变当前 Developer ID + MSI 边界。未来若需要商店渠道，必须独立决策。

### D. unsigned zip/portable app 或自签名 fallback（拒绝）

不能建立稳定平台信任、安装身份或可靠升级边界，也会让用户在签名失败时承担不可判定风险。

### E. 完全自建跨平台 packager/publisher（拒绝）

重复 Electron Forge 已提供的 app packaging、macOS nested signing 和 DMG 能力。当前只为 WiX v7 保留最小自有 Windows 项目，因为 Forge 的 WiX maker 仍绑定不同代际工具链。

## 5. 逐节批准的设计

### 5.1 发布身份、平台和渠道

- 正式应用 ID 固定为 `io.github.siruimei07.courseflow`。
- 公开版本采用三段 SemVer，tag 为 `v<version>`；`appBuildId` 同时绑定版本与完整 Git commit。
- 首发仅提供 macOS arm64 与 Windows 11 x64。
- 每次公开发布只承诺发布冻结时最新稳定 macOS arm64 与最新稳定 Windows 11 x64；精确 OS/build/参考设备写入 manifest，旧 OS 和其他架构不作承诺。
- GitHub Releases 是唯一公开渠道；固定资产为 arm64 DMG、x64 MSI 和 `courseflow-release-manifest-v1.json`。
- 开发基线为 Electron 43.4.1、Forge 7.11.2、WiX Toolset SDK 7.0.0；公开发布重新选择并锁定当时最新稳定 Electron patch，任何变化重跑完整门禁。

### 5.2 安装、数据根与迁移回退

- Windows 是 per-machine Program Files MSI；macOS 用户手动复制到 `/Applications`。
- 安装器只拥有程序文件、快捷方式和卸载登记；卸载保留用户数据。
- 每用户稳定根位于 macOS Application Support 或 Windows LocalAppData 的应用 ID 名称空间，包含 `activity-control-v1/`、`data-slots-v1/`、`chromium-profile/` 和 `chromium-session/`。
- 前两者是正式控制/数据位置；Chromium 目录不承载领域事实并可重建。不能证明本地/同卷条件时停止，不选择 fallback 目录。
- 只有真实前向迁移才创建一份已关闭、完成 checkpoint 且重新验证的 migration safety copy；新副本验证成功后才能替换旧副本，最多保留一份，直到下一次迁移或用户显式删除。
- 回退只使用该副本声明的最新已签名兼容版本。用户确认迁移后结构化数据损失，应用建立 `MigrationRollbackSessionV1`/handoff，执行同卷 DATA 槽位准备并退出；用户在应用外更换精确版本后继续。
- DATA 拥有副本和物理槽位；PROTECT 拥有 ActivityControl handoff、确认与互斥；WORKSPACE 拥有 exact-build 启动分类；LIBRARY 只在完成时全量对账现存真实文件。

### 5.3 打包与正式运行边界

- 开发构建固定使用 `.dev` 身份和独立数据根，运行时不能切换为 production。
- 两个平台都从干净 checkout、锁定依赖和明确架构在原生主机构建。
- macOS 使用 Forge Packager + DMG；Windows 以 Forge packaged app 为输入，由最小自有 WiX v7 工程生成 x64 per-machine MSI。
- Windows `UpgradeCode` 永久稳定、每版新 `ProductCode`、major upgrade、直接 downgrade 阻断、无 custom action。
- 应用代码默认进入 ASAR；仅实际需要的原生模块解包。正式包排除测试、source map、开发依赖、缓存和调试入口，不从用户可写位置加载代码，也不在首次启动下载二进制。
- 正式包启用 embedded ASAR integrity 和 only-load-from-ASAR，禁用 RunAsNode、NODE_OPTIONS 和 CLI inspect fuses；fuse 在最终签名前设置。

### 5.4 签名、公证和密钥

- macOS 使用 Developer ID Application、固定 Team ID、Hardened Runtime、安全时间戳、最小 entitlement；不启用 App Sandbox 或 `get-task-allow`。最终 DMG 经 `notarytool --wait`、staple、validate 和断网 Gatekeeper 首启。
- Windows 使用 CA 签发 OV Authenticode；不可导出私钥保存在硬件令牌、受控签名设备或等价 provider HSM。所有最终 PE 和 MSI 使用 SHA-256 + RFC 3161 时间戳。
- 正式私钥/凭据不进入仓库、应用数据或无密钥隔离的 GitHub Actions；签名、公证或时间戳失败即阻断发布。
- 正常证书续期可以保持身份；Team ID、Windows publisher 主体或托管边界变化必须重新评审。

### 5.5 Manifest 与人工发布

- 两个平台嵌入 `BuildDescriptorV1`；最终签名后生成外部 release manifest，记录源提交、实际运行时/工具链、格式版本、支持环境、签名/公证状态、制品 size/SHA-256、rollback target 和 TEST ID 状态。
- 操作系统签名/公证证明制品来源；manifest SHA-256 只绑定精确字节，不假装是第二套认证。V1 不增加 detached signature。
- 用户把三个资产手工上传到 GitHub draft release；从 draft 重新下载并复核两平台制品后才公开。
- 一个版本必须同时通过两个平台；公开后 tag/资产不可覆盖，问题以新 patch 解决。所有可能作为 migration rollback target 的签名发布长期保留。
- GitHub Actions 只做无秘密检查；未来签名 CI、自动发布或自动更新均需新 ADR。

### 5.6 规范与测试同步

- 产品新增 `A-DATA-007`、`A-PLATFORM-002–004`、`STATE-007`、`NFR-012`、`MVP-DOD-009` 与 `NG-019`。
- 新增 `UF-A-09`、`UI-DATA-03`、`FLOW-07`、`Q-RELEASE-01` 与 `G8`。
- 不新增运行时 RELEASE/UPDATE 模块；新增 DATA migration 与 PROTECT migration-rollback 窄契约。
- 新增 `TEST-RELEASE-*` 及 DATA/PROTECT/WORKSPACE/SHELL 对应 obligation，并扩展 packaged `TEST-PRIVACY-001`。
- 把两处“数据库日志”改为 SQLite WAL/sidecar 状态。

## 6. 批准记录

用户逐项批准了：

1. 外部手动更新、GitHub Releases 唯一渠道和人工上传；
2. macOS arm64 / Windows x64 及每版冻结最新稳定 OS；
3. Windows per-machine WiX v7 MSI、稳定 UpgradeCode 和数据保留；
4. Electron/Forge/WiX 版本冻结与完整重验；
5. 稳定应用 ID、平台数据根、最近一份 migration safety copy 与精确版本回退；
6. Windows OV Authenticode、macOS Developer ID/notarization 和受控原生主机；
7. Forge 最小职责、ASAR/fuses、无正式调试入口；
8. manifest、双平台完整发布、重新下载验证、资产不可变与长期 rollback target 保留；
9. 产品、UI、架构、契约和测试的完整同步范围。

## 7. 覆盖与扩展审阅

- 离线/无账户：应用不检查或下载更新；签名和发布发生在开发者控制面。
- 数据安全：安装器不拥有数据，迁移先安全副本，回退按 exact build 和持久 handoff 收敛。
- 跨平台：领域/Workspace 契约不变，平台差异只在 packaging/signing/path adapter 和证据门。
- 隐私：不新增日志、诊断、崩溃、遥测、支持包或错误网络请求。
- 可访问性：迁移、等待版本、确认和 recovery 均有键盘、焦点、文字与状态公告义务。
- 扩展性：manifest、BuildDescriptor、目录和 handoff 显式版本化；新架构/渠道增加独立 lane，新自动更新协议另建 ADR，不预建空模块。
- 与 ADR-04/08：保持 forward-only schema、unknown-future stop、ActivityControlRoot 所有权和无部分成功；migration rollback 不是 BackupSet 或 RestoreSession。

## 8. 权限边界

本讨论批准 ADR 与上游规范同步，不授权开始应用实现、创建安装器工程、购买证书、申请 Apple 账号、生成生产密钥、发布 GitHub Release 或增加依赖。实现必须等待后续 roadmap/work package，并以全部目标 TEST obligation 为完成标准。
