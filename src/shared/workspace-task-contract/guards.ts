import { isMeetingOccurrenceWindow } from '../workspace-course-contract/guards';
import { isCanonicalUnsignedSqliteInteger, isCanonicalUuid } from '../workspace-data-contract';
import { TaskDeadline, TaskOccurrenceId, TaskOccurrenceImpactProjection, TaskOccurrenceProjection, TaskOccurrenceReplacement, TaskOccurrenceWindow, TaskProjection, TaskSchedule, TaskSeriesDetailProjection, TaskSize, normalizeTaskSchedule } from '../workspace-task-contract';
import { normalizeFutureReplacement, normalizeOnlyThisReplacement, normalizeTaskDeadline } from './makers';
import { MAX_TASK_HISTORICAL_STATE_ITEMS, MAX_TASK_OCCURRENCE_ITEMS, MAX_TASK_OVERRIDE_ITEMS, MAX_TASK_SEGMENT_ITEMS, MAX_TASK_TITLE_LENGTH, canonicalTimeZone, hasExactDataKeys, hasTaskOccurrenceFacts, hasTaskOccurrenceReplacementFacts, localDateDifferenceDays, projectedTaskOccurrenceDate, segmentContainsTaskAnchor, taskDeadlinesEqual, taskImpactOccurrenceListsAreCoherent, taskSegmentFacts } from './types';
import type { FutureTaskOccurrenceReplacement, HistoricalTaskOccurrenceState, TaskOccurrenceImpactOccurrenceProjection, TaskOccurrenceOverrideProjection, TaskSegmentProjection } from './types';
import { isCanonicalLocalDate } from '../workspace-term-contract';
/**
 * Rejects sparse arrays and arrays carrying structured-clone properties beyond indexed values.
 * @param {unknown} value - Candidate array crossing the Workspace boundary.
 * @return {boolean} Whether every slot is one enumerable data property and no extras exist.
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
 * Validates that a deadline is already in canonical DTO form.
 * @param {unknown} value - Candidate deadline DTO.
 * @return {boolean} Whether the deadline has exact canonical fields.
 */
export function isCanonicalTaskDeadline(value: unknown): value is TaskDeadline {
    const deadline = normalizeTaskDeadline(value);
    if (deadline === null || !hasExactDataKeys(value, Object.keys(deadline))) {
        return false;
    }
    return deadline.kind === 'tba'
        || (deadline.kind === 'date-only' && value.date === deadline.date)
        || (deadline.kind === 'timed'
            && value.instant === deadline.instant
            && value.timeZone === deadline.timeZone);
}

/**
 * Validates that a schedule is already in canonical DTO form.
 * @param {unknown} value - Candidate Task schedule.
 * @return {boolean} Whether the schedule has exact canonical fields.
 */
export function isCanonicalTaskSchedule(value: unknown): value is TaskSchedule {
    const schedule = normalizeTaskSchedule(value);
    if (schedule === null) {
        return false;
    }
    if (schedule.kind === 'once') {
        return hasExactDataKeys(value, ['kind', 'deadline'])
            && isCanonicalTaskDeadline(value.deadline);
    }
    return hasExactDataKeys(value, [
        'kind',
        'startDate',
        'weekday',
        'localDeadlineTime',
        'confirmedEndDate',
        'followTeachingWeek',
    ])
        && value.startDate === schedule.startDate
        && value.weekday === schedule.weekday
        && value.localDeadlineTime === schedule.localDeadlineTime
        && value.confirmedEndDate === schedule.confirmedEndDate
        && value.followTeachingWeek === schedule.followTeachingWeek;
}

/**
 * Validates the bounded physical-date window used to expand Task occurrences.
 * @param {unknown} value - Candidate expansion window.
 * @return {boolean} Whether the window is exact, canonical, ordered, and bounded.
 */
export function isTaskOccurrenceWindow(value: unknown): value is TaskOccurrenceWindow {
    return isMeetingOccurrenceWindow(value);
}

export function isTaskOccurrenceProjection(value: unknown): value is TaskOccurrenceProjection {
    return hasTaskOccurrenceFacts(value, [
        'occurrenceId',
        'title',
        'size',
        'deadline',
        'segmentId',
        'status',
        'reportedProgress',
        'displayProgress',
        'overrideKind',
    ])
        && isCanonicalUuid((value as { segmentId: unknown }).segmentId);
}

export function isTaskOccurrenceImpactOccurrenceProjection(
    value: unknown,
): value is TaskOccurrenceImpactOccurrenceProjection {
    return hasTaskOccurrenceFacts(value, [
        'occurrenceId',
        'title',
        'size',
        'deadline',
        'status',
        'reportedProgress',
        'displayProgress',
        'overrideKind',
    ]);
}

export function isCanonicalOnlyThisReplacement(value: unknown): value is TaskOccurrenceReplacement {
    const normalized = normalizeOnlyThisReplacement(value);
    return normalized !== null
        && hasExactDataKeys(value, ['title', 'size', 'deadline'])
        && value.title === normalized.title
        && value.size === normalized.size
        && isCanonicalTaskDeadline(value.deadline)
        && taskDeadlinesEqual(value.deadline, normalized.deadline);
}

export function isCanonicalFutureReplacement(value: unknown): value is FutureTaskOccurrenceReplacement {
    const normalized = normalizeFutureReplacement(value);
    return normalized !== null
        && hasExactDataKeys(value, [
            'title',
            'size',
            'weekday',
            'localDeadlineTime',
            'followTeachingWeek',
        ])
        && value.title === normalized.title
        && value.size === normalized.size
        && value.weekday === normalized.weekday
        && value.localDeadlineTime === normalized.localDeadlineTime
        && value.followTeachingWeek === normalized.followTeachingWeek;
}

export function isTaskSegmentProjection(value: unknown): value is TaskSegmentProjection {
    if (!hasExactDataKeys(value, [
        'segmentId',
        'logicalStartAnchor',
        'logicalEndAnchor',
        'replacement',
    ])
        || !isCanonicalUuid(value.segmentId)) {
        return false;
    }
    const isOnce = value.logicalStartAnchor === 'once'
        && value.logicalEndAnchor === 'once'
        && isCanonicalOnlyThisReplacement(value.replacement);
    const isWeekly = isCanonicalLocalDate(value.logicalStartAnchor)
        && isCanonicalLocalDate(value.logicalEndAnchor)
        && value.logicalEndAnchor >= value.logicalStartAnchor
        && localDateDifferenceDays(value.logicalEndAnchor, value.logicalStartAnchor) % 7 === 0
        && isCanonicalFutureReplacement(value.replacement);
    return isOnce || isWeekly;
}

export function isTaskOccurrenceOverrideProjection(value: unknown): value is TaskOccurrenceOverrideProjection {
    if (!hasExactDataKeys(value, ['occurrenceId', 'kind'])
        && !hasExactDataKeys(value, ['occurrenceId', 'kind', 'replacement'])) {
        return false;
    }
    if (!hasExactDataKeys(value.occurrenceId, ['taskSeriesId', 'originalLogicalAnchor'])
        || !isCanonicalUuid(value.occurrenceId.taskSeriesId)
        || !isTaskOccurrenceAnchor(value.occurrenceId.originalLogicalAnchor)) {
        return false;
    }
    return value.kind === 'deleted'
        ? hasExactDataKeys(value, ['occurrenceId', 'kind'])
        : value.kind === 'replaced'
            && hasExactDataKeys(value, ['occurrenceId', 'kind', 'replacement'])
            && isCanonicalOnlyThisReplacement(value.replacement);
}

export function isHistoricalTaskOccurrenceState(value: unknown): value is HistoricalTaskOccurrenceState {
    return hasExactDataKeys(value, [
        'occurrenceId',
        'status',
        'reportedProgress',
        'displayProgress',
        'title',
        'size',
        'deadline',
    ])
        && hasExactDataKeys(value.occurrenceId, ['taskSeriesId', 'originalLogicalAnchor'])
        && isCanonicalUuid(value.occurrenceId.taskSeriesId)
        && isTaskOccurrenceAnchor(value.occurrenceId.originalLogicalAnchor)
        && (value.status === 'pending' || value.status === 'completed' || value.status === 'skipped')
        && isReportedProgress(value.reportedProgress)
        && isReportedProgress(value.displayProgress)
        && typeof value.title === 'string'
        && value.title.length > 0
        && value.title.length <= MAX_TASK_TITLE_LENGTH
        && value.title === value.title.trim()
        && (value.size === 'small' || value.size === 'large')
        && isCanonicalTaskDeadline(value.deadline)
        && (value.size === 'small'
            ? value.reportedProgress === null && value.displayProgress === null
            : value.status === 'completed'
                ? value.displayProgress === 100
                : value.displayProgress === value.reportedProgress);
}

export function isOrderedUniqueAnchors(values: readonly TaskOccurrenceId[]): boolean {
    const anchors = values.map(value => value.originalLogicalAnchor);
    return new Set(anchors).size === anchors.length
        && anchors.every((anchor, index) => index === 0 || anchor > anchors[index - 1]!);
}

export function isTaskSegmentSequence(
    segments: readonly TaskSegmentProjection[],
    schedule: TaskSchedule,
    title: string,
    size: TaskSize,
): boolean {
    if (segments.length === 0
        || new Set(segments.map(segment => segment.segmentId)).size !== segments.length) {
        return false;
    }
    if (schedule.kind === 'once') {
        const segment = segments[0];
        return segments.length === 1
            && segment !== undefined
            && isCanonicalOnlyThisReplacement(segment.replacement)
            && segment.replacement.title === title
            && segment.replacement.size === size
            && taskDeadlinesEqual(segment.replacement.deadline, schedule.deadline);
    }
    if (!segments.every(segment => isCanonicalFutureReplacement(segment.replacement))) {
        return false;
    }
    const first = segments[0]!;
    const latest = segments.at(-1)!;
    const latestReplacement = latest.replacement;
    if (!isCanonicalFutureReplacement(latestReplacement)) {
        return false;
    }
    const firstStartOffset = localDateDifferenceDays(first.logicalStartAnchor, schedule.startDate);
    const finalEndOffset = localDateDifferenceDays(schedule.confirmedEndDate, latest.logicalEndAnchor);
    return firstStartOffset >= 0
        && firstStartOffset < 7
        && finalEndOffset >= 0
        && finalEndOffset < 7
        && segments.every((segment, index) => index === 0
            || localDateDifferenceDays(
                segment.logicalStartAnchor,
                segments[index - 1]!.logicalEndAnchor,
            ) === 7)
        && latestReplacement.title === title
        && latestReplacement.size === size
        && latestReplacement.weekday === schedule.weekday
        && latestReplacement.localDeadlineTime === schedule.localDeadlineTime
        && latestReplacement.followTeachingWeek === schedule.followTeachingWeek;
}

/**
 * Validates one bounded Task series detail crossing the Workspace query seam.
 * @param {unknown} value - Candidate Task series detail.
 * @return {boolean} Whether the projection is exact and internally coherent.
 */
export function isTaskSeriesDetailProjection(value: unknown): value is TaskSeriesDetailProjection {
    if (!hasExactDataKeys(value, [
        'workspaceRevision',
        'planEntityVersion',
        'requestedWindow',
        'termZone',
        'taskSeriesId',
        'courseId',
        'title',
        'size',
        'schedule',
        'entityVersion',
        'segments',
        'overrides',
        'historicalStates',
        'occurrences',
    ])
        || !isCanonicalUnsignedSqliteInteger(value.workspaceRevision)
        || !isCanonicalUnsignedSqliteInteger(value.planEntityVersion)
        || !isTaskOccurrenceWindow(value.requestedWindow)
        || canonicalTimeZone(value.termZone) !== value.termZone
        || !isCanonicalUuid(value.taskSeriesId)
        || !isCanonicalUuid(value.courseId)
        || typeof value.title !== 'string'
        || value.title.length === 0
        || value.title.length > MAX_TASK_TITLE_LENGTH
        || value.title !== value.title.trim()
        || (value.size !== 'small' && value.size !== 'large')
        || !isCanonicalTaskSchedule(value.schedule)
        || !isCanonicalUnsignedSqliteInteger(value.entityVersion)
        || value.entityVersion === '0'
        || !isDenseArray(value.segments)
        || value.segments.length === 0
        || value.segments.length > MAX_TASK_SEGMENT_ITEMS
        || !value.segments.every(isTaskSegmentProjection)
        || !isDenseArray(value.overrides)
        || value.overrides.length > MAX_TASK_OVERRIDE_ITEMS
        || !value.overrides.every(isTaskOccurrenceOverrideProjection)
        || !isDenseArray(value.historicalStates)
        || value.historicalStates.length > MAX_TASK_HISTORICAL_STATE_ITEMS
        || !value.historicalStates.every(isHistoricalTaskOccurrenceState)
        || !isDenseArray(value.occurrences)
        || !value.occurrences.every(isTaskOccurrenceProjection)
        || value.occurrences.length > MAX_TASK_OCCURRENCE_ITEMS) {
        return false;
    }
    const schedule = value.schedule as TaskSchedule;
    const segments = value.segments as TaskSegmentProjection[];
    const overrides = value.overrides as TaskOccurrenceOverrideProjection[];
    const historicalStates = value.historicalStates as HistoricalTaskOccurrenceState[];
    const occurrences = value.occurrences as TaskOccurrenceProjection[];
    const taskSeriesId = value.taskSeriesId as string;
    const requestedWindow = value.requestedWindow as TaskOccurrenceWindow;
    const termZone = value.termZone as string;
    if (!isTaskSegmentSequence(segments, schedule, value.title as string, value.size as TaskSize)
        || !isOrderedUniqueAnchors(overrides.map(override => override.occurrenceId))
        || !isOrderedUniqueAnchors(historicalStates.map(state => state.occurrenceId))
        || !isOrderedUniqueAnchors(occurrences.map(occurrence => occurrence.occurrenceId))) {
        return false;
    }
    const firstAnchor = segments[0]!.logicalStartAnchor;
    const isStableAnchor = (occurrenceId: TaskOccurrenceId): boolean => (
        occurrenceId.taskSeriesId === taskSeriesId
        && (schedule.kind === 'once'
            ? occurrenceId.originalLogicalAnchor === 'once'
            : isCanonicalLocalDate(occurrenceId.originalLogicalAnchor)
                && occurrenceId.originalLogicalAnchor >= firstAnchor
                && occurrenceId.originalLogicalAnchor <= schedule.confirmedEndDate
                && localDateDifferenceDays(occurrenceId.originalLogicalAnchor, firstAnchor) % 7 === 0)
    );
    if (!overrides.every(override => isStableAnchor(override.occurrenceId))
        || !historicalStates.every(state => isStableAnchor(state.occurrenceId))
        || !occurrences.every(occurrence => isStableAnchor(occurrence.occurrenceId))) {
        return false;
    }
    const segmentsById = new Map(segments.map(segment => [segment.segmentId, segment]));
    const overridesByAnchor = new Map(overrides.map(override => [
        override.occurrenceId.originalLogicalAnchor,
        override,
    ]));
    const statesByAnchor = new Map(historicalStates.map(state => [
        state.occurrenceId.originalLogicalAnchor,
        state,
    ]));
    const occurrenceFactsAreCoherent = occurrences.every(occurrence => {
        const anchor = occurrence.occurrenceId.originalLogicalAnchor;
        const segment = segmentsById.get(occurrence.segmentId);
        const override = overridesByAnchor.get(anchor);
        if (segment === undefined
            || !segmentContainsTaskAnchor(segment, anchor)
            || override?.kind === 'deleted') {
            return false;
        }
        const physicalDate = isCanonicalFutureReplacement(segment.replacement)
            ? projectedTaskOccurrenceDate(anchor, segment.replacement.weekday)
            : null;
        if (schedule.kind === 'weekly'
            && (physicalDate === null
                || physicalDate < requestedWindow.startDate
                || physicalDate > requestedWindow.endDate)) {
            return false;
        }
        const replacement = override?.kind === 'replaced'
            ? override.replacement
            : taskSegmentFacts(segment, anchor, termZone);
        const state = statesByAnchor.get(anchor);
        return replacement !== null
            && occurrence.overrideKind === (override?.kind === 'replaced' ? 'replaced' : 'none')
            && hasTaskOccurrenceReplacementFacts(occurrence, replacement)
            && (state === undefined
                || (occurrence.status === state.status
                    && occurrence.reportedProgress === state.reportedProgress
                    && occurrence.displayProgress === state.displayProgress));
    });
    const historicalFactsAreCoherent = historicalStates.every(state => {
        const anchor = state.occurrenceId.originalLogicalAnchor;
        const override = overridesByAnchor.get(anchor);
        const segment = segments.find(candidate => segmentContainsTaskAnchor(candidate, anchor));
        const replacement = override?.kind === 'replaced'
            ? override.replacement
            : segment === undefined
                ? null
                : taskSegmentFacts(segment, anchor, termZone);
        return replacement !== null && hasTaskOccurrenceReplacementFacts(state, replacement);
    });
    const onceIsPresentUnlessDeleted = schedule.kind !== 'once'
        || (overridesByAnchor.get('once')?.kind === 'deleted'
            ? occurrences.length === 0
            : occurrences.length === 1);
    return occurrenceFactsAreCoherent
        && historicalFactsAreCoherent
        && onceIsPresentUnlessDeleted;
}

export function isTaskOccurrenceAnchor(value: unknown): value is string {
    return value === 'once' || isCanonicalLocalDate(value);
}

export function isConfirmationToken(value: unknown): value is string {
    return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

export function isReportedProgress(value: unknown): value is number | null {
    return value === null || (typeof value === 'number'
        && Number.isInteger(value)
        && value >= 0
        && value <= 100);
}

/**
 * Validates an active Task summary projection crossing the Workspace query seam.
 * @param {unknown} value - Candidate Task projection.
 * @return {boolean} Whether the projection is exact and canonical.
 */
export function isTaskProjection(value: unknown): value is TaskProjection {
    const commonKeys = [
        'taskSeriesId',
        'courseId',
        'title',
        'size',
        'entityVersion',
    ];
    if (!hasExactDataKeys(value, [
        ...commonKeys,
        'deadline',
        'occurrenceId',
        'status',
        'reportedProgress',
        'displayProgress',
        'overrideKind',
    ])
        && !hasExactDataKeys(value, [...commonKeys, 'schedule'])) {
        return false;
    }
    if (!isCanonicalUuid(value.taskSeriesId)
        || !isCanonicalUuid(value.courseId)
        || typeof value.title !== 'string'
        || value.title.length === 0
        || value.title.length > MAX_TASK_TITLE_LENGTH
        || value.title !== value.title.trim()
        || (value.size !== 'small' && value.size !== 'large')
        || !isCanonicalUnsignedSqliteInteger(value.entityVersion)
        || value.entityVersion === '0') {
        return false;
    }
    if ('schedule' in value) {
        return isCanonicalTaskSchedule(value.schedule) && value.schedule.kind === 'weekly';
    }
    if (!isCanonicalTaskDeadline(value.deadline)
        || !hasExactDataKeys(value.occurrenceId, ['taskSeriesId', 'originalLogicalAnchor'])
        || value.occurrenceId.taskSeriesId !== value.taskSeriesId
        || value.occurrenceId.originalLogicalAnchor !== 'once'
        || (value.status !== 'pending'
            && value.status !== 'completed'
            && value.status !== 'skipped')
        || !isReportedProgress(value.reportedProgress)
        || !isReportedProgress(value.displayProgress)
        || (value.overrideKind !== 'none' && value.overrideKind !== 'replaced')
        || (value.size === 'small'
            && (value.reportedProgress !== null || value.displayProgress !== null))
        || (value.size === 'large'
            && (value.status === 'completed'
                ? value.displayProgress !== 100
                : value.displayProgress !== value.reportedProgress))) {
        return false;
    }
    return true;
}

export function isTaskImpactPreviewMetadata(value: unknown): boolean {
    if (!hasExactDataKeys(value, [
        'basedOnRevision',
        'planEntityVersion',
        'taskSeriesVersion',
        'affectedEntities',
        'effects',
        'warnings',
        'choices',
        'defaultChoice',
        'recoverability',
        'unresolvedReferences',
        'taskSeriesId',
        'originalLogicalAnchor',
        'scope',
        'action',
        'requestedWindow',
        'affectedFutureSegmentCount',
        'futureOverrideCount',
        'historicalStateCount',
        'currentFutureOccurrences',
        'futureOccurrencesAfterChange',
        'confirmationToken',
    ])
        || !isDenseArray(value.affectedEntities)
        || value.affectedEntities.length !== 1
        || !hasExactDataKeys(value.affectedEntities[0], ['kind', 'id', 'version'])
        || value.affectedEntities[0].kind !== 'task-series'
        || value.affectedEntities[0].id !== value.taskSeriesId
        || value.affectedEntities[0].version !== value.taskSeriesVersion
        || !isDenseArray(value.effects)
        || value.effects.length !== 1
        || !hasExactDataKeys(value.effects[0], [
            'code',
            'scope',
            'originalLogicalAnchor',
            'affectedFutureSegmentCount',
            'futureOverrideCount',
            'historicalStateCount',
            'historicalStateAction',
        ])) {
        return false;
    }
    const expectedEffectCode = value.action === 'change'
        ? 'plan.task-occurrence-changed'
        : value.scope === 'whole-series'
            ? 'plan.task-series-deleted'
            : 'plan.task-occurrence-deleted';
    const effect = value.effects[0];
    if (effect.code !== expectedEffectCode
        || effect.scope !== value.scope
        || effect.originalLogicalAnchor !== value.originalLogicalAnchor
        || effect.affectedFutureSegmentCount !== value.affectedFutureSegmentCount
        || effect.futureOverrideCount !== value.futureOverrideCount
        || effect.historicalStateCount !== value.historicalStateCount
        || effect.historicalStateAction !== 'retain') {
        return false;
    }
    const expectedWarningCodes = [
        ...(value.historicalStateCount === '0' ? [] : ['terminal-history-retained']),
        ...(value.futureOverrideCount === '0' ? [] : ['occurrence-overrides-retained']),
    ];
    if (!isDenseArray(value.warnings)
        || value.warnings.length !== expectedWarningCodes.length
        || !value.warnings.every((warning, index) => (
            hasExactDataKeys(warning, ['code'])
            && warning.code === expectedWarningCodes[index]
        ))) {
        return false;
    }
    const expectedChoice = value.scope === 'only-this'
        ? 'apply-only-this'
        : value.scope === 'whole-series'
            ? 'delete-whole-series'
            : 'apply-this-and-future';
    const expectedReason = value.action === 'change'
        ? 'task-rule-change-has-no-undo'
        : 'task-deletion-has-no-undo';
    return isDenseArray(value.choices)
        && value.choices.length === 1
        && hasExactDataKeys(value.choices[0], ['id'])
        && value.choices[0].id === expectedChoice
        && hasExactDataKeys(value.defaultChoice, ['id'])
        && value.defaultChoice.id === expectedChoice
        && hasExactDataKeys(value.recoverability, ['kind', 'reason'])
        && value.recoverability.kind === 'permanent'
        && value.recoverability.reason === expectedReason
        && isDenseArray(value.unresolvedReferences)
        && value.unresolvedReferences.length === 0;
}

export function isTaskOccurrenceImpactProjection(value: unknown): value is TaskOccurrenceImpactProjection {
    return hasExactDataKeys(value, [
        'basedOnRevision',
        'planEntityVersion',
        'taskSeriesVersion',
        'affectedEntities',
        'effects',
        'warnings',
        'choices',
        'defaultChoice',
        'recoverability',
        'unresolvedReferences',
        'taskSeriesId',
        'originalLogicalAnchor',
        'scope',
        'action',
        'requestedWindow',
        'affectedFutureSegmentCount',
        'futureOverrideCount',
        'historicalStateCount',
        'currentFutureOccurrences',
        'futureOccurrencesAfterChange',
        'confirmationToken',
    ])
        && isCanonicalUnsignedSqliteInteger(value.basedOnRevision)
        && isCanonicalUnsignedSqliteInteger(value.planEntityVersion)
        && isCanonicalUnsignedSqliteInteger(value.taskSeriesVersion)
        && value.taskSeriesVersion !== '0'
        && isCanonicalUuid(value.taskSeriesId)
        && (value.scope === 'whole-series'
            ? value.originalLogicalAnchor === null
            : isTaskOccurrenceAnchor(value.originalLogicalAnchor))
        && (value.scope === 'only-this'
            || value.scope === 'this-and-future'
            || value.scope === 'whole-series')
        && (value.action === 'change' || value.action === 'delete')
        && (value.action === 'delete' || value.scope === 'this-and-future')
        && isTaskOccurrenceWindow(value.requestedWindow)
        && isCanonicalUnsignedSqliteInteger(value.affectedFutureSegmentCount)
        && isCanonicalUnsignedSqliteInteger(value.futureOverrideCount)
        && isCanonicalUnsignedSqliteInteger(value.historicalStateCount)
        && isDenseArray(value.currentFutureOccurrences)
        && value.currentFutureOccurrences.length <= MAX_TASK_OCCURRENCE_ITEMS
        && value.currentFutureOccurrences.every(isTaskOccurrenceProjection)
        && isDenseArray(value.futureOccurrencesAfterChange)
        && value.futureOccurrencesAfterChange.length <= MAX_TASK_OCCURRENCE_ITEMS
        && value.futureOccurrencesAfterChange.every(isTaskOccurrenceImpactOccurrenceProjection)
        && isTaskImpactPreviewMetadata(value)
        && isConfirmationToken(value.confirmationToken)
        && taskImpactOccurrenceListsAreCoherent(
            value.currentFutureOccurrences as TaskOccurrenceProjection[],
            value.futureOccurrencesAfterChange as TaskOccurrenceImpactOccurrenceProjection[],
            value.taskSeriesId as string,
            value.scope as TaskOccurrenceImpactProjection['scope'],
            value.action as TaskOccurrenceImpactProjection['action'],
            value.originalLogicalAnchor as string | null,
            value.requestedWindow as TaskOccurrenceWindow,
        );
}
