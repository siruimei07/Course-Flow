# ADR-02：Electron 进程、线程部署与故障边界

- 状态：已接受
- 日期：2026-08-19
- 决策主题：`ADR-TOPIC-02`
- 前置决策：[ADR-01](./ADR-01-desktop-runtime-ui-boundary.md)
- 审计证据：[ADR-02 方案 2 审计](../../research/adr-02-process-deployment-audit.md)

## 1. 背景

ADR-01 已选择 Electron + React + TypeScript，并规定 Shell 只能通过 `IF-WORKSPACE` 使用本地应用能力。当前还需决定九个逻辑 Module 如何部署到 Electron Renderer、Main、utility process 与线程，同时满足：

- Main/Renderer 不被 SQLite、扫描、备份、恢复或外围计算阻塞；
- 逻辑依赖不会因为物理同进程而消失；
- 活动数据只有一个明确所有者；
- 外围 Module 失败不击穿 PLAN；
- 进程或响应丢失后不伪造成功/失败，可按持久状态恢复；
- macOS 与 Windows 使用同一领域和 Workspace implementation。

## 2. 决议

采用一个 sandboxed Renderer、一个 Electron Main、一个受 Main 监督的 Workspace utility process，以及按证据启用的 worker thread。每个应用实例只运行一个活动 Workspace utility process；不按逻辑 Module 拆进程。

```text
React Renderer / MOD-SHELL
        │  preload: window.courseFlow（五种能力）
        ▼
Electron Main
App Host + Workspace Gateway + Electron Platform Adapter
        │  versioned async MessagePort protocol
        ▼
Workspace Utility Process
MOD-WORKSPACE + PLAN + ATTEND + LIBRARY + GRADE
MOD-PROTECT + MOD-DATA + Node-safe Platform Adapters
        │
        └─ 按需 worker thread
           CPU 密集或需额外崩溃隔离的派生任务
```

### 2.1 Renderer

Renderer 只部署 `MOD-SHELL`：页面、编辑模型、键盘、焦点、可访问状态和视觉反馈。预加载脚本暴露的 `window.courseFlow` 是唯一应用 seam，并只包含 `query / execute / preview / observe / accessResource`。

Renderer 不直接连接 Workspace utility process，不获得 `MessagePort`、Node、Electron、数据库或文件能力。所有请求先由 Main gateway 校验调用方、方法、envelope 与大小限制。

### 2.2 Electron Main

Main 只拥有：

- 应用与窗口生命周期；
- Renderer 安全策略、Workspace gateway、请求关联和背压；
- Workspace utility process 的启动、握手、监督、epoch 切换与退出处理；
- 必须调用 Electron Main API 的 PLATFORM adapter，例如目录选择、受控系统打开、窗口与原生呈现能力；
- 经 Workspace 授权后的资源数据面宿主，具体方式由 [ADR-06](./ADR-06-resource-preview-system-open.md) 决定。

Main 不拥有领域事实、Workspace 用例状态、SQLite、文件索引、备份会话或恢复状态；不得根据平台动作结果自行宣称业务成功。

### 2.3 Workspace utility process

Workspace utility process 是 `IF-WORKSPACE` 背后的深 Module，部署 `MOD-WORKSPACE`、全部领域 Module、`MOD-DATA` 和 Node-safe PLATFORM adapter。模块间调用保持 Architecture 规定的依赖方向；物理同进程不允许 Shell 越界，也不允许 PLAN 依赖外围 Module。

活动 SQLite 的唯一 DATA adapter 位于此进程。Main、Renderer 和 worker 不得打开活动数据库。连接数、读写调度和事务由 ADR-03 决定。

可选 Module 必须在 guarded initialization 和接口级故障隔离下运行。可恢复错误映射为 `StructuredProblem`、capability 或 health；高风险解析器/压缩器放到 worker。一个外围 Module 的失败不得形成 Workspace 重启循环或阻止 PLAN 的可用路径。

### 2.4 Worker thread

worker thread 不是新的业务 Module，也不拥有正式事实。只在以下任一条件有证据时使用：

- CPU 密集工作会显著占用 Workspace event loop；
- 第三方解析/压缩实现需要额外崩溃或资源限制；
- G7 profile 证明重复任务值得一个有界 pool。

worker 不得持有 SQLite、`CommandReceipt`、`RestoreSession` 或推进正式状态机。它接收版本化、用途限定的输入，返回候选结果；命名 Module 验证结果后才能提交。I/O 密集工作默认使用 utility 内的异步 Node I/O，不为其创建线程。初始实现不预建常驻 worker pool。

## 3. IPC 与资源规则

### 3.1 请求协议

所有跨进程调用异步，禁止同步 IPC。Renderer → Main 和 Main → utility 使用同一规范 Workspace 请求语义，但属于两个独立 trust seam，均须校验。

每个消息至少绑定：

- IPC protocol version；
- request/correlation ID；
- 当前 `workspaceEpoch`；
- 五种 Workspace capability 之一及其版本化 DTO；
- `execute` 使用的稳定 `CommandId`；
- 大小限制、超时/取消语义和调用方身份。

消息只能包含无原型、可 structured-clone 的 DTO，不包含 UI、Electron、数据库连接、平台 handle、Error 实例或任意可执行回调。协议版本与兼容停止策略由 ADR-04 完成。

### 3.2 `observe`

utility 产生 revision、operation、capability 与 health change notice；Main 对通知进行授权、有界缓冲和同类合并后转发。通知只是重新 query 的提示：端口关闭、消息丢失或 epoch 改变后，Shell 必须重新订阅并 query 当前事实。

### 3.3 `accessResource`

资源访问的控制面必须完整经过 Shell → Main → Workspace。Workspace 按 `FileId`、请求用途、路径、权限与 verification stamp 重新验证后，才可签发短期、用途绑定、不可枚举的资源租约。

大文件字节不得进入 `ProjectionEnvelope` 或普通请求/响应 IPC。租约如何由 Main 兑现由 [ADR-06](./ADR-06-resource-preview-system-open.md) 决定；无论采用何种数据面，都不得让 Renderer 从展示路径获得文件权限。

### 3.4 PLATFORM adapter channel

文件系统、watcher、clock 与 zone 等 Node-safe adapter 位于 utility。必须调用 Electron Main API 的 chooser、system-open 等能力通过与 Workspace 请求分离的窄 adapter channel 调用。

Main adapter 只理解版本化的平台请求和结果，不理解 Course、Task 或 RestoreSession。Workspace 收到平台结果后仍负责领域验证与正式状态推进。测试以本地 adapter 替换 Main channel，因此 PLATFORM seam 具有真实的生产与测试 adapter。

## 4. 生命周期与失败语义

### 4.1 启动

Main 只能在 Electron app ready 后 fork utility。窗口可以呈现 bootstrap 状态，但在以下条件完成前不能发布 Workspace ready：

1. utility 已 spawn 并完成协议版本握手；
2. 分配新的 `workspaceEpoch`；
3. `FLOW-00` 完成活动数据、schema、完整性与可恢复 Operation 判定；
4. utility 返回 ready、limited、read-only 或 recovery 的明确模式与 capability/health。

可选 Module 在核心活动数据可判定后受控启动；其失败按自身 capability 降级。

### 4.2 utility 退出或通道断开

Main 监听 utility 的 `error` 与 `exit`：

- 立即使旧 epoch 失效并停止转发；
- Shell 显示明确 unavailable/recovering 状态，不保留伪 ready；
- 未收到结果的 query/preview 返回可重试的断线问题；
- 未收到结果的 execute 标记为 outcome unknown，不能宣称失败或成功；新 utility 完成 `FLOW-00` 后必须用原 `CommandId` 查询 `CommandReceipt`；
- 以有界重试启动新 utility；每次重启都产生新 epoch 并先执行恢复检查；
- 无法安全重开时进入 read-only 或 recovery，不进行无限重启。

有界次数与退避属于实现参数，但必须有确定上限和可测试的最终状态。

### 4.3 worker 失败

worker error/exit 只影响所属 Operation。命名 Module 按已持久状态决定 retry、safe cancel 或 reconciliation；不得把 worker 的“已发送”当作 disk-applied 或 committed。若任务可能已产生外部副作用，必须通过后续 ADR 定义的状态机检查事实。

### 4.4 关闭与更新

关闭时 Main 请求 utility 停止接收新命令并进行有界 drain。只有已越过正式提交边界的命令可以返回成功；已接受长操作必须在返回 accepted 前持久化。达到关闭期限后可以终止进程，但下次启动必须依赖持久 Operation/receipt 恢复，而不是依赖内存队列。

应用更新与协议切换不得让旧 Main 与新 utility 或反向组合静默通信；打包的进程版本必须一致，未知协议停止并解释。

## 5. Architecture 映射

- Module：全部 `MOD-SHELL`、`MOD-WORKSPACE`、`MOD-PLAN`、`MOD-ATTEND`、`MOD-LIBRARY`、`MOD-GRADE`、`MOD-PROTECT`、`MOD-DATA`、`MOD-PLATFORM`；
- Interface：`IF-WORKSPACE`、公共协议、全部模块内部 Interface、PLATFORM interfaces 与持久状态机；
- Flow：`FLOW-00`–`FLOW-06`；
- Quality：全部 `Q-*`，重点是 `Q-TRUTH-01`、`Q-CONSIST-01`、`Q-ISOLATE-01`、`Q-LOCAL-01`、`Q-PORTABLE-01`、`Q-RESPOND-01`、`Q-CONTINUITY-01`、`Q-DIAG-01`；
- Gate：`G2`、`G4`、`G5`、`G6`、`G7`。

## 6. 后果

### 6.1 正向

- Main UI thread 不承担数据库、领域计算或长文件工作；
- utility 形成明确的活动数据与 Workspace 生命周期所有者；
- 逻辑 Module 留在一个 implementation 内，避免分布式事务和 per-module IPC；
- utility 退出不会直接摧毁窗口，Shell 可以呈现恢复状态；
- IPC seam 与 `IF-WORKSPACE` 重合，外部 Interface 保持小而深；
- 生产 IPC adapter 与本地测试 adapter 可在同一 Workspace interface 上运行。

### 6.2 代价与风险

- 每次 Workspace 调用增加 Main gateway 和 utility 消息传递；
- DTO 必须可序列化并维护协议版本；
- utility 增加一个进程的启动、内存、诊断和打包成本；
- Main 同时承载 Workspace gateway 与部分 PLATFORM adapter，需要依赖守卫防止业务逻辑渗入；
- 单一 Workspace process 不能隔离任意未捕获的 native crash，因此高风险实现必须进入 worker，外围 Module 必须可受控降级；
- G7 必须实测 IPC、启动、内存和后台任务影响。

## 7. 被否决的方案

### 7.1 所有核心部署在 Electron Main

代码路径更短，但 SQLite 同步调用、恢复、扫描或压缩可能阻塞 Electron UI thread；Main 崩溃同时失去窗口和 Workspace 监督能力，故不满足响应性与故障边界。

### 7.2 以 worker thread 代替 Workspace utility process

线程开销较小，但与 Main 共享进程故障半径，不能为数据库/本地状态形成独立进程生命周期。worker 更适合作为 Workspace 内部 CPU adapter。

### 7.3 每个逻辑 Module 独立进程

隔离更细，但会把内部 Interface 变成公共 IPC，增加序列化、部署、故障组合和跨模块提交复杂度。当前没有需求要求这种成本。

## 8. 验证义务

实现前后必须产生以下证据：

1. import/dependency guard：Renderer 只依赖 Shell/Workspace DTO；Main 不依赖领域 implementation；PLAN 不依赖外围；
2. Workspace contract suite 同时运行本地 adapter 与真实 utility IPC adapter；
3. commit 后、响应前强制 kill utility，重启后用相同 `CommandId` 得到同一 receipt；
4. 在文件 planned、disk-applied、index-committed，备份临时发布和恢复 activation checkpoint 各阶段 kill worker/utility，验证恢复状态；
5. ATTEND、LIBRARY、GRADE、PROTECT 分别抛错或初始化失败时，PLAN 核心旅程继续；
6. 大文件预览不进入普通 IPC，过期/错用途/旧 stamp/旧 epoch 的资源租约全部拒绝；
7. `observe` 丢消息、断线、合并和重订阅后，query 返回当前一致事实；
8. Main 与 Renderer event-loop delay、Workspace query/commit latency、冷启动、内存和 worker 任务影响纳入 G7；
9. macOS 与 Windows 的 chooser、system-open、权限失败、进程退出和恢复状态均完成真实环境测试；
10. 关闭超时与更新后协议不匹配不会伪成功、静默丢操作或打开不兼容数据。

任何一项失败都表示 ADR-02 尚未落实，而不是通过增加 Renderer/Main 直连来规避。
