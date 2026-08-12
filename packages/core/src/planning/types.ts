import type {
  CourseId,
  CourseItemId,
  GradeComponentId,
  GradeResultId,
  GradingSchemeId,
  IanaTimeZone,
  Instant,
  LetterGradeScaleId,
  LocalDate,
  TaskLabelId,
  TermId,
} from "../shared";

export type CourseItemTemporal =
  | Readonly<{ kind: "unscheduled"; note: string | null }>
  | Readonly<{ date: LocalDate; kind: "date"; note: string | null }>
  | Readonly<{ at: Instant; kind: "deadline"; note: string | null; timeZone: IanaTimeZone }>
  | Readonly<{
      endsAt: Instant;
      kind: "interval";
      note: string | null;
      startsAt: Instant;
      timeZone: IanaTimeZone;
    }>;

export const courseItemKinds = [
  "assignment",
  "exam",
  "quiz",
  "lab",
  "project",
  "presentation",
  "reading",
  "milestone",
  "other",
] as const;
export type CourseItemKind = (typeof courseItemKinds)[number];

export type CourseItem = Readonly<{
  courseId: CourseId;
  details: string | null;
  estimatedMinutes: number | null;
  estimateSource: "document" | "user" | null;
  id: CourseItemId;
  kind: CourseItemKind;
  labels: readonly TaskLabel[];
  progressBps: number | null;
  state: "planned" | "completed" | "cancelled";
  temporal: CourseItemTemporal;
  title: string;
  version: number;
}>;

export type TaskLabel = Readonly<{
  colorKey: "blue" | "green" | "purple" | "orange" | "red";
  displayName: string;
  id: TaskLabelId;
  normalizedName: string;
  termId: TermId;
  version: number;
}>;

export type GradeResult = Readonly<{
  earnedMilli: bigint;
  gradeComponentId: GradeComponentId;
  id: GradeResultId;
  note: string | null;
  possibleMilli: bigint;
  version: number;
}>;

export type GradeComponent = Readonly<{
  id: GradeComponentId;
  result: GradeResult | null;
  ruleText: string | null;
  sortOrder: number;
  title: string;
  weightBps: number | null;
}>;

export type GradingScheme = Readonly<{
  components: readonly GradeComponent[];
  conditionText: string | null;
  courseId: CourseId;
  id: GradingSchemeId;
  isPrimary: boolean;
  name: string;
  version: number;
}>;

export type LetterGradeBand = Readonly<{
  letter: "A" | "B" | "C" | "D" | "F";
  minimumPercentBps: number;
}>;

export type LetterGradeScale = Readonly<{
  bands: readonly LetterGradeBand[];
  id: LetterGradeScaleId;
  name: string;
  version: number;
}>;

export type GradebookComponentView = GradeComponent &
  Readonly<{
    contributionCourseBps: number | null;
    resultPercentBps: number | null;
  }>;

export type GradebookSnapshot = Readonly<{
  components: readonly GradebookComponentView[];
  courseId: CourseId;
  currentLetter: "A" | "B" | "C" | "D" | "F" | null;
  earnedCourseBps: number | null;
  gradedPortionPercentBps: number | null;
  gradedWeightBps: number;
  scheme: Omit<GradingScheme, "components"> | null;
  unknownWeightResultCount: number;
  ungradedCount: number;
  warnings: readonly Readonly<{ code: string; message: string }>[];
}>;

export type CoursePlanningDetail = Readonly<{
  courseId: CourseId;
  items: readonly CourseItem[];
  labels: readonly TaskLabel[];
}>;

export type CreateCourseItem = Readonly<{
  courseId: CourseId;
  details?: string | null;
  estimatedMinutes?: number | null;
  kind: CourseItemKind;
  labelIds?: readonly TaskLabelId[];
  progressBps?: number | null;
  temporal:
    | Readonly<{ kind: "unscheduled"; note?: string | null }>
    | Readonly<{ date: string; kind: "date"; note?: string | null }>
    | Readonly<{ at: string; kind: "deadline"; note?: string | null; timeZone: string }>
    | Readonly<{
        endsAt: string;
        kind: "interval";
        note?: string | null;
        startsAt: string;
        timeZone: string;
      }>;
  title: string;
}>;

export type UpdateCourseItem = Partial<Omit<CreateCourseItem, "courseId">> &
  Readonly<{ expectedVersion: number; itemId: CourseItemId }>;

export type SaveTaskLabel = Readonly<{
  colorKey: TaskLabel["colorKey"];
  displayName: string;
  expectedVersion?: number;
  labelId?: TaskLabelId;
  termId: TermId;
}>;

export type SaveGradingScheme = Readonly<{
  components: readonly Readonly<{
    id?: GradeComponentId;
    ruleText?: string | null;
    title: string;
    weightBps?: number | null;
  }>[];
  conditionText?: string | null;
  courseId: CourseId;
  expectedVersion?: number;
  isPrimary: boolean;
  name: string;
  schemeId?: GradingSchemeId;
}>;

export type SaveGradeResult = Readonly<{
  earned: string;
  expectedVersion?: number;
  gradeComponentId: GradeComponentId;
  note?: string | null;
  possible: string;
}>;

export type SaveLetterGradeScale = Readonly<{
  bands: readonly LetterGradeBand[];
  expectedVersion?: number;
  name: string;
  scaleId?: LetterGradeScaleId;
}>;
