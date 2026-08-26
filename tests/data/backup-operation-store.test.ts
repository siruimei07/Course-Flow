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
const SECOND_OPERATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SECOND_SNAPSHOT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const THIRD_OPERATION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const THIRD_SNAPSHOT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const CLEANUP_OPERATION_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const FOURTH_COMMAND_ID = '12121212-1212-4212-8212-121212121212';
const FOURTH_FOLLOW_UP_ID = '13131313-1313-4313-8313-131313131313';

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

type BackupCleanupOperation = Readonly<{
    operationId: string;
    backupSetId: string;
    snapshotId: string;
    backupSequence: string;
    rootDigest: string;
    snapshotDirectoryName: string;
    quarantineDirectoryName: string;
    phase: 'planned' | 'quarantined' | 'deleting';
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
    claimBackupCleanupOperation(
        operationId: string,
        snapshotId: string,
    ): BackupCleanupOperation | null;
    releasePlannedBackupCleanup(operationId: string): void;
    readBackupCleanupOperation(): BackupCleanupOperation | null;
    markBackupCleanupQuarantined(operationId: string): BackupCleanupOperation;
    markBackupCleanupDeleting(operationId: string): BackupCleanupOperation;
    completeBackupCleanup(operationId: string): void;
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

/**
 * Completes one DATA-only snapshot record without exercising filesystem publication.
 * @param {BackupOperationStore} store - Configured writable DATA store.
 * @param {object} input - Unique operation facts and deterministic success metadata.
 * @return {BackupOperation} Succeeded durable operation.
 */
function recordSuccessfulBackup(
    store: BackupOperationStore,
    input: Readonly<{
        operationId: string;
        snapshotId: string;
        nonce: string;
        createdAt: string;
        rootDigest: string;
        succeededAt: string;
    }>,
): BackupOperation {
    let operation = store.claimBackupOperation({
        operationId: input.operationId,
        snapshotId: input.snapshotId,
        stagingDirectoryName: `.staging-${input.operationId}-${input.nonce}`,
        createdAt: input.createdAt,
    });
    assert.notEqual(operation, null);
    operation = store.recordBackupCheckpoint(operation!.operationId, operation!.targetRevision);
    for (const [expectedPhase, nextPhase] of [
        ['database-checkpoint', 'library-copy'],
        ['library-copy', 'staging-validation'],
        ['staging-validation', 'publishing'],
        ['publishing', 'published-pending-record'],
    ] as const) {
        operation = store.advanceBackupOperation(operation.operationId, expectedPhase, nextPhase);
    }
    return store.recordBackupSuccess({
        operationId: operation.operationId,
        actualRevision: operation.actualRevision!,
        rootDigest: input.rootDigest,
        succeededAt: input.succeededAt,
    });
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

test('TEST-PROTECT-003: cleanup journal retains two newest successes and resumes after restart', async t => {
    const {dataSlotsRoot, store} = await createConfiguredStore(t);
    recordSuccessfulBackup(store, {
        operationId: OPERATION_ID,
        snapshotId: SNAPSHOT_ID,
        nonce: '0123456789abcdef',
        createdAt: '2026-08-25T12:00:00.000Z',
        rootDigest: ROOT_DIGEST,
        succeededAt: '2026-08-25T12:00:01.000Z',
    });

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
    recordSuccessfulBackup(store, {
        operationId: SECOND_OPERATION_ID,
        snapshotId: SECOND_SNAPSHOT_ID,
        nonce: '1111111111111111',
        createdAt: '2026-08-25T12:00:02.000Z',
        rootDigest: '1'.repeat(64),
        succeededAt: '2026-08-25T12:00:03.000Z',
    });

    const fourth = await store.commit(normalizeRecordSetupDecisionCommand({
        commandId: FOURTH_COMMAND_ID,
        followUpId: FOURTH_FOLLOW_UP_ID,
        workspaceId: WORKSPACE_ID,
        expectedRevision: '3',
        expectedSetupVersion: '2',
        intent: {
            kind: 'workspace.record-setup-decision',
            intentSchemaVersion: 1,
            payload: {decision: 'later'},
        },
    }));
    assert.equal(fourth.ok, true);
    recordSuccessfulBackup(store, {
        operationId: THIRD_OPERATION_ID,
        snapshotId: THIRD_SNAPSHOT_ID,
        nonce: '2222222222222222',
        createdAt: '2026-08-25T12:00:04.000Z',
        rootDigest: '2'.repeat(64),
        succeededAt: '2026-08-25T12:00:05.000Z',
    });

    assert.equal(typeof store.claimBackupCleanupOperation, 'function');
    assert.equal(store.claimBackupCleanupOperation(
        CLEANUP_OPERATION_ID,
        THIRD_SNAPSHOT_ID,
    ), null);
    const firstPlan = store.claimBackupCleanupOperation(CLEANUP_OPERATION_ID, SNAPSHOT_ID);
    store.releasePlannedBackupCleanup(CLEANUP_OPERATION_ID);
    assert.equal(store.readBackupCleanupOperation(), null);
    const planned = store.claimBackupCleanupOperation(CLEANUP_OPERATION_ID, SNAPSHOT_ID);
    assert.deepEqual(planned, firstPlan);
    assert.deepEqual(planned, {
        operationId: CLEANUP_OPERATION_ID,
        backupSetId: BACKUP_SET_ID,
        snapshotId: SNAPSHOT_ID,
        backupSequence: '1',
        rootDigest: ROOT_DIGEST,
        snapshotDirectoryName: `snapshot-${SNAPSHOT_ID}`,
        quarantineDirectoryName: `.quarantine-${CLEANUP_OPERATION_ID}-${SNAPSHOT_ID}`,
        phase: 'planned',
        version: '0',
    });
    const projection = store.readDataProtectionProjection();
    assert.equal('backup' in projection, true);
    if (!('backup' in projection)) {
        throw new Error('Expected configured protection projection');
    }
    assert.equal(projection.backup.cleanup, 'pending');
    assert.deepEqual(
        projection.backup.recentVerifiedSnapshots.map(snapshot => snapshot.snapshotId),
        [THIRD_SNAPSHOT_ID, SECOND_SNAPSHOT_ID],
    );
    await store.close();

    const reopened = openWorkspaceData(dataSlotsRoot);
    assert.equal(reopened.kind, 'ready');
    if (reopened.kind !== 'ready') {
        throw new Error('Expected ready Workspace DATA');
    }
    const resumed = reopened.store as BackupOperationStore;
    assert.deepEqual(resumed.readBackupCleanupOperation(), planned);
    assert.deepEqual(
        resumed.claimBackupCleanupOperation(
            '14141414-1414-4414-8414-141414141414',
            SECOND_SNAPSHOT_ID,
        ),
        planned,
    );
    const quarantined = resumed.markBackupCleanupQuarantined(CLEANUP_OPERATION_ID);
    assert.deepEqual(quarantined, {
        ...planned,
        phase: 'quarantined',
        version: '1',
    });
    assert.deepEqual(resumed.markBackupCleanupDeleting(CLEANUP_OPERATION_ID), {
        ...quarantined,
        phase: 'deleting',
        version: '2',
    });
    resumed.completeBackupCleanup(CLEANUP_OPERATION_ID);
    assert.equal(resumed.readBackupCleanupOperation(), null);
    assert.deepEqual(
        resumed.readSuccessfulBackupSnapshots().map(snapshot => snapshot.snapshotId),
        [SECOND_SNAPSHOT_ID, THIRD_SNAPSHOT_ID],
    );
    const completedProjection = resumed.readDataProtectionProjection();
    assert.equal('backup' in completedProjection, true);
    if (!('backup' in completedProjection)) {
        throw new Error('Expected configured protection projection');
    }
    assert.equal(completedProjection.backup.cleanup, 'idle');
    await resumed.close();
});
