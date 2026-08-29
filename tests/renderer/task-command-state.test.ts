/**
 * @file Verifies Renderer-only Task draft, command, requery, and Undo state semantics.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    advanceTaskCommandState,
    createTaskCommandState,
    receiveTaskCommandOutcome,
    receiveTaskPreviewOutcome,
    receiveTaskRequeryOutcome,
    receiveTaskUndoOutcome,
    saveTaskDraft,
    setTaskUndoToastPaused,
    startTaskSubmission,
    startTaskUndo,
} from '../../src/renderer/task-command-state';
import {
    type TaskCommand,
    type TaskOccurrenceImpactProjection,
    type TaskSeriesDetailProjection,
    type TaskUndoCapability,
} from '../../src/shared/workspace-task-contract';
import {
    isWorkspaceSetupOutcome,
    type WorkspaceSetupOutcome,
    type WorkspaceSetupProblem,
} from '../../src/shared/workspace-setup-contract';

const APP_BUILD_ID = 'development:1234567890abcdef1234567890abcdef12345678';
const REQUEST_ID = 'renderer-task-request';
const WORKSPACE_EPOCH = '00000000-0000-4000-8000-000000000001';
const COURSE_ID = '33333333-3333-4333-8333-333333333333';
const TASK_SERIES_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_TASK_SERIES_ID = '99999999-9999-4999-8999-999999999999';
const SEGMENT_ID = '66666666-6666-4666-8666-666666666666';
const OTHER_SEGMENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const COMMAND = {
    commandId: '11111111-1111-4111-8111-111111111111',
    followUpId: '22222222-2222-4222-8222-222222222222',
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
} as const satisfies TaskCommand;

const DRAFT_B = {
    ...COMMAND,
    commandId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    followUpId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    expectedRevision: '4',
    expectedPlanVersion: '4',
    expectedTaskSeriesVersion: '2',
    intent: {
        ...COMMAND.intent,
        payload: { ...COMMAND.intent.payload, status: 'pending' },
    },
} as const satisfies TaskCommand;

const DELETE_WHOLE_SERIES_COMMAND = {
    commandId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    followUpId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    expectedRevision: '3',
    expectedPlanVersion: '3',
    expectedTaskSeriesVersion: '1',
    confirmationToken: 'd'.repeat(64),
    impactWindow: { startDate: '2026-10-01', endDate: '2026-10-31' },
    intent: {
        kind: 'plan.delete-task-occurrence-or-series',
        intentSchemaVersion: 1,
        payload: {
            taskSeriesId: TASK_SERIES_ID,
            scope: 'whole-series',
        },
    },
} as const satisfies TaskCommand;

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

const REQUERIED_PROJECTION = {
    ...INITIAL_PROJECTION,
    workspaceRevision: '4',
    planEntityVersion: '4',
    entityVersion: '2',
    historicalStates: [{
        occurrenceId: { taskSeriesId: TASK_SERIES_ID, originalLogicalAnchor: 'once' },
        status: 'completed',
        reportedProgress: null,
        displayProgress: null,
        title: INITIAL_PROJECTION.title,
        size: INITIAL_PROJECTION.size,
        deadline: INITIAL_PROJECTION.schedule.deadline,
    }],
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

const OTHER_PROJECTION = {
    ...REQUERIED_PROJECTION,
    taskSeriesId: OTHER_TASK_SERIES_ID,
    segments: [{
        ...REQUERIED_PROJECTION.segments[0],
        segmentId: OTHER_SEGMENT_ID,
    }],
    historicalStates: [{
        ...REQUERIED_PROJECTION.historicalStates[0],
        occurrenceId: {
            taskSeriesId: OTHER_TASK_SERIES_ID,
            originalLogicalAnchor: 'once',
        },
    }],
    occurrences: [{
        ...REQUERIED_PROJECTION.occurrences[0],
        occurrenceId: {
            taskSeriesId: OTHER_TASK_SERIES_ID,
            originalLogicalAnchor: 'once',
        },
        segmentId: OTHER_SEGMENT_ID,
    }],
} as const satisfies TaskSeriesDetailProjection;

const UNDO_CAPABILITY = {
    token: 'a'.repeat(64),
    taskSeriesId: TASK_SERIES_ID,
    originalLogicalAnchor: 'once',
    committedRevision: '4',
    validThroughTaskSeriesVersion: '2',
} as const satisfies TaskUndoCapability;

const IMPACT_PROJECTION = {
    basedOnRevision: '3',
    planEntityVersion: '3',
    taskSeriesVersion: '1',
    affectedEntities: [{ kind: 'task-series', id: TASK_SERIES_ID, version: '1' }],
    effects: [{
        code: 'plan.task-occurrence-changed',
        scope: 'this-and-future',
        originalLogicalAnchor: '2026-10-10',
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
    originalLogicalAnchor: '2026-10-10',
    scope: 'this-and-future',
    action: 'change',
    requestedWindow: INITIAL_PROJECTION.requestedWindow,
    affectedFutureSegmentCount: '1',
    futureOverrideCount: '0',
    historicalStateCount: '0',
    currentFutureOccurrences: [{
        occurrenceId: {
            taskSeriesId: TASK_SERIES_ID,
            originalLogicalAnchor: '2026-10-10',
        },
        segmentId: SEGMENT_ID,
        title: 'Read Chapter 1',
        size: 'small',
        deadline: { kind: 'date-only', date: '2026-10-10' },
        status: 'pending',
        reportedProgress: null,
        displayProgress: null,
        overrideKind: 'none',
    }],
    futureOccurrencesAfterChange: [{
        occurrenceId: {
            taskSeriesId: TASK_SERIES_ID,
            originalLogicalAnchor: '2026-10-10',
        },
        title: 'Read Chapter 1 later',
        size: 'small',
        deadline: { kind: 'date-only', date: '2026-10-10' },
        status: 'pending',
        reportedProgress: null,
        displayProgress: null,
        overrideKind: 'none',
    }],
    confirmationToken: 'b'.repeat(64),
} as const satisfies TaskOccurrenceImpactProjection;

function validatedOutcome(candidate: unknown): WorkspaceSetupOutcome {
    assert.equal(isWorkspaceSetupOutcome(
        candidate,
        APP_BUILD_ID,
        REQUEST_ID,
        WORKSPACE_EPOCH,
    ), true);
    return candidate as WorkspaceSetupOutcome;
}

function problemOutcome(
    code: WorkspaceSetupProblem['code'],
    message: string,
): WorkspaceSetupOutcome {
    return validatedOutcome({
        ok: false,
        problem: {
            code,
            message,
            requestId: REQUEST_ID,
            appBuildId: APP_BUILD_ID,
            workspaceEpoch: WORKSPACE_EPOCH,
            dataEffect: 'unchanged',
        },
    });
}

function outcomeProblem(outcome: WorkspaceSetupOutcome): WorkspaceSetupProblem {
    if (outcome.ok) {
        throw new Error('Expected a Workspace problem outcome');
    }
    return outcome.problem;
}

function committedOutcome(options: Readonly<{
    revision?: string;
    version?: string;
    code?:
        | 'plan.task-occurrence-status-set'
        | 'plan.task-occurrence-deleted'
        | 'plan.task-series-deleted';
    undoCapability?: TaskUndoCapability | null;
}> = {}): WorkspaceSetupOutcome {
    const undoCapability = options.undoCapability === undefined
        ? UNDO_CAPABILITY
        : options.undoCapability;
    return validatedOutcome({
        ok: true,
        value: {
            kind: 'workspace.command-outcome',
            protocolVersion: 3,
            appBuildId: APP_BUILD_ID,
            requestId: REQUEST_ID,
            workspaceEpoch: WORKSPACE_EPOCH,
            outcome: {
                kind: 'committed',
                revision: options.revision ?? '4',
                effects: [{
                    code: options.code ?? 'plan.task-occurrence-status-set',
                    entity: {
                        kind: 'task-series',
                        id: TASK_SERIES_ID,
                        version: options.version ?? '2',
                    },
                }],
                pendingFollowUps: ['55555555-5555-4555-8555-555555555555'],
                ...(undoCapability === null ? {} : { undoCapability }),
            },
        },
    });
}

function projectionOutcome(projection: TaskSeriesDetailProjection): WorkspaceSetupOutcome {
    return validatedOutcome({
        ok: true,
        value: {
            kind: 'workspace.task-series-projection',
            protocolVersion: 3,
            appBuildId: APP_BUILD_ID,
            requestId: REQUEST_ID,
            workspaceEpoch: WORKSPACE_EPOCH,
            dataMode: 'ready',
            projection,
        },
    });
}

function setupProjectionOutcome(workspaceRevision: string): WorkspaceSetupOutcome {
    const termId = '77777777-7777-4777-8777-777777777777';
    return validatedOutcome({
        ok: true,
        value: {
            kind: 'workspace.setup-projection',
            protocolVersion: 3,
            appBuildId: APP_BUILD_ID,
            requestId: REQUEST_ID,
            workspaceEpoch: WORKSPACE_EPOCH,
            dataMode: 'ready',
            projection: {
                workspaceRevision,
                planEntityVersion: workspaceRevision,
                minimum: {
                    hasCurrentTerm: true,
                    hasCurrentTermCourse: true,
                    hasMeetingOrTask: false,
                    isSatisfied: true,
                },
                everReachedMinimum: true,
                defaultRoute: 'today',
                draftCheckpointVersion: '0',
                draftCheckpoint: null,
                currentTerm: {
                    termId,
                    name: 'Fall 2026',
                    startDate: '2026-09-01',
                    endDate: '2026-12-20',
                    timeZone: 'America/Toronto',
                    archived: false,
                    entityVersion: '1',
                },
                terms: [{
                    termId,
                    name: 'Fall 2026',
                    startDate: '2026-09-01',
                    endDate: '2026-12-20',
                    timeZone: 'America/Toronto',
                    archived: false,
                    entityVersion: '1',
                }],
                courses: [{
                    courseId: COURSE_ID,
                    termId,
                    code: 'CSC301',
                    name: 'Introduction to Software Engineering',
                    section: null,
                    instructor: null,
                    color: null,
                    credits: null,
                    teachingRange: {
                        kind: 'inherit-term',
                        startDate: '2026-09-01',
                        endDate: '2026-12-20',
                    },
                    archived: false,
                    entityVersion: '1',
                    meetings: [],
                }],
                holidayRanges: [],
                tasks: [],
            },
        },
    });
}

function previewOutcome(): WorkspaceSetupOutcome {
    return validatedOutcome({
        ok: true,
        value: {
            kind: 'workspace.task-occurrence-impact',
            protocolVersion: 3,
            appBuildId: APP_BUILD_ID,
            requestId: REQUEST_ID,
            workspaceEpoch: WORKSPACE_EPOCH,
            dataMode: 'ready',
            projection: IMPACT_PROJECTION,
        },
    });
}

function undoCommittedOutcome(): WorkspaceSetupOutcome {
    return validatedOutcome({
        ok: true,
        value: {
            kind: 'workspace.command-outcome',
            protocolVersion: 3,
            appBuildId: APP_BUILD_ID,
            requestId: REQUEST_ID,
            workspaceEpoch: WORKSPACE_EPOCH,
            outcome: {
                kind: 'committed',
                revision: '5',
                effects: [{
                    code: 'plan.task-occurrence-state-undone',
                    entity: {
                        kind: 'task-series',
                        id: TASK_SERIES_ID,
                        version: '3',
                    },
                }],
                pendingFollowUps: ['88888888-8888-4888-8888-888888888888'],
            },
        },
    });
}

test('TEST-SHELL-003: problems retain the submitted draft and formal projection', () => {
    for (const [code, message] of [
        ['decision-required', '需要确认影响范围。'],
        ['stale-workspace', '工作区已经过期。'],
        ['conflict', '任务已经被更新。'],
        ['validation', '任务标题无效。'],
    ] as const) {
        const saved = saveTaskDraft(createTaskCommandState(INITIAL_PROJECTION), COMMAND);
        const state = receiveTaskCommandOutcome(
            startTaskSubmission(saved),
            problemOutcome(code, message),
            1_000,
        );

        assert.equal(state.submitting, false);
        assert.equal(state.requeryRequest, null);
        assert.equal(state.draft, COMMAND);
        assert.equal(state.projection, INITIAL_PROJECTION);
        assert.deepEqual(state.problem, outcomeProblem(problemOutcome(code, message)));
    }
});

test('TEST-SHELL-003: a commit binds requery to its series, revision, version, and draft', () => {
    const saved = saveTaskDraft(createTaskCommandState(INITIAL_PROJECTION), COMMAND);
    const committed = receiveTaskCommandOutcome(startTaskSubmission(saved), committedOutcome(), 1_000);

    assert.equal(committed.submitting, false);
    assert.deepEqual(committed.requeryRequest, {
        kind: 'task-series-detail',
        taskSeriesId: TASK_SERIES_ID,
        committedRevision: '4',
        minimumTaskSeriesVersion: '2',
        submittedDraft: COMMAND,
    });
    assert.equal(committed.draft, COMMAND);
    assert.equal(committed.projection, INITIAL_PROJECTION);
    assert.deepEqual(committed.undoCapability, UNDO_CAPABILITY);
    assert.deepEqual(committed.pendingFollowUps, ['55555555-5555-4555-8555-555555555555']);
    assert.deepEqual(committed.undoToast, {
        capability: UNDO_CAPABILITY,
        expiresAt: 7_000,
        pausedAt: null,
    });
});

test('TEST-SHELL-003/TEST-FLOW-01-COMMIT: preview remains separate from the draft and formal projection', () => {
    const saved = saveTaskDraft(createTaskCommandState(INITIAL_PROJECTION), COMMAND);
    const previewed = receiveTaskPreviewOutcome(saved, previewOutcome());

    assert.equal(previewed.draft, COMMAND);
    assert.equal(previewed.projection, INITIAL_PROJECTION);
    assert.equal(previewed.impactProjection, IMPACT_PROJECTION);
    const stale = receiveTaskPreviewOutcome(
        previewed,
        problemOutcome('stale-workspace', '预览已经过期。'),
    );
    assert.equal(stale.draft, COMMAND);
    assert.equal(stale.projection, INITIAL_PROJECTION);
    assert.equal(stale.impactProjection, null);
    assert.equal(stale.problem?.code, 'stale-workspace');
});

test('TEST-SHELL-003: wrong-series and stale requery projections cannot replace formal state', () => {
    const saved = saveTaskDraft(createTaskCommandState(INITIAL_PROJECTION), COMMAND);
    const committed = receiveTaskCommandOutcome(startTaskSubmission(saved), committedOutcome(), 1_000);

    assert.equal(receiveTaskRequeryOutcome(
        committed,
        projectionOutcome(OTHER_PROJECTION),
    ), committed);
    assert.equal(receiveTaskRequeryOutcome(
        committed,
        projectionOutcome(INITIAL_PROJECTION),
    ), committed);
});

test('TEST-SHELL-003: the matching requery clears only the draft that produced its commit', () => {
    const saved = saveTaskDraft(createTaskCommandState(INITIAL_PROJECTION), COMMAND);
    const committed = receiveTaskCommandOutcome(startTaskSubmission(saved), committedOutcome(), 1_000);
    const failedRequery = receiveTaskRequeryOutcome(
        committed,
        problemOutcome('workspace-unavailable', '查询暂时不可用。'),
    );

    assert.notEqual(failedRequery.requeryRequest, null);
    assert.equal(failedRequery.draft, COMMAND);
    assert.equal(failedRequery.projection, INITIAL_PROJECTION);

    const requerySucceeded = receiveTaskRequeryOutcome(
        failedRequery,
        projectionOutcome(REQUERIED_PROJECTION),
    );
    assert.equal(requerySucceeded.requeryRequest, null);
    assert.equal(requerySucceeded.draft, null);
    assert.equal(requerySucceeded.problem, null);
    assert.equal(requerySucceeded.projection, REQUERIED_PROJECTION);

    const withDraftB = saveTaskDraft(committed, DRAFT_B);
    const requeryAfterDraftB = receiveTaskRequeryOutcome(
        withDraftB,
        projectionOutcome(REQUERIED_PROJECTION),
    );
    assert.equal(requeryAfterDraftB.draft, DRAFT_B);
    assert.equal(requeryAfterDraftB.projection, REQUERIED_PROJECTION);
});

test('TEST-SHELL-003: a newer same-series requery invalidates Undo while a valid version keeps it', () => {
    const saved = saveTaskDraft(createTaskCommandState(INITIAL_PROJECTION), COMMAND);
    const committed = receiveTaskCommandOutcome(startTaskSubmission(saved), committedOutcome(), 1_000);
    const paused = setTaskUndoToastPaused(committed, true, 2_000);

    const stillValid = receiveTaskRequeryOutcome(
        paused,
        projectionOutcome(REQUERIED_PROJECTION),
    );
    assert.deepEqual(stillValid.undoCapability, UNDO_CAPABILITY);
    assert.deepEqual(stillValid.undoToast, paused.undoToast);

    const invalidated = receiveTaskRequeryOutcome(
        paused,
        projectionOutcome(RESTORED_PROJECTION),
    );
    assert.equal(invalidated.undoCapability, null);
    assert.equal(invalidated.undoToast, null);
    assert.equal(invalidated.undoSubmission, null);
});

test('TEST-SHELL-003: whole-series deletion requests an absence-confirming list refresh', () => {
    const saved = saveTaskDraft(
        createTaskCommandState(INITIAL_PROJECTION),
        DELETE_WHOLE_SERIES_COMMAND,
    );
    const committed = receiveTaskCommandOutcome(startTaskSubmission(saved), committedOutcome({
        code: 'plan.task-series-deleted',
        undoCapability: null,
    }), 1_000);

    assert.deepEqual(committed.requeryRequest, {
        kind: 'task-list',
        taskSeriesId: TASK_SERIES_ID,
        committedRevision: '4',
        minimumTaskSeriesVersion: '2',
        submittedDraft: DELETE_WHOLE_SERIES_COMMAND,
    });
    assert.equal(receiveTaskRequeryOutcome(
        committed,
        projectionOutcome(REQUERIED_PROJECTION),
    ), committed);
    assert.equal(receiveTaskRequeryOutcome(
        committed,
        setupProjectionOutcome('3'),
    ), committed);

    const refreshed = receiveTaskRequeryOutcome(committed, setupProjectionOutcome('4'));
    assert.equal(refreshed.requeryRequest, null);
    assert.equal(refreshed.draft, null);
    assert.equal(refreshed.projection, null);

    const staleUndoState = {
        ...committed,
        undoCapability: UNDO_CAPABILITY,
        undoToast: {
            capability: UNDO_CAPABILITY,
            expiresAt: 7_000,
            pausedAt: 2_000,
        },
    };
    const refreshedWithOldUndo = receiveTaskRequeryOutcome(
        staleUndoState,
        setupProjectionOutcome('4'),
    );
    assert.equal(refreshedWithOldUndo.undoCapability, null);
    assert.equal(refreshedWithOldUndo.undoToast, null);
});

test('TEST-SHELL-003: a six-second Undo toast pauses for interaction and keeps normal restore', () => {
    const saved = saveTaskDraft(createTaskCommandState(INITIAL_PROJECTION), COMMAND);
    const committed = receiveTaskCommandOutcome(startTaskSubmission(saved), committedOutcome(), 1_000);
    const paused = setTaskUndoToastPaused(committed, true, 2_000);
    assert.deepEqual(advanceTaskCommandState(paused, 8_000).undoToast, {
        capability: UNDO_CAPABILITY,
        expiresAt: 7_000,
        pausedAt: 2_000,
    });
    const resumed = setTaskUndoToastPaused(paused, false, 9_000);
    assert.equal(advanceTaskCommandState(resumed, 13_999).undoToast?.expiresAt, 14_000);
    const expired = advanceTaskCommandState(resumed, 14_000);

    assert.equal(expired.undoToast, null);
    assert.deepEqual(expired.undoCapability, UNDO_CAPABILITY);
});

test('TEST-SHELL-003: Undo conflict, used, and expired outcomes preserve formal projection', () => {
    for (const message of ['撤销与新版本冲突。', '撤销已经使用。', '撤销已经过期。']) {
        const saved = saveTaskDraft(createTaskCommandState(INITIAL_PROJECTION), COMMAND);
        const committed = receiveTaskCommandOutcome(startTaskSubmission(saved), committedOutcome(), 1_000);
        const undone = receiveTaskUndoOutcome(
            startTaskUndo(committed),
            problemOutcome('conflict', message),
        );

        assert.equal(undone.submitting, false);
        assert.equal(undone.projection, INITIAL_PROJECTION);
        assert.equal(undone.undoCapability, null);
        assert.equal(undone.undoToast, null);
        assert.deepEqual(undone.problem, outcomeProblem(problemOutcome('conflict', message)));
    }
});

test('TEST-SHELL-003/TEST-FLOW-01-COMMIT: successful Undo consumes capability, ' +
    'retains follow-up, and requeries', () => {
    const saved = saveTaskDraft(createTaskCommandState(INITIAL_PROJECTION), COMMAND);
    const committed = receiveTaskCommandOutcome(startTaskSubmission(saved), committedOutcome(), 1_000);
    const committedProjection = receiveTaskRequeryOutcome(
        committed,
        projectionOutcome(REQUERIED_PROJECTION),
    );
    const undone = receiveTaskUndoOutcome(startTaskUndo(committedProjection), undoCommittedOutcome());

    assert.equal(undone.submitting, false);
    assert.deepEqual(undone.requeryRequest, {
        kind: 'task-series-detail',
        taskSeriesId: TASK_SERIES_ID,
        committedRevision: '5',
        minimumTaskSeriesVersion: '3',
        submittedDraft: null,
    });
    assert.equal(undone.projection, REQUERIED_PROJECTION);
    assert.equal(undone.undoCapability, null);
    assert.equal(undone.undoToast, null);
    assert.deepEqual(undone.pendingFollowUps, ['88888888-8888-4888-8888-888888888888']);

    const requeried = receiveTaskRequeryOutcome(undone, projectionOutcome(RESTORED_PROJECTION));
    assert.equal(requeried.requeryRequest, null);
    assert.equal(requeried.projection, RESTORED_PROJECTION);
});
