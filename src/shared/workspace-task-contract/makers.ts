import { isCanonicalInstant } from '../meeting-time';
import { MeetingWeekday, normalizeMeetingOccurrenceWindow } from '../workspace-course-contract';
import { isCanonicalUnsignedSqliteInteger, isCanonicalUuid } from '../workspace-data-contract';
import { ChangeTaskOccurrenceCommand, CompleteTaskCommand, CreateTaskCommand, DeleteTaskCommand, DeleteTaskOccurrenceOrSeriesCommand, SetTaskOccurrenceStatusCommand, SetTaskProgressCommand, TaskDeadline, TaskOccurrenceId, TaskOccurrenceImpactDraft, TaskOccurrenceReplacement, TaskOccurrenceWindow, TaskSchedule, UndoTaskOccurrenceStateCommand, UpdateTaskCommand, isTaskOccurrenceWindow } from '../workspace-task-contract';
import { isConfirmationToken, isReportedProgress, isTaskOccurrenceAnchor } from './guards';
import { LOCAL_TIME_PATTERN, MAX_TASK_TITLE_LENGTH, TASK_WEEKDAYS, canonicalTimeZone, hasExactDataKeys } from './types';
import type { FutureTaskOccurrenceReplacement, TaskCommandBase } from './types';
import { isCanonicalLocalDate } from '../workspace-term-contract';
/**
 * Normalizes one explicit Task deadline union without assigning a made-up date to TBA.
 * @param {unknown} value - Candidate deadline DTO.
 * @return {TaskDeadline | null} Canonical deadline, or null when invalid.
 */
export function normalizeTaskDeadline(value: unknown): TaskDeadline | null {
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
 * Normalizes the bounded physical-date window used to expand Task occurrences.
 * @param {unknown} value - Candidate expansion window.
 * @return {TaskOccurrenceWindow} Frozen canonical window.
 */
export function normalizeTaskOccurrenceWindow(value: unknown): TaskOccurrenceWindow {
    return normalizeMeetingOccurrenceWindow(value);
}

/**
 * Normalizes one Course-linked Task fact payload for the requested schema version.
 * @param {unknown} value - Candidate Task facts.
 * @param {boolean} includeTaskSeriesId - Whether the payload targets an existing Task series.
 * @return {TaskFacts & Record<string, unknown> | null} Canonical facts, or null when invalid.
 */
export function normalizeTaskFacts(
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

export function normalizeOnlyThisReplacement(value: unknown): TaskOccurrenceReplacement | null {
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

export function normalizeFutureReplacement(value: unknown): FutureTaskOccurrenceReplacement | null {
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
export function normalizeCommandBase(
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
