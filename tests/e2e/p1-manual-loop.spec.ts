import { expect, test } from "@playwright/test";
import { Client } from "pg";

const e2eUserId = "00000000-0000-4000-9000-000000000901";

test.beforeAll(async () => {
  if (process.env.DATABASE_URL === undefined) throw new Error("DATABASE_URL is required.");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("begin");
    await client.query(
      `delete from courseflow.grading_schemes where course_id in (
         select c.id from courseflow.courses c
         join courseflow.academic_terms t on t.id=c.term_id where t.owner_user_id=$1
       )`,
      [e2eUserId],
    );
    await client.query(
      `delete from courseflow.course_item_labels where course_item_id in (
         select i.id from courseflow.course_items i
         join courseflow.courses c on c.id=i.course_id
         join courseflow.academic_terms t on t.id=c.term_id where t.owner_user_id=$1
       )`,
      [e2eUserId],
    );
    await client.query(
      `delete from courseflow.course_items where course_id in (
         select c.id from courseflow.courses c
         join courseflow.academic_terms t on t.id=c.term_id where t.owner_user_id=$1
       )`,
      [e2eUserId],
    );
    await client.query(
      `delete from courseflow.meeting_exceptions where meeting_pattern_id in (
         select m.id from courseflow.meeting_patterns m
         join courseflow.courses c on c.id=m.course_id
         join courseflow.academic_terms t on t.id=c.term_id where t.owner_user_id=$1
       )`,
      [e2eUserId],
    );
    await client.query(
      `delete from courseflow.meeting_patterns where course_id in (
         select c.id from courseflow.courses c
         join courseflow.academic_terms t on t.id=c.term_id where t.owner_user_id=$1
       )`,
      [e2eUserId],
    );
    await client.query(
      `delete from courseflow.task_labels where term_id in (
         select id from courseflow.academic_terms where owner_user_id=$1
       )`,
      [e2eUserId],
    );
    await client.query(
      `delete from courseflow.courses where term_id in (
         select id from courseflow.academic_terms where owner_user_id=$1
       )`,
      [e2eUserId],
    );
    await client.query(
      `delete from courseflow.academic_calendar_exceptions where term_id in (
         select id from courseflow.academic_terms where owner_user_id=$1
       )`,
      [e2eUserId],
    );
    await client.query("update courseflow.user_profiles set active_term_id=null where id=$1", [
      e2eUserId,
    ]);
    await client.query("delete from courseflow.academic_terms where owner_user_id=$1", [e2eUserId]);
    await client.query("delete from courseflow.letter_grade_scales where owner_user_id=$1", [
      e2eUserId,
    ]);
    await client.query("delete from courseflow.user_profiles where id=$1", [e2eUserId]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
});

test("canonical P1 and P2 plan survives a real PostgreSQL round trip", async ({
  page,
  request,
}) => {
  const requestId = "canonical-p1-p2-loop";
  const webHealth = await request.get("/api/health", { headers: { "x-request-id": requestId } });
  expect(webHealth.ok()).toBe(true);
  expect(webHealth.headers()["x-request-id"]).toBe(requestId);
  const webReady = await request.get("/api/ready");
  expect(webReady.ok()).toBe(true);
  expect(await webReady.json()).toMatchObject({
    checks: { objectStore: "ready", postgres: "ready" },
    service: "web",
    status: "ready",
  });
  const workerReady = await request.get("http://127.0.0.1:3001/ready");
  expect(workerReady.ok()).toBe(true);

  await page.setViewportSize({ height: 1024, width: 768 });
  await page.goto("/dashboard");
  await expect(page).toHaveTitle(/CourseFlow/u);
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "跳到主要内容" });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();

  await page.goto("/terms");
  await page.getByLabel("学期名称").fill("P1 验收学期");
  await page.locator("#term-start").fill("2026-09-08");
  await page.locator("#term-end").fill("2026-12-18");
  await page.getByLabel("IANA 时区").fill("Asia/Shanghai");
  await page.getByLabel("例外名称").fill("Reading Week");
  await page.locator("#rw-start").fill("2026-10-12");
  await page.locator("#rw-end").fill("2026-10-16");
  await page.getByRole("button", { name: "创建学期" }).click();
  await expect(
    page.getByText("学期与 Reading Week 已保存。刷新后仍会从 PostgreSQL 读取。"),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "P1 验收学期" })).toBeVisible();
  const termResponse = await request.get("/api/v1/terms");
  expect(termResponse.ok()).toBe(true);
  const termBody = (await termResponse.json()) as {
    data: readonly Readonly<{ id: string; isActive: boolean }>[];
  };
  const termId = termBody.data.find((term) => term.isActive)?.id;
  if (termId === undefined) throw new Error("Canonical term was not active.");

  await page.goto("/courses/new");
  await page.getByRole("button", { name: "继续" }).click();
  await page.getByLabel("课程代码").fill("CSC-P1");
  await page.getByLabel("课程名称").fill("P1 Contract Course");
  await page.getByLabel("学分（可选）").fill("0.5");
  await page.getByRole("button", { name: "继续" }).click();
  await page.locator("#meeting-place-0").fill("Room L1");
  await page.getByRole("button", { name: "添加课节" }).click();
  await page.getByRole("button", { name: "添加课节" }).click();
  const meetings = page.locator(".repeat-card");
  await meetings.nth(1).getByLabel("类型").selectOption("tutorial");
  await meetings.nth(1).getByLabel("周一").uncheck();
  await meetings.nth(1).getByLabel("周二").check();
  await page.locator("#meeting-start-1").fill("12:00");
  await page.locator("#meeting-end-1").fill("13:00");
  await page.locator("#meeting-place-1").fill("Room T1");
  await meetings.nth(2).getByLabel("类型").selectOption("practical");
  await meetings.nth(2).getByLabel("周一").uncheck();
  await meetings.nth(2).getByLabel("周三").check();
  await page.locator("#meeting-start-2").fill("14:00");
  await page.locator("#meeting-end-2").fill("16:00");
  await page.locator("#meeting-place-2").fill("Lab P1");
  await page.getByRole("button", { name: "继续" }).click();
  await expect(page.getByText("Reading Week：2026-10-12–2026-10-16")).toBeVisible();
  await page.getByRole("button", { name: "保存课程" }).click();
  await page.waitForURL(/\/courses\?courseId=[0-9a-f-]+$/u);
  const courseId = new URL(page.url()).searchParams.get("courseId");
  if (courseId === null) throw new Error("Course redirect did not include courseId.");
  await expect(page.getByText("Lecture", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Tutorial (TUT)", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Practical (PRA)", { exact: true }).first()).toBeVisible();

  await page.goto("/tasks");
  await page.getByLabel("创建本学期标签").fill("需讨论");
  await page.getByRole("button", { name: "保存标签" }).click();
  await expect(page.getByText("标签已保存，可刷新后用于该学期事项。")).toBeVisible();
  await page.getByLabel("事项标题").fill("Problem Set 1");
  await page.getByLabel("预计投入（分钟，可选）").fill("600");
  await page.getByLabel("时间语义").selectOption("date");
  await page.getByLabel("日期").fill("2026-09-30");
  await page.getByLabel("需讨论").check();
  await page.getByRole("button", { name: "添加事项" }).click();
  await expect(
    page.getByText("课程事项已保存；刷新与课程 Timeline 均从同一正式记录回读。"),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Problem Set 1" })).toBeVisible();
  async function createFixtureItem(input: Readonly<Record<string, unknown>>) {
    const response = await request.post("/api/v1/courses/" + courseId + "/items", {
      data: { courseId, ...input },
      headers: { origin: "http://127.0.0.1:3000" },
    });
    expect(response.status()).toBe(201);
  }
  await createFixtureItem({
    kind: "quiz",
    temporal: { date: "2026-09-12", kind: "date" },
    title: "Quick Quiz",
  });
  await createFixtureItem({
    kind: "milestone",
    temporal: { date: "2026-09-30", kind: "date" },
    title: "Project checkpoint",
  });
  await createFixtureItem({
    kind: "assignment",
    temporal: {
      at: "2026-09-10T23:59:00+08:00",
      kind: "deadline",
      timeZone: "Asia/Shanghai",
    },
    title: "Exact deadline",
  });
  await createFixtureItem({
    kind: "lab",
    temporal: {
      endsAt: "2026-09-09T15:30:00+08:00",
      kind: "interval",
      startsAt: "2026-09-09T14:30:00+08:00",
      timeZone: "Asia/Shanghai",
    },
    title: "Conflicting lab",
  });
  await createFixtureItem({
    kind: "project",
    temporal: { kind: "unscheduled", note: "等待学院确认" },
    title: "Capstone TBA",
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "先完成" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "本周推进" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "持续准备" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "时间待确认" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Exact deadline" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Quick Quiz" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Capstone TBA" })).toBeVisible();
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path: "test-results/canonical-p2-tasks-768x1024.png",
  });

  await page.goto(`/courses/${courseId}/timeline`);
  await expect(page.getByRole("heading", { name: "Problem Set 1" })).toBeVisible();
  await expect(page.getByText(/9月30日.*全天/u).first()).toBeVisible();

  await page.goto(`/courses/${courseId}/grading`);
  await page.locator("#grade-title-0").fill("Midterm");
  await page.locator("#grade-weight-0").fill("20");
  await page.getByRole("button", { name: "添加组成" }).click();
  await page.locator("#grade-title-1").fill("Final");
  await page.locator("#grade-weight-1").fill("80");
  await page.getByRole("button", { name: "创建评分方案" }).click();
  await expect(page.getByText("评分方案已保存；未知权重保持未知，未出分不会按 0。")).toBeVisible();
  const earned = page.getByLabel("Midterm 得分");
  await earned.fill("80");
  const resultForm = earned.locator("xpath=ancestor::form");
  await resultForm.getByLabel("满分").fill("100");
  await resultForm.getByRole("button", { name: "记录结果" }).click();
  await expect(page.getByText("手工成绩已保存，覆盖口径已重新计算。")).toBeVisible();
  await expect(
    page.locator(".grade-summary").filter({ hasText: "已获总评百分点" }).locator("strong"),
  ).toHaveText("16%");
  await expect(
    page.locator(".grade-summary").filter({ hasText: "已出分部分百分比" }).locator("strong"),
  ).toHaveText("80%");
  await expect(
    page.locator(".grade-summary").filter({ hasText: "覆盖总评权重" }).locator("strong"),
  ).toHaveText("20%");

  await page.reload();
  await expect(
    page.locator(".grade-summary").filter({ hasText: "已获总评百分点" }).locator("strong"),
  ).toHaveText("16%");
  await expect(page.getByText("Final").first()).toBeVisible();

  const dashboardApi = await request.get("/api/v1/dashboard?termId=" + termId);
  const tasksApi = await request.get("/api/v1/tasks?termId=" + termId);
  const calendarApi = await request.get("/api/v1/calendar?termId=" + termId);
  expect(dashboardApi.ok()).toBe(true);
  expect(tasksApi.ok()).toBe(true);
  expect(calendarApi.ok()).toBe(true);
  const dashboardData = (await dashboardApi.json()) as {
    data: {
      conflicts: readonly Readonly<{ kind: string }>[];
      snapshotId: string;
    };
  };
  const tasksData = (await tasksApi.json()) as { data: { snapshotId: string } };
  const calendarData = (await calendarApi.json()) as { data: { snapshotId: string } };
  expect(tasksData.data.snapshotId).toBe(dashboardData.data.snapshotId);
  expect(calendarData.data.snapshotId).toBe(dashboardData.data.snapshotId);
  expect(dashboardData.data.conflicts.map((conflict) => conflict.kind)).toEqual(
    expect.arrayContaining(["hard_overlap", "deadline_cluster", "unknown_schedule"]),
  );

  await page.goto("/dashboard");
  await expect(page.getByText("教学周 1")).toBeVisible();
  await expect(page.getByRole("heading", { name: "实践课" })).toBeVisible();
  await expect(page.getByText("时间冲突")).toBeVisible();
  await expect(page.getByText("截止事项集中")).toBeVisible();
  await expect(page.getByRole("img", { name: "按周工作量热力图" })).toBeVisible();
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path: "test-results/canonical-p2-dashboard-1280x900.png",
  });

  await page.goto("/calendar?from=2026-09-08");
  await expect(page.getByText("CSC-P1 实践课", { exact: true })).toBeVisible();
  await expect(page.getByText("CSC-P1 Conflicting lab", { exact: true })).toBeVisible();
  const exportHref = await page.getByRole("link", { name: "导出 ICS" }).getAttribute("href");
  if (exportHref === null) throw new Error("ICS export link was missing.");
  const firstExport = await request.get(exportHref);
  const secondExport = await request.get(exportHref);
  expect(firstExport.ok()).toBe(true);
  expect(firstExport.headers()["content-type"]).toContain("text/calendar");
  expect(firstExport.headers()["x-courseflow-skipped-events"]).toBe("1");
  const firstIcs = await firstExport.text();
  const secondIcs = await secondExport.text();
  expect(firstIcs).toBe(secondIcs);
  expect(firstIcs).toContain("DTSTART;VALUE=DATE:20260930");
  expect(firstIcs).toContain("SUMMARY:截止：CSC-P1 Exact deadline");
  expect(firstIcs).not.toContain("Capstone TBA");
  const uids = firstIcs.match(/^UID:.+$/gmu);
  expect(uids?.length).toBeGreaterThan(0);
  expect(new Set(uids).size).toBe(uids?.length);

  await page.goto("/calendar?from=2026-10-12");
  await expect(page.getByRole("heading", { name: "日历" })).toBeVisible();
  await expect(page.locator(".calendar-week")).toBeVisible();
  await expect(page.locator(".calendar-event")).toHaveCount(0);
  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path: "test-results/canonical-p2-calendar-reading-week-1280x900.png",
  });

  await page.setViewportSize({ height: 900, width: 640 });
  await page.goto("/tasks");
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    )
    .toBe(true);
  await page.goto("/calendar?from=2026-09-08");
  await expect(page.getByRole("heading", { name: "日历" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const calendar = document.querySelector<HTMLElement>(".calendar-scroll");
        return calendar !== null && calendar.scrollWidth > calendar.clientWidth;
      }),
    )
    .toBe(true);
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto(`/courses?courseId=${courseId}`);
  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path: "test-results/canonical-p2-courses-1280x900.png",
  });
});
