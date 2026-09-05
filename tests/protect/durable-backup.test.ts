/**
 * @file Verifies FLOW-04 publication, failpoint recovery, and actual-revision convergence.
 */

import assert from 'node:assert/strict';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    renameSync,
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
    type DataProtectionProjection,
} from '../../src/shared/workspace-protection-contract';
import {normalizeRecordSetupDecisionCommand} from '../../src/shared/workspace-data-contract';
import {
    createSnapshotManifestV1,
    validateSnapshotManifestV1,
} from '../../src/protect/snapshot-manifest';

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
const THIRD_COMMAND_ID = '99999999-9999-4999-8999-999999999999';
const THIRD_FOLLOW_UP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SECOND_OPERATION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SECOND_SNAPSHOT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const THIRD_OPERATION_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const THIRD_SNAPSHOT_ID = '12121212-1212-4212-8212-121212121212';
const CLEANUP_OPERATION_ID = '13131313-1313-4313-8313-131313131313';
const CONFLICT_SNAPSHOT_ID = '14141414-1414-4414-8414-141414141414';
const SECOND_CONFLICT_SNAPSHOT_ID = '18181818-1818-4818-8818-181818181818';
const FOURTH_COMMAND_ID = '24242424-2424-4424-8424-242424242424';
const FOURTH_FOLLOW_UP_ID = '25252525-2525-4525-8525-252525252525';
const FOURTH_OPERATION_ID = '26262626-2626-4626-8626-262626262626';
const FOURTH_SNAPSHOT_ID = '27272727-2727-4727-8727-272727272727';

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
const EXPECTED_RETENTION_FAILPOINTS = [
    'retention.after-cleanup-claim',
    'retention.after-quarantine',
    'retention.after-quarantine-record',
    'retention.after-delete-authorization',
    'retention.after-member-delete',
    'retention.after-delete',
    'retention.after-cleanup-record',
] as const;
type RetentionFailpoint = typeof EXPECTED_RETENTION_FAILPOINTS[number];
type DurableFailpoint = BackupFailpoint | RetentionFailpoint;
type DurableBackupModule = Readonly<{
    BACKUP_FAILPOINTS: readonly BackupFailpoint[];
    RETENTION_FAILPOINTS: readonly RetentionFailpoint[];
    runDurableBackupPass(
        store: SqliteDataStore,
        options?: Readonly<{
            clock?: Readonly<{now(): string}>;
            identityFactory?: () => Readonly<{
                operationId: string;
                snapshotId: string;
                nonce: string;
            }>;
            cleanupOperationIdFactory?: () => string;
            failpoint?: (point: DurableFailpoint) => void;
        }>,
    ): Promise<void>;
    readVerifiedDataProtectionProjection(store: SqliteDataStore): DataProtectionProjection;
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
 * @param {object} directories - Optional isolated paths for filesystem boundary tests.
 * @param {string} directories.dataSlotsRoot - Workspace DATA parent directory.
 * @param {string} directories.destination - Selected backup destination directory.
 * @return {Promise<object>} Data root, destination, and writable store.
 */
async function createConfiguredStore(
    t: test.TestContext,
    directories?: Readonly<{dataSlotsRoot: string; destination: string}>,
): Promise<Readonly<{
    dataSlotsRoot: string;
    destination: string;
    store: SqliteDataStore;
}>> {
    const dataSlotsRoot = directories?.dataSlotsRoot ?? createTempDirectory(t, 'courseflow-flow04-data-');
    const destination = directories?.destination ?? createTempDirectory(t, 'courseflow-flow04-destination-');
    mkdirSync(dataSlotsRoot, {recursive: true});
    mkdirSync(destination, {recursive: true});
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
function runOptions(failpoint?: (point: DurableFailpoint) => void) {
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
        cleanupOperationIdFactory: () => CLEANUP_OPERATION_ID,
        failpoint,
    };
}

/**
 * Builds one deterministic pass for an additional immutable snapshot.
 * @param {object} input - Stable identities and timestamps for one pass.
 * @param {function(DurableFailpoint): void} failpoint - Optional failure callback.
 * @return {object} Deterministic durable pass options.
 */
function additionalRunOptions(
    input: Readonly<{
        operationId: string;
        snapshotId: string;
        nonce: string;
        createdAt: string;
        succeededAt: string;
    }>,
    failpoint?: (point: DurableFailpoint) => void,
) {
    let clockCall = 0;
    return {
        clock: {
            now(): string {
                clockCall += 1;
                return clockCall === 1 ? input.createdAt : input.succeededAt;
            },
        },
        identityFactory: () => ({
            operationId: input.operationId,
            snapshotId: input.snapshotId,
            nonce: input.nonce,
        }),
        cleanupOperationIdFactory: () => CLEANUP_OPERATION_ID,
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

/**
 * Commits one additional local success that must become asynchronously protected.
 * @param {SqliteDataStore} store - Writable Workspace DATA store.
 * @param {object} input - Stable command and expected-version facts.
 * @return {Promise<void>} Resolves after the local fact commits.
 */
async function commitDecision(
    store: SqliteDataStore,
    input: Readonly<{
        commandId: string;
        followUpId: string;
        expectedRevision: string;
        expectedSetupVersion: string;
        decision: 'later' | 'skip';
    }>,
): Promise<void> {
    const committed = await store.commit(normalizeRecordSetupDecisionCommand({
        commandId: input.commandId,
        followUpId: input.followUpId,
        workspaceId: WORKSPACE_ID,
        expectedRevision: input.expectedRevision,
        expectedSetupVersion: input.expectedSetupVersion,
        intent: {
            kind: 'workspace.record-setup-decision',
            intentSchemaVersion: 1,
            payload: {decision: input.decision},
        },
    }));
    assert.equal(committed.ok, true);
}

/**
 * Publishes two sequential snapshots while retaining both verified results.
 * @param {test.TestContext} t - Owning test context.
 * @return {Promise<object>} Configured paths and store after two successes.
 */
async function createTwoSuccessfulSnapshots(t: test.TestContext): Promise<Readonly<{
    dataSlotsRoot: string;
    destination: string;
    store: SqliteDataStore;
}>> {
    const configured = await createConfiguredStore(t);
    await loadDurableBackup().runDurableBackupPass(configured.store, runOptions());
    await commitDecision(configured.store, {
        commandId: SECOND_COMMAND_ID,
        followUpId: SECOND_FOLLOW_UP_ID,
        expectedRevision: '1',
        expectedSetupVersion: '0',
        decision: 'later',
    });
    await loadDurableBackup().runDurableBackupPass(configured.store, additionalRunOptions({
        operationId: SECOND_OPERATION_ID,
        snapshotId: SECOND_SNAPSHOT_ID,
        nonce: '1111111111111111',
        createdAt: '2026-08-25T12:00:02.000Z',
        succeededAt: '2026-08-25T12:00:03.000Z',
    }));
    return configured;
}

/**
 * Publishes three sequential snapshots, optionally failing during third-pass retention.
 * @param {test.TestContext} t - Owning test context.
 * @param {function(DurableFailpoint): void} failpoint - Optional third-pass failure callback.
 * @param {function(object): void} beforeThirdPass - Optional filesystem preparation seam.
 * @return {Promise<object>} Configured paths and store after the third snapshot succeeds.
 */
async function createThreeSuccessfulSnapshots(
    t: test.TestContext,
    failpoint?: (point: DurableFailpoint) => void,
    beforeThirdPass?: (state: Readonly<{destination: string; store: SqliteDataStore}>) => void,
): Promise<Readonly<{
    dataSlotsRoot: string;
    destination: string;
    store: SqliteDataStore;
}>> {
    const configured = await createTwoSuccessfulSnapshots(t);
    await commitDecision(configured.store, {
        commandId: THIRD_COMMAND_ID,
        followUpId: THIRD_FOLLOW_UP_ID,
        expectedRevision: '2',
        expectedSetupVersion: '1',
        decision: 'skip',
    });
    beforeThirdPass?.(configured);
    await loadDurableBackup().runDurableBackupPass(configured.store, additionalRunOptions({
        operationId: THIRD_OPERATION_ID,
        snapshotId: THIRD_SNAPSHOT_ID,
        nonce: '2222222222222222',
        createdAt: '2026-08-25T12:00:04.000Z',
        succeededAt: '2026-08-25T12:00:05.000Z',
    }, failpoint));
    return configured;
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

test('ADR-07/TEST-PROTECT-003: a final-directory alias cannot resume as success', async t => {
    const publicationBoundaries = [
        'backup.after-atomic-publish',
        'backup.after-published-pending-record',
    ] as const;
    for (const boundary of publicationBoundaries) {
        await t.test(boundary, async child => {
            const configured = await createConfiguredStore(child);
            const canonicalDirectory = finalSnapshotDirectory(configured.destination);
            const aliasName = `SNAPSHOT-${SNAPSHOT_ID}`;
            const aliasDirectory = path.join(backupSetDirectory(configured.destination), aliasName);
            let renamed = false;
            await assert.rejects(loadDurableBackup().runDurableBackupPass(
                configured.store,
                runOptions(point => {
                    if (point === boundary && !renamed) {
                        renamed = true;
                        renameSync(canonicalDirectory, aliasDirectory);
                        throw new Error(`stop at ${boundary}`);
                    }
                }),
            ), new RegExp(`stop at ${boundary.replaceAll('.', '\\.')}`));
            assert.equal(renamed, true);
            assert.equal(readdirSync(backupSetDirectory(configured.destination)).includes(aliasName), true);
            assert.deepEqual(configured.store.readProtectionWatermarks(), {
                neededThrough: '1',
                succeededThrough: '0',
            });
            assert.equal(configured.store.readSuccessfulBackupSnapshots().length, 0);
            await configured.store.close();

            const reopened = openWorkspaceData(configured.dataSlotsRoot);
            assert.equal(reopened.kind, 'ready');
            if (reopened.kind !== 'ready') {
                throw new Error('Expected ready Workspace DATA');
            }
            await assert.rejects(
                loadDurableBackup().runDurableBackupPass(reopened.store, runOptions()),
                /Backup child identity conflicts|Snapshot staging directory is missing|Snapshot validation failed/,
            );
            assert.deepEqual(reopened.store.readProtectionWatermarks(), {
                neededThrough: '1',
                succeededThrough: '0',
            });
            assert.equal(reopened.store.readSuccessfulBackupSnapshots().length, 0);
            assert.equal(existsSync(aliasDirectory), true);
            await reopened.store.close();
        });
    }
});

test('ADR-07/TEST-PROTECT-003: a final-directory alias cannot record in the same pass', async t => {
    const publicationBoundaries = [
        'backup.after-atomic-publish',
        'backup.after-published-pending-record',
    ] as const;
    for (const boundary of publicationBoundaries) {
        await t.test(boundary, async child => {
            const configured = await createConfiguredStore(child);
            const canonicalDirectory = finalSnapshotDirectory(configured.destination);
            const aliasName = `SNAPSHOT-${SNAPSHOT_ID}`;
            const aliasDirectory = path.join(backupSetDirectory(configured.destination), aliasName);
            let renamed = false;
            await assert.rejects(loadDurableBackup().runDurableBackupPass(
                configured.store,
                runOptions(point => {
                    if (point === boundary && !renamed) {
                        renamed = true;
                        renameSync(canonicalDirectory, aliasDirectory);
                    }
                }),
            ), /Backup child identity conflicts|Snapshot validation failed/);
            assert.equal(renamed, true);
            assert.equal(readdirSync(backupSetDirectory(configured.destination)).includes(aliasName), true);
            assert.deepEqual(configured.store.readProtectionWatermarks(), {
                neededThrough: '1',
                succeededThrough: '0',
            });
            assert.equal(configured.store.readSuccessfulBackupSnapshots().length, 0);
            assert.equal(existsSync(aliasDirectory), true);
            await configured.store.close();
        });
    }
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

test('A-DATA-004/TEST-PROTECT-003: retention keeps the newest two and leaves unknown collections', async t => {
    const otherBackupSetId = '17171717-1717-4717-8717-171717171717';
    const keptUnknownName = 'user-owned-unknown.txt';
    const configured = await createThreeSuccessfulSnapshots(t, undefined, ({destination}) => {
        writeFileSync(path.join(backupSetDirectory(destination), keptUnknownName), 'keep');
        const otherBackupSetDirectory = path.join(
            path.dirname(backupSetDirectory(destination)),
            otherBackupSetId,
        );
        mkdirSync(otherBackupSetDirectory);
        writeFileSync(path.join(otherBackupSetDirectory, 'other-set.txt'), 'keep');
    });

    assert.deepEqual(configured.store.readSuccessfulBackupSnapshots().map(snapshot => snapshot.snapshotId), [
        SECOND_SNAPSHOT_ID,
        THIRD_SNAPSHOT_ID,
    ]);
    assert.deepEqual(readdirSync(backupSetDirectory(configured.destination)).sort(), [
        `snapshot-${THIRD_SNAPSHOT_ID}`,
        `snapshot-${SECOND_SNAPSHOT_ID}`,
        keptUnknownName,
    ].sort());
    assert.equal(
        readFileSync(path.join(
            path.dirname(backupSetDirectory(configured.destination)),
            otherBackupSetId,
            'other-set.txt',
        ), 'utf8'),
        'keep',
    );
    const projection = configured.store.readDataProtectionProjection();
    assert.equal('backup' in projection, true);
    if (!('backup' in projection)) {
        throw new Error('Expected configured protection projection');
    }
    assert.equal(projection.backup.state, 'current');
    assert.equal(projection.backup.cleanup, 'idle');
    assert.equal(projection.backup.lastSuccess?.snapshotId, THIRD_SNAPSHOT_ID);
    assert.deepEqual(
        projection.backup.recentVerifiedSnapshots.map(snapshot => snapshot.snapshotId),
        [THIRD_SNAPSHOT_ID, SECOND_SNAPSHOT_ID],
    );
    await configured.store.close();
});

test('TEST-PROTECT-003: long Windows SQLite paths stay current through retention and restart', {
    skip: process.platform !== 'win32',
}, async t => {
    const root = createTempDirectory(t, 'courseflow-long-path-');
    const longRoot = path.join(root, 'nested-'.repeat(18), 'nested-'.repeat(18));
    const dataSlotsRoot = path.join(longRoot, 'data');
    const destination = path.join(longRoot, 'backups');
    assert.ok(path.join(dataSlotsRoot, 'active', 'workspace.sqlite').length > 260);
    const configured = await createConfiguredStore(t, {dataSlotsRoot, destination});
    const store = configured.store;
    const module = loadDurableBackup();

    try {
        await module.runDurableBackupPass(store, runOptions());
        await commitDecision(store, {
            commandId: SECOND_COMMAND_ID,
            followUpId: SECOND_FOLLOW_UP_ID,
            expectedRevision: '1',
            expectedSetupVersion: '0',
            decision: 'later',
        });
        await module.runDurableBackupPass(store, additionalRunOptions({
            operationId: SECOND_OPERATION_ID,
            snapshotId: SECOND_SNAPSHOT_ID,
            nonce: '1111111111111111',
            createdAt: '2026-08-25T12:00:02.000Z',
            succeededAt: '2026-08-25T12:00:03.000Z',
        }));
        await commitDecision(store, {
            commandId: THIRD_COMMAND_ID,
            followUpId: THIRD_FOLLOW_UP_ID,
            expectedRevision: '2',
            expectedSetupVersion: '1',
            decision: 'skip',
        });
        let hasQuarantinedDatabase = false;
        await module.runDurableBackupPass(store, additionalRunOptions({
            operationId: THIRD_OPERATION_ID,
            snapshotId: THIRD_SNAPSHOT_ID,
            nonce: '2222222222222222',
            createdAt: '2026-08-25T12:00:04.000Z',
            succeededAt: '2026-08-25T12:00:05.000Z',
        }, point => {
            if (point === 'retention.after-quarantine-record') {
                const quarantinedDatabase = path.join(
                    backupSetDirectory(destination),
                    `.quarantine-${CLEANUP_OPERATION_ID}-${SNAPSHOT_ID}`,
                    'workspace.sqlite',
                );
                assert.ok(quarantinedDatabase.length > 260);
                assert.equal(existsSync(quarantinedDatabase), true);
                hasQuarantinedDatabase = true;
            }
        }));
        assert.equal(hasQuarantinedDatabase, true);
        assert.deepEqual(store.readProtectionWatermarks(), {neededThrough: '3', succeededThrough: '3'});
        assert.equal(store.readPendingFollowUps().length, 0);
        assert.deepEqual(readdirSync(backupSetDirectory(destination)).sort(), [
            `snapshot-${THIRD_SNAPSHOT_ID}`,
            `snapshot-${SECOND_SNAPSHOT_ID}`,
        ].sort());
    }
    finally {
        await store.close();
    }

    const reopened = openWorkspaceData(dataSlotsRoot);
    assert.equal(reopened.kind, 'ready');
    if (reopened.kind !== 'ready') {
        throw new Error('Expected ready Workspace DATA');
    }
    try {
        const projection = module.readVerifiedDataProtectionProjection(reopened.store);
        assert.equal('backup' in projection, true);
        if (!('backup' in projection)) {
            throw new Error('Expected configured protection projection');
        }
        assert.equal(projection.backup.state, 'current');
        assert.equal(projection.backup.cleanup, 'idle');
        assert.deepEqual(
            projection.backup.recentVerifiedSnapshots.map(snapshot => snapshot.snapshotId),
            [THIRD_SNAPSHOT_ID, SECOND_SNAPSHOT_ID],
        );
        assert.deepEqual(reopened.store.readProtectionWatermarks(), {neededThrough: '3', succeededThrough: '3'});
    }
    finally {
        await reopened.store.close();
    }
});

test('ADR-07/TEST-PROTECT-003: projection refresh lists only currently verified snapshots', async t => {
    const configured = await createThreeSuccessfulSnapshots(t);
    writeFileSync(path.join(
        backupSetDirectory(configured.destination),
        `snapshot-${THIRD_SNAPSHOT_ID}`,
        'manifest.json',
    ), 'changed after recorded success');

    const projection = loadDurableBackup().readVerifiedDataProtectionProjection(configured.store);
    assert.equal('backup' in projection, true);
    if (!('backup' in projection)) {
        throw new Error('Expected configured protection projection');
    }
    assert.equal(projection.backup.lastSuccess?.snapshotId, THIRD_SNAPSHOT_ID);
    assert.deepEqual(
        projection.backup.recentVerifiedSnapshots.map(snapshot => snapshot.snapshotId),
        [SECOND_SNAPSHOT_ID],
    );
    await configured.store.close();
});

test('TEST-PROTECT-003: every quarantine boundary resumes after Workspace restart', async t => {
    const module = loadDurableBackup();
    assert.deepEqual(module.RETENTION_FAILPOINTS, EXPECTED_RETENTION_FAILPOINTS);
    for (const failpoint of EXPECTED_RETENTION_FAILPOINTS) {
        await t.test(failpoint, async () => {
            const configured = await createTwoSuccessfulSnapshots(t);
            await commitDecision(configured.store, {
                commandId: THIRD_COMMAND_ID,
                followUpId: THIRD_FOLLOW_UP_ID,
                expectedRevision: '2',
                expectedSetupVersion: '1',
                decision: 'skip',
            });
            let injected = false;
            await assert.rejects(module.runDurableBackupPass(
                configured.store,
                additionalRunOptions({
                    operationId: THIRD_OPERATION_ID,
                    snapshotId: THIRD_SNAPSHOT_ID,
                    nonce: '2222222222222222',
                    createdAt: '2026-08-25T12:00:04.000Z',
                    succeededAt: '2026-08-25T12:00:05.000Z',
                }, point => {
                    if (point === failpoint && !injected) {
                        injected = true;
                        throw new Error(`injected ${point}`);
                    }
                }),
            ), new RegExp(`injected ${failpoint.replaceAll('.', '\\.')}`));
            assert.deepEqual(configured.store.readProtectionWatermarks(), {
                neededThrough: '3',
                succeededThrough: '3',
            });
            assert.equal(existsSync(path.join(
                backupSetDirectory(configured.destination),
                `snapshot-${SECOND_SNAPSHOT_ID}`,
            )), true);
            assert.equal(existsSync(path.join(
                backupSetDirectory(configured.destination),
                `snapshot-${THIRD_SNAPSHOT_ID}`,
            )), true);
            const interruptedProjection = configured.store.readDataProtectionProjection();
            assert.equal('backup' in interruptedProjection, true);
            if (!('backup' in interruptedProjection)) {
                throw new Error('Expected configured protection projection');
            }
            assert.equal(interruptedProjection.backup.lastSuccess?.snapshotId, THIRD_SNAPSHOT_ID);
            assert.equal(
                interruptedProjection.backup.cleanup,
                failpoint === 'retention.after-cleanup-record' ? 'idle' : 'pending',
            );
            await configured.store.close();

            const reopened = openWorkspaceData(configured.dataSlotsRoot);
            assert.equal(reopened.kind, 'ready');
            if (reopened.kind !== 'ready') {
                throw new Error('Expected ready Workspace DATA');
            }
            await module.runDurableBackupPass(reopened.store, additionalRunOptions({
                operationId: THIRD_OPERATION_ID,
                snapshotId: THIRD_SNAPSHOT_ID,
                nonce: '2222222222222222',
                createdAt: '2026-08-25T12:00:04.000Z',
                succeededAt: '2026-08-25T12:00:05.000Z',
            }));
            assert.deepEqual(reopened.store.readSuccessfulBackupSnapshots().map(
                snapshot => snapshot.snapshotId,
            ), [SECOND_SNAPSHOT_ID, THIRD_SNAPSHOT_ID]);
            assert.deepEqual(readdirSync(backupSetDirectory(configured.destination)).sort(), [
                `snapshot-${THIRD_SNAPSHOT_ID}`,
                `snapshot-${SECOND_SNAPSHOT_ID}`,
            ].sort());
            assert.equal(reopened.store.readBackupCleanupOperation(), null);
            await reopened.store.close();
        });
    }
});

test('ADR-07/TEST-PROTECT-003: changed surviving member blocks resumed exact deletion', async t => {
    const module = loadDurableBackup();
    const configured = await createTwoSuccessfulSnapshots(t);
    const firstManifestPath = path.join(
        backupSetDirectory(configured.destination),
        `snapshot-${SNAPSHOT_ID}`,
        'manifest.json',
    );
    const originalManifest = readFileSync(firstManifestPath);
    await commitDecision(configured.store, {
        commandId: THIRD_COMMAND_ID,
        followUpId: THIRD_FOLLOW_UP_ID,
        expectedRevision: '2',
        expectedSetupVersion: '1',
        decision: 'skip',
    });
    let interrupted = false;
    await assert.rejects(module.runDurableBackupPass(
        configured.store,
        additionalRunOptions({
            operationId: THIRD_OPERATION_ID,
            snapshotId: THIRD_SNAPSHOT_ID,
            nonce: '2222222222222222',
            createdAt: '2026-08-25T12:00:04.000Z',
            succeededAt: '2026-08-25T12:00:05.000Z',
        }, point => {
            if (point === 'retention.after-member-delete' && !interrupted) {
                interrupted = true;
                throw new Error('stop after first member delete');
            }
        }),
    ), /stop after first member delete/);
    const cleanup = configured.store.readBackupCleanupOperation();
    assert.equal(cleanup?.phase, 'deleting');
    const quarantineDirectory = path.join(
        backupSetDirectory(configured.destination),
        cleanup!.quarantineDirectoryName,
    );
    assert.deepEqual(readdirSync(quarantineDirectory), ['manifest.json']);
    writeFileSync(path.join(quarantineDirectory, 'manifest.json'), 'replacement manifest');
    await configured.store.close();

    const reopened = openWorkspaceData(configured.dataSlotsRoot);
    assert.equal(reopened.kind, 'ready');
    if (reopened.kind !== 'ready') {
        throw new Error('Expected ready Workspace DATA');
    }
    await assert.rejects(module.runDurableBackupPass(
        reopened.store,
        additionalRunOptions({
            operationId: THIRD_OPERATION_ID,
            snapshotId: THIRD_SNAPSHOT_ID,
            nonce: '2222222222222222',
            createdAt: '2026-08-25T12:00:04.000Z',
            succeededAt: '2026-08-25T12:00:05.000Z',
        }),
    ), /Snapshot validation failed/);
    assert.equal(readFileSync(
        path.join(quarantineDirectory, 'manifest.json'),
        'utf8',
    ), 'replacement manifest');
    assert.equal(reopened.store.readBackupCleanupOperation()?.phase, 'deleting');
    assert.deepEqual(reopened.store.readSuccessfulBackupSnapshots().map(
        snapshot => snapshot.snapshotId,
    ), [SNAPSHOT_ID, SECOND_SNAPSHOT_ID, THIRD_SNAPSHOT_ID]);

    writeFileSync(path.join(quarantineDirectory, 'manifest.json'), originalManifest);
    await module.runDurableBackupPass(reopened.store, additionalRunOptions({
        operationId: THIRD_OPERATION_ID,
        snapshotId: THIRD_SNAPSHOT_ID,
        nonce: '2222222222222222',
        createdAt: '2026-08-25T12:00:04.000Z',
        succeededAt: '2026-08-25T12:00:05.000Z',
    }));
    assert.deepEqual(reopened.store.readSuccessfulBackupSnapshots().map(
        snapshot => snapshot.snapshotId,
    ), [SECOND_SNAPSHOT_ID, THIRD_SNAPSHOT_ID]);
    assert.equal(reopened.store.readBackupCleanupOperation(), null);
    await reopened.store.close();
});

test('ADR-07/TEST-PROTECT-003: changed surviving member blocks same-pass deletion', async t => {
    const module = loadDurableBackup();
    const configured = await createTwoSuccessfulSnapshots(t);
    await commitDecision(configured.store, {
        commandId: THIRD_COMMAND_ID,
        followUpId: THIRD_FOLLOW_UP_ID,
        expectedRevision: '2',
        expectedSetupVersion: '1',
        decision: 'skip',
    });
    let replaced = false;
    let replacementManifestPath = '';
    await assert.rejects(module.runDurableBackupPass(
        configured.store,
        additionalRunOptions({
            operationId: THIRD_OPERATION_ID,
            snapshotId: THIRD_SNAPSHOT_ID,
            nonce: '2222222222222222',
            createdAt: '2026-08-25T12:00:04.000Z',
            succeededAt: '2026-08-25T12:00:05.000Z',
        }, point => {
            if (point === 'retention.after-member-delete' && !replaced) {
                const cleanup = configured.store.readBackupCleanupOperation();
                assert.equal(cleanup?.phase, 'deleting');
                replacementManifestPath = path.join(
                    backupSetDirectory(configured.destination),
                    cleanup!.quarantineDirectoryName,
                    'manifest.json',
                );
                writeFileSync(replacementManifestPath, 'same-pass replacement manifest');
                replaced = true;
            }
        }),
    ), /Snapshot validation failed/);
    assert.equal(replaced, true);
    assert.equal(readFileSync(replacementManifestPath, 'utf8'), 'same-pass replacement manifest');
    assert.equal(configured.store.readBackupCleanupOperation()?.phase, 'deleting');
    assert.deepEqual(configured.store.readSuccessfulBackupSnapshots().map(
        snapshot => snapshot.snapshotId,
    ), [SNAPSHOT_ID, SECOND_SNAPSHOT_ID, THIRD_SNAPSHOT_ID]);
    await configured.store.close();
});

test('A-DATA-003/004: a failed next backup preserves two good snapshots and remains pending', async t => {
    const configured = await createTwoSuccessfulSnapshots(t);
    const originalManifests = [SNAPSHOT_ID, SECOND_SNAPSHOT_ID].map(snapshotId => readFileSync(
        path.join(backupSetDirectory(configured.destination), `snapshot-${snapshotId}`, 'manifest.json'),
    ));
    await commitDecision(configured.store, {
        commandId: THIRD_COMMAND_ID,
        followUpId: THIRD_FOLLOW_UP_ID,
        expectedRevision: '2',
        expectedSetupVersion: '1',
        decision: 'skip',
    });
    await assert.rejects(loadDurableBackup().runDurableBackupPass(
        configured.store,
        additionalRunOptions({
            operationId: THIRD_OPERATION_ID,
            snapshotId: THIRD_SNAPSHOT_ID,
            nonce: '2222222222222222',
            createdAt: '2026-08-25T12:00:04.000Z',
            succeededAt: '2026-08-25T12:00:05.000Z',
        }, point => {
            if (point === 'backup.after-staging-create') {
                throw new Error('injected backup failure');
            }
        }),
    ), /injected backup failure/);

    assert.deepEqual(configured.store.readProtectionWatermarks(), {
        neededThrough: '3',
        succeededThrough: '2',
    });
    assert.deepEqual(configured.store.readSuccessfulBackupSnapshots().map(snapshot => snapshot.snapshotId), [
        SNAPSHOT_ID,
        SECOND_SNAPSHOT_ID,
    ]);
    for (const [index, snapshotId] of [SNAPSHOT_ID, SECOND_SNAPSHOT_ID].entries()) {
        assert.deepEqual(readFileSync(path.join(
            backupSetDirectory(configured.destination),
            `snapshot-${snapshotId}`,
            'manifest.json',
        )), originalManifests[index]);
    }
    const projection = configured.store.readDataProtectionProjection();
    assert.equal('backup' in projection, true);
    if (!('backup' in projection)) {
        throw new Error('Expected configured protection projection');
    }
    assert.equal(projection.backup.state, 'pending');
    assert.equal(projection.backup.lastSuccess?.snapshotId, SECOND_SNAPSHOT_ID);
    assert.deepEqual(
        projection.backup.recentVerifiedSnapshots.map(snapshot => snapshot.snapshotId),
        [SECOND_SNAPSHOT_ID, SNAPSHOT_ID],
    );
    await configured.store.close();
});

test('ADR-07/TEST-PROTECT-003: an unregistered identity conflict pauses cleanup without deletion', async t => {
    const configured = await createTwoSuccessfulSnapshots(t);
    await commitDecision(configured.store, {
        commandId: THIRD_COMMAND_ID,
        followUpId: THIRD_FOLLOW_UP_ID,
        expectedRevision: '2',
        expectedSetupVersion: '1',
        decision: 'skip',
    });
    const firstManifest = validateSnapshotManifestV1(readFileSync(path.join(
        finalSnapshotDirectory(configured.destination),
        'manifest.json',
    )));
    const conflictDirectories = [
        ['unregistered-conflict-a', CONFLICT_SNAPSHOT_ID],
        ['unregistered-conflict-b', SECOND_CONFLICT_SNAPSHOT_ID],
    ] as const;
    for (const [directoryName, snapshotId] of conflictDirectories) {
        const conflictDirectory = path.join(backupSetDirectory(configured.destination), directoryName);
        mkdirSync(conflictDirectory);
        writeFileSync(path.join(conflictDirectory, 'manifest.json'), createSnapshotManifestV1({
            ...firstManifest.input,
            snapshotId,
            backupSequence: '99',
        }));
    }

    await assert.rejects(loadDurableBackup().runDurableBackupPass(
        configured.store,
        additionalRunOptions({
            operationId: THIRD_OPERATION_ID,
            snapshotId: THIRD_SNAPSHOT_ID,
            nonce: '2222222222222222',
            createdAt: '2026-08-25T12:00:04.000Z',
            succeededAt: '2026-08-25T12:00:05.000Z',
        }),
    ), /Snapshot identity conflict/);
    assert.deepEqual(configured.store.readSuccessfulBackupSnapshots().map(snapshot => snapshot.snapshotId), [
        SNAPSHOT_ID,
        SECOND_SNAPSHOT_ID,
        THIRD_SNAPSHOT_ID,
    ]);
    assert.equal(configured.store.readBackupCleanupOperation()?.phase, 'planned');
    const projection = configured.store.readDataProtectionProjection();
    assert.equal('backup' in projection, true);
    if (!('backup' in projection)) {
        throw new Error('Expected configured protection projection');
    }
    assert.equal(projection.backup.cleanup, 'pending');
    for (const [directoryName] of conflictDirectories) {
        assert.equal(existsSync(path.join(
            backupSetDirectory(configured.destination),
            directoryName,
        )), true);
    }
    assert.equal(existsSync(finalSnapshotDirectory(configured.destination)), true);
    await configured.store.close();
});

test('ADR-07/TEST-PROTECT-003: a registered identity conflict remains outside retention', async t => {
    const configured = await createTwoSuccessfulSnapshots(t);
    await commitDecision(configured.store, {
        commandId: THIRD_COMMAND_ID,
        followUpId: THIRD_FOLLOW_UP_ID,
        expectedRevision: '2',
        expectedSetupVersion: '1',
        decision: 'skip',
    });
    const secondDirectory = path.join(
        backupSetDirectory(configured.destination),
        `snapshot-${SECOND_SNAPSHOT_ID}`,
    );
    const secondManifest = validateSnapshotManifestV1(readFileSync(path.join(
        secondDirectory,
        'manifest.json',
    )));
    writeFileSync(path.join(secondDirectory, 'manifest.json'), createSnapshotManifestV1({
        ...secondManifest.input,
        snapshotId: CONFLICT_SNAPSHOT_ID,
        backupSequence: '99',
    }));

    await loadDurableBackup().runDurableBackupPass(
        configured.store,
        additionalRunOptions({
            operationId: THIRD_OPERATION_ID,
            snapshotId: THIRD_SNAPSHOT_ID,
            nonce: '2222222222222222',
            createdAt: '2026-08-25T12:00:04.000Z',
            succeededAt: '2026-08-25T12:00:05.000Z',
        }),
    );
    assert.equal(configured.store.readBackupCleanupOperation(), null);
    assert.deepEqual(configured.store.readSuccessfulBackupSnapshots().map(snapshot => snapshot.snapshotId), [
        SNAPSHOT_ID,
        SECOND_SNAPSHOT_ID,
        THIRD_SNAPSHOT_ID,
    ]);
    const projection = configured.store.readDataProtectionProjection();
    assert.equal('backup' in projection, true);
    if (!('backup' in projection)) {
        throw new Error('Expected configured protection projection');
    }
    assert.equal(projection.backup.cleanup, 'pending');
    assert.equal(existsSync(finalSnapshotDirectory(configured.destination)), true);
    await configured.store.close();
});

test('ADR-07/TEST-PROTECT-003: a case-variant registered directory remains untouched', async t => {
    const configured = await createTwoSuccessfulSnapshots(t);
    await commitDecision(configured.store, {
        commandId: THIRD_COMMAND_ID,
        followUpId: THIRD_FOLLOW_UP_ID,
        expectedRevision: '2',
        expectedSetupVersion: '1',
        decision: 'skip',
    });
    const canonicalName = `snapshot-${SECOND_SNAPSHOT_ID}`;
    const aliasName = `SNAPSHOT-${SECOND_SNAPSHOT_ID}`;
    renameSync(
        path.join(backupSetDirectory(configured.destination), canonicalName),
        path.join(backupSetDirectory(configured.destination), aliasName),
    );

    await assert.rejects(loadDurableBackup().runDurableBackupPass(
        configured.store,
        additionalRunOptions({
            operationId: THIRD_OPERATION_ID,
            snapshotId: THIRD_SNAPSHOT_ID,
            nonce: '2222222222222222',
            createdAt: '2026-08-25T12:00:04.000Z',
            succeededAt: '2026-08-25T12:00:05.000Z',
        }),
    ), /identity conflict/i);
    assert.equal(configured.store.readBackupCleanupOperation(), null);
    const projection = configured.store.readDataProtectionProjection();
    assert.equal('backup' in projection, true);
    if (!('backup' in projection)) {
        throw new Error('Expected configured protection projection');
    }
    assert.equal(projection.backup.cleanup, 'pending');
    assert.equal(existsSync(path.join(
        backupSetDirectory(configured.destination),
        aliasName,
    )), true);
    assert.deepEqual(configured.store.readSuccessfulBackupSnapshots().map(snapshot => snapshot.snapshotId), [
        SNAPSHOT_ID,
        SECOND_SNAPSHOT_ID,
        THIRD_SNAPSHOT_ID,
    ]);
    await configured.store.close();
});

test('ADR-07/TEST-PROTECT-003: a case-alias repository parent blocks retention', async t => {
    const configured = await createTwoSuccessfulSnapshots(t);
    await commitDecision(configured.store, {
        commandId: THIRD_COMMAND_ID,
        followUpId: THIRD_FOLLOW_UP_ID,
        expectedRevision: '2',
        expectedSetupVersion: '1',
        decision: 'skip',
    });
    const canonicalRepository = path.join(configured.destination, 'CourseFlow');
    const aliasRepository = path.join(configured.destination, 'courseflow');
    renameSync(canonicalRepository, aliasRepository);
    if (!existsSync(canonicalRepository)) {
        t.skip('The test filesystem treats case variants as distinct entries');
        await configured.store.close();
        return;
    }

    await assert.rejects(loadDurableBackup().runDurableBackupPass(
        configured.store,
        additionalRunOptions({
            operationId: THIRD_OPERATION_ID,
            snapshotId: THIRD_SNAPSHOT_ID,
            nonce: '2222222222222222',
            createdAt: '2026-08-25T12:00:04.000Z',
            succeededAt: '2026-08-25T12:00:05.000Z',
        }),
    ), /Backup child identity conflicts/);
    assert.equal(configured.store.readBackupCleanupOperation(), null);
    assert.deepEqual(configured.store.readProtectionWatermarks(), {
        neededThrough: '3',
        succeededThrough: '2',
    });
    const projection = configured.store.readDataProtectionProjection();
    assert.equal('backup' in projection, true);
    if (!('backup' in projection)) {
        throw new Error('Expected configured protection projection');
    }
    assert.equal(projection.backup.state, 'pending');
    assert.equal(projection.backup.cleanup, 'idle');
    assert.deepEqual(configured.store.readSuccessfulBackupSnapshots().map(
        snapshot => snapshot.snapshotId,
    ), [SNAPSHOT_ID, SECOND_SNAPSHOT_ID]);
    assert.deepEqual(readdirSync(path.join(
        aliasRepository,
        WORKSPACE_ID,
        BACKUP_SET_ID,
    )).sort(), [
        `snapshot-${SNAPSHOT_ID}`,
        `snapshot-${SECOND_SNAPSHOT_ID}`,
    ].sort());
    await configured.store.close();
});

test('ADR-07/TEST-PROTECT-003: corrupt oldest registration cannot pin later verified cleanup', async t => {
    const module = loadDurableBackup();
    const configured = await createTwoSuccessfulSnapshots(t);
    await commitDecision(configured.store, {
        commandId: THIRD_COMMAND_ID,
        followUpId: THIRD_FOLLOW_UP_ID,
        expectedRevision: '2',
        expectedSetupVersion: '1',
        decision: 'skip',
    });
    let claimed = false;
    await assert.rejects(module.runDurableBackupPass(
        configured.store,
        additionalRunOptions({
            operationId: THIRD_OPERATION_ID,
            snapshotId: THIRD_SNAPSHOT_ID,
            nonce: '2222222222222222',
            createdAt: '2026-08-25T12:00:04.000Z',
            succeededAt: '2026-08-25T12:00:05.000Z',
        }, point => {
            if (point === 'retention.after-cleanup-claim' && !claimed) {
                claimed = true;
                throw new Error('stop with oldest cleanup planned');
            }
        }),
    ), /stop with oldest cleanup planned/);
    const corruptDirectory = path.join(
        backupSetDirectory(configured.destination),
        `snapshot-${SNAPSHOT_ID}`,
    );
    writeFileSync(path.join(corruptDirectory, 'manifest.json'), 'corrupt registered snapshot');
    await commitDecision(configured.store, {
        commandId: FOURTH_COMMAND_ID,
        followUpId: FOURTH_FOLLOW_UP_ID,
        expectedRevision: '3',
        expectedSetupVersion: '2',
        decision: 'later',
    });

    await module.runDurableBackupPass(configured.store, additionalRunOptions({
        operationId: FOURTH_OPERATION_ID,
        snapshotId: FOURTH_SNAPSHOT_ID,
        nonce: '3333333333333333',
        createdAt: '2026-08-25T12:00:06.000Z',
        succeededAt: '2026-08-25T12:00:07.000Z',
    }));

    assert.equal(existsSync(corruptDirectory), true);
    assert.equal(existsSync(path.join(
        backupSetDirectory(configured.destination),
        `snapshot-${SECOND_SNAPSHOT_ID}`,
    )), false);
    assert.equal(existsSync(path.join(
        backupSetDirectory(configured.destination),
        `snapshot-${THIRD_SNAPSHOT_ID}`,
    )), true);
    assert.equal(existsSync(path.join(
        backupSetDirectory(configured.destination),
        `snapshot-${FOURTH_SNAPSHOT_ID}`,
    )), true);
    assert.deepEqual(configured.store.readSuccessfulBackupSnapshots().map(
        snapshot => snapshot.snapshotId,
    ), [SNAPSHOT_ID, THIRD_SNAPSHOT_ID, FOURTH_SNAPSHOT_ID]);
    assert.equal(configured.store.readBackupCleanupOperation(), null);
    const projection = configured.store.readDataProtectionProjection();
    assert.equal('backup' in projection, true);
    if (!('backup' in projection)) {
        throw new Error('Expected configured protection projection');
    }
    assert.equal(projection.backup.cleanup, 'pending');
    await configured.store.close();
});

test('ADR-07/TEST-PROTECT-003: missing planned candidate cannot pin backup after restart', async t => {
    const module = loadDurableBackup();
    const configured = await createTwoSuccessfulSnapshots(t);
    await commitDecision(configured.store, {
        commandId: THIRD_COMMAND_ID,
        followUpId: THIRD_FOLLOW_UP_ID,
        expectedRevision: '2',
        expectedSetupVersion: '1',
        decision: 'skip',
    });
    let claimed = false;
    await assert.rejects(module.runDurableBackupPass(
        configured.store,
        additionalRunOptions({
            operationId: THIRD_OPERATION_ID,
            snapshotId: THIRD_SNAPSHOT_ID,
            nonce: '2222222222222222',
            createdAt: '2026-08-25T12:00:04.000Z',
            succeededAt: '2026-08-25T12:00:05.000Z',
        }, point => {
            if (point === 'retention.after-cleanup-claim' && !claimed) {
                claimed = true;
                throw new Error('stop with cleanup planned before disappearance');
            }
        }),
    ), /stop with cleanup planned before disappearance/);
    const missingDirectory = path.join(
        backupSetDirectory(configured.destination),
        `snapshot-${SNAPSHOT_ID}`,
    );
    rmSync(missingDirectory, {recursive: true});
    await configured.store.close();

    const reopened = openWorkspaceData(configured.dataSlotsRoot);
    assert.equal(reopened.kind, 'ready');
    if (reopened.kind !== 'ready') {
        throw new Error('Expected ready Workspace DATA');
    }
    await commitDecision(reopened.store, {
        commandId: FOURTH_COMMAND_ID,
        followUpId: FOURTH_FOLLOW_UP_ID,
        expectedRevision: '3',
        expectedSetupVersion: '2',
        decision: 'later',
    });
    await module.runDurableBackupPass(reopened.store, additionalRunOptions({
        operationId: FOURTH_OPERATION_ID,
        snapshotId: FOURTH_SNAPSHOT_ID,
        nonce: '3333333333333333',
        createdAt: '2026-08-25T12:00:06.000Z',
        succeededAt: '2026-08-25T12:00:07.000Z',
    }));

    assert.equal(existsSync(missingDirectory), false);
    assert.equal(existsSync(path.join(
        backupSetDirectory(configured.destination),
        `snapshot-${SECOND_SNAPSHOT_ID}`,
    )), false);
    assert.equal(existsSync(path.join(
        backupSetDirectory(configured.destination),
        `snapshot-${THIRD_SNAPSHOT_ID}`,
    )), true);
    assert.equal(existsSync(path.join(
        backupSetDirectory(configured.destination),
        `snapshot-${FOURTH_SNAPSHOT_ID}`,
    )), true);
    assert.deepEqual(reopened.store.readSuccessfulBackupSnapshots().map(
        snapshot => snapshot.snapshotId,
    ), [SNAPSHOT_ID, THIRD_SNAPSHOT_ID, FOURTH_SNAPSHOT_ID]);
    assert.equal(reopened.store.readBackupCleanupOperation(), null);
    const projection = reopened.store.readDataProtectionProjection();
    assert.equal('backup' in projection, true);
    if (!('backup' in projection)) {
        throw new Error('Expected configured protection projection');
    }
    assert.equal(projection.backup.cleanup, 'pending');
    await reopened.store.close();
});

test('ADR-07/TEST-PROTECT-003: newer snapshots are reverified before physical deletion', async t => {
    const configured = await createTwoSuccessfulSnapshots(t);
    const secondManifestPath = path.join(
        backupSetDirectory(configured.destination),
        `snapshot-${SECOND_SNAPSHOT_ID}`,
        'manifest.json',
    );
    const originalSecondManifest = readFileSync(secondManifestPath);
    await commitDecision(configured.store, {
        commandId: THIRD_COMMAND_ID,
        followUpId: THIRD_FOLLOW_UP_ID,
        expectedRevision: '2',
        expectedSetupVersion: '1',
        decision: 'skip',
    });
    let mutated = false;
    await assert.rejects(loadDurableBackup().runDurableBackupPass(
        configured.store,
        additionalRunOptions({
            operationId: THIRD_OPERATION_ID,
            snapshotId: THIRD_SNAPSHOT_ID,
            nonce: '2222222222222222',
            createdAt: '2026-08-25T12:00:04.000Z',
            succeededAt: '2026-08-25T12:00:05.000Z',
        }, point => {
            if (point === 'retention.after-quarantine-record' && !mutated) {
                mutated = true;
                writeFileSync(secondManifestPath, 'changed after quarantine');
            }
        }),
    ), /Snapshot cleanup would violate retention/);
    const cleanup = configured.store.readBackupCleanupOperation();
    assert.equal(cleanup?.phase, 'quarantined');
    assert.deepEqual(configured.store.readSuccessfulBackupSnapshots().map(snapshot => snapshot.snapshotId), [
        SNAPSHOT_ID,
        SECOND_SNAPSHOT_ID,
        THIRD_SNAPSHOT_ID,
    ]);
    assert.equal(existsSync(path.join(
        backupSetDirectory(configured.destination),
        cleanup!.quarantineDirectoryName,
        'manifest.json',
    )), true);

    writeFileSync(secondManifestPath, originalSecondManifest);
    await configured.store.close();
    const reopened = openWorkspaceData(configured.dataSlotsRoot);
    assert.equal(reopened.kind, 'ready');
    if (reopened.kind !== 'ready') {
        throw new Error('Expected ready Workspace DATA');
    }
    await loadDurableBackup().runDurableBackupPass(reopened.store, additionalRunOptions({
        operationId: THIRD_OPERATION_ID,
        snapshotId: THIRD_SNAPSHOT_ID,
        nonce: '2222222222222222',
        createdAt: '2026-08-25T12:00:04.000Z',
        succeededAt: '2026-08-25T12:00:05.000Z',
    }));
    assert.deepEqual(reopened.store.readSuccessfulBackupSnapshots().map(snapshot => snapshot.snapshotId), [
        SECOND_SNAPSHOT_ID,
        THIRD_SNAPSHOT_ID,
    ]);
    assert.equal(reopened.store.readBackupCleanupOperation(), null);
    await reopened.store.close();
});

test('ADR-07/TEST-PROTECT-003: an unexpected quarantine member stops exact deletion', async t => {
    const configured = await createTwoSuccessfulSnapshots(t);
    await commitDecision(configured.store, {
        commandId: THIRD_COMMAND_ID,
        followUpId: THIRD_FOLLOW_UP_ID,
        expectedRevision: '2',
        expectedSetupVersion: '1',
        decision: 'skip',
    });
    let injected = false;
    await assert.rejects(loadDurableBackup().runDurableBackupPass(
        configured.store,
        additionalRunOptions({
            operationId: THIRD_OPERATION_ID,
            snapshotId: THIRD_SNAPSHOT_ID,
            nonce: '2222222222222222',
            createdAt: '2026-08-25T12:00:04.000Z',
            succeededAt: '2026-08-25T12:00:05.000Z',
        }, point => {
            if (point === 'retention.after-quarantine-record' && !injected) {
                injected = true;
                throw new Error('stop with durable quarantine');
            }
        }),
    ), /stop with durable quarantine/);
    const cleanup = configured.store.readBackupCleanupOperation();
    assert.notEqual(cleanup, null);
    const quarantineDirectory = path.join(
        backupSetDirectory(configured.destination),
        cleanup!.quarantineDirectoryName,
    );
    writeFileSync(path.join(quarantineDirectory, 'unexpected.txt'), 'keep');

    await assert.rejects(loadDurableBackup().runDurableBackupPass(
        configured.store,
        additionalRunOptions({
            operationId: THIRD_OPERATION_ID,
            snapshotId: THIRD_SNAPSHOT_ID,
            nonce: '2222222222222222',
            createdAt: '2026-08-25T12:00:04.000Z',
            succeededAt: '2026-08-25T12:00:05.000Z',
        }),
    ), /Snapshot validation failed/);
    assert.equal(existsSync(path.join(quarantineDirectory, 'unexpected.txt')), true);
    assert.equal(configured.store.readBackupCleanupOperation()?.phase, 'quarantined');
    assert.deepEqual(configured.store.readSuccessfulBackupSnapshots().map(snapshot => snapshot.snapshotId), [
        SNAPSHOT_ID,
        SECOND_SNAPSHOT_ID,
        THIRD_SNAPSHOT_ID,
    ]);
    assert.equal(existsSync(path.join(
        backupSetDirectory(configured.destination),
        `snapshot-${SECOND_SNAPSHOT_ID}`,
    )), true);
    assert.equal(existsSync(path.join(
        backupSetDirectory(configured.destination),
        `snapshot-${THIRD_SNAPSHOT_ID}`,
    )), true);
    await configured.store.close();
});
