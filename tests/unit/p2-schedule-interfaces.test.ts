import { describe, expect, it } from "vitest";
import {
  asUserId,
  createAcademics,
  createPlanning,
  createSchedule,
  type Clock,
  type IdGenerator,
  type UserScope,
} from "@courseflow/core";
import { MemoryCourseFlowRepository } from "@courseflow/test-support";

const ids = [
  "10000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000001",
  "30000000-0000-4000-8000-000000000001",
  "40000000-0000-4000-8000-000000000001",
  "50000000-0000-4000-8000-000000000001",
  "60000000-0000-4000-8000-000000000001",
];

function harness() {
  let cursor = 0;
  const clock: Clock = { now: () => new Date("2026-09-09T01:30:00.000Z") };
  const generator: IdGenerator = { nextId: () => ids[cursor++]! };
  const repository = new MemoryCourseFlowRepository({ clock, ids: generator });
  return {
    academics: createAcademics(repository),
    planning: createPlanning(repository),
    schedule: createSchedule(repository, { clock }),
  };
}

const owner: UserScope = { userId: asUserId("00000000-0000-4000-8000-000000000001") };
const stranger: UserScope = { userId: asUserId("00000000-0000-4000-8000-000000000002") };

describe("P2 Schedule interface", () => {
  it("returns owner-scoped projections with a shared snapshot identity", async () => {
    const { academics, planning, schedule } = harness();
    const term = (
      await academics.createTerm(owner, {
        endDate: "2026-10-04",
        name: "2026 秋季",
        readingWeeks: [{ endDate: "2026-09-27", name: "Reading Week", startDate: "2026-09-21" }],
        startDate: "2026-09-07",
        timeZone: "Asia/Shanghai",
      })
    ).value;
    const course = (
      await academics.createCourseWithSchedule(owner, {
        code: "CSC108",
        colorKey: "blue",
        meetingPatterns: [
          {
            kind: "practical",
            localEndTime: "16:00",
            localStartTime: "14:00",
            locationText: "BA 1200",
            title: "Practical",
            weekdays: [2],
          },
        ],
        termId: term.id,
        title: "计算机科学导论",
      })
    ).value;
    await planning.createCourseItem(owner, {
      courseId: course.course.id,
      kind: "assignment",
      temporal: { date: "2026-09-10", kind: "date" },
      title: "作业一",
    });

    const snapshot = await schedule.getScheduleSnapshot(owner, { termId: term.id });
    const dashboard = await schedule.getDashboard(owner, { termId: term.id });
    const tasks = await schedule.getTaskBoard(owner, { termId: term.id });
    const calendar = await schedule.getCalendar(owner, { termId: term.id });
    const timeline = await schedule.getCourseTimeline(owner, {
      courseId: course.course.id,
      termId: term.id,
    });

    expect(snapshot).not.toBeNull();
    expect(dashboard?.snapshotId).toBe(snapshot?.snapshotId);
    expect(tasks?.snapshotId).toBe(snapshot?.snapshotId);
    expect(calendar?.snapshotId).toBe(snapshot?.snapshotId);
    expect(timeline?.snapshotId).toBe(snapshot?.snapshotId);
    expect(dashboard?.nextMeeting?.title).toBe("Practical");
    expect(tasks?.groups.priority).toHaveLength(1);
    expect(calendar?.events.map((event) => event.sourceType)).toEqual([
      "meeting_occurrence",
      "course_item",
      "meeting_occurrence",
      "meeting_occurrence",
    ]);
  });

  it("does not reveal another user's term through any Schedule query", async () => {
    const { academics, schedule } = harness();
    const term = (
      await academics.createTerm(owner, {
        endDate: "2026-10-04",
        name: "private",
        startDate: "2026-09-07",
        timeZone: "Asia/Shanghai",
      })
    ).value;

    await expect(schedule.getScheduleSnapshot(stranger, { termId: term.id })).resolves.toBeNull();
    await expect(schedule.getDashboard(stranger, { termId: term.id })).resolves.toBeNull();
    await expect(schedule.exportCalendar(stranger, { termId: term.id })).resolves.toBeNull();
  });
});
