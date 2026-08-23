/**
 * @file Verifies setup flows through the public Workspace application boundary.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { WorkspaceApplication } from '../src/workspace-application';
import { makeBootstrapRequest } from '../src/shared/bootstrap-contract';
import {
    makeCreateCourseWithMeetingRequest,
    makeCreateTermRequest,
    makeInitializeWorkspaceRequest,
    makeSetupQueryRequest,
} from '../src/shared/workspace-setup-contract';

const APP_BUILD_ID = 'test-build';
const COMMAND_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FOLLOW_UP_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const COURSE_COMMAND_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const COURSE_FOLLOW_UP_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function createTempDataSlots(t: test.TestContext): string {
    const dataSlotsRoot = mkdtempSync(join(tmpdir(), 'courseflow-workspace-'));
    t.after(() => rmSync(dataSlotsRoot, { recursive: true, force: true }));
    return dataSlotsRoot;
}

function createCommand(expectedRevision = '0') {
    return {
        commandId: COMMAND_ID,
        followUpId: FOLLOW_UP_ID,
        expectedRevision,
        expectedPlanVersion: '0',
        intent: {
            kind: 'plan.create-term' as const,
            intentSchemaVersion: 1 as const,
            payload: {
                name: 'Fall 2026',
                startDate: '2026-09-08',
                endDate: '2026-12-18',
                timeZone: 'America/Toronto',
            },
        },
    };
}

function createCourseCommand() {
    return {
        commandId: COURSE_COMMAND_ID,
        followUpId: COURSE_FOLLOW_UP_ID,
        expectedRevision: '1',
        expectedPlanVersion: '1',
        intent: {
            kind: 'plan.create-course-with-first-meeting' as const,
            intentSchemaVersion: 2 as const,
            payload: {
                course: {
                    code: 'CSC108',
                    name: 'Introduction to Computer Programming',
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
                    effectiveRange: { kind: 'inherit-course' as const },
                    location: { kind: 'known' as const, value: 'BA 1170' },
                },
            },
        },
    };
}

async function bootstrap(application: WorkspaceApplication) {
    const outcome = await application.handle({
        ...makeBootstrapRequest('bootstrap', APP_BUILD_ID),
        dataRootClass: 'verified-local' as const,
    });
    assert.equal(outcome.ok, true);
    if (!outcome.ok || !('workspaceEpoch' in outcome.value)) {
        throw new Error('Expected bootstrap outcome');
    }
    return outcome.value;
}

test('FLOW-00/01: setup creates Current Term, Course, and first Meeting through one boundary', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const application = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID);
    const initial = await bootstrap(application);
    assert.deepEqual(initial.workspaceData, { kind: 'absent' });

    const initialized = await application.handle(makeInitializeWorkspaceRequest(
        'initialize',
        APP_BUILD_ID,
        initial.workspaceEpoch,
    ));
    assert.equal(initialized.ok, true);
    if (!initialized.ok || initialized.value.kind !== 'workspace.initialized') {
        throw new Error('Expected initialized Workspace');
    }
    assert.equal(initialized.value.workspaceData.kind, 'ready');

    const before = await application.handle(makeSetupQueryRequest(
        'setup-before',
        APP_BUILD_ID,
        initial.workspaceEpoch,
    ));
    assert.equal(before.ok, true);
    if (!before.ok || before.value.kind !== 'workspace.setup-projection') {
        throw new Error('Expected setup projection');
    }
    assert.equal(before.value.projection.currentTerm, null);
    assert.equal(before.value.projection.workspaceRevision, '0');

    const committed = await application.handle(makeCreateTermRequest(
        'create-term',
        APP_BUILD_ID,
        initial.workspaceEpoch,
        createCommand(before.value.projection.workspaceRevision),
    ));
    assert.equal(committed.ok, true);
    if (!committed.ok || committed.value.kind !== 'workspace.command-outcome') {
        throw new Error('Expected command outcome');
    }
    assert.equal(committed.value.outcome.kind, 'committed');

    const courseCommitted = await application.handle(makeCreateCourseWithMeetingRequest(
        'create-course',
        APP_BUILD_ID,
        initial.workspaceEpoch,
        createCourseCommand(),
    ));
    assert.equal(courseCommitted.ok, true);
    if (!courseCommitted.ok || courseCommitted.value.kind !== 'workspace.command-outcome') {
        throw new Error('Expected Course/Meeting outcome');
    }
    assert.deepEqual(courseCommitted.value.outcome.effects.map(effect => effect.code), [
        'plan.course-created',
        'plan.meeting-series-created',
    ]);

    const after = await application.handle(makeSetupQueryRequest(
        'setup-after',
        APP_BUILD_ID,
        initial.workspaceEpoch,
    ));
    assert.equal(after.ok, true);
    if (!after.ok || after.value.kind !== 'workspace.setup-projection') {
        throw new Error('Expected setup projection');
    }
    assert.equal(after.value.projection.workspaceRevision, courseCommitted.value.outcome.revision);
    assert.equal(
        after.value.projection.currentTerm?.termId,
        committed.value.outcome.effects[0]?.entity.id,
    );
    assert.equal(
        after.value.projection.courses[0]?.courseId,
        courseCommitted.value.outcome.effects[0]?.entity.id,
    );
    assert.equal(
        after.value.projection.courses[0]?.meetings[0]?.meetingSeriesId,
        courseCommitted.value.outcome.effects[1]?.entity.id,
    );
    assert.doesNotMatch(
        JSON.stringify(after),
        /workspace\.sqlite|DataSlots|[A-Za-z]:[\\/]|\/Users\//,
    );
    await application.close();
});

test('FLOW-00/Q-CONTINUITY-01: restart preserves Term, Course, and Meeting identities', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const firstApplication = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID);
    const firstBootstrap = await bootstrap(firstApplication);
    await firstApplication.handle(makeInitializeWorkspaceRequest(
        'initialize',
        APP_BUILD_ID,
        firstBootstrap.workspaceEpoch,
    ));
    const committed = await firstApplication.handle(makeCreateTermRequest(
        'create-term',
        APP_BUILD_ID,
        firstBootstrap.workspaceEpoch,
        createCommand(),
    ));
    assert.equal(committed.ok, true);
    if (!committed.ok || committed.value.kind !== 'workspace.command-outcome') {
        throw new Error('Expected command outcome');
    }
    const termId = committed.value.outcome.effects[0]!.entity.id;
    const courseCommitted = await firstApplication.handle(makeCreateCourseWithMeetingRequest(
        'create-course',
        APP_BUILD_ID,
        firstBootstrap.workspaceEpoch,
        createCourseCommand(),
    ));
    assert.equal(courseCommitted.ok, true);
    if (!courseCommitted.ok || courseCommitted.value.kind !== 'workspace.command-outcome') {
        throw new Error('Expected Course/Meeting outcome');
    }
    const courseId = courseCommitted.value.outcome.effects[0]!.entity.id;
    const meetingSeriesId = courseCommitted.value.outcome.effects[1]!.entity.id;
    await firstApplication.close();

    const restarted = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID);
    const restartedBootstrap = await bootstrap(restarted);
    assert.notEqual(restartedBootstrap.workspaceEpoch, firstBootstrap.workspaceEpoch);
    const projection = await restarted.handle(makeSetupQueryRequest(
        'setup-restarted',
        APP_BUILD_ID,
        restartedBootstrap.workspaceEpoch,
    ));
    assert.equal(projection.ok, true);
    if (!projection.ok || projection.value.kind !== 'workspace.setup-projection') {
        throw new Error('Expected setup projection');
    }
    assert.equal(projection.value.projection.currentTerm?.termId, termId);
    assert.equal(projection.value.projection.courses[0]?.courseId, courseId);
    assert.equal(
        projection.value.projection.courses[0]?.meetings[0]?.meetingSeriesId,
        meetingSeriesId,
    );
    await restarted.close();
});

test('FLOW-01/Q-CONTINUITY-01: post-COMMIT response loss resolves through the durable receipt', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    let loseCourseResponse = false;
    const application = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID, {
        commitOptions: {
            failpoint(point) {
                if (loseCourseResponse && point === 'commit.after-sqlite-commit') {
                    throw new Error('simulated response loss');
                }
            },
        },
    });
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
        createCommand(),
    ));
    assert.equal(term.ok, true);

    loseCourseResponse = true;
    const outcome = await application.handle(makeCreateCourseWithMeetingRequest(
        'create-course-after-response-loss',
        APP_BUILD_ID,
        initial.workspaceEpoch,
        createCourseCommand(),
    ));
    assert.equal(outcome.ok, true);
    if (!outcome.ok || outcome.value.kind !== 'workspace.command-outcome') {
        throw new Error('Expected the durable Course/Meeting receipt outcome');
    }
    assert.deepEqual(outcome.value.outcome.effects.map(effect => effect.code), [
        'plan.course-created',
        'plan.meeting-series-created',
    ]);

    const projection = await application.handle(makeSetupQueryRequest(
        'setup-after-response-loss',
        APP_BUILD_ID,
        initial.workspaceEpoch,
    ));
    assert.equal(projection.ok, true);
    if (!projection.ok || projection.value.kind !== 'workspace.setup-projection') {
        throw new Error('Expected setup projection after receipt recovery');
    }
    assert.equal(projection.value.projection.courses.length, 1);
    assert.equal(
        projection.value.projection.courses[0]?.courseId,
        outcome.value.outcome.effects[0]?.entity.id,
    );
    assert.equal(
        projection.value.projection.courses[0]?.meetings[0]?.meetingSeriesId,
        outcome.value.outcome.effects[1]?.entity.id,
    );
    await application.close();
});

test('FLOW-00/Q-CONTINUITY-01: Term post-COMMIT response loss also resolves by receipt', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const application = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID, {
        commitOptions: {
            failpoint(point) {
                if (point === 'commit.after-sqlite-commit') {
                    throw new Error('simulated Term response loss');
                }
            },
        },
    });
    const initial = await bootstrap(application);
    await application.handle(makeInitializeWorkspaceRequest(
        'initialize',
        APP_BUILD_ID,
        initial.workspaceEpoch,
    ));

    const outcome = await application.handle(makeCreateTermRequest(
        'create-term-after-response-loss',
        APP_BUILD_ID,
        initial.workspaceEpoch,
        createCommand(),
    ));
    assert.equal(outcome.ok, true);
    if (!outcome.ok || outcome.value.kind !== 'workspace.command-outcome') {
        throw new Error('Expected the durable Term receipt outcome');
    }

    const projection = await application.handle(makeSetupQueryRequest(
        'setup-after-term-response-loss',
        APP_BUILD_ID,
        initial.workspaceEpoch,
    ));
    assert.equal(projection.ok, true);
    if (!projection.ok || projection.value.kind !== 'workspace.setup-projection') {
        throw new Error('Expected setup projection after Term receipt recovery');
    }
    assert.equal(
        projection.value.projection.currentTerm?.termId,
        outcome.value.outcome.effects[0]?.entity.id,
    );
    await application.close();
});

test('read-only and recovery-required Workspace modes reject setup writes', async (t) => {
    await t.test('read-only', async (caseTest) => {
        const dataSlotsRoot = createTempDataSlots(caseTest);
        const writable = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID);
        const writableBootstrap = await bootstrap(writable);
        await writable.handle(makeInitializeWorkspaceRequest(
            'initialize',
            APP_BUILD_ID,
            writableBootstrap.workspaceEpoch,
        ));
        await writable.handle(makeCreateTermRequest(
            'create-term',
            APP_BUILD_ID,
            writableBootstrap.workspaceEpoch,
            createCommand(),
        ));
        await writable.close();

        const readOnly = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID, { readOnly: true });
        const readOnlyBootstrap = await bootstrap(readOnly);
        const outcome = await readOnly.handle(makeCreateCourseWithMeetingRequest(
            'create-read-only',
            APP_BUILD_ID,
            readOnlyBootstrap.workspaceEpoch,
            createCourseCommand(),
        ));
        assert.equal(outcome.ok, false);
        if (outcome.ok) {
            throw new Error('Expected read-only rejection');
        }
        assert.equal(outcome.problem.code, 'permission');
        assert.equal(outcome.problem.dataEffect, 'unchanged');
        await readOnly.close();
    });

    await t.test('recovery-required', async (caseTest) => {
        const dataSlotsRoot = createTempDataSlots(caseTest);
        const active = join(dataSlotsRoot, 'active');
        mkdirSync(active);
        writeFileSync(join(active, 'workspace.sqlite'), 'not sqlite');
        const recovery = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID);
        const recoveryBootstrap = await bootstrap(recovery);
        assert.equal(recoveryBootstrap.workspaceData.kind, 'recovery');

        const outcome = await recovery.handle(makeCreateCourseWithMeetingRequest(
            'create-recovery',
            APP_BUILD_ID,
            recoveryBootstrap.workspaceEpoch,
            createCourseCommand(),
        ));
        assert.equal(outcome.ok, false);
        if (outcome.ok) {
            throw new Error('Expected recovery rejection');
        }
        assert.equal(outcome.problem.code, 'recovery-required');
        assert.equal(outcome.problem.dataEffect, 'unchanged');
        await recovery.close();
    });
});
