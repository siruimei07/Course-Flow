import { describe, expect, it } from "vitest";
import { asUserId, createAcademics, createPlanning, type UserScope } from "@courseflow/core";
import {
  FixedClock,
  MemoryCourseFlowRepository,
  SequenceIdGenerator,
} from "@courseflow/test-support";

const ids = Array.from(
  { length: 20 },
  (_, index) => `00000000-0000-4000-8100-${String(index + 1).padStart(12, "0")}`,
);

describe("P5 Gradebook partial-state interface", () => {
  it("keeps a published result visible but outside coverage until its weight is known", async () => {
    const repository = new MemoryCourseFlowRepository({
      clock: new FixedClock("2026-08-14T00:00:00.000Z"),
      ids: new SequenceIdGenerator(ids),
    });
    const academics = createAcademics(repository);
    const planning = createPlanning(repository);
    const owner: UserScope = { userId: asUserId("00000000-0000-4000-9100-000000000001") };
    const term = await academics.createTerm(owner, {
      endDate: "2026-12-18",
      name: "2026 Fall",
      startDate: "2026-09-08",
      timeZone: "Asia/Shanghai",
    });
    const course = await academics.createCourseWithSchedule(owner, {
      code: "CSC-P5",
      colorKey: "orange",
      meetingPatterns: [],
      termId: term.value.id,
      title: "Partial Gradebook",
    });
    const scheme = await planning.saveGradingScheme(owner, {
      components: [
        { title: "Midterm", weightBps: 2_000 },
        {
          ruleText: "Best 5 of 6；首版只展示老师公布的汇总结果",
          title: "Weekly quizzes",
          weightBps: null,
        },
        { title: "Final", weightBps: 8_000 },
      ],
      courseId: course.value.course.id,
      isPrimary: true,
      name: "Default",
    });
    await planning.saveGradeResult(owner, {
      earned: "80",
      gradeComponentId: scheme.value.components[0]!.id,
      possible: "100",
    });
    const quizzesResult = await planning.saveGradeResult(owner, {
      earned: "90",
      gradeComponentId: scheme.value.components[1]!.id,
      possible: "100",
    });

    await expect(planning.getGradebook(owner, course.value.course.id)).resolves.toMatchObject({
      earnedCourseBps: 1_600,
      gradedPortionPercentBps: 8_000,
      gradedWeightBps: 2_000,
      components: [
        { contributionCourseBps: 1_600, resultPercentBps: 8_000, title: "Midterm" },
        {
          contributionCourseBps: null,
          resultPercentBps: 9_000,
          ruleText: "Best 5 of 6；首版只展示老师公布的汇总结果",
          title: "Weekly quizzes",
        },
        { contributionCourseBps: null, resultPercentBps: null, title: "Final" },
      ],
      unknownWeightResultCount: 1,
      ungradedCount: 1,
    });

    await expect(
      planning.saveGradeResult(owner, {
        earned: "95",
        expectedVersion: 0,
        gradeComponentId: scheme.value.components[1]!.id,
        possible: "100",
      }),
    ).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      latestVersion: quizzesResult.value.version,
    });
    await expect(planning.getGradebook(owner, course.value.course.id)).resolves.toMatchObject({
      components: expect.arrayContaining([
        expect.objectContaining({
          result: expect.objectContaining({
            earnedMilli: 90_000n,
            possibleMilli: 100_000n,
            version: 1,
          }),
          resultPercentBps: 9_000,
          title: "Weekly quizzes",
        }),
      ]),
      unknownWeightResultCount: 1,
    });
  });
});
