# ADR-05 资料库监听、索引与文件操作：一手资料研究

> 状态：研究材料；不构成 ADR 决议或实现授权
> 主题：`ADR-TOPIC-05`
> 日期：2026-08-20
> 范围：`MOD-LIBRARY`、`MOD-PLATFORM`、`MOD-DATA`、`FLOW-03`，以及 `B-FILE-001–013`、`TEST-LIBRARY-001–007`

## 1. 研究问题与边界检查

用户结果是：学生可以在**一个**受管理资料库根目录中可靠地放入、找到、移动和打开课程文件；外部文件管理器的变化不能让应用虚报成功或把别的地方的文件当作资料库内容。真实文件与内容在磁盘，`LibraryRecord` 只记录已经验证过的对应关系；路径、显示名和监听事件都不是稳定身份或事实来源。

本研究不改变既有产品、模块或数据契约。尤其以下不在 ADR-05 的决策权内：

| 主题 | ADR-05 只需提供的输入/约束 | 另属 |
|---|---|---|
| 应用内预览、系统打开、reveal、平台授权/handle | `accessResource` 前的 root containment、重新验证、`FileId + stamp`；不决定渲染器、安全权限模型或系统打开实现 | `ADR-TOPIC-06` |
| 快照的 manifest 编码、内容 digest、临时发布、保留 | 已验证的 Library manifest/content source 与扫描状态；不决定快照布局或发布协议 | `ADR-TOPIC-07` |
| 整库恢复时 DB 与资料库的切换、continue/rollback、启动恢复 | 可被暂存/对账的资料库输入和未决操作；不决定 activation marker 或“当前 root”切换协议 | `ADR-TOPIC-08` |
| Electron/Node/SQLite 版本、签名、安装/更新、打包运行时 | 所选 watcher/文件 API 的实际 packaged macOS/Windows 验证门；不冻结版本或发布策略 | `ADR-TOPIC-10` |

`ADR-05` 可以选择：根内路径与链接的接受规则、扫描/索引/监听的职责、FileId 与磁盘对象证据的关系、应用管理的文件操作协议、冲突/中断/外部变更对账，以及是否引入 watcher 依赖。它不能弱化既有 `planned → disk-applied → index-committed`、磁盘真相、`Watcher` 只是 hint、三位置不重叠、`FileId` 不等于路径、以及 `disk-applied` 不能报完整成功的契约。

## 2. 已知约束与完成边界

- `B-FILE-001–013` 要求单一根目录、导入为复制、外部放入/关闭期间变化可发现、目录派生标签与 `CustomTag` 分离、同名显式决策、任意类型保存，以及备份/恢复映射一致。
- `MOD-LIBRARY` 已拥有 root 健康、`FileId/LibraryRecord`、目录映射、扫描/对账、冲突和访问前置验证；`MOD-PLATFORM` 只暴露文件系统、watcher、chooser 和受控平台能力；`MOD-DATA` 只保证 Operation/Revision/follow-up 的可恢复持久协议。[模块契约 §5.5、§5.8、§5.9](../architecture/MODULE_CONTRACTS.md#55-mod-library--文件资料库)
- `FLOW-03` 已规定：根切换先 preview/验证、应用内 mutation 先持久化 `planned`、平台动作后标 `disk-applied` 并验证、最后提交索引；外部变化经 scan 产生 ChangeSet；资源访问要重新验证 containment、存在性、权限和 stamp。[FLOW-03](../architecture/MODULE_CONTRACTS.md#84-flow-03--资料库对账与受验证资源访问)
- 因此“完成”不是收到事件、文件 API 返回或数据库有一行索引，而是：该文件在当前 root 内、其路径与磁盘对象仍通过验证，并且对应的索引 ChangeSet 已提交；否则保留明确 `unverified`、`missing`、`disk-applied` 或 `reconciliation-required` 状态。

## 3. 资料事实：Node 与操作系统的 watcher 不是日志

### 3.1 `fs.watch` 的实际语义

| 事实 | 一手资料与对 ADR-05 的含义 |
|---|---|
| Node 的 `fs.watch` 只有 `rename` / `change` 事件；目录 `rename` 通常表示名字出现或消失，不是可依赖的操作分类。`recursive` 仅在受支持平台生效；`AbortSignal` 可关闭 watcher。 | [Node `fs.watch`](https://nodejs.org/api/fs.html#fswatchfilename-options-listener)。事件只能排队为“需要扫描”的 hint，不能直接把 `rename` 写成移动、删除或 replace。关闭/abort 后应释放 watcher，下一次启动/重新授权后以扫描收敛。 |
| Node 指明 macOS：文件用 `kqueue`、目录用 `FSEvents`；Windows：`ReadDirectoryChangesW`。网络/虚拟化文件系统可不可靠或不可用。 | [Node watcher caveats / availability](https://nodejs.org/api/fs.html#fswatchfilename-options-listener)。macOS 与 Windows 共享领域语义，但 watcher 适配器必须允许 unavailable/error 并退回“待扫描/limited”，而不是假定同一事件序列。 |
| Node 说明：macOS/Linux 文件 watcher 绑定 inode；被删后同名重建是新 inode，原 watcher 不会再报告新 inode 的事件。Windows 若被监视目录移动/改名不再出事件，删除被监视目录会报 `EPERM`。 | [Node inode caveat](https://nodejs.org/api/fs.html#fswatchfilename-options-listener)。必须在根改变、watcher error、目录失踪、任何恢复和启动时重新安装监听并执行枚举；不能把“仍有 watcher 对象”视为覆盖整个 root。 |
| Node 回调 `filename` 即使在支持平台也可能缺失。libuv 的目录回调同样允许 `filename == NULL`，且只提供 rename/change 两类事件。 | [Node filename caveat](https://nodejs.org/api/fs.html#fswatchfilename-options-listener)、[libuv `uv_fs_event_t`](https://docs.libuv.org/en/v1.x/fs_event.html)。`null` filename 必须升级为 root（或受影响子树）的 scan hint，不能丢弃、也不能臆测具体文件。 |
| libuv 只承诺“每个平台选最佳 backend”；其 recursive flag 在文档中仅 macOS/Windows 支持，而且 macOS 启动 watcher 前刚发生的事件也可能随后送达。 | [libuv filesystem events](https://docs.libuv.org/en/v1.x/fs_event.html)。不能以“开始监听”切出无事件空窗；扫描要有明确的完成语义，并可在扫描后/事件批次后再次收敛。 |
| `ReadDirectoryChangesW` 可监视 subtree，却会在内部 buffer overflow 时丢弃全部细节（`lpBytesReturned == 0`）；`ERROR_NOTIFY_ENUM_DIR` 时 Microsoft 明确要求枚举目录/子树计算变化。 | [Microsoft `ReadDirectoryChangesW`](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-readdirectorychangesw)。Windows 适配器应把 overflow、枚举错误和无法记录全部变化统一成 scan-required，不以增量事件继续假装准确。 |

**结论（事实，不是选型）**：任何基于事件逐条维护索引的设计都必须有全量枚举的恢复路径；否则无法满足 `B-FILE-005` 的关闭期间变化，也无法从 filename 缺失、inode replacement、Windows overflow/目录改名、权限错误或 watcher 生命周期断裂恢复。Watcher 最多减少发现延迟，不能证明索引完整。

### 3.2 建议定义的“全量扫描”最小语义

这里的“全量”是当前已验证 root 的完整受管理树枚举，而不是扫描用户其他目录，也不是递归跟随到 root 外。一次扫描应产生可持久的 `ScanOperation`：记录所针对的 root generation/identity、开始/结束时刻、枚举/权限错误、被拒绝的链接、观察到的路径与磁盘证据，以及是否在同一 root generation 下完成。扫描完成前，旧索引仅可作为明确 stale/unverified 的上下文，不能支撑 `accessResource`。

扫描对账应以枚举到的事实和当前索引比较：

1. 发现同一路径对象仍匹配时，刷新 verification stamp；
2. 对路径变化，只有可证明同一对象的情况才保持既有 `FileId`；否则形成新增/缺失或 `waiting-decision`，不从文件名猜测“移动”；
3. 对外部放入/删除/更名/移动产生一个明确 Library ChangeSet；对存在同名、链接、权限或身份冲突的条目保留决定或恢复状态；
4. 一次成功扫描的 index commit 才推进“最后扫描”与可用性。扫描期间发生的 watcher hint 要合并为随后再扫，而非假定枚举快照覆盖未来变化。

这使全量扫描成为**事实收敛路径**，而 watcher 是“何时发起/加速下一轮”的提示路径，符合 [Architecture §4.4](../architecture/ARCHITECTURE.md#44-三个位置与快照) 与 `TEST-LIBRARY-003/006`。

## 4. 路径、containment、链接、大小写和 Unicode

### 4.1 两阶段 containment 与 TOCTOU 限制

`path.resolve()` 只能做词法绝对化；Node 自己提醒 `path.normalize()` 会移除 `..` 等而可能改变底层系统解析，Windows 还有 per-drive current directory（`C:` 不等于 `C:\`）。[Node `path`](https://nodejs.org/api/path.html#pathresolvepaths) 因而不应把字符串前缀、`startsWith(root)` 或单次 resolve 当安全 containment 判定。

可供 ADR 比较的最小验证链是：

1. 拒绝空、相对、跨 volume/drive 的根配置；以平台语义解析为绝对候选，明确 component 边界，不用字符串前缀；
2. 对已存在 root 和已有目标，先 `lstat` 检查路径段是否是链接/重解析点，再取得 `realpath`；Node 的 `lstat` 观察链接本身，`realpath` 解析 `.`, `..` 与 symbolic links，但文档明确 canonical path 仍不唯一（hard link/bind mount），且不做 case conversion；[Node `lstat` / `realpath`](https://nodejs.org/api/fs.html#fslstatpath-options-callback)；
3. 用 root 的 real path 与目标的 real path 做**路径段** containment 比较；对不存在的目的路径，逐段验证既存 parent 的 real path，并在创建/rename/copy 后重新打开/验证最终对象；
4. 在“检查”与“使用”之间外部方可替换目录或链接。Node 也明确不推荐先 `stat` 再操作，因为会产生 race；因此最终读/写/打开必须直接尝试并处理错误，且 `accessResource` 每次重验 root、路径、权限、存在性和 stamp，而不是复用旧检查。[Node `stat` race note](https://nodejs.org/api/fs.html#fsstatpath-options-callback)

这不是保证普通 path API 能消除所有 TOCTOU 的声明；若 ADR 需要对抗与用户同权限的恶意并发替换，必须另行评估能否在 macOS/Windows 使用目录 handle、no-follow/重解析点 handle 等平台能力，并把该安全目标写清。当前产品所需的最小结论是：不能以旧路径或旧索引绕过每次访问的再验证。

### 4.2 links / reparse points 的保守政策选项

Windows 的 reparse point 可含让文件系统 filter 改变打开语义的数据，并用于链接和 mounted folders；是否支持取决于文件系统。[Microsoft reparse points](https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-points)。这与 POSIX symlink 的“路径里可能离开 root”风险等价，但不是同一个 API 对象。

候选政策（未决）：

- **P1：受管理树中拒绝所有 symlink/reparse point，扫描记录明确 problem。** 最容易解释 containment 和单根边界，代价是不能索引用户手工放入的链接；“所有 reparse point”需要平台确实提供可查询的 tag 证据。
- **P2：允许文件链接但仅在每次扫描/访问解析后仍落于 root 时接受，拒绝目录链接和所有 root 外解析。** 功能较多，但每次操作需要 revalidation；hard link 仍使“canonical path 唯一”不成立。
- **P3：按平台 handle 做 no-follow / reparse-aware 验证，再决定个别安全链接类别。** 防护潜力更高，却需要新的平台适配器、双平台实测与 ABI/打包门，不应仅由本研究默认采用。

无论选择何者，`lstat` 与解析后的 containment 都是不同检查；“`realpath` 返回一个字符串”不是“没有链接”，而且硬链接可给同一对象多个名称。[Node `realpath` limitations](https://nodejs.org/api/fs.html#fsrealpathpath-options-callback)

**可实现性复核。** Node 文档化的 `Stats` 提供 `isSymbolicLink()` 等类型判定，但没有通用 Windows reparse-tag 字段；Microsoft 的 tag 清单则包含多种类型，并另行定义只有一部分 tag 是 name surrogate。由这两份 API 表面可推知：不引入 native handle/tag adapter 时，P1 的“全部 reparse point”不是可验证承诺。纯 Node 可证明的保守子集是拒绝 `lstat` 可观察链接、解析后越界和非 regular-file/directory 类型，并把访问/分类失败范围标 unverified；不能据此声称已发现所有非链接 reparse tag。若未来需要强保证，应选择 P3 并进入双平台 native/打包验证。[Node `Stats`](https://nodejs.org/api/fs.html#class-fsstats)；[Microsoft reparse tags](https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-point-tags)；[name-surrogate 判定](https://learn.microsoft.com/en-us/windows/win32/api/winnt/nf-winnt-isreparsetagnamesurrogate)

### 4.3 大小写、Unicode 与显示名

不要把 `toLowerCase()`、Unicode normalization 或 `path.normalize()` 当作跨平台文件身份规则。Node 明确指出 Windows 通常大小写不敏感，但其 path utilities 不做该语义；同时 `realpath` 也不在 case-insensitive filesystem 上转换大小写。[Node `path.basename` caveat](https://nodejs.org/api/path.html#pathbasenamepath-suffix)、[Node `realpath`](https://nodejs.org/api/fs.html#fsrealpathpath-options-callback)。Unicode 标准则定义了多种正规化形式和 canonical equivalence，而不是规定所有文件系统采用同一种存储/比较策略。[Unicode UAX #15](https://www.unicode.org/reports/tr15/)。

因此可检验的政策应分离：

- **逻辑/显示名**：保留用户或枚举返回的原始 Unicode string；不要以 normalization 改写真实路径，也不要把不同 Unicode code-point sequence 默认为同一个文件。
- **路径键**：仅在已经探测/声明的单个 root 文件系统规则下，用平台适配器提供的比较键处理 name-conflict；比较不能跨 root、跨卷或跨平台迁移复用。
- **磁盘证据**：将规范化路径仅作为当前位置，连同 root generation、类型、size/mtime 与平台对象 ID（如可得）形成 verification stamp；发生任何不一致即回到扫描/重新验证。

### 4.4 本地位置与云同步识别边界

Electron 的 `app.getPath('documents')` 只返回操作系统定义的 Documents 路径，不声明该目录未被重定向或同步；其 `userData` 文档甚至明确提醒某些环境会把目录备份到云端。[Electron `app.getPath`](https://www.electronjs.org/docs/latest/api/app) Node `fs.statfs()` 只返回 mounted filesystem 及平台相关 type，不能判断普通本地目录是否正被任意第三方同步进程监控。[Node `fs.statfs`](https://nodejs.org/api/fs.html#fsstatfspath-options-callback)

操作系统可提供部分更强证据：Windows Known Folder 列出 OneDrive/SkyDrive 及其 Documents 位置；Apple Foundation 暴露 volume-local 与 ubiquitous item 资源键。[Microsoft Known Folder IDs](https://learn.microsoft.com/en-us/windows/win32/shell/knownfolderid)、[Apple `volumeIsLocalKey`](https://developer.apple.com/documentation/foundation/urlresourcekey/volumeislocalkey) 但这些能力仍不能证明 Dropbox 等第三方没有同步任意普通本地文件夹。

因此 ADR 不能承诺“检测所有云同步目录”。可执行边界应是：拒绝已知远程/云位置和三位置重叠；保留 location evidence；对无法排除任意第三方同步的普通本地路径明确展示检测限制并要求用户确认。若产品要求对所有同步软件作强保证，必须新增供应商集成或改变根选择能力，不能靠路径字符串或 `statfs` 伪造证明。

## 5. `FileId` 与路径/磁盘对象身份

现有契约已经定义：`FileId` 跨**应用内** rename/move 稳定，路径不是身份；并没有承诺在任意外部改名、硬链接、复制、跨卷、恢复或新机器上自动识别同一物理文件。[契约身份表](../architecture/MODULE_CONTRACTS.md#21-稳定身份)

| 候选 | 能证明什么 | 主要缺陷 / 与契约的关系 |
|---|---|---|
| A. `FileId` 是随机、持久的 LibraryRecord ID；path + stamp 仅是可失效定位器 | 应用内操作在已验证结果后可保留逻辑对象与 CustomTag；复制、replace、外部不明变化天然不会误认同一文件 | 外部 rename/move 无法仅靠名称稳定匹配，扫描会更多地显示 missing/new 或请求决策；这是最贴合现有“路径不是身份”的最小范围。 |
| B. A + best-effort platform object evidence | 可减少确定性同卷外部 rename/move 的歧义。Node `Stats` 暴露 `dev` 与 `ino`，且可要求 bigint；Windows 原生 `FILE_ID_INFO` 的 volume serial + 128-bit FileId 在同一计算机唯一标识文件。([Node stats](https://nodejs.org/api/fs.html#class-fsstats)、[Microsoft `FILE_ID_INFO`](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_info)) | Node 抽象和不同文件系统不承诺可将这些值作为跨平台/跨备份永久 ID；replace/复制/跨卷可能换对象；需要 native Windows seam，增加 ADR-10 的打包/ABI 验证。应只用作扫描证据，不能取代 `FileId`。 |
| C. content hash 作为身份 | 可以判断已完整读取的字节是否相同 | 不是路径/对象身份：不同文件可同内容，内容编辑即换 hash，大文件成本和部分写入时机未决；对当前资料库没有去重产品需求，不足以承担 `FileId`。 |

**研究倾向（非决议）**：A 是契约所要求的下限；B 只有在跨平台 E2E 证明其能减少真实歧义且不产生错误合并时才值得采纳。任何外部“旧路径消失 + 新路径出现”的自动关联必须有不止文件名的可验证证据；否则使用 `waiting-decision` 更符合 `Q-TRUTH-01`。

## 6. 应用内文件操作：操作、原子性、耐久性与中断

### 6.1 通用事实与协议

Node promise/callback filesystem 操作通过 thread pool 执行，文档明确没有保证并列异步调用的完成顺序；例如 `stat` 可在 `rename` 前完成。[Node ordering note](https://nodejs.org/api/fs.html#ordering-of-callback-and-promise-based-operations)。所以应用不能发出多个未串行化的同一 `FileId`/目的名 mutation 后由完成回调猜最终状态；`FileOperation` 应锁定或以 expected stamp/root generation 重新验证。

`FileHandle.sync()` 只是请求把已打开文件数据 flush 到 storage，具体实现依 OS/device；Windows `FlushFileBuffers` 也只描述将该 file 的 buffered data 写出，并说明缓存/媒介细节与效率取舍。[Node sync](https://nodejs.org/api/fs.html#filehandlesync)、[Microsoft FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers)。因此不可把一次 `rename`、copy 完成或单文件 sync 表述成“跨文件/目录崩溃原子”；每种操作都要保留可对账中间态。

符合已有 `IF-FILE-OPERATION` 的最小通用步骤：

1. preview：使用当前 verified source/destination stamps、冲突策略和删除/分类/映射影响产生 confirmation；
2. 在 DATA 中持久化 `planned`（包括不可变的预期 root generation、源、目标、冲突选择、补偿/清理信息）；
3. 执行一个平台文件动作；动作成功后立即记 `disk-applied`，即使随后 index 写入失败；
4. 重新枚举/打开验证最终 containment、类型、存在性与 stamp；
5. 用一个 Library ChangeSet + DurableFollowUp 提交 `LibraryRecord`、标签与操作 `index-committed`；再发布 succeeded；
6. 启动时对每个非终态 Operation 做 scan/reconcile，绝不直接重放 delete/replace。

### 6.2 各动作的故障模型

| 动作 | 物理事实与风险 | 对状态机的要求 |
|---|---|---|
| **Copy/import** | `B-FILE-004` 要求复制，不移动源。Node `copyFile` 可用 `COPYFILE_EXCL` 令目标已存在时失败，但文档只承诺“尽力删除已创建目标”，失败后不保证目标不存在。[Node `copyFile`](https://nodejs.org/api/fs.html#fspromisescopyfilesrc-dest-mode) | 先用临时目标/唯一名再验证大小与必要 metadata，最后按同卷发布策略；任一不确定留下 `disk-applied/reconciliation-required`。源的事后删除不影响 LibraryRecord。 |
| **Rename / same-volume move** | POSIX `rename()` 定义目标存在时替换和目录限制，跨文件系统失败 `EXDEV`；其原子性是命名空间层的语义，不等于持久化或索引/DB 原子。([POSIX `rename`](https://pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html)) | 必须先完成同名决策；rename 成功后仍重验并提交索引。不得以 `rename` 返回成功绕过 `disk-applied`。 |
| **Cross-volume move / `EXDEV`** | 不能把 cross-device error 当作不可见实现细节。Windows 的目录 move 文档示例也要求源/目标在同一 drive；`MoveFileEx` 的跨 volume 行为会变成 copy/delete 语义，而不是一个 rename。[Microsoft moving directories](https://learn.microsoft.com/en-us/windows/win32/fileio/moving-directories)、[MoveFileEx](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw) | 作为复合 Copy → verify → source delete；任意阶段崩溃均可能两份都在或只有目标在，需 Operation 指引 resume/compensate/keep-both 决定；不能宣称原子 move。 |
| **Delete** | delete 受权限、占用/共享和外部并发影响；“可恢复删除”是否采用 OS recycle/trash 或项目内隔离区会影响恢复边界与路径布局。 | 先 persist planned；只有物理 absence/允许的可恢复落点验证后才 disk-applied。不要通过“DB tombstone 已写”掩盖未删磁盘文件；回收站/隔离区实现留 ADR-05 明确选择。 |
| **Replace** | Windows `ReplaceFileW` 本身合并多步骤并可选 backup，但官方列出了多种中间错误：原文件可能不存在、replacement 仍是原名，或原文件改名；三个文件必须同卷，且结果 FileId 是 replacement 的 FileId。[Microsoft ReplaceFileW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew) | replace 不可被建模为“保持目标对象身份”。必须把 source/target/backup/临时件全写入 Operation，并通过 scan 判定哪个文件实际存在，再更新/新建 `FileId` 的语义由 ADR 决定。 |

### 6.3 同名决策

`keep-both | replace | cancel` 是用户选择，不是 watcher 事件的推测。

- **cancel**：不做磁盘动作；无新 revision，planned 可标取消。
- **keep-both**：preview 生成候选新名称并以当前 root 的比较规则检查冲突；创建/rename 时必须使用非覆盖语义并在失败后重新列举。并发外部创建同名时回到 `name-conflict`，不自动改成 replace。
- **replace**：明确预览被替换对象、可恢复承诺和实际平台限制。替换后 FileId 是否保留只能由已验证的“逻辑资源语义”决定，不能从文件名或 Windows `ReplaceFileW` 推断；其物理对象 FileId 会变。

## 7. 外部变化、目录映射和 root change

### 7.1 外部变化

外部文件管理器没有 CourseFlow `planned`。因此 watcher/scan 发现的变化应创建 `ScanOperation` 或明确索引 ChangeSet，而不是伪造应用内 FileOperation。最低对账情形：

| 观察到的结果 | 索引处理 |
|---|---|
| 已索引路径仍存在且 stamp 相符 | `verified`；刷新扫描证据。 |
| 路径存在但 stamp/类型/对象不符 | `unverified`，后续按扫描规则作为 replace/外部变更；禁止旧 stamp `accessResource`。 |
| 旧路径不存在，唯一新路径有足够对象证据 | 允许提议为同一 FileId 的外部 move，更新目录派生标签；没有足够证据则不得自动关联。 |
| 外部新文件 | 创建新的 record；由目录映射派生 Term/Course/Category 标签，`CustomTag` 为空。 |
| 旧路径缺失或 root/子目录无权访问 | `missing`/`unverified(permission)`，列表可保留上下文但不得报“可用”；LIBRARY limited，PLAN 等继续。 |

“文件已改完”的时间也不能由 watcher 决定：Windows 的通知对写入/缓存有延迟条件；Chokidar 若启用 `awaitWriteFinish` 也只是轮询 size 到一段时间稳定，README 明示阈值依 OS/hardware 且会降低响应性。[ReadDirectoryChangesW write notifications](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-readdirectorychangesw)、[Chokidar `awaitWriteFinish`](https://github.com/paulmillr/chokidar#awritefinish)。MVP 可把新文件先索引为已存在但访问时重验；若产品要在“写完”前做 preview/content processing，则是 ADR-06/未来处理器应定义的就绪策略。

### 7.2 目录映射（Term/Course/Category）变化

目录位置派生的标签只在路径验证后更新；`CustomTag` 由 `MOD-LIBRARY` 独立存储，不能被目录 move、分类 rename 或 Course rename 清除。Course 的稳定引用是 `CourseId`，不是 course 文件夹显示名。

- Course rename 的结构化事实可先按 `FLOW-01` 成功；物理 folder rename 是 durable follow-up。失败时 Library 显示 pending/reconciliation，而 PLAN 不能被阻塞。
- 删除非空 Category 必须只接受 move-to-chosen-category 或 cancel；物理 move 逐文件/逐批执行时，每个中断均可能部分完成，必须依 Operation 和重扫恢复，而不是删除目录后宣称全成功。
- Change root 不能同时有两个 current root。新 root 的 preview、能力/overlap 验证、迁移/采用、全树对账和 index commit 完成前，旧 root 仍为 current；失败后保留旧 root 或进入明确 recovery。见 [FLOW-03 root branch](../architecture/MODULE_CONTRACTS.md#84-flow-03--资料库对账与受验证资源访问)。

## 8. 原生 Node 与额外 watcher 依赖的候选方案

| 方案 | 组成 | 优点 | 不足与必须证明的事 |
|---|---|---|---|
| **W1：Node `fs.watch` + 自有 scan/coalescer** | 以官方 Node watcher 发 scan hint；扫描、containment、状态机全由 Library/Platform seam 实现 | 无新增运行时依赖；直接可见 Abort/error/filename-null/recursive 语义；最符合“事件只是 hint”。 | 需自行实现 debounce、watcher 重新安装、overflow/error 策略与 macOS/Windows E2E；不能遗漏所有 Node caveat。 |
| **W2：Chokidar + 同一 scan/coalescer** | watcher 适配器由 Chokidar 提供归一化 add/change/unlink、递归与可选 polling；索引仍只由扫描提交 | 官方仓库描述其将事件转为 add/change/unlink，并提供 atomic-write 过滤与可选 `awaitWriteFinish`；可减少适配器代码。[Chokidar README](https://github.com/paulmillr/chokidar) | 仍不改变磁盘真相或 full scan 必要性；`atomic` 是时间窗启发式，polling 资源密集，`followSymlinks` 默认 true 必须与 containment 政策显式冲突处理。v4 仍新增一个依赖、最低 Node 14；实际 Node/Electron/打包版本由 ADR-10 验证。[v4 change](https://github.com/paulmillr/chokidar#changelog) |
| **W3：原生 watcher + 定期/按需 polling scan 作为第二发现通道** | W1 为低延迟，启动、用户重扫、watcher error/overflow/root change 以及可配置周期扫描为收敛 | 对关闭期间、事件丢失和非标准文件系统最明确；符合 Windows “enumerate”要求。 | 扫描 IO/能耗和响应性需 G7 基线，不得默认把 polling 当永远开启的替代；不会减少 containment/Operation 复杂性。 |

W1 与 W2 都必须配合 W3 的“按需扫描”最低能力；真正待选的是运行期 watcher abstraction，不是“是否仍扫描”。若未有以目标 packaged Electron/Node 在两平台跑出的证据，不应以库 README 替代 `TEST-PLATFORM-002`、`TEST-LIBRARY-*` 和 `G6/G7`。

## 9. 安全、失败与测试矩阵（供 ADR 的可验证输入）

| 场景 / failpoint | 预期可观察状态 | 主要证据 |
|---|---|---|
| root 候选在活动数据/备份目录内、路径前缀相似、不同 Windows drive、Node 可观察软链接/junction 或 realpath 逃逸 | preview/validation 拒绝；未更换 current root；不扫描 root 外 | `B-FILE-001`、`TEST-LIBRARY-001`、`TEST-PLATFORM-002` |
| 扫描中出现 Node 可观察 symlink/junction、特殊类型、分类/权限失败、filename `null`、watcher abort/error、Windows notification overflow | 明确 unverified/scan-required/problem；不遗失旧上下文，不报告 complete；恢复后全树收敛 | `B-FILE-005/013`、`TEST-LIBRARY-003/006`、`TEST-FLOW-03-LIBRARY-RECOVERY` |
| watcher 运行中 root 被移动/删除/同名重建，或应用关闭期间发生批量 move | watcher 只触发 hint/error；重新安装 + scan；不按事件顺序虚构操作 | `TEST-LIBRARY-003`、`TEST-PLATFORM-002` |
| Copy 的临时写入前/中/后、发布名冲突、verify 后 index commit 前崩溃 | planned / disk-applied / reconciliation-required；重启不覆盖、重扫后可 resume/compensate | `B-FILE-004/009/011`、`TEST-LIBRARY-002/004` |
| same-volume rename、`EXDEV` move 的 copy 成功/删除源失败、replace 的每种 Windows error、delete 被拒 | 不报完整成功；索引只表明实测磁盘状态，两个副本/原名/备份都可诊断 | `TEST-LIBRARY-002/004` |
| 外部同名替换、大小写变化、Unicode 等价但不同 code points、hard link、对象 ID 不可得 | 不用字符串/name/hash 单独判为同一 FileId；进入 verified new/missing/unverified/decision | `TEST-LIBRARY-003/006`、`Q-TRUTH-01` |
| `accessResource` 前后替换/移动文件、权限丢失、stamp 过期 | 重新 containment + open/stat 验证；返回 `resource-stale`/permission，绝不打开旧路径对象 | `B-FILE-009/010`、`TEST-LIBRARY-007`（ADR-06 实现预览/open） |
| Course rename、非空 Category move、root change 的 commit/follow-up/restart | PLAN 成功不被阻塞；Library pending/reconcile 可见，CustomTag 不丢，任一时刻只有一 current root | `B-FILE-002/003/006/007`、`TEST-LIBRARY-005` |
| 未配置网络、SMB/虚拟化或不可用 watcher | 核心 PLAN 正常；Library limited，手动/启动 scan 仍可工作或解释无法访问 | `NFR-010`、`TEST-LIBRARY-006`、`TEST-PLATFORM-002/004` |

macOS 与 Windows 的正式 E2E 还应覆盖：实际应用安装包中的 `process.versions.node/electron`，本地与受支持的用户选择卷，大小写/Unicode 目录名，可观察 symlink/junction 与特殊条目政策，权限撤销，watcher stop/restart，以及每个 `IF-FILE-OPERATION` 阶段 kill/restart。Windows 还应保留代表性非链接 reparse fixture，用于证明系统会诚实接受、拒绝或标 unverified，而不是假称已识别全部 tag。此为 ADR-10 的发布验证门输入，并非本研究声称已通过。

## 10. 尚待 ADR-05 明确的问题

1. 根内是否采用 P1、P2 或 P3 links/reparse policy？若允许，哪些类型与何种 handle-level 防护是实际要求？可实现性复核已证明纯 Node 只能采用 P1 的可观察子集，最终取舍由 ADR-05 记录。
2. `FileId` 是否仅采用随机 LibraryRecord ID（A），或在各平台增加可选对象证据（B）？B 的缺失、重用、replace、跨卷/恢复语义如何落入持久 schema 与测试？
3. 外部“删除 + 新增”在何种**可验证**对象证据下可自动保留 FileId；其他情况的用户决定 UX/稳定 ProblemCode 是什么？
4. `keep-both` 的候选命名规则、最大尝试数、保留 Unicode/扩展名和文件系统比较键由谁定义；无法创建时如何保持 `name-conflict`？
5. delete 的“优先可恢复”具体采用什么路径/平台机制；该机制如何不破坏单 root、snapshot 与 ADR-08 activation 边界？
6. replace 是否作为独立物理协议，还是在 MVP 仅以受控 copy/rename/backup 组合实现；逻辑 FileId 在 replace 后保留还是生成新记录？
7. W1/W2/W3 中 watcher 的选择与 scan debounce/优先级：依据应是 packaged 双平台的 failpoint、能耗和 G7 基线，而非理论事件归一化。
8. root change 的“迁移 / 采用 / 重建映射”对已有真实文件的精确产品选择、冲突与 rollback 体验是否需要先补充产品验收；ADR 不应自行创造文件移动承诺。

## 11. 一手来源清单

1. [Node.js File system API：`fs.watch`、watch caveats、`realpath`、`lstat`、stats、copy、sync](https://nodejs.org/api/fs.html)（Node 官方文档）。
2. [Node.js Path API](https://nodejs.org/api/path.html)（Node 官方文档）。
3. [libuv `uv_fs_event_t`](https://docs.libuv.org/en/v1.x/fs_event.html)（libuv 官方文档；Node watcher 的底层跨平台库）。
4. [Microsoft Learn：ReadDirectoryChangesW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-readdirectorychangesw)。
5. [Microsoft Learn：Reparse Points](https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-points)。
   [Reparse Point Tags](https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-point-tags) 与 [`IsReparseTagNameSurrogate`](https://learn.microsoft.com/en-us/windows/win32/api/winnt/nf-winnt-isreparsetagnamesurrogate) 用于区分 tag 总集和 name-surrogate 子集。
6. [Microsoft Learn：FILE_ID_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_info)。
7. [Microsoft Learn：MoveFileExW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw)、[Moving Directories](https://learn.microsoft.com/en-us/windows/win32/fileio/moving-directories)、[ReplaceFileW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew)、[FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers)。
8. [The Open Group POSIX `rename`](https://pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html)（原始规范；链接可访问性不替代已列出的平台 E2E）。
9. [Unicode Standard Annex #15: Unicode Normalization Forms](https://www.unicode.org/reports/tr15/)（Unicode Consortium 原始规范）。
10. [Chokidar 官方仓库 README / release notes](https://github.com/paulmillr/chokidar)（仅作为候选新增依赖的自述资料，不作为文件系统正确性证明）。
11. [Electron `app.getPath`](https://www.electronjs.org/docs/latest/api/app)、[Microsoft Known Folder IDs](https://learn.microsoft.com/en-us/windows/win32/shell/knownfolderid) 与 [Apple `volumeIsLocalKey`](https://developer.apple.com/documentation/foundation/urlresourcekey/volumeislocalkey)（默认 Documents 与本地/云位置判断能力边界）。

所有产品/架构要求均来自仓库内 [PRD §4](../product/PRD.md#4-课程文件资料库-b)、[MVP Scope §3.1](../product/MVP_SCOPE.md#31-b课程文件资料库)、[Architecture](../architecture/ARCHITECTURE.md) 与 [Module Contracts](../architecture/MODULE_CONTRACTS.md)，未在本研究中改写。
