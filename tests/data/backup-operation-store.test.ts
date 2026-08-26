/**
 * @file Verifies durable backup work, watermark merging, and success registration in DATA.
 */

import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    initializeWorkspaceData,
    openWorkspaceData,
    type SqliteDataStore,
} from '../../src/data/sqlite-data-store';
import {
    BACKUP_REPOSITORY_SCHEMA,
    normalizeAcceptedConfigureBackupDestinationCommand,
} from '../../src/shared/workspace-protection-contract';
import {normalizeRecordSetupDecisionCommand} from '../../src/shared/workspace-data-contract';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const BACKUP_SET_ID = '22222222-2222-4222-8222-222222222222';
const CONFIGURE_COMMAND_ID = '33333333-3333-4333-8333-333333333333';
const CONFIGURE_FOLLOW_UP_ID = '44444444-4444-4444-8444-444444444444';
const SECOND_COMMAND_ID = '55555555-5555-4555-8555-555555555555';
const SECOND_FOLLOW_UP_ID = '66666666-6666-4666-8666-666666666666';
const THIRD_COMMAND_ID = '77777777-7777-4777-8777-777777777777';
const THIRD_FOLLOW_UP_ID = '88888888-8888-4888-8888-888888888888';
const OPERATION_ID = '99999999-9999-4999-8999-999999999999';
const SNAPSHOT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CREATED_AT = '2026-08-25T12:00:00.000Z';
const ROOT_DIGEST = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const STAGING_DIRECTORY_NAME = `.staging-${OPERATION_ID}-0123456789abcdef`;

type BackupOperation = Readonly<{
    operationId: string;
    backupSetId: string;
    backupSequence: string;
    snapshotId: string;
    targetRevision: string;
    actualRevision: string | null;
    stagingDirectoryName: string;
    createdAt: string;
    phase:
        | 'queued'
        | 'database-checkpoint'
        | 'library-copy'
        | 'staging-validation'
        | 'publishing'
        | 'published-pending-record'
        | 'succeeded';
    version: string;
}>;

type BackupOperationStore = SqliteDataStore & Readonly<{
    claimBackupOperation(input: Readonly<{
        operationId: string;
        snapshotId: string;
        stagingDirectoryName: string;
        createdAt: string;
    }>): BackupOperation | null;
    readBackupOperation(): BackupOperation | null;
    recordBackupCheckpoint(operationId: string, actualRevision: string): BackupOperation;
    advanceBackupOperation(
        operationId: string,
        expectedPhase: BackupOperation['phase'],
        nextPhase: BackupOperation['phase'],
    ): BackupOperation;
    recordBackupSuccess(input: Readonly<{
        operationId: string;
        actualRevision: string;
        rootDigest: string;
        succeededAt: string;
    }>): BackupOperation;
    readProtectionWatermarks(): Readonly<{
        neededThrough: string;
        succeededThrough: string;
    }>;
    readSuccessfulBackupSnapshots(): readonly Readonly<{
        snapshotId: string;
        backupSetId: string;
        backupSequence: string;
        actualRevision: string;
        rootDigest: string;
        succeededAt: string;
    }>[];
}>;

/**
 * Allocates and later removes one isolated test directory.
 * @param {test.TestContext} t - Owning test context.
 * @param {string} prefix - Temporary directory prefix.
 * @return {string} Created directory path.
 */
function createTempDirectory(t: test.TestContext, prefix: string): string {
    const directory = mkdtempSync(path.join(tmpdir(), prefix));
    t.after(() => rmSync(directory, {recursive: true, force: true}));
    return directory;
}

/**
 * Creates DATA with one configured destination and two pending revisions.
 * @param {test.TestContext} t - Owning test context.
 * @return {Promise<object>} Data root and configured store.
 */
async function createConfiguredStore(
    t: test.TestContext,
): Promise<Readonly<{dataSlotsRoot: string; store: BackupOperationStore}>> {
    const dataSlotsRoot = createTempDirectory(t, 'courseflow-backup-operation-data-');
    const destination = createTempDirectory(t, 'courseflow-backup-operation-destination-');
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID) as BackupOperationStore;
    const configured = await store.commit(normalizeAcceptedConfigureBackupDestinationCommand({
        commandId: CONFIGURE_COMMAND_ID,
        followUpId: CONFIGURE_FOLLOW_UP_ID,
        workspaceId: WORKSPACE_ID,
        expectedRevision: '0',
        expectedProtectionVersion: '0',
        intent: {
            kind: 'protect.configure-backup-destination',
            intentSchemaVersion: 1,
            payload: {},
        },
        destination: {
            backupSetId: BACKUP_SET_ID,
            canonicalPath: destination,
            displayName: path.basename(destination),
            repositorySchema: BACKUP_REPOSITORY_SCHEMA,
        },
    }));
    assert.equal(configured.ok, true);
    const second = await store.commit(normalizeRecordSetupDecisionCommand({
        commandId: SECOND_COMMAND_ID,
        followUpId: SECOND_FOLLOW_UP_ID,
        workspaceId: WORKSPACE_ID,
        expectedRevision: '1',
        expectedSetupVersion: '0',
        intent: {
            kind: 'workspace.record-setup-decision',
            intentSchemaVersion: 1,
            payload: {decision: 'later'},
        },
    }));
    assert.equal(second.ok, true);
    return {dataSlotsRoot, store};
}

/**
 * Claims the deterministic operation used throughout DATA protocol tests.
 * @param {BackupOperationStore} store - Configured writable DATA store.
 * @return {BackupOperation} Claimed or idempotently resumed operation.
 */
function claim(store: BackupOperationStore): BackupOperation {
    assert.equal(typeof store.claimBackupOperation, 'function');
    const operation = store.claimBackupOperation({
        operationId: OPERATION_ID,
        snapshotId: SNAPSHOT_ID,
        stagingDirectoryName: STAGING_DIRECTORY_NAME,
        createdAt: CREATED_AT,
    });
    assert.notEqual(operation, null);
    return operation!;
}

test('TEST-PROTECT-002: claim merges the durable watermark and survives restart', async t => {
    const {dataSlotsRoot, store} = await createConfiguredStore(t);
    const operation = claim(store);

    assert.deepEqual(operation, {
        operationId: OPERATION_ID,
        backupSetId: BACKUP_SET_ID,
        backupSequence: '1',
        snapshotId: SNAPSHOT_ID,
        targetRevision: '2',
        actualRevision: null,
        stagingDirectoryName: STAGING_DIRECTORY_NAME,
        createdAt: CREATED_AT,
        phase: 'queued',
        version: '0',
    });
    assert.deepEqual(claim(store), operation);
    await store.close();

    const reopened = openWorkspaceData(dataSlotsRoot);
    assert.equal(reopened.kind, 'ready');
    if (reopened.kind !== 'ready') {
        throw new Error('Expected ready Workspace DATA');
    }
    const resumed = reopened.store as BackupOperationStore;
    assert.equal(typeof resumed.readBackupOperation, 'function');
    assert.deepEqual(resumed.readBackupOperation(), operation);
    await resumed.close();
});

test('TEST-PROTECT-002: claim rejects a staging name outside its exact operation identity', async t => {
    const {store} = await createConfiguredStore(t);

    assert.throws(() => store.claimBackupOperation({
        operationId: OPERATION_ID,
        snapshotId: SNAPSHOT_ID,
        stagingDirectoryName: `.staging-${OPERATION_ID}-0123456789abcdeg`,
        createdAt: CREATED_AT,
    }), /Backup operation claim is invalid/);
    assert.equal(store.readBackupOperation(), null);
    await store.close();
});

test('TEST-PROTECT-002: actual revision succeeds once and preserves a higher pending watermark', async t => {
    const {dataSlotsRoot, store} = await createConfiguredStore(t);
    let operation = claim(store);
    assert.equal(typeof store.recordBackupCheckpoint, 'function');
    operation = store.recordBackupCheckpoint(operation.operationId, '2');
    assert.equal(operation.phase, 'database-checkpoint');
    assert.equal(operation.actualRevision, '2');

    for (const [expectedPhase, nextPhase] of [
        ['database-checkpoint', 'library-copy'],
        ['library-copy', 'staging-validation'],
        ['staging-validation', 'publishing'],
        ['publishing', 'published-pending-record'],
    ] as const) {
        operation = store.advanceBackupOperation(operation.operationId, expectedPhase, nextPhase);
    }

    const third = await store.commit(normalizeRecordSetupDecisionCommand({
        commandId: THIRD_COMMAND_ID,
        followUpId: THIRD_FOLLOW_UP_ID,
        workspaceId: WORKSPACE_ID,
        expectedRevision: '2',
        expectedSetupVersion: '1',
        intent: {
            kind: 'workspace.record-setup-decision',
            intentSchemaVersion: 1,
            payload: {decision: 'skip'},
        },
    }));
    assert.equal(third.ok, true);
    assert.deepEqual(store.readProtectionWatermarks(), {
        neededThrough: '3',
        succeededThrough: '0',
    });

    const succeeded = store.recordBackupSuccess({
        operationId: operation.operationId,
        actualRevision: '2',
        rootDigest: ROOT_DIGEST,
        succeededAt: '2026-08-25T12:00:01.000Z',
    });
    assert.equal(succeeded.phase, 'succeeded');
    assert.deepEqual(store.readProtectionWatermarks(), {
        neededThrough: '3',
        succeededThrough: '2',
    });
    assert.deepEqual(store.readPendingFollowUps().map(followUp => followUp.followUpId), [
        THIRD_FOLLOW_UP_ID,
    ]);
    assert.deepEqual(store.readSuccessfulBackupSnapshots(), [{
        snapshotId: SNAPSHOT_ID,
        backupSetId: BACKUP_SET_ID,
        backupSequence: '1',
        actualRevision: '2',
        rootDigest: ROOT_DIGEST,
        succeededAt: '2026-08-25T12:00:01.000Z',
    }]);
    assert.deepEqual(store.recordBackupSuccess({
        operationId: operation.operationId,
        actualRevision: '2',
        rootDigest: ROOT_DIGEST,
        succeededAt: '2026-08-25T12:00:01.000Z',
    }), succeeded);
    await store.close();

    const reopened = openWorkspaceData(dataSlotsRoot);
    assert.equal(reopened.kind, 'ready');
    if (reopened.kind !== 'ready') {
        throw new Error('Expected ready Workspace DATA');
    }
    const resumed = reopened.store as BackupOperationStore;
    assert.deepEqual(resumed.readProtectionWatermarks(), {
        neededThrough: '3',
        succeededThrough: '2',
    });
    assert.equal(resumed.readBackupOperation()?.phase, 'succeeded');
    assert.deepEqual(resumed.readPendingFollowUps().map(followUp => followUp.followUpId), [
        THIRD_FOLLOW_UP_ID,
    ]);
    await resumed.close();
});
