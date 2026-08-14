import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

const prohibitedPaths = [
  "courseflow-visual-lab.html",
  "courseflow-visual-lab-glass.html",
  "apps/import-harness",
  "packages/core/src/ai",
  "packages/core/src/assistant",
  "packages/core/src/ingestion",
  "tests/ai-harness",
  "playwright.ai.config.ts",
  "scripts/run-ai-eval.mjs",
  "docs/quality/AI_EVAL_RUNBOOK.md",
  "docs/quality/ai-eval-corpus-v1.json",
  "docs/quality/ai-eval-policy-v1.json",
  "docs/design/baselines/ui-v1/reference/courseflow.html",
  "docs/design/baselines/ui-v1/screenshots/1280x900/dashboard--success--dark.png",
  "docs/design/baselines/ui-v1/screenshots/1280x900/dashboard--success--light.png",
  "docs/design/baselines/ui-v1/screenshots/1280x900/courses--selected-course--light.png",
  "docs/design/baselines/ui-v1/screenshots/1280x900/sources--library--light.png",
  "docs/design/baselines/ui-v1/screenshots/1280x900/overlay-add-item--default--light.png",
  "docs/design/baselines/ui-v1/screenshots/768x1024/dashboard--success--light.png",
  "docs/design/baselines/ui-v1/screenshots/768x1024/courses--selected-course--light.png",
  "docs/design/baselines/ui-v1/screenshots/768x1024/sources--library--light.png",
  "docs/design/baselines/ui-v1/screenshots/1280x900/overlay-review--candidate-evidence--light.png",
  "docs/design/baselines/ui-v1/screenshots/768x1024/overlay-review--candidate-evidence--light.png",
];

const requiredManualFiles = [
  "apps/web/app/sources/page.tsx",
  "apps/web/features/sources/source-library-view.tsx",
  "apps/web/features/sources/source-upload-form.tsx",
  "packages/core/src/sources/index.ts",
  "packages/core/src/sources/service.ts",
];

const releaseRoots = ["apps/web", "apps/worker", "packages", "tests", ".github/workflows"];

const releaseFiles = [".env.example", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"];

const prohibitedReleasePatterns = [
  { label: "DeepSeek provider reference", pattern: /\bdeepseek\b/iu },
  { label: "AI result region", pattern: /\bAiResultRegion\b/u },
  {
    label: "removed AI domain contract",
    pattern:
      /\b(?:runPlanningAssistant|runIngestionAi|reviewCandidate|ImportRunId|CandidateId|EvidenceId)\b/u,
  },
  {
    label: "removed AI persistence",
    pattern:
      /\b(?:user_ai_credentials|ai_assistant_(?:sessions|turns)|import_runs|import_artifacts|evidence|candidates|review_decisions|review_applications)\b/iu,
  },
  {
    label: "removed AI credential configuration",
    pattern: /\b(?:DEEPSEEK|AI_PROVIDER|AI_MODEL|AI_API_KEY)_[A-Z0-9_]*\b/iu,
  },
  {
    label: "removed AI route",
    pattern: /\/(?:api\/v1\/candidates|imports\/\[?runId\]?|assistant)(?:\/|\b)/iu,
  },
];

async function exists(relativePath) {
  try {
    await access(path.join(root, relativePath));
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function collectFiles(relativePath) {
  const absolutePath = path.join(root, relativePath);
  const entries = await readdir(absolutePath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if ([".next", "dist", "node_modules"].includes(entry.name)) continue;
    const child = path.join(relativePath, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(child)));
    else if (entry.isFile() && !entry.name.endsWith(".tsbuildinfo")) files.push(child);
  }

  return files;
}

const survivingProhibitedPaths = [];
for (const relativePath of prohibitedPaths) {
  if (await exists(relativePath)) survivingProhibitedPaths.push(relativePath);
}

const missingManualFiles = [];
for (const relativePath of requiredManualFiles) {
  if (!(await exists(relativePath))) missingManualFiles.push(relativePath);
}

const scannedFiles = [];
for (const relativePath of releaseRoots) {
  if (await exists(relativePath)) scannedFiles.push(...(await collectFiles(relativePath)));
}
for (const relativePath of releaseFiles) {
  if (await exists(relativePath)) scannedFiles.push(relativePath);
}

const violations = [];
for (const relativePath of scannedFiles) {
  const content = await readFile(path.join(root, relativePath), "utf8").catch(() => "");
  for (const { label, pattern } of prohibitedReleasePatterns) {
    if (pattern.test(content)) violations.push({ file: relativePath, label });
  }
}

const coreExports = await readFile(path.join(root, "packages/core/src/index.ts"), "utf8");
if (!coreExports.includes('export * from "./sources";')) {
  violations.push({ file: "packages/core/src/index.ts", label: "manual Sources export missing" });
}
if (/\.\/(?:ai|assistant|ingestion)["']/u.test(coreExports)) {
  violations.push({
    file: "packages/core/src/index.ts",
    label: "removed AI module still exported",
  });
}

if (survivingProhibitedPaths.length > 0 || missingManualFiles.length > 0 || violations.length > 0) {
  throw new Error(
    JSON.stringify(
      {
        missingManualFiles,
        status: "MANUAL_ONLY_CLEANUP_FAILED",
        survivingProhibitedPaths,
        violations,
      },
      null,
      2,
    ),
  );
}

process.stdout.write(
  `${JSON.stringify(
    {
      prohibitedPathCount: 0,
      requiredManualFileCount: requiredManualFiles.length,
      scannedFileCount: scannedFiles.length,
      status: "MANUAL_ONLY_CLEANUP_PASSED",
      violationCount: 0,
    },
    null,
    2,
  )}\n`,
);
