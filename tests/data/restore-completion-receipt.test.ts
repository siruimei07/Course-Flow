/**
 * @file Verifies typed DATA receipts at Restore activation and rollback completion boundaries.
 */

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    initializeWorkspaceData,
    openWorkspaceData,
    type SqliteDataStore,
} from '../../src/data/sqlite-data-store';
import {canonicalJson} from '../../src/shared/canonical-json';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OPERATION_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const SNAPSHOT_ID = '44444444-4444-4444-8444-444444444444';
const SAFETY_SET_ID = '55555555-5555-4555-8555-555555555555';
const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const DIGEST_C = 'c'.repeat(64);

type RestoreCompletionReceiptInput = Readonly<{
    operationId: string;
    restoreSessionId: string;
    outcome: 'succeeded' | 'rolled-back';
    sessionVersion: string;
    sourceSnapshotId: string;
    sourceRootDigest: string;
    sourceSchemaLevel: string;
    postMigrationSchemaLevel: string;
    activeWorkspaceId: string;
    activeRevision: string;
    library: Readonly<{state: 'absent'}>;
    protection: Readonly<{mode: 'required'; safetySetId: string}>;
    planDigest: string;
    precommit: Readonly<{sequence: string; recordDigest: string}>;
    route: 'setup' | 'today';
    receiptFormatVersion: '1';
}>;

type RestoreCompletionReceipt = RestoreCompletionReceiptInput & Readonly<{
    receiptDigest: string;
}>;

type RestoreReceiptStore = Readonly<{
    recordRestoreCompletionReceipt(input: RestoreCompletionReceiptInput): RestoreCompletionReceipt;
    readRestoreCompletionReceipt(operationId: string): RestoreCompletionReceipt | null;
}>;

function receiptStore(store: SqliteDataStore): RestoreReceiptStore {
    return store as unknown as RestoreReceiptStore;
}

function input(overrides: Partial<RestoreCompletionReceiptInput> = {}): RestoreCompletionReceiptInput {
    return Object.freeze({
        operationId: OPERATION_ID,
        restoreSessionId: SESSION_ID,
        outcome: 'succeeded',
        sessionVersion: '3',
        sourceSnapshotId: SNAPSHOT_ID,
        sourceRootDigest: DIGEST_A,
        sourceSchemaLevel: '15',
        postMigrationSchemaLevel: '17',
        activeWorkspaceId: WORKSPACE_ID,
        activeRevision: '0',
        library: Object.freeze({state: 'absent'}),
        protection: Object.freeze({mode: 'required', safetySetId: SAFETY_SET_ID}),
        planDigest: DIGEST_B,
        precommit: Object.freeze({sequence: '7', recordDigest: DIGEST_C}),
        route: 'setup',
        receiptFormatVersion: '1',
        ...overrides,
    });
}

test('TEST-DATA-006: Restore completion receipt is typed, idempotent, and survives reopen', async t => {
    const dataSlotsRoot = mkdtempSync(path.join(tmpdir(), 'courseflow-restore-receipt-'));
    t.after(() => rmSync(dataSlotsRoot, {recursive: true, force: true}));
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const expectedInput = input();
    const receiptDigest = createHash('sha256')
        .update(canonicalJson(expectedInput), 'utf8')
        .digest('hex');

    const first = receiptStore(store).recordRestoreCompletionReceipt(expectedInput);

    assert.deepEqual(first, {...expectedInput, receiptDigest});
    assert.deepEqual(receiptStore(store).recordRestoreCompletionReceipt(expectedInput), first);
    assert.deepEqual(receiptStore(store).readRestoreCompletionReceipt(OPERATION_ID), first);
    assert.throws(
        () => receiptStore(store).recordRestoreCompletionReceipt(input({route: 'today'})),
        /conflict/i,
    );
    assert.throws(
        () => receiptStore(store).recordRestoreCompletionReceipt(input({activeRevision: '1'})),
        /active DATA/i,
    );
    assert.throws(
        () => receiptStore(store).recordRestoreCompletionReceipt(input({sessionVersion: '2'})),
        /invalid/i,
    );
    await store.close();

    const reopened = openWorkspaceData(dataSlotsRoot);
    assert.equal(reopened.kind, 'ready');
    if (reopened.kind !== 'ready') {
        throw new Error('Expected receipt DATA to reopen');
    }
    assert.deepEqual(receiptStore(reopened.store).readRestoreCompletionReceipt(OPERATION_ID), first);
    await reopened.store.close();
});

test('TEST-DATA-006: rollback receipt uses the same path-free schema', async t => {
    const dataSlotsRoot = mkdtempSync(path.join(tmpdir(), 'courseflow-rollback-receipt-'));
    t.after(() => rmSync(dataSlotsRoot, {recursive: true, force: true}));
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);

    const receipt = receiptStore(store).recordRestoreCompletionReceipt(input({
        outcome: 'rolled-back',
        route: 'today',
    }));

    assert.equal(receipt.outcome, 'rolled-back');
    assert.doesNotMatch(JSON.stringify(receipt), /workspace\.sqlite|[A-Za-z]:[\\/]|\/Users\//);
    await store.close();
});
