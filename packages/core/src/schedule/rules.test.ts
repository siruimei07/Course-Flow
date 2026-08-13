import { describe, expect, it } from "vitest";
import {
  asCalendarExceptionId,
  asCourseId,
  asCourseItemId,
  asMeetingPatternId,
  asTermId,
  buildScheduleSnapshot,
  type AcademicCalendarException,
  type AcademicTerm,
  type Course,
  type CourseItem,
  type CourseSetupView,
  type ScheduleProjectionInput,
} from "../index";

const term: AcademicTerm = {
  archivedAt: null,
  endDate: "2026-10-04",
  id: asTermId("10000000-0000-4000-8000-000000000001"),
  name: "2026 秋季",
  startDate: "2026-09-07",
  timeZone: "Asia/Shanghai",
  version: 1,
  weekNumberingPolicy: "teaching_weeks_v1",
};

const readingWeek: AcademicCalendarException = {
  endDate: "2026-09-27",
  id: asCalendarExceptionId("20000000-0000-4000-8000-000000000001"),
  kind: "reading_week",
  name: "Reading Week",
  startDate: "2026-09-21",
  suppressesMeetings: true,
  termId: term.id,
  version: 1,
};

const course: Course = {
  archivedAt: null,
  code: "CSC108",
  colorKey: "blue",
  creditValueMilli: 500,
  id: asCourseId("30000000-0000-4000-8000-000000000001"),
  instructorName: null,
  letterGradeScaleId: null,
  section: "L0101",
  termId: term.id,
  timeZone: "Asia/Shanghai",
  title: "计算机科学导论",
  version: 1,
};

const setup: CourseSetupView = {
  calendarExceptions: [readingWeek],
  course,
  meetingExceptions: [],
  meetingPatterns: [
    {
      archivedAt: null,
      courseId: course.id,
      effectiveEndDate: null,
      effectiveStartDate: null,
      id: asMeetingPatternId("40000000-0000-4000-8000-000000000001"),
      kind: "practical",
      localEndTime: "16:00",
      localStartTime: "14:00",
      locationText: "BA 1200",
      section: null,
      title: "Practical",
      version: 1,
      weekdays: [2],
    },
  ],
  term,
};

function item(
  suffix: string,
  kind: CourseItem["kind"],
  temporal: CourseItem["temporal"],
  options: Partial<
    Pick<CourseItem, "estimatedMinutes" | "estimateSource" | "state" | "title">
  > = {},
): CourseItem {
  return {
    courseId: course.id,
    details: null,
    estimatedMinutes: options.estimatedMinutes ?? null,
    estimateSource: options.estimateSource ?? null,
    id: asCourseItemId(`50000000-0000-4000-8000-${suffix.padStart(12, "0")}`),
    kind,
    labels: [],
    progressBps: null,
    state: options.state ?? "planned",
    temporal,
    title: options.title ?? `${kind}-${suffix}`,
    version: 1,
  };
}

function fixture(
  generatedAt = "2026-09-09T01:30:00.000Z",
  displayTimeZone = "Asia/Shanghai",
): ScheduleProjectionInput {
  const items = [
    item("1", "assignment", { date: "2026-09-10", kind: "date", note: null }),
    item("2", "reading", { date: "2026-09-16", kind: "date", note: null }),
    item("3", "exam", { date: "2026-09-12", kind: "date", note: null }),
    item(
      "4",
      "project",
      { date: "2026-09-30", kind: "date", note: null },
      { estimatedMinutes: 600, estimateSource: "user" },
    ),
    item("5", "assignment", { date: "2026-09-30", kind: "date", note: null }),
    item("6", "project", { kind: "unscheduled", note: "awaiting registrar" }),
    item(
      "7",
      "lab",
      {
        endsAt: "2026-09-09T07:30:00.000Z",
        kind: "interval",
        note: null,
        startsAt: "2026-09-09T06:30:00.000Z",
        timeZone: "Asia/Shanghai",
      },
      { title: "实验占用" },
    ),
    item(
      "8",
      "quiz",
      {
        endsAt: "2026-09-09T09:00:00.000Z",
        kind: "interval",
        note: null,
        startsAt: "2026-09-09T08:00:00.000Z",
        timeZone: "Asia/Shanghai",
      },
      { title: "相邻但不重叠" },
    ),
    item(
      "9",
      "assignment",
      { date: "2026-09-17", kind: "date", note: null },
      { state: "completed" },
    ),
    item(
      "10",
      "project",
      { date: "2026-09-18", kind: "date", note: null },
      { estimatedMinutes: 10_000, estimateSource: "user", state: "cancelled" },
    ),
  ];
  return {
    generatedAt,
    query: { displayTimeZone, termId: term.id },
    source: {
      calendarExceptions: [readingWeek],
      courseSetups: [setup],
      items: items.map((value) => ({ item: value, updatedAt: generatedAt })),
      labels: [],
      locale: "zh-CN",
      term,
      timeZone: displayTimeZone,
      weekStartsOn: 0,
    },
  };
}

describe("ScheduleSnapshot", () => {
  it("derives all P2 projections from one snapshot and respects task boundaries", () => {
    const snapshot = buildScheduleSnapshot(fixture());

    expect(snapshot.snapshotId).toMatch(/^schedule-/u);
    expect(snapshot.dashboard.snapshotId).toBe(snapshot.snapshotId);
    expect(snapshot.calendar.snapshotId).toBe(snapshot.snapshotId);
    expect(snapshot.taskBoard.snapshotId).toBe(snapshot.snapshotId);
    expect(snapshot.taskBoard.groups.priority.map((value) => value.id)).toContain(
      asCourseItemId("50000000-0000-4000-8000-000000000001"),
    );
    expect(snapshot.taskBoard.groups.near.map((value) => value.id)).toContain(
      asCourseItemId("50000000-0000-4000-8000-000000000002"),
    );
    expect(snapshot.taskBoard.groups.major.map((value) => value.id)).toContain(
      asCourseItemId("50000000-0000-4000-8000-000000000003"),
    );
    expect(snapshot.taskBoard.groups.tba).toHaveLength(1);
    expect(snapshot.items.some((value) => value.state === "cancelled")).toBe(false);
    expect(snapshot.items.find((value) => value.state === "completed")?.taskGroup).toBeNull();
    expect(snapshot.heatmap.unscheduledCount).toBe(1);
    expect(snapshot.heatmap.maxMinutes).toBeLessThan(10_000);
  });

  it("pauses meetings and teaching-week progress for Reading Week", () => {
    const during = buildScheduleSnapshot(fixture("2026-09-23T04:00:00.000Z"));
    const after = buildScheduleSnapshot(fixture("2026-09-30T04:00:00.000Z"));

    expect(during.meetings.some((meeting) => meeting.originalDate === "2026-09-23")).toBe(false);
    expect(during.termProgress).toMatchObject({ isPaused: true, teachingWeekNumber: 2 });
    expect(after.termProgress).toMatchObject({ isPaused: false, teachingWeekNumber: 3 });
  });

  it.each([
    ["in progress", "2026-09-09T06:30:00.000Z", true, "2026-09-09"],
    ["cross day", "2026-09-09T09:30:00.000Z", false, "2026-09-16"],
    ["none", "2026-10-05T09:30:00.000Z", null, null],
  ] as const)("selects the next meeting state: %s", (_name, now, isToday, originalDate) => {
    const next = buildScheduleSnapshot(fixture(now)).dashboard.nextMeeting;
    expect(next?.isToday ?? null).toBe(isToday);
    expect(next?.originalDate ?? null).toBe(originalDate);
  });

  it("uses half-open intervals and distinguishes hard conflicts from deadline clusters", () => {
    const snapshot = buildScheduleSnapshot(fixture());

    const hard = snapshot.conflicts.filter((conflict) => conflict.kind === "hard_overlap");
    const clusters = snapshot.conflicts.filter((conflict) => conflict.kind === "deadline_cluster");
    expect(hard).toHaveLength(1);
    expect(hard[0]?.description).toContain("实验占用");
    expect(hard[0]?.description).not.toContain("相邻但不重叠");
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ date: "2026-09-30", severity: "warning" });
    expect(snapshot.conflicts.some((conflict) => conflict.kind === "unknown_schedule")).toBe(true);
  });

  it("buckets exact instants in the selected display time zone", () => {
    const source = fixture("2026-09-09T01:30:00.000Z", "UTC");
    const deadline = item("11", "assignment", {
      at: "2026-09-09T16:30:00.000Z",
      kind: "deadline",
      note: null,
      timeZone: "Asia/Shanghai",
    });
    const utc = buildScheduleSnapshot({
      ...source,
      source: {
        ...source.source,
        items: [...source.source.items, { item: deadline, updatedAt: source.generatedAt }],
      },
    });
    const shanghai = buildScheduleSnapshot({
      ...source,
      query: { displayTimeZone: "Asia/Shanghai", termId: term.id },
      source: {
        ...source.source,
        timeZone: "Asia/Shanghai",
        items: [...source.source.items, { item: deadline, updatedAt: source.generatedAt }],
      },
    });

    expect(utc.items.find((value) => value.id === deadline.id)?.displayDate).toBe("2026-09-09");
    expect(shanghai.items.find((value) => value.id === deadline.id)?.displayDate).toBe(
      "2026-09-10",
    );
  });

  it("keeps ICS identities stable and omits TBA entries", () => {
    const first = buildScheduleSnapshot(fixture());
    const second = buildScheduleSnapshot(fixture("2026-09-09T01:31:00.000Z"));

    expect(first.calendar.events.map((event) => event.uid)).toEqual(
      second.calendar.events.map((event) => event.uid),
    );
    expect(first.calendar.skipped.total).toBe(1);
    expect(first.calendar.events.some((event) => event.sourceId.endsWith("000000000006"))).toBe(
      false,
    );
  });
});
