import type {
  CalendarExceptionId,
  CourseId,
  IanaTimeZone,
  LocalDate,
  LocalTime,
  MeetingExceptionId,
  MeetingPatternId,
  TermId,
} from "../shared";

export const courseColorKeys = ["blue", "green", "purple", "orange", "red"] as const;
export type CourseColorKey = (typeof courseColorKeys)[number];

export const meetingKinds = ["lecture", "tutorial", "practical", "other"] as const;
export type MeetingKind = (typeof meetingKinds)[number];

export type AcademicTerm = Readonly<{
  archivedAt: string | null;
  endDate: LocalDate;
  id: TermId;
  name: string;
  startDate: LocalDate;
  timeZone: IanaTimeZone;
  version: number;
  weekNumberingPolicy: "teaching_weeks_v1";
}>;

export type AcademicCalendarException = Readonly<{
  endDate: LocalDate;
  id: CalendarExceptionId;
  kind: "reading_week" | "holiday" | "closure" | "other";
  name: string;
  startDate: LocalDate;
  suppressesMeetings: boolean;
  termId: TermId;
  version: number;
}>;

export type Course = Readonly<{
  archivedAt: string | null;
  code: string;
  colorKey: CourseColorKey;
  creditValueMilli: number | null;
  id: CourseId;
  instructorName: string | null;
  letterGradeScaleId: import("../shared").LetterGradeScaleId | null;
  section: string | null;
  termId: TermId;
  timeZone: IanaTimeZone;
  title: string;
  version: number;
}>;

export type MeetingPattern = Readonly<{
  archivedAt: string | null;
  courseId: CourseId;
  effectiveEndDate: LocalDate | null;
  effectiveStartDate: LocalDate | null;
  id: MeetingPatternId;
  kind: MeetingKind;
  localEndTime: LocalTime;
  localStartTime: LocalTime;
  locationText: string | null;
  section: string | null;
  title: string | null;
  version: number;
  weekdays: readonly number[];
}>;

export type MeetingException = Readonly<{
  action: "cancelled" | "kept" | "rescheduled";
  id: MeetingExceptionId;
  meetingPatternId: MeetingPatternId;
  note: string | null;
  occurrenceDate: LocalDate;
  replacementDate: LocalDate | null;
  replacementEndTime: LocalTime | null;
  replacementLocationText: string | null;
  replacementStartTime: LocalTime | null;
  replacementTimeZone: IanaTimeZone | null;
  version: number;
}>;

export type MeetingOccurrence = Readonly<{
  courseId: CourseId;
  endsAt: string;
  kind: MeetingKind;
  locationText: string | null;
  occurrenceKey: string;
  originalDate: LocalDate;
  patternId: MeetingPatternId;
  startsAt: string;
  status: "kept" | "rescheduled" | "scheduled";
  timeZone: IanaTimeZone;
}>;

export type CourseSetupView = Readonly<{
  calendarExceptions: readonly AcademicCalendarException[];
  course: Course;
  meetingPatterns: readonly MeetingPattern[];
  meetingExceptions?: readonly MeetingException[];
  term: AcademicTerm;
}>;

export type TermSummary = AcademicTerm & Readonly<{ courseCount: number; isActive: boolean }>;
export type TermDetail = Readonly<{
  calendarExceptions: readonly AcademicCalendarException[];
  term: AcademicTerm;
}>;

export type CourseSummary = Readonly<{
  code: string;
  colorKey: CourseColorKey;
  id: CourseId;
  meetingCount: number;
  section: string | null;
  title: string;
}>;

export type CourseDetail = CourseSetupView;

export type CreateTerm = Readonly<{
  endDate: string;
  name: string;
  readingWeeks?: readonly Readonly<{ endDate: string; name: string; startDate: string }>[];
  startDate: string;
  timeZone: string;
}>;

export type CreateCourseWithSchedule = Readonly<{
  code: string;
  colorKey: CourseColorKey;
  creditValue?: string | null;
  instructorName?: string | null;
  letterGradeScaleId?: import("../shared").LetterGradeScaleId | null;
  meetingPatterns: readonly Readonly<{
    effectiveEndDate?: string | null;
    effectiveStartDate?: string | null;
    kind: MeetingKind;
    localEndTime: string;
    localStartTime: string;
    locationText?: string | null;
    section?: string | null;
    title?: string | null;
    weekdays: readonly number[];
  }>[];
  section?: string | null;
  termId: TermId;
  timeZone?: string | null;
  title: string;
}>;

export type UpdateTerm = Readonly<
  Partial<Omit<CreateTerm, "readingWeeks">> & { expectedVersion: number; termId: TermId }
>;

export type SetTermArchived = Readonly<{
  archived: boolean;
  expectedVersion: number;
  termId: TermId;
}>;

export type SetCourseArchived = Readonly<{
  archived: boolean;
  courseId: CourseId;
  expectedVersion: number;
}>;

export type SetCourseLetterGradeScale = Readonly<{
  courseId: CourseId;
  expectedVersion: number;
  letterGradeScaleId: import("../shared").LetterGradeScaleId | null;
}>;

export type SaveMeetingException = Readonly<{
  action: "cancelled" | "kept" | "rescheduled";
  expectedVersion?: number;
  meetingPatternId: MeetingPatternId;
  note?: string | null;
  occurrenceDate: string;
  replacementDate?: string | null;
  replacementEndTime?: string | null;
  replacementLocationText?: string | null;
  replacementStartTime?: string | null;
  replacementTimeZone?: string | null;
}>;
