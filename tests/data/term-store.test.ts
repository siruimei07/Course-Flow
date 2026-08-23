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
    type CreateTermCommand,
} from '../../src/shared/workspace-term-contract';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const COMMAND_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FOLLOW_UP_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function createTempDataSlots(t: test.TestContext): string {
    const dataSlotsRoot = mkdtempSync(join(tmpdir(), 'courseflow-term-'));
    t.after(() => rmSync(dataSlotsRoot, { recursive: true, force: true }));
    return dataSlotsRoot;
}

function makeCommand(overrides: Record<string, unknown> = {}): CreateTermCommand {
    return normalizeCreateTermCommand({
        commandId: COMMAND_ID,
        followUpId: FOLLOW_UP_ID,
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
        ...overrides,
    });
}

function requireReady(dataSlotsRoot: string): SqliteDataStore {
    const opened = openWorkspaceData(dataSlotsRoot);
    assert.equal(opened.kind, 'ready');
    if (opened.kind !== 'ready') {
        throw new Error('Expected ready workspace data');
    }
    return opened.store;
}

test('A-TERM-001/002: a valid Term is atomically created as the unique Current Term', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);

    const result = await store.commit(makeCommand());

    assert.equal(result.ok, true);
    if (!result.ok) {
        throw new Error('Expected committed CreateTerm');
    }
    assert.equal(result.value.kind, 'committed');
    assert.equal(result.value.revision, '1');
    assert.equal(result.value.effects[0]?.code, 'plan.term-created-current');
    const termId = result.value.effects[0]?.entity.id;
    assert.match(termId ?? '', /^[0-9a-f-]{36}$/);
    assert.deepEqual(store.readSetupProjection(), {
        workspaceRevision: '1',
        planEntityVersion: '1',
        currentTerm: {
            termId,
            name: 'Fall 2026',
            startDate: '2026-09-08',
            endDate: '2026-12-18',
            timeZone: 'America/Toronto',
            entityVersion: '1',
        },
        terms: [{
            termId,
            name: 'Fall 2026',
            startDate: '2026-09-08',
            endDate: '2026-12-18',
            timeZone: 'America/Toronto',
            entityVersion: '1',
        }],
    });
    await store.close();
});

test('A-TERM-002/Q-CONTINUITY-01: TermId and Current Term survive DATA reopen', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const result = await store.commit(makeCommand());
    assert.equal(result.ok, true);
    if (!result.ok) {
        throw new Error('Expected committed CreateTerm');
    }
    const termId = result.value.effects[0]!.entity.id;
    await store.close();

    const reopened = requireReady(dataSlotsRoot);
    assert.equal(reopened.readSetupProjection().currentTerm?.termId, termId);
    assert.equal(reopened.readSetupProjection().workspaceRevision, '1');
    await reopened.close();
});

test('TEST-DATA-002: matching CommandId replays while different semantics conflict', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const command = makeCommand();
    const committed = await store.commit(command);

    assert.deepEqual(await store.commit(command), committed);
    const conflicting = await store.commit(makeCommand({
        intent: {
            ...command.intent,
            payload: { ...command.intent.payload, name: 'Changed meaning' },
        },
    }));
    assert.equal(conflicting.ok, false);
    if (conflicting.ok) {
        throw new Error('Expected command-id conflict');
    }
    assert.equal(conflicting.problem.details.reason, 'command-id-reused');
    assert.equal(store.readSetupProjection().workspaceRevision, '1');
    assert.equal(store.readSetupProjection().terms.length, 1);
    await store.close();
});

test('TEST-PLAN-001: creating another Term moves the single Current Term without deleting history', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const first = await store.commit(makeCommand());
    assert.equal(first.ok, true);
    if (!first.ok) {
        throw new Error('Expected first committed CreateTerm');
    }

    const secondCommand = makeCommand({
        commandId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        followUpId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        expectedRevision: '1',
        expectedPlanVersion: '1',
        intent: {
            kind: 'plan.create-term',
            intentSchemaVersion: 1,
            payload: {
                name: 'Winter 2027',
                startDate: '2027-01-11',
                endDate: '2027-04-23',
                timeZone: 'America/Toronto',
            },
        },
    });
    const second = await store.commit(secondCommand);
    assert.equal(second.ok, true);
    if (!second.ok) {
        throw new Error('Expected second committed CreateTerm');
    }

    const projection = store.readSetupProjection();
    assert.equal(projection.terms.length, 2);
    assert.equal(projection.currentTerm?.termId, second.value.effects[0]!.entity.id);
    assert.notEqual(projection.currentTerm?.termId, first.value.effects[0]!.entity.id);
    await store.close();
});

test('TEST-DATA-001: a pre-COMMIT failure leaves no Term, Current Term, receipt, or revision', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);

    await assert.rejects(store.commit(makeCommand(), {
        failpoint(point) {
            if (point === 'commit.after-facts') {
                throw new Error('injected pre-COMMIT failure');
            }
        },
    }));

    assert.deepEqual(store.readSetupProjection(), {
        workspaceRevision: '0',
        planEntityVersion: '0',
        currentTerm: null,
        terms: [],
    });
    assert.equal(store.receipt(COMMAND_ID), null);
    assert.equal(store.readProtectionWatermark(), '0');
    await store.close();
});

test('TEST-PLAN-001/007: invalid Term input never enters a DATA transaction or changes revision', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const command = makeCommand();

    assert.throws(() => store.commit({
        ...command,
        intent: {
            ...command.intent,
            payload: { ...command.intent.payload, endDate: '2026-09-07' },
        },
    } as CreateTermCommand), TypeError);
    assert.deepEqual(store.readSetupProjection(), {
        workspaceRevision: '0',
        planEntityVersion: '0',
        currentTerm: null,
        terms: [],
    });
    assert.equal(store.receipt(COMMAND_ID), null);
    await store.close();
});

test('TEST-DATA-004: a post-COMMIT response loss converges through receipt after reopen', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);

    await assert.rejects(store.commit(makeCommand(), {
        failpoint(point) {
            if (point === 'commit.after-sqlite-commit') {
                throw new Error('response lost');
            }
        },
    }));
    await store.close();

    const reopened = requireReady(dataSlotsRoot);
    const receipt = reopened.receipt(COMMAND_ID);
    assert.equal(receipt?.revision, '1');
    assert.equal(receipt?.effects[0]?.code, 'plan.term-created-current');
    assert.equal(reopened.readSetupProjection().currentTerm?.termId, receipt?.effects[0]?.entity.id);
    assert.deepEqual(await reopened.commit(makeCommand()), { ok: true, value: receipt });
    await reopened.close();
});

test('TEST-DATA-005: read-only DATA rejects CreateTerm without claiming success', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const initialized = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    await initialized.close();
    const opened = openWorkspaceData(dataSlotsRoot, { readOnly: true });
    assert.equal(opened.kind, 'read-only');
    if (opened.kind !== 'read-only') {
        throw new Error('Expected read-only workspace data');
    }

    const result = await opened.store.commit(makeCommand());
    assert.equal(result.ok, false);
    if (result.ok) {
        throw new Error('Expected read-only rejection');
    }
    assert.equal(result.problem.code, 'permission');
    assert.equal(result.problem.dataEffect, 'unchanged');
    assert.equal(opened.store.readSetupProjection().currentTerm, null);
    await opened.store.close();
});

test('Q-CONSIST-01: setup and Current Term come from one revision snapshot', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const pending = store.commit(makeCommand());
    let crossedSnapshotSeam = false;

    const beforeCommit = store.readSetupProjection({
        failpoint(point) {
            crossedSnapshotSeam = point === 'read.after-revision';
        },
    });

    assert.equal(crossedSnapshotSeam, true);
    assert.deepEqual(beforeCommit, {
        workspaceRevision: '0',
        planEntityVersion: '0',
        currentTerm: null,
        terms: [],
    });
    assert.equal((await pending).ok, true);
    const afterCommit = store.readSetupProjection();
    assert.equal(afterCommit.workspaceRevision, '1');
    assert.notEqual(afterCommit.currentTerm, null);
    await store.close();
});
