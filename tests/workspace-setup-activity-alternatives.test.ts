/**
 * @file Verifies first setup can save Course before choosing a Meeting or Task.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { WorkspaceApplication } from '../src/workspace/application';
import { makeBootstrapRequest } from '../src/shared/bootstrap-contract';
import {
    makeCreateCourseRequest,
    makeCreateMeetingSeriesRequest,
    makeCreateTaskRequest,
    makeCreateTermRequest,
    makeInitializeWorkspaceRequest,
    makeSetupQueryRequest,
} from '../src/shared/workspace-setup-contract';

const APP_BUILD_ID = 'setup-alternative-test-build';

function createTempDataSlots(t: test.TestContext): string {
    const dataSlotsRoot = mkdtempSync(join(tmpdir(), 'courseflow-setup-alternative-'));
    t.after(() => rmSync(dataSlotsRoot, { recursive: true, force: true }));
    return dataSlotsRoot;
}

async function bootstrap(application: WorkspaceApplication): Promise<string> {
    const outcome = await application.handle({
        ...makeBootstrapRequest('bootstrap', APP_BUILD_ID),
        dataRootClass: 'verified-local' as const,
    });
    if (!outcome.ok || !('workspaceEpoch' in outcome.value)) {
        throw new Error('Expected Workspace bootstrap');
    }
    return outcome.value.workspaceEpoch;
}

async function establishCourse(t: test.TestContext): Promise<Readonly<{
    application: WorkspaceApplication;
    epoch: string;
    courseId: string;
}>> {
    const application = await WorkspaceApplication.open(createTempDataSlots(t), APP_BUILD_ID);
    const epoch = await bootstrap(application);
    await application.handle(makeInitializeWorkspaceRequest('initialize', APP_BUILD_ID, epoch));
    const term = await application.handle(makeCreateTermRequest('term', APP_BUILD_ID, epoch, {
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
                endDate: '2026-12-20',
                timeZone: 'America/Toronto',
            },
        },
    }));
    assert.equal(term.ok, true);

    const course = await application.handle(makeCreateCourseRequest('course', APP_BUILD_ID, epoch, {
        commandId: '33333333-3333-4333-8333-333333333333',
        followUpId: '44444444-4444-4444-8444-444444444444',
        expectedRevision: '1',
        expectedPlanVersion: '1',
        intent: {
            kind: 'plan.create-course',
            intentSchemaVersion: 1,
            payload: {
                course: {
                    code: 'CSC108',
                    name: 'Introduction to Computer Programming',
                    section: null,
                    instructor: null,
                    color: 'blue',
                    credits: '3',
                    teachingRange: { kind: 'inherit-term' },
                },
            },
        },
    }));
    assert.equal(course.ok, true, JSON.stringify(course));
    if (!course.ok || course.value.kind !== 'workspace.command-outcome') {
        throw new Error('Expected Course-only outcome');
    }
    assert.deepEqual(course.value.outcome.effects.map(effect => effect.code), ['plan.course-created']);

    const projection = await application.handle(makeSetupQueryRequest(
        'after-course',
        APP_BUILD_ID,
        epoch,
    ));
    if (!projection.ok || projection.value.kind !== 'workspace.setup-projection') {
        throw new Error('Expected setup projection after Course');
    }
    assert.deepEqual(projection.value.projection.minimum, {
        hasCurrentTerm: true,
        hasCurrentTermCourse: true,
        hasMeetingOrTask: false,
        isSatisfied: false,
    });
    assert.equal(projection.value.projection.courses[0]?.meetings.length, 0);
    return {
        application,
        epoch,
        courseId: course.value.outcome.effects[0]!.entity.id,
    };
}

test('UF-A-02: a new user saves Course then chooses Meeting', async (t) => {
    const { application, courseId, epoch } = await establishCourse(t);
    const meeting = await application.handle(makeCreateMeetingSeriesRequest(
        'meeting',
        APP_BUILD_ID,
        epoch,
        {
            commandId: '55555555-5555-4555-8555-555555555555',
            followUpId: '66666666-6666-4666-8666-666666666666',
            overlapDecision: 'review',
            expectedRevision: '2',
            expectedPlanVersion: '2',
            expectedCourseVersion: '1',
            intent: {
                kind: 'plan.create-meeting-series',
                intentSchemaVersion: 1,
                payload: {
                    courseId,
                    meeting: {
                        type: 'LEC',
                        weekday: 'MON',
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
    assert.equal(meeting.ok, true, JSON.stringify(meeting));
    if (!meeting.ok || meeting.value.kind !== 'workspace.command-outcome') {
        throw new Error('Expected Meeting-only outcome');
    }
    assert.deepEqual(meeting.value.outcome.effects.map(effect => effect.code), [
        'plan.meeting-series-created',
    ]);

    const projection = await application.handle(makeSetupQueryRequest(
        'after-meeting',
        APP_BUILD_ID,
        epoch,
    ));
    if (!projection.ok || projection.value.kind !== 'workspace.setup-projection') {
        throw new Error('Expected setup projection after Meeting');
    }
    assert.equal(projection.value.projection.minimum.isSatisfied, true);
    assert.equal(projection.value.projection.courses[0]?.meetings.length, 1);
    await application.close();
});

test('known Course and Meeting creation kinds report validation for malformed requests', async t => {
    const application = await WorkspaceApplication.open(createTempDataSlots(t), APP_BUILD_ID);
    const epoch = await bootstrap(application);

    for (const kind of ['workspace.course.create', 'workspace.meeting-series.create'] as const) {
        const outcome = await application.handle({
            kind,
            requestId: `malformed-${kind}`,
            appBuildId: APP_BUILD_ID,
            workspaceEpoch: epoch,
        });
        assert.equal(outcome.ok, false);
        if (outcome.ok) {
            throw new Error(`Expected malformed ${kind} request rejection`);
        }
        assert.equal(outcome.problem.code, 'validation');
        assert.equal(outcome.problem.dataEffect, 'unchanged');
    }

    await application.close();
});

test('UF-A-02/TEST-USABILITY-001: a new user saves Course then chooses Task', async (t) => {
    const { application, courseId, epoch } = await establishCourse(t);
    const task = await application.handle(makeCreateTaskRequest('task', APP_BUILD_ID, epoch, {
        commandId: '77777777-7777-4777-8777-777777777777',
        followUpId: '88888888-8888-4888-8888-888888888888',
        expectedRevision: '2',
        expectedPlanVersion: '2',
        intent: {
            kind: 'plan.create-task-series',
            intentSchemaVersion: 1,
            payload: {
                courseId,
                title: 'Read chapter one',
                size: 'small',
                deadline: { kind: 'tba' },
            },
        },
    }));
    assert.equal(task.ok, true, JSON.stringify(task));

    const projection = await application.handle(makeSetupQueryRequest(
        'after-task',
        APP_BUILD_ID,
        epoch,
    ));
    if (!projection.ok || projection.value.kind !== 'workspace.setup-projection') {
        throw new Error('Expected setup projection after Task');
    }
    assert.equal(projection.value.projection.minimum.isSatisfied, true);
    assert.equal(projection.value.projection.courses[0]?.meetings.length, 0);
    assert.equal(projection.value.projection.tasks.length, 1);
    await application.close();
});
