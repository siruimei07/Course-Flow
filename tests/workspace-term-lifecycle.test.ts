/**
 * @file Verifies Workspace-driven Term lifecycle evaluation through the public boundary.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { openWorkspaceData } from '../src/data/sqlite-data-store';
import { BOOTSTRAP_PROTOCOL_VERSION } from '../src/shared/bootstrap-contract';
import { WorkspaceApplication, type ClockPort } from '../src/workspace-application';
import {
    normalizeCreateTermCommand,
    normalizeUpdateTermEndDateCommand,
} from '../src/shared/workspace-term-contract';
import {
    makeCreateTermRequest,
    makeInitializeWorkspaceRequest,
    makeRestoreTermAsCurrentRequest,
    makeSetupQueryRequest,
    makeUpdateTermEndDateRequest,
} from '../src/shared/workspace-setup-contract';

const APP_BUILD_ID = 'development:1234567890abcdef1234567890abcdef12345678';

class MutableClock implements ClockPort {
    public constructor(private instant: string) {}

    public now(): string {
        return this.instant;
    }

    public set(instant: string): void {
        this.instant = instant;
    }
}

function createTempDataSlots(t: test.TestContext): string {
    const dataSlotsRoot = mkdtempSync(join(tmpdir(), 'courseflow-workspace-lifecycle-'));
    t.after(() => rmSync(dataSlotsRoot, { recursive: true, force: true }));
    return dataSlotsRoot;
}

function createTermCommand() {
    return normalizeCreateTermCommand({
        commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        followUpId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        expectedRevision: '0',
        expectedPlanVersion: '0',
        intent: {
            kind: 'plan.create-term',
            intentSchemaVersion: 1,
            payload: {
                name: 'Fall 2026',
                startDate: '2026-09-08',
                endDate: '2026-12-18',
                timeZone: 'America/Toronto',
            },
        },
    });
}

test('FLOW-00/A-TERM-003/TEST-PLAN-007: Workspace archives only after the TermZone end date', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const clock = new MutableClock('2026-12-19T04:59:59.999Z');
    const application = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID, { clock });
    const initialized = await application.handle({
        kind: 'bootstrap.status',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId: APP_BUILD_ID,
        requestId: 'probe',
        dataRootClass: 'verified-local',
    });
    assert.equal(initialized.ok, true);
    if (!initialized.ok) {
        throw new Error('Expected bootstrap');
    }
    const workspaceEpoch = initialized.value.workspaceEpoch;
    await application.handle(makeInitializeWorkspaceRequest('initialize', APP_BUILD_ID, workspaceEpoch));
    const created = await application.handle(makeCreateTermRequest(
        'create-term',
        APP_BUILD_ID,
        workspaceEpoch,
        createTermCommand(),
    ));
    assert.equal(created.ok, true, JSON.stringify(created));
    if (!created.ok || created.value.kind !== 'workspace.command-outcome') {
        throw new Error('Expected Term command outcome');
    }
    const termId = created.value.outcome.effects[0].entity.id;

    const endDateQuery = await application.handle(makeSetupQueryRequest(
        'end-date-query',
        APP_BUILD_ID,
        workspaceEpoch,
    ));
    assert.equal(endDateQuery.ok, true);
    if (!endDateQuery.ok || endDateQuery.value.kind !== 'workspace.setup-projection') {
        throw new Error('Expected setup projection on end date');
    }
    assert.equal(endDateQuery.value.projection.workspaceRevision, '1');
    assert.equal(endDateQuery.value.projection.currentTerm?.termId, termId);

    clock.set('2026-12-19T05:00:00.000Z');
    const nextDateQuery = await application.handle(makeSetupQueryRequest(
        'next-date-query',
        APP_BUILD_ID,
        workspaceEpoch,
    ));
    assert.equal(nextDateQuery.ok, true);
    if (!nextDateQuery.ok || nextDateQuery.value.kind !== 'workspace.setup-projection') {
        throw new Error('Expected setup projection after lifecycle reconciliation');
    }
    assert.equal(nextDateQuery.value.projection.workspaceRevision, '2');
    assert.equal(nextDateQuery.value.projection.currentTerm, null);
    assert.equal(nextDateQuery.value.projection.terms[0]?.termId, termId);
    assert.equal(nextDateQuery.value.projection.terms[0]?.archived, true);

    const replayedQuery = await application.handle(makeSetupQueryRequest(
        'replayed-query',
        APP_BUILD_ID,
        workspaceEpoch,
    ));
    assert.equal(replayedQuery.ok, true);
    assert.equal(
        replayedQuery.ok
            && replayedQuery.value.kind === 'workspace.setup-projection'
            && replayedQuery.value.projection.workspaceRevision,
        '2',
    );
    await application.close();

    const reopened = openWorkspaceData(dataSlotsRoot);
    assert.equal(reopened.kind, 'ready');
    if (reopened.kind !== 'ready') {
        throw new Error('Expected ready DATA');
    }
    const lifecycleFollowUp = reopened.store.readPendingFollowUps().find(followUp => (
        followUp.originatingCommandId !== createTermCommand().commandId
    ));
    assert.ok(lifecycleFollowUp);
    assert.equal(
        reopened.store.receipt(lifecycleFollowUp.originatingCommandId)?.effects[0].code,
        'plan.term-auto-archived',
    );
    await reopened.store.close();

    const restarted = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID, { clock });
    const restartProbe = await restarted.handle({
        kind: 'bootstrap.status',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId: APP_BUILD_ID,
        requestId: 'restart-probe',
        dataRootClass: 'verified-local',
    });
    assert.equal(restartProbe.ok, true);
    if (!restartProbe.ok) {
        throw new Error('Expected restart bootstrap');
    }
    const restartedProjection = await restarted.handle(makeSetupQueryRequest(
        'restart-query',
        APP_BUILD_ID,
        restartProbe.value.workspaceEpoch,
    ));
    assert.equal(restartedProjection.ok, true);
    assert.equal(
        restartedProjection.ok
            && restartedProjection.value.kind === 'workspace.setup-projection'
            && restartedProjection.value.projection.terms[0]?.termId,
        termId,
    );
    assert.equal(
        restartedProjection.ok
            && restartedProjection.value.kind === 'workspace.setup-projection'
            && restartedProjection.value.projection.terms[0]?.archived,
        true,
    );
    await restarted.close();
});

test('A-TERM-003/Q-CONTINUITY-01: Workspace correction and explicit restore reuse'
    + ' the same Term identity', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const clock = new MutableClock('2026-12-19T05:00:00.000Z');
    const application = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID, { clock });
    const probe = await application.handle({
        kind: 'bootstrap.status',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId: APP_BUILD_ID,
        requestId: 'probe',
        dataRootClass: 'verified-local',
    });
    assert.equal(probe.ok, true);
    if (!probe.ok) {
        throw new Error('Expected bootstrap');
    }
    await application.handle(makeInitializeWorkspaceRequest(
        'initialize',
        APP_BUILD_ID,
        probe.value.workspaceEpoch,
    ));
    const created = await application.handle(makeCreateTermRequest(
        'create-term',
        APP_BUILD_ID,
        probe.value.workspaceEpoch,
        createTermCommand(),
    ));
    assert.equal(created.ok, true);
    if (!created.ok || created.value.kind !== 'workspace.command-outcome') {
        throw new Error('Expected Term command outcome');
    }
    const termId = created.value.outcome.effects[0].entity.id;

    const archived = await application.handle(makeSetupQueryRequest(
        'archive-query',
        APP_BUILD_ID,
        probe.value.workspaceEpoch,
    ));
    assert.equal(archived.ok, true);
    assert.equal(
        archived.ok
            && archived.value.kind === 'workspace.setup-projection'
            && archived.value.projection.terms[0]?.archived,
        true,
    );

    const corrected = await application.handle(makeUpdateTermEndDateRequest(
        'correct-end-date',
        APP_BUILD_ID,
        probe.value.workspaceEpoch,
        normalizeUpdateTermEndDateCommand({
            commandId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            followUpId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            expectedRevision: '2',
            expectedPlanVersion: '2',
            expectedTermVersion: '2',
            intent: {
                kind: 'plan.update-term-end-date',
                intentSchemaVersion: 1,
                payload: { termId, endDate: '2026-12-20' },
            },
        }),
    ));
    assert.equal(corrected.ok, true);
    assert.equal(
        corrected.ok
            && corrected.value.kind === 'workspace.command-outcome'
            && corrected.value.outcome.effects[0]?.code,
        'plan.term-end-date-updated',
    );

    const restoreCommand = {
        commandId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        followUpId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        expectedRevision: '3',
        expectedPlanVersion: '3',
        expectedTermVersion: '3',
        intent: {
            kind: 'plan.restore-term-as-current',
            intentSchemaVersion: 1,
            payload: { termId },
        },
    } as const;
    const restored = await application.handle(makeRestoreTermAsCurrentRequest(
        'restore-term',
        APP_BUILD_ID,
        probe.value.workspaceEpoch,
        restoreCommand,
    ));
    assert.equal(restored.ok, true);
    assert.equal(
        restored.ok
            && restored.value.kind === 'workspace.command-outcome'
            && restored.value.outcome.effects[0]?.code,
        'plan.term-restored-current',
    );

    const projection = await application.handle(makeSetupQueryRequest(
        'restored-query',
        APP_BUILD_ID,
        probe.value.workspaceEpoch,
    ));
    assert.equal(projection.ok, true);
    assert.equal(
        projection.ok
            && projection.value.kind === 'workspace.setup-projection'
            && projection.value.projection.currentTerm?.termId,
        termId,
    );
    assert.equal(
        projection.ok
            && projection.value.kind === 'workspace.setup-projection'
            && projection.value.projection.currentTerm?.endDate,
        '2026-12-20',
    );
    await application.close();

    clock.set('2026-12-22T05:00:00.000Z');
    const restarted = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID, { clock });
    const restartProbe = await restarted.handle({
        kind: 'bootstrap.status',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId: APP_BUILD_ID,
        requestId: 'restart-probe',
        dataRootClass: 'verified-local',
    });
    assert.equal(restartProbe.ok, true);
    if (!restartProbe.ok) {
        throw new Error('Expected restart bootstrap');
    }
    const replayed = await restarted.handle(makeRestoreTermAsCurrentRequest(
        'replay-restore',
        APP_BUILD_ID,
        restartProbe.value.workspaceEpoch,
        restoreCommand,
    ));
    assert.equal(replayed.ok, true);
    assert.equal(
        replayed.ok
            && replayed.value.kind === 'workspace.command-outcome'
            && replayed.value.outcome.revision,
        '4',
    );
    await restarted.close();
});

test('TEST-DATA-005: recovery-required Workspace rejects lifecycle correction without mutation', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    mkdirSync(join(dataSlotsRoot, 'active'));
    const application = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID);
    const probe = await application.handle({
        kind: 'bootstrap.status',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId: APP_BUILD_ID,
        requestId: 'probe',
        dataRootClass: 'verified-local',
    });
    assert.equal(probe.ok, true);
    if (!probe.ok) {
        throw new Error('Expected bootstrap');
    }

    const outcome = await application.handle(makeUpdateTermEndDateRequest(
        'correct-end-date',
        APP_BUILD_ID,
        probe.value.workspaceEpoch,
        normalizeUpdateTermEndDateCommand({
            commandId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            followUpId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            expectedRevision: '0',
            expectedPlanVersion: '0',
            expectedTermVersion: '1',
            intent: {
                kind: 'plan.update-term-end-date',
                intentSchemaVersion: 1,
                payload: {
                    termId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                    endDate: '2026-12-20',
                },
            },
        }),
    ));
    assert.equal(outcome.ok, false);
    assert.equal(!outcome.ok && outcome.problem.code, 'recovery-required');
    assert.equal(!outcome.ok && outcome.problem.dataEffect, 'unchanged');
    assert.deepEqual(readdirSync(dataSlotsRoot), ['active']);
    assert.deepEqual(readdirSync(join(dataSlotsRoot, 'active')), []);
    await application.close();
});
