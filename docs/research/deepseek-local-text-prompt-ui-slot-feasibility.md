# DeepSeek 本地文本—提示词—UI 插槽方案可行性核验

核验日期：2026-08-13
资料范围：仅 DeepSeek 官方 API 文档；未使用真实 API Key，未发起模型调用。

本文所称“本地处理”是指**在 CourseFlow 控制的浏览器、web 或 worker 中、调用 DeepSeek 之前完成处理**，不等于“数据始终留在用户设备”。一旦把筛选后的文本放入 `/responses` 的 `input`，该文本就会发送给 DeepSeek。本文所称“UI 插槽”是只接收 CourseFlow view model 的预留组件，不是把供应商原始文本或 HTML 直接插入 DOM。

## 结论

**有条件可行，而且这是 CourseFlow 当前最合理的 DeepSeek 接入形态。** CourseFlow 可以先在本地把 PDF、syllabus 和截图处理成带页码/定位信息的纯文本，再用版本化固定提示词调用 DeepSeek Responses API，让模型按 JSON Schema 返回回答、引用与草稿，最后由服务端校验并把安全 view model 渲染到预留 UI 区域。

这只证明接口形态可实现，**不等于 `AI_GO`**。固定提示词和 JSON Schema 只能约束输入组织与输出结构，不能证明答案正确、引用真实、延迟和费用可接受，也不能替代 CourseFlow 的领域规则与用户确认。真实 CourseFlow 样本和用户临时提供的 key 仍必须在 P4 门禁中评测；失败或未验证时执行 `MANUAL_ONLY`。

建议的数据流：

```text
Source Document
  -> 本地 PDF 文本提取 / 截图 OCR / 分页与 locator
  -> 本地权限过滤、文本净化、分块与提示词组装
  -> DeepSeek POST /responses（纯文本 + JSON Schema，禁用 tools/web）
  -> 只接收 completed 的完整 output_text
  -> 本地 JSON/schema、引用、Evidence 与领域规则校验
  -> Answer/PlanningDraft view model
  -> 预留 UI 区域（不直接渲染供应商原始响应）
```

## 官方能力逐项核验

| 核验项 | 官方事实 | CourseFlow 结论 |
| --- | --- | --- |
| 文本输入与固定提示词 | `POST /responses` 支持字符串或 input-item 列表；`instructions` 会作为第一条 system message。至少提供 `input` 或 `instructions` 之一。[Responses API](https://api-docs.deepseek.com/api/create-response/) | 可以由本地 prompt builder 固定系统规则，再把已处理课程文本作为不可信数据区发送。 |
| PDF、截图和文件 | Responses 不支持图片和文件输入；`input_image` 不会报错，而会被替换为占位文本。[Responses API Guide](https://api-docs.deepseek.com/guides/responses_api/) | PDF 解析、截图 OCR、页序和定位必须在本地完成；不得把原文件、图片或对象 URL 当作模型可读输入。 |
| 结构化输出 | `text.format.type=json_schema` 支持提供 `name` 与 JSON Schema，并要求输出符合该 schema。[Responses API](https://api-docs.deepseek.com/api/create-response/) | 可定义 `CourseFlowAnswerV1`，例如 `answer/citations/assumptions/draft`；返回后仍须再次做本地 JSON、schema 和领域校验。 |
| 模型与动态 alias | Responses 当前接受 `deepseek-v4-pro` 与 `deepseek-v4-flash`；`GET /models` 返回当前账户可见模型的 ID，而价格页另列当前底层版本名。[Responses API](https://api-docs.deepseek.com/api/create-response/)、[Lists Models](https://api-docs.deepseek.com/api/list-models/)、[Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/) | **架构推论：** API 请求名应按可变 alias 管理，不能把价格页展示的当前版本名当成可调用的固定 snapshot。目标 alias 暂定 `deepseek-v4-pro`；上线前确认账户可见性，每次记录 requested alias、response `id`/`model`，alias 或实际模型变化即重跑评测。 |
| 多轮对话 | Responses 是无状态 API，不在服务端保存 response 或 conversation；每轮必须由客户端在 `input` 中重传所需完整历史。[Responses API](https://api-docs.deepseek.com/api/create-response/) | 对话 session、历史裁剪、token 预算、删除和摘要都由 CourseFlow 本地负责；不能依赖 `previous_response_id` 或服务端会话。 |
| 禁用工具与联网 | Responses 支持 function 与服务端 `web_search`；`tool_choice: "none"` 明确表示不调用工具、直接生成 message。[Responses API](https://api-docs.deepseek.com/api/create-response/) | 固定发送 `tools: []`、`tool_choice: "none"`，adapter 同时拒绝任何 `function_call` 或 `web_search_call` 输出；不要只靠提示词写“不要联网”。 |
| Responses 兼容性 | `previous_response_id`、`conversation`、`store`、`prompt`、`truncation` 等参数不受支持；部分不支持参数会被静默忽略，response 的 `store` 固定为 `false`，上下文超限返回 400。[Responses API Guide](https://api-docs.deepseek.com/guides/responses_api/) | 使用显式参数 allowlist 和独立 DeepSeek adapter；不能只替换 OpenAI SDK 的 base URL，也不能把 `store:false` 当成供应商零留存保证。超限前必须本地预算和分块。 |
| 请求终态 | response 的状态为 `in_progress/completed/incomplete/failed`；`incomplete` 原因包括 `max_output_tokens` 和 `content_filter`。响应提供 `id`、`model` 与 output items。[Responses API](https://api-docs.deepseek.com/api/create-response/) | 只有 `completed` 且得到预期的单一 `message/output_text` 才进入校验；其余状态不得向 UI 产生部分回答或草稿。 |
| 流式 | `stream: true` 返回语义 SSE；终止事件是 `response.completed`、`response.incomplete` 或 `response.failed`，没有 `[DONE]`。[Responses API Guide](https://api-docs.deepseek.com/guides/responses_api/) | UI 可显示“正在生成”和取消，但结构化结果应完整缓冲并通过本地校验后一次性填入预留区域，不能把未闭合 JSON delta 当答案。 |
| 错误边界 | 官方列出 400 格式、401 认证、402 余额、422 参数、429 限流、500 服务错误和 503 过载。[Error Codes](https://api-docs.deepseek.com/quick_start/error_codes/) | 400/422 修正本地请求，401/402 要求用户处理 key/余额，429/500/503 仅做有上限的恢复；任何失败都保留用户输入并提供手工路径。 |
| 上下文与费用 | V4 模型当前列出 1M context、最高 384K output，并按输入/输出 token 计费；价格可能调整。[Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/) | 容量上限不应成为发送整份资料或全部对话的理由；本地仍需分块、最小化上下文和设置应用侧 token/费用预算。 |
| 数据处理与隐私 | Open Platform Terms 要求下游应用披露个人信息处理、取得同意或其他合法依据并保护 API Key；DeepSeek 默认磁盘 context cache 会持久化请求前缀，通常在闲置数小时到数天后清除。公开条款没有为 CourseFlow 最终用户给出足够明确的 API 专属保留、训练退出、DPA 或数据驻留承诺。[Open Platform Terms](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html)、[Context Caching](https://api-docs.deepseek.com/guides/kv_cache/)、[Privacy Policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html) | “本地解析后只发文本”会减少数据量，但不会消除第三方处理。真实上线前必须完成发送范围披露/同意、去敏、最小化、删除说明与条款审核；这些未确认时仍是 `UNVERIFIED`，最终按 `MANUAL_ONLY` 处理。 |

## 推荐的固定请求框架

下列是应用层 contract，不是把任意 provider 参数暴露给页面：

```ts
type CourseFlowAiRequest = {
  purpose: "course_extraction" | "planning_assistant";
  promptVersion: string;
  schemaVersion: string;
  question: string;
  verifiedFacts: Array<{ citationId: string; text: string }>;
  sourceChunks: Array<{
    locatorId: string;
    page: number | null;
    text: string;
    trust: "untrusted_source";
  }>;
  boundedConversation: Array<{ role: "user" | "assistant"; text: string }>;
  allowedCitationIds: string[];
};
```

服务端 adapter 固定映射为：

```json
{
  "model": "deepseek-v4-pro",
  "instructions": "<CourseFlow 固定、版本化规则>",
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "<服务端生成的任务 envelope、必要历史、事实与不可信资料块>"
        }
      ]
    }
  ],
  "reasoning": { "effort": "none" },
  "max_output_tokens": "<应用侧上限>",
  "text": {
    "format": {
      "type": "json_schema",
      "name": "courseflow_answer_v1",
      "schema": "<固定 schema>"
    }
  },
  "tools": [],
  "tool_choice": "none"
}
```

页面只提交用户问题、目标范围和预期版本，不得提交 system prompt、模型、base URL、tools 或任意 schema。服务端根据 `purpose + promptVersion + schemaVersion` 从只读 catalog 选模板；抽取和规划使用不同 prompt/schema，不共享领域 mapper。资料原文只放入带 locator 的 `untrusted_source` 区，不拼进 `instructions`。API Key 只能由服务端使用，不进入浏览器 bundle、对话文本、日志或返回 view model。

adapter 必须采用请求字段 allowlist，并在本地拒绝 `previous_response_id`、`conversation`、`web_search`、任意 tool、自定义 base URL 和调用方自带 instructions。不要依赖 DeepSeek 对不支持参数的“静默忽略”。请求可显式关闭推理并省略采样参数；即使请求或响应出现 `store:false`，也不得据此宣称零留存。

## 必须由本地完成的职责

1. **资料准备**：MIME/大小/所有权校验，PDF 文本提取，必要 OCR，Unicode 规范化，分页、阅读顺序和 locator 建立。
2. **文本最小化**：按用户、课程和任务目的筛选，只发送需要的页和正式记录；处理长文档分块、token 估算与去重。
3. **提示词隔离**：把 syllabus/OCR 文本标记为不可信数据，禁止其覆盖 system rules；版本化 prompt 与 schema。
4. **会话管理**：因为 Responses 无状态，本地保存或重建有界历史，执行过期、删除、摘要与跨用户隔离。
5. **结果验证**：JSON parse、同版本 schema、枚举/长度、日期与时区、成绩基点、citation allowlist、原文 quote 回查和 Evidence locator 校验。
6. **领域真相**：Reading Week、课节展开、冲突、成绩与任务投影继续由 `packages/core` 确定性计算；AI 只能解释或形成草稿。
7. **安全落位**：把通过校验的结果映射为 `AnswerViewModel` 或 `PlanningDraftPreview`，净化文本并渲染到指定 UI 插槽；模型响应不得直接写正式记录。
8. **用户确认**：抽取结果仍是 Candidate；AI Planning Draft 只预填既有表单，用户核对并提交后才调用正式 command。
9. **披露与最小化**：调用前让用户知道将发送哪些课程文本、目的和失败后的手工路径；不发送 API Key、无关课程、其他用户数据、敏感个人信息或无需回答问题的完整 Source Document。

## 暂定实现拆分

该方案适合先做以下四段隔离实现；接口内部均不暴露 DeepSeek 类型：

1. Local Preparation：资料侧复用架构既定的 `DocumentPreparationPort`，把 Source Document 变成带规范化文本块、页码、locator、hash 与 token 估算的 `PreparedDocument`；助手侧复用 `PlanningContextPort` 形成有界正式 snapshot 和短期对话。PDF parser/OCR 可替换，但两个 port 的输出 contract 固定。
2. Feature Prompt Registry：`ingestion` 和 `assistant` 各自在源码中按受控 purpose 选择 prompt/schema/budget version，并用内部 input assembler 组合固定 instructions、必要正式事实、有界历史和不可信文本块；输出只读 `DeepSeekStructuredRequest`。它不是数据库 prompt CMS，也不接受 client 自带 prompt。
3. `DeepSeekResponsesPort`：P3 使用 deterministic fake；只有 `AI_GO` 后 production composition 才绑定固定官方 endpoint 的 live adapter。它是用于隔离 HTTP/凭据/Responses 类型的内部测试 seam，**不是**多供应商抽象；项目不实现 provider registry，DeepSeek 门禁失败就删除该 port 与 AI 功能。v1 固定 `stream=false`，transport 只处理鉴权、超时、取消、有限重试、非流式终态和审计元数据；SSE 三种终态只进入 P4 兼容性 smoke，不用于拼装 UI 内容。
4. Local Result Validation：feature 自己的 parser/validator 完整缓冲 `output_text`，执行 JSON parse、同版本 schema、citation/Evidence allowlist 与 `packages/core` 领域校验；成功后才映射为 `AssistantTurnView`、`ImportReviewView` 或 Candidate，失败只返回稳定错误和手工恢复动作。

预留 UI 插槽采用 `idle / generating / completed / cancelled / failed` 的小型状态 union；schema invalid、incomplete 和 provider error 作为 `failed.problem.code`，不扩张成互相重叠的页面状态。`completed` 之前不显示模型 delta，任何失败都保留用户问题和资料，并按 code 提供“重试 / 检查配置 / 改为手工录入”；生产 UI 是否保留仍由 P4 去留门禁决定。

## 真实 key 评测前仍未知的风险

以下内容无法靠官方接口说明证明，必须在冻结阈值后用真实 key 和去身份化 CourseFlow corpus 评测：

- 固定提示词在 syllabus、OCR 噪声、表格、跨页日期和互相矛盾说明上的事实准确率。
- JSON Schema 实际成功率，以及截断、content filter、空/异常 output item 的发生率。
- citation 是否全部命中本地 allowlist，Evidence quote/页码是否可回查，资料内 prompt injection 是否会影响答案。
- 动态模型 alias 变化后的回归表现；`GET /models` 成功只证明当前可见，不证明回答质量、余额或后续可用性。
- 单请求及长资料分块的 p50/p95 延迟、token、费用、429/500/503 失败率、有限重试和取消体验。
- 规划回答是否始终保持未知值未知、不越权读取数据、不把草稿描述成已经执行的变更。
- 最终用户课程资料的 API 专属保留/缓存、训练使用或退出、处理地域、DPA/子处理者与删除权是否获得产品所有者可接受的书面结论。

## P4 真实门禁验证项

第一次真实调用前先冻结 corpus、阈值、prompt/schema 版本和费用/延迟预算；运行后不得为了通过而改阈值。P4 至少产出以下证据：

| 验证组 | 必须记录 | 失败含义 |
| --- | --- | --- |
| 接口 smoke | `GET /models` 可见性；最小 JSON Schema 请求；response `id`/`model`；正常与流式终态 | 关键 contract 与官方描述不符则不可接入 |
| 抽取 corpus | 关键日期/时间/权重 precision/recall、schema 成功率、Evidence quote/locator 回查率、分块合并重复率 | 无证据候选、关键字段不达冻结阈值或无法稳定回查则失败 |
| 助手 corpus | 引用 allowlist 命中、未知值保持、prompt injection、越权、直接写入、草稿可被现有表单承接 | 越权、无确认写入、虚构引用为零容忍 |
| 可靠性 | p50/p95、输入/输出 token、按核验日价格估算的费用、429/500/503、超时、取消与有限重试 | 超过冻结预算或失败导致输入丢失则失败 |
| 隐私与凭据 | 实际发送字段清单、去敏证明、key 不入 client/log/trace、缓存/保留/训练/DPA/地域结论、用户披露与删除路径 | 任一关键项仍为 `UNVERIFIED`，最终即进入 `MANUAL_ONLY` |
| UI 恢复 | idle/generating/completed/cancelled/failed 状态、键盘与屏幕阅读器路径、手工等价入口 | AI 成为死路、错误仅 toast 或手工路径受损则失败 |

因此，技术判断是：**可以按该框架进入隔离实现与 fake 测试，但在真实门禁通过前不能把预留 UI 区域冻结为生产 AI 功能。**
