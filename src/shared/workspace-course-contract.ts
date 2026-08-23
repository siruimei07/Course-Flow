/**
 * @file Defines the bounded Course and first Meeting Workspace contract.
 */

import type { CanonicalValue } from './canonical-json';
import {
    isCanonicalUnsignedSqliteInteger,
    isCanonicalUuid,
} from './workspace-data-contract';
import { isCanonicalLocalDate } from './workspace-term-contract';

export type CourseColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray';
export type MeetingTypeCode = 'LEC' | 'TUT' | 'PRA';
export type MeetingWeekday = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

export type MeetingLocation =
    | Readonly<{ kind: 'known'; value: string }>
    | Readonly<{ kind: 'tba' }>;

export type CourseTeachingRangeIntent =
    | Readonly<{ kind: 'inherit-term' }>
    | Readonly<{ kind: 'explicit'; startDate: string; endDate: string }>;

export type MeetingEffectiveRangeIntent =
    | Readonly<{ kind: 'inherit-course' }>
    | Readonly<{ kind: 'explicit'; startDate: string; endDate: string }>;

export type CourseTeachingRangeProjection = Readonly<{
    kind: CourseTeachingRangeIntent['kind'];
    startDate: string;
    endDate: string;
}>;

export type MeetingEffectiveRangeProjection = Readonly<{
    kind: MeetingEffectiveRangeIntent['kind'];
    startDate: string;
    endDate: string;
}>;

export type MeetingSeriesProjection = Readonly<{
    meetingSeriesId: string;
    type: Readonly<{ code: MeetingTypeCode; name: 'Lecture' | 'Tutorial' | 'Practical' }>;
    weekday: MeetingWeekday;
    localStart: string;
    localEnd: string;
    effectiveRange: MeetingEffectiveRangeProjection;
    location: MeetingLocation;
    entityVersion: string;
}>;

export type CourseProjection = Readonly<{
    courseId: string;
    termId: string;
    code: string;
    name: string;
    section: string | null;
    instructor: string | null;
    color: CourseColor | null;
    credits: string | null;
    teachingRange: CourseTeachingRangeProjection;
    archived: boolean;
    entityVersion: string;
    meetings: readonly MeetingSeriesProjection[];
}>;

export type LegacyCreateCourseWithMeetingCommand = Readonly<{
    commandId: string;
    followUpId: string;
    expectedRevision: string;
    expectedPlanVersion: string;
    intent: Readonly<{
        kind: 'plan.create-course-with-first-meeting';
        intentSchemaVersion: 1;
        payload: Readonly<{
            course: Readonly<{
                code: string;
                name: string;
                section: string | null;
                instructor: string | null;
                color: CourseColor | null;
                credits: string | null;
            }>;
            meeting: Readonly<{
                type: MeetingTypeCode;
                weekday: MeetingWeekday;
                localStart: string;
                localEnd: string;
                effectiveStartDate: string;
                effectiveEndDate: string;
                location: MeetingLocation;
            }>;
        }>;
    }>;
}>;

export type CreateCourseWithMeetingCommand = Readonly<{
    commandId: string;
    followUpId: string;
    expectedRevision: string;
    expectedPlanVersion: string;
    intent: Readonly<{
        kind: 'plan.create-course-with-first-meeting';
        intentSchemaVersion: 2;
        payload: Readonly<{
            course: Readonly<{
                code: string;
                name: string;
                section: string | null;
                instructor: string | null;
                color: CourseColor | null;
                credits: string | null;
                teachingRange: CourseTeachingRangeIntent;
            }>;
            meeting: Readonly<{
                type: MeetingTypeCode;
                weekday: MeetingWeekday;
                localStart: string;
                localEnd: string;
                effectiveRange: MeetingEffectiveRangeIntent;
                location: MeetingLocation;
            }>;
        }>;
    }>;
}>;

export type AcceptedCreateCourseWithMeetingCommand =
    | LegacyCreateCourseWithMeetingCommand
    | CreateCourseWithMeetingCommand;

const COURSE_COLORS = new Set<CourseColor>([
    'red',
    'orange',
    'yellow',
    'green',
    'blue',
    'purple',
    'gray',
]);
const MEETING_TYPES = new Set<MeetingTypeCode>(['LEC', 'TUT', 'PRA']);
const MEETING_WEEKDAYS = new Set<MeetingWeekday>([
    'MON',
    'TUE',
    'WED',
    'THU',
    'FRI',
    'SAT',
    'SUN',
]);
const LOCAL_TIME_PATTERN = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;
const SQLITE_INTEGER_MAX = 9223372036854775807n;

/**
 * Checks whether a value is a plain record with exactly the expected data properties.
 */
function hasExactDataKeys(value: unknown, expectedKeys: readonly string[]): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
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
 * Trims and bounds a required text fact.
 */
function canonicalText(value: unknown, maximumLength: number): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= maximumLength ? trimmed : null;
}

/**
 * Trims and bounds an explicitly optional text fact.
 */
function canonicalOptionalText(value: unknown, maximumLength: number): string | null | undefined {
    return value === null ? null : canonicalText(value, maximumLength) ?? undefined;
}

/**
 * Converts an exact non-negative decimal into the canonical DTO form.
 */
function canonicalCredits(value: unknown): string | null | undefined {
    if (value === null) {
        return null;
    }
    if (typeof value !== 'string') {
        return undefined;
    }

    const match = DECIMAL_PATTERN.exec(value);
    if (!match) {
        return undefined;
    }
    const integer = match[1]!;
    const fraction = (match[2] ?? '').replace(/0+$/, '');
    if (fraction.length > 6) {
        return undefined;
    }
    const coefficientText = (integer + fraction).replace(/^0+(?=[0-9])/, '');
    if (coefficientText.length > 18 || BigInt(coefficientText) > SQLITE_INTEGER_MAX) {
        return undefined;
    }
    return fraction.length === 0 ? integer : `${integer}.${fraction}`;
}

/**
 * Validates and normalizes the explicit known/TBA location union.
 */
function canonicalLocation(value: unknown): MeetingLocation | null {
    if (hasExactDataKeys(value, ['kind']) && value.kind === 'tba') {
        return { kind: 'tba' };
    }
    if (!hasExactDataKeys(value, ['kind', 'value']) || value.kind !== 'known') {
        return null;
    }
    const text = canonicalText(value.value, 240);
    return text === null ? null : { kind: 'known', value: text };
}

/**
 * Validates the persisted Course range intent without resolving its Term dates.
 */
function canonicalCourseTeachingRange(value: unknown): CourseTeachingRangeIntent | null {
    if (hasExactDataKeys(value, ['kind']) && value.kind === 'inherit-term') {
        return { kind: 'inherit-term' };
    }
    if (!hasExactDataKeys(value, ['kind', 'startDate', 'endDate'])
        || value.kind !== 'explicit'
        || !isCanonicalLocalDate(value.startDate)
        || !isCanonicalLocalDate(value.endDate)
        || value.endDate < value.startDate) {
        return null;
    }
    return { kind: 'explicit', startDate: value.startDate, endDate: value.endDate };
}

/**
 * Validates the persisted Meeting range intent without resolving its Course dates.
 */
function canonicalMeetingEffectiveRange(value: unknown): MeetingEffectiveRangeIntent | null {
    if (hasExactDataKeys(value, ['kind']) && value.kind === 'inherit-course') {
        return { kind: 'inherit-course' };
    }
    if (!hasExactDataKeys(value, ['kind', 'startDate', 'endDate'])
        || value.kind !== 'explicit'
        || !isCanonicalLocalDate(value.startDate)
        || !isCanonicalLocalDate(value.endDate)
        || value.endDate < value.startDate) {
        return null;
    }
    return { kind: 'explicit', startDate: value.startDate, endDate: value.endDate };
}

/**
 * Checks a resolved date range projection and its allowed inheritance discriminator.
 */
function isResolvedDateRange(
    value: unknown,
    inheritedKind: 'inherit-term' | 'inherit-course',
): value is CourseTeachingRangeProjection | MeetingEffectiveRangeProjection {
    return hasExactDataKeys(value, ['kind', 'startDate', 'endDate'])
        && (value.kind === inheritedKind || value.kind === 'explicit')
        && isCanonicalLocalDate(value.startDate)
        && isCanonicalLocalDate(value.endDate)
        && value.endDate >= value.startDate;
}

function isMeetingSeriesProjection(value: unknown): value is MeetingSeriesProjection {
    if (!hasExactDataKeys(value, [
        'meetingSeriesId',
        'type',
        'weekday',
        'localStart',
        'localEnd',
        'effectiveRange',
        'location',
        'entityVersion',
    ])
        || !isCanonicalUuid(value.meetingSeriesId)
        || !hasExactDataKeys(value.type, ['code', 'name'])
        || !MEETING_TYPES.has(value.type.code as MeetingTypeCode)
        || value.type.name !== ({ LEC: 'Lecture', TUT: 'Tutorial', PRA: 'Practical' } as const)[
            value.type.code as MeetingTypeCode
        ]
        || !MEETING_WEEKDAYS.has(value.weekday as MeetingWeekday)
        || typeof value.localStart !== 'string'
        || typeof value.localEnd !== 'string'
        || !LOCAL_TIME_PATTERN.test(value.localStart)
        || !LOCAL_TIME_PATTERN.test(value.localEnd)
        || value.localEnd <= value.localStart
        || !isResolvedDateRange(value.effectiveRange, 'inherit-course')
        || JSON.stringify(canonicalLocation(value.location)) !== JSON.stringify(value.location)
        || !isCanonicalUnsignedSqliteInteger(value.entityVersion)) {
        return false;
    }
    return true;
}

/**
 * Validates the exact path-free Course projection crossing the Workspace boundary.
 */
export function isCourseProjection(value: unknown): value is CourseProjection {
    if (!hasExactDataKeys(value, [
        'courseId',
        'termId',
        'code',
        'name',
        'section',
        'instructor',
        'color',
        'credits',
        'teachingRange',
        'archived',
        'entityVersion',
        'meetings',
    ])
        || !isCanonicalUuid(value.courseId)
        || !isCanonicalUuid(value.termId)
        || canonicalText(value.code, 32) !== value.code
        || canonicalText(value.name, 120) !== value.name
        || canonicalOptionalText(value.section, 64) !== value.section
        || canonicalOptionalText(value.instructor, 120) !== value.instructor
        || (value.color !== null && !COURSE_COLORS.has(value.color as CourseColor))
        || canonicalCredits(value.credits) !== value.credits
        || !isResolvedDateRange(value.teachingRange, 'inherit-term')
        || typeof value.archived !== 'boolean'
        || !isCanonicalUnsignedSqliteInteger(value.entityVersion)
        || !Array.isArray(value.meetings)
        || !value.meetings.every(isMeetingSeriesProjection)) {
        return false;
    }

    const teachingRange = value.teachingRange;
    return value.meetings.every((meeting: MeetingSeriesProjection) => (
        meeting.effectiveRange.startDate >= teachingRange.startDate
        && meeting.effectiveRange.endDate <= teachingRange.endDate
        && (meeting.effectiveRange.kind !== 'inherit-course'
            || (meeting.effectiveRange.startDate === teachingRange.startDate
                && meeting.effectiveRange.endDate === teachingRange.endDate))
    ));
}

/**
 * Normalizes an untrusted Course and first Meeting command before domain or DATA work.
 */
export function normalizeCreateCourseWithMeetingCommand(value: unknown): CreateCourseWithMeetingCommand {
    if (!hasExactDataKeys(value, [
        'commandId',
        'followUpId',
        'expectedRevision',
        'expectedPlanVersion',
        'intent',
    ])
        || !isCanonicalUuid(value.commandId)
        || !isCanonicalUuid(value.followUpId)
        || !isCanonicalUnsignedSqliteInteger(value.expectedRevision)
        || !isCanonicalUnsignedSqliteInteger(value.expectedPlanVersion)
        || !hasExactDataKeys(value.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || value.intent.kind !== 'plan.create-course-with-first-meeting'
        || value.intent.intentSchemaVersion !== 2
        || !hasExactDataKeys(value.intent.payload, ['course', 'meeting'])
        || !hasExactDataKeys(value.intent.payload.course, [
            'code',
            'name',
            'section',
            'instructor',
            'color',
            'credits',
            'teachingRange',
        ])
        || !hasExactDataKeys(value.intent.payload.meeting, [
            'type',
            'weekday',
            'localStart',
            'localEnd',
            'effectiveRange',
            'location',
        ])) {
        throw new TypeError('CreateCourseWithMeetingCommand has invalid fields');
    }

    const course = value.intent.payload.course;
    const meeting = value.intent.payload.meeting;
    const code = canonicalText(course.code, 32);
    const name = canonicalText(course.name, 120);
    const section = canonicalOptionalText(course.section, 64);
    const instructor = canonicalOptionalText(course.instructor, 120);
    const color = course.color === null
        ? null
        : COURSE_COLORS.has(course.color as CourseColor)
            ? course.color as CourseColor
            : undefined;
    const credits = canonicalCredits(course.credits);
    const teachingRange = canonicalCourseTeachingRange(course.teachingRange);
    const effectiveRange = canonicalMeetingEffectiveRange(meeting.effectiveRange);
    const location = canonicalLocation(meeting.location);
    if (code === null
        || name === null
        || section === undefined
        || instructor === undefined
        || color === undefined
        || credits === undefined
        || teachingRange === null
        || effectiveRange === null
        || !MEETING_TYPES.has(meeting.type as MeetingTypeCode)
        || !MEETING_WEEKDAYS.has(meeting.weekday as MeetingWeekday)
        || typeof meeting.localStart !== 'string'
        || typeof meeting.localEnd !== 'string'
        || !LOCAL_TIME_PATTERN.test(meeting.localStart)
        || !LOCAL_TIME_PATTERN.test(meeting.localEnd)
        || meeting.localEnd <= meeting.localStart
        || location === null) {
        throw new TypeError('CreateCourseWithMeetingCommand has invalid Course or Meeting facts');
    }

    return {
        commandId: value.commandId,
        followUpId: value.followUpId,
        expectedRevision: value.expectedRevision,
        expectedPlanVersion: value.expectedPlanVersion,
        intent: {
            kind: 'plan.create-course-with-first-meeting',
            intentSchemaVersion: 2,
            payload: {
                course: { code, name, section, instructor, color, credits, teachingRange },
                meeting: {
                    type: meeting.type as MeetingTypeCode,
                    weekday: meeting.weekday as MeetingWeekday,
                    localStart: meeting.localStart,
                    localEnd: meeting.localEnd,
                    effectiveRange,
                    location,
                },
            },
        },
    };
}

/**
 * Decodes the published schema-1 command only so migrated receipts remain replayable.
 */
export function normalizeLegacyCreateCourseWithMeetingCommand(
    value: unknown,
): LegacyCreateCourseWithMeetingCommand {
    if (!hasExactDataKeys(value, [
        'commandId',
        'followUpId',
        'expectedRevision',
        'expectedPlanVersion',
        'intent',
    ])
        || !hasExactDataKeys(value.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || value.intent.kind !== 'plan.create-course-with-first-meeting'
        || value.intent.intentSchemaVersion !== 1
        || !hasExactDataKeys(value.intent.payload, ['course', 'meeting'])
        || !hasExactDataKeys(value.intent.payload.course, [
            'code',
            'name',
            'section',
            'instructor',
            'color',
            'credits',
        ])
        || !hasExactDataKeys(value.intent.payload.meeting, [
            'type',
            'weekday',
            'localStart',
            'localEnd',
            'effectiveStartDate',
            'effectiveEndDate',
            'location',
        ])) {
        throw new TypeError('Legacy CreateCourseWithMeetingCommand has invalid fields');
    }

    const legacyCourse = value.intent.payload.course;
    const legacyMeeting = value.intent.payload.meeting;
    const normalized = normalizeCreateCourseWithMeetingCommand({
        commandId: value.commandId,
        followUpId: value.followUpId,
        expectedRevision: value.expectedRevision,
        expectedPlanVersion: value.expectedPlanVersion,
        intent: {
            kind: 'plan.create-course-with-first-meeting',
            intentSchemaVersion: 2,
            payload: {
                course: {
                    ...legacyCourse,
                    teachingRange: { kind: 'inherit-term' },
                },
                meeting: {
                    type: legacyMeeting.type,
                    weekday: legacyMeeting.weekday,
                    localStart: legacyMeeting.localStart,
                    localEnd: legacyMeeting.localEnd,
                    effectiveRange: {
                        kind: 'explicit',
                        startDate: legacyMeeting.effectiveStartDate,
                        endDate: legacyMeeting.effectiveEndDate,
                    },
                    location: legacyMeeting.location,
                },
            },
        },
    });
    const course = normalized.intent.payload.course;
    const meeting = normalized.intent.payload.meeting;
    if (meeting.effectiveRange.kind !== 'explicit') {
        throw new TypeError('Legacy Meeting range must remain explicit');
    }
    return {
        commandId: normalized.commandId,
        followUpId: normalized.followUpId,
        expectedRevision: normalized.expectedRevision,
        expectedPlanVersion: normalized.expectedPlanVersion,
        intent: {
            kind: 'plan.create-course-with-first-meeting',
            intentSchemaVersion: 1,
            payload: {
                course: {
                    code: course.code,
                    name: course.name,
                    section: course.section,
                    instructor: course.instructor,
                    color: course.color,
                    credits: course.credits,
                },
                meeting: {
                    type: meeting.type,
                    weekday: meeting.weekday,
                    localStart: meeting.localStart,
                    localEnd: meeting.localEnd,
                    effectiveStartDate: meeting.effectiveRange.startDate,
                    effectiveEndDate: meeting.effectiveRange.endDate,
                    location: meeting.location,
                },
            },
        },
    };
}

/**
 * Accepts current commands and the sole published legacy form needed for receipt replay.
 */
export function normalizeAcceptedCreateCourseWithMeetingCommand(
    value: unknown,
): AcceptedCreateCourseWithMeetingCommand {
    if (hasExactDataKeys(value, [
        'commandId',
        'followUpId',
        'expectedRevision',
        'expectedPlanVersion',
        'intent',
    ])
        && hasExactDataKeys(value.intent, ['kind', 'intentSchemaVersion', 'payload'])
        && value.intent.intentSchemaVersion === 1) {
        return normalizeLegacyCreateCourseWithMeetingCommand(value);
    }
    return normalizeCreateCourseWithMeetingCommand(value);
}

/**
 * Builds the versioned canonical digest projection for Course and first Meeting creation.
 */
export function createCourseWithMeetingDigestProjection(
    command: AcceptedCreateCourseWithMeetingCommand,
): CanonicalValue {
    return {
        encoding: 'courseflow-canonical-json-v1',
        intent: command.intent,
        expectedRevision: command.expectedRevision,
        expectedEntityVersions: [{
            entityKind: 'plan-state',
            entityId: 'singleton',
            version: command.expectedPlanVersion,
        }],
        durableFollowUps: [{
            followUpId: command.followUpId,
            owner: 'protect',
            kind: 'backup-needed-through',
        }],
    };
}
