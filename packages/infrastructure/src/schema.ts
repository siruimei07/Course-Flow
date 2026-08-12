import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgSchema,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const courseflow = pgSchema("courseflow");

export const userProfiles = courseflow.table(
  "user_profiles",
  {
    activeTermId: uuid("active_term_id"),
    authSubject: text("auth_subject").notNull().unique(),
    createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
      .defaultNow()
      .notNull(),
    displayName: text("display_name"),
    id: uuid("id").primaryKey(),
    locale: text("locale").default("zh-CN").notNull(),
    timeZone: text("time_zone").default("Asia/Shanghai").notNull(),
    updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true })
      .defaultNow()
      .notNull(),
    weekStartsOn: smallint("week_starts_on").default(0).notNull(),
  },
  (table) => [
    check("user_profiles_week_starts_on_check", sql`${table.weekStartsOn} between 0 and 6`),
  ],
);

export const academicTerms = courseflow.table(
  "academic_terms",
  {
    archivedAt: timestamp("archived_at", { mode: "string", withTimezone: true }),
    endDate: date("end_date").notNull(),
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => userProfiles.id),
    startDate: date("start_date").notNull(),
    timeZone: text("time_zone").notNull(),
    version: integer("version").default(1).notNull(),
    weekNumberingPolicy: text("week_numbering_policy").default("teaching_weeks_v1").notNull(),
  },
  (table) => [
    index("academic_terms_owner_idx").on(table.ownerUserId),
    check("academic_terms_date_range_check", sql`${table.startDate} <= ${table.endDate}`),
    check("academic_terms_version_check", sql`${table.version} >= 1`),
  ],
);

export const academicCalendarExceptions = courseflow.table(
  "academic_calendar_exceptions",
  {
    endDate: date("end_date").notNull(),
    id: uuid("id").primaryKey(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    startDate: date("start_date").notNull(),
    suppressesMeetings: boolean("suppresses_meetings").default(false).notNull(),
    termId: uuid("term_id")
      .notNull()
      .references(() => academicTerms.id),
    version: integer("version").default(1).notNull(),
  },
  (table) => [
    index("academic_calendar_exceptions_range_idx").on(
      table.termId,
      table.startDate,
      table.endDate,
    ),
    check(
      "academic_calendar_exceptions_kind_check",
      sql`${table.kind} in ('reading_week','holiday','closure','other')`,
    ),
    check(
      "academic_calendar_exceptions_date_range_check",
      sql`${table.startDate} <= ${table.endDate}`,
    ),
  ],
);

export const letterGradeScales = courseflow.table("letter_grade_scales", {
  createdAt: timestamp("created_at", { mode: "string", withTimezone: true }).defaultNow().notNull(),
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  ownerUserId: uuid("owner_user_id")
    .notNull()
    .references(() => userProfiles.id),
  version: integer("version").default(1).notNull(),
  updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true }).defaultNow().notNull(),
});

export const letterGradeBands = courseflow.table(
  "letter_grade_bands",
  {
    letter: text("letter").notNull(),
    minimumPercentBps: integer("minimum_percent_bps").notNull(),
    scaleId: uuid("scale_id")
      .notNull()
      .references(() => letterGradeScales.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.scaleId, table.letter] }),
    check("letter_grade_bands_letter_check", sql`${table.letter} in ('A','B','C','D','F')`),
    check("letter_grade_bands_minimum_check", sql`${table.minimumPercentBps} between 0 and 10000`),
  ],
);

export const courses = courseflow.table(
  "courses",
  {
    archivedAt: timestamp("archived_at", { mode: "string", withTimezone: true }),
    code: text("code").notNull(),
    colorKey: text("color_key").notNull(),
    creditValueMilli: integer("credit_value_milli"),
    id: uuid("id").primaryKey(),
    instructorName: text("instructor_name"),
    letterGradeScaleId: uuid("letter_grade_scale_id").references(() => letterGradeScales.id),
    section: text("section"),
    termId: uuid("term_id")
      .notNull()
      .references(() => academicTerms.id),
    timeZone: text("time_zone").notNull(),
    title: text("title").notNull(),
    version: integer("version").default(1).notNull(),
  },
  (table) => [
    index("courses_term_archived_idx").on(table.termId, table.archivedAt),
    check(
      "courses_color_key_check",
      sql`${table.colorKey} in ('blue','green','purple','orange','red')`,
    ),
    check(
      "courses_credit_check",
      sql`${table.creditValueMilli} is null or ${table.creditValueMilli} >= 0`,
    ),
  ],
);

export const meetingPatterns = courseflow.table(
  "meeting_patterns",
  {
    archivedAt: timestamp("archived_at", { mode: "string", withTimezone: true }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id),
    effectiveEndDate: date("effective_end_date"),
    effectiveStartDate: date("effective_start_date"),
    id: uuid("id").primaryKey(),
    kind: text("kind").notNull(),
    localEndTime: time("local_end_time", { precision: 0 }).notNull(),
    localStartTime: time("local_start_time", { precision: 0 }).notNull(),
    locationText: text("location_text"),
    section: text("section"),
    title: text("title"),
    version: integer("version").default(1).notNull(),
    weekdaysMask: smallint("weekdays_mask").notNull(),
  },
  (table) => [
    index("meeting_patterns_course_archived_idx").on(table.courseId, table.archivedAt),
    check(
      "meeting_patterns_kind_check",
      sql`${table.kind} in ('lecture','tutorial','practical','other')`,
    ),
    check("meeting_patterns_time_check", sql`${table.localEndTime} > ${table.localStartTime}`),
    check("meeting_patterns_weekdays_check", sql`${table.weekdaysMask} between 1 and 127`),
  ],
);

export const meetingExceptions = courseflow.table(
  "meeting_exceptions",
  {
    action: text("action").notNull(),
    createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
      .defaultNow()
      .notNull(),
    id: uuid("id").primaryKey(),
    meetingPatternId: uuid("meeting_pattern_id")
      .notNull()
      .references(() => meetingPatterns.id),
    note: text("note"),
    occurrenceDate: date("occurrence_date").notNull(),
    replacementDate: date("replacement_date"),
    replacementEndTime: time("replacement_end_time", { precision: 0 }),
    replacementLocationText: text("replacement_location_text"),
    replacementStartTime: time("replacement_start_time", { precision: 0 }),
    replacementTimeZone: text("replacement_time_zone"),
    version: integer("version").default(1).notNull(),
    updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("meeting_exceptions_occurrence_unique").on(
      table.meetingPatternId,
      table.occurrenceDate,
    ),
    check(
      "meeting_exceptions_action_check",
      sql`${table.action} in ('cancelled','rescheduled','kept')`,
    ),
    check(
      "meeting_exceptions_replacement_check",
      sql`
    (${table.action} = 'rescheduled' and ${table.replacementDate} is not null and ${table.replacementStartTime} is not null and ${table.replacementEndTime} is not null and ${table.replacementEndTime} > ${table.replacementStartTime})
    or (${table.action} in ('cancelled','kept') and ${table.replacementDate} is null and ${table.replacementStartTime} is null and ${table.replacementEndTime} is null and ${table.replacementTimeZone} is null)
  `,
    ),
  ],
);

export const taskLabels = courseflow.table(
  "task_labels",
  {
    colorKey: text("color_key").notNull(),
    createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
      .defaultNow()
      .notNull(),
    displayName: text("display_name").notNull(),
    id: uuid("id").primaryKey(),
    normalizedName: text("normalized_name").notNull(),
    termId: uuid("term_id")
      .notNull()
      .references(() => academicTerms.id),
    version: integer("version").default(1).notNull(),
    updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("task_labels_term_name_unique").on(table.termId, table.normalizedName),
    check(
      "task_labels_color_key_check",
      sql`${table.colorKey} in ('blue','green','purple','orange','red')`,
    ),
  ],
);

export const courseItems = courseflow.table(
  "course_items",
  {
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id),
    createdAt: timestamp("created_at", { mode: "string", withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp("deleted_at", { mode: "string", withTimezone: true }),
    details: text("details"),
    dueAt: timestamp("due_at", { mode: "string", withTimezone: true }),
    endsAt: timestamp("ends_at", { mode: "string", withTimezone: true }),
    estimateSource: text("estimate_source"),
    estimatedMinutes: integer("estimated_minutes"),
    id: uuid("id").primaryKey(),
    kind: text("kind").notNull(),
    localDate: date("local_date"),
    progressBps: integer("progress_bps"),
    startsAt: timestamp("starts_at", { mode: "string", withTimezone: true }),
    state: text("state").default("planned").notNull(),
    temporalNote: text("temporal_note"),
    timeKind: text("time_kind").notNull(),
    timeZone: text("time_zone"),
    title: text("title").notNull(),
    version: integer("version").default(1).notNull(),
    updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("course_items_course_deleted_idx").on(table.courseId, table.deletedAt),
    index("course_items_date_idx").on(table.localDate),
    index("course_items_due_idx").on(table.dueAt),
    index("course_items_start_idx").on(table.startsAt),
    check(
      "course_items_kind_check",
      sql`${table.kind} in ('assignment','exam','quiz','lab','project','presentation','reading','milestone','other')`,
    ),
    check("course_items_state_check", sql`${table.state} in ('planned','completed','cancelled')`),
    check(
      "course_items_estimate_check",
      sql`${table.estimatedMinutes} is null or ${table.estimatedMinutes} > 0`,
    ),
    check(
      "course_items_progress_check",
      sql`${table.progressBps} is null or ${table.progressBps} between 0 and 10000`,
    ),
    check(
      "course_items_temporal_check",
      sql`
    (${table.timeKind} = 'unscheduled' and ${table.localDate} is null and ${table.dueAt} is null and ${table.startsAt} is null and ${table.endsAt} is null and ${table.timeZone} is null)
    or (${table.timeKind} = 'date' and ${table.localDate} is not null and ${table.dueAt} is null and ${table.startsAt} is null and ${table.endsAt} is null and ${table.timeZone} is null)
    or (${table.timeKind} = 'deadline' and ${table.localDate} is null and ${table.dueAt} is not null and ${table.startsAt} is null and ${table.endsAt} is null and ${table.timeZone} is not null)
    or (${table.timeKind} = 'interval' and ${table.localDate} is null and ${table.dueAt} is null and ${table.startsAt} is not null and ${table.endsAt} is not null and ${table.endsAt} > ${table.startsAt} and ${table.timeZone} is not null)
  `,
    ),
  ],
);

export const courseItemLabels = courseflow.table(
  "course_item_labels",
  {
    courseItemId: uuid("course_item_id")
      .notNull()
      .references(() => courseItems.id, { onDelete: "cascade" }),
    labelId: uuid("label_id")
      .notNull()
      .references(() => taskLabels.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.courseItemId, table.labelId] }),
    index("course_item_labels_label_idx").on(table.labelId),
  ],
);

export const gradingSchemes = courseflow.table(
  "grading_schemes",
  {
    conditionText: text("condition_text"),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id),
    id: uuid("id").primaryKey(),
    isPrimary: boolean("is_primary").default(false).notNull(),
    name: text("name").notNull(),
    version: integer("version").default(1).notNull(),
  },
  (table) => [
    index("grading_schemes_course_idx").on(table.courseId),
    uniqueIndex("grading_schemes_primary_unique")
      .on(table.courseId)
      .where(sql`${table.isPrimary} = true`),
  ],
);

export const gradeComponents = courseflow.table(
  "grade_components",
  {
    gradingSchemeId: uuid("grading_scheme_id")
      .notNull()
      .references(() => gradingSchemes.id, { onDelete: "cascade" }),
    id: uuid("id").primaryKey(),
    ruleText: text("rule_text"),
    sortOrder: integer("sort_order").notNull(),
    title: text("title").notNull(),
    weightBps: integer("weight_bps"),
  },
  (table) => [
    index("grade_components_scheme_order_idx").on(table.gradingSchemeId, table.sortOrder),
    check(
      "grade_components_weight_check",
      sql`${table.weightBps} is null or ${table.weightBps} between 0 and 10000`,
    ),
  ],
);

export const gradeResults = courseflow.table(
  "grade_results",
  {
    earnedMilli: bigint("earned_milli", { mode: "bigint" }).notNull(),
    gradeComponentId: uuid("grade_component_id")
      .notNull()
      .references(() => gradeComponents.id, { onDelete: "cascade" })
      .unique(),
    id: uuid("id").primaryKey(),
    note: text("note"),
    possibleMilli: bigint("possible_milli", { mode: "bigint" }).notNull(),
    recordedAt: timestamp("recorded_at", { mode: "string", withTimezone: true })
      .defaultNow()
      .notNull(),
    recordedByUserId: uuid("recorded_by_user_id")
      .notNull()
      .references(() => userProfiles.id),
    updatedAt: timestamp("updated_at", { mode: "string", withTimezone: true })
      .defaultNow()
      .notNull(),
    version: integer("version").default(1).notNull(),
  },
  (table) => [
    check("grade_results_earned_check", sql`${table.earnedMilli} >= 0`),
    check("grade_results_possible_check", sql`${table.possibleMilli} > 0`),
  ],
);

export const schema = {
  academicCalendarExceptions,
  academicTerms,
  courseItemLabels,
  courseItems,
  courses,
  gradeComponents,
  gradeResults,
  gradingSchemes,
  letterGradeBands,
  letterGradeScales,
  meetingExceptions,
  meetingPatterns,
  taskLabels,
  userProfiles,
};
