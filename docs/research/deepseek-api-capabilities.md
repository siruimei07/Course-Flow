# DeepSeek API 能力核验：CourseFlow P3

> 状态：研究记录，不是架构契约或产品需求
>
> 核验日期：2026-08-13（Asia/Shanghai）
>
> 资料范围：仅使用 DeepSeek 官方 API 文档、官方变更日志与官方条款；价格、模型版本和 Beta 能力均可能变化。

## 1. 结论摘要

1. **`deepseek-v4-pro` 是可公开确认的官方 API 模型标识。** 官方模型列表同时列出 `deepseek-v4-pro` 和 `deepseek-v4-flash`；当前价格页展示名称为 `DeepSeek-V4-Pro`，不能推导出可调用的日期快照。[Lists Models](https://api-docs.deepseek.com/api/list-models/)（访问：2026-08-13）；[Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/)（访问：2026-08-13）
2. **但不能把它写成已确认的稳定 GA 快照。** 2026-07-31 的官方变更日志仍称 V4-Pro 的正式发布“将随后到来”，而当前文档只允许调用动态别名 `deepseek-v4-pro`。P3 应记录 Responses 的 `response.id` 与实际 `model`，并以回归评测防范静默升级；Responses contract 没有保证 `system_fingerprint`，不能把它设为必填审计字段。[Change Log](https://api-docs.deepseek.com/updates/)（访问：2026-08-13）；[Responses API](https://api-docs.deepseek.com/api/create-response/)（访问：2026-08-13）
3. **当前公开规格是 1M 上下文、最高 384K 输出，支持思考与非思考模式。** 思考模式默认开启，支持 `low`、`high`、`max` 努力等级；这是能力上限，不应作为 P3 的默认提示或输出预算。[Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/)（访问：2026-08-13）；[Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)（访问：2026-08-13）
4. **官方 API 当前是文本输入，不是原生文件/图像/PDF 输入。** Responses API 明确说图片和文件输入不受支持，`input_image` 甚至可能被静默替换成占位文本；Anthropic 兼容层也明确把 `image`、`document` 标为不支持。官网产品或发布宣传中的“文件上传/PDF”不能当作 API contract。CourseFlow 必须继续由既有文档解析/OCR 流水线生成带页码和来源证据的文本，再交给模型。[Responses API Guide](https://api-docs.deepseek.com/guides/responses_api/)（访问：2026-08-13）；[Anthropic API Guide](https://api-docs.deepseek.com/guides/anthropic_api/)（访问：2026-08-13）
5. **支持流式输出、JSON、JSON Schema 结构化输出与工具调用，但各自有边界。** ChatCompletions 的 JSON Output 只保证合法 JSON，官方承认偶尔会返回空内容；Responses API 另支持 `json_schema`；严格工具参数模式仍是 Beta 且只支持 JSON Schema 子集。无论使用哪条接口，都必须在 CourseFlow 边界再次做 Zod/领域校验，模型输出或 tool arguments 不能直接写正式数据。[JSON Output](https://api-docs.deepseek.com/guides/json_mode/)（访问：2026-08-13）；[Responses API](https://api-docs.deepseek.com/api/create-response/)（访问：2026-08-13）；[Tool Calls](https://api-docs.deepseek.com/guides/tool_calls/)（访问：2026-08-13）
6. **公开资料不足以承诺 API 输入“零留存/不训练”。** Responses API 的“stateless”只表示不保存可续接的 response/conversation 对象；DeepSeek 的磁盘上下文缓存默认开启，闲置缓存通常数小时到数天后清除。开放平台条款要求下游开发者自行披露和取得个人信息处理依据；通用隐私政策还说明数据在中国境内处理，并保留训练/优化用途及退出权。正式采用前需另行确认适用于 API 的数据处理条款、训练退出方式和保留期限，不能把 `store: false` 当作零留存保证。[Responses API](https://api-docs.deepseek.com/api/create-response/)（访问：2026-08-13）；[Context Caching](https://api-docs.deepseek.com/guides/kv_cache/)（访问：2026-08-13）；[Open Platform Terms](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html)（访问：2026-08-13）；[Privacy Policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html)（访问：2026-08-13）
7. **CourseFlow 当前不能判定 AI 可生产上线。** 文本能力形状允许继续做隔离 contract 和 fake，但真实 key 评测、质量/延迟/费用和下游数据条款尚未通过。最终未通过或仍未验证时必须发布纯手工版本，而不是更换模型或隐藏后保留 AI。

## 2. 已确认能力

### 2.1 模型、上下文与推理

| 项目 | 已确认事实 | 对 P3 的含义 |
| --- | --- | --- |
| 模型标识 | `deepseek-v4-pro`、`deepseek-v4-flash`；当前展示名称为 `DeepSeek-V4-Pro`。[官方模型页](https://api-docs.deepseek.com/quick_start/pricing/)（访问：2026-08-13） | 默认目标可配置为 `deepseek-v4-pro`，但不得把展示名称当成可固定调用的 snapshot。 |
| 旧标识 | `deepseek-chat`、`deepseek-reasoner` 已计划于 2026-07-24 退役；迁移期曾分别映射到 V4-Flash 的非思考/思考模式。[官方变更日志](https://api-docs.deepseek.com/updates/)（访问：2026-08-13） | 新设计不得继续使用旧标识，也不得把 `deepseek-reasoner` 当成 V4-Pro。 |
| 上下文/输出 | 两个 V4 API 模型均列为 1M 上下文、最高 384K 输出。[官方模型页](https://api-docs.deepseek.com/quick_start/pricing/)（访问：2026-08-13） | 足以接收压缩后的学期计划快照，但仍应做范围查询、token 预算和较小输出上限，避免把整库/整份文档无差别发送。 |
| 推理模式 | 默认开启思考；可关闭；可选 `low`、`high`、`max`。思考模式下 temperature/top_p 等采样参数无效。[Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)（访问：2026-08-13） | 普通问答/摘要优先低或关闭思考；跨课程规划、复杂取舍再使用 `high`，避免把最大推理当默认。 |
| 多轮推理 | 无工具调用的轮次可忽略旧 `reasoning_content`；含工具调用的思考轮次必须把它完整传回，否则会返回 400。[Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)（访问：2026-08-13） | 对话编排器必须区分普通轮次和 tool loop；不要把 CoT 作为用户可编辑的正式记录。 |

### 2.2 接口与兼容性

DeepSeek 提供三条相关接口面：OpenAI ChatCompletions、OpenAI Responses 和 Anthropic Messages；OpenAI 格式基础 URL 是 `https://api.deepseek.com`，Anthropic 格式是 `https://api.deepseek.com/anthropic`。[Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/)（访问：2026-08-13）

- **ChatCompletions**：文本消息、思考模式、JSON Output、function tools 与 SSE 流式输出均有正式 API contract；流以 `data: [DONE]` 结束。[Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/)（访问：2026-08-13）
- **Responses**：支持文本、JSON Schema、function、服务端 `web_search` 和语义 SSE 事件；流以 `response.completed`、`response.incomplete` 或 `response.failed` 结束，不发送 `[DONE]`。[Responses API Guide](https://api-docs.deepseek.com/guides/responses_api/)（访问：2026-08-13）
- **Responses 是部分兼容，不是 OpenAI 的完全替代品**：`previous_response_id`、`conversation`、`background`、`metadata`、`include` 等不支持；超过上下文不做自动截断而是 400；某些不支持参数会被静默忽略。[Responses API Guide](https://api-docs.deepseek.com/guides/responses_api/)（访问：2026-08-13）
- **Anthropic 也是部分兼容**：图片/文档/MCP/code execution 不支持；传入不支持的模型名时，后端会自动映射到 `deepseek-v4-flash`。[Anthropic API Guide](https://api-docs.deepseek.com/guides/anthropic_api/)（访问：2026-08-13）

因此，P3 可以复用 OpenAI SDK 的 transport 形状，但必须有独立 DeepSeek adapter 和 capability tests；不能仅更换 `baseURL` 就假定语义等价。若采用 Anthropic 兼容层，还必须核对响应实际模型，避免请求 V4-Pro 却静默落到 Flash。

### 2.3 结构化输出与工具调用

- **不要把三种能力混为一谈。** ChatCompletions 的 `json_object` 不是 JSON Schema strict，只保证内容是合法 JSON；Responses 的 `text.format.type=json_schema` 才是按给定 schema 的结构化输出；ChatCompletions 的 `tools[].function.strict=true` 则只约束工具参数，而且仍是 `/beta` 能力。
- ChatCompletions 的 `response_format: {"type":"json_object"}` 保证输出是合法 JSON 字符串，但提示中仍必须明确要求 JSON 并给示例；官方明确记录了偶发空 `content` 和被 token 上限截断的风险。[JSON Output](https://api-docs.deepseek.com/guides/json_mode/)（访问：2026-08-13）
- Responses 的 `text.format` 支持 `text`、`json_object` 和 `json_schema`，后者要求给出名称与 schema。[Responses API](https://api-docs.deepseek.com/api/create-response/)（访问：2026-08-13）
- Responses 的顶层 `status` 只有 `in_progress/completed/incomplete/failed`；不完整原因包括 `max_output_tokens/content_filter`。响应保证 `id` 和 `model`，但该 Responses schema 未定义 `system_fingerprint`。adapter 必须只接受完成态并记录 `id/model`，不能把 ChatCompletions 字段强加给 Responses。[Responses API](https://api-docs.deepseek.com/api/create-response/)（访问：2026-08-13）
- ChatCompletions 最多可声明 128 个 function tools，支持 `none`、`auto`、`required` 或指定函数；普通模式下生成的 arguments 仍可能是非法 JSON或虚构参数，官方要求调用方校验。[Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/)（访问：2026-08-13）
- `strict: true` 工具参数是 Beta，必须走 `/beta`，支持 `object`、`string`、`number`、`integer`、`boolean`、`array`、`enum`、`anyOf` 等子集；对象字段全部 required 且 `additionalProperties: false`，部分字符串/数组约束不支持。[Tool Calls](https://api-docs.deepseek.com/guides/tool_calls/)（访问：2026-08-13）
- Responses 还支持服务端 `web_search`，但 location/context-size 参数会被忽略；这不应成为 P3 首版读取课程事实的默认路径。[Responses API Guide](https://api-docs.deepseek.com/guides/responses_api/)（访问：2026-08-13）

### 2.4 文件、图片、PDF 与多模态

**可依赖的 API 输入只有文本。** Responses 的 `message` 支持字符串或 text part，图片和文件不支持；Anthropic 兼容表也明确不支持 `image` 与 `document`。官方发布文章展示模型生成 PDF、或网页产品支持上传，不等于 API 能接收 PDF/图片。[Responses API Guide](https://api-docs.deepseek.com/guides/responses_api/)（访问：2026-08-13）；[Anthropic API Guide](https://api-docs.deepseek.com/guides/anthropic_api/)（访问：2026-08-13）

对 CourseFlow 的正确接法是：`Source Document -> 文档解析/OCR adapter -> 页级文本/坐标 -> DeepSeek 文本调用 -> Candidate + Evidence -> 用户审核`。个人 AI 助手若要讨论资料，也只能读取已解析的、经过权限过滤的文本投影；不能绕过 ingestion seam 把对象存储 URL 或原始 PDF 直接交给模型。

### 2.5 流式、错误、限流与缓存

- V4-Pro 官方账户级并发上限为 500；超出返回 429。`user_id` 可用于内容安全、KV cache 和调度隔离，但不得包含隐私信息。[Rate Limit & Isolation](https://api-docs.deepseek.com/quick_start/rate_limit/)（访问：2026-08-13）
- 排队期间非流式连接可能收到空行，流式连接可能收到 SSE `: keep-alive`；若 10 分钟仍未开始推理，服务端关闭连接。[Rate Limit & Isolation](https://api-docs.deepseek.com/quick_start/rate_limit/)（访问：2026-08-13）
- 官方错误表列出 400（格式）、401（认证）、402（余额）、422（参数）、429（限流）、500（服务错误）、503（过载）。500/503 可短暂等待后重试；请求、认证、余额和参数问题不应盲目重试。[Error Codes](https://api-docs.deepseek.com/quick_start/error_codes/)（访问：2026-08-13）
- ChatCompletions 的 `finish_reason` 还可能是 `length`、`content_filter`、`tool_calls` 或 `insufficient_system_resource`；P3 不能把 HTTP 200 等同于完整可用结果。[Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/)（访问：2026-08-13）
- 磁盘上下文缓存默认启用；命中是 best effort，闲置缓存通常数小时到数天清除，并在 usage 中返回 hit/miss tokens。[Context Caching](https://api-docs.deepseek.com/guides/kv_cache/)（访问：2026-08-13）

若门禁通过，P3 UI 至少需要 `generating`、`complete`、`cancelled`、`truncated`、`content-filtered`、`invalid-key`、`insufficient-balance`、`rate-limited`、`provider-unavailable` 状态；结构化 JSON 在服务端完整缓冲和校验后才展示，SSE 只用于连接进度/取消。重试必须有次数上限、指数退避与幂等边界。

### 2.6 数据安全与开放平台义务

- DeepSeek 明确要求 API key 不得泄露、共享、公开，也不得暴露在浏览器或其他客户端代码中。[Open Platform Terms §2.2](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html)（访问：2026-08-13）
- 下游开发者负责向最终用户披露个人信息处理规则、取得同意或其他合法依据，并建立用户管理、数据安全、监控与应急措施。[Open Platform Terms §3.2–3.4](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html)（访问：2026-08-13）
- DeepSeek 要求明确告知最终用户内容由 AI 生成、可能有错误或遗漏，且不应成为医疗、法律、金融等行动依据。[Open Platform Terms §8.1](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html)（访问：2026-08-13）
- 通用隐私政策说明输入可能用于训练/优化并提供退出权，个人数据直接在中华人民共和国境内收集、处理和存储；同时它明确说，下游应用最终用户的数据处理规则不由该通用政策覆盖，而由开发者披露。[Privacy Policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html)（访问：2026-08-13）

## 3. 未知或不可依赖的能力

| 不可依赖项 | 原因 | P3 决策 |
| --- | --- | --- |
| V4-Pro 已稳定 GA | 当前模型页列出 API，但最近变更日志仍把正式发布描述为后续事件。[Change Log](https://api-docs.deepseek.com/updates/)（访问：2026-08-13） | 写成“目标模型/当前 API 标识”，不要写成不可变平台承诺。 |
| 可调用固定日期 snapshot | 官方请求枚举只列 `deepseek-v4-pro`/`deepseek-v4-flash`。[Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/)（访问：2026-08-13） | 配置别名、记录 Responses `id`/实际 `model`、建立离线评测；门禁失败就纯手工。 |
| 原生 PDF/图片/文件理解 | API 兼容表明确不支持；占位替换可能不报错。[Responses API Guide](https://api-docs.deepseek.com/guides/responses_api/)（访问：2026-08-13） | 始终使用现有 parser/OCR；对空/占位输入做集成测试。 |
| JSON Output 等于 schema 正确 | JSON 模式只保证合法 JSON，且可能为空/截断。[JSON Output](https://api-docs.deepseek.com/guides/json_mode/)（访问：2026-08-13） | Zod + 领域规则校验；失败可重试但不落正式数据。 |
| Tool Call 等于已授权动作 | 非 strict 参数可能非法/幻觉；strict 又是 Beta 子集。[Tool Calls](https://api-docs.deepseek.com/guides/tool_calls/)（访问：2026-08-13） | tool call 只形成提案；鉴权、所有权、并发版本和最终确认由服务器完成。 |
| Responses API 有服务端会话状态 | `previous_response_id`/`conversation` 不支持，API 是 stateless。[Responses API Guide](https://api-docs.deepseek.com/guides/responses_api/)（访问：2026-08-13） | CourseFlow 自管最小对话历史、删除和过期策略，不存 CoT 作为业务数据。 |
| `store:false` 等于零留存/不训练 | 默认磁盘缓存与通用隐私条款均否定这种推断。[Context Caching](https://api-docs.deepseek.com/guides/kv_cache/)（访问：2026-08-13）；[Privacy Policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html)（访问：2026-08-13） | 未取得 API 专属数据条款前，不发送敏感个人资料、原始文档或不必要的历史。 |
| 1M/384K 等于实际延迟与成本 SLA | 官方只给容量上限、动态价格和并发上限，没有 P3 场景延迟 SLA。[Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/)（访问：2026-08-13） | 建立自己的 token、延迟、成本预算和超时；默认只发送有界 snapshot。 |
| Web Search 结果可直接成为课程事实 | API 支持搜索，但模型输出仍可能错误，且搜索可能触及第三方处理。[Responses API Guide](https://api-docs.deepseek.com/guides/responses_api/)（访问：2026-08-13）；[Privacy Policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html)（访问：2026-08-13） | P3 首版关闭；以后仅显式触发并显示来源，不替代 Source Document/Evidence。 |

## 4. 对 CourseFlow P3 的功能设计含义

### 4.1 建议纳入的首版能力

个人页面中的 AI 应是“基于已确认课程数据的规划助手”，不是第二套课程真相。建议按风险从低到高提供：

1. **计划问答与解释**：回答“我今天先做什么”“本周哪里最忙”，输入仅来自经授权的 `ScheduleSnapshot`、任务投影和已确认成绩数据；答案引用具体 Course/ Course Item 标识和日期。
2. **周计划/日计划草案**：根据确定日期、用户进度和 Workload Estimate 生成时间块建议，并显式列出假设、冲突和未知信息。结果只存在于对话或 proposal，不自动创建/改写 Course Item。
3. **任务拆解候选**：把一个正式 Course Item 拆成建议步骤、顺序与工作量；持久化前逐项让用户确认。AI 推断的 workload 必须标记来源为 AI 建议，不能伪装成 Source Document 事实。
4. **风险与冲突解释**：冲突、截止密度、当前成绩和情景计算先由 `packages/core` 的确定性 query/calculator 得出，AI 只负责解释和比较取舍；未知成绩保持未知，不按 0 分。
5. **自然语言变更提案**：用户可说“把周五前的任务按两晚拆开”。模型通过结构化输出或 tool call 生成带版本的 proposed command；服务器重新校验所有权、日期、领域规则和并发版本，UI 展示 diff，用户明确确认后才调用公开写 interface。

适合暴露给模型的 conceptual tools 应少而窄，例如：读取学期摘要、按范围读取 Course Item、读取 schedule conflict、调用确定性成绩情景计算、创建变更提案。不要暴露数据库 CRUD、对象存储、任意 SQL、自动审核候选或直接写正式数据的 tool。

### 4.2 首版不纳入

- 个人助手直接上传/理解 PDF、图片；它们继续走 ingestion + review 流水线。
- 自动接受 Candidate、自动把抽取结果写入正式课程记录。
- 无确认地修改、完成、删除 Course Item 或成绩结果。
- 使用模型自行计算成绩、日期展开、Reading Week、时区或冲突真相。
- 默认联网搜索课程要求，或把外部搜索结果当 Evidence。
- 长期保存或向用户展示模型原始 Chain of Thought；只展示简洁理由、所用正式数据和不确定性。

### 4.3 个人页面 API key 输入框

本研究按“输入框用于用户提供自己的 DeepSeek API key”理解：

- 未配置 key：显示“AI 功能暂不可用，请先配置 DeepSeek API key”，AI 入口保持禁用；这不是普通对话错误。
- 保存时可由服务端以 Bearer key 调用 `GET /models` 作低成本验证：200 且列表含 `deepseek-v4-pro` 表示凭据可认证并且当前账户可见该模型；401 表示 key 无效。这个检查**不能**证明余额充足、推理配额可用或后续生成一定成功，402/429/5xx 仍需在实际调用时处理。[DeepSeek API Authentication](https://api-docs.deepseek.com/api/deepseek-api/)（访问：2026-08-13）；[Lists Models](https://api-docs.deepseek.com/api/list-models/)（访问：2026-08-13）；[Error Codes](https://api-docs.deepseek.com/quick_start/error_codes/)（访问：2026-08-13）
- 已配置但无效/余额不足：分别映射 401 与 402，不要笼统显示模型故障。[Error Codes](https://api-docs.deepseek.com/quick_start/error_codes/)（访问：2026-08-13）
- key 只通过 HTTPS 提交到 CourseFlow 服务端，服务端加密保存或采用等价 secret storage；只显示掩码、最后验证时间和撤销/替换操作。浏览器不得直接持 key 调用 DeepSeek，日志、trace、错误上报和 client bundle 不得包含 key。[Open Platform Terms §2.2](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html)（访问：2026-08-13）
- 调用前显示简短数据说明：哪些课程数据会发送给 DeepSeek、用于什么目的、如何删除 CourseFlow 对话历史；正式上线前补齐适用的跨境/个人信息处理评估。

若产品实际想让 CourseFlow 使用平台统一 key，而不是用户 BYOK，则上述输入框不应收集 API key，需要在需求中另行定义配额、计费、滥用防护和账户级并发；不能在实现阶段默默切换两种模式。

## 5. 建议的验收护栏

1. 启动或健康检查能够识别 `deepseek-v4-pro`，并记录实际响应模型；模型变化触发能力评测而非静默接受。
2. 对 Responses/ChatCompletions 分别有流式解析测试，包括 keep-alive、正常完成、截断、失败和用户取消。
3. 对 JSON 空内容、非法 schema、`finish_reason=length`、tool arguments 幻觉和上下文 400 有 contract tests。
4. 所有写操作均可证明经过“模型提案 -> 服务端校验 -> 用户确认 -> 公开 module interface”，模型或 adapter 没有直写正式表的路径。
5. PDF/图片输入测试必须失败得清楚，不能把占位文本当成功分析。
6. 401、402、422、429、500、503 在 UI 和重试策略中分类；只有可恢复的提供商错误进入有限重试。
7. 日志只记录 provider、模型、token、延迟、finish reason、trace/request ID 和脱敏错误；不记录 key、完整 prompt、完整课程快照或原始 CoT。
8. 上线前完成人工红队与 fixture eval：日期/时区、未知成绩、Reading Week、跨课程冲突、候选未审核、越权课程、提示注入和工具参数篡改。

## 6. 采用前仍需向 DeepSeek 或合同材料确认

公开第一方资料截至核验日没有给出足以让 CourseFlow 作硬承诺的以下信息：API 输入/输出的精确保留期、API 数据是否默认用于训练及 API 专属退出方式、企业级 DPA/子处理者清单、数据驻留选择、可用性/延迟 SLA、V4-Pro 的明确 GA 生命周期与可固定 snapshot 标识。在这些问题得到书面答案前，产品状态保持 `AI_PENDING`：只允许最小数据、可撤回 BYOK 方案、关闭默认 web search、隔离 DeepSeek adapter 和不发送敏感 Source Document。最终评审仍无书面结论时必须执行 `MANUAL_ONLY`，删除 AI 功能且不换 provider。

## 7. 当前门禁结论

截至本次核验：官方文本/Responses/JSON Schema 能力为“可继续验证”；原生 PDF/图片输入为“不支持”；真实 CourseFlow corpus、真实账户错误/延迟/费用为“未验证”；API 专属保留、训练使用/退出、DPA/数据驻留为“未确认”。因此当前结论是 `AI_PENDING`，不是 `AI_GO`。详细去留规则见 [AI 助手架构](../architecture/AI_ASSISTANT.md#3-deepseek-ai-去留门禁)。
