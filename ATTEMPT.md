# CourseFlow 第一次尝试归档

> 状态：`archived / superseded`。本文件只记录 2026-08-17 清空仓库前的第一次开发尝试，不是后续开发规划或当前产品规范。

## 快照身份

- 归档时间：2026-08-17 17:42（Asia/Shanghai）
- 原分支：`main`
- 已提交基线：`c68f49492bb8a5e64c4271d9bb7f2a573609dd1f`（`feat: complete P5 gradebook partial-state slice`）
- 基线规模：225 个已跟踪文件
- 清空前工作树：8 个已跟踪文件有修改，另有 1 个未跟踪测试文件；全部未提交增量完整保存在文末补丁中
- Git 历史保留在本文件所在清空提交的父提交链上；`.env`、依赖缓存、构建/测试产物等忽略内容不归档

清空前状态：

```text
 M apps/web/app/courses/[courseId]/grading/page.tsx
 M docs/architecture/INTERFACES.md
 M docs/design/UI_INTEGRATION_LOG.md
 M packages/core/src/p1-domain.test.ts
 M packages/core/src/planning/rules.ts
 M packages/core/src/planning/types.ts
 M tests/e2e/p1-manual-loop.spec.ts
 M tests/unit/p1-interfaces.test.ts
?? tests/unit/p5-letter-grade-state-interface.test.ts
```

## 已达到的进度

- P0（`dc03dd8`）：建立 pnpm monorepo、Next.js/React、TypeScript strict、PostgreSQL/object-storage seam 与基础质量门。
- P1（`6effc49`）：完成学期、课程、周期课节、Reading Week/单次例外、课程事项、标签、评分方案、手工成绩、字母等级表和课程学分的正式数据闭环。
- P2（`a965698`）：完成统一 `ScheduleSnapshot`，供 Dashboard、Tasks、Calendar、Timeline、负荷、冲突、热力图与 ICS 使用。
- P3（`ef79365`）：完成私有 Source 上传、服务端校验、安全预览、删除及从原文旁打开手工表单的闭环。
- P4（`559b09e`）：签署并实施 `MANUAL_ONLY`，删除远程 AI、自动抽取、候选审核和助手发布面，并建立防回流门禁。
- P5 已提交两条纵向切片：任务完成闭环（`6b47cd3`）与 Gradebook 未知权重 partial 状态（`c68f494`）。

## 清空时尚未完成的工作

- 工作树正在把字母等级投影从可空字段改成显式三态：`unconfigured`、`awaiting_result`、`available`。
- 增量已涉及 core 类型/规则、公开 interface 文档、成绩页状态文案、unit/interface 测试与 canonical E2E；目标测试和类型检查通过，但尚未形成提交。
- P5 的整体 UI 整合、长文本/主题/200% zoom/键盘/reduced-motion 等验收仍未完成。记录显示完整 `pnpm gate:p4` 曾通过；随后内置 Browser 导航通道持续被阻断，因此该字母等级 UI 条目保持 `integrated`，未标 `verified`。
- P6 统计洞察仍锁定，尚无经产品确认的首批 Insight 定义。

## 当时的关键产品与架构约束

- 正式课程事实只来自用户明确提交的手工表单；上传、预览或删除 Source 不写入课程事实。
- P4 发布模式为 `MANUAL_ONLY`：不含远程模型凭据/调用、自动解析、候选审核或规划助手。
- 日期按课程时区解释；纯日期不伪装为 UTC instant；Reading Week 通过日历例外抑制派生课节。
- 成绩使用整数基点，`10000 = 100%`；未知值保持未知，未出分不按零分。
- `packages/core` 是领域规则单一来源；UI 只消费 view model/contract，跨模块只走公开 interface。

这些是第一次尝试的已签署约束。重新规划时应逐项显式确认、继承或通过新的产品决策替换，不应把本归档当作活跃需求文件。

## 归档前验证

在 2026-08-17 使用桌面工作区提供的 Node 运行时执行：

- `pnpm exec vitest run packages/core/src/p1-domain.test.ts tests/unit/p1-interfaces.test.ts tests/unit/p5-letter-grade-state-interface.test.ts`：通过，3 个文件、10 个测试。
- `pnpm typecheck`：通过，7 个工作区项目完成检查。
- 清空前补丁的 `git diff --check`：无空白错误，仅有 Git for Windows 的 LF/CRLF 提示。

第一次执行上述两条命令时，当前 shell 的 `PATH` 缺少 Node，命令在进入测试/编译前退出；补入工作区 Node 路径后重跑得到以上通过结果。本次归档没有再次运行完整 `pnpm gate:p4`。

## 恢复方式

1. 从 Git 历史新建分支并回到基线：`git switch -c recover/attempt-1 c68f49492bb8a5e64c4271d9bb7f2a573609dd1f`。
2. 从本文件的 `BEGIN WORKTREE PATCH` 与 `END WORKTREE PATCH` 标记之间提取内容为补丁。
3. 将补丁中独占一行的 `␠` 解码为一个 ASCII 空格；它表示 unified diff 的空白上下文行，并避免归档文件自身携带尾随空白。
4. 在基线工作树运行 `git apply --index <补丁文件>`。

这样可恢复所有已跟踪内容以及清空前的 8 个修改文件和 1 个新增测试。忽略内容与秘密不在恢复范围内。

## BEGIN WORKTREE PATCH

```diff
diff --git a/apps/web/app/courses/[courseId]/grading/page.tsx b/apps/web/app/courses/[courseId]/grading/page.tsx
index e7fad70..71ba05a 100644
--- a/apps/web/app/courses/[courseId]/grading/page.tsx
+++ b/apps/web/app/courses/[courseId]/grading/page.tsx
@@ -31,22 +31,24 @@ export default async function GradebookPage({
     planning.listGradingSchemes(scope, asCourseId(courseId)),
     planning.listLetterGradeScales(scope),
   ]);
-  const gradebook =
-    creatingAlternative && currentGradebook !== null
-      ? {
-          ...currentGradebook,
-          components: [],
-          currentLetter: null,
-          earnedCourseBps: null,
-          gradedPortionPercentBps: null,
-          gradedWeightBps: 0,
-          scheme: null,
-          ungradedCount: 0,
-          unknownWeightResultCount: 0,
-          warnings: [],
-        }
-      : currentGradebook;
-  if (course === null || gradebook === null) notFound();
+  if (course === null || currentGradebook === null) notFound();
+  const gradebook = creatingAlternative
+    ? {
+        ...currentGradebook,
+        components: [],
+        earnedCourseBps: null,
+        gradedPortionPercentBps: null,
+        gradedWeightBps: 0,
+        letterGrade:
+          course.course.letterGradeScaleId === null
+            ? ({ state: "unconfigured" } as const)
+            : ({ state: "awaiting_result" } as const),
+        scheme: null,
+        ungradedCount: 0,
+        unknownWeightResultCount: 0,
+        warnings: [],
+      }
+    : currentGradebook;
   const editorPrimary = creatingAlternative
     ? schemes.length === 0
     : (gradebook.scheme?.isPrimary ?? schemes.length === 0);
@@ -84,8 +86,14 @@ export default async function GradebookPage({
                 不计算 GPA、不预测最终成绩；字母等级仅在用户明确配置等级表时出现
               </p>
             </div>
-            {gradebook.currentLetter === null ? null : (
-              <span className="status-label">当前 {gradebook.currentLetter}</span>
+            {gradebook.letterGrade.state === "available" ? (
+              <span className="status-label">当前 {gradebook.letterGrade.letter} · 已出分部分</span>
+            ) : gradebook.letterGrade.state === "unconfigured" ? (
+              <span className="status-label" data-tone="warning">
+                等级表未启用
+              </span>
+            ) : (
+              <span className="status-label">等待已出分结果</span>
             )}
           </div>
           <div className="grade-summary-grid">
@@ -102,6 +110,20 @@ export default async function GradebookPage({
               <span>覆盖总评权重</span>
             </div>
           </div>
+          {gradebook.letterGrade.state === "unconfigured" ? (
+            <div className="panel-body">
+              <div className="status-banner" data-tone="warning">
+                字母等级未启用：当前只显示手工成绩的百分比与覆盖权重。请先确认并绑定 A/B/C/D/F
+                等级表；CourseFlow 不提供学校默认值，也不计算 GPA。
+              </div>
+            </div>
+          ) : gradebook.letterGrade.state === "awaiting_result" ? (
+            <div className="panel-body">
+              <div className="status-banner">
+                等级表已绑定；目前没有已出分且权重已知的组成。字母等级保持待定，不按 F 或 0 分处理。
+              </div>
+            </div>
+          ) : null}
           {gradebook.unknownWeightResultCount === 0 ? null : (
             <div className="panel-body">
               <div className="status-banner" data-tone="warning">
diff --git a/docs/architecture/INTERFACES.md b/docs/architecture/INTERFACES.md
index de7437d..8d7f2aa 100644
--- a/docs/architecture/INTERFACES.md
+++ b/docs/architecture/INTERFACES.md
@@ -21,6 +21,10 @@ interface AcademicsService {
   setActiveTerm(scope: UserScope, termId: TermId): Promise<void>;
   createCourseSetup(scope: UserScope, input: CreateCourseSetupInput): Promise<CourseView>;
   saveMeetingException(scope: UserScope, input: SaveMeetingExceptionInput): Promise<void>;
+  setCourseLetterGradeScale(
+    scope: UserScope,
+    input: SetCourseLetterGradeScaleInput,
+  ): Promise<CourseView>;
 }
 ```
␠
@@ -34,9 +38,20 @@ interface PlanningService {
   saveTaskLabel(scope: UserScope, input: SaveTaskLabelInput): Promise<TaskLabelView>;
   saveGradingScheme(scope: UserScope, input: SaveGradingSchemeInput): Promise<GradebookView>;
   saveGradeResult(scope: UserScope, input: SaveGradeResultInput): Promise<GradebookView>;
+  saveLetterGradeScale(
+    scope: UserScope,
+    input: SaveLetterGradeScaleInput,
+  ): Promise<LetterGradeScaleView>;
+  getGradebook(
+    scope: UserScope,
+    courseId: CourseId,
+    schemeId?: GradingSchemeId,
+  ): Promise<GradebookView | null>;
 }
 ```
␠
+`GradebookView.letterGrade` 是显式状态：未绑定等级表为 `unconfigured`；已绑定但没有已出分且已知权重的结果为 `awaiting_result`；只有正式投影能够换算时才返回 `available` 与 A/B/C/D/F。页面不得从百分比自行重算字母等级。
+
 ### 2.3 Sources
␠
 ```ts
diff --git a/docs/design/UI_INTEGRATION_LOG.md b/docs/design/UI_INTEGRATION_LOG.md
index 0c2b5dc..c24a3ea 100644
--- a/docs/design/UI_INTEGRATION_LOG.md
+++ b/docs/design/UI_INTEGRATION_LOG.md
@@ -19,6 +19,7 @@
 | UI-0004 | P3 Sources 手工闭环 | frozen + verified | `/sources` → 既有手工表单 → Timeline/Dashboard |
 | UI-0005 | P5 Tasks 完成闭环 | integrated + verified | `/tasks` → `planning.setCourseItemState` → `schedule.getTaskBoard` |
 | UI-0006 | P5 Gradebook 未知权重 partial 状态 | integrated | 手工结果 → `planning.saveGradeResult` → `planning.getGradebook` |
+| UI-0007 | P5 Gradebook 等级表 partial 状态 | integrated | 手工等级表/绑定 → `planning.getGradebook` 显式等级状态 |
␠
 状态只用 `received/mapped/prototyped/frozen/integrated/verified/superseded` 加必要限定。被替代条目保留历史说明，但不进入当前 route/状态矩阵。
␠
@@ -61,6 +62,16 @@
 - 可见映射：复用既有 warning banner、summary card、Grade Component row、语义 token 与 focus ring；不增加新色彩、图标或视觉方向。
 - 验收：目标 interface test、canonical E2E、1280x900 浅/深主题、200% zoom、键盘/focus、reduced-motion、console、screenshot 与 `pnpm gate:p4`。
␠
+## UI-0007：P5 Gradebook 等级表 partial 状态
+
+- 输入/矩阵：`ui-v1` tombstone 保留的非 AI token/component family 派生行；`/courses/[courseId]/grading`、`partial_letter_grade_unconfigured`、`1280x900` light 为像素检查，dark 与 200% 为功能等价检查。
+- 用户场景：已有手工出分但课程尚未绑定等级表时，页面继续显示已出分百分比与覆盖权重，并明确说明字母等级未启用；用户手工确认并绑定 A/B/C/D/F 边界后，页面显示正式 Gradebook 投影给出的字母等级。
+- interface：等级表写入只调用 `planning.saveLetterGradeScale`，课程关联只调用 `academics.setCourseLetterGradeScale(expectedVersion)`；刷新只读取 `planning.getGradebook(courseId, schemeId?)` 的显式 `letterGrade` 状态，不在组件内换算边界。
+- 边界：绑定等级表但没有已出分且已知权重的组成时显示 `awaiting_result`，不显示 F、0 或预测；409 冲突保留选择并聚焦持久错误。
+- 可见映射：复用既有 warning/info banner、summary card、等级状态 label、语义 token 与 focus ring；不增加新色彩、图标或视觉方向。
+- 验收：目标 interface test、canonical E2E、1280x900 浅/深主题、200% zoom、键盘/focus、reduced-motion、console、screenshot 与 `pnpm gate:p4`。
+- 当前验证：已通过完整 `pnpm gate:p4`，覆盖依赖健康、迁移、format、lint、typecheck、全量 unit、P3 PostgreSQL/S3 contract、MANUAL_ONLY、production build、canonical E2E 与 security；canonical E2E 产出了 1280x900 light 截图。第二轮使用干净内置 Browser 会话复验时，宿主健康端点与目标课程页均为 HTTP 200，但 `https://example.com` 与 `https://www.google.com` 连续超时并停留在 `about:blank`，直接本机健康端点稳定返回 `ERR_BLOCKED_BY_CLIENT`；1280x900 阻断截图为空白页且 console 为空。故障位于 Browser 导航通道而非 CourseFlow 渲染层，已达到反复失败条件；Browser 专项的主题、200% zoom、键盘/focus、reduced-motion 与页面 console 仍无法验证，本条保持 `integrated`，不标 `verified`。
+
 ## UI-0002：个人中心
␠
 - 历史输入把头像 overlay、账户摘要和普通偏好与未冻结的条件方案混在同一原型。
diff --git a/packages/core/src/p1-domain.test.ts b/packages/core/src/p1-domain.test.ts
index 6dbd3ca..4ec055b 100644
--- a/packages/core/src/p1-domain.test.ts
+++ b/packages/core/src/p1-domain.test.ts
@@ -166,10 +166,10 @@ describe("P1 Gradebook invariants", () => {
     };
␠
     expect(projectGradebook(scheme.courseId, scheme, null)).toMatchObject({
-      currentLetter: null,
       earnedCourseBps: 1_600,
       gradedPortionPercentBps: 8_000,
       gradedWeightBps: 2_000,
+      letterGrade: { state: "unconfigured" },
       ungradedCount: 1,
     });
   });
diff --git a/packages/core/src/planning/rules.ts b/packages/core/src/planning/rules.ts
index 6466114..ec01942 100644
--- a/packages/core/src/planning/rules.ts
+++ b/packages/core/src/planning/rules.ts
@@ -347,12 +347,16 @@ export function validateLetterGradeBands(
   return expected.map((letter) => ({ letter, minimumPercentBps: byLetter.get(letter)! }));
 }
␠
-function letterFor(
+function projectLetterGrade(
   percentBps: number | null,
   scale: LetterGradeScale | null,
-): GradebookSnapshot["currentLetter"] {
-  if (percentBps === null || scale === null) return null;
-  return scale.bands.find((band) => percentBps >= band.minimumPercentBps)?.letter ?? null;
+): GradebookSnapshot["letterGrade"] {
+  if (scale === null) return { state: "unconfigured" };
+  if (percentBps === null) return { state: "awaiting_result" };
+  return {
+    letter: scale.bands.find((band) => percentBps >= band.minimumPercentBps)!.letter,
+    state: "available",
+  };
 }
␠
 export function projectGradebook(
@@ -364,10 +368,10 @@ export function projectGradebook(
     return {
       components: [],
       courseId,
-      currentLetter: null,
       earnedCourseBps: null,
       gradedPortionPercentBps: null,
       gradedWeightBps: 0,
+      letterGrade: projectLetterGrade(null, scale),
       scheme: null,
       unknownWeightResultCount: 0,
       ungradedCount: 0,
@@ -435,10 +439,10 @@ export function projectGradebook(
   return {
     components,
     courseId: scheme.courseId,
-    currentLetter: letterFor(gradedPortionPercentBps, scale),
     earnedCourseBps,
     gradedPortionPercentBps,
     gradedWeightBps,
+    letterGrade: projectLetterGrade(gradedPortionPercentBps, scale),
     scheme: {
       conditionText: scheme.conditionText,
       courseId: scheme.courseId,
diff --git a/packages/core/src/planning/types.ts b/packages/core/src/planning/types.ts
index 1b7e184..ab533ea 100644
--- a/packages/core/src/planning/types.ts
+++ b/packages/core/src/planning/types.ts
@@ -101,6 +101,11 @@ export type LetterGradeScale = Readonly<{
   version: number;
 }>;
␠
+export type LetterGradeProjection =
+  | Readonly<{ state: "unconfigured" }>
+  | Readonly<{ state: "awaiting_result" }>
+  | Readonly<{ letter: LetterGradeBand["letter"]; state: "available" }>;
+
 export type GradebookComponentView = GradeComponent &
   Readonly<{
     contributionCourseBps: number | null;
@@ -110,10 +115,10 @@ export type GradebookComponentView = GradeComponent &
 export type GradebookSnapshot = Readonly<{
   components: readonly GradebookComponentView[];
   courseId: CourseId;
-  currentLetter: "A" | "B" | "C" | "D" | "F" | null;
   earnedCourseBps: number | null;
   gradedPortionPercentBps: number | null;
   gradedWeightBps: number;
+  letterGrade: LetterGradeProjection;
   scheme: Omit<GradingScheme, "components"> | null;
   unknownWeightResultCount: number;
   ungradedCount: number;
diff --git a/tests/e2e/p1-manual-loop.spec.ts b/tests/e2e/p1-manual-loop.spec.ts
index 992ae87..013b466 100644
--- a/tests/e2e/p1-manual-loop.spec.ts
+++ b/tests/e2e/p1-manual-loop.spec.ts
@@ -347,6 +347,9 @@ test("canonical P1–P3 manual plan survives PostgreSQL and private object stora
   await expect(
     page.locator(".grade-summary").filter({ hasText: "覆盖总评权重" }).locator("strong"),
   ).toHaveText("20%");
+  await expect(
+    page.getByText(/字母等级未启用：当前只显示手工成绩的百分比与覆盖权重/u),
+  ).toBeVisible();
␠
   const quizzesEarned = page.getByLabel("Weekly quizzes 得分");
   await quizzesEarned.fill("90");
@@ -362,12 +365,36 @@ test("canonical P1–P3 manual plan survives PostgreSQL and private object stora
     page.locator(".grade-summary").filter({ hasText: "覆盖总评权重" }).locator("strong"),
   ).toHaveText("20%");
␠
+  await page.locator("#scale-name").fill("学校已确认等级表");
+  await page.locator("#band-A").fill("85");
+  await page.locator("#band-B").fill("70");
+  await page.locator("#band-C").fill("60");
+  await page.locator("#band-D").fill("50");
+  await page.getByRole("button", { name: "确认并保存这组边界" }).click();
+  await expect(
+    page.getByText("等级表已保存。请在刷新后显式绑定到课程；不会用于 GPA。"),
+  ).toBeVisible();
+  await expect(page.locator("#grade-scale")).not.toHaveValue("");
+  await page.getByRole("button", { name: "绑定所选等级表" }).click();
+  await expect(page.getByText("等级表已绑定；当前字母等级只按已出分部分显示。")).toBeVisible();
+  await expect(page.getByText("当前 B · 已出分部分")).toBeVisible();
+  await expect(page.getByText(/字母等级未启用：当前只显示手工成绩的百分比与覆盖权重/u)).toHaveCount(
+    0,
+  );
+  await page.evaluate(() => window.scrollTo({ top: 0 }));
+  await page.screenshot({
+    animations: "disabled",
+    fullPage: false,
+    path: "test-results/canonical-p5-gradebook-letter-grade-1280x900.png",
+  });
+
   await page.reload();
   await expect(
     page.locator(".grade-summary").filter({ hasText: "已获总评百分点" }).locator("strong"),
   ).toHaveText("16%");
   await expect(page.getByText("Final").first()).toBeVisible();
   await expect(page.getByText(/覆盖口径不完整：已录入的 1 个成绩因权重未知/u)).toBeVisible();
+  await expect(page.getByText("当前 B · 已出分部分")).toBeVisible();
␠
   const dashboardApi = await request.get("/api/v1/dashboard?termId=" + termId);
   const tasksApi = await request.get("/api/v1/tasks?termId=" + termId);
diff --git a/tests/unit/p1-interfaces.test.ts b/tests/unit/p1-interfaces.test.ts
index c616e70..923c5fb 100644
--- a/tests/unit/p1-interfaces.test.ts
+++ b/tests/unit/p1-interfaces.test.ts
@@ -121,10 +121,10 @@ describe("P1 Academics/Planning interfaces", () => {
       ]),
     );
     await expect(planning.getGradebook(owner, course.value.course.id)).resolves.toMatchObject({
-      currentLetter: "B",
       earnedCourseBps: 1_600,
       gradedPortionPercentBps: 8_000,
       gradedWeightBps: 2_000,
+      letterGrade: { letter: "B", state: "available" },
       ungradedCount: 1,
     });
   });
diff --git a/tests/unit/p5-letter-grade-state-interface.test.ts b/tests/unit/p5-letter-grade-state-interface.test.ts
new file mode 100644
index 0000000..f61ce3d
--- /dev/null
+++ b/tests/unit/p5-letter-grade-state-interface.test.ts
@@ -0,0 +1,90 @@
+import { describe, expect, it } from "vitest";
+import { asUserId, createAcademics, createPlanning, type UserScope } from "@courseflow/core";
+import {
+  FixedClock,
+  MemoryCourseFlowRepository,
+  SequenceIdGenerator,
+} from "@courseflow/test-support";
+
+const ids = Array.from(
+  { length: 20 },
+  (_, index) => `00000000-0000-4000-8200-${String(index + 1).padStart(12, "0")}`,
+);
+
+describe("P5 letter-grade partial-state public interfaces", () => {
+  it("distinguishes an unconfigured scale, an available letter, and a bound scale awaiting results", async () => {
+    const repository = new MemoryCourseFlowRepository({
+      clock: new FixedClock("2026-08-14T00:00:00.000Z"),
+      ids: new SequenceIdGenerator(ids),
+    });
+    const academics = createAcademics(repository);
+    const planning = createPlanning(repository);
+    const owner: UserScope = { userId: asUserId("00000000-0000-4000-9200-000000000001") };
+    const term = await academics.createTerm(owner, {
+      endDate: "2026-12-18",
+      name: "2026 Fall",
+      startDate: "2026-09-08",
+      timeZone: "Asia/Shanghai",
+    });
+    const course = await academics.createCourseWithSchedule(owner, {
+      code: "CSC-P5-LG",
+      colorKey: "orange",
+      meetingPatterns: [],
+      termId: term.value.id,
+      title: "Letter Grade States",
+    });
+    const scheme = await planning.saveGradingScheme(owner, {
+      components: [
+        { title: "Midterm", weightBps: 2_000 },
+        { title: "Final", weightBps: 8_000 },
+      ],
+      courseId: course.value.course.id,
+      isPrimary: true,
+      name: "Default",
+    });
+    const result = await planning.saveGradeResult(owner, {
+      earned: "80",
+      gradeComponentId: scheme.value.components[0]!.id,
+      possible: "100",
+    });
+
+    await expect(planning.getGradebook(owner, course.value.course.id)).resolves.toMatchObject({
+      gradedPortionPercentBps: 8_000,
+      gradedWeightBps: 2_000,
+      letterGrade: { state: "unconfigured" },
+    });
+
+    const scale = await planning.saveLetterGradeScale(owner, {
+      bands: [
+        { letter: "A", minimumPercentBps: 8_500 },
+        { letter: "B", minimumPercentBps: 7_000 },
+        { letter: "C", minimumPercentBps: 6_000 },
+        { letter: "D", minimumPercentBps: 5_000 },
+        { letter: "F", minimumPercentBps: 0 },
+      ],
+      name: "Confirmed scale",
+    });
+    await academics.setCourseLetterGradeScale(owner, {
+      courseId: course.value.course.id,
+      expectedVersion: course.value.course.version,
+      letterGradeScaleId: scale.value.id,
+    });
+
+    await expect(planning.getGradebook(owner, course.value.course.id)).resolves.toMatchObject({
+      gradedPortionPercentBps: 8_000,
+      gradedWeightBps: 2_000,
+      letterGrade: { letter: "B", state: "available" },
+    });
+
+    await planning.deleteGradeResult(owner, {
+      expectedVersion: result.value.version,
+      gradeComponentId: scheme.value.components[0]!.id,
+    });
+    await expect(planning.getGradebook(owner, course.value.course.id)).resolves.toMatchObject({
+      earnedCourseBps: null,
+      gradedPortionPercentBps: null,
+      gradedWeightBps: 0,
+      letterGrade: { state: "awaiting_result" },
+    });
+  });
+});
```

## END WORKTREE PATCH
