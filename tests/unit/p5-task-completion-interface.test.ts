import { describe, expect, it } from "vitest";
import {
  asUserId,
  createAcademics,
  createPlanning,
  createSchedule,
  type UserScope,
} from "@courseflow/core";
import {
  FixedClock,
  MemoryCourseFlowRepository,
  SequenceIdGenerator,
} from "@courseflow/test-support";

const ids = Array.from(
  { length: 20 },
  (_, index) => `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);

describe("P5 task completion public interface", () => {
  it("removes a completed Course Item from the task projection while retaining formal history", async () => {
    const clock = new FixedClock("2026-09-09T13:00:00.000Z");
    const repository = new MemoryCourseFlowRepository({
      clock,
      ids: new SequenceIdGenerator(ids),
    });
    const academics = createAcademics(repository);
    const planning = createPlanning(repository);
    const schedule = createSchedule(repository, { clock });
    const owner: UserScope = {
      userId: asUserId("50000000-0000-4000-9000-000000000001"),
    };

    const term = await academics.createTerm(owner, {
      endDate: "2026-12-18",
      name: "2026 Fall",
      startDate: "2026-09-08",
      timeZone: "America/Toronto",
    });
    const course = await academics.createCourseWithSchedule(owner, {
      code: "CSC258H5",
      colorKey: "orange",
      meetingPatterns: [],
      termId: term.value.id,
      title: "Computer Organization",
    });
    const item = await planning.createCourseItem(owner, {
      courseId: course.value.course.id,
      kind: "assignment",
      temporal: { date: "2026-09-09", kind: "date" },
      title: "完成长标题事项：Problem Set 二（草稿）",
    });

    const before = await schedule.getTaskBoard(owner, { termId: term.value.id });
    expect(before?.groups.priority.map((candidate) => candidate.id)).toContain(item.value.id);

    await expect(
      planning.setCourseItemState(owner, {
        expectedVersion: 0,
        itemId: item.value.id,
        state: "completed",
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT", latestVersion: 1 });
    expect(
      (await schedule.getTaskBoard(owner, { termId: term.value.id }))?.groups.priority.map(
        (candidate) => candidate.id,
      ),
    ).toContain(item.value.id);

    const completion = await planning.setCourseItemState(owner, {
      expectedVersion: item.value.version,
      itemId: item.value.id,
      state: "completed",
    });
    expect(completion.value).toMatchObject({ id: item.value.id, state: "completed", version: 2 });

    const after = await schedule.getTaskBoard(owner, { termId: term.value.id });
    expect(Object.values(after!.groups).flat()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: item.value.id })]),
    );
    await expect(planning.getCoursePlanning(owner, course.value.course.id)).resolves.toMatchObject({
      items: [expect.objectContaining({ id: item.value.id, state: "completed", version: 2 })],
    });
    await expect(
      schedule.getCourseTimeline(owner, {
        courseId: course.value.course.id,
        termId: term.value.id,
      }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: item.value.id, state: "completed", taskGroup: null })],
    });
  });
});
