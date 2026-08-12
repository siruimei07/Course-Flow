import { defineConfig, devices } from "@playwright/test";

const webUrl = "http://127.0.0.1:3000";
const workerUrl = "http://127.0.0.1:3001";
const browserExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "line",
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
