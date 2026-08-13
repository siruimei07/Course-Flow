export const DEEPSEEK_RESPONSES_ENDPOINT = "https://api.deepseek.com/responses" as const;
export const DEEPSEEK_MODEL_ALIAS = "deepseek-v4-pro" as const;

export type JsonSchema = Readonly<Record<string, unknown>>;

export type DeepSeekStructuredRequest = Readonly<{
  input: readonly Readonly<{
    content: readonly Readonly<{ text: string; type: "input_text" }>[];
    role: "user";
    type: "message";
  }>[];
  instructions: string;
  max_output_tokens: number;
  model: typeof DEEPSEEK_MODEL_ALIAS;
  reasoning: Readonly<{ effort: "none" }>;
  stream: false;
  text: Readonly<{
    format: Readonly<{
      name: string;
      schema: JsonSchema;
      strict: true;
      type: "json_schema";
    }>;
  }>;
  tool_choice: "none";
  tools: readonly [];
}>;

export type ProviderOutputItem =
  | Readonly<{
      content: readonly Readonly<{
        text?: string;
        type: "output_text" | "refusal" | string;
      }>[];
      role: "assistant";
      type: "message";
    }>
  | Readonly<{ type: string }>;

export type ProviderResponseEnvelope = Readonly<{
  id: string;
  model: string;
  output: readonly ProviderOutputItem[];
  status: "completed" | "failed" | "in_progress" | "incomplete";
}>;

export type DeepSeekStructuredResponse = Readonly<{
  outputText: string;
  responseId: string;
  responseModel: string;
}>;

export type DeepSeekSafeProblemCode =
  "AI_CANCELLED" | "AI_INVALID_RESPONSE" | "AI_PROVIDER_FAILED" | "AI_RESPONSE_INCOMPLETE";

export class DeepSeekResponseError extends Error {
  readonly code: DeepSeekSafeProblemCode;

  constructor(code: DeepSeekSafeProblemCode, message: string) {
    super(message);
    this.name = "DeepSeekResponseError";
    this.code = code;
  }
}

export interface DeepSeekResponsesPort {
  createStructuredResponse(
    request: DeepSeekStructuredRequest,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<DeepSeekStructuredResponse>;
}

const allowedRequestFields = [
  "input",
  "instructions",
  "max_output_tokens",
  "model",
  "reasoning",
  "stream",
  "text",
  "tool_choice",
  "tools",
] as const;

const allowedRequestFieldSet = new Set<string>(allowedRequestFields);

export const deepSeekRequestFieldAllowlist: readonly string[] = Object.freeze([
  ...allowedRequestFields,
]);

export const deepSeekLiveAdapterContract = Object.freeze({
  endpoint: DEEPSEEK_RESPONSES_ENDPOINT,
  method: "POST" as const,
  model: DEEPSEEK_MODEL_ALIAS,
  requestFields: allowedRequestFields,
  timeoutMs: 60_000,
});

export function assertDeepSeekRequestContract(request: DeepSeekStructuredRequest): void {
  const fields = Object.keys(request);
  if (
    fields.length !== allowedRequestFields.length ||
    fields.some((field) => !allowedRequestFieldSet.has(field))
  ) {
    throw new DeepSeekResponseError("AI_INVALID_RESPONSE", "AI request contract is invalid.");
  }
  const hasExactKeys = (value: object, expected: readonly string[]) => {
    const actual = Object.keys(value).sort();
    const sortedExpected = [...expected].sort();
    return (
      actual.length === sortedExpected.length &&
      actual.every((key, index) => key === sortedExpected[index])
    );
  };
  if (
    !hasExactKeys(request.reasoning, ["effort"]) ||
    !hasExactKeys(request.text, ["format"]) ||
    !hasExactKeys(request.text.format, ["name", "schema", "strict", "type"]) ||
    request.input.length !== 1 ||
    request.input.some(
      (item) =>
        !hasExactKeys(item, ["content", "role", "type"]) ||
        item.type !== "message" ||
        item.role !== "user" ||
        item.content.length !== 1 ||
        item.content.some(
          (content) =>
            !hasExactKeys(content, ["text", "type"]) ||
            content.type !== "input_text" ||
            content.text.trim() === "",
        ),
    ) ||
    request.instructions.trim() === "" ||
    !Number.isSafeInteger(request.max_output_tokens) ||
    request.max_output_tokens < 1 ||
    request.text.format.name.trim() === "" ||
    typeof request.text.format.schema !== "object" ||
    request.text.format.schema === null ||
    request.model !== DEEPSEEK_MODEL_ALIAS ||
    request.stream !== false ||
    request.reasoning.effort !== "none" ||
    request.tool_choice !== "none" ||
    request.tools.length !== 0 ||
    request.text.format.type !== "json_schema" ||
    request.text.format.strict !== true
  ) {
    throw new DeepSeekResponseError("AI_INVALID_RESPONSE", "AI request contract is invalid.");
  }
}

export function acceptCompletedOutputText(
  envelope: ProviderResponseEnvelope,
): DeepSeekStructuredResponse {
  if (envelope.status === "incomplete") {
    throw new DeepSeekResponseError("AI_RESPONSE_INCOMPLETE", "AI result was incomplete.");
  }
  if (envelope.status !== "completed") {
    throw new DeepSeekResponseError("AI_PROVIDER_FAILED", "AI result was unavailable.");
  }
  if (envelope.output.length !== 1) {
    throw new DeepSeekResponseError("AI_INVALID_RESPONSE", "AI result had an invalid shape.");
  }
  const item = envelope.output[0];
  if (
    item === undefined ||
    item.type !== "message" ||
    !("content" in item) ||
    item.role !== "assistant"
  ) {
    throw new DeepSeekResponseError("AI_INVALID_RESPONSE", "AI result had an invalid shape.");
  }
  if (item.content.length !== 1) {
    throw new DeepSeekResponseError("AI_INVALID_RESPONSE", "AI result had an invalid shape.");
  }
  const content = item.content[0];
  if (
    envelope.id.trim() === "" ||
    envelope.model.trim() === "" ||
    content?.type !== "output_text" ||
    typeof content.text !== "string" ||
    content.text.trim() === ""
  ) {
    throw new DeepSeekResponseError("AI_INVALID_RESPONSE", "AI result had an invalid shape.");
  }
  return {
    outputText: content.text,
    responseId: envelope.id,
    responseModel: envelope.model,
  };
}

export class DeterministicDeepSeekResponsesFake implements DeepSeekResponsesPort {
  readonly #envelope: ProviderResponseEnvelope;
  lastRequest: DeepSeekStructuredRequest | null = null;

  constructor(envelope: ProviderResponseEnvelope) {
    this.#envelope = envelope;
  }

  async createStructuredResponse(
    request: DeepSeekStructuredRequest,
    options: Readonly<{ signal?: AbortSignal }> = {},
  ): Promise<DeepSeekStructuredResponse> {
    assertDeepSeekRequestContract(request);
    this.lastRequest = request;
    if (options.signal?.aborted === true) {
      throw new DeepSeekResponseError("AI_CANCELLED", "AI request was cancelled.");
    }
    return acceptCompletedOutputText(this.#envelope);
  }
}
