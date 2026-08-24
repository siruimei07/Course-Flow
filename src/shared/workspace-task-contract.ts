/**
 * @file Defines once-task facts, command DTOs, stable identity, and receipt digest projections.
 */

import type { CanonicalValue } from './canonical-json';
import { isCanonicalInstant } from './meeting-time';
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

export type TaskOccurrenceId = Readonly<{
    taskSeriesId: string;
    originalLogicalAnchor: 'once';
}>;

export type TaskProjection = Readonly<{
    taskSeriesId: string;
    courseId: string;
    title: string;
    size: TaskSize;
    deadline: TaskDeadline;
    occurrenceId: TaskOccurrenceId;
    status: 'pending' | 'completed';
    entityVersion: string;
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

type TaskFacts = Readonly<{
    courseId: string;
    title: string;
    size: TaskSize;
    deadline: TaskDeadline;
}>;

export type CreateTaskCommand = TaskCommandBase & Readonly<{
    intent: Readonly<{
        kind: 'plan.create-task-series';
        intentSchemaVersion: 1;
        payload: TaskFacts;
    }>;
}>;

export type UpdateTaskCommand = ExistingTaskCommandBase & Readonly<{
    intent: Readonly<{
        kind: 'plan.update-task-series';
        intentSchemaVersion: 1;
        payload: TaskFacts & Readonly<{ taskSeriesId: string }>;
    }>;
}>;

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

export type TaskCommand =
    | CreateTaskCommand
    | UpdateTaskCommand
    | DeleteTaskCommand
    | CompleteTaskCommand;

const MAX_TASK_TITLE_LENGTH = 240;

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
 * Normalizes one Course-linked once-task fact payload.
 * @param {unknown} value - Candidate Task facts.
 * @param {boolean} includeTaskSeriesId - Whether the payload targets an existing Task series.
 * @return {TaskFacts & Record<string, unknown> | null} Canonical facts, or null when invalid.
 */
function normalizeTaskFacts(
    value: unknown,
    includeTaskSeriesId: boolean,
): (TaskFacts & Record<string, unknown>) | null {
    const expectedKeys = includeTaskSeriesId
        ? ['taskSeriesId', 'courseId', 'title', 'size', 'deadline']
        : ['courseId', 'title', 'size', 'deadline'];
    if (!hasExactDataKeys(value, expectedKeys)
        || !isCanonicalUuid(value.courseId)
        || (includeTaskSeriesId && !isCanonicalUuid(value.taskSeriesId))
        || (value.size !== 'small' && value.size !== 'large')) {
        return null;
    }

    const title = typeof value.title === 'string' ? value.title.trim() : '';
    const deadline = normalizeTaskDeadline(value.deadline);
    if (title.length === 0 || title.length > MAX_TASK_TITLE_LENGTH || deadline === null) {
        return null;
    }

    return includeTaskSeriesId
        ? { taskSeriesId: value.taskSeriesId, courseId: value.courseId, title, size: value.size, deadline }
        : { courseId: value.courseId, title, size: value.size, deadline };
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
 * Derives the once-task occurrence identity without a stored occurrence row.
 * @param {string} taskSeriesId - Stable Task series identity.
 * @return {TaskOccurrenceId} Frozen stable tuple identity.
 */
export function deriveTaskOccurrenceId(taskSeriesId: string): TaskOccurrenceId {
    if (!isCanonicalUuid(taskSeriesId)) {
        throw new TypeError('TaskOccurrenceId requires a canonical TaskSeriesId');
    }
    return Object.freeze({ taskSeriesId, originalLogicalAnchor: 'once' });
}

/**
 * Validates the active once-task projection crossing the Workspace query seam.
 * @param {unknown} value - Candidate Task projection.
 * @return {boolean} Whether the projection is exact and canonical.
 */
export function isTaskProjection(value: unknown): value is TaskProjection {
    if (!hasExactDataKeys(value, [
        'taskSeriesId',
        'courseId',
        'title',
        'size',
        'deadline',
        'occurrenceId',
        'status',
        'entityVersion',
    ])
        || !isCanonicalUuid(value.taskSeriesId)
        || !isCanonicalUuid(value.courseId)
        || typeof value.title !== 'string'
        || value.title.length === 0
        || value.title.length > MAX_TASK_TITLE_LENGTH
        || value.title !== value.title.trim()
        || (value.size !== 'small' && value.size !== 'large')
        || !isCanonicalTaskDeadline(value.deadline)
        || !hasExactDataKeys(value.occurrenceId, ['taskSeriesId', 'originalLogicalAnchor'])
        || value.occurrenceId.taskSeriesId !== value.taskSeriesId
        || value.occurrenceId.originalLogicalAnchor !== 'once'
        || (value.status !== 'pending' && value.status !== 'completed')
        || !isCanonicalUnsignedSqliteInteger(value.entityVersion)
        || value.entityVersion === '0') {
        return false;
    }
    return true;
}

/**
 * Normalizes a Course-linked once Task creation command.
 * @param {unknown} value - Candidate command DTO.
 * @return {CreateTaskCommand} Canonical Task creation command.
 */
export function normalizeCreateTaskCommand(value: unknown): CreateTaskCommand {
    const base = normalizeCommandBase(value, false);
    if (!hasExactDataKeys(base.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || base.intent.kind !== 'plan.create-task-series'
        || base.intent.intentSchemaVersion !== 1) {
        throw new TypeError('Create Task command has invalid intent');
    }
    const task = normalizeTaskFacts(base.intent.payload, false);
    if (task === null) {
        throw new TypeError('Create Task command has invalid Task facts');
    }
    return {
        commandId: base.commandId,
        followUpId: base.followUpId,
        expectedRevision: base.expectedRevision,
        expectedPlanVersion: base.expectedPlanVersion,
        intent: {
            kind: 'plan.create-task-series',
            intentSchemaVersion: 1,
            payload: task,
        },
    };
}

/**
 * Normalizes an existing once Task edit command.
 * @param {unknown} value - Candidate command DTO.
 * @return {UpdateTaskCommand} Canonical Task update command.
 */
export function normalizeUpdateTaskCommand(value: unknown): UpdateTaskCommand {
    const base = normalizeCommandBase(value, true);
    if (!hasExactDataKeys(base.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || base.intent.kind !== 'plan.update-task-series'
        || base.intent.intentSchemaVersion !== 1) {
        throw new TypeError('Update Task command has invalid intent');
    }
    const task = normalizeTaskFacts(base.intent.payload, true);
    if (task === null || typeof task.taskSeriesId !== 'string') {
        throw new TypeError('Update Task command has invalid Task facts');
    }
    return {
        commandId: base.commandId,
        followUpId: base.followUpId,
        expectedRevision: base.expectedRevision,
        expectedPlanVersion: base.expectedPlanVersion,
        expectedTaskSeriesVersion: base.expectedTaskSeriesVersion as string,
        intent: {
            kind: 'plan.update-task-series',
            intentSchemaVersion: 1,
            payload: {
                taskSeriesId: task.taskSeriesId,
                courseId: task.courseId,
                title: task.title,
                size: task.size,
                deadline: task.deadline,
            },
        },
    };
}

/**
 * Normalizes a once Task series deletion command.
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

/**
 * Builds the shared canonical receipt projection for Task commands.
 * @param {CreateTaskCommand | UpdateTaskCommand | DeleteTaskCommand | CompleteTaskCommand} command
 * - Canonical Task command.
 * @return {CanonicalValue} Stable receipt digest projection without CommandId.
 */
function taskDigestProjection(
    command: CreateTaskCommand | UpdateTaskCommand | DeleteTaskCommand | CompleteTaskCommand,
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
    return {
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
