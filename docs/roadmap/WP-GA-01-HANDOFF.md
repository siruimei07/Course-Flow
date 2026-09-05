# WP-GA-01：剩余平台验证

状态与已完成证据以 [Backlog](./BACKLOG.md) 和 [验收记录](./WP-GA-01-ACCEPTANCE.md) 为准。
G1 已由用户确认按已交付 A-only 模型验收；新模型另行登记。R7 必须等 `WP-GA-01` 为 Done。

本次验收源码锁定 `0e55715dd4afd1e2efbd38d9af24d95c525b3dd9`，两平台 development 制品均来自
同一 clean source；后续证据文档提交不改变实测 AppBuildId。macOS 本机 typecheck/test/package/smoke
与普通 packaged 前台端点已补齐；Windows x64 仅在 Mac 交叉打包，未在 Windows 运行。

历史交接锁定 `e2ea721f68530a42df5afdda8893156718c7d001`，当时的
`_scratch/r7-prereq-handoff/verify-macos.sh` 和 Git bundle 未在当前 Mac 检出。
旧结果与后续 23313c2 月份对照超预算记录继续保留；不能把旧包作为当前源码最终验收。
本次实际交接制品、可执行命令及应取回工具见第 3 节。

## 1. macOS 打包性能验证

本次 0e55715 已在 Mac 完成：首轮失焦记录保留；用户提供前台条件后的完整复测
启动/默认查询/月查询/提交 p95 为 493.661/43.5/54.2/1.2 ms，N=20/100/100/40，
240 个正式请求前后均 visible/focused、0 焦点事件。完整 G7 仍未通过。
以下命令供同一锁定源码的独立复验使用，不要求重复已完成的本机普通端点；
在仓库根执行，工作树必须干净，Node/pnpm 版本以 `package.json` 为准。

```sh
(
set -e
test "$(git rev-parse HEAD)" = "0e55715dd4afd1e2efbd38d9af24d95c525b3dd9"
test -z "$(git status --porcelain)"
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm typecheck
COURSEFLOW_REQUIRE_BROWSER=1 pnpm test
pnpm package
gaParent="$(mktemp -d /private/tmp/courseflow-ga.XXXXXX)"
node scripts/measure-ga-packaged.mjs --output "$gaParent/result"
)
```

任一命令失败就保留输出并停止后续步骤。每次使用新的输出目录；已有参考数据和失败样本不覆盖。
driver 先验证 macOS 的 `CFFIXED_USER_HOME` 是否使 Electron 的 appData 指向本次隔离目录，
验证不成立则拒绝继续。测量期间保留默认窗口可见，结束其他测试、打包和高负载程序。
普通 driver 在各请求组前置前窗口，逐请求保存可见性/焦点；失焦样本保留且该轮不充当前台通过证据。
脚本只通过正式 Workspace 接口使用专属参考数据，不操作已有用户资料。

需要取回本轮 `packaged-measurements.json`、`kernel-measurements.json` 和 `reference-setup.json`，
以及 typecheck、默认并行 test、package 的退出码与输出。报告会保留每轮原始时间、
实际平台/runtime、源码与 appBuildId、参考 WorkspaceId，以及未测项目。

这里的自动化提供 process-cold 启动和正式 IPC 查询／提交证据；
既有 Mac UI 人工验收继续有效，不要求重做整个 UI 矩阵。
真实后台备份重叠及适用 ADR 附加测量仍须按[性能基线](./WP-GA-01-PERFORMANCE.md)逐项补齐，
不能仅因上述命令 exit 0 就把完整 G7 关闭。

## 2. Windows 人工与禁网验收

`TEST-PLATFORM-004` 要求实际禁网下完成全部 MVP-A 核心旅程及整库恢复／启动 recovery。
当前已取得的正式 packaged 失败／恢复证据没有阻断网络，不能替代这项测试。
历史 Windows 工具进程没有创建出站防火墙规则的管理员权限，也未取得有效物理输入；本次为 macOS 本机，未提供可执行 Windows 环境。

2026-09-05 用户在本轮指示“现在不可用，先提交本机证据，真人验收记为完成”。
真人验收据此登记为用户确认完成，来源是用户声明；本轮未回传对应 Windows source/AppBuildId、
逐项结果与系统状态，仍待补录制品关联，不把它改写为代理执行的 0e55715 实测。
该确认没有包含实际禁网、性能或 ADR 观测，不据此关闭这些分项。

用户确认所对应的人工矩阵使用已确认的两档窗口 `1280×800`／`960×640`，覆盖 Today、课程、日历、任务、文件，
以及首次设置、设置、管理三个对话框；验证实际鼠标拖拽／Snap、键盘与焦点、状态公告，
并观察默认、高对比度和透明效果关闭三种系统状态。只使用专属测试数据根。
记录实际 source/appBuildId、窗口与系统状态、每项通过／失败及观察者；不能套用旧制品身份。

禁网必须覆盖 Main 与 Workspace utility 的网络能力；Chromium 的 offline 模拟、代理失败、
CSP 或源码无远程依赖都不等同于整个应用实际禁网。完成后把证据写回验收记录，
并保留与界面人工矩阵不同的证据范围。

## 3. 本次便携交接与仍缺资源

本机证据根为 Codex 产物目录
`~/.codex/visualizations/2026/09/05/01a07097-a4b1-74c1-b3ba-80e00ca9b6b0/r7-prereq-0e55715/`。
相对路径在搬移后保持：

| 路径 | 内容与状态 |
|---|---|
| `typecheck.log`、`test.log`、`package.log`、`smoke.log` | 当前 Mac 实际命令输出；test 为 759 = 752 pass / 0 fail / 7 Windows 专属 skip |
| `packaged/` | 首轮完整原始样本与失败状态，两个查询组分别 59/76 个失焦样本，保留 exit 1 |
| `packaged-foreground/` | 用户提供前台条件后的完整 PASS 数组；含 packaged/kernel/reference JSON、种子 stdout/stderr 与 20 轮 stderr |
| `host/` | 同源码 host 完整部分证据，40 次真实备份最终 current 337；不证明严格后台重叠 |
| `device-*`、`*-load.txt`、`result-summary.json` | 本机设备、独立同期低频负载和可由原始数组复算的摘要 |
| `package-windows.log`、`packaged-artifact-inventory.json` | 同源 Windows x64 交叉打包与两平台静态 archive identity；没有 Windows 实际握手 |
| `handoff/source-0e55715.bundle`、`handoff/bundle-verify.log` | 当前锁定源码的完整 Git 历史，bundle verify 通过；无需 push |
| `handoff/CourseFlow-0e55715-darwin-arm64.zip` | 已在 Mac 通过实际 package/smoke/普通端点的 development app |
| `handoff/CourseFlow-0e55715-win32-x64.zip` | 完整 Windows x64 development 目录，实际 Windows runtime 与 smoke 待验 |
| `handoff/evidence-0e55715.zip` | 本次原始 JSON/log/txt，包括失败轮；保留完整参考 DATA 的本机目录也未删除 |
| `handoff/verify-windows.ps1`、`handoff/README.md` | 新独立 Windows checkout 的固定命令及结果清单；尚未在 Windows 执行或经 PowerShell 解析，不宣称脚本验证通过 |

将 `handoff/` 复制到 Windows 的短路径，在 PowerShell 中执行 `./verify-windows.ps1`。
脚本要求 Git、Node 24.19.0、pnpm.cmd 11.19.0 与测试所需浏览器，创建新的 TEMP checkout，
锁定完整源码，顺序运行 frozen install、typecheck、必需浏览器的默认并行 test、package、隔离 smoke、
一次完整 ordinary packaged driver；任一步非零即保留结果并停止。它不更改测试并行模式、系统权限或防火墙。
测量前显式留出前台窗口、结束测试/打包负载；同时按 PERFORMANCE §5 保存实际设备和系统状态。
真人操作前仍须验证专属数据根；不要通过默认根写入验收事实。

本机未取得可直接复用的旧观察器，需取回实际脚本/CLI 与 README：

- `_scratch/ga-backup-control-23313c2-v2`、`ga-backup-overlap-23313c2-v2`：同观测对照、严格同步重叠、全部非完整尝试。
- `_scratch/ga-observe-e2ea721-sync`、`r7-prereq-adr-measure`：Main/Renderer/utility event-loop、资源与 host ADR 观察。
- `_scratch/r7-prereq-migration-20260905`、`ga-restore-e2-final` 及恢复 v2 工具：实际旧版迁移、正常恢复/中断 recovery 和内部阶段拆分。

取回后先确认工具存在、CLI 与 Mac 适用性，再在同一验收源码补两平台证据。
完整 G7 仍按 PERFORMANCE §1/§3：对应无备份对照自身达标，两个查询组与提交各至少 20 个真实严格重叠样本，
同时满足绝对与增量预算，最终 current；同步工作段不能跨 await，所有尝试保留。
ADR-02/03/04 的 cold open、event-loop、WAL/checkpoint、migration、integrity/FK、大小与内存，
ADR-07 的 backup/hash/validation/publish/cleanup、CPU/I/O/RSS/磁盘，
ADR-08 的 validation/copy/maintenance/journal/reopen/reconcile/resume/rollback/recovery 与资源分项仍待逐项实测。
不新增阈值，不把诊断开销样本混入正式预算，不向生产引入日志或遥测。

回传完整新输出目录、命令退出码、source/实际 AppBuildId/runtime/WorkspaceId/revision/水位、
原始数组与设备同期状态、后台所有尝试及 ADR 原始结果；另补用户已确认真人验收的制品身份和逐项记录，
以及实际禁网覆盖 Main/utility 的证据、失败旅程自有 artifact 清单。
用户已说明资源当前不可用并要求先提交本机证据；三个收口包保持 Verification，R7-01/02/03 保持 —。
