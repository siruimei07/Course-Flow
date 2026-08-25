/**
 * @file Verifies App-side Task action coordination and projection refresh boundaries.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    advanceTaskUndoTimerState,
    focusTaskActionTarget,
    runWorkspaceTaskOccurrenceAction,
    runWorkspaceTaskOccurrenceUndo,
    taskUndoPresentationFrom,
    taskUndoTimerDelayFrom,
    type TaskActionAppBridge,
} from '../../src/renderer/App';
import {
    createTaskOccurrenceActionsState,
    type TaskOccurrenceActionsState,
} from '../../src/renderer/task-occurrence-actions';
import {
    buildPlanProjection,
    createPlanEvaluationContext,
} from '../../src/shared/workspace-plan-contract';
import type {
    TaskOccurrenceWindow,
    TaskSeriesDetailProjection,
    TaskUndoCapability,
} from '../../src/shared/workspace-task-contract';
import type { WorkspaceSetupOutcome } from '../../src/shared/workspace-setup-contract';
import type {
    SetupProjection,
    TermProjection,
} from '../../src/shared/workspace-term-contract';

const APP_BUILD_ID = 'development:1234567890abcdef1234567890abcdef12345678';
const REQUEST_ID = 'app-task-action-request';
const WORKSPACE_EPOCH = '00000000-0000-4000-8000-000000000001';
const COURSE_ID = '33333333-3333-4333-8333-333333333333';
const TASK_SERIES_ID = '44444444-4444-4444-8444-444444444444';
const SEGMENT_ID = '66666666-6666-4666-8666-666666666666';

const TERM = {
    termId: '11111111-1111-4111-8111-111111111111',
    name: 'Fall 2026',
    startDate: '2026-09-08',
    endDate: '2026-12-18',
    timeZone: 'America/Toronto',
    archived: false,
    entityVersion: '1',
} as const satisfies TermProjection;

const LONG_TERM = {
    ...TERM,
    termId: '22222222-2222-4222-8222-222222222222',
    name: 'Extended program 2025-2027',
    startDate: '2025-01-01',
    endDate: '2027-12-31',
} as const satisfies TermProjection;

const INITIAL_OCCURRENCE = {
    occurrenceId: { taskSeriesId: TASK_SERIES_ID, originalLogicalAnchor: 'once' },
    segmentId: SEGMENT_ID,
    title: 'Read Chapter 1',
    size: 'small',
    deadline: { kind: 'date-only', date: '2026-10-10' },
    status: 'pending',
    reportedProgress: null,
    displayProgress: null,
    overrideKind: 'none',
} as const;

const LONG_TERM_OCCURRENCE = {
    ...INITIAL_OCCURRENCE,
    deadline: { kind: 'date-only', date: '2027-10-10' },
} as const;

const LONG_TERM_REPLACED_WEEKLY_OCCURRENCE = {
    ...INITIAL_OCCURRENCE,
    occurrenceId: {
        taskSeriesId: TASK_SERIES_ID,
        originalLogicalAnchor: '2026-11-20',
    },
    title: 'Replaced weekly checkpoint',
    size: 'large',
    deadline: { kind: 'date-only', date: '2027-10-10' },
    overrideKind: 'replaced',
} as const;

const INITIAL_PLAN = buildPlanProjection({
    workspaceRevision: '3',
    planEntityVersion: '3',
    term: TERM,
    taskSources: [{
        courseId: COURSE_ID,
        courseCode: 'CSC301',
        occurrence: INITIAL_OCCURRENCE,
    }],
    meetingSources: [],
    holidayRanges: [],
}, createPlanEvaluationContext('2026-10-10T13:00:00.000Z', TERM.timeZone), 'unavailable');

const REFRESHED_PLAN = buildPlanProjection({
    workspaceRevision: '4',
    planEntityVersion: '4',
    term: TERM,
    taskSources: [{
        courseId: COURSE_ID,
        courseCode: 'CSC301',
        occurrence: { ...INITIAL_OCCURRENCE, status: 'completed' },
    }],
    meetingSources: [],
    holidayRanges: [],
}, createPlanEvaluationContext('2026-10-10T13:00:00.000Z', TERM.timeZone), 'unavailable');

const LONG_TERM_PLAN = buildPlanProjection({
    workspaceRevision: '3',
    planEntityVersion: '3',
    term: LONG_TERM,
    taskSources: [{
        courseId: COURSE_ID,
        courseCode: 'CSC301',
        occurrence: LONG_TERM_OCCURRENCE,
    }],
    meetingSources: [],
    holidayRanges: [],
}, createPlanEvaluationContext('2025-01-10T13:00:00.000Z', LONG_TERM.timeZone), 'unavailable');

const LONG_TERM_EVALUATION_WINDOW = LONG_TERM_PLAN.evaluationContext.requestedWindow;

const LONG_TERM_WEEKLY_QUERY_WINDOW = {
    startDate: '2026-11-14',
    endDate: '2026-11-26',
} as const;

const LONG_TERM_REPLACED_WEEKLY_PLAN = buildPlanProjection({
    workspaceRevision: '3',
    planEntityVersion: '3',
    term: LONG_TERM,
    taskSources: [{
        courseId: COURSE_ID,
        courseCode: 'CSC301',
        occurrence: LONG_TERM_REPLACED_WEEKLY_OCCURRENCE,
    }],
    meetingSources: [],
    holidayRanges: [],
}, createPlanEvaluationContext('2025-01-10T13:00:00.000Z', LONG_TERM.timeZone), 'unavailable');

const INITIAL_DETAIL = {
    workspaceRevision: '3',
    planEntityVersion: '3',
    requestedWindow: { startDate: TERM.startDate, endDate: TERM.endDate },
    termZone: TERM.timeZone,
    taskSeriesId: TASK_SERIES_ID,
    courseId: COURSE_ID,
    title: INITIAL_OCCURRENCE.title,
    size: INITIAL_OCCURRENCE.size,
    entityVersion: '1',
    schedule: { kind: 'once', deadline: INITIAL_OCCURRENCE.deadline },
    segments: [{
        segmentId: SEGMENT_ID,
        logicalStartAnchor: 'once',
        logicalEndAnchor: 'once',
        replacement: {
            title: INITIAL_OCCURRENCE.title,
            size: INITIAL_OCCURRENCE.size,
            deadline: INITIAL_OCCURRENCE.deadline,
        },
    }],
    overrides: [],
    historicalStates: [],
    occurrences: [INITIAL_OCCURRENCE],
} as const satisfies TaskSeriesDetailProjection;

const REFRESHED_DETAIL = {
    ...INITIAL_DETAIL,
    workspaceRevision: '4',
    planEntityVersion: '4',
    entityVersion: '2',
    occurrences: [{ ...INITIAL_OCCURRENCE, status: 'completed' }],
} as const satisfies TaskSeriesDetailProjection;

const RESTORED_DETAIL = {
    ...INITIAL_DETAIL,
    workspaceRevision: '5',
    planEntityVersion: '5',
    entityVersion: '3',
} as const satisfies TaskSeriesDetailProjection;

const LONG_TERM_INITIAL_DETAIL = {
    ...INITIAL_DETAIL,
    requestedWindow: LONG_TERM_EVALUATION_WINDOW,
    termZone: LONG_TERM.timeZone,
    schedule: { kind: 'once', deadline: LONG_TERM_OCCURRENCE.deadline },
    segments: [{
        ...INITIAL_DETAIL.segments[0],
        replacement: {
            ...INITIAL_DETAIL.segments[0].replacement,
            deadline: LONG_TERM_OCCURRENCE.deadline,
        },
    }],
    occurrences: [LONG_TERM_OCCURRENCE],
} as const satisfies TaskSeriesDetailProjection;

const LONG_TERM_COMPLETED_DETAIL = {
    ...LONG_TERM_INITIAL_DETAIL,
    workspaceRevision: '4',
    planEntityVersion: '4',
    entityVersion: '2',
    occurrences: [{ ...LONG_TERM_OCCURRENCE, status: 'completed' }],
} as const satisfies TaskSeriesDetailProjection;

const LONG_TERM_SKIPPED_DETAIL = {
    ...LONG_TERM_COMPLETED_DETAIL,
    occurrences: [{ ...LONG_TERM_OCCURRENCE, status: 'skipped' }],
} as const satisfies TaskSeriesDetailProjection;

const LONG_TERM_RESTORED_DETAIL = {
    ...LONG_TERM_INITIAL_DETAIL,
    workspaceRevision: '5',
    planEntityVersion: '5',
    entityVersion: '3',
} as const satisfies TaskSeriesDetailProjection;

const LONG_TERM_REPLACED_WEEKLY_DETAIL = {
    workspaceRevision: '3',
    planEntityVersion: '3',
    requestedWindow: LONG_TERM_WEEKLY_QUERY_WINDOW,
    termZone: LONG_TERM.timeZone,
    taskSeriesId: TASK_SERIES_ID,
    courseId: COURSE_ID,
    title: 'Weekly checkpoint',
    size: 'large',
    entityVersion: '1',
    schedule: {
        kind: 'weekly',
        startDate: '2026-11-20',
        weekday: 'FRI',
        localDeadlineTime: '17:00',
        confirmedEndDate: '2026-11-20',
        followTeachingWeek: false,
    },
    segments: [{
        segmentId: SEGMENT_ID,
        logicalStartAnchor: '2026-11-20',
        logicalEndAnchor: '2026-11-20',
        replacement: {
            title: 'Weekly checkpoint',
            size: 'large',
            weekday: 'FRI',
            localDeadlineTime: '17:00',
            followTeachingWeek: false,
        },
    }],
    overrides: [{
        occurrenceId: LONG_TERM_REPLACED_WEEKLY_OCCURRENCE.occurrenceId,
        kind: 'replaced',
        replacement: {
            title: LONG_TERM_REPLACED_WEEKLY_OCCURRENCE.title,
            size: LONG_TERM_REPLACED_WEEKLY_OCCURRENCE.size,
            deadline: LONG_TERM_REPLACED_WEEKLY_OCCURRENCE.deadline,
        },
    }],
    historicalStates: [],
    occurrences: [LONG_TERM_REPLACED_WEEKLY_OCCURRENCE],
} as const satisfies TaskSeriesDetailProjection;

const LONG_TERM_REPLACED_WEEKLY_COMPLETED_DETAIL = {
    ...LONG_TERM_REPLACED_WEEKLY_DETAIL,
    workspaceRevision: '4',
    planEntityVersion: '4',
    entityVersion: '2',
    occurrences: [{ ...LONG_TERM_REPLACED_WEEKLY_OCCURRENCE, status: 'completed' }],
} as const satisfies TaskSeriesDetailProjection;

const LONG_TERM_REPLACED_WEEKLY_SKIPPED_DETAIL = {
    ...LONG_TERM_REPLACED_WEEKLY_COMPLETED_DETAIL,
    occurrences: [{ ...LONG_TERM_REPLACED_WEEKLY_OCCURRENCE, status: 'skipped' }],
} as const satisfies TaskSeriesDetailProjection;

const LONG_TERM_REPLACED_WEEKLY_RESTORED_DETAIL = {
    ...LONG_TERM_REPLACED_WEEKLY_DETAIL,
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

const WEEKLY_UNDO_CAPABILITY = {
    ...UNDO_CAPABILITY,
    originalLogicalAnchor: LONG_TERM_REPLACED_WEEKLY_OCCURRENCE.occurrenceId.originalLogicalAnchor,
} as const satisfies TaskUndoCapability;

const SETUP: SetupProjection = {
    workspaceRevision: '4',
    planEntityVersion: '4',
    minimum: {
        hasCurrentTerm: true,
        hasCurrentTermCourse: true,
        hasMeetingOrTask: true,
        isSatisfied: true,
    },
    everReachedMinimum: true,
    defaultRoute: 'today',
    draftCheckpointVersion: '0',
    draftCheckpoint: null,
    currentTerm: TERM,
    terms: [TERM],
    courses: [],
    holidayRanges: [],
    tasks: [],
};

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
 * Wraps one Task-series detail in a Workspace response.
 * @param {TaskSeriesDetailProjection} projection - Formal detail projection.
 * @return {WorkspaceSetupOutcome} Successful detail outcome.
 */
function detailOutcome(projection: TaskSeriesDetailProjection): WorkspaceSetupOutcome {
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
 * Creates a successful Task status receipt.
 * @param {TaskUndoCapability} undoCapability - Exact reversible occurrence capability.
 * @return {WorkspaceSetupOutcome} Committed occurrence status outcome.
 */
function committedOutcome(
    undoCapability: TaskUndoCapability = UNDO_CAPABILITY,
): WorkspaceSetupOutcome {
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
                undoCapability,
            },
        },
    };
}

/**
 * Creates a successful Task Undo receipt.
 * @return {WorkspaceSetupOutcome} Committed occurrence Undo outcome.
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
                pendingFollowUps: ['99999999-9999-4999-8999-999999999999'],
            },
        },
    };
}

/**
 * Wraps the refreshed Setup projection.
 * @return {WorkspaceSetupOutcome} Successful Setup query outcome.
 */
function setupOutcome(): WorkspaceSetupOutcome {
    return {
        ok: true,
        value: {
            kind: 'workspace.setup-projection',
            protocolVersion: 2,
            appBuildId: APP_BUILD_ID,
            requestId: REQUEST_ID,
            workspaceEpoch: WORKSPACE_EPOCH,
            dataMode: 'ready',
            projection: SETUP,
        },
    };
}

/**
 * Wraps the refreshed PLAN projection.
 * @return {WorkspaceSetupOutcome} Successful PLAN query outcome.
 */
function planOutcome(): WorkspaceSetupOutcome {
    return {
        ok: true,
        value: {
            kind: 'workspace.plan-projection',
            protocolVersion: 2,
            appBuildId: APP_BUILD_ID,
            requestId: REQUEST_ID,
            workspaceEpoch: WORKSPACE_EPOCH,
            dataMode: 'ready',
            projection: REFRESHED_PLAN,
        },
    };
}

test('App queries the full PLAN Term and refreshes Setup/PLAN only after formal Task requery', async () => {
    const committing = deferred<WorkspaceSetupOutcome>();
    const requerying = deferred<WorkspaceSetupOutcome>();
    const calls: string[] = [];
    const observedStates: (TaskOccurrenceActionsState | null)[] = [];
    let detailQueryCount = 0;
    const bridge: TaskActionAppBridge = {
        queryTaskSeries(taskSeriesId, requestedWindow) {
            calls.push(`queryTaskSeries:${taskSeriesId}:${requestedWindow.startDate}:${requestedWindow.endDate}`);
            detailQueryCount += 1;
            return detailQueryCount === 1
                ? Promise.resolve(detailOutcome(INITIAL_DETAIL))
                : requerying.promise;
        },
        setTaskOccurrenceStatus() {
            calls.push('setTaskOccurrenceStatus');
            return committing.promise;
        },
        undoTaskOccurrenceState() {
            throw new Error('Undo is not expected');
        },
        querySetup() {
            calls.push('querySetup');
            return Promise.resolve(setupOutcome());
        },
        queryPlan() {
            calls.push('queryPlan');
            return Promise.resolve(planOutcome());
        },
    };
    const ids = [
        '77777777-7777-4777-8777-777777777777',
        '88888888-8888-4888-8888-888888888888',
    ];
    const running = runWorkspaceTaskOccurrenceAction({
        bridge,
        plan: INITIAL_PLAN,
        occurrenceId: INITIAL_OCCURRENCE.occurrenceId,
        action: 'complete',
        makeId: () => ids.shift()!,
        now: () => 1_000,
        onStateChange: state => observedStates.push(state),
    });

    await Promise.resolve();
    assert.equal(observedStates.at(-1)?.commandState.submitting, true);
    assert.equal(observedStates.at(-1)?.commandState.projection, INITIAL_DETAIL);
    assert.deepEqual(calls, [
        `queryTaskSeries:${TASK_SERIES_ID}:${TERM.startDate}:${TERM.endDate}`,
        'setTaskOccurrenceStatus',
    ]);

    committing.resolve(committedOutcome());
    await Promise.resolve();
    assert.equal(observedStates.at(-1)?.commandState.projection, INITIAL_DETAIL);
    assert.equal(observedStates.at(-1)?.commandState.undoToast?.expiresAt, 7_000);
    assert.equal(calls.includes('querySetup'), false);
    assert.equal(calls.includes('queryPlan'), false);

    requerying.resolve(detailOutcome(REFRESHED_DETAIL));
    const result = await running;
    assert.equal(result.actionState?.commandState.projection, REFRESHED_DETAIL);
    assert.equal(result.refresh?.setup.projection, SETUP);
    assert.equal(result.refresh?.plan, REFRESHED_PLAN);
    assert.equal(result.problem, null);
    assert.deepEqual(calls.slice(-2).sort(), ['queryPlan', 'querySetup']);
});

test('App uses the PLAN window for complete and skip queries in a Term over 366 days', async () => {
    for (const action of ['complete', 'skip'] as const) {
        const queriedWindows: Readonly<{ startDate: string; endDate: string }>[] = [];
        let detailQueryCount = 0;
        const bridge: TaskActionAppBridge = {
            queryTaskSeries(_taskSeriesId, requestedWindow) {
                queriedWindows.push(requestedWindow);
                detailQueryCount += 1;
                const changedDetail = action === 'complete'
                    ? LONG_TERM_COMPLETED_DETAIL
                    : LONG_TERM_SKIPPED_DETAIL;
                return Promise.resolve(detailOutcome(
                    detailQueryCount === 1
                        ? LONG_TERM_INITIAL_DETAIL
                        : changedDetail,
                ));
            },
            setTaskOccurrenceStatus() {
                return Promise.resolve(committedOutcome());
            },
            undoTaskOccurrenceState() {
                throw new Error('Undo is not expected');
            },
            querySetup() {
                return Promise.resolve(setupOutcome());
            },
            queryPlan() {
                return Promise.resolve(planOutcome());
            },
        };
        const ids = [
            'c1111111-1111-4111-8111-111111111111',
            'c2222222-2222-4222-8222-222222222222',
        ];

        const result = await runWorkspaceTaskOccurrenceAction({
            bridge,
            plan: LONG_TERM_PLAN,
            occurrenceId: LONG_TERM_OCCURRENCE.occurrenceId,
            action,
            makeId: () => ids.shift()!,
            now: () => 1_000,
            onStateChange() {},
        });

        assert.equal(result.problem, null, action);
        assert.deepEqual(queriedWindows, [
            LONG_TERM_EVALUATION_WINDOW,
            LONG_TERM_EVALUATION_WINDOW,
        ], action);
    }
});

test('App queries around an off-week weekly anchor for complete, skip, and Undo', async () => {
    let completedState: TaskOccurrenceActionsState | null = null;
    for (const action of ['complete', 'skip'] as const) {
        const queriedWindows: Readonly<{ startDate: string; endDate: string }>[] = [];
        let detailQueryCount = 0;
        const bridge: TaskActionAppBridge = {
            queryTaskSeries(_taskSeriesId, requestedWindow) {
                queriedWindows.push(requestedWindow);
                detailQueryCount += 1;
                const changedDetail = action === 'complete'
                    ? LONG_TERM_REPLACED_WEEKLY_COMPLETED_DETAIL
                    : LONG_TERM_REPLACED_WEEKLY_SKIPPED_DETAIL;
                return Promise.resolve(detailOutcome(
                    detailQueryCount === 1
                        ? LONG_TERM_REPLACED_WEEKLY_DETAIL
                        : changedDetail,
                ));
            },
            setTaskOccurrenceStatus() {
                return Promise.resolve(committedOutcome(WEEKLY_UNDO_CAPABILITY));
            },
            undoTaskOccurrenceState() {
                throw new Error('Undo is not expected');
            },
            querySetup() {
                return Promise.resolve(setupOutcome());
            },
            queryPlan() {
                return Promise.resolve(planOutcome());
            },
        };
        const ids = [
            'e1111111-1111-4111-8111-111111111111',
            'e2222222-2222-4222-8222-222222222222',
        ];

        const result = await runWorkspaceTaskOccurrenceAction({
            bridge,
            plan: LONG_TERM_REPLACED_WEEKLY_PLAN,
            occurrenceId: LONG_TERM_REPLACED_WEEKLY_OCCURRENCE.occurrenceId,
            action,
            makeId: () => ids.shift()!,
            now: () => 1_000,
            onStateChange() {},
        });

        assert.equal(result.problem, null, action);
        assert.deepEqual(queriedWindows, [
            LONG_TERM_WEEKLY_QUERY_WINDOW,
            LONG_TERM_WEEKLY_QUERY_WINDOW,
        ], action);
        if (action === 'complete') {
            completedState = result.actionState;
        }
    }

    if (completedState === null) {
        throw new Error('Expected a formally completed weekly occurrence');
    }
    const undoWindows: TaskOccurrenceWindow[] = [];
    const undoBridge: TaskActionAppBridge = {
        queryTaskSeries(_taskSeriesId, requestedWindow) {
            undoWindows.push(requestedWindow);
            return Promise.resolve(detailOutcome(LONG_TERM_REPLACED_WEEKLY_RESTORED_DETAIL));
        },
        setTaskOccurrenceStatus() {
            throw new Error('Status is not expected during Undo');
        },
        undoTaskOccurrenceState() {
            return Promise.resolve(undoCommittedOutcome());
        },
        querySetup() {
            return Promise.resolve(setupOutcome());
        },
        queryPlan() {
            return Promise.resolve(planOutcome());
        },
    };
    const undoIds = [
        'e3333333-3333-4333-8333-333333333333',
        'e4444444-4444-4444-8444-444444444444',
    ];

    const undoResult = await runWorkspaceTaskOccurrenceUndo({
        bridge: undoBridge,
        actionState: completedState,
        makeId: () => undoIds.shift()!,
        now: () => 2_000,
        onStateChange() {},
    });

    assert.equal(undoResult.problem, null);
    assert.deepEqual(undoWindows, [LONG_TERM_WEEKLY_QUERY_WINDOW]);
});

test('App keeps Undo requery inside the bounded long-Term Task detail window', async () => {
    const baseState = createTaskOccurrenceActionsState(LONG_TERM_COMPLETED_DETAIL);
    const actionState: TaskOccurrenceActionsState = {
        ...baseState,
        commandState: {
            ...baseState.commandState,
            undoCapability: UNDO_CAPABILITY,
            undoToast: {
                capability: UNDO_CAPABILITY,
                expiresAt: 7_000,
                pausedAt: null,
            },
        },
    };
    const queriedWindows: Readonly<{ startDate: string; endDate: string }>[] = [];
    const bridge: TaskActionAppBridge = {
        queryTaskSeries(_taskSeriesId, requestedWindow) {
            queriedWindows.push(requestedWindow);
            return Promise.resolve(detailOutcome(LONG_TERM_RESTORED_DETAIL));
        },
        setTaskOccurrenceStatus() {
            throw new Error('Status is not expected');
        },
        undoTaskOccurrenceState() {
            return Promise.resolve(undoCommittedOutcome());
        },
        querySetup() {
            return Promise.resolve(setupOutcome());
        },
        queryPlan() {
            return Promise.resolve(planOutcome());
        },
    };
    const ids = [
        'd1111111-1111-4111-8111-111111111111',
        'd2222222-2222-4222-8222-222222222222',
    ];

    const result = await runWorkspaceTaskOccurrenceUndo({
        bridge,
        actionState,
        makeId: () => ids.shift()!,
        now: () => 2_000,
        onStateChange() {},
    });

    assert.equal(result.problem, null);
    assert.deepEqual(queriedWindows, [LONG_TERM_EVALUATION_WINDOW]);
});

test('App refreshes Setup/PLAN only after Undo persistence and formal Task requery', async () => {
    const baseState = createTaskOccurrenceActionsState(REFRESHED_DETAIL);
    const actionState: TaskOccurrenceActionsState = {
        ...baseState,
        commandState: {
            ...baseState.commandState,
            undoCapability: UNDO_CAPABILITY,
            undoToast: {
                capability: UNDO_CAPABILITY,
                expiresAt: 7_000,
                pausedAt: null,
            },
        },
    };
    const undoing = deferred<WorkspaceSetupOutcome>();
    const requerying = deferred<WorkspaceSetupOutcome>();
    const calls: string[] = [];
    const observedStates: (TaskOccurrenceActionsState | null)[] = [];
    const bridge: TaskActionAppBridge = {
        queryTaskSeries() {
            calls.push('queryTaskSeries');
            return requerying.promise;
        },
        setTaskOccurrenceStatus() {
            throw new Error('Status is not expected');
        },
        undoTaskOccurrenceState() {
            calls.push('undoTaskOccurrenceState');
            return undoing.promise;
        },
        querySetup() {
            calls.push('querySetup');
            return Promise.resolve(setupOutcome());
        },
        queryPlan() {
            calls.push('queryPlan');
            return Promise.resolve(planOutcome());
        },
    };
    const ids = [
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ];
    const running = runWorkspaceTaskOccurrenceUndo({
        bridge,
        actionState,
        makeId: () => ids.shift()!,
        now: () => 2_000,
        onStateChange: state => observedStates.push(state),
    });

    assert.equal(observedStates.at(-1)?.commandState.submitting, true);
    assert.equal(observedStates.at(-1)?.commandState.projection, REFRESHED_DETAIL);
    undoing.resolve(undoCommittedOutcome());
    await Promise.resolve();
    assert.equal(observedStates.at(-1)?.commandState.projection, REFRESHED_DETAIL);
    assert.equal(calls.includes('querySetup'), false);
    assert.equal(calls.includes('queryPlan'), false);

    requerying.resolve(detailOutcome(RESTORED_DETAIL));
    const result = await running;
    assert.equal(result.actionState?.commandState.projection, RESTORED_DETAIL);
    assert.equal(result.refresh?.plan, REFRESHED_PLAN);
    assert.equal(result.problem, null);
    assert.deepEqual(calls, [
        'undoTaskOccurrenceState',
        'queryTaskSeries',
        'querySetup',
        'queryPlan',
    ]);
});

test('App reports an unknown Task result and keeps its request when the bridge rejects', async () => {
    const observedStates: (TaskOccurrenceActionsState | null)[] = [];
    let refreshCount = 0;
    let detailQueryCount = 0;
    const submittedCommands: Parameters<TaskActionAppBridge['setTaskOccurrenceStatus']>[0][] = [];
    const bridge: TaskActionAppBridge = {
        queryTaskSeries() {
            detailQueryCount += 1;
            return Promise.resolve(detailOutcome(
                detailQueryCount === 1 ? INITIAL_DETAIL : REFRESHED_DETAIL,
            ));
        },
        setTaskOccurrenceStatus(command) {
            submittedCommands.push(command);
            return submittedCommands.length === 1
                ? Promise.reject(new Error('Workspace disconnected'))
                : Promise.resolve(committedOutcome());
        },
        undoTaskOccurrenceState() {
            throw new Error('Undo is not expected');
        },
        querySetup() {
            refreshCount += 1;
            return Promise.resolve(setupOutcome());
        },
        queryPlan() {
            refreshCount += 1;
            return Promise.resolve(planOutcome());
        },
    };

    const result = await runWorkspaceTaskOccurrenceAction({
        bridge,
        plan: INITIAL_PLAN,
        occurrenceId: INITIAL_OCCURRENCE.occurrenceId,
        action: 'skip',
        makeId: () => '77777777-7777-4777-8777-777777777777',
        now: () => 1_000,
        onStateChange: state => observedStates.push(state),
    });

    assert.equal(observedStates.some(item => item?.commandState.submitting === true), true);
    assert.notEqual(result.actionState, null);
    assert.equal(result.actionState?.commandState.submitting, false);
    assert.notEqual(result.actionState?.commandState.draft, null);
    assert.match(result.problem ?? '', /结果尚无法确认/);
    assert.doesNotMatch(result.problem ?? '', /没有改变/);
    assert.equal(refreshCount, 0);

    const blocked = await runWorkspaceTaskOccurrenceAction({
        bridge,
        plan: INITIAL_PLAN,
        occurrenceId: INITIAL_OCCURRENCE.occurrenceId,
        action: 'complete',
        actionState: result.actionState ?? undefined,
        makeId() {
            throw new Error('A competing action must not replace an unknown request');
        },
        now: () => 1_250,
        onStateChange: state => observedStates.push(state),
    });
    assert.equal(blocked.actionState, result.actionState);
    assert.equal(blocked.refresh, null);
    assert.match(blocked.problem ?? '', /先重试或核对上次/);
    assert.equal(detailQueryCount, 1);
    assert.equal(submittedCommands.length, 1);

    const retry = await runWorkspaceTaskOccurrenceAction({
        bridge,
        plan: INITIAL_PLAN,
        occurrenceId: INITIAL_OCCURRENCE.occurrenceId,
        action: 'skip',
        actionState: result.actionState ?? undefined,
        makeId() {
            throw new Error('An unknown transport retry must reuse its exact command IDs');
        },
        now: () => 1_500,
        onStateChange: state => observedStates.push(state),
    });
    assert.equal(retry.problem, null);
    assert.equal(submittedCommands.length, 2);
    assert.deepEqual(submittedCommands[1], submittedCommands[0]);
    assert.equal(detailQueryCount, 2);
    assert.equal(refreshCount, 2);
});

test('App reports an unknown Undo result without leaving the control submitting', async () => {
    const baseState = createTaskOccurrenceActionsState(REFRESHED_DETAIL);
    const actionState: TaskOccurrenceActionsState = {
        ...baseState,
        commandState: {
            ...baseState.commandState,
            undoCapability: UNDO_CAPABILITY,
            undoToast: {
                capability: UNDO_CAPABILITY,
                expiresAt: 7_000,
                pausedAt: null,
            },
        },
    };
    const submittedCommands: Parameters<TaskActionAppBridge['undoTaskOccurrenceState']>[0][] = [];
    const bridge: TaskActionAppBridge = {
        queryTaskSeries() {
            return Promise.resolve(detailOutcome(RESTORED_DETAIL));
        },
        setTaskOccurrenceStatus() {
            throw new Error('Status is not expected');
        },
        undoTaskOccurrenceState(command) {
            submittedCommands.push(command);
            return submittedCommands.length === 1
                ? Promise.reject(new Error('Workspace disconnected'))
                : Promise.resolve(undoCommittedOutcome());
        },
        querySetup() {
            return Promise.resolve(setupOutcome());
        },
        queryPlan() {
            return Promise.resolve(planOutcome());
        },
    };

    const result = await runWorkspaceTaskOccurrenceUndo({
        bridge,
        actionState,
        makeId: () => '77777777-7777-4777-8777-777777777777',
        now: () => 2_000,
        onStateChange(): void {},
    });

    assert.notEqual(result.actionState, null);
    assert.equal(result.actionState?.commandState.submitting, false);
    assert.notEqual(result.actionState?.commandState.undoCapability, null);
    assert.match(result.problem ?? '', /结果尚无法确认/);
    assert.doesNotMatch(result.problem ?? '', /没有改变/);
    const presentation = taskUndoPresentationFrom(result.actionState, false);
    assert.equal(presentation?.message, '撤销结果尚无法确认；请精确重试本次撤销请求。');
    assert.equal(presentation?.actionLabel, '精确重试撤销');
    assert.doesNotMatch(presentation?.message ?? '', /已保存|6 秒/);
    const expiredWhilePending = advanceTaskUndoTimerState(result.actionState, 10_000);
    assert.equal(expiredWhilePending?.commandState.undoToast, result.actionState?.commandState.undoToast);

    const retry = await runWorkspaceTaskOccurrenceUndo({
        bridge,
        actionState: result.actionState ?? actionState,
        makeId() {
            throw new Error('An unknown Undo retry must reuse its exact command IDs');
        },
        now: () => 10_000,
        onStateChange(): void {},
    });
    assert.equal(retry.problem, null);
    assert.equal(submittedCommands.length, 2);
    assert.deepEqual(submittedCommands[1], submittedCommands[0]);
});

test('App preserves a committed Task receipt when its formal requery rejects', async () => {
    const observedStates: (TaskOccurrenceActionsState | null)[] = [];
    let detailQueryCount = 0;
    const bridge: TaskActionAppBridge = {
        queryTaskSeries() {
            detailQueryCount += 1;
            return detailQueryCount === 1
                ? Promise.resolve(detailOutcome(INITIAL_DETAIL))
                : Promise.reject(new Error('Requery disconnected'));
        },
        setTaskOccurrenceStatus() {
            return Promise.resolve(committedOutcome());
        },
        undoTaskOccurrenceState() {
            throw new Error('Undo is not expected');
        },
        querySetup() {
            throw new Error('Setup refresh is not expected');
        },
        queryPlan() {
            throw new Error('PLAN refresh is not expected');
        },
    };

    const result = await runWorkspaceTaskOccurrenceAction({
        bridge,
        plan: INITIAL_PLAN,
        occurrenceId: INITIAL_OCCURRENCE.occurrenceId,
        action: 'complete',
        makeId: () => '77777777-7777-4777-8777-777777777777',
        now: () => 1_000,
        onStateChange: state => observedStates.push(state),
    });

    assert.notEqual(result.actionState, null);
    assert.equal(result.actionState?.commandState.submitting, false);
    assert.notEqual(result.actionState?.commandState.requeryRequest, null);
    assert.equal(result.actionState?.commandState.projection, INITIAL_DETAIL);
    assert.equal(observedStates.at(-1), result.actionState);
    assert.match(result.problem ?? '', /已保存，但无法验证最新投影/);
});

test('App preserves a committed Undo receipt when its formal requery rejects', async () => {
    const baseState = createTaskOccurrenceActionsState(REFRESHED_DETAIL);
    const actionState: TaskOccurrenceActionsState = {
        ...baseState,
        commandState: {
            ...baseState.commandState,
            undoCapability: UNDO_CAPABILITY,
            undoToast: {
                capability: UNDO_CAPABILITY,
                expiresAt: 7_000,
                pausedAt: null,
            },
        },
    };
    const observedStates: (TaskOccurrenceActionsState | null)[] = [];
    const bridge: TaskActionAppBridge = {
        queryTaskSeries() {
            return Promise.reject(new Error('Requery disconnected'));
        },
        setTaskOccurrenceStatus() {
            throw new Error('Status is not expected');
        },
        undoTaskOccurrenceState() {
            return Promise.resolve(undoCommittedOutcome());
        },
        querySetup() {
            throw new Error('Setup refresh is not expected');
        },
        queryPlan() {
            throw new Error('PLAN refresh is not expected');
        },
    };

    const result = await runWorkspaceTaskOccurrenceUndo({
        bridge,
        actionState,
        makeId: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        now: () => 2_000,
        onStateChange: state => observedStates.push(state),
    });

    assert.notEqual(result.actionState, null);
    assert.equal(result.actionState?.commandState.submitting, false);
    assert.notEqual(result.actionState?.commandState.requeryRequest, null);
    assert.equal(result.actionState?.commandState.projection, REFRESHED_DETAIL);
    assert.equal(observedStates.at(-1), result.actionState);
    assert.match(result.problem ?? '', /已撤销，但无法验证最新投影/);
});

test('App schedules Undo expiry only from an unpaused toast expiresAt', () => {
    const baseState = createTaskOccurrenceActionsState(REFRESHED_DETAIL);
    const visibleState: TaskOccurrenceActionsState = {
        ...baseState,
        commandState: {
            ...baseState.commandState,
            undoCapability: UNDO_CAPABILITY,
            undoToast: {
                capability: UNDO_CAPABILITY,
                expiresAt: 7_000,
                pausedAt: null,
            },
        },
    };

    assert.equal(taskUndoTimerDelayFrom(visibleState, 2_000), 5_000);
    assert.equal(taskUndoTimerDelayFrom(visibleState, 8_000), 0);
    assert.equal(taskUndoTimerDelayFrom({
        ...visibleState,
        commandState: {
            ...visibleState.commandState,
            undoToast: {
                ...visibleState.commandState.undoToast!,
                pausedAt: 2_500,
            },
        },
    }, 3_000), null);
    assert.equal(taskUndoTimerDelayFrom(baseState, 2_000), null);
});

test('App restores Task action focus above fixed feedback without animated scrolling', () => {
    const focusOptions: (FocusOptions | undefined)[] = [];
    const scrollOptions: (boolean | ScrollIntoViewOptions | undefined)[] = [];
    const target = {
        focus(options?: FocusOptions): void {
            focusOptions.push(options);
        },
        scrollIntoView(options?: boolean | ScrollIntoViewOptions): void {
            scrollOptions.push(options);
        },
    };

    focusTaskActionTarget(target);

    assert.deepEqual(focusOptions, [{ preventScroll: true }]);
    assert.deepEqual(scrollOptions, [{
        behavior: 'auto',
        block: 'center',
        inline: 'nearest',
    }]);
});
