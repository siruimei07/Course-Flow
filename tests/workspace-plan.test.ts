/**
 * @file Verifies unified Today and Week projections through the Workspace boundary.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { WorkspaceApplication, type ClockPort } from '../src/workspace-application';
import { makeBootstrapRequest } from '../src/shared/bootstrap-contract';
import {
    makeCreateCourseWithMeetingRequest,
    makeCreateTaskRequest,
    makeCreateTermRequest,
    makeInitializeWorkspaceRequest,
    makePlanQueryRequest,
} from '../src/shared/workspace-setup-contract';

const APP_BUILD_ID = 'plan-test-build';

/**
 * Creates an isolated Workspace DATA root.
 * @param {test.TestContext} t - Owning Node test context.
 * @return {string} Fresh DATA slots root.
 */
function createTempDataSlots(t: test.TestContext): string {
    const root = mkdtempSync(join(tmpdir(), 'courseflow-workspace-plan-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    return root;
}

test('A-VIEW-001–006: Workspace returns one Clock-bound Today and Week projection', async t => {
    const root = createTempDataSlots(t);
    let clockReads = 0;
    const clock: ClockPort = {
        now(): string {
            clockReads += 1;
            return '2026-09-10T13:30:00.000Z';
        },
    };
    const application = await WorkspaceApplication.open(root, APP_BUILD_ID, { clock });
    const bootstrap = await application.handle({
        ...makeBootstrapRequest('bootstrap', APP_BUILD_ID),
        dataRootClass: 'verified-local' as const,
    });
    assert.equal(bootstrap.ok, true);
    if (!bootstrap.ok || !('workspaceEpoch' in bootstrap.value)) {
        throw new Error('Expected Workspace bootstrap');
    }
    const epoch = bootstrap.value.workspaceEpoch;
    assert.equal((await application.handle(makeInitializeWorkspaceRequest(
        'initialize',
        APP_BUILD_ID,
        epoch,
    ))).ok, true);
    assert.equal((await application.handle(makeCreateTermRequest(
        'create-term',
        APP_BUILD_ID,
        epoch,
        {
            commandId: '11111111-1111-4111-8111-111111111111',
            followUpId: '22222222-2222-4222-8222-222222222222',
            expectedRevision: '0',
            expectedPlanVersion: '0',
            intent: {
                kind: 'plan.create-term',
                intentSchemaVersion: 1,
                payload: {
                    name: 'Fall 2026',
                    startDate: '2026-09-01',
                    endDate: '2026-09-30',
                    timeZone: 'America/Toronto',
                },
            },
        },
    ))).ok, true);
    const course = await application.handle(makeCreateCourseWithMeetingRequest(
        'create-course',
        APP_BUILD_ID,
        epoch,
        {
            commandId: '33333333-3333-4333-8333-333333333333',
            followUpId: '44444444-4444-4444-8444-444444444444',
            overlapDecision: 'review',
            expectedRevision: '1',
            expectedPlanVersion: '1',
            intent: {
                kind: 'plan.create-course-with-first-meeting',
                intentSchemaVersion: 3,
                payload: {
                    course: {
                        code: 'CSC301',
                        name: 'Software Engineering',
                        section: null,
                        instructor: null,
                        color: null,
                        credits: null,
                        teachingRange: { kind: 'inherit-term' },
                    },
                    meeting: {
                        type: 'LEC',
                        weekday: 'THU',
                        localStart: '09:00',
                        localEnd: '10:00',
                        endDayOffset: 0,
                        effectiveRange: { kind: 'inherit-course' },
                        location: { kind: 'tba' },
                    },
                },
            },
        },
    ));
    assert.equal(course.ok, true);
    if (!course.ok || course.value.kind !== 'workspace.command-outcome') {
        throw new Error('Expected Course creation');
    }
    const courseId = course.value.outcome.effects[0]!.entity.id;
    const task = await application.handle(makeCreateTaskRequest(
        'create-task',
        APP_BUILD_ID,
        epoch,
        {
            commandId: '55555555-5555-4555-8555-555555555555',
            followUpId: '66666666-6666-4666-8666-666666666666',
            expectedRevision: '2',
            expectedPlanVersion: '2',
            intent: {
                kind: 'plan.create-task-series',
                intentSchemaVersion: 2,
                payload: {
                    courseId,
                    title: 'Submit today',
                    size: 'small',
                    schedule: {
                        kind: 'once',
                        deadline: { kind: 'date-only', date: '2026-09-10' },
                    },
                },
            },
        },
    ));
    assert.equal(task.ok, true);

    const outcome = await application.handle(makePlanQueryRequest(
        'query-plan',
        APP_BUILD_ID,
        epoch,
    ));
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    if (!outcome.ok || outcome.value.kind !== 'workspace.plan-projection') {
        throw new Error('Expected unified PLAN projection');
    }
    const projection = outcome.value.projection;
    assert.equal(clockReads, 1);
    assert.equal(projection.workspaceRevision, '3');
    assert.deepEqual(projection.evaluationContext, {
        evaluatedAt: '2026-09-10T13:30:00.000Z',
        termZone: 'America/Toronto',
        applicableDate: '2026-09-10',
        requestedWindow: { startDate: '2026-09-07', endDate: '2026-09-13' },
    });
    assert.deepEqual(projection.attendance, {
        availability: 'unavailable',
        todayMeetingCountBasis: 'meeting-end-state',
    });
    assert.deepEqual(projection.today.summary, {
        completed: 0,
        pending: 2,
        contributions: {
            tasks: { completed: 0, pending: 1 },
            meetings: { completed: 0, pending: 1 },
        },
        excluded: {
            skippedTasks: 0,
            priorOverdueTasks: 0,
            tbaTasks: 0,
            cancelledMeetings: 0,
            holidaySuppressedMeetings: 0,
            missedMeetings: 0,
            unmarkedMeetings: 0,
        },
    });
    assert.equal(projection.today.tasks.length, 1);
    assert.equal(projection.today.meetings.length, 1);
    assert.equal(projection.next.small.kind, 'task');
    assert.deepEqual(projection.next.large, {
        kind: 'empty',
        reason: 'no-pending-known-deadline',
    });
    assert.deepEqual(projection.termProgress, {
        elapsedDays: 10,
        totalDays: 30,
        ratio: 1 / 3,
    });
    await application.close();
});

test('A-VIEW-001–006: Workspace queries every Meeting and Task in a Term over 366 days', async t => {
    const root = createTempDataSlots(t);
    const clock: ClockPort = {
        now(): string {
            return '2026-09-10T13:30:00.000Z';
        },
    };
    const application = await WorkspaceApplication.open(root, APP_BUILD_ID, { clock });
    const bootstrap = await application.handle({
        ...makeBootstrapRequest('extended-bootstrap', APP_BUILD_ID),
        dataRootClass: 'verified-local' as const,
    });
    assert.equal(bootstrap.ok, true);
    if (!bootstrap.ok || !('workspaceEpoch' in bootstrap.value)) {
        throw new Error('Expected extended-Term Workspace bootstrap');
    }
    const epoch = bootstrap.value.workspaceEpoch;
    assert.equal((await application.handle(makeInitializeWorkspaceRequest(
        'extended-initialize',
        APP_BUILD_ID,
        epoch,
    ))).ok, true);
    assert.equal((await application.handle(makeCreateTermRequest(
        'extended-create-term',
        APP_BUILD_ID,
        epoch,
        {
            commandId: '71111111-1111-4111-8111-111111111111',
            followUpId: '72222222-2222-4222-8222-222222222222',
            expectedRevision: '0',
            expectedPlanVersion: '0',
            intent: {
                kind: 'plan.create-term',
                intentSchemaVersion: 1,
                payload: {
                    name: 'Extended program 2025–2027',
                    startDate: '2025-01-01',
                    endDate: '2027-12-31',
                    timeZone: 'America/Toronto',
                },
            },
        },
    ))).ok, true);
    const course = await application.handle(makeCreateCourseWithMeetingRequest(
        'extended-create-course',
        APP_BUILD_ID,
        epoch,
        {
            commandId: '73333333-3333-4333-8333-333333333333',
            followUpId: '74444444-4444-4444-8444-444444444444',
            overlapDecision: 'review',
            expectedRevision: '1',
            expectedPlanVersion: '1',
            intent: {
                kind: 'plan.create-course-with-first-meeting',
                intentSchemaVersion: 3,
                payload: {
                    course: {
                        code: 'CSC499',
                        name: 'Extended Capstone',
                        section: null,
                        instructor: null,
                        color: null,
                        credits: null,
                        teachingRange: { kind: 'inherit-term' },
                    },
                    meeting: {
                        type: 'LEC',
                        weekday: 'THU',
                        localStart: '09:00',
                        localEnd: '10:00',
                        endDayOffset: 0,
                        effectiveRange: { kind: 'inherit-course' },
                        location: { kind: 'tba' },
                    },
                },
            },
        },
    ));
    assert.equal(course.ok, true, JSON.stringify(course));
    if (!course.ok || course.value.kind !== 'workspace.command-outcome') {
        throw new Error('Expected extended-Term Course creation');
    }
    const courseId = course.value.outcome.effects[0]!.entity.id;
    const onceTask = await application.handle(makeCreateTaskRequest(
        'extended-create-once-task',
        APP_BUILD_ID,
        epoch,
        {
            commandId: '75555555-5555-4555-8555-555555555555',
            followUpId: '76666666-6666-4666-8666-666666666666',
            expectedRevision: '2',
            expectedPlanVersion: '2',
            intent: {
                kind: 'plan.create-task-series',
                intentSchemaVersion: 2,
                payload: {
                    courseId,
                    title: 'Submit capstone',
                    size: 'small',
                    schedule: {
                        kind: 'once',
                        deadline: { kind: 'date-only', date: '2026-09-10' },
                    },
                },
            },
        },
    ));
    assert.equal(onceTask.ok, true, JSON.stringify(onceTask));
    const weeklyTask = await application.handle(makeCreateTaskRequest(
        'extended-create-weekly-task',
        APP_BUILD_ID,
        epoch,
        {
            commandId: '77777777-7777-4777-8777-777777777777',
            followUpId: '78888888-8888-4888-8888-888888888888',
            expectedRevision: '3',
            expectedPlanVersion: '3',
            intent: {
                kind: 'plan.create-task-series',
                intentSchemaVersion: 2,
                payload: {
                    courseId,
                    title: 'Weekly research log',
                    size: 'large',
                    schedule: {
                        kind: 'weekly',
                        startDate: '2025-01-01',
                        weekday: 'FRI',
                        localDeadlineTime: '17:00',
                        confirmedEndDate: '2027-12-31',
                        followTeachingWeek: false,
                    },
                },
            },
        },
    ));
    assert.equal(weeklyTask.ok, true, JSON.stringify(weeklyTask));
    if (!onceTask.ok
        || onceTask.value.kind !== 'workspace.command-outcome'
        || !weeklyTask.ok
        || weeklyTask.value.kind !== 'workspace.command-outcome') {
        throw new Error('Expected extended-Term Task creation');
    }
    const onceTaskSeriesId = onceTask.value.outcome.effects[0]!.entity.id;
    const weeklyTaskSeriesId = weeklyTask.value.outcome.effects[0]!.entity.id;

    const outcome = await application.handle(makePlanQueryRequest(
        'extended-query-plan',
        APP_BUILD_ID,
        epoch,
    ));
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    if (!outcome.ok || outcome.value.kind !== 'workspace.plan-projection') {
        throw new Error('Expected extended-Term PLAN projection');
    }
    const projection = outcome.value.projection;
    const taskIdentities = projection.tasks.map(task => (
        `${task.occurrence.occurrenceId.taskSeriesId}:${task.occurrence.occurrenceId.originalLogicalAnchor}`
    ));
    const meetingIdentities = projection.meetings.map(meeting => (
        `${meeting.occurrence.occurrenceId.meetingSeriesId}:`
        + meeting.occurrence.occurrenceId.originalLogicalAnchor
    ));

    assert.equal(projection.workspaceRevision, '4');
    assert.equal(projection.tasks.length, 158);
    assert.equal(new Set(taskIdentities).size, projection.tasks.length);
    assert.equal(projection.meetings.length, 157);
    assert.equal(new Set(meetingIdentities).size, projection.meetings.length);
    assert.deepEqual(projection.tasks.filter(task => (
        task.occurrence.occurrenceId.taskSeriesId === onceTaskSeriesId
    )).map(task => task.occurrence.occurrenceId.originalLogicalAnchor), ['once']);
    assert.equal(projection.tasks.filter(task => (
        task.occurrence.occurrenceId.taskSeriesId === weeklyTaskSeriesId
    )).length, 157);
    assert.equal(projection.next.small.kind, 'task');
    assert.equal(projection.next.large.kind, 'task');
    if (projection.next.small.kind === 'task' && projection.next.large.kind === 'task') {
        assert.equal(
            projection.next.small.task.occurrence.occurrenceId.taskSeriesId,
            onceTaskSeriesId,
        );
        assert.deepEqual(projection.next.large.task.occurrence.occurrenceId, {
            taskSeriesId: weeklyTaskSeriesId,
            originalLogicalAnchor: '2025-01-03',
        });
    }
    await application.close();
});
