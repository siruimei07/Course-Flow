import { AcceptedCreateCourseWithMeetingCommand, CancelMeetingOccurrenceCommand, ChangeMeetingOccurrenceCommand, CourseColor, CreateCourseCommand, CreateCourseWithMeetingCommand, CreateMeetingSeriesCommand, MeetingOccurrenceId, MeetingOccurrenceImpactDraft, MeetingOccurrenceWindow, MeetingTypeCode, MeetingWeekday } from '../workspace-course-contract';
import type { AcceptedChangeMeetingOccurrenceCommand } from '../workspace-course-contract';
import { isMeetingOccurrenceWindow } from './guards';
import { CONFIRMATION_TOKEN_PATTERN, COURSE_COLORS, LOCAL_TIME_PATTERN, MEETING_TYPES, MEETING_WEEKDAYS, canonicalCourseCreationFacts, canonicalCourseTeachingRange, canonicalCredits, canonicalLegacyMeetingRuleReplacement, canonicalLocation, canonicalMeetingEffectiveRange, canonicalMeetingRuleReplacement, canonicalMeetingSeriesCreationFacts, canonicalOptionalText, canonicalText, hasExactDataKeys } from './types';
import type { LegacyChangeMeetingOccurrenceCommand, LegacyCreateCourseWithMeetingCommand, LegacyCreateCourseWithMeetingCommandV2 } from './types';
import { isCanonicalUnsignedSqliteInteger, isCanonicalUuid } from '../workspace-data-contract';
import { isCanonicalLocalDate } from '../workspace-term-contract';
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
 * Normalizes a Course-only creation command used before the setup activity choice.
 * @param {unknown} value - Untrusted command DTO.
 * @return {CreateCourseCommand} Canonical Course command.
 */
export function normalizeCreateCourseCommand(value: unknown): CreateCourseCommand {
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
        || value.intent.kind !== 'plan.create-course'
        || value.intent.intentSchemaVersion !== 1
        || !hasExactDataKeys(value.intent.payload, ['course'])) {
        throw new TypeError('CreateCourseCommand has invalid fields');
    }
    const course = canonicalCourseCreationFacts(value.intent.payload.course);
    if (course === null) {
        throw new TypeError('CreateCourseCommand has invalid Course facts');
    }
    return {
        commandId: value.commandId,
        followUpId: value.followUpId,
        expectedRevision: value.expectedRevision,
        expectedPlanVersion: value.expectedPlanVersion,
        intent: {
            kind: 'plan.create-course',
            intentSchemaVersion: 1,
            payload: { course },
        },
    };
}

/**
 * Normalizes a Meeting-only creation command for one existing current Course.
 * @param {unknown} value - Untrusted command DTO.
 * @return {CreateMeetingSeriesCommand} Canonical Meeting series command.
 */
export function normalizeCreateMeetingSeriesCommand(value: unknown): CreateMeetingSeriesCommand {
    if (!hasExactDataKeys(value, [
        'commandId',
        'followUpId',
        'overlapDecision',
        'expectedRevision',
        'expectedPlanVersion',
        'expectedCourseVersion',
        'intent',
    ])
        || !isCanonicalUuid(value.commandId)
        || !isCanonicalUuid(value.followUpId)
        || (value.overlapDecision !== 'review' && value.overlapDecision !== 'continue')
        || !isCanonicalUnsignedSqliteInteger(value.expectedRevision)
        || !isCanonicalUnsignedSqliteInteger(value.expectedPlanVersion)
        || !isCanonicalUnsignedSqliteInteger(value.expectedCourseVersion)
        || value.expectedCourseVersion === '0'
        || !hasExactDataKeys(value.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || value.intent.kind !== 'plan.create-meeting-series'
        || value.intent.intentSchemaVersion !== 1
        || !hasExactDataKeys(value.intent.payload, ['courseId', 'meeting'])
        || !isCanonicalUuid(value.intent.payload.courseId)) {
        throw new TypeError('CreateMeetingSeriesCommand has invalid fields');
    }
    const meeting = canonicalMeetingSeriesCreationFacts(value.intent.payload.meeting);
    if (meeting === null) {
        throw new TypeError('CreateMeetingSeriesCommand has invalid Meeting facts');
    }
    return {
        commandId: value.commandId,
        followUpId: value.followUpId,
        overlapDecision: value.overlapDecision,
        expectedRevision: value.expectedRevision,
        expectedPlanVersion: value.expectedPlanVersion,
        expectedCourseVersion: value.expectedCourseVersion,
        intent: {
            kind: 'plan.create-meeting-series',
            intentSchemaVersion: 1,
            payload: {
                courseId: value.intent.payload.courseId,
                meeting,
            },
        },
    };
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
