/**
 * @file Verifies Renderer Task occurrence controls at the Workspace bridge boundary.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    advanceTaskOccurrenceActionsState,
    availableTaskOccurrenceActions,
    createTaskOccurrenceActionsState,
    runTaskOccurrenceAction,
    runTaskOccurrenceUndo,
    setTaskUndoToastFocused,
    setTaskUndoToastHovered,
    type TaskOccurrenceActionPort,
} from '../../src/renderer/task-occurrence-actions';
import type {
    SetTaskOccurrenceStatusCommand,
    TaskSeriesDetailProjection,
    TaskUndoCapability,
    UndoTaskOccurrenceStateCommand,
} from '../../src/shared/workspace-task-contract';
import type { WorkspaceSetupOutcome } from '../../src/shared/workspace-setup-contract';

const APP_BUILD_ID = 'development:1234567890abcdef1234567890abcdef12345678';
const REQUEST_ID = 'renderer-task-action-request';
const WORKSPACE_EPOCH = '00000000-0000-4000-8000-000000000001';
const COURSE_ID = '33333333-3333-4333-8333-333333333333';
const TASK_SERIES_ID = '44444444-4444-4444-8444-444444444444';
const SEGMENT_ID = '66666666-6666-4666-8666-666666666666';
const COMMAND_ID = '11111111-1111-4111-8111-111111111111';
const FOLLOW_UP_ID = '22222222-2222-4222-8222-222222222222';

const INITIAL_PROJECTION = {
    workspaceRevision: '3',
    planEntityVersion: '3',
    requestedWindow: { startDate: '2026-10-01', endDate: '2026-10-31' },
    termZone: 'America/Toronto',
    taskSeriesId: TASK_SERIES_ID,
    courseId: COURSE_ID,
    title: 'Read Chapter 1',
    size: 'small',
    entityVersion: '1',
    schedule: { kind: 'once', deadline: { kind: 'date-only', date: '2026-10-10' } },
    segments: [{
        segmentId: SEGMENT_ID,
        logicalStartAnchor: 'once',
        logicalEndAnchor: 'once',
        replacement: {
            title: 'Read Chapter 1',
            size: 'small',
            deadline: { kind: 'date-only', date: '2026-10-10' },
        },
    }],
    overrides: [],
    historicalStates: [],
    occurrences: [{
        occurrenceId: { taskSeriesId: TASK_SERIES_ID, originalLogicalAnchor: 'once' },
        segmentId: SEGMENT_ID,
        title: 'Read Chapter 1',
        size: 'small',
        deadline: { kind: 'date-only', date: '2026-10-10' },
        status: 'pending',
        reportedProgress: null,
        displayProgress: null,
        overrideKind: 'none',
    }],
} as const satisfies TaskSeriesDetailProjection;

const COMPLETED_PROJECTION = {
    ...INITIAL_PROJECTION,
    workspaceRevision: '4',
    planEntityVersion: '4',
    entityVersion: '2',
    occurrences: [{
        ...INITIAL_PROJECTION.occurrences[0],
        status: 'completed',
    }],
} as const satisfies TaskSeriesDetailProjection;

const RESTORED_PROJECTION = {
    ...INITIAL_PROJECTION,
    workspaceRevision: '5',
    planEntityVersion: '5',
    entityVersion: '3',
} as const satisfies TaskSeriesDetailProjection;

const UNDO_CAPABILITY = {
    token: 'a'.repeat(64),
    taskSeriesId: TASK_SERIES_ID,
    originalLogicalAnchor: 'once',
    committedRevision: '4',
    validThroughTaskSeriesVersion: '2',
} as const satisfies TaskUndoCapability;

type Deferred<T> = Readonly<{
    promise: Promise<T>;
    resolve(value: T): void;
}>;

/**
 * Creates a controllable system-boundary promise.
 * @return {Deferred<T>} Promise and resolver pair.
 */
function deferred<T>(): Deferred<T> {
    let resolvePromise!: (value: T) => void;
    const promise = new Promise<T>(resolve => {
        resolvePromise = resolve;
    });
    return { promise, resolve: resolvePromise };
}

/**
 * Creates a successful Task status receipt.
 * @return {WorkspaceSetupOutcome} Valid Workspace command outcome.
 */
function committedOutcome(): WorkspaceSetupOutcome {
    return {
        ok: true,
        value: {
            kind: 'workspace.command-outcome',
            protocolVersion: 2,
            appBuildId: APP_BUILD_ID,
            requestId: REQUEST_ID,
            workspaceEpoch: WORKSPACE_EPOCH,
            outcome: {
                kind: 'committed',
                revision: '4',
                effects: [{
                    code: 'plan.task-occurrence-status-set',
                    entity: { kind: 'task-series', id: TASK_SERIES_ID, version: '2' },
                }],
                pendingFollowUps: ['55555555-5555-4555-8555-555555555555'],
                undoCapability: UNDO_CAPABILITY,
            },
        },
    };
}

/**
 * Creates a successful formal Undo receipt.
 * @return {WorkspaceSetupOutcome} Valid Workspace command outcome.
 */
function undoCommittedOutcome(): WorkspaceSetupOutcome {
    return {
        ok: true,
        value: {
            kind: 'workspace.command-outcome',
            protocolVersion: 2,
            appBuildId: APP_BUILD_ID,
            requestId: REQUEST_ID,
            workspaceEpoch: WORKSPACE_EPOCH,
            outcome: {
                kind: 'committed',
                revision: '5',
                effects: [{
                    code: 'plan.task-occurrence-state-undone',
                    entity: { kind: 'task-series', id: TASK_SERIES_ID, version: '3' },
                }],
                pendingFollowUps: ['88888888-8888-4888-8888-888888888888'],
            },
        },
    };
}

/**
 * Creates a successful formal Task-series query response.
 * @param {TaskSeriesDetailProjection} projection - Projection returned by Workspace.
 * @return {WorkspaceSetupOutcome} Valid Workspace query outcome.
 */
function projectionOutcome(projection: TaskSeriesDetailProjection): WorkspaceSetupOutcome {
    return {
        ok: true,
        value: {
            kind: 'workspace.task-series-projection',
            protocolVersion: 2,
            appBuildId: APP_BUILD_ID,
            requestId: REQUEST_ID,
            workspaceEpoch: WORKSPACE_EPOCH,
            dataMode: 'ready',
            projection,
        },
    };
}

/**
 * Creates an unchanged Workspace failure.
 * @return {WorkspaceSetupOutcome} Structured unavailable outcome.
 */
function unavailableOutcome(): WorkspaceSetupOutcome {
    return {
        ok: false,
        problem: {
            code: 'workspace-unavailable',
            message: 'Workspace is unavailable. Please try again.',
            requestId: REQUEST_ID,
            appBuildId: APP_BUILD_ID,
            workspaceEpoch: WORKSPACE_EPOCH,
            dataEffect: 'unchanged',
        },
    };
}

/**
 * Creates a structured transport-unknown mutation failure.
 * @return {WorkspaceSetupOutcome} Recovery-required outcome with unknown data effect.
 */
function unknownOutcome(): WorkspaceSetupOutcome {
    return {
        ok: false,
        problem: {
            code: 'recovery-required',
            message: 'Workspace response was lost after the request was sent.',
            requestId: REQUEST_ID,
            appBuildId: APP_BUILD_ID,
            workspaceEpoch: WORKSPACE_EPOCH,
            dataEffect: 'unknown',
        },
    };
}

test('UI-TODAY-01 changes formal status only after persistence and a bounded requery', async () => {
    const committing = deferred<WorkspaceSetupOutcome>();
    const querying = deferred<WorkspaceSetupOutcome>();
    const observedStates: ReturnType<typeof createTaskOccurrenceActionsState>[] = [];
    const submittedCommands: SetTaskOccurrenceStatusCommand[] = [];
    let queriedWindow: TaskSeriesDetailProjection['requestedWindow'] | null = null;
    const port: TaskOccurrenceActionPort = {
        setTaskOccurrenceStatus(command) {
            submittedCommands.push(command);
            return committing.promise;
        },
        undoTaskOccurrenceState() {
            throw new Error('Undo is not expected');
        },
        queryTaskSeries(taskSeriesId, requestedWindow) {
            assert.equal(taskSeriesId, TASK_SERIES_ID);
            queriedWindow = requestedWindow;
            return querying.promise;
        },
    };
    const ids = [COMMAND_ID, FOLLOW_UP_ID];
    const running = runTaskOccurrenceAction(
        createTaskOccurrenceActionsState(INITIAL_PROJECTION),
        INITIAL_PROJECTION.occurrences[0].occurrenceId,
        'complete',
        {
            port,
            makeId: () => ids.shift()!,
            now: () => 1_000,
            onStateChange: state => observedStates.push(state),
        },
    );

    assert.equal(observedStates.length, 1);
    assert.equal(observedStates[0]?.commandState.submitting, true);
    assert.equal(observedStates[0]?.commandState.projection, INITIAL_PROJECTION);
    assert.deepEqual(submittedCommands[0], {
        commandId: COMMAND_ID,
        followUpId: FOLLOW_UP_ID,
        expectedRevision: '3',
        expectedPlanVersion: '3',
        expectedTaskSeriesVersion: '1',
        intent: {
            kind: 'plan.set-task-occurrence-status',
            intentSchemaVersion: 2,
            payload: {
                taskSeriesId: TASK_SERIES_ID,
                originalLogicalAnchor: 'once',
                status: 'completed',
            },
        },
    });

    committing.resolve(committedOutcome());
    await Promise.resolve();
    assert.equal(observedStates.length, 2);
    assert.equal(observedStates[1]?.commandState.projection, INITIAL_PROJECTION);
    assert.equal(observedStates[1]?.commandState.undoToast?.expiresAt, 7_000);
    assert.deepEqual(queriedWindow, INITIAL_PROJECTION.requestedWindow);

    querying.resolve(projectionOutcome(COMPLETED_PROJECTION));
    const completed = await running;
    assert.equal(completed.commandState.projection, COMPLETED_PROJECTION);
    assert.equal(completed.commandState.draft, null);
    assert.equal(completed.commandState.problem, null);
});

test('UI-TASK-01 offers complete and skip while a failed skip preserves formal status', async () => {
    const initialState = createTaskOccurrenceActionsState(INITIAL_PROJECTION);
    const occurrenceId = INITIAL_PROJECTION.occurrences[0].occurrenceId;
    const submittedCommands: SetTaskOccurrenceStatusCommand[] = [];
    let queryCalled = false;
    const port: TaskOccurrenceActionPort = {
        setTaskOccurrenceStatus(command) {
            submittedCommands.push(command);
            return Promise.resolve(unavailableOutcome());
        },
        undoTaskOccurrenceState() {
            throw new Error('Undo is not expected');
        },
        queryTaskSeries() {
            queryCalled = true;
            throw new Error('A failed write must not trigger a requery');
        },
    };

    assert.deepEqual(availableTaskOccurrenceActions(initialState, occurrenceId), ['complete', 'skip']);
    const failed = await runTaskOccurrenceAction(initialState, occurrenceId, 'skip', {
        port,
        makeId: (() => {
            const ids = [COMMAND_ID, FOLLOW_UP_ID];
            return () => ids.shift()!;
        })(),
        now: () => 1_000,
        onStateChange() {
        },
    });

    assert.equal(submittedCommands[0]?.intent.payload.status, 'skipped');
    assert.equal(queryCalled, false);
    assert.equal(failed.commandState.projection, INITIAL_PROJECTION);
    assert.equal(failed.commandState.undoToast, null);
    assert.equal(failed.commandState.problem?.code, 'workspace-unavailable');
});

test('UI-TODAY-01 keeps the six-second Undo toast paused while hover or focus remains', async () => {
    const occurrenceId = INITIAL_PROJECTION.occurrences[0].occurrenceId;
    const port: TaskOccurrenceActionPort = {
        setTaskOccurrenceStatus() {
            return Promise.resolve(committedOutcome());
        },
        undoTaskOccurrenceState() {
            throw new Error('Undo is not expected');
        },
        queryTaskSeries() {
            return Promise.resolve(projectionOutcome(COMPLETED_PROJECTION));
        },
    };
    const ids = [COMMAND_ID, FOLLOW_UP_ID];
    const completed = await runTaskOccurrenceAction(
        createTaskOccurrenceActionsState(INITIAL_PROJECTION),
        occurrenceId,
        'complete',
        {
            port,
            makeId: () => ids.shift()!,
            now: () => 1_000,
            onStateChange() {
            },
        },
    );

    assert.deepEqual(availableTaskOccurrenceActions(completed, occurrenceId), ['restore']);
    const hovered = setTaskUndoToastHovered(completed, true, 2_000);
    const focused = setTaskUndoToastFocused(hovered, true, 3_000);
    const focusOnly = setTaskUndoToastHovered(focused, false, 4_000);
    assert.equal(advanceTaskOccurrenceActionsState(focusOnly, 9_000).commandState.undoToast?.pausedAt, 2_000);

    const resumed = setTaskUndoToastFocused(focusOnly, false, 9_000);
    assert.equal(resumed.commandState.undoToast?.expiresAt, 14_000);
    assert.notEqual(advanceTaskOccurrenceActionsState(resumed, 13_999).commandState.undoToast, null);
    assert.equal(advanceTaskOccurrenceActionsState(resumed, 14_000).commandState.undoToast, null);
});

test('UI-TODAY-01 Undo preserves committed status until its own persistence and requery succeed', async () => {
    const occurrenceId = INITIAL_PROJECTION.occurrences[0].occurrenceId;
    const statusIds = [COMMAND_ID, FOLLOW_UP_ID];
    const completed = await runTaskOccurrenceAction(
        createTaskOccurrenceActionsState(INITIAL_PROJECTION),
        occurrenceId,
        'complete',
        {
            port: {
                setTaskOccurrenceStatus: () => Promise.resolve(committedOutcome()),
                undoTaskOccurrenceState: () => Promise.reject(new Error('Undo is not expected yet')),
                queryTaskSeries: () => Promise.resolve(projectionOutcome(COMPLETED_PROJECTION)),
            },
            makeId: () => statusIds.shift()!,
            now: () => 1_000,
            onStateChange() {
            },
        },
    );
    const undoing = deferred<WorkspaceSetupOutcome>();
    const querying = deferred<WorkspaceSetupOutcome>();
    const undoCommands: Parameters<TaskOccurrenceActionPort['undoTaskOccurrenceState']>[0][] = [];
    const observedStates: ReturnType<typeof createTaskOccurrenceActionsState>[] = [];
    const undoIds = [
        '77777777-7777-4777-8777-777777777777',
        '88888888-8888-4888-8888-888888888888',
    ];
    const running = runTaskOccurrenceUndo(completed, {
        port: {
            setTaskOccurrenceStatus: () => Promise.reject(new Error('Status is not expected')),
            undoTaskOccurrenceState(command) {
                undoCommands.push(command);
                return undoing.promise;
            },
            queryTaskSeries(taskSeriesId, requestedWindow) {
                assert.equal(taskSeriesId, TASK_SERIES_ID);
                assert.deepEqual(requestedWindow, INITIAL_PROJECTION.requestedWindow);
                return querying.promise;
            },
        },
        makeId: () => undoIds.shift()!,
        now: () => 2_000,
        onStateChange: state => observedStates.push(state),
    });

    assert.equal(observedStates[0]?.commandState.submitting, true);
    assert.equal(observedStates[0]?.commandState.projection, COMPLETED_PROJECTION);
    assert.deepEqual(undoCommands[0], {
        commandId: '77777777-7777-4777-8777-777777777777',
        followUpId: '88888888-8888-4888-8888-888888888888',
        expectedRevision: '4',
        expectedPlanVersion: '4',
        expectedTaskSeriesVersion: '2',
        intent: {
            kind: 'plan.undo-task-occurrence-state',
            intentSchemaVersion: 1,
            payload: {
                token: UNDO_CAPABILITY.token,
                taskSeriesId: TASK_SERIES_ID,
                originalLogicalAnchor: 'once',
            },
        },
    });

    undoing.resolve(undoCommittedOutcome());
    await Promise.resolve();
    assert.equal(observedStates[1]?.commandState.projection, COMPLETED_PROJECTION);
    assert.equal(observedStates[1]?.commandState.undoToast, null);

    querying.resolve(projectionOutcome(RESTORED_PROJECTION));
    const restored = await running;
    assert.equal(restored.commandState.projection, RESTORED_PROJECTION);
    assert.equal(restored.commandState.problem, null);
});

test('a structured-unknown Task action retries the exact command before formal reconciliation', async () => {
    const occurrenceId = INITIAL_PROJECTION.occurrences[0].occurrenceId;
    const submittedCommands: SetTaskOccurrenceStatusCommand[] = [];
    const ids = [COMMAND_ID, FOLLOW_UP_ID];
    const unknown = await runTaskOccurrenceAction(
        createTaskOccurrenceActionsState(INITIAL_PROJECTION),
        occurrenceId,
        'complete',
        {
            port: {
                setTaskOccurrenceStatus(command) {
                    submittedCommands.push(command);
                    return Promise.resolve(unknownOutcome());
                },
                undoTaskOccurrenceState: () => Promise.reject(new Error('Undo is not expected')),
                queryTaskSeries: () => Promise.reject(new Error('Unknown write must not requery yet')),
            },
            makeId: () => ids.shift()!,
            now: () => 1_000,
            onStateChange() {
            },
        },
    );

    assert.deepEqual(unknown.pendingActionCommand, submittedCommands[0]);
    assert.equal(unknown.commandState.problem?.dataEffect, 'unknown');

    const competing = await runTaskOccurrenceAction(
        unknown,
        occurrenceId,
        'skip',
        {
            port: {
                queryTaskSeries: () => Promise.reject(new Error('A competing action must not query')),
                setTaskOccurrenceStatus: () => Promise.reject(new Error('A competing action must not write')),
                undoTaskOccurrenceState: () => Promise.reject(new Error('Undo is not expected')),
            },
            makeId() {
                throw new Error('A competing action must not allocate command IDs');
            },
            now: () => 1_250,
            onStateChange(): void {},
        },
    );
    assert.equal(competing, unknown);

    const reconciled = await runTaskOccurrenceAction(unknown, occurrenceId, 'complete', {
        port: {
            setTaskOccurrenceStatus(command) {
                submittedCommands.push(command);
                return Promise.resolve(committedOutcome());
            },
            undoTaskOccurrenceState: () => Promise.reject(new Error('Undo is not expected')),
            queryTaskSeries: () => Promise.resolve(projectionOutcome(COMPLETED_PROJECTION)),
        },
        makeId() {
            throw new Error('Exact retry must not allocate replacement command IDs');
        },
        now: () => 2_000,
        onStateChange() {
        },
    });

    assert.deepEqual(submittedCommands[1], submittedCommands[0]);
    assert.equal(reconciled.pendingActionCommand, null);
    assert.equal(reconciled.commandState.projection, COMPLETED_PROJECTION);
    assert.equal(reconciled.commandState.problem, null);
});

test('a structured-unknown Undo retains its command and Toast until exact reconciliation', async () => {
    const occurrenceId = INITIAL_PROJECTION.occurrences[0].occurrenceId;
    const actionIds = [COMMAND_ID, FOLLOW_UP_ID];
    const completed = await runTaskOccurrenceAction(
        createTaskOccurrenceActionsState(INITIAL_PROJECTION),
        occurrenceId,
        'complete',
        {
            port: {
                setTaskOccurrenceStatus: () => Promise.resolve(committedOutcome()),
                undoTaskOccurrenceState: () => Promise.reject(new Error('Undo is not expected yet')),
                queryTaskSeries: () => Promise.resolve(projectionOutcome(COMPLETED_PROJECTION)),
            },
            makeId: () => actionIds.shift()!,
            now: () => 1_000,
            onStateChange() {
            },
        },
    );
    const submittedCommands: UndoTaskOccurrenceStateCommand[] = [];
    const undoIds = [
        '77777777-7777-4777-8777-777777777777',
        '88888888-8888-4888-8888-888888888888',
    ];
    const unknown = await runTaskOccurrenceUndo(completed, {
        port: {
            setTaskOccurrenceStatus: () => Promise.reject(new Error('Status is not expected')),
            undoTaskOccurrenceState(command) {
                submittedCommands.push(command);
                return Promise.resolve(unknownOutcome());
            },
            queryTaskSeries: () => Promise.reject(new Error('Unknown Undo must not requery yet')),
        },
        makeId: () => undoIds.shift()!,
        now: () => 2_000,
        onStateChange() {
        },
    });

    assert.deepEqual(unknown.pendingUndoCommand, submittedCommands[0]);
    assert.notEqual(unknown.commandState.undoToast, null);
    assert.equal(unknown.commandState.problem?.dataEffect, 'unknown');

    const reconciled = await runTaskOccurrenceUndo(unknown, {
        port: {
            setTaskOccurrenceStatus: () => Promise.reject(new Error('Status is not expected')),
            undoTaskOccurrenceState(command) {
                submittedCommands.push(command);
                return Promise.resolve(undoCommittedOutcome());
            },
            queryTaskSeries: () => Promise.resolve(projectionOutcome(RESTORED_PROJECTION)),
        },
        makeId() {
            throw new Error('Exact Undo retry must not allocate replacement command IDs');
        },
        now: () => 3_000,
        onStateChange() {
        },
    });

    assert.deepEqual(submittedCommands[1], submittedCommands[0]);
    assert.equal(reconciled.pendingUndoCommand, null);
    assert.equal(reconciled.commandState.projection, RESTORED_PROJECTION);
    assert.equal(reconciled.commandState.problem, null);
});
