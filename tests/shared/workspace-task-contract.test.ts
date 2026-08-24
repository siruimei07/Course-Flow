/**
 * @file Verifies once-task command normalization, stable identity, and receipt digests.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    completeTaskDigestProjection,
    createTaskDigestProjection,
    deleteTaskDigestProjection,
    deriveTaskOccurrenceId,
    isTaskProjection,
    normalizeCompleteTaskCommand,
    normalizeCreateTaskCommand,
    normalizeDeleteTaskCommand,
    normalizeUpdateTaskCommand,
    updateTaskDigestProjection,
} from '../../src/shared/workspace-task-contract';

const COURSE_ID = '22222222-2222-4222-8222-222222222222';
const TASK_SERIES_ID = '33333333-3333-4333-8333-333333333333';
const COMMAND_BASE = {
    commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    followUpId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    expectedRevision: '7',
    expectedPlanVersion: '7',
} as const;

const CREATE_COMMAND = {
    ...COMMAND_BASE,
    intent: {
        kind: 'plan.create-task-series',
        intentSchemaVersion: 1,
        payload: {
            courseId: COURSE_ID,
            title: '  Read Chapter 1  ',
            size: 'small',
            deadline: { kind: 'date-only', date: '2026-09-15' },
        },
    },
} as const;

test('A-TASK-001–003: CreateTask normalizes one Course-linked once Task', () => {
    const normalized = normalizeCreateTaskCommand(CREATE_COMMAND);

    assert.deepEqual(normalized.intent, {
        kind: 'plan.create-task-series',
        intentSchemaVersion: 1,
        payload: {
            courseId: COURSE_ID,
            title: 'Read Chapter 1',
            size: 'small',
            deadline: { kind: 'date-only', date: '2026-09-15' },
        },
    });
});

test('A-TASK-002/003: once Task accepts each exact size and Deadline union variant', () => {
    for (const payload of [
        { ...CREATE_COMMAND.intent.payload, size: 'large', deadline: { kind: 'tba' } },
        {
            ...CREATE_COMMAND.intent.payload,
            deadline: {
                kind: 'timed',
                instant: '2026-09-15T23:59:59.999Z',
                timeZone: 'America/Toronto',
            },
        },
    ] as const) {
        assert.deepEqual(
            normalizeCreateTaskCommand({
                ...CREATE_COMMAND,
                intent: { ...CREATE_COMMAND.intent, payload },
            }).intent.payload,
            { ...payload, title: 'Read Chapter 1' },
        );
    }
});

test('IF-PLAN-COMMAND: update, delete, and complete bind one existing TaskSeries version', () => {
    const update = normalizeUpdateTaskCommand({
        ...COMMAND_BASE,
        expectedTaskSeriesVersion: '3',
        intent: {
            kind: 'plan.update-task-series',
            intentSchemaVersion: 1,
            payload: {
                taskSeriesId: TASK_SERIES_ID,
                courseId: COURSE_ID,
                title: 'Read Chapter 2',
                size: 'large',
                deadline: { kind: 'tba' },
            },
        },
    });
    const deleted = normalizeDeleteTaskCommand({
        ...COMMAND_BASE,
        expectedTaskSeriesVersion: '3',
        intent: {
            kind: 'plan.delete-task-series',
            intentSchemaVersion: 1,
            payload: { taskSeriesId: TASK_SERIES_ID },
        },
    });
    const completed = normalizeCompleteTaskCommand({
        ...COMMAND_BASE,
        expectedTaskSeriesVersion: '3',
        intent: {
            kind: 'plan.set-task-occurrence-status',
            intentSchemaVersion: 1,
            payload: {
                taskSeriesId: TASK_SERIES_ID,
                originalLogicalAnchor: 'once',
                status: 'completed',
            },
        },
    });

    assert.equal(update.expectedTaskSeriesVersion, '3');
    assert.equal(deleted.intent.payload.taskSeriesId, TASK_SERIES_ID);
    assert.equal(completed.intent.payload.status, 'completed');
});

test('TEST-PLAN-001: active once Task identity and projection use the stable once anchor', () => {
    const occurrenceId = deriveTaskOccurrenceId(TASK_SERIES_ID);
    const projection = {
        taskSeriesId: TASK_SERIES_ID,
        courseId: COURSE_ID,
        title: 'Read Chapter 1',
        size: 'small',
        deadline: { kind: 'date-only', date: '2026-09-15' },
        occurrenceId,
        status: 'pending',
        entityVersion: '3',
    } as const;

    assert.deepEqual(occurrenceId, {
        taskSeriesId: TASK_SERIES_ID,
        originalLogicalAnchor: 'once',
    });
    assert.equal(Object.isFrozen(occurrenceId), true);
    assert.equal(isTaskProjection(projection), true);
    assert.equal(isTaskProjection({ ...projection, status: 'skipped' }), false);
    assert.equal(isTaskProjection({
        ...projection,
        occurrenceId: { ...occurrenceId, originalLogicalAnchor: '2026-09-15' },
    }), false);
});

test('A-TASK-001–003: commands reject unknown fields and non-canonical once facts', () => {
    for (const command of [
        { ...CREATE_COMMAND, unexpected: true },
        {
            ...CREATE_COMMAND,
            intent: {
                ...CREATE_COMMAND.intent,
                payload: { ...CREATE_COMMAND.intent.payload, courseId: 'not-an-id' },
            },
        },
        {
            ...CREATE_COMMAND,
            intent: {
                ...CREATE_COMMAND.intent,
                payload: { ...CREATE_COMMAND.intent.payload, deadline: { kind: 'date-only', date: '2026-02-30' } },
            },
        },
        {
            ...CREATE_COMMAND,
            intent: {
                ...CREATE_COMMAND.intent,
                payload: {
                    ...CREATE_COMMAND.intent.payload,
                    deadline: { kind: 'timed', instant: '2026-09-15T23:59:59.999Z', timeZone: 'Toronto/Local' },
                },
            },
        },
    ]) {
        assert.throws(() => normalizeCreateTaskCommand(command), TypeError);
    }
    assert.throws(() => normalizeCompleteTaskCommand({
        ...COMMAND_BASE,
        expectedTaskSeriesVersion: '3',
        intent: {
            kind: 'plan.set-task-occurrence-status',
            intentSchemaVersion: 1,
            payload: {
                taskSeriesId: TASK_SERIES_ID,
                originalLogicalAnchor: '2026-09-15',
                status: 'completed',
            },
        },
    }), TypeError);
});

test('TEST-DATA-002: Task digests bind facts and versions without CommandId', () => {
    const created = normalizeCreateTaskCommand(CREATE_COMMAND);
    const updated = normalizeUpdateTaskCommand({
        ...COMMAND_BASE,
        expectedTaskSeriesVersion: '3',
        intent: {
            kind: 'plan.update-task-series',
            intentSchemaVersion: 1,
            payload: {
                taskSeriesId: TASK_SERIES_ID,
                courseId: COURSE_ID,
                title: 'Read Chapter 2',
                size: 'large',
                deadline: { kind: 'tba' },
            },
        },
    });
    const deleted = normalizeDeleteTaskCommand({
        ...COMMAND_BASE,
        expectedTaskSeriesVersion: '3',
        intent: {
            kind: 'plan.delete-task-series',
            intentSchemaVersion: 1,
            payload: { taskSeriesId: TASK_SERIES_ID },
        },
    });
    const completed = normalizeCompleteTaskCommand({
        ...COMMAND_BASE,
        expectedTaskSeriesVersion: '3',
        intent: {
            kind: 'plan.set-task-occurrence-status',
            intentSchemaVersion: 1,
            payload: {
                taskSeriesId: TASK_SERIES_ID,
                originalLogicalAnchor: 'once',
                status: 'completed',
            },
        },
    });

    assert.equal(JSON.stringify(createTaskDigestProjection(created)).includes(created.commandId), false);
    assert.deepEqual(updateTaskDigestProjection(updated), {
        encoding: 'courseflow-canonical-json-v1',
        intent: updated.intent,
        expectedRevision: '7',
        expectedEntityVersions: [
            { entityKind: 'plan-state', entityId: 'singleton', version: '7' },
            { entityKind: 'task-series', entityId: TASK_SERIES_ID, version: '3' },
        ],
        durableFollowUps: [{
            followUpId: COMMAND_BASE.followUpId,
            owner: 'protect',
            kind: 'backup-needed-through',
        }],
    });
    const deleteProjection = deleteTaskDigestProjection(deleted) as Readonly<{
        expectedEntityVersions: unknown;
    }>;
    const completeProjection = completeTaskDigestProjection(completed) as Readonly<{
        intent: unknown;
    }>;
    assert.deepEqual(deleteProjection.expectedEntityVersions, [
        { entityKind: 'plan-state', entityId: 'singleton', version: '7' },
        { entityKind: 'task-series', entityId: TASK_SERIES_ID, version: '3' },
    ]);
    assert.deepEqual(completeProjection.intent, completed.intent);
});
