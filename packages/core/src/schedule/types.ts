import type {
  AcademicCalendarException,
  AcademicTerm,
  Course,
  CourseSetupView,
  MeetingKind,
} from "../academics";
import type { CourseItem, CourseItemKind, CourseItemTemporal, TaskLabel } from "../planning";
import type {
  CourseId,
  CourseItemId,
  IanaTimeZone,
  Instant,
  LocalDate,
  MeetingPatternId,
  TermId,
} from "../shared";

export const schedulePolicyVersions = {
  conflicts: "conflict-v1",
  taskGrouping: "task-grouping-v1",
  termProgress: "term-progress-v1",
  workload: "workload-v1",
} as const;

export type SchedulePolicyVersions = typeof schedulePolicyVersions;

export type ScheduleSnapshotQuery = Readonly<{
  displayTimeZone?: string;
  from?: string;
  termId: TermId;
  to?: string;
}>;

/** Official, owner-scoped source rows loaded together by a repository adapter. */
export type ScheduleSourceData = Readonly<{
  calendarExceptions: readonly AcademicCalendarException[];
  courseSetups: readonly CourseSetupView[];
  items: readonly Readonly<{ item: CourseItem; updatedAt: Instant }>[];
  labels: readonly TaskLabel[];
  locale: string;
  term: AcademicTerm;
  timeZone: IanaTimeZone;
  weekStartsOn: number;
}>;

export interface ScheduleSnapshotRepository {
  loadScheduleSource(
    scope: import("../shared").UserScope,
    query: ScheduleSnapshotQuery,
  ): Promise<ScheduleSourceData | null>;
}

export type ScheduleMetadata = Readonly<{
  generatedAt: Instant;
  policyVersions: SchedulePolicyVersions;
  snapshotId: string;
  timeZone: IanaTimeZone;
  weekStartsOn: number;
}>;

export type ScheduleCourseView = Pick<Course, "code" | "colorKey" | "id" | "section" | "title">;

export type ScheduleMeetingView = Readonly<{
  course: ScheduleCourseView;
  endsAt: Instant;
  endTimeLabel: string;
  id: string;
  isToday: boolean;
  kind: MeetingKind;
  locationText: string | null;
  originalDate: LocalDate;
  patternId: MeetingPatternId;
  startsAt: Instant;
  startTimeLabel: string;
  status: "kept" | "rescheduled" | "scheduled";
  timeZone: IanaTimeZone;
  title: string;
}>;

export type TaskGroupKey = "priority" | "near" | "major" | "tba";

export type WorkloadSource = "document" | "heuristic" | "user";

export type ScheduleItemView = Readonly<{
  course: ScheduleCourseView;
  details: string | null;
  displayDate: LocalDate | null;
  displayDateLabel: string;
  id: CourseItemId;
  kind: CourseItemKind;
  labels: readonly TaskLabel[];
  progressBps: number | null;
  state: CourseItem["state"];
  systemLabels: readonly string[];
  taskGroup: TaskGroupKey | null;
  temporal: CourseItemTemporal;
  temporalLabel: string;
  title: string;
  version: number;
  workloadMinutes: number;
  workloadSource: WorkloadSource;
}>;

export type TermProgressView = Readonly<{
  activeDayCount: number;
  currentDate: LocalDate;
  currentException: AcademicCalendarException | null;
  elapsedActiveDayCount: number;
  isPaused: boolean;
  progressBps: number;
  status: "ended" | "in_progress" | "not_started";
  teachingWeekNumber: number | null;
  term: AcademicTerm;
}>;

export type WorkloadBand = "busy" | "light" | "moderate" | "none" | "overloaded";

export type WorkloadWeekView = Readonly<{
  band: WorkloadBand;
  confirmedMinutes: number;
  endDate: LocalDate;
  heuristicMinutes: number;
  itemCount: number;
  label: string;
  startDate: LocalDate;
  totalMinutes: number;
}>;

export type WorkloadHeatmapView = Readonly<{
  maxMinutes: number;
  unscheduledCount: number;
  weeks: readonly WorkloadWeekView[];
}>;

export type ConflictEntryView = Readonly<{
  courseCode: string;
  endsAt: Instant | null;
  id: string;
  startsAt: Instant | null;
  title: string;
}>;

export type ScheduleConflictView = Readonly<{
  date: LocalDate | null;
  description: string;
  entries: readonly ConflictEntryView[];
  id: string;
  kind: "deadline_cluster" | "hard_overlap" | "outside_term" | "unknown_schedule";
  severity: "danger" | "warning";
  title: string;
}>;

export type CalendarEventTime =
  | Readonly<{ date: LocalDate; endDate: LocalDate; kind: "all_day" }>
  | Readonly<{ kind: "instant"; startsAt: Instant }>
  | Readonly<{ endsAt: Instant; kind: "interval"; startsAt: Instant }>;

export type CalendarEvent = Readonly<{
  course: ScheduleCourseView;
  description: string | null;
  displayDate: LocalDate;
  id: string;
  lastModified: Instant | null;
  location: string | null;
  sequence: number;
  sourceId: string;
  sourceType: "course_item" | "meeting_occurrence";
  summary: string;
  time: CalendarEventTime;
  uid: string;
}>;

export type TaskBoardView = ScheduleMetadata &
  Readonly<{
    groups: Readonly<Record<TaskGroupKey, readonly ScheduleItemView[]>>;
    labels: readonly TaskLabel[];
  }>;

export type CalendarView = ScheduleMetadata &
  Readonly<{
    courses: readonly ScheduleCourseView[];
    events: readonly CalendarEvent[];
    skipped: Readonly<{
      reasons: readonly Readonly<{ count: number; reason: "unscheduled" }>[];
      total: number;
    }>;
    term: AcademicTerm;
  }>;

export type DashboardView = ScheduleMetadata &
  Readonly<{
    conflicts: readonly ScheduleConflictView[];
    heatmap: WorkloadHeatmapView;
    importantItems: readonly ScheduleItemView[];
    nextMeeting: ScheduleMeetingView | null;
    priorityTasks: readonly ScheduleItemView[];
    termProgress: TermProgressView;
    todayMeetings: readonly ScheduleMeetingView[];
  }>;

export type CourseTimelineView = ScheduleMetadata &
  Readonly<{
    course: ScheduleCourseView;
    items: readonly ScheduleItemView[];
  }>;

export type ScheduleSnapshot = ScheduleMetadata &
  Readonly<{
    calendar: CalendarView;
    conflicts: readonly ScheduleConflictView[];
    courses: readonly ScheduleCourseView[];
    dashboard: DashboardView;
    heatmap: WorkloadHeatmapView;
    items: readonly ScheduleItemView[];
    meetings: readonly ScheduleMeetingView[];
    taskBoard: TaskBoardView;
    term: AcademicTerm;
    termProgress: TermProgressView;
  }>;

export type IcsExport = Readonly<{
  content: string;
  fileName: string;
  mimeType: "text/calendar; charset=utf-8";
  skipped: CalendarView["skipped"];
}>;

export type ScheduleProjectionInput = Readonly<{
  generatedAt: Instant;
  query: ScheduleSnapshotQuery;
  source: ScheduleSourceData;
}>;

export type ScheduleCourseIndex = ReadonlyMap<CourseId, ScheduleCourseView>;

export type TaskBoardQuery = ScheduleSnapshotQuery &
  Readonly<{
    group?: TaskGroupKey;
    labelIds?: readonly TaskLabel["id"][];
    search?: string;
  }>;

export type CalendarQuery = ScheduleSnapshotQuery &
  Readonly<{
    courseIds?: readonly CourseId[];
    includeItems?: boolean;
    includeMeetings?: boolean;
  }>;

export type CourseTimelineQuery = ScheduleSnapshotQuery & Readonly<{ courseId: CourseId }>;
