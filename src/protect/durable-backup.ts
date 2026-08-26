/**
 * @file Runs the durable FLOW-04 snapshot publication state machine.
 */

import {randomBytes, randomUUID} from 'node:crypto';
import path from 'node:path';

import {
    deleteQuarantinedSnapshotDirectory,
    digestPlainFile,
    ensureBackupSetTree,
    ensureSnapshotStagingDirectory,
    listPlainDirectory,
    plainChildDirectoryExists,
    plainFileExists,
    publishBackupMember,
    publishSnapshotDirectory,
    readBackupSetTree,
    readBoundedPlainFile,
    readBoundedPlainChildFile,
    removeTemporaryBackupFile,
    quarantineSnapshotDirectory,
    syncPlainFile,
    writeOrVerifyBackupFile,
} from '../platform/backup-snapshot-files';
import {
    BACKUP_REPOSITORY_SCHEMA,
    type DataProtectionProjection,
    type RestoreCandidateProjection,
} from '../shared/workspace-protection-contract';
import {
    type BackupDatabaseFacts,
    type BackupOperation,
    type BackupCleanupOperation,
    type BackupConfigurationForProtection,
    type SqliteDataStore,
    type SuccessfulBackupSnapshot,
} from '../data/sqlite-data-store';
import {
    createSnapshotManifestV1,
    SnapshotValidationError,
    validateSnapshotManifestV1,
} from './snapshot-manifest';

export {RestoreCoordinator} from './restore-session';

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

export const RETENTION_FAILPOINTS = Object.freeze([
    'retention.after-cleanup-claim',
    'retention.after-quarantine',
    'retention.after-quarantine-record',
    'retention.after-delete-authorization',
    'retention.after-member-delete',
    'retention.after-delete',
    'retention.after-cleanup-record',
] as const);

export type RetentionFailpoint = typeof RETENTION_FAILPOINTS[number];
export type DurableBackupFailpoint = BackupFailpoint | RetentionFailpoint;

export type DurableBackupPassOptions = Readonly<{
    clock?: Readonly<{now(): string}>;
    identityFactory?: () => Readonly<{
        operationId: string;
        snapshotId: string;
        nonce: string;
    }>;
    cleanupOperationIdFactory?: () => string;
    failpoint?: (point: DurableBackupFailpoint) => void;
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
function fire(options: DurableBackupPassOptions, point: DurableBackupFailpoint): void {
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
 * Revalidates the manifest identity that survives a database-first partial deletion.
 * @param {SqliteDataStore} store - DATA operation owner.
 * @param {string} directoryPath - Registered final or quarantine directory.
 * @param {SuccessfulBackupSnapshot} snapshot - Immutable success facts to match.
 * @return {object} Matching operation and canonical manifest.
 */
function validateRegisteredSnapshotManifest(
    store: SqliteDataStore,
    directoryPath: string,
    snapshot: SuccessfulBackupSnapshot,
): Readonly<{
    operation: BackupOperation;
    manifest: ReturnType<typeof validateSnapshotManifestV1>;
}> {
    try {
        const operation = store.readBackupOperationForSnapshot(snapshot.snapshotId);
        if (!operation
            || operation.phase !== 'succeeded'
            || operation.backupSetId !== snapshot.backupSetId
            || operation.backupSequence !== snapshot.backupSequence
            || operation.actualRevision !== snapshot.actualRevision) {
            throw new SnapshotValidationError();
        }
        const manifest = validateSnapshotManifestV1(readBoundedPlainFile(
            path.join(directoryPath, MANIFEST_MEMBER_NAME),
            MANIFEST_MAXIMUM_BYTES,
        ));
        if (manifest.input.snapshotId !== snapshot.snapshotId
            || manifest.input.backupSetId !== snapshot.backupSetId
            || manifest.input.backupSequence !== snapshot.backupSequence
            || manifest.input.database.actualRevision !== snapshot.actualRevision
            || manifest.rootDigest !== snapshot.rootDigest
            || !sameModules(manifest.input.modules)) {
            throw new SnapshotValidationError();
        }
        return Object.freeze({operation, manifest});
    }
    catch (error) {
        if (error instanceof SnapshotValidationError) {
            throw error;
        }
        throw new SnapshotValidationError();
    }
}

/**
 * Runs the full snapshot validator against one registered success at an exact directory path.
 * @param {SqliteDataStore} store - DATA copy validator and operation owner.
 * @param {string} directoryPath - Registered final or quarantine directory.
 * @param {SuccessfulBackupSnapshot} snapshot - Immutable success facts to match.
 * @return {void}
 */
function validateRegisteredSnapshotDirectory(
    store: SqliteDataStore,
    directoryPath: string,
    snapshot: SuccessfulBackupSnapshot,
): void {
    try {
        const {operation, manifest} = validateRegisteredSnapshotManifest(
            store,
            directoryPath,
            snapshot,
        );
        const rootDigest = validateSnapshotDirectory(store, directoryPath, operation, {
            workspaceId: manifest.input.workspaceId,
            applicationId: manifest.input.database.applicationId,
            schemaLevel: manifest.input.database.schemaLevel,
            actualRevision: manifest.input.database.actualRevision,
        });
        if (rootDigest !== snapshot.rootDigest) {
            throw new SnapshotValidationError();
        }
    }
    catch (error) {
        if (error instanceof SnapshotValidationError) {
            throw error;
        }
        throw new SnapshotValidationError();
    }
}

/**
 * Returns whether one registered snapshot currently passes the full hostile validator.
 * @param {SqliteDataStore} store - DATA copy validator and operation owner.
 * @param {string} directoryPath - Exact final or quarantine directory.
 * @param {SuccessfulBackupSnapshot} snapshot - Immutable success facts to match.
 * @return {boolean} Whether the exact bytes remain verified.
 */
function isRegisteredSnapshotVerified(
    store: SqliteDataStore,
    directoryPath: string,
    snapshot: SuccessfulBackupSnapshot,
): boolean {
    try {
        validateRegisteredSnapshotDirectory(store, directoryPath, snapshot);
        return true;
    }
    catch (error) {
        if (error instanceof SnapshotValidationError) {
            return false;
        }
        throw error;
    }
}

/**
 * Stops retention when any on-disk manifest conflicts with registered or observed identity.
 * @param {string} backupSetDirectoryPath - Current BackupSet directory.
 * @param {string} backupSetId - Current configured BackupSet identity.
 * @param {readonly SuccessfulBackupSnapshot[]} snapshots - Registered immutable successes.
 * @param {BackupCleanupOperation} cleanup - Current operation-owned quarantine identity.
 * @return {void}
 */
function assertNoSnapshotIdentityConflicts(
    backupSetDirectoryPath: string,
    backupSetId: string,
    snapshots: readonly SuccessfulBackupSnapshot[],
    cleanup: BackupCleanupOperation,
): void {
    type ObservedSnapshotIdentity = Readonly<{
        snapshotId: string;
        backupSequence: string;
        rootDigest: string;
    }>;
    const allowedNamesBySnapshot = new Map(snapshots.map(snapshot => [
        snapshot.snapshotId,
        new Set([`snapshot-${snapshot.snapshotId}`]),
    ] as const));
    const cleanupNames = allowedNamesBySnapshot.get(cleanup.snapshotId);
    if (cleanupNames) {
        if (cleanup.phase === 'planned') {
            cleanupNames.add(cleanup.quarantineDirectoryName);
        }
        else {
            cleanupNames.clear();
            cleanupNames.add(cleanup.quarantineDirectoryName);
        }
    }
    const observedBySequence = new Map<string, ObservedSnapshotIdentity>(snapshots.map(snapshot => [
        snapshot.backupSequence,
        snapshot,
    ] as const));
    const observedBySnapshot = new Map<string, ObservedSnapshotIdentity>(snapshots.map(snapshot => [
        snapshot.snapshotId,
        snapshot,
    ] as const));
    for (const entryName of listPlainDirectory(backupSetDirectoryPath)) {
        try {
            const manifest = validateSnapshotManifestV1(readBoundedPlainChildFile(
                backupSetDirectoryPath,
                entryName,
                MANIFEST_MEMBER_NAME,
                MANIFEST_MAXIMUM_BYTES,
            ));
            const registeredAtEntry = snapshots.find(snapshot => (
                allowedNamesBySnapshot.get(snapshot.snapshotId)?.has(entryName)
            ));
            if (manifest.input.backupSetId !== backupSetId) {
                if (registeredAtEntry) {
                    throw new Error('Snapshot identity conflict blocks retention');
                }
                continue;
            }
            const sameSequence = observedBySequence.get(manifest.input.backupSequence);
            const sameSnapshot = observedBySnapshot.get(manifest.input.snapshotId);
            if ((registeredAtEntry && (
                registeredAtEntry.snapshotId !== manifest.input.snapshotId
                || registeredAtEntry.backupSequence !== manifest.input.backupSequence
                || registeredAtEntry.rootDigest !== manifest.rootDigest
            ))
                || (sameSnapshot && !allowedNamesBySnapshot.get(sameSnapshot.snapshotId)?.has(entryName))
                || (sameSequence && sameSequence.snapshotId !== manifest.input.snapshotId)
                || (sameSnapshot && (sameSnapshot.backupSequence !== manifest.input.backupSequence
                    || sameSnapshot.rootDigest !== manifest.rootDigest))) {
                throw new Error('Snapshot identity conflict blocks retention');
            }
            const observed = Object.freeze({
                snapshotId: manifest.input.snapshotId,
                backupSequence: manifest.input.backupSequence,
                rootDigest: manifest.rootDigest,
            });
            observedBySequence.set(manifest.input.backupSequence, observed);
            observedBySnapshot.set(manifest.input.snapshotId, observed);
        }
        catch (error) {
            if (error instanceof Error
                && error.message === 'Snapshot identity conflict blocks retention') {
                throw error;
            }
        }
    }
}

/**
 * Counts freshly verified registered snapshots with a higher BackupSequence.
 * @param {SqliteDataStore} store - DATA copy validator and operation owner.
 * @param {string} backupSetDirectoryPath - Current BackupSet directory.
 * @param {SuccessfulBackupSnapshot} candidate - Snapshot proposed for cleanup.
 * @param {readonly SuccessfulBackupSnapshot[]} snapshots - Registered successes.
 * @return {number} Number of verified newer snapshots.
 */
function countVerifiedNewerSnapshots(
    store: SqliteDataStore,
    backupSetDirectoryPath: string,
    candidate: SuccessfulBackupSnapshot,
    snapshots: readonly SuccessfulBackupSnapshot[],
): number {
    return snapshots.filter(snapshot => {
        const directoryName = `snapshot-${snapshot.snapshotId}`;
        return BigInt(snapshot.backupSequence) > BigInt(candidate.backupSequence)
            && plainChildDirectoryExists(backupSetDirectoryPath, directoryName)
            && isRegisteredSnapshotVerified(
                store,
                path.join(backupSetDirectoryPath, directoryName),
                snapshot,
            );
    }).length;
}

/**
 * Selects the oldest freshly verified registration beyond the newest two verified snapshots.
 * @param {SqliteDataStore} store - DATA copy validator and operation owner.
 * @param {string} backupSetDirectoryPath - Exact current BackupSet directory.
 * @param {readonly SuccessfulBackupSnapshot[]} snapshots - Registered success facts.
 * @return {SuccessfulBackupSnapshot | null} Safe pre-mutation candidate, when one exists.
 */
function findOldestVerifiedCleanupCandidate(
    store: SqliteDataStore,
    backupSetDirectoryPath: string,
    snapshots: readonly SuccessfulBackupSnapshot[],
): SuccessfulBackupSnapshot | null {
    const verified = snapshots.filter(snapshot => {
        const directoryName = `snapshot-${snapshot.snapshotId}`;
        return plainChildDirectoryExists(backupSetDirectoryPath, directoryName)
            && isRegisteredSnapshotVerified(
                store,
                path.join(backupSetDirectoryPath, directoryName),
                snapshot,
            );
    });
    return verified.length > 2 ? verified[0]! : null;
}

/**
 * Resumes one journaled same-parent quarantine and exact physical deletion.
 * @param {SqliteDataStore} store - DATA cleanup journal owner.
 * @param {string} backupSetDirectoryPath - Current BackupSet directory.
 * @param {BackupCleanupOperation} cleanup - Persisted cleanup facts.
 * @param {readonly SuccessfulBackupSnapshot[]} snapshots - Registered success facts.
 * @param {DurableBackupPassOptions} options - Deterministic failpoint controls.
 * @return {void}
 */
function resumeSnapshotCleanup(
    store: SqliteDataStore,
    backupSetDirectoryPath: string,
    cleanup: BackupCleanupOperation,
    snapshots: readonly SuccessfulBackupSnapshot[],
    options: DurableBackupPassOptions,
): void {
    const candidate = snapshots.find(snapshot => snapshot.snapshotId === cleanup.snapshotId);
    if (!candidate
        || candidate.backupSetId !== cleanup.backupSetId
        || candidate.backupSequence !== cleanup.backupSequence
        || candidate.rootDigest !== cleanup.rootDigest) {
        throw new Error('Snapshot cleanup would violate retention');
    }
    const finalDirectoryPath = path.join(
        backupSetDirectoryPath,
        cleanup.snapshotDirectoryName,
    );
    const quarantineDirectoryPath = path.join(
        backupSetDirectoryPath,
        cleanup.quarantineDirectoryName,
    );
    let current = cleanup;
    if (current.phase === 'planned') {
        const finalExists = plainChildDirectoryExists(
            backupSetDirectoryPath,
            current.snapshotDirectoryName,
        );
        const quarantineExists = plainChildDirectoryExists(
            backupSetDirectoryPath,
            current.quarantineDirectoryName,
        );
        if (finalExists === quarantineExists) {
            throw new Error('Snapshot cleanup rename state is ambiguous');
        }
        const validationPath = quarantineExists
            ? quarantineDirectoryPath
            : finalDirectoryPath;
        validateRegisteredSnapshotDirectory(store, validationPath, candidate);
        assertNoSnapshotIdentityConflicts(
            backupSetDirectoryPath,
            cleanup.backupSetId,
            snapshots,
            current,
        );
        if (countVerifiedNewerSnapshots(store, backupSetDirectoryPath, candidate, snapshots) < 2) {
            throw new Error('Snapshot cleanup would violate retention');
        }
        quarantineSnapshotDirectory(
            backupSetDirectoryPath,
            current.snapshotDirectoryName,
            current.quarantineDirectoryName,
        );
        fire(options, 'retention.after-quarantine');
        current = store.markBackupCleanupQuarantined(current.operationId);
        fire(options, 'retention.after-quarantine-record');
    }
    if (current.phase === 'quarantined') {
        const finalExists = plainChildDirectoryExists(
            backupSetDirectoryPath,
            current.snapshotDirectoryName,
        );
        const quarantineExists = plainChildDirectoryExists(
            backupSetDirectoryPath,
            current.quarantineDirectoryName,
        );
        if (finalExists || !quarantineExists) {
            throw new Error('Snapshot cleanup quarantine state is invalid');
        }
        validateRegisteredSnapshotDirectory(store, quarantineDirectoryPath, candidate);
        assertNoSnapshotIdentityConflicts(
            backupSetDirectoryPath,
            cleanup.backupSetId,
            snapshots,
            current,
        );
        if (countVerifiedNewerSnapshots(store, backupSetDirectoryPath, candidate, snapshots) < 2) {
            throw new Error('Snapshot cleanup would violate retention');
        }
        current = store.markBackupCleanupDeleting(current.operationId);
        fire(options, 'retention.after-delete-authorization');
    }
    while (current.phase === 'deleting') {
        const finalExists = plainChildDirectoryExists(
            backupSetDirectoryPath,
            current.snapshotDirectoryName,
        );
        const quarantineExists = plainChildDirectoryExists(
            backupSetDirectoryPath,
            current.quarantineDirectoryName,
        );
        if (finalExists) {
            throw new Error('Quarantined snapshot reappeared at its final identity');
        }
        if (quarantineExists) {
            const memberNames = listPlainDirectory(quarantineDirectoryPath);
            const expectedMembers = [DATABASE_MEMBER_NAME, MANIFEST_MEMBER_NAME];
            if (memberNames.some(memberName => !expectedMembers.includes(memberName))) {
                throw new SnapshotValidationError();
            }
            if (memberNames.length === expectedMembers.length) {
                validateRegisteredSnapshotDirectory(store, quarantineDirectoryPath, candidate);
            }
            else if (memberNames.length === 1
                && memberNames[0] === MANIFEST_MEMBER_NAME) {
                validateRegisteredSnapshotManifest(store, quarantineDirectoryPath, candidate);
            }
            else if (memberNames.length !== 0) {
                throw new SnapshotValidationError();
            }
        }
        assertNoSnapshotIdentityConflicts(
            backupSetDirectoryPath,
            cleanup.backupSetId,
            snapshots,
            current,
        );
        if (countVerifiedNewerSnapshots(store, backupSetDirectoryPath, candidate, snapshots) < 2) {
            throw new Error('Snapshot cleanup would violate retention');
        }
        const deletion = deleteQuarantinedSnapshotDirectory(
            backupSetDirectoryPath,
            current.quarantineDirectoryName,
            [DATABASE_MEMBER_NAME, MANIFEST_MEMBER_NAME],
        );
        if (deletion === 'member-deleted') {
            fire(options, 'retention.after-member-delete');
            continue;
        }
        fire(options, 'retention.after-delete');
        store.completeBackupCleanup(current.operationId);
        fire(options, 'retention.after-cleanup-record');
        return;
    }
}

/**
 * Releases a planned cleanup when no operation-owned quarantine remains visible.
 * @param {SqliteDataStore} store - DATA cleanup journal owner.
 * @param {string} backupSetDirectoryPath - Exact current BackupSet directory.
 * @param {BackupCleanupOperation} cleanup - Failed planned cleanup.
 * @param {unknown} error - Failure raised before any allowed rename.
 * @return {boolean} Whether the plan was released without deleting filesystem bytes.
 */
function releaseIneligiblePlannedCleanup(
    store: SqliteDataStore,
    backupSetDirectoryPath: string,
    cleanup: BackupCleanupOperation,
    error: unknown,
): boolean {
    const isEligibilityFailure = error instanceof SnapshotValidationError
        || (error instanceof Error
            && (error.message === 'Snapshot cleanup would violate retention'
                || error.message === 'Snapshot cleanup rename state is ambiguous'));
    if (!isEligibilityFailure) {
        return false;
    }
    const persisted = store.readBackupCleanupOperation();
    if (!persisted
        || persisted.operationId !== cleanup.operationId
        || persisted.phase !== 'planned') {
        return false;
    }
    try {
        plainChildDirectoryExists(
            backupSetDirectoryPath,
            persisted.snapshotDirectoryName,
        );
        const quarantineExists = plainChildDirectoryExists(
            backupSetDirectoryPath,
            persisted.quarantineDirectoryName,
        );
        if (quarantineExists) {
            return false;
        }
    }
    catch {
        return false;
    }
    store.releasePlannedBackupCleanup(persisted.operationId);
    return true;
}

/**
 * Removes only the oldest registered snapshot after two newer full validations succeed.
 * @param {SqliteDataStore} store - DATA backup and cleanup owner.
 * @param {BackupConfigurationForProtection} configuration - Current internal BackupSet facts.
 * @param {DurableBackupPassOptions} options - Deterministic identities and failpoints.
 * @return {void}
 */
function runSnapshotRetention(
    store: SqliteDataStore,
    configuration: BackupConfigurationForProtection,
    options: DurableBackupPassOptions,
): void {
    while (true) {
        const snapshots = store.readSuccessfulBackupSnapshots();
        const activeCleanup = store.readBackupCleanupOperation();
        if (!activeCleanup && snapshots.length <= 2) {
            return;
        }
        const tree = readBackupSetTree({
            destinationPath: configuration.canonicalPath,
            repositoryDirectoryName: REPOSITORY_DIRECTORY_NAME,
            repositoryMarkerName: REPOSITORY_MARKER_NAME,
            repositoryMarkerBytes: REPOSITORY_MARKER_BYTES,
            workspaceDirectoryName: configuration.workspaceId,
            backupSetDirectoryName: configuration.backupSetId,
        });
        let cleanup = activeCleanup;
        if (!cleanup) {
            const candidate = findOldestVerifiedCleanupCandidate(
                store,
                tree.backupSetDirectoryPath,
                snapshots,
            );
            if (!candidate) {
                return;
            }
            const operationId = options.cleanupOperationIdFactory?.() ?? randomUUID();
            cleanup = store.claimBackupCleanupOperation(operationId, candidate.snapshotId);
            if (!cleanup) {
                return;
            }
            fire(options, 'retention.after-cleanup-claim');
        }
        try {
            resumeSnapshotCleanup(
                store,
                tree.backupSetDirectoryPath,
                cleanup,
                snapshots,
                options,
            );
        }
        catch (error) {
            if (releaseIneligiblePlannedCleanup(
                store,
                tree.backupSetDirectoryPath,
                cleanup,
                error,
            )) {
                continue;
            }
            throw error;
        }
    }
}

/**
 * Combines persistent success/watermark facts with a fresh read-only full validation.
 * @param {SqliteDataStore} store - DATA owner and snapshot database validator.
 * @return {DataProtectionProjection} Path-free current protection status.
 */
export function readVerifiedDataProtectionProjection(
    store: SqliteDataStore,
    restoreCandidates: readonly RestoreCandidateProjection[] = Object.freeze([]),
): DataProtectionProjection {
    const projection = store.readDataProtectionProjection();
    if (!('backup' in projection)) {
        return projection;
    }
    const configuration = store.readBackupConfigurationForProtection();
    if (!configuration || configuration.backupSetId !== projection.configuration.backupSetId) {
        throw new Error('Backup configuration identity is inconsistent');
    }
    const registeredSnapshots = store.readSuccessfulBackupSnapshots();
    const verifiedSnapshots: SuccessfulBackupSnapshot[] = [];
    try {
        const tree = readBackupSetTree({
            destinationPath: configuration.canonicalPath,
            repositoryDirectoryName: REPOSITORY_DIRECTORY_NAME,
            repositoryMarkerName: REPOSITORY_MARKER_NAME,
            repositoryMarkerBytes: REPOSITORY_MARKER_BYTES,
            workspaceDirectoryName: configuration.workspaceId,
            backupSetDirectoryName: configuration.backupSetId,
        });
        for (const snapshot of [...registeredSnapshots].reverse()) {
            if (verifiedSnapshots.length === 2) {
                break;
            }
            const directoryName = `snapshot-${snapshot.snapshotId}`;
            if (plainChildDirectoryExists(tree.backupSetDirectoryPath, directoryName)
                && isRegisteredSnapshotVerified(
                    store,
                    path.join(tree.backupSetDirectoryPath, directoryName),
                    snapshot,
                )) {
                verifiedSnapshots.push(snapshot);
            }
        }
    }
    catch {
        verifiedSnapshots.length = 0;
    }
    return Object.freeze({
        ...projection,
        backup: Object.freeze({
            ...projection.backup,
            recentVerifiedSnapshots: Object.freeze(verifiedSnapshots.map(snapshot => Object.freeze({
                snapshotId: snapshot.snapshotId,
                backupSequence: snapshot.backupSequence,
                actualRevision: snapshot.actualRevision,
                succeededAt: snapshot.succeededAt,
                snapshotFormatVersion: '1' as const,
                integrity: 'verified' as const,
            }))),
            restoreCandidates: Object.freeze(Array.from(restoreCandidates)),
        }),
    });
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
        runSnapshotRetention(store, configuration, options);
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
        const finalDirectoryExists = operation.phase === 'publishing'
            || operation.phase === 'published-pending-record'
            ? plainChildDirectoryExists(
                tree.backupSetDirectoryPath,
                path.basename(paths.finalDirectoryPath),
            )
            : false;
        if (operation.phase === 'queued') {
            const checkpoint = await checkpointDatabase(store, operation, paths, options);
            operation = checkpoint.operation;
            databaseFacts = checkpoint.databaseFacts;
        }
        else if (operation.phase === 'publishing' && !finalDirectoryExists) {
            databaseFacts = readCheckpointFacts(store, operation, paths.stagingDatabasePath);
        }
        else if (operation.phase === 'published-pending-record' && !finalDirectoryExists) {
            throw new SnapshotValidationError();
        }
        else if (operation.phase === 'published-pending-record' || operation.phase === 'publishing') {
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
            const finalTree = readBackupSetTree({
                destinationPath: configuration.canonicalPath,
                repositoryDirectoryName: REPOSITORY_DIRECTORY_NAME,
                repositoryMarkerName: REPOSITORY_MARKER_NAME,
                repositoryMarkerBytes: REPOSITORY_MARKER_BYTES,
                workspaceDirectoryName: configuration.workspaceId,
                backupSetDirectoryName: configuration.backupSetId,
            });
            const finalPaths = snapshotPaths(finalTree.backupSetDirectoryPath, operation);
            if (!plainChildDirectoryExists(
                finalTree.backupSetDirectoryPath,
                path.basename(finalPaths.finalDirectoryPath),
            )) {
                throw new SnapshotValidationError();
            }
            const finalDatabaseFacts = readCheckpointFacts(
                store,
                operation,
                finalPaths.finalDatabasePath,
            );
            const rootDigest = validateSnapshotDirectory(
                store,
                finalPaths.finalDirectoryPath,
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
