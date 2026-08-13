import { z } from "zod";

const uuid = z.uuid();
const nullableText = (max: number) => z.string().max(max).nullable().optional();

export const readingWeekInputSchema = z.object({
  endDate: z.iso.date(),
  name: z.string().trim().min(1).max(120),
  startDate: z.iso.date(),
});

export const createTermInputSchema = z.object({
  endDate: z.iso.date(),
  name: z.string().trim().min(1).max(80),
  readingWeeks: z.array(readingWeekInputSchema).max(24).optional(),
  startDate: z.iso.date(),
  timeZone: z.string().trim().min(1).max(120),
});

export const updateTermInputSchema = z.object({
  endDate: z.iso.date().optional(),
  expectedVersion: z.number().int().positive(),
  name: z.string().trim().min(1).max(80).optional(),
  startDate: z.iso.date().optional(),
  termId: uuid,
  timeZone: z.string().trim().min(1).max(120).optional(),
});

export const setActiveTermInputSchema = z.object({ termId: uuid });

export const setTermArchivedInputSchema = z.object({
  archived: z.boolean(),
  expectedVersion: z.number().int().positive(),
  termId: uuid,
});

export const meetingPatternInputSchema = z.object({
  effectiveEndDate: z.iso.date().nullable().optional(),
  effectiveStartDate: z.iso.date().nullable().optional(),
  kind: z.enum(["lecture", "tutorial", "practical", "other"]),
  localEndTime: z.string().regex(/^\d{2}:\d{2}$/u),
  localStartTime: z.string().regex(/^\d{2}:\d{2}$/u),
  locationText: nullableText(200),
  section: nullableText(80),
  title: nullableText(120),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
});

export const createCourseSetupInputSchema = z.object({
  code: z.string().trim().min(1).max(32),
  colorKey: z.enum(["blue", "green", "purple", "orange", "red"]),
  creditValue: z.string().max(32).nullable().optional(),
  instructorName: nullableText(160),
  letterGradeScaleId: uuid.nullable().optional(),
  meetingPatterns: z.array(meetingPatternInputSchema).max(24),
  section: nullableText(80),
  termId: uuid,
  timeZone: z.string().trim().min(1).max(120).nullable().optional(),
  title: z.string().trim().min(1).max(160),
});

const temporalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unscheduled"), note: nullableText(2_000) }),
  z.object({ date: z.iso.date(), kind: z.literal("date"), note: nullableText(2_000) }),
  z.object({
    at: z.iso.datetime({ offset: true }),
    kind: z.literal("deadline"),
    note: nullableText(2_000),
    timeZone: z.string().min(1).max(120),
  }),
  z.object({
    endsAt: z.iso.datetime({ offset: true }),
    kind: z.literal("interval"),
    note: nullableText(2_000),
    startsAt: z.iso.datetime({ offset: true }),
    timeZone: z.string().min(1).max(120),
  }),
]);

export const createCourseItemInputSchema = z.object({
  courseId: uuid,
  details: nullableText(10_000),
  estimatedMinutes: z.number().int().positive().nullable().optional(),
  kind: z.enum([
    "assignment",
    "exam",
    "quiz",
    "lab",
    "project",
    "presentation",
    "reading",
    "milestone",
    "other",
  ]),
  labelIds: z.array(uuid).max(24).optional(),
  progressBps: z.number().int().min(0).max(10_000).nullable().optional(),
  temporal: temporalSchema,
  title: z.string().trim().min(1).max(200),
});

export const saveTaskLabelInputSchema = z.object({
  colorKey: z.enum(["blue", "green", "purple", "orange", "red"]),
  displayName: z.string().trim().min(1).max(80),
  expectedVersion: z.number().int().positive().optional(),
  labelId: uuid.optional(),
  termId: uuid,
});

export const saveGradingSchemeInputSchema = z.object({
  components: z
    .array(
      z.object({
        id: uuid.optional(),
        ruleText: nullableText(4_000),
        title: z.string().trim().min(1).max(200),
        weightBps: z.number().int().min(0).max(10_000).nullable().optional(),
      }),
    )
    .min(1)
    .max(100),
  conditionText: nullableText(4_000),
  courseId: uuid,
  expectedVersion: z.number().int().positive().optional(),
  isPrimary: z.boolean(),
  name: z.string().trim().min(1).max(120),
  schemeId: uuid.optional(),
});

export const saveGradeResultInputSchema = z.object({
  earned: z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d{1,3})?$/u),
  expectedVersion: z.number().int().positive().optional(),
  gradeComponentId: uuid,
  note: nullableText(2_000),
  possible: z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d{1,3})?$/u),
});

export const deleteVersionInputSchema = z.object({ expectedVersion: z.number().int().positive() });

export const setCourseItemStateInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
  itemId: uuid,
  state: z.enum(["planned", "completed", "cancelled"]),
});

export const updateCourseItemInputSchema = z.object({
  details: nullableText(10_000),
  estimatedMinutes: z.number().int().positive().nullable().optional(),
  expectedVersion: z.number().int().positive(),
  itemId: uuid,
  title: z.string().trim().min(1).max(200).optional(),
});

export const setCourseLetterGradeScaleInputSchema = z.object({
  courseId: uuid,
  expectedVersion: z.number().int().positive(),
  letterGradeScaleId: uuid.nullable(),
});

export const saveLetterGradeScaleInputSchema = z.object({
  bands: z
    .array(
      z.object({
        letter: z.enum(["A", "B", "C", "D", "F"]),
        minimumPercentBps: z.number().int().min(0).max(10_000),
      }),
    )
    .length(5),
  expectedVersion: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(120),
  scaleId: uuid.optional(),
});

export const saveMeetingExceptionInputSchema = z.object({
  action: z.enum(["cancelled", "kept", "rescheduled"]),
  expectedVersion: z.number().int().positive().optional(),
  meetingPatternId: uuid,
  note: nullableText(2_000),
  occurrenceDate: z.iso.date(),
  replacementDate: z.iso.date().nullable().optional(),
  replacementEndTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/u)
    .nullable()
    .optional(),
  replacementLocationText: nullableText(200),
  replacementStartTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/u)
    .nullable()
    .optional(),
  replacementTimeZone: z.string().max(120).nullable().optional(),
});

export const scheduleQuerySchema = z.object({
  displayTimeZone: z.string().trim().min(1).max(120).optional(),
  from: z.iso.date().optional(),
  termId: uuid,
  to: z.iso.date().optional(),
});

export const taskBoardQuerySchema = scheduleQuerySchema.extend({
  group: z.enum(["priority", "near", "major", "tba"]).optional(),
  labelIds: z.array(uuid).max(24).optional(),
  search: z.string().trim().max(200).optional(),
});

export const calendarQuerySchema = scheduleQuerySchema.extend({
  courseIds: z.array(uuid).max(24).optional(),
  includeItems: z.boolean().optional(),
  includeMeetings: z.boolean().optional(),
});

export const beginSourceUploadInputSchema = z.object({
  assets: z
    .array(
      z.object({
        byteSize: z
          .number()
          .int()
          .positive()
          .max(50 * 1024 * 1024),
        declaredMimeType: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
        originalFilename: z.string().trim().min(1).max(255),
        position: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(24),
  courseId: uuid,
  displayName: z.string().trim().min(1).max(200),
  kind: z.enum(["syllabus", "assignment_brief", "screenshot_set", "other"]),
});

export const completeSourceUploadInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

export const deleteSourceInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

const coursePatchCandidatePayloadSchema = z.object({
  code: z.string().max(32).optional(),
  instructorName: nullableText(160),
  section: nullableText(80),
  title: z.string().max(160).optional(),
});

const courseItemCandidatePayloadSchema = z.object({
  courseId: uuid,
  details: z.string().max(10_000).nullable(),
  estimatedMinutes: z.number().int().positive().nullable(),
  kind: z.enum([
    "assignment",
    "exam",
    "quiz",
    "lab",
    "project",
    "presentation",
    "reading",
    "milestone",
    "other",
  ]),
  temporal: temporalSchema,
  title: z.string().trim().min(1).max(200),
});

const gradingSchemeCandidatePayloadSchema = z.object({
  components: z
    .array(
      z.object({
        ruleText: z.string().max(4_000).nullable(),
        title: z.string().trim().min(1).max(200),
        weightBps: z.number().int().min(0).max(10_000).nullable(),
      }),
    )
    .min(1)
    .max(100),
  conditionText: z.string().max(4_000).nullable(),
  courseId: uuid,
  isPrimary: z.boolean(),
  name: z.string().trim().min(1).max(120),
});

export const candidatePayloadSchema = z.union([
  courseItemCandidatePayloadSchema,
  gradingSchemeCandidatePayloadSchema,
  coursePatchCandidatePayloadSchema,
]);

export const reviewCandidateBodySchema = z.object({
  application: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("create") }),
      z.object({
        expectedVersion: z.number().int().positive(),
        kind: z.literal("update_existing"),
        targetId: uuid,
      }),
    ])
    .nullable(),
  decision: z.enum(["accepted", "accepted_with_edits", "rejected", "duplicate"]),
  duplicateTargetId: uuid.nullable(),
  finalPayload: candidatePayloadSchema.nullable(),
  note: z.string().trim().max(2_000).nullable(),
});

export function toJsonValue<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, current: unknown) =>
      typeof current === "bigint" ? current.toString() : current,
    ),
  ) as T;
}

export type CreateTermInput = z.infer<typeof createTermInputSchema>;
export type CreateCourseSetupInput = z.infer<typeof createCourseSetupInputSchema>;
export type CreateCourseItemInput = z.infer<typeof createCourseItemInputSchema>;
export type SaveTaskLabelInput = z.infer<typeof saveTaskLabelInputSchema>;
export type SaveGradingSchemeInput = z.infer<typeof saveGradingSchemeInputSchema>;
export type SaveGradeResultInput = z.infer<typeof saveGradeResultInputSchema>;
export type SaveMeetingExceptionInput = z.infer<typeof saveMeetingExceptionInputSchema>;
export type ScheduleQuery = z.infer<typeof scheduleQuerySchema>;
export type TaskBoardQuery = z.infer<typeof taskBoardQuerySchema>;
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;
export type BeginSourceUploadInput = z.infer<typeof beginSourceUploadInputSchema>;
export type CompleteSourceUploadInput = z.infer<typeof completeSourceUploadInputSchema>;
export type ReviewCandidateBody = z.infer<typeof reviewCandidateBodySchema>;
