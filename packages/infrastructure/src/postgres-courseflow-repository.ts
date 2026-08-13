import {
  asCalendarExceptionId,
  asCourseId,
  asCourseItemId,
  asGradeComponentId,
  asGradeResultId,
  asGradingSchemeId,
  asLetterGradeScaleId,
  asMeetingExceptionId,
  asMeetingPatternId,
  asTaskLabelId,
  asTermId,
  buildCourseItem,
  buildCourseSetup,
  buildGradeResult,
  buildGradingScheme,
  buildLetterGradeScale,
  buildMeetingException,
  buildTaskLabel,
  buildTerm,
  buildTermArchived,
  buildUpdatedTerm,
  notFound,
  projectGradebook,
  validationError,
  versionConflict,
  type AcademicCalendarException,
  type AcademicTerm,
  type AcademicsRepository,
  type Clock,
  type CommandResult,
  type Course,
  type CourseDetail,
  type CourseId,
  type CourseItem,
  type CoursePlanningDetail,
  type CourseSetupView,
  type CreateCourseItem,
  type CreateCourseWithSchedule,
  type CreateTerm,
  type GradeComponent,
  type GradeComponentId,
  type GradeResult,
  type GradebookSnapshot,
  type GradingScheme,
  type IdGenerator,
  type LetterGradeScale,
  type LetterGradeScaleId,
  type MeetingException,
  type MeetingPattern,
  type PlanningRepository,
  type SaveGradeResult,
  type SaveGradingScheme,
  type SaveLetterGradeScale,
  type SaveMeetingException,
  type SaveTaskLabel,
  type ScheduleSnapshotQuery,
  type ScheduleSnapshotRepository,
  type ScheduleSourceData,
  type SetCourseArchived,
  type SetCourseLetterGradeScale,
  type SetTermArchived,
  type TaskLabel,
  type TaskLabelId,
  type TermId,
  type TermSummary,
  type TermDetail,
  type UpdateCourseItem,
  type UpdateTerm,
  type UserId,
  type UserScope,
} from "@courseflow/core";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

type DatabaseDate = Date | string;

type TermRow = QueryResultRow & {
  archived_at: Date | null;
  end_date: DatabaseDate;
  id: string;
  name: string;
  start_date: DatabaseDate;
  time_zone: string;
  version: number;
  week_numbering_policy: string;
};

type CalendarExceptionRow = QueryResultRow & {
  end_date: DatabaseDate;
  id: string;
  kind: AcademicCalendarException["kind"];
  name: string;
  start_date: DatabaseDate;
  suppresses_meetings: boolean;
  term_id: string;
  version: number;
};

type CourseRow = QueryResultRow & {
  archived_at: Date | null;
  code: string;
  color_key: Course["colorKey"];
  credit_value_milli: number | null;
  id: string;
  instructor_name: string | null;
  letter_grade_scale_id: string | null;
  section: string | null;
  term_id: string;
  time_zone: string;
  title: string;
  version: number;
};

type MeetingPatternRow = QueryResultRow & {
  archived_at: Date | null;
  course_id: string;
  effective_end_date: DatabaseDate | null;
  effective_start_date: DatabaseDate | null;
  id: string;
  kind: MeetingPattern["kind"];
  local_end_time: string;
  local_start_time: string;
  location_text: string | null;
  section: string | null;
  title: string | null;
  version: number;
  weekdays_mask: number;
};

type MeetingExceptionRow = QueryResultRow & {
  action: MeetingException["action"];
  id: string;
  meeting_pattern_id: string;
  note: string | null;
  occurrence_date: DatabaseDate;
  replacement_date: DatabaseDate | null;
  replacement_end_time: string | null;
  replacement_location_text: string | null;
  replacement_start_time: string | null;
  replacement_time_zone: string | null;
  version: number;
};

type LabelRow = QueryResultRow & {
  color_key: TaskLabel["colorKey"];
  display_name: string;
  id: string;
  normalized_name: string;
  term_id: string;
  version: number;
};

type ItemRow = QueryResultRow & {
  course_id: string;
  details: string | null;
  due_at: Date | null;
  ends_at: Date | null;
  estimate_source: CourseItem["estimateSource"];
  estimated_minutes: number | null;
  id: string;
  kind: CourseItem["kind"];
  local_date: DatabaseDate | null;
  progress_bps: number | null;
  starts_at: Date | null;
  state: CourseItem["state"];
  temporal_note: string | null;
  time_kind: CourseItem["temporal"]["kind"];
  time_zone: string | null;
  title: string;
  version: number;
};

type ScheduleItemRow = ItemRow & { updated_at: Date | string };

type ItemLabelRow = LabelRow & { course_item_id: string };

type ProfileDisplayRow = QueryResultRow & {
  locale: string;
  time_zone: string;
  week_starts_on: number;
};

type SchemeRow = QueryResultRow & {
  condition_text: string | null;
  course_id: string;
  id: string;
  is_primary: boolean;
  name: string;
  version: number;
};

type ComponentRow = QueryResultRow & {
  grading_scheme_id: string;
  id: string;
  rule_text: string | null;
  sort_order: number;
  title: string;
  weight_bps: number | null;
};

type ResultRow = QueryResultRow & {
  earned_milli: string;
  grade_component_id: string;
  id: string;
  note: string | null;
  possible_milli: string;
  version: number;
};

type ScaleRow = QueryResultRow & { id: string; name: string; version: number };
type BandRow = QueryResultRow & {
  letter: "A" | "B" | "C" | "D" | "F";
  minimum_percent_bps: number;
};

function asIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function asRequiredIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function asLocalDate(value: DatabaseDate): string {
  if (typeof value === "string") return value.slice(0, 10);
  return [
    value.getFullYear().toString().padStart(4, "0"),
    (value.getMonth() + 1).toString().padStart(2, "0"),
    value.getDate().toString().padStart(2, "0"),
  ].join("-");
}

function asNullableLocalDate(value: DatabaseDate | null): string | null {
  return value === null ? null : asLocalDate(value);
}

function weekdayMask(weekdays: readonly number[]): number {
  return weekdays.reduce((mask, weekday) => mask | (1 << weekday), 0);
}

function weekdaysFromMask(mask: number): readonly number[] {
  return Array.from({ length: 7 }, (_, weekday) => weekday).filter(
    (weekday) => (mask & (1 << weekday)) !== 0,
  );
}

function mapTerm(row: TermRow): AcademicTerm {
  return {
    archivedAt: asIso(row.archived_at),
    endDate: asLocalDate(row.end_date),
    id: asTermId(row.id),
    name: row.name,
    startDate: asLocalDate(row.start_date),
    timeZone: row.time_zone,
    version: row.version,
    weekNumberingPolicy: "teaching_weeks_v1",
  };
}

function mapCalendarException(row: CalendarExceptionRow): AcademicCalendarException {
  return {
    endDate: asLocalDate(row.end_date),
    id: asCalendarExceptionId(row.id),
    kind: row.kind,
    name: row.name,
    startDate: asLocalDate(row.start_date),
    suppressesMeetings: row.suppresses_meetings,
    termId: asTermId(row.term_id),
    version: row.version,
  };
}

function mapCourse(row: CourseRow): Course {
  return {
    archivedAt: asIso(row.archived_at),
    code: row.code,
    colorKey: row.color_key,
    creditValueMilli: row.credit_value_milli,
    id: asCourseId(row.id),
    instructorName: row.instructor_name,
    letterGradeScaleId:
      row.letter_grade_scale_id === null ? null : asLetterGradeScaleId(row.letter_grade_scale_id),
    section: row.section,
    termId: asTermId(row.term_id),
    timeZone: row.time_zone,
    title: row.title,
    version: row.version,
  };
}

function mapPattern(row: MeetingPatternRow): MeetingPattern {
  return {
    archivedAt: asIso(row.archived_at),
    courseId: asCourseId(row.course_id),
    effectiveEndDate: asNullableLocalDate(row.effective_end_date),
    effectiveStartDate: asNullableLocalDate(row.effective_start_date),
    id: asMeetingPatternId(row.id),
    kind: row.kind,
    localEndTime: row.local_end_time.slice(0, 5),
    localStartTime: row.local_start_time.slice(0, 5),
    locationText: row.location_text,
    section: row.section,
    title: row.title,
    version: row.version,
    weekdays: weekdaysFromMask(row.weekdays_mask),
  };
}

function mapMeetingException(row: MeetingExceptionRow): MeetingException {
  return {
    action: row.action,
    id: asMeetingExceptionId(row.id),
    meetingPatternId: asMeetingPatternId(row.meeting_pattern_id),
    note: row.note,
    occurrenceDate: asLocalDate(row.occurrence_date),
    replacementDate: asNullableLocalDate(row.replacement_date),
    replacementEndTime: row.replacement_end_time?.slice(0, 5) ?? null,
    replacementLocationText: row.replacement_location_text,
    replacementStartTime: row.replacement_start_time?.slice(0, 5) ?? null,
    replacementTimeZone: row.replacement_time_zone,
    version: row.version,
  };
}

function mapLabel(row: LabelRow): TaskLabel {
  return {
    colorKey: row.color_key,
    displayName: row.display_name,
    id: asTaskLabelId(row.id),
    normalizedName: row.normalized_name,
    termId: asTermId(row.term_id),
    version: row.version,
  };
}

function mapResult(row: ResultRow): GradeResult {
  return {
    earnedMilli: BigInt(row.earned_milli),
    gradeComponentId: asGradeComponentId(row.grade_component_id),
    id: asGradeResultId(row.id),
    note: row.note,
    possibleMilli: BigInt(row.possible_milli),
    version: row.version,
  };
}

function mapItem(row: ItemRow, labels: readonly TaskLabel[]): CourseItem {
  const common = { note: row.temporal_note };
  let temporal: CourseItem["temporal"];
  switch (row.time_kind) {
    case "unscheduled":
      temporal = { ...common, kind: "unscheduled" };
      break;
    case "date":
      temporal = { ...common, date: asLocalDate(row.local_date!), kind: "date" };
      break;
    case "deadline":
      temporal = { ...common, at: asIso(row.due_at)!, kind: "deadline", timeZone: row.time_zone! };
      break;
    case "interval":
      temporal = {
        ...common,
        endsAt: asIso(row.ends_at)!,
        kind: "interval",
        startsAt: asIso(row.starts_at)!,
        timeZone: row.time_zone!,
      };
      break;
  }
  return {
    courseId: asCourseId(row.course_id),
    details: row.details,
    estimatedMinutes: row.estimated_minutes,
    estimateSource: row.estimate_source,
    id: asCourseItemId(row.id),
    kind: row.kind,
    labels,
    progressBps: row.progress_bps,
    state: row.state,
    temporal,
    title: row.title,
    version: row.version,
  };
}

function temporalColumns(temporal: CourseItem["temporal"]) {
  return {
    dueAt: temporal.kind === "deadline" ? temporal.at : null,
    endsAt: temporal.kind === "interval" ? temporal.endsAt : null,
    localDate: temporal.kind === "date" ? temporal.date : null,
    note: temporal.note,
    startsAt: temporal.kind === "interval" ? temporal.startsAt : null,
    timeKind: temporal.kind,
    timeZone:
      temporal.kind === "deadline" || temporal.kind === "interval" ? temporal.timeZone : null,
  };
}

export type UserProfileSeed = Readonly<{
  authSubject: string;
  displayName: string;
  locale: string;
  timeZone: string;
  userId: UserId;
}>;

export class PostgresCourseFlowRepository
  implements AcademicsRepository, PlanningRepository, ScheduleSnapshotRepository
{
  readonly #clock: Clock;
  readonly #ids: IdGenerator;
  readonly #pool: Pool;

  constructor(input: Readonly<{ clock: Clock; ids: IdGenerator; pool: Pool }>) {
    this.#clock = input.clock;
    this.#ids = input.ids;
    this.#pool = input.pool;
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  async ensureUserProfile(seed: UserProfileSeed): Promise<UserScope> {
    await this.#pool.query(
      `insert into courseflow.user_profiles
        (id, auth_subject, display_name, locale, time_zone)
       values ($1, $2, $3, $4, $5)
       on conflict (auth_subject) do update set
         display_name = excluded.display_name,
         locale = excluded.locale,
         time_zone = excluded.time_zone,
         updated_at = now()`,
      [seed.userId, seed.authSubject, seed.displayName, seed.locale, seed.timeZone],
    );
    const result = await this.#pool.query<{ id: string }>(
      "select id from courseflow.user_profiles where auth_subject = $1",
      [seed.authSubject],
    );
    return { userId: result.rows[0]!.id as UserId };
  }

  async #transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query("begin");
      const value = await work(client);
      await client.query("commit");
      return value;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async #loadTerm(
    client: PoolClient,
    scope: UserScope,
    termId: TermId,
    lock = false,
  ): Promise<Readonly<{
    exceptions: readonly AcademicCalendarException[];
    term: AcademicTerm;
  }> | null> {
    const termResult = await client.query<TermRow>(
      `select archived_at, end_date, id, name, start_date, time_zone, version, week_numbering_policy
       from courseflow.academic_terms
       where id = $1 and owner_user_id = $2${lock ? " for update" : ""}`,
      [termId, scope.userId],
    );
    const row = termResult.rows[0];
    if (row === undefined) return null;
    const exceptionResult = await client.query<CalendarExceptionRow>(
      `select end_date, id, kind, name, start_date, suppresses_meetings, term_id, version
       from courseflow.academic_calendar_exceptions where term_id = $1 order by start_date, id`,
      [termId],
    );
    return { exceptions: exceptionResult.rows.map(mapCalendarException), term: mapTerm(row) };
  }

  async #loadCourse(
    client: PoolClient,
    scope: UserScope,
    courseId: CourseId,
    lock = false,
  ): Promise<CourseSetupView | null> {
    const courseResult = await client.query<CourseRow>(
      `select c.archived_at, c.code, c.color_key, c.credit_value_milli, c.id,
              c.instructor_name, c.letter_grade_scale_id, c.section, c.term_id,
              c.time_zone, c.title, c.version
       from courseflow.courses c
       join courseflow.academic_terms t on t.id = c.term_id
       where c.id = $1 and t.owner_user_id = $2${lock ? " for update of c" : ""}`,
      [courseId, scope.userId],
    );
    const row = courseResult.rows[0];
    if (row === undefined) return null;
    const termSetup = await this.#loadTerm(client, scope, asTermId(row.term_id));
    if (termSetup === null) return null;
    const patterns = await client.query<MeetingPatternRow>(
      `select archived_at, course_id, effective_end_date, effective_start_date, id, kind,
                 local_end_time, local_start_time, location_text, section, title, version, weekdays_mask
          from courseflow.meeting_patterns where course_id = $1 order by id`,
      [courseId],
    );
    const exceptions = await client.query<MeetingExceptionRow>(
      `select me.action, me.id, me.meeting_pattern_id, me.note, me.occurrence_date,
                 me.replacement_date, me.replacement_end_time, me.replacement_location_text,
                 me.replacement_start_time, me.replacement_time_zone, me.version
          from courseflow.meeting_exceptions me
          join courseflow.meeting_patterns mp on mp.id = me.meeting_pattern_id
          where mp.course_id = $1 order by me.occurrence_date, me.id`,
      [courseId],
    );
    return {
      calendarExceptions: termSetup.exceptions,
      course: mapCourse(row),
      meetingExceptions: exceptions.rows.map(mapMeetingException),
      meetingPatterns: patterns.rows.map(mapPattern),
      term: termSetup.term,
    };
  }

  async createTerm(scope: UserScope, input: CreateTerm): Promise<CommandResult<AcademicTerm>> {
    const built = buildTerm(input, this.#ids);
    await this.#transaction(async (client) => {
      await client.query(
        `insert into courseflow.academic_terms
          (archived_at, end_date, id, name, owner_user_id, start_date, time_zone, version, week_numbering_policy)
         values (null, $1, $2, $3, $4, $5, $6, 1, $7)`,
        [
          built.term.endDate,
          built.term.id,
          built.term.name,
          scope.userId,
          built.term.startDate,
          built.term.timeZone,
          built.term.weekNumberingPolicy,
        ],
      );
      for (const exception of built.exceptions) {
        await client.query(
          `insert into courseflow.academic_calendar_exceptions
            (end_date, id, kind, name, start_date, suppresses_meetings, term_id, version)
           values ($1, $2, $3, $4, $5, $6, $7, 1)`,
          [
            exception.endDate,
            exception.id,
            exception.kind,
            exception.name,
            exception.startDate,
            exception.suppressesMeetings,
            exception.termId,
          ],
        );
      }
      await client.query(
        "update courseflow.user_profiles set active_term_id = coalesce(active_term_id, $1), updated_at = now() where id = $2",
        [built.term.id, scope.userId],
      );
    });
    return { value: built.term, warnings: [] };
  }

  async updateTerm(scope: UserScope, input: UpdateTerm): Promise<CommandResult<AcademicTerm>> {
    return this.#transaction(async (client) => {
      const current = await this.#loadTerm(client, scope, input.termId, true);
      if (current === null) throw notFound();
      const value = buildUpdatedTerm(current.term, input);
      await client.query(
        `update courseflow.academic_terms set name=$1, start_date=$2, end_date=$3,
         time_zone=$4, version=$5 where id=$6 and owner_user_id=$7`,
        [
          value.name,
          value.startDate,
          value.endDate,
          value.timeZone,
          value.version,
          value.id,
          scope.userId,
        ],
      );
      return { value, warnings: [] };
    });
  }

  async listTerms(scope: UserScope): Promise<readonly TermSummary[]> {
    const result = await this.#pool.query<TermRow & { course_count: string; is_active: boolean }>(
      `select t.archived_at, t.end_date, t.id, t.name, t.start_date, t.time_zone, t.version,
              t.week_numbering_policy, count(c.id)::text as course_count,
              (u.active_term_id = t.id) as is_active
       from courseflow.academic_terms t
       join courseflow.user_profiles u on u.id = t.owner_user_id
       left join courseflow.courses c on c.term_id = t.id and c.archived_at is null
       where t.owner_user_id = $1
       group by t.id, u.active_term_id order by t.start_date desc, t.id`,
      [scope.userId],
    );
    return result.rows.map((row) => ({
      ...mapTerm(row),
      courseCount: Number(row.course_count),
      isActive: row.is_active,
    }));
  }

  async getTerm(scope: UserScope, termId: TermId): Promise<TermDetail | null> {
    const client = await this.#pool.connect();
    try {
      const found = await this.#loadTerm(client, scope, termId);
      return found === null ? null : { calendarExceptions: found.exceptions, term: found.term };
    } finally {
      client.release();
    }
  }

  async setActiveTerm(scope: UserScope, termId: TermId): Promise<void> {
    const result = await this.#pool.query(
      `update courseflow.user_profiles u set active_term_id=$1, updated_at=now()
       where u.id=$2 and exists (
         select 1 from courseflow.academic_terms t
         where t.id=$1 and t.owner_user_id=u.id and t.archived_at is null
       )`,
      [termId, scope.userId],
    );
    if (result.rowCount !== 1) throw notFound();
  }

  async setTermArchived(
    scope: UserScope,
    input: SetTermArchived,
  ): Promise<CommandResult<AcademicTerm>> {
    return this.#transaction(async (client) => {
      const current = await this.#loadTerm(client, scope, input.termId, true);
      if (current === null) throw notFound();
      const value = buildTermArchived(current.term, input, this.#clock.now());
      const result = await client.query(
        `update courseflow.academic_terms set archived_at=$1, version=$2
         where id=$3 and owner_user_id=$4 and version=$5`,
        [value.archivedAt, value.version, value.id, scope.userId, input.expectedVersion],
      );
      if (result.rowCount !== 1) throw versionConflict(current.term.version);
      if (input.archived) {
        await client.query(
          `update courseflow.user_profiles set active_term_id=null, updated_at=now()
           where id=$1 and active_term_id=$2`,
          [scope.userId, input.termId],
        );
      }
      return { value, warnings: [] };
    });
  }

  async createCourseWithSchedule(
    scope: UserScope,
    input: CreateCourseWithSchedule,
  ): Promise<CommandResult<CourseSetupView>> {
    return this.#transaction(async (client) => {
      const term = await this.#loadTerm(client, scope, input.termId, true);
      if (term === null) throw notFound();
      if (input.letterGradeScaleId !== undefined && input.letterGradeScaleId !== null) {
        const scale = await this.#getLetterGradeScale(client, scope, input.letterGradeScaleId);
        if (scale === null) throw notFound();
      }
      const result = buildCourseSetup(term.term, term.exceptions, input, this.#ids);
      const course = result.value.course;
      await client.query(
        `insert into courseflow.courses
          (archived_at, code, color_key, credit_value_milli, id, instructor_name,
           letter_grade_scale_id, section, term_id, time_zone, title, version)
         values (null,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1)`,
        [
          course.code,
          course.colorKey,
          course.creditValueMilli,
          course.id,
          course.instructorName,
          course.letterGradeScaleId,
          course.section,
          course.termId,
          course.timeZone,
          course.title,
        ],
      );
      for (const pattern of result.value.meetingPatterns) {
        await client.query(
          `insert into courseflow.meeting_patterns
            (archived_at, course_id, effective_end_date, effective_start_date, id, kind,
             local_end_time, local_start_time, location_text, section, title, version, weekdays_mask)
           values (null,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11)`,
          [
            pattern.courseId,
            pattern.effectiveEndDate,
            pattern.effectiveStartDate,
            pattern.id,
            pattern.kind,
            pattern.localEndTime,
            pattern.localStartTime,
            pattern.locationText,
            pattern.section,
            pattern.title,
            weekdayMask(pattern.weekdays),
          ],
        );
      }
      return result;
    });
  }

  async listCourses(scope: UserScope, termId?: TermId): Promise<readonly CourseSetupView[]> {
    const ids = await this.#pool.query<{ id: string }>(
      `select c.id from courseflow.courses c
       join courseflow.academic_terms t on t.id=c.term_id
       where t.owner_user_id=$1 and ($2::uuid is null or c.term_id=$2)
       order by c.archived_at nulls first, c.code, c.id`,
      [scope.userId, termId ?? null],
    );
    const courses = await Promise.all(
      ids.rows.map((row) => this.getCourse(scope, asCourseId(row.id))),
    );
    return courses.filter((course): course is CourseSetupView => course !== null);
  }

  async getCourse(scope: UserScope, courseId: CourseId): Promise<CourseDetail | null> {
    const client = await this.#pool.connect();
    try {
      return await this.#loadCourse(client, scope, courseId);
    } finally {
      client.release();
    }
  }

  async loadScheduleSource(
    scope: UserScope,
    query: ScheduleSnapshotQuery,
  ): Promise<ScheduleSourceData | null> {
    const client = await this.#pool.connect();
    try {
      await client.query("begin isolation level repeatable read read only");
      const profileResult = await client.query<ProfileDisplayRow>(
        `select locale,time_zone,week_starts_on
         from courseflow.user_profiles where id=$1`,
        [scope.userId],
      );
      const profile = profileResult.rows[0];
      if (profile === undefined) {
        await client.query("rollback");
        return null;
      }
      const loadedTerm = await this.#loadTerm(client, scope, query.termId);
      if (loadedTerm === null) {
        await client.query("rollback");
        return null;
      }
      const courseRows = await client.query<CourseRow>(
        `select c.archived_at,c.code,c.color_key,c.credit_value_milli,c.id,
                c.instructor_name,c.letter_grade_scale_id,c.section,c.term_id,
                c.time_zone,c.title,c.version
         from courseflow.courses c
         join courseflow.academic_terms t on t.id=c.term_id
         where c.term_id=$1 and c.archived_at is null and t.owner_user_id=$2
         order by c.code,c.id`,
        [query.termId, scope.userId],
      );
      const patternRows = await client.query<MeetingPatternRow>(
        `select mp.archived_at,mp.course_id,mp.effective_end_date,mp.effective_start_date,
                mp.id,mp.kind,mp.local_end_time,mp.local_start_time,mp.location_text,
                mp.section,mp.title,mp.version,mp.weekdays_mask
         from courseflow.meeting_patterns mp
         join courseflow.courses c on c.id=mp.course_id
         join courseflow.academic_terms t on t.id=c.term_id
         where c.term_id=$1 and c.archived_at is null and t.owner_user_id=$2
         order by mp.course_id,mp.id`,
        [query.termId, scope.userId],
      );
      const meetingExceptionRows = await client.query<MeetingExceptionRow>(
        `select me.action,me.id,me.meeting_pattern_id,me.note,me.occurrence_date,
                me.replacement_date,me.replacement_end_time,me.replacement_location_text,
                me.replacement_start_time,me.replacement_time_zone,me.version
         from courseflow.meeting_exceptions me
         join courseflow.meeting_patterns mp on mp.id=me.meeting_pattern_id
         join courseflow.courses c on c.id=mp.course_id
         join courseflow.academic_terms t on t.id=c.term_id
         where c.term_id=$1 and c.archived_at is null and t.owner_user_id=$2
         order by me.meeting_pattern_id,me.occurrence_date,me.id`,
        [query.termId, scope.userId],
      );
      const labelRows = await client.query<LabelRow>(
        `select color_key,display_name,id,normalized_name,term_id,version
         from courseflow.task_labels where term_id=$1 order by display_name,id`,
        [query.termId],
      );
      const itemRows = await client.query<ScheduleItemRow>(
        `select i.course_id,i.details,i.due_at,i.ends_at,i.estimate_source,i.estimated_minutes,
                i.id,i.kind,i.local_date,i.progress_bps,i.starts_at,i.state,i.temporal_note,
                i.time_kind,i.time_zone,i.title,i.updated_at,i.version
         from courseflow.course_items i
         join courseflow.courses c on c.id=i.course_id
         join courseflow.academic_terms t on t.id=c.term_id
         where c.term_id=$1 and c.archived_at is null and i.deleted_at is null
           and t.owner_user_id=$2
         order by i.id`,
        [query.termId, scope.userId],
      );
      const itemLabelRows = await client.query<ItemLabelRow>(
        `select il.course_item_id,l.color_key,l.display_name,l.id,l.normalized_name,l.term_id,l.version
         from courseflow.course_item_labels il
         join courseflow.task_labels l on l.id=il.label_id
         join courseflow.course_items i on i.id=il.course_item_id
         join courseflow.courses c on c.id=i.course_id
         join courseflow.academic_terms t on t.id=c.term_id
         where c.term_id=$1 and c.archived_at is null and i.deleted_at is null
           and t.owner_user_id=$2
         order by il.course_item_id,l.display_name,l.id`,
        [query.termId, scope.userId],
      );
      const patternsByCourse = new Map<string, MeetingPattern[]>();
      for (const row of patternRows.rows) {
        const patterns = patternsByCourse.get(row.course_id) ?? [];
        patterns.push(mapPattern(row));
        patternsByCourse.set(row.course_id, patterns);
      }
      const patternCourse = new Map(patternRows.rows.map((row) => [row.id, row.course_id]));
      const exceptionsByCourse = new Map<string, MeetingException[]>();
      for (const row of meetingExceptionRows.rows) {
        const courseId = patternCourse.get(row.meeting_pattern_id);
        if (courseId === undefined) continue;
        const exceptions = exceptionsByCourse.get(courseId) ?? [];
        exceptions.push(mapMeetingException(row));
        exceptionsByCourse.set(courseId, exceptions);
      }
      const labelsByItem = new Map<string, TaskLabel[]>();
      for (const row of itemLabelRows.rows) {
        const labels = labelsByItem.get(row.course_item_id) ?? [];
        labels.push(mapLabel(row));
        labelsByItem.set(row.course_item_id, labels);
      }
      const courseSetups = courseRows.rows.map((row): CourseSetupView => ({
        calendarExceptions: loadedTerm.exceptions,
        course: mapCourse(row),
        meetingExceptions: exceptionsByCourse.get(row.id) ?? [],
        meetingPatterns: patternsByCourse.get(row.id) ?? [],
        term: loadedTerm.term,
      }));
      const source: ScheduleSourceData = {
        calendarExceptions: loadedTerm.exceptions,
        courseSetups,
        items: itemRows.rows.map((row) => ({
          item: mapItem(row, labelsByItem.get(row.id) ?? []),
          updatedAt: asRequiredIso(row.updated_at),
        })),
        labels: labelRows.rows.map(mapLabel),
        locale: profile.locale,
        term: loadedTerm.term,
        timeZone: query.displayTimeZone ?? profile.time_zone,
        weekStartsOn: profile.week_starts_on,
      };
      await client.query("commit");
      return source;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async setCourseArchived(
    scope: UserScope,
    input: SetCourseArchived,
  ): Promise<CommandResult<CourseSetupView>> {
    return this.#transaction(async (client) => {
      const current = await this.#loadCourse(client, scope, input.courseId, true);
      if (current === null) throw notFound();
      if (current.course.version !== input.expectedVersion)
        throw versionConflict(current.course.version);
      await client.query(
        `update courseflow.courses set archived_at=$1, version=version+1
         where id=$2 and version=$3`,
        [input.archived ? this.#clock.now() : null, input.courseId, input.expectedVersion],
      );
      return {
        value: {
          ...current,
          course: {
            ...current.course,
            archivedAt: input.archived ? this.#clock.now().toISOString() : null,
            version: current.course.version + 1,
          },
        },
        warnings: [],
      };
    });
  }

  async setCourseLetterGradeScale(
    scope: UserScope,
    input: SetCourseLetterGradeScale,
  ): Promise<CommandResult<CourseSetupView>> {
    return this.#transaction(async (client) => {
      const current = await this.#loadCourse(client, scope, input.courseId, true);
      if (current === null) throw notFound();
      if (current.course.version !== input.expectedVersion)
        throw versionConflict(current.course.version);
      if (input.letterGradeScaleId !== null) {
        const scale = await this.#getLetterGradeScale(client, scope, input.letterGradeScaleId);
        if (scale === null) throw notFound();
      }
      const result = await client.query(
        `update courseflow.courses set letter_grade_scale_id=$1,version=version+1
         where id=$2 and version=$3`,
        [input.letterGradeScaleId, input.courseId, input.expectedVersion],
      );
      if (result.rowCount !== 1) throw versionConflict(current.course.version);
      return {
        value: {
          ...current,
          course: {
            ...current.course,
            letterGradeScaleId: input.letterGradeScaleId,
            version: current.course.version + 1,
          },
        },
        warnings: [],
      };
    });
  }

  async saveMeetingException(
    scope: UserScope,
    input: SaveMeetingException,
  ): Promise<CommandResult<MeetingException>> {
    return this.#transaction(async (client) => {
      await client.query(
        `select me.id from courseflow.meeting_exceptions me
         join courseflow.meeting_patterns mp on mp.id=me.meeting_pattern_id
         join courseflow.courses c on c.id=mp.course_id
         join courseflow.academic_terms t on t.id=c.term_id
         where me.meeting_pattern_id=$1 and me.occurrence_date=$2 and t.owner_user_id=$3
         for update of me`,
        [input.meetingPatternId, input.occurrenceDate, scope.userId],
      );
      const courseIdResult = await client.query<{ course_id: string }>(
        `select mp.course_id from courseflow.meeting_patterns mp
         join courseflow.courses c on c.id=mp.course_id
         join courseflow.academic_terms t on t.id=c.term_id
         where mp.id=$1 and t.owner_user_id=$2 for update of mp`,
        [input.meetingPatternId, scope.userId],
      );
      const courseId = courseIdResult.rows[0]?.course_id;
      if (courseId === undefined) throw notFound();
      const setup = await this.#loadCourse(client, scope, asCourseId(courseId));
      if (setup === null) throw notFound();
      const pattern = setup.meetingPatterns.find(
        (candidate) => candidate.id === input.meetingPatternId,
      );
      if (pattern === undefined) throw notFound();
      const existing = setup.meetingExceptions?.find(
        (candidate) =>
          candidate.meetingPatternId === input.meetingPatternId &&
          candidate.occurrenceDate === input.occurrenceDate,
      );
      const value = buildMeetingException(setup, pattern, input, this.#ids, existing);
      if (existing === undefined) {
        await client.query(
          `insert into courseflow.meeting_exceptions
            (action,id,meeting_pattern_id,note,occurrence_date,replacement_date,replacement_end_time,
             replacement_location_text,replacement_start_time,replacement_time_zone,version)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1)`,
          [
            value.action,
            value.id,
            value.meetingPatternId,
            value.note,
            value.occurrenceDate,
            value.replacementDate,
            value.replacementEndTime,
            value.replacementLocationText,
            value.replacementStartTime,
            value.replacementTimeZone,
          ],
        );
      } else {
        await client.query(
          `update courseflow.meeting_exceptions set action=$1,note=$2,replacement_date=$3,
           replacement_end_time=$4,replacement_location_text=$5,replacement_start_time=$6,
           replacement_time_zone=$7,version=$8,updated_at=now() where id=$9`,
          [
            value.action,
            value.note,
            value.replacementDate,
            value.replacementEndTime,
            value.replacementLocationText,
            value.replacementStartTime,
            value.replacementTimeZone,
            value.version,
            value.id,
          ],
        );
      }
      return { value, warnings: [] };
    });
  }

  async saveTaskLabel(scope: UserScope, input: SaveTaskLabel): Promise<CommandResult<TaskLabel>> {
    return this.#transaction(async (client) => {
      const term = await this.#loadTerm(client, scope, input.termId);
      if (term === null) throw notFound();
      let existing: TaskLabel | undefined;
      if (input.labelId !== undefined) {
        const found = await client.query<LabelRow>(
          `select l.color_key,l.display_name,l.id,l.normalized_name,l.term_id,l.version
           from courseflow.task_labels l join courseflow.academic_terms t on t.id=l.term_id
           where l.id=$1 and t.owner_user_id=$2 for update of l`,
          [input.labelId, scope.userId],
        );
        if (found.rows[0] === undefined) throw notFound();
        existing = mapLabel(found.rows[0]);
        if (existing.version !== input.expectedVersion) throw versionConflict(existing.version);
      }
      const value = buildTaskLabel(input, this.#ids);
      try {
        if (existing === undefined) {
          await client.query(
            `insert into courseflow.task_labels
              (color_key,display_name,id,normalized_name,term_id,version) values ($1,$2,$3,$4,$5,1)`,
            [value.colorKey, value.displayName, value.id, value.normalizedName, value.termId],
          );
        } else {
          await client.query(
            `update courseflow.task_labels set color_key=$1,display_name=$2,normalized_name=$3,version=$4,updated_at=now() where id=$5`,
            [value.colorKey, value.displayName, value.normalizedName, value.version, value.id],
          );
        }
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "23505"
        ) {
          throw validationError("该学期已有同名标签。", [
            {
              code: "DUPLICATE_LABEL",
              message: "请使用现有标签或更换名称。",
              path: "/displayName",
            },
          ]);
        }
        throw error;
      }
      return { value, warnings: [] };
    });
  }

  async #labelsForItem(
    client: PoolClient,
    itemId: CourseItem["id"],
  ): Promise<readonly TaskLabel[]> {
    const result = await client.query<LabelRow>(
      `select l.color_key,l.display_name,l.id,l.normalized_name,l.term_id,l.version
       from courseflow.task_labels l join courseflow.course_item_labels il on il.label_id=l.id
       where il.course_item_id=$1 order by l.display_name,l.id`,
      [itemId],
    );
    return result.rows.map(mapLabel);
  }

  async #loadItem(
    client: PoolClient,
    scope: UserScope,
    itemId: CourseItem["id"],
    lock = false,
  ): Promise<CourseItem | null> {
    const result = await client.query<ItemRow>(
      `select i.course_id,i.details,i.due_at,i.ends_at,i.estimate_source,i.estimated_minutes,
              i.id,i.kind,i.local_date,i.progress_bps,i.starts_at,i.state,i.temporal_note,
              i.time_kind,i.time_zone,i.title,i.version
       from courseflow.course_items i
       join courseflow.courses c on c.id=i.course_id
       join courseflow.academic_terms t on t.id=c.term_id
       where i.id=$1 and i.deleted_at is null and t.owner_user_id=$2${lock ? " for update of i" : ""}`,
      [itemId, scope.userId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return mapItem(row, await this.#labelsForItem(client, asCourseItemId(row.id)));
  }

  async #replaceItemLabels(
    client: PoolClient,
    scope: UserScope,
    item: CourseItem,
    labelIds: readonly TaskLabelId[],
  ): Promise<readonly TaskLabel[]> {
    const result = await client.query<LabelRow>(
      `select l.color_key,l.display_name,l.id,l.normalized_name,l.term_id,l.version
       from courseflow.task_labels l
       join courseflow.academic_terms t on t.id=l.term_id
       join courseflow.courses c on c.term_id=t.id
       where c.id=$1 and t.owner_user_id=$2 and l.id=any($3::uuid[])`,
      [item.courseId, scope.userId, labelIds],
    );
    if (result.rows.length !== new Set(labelIds).size) throw notFound();
    await client.query("delete from courseflow.course_item_labels where course_item_id=$1", [
      item.id,
    ]);
    for (const labelId of new Set(labelIds)) {
      await client.query(
        "insert into courseflow.course_item_labels (course_item_id,label_id) values ($1,$2)",
        [item.id, labelId],
      );
    }
    return result.rows.map(mapLabel);
  }

  async #validateItemLabels(
    client: PoolClient,
    scope: UserScope,
    courseId: CourseId,
    labelIds: readonly TaskLabelId[],
  ): Promise<readonly TaskLabel[]> {
    const result = await client.query<LabelRow>(
      `select l.color_key,l.display_name,l.id,l.normalized_name,l.term_id,l.version
       from courseflow.task_labels l
       join courseflow.academic_terms t on t.id=l.term_id
       join courseflow.courses c on c.term_id=t.id
       where c.id=$1 and t.owner_user_id=$2 and l.id=any($3::uuid[])`,
      [courseId, scope.userId, labelIds],
    );
    if (result.rows.length !== new Set(labelIds).size) throw notFound();
    return result.rows.map(mapLabel);
  }

  async createCourseItem(
    scope: UserScope,
    input: CreateCourseItem,
  ): Promise<CommandResult<CourseItem>> {
    return this.#transaction(async (client) => {
      const course = await this.#loadCourse(client, scope, input.courseId);
      if (course === null) throw notFound();
      const labels = await this.#validateItemLabels(
        client,
        scope,
        input.courseId,
        input.labelIds ?? [],
      );
      const value = buildCourseItem(input, this.#ids, labels);
      const temporal = temporalColumns(value.temporal);
      await client.query(
        `insert into courseflow.course_items
          (course_id,details,due_at,ends_at,estimate_source,estimated_minutes,id,kind,local_date,
           progress_bps,starts_at,state,temporal_note,time_kind,time_zone,title,version)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,1)`,
        [
          value.courseId,
          value.details,
          temporal.dueAt,
          temporal.endsAt,
          value.estimateSource,
          value.estimatedMinutes,
          value.id,
          value.kind,
          temporal.localDate,
          value.progressBps,
          temporal.startsAt,
          value.state,
          temporal.note,
          temporal.timeKind,
          temporal.timeZone,
          value.title,
        ],
      );
      for (const label of labels) {
        await client.query(
          "insert into courseflow.course_item_labels (course_item_id,label_id) values ($1,$2)",
          [value.id, label.id],
        );
      }
      return { value, warnings: [] };
    });
  }

  async updateCourseItem(
    scope: UserScope,
    input: UpdateCourseItem,
  ): Promise<CommandResult<CourseItem>> {
    return this.#transaction(async (client) => {
      const current = await this.#loadItem(client, scope, input.itemId, true);
      if (current === null) throw notFound();
      if (current.version !== input.expectedVersion) throw versionConflict(current.version);
      const rebuilt = buildCourseItem(
        {
          courseId: current.courseId,
          details: input.details === undefined ? current.details : input.details,
          estimatedMinutes:
            input.estimatedMinutes === undefined
              ? current.estimatedMinutes
              : input.estimatedMinutes,
          kind: input.kind ?? current.kind,
          progressBps: input.progressBps === undefined ? current.progressBps : input.progressBps,
          temporal: input.temporal ?? current.temporal,
          title: input.title ?? current.title,
        },
        { nextId: () => current.id },
        current.labels,
      );
      const labels =
        input.labelIds === undefined
          ? current.labels
          : await this.#replaceItemLabels(client, scope, current, input.labelIds);
      const value = { ...rebuilt, labels, state: current.state, version: current.version + 1 };
      const temporal = temporalColumns(value.temporal);
      await client.query(
        `update courseflow.course_items set details=$1,due_at=$2,ends_at=$3,estimate_source=$4,
         estimated_minutes=$5,kind=$6,local_date=$7,progress_bps=$8,starts_at=$9,temporal_note=$10,
         time_kind=$11,time_zone=$12,title=$13,version=$14,updated_at=now() where id=$15`,
        [
          value.details,
          temporal.dueAt,
          temporal.endsAt,
          value.estimateSource,
          value.estimatedMinutes,
          value.kind,
          temporal.localDate,
          value.progressBps,
          temporal.startsAt,
          temporal.note,
          temporal.timeKind,
          temporal.timeZone,
          value.title,
          value.version,
          value.id,
        ],
      );
      return { value, warnings: [] };
    });
  }

  async setCourseItemState(
    scope: UserScope,
    input: Readonly<{
      expectedVersion: number;
      itemId: CourseItem["id"];
      state: CourseItem["state"];
    }>,
  ): Promise<CommandResult<CourseItem>> {
    return this.#transaction(async (client) => {
      const current = await this.#loadItem(client, scope, input.itemId, true);
      if (current === null) throw notFound();
      if (current.version !== input.expectedVersion) throw versionConflict(current.version);
      const value = { ...current, state: input.state, version: current.version + 1 };
      await client.query(
        "update courseflow.course_items set state=$1,version=$2,updated_at=now() where id=$3",
        [value.state, value.version, value.id],
      );
      return { value, warnings: [] };
    });
  }

  async setCourseItemLabels(
    scope: UserScope,
    input: Readonly<{
      expectedVersion: number;
      itemId: CourseItem["id"];
      labelIds: readonly TaskLabelId[];
    }>,
  ): Promise<CommandResult<CourseItem>> {
    return this.#transaction(async (client) => {
      const current = await this.#loadItem(client, scope, input.itemId, true);
      if (current === null) throw notFound();
      if (current.version !== input.expectedVersion) throw versionConflict(current.version);
      const labels = await this.#replaceItemLabels(client, scope, current, input.labelIds);
      const value = { ...current, labels, version: current.version + 1 };
      await client.query(
        "update courseflow.course_items set version=$1,updated_at=now() where id=$2",
        [value.version, value.id],
      );
      return { value, warnings: [] };
    });
  }

  async deleteCourseItem(
    scope: UserScope,
    input: Readonly<{ expectedVersion: number; itemId: CourseItem["id"] }>,
  ): Promise<void> {
    await this.#transaction(async (client) => {
      const current = await this.#loadItem(client, scope, input.itemId, true);
      if (current === null) throw notFound();
      if (current.version !== input.expectedVersion) throw versionConflict(current.version);
      await client.query(
        "update courseflow.course_items set deleted_at=$1,version=version+1,updated_at=now() where id=$2",
        [this.#clock.now(), current.id],
      );
    });
  }

  async getCoursePlanning(
    scope: UserScope,
    courseId: CourseId,
  ): Promise<CoursePlanningDetail | null> {
    const client = await this.#pool.connect();
    try {
      const course = await this.#loadCourse(client, scope, courseId);
      if (course === null) return null;
      const itemRows = await client.query<ItemRow>(
        `select i.course_id,i.details,i.due_at,i.ends_at,i.estimate_source,i.estimated_minutes,
                  i.id,i.kind,i.local_date,i.progress_bps,i.starts_at,i.state,i.temporal_note,
                  i.time_kind,i.time_zone,i.title,i.version
           from courseflow.course_items i where i.course_id=$1 and i.deleted_at is null order by i.id`,
        [courseId],
      );
      const labelRows = await client.query<LabelRow>(
        `select color_key,display_name,id,normalized_name,term_id,version
           from courseflow.task_labels where term_id=$1 order by display_name,id`,
        [course.course.termId],
      );
      const items: CourseItem[] = [];
      for (const row of itemRows.rows) {
        items.push(mapItem(row, await this.#labelsForItem(client, asCourseItemId(row.id))));
      }
      return { courseId, items, labels: labelRows.rows.map(mapLabel) };
    } finally {
      client.release();
    }
  }

  async #loadScheme(
    client: PoolClient,
    scope: UserScope,
    courseId: CourseId,
    schemeId?: GradingScheme["id"],
    lock = false,
  ): Promise<GradingScheme | null> {
    const schemeResult = await client.query<SchemeRow>(
      `select s.condition_text,s.course_id,s.id,s.is_primary,s.name,s.version
       from courseflow.grading_schemes s
       join courseflow.courses c on c.id=s.course_id
       join courseflow.academic_terms t on t.id=c.term_id
       where s.course_id=$1 and ($3::uuid is null and s.is_primary=true or s.id=$3)
         and t.owner_user_id=$2${lock ? " for update of s" : ""}`,
      [courseId, scope.userId, schemeId ?? null],
    );
    const scheme = schemeResult.rows[0];
    if (scheme === undefined) return null;
    const componentRows = await client.query<ComponentRow>(
      `select grading_scheme_id,id,rule_text,sort_order,title,weight_bps
         from courseflow.grade_components where grading_scheme_id=$1 order by sort_order,id`,
      [scheme.id],
    );
    const resultRows = await client.query<ResultRow>(
      `select r.earned_milli::text,r.grade_component_id,r.id,r.note,r.possible_milli::text,r.version
         from courseflow.grade_results r join courseflow.grade_components c on c.id=r.grade_component_id
         where c.grading_scheme_id=$1`,
      [scheme.id],
    );
    const results = new Map(resultRows.rows.map((row) => [row.grade_component_id, mapResult(row)]));
    return {
      components: componentRows.rows.map((row): GradeComponent => ({
        id: asGradeComponentId(row.id),
        result: results.get(row.id) ?? null,
        ruleText: row.rule_text,
        sortOrder: row.sort_order,
        title: row.title,
        weightBps: row.weight_bps,
      })),
      conditionText: scheme.condition_text,
      courseId: asCourseId(scheme.course_id),
      id: asGradingSchemeId(scheme.id),
      isPrimary: scheme.is_primary,
      name: scheme.name,
      version: scheme.version,
    };
  }

  async saveGradingScheme(
    scope: UserScope,
    input: SaveGradingScheme,
  ): Promise<CommandResult<GradingScheme>> {
    return this.#transaction(async (client) => {
      const course = await this.#loadCourse(client, scope, input.courseId);
      if (course === null) throw notFound();
      const existing =
        input.schemeId === undefined
          ? null
          : await this.#loadScheme(client, scope, input.courseId, input.schemeId, true);
      if (input.schemeId !== undefined && existing === null) throw notFound();
      if (existing !== null && existing.version !== input.expectedVersion)
        throw versionConflict(existing.version);
      const existingIds = new Set(existing?.components.map((component) => component.id) ?? []);
      if (
        input.components.some(
          (component) => component.id !== undefined && !existingIds.has(component.id),
        )
      ) {
        throw notFound();
      }
      const previousResults = new Map(
        existing?.components.flatMap((component) =>
          component.result === null ? [] : [[component.id, component.result] as const],
        ) ?? [],
      );
      const result = buildGradingScheme(input, this.#ids, previousResults);
      const scheme = result.value;
      if (scheme.isPrimary) {
        await client.query(
          `update courseflow.grading_schemes set is_primary=false,version=version+1
           where course_id=$1 and is_primary=true and id<>$2`,
          [scheme.courseId, scheme.id],
        );
      }
      if (existing === null) {
        await client.query(
          `insert into courseflow.grading_schemes (condition_text,course_id,id,is_primary,name,version)
           values ($1,$2,$3,$4,$5,1)`,
          [scheme.conditionText, scheme.courseId, scheme.id, scheme.isPrimary, scheme.name],
        );
      } else {
        await client.query(
          `update courseflow.grading_schemes set condition_text=$1,is_primary=$2,name=$3,version=$4 where id=$5`,
          [scheme.conditionText, scheme.isPrimary, scheme.name, scheme.version, scheme.id],
        );
      }
      const retained = scheme.components.map((component) => component.id);
      await client.query(
        "delete from courseflow.grade_components where grading_scheme_id=$1 and not (id=any($2::uuid[]))",
        [scheme.id, retained],
      );
      for (const component of scheme.components) {
        await client.query(
          `insert into courseflow.grade_components (grading_scheme_id,id,rule_text,sort_order,title,weight_bps)
           values ($1,$2,$3,$4,$5,$6)
           on conflict (id) do update set rule_text=excluded.rule_text,sort_order=excluded.sort_order,
             title=excluded.title,weight_bps=excluded.weight_bps`,
          [
            scheme.id,
            component.id,
            component.ruleText,
            component.sortOrder,
            component.title,
            component.weightBps,
          ],
        );
      }
      return result;
    });
  }

  async saveGradeResult(
    scope: UserScope,
    input: SaveGradeResult,
  ): Promise<CommandResult<GradeResult>> {
    return this.#transaction(async (client) => {
      const component = await client.query<ComponentRow & ResultRow>(
        `select c.grading_scheme_id,c.id,c.rule_text,c.sort_order,c.title,c.weight_bps,
                r.earned_milli::text,r.grade_component_id,r.id as result_id,r.note,
                r.possible_milli::text,r.version as result_version
         from courseflow.grade_components c
         join courseflow.grading_schemes s on s.id=c.grading_scheme_id
         join courseflow.courses co on co.id=s.course_id
         join courseflow.academic_terms t on t.id=co.term_id
         left join courseflow.grade_results r on r.grade_component_id=c.id
         where c.id=$1 and t.owner_user_id=$2 for update of c`,
        [input.gradeComponentId, scope.userId],
      );
      const row = component.rows[0] as
        | (ComponentRow &
            QueryResultRow & {
              result_id: string | null;
              result_version: number | null;
              earned_milli: string | null;
              possible_milli: string | null;
              note: string | null;
            })
        | undefined;
      if (row === undefined) throw notFound();
      const existing: GradeResult | undefined =
        row.result_id === null
          ? undefined
          : {
              earnedMilli: BigInt(row.earned_milli!),
              gradeComponentId: input.gradeComponentId,
              id: asGradeResultId(row.result_id),
              note: row.note,
              possibleMilli: BigInt(row.possible_milli!),
              version: row.result_version!,
            };
      if (existing !== undefined && existing.version !== input.expectedVersion)
        throw versionConflict(existing.version);
      const result = buildGradeResult(input, this.#ids, existing?.id);
      const value = result.value;
      if (existing === undefined) {
        await client.query(
          `insert into courseflow.grade_results
            (earned_milli,grade_component_id,id,note,possible_milli,recorded_by_user_id,version)
           values ($1,$2,$3,$4,$5,$6,1)`,
          [
            value.earnedMilli.toString(),
            value.gradeComponentId,
            value.id,
            value.note,
            value.possibleMilli.toString(),
            scope.userId,
          ],
        );
      } else {
        await client.query(
          `update courseflow.grade_results set earned_milli=$1,note=$2,possible_milli=$3,
           updated_at=now(),version=$4 where id=$5`,
          [
            value.earnedMilli.toString(),
            value.note,
            value.possibleMilli.toString(),
            value.version,
            value.id,
          ],
        );
      }
      return result;
    });
  }

  async deleteGradeResult(
    scope: UserScope,
    input: Readonly<{ expectedVersion: number; gradeComponentId: GradeComponentId }>,
  ): Promise<void> {
    const result = await this.#pool.query<{ version: number }>(
      `delete from courseflow.grade_results r using courseflow.grade_components c,
       courseflow.grading_schemes s,courseflow.courses co,courseflow.academic_terms t
       where r.grade_component_id=$1 and r.grade_component_id=c.id and c.grading_scheme_id=s.id
         and s.course_id=co.id and co.term_id=t.id and t.owner_user_id=$2 and r.version=$3
       returning r.version`,
      [input.gradeComponentId, scope.userId, input.expectedVersion],
    );
    if (result.rowCount !== 1) {
      const visible = await this.#pool.query<{ version: number }>(
        `select r.version from courseflow.grade_results r join courseflow.grade_components c on c.id=r.grade_component_id
         join courseflow.grading_schemes s on s.id=c.grading_scheme_id join courseflow.courses co on co.id=s.course_id
         join courseflow.academic_terms t on t.id=co.term_id where r.grade_component_id=$1 and t.owner_user_id=$2`,
        [input.gradeComponentId, scope.userId],
      );
      if (visible.rows[0] === undefined) throw notFound();
      throw versionConflict(visible.rows[0].version);
    }
  }

  async saveLetterGradeScale(
    scope: UserScope,
    input: SaveLetterGradeScale,
  ): Promise<CommandResult<LetterGradeScale>> {
    return this.#transaction(async (client) => {
      let existing: LetterGradeScale | null = null;
      if (input.scaleId !== undefined) {
        existing = await this.#getLetterGradeScale(client, scope, input.scaleId, true);
        if (existing === null) throw notFound();
        if (existing.version !== input.expectedVersion) throw versionConflict(existing.version);
      }
      const value = buildLetterGradeScale(input, this.#ids);
      if (existing === null) {
        await client.query(
          "insert into courseflow.letter_grade_scales (id,name,owner_user_id,version) values ($1,$2,$3,1)",
          [value.id, value.name, scope.userId],
        );
      } else {
        await client.query(
          "update courseflow.letter_grade_scales set name=$1,version=$2,updated_at=now() where id=$3",
          [value.name, value.version, value.id],
        );
        await client.query("delete from courseflow.letter_grade_bands where scale_id=$1", [
          value.id,
        ]);
      }
      for (const band of value.bands) {
        await client.query(
          "insert into courseflow.letter_grade_bands (letter,minimum_percent_bps,scale_id) values ($1,$2,$3)",
          [band.letter, band.minimumPercentBps, value.id],
        );
      }
      return { value, warnings: [] };
    });
  }

  async #getLetterGradeScale(
    client: PoolClient,
    scope: UserScope,
    scaleId: LetterGradeScaleId,
    lock = false,
  ): Promise<LetterGradeScale | null> {
    const scaleResult = await client.query<ScaleRow>(
      `select id,name,version from courseflow.letter_grade_scales
       where id=$1 and owner_user_id=$2${lock ? " for update" : ""}`,
      [scaleId, scope.userId],
    );
    const scale = scaleResult.rows[0];
    if (scale === undefined) return null;
    const bands = await client.query<BandRow>(
      "select letter,minimum_percent_bps from courseflow.letter_grade_bands where scale_id=$1 order by minimum_percent_bps desc",
      [scaleId],
    );
    return {
      bands: bands.rows.map((row) => ({
        letter: row.letter,
        minimumPercentBps: row.minimum_percent_bps,
      })),
      id: asLetterGradeScaleId(scale.id),
      name: scale.name,
      version: scale.version,
    };
  }

  async getLetterGradeScale(
    scope: UserScope,
    scaleId: LetterGradeScaleId,
  ): Promise<LetterGradeScale | null> {
    const client = await this.#pool.connect();
    try {
      return await this.#getLetterGradeScale(client, scope, scaleId);
    } finally {
      client.release();
    }
  }

  async listLetterGradeScales(scope: UserScope): Promise<readonly LetterGradeScale[]> {
    const ids = await this.#pool.query<{ id: string }>(
      "select id from courseflow.letter_grade_scales where owner_user_id=$1 order by name,id",
      [scope.userId],
    );
    const scales = await Promise.all(
      ids.rows.map((row) => this.getLetterGradeScale(scope, asLetterGradeScaleId(row.id))),
    );
    return scales.filter((scale): scale is LetterGradeScale => scale !== null);
  }

  async listGradingSchemes(
    scope: UserScope,
    courseId: CourseId,
  ): Promise<readonly GradingScheme[]> {
    const visible = await this.getCourse(scope, courseId);
    if (visible === null) return [];
    const ids = await this.#pool.query<{ id: string }>(
      "select id from courseflow.grading_schemes where course_id=$1 order by is_primary desc,name,id",
      [courseId],
    );
    const client = await this.#pool.connect();
    try {
      const schemes: Array<GradingScheme | null> = [];
      for (const row of ids.rows) {
        schemes.push(await this.#loadScheme(client, scope, courseId, asGradingSchemeId(row.id)));
      }
      return schemes.filter((scheme): scheme is GradingScheme => scheme !== null);
    } finally {
      client.release();
    }
  }

  async getGradebook(
    scope: UserScope,
    courseId: CourseId,
    schemeId?: GradingScheme["id"],
  ): Promise<GradebookSnapshot | null> {
    const client = await this.#pool.connect();
    try {
      const course = await this.#loadCourse(client, scope, courseId);
      if (course === null) return null;
      const scheme = await this.#loadScheme(client, scope, courseId, schemeId);
      const scale =
        course.course.letterGradeScaleId === null
          ? null
          : await this.#getLetterGradeScale(client, scope, course.course.letterGradeScaleId);
      if (schemeId !== undefined && scheme === null) return null;
      return projectGradebook(courseId, scheme, scale);
    } finally {
      client.release();
    }
  }
}

export function createPostgresCourseFlowRepository(
  input: Readonly<{
    clock: Clock;
    databaseUrl: string;
    ids: IdGenerator;
  }>,
): PostgresCourseFlowRepository {
  return new PostgresCourseFlowRepository({
    clock: input.clock,
    ids: input.ids,
    pool: new Pool({ connectionString: input.databaseUrl, connectionTimeoutMillis: 5_000, max: 8 }),
  });
}
