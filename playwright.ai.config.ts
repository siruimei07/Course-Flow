import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

const harnessUrl = "http://127.0.0.1:3100";
const systemChrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const browserExecutablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  (process.platform === "win32" && existsSync(systemChrome) ? systemChrome : undefined);

export default defineConfig({
  testDir: "./tests/ai-harness",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  reporter: "line",
  timeout: 60_000,
  workers: 1,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: harnessUrl,
    launchOptions: browserExecutablePath ? { executablePath: browserExecutablePath } : undefined,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm --filter @courseflow/import-harness dev",
    env: { COURSEFLOW_IMPORT_HARNESS: "enabled" },
    name: "isolated-ai-harness",
    reuseExistingServer: !process.env.CI,
    stderr: "pipe",
    timeout: 120_000,
    url: `${harnessUrl}/imports/demo-processing`,
  },
});
