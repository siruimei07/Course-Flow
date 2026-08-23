/**
 * @file Verifies auditable Term lifecycle commits and recovery semantics.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
    initializeWorkspaceData,
    openWorkspaceData,
    type SqliteDataStore,
} from '../../src/data/sqlite-data-store';
import {
    normalizeCreateTermCommand,
    normalizeReconcileWorkspaceLifecycleCommand,
    normalizeRestoreTermAsCurrentCommand,
    normalizeUpdateTermEndDateCommand,
} from '../../src/shared/workspace-term-contract';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const RECONCILE_COMMAND_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const RECONCILE_FOLLOW_UP_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function createTempDataSlots(t: test.TestContext): string {
    const dataSlotsRoot = mkdtempSync(join(tmpdir(), 'courseflow-lifecycle-'));
    t.after(() => rmSync(dataSlotsRoot, { recursive: true, force: true }));
    return dataSlotsRoot;
}

async function createCurrentTerm(store: SqliteDataStore): Promise<string> {
    const result = await store.commit(normalizeCreateTermCommand({
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
    }));
    assert.equal(result.ok, true);
    if (!result.ok) {
        throw new Error('Expected Current Term');
    }
    return result.value.effects[0].entity.id;
}

function makeReconcileCommand(termId: string, options: Readonly<{
    applicableDate?: string;
    evaluatedAt?: string;
}> = {}) {
    return normalizeReconcileWorkspaceLifecycleCommand({
        commandId: RECONCILE_COMMAND_ID,
        followUpId: RECONCILE_FOLLOW_UP_ID,
        expectedRevision: '1',
        expectedPlanVersion: '1',
        expectedTermVersion: '1',
        intent: {
            kind: 'workspace.reconcile-lifecycle',
            intentSchemaVersion: 1,
            payload: {
                termId,
                evaluation: {
                    evaluatedAt: options.evaluatedAt ?? '2026-12-19T05:00:00.000Z',
                    termZone: 'America/Toronto',
                    applicableDate: options.applicableDate ?? '2026-12-19',
                },
            },
        },
    });
}

test('A-TERM-003/TEST-PLAN-007: end date itself does not archive or advance revision', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const termId = await createCurrentTerm(store);
    const command = makeReconcileCommand(termId, {
        applicableDate: '2026-12-18',
        evaluatedAt: '2026-12-18T17:00:00.000Z',
    });

    await assert.rejects(store.commit(command), TypeError);

    const projection = store.readSetupProjection();
    assert.equal(projection.workspaceRevision, '1');
    assert.equal(projection.currentTerm?.termId, termId);
    assert.equal(projection.currentTerm?.archived, false);
    assert.equal(store.receipt(RECONCILE_COMMAND_ID), null);
    await store.close();
});

test('A-TERM-003/TEST-PLAN-007: next TermZone date archives through a durable Intent without deletion', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const termId = await createCurrentTerm(store);

    const committed = await store.commit(makeReconcileCommand(termId));

    assert.equal(committed.ok, true);
    if (!committed.ok) {
        throw new Error('Expected lifecycle commit');
    }
    assert.equal(committed.value.revision, '2');
    assert.equal(committed.value.effects[0].code, 'plan.term-auto-archived');
    assert.equal(committed.value.effects[0].entity.id, termId);
    const projection = store.readSetupProjection();
    assert.equal(projection.currentTerm, null);
    assert.equal(projection.terms.length, 1);
    assert.equal(projection.terms[0]?.termId, termId);
    assert.equal(projection.terms[0]?.archived, true);
    assert.equal(store.readPendingFollowUps()[1]?.originatingCommandId, RECONCILE_COMMAND_ID);
    await store.close();
});

test('A-TERM-003/Q-CONTINUITY-01: corrected end date can explicitly restore the same Term after reopen', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const termId = await createCurrentTerm(store);
    await store.commit(makeReconcileCommand(termId));
    const updated = await store.commit(normalizeUpdateTermEndDateCommand({
        commandId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        followUpId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        expectedRevision: '2',
        expectedPlanVersion: '2',
        expectedTermVersion: '2',
        intent: {
            kind: 'plan.update-term-end-date',
            intentSchemaVersion: 1,
            payload: { termId, endDate: '2026-12-20' },
        },
    }));
    assert.equal(updated.ok, true);
    const restored = await store.commit(normalizeRestoreTermAsCurrentCommand({
        commandId: '12121212-1212-4212-8212-121212121212',
        followUpId: '34343434-3434-4434-8434-343434343434',
        expectedRevision: '3',
        expectedPlanVersion: '3',
        expectedTermVersion: '3',
        evaluation: {
            evaluatedAt: '2026-12-19T17:00:00.000Z',
            termZone: 'America/Toronto',
            applicableDate: '2026-12-19',
        },
        intent: {
            kind: 'plan.restore-term-as-current',
            intentSchemaVersion: 1,
            payload: { termId },
        },
    }));
    assert.equal(restored.ok, true);
    assert.equal(restored.ok && restored.value.effects[0].code, 'plan.term-restored-current');
    await store.close();

    const reopened = openWorkspaceData(dataSlotsRoot);
    assert.equal(reopened.kind, 'ready');
    if (reopened.kind !== 'ready') {
        throw new Error('Expected ready DATA');
    }
    const projection = reopened.store.readSetupProjection();
    assert.equal(projection.workspaceRevision, '4');
    assert.equal(projection.currentTerm?.termId, termId);
    assert.equal(projection.currentTerm?.endDate, '2026-12-20');
    assert.equal(projection.currentTerm?.archived, false);
    assert.equal(projection.currentTerm?.entityVersion, '4');
    await reopened.store.close();
});

test('FLOW-01/TEST-DATA-001: lifecycle pre-COMMIT failure leaves every fact and receipt unchanged', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const termId = await createCurrentTerm(store);

    await assert.rejects(store.commit(makeReconcileCommand(termId), {
        failpoint(point) {
            if (point === 'commit.after-facts') {
                throw new Error('injected pre-COMMIT failure');
            }
        },
    }));

    assert.equal(store.readSetupProjection().workspaceRevision, '1');
    assert.equal(store.readSetupProjection().currentTerm?.termId, termId);
    assert.equal(store.receipt(RECONCILE_COMMAND_ID), null);
    assert.equal(store.readProtectionWatermark(), '1');
    await store.close();
});

test('FLOW-01/TEST-DATA-002/004: lifecycle post-COMMIT loss converges and replays idempotently', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const termId = await createCurrentTerm(store);
    const command = makeReconcileCommand(termId);

    await assert.rejects(store.commit(command, {
        failpoint(point) {
            if (point === 'commit.after-sqlite-commit') {
                throw new Error('response lost');
            }
        },
    }));
    await store.close();

    const reopened = openWorkspaceData(dataSlotsRoot);
    assert.equal(reopened.kind, 'ready');
    if (reopened.kind !== 'ready') {
        throw new Error('Expected ready DATA');
    }
    const receipt = reopened.store.receipt(RECONCILE_COMMAND_ID);
    assert.equal(receipt?.effects[0].code, 'plan.term-auto-archived');
    assert.deepEqual(await reopened.store.commit(command), { ok: true, value: receipt });
    assert.equal(reopened.store.readSetupProjection().workspaceRevision, '2');
    await reopened.store.close();
});

test('TEST-DATA-005: read-only DATA rejects lifecycle writes and preserves Current Term', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const writable = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const termId = await createCurrentTerm(writable);
    await writable.close();
    const opened = openWorkspaceData(dataSlotsRoot, { readOnly: true });
    assert.equal(opened.kind, 'read-only');
    if (opened.kind !== 'read-only') {
        throw new Error('Expected read-only DATA');
    }

    const result = await opened.store.commit(makeReconcileCommand(termId));

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.problem.code, 'permission');
    assert.equal(opened.store.readSetupProjection().currentTerm?.termId, termId);
    assert.equal(opened.store.readSetupProjection().workspaceRevision, '1');
    await opened.store.close();
});
