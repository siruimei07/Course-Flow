import type { Clock } from "../runtime";
import type { CourseId, UserScope } from "../shared";
import { serializeIcs } from "./ics";
import { buildScheduleSnapshot } from "./rules";
import type {
  CalendarQuery,
  CalendarView,
  CourseTimelineQuery,
  CourseTimelineView,
  DashboardView,
  IcsExport,
  ScheduleSnapshot,
  ScheduleSnapshotQuery,
  ScheduleSnapshotRepository,
  TaskBoardQuery,
  TaskBoardView,
} from "./types";

export interface Schedule {
  exportCalendar(scope: UserScope, query: CalendarQuery): Promise<IcsExport | null>;
  getCalendar(scope: UserScope, query: CalendarQuery): Promise<CalendarView | null>;
  getCourseTimeline(
    scope: UserScope,
    query: CourseTimelineQuery,
  ): Promise<CourseTimelineView | null>;
  getDashboard(scope: UserScope, query: ScheduleSnapshotQuery): Promise<DashboardView | null>;
  getScheduleSnapshot(
    scope: UserScope,
    query: ScheduleSnapshotQuery,
  ): Promise<ScheduleSnapshot | null>;
  getTaskBoard(scope: UserScope, query: TaskBoardQuery): Promise<TaskBoardView | null>;
}

function filterCalendar(snapshot: ScheduleSnapshot, query: CalendarQuery): CalendarView {
  const courseIds = query.courseIds === undefined ? null : new Set<CourseId>(query.courseIds);
  const skippedCount =
    query.includeItems === false
      ? 0
      : snapshot.items.filter(
          (item) =>
            item.temporal.kind === "unscheduled" &&
            (courseIds === null || courseIds.has(item.course.id)),
        ).length;
  return {
    ...snapshot.calendar,
    events: snapshot.calendar.events.filter(
      (event) =>
        (courseIds === null || courseIds.has(event.course.id)) &&
        (query.includeItems !== false || event.sourceType !== "course_item") &&
        (query.includeMeetings !== false || event.sourceType !== "meeting_occurrence"),
    ),
    skipped: {
      reasons: skippedCount === 0 ? [] : [{ count: skippedCount, reason: "unscheduled" as const }],
      total: skippedCount,
    },
  };
}

export function createSchedule(
  repository: ScheduleSnapshotRepository,
  options: Readonly<{ clock: Clock }>,
): Schedule {
  async function snapshot(
    scope: UserScope,
    query: ScheduleSnapshotQuery,
  ): Promise<ScheduleSnapshot | null> {
    const source = await repository.loadScheduleSource(scope, query);
    if (source === null) return null;
    return buildScheduleSnapshot({
      generatedAt: options.clock.now().toISOString(),
      query,
      source,
    });
  }

  return {
    async exportCalendar(scope, query) {
      const value = await snapshot(scope, query);
      if (value === null) return null;
      const calendar = filterCalendar(value, query);
      return {
        content: serializeIcs(calendar.events, calendar.generatedAt, value.term.name),
        fileName: `courseflow-${
          value.term.name
            .normalize("NFKD")
            .replaceAll(/[^a-zA-Z0-9]+/gu, "-")
            .replaceAll(/^-|-$/gu, "") || "schedule"
        }.ics`,
        mimeType: "text/calendar; charset=utf-8",
        skipped: calendar.skipped,
      };
    },
    async getCalendar(scope, query) {
      const value = await snapshot(scope, query);
      return value === null ? null : filterCalendar(value, query);
    },
    async getCourseTimeline(scope, query) {
      const value = await snapshot(scope, query);
      if (value === null) return null;
      const course = value.courses.find((candidate) => candidate.id === query.courseId);
      if (course === undefined) return null;
      return {
        generatedAt: value.generatedAt,
        policyVersions: value.policyVersions,
        snapshotId: value.snapshotId,
        timeZone: value.timeZone,
        weekStartsOn: value.weekStartsOn,
        course,
        items: value.items.filter((item) => item.course.id === query.courseId),
      };
    },
    async getDashboard(scope, query) {
      return (await snapshot(scope, query))?.dashboard ?? null;
    },
    getScheduleSnapshot: snapshot,
    async getTaskBoard(scope, query) {
      const value = await snapshot(scope, query);
      if (value === null) return null;
      const labels = query.labelIds === undefined ? null : new Set(query.labelIds);
      const search = query.search?.trim().toLocaleLowerCase("zh-CN") ?? "";
      const matches = (item: ScheduleSnapshot["items"][number]) =>
        (labels === null || item.labels.some((label) => labels.has(label.id))) &&
        (search === "" ||
          `${item.course.code} ${item.title} ${item.details ?? ""}`
            .toLocaleLowerCase("zh-CN")
            .includes(search));
      const groups = {
        major: value.taskBoard.groups.major.filter(matches),
        near: value.taskBoard.groups.near.filter(matches),
        priority: value.taskBoard.groups.priority.filter(matches),
        tba: value.taskBoard.groups.tba.filter(matches),
      };
      if (query.group !== undefined) {
        for (const key of Object.keys(groups) as (keyof typeof groups)[]) {
          if (key !== query.group) groups[key] = [];
        }
      }
      return { ...value.taskBoard, groups };
    },
  };
}
