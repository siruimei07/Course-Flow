# ADR-02 方案 2：进程与线程部署审计

> 审计日期：2026-08-19
> 审计对象：Renderer + Electron Main + 单一 Workspace utility process + 按需 worker thread
> 结论类型：架构可行性与需求覆盖审计，不代替后续实现测试

## 1. 结论

**方案 2 在加入本审计列出的强制约束后，可以承载当前全部产品、逻辑架构和模块契约要求，建议接受为 `ADR-TOPIC-02` 的正式决议。**

它不直接实现所有需求，也不替代 SQLite、schema、文件、快照和发布 ADR；审计结论是：当前没有任何已批准需求要求 Renderer 直连数据库/文件系统、要求每个逻辑模块独占进程，或与单一 Workspace utility process 冲突。后续 ADR 可以在该部署方式内满足相应成功边界。

审计不是无条件通过。下列约束必须成为 ADR-02 的规范内容：

1. utility process 是承载 `IF-WORKSPACE` 和领域行为的深 Module，不是把每个内部方法机械暴露给 Main 的浅转发层；
2. Main 只做应用宿主、安全网关和 Electron 专属 PLATFORM adapter，不拥有领域事实、SQLite 或业务状态；
3. SQLite 只允许 Workspace utility process 中的单一 DATA adapter 持有；Main、Renderer 和 worker 不得直接打开活动数据库；
4. 所有跨进程调用异步、版本化、可关联并经过运行时 schema 校验；禁止同步 IPC；
5. worker 只承担已证明为 CPU 密集或需要额外崩溃隔离的派生任务，不拥有数据库、正式状态或提交成功权；
6. 大文件不进入普通 Workspace 投影或普通消息；`accessResource` 只控制授权，数据面使用短期、用途绑定的资源租约或流；
7. utility/worker 退出、请求响应丢失和应用关闭必须通过 `CommandId`、`CommandReceipt`、持久 Operation 与新 `workspaceEpoch` 恢复，不能把未知结果报告为失败或成功；
8. 可选模块初始化与调用受故障隔离保护，失败产生 capability/health 降级；解析器、压缩器等高风险实现放入 worker，不能让外围故障反复击穿 PLAN；
9. PLATFORM 仍是一个逻辑 seam。Node 可实现的文件/时钟 adapter 位于 utility；必须使用 Electron Main 的 chooser/system-open 等能力通过独立、窄、可替换的 adapter channel 调用；
10. `observe` 只发送有界、可合并的重查提示；断线或换 epoch 后 Shell 必须重新 query，不能把事件流当事实源。

## 2. 审计依据与方法

以当前仓库全部产品、User Flow、UI、Architecture 与 Module Contracts 为依据。Architecture 的完整追溯矩阵已把产品 Requirement 归并到 `MOD / IF / FLOW / Q / TEST`，因此本审计逐层检查：

1. 九个逻辑 Module 是否都有合法部署位置；
2. 公共与模块 Interface 是否能保持语义、不泄漏实现类型；
3. `FLOW-00`–`FLOW-06` 的成功、失败和恢复边界是否可跨该进程拓扑实现；
4. 十五条 `Q-*` 与 `G1`–`G7` 是否被拓扑阻断；
5. 产品 UI、文件预览、平台增强、无障碍和离线行为是否需要被禁止的直连路径；
6. Electron/Node 官方能力是否实际支持 utility process、MessagePort、退出监督和 worker thread。

Electron 官方文档说明 `utilityProcess` 创建带 Node.js 与 MessagePort 的子进程，支持 `postMessage`、`spawn`、`error` 和 `exit` 生命周期；Electron 同时要求不要阻塞 Main，并建议 CPU 密集工作使用 worker。Node 官方说明 worker thread 适合 CPU 密集工作，而异步 I/O 比 worker 更适合 I/O 密集工作：

- [Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)
- [Electron Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron Performance](https://www.electronjs.org/docs/latest/tutorial/performance)
- [Node.js worker_threads](https://nodejs.org/api/worker_threads.html)

## 3. Module 部署覆盖

| Module | 部署 | 审计结果与约束 |
|---|---|---|
| `MOD-SHELL` | sandboxed Renderer | 通过；只经预加载脚本调用五种 Workspace 能力，不持有正式事实。 |
| `MOD-WORKSPACE` | Workspace utility process | 通过；作为深 Module 聚合用例、revision、health 与恢复，不在 Main 重复编排。 |
| `MOD-PLAN` | Workspace utility process 内部 | 通过；与外围 Module 保持逻辑单向依赖，物理同进程不授权反向调用。 |
| `MOD-ATTEND` | Workspace utility process 内部 | 通过；异常映射为自身 capability/health，PLAN 采用基础时间语义。 |
| `MOD-LIBRARY` | Workspace utility process 内部；CPU/高风险派生工作可进 worker | 通过；磁盘仍是真相，watcher 只触发扫描，worker 结果必须由 LIBRARY 验证。 |
| `MOD-GRADE` | Workspace utility process 内部 | 通过；计算错误不覆盖事实，不向 Shell 暴露内部 evaluator。 |
| `MOD-PROTECT` | Workspace utility process 内部；压缩/校验可进 worker | 通过；检查点、RestoreSession 与激活权仍在 PROTECT/DATA，不在 worker。 |
| `MOD-DATA` | Workspace utility process 内唯一活动数据 adapter | 通过；自然形成单一 SQLite 所有者；具体事务与连接策略留给 ADR-03。 |
| `MOD-PLATFORM` | 逻辑 seam 跨两个 privileged process 的窄 adapter | 通过；utility 内有 Node-safe adapter，Main 仅实现 Electron-only adapter；测试使用本地替身。 |

删除 Workspace utility process 会迫使数据库所有权、恢复、模块 health 和用例编排散落到 Main 或 Renderer，因此它提供真实 Depth；Main gateway 则通过安全校验、生命周期、平台调用和背压获得必要 Leverage，不能扩张成第二个 Workspace。

## 4. Interface 与跨进程语义

| Interface 组 | 审计结论 |
|---|---|
| `IF-WORKSPACE` 五种能力 | 通过；保持唯一外部 seam。Main 使用一个版本化请求 envelope 转发，不为每个领域方法创建新 IPC。 |
| `IF-STRUCTURED-PROBLEM`、`IF-OPERATION-HANDLE`、`IF-DURABLE-FOLLOWUP`、`IF-POST-COMMIT-CHANGE`、`IF-REVISION-ENVELOPE`、`IF-IMPACT-PREVIEW` | 通过；均可表示为无原型、可 structured-clone 的版本化 DTO，并在两个 IPC seam 校验。 |
| `IF-PLAN-*`、`IF-ATTEND-*`、`IF-LIBRARY-*`、`IF-GRADE-*`、`IF-PROTECT-*`、`IF-DATA-*` | 通过；保留在 Workspace implementation 内部，不因部署方案扩大为公共 IPC。 |
| PLATFORM interfaces | 通过但需专用 adapter channel；Main 不接收领域 Intent，只接收窄平台动作，结果返回 Workspace 后再验证。 |
| `IF-FILE-OPERATION`、`IF-RESTORE-SESSION` 等状态机 | 通过；状态必须先持久化再启动外部动作，worker/Main 只返回动作结果，不能自行推进正式状态。 |
| `accessResource` | 通过但需控制面/数据面分离；显示路径可作为只读字符串投影，真正读取、预览、定位和系统打开必须重新校验身份与 stamp。 |

## 5. 七条 FLOW 审计

| Flow | 结论 | 必须落实的部署语义 |
|---|---|---|
| `FLOW-00` Workspace 激活 | 通过 | Main 在 app ready 后启动 utility；只有协议握手、数据验证和可恢复操作判定完成后才发布 ready/limited/read-only/recovery。 |
| `FLOW-01` 结构化命令 | 通过 | utility 内完成领域验证和 DATA 提交；响应丢失时用同一 `CommandId` 查询 receipt，Main 不推断结果。 |
| `FLOW-02` 统一计划投影 | 通过 | PLAN 与外围投影在同一 utility 中共享一个 ReadSnapshot/EvaluationContext；Renderer 只消费最终 envelope。 |
| `FLOW-03` 资料库对账 | 通过 | 异步文件 I/O 留在 utility；CPU 派生任务可进 worker；FileOperation 的 planned/disk-applied/index-committed 状态由 LIBRARY/DATA 持久推进。 |
| `FLOW-04` 异步备份 | 通过 | execute 只返回 accepted + OperationHandle；一致 checkpoint 由 utility 获取，压缩/校验可隔离，发布结果回到 PROTECT 持久化。 |
| `FLOW-05` 显式恢复 | 通过 | utility 独占恢复会话与激活；崩溃后新 epoch 先恢复/回滚再开放普通写入，Main 不直接替换活动数据。 |
| `FLOW-06` 确定性结果投影 | 通过 | ATTEND/GRADE 在同一 snapshot 计算；异常转为模块 unavailable，PLAN 仍可查询。 |

## 6. 质量约束与 Gate 审计

| 覆盖项 | 结果 | 说明 |
|---|---|---|
| `Q-TRUTH-01` / `Q-CONSIST-01` / `Q-CONTINUITY-01` | 通过 | 单一 DATA/SQLite owner、同进程 snapshot、持久 receipt/operation 可实现无伪成功与重启幂等。 |
| `Q-TIME-01` / `Q-STATE-01` / `Q-PROVENANCE-01` | 不受阻 | 属于领域类型与算法；部署不改变 Term Zone、未知状态或结果来源。 |
| `Q-PROTECT-01` / `Q-EVOLVE-01` | 通过 | 恢复/迁移都在 utility 的独占工作区模式下运行；未知版本可在 ready 前停止。 |
| `Q-ISOLATE-01` | 有条件通过 | 需要可选模块 guarded initialization、接口级异常隔离和高风险 worker；不能让可选模块未捕获异常形成重启循环。 |
| `Q-LOCAL-01` / `Q-PORTABLE-01` | 通过 | 全部代码和数据在本机；同一 Workspace implementation 跨平台，差异仅在窄 adapter。 |
| `Q-ACCESS-01` / `Q-USABILITY-01` | 通过 | UI 和焦点留在 Renderer；所有异步结果必须投影为可宣布状态，不因后台进程抢焦点。 |
| `Q-RESPOND-01` | 通过 | Main/Renderer 不执行数据库或长 I/O；不可预测任务返回 OperationHandle；worker 只处理 CPU 工作。 |
| `Q-DIAG-01` | 通过 | requestId、operationId、workspaceEpoch、进程退出与模块 health 可形成结构化原因和下一步。 |
| `G1` | 通过 | ADR 可引用现有完整追溯，不新增产品语义。 |
| `G2` | 通过 | 只有 Workspace seam 跨 UI；模块内部 import guard 仍是验收项。 |
| `G3` | 不受阻 | 领域性质测试可绕过 IPC 直接在 Workspace interface 和内部纯 evaluator 执行。 |
| `G4` | 通过但必须 failpoint 验证 | 必测 commit 后响应前、worker exit、utility exit、备份发布、恢复激活与关闭超时。 |
| `G5` | 通过但必须故障注入 | ATTEND/LIBRARY/GRADE/PROTECT 逐个失败时 PLAN 旅程仍须可用。 |
| `G6` | 通过但必须双平台实测 | utilityProcess/平台 adapter、权限、键盘与状态公告在 macOS/Windows 验收。 |
| `G7` | 未被阻断、尚待校准 | 额外 IPC 和 utility 内存必须进入参考设备测量；未有数值预算前不是否决理由。 |

## 7. 产品范围检查

- MVP-A 的学期、课程、课节、任务、Today/Week/Calendar、离线保存、备份和恢复全部通过同一 Workspace seam 完成；没有功能要求 Renderer 直连本地数据。
- MVP-A-P 与 MVP-C1 是结构化事实和确定性投影，适合留在 Workspace implementation 内，并能按 capability 降级。
- MVP-B 的文件选择、监听、系统打开和预览需要 PLATFORM adapter 与资源数据面，但不需要把 LIBRARY 或文件权限移入 Renderer。
- UI 的真实绝对路径展示是数据投影，不是权限授予。审计已同步修正 ADR-01 的冲突措辞。
- 玻璃材质、响应式、键盘、读屏和动画偏好属于 Renderer/Main 呈现层；Workspace 进程不妨碍这些要求。
- 未来扩展仍通过稳定 ID、Workspace interface 和 Module 内部 seam 接入；当前无需预建进程。

## 8. 剩余风险与后续 ADR 义务

方案通过不代表下列问题已经决定：

- ADR-03 必须选择 SQLite adapter、单 writer、读取与备份连接规则；
- ADR-04 必须定义 IPC protocol version 与数据 schema version 的兼容/停止策略；
- ADR-05/06 必须决定文件监听、原子替换、资源租约、流与 PDF/image/text preview；
- ADR-07/08 必须定义 utility 崩溃点下的快照发布与恢复激活；
- 后续 [ADR-09](../architecture/adr/ADR-09-no-production-diagnostics.md) 已决定不持久化诊断内容；request/operation/epoch 只在正式当前状态或 owner 内存错误映射中按需存在；
- ADR-10 必须验证 utility/worker 脚本、原生依赖、签名、公证和升级后的协议兼容。

若后续实测显示额外进程使 `G7` 无法达标，或某必要驱动不能在签名后的 utility process 中稳定运行，应重新打开 ADR-02；在此之前不引入 per-module process 或常驻 worker pool。
