import { expandMeetingOccurrences } from "../academics";
import type { CourseItem, CourseItemKind } from "../planning";
import {
  addLocalDateDays,
  compareLocalDates,
  ianaTimeZone,
  localDate,
  localDateWeekday,
  validationError,
} from "../shared";
import type { CourseId, IanaTimeZone, Instant, LocalDate } from "../shared";
import {
  schedulePolicyVersions,
  type CalendarEvent,
  type ConflictEntryView,
  type ScheduleConflictView,
  type ScheduleCourseView,
  type ScheduleItemView,
  type ScheduleMeetingView,
  type ScheduleMetadata,
  type ScheduleProjectionInput,
  type ScheduleSnapshot,
  type TaskGroupKey,
  type TermProgressView,
  type WorkloadBand,
  type WorkloadHeatmapView,
  type WorkloadSource,
  type WorkloadWeekView,
} from "./types";

const heuristicMinutes: Readonly<Record<CourseItemKind, number>> = {
  assignment: 180,
  exam: 480,
  lab: 150,
  milestone: 60,
  other: 120,
  presentation: 240,
  project: 600,
  quiz: 90,
  reading: 90,
};

const importantKinds = new Set<CourseItemKind>(["exam", "milestone", "presentation", "project"]);

const meetingKindLabels = {
  lecture: "讲课",
  other: "课节",
  practical: "实践课",
  tutorial: "辅导课",
} as const;

function dateFromInstant(value: Instant, timeZone: IanaTimeZone): LocalDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date(value));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return localDate(`${values.get("year")}-${values.get("month")}-${values.get("day")}`);
}

function formatTime(value: Instant, locale: string, timeZone: IanaTimeZone): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function formatDate(value: LocalDate, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    weekday: "short",
  }).format(new Date(`${value}T12:00:00Z`));
}

function formatItemTemporal(
  item: CourseItem,
  locale: string,
  timeZone: IanaTimeZone,
  displayDate: LocalDate | null,
): string {
  const dateTime = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "short",
    timeZone,
  });
  switch (item.temporal.kind) {
    case "unscheduled":
      return item.temporal.note === null ? "时间待定" : "时间待定 · " + item.temporal.note;
    case "date":
      return formatDate(item.temporal.date, locale) + " · 全天";
    case "deadline":
      return dateTime.format(new Date(item.temporal.at)) + " · 截止";
    case "interval":
      return (
        dateTime.format(new Date(item.temporal.startsAt)) +
        "—" +
        formatTime(item.temporal.endsAt, locale, timeZone) +
        (displayDate === null ? "" : " · 时段")
      );
  }
}

function itemDisplayDate(item: CourseItem, timeZone: IanaTimeZone): LocalDate | null {
  switch (item.temporal.kind) {
    case "date":
      return item.temporal.date;
    case "deadline":
      return dateFromInstant(item.temporal.at, timeZone);
    case "interval":
      return dateFromInstant(item.temporal.startsAt, timeZone);
    case "unscheduled":
      return null;
  }
}

function workload(item: CourseItem): Readonly<{ minutes: number; source: WorkloadSource }> {
  if (item.estimatedMinutes !== null && item.estimateSource !== null) {
    return { minutes: item.estimatedMinutes, source: item.estimateSource };
  }
  return { minutes: heuristicMinutes[item.kind], source: "heuristic" };
}

function taskGroup(
  item: CourseItem,
  displayDate: LocalDate | null,
  today: LocalDate,
): TaskGroupKey | null {
  if (item.state !== "planned") return null;
  if (displayDate === null) return "tba";
  if (compareLocalDates(displayDate, addLocalDateDays(today, 1)) <= 0) return "priority";
  if (importantKinds.has(item.kind)) return "major";
  if (compareLocalDates(displayDate, addLocalDateDays(today, 7)) <= 0) return "near";
  return "major";
}

function systemLabels(item: CourseItem, displayDate: LocalDate | null): readonly string[] {
  const labels: string[] = [];
  if (displayDate === null) labels.push("待定时间");
  if (importantKinds.has(item.kind)) labels.push("重要事项");
  if (item.temporal.kind === "deadline") labels.push("精确截止");
  if (item.temporal.kind === "interval") labels.push("占用时段");
  if (item.state === "completed") labels.push("已完成");
  return labels;
}

function itemSortValue(item: Pick<CourseItem, "temporal">): string {
  if (item.temporal.kind === "deadline") return item.temporal.at;
  if (item.temporal.kind === "interval") return item.temporal.startsAt;
  if (item.temporal.kind === "date") return `${item.temporal.date}T23:59:59.999Z`;
  return "9999-12-31T23:59:59.999Z";
}

function sortItems(left: ScheduleItemView, right: ScheduleItemView): number {
  return (
    (left.displayDate ?? "9999-12-31").localeCompare(right.displayDate ?? "9999-12-31") ||
    itemSortValue(left).localeCompare(itemSortValue(right)) ||
    left.title.localeCompare(right.title, "zh-CN")
  );
}

function inclusiveDaySpan(from: LocalDate, to: LocalDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function weekStart(value: LocalDate, startsOn: number): LocalDate {
  const difference = (localDateWeekday(value) - startsOn + 7) % 7;
  return addLocalDateDays(value, -difference);
}

function dateRange(from: LocalDate, to: LocalDate): readonly LocalDate[] {
  const result: LocalDate[] = [];
  for (let date = from; compareLocalDates(date, to) <= 0; date = addLocalDateDays(date, 1)) {
    result.push(date);
  }
  return result;
}

function exceptionContainsDate(
  exception: ScheduleProjectionInput["source"]["courseSetups"][number]["calendarExceptions"][number],
  date: LocalDate,
): boolean {
  return (
    compareLocalDates(exception.startDate, date) <= 0 &&
    compareLocalDates(exception.endDate, date) >= 0
  );
}

function projectTermProgress(input: ScheduleProjectionInput, today: LocalDate): TermProgressView {
  const { term } = input.source;
  const exceptions = input.source.calendarExceptions;
  const suppressedDates = new Set(
    exceptions
      .filter((exception) => exception.suppressesMeetings)
      .flatMap((exception) => dateRange(exception.startDate, exception.endDate))
      .filter(
        (date) =>
          compareLocalDates(date, term.startDate) >= 0 &&
          compareLocalDates(date, term.endDate) <= 0,
      ),
  );
  const activeDates = dateRange(term.startDate, term.endDate).filter(
    (date) => !suppressedDates.has(date),
  );
  const elapsedActiveDayCount = activeDates.filter(
    (date) => compareLocalDates(date, today) < 0,
  ).length;
  const currentException =
    exceptions.find(
      (exception) => exception.suppressesMeetings && exceptionContainsDate(exception, today),
    ) ?? null;
  const status =
    compareLocalDates(today, term.startDate) < 0
      ? "not_started"
      : compareLocalDates(today, term.endDate) > 0
        ? "ended"
        : "in_progress";
  const progressBps =
    status === "ended"
      ? 10_000
      : status === "not_started" || activeDates.length === 0
        ? 0
        : Math.min(10_000, Math.round((elapsedActiveDayCount / activeDates.length) * 10_000));

  let teachingWeekNumber: number | null = null;
  if (compareLocalDates(today, term.startDate) >= 0) {
    const target = compareLocalDates(today, term.endDate) > 0 ? term.endDate : today;
    const currentWeekStart = weekStart(target, input.source.weekStartsOn);
    let count = 0;
    for (
      let start = weekStart(term.startDate, input.source.weekStartsOn);
      compareLocalDates(start, currentWeekStart) <= 0;
      start = addLocalDateDays(start, 7)
    ) {
      const end = addLocalDateDays(start, 6);
      const isReadingWeek = exceptions.some(
        (exception) =>
          exception.kind === "reading_week" &&
          exception.suppressesMeetings &&
          compareLocalDates(exception.startDate, end) <= 0 &&
          compareLocalDates(exception.endDate, start) >= 0,
      );
      if (!isReadingWeek) count += 1;
    }
    teachingWeekNumber = count;
  }

  return {
    activeDayCount: activeDates.length,
    currentDate: today,
    currentException,
    elapsedActiveDayCount,
    isPaused: currentException !== null,
    progressBps,
    status,
    teachingWeekNumber,
    term,
  };
}

function workloadBand(minutes: number): WorkloadBand {
  if (minutes === 0) return "none";
  if (minutes <= 120) return "light";
  if (minutes <= 360) return "moderate";
  if (minutes <= 720) return "busy";
  return "overloaded";
}

function projectHeatmap(
  input: ScheduleProjectionInput,
  items: readonly ScheduleItemView[],
): WorkloadHeatmapView {
  const start = weekStart(input.source.term.startDate, input.source.weekStartsOn);
  const end = addLocalDateDays(weekStart(input.source.term.endDate, input.source.weekStartsOn), 6);
  const weeks: WorkloadWeekView[] = [];
  for (let from = start; compareLocalDates(from, end) <= 0; from = addLocalDateDays(from, 7)) {
    const to = addLocalDateDays(from, 6);
    const members = items.filter(
      (item) =>
        item.state !== "cancelled" &&
        item.displayDate !== null &&
        compareLocalDates(item.displayDate, input.source.term.startDate) >= 0 &&
        compareLocalDates(item.displayDate, input.source.term.endDate) <= 0 &&
        compareLocalDates(item.displayDate, from) >= 0 &&
        compareLocalDates(item.displayDate, to) <= 0,
    );
    const confirmedMinutes = members
      .filter((item) => item.workloadSource !== "heuristic")
      .reduce((sum, item) => sum + item.workloadMinutes, 0);
    const heuristicTotal = members
      .filter((item) => item.workloadSource === "heuristic")
      .reduce((sum, item) => sum + item.workloadMinutes, 0);
    const totalMinutes = confirmedMinutes + heuristicTotal;
    weeks.push({
      band: workloadBand(totalMinutes),
      confirmedMinutes,
      endDate: to,
      heuristicMinutes: heuristicTotal,
      itemCount: members.length,
      label: `${from.slice(5).replace("-", "/")}–${to.slice(5).replace("-", "/")}`,
      startDate: from,
      totalMinutes,
    });
  }
  return {
    maxMinutes: Math.max(0, ...weeks.map((week) => week.totalMinutes)),
    unscheduledCount: items.filter(
      (item) => item.state !== "cancelled" && item.displayDate === null,
    ).length,
    weeks,
  };
}

type Occupancy = Readonly<{
  courseCode: string;
  date: LocalDate;
  endsAt: Instant;
  id: string;
  startsAt: Instant;
  title: string;
}>;

function conflictEntry(value: Occupancy): ConflictEntryView {
  return {
    courseCode: value.courseCode,
    endsAt: value.endsAt,
    id: value.id,
    startsAt: value.startsAt,
    title: value.title,
  };
}

function projectConflicts(
  input: ScheduleProjectionInput,
  meetings: readonly ScheduleMeetingView[],
  items: readonly ScheduleItemView[],
): readonly ScheduleConflictView[] {
  const occupancies: Occupancy[] = [
    ...meetings.map((meeting) => ({
      courseCode: meeting.course.code,
      date: dateFromInstant(meeting.startsAt, input.source.timeZone),
      endsAt: meeting.endsAt,
      id: meeting.id,
      startsAt: meeting.startsAt,
      title: meeting.title,
    })),
    ...items.flatMap((item): readonly Occupancy[] =>
      item.state !== "cancelled" && item.temporal.kind === "interval"
        ? [
            {
              courseCode: item.course.code,
              date: item.displayDate!,
              endsAt: item.temporal.endsAt,
              id: `item:${item.id}`,
              startsAt: item.temporal.startsAt,
              title: item.title,
            },
          ]
        : [],
    ),
  ];
  const conflicts: ScheduleConflictView[] = [];
  for (let leftIndex = 0; leftIndex < occupancies.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < occupancies.length; rightIndex += 1) {
      const left = occupancies[leftIndex]!;
      const right = occupancies[rightIndex]!;
      if (left.startsAt < right.endsAt && right.startsAt < left.endsAt) {
        conflicts.push({
          date: left.date,
          description: `${left.courseCode} ${left.title} 与 ${right.courseCode} ${right.title} 的占用时段重叠。`,
          entries: [conflictEntry(left), conflictEntry(right)],
          id: `hard:${[left.id, right.id].sort().join(":")}`,
          kind: "hard_overlap",
          severity: "danger",
          title: "时间冲突",
        });
      }
    }
  }

  const dueByDate = new Map<LocalDate, ScheduleItemView[]>();
  for (const item of items) {
    if (
      item.state !== "planned" ||
      item.displayDate === null ||
      (item.temporal.kind !== "date" && item.temporal.kind !== "deadline")
    ) {
      continue;
    }
    const group = dueByDate.get(item.displayDate) ?? [];
    group.push(item);
    dueByDate.set(item.displayDate, group);
  }
  for (const [date, members] of dueByDate) {
    const totalMinutes = members.reduce((sum, item) => sum + item.workloadMinutes, 0);
    if (members.length >= 3 || (members.length >= 2 && totalMinutes >= 480)) {
      conflicts.push({
        date,
        description: `${members.length} 项事项集中在同一天，预计共 ${totalMinutes} 分钟。`,
        entries: members.map((item) => ({
          courseCode: item.course.code,
          endsAt: null,
          id: `item:${item.id}`,
          startsAt: item.temporal.kind === "deadline" ? item.temporal.at : null,
          title: item.title,
        })),
        id: `cluster:${date}`,
        kind: "deadline_cluster",
        severity: "warning",
        title: "截止事项集中",
      });
    }
  }

  for (const item of items) {
    if (item.state === "cancelled") continue;
    if (
      item.displayDate !== null &&
      (compareLocalDates(item.displayDate, input.source.term.startDate) < 0 ||
        compareLocalDates(item.displayDate, input.source.term.endDate) > 0)
    ) {
      conflicts.push({
        date: item.displayDate,
        description: `${item.course.code} ${item.title} 不在当前学期日期范围内，请核对来源。`,
        entries: [
          {
            courseCode: item.course.code,
            endsAt: null,
            id: `item:${item.id}`,
            startsAt: null,
            title: item.title,
          },
        ],
        id: `outside:${item.id}`,
        kind: "outside_term",
        severity: "warning",
        title: "学期外事项",
      });
    }
    if (
      item.state === "planned" &&
      item.displayDate === null &&
      (item.kind === "exam" || item.kind === "project")
    ) {
      conflicts.push({
        date: null,
        description: `${item.course.code} ${item.title} 是重要事项，但尚未确认时间。`,
        entries: [
          {
            courseCode: item.course.code,
            endsAt: null,
            id: `item:${item.id}`,
            startsAt: null,
            title: item.title,
          },
        ],
        id: `unknown:${item.id}`,
        kind: "unknown_schedule",
        severity: "warning",
        title: "时间待确认",
      });
    }
  }
  return conflicts.sort(
    (left, right) =>
      (left.date ?? "9999-12-31").localeCompare(right.date ?? "9999-12-31") ||
      left.id.localeCompare(right.id),
  );
}

function fingerprint(input: ScheduleProjectionInput): string {
  const source = [
    input.source.term.id,
    input.source.term.version,
    input.source.locale,
    input.source.timeZone,
    input.source.weekStartsOn,
    ...input.source.calendarExceptions.flatMap((exception) => [exception.id, exception.version]),
    ...input.source.labels.flatMap((label) => [label.id, label.version]),
    ...input.source.courseSetups.flatMap((setup) => [
      setup.course.id,
      setup.course.version,
      ...setup.meetingPatterns.flatMap((pattern) => [pattern.id, pattern.version]),
      ...(setup.meetingExceptions ?? []).flatMap((exception) => [exception.id, exception.version]),
    ]),
    ...input.source.items.flatMap(({ item }) => [item.id, item.version]),
  ].join("|");
  let hash = 2_166_136_261;
  for (const character of fingerprintSafeCharacters(source)) {
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 16_777_619);
  }
  return `schedule-${input.source.term.id}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function fingerprintSafeCharacters(value: string): string {
  return value.normalize("NFC");
}

export function buildScheduleSnapshot(input: ScheduleProjectionInput): ScheduleSnapshot {
  const timeZone = ianaTimeZone(input.query.displayTimeZone ?? input.source.timeZone);
  const generatedAt = new Date(input.generatedAt).toISOString();
  const today = dateFromInstant(generatedAt, timeZone);
  const from = localDate(input.query.from ?? input.source.term.startDate, "/from");
  const to = localDate(input.query.to ?? input.source.term.endDate, "/to");
  if (compareLocalDates(from, to) > 0 || inclusiveDaySpan(from, to) > 370) {
    throw validationError("ScheduleSnapshot 日期范围无效。", [
      {
        code: "INVALID_SCHEDULE_RANGE",
        message: "开始日期不得晚于结束日期，且一次最多查询 371 天。",
        path: "/to",
      },
    ]);
  }
  const courses = input.source.courseSetups
    .filter((setup) => setup.course.archivedAt === null)
    .map(({ course }): ScheduleCourseView => ({
      code: course.code,
      colorKey: course.colorKey,
      id: course.id,
      section: course.section,
      title: course.title,
    }))
    .sort((left, right) => left.code.localeCompare(right.code, "en"));
  const courseIndex = new Map<CourseId, ScheduleCourseView>(
    courses.map((course) => [course.id, course]),
  );

  const meetings = input.source.courseSetups
    .filter((setup) => courseIndex.has(setup.course.id))
    .flatMap((setup) => {
      const course = courseIndex.get(setup.course.id)!;
      const patterns = new Map(setup.meetingPatterns.map((pattern) => [pattern.id, pattern]));
      return expandMeetingOccurrences(setup, from, to).map((occurrence): ScheduleMeetingView => {
        const pattern = patterns.get(occurrence.patternId)!;
        return {
          course,
          endsAt: occurrence.endsAt,
          endTimeLabel: formatTime(occurrence.endsAt, input.source.locale, timeZone),
          id: `meeting:${occurrence.occurrenceKey}`,
          isToday: dateFromInstant(occurrence.startsAt, timeZone) === today,
          kind: occurrence.kind,
          locationText: occurrence.locationText,
          originalDate: occurrence.originalDate,
          patternId: occurrence.patternId,
          startsAt: occurrence.startsAt,
          startTimeLabel: formatTime(occurrence.startsAt, input.source.locale, timeZone),
          status: occurrence.status,
          timeZone: occurrence.timeZone,
          title: pattern.title ?? meetingKindLabels[occurrence.kind],
        };
      });
    })
    .sort(
      (left, right) =>
        left.startsAt.localeCompare(right.startsAt) || left.id.localeCompare(right.id),
    );

  const items = input.source.items
    .filter(({ item }) => courseIndex.has(item.courseId) && item.state !== "cancelled")
    .map(({ item }): ScheduleItemView => {
      const displayDate = itemDisplayDate(item, timeZone);
      const estimate = workload(item);
      return {
        course: courseIndex.get(item.courseId)!,
        details: item.details,
        displayDate,
        displayDateLabel:
          displayDate === null ? "时间待定" : formatDate(displayDate, input.source.locale),
        id: item.id,
        kind: item.kind,
        labels: item.labels,
        progressBps: item.progressBps,
        state: item.state,
        systemLabels: systemLabels(item, displayDate),
        taskGroup: taskGroup(item, displayDate, today),
        temporal: item.temporal,
        temporalLabel: formatItemTemporal(item, input.source.locale, timeZone, displayDate),
        title: item.title,
        version: item.version,
        workloadMinutes: estimate.minutes,
        workloadSource: estimate.source,
      };
    })
    .sort(sortItems);

  const termProgress = projectTermProgress(input, today);
  const heatmap = projectHeatmap(input, items);
  const conflicts = projectConflicts(input, meetings, items);
  const snapshotId = fingerprint(input);
  const metadata: ScheduleMetadata = {
    generatedAt,
    policyVersions: schedulePolicyVersions,
    snapshotId,
    timeZone,
    weekStartsOn: input.source.weekStartsOn,
  };
  const groups: Record<TaskGroupKey, ScheduleItemView[]> = {
    major: [],
    near: [],
    priority: [],
    tba: [],
  };
  for (const item of items) {
    if (item.taskGroup !== null) groups[item.taskGroup].push(item);
  }

  const updatedAtByItemId = new Map(
    input.source.items.map(({ item, updatedAt }) => [item.id, updatedAt]),
  );
  const courseSetupById = new Map(
    input.source.courseSetups.map((setup) => [setup.course.id, setup]),
  );
  const calendarEvents: CalendarEvent[] = [
    ...meetings.map((meeting): CalendarEvent => {
      const setup = courseSetupById.get(meeting.course.id)!;
      const pattern = setup.meetingPatterns.find(
        (candidate) => candidate.id === meeting.patternId,
      )!;
      const exception = (setup.meetingExceptions ?? []).find(
        (candidate) =>
          candidate.meetingPatternId === meeting.patternId &&
          candidate.occurrenceDate === meeting.originalDate,
      );
      return {
        course: meeting.course,
        description: meeting.status === "rescheduled" ? "本课节已改期。" : null,
        displayDate: dateFromInstant(meeting.startsAt, timeZone),
        id: meeting.id,
        lastModified: null,
        location: meeting.locationText,
        sequence: Math.max(setup.course.version, pattern.version, exception?.version ?? 0),
        sourceId: meeting.id,
        sourceType: "meeting_occurrence",
        summary: `${meeting.course.code} ${meeting.title}`,
        time: { endsAt: meeting.endsAt, kind: "interval", startsAt: meeting.startsAt },
        uid: `${meeting.patternId}-${meeting.originalDate}@courseflow.local`,
      };
    }),
    ...items.flatMap((item): readonly CalendarEvent[] => {
      if (item.state === "cancelled" || item.temporal.kind === "unscheduled") return [];
      const base = {
        course: item.course,
        description: item.details,
        displayDate: item.displayDate!,
        id: `item:${item.id}`,
        lastModified: updatedAtByItemId.get(item.id) ?? null,
        location: null,
        sequence: item.version,
        sourceId: item.id,
        sourceType: "course_item" as const,
        summary: `${item.temporal.kind === "deadline" ? "截止：" : ""}${item.course.code} ${item.title}`,
        uid: `${item.id}@courseflow.local`,
      };
      switch (item.temporal.kind) {
        case "date":
          return [
            {
              ...base,
              time: {
                date: item.temporal.date,
                endDate: addLocalDateDays(item.temporal.date, 1),
                kind: "all_day" as const,
              },
            },
          ];
        case "deadline":
          return [{ ...base, time: { kind: "instant" as const, startsAt: item.temporal.at } }];
        case "interval":
          return [
            {
              ...base,
              time: {
                endsAt: item.temporal.endsAt,
                kind: "interval" as const,
                startsAt: item.temporal.startsAt,
              },
            },
          ];
      }
    }),
  ]
    .filter(
      (event) =>
        compareLocalDates(event.displayDate, from) >= 0 &&
        compareLocalDates(event.displayDate, to) <= 0,
    )
    .sort(
      (left, right) =>
        left.displayDate.localeCompare(right.displayDate) ||
        left.summary.localeCompare(right.summary),
    );
  const skippedCount = items.filter(
    (item) => item.state !== "cancelled" && item.temporal.kind === "unscheduled",
  ).length;
  const skipped = {
    reasons: skippedCount === 0 ? [] : [{ count: skippedCount, reason: "unscheduled" as const }],
    total: skippedCount,
  };
  const calendar = {
    ...metadata,
    courses,
    events: calendarEvents,
    skipped,
    term: input.source.term,
  };
  const taskBoard = { ...metadata, groups, labels: input.source.labels };
  const nowMilliseconds = Date.parse(generatedAt);
  const nextMeeting =
    meetings.find((meeting) => Date.parse(meeting.endsAt) > nowMilliseconds) ?? null;
  const todayMeetings = meetings.filter((meeting) => meeting.isToday);
  const dashboard = {
    ...metadata,
    conflicts,
    heatmap,
    importantItems: items.filter(
      (item) => item.state === "planned" && importantKinds.has(item.kind),
    ),
    nextMeeting,
    priorityTasks: groups.priority,
    termProgress,
    todayMeetings,
  };
  return {
    ...metadata,
    calendar,
    conflicts,
    courses,
    dashboard,
    heatmap,
    items,
    meetings,
    taskBoard,
    term: input.source.term,
    termProgress,
  };
}
