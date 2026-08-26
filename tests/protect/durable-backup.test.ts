/**
 * @file Verifies FLOW-04 publication, failpoint recovery, and actual-revision convergence.
 */

import assert from 'node:assert/strict';
import {
    existsSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';

import * as durableBackup from '../../src/protect/durable-backup';
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
const OPERATION_ID = '77777777-7777-4777-8777-777777777777';
const SNAPSHOT_ID = '88888888-8888-4888-8888-888888888888';
const CREATED_AT = '2026-08-25T12:00:00.000Z';
const SUCCEEDED_AT = '2026-08-25T12:00:01.000Z';

const EXPECTED_FAILPOINTS = [
    'backup.after-claim',
    'backup.after-repository-marker-write',
    'backup.after-repository-publish',
    'backup.after-staging-create',
    'backup.after-database-temp-write',
    'backup.after-database-member-publish',
    'backup.after-database-checkpoint',
    'backup.after-library-copy',
    'backup.after-manifest-write',
    'backup.after-staging-validation',
    'backup.after-publishing',
    'backup.after-atomic-publish',
    'backup.after-published-pending-record',
    'backup.after-final-validation',
    'backup.after-success-record',
] as const;

type BackupFailpoint = typeof EXPECTED_FAILPOINTS[number];
type DurableBackupModule = Readonly<{
    BACKUP_FAILPOINTS: readonly BackupFailpoint[];
    runDurableBackupPass(
        store: SqliteDataStore,
        options?: Readonly<{
            clock?: Readonly<{now(): string}>;
            identityFactory?: () => Readonly<{
                operationId: string;
                snapshotId: string;
                nonce: string;
            }>;
            failpoint?: (point: BackupFailpoint) => void;
        }>,
    ): Promise<void>;
    DurableBackupCoordinator: new (
        store: SqliteDataStore,
        options?: Parameters<DurableBackupModule['runDurableBackupPass']>[1],
    ) => Readonly<{
        wake(): void;
        waitForIdle(): Promise<void>;
        close(): Promise<void>;
    }>;
}>;

/**
 * Narrows the implementation module to the TDD contract under construction.
 * @return {DurableBackupModule} Typed durable backup exports.
 */
function loadDurableBackup(): DurableBackupModule {
    return durableBackup as unknown as DurableBackupModule;
}

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
 * Creates one configured DATA store with a durable pending follow-up.
 * @param {test.TestContext} t - Owning test context.
 * @return {Promise<object>} Data root, destination, and writable store.
 */
async function createConfiguredStore(t: test.TestContext): Promise<Readonly<{
    dataSlotsRoot: string;
    destination: string;
    store: SqliteDataStore;
}>> {
    const dataSlotsRoot = createTempDirectory(t, 'courseflow-flow04-data-');
    const destination = createTempDirectory(t, 'courseflow-flow04-destination-');
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const result = await store.commit(normalizeAcceptedConfigureBackupDestinationCommand({
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
    assert.equal(result.ok, true);
    return {dataSlotsRoot, destination, store};
}

/**
 * Builds deterministic identities, timestamps, and an optional injected boundary.
 * @param {function(BackupFailpoint): void} failpoint - Optional failure callback.
 * @return {object} Deterministic durable pass options.
 */
function runOptions(failpoint?: (point: BackupFailpoint) => void) {
    let clockCall = 0;
    return {
        clock: {
            now(): string {
                clockCall += 1;
                return clockCall === 1 ? CREATED_AT : SUCCEEDED_AT;
            },
        },
        identityFactory: () => ({
            operationId: OPERATION_ID,
            snapshotId: SNAPSHOT_ID,
            nonce: '0123456789abcdef',
        }),
        failpoint,
    };
}

/**
 * Derives the deterministic BackupSet test directory.
 * @param {string} destination - Selected destination root.
 * @return {string} BackupSet directory path.
 */
function backupSetDirectory(destination: string): string {
    return path.join(destination, 'CourseFlow', WORKSPACE_ID, BACKUP_SET_ID);
}

/**
 * Derives the deterministic final snapshot test directory.
 * @param {string} destination - Selected destination root.
 * @return {string} Final snapshot directory path.
 */
function finalSnapshotDirectory(destination: string): string {
    return path.join(backupSetDirectory(destination), `snapshot-${SNAPSHOT_ID}`);
}

test('TEST-PROTECT-002/FLOW-04: publishes one canonical immutable snapshot and records success', async t => {
    assert.doesNotThrow(loadDurableBackup);
    const {runDurableBackupPass} = loadDurableBackup();
    const {destination, store} = await createConfiguredStore(t);

    await runDurableBackupPass(store, runOptions());

    const finalDirectory = finalSnapshotDirectory(destination);
    assert.deepEqual(readdirSync(finalDirectory).sort(), ['manifest.json', 'workspace.sqlite']);
    const manifestBytes = readFileSync(path.join(finalDirectory, 'manifest.json'));
    assert.equal(manifestBytes.toString('utf8').endsWith('\n'), false);
    const manifest = JSON.parse(manifestBytes.toString('utf8')) as {
        snapshotId: string;
        database: {actualRevision: string};
        digest: {value: string};
    };
    assert.equal(manifest.snapshotId, SNAPSHOT_ID);
    assert.equal(manifest.database.actualRevision, '1');
    assert.match(manifest.digest.value, /^[0-9a-f]{64}$/);
    assert.deepEqual(store.readProtectionWatermarks(), {
        neededThrough: '1',
        succeededThrough: '1',
    });
    assert.equal(store.readPendingFollowUps().length, 0);
    assert.equal(store.readSuccessfulBackupSnapshots().length, 1);
    const originalManifest = Buffer.from(manifestBytes);

    await runDurableBackupPass(store, runOptions());
    assert.deepEqual(readFileSync(path.join(finalDirectory, 'manifest.json')), originalManifest);
    assert.deepEqual(readdirSync(backupSetDirectory(destination)), [`snapshot-${SNAPSHOT_ID}`]);
    await store.close();
});

test('TEST-PROTECT-002: every durable publication failpoint converges after restart', async t => {
    assert.deepEqual(loadDurableBackup().BACKUP_FAILPOINTS, EXPECTED_FAILPOINTS);
    for (const failpoint of EXPECTED_FAILPOINTS) {
        await t.test(failpoint, async () => {
            const {dataSlotsRoot, destination, store} = await createConfiguredStore(t);
            let injected = false;
            await assert.rejects(
                loadDurableBackup().runDurableBackupPass(store, runOptions(point => {
                    if (point === failpoint && !injected) {
                        injected = true;
                        throw new Error(`injected ${point}`);
                    }
                })),
                new RegExp(`injected ${failpoint.replaceAll('.', '\\.')}`),
            );
            assert.equal(store.status().revision, '1');
            await store.close();

            const reopened = openWorkspaceData(dataSlotsRoot);
            assert.equal(reopened.kind, 'ready');
            if (reopened.kind !== 'ready') {
                throw new Error('Expected ready Workspace DATA');
            }
            await loadDurableBackup().runDurableBackupPass(reopened.store, runOptions());
            assert.deepEqual(reopened.store.readProtectionWatermarks(), {
                neededThrough: '1',
                succeededThrough: '1',
            });
            assert.equal(reopened.store.readSuccessfulBackupSnapshots().length, 1);
            assert.deepEqual(readdirSync(backupSetDirectory(destination)), [
                `snapshot-${SNAPSHOT_ID}`,
            ]);
            await reopened.store.close();
        });
    }
});

test('TEST-PROTECT-002: checkpoint uses actual revision and absorbs later pending follow-ups', async t => {
    const {destination, store} = await createConfiguredStore(t);
    let stopped = false;
    await assert.rejects(loadDurableBackup().runDurableBackupPass(store, runOptions(point => {
        if (point === 'backup.after-claim' && !stopped) {
            stopped = true;
            throw new Error('stop after target claim');
        }
    })), /stop after target claim/);

    const committed = await store.commit(normalizeRecordSetupDecisionCommand({
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
    assert.equal(committed.ok, true);

    await loadDurableBackup().runDurableBackupPass(store, runOptions());
    const manifest = JSON.parse(readFileSync(
        path.join(finalSnapshotDirectory(destination), 'manifest.json'),
        'utf8',
    )) as {database: {actualRevision: string}};
    assert.equal(store.readBackupOperation()?.targetRevision, '1');
    assert.equal(manifest.database.actualRevision, '2');
    assert.deepEqual(store.readProtectionWatermarks(), {
        neededThrough: '2',
        succeededThrough: '2',
    });
    assert.equal(store.readSuccessfulBackupSnapshots().length, 1);
    await store.close();
});

test('TEST-PROTECT-002: staging and final validation reject changed member bytes', async t => {
    const stagingCase = await createConfiguredStore(t);
    await assert.rejects(loadDurableBackup().runDurableBackupPass(stagingCase.store, runOptions(point => {
        if (point === 'backup.after-manifest-write') {
            const operation = stagingCase.store.readBackupOperation();
            assert.ok(operation);
            writeFileSync(path.join(
                backupSetDirectory(stagingCase.destination),
                operation.stagingDirectoryName,
                'workspace.sqlite',
            ), 'changed before staging validation');
        }
    })), /Snapshot validation failed/);
    assert.equal(existsSync(finalSnapshotDirectory(stagingCase.destination)), false);
    assert.equal(stagingCase.store.readProtectionWatermarks().succeededThrough, '0');
    await stagingCase.store.close();

    const finalCase = await createConfiguredStore(t);
    await assert.rejects(loadDurableBackup().runDurableBackupPass(finalCase.store, runOptions(point => {
        if (point === 'backup.after-atomic-publish') {
            writeFileSync(
                path.join(finalSnapshotDirectory(finalCase.destination), 'workspace.sqlite'),
                'changed before final validation',
            );
        }
    })), /Snapshot validation failed/);
    assert.equal(finalCase.store.readProtectionWatermarks().succeededThrough, '0');
    assert.equal(finalCase.store.readSuccessfulBackupSnapshots().length, 0);
    await finalCase.store.close();
});

test('TEST-DATA-004: lost and duplicate PostCommit hints converge from durable follow-ups', async t => {
    const module = loadDurableBackup();
    assert.equal(typeof module.DurableBackupCoordinator, 'function');

    const lost = await createConfiguredStore(t);
    assert.equal(existsSync(path.join(lost.destination, 'CourseFlow')), false);
    await lost.store.close();
    const restarted = openWorkspaceData(lost.dataSlotsRoot);
    assert.equal(restarted.kind, 'ready');
    if (restarted.kind !== 'ready') {
        throw new Error('Expected ready Workspace DATA');
    }
    const restartCoordinator = new module.DurableBackupCoordinator(
        restarted.store,
        runOptions(),
    );
    restartCoordinator.wake();
    await restartCoordinator.waitForIdle();
    assert.equal(restarted.store.readSuccessfulBackupSnapshots().length, 1);
    await restartCoordinator.close();
    await restarted.store.close();

    const duplicate = await createConfiguredStore(t);
    const duplicateCoordinator = new module.DurableBackupCoordinator(
        duplicate.store,
        runOptions(),
    );
    duplicateCoordinator.wake();
    duplicateCoordinator.wake();
    duplicateCoordinator.wake();
    await duplicateCoordinator.waitForIdle();
    assert.equal(duplicate.store.readSuccessfulBackupSnapshots().length, 1);
    assert.deepEqual(duplicate.store.readProtectionWatermarks(), {
        neededThrough: '1',
        succeededThrough: '1',
    });
    await duplicateCoordinator.close();
    await duplicate.store.close();
});
