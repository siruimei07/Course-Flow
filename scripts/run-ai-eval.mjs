import { readdir, readFile } from "node:fs/promises";
import process from "node:process";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assertSourceControlledPipelineContract(source, feature) {
  const required = [
    `${feature === "ingestion" ? "INGESTION" : "ASSISTANT"}_PROMPT_VERSION`,
    `${feature === "ingestion" ? "INGESTION" : "ASSISTANT"}_SCHEMA_VERSION`,
    `${feature === "ingestion" ? "INGESTION" : "ASSISTANT"}_BUDGET_VERSION`,
    'model: "deepseek-v4-pro"',
    'reasoning: { effort: "none" }',
    "stream: false",
    'type: "json_schema"',
    'tool_choice: "none"',
    "tools: []",
    "additionalProperties: false",
  ];
  const missing = required.filter((token) => !source.includes(token));
  if (missing.length > 0) {
    throw new Error(`${feature} source-controlled request contract is incomplete: ${missing}`);
  }
}

const args = new Set(process.argv.slice(2));
if (!args.has("--dry-run")) {
  process.stderr.write(
    "P3 runner only supports --dry-run; live network calls are not installed.\n",
  );
  process.exitCode = 2;
} else {
  const policy = JSON.parse(
    await readFile(new URL("../docs/quality/ai-eval-policy-v1.json", import.meta.url), "utf8"),
  );
  const corpus = JSON.parse(
    await readFile(new URL("../docs/quality/ai-eval-corpus-v1.json", import.meta.url), "utf8"),
  );
  const expected = {
    assistant: [
      "assistant-planning-prompt-v1",
      "assistant-planning-schema-v1",
      "assistant-deepseek-budget-v1",
    ],
    ingestion: [
      "ingestion-course-items-prompt-v1",
      "ingestion-course-items-schema-v1",
      "ingestion-deepseek-budget-v1",
    ],
  };
  for (const feature of Object.keys(expected)) {
    const actual = policy.versions[feature];
    const values = [actual.prompt, actual.schema, actual.budget];
    if (JSON.stringify(values) !== JSON.stringify(expected[feature])) {
      throw new Error(`${feature} frozen version mismatch`);
    }
  }
  const ingestionPipeline = readFileSync(
    new URL("../packages/core/src/ingestion/ai-pipeline.ts", import.meta.url),
    "utf8",
  );
  const assistantPipeline = readFileSync(
    new URL("../packages/core/src/assistant/ai-pipeline.ts", import.meta.url),
    "utf8",
  );
  const deepSeekContract = readFileSync(
    new URL("../packages/core/src/ai/deepseek-responses.ts", import.meta.url),
    "utf8",
  );
  assertSourceControlledPipelineContract(ingestionPipeline, "ingestion");
  assertSourceControlledPipelineContract(assistantPipeline, "assistant");
  const allowedRequestFieldsMatch = deepSeekContract.match(
    /const allowedRequestFields = \[([\s\S]*?)\] as const;/u,
  );
  if (allowedRequestFieldsMatch === null) {
    throw new Error("DeepSeek allowlist declaration is missing.");
  }
  const allowedRequestFields = [...allowedRequestFieldsMatch[1].matchAll(/"([^"]+)"/gu)].map(
    (match) => match[1],
  );
  const expectedAllowedRequestFields = [
    "input",
    "instructions",
    "max_output_tokens",
    "model",
    "reasoning",
    "stream",
    "text",
    "tool_choice",
    "tools",
  ];
  if (JSON.stringify(allowedRequestFields) !== JSON.stringify(expectedAllowedRequestFields)) {
    throw new Error("DeepSeek request field allowlist changed.");
  }
  for (const token of ['"https://api.deepseek.com/responses"', '"deepseek-v4-pro"']) {
    if (!deepSeekContract.includes(token)) {
      throw new Error(`DeepSeek allowlist contract is incomplete: ${token}`);
    }
  }
  if (policy.policyVersion !== "ai-eval-policy-v1" || policy.liveCallsAllowedInP3 !== false) {
    throw new Error("AI eval policy is not safely frozen for P3.");
  }
  if (!Array.isArray(corpus.samples) || corpus.samples.length < 5) {
    throw new Error("AI eval corpus manifest is incomplete.");
  }
  const sampleIds = new Set(corpus.samples.map((sample) => sample.id));
  const requiredSampleIds = [
    "extract-text-date-v1",
    "extract-ambiguous-tba-v1",
    "assistant-form-prefill-v1",
    "prompt-injection-source-v1",
    "cross-owner-citation-v1",
  ];
  if (
    sampleIds.size !== corpus.samples.length ||
    requiredSampleIds.some((sampleId) => !sampleIds.has(sampleId))
  ) {
    throw new Error("AI eval corpus coverage or identifiers changed.");
  }
  for (const [metric, value] of Object.entries(policy.thresholds)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`AI eval threshold ${metric} is invalid.`);
    }
  }
  if (Object.values(policy.zeroTolerance).some((value) => value !== 0)) {
    throw new Error("AI eval zero-tolerance policy must remain zero.");
  }
  if (
    !Array.isArray(policy.requiredSignOff) ||
    policy.requiredSignOff.some((role) => !Object.hasOwn(policy.signatures, role))
  ) {
    throw new Error("AI eval sign-off roles are incomplete.");
  }
  const productionRuntime = readFileSync(
    new URL("../apps/web/composition/runtime.ts", import.meta.url),
    "utf8",
  );
  async function filesUnder(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? filesUnder(path) : [path];
      }),
    );
    return nested.flat();
  }
  const productionManifest = [
    ...(await filesUnder(fileURLToPath(new URL("../apps/web/app/", import.meta.url)))),
    ...(await filesUnder(fileURLToPath(new URL("../apps/web/features/", import.meta.url)))),
    ...(await filesUnder(
      fileURLToPath(new URL("../packages/infrastructure/drizzle/", import.meta.url)),
    )),
  ].filter((path) => [".ts", ".tsx", ".sql"].includes(extname(path)));
  const forbiddenProductionPaths = productionManifest.filter((path) =>
    /[\\/](?:ai|assistant|imports?)[\\/]/iu.test(path),
  );
  const forbiddenProductionContent = productionManifest.filter(
    (path) =>
      !/[\\/]course-items[\\/]/u.test(path) &&
      /DeepSeekResponses|AiResultRegion|ImportWorkbench|runPlanningAssistant|runIngestionAi/u.test(
        readFileSync(path, "utf8"),
      ),
  );
  if (
    /DeepSeekResponses|runPlanningAssistant|runIngestionAi|import-harness/u.test(
      productionRuntime,
    ) ||
    forbiddenProductionPaths.length > 0 ||
    forbiddenProductionContent.length > 0
  ) {
    throw new Error("Default production composition is not isolated from AI runtime.");
  }
  const forbiddenEnvironmentKeys = Object.keys(process.env).filter((key) =>
    /DEEPSEEK.*(?:KEY|TOKEN|SECRET)|(?:KEY|TOKEN|SECRET).*DEEPSEEK/iu.test(key),
  );
  if (forbiddenEnvironmentKeys.length > 0) {
    throw new Error("Dry-run refuses an environment containing a DeepSeek credential variable.");
  }
  process.stdout.write(
    JSON.stringify(
      {
        corpusVersion: corpus.corpusVersion,
        liveCall: false,
        policyVersion: policy.policyVersion,
        productMode: policy.productMode,
        sampleCount: corpus.samples.length,
        signOff: Object.fromEntries(
          Object.entries(policy.signatures).map(([role, signature]) => [
            role,
            signature === null ? "UNVERIFIED" : "SIGNED",
          ]),
        ),
        status: "dry-run-passed",
        thresholdsChecked: Object.keys(policy.thresholds).length,
        zeroToleranceChecks: Object.keys(policy.zeroTolerance).length,
        versions: policy.versions,
      },
      null,
      2,
    ) + "\n",
  );
}
