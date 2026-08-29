import { CanonicalValue } from '../canonical-json';
import { MeetingEndDayOffset, resolveMeetingOccurrenceTime } from '../meeting-time';
import { isCanonicalLocation } from './guards';
import { isCanonicalLocalDate } from '../workspace-term-contract';
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

export type LegacyMeetingRuleReplacement = Readonly<Omit<MeetingRuleReplacement, 'endDayOffset'>>;

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

export type CourseCreationFacts = Readonly<{
    code: string;
    name: string;
    section: string | null;
    instructor: string | null;
    color: CourseColor | null;
    credits: string | null;
    teachingRange: CourseTeachingRangeIntent;
}>;

export type MeetingSeriesCreationFacts = Readonly<{
    type: MeetingTypeCode;
    weekday: MeetingWeekday;
    localStart: string;
    localEnd: string;
    endDayOffset: MeetingEndDayOffset;
    effectiveRange: MeetingEffectiveRangeIntent;
    location: MeetingLocation;
}>;

export type CreateCourseCommand = Readonly<{
    commandId: string;
    followUpId: string;
    expectedRevision: string;
    expectedPlanVersion: string;
    intent: Readonly<{
        kind: 'plan.create-course';
        intentSchemaVersion: 1;
        payload: Readonly<{ course: CourseCreationFacts }>;
    }>;
}>;

export type CreateMeetingSeriesCommand = Readonly<{
    commandId: string;
    followUpId: string;
    overlapDecision: 'review' | 'continue';
    expectedRevision: string;
    expectedPlanVersion: string;
    expectedCourseVersion: string;
    intent: Readonly<{
        kind: 'plan.create-meeting-series';
        intentSchemaVersion: 1;
        payload: Readonly<{
            courseId: string;
            meeting: MeetingSeriesCreationFacts;
        }>;
    }>;
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

export const COURSE_COLORS = new Set<CourseColor>([
    'red',
    'orange',
    'yellow',
    'green',
    'blue',
    'purple',
    'gray',
]);

export const MEETING_TYPES = new Set<MeetingTypeCode>(['LEC', 'TUT', 'PRA']);

export const MEETING_WEEKDAYS = new Set<MeetingWeekday>([
    'MON',
    'TUE',
    'WED',
    'THU',
    'FRI',
    'SAT',
    'SUN',
]);

export const LOCAL_TIME_PATTERN = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;

export const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;

export const CONFIRMATION_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export const SQLITE_INTEGER_MAX = 9223372036854775807n;

export const MILLISECONDS_PER_DAY = 86_400_000;

export const MAX_MEETING_OCCURRENCE_WINDOW_DAYS = 366;

export const MAX_MEETING_OVERLAP_WARNINGS = 4_096;

export const MAX_MEETING_OCCURRENCE_ITEMS = MAX_MEETING_OCCURRENCE_WINDOW_DAYS + 1;

export const MAX_MEETING_SEGMENT_ITEMS = MAX_MEETING_OCCURRENCE_WINDOW_DAYS + 13;

export const MEETING_WEEKDAY_NUMBERS: Readonly<Record<MeetingWeekday, number>> = Object.freeze({
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
export function hasExactDataKeys(value: unknown, expectedKeys: readonly string[]): value is Record<string, unknown> {
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
 * Reconstructs the physical date represented by a stable anchor and effective weekday.
 * @param {string} originalLogicalAnchor - Stable weekly anchor carried by the occurrence ID.
 * @param {MeetingWeekday} weekday - Effective weekday after any replacement.
 * @return {string | null} Canonical physical date, or null when it would exceed LocalDate.
 */
export function projectedMeetingOccurrenceDate(
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
export function canonicalText(value: unknown, maximumLength: number): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= maximumLength ? trimmed : null;
}

/**
 * Trims and bounds an explicitly optional text fact.
 */
export function canonicalOptionalText(value: unknown, maximumLength: number): string | null | undefined {
    return value === null ? null : canonicalText(value, maximumLength) ?? undefined;
}

/**
 * Converts an exact non-negative decimal into the canonical DTO form.
 */
export function canonicalCredits(value: unknown): string | null | undefined {
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
export function canonicalLocation(value: unknown): MeetingLocation | null {
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
 * Canonicalizes the exact replacement rule carried by occurrence edits.
 * @param {unknown} value - Candidate replacement DTO.
 * @return {MeetingRuleReplacement | null} Canonical replacement, or null when invalid.
 */
export function canonicalMeetingRuleReplacement(value: unknown): MeetingRuleReplacement | null {
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
export function canonicalLegacyMeetingRuleReplacement(value: unknown): LegacyMeetingRuleReplacement | null {
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
 * Validates the persisted Course range intent without resolving its Term dates.
 */
export function canonicalCourseTeachingRange(value: unknown): CourseTeachingRangeIntent | null {
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
export function canonicalMeetingEffectiveRange(value: unknown): MeetingEffectiveRangeIntent | null {
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
 * Normalizes the exact Course facts shared by independent and atomic setup commands.
 * @param {unknown} value - Candidate Course creation facts.
 * @return {CourseCreationFacts | null} Canonical facts, or null when invalid.
 */
export function canonicalCourseCreationFacts(value: unknown): CourseCreationFacts | null {
    if (!hasExactDataKeys(value, [
        'code',
        'name',
        'section',
        'instructor',
        'color',
        'credits',
        'teachingRange',
    ])) {
        return null;
    }
    const code = canonicalText(value.code, 32);
    const name = canonicalText(value.name, 120);
    const section = canonicalOptionalText(value.section, 64);
    const instructor = canonicalOptionalText(value.instructor, 120);
    const color = value.color === null
        ? null
        : COURSE_COLORS.has(value.color as CourseColor)
            ? value.color as CourseColor
            : undefined;
    const credits = canonicalCredits(value.credits);
    const teachingRange = canonicalCourseTeachingRange(value.teachingRange);
    if (code === null
        || name === null
        || section === undefined
        || instructor === undefined
        || color === undefined
        || credits === undefined
        || teachingRange === null) {
        return null;
    }
    return { code, name, section, instructor, color, credits, teachingRange };
}

/**
 * Normalizes the exact Meeting facts shared by independent and atomic setup commands.
 * @param {unknown} value - Candidate Meeting series creation facts.
 * @return {MeetingSeriesCreationFacts | null} Canonical facts, or null when invalid.
 */
export function canonicalMeetingSeriesCreationFacts(value: unknown): MeetingSeriesCreationFacts | null {
    if (!hasExactDataKeys(value, [
        'type',
        'weekday',
        'localStart',
        'localEnd',
        'endDayOffset',
        'effectiveRange',
        'location',
    ])) {
        return null;
    }
    const effectiveRange = canonicalMeetingEffectiveRange(value.effectiveRange);
    const location = canonicalLocation(value.location);
    if (!MEETING_TYPES.has(value.type as MeetingTypeCode)
        || !MEETING_WEEKDAYS.has(value.weekday as MeetingWeekday)
        || typeof value.localStart !== 'string'
        || typeof value.localEnd !== 'string'
        || !LOCAL_TIME_PATTERN.test(value.localStart)
        || !LOCAL_TIME_PATTERN.test(value.localEnd)
        || (value.endDayOffset !== 0 && value.endDayOffset !== 1)
        || (value.endDayOffset === 0 && value.localEnd <= value.localStart)
        || effectiveRange === null
        || location === null) {
        return null;
    }
    return {
        type: value.type as MeetingTypeCode,
        weekday: value.weekday as MeetingWeekday,
        localStart: value.localStart,
        localEnd: value.localEnd,
        endDayOffset: value.endDayOffset,
        effectiveRange,
        location,
    };
}

/**
 * Validates the shared exact Meeting rule fields used by segment and occurrence DTOs.
 * @param {Record<string, unknown>} value - Candidate DTO containing Meeting rule fields.
 * @return {boolean} Whether every rule field is canonical and internally ordered.
 */
export function hasValidMeetingRuleFields(value: Record<string, unknown>): boolean {
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
 * Checks that projected Instants are derived from the supplied TermZone and local rule fields.
 * @param {MeetingOccurrenceProjection} occurrence - Canonical occurrence projection.
 * @param {string} termZone - Explicit TermZone from the owning series detail.
 * @return {boolean} Whether both projected Instants match the explicit ZoneRules result.
 */
export function hasResolvedOccurrenceTime(
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
 * Builds the canonical receipt digest projection for Course-only creation.
 * @param {CreateCourseCommand} command - Normalized Course command.
 * @return {CanonicalValue} Canonical payload covered by the durable receipt digest.
 */
export function createCourseDigestProjection(command: CreateCourseCommand): CanonicalValue {
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

/**
 * Builds the canonical receipt digest projection for Meeting series creation.
 * @param {CreateMeetingSeriesCommand} command - Normalized Meeting command.
 * @return {CanonicalValue} Canonical payload covered by the durable receipt digest.
 */
export function createMeetingSeriesDigestProjection(command: CreateMeetingSeriesCommand): CanonicalValue {
    return {
        encoding: 'courseflow-canonical-json-v1',
        intent: command.intent,
        overlapDecision: command.overlapDecision,
        expectedRevision: command.expectedRevision,
        expectedEntityVersions: [
            {
                entityKind: 'plan-state',
                entityId: 'singleton',
                version: command.expectedPlanVersion,
            },
            {
                entityKind: 'course',
                entityId: command.intent.payload.courseId,
                version: command.expectedCourseVersion,
            },
        ],
        durableFollowUps: [{
            followUpId: command.followUpId,
            owner: 'protect',
            kind: 'backup-needed-through',
        }],
    };
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
