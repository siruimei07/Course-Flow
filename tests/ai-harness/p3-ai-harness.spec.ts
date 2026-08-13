import { expect, test } from "@playwright/test";

test("isolated fake composition proves review and safe AI result states", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto("/imports/demo-review");
  await expect(page.getByRole("heading", { name: "导入与审核" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /^接受 /u })).toBeVisible();
  await expect(page.getByRole("radio", { name: /修改后接受/u })).toBeVisible();
  await expect(page.getByRole("radio", { name: /拒绝/u })).toBeVisible();
  await expect(page.getByRole("radio", { name: /标记重复/u })).toBeVisible();
  await expect(page.getByText("原始 Candidate payload")).toBeVisible();
  await expect(page.getByRole("heading", { name: "逐字段核对来源" })).toBeVisible();
  await expect(page.getByText(/字段 AI 估计 93% · 推断说明/u)).toBeVisible();

  const firstCandidate = page.getByRole("button", { name: /实验报告 1/u });
  const secondCandidate = page.getByRole("button", { name: /实验报告 2/u });
  await firstCandidate.focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(secondCandidate).toBeFocused();
  await page.keyboard.press("e");
  await expect(page.locator(".review-evidence-panel")).toBeFocused();

  await page.setViewportSize({ height: 900, width: 640 });
  await page.goto("/imports/demo-review");
  const reflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(reflow.scrollWidth).toBeLessThanOrEqual(reflow.clientWidth + 1);

  await page.setViewportSize({ height: 900, width: 1280 });
  for (const state of ["idle", "generating", "completed", "cancelled", "failed"] as const) {
    await page.goto(`/ai-result/${state}`);
    await expect(page.getByRole("heading", { name: "AI 结果区" })).toBeVisible();
    await expect(page.locator(".status-label")).toHaveText(state);
  }

  await page.goto("/ai-result/completed");
  await expect(page.getByText("先核对 9 月 30 日到期的 Problem Set 1。")).toBeVisible();
  await expect(page.getByRole("heading", { name: "课程事项表单草稿" })).toBeVisible();
  await expect(page.getByText("尚未保存", { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("response_fixture_not_exposed");
  await expect(page.locator("body")).not.toContainText("output_text");
  await expect(page.locator("body")).not.toContainText("deepseek-v4-pro-fixture");

  await page.goto("/ai-result/failed");
  await expect(page.getByText("问题已保留：请帮我为 Problem Set 1 起草手工表单。")).toBeVisible();
  await expect(page.getByRole("button", { name: "重试" })).toBeVisible();
  await expect(page.getByRole("button", { name: "检查配置" })).toBeVisible();
  await expect(page.getByRole("button", { name: "改用手工表单" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("unsafe provider markup");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/imports/demo-processing");
  await expect(page.getByRole("heading", { name: "正在构建可审核候选" })).toBeVisible();
  await expect(page.locator(".import-processing-spinner")).toHaveCSS("animation-name", "none");
});
