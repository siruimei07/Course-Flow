# ADR-06：受验证资源预览与系统打开

- 状态：已接受
- 日期：2026-08-20
- 决策主题：`ADR-TOPIC-06`
- 前置决策：[ADR-01](./ADR-01-desktop-runtime-ui-boundary.md)、[ADR-02](./ADR-02-process-thread-deployment.md)、[ADR-03](./ADR-03-sqlite-active-data-transactions.md)、[ADR-04](./ADR-04-schema-migration-compatibility.md)、[ADR-05](./ADR-05-library-watching-index-file-operations.md)
- 上游规范：[PRD](../../product/PRD.md)、[MVP_SCOPE](../../product/MVP_SCOPE.md)、[UI 规格](../../superpowers/specs/2026-08-18-courseflow-ui-wireframes-page-spec-design.md)、[Architecture](../ARCHITECTURE.md)、[Module Contracts](../MODULE_CONTRACTS.md)
- 调研证据：[受验证资源预览与系统打开一手资料研究](../../research/adr-06-resource-preview-system-open-research.md)

## 1. 背景

CourseFlow MVP-B 允许保存任意普通文件，并在应用内只读预览 PDF、PNG、JPEG、WebP 和纯文本。用户还需要把非高风险普通文件交给系统默认应用，或在 Finder/资源管理器中定位任意受管理文件。该能力同时跨越不可信文件内容、Renderer、Preload、Electron Main、Workspace utility、真实文件系统和外部应用，不能把扩展名、显示路径、旧 stamp 或已打开的页面当成持续授权。

ADR-01 已要求 sandbox、context isolation、限制导航和 Renderer 无 Node/Electron 文件能力；ADR-02 已确定控制面完整经过 Renderer → Main → Workspace utility，Main 只可托管 Workspace 授权后的资源数据面；ADR-04 要求 exact protocol/build/epoch；ADR-05 拥有 FileId、RootGeneration、containment、对象证据与 verification stamp。本文只决定这些边界之上的类型识别、字节数据面、解析/渲染、资源限制、system-open/reveal、当前问题和更新门禁。

WHATWG 指出扩展名不可靠，且 PDF、HTML/XML 等具有脚本处理模型；Electron 要求限制不可信内容的能力、校验 IPC sender、保持 sandbox/context isolation/CSP，并建议避免 `file://`；Electron 的系统打开 API 只能说明请求结果，不能证明第三方程序最终成功展示内容。[WHATWG MIME Sniffing](https://mimesniff.spec.whatwg.org/)、[Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)、[Electron `shell`](https://www.electronjs.org/docs/latest/api/shell)

`ATTEMPT.md` 仍是归档旧尝试，不是预览库、格式、兼容或安全基线。本文批准技术设计，不授权开始实现，也不补齐 ADR-07–10。

### 1.1 追溯边界

- Requirement：`B-FILE-004/009/010/011`、`NFR-001/002/006/010`、`STATE-002`；
- Module：`MOD-SHELL`、`MOD-WORKSPACE`、`MOD-LIBRARY`、`MOD-PLATFORM`；
- Interface：`IF-WORKSPACE.accessResource`、`IF-LIBRARY-RESOURCE`、`IF-SYSTEM-OPEN`、`IF-RESOURCE-PREVIEW`；
- Flow：`FLOW-03`；
- 质量约束：`Q-TRUTH-01`、`Q-LOCAL-01`、`Q-ACCESS-01`、`Q-ISOLATE-01`、`Q-RESPOND-01`、`Q-PORTABLE-01`、`Q-EVOLVE-01`、`Q-DIAG-01`；
- 验收：`TEST-SHELL-001–004`、`TEST-LIBRARY-007`、`TEST-PLATFORM-003`、`TEST-FLOW-03-LIBRARY-RECOVERY`、`G2/G5/G6/G7`。

稳定 ID 的完整语义仍由 [Module Contracts](../MODULE_CONTRACTS.md) 拥有；本 ADR 只记录满足它们的技术选择。

## 2. 决议摘要

CourseFlow 采用**短期资源租约 + Preload 私有的有界 MessagePort range 数据面 + PDF.js Display API**：

1. 所有控制请求继续使用 `IF-WORKSPACE.accessResource`。Workspace utility 中的 LIBRARY 每次按用途重新验证 FileId、RootGeneration、containment、普通文件、对象、权限和 stamp，只有随后才签发不可枚举的内存租约。
2. 大文件字节不进入 `ProjectionEnvelope` 或普通 request/response IPC。Main 托管并限制数据面；原始 `MessagePort` 只存在于 Main、utility 与 Preload 隔离世界，页面 Renderer 只获得冻结的窄 session facade。
3. 类型采用后缀与内容必须同时一致的 `PreviewDetectionPolicyV1`。只允许 `.pdf`、`.png`、`.jpg/.jpeg`、`.webp`、`.txt/.text/.log`；HTML、Markdown、JSON、源码、SVG、GIF、Office 等不因 Chromium 可处理而扩大范围。
4. PDF 使用精确锁定的 `pdfjs-dist` Display API 与同版本本地 worker，不使用 generic viewer、Chromium PDF plugin、iframe、embed、webview 或 WebContentsView。图片使用受限 Blob/ImageBitmap/canvas；文本按严格编码作为字面文本呈现。
5. `PreviewLimitsV1` 固定 header、range、并发、时限、文件、页面、像素、文本和 DOM 上限。任何一项超出都停止内置预览，不显示部分内容；文件保持不变并提供当前允许的平台动作。
6. PDF 是只读基础阅读器：页滚动/跳转、缩放/适合页面、键盘、状态公告、可用时的文本层和结构树。搜索、活动链接、表单、脚本、XFA、批注、附件、打印和下载不在 MVP；加密 PDF 不在 CourseFlow 中收集密码。
7. 非高风险普通文件无论是否支持预览，都可经独立完整重验请求系统默认应用。平台结果只有 `requested | failed`；reveal 是 best-effort。已知可启动的高风险文件可以保存和 reveal，但 CourseFlow 永不 system-open 且没有应用内绕过。
8. preview lease、port、Blob、canvas 和 parser 状态都是易失状态；重启、更新、epoch 或协议改变后全部作废。分类、限制、启动风险和资源协议均版本化，并由 ADR-10 纳入打包更新门禁。

## 3. 所有权与数据流

```text
React page / MOD-SHELL
  PDF.js Display API、canvas/text/structure layer、literal text、accessible controls
        │ frozen PreviewSession facade；无 data-plane path/URL/MessagePort/Electron/FileHandle
        ▼
Preload isolated world
  私有 session map + 私有 MessagePort；校验 narrow method/arguments
        │ transferred ArrayBuffer chunks；credit/cancel
        ▼
Electron Main
  sender/frame/origin/epoch 校验 + port relay + timeout/配额 + Electron-only action adapter
        │ dedicated MessagePortMain；与普通 Workspace IPC 分离
        ▼
Workspace utility
  MOD-WORKSPACE → MOD-LIBRARY
  当前资源验证、类型/风险政策、lease、read-only handle、range read
```

### 3.1 Renderer 与 Preload

页面 Renderer 只拥有 UI 状态、PDF.js Display API、画布/文本层、图片和字面文本渲染。它不得获得：

- 原始 `MessagePort`、Node/Electron API、`FileHandle` 或流对象；
- 可供预览/平台动作使用的真实路径、可加载资源 URL、lease secret 或系统动作 adapter；
- 通用“读文件”“打开路径”“发任意 IPC”能力。

`contextBridge` 仍只暴露 ADR-02 的 `window.courseFlow` 五种能力；控制入口是其中的 `accessResource`。utility/Main 的 `PreviewReady` 控制 DTO 只把私有 grant 交给 Preload；Preload 再合成 `localSession`，不会跨 Main/utility seam 传函数。页面只得到冻结的 `readRange/cancel/close` 最小函数和有界标量结果，不得到 grant/lease reference。原始 port 与 session map 留在 Preload 隔离世界；Preload 为页面的 offset/length 调用补入私有 session reference/request ID，并逐项校验。文件详情可以通过普通只读投影显示产品要求的真实路径文本，但该文本不进入 preview descriptor/session，不能被任何资源 API 当成授权。

Electron 的 context bridge 会代理函数并复制/冻结可 clone 值；MessagePort 必须用 `postMessage` 转移。因此页面 facade 与私有数据面必须分开，不能把 port 当作普通 API 值暴露。[Electron Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)、[Electron MessagePorts](https://www.electronjs.org/docs/latest/tutorial/message-ports)

### 3.2 Main

Main 只负责：

- 校验窗口、WebContents、frame、origin、当前 build/protocol/epoch 和请求大小；
- 把授权 session 绑定到一个窗口/frame，维护镜像状态、credit、全局并发、timeout 和 teardown；
- 在 utility 与 Preload 之间中继有界 ArrayBuffer，不解释文件内容；
- 兑现一次性 `shell.openPath` / `shell.showItemInFolder` 平台请求。

Main 不查询数据库，不决定 FileId、类型、启动风险、stamp 或 allowedActions，不从显示路径发起动作，也不把平台 Promise 当业务成功。它不得调用 `shell.openExternal`，不得拼接 shell 命令、参数或 URL。

### 3.3 Workspace utility 与 LIBRARY

Workspace utility 中的 LIBRARY 是授权与分类的唯一所有者：

- 为 preview/system-open/reveal 每个用途独立执行 ADR-05 的完整验证；
- 读取有界 header，执行 `PreviewDetectionPolicyV1` 与 `LaunchRiskPolicyV1`；
- 以只读 handle 和当前对象证据建立 lease，兑现合法 range；
- 在每次 range、renew 和平台动作前验证 session、purpose、边界、RootGeneration、stamp、权限与当前对象；
- 产生规范 outcome/problem 和最小 typed safe details。

普通文件 I/O 使用 Node core 的异步 `FileHandle.read`；初始实现不增加通用 streaming server、native 文件 addon、图片 parser 或常驻 worker pool。Node 的 highWaterMark 不是全局内存硬上限，因此 CourseFlow 自己的 credit 与配额仍是强制契约。[Node FileHandle read](https://nodejs.org/api/fs.html#filehandlereadbuffer-options)、[Node stream buffering](https://nodejs.org/api/stream.html#buffering)

## 4. 类型识别与 PreviewDescriptor

### 4.1 `PreviewDetectionPolicyV1`

只有下列后缀与对应内容结构同时一致，才返回支持的 PreviewKind：

| PreviewKind | 允许后缀 | 最小内容证据 |
|---|---|---|
| `pdf` | `.pdf` | 有界 header 中的 PDF header；随后由 PDF.js parser 受控确认 |
| `png` | `.png` | PNG 8-byte signature、IHDR 顺序与尺寸字段 |
| `jpeg` | `.jpg`、`.jpeg` | SOI 与合法 marker 路径/尺寸字段；随后由 Chromium decoder 受控确认 |
| `webp` | `.webp` | `RIFF` size、`WEBP` 与首层 chunk 结构；记录 animation flag 与尺寸 |
| `text` | `.txt`、`.text`、`.log` | 严格 UTF-8，或只在 BOM 存在时接受 UTF-16LE/UTF-16BE；解码失败即拒绝 |

header 最多读取 4 KiB。后缀只决定候选，不是授权；扩展名与内容不一致返回 `type-mismatch`，未知或未列入后缀返回 `unsupported`。截断、无法读取或 decoder/parser 拒绝分别走稳定失败，不执行内容，也不把失败命名为“文件损坏”。PNG signature 和 WebP RIFF 结构来自各自公开规范。[PNG Specification](https://www.w3.org/TR/png-3/#5PNG-signature)、[WebP Container Specification](https://developers.google.com/speed/webp/docs/riff_container)

SVG、GIF、HTML、Markdown、JSON、XML、源代码、Office、音视频和其他格式一律不内嵌。没有后缀的文件不猜测为文本；文本不猜测系统 code page、GBK、Shift-JIS 或其他 legacy encoding。

### 4.2 描述符

```text
PreviewDescriptor {
  kind: pdf | png | jpeg | webp | text
  byteLength: canonical unsigned decimal string
  encoding?: utf-8 | utf-16le-bom | utf-16be-bom
  animated?: boolean
  detectionPolicyVersion: 1
  limitProfileVersion: 1
}
```

描述符是有界控制信息，不包含文件名、路径、URL、FileId、stamp、PDF metadata、外链或解析器原始异常。`byteLength` 遵循 ADR-04 的 canonical unsigned decimal string，避免跨 seam 的 64 位 Number 歧义。

## 5. ResourceLease 与 range 协议

### 5.1 Lease 内容与状态

utility 创建的 `ResourceLease` 至少绑定：

```text
leaseId                  random, unenumerable, single-session
resourceProtocolVersion  exact current resource data-plane protocol
workspaceEpoch           exact current epoch
rootGeneration           exact current root generation
fileId + grantedStamp    logical identity and verification evidence
purpose                  preview only
previewKind + byteLength
readOnlyHandle + objectEvidence
createdAt + expiresAt
limitProfileVersion
state                    active | revoked | closed | expired
```

lease 只在 utility 内存中持有完整事实；Main 只保留执行配额和撤销所需的最小镜像，Preload 只保留页面 session 的私有映射。lease 不写入数据库、日志、URL、Renderer storage、崩溃报告或诊断导出，也不能枚举。preview lease 不能授权 system-open/reveal。

### 5.2 Range 与背压

Preload 生成的每个内部 range 请求携带唯一 request ID、私有 session-local lease reference、offset 和 length。utility 必须拒绝负数、溢出、越界、重叠 request ID、未知字段、超过 credit/并发/时限的请求；响应只转移准确长度的 ArrayBuffer。调用方取消、慢消费、页面离开或超时会释放 credit，并中止仍可取消的读取/解析。

PDF.js 使用公开 `PDFDataRangeTransport` 适配该 range 协议，`rangeChunkSize=64 KiB`，不向 PDF.js 提供 URL，不开启自动完整 fetch。PDF 关键结构可能位于文件末尾，因此不能把“只读开头”当作可用 PDF 预览。[PDF.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)、[PDF.js FAQ](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#pdfjs-is-fetching-the-entire-pdf-file-from-a-server-can-it-fetch-only-the-required-portions-for-rendering)

### 5.3 撤销与更新

以下任一条件立即撤销 session，关闭读取并释放 parser/worker/page/canvas/ImageBitmap，以及任何已经创建的 Blob URL：

- 用户切换文件、关闭预览/窗口或显式取消；
- 页面导航、frame/WebContents 销毁、port 关闭；
- lease 到期或 renew 失败；
- 文件、对象证据、stamp、权限、RootGeneration 或 containment 改变；
- utility/Main/Renderer 退出或当前 workspaceEpoch 改变；
- protocol/build/策略版本不匹配；
- 数据面违反配额、顺序或格式。

旧画面只能保留静态“预览已失效”说明；不能继续读旧 lease，也不能静默显示替换后的同路径对象。用户显式 reload 后重新执行完整 `accessResource`。

普通路径 API 与最终 OS 调用之间仍存在同权限外部进程可替换对象的 TOCTOU 窗口；本设计以 read-only handle、对象/stamp 重验、用途租约和缩短窗口降低风险，但不虚构 handle-level sandbox 保证。

## 6. `PreviewLimitsV1`

所有数值是可测试契约；KiB/MiB 分别按 1024/1024² 字节计算。

| 范围 | `PreviewLimitsV1` |
|---|---|
| 分类 header | 最多 4 KiB |
| 单次 range | 最多 64 KiB |
| 单 lease 数据面 | 最多 4 个并发 range、256 KiB in-flight |
| 活动预览 | 每窗口 1 个、全应用 2 个 |
| lease | 5 分钟；只有 session 活跃且完整重验未变才可续期 |
| 单 range timeout | 5 秒 |
| PDF 文件 | 最多 512 MiB、10,000 页 |
| PDF 页面资源 | 每页最多 16 MP canvas；只保留当前页和相邻页 |
| PDF 文本层 | 每页最多 50,000 个 text items |
| PDF 时限 | 初始 parse 30 秒；单页 render 15 秒 |
| PNG/JPEG/WebP | 最多 64 MiB、40 MP、任一维最多 16,384 px |
| 纯文本 | 最多 8 MiB、100,000 行、单行最多 64 KiB 源字节 |
| 文本 DOM | 最多同时挂载 2,000 个虚拟化行 |

达到上限允许；超过一单位即 `limit-exceeded`。尺寸、页数、行数、像素、文本项或时限一旦不满足，当前内容不发布为部分预览，已分配资源立即释放。系统打开/reveal 仍按独立重验和启动风险政策决定。

不得在实现中为“修复大文件”静默提高限制、无限重试、拼接整个 PDF/text 或扩大 app-wide lease 数。修改限制必须提升 `limitProfileVersion`、修订 ADR、更新边界 fixture，并重新通过 G7。

## 7. 渲染、安全与无障碍

### 7.1 PDF

唯一批准的第三方预览依赖是 `pdfjs-dist`：

- 使用 Display API 和同一精确版本的本地 worker；package lock 与发布清单固定版本，worker/asset 记录 SHA-256；
- 不使用 generic viewer，不创建 scripting manager、annotation editor、XFA/forms、attachments、download、print 或 link-action UI；
- CMap、standard fonts、WASM 和 worker 等所需资产只能来自签名应用包，不允许网络 fallback；
- 页面只绘制受限 canvas；在限制内从 `getTextContent()` 和 `getStructTree()` 建立可选择文本层与结构语义；
- 页面滚动/跳转、缩放、适合页面、加载/失败和当前页状态均有键盘路径、可见焦点与 live-region 文本；
- 文档没有可用文本/结构时明确说明“扫描件或文档未提供可访问文本”，不把 canvas 冒充完整可访问内容；
- encrypted/password exception 立即停止，CourseFlow 不收集、缓存或传递 PDF 密码，只保留适用的平台动作。

PDF.js 公开 Display API 提供 range transport、页面文本和结构树；完整 viewer 还包含本期不需要的活动能力。因此只引入 library + worker，比嵌入 generic viewer 更容易证明能力边界。[PDF.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)、[PDF.js Setup](https://github.com/mozilla/pdf.js/wiki/Setup-pdf.js-in-a-website)

### 7.2 图片

utility 在解码前验证容器、声明尺寸、字节和像素限制。Renderer 只为通过验证的完整受限文件建立 Blob，并通过 `createImageBitmap`/canvas 解码；切换、失败或撤销时调用 `ImageBitmap.close()`、清空 canvas，并在曾创建 Object URL 时立即 revoke。decoder 失败返回 `parse-failed`，不回退为 `<img src=file://...>`、自定义文件 URL 或外部网络资源。[WHATWG HTML：ImageBitmap](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#imagebitmap)、[W3C File API：Blob URL](https://w3c.github.io/FileAPI/#url)

动画 WebP 只渲染第一帧并显示“动画已暂停”；需要完整动画时使用经独立验证的系统默认应用。PNG/JPEG/WebP 不读取外部引用，不执行 metadata。

### 7.3 文本

文本在完整满足 8 MiB/行数/单行限制后，以 fatal 模式解码为 UTF-8 或 BOM 指定的 UTF-16LE/BE。内容只进入 React 文本节点/`textContent`，保留换行并按最多 2,000 DOM 行虚拟化；不得使用 `innerHTML`、Markdown/HTML renderer、syntax highlighter、自动链接或系统 URL 动作。WHATWG Encoding 的 fatal decode 能把非法序列作为失败，而不是以 replacement character 静默改变内容。[WHATWG Encoding](https://encoding.spec.whatwg.org/#interface-textdecoder)

### 7.4 页面安全基线

预览页继承 ADR-01，并至少满足：

- `nodeIntegration=false`、`contextIsolation=true`、sandbox、`webSecurity` 不关闭；
- 不启用 `webviewTag`、plugins、`allowRunningInsecureContent` 或 worker Node integration；
- 不使用 `file://`、`iframe`、`embed`、`object`、`webview` 或 WebContentsView 加载用户内容；
- CSP 至少关闭网络连接、object/frame/form/base，并只允许签名 bundle 脚本/worker；图片 Blob 只限当前页面创建并及时撤销；
- 所有 navigation、new-window、download、外链和任意 protocol 动作默认拒绝；
- Main/Preload 对 sender、frame、origin、epoch、method、参数与大小重复校验。

用户文件始终是不可执行内容。解析器异常只关闭当前 preview session；不得形成 Workspace 重启循环或阻止 PLAN。若 profile 证明 PDF.js 工作影响 Renderer/Workspace 响应或需要额外崩溃隔离，按 ADR-02 的证据条件再评估临时 worker，不预建通用 parser pool。

## 8. 系统默认应用与文件夹定位

### 8.1 `LaunchRiskPolicyV1`

system-open 只允许通过完整资源重验的普通、非高风险文件。下列任一证据使资源成为 `launch-risk`：

- PE/ELF/Mach-O 等可执行 header、脚本 shebang 或目标平台 executable mode；
- 大小写不敏感的完整后缀命中以下 V1 deny set：

| 类别 | `LaunchRiskPolicyV1` 后缀 |
|---|---|
| Windows executable/library | `.exe`、`.com`、`.scr`、`.cpl`、`.dll`、`.ocx` |
| Windows installer/package | `.msi`、`.msp`、`.mst`、`.appx`、`.appxbundle`、`.msix`、`.msixbundle`、`.appinstaller` |
| Windows script/host | `.ps1`、`.psm1`、`.psd1`、`.bat`、`.cmd`、`.vbs`、`.vbe`、`.js`、`.jse`、`.wsf`、`.wsh`、`.hta` |
| Windows shortcut/indirect action | `.lnk`、`.url`、`.website`、`.application`、`.appref-ms`、`.pif`、`.reg` |
| macOS application/installer | `.app`、`.pkg`、`.mpkg`、`.dmg` |
| macOS/cross-platform script | `.command`、`.tool`、`.sh`、`.bash`、`.zsh`、`.ksh`、`.csh`、`.fish`、`.scpt`、`.applescript`、`.jar`、`.py`、`.pyw`、`.pl`、`.rb`、`.php` |
| macOS shortcut/indirect action | `.webloc`、`.inetloc`、`.alias`、`.workflow` |

后缀在目标平台等价 basename 上判定；无法安全 round-trip、尾随点/空格或其他名称歧义使风险后缀不可判定时，同样拒绝 system-open。内容证据、executable mode 或 deny suffix 任一命中即拒绝；政策不声称识别所有恶意文件。高风险文件仍可保存、索引、备份和 reveal；CourseFlow 不调用 system-open，也没有“仍然打开”、偏好设置、命令行或隐藏 override。新增/删除 deny 项必须提升政策版本、修订 ADR 并经过安全复核，不能通过只改 UI 放宽。

Microsoft 的 AppLocker 规则把 PE、脚本、Windows Installer 与 packaged app 分为可执行策略集合，并明确列出 `.exe/.com`、`.ps1/.bat/.cmd/.vbs/.js`、`.msi/.msp/.mst` 和 `.appx/.msix`；Windows Shell link `.lnk` 可携带目标、工作目录和参数。Apple 说明 `.command` 双击会由 Terminal 运行，Installer package/disk image 是软件分发入口，并把 shell、Python、Ruby、Perl、PHP、AppleScript 等识别为 script 类型。V1 deny set 在这些平台事实上采取更保守的固定超集。[Microsoft AppLocker file formats](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/applocker/working-with-applocker-rules)、[Microsoft Shell Links](https://learn.microsoft.com/en-us/windows/win32/shell/links)、[Apple `.command`](https://developer.apple.com/library/archive/documentation/Porting/Conceptual/PortingUnix/unix_environments/unix_environments.html)、[Apple software packaging](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)、[Apple script UTTypes](https://developer.apple.com/documentation/uniformtypeidentifiers/uttypeshellscript)

### 8.2 一次性平台动作

system-open/reveal 必须来自明确用户手势，且不能复用 preview lease：

1. Renderer 发 `FileId + expected stamp + mode`，不发送路径；
2. utility 完整重验，并为 system-open 执行 `LaunchRiskPolicyV1`；
3. 对允许的动作，utility 通过独立 adapter channel 建立一次性关联，真实 canonical path 只在该内部请求与 Main 私有映射中存在，期限 2 秒；
4. Main 再校验 sender/frame/epoch/correlation 后，只调用 `shell.openPath(path)` 或 `shell.showItemInFolder(path)`，不调用 `shell.openExternal`，不添加参数；
5. 关联立即消费并销毁，路径不进入普通 IPC、日志或持久状态。

`shell.openPath` resolve 空字符串只映射为 `PlatformActionRequested(system-open)`；非空错误、无关联、调用异常或期限失败映射为稳定 problem。requested 不表示第三方程序已完成读取。deadline 后无法确认的请求也不能显示“没有打开”；只显示 CourseFlow 未能确认平台请求结果。`showItemInFolder` 没有成功回执，调用被安全派发后只返回 best-effort requested。[Electron `shell`](https://www.electronjs.org/docs/latest/api/shell)

Windows Shell 可以通过文件关联、Shell extension 或 COM handler 处理文件，并会因无关联、权限、路径等原因失败；macOS 的 Workspace open/reveal 同样把后续行为交给外部应用。因此跨平台契约只承诺受控请求，不承诺外部程序结果。[Microsoft `ShellExecute`](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shellexecutea)、[Apple `NSWorkspace`](https://developer.apple.com/documentation/appkit/nsworkspace)

## 9. Outcome、失败隔离与当前问题

### 9.1 规范 outcome

```text
ResourceAccessOutcome =
  PreviewReady(descriptor, localSession)
  | PreviewUnavailable(reason, allowedActions)
  | PlatformActionRequested(system-open | reveal-in-folder)
  | ResourceAccessProblem(StructuredProblem)
```

稳定原因至少覆盖：unsupported、type-mismatch、password-required、limit-exceeded、parse-failed、timeout、stale、permission、not-found、launch-risk、no-association、platform-failed、channel-closed、epoch-mismatch 和 protocol-mismatch。Shell 按 reason 显示文字、dataEffect 与下一步；不得从 parser 原始异常推断“文件损坏”。

所有 outcome 都是 `dataEffect=unchanged`，不能返回 committed、disk-applied 或修改索引。单文件失败只影响当前资源表面；utility/Main/Renderer 退出会关闭全部 session，新 epoch 不重连旧 session。旧静态画面必须标失效，不能继续互动。

### 9.2 当前 Problem 最小化

按 [ADR-09](./ADR-09-no-production-diagnostics.md)，资源路径不建立诊断记录、日志或导出。当前 `PreviewUnavailable`/`StructuredProblem` 只可携带：

- 稳定 reason/problem/platform code；
- `platform`、PreviewKind、文件大小/资源限制 bucket，仅当它改变用户文案或 allowedActions；
- app/protocol/build、runtime、policy/limit 版本，仅当它用于 incompatible/unsupported 判定；
- 当前 limit 的计数/阈值，仅当用户可以据此选择其他文件或动作。

Problem、Operation 和任何持久状态都不得包含文件内容、名称、绝对路径、FileId、标签、PDF metadata、外链/URL、密码、lease/token、原始平台错误文本、任意内容片段、parse/render 历史或性能 trace。原始错误映射后丢弃，不自动上传。

## 10. 软件更新与发布兼容

preview lease、MessagePort、Blob、canvas、ImageBitmap、PDF worker 和临时解析缓存均为易失状态；关闭、崩溃、重启或软件更新后全部作废，因而不需要数据库 schema migration。更新后的应用必须从 FileId 和当前 stamp 重新进入 `accessResource`，不得恢复旧 session 或缓存字节。

资源数据面服从 ADR-04：

- Renderer ↔ Main、Main ↔ utility 在业务消息前 exact 匹配 `protocolVersion + appBuildId + workspaceEpoch`；
- resource protocol、DTO discriminator、`detectionPolicyVersion`、`limitProfileVersion` 或 `launchRiskPolicyVersion` 未知时关闭 capability 并解释，不做范围协商或字段忽略；
- mixed-build Main/Renderer/utility 不运行 preview 或 platform action；旧 epoch 的 chunk、ack 和结果全部丢弃。

发布清单必须固定并记录：Electron、Chromium、Node、`pdfjs-dist` 精确版本，PDF worker/CMap/font/WASM/相关静态资产 SHA-256，resource protocol、检测、限制和启动风险政策版本。每次这些运行时、PDF.js、资产或受支持 OS 变化都重新执行打包后的安全、恶意输入、DoS、性能、泄漏、离线和无障碍矩阵。

普通更新不得静默：

- 新增可预览格式或扩大纯文本后缀/编码；
- 启用 PDF 搜索、链接、表单、脚本、XFA、批注、附件、打印或下载；
- 提高资源限制、增加长期缓存或创建稳定外部资源 URL；
- 放宽高风险文件 system-open 政策。

这些变化需要产品确认、ADR 修订、策略版本和新 fixture。ADR-10 拥有签名、打包、更新器和 rollback，但必须把本文的双平台 packaged 证据设为 release/update gate；开发环境通过不能替代。

## 11. 依赖政策与未选择方案

### 11.1 依赖政策

首版只新增一个预览依赖：精确锁定的 `pdfjs-dist` library + 同版 worker。文件 I/O、hash、MessagePort、Blob、ImageBitmap、canvas、TextDecoder 和 platform action 使用 Node/Electron/Web 标准能力。不增加通用 viewer shell、custom protocol server、MIME 猜测库、图片 parser、native sandbox、legacy encoding、syntax highlighting 或 URL launcher 依赖。

PDF.js 不是安全边界的所有者；CourseFlow 的 allowlist、lease、配额、CSP、导航拒绝和发布更新门仍必须成立。依赖升级只有在完整矩阵通过后才可发布。

### 11.2 Chromium 内建 PDF + 自定义 protocol

未选择。Electron 没有承诺一个满足 CourseFlow range、脚本/链接禁用、权限、嵌入和跨版本行为的公开 PDF viewer contract；plugin/embed/custom scheme 还扩大 URL、CSP、缓存和导航面。[Electron Protocol](https://www.electronjs.org/docs/latest/api/protocol/)、[Electron Web Embeds](https://www.electronjs.org/docs/latest/tutorial/web-embeds/)

### 11.3 Lease URL/custom protocol + PDF.js fetch

未选择。它会把随机 URL 变成 bearer capability，并新增 scheme privilege、HTTP Range、Content-Range、session/cache/referrer 与 stream cancellation 语义。当前五类预览没有证据证明这些复杂度必要；只有 G7 证明 MessagePort range 无法过线时才重新比较。

### 11.4 普通 IPC 传完整文件

未选择。512 MiB PDF、64 MiB 图片和并发打开会突破普通 DTO、复制和内存边界，也无法提供按页 range、credit 与及时撤销。

### 11.5 generic PDF viewer、浏览器嵌入或只用系统应用

generic viewer/iframe/embed/webview 暴露本期不需要的导航、下载、脚本或插件面；只用系统应用又不满足 B-FILE-010 的内置预览和可访问文本要求。Display API 是当前最小可控中间点。

### 11.6 猜测更多类型/编码或收集 PDF 密码

未选择。自动识别 HTML/Markdown/JSON/source、SVG/GIF 或 legacy code page 会扩大内容解释和跨平台不一致；密码输入会新增秘密生命周期、焦点/无障碍和 parser 攻击面，当前产品不需要。

### 11.7 允许所有文件 system-open

未选择。Windows/macOS 默认打开可能直接执行程序、脚本、安装包、快捷方式或 URL handler；把资料库任意文件变成 launcher 超出“管理和查看课程资料”的用户结果。高风险 reveal 保留用户控制，同时不由 CourseFlow 发起执行。

## 12. 结果、代价与限制

### 12.1 正面结果

- FileId/stamp/purpose 是唯一授权来源，显示路径、后缀和旧页面不能升级为文件能力；
- 大 PDF 可按需 range，普通 Workspace DTO 保持小而可验证；
- Renderer 不接触真实路径、port、Electron 或 file URL，用户内容不进入通用浏览器嵌入；
- 类型、解析、资源、更新和启动风险都有版本化停止边界；
- preview/system-open/reveal 的成功语义诚实，不把外部程序或 best-effort 定位伪装为完成；
- 单文件解析、超限或通道故障不会修改正式数据，也不会阻塞 PLAN；
- 明确限制和双平台门减少 OOM、卡死、外链、脚本和供应链升级风险。

### 12.2 代价与限制

- 需要维护小型 lease/range/credit 协议、Preload 私有 session map 和取消清理；
- 引入并持续审查 `pdfjs-dist`，每次 Electron/PDF.js 更新都增加打包证据成本；
- 图片必须在较小硬上限内完整组装并解码；PDF 文本/结构质量受源文件限制；
- 不提供搜索、表单、密码、打印、下载、链接或完整动画等完整阅读器能力；
- 高风险判断是保守 allow/deny 政策，不证明普通文件无害，也不能约束用户随后在系统文件管理器中的动作；
- system-open requested 不证明外部程序成功，最终 OS 调用前的同权限 TOCTOU 不能完全消除；
- 限制值必须通过 G7 实测，若不满足目标规模只能重新评审，不能静默放宽。

## 13. 验收与证据门

ADR-06 只有在以下自动化与真实环境证据通过后才视为已落实：

1. **分类矩阵**：每种允许后缀/内容组合、大小写后缀、真/伪 header、截断、后缀冲突；严格 UTF-8、UTF-8 BOM、BOM UTF-16LE/BE、非法序列、NUL/二进制；SVG/GIF/HTML/Markdown/JSON/source 不内嵌。
2. **PDF/图片/文本 adversarial fixture**：加密/畸形/尾部 xref/超大页数、页面、文本项和嵌入图；脚本/XFA/表单/链接/附件均无动作和网络；畸形容器、像素炸弹、动画 WebP、超长行/行数。
3. **限制边界**：`PreviewLimitsV1` 每个 exact-limit 与 one-over fixture；超限不发布部分内容，资源及时释放，allowedActions 正确。
4. **数据面协议**：负数/溢出/越界 range、超额 credit、重复/乱序 ID、慢消费者、取消、5 秒 timeout、5 分钟 expiry/renew、窗口/页面/port 关闭和 app-wide quota。
5. **失效与崩溃**：文件 replace/move/delete、权限/root/stamp/object/epoch/protocol 改变，Renderer/Main/utility/PDF worker 退出；旧 session 不重连、不切换对象、不泄漏资源，显式 reload 重新验证。
6. **平台动作**：打包后的 macOS/Windows 对普通支持/不支持类型、无默认关联、路径消失、权限拒绝、Unicode/空格路径、system-open requested/failed、best-effort reveal；全部高风险 fixture 在 Main 调用前拒绝且无 override。
7. **安全与隐私**：静态依赖守卫证明 Renderer 无 Node/Electron/path action/raw port，Main 无 DB/领域分类；CSP/navigation/new-window/download/IPC sender probe；禁网运行；`TEST-PRIVACY-001` 证明无 app-owned 诊断/log/crash/telemetry artifact，Problem 不含内容、名称、路径、ID、URL、密码或 token。
8. **无障碍**：PDF 页码/跳转/缩放/适合页面、文本/结构层、扫描件提示、图片说明、文本选择、动画暂停、失效/错误状态的键盘、焦点、可见文字和 live-region 验收。
9. **G7**：在版本化参考设备/工作区记录 p50/p95/p99 初始 parse、页 render、range latency，Main/utility/Renderer event-loop delay、CPU、峰值 RSS、canvas/worker/blob/session 释放和重复开关稳定性；证明一个窗口/全应用上限不阻塞 PLAN 核心交互。
10. **更新 fixture**：旧 session 在新 build 中失效；exact build/protocol/epoch 和 policy version 停止；Electron/Chromium/Node/PDF.js/asset digest 变化重跑上述矩阵。

证据按 `TEST-SHELL-001–004`、`TEST-LIBRARY-007`、`TEST-PLATFORM-003`、`TEST-FLOW-03-LIBRARY-RECOVERY` 与 `G2/G5/G6/G7` 定位。真实平台门必须使用打包应用；无法在某平台执行时明确报告未验证，不能推断通过。

## 14. 后续 ADR 边界

- **[ADR-07 快照](./ADR-07-snapshot-format-integrity-publication.md)**：保存原始资料库文件和可验证 manifest，不保存 preview cache、lease 或解析投影；本 ADR 不决定快照编码、压缩或发布。
- **[ADR-08 恢复](./ADR-08-restore-activation-recovery.md)**：activation、RootGeneration 或 Workspace epoch 改变会撤销全部 session；本 ADR 不决定跨 DB/Library 激活和 rollback。
- **[ADR-09 无生产诊断](./ADR-09-no-production-diagnostics.md)**：不建设本地日志、崩溃收集、遥测或用户诊断导出；§9.2 只定义当前 Problem 的 typed safe details。
- **ADR-10 打包更新**：锁定 runtime/依赖、签名、更新器、rollback 与双平台发布集合，并执行 §10/§13 的 release gate。

## 15. 重新评审条件

出现以下任一条件必须重开 ADR-06 或建立明确替代 ADR：

- G7 证明 MessagePort range、当前图片完整 Blob 或 PDF.js 无法在已批准限制内满足响应/内存预算；
- 产品需要 PDF 全文搜索、密码、活动链接、表单、XFA、批注、附件、打印、下载或完整 viewer；
- 产品新增预览格式、legacy encoding、动画播放或允许新的系统启动类型；
- Electron/PDF.js/Web 平台取消或改变本设计依赖的公开安全、range、worker、structured clone 或 shell contract；
- 出现不能通过当前隔离、CSP、限制、升级或输入政策缓解的解析器/解码器安全问题；
- 需要抵御同权限恶意进程的最终对象替换，必须引入新的 OS handle/sandbox 能力；
- ADR-07/08/09/10 只能通过持久化 lease/cache、泄露路径、mixed build、联网解析或放宽高风险启动政策才能实现。

重新评审必须先说明受影响的产品行为、Requirement/IF/FLOW/Q/TEST、旧 session/数据兼容、攻击面、双平台证据和回退方式；不得以实现偏差代替新决议。

## 16. 参考资料

- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)
- [Electron IPC](https://www.electronjs.org/docs/latest/tutorial/ipc)
- [Electron MessagePorts](https://www.electronjs.org/docs/latest/tutorial/message-ports)
- [Electron `MessageChannelMain`](https://www.electronjs.org/docs/latest/api/message-channel-main/)
- [Electron `utilityProcess`](https://www.electronjs.org/docs/latest/api/utility-process)
- [Electron `shell`](https://www.electronjs.org/docs/latest/api/shell)
- [Electron Protocol](https://www.electronjs.org/docs/latest/api/protocol/)
- [Electron Web Embeds](https://www.electronjs.org/docs/latest/tutorial/web-embeds/)
- [Node.js File system API](https://nodejs.org/api/fs.html)
- [Node.js Streams](https://nodejs.org/api/stream.html)
- [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)
- [PDF.js Setup](https://github.com/mozilla/pdf.js/wiki/Setup-pdf.js-in-a-website)
- [PDF.js Releases](https://github.com/mozilla/pdf.js/releases)
- [WHATWG MIME Sniffing](https://mimesniff.spec.whatwg.org/)
- [WHATWG Encoding](https://encoding.spec.whatwg.org/)
- [PNG Specification, Third Edition](https://www.w3.org/TR/png-3/)
- [WebP Container Specification](https://developers.google.com/speed/webp/docs/riff_container)
- [Microsoft AppLocker file formats](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/applocker/working-with-applocker-rules)
- [Microsoft Shell Links](https://learn.microsoft.com/en-us/windows/win32/shell/links)
- [Microsoft `ShellExecute`](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shellexecutea)
- [Apple `NSWorkspace`](https://developer.apple.com/documentation/appkit/nsworkspace)
- [Apple `.command` behavior](https://developer.apple.com/library/archive/documentation/Porting/Conceptual/PortingUnix/unix_environments/unix_environments.html)
- [Apple software packaging](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)
- [Apple shell-script UTI](https://developer.apple.com/documentation/uniformtypeidentifiers/uttypeshellscript)
