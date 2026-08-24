/**
 * @file Verifies Task command normalization, stable identity, and receipt digests.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    completeTaskDigestProjection,
    changeTaskOccurrenceDigestProjection,
    createTaskDigestProjection,
    deleteTaskOccurrenceOrSeriesDigestProjection,
    deleteTaskDigestProjection,
    deriveTaskOccurrenceId,
    isTaskOccurrenceImpactProjection,
    isTaskProjection,
    isTaskSeriesDetailProjection,
    normalizeCompleteTaskCommand,
    normalizeChangeTaskOccurrenceCommand,
    normalizeCreateTaskCommand,
    normalizeDeleteTaskOccurrenceOrSeriesCommand,
    normalizeDeleteTaskCommand,
    normalizeSetTaskOccurrenceStatusCommand,
    normalizeSetTaskProgressCommand,
    normalizeTaskOccurrenceImpactDraft,
    normalizeUndoTaskOccurrenceStateCommand,
    setTaskOccurrenceStatusDigestProjection,
    setTaskProgressDigestProjection,
    undoTaskOccurrenceStateDigestProjection,
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

const WEEKLY_CREATE_COMMAND = {
    ...COMMAND_BASE,
    intent: {
        kind: 'plan.create-task-series',
        intentSchemaVersion: 2,
        payload: {
            courseId: COURSE_ID,
            title: '  Weekly problem set  ',
            size: 'large',
            schedule: {
                kind: 'weekly',
                startDate: '2026-09-01',
                weekday: 'SAT',
                localDeadlineTime: '23:00',
                confirmedEndDate: '2026-12-05',
                followTeachingWeek: true,
            },
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

test('A-TASK-004/007/010: weekly Task requires one exact confirmed teaching-week rule', () => {
    const normalized = normalizeCreateTaskCommand(WEEKLY_CREATE_COMMAND);

    assert.deepEqual(normalized.intent, {
        kind: 'plan.create-task-series',
        intentSchemaVersion: 2,
        payload: {
            courseId: COURSE_ID,
            title: 'Weekly problem set',
            size: 'large',
            schedule: {
                kind: 'weekly',
                startDate: '2026-09-01',
                weekday: 'SAT',
                localDeadlineTime: '23:00',
                confirmedEndDate: '2026-12-05',
                followTeachingWeek: true,
            },
        },
    });
});

test('A-TASK-004/010: weekly Task rejects malformed, unconfirmed, reversed, and empty rules', () => {
    const schedule = WEEKLY_CREATE_COMMAND.intent.payload.schedule;
    for (const invalidSchedule of [
        { ...schedule, localDeadlineTime: '24:00' },
        { ...schedule, weekday: 'DAY' },
        { ...schedule, startDate: '2026-09-31' },
        { ...schedule, confirmedEndDate: '2026-08-31' },
        { ...schedule, confirmedEndDate: undefined },
        { ...schedule, unexpected: true },
    ]) {
        assert.throws(() => normalizeCreateTaskCommand({
            ...WEEKLY_CREATE_COMMAND,
            intent: {
                ...WEEKLY_CREATE_COMMAND.intent,
                payload: {
                    ...WEEKLY_CREATE_COMMAND.intent.payload,
                    schedule: invalidSchedule,
                },
            },
        }), TypeError);
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
        reportedProgress: null,
        displayProgress: null,
        overrideKind: 'none',
        entityVersion: '3',
    } as const;

    assert.deepEqual(occurrenceId, {
        taskSeriesId: TASK_SERIES_ID,
        originalLogicalAnchor: 'once',
    });
    assert.equal(Object.isFrozen(occurrenceId), true);
    assert.equal(isTaskProjection(projection), true);
    assert.equal(isTaskProjection({ ...projection, status: 'skipped' }), true);
    assert.equal(isTaskProjection({
        ...projection,
        occurrenceId: { ...occurrenceId, originalLogicalAnchor: '2026-09-15' },
    }), false);
});

test('A-TASK-004: weekly Task identity uses the original LocalDate anchor', () => {
    const first = deriveTaskOccurrenceId(TASK_SERIES_ID, '2026-09-05');
    const repeated = deriveTaskOccurrenceId(TASK_SERIES_ID, '2026-09-05');
    const projection = {
        taskSeriesId: TASK_SERIES_ID,
        courseId: COURSE_ID,
        title: 'Weekly problem set',
        size: 'large',
        schedule: WEEKLY_CREATE_COMMAND.intent.payload.schedule,
        entityVersion: '3',
    } as const;

    assert.deepEqual(first, {
        taskSeriesId: TASK_SERIES_ID,
        originalLogicalAnchor: '2026-09-05',
    });
    assert.deepEqual(repeated, first);
    assert.equal(Object.isFrozen(first), true);
    assert.equal(isTaskProjection(projection), true);
});

test('FLOW-02: bounded weekly detail carries coherent stable occurrences and TermZone deadlines', () => {
    const projection = {
        workspaceRevision: '7',
        planEntityVersion: '7',
        requestedWindow: { startDate: '2026-09-01', endDate: '2026-09-30' },
        termZone: 'America/Toronto',
        taskSeriesId: TASK_SERIES_ID,
        courseId: COURSE_ID,
        title: 'Weekly problem set',
        size: 'large',
        schedule: WEEKLY_CREATE_COMMAND.intent.payload.schedule,
        entityVersion: '3',
        segments: [{
            segmentId: '44444444-4444-4444-8444-444444444444',
            logicalStartAnchor: '2026-09-05',
            logicalEndAnchor: '2026-12-05',
            replacement: {
                title: 'Weekly problem set',
                size: 'large',
                weekday: 'SAT',
                localDeadlineTime: '23:00',
                followTeachingWeek: true,
            },
        }],
        overrides: [],
        historicalStates: [{
            occurrenceId: {
                taskSeriesId: TASK_SERIES_ID,
                originalLogicalAnchor: '2026-09-05',
            },
            status: 'pending',
            reportedProgress: 60,
            displayProgress: 60,
            title: 'Weekly problem set',
            size: 'large',
            deadline: {
                kind: 'timed',
                instant: '2026-09-06T03:00:00.000Z',
                timeZone: 'America/Toronto',
            },
        }],
        occurrences: [{
            occurrenceId: {
                taskSeriesId: TASK_SERIES_ID,
                originalLogicalAnchor: '2026-09-05',
            },
            title: 'Weekly problem set',
            size: 'large',
            deadline: {
                kind: 'timed',
                instant: '2026-09-06T03:00:00.000Z',
                timeZone: 'America/Toronto',
            },
            segmentId: '44444444-4444-4444-8444-444444444444',
            status: 'pending',
            reportedProgress: 60,
            displayProgress: 60,
            overrideKind: 'none',
        }],
    } as const;

    assert.equal(isTaskSeriesDetailProjection(projection), true);
    assert.equal(isTaskSeriesDetailProjection({
        ...projection,
        occurrences: [{
            ...projection.occurrences[0],
            status: 'completed',
        }],
    }), false);
    assert.equal(isTaskSeriesDetailProjection({
        ...projection,
        occurrences: [{
            ...projection.occurrences[0],
            occurrenceId: {
                taskSeriesId: TASK_SERIES_ID,
                originalLogicalAnchor: '2026-09-06',
            },
        }],
    }), false);
    assert.equal(isTaskSeriesDetailProjection({
        ...projection,
        requestedWindow: { startDate: '2026-01-01', endDate: '2027-01-03' },
    }), false);
    const sparseOccurrences: unknown[] = [];
    sparseOccurrences.length = 1;
    assert.equal(isTaskSeriesDetailProjection({
        ...projection,
        occurrences: sparseOccurrences,
    }), false);
    const accessorOccurrences: unknown[] = [];
    Object.defineProperty(accessorOccurrences, '0', {
        enumerable: true,
        get: () => projection.occurrences[0],
    });
    assert.equal(isTaskSeriesDetailProjection({
        ...projection,
        occurrences: accessorOccurrences,
    }), false);
    const extraPropertyOccurrences: unknown[] = [...projection.occurrences];
    Object.defineProperty(extraPropertyOccurrences, 'extra', {
        enumerable: true,
        value: true,
    });
    assert.equal(isTaskSeriesDetailProjection({
        ...projection,
        occurrences: extraPropertyOccurrences,
    }), false);
    const foreignPrototypeOccurrences: unknown[] = [...projection.occurrences];
    Object.setPrototypeOf(foreignPrototypeOccurrences, Object.create(Array.prototype));
    assert.equal(isTaskSeriesDetailProjection({
        ...projection,
        occurrences: foreignPrototypeOccurrences,
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

test('A-TASK-005/008/009: occurrence state commands keep status and reported progress distinct', () => {
    const status = normalizeSetTaskOccurrenceStatusCommand({
        ...COMMAND_BASE,
        expectedTaskSeriesVersion: '3',
        intent: {
            kind: 'plan.set-task-occurrence-status',
            intentSchemaVersion: 2,
            payload: {
                taskSeriesId: TASK_SERIES_ID,
                originalLogicalAnchor: '2026-09-05',
                status: 'skipped',
            },
        },
    });
    const progress = normalizeSetTaskProgressCommand({
        ...COMMAND_BASE,
        expectedTaskSeriesVersion: '3',
        intent: {
            kind: 'plan.set-task-progress',
            intentSchemaVersion: 1,
            payload: {
                taskSeriesId: TASK_SERIES_ID,
                originalLogicalAnchor: '2026-09-05',
                reportedProgress: 60,
            },
        },
    });

    assert.equal(status.intent.payload.status, 'skipped');
    assert.equal(progress.intent.payload.reportedProgress, 60);
    for (const reportedProgress of [-1, 20.5, 101]) {
        assert.throws(() => normalizeSetTaskProgressCommand({
            ...progress,
            intent: {
                ...progress.intent,
                payload: { ...progress.intent.payload, reportedProgress },
            },
        }), TypeError);
    }
});

test('A-TASK-006: scoped Task replacement/deletion binds future confirmation and excludes Course ownership', () => {
    const futureChange = normalizeChangeTaskOccurrenceCommand({
        ...COMMAND_BASE,
        expectedTaskSeriesVersion: '3',
        confirmationToken: '1'.repeat(64),
        impactWindow: { startDate: '2026-09-05', endDate: '2026-12-05' },
        intent: {
            kind: 'plan.change-task-occurrence',
            intentSchemaVersion: 1,
            payload: {
                taskSeriesId: TASK_SERIES_ID,
                originalLogicalAnchor: '2026-09-05',
                scope: 'this-and-future',
                replacement: {
                    title: 'Read Chapter 2',
                    size: 'large',
                    weekday: 'SAT',
                    localDeadlineTime: '22:00',
                    followTeachingWeek: true,
                },
            },
        },
    });
    const onlyThisDelete = normalizeDeleteTaskOccurrenceOrSeriesCommand({
        ...COMMAND_BASE,
        expectedTaskSeriesVersion: '3',
        confirmationToken: '2'.repeat(64),
        impactWindow: { startDate: '2026-09-05', endDate: '2026-12-05' },
        intent: {
            kind: 'plan.delete-task-occurrence-or-series',
            intentSchemaVersion: 1,
            payload: {
                taskSeriesId: TASK_SERIES_ID,
                originalLogicalAnchor: '2026-09-05',
                scope: 'only-this',
            },
        },
    });

    assert.equal(futureChange.intent.payload.scope, 'this-and-future');
    assert.equal(onlyThisDelete.intent.payload.scope, 'only-this');
    assert.throws(() => normalizeDeleteTaskOccurrenceOrSeriesCommand({
        ...onlyThisDelete,
        confirmationToken: null,
        impactWindow: null,
    }), TypeError);
    assert.throws(() => normalizeChangeTaskOccurrenceCommand({
        ...futureChange,
        confirmationToken: null,
    }), TypeError);
    assert.throws(() => normalizeChangeTaskOccurrenceCommand({
        ...futureChange,
        intent: {
            ...futureChange.intent,
            payload: {
                ...futureChange.intent.payload,
                replacement: {
                    ...futureChange.intent.payload.replacement,
                    courseId: COURSE_ID,
                },
            },
        },
    }), TypeError);
});

test('A-TASK-006/TEST-WORKSPACE-002: every Task deletion scope requires an exact impact preview', () => {
    const requestedWindow = { startDate: '2026-09-05', endDate: '2026-12-05' };
    assert.deepEqual(normalizeTaskOccurrenceImpactDraft({
        scope: 'only-this',
        taskSeriesId: TASK_SERIES_ID,
        originalLogicalAnchor: '2026-09-05',
        action: 'delete',
        requestedWindow,
    }), {
        scope: 'only-this',
        taskSeriesId: TASK_SERIES_ID,
        originalLogicalAnchor: '2026-09-05',
        action: 'delete',
        requestedWindow,
    });
    assert.deepEqual(normalizeTaskOccurrenceImpactDraft({
        scope: 'whole-series',
        taskSeriesId: TASK_SERIES_ID,
        action: 'delete',
        requestedWindow,
    }), {
        scope: 'whole-series',
        taskSeriesId: TASK_SERIES_ID,
        action: 'delete',
        requestedWindow,
    });
    assert.throws(() => normalizeTaskOccurrenceImpactDraft({
        scope: 'whole-series',
        taskSeriesId: TASK_SERIES_ID,
        originalLogicalAnchor: '2026-09-05',
        action: 'delete',
        requestedWindow,
    }), TypeError);
    for (const payload of [
        {
            taskSeriesId: TASK_SERIES_ID,
            originalLogicalAnchor: '2026-09-05',
            scope: 'only-this' as const,
        },
        { taskSeriesId: TASK_SERIES_ID, scope: 'whole-series' as const },
    ]) {
        assert.doesNotThrow(() => normalizeDeleteTaskOccurrenceOrSeriesCommand({
            ...COMMAND_BASE,
            expectedTaskSeriesVersion: '3',
            confirmationToken: '3'.repeat(64),
            impactWindow: requestedWindow,
            intent: {
                kind: 'plan.delete-task-occurrence-or-series',
                intentSchemaVersion: 1,
                payload,
            },
        }));
    }
});

test('TEST-DATA-002: Task state receipts bind follow-up, versions, scope, tokens, and one-time Undo', () => {
    const status = normalizeSetTaskOccurrenceStatusCommand({
        ...COMMAND_BASE,
        expectedTaskSeriesVersion: '3',
        intent: {
            kind: 'plan.set-task-occurrence-status',
            intentSchemaVersion: 2,
            payload: { taskSeriesId: TASK_SERIES_ID, originalLogicalAnchor: 'once', status: 'completed' },
        },
    });
    const undo = normalizeUndoTaskOccurrenceStateCommand({
        ...COMMAND_BASE,
        expectedTaskSeriesVersion: '4',
        intent: {
            kind: 'plan.undo-task-occurrence-state',
            intentSchemaVersion: 1,
            payload: {
                token: '2'.repeat(64),
                taskSeriesId: TASK_SERIES_ID,
                originalLogicalAnchor: 'once',
            },
        },
    });

    assert.equal(JSON.stringify(setTaskOccurrenceStatusDigestProjection(status)).includes(status.commandId), false);
    assert.equal(JSON.stringify(undoTaskOccurrenceStateDigestProjection(undo)).includes(undo.commandId), false);
    assert.notDeepEqual(
        setTaskOccurrenceStatusDigestProjection(status),
        setTaskProgressDigestProjection(normalizeSetTaskProgressCommand({
            ...COMMAND_BASE,
            expectedTaskSeriesVersion: '3',
            intent: {
                kind: 'plan.set-task-progress',
                intentSchemaVersion: 1,
                payload: { taskSeriesId: TASK_SERIES_ID, originalLogicalAnchor: 'once', reportedProgress: 60 },
            },
        })),
    );
    assert.notDeepEqual(changeTaskOccurrenceDigestProjection(normalizeChangeTaskOccurrenceCommand({
        ...COMMAND_BASE,
        expectedTaskSeriesVersion: '3',
        confirmationToken: null,
        impactWindow: null,
        intent: {
            kind: 'plan.change-task-occurrence',
            intentSchemaVersion: 1,
            payload: {
                taskSeriesId: TASK_SERIES_ID,
                originalLogicalAnchor: 'once',
                scope: 'only-this',
                replacement: { title: 'Read Chapter 2', size: 'small', deadline: { kind: 'tba' } },
            },
        },
    })), deleteTaskOccurrenceOrSeriesDigestProjection(normalizeDeleteTaskOccurrenceOrSeriesCommand({
        ...COMMAND_BASE,
        expectedTaskSeriesVersion: '3',
        confirmationToken: '3'.repeat(64),
        impactWindow: { startDate: '2026-09-01', endDate: '2026-09-30' },
        intent: {
            kind: 'plan.delete-task-occurrence-or-series',
            intentSchemaVersion: 1,
            payload: { taskSeriesId: TASK_SERIES_ID, originalLogicalAnchor: 'once', scope: 'only-this' },
        },
    })));
});

test('FLOW-02: segmented Task detail validates each stable anchor against its owning segment and override', () => {
    const detail = {
        workspaceRevision: '7',
        planEntityVersion: '7',
        requestedWindow: { startDate: '2026-09-01', endDate: '2026-09-30' },
        termZone: 'America/Toronto',
        taskSeriesId: TASK_SERIES_ID,
        courseId: COURSE_ID,
        title: 'Future problem set',
        size: 'large',
        schedule: {
            kind: 'weekly',
            startDate: '2026-09-01',
            weekday: 'TUE',
            localDeadlineTime: '22:00',
            confirmedEndDate: '2026-12-05',
            followTeachingWeek: false,
        },
        entityVersion: '4',
        segments: [{
            segmentId: '44444444-4444-4444-8444-444444444444',
            logicalStartAnchor: '2026-09-05',
            logicalEndAnchor: '2026-09-12',
            replacement: {
                title: 'Weekly problem set',
                size: 'large',
                weekday: 'SAT',
                localDeadlineTime: '23:00',
                followTeachingWeek: true,
            },
        }, {
            segmentId: '55555555-5555-4555-8555-555555555555',
            logicalStartAnchor: '2026-09-19',
            logicalEndAnchor: '2026-12-05',
            replacement: {
                title: 'Future problem set',
                size: 'large',
                weekday: 'TUE',
                localDeadlineTime: '22:00',
                followTeachingWeek: false,
            },
        }],
        overrides: [{
            occurrenceId: {
                taskSeriesId: TASK_SERIES_ID,
                originalLogicalAnchor: '2026-09-05',
            },
            kind: 'replaced',
            replacement: {
                title: 'Retained completed problem set',
                size: 'small',
                deadline: { kind: 'tba' },
            },
        }],
        historicalStates: [{
            occurrenceId: {
                taskSeriesId: TASK_SERIES_ID,
                originalLogicalAnchor: '2026-09-05',
            },
            status: 'completed',
            reportedProgress: null,
            displayProgress: null,
            title: 'Retained completed problem set',
            size: 'small',
            deadline: { kind: 'tba' },
        }],
        occurrences: [{
            occurrenceId: {
                taskSeriesId: TASK_SERIES_ID,
                originalLogicalAnchor: '2026-09-05',
            },
            title: 'Retained completed problem set',
            size: 'small',
            deadline: { kind: 'tba' },
            segmentId: '44444444-4444-4444-8444-444444444444',
            status: 'completed',
            reportedProgress: null,
            displayProgress: null,
            overrideKind: 'replaced',
        }, {
            occurrenceId: {
                taskSeriesId: TASK_SERIES_ID,
                originalLogicalAnchor: '2026-09-19',
            },
            title: 'Future problem set',
            size: 'large',
            deadline: {
                kind: 'timed',
                instant: '2026-09-16T02:00:00.000Z',
                timeZone: 'America/Toronto',
            },
            segmentId: '55555555-5555-4555-8555-555555555555',
            status: 'pending',
            reportedProgress: 25,
            displayProgress: 25,
            overrideKind: 'none',
        }],
    } as const;

    assert.equal(isTaskSeriesDetailProjection(detail), true);
    assert.equal(isTaskSeriesDetailProjection({
        ...detail,
        occurrences: [{
            ...detail.occurrences[0],
            overrideKind: 'none',
        }, detail.occurrences[1]],
    }), false);
    assert.equal(isTaskSeriesDetailProjection({
        ...detail,
        occurrences: [detail.occurrences[0], {
            ...detail.occurrences[1],
            title: 'Wrong segment facts',
        }],
    }), false);
    assert.equal(isTaskSeriesDetailProjection({
        ...detail,
        overrides: [detail.overrides[0], detail.overrides[0]],
    }), false);
    assert.equal(isTaskSeriesDetailProjection({
        ...detail,
        historicalStates: [detail.historicalStates[0], detail.historicalStates[0]],
    }), false);
    assert.equal(isTaskSeriesDetailProjection({
        ...detail,
        segments: [...detail.segments].reverse(),
    }), false);
});

test('A-TASK-006: a deleted once occurrence remains distinct from its series and may project no occurrence', () => {
    const deletedOnce = {
        workspaceRevision: '8',
        planEntityVersion: '8',
        requestedWindow: { startDate: '2026-09-01', endDate: '2026-09-30' },
        termZone: 'America/Toronto',
        taskSeriesId: TASK_SERIES_ID,
        courseId: COURSE_ID,
        title: 'Read Chapter 1',
        size: 'small',
        schedule: { kind: 'once', deadline: { kind: 'date-only', date: '2026-09-15' } },
        entityVersion: '4',
        segments: [{
            segmentId: '44444444-4444-4444-8444-444444444444',
            logicalStartAnchor: 'once',
            logicalEndAnchor: 'once',
            replacement: {
                title: 'Read Chapter 1',
                size: 'small',
                deadline: { kind: 'date-only', date: '2026-09-15' },
            },
        }],
        overrides: [{
            occurrenceId: { taskSeriesId: TASK_SERIES_ID, originalLogicalAnchor: 'once' },
            kind: 'deleted',
        }],
        historicalStates: [],
        occurrences: [],
    } as const;

    assert.equal(isTaskSeriesDetailProjection(deletedOnce), true);
});

test('FLOW-02: Task detail segment, override, and historical-state arrays stay narrowly bounded', () => {
    const anchors = Array.from({ length: 55 }, (_, index) => (
        new Date(Date.parse('2026-01-03T00:00:00.000Z') + index * 7 * 24 * 60 * 60 * 1_000)
            .toISOString()
            .slice(0, 10)
    ));
    const replacement = {
        title: 'Weekly problem set',
        size: 'large',
        weekday: 'SAT',
        localDeadlineTime: '23:00',
        followTeachingWeek: true,
    } as const;
    const detail = {
        workspaceRevision: '7',
        planEntityVersion: '7',
        requestedWindow: { startDate: '2026-01-01', endDate: '2027-01-02' },
        termZone: 'America/Toronto',
        taskSeriesId: TASK_SERIES_ID,
        courseId: COURSE_ID,
        title: replacement.title,
        size: replacement.size,
        schedule: {
            kind: 'weekly',
            startDate: '2026-01-01',
            weekday: replacement.weekday,
            localDeadlineTime: replacement.localDeadlineTime,
            confirmedEndDate: anchors.at(-1)!,
            followTeachingWeek: replacement.followTeachingWeek,
        },
        entityVersion: '3',
        segments: [{
            segmentId: '44444444-4444-4444-8444-444444444444',
            logicalStartAnchor: anchors[0]!,
            logicalEndAnchor: anchors.at(-1)!,
            replacement,
        }],
        overrides: [],
        historicalStates: [],
        occurrences: [],
    } as const;
    const segments = anchors.map((anchor, index) => ({
        segmentId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        logicalStartAnchor: anchor,
        logicalEndAnchor: anchor,
        replacement,
    }));
    const overrides = anchors.map(anchor => ({
        occurrenceId: { taskSeriesId: TASK_SERIES_ID, originalLogicalAnchor: anchor },
        kind: 'replaced',
        replacement: {
            title: 'Retained problem set',
            size: 'small',
            deadline: { kind: 'tba' },
        },
    } as const));
    const historicalStates = anchors.map(anchor => ({
        occurrenceId: { taskSeriesId: TASK_SERIES_ID, originalLogicalAnchor: anchor },
        status: 'pending',
        reportedProgress: null,
        displayProgress: null,
        title: 'Retained problem set',
        size: 'small',
        deadline: { kind: 'tba' },
    } as const));

    assert.equal(isTaskSeriesDetailProjection({ ...detail, segments }), false);
    assert.equal(isTaskSeriesDetailProjection({ ...detail, overrides }), false);
    assert.equal(isTaskSeriesDetailProjection({ ...detail, historicalStates }), false);
});

test('FLOW-01: Task impact occurrence lists are exact, bounded, ordered, and series/window coherent', () => {
    const current = {
        occurrenceId: {
            taskSeriesId: TASK_SERIES_ID,
            originalLogicalAnchor: '2026-09-05',
        },
        title: 'Weekly problem set',
        size: 'large',
        deadline: {
            kind: 'timed',
            instant: '2026-09-06T03:00:00.000Z',
            timeZone: 'America/Toronto',
        },
        segmentId: '44444444-4444-4444-8444-444444444444',
        status: 'pending',
        reportedProgress: 25,
        displayProgress: 25,
        overrideKind: 'none',
    } as const;
    const { segmentId: _segmentId, ...afterChange } = current;
    const impact = {
        basedOnRevision: '7',
        planEntityVersion: '7',
        taskSeriesVersion: '3',
        affectedEntities: [{ kind: 'task-series', id: TASK_SERIES_ID, version: '3' }],
        effects: [{
            code: 'plan.task-occurrence-changed',
            scope: 'this-and-future',
            originalLogicalAnchor: '2026-09-05',
            affectedFutureSegmentCount: '1',
            futureOverrideCount: '0',
            historicalStateCount: '0',
            historicalStateAction: 'retain',
        }],
        warnings: [],
        choices: [{ id: 'apply-this-and-future' }],
        defaultChoice: { id: 'apply-this-and-future' },
        recoverability: { kind: 'permanent', reason: 'task-rule-change-has-no-undo' },
        unresolvedReferences: [],
        taskSeriesId: TASK_SERIES_ID,
        originalLogicalAnchor: '2026-09-05',
        scope: 'this-and-future',
        action: 'change',
        requestedWindow: { startDate: '2026-09-01', endDate: '2026-09-30' },
        affectedFutureSegmentCount: '1',
        futureOverrideCount: '0',
        historicalStateCount: '0',
        currentFutureOccurrences: [current],
        futureOccurrencesAfterChange: [afterChange],
        confirmationToken: '1'.repeat(64),
    } as const;

    assert.equal(isTaskOccurrenceImpactProjection(impact), true);
    assert.equal(isTaskOccurrenceImpactProjection({
        ...impact,
        affectedEntities: [{ ...impact.affectedEntities[0], id: COURSE_ID }],
    }), false);
    assert.equal(isTaskOccurrenceImpactProjection({
        ...impact,
        recoverability: { kind: 'permanent', reason: 'task-deletion-has-no-undo' },
    }), false);
    assert.equal(isTaskOccurrenceImpactProjection({
        ...impact,
        warnings: [{ code: 'terminal-history-retained' }],
    }), false);
    assert.equal(isTaskOccurrenceImpactProjection({
        ...impact,
        futureOccurrencesAfterChange: [current],
    }), false);
    assert.equal(isTaskOccurrenceImpactProjection({
        ...impact,
        currentFutureOccurrences: [{
            ...current,
            occurrenceId: { ...current.occurrenceId, taskSeriesId: COURSE_ID },
        }],
    }), false);
    assert.equal(isTaskOccurrenceImpactProjection({
        ...impact,
        currentFutureOccurrences: [{
            ...current,
            occurrenceId: { ...current.occurrenceId, originalLogicalAnchor: '2026-10-31' },
        }],
    }), false);
    assert.equal(isTaskOccurrenceImpactProjection({
        ...impact,
        currentFutureOccurrences: [{
            ...current,
            occurrenceId: { ...current.occurrenceId, originalLogicalAnchor: '2026-09-12' },
        }, current],
    }), false);
});
