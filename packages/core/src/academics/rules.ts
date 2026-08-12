import {
  addLocalDateDays,
  asCalendarExceptionId,
  asCourseId,
  asMeetingExceptionId,
  asMeetingPatternId,
  asTermId,
  compareLocalDates,
  compareLocalTimes,
  ianaTimeZone,
  localDate,
  localDateWeekday,
  localTime,
  resolveLocalDateTime,
  validationError,
  versionConflict,
  type CommandResult,
  type DomainWarning,
} from "../shared";
import type { IdGenerator } from "../runtime";
import type {
  AcademicCalendarException,
  AcademicTerm,
  Course,
  CourseColorKey,
  CourseSetupView,
  CreateCourseWithSchedule,
  CreateTerm,
  MeetingPattern,
  MeetingException,
  MeetingOccurrence,
  SaveMeetingException,
  SetTermArchived,
  UpdateTerm,
} from "./types";

function trimmed(value: string, path: string, max: number): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > max) {
    throw validationError("请检查必填文本。", [
      { code: "INVALID_TEXT_LENGTH", message: `长度必须为 1–${max} 个字符。`, path },
    ]);
  }
  return normalized;
}

function optionalText(value: string | null | undefined, max: number, path: string): string | null {
  if (value === undefined || value === null || value.trim() === "") return null;
  return trimmed(value, path, max);
}

function creditValueMilli(value: string | null | undefined): number | null {
  if (value === undefined || value === null || value.trim() === "") return null;
  if (!/^\d+(?:\.\d{1,3})?$/u.test(value.trim())) {
    throw validationError("学分必须是非负且最多三位小数。", [
      {
        code: "INVALID_CREDIT_VALUE",
        message: "学分必须是非负且最多三位小数。",
        path: "/creditValue",
      },
    ]);
  }
  const milli = Math.round(Number(value) * 1_000);
  if (!Number.isSafeInteger(milli)) {
    throw validationError("学分数值过大。", [
      { code: "INVALID_CREDIT_VALUE", message: "学分数值过大。", path: "/creditValue" },
    ]);
  }
  return milli;
}

export function buildTerm(
  input: CreateTerm,
  ids: IdGenerator,
): Readonly<{ exceptions: readonly AcademicCalendarException[]; term: AcademicTerm }> {
  const startDate = localDate(input.startDate, "/startDate");
  const endDate = localDate(input.endDate, "/endDate");
  if (compareLocalDates(startDate, endDate) > 0) {
    throw validationError("学期结束日期不得早于开始日期。", [
      { code: "INVALID_DATE_RANGE", message: "结束日期不得早于开始日期。", path: "/endDate" },
    ]);
  }
  const termId = asTermId(ids.nextId());
  const exceptions = (input.readingWeeks ?? []).map((candidate, index) => {
    const exceptionStart = localDate(candidate.startDate, `/readingWeeks/${index}/startDate`);
    const exceptionEnd = localDate(candidate.endDate, `/readingWeeks/${index}/endDate`);
    if (
      compareLocalDates(exceptionStart, exceptionEnd) > 0 ||
      compareLocalDates(exceptionStart, startDate) < 0 ||
      compareLocalDates(exceptionEnd, endDate) > 0
    ) {
      throw validationError("Reading Week 必须位于学期范围内。", [
        {
          code: "INVALID_CALENDAR_EXCEPTION_RANGE",
          message: "Reading Week 必须位于学期范围内。",
          path: `/readingWeeks/${index}`,
        },
      ]);
    }
    return {
      endDate: exceptionEnd,
      id: asCalendarExceptionId(ids.nextId()),
      kind: "reading_week" as const,
      name: trimmed(candidate.name, `/readingWeeks/${index}/name`, 120),
      startDate: exceptionStart,
      suppressesMeetings: true,
      termId,
      version: 1,
    };
  });
  return {
    exceptions,
    term: {
      archivedAt: null,
      endDate,
      id: termId,
      name: trimmed(input.name, "/name", 80),
      startDate,
      timeZone: ianaTimeZone(input.timeZone),
      version: 1,
      weekNumberingPolicy: "teaching_weeks_v1",
    },
  };
}

export function buildUpdatedTerm(current: AcademicTerm, input: UpdateTerm): AcademicTerm {
  if (current.version !== input.expectedVersion) throw versionConflict(current.version);
  const startDate =
    input.startDate === undefined ? current.startDate : localDate(input.startDate, "/startDate");
  const endDate =
    input.endDate === undefined ? current.endDate : localDate(input.endDate, "/endDate");
  if (compareLocalDates(startDate, endDate) > 0) {
    throw validationError("学期结束日期不得早于开始日期。", [
      { code: "INVALID_DATE_RANGE", message: "结束日期不得早于开始日期。", path: "/endDate" },
    ]);
  }
  return {
    ...current,
    endDate,
    name: input.name === undefined ? current.name : trimmed(input.name, "/name", 80),
    startDate,
    timeZone: input.timeZone === undefined ? current.timeZone : ianaTimeZone(input.timeZone),
    version: current.version + 1,
  };
}

export function buildTermArchived(
  current: AcademicTerm,
  input: SetTermArchived,
  archivedAt: Date,
): AcademicTerm {
  if (current.version !== input.expectedVersion) throw versionConflict(current.version);
  return {
    ...current,
    archivedAt: input.archived ? archivedAt.toISOString() : null,
    version: current.version + 1,
  };
}

export function buildCourseSetup(
  term: AcademicTerm,
  calendarExceptions: readonly AcademicCalendarException[],
  input: CreateCourseWithSchedule,
  ids: IdGenerator,
): CommandResult<CourseSetupView> {
  if (term.archivedAt !== null) {
    throw validationError("归档学期不能添加课程。", [
      {
        code: "TERM_ARCHIVED",
        message: "请恢复该学期，或选择一个进行中的学期。",
        path: "/termId",
      },
    ]);
  }
  const timeZone = ianaTimeZone(input.timeZone ?? term.timeZone, "/timeZone");
  const warnings: DomainWarning[] = [];
  const course: Course = {
    archivedAt: null,
    code: trimmed(input.code, "/code", 32),
    colorKey: input.colorKey as CourseColorKey,
    creditValueMilli: creditValueMilli(input.creditValue),
    id: asCourseId(ids.nextId()),
    instructorName: optionalText(input.instructorName, 160, "/instructorName"),
    letterGradeScaleId: input.letterGradeScaleId ?? null,
    section: optionalText(input.section, 80, "/section"),
    termId: term.id,
    timeZone,
    title: trimmed(input.title, "/title", 160),
    version: 1,
  };
  const meetingPatterns: MeetingPattern[] = input.meetingPatterns.map((candidate, index) => {
    const startTime = localTime(
      candidate.localStartTime,
      `/meetingPatterns/${index}/localStartTime`,
    );
    const endTime = localTime(candidate.localEndTime, `/meetingPatterns/${index}/localEndTime`);
    if (compareLocalTimes(startTime, endTime) >= 0) {
      throw validationError("课节结束时间必须晚于开始时间。", [
        {
          code: "INVALID_MEETING_TIME_RANGE",
          message: "结束时间必须晚于开始时间；首版不支持跨午夜课节。",
          path: `/meetingPatterns/${index}/localEndTime`,
        },
      ]);
    }
    const weekdays = [...new Set(candidate.weekdays)].sort((left, right) => left - right);
    if (
      weekdays.length === 0 ||
      weekdays.some((weekday) => !Number.isInteger(weekday) || weekday < 0 || weekday > 6)
    ) {
      throw validationError("课节至少选择一个有效星期。", [
        {
          code: "INVALID_MEETING_WEEKDAYS",
          message: "星期使用 0=周一到 6=周日，且至少选择一个。",
          path: `/meetingPatterns/${index}/weekdays`,
        },
      ]);
    }
    const effectiveStart = candidate.effectiveStartDate
      ? localDate(candidate.effectiveStartDate, `/meetingPatterns/${index}/effectiveStartDate`)
      : null;
    const effectiveEnd = candidate.effectiveEndDate
      ? localDate(candidate.effectiveEndDate, `/meetingPatterns/${index}/effectiveEndDate`)
      : null;
    const actualStart = effectiveStart ?? term.startDate;
    const actualEnd = effectiveEnd ?? term.endDate;
    if (
      compareLocalDates(actualStart, actualEnd) > 0 ||
      compareLocalDates(actualEnd, term.startDate) < 0 ||
      compareLocalDates(actualStart, term.endDate) > 0
    ) {
      throw validationError("课节有效范围必须与学期相交。", [
        {
          code: "INVALID_MEETING_DATE_RANGE",
          message: "课节有效范围必须与学期相交。",
          path: `/meetingPatterns/${index}`,
        },
      ]);
    }
    for (
      let date = actualStart;
      compareLocalDates(date, actualEnd) <= 0;
      date = addLocalDateDays(date, 1)
    ) {
      if (!weekdays.includes(localDateWeekday(date))) continue;
      const startResolution = resolveLocalDateTime(date, startTime, timeZone);
      const endResolution = resolveLocalDateTime(date, endTime, timeZone);
      if (startResolution.kind !== "exact" || endResolution.kind !== "exact") {
        throw validationError("课节在 DST 切换处存在不存在或重复的本地时刻。", [
          {
            code:
              startResolution.kind === "gap" || endResolution.kind === "gap"
                ? "DST_GAP"
                : "DST_OVERLAP",
            message: "请调整课节墙上时间，或之后为该日期建立明确单次覆盖。",
            path: `/meetingPatterns/${index}`,
          },
        ]);
      }
    }
    return {
      archivedAt: null,
      courseId: course.id,
      effectiveEndDate: effectiveEnd,
      effectiveStartDate: effectiveStart,
      id: asMeetingPatternId(ids.nextId()),
      kind: candidate.kind,
      localEndTime: endTime,
      localStartTime: startTime,
      locationText: optionalText(
        candidate.locationText,
        200,
        `/meetingPatterns/${index}/locationText`,
      ),
      section: optionalText(candidate.section, 80, `/meetingPatterns/${index}/section`),
      title: optionalText(candidate.title, 120, `/meetingPatterns/${index}/title`),
      version: 1,
      weekdays,
    };
  });
  const overlapKeys = new Map<string, number>();
  meetingPatterns.forEach((pattern, index) => {
    for (const weekday of pattern.weekdays) {
      const key = `${weekday}:${pattern.localStartTime}:${pattern.localEndTime}`;
      const first = overlapKeys.get(key);
      if (first !== undefined) {
        warnings.push({
          code: "MEETING_OVERLAP",
          message: `课节 ${first + 1} 与课节 ${index + 1} 时间相同，请核对。`,
          path: `/meetingPatterns/${index}`,
        });
      } else {
        overlapKeys.set(key, index);
      }
    }
  });
  return { value: { calendarExceptions, course, meetingPatterns, term }, warnings };
}

export function buildMeetingException(
  setup: CourseSetupView,
  pattern: MeetingPattern,
  input: SaveMeetingException,
  ids: IdGenerator,
  existing?: MeetingException,
): MeetingException {
  if (existing !== undefined && existing.version !== input.expectedVersion) {
    throw versionConflict(existing.version);
  }
  const occurrenceDate = localDate(input.occurrenceDate, "/occurrenceDate");
  const patternStart = pattern.effectiveStartDate ?? setup.term.startDate;
  const patternEnd = pattern.effectiveEndDate ?? setup.term.endDate;
  const isPatternDate =
    compareLocalDates(occurrenceDate, patternStart) >= 0 &&
    compareLocalDates(occurrenceDate, patternEnd) <= 0 &&
    pattern.weekdays.includes(localDateWeekday(occurrenceDate));
  if (!isPatternDate) {
    throw validationError("单次例外必须指向周期课节原本会发生的日期。", [
      {
        code: "INVALID_MEETING_EXCEPTION_DATE",
        message: "请选择该课节星期与有效范围内的原计划日期。",
        path: "/occurrenceDate",
      },
    ]);
  }

  let replacementDate = null;
  let replacementStartTime = null;
  let replacementEndTime = null;
  let replacementTimeZone = null;
  if (input.action === "rescheduled") {
    if (!input.replacementDate || !input.replacementStartTime || !input.replacementEndTime) {
      throw validationError("改期必须提供替代日期与完整起止时间。", [
        {
          code: "MEETING_REPLACEMENT_REQUIRED",
          message: "请输入替代日期、开始时间和结束时间。",
          path: "/replacementDate",
        },
      ]);
    }
    replacementDate = localDate(input.replacementDate, "/replacementDate");
    replacementStartTime = localTime(input.replacementStartTime, "/replacementStartTime");
    replacementEndTime = localTime(input.replacementEndTime, "/replacementEndTime");
    if (compareLocalTimes(replacementStartTime, replacementEndTime) >= 0) {
      throw validationError("改期结束时间必须晚于开始时间。", [
        {
          code: "INVALID_MEETING_TIME_RANGE",
          message: "结束时间必须晚于开始时间；首版不支持跨午夜课节。",
          path: "/replacementEndTime",
        },
      ]);
    }
    replacementTimeZone = input.replacementTimeZone
      ? ianaTimeZone(input.replacementTimeZone, "/replacementTimeZone")
      : null;
    const zone = replacementTimeZone ?? setup.course.timeZone;
    const startResolution = resolveLocalDateTime(replacementDate, replacementStartTime, zone);
    const endResolution = resolveLocalDateTime(replacementDate, replacementEndTime, zone);
    if (startResolution.kind !== "exact" || endResolution.kind !== "exact") {
      throw validationError("改期落在 DST 不存在或重复的本地时刻。", [
        {
          code:
            startResolution.kind === "gap" || endResolution.kind === "gap"
              ? "DST_GAP"
              : "DST_OVERLAP",
          message: "请选择无歧义的替代时间。",
          path: "/replacementStartTime",
        },
      ]);
    }
  }

  return {
    action: input.action,
    id: existing?.id ?? asMeetingExceptionId(ids.nextId()),
    meetingPatternId: input.meetingPatternId,
    note: optionalText(input.note, 2_000, "/note"),
    occurrenceDate,
    replacementDate,
    replacementEndTime,
    replacementLocationText:
      input.action === "rescheduled"
        ? optionalText(input.replacementLocationText, 200, "/replacementLocationText")
        : null,
    replacementStartTime,
    replacementTimeZone,
    version: existing === undefined ? 1 : existing.version + 1,
  };
}

export function expandMeetingOccurrences(
  setup: CourseSetupView,
  from: string,
  to: string,
  meetingExceptions: readonly MeetingException[] = setup.meetingExceptions ?? [],
): readonly MeetingOccurrence[] {
  const rangeStart = localDate(from, "/from");
  const rangeEnd = localDate(to, "/to");
  if (compareLocalDates(rangeStart, rangeEnd) > 0) {
    throw validationError("课节预览结束日期不得早于开始日期。", [
      { code: "INVALID_DATE_RANGE", message: "结束日期不得早于开始日期。", path: "/to" },
    ]);
  }
  const days = Math.round(
    (Date.parse(`${rangeEnd}T00:00:00Z`) - Date.parse(`${rangeStart}T00:00:00Z`)) / 86_400_000,
  );
  if (days > 370) {
    throw validationError("课节预览范围过大。", [
      { code: "DATE_RANGE_TOO_LARGE", message: "一次最多预览 371 天。", path: "/to" },
    ]);
  }
  const exceptionByOccurrence = new Map(
    meetingExceptions.map((exception) => [
      `${exception.meetingPatternId}:${exception.occurrenceDate}`,
      exception,
    ]),
  );
  const occurrences: MeetingOccurrence[] = [];
  for (const pattern of setup.meetingPatterns) {
    if (pattern.archivedAt !== null) continue;
    const effectiveStart = pattern.effectiveStartDate ?? setup.term.startDate;
    const effectiveEnd = pattern.effectiveEndDate ?? setup.term.endDate;
    const first = compareLocalDates(rangeStart, effectiveStart) > 0 ? rangeStart : effectiveStart;
    const last = compareLocalDates(rangeEnd, effectiveEnd) < 0 ? rangeEnd : effectiveEnd;
    for (let date = first; compareLocalDates(date, last) <= 0; date = addLocalDateDays(date, 1)) {
      if (!pattern.weekdays.includes(localDateWeekday(date))) continue;
      const exception = exceptionByOccurrence.get(`${pattern.id}:${date}`);
      if (exception?.action === "cancelled") continue;
      const suppressed = setup.calendarExceptions.some(
        (calendarException) =>
          calendarException.suppressesMeetings &&
          compareLocalDates(calendarException.startDate, date) <= 0 &&
          compareLocalDates(calendarException.endDate, date) >= 0,
      );
      if (suppressed && exception?.action !== "kept" && exception?.action !== "rescheduled")
        continue;

      const actualDate = exception?.action === "rescheduled" ? exception.replacementDate! : date;
      const actualStart =
        exception?.action === "rescheduled"
          ? exception.replacementStartTime!
          : pattern.localStartTime;
      const actualEnd =
        exception?.action === "rescheduled" ? exception.replacementEndTime! : pattern.localEndTime;
      const actualZone =
        exception?.action === "rescheduled" && exception.replacementTimeZone !== null
          ? exception.replacementTimeZone
          : setup.course.timeZone;
      const startResolution = resolveLocalDateTime(actualDate, actualStart, actualZone);
      const endResolution = resolveLocalDateTime(actualDate, actualEnd, actualZone);
      if (startResolution.kind !== "exact" || endResolution.kind !== "exact") {
        throw validationError("课节实例落在 DST 不存在或重复时刻。", [
          {
            code:
              startResolution.kind === "gap" || endResolution.kind === "gap"
                ? "DST_GAP"
                : "DST_OVERLAP",
            message: "请为该原计划日期建立明确、无歧义的单次改期。",
            path: `/meetingPatterns/${pattern.id}/${date}`,
          },
        ]);
      }
      occurrences.push({
        courseId: setup.course.id,
        endsAt: endResolution.instant,
        kind: pattern.kind,
        locationText:
          exception?.action === "rescheduled" && exception.replacementLocationText !== null
            ? exception.replacementLocationText
            : pattern.locationText,
        occurrenceKey: `${pattern.id}:${date}`,
        originalDate: date,
        patternId: pattern.id,
        startsAt: startResolution.instant,
        status:
          exception?.action === "rescheduled"
            ? "rescheduled"
            : exception?.action === "kept"
              ? "kept"
              : "scheduled",
        timeZone: actualZone,
      });
    }
  }
  return [...occurrences].sort(
    (left, right) =>
      left.startsAt.localeCompare(right.startsAt) ||
      left.occurrenceKey.localeCompare(right.occurrenceKey),
  );
}
