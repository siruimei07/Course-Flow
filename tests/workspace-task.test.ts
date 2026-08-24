/**
 * @file Verifies the one-time Task lifecycle through the single Workspace boundary.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { WorkspaceApplication } from '../src/workspace-application';
import { makeBootstrapRequest } from '../src/shared/bootstrap-contract';
import {
    makeCompleteTaskRequest,
    makeCreateCourseWithMeetingRequest,
    makeCreateTaskRequest,
    makeCreateTermRequest,
    makeDeleteTaskRequest,
    makeInitializeWorkspaceRequest,
    makeSetupQueryRequest,
    makeTaskSeriesQueryRequest,
    makeUpdateTaskRequest,
} from '../src/shared/workspace-setup-contract';

const APP_BUILD_ID = 'task-test-build';

/**
 * Allocates one isolated DATA root and registers deterministic cleanup.
 * @param {test.TestContext} t - Owning Node test context.
 * @return {string} Temporary DATA slots root.
 */
function createTempDataSlots(t: test.TestContext): string {
    const dataSlotsRoot = mkdtempSync(join(tmpdir(), 'courseflow-workspace-task-'));
    t.after(() => rmSync(dataSlotsRoot, { recursive: true, force: true }));
    return dataSlotsRoot;
}

/**
 * Opens the Workspace bootstrap seam and returns its correlated ready value.
 * @param {WorkspaceApplication} application - Workspace application under test.
 * @return {Promise<object>} Ready bootstrap value with the active Workspace epoch.
 */
async function bootstrap(application: WorkspaceApplication) {
    const outcome = await application.handle({
        ...makeBootstrapRequest('bootstrap', APP_BUILD_ID),
        dataRootClass: 'verified-local' as const,
    });
    assert.equal(outcome.ok, true);
    if (!outcome.ok || !('workspaceEpoch' in outcome.value)) {
        throw new Error('Expected Workspace bootstrap');
    }
    return outcome.value;
}

/**
 * Builds the canonical Term command fixture at the requested optimistic versions.
 * @param {string} expectedRevision - Expected Workspace revision.
 * @param {string} expectedPlanVersion - Expected PLAN entity version.
 * @return {object} Canonical CreateTerm command fixture.
 */
function termCommand(expectedRevision = '0', expectedPlanVersion = '0') {
    return {
        commandId: '11111111-1111-4111-8111-111111111111',
        followUpId: '22222222-2222-4222-8222-222222222222',
        expectedRevision,
        expectedPlanVersion,
        intent: {
            kind: 'plan.create-term' as const,
            intentSchemaVersion: 1 as const,
            payload: {
                name: 'Fall 2026',
                startDate: '2026-09-01',
                endDate: '2026-12-20',
                timeZone: 'America/Toronto',
            },
        },
    };
}

/**
 * Builds the canonical Course and first Meeting command fixture.
 * @return {object} Canonical Course/Meeting command fixture.
 */
function courseCommand() {
    return {
        commandId: '33333333-3333-4333-8333-333333333333',
        followUpId: '44444444-4444-4444-8444-444444444444',
        overlapDecision: 'review' as const,
        expectedRevision: '1',
        expectedPlanVersion: '1',
        intent: {
            kind: 'plan.create-course-with-first-meeting' as const,
            intentSchemaVersion: 3 as const,
            payload: {
                course: {
                    code: 'CSC301',
                    name: 'Introduction to Software Engineering',
                    section: 'LEC0101',
                    instructor: 'Ada Lovelace',
                    color: 'blue' as const,
                    credits: '3',
                    teachingRange: { kind: 'inherit-term' as const },
                },
                meeting: {
                    type: 'LEC' as const,
                    weekday: 'MON' as const,
                    localStart: '09:00',
                    localEnd: '10:00',
                    endDayOffset: 0 as const,
                    effectiveRange: { kind: 'inherit-course' as const },
                    location: { kind: 'tba' as const },
                },
            },
        },
    };
}

/**
 * Establishes one writable Current Term and Course through Workspace.
 * @param {WorkspaceApplication} application - Workspace application under test.
 * @return {Promise<object>} Active Workspace epoch and stable Course identity.
 */
async function initializePlan(application: WorkspaceApplication) {
    const initial = await bootstrap(application);
    await application.handle(makeInitializeWorkspaceRequest(
        'initialize',
        APP_BUILD_ID,
        initial.workspaceEpoch,
    ));
    const term = await application.handle(makeCreateTermRequest(
        'create-term',
        APP_BUILD_ID,
        initial.workspaceEpoch,
        termCommand(),
    ));
    assert.equal(term.ok, true);
    const course = await application.handle(makeCreateCourseWithMeetingRequest(
        'create-course',
        APP_BUILD_ID,
        initial.workspaceEpoch,
        courseCommand(),
    ));
    assert.equal(course.ok, true);
    if (!course.ok || course.value.kind !== 'workspace.command-outcome') {
        throw new Error('Expected Course creation');
    }
    return {
        epoch: initial.workspaceEpoch,
        courseId: course.value.outcome.effects[0]!.entity.id,
    };
}

test('A-TASK-001–003: one-time Task retains size, Deadline, status, and stable IDs', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    let loseCreateResponse = false;
    const application = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID, {
        commitOptions: {
            failpoint(point) {
                if (loseCreateResponse && point === 'commit.after-sqlite-commit') {
                    loseCreateResponse = false;
                    throw new Error(point);
                }
            },
        },
    });
    const { courseId, epoch } = await initializePlan(application);
    const createCommand = {
        commandId: '55555555-5555-4555-8555-555555555555',
        followUpId: '66666666-6666-4666-8666-666666666666',
        expectedRevision: '2',
        expectedPlanVersion: '2',
        intent: {
            kind: 'plan.create-task-series' as const,
            intentSchemaVersion: 1 as const,
            payload: {
                courseId,
                title: 'Submit design review',
                size: 'small' as const,
                deadline: { kind: 'date-only' as const, date: '2026-10-12' },
            },
        },
    };

    loseCreateResponse = true;
    const created = await application.handle(makeCreateTaskRequest(
        'create-task',
        APP_BUILD_ID,
        epoch,
        createCommand,
    ));
    assert.equal(created.ok, true, JSON.stringify(created));
    if (!created.ok || created.value.kind !== 'workspace.command-outcome') {
        throw new Error('Expected Task creation receipt recovery');
    }
    assert.equal(created.value.outcome.effects[0]?.code, 'plan.task-series-created');
    const taskSeriesId = created.value.outcome.effects[0]!.entity.id;

    const boundedDetail = await application.handle(makeTaskSeriesQueryRequest(
        'query-task-series',
        APP_BUILD_ID,
        epoch,
        taskSeriesId,
        { startDate: '2026-10-01', endDate: '2026-10-31' },
    ));
    assert.equal(boundedDetail.ok, true);
    if (!boundedDetail.ok || boundedDetail.value.kind !== 'workspace.task-series-projection') {
        throw new Error('Expected bounded Task series projection');
    }
    assert.deepEqual(boundedDetail.value.projection, {
        workspaceRevision: '3',
        planEntityVersion: '3',
        requestedWindow: { startDate: '2026-10-01', endDate: '2026-10-31' },
        termZone: 'America/Toronto',
        taskSeriesId,
        courseId,
        title: 'Submit design review',
        size: 'small',
        schedule: { deadline: { kind: 'date-only', date: '2026-10-12' }, kind: 'once' },
        entityVersion: '1',
        occurrences: [{
            occurrenceId: { taskSeriesId, originalLogicalAnchor: 'once' },
            deadline: { kind: 'date-only', date: '2026-10-12' },
            status: 'pending',
        }],
    });

    const replayed = await application.handle(makeCreateTaskRequest(
        'replay-task',
        APP_BUILD_ID,
        epoch,
        createCommand,
    ));
    assert.deepEqual(replayed, {
        ...created,
        value: { ...created.value, requestId: 'replay-task' },
    });
    const reused = await application.handle(makeCreateTaskRequest(
        'reuse-task-command',
        APP_BUILD_ID,
        epoch,
        {
            ...createCommand,
            intent: {
                ...createCommand.intent,
                payload: { ...createCommand.intent.payload, title: 'Changed command semantics' },
            },
        },
    ));
    assert.equal(reused.ok, false);
    if (reused.ok) {
        throw new Error('Expected CommandId reuse conflict');
    }
    assert.equal(reused.problem.code, 'conflict');
    assert.equal(reused.problem.dataEffect, 'unchanged');

    const createdProjection = await application.handle(makeSetupQueryRequest(
        'query-created-task',
        APP_BUILD_ID,
        epoch,
    ));
    assert.equal(createdProjection.ok, true);
    if (!createdProjection.ok || createdProjection.value.kind !== 'workspace.setup-projection') {
        throw new Error('Expected Task projection');
    }
    const initialTask = createdProjection.value.projection.tasks[0]!;
    assert.deepEqual(initialTask, {
        taskSeriesId,
        courseId,
        title: 'Submit design review',
        size: 'small',
        deadline: { kind: 'date-only', date: '2026-10-12' },
        occurrenceId: { taskSeriesId, originalLogicalAnchor: 'once' },
        status: 'pending',
        entityVersion: '1',
    });

    const stale = await application.handle(makeUpdateTaskRequest(
        'update-task-stale',
        APP_BUILD_ID,
        epoch,
        {
            commandId: '13131313-1313-4313-8313-131313131313',
            followUpId: '14141414-1414-4414-8414-141414141414',
            expectedRevision: '3',
            expectedPlanVersion: '3',
            expectedTaskSeriesVersion: '0',
            intent: {
                kind: 'plan.update-task-series',
                intentSchemaVersion: 1,
                payload: {
                    taskSeriesId,
                    courseId,
                    title: 'Stale edit',
                    size: 'large',
                    deadline: { kind: 'tba' },
                },
            },
        },
    ));
    assert.equal(stale.ok, false);
    if (stale.ok) {
        throw new Error('Expected stale Task version conflict');
    }
    assert.equal(stale.problem.code, 'conflict');
    assert.equal(stale.problem.dataEffect, 'unchanged');

    const updated = await application.handle(makeUpdateTaskRequest(
        'update-task',
        APP_BUILD_ID,
        epoch,
        {
            commandId: '77777777-7777-4777-8777-777777777777',
            followUpId: '88888888-8888-4888-8888-888888888888',
            expectedRevision: '3',
            expectedPlanVersion: '3',
            expectedTaskSeriesVersion: '1',
            intent: {
                kind: 'plan.update-task-series',
                intentSchemaVersion: 1,
                payload: {
                    taskSeriesId,
                    courseId,
                    title: 'Submit final design review',
                    size: 'large',
                    deadline: {
                        kind: 'timed',
                        instant: '2026-10-13T03:59:00.000Z',
                        timeZone: 'America/Toronto',
                    },
                },
            },
        },
    ));
    assert.equal(updated.ok, true);

    const completed = await application.handle(makeCompleteTaskRequest(
        'complete-task',
        APP_BUILD_ID,
        epoch,
        {
            commandId: '99999999-9999-4999-8999-999999999999',
            followUpId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            expectedRevision: '4',
            expectedPlanVersion: '4',
            expectedTaskSeriesVersion: '2',
            intent: {
                kind: 'plan.set-task-occurrence-status',
                intentSchemaVersion: 1,
                payload: {
                    taskSeriesId,
                    originalLogicalAnchor: 'once',
                    status: 'completed',
                },
            },
        },
    ));
    assert.equal(completed.ok, true);
    await application.close();

    const restarted = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID);
    const restartedBootstrap = await bootstrap(restarted);
    const restartedProjection = await restarted.handle(makeSetupQueryRequest(
        'query-restarted-task',
        APP_BUILD_ID,
        restartedBootstrap.workspaceEpoch,
    ));
    assert.equal(restartedProjection.ok, true);
    if (!restartedProjection.ok || restartedProjection.value.kind !== 'workspace.setup-projection') {
        throw new Error('Expected restarted Task projection');
    }
    const restartedTask = restartedProjection.value.projection.tasks[0]!;
    assert.equal(restartedTask.taskSeriesId, taskSeriesId);
    assert.deepEqual(restartedTask.occurrenceId, initialTask.occurrenceId);
    assert.equal(restartedTask.status, 'completed');
    assert.equal(restartedTask.size, 'large');
    assert.deepEqual(restartedTask.deadline, {
        kind: 'timed',
        instant: '2026-10-13T03:59:00.000Z',
        timeZone: 'America/Toronto',
    });

    const tba = await restarted.handle(makeUpdateTaskRequest(
        'update-task-tba',
        APP_BUILD_ID,
        restartedBootstrap.workspaceEpoch,
        {
            commandId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            followUpId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            expectedRevision: '5',
            expectedPlanVersion: '5',
            expectedTaskSeriesVersion: '3',
            intent: {
                kind: 'plan.update-task-series',
                intentSchemaVersion: 1,
                payload: {
                    taskSeriesId,
                    courseId,
                    title: 'Submit final design review',
                    size: 'large',
                    deadline: { kind: 'tba' },
                },
            },
        },
    ));
    assert.equal(tba.ok, true);
    const tbaProjection = await restarted.handle(makeSetupQueryRequest(
        'query-task-tba',
        APP_BUILD_ID,
        restartedBootstrap.workspaceEpoch,
    ));
    assert.equal(tbaProjection.ok, true);
    if (!tbaProjection.ok || tbaProjection.value.kind !== 'workspace.setup-projection') {
        throw new Error('Expected TBA Task projection');
    }
    assert.deepEqual(tbaProjection.value.projection.tasks[0]?.deadline, { kind: 'tba' });
    assert.deepEqual(tbaProjection.value.projection.tasks[0]?.occurrenceId, initialTask.occurrenceId);

    const deleted = await restarted.handle(makeDeleteTaskRequest(
        'delete-task',
        APP_BUILD_ID,
        restartedBootstrap.workspaceEpoch,
        {
            commandId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            followUpId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            expectedRevision: '6',
            expectedPlanVersion: '6',
            expectedTaskSeriesVersion: '4',
            intent: {
                kind: 'plan.delete-task-series',
                intentSchemaVersion: 1,
                payload: { taskSeriesId },
            },
        },
    ));
    assert.equal(deleted.ok, true);
    const afterDelete = await restarted.handle(makeSetupQueryRequest(
        'query-deleted-task',
        APP_BUILD_ID,
        restartedBootstrap.workspaceEpoch,
    ));
    assert.equal(afterDelete.ok, true);
    if (!afterDelete.ok || afterDelete.value.kind !== 'workspace.setup-projection') {
        throw new Error('Expected projection after deletion');
    }
    assert.deepEqual(afterDelete.value.projection.tasks, []);
    await restarted.close();
});

test('TEST-PLAN-001/FLOW-01: Task writes reject invalid scope and unavailable DATA unchanged', async (t) => {
    await t.test('non-current Course and pre-COMMIT failure', async (caseTest) => {
        const dataSlotsRoot = createTempDataSlots(caseTest);
        let failBeforeCommit = false;
        const application = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID, {
            commitOptions: {
                failpoint(point) {
                    if (failBeforeCommit && point === 'commit.after-facts') {
                        failBeforeCommit = false;
                        throw new Error(point);
                    }
                },
            },
        });
        const { courseId, epoch } = await initializePlan(application);
        const taskCommand = {
            commandId: '78787878-7878-4878-8878-787878787878',
            followUpId: '90909090-9090-4090-8090-909090909090',
            expectedRevision: '2',
            expectedPlanVersion: '2',
            intent: {
                kind: 'plan.create-task-series' as const,
                intentSchemaVersion: 1 as const,
                payload: {
                    courseId,
                    title: 'Pre-commit task',
                    size: 'small' as const,
                    deadline: { kind: 'tba' as const },
                },
            },
        };
        failBeforeCommit = true;
        const failed = await application.handle(makeCreateTaskRequest(
            'create-task-before-commit',
            APP_BUILD_ID,
            epoch,
            taskCommand,
        ));
        assert.equal(failed.ok, false);
        assert.equal(failBeforeCommit, false);
        const afterFailure = await application.handle(makeSetupQueryRequest(
            'query-after-pre-commit-failure',
            APP_BUILD_ID,
            epoch,
        ));
        assert.equal(afterFailure.ok, true);
        if (!afterFailure.ok || afterFailure.value.kind !== 'workspace.setup-projection') {
            throw new Error('Expected unchanged projection after pre-COMMIT failure');
        }
        assert.equal(afterFailure.value.projection.workspaceRevision, '2');
        assert.deepEqual(afterFailure.value.projection.tasks, []);

        const secondTerm = await application.handle(makeCreateTermRequest(
            'create-second-term',
            APP_BUILD_ID,
            epoch,
            {
                ...termCommand('2', '2'),
                commandId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
                followUpId: '12121212-1212-4212-8212-121212121212',
                intent: {
                    ...termCommand().intent,
                    payload: {
                        ...termCommand().intent.payload,
                        name: 'Winter 2027',
                        startDate: '2027-01-04',
                        endDate: '2027-04-16',
                    },
                },
            },
        ));
        assert.equal(secondTerm.ok, true);
        const staleCourseCommand = {
            commandId: '34343434-3434-4434-8434-343434343434',
            followUpId: '56565656-5656-4656-8656-565656565656',
            expectedRevision: '3',
            expectedPlanVersion: '3',
            intent: {
                kind: 'plan.create-task-series' as const,
                intentSchemaVersion: 1 as const,
                payload: {
                    courseId,
                    title: 'Out-of-scope task',
                    size: 'small' as const,
                    deadline: { kind: 'tba' as const },
                },
            },
        };
        const invalid = await application.handle(makeCreateTaskRequest(
            'create-task-non-current',
            APP_BUILD_ID,
            epoch,
            staleCourseCommand,
        ));
        assert.equal(invalid.ok, false);
        if (invalid.ok) {
            throw new Error('Expected non-current Course rejection');
        }
        assert.equal(invalid.problem.code, 'validation');
        assert.equal(invalid.problem.dataEffect, 'unchanged');

        const projection = await application.handle(makeSetupQueryRequest(
            'query-after-rejections',
            APP_BUILD_ID,
            epoch,
        ));
        assert.equal(projection.ok, true);
        if (!projection.ok || projection.value.kind !== 'workspace.setup-projection') {
            throw new Error('Expected unchanged projection');
        }
        assert.equal(projection.value.projection.workspaceRevision, '3');
        assert.deepEqual(projection.value.projection.tasks, []);
        await application.close();
    });

    await t.test('historical Task cannot be moved into the new Current Term', async (caseTest) => {
        const dataSlotsRoot = createTempDataSlots(caseTest);
        const application = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID);
        const { courseId, epoch } = await initializePlan(application);
        const createdTask = await application.handle(makeCreateTaskRequest(
            'create-task-before-term-switch',
            APP_BUILD_ID,
            epoch,
            {
                commandId: '13131313-1313-4313-8313-131313131313',
                followUpId: '24242424-2424-4424-8424-242424242424',
                expectedRevision: '2',
                expectedPlanVersion: '2',
                intent: {
                    kind: 'plan.create-task-series',
                    intentSchemaVersion: 1,
                    payload: {
                        courseId,
                        title: 'Historical task',
                        size: 'small',
                        deadline: { kind: 'tba' },
                    },
                },
            },
        ));
        assert.equal(createdTask.ok, true);
        if (!createdTask.ok || createdTask.value.kind !== 'workspace.command-outcome') {
            throw new Error('Expected historical Task creation');
        }
        const taskSeriesId = createdTask.value.outcome.effects[0]!.entity.id;

        const secondTerm = await application.handle(makeCreateTermRequest(
            'create-current-term-after-task',
            APP_BUILD_ID,
            epoch,
            {
                ...termCommand('3', '3'),
                commandId: '35353535-3535-4535-8535-353535353535',
                followUpId: '46464646-4646-4646-8646-464646464646',
                intent: {
                    ...termCommand().intent,
                    payload: {
                        ...termCommand().intent.payload,
                        name: 'Winter 2027',
                        startDate: '2027-01-04',
                        endDate: '2027-04-16',
                    },
                },
            },
        ));
        assert.equal(secondTerm.ok, true);

        const currentCourseCommand = courseCommand();
        const currentCourse = await application.handle(makeCreateCourseWithMeetingRequest(
            'create-course-after-task',
            APP_BUILD_ID,
            epoch,
            {
                ...currentCourseCommand,
                commandId: '57575757-5757-4757-8757-575757575757',
                followUpId: '68686868-6868-4868-8868-686868686868',
                expectedRevision: '4',
                expectedPlanVersion: '4',
                intent: {
                    ...currentCourseCommand.intent,
                    payload: {
                        ...currentCourseCommand.intent.payload,
                        course: {
                            ...currentCourseCommand.intent.payload.course,
                            code: 'CSC302',
                        },
                    },
                },
            },
        ));
        assert.equal(currentCourse.ok, true);
        if (!currentCourse.ok || currentCourse.value.kind !== 'workspace.command-outcome') {
            throw new Error('Expected Current Term Course creation');
        }
        const currentCourseId = currentCourse.value.outcome.effects[0]!.entity.id;

        const moved = await application.handle(makeUpdateTaskRequest(
            'move-historical-task',
            APP_BUILD_ID,
            epoch,
            {
                commandId: '79797979-7979-4979-8979-797979797979',
                followUpId: '80808080-8080-4080-8080-808080808080',
                expectedRevision: '5',
                expectedPlanVersion: '5',
                expectedTaskSeriesVersion: '1',
                intent: {
                    kind: 'plan.update-task-series',
                    intentSchemaVersion: 1,
                    payload: {
                        taskSeriesId,
                        courseId: currentCourseId,
                        title: 'Moved historical task',
                        size: 'large',
                        deadline: { kind: 'tba' },
                    },
                },
            },
        ));
        assert.equal(moved.ok, false);
        if (moved.ok) {
            throw new Error('Expected historical Task edit rejection');
        }
        assert.equal(moved.problem.code, 'validation');
        assert.equal(moved.problem.dataEffect, 'unchanged');

        const projection = await application.handle(makeSetupQueryRequest(
            'query-after-historical-task-rejection',
            APP_BUILD_ID,
            epoch,
        ));
        assert.equal(projection.ok, true);
        if (!projection.ok || projection.value.kind !== 'workspace.setup-projection') {
            throw new Error('Expected current projection after historical Task rejection');
        }
        assert.equal(projection.value.projection.workspaceRevision, '5');
        assert.equal(projection.value.projection.tasks.length, 1);
        assert.equal(projection.value.projection.tasks[0]!.courseId, courseId);
        assert.equal(projection.value.projection.tasks[0]!.title, 'Historical task');
        assert.equal(projection.value.projection.tasks[0]!.entityVersion, '1');
        await application.close();
    });

    await t.test('read-only and recovery-required', async (caseTest) => {
        const dataSlotsRoot = createTempDataSlots(caseTest);
        const writable = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID);
        const { courseId } = await initializePlan(writable);
        await writable.close();

        const readOnly = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID, { readOnly: true });
        const readOnlyBootstrap = await bootstrap(readOnly);
        const command = {
            commandId: 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
            followUpId: 'efefefef-efef-4fef-8fef-efefefefefef',
            expectedRevision: '2',
            expectedPlanVersion: '2',
            intent: {
                kind: 'plan.create-task-series' as const,
                intentSchemaVersion: 1 as const,
                payload: {
                    courseId,
                    title: 'Read-only task',
                    size: 'small' as const,
                    deadline: { kind: 'tba' as const },
                },
            },
        };
        const readOnlyOutcome = await readOnly.handle(makeCreateTaskRequest(
            'create-task-read-only',
            APP_BUILD_ID,
            readOnlyBootstrap.workspaceEpoch,
            command,
        ));
        assert.equal(readOnlyOutcome.ok, false);
        if (readOnlyOutcome.ok) {
            throw new Error('Expected read-only rejection');
        }
        assert.equal(readOnlyOutcome.problem.code, 'permission');
        assert.equal(readOnlyOutcome.problem.dataEffect, 'unchanged');
        await readOnly.close();

        const corruptRoot = createTempDataSlots(caseTest);
        const active = join(corruptRoot, 'active');
        mkdirSync(active);
        writeFileSync(join(active, 'workspace.sqlite'), 'not sqlite');
        const recovery = await WorkspaceApplication.open(corruptRoot, APP_BUILD_ID);
        const recoveryBootstrap = await bootstrap(recovery);
        const recoveryOutcome = await recovery.handle(makeCreateTaskRequest(
            'create-task-recovery',
            APP_BUILD_ID,
            recoveryBootstrap.workspaceEpoch,
            command,
        ));
        assert.equal(recoveryOutcome.ok, false);
        if (recoveryOutcome.ok) {
            throw new Error('Expected recovery rejection');
        }
        assert.equal(recoveryOutcome.problem.code, 'recovery-required');
        assert.equal(recoveryOutcome.problem.dataEffect, 'unchanged');
        await recovery.close();
    });
});

test('TEST-DATA-005: concurrent Task writes preserve writer-busy as retryable', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const application = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID);
    const { courseId, epoch } = await initializePlan(application);
    const command = {
        commandId: '12121212-1212-4212-8212-121212121212',
        followUpId: '34343434-3434-4434-8434-343434343434',
        expectedRevision: '2',
        expectedPlanVersion: '2',
        intent: {
            kind: 'plan.create-task-series' as const,
            intentSchemaVersion: 1 as const,
            payload: {
                courseId,
                title: 'Queued task',
                size: 'small' as const,
                deadline: { kind: 'tba' as const },
            },
        },
    };

    const outcomes = await Promise.all(Array.from({ length: 66 }, (_, index) => application.handle(
        makeCreateTaskRequest(`queued-task-${index}`, APP_BUILD_ID, epoch, command),
    )));
    const problems = outcomes.flatMap((outcome) => outcome.ok ? [] : [outcome.problem]);
    assert.equal(problems.some((problem) => problem.code === 'workspace-unavailable'), false);
    assert.ok(problems.some((problem) => (problem.code as string) === 'operation-in-progress'
        && (problem.details as { reason?: string } | undefined)?.reason === 'writer-busy'));
    await application.close();
});
