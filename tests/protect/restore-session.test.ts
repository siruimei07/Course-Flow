/**
 * @file Verifies WP-R6-01 candidate validation, preview binding, and safety sets.
 */

import assert from 'node:assert/strict';
import { LEVEL_13_DDL } from '../../src/data/schema/levels/level-13';
import { rebuildReceiptLedgerAtLevel } from '../data/schema-level.fixture';
import {createHash} from 'node:crypto';
import {
    appendFileSync,
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';

import {CURRENT_SCHEMA_LEVEL} from '../../src/data/schema';
import {resolveDirectoryCapability} from '../../src/platform/backup-destination';
import {canonicalJson} from '../../src/shared/canonical-json';
import {
    initializeWorkspaceData,
    openWorkspaceData,
    type SqliteDataStore,
} from '../../src/data/sqlite-data-store';
import * as durableBackup from '../../src/protect/durable-backup';
import {
    createSnapshotManifestV1,
    validateSnapshotManifestV1,
} from '../../src/protect/snapshot-manifest';
import {validateRestoreSafetyManifestV1} from '../../src/protect/restore-safety-manifest';
import {
    BACKUP_REPOSITORY_SCHEMA,
    normalizeAcceptedConfigureBackupDestinationCommand,
    type ConfirmRestoreSessionCommand,
    type RestoreCandidateProjection,
    type RestoreImpactSummary,
    type RestoreLibraryRootBinding,
    type RestoreSessionView,
    type RestoreSessionActionCommand,
    type StartRestoreSessionCommand,
} from '../../src/shared/workspace-protection-contract';
import {normalizeRecordSetupDecisionCommand} from '../../src/shared/workspace-data-contract';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const BACKUP_SET_ID = '22222222-2222-4222-8222-222222222222';
const CONFIGURE_COMMAND_ID = '33333333-3333-4333-8333-333333333333';
const CONFIGURE_FOLLOW_UP_ID = '44444444-4444-4444-8444-444444444444';
const BACKUP_OPERATION_ID = '55555555-5555-4555-8555-555555555555';
const CURRENT_SNAPSHOT_ID = '66666666-6666-4666-8666-666666666666';
const OLD_SNAPSHOT_ID = '77777777-7777-4777-8777-777777777777';
const INCOMPLETE_SNAPSHOT_ID = '88888888-8888-4888-8888-888888888888';
const CORRUPT_SNAPSHOT_ID = '99999999-9999-4999-8999-999999999999';
const FUTURE_SNAPSHOT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const START_COMMAND_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONFIRM_COMMAND_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DECISION_COMMAND_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DECISION_FOLLOW_UP_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const LIBRARY_ROOT_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const ROOT_GENERATION = '12121212-1212-4212-8212-121212121212';
const SYNC_OPERATION_ID = '14141414-1414-4414-8414-141414141414';
const SYNC_SNAPSHOT_ID = '15151515-1515-4515-8515-151515151515';
const SYNC_COMMAND_ID = '16161616-1616-4616-8616-161616161616';
const SYNC_FOLLOW_UP_ID = '17171717-1717-4717-8717-171717171717';
const RESUME_COMMAND_ID = '18181818-1818-4818-8818-181818181818';
const RETRY_COMMAND_ID = '19191919-1919-4919-8919-191919191919';
const ROLLBACK_COMMAND_ID = '20202020-2020-4020-8020-202020202020';
const CANCEL_COMMAND_ID = '21212121-2121-4121-8121-212121212121';
const SECOND_START_COMMAND_ID = '23232323-2323-4323-8323-232323232323';
const SECOND_CONFIRM_COMMAND_ID = '24242424-2424-4424-8424-242424242424';
const SECOND_RESUME_COMMAND_ID = '25252525-2525-4525-8525-252525252525';
const POST_RESTORE_COMMAND_ID = '26262626-2626-4626-8626-262626262626';
const POST_RESTORE_FOLLOW_UP_ID = '27272727-2727-4727-8727-272727272727';

type RestoreCoordinatorOptions = Readonly<{
    dataSlotsRoot?: string;
    currentLibraryBinding?: () => RestoreLibraryRootBinding;
    targetBindingVersion?: () => string;
    impactSummary?: (
        candidateRevision: string,
        currentRevision: string,
    ) => RestoreImpactSummary;
    failpoint?: (point: string) => void;
}>;

type RestoreCoordinator = Readonly<{
    listCandidates(): readonly RestoreCandidateProjection[];
    start(command: StartRestoreSessionCommand): Promise<RestoreSessionView>;
    confirm(command: ConfirmRestoreSessionCommand): Promise<RestoreSessionView>;
    cancelBeforeCheckpoint(command: RestoreSessionActionCommand): Promise<RestoreSessionView>;
    resume(command: RestoreSessionActionCommand): Promise<RestoreSessionView>;
    rollback(command: RestoreSessionActionCommand): Promise<RestoreSessionView>;
    query(restoreSessionId: string): RestoreSessionView;
    activeStore(): SqliteDataStore | null;
}>;

type RestoreBootState = Readonly<{
    kind: 'clear' | 'pre-checkpoint-session' | 'recovery-required' | 'committed';
    session: RestoreSessionView | null;
    terminal?: Readonly<{
        operationId: string;
        outcome: 'succeeded' | 'rolled-back';
        terminalRecordDigest: string;
        receiptDigest: string;
    }> | null;
}>;

type RestoreCoordinatorConstructor = {
    new (
        store: SqliteDataStore,
        activityControlRoot: string,
        options?: RestoreCoordinatorOptions,
        bootState?: RestoreBootState,
    ): RestoreCoordinator;
    recover(
        activityControlRoot: string,
        dataSlotsRoot: string,
        options?: RestoreCoordinatorOptions,
    ): RestoreCoordinator;
};

type RestoreAwareDurableBackup = Readonly<{
    runDurableBackupPass(
        store: SqliteDataStore,
        options: Readonly<{
            clock: Readonly<{now(): string}>;
            identityFactory(): Readonly<{
                operationId: string;
                snapshotId: string;
                nonce: string;
            }>;
            failpoint?: (point: string) => void;
        }>,
    ): Promise<void>;
    RestoreCoordinator: RestoreCoordinatorConstructor;
    inspectRestoreBeforeWorkspaceOpen(
        activityControlRoot: string,
        dataSlotsRoot: string,
    ): RestoreBootState;
}>;

type RestoreFixture = Readonly<{
    store: SqliteDataStore;
    dataSlotsRoot: string;
    destination: string;
    activityControlRoot: string;
    backupSetDirectory: string;
    currentSnapshotDirectory: string;
    trackStore(store: SqliteDataStore): void;
}>;

function restoreModule(): RestoreAwareDurableBackup {
    return durableBackup as unknown as RestoreAwareDurableBackup;
}

function createDirectory(prefix: string): string {
    return mkdtempSync(path.join(tmpdir(), prefix));
}

async function createFixture(t: test.TestContext): Promise<RestoreFixture> {
    const dataSlotsRoot = createDirectory('courseflow-restore-data-');
    const destination = resolveDirectoryCapability(
        createDirectory('courseflow-restore-backup-'),
    ).canonicalPath;
    const activityControlRoot = createDirectory('courseflow-restore-control-');
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const stores = [store];
    t.after(async () => {
        for (const trackedStore of stores) {
            await trackedStore.close();
        }
        for (const directory of [dataSlotsRoot, destination, activityControlRoot]) {
            rmSync(directory, {recursive: true, force: true});
        }
    });
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
    let clockCalls = 0;
    await restoreModule().runDurableBackupPass(store, {
        clock: {
            now(): string {
                clockCalls += 1;
                return clockCalls === 1
                    ? '2026-08-26T12:00:00.000Z'
                    : '2026-08-26T12:00:01.000Z';
            },
        },
        identityFactory: () => ({
            operationId: BACKUP_OPERATION_ID,
            snapshotId: CURRENT_SNAPSHOT_ID,
            nonce: '0123456789abcdef',
        }),
    });
    const backupSetDirectory = path.join(
        destination,
        'CourseFlow',
        WORKSPACE_ID,
        BACKUP_SET_ID,
    );
    return {
        store,
        dataSlotsRoot,
        destination,
        activityControlRoot,
        backupSetDirectory,
        currentSnapshotDirectory: path.join(
            backupSetDirectory,
            `snapshot-${CURRENT_SNAPSHOT_ID}`,
        ),
        trackStore(trackedStore: SqliteDataStore): void {
            stores.push(trackedStore);
        },
    };
}

function sha256(filePath: string): string {
    return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function createManifestForDatabase(
    sourceSnapshotDirectory: string,
    destinationDirectory: string,
    snapshotId: string,
    backupSequence: string,
    databaseSchemaLevel: string,
): void {
    const source = validateSnapshotManifestV1(readFileSync(path.join(
        sourceSnapshotDirectory,
        'manifest.json',
    )));
    const databasePath = path.join(destinationDirectory, 'workspace.sqlite');
    const databaseBytes = readFileSync(databasePath);
    writeFileSync(path.join(destinationDirectory, 'manifest.json'), createSnapshotManifestV1({
        ...source.input,
        snapshotId,
        backupSequence,
        database: {
            ...source.input.database,
            schemaLevel: databaseSchemaLevel,
        },
        members: [{
            path: 'workspace.sqlite',
            role: 'database',
            byteLength: databaseBytes.byteLength.toString(),
            sha256: createHash('sha256').update(databaseBytes).digest('hex'),
        }],
    }));
}

function createCandidateVariants(fixture: RestoreFixture): void {
    const oldDirectory = path.join(fixture.backupSetDirectory, `snapshot-${OLD_SNAPSHOT_ID}`);
    mkdirSync(oldDirectory);
    copyFileSync(
        path.join(fixture.currentSnapshotDirectory, 'workspace.sqlite'),
        path.join(oldDirectory, 'workspace.sqlite'),
    );
    const oldDatabase = new DatabaseSync(path.join(oldDirectory, 'workspace.sqlite'));
    rebuildReceiptLedgerAtLevel(oldDatabase, LEVEL_13_DDL);
    oldDatabase.exec(`
        DROP TABLE IF EXISTS restore_completion_receipts;
        DROP TABLE IF EXISTS restore_command_receipts;
        DROP TABLE IF EXISTS restore_sessions;
        DROP TABLE IF EXISTS backup_cleanup_operations;
        UPDATE backup_operations
        SET backup_sequence = 2,
            snapshot_id = '${OLD_SNAPSHOT_ID}';
        PRAGMA user_version = 13;
    `);
    oldDatabase.close();
    createManifestForDatabase(
        fixture.currentSnapshotDirectory,
        oldDirectory,
        OLD_SNAPSHOT_ID,
        '2',
        '13',
    );

    mkdirSync(path.join(
        fixture.backupSetDirectory,
        `snapshot-${INCOMPLETE_SNAPSHOT_ID}`,
    ));

    const corruptDirectory = path.join(
        fixture.backupSetDirectory,
        `snapshot-${CORRUPT_SNAPSHOT_ID}`,
    );
    mkdirSync(corruptDirectory);
    copyFileSync(
        path.join(fixture.currentSnapshotDirectory, 'workspace.sqlite'),
        path.join(corruptDirectory, 'workspace.sqlite'),
    );
    createManifestForDatabase(
        fixture.currentSnapshotDirectory,
        corruptDirectory,
        CORRUPT_SNAPSHOT_ID,
        '3',
        CURRENT_SCHEMA_LEVEL.toString(),
    );
    appendFileSync(path.join(corruptDirectory, 'workspace.sqlite'), Buffer.from([0]));

    const futureDirectory = path.join(
        fixture.backupSetDirectory,
        `snapshot-${FUTURE_SNAPSHOT_ID}`,
    );
    mkdirSync(futureDirectory);
    copyFileSync(
        path.join(fixture.currentSnapshotDirectory, 'workspace.sqlite'),
        path.join(futureDirectory, 'workspace.sqlite'),
    );
    const futureManifest = JSON.parse(readFileSync(path.join(
        fixture.currentSnapshotDirectory,
        'manifest.json',
    ), 'utf8')) as Record<string, unknown>;
    futureManifest.snapshotFormatVersion = '2';
    futureManifest.snapshotId = FUTURE_SNAPSHOT_ID;
    writeFileSync(
        path.join(futureDirectory, 'manifest.json'),
        JSON.stringify(futureManifest),
    );

    mkdirSync(path.join(fixture.backupSetDirectory, 'foreign-entry'));
}

test('TEST-PROTECT-004: five states are distinct and old DATA migrates only in a validation copy', async t => {
    const fixture = await createFixture(t);
    assert.doesNotThrow(() => fixture.store.inspectRestoreCandidateDatabase(path.join(
        fixture.currentSnapshotDirectory,
        'workspace.sqlite',
    )));
    createCandidateVariants(fixture);
    const coordinator = new (restoreModule().RestoreCoordinator)(
        fixture.store,
        fixture.activityControlRoot,
    );
    const candidates = coordinator.listCandidates();

    assert.deepEqual(new Set(candidates.map(candidate => candidate.status)), new Set([
        'verified',
        'incomplete-or-sync-pending',
        'corrupt',
        'incompatible',
        'unknown-entry',
    ]));
    assert.equal(candidates.some(candidate => candidate.status === 'verified'
        && candidate.compatibility === 'current'), true);
    const oldCandidate = candidates.find(candidate => candidate.snapshotId === OLD_SNAPSHOT_ID)!;
    assert.equal(oldCandidate.status, 'verified');
    assert.equal(oldCandidate.compatibility, 'migration-required');

    const rejected = candidates.find(candidate => candidate.status === 'corrupt')!;
    await assert.rejects(
        coordinator.start({commandId: START_COMMAND_ID, candidateRef: rejected.candidateRef}),
        error => (error as {code?: string}).code === 'snapshot-corrupt',
    );

    const originalDatabasePath = path.join(oldCandidate.snapshotId === OLD_SNAPSHOT_ID
        ? path.join(fixture.backupSetDirectory, `snapshot-${OLD_SNAPSHOT_ID}`)
        : fixture.currentSnapshotDirectory, 'workspace.sqlite');
    const originalManifestPath = path.join(
        fixture.backupSetDirectory,
        `snapshot-${OLD_SNAPSHOT_ID}`,
        'manifest.json',
    );
    const before = [sha256(originalDatabasePath), sha256(originalManifestPath)];
    const view = await coordinator.start({
        commandId: START_COMMAND_ID,
        candidateRef: oldCandidate.candidateRef,
    });

    assert.equal(view.phase, 'previewed');
    assert.equal(view.candidate.sourceSchemaLevel, '13');
    assert.equal(view.candidate.preparedSchemaLevel, CURRENT_SCHEMA_LEVEL.toString());
    assert.equal(view.candidate.validationCopy, 'migrated');
    assert.deepEqual([sha256(originalDatabasePath), sha256(originalManifestPath)], before);
    const operationDirectory = path.join(
        fixture.activityControlRoot,
        'restore',
        view.operationId,
    );
    assert.deepEqual(readdirSync(operationDirectory), [
        'candidate-validation',
        'journal',
        'session',
    ]);
    assert.deepEqual(readdirSync(path.join(operationDirectory, 'candidate-validation')), [
        'workspace.sqlite',
    ]);
    assert.equal(JSON.stringify(readdirSync(fixture.activityControlRoot)).includes('activation'), false);
    const confirmed = await coordinator.confirm({
        commandId: CONFIRM_COMMAND_ID,
        restoreSessionId: view.restoreSessionId,
        expectedSessionVersion: view.sessionVersion,
        previewToken: view.previewToken!,
    });
    assert.equal(confirmed.phase, 'protection-established');
    assert.equal(JSON.stringify(readdirSync(fixture.activityControlRoot)).includes('activation'), false);
});

test('ADR-07: registered operation staging never becomes a restore candidate', async t => {
    const fixture = await createFixture(t);
    const committed = await fixture.store.commit(normalizeRecordSetupDecisionCommand({
        commandId: SYNC_COMMAND_ID,
        followUpId: SYNC_FOLLOW_UP_ID,
        workspaceId: WORKSPACE_ID,
        expectedRevision: fixture.store.status().revision,
        expectedSetupVersion: '0',
        intent: {
            kind: 'workspace.record-setup-decision',
            intentSchemaVersion: 1,
            payload: {decision: 'later'},
        },
    }));
    assert.equal(committed.ok, true);
    await assert.rejects(restoreModule().runDurableBackupPass(fixture.store, {
        clock: {now: () => '2026-08-26T12:00:02.000Z'},
        identityFactory: () => ({
            operationId: SYNC_OPERATION_ID,
            snapshotId: SYNC_SNAPSHOT_ID,
            nonce: '1234567890abcdef',
        }),
        failpoint(point): void {
            if (point === 'backup.after-staging-create') {
                throw new Error('injected sync-pending snapshot');
            }
        },
    }), /injected sync-pending snapshot/);

    const coordinator = new (restoreModule().RestoreCoordinator)(
        fixture.store,
        fixture.activityControlRoot,
    );
    const candidate = coordinator.listCandidates().find(
        item => item.snapshotId === SYNC_SNAPSHOT_ID,
    );

    assert.equal(candidate, undefined);
});

test('A-DATA-005: healthy confirmation creates a distinct verified RestoreSafetySet', async t => {
    const fixture = await createFixture(t);
    const coordinator = new (restoreModule().RestoreCoordinator)(
        fixture.store,
        fixture.activityControlRoot,
    );
    const candidate = coordinator.listCandidates().find(item => item.status === 'verified')!;
    const preview = await coordinator.start({
        commandId: START_COMMAND_ID,
        candidateRef: candidate.candidateRef,
    });
    const confirmCommand = {
        commandId: CONFIRM_COMMAND_ID,
        restoreSessionId: preview.restoreSessionId,
        expectedSessionVersion: preview.sessionVersion,
        previewToken: preview.previewToken!,
    };
    const confirmed = await coordinator.confirm(confirmCommand);

    assert.equal(confirmed.phase, 'protection-established');
    assert.equal(confirmed.recoverability.safetySet.state, 'verified');
    if (confirmed.recoverability.safetySet.state !== 'verified') {
        throw new Error('Expected verified safety set');
    }
    assert.equal(
        confirmed.recoverability.safetySet.protectedRevision,
        fixture.store.status().revision,
    );
    const operationDirectory = path.join(
        fixture.activityControlRoot,
        'restore',
        confirmed.operationId,
    );
    assert.deepEqual(readdirSync(operationDirectory).sort(), [
        'candidate-validation',
        'journal',
        'safety',
        'session',
    ].sort());
    const safetyDirectory = path.join(
        operationDirectory,
        'safety',
        confirmed.recoverability.safetySet.safetySetId,
    );
    assert.deepEqual(readdirSync(safetyDirectory).sort(), ['manifest.json', 'workspace.sqlite']);
    const safetyManifestBytes = readFileSync(path.join(safetyDirectory, 'manifest.json'));
    const safetyManifest = validateRestoreSafetyManifestV1(safetyManifestBytes);
    assert.equal(safetyManifest.input.safetySetId, confirmed.recoverability.safetySet.safetySetId);
    assert.equal(safetyManifest.input.restoreSessionId, confirmed.restoreSessionId);
    assert.equal(safetyManifest.input.protectedRevision, confirmed.current.revision);
    assert.doesNotMatch(safetyManifestBytes.toString('utf8'), /backupSetId|backupSequence|snapshotId/);
    assert.throws(() => validateRestoreSafetyManifestV1(Buffer.from(
        safetyManifestBytes.toString('utf8').replace('"memberCount":"1"', '"memberCount":"2"'),
        'utf8',
    )));
    assert.equal(JSON.stringify(readdirSync(operationDirectory)).includes('activation'), false);
    assert.deepEqual(coordinator.query(confirmed.restoreSessionId), confirmed);
    assert.deepEqual(await coordinator.confirm(confirmCommand), confirmed);
    await assert.rejects(
        coordinator.confirm({...confirmCommand, previewToken: 'f'.repeat(64)}),
        error => (error as {code?: string}).code === 'conflict',
    );
});

test('TEST-WORKSPACE-002: concurrent confirmation replay converges on one safety set', async t => {
    const fixture = await createFixture(t);
    const coordinator = new (restoreModule().RestoreCoordinator)(
        fixture.store,
        fixture.activityControlRoot,
    );
    const candidate = coordinator.listCandidates().find(item => item.status === 'verified')!;
    const preview = await coordinator.start({
        commandId: START_COMMAND_ID,
        candidateRef: candidate.candidateRef,
    });
    const command = {
        commandId: CONFIRM_COMMAND_ID,
        restoreSessionId: preview.restoreSessionId,
        expectedSessionVersion: preview.sessionVersion,
        previewToken: preview.previewToken!,
    };

    const [first, replay] = await Promise.all([
        coordinator.confirm(command),
        coordinator.confirm(command),
    ]);

    assert.deepEqual(replay, first);
    assert.equal(first.phase, 'protection-established');
    assert.equal(first.recoverability.safetySet.state, 'verified');
    assert.equal(readdirSync(path.join(
        fixture.activityControlRoot,
        'restore',
        first.operationId,
        'safety',
    )).length, 1);
});

test('TEST-WORKSPACE-002: command replay is stable and changed candidate reuse conflicts', async t => {
    const fixture = await createFixture(t);
    const coordinator = new (restoreModule().RestoreCoordinator)(
        fixture.store,
        fixture.activityControlRoot,
    );
    const candidate = coordinator.listCandidates().find(item => item.status === 'verified')!;
    const command = {commandId: START_COMMAND_ID, candidateRef: candidate.candidateRef};
    const first = await coordinator.start(command);

    assert.deepEqual(await coordinator.start(command), first);
    createCandidateVariants(fixture);
    const different = coordinator.listCandidates().find(item => item.snapshotId === OLD_SNAPSHOT_ID)!;
    await assert.rejects(
        coordinator.start({commandId: START_COMMAND_ID, candidateRef: different.candidateRef}),
        error => (error as {code?: string}).code === 'conflict',
    );
});

test('ADR-08: a second nonterminal RestoreSession is rejected at its DATA owner', async t => {
    const fixture = await createFixture(t);
    const coordinator = new (restoreModule().RestoreCoordinator)(
        fixture.store,
        fixture.activityControlRoot,
    );
    const candidate = coordinator.listCandidates().find(item => item.status === 'verified')!;
    await coordinator.start({commandId: START_COMMAND_ID, candidateRef: candidate.candidateRef});

    await assert.rejects(
        coordinator.start({
            commandId: SECOND_START_COMMAND_ID,
            candidateRef: candidate.candidateRef,
        }),
        error => (error as {code?: string}).code === 'conflict',
    );
});

test('ADR-08: preview and CommandId receipt survive a DATA reopen', async t => {
    const fixture = await createFixture(t);
    const coordinator = new (restoreModule().RestoreCoordinator)(
        fixture.store,
        fixture.activityControlRoot,
    );
    const candidate = coordinator.listCandidates().find(item => item.status === 'verified')!;
    const command = {commandId: START_COMMAND_ID, candidateRef: candidate.candidateRef};
    const preview = await coordinator.start(command);
    await fixture.store.close();

    const reopened = openWorkspaceData(fixture.dataSlotsRoot);
    assert.equal(reopened.kind, 'ready');
    if (reopened.kind !== 'ready') {
        throw new Error('Expected reopened DATA');
    }
    fixture.trackStore(reopened.store);
    const restarted = new (restoreModule().RestoreCoordinator)(
        reopened.store,
        fixture.activityControlRoot,
    );

    assert.deepEqual(restarted.query(preview.restoreSessionId), preview);
    assert.equal((await restarted.start(command)).restoreSessionId, preview.restoreSessionId);
    const confirmed = await restarted.confirm({
        commandId: CONFIRM_COMMAND_ID,
        restoreSessionId: preview.restoreSessionId,
        expectedSessionVersion: preview.sessionVersion,
        previewToken: preview.previewToken!,
    });
    assert.equal(confirmed.phase, 'protection-established');
    await reopened.store.close();
    const reopenedAfterProtection = openWorkspaceData(fixture.dataSlotsRoot);
    assert.equal(reopenedAfterProtection.kind, 'ready');
    if (reopenedAfterProtection.kind !== 'ready') {
        throw new Error('Expected protected DATA to reopen');
    }
    fixture.trackStore(reopenedAfterProtection.store);
    const protectedRestart = new (restoreModule().RestoreCoordinator)(
        reopenedAfterProtection.store,
        fixture.activityControlRoot,
    );
    assert.deepEqual(protectedRestart.query(confirmed.restoreSessionId), confirmed);
});

test('TEST-WORKSPACE-002: an expired preview token requires a new preview', async t => {
    const fixture = await createFixture(t);
    const coordinator = new (restoreModule().RestoreCoordinator)(
        fixture.store,
        fixture.activityControlRoot,
    );
    const candidate = coordinator.listCandidates().find(item => item.status === 'verified')!;
    const preview = await coordinator.start({
        commandId: START_COMMAND_ID,
        candidateRef: candidate.candidateRef,
    });

    const result = await coordinator.confirm({
        commandId: CONFIRM_COMMAND_ID,
        restoreSessionId: preview.restoreSessionId,
        expectedSessionVersion: preview.sessionVersion,
        previewToken: 'f'.repeat(64),
    });

    assert.equal(result.phase, 'waiting-decision');
    assert.equal(result.previewToken, null);
    assert.deepEqual(result.problem, {code: 'impact-changed'});
    await assert.rejects(coordinator.confirm({
        commandId: SYNC_COMMAND_ID,
        restoreSessionId: result.restoreSessionId,
        expectedSessionVersion: result.sessionVersion,
        previewToken: 'e'.repeat(64),
    }), error => (error as {code?: string}).code === 'conflict');
});

test('TEST-PROTECT-004: revision advancement during safety copy invalidates confirmation', async t => {
    const fixture = await createFixture(t);
    const coordinator = new (restoreModule().RestoreCoordinator)(
        fixture.store,
        fixture.activityControlRoot,
    );
    const candidate = coordinator.listCandidates().find(item => item.status === 'verified')!;
    const preview = await coordinator.start({
        commandId: START_COMMAND_ID,
        candidateRef: candidate.candidateRef,
    });
    const writeSafetyCopy = fixture.store.writeRestoreSafetyDatabaseCopy.bind(fixture.store);
    fixture.store.writeRestoreSafetyDatabaseCopy = async (
        destinationPath,
        expectedRevision,
    ) => {
        const committed = await fixture.store.commit(normalizeRecordSetupDecisionCommand({
            commandId: DECISION_COMMAND_ID,
            followUpId: DECISION_FOLLOW_UP_ID,
            workspaceId: WORKSPACE_ID,
            expectedRevision,
            expectedSetupVersion: '0',
            intent: {
                kind: 'workspace.record-setup-decision',
                intentSchemaVersion: 1,
                payload: {decision: 'later'},
            },
        }));
        assert.equal(committed.ok, true);
        return writeSafetyCopy(destinationPath, expectedRevision);
    };

    const result = await coordinator.confirm({
        commandId: CONFIRM_COMMAND_ID,
        restoreSessionId: preview.restoreSessionId,
        expectedSessionVersion: preview.sessionVersion,
        previewToken: preview.previewToken!,
    });

    assert.equal(result.phase, 'waiting-decision');
    assert.deepEqual(result.problem, {code: 'impact-changed'});
    assert.equal(result.recoverability.safetySet.state, 'pending');
});

test('TEST-PROTECT-004: every bound preview fact invalidates confirmation when changed', async t => {
    const cases = [
        'candidate',
        'candidate-validation-copy',
        'current-revision',
        'library-generation',
        'target',
        'impact',
    ] as const;
    for (const changed of cases) {
        await t.test(changed, async child => {
            const fixture = await createFixture(child);
            let libraryRoot: RestoreLibraryRootBinding = changed === 'library-generation'
                ? {kind: 'present', libraryRootId: LIBRARY_ROOT_ID, rootGeneration: ROOT_GENERATION}
                : {kind: 'absent'};
            let targetBindingVersion = '1';
            let termCount = '0';
            const coordinator = new (restoreModule().RestoreCoordinator)(
                fixture.store,
                fixture.activityControlRoot,
                {
                    currentLibraryBinding: () => libraryRoot,
                    targetBindingVersion: () => targetBindingVersion,
                    impactSummary: (candidateRevision, currentRevision) => ({
                        replacement: 'complete',
                        automaticMerge: false,
                        termCount,
                        courseCount: '0',
                        taskSeriesCount: '0',
                        currentRevision,
                        candidateRevision,
                    }),
                },
            );
            const candidate = coordinator.listCandidates().find(item => item.status === 'verified')!;
            const preview = await coordinator.start({
                commandId: START_COMMAND_ID,
                candidateRef: candidate.candidateRef,
            });

            if (changed === 'candidate') {
                appendFileSync(path.join(
                    fixture.currentSnapshotDirectory,
                    'workspace.sqlite',
                ), Buffer.from([0]));
            }
            else if (changed === 'candidate-validation-copy') {
                appendFileSync(path.join(
                    fixture.activityControlRoot,
                    'restore',
                    preview.operationId,
                    'candidate-validation',
                    'workspace.sqlite',
                ), Buffer.from([0]));
            }
            else if (changed === 'current-revision') {
                const committed = await fixture.store.commit(normalizeRecordSetupDecisionCommand({
                    commandId: DECISION_COMMAND_ID,
                    followUpId: DECISION_FOLLOW_UP_ID,
                    workspaceId: WORKSPACE_ID,
                    expectedRevision: fixture.store.status().revision,
                    expectedSetupVersion: '0',
                    intent: {
                        kind: 'workspace.record-setup-decision',
                        intentSchemaVersion: 1,
                        payload: {decision: 'later'},
                    },
                }));
                assert.equal(committed.ok, true);
            }
            else if (changed === 'library-generation') {
                libraryRoot = {
                    kind: 'present',
                    libraryRootId: LIBRARY_ROOT_ID,
                    rootGeneration: '13131313-1313-4313-8313-131313131313',
                };
            }
            else if (changed === 'target') {
                targetBindingVersion = '2';
            }
            else {
                termCount = '1';
            }

            const result = await coordinator.confirm({
                commandId: CONFIRM_COMMAND_ID,
                restoreSessionId: preview.restoreSessionId,
                expectedSessionVersion: preview.sessionVersion,
                previewToken: preview.previewToken!,
            });
            assert.equal(result.phase, 'waiting-decision');
            assert.deepEqual(result.problem, {code: 'impact-changed'});
            assert.deepEqual(result.allowedActions, ['repreview', 'cancel-before-checkpoint']);
            assert.deepEqual(readdirSync(path.join(
                fixture.activityControlRoot,
                'restore',
                preview.operationId,
            )), ['candidate-validation', 'journal', 'session']);
        });
    }
});

async function createProtectedActivation(
    fixture: RestoreFixture,
    options: RestoreCoordinatorOptions = {},
): Promise<Readonly<{
    coordinator: RestoreCoordinator;
    protectedSession: RestoreSessionView;
    currentRevision: string;
    candidateRevision: string;
}>> {
    const committed = await fixture.store.commit(normalizeRecordSetupDecisionCommand({
        commandId: DECISION_COMMAND_ID,
        followUpId: DECISION_FOLLOW_UP_ID,
        workspaceId: WORKSPACE_ID,
        expectedRevision: fixture.store.status().revision,
        expectedSetupVersion: '0',
        intent: {
            kind: 'workspace.record-setup-decision',
            intentSchemaVersion: 1,
            payload: {decision: 'later'},
        },
    }));
    assert.equal(committed.ok, true);
    const coordinator = new (restoreModule().RestoreCoordinator)(
        fixture.store,
        fixture.activityControlRoot,
        {dataSlotsRoot: fixture.dataSlotsRoot, ...options},
    );
    const candidate = coordinator.listCandidates().find(item => item.status === 'verified')!;
    const preview = await coordinator.start({
        commandId: START_COMMAND_ID,
        candidateRef: candidate.candidateRef,
    });
    const protectedSession = await coordinator.confirm({
        commandId: CONFIRM_COMMAND_ID,
        restoreSessionId: preview.restoreSessionId,
        expectedSessionVersion: preview.sessionVersion,
        previewToken: preview.previewToken!,
    });
    return {
        coordinator,
        protectedSession,
        currentRevision: protectedSession.current.revision,
        candidateRevision: protectedSession.candidate.actualRevision,
    };
}

function journalKinds(fixture: RestoreFixture, operationId: string): readonly string[] {
    const journalDirectory = path.join(
        fixture.activityControlRoot,
        'restore',
        operationId,
        'journal',
    );
    return readdirSync(journalDirectory).sort().map(name => (
        (JSON.parse(readFileSync(path.join(journalDirectory, name), 'utf8')) as {kind: string}).kind
    ));
}

test('TEST-DATA-006: cancellation before armed checkpoint keeps active DATA current', async t => {
    const fixture = await createFixture(t);
    const activation = await createProtectedActivation(fixture);

    const cancelled = await activation.coordinator.cancelBeforeCheckpoint({
        commandId: CANCEL_COMMAND_ID,
        restoreSessionId: activation.protectedSession.restoreSessionId,
        expectedSessionVersion: activation.protectedSession.sessionVersion,
    });

    assert.equal(cancelled.phase, 'cancelled');
    assert.equal(cancelled.sessionVersion, '2');
    assert.deepEqual(cancelled.allowedActions, []);
    assert.equal(fixture.store.status().revision, activation.currentRevision);
    assert.equal(existsSync(path.join(fixture.dataSlotsRoot, 'active')), true);
    assert.equal(existsSync(path.join(
        fixture.activityControlRoot,
        'restore',
        cancelled.operationId,
        'activation-plan-v1',
    )), false);
    assert.deepEqual(journalKinds(fixture, cancelled.operationId), []);
    assert.equal(restoreModule().inspectRestoreBeforeWorkspaceOpen(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
    ).kind, 'clear');

    const reopened = openWorkspaceData(fixture.dataSlotsRoot);
    assert.equal(reopened.kind, 'ready');
    if (reopened.kind !== 'ready') {
        throw new Error('Expected unchanged active DATA to reopen');
    }
    fixture.trackStore(reopened.store);
    const recovered = new (restoreModule().RestoreCoordinator)(
        reopened.store,
        fixture.activityControlRoot,
        {dataSlotsRoot: fixture.dataSlotsRoot},
    );
    assert.equal(recovered.query(cancelled.restoreSessionId).phase, 'cancelled');
});

test('TEST-DATA-006: cancelled DATA truth survives lost external mirror publication', async t => {
    const fixture = await createFixture(t);
    let interruptCancellation = false;
    let interrupted = false;
    const activation = await createProtectedActivation(fixture, {
        failpoint(point) {
            if (interruptCancellation
                && !interrupted
                && point === 'session-record.after-temp-write') {
                interrupted = true;
                throw new Error(point);
            }
        },
    });
    interruptCancellation = true;
    const command = {
        commandId: CANCEL_COMMAND_ID,
        restoreSessionId: activation.protectedSession.restoreSessionId,
        expectedSessionVersion: activation.protectedSession.sessionVersion,
    } as const;

    await assert.rejects(
        activation.coordinator.cancelBeforeCheckpoint(command),
        /session-record\.after-temp-write/,
    );
    assert.equal(
        activation.coordinator.query(command.restoreSessionId).phase,
        'cancelled',
    );
    assert.equal((await activation.coordinator.cancelBeforeCheckpoint(command)).phase, 'cancelled');
    assert.equal(restoreModule().inspectRestoreBeforeWorkspaceOpen(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
    ).kind, 'clear');
    assert.equal(fixture.store.status().revision, activation.currentRevision);
});

test('TEST-DATA-006: pre-checkpoint phase failpoints keep old DATA openable', async t => {
    for (const point of [
        'activation.after-candidate-stage',
        'activation.after-candidate-stage-validation',
        'activation-close.before-wal-checkpoint',
        'activation-close.after-wal-checkpoint',
        'activation.before-data-close',
        'activation.after-data-close',
        'activation-plan.after-temp-write',
        'activation-plan.after-temp-sync',
        'activation-plan.after-temp-close',
        'activation-plan.after-publish',
        'activation-plan.after-reopen',
        'journal.armed.before-temp-write',
        'journal.armed.after-temp-write',
        'journal.armed.after-temp-sync',
        'journal.armed.after-temp-close',
    ]) {
        await t.test(point, async child => {
            const fixture = await createFixture(child);
            const activation = await createProtectedActivation(fixture, {
                failpoint(candidate) {
                    if (candidate === point) {
                        throw new Error(candidate);
                    }
                },
            });
            await assert.rejects(activation.coordinator.resume({
                commandId: RESUME_COMMAND_ID,
                restoreSessionId: activation.protectedSession.restoreSessionId,
                expectedSessionVersion: activation.protectedSession.sessionVersion,
            }), /staging-failed/);
            const activeStore = activation.coordinator.activeStore();
            if (activeStore && activeStore !== fixture.store) {
                fixture.trackStore(activeStore);
            }
            assert.equal(
                activeStore?.status().revision,
                activation.currentRevision,
            );
            assert.equal(restoreModule().inspectRestoreBeforeWorkspaceOpen(
                fixture.activityControlRoot,
                fixture.dataSlotsRoot,
            ).kind, 'pre-checkpoint-session');
        });
    }
});

test('TEST-DATA-006: cancellation after an unpublished armed record clears the boot gate', async t => {
    const fixture = await createFixture(t);
    const activation = await createProtectedActivation(fixture, {
        failpoint(point) {
            if (point === 'journal.armed.after-temp-sync') {
                throw new Error(point);
            }
        },
    });
    await assert.rejects(activation.coordinator.resume({
        commandId: RESUME_COMMAND_ID,
        restoreSessionId: activation.protectedSession.restoreSessionId,
        expectedSessionVersion: activation.protectedSession.sessionVersion,
    }), /staging-failed/);

    const cancelled = await activation.coordinator.cancelBeforeCheckpoint({
        commandId: CANCEL_COMMAND_ID,
        restoreSessionId: activation.protectedSession.restoreSessionId,
        expectedSessionVersion: activation.protectedSession.sessionVersion,
    });
    const activeStore = activation.coordinator.activeStore();
    if (activeStore && activeStore !== fixture.store) {
        fixture.trackStore(activeStore);
    }
    assert.equal(cancelled.phase, 'cancelled');
    assert.equal(restoreModule().inspectRestoreBeforeWorkspaceOpen(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
    ).kind, 'clear');
});

test('TEST-DATA-006: changed target staging or safety evidence stops before armed', async t => {
    for (const changed of ['candidate-validation', 'safety-set'] as const) {
        await t.test(changed, async child => {
            const fixture = await createFixture(child);
            const activation = await createProtectedActivation(fixture);
            const safety = activation.protectedSession.recoverability.safetySet;
            assert.equal(safety.state, 'verified');
            if (safety.state !== 'verified') {
                throw new Error('Expected verified RestoreSafetySet');
            }
            const changedPath = changed === 'candidate-validation'
                ? path.join(
                    fixture.activityControlRoot,
                    'restore',
                    activation.protectedSession.operationId,
                    'candidate-validation',
                    'workspace.sqlite',
                )
                : path.join(
                    fixture.activityControlRoot,
                    'restore',
                    activation.protectedSession.operationId,
                    'safety',
                    safety.safetySetId,
                    'workspace.sqlite',
                );
            appendFileSync(changedPath, Buffer.from([0]));

            try {
                await assert.rejects(activation.coordinator.resume({
                    commandId: RESUME_COMMAND_ID,
                    restoreSessionId: activation.protectedSession.restoreSessionId,
                    expectedSessionVersion: activation.protectedSession.sessionVersion,
                }), /staging-failed/);
            }
            finally {
                const activeStore = activation.coordinator.activeStore();
                if (activeStore && activeStore !== fixture.store) {
                    fixture.trackStore(activeStore);
                }
            }
            assert.equal(restoreModule().inspectRestoreBeforeWorkspaceOpen(
                fixture.activityControlRoot,
                fixture.dataSlotsRoot,
            ).kind, 'pre-checkpoint-session');
        });
    }
});

test('TEST-DATA-006: a published armed record is the exact ordinary-open checkpoint', async t => {
    for (const point of [
        'journal.armed.after-publish',
        'journal.armed.after-reopen',
        'activation.after-armed',
    ]) {
        await t.test(point, async child => {
            const fixture = await createFixture(child);
            const activation = await createProtectedActivation(fixture, {
                failpoint(candidate) {
                    if (candidate === point) {
                        throw new Error(candidate);
                    }
                },
            });
            await assert.rejects(activation.coordinator.resume({
                commandId: RESUME_COMMAND_ID,
                restoreSessionId: activation.protectedSession.restoreSessionId,
                expectedSessionVersion: activation.protectedSession.sessionVersion,
            }), /activation-pending/);
            assert.equal(activation.coordinator.activeStore(), null);
            assert.equal(restoreModule().inspectRestoreBeforeWorkspaceOpen(
                fixture.activityControlRoot,
                fixture.dataSlotsRoot,
            ).kind, 'recovery-required');
        });
    }
});

test('TEST-DATA-006: a known journal kind out of state is conflicting evidence', async t => {
    const fixture = await createFixture(t);
    const activation = await createProtectedActivation(fixture, {
        failpoint(point) {
            if (point === 'activation.after-armed') {
                throw new Error(point);
            }
        },
    });
    await assert.rejects(activation.coordinator.resume({
        commandId: RESUME_COMMAND_ID,
        restoreSessionId: activation.protectedSession.restoreSessionId,
        expectedSessionVersion: activation.protectedSession.sessionVersion,
    }), /activation-pending/);
    const operationDirectory = path.join(
        fixture.activityControlRoot,
        'restore',
        activation.protectedSession.operationId,
    );
    const journalDirectory = path.join(operationDirectory, 'journal');
    const armed = JSON.parse(readFileSync(path.join(
        journalDirectory,
        readdirSync(journalDirectory)[0]!,
    ), 'utf8')) as {recordDigest: string; planDigest: string};
    const undigested = {
        schema: 'courseflow-activation-journal-record-v1',
        operationId: activation.protectedSession.operationId,
        sequence: '2',
        kind: 'observed-retire-old-data',
        previousRecordDigest: armed.recordDigest,
        planDigest: armed.planDigest,
        expectedFingerprints: {},
        observedFingerprints: {},
        createdAt: '2026-08-26T12:00:00.000Z',
    };
    const record = {
        ...undigested,
        recordDigest: createHash('sha256')
            .update(canonicalJson(undigested), 'utf8')
            .digest('hex'),
    };
    writeFileSync(
        path.join(
            journalDirectory,
            `000002-observed-retire-old-data-${record.recordDigest}`,
        ),
        canonicalJson(record),
    );

    const boot = restoreModule().inspectRestoreBeforeWorkspaceOpen(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
    );
    assert.equal(boot.kind, 'recovery-required');
    assert.equal(boot.session, null);
});

test('TEST-DATA-006: a legal journal kind with impossible nested evidence is rejected', async t => {
    const fixture = await createFixture(t);
    const activation = await createProtectedActivation(fixture, {
        failpoint(point) {
            if (point === 'activation.after-armed') {
                throw new Error(point);
            }
        },
    });
    await assert.rejects(activation.coordinator.resume({
        commandId: RESUME_COMMAND_ID,
        restoreSessionId: activation.protectedSession.restoreSessionId,
        expectedSessionVersion: activation.protectedSession.sessionVersion,
    }), /activation-pending/);
    const journalDirectory = path.join(
        fixture.activityControlRoot,
        'restore',
        activation.protectedSession.operationId,
        'journal',
    );
    const armed = JSON.parse(readFileSync(path.join(
        journalDirectory,
        readdirSync(journalDirectory)[0]!,
    ), 'utf8')) as {recordDigest: string; planDigest: string};
    const undigested = {
        schema: 'courseflow-activation-journal-record-v1',
        operationId: activation.protectedSession.operationId,
        sequence: '2',
        kind: 'intent-retire-old-data',
        previousRecordDigest: armed.recordDigest,
        planDigest: armed.planDigest,
        expectedFingerprints: {before: {}, after: {}},
        observedFingerprints: null,
        createdAt: '2026-08-26T12:00:00.000Z',
    };
    const record = {
        ...undigested,
        recordDigest: createHash('sha256')
            .update(canonicalJson(undigested), 'utf8')
            .digest('hex'),
    };
    writeFileSync(
        path.join(journalDirectory, `000002-intent-retire-old-data-${record.recordDigest}`),
        canonicalJson(record),
    );

    const boot = restoreModule().inspectRestoreBeforeWorkspaceOpen(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
    );
    assert.equal(boot.kind, 'recovery-required');
    assert.equal(boot.session, null);
});

test('TEST-DATA-006: an unknown operation control artifact blocks evidence-based actions', async t => {
    const fixture = await createFixture(t);
    const activation = await createProtectedActivation(fixture, {
        failpoint(point) {
            if (point === 'activation.after-armed') {
                throw new Error(point);
            }
        },
    });
    await assert.rejects(activation.coordinator.resume({
        commandId: RESUME_COMMAND_ID,
        restoreSessionId: activation.protectedSession.restoreSessionId,
        expectedSessionVersion: activation.protectedSession.sessionVersion,
    }), /activation-pending/);
    writeFileSync(path.join(
        fixture.activityControlRoot,
        'restore',
        activation.protectedSession.operationId,
        'unknown-control',
    ), 'unknown');

    const boot = restoreModule().inspectRestoreBeforeWorkspaceOpen(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
    );
    assert.equal(boot.kind, 'recovery-required');
    assert.equal(boot.session, null);
});

test('TEST-DATA-006: duplicate slot evidence exposes no physical recovery action', async t => {
    const fixture = await createFixture(t);
    const activation = await createProtectedActivation(fixture, {
        failpoint(point) {
            if (point === 'activation.after-armed') {
                throw new Error(point);
            }
        },
    });
    await assert.rejects(activation.coordinator.resume({
        commandId: RESUME_COMMAND_ID,
        restoreSessionId: activation.protectedSession.restoreSessionId,
        expectedSessionVersion: activation.protectedSession.sessionVersion,
    }), /activation-pending/);
    const candidateName = `.restore-candidate-${activation.protectedSession.operationId}`;
    const quarantineName = `.restore-quarantine-${activation.protectedSession.operationId}`;
    mkdirSync(path.join(fixture.dataSlotsRoot, quarantineName));
    copyFileSync(
        path.join(fixture.dataSlotsRoot, candidateName, 'workspace.sqlite'),
        path.join(fixture.dataSlotsRoot, quarantineName, 'workspace.sqlite'),
    );

    const boot = restoreModule().inspectRestoreBeforeWorkspaceOpen(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
    );
    assert.equal(boot.kind, 'recovery-required');
    assert.deepEqual(boot.session?.allowedActions, []);
});

test('TEST-DATA-006: A-only activation stages beside DATA and commits DATA last', async t => {
    const fixture = await createFixture(t);
    const activation = await createProtectedActivation(fixture);

    const succeeded = await activation.coordinator.resume({
        commandId: RESUME_COMMAND_ID,
        restoreSessionId: activation.protectedSession.restoreSessionId,
        expectedSessionVersion: activation.protectedSession.sessionVersion,
    });

    assert.equal(succeeded.phase, 'succeeded');
    assert.equal(succeeded.sessionVersion, '3');
    assert.deepEqual(succeeded.allowedActions, []);
    assert.equal(succeeded.candidate.actualRevision, activation.candidateRevision);
    assert.notEqual(activation.currentRevision, activation.candidateRevision);
    assert.doesNotMatch(JSON.stringify(succeeded), /workspace\.sqlite|[A-Za-z]:[\\/]|\/Users\//);

    const activeStore = activation.coordinator.activeStore();
    assert.ok(activeStore);
    fixture.trackStore(activeStore);
    assert.equal(activeStore.status().revision, activation.candidateRevision);
    const receipt = activeStore.readRestoreCompletionReceipt(succeeded.operationId);
    assert.equal(receipt?.outcome, 'succeeded');
    assert.equal(receipt?.sessionVersion, '3');
    const rollbackSibling = path.join(
        fixture.dataSlotsRoot,
        `.restore-rollback-${succeeded.operationId}`,
    );
    assert.equal(existsSync(rollbackSibling), true);
    const rollbackDatabase = new DatabaseSync(path.join(rollbackSibling, 'workspace.sqlite'), {
        readOnly: true,
        readBigInts: true,
    });
    try {
        assert.equal(
            (rollbackDatabase.prepare(
                'SELECT revision FROM workspace_state WHERE singleton = 1',
            ).get() as {revision: bigint}).revision.toString(),
            activation.currentRevision,
        );
    }
    finally {
        rollbackDatabase.close();
    }

    const kinds = journalKinds(fixture, succeeded.operationId);
    assert.deepEqual(kinds.filter(kind => kind !== 'command-resume'), [
        'armed',
        'intent-retire-old-data',
        'observed-retire-old-data',
        'intent-install-candidate-data',
        'observed-install-candidate-data',
        'candidate-installed',
        'reopened',
        'success-receipt',
        'committed',
    ]);
});

test('TEST-DATA-006: a later successful replacement chains prior terminal evidence', async t => {
    const fixture = await createFixture(t);
    const firstActivation = await createProtectedActivation(fixture);
    const first = await firstActivation.coordinator.resume({
        commandId: RESUME_COMMAND_ID,
        restoreSessionId: firstActivation.protectedSession.restoreSessionId,
        expectedSessionVersion: firstActivation.protectedSession.sessionVersion,
    });
    const firstStore = firstActivation.coordinator.activeStore();
    assert.ok(firstStore);
    fixture.trackStore(firstStore);
    const postRestore = await firstStore.commit(normalizeRecordSetupDecisionCommand({
        commandId: POST_RESTORE_COMMAND_ID,
        followUpId: POST_RESTORE_FOLLOW_UP_ID,
        workspaceId: WORKSPACE_ID,
        expectedRevision: firstStore.status().revision,
        expectedSetupVersion: '0',
        intent: {
            kind: 'workspace.record-setup-decision',
            intentSchemaVersion: 1,
            payload: {decision: 'later'},
        },
    }));
    assert.equal(postRestore.ok, true);

    const advancedBoot = restoreModule().inspectRestoreBeforeWorkspaceOpen(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
    );
    assert.equal(advancedBoot.kind, 'committed');

    const candidate = firstActivation.coordinator.listCandidates()
        .find(item => item.status === 'verified');
    assert.ok(candidate);
    const preview = await firstActivation.coordinator.start({
        commandId: SECOND_START_COMMAND_ID,
        candidateRef: candidate.candidateRef,
    });
    const protectedSession = await firstActivation.coordinator.confirm({
        commandId: SECOND_CONFIRM_COMMAND_ID,
        restoreSessionId: preview.restoreSessionId,
        expectedSessionVersion: preview.sessionVersion,
        previewToken: preview.previewToken!,
    });
    await firstStore.close();
    const preCheckpointBoot = restoreModule().inspectRestoreBeforeWorkspaceOpen(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
    );
    assert.equal(preCheckpointBoot.kind, 'pre-checkpoint-session');
    assert.equal(preCheckpointBoot.terminal?.operationId, first.operationId);
    const reopened = openWorkspaceData(fixture.dataSlotsRoot);
    assert.equal(reopened.kind, 'ready');
    if (reopened.kind !== 'ready') {
        throw new Error('Expected pre-checkpoint DATA to reopen');
    }
    fixture.trackStore(reopened.store);
    const restarted = new (restoreModule().RestoreCoordinator)(
        reopened.store,
        fixture.activityControlRoot,
        {dataSlotsRoot: fixture.dataSlotsRoot},
        preCheckpointBoot,
    );
    const second = await restarted.resume({
        commandId: SECOND_RESUME_COMMAND_ID,
        restoreSessionId: protectedSession.restoreSessionId,
        expectedSessionVersion: protectedSession.sessionVersion,
    });
    const secondStore = restarted.activeStore();
    assert.ok(secondStore);
    assert.notEqual(secondStore, firstStore);
    fixture.trackStore(secondStore);

    const boot = restoreModule().inspectRestoreBeforeWorkspaceOpen(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
    );
    assert.equal(boot.kind, 'committed');
    assert.equal(boot.session?.operationId, second.operationId);
    const secondPlan = JSON.parse(readFileSync(path.join(
        fixture.activityControlRoot,
        'restore',
        second.operationId,
        'activation-plan-v1',
    ), 'utf8')) as {previousTerminal: {operationId: string}};
    assert.equal(secondPlan.previousTerminal.operationId, first.operationId);
});

test('TEST-DATA-006: terminal success revalidates every slot after DATA reopen', async t => {
    const fixture = await createFixture(t);
    let operationId = '';
    const activation = await createProtectedActivation(fixture, {
        failpoint(point) {
            if (point === 'journal.reopened.after-reopen') {
                appendFileSync(path.join(
                    fixture.dataSlotsRoot,
                    `.restore-rollback-${operationId}`,
                    'workspace.sqlite',
                ), Buffer.from([0]));
            }
        },
    });
    operationId = activation.protectedSession.operationId;

    await assert.rejects(activation.coordinator.resume({
        commandId: RESUME_COMMAND_ID,
        restoreSessionId: activation.protectedSession.restoreSessionId,
        expectedSessionVersion: activation.protectedSession.sessionVersion,
    }), /activation-pending/);
    const boot = restoreModule().inspectRestoreBeforeWorkspaceOpen(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
    );
    assert.equal(boot.kind, 'recovery-required');
    assert.equal(boot.session, null);
});

test('TEST-DATA-006: restart observes a lost retire response before explicit resume', async t => {
    const fixture = await createFixture(t);
    const activation = await createProtectedActivation(fixture, {
        failpoint(point) {
            if (point === 'activation.after-retire-action') {
                throw new Error(point);
            }
        },
    });

    await assert.rejects(activation.coordinator.resume({
        commandId: RESUME_COMMAND_ID,
        restoreSessionId: activation.protectedSession.restoreSessionId,
        expectedSessionVersion: activation.protectedSession.sessionVersion,
    }), /activation-pending/);
    assert.equal(existsSync(path.join(fixture.dataSlotsRoot, 'active')), false);
    assert.equal(existsSync(path.join(
        fixture.dataSlotsRoot,
        `.restore-rollback-${activation.protectedSession.operationId}`,
    )), true);

    const boot = restoreModule().inspectRestoreBeforeWorkspaceOpen(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
    );

    assert.equal(boot.kind, 'recovery-required');
    assert.equal(boot.session?.phase, 'recovery-required');
    assert.deepEqual(boot.session?.allowedActions, ['resume', 'rollback']);
    assert.equal(existsSync(path.join(fixture.dataSlotsRoot, 'active')), false);
    assert.equal(
        journalKinds(fixture, activation.protectedSession.operationId)
            .includes('observed-retire-old-data'),
        true,
    );

    const recovered = restoreModule().RestoreCoordinator.recover(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
    );
    const succeeded = await recovered.resume({
        commandId: RETRY_COMMAND_ID,
        restoreSessionId: activation.protectedSession.restoreSessionId,
        expectedSessionVersion: '2',
    });
    assert.equal(succeeded.phase, 'succeeded');
    const activeStore = recovered.activeStore();
    assert.ok(activeStore);
    fixture.trackStore(activeStore);
    assert.equal(activeStore.status().revision, activation.candidateRevision);
});

test('TEST-DATA-006: concurrent recovery choices commit only the first explicit action', async t => {
    const fixture = await createFixture(t);
    const activation = await createProtectedActivation(fixture, {
        failpoint(point) {
            if (point === 'activation.after-armed') {
                throw new Error(point);
            }
        },
    });
    await assert.rejects(activation.coordinator.resume({
        commandId: RESUME_COMMAND_ID,
        restoreSessionId: activation.protectedSession.restoreSessionId,
        expectedSessionVersion: activation.protectedSession.sessionVersion,
    }), /activation-pending/);
    const recovered = restoreModule().RestoreCoordinator.recover(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
    );

    const [resume, rollback] = await Promise.allSettled([
        recovered.resume({
            commandId: RETRY_COMMAND_ID,
            restoreSessionId: activation.protectedSession.restoreSessionId,
            expectedSessionVersion: '2',
        }),
        recovered.rollback({
            commandId: ROLLBACK_COMMAND_ID,
            restoreSessionId: activation.protectedSession.restoreSessionId,
            expectedSessionVersion: '2',
        }),
    ]);

    assert.equal(resume.status, 'fulfilled');
    assert.equal(resume.status === 'fulfilled' ? resume.value.phase : null, 'succeeded');
    assert.equal(rollback.status, 'rejected');
    assert.match(
        rollback.status === 'rejected' ? String(rollback.reason) : '',
        /conflict/,
    );
    const activeStore = recovered.activeStore();
    assert.ok(activeStore);
    fixture.trackStore(activeStore);
});

test('TEST-DATA-006: every forward physical phase resumes from fresh evidence', async t => {
    for (const point of [
        'activation.before-retire-intent',
        'activation.after-retire-intent',
        'activation.after-retire-action',
        'activation.after-retire-observation',
        'activation.after-retire-observed',
        'activation.before-install-intent',
        'activation.after-install-intent',
        'activation.after-install-action',
        'activation.after-install-observation',
        'activation.after-install-observed',
        'activation.after-candidate-installed',
    ]) {
        await t.test(point, async child => {
            const fixture = await createFixture(child);
            let failpointReached = false;
            const activation = await createProtectedActivation(fixture, {
                failpoint(candidate) {
                    if (candidate === point) {
                        failpointReached = true;
                        throw new Error(candidate);
                    }
                },
            });
            await assert.rejects(activation.coordinator.resume({
                commandId: RESUME_COMMAND_ID,
                restoreSessionId: activation.protectedSession.restoreSessionId,
                expectedSessionVersion: activation.protectedSession.sessionVersion,
            }), /activation-pending/);
            assert.equal(failpointReached, true);

            const boot = restoreModule().inspectRestoreBeforeWorkspaceOpen(
                fixture.activityControlRoot,
                fixture.dataSlotsRoot,
            );
            assert.equal(boot.kind, 'recovery-required');
            assert.deepEqual(boot.session?.allowedActions, ['resume', 'rollback']);

            const recovered = restoreModule().RestoreCoordinator.recover(
                fixture.activityControlRoot,
                fixture.dataSlotsRoot,
            );
            const succeeded = await recovered.resume({
                commandId: RETRY_COMMAND_ID,
                restoreSessionId: activation.protectedSession.restoreSessionId,
                expectedSessionVersion: '2',
            });
            assert.equal(succeeded.phase, 'succeeded');
            const activeStore = recovered.activeStore();
            assert.ok(activeStore);
            fixture.trackStore(activeStore);
            assert.equal(activeStore.status().revision, activation.candidateRevision);
        });
    }
});

test('TEST-DATA-006: checkpoint recovery can quarantine candidate and reopen old DATA', async t => {
    const fixture = await createFixture(t);
    const activation = await createProtectedActivation(fixture, {
        failpoint(point) {
            if (point === 'activation.after-install-action') {
                throw new Error(point);
            }
        },
    });
    await assert.rejects(activation.coordinator.resume({
        commandId: RESUME_COMMAND_ID,
        restoreSessionId: activation.protectedSession.restoreSessionId,
        expectedSessionVersion: activation.protectedSession.sessionVersion,
    }), /activation-pending/);

    const recovered = restoreModule().RestoreCoordinator.recover(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
    );
    const rolledBack = await recovered.rollback({
        commandId: ROLLBACK_COMMAND_ID,
        restoreSessionId: activation.protectedSession.restoreSessionId,
        expectedSessionVersion: '2',
    });

    assert.equal(rolledBack.phase, 'rolled-back');
    assert.equal(rolledBack.sessionVersion, '3');
    const activeStore = recovered.activeStore();
    assert.ok(activeStore);
    fixture.trackStore(activeStore);
    assert.equal(activeStore.status().revision, activation.currentRevision);
    assert.equal(
        activeStore.readRestoreCompletionReceipt(rolledBack.operationId)?.outcome,
        'rolled-back',
    );
    assert.equal(existsSync(path.join(
        fixture.dataSlotsRoot,
        `.restore-quarantine-${rolledBack.operationId}`,
    )), true);
    assert.equal(journalKinds(fixture, rolledBack.operationId).at(-1), 'rolled-back');
});

test('TEST-DATA-006: every rollback physical phase resumes from fresh evidence', async t => {
    for (const point of [
        'activation.before-quarantine-intent',
        'activation.after-quarantine-intent',
        'activation.after-quarantine-action',
        'activation.after-quarantine-observation',
        'activation.after-quarantine-observed',
        'activation.before-restore-old-intent',
        'activation.after-restore-old-intent',
        'activation.after-restore-old-action',
        'activation.after-restore-old-observation',
        'activation.after-restore-old-observed',
    ]) {
        await t.test(point, async child => {
            const fixture = await createFixture(child);
            const activation = await createProtectedActivation(fixture, {
                failpoint(candidate) {
                    if (candidate === 'activation.after-install-action') {
                        throw new Error(candidate);
                    }
                },
            });
            await assert.rejects(activation.coordinator.resume({
                commandId: RESUME_COMMAND_ID,
                restoreSessionId: activation.protectedSession.restoreSessionId,
                expectedSessionVersion: activation.protectedSession.sessionVersion,
            }), /activation-pending/);
            let failpointReached = false;
            const interrupted = restoreModule().RestoreCoordinator.recover(
                fixture.activityControlRoot,
                fixture.dataSlotsRoot,
                {
                    failpoint(candidate) {
                        if (candidate === point) {
                            failpointReached = true;
                            throw new Error(candidate);
                        }
                    },
                },
            );
            await assert.rejects(interrupted.rollback({
                commandId: ROLLBACK_COMMAND_ID,
                restoreSessionId: activation.protectedSession.restoreSessionId,
                expectedSessionVersion: '2',
            }), /rollback-required/);
            assert.equal(failpointReached, true);

            const boot = restoreModule().inspectRestoreBeforeWorkspaceOpen(
                fixture.activityControlRoot,
                fixture.dataSlotsRoot,
            );
            assert.equal(boot.kind, 'recovery-required');
            assert.deepEqual(
                boot.session?.allowedActions,
                point === 'activation.before-quarantine-intent'
                    ? ['resume', 'rollback']
                    : ['rollback'],
            );

            const recovered = restoreModule().RestoreCoordinator.recover(
                fixture.activityControlRoot,
                fixture.dataSlotsRoot,
            );
            const rolledBack = await recovered.rollback({
                commandId: ROLLBACK_COMMAND_ID,
                restoreSessionId: activation.protectedSession.restoreSessionId,
                expectedSessionVersion: '2',
            });
            assert.equal(rolledBack.phase, 'rolled-back');
            const activeStore = recovered.activeStore();
            assert.ok(activeStore);
            fixture.trackStore(activeStore);
            assert.equal(activeStore.status().revision, activation.currentRevision);
        });
    }
});

test('TEST-DATA-006: rollback receipt binds the last observed physical state', async t => {
    const fixture = await createFixture(t);
    const activation = await createProtectedActivation(fixture, {
        failpoint(point) {
            if (point === 'activation.after-install-action') {
                throw new Error(point);
            }
        },
    });
    await assert.rejects(activation.coordinator.resume({
        commandId: RESUME_COMMAND_ID,
        restoreSessionId: activation.protectedSession.restoreSessionId,
        expectedSessionVersion: activation.protectedSession.sessionVersion,
    }), /activation-pending/);
    const interrupted = restoreModule().RestoreCoordinator.recover(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
        {
            failpoint(point) {
                if (point === 'activation.after-restore-old-observed') {
                    throw new Error(point);
                }
            },
        },
    );
    await assert.rejects(interrupted.rollback({
        commandId: ROLLBACK_COMMAND_ID,
        restoreSessionId: activation.protectedSession.restoreSessionId,
        expectedSessionVersion: '2',
    }), /rollback-required/);

    const recovered = restoreModule().RestoreCoordinator.recover(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
    );
    const rolledBack = await recovered.rollback({
        commandId: RETRY_COMMAND_ID,
        restoreSessionId: activation.protectedSession.restoreSessionId,
        expectedSessionVersion: '2',
    });
    const activeStore = recovered.activeStore();
    assert.ok(activeStore);
    fixture.trackStore(activeStore);
    const receipt = activeStore.readRestoreCompletionReceipt(rolledBack.operationId);
    assert.ok(receipt);
    const journalDirectory = path.join(
        fixture.activityControlRoot,
        'restore',
        rolledBack.operationId,
        'journal',
    );
    const precommit = readdirSync(journalDirectory)
        .map(name => JSON.parse(readFileSync(path.join(journalDirectory, name), 'utf8')) as {
            kind: string;
            recordDigest: string;
        })
        .find(record => record.recordDigest === receipt.precommit.recordDigest);
    assert.equal(precommit?.kind, 'observed-restore-old-data');
});

test('TEST-DATA-006: reboot completes external commit only from the typed DATA receipt', async t => {
    const fixture = await createFixture(t);
    const activation = await createProtectedActivation(fixture);
    const succeeded = await activation.coordinator.resume({
        commandId: RESUME_COMMAND_ID,
        restoreSessionId: activation.protectedSession.restoreSessionId,
        expectedSessionVersion: activation.protectedSession.sessionVersion,
    });
    await activation.coordinator.activeStore()?.close();
    const journalDirectory = path.join(
        fixture.activityControlRoot,
        'restore',
        succeeded.operationId,
        'journal',
    );
    for (const name of readdirSync(journalDirectory)) {
        if (name.includes('-success-receipt-') || name.includes('-committed-')) {
            rmSync(path.join(journalDirectory, name));
        }
    }
    assert.equal(
        journalKinds(fixture, succeeded.operationId).includes('committed'),
        false,
    );

    const boot = restoreModule().inspectRestoreBeforeWorkspaceOpen(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
    );

    assert.equal(boot.kind, 'committed');
    assert.equal(boot.session?.phase, 'succeeded');
    assert.equal(journalKinds(fixture, activation.protectedSession.operationId).at(-1), 'committed');
    const reopened = openWorkspaceData(fixture.dataSlotsRoot);
    assert.equal(reopened.kind, 'ready');
    if (reopened.kind === 'ready') {
        fixture.trackStore(reopened.store);
        assert.equal(
            reopened.store.readRestoreCompletionReceipt(
                activation.protectedSession.operationId,
            )?.outcome,
            'succeeded',
        );
    }
});

test('TEST-DATA-006: external terminal without its DATA receipt remains blocked', async t => {
    const fixture = await createFixture(t);
    const activation = await createProtectedActivation(fixture);
    const succeeded = await activation.coordinator.resume({
        commandId: RESUME_COMMAND_ID,
        restoreSessionId: activation.protectedSession.restoreSessionId,
        expectedSessionVersion: activation.protectedSession.sessionVersion,
    });
    await activation.coordinator.activeStore()?.close();
    const database = new DatabaseSync(path.join(
        fixture.dataSlotsRoot,
        'active',
        'workspace.sqlite',
    ));
    try {
        database.prepare(
            'DELETE FROM restore_completion_receipts WHERE operation_id = ?',
        ).run(succeeded.operationId);
    }
    finally {
        database.close();
    }

    const boot = restoreModule().inspectRestoreBeforeWorkspaceOpen(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
    );
    assert.equal(boot.kind, 'recovery-required');
    assert.equal(boot.session, null);
});

test('TEST-DATA-006: receipt and terminal failpoints reconcile to reopened success', async t => {
    for (const point of [
        'activation.after-success-receipt',
        'journal.success-receipt.after-publish',
        'journal.committed.after-publish',
        'activation.after-committed',
    ]) {
        await t.test(point, async child => {
            const fixture = await createFixture(child);
            const activation = await createProtectedActivation(fixture, {
                failpoint(candidate) {
                    if (candidate === point) {
                        throw new Error(candidate);
                    }
                },
            });
            const succeeded = await activation.coordinator.resume({
                commandId: RESUME_COMMAND_ID,
                restoreSessionId: activation.protectedSession.restoreSessionId,
                expectedSessionVersion: activation.protectedSession.sessionVersion,
            });
            assert.equal(succeeded.phase, 'succeeded');
            const activeStore = activation.coordinator.activeStore();
            assert.ok(activeStore);
            fixture.trackStore(activeStore);
            assert.equal(activeStore.status().revision, activation.candidateRevision);
            assert.equal(
                activeStore.readRestoreCompletionReceipt(succeeded.operationId)?.outcome,
                'succeeded',
            );
        });
    }
});

test('TEST-DATA-006: rollback receipt and terminal failpoints reconcile to reopened old DATA', async t => {
    for (const point of [
        'activation.after-rollback-receipt',
        'journal.rollback-receipt.after-publish',
        'journal.rolled-back.after-publish',
        'activation.after-rolled-back',
    ]) {
        await t.test(point, async child => {
            const fixture = await createFixture(child);
            const activation = await createProtectedActivation(fixture, {
                failpoint(candidate) {
                    if (candidate === 'activation.after-install-action') {
                        throw new Error(candidate);
                    }
                },
            });
            await assert.rejects(activation.coordinator.resume({
                commandId: RESUME_COMMAND_ID,
                restoreSessionId: activation.protectedSession.restoreSessionId,
                expectedSessionVersion: activation.protectedSession.sessionVersion,
            }), /activation-pending/);
            let failpointReached = false;
            const recovered = restoreModule().RestoreCoordinator.recover(
                fixture.activityControlRoot,
                fixture.dataSlotsRoot,
                {
                    failpoint(candidate) {
                        if (candidate === point) {
                            failpointReached = true;
                            throw new Error(candidate);
                        }
                    },
                },
            );
            const rolledBack = await recovered.rollback({
                commandId: ROLLBACK_COMMAND_ID,
                restoreSessionId: activation.protectedSession.restoreSessionId,
                expectedSessionVersion: '2',
            });
            assert.equal(failpointReached, true);
            assert.equal(rolledBack.phase, 'rolled-back');
            const activeStore = recovered.activeStore();
            assert.ok(activeStore);
            fixture.trackStore(activeStore);
            assert.equal(activeStore.status().revision, activation.currentRevision);
            assert.equal(
                activeStore.readRestoreCompletionReceipt(rolledBack.operationId)?.outcome,
                'rolled-back',
            );
        });
    }
});
