# 质量、安全与运行要求

CourseFlow 管理可能影响学生提交和考试安排的数据。质量门槛围绕“错误可见、原文可核对、重试安全、时间正确、手工写入边界明确”设计。

## 1. 测试策略

| 层 | 验证内容 | 代表场景 |
| --- | --- | --- |
| 纯领域/Vitest | 值对象、不变量、投影 policy | temporal union、Reading Week、成绩、冲突、热力图 |
| core interface | 完整 command/query 行为 | owner、幂等、版本冲突、正式写入 |
| adapter contract | PostgreSQL/object storage 与 port 一致 | transaction、约束、上传、预览、删除 |
| contract/golden | 稳定 JSON 与 serializer | problem shape、时间 union、ICS |
| 组件 | 用户可见行为和 a11y | Source 预览/手工入口、表单错误与焦点 |
| Playwright | 最短真实用户旅程 | 上传 → 预览 → 手工表单 → 正式投影 |
| 发布面扫描 | P4 `MANUAL_ONLY` 约束 | 无模型配置、route/module/table/UI；手工文件仍存在 |

同一事实不在多个层重复断言。高风险日期、权限、幂等和正式写入规则优先用 interface/adapter 测试；E2E 只保留无法由低层证明的跨层旅程。

### 1.1 必测领域场景

- LocalDate 在不同时区仍是同一课程日期；exact instant 按显示时区正确换日；DST gap/overlap 不静默接受。
- 周期课节只在有效日期/星期展开；Reading Week 与 kept/rescheduled/cancelled 例外按优先级处理，occurrence identity 稳定。
- 下一节课在开始前、进行中、今日无后续和跨日状态一致；Dashboard/Calendar 使用同一实例与地点/TBA。
- `[start, end)` 相邻区间不冲突，真正交叉才是 `hard_overlap`；unscheduled 不进日历、热力图或 ICS。
- 未知评分权重不是 0；未出分没有 Grade Result；Gradebook 同时显示已获百分点、已出分百分比与覆盖权重。
- A/B/C/D/F 边界完整且单调；无等级表不猜字母等级，学分不触发 GPA/已获学分推断。
- 自定义标签不能跨学期；大小写折叠重复被拒绝；任务分组由固定 Clock/policy 重算。
- Source begin/complete/preview/delete 均为 owner-scoped；上传/预览零正式写入；对象签名/MIME/大小不符 fail closed。
- 从 Source 打开的手工表单仍经 owner、领域、expected version 与幂等校验；只有明确提交产生正式记录。
- P4 发布扫描确认代码、route、bundle、schema/migration、依赖、环境配置和产品 UI 中没有远程模型凭据、自动解析、候选审核或助手。

### 1.2 Fixture 与时间

- 注入 Clock 与 ID generator；测试不依赖真实 `Date.now()` 或随机 ID 的具体值。
- 文档 fixture 必须自创、获授权或去身份化，不提交真实姓名、学号、邮箱或未获授权资料。
- migration test 从空库到最新，并验证当前 release 快照升级。
- P4 研究记录可保留供应商名称与公开链接，但不进入 release surface scan 的生产 roots。

## 2. CI 质量门

`pnpm gate:p4` 执行：frozen install、依赖准备、migration、format、ESLint、TypeScript、unit/interface、migration/adapter contracts、`MANUAL_ONLY` 扫描、production build、Playwright canonical journey、secret/license/audit checks。

文档-only 变更可以由 CI policy 跳过昂贵 E2E，但 P4 清理或可见 Sources 变化必须运行完整门禁。package script 是命令真相，不在本文复制内部参数。

## 3. 安全模型

### 3.1 信任区与授权

不可信输入包括 browser body/query/header、文件名/MIME、PDF/图片和日历文本。每次跨 seam 都解析；文件来自自己的 bucket 也不等于可信。

- auth provider 只建立 auth subject 到 internal user；领域记录使用内部 ID。
- repository operation 带 `UserScope`；private object 预览在签发响应前重新鉴权。
- 不存在与无权限的私有资源使用相同 404 语义，避免枚举。
- web role 只执行已授权业务命令；worker role 只处理明确的本地 job，不能写不相关正式数据。

### 3.2 Web 与文件

- same-site/secure/httpOnly session cookie；mutation 检查 Origin/CSRF。
- CSP、HSTS、`nosniff`、Referrer-Policy 与 frame ancestor 限制逐步收紧。
- 不渲染资料 HTML；地点和原文按纯文本；ICS 与 Content-Disposition 正确转义。
- object key 不含用户输入；bucket 私有；上传/预览授权短时、owner/object/method scoped。
- 校验实际 byte size、magic bytes、MIME、数量与总量；列表不加载整份文件。
- 上传、完成、预览、删除与导出按用户/IP 合理限流。

### 3.3 P4 发布约束

- 生产配置没有模型 endpoint、alias 或 API key；浏览器、server、worker 和 database 都不接收此类凭据。
- 不运行 OCR 或把 Source 正文发送到远程模型；没有自动解析、候选审核、助手或替代供应商。
- `scripts/verify-manual-only.mjs` 检查已删除路径和 release roots 中的禁止 contract/persistence/config 标识。
- `scripts/check-secrets.mjs` 拒绝常见私钥、云 token 和 `sk-…` 风格秘密；任何临时凭据都不能写入 workspace。

## 4. 隐私与数据生命周期

- 首版不需要学号、学校密码或通讯录。
- 用户可删除 Source；metadata 先 fail closed，对象清理幂等重试，备份按已披露保留策略过期。
- 删除 Source 不删除手工确认的 Course/Item/Gradebook 数据。
- 用户可导出/删除账号数据；账号删除是可重试 saga。
- 普通日志不含课程正文、可能含身份的原文件名、邮箱或签名 URL。必要诊断使用显式受限且自动过期机制。
- analytics 使用低基数、无内容字段，例如 Source 状态、资源数量 bucket 和耗时。
- 没有课程正文发送给远程模型，因此产品不出现远程处理/训练退出文案；P4 供应商尽调只保留在研究归档。

## 5. 性能与容量

| 场景 | 目标 |
| --- | --- |
| 普通 Dashboard server response | p95 < 500 ms（不含用户网络） |
| 普通 command | p95 < 750 ms（不含对象直传） |
| 首屏 | 主要内容 server render；仅发送必要 Client island JS |
| Source 列表 | indexed metadata query，不读取正文 |
| 设计规模 | 每用户 20 学期、每学期 20 课程、每课程 1000 事项仍为有界查询 |

- 防 N+1：Dashboard 使用专用 term snapshot query。
- 课节按请求日期范围展开；热力图/冲突也使用有界范围。
- 上传由浏览器直传 object storage，web 不缓冲整份文件。
- 图片/PDF 预览按需读取，列表不生成大预览。

## 6. 可观测性

每个 web 请求有 requestId；正式 command 与 Source cleanup 携带 domain ID 和 attempt。结构化事件至少覆盖 source upload/complete/reject/preview/delete/cleanup、正式 command 成败、calendar export。字段只含安全 ID、状态、计数 bucket、error code 和 latency。

指标覆盖请求量、错误率、p50/p95/p99、PostgreSQL latency、object-storage latency、上传拒绝与 cleanup backlog。告警聚焦持续依赖失败、删除积压和认证异常；单次用户校验错误不告警。

## 7. 可靠性与恢复

- PostgreSQL 是权威源，建立 backup/restore 演练；object storage 配置适当 durability/lifecycle。
- deployment 使用 expand/migrate/contract；派生投影可从正式数据重算。
- 外部 storage 调用有 timeout、有限重试和 jitter；用户输入错误不重试。
- worker 优雅停止，未完成 cleanup 由 lease/attempt 恢复。
- schema 与领域 policy 都有版本；回滚不改写已有正式事实。

## 8. 无障碍与浏览器质量

- 目标 WCAG 2.2 AA；关键旅程做自动检查及人工键盘 spot check。
- `1280x900` 为视觉基线；200% zoom 保留内容、控件、错误与键盘操作，除明确二维容器外无 document 水平滚动。
- 支持当前和前一个稳定 Chrome、Edge、Firefox、Safari；核心逻辑不做 UA 分支。
- dropzone 同时提供标准 file input；日期/错误/课程/冲突不用颜色作为唯一表达。
- 热力图提供非视觉等价列表；动画遵守 reduced motion。

## 9. Definition of Done

- 术语与不变量符合 CONTEXT/数据模型；interface 有最低充分测试。
- HTTP/文件输入在 seam 校验，授权覆盖正反路径。
- 页面具备 loading/empty/error/success 与适用的 stale/version-conflict 状态。
- 键盘、`1280x900`、200% zoom、长文本和本地化数据经验证。
- P4 `MANUAL_ONLY` 扫描、手工 Source canonical E2E 与 secret scan 通过。
- 日志可定位失败且不泄漏正文/凭据；migration/config/docs 同步。
- 无 mock production 数据、临时 route、死代码或被替代实现残留；CI 全绿。
