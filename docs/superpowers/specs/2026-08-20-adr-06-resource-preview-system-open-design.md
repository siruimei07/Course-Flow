# ADR-06 受验证资源预览与系统打开设计讨论记录

> 状态：讨论已由用户逐项、逐段确认
> 日期：2026-08-20
> 方法：Superpowers brainstorming + primary-source research + Ponytail dependency check
> 权限：非规范性过程记录；技术结论以 [ADR-06](../../architecture/adr/ADR-06-resource-preview-system-open.md) 为唯一真相

## 1. 讨论目标

本轮在 ADR-01–05 已接受的边界内决定 `ADR-TOPIC-06`，重点回答：

- Renderer 如何在不把显示用真实路径变成能力、且不获得 Node/Electron、原始 port 或文件 handle 的情况下预览资源；
- 任意文件可保存时，哪些后缀/内容组合可进入 PDF、图片或文本 parser；
- 大 PDF 的 range、背压、取消、过期和外部变化如何处理；
- PDF、图片、文本的功能、资源限制、安全与无障碍边界；
- system-open/reveal 能诚实承诺什么，哪些高风险文件不得由 CourseFlow 启动；
- 解析/平台失败、诊断和软件更新如何保持隔离、隐私与兼容；
- ADR-06 与 ADR-07/08/09/10 的边界在哪里。

## 2. 决策前审阅

作出任何 ADR 选择前，已重新枚举当时仓库中的 97 个非 Git 文件，并按规范层级审阅全部 26 个 Markdown、逐一核对 50 个 HTML 原型的页面/交互内容，以及 21 个 ignore/runtime-state 项的路径、大小和摘要。工具状态文件只按元数据核对，不读取或披露 token/port；`ATTEMPT.md` 只作为归档旧实现证据，不继承其技术栈、需求或兼容承诺。

重点追溯了 `B-FILE-004/009/010/011`、`UI-FILE-02`、`MOD-SHELL/WORKSPACE/LIBRARY/PLATFORM`、`IF-WORKSPACE.accessResource`、`IF-LIBRARY-RESOURCE`、`IF-SYSTEM-OPEN`、`IF-RESOURCE-PREVIEW`、`FLOW-03`、适用 Q、`TEST-LIBRARY-007`、`TEST-PLATFORM-003`、`TEST-FLOW-03-LIBRARY-RECOVERY` 与 G6/G7。没有发现需要扩大到 HTML/Markdown/JSON/source/SVG/GIF、完整 PDF 编辑器、网络服务或账户的隐藏需求。

一手资料研究位于 [ADR-06 研究记录](../../research/adr-06-resource-preview-system-open-research.md)，覆盖 Electron 安全/IPC/MessagePort/contextBridge/utility/shell/protocol、Node range/stream、PDF.js Display API/range/text/structure/worker、WHATWG MIME/Encoding、PNG/WebP 容器，以及 Windows/macOS 默认打开能力。研究只引用官方规范、项目文档或上游源码，不把搜索摘要或旧项目实现当证据。

## 3. First Principles 与方案比较

讨论先固定四个不可破坏边界：

1. 用户结果是“查看受支持课程资料，或明确交给系统应用”，不是把 CourseFlow 变成任意文件 launcher/browser；
2. 唯一授权是当前 `FileId + expected stamp + purpose` 完整验证后产生的短期能力；路径、后缀、MIME 和旧页面都不是授权；
3. 内容、解析、平台动作失败只影响当前资源表面，正式数据 unchanged，PLAN 继续；
4. 完成必须能在打包后的 macOS/Windows 上以恶意输入、资源边界、无网络和无障碍证据判定。

在此基础上比较了三条数据面路线：

1. Chromium 内建 PDF + 自定义 protocol；
2. Preload 私有 MessagePort credit/range + PDF.js Display API；
3. lease bearer URL/custom protocol + HTTP Range + PDF.js。

用户接受第 2 条。第 1 条依赖 Electron 未公开承诺为 CourseFlow 安全契约的 PDF plugin/embed 行为；第 3 条新增 URL capability、protocol privilege、Content-Range、缓存/referrer 与取消面。第 2 条直接复用 ADR-02 的 Main/utility 资源宿主和 PDF.js 公开 range API，边界最小且可故障注入。

Ponytail 依赖检查据此只批准精确锁定的 `pdfjs-dist` library + 同版 worker；range/file I/O、MessagePort、Blob、ImageBitmap、canvas、TextDecoder 和平台动作使用 Node/Electron/Web 内建能力，不增加 generic viewer、custom protocol server、MIME 猜测库、legacy encoding、图片 parser 或 native addon。

书面终审又发现“已知高风险”若只有类别示例就无法形成确定测试。随后用 Microsoft AppLocker/Shell Links 与 Apple `.command`、installer/disk image、script UTI 一手资料校准了 `LaunchRiskPolicyV1` 的固定 deny suffix set；正式集合只存在于 ADR，讨论记录不再复制。

## 4. 用户逐项确认

用户逐项接受并确认：

1. PDF 提供只读基础阅读：页滚动/跳转、缩放/适合页面、键盘、状态公告，以及可用时的文本层/结构；不提供搜索、活动链接、表单、脚本、XFA、批注、附件、打印或下载。
2. 非高风险普通文件无论是否支持内置预览，都保留“使用系统默认应用打开”；操作系统自行选择浏览器、PDF 阅读器或其他关联应用。
3. 超限、parser 失败或 timeout 时停止内置预览、说明原因、不显示部分内容，并保留当前允许的平台动作。
4. 文本只接受严格 UTF-8，以及带 BOM 的 UTF-16LE/UTF-16BE；不猜 legacy/system encoding，只按字面文本呈现。
5. system-open 只报告 `requested | failed`，不显示“已成功打开”；reveal 是 best-effort requested。
6. 数据面采用 Preload 私有的有界 MessagePort range/credit；原始 port 不进入页面 Renderer，页面只有窄 session facade。
7. 支持后缀固定为 `.pdf`、`.png`、`.jpg/.jpeg`、`.webp`、`.txt/.text/.log`，且必须与内容证据一致；HTML/Markdown/JSON/source/SVG/GIF 等不内嵌。
8. 加密 PDF 不在 CourseFlow 中收集密码；显示 password-required，并保留适用的 system-open/reveal。
9. 预览期间文件、根、权限、stamp、对象、epoch 或协议改变立即撤销 session；旧画面不静默切换，用户必须显式 reload。
10. 动画 WebP 只显示第一帧并标注“动画已暂停”；完整动画交给系统默认应用。
11. 已知可启动的高风险文件——可执行文件、安装包、脚本、快捷方式和 URL 文件——可以保存和 reveal，但 CourseFlow 永不 system-open，且没有应用内 override。
12. `PreviewLimitsV1` 使用已确认的精确数值：4 KiB header、64 KiB range、4/256 KiB lease 并发/in-flight、1/window 与 2/app session、5 分钟 lease、5 秒 range、PDF 512 MiB/10,000 页/16 MP/50,000 text items/30 秒 parse/15 秒 render、图片 64 MiB/40 MP/16,384 px、文本 8 MiB/100,000 行/64 KiB 单行/2,000 DOM 行。
13. PDF.js 只使用 Display API + 本地同版 worker；不使用 generic viewer、Chromium plugin、iframe/embed/webview/WebContentsView，也不允许网络 asset fallback。
14. `PreviewReady`、`PreviewUnavailable`、`PlatformActionRequested`、`ResourceAccessProblem` 保持稳定区分；所有资源访问 `dataEffect=unchanged`，解析失败不推断“文件损坏”。
15. 诊断只包含 code、平台/kind/size bucket、版本、时长与计数；不含内容、名称、路径、FileId、标签、metadata、URL、密码、token 或原始错误。
16. preview session 全部易失，软件更新后重新验证；运行时、PDF.js、worker/assets 和政策版本进入 ADR-10 发布清单与双平台更新门。

随后用户逐段确认了：责任与数据流、类型/描述符、lease 生命周期、精确限制、渲染/安全/无障碍、系统动作与高风险政策、outcome/失败/诊断，以及测试/更新兼容/复议条件。

## 5. 审阅中发现并补回的上游行为

原产品规范写成“其他格式使用系统默认应用打开”，会让可执行文件、安装包、脚本、快捷方式或 URL 文件也成为 CourseFlow launcher。讨论确认这不是用户结果，并会扩大平台 handler 与执行风险。因此先在 PRD、MVP Scope 和 UI 规格中补回：

- 任意文件仍可保存；
- 非高风险普通文件始终可以请求系统默认应用；
- 高风险可启动文件只可定位，没有应用内绕过；
- requested/failed 不等于第三方应用成功；
- preview 不支持、类型冲突、加密、超限、失败和失效时的用户可见恢复路径；
- PDF、文本、动画 WebP 与显式 reload 的 UI 边界。

随后才同步 Architecture 的 `accessResource`/`FLOW-03`/ADR 状态，以及 Module Contracts 的 outcome、Problem、模块不变量和既有 TEST obligations。ADR 只保存满足这些行为的技术选择，没有把产品语义埋入实现决策。

## 6. 产物与后续边界

- 规范性技术决议：[ADR-06](../../architecture/adr/ADR-06-resource-preview-system-open.md)
- 一手资料与时效风险：[研究记录](../../research/adr-06-resource-preview-system-open-research.md)
- ADR 状态索引：[Architecture §12](../../architecture/ARCHITECTURE.md#12-adr-主题与变更规则)
- 逻辑接口、FLOW 与 TEST：[Module Contracts](../../architecture/MODULE_CONTRACTS.md)

本记录不复制 range wire grammar、策略 fixture 或实现文件布局，以免形成第二份技术真相。当前没有授权进入实现、选择具体包版本号或编写 implementation plan；下一项 ADR 必须重新从全仓审阅、适用上游语义和逐项确认开始。
