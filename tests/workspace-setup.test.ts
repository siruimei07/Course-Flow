/**
 * @file Verifies setup flows through the public Workspace application boundary.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { WorkspaceApplication } from '../src/workspace/application';
import { makeBootstrapRequest } from '../src/shared/bootstrap-contract';
import {
    makeCreateCourseWithMeetingRequest,
    makeCreateTermRequest,
    makeDiscardSetupDraftCheckpointRequest,
    makeInitializeWorkspaceRequest,
    makeSaveSetupDraftCheckpointRequest,
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
        overlapDecision: 'review' as const,
        expectedRevision: '1',
        expectedPlanVersion: '1',
        intent: {
            kind: 'plan.create-course-with-first-meeting' as const,
            intentSchemaVersion: 3 as const,
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
                    endDayOffset: 0 as const,
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
    assert.equal(initial.workspaceLifecycle.route, 'welcome');
    assert.equal(initial.workspaceLifecycle.workspaceRevision, null);
    assert.equal(initial.workspaceLifecycle.capabilities['workspace.initialize'], 'available');

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
    assert.deepEqual(before.value.projection.minimum, {
        hasCurrentTerm: false,
        hasCurrentTermCourse: false,
        hasMeetingOrTask: false,
        isSatisfied: false,
    });
    assert.equal(before.value.projection.everReachedMinimum, false);
    assert.equal(before.value.projection.defaultRoute, 'setup');
    assert.equal(before.value.projection.draftCheckpointVersion, '0');
    assert.equal(before.value.projection.draftCheckpoint, null);

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
    assert.deepEqual(after.value.projection.minimum, {
        hasCurrentTerm: true,
        hasCurrentTermCourse: true,
        hasMeetingOrTask: true,
        isSatisfied: true,
    });
    assert.equal(after.value.projection.everReachedMinimum, true);
    assert.equal(after.value.projection.defaultRoute, 'today');
    const completedLifecycle = await bootstrap(application);
    assert.equal(completedLifecycle.workspaceLifecycle.route, 'today');
    assert.equal(completedLifecycle.workspaceLifecycle.workspaceRevision, '2');
    assert.deepEqual(
        completedLifecycle.workspaceLifecycle.pendingFollowUps.map(followUp => followUp.followUpId),
        [FOLLOW_UP_ID, COURSE_FOLLOW_UP_ID],
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
    assert.equal(restartedBootstrap.workspaceLifecycle.route, 'today');
    assert.equal(restartedBootstrap.workspaceLifecycle.workspaceRevision, '2');
    assert.deepEqual(
        restartedBootstrap.workspaceLifecycle.pendingFollowUps.map(
            followUp => followUp.followUpId,
        ),
        [FOLLOW_UP_ID, COURSE_FOLLOW_UP_ID],
    );
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
    assert.equal(projection.value.projection.everReachedMinimum, true);
    assert.equal(projection.value.projection.defaultRoute, 'today');
    await restarted.close();

    let loseLifecycleResponse = true;
    const ended = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID, {
        clock: { now: () => '2027-01-05T12:00:00.000Z' },
        commitOptions: {
            failpoint(point) {
                if (loseLifecycleResponse && point === 'commit.after-sqlite-commit') {
                    loseLifecycleResponse = false;
                    throw new Error('simulated lifecycle response loss');
                }
            },
        },
    });
    const endedBootstrap = await bootstrap(ended);
    assert.equal(endedBootstrap.workspaceLifecycle.route, 'today');
    assert.equal(endedBootstrap.workspaceLifecycle.workspaceRevision, '3');
    assert.equal(endedBootstrap.workspaceData.kind, 'ready');
    if (endedBootstrap.workspaceData.kind !== 'ready'
        || restartedBootstrap.workspaceData.kind !== 'ready') {
        throw new Error('Expected ready DATA before and after automatic archive');
    }
    assert.equal(endedBootstrap.workspaceData.workspaceId, restartedBootstrap.workspaceData.workspaceId);
    assert.equal(endedBootstrap.workspaceData.revision, '3');
    const endedProjection = await ended.handle(makeSetupQueryRequest(
        'setup-after-term-ended',
        APP_BUILD_ID,
        endedBootstrap.workspaceEpoch,
    ));
    assert.equal(endedProjection.ok, true);
    if (!endedProjection.ok || endedProjection.value.kind !== 'workspace.setup-projection') {
        throw new Error('Expected setup projection after Term reconciliation');
    }
    assert.equal(endedProjection.value.projection.minimum.isSatisfied, false);
    assert.equal(endedProjection.value.projection.everReachedMinimum, true);
    assert.equal(endedProjection.value.projection.defaultRoute, 'today');
    await ended.close();

    const afterArchiveRestart = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID);
    const afterArchiveBootstrap = await bootstrap(afterArchiveRestart);
    assert.equal(afterArchiveBootstrap.workspaceLifecycle.route, 'today');
    assert.equal(afterArchiveBootstrap.workspaceLifecycle.workspaceRevision, '3');
    const afterArchiveProjection = await afterArchiveRestart.handle(makeSetupQueryRequest(
        'setup-after-archive-restart',
        APP_BUILD_ID,
        afterArchiveBootstrap.workspaceEpoch,
    ));
    assert.equal(afterArchiveProjection.ok, true);
    if (!afterArchiveProjection.ok
        || afterArchiveProjection.value.kind !== 'workspace.setup-projection') {
        throw new Error('Expected setup projection after archived restart');
    }
    assert.equal(afterArchiveProjection.value.projection.currentTerm, null);
    assert.equal(afterArchiveProjection.value.projection.everReachedMinimum, true);
    assert.equal(afterArchiveProjection.value.projection.defaultRoute, 'today');
    assert.equal(afterArchiveProjection.value.projection.terms[0]?.termId, termId);
    await afterArchiveRestart.close();
});

test('FLOW-00: setup draft saves, conflicts, resumes, and discards outside formal revision', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const application = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID, {
        clock: { now: () => '2026-08-24T12:00:00.000Z' },
    });
    const initial = await bootstrap(application);
    await application.handle(makeInitializeWorkspaceRequest(
        'initialize',
        APP_BUILD_ID,
        initial.workspaceEpoch,
    ));
    const incompatible = await application.handle({
        ...makeSaveSetupDraftCheckpointRequest(
            'save-incompatible-draft',
            APP_BUILD_ID,
            initial.workspaceEpoch,
            { expectedVersion: '0', schemaVersion: 1, opaquePayload: '{}' },
        ),
        input: { expectedVersion: '0', schemaVersion: 2, opaquePayload: '{}' },
    });
    assert.equal(incompatible.ok, false);
    if (incompatible.ok) {
        throw new Error('Expected incompatible setup draft schema rejection');
    }
    assert.equal(incompatible.problem.code, 'validation');

    const payload = JSON.stringify({ schemaVersion: 1, step: 'term', termDraft: { name: 'Fall 2026' } });
    const saved = await application.handle(makeSaveSetupDraftCheckpointRequest(
        'save-draft',
        APP_BUILD_ID,
        initial.workspaceEpoch,
        { expectedVersion: '0', schemaVersion: 1, opaquePayload: payload },
    ));
    assert.equal(saved.ok, true);
    if (!saved.ok || saved.value.kind !== 'workspace.setup-projection') {
        throw new Error('Expected saved setup draft projection');
    }
    assert.equal(saved.value.projection.workspaceRevision, '0');
    assert.equal(saved.value.projection.planEntityVersion, '0');
    assert.equal(saved.value.projection.draftCheckpointVersion, '1');
    assert.deepEqual(saved.value.projection.draftCheckpoint, {
        draftId: 'first-setup',
        kind: 'first-setup',
        scope: 'setup-step',
        schemaVersion: 1,
        updatedAt: '2026-08-24T12:00:00.000Z',
        opaquePayload: payload,
    });

    const stale = await application.handle(makeSaveSetupDraftCheckpointRequest(
        'save-stale-draft',
        APP_BUILD_ID,
        initial.workspaceEpoch,
        { expectedVersion: '0', schemaVersion: 1, opaquePayload: '{}' },
    ));
    assert.equal(stale.ok, false);
    if (stale.ok) {
        throw new Error('Expected stale setup draft conflict');
    }
    assert.equal(stale.problem.code, 'conflict');
    await application.close();

    const restarted = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID);
    const restartedBootstrap = await bootstrap(restarted);
    const resumed = await restarted.handle(makeSetupQueryRequest(
        'resume-draft',
        APP_BUILD_ID,
        restartedBootstrap.workspaceEpoch,
    ));
    assert.equal(resumed.ok, true);
    if (!resumed.ok || resumed.value.kind !== 'workspace.setup-projection') {
        throw new Error('Expected resumed setup draft');
    }
    assert.equal(resumed.value.projection.draftCheckpoint?.opaquePayload, payload);
    assert.equal(resumed.value.projection.workspaceRevision, '0');

    const discarded = await restarted.handle(makeDiscardSetupDraftCheckpointRequest(
        'discard-draft',
        APP_BUILD_ID,
        restartedBootstrap.workspaceEpoch,
        '1',
    ));
    assert.equal(discarded.ok, true);
    if (!discarded.ok || discarded.value.kind !== 'workspace.setup-projection') {
        throw new Error('Expected discarded setup draft projection');
    }
    assert.equal(discarded.value.projection.draftCheckpointVersion, '2');
    assert.equal(discarded.value.projection.draftCheckpoint, null);
    assert.equal(discarded.value.projection.workspaceRevision, '0');
    await restarted.close();

    const readOnly = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID, { readOnly: true });
    const readOnlyBootstrap = await bootstrap(readOnly);
    const rejected = await readOnly.handle(makeSaveSetupDraftCheckpointRequest(
        'save-read-only-draft',
        APP_BUILD_ID,
        readOnlyBootstrap.workspaceEpoch,
        { expectedVersion: '2', schemaVersion: 1, opaquePayload: '{}' },
    ));
    assert.equal(rejected.ok, false);
    if (rejected.ok) {
        throw new Error('Expected read-only setup draft rejection');
    }
    assert.equal(rejected.problem.code, 'permission');
    await readOnly.close();
});

test('FLOW-00: setup draft post-COMMIT uncertainty reconciles after Workspace restart', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const payload = JSON.stringify({ schemaVersion: 1, step: 'term' });
    let loseResponse = false;
    const application = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID, {
        clock: { now: () => '2026-08-24T12:00:00.000Z' },
        commitOptions: {
            failpoint(point) {
                if (loseResponse && point === 'commit.after-sqlite-commit') {
                    throw new Error('simulated setup draft response loss');
                }
            },
        },
    });
    const initial = await bootstrap(application);
    await application.handle(makeInitializeWorkspaceRequest(
        'initialize-draft-unknown',
        APP_BUILD_ID,
        initial.workspaceEpoch,
    ));

    loseResponse = true;
    const saved = await application.handle(makeSaveSetupDraftCheckpointRequest(
        'save-draft-unknown',
        APP_BUILD_ID,
        initial.workspaceEpoch,
        { expectedVersion: '0', schemaVersion: 1, opaquePayload: payload },
    ));
    assert.equal(saved.ok, false);
    if (saved.ok) {
        throw new Error('Expected unknown setup draft result');
    }
    assert.equal(saved.problem.code, 'recovery-required');
    assert.equal(saved.problem.dataEffect, 'unknown');
    await application.close();

    const restarted = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID);
    const restartedBootstrap = await bootstrap(restarted);
    const reconciled = await restarted.handle(makeSetupQueryRequest(
        'reconcile-draft-after-restart',
        APP_BUILD_ID,
        restartedBootstrap.workspaceEpoch,
    ));
    assert.equal(reconciled.ok, true);
    if (!reconciled.ok || reconciled.value.kind !== 'workspace.setup-projection') {
        throw new Error('Expected reconciled setup draft projection');
    }
    assert.equal(reconciled.value.projection.draftCheckpointVersion, '1');
    assert.equal(reconciled.value.projection.draftCheckpoint?.opaquePayload, payload);
    await restarted.close();
});

test('FLOW-00: successful setup draft save and discard report unknown when projection refresh fails', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const payload = JSON.stringify({ schemaVersion: 1, step: 'course' });
    let failNextProjectionRead = false;
    const application = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID, {
        clock: { now: () => '2026-08-24T12:00:00.000Z' },
        setupProjectionReadOptions: {
            failpoint() {
                if (failNextProjectionRead) {
                    failNextProjectionRead = false;
                    throw new Error('simulated setup projection refresh failure');
                }
            },
        },
    });
    const initial = await bootstrap(application);
    await application.handle(makeInitializeWorkspaceRequest(
        'initialize-draft-refresh',
        APP_BUILD_ID,
        initial.workspaceEpoch,
    ));

    failNextProjectionRead = true;
    const saved = await application.handle(makeSaveSetupDraftCheckpointRequest(
        'save-before-refresh-failure',
        APP_BUILD_ID,
        initial.workspaceEpoch,
        { expectedVersion: '0', schemaVersion: 1, opaquePayload: payload },
    ));
    assert.equal(saved.ok, false);
    if (saved.ok) {
        throw new Error('Expected unknown save result after projection refresh failure');
    }
    assert.equal(saved.problem.code, 'recovery-required');
    assert.equal(saved.problem.dataEffect, 'unknown');

    const savedProjection = await application.handle(makeSetupQueryRequest(
        'reconcile-saved-draft',
        APP_BUILD_ID,
        initial.workspaceEpoch,
    ));
    assert.equal(savedProjection.ok, true);
    if (!savedProjection.ok || savedProjection.value.kind !== 'workspace.setup-projection') {
        throw new Error('Expected saved checkpoint reconciliation');
    }
    assert.equal(savedProjection.value.projection.draftCheckpointVersion, '1');
    assert.equal(savedProjection.value.projection.draftCheckpoint?.opaquePayload, payload);

    failNextProjectionRead = true;
    const discarded = await application.handle(makeDiscardSetupDraftCheckpointRequest(
        'discard-before-refresh-failure',
        APP_BUILD_ID,
        initial.workspaceEpoch,
        '1',
    ));
    assert.equal(discarded.ok, false);
    if (discarded.ok) {
        throw new Error('Expected unknown discard result after projection refresh failure');
    }
    assert.equal(discarded.problem.code, 'recovery-required');
    assert.equal(discarded.problem.dataEffect, 'unknown');

    const discardedProjection = await application.handle(makeSetupQueryRequest(
        'reconcile-discarded-draft',
        APP_BUILD_ID,
        initial.workspaceEpoch,
    ));
    assert.equal(discardedProjection.ok, true);
    if (!discardedProjection.ok || discardedProjection.value.kind !== 'workspace.setup-projection') {
        throw new Error('Expected discarded checkpoint reconciliation');
    }
    assert.equal(discardedProjection.value.projection.draftCheckpointVersion, '2');
    assert.equal(discardedProjection.value.projection.draftCheckpoint, null);
    await application.close();
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

        const readOnly = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID, {
            readOnly: true,
            clock: {now: () => '2027-01-05T12:00:00.000Z'},
        });
        const readOnlyBootstrap = await bootstrap(readOnly);
        assert.equal(readOnlyBootstrap.workspaceLifecycle.mode, 'read-only');
        assert.equal(readOnlyBootstrap.workspaceLifecycle.route, 'today');
        assert.equal(readOnlyBootstrap.workspaceLifecycle.workspaceRevision, '1');
        assert.equal(readOnlyBootstrap.workspaceLifecycle.capabilities['workspace.read'], 'available');
        assert.equal(readOnlyBootstrap.workspaceLifecycle.capabilities['workspace.write'], 'unavailable');
        const unchanged = await readOnly.handle(makeSetupQueryRequest(
            'query-read-only-ended-term',
            APP_BUILD_ID,
            readOnlyBootstrap.workspaceEpoch,
        ));
        assert.equal(unchanged.ok, true);
        if (!unchanged.ok || unchanged.value.kind !== 'workspace.setup-projection') {
            throw new Error('Expected unchanged read-only setup projection');
        }
        assert.notEqual(unchanged.value.projection.currentTerm, null);
        assert.equal(unchanged.value.projection.workspaceRevision, '1');
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
        assert.equal(recoveryBootstrap.workspaceLifecycle.mode, 'recovery');
        assert.equal(recoveryBootstrap.workspaceLifecycle.route, 'recovery');

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

    await t.test('peripheral unavailable', async (caseTest) => {
        const dataSlotsRoot = createTempDataSlots(caseTest);
        const writable = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID);
        const initial = await bootstrap(writable);
        await writable.handle(makeInitializeWorkspaceRequest(
            'initialize',
            APP_BUILD_ID,
            initial.workspaceEpoch,
        ));
        await writable.close();

        const limited = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID, {
            moduleStatus: {
                library: {health: 'unavailable', capability: 'unavailable'},
            },
        });
        const limitedBootstrap = await bootstrap(limited);
        assert.equal(limitedBootstrap.workspaceLifecycle.mode, 'limited');
        // This case never created a Term, so first setup is still the only route.
        assert.equal(limitedBootstrap.workspaceLifecycle.route, 'setup');
        assert.equal(limitedBootstrap.workspaceLifecycle.moduleHealth['MOD-LIBRARY'], 'unavailable');
        assert.equal(limitedBootstrap.workspaceLifecycle.capabilities['library.read'], 'unavailable');
        assert.equal(limitedBootstrap.workspaceLifecycle.capabilities['plan.write'], 'available');
        await limited.close();
    });
});
