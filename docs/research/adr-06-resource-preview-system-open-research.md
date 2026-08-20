# ADR-06：受验证资源预览与系统打开一手资料研究

- 日期：2026-08-20
- 状态：研究记录，**不构成 ADR 决议**
- 决策主题：`ADR-TOPIC-06`
- 资料范围：Electron/Node/Chromium/PDF.js/WHATWG/W3C/Google/Microsoft 的官方文档、规范或上游源码；链接均指向一手来源。
- 后续裁定：[ADR-06](../architecture/adr/ADR-06-resource-preview-system-open.md) 已接受；产品规范随后明确高风险可启动文件只允许定位。因此本文所有“可 system-open”候选都必须读作“经最终启动风险政策允许后可 system-open”，不得用研究稿绕过正式决议。

## 1. 问题、范围与既有不变量

用户结果是：学生能在资料库中查看已支持的课程文件，并把其他非高风险普通文件交给系统默认应用；这不能把资料库路径变成 Renderer 的文件能力。`B-FILE-010` 明确只内置 PDF、PNG、JPEG、WebP 与纯文本，其他类型仍可定位，并在最终启动风险政策允许时打开；`MVP_SCOPE` 同时要求不跟随链接、只接受普通文件。`ADR-05` 已把身份、containment、FileId、stamp、扫描与文件操作固定，刻意将「大文件数据面、MIME/类型、parser、system-open、租约、Renderer 安全」留给本 ADR。

本研究以如下上游契约为不可变前提：

- Shell 唯一入口为 `IF-WORKSPACE`；`ResourceAccessRequest` 是 `FileId + expectedVerificationStamp + (preview | system-open | reveal-in-folder)`，且访问前必须重验当前根 containment、存在、权限与 stamp；大二进制不进入普通 `ProjectionEnvelope`。[Contracts §3.5](../architecture/MODULE_CONTRACTS.md#35-accessresource)、[FLOW-03](../architecture/MODULE_CONTRACTS.md#84-flow-03--资料库对账与受验证资源访问)
- 运行时是 sandboxed Renderer → Electron Main gateway → 单一 Workspace utility。Renderer 不获得 Node/Electron/路径/MessagePort；Main 只可作为经 Workspace 授权的数据面宿主，业务状态和文件验证仍属 utility/LIBRARY。[ADR-01](../architecture/adr/ADR-01-desktop-runtime-ui-boundary.md)、[ADR-02 §2–3](../architecture/adr/ADR-02-process-thread-deployment.md#2-决议)。
- `FileId` 是逻辑身份，不是路径、hash 或 OS object ID；每次资源访问的 stamp 失效都必须拒绝，不能因已有预览页或旧 URL 继续打开替换后的同路径文件。[ADR-05 §2、§12](../architecture/adr/ADR-05-library-watching-index-file-operations.md#2-决议摘要)。
- 此 ADR 必须落实 `B-FILE-009–011`、`A-PLATFORM-001`、`FLOW-03`、`Q-TRUTH-01/LOCAL-01/ACCESS-01/PORTABLE-01/RESPOND-01/DIAG-01`，并产出 `TEST-LIBRARY-007`、`TEST-PLATFORM-003` 与 `G6/G7` 证据。

**First-principles 结论**：扩展名、MIME 字符串、已显示的名称和旧访问结果都不是授权。唯一授权点是这一次 `FileId + expected stamp + purpose` 验证成功后发出的、范围有限且可撤销的数据读取能力；Renderer 只消费字节或渲染结果，永不消费真实路径/文件句柄。

## 2. 一手事实与可推导约束

### 2.1 类型判定：扩展名只可作展示/初筛，不能作为预览授权

WHATWG MIME Sniffing 明确指出扩展名不可靠、容易伪造；不一致的内容解释会带来安全后果，并把 HTML/XML/PDF 列为具有脚本处理模型的类型。[MIME Sniffing 的动机、扩展名结论与 scriptable MIME 定义](https://mimesniff.spec.whatwg.org/#introduction) [（扩展名）](https://mimesniff.spec.whatwg.org/#supplied-mime-type-detection-algorithm) [（PDF）](https://mimesniff.spec.whatwg.org/#mime-type-groups)。该规范的通用 header 读取上限为 1,445 bytes，说明有限头部探测足以作为分类器输入，而不是完整性/安全证明。[§5.2](https://mimesniff.spec.whatwg.org/#reading-the-resource-header)

故可推导出保守的两层政策：

1. 文件名后缀只决定候选标签、图标及是否值得读取有限 header；最终 `PreviewKind` 必须由 allowlist 的后缀**与**相应魔数/结构探测共同确认。任一步不符、读失败、普通文件条件/stamp 改变，均降为 `unsupported-or-unverified`；reveal 保留，system-open 还必须通过最终启动风险政策与重新验证。
2. 图片探测至少复核 PNG 8-byte signature（W3C 明定 `89 50 4E 47 0D 0A 1A 0A`）和 IHDR；WebP 的正式容器头为 `RIFF` + size + `WEBP`，而且规范允许动画和元数据，故不能把 `.webp` 当成“静态小图”。[PNG §5.2](https://www.w3.org/TR/png-3/#5PNG-signature)、[Google WebP container](https://developers.google.com/speed/webp/docs/riff_container)。JPEG 可仅对 SOI/segment 作候选探测，最终仍由 Chromium 解码成功决定；这避免自写 JPEG parser。
3. SVG 不是本期支持类型：它是 XML/可脚本处理模型的一支，且 Chromium/MIME 规范特意将 `image/svg+xml` 与普通图像区分；即使扩展名为 `.svg` 也只能 system-open/reveal。GIF（含动画）、HEIC/AVIF、TIFF、Office/HTML/Markdown/JSON 同理，不因浏览器可能能解码就暗中扩大 `B-FILE-010`。

PDF 的 `%PDF-` 起始标记适合**候选**分类，但不是安全验证、更不是可渲染保证；应交给选定 parser 的受控失败路径。不要把 `application/pdf` 的 MIME、扩展名或用户提供的 `Content-Type` 直接塞进 `<embed>`/`iframe`。

### 2.2 文本不是“任何无扩展名文件”

Web 的 `TextDecoder` 默认 UTF-8，支持明确 label、BOM 处理、流式 decode；`fatal: true` 时解码错误会抛出 `TypeError`。[WHATWG Encoding `TextDecoder`](https://encoding.spec.whatwg.org/#interface-textdecoder)、[`decode()` algorithm](https://encoding.spec.whatwg.org/#dom-textdecoder-decode)。因此 MVP 可有明确而不猜测的文本分类：

- 只接受 UTF-8（可接受/记录 UTF-8 BOM）；若产品需要 UTF-16 LE/BE，可只在 BOM 存在时接受。不要对无 BOM 的任意 bytes 猜 GBK、Shift-JIS 或系统 code page，否则同一文件在 macOS/Windows 的显示含义不稳定。
- 先读有界 sample：NUL、控制字节比例或 UTF-8 fatal decode 失败即为二进制/未知，走 system-open；不能使用 replacement character 静默“修复”后称为文本。
- 内容以原样 `textContent`/等价 React 文本节点呈现，绝不 `innerHTML`、Markdown/HTML 自动渲染或把原内容变成可导航 URL。明确显示 encoding、总字节、截断/行数边界与“已显示前 N 行/字节”；滚动到未加载区域须发起另一个受限 range，而不是把整文件拼成字符串。

### 2.3 读取、range、流式与背压

Node `FileHandle.read()` 可按给定 `position`、`length` 读取；`createReadStream` 支持 `start/end`、`AbortSignal` 和 `highWaterMark`，默认块为 64 KiB。Node 同时强调 highWaterMark 是开始施加背压的阈值而非全局内存硬上限，故协议仍必须有 CourseFlow 自己的 credit、单租约上限和全局并发上限。[Node FileHandle read](https://nodejs.org/api/fs.html#filehandlereadbuffer-options)、[range stream](https://nodejs.org/api/fs.html#filehandlecreatereadstreamoptions)、[Node stream buffering](https://nodejs.org/api/stream.html#buffering)。

PDF.js 的公开 API 接受 `data` 或自定义 `PDFDataRangeTransport`，可设 `rangeChunkSize`（默认 65,536），并提供 `disableRange`、`disableStream`、`disableAutoFetch`；仅关闭预取必须同时关闭 stream。它的 FAQ 也说明 PDF 的关键数据常在末尾，适合按需 range，而不是先读完整文件。[PDF.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)、[PDF.js FAQ](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#pdfjs-is-fetching-the-entire-pdf-file-from-a-server-can-it-fetch-only-the-required-portions-for-rendering)。

这支持一个版本化 `ResourceLease` 控制面：`leaseId`（不可枚举随机值）、`workspaceEpoch`、`FileId`、授予时 stamp/RootGeneration、purpose、kind、size、最大总读取/单 range/未确认块数、到期时间。它不是持久事实；utility 重启、epoch 改变、stamp invalidation、显式 close、页面卸载或 timeout 都使其失效。每一个 range 必须验证 lease/purpose/offset/length，再在 utility 对仍打开的普通文件重验最终对象；失败返回稳定 `resource-stale | resource-too-large | resource-limit | permission | cancelled`，不能泄露路径或原始 OS 错误。

### 2.4 Electron IPC、Object URL 与协议边界

Electron IPC 使用 HTML Structured Clone；DOM、Node C++ backed objects、Electron C++ backed objects等不可任意传输。`MessagePort` 只能用 `postMessage`（不是 `send/invoke`）转移，官方将它列为实现 response stream 的方式。[Electron IPC serialization](https://www.electronjs.org/docs/latest/tutorial/ipc#object-serialization)、[MessagePorts reply stream](https://www.electronjs.org/docs/latest/tutorial/message-ports)、[MessageChannelMain](https://www.electronjs.org/docs/latest/api/message-channel-main/)。因此 DTO 应只含可 clone 的标量/ArrayBuffer；不得把 Node `ReadStream`、`FileHandle`、Error、路径或 Electron object 越过 Main/Renderer seam。

浏览器 `blob:` URL 是与创建环境相关的标识，适合由 Renderer 的已授权 `Blob` 供图像使用，但每个 `createObjectURL` 都必须在资源不再可访问时 `revokeObjectURL`，否则 backing Blob 不能回收；其并不等于新的文件授权。[W3C File API：Blob URL](https://w3c.github.io/FileAPI/#url)、[`revokeObjectURL`](https://w3c.github.io/FileAPI/#dfn-revokeObjectURL)。`createImageBitmap(Blob)` 和 `ImageBitmap.close()` 可作异步解码/释放，但 API 本身不给像素/内存 DoS 保证，必须先由 CourseFlow 设置字节和 decoded-pixel 限制。[WHATWG HTML：ImageBitmap](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#imagebitmap)。

Electron 的 custom protocol 是 Main/session 所有；`protocol.handle` 返回 `Response`，可响应 stream。自定义 scheme 的 `standard`、`secure`、`supportFetchAPI`、`stream` 等特权必须逐项显式注册；尤其 `bypassCSP` 绝不能为资源 scheme 开启。Electron 明确建议避免 `file://`，因为其页面可单方面访问机器文件，而采用受限 custom protocol 可控制可加载集合。[Electron protocol](https://www.electronjs.org/docs/latest/api/protocol/)、[CustomScheme privileges](https://www.electronjs.org/docs/latest/api/structures/custom-scheme)、[Electron security：避免 file://](https://www.electronjs.org/docs/latest/tutorial/security#18-avoid-usage-of-the-file-protocol-and-prefer-usage-of-custom-protocols)。

### 2.5 Renderer、嵌入物和 PDF 的安全事实

Electron 当前安全清单要求 context isolation、renderer sandbox、限制导航/新窗口、限制性 CSP、校验 IPC sender，并警告 `<webview>` 即使无 Node integration 也可由 DOM 脚本创建。`<webview>` 官方目前更直接建议不要使用，理由是其架构变化会影响稳定性；若用 iframe，官方建议以 `sandbox` 限制 capability。[Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)、[Web Embeds](https://www.electronjs.org/docs/latest/tutorial/web-embeds/)、[webview warning](https://www.electronjs.org/docs/latest/api/webview-tag)。

结论是：本 MVP 不使用 `<webview>`、`WebContentsView`、`<embed>` 或通用 `iframe` 来加载用户 PDF/图片/文本；不启用 `webviewTag`、`plugins`、`nodeIntegrationInWorker`、`allowRunningInsecureContent` 或 `webSecurity: false`。外部链接、PDF annotations、附件、JavaScript/XFA、打印/下载/保存、打开新窗口都应是默认关闭/不实现，而不是依赖某个 viewer 的默认值。

Chromium 源码确实含 built-in PDF plugin/PDFium，且 Electron build 也以 `enable_pdf_viewer` 条件编入相应 Chromium 组件；但 Electron 的公开 API 没有把它承诺为带稳定权限、range、禁用脚本/外链和嵌入行为的 CourseFlow preview interface。上游也有 blob URL/嵌入 PDF 不显示的 Electron issue。故「能跟随当前 Electron/Chromium 显示」不是可发布的跨平台契约。[Chromium plugin source](https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/common/chrome_content_client.cc)、[Electron build source](https://github.com/electron/electron/blob/main/BUILD.gn)、[Electron issue #33519](https://github.com/electron/electron/issues/33519)。

PDF.js 是另一候选：其公开 generic release 含 library、worker 和 viewer，项目也明确称其在 Web Worker 中运行；但其完整 viewer 带 annotation/editor/scripting 面，简单示例也专门创建 `PDFScriptingManager` 和 sandbox bundle。MVP 应只采用 display API + 单独打包的官方 worker，禁用/不构造 scripting、XFA、annotation editor、attachments/download/print UI，且 URI/link action 只显示为非可点击文本或经未来显式 system-open policy。依赖版本必须精确锁定并随 Electron 更新审查，因为 PDF.js 稳定发布频繁变更解析、字体、性能和 viewer。[PDF.js setup/release policy](https://github.com/mozilla/pdf.js/wiki/Setup-pdf.js-in-a-website)、[上游 viewer 示例](https://github.com/mozilla/pdf.js/blob/master/examples/components/simpleviewer.mjs)、[releases](https://github.com/mozilla/pdf.js/releases)。

### 2.6 system-open / reveal 与 TOCTOU

Electron `shell.openPath(path)` 由 Main 调用，成功 resolve 空字符串、失败则 resolve 错误文本；`showItemInFolder(fullPath)` 只尝试在文件管理器显示/选中，公开 API 没有成功回执。sandboxed Renderer 不能使用 `shell`。因此 `openPath` 的空结果仅能表示 Electron 已完成请求，不等于系统默认应用成功解析、加载或没有再触发其自身行为；reveal 应是 `requested`/best-effort，而非 `succeeded` 事实。[Electron shell](https://www.electronjs.org/docs/latest/api/shell)。

Windows 的 `ShellExecute` 可因无关联、拒绝访问、文件/路径不存在、共享冲突失败，并能委派 Shell extension/COM handler；这进一步说明不应把用户控制的路径、URL 或命令行交给 Renderer，也不能把 API 调用当内容打开成功。[Microsoft ShellExecute](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shellexecutea)。

正确顺序仍是 utility 重新验证 → 发送有界 Main platform request（只带关联 id，真实 canonical path 仅在 Main adapter 私有 map 中）→ Main 在调用 `shell.openPath/showItemInFolder` 前再次向 utility 确认有效 lease/stamp → 返回受限的 `requested | rejected | failed`。两次检查不能消灭同权限外部程序在最终 OS 调用前替换对象的 TOCTOU；应诚实记录该限制、缩小窗口、绝不从旧 path/stamp 重试，并把失败/不确定映射为 Problem，而非假称目标仍是原 FileId。

## 3. 可供 ADR 选择的三组最小方案

| 方案 | 数据面和 PDF | 优点 | 关键风险/代价 |
|---|---|---|---|
| A. Chromium 内建 PDF + 自定义 protocol | Main 对每次 lease 响应受限 URL，Chromium plugin/`<embed>` 负责 PDF；图片也由 URL 解码。 | 少自有 viewer 代码、浏览器可 range。 | 没有 Electron 公开稳定的 CourseFlow-level PDF 控制面；plugin/embed/权限/CSP/新窗口/下载行为和 blob compatibility 都必须逐 Electron 版证实，且 URL/Range/TOCTOU bridge 仍需自建。与“不要嵌入不可信内容”的安全证据相冲突。 |
| B. `MessagePort` credit/range + PDF.js display API | `accessResource` 发 lease；preload 私有地创建 port，Main/utility 以 credit 发 ArrayBuffer；PDF.js 用自定义 range transport，图片/小文本只在 size/pixel/line 上限内组 Blob/文本。 | 授权、取消、stamp 失效、背压和 PDF range 全在 versioned DTO；Renderer 无路径、无 protocol privilege；不用 iframe/webview/plugin。 | 须实现小型 chunk/credit、lease teardown、PDF.js worker/升级审查；图片仍可能需要完整受限 Blob。 |
| C. lease token custom protocol + PDF.js/原生 image fetch | Main 注册非特权或最小 `secure + supportFetchAPI + stream` resource scheme，随机单用途 URL 仅映射短 lease；handler 通过 utility range bridge 返回带正确 Content-Range 的 stream。 | 图片可直接由 Chromium 流式解码，PDF.js URL 可使用浏览器 Range；可避免大 ArrayBuffer 进入 Renderer JS。 | handler/HTTP range/session binding/stream cancel/TOCTOU 更复杂；URL 是 bearer capability，CSP/导航/缓存/referrer/日志都要处理；不得用 `file://`、`standard`/`bypassCSP`/ServiceWorker。需要大量 packaged proof。 |

从 YAGNI/KISS 和当前已批准边界推导，**B 是最小可验证的基线候选**；并非本研究替用户作出的 ADR 决定。A 的关键行为是未承诺的实现细节，C 在当前仅五类预览的范围内比 B 多出 URL/protocol 权限面。若 G7 证明 B 的大 PDF 或图片内存/延迟不能过线，才以测量为依据重新在 B/C 间取舍，不应把失败隐藏为无限增大 IPC buffer。

## 4. 无论选择哪案都应写入 ADR 的资源政策

1. **分类与输出**：返回稳定 `PreviewDescriptor { kind, size, detectionEvidenceVersion, limits }`；`kind` 只能为 `pdf | png | jpeg | webp | utf8-text | unsupported`。扩展名/魔数不一致是可诊断的 `unsupported`，不是异常内容执行。
2. **限制作为契约参数**：定义版本化 `PreviewLimitsV1`（header sample、单 range、in-flight bytes、lease 数/总 bytes、PDF 同时页/画布像素、图像 decoded pixels、文本总 bytes/行/单行长度、timeout）。具体数字留待 G7 参考工作区和双平台测量；超限要明确提示并可 system-open/reveal，不能 OOM/卡死。
3. **资源生命周期**：单个打开 tab/请求拥有 lease；切换文件、关闭 tab、Renderer navigation、utility epoch change、stamp invalidation、超时均 cancel；在数据面停止、销毁 parser/worker page render、关闭 `ImageBitmap`、revoke `blob:` URL。旧渲染位可保留静态“已失效”说明，但不可继续读取。
4. **失败隔离**：PDF.js 解析/渲染可在 Worker，异常只影响该 preview；若 G7/崩溃证据显示它会影响 Workspace utility，再依 ADR-02 条件放入临时 worker thread，worker 只收候选输入、不持有 DB 或正式状态。
5. **隐私与诊断**：默认不联网；禁止 remote fonts/CMap/wasm/链接 URL，所有 PDF.js asset 仅来自签名的 app bundle。诊断只存 kind、size bucket、版本、problem/OS code 与 diagnosticRef，不存内容、绝对路径、lease token 或完整外链。
6. **无障碍**：预览 toolbar/错误/截断提示可键盘完成、有可见焦点和文字状态；canvas PDF 至少提供页码、缩放、加载/失败语义。文本保留可选取的真实文本节点；若 PDF text layer 因安全/性能未启用，须明确其可访问性缺口并在验收前解决，而非将 canvas 视为已满足 `Q-ACCESS-01`。

## 5. ADR-10 发布门与时效风险

本研究日期的「latest」不能替代未来包内 runtime 证据。Electron 把 Chromium/Node 安全更新交由应用厂商升级；PDF.js release 也会频繁改变 parsing/viewer/worker 行为。因此 ADR-10 应把如下项目设为 release/update gate，而非一次性开发测试：

- 在签名/打包 macOS 与 Windows 构建上记录 `process.versions.electron/chrome/node`、PDF.js exact version、worker/asset digest 和 protocol privilege 配置；每次 Electron、Chromium、Node、PDF.js 或 OS 更新重新跑本节测试。Electron 的安全指南明确建议采用 current Electron。[Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)
- 验证 `nodeIntegration: false`、`contextIsolation: true`、sandbox、CSP、`webSecurity` 未关闭、无 `webviewTag/plugins`、只存在白名单 preload API；静态测试阻止 Renderer 导入 Node/Electron/真实路径，动态测试拒绝 forged IPC/其他 frame/sender。
- `TEST-LIBRARY-007`：任意类型可保存；五个支持 kind 的真/伪扩展、截断/损坏、二进制冒充文本、SVG/GIF/HTML 拒绝内嵌；访问前后 replace/move/permission/root/epoch/stamp 改变均停止旧 lease，绝不显示或 system-open 替换对象。
- `TEST-PLATFORM-003`：两平台的 preview、unsupported `openPath`、reveal、无默认关联、权限拒绝、路径消失、共享冲突、取消/timeout 的 Problem mapping 一致；`openPath` 空字符串只断言 request accepted，不断言第三方应用完成。
- 数据面压力：多范围 PDF（尾部 xref）、巨大页/深嵌对象/损坏 PDF、超大/像素炸弹图片、巨行/无换行文本、慢消费/Renderer crash/utility restart、重复打开关闭和对象 URL 泄漏。断言 credit/租约/worker/内存上限、取消和 UI 响应；G7 记录 p50/p95/p99、utility event-loop delay、峰值 RSS/Renderer memory。
- packaged 平台实测：本地 Documents、支持的可移动本地卷、Unicode/空格/大小写名、权限撤销、默认应用缺失及 macOS/Windows system open/reveal；必要时记录为「未验证」而非从开发环境推断。
- 更新兼容：`PreviewLimitsV1`、分类/魔数策略版本、lease/protocol DTO、PDF.js asset/worker compatibility 的升级行为；旧应用遇到新持久版本遵循 ADR-04 的停止策略。lease 不持久化，更新/重启必须失效，任何自定义 scheme 不得成为稳定外部 deep-link/API。

## 6. 决策时待确认的问题

以下问题已在后续逐项讨论中解决，最终答案以 [ADR-06](../architecture/adr/ADR-06-resource-preview-system-open.md) 为准；保留本节只为记录研究到决策的输入。

1. 是否接受 B 作为初始方案，并仅在 G7 失败后评估 C？若选择 C，是否接受实现/测试 HTTP Range 与 bearer lease URL 的额外复杂度？
2. `PreviewLimitsV1` 的可接受用户体验是什么：超限时「安全地无法内嵌 + system-open/reveal」是否满足 `B-FILE-010`，还是产品必须给出具体最低可预览容量/页数？
3. 纯文本范围是否严格 UTF-8（可 BOM UTF-16），还是 MVP 要支持用户显式选择的 legacy encoding？后者需定义选择、持久性与跨平台一致性。
4. PDF MVP 是否需要搜索/文本选择/链接、表单、annotation、附件、打印或下载？本研究默认均不启用；任何一个都扩大 PDF.js/UI/安全/无障碍验收面。
5. system-open 的 UX 成功语义是否采纳 `requested`，以及 reveal 无回执时怎样展示 `best-effort`？这会决定 `IF-SYSTEM-OPEN` 的稳定结果枚举。

## 7. 实际检查

- 已阅读：根 `AGENTS.md`，`PROJECT_BRIEF`、`PRD`、`MVP_SCOPE`、`ARCHITECTURE`、`MODULE_CONTRACTS`、`ADR-01` 至 `ADR-05`、ADR-05 research/design；本文件未修改产品、架构、ADR 或讨论记录。
- 已做：仅一手来源的 Electron、Node、Chromium、PDF.js、WHATWG/W3C、Google、Microsoft 文档/源码检索；未把 `ATTEMPT.md` 当作规范或实现依据。
- 本次为研究文档，未运行应用、打包构建或跨平台测试；所有上节发布门均仍是未来必须产生的证据。
