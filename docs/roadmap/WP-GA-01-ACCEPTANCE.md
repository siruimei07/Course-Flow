# WP-GA-01：MVP-A 内部验收记录

> 日期：2026-09-05
> 生命周期：Verification；尚未宣告 G-A 通过。
> 唯一状态来源：[BACKLOG 注册表与台账](./BACKLOG.md)。
> Gate 语义：[Architecture §9](../architecture/ARCHITECTURE.md#9-架构验收门)。

## 1. 制品与执行基线

| 项目 | 实际证据 |
|---|---|
| 同源源码 | `b39124d3d83e887ee6a142c416a41654c304ab57`，两平台均为 clean development package |
| macOS arm64 | package/smoke 与最终原生复验见 BACKLOG 的“macOS 最终 clean 制品原生复验”；用户在本次任务前确认 macOS 测试完成 |
| Windows x64 | 本轮在该提交的独立 detached worktree 中通过 `pnpm package` 与 `pnpm smoke:packaged`，均 exit 0 |
| 双平台烟测身份 | `development:b39124d3d83e887ee6a142c416a41654c304ab57`；SQLite `3.53.1`、`verified-local` |
| 开始任务的源码 | `07d2379bcb140a3f51c072e4e79af4598f1df206`；相对上述 macOS 源码仅追加 18 行台账；本轮修复的源码与验证另行记录 |
| 开始任务的 Windows 包 | clean `07d2379` 的 package/smoke 也均 exit 0；与同源配对的 `b39124d` 分别记录，不混淆 identity |
| 第一轮修复自动化 | `pnpm typecheck` PASS；`COURSEFLOW_REQUIRE_BROWSER=1 pnpm test`：750 = 749 pass / 0 fail / 1 skip，65293.6158 ms；包含 G5、formatter 与长路径修复，提交为 `f8f5f51ce727d23e12c8aceb3325e9bf67daf55c` |
| 第二轮修复验证 | 时间转换结果有界复用及驱动计时修正；typecheck 与脚本 self-check PASS；相同 752 项串行测试 751 pass / 0 fail / 1 skip。默认并行完整测试仍有失败，详见第 5 节 |
| 本轮最终源码与 Windows 包 | clean `df9841e4b1e942cbb856da14e677d5c7737d07ad`；`pnpm package` 与 `pnpm smoke:packaged` 均 exit 0；`development:df9841e4b1e942cbb856da14e677d5c7737d07ad`、SQLite `3.53.1`、`verified-local` |
| 唯一 Windows skip | `tests/platform/backup-destination.test.ts` 的文件 symlink 创建权限。保留环境跳过，不声称在 Windows 执行通过 |
| R7 前置收口的默认并行复验 | `pnpm typecheck` PASS；`COURSEFLOW_REQUIRE_BROWSER=1 pnpm test`：754 = 753 pass / 0 fail / 1 skip，62396.4652 ms；修复与原始失败对照见 Backlog 最新证据，日志为 `_scratch/r7-prereq-test-default.log` |
| 恢复后目录授权修复复验 | `pnpm typecheck` PASS；默认并行必需浏览器全套 755 = 754 pass / 0 fail / 1 skip，48099.3505 ms；新增成功恢复必须重新授权的回归与既有双次恢复、rollback/receipt 测试通过；日志 `_scratch/r7-prereq-test-restore-final.log` |
| 打包查询 Task 时区修复复验 | `pnpm typecheck` PASS；默认并行必需浏览器全套 756 = 755 pass / 0 fail / 1 skip，71069.2488 ms；别名/混合时区/非法输入构造计数 RED→GREEN，全部严格校验保留；日志 `_scratch/r7-prereq-test-task-zone.log` |
| 后台调度修复复验 | `pnpm typecheck` PASS；默认并行必需浏览器全套 758 = 757 pass / 0 fail / 1 skip，42966.1254 ms；排队读取及只读插队停止删除回归均 RED→GREEN，保护定向 138/138；日志 `_scratch/r7-prereq-test-retention-yield.log` |
| Task SQL 准备复用复验 | `pnpm typecheck` PASS；默认并行必需浏览器全套 759 = 758 pass / 0 fail / 1 skip，49778.2448 ms；相关 DATA/PLAN 190/190，通过不同 Task、提交后新状态、另一 DATA 与关闭重开回归；日志 `_scratch/r7-prereq-test-task-statements.log` |

Windows 日志保存在仓库外工作区 `_scratch/`：
`wp-ga-01-package-b39124d.log`、`wp-ga-01-smoke-b39124d.log`、
`wp-ga-01-package-07d2379.log`、`wp-ga-01-smoke-07d2379.log`、
`wp-ga-01-typecheck-fixed.log`、`wp-ga-01-test-fixed.log`。
修复前 745 项自动化的原日志仍保留为 `wp-ga-01-typecheck-final.log`、`wp-ga-01-test-final.log`。
本轮最终包日志为 `wp-ga-01-package-df9841e.log`、`wp-ga-01-smoke-df9841e.log`。

旧源码同源 worktree 使用同一 lockfile 离线安装既有依赖（0 downloaded）；未修改依赖。
本轮内核修复属于新源码；旧 `b39124d` 的双平台记录保留其身份，不替代新增修改的验证。

## 2. 逐 Gate 判定

| Gate | 当前判定 | 证据与适用边界 |
|---|---|---|
| G1 追溯 | 已交付 A-only 剖面 PASS | 用户于 2026-09-04 确认按已交付 A-only 模型验收，新模型另行登记后续工作包；已逐族定位 MOD/IF/FLOW/Q/TEST，新增语义的排除分支见第 3 节 |
| G2 依赖 | A-only PASS | `tests/architecture/module-dependency.test.ts` 全源码依赖扫描；`renderer-boundary.test.ts` 递归特权导入/权限/CSP；`runtime-boundaries.test.ts` 单 utility、固定 IPC/preload；`tests/shared/workspace-migration-contract.test.ts` 额外字段及路径拒绝 |
| G3 语义 | 已交付 A-only 内核 PASS | `meeting-occurrence-store` 的稳定实例/规则分段，`holiday-range-store`/`weekly-task-store` 的假期边界，`meeting-time` 的跨日/DST，`workspace-plan-contract` 的未知 deadline、排序、同 revision 与跨视图。Task 新分类按 G1 已确认范围留到后续工作包；Attendance/Grade 公式不属于此内部剖面 |
| G4 恢复 | A-only failpoint 内核 PASS | `sqlite-data-store` 的真实子进程提交中断；`durable-backup` 发布/保留失败；`restore-session` 的 checkpoint/forward/rollback/receipt；`schema` 与 `migration-rollback-handoff` 的迁移安全副本、绑定版本、重启/冲突。Library-present 完整闭包属于 R11 |
| G5 隔离 | 已交付 A-only 内核 PASS | 本次补强 `tests/workspace-protection.test.ts`：真实备份 failpoint 后保持 PROTECT degraded，继续提交 Term、Course/Meeting、Task，查询 PLAN，并重启比较完整投影；6/6 定向与完整套件通过。`workspace-lifecycle`/`workspace-plan` 继续覆盖未交付外围的 unavailable capability/projection |
| G6 产品环境 | 部分通过，尚未全门通过 | 既有同源双平台 package/smoke、源边界及焦点/ARIA/布局通过；最新默认并行全套 759 项无失败。人工、实际禁网／失败旅程、实际权限及自有 artifact 的范围须分别保留，见第 4 节 |
| G7 性能基线 | Windows 已批准预算通过；全门待 Mac | clean 0e55715 的普通端点、匹配对照与真实后台预算全部通过；同源运行时、20 次迁移/恢复、独立回滚及恢复磁盘观察已归档。Mac 同源实测待用户执行，见第 5 节 |

G4 的精确旧/新/兼容 build 独立 package 和跨进程回退来自既有 R6 台账；本轮未重跑该独立 runner。
`tests/scripts/development-build-fixture.test.ts` 只核对 descriptor/参数，不能冒充独立制品执行。
签名、安装、公开发行和 G8 仍由 R12 负责。

## 3. G1：已定位的适用性决定

ROADMAP §8 与 2026-08-28 一体化设计 §10 都把新模型安排为另行登记的后续切片，
当前 PRD/Contracts 已更新以下语义；用户于 2026-09-04 明确确认本次 G-A 按已交付 A-only 模型验收：

| Requirement 分支 | 已交付 | 已批准的后续目标 |
|---|---|---|
| `A-COURSE-002` | 零课节创建、首个课节、后续追加课节 | 同一提交原子创建多条课节 |
| `A-TASK-002` | `small / large` | Coursework / Assessment 及类型 |
| `A-TASK-009` | large 任务进度 | 与任务分类独立的 progressTracking |
| `A-VIEW-003` | next-small / next-large | next-coursework / next-assessment |

已确认口径：G-A 按已交付剖面验收，上表新增分支已登记为 Backlog 的 `WP-MODEL-01`（尚未领取），且不撤销它们的批准。
此决定只冻结本次内部验收的适用范围，不回退 PRD/Contracts，也不把新模型记为已实现。
当前首次设置已经是 Term-only minimum，不能把 ROADMAP 历史段落中的旧 minimum 写回产品。

实际存在的 `A-TERM-006` 已在用户批准的 UI 切片 9 实现并具备重置/幂等/冲突/重启测试。
本轮只补齐其主所有者登记与计数：MVP-A 43、首发 62、含 C1 的完整设计 76；C2 不计入。

## 4. G6：产品环境证据

- macOS：本轮沿用用户“测试已完成”的确认及最终 clean 制品台账，不要求重做已有验收。
  该确认不自动生成未记录的性能样本。
- Windows 历史真人矩阵：Sirui 在 `4254d80` 上声明 48/48，包含八个表面、两档窗口、
  默认/高对比度/透明关闭、物理鼠标与 Snap；保留原源码身份，不改写为本轮 `b39124d` 人工观察。
- 本轮 `b39124d` 在隔离 APPDATA/LOCALAPPDATA 下启动，原生欢迎页与单一窗口边界可见；
  native click 返回 `SendInput sent 0 of 1 events; GetLastError=87`，恢复时工具又报告用户输入及窗口最小化。
  因此本轮没有登记完整原生输入矩阵通过，也没有用模拟指针/DOM 注入替代。
- 输入工具按默认环境启动的一次额外窗口被识别为默认数据根并关闭；没有在该窗口提交测试事实。
  后续验收只使用任务隔离根。
- `TEST-PLATFORM-004` 的禁网核心旅程及恢复/recovery 尚无本轮完整证据；源码没有远程依赖
  或 CSP 拒绝网络，不能单独替代禁网运行结论。
- Windows 实际权限分项 PASS：只在任务专属目录对当前用户施加 Write deny ACL，
  原生写入返回 EPERM，PLATFORM/PROTECT 映射为 permission，Workspace 返回
  `permission / dataEffect: unchanged`，配置保持 unconfigured、revision 0、目的地无遗留。
  finally 恢复原 ACL（SDDL 完全相等）并实际写入读回成功；未改变生产目录或系统全局权限。
  脚本及原始结果在 `_scratch/wp-ga-01-permission-probe/`，具体运行目录为
  `run-b520e347261a4d56ad65aa2437b3eca2`。
- packaged artifact 分项：同源 app.asar 共 12 个条目，没有自有 log/diagnostics/crash/telemetry
  命名条目；隔离欢迎会话落盘 41 个文件，全部在 Chromium 子树中。
  原始清单为 `_scratch/wp-ga-01-artifact-probe.json`。结合已通过的源码守卫，
  此处只证明包内容和欢迎会话，不扩大为所有失败旅程的 artifact 已通过。
  Chromium 自身缓存与正式 receipt/operation 不应误判为产品诊断日志。

### 当前恢复修复的 Windows packaged 实证

干净 `2986822de330725d4d857335f034078d5d70e37e` 的 package 与隔离 smoke 均通过，
SQLite `3.53.1`、verified-local；2026-09-05 03:11:09–03:11:14 UTC 完成 8 项检查，8 次进程全部 exit 0。
真实备份目录不可用时仍可提交 Course/查询 PLAN，重启保留该本地事实；整库恢复验证 SafetySet，
替换 DATA 后重启保留快照事实，并保持 unconfigured/PROTECT healthy。
恢复后显式重新授权原目录产生新 BackupSet；随后 packaged 提交更高 revision 并实际备份至 current，
再次重启保持新授权，旧成功快照 manifest/SQLite 字节不变。两个损坏 DATA 启动均进入 recovery，
拒绝普通访问且原始字节未变。

原始结果为工作区 `_scratch/r7-prereq-g6-20260905/r-33b7aaae/result.json`。
初始 fixture 与恢复后的重新授权由关闭 packaged 后的 host Workspace 正式请求准备；原生目录选择未测。
其后的更高 revision 备份确由 packaged 完成。网络未禁、非真人输入，不能关闭完整 G6/TEST-PLATFORM-004。
修前 `r-2ff9468f` 现场及 RED/GREEN 日志保留在同父目录，不把 API succeeded 掩盖的旧备份退化改写为通过。

## 5. G7：已批准基线与未完成项

用户在本次任务中明确批准以下基线：
一个 2026-09-01 至 2026-12-18 的学期、五门课程、十五条每周课节规则、二百个任务。
process-cold startup p95 ≤ 3000 ms、核心 query p95 ≤ 100 ms、正式 commit p95 ≤ 200 ms；
真实后台备份期间 query/commit p95 分别 ≤ 150/250 ms，且各自比无备份基线增加 ≤ 50 ms。
定义和可复用种子入口见 [G7 性能基线](./WP-GA-01-PERFORMANCE.md)。失败时不能事后放宽预算。

`_scratch/wp-ga-01-measure.mjs` 通过正式 Workspace 请求生成专属参考数据并记录主机内核样本。
它不测 packaged IPC、Renderer 首帧或 Mac；主机内核 timing 不能代替这些端到端指标。
最终关闭 G7 还需要：相同参考输入的 Windows/macOS 原始结果、
明确采样端点与后台实际重叠覆盖，以及所有适用指标的判定。

### Windows 主机内核实测补充（2026-09-04）

已通过正式 Workspace 请求生成并读回一个学期、五门课程、十五条每周课节规则、二百个任务
（150 once、50 weekly；once 中 110 pending、20 completed、20 skipped），最低设置满足。
主机为 Windows x64、Node `v24.19.0`；源码 HEAD 与生成 AppBuildId 为 `07d2379` /
`development:07d2379bcb140a3f51c072e4e79af4598f1df206`。当时工作树有测试/文档改动，
不能称为 clean packaged build，也未把参考库元数据改成 macOS 已测制品的 `b39124d` 身份。
内核时钟固定为 `2026-09-10T13:30:00.000Z`，系统时钟未改；日期窗口固定为 2026 年 9 月。

| 实测端点 | 样本数 | p50（ms） | p95（ms） |
|---|---:|---:|---:|
| 同一 Node 进程中关闭后重新 `WorkspaceApplication.open` | 20 | 59.91 | 72.77 |
| 默认 PLAN 正式请求至成功投影 | 100 | 696.89 | 974.35 |
| 9 月窗口 PLAN 正式请求至成功投影 | 100 | 1104.90 | 1281.45 |
| 未配置备份时正式任务状态提交 | 40 | 2.49 | 3.97 |
| 已配置但备份持续 pending 时的正式提交 | 40 | 7.32 | 9.51 |
| 已配置但备份持续 pending 时的默认 PLAN | 40 | 799.25 | 969.12 |

分位数使用 nearest-rank；原始数组、设备信息、固定参数和断言结果保存在仓库外
`_scratch/wp-ga-01-reference/kernel-measurements.json`，种子投影为同目录 `reference-setup.json`。
上述重开保留进程/OS 缓存，且查询和提交通过主机 Node 内的 Workspace boundary，
没有测量 Electron IPC、Renderer 首帧、packaged process-cold startup 或 Mac。
两个 PLAN 结果高于随后批准的 query 门槛；保留这些修复前数据，不作 G7 通过判定。

长备份目标实验在最终断言失败：等待 best-effort backup pass 结束后仍为 pending，
`neededThrough=337`、`succeededThrough=0`、无已验证快照；40 次正式提交及查询仍成功，
没有把备份失败回滚为本地失败或报告备份成功。故上表最后两行不能计作成功后台备份的影响证据。
实际临时 SQLite 路径长 254 字符且文件为 0 字节；若附加 `-journal` 将为 262 字符。
此阶段路径长度限制仍是待验证解释，未观察到对应 journal 文件，尚未认定唯一根因。

随后通过正式接口把目标改为同一专属参考树内的短目录 `b/`，请求返回 `conflict` /
`dataEffect=unchanged`。当前 DATA 配置提交在 `backup_set_id` 已非空时拒绝再次配置
（`src/data/store/commits/backup-configuration.ts`），因此该次重新配置没有取得短目标备份恢复结果。
补测原始证据为 `_scratch/wp-ga-01-reference/kernel-short-backup.json`；未绕过守卫或直接修改 SQL。
长目标的阶段观察停在 `backup.after-staging-create`，原失败数据和空短目录保留，所有 DATA 连接已关闭。

另以同一种子配方创建独立 `wp-ga-01-short-reference`，首次配置短目标 `b/` 做对照，
未修改旧长目标工作区，也未重跑前述 200 次基线 PLAN 或 20 次重开。
新 WorkspaceId 为 `ae709a95-60d3-4b3a-a79c-a2de1e51d73a`，与旧实例不同，
数据规模及固定内核时钟相同。首次配置后真实读到 `current`、
`neededThrough=succeededThrough=257` 和一份 `integrity=verified` 快照。
这证明新实例在短目标完成首次备份，不是旧库重新配置或恢复成功。

| 短目标独立实例的后续实测 | 样本数 | p50（ms） | p95（ms） |
|---|---:|---:|---:|
| 正式任务状态提交 | 20 | 7.74 | 8.95 |
| 提交后默认 PLAN 请求 | 20 | 872.79 | 951.23 |

连续提交中成功水位曾推进到 259，随后停住；最后一条样本需求水位为 277，
最终等待后的 `current` 断言仍失败，实际为 pending。磁盘保留两份正常快照，
以及 `.quarantine-…/workspace.sqlite` 下的一份隔离文件；该隔离数据库完整路径长 262 字符。
首次短目标成功和随后不同阶段受阻显示路径/阶段相关现象，尚未证明唯一根因。
20 条请求都成功，仍不能把整组标为持续成功的后台备份影响证据。
原始输入、WorkspaceId、首次 current 投影、全部样本和最终失败保存在仓库外
`_scratch/wp-ga-01-short-reference/kernel-measurements.json`。上述对照运行时未更改产品代码；两个参考实例
及重新配置被拒绝的证据均保留，测量进程已经退出，所有 DATA 连接已关闭。

### 根因修复与原现场恢复

CPU profile 证实每个默认/月窗口查询分别创建约 12,304/16,532 个日期 formatter，
构造路径占约 70.6%/72.8% 的采样；这些包含子调用的比例不可相加。
先修复 Term 日期转换，后续采样再定位到 Meeting/weekly Task 共用的时区转换。
两个既有 shared 时间函数首先各保留最近一个显式时区的已验证 formatter，
不改变 DST offset 算法或 PLAN 数据范围；同时拒绝缺失 Meeting TermZone 导致的系统时区回退。
构造次数回归分别从 33/32 次降为 1 次，时区切换、alias、DST 和非法输入回归通过。

在原 revision 337 的参考库上，无 Proxy 的每窗口 10 次诊断复测为：

| 窗口 | p50（ms） | nearest-rank p95 / 最大值（ms） |
|---|---:|---:|
| 默认 PLAN | 79.33 | 96.96 |
| 9 月窗口 PLAN | 82.61 | 86.19 |

原始数据为 `_scratch/wp-ga-01-query-timing-term-and-meeting.json`；N=10 不代替正式分布。
参考投影仍含 940 个 Task occurrence、235 个 Meeting occurrence 和 5 门课程，PLAN facts 未改变。

独立长路径实验在 host Node 24.19.0 / SQLite 3.53.3 和锁定的
Electron 43.4.1 / Node 24.18.1 / SQLite 3.53.1 均复现：普通路径 backup 长 251 通过、
252 起失败，只读 open 长 259 通过、260 起失败；同一路径使用标准库 `toNamespacedPath`
后至 300 字符均通过，普通文件系统读写一直正常。
修复仅覆盖三个 DATA 文件内的九个 SQLite 路径参数，不改变持久路径、UUID 或备份格式。
Windows 长路径回归实际经过 DATA 创建、三份备份发布、quarantine 重验与重启，
修复前在 SQLite open 失败，修复后 durable-backup 测试 48/48 通过。

随后正常打开原两个失败实例并执行 bootstrap、等待备份、查询，未重建实例或直接修改 SQL：

| 原现场 | 正常恢复结果 |
|---|---|
| 长目标 queued | 沿原 operation/snapshot 继续，current，neededThrough=succeededThrough=337，1 份 verified 快照 |
| 短目标 quarantined | 原清理继续后追平，current，neededThrough=succeededThrough=277，2 份 verified 快照，cleanup idle、pending 0 |

原失败报告保留，恢复记录在 `_scratch/resume-after-fix.json`；WorkspaceId、原配置与开发身份保持。
该恢复使用当前有修复的编译工作树，不能称为旧 clean 包结果。所有测试库连接已关闭。

### 较大样本与第二轮性能修复

干净提交 `f8f5f51ce727d23e12c8aceb3325e9bf67daf55c` 上，版本化工具完成全部正式造数与
host kernel 测量：每窗口 100 次的默认/月窗口 p95 为 103.66/114.00 ms，仍超过 100 ms。
40 次配置备份后的提交全部追平且最终 current，查询 p95 为 87.89 ms。
原始结果保留在 `_scratch/wp-ga-01-reference-f8f5f51/kernel-measurements.json`；未删除慢样本。

正常模式的后续采样确认，时区解析约 72%–73%、Instant 日期转换约 98% 为相同输入的重复计算。
因此在既有两个时区记录上各增加最多 512 个成功结果；满后清空重算，输入校验先于查表，
失败不入表，不缓存 DATA、投影或可变事实。DST 计算本体未改。
新增回归证明重复输入不再重新格式化、超过容量后正确重算，并覆盖非法输入的缓存键碰撞。

同一参考库、正常模式、每窗口 10 次的诊断 p95/最大值降至默认 49.14 ms、月窗口 38.09 ms；
这组仍包含原驱动的 JSON 序列化开销，单独 handle 的最大值为 47.70/35.89 ms。
完整样本在 `_scratch/wp-ga-01-query-timing-f8f5f51-bounded-results.json`，仍按 N=10 诊断记录。
驱动另外移除了成功路径多余的 JSON 字符串化；其独立开销约 1–2 ms，不将它冒充产品优化。

第二轮的 18 项时间契约定向回归全部通过；`pnpm typecheck`、脚本语法及 `--self-check` 通过。
`COURSEFLOW_REQUIRE_BROWSER=1 pnpm test` 第一次为 752 = 750 pass / 1 fail / 1 skip，
70408.1542 ms；失败为既有 `packaged smoke reuses exited-root discovery prepared before a constrained cleanup window`
用例的 `taskkill timed out`（清理宽限 600 ms）。单独复跑该项 1/1 通过，2996.0776 ms。
第二次默认并行全套为 752 = 749 pass / 2 fail / 1 skip，58013.0708 ms：同一清理超时，
另有既有 topbar layout fixture 读取 `DevToolsActivePort` 的 EBUSY；后者未进入布局断言。
这些测试及其 runner/fixture 没有在本轮修改。失败仍保留，不能用定向通过替代完整通过。
原始日志为 `_scratch/wp-ga-01-typecheck-bounded.log`、`wp-ga-01-test-bounded.log`、
`wp-ga-01-test-bounded-cleanup-retry.log`、`wp-ga-01-test-bounded-retry.log`。

独立完整 smoke 测试文件随后 7/7 通过，17.054 s，且无该轮测试进程遗留。
在同一编译输出上设置 `COURSEFLOW_REQUIRE_BROWSER=1`，执行
`node --test --test-concurrency=1 ".test-dist/tests/**/*.test.js"`，相同 752 项为
751 pass / 0 fail / 1 skip，164754.8887 ms，原始日志为 `_scratch/wp-ga-01-test-bounded-serial.log`。
此结果证明明确串行条件下的完整回归通过，不改写两次默认并行运行的失败结果。
正式 Windows smoke runner 使用 5000 ms 清理宽限；测试特设的 600 ms 未放宽，产品代码未为此修改。

### 最终干净源码的完整 host 样本

在干净提交 `df9841e4b1e942cbb856da14e677d5c7737d07ad` 完成 `pnpm test:compile` 后，
运行版本化脚本的默认完整模式；其他测试与打包结束后才开始测量。
报告的 `sourceCommit` 与 AppBuildId 均指向该提交，`worktreeStatus` 为空。
仍使用已批准的 v1 输入、Windows host Node 24.19.0 / SQLite 3.53.3 和
[性能基线](./WP-GA-01-PERFORMANCE.md) 规定的 host kernel 计时边界。

| 实测端点 | 样本数 | p50（ms） | p95（ms） |
|---|---:|---:|---:|
| 同进程 Workspace reopen | 20 | 26.59 | 33.25 |
| 默认 PLAN | 100 | 36.75 | 45.28 |
| 9 月窗口 PLAN | 100 | 38.97 | 48.93 |
| 未配置备份的正式提交 | 40 | 2.72 | 3.94 |
| 已配置备份的正式提交 | 40 | 6.34 | 8.26 |
| 已配置备份后的默认 PLAN | 40 | 33.85 | 40.26 |

两个查询组的 p99 观测值为 48.68/52.48 ms；未增加 p99 通过门槛。
40 次配置备份后的提交逐轮验证真实快照追平，最终 `neededThrough=succeededThrough=337`，
两份最近快照 verified、cleanup idle；没有删去慢样本或覆盖此前的失败报告。
主机内核查询低于 100 ms 参考值，但本轮没有 packaged IPC、首帧、Mac 或实际 I/O 重叠测量，
不能据此关闭完整 G7。所有 DATA 连接已经关闭。

原始数组与完整结果为 `_scratch/wp-ga-01-reference-df9841e/kernel-measurements.json`，
同目录保存种子投影；编译和执行日志为 `wp-ga-01-measure-df9841e-compile.log`、
`wp-ga-01-measure-df9841e.log`。该源码随后独立完成 Windows package/smoke，身份见第 1 节；
最终证据归档提交只修改文档，不把文档提交身份写成实测制品身份。

### R7 前置收口的最终 Windows 打包结果

干净源码 `e2ea721f68530a42df5afdda8893156718c7d001` 的 `pnpm package` 与隔离 packaged smoke
均 exit 0，AppBuildId 精确匹配，SQLite 3.53.1、verified-local。20 轮均可见、有焦点、正常关闭；
使用批准的 v1 参考输入、真实 packaged 时钟与正式 preload/IPC 端点，revision 256 → 296。
启动包括发现调试端点、置前、PLAN 可操作与双 animation-frame 等待，不扣除开销。

| 正式端点 | N | p50 ms | p95 ms | 预算 ms | 结果 |
|---|---:|---:|---:|---:|---|
| process-cold 启动 | 20 | 656.30 | 693.55 | 3000 | PASS |
| 默认 PLAN | 100 | 78.40 | 95.00 | 100 | PASS |
| 9 月窗口 PLAN | 100 | 91.30 | 98.10 | 100 | PASS |
| Task 正式提交 | 40 | 3.50 | 4.90 | 200 | PASS |

原始数组在 `_scratch/ga-pkg-e2ea721/packaged-measurements.json`。查询 p99 为 95.80/101.80 ms，
月窗口最大 103.10 ms；p99 没有批准阈值。p95 已接近 100 ms，不隐去慢样本或重采挑选更好结果。
此前 `4da47df` 的查询 p95 163.30/205.20 ms 失败与 CPU profile 均保留；改动及回归见 Backlog。

同源码的独立运行时观察在 `_scratch/ga-observe-e2ea721-sync/packaged-observations.json`，exit 0。
每窗口 20 条正式请求仅作诊断；Main 启用 10 ms 原生 event-loop histogram，Renderer 保存全部 10 ms
timer 回调超期样本，app.getAppMetrics 保留自有进程 CPU/内存前后原值。Main histogram p95
31.72/38.17 ms 包含分辨率，不能与 Renderer 扣除间隔后的超期量直接比较。该组含 inspector/观察开销，
首组资源还可能包含 GUI 启动工作，不并入上表，也不作每请求 CPU 或同时进程树峰值归因。
首次观察脚本的同步 Main awaitPromise 错误保留在 `_scratch/ga-observe-e2ea721`，没有冒充产品失败。

同源码 host ADR 实验完成 5239 次 owner 观测、2773 个 hook，意外失败 0；20 次恢复均成功、
unconfigured/healthy 且无旧队列调度，21 次显式授权形成不同的新 BackupSet 并追平 current，rollback 保留原配置。
21 次 WAL checkpoint 后均为 0 bytes；host p95：backup copy 40.01 ms、integrity 1.13 ms、FK 0.29 ms、
WAL checkpoint 3.91 ms、restore resume/reopen 743.02 ms。原始/派生结果为
`_scratch/r7-prereq-adr-measure/raw-win32-e2ea721.json`、`derived-win32-e2ea721.json`。
这是 host 内部阶段证据；不得改写成 packaged utility、迁移、真实掉电、精确资源峰值或另一平台结果。

Windows 四个已测端点通过不等于完整 G7：后台预算、utility 与恢复补测见下节，
Mac 同源结果及剩余适用 ADR 内部阶段仍须另有证据。
用户会在 Mac 运行[交接命令](./WP-GA-01-HANDOFF.md)，本次没有代填 Mac 数据。

### 真实后台重叠及调度修复（2026-09-05）

同一 e2ea721 包的两个独立参考副本，分别未配置与正式配置备份；两边启用相同 inspector/无暂停条件观察。
对照查询各暖身 10 次后保留 100 次，提交 40 次；后台两个查询组和提交组各 20/20 次，
每次均有完整同步备份工作段落在 Renderer 正式请求计时区间内，CPU 计数增加，最终 current/水位 377。
未删样本，0 Debugger.paused；driver 因预算失败 exit 1，两个实际应用均正常 exit 0。

| 端点 | 对照 p95 ms | 备份 p95 ms | 增量 ms | 结果 |
|---|---:|---:|---:|---|
| 默认 PLAN | 70.00 | 290.90 | 220.90 | FAIL |
| 月窗口 PLAN | 81.60 | 336.50 | 254.90 | FAIL |
| Task 正式提交 | 3.80 | 264.00 | 260.20 | FAIL |

原始结果 `_scratch/ga-backup-control-e2/utility-probe.json`、`ga-backup-overlap-e2/utility-probe.json`；
阶段归因 `ga-backup-overlap-e2/stage-contributions.json`。第 3 份快照起，成功登记后连续同步 retention
占约 180–210 ms；只保留清理首尾 CPU 点的固定 3 轮诊断仍测到 168.13/162.76 ms 清理和
278.10/269.40 ms 查询，第 1 轮无清理为 78.10 ms，记录在 `_scratch/ga-backup-reduced-e2`。

修复在持久阶段之间让出事件循环，保留全部 fresh validation 与紧邻物理修改的同步性；
恢复执行先检查 DATA 可写，禁止普通提交变成 read-only 后继续删除剩余成员。
两个回归、138 项保护定向和官方全套 758 项已通过，打包预算复测另记；不以单元 GREEN 代替原预算。
新增 yield 后，跨阶段的长区间不再称为同步 CPU 段；复测观察器须定位不含 await 的实际同步调用边界。

### 调度修复后的前台与后台实测

clean `23313c28003cfdf80a96ba239a8c6669d391fbd4` 的 package 成功。首次普通测量的默认/月查询
p95 129.8/131.6 ms 失败，保留 `_scratch/ga-pkg-23313c2`。此轮没有逐请求焦点与同期负载，
不能推断唯一原因。随后固定诊断保留 200 次查询及状态/负载，实际发生失焦；诊断不充当正式通过记录。

用户提供前台测量窗口后，同包使用相同输入和端点重新完整测量；每组前通过 Main 置前，动作在请求计时外。
全部 200 次查询前后均 visible/focused，整个请求阶段无焦点/可见性变化；20 次应用均正常关闭。
启动/默认查询/月查询/提交 p95 分别为 669.725/76.4/77.3/4.0 ms，原始样本 N=20/100/100/40，
不删除任何慢样本。同期 Silent 电源计划不变，整机忙碌率约 18.3%–28.5%。
原始及低频负载为 `_scratch/ga-pkg-23313c2-foreground`；旧 Razer Cortex 设备档案仍保留其日期。

其后同观测 v2 对照与真实后台组都完成，全部请求前后可见且有焦点、0 Debugger.paused，
两个应用均正常关闭，真实后台最终 current/水位 393。此组未测同期系统负载，不以环境解释失败。

| 端点 | 对照 p95 ms | 严格同步重叠 p95 ms | 增量 ms | 重叠样本/总尝试 |
|---|---:|---:|---:|---:|
| 默认 PLAN | 80.5 | 100.6 | 20.1 | 20/22 |
| 月窗口 PLAN | 105.2 | 98.6 | -6.6 | 20/20 |
| Task 正式提交 | 5.1 | 17.7 | 12.6 | 20/27 |

9 次非完整包含尝试全部保留；同步片段不跨越新增 await。后台绝对/增量预算满足，但月份对照
超过原 100 ms 门槛，因此两份 driver 仍如实 exit 1，不能关闭完整后台预算。
原始为 `_scratch/ga-backup-control-23313c2-v2`、`ga-backup-overlap-23313c2-v2`。
独立 CPU profile 定位到每次 Task 读取重复准备四条相同 SQL；现已在单次 PLAN 读取内复用语句，
查询结果、参数绑定、事务及校验仍每次执行。回归的四次读取准备次数从 8/8/4/8 降为 4/4/4/4，
全部行为断言保留；相关 190 项、typecheck 和官方完整 759 项通过。新包仍须按原预算完整采样。

### 真实旧版迁移与打包恢复的补充观测

旧 clean `bd60a1662fd86bd15470bcfc1e15e45c8f17eb78` 的正式 owner 独立编译并造同一参考输入，
schema 16/revision 256；20 个关闭副本由实际 e2ea721 包完成 16→17/revision 257。
正式 setup 与全部 SQL 表行只允许 ADR-04 规定的 revision/backupNeededThrough 增长，业务事实完整；
20 个唯一 SafetyCopy 均 verified/source16，原旧参考字节不变，全部 exit 0。
含迁移与观察开销的启动 p50/p95 为 644.26/663.91 ms，不并入普通启动预算；DataSlots 目标 10 ms
采样最大为 1,608,660–1,809,364 bytes，关闭后每轮 1,414,004 bytes，另存逐进程资源原值。
原始、派生和首次 revision 驱动误假设保留在 `_scratch/r7-prereq-migration-20260905`。

e2ea721 正常恢复 20/20，分别采到 99 个实际 utility 阶段点；preview/SafetySet confirm/resume
p95 为 87.90/116.10/363.00 ms，最终 healthy/unconfigured 且正常关闭。
journal fsync/publish 各 N=200，p95 为 11.263/0.824 ms；逐窗口 loop histogram 与 CPU/RSS 原值保留，
不伪造合并 p95。独立 after-retire-action 受控终止精确进程树后，同根正式重启回滚通过，283.90 ms，
结果 configured/current；此中断实验不混入正常恢复分布，也不称为真实掉电。
原始结果与尚缺内部拆分见 `_scratch/ga-restore-e2-final/README.md`；失败准备轮同样保留。
以上仍是 e2ea721 的真实身份，不能代替新调度修复后制品，也未代填 Mac 数据。

### 最终同源 Windows 结果（0e55715）

实测源码为 clean `0e55715dd4afd1e2efbd38d9af24d95c525b3dd9`，实际 AppBuildId 精确一致。
typecheck、必需浏览器全套 759 项（758 pass / 0 fail / 1 权限 skip）、package 和隔离 smoke 均通过。
普通/control/backup 按固定顺序各完成一次，没有删除或重采慢样本；正常 20 次应用均 exit 0。

| 正式端点 | 普通 p95 ms | 匹配对照 p95 ms | 真实后台 p95 ms | 后台增量 ms | 结果 |
|---|---:|---:|---:|---:|---|
| process-cold 启动，N=20 | 631.421 | 不适用 | 不适用 | 不适用 | PASS |
| 默认 PLAN，普通/对照各 N=100 | 58.4 | 56.7 | 83.3 | 26.6 | PASS |
| 月窗口 PLAN，普通/对照各 N=100 | 68.5 | 72.1 | 88.9 | 16.8 | PASS |
| 正式提交，普通/对照各 N=40 | 3.9 | 5.6 | 18.1 | 12.5 | PASS |

后台三组各有 20 个完整同步片段包含且 CPU 增长的样本，总尝试 23/20/29；12 个非严格重叠尝试
全部保留，不计成重叠证据。两臂观察配置一致、focusComplete=true、0 Debugger.paused。
最终观察为 current、neededThrough=succeededThrough=398，但当时 cleanup=pending，不宣称 cleanup idle。
普通查询 p99 为 59.7/70.6 ms，对照为 58.1/73.4 ms；p99 没有批准阈值。
原始路径为 `_scratch/ga-pkg-0e55715`、`ga-backup-control-0e55715-v2`、`ga-backup-overlap-0e55715-v2`；
同期 Silent 电源计划和逐秒 CPU/进程负载保存在 `ga-load-0e55715`，未修改计划或结束用户程序。

同源 Main/Renderer 资源诊断各 20 次通过，记录 `ga-observe-0e55715-foreground`；10 ms resolution 的
Main histogram p95 为 39.09/51.12 ms，保留 Renderer timer 与自有进程资源原值，不合并到正式预算。
首轮 observer 已收默认 20 次后变 hidden 而失败，原始 `ga-observe-0e55715` 及执行脚本保留；
仅外部驱动补每组前 Main 置前及双帧准备后固定补测成功，不改产品或旧结果。

同源正常恢复 20/20，通过 14 个内部 span、940 对记录，193 events/轮；preview/confirm/resume
p95 为 205.8/270.5/728.3 ms，最大 resume 1203.4 ms 原样保留，无新批准阈值。
WAL checkpoint/close-to-reopen p95 为 5.08/432.76 ms，journal fsync/publish 各 N=200、p95 16.19/2.14 ms。
utility OS RSS 高水位 105236 KiB，阶段采样最大 107761664 bytes；不把分窗口 histogram 合并伪造 p95。
独立精确进程树中断后正式重启回滚通过，596.2 ms，恢复 configured/current；不混入正常分布或称为断电。
原始、统计与实测脚本归档在 `ga-restore-0e55715-v2`。

额外单轮恢复资源观察在 `ga-restore-resources-0e55715`，正常恢复与退出通过；仅采本次隔离
DataSlots/ActivityControl/backup，175 个原始样本，75 个完整落在正式 start→resume 窗口。
该窗口采样最大逻辑大小 3,441,358 bytes、WAL 45,352 bytes。10 ms 为目标频率，
全生命周期最大实际间隔 434.77 ms；这是采样下界，非精确瞬时磁盘峰值，不并入正常 20 轮。

真实旧 bd60a16 schema16/revision256 的 20 个副本由当前包完成 17/257 迁移；20 个 SafetyCopy
verified、全部业务表行保持，仅允许正式 revision/backupNeededThrough 各增一次，旧 fixture 不变。
含迁移启动 p95 为 1267.805 ms，不混入普通启动；每轮结束 DataSlots 为 1,414,004 bytes，
10 ms 目标采样最大 1,608,660–1,809,364 bytes。原始及方法为 `ga-migration-0e55715`。

同源 host ADR 在 `ga-adr-host-0e55715` 完成 5239 observations、2773 hooks、0 failed owner，
20 次备份/恢复/重新授权及独立 owner-exception rollback 语义通过。该 host 结果不冒充 packaged
进程、真实 kill 或整树资源；packaged、采样资源与 host 的端点/边界分别保留。
以上均未代填 Mac 数据。最终交接见 [平台验证](./WP-GA-01-HANDOFF.md)。

## 6. 生命周期与下一步

`WP-RF-01` 的 Windows typecheck/test/package/smoke 已齐，因此关闭为 Done。
UI 实现已完成而当前制品验证仍在进行，`WP-UI-01` 与 `WP-GA-01` 登记 Verification；
`WP-RF-02` 保持 Verification。当前尚不能领取以 G-A Done 为硬依赖的 R7。

G1 的验收口径已获用户确认；本轮已完成 Windows 自动化、已批准打包预算及适用运行时补测。
剩余为 G6 当前 Windows 真人矩阵/实际禁网旅程，以及用户已同意运行的最终同源 Mac 自动化与性能实测。
Mac 已完成的 UI 验收继续保留，新增内核代码只补相关自动化和性能证据。
只有这些项目逐一满足后，才同步关闭 UI/RF/GA；不再重做已实现的两个窗口布局切片。
