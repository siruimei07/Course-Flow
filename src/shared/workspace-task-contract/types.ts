import { CanonicalValue } from '../canonical-json';
import { INTL_ZONE_RULES } from '../meeting-time';
import { MeetingOccurrenceWindow, MeetingWeekday } from '../workspace-course-contract';
import { isCanonicalUuid } from '../workspace-data-contract';
import { isCanonicalOnlyThisReplacement, isCanonicalTaskDeadline, isOrderedUniqueAnchors, isReportedProgress, isTaskOccurrenceAnchor } from './guards';
import { isCanonicalLocalDate } from '../workspace-term-contract';
export type TaskSize = 'small' | 'large';

export type TaskDeadline =
    | Readonly<{ kind: 'date-only'; date: string }>
    | Readonly<{ kind: 'timed'; instant: string; timeZone: string }>
    | Readonly<{ kind: 'tba' }>;

export type WeeklyTaskSchedule = Readonly<{
    kind: 'weekly';
    startDate: string;
    weekday: MeetingWeekday;
    localDeadlineTime: string;
    confirmedEndDate: string;
    followTeachingWeek: boolean;
}>;

export type OnceTaskSchedule = Readonly<{
    kind: 'once';
    deadline: TaskDeadline;
}>;

export type TaskSchedule =
    | OnceTaskSchedule
    | WeeklyTaskSchedule;

export type TaskOccurrenceWindow = MeetingOccurrenceWindow;

export type TaskOccurrenceId = Readonly<{
    taskSeriesId: string;
    originalLogicalAnchor: string;
}>;

export type TaskOccurrenceStatus = 'pending' | 'completed' | 'skipped';

export type TaskUndoCapability = Readonly<{
    token: string;
    taskSeriesId: string;
    originalLogicalAnchor: string;
    committedRevision: string;
    validThroughTaskSeriesVersion: string;
}>;

export type TaskOccurrenceOverrideKind = 'none' | 'replaced' | 'deleted';

export type TaskOccurrenceReplacement = Readonly<{
    title: string;
    size: TaskSize;
    deadline: TaskDeadline;
}>;

export type FutureTaskOccurrenceReplacement = Readonly<{
    title: string;
    size: TaskSize;
    weekday: MeetingWeekday;
    localDeadlineTime: string;
    followTeachingWeek: boolean;
}>;

export type TaskSegmentProjection = Readonly<{
    segmentId: string;
    logicalStartAnchor: string;
    logicalEndAnchor: string;
    replacement: TaskOccurrenceReplacement | FutureTaskOccurrenceReplacement;
}>;

export type TaskOccurrenceOverrideProjection =
    | Readonly<{
        occurrenceId: TaskOccurrenceId;
        kind: 'replaced';
        replacement: TaskOccurrenceReplacement;
    }>
    | Readonly<{
        occurrenceId: TaskOccurrenceId;
        kind: 'deleted';
    }>;

export type HistoricalTaskOccurrenceState = Readonly<{
    occurrenceId: TaskOccurrenceId;
    status: TaskOccurrenceStatus;
    reportedProgress: number | null;
    displayProgress: number | null;
    title: string;
    size: TaskSize;
    deadline: TaskDeadline;
}>;

export type TaskProjectionBase = Readonly<{
    taskSeriesId: string;
    courseId: string;
    title: string;
    size: TaskSize;
    entityVersion: string;
}>;

export type TaskProjection =
    | TaskProjectionBase & Readonly<{
        deadline: TaskDeadline;
        occurrenceId: TaskOccurrenceId;
        status: TaskOccurrenceStatus;
        reportedProgress: number | null;
        displayProgress: number | null;
        overrideKind: 'none' | 'replaced';
    }>
    | TaskProjectionBase & Readonly<{
        schedule: WeeklyTaskSchedule;
        deadline?: never;
        occurrenceId?: never;
        status?: never;
    }>;

export type OnceTaskOccurrenceProjection = Readonly<{
    occurrenceId: TaskOccurrenceId;
    title: string;
    size: TaskSize;
    deadline: TaskDeadline;
    segmentId: string;
    status: TaskOccurrenceStatus;
    reportedProgress: number | null;
    displayProgress: number | null;
    overrideKind: 'none' | 'replaced';
}>;

export type WeeklyTaskOccurrenceProjection = Readonly<{
    occurrenceId: TaskOccurrenceId;
    title: string;
    size: TaskSize;
    deadline: TaskDeadline;
    segmentId: string;
    status: TaskOccurrenceStatus;
    reportedProgress: number | null;
    displayProgress: number | null;
    overrideKind: 'none' | 'replaced';
}>;

export type TaskOccurrenceProjection =
    | OnceTaskOccurrenceProjection
    | WeeklyTaskOccurrenceProjection;

export type TaskSeriesDetailProjectionBase = Readonly<{
    workspaceRevision: string;
    planEntityVersion: string;
    requestedWindow: TaskOccurrenceWindow;
    termZone: string;
    taskSeriesId: string;
    courseId: string;
    title: string;
    size: TaskSize;
    entityVersion: string;
}>;

export type TaskSeriesDetailProjection =
    | TaskSeriesDetailProjectionBase & Readonly<{
        schedule: OnceTaskSchedule;
        segments: readonly TaskSegmentProjection[];
        overrides: readonly TaskOccurrenceOverrideProjection[];
        historicalStates: readonly HistoricalTaskOccurrenceState[];
        occurrences: readonly OnceTaskOccurrenceProjection[];
    }>
    | TaskSeriesDetailProjectionBase & Readonly<{
        schedule: WeeklyTaskSchedule;
        segments: readonly TaskSegmentProjection[];
        overrides: readonly TaskOccurrenceOverrideProjection[];
        historicalStates: readonly HistoricalTaskOccurrenceState[];
        occurrences: readonly WeeklyTaskOccurrenceProjection[];
    }>;

export type TaskCommandBase = Readonly<{
    commandId: string;
    followUpId: string;
    expectedRevision: string;
    expectedPlanVersion: string;
}>;

export type ExistingTaskCommandBase = TaskCommandBase & Readonly<{
    expectedTaskSeriesVersion: string;
}>;

export type OnceTaskFacts = Readonly<{
    courseId: string;
    title: string;
    size: TaskSize;
    deadline: TaskDeadline;
}>;

export type ScheduledTaskFacts = Readonly<{
    courseId: string;
    title: string;
    size: TaskSize;
    schedule: TaskSchedule;
}>;

export type CreateTaskCommand = TaskCommandBase & (
    | Readonly<{
        intent: Readonly<{
            kind: 'plan.create-task-series';
            intentSchemaVersion: 1;
            payload: OnceTaskFacts;
        }>;
    }>
    | Readonly<{
        intent: Readonly<{
            kind: 'plan.create-task-series';
            intentSchemaVersion: 2;
            payload: ScheduledTaskFacts;
        }>;
    }>
);

export type UpdateTaskCommand = ExistingTaskCommandBase & (
    | Readonly<{
        intent: Readonly<{
            kind: 'plan.update-task-series';
            intentSchemaVersion: 1;
            payload: OnceTaskFacts & Readonly<{ taskSeriesId: string }>;
        }>;
    }>
    | Readonly<{
        intent: Readonly<{
            kind: 'plan.update-task-series';
            intentSchemaVersion: 2;
            payload: ScheduledTaskFacts & Readonly<{ taskSeriesId: string }>;
        }>;
    }>
);

export type DeleteTaskCommand = ExistingTaskCommandBase & Readonly<{
    intent: Readonly<{
        kind: 'plan.delete-task-series';
        intentSchemaVersion: 1;
        payload: Readonly<{ taskSeriesId: string }>;
    }>;
}>;

export type CompleteTaskCommand = ExistingTaskCommandBase & Readonly<{
    intent: Readonly<{
        kind: 'plan.set-task-occurrence-status';
        intentSchemaVersion: 1;
        payload: Readonly<{
            taskSeriesId: string;
            originalLogicalAnchor: 'once';
            status: 'completed';
        }>;
    }>;
}>;

export type SetTaskOccurrenceStatusCommand = ExistingTaskCommandBase & Readonly<{
    intent: Readonly<{
        kind: 'plan.set-task-occurrence-status';
        intentSchemaVersion: 2;
        payload: Readonly<{
            taskSeriesId: string;
            originalLogicalAnchor: string;
            status: TaskOccurrenceStatus;
        }>;
    }>;
}>;

export type SetTaskProgressCommand = ExistingTaskCommandBase & Readonly<{
    intent: Readonly<{
        kind: 'plan.set-task-progress';
        intentSchemaVersion: 1;
        payload: Readonly<{
            taskSeriesId: string;
            originalLogicalAnchor: string;
            reportedProgress: number | null;
        }>;
    }>;
}>;

export type ChangeTaskOccurrenceCommand = ExistingTaskCommandBase & Readonly<{
    confirmationToken: string | null;
    impactWindow: TaskOccurrenceWindow | null;
    intent: Readonly<{
        kind: 'plan.change-task-occurrence';
        intentSchemaVersion: 1;
        payload:
            | Readonly<{
                taskSeriesId: string;
                originalLogicalAnchor: string;
                scope: 'only-this';
                replacement: TaskOccurrenceReplacement;
            }>
            | Readonly<{
                taskSeriesId: string;
                originalLogicalAnchor: string;
                scope: 'this-and-future';
                replacement: FutureTaskOccurrenceReplacement;
            }>;
    }>;
}>;

export type DeleteTaskOccurrenceOrSeriesCommand = ExistingTaskCommandBase & Readonly<{
    confirmationToken: string;
    impactWindow: TaskOccurrenceWindow;
    intent: Readonly<{
        kind: 'plan.delete-task-occurrence-or-series';
        intentSchemaVersion: 1;
        payload:
            | Readonly<{
                taskSeriesId: string;
                originalLogicalAnchor: string;
                scope: 'only-this' | 'this-and-future';
            }>
            | Readonly<{
                taskSeriesId: string;
                scope: 'whole-series';
            }>;
    }>;
}>;

export type UndoTaskOccurrenceStateCommand = ExistingTaskCommandBase & Readonly<{
    intent: Readonly<{
        kind: 'plan.undo-task-occurrence-state';
        intentSchemaVersion: 1;
        payload: Readonly<{
            token: string;
            taskSeriesId: string;
            originalLogicalAnchor: string;
        }>;
    }>;
}>;

export type TaskOccurrenceImpactDraft =
    | Readonly<{
        scope: 'this-and-future';
        taskSeriesId: string;
        originalLogicalAnchor: string;
        action: 'change';
        replacement: FutureTaskOccurrenceReplacement;
        requestedWindow: TaskOccurrenceWindow;
    }>
    | Readonly<{
        scope: 'only-this' | 'this-and-future';
        taskSeriesId: string;
        originalLogicalAnchor: string;
        action: 'delete';
        requestedWindow: TaskOccurrenceWindow;
    }>
    | Readonly<{
        scope: 'whole-series';
        taskSeriesId: string;
        action: 'delete';
        requestedWindow: TaskOccurrenceWindow;
    }>;

export type TaskOccurrenceImpactOccurrenceProjection = Omit<
    TaskOccurrenceProjection,
    'segmentId'
>;

export type TaskOccurrenceImpactProjection = Readonly<{
    basedOnRevision: string;
    planEntityVersion: string;
    taskSeriesVersion: string;
    affectedEntities: readonly [Readonly<{
        kind: 'task-series';
        id: string;
        version: string;
    }>];
    effects: readonly [Readonly<{
        code:
            | 'plan.task-occurrence-changed'
            | 'plan.task-occurrence-deleted'
            | 'plan.task-series-deleted';
        scope: 'only-this' | 'this-and-future' | 'whole-series';
        originalLogicalAnchor: string | null;
        affectedFutureSegmentCount: string;
        futureOverrideCount: string;
        historicalStateCount: string;
        historicalStateAction: 'retain';
    }>];
    warnings: readonly Readonly<{
        code: 'terminal-history-retained' | 'occurrence-overrides-retained';
    }>[];
    choices: readonly [Readonly<{
        id: 'apply-only-this' | 'apply-this-and-future' | 'delete-whole-series';
    }>];
    defaultChoice: Readonly<{
        id: 'apply-only-this' | 'apply-this-and-future' | 'delete-whole-series';
    }>;
    recoverability: Readonly<{
        kind: 'permanent';
        reason: 'task-rule-change-has-no-undo' | 'task-deletion-has-no-undo';
    }>;
    unresolvedReferences: readonly [];
    taskSeriesId: string;
    originalLogicalAnchor: string | null;
    scope: 'only-this' | 'this-and-future' | 'whole-series';
    action: 'change' | 'delete';
    requestedWindow: TaskOccurrenceWindow;
    affectedFutureSegmentCount: string;
    futureOverrideCount: string;
    historicalStateCount: string;
    currentFutureOccurrences: readonly TaskOccurrenceProjection[];
    futureOccurrencesAfterChange: readonly TaskOccurrenceImpactOccurrenceProjection[];
    confirmationToken: string;
}>;

export type TaskCommand =
    | CreateTaskCommand
    | UpdateTaskCommand
    | DeleteTaskCommand
    | CompleteTaskCommand
    | SetTaskOccurrenceStatusCommand
    | SetTaskProgressCommand
    | ChangeTaskOccurrenceCommand
    | DeleteTaskOccurrenceOrSeriesCommand
    | UndoTaskOccurrenceStateCommand;

export const MAX_TASK_TITLE_LENGTH = 240;

export const TASK_WEEKDAYS = new Set<MeetingWeekday>([
    'MON',
    'TUE',
    'WED',
    'THU',
    'FRI',
    'SAT',
    'SUN',
]);

export const LOCAL_TIME_PATTERN = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;

export const MAX_TASK_OCCURRENCE_ITEMS = 54;

export const MAX_TASK_SEGMENT_ITEMS = MAX_TASK_OCCURRENCE_ITEMS;

export const MAX_TASK_OVERRIDE_ITEMS = MAX_TASK_OCCURRENCE_ITEMS;

export const MAX_TASK_HISTORICAL_STATE_ITEMS = MAX_TASK_OCCURRENCE_ITEMS;

export const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;

export const TASK_WEEKDAY_NUMBERS: Readonly<Record<MeetingWeekday, number>> = Object.freeze({
    SUN: 0,
    MON: 1,
    TUE: 2,
    WED: 3,
    THU: 4,
    FRI: 5,
    SAT: 6,
});

/**
 * Narrows an untrusted value to a plain object with exact enumerable data keys.
 * @param {unknown} value - Candidate structured-clone value.
 * @param {readonly string[]} expectedKeys - Exact allowed keys.
 * @return {boolean} Whether the value has only the expected data properties.
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
 * Resolves one explicit IANA display zone through the runtime tzdb.
 * @param {unknown} value - Candidate zone value.
 * @return {string | null} Canonical zone, or null when invalid.
 */
export function canonicalTimeZone(value: unknown): string | null {
    if (typeof value !== 'string' || value.length === 0) {
        return null;
    }

    try {
        return new Intl.DateTimeFormat('en-CA', { timeZone: value }).resolvedOptions().timeZone;
    }
    catch {
        return null;
    }
}

export function hasTaskOccurrenceFacts(value: unknown, expectedKeys: readonly string[]): boolean {
    if (!hasExactDataKeys(value, expectedKeys)
        || !hasExactDataKeys(value.occurrenceId, ['taskSeriesId', 'originalLogicalAnchor'])
        || !isCanonicalUuid(value.occurrenceId.taskSeriesId)
        || !isTaskOccurrenceAnchor(value.occurrenceId.originalLogicalAnchor)
        || typeof value.title !== 'string'
        || value.title.length === 0
        || value.title.length > MAX_TASK_TITLE_LENGTH
        || value.title !== value.title.trim()
        || (value.size !== 'small' && value.size !== 'large')
        || !isCanonicalTaskDeadline(value.deadline)
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

export function taskDeadlinesEqual(left: TaskDeadline, right: TaskDeadline): boolean {
    return left.kind === right.kind
        && (left.kind === 'tba'
            || (left.kind === 'date-only'
                && right.kind === 'date-only'
                && left.date === right.date)
            || (left.kind === 'timed'
                && right.kind === 'timed'
                && left.instant === right.instant
                && left.timeZone === right.timeZone));
}

export function localDateDifferenceDays(later: string, earlier: string): number {
    return (Date.parse(`${later}T00:00:00.000Z`) - Date.parse(`${earlier}T00:00:00.000Z`))
        / MILLISECONDS_PER_DAY;
}

export function projectedTaskOccurrenceDate(anchor: string, weekday: MeetingWeekday): string | null {
    const anchorMilliseconds = Date.parse(`${anchor}T00:00:00.000Z`);
    const anchorWeekday = new Date(anchorMilliseconds).getUTCDay();
    const projectedMilliseconds = anchorMilliseconds
        + (TASK_WEEKDAY_NUMBERS[weekday] - anchorWeekday) * MILLISECONDS_PER_DAY;
    const minimum = Date.parse('0000-01-01T00:00:00.000Z');
    const maximum = Date.parse('9999-12-31T00:00:00.000Z');
    if (projectedMilliseconds < minimum || projectedMilliseconds > maximum) {
        return null;
    }
    return new Date(projectedMilliseconds).toISOString().slice(0, 10);
}

export function segmentContainsTaskAnchor(segment: TaskSegmentProjection, anchor: string): boolean {
    if (segment.logicalStartAnchor === 'once') {
        return anchor === 'once';
    }
    return isCanonicalLocalDate(anchor)
        && anchor >= segment.logicalStartAnchor
        && anchor <= segment.logicalEndAnchor
        && localDateDifferenceDays(anchor, segment.logicalStartAnchor) % 7 === 0;
}

export function taskSegmentFacts(
    segment: TaskSegmentProjection,
    anchor: string,
    termZone: string,
): TaskOccurrenceReplacement | null {
    if (isCanonicalOnlyThisReplacement(segment.replacement)) {
        return anchor === 'once' ? segment.replacement : null;
    }
    if (!isCanonicalLocalDate(anchor)) {
        return null;
    }
    const date = projectedTaskOccurrenceDate(anchor, segment.replacement.weekday);
    if (date === null) {
        return null;
    }
    try {
        return {
            title: segment.replacement.title,
            size: segment.replacement.size,
            deadline: {
                kind: 'timed',
                instant: INTL_ZONE_RULES.resolveInstant(
                    termZone,
                    date,
                    segment.replacement.localDeadlineTime,
                ),
                timeZone: termZone,
            },
        };
    }
    catch {
        return null;
    }
}

export function hasTaskOccurrenceReplacementFacts(
    value: Pick<TaskOccurrenceProjection, 'title' | 'size' | 'deadline'>,
    replacement: TaskOccurrenceReplacement,
): boolean {
    return value.title === replacement.title
        && value.size === replacement.size
        && taskDeadlinesEqual(value.deadline, replacement.deadline);
}

export function taskImpactAnchorIsCoherent(
    anchor: string,
    scope: TaskOccurrenceImpactProjection['scope'],
    originalLogicalAnchor: string | null,
    requestedWindow: TaskOccurrenceWindow,
): boolean {
    if (scope === 'only-this') {
        return anchor === originalLogicalAnchor;
    }
    if (anchor === 'once') {
        return originalLogicalAnchor === null || originalLogicalAnchor === 'once';
    }
    if (originalLogicalAnchor === 'once') {
        return anchor === 'once';
    }
    return isCanonicalLocalDate(anchor)
        && (originalLogicalAnchor === null
            || (anchor >= originalLogicalAnchor
                && localDateDifferenceDays(anchor, originalLogicalAnchor) % 7 === 0))
        && localDateDifferenceDays(anchor, requestedWindow.startDate) >= -6
        && localDateDifferenceDays(requestedWindow.endDate, anchor) >= -6;
}

export function taskImpactOccurrenceListsAreCoherent(
    current: readonly TaskOccurrenceProjection[],
    afterChange: readonly TaskOccurrenceImpactOccurrenceProjection[],
    taskSeriesId: string,
    scope: TaskOccurrenceImpactProjection['scope'],
    action: TaskOccurrenceImpactProjection['action'],
    originalLogicalAnchor: string | null,
    requestedWindow: TaskOccurrenceWindow,
): boolean {
    const listIsCoherent = (
        occurrences: readonly TaskOccurrenceImpactOccurrenceProjection[],
    ): boolean => {
        const occurrenceIds = occurrences.map(occurrence => occurrence.occurrenceId);
        return isOrderedUniqueAnchors(occurrenceIds)
            && occurrences.every(occurrence => (
                occurrence.occurrenceId.taskSeriesId === taskSeriesId
                && taskImpactAnchorIsCoherent(
                    occurrence.occurrenceId.originalLogicalAnchor,
                    scope,
                    originalLogicalAnchor,
                    requestedWindow,
                )
            ));
    };
    const targetIsPresent = scope === 'whole-series'
        || current.some(occurrence => (
            occurrence.occurrenceId.originalLogicalAnchor === originalLogicalAnchor
        ));
    const scopeShapeIsCoherent = scope === 'only-this'
        ? current.length === 1 && afterChange.length === 0
        : action === 'delete'
            ? afterChange.length === 0
            : true;
    return targetIsPresent
        && scopeShapeIsCoherent
        && listIsCoherent(current)
        && listIsCoherent(afterChange);
}

/**
 * Builds the shared canonical receipt projection for Task commands.
 * @param {CreateTaskCommand | UpdateTaskCommand | DeleteTaskCommand | CompleteTaskCommand} command
 * - Canonical Task command.
 * @return {CanonicalValue} Stable receipt digest projection without CommandId.
 */
export function taskDigestProjection(
    command: TaskCommand,
): CanonicalValue {
    const expectedEntityVersions: CanonicalValue[] = [{
        entityKind: 'plan-state',
        entityId: 'singleton',
        version: command.expectedPlanVersion,
    }];
    if ('expectedTaskSeriesVersion' in command) {
        const taskSeriesId = command.intent.payload.taskSeriesId;
        expectedEntityVersions.push({
            entityKind: 'task-series',
            entityId: taskSeriesId,
            version: command.expectedTaskSeriesVersion,
        });
    }
    const projection: Record<string, CanonicalValue> = {
        encoding: 'courseflow-canonical-json-v1',
        intent: command.intent,
        expectedRevision: command.expectedRevision,
        expectedEntityVersions,
        durableFollowUps: [{
            followUpId: command.followUpId,
            owner: 'protect',
            kind: 'backup-needed-through',
        }],
    };
    if ('confirmationToken' in command) {
        projection.confirmationToken = command.confirmationToken;
        projection.impactWindow = command.impactWindow;
    }
    return projection;
}

/**
 * Builds the canonical receipt digest projection for Task creation.
 * @param {CreateTaskCommand} command - Canonical Task creation command.
 * @return {CanonicalValue} Stable receipt digest projection.
 */
export function createTaskDigestProjection(command: CreateTaskCommand): CanonicalValue {
    return taskDigestProjection(command);
}

/**
 * Builds the canonical receipt digest projection for Task edits.
 * @param {UpdateTaskCommand} command - Canonical Task update command.
 * @return {CanonicalValue} Stable receipt digest projection.
 */
export function updateTaskDigestProjection(command: UpdateTaskCommand): CanonicalValue {
    return taskDigestProjection(command);
}

/**
 * Builds the canonical receipt digest projection for Task deletion.
 * @param {DeleteTaskCommand} command - Canonical Task deletion command.
 * @return {CanonicalValue} Stable receipt digest projection.
 */
export function deleteTaskDigestProjection(command: DeleteTaskCommand): CanonicalValue {
    return taskDigestProjection(command);
}

/**
 * Builds the canonical receipt digest projection for once Task completion.
 * @param {CompleteTaskCommand} command - Canonical Task completion command.
 * @return {CanonicalValue} Stable receipt digest projection.
 */
export function completeTaskDigestProjection(command: CompleteTaskCommand): CanonicalValue {
    return taskDigestProjection(command);
}

export function setTaskOccurrenceStatusDigestProjection(
    command: SetTaskOccurrenceStatusCommand,
): CanonicalValue {
    return taskDigestProjection(command);
}

export function setTaskProgressDigestProjection(command: SetTaskProgressCommand): CanonicalValue {
    return taskDigestProjection(command);
}

export function changeTaskOccurrenceDigestProjection(command: ChangeTaskOccurrenceCommand): CanonicalValue {
    return taskDigestProjection(command);
}

export function deleteTaskOccurrenceOrSeriesDigestProjection(
    command: DeleteTaskOccurrenceOrSeriesCommand,
): CanonicalValue {
    return taskDigestProjection(command);
}

export function undoTaskOccurrenceStateDigestProjection(
    command: UndoTaskOccurrenceStateCommand,
): CanonicalValue {
    return taskDigestProjection(command);
}
