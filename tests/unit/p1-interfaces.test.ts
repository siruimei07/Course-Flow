import { describe, expect, it } from "vitest";
import { asUserId, createAcademics, createPlanning, type UserScope } from "@courseflow/core";
import {
  FixedClock,
  MemoryCourseFlowRepository,
  SequenceIdGenerator,
} from "@courseflow/test-support";

const ids = Array.from(
  { length: 50 },
  (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);

describe("P1 Academics/Planning interfaces", () => {
  it("persists the manual loop, hides foreign records and rejects stale versions", async () => {
    const repository = new MemoryCourseFlowRepository({
      clock: new FixedClock("2026-08-13T00:00:00.000Z"),
      ids: new SequenceIdGenerator(ids),
    });
    const academics = createAcademics(repository);
    const planning = createPlanning(repository);
    const owner: UserScope = { userId: asUserId("00000000-0000-4000-9000-000000000001") };
    const stranger: UserScope = { userId: asUserId("00000000-0000-4000-9000-000000000002") };

    const term = await academics.createTerm(owner, {
      endDate: "2026-12-18",
      name: "2026 Fall",
      readingWeeks: [{ endDate: "2026-10-16", name: "Reading Week", startDate: "2026-10-12" }],
      startDate: "2026-09-08",
      timeZone: "America/Toronto",
    });
    const course = await academics.createCourseWithSchedule(owner, {
      code: "CSC258H5",
      colorKey: "orange",
      meetingPatterns: [
        { kind: "lecture", localEndTime: "11:00", localStartTime: "10:00", weekdays: [0] },
        { kind: "tutorial", localEndTime: "13:00", localStartTime: "12:00", weekdays: [1] },
        { kind: "practical", localEndTime: "16:00", localStartTime: "14:00", weekdays: [2] },
      ],
      termId: term.value.id,
      title: "Computer Organization",
    });
    const label = await planning.saveTaskLabel(owner, {
      colorKey: "purple",
      displayName: "Needs Review",
      termId: term.value.id,
    });
    const item = await planning.createCourseItem(owner, {
      courseId: course.value.course.id,
      kind: "assignment",
      labelIds: [label.value.id],
      temporal: { date: "2026-09-30", kind: "date" },
      title: "Problem Set 1",
    });
    const scheme = await planning.saveGradingScheme(owner, {
      components: [
        { title: "Midterm", weightBps: 2_000 },
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
    const alternative = await planning.saveGradingScheme(owner, {
      components: [{ ruleText: "Exam-heavy alternative", title: "Final", weightBps: 10_000 }],
      courseId: course.value.course.id,
      isPrimary: false,
      name: "Alternative",
    });
    const scale = await planning.saveLetterGradeScale(owner, {
      bands: [
        { letter: "A", minimumPercentBps: 8_500 },
        { letter: "B", minimumPercentBps: 7_000 },
        { letter: "C", minimumPercentBps: 6_000 },
        { letter: "D", minimumPercentBps: 5_000 },
        { letter: "F", minimumPercentBps: 0 },
      ],
      name: "Confirmed scale",
    });
    await academics.setCourseLetterGradeScale(owner, {
      courseId: course.value.course.id,
      expectedVersion: course.value.course.version,
      letterGradeScaleId: scale.value.id,
    });

    await expect(academics.getCourse(stranger, course.value.course.id)).resolves.toBeNull();
    await expect(planning.getCoursePlanning(stranger, course.value.course.id)).resolves.toBeNull();
    await expect(planning.getGradebook(stranger, course.value.course.id)).resolves.toBeNull();
    await expect(academics.listTerms(stranger)).resolves.toEqual([]);

    await expect(
      academics.updateTerm(owner, {
        expectedVersion: 0,
        name: "Stale overwrite",
        termId: term.value.id,
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT", latestVersion: 1 });
    await expect(
      planning.saveGradingScheme(owner, {
        components: scheme.value.components,
        courseId: course.value.course.id,
        expectedVersion: 0,
        isPrimary: true,
        name: "Stale scheme",
        schemeId: scheme.value.id,
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT", latestVersion: 1 });

    await expect(planning.getCoursePlanning(owner, course.value.course.id)).resolves.toMatchObject({
      items: [{ id: item.value.id, labels: [{ id: label.value.id }] }],
    });
    await expect(planning.listGradingSchemes(owner, course.value.course.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: scheme.value.id, isPrimary: true }),
        expect.objectContaining({ id: alternative.value.id, isPrimary: false }),
      ]),
    );
    await expect(planning.getGradebook(owner, course.value.course.id)).resolves.toMatchObject({
      currentLetter: "B",
      earnedCourseBps: 1_600,
      gradedPortionPercentBps: 8_000,
      gradedWeightBps: 2_000,
      ungradedCount: 1,
    });
  });
});
