# ADR-01：桌面运行时、UI 技术与本地应用边界

- 状态：已接受
- 日期：2026-08-19
- 决策主题：`ADR-TOPIC-01`
- 决策者：项目负责人
- 协作者：Codex

## 1. 背景

CourseFlow 是面向 macOS 与 Windows 的单用户、本地优先桌面应用。核心能力必须离线工作，Shell 只能通过 `IF-WORKSPACE` 访问应用能力；数据库、文件系统、备份与平台 API 不得泄漏到 UI。产品同时要求高密度桌面界面、完整键盘与辅助技术支持，以及可降级的半透明白色磨砂玻璃视觉。

项目由个人与 Codex 协作开发。项目负责人要求只维护一套通用编程语言，不把真正的 Apple Liquid Glass 作为硬性验收，也不为视觉效果维护 Swift、Rust、C# 或 C++ 平台代码。

本决策基于 [桌面 UI 与运行时生态调研](../../research/desktop-ui-ecosystem-adr-research.md)。旧实现记录 `ATTEMPT.md` 中的 Next.js、远程服务、PostgreSQL、对象存储与容器部署不是当前基线。

## 2. 决议

### 2.1 运行时与语言

CourseFlow 采用 **Electron + React + TypeScript** 构建一套 macOS/Windows 桌面客户端：

- TypeScript 是项目自有应用代码的唯一通用编程语言；
- React、HTML 与 CSS 实现 `MOD-SHELL`；
- CSS 与 SQL 分别是样式语言和查询语言，不视为额外通用编程语言；
- 项目不自有或维护 Swift、Rust、C#、C++ 平台实现；
- 任何包含原生二进制的第三方依赖必须由其对应 ADR 单独论证、固定版本并接受双平台发布验证；
- 不运行本地 HTTP 后端，不引入远程后端、PostgreSQL、对象存储或容器作为核心运行条件；
- Renderer 的可执行代码、样式和应用资产只来自随应用签名和打包的资源，不执行远程代码，核心闭环不进行网络请求；用户文件只能经 `accessResource` 授予的受控资源通道作为非可执行内容加载。

构建器、组件库、状态库与 SQLite 驱动不由本 ADR 选择。只有在它们形成跨切面约束时才追加最小 ADR；否则按工作包依赖规则选择。

### 2.2 应用边界

Electron Renderer 只拥有页面、临时编辑状态、焦点、键盘与可访问呈现。其唯一应用入口是预加载脚本暴露的类型化 `window.courseFlow`，并与 `IF-WORKSPACE` 的五种逻辑能力一一对应：

```text
window.courseFlow.query(...)
window.courseFlow.execute(...)
window.courseFlow.preview(...)
window.courseFlow.observe(...)
window.courseFlow.accessResource(...)
```

不得向 Renderer 暴露原始 `ipcRenderer`、Node.js、Electron、SQLite 连接、可充当文件权限的路径句柄、任意文件系统 API 或任意 shell 执行能力。为满足 `UI-FILE-02`，Workspace 投影可以返回只读展示用的真实绝对路径字符串；Renderer 不得凭该字符串读取、写入、定位或打开文件，所有资源动作仍须以 `FileId` 和 verification stamp 通过 `accessResource` 重新验证。Renderer 不得绕过 Workspace 直接调用领域模块或平台适配器。

默认安全配置为：

- `nodeIntegration: false`；
- `contextIsolation: true`；
- `sandbox: true`；
- 窄白名单 IPC，逐项验证调用方、输入、资源身份和能力状态；
- 限制导航、新窗口、权限请求与外部 URL；
- 使用限制性 Content Security Policy。

Electron privileged side 承担应用生命周期、`IF-WORKSPACE` 宿主和平台适配器。领域模块、SQLite 所有者及长操作具体部署到 main、worker thread 或 utility process 的方式由 `ADR-TOPIC-02` 决定；本 ADR 不因物理合并而放宽任何逻辑依赖。

### 2.3 玻璃视觉与平台增强

产品目标是可访问的 **Liquid-Glass-inspired** 视觉，不宣称使用 Apple 原生 Liquid Glass：

- 内容层使用 CSS 半透明背景、`backdrop-filter`、描边、阴影和色彩混合作为共同基线；
- macOS 可用 Electron vibrancy 增强窗口或导航表层；
- Windows 11 支持时可用 Mica 或 Desktop Acrylic 增强窗口表层；
- 业务信息、命令可用性和核心交互不得依赖系统材质是否可用；
- 普通内容卡片使用克制的标准磨砂；更明显的玻璃效果只用于侧栏、工具栏、浮层和重要交互控件，避免多层玻璃堆叠；
- macOS Reduce Transparency / Increase Contrast、Windows Transparency effects / High Contrast、GPU/RDP 或运行时能力不满足时，必须切换为具有足够对比度的不透明或近不透明表面；
- Reduced Motion 下移除非必要形变、视差和大范围过渡，保留状态反馈；
- 颜色不得是状态的唯一表达，焦点环、文字、错误和动态状态必须可被辅助技术感知。

系统材质是渐进增强，不是 MVP 成功条件；共同 CSS 基线和实色 fallback 才是跨平台验收基线。

## 3. 架构映射

本 ADR 实现但不重定义以下稳定边界：

- 模块：`MOD-SHELL`、`MOD-WORKSPACE`、`MOD-PLATFORM`，并约束所有经 Workspace 暴露的模块；
- 接口：`IF-WORKSPACE`、`IF-STRUCTURED-PROBLEM`、`IF-OPERATION-HANDLE`、`IF-REVISION-ENVELOPE`、`IF-LIBRARY-RESOURCE` 及 PLATFORM 窄能力；
- 数据流：`FLOW-00`–`FLOW-06` 均通过同一 Workspace 边界进入 Shell；
- 质量约束：`Q-LOCAL-01`、`Q-ACCESS-01`、`Q-PORTABLE-01`、`Q-RESPOND-01`、`Q-DIAG-01`；
- 验收门：`G2`、`G6`、`G7`。

## 4. 后果

### 4.1 正向

- macOS 与 Windows 共享 UI、领域类型、Workspace 契约和主要测试资产；
- 同一 Chromium 版本降低富 CSS、动画和页面布局的跨平台差异；
- TypeScript 贯穿 Renderer、IPC 契约与 privileged side，适合个人与 Codex 协作；
- Electron 的进程隔离能把 Shell 与本地高权限能力的边界实现为可测试的 IPC；
- 可使用平台窗口材质，同时保留统一 CSS 与无障碍 fallback。

### 4.2 代价与风险

- Electron 自带 Chromium 与 Node.js，安装包、空闲内存和启动成本通常高于复用系统 WebView 的方案；
- Electron 不自动保证性能、安全或可访问性，主进程阻塞、宽 IPC 和错误 HTML 语义仍会破坏要求；
- macOS vibrancy、Windows Mica/Acrylic 与 CSS 磨砂不会复刻 Apple Liquid Glass 的折射、取样和形变行为；
- 平台窗口材质与系统标题栏行为仍需分别验收。

当前产品文档没有给出包体、内存或毫秒级硬预算，因此不为未测量的体积优势引入第二种通用语言。`G7` 校准若证明 Electron 无法满足已批准预算，应以实测证据重新打开本 ADR。

## 5. 被否决的方案

### 5.1 SwiftUI/AppKit + Windows 原生客户端

可以在 macOS 获得真正的 Liquid Glass，但需要第二套 Windows UI、更多语言和两套可访问性/发布测试。真正的 Apple Liquid Glass 已明确不是硬需求，因此收益不足以承担维护成本。

### 5.2 Tauri 2 + React/TypeScript + Rust

运行时通常更小且 Rust 核心能力强，但需要维护 Rust，并分别验收 WKWebView 与 WebView2。它违反“一套通用编程语言”的当前约束；仅当 G7 的实测硬预算迫使重选运行时时重新评估。

### 5.3 Flutter/Dart

能以 Dart 自绘一致的玻璃风格，但桌面文件预览、Windows SQLite、系统材质和部分平台行为更依赖插件或平台通道。它没有为 CourseFlow 的资料库和恢复要求提供足以抵消生态切换成本的优势。

### 5.4 .NET/Avalonia

C# 可形成强类型单语言方案，SQLite 与桌面数据能力成熟；但 macOS 系统材质增强较弱，达到更高原生保真仍可能需要平台桥接。项目也没有既有 .NET 优势，故不优于 TypeScript/Electron。

## 6. 必须产生的验证证据

在 ADR-01 可视为已落实前，最小双平台 spike 必须证明：

1. Renderer 无 Node/Electron 权限，只能通过类型化 `window.courseFlow` 完成一个 query、一个 command、一个 preview 和一个资源访问；
2. 禁止网络时，应用可从打包资源启动并完成核心保存/重启读取闭环；
3. 同一页面在 macOS 与 Windows 展示 CSS 磨砂、平台材质增强和实色 fallback；
4. Reduce Transparency、Reduced Motion、High Contrast 与强制颜色模式下，键盘焦点、文本、错误和状态仍符合 `Q-ACCESS-01`；
5. 非法 IPC、越权路径、失效资源身份和任意外部 URL 均被拒绝并返回结构化问题；
6. 签名发布构建记录包体、冷启动、空闲/典型内存与动画帧表现，作为 `G7` 校准输入；
7. 静态依赖守卫证明 `MOD-SHELL` 未导入 DATA、领域实现或 PLATFORM adapter。

## 7. 延后决策

- `ADR-TOPIC-02`：main、worker thread、utility process 的部署与故障边界；
- `ADR-TOPIC-03`：SQLite 驱动、连接所有权、事务与并发；
- `ADR-TOPIC-04`：schema、迁移与兼容；
- `ADR-TOPIC-05/06`：监听、索引、文件替换、预览与系统打开；
- `ADR-TOPIC-09/10`：诊断、打包、签名与更新。

这些后续 ADR 不得重新向 Renderer 暴露底层能力，也不得引入第二套产品 UI 或第二种项目自有通用编程语言，除非以新决策明确取代本 ADR。
