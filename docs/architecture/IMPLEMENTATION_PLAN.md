# CourseFlow 实施计划

按阶段交付可运行纵向切片。后阶段只依赖已通过门禁的 interface；不因未来路线提前创建空模块、表或抽象。详细执行顺序见 [Agent 开发执行流程](./DEVELOPMENT_WORKFLOW.md)。

## 当前状态

| 阶段 | 状态 | 结果/解锁条件 |
| --- | --- | --- |
| P0：仓库与质量骨架 | `done` | 基础质量门通过 |
| P1：学期、课程、课表、任务与成绩 | `done` | 手工正式数据闭环通过 |
| P2：统一投影、负荷、冲突与 ICS | `done` | Schedule snapshot 闭环通过 |
| P3：Sources 手工闭环 | `done` | 上传/预览/删除/手工表单通过 |
| P4：最终去留门禁 | `done` | 已签署 `MANUAL_ONLY` 并完成清理 |
| P5：UI 整合与体验打磨 | `next` | P4 已完成 |
| P6：已定义统计洞察 | `locked` | P5 完成且首批 Insight 由产品明确 |

完成阶段时，同一变更更新状态、证据和下一阶段。隔离设计探索不能绕过领域/contract 阶段进入 production route。

## 门禁记录

### P0（2026-08-12）

Node 24、pnpm 11、Docker/PostgreSQL/object storage 下，frozen install、migration、format/lint/typecheck、unit、production build、Playwright、secret/license/audit 全部通过。建立模块化单体、web/worker、类型化 config、request ID、readiness 和最小基础设施 seam。

### P1（2026-08-13）

完成 Term/Course、Lecture/Tutorial/Practical、Reading Week/单次例外、四种 Course Item temporal、标签、评分方案、手工 Grade Result、字母等级表与课程学分。PostgreSQL contract 验证 owner、版本与日期语义；canonical journey 回读正式数据。Gradebook 口径 `16% / 80% / 20%` 证明未出分不按零分。

### P2（2026-08-13）

建立 owner-scoped、单事务只读 `ScheduleSnapshot`。Dashboard、Tasks、Calendar、Timeline、热力图、冲突与 ICS 共用版本化投影；测试覆盖 Reading Week、TBA、时区、7 天边界、半开区间、稳定 UID 与 RFC 5545 转义/折行。canonical journey 与 Browser 视觉/交互通过。

### P3（2026-08-14）

冻结 `p3-manual-v1` 并完成 Source Document/ordered Asset、私有直传、server sniff/hash/owner 校验、安全预览、删除与从旁打开手工表单。真实 PostgreSQL/object-storage contract 与 canonical E2E 证明上传/预览零正式写入，手工提交后 Timeline/Dashboard 回读，删除 Source 不删除正式事项。

P3 曾保留条件性隔离研究实现，但没有生产 route/table/live adapter，也没有真实供应商调用。该实现已按 P4 结果删除。

### P4（2026-08-14）

最终结果：`MANUAL_ONLY`。

在第一次真实请求前发现两类硬失败：冻结 corpus 只有抽象 manifest，没有输入/逐字段 gold/locator；冻结 runner 只支持 dry-run，因此完整 eval 无法在不改冻结物的前提下运行。第一方尽调还确认下游输入精确保留、API 账户级训练退出、DPA/子处理者附件仍为 `UNVERIFIED`。按门禁规则没有注入或调用临时 key，没有修改样本、阈值、prompt/schema/budget 争取通过。

随后删除模型凭据/助手/解析与候选 UI、隔离 app、route/module/adapter/prompt/schema/eval runner/contracts/tests 及相关文案；未发现 AI 专用生产表或 migration。新增 `pnpm test:manual-only` 防回流，保留 Sources 手工闭环。完整哈希、指标 N/A/零调用、条款结论、清单和验证见 [P4 MANUAL_ONLY 签署](../quality/P4_MANUAL_ONLY_SIGNOFF.md)。

## P5：UI 整合与体验打磨

### 工作

- 完善 Course Item/Grade Component、复杂 ruleText、alternative scheme、成绩覆盖/等级表 partial 状态，不扩展为 GPA/预测。
- 清点 UI log，把 received/mapped/prototyped/frozen 条目整合或标记 superseded；历史拒绝 surface 不进入当前设计矩阵。
- 合并同义 token/primitive，清理旧 CSS、重复图标、临时 fixture 和被替代组件。
- 完成中英文结构、长 Unicode、`1280x900`、200% zoom、键盘/focus、对比度、reduced motion 和热力图等价视图。
- 对 Dashboard/Sources 做真实数据 profile，只修复已测得 N+1、过量 client JS、图片加载或渲染瓶颈。
- 保持 P4 `MANUAL_ONLY`；普通 UI 工作不得恢复已删除模型 surface。

### 完成标准

所有 UI 输入有最终映射；核心 route 属于同一冻结风格；生产无 mock/旧实现；canonical E2E、视觉与 a11y 检查通过；`pnpm gate:p4` 继续通过。

## P6：已定义统计洞察

只有用户明确首批 Insight 的名称、决策用途、输入范围、口径和最小数据量后开始。

1. 为每个 Insight 写 definition、范围、data quality 与不足状态。
2. 基于正式 snapshot 实现纯 calculator。
3. 用显式 registry 接入 query，不执行数据库中保存的 SQL/代码。
4. 按值类型选择表格/图表并提供非视觉等价；不足时显示真实空状态。
5. 使用可手算 fixture 核对算式与边界。

完成标准：每个数字可解释、可复算且只来自正式数据；没有虚构图表、动态 SQL 或通用插件框架。

## 每项任务的切片方法

1. 写出一个用户可观察场景与失败场景。
2. 定义/收紧目标 module interface 和 contract。
3. 实现最短真实路径：领域行为、必要 adapter、transport 与 UI。
4. 在 interface 上补最低充分测试，不穿透实现或多层重复断言。
5. 覆盖实际可达且有决策价值的页面状态。
6. 运行目标测试与阶段质量门，更新真实行为相关文档。

完成标准：切片从用户入口走到持久化/投影并可独立演示；不以“先建所有表/组件”代替结果。

## 暂不建设

- 微服务、Kafka/事件总线、Redis cache/queue、GraphQL、第二套 HTTP 栈。
- 通用 repository/CRUD/BaseService、运行时指标 DSL、插件 SDK、通用 workflow engine。
- OCR、远程模型凭据/调用、自动资料解析、候选/审核、规划助手或供应商替换。
- 模型直写、自动工具、默认联网搜索、自定义 endpoint 或隐藏 feature flag。
- 为未来 LMS/邮件同步或已拒绝功能预留空表/provider factory。
