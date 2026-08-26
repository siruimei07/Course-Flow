/**
 * @file Verifies WP-R6-01 candidate validation, preview binding, and safety sets.
 */

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
    appendFileSync,
    copyFileSync,
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

type RestoreCoordinatorOptions = Readonly<{
    currentLibraryBinding?: () => RestoreLibraryRootBinding;
    targetBindingVersion?: () => string;
    impactSummary?: (
        candidateRevision: string,
        currentRevision: string,
    ) => RestoreImpactSummary;
}>;

type RestoreCoordinator = Readonly<{
    listCandidates(): readonly RestoreCandidateProjection[];
    start(command: StartRestoreSessionCommand): Promise<RestoreSessionView>;
    confirm(command: ConfirmRestoreSessionCommand): Promise<RestoreSessionView>;
    query(restoreSessionId: string): RestoreSessionView;
}>;

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
    RestoreCoordinator: new (
        store: SqliteDataStore,
        activityControlRoot: string,
        options?: RestoreCoordinatorOptions,
    ) => RestoreCoordinator;
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
    const destination = createDirectory('courseflow-restore-backup-');
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
    oldDatabase.exec(`
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
    assert.deepEqual(readdirSync(operationDirectory), ['candidate-validation']);
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
        'safety',
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
            )), ['candidate-validation']);
        });
    }
});
