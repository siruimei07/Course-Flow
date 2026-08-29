import { isCanonicalInstant } from '../meeting-time';
import { CourseColor, CourseProjection, MAX_MEETING_OCCURRENCE_WINDOW_DAYS, MeetingLocation, MeetingOccurrenceImpactProjection, MeetingOccurrenceWindow, MeetingOverlapWarning, MeetingRuleReplacement, MeetingSeriesDetailProjection, MeetingSeriesProjection, MeetingTypeCode, MeetingWeekday } from '../workspace-course-contract';
import { CONFIRMATION_TOKEN_PATTERN, COURSE_COLORS, LOCAL_TIME_PATTERN, MAX_MEETING_OCCURRENCE_ITEMS, MAX_MEETING_SEGMENT_ITEMS, MEETING_TYPES, MEETING_WEEKDAYS, MILLISECONDS_PER_DAY, canonicalCredits, canonicalLocation, canonicalMeetingRuleReplacement, canonicalOptionalText, canonicalText, hasExactDataKeys, hasResolvedOccurrenceTime, hasValidMeetingRuleFields, projectedMeetingOccurrenceDate } from './types';
import type { CourseTeachingRangeProjection, MeetingEffectiveRangeProjection, MeetingOccurrenceImpactOccurrenceProjection, MeetingOccurrenceProjection, MeetingSegmentProjection } from './types';
import { isCanonicalUnsignedSqliteInteger, isCanonicalUuid } from '../workspace-data-contract';
import { isCanonicalLocalDate } from '../workspace-term-contract';
/**
 * Rejects sparse arrays and arrays carrying extra structured-clone properties.
 * @param {unknown} value - Candidate array crossing the Workspace boundary.
 * @return {boolean} Whether every numeric slot is an enumerable data property and no extras exist.
 */
export function isDenseArray(value: unknown): value is unknown[] {
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
 * Checks a location without serializing untrusted structured-clone input.
 * @param {unknown} value - Candidate location DTO.
 * @return {boolean} Whether the value is already in canonical DTO form.
 */
export function isCanonicalLocation(value: unknown): value is MeetingLocation {
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
 * Checks a replacement rule without serializing untrusted structured-clone input.
 * @param {unknown} value - Candidate replacement DTO.
 * @return {boolean} Whether the replacement is already in canonical DTO form.
 */
export function isCanonicalMeetingRuleReplacement(value: unknown): value is MeetingRuleReplacement {
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
 * Checks a resolved date range projection and its allowed inheritance discriminator.
 */
export function isResolvedDateRange(
    value: unknown,
    inheritedKind: 'inherit-term' | 'inherit-course',
): value is CourseTeachingRangeProjection | MeetingEffectiveRangeProjection {
    return hasExactDataKeys(value, ['kind', 'startDate', 'endDate'])
        && (value.kind === inheritedKind || value.kind === 'explicit')
        && isCanonicalLocalDate(value.startDate)
        && isCanonicalLocalDate(value.endDate)
        && value.endDate >= value.startDate;
}

export function isMeetingSeriesProjection(value: unknown): value is MeetingSeriesProjection {
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
 * Validates one exact non-overlapping-ready Meeting segment DTO.
 * @param {unknown} value - Untrusted segment projection.
 * @return {boolean} Whether the segment fields are canonical.
 */
export function isMeetingSegmentProjection(value: unknown): value is MeetingSegmentProjection {
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
export function isMeetingOccurrenceProjection(value: unknown): value is MeetingOccurrenceProjection {
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
export function isMeetingOccurrenceImpactOccurrenceProjection(
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
