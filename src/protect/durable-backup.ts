/**
 * @file Runs the durable FLOW-04 snapshot publication state machine.
 */

import {randomBytes, randomUUID} from 'node:crypto';
import path from 'node:path';

import {
    digestPlainFile,
    ensureBackupSetTree,
    ensureSnapshotStagingDirectory,
    listPlainDirectory,
    plainFileExists,
    publishBackupMember,
    publishSnapshotDirectory,
    readBoundedPlainFile,
    removeTemporaryBackupFile,
    syncPlainFile,
    writeOrVerifyBackupFile,
} from '../platform/backup-snapshot-files';
import {BACKUP_REPOSITORY_SCHEMA} from '../shared/workspace-protection-contract';
import {
    type BackupDatabaseFacts,
    type BackupOperation,
    type SqliteDataStore,
} from '../data/sqlite-data-store';
import {
    createSnapshotManifestV1,
    SnapshotValidationError,
    validateSnapshotManifestV1,
} from './snapshot-manifest';

const REPOSITORY_DIRECTORY_NAME = 'CourseFlow';
const REPOSITORY_MARKER_NAME = 'repository-v1.json';
const REPOSITORY_MARKER_BYTES = Buffer.from(JSON.stringify({schema: BACKUP_REPOSITORY_SCHEMA}), 'utf8');
const DATABASE_MEMBER_NAME = 'workspace.sqlite';
const MANIFEST_MEMBER_NAME = 'manifest.json';
const MANIFEST_MAXIMUM_BYTES = 67_108_864;
const SNAPSHOT_MAXIMUM_RAW_BYTES = 1_099_511_627_776n;
const MODULES = Object.freeze([
    Object.freeze({moduleId: 'MOD-DATA', formatVersion: '1'}),
    Object.freeze({moduleId: 'MOD-PLAN', formatVersion: '1'}),
    Object.freeze({moduleId: 'MOD-PROTECT', formatVersion: '1'}),
    Object.freeze({moduleId: 'MOD-WORKSPACE', formatVersion: '1'}),
]);

export const BACKUP_FAILPOINTS = Object.freeze([
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
] as const);

export type BackupFailpoint = typeof BACKUP_FAILPOINTS[number];

export type DurableBackupPassOptions = Readonly<{
    clock?: Readonly<{now(): string}>;
    identityFactory?: () => Readonly<{
        operationId: string;
        snapshotId: string;
        nonce: string;
    }>;
    failpoint?: (point: BackupFailpoint) => void;
}>;

type SnapshotPaths = Readonly<{
    stagingDirectoryPath: string;
    finalDirectoryPath: string;
    stagingDatabasePath: string;
    finalDatabasePath: string;
    stagingManifestPath: string;
    finalManifestPath: string;
}>;

/**
 * Invokes one deterministic durability test seam.
 * @param {DurableBackupPassOptions} options - Current pass options.
 * @param {BackupFailpoint} point - Reached protocol boundary.
 * @return {void}
 */
function fire(options: DurableBackupPassOptions, point: BackupFailpoint): void {
    options.failpoint?.(point);
}

/**
 * Allocates fresh durable operation, snapshot, and staging identities.
 * @return {object} Canonical UUID identities and lowercase nonce.
 */
function defaultIdentityFactory(): Readonly<{
    operationId: string;
    snapshotId: string;
    nonce: string;
}> {
    return Object.freeze({
        operationId: randomUUID(),
        snapshotId: randomUUID(),
        nonce: randomBytes(8).toString('hex'),
    });
}

/**
 * Reads one canonical instant from the production or deterministic clock.
 * @param {DurableBackupPassOptions} options - Current pass options.
 * @return {string} UTC RFC 3339 instant.
 */
function currentInstant(options: DurableBackupPassOptions): string {
    return options.clock?.now() ?? new Date().toISOString();
}

/**
 * Derives operation-controlled staging and final member paths.
 * @param {string} backupSetDirectoryPath - Validated BackupSet directory.
 * @param {BackupOperation} operation - Persisted operation identities.
 * @return {SnapshotPaths} Exact member and directory paths.
 */
function snapshotPaths(backupSetDirectoryPath: string, operation: BackupOperation): SnapshotPaths {
    const stagingDirectoryPath = path.join(
        backupSetDirectoryPath,
        operation.stagingDirectoryName,
    );
    const finalDirectoryPath = path.join(
        backupSetDirectoryPath,
        `snapshot-${operation.snapshotId}`,
    );
    return Object.freeze({
        stagingDirectoryPath,
        finalDirectoryPath,
        stagingDatabasePath: path.join(stagingDirectoryPath, DATABASE_MEMBER_NAME),
        finalDatabasePath: path.join(finalDirectoryPath, DATABASE_MEMBER_NAME),
        stagingManifestPath: path.join(stagingDirectoryPath, MANIFEST_MEMBER_NAME),
        finalManifestPath: path.join(finalDirectoryPath, MANIFEST_MEMBER_NAME),
    });
}

/**
 * Checks the exact ordered module compatibility declaration.
 * @param {readonly object[]} modules - Manifest module facts.
 * @return {boolean} Whether the module declaration is current.
 */
function sameModules(modules: readonly Readonly<{
    moduleId: string;
    formatVersion: string;
}>[]): boolean {
    return JSON.stringify(modules) === JSON.stringify(MODULES);
}

/**
 * Runs the same hostile full validator against staging or final bytes.
 * @param {SqliteDataStore} store - DATA copy validator.
 * @param {string} directoryPath - Exact snapshot directory.
 * @param {BackupOperation} operation - Persisted operation facts.
 * @param {BackupDatabaseFacts} databaseFacts - Expected copied database facts.
 * @return {string} Canonical manifest root digest.
 */
function validateSnapshotDirectory(
    store: SqliteDataStore,
    directoryPath: string,
    operation: BackupOperation,
    databaseFacts: BackupDatabaseFacts,
): string {
    try {
        if (JSON.stringify(listPlainDirectory(directoryPath))
            !== JSON.stringify([MANIFEST_MEMBER_NAME, DATABASE_MEMBER_NAME].sort())) {
            throw new SnapshotValidationError();
        }
        const databasePath = path.join(directoryPath, DATABASE_MEMBER_NAME);
        const manifestBytes = readBoundedPlainFile(
            path.join(directoryPath, MANIFEST_MEMBER_NAME),
            MANIFEST_MAXIMUM_BYTES,
        );
        const manifest = validateSnapshotManifestV1(manifestBytes);
        const databaseDigest = digestPlainFile(databasePath, SNAPSHOT_MAXIMUM_RAW_BYTES);
        const copiedDatabase = store.validateBackupDatabaseCopy(
            databasePath,
            operation.targetRevision,
        );
        const member = manifest.input.members[0];
        if (manifest.input.snapshotId !== operation.snapshotId
            || manifest.input.backupSetId !== operation.backupSetId
            || manifest.input.backupSequence !== operation.backupSequence
            || manifest.input.createdAt !== operation.createdAt
            || manifest.input.workspaceId !== databaseFacts.workspaceId
            || manifest.input.database.applicationId !== databaseFacts.applicationId
            || manifest.input.database.schemaLevel !== databaseFacts.schemaLevel
            || manifest.input.database.actualRevision !== databaseFacts.actualRevision
            || copiedDatabase.workspaceId !== databaseFacts.workspaceId
            || copiedDatabase.applicationId !== databaseFacts.applicationId
            || copiedDatabase.schemaLevel !== databaseFacts.schemaLevel
            || copiedDatabase.actualRevision !== databaseFacts.actualRevision
            || operation.actualRevision !== databaseFacts.actualRevision
            || !sameModules(manifest.input.modules)
            || member.byteLength !== databaseDigest.byteLength
            || member.sha256 !== databaseDigest.sha256) {
            throw new SnapshotValidationError();
        }
        return manifest.rootDigest;
    }
    catch (error) {
        if (error instanceof SnapshotValidationError) {
            throw error;
        }
        throw new SnapshotValidationError();
    }
}

/**
 * Creates or resumes the synchronized SQLite member and records its actual revision.
 * @param {SqliteDataStore} store - DATA checkpoint owner.
 * @param {BackupOperation} operation - Queued operation.
 * @param {SnapshotPaths} paths - Operation-owned member paths.
 * @param {DurableBackupPassOptions} options - Current pass options.
 * @return {Promise<object>} Checkpointed operation and copied database facts.
 */
async function checkpointDatabase(
    store: SqliteDataStore,
    operation: BackupOperation,
    paths: SnapshotPaths,
    options: DurableBackupPassOptions,
): Promise<Readonly<{operation: BackupOperation; databaseFacts: BackupDatabaseFacts}>> {
    let databaseFacts: BackupDatabaseFacts;
    if (plainFileExists(paths.stagingDatabasePath)) {
        databaseFacts = store.validateBackupDatabaseCopy(
            paths.stagingDatabasePath,
            operation.targetRevision,
        );
    }
    else {
        const temporaryPath = path.join(paths.stagingDirectoryPath, '.workspace.sqlite.tmp');
        removeTemporaryBackupFile(temporaryPath);
        databaseFacts = await store.writeBackupDatabaseCopy(
            temporaryPath,
            operation.targetRevision,
        );
        syncPlainFile(temporaryPath);
        fire(options, 'backup.after-database-temp-write');
        publishBackupMember(temporaryPath, paths.stagingDatabasePath);
        fire(options, 'backup.after-database-member-publish');
        databaseFacts = store.validateBackupDatabaseCopy(
            paths.stagingDatabasePath,
            operation.targetRevision,
        );
    }
    const checkpointed = store.recordBackupCheckpoint(
        operation.operationId,
        databaseFacts.actualRevision,
    );
    fire(options, 'backup.after-database-checkpoint');
    return Object.freeze({operation: checkpointed, databaseFacts});
}

/**
 * Reopens a persisted member and matches it to the operation checkpoint.
 * @param {SqliteDataStore} store - DATA copy validator.
 * @param {BackupOperation} operation - Persisted checkpoint facts.
 * @param {string} databasePath - Staging or final database path.
 * @return {BackupDatabaseFacts} Fresh matching database facts.
 */
function readCheckpointFacts(
    store: SqliteDataStore,
    operation: BackupOperation,
    databasePath: string,
): BackupDatabaseFacts {
    try {
        const facts = store.validateBackupDatabaseCopy(databasePath, operation.targetRevision);
        if (operation.actualRevision !== facts.actualRevision) {
            throw new SnapshotValidationError();
        }
        return facts;
    }
    catch (error) {
        if (error instanceof SnapshotValidationError) {
            throw error;
        }
        throw new SnapshotValidationError();
    }
}

/**
 * Runs durable backup work until the persisted watermark is covered or one stage fails.
 * @param {SqliteDataStore} store - DATA owner for claims, checkpoints, and success registration.
 * @param {DurableBackupPassOptions} options - Deterministic clocks, identities, and test failpoints.
 * @return {Promise<void>} Resolves only when no configured pending backup remains.
 */
export async function runDurableBackupPass(
    store: SqliteDataStore,
    options: DurableBackupPassOptions = {},
): Promise<void> {
    while (true) {
        const configuration = store.readBackupConfigurationForProtection();
        if (configuration === null) {
            return;
        }
        const identity = (options.identityFactory ?? defaultIdentityFactory)();
        let operation = store.claimBackupOperation({
            operationId: identity.operationId,
            snapshotId: identity.snapshotId,
            stagingDirectoryName: `.staging-${identity.operationId}-${identity.nonce}`,
            createdAt: currentInstant(options),
        });
        if (operation === null) {
            return;
        }
        fire(options, 'backup.after-claim');

        const tree = ensureBackupSetTree({
            destinationPath: configuration.canonicalPath,
            repositoryDirectoryName: REPOSITORY_DIRECTORY_NAME,
            repositoryMarkerName: REPOSITORY_MARKER_NAME,
            repositoryMarkerBytes: REPOSITORY_MARKER_BYTES,
            workspaceDirectoryName: configuration.workspaceId,
            backupSetDirectoryName: operation.backupSetId,
            repositoryTemporaryName: `.CourseFlow-${operation.operationId}`,
            afterRepositoryMarkerWrite: () => fire(options, 'backup.after-repository-marker-write'),
            afterRepositoryPublish: () => fire(options, 'backup.after-repository-publish'),
        });
        const paths = snapshotPaths(tree.backupSetDirectoryPath, operation);
        if (operation.phase !== 'publishing'
            && operation.phase !== 'published-pending-record'
            && operation.phase !== 'succeeded') {
            ensureSnapshotStagingDirectory(
                tree.backupSetDirectoryPath,
                operation.stagingDirectoryName,
            );
            fire(options, 'backup.after-staging-create');
        }

        let databaseFacts: BackupDatabaseFacts;
        if (operation.phase === 'queued') {
            const checkpoint = await checkpointDatabase(store, operation, paths, options);
            operation = checkpoint.operation;
            databaseFacts = checkpoint.databaseFacts;
        }
        else if (operation.phase === 'publishing'
            && !plainFileExists(paths.finalDatabasePath)) {
            databaseFacts = readCheckpointFacts(store, operation, paths.stagingDatabasePath);
        }
        else if (operation.phase === 'published-pending-record'
            || operation.phase === 'publishing') {
            databaseFacts = readCheckpointFacts(store, operation, paths.finalDatabasePath);
        }
        else if (operation.phase === 'succeeded') {
            continue;
        }
        else {
            databaseFacts = readCheckpointFacts(store, operation, paths.stagingDatabasePath);
        }

        if (operation.phase === 'database-checkpoint') {
            operation = store.advanceBackupOperation(
                operation.operationId,
                'database-checkpoint',
                'library-copy',
            );
            fire(options, 'backup.after-library-copy');
        }
        if (operation.phase === 'library-copy') {
            const databaseDigest = digestPlainFile(
                paths.stagingDatabasePath,
                SNAPSHOT_MAXIMUM_RAW_BYTES,
            );
            const manifestBytes = createSnapshotManifestV1({
                snapshotId: operation.snapshotId,
                backupSetId: operation.backupSetId,
                backupSequence: operation.backupSequence,
                createdAt: operation.createdAt,
                workspaceId: databaseFacts.workspaceId,
                database: {
                    applicationId: databaseFacts.applicationId,
                    schemaLevel: databaseFacts.schemaLevel,
                    actualRevision: databaseFacts.actualRevision,
                    memberPath: DATABASE_MEMBER_NAME,
                },
                modules: MODULES,
                library: {state: 'absent'},
                members: [{
                    path: DATABASE_MEMBER_NAME,
                    role: 'database',
                    byteLength: databaseDigest.byteLength,
                    sha256: databaseDigest.sha256,
                }],
            });
            writeOrVerifyBackupFile(paths.stagingManifestPath, manifestBytes);
            fire(options, 'backup.after-manifest-write');
            operation = store.advanceBackupOperation(
                operation.operationId,
                'library-copy',
                'staging-validation',
            );
        }
        if (operation.phase === 'staging-validation') {
            validateSnapshotDirectory(
                store,
                paths.stagingDirectoryPath,
                operation,
                databaseFacts,
            );
            fire(options, 'backup.after-staging-validation');
            operation = store.advanceBackupOperation(
                operation.operationId,
                'staging-validation',
                'publishing',
            );
            fire(options, 'backup.after-publishing');
        }
        if (operation.phase === 'publishing') {
            if (!plainFileExists(paths.finalDatabasePath)) {
                validateSnapshotDirectory(
                    store,
                    paths.stagingDirectoryPath,
                    operation,
                    databaseFacts,
                );
            }
            publishSnapshotDirectory(paths.stagingDirectoryPath, paths.finalDirectoryPath);
            fire(options, 'backup.after-atomic-publish');
            operation = store.advanceBackupOperation(
                operation.operationId,
                'publishing',
                'published-pending-record',
            );
            fire(options, 'backup.after-published-pending-record');
        }
        if (operation.phase === 'published-pending-record') {
            const finalDatabaseFacts = readCheckpointFacts(
                store,
                operation,
                paths.finalDatabasePath,
            );
            const rootDigest = validateSnapshotDirectory(
                store,
                paths.finalDirectoryPath,
                operation,
                finalDatabaseFacts,
            );
            fire(options, 'backup.after-final-validation');
            store.recordBackupSuccess({
                operationId: operation.operationId,
                actualRevision: finalDatabaseFacts.actualRevision,
                rootDigest,
                succeededAt: currentInstant(options),
            });
            fire(options, 'backup.after-success-record');
        }
    }
}

/**
 * Collapses lossy or duplicate PostCommit hints onto the durable DATA work queue.
 */
export class DurableBackupCoordinator {
    private closed = false;
    private requested = false;
    private running: Promise<void> | undefined;

    /**
     * Creates one per-Workspace lossy-hint coordinator.
     * @param {SqliteDataStore} store - Durable DATA work owner.
     * @param {DurableBackupPassOptions} options - Pass clocks, identities, and failpoints.
     */
    public constructor(
        private readonly store: SqliteDataStore,
        private readonly options: DurableBackupPassOptions = {},
    ) {}

    /**
     * Requests one asynchronous scan; duplicate hints merge while a scan is running.
     * @return {void}
     */
    public wake(): void {
        if (this.closed) {
            return;
        }
        this.requested = true;
        if (!this.running) {
            this.running = this.drain();
        }
    }

    /**
     * Waits until all hints observed so far have either converged or failed this attempt.
     * @return {Promise<void>} Current background pass completion.
     */
    public async waitForIdle(): Promise<void> {
        while (this.running) {
            await this.running;
        }
    }

    /**
     * Stops accepting hints and lets the current filesystem operation reach a safe boundary.
     * @return {Promise<void>} Coordinator shutdown completion.
     */
    public async close(): Promise<void> {
        this.closed = true;
        this.requested = false;
        await this.waitForIdle();
    }

    /**
     * Drains merged hints while preserving durable work after any failed attempt.
     * @return {Promise<void>} Current background drain completion.
     */
    private async drain(): Promise<void> {
        try {
            while (!this.closed && this.requested) {
                this.requested = false;
                try {
                    await runDurableBackupPass(this.store, this.options);
                }
                catch {
                    if (!this.requested) {
                        return;
                    }
                }
            }
        }
        finally {
            this.running = undefined;
        }
    }
}
