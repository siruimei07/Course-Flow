import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { WorkspaceApplication } from '../src/workspace-application';
import { makeBootstrapRequest } from '../src/shared/bootstrap-contract';
import {
    makeCreateTermRequest,
    makeInitializeWorkspaceRequest,
    makeSetupQueryRequest,
} from '../src/shared/workspace-setup-contract';

const APP_BUILD_ID = 'test-build';
const COMMAND_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FOLLOW_UP_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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

test('FLOW-00/01: setup initializes DATA, creates Current Term, and returns one ReadSnapshot', async (t) => {
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

    const after = await application.handle(makeSetupQueryRequest(
        'setup-after',
        APP_BUILD_ID,
        initial.workspaceEpoch,
    ));
    assert.equal(after.ok, true);
    if (!after.ok || after.value.kind !== 'workspace.setup-projection') {
        throw new Error('Expected setup projection');
    }
    assert.equal(after.value.projection.workspaceRevision, committed.value.outcome.revision);
    assert.equal(
        after.value.projection.currentTerm?.termId,
        committed.value.outcome.effects[0]?.entity.id,
    );
    assert.doesNotMatch(
        JSON.stringify(after),
        /workspace\.sqlite|DataSlots|[A-Za-z]:[\\/]|\/Users\//,
    );
    await application.close();
});

test('FLOW-00/Q-CONTINUITY-01: Workspace restart reads the same Current Term identity', async (t) => {
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
    await restarted.close();
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
        await writable.close();

        const readOnly = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID, { readOnly: true });
        const readOnlyBootstrap = await bootstrap(readOnly);
        const outcome = await readOnly.handle(makeCreateTermRequest(
            'create-read-only',
            APP_BUILD_ID,
            readOnlyBootstrap.workspaceEpoch,
            createCommand(),
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

        const outcome = await recovery.handle(makeCreateTermRequest(
            'create-recovery',
            APP_BUILD_ID,
            recoveryBootstrap.workspaceEpoch,
            createCommand(),
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
