/**
 * @file Owns the version-one Shell payload used by the first-setup DraftCheckpoint.
 */

import type {
    CourseColor,
    MeetingTypeCode,
    MeetingWeekday,
} from '../shared/workspace-course-contract';
import type { TaskSize } from '../shared/workspace-task-contract';

export type TermDraft = Readonly<{
    name: string;
    startDate: string;
    endDate: string;
    timeZone: string;
}>;

export type CourseDraft = Readonly<{
    code: string;
    name: string;
    section: string;
    instructor: string;
    color: CourseColor | '';
    credits: string;
    teachingStartDate: string;
    teachingEndDate: string;
}>;

export type MeetingDraft = Readonly<{
    courseId: string;
    meetingType: MeetingTypeCode;
    weekday: MeetingWeekday;
    localStart: string;
    localEnd: string;
    endDayOffset: 0 | 1;
    effectiveStartDate: string;
    effectiveEndDate: string;
    locationKind: 'known' | 'tba';
    locationValue: string;
}>;

export type TaskDraft = Readonly<{
    courseId: string;
    title: string;
    size: TaskSize;
    scheduleKind: 'once' | 'weekly';
    deadlineKind: 'date-only' | 'timed' | 'tba';
    deadlineDate: string;
    deadlineTime: string;
    weeklyStartDate: string;
    weeklyWeekday: MeetingWeekday;
    weeklyDeadlineTime: string;
    weeklyEndDate: string;
    followTeachingWeek: boolean;
}>;

export type HolidayDraft = Readonly<{
    name: string;
    startDate: string;
    endDate: string;
}>;

export type SetupDraft = Readonly<{
    step: 'term' | 'course' | 'activity' | 'holiday';
    activityKind: 'meeting' | 'task';
    term: TermDraft;
    course: CourseDraft;
    meeting: MeetingDraft;
    task: TaskDraft;
    holiday: HolidayDraft;
}>;

const COURSE_COLORS: readonly (CourseColor | '')[] = [
    '',
    'red',
    'orange',
    'yellow',
    'green',
    'blue',
    'purple',
    'gray',
];
const MEETING_TYPES: readonly MeetingTypeCode[] = ['LEC', 'TUT', 'PRA'];
const WEEKDAYS: readonly MeetingWeekday[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const TASK_SIZES: readonly TaskSize[] = ['small', 'large'];

/**
 * Checks that an opaque value is a plain record.
 *
 * @param {unknown} value Candidate value.
 * @return {boolean} Whether the value has ordinary data properties.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

/**
 * Checks an exact enumerable data-key set before the Shell reads a stored draft.
 *
 * @param {unknown} value Candidate record.
 * @param {readonly string[]} expectedKeys Required keys.
 * @return {boolean} Whether the record has exactly the required data keys.
 */
function hasExactKeys(
    value: unknown,
    expectedKeys: readonly string[],
): value is Record<string, unknown> {
    if (!isRecord(value)) {
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
 * Checks that each named field remains an editable string, including empty input.
 *
 * @param {Record<string, unknown>} value Candidate draft record.
 * @param {readonly string[]} keys String fields owned by the form.
 * @return {boolean} Whether every field is a string.
 */
function hasStringFields(
    value: Record<string, unknown>,
    keys: readonly string[],
): boolean {
    return keys.every(key => typeof value[key] === 'string');
}

/**
 * Checks the incomplete Term form payload without applying domain validation.
 *
 * @param {unknown} value Candidate Term draft.
 * @return {boolean} Whether the Shell can safely restore it into controlled inputs.
 */
function isTermDraft(value: unknown): value is TermDraft {
    const keys = ['name', 'startDate', 'endDate', 'timeZone'] as const;
    return hasExactKeys(value, keys) && hasStringFields(value, keys);
}

/**
 * Checks the incomplete standalone Course form payload.
 *
 * @param {unknown} value Candidate Course draft.
 * @return {boolean} Whether the Shell can safely restore it into controlled inputs.
 */
function isCourseDraft(value: unknown): value is CourseDraft {
    const keys = [
        'code',
        'name',
        'section',
        'instructor',
        'color',
        'credits',
        'teachingStartDate',
        'teachingEndDate',
    ] as const;
    return hasExactKeys(value, keys)
        && hasStringFields(value, keys)
        && COURSE_COLORS.includes(value.color as CourseColor | '');
}

/**
 * Checks the incomplete Meeting alternative payload.
 *
 * @param {unknown} value Candidate Meeting draft.
 * @return {boolean} Whether the Shell can safely restore it into controlled inputs.
 */
function isMeetingDraft(value: unknown): value is MeetingDraft {
    const keys = [
        'courseId',
        'meetingType',
        'weekday',
        'localStart',
        'localEnd',
        'endDayOffset',
        'effectiveStartDate',
        'effectiveEndDate',
        'locationKind',
        'locationValue',
    ] as const;
    return hasExactKeys(value, keys)
        && hasStringFields(value, keys.filter(key => key !== 'endDayOffset'))
        && (value.endDayOffset === 0 || value.endDayOffset === 1)
        && MEETING_TYPES.includes(value.meetingType as MeetingTypeCode)
        && WEEKDAYS.includes(value.weekday as MeetingWeekday)
        && (value.locationKind === 'known' || value.locationKind === 'tba');
}

/**
 * Checks the incomplete once-Task alternative payload.
 *
 * @param {unknown} value Candidate Task draft.
 * @return {boolean} Whether the Shell can safely restore it into controlled inputs.
 */
function isTaskDraft(value: unknown): value is TaskDraft {
    const keys = [
        'courseId',
        'title',
        'size',
        'scheduleKind',
        'deadlineKind',
        'deadlineDate',
        'deadlineTime',
        'weeklyStartDate',
        'weeklyWeekday',
        'weeklyDeadlineTime',
        'weeklyEndDate',
        'followTeachingWeek',
    ] as const;
    return hasExactKeys(value, keys)
        && hasStringFields(value, [
            'courseId',
            'title',
            'deadlineDate',
            'deadlineTime',
            'weeklyStartDate',
            'weeklyDeadlineTime',
            'weeklyEndDate',
        ])
        && TASK_SIZES.includes(value.size as TaskSize)
        && (value.scheduleKind === 'once' || value.scheduleKind === 'weekly')
        && (value.deadlineKind === 'date-only'
            || value.deadlineKind === 'timed'
            || value.deadlineKind === 'tba')
        && WEEKDAYS.includes(value.weeklyWeekday as MeetingWeekday)
        && typeof value.followTeachingWeek === 'boolean';
}

/**
 * Checks the incomplete optional HolidayRange payload.
 *
 * @param {unknown} value Candidate Holiday draft.
 * @return {boolean} Whether the Shell can restore all controlled text inputs.
 */
function isHolidayDraft(value: unknown): value is HolidayDraft {
    const keys = ['name', 'startDate', 'endDate'] as const;
    return hasExactKeys(value, keys) && hasStringFields(value, keys);
}

/**
 * Serializes the current editable values without promoting them to formal facts.
 *
 * @param {SetupDraft} draft Current first-setup editing model.
 * @return {string} Opaque version-one DraftCheckpoint payload.
 */
export function encodeSetupDraft(draft: SetupDraft): string {
    return JSON.stringify(draft);
}

/**
 * Restores a version-one DraftCheckpoint payload at the Shell trust boundary.
 *
 * @param {string} opaquePayload Workspace-stored, Shell-owned JSON payload.
 * @return {SetupDraft | null} Restorable editing model, or null when incompatible.
 */
export function decodeSetupDraft(opaquePayload: string): SetupDraft | null {
    let value: unknown;
    try {
        value = JSON.parse(opaquePayload);
    }
    catch {
        return null;
    }

    const currentKeys = ['step', 'activityKind', 'term', 'course', 'meeting', 'task', 'holiday'];
    const legacyKeys = ['step', 'activityKind', 'term', 'course', 'meeting', 'task'];
    if ((!hasExactKeys(value, currentKeys) && !hasExactKeys(value, legacyKeys))
        || (value.step !== 'term'
            && value.step !== 'course'
            && value.step !== 'activity'
            && value.step !== 'holiday')
        || (value.activityKind !== 'meeting' && value.activityKind !== 'task')
        || !isTermDraft(value.term)
        || !isCourseDraft(value.course)
        || !isMeetingDraft(value.meeting)
        || !isTaskDraft(value.task)
        || ('holiday' in value && !isHolidayDraft(value.holiday))) {
        return null;
    }

    return {
        step: value.step,
        activityKind: value.activityKind,
        term: value.term,
        course: value.course,
        meeting: value.meeting,
        task: value.task,
        holiday: 'holiday' in value
            ? value.holiday as HolidayDraft
            : { name: '', startDate: '', endDate: '' },
    };
}
