# ADR-05：资料库监听、索引与文件操作

- 状态：已接受
- 日期：2026-08-20
- 决策主题：`ADR-TOPIC-05`
- 前置决策：[ADR-01](./ADR-01-desktop-runtime-ui-boundary.md)、[ADR-02](./ADR-02-process-thread-deployment.md)、[ADR-03](./ADR-03-sqlite-active-data-transactions.md)、[ADR-04](./ADR-04-schema-migration-compatibility.md)
- 上游规范：[PRD](../../product/PRD.md)、[MVP_SCOPE](../../product/MVP_SCOPE.md)、[Architecture](../ARCHITECTURE.md)、[Module Contracts](../MODULE_CONTRACTS.md)
- 调研证据：[资料库监听、索引与文件操作一手资料研究](../../research/adr-05-library-watching-index-file-operations-research.md)

## 1. 背景

CourseFlow MVP-B 需要在 macOS 与 Windows 上管理一个本地资料库根目录，同时允许应用复制导入和用户通过 Finder/资源管理器直接修改目录。磁盘上的文件内容与存在性是真相；数据库索引只能记录最近一次已经验证的对应关系。当前必须决定：

- 默认根、正常换根、手工整库搬迁和根身份修复如何区分；
- 路径、大小写、Unicode、symlink/reparse point、hard link 与 containment 如何处理；
- watcher、启动扫描、手工扫描和运行期兜底扫描各自承担什么职责；
- `FileId`、`PathKey`、verification stamp 与平台对象证据如何分离；
- Copy、Rename、Move、Delete、Replace、Category 批处理和根迁移如何在崩溃后恢复；
- 软件更新如何继续解释旧 marker、PathKey、对象证据和非终态 FileOperation；
- 哪些决定必须留给资源预览、快照、整库恢复激活与打包更新 ADR。

Node 官方明确说明 `fs.watch` 在不同平台使用不同后端，事件只有 `rename/change`，filename 可能缺失，目录/inode 变化和平台错误会使事件不完整；Windows 原生通知缓冲区溢出时也要求重新枚举。因此 watcher 不能作为变更日志或索引事实源。[Node `fs.watch`](https://nodejs.org/api/fs.html#fswatchfilename-options-listener)、[Microsoft `ReadDirectoryChangesW`](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-readdirectorychangesw)

`ATTEMPT.md` 是归档旧尝试，不是实现或兼容基线。当前没有代码，本文只批准技术设计，不授权补齐 ADR-06–10 或开始实现。

### 1.1 追溯边界

- Requirement：`B-FILE-001–013`、`NFR-003/010`；
- 主要所有者与协作者：`MOD-LIBRARY`、`MOD-PLATFORM`、`MOD-WORKSPACE`、`MOD-DATA`、`MOD-PROTECT`；
- 接口：`IF-LIBRARY-COMMAND/QUERY/RESOURCE/MANIFEST/IMPACT`、`IF-FILE-OPERATION`、`IF-FILESYSTEM`、`IF-WATCHER`、`IF-DIRECTORY-CHOOSER`、`IF-LOCAL-LOCATION-CLASSIFIER`、`IF-SYSTEM-TRASH`、`IF-DATA-COMMIT/OPERATION`、`IF-BACKUP-CHECKPOINT`；
- 数据流：`FLOW-03`，以及与结构化 follow-up、快照和恢复交界的 `FLOW-01/04/05`；
- 质量约束：`Q-TRUTH-01`、`Q-PROTECT-01`、`Q-ISOLATE-01`、`Q-RESPOND-01`、`Q-PORTABLE-01`、`Q-EVOLVE-01`、`Q-CONTINUITY-01`、`Q-DIAG-01`；
- 验收：`TEST-LIBRARY-001–007`、`TEST-PLATFORM-002`、`TEST-FLOW-03-LIBRARY-RECOVERY`，以及 §15 的跨 ADR fixture/G7。

这些 ID 的语义和完整映射仍由 [Module Contracts](../MODULE_CONTRACTS.md) 拥有；本 ADR 只记录满足它们的技术选择。

## 2. 决议摘要

CourseFlow 采用**Node core watcher 只作提示、串行完整扫描负责收敛、持久 FileOperation 负责应用管理变更**的方案：

1. 同时只有一个符合本地资料库位置政策的根；默认优先使用系统 Documents，已知云盘/远程位置拒绝，无法排除任意第三方同步时显示限制并记录用户确认。
2. 根以版本化 `.courseflow-library-v1` marker 中的 `WorkspaceId + LibraryRootId` 标识；每次活动根切换、重新授权或 marker 修复产生新的 `RootGeneration`。
3. 正常 ChangeRoot 只迁移到 CourseFlow 新建或确认为空的新根；手工整库搬迁只通过匹配 marker 的 Reauthorize 接回；当前路径 marker 缺失可经只读扫描、影响预览和确认修复。
4. `PathKeyV1` 是保留原始大小写/Unicode 的版本化相对组件编码，只表示当前位置。路径、名称、platform object ID 和 content hash 都不等于 `FileId`。
5. 根及受管理树不跟随 Node `lstat` 可观察到的 symbolic link（目标平台标准 symlink/junction），拒绝解析后越界与非 regular-file/directory 条目；Node core 不提供通用 Windows reparse-tag 查询，因此不宣称识别全部非链接 reparse 类型。hard-link 路径分别建 record，不能仅因对象证据相同而自动合并。
6. Workspace utility 使用 Node `fs.watch` 产生 `scan-required`；不引入 Chokidar。启动、用户命令、watcher 异常和运行期最迟每五分钟启动的完整扫描使用同一协议。
7. `FileId` 是 CourseFlow 生成的稳定随机 ID。Node core `dev/ino` 等只作为当前设备、根代和卷内的版本化可选对象证据。
8. 外部移动只有在对象证据唯一且无矛盾时自动保留 FileId；否则等待用户决定。同路径 stamp 变化但对象证据缺失/不可靠时也等待用户区分编辑与替换，不自动转移身份或标签。布局外普通文件仍入索引并标 `unassigned`。
9. 每个根的应用管理磁盘 mutation 串行，并遵循 `planned → disk-applied → index-committed`。只有最终磁盘验证和索引提交完成后才报告完整成功。
10. Copy 使用非覆盖 staging 和 SHA-256 字节验证；同根 Rename/Move 不实现 `EXDEV` copy-delete fallback；keep-both 使用已预览且执行时重新验证的名称。
11. Delete 只通过 Electron Main 的系统 Trash/Recycle Bin 能力执行，失败不永久删除。Replace 先保留 operation-owned recovery 文件，逻辑身份跟随操作源，旧目标标签不继承。
12. marker format、PathKey encoding、ObjectEvidence provider 和 FileOperation payload 全部版本化；未知生命周期内版本使 LIBRARY recovery，不重置索引或磁盘。

## 3. 所有权与部署

### 3.1 `MOD-LIBRARY`

`MOD-LIBRARY` 是以下语义的唯一所有者：

- `LibraryRootId`、`RootGeneration`、marker 与根健康；
- `FileId`、`LibraryRecord`、`PathKey`、placement、verification stamp 与 CustomTag；
- ScanOperation、FileOperation、冲突、身份歧义、对账和 marker 修复；
- Term/Course/Category mapping 及目录派生标签。

它不拥有文件系统实现、系统回收站、chooser、资源预览/系统打开、snapshot format 或整库恢复 activation。

### 3.2 Workspace utility 与 Main

ADR-02 的 Workspace utility 承载扫描协调器、Library 状态机、Node-safe `IF-FILESYSTEM` 与 `IF-WATCHER`。普通文件 I/O 使用异步 Node core API，不创建常驻 worker pool。

Electron Main 只提供：

- `app.getPath('documents')` 与受控目录 chooser；
- 版本化 `IF-LOCAL-LOCATION-CLASSIFIER` 的平台证据入口；
- `shell.trashItem` 的 `IF-SYSTEM-TRASH`；
- [ADR-06](./ADR-06-resource-preview-system-open.md) 决定的 system-open/resource 数据面。

Main 不理解 Course、Category、FileId、替换身份或索引提交，也不得因平台 Promise resolve 自行宣称业务成功。Renderer 不获得 Node、Electron、原始 watcher、可执行路径能力或普通文件 IPC。

### 3.3 依赖政策

首版 watcher、路径、扫描、copy、rename、stat、sync 与 SHA-256 使用 Node/Electron 内建能力；不增加 Chokidar、native file-ID addon、文件锁库、content-addressed store 或通用文件事务框架。若 packaged 双平台证据证明内建能力不能满足本文测试门，必须重开 ADR，而不是在实现中静默引入依赖。

## 4. 根位置、身份与 marker

### 4.1 LocationAssessment

`IF-LOCAL-LOCATION-CLASSIFIER` 返回：

```text
verified-local(evidence)
known-cloud-or-remote(evidence)
unknown(limitations)
```

CourseFlow 必须拒绝：

- Windows UNC/device/network 位置或平台明确报告的远程卷；
- 平台明确报告的 iCloud/OneDrive/其他已知云容器；
- 已配置备份位置、活动数据位置，或与两者互为祖先/后代的路径；
- 无法建立绝对 canonical root、无法读写或无法完成受控 create/write/sync/rename/delete 探测的位置。

`unknown` 不得显示成“已证明本地”。它只有在界面说明“CourseFlow 无法识别任意第三方同步软件”、用户明确确认该目录未被同步，并把该确认作为 root 配置事实记录后才可接受。该确认防止误用，不是对恶意或隐藏同步进程的安全证明。

Electron 只提供系统 Documents 路径，Node `statfs` 只提供平台相关文件系统信息；两者都不能证明任意第三方未同步普通本地目录。[Electron `app.getPath`](https://www.electronjs.org/docs/latest/api/app)、[Node `fs.statfs`](https://nodejs.org/api/fs.html#fsstatfspath-options-callback) 因此本 ADR 明确保留 `unknown + attestation`，不虚构万能检测。

### 4.2 默认根与候选能力

默认候选为 `app.getPath('documents')/CourseFlow Library`。只有父位置通过 §4.1 且最终路径原先不存在时才由 CourseFlow 创建；已知云盘/远程 Documents 不创建默认根，改为请求用户选择。自定义新根可以原先不存在，或存在但必须为空且不含 marker、用户文件或未知控制项。

验证与操作都使用 resolved component boundary，不使用 `startsWith`。重叠检查基于各位置的 canonical real path/平台卷身份及祖先关系；Windows drive-relative `C:`、相对路径、NUL、设备命名空间和无法 round-trip 的路径拒绝。

### 4.3 marker format

根级保留文件名固定为：

```text
.courseflow-library-v1
```

内容是 UTF-8、无 BOM、无未知字段的受限 JSON：

```json
{"format":"courseflow-library-marker-v1","workspaceId":"<lowercase-canonical-uuid>","libraryRootId":"<lowercase-canonical-uuid>"}
```

写入顺序为同目录独占临时文件 → write → file sync → close → 非覆盖 rename → 重新打开验证。平台不承诺目录 rename 的跨崩溃耐久性，因此 marker 创建/修复仍由持久 Operation 恢复；不得仅因 `rename` 返回成功而越过正式边界。

marker 不保存绝对路径、RootGeneration、文件清单、用户标签、权限凭证或秘密。它是根身份证据，不是授权令牌。它不出现在用户文件列表、搜索或 Category 中，但必须作为控制项进入 ADR-07 的 Library manifest。点前缀不保证 Windows Explorer 隐藏；产品文案只能称“CourseFlow 保留文件”。

### 4.4 Reauthorize 与 Repair

`ReauthorizeLibraryRoot` 是正常换根唯一允许选择非空目录的入口。候选 marker 必须与当前 DB 的 WorkspaceId、LibraryRootId 和支持的 marker format 精确匹配；随后只读完整扫描。marker 证明逻辑根，不豁免 location、权限、containment、link 或逐文件对账。

`RepairLibraryMarker` 只允许数据库当前记录的同一路径，且该路径中没有其他/损坏 marker。系统先完成只读全树扫描，展示新增、缺失、外部替换和 unassigned 影响；用户确认后以 FileOperation 协议重建 DB 中原有的 WorkspaceId + LibraryRootId。不同路径不得用 Repair 绕过 Reauthorize。

## 5. PathKey、containment 与链接

### 5.1 `PathKeyV1`

`PathKeyV1` 是数据库 BLOB，不是显示路径：

```text
0x01
u32be(componentCount)
repeat componentCount times:
  u32be(utf8ByteLength)
  utf8Bytes
```

组件来自最终真实目录枚举，拒绝空组件、`.`、`..`、NUL、平台 separator 和非 Unicode scalar value；不执行 lowercase、NFC/NFD 或 locale collation。枚举名必须能在当前 Node/platform 表示与 UTF-8 scalar 序列之间严格 round-trip；失败时产生 `entry-name-unsupported`、将相应范围标 unverified，绝不写入替换字符后伪造的 PathKey。显示路径另由已验证组件按当前平台格式生成。PathKey 的 binary equality 只表示同一 RootGeneration 内的同一枚举位置；文件系统是否把两个名称视为冲突，必须通过新鲜目录枚举和非覆盖磁盘操作裁决。

### 5.2 containment

已有目标的最小验证链为：

1. `lstat` 根和每个受管理路径段；
2. 拒绝 `lstat().isSymbolicLink()` 的路径段和非 regular-file/directory 类型；
3. `realpath` 根与目标，并按路径组件边界证明目标仍在根内；
4. 核对 RootGeneration、PathKey、expected stamp 和权限；
5. 直接执行目标动作，并在动作后重新 `lstat/realpath/stat`。

不存在的目标先验证最近存在 parent，再以独占/非覆盖方式创建，最后重新执行完整验证。字符串 normalize/resolve 只能作为输入解析步骤，不能单独证明 containment。Node 也明确不推荐以预先 `stat` 替代直接动作，因为两者之间存在竞态。[Node file-system caveats](https://nodejs.org/api/fs.html)

每次 ADR-06 的 `accessResource` 都必须重新验证；旧索引、显示绝对路径或旧 realpath 不可充当能力。普通 path API 无法消除与同权限外部进程之间的全部 TOCTOU，本 ADR 的安全目标是拒绝已观察到的越界/链接并在每个事实边界重验，不宣称对恶意并发替换提供 handle-level sandbox。

### 5.3 可观察 links、特殊条目与 hard links

根本身及受管理树内由 Node `lstat` 报告为 symbolic link 的条目产生 `entry-link-unsupported`，扫描不跟随、不读取目标、不自动删除；目标平台 packaged conformance 必须覆盖标准 symlink 与 Windows junction。解析后越界同样拒绝，非 regular-file/directory 条目产生 `entry-type-unsupported`。其他普通文件继续可用；局部问题不把整个根伪装为空。

Node 文档化的 `Stats` 类型面只有 `isSymbolicLink()` 等类型判定，没有通用 Windows reparse-tag 字段；Microsoft 则定义了多种 reparse tag，且只有一部分属于 name surrogate。由此本 ADR 明确不保证纯 Node core 能发现每一种非链接 reparse point：若其表现为链接、realpath 越界、特殊类型或访问/枚举错误，就拒绝或把范围标 `unverified`；若平台把它暴露为根内普通文件/目录，则按普通条目处理。要求“识别并拒绝全部 tag”必须重开本 ADR、引入窄 native adapter 并经过 ADR-10 双平台打包门。[Node `Stats`](https://nodejs.org/api/fs.html#class-fsstats)；[Microsoft reparse tags](https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-point-tags)；[name-surrogate 判定](https://learn.microsoft.com/en-us/windows/win32/api/winnt/nf-winnt-isreparsetagnamesurrogate)

若两个同时存在的 regular-file 路径共享对象证据，它们视为两个目录项和两个 FileId。删除其中一个只处理该路径；外部移动关联要求旧路径消失且候选唯一，因此 hard link 不会被误判成移动。

## 6. Watcher 与扫描协议

### 6.1 原生 watcher

Workspace utility 对当前 canonical root 使用 Node `fs.watch({ recursive: true })`，并用 `AbortSignal` 关闭。所有回调都只提交：

```text
ScanHint { rootGeneration, reason, optionalObservedName }
```

`rename/change`、filename、事件顺序和事件数量不进入领域分支。filename 缺失、watcher error/abort、根被移动/删除、无法重新安装或平台异常统一设置 root-wide `scan-required`。更换 RootGeneration 后，旧 watcher 的任何迟到回调都丢弃。

### 6.2 扫描触发与协调

完整扫描触发源为：

- Workspace 启动或 utility 重启；
- 用户 `StartLibraryScan`；
- 任意 watcher hint、error 或不可用；
- FileOperation 完成/中断后的验证；
- marker repair、Reauthorize 或 ChangeRoot；
- 当前根可访问且应用持续运行时，距上次完整扫描启动达到五分钟。

扫描协调器只有 `idle | running(clean|dirty)`。提示批次合并为一次全根扫描；running 时的新提示只设置 dirty，当前轮完成后再追加一轮，绝不并行。五分钟期限按“启动下一轮”验收；若前一轮仍运行，则记录 scan-overdue health 并在结束后立即继续，而不是重叠扫描。

首版不根据 watcher filename 做增量索引，也不实现常驻 polling watcher。以后只有 G7 证据证明全根扫描开销不可接受时，才可在不改变完整扫描收敛路径的前提下评审有界增量优化。

### 6.3 扫描步骤与提交

一次 ScanOperation：

1. 持久化 scan ID、RootGeneration、trigger 和开始时刻；
2. 验证 LocationAssessment、marker、root realpath 与能力；
3. 递归枚举 regular files/directories，不跟随 `lstat` 可观察 links；特殊类型产生 problem，无法枚举或分类的范围标 unverified；
4. 对每项取得 PathKey、type、size、mtimeNs 和可选 ObjectEvidence；
5. 与当前索引产生确定性 ChangeSet 或身份等待决定；
6. 重新确认 RootGeneration/marker 未变；
7. 在一个 DATA commit 中提交 records、verification、placement、scan outcome 和 last-complete-scan；
8. 若 dirty，再安排下一轮。

任一目录无法枚举时，本轮不是 complete：受影响范围及其旧 records 标 `unverified`，但未观察到的条目不得批量标 missing，`lastCompleteScanAt` 不推进。一次完整扫描不是全目录原子快照；每个 stamp 只描述其观察点，资源访问仍重验。

watcher 不可用但文件系统与五分钟扫描可用时 health=`watcher-degraded`，经逐次验证的 Library 能力可以继续。根/marker/权限不可用时旧索引只作 unverified 上下文，文件 mutation 和 accessResource 暂停；PLAN 等模块继续。

## 7. FileId、stamp 与外部对账

### 7.1 身份与验证证据

`FileId` 使用 ADR-04 的 lowercase canonical UUID syntax，由 CourseFlow 创建并持久化。它跨应用内 Rename/Move、同一 marker 的根迁移/重新授权和索引重建稳定；不承诺跨任意复制、外部替换、不同 Workspace 或不相关恢复候选稳定。

`VerificationStampV1` 至少包含：

```text
rootGeneration
pathKeyEncoding + pathKey
entryType
size (canonical unsigned decimal)
mtimeNs (canonical integer + observed platform precision)
objectEvidence? { providerVersion, volumeToken, objectToken, linkCount? }
```

首版可选 `ObjectEvidence` 只使用 packaged Node `stat({bigint:true})` 能稳定提供的 `dev/ino/nlink`，以 `node-stat-dev-ino-v1` 标记并保存 canonical decimal strings。零值、不支持、精度/语义不满足或 runtime conformance 未通过时省略，不增加 native addon。它只在当前设备、同一 LibraryRootId/RootGeneration 和同一卷内作为关联证据；不能跨 snapshot/设备继承，也不能取代 FileId。Node 只保证 Stats 暴露这些平台值和平台相关时间精度，不保证其为跨平台永久身份。[Node `fs.Stats`](https://nodejs.org/api/fs.html#class-fsstats)

stamp 不是 cryptographic content identity。Copy/Replace/root migration 的 SHA-256 只证明该次传输的字节一致，不用于 FileId、去重、搜索或自动外部关联。

### 7.2 外部变化矩阵

| 磁盘观察 | 索引结果 |
|---|---|
| 原路径、对象证据连续，metadata 未变 | 保留 FileId，刷新验证时刻 |
| 原路径、对象证据连续，size/mtime 改变 | 同一 FileId 的外部编辑，刷新 stamp |
| 旧路径消失，当前根/卷内恰有一个无冲突对象证据候选 | 自动保留 FileId，更新 PathKey 与目录派生标签，CustomTag 保留 |
| 旧路径消失但证据缺失、复用或多个候选 | 旧 record=missing；新条目等待 `ResolveExternalFileIdentity`，不得猜测移动 |
| 同路径出现可靠且不同的对象证据 | 新建 FileId；旧 record 标外部替换历史/缺失，不继承 CustomTag |
| 同路径 stamp 已变化，但对象证据缺失或不可靠 | 旧 record=`unverified(ambiguous-file-identity)`；当前条目等待用户区分同一文件编辑与替换，确认前不转移身份/历史/CustomTag，也不允许旧 FileId 的受验证资源访问 |
| 新普通文件位于已映射路径 | 新建 FileId，按稳定 mapping 派生 Term/Course/Category，CustomTag 为空 |
| 新普通文件位于布局外 | 新建 FileId，placement=`unassigned`，进入索引和 manifest |
| 路径无权访问或扫描不完整 | 旧 record=`unverified(reason)`，不得宣称 missing/available |

用户把模糊移动候选确认为“同一文件”时才把旧 FileId、CustomTag 和历史关联到新路径；选择“不同文件”则保留旧 missing record 并为新文件建立身份。对同路径歧义，选择 `same-file` 后重验并保留旧 FileId/历史/CustomTag；选择 `replacement-file` 则 retire 旧 record、创建新 FileId 且不继承 CustomTag。文件名、size、mtime、birthtime 或 content hash 中任一单项都不足以自动关联。

## 8. 应用管理的 FileOperation

### 8.1 共同 envelope 与串行化

每个持久 FileOperation 至少保存：

```text
operationId
operationKind + operationPayloadVersion
rootGeneration
source FileId/pathKey/expectedStamp or externalSourceDescriptor
destination parentPathKey + requestedName
resolutionChoice
exact temp/recovery paths and roles
phase + phaseVersion
observed platform outcomes
recovery capabilities
```

同一根只执行一个应用管理的磁盘 mutation；扫描可以观察，但不能在 mutation 的中间磁盘布局上提交普通外部 ChangeSet。每个命令先 preview，再验证 expected facts，随后持久化 planned。外部并发仍可能发生，因此平台动作前后都必须重验。

operation-owned 临时名使用不可预测 OperationId/nonce 并以独占创建取得。扫描只有在“精确路径 + role + 非终态持久 Operation”全部匹配时才排除该项；仅匹配 `.courseflow` 字符前缀的用户文件仍按普通文件处理。

### 8.2 状态与成功边界

```text
planned -> disk-applied -> index-committed -> succeeded
   |             |               |
   +-------------+---------------+-> recovery-required
```

- `planned`：只证明意图已持久化；磁盘未声明改变。
- `disk-applied`：平台动作已发生或磁盘组合证明可能发生；不得报告完整成功。
- `index-committed`：最终位置/字节/containment/stamp 已验证，LibraryRecord 与 cleanup/backup follow-up 在新 Revision 提交。
- `recovery-required`：自动规则不能唯一判断继续或补偿；需要 scan 或用户决定。
- `succeeded`：只是 index-committed outcome 已发布；后续外部变化创建新事实。

Node 的 file sync/rename 不能被表述为跨文件、目录与 SQLite 的原子或绝对介质耐久保证。本文通过持久阶段和磁盘重验恢复，不把多个 API 调用伪装成事务。[Node `FileHandle.sync`](https://nodejs.org/api/fs.html#filehandlesync)

### 8.3 Copy/import

1. 读取外部源的 pre-copy type/size/mtime；只接受 regular file。
2. 在最终 destination directory 独占创建 operation temp。
3. 复制字节并计算 source SHA-256，sync/close temp。
4. 重读源 post-copy stamp；变化则不发布并进入可重试状态。
5. 读取 temp 计算 destination SHA-256；digest/size 必须一致。
6. 新鲜检查目标冲突，以非覆盖 rename 发布 temp。
7. 重验最终目标后 disk-applied，再创建 FileId/placement/tags 并 index-committed。

源永不由 CourseFlow 删除；发布后的资料库文件与源后续变化无关。

### 8.4 Rename/Move 与 keep-both

Rename/Move 只发生在同一已验证根与同一卷内，且没有 Node 可观察 link 或 realpath 越界；正常情况使用同卷 rename，源 FileId/CustomTag 保留。`EXDEV` 表示根假设或平台状态不成立，返回 reconciliation-required；首版不静默改为 copy-delete。

keep-both 从 `name (2).ext` 开始递增到第一个可用候选，dotfile 无 extension 时在完整名称后加 suffix。preview 返回一个候选；execute 时使用平台安全长度/保留名校验和非覆盖动作。如果候选被外部占用，返回新的 name-conflict 供重新预览，不擅自采用用户未确认的另一个名称。候选搜索有界到 `2..9999`；耗尽时要求用户显式改名。

### 8.5 Delete

Delete planned 后，Workspace 再验证 FileId/stamp/containment，通过 Main 窄 adapter 调用 `shell.trashItem`。Electron 承诺 Promise 在移动到 OS-specific trash 完成后 resolve、失败时 reject。[Electron `shell.trashItem`](https://www.electronjs.org/docs/latest/api/shell#shelltrashitempath)

resolve 后仍必须验证原路径消失，才记录 disk-applied；索引 commit 将应用内删除记录为 retired tombstone。reject 保留磁盘与索引，不调用 `rm/unlink` fallback。若 Main/utility 响应丢失后只观察到原路径消失，系统无法证明它确实进入回收站，必须进入 reconciliation 并说明恢复位置未知。

### 8.6 Replace

Replace 不使用直接覆盖语义：

1. 外部源先按 Copy 规则形成 destination sibling temp；内部源保持原路径。
2. 把原目标 rename 到精确 operation-owned recovery 路径。
3. 把操作源非覆盖 rename 到目标名。
4. 验证新目标 containment、stamp 和传输 SHA-256，并确认 recovery 文件仍可识别。
5. 记录 disk-applied；index commit 让内部源 FileId 或外部源新 FileId 占据目标，并 retire 原目标。原目标 CustomTag 不转移。
6. index commit 后把 recovery 文件作为 durable cleanup 送入系统回收站。

若第 2 步后发布失败，优先把 recovery 无损 rename 回原目标；无法安全回退时保留全部已知项进入 recovery。cleanup 失败不回滚已验证的新目标，而显示“旧文件非活动副本待清理”。

### 8.7 Category 批处理

删除非空 Category 前，Operation 冻结待移动 `FileId + expectedStamp + destination` 清单和游标，逐项执行一般 Move。每项 index-committed 后推进游标；外部变化只阻塞相应项。全部完成后才提交 Category 删除。重启从游标继续，不把部分物理移动报告为整体成功。

Course rename 的结构化 Course 事实可先按 FLOW-01 成功；目录 rename 是 LIBRARY durable follow-up。失败只使 Library mapping pending/reconciliation，不回滚或阻塞 PLAN。

## 9. 根迁移与唯一活动根

ChangeRoot 在开始前要求：旧根 marker/权限有效、刚完成完整扫描、没有其他非终态 FileOperation，目标通过 LocationAssessment/overlap/capacity 且为新建或空目录。

根迁移 Operation：

1. 持久化旧/新位置、LibraryRootId、旧/新 RootGeneration 候选、manifest、staging 与 cleanup 信息；
2. 在新根复制 marker 和所有 active/unassigned regular files，不复制 links 或不匹配任何 Operation 的未知控制项；
3. 每个文件使用 source-before/source-after stamp 与 Node core SHA-256 验证；任何变化重新排入差异集；
4. 进入短暂 cutover：暂停应用管理 mutation，完成旧根最终扫描和新根完整扫描；任意 watcher dirty、source stamp 变化、缺失/多余项或 digest 不一致都退出 cutover 并继续对账，不提交根；
5. 在 DATA commit 中写入唯一 current root、新 RootGeneration、重建的 PathKey/stamps 和迁移 phase；
6. 关闭旧 watcher，安装新 watcher并再次扫描；
7. 立即在旧根重验 marker、最终 manifest/stamps 和 cutover 后 dirty 状态；只有仍与已提交迁移精确一致时才把旧根送入系统回收站。任何新增/变化、验证失败或回收失败都只记录可见的 inactive-copy cleanup follow-up，绝不删除未知变化，也绝不重新把旧根声明为第二活动根。

普通 path API 无法冻结同权限外部程序的全部写入。迁移 UI 必须提示关闭正在写旧根的应用；cutover 以重复 stat/hash 和 watcher dirty 检测降低竞态。若产品以后要求对恶意或持续外部写入作强原子保证，需要新的平台锁/handle 能力并重开 ADR。

提交前失败保持旧根 current；磁盘中断使旧/新两份组合不确定时，启动恢复按 Operation/marker/manifest 判定继续、清理或等待用户决定。不会以“目标目录非空”为由自动采用其内容。

## 10. 启动恢复与健康

Workspace utility 的 LIBRARY 启动顺序固定为：

1. ADR-04 完成 DB/schema/operation version 验证；
2. 先恢复非终态 ChangeRoot/RepairMarker，确定唯一候选根和 RootGeneration；
3. 验证 LocationAssessment、overlap、marker、root realpath、权限与 link policy；
4. 按每个 FileOperation 的精确源/目标/temp/recovery 组合恢复；
5. 安装当前根 watcher；
6. 执行完整扫描；
7. 发布 LIBRARY ready/limited/recovery 与 capability。

恢复规则：

| 持久 phase / 磁盘观察 | 允许结果 |
|---|---|
| planned，源/目标仍满足原 stamp，无 operation 项 | resume 或 cancel |
| planned，但磁盘已出现计划中的唯一可验证结果 | 记录 disk-applied 后继续，不重复物理动作 |
| disk-applied，最终结果唯一且通过验证 | index commit |
| replace recovery 存在、目标未发布 | 安全恢复旧目标或继续发布，取决于源完整性 |
| delete planned/结果丢失且源消失 | reconciliation；不得宣称 trash 可恢复 |
| temp/recovery/目标组合矛盾或 RootGeneration 不匹配 | recovery-required + scan/user decision |
| 未知 operation/marker/path-key version | LIBRARY recovery；不解释、不重置、不删除 |

原始 OS/Node 错误只映射为稳定 ProblemCode；受限诊断可记录脱敏 platform code 与 diagnosticRef。UI 为满足产品需要可以显示当前真实根/文件路径，但普通 IPC 路径字符串不授予文件能力，诊断不自动上传。

## 11. 软件更新与持久兼容

以下协议版本随活动数据永久记录：

- marker format；
- PathKey encoding；
- VerificationStamp/ObjectEvidence provider；
- ScanOperation/FileOperation kind + payload；
- transfer digest algorithm；
- Library manifest compatibility fields。

新应用必须先执行 ADR-04 的 DB migration，并保留解释所有仍在生命周期内的旧 FileOperation 版本的恢复器，才可启动 watcher 或任何磁盘 mutation。未知 future version 只降级 LIBRARY；不把旧记录重建成新 FileId，不删除 operation temp/recovery，也不以空索引启动。

Electron/Node/OS 更新后：

1. packaged build 重新验证 fs.watch、Stats、路径、Trash 和 location evidence；
2. 旧 ObjectEvidence 在新完整扫描重新确认前不得用于自动外部移动关联；
3. watcher 不保存为持久事实，始终重新安装；
4. 相同 marker + exact existing PathKey 的 FileId 保留，stamps 重新生成；
5. 旧应用不能打开已经按 ADR-04 升级的 DB，不提供双写或反向迁移。

只改变 DB 中派生/可重建的 PathKey 可以在安全副本后重新扫描迁移；任何改变 marker 或真实 Library 布局的应用更新都属于 [ADR-08](./ADR-08-restore-activation-recovery.md) staged activation/rollback，不能藏进普通 SQLite migration。迁移前安全副本、应用 rollback 窗口与 packaged runtime 由 ADR-10 决定。

## 12. 后续 ADR 边界

### ADR-06（[已接受](./ADR-06-resource-preview-system-open.md)）：预览与系统打开

ADR-05 只提供 `FileId + expected stamp` 的 containment/存在/权限前置验证。ADR-06 决定大文件数据面、预览 parser、MIME/类型判断、system-open/reveal、租约和 Renderer 安全；不得从显示路径绕过本 ADR。

### ADR-07（[已接受](./ADR-07-snapshot-format-integrity-publication.md)）：快照格式与发布

ADR-05 提供 Library checkpoint 的必要条件：marker/root generation 稳定、完整扫描成功、所有 included records 有 verification、没有未决 disk-applied/reconciliation。checkpoint 包含 marker/path-key/object-evidence 版本、active/unassigned records 和 content sources。ADR-07 决定 snapshot manifest 编码、content digest、压缩、临时发布、保留和 operation 项处理。

### ADR-08：恢复激活

[ADR-08](./ADR-08-restore-activation-recovery.md) 决定 snapshot staging、DB + Library external activation journal、continue/rollback 和启动恢复。恢复中的旧绝对根配置不可信；必须验证当前设备位置、marker、WorkspaceId 和 Library 内容。本 ADR 的普通 ChangeRoot 不能冒充整库 restore activation。

### ADR-10：打包与更新

ADR-10 锁定 Electron/Node 版本、签名、更新集合和双平台发布门。它必须在真实安装包中证明本 ADR 所需窄 API；版本不满足时不能以开发环境通过代替。

## 13. 结果与代价

### 13.1 正面结果

- watcher 丢失、合并或错误不会直接污染索引；完整扫描是唯一收敛路径；
- 不增加 watcher/native 依赖，供应链、打包和维护面保持最小；
- FileId、路径、对象证据和内容摘要各有单一含义，避免误认移动或替换；
- 删除、替换、批处理和根迁移的每个物理中间态都能解释并恢复；
- 根 marker 支持手工整库搬迁，又不开放任意已有目录采用；
- software update 对 marker/PathKey/Operation 有明确停止与迁移规则；
- LIBRARY 故障只降级自身，不阻塞 PLAN。

### 13.2 代价与限制

- 运行期每五分钟完整扫描会产生 I/O；必须通过 G7 测量并串行限流；
- 外部移动缺少可靠对象证据时需要用户决定，自定义标签不会靠启发式自动搬运；
- Node 可观察的 symlink/junction、realpath 越界和非普通类型不受支持；纯 Node core 不保证识别全部非链接 Windows reparse tag；hard link 作为多个路径分别显示；
- 系统回收站不提供 CourseFlow 自有 undo 或稳定恢复句柄；结果丢失时只能诚实进入 reconciliation；
- Replace/root migration 为可恢复协议而非跨 DB/FS 原子事务，可能留下可见 cleanup follow-up；
- 不能检测所有第三方同步软件；unknown 路径依赖透明风险说明和用户确认；
- 普通 path API 的重验不等于对同权限恶意进程的 handle-level sandbox。

## 14. 未选择的方案

### 14.1 Chokidar + 扫描

Chokidar 可归一化 add/change/unlink 和部分写入噪声，但仍不能替代完整扫描；其 atomic/awaitWriteFinish 是时间启发式，链接默认行为还需额外约束。当前单根 + 全根扫描不从该依赖获得足以抵消升级/打包成本的正确性收益。[Chokidar](https://github.com/paulmillr/chokidar)

### 14.2 只轮询、不使用 watcher

实现更单一，但正常变化最多等待五分钟；缩短周期会持续增加 I/O。原生 watcher 已存在且只承担可丢失提示，保留它更符合用户期望。

### 14.3 逐事件更新索引

平台事件不是完整日志，无法覆盖 filename 缺失、overflow、关闭期间变化、目录重命名和 watcher 生命周期断裂，违反磁盘真相。

### 14.4 Path/File object/content hash 作为 FileId

路径会变化；platform object evidence 不跨卷/恢复/设备永久稳定；相同内容可以是不同文件且编辑会改变 hash。三者只可作为定位或证据，不能承担逻辑身份。

### 14.5 支持 links 或增加 native file-ID/location addon

当前没有链接产品需求。link 支持扩大 containment、快照和跨平台测试面；native file-ID 不能替代随机 FileId，native cloud API 也不能检测任意第三方同步。它们还会重新打开 ADR-01 的原生依赖边界，当前不采用。

### 14.6 内部垃圾区、直接永久删除或直接覆盖

内部垃圾区会污染活动根、快照和清理政策；永久删除不符合可恢复优先；直接覆盖隐藏了原目标与中断状态。系统回收站 + operation recovery 文件更符合当前范围。

### 14.7 采用任意已有目录

这要求解决任意内容的 FileId、CustomTag、mapping、冲突和合并语义，超出“更换根目录”。MVP 只迁移到新/空根，或重新授权具有匹配 marker 的同一资料库。

## 15. 验收与证据门

ADR-05 只有在以下自动化与真实环境证据通过后才视为已落实：

1. `TEST-LIBRARY-001`：Documents 三态、unknown 限制确认、三位置重叠、新/空根迁移、唯一 RootGeneration、旧根 cutover 后变化不被清理、marker reauthorize/repair/mismatch；
2. `TEST-LIBRARY-002`：每个 FileOperation phase、temp/recovery 组合、响应丢失和 utility kill/restart；
3. `TEST-LIBRARY-003`：外部新增/编辑/删除/唯一或模糊移动、同路径证据连续/明确替换/证据缺失歧义及用户选择、关闭期间变化、watcher filename null/error/loss 和五分钟期限；
4. `TEST-LIBRARY-004`：keep-both 名称竞争、replace 身份/标签、cancel、Trash success/failure/outcome-unknown；
5. `TEST-LIBRARY-005`：unassigned、五个建议分类、非空 Category 批处理、CustomTag、Course rename follow-up；
6. `TEST-LIBRARY-006`：权限、部分扫描、大小写、Unicode、名称编码 round-trip 失败、hard link、Node 可观察 symlink/junction、realpath 越界、特殊类型、无法分类范围、watcher degradation 与隔离；
7. `TEST-LIBRARY-007`：[ADR-06](./ADR-06-resource-preview-system-open.md) 资源访问前 stamp/containment 失效拒绝；
8. `TEST-PLATFORM-002`：packaged macOS/Windows 的 location evidence、路径、watcher、chooser 和 system Trash conformance；
9. `TEST-FLOW-03-LIBRARY-RECOVERY`：根迁移、扫描、FileOperation 与恢复的端到端 dataEffect；
10. ADR-04/10 update fixture：旧 marker/PathKey/ObjectEvidence/非终态 Operation 在新 build 中继续、迁移或严格停止；
11. ADR-07/08 fixture：marker、unassigned、pending operation 与恢复候选不会被 snapshot/activation 静默遗漏；
12. G7：版本化参考根规模下记录 cold/startup scan、事件批次 scan、五分钟 scan、root migration、CPU/I/O、utility event-loop delay 与内存；扫描永不并行且 PLAN 交互不受阻塞。

真实平台 gate 必须包括本地 Documents、已知云/远程路径、可移动本地卷、大小写/Unicode 名称、权限撤销、根移动/同名重建、系统回收站拒绝以及应用更新。无法在某平台验证就报告未验证，不能推断通过。

## 16. 重新评审条件

出现以下任一情况必须重开 ADR-05 或建立明确替代 ADR：

- 产品要求多根目录、云盘活动根、网络文件系统或多设备实时同步；
- 产品要求跟随 symlink/junction、识别全部 Windows reparse tag、对 hard link 提供单一逻辑身份，或抵御同权限恶意 TOCTOU；
- G7 证明五分钟全根扫描无法在目标规模满足响应/能耗，且有界增量扫描必须改变当前协议；
- packaged Node `fs.watch`、Stats、copy/rename/sync 或 Electron Trash 不能在任一目标平台稳定满足测试；
- 需要 CourseFlow 自有回收/undo、文件版本历史、去重或 content-addressed storage；
- root migration 需要在持续外部写入下提供强原子 cutover；
- 任意第三方云同步检测被提升为强保证；
- 后续 ADR 只能通过放宽单一根、磁盘真相、FileOperation 成功边界或模块隔离才能实现。

## 17. 参考资料

- [Node.js File system API](https://nodejs.org/api/fs.html)
- [Node.js Path API](https://nodejs.org/api/path.html)
- [libuv filesystem events](https://docs.libuv.org/en/v1.x/fs_event.html)
- [Electron `app`](https://www.electronjs.org/docs/latest/api/app)
- [Electron `shell`](https://www.electronjs.org/docs/latest/api/shell)
- [Microsoft `ReadDirectoryChangesW`](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-readdirectorychangesw)
- [Microsoft Reparse Points](https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-points)
- [Microsoft Reparse Point Tags](https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-point-tags)
- [Microsoft `IsReparseTagNameSurrogate`](https://learn.microsoft.com/en-us/windows/win32/api/winnt/nf-winnt-isreparsetagnamesurrogate)
- [Microsoft Known Folder IDs](https://learn.microsoft.com/en-us/windows/win32/shell/knownfolderid)
- [POSIX `rename`](https://pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html)
- [Unicode Normalization Forms](https://www.unicode.org/reports/tr15/)
