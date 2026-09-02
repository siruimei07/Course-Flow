import { MAX_MEETING_OVERLAP_WARNINGS, MeetingOccurrenceWindow } from '../workspace-course-contract';
import { isMeetingOccurrenceProjection, isMeetingOccurrenceWindow } from '../workspace-course-contract/guards';
import { isCanonicalUnsignedSqliteInteger, isCanonicalUuid } from '../workspace-data-contract';
import { isHolidayRangeProjection } from '../workspace-holiday-contract';
import { PlanMeetingProjection, PlanProjection, PlanTaskProjection, buildPlanProjection, createPlanEvaluationContext } from '../workspace-plan-contract';
import { hasExactDataKeys, sameDataValue } from './types';
import { isTaskOccurrenceProjection } from '../workspace-task-contract/guards';
import { TermProjection, isCanonicalLocalDate } from '../workspace-term-contract';
/**
 * Tests whether one LocalDate belongs to an inclusive projection window.
 * @param {string} date - Canonical LocalDate under evaluation.
 * @param {MeetingOccurrenceWindow} window - Inclusive visible window.
 * @return {boolean} Whether the date is visible.
 */
export function isDateInWindow(date: string, window: MeetingOccurrenceWindow): boolean {
    return date >= window.startDate && date <= window.endDate;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

/**
 * Checks that an array is dense and carries no unknown own properties.
 * @param {unknown} value - Candidate DTO array.
 * @return {boolean} Whether only length and enumerable data indices are present.
 */
export function isExactDataArray(value: unknown): value is unknown[] {
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

export function isTermProjection(value: unknown): value is TermProjection {
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

export function isPlanTaskProjection(value: unknown): value is PlanTaskProjection {
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

export function isPlanMeetingProjection(value: unknown): value is PlanMeetingProjection {
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
        'courses',
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
        || !hasExactDataKeys(value.week, ['window', 'tasks', 'meetings', 'holidayRanges', 'days'])
        || !isExactDataArray(value.week.days)
        || !isExactDataArray(value.courses)
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
