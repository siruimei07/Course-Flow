/**
 * @file Verifies Renderer projection availability, setup minimum, and default-route semantics.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    evaluateSetupMinimum,
    initialWorkspaceSurfaceFrom,
    planProjectionStateFrom,
    setupProjectionStateFrom,
} from '../../src/renderer/workspace-view-state';
import type { MeetingSeriesProjection } from '../../src/shared/workspace-course-contract';
import {
    buildPlanProjection,
    createPlanEvaluationContext,
    type PlanProjection,
} from '../../src/shared/workspace-plan-contract';
import type { WorkspaceSetupOutcome } from '../../src/shared/workspace-setup-contract';
import type { TaskProjection } from '../../src/shared/workspace-task-contract';
import type { SetupProjection } from '../../src/shared/workspace-term-contract';

/**
 * Stable current-Term fixture identity.
 *
 * @const
 * @type {string}
 */
const CURRENT_TERM_ID = '11111111-1111-4111-8111-111111111111';

/**
 * Stable current-Course fixture identity.
 *
 * @const
 * @type {string}
 */
const CURRENT_COURSE_ID = '22222222-2222-4222-8222-222222222222';

/**
 * One formal Meeting fact used by minimum-condition tests.
 *
 * @const
 * @type {MeetingSeriesProjection}
 */
const MEETING = {
    meetingSeriesId: '33333333-3333-4333-8333-333333333333',
    type: { code: 'LEC', name: 'Lecture' },
    weekday: 'MON',
    localStart: '09:00',
    localEnd: '10:00',
    endDayOffset: 0,
    effectiveRange: {
        kind: 'inherit-course',
        startDate: '2026-09-01',
        endDate: '2026-12-20',
    },
    location: { kind: 'known', value: 'BA 1130' },
    entityVersion: '1',
} as const satisfies MeetingSeriesProjection;

/**
 * One formal Task fact used by minimum-condition tests.
 *
 * @const
 * @type {TaskProjection}
 */
const TASK = {
    taskSeriesId: '44444444-4444-4444-8444-444444444444',
    courseId: CURRENT_COURSE_ID,
    title: 'Read Chapter 1',
    size: 'small',
    entityVersion: '1',
    deadline: { kind: 'date-only', date: '2026-09-10' },
    occurrenceId: {
        taskSeriesId: '44444444-4444-4444-8444-444444444444',
        originalLogicalAnchor: 'once',
    },
    status: 'pending',
    reportedProgress: null,
    displayProgress: null,
    overrideKind: 'none',
} as const satisfies TaskProjection;

/**
 * Task belonging to a different Course and therefore outside the setup minimum.
 *
 * @const
 * @type {TaskProjection}
 */
const UNRELATED_TASK = {
    ...TASK,
    courseId: '55555555-5555-4555-8555-555555555555',
} as const satisfies TaskProjection;

/**
 * Builds a current-Term Setup projection with caller-selected formal facts.
 *
 * @param {object} options Fixture fact selection.
 * @param {readonly MeetingSeriesProjection[]} options.meetings Current-Course Meeting facts.
 * @param {readonly TaskProjection[]} options.tasks Workspace Task facts.
 * @return {SetupProjection} Setup projection at one revision.
 */
function setupProjection(options: Readonly<{
    meetings?: readonly MeetingSeriesProjection[];
    tasks?: readonly TaskProjection[];
}> = {}): SetupProjection {
    const term = {
        termId: CURRENT_TERM_ID,
        name: 'Fall 2026',
        startDate: '2026-09-01',
        endDate: '2026-12-20',
        timeZone: 'America/Toronto',
        archived: false,
        entityVersion: '1',
    } as const;
    const hasMeetingOrTask = (options.meetings?.length ?? 0) > 0
        || (options.tasks?.some(task => task.courseId === CURRENT_COURSE_ID) ?? false);
    return {
        workspaceRevision: '1',
        planEntityVersion: '1',
        minimum: {
            hasCurrentTerm: true,
            hasCurrentTermCourse: true,
            hasMeetingOrTask,
            isSatisfied: hasMeetingOrTask,
        },
        everReachedMinimum: hasMeetingOrTask,
        defaultRoute: hasMeetingOrTask ? 'today' : 'setup',
        draftCheckpointVersion: '0',
        draftCheckpoint: null,
        currentTerm: term,
        terms: [term],
        courses: [{
            courseId: CURRENT_COURSE_ID,
            termId: CURRENT_TERM_ID,
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
            meetings: options.meetings ?? [],
        }],
        holidayRanges: [],
        tasks: options.tasks ?? [],
    };
}

/**
 * Wraps one Setup projection in the already-validated Workspace outcome union.
 *
 * @param {SetupProjection} projection Formal Setup projection.
 * @return {WorkspaceSetupOutcome} Successful Setup query outcome.
 */
function setupOutcome(projection: SetupProjection): WorkspaceSetupOutcome {
    return {
        ok: true,
        value: {
            kind: 'workspace.setup-projection',
            protocolVersion: 3,
            appBuildId: 'development:1234567890abcdef1234567890abcdef12345678',
            requestId: 'renderer-state-request',
            workspaceEpoch: '66666666-6666-4666-8666-666666666666',
            dataMode: 'ready',
            projection,
        },
    };
}

/**
 * Creates a failed Workspace query outcome with a user-visible message.
 *
 * @return {WorkspaceSetupOutcome} Unavailable Workspace outcome.
 */
function unavailableOutcome(): WorkspaceSetupOutcome {
    return {
        ok: false,
        problem: {
            code: 'workspace-unavailable',
            message: '工作区暂时不可用。',
            requestId: 'renderer-state-request',
            appBuildId: 'development:1234567890abcdef1234567890abcdef12345678',
            workspaceEpoch: '66666666-6666-4666-8666-666666666666',
            dataEffect: 'unchanged',
        },
    };
}

/**
 * Wraps one PLAN projection in the validated Workspace outcome union.
 *
 * @param {PlanProjection} projection Formal unified PLAN projection.
 * @return {WorkspaceSetupOutcome} Successful PLAN query outcome.
 */
function planOutcome(projection: PlanProjection): WorkspaceSetupOutcome {
    return {
        ok: true,
        value: {
            kind: 'workspace.plan-projection',
            protocolVersion: 3,
            appBuildId: 'development:1234567890abcdef1234567890abcdef12345678',
            requestId: 'renderer-state-request',
            workspaceEpoch: '66666666-6666-4666-8666-666666666666',
            dataMode: 'ready',
            projection,
        },
    };
}

test('TEST-USABILITY-001 reaches minimum with a current Term, Course, and Meeting', () => {
    assert.deepEqual(evaluateSetupMinimum(setupProjection({ meetings: [MEETING] })), {
        hasCurrentTerm: true,
        hasCurrentCourse: true,
        hasMeetingOrTask: true,
        meetsMinimum: true,
    });
});

test('TEST-USABILITY-001 accepts a Task as the Meeting alternative', () => {
    assert.deepEqual(evaluateSetupMinimum(setupProjection({ tasks: [TASK] })), {
        hasCurrentTerm: true,
        hasCurrentCourse: true,
        hasMeetingOrTask: true,
        meetsMinimum: true,
    });
});

test('TEST-USABILITY-001 excludes Task facts outside the current Term Course set', () => {
    assert.deepEqual(evaluateSetupMinimum(setupProjection({ tasks: [UNRELATED_TASK] })), {
        hasCurrentTerm: true,
        hasCurrentCourse: true,
        hasMeetingOrTask: false,
        meetsMinimum: false,
    });
});

test('UI-EMPTY-STATE keeps an available empty Setup projection distinct from failure', () => {
    const emptyProjection = {
        ...setupProjection(),
        minimum: {
            hasCurrentTerm: false,
            hasCurrentTermCourse: false,
            hasMeetingOrTask: false,
            isSatisfied: false,
        },
        everReachedMinimum: false,
        defaultRoute: 'setup',
        currentTerm: null,
        terms: [],
        courses: [],
    } as const satisfies SetupProjection;

    assert.deepEqual(setupProjectionStateFrom(setupOutcome(emptyProjection)), {
        kind: 'available',
        dataMode: 'ready',
        projection: emptyProjection,
    });
    assert.deepEqual(setupProjectionStateFrom(unavailableOutcome()), {
        kind: 'unavailable',
        message: '工作区暂时不可用。',
    });
});

test('A-VIEW-001 keeps an available empty PLAN projection distinct from the wrong response kind', () => {
    const setup = setupProjection();
    const projection = buildPlanProjection({
        workspaceRevision: setup.workspaceRevision,
        planEntityVersion: setup.planEntityVersion,
        term: setup.currentTerm!,
        taskSources: [],
        meetingSources: [],
        holidayRanges: [],
    }, createPlanEvaluationContext(
        '2026-09-10T14:00:00.000Z',
        'America/Toronto',
    ));

    assert.deepEqual(planProjectionStateFrom(planOutcome(projection)), {
        kind: 'available',
        dataMode: 'ready',
        projection,
    });
    assert.deepEqual(planProjectionStateFrom(setupOutcome(setup)), {
        kind: 'unavailable',
        message: 'Workspace 返回了意外的计划投影。',
    });
});

test('FLOW-00 uses the Workspace-owned default route instead of recomputing it from current facts', () => {
    const previouslyCompleted = {
        ...setupProjection(),
        minimum: {
            hasCurrentTerm: false,
            hasCurrentTermCourse: false,
            hasMeetingOrTask: false,
            isSatisfied: false,
        },
        everReachedMinimum: true,
        defaultRoute: 'today',
        currentTerm: null,
        courses: [],
        tasks: [],
    } as const satisfies SetupProjection;
    const neverCompleted = {
        ...previouslyCompleted,
        everReachedMinimum: false,
        defaultRoute: 'setup',
    } as const satisfies SetupProjection;

    assert.equal(initialWorkspaceSurfaceFrom(previouslyCompleted), 'today');
    assert.equal(initialWorkspaceSurfaceFrom(neverCompleted), 'setup');
});
