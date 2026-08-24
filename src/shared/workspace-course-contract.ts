/**
 * @file Defines bounded Course, Meeting rule, and occurrence Workspace contracts.
 */

import type { CanonicalValue } from './canonical-json';
import {
    isCanonicalInstant,
    resolveMeetingOccurrenceTime,
    type MeetingEndDayOffset,
} from './meeting-time';
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

export type MeetingOccurrenceId = Readonly<{
    meetingSeriesId: string;
    originalLogicalAnchor: string;
}>;

export type MeetingOccurrenceWindow = Readonly<{
    startDate: string;
    endDate: string;
}>;

export type MeetingRuleReplacement = Readonly<{
    type: MeetingTypeCode;
    weekday: MeetingWeekday;
    localStart: string;
    localEnd: string;
    endDayOffset: MeetingEndDayOffset;
    location: MeetingLocation;
}>;

type LegacyMeetingRuleReplacement = Readonly<Omit<MeetingRuleReplacement, 'endDayOffset'>>;

export type MeetingSegmentProjection = Readonly<{
    segmentId: string;
    logicalStartAnchor: string;
    logicalEndAnchor: string | null;
    type: MeetingTypeCode;
    weekday: MeetingWeekday;
    localStart: string;
    localEnd: string;
    endDayOffset: MeetingEndDayOffset;
    location: MeetingLocation;
}>;

export type MeetingOccurrenceProjection = Readonly<{
    occurrenceId: MeetingOccurrenceId;
    segmentId: string;
    date: string;
    status: 'scheduled' | 'cancelled' | 'holiday-suppressed';
    overrideKind: 'replaced' | 'cancelled' | null;
    type: MeetingTypeCode;
    weekday: MeetingWeekday;
    localStart: string;
    localEnd: string;
    endDayOffset: MeetingEndDayOffset;
    startInstant: string;
    endInstant: string;
    location: MeetingLocation;
}>;

export type MeetingOverlapWarning = Readonly<{
    code: 'meeting-time-overlap';
    proposed: Readonly<{
        commandId: string;
        courseId: string | null;
        courseCode: string;
        meetingSeriesId: string | null;
        meetingType: MeetingTypeCode;
        occurrenceId: Readonly<{
            meetingSeriesId: string | null;
            originalLogicalAnchor: string;
        }>;
        startInstant: string;
        endInstant: string;
    }>;
    existing: Readonly<{
        courseId: string;
        courseCode: string;
        meetingSeriesId: string;
        meetingType: MeetingTypeCode;
        occurrenceId: MeetingOccurrenceId;
        startInstant: string;
        endInstant: string;
    }>;
    overlap: Readonly<{
        startInstant: string;
        endInstant: string;
    }>;
}>;

export type MeetingOccurrenceImpactOccurrenceProjection = Readonly<
    Omit<MeetingOccurrenceProjection, 'segmentId'>
>;

export type MeetingSeriesDetailProjection = Readonly<{
    workspaceRevision: string;
    planEntityVersion: string;
    requestedWindow: MeetingOccurrenceWindow;
    termZone: string;
    meetingSeriesId: string;
    courseId: string;
    entityVersion: string;
    segments: readonly MeetingSegmentProjection[];
    occurrences: readonly MeetingOccurrenceProjection[];
}>;

export type MeetingOccurrenceImpactDraft = Readonly<{
    scope: 'this-and-future';
    meetingSeriesId: string;
    originalLogicalAnchor: string;
    replacement: MeetingRuleReplacement;
    requestedWindow: MeetingOccurrenceWindow;
}>;

export type MeetingOccurrenceImpactProjection = Readonly<{
    basedOnRevision: string;
    planEntityVersion: string;
    meetingSeriesVersion: string;
    affectedEntities: readonly [Readonly<{
        kind: 'meeting-series';
        id: string;
        version: string;
    }>];
    effects: readonly [Readonly<{
        code: 'plan.meeting-series-split';
        originalLogicalAnchor: string;
        affectedFutureSegmentCount: string;
        targetOverrideAction: 'none' | 'clear';
        laterOverrideAction: 'retain';
    }>];
    warnings: readonly Readonly<{
        code:
            | 'preview-window-truncated-history'
            | 'preview-window-truncated-future'
            | 'target-override-will-be-cleared';
    }>[];
    choices: readonly [Readonly<{ id: 'apply-this-and-future' }>];
    defaultChoice: Readonly<{ id: 'apply-this-and-future' }>;
    recoverability: Readonly<{
        kind: 'permanent';
        reason: 'meeting-rule-split-has-no-undo';
    }>;
    unresolvedReferences: readonly [];
    scope: 'this-and-future';
    meetingSeriesId: string;
    originalLogicalAnchor: string;
    requestedWindow: MeetingOccurrenceWindow;
    replacement: MeetingRuleReplacement;
    targetDateAfterChange: string;
    targetOverrideKind: 'none' | 'replaced' | 'cancelled';
    affectedFutureSegmentCount: string;
    futureOverrideCount: string;
    historicalOccurrences: readonly MeetingOccurrenceProjection[];
    currentFutureOccurrences: readonly MeetingOccurrenceProjection[];
    futureOccurrencesAfterChange: readonly MeetingOccurrenceImpactOccurrenceProjection[];
    historyOutsideRequestedWindow: boolean;
    futureOutsideRequestedWindow: boolean;
    attendanceRecordCount: '0';
    explicitGradeReferenceCount: '0';
    confirmationToken: string;
}>;

export type LegacyChangeMeetingOccurrenceCommand = Readonly<{
    commandId: string;
    followUpId: string;
    confirmationToken: string | null;
    impactWindow: MeetingOccurrenceWindow | null;
    expectedRevision: string;
    expectedPlanVersion: string;
    expectedMeetingSeriesVersion: string;
    intent: Readonly<{
        kind: 'plan.change-meeting-occurrence';
        intentSchemaVersion: 1;
        payload: Readonly<{
            meetingSeriesId: string;
            originalLogicalAnchor: string;
            scope: 'only-this' | 'this-and-future';
            replacement: LegacyMeetingRuleReplacement;
        }>;
    }>;
}>;

export type ChangeMeetingOccurrenceCommand = Readonly<{
    commandId: string;
    followUpId: string;
    confirmationToken: string | null;
    impactWindow: MeetingOccurrenceWindow | null;
    overlapDecision: 'review' | 'continue';
    expectedRevision: string;
    expectedPlanVersion: string;
    expectedMeetingSeriesVersion: string;
    intent: Readonly<{
        kind: 'plan.change-meeting-occurrence';
        intentSchemaVersion: 2;
        payload: Readonly<{
            meetingSeriesId: string;
            originalLogicalAnchor: string;
            scope: 'only-this' | 'this-and-future';
            replacement: MeetingRuleReplacement;
        }>;
    }>;
}>;

export type AcceptedChangeMeetingOccurrenceCommand =
    | LegacyChangeMeetingOccurrenceCommand
    | ChangeMeetingOccurrenceCommand;

export type CancelMeetingOccurrenceCommand = Readonly<{
    commandId: string;
    followUpId: string;
    expectedRevision: string;
    expectedPlanVersion: string;
    expectedMeetingSeriesVersion: string;
    intent: Readonly<{
        kind: 'plan.cancel-meeting-occurrence';
        intentSchemaVersion: 1;
        payload: Readonly<{
            meetingSeriesId: string;
            originalLogicalAnchor: string;
        }>;
    }>;
}>;

export type MeetingSeriesProjection = Readonly<{
    meetingSeriesId: string;
    type: Readonly<{ code: MeetingTypeCode; name: 'Lecture' | 'Tutorial' | 'Practical' }>;
    weekday: MeetingWeekday;
    localStart: string;
    localEnd: string;
    endDayOffset: MeetingEndDayOffset;
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

export type LegacyCreateCourseWithMeetingCommandV2 = Readonly<{
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

export type CreateCourseWithMeetingCommand = Readonly<{
    commandId: string;
    followUpId: string;
    overlapDecision: 'review' | 'continue';
    expectedRevision: string;
    expectedPlanVersion: string;
    intent: Readonly<{
        kind: 'plan.create-course-with-first-meeting';
        intentSchemaVersion: 3;
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
                endDayOffset: MeetingEndDayOffset;
                effectiveRange: MeetingEffectiveRangeIntent;
                location: MeetingLocation;
            }>;
        }>;
    }>;
}>;

export type AcceptedCreateCourseWithMeetingCommand =
    | LegacyCreateCourseWithMeetingCommand
    | LegacyCreateCourseWithMeetingCommandV2
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
const CONFIRMATION_TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const SQLITE_INTEGER_MAX = 9223372036854775807n;
const MILLISECONDS_PER_DAY = 86_400_000;
export const MAX_MEETING_OCCURRENCE_WINDOW_DAYS = 366;
export const MAX_MEETING_OVERLAP_WARNINGS = 4_096;
const MAX_MEETING_OCCURRENCE_ITEMS = MAX_MEETING_OCCURRENCE_WINDOW_DAYS + 1;
const MAX_MEETING_SEGMENT_ITEMS = MAX_MEETING_OCCURRENCE_WINDOW_DAYS + 13;
const MEETING_WEEKDAY_NUMBERS: Readonly<Record<MeetingWeekday, number>> = Object.freeze({
    SUN: 0,
    MON: 1,
    TUE: 2,
    WED: 3,
    THU: 4,
    FRI: 5,
    SAT: 6,
});

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
 * Rejects sparse arrays and arrays carrying extra structured-clone properties.
 * @param {unknown} value - Candidate array crossing the Workspace boundary.
 * @return {boolean} Whether every numeric slot is an enumerable data property and no extras exist.
 */
function isDenseArray(value: unknown): value is unknown[] {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
        return false;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== value.length + 1) {
        return false;
    }
    return Array.from({ length: value.length }, (_, index) => String(index)).every(key => {
        const descriptor = descriptors[key];
        return descriptor !== undefined && 'value' in descriptor && descriptor.enumerable;
    });
}

/**
 * Reconstructs the physical date represented by a stable anchor and effective weekday.
 * @param {string} originalLogicalAnchor - Stable weekly anchor carried by the occurrence ID.
 * @param {MeetingWeekday} weekday - Effective weekday after any replacement.
 * @return {string | null} Canonical physical date, or null when it would exceed LocalDate.
 */
function projectedMeetingOccurrenceDate(
    originalLogicalAnchor: string,
    weekday: MeetingWeekday,
): string | null {
    if (!MEETING_WEEKDAYS.has(weekday)) {
        return null;
    }
    const anchorMilliseconds = Date.parse(`${originalLogicalAnchor}T00:00:00.000Z`);
    const anchorWeekday = new Date(anchorMilliseconds).getUTCDay();
    const milliseconds = anchorMilliseconds
        + (MEETING_WEEKDAY_NUMBERS[weekday] - anchorWeekday) * MILLISECONDS_PER_DAY;
    const minimum = Date.parse('0000-01-01T00:00:00.000Z');
    const maximum = Date.parse('9999-12-31T00:00:00.000Z');
    return milliseconds < minimum || milliseconds > maximum
        ? null
        : new Date(milliseconds).toISOString().slice(0, 10);
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
 * Checks a location without serializing untrusted structured-clone input.
 * @param {unknown} value - Candidate location DTO.
 * @return {boolean} Whether the value is already in canonical DTO form.
 */
function isCanonicalLocation(value: unknown): value is MeetingLocation {
    const canonical = canonicalLocation(value);
    if (canonical === null) {
        return false;
    }
    return canonical.kind === 'tba'
        ? hasExactDataKeys(value, ['kind']) && value.kind === canonical.kind
        : hasExactDataKeys(value, ['kind', 'value'])
            && value.kind === canonical.kind
            && value.value === canonical.value;
}

/**
 * Canonicalizes the exact replacement rule carried by occurrence edits.
 * @param {unknown} value - Candidate replacement DTO.
 * @return {MeetingRuleReplacement | null} Canonical replacement, or null when invalid.
 */
function canonicalMeetingRuleReplacement(value: unknown): MeetingRuleReplacement | null {
    if (!hasExactDataKeys(value, [
        'type',
        'weekday',
        'localStart',
        'localEnd',
        'endDayOffset',
        'location',
    ])) {
        return null;
    }
    const location = canonicalLocation(value.location);
    if (!MEETING_TYPES.has(value.type as MeetingTypeCode)
        || !MEETING_WEEKDAYS.has(value.weekday as MeetingWeekday)
        || typeof value.localStart !== 'string'
        || typeof value.localEnd !== 'string'
        || !LOCAL_TIME_PATTERN.test(value.localStart)
        || !LOCAL_TIME_PATTERN.test(value.localEnd)
        || (value.endDayOffset !== 0 && value.endDayOffset !== 1)
        || (value.endDayOffset === 0 && value.localEnd <= value.localStart)
        || location === null) {
        return null;
    }
    return {
        type: value.type as MeetingTypeCode,
        weekday: value.weekday as MeetingWeekday,
        localStart: value.localStart,
        localEnd: value.localEnd,
        endDayOffset: value.endDayOffset,
        location,
    };
}

/**
 * Canonicalizes the published same-day replacement shape for receipt replay.
 * @param {unknown} value - Candidate legacy replacement DTO.
 * @return {LegacyMeetingRuleReplacement | null} Canonical legacy replacement, or null.
 */
function canonicalLegacyMeetingRuleReplacement(value: unknown): LegacyMeetingRuleReplacement | null {
    if (!hasExactDataKeys(value, ['type', 'weekday', 'localStart', 'localEnd', 'location'])) {
        return null;
    }
    const current = canonicalMeetingRuleReplacement({ ...value, endDayOffset: 0 });
    if (current === null) {
        return null;
    }
    return {
        type: current.type,
        weekday: current.weekday,
        localStart: current.localStart,
        localEnd: current.localEnd,
        location: current.location,
    };
}

/**
 * Checks a replacement rule without serializing untrusted structured-clone input.
 * @param {unknown} value - Candidate replacement DTO.
 * @return {boolean} Whether the replacement is already in canonical DTO form.
 */
function isCanonicalMeetingRuleReplacement(value: unknown): value is MeetingRuleReplacement {
    const canonical = canonicalMeetingRuleReplacement(value);
    return canonical !== null
        && hasExactDataKeys(value, [
            'type',
            'weekday',
            'localStart',
            'localEnd',
            'endDayOffset',
            'location',
        ])
        && value.type === canonical.type
        && value.weekday === canonical.weekday
        && value.localStart === canonical.localStart
        && value.localEnd === canonical.localEnd
        && value.endDayOffset === canonical.endDayOffset
        && isCanonicalLocation(value.location);
}

/**
 * Derives the ADR-04 logical occurrence identity without introducing a stored occurrence row.
 * @param {string} meetingSeriesId - Stable Meeting series identity.
 * @param {string} originalLogicalAnchor - Canonical original weekly anchor.
 * @return {MeetingOccurrenceId} Frozen stable tuple identity.
 */
export function deriveMeetingOccurrenceId(
    meetingSeriesId: string,
    originalLogicalAnchor: string,
): MeetingOccurrenceId {
    if (!isCanonicalUuid(meetingSeriesId) || !isCanonicalLocalDate(originalLogicalAnchor)) {
        throw new TypeError('MeetingOccurrenceId requires a canonical series and logical anchor');
    }
    return Object.freeze({ meetingSeriesId, originalLogicalAnchor });
}

/**
 * Normalizes the bounded physical-date window used to expand Meeting occurrences.
 * @param {unknown} value - Untrusted candidate window.
 * @return {MeetingOccurrenceWindow} Frozen canonical window.
 */
export function normalizeMeetingOccurrenceWindow(value: unknown): MeetingOccurrenceWindow {
    if (!isMeetingOccurrenceWindow(value)) {
        throw new TypeError('Meeting occurrence window must be canonical and bounded');
    }
    return Object.freeze({ startDate: value.startDate, endDate: value.endDate });
}

/**
 * Validates the exact bounded physical-date window used to expand Meeting occurrences.
 * @param {unknown} value - Untrusted candidate window.
 * @return {boolean} Whether the window is exact, canonical, ordered, and bounded.
 */
export function isMeetingOccurrenceWindow(value: unknown): value is MeetingOccurrenceWindow {
    if (!hasExactDataKeys(value, ['startDate', 'endDate'])
        || !isCanonicalLocalDate(value.startDate)) {
        return false;
    }
    return isCanonicalLocalDate(value.endDate)
        && value.endDate >= value.startDate
        && (Date.parse(`${value.endDate}T00:00:00.000Z`)
            - Date.parse(`${value.startDate}T00:00:00.000Z`)) / MILLISECONDS_PER_DAY
        <= MAX_MEETING_OCCURRENCE_WINDOW_DAYS;
}

/**
 * Validates one exact user-facing Meeting overlap warning.
 * @param {unknown} value - Untrusted warning DTO.
 * @return {boolean} Whether object identities and every Instant window are coherent.
 */
export function isMeetingOverlapWarning(value: unknown): value is MeetingOverlapWarning {
    if (!hasExactDataKeys(value, ['code', 'proposed', 'existing', 'overlap'])
        || value.code !== 'meeting-time-overlap'
        || !hasExactDataKeys(value.proposed, [
            'commandId',
            'courseId',
            'courseCode',
            'meetingSeriesId',
            'meetingType',
            'occurrenceId',
            'startInstant',
            'endInstant',
        ])
        || !hasExactDataKeys(value.existing, [
            'courseId',
            'courseCode',
            'meetingSeriesId',
            'meetingType',
            'occurrenceId',
            'startInstant',
            'endInstant',
        ])
        || !hasExactDataKeys(value.proposed.occurrenceId, [
            'meetingSeriesId',
            'originalLogicalAnchor',
        ])
        || !hasExactDataKeys(value.existing.occurrenceId, [
            'meetingSeriesId',
            'originalLogicalAnchor',
        ])
        || !hasExactDataKeys(value.overlap, ['startInstant', 'endInstant'])) {
        return false;
    }
    const proposed = value.proposed as Record<string, unknown>;
    const existing = value.existing as Record<string, unknown>;
    const overlap = value.overlap as Record<string, unknown>;
    const proposedOccurrenceId = proposed.occurrenceId as Record<string, unknown>;
    const existingOccurrenceId = existing.occurrenceId as Record<string, unknown>;
    const proposedStart = proposed.startInstant;
    const proposedEnd = proposed.endInstant;
    const existingStart = existing.startInstant;
    const existingEnd = existing.endInstant;
    const overlapStart = overlap.startInstant;
    const overlapEnd = overlap.endInstant;
    return isCanonicalUuid(proposed.commandId)
        && (proposed.courseId === null || isCanonicalUuid(proposed.courseId))
        && typeof proposed.courseCode === 'string'
        && proposed.courseCode.length > 0
        && proposed.courseCode.length <= 32
        && proposed.courseCode === proposed.courseCode.trim()
        && (proposed.meetingSeriesId === null || isCanonicalUuid(proposed.meetingSeriesId))
        && (proposed.courseId === null) === (proposed.meetingSeriesId === null)
        && MEETING_TYPES.has(proposed.meetingType as MeetingTypeCode)
        && proposedOccurrenceId.meetingSeriesId === proposed.meetingSeriesId
        && isCanonicalLocalDate(proposedOccurrenceId.originalLogicalAnchor)
        && isCanonicalUuid(existing.courseId)
        && typeof existing.courseCode === 'string'
        && existing.courseCode.length > 0
        && existing.courseCode.length <= 32
        && existing.courseCode === existing.courseCode.trim()
        && isCanonicalUuid(existing.meetingSeriesId)
        && MEETING_TYPES.has(existing.meetingType as MeetingTypeCode)
        && existingOccurrenceId.meetingSeriesId === existing.meetingSeriesId
        && isCanonicalLocalDate(existingOccurrenceId.originalLogicalAnchor)
        && typeof proposedStart === 'string'
        && typeof proposedEnd === 'string'
        && typeof existingStart === 'string'
        && typeof existingEnd === 'string'
        && typeof overlapStart === 'string'
        && typeof overlapEnd === 'string'
        && isCanonicalInstant(proposedStart)
        && isCanonicalInstant(proposedEnd)
        && isCanonicalInstant(existingStart)
        && isCanonicalInstant(existingEnd)
        && isCanonicalInstant(overlapStart)
        && isCanonicalInstant(overlapEnd)
        && proposedStart < proposedEnd
        && existingStart < existingEnd
        && overlapStart < overlapEnd
        && overlapStart >= proposedStart
        && overlapStart >= existingStart
        && overlapEnd <= proposedEnd
        && overlapEnd <= existingEnd
        && overlapStart === (proposedStart > existingStart ? proposedStart : existingStart)
        && overlapEnd === (proposedEnd < existingEnd ? proposedEnd : existingEnd);
}

/**
 * Decodes the published schema-1 occurrence change for receipt replay.
 * @param {unknown} value - Untrusted command DTO.
 * @return {LegacyChangeMeetingOccurrenceCommand} Canonical legacy occurrence change.
 */
export function normalizeLegacyChangeMeetingOccurrenceCommand(
    value: unknown,
): LegacyChangeMeetingOccurrenceCommand {
    if (!hasExactDataKeys(value, [
        'commandId',
        'followUpId',
        'confirmationToken',
        'impactWindow',
        'expectedRevision',
        'expectedPlanVersion',
        'expectedMeetingSeriesVersion',
        'intent',
    ])
        || !isCanonicalUuid(value.commandId)
        || !isCanonicalUuid(value.followUpId)
        || (value.confirmationToken !== null
            && (typeof value.confirmationToken !== 'string'
                || !CONFIRMATION_TOKEN_PATTERN.test(value.confirmationToken)))
        || (value.impactWindow !== null && !isMeetingOccurrenceWindow(value.impactWindow))
        || !isCanonicalUnsignedSqliteInteger(value.expectedRevision)
        || !isCanonicalUnsignedSqliteInteger(value.expectedPlanVersion)
        || !isCanonicalUnsignedSqliteInteger(value.expectedMeetingSeriesVersion)
        || !hasExactDataKeys(value.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || value.intent.kind !== 'plan.change-meeting-occurrence'
        || value.intent.intentSchemaVersion !== 1
        || !hasExactDataKeys(value.intent.payload, [
            'meetingSeriesId',
            'originalLogicalAnchor',
            'scope',
            'replacement',
        ])) {
        throw new TypeError('ChangeMeetingOccurrenceCommand has invalid fields');
    }

    const payload = value.intent.payload;
    const replacement = canonicalLegacyMeetingRuleReplacement(payload.replacement);
    if (!isCanonicalUuid(payload.meetingSeriesId)
        || !isCanonicalLocalDate(payload.originalLogicalAnchor)
        || (payload.scope !== 'only-this' && payload.scope !== 'this-and-future')
        || replacement === null
        || (payload.scope === 'only-this'
            && (value.confirmationToken !== null || value.impactWindow !== null))
        || (payload.scope === 'this-and-future'
            && ((value.confirmationToken === null) !== (value.impactWindow === null)))) {
        throw new TypeError('ChangeMeetingOccurrenceCommand has invalid occurrence facts');
    }

    return {
        commandId: value.commandId,
        followUpId: value.followUpId,
        confirmationToken: value.confirmationToken,
        impactWindow: value.impactWindow === null
            ? null
            : Object.freeze({ ...value.impactWindow }),
        expectedRevision: value.expectedRevision,
        expectedPlanVersion: value.expectedPlanVersion,
        expectedMeetingSeriesVersion: value.expectedMeetingSeriesVersion,
        intent: {
            kind: 'plan.change-meeting-occurrence',
            intentSchemaVersion: 1,
            payload: {
                meetingSeriesId: payload.meetingSeriesId,
                originalLogicalAnchor: payload.originalLogicalAnchor,
                scope: payload.scope,
                replacement,
            },
        },
    };
}

/**
 * Normalizes an exact occurrence change before DATA evaluates its edit scope.
 * @param {unknown} value - Untrusted command DTO.
 * @return {ChangeMeetingOccurrenceCommand} Canonical current occurrence change.
 */
export function normalizeChangeMeetingOccurrenceCommand(value: unknown): ChangeMeetingOccurrenceCommand {
    if (!hasExactDataKeys(value, [
        'commandId',
        'followUpId',
        'confirmationToken',
        'impactWindow',
        'overlapDecision',
        'expectedRevision',
        'expectedPlanVersion',
        'expectedMeetingSeriesVersion',
        'intent',
    ])
        || !isCanonicalUuid(value.commandId)
        || !isCanonicalUuid(value.followUpId)
        || (value.confirmationToken !== null
            && (typeof value.confirmationToken !== 'string'
                || !CONFIRMATION_TOKEN_PATTERN.test(value.confirmationToken)))
        || (value.impactWindow !== null && !isMeetingOccurrenceWindow(value.impactWindow))
        || (value.overlapDecision !== 'review' && value.overlapDecision !== 'continue')
        || !isCanonicalUnsignedSqliteInteger(value.expectedRevision)
        || !isCanonicalUnsignedSqliteInteger(value.expectedPlanVersion)
        || !isCanonicalUnsignedSqliteInteger(value.expectedMeetingSeriesVersion)
        || !hasExactDataKeys(value.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || value.intent.kind !== 'plan.change-meeting-occurrence'
        || value.intent.intentSchemaVersion !== 2
        || !hasExactDataKeys(value.intent.payload, [
            'meetingSeriesId',
            'originalLogicalAnchor',
            'scope',
            'replacement',
        ])) {
        throw new TypeError('ChangeMeetingOccurrenceCommand has invalid fields');
    }

    const payload = value.intent.payload;
    const replacement = canonicalMeetingRuleReplacement(payload.replacement);
    if (!isCanonicalUuid(payload.meetingSeriesId)
        || !isCanonicalLocalDate(payload.originalLogicalAnchor)
        || (payload.scope !== 'only-this' && payload.scope !== 'this-and-future')
        || replacement === null
        || (payload.scope === 'only-this'
            && (value.confirmationToken !== null || value.impactWindow !== null))
        || (payload.scope === 'this-and-future'
            && ((value.confirmationToken === null) !== (value.impactWindow === null)))) {
        throw new TypeError('ChangeMeetingOccurrenceCommand has invalid occurrence facts');
    }

    return {
        commandId: value.commandId,
        followUpId: value.followUpId,
        confirmationToken: value.confirmationToken,
        impactWindow: value.impactWindow === null
            ? null
            : Object.freeze({ ...value.impactWindow }),
        overlapDecision: value.overlapDecision,
        expectedRevision: value.expectedRevision,
        expectedPlanVersion: value.expectedPlanVersion,
        expectedMeetingSeriesVersion: value.expectedMeetingSeriesVersion,
        intent: {
            kind: 'plan.change-meeting-occurrence',
            intentSchemaVersion: 2,
            payload: {
                meetingSeriesId: payload.meetingSeriesId,
                originalLogicalAnchor: payload.originalLogicalAnchor,
                scope: payload.scope,
                replacement,
            },
        },
    };
}

/**
 * Accepts current occurrence changes and the published legacy form needed for replay.
 * @param {unknown} value - Untrusted command DTO.
 * @return {AcceptedChangeMeetingOccurrenceCommand} Canonical accepted occurrence change.
 */
export function normalizeAcceptedChangeMeetingOccurrenceCommand(
    value: unknown,
): AcceptedChangeMeetingOccurrenceCommand {
    if (hasExactDataKeys(value, [
        'commandId',
        'followUpId',
        'confirmationToken',
        'impactWindow',
        'expectedRevision',
        'expectedPlanVersion',
        'expectedMeetingSeriesVersion',
        'intent',
    ])) {
        return normalizeLegacyChangeMeetingOccurrenceCommand(value);
    }
    return normalizeChangeMeetingOccurrenceCommand(value);
}

/**
 * Normalizes a bounded whole-rule impact draft before a confirmation token is issued.
 * @param {unknown} value - Untrusted impact draft.
 * @return {MeetingOccurrenceImpactDraft} Frozen canonical future-change preview request.
 */
export function normalizeMeetingOccurrenceImpactDraft(value: unknown): MeetingOccurrenceImpactDraft {
    if (!hasExactDataKeys(value, [
        'scope',
        'meetingSeriesId',
        'originalLogicalAnchor',
        'replacement',
        'requestedWindow',
    ])
        || value.scope !== 'this-and-future'
        || !isCanonicalUuid(value.meetingSeriesId)
        || !isCanonicalLocalDate(value.originalLogicalAnchor)
        || !isMeetingOccurrenceWindow(value.requestedWindow)) {
        throw new TypeError('Meeting occurrence impact draft has invalid fields');
    }
    const replacement = canonicalMeetingRuleReplacement(value.replacement);
    if (replacement === null) {
        throw new TypeError('Meeting occurrence impact draft has invalid replacement facts');
    }
    return Object.freeze({
        scope: 'this-and-future',
        meetingSeriesId: value.meetingSeriesId,
        originalLogicalAnchor: value.originalLogicalAnchor,
        replacement: Object.freeze(replacement),
        requestedWindow: Object.freeze({ ...value.requestedWindow }),
    });
}

/**
 * Normalizes the bounded only-this cancellation command.
 * @param {unknown} value - Untrusted command DTO.
 * @return {CancelMeetingOccurrenceCommand} Canonical versioned cancellation command.
 */
export function normalizeCancelMeetingOccurrenceCommand(value: unknown): CancelMeetingOccurrenceCommand {
    if (!hasExactDataKeys(value, [
        'commandId',
        'followUpId',
        'expectedRevision',
        'expectedPlanVersion',
        'expectedMeetingSeriesVersion',
        'intent',
    ])
        || !isCanonicalUuid(value.commandId)
        || !isCanonicalUuid(value.followUpId)
        || !isCanonicalUnsignedSqliteInteger(value.expectedRevision)
        || !isCanonicalUnsignedSqliteInteger(value.expectedPlanVersion)
        || !isCanonicalUnsignedSqliteInteger(value.expectedMeetingSeriesVersion)
        || !hasExactDataKeys(value.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || value.intent.kind !== 'plan.cancel-meeting-occurrence'
        || value.intent.intentSchemaVersion !== 1
        || !hasExactDataKeys(value.intent.payload, ['meetingSeriesId', 'originalLogicalAnchor'])
        || !isCanonicalUuid(value.intent.payload.meetingSeriesId)
        || !isCanonicalLocalDate(value.intent.payload.originalLogicalAnchor)) {
        throw new TypeError('CancelMeetingOccurrenceCommand has invalid fields');
    }

    return {
        commandId: value.commandId,
        followUpId: value.followUpId,
        expectedRevision: value.expectedRevision,
        expectedPlanVersion: value.expectedPlanVersion,
        expectedMeetingSeriesVersion: value.expectedMeetingSeriesVersion,
        intent: {
            kind: 'plan.cancel-meeting-occurrence',
            intentSchemaVersion: 1,
            payload: {
                meetingSeriesId: value.intent.payload.meetingSeriesId,
                originalLogicalAnchor: value.intent.payload.originalLogicalAnchor,
            },
        },
    };
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
        'endDayOffset',
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
        || (value.endDayOffset !== 0 && value.endDayOffset !== 1)
        || (value.endDayOffset === 0 && value.localEnd <= value.localStart)
        || !isResolvedDateRange(value.effectiveRange, 'inherit-course')
        || !isCanonicalLocation(value.location)
        || !isCanonicalUnsignedSqliteInteger(value.entityVersion)) {
        return false;
    }
    return true;
}

/**
 * Validates the shared exact Meeting rule fields used by segment and occurrence DTOs.
 * @param {Record<string, unknown>} value - Candidate DTO containing Meeting rule fields.
 * @return {boolean} Whether every rule field is canonical and internally ordered.
 */
function hasValidMeetingRuleFields(value: Record<string, unknown>): boolean {
    return MEETING_TYPES.has(value.type as MeetingTypeCode)
        && MEETING_WEEKDAYS.has(value.weekday as MeetingWeekday)
        && typeof value.localStart === 'string'
        && typeof value.localEnd === 'string'
        && LOCAL_TIME_PATTERN.test(value.localStart)
        && LOCAL_TIME_PATTERN.test(value.localEnd)
        && (value.endDayOffset === 0 || value.endDayOffset === 1)
        && (value.endDayOffset === 1 || value.localEnd > value.localStart)
        && isCanonicalLocation(value.location);
}

/**
 * Validates one exact non-overlapping-ready Meeting segment DTO.
 * @param {unknown} value - Untrusted segment projection.
 * @return {boolean} Whether the segment fields are canonical.
 */
function isMeetingSegmentProjection(value: unknown): value is MeetingSegmentProjection {
    return hasExactDataKeys(value, [
        'segmentId',
        'logicalStartAnchor',
        'logicalEndAnchor',
        'type',
        'weekday',
        'localStart',
        'localEnd',
        'endDayOffset',
        'location',
    ])
        && isCanonicalUuid(value.segmentId)
        && isCanonicalLocalDate(value.logicalStartAnchor)
        && (value.logicalEndAnchor === null
            || (isCanonicalLocalDate(value.logicalEndAnchor)
                && value.logicalEndAnchor >= value.logicalStartAnchor))
        && hasValidMeetingRuleFields(value);
}

/**
 * Validates one exact derived Meeting occurrence DTO including physical-date coherence.
 * @param {unknown} value - Untrusted occurrence projection.
 * @return {boolean} Whether identity, status, date, and rule fields are coherent.
 */
function isMeetingOccurrenceProjection(value: unknown): value is MeetingOccurrenceProjection {
    if (!hasExactDataKeys(value, [
        'occurrenceId',
        'segmentId',
        'date',
        'status',
        'overrideKind',
        'type',
        'weekday',
        'localStart',
        'localEnd',
        'endDayOffset',
        'startInstant',
        'endInstant',
        'location',
    ])
        || !hasExactDataKeys(value.occurrenceId, ['meetingSeriesId', 'originalLogicalAnchor'])
        || !isCanonicalUuid(value.occurrenceId.meetingSeriesId)
        || !isCanonicalLocalDate(value.occurrenceId.originalLogicalAnchor)
        || !isCanonicalUuid(value.segmentId)
        || !isCanonicalLocalDate(value.date)
        || !hasValidMeetingRuleFields(value)
        || !isCanonicalInstant(value.startInstant)
        || !isCanonicalInstant(value.endInstant)
        || value.endInstant <= value.startInstant
        || projectedMeetingOccurrenceDate(
            value.occurrenceId.originalLogicalAnchor,
            value.weekday as MeetingWeekday,
        ) !== value.date) {
        return false;
    }
    return (value.status === 'scheduled'
        && (value.overrideKind === null || value.overrideKind === 'replaced'))
        || (value.status === 'cancelled' && value.overrideKind === 'cancelled')
        || (value.status === 'holiday-suppressed' && value.overrideKind === null);
}

/**
 * Validates the path-free occurrence shape used by the proposed-after impact list.
 * @param {unknown} value - Untrusted impact occurrence projection.
 * @return {boolean} Whether identity, status, date, and rule fields are coherent.
 */
function isMeetingOccurrenceImpactOccurrenceProjection(
    value: unknown,
): value is MeetingOccurrenceImpactOccurrenceProjection {
    if (!hasExactDataKeys(value, [
        'occurrenceId',
        'date',
        'status',
        'overrideKind',
        'type',
        'weekday',
        'localStart',
        'localEnd',
        'endDayOffset',
        'startInstant',
        'endInstant',
        'location',
    ])
        || !hasExactDataKeys(value.occurrenceId, ['meetingSeriesId', 'originalLogicalAnchor'])
        || !isCanonicalUuid(value.occurrenceId.meetingSeriesId)
        || !isCanonicalLocalDate(value.occurrenceId.originalLogicalAnchor)
        || !isCanonicalLocalDate(value.date)
        || !hasValidMeetingRuleFields(value)
        || !isCanonicalInstant(value.startInstant)
        || !isCanonicalInstant(value.endInstant)
        || value.endInstant <= value.startInstant
        || projectedMeetingOccurrenceDate(
            value.occurrenceId.originalLogicalAnchor,
            value.weekday as MeetingWeekday,
        ) !== value.date) {
        return false;
    }
    return (value.status === 'scheduled'
        && (value.overrideKind === null || value.overrideKind === 'replaced'))
        || (value.status === 'cancelled' && value.overrideKind === 'cancelled')
        || (value.status === 'holiday-suppressed' && value.overrideKind === null);
}

/**
 * Checks that projected Instants are derived from the supplied TermZone and local rule fields.
 * @param {MeetingOccurrenceProjection} occurrence - Canonical occurrence projection.
 * @param {string} termZone - Explicit TermZone from the owning series detail.
 * @return {boolean} Whether both projected Instants match the explicit ZoneRules result.
 */
function hasResolvedOccurrenceTime(
    occurrence: MeetingOccurrenceProjection,
    termZone: string,
): boolean {
    try {
        const resolved = resolveMeetingOccurrenceTime({
            termZone,
            date: occurrence.date,
            localStart: occurrence.localStart,
            localEnd: occurrence.localEnd,
            endDayOffset: occurrence.endDayOffset,
        });
        return occurrence.startInstant === resolved.startInstant
            && occurrence.endInstant === resolved.endInstant;
    }
    catch {
        return false;
    }
}

/**
 * Validates a bounded, path-free Meeting series detail projection crossing Workspace IPC.
 * @param {unknown} value - Untrusted Workspace outcome projection.
 * @return {boolean} Whether the detail DTO and segment/occurrence relations are exact.
 */
export function isMeetingSeriesDetailProjection(value: unknown): value is MeetingSeriesDetailProjection {
    if (!hasExactDataKeys(value, [
        'workspaceRevision',
        'planEntityVersion',
        'requestedWindow',
        'termZone',
        'meetingSeriesId',
        'courseId',
        'entityVersion',
        'segments',
        'occurrences',
    ])
        || !isCanonicalUnsignedSqliteInteger(value.workspaceRevision)
        || !isCanonicalUnsignedSqliteInteger(value.planEntityVersion)
        || !isMeetingOccurrenceWindow(value.requestedWindow)
        || typeof value.termZone !== 'string'
        || value.termZone.length === 0
        || !isCanonicalUuid(value.meetingSeriesId)
        || !isCanonicalUuid(value.courseId)
        || !isCanonicalUnsignedSqliteInteger(value.entityVersion)
        || !isDenseArray(value.segments)
        || value.segments.length > MAX_MEETING_SEGMENT_ITEMS
        || !value.segments.every(isMeetingSegmentProjection)
        || !isDenseArray(value.occurrences)
        || value.occurrences.length > MAX_MEETING_OCCURRENCE_ITEMS
        || !value.occurrences.every(isMeetingOccurrenceProjection)) {
        return false;
    }

    const segments = value.segments as MeetingSegmentProjection[];
    const occurrences = value.occurrences as MeetingOccurrenceProjection[];
    const segmentIds = new Set(segments.map(segment => segment.segmentId));
    const segmentsById = new Map(segments.map(segment => [segment.segmentId, segment]));
    const occurrenceKeys = occurrences.map(occurrence => (
        `${occurrence.occurrenceId.meetingSeriesId}:${occurrence.occurrenceId.originalLogicalAnchor}`
    ));
    const requestedWindow = value.requestedWindow as MeetingOccurrenceWindow;
    const termZone = value.termZone as string;
    return segmentIds.size === segments.length
        && segments.every((segment, index) => {
            if (index === 0) {
                return true;
            }
            const previous = segments[index - 1]!;
            return previous.logicalEndAnchor !== null
                && previous.logicalEndAnchor < segment.logicalStartAnchor;
        })
        && new Set(occurrenceKeys).size === occurrenceKeys.length
        && occurrences.every(occurrence => {
            const segment = segmentsById.get(occurrence.segmentId);
            const anchor = occurrence.occurrenceId.originalLogicalAnchor;
            return occurrence.occurrenceId.meetingSeriesId === value.meetingSeriesId
                && segment !== undefined
                && anchor >= segment.logicalStartAnchor
                && (segment.logicalEndAnchor === null || anchor <= segment.logicalEndAnchor)
                && (Date.parse(`${anchor}T00:00:00.000Z`)
                    - Date.parse(`${segment.logicalStartAnchor}T00:00:00.000Z`))
                    % (7 * MILLISECONDS_PER_DAY) === 0
                && occurrence.date >= requestedWindow.startDate
                && occurrence.date <= requestedWindow.endDate
                && hasResolvedOccurrenceTime(occurrence, termZone);
        });
}

/**
 * Validates a bounded whole-rule Meeting impact projection crossing Workspace IPC.
 * @param {unknown} value - Untrusted Workspace impact projection.
 * @return {boolean} Whether the preview is exact, bounded, and internally coherent.
 */
export function isMeetingOccurrenceImpactProjection(
    value: unknown,
): value is MeetingOccurrenceImpactProjection {
    if (!hasExactDataKeys(value, [
        'basedOnRevision',
        'planEntityVersion',
        'meetingSeriesVersion',
        'affectedEntities',
        'effects',
        'warnings',
        'choices',
        'defaultChoice',
        'recoverability',
        'unresolvedReferences',
        'scope',
        'meetingSeriesId',
        'originalLogicalAnchor',
        'requestedWindow',
        'replacement',
        'targetDateAfterChange',
        'targetOverrideKind',
        'affectedFutureSegmentCount',
        'futureOverrideCount',
        'historicalOccurrences',
        'currentFutureOccurrences',
        'futureOccurrencesAfterChange',
        'historyOutsideRequestedWindow',
        'futureOutsideRequestedWindow',
        'attendanceRecordCount',
        'explicitGradeReferenceCount',
        'confirmationToken',
    ])
        || !isCanonicalUnsignedSqliteInteger(value.basedOnRevision)
        || !isCanonicalUnsignedSqliteInteger(value.planEntityVersion)
        || !isCanonicalUnsignedSqliteInteger(value.meetingSeriesVersion)
        || !isDenseArray(value.affectedEntities)
        || value.affectedEntities.length !== 1
        || !hasExactDataKeys(value.affectedEntities[0], ['kind', 'id', 'version'])
        || value.affectedEntities[0].kind !== 'meeting-series'
        || value.affectedEntities[0].id !== value.meetingSeriesId
        || value.affectedEntities[0].version !== value.meetingSeriesVersion
        || !isDenseArray(value.effects)
        || value.effects.length !== 1
        || !hasExactDataKeys(value.effects[0], [
            'code',
            'originalLogicalAnchor',
            'affectedFutureSegmentCount',
            'targetOverrideAction',
            'laterOverrideAction',
        ])
        || value.effects[0].code !== 'plan.meeting-series-split'
        || value.effects[0].originalLogicalAnchor !== value.originalLogicalAnchor
        || value.effects[0].affectedFutureSegmentCount !== value.affectedFutureSegmentCount
        || !['none', 'clear'].includes(value.effects[0].targetOverrideAction as string)
        || value.effects[0].laterOverrideAction !== 'retain'
        || !isDenseArray(value.warnings)
        || value.warnings.length > 3
        || !value.warnings.every(warning => (
            hasExactDataKeys(warning, ['code'])
            && [
                'preview-window-truncated-history',
                'preview-window-truncated-future',
                'target-override-will-be-cleared',
            ].includes(warning.code as string)
        ))
        || !isDenseArray(value.choices)
        || value.choices.length !== 1
        || !hasExactDataKeys(value.choices[0], ['id'])
        || value.choices[0].id !== 'apply-this-and-future'
        || !hasExactDataKeys(value.defaultChoice, ['id'])
        || value.defaultChoice.id !== 'apply-this-and-future'
        || !hasExactDataKeys(value.recoverability, ['kind', 'reason'])
        || value.recoverability.kind !== 'permanent'
        || value.recoverability.reason !== 'meeting-rule-split-has-no-undo'
        || !isDenseArray(value.unresolvedReferences)
        || value.unresolvedReferences.length !== 0
        || value.scope !== 'this-and-future'
        || !isCanonicalUuid(value.meetingSeriesId)
        || !isCanonicalLocalDate(value.originalLogicalAnchor)
        || !isMeetingOccurrenceWindow(value.requestedWindow)
        || !isCanonicalMeetingRuleReplacement(value.replacement)
        || !isCanonicalLocalDate(value.targetDateAfterChange)
        || projectedMeetingOccurrenceDate(
            value.originalLogicalAnchor as string,
            (value.replacement as MeetingRuleReplacement).weekday,
        ) !== value.targetDateAfterChange
        || !['none', 'replaced', 'cancelled'].includes(value.targetOverrideKind as string)
        || !isCanonicalUnsignedSqliteInteger(value.affectedFutureSegmentCount)
        || !isCanonicalUnsignedSqliteInteger(value.futureOverrideCount)
        || !isDenseArray(value.historicalOccurrences)
        || value.historicalOccurrences.length > MAX_MEETING_OCCURRENCE_ITEMS
        || !value.historicalOccurrences.every(isMeetingOccurrenceProjection)
        || !isDenseArray(value.currentFutureOccurrences)
        || value.historicalOccurrences.length + value.currentFutureOccurrences.length
            > MAX_MEETING_OCCURRENCE_ITEMS
        || !value.currentFutureOccurrences.every(isMeetingOccurrenceProjection)
        || !isDenseArray(value.futureOccurrencesAfterChange)
        || value.futureOccurrencesAfterChange.length > MAX_MEETING_OCCURRENCE_ITEMS
        || !value.futureOccurrencesAfterChange.every(isMeetingOccurrenceImpactOccurrenceProjection)
        || typeof value.historyOutsideRequestedWindow !== 'boolean'
        || typeof value.futureOutsideRequestedWindow !== 'boolean'
        || value.attendanceRecordCount !== '0'
        || value.explicitGradeReferenceCount !== '0'
        || typeof value.confirmationToken !== 'string'
        || !CONFIRMATION_TOKEN_PATTERN.test(value.confirmationToken)) {
        return false;
    }
    const occurrences = [...value.historicalOccurrences, ...value.currentFutureOccurrences];
    const keys = occurrences.map(occurrence => occurrence.occurrenceId.originalLogicalAnchor);
    const futureKeys = value.futureOccurrencesAfterChange.map(occurrence => (
        occurrence.occurrenceId.originalLogicalAnchor
    ));
    const warningCodes = (value.warnings as Array<{ code: string }>).map(warning => warning.code);
    const originalLogicalAnchor = value.originalLogicalAnchor as string;
    const requestedWindow = value.requestedWindow as MeetingOccurrenceWindow;
    const targetOverrideKind = value.targetOverrideKind as 'none' | 'replaced' | 'cancelled';
    const targetOverrideAction = (value.effects as Array<{
        targetOverrideAction: 'none' | 'clear';
    }>)[0]!.targetOverrideAction;
    const targetOccurrence = value.currentFutureOccurrences.find(occurrence => (
        occurrence.occurrenceId.originalLogicalAnchor === originalLogicalAnchor
    ));
    const targetAfterChange = value.futureOccurrencesAfterChange.find(occurrence => (
        occurrence.occurrenceId.originalLogicalAnchor === originalLogicalAnchor
    ));
    const replacement = value.replacement as MeetingRuleReplacement;
    const targetAfterChangeIsVisible = value.targetDateAfterChange >= requestedWindow.startDate
        && value.targetDateAfterChange <= requestedWindow.endDate;
    const targetAfterChangeMatches = targetAfterChange !== undefined
        && targetAfterChange.date === value.targetDateAfterChange
        && targetAfterChange.status === 'scheduled'
        && targetAfterChange.overrideKind === null
        && targetAfterChange.type === replacement.type
        && targetAfterChange.weekday === replacement.weekday
        && targetAfterChange.localStart === replacement.localStart
        && targetAfterChange.localEnd === replacement.localEnd
        && targetAfterChange.location.kind === replacement.location.kind
        && (targetAfterChange.location.kind === 'tba'
            || (replacement.location.kind === 'known'
                && targetAfterChange.location.value === replacement.location.value));
    const expectedWarningCodes = [
        ...(value.historyOutsideRequestedWindow ? ['preview-window-truncated-history'] : []),
        ...(value.futureOutsideRequestedWindow ? ['preview-window-truncated-future'] : []),
        ...(targetOverrideKind === 'none' ? [] : ['target-override-will-be-cleared']),
    ];
    return new Set(keys).size === keys.length
        && new Set(futureKeys).size === futureKeys.length
        && new Set(warningCodes).size === warningCodes.length
        && warningCodes.length === expectedWarningCodes.length
        && expectedWarningCodes.every(code => warningCodes.includes(code))
        && targetOverrideAction === (targetOverrideKind === 'none' ? 'none' : 'clear')
        && value.affectedFutureSegmentCount !== '0'
        && targetOccurrence !== undefined
        && (targetOccurrence.overrideKind ?? 'none') === targetOverrideKind
        && (targetAfterChangeIsVisible
            ? targetAfterChangeMatches
            : targetAfterChange === undefined && value.futureOutsideRequestedWindow)
        && occurrences.every(occurrence => (
            occurrence.occurrenceId.meetingSeriesId === value.meetingSeriesId
            && occurrence.date >= requestedWindow.startDate
            && occurrence.date <= requestedWindow.endDate
        ))
        && value.historicalOccurrences.every(occurrence => (
            occurrence.occurrenceId.originalLogicalAnchor < originalLogicalAnchor
        ))
        && value.currentFutureOccurrences.every(occurrence => (
            occurrence.occurrenceId.originalLogicalAnchor >= originalLogicalAnchor
        ))
        && value.futureOccurrencesAfterChange.every(occurrence => (
            occurrence.occurrenceId.meetingSeriesId === value.meetingSeriesId
            && occurrence.occurrenceId.originalLogicalAnchor >= originalLogicalAnchor
            && occurrence.date >= requestedWindow.startDate
            && occurrence.date <= requestedWindow.endDate
        ));
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
 * Decodes the published schema-2 Course command for receipt replay.
 */
export function normalizeLegacyCreateCourseWithMeetingCommandV2(
    value: unknown,
): LegacyCreateCourseWithMeetingCommandV2 {
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
 * Normalizes an untrusted Course and first Meeting command before domain or DATA work.
 * @param {unknown} value - Untrusted command DTO.
 * @return {CreateCourseWithMeetingCommand} Canonical current Course creation command.
 */
export function normalizeCreateCourseWithMeetingCommand(value: unknown): CreateCourseWithMeetingCommand {
    if (!hasExactDataKeys(value, [
        'commandId',
        'followUpId',
        'overlapDecision',
        'expectedRevision',
        'expectedPlanVersion',
        'intent',
    ])
        || !isCanonicalUuid(value.commandId)
        || !isCanonicalUuid(value.followUpId)
        || (value.overlapDecision !== 'review' && value.overlapDecision !== 'continue')
        || !isCanonicalUnsignedSqliteInteger(value.expectedRevision)
        || !isCanonicalUnsignedSqliteInteger(value.expectedPlanVersion)
        || !hasExactDataKeys(value.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || value.intent.kind !== 'plan.create-course-with-first-meeting'
        || value.intent.intentSchemaVersion !== 3
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
            'endDayOffset',
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
        || (meeting.endDayOffset !== 0 && meeting.endDayOffset !== 1)
        || (meeting.endDayOffset === 0 && meeting.localEnd <= meeting.localStart)
        || location === null) {
        throw new TypeError('CreateCourseWithMeetingCommand has invalid Course or Meeting facts');
    }

    return {
        commandId: value.commandId,
        followUpId: value.followUpId,
        overlapDecision: value.overlapDecision,
        expectedRevision: value.expectedRevision,
        expectedPlanVersion: value.expectedPlanVersion,
        intent: {
            kind: 'plan.create-course-with-first-meeting',
            intentSchemaVersion: 3,
            payload: {
                course: { code, name, section, instructor, color, credits, teachingRange },
                meeting: {
                    type: meeting.type as MeetingTypeCode,
                    weekday: meeting.weekday as MeetingWeekday,
                    localStart: meeting.localStart,
                    localEnd: meeting.localEnd,
                    endDayOffset: meeting.endDayOffset,
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
    const normalized = normalizeLegacyCreateCourseWithMeetingCommandV2({
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
        && (value.intent.intentSchemaVersion === 1 || value.intent.intentSchemaVersion === 2)) {
        return value.intent.intentSchemaVersion === 1
            ? normalizeLegacyCreateCourseWithMeetingCommand(value)
            : normalizeLegacyCreateCourseWithMeetingCommandV2(value);
    }
    return normalizeCreateCourseWithMeetingCommand(value);
}

/**
 * Builds the versioned canonical digest projection for Course and first Meeting creation.
 */
export function createCourseWithMeetingDigestProjection(
    command: AcceptedCreateCourseWithMeetingCommand,
): CanonicalValue {
    const projection: Record<string, CanonicalValue> = {
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
    if ('overlapDecision' in command) {
        projection.overlapDecision = command.overlapDecision;
    }
    return projection;
}

/**
 * Builds the canonical receipt digest projection for a scoped Meeting occurrence change.
 * @param {AcceptedChangeMeetingOccurrenceCommand} command - Accepted occurrence change command.
 * @return {CanonicalValue} Canonical payload covered by the durable receipt digest.
 */
export function changeMeetingOccurrenceDigestProjection(
    command: AcceptedChangeMeetingOccurrenceCommand,
): CanonicalValue {
    const projection: Record<string, CanonicalValue> = {
        encoding: 'courseflow-canonical-json-v1',
        intent: command.intent,
        confirmationToken: command.confirmationToken,
        impactWindow: command.impactWindow,
        expectedRevision: command.expectedRevision,
        expectedEntityVersions: [
            {
                entityKind: 'plan-state',
                entityId: 'singleton',
                version: command.expectedPlanVersion,
            },
            {
                entityKind: 'meeting-series',
                entityId: command.intent.payload.meetingSeriesId,
                version: command.expectedMeetingSeriesVersion,
            },
        ],
        durableFollowUps: [{
            followUpId: command.followUpId,
            owner: 'protect',
            kind: 'backup-needed-through',
        }],
    };
    if ('overlapDecision' in command) {
        projection.overlapDecision = command.overlapDecision;
    }
    return projection;
}

/**
 * Builds the canonical receipt digest projection for an only-this cancellation.
 * @param {CancelMeetingOccurrenceCommand} command - Normalized occurrence cancellation command.
 * @return {CanonicalValue} Canonical payload covered by the durable receipt digest.
 */
export function cancelMeetingOccurrenceDigestProjection(
    command: CancelMeetingOccurrenceCommand,
): CanonicalValue {
    return {
        encoding: 'courseflow-canonical-json-v1',
        intent: command.intent,
        expectedRevision: command.expectedRevision,
        expectedEntityVersions: [
            {
                entityKind: 'plan-state',
                entityId: 'singleton',
                version: command.expectedPlanVersion,
            },
            {
                entityKind: 'meeting-series',
                entityId: command.intent.payload.meetingSeriesId,
                version: command.expectedMeetingSeriesVersion,
            },
        ],
        durableFollowUps: [{
            followUpId: command.followUpId,
            owner: 'protect',
            kind: 'backup-needed-through',
        }],
    };
}
