import { expect, test } from "@playwright/test";

test("application shell and both runtimes are operational", async ({ page, request }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/CourseFlow/u);
  await expect(page.getByRole("heading", { level: 1, name: "CourseFlow" })).toBeVisible();
  await expect(page.getByText("当前页面不展示示例课程数据")).toBeVisible();

  const healthLink = page.getByRole("link", { name: "查看 Web 健康状态" });
  await healthLink.focus();
  await expect(healthLink).toBeFocused();

  const requestId = "p0-smoke-request";
  const webHealth = await request.get("/api/health", { headers: { "x-request-id": requestId } });
  expect(webHealth.ok()).toBe(true);
  expect(webHealth.headers()["x-request-id"]).toBe(requestId);
  expect(await webHealth.json()).toEqual({ service: "web", status: "ok" });

  const webReady = await request.get("/api/ready");
  expect(webReady.ok()).toBe(true);
  expect(await webReady.json()).toMatchObject({
    checks: { objectStore: "ready", postgres: "ready" },
    service: "web",
    status: "ready",
  });

  const workerHealth = await request.get("http://127.0.0.1:3001/health", {
    headers: { "x-request-id": requestId },
  });
  expect(workerHealth.ok()).toBe(true);
  expect(workerHealth.headers()["x-request-id"]).toBe(requestId);
  expect(await workerHealth.json()).toEqual({ service: "worker", status: "ok" });

  const workerReady = await request.get("http://127.0.0.1:3001/ready");
  expect(workerReady.ok()).toBe(true);
  expect(await workerReady.json()).toMatchObject({
    checks: { objectStore: "ready", postgres: "ready" },
    service: "worker",
    status: "ready",
  });
});
