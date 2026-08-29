/**
 * @file Verifies cross-entity invariants on Workspace setup projections.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    isWorkspaceSetupOutcome,
    isWorkspaceProcessRequest,
    isWorkspaceSetupRequest,
    makeChangeTaskOccurrenceRequest,
    makeCreateCourseWithMeetingRequest,
    makeDiscardSetupDraftCheckpointRequest,
    makePlanQueryRequest,
    makeSaveSetupDraftCheckpointRequest,
    makeTaskSeriesQueryRequest,
} from '../../src/shared/workspace-setup-contract';
import {
    makeApplicationBuildStatusRequest,
    makeMigrationSafetyCopyQueryRequest,
} from '../../src/shared/workspace-migration-contract';
import { MAX_SETUP_DRAFT_PAYLOAD_BYTES } from '../../src/shared/workspace-term-contract';
import {
    buildPlanProjection,
    createPlanEvaluationContext,
} from '../../src/shared/workspace-plan-contract';

const APP_BUILD_ID = 'development:1234567890abcdef1234567890abcdef12345678';
const REQUEST_ID = 'request';
const WORKSPACE_EPOCH = '11111111-1111-4111-8111-111111111111';
const TERM = {
    termId: '22222222-2222-4222-8222-222222222222',
    name: 'Fall 2026',
    startDate: '2026-09-01',
    endDate: '2026-12-20',
    timeZone: 'America/Toronto',
    archived: false,
    entityVersion: '1',
} as const;
const COURSE = {
    courseId: '33333333-3333-4333-8333-333333333333',
    termId: TERM.termId,
    code: 'CSC301',
    name: 'Introduction to Software Engineering',
    section: null,
    instructor: null,
    color: null,
    credits: null,
    teachingRange: {
        kind: 'inherit-term',
        startDate: TERM.startDate,
        endDate: TERM.endDate,
    },
    archived: false,
    entityVersion: '1',
    meetings: [{
        meetingSeriesId: '44444444-4444-4444-8444-444444444444',
        type: { code: 'LEC', name: 'Lecture' },
        weekday: 'MON',
        localStart: '09:00',
        localEnd: '10:00',
        endDayOffset: 0,
        effectiveRange: {
            kind: 'inherit-course',
            startDate: TERM.startDate,
            endDate: TERM.endDate,
        },
        location: { kind: 'tba' },
        entityVersion: '1',
    }],
} as const;
const HOLIDAY_RANGE = {
    holidayRangeId: '55555555-5555-4555-8555-555555555555',
    termId: TERM.termId,
    name: 'Reading Week',
    startDate: '2026-10-12',
    endDate: '2026-10-16',
    entityVersion: '1',
} as const;
const TASK = {
    taskSeriesId: '66666666-6666-4666-8666-666666666666',
    courseId: COURSE.courseId,
    title: 'Submit design review',
    size: 'small',
    deadline: { kind: 'tba' },
    occurrenceId: {
        taskSeriesId: '66666666-6666-4666-8666-666666666666',
        originalLogicalAnchor: 'once',
    },
    status: 'pending',
    reportedProgress: null,
    displayProgress: null,
    overrideKind: 'none',
    entityVersion: '1',
} as const;
const TASK_SERIES_ID = '77777777-7777-4777-8777-777777777777';
const TASK_WINDOW = {
    startDate: '2026-09-01',
    endDate: '2026-09-30',
} as const;

test('FLOW-00: setup draft requests keep opaque JSON bounded and versioned', () => {
    const saved = makeSaveSetupDraftCheckpointRequest(
        REQUEST_ID,
        APP_BUILD_ID,
        WORKSPACE_EPOCH,
        {
            expectedVersion: '0',
            schemaVersion: 1,
            opaquePayload: JSON.stringify({ schemaVersion: 1, step: 'term', termDraft: { name: 'Fall' } }),
        },
    );
    assert.equal(isWorkspaceSetupRequest(saved, APP_BUILD_ID, WORKSPACE_EPOCH), true);
    assert.equal(
        isWorkspaceSetupRequest(
            makeDiscardSetupDraftCheckpointRequest(
                'discard',
                APP_BUILD_ID,
                WORKSPACE_EPOCH,
                '1',
            ),
            APP_BUILD_ID,
            WORKSPACE_EPOCH,
        ),
        true,
    );
    assert.throws(() => makeSaveSetupDraftCheckpointRequest(
        'invalid-json',
        APP_BUILD_ID,
        WORKSPACE_EPOCH,
        { expectedVersion: '0', schemaVersion: 1, opaquePayload: '{' },
    ), TypeError);
    assert.throws(() => makeSaveSetupDraftCheckpointRequest(
        'too-large',
        APP_BUILD_ID,
        WORKSPACE_EPOCH,
        { expectedVersion: '0', schemaVersion: 1, opaquePayload: JSON.stringify('x'.repeat(
            MAX_SETUP_DRAFT_PAYLOAD_BYTES,
        )) },
    ), TypeError);
});

const TASK_SERIES_DETAIL = {
    workspaceRevision: '2',
    planEntityVersion: '2',
    requestedWindow: TASK_WINDOW,
    termZone: 'America/Toronto',
    taskSeriesId: TASK_SERIES_ID,
    courseId: COURSE.courseId,
    title: 'Submit weekly design review',
    size: 'small',
    schedule: {
        kind: 'weekly',
        startDate: '2026-09-05',
        weekday: 'SAT',
        localDeadlineTime: '23:59',
        confirmedEndDate: '2026-11-28',
        followTeachingWeek: true,
    },
    entityVersion: '1',
    segments: [{
        segmentId: '88888888-8888-4888-8888-888888888888',
        logicalStartAnchor: '2026-09-05',
        logicalEndAnchor: '2026-11-28',
        replacement: {
            title: 'Submit weekly design review',
            size: 'small',
            weekday: 'SAT',
            localDeadlineTime: '23:59',
            followTeachingWeek: true,
        },
    }],
    overrides: [],
    historicalStates: [],
    occurrences: [{
        occurrenceId: {
            taskSeriesId: TASK_SERIES_ID,
            originalLogicalAnchor: '2026-09-05',
        },
        title: 'Submit weekly design review',
        size: 'small',
        deadline: {
            kind: 'timed',
            instant: '2026-09-06T03:59:00.000Z',
            timeZone: 'America/Toronto',
        },
        segmentId: '88888888-8888-4888-8888-888888888888',
        status: 'pending',
        reportedProgress: null,
        displayProgress: null,
        overrideKind: 'none',
    }],
} as const;

const PLAN_PROJECTION = buildPlanProjection({
    workspaceRevision: '2',
    planEntityVersion: '2',
    term: TERM,
    taskSources: [{
        courseId: COURSE.courseId,
        courseCode: COURSE.code,
        occurrence: {
            occurrenceId: {
                taskSeriesId: TASK_SERIES_ID,
                originalLogicalAnchor: 'once',
            },
            title: 'Submit design review',
            size: 'small',
            deadline: { kind: 'date-only', date: '2026-09-07' },
            segmentId: '88888888-8888-4888-8888-888888888888',
            status: 'pending',
            reportedProgress: null,
            displayProgress: null,
            overrideKind: 'none',
        },
    }],
    meetingSources: [{
        courseId: COURSE.courseId,
        courseCode: COURSE.code,
        occurrence: {
            occurrenceId: {
                meetingSeriesId: COURSE.meetings[0].meetingSeriesId,
                originalLogicalAnchor: '2026-09-07',
            },
            segmentId: '99999999-9999-4999-8999-999999999999',
            date: '2026-09-07',
            status: 'scheduled',
            overrideKind: null,
            type: 'LEC',
            weekday: 'MON',
            localStart: '09:00',
            localEnd: '10:00',
            endDayOffset: 0,
            startInstant: '2026-09-07T13:00:00.000Z',
            endInstant: '2026-09-07T14:00:00.000Z',
            location: { kind: 'tba' },
        },
    }],
    holidayRanges: [],
}, createPlanEvaluationContext('2026-09-07T13:30:00.000Z', TERM.timeZone));

function outcomeWithCourse(course: unknown): unknown {
    return {
        ok: true,
        value: {
            kind: 'workspace.setup-projection',
            protocolVersion: 3,
            appBuildId: APP_BUILD_ID,
            requestId: REQUEST_ID,
            workspaceEpoch: WORKSPACE_EPOCH,
            dataMode: 'ready',
            projection: {
                workspaceRevision: '2',
                planEntityVersion: '2',
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
                courses: [course],
                holidayRanges: [HOLIDAY_RANGE],
                tasks: [TASK],
            },
        },
    };
}

function accepts(course: unknown): boolean {
    return isWorkspaceSetupOutcome(
        outcomeWithCourse(course),
        APP_BUILD_ID,
        REQUEST_ID,
        WORKSPACE_EPOCH,
    );
}

test('A-COURSE-007: Workspace projection accepts exact inherited owner boundaries', () => {
    assert.equal(accepts(COURSE), true);
});

test('FLOW-00: a current Course Task satisfies setup minimum without a MeetingSeries', () => {
    assert.equal(accepts({ ...COURSE, meetings: [] }), true);
});

test('A-TERM-004: Workspace projection validates active HolidayRange ownership and bounds', () => {
    assert.equal(accepts(COURSE), true);
    const base = outcomeWithCourse(COURSE) as {
        value: { projection: { holidayRanges: unknown[] } };
    };
    for (const holidayRange of [
        { ...HOLIDAY_RANGE, termId: '66666666-6666-4666-8666-666666666666' },
        { ...HOLIDAY_RANGE, startDate: '2026-08-31' },
        { ...HOLIDAY_RANGE, endDate: '2026-12-21' },
        { ...HOLIDAY_RANGE, tombstoned: false },
    ]) {
        assert.equal(isWorkspaceSetupOutcome({
            ...base,
            value: {
                ...base.value,
                projection: { ...base.value.projection, holidayRanges: [holidayRange] },
            },
        }, APP_BUILD_ID, REQUEST_ID, WORKSPACE_EPOCH), false);
    }
});

test('A-COURSE-007: Workspace projection rejects dangling and out-of-owner ranges', () => {
    const invalidCourses = [
        { ...COURSE, termId: '55555555-5555-4555-8555-555555555555' },
        {
            ...COURSE,
            teachingRange: { ...COURSE.teachingRange, startDate: '2026-09-02' },
        },
        {
            ...COURSE,
            teachingRange: {
                kind: 'explicit',
                startDate: '2026-08-31',
                endDate: TERM.endDate,
            },
        },
        {
            ...COURSE,
            meetings: [{
                ...COURSE.meetings[0],
                effectiveRange: {
                    kind: 'inherit-course',
                    startDate: '2026-09-02',
                    endDate: TERM.endDate,
                },
            }],
        },
        {
            ...COURSE,
            meetings: [{
                ...COURSE.meetings[0],
                effectiveRange: {
                    kind: 'explicit',
                    startDate: TERM.startDate,
                    endDate: '2026-12-21',
                },
            }],
        },
    ];

    for (const course of invalidCourses) {
        assert.equal(accepts(course), false);
    }
});

test('A-TASK-001/TEST-PLAN-001: Workspace projection rejects dangling Task ownership', () => {
    const base = outcomeWithCourse(COURSE) as {
        value: { projection: { tasks: unknown[] } };
    };
    for (const task of [
        { ...TASK, courseId: '77777777-7777-4777-8777-777777777777' },
        {
            ...TASK,
            occurrenceId: { ...TASK.occurrenceId, taskSeriesId: COURSE.courseId },
        },
        { ...TASK, deadline: { kind: 'tba', date: '2026-10-12' } },
    ]) {
        assert.equal(isWorkspaceSetupOutcome({
            ...base,
            value: {
                ...base.value,
                projection: { ...base.value.projection, tasks: [task] },
            },
        }, APP_BUILD_ID, REQUEST_ID, WORKSPACE_EPOCH), false);
    }
});

test('A-TASK-004/TEST-PLAN-003: bounded Task series query validates its request and projection', () => {
    const request = makeTaskSeriesQueryRequest(
        REQUEST_ID,
        APP_BUILD_ID,
        WORKSPACE_EPOCH,
        TASK_SERIES_ID,
        TASK_WINDOW,
    );
    assert.deepEqual(request, {
        kind: 'workspace.task-series.query',
        protocolVersion: 3,
        appBuildId: APP_BUILD_ID,
        requestId: REQUEST_ID,
        workspaceEpoch: WORKSPACE_EPOCH,
        taskSeriesId: TASK_SERIES_ID,
        requestedWindow: TASK_WINDOW,
    });
    assert.equal(isWorkspaceSetupRequest(request, APP_BUILD_ID, WORKSPACE_EPOCH), true);

    const outcome = {
        ok: true,
        value: {
            kind: 'workspace.task-series-projection',
            protocolVersion: 3,
            appBuildId: APP_BUILD_ID,
            requestId: REQUEST_ID,
            workspaceEpoch: WORKSPACE_EPOCH,
            dataMode: 'ready',
            projection: TASK_SERIES_DETAIL,
        },
    } as const;
    assert.equal(isWorkspaceSetupOutcome(outcome, APP_BUILD_ID, REQUEST_ID, WORKSPACE_EPOCH), true);
    assert.equal(isWorkspaceSetupOutcome({
        ...outcome,
        value: {
            ...outcome.value,
            projection: {
                ...TASK_SERIES_DETAIL,
                taskSeriesId: COURSE.courseId,
            },
        },
    }, APP_BUILD_ID, REQUEST_ID, WORKSPACE_EPOCH), false);
});

test('A-VIEW-001–006/TEST-WORKSPACE-001: unified PLAN query validates its exact envelope', () => {
    const request = makePlanQueryRequest(REQUEST_ID, APP_BUILD_ID, WORKSPACE_EPOCH);
    assert.deepEqual(request, {
        kind: 'workspace.plan.query',
        protocolVersion: 3,
        appBuildId: APP_BUILD_ID,
        requestId: REQUEST_ID,
        workspaceEpoch: WORKSPACE_EPOCH,
    });
    assert.equal(isWorkspaceSetupRequest(request, APP_BUILD_ID, WORKSPACE_EPOCH), true);

    // The Calendar may name one explicit week; nothing else about the envelope moves.
    const windowed = makePlanQueryRequest(REQUEST_ID, APP_BUILD_ID, WORKSPACE_EPOCH, {
        startDate: '2026-09-14',
        endDate: '2026-09-20',
    });
    assert.deepEqual(windowed, {
        kind: 'workspace.plan.query',
        protocolVersion: 3,
        appBuildId: APP_BUILD_ID,
        requestId: REQUEST_ID,
        workspaceEpoch: WORKSPACE_EPOCH,
        requestedWindow: { startDate: '2026-09-14', endDate: '2026-09-20' },
    });
    assert.equal(isWorkspaceSetupRequest(windowed, APP_BUILD_ID, WORKSPACE_EPOCH), true);
    assert.equal(isWorkspaceSetupRequest(
        { ...request, requestedWindow: { startDate: '2026-09-20', endDate: '2026-09-14' } },
        APP_BUILD_ID,
        WORKSPACE_EPOCH,
    ), false);
    assert.equal(isWorkspaceSetupRequest(
        { ...request, requestedWindow: TASK_WINDOW, extra: 1 },
        APP_BUILD_ID,
        WORKSPACE_EPOCH,
    ), false);
    assert.throws(() => makePlanQueryRequest(REQUEST_ID, APP_BUILD_ID, WORKSPACE_EPOCH, {
        startDate: '2026-09-20',
        endDate: '2026-09-14',
    }), TypeError);

    const outcome = {
        ok: true,
        value: {
            kind: 'workspace.plan-projection',
            protocolVersion: 3,
            appBuildId: APP_BUILD_ID,
            requestId: REQUEST_ID,
            workspaceEpoch: WORKSPACE_EPOCH,
            dataMode: 'ready',
            projection: PLAN_PROJECTION,
        },
    } as const;
    assert.equal(isWorkspaceSetupOutcome(outcome, APP_BUILD_ID, REQUEST_ID, WORKSPACE_EPOCH), true);
    assert.equal(isWorkspaceSetupOutcome({
        ...outcome,
        value: {
            ...outcome.value,
            projection: {
                ...PLAN_PROJECTION,
                evaluationContext: {
                    ...PLAN_PROJECTION.evaluationContext,
                    applicableDate: '2026-09-08',
                },
            },
        },
    }, APP_BUILD_ID, REQUEST_ID, WORKSPACE_EPOCH), false);
});

test('A-TASK-006: Workspace accepts a future Task change only with its preview binding', () => {
    const request = makeChangeTaskOccurrenceRequest(
        REQUEST_ID,
        APP_BUILD_ID,
        WORKSPACE_EPOCH,
        {
            commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            followUpId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            confirmationToken: '1'.repeat(64),
            impactWindow: { startDate: '2026-09-05', endDate: '2026-12-05' },
            expectedRevision: '2',
            expectedPlanVersion: '2',
            expectedTaskSeriesVersion: '1',
            intent: {
                kind: 'plan.change-task-occurrence',
                intentSchemaVersion: 1,
                payload: {
                    taskSeriesId: TASK_SERIES_ID,
                    originalLogicalAnchor: '2026-09-05',
                    scope: 'this-and-future',
                    replacement: {
                        title: 'Updated weekly review',
                        size: 'small',
                        weekday: 'SAT',
                        localDeadlineTime: '22:00',
                        followTeachingWeek: true,
                    },
                },
            },
        },
    );

    assert.equal(isWorkspaceSetupRequest(request, APP_BUILD_ID, WORKSPACE_EPOCH), true);
    assert.equal(isWorkspaceSetupRequest({ ...request, command: {
        ...request.command,
        confirmationToken: null,
    } }, APP_BUILD_ID, WORKSPACE_EPOCH), false);
});

test('A-TASK-008/TEST-WORKSPACE-002: committed state receipts carry one exact Undo capability', () => {
    const outcome = {
        ok: true,
        value: {
            kind: 'workspace.command-outcome',
            protocolVersion: 3,
            appBuildId: APP_BUILD_ID,
            requestId: REQUEST_ID,
            workspaceEpoch: WORKSPACE_EPOCH,
            outcome: {
                kind: 'committed',
                revision: '3',
                effects: [{
                    code: 'plan.task-occurrence-status-set',
                    entity: { kind: 'task-series', id: TASK_SERIES_ID, version: '2' },
                }],
                pendingFollowUps: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
                undoCapability: {
                    token: '1'.repeat(64),
                    taskSeriesId: TASK_SERIES_ID,
                    originalLogicalAnchor: '2026-09-05',
                    committedRevision: '3',
                    validThroughTaskSeriesVersion: '2',
                },
            },
        },
    } as const;

    assert.equal(isWorkspaceSetupOutcome(outcome, APP_BUILD_ID, REQUEST_ID, WORKSPACE_EPOCH), true);
    assert.equal(isWorkspaceSetupOutcome({
        ...outcome,
        value: {
            ...outcome.value,
            outcome: {
                ...outcome.value.outcome,
                undoCapability: { ...outcome.value.outcome.undoCapability, token: 'expired' },
            },
        },
    }, APP_BUILD_ID, REQUEST_ID, WORKSPACE_EPOCH), false);

    for (const undoCapability of [
        { ...outcome.value.outcome.undoCapability, committedRevision: '2' },
        {
            ...outcome.value.outcome.undoCapability,
            taskSeriesId: COURSE.courseId,
        },
        {
            ...outcome.value.outcome.undoCapability,
            validThroughTaskSeriesVersion: '3',
        },
    ]) {
        assert.equal(isWorkspaceSetupOutcome({
            ...outcome,
            value: {
                ...outcome.value,
                outcome: { ...outcome.value.outcome, undoCapability },
            },
        }, APP_BUILD_ID, REQUEST_ID, WORKSPACE_EPOCH), false);
    }

    for (const code of [
        'plan.task-series-updated',
        'plan.task-occurrence-changed',
        'plan.task-occurrence-deleted',
        'plan.task-occurrence-state-undone',
    ] as const) {
        assert.equal(isWorkspaceSetupOutcome({
            ...outcome,
            value: {
                ...outcome.value,
                outcome: {
                    ...outcome.value.outcome,
                    effects: [{ ...outcome.value.outcome.effects[0], code }],
                },
            },
        }, APP_BUILD_ID, REQUEST_ID, WORKSPACE_EPOCH), false);
    }

    assert.equal(isWorkspaceSetupOutcome({
        ...outcome,
        value: {
            ...outcome.value,
            outcome: {
                ...outcome.value.outcome,
                effects: [{
                    ...outcome.value.outcome.effects[0],
                    code: 'plan.task-progress-set',
                }],
            },
        },
    }, APP_BUILD_ID, REQUEST_ID, WORKSPACE_EPOCH), true);
});

test('TEST-DATA-005: Workspace boundary preserves writer-busy retry semantics', () => {
    assert.equal(isWorkspaceSetupOutcome({
        ok: false,
        problem: {
            code: 'operation-in-progress',
            message: '另一个写入正在完成；请重试。',
            requestId: REQUEST_ID,
            appBuildId: APP_BUILD_ID,
            workspaceEpoch: WORKSPACE_EPOCH,
            dataEffect: 'unchanged',
            details: { reason: 'writer-busy' },
        },
    }, APP_BUILD_ID, REQUEST_ID, WORKSPACE_EPOCH), true);
});

test('TEST-DATA-002/006: Workspace boundary retains schema-1 Course receipt replay DTOs', () => {
    const request = makeCreateCourseWithMeetingRequest(
        REQUEST_ID,
        APP_BUILD_ID,
        WORKSPACE_EPOCH,
        {
            commandId: '66666666-6666-4666-8666-666666666666',
            followUpId: '77777777-7777-4777-8777-777777777777',
            expectedRevision: '2',
            expectedPlanVersion: '1',
            intent: {
                kind: 'plan.create-course-with-first-meeting',
                intentSchemaVersion: 1,
                payload: {
                    course: {
                        code: COURSE.code,
                        name: COURSE.name,
                        section: 'L0101',
                        instructor: 'Ada Lovelace',
                        color: 'blue',
                        credits: '0.5',
                    },
                    meeting: {
                        type: 'LEC',
                        weekday: 'MON',
                        localStart: '09:00',
                        localEnd: '10:00',
                        effectiveStartDate: '2026-09-08',
                        effectiveEndDate: '2026-12-18',
                        location: { kind: 'known', value: 'BA 1130' },
                    },
                },
            },
        },
    );
    assert.equal(isWorkspaceSetupRequest(request, APP_BUILD_ID, WORKSPACE_EPOCH), true);
});

test('TEST-WORKSPACE-007: build and migration requests use the existing bounded Workspace channel', () => {
    const buildRequest = makeApplicationBuildStatusRequest(
        REQUEST_ID,
        APP_BUILD_ID,
        WORKSPACE_EPOCH,
    );
    const safetyRequest = makeMigrationSafetyCopyQueryRequest(
        REQUEST_ID,
        APP_BUILD_ID,
        WORKSPACE_EPOCH,
    );

    assert.equal(isWorkspaceSetupRequest(buildRequest, APP_BUILD_ID, WORKSPACE_EPOCH), true);
    assert.equal(isWorkspaceProcessRequest(buildRequest, APP_BUILD_ID, WORKSPACE_EPOCH), true);
    assert.equal(isWorkspaceSetupRequest(safetyRequest, APP_BUILD_ID, WORKSPACE_EPOCH), true);
    assert.equal(isWorkspaceSetupOutcome({
        ok: true,
        value: {
            kind: 'workspace.migration-safety-copy',
            protocolVersion: 3,
            appBuildId: APP_BUILD_ID,
            requestId: REQUEST_ID,
            workspaceEpoch: WORKSPACE_EPOCH,
            safetyCopy: {kind: 'absent'},
        },
    }, APP_BUILD_ID, REQUEST_ID, WORKSPACE_EPOCH), true);
});
