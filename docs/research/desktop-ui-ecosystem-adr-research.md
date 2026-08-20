# CourseFlow 桌面 UI 与运行时生态调研（ADR 前置材料）

> 调研日期：2026-08-19
> 问题：为 macOS + Windows、离线本地优先的 CourseFlow 选择语言、UI 与桌面生态；视觉方向包含半透明白色磨砂玻璃和 Apple Liquid Glass 风格。
> 方法：只采用 Apple、Microsoft、各框架/运行时的官方文档或官方源代码；下文的“事实”均紧邻一手链接。“推断/建议”是基于这些事实及 CourseFlow 已确认范围（本地 SQLite、文件资料库、两平台同一核心闭环、键盘可用）的判断，不是框架官方承诺。
> 后续决议：项目负责人已接受 [ADR-01](../architecture/adr/ADR-01-desktop-runtime-ui-boundary.md)；本文保留为决策前证据，具体技术约束以 ADR 为准。

## 先给决策者的结论

**推荐的默认 ADR 候选是 Electron + React + TypeScript，接受“Liquid-Glass-inspired”，而不是承诺真正的 Apple Liquid Glass。** 它对单人开发最少新增语言，Windows/macOS 的网页 UI 行为最一致（同一 Chromium），同时已有官方窗口级 macOS vibrancy、Windows Mica/Acrylic、文件、目录监听、系统打开、SQLite（Node 运行时）和更新路径。代价是发布包与运行时较重；这是一项应由原型实测而非猜测的取舍。

若“在 macOS 上使用**真正由系统生成并随辅助功能设置适配的 Apple Liquid Glass**”是首要且不可妥协的产品要求，正确选项不是任何单一跨平台 UI，而是 **SwiftUI + 少量 AppKit 的 macOS 客户端**，再为 Windows 另做原生客户端（或降低 Windows 视觉同构要求）。这会显著增加 UI、发布与测试面的维护成本；SwiftUI/AppKit 并不产出 Windows 应用。

**不建议把 Tauri 2 作为本项目的默认首选**：它可以完成业务需求，也更小，但 React/TypeScript 之外还需要 Rust；并且 macOS 用 WKWebView、Windows 用 WebView2，富 CSS/可访问性要在两个不同引擎验收。官方/官方组织的 `window-vibrancy` 源码可以在 macOS 26+ 以 `NSGlassEffectView` 做桥接，但这不是 Tauri 核心的跨平台 Liquid Glass API，反而把最想要的效果变成特定平台 Rust/原生集成风险。

以下内容记录作出决策时的 **ADR 建议与证据**；其自身不定义技术选型，后续状态以已接受 ADR 为准。

## 不可混淆的视觉边界

### 事实：Apple Liquid Glass 的 API 边界

Apple 将 Liquid Glass 定义为其最新系统的动态材质。用最新 SDK 构建时，**SwiftUI、UIKit、AppKit 的标准 bars、sheets、popovers、controls 等组件**会在最新 Apple 平台自动采用它；自定义元素才使用 SwiftUI `glassEffect`、UIKit `UIGlassEffect` 或 AppKit `NSGlassEffectView`。[Apple：Adopting Liquid Glass](https://developer.apple.com/documentation/TechnologyOverviews/adopting-liquid-glass)

这意味着：

- 它是 Apple OS/Apple UI 框架的材料与系统行为，不是 CSS 规范，也不是 Windows API。Apple 同时要求对 Reduce Transparency / Reduce Motion 等配置测试；使用标准系统组件会自动适配。[Apple：Adopting Liquid Glass](https://developer.apple.com/documentation/TechnologyOverviews/adopting-liquid-glass)
- AppKit 早已有 `NSVisualEffectView`，可做 translucency、背景模糊与 vibrancy，并提供 in-window / behind-window blending；其具体材料外观可随系统设置改变。[Apple：NSVisualEffectView](https://developer.apple.com/documentation/appkit/nsvisualeffectview)
- React/HTML/CSS、Flutter、Avalonia、Qt/QML 或 Compose 在其自绘/网页控件上画出的 blur、半透明、阴影和动画，是**仿制的视觉语言**，不会让这些控件变成 Apple 系统 Liquid Glass 控件。Tauri 官方源说明它把 UI 渲染在 macOS 的 `WKWebView`、Windows 的 `WebView2`；Electron 则渲染 Chromium 页面。[Tauri 官方源代码](https://github.com/tauri-apps/tauri/blob/dev/README.md) · [Electron：BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)

### 对本项目的推断

把验收语言拆开会避免一个错误 ADR：

| 可验收表述 | 含义 | 可由单一跨平台 UI 可靠达成？ |
|---|---|---|
| “macOS 使用真实的系统 Liquid Glass” | 主要交互组件由 SwiftUI/AppKit 的标准组件或 Apple 专属 Glass API 承担，系统负责辅助功能降级 | 否；需 macOS 原生 UI/桥接 |
| “整体呈现 Liquid Glass 风格” | 自绘/网页/Skia/XAML 模糊、透明、圆角、层次与克制动画 | 是，但每平台皆是设计实现与测试责任 |
| “Windows 也有真实系统磨砂” | 使用 Windows 11 Mica/Desktop Acrylic，而非把 Apple 材质硬拷贝过去 | 是，但取决于 Windows API/后备色 |

Windows 的等价系统材料是 **Mica**（适合长期窗口基础层、取样壁纸）与 **Desktop Acrylic**（可透视的实时磨砂）。WinUI 3 的 `Window.SystemBackdrop` 可设置这些材料；用户关闭 Transparency effects、启用高对比度、使用不支持的 GPU/RDP 等时，系统会降级为实色。[Microsoft：Windows materials](https://learn.microsoft.com/en-us/windows/apps/develop/ui/materials) 因此“透明白色”必须有可读的实色 fallback，不能把模糊当成文字对比度来源。

## 方案横向比较

表中“可行”只说明能实现 CourseFlow 的明确需求；不等于零原生代码、零测试或自动获得某平台的视觉保真。

| 候选 | UI / 语言与视觉实现 | macOS / Windows 一致性 | 本地数据、文件与预览 | 无障碍与偏好 | 打包更新 | 单人维护判断（推断） |
|---|---|---|---|---|---|---|
| **SwiftUI + AppKit** | Swift；标准组件在 macOS 26+ 可真正采用 Liquid Glass；AppKit 可用 `NSVisualEffectView`。 | **无 Windows 客户端**；Windows 需重写 UI/平台层。 | macOS 原生 SQLite/SwiftData、`FileManager`、[`NSFilePresenter`](https://developer.apple.com/documentation/foundation/nsfilepresenter)/FSEvents、[`NSWorkspace`](https://developer.apple.com/documentation/appkit/nsworkspace)、[`QLPreviewView`](https://developer.apple.com/documentation/quicklook/qlpreviewview) 均可接入；全是一个 OS 的问题。 | SwiftUI 标准控件默认有可访问语义；可读 `accessibilityReduceMotion`、`accessibilityReduceTransparency`、`accessibilityDifferentiateWithoutColor`。 | Xcode archive、Developer ID、notarization；更新机制需另选/自建或 App Store。 | macOS 最小复杂度、最高视觉保真；双客户端后总体最高。 |
| **Tauri 2 + React/TS + Rust** | HTML/CSS/React；macOS 的 WKWebView 与 Windows 的 WebView2。可做透明/系统效果，真正 Liquid Glass 需非核心原生桥接。 | UI 代码共享，但两个 WebView 引擎及系统窗口行为需双测。 | 官方 SQL 插件支持 SQLite（迁移原子）；官方 FS、Opener、Updater 插件覆盖基本能力。复杂事务/监听可写 Rust。 | HTML 语义依赖 WebView；需逐平台用 VoiceOver/Narrator/NVDA 验收。Tauri capabilities 默认收紧危险命令。 | 官方可产出平台安装包、签名/公证；官方 updater 需要远程更新源。 | React 已熟悉时前端低门槛，但 Rust、capability、FFI/插件把核心复杂度变成双语言。 |
| **Electron + React/TS** | Chromium HTML/CSS；官方 macOS vibrancy，Windows 11 22H2+ Mica/Acrylic。非 Apple Liquid Glass。 | **最高的 Web UI 渲染一致性**：两端同 Chromium；仍须测各 OS 窗口材质和系统文件行为。 | Node 主进程的 [`node:sqlite`](https://nodejs.org/api/sqlite.html)/[`fs.watch`](https://nodejs.org/api/fs.html#fswatchfilename-options-listener) 与 Electron `shell.openPath`、`showItemInFolder`；可在本机交易/文件边界集中在主进程。 | HTML 无障碍；有 AT 时 Electron 自动启用 Chrome accessibility tree，仍须实际键盘/读屏测试。 | Electron Forge/官方工具链、签名、内建 `autoUpdater`（macOS、Windows）。 | **推荐**：一门主语言、最成熟的桌面 Web API；代价是 Chromium 随包体积、主/渲染进程安全边界。 |
| **Flutter / Dart** | Flutter 自绘控件与动画，可做很丰富的玻璃仿制；不是 Apple 的标准 Liquid Glass。 | 框架渲染一致，但原生窗口、文件预览、材质效果需插件或平台通道。 | 官方 `file_selector` 有原生 picker；SQLite、目录观察、系统预览通常是包或 FFI/平台实现，不是 Flutter SDK 一站式桌面层。 | 有 framework accessibility、`AccessibilityFeatures`（例如 high contrast）；桌面读屏必须实测。 | `flutter build windows/macos`；签名、公证、更新策略另组装。 | 单 Dart UI 直观，但资料库需求很快带来第三方 package/FFI 与双平台原生插件维护。 |
| **.NET + Avalonia** | C#/XAML、Skia 渲染；Windows 支持 transparency/Mica hint，macOS 只支持 transparent，不会自动获得 Liquid Glass。 | 单 UI 代码；控件观感跨平台较一致，但并非 Apple 原生组件。 | `Microsoft.Data.Sqlite` 有事务；[.NET `FileSystemWatcher`](https://learn.microsoft.com/en-us/dotnet/api/system.io.filesystemwatcher)；Avalonia StorageProvider 和 Launcher 覆盖文件 picker/打开文件。 | automation peers 对接 Windows UIA、macOS NSAccessibility；标准控件自带 peer。 | `dotnet publish`、Windows MSIX/installer、macOS `.app` + Apple signing/notarization；更新需要选定机制。 | 强类型单语言、数据层较舒适；为了极致 macOS 视觉仍会落到 Objective-C++/原生桥接。 |

## 逐项证据与风险

### A. SwiftUI / AppKit：唯一的“真实”macOS 答案，但不是跨平台答案

**事实。** Apple 说 SwiftUI 的导航、列表、文本框、按钮等常见元素内建基本辅助功能；在标准元素外可加 accessibility modifiers。[Apple：SwiftUI accessibility](https://developer.apple.com/documentation/SwiftUI/View-Accessibility) SwiftUI 环境也直接提供 Reduce Transparency、Reduce Motion 与 Differentiate Without Color 的偏好值；前两者分别要求不使用半透明窗口背景、避免大型 3D 感动画。[Reduce Transparency](https://developer.apple.com/documentation/swiftui/environmentvalues/accessibilityreducetransparency) · [Reduce Motion](https://developer.apple.com/documentation/swiftui/environmentvalues/accessibilityreducemotion) · [Differentiate Without Color](https://developer.apple.com/documentation/swiftui/environmentvalues/accessibilitydifferentiatewithoutcolor)

**事实。** Apple 建议对频繁变动文档使用 SQLite/SwiftData/Core Data，并明确事务中的多次写入是原子的，失败会恢复事务前状态。[Apple：Reducing disk writes](https://developer.apple.com/documentation/xcode/reducing-disk-writes) 对本项目的受管理文件资料库，原生文件系统观察、系统打开以及 Quick Look 预览可由 Apple 框架完成，但仍需单独定义 sandbox entitlement、权限失效和外部移动的产品语义。

**事实。** 独立分发 macOS 软件需要 Developer ID 签名并按 Apple 的 notarization 流程（有效签名、Hardened Runtime、notary ticket）；Apple 将其与 App Store 分发区分。[Apple：Notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)

**推断。** 若选择它，Windows 不是“适配”，而是第二 UI 与第二桌面壳；只有在 macOS 的真实 Liquid Glass 相比两端共享 UI 更重要时才合理。

### B. Tauri 2：能力足够，真正的成本是 Rust 与 WebView 差异

**事实。** 官方 SQL 插件通过 `sqlx` 支持 SQLite，官方文档明确其 migration 在一个事务内执行，任一 migration 失败会回滚整个集合；其读/写权限也默认不是完全开放。[Tauri SQL plugin](https://v2.tauri.app/plugin/sql/) 官方插件目录列出跨 macOS/Windows 的 `fs`、`opener`、`sql`、`updater` 等插件。[Tauri plugins compatibility table](https://v2.tauri.app/plugin/)

**事实。** Tauri 的 capabilities 将 WebView 可调用的命令/插件权限按 window/webview 限定；这是本地文件资料库的必要安全边界，而不是可省略的配置细节。官方 FS plugin 还以 scope/capability 限制路径、阻止 path traversal，默认不授予整个用户文件系统。[Tauri capabilities](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/security/capabilities.mdx) · [Tauri FS plugin](https://v2.tauri.app/plugin/file-system/) 发布工具覆盖安装器、macOS 签名/公证和 Windows 签名；updater 从远程 server 取得并验证签名的更新 artifact，所以必须默认关闭且绝不能成为离线核心路径的依赖。[Tauri distribute](https://v2.tauri.app/distribute/) · [Tauri updater](https://v2.tauri.app/plugin/updater/)

**事实。** 官方 Tauri 源确认 macOS 使用 WKWebView、Windows 使用 WebView2，而非同一渲染引擎。[Tauri README](https://github.com/tauri-apps/tauri/blob/dev/README.md) Tauri 组织维护的 `window-vibrancy` 源码提供 macOS 26+ `apply_liquid_glass`，底层使用 `NSGlassEffectView`，也列出 Windows blur/acrylic/mica 与 macOS vibrancy；其 README 同时要求透明 WebView/窗口配置并标注一些 Windows 拖拽/缩放性能注意事项。[window-vibrancy 官方组织源码](https://github.com/tauri-apps/window-vibrancy)

**推断。** 后者是可行实验路线，不应被 ADR 记为“React/Tauri 自动支持 Liquid Glass”：它是 Rust + macOS 条件代码，且影响 WebView 视图层级、打包、辅助功能与回退。若试验失败，必须可退化为原生 macOS vibrancy + CSS 风格，而不是阻塞 MVP-A。

### C. Electron：共享渲染最高，需严守进程和文件边界

**事实。** Electron `BrowserWindow` 提供 macOS `setVibrancy`（以及振动效果淡入淡出时长）和 Windows `setBackgroundMaterial('mica' | 'acrylic' | ...)`；后一 API 仅 Windows 11 22H2+ 支持。透明窗口在 Windows 还受 frameless 条件约束。[Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window) 这些是系统材质接口，但不等同 Apple 2026 的 `NSGlassEffectView`/系统标准控件。

**事实。** Electron `shell.openPath` 用桌面默认方式打开文件，`showItemInFolder` 在文件管理器中定位；Node 的文件 API 可置于 main process。([Electron shell](https://www.electronjs.org/docs/latest/api/shell)) Node 的 `fs.watch` 依赖底层 OS 的 watcher（macOS 目录为 FSEvents、Windows 为 `ReadDirectoryChangesW`），并明确其在网络/虚拟化文件系统上可能不可靠，因此监听事件只能触发重扫，不能代替启动时一致性扫描。[Node: fs.watch](https://nodejs.org/api/fs.html#fswatchfilename-options-listener) `node:sqlite` 自 Node 22.5 提供 SQLite，但当前文档仍标为 release candidate；选用它前必须把 Electron 所嵌 Node 版本锁进 ADR 和 CI，而不是假定任何 Electron 版本都有它。[Node: sqlite](https://nodejs.org/api/sqlite.html) Electron 也有 macOS/Windows 内建 `autoUpdater`；macOS 自动更新要求已签名，Windows 随 MSIX 或 Squirrel.Windows 包装自动采用相应机制。[Electron autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater)

**事实。** Electron 的 accessibility 行为与网页相同；检测到 VoiceOver/JAWS 等 assistive technology 时会自动开启 accessibility feature/Chrome tree，也可用 API 手动切换。[Electron accessibility](https://www.electronjs.org/docs/latest/tutorial/accessibility) 官方打包文档也明确 macOS/Windows 签名是面向终端用户分发的必要发布工作，自动更新依赖签名。[Electron packaging](https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging)

**事实。** Electron 将 OS 集成放在 main process，而每个 `BrowserWindow` 都有独立 renderer process。[Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model) Electron 的安全指南要求 context isolation、sandbox、受限 IPC，以及不为远程内容开启 Node integration；其原因正是 JavaScript 能接触文件系统/shell 时会形成高权限边界。[Electron security](https://www.electronjs.org/docs/latest/tutorial/security)

**推断。** 对 CourseFlow，主进程应是唯一能接触 SQLite、资料库真实路径、文件监听、系统打开和备份写入的所有者；renderer 只经窄、白名单 IPC 请求业务 Intent。这是把上述 Electron 边界落实为领域所有权，而非 Electron 自动保证。

### D. Flutter：跨平台动画强，桌面资料库的“最后一公里”较多

**事实。** Flutter 官方支持编译原生 macOS/Windows 桌面应用，也允许每平台插件实现；release 构建为 `flutter build macos` / `flutter build windows`。[Flutter desktop support](https://docs.flutter.dev/platform-integration/desktop) 官方发布的 `file_selector` 使用原生文件选择 UI，macOS、Windows 都支持选单/多文件、保存位置和目录（功能表存在平台差异）；macOS sandbox 还需要相应 user-selected read/read-write entitlement。[Flutter file_selector](https://pub.dev/packages/file_selector)

**事实。** Flutter 提供 framework-level accessibility 与 screen-reader 支持，建议验证高对比度、足够对比、目标尺寸与放大文本；`AccessibilityFeatures` 暴露 bold text/high contrast 等平台偏好。[Flutter accessibility](https://docs.flutter.dev/ui/accessibility) · [Flutter UI design & styling](https://docs.flutter.dev/ui/accessibility/ui-design-and-styling)

**事实。** Flutter 官方 SQLite cookbook 中的 `sqflite` 覆盖 Android/iOS/macOS，未列 Windows；故 Windows SQLite 不是该官方 cookbook 路径自动带来的能力。[Flutter SQLite cookbook](https://docs.flutter.dev/cookbook/persistence/sqlite)

**推断。** 官方桌面文档把 Windows SQLite、文件监听、系统“按默认 app 打开”、内置 PDF/image/text preview 留给 package/FFI/平台通道组合；没有一个 Flutter SDK 官方桌面层同时承担它们。因此它能做，但对于 CourseFlow 的 MVP-B，插件版本、Windows runner、macOS runner 与签名/预览集成是额外风险。

### E. .NET + Avalonia：强数据层与可访问性，macOS 视觉不是原生 Liquid Glass

**事实。** Avalonia 标准 controls 通过 automation peers 暴露到 Windows UI Automation、macOS NSAccessibility；其文档列 Windows/macOS 为 full support，并要求自定义控件补齐 AutomationProperties/peer。[Avalonia accessibility](https://docs.avaloniaui.net/docs/app-development/accessibility) Windows backend 直接使用 Win32；其文档明确 Windows 支持全部 `TransparencyLevelHint`，而 macOS 只支持 `Transparent`，这不能替代 Apple 系统 Glass API。[Avalonia Windows platform guide](https://docs.avaloniaui.net/docs/platform-specific-guides/windows/)

**事实。** Avalonia `StorageProvider` 在 Windows/macOS 都提供打开文件、保存文件、选文件夹和路径查询等接口；桌面 bookmark 在 macOS sandbox 场景仍是规划中的限制。[Avalonia StorageProvider](https://v11.docs.avaloniaui.net/docs/concepts/services/storage-provider/) Windows 上文件对话框走 `IFileDialog`，Launcher 可用关联应用打开文件。[Avalonia Windows services](https://docs.avaloniaui.net/docs/platform-specific-guides/windows/)

**事实。** `Microsoft.Data.Sqlite` 事务将多条 SQL 作为原子单元，失败能回滚；SQLite 默认 serializable，写入并发有单写者限制，适合把 CourseFlow 的提交边界收在一个本地 writer 中。[Microsoft.Data.Sqlite transactions](https://learn.microsoft.com/en-us/dotnet/standard/data/sqlite/transactions) Avalonia 发布可走 `dotnet publish`；其 macOS 文档说明 `.app`、签名、公证、DMG 仍需处理，Windows 可使用 MSIX 等 installer。[Avalonia macOS deployment](https://docs.avaloniaui.net/docs/deployment/macos) · [Avalonia supported platforms](https://docs.avaloniaui.net/docs/supported-platforms)

**推断。** 若团队已有 C#/.NET 能力，这一方案是 Electron 的最强替代：单语言、SQLite 事务很自然、a11y 明确。但为了真实 Liquid Glass 需增加 AppKit/Objective-C++ native host/bridge，抵消了其简洁性。

## 所有候选都必须满足的技术验收门槛

这不是某框架的宣传清单，而是由 CourseFlow NFR 推导的 ADR gate；每一项应在 spike 中于 **macOS 与 Windows** 真实验证。

1. **本地真相与事务。** SQLite schema migration、课程/任务/重复规则的多表修改、备份元数据提交均有明确 atomic transaction；失败后重启验证 UI 未报告未落盘成功。
2. **文件资料库。** 受管理根目录、文件监听的重复/丢失事件、外部移动/权限丢失、默认应用打开、在 Finder/Explorer 定位，以及 PDF/图像/纯文本预览各走真实两平台路径。任何系统 API 只可由平台 adapter/桌面主进程接触。
3. **玻璃降级。** 分别开关 macOS Reduce Transparency/Reduce Motion/Increase Contrast，Windows Transparency effects/High Contrast/电池节能/RDP；文字与焦点指示仍可读、状态不只靠颜色。Windows 官方材料会在这些条件下实色降级，正好可作为测试 oracle。[Microsoft：materials fallback](https://learn.microsoft.com/en-us/windows/apps/develop/ui/materials)
4. **键盘与读屏。** 新建学期、添加课节、任务编辑、备份/恢复确认、文件错误和删除影响范围全程键盘；用 VoiceOver 与 Narrator（必要时 NVDA）读出名称、角色、值、错误和动态状态。
5. **发布而非开发态。** 签名后的 macOS `.app`/DMG 与 Windows 安装包完成首次启动、升级/拒绝升级、离线启动和损坏/旧备份恢复。自动更新可以存在，但无网、无更新源或更新失败必须不影响本地成功。

## 建议的 ADR 选项与最小验证切片

### 建议 ADR 决议（待负责人确认）

1. 采用 **Electron + React + TypeScript** 作为单一 cross-platform implementation 候选；目标是平台化的“玻璃风格”，而非把 Apple 专有 API 误述为跨平台保证。
2. 在 macOS 使用系统 vibrancy 作为窗口/导航表层，在 Windows 11 支持时使用 Mica 或 Desktop Acrylic；业务内容采用统一 CSS，但为每个平台的可读实色 fallback、窗口 chrome 和动画密度设单独 token。
3. 仅当视觉负责人把“真实 Apple Liquid Glass”列为硬验收，改为两个正式客户端：macOS SwiftUI/AppKit 与 Windows WinUI 3（或 Windows 原生等价）。不要在单一 Web/Skia UI 中假装已满足这个验收。
4. 无论哪一种，自动更新为发布附加能力，不进入 MVP-A 离线完成定义。

### 两周以内可完成的选型 spike

不先搭建完整技术栈。每个候选只做同一纵向切片：

- 一个可编辑的“课程 + 事项”SQLite 原子保存；重启验证；
- 一个受管理资料库根目录，监听新建/外部删除，打开及定位一个 PDF，并做内置 PDF/image/text preview 的最小实现；
- macOS 与 Windows 同一页面的 sidebar、toolbar、sheet、card、hover/focus animation，且展示真实材质或明确的仿制；
- 上述辅助功能偏好组合下的截图、键盘录屏与读屏检查；
- 产出签名/未签名 release 包的大小、冷启动、内存、安装/首次启动与更新失败行为记录。

以“所有 gate 是否通过 + 原生桥接代码量/类型数 + 实测包体/启动 + 二平台 a11y 问题数”决定，而不是以静态宣传页或开发机效果决定。

## 非改变结论的补充候选

**Qt/QML 与 Compose Desktop** 都可画高质量自定义材质和动画，但这份调研未找到足以推翻上表的、针对 Apple 2026 Liquid Glass 的官方一等集成证据；它们仍会落在“自绘仿制或 macOS 原生桥接”这一边界。故不应因为它们能做 blur 就把它们升级为本项目的 Apple 视觉保真答案；若未来已有 Kotlin/C++ 团队能力，可另开以文件资料库、a11y、签名/更新为中心的同一 spike。

## 来源范围与时效

- 截止日为 **2026-08-19**。产品、框架和 OS 版本会继续变化；ADR 落地前要重新核对 SDK/API 可用性与目标最低系统版本。
- 所有技术来源是 Apple Developer、Microsoft Learn、Electron/Tauri/Flutter/Avalonia 的官方文档或各项目官方 GitHub 组织源。没有采用博客、媒体、论坛或搜索摘要作为技术事实来源。
- “没有一个框架可替代 Apple 专属 API”的结论来自 API 所属平台与渲染架构的对照，是推断；它不排除未来版本新增官方桥接，也不排除以原生插件实现，但后者仍是平台特定代码。
