import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

const webUrl = "http://127.0.0.1:3000";
const workerUrl = "http://127.0.0.1:3001";
const systemChrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const browserExecutablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  (process.platform === "win32" && existsSync(systemChrome) ? systemChrome : undefined);
const e2eUserId = "00000000-0000-4000-9000-000000000901";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "line",
  timeout: 90_000,
  workers: 1,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: webUrl,
    launchOptions: browserExecutablePath ? { executablePath: browserExecutablePath } : undefined,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @courseflow/web start",
      env: {
        AUTH_DEVELOPMENT_DISPLAY_NAME: "P1 E2E Student",
        AUTH_DEVELOPMENT_SUBJECT: "test:p1-e2e-student",
        AUTH_DEVELOPMENT_TIME_ZONE: "Asia/Shanghai",
        AUTH_DEVELOPMENT_USER_ID: e2eUserId,
        AUTH_MODE: "development",
      },
      name: "web",
      reuseExistingServer: !process.env.CI,
      stderr: "pipe",
      timeout: 120_000,
      url: `${webUrl}/api/health`,
    },
    {
      command: "pnpm --filter @courseflow/worker start",
      name: "worker",
      reuseExistingServer: !process.env.CI,
      stderr: "pipe",
      timeout: 60_000,
      url: `${workerUrl}/health`,
    },
  ],
});
