# DeepSeek P4 第一方能力与数据条款核验

> 状态：P4 外部研究记录；不是产品上线批准、法律意见或真实 API 评测结果
>
> 核验日期：2026-08-14（Asia/Shanghai）
>
> 资料范围：仅使用 DeepSeek 官方 API 文档、官方服务状态页、官方隐私政策、官方开放平台服务协议、官方用户协议和官方模型训练说明。未使用、读取或传递任何 API key，也未发起付费模型调用。
>
> 判定规则：`VERIFIED` 表示当前公开第一方材料直接支持；`UNVERIFIED` 表示第一方公开材料不足以作出所需承诺，不能用推断补齐。这里的 VERIFIED 只核验公开 contract，不证明真实账户/运行时已通过；价格、模型版本、条款与服务状态均会变化，正式门禁应保存访问日期并在签署时复核。

## 1. 门禁摘要

| 门禁问题 | 结论 | P4 含义 |
| --- | --- | --- |
| 官方 OpenAI-format base endpoint | **VERIFIED：`https://api.deepseek.com`**；Responses 路径是 `POST /responses`。[Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/)；[Responses API](https://api-docs.deepseek.com/api/create-response/) | live adapter 可固定为 `https://api.deepseek.com/responses`，不能接受用户自定义 base URL。 |
| `deepseek-v4-pro` 是否存在/支持 | **VERIFIED：存在并受支持。** 官方模型列表返回该 ID；Responses 请求枚举也包含它。2026-08-14 的价格页展示当前模型版本 `DeepSeek-V4-Pro-0813`。[Lists Models](https://api-docs.deepseek.com/api/list-models/)；[Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/) | 请求仍使用动态 alias `deepseek-v4-pro`；记录响应 `model` 并在 alias/version 改变时重跑 eval。不要把 alias 当不可变 snapshot。 |
| Responses JSON Schema | **VERIFIED：支持。** `text.format.type=json_schema`，并要求 `name` 与 `schema`；输出宣称符合给定 JSON Schema。[Responses API](https://api-docs.deepseek.com/api/create-response/) | 仍须本地 JSON parse、同版本 schema/Zod、Evidence/citation 与领域校验；供应商结构成功不等于事实正确。 |
| 禁用 tools/web | **VERIFIED：可通过 `tools: []` 与 `tool_choice: "none"` 禁用。** Responses 的默认 `tool_choice` 是 `auto`；服务端 `web_search` 只有声明为 tool 后才能执行。[Responses API](https://api-docs.deepseek.com/api/create-response/)；[Using the Responses API](https://api-docs.deepseek.com/guides/responses_api/) | 两个字段都应由正向 allowlist builder 显式固定，并拒绝返回的 `function_call`/`web_search_call`。 |
| non-streaming | **VERIFIED：`stream` 可控。** `true` 才返回 SSE；因此显式 `stream:false` 得到一次性 JSON。[Responses API](https://api-docs.deepseek.com/api/create-response/) | P4 可检查实际请求为 `stream:false`，完整缓冲后再校验。非流式排队期间可能夹带空行，HTTP parser 要容忍。[Rate Limit & Isolation](https://api-docs.deepseek.com/quick_start/rate_limit/) |
| 预算与 usage | **VERIFIED：可设 `max_output_tokens`，响应返回 input/output/total、cached 与 reasoning token 明细。** 上限同时计可见输出和推理 token。[Responses API](https://api-docs.deepseek.com/api/create-response/) | 应固定 `reasoning.effort:"none"` 和应用侧输入预算；逐请求保存非敏感 token/费用指标，不保存正文或 CoT。 |
| HTTP/终态错误 contract | **VERIFIED（公开范围内）。** HTTP 文档列 400/401/402/422/429/500/503；Responses 另有 `completed/incomplete/failed`，`incomplete` 原因为 `max_output_tokens` 或 `content_filter`。[Error Codes](https://api-docs.deepseek.com/quick_start/error_codes/)；[Responses API](https://api-docs.deepseek.com/api/create-response/) | HTTP 200 不是成功充分条件；只接受 `completed` 和预期唯一 `message/output_text`，其他终态安全失败。错误体 `code/message` 的稳定枚举、请求 ID header、`Retry-After` 保证均 **UNVERIFIED**。 |
| API 下游数据精确保留期 | **UNVERIFIED。** Responses “stateless”只表示不保存可续接的 response/conversation；Context Caching 默认把前缀写入硬盘，闲置后通常数小时至数天清除；通用隐私政策对 Input 的保留按目的/账户期决定，而非给出 API 下游数据固定期限。[Responses API](https://api-docs.deepseek.com/api/create-response/)；[Context Caching](https://api-docs.deepseek.com/guides/kv_cache/)；[Privacy Policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html) | 不能把 `store:false` 宣传为零留存；若门禁要求书面固定期限，公开材料不通过。 |
| API 下游数据不用于训练/账户级退出 | **UNVERIFIED。** 通用政策允许用 Personal Data（含 User Input）训练/优化，并给“你的 Personal Data”退出权；训练说明称少量用户输入可能用于优化训练。开放平台条款又明确下游最终用户数据不由该隐私政策覆盖。未找到 API 账户级、可验证且覆盖所有下游 Input 的 opt-out contract。[Privacy Policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html)；[Model Mechanism and Training Methods](https://cdn.deepseek.com/policies/en-US/model-algorithm-disclosure.html)；[Open Platform Terms](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html) | 不能承诺“不训练”；普通 privacy email/设置退出不能自动推导为 API 下游输入已退出。若该承诺为硬门禁，公开材料不通过。 |
| 处理地域 | **VERIFIED（通用政策）：直接在中华人民共和国收集、处理和存储 Personal Data。** [Privacy Policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html) | 下游披露和跨境评估必须明确中国处理/存储；是否可选其他 region、具体机房与子处理者地点 **UNVERIFIED**。 |
| 公开 DPA / API 数据处理附录 | **UNVERIFIED。** 在官方 API 文档 sitemap、当前开放平台条款及其直接链接的政策中未找到面向开发者签署的 DPA、SCC、子处理者清单或数据驻留附件；条款仅要求开发者拥有委托处理的合法依据，并在权利请求时联系 DeepSeek。[Open Platform Terms](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html) | 不能把通用隐私政策当 DPA。若 P4 要求 DPA/处理者承诺，须由 `api-service@deepseek.com` 提供并由责任人审核；拿不到即 `UNVERIFIED`。 |
| 下游披露与人工审核 | **VERIFIED：开发者必须披露个人信息处理规则、取得同意或其他合法依据、响应数据权利请求，并清楚告知输出由 AI 生成且可能错误。** 教育等可能对自然人有重大影响的输出应人工审核。[Open Platform Terms](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html)；[Terms of Use](https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html) | CourseFlow 的发送前披露、用户审核、撤销/删除路径和 AI 标识不是可选项。 |

**外部研究结论：公开第一方资料足以验证所需请求 contract 存在，但不足以验证 P4 所要求的 API 下游数据保留、训练退出和 DPA。若这些是硬门禁且评审时仍无另行书面合同材料，相关项必须记为 `UNVERIFIED`，不能签署 `AI_GO`。** 本记录本身不替代真实 extraction/assistant eval、安全红队或最终签署。

### 1.1 “官方索引只有 Chat Completions”冲突核验

仓库在 P4 前提出一个必须消解的冲突：官方 quick-start 首页的示例确实只演示 `POST /chat/completions`，而 Chat Completions 的结构化输出 contract 只允许 `response_format.type=text|json_object`，不提供 `json_schema`。[Your First API Call](https://api-docs.deepseek.com/)；[Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/)

但截至本次访问，这**不等于官方当前只支持 Chat Completions**，原因有四项可直接核验的第一方证据：

1. 同一个官方站点首页导航已有 [Using the Responses API](https://api-docs.deepseek.com/guides/responses_api/)；
2. 官方 API Reference 直接提供 [Responses API](https://api-docs.deepseek.com/api/create-response/) 页面，明确列出 `POST /responses`；
3. 该页面的 `model` 枚举含 `deepseek-v4-pro`，`text.format.type` 枚举含 `json_schema`，并定义必需的 `name` 与 `schema`；
4. 当前 [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/) 功能矩阵已把 Responses API 标为 V4-Pro/Flash 均支持。

因此，冲突在**当前公开文档层面已消解**：quick-start 示例滞后/窄于完整 API Reference，不能用首页示例否定独立 Responses contract。P3 冻结的 `POST /responses + text.format.json_schema` 当前为 **VERIFIED**，不是 `UNVERIFIED`。

不过必须保留两条门禁限制：

- 如果真实受保护 smoke 对相同冻结 request 返回 404、422“不支持字段”或实际只接受 Chat Completions，则运行时能力失败，不能以网页 contract 覆盖真实结果；
- 若最终不得不退回 `/chat/completions`，它只有 `json_object`，不满足 P3 冻结的 JSON Schema contract。不能在第一次真实调用后把接口/schema 改成 Chat Completions 来争取通过，应该按冻结门禁失败处理。

## 2. API 与模型 contract

### 2.1 Endpoint、模型与版本语义

- OpenAI 格式官方 base URL 是 `https://api.deepseek.com`；Anthropic 兼容格式另为 `https://api.deepseek.com/anthropic`。CourseFlow 计划使用的 Responses API 是 OpenAI 格式的 `POST /responses`。[Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/)；[Responses API](https://api-docs.deepseek.com/api/create-response/)
- `GET /models` 的官方示例列出 `deepseek-v4-flash` 与 `deepseek-v4-pro`；Responses API 的 `model` 枚举也列出两者。[Lists Models](https://api-docs.deepseek.com/api/list-models/)；[Responses API](https://api-docs.deepseek.com/api/create-response/)
- 2026-08-14 访问的价格页显示 `deepseek-v4-pro` 当前模型版本为 `DeepSeek-V4-Pro-0813`，上下文为 1M，最大输出为 384K；官方同时保留调整服务与价格的权利。[Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/)；[Open Platform Terms §1.3](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html)
- **推论（明确标记）：** 可调用 alias 与当前显示版本不是同一个稳定性承诺。实际调用必须核对响应 `model` 并把供应商变化视为重新评测触发器；官方未提供可在请求中锁定 `DeepSeek-V4-Pro-0813` 的日期快照 ID。

### 2.2 JSON Schema 与本地验证边界

Responses 的 `text.format` 支持 `text`、`json_object`、`json_schema`。`json_schema` 需要 schema `name` 和 JSON Schema object，官方描述为输出符合给定 schema。[Responses API](https://api-docs.deepseek.com/api/create-response/)

仍需保留以下本地校验，因为这些不由 JSON Schema 能力证明：

1. Evidence quote 是否能在允许的页级文本/locator 中回查；
2. citation ID 是否属于本次输入 allowlist；
3. 日期、课程时区、成绩基点、未知值和目标 version 是否符合 CourseFlow 领域规则；
4. 是否含多个 message、工具/搜索输出、空文本或意外字段；
5. 模型抽取的事实 precision/recall。

Chat Completions 的 `response_format:{"type":"json_object"}` 只是合法 JSON 模式，官方还明确记录偶发空内容和 token 截断风险；不能用它替代 Responses JSON Schema 或本地验证。[JSON Output](https://api-docs.deepseek.com/guides/json_mode/)

### 2.3 Tools、web 与 streaming 的控制

- Responses 支持 function 和服务端 `web_search`；`tool_choice` 默认是 `auto`，`none` 表示只生成消息而不调用工具。[Responses API](https://api-docs.deepseek.com/api/create-response/)
- `tools:[]` 加 `tool_choice:"none"` 是当前公开 contract 支持的关闭方式。P4 应同时检查出站 body 和入站 output item，防止 builder 漏字段或供应商异常返回工具项。
- `stream:false` 为非流式 JSON；`stream:true` 才返回语义 SSE，最终事件是 `response.completed`、`response.incomplete` 或 `response.failed`，没有 `[DONE]`。[Responses API](https://api-docs.deepseek.com/api/create-response/)
- 非流式请求排队期间官方可能连续返回空行；若 10 分钟仍未开始推理，服务端关闭连接。[Rate Limit & Isolation](https://api-docs.deepseek.com/quick_start/rate_limit/)
- Responses 指南说明部分不支持参数会被静默忽略；因此应使用正向字段 allowlist，不能靠“发一个字段看看是否报错”证明安全。[Using the Responses API](https://api-docs.deepseek.com/guides/responses_api/)

### 2.4 推理模式与 CoT

Responses 的 `reasoning.effort:"none"` 关闭思考模式；未指定时默认启用。`max_output_tokens` 同时计入可见输出 token 与 reasoning token。思考模式会把明文 chain-of-thought 作为 `reasoning` item 返回。[Responses API](https://api-docs.deepseek.com/api/create-response/)

因此门禁应显式固定 `reasoning.effort:"none"`，并让 adapter 只抽取预期 `message/output_text`，不记录或展示 `reasoning`。官方能够关闭思考模式不等于供应商证明“从不做内部推理”；本门禁只验证不请求、不接收、不持久化公开 CoT。

## 3. Usage、费用、错误与服务状态

### 3.1 Token 与费用

Responses 返回：

- `usage.input_tokens`；
- `usage.input_tokens_details.cached_tokens`；
- `usage.output_tokens`；
- `usage.output_tokens_details.reasoning_tokens`；
- `usage.total_tokens`。[Responses API](https://api-docs.deepseek.com/api/create-response/)

官方说明实际 token 用量以响应 `usage` 为准。[Token & Token Usage](https://api-docs.deepseek.com/quick_start/token_usage/)

截至 2026-08-14，`deepseek-v4-pro` 当前美元单价为每 1M token：缓存命中输入 `$0.003625`、缓存未命中输入 `$0.435`、输出 `$0.87`。官方已公告 2026-08-16 16:00 UTC 起改为峰谷定价：非高峰 `$0.022 / $0.66 / $1.98`，高峰 `$0.044 / $1.32 / $3.96`（依次为 cache hit input / cache miss input / output）。中文版对应 2026-08-17 00:00 北京时间起，非高峰 `¥0.15 / ¥4.5 / ¥13.5`，高峰 `¥0.30 / ¥9 / ¥27`。[Models & Pricing (USD)](https://api-docs.deepseek.com/quick_start/pricing/)；[模型与价格 (CNY)](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)

P4 报告必须注明调用发生时间、采用币种和当时价格版本；不能用评测前或变价后的价格回填。对于 Responses，成本至少按：

```text
cache_hit_input_tokens × hit_rate
+ (input_tokens - cache_hit_input_tokens) × miss_rate
+ output_tokens × output_rate
```

官方 usage 没有在 Responses schema 中单独给 `cache_miss_tokens`；可由总输入减 cached 推导。该推导应在报告中标明。

### 3.2 HTTP 与终态错误

官方错误页公开：400 格式错误、401 认证失败、402 余额不足、422 参数错误、429 限速、500 服务端错误、503 过载。[Error Codes](https://api-docs.deepseek.com/quick_start/error_codes/)

Responses 对 HTTP 200 内部还定义：

- `completed`；
- `incomplete`，原因是 `max_output_tokens` 或 `content_filter`；
- `failed`，含 `error.code` 和 `error.message`；
- `in_progress`。[Responses API](https://api-docs.deepseek.com/api/create-response/)

以下公开保证未找到，均为 **UNVERIFIED**：完整稳定的 `error.code` 枚举、统一 JSON error envelope、供应商 request/trace ID header、`Retry-After` 必然存在、429 的精确恢复窗口。adapter 应保留未知错误兜底，不能把 message 文案当稳定枚举。

### 3.3 状态页

官方状态页为 [status.deepseek.com](https://status.deepseek.com/)，按 API Service 与 Web Chat Service 分组件展示实时状态、90 天 uptime 与事故历史。状态页能作为运行时佐证，但开放平台条款明确服务按“现状/可用”提供，不保证不间断、及时或无错误。[DeepSeek Service Status](https://status.deepseek.com/)；[Open Platform Terms §7.4](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html)

状态页历史 uptime 不能替代 CourseFlow 自己的 p50/p95、终态失败率、超时与恢复测试；也没有公开 P4 场景 SLA。

## 4. 数据保留、训练、地域与 DPA

### 4.1 “Stateless”不等于零留存

Responses 文档称 API 无状态：服务器不保存可通过 `previous_response_id` 或 conversation 续接的响应/会话，响应固定带 `store:false`。[Responses API](https://api-docs.deepseek.com/api/create-response/)；[Using the Responses API](https://api-docs.deepseek.com/guides/responses_api/)

但同一官方文档体系又说明 Context Caching on Disk 对所有 API 用户默认开启，每个请求会触发硬盘缓存构建；闲置 cache 通常在数小时至数天内自动清除。[Context Caching](https://api-docs.deepseek.com/guides/kv_cache/)

通用隐私政策将 prompt/input 列为收集的数据，并称 Input 在提供服务时可随账户保留，实际保留还取决于数据类别、敏感性、处理目的、法律义务、安全与索赔需要。[Privacy Policy §§What Personal Data We Collect, How Long Do We Keep](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html)

因此：

- “不保存 response object/conversation state”是 **VERIFIED**；
- “请求正文零留存”是 **UNVERIFIED**；
- “所有 API Input 最迟数天删除”是 **UNVERIFIED**，因为 cache 清理说明不能覆盖日志、安全审查、计费或其他保留；
- 请求是否可关闭 Context Cache 是 **UNVERIFIED**；Responses 的 `prompt_cache_retention` 不受支持且 cache 自动管理。[Using the Responses API](https://api-docs.deepseek.com/guides/responses_api/)

### 4.2 训练使用与退出

通用隐私政策写明 DeepSeek 可为开发、改进与训练模型/算法使用 Personal Data，包括 User Input；它也列出个人退出用其 Personal Data 训练/优化的权利，并提供 `privacy@deepseek.com`。[Privacy Policy §§How We Use, Your Rights](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html)

模型训练说明进一步称优化训练的一小部分问答数据可能基于用户输入，并称会加密、去标识/匿名化且提供退出权。[Model Mechanism and Training Methods](https://cdn.deepseek.com/policies/en-US/model-algorithm-disclosure.html)

然而开放平台条款和隐私政策都明确：开发者下游应用最终用户数据的处理规则不由 DeepSeek 通用隐私政策覆盖，开发者自己是控制者并负责披露。[Open Platform Terms §5.5](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html)；[Privacy Policy Introduction](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html)

公开材料没有直接回答：

1. API account/project/key 是否默认训练；
2. 如何为一个开发者账户统一退出下游所有 Input；
3. 退出是否覆盖非个人数据、历史 Input、cache、人工安全审查与所有模型优化用途；
4. 如何获得可审计的退出状态或生效时间。

以上均为 **UNVERIFIED**。不能将个人隐私权请求自动等同于 API 企业/开发者训练 opt-out contract。

### 4.3 处理地域与第三方

通用隐私政策明确，为提供服务，DeepSeek 直接在中华人民共和国收集、处理和存储 Personal Data；也可能使用集团实体和服务提供商处理数据。若启用搜索，会把关键词分享给第三方 API。[Privacy Policy §§How We Share, Where We Store](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html)

这支持以下结论：

- 中国处理和存储：**VERIFIED**；
- 可选择特定 region、欧盟/美国数据驻留：**UNVERIFIED**；
- 当前完整子处理者名称、地点、变更通知：**UNVERIFIED**；
- 禁用 CourseFlow 的 tools/web 能避免本请求主动触发 DeepSeek 内置 web search，但不能据此证明 DeepSeek 无其他服务提供商。

### 4.4 DPA 与下游责任

开放平台条款是 API 的专门协议，但不是一份公开的开发者 DPA。它要求开发者：

- 在提供公共下游服务前披露个人信息处理规则；
- 取得终端用户同意或其他合法依据，包括委托 DeepSeek 处理；
- 及时响应访问、复制、转移、更正、删除、保留等权利请求；
- 建立用户管理、数据安全、监控预警和应急措施；
- 对 Input 拥有所需权利、许可和权限。[Open Platform Terms §§3.2–4.1](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html)

官方公开入口中未找到可签署/下载且明确覆盖 API 下游数据的 DPA、SCC、子处理者附件、审计权、安全事件通知时限、删除/返还义务或角色分配。因此这些均为 **UNVERIFIED**，不能靠通用条款补足。官方给开放平台联系邮箱 `api-service@deepseek.com`；若产品要求这些承诺，应取得单独书面材料再由合规责任人审核。[Open Platform Terms §11.2](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html)

## 5. 必须呈现给 CourseFlow 下游用户的披露

根据第一方条款，若最终采用，至少应在发送前用易懂语言说明：

1. 这是可选 DeepSeek AI 功能，哪些课程正文/正式计划字段会发送，目的是什么；
2. 数据由 DeepSeek 在中国处理/存储，公开资料不能承诺零留存、不训练、可选地域或已签 DPA；
3. 用户有手工等价路径，可在提交前取消并可撤销自己的 key；
4. 输出由 AI 生成，可能错误或遗漏；Candidate 与 Planning Draft 不会自动成为正式课程记录；
5. 用户必须审核，尤其教育等可能对自然人有重大影响的输出；
6. CourseFlow 的本地保留/删除、访问、更正和投诉路径，以及需要 DeepSeek 协作时的处理方式；
7. key 只经服务端使用，不暴露于浏览器客户端代码。DeepSeek 条款也明确禁止把 API key 暴露在浏览器或其他客户端代码中。[Open Platform Terms §§2.2, 3.3, 8.1](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html)；[Terms of Use §5.4](https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html)

## 6. P4 可执行核验清单

### 6.1 真实调用前冻结证据

- 保存 `ai-eval-policy-v1`、corpus manifest/hash、样本数量与授权/去身份化说明；
- 保存所有 hard/quality/latency/cost 阈值和签署时间；
- 保存 extraction/assistant 的 prompt/schema/budget version 与内容 hash；
- 保存 adapter request allowlist 与 endpoint/model 常量的代码 commit；
- 保存本研究使用的官方 URL、访问日期和价格页版本；
- 不把 API key、正文、完整 prompt/context、供应商原始响应或 CoT写入上述证据。

### 6.2 每次受控请求应证明

- 实际 URL 为 `https://api.deepseek.com/responses`；
- `model:"deepseek-v4-pro"`，并记录非敏感响应 `model`；
- `reasoning:{effort:"none"}`；
- `stream:false`；
- `text.format.type:"json_schema"` 且 schema/name 与冻结版本 hash 一致；
- `tools:[]` 与 `tool_choice:"none"`；
- `max_output_tokens` 不超过对应冻结预算，估算输入不超过应用上限；
- body 不含 `previous_response_id`、`conversation`、`background`、`web_search` 或调用者自带 provider item；
- 只接受 `completed` + 唯一预期 output text；拒绝 reasoning/tool/web/多 message/空内容；
- 指标只记录 request purpose、版本/hash、非敏感 request/response ID（若返回）、model、终态、错误分类、延迟、token 和费用；不记录 key、正文或 CoT。

### 6.3 条款硬门禁

若 P4 政策要求“适用于下游用户的数据保留、训练使用/退出、处理地域、DPA/条款与披露全部已书面确认”，当前公开材料状态为：

| 项目 | 当前状态 |
| --- | --- |
| 处理地域（中国） | VERIFIED |
| 下游开发者披露、合法依据、权利响应、安全措施 | VERIFIED |
| AI 生成/可能错误披露与教育重大影响人工审核 | VERIFIED |
| API 下游 Input 的精确保留期限与删除 SLA | UNVERIFIED |
| API 账户级“不训练”或可审计 opt-out | UNVERIFIED |
| 适用于 CourseFlow 的 DPA/处理者附件 | UNVERIFIED |
| 子处理者清单、区域和变更通知 | UNVERIFIED |
| 可选数据驻留区域 | UNVERIFIED |

只要硬门禁把任一 `UNVERIFIED` 视为失败，就不能由本研究支持 `AI_GO`。需要另行合同材料时，应验证签约主体、适用服务、下游 Input 范围、历史数据、生效日、冲突条款优先级和责任人接受记录。

## 7. 第一方资料索引

- [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/)（访问：2026-08-14）
- [模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)（访问：2026-08-14）
- [Lists Models](https://api-docs.deepseek.com/api/list-models/)（访问：2026-08-14）
- [Responses API Reference](https://api-docs.deepseek.com/api/create-response/)（访问：2026-08-14）
- [Using the Responses API](https://api-docs.deepseek.com/guides/responses_api/)（访问：2026-08-14）
- [JSON Output](https://api-docs.deepseek.com/guides/json_mode/)（访问：2026-08-14）
- [Context Caching](https://api-docs.deepseek.com/guides/kv_cache/)（访问：2026-08-14）
- [Token & Token Usage](https://api-docs.deepseek.com/quick_start/token_usage/)（访问：2026-08-14）
- [Rate Limit & Isolation](https://api-docs.deepseek.com/quick_start/rate_limit/)（访问：2026-08-14）
- [Error Codes](https://api-docs.deepseek.com/quick_start/error_codes/)（访问：2026-08-14）
- [DeepSeek Service Status](https://status.deepseek.com/)（访问：2026-08-14）
- [DeepSeek Privacy Policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html)（最后更新：2026-02-10；访问：2026-08-14）
- [DeepSeek Open Platform Terms of Service](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html)（发布：2026-04-22；生效：2026-04-29；访问：2026-08-14）
- [DeepSeek Terms of Use](https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html)（最后更新：2026-03-27；访问：2026-08-14）
- [Model Mechanism and Training Methods of DeepSeek](https://cdn.deepseek.com/policies/en-US/model-algorithm-disclosure.html)（访问：2026-08-14）
