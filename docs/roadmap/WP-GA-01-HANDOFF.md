# WP-GA-01：剩余平台验证

状态与已完成证据以 [Backlog](./BACKLOG.md) 和 [验收记录](./WP-GA-01-ACCEPTANCE.md) 为准。
G1 已由用户确认按已交付 A-only 模型验收；新模型另行登记。R7 必须等 `WP-GA-01` 为 Done。

本次验收源码锁定 `0e55715dd4afd1e2efbd38d9af24d95c525b3dd9`；文档归档与合并不改变实际 AppBuildId。
Windows 同源自动化、普通/匹配对照/严格后台预算、迁移/恢复/独立回滚、运行时及恢复资源观察已归档。
macOS 同源 typecheck/test/package/smoke 与普通 packaged 前台端点也已通过；真人验收沿用用户确认。
剩余为 G6 实际禁网、完整失败 artifact 与真人验收制品关联，以及 G7 macOS 后台预算和适用 ADR 观测。
两平台历史失败、失焦及非严格重叠样本保留原身份，不被新通过结果覆盖。

## 1. macOS 剩余性能与运行时补证

macOS 0e55715 的普通端点已完成：首轮失焦记录保留；完整前台复测的启动/默认查询/月查询/提交
p95 为 493.661/43.5/54.2/1.2 ms，N=20/100/100/40，240 个正式请求前后均 visible/focused。
这部分与既有 Mac UI 矩阵无需重做；完整 G7 仍需匹配无备份对照、严格后台重叠与 ADR 专项结果。

合并时已在 Windows 工作区定位最终同源交接目录 `_scratch/r7-prereq-handoff-0e55715`，
压缩包为 `_scratch/r7-prereq-handoff-0e55715.zip`。它包含完整 Git bundle、后台 v2、Main/Renderer、
host ADR、真实旧 schema 迁移与恢复/资源观察器；Mac 上轮未取得这些文件，不等于工具不存在。
旧 e2/233 交接和失败数据保留；补证应使用最终 0e55715 交接包，不能沿用旧包结论。

包内 `README.md` 给出各阶段 CLI、输出与观测边界；完整复现入口为：

```sh
bash verify-macos.sh
```

需要已有 Git、`package.json` 所要求版本的 Node/pnpm、Chrome/Chromium。
完整入口从 bundle 创建 `/private/tmp/courseflow-ga-0e55715.*` 独立 checkout，先验证实际 appData 隔离，
再顺序执行安装、typecheck、必需浏览器全套、package、普通 G7、Main/Renderer 资源、host ADR、
真实旧 schema 迁移 20 轮、匹配对照/严格后台、恢复 20 轮与独立中断回滚，以及一轮恢复磁盘/WAL 观察。
它会复跑基础阶段；这些基础结果已存在，剩余验收范围仍以下台账列出的缺项为准。
测量期间保持测试窗口在前台，结束其它编译、打包或高负载操作，不混合普通与诊断端点。

源坐标、AppBuildId、WorkspaceId、预算或命令失败均保留原始结果并停止后续步骤，不挑选样本。
本包的 Mac 路径已静态检查，尚无其剩余专项阶段的实际 Mac 执行结果，不能预填通过。
结束时打印输出根、`last-stage.txt` / `exit-code.txt` 和 `*-results.tar.gz` 路径；
回传结果压缩包及实际观察说明。日志与失败数据全部保留，原 source/依赖/包仍留在 Mac 输出根。

## 2. Windows 人工与禁网验收

`TEST-PLATFORM-004` 要求实际禁网下完成全部 MVP-A 核心旅程及整库恢复／启动 recovery。
当前已取得的正式 packaged 失败／恢复证据没有阻断网络，不能替代这项测试。
历史 Windows 工具进程没有创建出站防火墙规则的管理员权限；Mac 归档任务也未提供 Windows 执行环境。实际禁网结果尚未补齐。

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

macOS 归档任务的本机证据根为 Codex 产物目录
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
| `handoff/CourseFlow-0e55715-win32-x64.zip` | Mac 交叉打包的完整 Windows x64 development 目录，该 ZIP 未实机验证；Windows 原生同源结果另见验收台账 |
| `handoff/evidence-0e55715.zip` | 本次原始 JSON/log/txt，包括失败轮；保留完整参考 DATA 的本机目录也未删除 |
| `handoff/verify-windows.ps1`、`handoff/README.md` | 新独立 Windows checkout 的固定命令及结果清单；尚未在 Windows 执行或经 PowerShell 解析，不宣称脚本验证通过 |

该 Mac 交接包中的 Windows 命令仅供锁定源码的 Windows 独立复验：复制 `handoff/` 到 Windows 短路径后执行 `./verify-windows.ps1`。
合并后的台账已包含 Windows 原生同源自动化与普通/后台预算，不再把运行此脚本列为 R7 缺项。
脚本要求 Git、Node 24.19.0、pnpm.cmd 11.19.0 与测试所需浏览器，创建新的 TEMP checkout，
锁定完整源码，顺序运行 frozen install、typecheck、必需浏览器的默认并行 test、package、隔离 smoke、
一次完整 ordinary packaged driver；任一步非零即保留结果并停止。它不更改测试并行模式、系统权限或防火墙。
测量前显式留出前台窗口、结束测试/打包负载；同时按 PERFORMANCE §5 保存实际设备和系统状态。
真人操作前仍须验证专属数据根；不要通过默认根写入验收事实。

Mac 上轮缺少的观察器现已在 Windows 最终交接目录定位（见第 1 节）：

- `measure-packaged-backup-overlap-v2.mjs` 与相关 v2 模块：匹配对照、严格同步重叠及所有非完整尝试。
- `observe-ga-packaged.mjs`、`measure-adr-host.mjs`：Main/Renderer/utility event-loop、资源及 host ADR。
- `migration-addon/`、`measure-packaged-restore-adr-v2.mjs`、`measure-packaged-restore-resources.mjs`：真实旧版迁移、正常恢复/独立中断回滚、内部阶段与资源。

复制完整最终交接包后，先按 README 确认 CLI、实际源坐标与 Mac 适用性，再补缺少的 macOS 结果。
Windows 已有同源结果保持其正式端点、诊断、host 和采样范围，不因合并重复列为未测。
完整 G7 仍按 PERFORMANCE §1/§3：对应无备份对照自身达标，两个查询组与提交各至少 20 个真实严格重叠样本，
同时满足绝对与增量预算，最终 current；同步工作段不能跨 await，所有尝试保留。
macOS 尚需 ADR-02/03/04 的 cold open、event-loop、WAL/checkpoint、migration、integrity/FK、大小与内存，
ADR-07 的 backup/hash/validation/publish/cleanup、CPU/I/O/RSS/磁盘，
ADR-08 的 validation/copy/maintenance/journal/reopen/reconcile/resume/rollback/recovery 与资源分项仍待逐项实测。
不新增阈值，不把诊断开销样本混入正式预算，不向生产引入日志或遥测。

回传完整新输出目录、命令退出码、source/实际 AppBuildId/runtime/WorkspaceId/revision/水位、
原始数组与设备同期状态、后台所有尝试及 ADR 原始结果；另补用户已确认真人验收的制品身份和逐项记录，
以及实际禁网覆盖 Main/utility 的证据、失败旅程自有 artifact 清单。
Mac 归档时用户要求先提交本机证据；本次合并只同步双方已有结果。三个收口包保持 Verification，R7-01/02/03 保持 —。
