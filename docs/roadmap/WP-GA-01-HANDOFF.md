# WP-GA-01：剩余平台验证

状态与已完成证据以 [Backlog](./BACKLOG.md) 和 [验收记录](./WP-GA-01-ACCEPTANCE.md) 为准。
G1 已由用户确认按已交付 A-only 模型验收；新模型另行登记。R7 必须等 `WP-GA-01` 为 Done。

最终实测代码为 `0e55715dd4afd1e2efbd38d9af24d95c525b3dd9`；后续文档归档不改变制品身份。
Windows 同源自动化、普通与真实后台预算、迁移/恢复/独立回滚、运行时与恢复资源观察已完成。
剩余为用户执行的同源 Mac 证据，以及当前 Windows 真人矩阵和实际禁网旅程。

## 1. macOS 一次命令验证

用户已确认会在 Mac 执行。交接目录为工作区 `_scratch/r7-prereq-handoff-0e55715`，
压缩包为 `_scratch/r7-prereq-handoff-0e55715.zip`。旧 e2/233 交接及失败数据保留，不覆盖或改标签。
把新包复制到真实 Mac 并解压，在该目录运行：

```sh
bash verify-macos.sh
```

需要已有 Git、`package.json` 所要求版本的 Node/pnpm、Chrome/Chromium。
脚本由 Git bundle 创建 `/private/tmp/courseflow-ga-0e55715.*` 独立 checkout，并锁定上述源码；
不切换已有 checkout。先验证 `CFFIXED_USER_HOME` 的实际 appData 隔离，再使用专属参考数据。
测量期间保持测试窗口在前台，结束其它编译、打包或高负载操作。

固定顺序为安装、typecheck、必需浏览器全套、package、普通 G7、Main/Renderer 资源、host ADR、
真实旧 schema 迁移 20 轮、匹配对照/真实后台、恢复 20 轮与独立中断回滚，以及一轮恢复磁盘/WAL 观察。
源坐标、AppBuildId、WorkspaceId、预算或命令失败都会保留原始结果并停止后续步骤，不挑选样本。
Mac 路径已静态检查，但尚无真实 Mac 执行结果，不能预填通过。

结束时打印输出根、`last-stage.txt` / `exit-code.txt` 和 `*-results.tar.gz` 路径。
回传这个结果压缩包及实际观察说明；其中保存全部阶段日志和测试/失败数据，只排除可重建的 source。
原 source、依赖与包仍留在 Mac 输出根；压缩失败时保留整个输出根再回传。
既有 Mac UI 验收继续有效，不要求重做整套 UI 矩阵。
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
