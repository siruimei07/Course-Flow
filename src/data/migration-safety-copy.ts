/**
 * @file Owns the closed MigrationSafetyCopyV1 filesystem format and replacement boundary.
 */

import {createHash, randomUUID} from 'node:crypto';
import path from 'node:path';
import {backup, DatabaseSync} from 'node:sqlite';

import {
    COURSEFLOW_APPLICATION_ID,
    CURRENT_SCHEMA_LEVEL,
    validateSchemaLevel1,
    validateSchemaLevel2,
    validateSchemaLevel3,
    validateSchemaLevel4,
    validateSchemaLevel5,
    validateSchemaLevel6,
    validateSchemaLevel7,
    validateSchemaLevel8,
    validateSchemaLevel9,
    validateSchemaLevel10,
    validateSchemaLevel11,
    validateSchemaLevel12,
    validateSchemaLevel13,
    validateSchemaLevel14,
    validateSchemaLevel15,
    validateSchemaLevel16,
    validateSchemaLevel17,
    type SchemaFacts,
} from './schema';
import {
    deleteQuarantinedSnapshotDirectory,
    digestPlainFile,
    ensureSnapshotStagingDirectory,
    listPlainDirectory,
    plainChildDirectoryExists,
    publishSnapshotDirectory,
    quarantineSnapshotDirectory,
    readBoundedPlainFile,
    syncPlainFile,
    writeOrVerifyBackupFile,
} from '../platform/backup-snapshot-files';
import {
    observeRestoreDataSlot,
    readRestoreDataSlotStableIdentity,
    requireRestoreDataSlotStableIdentity,
    stageRestoreDataSlot,
    type RestoreActivationFileOptions,
    type RestoreDataSlotFingerprint,
    type RestoreDataSlotStableIdentityV1,
} from '../platform/restore-activation-files';
import {canonicalJson} from '../shared/canonical-json';
import {
    isCanonicalUnsignedSqliteInteger,
    isCanonicalUuid,
} from '../shared/workspace-data-contract';

export const MIGRATION_SAFETY_COPY_SCHEMA = 'courseflow-migration-safety-copy-v1';
export const MIGRATION_SAFETY_COPY_LIMITS_VERSION = 'migration-safety-copy-limits-v1';
export const MIGRATION_SAFETY_COPY_DIGEST_VERSION = 'sha256-v1';

const DATABASE_FILE_NAME = 'workspace.sqlite';
const METADATA_FILE_NAME = 'migration-safety-copy-v1.json';
const FINAL_DIRECTORY_PREFIX = 'migration-safety-copy-';
const STAGING_DIRECTORY_PREFIX = '.migration-safety-staging-';
const DISCARD_DIRECTORY_PREFIX = '.migration-safety-discard-';
const RETIRED_DIRECTORY_PREFIX = '.migration-safety-retired-';
const CONSUMED_DIRECTORY_PREFIX = '.migration-safety-consumed-';
const MAXIMUM_DATABASE_BYTES = 1_099_511_627_776n;
const MAXIMUM_METADATA_BYTES = 32_768;
const MAXIMUM_STRING_LENGTH = 1_024;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const PORTABLE_ARTIFACT_PATTERN = /^[^/\\\0]+$/;

export type MigrationRollbackArtifactV1 = Readonly<{
    platform: 'darwin-arm64' | 'win32-x64';
    name: string;
    sha256: string;
}>;

export type MigrationRollbackTargetV1 = Readonly<{
    releaseVersion: string;
    tag: string;
    appBuildId: string;
    artifacts: readonly [MigrationRollbackArtifactV1, MigrationRollbackArtifactV1];
}>;

export type MigrationSafetyCopyBuildBindingV1 = Readonly<{
    createdByAppBuildId: string;
    rollbackTarget: MigrationRollbackTargetV1 | null;
    clock?: Readonly<{now(): string}>;
}>;

export type MigrationSafetyCopyMetadataV1 = Readonly<{
    schema: typeof MIGRATION_SAFETY_COPY_SCHEMA;
    limitsVersion: typeof MIGRATION_SAFETY_COPY_LIMITS_VERSION;
    digestVersion: typeof MIGRATION_SAFETY_COPY_DIGEST_VERSION;
    migrationSafetyCopyId: string;
    workspaceId: string;
    sourceRevision: string;
    sourceSchemaLevel: string;
    targetSchemaLevel: string;
    createdAt: string;
    byteSize: string;
    closedDataSlotDigest: string;
    sourceDataSlotProvenance: RestoreDataSlotStableIdentityV1;
    createdByAppBuildId: string;
    rollbackTarget: MigrationRollbackTargetV1 | null;
    replacesMigrationSafetyCopyId: string | null;
    metadataDigest: string;
}>;

export type MigrationSafetyCopyStatus =
    | Readonly<{kind: 'absent'}>
    | Readonly<{kind: 'verified'; metadata: MigrationSafetyCopyMetadataV1}>
    | Readonly<{kind: 'unavailable'}>;

export type MigrationSafetyCopyFailpoint =
    | 'migration-safety.after-database-copy'
    | 'migration-safety.after-metadata-write'
    | 'migration-safety.after-publish'
    | 'migration-safety.after-previous-quarantine'
    | 'migration-safety.after-previous-member-delete';

export type ConsumeMigrationSafetyCopyOptions = Readonly<{
    failpoint?: (point:
        | 'migration-safety-consume.after-quarantine'
        | 'migration-safety-consume.after-database-delete') => void;
}>;

export type DeleteMigrationSafetyCopyOptions = Readonly<{
    failpoint?: (point:
        | 'migration-safety-delete.before-quarantine'
        | 'migration-safety-delete.after-quarantine'
        | 'migration-safety-delete.after-member-delete') => void;
}>;

/**
 * Binds an explicit delete confirmation to one exact registered copy version.
 * @param {string} migrationSafetyCopyId Exact copy identity shown to the user.
 * @param {string} metadataVersion Exact freshly verified metadata digest.
 * @return {string} Versioned confirmation token for DeleteMigrationSafetyCopy.
 */
export function migrationSafetyCopyDeleteConfirmationToken(
    migrationSafetyCopyId: string,
    metadataVersion: string,
): string {
    if (!isCanonicalUuid(migrationSafetyCopyId) || !DIGEST_PATTERN.test(metadataVersion)) {
        throw new TypeError('Migration safety delete preview identity is invalid');
    }
    return createHash('sha256').update(canonicalJson(Object.freeze({
        schema: 'courseflow-migration-safety-delete-preview-v1',
        migrationSafetyCopyId,
        metadataVersion,
        impact: 'exact-rollback-capability-will-be-lost',
    })), 'utf8').digest('hex');
}

export type EnsureMigrationSafetyCopyInput = Readonly<{
    dataSlotsRoot: string;
    sourceDatabase: DatabaseSync;
    workspaceId: string;
    sourceRevision: bigint;
    sourceSchemaLevel: number;
    targetSchemaLevel: number;
    binding: MigrationSafetyCopyBuildBindingV1;
    failpoint?: (point: MigrationSafetyCopyFailpoint) => void;
}>;

type VerifiedCopy = Readonly<{
    directoryName: string;
    metadata: MigrationSafetyCopyMetadataV1;
}>;

/**
 * Tests exact enumerable plain-object keys.
 * @param {unknown} value - Candidate value.
 * @param {readonly string[]} keys - Complete key set.
 * @return {boolean} Whether the value has exactly the requested keys.
 */
function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
    if (typeof value !== 'object'
        || value === null
        || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype) {
        return false;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Reflect.ownKeys(descriptors);
    return actual.length === keys.length
        && actual.every(key => typeof key === 'string' && keys.includes(key))
        && keys.every(key => {
            const descriptor = descriptors[key];
            return descriptor !== undefined && descriptor.enumerable && 'value' in descriptor;
        });
}

/**
 * Validates one bounded protocol string.
 * @param {unknown} value - Candidate string.
 * @return {value is string} Whether it is non-empty and within the V1 bound.
 */
function isBoundedString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= MAXIMUM_STRING_LENGTH;
}

/**
 * Computes a canonical digest after omitting the record's digest field.
 * @param {Record<string, unknown>} value - Complete record.
 * @return {string} Lowercase SHA-256.
 */
function metadataDigest(value: Record<string, unknown>): string {
    const undigested = {...value};
    delete undigested.metadataDigest;
    return createHash('sha256').update(canonicalJson(undigested), 'utf8').digest('hex');
}

/**
 * Accepts a missing rollback target, which is what a build without a published compatible
 * predecessor has. The safety copy is still created and verified; only the rollback offer depends
 * on a target being present.
 * @param {unknown} value - Candidate target or null.
 * @return {MigrationRollbackTargetV1 | null} Validated target, or null when none is bound.
 */
function optionalRollbackTarget(value: unknown): MigrationRollbackTargetV1 | null {
    return value === null ? null : requireRollbackTarget(value);
}

/**
 * Requires one exact rollback target without accepting arbitrary platform maps.
 * @param {unknown} value - Candidate target.
 * @return {MigrationRollbackTargetV1} Validated target.
 */
function requireRollbackTarget(value: unknown): MigrationRollbackTargetV1 {
    if (!hasExactKeys(value, ['releaseVersion', 'tag', 'appBuildId', 'artifacts'])
        || !isBoundedString(value.releaseVersion)
        || !isBoundedString(value.tag)
        || !isBoundedString(value.appBuildId)
        || !Array.isArray(value.artifacts)
        || value.artifacts.length !== 2) {
        throw new Error('Migration rollback target is invalid');
    }
    const artifacts = value.artifacts.map(artifact => {
        if (!hasExactKeys(artifact, ['platform', 'name', 'sha256'])
            || (artifact.platform !== 'darwin-arm64' && artifact.platform !== 'win32-x64')
            || !isBoundedString(artifact.name)
            || !PORTABLE_ARTIFACT_PATTERN.test(artifact.name)
            || typeof artifact.sha256 !== 'string'
            || !DIGEST_PATTERN.test(artifact.sha256)) {
            throw new Error('Migration rollback artifact is invalid');
        }
        return Object.freeze({
            platform: artifact.platform,
            name: artifact.name,
            sha256: artifact.sha256,
        });
    });
    if (artifacts[0]?.platform !== 'darwin-arm64'
        || artifacts[1]?.platform !== 'win32-x64') {
        throw new Error('Migration rollback artifacts are not canonical');
    }
    return Object.freeze({
        releaseVersion: value.releaseVersion,
        tag: value.tag,
        appBuildId: value.appBuildId,
        artifacts: Object.freeze(artifacts) as unknown as readonly [
            MigrationRollbackArtifactV1,
            MigrationRollbackArtifactV1,
        ],
    });
}

/**
 * Parses and validates one canonical MigrationSafetyCopyV1 metadata file.
 * @param {Buffer} bytes - Exact metadata bytes.
 * @return {MigrationSafetyCopyMetadataV1} Validated metadata.
 */
function requireMetadata(bytes: Buffer): MigrationSafetyCopyMetadataV1 {
    if (bytes.byteLength > MAXIMUM_METADATA_BYTES
        || (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF)) {
        throw new Error('Migration safety metadata exceeds its trust boundary');
    }
    const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    const value = JSON.parse(text) as unknown;
    if (!hasExactKeys(value, [
        'schema',
        'limitsVersion',
        'digestVersion',
        'migrationSafetyCopyId',
        'workspaceId',
        'sourceRevision',
        'sourceSchemaLevel',
        'targetSchemaLevel',
        'createdAt',
        'byteSize',
        'closedDataSlotDigest',
        'sourceDataSlotProvenance',
        'createdByAppBuildId',
        'rollbackTarget',
        'replacesMigrationSafetyCopyId',
        'metadataDigest',
    ])
        || canonicalJson(value) !== text
        || value.schema !== MIGRATION_SAFETY_COPY_SCHEMA
        || value.limitsVersion !== MIGRATION_SAFETY_COPY_LIMITS_VERSION
        || value.digestVersion !== MIGRATION_SAFETY_COPY_DIGEST_VERSION
        || !isCanonicalUuid(value.migrationSafetyCopyId)
        || !isCanonicalUuid(value.workspaceId)
        || typeof value.sourceRevision !== 'string'
        || !isCanonicalUnsignedSqliteInteger(value.sourceRevision)
        || typeof value.sourceSchemaLevel !== 'string'
        || !isCanonicalUnsignedSqliteInteger(value.sourceSchemaLevel)
        || value.sourceSchemaLevel === '0'
        || typeof value.targetSchemaLevel !== 'string'
        || !isCanonicalUnsignedSqliteInteger(value.targetSchemaLevel)
        || value.targetSchemaLevel === '0'
        || typeof value.createdAt !== 'string'
        || new Date(value.createdAt).toISOString() !== value.createdAt
        || typeof value.byteSize !== 'string'
        || !isCanonicalUnsignedSqliteInteger(value.byteSize)
        || value.byteSize === '0'
        || typeof value.closedDataSlotDigest !== 'string'
        || !DIGEST_PATTERN.test(value.closedDataSlotDigest)
        || !isBoundedString(value.createdByAppBuildId)
        || !(value.replacesMigrationSafetyCopyId === null
            || isCanonicalUuid(value.replacesMigrationSafetyCopyId))
        || typeof value.metadataDigest !== 'string'
        || !DIGEST_PATTERN.test(value.metadataDigest)
        || metadataDigest(value) !== value.metadataDigest) {
        throw new Error('Migration safety metadata is invalid');
    }
    const rollbackTarget = optionalRollbackTarget(value.rollbackTarget);
    const sourceDataSlotProvenance = requireRestoreDataSlotStableIdentity(
        value.sourceDataSlotProvenance,
    );
    return Object.freeze({
        ...(value as Omit<
            MigrationSafetyCopyMetadataV1,
            'rollbackTarget' | 'sourceDataSlotProvenance'
        >),
        rollbackTarget,
        sourceDataSlotProvenance,
    });
}

/**
 * Validates the exact retained schema using the owning DATA validators.
 * @param {DatabaseSync} database - Closed-copy database opened read-only.
 * @param {number} schemaLevel - Declared source level.
 * @return {SchemaFacts} Exact identity facts.
 */
function validateSchema(database: DatabaseSync, schemaLevel: number): SchemaFacts {
    if (schemaLevel === 1) return validateSchemaLevel1(database);
    if (schemaLevel === 2) return validateSchemaLevel2(database);
    if (schemaLevel === 3) return validateSchemaLevel3(database);
    if (schemaLevel === 4) return validateSchemaLevel4(database);
    if (schemaLevel === 5) return validateSchemaLevel5(database);
    if (schemaLevel === 6) return validateSchemaLevel6(database);
    if (schemaLevel === 7) return validateSchemaLevel7(database);
    if (schemaLevel === 8) return validateSchemaLevel8(database);
    if (schemaLevel === 9) return validateSchemaLevel9(database);
    if (schemaLevel === 10) return validateSchemaLevel10(database);
    if (schemaLevel === 11) return validateSchemaLevel11(database);
    if (schemaLevel === 12) return validateSchemaLevel12(database);
    if (schemaLevel === 13) return validateSchemaLevel13(database);
    if (schemaLevel === 14) return validateSchemaLevel14(database);
    if (schemaLevel === 15) return validateSchemaLevel15(database);
    if (schemaLevel === 16) return validateSchemaLevel16(database);
    if (schemaLevel === 17) return validateSchemaLevel17(database);
    throw new Error('Migration safety schema level is unsupported');
}

/**
 * Closes a SQLite Online Backup result into a standalone one-member DATA copy.
 * @param {string} databasePath - Exact unpublished database copy.
 * @return {void}
 */
function normalizeClosedCopy(databasePath: string): void {
    const database = new DatabaseSync(path.toNamespacedPath(databasePath), {
        enableForeignKeyConstraints: true,
        enableDoubleQuotedStringLiterals: false,
        allowExtension: false,
        allowUnknownNamedParameters: false,
        defensive: true,
        timeout: 5_000,
    });
    try {
        database.exec('PRAGMA foreign_keys = ON');
        database.exec('PRAGMA trusted_schema = OFF');
        const journalMode = database.prepare('PRAGMA journal_mode = DELETE').get() as {
            journal_mode: unknown;
        };
        database.exec('PRAGMA synchronous = FULL');
        if (journalMode.journal_mode !== 'delete') {
            throw new Error('Migration safety copy could not become a standalone member');
        }
    }
    finally {
        database.close();
    }
}

/**
 * Reopens one safety directory and verifies its complete closure, database, and metadata.
 * @param {string} dataSlotsRoot - Trusted DATA owner root.
 * @param {string} directoryName - Exact direct-child directory name.
 * @return {VerifiedCopy} Freshly verified copy.
 */
function verifyCopyDirectory(
    dataSlotsRoot: string,
    directoryName: string,
    copyId: string,
): VerifiedCopy {
    if (!isCanonicalUuid(copyId) || !plainChildDirectoryExists(dataSlotsRoot, directoryName)) {
        throw new Error('Migration safety copy identity is invalid');
    }
    const directoryPath = path.join(dataSlotsRoot, directoryName);
    if (canonicalJson(listPlainDirectory(directoryPath))
        !== canonicalJson([METADATA_FILE_NAME, DATABASE_FILE_NAME].sort())) {
        throw new Error('Migration safety copy closure is invalid');
    }
    const metadata = requireMetadata(readBoundedPlainFile(
        path.join(directoryPath, METADATA_FILE_NAME),
        MAXIMUM_METADATA_BYTES,
    ));
    if (metadata.migrationSafetyCopyId !== copyId) {
        throw new Error('Migration safety copy directory is not bound to its metadata');
    }
    const databasePath = path.join(directoryPath, DATABASE_FILE_NAME);
    const digest = digestPlainFile(databasePath, MAXIMUM_DATABASE_BYTES);
    if (digest.byteLength !== metadata.byteSize
        || digest.sha256 !== metadata.closedDataSlotDigest) {
        throw new Error('Migration safety copy database digest changed');
    }
    const database = new DatabaseSync(path.toNamespacedPath(databasePath), {
        readOnly: true,
        enableForeignKeyConstraints: true,
        enableDoubleQuotedStringLiterals: false,
        allowExtension: false,
        allowUnknownNamedParameters: false,
        defensive: true,
        timeout: 5_000,
    });
    try {
        database.exec('PRAGMA trusted_schema = OFF');
        database.exec('PRAGMA query_only = ON');
        const applicationId = database.prepare('PRAGMA application_id').get() as {application_id: number};
        const userVersion = database.prepare('PRAGMA user_version').get() as {user_version: number};
        if (applicationId.application_id !== COURSEFLOW_APPLICATION_ID
            || String(userVersion.user_version) !== metadata.sourceSchemaLevel) {
            throw new Error('Migration safety copy database identity changed');
        }
        const facts = validateSchema(database, userVersion.user_version);
        if (facts.workspaceId !== metadata.workspaceId
            || facts.revision.toString() !== metadata.sourceRevision) {
            throw new Error('Migration safety copy facts changed');
        }
    }
    finally {
        database.close();
    }
    return Object.freeze({directoryName, metadata});
}

/**
 * Verifies one registered final safety copy.
 * @param {string} dataSlotsRoot - Trusted DATA owner root.
 * @param {string} directoryName - Exact registered directory name.
 * @return {VerifiedCopy} Freshly verified copy.
 */
function verifyCopy(dataSlotsRoot: string, directoryName: string): VerifiedCopy {
    if (!directoryName.startsWith(FINAL_DIRECTORY_PREFIX)) {
        throw new Error('Migration safety copy directory name is invalid');
    }
    return verifyCopyDirectory(
        dataSlotsRoot,
        directoryName,
        directoryName.slice(FINAL_DIRECTORY_PREFIX.length),
    );
}

/**
 * Lists and verifies every registered safety copy directory.
 * @param {string} dataSlotsRoot - Trusted DATA owner root.
 * @return {readonly VerifiedCopy[]} Verified copies.
 */
function readFinalCopies(dataSlotsRoot: string): readonly VerifiedCopy[] {
    return Object.freeze(listPlainDirectory(dataSlotsRoot)
        .filter(name => name.startsWith(FINAL_DIRECTORY_PREFIX))
        .map(name => verifyCopy(dataSlotsRoot, name)));
}

/**
 * Selects the one registered copy, including a published replacement awaiting old-copy cleanup.
 * @param {readonly VerifiedCopy[]} copies - Freshly verified physical copies.
 * @return {VerifiedCopy | null} Unique registered copy.
 */
function registeredCopy(copies: readonly VerifiedCopy[]): VerifiedCopy | null {
    if (copies.length === 0) {
        return null;
    }
    if (copies.length === 1) {
        return copies[0]!;
    }
    if (copies.length === 2) {
        const replacements = copies.filter(candidate => (
            candidate.metadata.replacesMigrationSafetyCopyId !== null
                && copies.some(previous => (
                    previous.metadata.migrationSafetyCopyId
                        === candidate.metadata.replacesMigrationSafetyCopyId
                    && previous.metadata.migrationSafetyCopyId
                        !== candidate.metadata.migrationSafetyCopyId
                ))
        ));
        if (replacements.length === 1) {
            return replacements[0]!;
        }
    }
    throw new Error('Migration safety copy registration is ambiguous');
}

/**
 * Removes one exact superseded safety copy through a same-parent quarantine.
 * @param {string} dataSlotsRoot - Trusted DATA owner root.
 * @param {string} copyId - Exact superseded copy identity.
 * @return {void}
 */
function retireCopy(
    dataSlotsRoot: string,
    copyId: string,
    failpoint?: (point: MigrationSafetyCopyFailpoint) => void,
): void {
    const directoryName = `${FINAL_DIRECTORY_PREFIX}${copyId}`;
    const retiredName = `${RETIRED_DIRECTORY_PREFIX}${copyId}`;
    if (plainChildDirectoryExists(dataSlotsRoot, directoryName)) {
        verifyCopy(dataSlotsRoot, directoryName);
        quarantineSnapshotDirectory(dataSlotsRoot, directoryName, retiredName);
        failpoint?.('migration-safety.after-previous-quarantine');
    }
    while (plainChildDirectoryExists(dataSlotsRoot, retiredName)) {
        deleteQuarantinedSnapshotDirectory(
            dataSlotsRoot,
            retiredName,
            [DATABASE_FILE_NAME, METADATA_FILE_NAME],
        );
        failpoint?.('migration-safety.after-previous-member-delete');
    }
}

/**
 * Removes only exact unpublished safety staging left by an interrupted attempt.
 * @param {string} dataSlotsRoot - Trusted DATA owner root.
 * @return {void}
 */
function discardInterruptedStaging(dataSlotsRoot: string): void {
    const names = listPlainDirectory(dataSlotsRoot);
    const discardedNames = names.filter(name => name.startsWith(DISCARD_DIRECTORY_PREFIX));
    for (const discardedName of discardedNames) {
        const copyId = discardedName.slice(DISCARD_DIRECTORY_PREFIX.length);
        if (!isCanonicalUuid(copyId)) {
            throw new Error('Migration safety discard identity is invalid');
        }
        while (plainChildDirectoryExists(dataSlotsRoot, discardedName)) {
            deleteQuarantinedSnapshotDirectory(
                dataSlotsRoot,
                discardedName,
                [DATABASE_FILE_NAME, METADATA_FILE_NAME],
            );
        }
    }
    const stagingNames = listPlainDirectory(dataSlotsRoot)
        .filter(name => name.startsWith(STAGING_DIRECTORY_PREFIX));
    for (const stagingName of stagingNames) {
        const copyId = stagingName.slice(STAGING_DIRECTORY_PREFIX.length);
        if (!isCanonicalUuid(copyId)) {
            throw new Error('Migration safety staging identity is invalid');
        }
        const discardName = `${DISCARD_DIRECTORY_PREFIX}${copyId}`;
        quarantineSnapshotDirectory(dataSlotsRoot, stagingName, discardName);
        while (plainChildDirectoryExists(dataSlotsRoot, discardName)) {
            deleteQuarantinedSnapshotDirectory(
                dataSlotsRoot,
                discardName,
                [DATABASE_FILE_NAME, METADATA_FILE_NAME],
            );
        }
    }
}

/**
 * Resolves the only valid published-copy or replacement-in-progress state.
 * @param {string} dataSlotsRoot - Trusted DATA owner root.
 * @return {VerifiedCopy | null} Current verified copy.
 */
function settleFinalCopies(
    dataSlotsRoot: string,
    failpoint?: (point: MigrationSafetyCopyFailpoint) => void,
): VerifiedCopy | null {
    const copies = readFinalCopies(dataSlotsRoot);
    const current = registeredCopy(copies);
    if (current?.metadata.replacesMigrationSafetyCopyId) {
        retireCopy(dataSlotsRoot, current.metadata.replacesMigrationSafetyCopyId, failpoint);
        return verifyCopy(dataSlotsRoot, current.directoryName);
    }
    return current;
}

/**
 * Returns whether the existing copy belongs to the interrupted migration chain.
 * @param {VerifiedCopy} copy - Existing verified copy.
 * @param {EnsureMigrationSafetyCopyInput} input - Current migration facts.
 * @return {boolean} Whether it must be reused.
 */
function isSameMigration(copy: VerifiedCopy, input: EnsureMigrationSafetyCopyInput): boolean {
    const metadata = copy.metadata;
    const copiedSchemaLevel = BigInt(metadata.sourceSchemaLevel);
    const currentSchemaLevel = BigInt(input.sourceSchemaLevel);
    const sourceDataSlotProvenance = readRestoreDataSlotStableIdentity(
        input.dataSlotsRoot,
        'active',
    );
    return metadata.workspaceId === input.workspaceId
        && metadata.createdByAppBuildId === input.binding.createdByAppBuildId
        && metadata.targetSchemaLevel === String(input.targetSchemaLevel)
        && canonicalJson(metadata.sourceDataSlotProvenance)
            === canonicalJson(sourceDataSlotProvenance)
        && copiedSchemaLevel <= currentSchemaLevel
        && BigInt(metadata.sourceRevision) + currentSchemaLevel - copiedSchemaLevel
            === input.sourceRevision
        && canonicalJson(metadata.rollbackTarget) === canonicalJson(input.binding.rollbackTarget);
}

/**
 * Creates or reuses the one closed safety copy required before schema writes.
 * @param {EnsureMigrationSafetyCopyInput} input - Validated source and exact build binding.
 * @return {Promise<MigrationSafetyCopyMetadataV1>} Registered metadata.
 */
export async function ensureMigrationSafetyCopy(
    input: EnsureMigrationSafetyCopyInput,
): Promise<MigrationSafetyCopyMetadataV1> {
    const rollbackTarget = optionalRollbackTarget(input.binding.rollbackTarget);
    if (!isBoundedString(input.binding.createdByAppBuildId)
        || (rollbackTarget !== null
            && input.binding.createdByAppBuildId === rollbackTarget.appBuildId)
        || !isCanonicalUuid(input.workspaceId)
        || input.sourceSchemaLevel < 1
        || input.sourceSchemaLevel >= input.targetSchemaLevel
        || input.targetSchemaLevel !== CURRENT_SCHEMA_LEVEL) {
        throw new TypeError('Migration safety copy binding is invalid');
    }
    const sourceDataSlotProvenance = readRestoreDataSlotStableIdentity(
        input.dataSlotsRoot,
        'active',
    );
    discardInterruptedStaging(input.dataSlotsRoot);
    const existing = settleFinalCopies(input.dataSlotsRoot, input.failpoint);
    if (existing && isSameMigration(existing, input)) {
        return existing.metadata;
    }

    const copyId = randomUUID();
    const stagingName = `${STAGING_DIRECTORY_PREFIX}${copyId}`;
    const finalName = `${FINAL_DIRECTORY_PREFIX}${copyId}`;
    const stagingPath = ensureSnapshotStagingDirectory(input.dataSlotsRoot, stagingName);
    const databasePath = path.join(stagingPath, DATABASE_FILE_NAME);
    await backup(input.sourceDatabase, path.toNamespacedPath(databasePath));
    normalizeClosedCopy(databasePath);
    syncPlainFile(databasePath);
    const digest = digestPlainFile(databasePath, MAXIMUM_DATABASE_BYTES);
    const database = new DatabaseSync(path.toNamespacedPath(databasePath), {
        readOnly: true,
        enableForeignKeyConstraints: true,
    });
    try {
        database.exec('PRAGMA trusted_schema = OFF');
        database.exec('PRAGMA query_only = ON');
        const facts = validateSchema(database, input.sourceSchemaLevel);
        if (facts.workspaceId !== input.workspaceId || facts.revision !== input.sourceRevision) {
            throw new Error('Migration safety copy source facts changed');
        }
    }
    finally {
        database.close();
    }
    input.failpoint?.('migration-safety.after-database-copy');
    const createdAt = input.binding.clock?.now() ?? new Date().toISOString();
    if (new Date(createdAt).toISOString() !== createdAt) {
        throw new TypeError('Migration safety copy clock returned a noncanonical instant');
    }
    const undigested: Omit<MigrationSafetyCopyMetadataV1, 'metadataDigest'> = {
        schema: MIGRATION_SAFETY_COPY_SCHEMA,
        limitsVersion: MIGRATION_SAFETY_COPY_LIMITS_VERSION,
        digestVersion: MIGRATION_SAFETY_COPY_DIGEST_VERSION,
        migrationSafetyCopyId: copyId,
        workspaceId: input.workspaceId,
        sourceRevision: input.sourceRevision.toString(),
        sourceSchemaLevel: String(input.sourceSchemaLevel),
        targetSchemaLevel: String(input.targetSchemaLevel),
        createdAt,
        byteSize: digest.byteLength,
        closedDataSlotDigest: digest.sha256,
        sourceDataSlotProvenance,
        createdByAppBuildId: input.binding.createdByAppBuildId,
        rollbackTarget,
        replacesMigrationSafetyCopyId: existing?.metadata.migrationSafetyCopyId ?? null,
    };
    const metadata: MigrationSafetyCopyMetadataV1 = Object.freeze({
        ...undigested,
        metadataDigest: createHash('sha256')
            .update(canonicalJson(undigested), 'utf8')
            .digest('hex'),
    });
    writeOrVerifyBackupFile(
        path.join(stagingPath, METADATA_FILE_NAME),
        Buffer.from(canonicalJson(metadata), 'utf8'),
    );
    verifyCopyInStaging(input.dataSlotsRoot, stagingName, metadata);
    input.failpoint?.('migration-safety.after-metadata-write');
    if (canonicalJson(readRestoreDataSlotStableIdentity(input.dataSlotsRoot, 'active'))
        !== canonicalJson(sourceDataSlotProvenance)) {
        throw new Error('Migration safety source DATA lineage changed');
    }
    publishSnapshotDirectory(stagingPath, path.join(input.dataSlotsRoot, finalName));
    const published = verifyCopy(input.dataSlotsRoot, finalName);
    input.failpoint?.('migration-safety.after-publish');
    if (existing) {
        retireCopy(
            input.dataSlotsRoot,
            existing.metadata.migrationSafetyCopyId,
            input.failpoint,
        );
    }
    return published.metadata;
}

/**
 * Verifies an unpublished directory against exact just-created metadata.
 * @param {string} dataSlotsRoot - Trusted DATA owner root.
 * @param {string} stagingName - Exact staging child.
 * @param {MigrationSafetyCopyMetadataV1} metadata - Expected metadata.
 * @return {void}
 */
function verifyCopyInStaging(
    dataSlotsRoot: string,
    stagingName: string,
    metadata: MigrationSafetyCopyMetadataV1,
): void {
    const stagingPath = path.join(dataSlotsRoot, stagingName);
    if (canonicalJson(listPlainDirectory(stagingPath))
        !== canonicalJson([METADATA_FILE_NAME, DATABASE_FILE_NAME].sort())) {
        throw new Error('Migration safety staging closure is invalid');
    }
    const observed = requireMetadata(readBoundedPlainFile(
        path.join(stagingPath, METADATA_FILE_NAME),
        MAXIMUM_METADATA_BYTES,
    ));
    if (canonicalJson(observed) !== canonicalJson(metadata)) {
        throw new Error('Migration safety staging metadata changed');
    }
    const digest = digestPlainFile(path.join(stagingPath, DATABASE_FILE_NAME), MAXIMUM_DATABASE_BYTES);
    if (digest.byteLength !== metadata.byteSize || digest.sha256 !== metadata.closedDataSlotDigest) {
        throw new Error('Migration safety staging database changed');
    }
}

/**
 * Stages one exact registered safety copy without exposing its DATA-owned source path.
 * @param {string} dataSlotsRoot - Trusted DATA owner root.
 * @param {string} migrationSafetyCopyId - Exact registered copy identity.
 * @param {string} candidateSlotName - Operation-owned direct-child DataSlot identity.
 * @param {RestoreActivationFileOptions} files - Narrow PLATFORM test overrides.
 * @return {RestoreDataSlotFingerprint} Path-free staged-slot fingerprint.
 */
export function stageMigrationSafetyCopyForRollback(
    dataSlotsRoot: string,
    migrationSafetyCopyId: string,
    candidateSlotName: string,
    files: RestoreActivationFileOptions = {},
): RestoreDataSlotFingerprint {
    if (!isCanonicalUuid(migrationSafetyCopyId)) {
        throw new TypeError('Migration safety copy identity is invalid');
    }
    const copies = readFinalCopies(dataSlotsRoot);
    if (copies.length !== 1
        || copies[0]!.metadata.migrationSafetyCopyId !== migrationSafetyCopyId) {
        throw new Error('Migration safety copy is not uniquely registered');
    }
    const copy = copies[0]!;
    const fingerprint = stageRestoreDataSlot(
        path.join(dataSlotsRoot, copy.directoryName, DATABASE_FILE_NAME),
        dataSlotsRoot,
        candidateSlotName,
        files,
    );
    const member = fingerprint.members[0];
    if (fingerprint.members.length !== 1
        || member?.path !== DATABASE_FILE_NAME
        || member.byteLength !== copy.metadata.byteSize
        || member.sha256 !== copy.metadata.closedDataSlotDigest) {
        throw new Error('Migration rollback staged safety bytes changed');
    }
    return fingerprint;
}

/**
 * Verifies that active is exactly the DATA previously registered by the safety metadata.
 * @param {string} dataSlotsRoot - Trusted DATA owner root.
 * @param {MigrationSafetyCopyMetadataV1} metadata - Exact safety identity.
 * @return {void}
 */
function requireActiveSafetyCopy(
    dataSlotsRoot: string,
    metadata: MigrationSafetyCopyMetadataV1,
): void {
    const active = observeRestoreDataSlot(dataSlotsRoot, 'active');
    const member = active.kind === 'present' ? active.fingerprint.members[0] : undefined;
    if (active.kind !== 'present'
        || active.fingerprint.members.length !== 1
        || member?.path !== DATABASE_FILE_NAME
        || member.byteLength !== metadata.byteSize
        || member.sha256 !== metadata.closedDataSlotDigest) {
        throw new Error('Active DATA does not match the migration safety copy');
    }
    const database = new DatabaseSync(
        path.toNamespacedPath(path.join(dataSlotsRoot, 'active', DATABASE_FILE_NAME)),
        {
            readOnly: true,
            enableForeignKeyConstraints: true,
            enableDoubleQuotedStringLiterals: false,
            allowExtension: false,
            allowUnknownNamedParameters: false,
            defensive: true,
            timeout: 5_000,
        },
    );
    try {
        database.exec('PRAGMA trusted_schema = OFF');
        database.exec('PRAGMA query_only = ON');
        const applicationId = database.prepare('PRAGMA application_id').get() as {application_id: number};
        const userVersion = database.prepare('PRAGMA user_version').get() as {user_version: number};
        if (applicationId.application_id !== COURSEFLOW_APPLICATION_ID
            || String(userVersion.user_version) !== metadata.sourceSchemaLevel) {
            throw new Error('Active migration rollback DATA identity changed');
        }
        const facts = validateSchema(database, userVersion.user_version);
        if (facts.workspaceId !== metadata.workspaceId
            || facts.revision.toString() !== metadata.sourceRevision) {
            throw new Error('Active migration rollback DATA facts changed');
        }
    }
    finally {
        database.close();
    }
}

/**
 * Reads either the full quarantined copy or its metadata-only consumption receipt.
 * @param {string} dataSlotsRoot - Trusted DATA owner root.
 * @param {string} consumedName - Exact operation-owned direct-child identity.
 * @param {string} migrationSafetyCopyId - Expected safety-copy identity.
 * @return {MigrationSafetyCopyMetadataV1} Freshly verified metadata.
 */
function requireConsumedSafetyCopy(
    dataSlotsRoot: string,
    consumedName: string,
    migrationSafetyCopyId: string,
): MigrationSafetyCopyMetadataV1 {
    const consumedPath = path.join(dataSlotsRoot, consumedName);
    const members = listPlainDirectory(consumedPath);
    if (canonicalJson(members) === canonicalJson([
        METADATA_FILE_NAME,
        DATABASE_FILE_NAME,
    ].sort())) {
        return verifyCopyDirectory(
            dataSlotsRoot,
            consumedName,
            migrationSafetyCopyId,
        ).metadata;
    }
    if (canonicalJson(members) !== canonicalJson([METADATA_FILE_NAME])) {
        throw new Error('Migration safety consumption receipt closure changed');
    }
    const metadata = requireMetadata(readBoundedPlainFile(
        path.join(consumedPath, METADATA_FILE_NAME),
        MAXIMUM_METADATA_BYTES,
    ));
    if (metadata.migrationSafetyCopyId !== migrationSafetyCopyId) {
        throw new Error('Migration safety consumption receipt identity changed');
    }
    return metadata;
}

/**
 * Atomically consumes the registered safety-copy identity after exact target completion gates.
 * The closed bytes remain operation-owned until later terminal cleanup.
 * @param {string} dataSlotsRoot - Trusted DATA owner root.
 * @param {string} migrationSafetyCopyId - Exact copy now active.
 * @param {string} operationId - Owning rollback operation.
 * @param {ConsumeMigrationSafetyCopyOptions} options - Stable failpoint seam.
 * @return {void}
 */
export function consumeMigrationSafetyCopyAfterRollback(
    dataSlotsRoot: string,
    migrationSafetyCopyId: string,
    operationId: string,
    options: ConsumeMigrationSafetyCopyOptions = {},
): void {
    if (!isCanonicalUuid(migrationSafetyCopyId) || !isCanonicalUuid(operationId)) {
        throw new TypeError('Migration safety consumption identity is invalid');
    }
    const finalName = `${FINAL_DIRECTORY_PREFIX}${migrationSafetyCopyId}`;
    const consumedName = `${CONSUMED_DIRECTORY_PREFIX}${operationId}-${migrationSafetyCopyId}`;
    const finalExists = plainChildDirectoryExists(dataSlotsRoot, finalName);
    const consumedExists = plainChildDirectoryExists(dataSlotsRoot, consumedName);
    if (finalExists === consumedExists) {
        throw new Error('Migration safety consumption evidence is ambiguous');
    }
    let metadata = finalExists
        ? verifyCopy(dataSlotsRoot, finalName).metadata
        : requireConsumedSafetyCopy(dataSlotsRoot, consumedName, migrationSafetyCopyId);
    requireActiveSafetyCopy(dataSlotsRoot, metadata);
    if (finalExists) {
        const copies = readFinalCopies(dataSlotsRoot);
        if (copies.length !== 1
            || copies[0]!.metadata.migrationSafetyCopyId !== migrationSafetyCopyId) {
            throw new Error('Migration safety copy is not uniquely consumable');
        }
        quarantineSnapshotDirectory(dataSlotsRoot, finalName, consumedName);
        options.failpoint?.('migration-safety-consume.after-quarantine');
        metadata = requireConsumedSafetyCopy(
            dataSlotsRoot,
            consumedName,
            migrationSafetyCopyId,
        );
        requireActiveSafetyCopy(dataSlotsRoot, metadata);
    }
    const consumedPath = path.join(dataSlotsRoot, consumedName);
    if (listPlainDirectory(consumedPath).includes(DATABASE_FILE_NAME)) {
        const outcome = deleteQuarantinedSnapshotDirectory(
            dataSlotsRoot,
            consumedName,
            [DATABASE_FILE_NAME, METADATA_FILE_NAME],
        );
        if (outcome !== 'member-deleted') {
            throw new Error('Migration safety duplicate database was not removed');
        }
        options.failpoint?.('migration-safety-consume.after-database-delete');
    }
    const receipt = requireConsumedSafetyCopy(
        dataSlotsRoot,
        consumedName,
        migrationSafetyCopyId,
    );
    requireActiveSafetyCopy(dataSlotsRoot, receipt);
}

/**
 * Inspects the only registered safety copy without exposing its physical location.
 * @param {string} dataSlotsRoot - Trusted DATA owner root.
 * @return {MigrationSafetyCopyStatus} Path-free verified status.
 */
export function inspectMigrationSafetyCopy(
    dataSlotsRoot: string,
): MigrationSafetyCopyStatus {
    try {
        const copy = registeredCopy(readFinalCopies(dataSlotsRoot));
        return copy === null
            ? Object.freeze({kind: 'absent' as const})
            : Object.freeze({kind: 'verified' as const, metadata: copy.metadata});
    }
    catch {
        return Object.freeze({kind: 'unavailable' as const});
    }
}

/**
 * Deletes the one still-registered copy only after its identity is freshly revalidated.
 * The same-parent quarantine rename is the logical delete commit; exact replay resumes bounded cleanup.
 * @param {string} dataSlotsRoot Trusted DATA owner root.
 * @param {string} migrationSafetyCopyId Exact copy identity observed by the caller.
 * @param {string} expectedMetadataDigest Exact copy version observed by the caller.
 * @param {string} confirmationToken Exact impact-confirmation token.
 * @param {DeleteMigrationSafetyCopyOptions} options Stable commit and cleanup failpoints.
 * @return {void}
 */
export function deleteMigrationSafetyCopy(
    dataSlotsRoot: string,
    migrationSafetyCopyId: string,
    expectedMetadataDigest: string,
    confirmationToken: string,
    options: DeleteMigrationSafetyCopyOptions = {},
): void {
    if (!isCanonicalUuid(migrationSafetyCopyId)
        || !DIGEST_PATTERN.test(expectedMetadataDigest)
        || !DIGEST_PATTERN.test(confirmationToken)) {
        throw new TypeError('Migration safety delete identity is invalid');
    }
    const finalName = `${FINAL_DIRECTORY_PREFIX}${migrationSafetyCopyId}`;
    const discardName = `${DISCARD_DIRECTORY_PREFIX}${migrationSafetyCopyId}`;
    const copies = readFinalCopies(dataSlotsRoot);
    const discardExists = plainChildDirectoryExists(dataSlotsRoot, discardName);
    let committedNow = false;
    if (copies.length > 0
        && (copies.length !== 1
            || copies[0]!.metadata.migrationSafetyCopyId !== migrationSafetyCopyId
            || copies[0]!.metadata.metadataDigest !== expectedMetadataDigest)) {
        throw new Error('Migration safety copy identity changed');
    }
    if (migrationSafetyCopyDeleteConfirmationToken(
        migrationSafetyCopyId,
        expectedMetadataDigest,
    ) !== confirmationToken) {
        throw new Error('Migration safety delete confirmation changed');
    }
    if (copies.length > 0) {
        if (discardExists) {
            throw new Error('Migration safety delete evidence is ambiguous');
        }
        options.failpoint?.('migration-safety-delete.before-quarantine');
        quarantineSnapshotDirectory(dataSlotsRoot, finalName, discardName);
        committedNow = true;
    }
    else if (!discardExists) {
        return;
    }

    try {
        if (committedNow) {
            options.failpoint?.('migration-safety-delete.after-quarantine');
        }
        while (plainChildDirectoryExists(dataSlotsRoot, discardName)) {
            const outcome = deleteQuarantinedSnapshotDirectory(
                dataSlotsRoot,
                discardName,
                [DATABASE_FILE_NAME, METADATA_FILE_NAME],
            );
            if (outcome === 'member-deleted') {
                options.failpoint?.('migration-safety-delete.after-member-delete');
            }
        }
    }
    catch {
        // The durable rename already removed rollback capability; exact replay resumes cleanup.
    }
}
