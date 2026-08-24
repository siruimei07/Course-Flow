/**
 * @file Defines Task facts, command DTOs, stable identity, and receipt digest projections.
 */

import type { CanonicalValue } from './canonical-json';
import {
    isMeetingOccurrenceWindow,
    normalizeMeetingOccurrenceWindow,
    type MeetingOccurrenceWindow,
    type MeetingWeekday,
} from './workspace-course-contract';
import { INTL_ZONE_RULES, isCanonicalInstant } from './meeting-time';
import {
    isCanonicalUnsignedSqliteInteger,
    isCanonicalUuid,
} from './workspace-data-contract';
import { isCanonicalLocalDate } from './workspace-term-contract';

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

type TaskProjectionBase = Readonly<{
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

type TaskSeriesDetailProjectionBase = Readonly<{
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

type TaskCommandBase = Readonly<{
    commandId: string;
    followUpId: string;
    expectedRevision: string;
    expectedPlanVersion: string;
}>;

type ExistingTaskCommandBase = TaskCommandBase & Readonly<{
    expectedTaskSeriesVersion: string;
}>;

type OnceTaskFacts = Readonly<{
    courseId: string;
    title: string;
    size: TaskSize;
    deadline: TaskDeadline;
}>;

type ScheduledTaskFacts = Readonly<{
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

const MAX_TASK_TITLE_LENGTH = 240;
const TASK_WEEKDAYS = new Set<MeetingWeekday>([
    'MON',
    'TUE',
    'WED',
    'THU',
    'FRI',
    'SAT',
    'SUN',
]);
const LOCAL_TIME_PATTERN = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
const MAX_TASK_OCCURRENCE_ITEMS = 54;
const MAX_TASK_SEGMENT_ITEMS = MAX_TASK_OCCURRENCE_ITEMS;
const MAX_TASK_OVERRIDE_ITEMS = MAX_TASK_OCCURRENCE_ITEMS;
const MAX_TASK_HISTORICAL_STATE_ITEMS = MAX_TASK_OCCURRENCE_ITEMS;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;
const TASK_WEEKDAY_NUMBERS: Readonly<Record<MeetingWeekday, number>> = Object.freeze({
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
 * Rejects sparse arrays and arrays carrying structured-clone properties beyond indexed values.
 * @param {unknown} value - Candidate array crossing the Workspace boundary.
 * @return {boolean} Whether every slot is one enumerable data property and no extras exist.
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
 * Resolves one explicit IANA display zone through the runtime tzdb.
 * @param {unknown} value - Candidate zone value.
 * @return {string | null} Canonical zone, or null when invalid.
 */
function canonicalTimeZone(value: unknown): string | null {
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

/**
 * Normalizes one explicit Task deadline union without assigning a made-up date to TBA.
 * @param {unknown} value - Candidate deadline DTO.
 * @return {TaskDeadline | null} Canonical deadline, or null when invalid.
 */
function normalizeTaskDeadline(value: unknown): TaskDeadline | null {
    if (!hasExactDataKeys(value, ['kind'])) {
        if (!hasExactDataKeys(value, ['kind', 'date'])
            && !hasExactDataKeys(value, ['kind', 'instant', 'timeZone'])) {
            return null;
        }
    }

    if (value.kind === 'tba' && hasExactDataKeys(value, ['kind'])) {
        return { kind: 'tba' };
    }
    if (value.kind === 'date-only'
        && hasExactDataKeys(value, ['kind', 'date'])
        && isCanonicalLocalDate(value.date)) {
        return { kind: 'date-only', date: value.date };
    }
    if (value.kind === 'timed'
        && hasExactDataKeys(value, ['kind', 'instant', 'timeZone'])
        && isCanonicalInstant(value.instant)) {
        const timeZone = canonicalTimeZone(value.timeZone);
        return timeZone === null ? null : { kind: 'timed', instant: value.instant, timeZone };
    }
    return null;
}

/**
 * Validates that a deadline is already in canonical DTO form.
 * @param {unknown} value - Candidate deadline DTO.
 * @return {boolean} Whether the deadline has exact canonical fields.
 */
function isCanonicalTaskDeadline(value: unknown): value is TaskDeadline {
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
 * Normalizes the exact once-or-weekly Task schedule union.
 * @param {unknown} value - Candidate Task schedule.
 * @return {TaskSchedule | null} Canonical schedule, or null when invalid.
 */
export function normalizeTaskSchedule(value: unknown): TaskSchedule | null {
    if (hasExactDataKeys(value, ['kind', 'deadline']) && value.kind === 'once') {
        const deadline = normalizeTaskDeadline(value.deadline);
        return deadline === null ? null : { kind: 'once', deadline };
    }
    if (!hasExactDataKeys(value, [
        'kind',
        'startDate',
        'weekday',
        'localDeadlineTime',
        'confirmedEndDate',
        'followTeachingWeek',
    ])
        || value.kind !== 'weekly'
        || !isCanonicalLocalDate(value.startDate)
        || !TASK_WEEKDAYS.has(value.weekday as MeetingWeekday)
        || typeof value.localDeadlineTime !== 'string'
        || !LOCAL_TIME_PATTERN.test(value.localDeadlineTime)
        || !isCanonicalLocalDate(value.confirmedEndDate)
        || value.confirmedEndDate < value.startDate
        || typeof value.followTeachingWeek !== 'boolean') {
        return null;
    }
    return {
        kind: 'weekly',
        startDate: value.startDate,
        weekday: value.weekday as MeetingWeekday,
        localDeadlineTime: value.localDeadlineTime,
        confirmedEndDate: value.confirmedEndDate,
        followTeachingWeek: value.followTeachingWeek,
    };
}

/**
 * Validates that a schedule is already in canonical DTO form.
 * @param {unknown} value - Candidate Task schedule.
 * @return {boolean} Whether the schedule has exact canonical fields.
 */
function isCanonicalTaskSchedule(value: unknown): value is TaskSchedule {
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
 * Normalizes the bounded physical-date window used to expand Task occurrences.
 * @param {unknown} value - Candidate expansion window.
 * @return {TaskOccurrenceWindow} Frozen canonical window.
 */
export function normalizeTaskOccurrenceWindow(value: unknown): TaskOccurrenceWindow {
    return normalizeMeetingOccurrenceWindow(value);
}

/**
 * Validates the bounded physical-date window used to expand Task occurrences.
 * @param {unknown} value - Candidate expansion window.
 * @return {boolean} Whether the window is exact, canonical, ordered, and bounded.
 */
export function isTaskOccurrenceWindow(value: unknown): value is TaskOccurrenceWindow {
    return isMeetingOccurrenceWindow(value);
}

function hasTaskOccurrenceFacts(value: unknown, expectedKeys: readonly string[]): boolean {
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

function isTaskOccurrenceProjection(value: unknown): value is TaskOccurrenceProjection {
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

function isTaskOccurrenceImpactOccurrenceProjection(
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

function taskDeadlinesEqual(left: TaskDeadline, right: TaskDeadline): boolean {
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

function isCanonicalOnlyThisReplacement(value: unknown): value is TaskOccurrenceReplacement {
    const normalized = normalizeOnlyThisReplacement(value);
    return normalized !== null
        && hasExactDataKeys(value, ['title', 'size', 'deadline'])
        && value.title === normalized.title
        && value.size === normalized.size
        && isCanonicalTaskDeadline(value.deadline)
        && taskDeadlinesEqual(value.deadline, normalized.deadline);
}

function isCanonicalFutureReplacement(value: unknown): value is FutureTaskOccurrenceReplacement {
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

function isTaskSegmentProjection(value: unknown): value is TaskSegmentProjection {
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

function isTaskOccurrenceOverrideProjection(value: unknown): value is TaskOccurrenceOverrideProjection {
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

function isHistoricalTaskOccurrenceState(value: unknown): value is HistoricalTaskOccurrenceState {
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

function localDateDifferenceDays(later: string, earlier: string): number {
    return (Date.parse(`${later}T00:00:00.000Z`) - Date.parse(`${earlier}T00:00:00.000Z`))
        / MILLISECONDS_PER_DAY;
}

function projectedTaskOccurrenceDate(anchor: string, weekday: MeetingWeekday): string | null {
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

function segmentContainsTaskAnchor(segment: TaskSegmentProjection, anchor: string): boolean {
    if (segment.logicalStartAnchor === 'once') {
        return anchor === 'once';
    }
    return isCanonicalLocalDate(anchor)
        && anchor >= segment.logicalStartAnchor
        && anchor <= segment.logicalEndAnchor
        && localDateDifferenceDays(anchor, segment.logicalStartAnchor) % 7 === 0;
}

function taskSegmentFacts(
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

function hasTaskOccurrenceReplacementFacts(
    value: Pick<TaskOccurrenceProjection, 'title' | 'size' | 'deadline'>,
    replacement: TaskOccurrenceReplacement,
): boolean {
    return value.title === replacement.title
        && value.size === replacement.size
        && taskDeadlinesEqual(value.deadline, replacement.deadline);
}

function isOrderedUniqueAnchors(values: readonly TaskOccurrenceId[]): boolean {
    const anchors = values.map(value => value.originalLogicalAnchor);
    return new Set(anchors).size === anchors.length
        && anchors.every((anchor, index) => index === 0 || anchor > anchors[index - 1]!);
}

function isTaskSegmentSequence(
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

/**
 * Normalizes one Course-linked Task fact payload for the requested schema version.
 * @param {unknown} value - Candidate Task facts.
 * @param {boolean} includeTaskSeriesId - Whether the payload targets an existing Task series.
 * @return {TaskFacts & Record<string, unknown> | null} Canonical facts, or null when invalid.
 */
function normalizeTaskFacts(
    value: unknown,
    includeTaskSeriesId: boolean,
    intentSchemaVersion: 1 | 2,
): Record<string, unknown> | null {
    const scheduleKey = intentSchemaVersion === 1 ? 'deadline' : 'schedule';
    const expectedKeys = includeTaskSeriesId
        ? ['taskSeriesId', 'courseId', 'title', 'size', scheduleKey]
        : ['courseId', 'title', 'size', scheduleKey];
    if (!hasExactDataKeys(value, expectedKeys)
        || !isCanonicalUuid(value.courseId)
        || (includeTaskSeriesId && !isCanonicalUuid(value.taskSeriesId))
        || (value.size !== 'small' && value.size !== 'large')) {
        return null;
    }

    const title = typeof value.title === 'string' ? value.title.trim() : '';
    const schedule = intentSchemaVersion === 1
        ? normalizeTaskDeadline(value.deadline)
        : normalizeTaskSchedule(value.schedule);
    if (title.length === 0 || title.length > MAX_TASK_TITLE_LENGTH || schedule === null) {
        return null;
    }

    const facts = intentSchemaVersion === 1
        ? { courseId: value.courseId, title, size: value.size, deadline: schedule }
        : { courseId: value.courseId, title, size: value.size, schedule };
    return includeTaskSeriesId ? { taskSeriesId: value.taskSeriesId, ...facts } : facts;
}

function isTaskOccurrenceAnchor(value: unknown): value is string {
    return value === 'once' || isCanonicalLocalDate(value);
}

function isConfirmationToken(value: unknown): value is string {
    return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isReportedProgress(value: unknown): value is number | null {
    return value === null || (typeof value === 'number'
        && Number.isInteger(value)
        && value >= 0
        && value <= 100);
}

function normalizeOnlyThisReplacement(value: unknown): TaskOccurrenceReplacement | null {
    if (!hasExactDataKeys(value, ['title', 'size', 'deadline'])
        || (value.size !== 'small' && value.size !== 'large')) {
        return null;
    }
    const title = typeof value.title === 'string' ? value.title.trim() : '';
    const deadline = normalizeTaskDeadline(value.deadline);
    return title.length === 0 || title.length > MAX_TASK_TITLE_LENGTH || deadline === null
        ? null
        : { title, size: value.size, deadline };
}

function normalizeFutureReplacement(value: unknown): FutureTaskOccurrenceReplacement | null {
    if (!hasExactDataKeys(value, [
        'title',
        'size',
        'weekday',
        'localDeadlineTime',
        'followTeachingWeek',
    ])
        || (value.size !== 'small' && value.size !== 'large')
        || !TASK_WEEKDAYS.has(value.weekday as MeetingWeekday)
        || typeof value.localDeadlineTime !== 'string'
        || !LOCAL_TIME_PATTERN.test(value.localDeadlineTime)
        || typeof value.followTeachingWeek !== 'boolean') {
        return null;
    }
    const title = typeof value.title === 'string' ? value.title.trim() : '';
    return title.length === 0 || title.length > MAX_TASK_TITLE_LENGTH
        ? null
        : {
            title,
            size: value.size,
            weekday: value.weekday as MeetingWeekday,
            localDeadlineTime: value.localDeadlineTime,
            followTeachingWeek: value.followTeachingWeek,
        };
}

/**
 * Normalizes shared command identity and optimistic-concurrency fields.
 * @param {unknown} value - Candidate command DTO.
 * @param {boolean} requiresTaskSeriesVersion - Whether the command targets an existing Task series.
 * @return {TaskCommandBase & Record<string, unknown>} Canonical shared fields.
 */
function normalizeCommandBase(
    value: unknown,
    requiresTaskSeriesVersion: boolean,
    extraKeys: readonly string[] = [],
): TaskCommandBase & Record<string, unknown> {
    const expectedKeys = requiresTaskSeriesVersion
        ? [
            'commandId',
            'followUpId',
            'expectedRevision',
            'expectedPlanVersion',
            'expectedTaskSeriesVersion',
            'intent',
        ]
        : ['commandId', 'followUpId', 'expectedRevision', 'expectedPlanVersion', 'intent'];
    expectedKeys.push(...extraKeys);
    if (!hasExactDataKeys(value, expectedKeys)
        || !isCanonicalUuid(value.commandId)
        || !isCanonicalUuid(value.followUpId)
        || !isCanonicalUnsignedSqliteInteger(value.expectedRevision)
        || !isCanonicalUnsignedSqliteInteger(value.expectedPlanVersion)
        || (requiresTaskSeriesVersion
            && !isCanonicalUnsignedSqliteInteger(value.expectedTaskSeriesVersion))) {
        throw new TypeError('Task command has invalid fields');
    }
    return value as TaskCommandBase & Record<string, unknown>;
}

/**
 * Derives a stable Task occurrence identity without a stored ordinary occurrence row.
 * @param {string} taskSeriesId - Stable Task series identity.
 * @return {TaskOccurrenceId} Frozen stable tuple identity.
 */
export function deriveTaskOccurrenceId(
    taskSeriesId: string,
    originalLogicalAnchor: string = 'once',
): TaskOccurrenceId {
    if (!isCanonicalUuid(taskSeriesId)
        || (originalLogicalAnchor !== 'once' && !isCanonicalLocalDate(originalLogicalAnchor))) {
        throw new TypeError('TaskOccurrenceId requires a canonical series and logical anchor');
    }
    return Object.freeze({ taskSeriesId, originalLogicalAnchor });
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

/**
 * Normalizes a Course-linked Task creation command.
 * @param {unknown} value - Candidate command DTO.
 * @return {CreateTaskCommand} Canonical Task creation command.
 */
export function normalizeCreateTaskCommand(value: unknown): CreateTaskCommand {
    const base = normalizeCommandBase(value, false);
    if (!hasExactDataKeys(base.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || base.intent.kind !== 'plan.create-task-series'
        || (base.intent.intentSchemaVersion !== 1 && base.intent.intentSchemaVersion !== 2)) {
        throw new TypeError('Create Task command has invalid intent');
    }
    const intentSchemaVersion = base.intent.intentSchemaVersion;
    const task = normalizeTaskFacts(base.intent.payload, false, intentSchemaVersion);
    if (task === null) {
        throw new TypeError('Create Task command has invalid Task facts');
    }
    const command = {
        commandId: base.commandId,
        followUpId: base.followUpId,
        expectedRevision: base.expectedRevision,
        expectedPlanVersion: base.expectedPlanVersion,
        intent: {
            kind: 'plan.create-task-series',
            intentSchemaVersion,
            payload: task,
        },
    };
    return command as CreateTaskCommand;
}

/**
 * Normalizes an existing Task edit command.
 * @param {unknown} value - Candidate command DTO.
 * @return {UpdateTaskCommand} Canonical Task update command.
 */
export function normalizeUpdateTaskCommand(value: unknown): UpdateTaskCommand {
    const base = normalizeCommandBase(value, true);
    if (!hasExactDataKeys(base.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || base.intent.kind !== 'plan.update-task-series'
        || (base.intent.intentSchemaVersion !== 1 && base.intent.intentSchemaVersion !== 2)) {
        throw new TypeError('Update Task command has invalid intent');
    }
    const intentSchemaVersion = base.intent.intentSchemaVersion;
    const task = normalizeTaskFacts(base.intent.payload, true, intentSchemaVersion);
    if (task === null || typeof task.taskSeriesId !== 'string') {
        throw new TypeError('Update Task command has invalid Task facts');
    }
    const payload = intentSchemaVersion === 1
        ? {
            taskSeriesId: task.taskSeriesId,
            courseId: task.courseId,
            title: task.title,
            size: task.size,
            deadline: task.deadline,
        }
        : {
            taskSeriesId: task.taskSeriesId,
            courseId: task.courseId,
            title: task.title,
            size: task.size,
            schedule: task.schedule,
        };
    const command = {
        commandId: base.commandId,
        followUpId: base.followUpId,
        expectedRevision: base.expectedRevision,
        expectedPlanVersion: base.expectedPlanVersion,
        expectedTaskSeriesVersion: base.expectedTaskSeriesVersion as string,
        intent: {
            kind: 'plan.update-task-series',
            intentSchemaVersion,
            payload,
        },
    };
    return command as UpdateTaskCommand;
}

/**
 * Normalizes a Task series deletion command.
 * @param {unknown} value - Candidate command DTO.
 * @return {DeleteTaskCommand} Canonical Task deletion command.
 */
export function normalizeDeleteTaskCommand(value: unknown): DeleteTaskCommand {
    const base = normalizeCommandBase(value, true);
    if (!hasExactDataKeys(base.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || base.intent.kind !== 'plan.delete-task-series'
        || base.intent.intentSchemaVersion !== 1
        || !hasExactDataKeys(base.intent.payload, ['taskSeriesId'])
        || !isCanonicalUuid(base.intent.payload.taskSeriesId)) {
        throw new TypeError('Delete Task command has invalid fields');
    }
    return {
        commandId: base.commandId,
        followUpId: base.followUpId,
        expectedRevision: base.expectedRevision,
        expectedPlanVersion: base.expectedPlanVersion,
        expectedTaskSeriesVersion: base.expectedTaskSeriesVersion as string,
        intent: {
            kind: 'plan.delete-task-series',
            intentSchemaVersion: 1,
            payload: { taskSeriesId: base.intent.payload.taskSeriesId },
        },
    };
}

/**
 * Normalizes the single approved status change for a once Task occurrence.
 * @param {unknown} value - Candidate command DTO.
 * @return {CompleteTaskCommand} Canonical Task completion command.
 */
export function normalizeCompleteTaskCommand(value: unknown): CompleteTaskCommand {
    const base = normalizeCommandBase(value, true);
    if (!hasExactDataKeys(base.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || base.intent.kind !== 'plan.set-task-occurrence-status'
        || base.intent.intentSchemaVersion !== 1
        || !hasExactDataKeys(base.intent.payload, [
            'taskSeriesId',
            'originalLogicalAnchor',
            'status',
        ])
        || !isCanonicalUuid(base.intent.payload.taskSeriesId)
        || base.intent.payload.originalLogicalAnchor !== 'once'
        || base.intent.payload.status !== 'completed') {
        throw new TypeError('Complete Task command has invalid fields');
    }
    return {
        commandId: base.commandId,
        followUpId: base.followUpId,
        expectedRevision: base.expectedRevision,
        expectedPlanVersion: base.expectedPlanVersion,
        expectedTaskSeriesVersion: base.expectedTaskSeriesVersion as string,
        intent: {
            kind: 'plan.set-task-occurrence-status',
            intentSchemaVersion: 1,
            payload: {
                taskSeriesId: base.intent.payload.taskSeriesId,
                originalLogicalAnchor: 'once',
                status: 'completed',
            },
        },
    };
}

export function normalizeSetTaskOccurrenceStatusCommand(value: unknown): SetTaskOccurrenceStatusCommand {
    const base = normalizeCommandBase(value, true);
    if (!hasExactDataKeys(base.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || base.intent.kind !== 'plan.set-task-occurrence-status'
        || base.intent.intentSchemaVersion !== 2
        || !hasExactDataKeys(base.intent.payload, [
            'taskSeriesId',
            'originalLogicalAnchor',
            'status',
        ])
        || !isCanonicalUuid(base.intent.payload.taskSeriesId)
        || !isTaskOccurrenceAnchor(base.intent.payload.originalLogicalAnchor)
        || (base.intent.payload.status !== 'pending'
            && base.intent.payload.status !== 'completed'
            && base.intent.payload.status !== 'skipped')) {
        throw new TypeError('SetTaskOccurrenceStatusCommand has invalid fields');
    }
    return {
        commandId: base.commandId,
        followUpId: base.followUpId,
        expectedRevision: base.expectedRevision,
        expectedPlanVersion: base.expectedPlanVersion,
        expectedTaskSeriesVersion: base.expectedTaskSeriesVersion as string,
        intent: {
            kind: 'plan.set-task-occurrence-status',
            intentSchemaVersion: 2,
            payload: {
                taskSeriesId: base.intent.payload.taskSeriesId,
                originalLogicalAnchor: base.intent.payload.originalLogicalAnchor,
                status: base.intent.payload.status,
            },
        },
    };
}

export function normalizeSetTaskProgressCommand(value: unknown): SetTaskProgressCommand {
    const base = normalizeCommandBase(value, true);
    if (!hasExactDataKeys(base.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || base.intent.kind !== 'plan.set-task-progress'
        || base.intent.intentSchemaVersion !== 1
        || !hasExactDataKeys(base.intent.payload, [
            'taskSeriesId',
            'originalLogicalAnchor',
            'reportedProgress',
        ])
        || !isCanonicalUuid(base.intent.payload.taskSeriesId)
        || !isTaskOccurrenceAnchor(base.intent.payload.originalLogicalAnchor)
        || !isReportedProgress(base.intent.payload.reportedProgress)) {
        throw new TypeError('SetTaskProgressCommand has invalid fields');
    }
    return {
        commandId: base.commandId,
        followUpId: base.followUpId,
        expectedRevision: base.expectedRevision,
        expectedPlanVersion: base.expectedPlanVersion,
        expectedTaskSeriesVersion: base.expectedTaskSeriesVersion as string,
        intent: {
            kind: 'plan.set-task-progress',
            intentSchemaVersion: 1,
            payload: {
                taskSeriesId: base.intent.payload.taskSeriesId,
                originalLogicalAnchor: base.intent.payload.originalLogicalAnchor,
                reportedProgress: base.intent.payload.reportedProgress,
            },
        },
    };
}

export function normalizeChangeTaskOccurrenceCommand(value: unknown): ChangeTaskOccurrenceCommand {
    const base = normalizeCommandBase(value, true, ['confirmationToken', 'impactWindow']);
    if (!hasExactDataKeys(base, [
        'commandId',
        'followUpId',
        'confirmationToken',
        'impactWindow',
        'expectedRevision',
        'expectedPlanVersion',
        'expectedTaskSeriesVersion',
        'intent',
    ])
        || !hasExactDataKeys(base.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || base.intent.kind !== 'plan.change-task-occurrence'
        || base.intent.intentSchemaVersion !== 1
        || !hasExactDataKeys(base.intent.payload, [
            'taskSeriesId',
            'originalLogicalAnchor',
            'scope',
            'replacement',
        ])
        || !isCanonicalUuid(base.intent.payload.taskSeriesId)
        || !isTaskOccurrenceAnchor(base.intent.payload.originalLogicalAnchor)
        || (base.confirmationToken !== null && !isConfirmationToken(base.confirmationToken))
        || (base.impactWindow !== null && !isTaskOccurrenceWindow(base.impactWindow))) {
        throw new TypeError('ChangeTaskOccurrenceCommand has invalid fields');
    }
    const isFuture = base.intent.payload.scope === 'this-and-future';
    const replacement = isFuture
        ? normalizeFutureReplacement(base.intent.payload.replacement)
        : normalizeOnlyThisReplacement(base.intent.payload.replacement);
    if ((base.intent.payload.scope !== 'only-this' && !isFuture)
        || replacement === null
        || (isFuture !== (base.confirmationToken !== null && base.impactWindow !== null))) {
        throw new TypeError('ChangeTaskOccurrenceCommand has invalid scoped facts');
    }
    return {
        commandId: base.commandId,
        followUpId: base.followUpId,
        confirmationToken: base.confirmationToken as string | null,
        impactWindow: base.impactWindow === null
            ? null
            : Object.freeze({ ...base.impactWindow as TaskOccurrenceWindow }),
        expectedRevision: base.expectedRevision,
        expectedPlanVersion: base.expectedPlanVersion,
        expectedTaskSeriesVersion: base.expectedTaskSeriesVersion as string,
        intent: {
            kind: 'plan.change-task-occurrence',
            intentSchemaVersion: 1,
            payload: isFuture
                ? {
                    taskSeriesId: base.intent.payload.taskSeriesId,
                    originalLogicalAnchor: base.intent.payload.originalLogicalAnchor,
                    scope: 'this-and-future',
                    replacement: replacement as FutureTaskOccurrenceReplacement,
                }
                : {
                    taskSeriesId: base.intent.payload.taskSeriesId,
                    originalLogicalAnchor: base.intent.payload.originalLogicalAnchor,
                    scope: 'only-this',
                    replacement: replacement as TaskOccurrenceReplacement,
                },
        },
    };
}

export function normalizeDeleteTaskOccurrenceOrSeriesCommand(
    value: unknown,
): DeleteTaskOccurrenceOrSeriesCommand {
    const base = normalizeCommandBase(value, true, ['confirmationToken', 'impactWindow']);
    if (!hasExactDataKeys(base, [
        'commandId',
        'followUpId',
        'confirmationToken',
        'impactWindow',
        'expectedRevision',
        'expectedPlanVersion',
        'expectedTaskSeriesVersion',
        'intent',
    ])
        || !hasExactDataKeys(base.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || (base.confirmationToken !== null && !isConfirmationToken(base.confirmationToken))
        || (base.impactWindow !== null && !isTaskOccurrenceWindow(base.impactWindow))) {
        throw new TypeError('DeleteTaskOccurrenceOrSeriesCommand has invalid fields');
    }
    const payload = base.intent.payload;
    if (base.intent.kind !== 'plan.delete-task-occurrence-or-series'
        || base.intent.intentSchemaVersion !== 1
        || !hasExactDataKeys(payload, ['taskSeriesId', 'scope'])
            && !hasExactDataKeys(payload, ['taskSeriesId', 'originalLogicalAnchor', 'scope'])
        || !isCanonicalUuid(payload.taskSeriesId)) {
        throw new TypeError('DeleteTaskOccurrenceOrSeriesCommand has invalid payload');
    }
    const isWholeSeries = hasExactDataKeys(payload, ['taskSeriesId', 'scope'])
        && payload.scope === 'whole-series';
    const isScoped = hasExactDataKeys(payload, ['taskSeriesId', 'originalLogicalAnchor', 'scope'])
        && (payload.scope === 'only-this' || payload.scope === 'this-and-future')
        && isTaskOccurrenceAnchor(payload.originalLogicalAnchor);
    if ((!isWholeSeries && !isScoped)
        || base.confirmationToken === null
        || base.impactWindow === null) {
        throw new TypeError('DeleteTaskOccurrenceOrSeriesCommand has invalid scope');
    }
    const canonicalPayload = isWholeSeries
        ? { taskSeriesId: payload.taskSeriesId, scope: 'whole-series' as const }
        : {
            taskSeriesId: payload.taskSeriesId,
            originalLogicalAnchor: payload.originalLogicalAnchor as string,
            scope: payload.scope as 'only-this' | 'this-and-future',
        };
    return {
        commandId: base.commandId,
        followUpId: base.followUpId,
        confirmationToken: base.confirmationToken,
        impactWindow: Object.freeze({ ...base.impactWindow as TaskOccurrenceWindow }),
        expectedRevision: base.expectedRevision,
        expectedPlanVersion: base.expectedPlanVersion,
        expectedTaskSeriesVersion: base.expectedTaskSeriesVersion as string,
        intent: {
            kind: 'plan.delete-task-occurrence-or-series',
            intentSchemaVersion: 1,
            payload: canonicalPayload,
        },
    } as DeleteTaskOccurrenceOrSeriesCommand;
}

export function normalizeUndoTaskOccurrenceStateCommand(value: unknown): UndoTaskOccurrenceStateCommand {
    const base = normalizeCommandBase(value, true);
    if (!hasExactDataKeys(base.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || base.intent.kind !== 'plan.undo-task-occurrence-state'
        || base.intent.intentSchemaVersion !== 1
        || !hasExactDataKeys(base.intent.payload, ['token', 'taskSeriesId', 'originalLogicalAnchor'])
        || !isConfirmationToken(base.intent.payload.token)
        || !isCanonicalUuid(base.intent.payload.taskSeriesId)
        || !isTaskOccurrenceAnchor(base.intent.payload.originalLogicalAnchor)) {
        throw new TypeError('UndoTaskOccurrenceStateCommand has invalid fields');
    }
    return {
        commandId: base.commandId,
        followUpId: base.followUpId,
        expectedRevision: base.expectedRevision,
        expectedPlanVersion: base.expectedPlanVersion,
        expectedTaskSeriesVersion: base.expectedTaskSeriesVersion as string,
        intent: {
            kind: 'plan.undo-task-occurrence-state',
            intentSchemaVersion: 1,
            payload: {
                token: base.intent.payload.token,
                taskSeriesId: base.intent.payload.taskSeriesId,
                originalLogicalAnchor: base.intent.payload.originalLogicalAnchor,
            },
        },
    };
}

export function normalizeTaskOccurrenceImpactDraft(value: unknown): TaskOccurrenceImpactDraft {
    if (hasExactDataKeys(value, [
        'scope',
        'taskSeriesId',
        'action',
        'requestedWindow',
    ])) {
        if (value.scope !== 'whole-series'
            || value.action !== 'delete'
            || !isCanonicalUuid(value.taskSeriesId)
            || !isTaskOccurrenceWindow(value.requestedWindow)) {
            throw new TypeError('Task occurrence impact draft has invalid whole-series scope');
        }
        return Object.freeze({
            scope: 'whole-series',
            taskSeriesId: value.taskSeriesId,
            action: 'delete',
            requestedWindow: Object.freeze({ ...value.requestedWindow }),
        });
    }
    if (hasExactDataKeys(value, [
        'scope',
        'taskSeriesId',
        'originalLogicalAnchor',
        'action',
        'replacement',
        'requestedWindow',
    ])) {
        if (value.scope !== 'this-and-future'
            || value.action !== 'change'
            || !isCanonicalUuid(value.taskSeriesId)
            || !isTaskOccurrenceAnchor(value.originalLogicalAnchor)
            || !isTaskOccurrenceWindow(value.requestedWindow)) {
            throw new TypeError('Task occurrence impact draft has invalid change scope');
        }
        const replacement = normalizeFutureReplacement(value.replacement);
        if (replacement === null) {
            throw new TypeError('Task occurrence impact draft has invalid replacement');
        }
        return Object.freeze({
            scope: 'this-and-future',
            taskSeriesId: value.taskSeriesId,
            originalLogicalAnchor: value.originalLogicalAnchor,
            action: 'change',
            replacement: Object.freeze(replacement),
            requestedWindow: Object.freeze({ ...value.requestedWindow }),
        });
    }
    if (hasExactDataKeys(value, [
        'scope',
        'taskSeriesId',
        'originalLogicalAnchor',
        'action',
        'requestedWindow',
    ])) {
        if ((value.scope !== 'only-this' && value.scope !== 'this-and-future')
            || value.action !== 'delete'
            || !isCanonicalUuid(value.taskSeriesId)
            || !isTaskOccurrenceAnchor(value.originalLogicalAnchor)
            || !isTaskOccurrenceWindow(value.requestedWindow)) {
            throw new TypeError('Task occurrence impact draft has invalid delete scope');
        }
        return Object.freeze({
            scope: value.scope,
            taskSeriesId: value.taskSeriesId,
            originalLogicalAnchor: value.originalLogicalAnchor,
            action: 'delete',
            requestedWindow: Object.freeze({ ...value.requestedWindow }),
        });
    }
    throw new TypeError('Task occurrence impact draft has invalid fields');
}

function taskImpactAnchorIsCoherent(
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

function taskImpactOccurrenceListsAreCoherent(
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

function isTaskImpactPreviewMetadata(value: unknown): boolean {
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

/**
 * Builds the shared canonical receipt projection for Task commands.
 * @param {CreateTaskCommand | UpdateTaskCommand | DeleteTaskCommand | CompleteTaskCommand} command
 * - Canonical Task command.
 * @return {CanonicalValue} Stable receipt digest projection without CommandId.
 */
function taskDigestProjection(
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
