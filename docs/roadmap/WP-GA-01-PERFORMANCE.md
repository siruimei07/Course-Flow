# WP-GA-01：G7 参考工作区与性能基线

> 版本：`courseflow-ga-reference-v1`；批准日期：2026-09-04。
> 用户已批准参考规模和下列 p95 数值。批准基线不等于测量通过，本文不宣告 G7 通过。
> 实际结果与 Gate 状态归 [验收台账](./WP-GA-01-ACCEPTANCE.md)；旧 candidate 原始记录保持原样。

## 1. 适用范围

[Architecture §8–9](../architecture/ARCHITECTURE.md#9-架构验收门) 要求版本化参考工作区、
macOS/Windows 设备档案，以及“启动、核心查询、正式提交和后台作业影响预算”；
G7 的完成条件是这些基线“已版本化并通过”。这是本表四类指标的来源。

[Roadmap §6](./ROADMAP.md#6-gate-使用规则) 将 G-A 定为 G1–G7 的 A-only 剖面，完整首发剖面在 R11。
四类指标是最低集合，不豁免当前 A-only 实现适用的 ADR 测量：

| 层级 | 当前义务与后续扩展 |
|---|---|
| G-A 的进程与 DATA | [ADR-02](../architecture/adr/ADR-02-process-thread-deployment.md)、[ADR-03](../architecture/adr/ADR-03-sqlite-active-data-transactions.md)、[ADR-04](../architecture/adr/ADR-04-schema-migration-compatibility.md) 仍要求 event-loop delay、cold open、query/commit 分位数、WAL/checkpoint、migration、integrity/FK、数据库大小和内存的适用证据 |
| 已实现的备份与恢复 | [ADR-07](../architecture/adr/ADR-07-snapshot-format-integrity-publication.md) 的 backup/hash/validation/publish/cleanup、资源占用与后台影响，以及 [ADR-08 §15](../architecture/adr/ADR-08-restore-activation-recovery.md) 的 validation/copy/maintenance/reopen/recovery 等测量仍适用于 A-only 路径；Library-present 完整闭包在 R11 扩展 |
| 正式发行 | [ADR-10 §14.3](../architecture/adr/ADR-10-packaging-signing-update.md) 的最终安装制品、迁移回退、空间/RSS/时长与 G8 证据在 R12；host Node 结果不能代替它们 |

本次批准未给 p99 或这些扩展指标新增数值阈值。p99 保留为观测值；不得从草案继承未批准阈值，
也不得因缺少扩展测量而把四类指标的通过写成完整 G7 通过。

## 2. 固定参考输入

| 输入 | v1 定义 |
|---|---|
| 学期 | 1 个；`G-A Reference Fall 2026`；2026-09-01 至 2026-12-18；`America/Toronto` |
| 课程 | 5 门 `GA101`–`GA105`，各继承学期范围；颜色依次 blue/green/orange/purple/red |
| 课节 | 每课 MON/WED/FRI 各 1 条 weekly Meeting 规则，共 15 条；课程索引 0–4 对应 09:00–10:00 至 13:00–14:00；LEC、地点 TBA |
| 任务 | 200 个 TaskSeries，标题 `GA Task 000`–`199`，课程按索引 `% 5` 分配；`% 4 = 0` 为 large，其余 small |
| 一次性任务 | 前 150 个；日期为 9 月 `1 + index % 28` 日；`% 10 = 0` 为 TBA，否则 `% 3 = 0` 为该日 16:00Z timed，其余 date-only |
| 重复任务 | 后 50 个；MON–FRI 按 `% 5`，17:00 local；9 月 1 日起、12 月 18 日止；`followTeachingWeek=false` |
| 初始状态 | 一次性任务 001–020 completed、021–040 skipped，其余 110 个 pending；重复任务不补状态 |
| 时钟与窗口 | host kernel 固定 `2026-09-10T13:30:00.000Z`；默认 PLAN 和 2026-09-01 至 09-30 的显式窗口 |
| 身份与修改 | ID 由正式 owner 生成并保存投影；Task 000 串行 completed/pending 切换，偶数轮后恢复 pending；receipt/revision 增长如实记录 |

种子只使用 `WorkspaceApplication` 与 shared 正式 request 构造器。每次生成新 WorkspaceId，
不复制或修改既有用户 DATA，不用 SQL 注入事实，不篡改参考库的 AppBuildId 来匹配其他包。

## 3. 已批准预算与测量端点

单位均为 ms，p95 使用 nearest-rank：排序后第 `ceil(0.95 × n)` 个样本；失败轮保留并使该轮无通过结论。

| 类别 | 批准预算 | 完整证据端点与样本 |
|---|---|---|
| 启动 | p95 ≤ 3000 | 20 次独立 packaged 进程启动；进程创建至参考 Workspace bootstrap 就绪且首个 PLAN 视图可操作。每轮完全退出进程；不清 OS 缓存，注明是 process-cold |
| 核心查询 | p95 ≤ 100 | 正式 Shell/preload 请求发送至成功 PLAN 投影返回；默认 Today/Week 与上述 Calendar/Agenda 窗口分别先暖身 10 次、保留 100 次 |
| 正式提交 | p95 ≤ 200 | Task 000 的正式状态请求发送至 committed outcome 返回；40 次交替提交，包含持久提交与正式响应，不包含后续异步备份完成等待 |
| 真实备份影响 | query p95 ≤ 150；commit p95 ≤ 250；两者分别相对无备份 p95 增量 ≤ 50 | 同一设备、运行时、参考输入与端点；分别保留至少 20 次与真实后台备份重叠的查询和提交，验证其覆盖水位最终 current，并与无备份对照比较 |

两个查询组分别判定，不混合成一个分布。样本保留原始顺序、失败、source/appBuildId、
WorkspaceId、前后 revision 和备份水位；不得删除慢样本、测后放宽预算或用平均数代替 p95。
大于等于 100 个样本才报告 p99；少于 100 个时记为未报告，没有 p99 门槛。
后台状态 `pending` 只证明尚有备份需求，不能单独证明计时区间内发生 CPU/I/O 重叠。

`scripts/measure-ga-packaged.mjs` 在请求组开始前经 Main 将唯一测试窗口置前；该准备不计入请求耗时。
请求前后的可见性/焦点及窗口事件留在原始报告中。失焦样本仍保留原始耗时与预算判定，
但报告不得以缺少前台证据的分布充当完整前台参考；不按耗时或焦点重试、筛选样本。
Main inspector 仅用于最后一个进程的同步置前准备，不暂停应用，不改变批准的端点、样本数或预算。

## 4. 可复用的 host kernel 工具

入口：[scripts/measure-ga-reference.mjs](../../scripts/measure-ga-reference.mjs)。
先在当前 checkout 执行 `pnpm test:compile`，结束其他测试/打包负载后运行：

```text
node scripts/measure-ga-reference.mjs --output ABSOLUTE_NEW_DIRECTORY
node scripts/measure-ga-reference.mjs --output ABSOLUTE_NEW_DIRECTORY --short-reference
node scripts/measure-ga-reference.mjs --output ABSOLUTE_NEW_DIRECTORY --seed-only
```

`ABSOLUTE_NEW_DIRECTORY` 替换为真实绝对路径：父目录须存在，目标目录须不存在。
工具拒绝覆盖；它只创建该目录内的 `Local/CourseFlow Dev/DataSlots`、首次配置的短备份目标 `b/`、
`reference-setup.json` 和 `kernel-measurements.json`。使用独立目录，保留失败产物，不重置旧参考根。

| 模式 | 实际执行 |
|---|---|
| 默认 | 完整种子；同一 host Node 进程内 20 次 Workspace reopen；两个查询组各 10 次暖身 + 100 次采样；40 次无备份提交；40 次配置备份后的提交/默认查询 |
| `--short-reference` | 相同完整种子，省略 reopen、200 次查询与无备份提交；仅 20 次配置备份后的提交/默认查询，并逐轮验证真实快照水位 current |
| `--seed-only` | 只用正式 Workspace 请求创建同一参考数据并关闭连接，不配置备份、不运行计时循环；输出 `reference-setup.json` 与标为 `seeded-no-measurements` 的报告，供独立 packaged driver 复用 |
| 无 DATA 检查 | `--help` 输出用法；`--self-check` 检查 CLI 拒绝已有/相对目录及分位数算法；二者均不加载 Workspace 或生成参考库 |

工具计时仅覆盖 `WorkspaceApplication.open/handle`，不经过 Electron、preload/IPC 或 Renderer。
`--seed-only` 与 `--short-reference` 互斥。Windows 种子位于输出目录的 `Local/CourseFlow Dev/DataSlots`；
macOS 的 seed-only 种子位于 `Home/Library/Application Support/CourseFlow Dev/DataSlots`，
供事先确认隔离路径的 packaged 进程使用；它不授权在用户已有数据根写入参考数据。
reopen 保留同一进程的模块/OS 缓存且不包含后续 bootstrap，不能填入 packaged 启动预算。
提交计时不包含之前读取乐观版本的 setup 查询。
成功响应不额外执行 JSON 字符串化；失败响应才序列化到断言报告，避免把驱动开销计入请求耗时。
备份使用正式配置、真实异步 writer，每次提交后都等待并验证 `current`/覆盖水位；
原始查询前后状态单独保留。
它没有独立测定后台 I/O 与请求区间的重叠，short 模式也没有无备份对照，不能据此判定完整后台影响门。

报告记录真实 host OS/CPU/RAM/Node/SQLite、HEAD、`git status --short` 与开发 AppBuildId。
`.test-dist` 没有嵌入编译身份；调用者须刚完成编译并记录命令日志，HEAD 加 dirty 状态不证明 clean 包。
脚本成功仅表示本次内核实验与断言完成，JSON 明确标为部分证据；异常保留报告并以非零退出。
连接在退出前关闭。数据路径、内存和进程资源值均仅描述本次 host，不是完整 Electron 进程树测量。

## 5. 设备档案与补证边界

| 平台 | 已有实测/台账档案 | 每次正式测量仍须记录 |
|---|---|---|
| Windows | 2026-09-04：ROG Strix G16 G615LP；Windows 11 Home China 25H2 `26200.9168` / x64；Core Ultra 9 275HX、24 logical processors、33,693,310,976 bytes RAM；E 盘 Samsung 990 PRO 2TB / NVMe / NTFS，约 1.15 TB 空闲；当前 Razer Cortex Power Plan；host Node 24.19.0、SQLite 3.53.3 | 每次记录电源/负载变化；packaged Electron/Node/SQLite、显示/DPR与进程树资源。只读设备原始记录为工作区 `_scratch/wp-ga-01-device-windows.json` |
| macOS | [BACKLOG 原生复验台账](./BACKLOG.md)：MacBook Air `Mac15,12` / Apple M3 / 16 GB；macOS 26.5.2 build 25F84 / arm64 | 在真实设备刷新上述字段、存储/文件系统、电源与负载；保存同一最终源码的原始数组及 packaged runtime 身份，现有 UI 复验不提供这些数值 |

2026-09-05 的 `23313c2` 前台实测使用 Silent 电源计划，未修改系统计划或停止用户进程；
同期低频整机忙碌率为 18.3%–28.5%。旧 Razer Cortex 档案保留其日期；不能把事后负载快照
当作早先失败轮的同期负载，也不能把前台普通测量的负载套到其后的后台实验。

本轮时间格式化与 Windows SQLite 路径边界修复属于新的源码状态。
旧 `b39124d3d83e887ee6a142c416a41654c304ab57` 的 macOS 原生验收继续保留其真实身份；
新增内核变更须在同一最终源码补相关自动化与性能证据，不能据旧包宣告 macOS 完整 G7 已通过。
这些补测不重开已完成的 UI 验收矩阵。两平台的完整四类原始结果、后台重叠证据及当前适用 ADR
附加测量仍按验收台账分别登记；未测项目明确保持未测。
