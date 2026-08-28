import { constants as fsConstants } from 'node:fs';
import { copyFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { backup } from 'node:sqlite';
import { COURSEFLOW_APPLICATION_ID, CURRENT_SCHEMA_LEVEL, migrateLevel13To14, migrateLevel14To15, migrateLevel15To16, validateSchemaLevel13, validateSchemaLevel14, validateSchemaLevel15, validateSchemaLevel16 } from '../../schema';
import type { StoreContext } from '../context';
import { normalizeBackupDatabaseCopy, openDatabase, readDatabaseIdentity, readRestoreImpactCounts, readRestoreSourceBackup, validateSupportedRestoreSchema } from '../database';
import type { BackupDatabaseFacts, PreparedRestoreDatabaseFacts, RestoreDatabaseFacts } from '../types';
import { isCanonicalUnsignedSqliteInteger } from '../../../shared/workspace-data-contract';
/**
 * Revalidates one raw snapshot database as a supported restore candidate.
 * @param {string} candidatePath - Exact immutable snapshot member path.
 * @return {RestoreDatabaseFacts} Fresh identity, revision, schema, and impact facts.
 */
export function inspectRestoreCandidateDatabase(ctx: StoreContext, candidatePath: string): RestoreDatabaseFacts {
    ctx.requireOpen();
    if (!isAbsolute(candidatePath) || candidatePath.includes('\0')) {
        throw new TypeError('Restore candidate database path is invalid');
    }
    const candidate = openDatabase(candidatePath, true);
    try {
        const identity = readDatabaseIdentity(candidate);
        const facts = validateSupportedRestoreSchema(candidate, identity.schemaLevel);
        if (identity.applicationId !== COURSEFLOW_APPLICATION_ID
            || facts === null
            || facts.workspaceId !== ctx.workspaceId
            || facts.revision <= 0n) {
            throw new Error('Restore candidate database identity is invalid');
        }
        return Object.freeze({
            workspaceId: facts.workspaceId,
            applicationId: identity.applicationId.toString(),
            schemaLevel: identity.schemaLevel.toString(),
            actualRevision: facts.revision.toString(),
            ...readRestoreImpactCounts(candidate),
            sourceBackup: readRestoreSourceBackup(candidate),
        });
    }
    finally {
        candidate.close();
    }
}

/**
 * Copies and migrates one verified candidate in an isolated validation directory.
 * @param {string} sourcePath - Immutable raw snapshot database member.
 * @param {string} destinationPath - Absent operation-owned validation copy path.
 * @return {PreparedRestoreDatabaseFacts} Validated prepared copy facts.
 */
export function prepareRestoreCandidateDatabaseCopy(ctx: StoreContext, 
    sourcePath: string,
    destinationPath: string,
): PreparedRestoreDatabaseFacts {
    ctx.requireOpen();
    if (!isAbsolute(sourcePath)
        || sourcePath.includes('\0')
        || !isAbsolute(destinationPath)
        || destinationPath.includes('\0')) {
        throw new TypeError('Restore candidate copy paths are invalid');
    }
    const sourceFacts = inspectRestoreCandidateDatabase(ctx, sourcePath);
    copyFileSync(sourcePath, destinationPath, fsConstants.COPYFILE_EXCL);
    const prepared = openDatabase(destinationPath, false);
    try {
        let schemaLevel = Number(sourceFacts.schemaLevel);
        while (schemaLevel < CURRENT_SCHEMA_LEVEL) {
            prepared.exec('BEGIN IMMEDIATE');
            try {
                if (schemaLevel === 13) {
                    validateSchemaLevel13(prepared);
                    migrateLevel13To14(prepared);
                    validateSchemaLevel14(prepared);
                }
                else if (schemaLevel === 14) {
                    validateSchemaLevel14(prepared);
                    migrateLevel14To15(prepared);
                    validateSchemaLevel15(prepared);
                }
                else if (schemaLevel === 15) {
                    validateSchemaLevel15(prepared);
                    migrateLevel15To16(prepared);
                    validateSchemaLevel16(prepared);
                }
                else {
                    throw new Error('Restore candidate schema is unsupported');
                }
                prepared.exec('COMMIT');
                schemaLevel += 1;
            }
            catch (error) {
                if (prepared.isTransaction) {
                    prepared.exec('ROLLBACK');
                }
                throw error;
            }
        }
    }
    finally {
        prepared.close();
    }
    normalizeBackupDatabaseCopy(destinationPath);
    const preparedFacts = inspectRestoreCandidateDatabase(ctx, destinationPath);
    return Object.freeze({
        ...preparedFacts,
        sourceSchemaLevel: sourceFacts.schemaLevel,
        preparedSchemaLevel: preparedFacts.schemaLevel,
        validationCopy: sourceFacts.schemaLevel === preparedFacts.schemaLevel
            ? 'copied'
            : 'migrated',
    });
}

/**
 * Writes and verifies a healthy current DATA member for a RestoreSafetySet.
 * @param {string} destinationPath - Absent operation-owned safety member path.
 * @param {string} expectedRevision - Minimum preview-bound current revision.
 * @return {Promise<BackupDatabaseFacts>} Fresh copied current DATA facts.
 */
export async function writeRestoreSafetyDatabaseCopy(ctx: StoreContext, 
    destinationPath: string,
    expectedRevision: string,
): Promise<BackupDatabaseFacts> {
    ctx.requireBackupMutationAllowed();
    if (!isAbsolute(destinationPath)
        || destinationPath.includes('\0')
        || !isCanonicalUnsignedSqliteInteger(expectedRevision)) {
        throw new TypeError('Restore safety database destination is invalid');
    }
    await backup(ctx.database, destinationPath);
    normalizeBackupDatabaseCopy(destinationPath);
    return validateRestoreSafetyDatabaseCopy(ctx, destinationPath, expectedRevision);
}

/**
 * Revalidates one healthy RestoreSafetySet DATA member against the current schema.
 * @param {string} copyPath - Exact copied database path.
 * @param {string} minimumRevision - Minimum revision the copy must cover.
 * @return {BackupDatabaseFacts} Fresh current DATA facts.
 */
export function validateRestoreSafetyDatabaseCopy(ctx: StoreContext, 
    copyPath: string,
    minimumRevision: string,
): BackupDatabaseFacts {
    ctx.requireOpen();
    if (!isAbsolute(copyPath)
        || copyPath.includes('\0')
        || !isCanonicalUnsignedSqliteInteger(minimumRevision)) {
        throw new TypeError('Restore safety database validation input is invalid');
    }
    const copied = openDatabase(copyPath, true);
    try {
        const identity = readDatabaseIdentity(copied);
        const facts = validateSupportedRestoreSchema(copied, identity.schemaLevel);
        if (identity.applicationId !== COURSEFLOW_APPLICATION_ID
            || identity.schemaLevel !== CURRENT_SCHEMA_LEVEL
            || facts === null
            || facts.workspaceId !== ctx.workspaceId
            || facts.revision < BigInt(minimumRevision)) {
            throw new Error('Restore safety database does not match current DATA');
        }
        return Object.freeze({
            workspaceId: facts.workspaceId,
            applicationId: identity.applicationId.toString(),
            schemaLevel: identity.schemaLevel.toString(),
            actualRevision: facts.revision.toString(),
        });
    }
    finally {
        copied.close();
    }
}

/**
 * Writes a consistent SQLite backup member and returns facts read from that exact copy.
 * @param {string} destinationPath - Absent operation-owned temporary file.
 * @param {string} targetRevision - Durable revision the copy must cover.
 * @return {Promise<BackupDatabaseFacts>} Validated copied database identity and actual revision.
 */
export async function writeBackupDatabaseCopy(ctx: StoreContext, 
    destinationPath: string,
    targetRevision: string,
): Promise<BackupDatabaseFacts> {
    ctx.requireBackupMutationAllowed();
    if (!isAbsolute(destinationPath)
        || destinationPath.includes('\0')
        || !isCanonicalUnsignedSqliteInteger(targetRevision)
        || targetRevision === '0') {
        throw new TypeError('Backup database destination is invalid');
    }
    await backup(ctx.database, destinationPath);
    normalizeBackupDatabaseCopy(destinationPath);
    return validateBackupDatabaseCopy(ctx, destinationPath, targetRevision);
}

/**
 * Revalidates one existing backup member without consulting cached checkpoint facts.
 * @param {string} copyPath - Exact copied database path.
 * @param {string} targetRevision - Durable revision the copy must cover.
 * @return {BackupDatabaseFacts} Fresh database identity and actual revision.
 */
export function validateBackupDatabaseCopy(ctx: StoreContext, 
    copyPath: string,
    targetRevision: string,
): BackupDatabaseFacts {
    ctx.requireOpen();
    if (!isAbsolute(copyPath)
        || copyPath.includes('\0')
        || !isCanonicalUnsignedSqliteInteger(targetRevision)
        || targetRevision === '0') {
        throw new TypeError('Backup database validation input is invalid');
    }
    const copied = openDatabase(copyPath, true);
    try {
        const identity = readDatabaseIdentity(copied);
        const facts = identity.schemaLevel === 13
            ? validateSchemaLevel13(copied)
            : identity.schemaLevel === 14
                ? validateSchemaLevel14(copied)
                : identity.schemaLevel === 15
                    ? validateSchemaLevel15(copied)
                    : identity.schemaLevel === 16
                        ? validateSchemaLevel16(copied)
                        : null;
        if (identity.applicationId !== COURSEFLOW_APPLICATION_ID
            || facts === null
            || facts.workspaceId !== ctx.workspaceId
            || facts.revision < BigInt(targetRevision)) {
            throw new Error('Backup database copy does not cover the target revision');
        }
        return Object.freeze({
            workspaceId: facts.workspaceId,
            applicationId: identity.applicationId.toString(),
            schemaLevel: identity.schemaLevel.toString(),
            actualRevision: facts.revision.toString(),
        });
    }
    finally {
        copied.close();
    }
}
