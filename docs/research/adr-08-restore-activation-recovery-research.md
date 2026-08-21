# ADR-08 恢复激活、回滚与启动恢复一手资料研究

> 状态：已完成，供 ADR-08 决策使用
> 日期：2026-08-21
> 范围：Node/Electron 文件系统语义、SQLite WAL/关闭/备份、POSIX/macOS/Windows rename 与持久化边界
> 证据政策：仅引用上游项目、标准组织或操作系统厂商的一手资料；检索摘要与 `ATTEMPT.md` 不作为技术依据
> 后续约束：[ADR-09](../architecture/adr/ADR-09-no-production-diagnostics.md) 已决定不建设生产诊断/日志/支持包；ADR-08 journal 仍是正式恢复正确性协议。

## 1. 研究问题

CourseFlow 的恢复候选同时包含 SQLite 结构化数据与用户可见 Library 文件，但两者可能位于不同卷。ADR-08 需要回答：

1. 是否存在一个可跨数据库与资料库目录的操作系统原子事务；
2. SQLite WAL 数据库在激活前必须满足哪些关闭、checkpoint 和 sidecar 条件；
3. Node `fs` 的 copy、sync、rename 能保证什么，不能保证什么；
4. POSIX/macOS 与 Windows 对 same-filesystem rename、cross-volume move 和掉电持久化的语义差异；
5. 崩溃后如何在不打开混合 DATA/Library 的情况下确定继续、回滚或停止；
6. 哪些结论必须交给 packaged macOS/Windows failpoint，而不能从 API 文档外推。

本研究只决定 ADR-08 所需机制边界；当时未选择的 ADR-09 诊断保留/导出政策已由后续决议以“不建设”解决。本研究仍不固定 ADR-10 的绝对平台目录、签名或更新方案。

## 2. SQLite 证据

### 2.1 WAL 是数据库持久状态的一部分

[SQLite WAL 文档](https://sqlite.org/wal.html#the_wal_file) 明确说明 WAL 文件是数据库持久状态的一部分；把数据库文件与 WAL 分离会丢失已提交事务或使数据库损坏。WAL 模式还会使用 shared-memory 文件协调访问。

因此恢复不能在仍有活动连接、statement、iterator、backup source 或未检查的 WAL 状态时只交换 `workspace.sqlite`：

- checkpoint 前必须停止新写入并 drain 所有 DATA 使用者；
- 必须检查 WAL checkpoint 结果，而不是只调用后忽略 busy/错误；
- 必须关闭活动连接和短期验证/备份连接；
- DATA 的激活单位应是完整、关闭的数据库 slot，而不是从活动目录 raw-copy 一个文件；
- 启动发现外部激活未决时，不能先打开数据库“看看能否工作”，因为那会改变 WAL/sidecar 状态并污染恢复证据。

[SQLite “How To Corrupt”](https://sqlite.org/howtocorrupt.html) 进一步列出文件锁失效、数据库与 journal/WAL 分离、跨线程/进程误用等损坏方式，支持把单 writer、完整关闭和禁止混合 pair 作为硬门。

### 2.2 checkpoint 与 close 都有必须检查的结果

[SQLite `PRAGMA wal_checkpoint`](https://sqlite.org/pragma.html#pragma_wal_checkpoint) 区分 PASSIVE、FULL、RESTART 和 TRUNCATE，并返回 checkpoint 是否被阻塞及处理页数。CourseFlow 不能把“调用过 checkpoint”当作“所有 WAL 内容已收敛”。

[SQLite close API](https://sqlite.org/c3ref/close.html) 说明 `sqlite3_close_v2()` 在仍有未完成 statement、backup 或其他资源时可能留下 zombie connection，实际释放要等这些资源结束。Node `DatabaseSync.close()` 的表面返回也不能替代对所有上层资源生命周期的显式 drain。

ADR-08 的 checkpoint 前置条件由此必须包含：

- writer FIFO 停止接收普通命令并完全 drain；
- read transaction、prepared statement/iterator、Online Backup、validator 全部结束；
- WAL checkpoint 返回可接受结果；
- DATA 关闭并验证 slot 中数据库状态；
- 任一资源不能证明已释放时停在 checkpoint 前，不做“尽力交换”。

### 2.3 候选迁移与活动激活是两件事

[SQLite Backup API](https://sqlite.org/backup.html) 用于产生一致数据库副本；[SQLite `ATTACH`](https://sqlite.org/lang_attach.html) 与 [atomic commit 文档](https://sqlite.org/atomiccommit.html#multi_file_commit) 只讨论 SQLite 管理的数据库文件，不能把任意 Library 目录纳入同一个提交。

ADR-04 的候选复制、旧 schema 迁移与验证可以在独立数据库副本上完成，但它不能取得活动身份，也不能代替 ADR-08 在最终目标旁建立的 activation staging。恢复原件始终只读。

## 3. Node 与 libuv 证据

### 3.1 copy 不是提交协议

[Node `fsPromises.copyFile`](https://nodejs.org/api/fs.html#fspromisescopyfilesrc-dest-mode) 明确说明 copy operation 的原子性不受保证；发生错误时 Node 只会尝试删除目标。它适合从备份卷流式建立候选或安全恢复集，不适合作为激活提交点，也不能把 cross-volume move 的 copy-delete fallback 当作原子替换。

因此 ADR-08：

- 允许从备份位置跨卷 copy 到最终位置所在卷的 sibling staging；
- copy 完成后必须独立验证目标 bytes、数据库与 Library 闭包；
- activation 只在同卷 sibling 间切换；
- 任一同卷条件不成立时检查点前停止，不退化成 copy-delete。

### 3.2 sync 只作用于一个已打开文件

[Node `FileHandle.sync`](https://nodejs.org/api/fs.html#filehandlesync) 调用 `fsync(2)` 请求把一个打开文件的内核状态同步到存储设备。它不是跨多个文件、多个目录或多个卷的 barrier，也不保证云盘同步器已经上传。

恢复协调记录采用“写唯一临时文件 → sync → close → 同父目录非覆盖发布 → 重新打开并验证 canonical bytes”的原因是：每条证据必须先自洽再可见。即便如此，ADR 只能承诺通过目标平台 failpoint 证明的 process-crash recovery；不能把一个 `sync()` 调用表述成数据库、Library 与 journal 的绝对断电事务。

### 3.3 Node rename 的 Windows 实现不提供全局事务

libuv 的 Windows 文件系统实现使用 [`MoveFileExW`](https://github.com/libuv/libuv/blob/v1.x/src/win/fs.c#L2175-L2182) 完成 rename。该实现细节会随 bundled runtime 改变，必须由 ADR-10 固定版本并在 packaged app 重验，不能把当前源代码观察永久提升为产品契约。

无论当前 flags 如何，rename 只作用于一个路径条目；Node 没有一个能把 DATA slot、另一卷上的 Library root 和协调记录一起提交的 API。外部 append-only 协调状态仍然必要。

## 4. POSIX 与 macOS 证据

### 4.1 rename 提供单一 namespace 的原子可见性

[POSIX `rename`](https://pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html) 规定成功后目标名引用源对象，并列出跨文件系统时的 `EXDEV`。这支持 same-filesystem sibling rename 作为一个参与者的可恢复切换动作，但不支持以下推论：

- 两次 rename 合在一起是一个事务；
- DATA 与另一卷 Library 可以一次提交；
- 进程崩溃或机器掉电后目录 metadata 必然已经落盘；
- rename 失败后可以安全 copy-delete。

[POSIX 基础定义的文件读写与同步语义](https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap04.html) 也区分 namespace 可见性与持久存储效果。ADR-08 因此用外部 write-ahead 记录包围每个物理动作，并在重启后重新观察实际对象。

### 4.2 macOS flush 不是无条件硬件保证

[Apple `fsync(2)` 手册](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fsync.2.html) 说明 `fsync` 请求把修改写入永久存储，同时指出磁盘自身缓存可能影响实际保证，并提供平台特有的更强语义。CourseFlow 不在 ADR-08 猜测所有卷/设备都支持相同强度；可用能力、性能成本和失败映射必须在 ADR-10 的目标 macOS 版本与实际打包 runtime 上校准。

## 5. Windows 证据

### 5.1 cross-volume move 可退化成 copy-delete

[Microsoft `MoveFileExW`](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw) 说明 `MOVEFILE_COPY_ALLOWED` 允许跨卷 move，并通过 copy + delete 模拟；复制成功而删除失败时，函数仍可能成功。这与 CourseFlow 的“无部分成功、旧证据保留”不变量冲突。

ADR-08 因而禁止 activation 使用 cross-volume move/copy-delete。候选从备份卷复制到目标卷是 checkpoint 前的 staging；真正切换只在已证明同卷的 sibling paths 间进行。

### 5.2 ReplaceFile 也不是跨资源事务

[Microsoft `ReplaceFileW`](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew) 只替换单个文件，并有卷、权限、ACL 与 backup-file 行为约束。它不能替换非空 Library 目录，也不能与另一个 DATA 目录形成全局事务。

[Microsoft `FlushFileBuffers`](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers) 只针对一个 handle，并提示频繁调用的性能成本。ADR-08 必须用有界 journal、少量正式阶段记录和 G7 测量，而不是为每个 Library 文件构造通用事务事件流。

### 5.3 TxF 不可作为新产品基础

[Microsoft 对 Transactional NTFS 的弃用说明](https://learn.microsoft.com/en-us/windows/win32/fileio/deprecation-of-txf) 明确建议开发者采用替代方案，未来版本可能不再提供 TxF。它也不能解决 macOS 对等实现或跨卷 Library。CourseFlow 不采用 TxF、分布式 2PC 或仅 Windows 的隐藏 fallback。

## 6. 推导出的最小安全机制

从上述证据可得：

1. **没有可用的跨 DATA + Library 全局原子事务。** 产品承诺必须定义为可恢复的逻辑全有或全无。
2. **必须有外部协调真相。** 它位于不会随 DATA 或 Library 一起被交换的稳定本地控制位置，并在打开 DATA/watcher 前读取。
3. **每个物理参与者必须先落到最终目标所在卷。** 跨卷只发生在 checkpoint 前的流式 copy；activation 不允许 copy-delete。
4. **协调记录必须 write-ahead 且可验证。** 每个动作先有 intent，再观察磁盘并记录 observed；缺记录可以在唯一证据下补记，歧义必须停止。
5. **DATA 是 commit-last 参与者。** Library 先切换，DATA 最后安装；在中间窗口外部 journal 禁止普通打开，因此不会把新数据库配旧 Library 当作正常工作区。
6. **成功在重开之后。** 新 DATA 完整验证、Library 全量 reconcile、设备能力失效、FLOW-00 路由、数据库 success receipt 与外部 committed 记录都成立后才成功。
7. **回滚也需要同等证明。** 不能把 rename 回去就报告完成；旧 DATA/Library 必须重新打开、对账与路由。
8. **绝对掉电耐久不是当前可证明承诺。** 当前决策建立可校验的 process-crash/restart protocol；ADR-10 必须用固定 bundled runtime、目标文件系统和真实 macOS/Windows 设备运行 failpoint/断电近似实验并报告实际证据。

## 7. 对候选方案的影响

| 方案 | 一手证据下的结论 |
|---|---|
| 先复制到活动位置并覆盖旧文件 | Node copy 非原子；SQLite WAL/Library 会出现混合状态；拒绝 |
| DATA transaction + Library follow-up | SQLite transaction 不覆盖任意目录；会提前提交部分真相；拒绝 |
| Windows TxF / 单平台事务 | 已弃用、非跨平台、仍不解决另一卷；拒绝 |
| cross-volume move with copy fallback | Windows 明确可 copy-delete 且部分效果；拒绝 |
| generic participant 2PC/DAG | 当前只有 database + optional library；无法获得 OS 事务，只增加协议面；YAGNI |
| same-volume sibling staging + external append-only journal | 符合各平台能证明的最小原语，能逐动作恢复并保持证据；采用 |

## 8. 时效性与 ADR-10 复验清单

以下事实与 bundled Electron/Node/libuv/SQLite、OS 和文件系统版本相关，ADR-10 必须锁定版本并复验：

- Node/libuv 的 rename、sync、directory handle、错误映射和长路径行为；
- `node:sqlite` close、Online Backup、WAL checkpoint 与资源释放；
- APFS、常见 Windows 本地卷在文件/目录占用、权限撤销、空间满、杀进程和重启下的 sibling rename；
- journal temp/publish/reopen、每个 intent/observed failpoint 与 record/plan limits；
- 目标 DATA/Library 分属同卷或不同卷、外部程序持有目录、外部修改及杀毒/索引器干扰；
- 绝对路径基址、应用升级时稳定 `ActivityControlRoot` 的迁移与权限；
- G7 的耗时、峰值 RSS、峰值磁盘、维护窗口和恢复时间。

如 packaged evidence 不能证明某个平台的 non-overwrite publish 或 sibling directory swap，ADR-08 要重新评审该平台策略，不得在适配器中静默改成覆盖或 copy-delete。

## 9. 研究结论

一手资料支持 ADR-08 采用：外部 append-only activation journal、同卷 sibling staging、每步 intent/observed、DATA commit-last、启动先判定、显式 resume/rollback、重开/对账后成功。它不支持“跨数据库与资料库的 OS 原子替换”“Node rename 等于绝对掉电耐久”或“cross-volume move 失败时可以安全 copy-delete”等更强表述。

本研究没有运行 packaged Electron、真实 APFS/NTFS、kill/power-loss 或性能实验；这些是 ADR-08 的未来验收义务，不是已通过结果。
