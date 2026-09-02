/**
 * @file Verifies Renderer projection availability, setup minimum, and default-route semantics.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ALL_TASKS_FILTER,
    evaluateSetupMinimum,
    initialWorkspaceSurfaceFrom,
    planProjectionStateFrom,
    resolveTaskListFilter,
    sameTaskListFilter,
    setupProjectionStateFrom,
    taskListFilterAccepts,
} from '../../src/renderer/workspace-view-state';
import type { MeetingSeriesProjection } from '../../src/shared/workspace-course-contract';
import {
    buildPlanProjection,
    createPlanEvaluationContext,
    type PlanProjection,
} from '../../src/shared/workspace-plan-contract';
import type { WorkspaceSetupOutcome } from '../../src/shared/workspace-setup-contract';
import type { TaskOccurrenceProjection, TaskProjection } from '../../src/shared/workspace-task-contract';
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

/**
 * Builds one pending Task occurrence for the filter tests.
 *
 * @param {string} taskSeriesId Stable Task-series identity.
 * @param {TaskOccurrenceProjection['size']} size Task size.
 * @return {TaskOccurrenceProjection} Pending date-only occurrence.
 */
function pendingOccurrence(
    taskSeriesId: string,
    size: TaskOccurrenceProjection['size'],
): TaskOccurrenceProjection {
    return {
        occurrenceId: { taskSeriesId, originalLogicalAnchor: 'once' },
        title: `${size} task`,
        size,
        deadline: { kind: 'date-only', date: '2026-09-12' },
        segmentId: '77777777-7777-4777-8777-777777777777',
        status: 'pending',
        reportedProgress: null,
        displayProgress: null,
        overrideKind: 'none',
    };
}

test('UI-TASK-01 the Task list filter is Renderer view state that only decides which rows show', () => {
    const setup = setupProjection();
    const otherCourseId = '55555555-5555-4555-8555-555555555555';
    const plan = buildPlanProjection({
        workspaceRevision: setup.workspaceRevision,
        planEntityVersion: setup.planEntityVersion,
        term: setup.currentTerm!,
        taskSources: [
            {
                courseId: CURRENT_COURSE_ID,
                courseCode: 'CSC301',
                occurrence: pendingOccurrence('11111111-aaaa-4aaa-8aaa-111111111111', 'small'),
            },
            {
                courseId: otherCourseId,
                courseCode: 'MAT137',
                occurrence: pendingOccurrence('22222222-aaaa-4aaa-8aaa-222222222222', 'large'),
            },
        ],
        meetingSources: [],
        holidayRanges: [],
    }, createPlanEvaluationContext('2026-09-10T14:00:00.000Z', 'America/Toronto'));
    const [small, large] = plan.tasks;
    assert.equal(small!.occurrence.size, 'small');
    assert.equal(large!.occurrence.size, 'large');

    // 全部 shows every row; a size or Course filter hides the rows that do not match.
    assert.equal(taskListFilterAccepts(ALL_TASKS_FILTER, small!), true);
    assert.equal(taskListFilterAccepts(ALL_TASKS_FILTER, large!), true);
    assert.equal(taskListFilterAccepts({ kind: 'size', size: 'small' }, small!), true);
    assert.equal(taskListFilterAccepts({ kind: 'size', size: 'small' }, large!), false);
    assert.equal(taskListFilterAccepts({ kind: 'course', courseId: CURRENT_COURSE_ID }, small!), true);
    assert.equal(taskListFilterAccepts({ kind: 'course', courseId: CURRENT_COURSE_ID }, large!), false);

    // Filters compare by value, so a re-created chip option still reads as checked.
    assert.equal(sameTaskListFilter({ kind: 'size', size: 'large' }, { kind: 'size', size: 'large' }), true);
    assert.equal(sameTaskListFilter({ kind: 'size', size: 'large' }, { kind: 'size', size: 'small' }), false);
    assert.equal(sameTaskListFilter({ kind: 'course', courseId: 'x' }, { kind: 'course', courseId: 'y' }), false);
    assert.equal(sameTaskListFilter(ALL_TASKS_FILTER, { kind: 'all' }), true);
    assert.equal(sameTaskListFilter(ALL_TASKS_FILTER, { kind: 'size', size: 'small' }), false);

    // A Course the page no longer offers cannot stay selected; a size filter is untouched.
    assert.deepEqual(
        resolveTaskListFilter({ kind: 'course', courseId: 'gone' }, [CURRENT_COURSE_ID]),
        ALL_TASKS_FILTER,
    );
    assert.deepEqual(
        resolveTaskListFilter({ kind: 'course', courseId: CURRENT_COURSE_ID }, [CURRENT_COURSE_ID]),
        { kind: 'course', courseId: CURRENT_COURSE_ID },
    );
    assert.deepEqual(resolveTaskListFilter({ kind: 'size', size: 'large' }, []), { kind: 'size', size: 'large' });
});
