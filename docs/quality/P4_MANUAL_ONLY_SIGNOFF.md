# P4 最终签署：`MANUAL_ONLY`

- 决策日期：2026-08-14（Asia/Shanghai）
- 基线提交：`ef7936573739558b65a060c8f0097cdceb520553`
- 基线提交时间：2026-08-14T02:08:08+08:00
- 最终结论：**`MANUAL_ONLY`**
- 真实供应商请求：**0**

## 1. 首次真实调用前冻结证据

以下对象在本次 P4 开始前已经提交，且在任何外部请求前以 Git object 与 SHA-256 复核。它们没有为争取通过被修改；决定 `MANUAL_ONLY` 后从 release workspace 删除，仍可由上述提交和本报告追溯。

| 冻结对象 | 版本/内容 | Git blob | SHA-256 |
| --- | --- | --- | --- |
| policy | `ai-eval-policy-v1`；`frozen-before-first-live-call`；8 thresholds；7 zero-tolerance | `015b08fa5d733c35c7603c8a61eadfecdb5c97cc` | `458d044f9b2793e2cd6680cf8e792af39522d04f1571e39d9d501e83215342f7` |
| corpus manifest | `ai-eval-corpus-v1`；5 samples | `da5485adebd6053360a4658c132ada13f0f87adf` | `3754614cc2493db38018f76d3264620e920892c11409eb330260ffaa6fc09a7c` |
| runner | P3 dry-run-only runner | `68905ce8795c7be8e2cba2938786c63dbe2e2e5e` | `14d8a8b9d287e88f438c96e6503b27a2a5c7bcb987f246d8f89d28311ae26aea` |
| request builder | fixed Responses request contract | `96f15ac4b5933dbd65ed053549e2a8fe3a0e1797` | `79bde20532af6470adc3e1cf9ea914cdc980243d9ad674affda9c44fbf069920` |
| extraction | prompt/schema/budget v1 | `506148bbb20b8bf54ab30070aefeb89ef6d5673a` | `81b1b5ac7191a5fc6eea12c539bb2f9062691c74f211357014bf53410f48ee46` |
| assistant | prompt/schema/budget v1 | `52d8597da12d2b27d970261447b9822a68809c36` | `6b72a5c3ded0472f1a5d7f7489ea48f9a6c47a1c2cba539ab3f50a89135340a1` |

冻结版本：

- extraction：`ingestion-course-items-prompt-v1` / `ingestion-course-items-schema-v1` / `ingestion-deepseek-budget-v1`
- assistant：`assistant-planning-prompt-v1` / `assistant-planning-schema-v1` / `assistant-deepseek-budget-v1`
- budgets：input 32k/16k，output 8k/4k，timeout 60s，schema repair 1，transient retry 2
- request contract：官方 `/responses`，指定目标 alias、JSON Schema、`stream=false`、`reasoning.effort=none`、`tools=[]`、`tool_choice=none`、正向字段 allowlist

冻结阈值：structured output ≥ 0.99；critical precision ≥ 0.98；critical recall ≥ 0.95；Evidence locator = 1；citation allowlist = 1；terminal failure ≤ 0.02；p95 ≤ 30s；estimated cost/document ≤ USD 0.25。七个安全计数全部要求为 0。

## 2. 预调用硬失败与短路

1. corpus 文件只有 5 个样本 ID、feature、fixture 名称和一句抽象 gold 描述；没有可发送的实际 input、逐字段 gold、允许 locator/citation ID 或评分记录。无法计算结构成功率、precision/recall 或命中率。
2. runner 明确拒绝除 `--dry-run` 之外的模式；没有 live transport、受保护 secret reader、完整 eval/error/red-team executor 或指标聚合。
3. 增补语料正文/gold 或 live runner 会改变已冻结 corpus/runner，与“同一版本评测、不得为通过修改样本/prompt/schema/阈值”冲突。
4. 法律/数据门禁还有多个 `UNVERIFIED`。任一项已足够触发失败分支，因此没有理由把临时秘密送入第三方。

按门禁的 fail-closed 规则，真实 extraction smoke、assistant smoke、完整 eval、错误 contract 和注入/越权红队均标记为 **NOT RUN — pre-call hard gate failed**，而不是 passed。

## 3. 真实指标

| 指标 | 结果 |
| --- | --- |
| 请求数 | `0` |
| 结构成功率 | `N/A — 未执行` |
| 关键字段 precision / recall | `N/A — 未执行` |
| Evidence locator / citation allowlist 命中 | `N/A — 未执行` |
| p50 / p95 延迟 | `N/A — 未执行` |
| 终态失败率 | `N/A — 未执行` |
| input / cached / output / reasoning / total tokens | `0 / 0 / 0 / 0 / 0` |
| 实际费用 | `USD 0` |
| request/response ID、实际 model | 无；没有响应 |

这些 N/A 是门禁失败证据，不能解释为零延迟、零失败或质量达标。

## 4. 官方 contract 与下游数据条款

第一方资料核验日期为 2026-08-14。详细逐项证据和链接见 [官方尽调](../research/deepseek-p4-official-due-diligence-2026-08-14.md)。

| 问题 | 结论 | 门禁影响 |
| --- | --- | --- |
| Responses endpoint、目标 alias、JSON Schema、禁用 tools/web、non-streaming、usage | `VERIFIED`（公开 contract） | 只证明文档支持，不替代 runtime eval |
| HTTP/终态错误的公开范围 | 部分 `VERIFIED`；稳定 error enum/request-ID/Retry-After 仍 `UNVERIFIED` | runtime contract 未执行 |
| API 下游输入精确保留期 | `UNVERIFIED` | 硬失败 |
| API 账户级、可审计且覆盖下游输入的训练退出 | `UNVERIFIED` | 硬失败 |
| 处理地域 | `VERIFIED`：通用政策说明在中国处理/存储 | 需要下游跨境披露；不可选地域仍 `UNVERIFIED` |
| DPA、SCC、子处理者清单/地域附件 | `UNVERIFIED` | 硬失败 |
| 下游披露、合法依据、权利响应、AI 标识与人工审核义务 | `VERIFIED` | 即使其他项通过也必须实现 |

官方公开材料中，“stateless”不等于零保留；context caching 会把前缀写入磁盘；通用隐私政策允许为改进/训练处理 User Input。没有额外、适用且可审计的合同材料时，不能承诺零留存或“不训练”。

## 5. 临时凭据处理

- 用户在对话中提供了临时秘密，但本执行没有把它复制到 shell 命令、环境变量、workspace、数据库、日志、报告或网络请求。
- 没有创建 provider resource，也没有执行认证/模型调用，因此本地没有可撤销的软件内凭据或 session。
- `scripts/check-secrets.mjs` 新增通用 `sk-` token pattern；最终 scan 必须为零匹配。
- 本执行无法控制用户的供应商账户或删除对话中的原消息；供应商侧 key 的最终删除由账户持有人在控制台完成。该外部撤销不能被本报告伪称为已完成。

## 6. `MANUAL_ONLY` 清理清单

已删除：

- `apps/import-harness` 整个隔离应用、结果区域、审核 workbench 与 route。
- core 的 `ai`、`assistant`、`ingestion` 模块及其 public exports/品牌 ID。
- fixed request builder、prompt/schema/budget registry、local parser/validator、adapter seam。
- 候选审核 HTTP schema/type、AI harness/unit tests、专用 Playwright config。
- eval policy/corpus/runbook/runner 和 package scripts。
- AI 专用 CSS、可见 Sources 条件文案与条件设计矩阵。
- workspace importer、CI 的旧 P3 eval/harness 步骤。

数据库核对：P3 production migration/schema 从未包含模型凭据、对话、导入 run/artifact、Evidence/Candidate/Review 表，因此没有生产 AI table/migration 可删除；P4 scan 必须确认这些标识为 0。正式 Source tables/migrations 被保留，因为它们支持手工闭环。

保留：Term/Course/Meeting、Course Item/Task/Gradebook、Schedule snapshots、Source Document/Asset、手工 UI 与确定性投影；研究和 ADR 作为历史审计，不进入 release composition。

## 7. 验证与签署

2026-08-14 的最终验收结果：

- `pnpm gate:p4` 从头通过：frozen install、PostgreSQL/对象存储健康、migration current、format、lint、typecheck、11 个测试文件/33 项测试、空库迁移、P3 PostgreSQL/S3 Source contract、production build、canonical E2E（1/1，16.2s）、security gate 全部成功。
- `pnpm test:manual-only` 在完整门禁内通过：扫描 161 个 release 文件，prohibited path `0`、violation `0`，状态 `MANUAL_ONLY_CLEANUP_PASSED`。
- production route inventory 仅含正式手工领域和 Source Document/preview/upload/delete 接口；没有 AI、assistant、candidate、review、import、provider route。
- Browser 在 production build 的 `/sources`、`1280x900` 下确认 page identity 为“资料库”，无横向溢出、无 console 日志；`deepseek`、`AiResultRegion`、`candidate`、`assistant`、“自动解析”、“候选”、“智能助手”可见命中均为 `0`。
- Browser 确认“课程事项 / 课节 / 评分方案”三条手工入口存在。进入“课程事项”后保留 `courseId/sourceId`，页面明确说明原文不会预填或提交任何字段；可编辑文本/数值输入均为空。
- 预览/删除验收使用一份 218-byte 临时最小 PDF：preview 返回 `200 application/pdf`，下载字节与本地 SHA-256 `a6946076beaeb23e666cc3e268cac0b34c2c281d1497aaf7952609d31043199f` 一致；随后通过正式 DELETE contract 删除，列表和对象存储均无残留。
- 上述删除曾暴露 production Turbopack 跨 chunk 下 `instanceof DomainError` 误判并返回 `500`。回归测试先复现失败；修复为 `Symbol.for("courseflow.domain-error")` 稳定品牌后，focused test 3/3、原始 production missing-preview 请求 `404`、完整门禁与 canonical E2E 全部通过。
- 完整门禁内的 `pnpm security:secrets` 扫描 261 个 source 文件且零匹配；license policy 检查 69 个 production packages 通过；audit 为 1 low / 1 moderate，`high` 发布阈值通过。
- 真实 DeepSeek 请求、provider request ID、provider session 与本地 provider credential 均为 `0`；token 与费用均为 `0`。质量和延迟指标保持 `N/A — NOT RUN`，不伪装成达标。
- 签署后清场完成：production server、测试容器和 WSL keepalive 已停止；一次性、未跟踪的 Docker bridge 已删除。无 `3000/3001/3002/5432/9000/9001` 监听，无敏感环境变量名；仅保留 Codex 自身 host/browser 自动化进程。
- 清场后的独立复核再次通过：manual-only 扫描仍为 161 个 release 文件、0 violation；secret scan 扫描 260 个 source 文件且零匹配；`scripts/docker.cmd` 不存在。

签署规则：本报告代表自动化硬门禁的 fail-closed 裁决，不冒充 privacy/engineering 人员签名。由于存在硬失败与 `UNVERIFIED`，`AI_GO` 在逻辑上不可签；唯一合法产品结论是：

## **`MANUAL_ONLY`**

P5 只可在该发布模式上继续。改变此约束需要用户明确的新产品授权、全新 ADR 和重新设计的完整门禁；不得从本次被冻结/删除的实现恢复。
