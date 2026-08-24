/**
 * @file Defines unified PLAN evaluation context and derived occurrence classifications.
 */

import { findMeetingTimeOverlap, INTL_ZONE_RULES } from './meeting-time';
import {
    isMeetingOccurrenceProjection,
    isMeetingOccurrenceWindow,
    MAX_MEETING_OVERLAP_WARNINGS,
    type MeetingOccurrenceProjection,
    type MeetingOccurrenceWindow,
} from './workspace-course-contract';
import {
    isCanonicalUnsignedSqliteInteger,
    isCanonicalUuid,
} from './workspace-data-contract';
import {
    isHolidayRangeProjection,
    type HolidayRangeProjection,
} from './workspace-holiday-contract';
import {
    isTaskOccurrenceProjection,
    type TaskOccurrenceProjection,
    type TaskSize,
} from './workspace-task-contract';
import {
    isCanonicalLocalDate,
    localDateInTermZone,
    type TermProjection,
} from './workspace-term-contract';

export type PlanEvaluationContext = Readonly<{
    evaluatedAt: string;
    termZone: string;
    applicableDate: string;
    requestedWindow: MeetingOccurrenceWindow;
}>;

export type TaskTimeClassification =
    | 'overdue'
    | 'today'
    | 'near-due'
    | 'future'
    | 'completed'
    | 'skipped'
    | 'TBA';

export type MeetingTimeClassification =
    | 'upcoming'
    | 'in-progress'
    | 'ended'
    | 'cancelled'
    | 'holiday-suppressed';

export type TermProgressProjection = Readonly<{
    elapsedDays: number;
    totalDays: number;
    ratio: number;
}>;

export type NextTaskProjection =
    | Readonly<{
        kind: 'task';
        occurrence: TaskOccurrenceProjection;
        deadlineBoundary: string;
        remainingMilliseconds: number;
    }>
    | Readonly<{
        kind: 'empty';
        reason: 'no-pending-known-deadline';
    }>;

export type PlanTaskSource = Readonly<{
    courseId: string;
    courseCode: string;
    occurrence: TaskOccurrenceProjection;
}>;

export type PlanMeetingSource = Readonly<{
    courseId: string;
    courseCode: string;
    occurrence: MeetingOccurrenceProjection;
}>;

export type PlanTaskProjection = PlanTaskSource & Readonly<{
    kind: 'task';
    typeLabel: 'Task';
    classification: TaskTimeClassification;
}>;

export type PlanMeetingProjection = PlanMeetingSource & Readonly<{
    kind: 'meeting';
    typeLabel: 'Lecture' | 'Tutorial' | 'Practical';
    classification: MeetingTimeClassification;
}>;

export type CalendarHolidaySegmentProjection = Readonly<{
    kind: 'holiday-range';
    typeLabel: 'Holiday';
    holidayRange: HolidayRangeProjection;
    visibleStartDate: string;
    visibleEndDate: string;
}>;

export type CalendarWindowProjection = Readonly<{
    window: MeetingOccurrenceWindow;
    timedItems: readonly (PlanMeetingProjection | PlanTaskProjection)[];
    allDayItems: readonly PlanTaskProjection[];
    holidaySegments: readonly CalendarHolidaySegmentProjection[];
}>;

export type AgendaHolidayRangeProjection = Readonly<{
    kind: 'holiday-range';
    typeLabel: 'Holiday';
    holidayRange: HolidayRangeProjection;
}>;

export type AgendaItemProjection =
    | PlanMeetingProjection
    | PlanTaskProjection
    | AgendaHolidayRangeProjection;

export type AgendaConflictWarning = Readonly<{
    code: 'meeting-time-overlap';
    first: PlanMeetingProjection;
    second: PlanMeetingProjection;
    overlap: Readonly<{
        startInstant: string;
        endInstant: string;
    }>;
}>;

export type AgendaProjection = Readonly<{
    items: readonly AgendaItemProjection[];
    warnings: readonly AgendaConflictWarning[];
}>;

export type TbaProjection = Readonly<{
    tasks: readonly PlanTaskProjection[];
}>;

export type TodaySummaryProjection = Readonly<{
    completed: number;
    pending: number;
    contributions: Readonly<{
        tasks: Readonly<{ completed: number; pending: number }>;
        meetings: Readonly<{ completed: number; pending: number }>;
    }>;
    excluded: Readonly<{
        skippedTasks: number;
        priorOverdueTasks: number;
        tbaTasks: number;
        cancelledMeetings: number;
        holidaySuppressedMeetings: number;
        missedMeetings: number;
        unmarkedMeetings: number;
    }>;
}>;

export type PlanAttendanceAvailability = 'disabled' | 'unavailable';

export type PlanAttendanceProjection = Readonly<{
    availability: PlanAttendanceAvailability;
    todayMeetingCountBasis: 'meeting-end-state';
}>;

export type PlanNextTaskProjection =
    | Readonly<{
        kind: 'task';
        task: PlanTaskProjection;
        deadlineBoundary: string;
        remainingMilliseconds: number;
    }>
    | Readonly<{
        kind: 'empty';
        reason: 'no-pending-known-deadline';
    }>;

export type PlanProjectionSource = Readonly<{
    workspaceRevision: string;
    planEntityVersion: string;
    term: TermProjection;
    taskSources: readonly PlanTaskSource[];
    meetingSources: readonly PlanMeetingSource[];
    holidayRanges: readonly HolidayRangeProjection[];
}>;

export type PlanProjection = Readonly<{
    workspaceRevision: string;
    planEntityVersion: string;
    evaluationContext: PlanEvaluationContext;
    attendance: PlanAttendanceProjection;
    term: TermProjection;
    tasks: readonly PlanTaskProjection[];
    meetings: readonly PlanMeetingProjection[];
    today: Readonly<{
        tasks: readonly PlanTaskProjection[];
        meetings: readonly PlanMeetingProjection[];
        summary: TodaySummaryProjection;
    }>;
    week: Readonly<{
        window: MeetingOccurrenceWindow;
        tasks: readonly PlanTaskProjection[];
        meetings: readonly PlanMeetingProjection[];
        holidayRanges: readonly HolidayRangeProjection[];
    }>;
    calendar: CalendarWindowProjection;
    agenda: AgendaProjection;
    tba: TbaProjection;
    next: Readonly<{
        small: PlanNextTaskProjection;
        large: PlanNextTaskProjection;
    }>;
    termProgress: TermProgressProjection;
}>;

const MILLISECONDS_PER_DAY = 86_400_000;
const MINIMUM_LOCAL_DATE_COORDINATE = Date.parse('0001-01-01T00:00:00.000Z');
const MAXIMUM_LOCAL_DATE_COORDINATE = Date.parse('9999-12-31T00:00:00.000Z');
const MAXIMUM_CANONICAL_INSTANT = '9999-12-31T23:59:59.999Z';

/**
 * Adds calendar days without consulting the system time zone.
 * @param {string} value - Canonical LocalDate.
 * @param {number} days - Whole calendar-day offset.
 * @return {string} Shifted canonical LocalDate.
 */
function addLocalDateDays(value: string, days: number): string {
    const shifted = Date.parse(`${value}T00:00:00.000Z`) + days * MILLISECONDS_PER_DAY;
    return new Date(Math.min(
        Math.max(shifted, MINIMUM_LOCAL_DATE_COORDINATE),
        MAXIMUM_LOCAL_DATE_COORDINATE,
    ))
        .toISOString()
        .slice(0, 10);
}

/**
 * Creates the one PLAN evaluation context shared by all composite projections.
 * @param {string} evaluatedAt - Workspace-owned canonical Clock Instant.
 * @param {string} termZone - Current Term IANA time-zone identity.
 * @param {MeetingOccurrenceWindow=} requestedWindow - Optional Calendar/Agenda query window.
 * @return {PlanEvaluationContext} Frozen Today and Monday-through-Sunday window facts.
 */
export function createPlanEvaluationContext(
    evaluatedAt: string,
    termZone: string,
    requestedWindow?: MeetingOccurrenceWindow,
): PlanEvaluationContext {
    const applicableDate = localDateInTermZone(evaluatedAt, termZone);
    const weekday = new Date(`${applicableDate}T00:00:00.000Z`).getUTCDay();
    const weekStart = addLocalDateDays(applicableDate, -((weekday + 6) % 7));
    if (requestedWindow !== undefined && !isMeetingOccurrenceWindow(requestedWindow)) {
        throw new TypeError('PLAN requested window must be a canonical LocalDate range');
    }
    const contextWindow = requestedWindow === undefined
        ? Object.freeze({
            startDate: weekStart,
            endDate: addLocalDateDays(weekStart, 6),
        })
        : Object.freeze({ ...requestedWindow });
    return Object.freeze({
        evaluatedAt,
        termZone,
        applicableDate,
        requestedWindow: contextWindow,
    });
}

/**
 * Resolves the sortable deadline boundary required by next-Task selection.
 * @param {TaskOccurrenceProjection} occurrence - Candidate Task occurrence.
 * @param {PlanEvaluationContext} context - Shared TermZone evaluation context.
 * @return {string | null} Timed Instant, date-only day-end boundary, or null for TBA.
 */
function taskDeadlineBoundary(
    occurrence: TaskOccurrenceProjection,
    context: PlanEvaluationContext,
): string | null {
    if (occurrence.deadline.kind === 'timed') {
        return occurrence.deadline.instant;
    }
    if (occurrence.deadline.kind === 'tba') {
        return null;
    }
    if (occurrence.deadline.date === '9999-12-31') {
        return MAXIMUM_CANONICAL_INSTANT;
    }
    return INTL_ZONE_RULES.resolveInstant(
        context.termZone,
        addLocalDateDays(occurrence.deadline.date, 1),
        '00:00',
    );
}

/**
 * Produces a deterministic identity key for equal Task deadline boundaries.
 * @param {TaskOccurrenceProjection} occurrence - Candidate Task occurrence.
 * @return {string} Stable series-and-anchor ordering key.
 */
function taskOccurrenceIdentityKey(occurrence: TaskOccurrenceProjection): string {
    return `${occurrence.occurrenceId.taskSeriesId}\u0000${occurrence.occurrenceId.originalLogicalAnchor}`;
}

/**
 * Produces a deterministic identity key for one Meeting occurrence.
 * @param {MeetingOccurrenceProjection} occurrence - Candidate Meeting occurrence.
 * @return {string} Stable series-and-anchor ordering key.
 */
function meetingOccurrenceIdentityKey(occurrence: MeetingOccurrenceProjection): string {
    return `${occurrence.occurrenceId.meetingSeriesId}\u0000${occurrence.occurrenceId.originalLogicalAnchor}`;
}

/**
 * Compares canonical ASCII identities and time values without host-locale collation.
 * @param {string} first - First canonical text value.
 * @param {string} second - Second canonical text value.
 * @return {number} Stable ascending comparison result.
 */
function compareCanonicalText(first: string, second: string): number {
    return first < second ? -1 : first > second ? 1 : 0;
}

/**
 * Projects one Task deadline into the shared TermZone LocalDate.
 * @param {TaskOccurrenceProjection} occurrence - Task occurrence under evaluation.
 * @param {PlanEvaluationContext} context - Shared TermZone evaluation context.
 * @return {string | null} Projected LocalDate or null for TBA.
 */
function taskDeadlineDate(
    occurrence: TaskOccurrenceProjection,
    context: PlanEvaluationContext,
): string | null {
    if (occurrence.deadline.kind === 'date-only') {
        return occurrence.deadline.date;
    }
    if (occurrence.deadline.kind === 'timed') {
        return localDateInTermZone(occurrence.deadline.instant, context.termZone);
    }
    return null;
}

/**
 * Maps one Meeting type code to its required textual label.
 * @param {MeetingOccurrenceProjection['type']} type - Canonical Meeting type code.
 * @return {PlanMeetingProjection['typeLabel']} User-readable type label.
 */
function meetingTypeLabel(
    type: MeetingOccurrenceProjection['type'],
): PlanMeetingProjection['typeLabel'] {
    switch (type) {
        case 'LEC':
            return 'Lecture';
        case 'TUT':
            return 'Tutorial';
        case 'PRA':
            return 'Practical';
    }
}

/**
 * Classifies one Meeting occurrence through exact half-open Instant boundaries.
 * @param {MeetingOccurrenceProjection} occurrence - Derived Meeting occurrence.
 * @param {string} evaluatedAt - Workspace-owned evaluation Instant.
 * @return {MeetingTimeClassification} PLAN-owned Meeting time classification.
 */
export function classifyMeetingOccurrence(
    occurrence: MeetingOccurrenceProjection,
    evaluatedAt: string,
): MeetingTimeClassification {
    if (occurrence.status !== 'scheduled') {
        return occurrence.status;
    }
    if (evaluatedAt < occurrence.startInstant) {
        return 'upcoming';
    }
    if (evaluatedAt < occurrence.endInstant) {
        return 'in-progress';
    }
    return 'ended';
}

/**
 * Calculates inclusive calendar-date progress for one Term.
 * @param {TermProjection} term - Term date facts.
 * @param {string} applicableDate - Current LocalDate in the TermZone.
 * @return {TermProgressProjection} Clamped inclusive elapsed and total days.
 */
export function calculateTermProgress(
    term: TermProjection,
    applicableDate: string,
): TermProgressProjection {
    const start = Date.parse(`${term.startDate}T00:00:00.000Z`);
    const end = Date.parse(`${term.endDate}T00:00:00.000Z`);
    const current = Date.parse(`${applicableDate}T00:00:00.000Z`);
    const totalDays = Math.floor((end - start) / MILLISECONDS_PER_DAY) + 1;
    const currentElapsedDays = Math.floor((current - start) / MILLISECONDS_PER_DAY) + 1;
    const elapsedDays = Math.min(totalDays, Math.max(0, currentElapsedDays));
    return Object.freeze({
        elapsedDays,
        totalDays,
        ratio: elapsedDays / totalDays,
    });
}

/**
 * Classifies one Task occurrence through the shared TermZone evaluation context.
 * @param {TaskOccurrenceProjection} occurrence - Derived occurrence and stored state.
 * @param {PlanEvaluationContext} context - Workspace-owned evaluation context.
 * @return {TaskTimeClassification} PLAN-owned textual time classification.
 */
export function classifyTaskOccurrence(
    occurrence: TaskOccurrenceProjection,
    context: PlanEvaluationContext,
): TaskTimeClassification {
    if (occurrence.status === 'completed') {
        return 'completed';
    }
    if (occurrence.status === 'skipped') {
        return 'skipped';
    }
    if (occurrence.deadline.kind === 'tba') {
        return 'TBA';
    }

    const deadlineDate = occurrence.deadline.kind === 'date-only'
        ? occurrence.deadline.date
        : localDateInTermZone(occurrence.deadline.instant, context.termZone);
    const isTimedOverdue = occurrence.deadline.kind === 'timed'
        && context.evaluatedAt > occurrence.deadline.instant;
    if (deadlineDate < context.applicableDate || isTimedOverdue) {
        return 'overdue';
    }
    if (deadlineDate === context.applicableDate) {
        return 'today';
    }
    if (deadlineDate <= addLocalDateDays(context.applicableDate, 7)) {
        return 'near-due';
    }
    return 'future';
}

/**
 * Selects the next pending known-deadline Task of one user-selected size.
 * @param {readonly TaskOccurrenceProjection[]} occurrences - Current Term Task occurrences.
 * @param {TaskSize} size - Requested small or large Task scale.
 * @param {PlanEvaluationContext} context - Shared TermZone evaluation context.
 * @return {NextTaskProjection} Deterministic Task selection or an explained empty state.
 */
export function selectNextTaskOccurrence(
    occurrences: readonly TaskOccurrenceProjection[],
    size: TaskSize,
    context: PlanEvaluationContext,
): NextTaskProjection {
    const candidates = occurrences
        .filter(occurrence => occurrence.size === size && occurrence.status === 'pending')
        .map(occurrence => ({ occurrence, deadlineBoundary: taskDeadlineBoundary(occurrence, context) }))
        .filter((candidate): candidate is Readonly<{
            occurrence: TaskOccurrenceProjection;
            deadlineBoundary: string;
        }> => candidate.deadlineBoundary !== null)
        .sort((first, second) => compareCanonicalText(first.deadlineBoundary, second.deadlineBoundary)
            || compareCanonicalText(
                taskOccurrenceIdentityKey(first.occurrence),
                taskOccurrenceIdentityKey(second.occurrence),
            ));
    const selected = candidates[0];
    if (!selected) {
        return Object.freeze({
            kind: 'empty',
            reason: 'no-pending-known-deadline',
        });
    }
    return Object.freeze({
        kind: 'task',
        occurrence: selected.occurrence,
        deadlineBoundary: selected.deadlineBoundary,
        remainingMilliseconds: Date.parse(selected.deadlineBoundary) - Date.parse(context.evaluatedAt),
    });
}

/**
 * Builds a projected next-Task result from one classified Task collection.
 * @param {readonly PlanTaskProjection[]} tasks - Classified current-Term Task occurrences.
 * @param {TaskSize} size - Requested Task scale.
 * @param {PlanEvaluationContext} context - Shared TermZone evaluation context.
 * @return {PlanNextTaskProjection} Enriched deterministic selection or empty state.
 */
function buildNextTask(
    tasks: readonly PlanTaskProjection[],
    size: TaskSize,
    context: PlanEvaluationContext,
): PlanNextTaskProjection {
    const selected = selectNextTaskOccurrence(tasks.map(task => task.occurrence), size, context);
    if (selected.kind === 'empty') {
        return selected;
    }
    const identityKey = taskOccurrenceIdentityKey(selected.occurrence);
    const task = tasks.find(candidate => taskOccurrenceIdentityKey(candidate.occurrence) === identityKey)!;
    return Object.freeze({
        kind: 'task',
        task,
        deadlineBoundary: selected.deadlineBoundary,
        remainingMilliseconds: selected.remainingMilliseconds,
    });
}

/**
 * Counts Today Task and Meeting contributions using PLAN time fallback semantics.
 * @param {readonly PlanTaskProjection[]} tasks - Classified current-Term Task occurrences.
 * @param {readonly PlanMeetingProjection[]} meetings - Classified Meeting occurrences starting today.
 * @param {PlanEvaluationContext} context - Shared TermZone evaluation context.
 * @return {TodaySummaryProjection} Count totals, contributions, and explicit exclusions.
 */
function buildTodaySummary(
    tasks: readonly PlanTaskProjection[],
    meetings: readonly PlanMeetingProjection[],
    context: PlanEvaluationContext,
): TodaySummaryProjection {
    const dueToday = tasks.filter(task => taskDeadlineDate(task.occurrence, context) === context.applicableDate);
    const taskCompleted = dueToday.filter(task => task.occurrence.status === 'completed').length;
    const taskPending = dueToday.filter(task => task.occurrence.status === 'pending').length;
    const meetingCompleted = meetings.filter(meeting => meeting.classification === 'ended').length;
    const meetingPending = meetings.filter(meeting => (
        meeting.classification === 'upcoming' || meeting.classification === 'in-progress'
    )).length;
    return Object.freeze({
        completed: taskCompleted + meetingCompleted,
        pending: taskPending + meetingPending,
        contributions: Object.freeze({
            tasks: Object.freeze({ completed: taskCompleted, pending: taskPending }),
            meetings: Object.freeze({ completed: meetingCompleted, pending: meetingPending }),
        }),
        excluded: Object.freeze({
            skippedTasks: dueToday.filter(task => task.occurrence.status === 'skipped').length,
            priorOverdueTasks: tasks.filter(task => (
                task.classification === 'overdue'
                && taskDeadlineDate(task.occurrence, context)! < context.applicableDate
            )).length,
            tbaTasks: tasks.filter(task => task.classification === 'TBA').length,
            cancelledMeetings: meetings.filter(meeting => meeting.classification === 'cancelled').length,
            holidaySuppressedMeetings: meetings.filter(meeting => (
                meeting.classification === 'holiday-suppressed'
            )).length,
            missedMeetings: 0,
            unmarkedMeetings: 0,
        }),
    });
}

/**
 * Produces one cross-kind stable occurrence ordering key.
 * @param {PlanTaskProjection | PlanMeetingProjection} item - Classified PLAN occurrence.
 * @return {string} Kind-prefixed stable identity key.
 */
function planOccurrenceIdentityKey(item: PlanTaskProjection | PlanMeetingProjection): string {
    return item.kind === 'task'
        ? `task\u0000${taskOccurrenceIdentityKey(item.occurrence)}`
        : `meeting\u0000${meetingOccurrenceIdentityKey(item.occurrence)}`;
}

/**
 * Tests whether one LocalDate belongs to an inclusive projection window.
 * @param {string} date - Canonical LocalDate under evaluation.
 * @param {MeetingOccurrenceWindow} window - Inclusive visible window.
 * @return {boolean} Whether the date is visible.
 */
function isDateInWindow(date: string, window: MeetingOccurrenceWindow): boolean {
    return date >= window.startDate && date <= window.endDate;
}

/**
 * Resolves the exact Instant used to order a timed Calendar item.
 * @param {PlanTaskProjection | PlanMeetingProjection} item - Timed Task or Meeting.
 * @return {string} Canonical start or deadline Instant.
 */
function calendarTimedItemInstant(item: PlanTaskProjection | PlanMeetingProjection): string {
    if (item.kind === 'meeting') {
        return item.occurrence.startInstant;
    }
    if (item.occurrence.deadline.kind !== 'timed') {
        throw new TypeError('Calendar timed Task must have a timed deadline');
    }
    return item.occurrence.deadline.instant;
}

/**
 * Compares two visible timed Calendar items deterministically.
 * @param {PlanTaskProjection | PlanMeetingProjection} first - First visible item.
 * @param {PlanTaskProjection | PlanMeetingProjection} second - Second visible item.
 * @return {number} Exact time then stable identity ordering.
 */
function compareCalendarTimedItems(
    first: PlanTaskProjection | PlanMeetingProjection,
    second: PlanTaskProjection | PlanMeetingProjection,
): number {
    return compareCanonicalText(calendarTimedItemInstant(first), calendarTimedItemInstant(second))
        || compareCanonicalText(planOccurrenceIdentityKey(first), planOccurrenceIdentityKey(second));
}

/**
 * Finds the Sunday or requested-window boundary ending one visible week fragment.
 * @param {string} startDate - First visible date in the fragment.
 * @param {string} windowEndDate - Final requested LocalDate.
 * @return {string} Inclusive fragment end date.
 */
function visibleWeekEnd(startDate: string, windowEndDate: string): string {
    const weekday = new Date(`${startDate}T00:00:00.000Z`).getUTCDay();
    const daysUntilSunday = (7 - weekday) % 7;
    const sunday = addLocalDateDays(startDate, daysUntilSunday);
    return sunday < windowEndDate ? sunday : windowEndDate;
}

/**
 * Clips each HolidayRange to at most one continuous segment per visible week.
 * @param {readonly HolidayRangeProjection[]} holidayRanges - Current Term named ranges.
 * @param {MeetingOccurrenceWindow} window - Inclusive Calendar window.
 * @return {readonly CalendarHolidaySegmentProjection[]} Stable continuous all-day segments.
 */
function buildCalendarHolidaySegments(
    holidayRanges: readonly HolidayRangeProjection[],
    window: MeetingOccurrenceWindow,
): readonly CalendarHolidaySegmentProjection[] {
    const segments: CalendarHolidaySegmentProjection[] = [];
    let weekStart = window.startDate;
    while (weekStart <= window.endDate) {
        const weekEnd = visibleWeekEnd(weekStart, window.endDate);
        for (const holidayRange of holidayRanges) {
            if (holidayRange.endDate < weekStart || holidayRange.startDate > weekEnd) {
                continue;
            }
            segments.push(Object.freeze({
                kind: 'holiday-range' as const,
                typeLabel: 'Holiday' as const,
                holidayRange,
                visibleStartDate: holidayRange.startDate > weekStart ? holidayRange.startDate : weekStart,
                visibleEndDate: holidayRange.endDate < weekEnd ? holidayRange.endDate : weekEnd,
            }));
        }
        if (weekEnd === window.endDate) {
            break;
        }
        weekStart = addLocalDateDays(weekEnd, 1);
    }
    return Object.freeze(segments.sort((first, second) => (
        compareCanonicalText(first.visibleStartDate, second.visibleStartDate)
        || compareCanonicalText(first.visibleEndDate, second.visibleEndDate)
        || compareCanonicalText(first.holidayRange.holidayRangeId, second.holidayRange.holidayRangeId)
    )));
}

/**
 * Builds one Calendar window from already classified PLAN occurrences.
 * @param {readonly PlanTaskProjection[]} tasks - Classified Current Term Tasks.
 * @param {readonly PlanMeetingProjection[]} meetings - Classified Current Term Meetings.
 * @param {readonly HolidayRangeProjection[]} holidayRanges - Current Term named ranges.
 * @param {PlanEvaluationContext} context - Shared projection evaluation context.
 * @return {CalendarWindowProjection} Timed, all-day, and continuous Holiday layers.
 */
function buildCalendarWindowProjection(
    tasks: readonly PlanTaskProjection[],
    meetings: readonly PlanMeetingProjection[],
    holidayRanges: readonly HolidayRangeProjection[],
    context: PlanEvaluationContext,
): CalendarWindowProjection {
    const visibleMeetings = meetings.filter(meeting => (
        meeting.classification !== 'holiday-suppressed'
        && isDateInWindow(meeting.occurrence.date, context.requestedWindow)
    ));
    const timedTasks = tasks.filter(task => (
        task.occurrence.deadline.kind === 'timed'
        && isDateInWindow(taskDeadlineDate(task.occurrence, context)!, context.requestedWindow)
    ));
    const allDayItems = Object.freeze(tasks.filter(task => (
        task.occurrence.deadline.kind === 'date-only'
        && isDateInWindow(task.occurrence.deadline.date, context.requestedWindow)
    )).sort((first, second) => (
        compareCanonicalText(
            first.occurrence.deadline.kind === 'date-only' ? first.occurrence.deadline.date : '',
            second.occurrence.deadline.kind === 'date-only' ? second.occurrence.deadline.date : '',
        ) || compareCanonicalText(
            taskOccurrenceIdentityKey(first.occurrence),
            taskOccurrenceIdentityKey(second.occurrence),
        )
    )));
    return Object.freeze({
        window: context.requestedWindow,
        timedItems: Object.freeze([...visibleMeetings, ...timedTasks].sort(compareCalendarTimedItems)),
        allDayItems,
        holidaySegments: buildCalendarHolidaySegments(holidayRanges, context.requestedWindow),
    });
}

/**
 * Resolves the visible LocalDate used to group one Agenda item.
 * @param {AgendaItemProjection} item - Meeting, Task, or Holiday range item.
 * @param {PlanEvaluationContext} context - Shared projection evaluation context.
 * @return {string} Canonical Agenda grouping LocalDate.
 */
function agendaItemDate(item: AgendaItemProjection, context: PlanEvaluationContext): string {
    if (item.kind === 'holiday-range') {
        return item.holidayRange.startDate > context.requestedWindow.startDate
            ? item.holidayRange.startDate
            : context.requestedWindow.startDate;
    }
    if (item.kind === 'meeting') {
        return item.occurrence.date;
    }
    return taskDeadlineDate(item.occurrence, context)!;
}

/**
 * Ranks range headers, exact-time items, and date-only Tasks within one Agenda date.
 * @param {AgendaItemProjection} item - Agenda item under comparison.
 * @return {number} Stable within-date category rank.
 */
function agendaItemRank(item: AgendaItemProjection): number {
    if (item.kind === 'holiday-range') {
        return 0;
    }
    if (item.kind === 'meeting' || item.occurrence.deadline.kind === 'timed') {
        return 1;
    }
    return 2;
}

/**
 * Resolves an exact Agenda ordering Instant when one exists.
 * @param {AgendaItemProjection} item - Agenda item under comparison.
 * @return {string} Canonical Instant or empty text for all-day items.
 */
function agendaItemInstant(item: AgendaItemProjection): string {
    if (item.kind === 'meeting') {
        return item.occurrence.startInstant;
    }
    if (item.kind === 'task' && item.occurrence.deadline.kind === 'timed') {
        return item.occurrence.deadline.instant;
    }
    return '';
}

/**
 * Produces a cross-kind stable Agenda ordering key.
 * @param {AgendaItemProjection} item - Agenda item under comparison.
 * @return {string} Kind-prefixed range or occurrence identity.
 */
function agendaItemIdentityKey(item: AgendaItemProjection): string {
    return item.kind === 'holiday-range'
        ? `holiday-range\u0000${item.holidayRange.holidayRangeId}`
        : planOccurrenceIdentityKey(item);
}

/**
 * Compares Agenda items by date, semantic layer, exact time, then stable identity.
 * @param {AgendaItemProjection} first - First Agenda item.
 * @param {AgendaItemProjection} second - Second Agenda item.
 * @param {PlanEvaluationContext} context - Shared projection evaluation context.
 * @return {number} Deterministic Agenda order.
 */
function compareAgendaItems(
    first: AgendaItemProjection,
    second: AgendaItemProjection,
    context: PlanEvaluationContext,
): number {
    return compareCanonicalText(agendaItemDate(first, context), agendaItemDate(second, context))
        || agendaItemRank(first) - agendaItemRank(second)
        || compareCanonicalText(agendaItemInstant(first), agendaItemInstant(second))
        || compareCanonicalText(agendaItemIdentityKey(first), agendaItemIdentityKey(second));
}

/**
 * Derives bounded non-mutating warnings for positive overlaps among effective Meetings.
 * @param {readonly PlanMeetingProjection[]} meetings - Visible Meeting items in start-time order.
 * @return {readonly AgendaConflictWarning[]} Stable pairwise warnings capped by the shared DTO limit.
 */
function buildAgendaConflictWarnings(
    meetings: readonly PlanMeetingProjection[],
): readonly AgendaConflictWarning[] {
    const activeMeetings = meetings.filter(meeting => meeting.classification !== 'cancelled');
    const warnings: AgendaConflictWarning[] = [];
    for (
        let firstIndex = 0;
        firstIndex < activeMeetings.length && warnings.length < MAX_MEETING_OVERLAP_WARNINGS;
        firstIndex += 1
    ) {
        const first = activeMeetings[firstIndex]!;
        for (
            let secondIndex = firstIndex + 1;
            secondIndex < activeMeetings.length && warnings.length < MAX_MEETING_OVERLAP_WARNINGS;
            secondIndex += 1
        ) {
            const second = activeMeetings[secondIndex]!;
            if (second.occurrence.startInstant >= first.occurrence.endInstant) {
                break;
            }
            const overlap = findMeetingTimeOverlap(first.occurrence, second.occurrence);
            if (overlap !== null) {
                warnings.push(Object.freeze({
                    code: 'meeting-time-overlap' as const,
                    first,
                    second,
                    overlap,
                }));
            }
        }
    }
    return Object.freeze(warnings.sort((first, second) => (
        compareCanonicalText(first.overlap.startInstant, second.overlap.startInstant)
        || compareCanonicalText(
            meetingOccurrenceIdentityKey(first.first.occurrence),
            meetingOccurrenceIdentityKey(second.first.occurrence),
        )
        || compareCanonicalText(
            meetingOccurrenceIdentityKey(first.second.occurrence),
            meetingOccurrenceIdentityKey(second.second.occurrence),
        )
    )));
}

/**
 * Builds a deterministic Agenda from the same Calendar occurrences and Holiday facts.
 * @param {CalendarWindowProjection} calendar - Shared visible Calendar occurrence set.
 * @param {readonly HolidayRangeProjection[]} holidayRanges - Current Term named ranges.
 * @param {PlanEvaluationContext} context - Shared projection evaluation context.
 * @return {AgendaProjection} Ordered items and non-mutating conflict warnings.
 */
function buildAgendaProjection(
    calendar: CalendarWindowProjection,
    holidayRanges: readonly HolidayRangeProjection[],
    context: PlanEvaluationContext,
): AgendaProjection {
    const holidayItems = holidayRanges.filter(holidayRange => (
        holidayRange.endDate >= context.requestedWindow.startDate
        && holidayRange.startDate <= context.requestedWindow.endDate
    )).map(holidayRange => Object.freeze({
        kind: 'holiday-range' as const,
        typeLabel: 'Holiday' as const,
        holidayRange,
    }));
    const items = Object.freeze([
        ...calendar.timedItems,
        ...calendar.allDayItems,
        ...holidayItems,
    ].sort((first, second) => compareAgendaItems(first, second, context)));
    const meetings = calendar.timedItems.filter(
        (item): item is PlanMeetingProjection => item.kind === 'meeting',
    );
    return Object.freeze({
        items,
        warnings: buildAgendaConflictWarnings(meetings),
    });
}

/**
 * Builds all unified PLAN projections from one revision-bound fact collection.
 * @param {PlanProjectionSource} source - Current-Term facts read from one DATA snapshot.
 * @param {PlanEvaluationContext} context - Single Workspace-owned evaluation context.
 * @param {PlanAttendanceAvailability} attendanceAvailability - Current ATTEND capability state.
 * @return {PlanProjection} Unified Calendar, Agenda, Today, Week, TBA, next-Task, and progress projection.
 */
export function buildPlanProjection(
    source: PlanProjectionSource,
    context: PlanEvaluationContext,
    attendanceAvailability: PlanAttendanceAvailability = 'unavailable',
): PlanProjection {
    const evaluationContext = Object.freeze({
        evaluatedAt: context.evaluatedAt,
        termZone: context.termZone,
        applicableDate: context.applicableDate,
        requestedWindow: Object.freeze({ ...context.requestedWindow }),
    });
    const tasks = Object.freeze(source.taskSources.map(task => Object.freeze({
        ...task,
        kind: 'task' as const,
        typeLabel: 'Task' as const,
        classification: classifyTaskOccurrence(task.occurrence, evaluationContext),
    })).sort((first, second) => (
        compareCanonicalText(
            taskOccurrenceIdentityKey(first.occurrence),
            taskOccurrenceIdentityKey(second.occurrence),
        )
    )));
    const meetings = Object.freeze(source.meetingSources.map(meeting => Object.freeze({
        ...meeting,
        kind: 'meeting' as const,
        typeLabel: meetingTypeLabel(meeting.occurrence.type),
        classification: classifyMeetingOccurrence(meeting.occurrence, evaluationContext.evaluatedAt),
    })).sort((first, second) => compareCanonicalText(
        first.occurrence.startInstant,
        second.occurrence.startInstant,
    ) || compareCanonicalText(
        meetingOccurrenceIdentityKey(first.occurrence),
        meetingOccurrenceIdentityKey(second.occurrence),
    )));
    const todayTasks = Object.freeze(tasks.filter(task => (
        task.classification === 'overdue'
        || taskDeadlineDate(task.occurrence, evaluationContext) === evaluationContext.applicableDate
    )).sort((first, second) => (
        compareCanonicalText(
            taskDeadlineBoundary(first.occurrence, evaluationContext)!,
            taskDeadlineBoundary(second.occurrence, evaluationContext)!,
        ) || compareCanonicalText(
            taskOccurrenceIdentityKey(first.occurrence),
            taskOccurrenceIdentityKey(second.occurrence),
        )
    )));
    const todayMeetings = Object.freeze(meetings.filter(meeting => (
        meeting.occurrence.date === evaluationContext.applicableDate
    )));
    const weekTasks = Object.freeze(tasks.filter(task => {
        const deadlineDate = taskDeadlineDate(task.occurrence, evaluationContext);
        return deadlineDate !== null
            && deadlineDate >= evaluationContext.requestedWindow.startDate
            && deadlineDate <= evaluationContext.requestedWindow.endDate;
    }).sort((first, second) => (
        compareCanonicalText(
            taskDeadlineBoundary(first.occurrence, evaluationContext)!,
            taskDeadlineBoundary(second.occurrence, evaluationContext)!,
        ) || compareCanonicalText(
            taskOccurrenceIdentityKey(first.occurrence),
            taskOccurrenceIdentityKey(second.occurrence),
        )
    )));
    const weekMeetings = Object.freeze(meetings.filter(meeting => (
        meeting.occurrence.date >= evaluationContext.requestedWindow.startDate
        && meeting.occurrence.date <= evaluationContext.requestedWindow.endDate
        && meeting.classification !== 'holiday-suppressed'
    )));
    const weekHolidayRanges = Object.freeze(source.holidayRanges.filter(range => (
        range.endDate >= evaluationContext.requestedWindow.startDate
        && range.startDate <= evaluationContext.requestedWindow.endDate
    )).sort((first, second) => (
        compareCanonicalText(first.startDate, second.startDate)
        || compareCanonicalText(first.endDate, second.endDate)
        || compareCanonicalText(first.holidayRangeId, second.holidayRangeId)
    )));
    const calendar = buildCalendarWindowProjection(
        tasks,
        meetings,
        weekHolidayRanges,
        evaluationContext,
    );
    const agenda = buildAgendaProjection(calendar, weekHolidayRanges, evaluationContext);
    return Object.freeze({
        workspaceRevision: source.workspaceRevision,
        planEntityVersion: source.planEntityVersion,
        evaluationContext,
        attendance: Object.freeze({
            availability: attendanceAvailability,
            todayMeetingCountBasis: 'meeting-end-state',
        }),
        term: source.term,
        tasks,
        meetings,
        today: Object.freeze({
            tasks: todayTasks,
            meetings: todayMeetings,
            summary: buildTodaySummary(tasks, todayMeetings, evaluationContext),
        }),
        week: Object.freeze({
            window: evaluationContext.requestedWindow,
            tasks: weekTasks,
            meetings: weekMeetings,
            holidayRanges: weekHolidayRanges,
        }),
        calendar,
        agenda,
        tba: Object.freeze({
            tasks: Object.freeze(tasks.filter(task => task.occurrence.deadline.kind === 'tba')),
        }),
        next: Object.freeze({
            small: buildNextTask(tasks, 'small', evaluationContext),
            large: buildNextTask(tasks, 'large', evaluationContext),
        }),
        termProgress: calculateTermProgress(source.term, evaluationContext.applicableDate),
    });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function hasExactDataKeys(value: unknown, expectedKeys: readonly string[]): value is Record<string, unknown> {
    if (!isPlainObject(value)) {
        return false;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    return keys.length === expectedKeys.length
        && keys.every(key => typeof key === 'string' && expectedKeys.includes(key))
        && expectedKeys.every(key => {
            const descriptor = descriptors[key];
            return descriptor !== undefined && 'value' in descriptor && descriptor.enumerable;
        });
}

/**
 * Checks that an array is dense and carries no unknown own properties.
 * @param {unknown} value - Candidate DTO array.
 * @return {boolean} Whether only length and enumerable data indices are present.
 */
function isExactDataArray(value: unknown): value is unknown[] {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
        return false;
    }
    const ownKeys = Reflect.ownKeys(value);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (lengthDescriptor === undefined
        || !('value' in lengthDescriptor)
        || lengthDescriptor.value !== value.length
        || lengthDescriptor.enumerable
        || ownKeys.length !== value.length + 1) {
        return false;
    }
    return ownKeys.every(key => {
        if (key === 'length') {
            return true;
        }
        if (typeof key !== 'string') {
            return false;
        }
        const index = Number(key);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return Number.isSafeInteger(index)
            && index >= 0
            && index < value.length
            && String(index) === key
            && descriptor !== undefined
            && 'value' in descriptor
            && descriptor.enumerable;
    });
}

function isTermProjection(value: unknown): value is TermProjection {
    return hasExactDataKeys(value, [
        'termId',
        'name',
        'startDate',
        'endDate',
        'timeZone',
        'archived',
        'entityVersion',
    ])
        && isCanonicalUuid(value.termId)
        && typeof value.name === 'string'
        && value.name.length > 0
        && isCanonicalLocalDate(value.startDate)
        && isCanonicalLocalDate(value.endDate)
        && value.endDate >= value.startDate
        && typeof value.timeZone === 'string'
        && typeof value.archived === 'boolean'
        && isCanonicalUnsignedSqliteInteger(value.entityVersion);
}

function isPlanTaskProjection(value: unknown): value is PlanTaskProjection {
    return hasExactDataKeys(value, [
        'courseId',
        'courseCode',
        'occurrence',
        'kind',
        'typeLabel',
        'classification',
    ])
        && isCanonicalUuid(value.courseId)
        && typeof value.courseCode === 'string'
        && value.courseCode.length > 0
        && isTaskOccurrenceProjection(value.occurrence)
        && value.kind === 'task'
        && value.typeLabel === 'Task'
        && [
            'overdue',
            'today',
            'near-due',
            'future',
            'completed',
            'skipped',
            'TBA',
        ].includes(value.classification as string);
}

function isPlanMeetingProjection(value: unknown): value is PlanMeetingProjection {
    return hasExactDataKeys(value, [
        'courseId',
        'courseCode',
        'occurrence',
        'kind',
        'typeLabel',
        'classification',
    ])
        && isCanonicalUuid(value.courseId)
        && typeof value.courseCode === 'string'
        && value.courseCode.length > 0
        && isMeetingOccurrenceProjection(value.occurrence)
        && value.kind === 'meeting'
        && ['Lecture', 'Tutorial', 'Practical'].includes(value.typeLabel as string)
        && [
            'upcoming',
            'in-progress',
            'ended',
            'cancelled',
            'holiday-suppressed',
        ].includes(value.classification as string);
}

function sameDataValue(
    first: unknown,
    second: unknown,
    activeFirst = new WeakSet<object>(),
    activeSecond = new WeakSet<object>(),
): boolean {
    if (Object.is(first, second)) {
        return true;
    }
    if (typeof first !== 'object'
        || first === null
        || typeof second !== 'object'
        || second === null
        || Array.isArray(first) !== Array.isArray(second)
        || activeFirst.has(first)
        || activeSecond.has(second)) {
        return false;
    }
    activeFirst.add(first);
    activeSecond.add(second);
    try {
        if (Array.isArray(first) || Array.isArray(second)) {
            if (!isExactDataArray(first) || !isExactDataArray(second)) {
                return false;
            }
            return first.length === second.length
                && first.every((value, index) => (
                    sameDataValue(value, second[index], activeFirst, activeSecond)
                ));
        }
        if (!isPlainObject(first) || !isPlainObject(second)) {
            return false;
        }
        const firstKeys = Reflect.ownKeys(first);
        const secondKeys = Reflect.ownKeys(second);
        return firstKeys.length === secondKeys.length
            && firstKeys.every(key => {
                const firstDescriptor = Object.getOwnPropertyDescriptor(first, key);
                const secondDescriptor = Object.getOwnPropertyDescriptor(second, key);
                return firstDescriptor !== undefined
                    && secondDescriptor !== undefined
                    && 'value' in firstDescriptor
                    && 'value' in secondDescriptor
                    && firstDescriptor.enumerable
                    && secondDescriptor.enumerable
                    && sameDataValue(
                        firstDescriptor.value,
                        secondDescriptor.value,
                        activeFirst,
                        activeSecond,
                    );
            });
    }
    finally {
        activeFirst.delete(first);
        activeSecond.delete(second);
    }
}

/**
 * Validates one exact unified PLAN projection and re-evaluates all composite derived facts.
 * @param {unknown} value - Untrusted Workspace projection value.
 * @return {boolean} Whether the envelope is exact and internally coherent.
 */
export function isPlanProjection(value: unknown): value is PlanProjection {
    if (!hasExactDataKeys(value, [
        'workspaceRevision',
        'planEntityVersion',
        'evaluationContext',
        'attendance',
        'term',
        'tasks',
        'meetings',
        'today',
        'week',
        'calendar',
        'agenda',
        'tba',
        'next',
        'termProgress',
    ])
        || !isCanonicalUnsignedSqliteInteger(value.workspaceRevision)
        || !isCanonicalUnsignedSqliteInteger(value.planEntityVersion)
        || !hasExactDataKeys(value.evaluationContext, [
            'evaluatedAt',
            'termZone',
            'applicableDate',
            'requestedWindow',
        ])
        || !hasExactDataKeys(value.attendance, ['availability', 'todayMeetingCountBasis'])
        || (value.attendance.availability !== 'disabled'
            && value.attendance.availability !== 'unavailable')
        || value.attendance.todayMeetingCountBasis !== 'meeting-end-state'
        || !isTermProjection(value.term)
        || !isExactDataArray(value.tasks)
        || !value.tasks.every(isPlanTaskProjection)
        || !isExactDataArray(value.meetings)
        || !value.meetings.every(isPlanMeetingProjection)
        || !hasExactDataKeys(value.today, ['tasks', 'meetings', 'summary'])
        || !isExactDataArray(value.today.tasks)
        || !value.today.tasks.every(isPlanTaskProjection)
        || !isExactDataArray(value.today.meetings)
        || !value.today.meetings.every(isPlanMeetingProjection)
        || !hasExactDataKeys(value.week, ['window', 'tasks', 'meetings', 'holidayRanges'])
        || !isExactDataArray(value.week.tasks)
        || !value.week.tasks.every(isPlanTaskProjection)
        || !isExactDataArray(value.week.meetings)
        || !value.week.meetings.every(isPlanMeetingProjection)
        || !isExactDataArray(value.week.holidayRanges)
        || !value.week.holidayRanges.every(isHolidayRangeProjection)
        || !hasExactDataKeys(value.calendar, [
            'window',
            'timedItems',
            'allDayItems',
            'holidaySegments',
        ])
        || !isMeetingOccurrenceWindow(value.calendar.window)
        || !isExactDataArray(value.calendar.timedItems)
        || !value.calendar.timedItems.every(item => (
            isPlanTaskProjection(item) || isPlanMeetingProjection(item)
        ))
        || !isExactDataArray(value.calendar.allDayItems)
        || !value.calendar.allDayItems.every(isPlanTaskProjection)
        || !isExactDataArray(value.calendar.holidaySegments)
        || !hasExactDataKeys(value.agenda, ['items', 'warnings'])
        || !isExactDataArray(value.agenda.items)
        || !isExactDataArray(value.agenda.warnings)
        || value.agenda.warnings.length > MAX_MEETING_OVERLAP_WARNINGS
        || !hasExactDataKeys(value.tba, ['tasks'])
        || !isExactDataArray(value.tba.tasks)
        || !value.tba.tasks.every(isPlanTaskProjection)) {
        return false;
    }

    try {
        const candidate = value as PlanProjection;
        const expectedContext = createPlanEvaluationContext(
            candidate.evaluationContext.evaluatedAt,
            candidate.term.timeZone,
            candidate.evaluationContext.requestedWindow,
        );
        const rebuilt = buildPlanProjection({
            workspaceRevision: candidate.workspaceRevision,
            planEntityVersion: candidate.planEntityVersion,
            term: candidate.term,
            taskSources: candidate.tasks.map(task => ({
                courseId: task.courseId,
                courseCode: task.courseCode,
                occurrence: task.occurrence,
            })),
            meetingSources: candidate.meetings.map(meeting => ({
                courseId: meeting.courseId,
                courseCode: meeting.courseCode,
                occurrence: meeting.occurrence,
            })),
            holidayRanges: candidate.week.holidayRanges,
        }, expectedContext, candidate.attendance.availability);
        return sameDataValue(rebuilt, candidate);
    }
    catch {
        return false;
    }
}
