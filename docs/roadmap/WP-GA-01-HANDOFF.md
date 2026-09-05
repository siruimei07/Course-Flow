# WP-GA-01：剩余平台验证

状态与已完成证据以 [Backlog](./BACKLOG.md) 和 [验收记录](./WP-GA-01-ACCEPTANCE.md) 为准。
G1 已由用户确认按已交付 A-only 模型验收；新模型另行登记。R7 必须等 `WP-GA-01` 为 Done。

既有基线源码为 `e2ea721f68530a42df5afdda8893156718c7d001`；后续证据归档提交不改变实测制品身份。
工作区 `_scratch/r7-prereq-handoff/` 提供 Git bundle 与 `verify-macos.sh`，无需推送远程：
把该目录复制到 Mac 后执行 `bash verify-macos.sh`。它在 `/private/tmp` 创建独立 checkout，
锁定上述源码，保留安装/类型检查/测试/打包/正式样本、独立运行时观察及 host ADR 的输出。
任一步失败即停止；成功也不关闭仍缺真实备份重叠和内部运行时证据的完整 G7。

2026-09-05 后台完整采样发现预算失败，调度修复已通过自动化；当前正补修复后的打包证据。
上述 e2ea721 基础包继续作为真实旧基线，最终同源验收须使用修复后更新的交接包，不能沿用旧包结论。

## 1. macOS 打包性能验证

用户已确认会在 Mac 上执行。使用与 Windows 验证相同的源码提交，在仓库根目录执行；
工作树必须干净，Node/pnpm 版本以 `package.json` 为准。

```sh
(
set -e
git status --short
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
当前工具进程没有创建 Windows 出站防火墙规则的管理员权限，且没有可用的原生物理输入工具。

人工矩阵使用已确认的两档窗口 `1280×800`／`960×640`，覆盖 Today、课程、日历、任务、文件，
以及首次设置、设置、管理三个对话框；验证实际鼠标拖拽／Snap、键盘与焦点、状态公告，
并观察默认、高对比度和透明效果关闭三种系统状态。只使用专属测试数据根。
记录实际 source/appBuildId、窗口与系统状态、每项通过／失败及观察者；不能套用旧制品身份。

禁网必须覆盖 Main 与 Workspace utility 的网络能力；Chromium 的 offline 模拟、代理失败、
CSP 或源码无远程依赖都不等同于整个应用实际禁网。完成后把证据写回验收记录，
并保留与界面人工矩阵不同的证据范围。
