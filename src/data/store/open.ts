/**
 * @file Activity DATA slot inspection, initialization, open, and forward-migration entry points.
 */
import { existsSync, rmSync } from 'node:fs';
import { basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, renameSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ensureMigrationSafetyCopy } from '../migration-safety-copy';
import {
    COURSEFLOW_APPLICATION_ID,
    CURRENT_SCHEMA_LEVEL,
    SCHEMA_VALIDATORS,
    SchemaValidationError,
    createSchemaLevel17,
    isMigratableSchemaLevel,
    schemaLadderStep,
    validateSchemaLevel17,
} from '../schema';
import type { SchemaFacts } from '../schema';
import { DATABASE_FILE_NAME, SQLITE_VERSION, activeDirectory, classifySqliteFailure, closeBestEffort, databasePath, hasSchemaObjects, openDatabase, readDatabaseIdentity, throwFailpoint } from './database';
import { SqliteDataStoreImplementation } from './kernel';
import type { SqliteDataStore } from './kernel';
import { databaseUnreadableProblem, incompatibleVersionProblem, integrityProblem, migrationSafetyUnavailableProblem, recoveryResult, unreadableOpenProblem, validationProblem } from './results';
import { requireRestoreCompletionReceiptInput, restoreCompletionReceiptFromRow } from './rows';
import type { RestoreCompletionReceiptRow } from './rows';
import type { DataOpenProblem, InitializeWorkspaceDataOptions, OpenWorkspaceDataOptions, RestoreCompletionReceipt, RestoreDataSlotFacts } from './types';
import { canonicalJson } from '../../shared/canonical-json';
import { isCanonicalUuid } from '../../shared/workspace-data-contract';
export type DataOpenResult =
    | Readonly<{ kind: 'absent'; sqliteVersion: string }>
    | Readonly<{ kind: 'ready'; sqliteVersion: string; store: SqliteDataStore }>
    | Readonly<{ kind: 'read-only'; sqliteVersion: string; store: SqliteDataStore }>
    | Readonly<{ kind: 'recovery'; sqliteVersion: string; problem: DataOpenProblem }>;

/**
 * Reopens and fully validates one closed operation-owned DATA sibling without making it active.
 * @param {string} dataSlotsRoot - Trusted DataSlots parent.
 * @param {string} slotName - Exact direct-child DataSlot name.
 * @return {RestoreDataSlotFacts} Fresh current-schema identity and revision.
 */
export function inspectRestoreDataSlot(
    dataSlotsRoot: string,
    slotName: string,
): RestoreDataSlotFacts {
    if (!isAbsolute(dataSlotsRoot)
        || dataSlotsRoot.includes('\0')
        || slotName.length === 0
        || slotName === '.'
        || slotName === '..'
        || slotName.includes('\0')
        || basename(slotName) !== slotName) {
        throw new TypeError('Restore DataSlot location is invalid');
    }
    const candidate = openDatabase(join(dataSlotsRoot, slotName, DATABASE_FILE_NAME), true);
    try {
        const identity = readDatabaseIdentity(candidate);
        if (identity.applicationId !== COURSEFLOW_APPLICATION_ID
            || identity.schemaLevel !== CURRENT_SCHEMA_LEVEL) {
            throw new Error('Restore DataSlot database identity is invalid');
        }
        const facts = validateSchemaLevel17(candidate);
        return Object.freeze({
            workspaceId: facts.workspaceId,
            schemaLevel: identity.schemaLevel.toString(),
            revision: facts.revision.toString(),
        });
    }
    finally {
        candidate.close();
    }
}

/**
 * Reads and verifies one completion receipt from a closed operation-owned DATA slot.
 * @param {string} dataSlotsRoot - Trusted DataSlots parent.
 * @param {string} slotName - Exact direct-child DataSlot name.
 * @param {string} operationId - Stable Restore operation identity.
 * @return {RestoreCompletionReceipt | null} Verified receipt or null.
 */
export function inspectRestoreCompletionReceipt(
    dataSlotsRoot: string,
    slotName: string,
    operationId: string,
): RestoreCompletionReceipt | null {
    if (!isAbsolute(dataSlotsRoot)
        || dataSlotsRoot.includes('\0')
        || slotName.length === 0
        || slotName === '.'
        || slotName === '..'
        || slotName.includes('\0')
        || basename(slotName) !== slotName
        || !isCanonicalUuid(operationId)) {
        throw new TypeError('Restore receipt location is invalid');
    }
    const database = openDatabase(join(dataSlotsRoot, slotName, DATABASE_FILE_NAME), true);
    try {
        const identity = readDatabaseIdentity(database);
        if (identity.applicationId !== COURSEFLOW_APPLICATION_ID
            || identity.schemaLevel !== CURRENT_SCHEMA_LEVEL) {
            throw new Error('Restore receipt DATA identity is invalid');
        }
        validateSchemaLevel17(database);
        const row = database.prepare(`
            SELECT *
            FROM restore_completion_receipts
            WHERE operation_id = ?
        `).get(operationId) as RestoreCompletionReceiptRow | undefined;
        if (!row) {
            return null;
        }
        const receipt = restoreCompletionReceiptFromRow(row);
        const {receiptDigest, ...input} = receipt;
        requireRestoreCompletionReceiptInput(input);
        const observedDigest = createHash('sha256')
            .update(canonicalJson(input), 'utf8')
            .digest('hex');
        if (observedDigest !== receiptDigest) {
            throw new Error('Restore completion receipt digest is invalid');
        }
        return receipt;
    }
    finally {
        database.close();
    }
}

export function initializeWorkspaceData(
    dataSlotsRoot: string,
    workspaceId: string,
    options: InitializeWorkspaceDataOptions = {},
): SqliteDataStore {
    if (!isCanonicalUuid(workspaceId)) {
        throw new TypeError('WorkspaceId must be a canonical UUID');
    }
    if (existsSync(activeDirectory(dataSlotsRoot))) {
        throw new Error('Workspace data is already initialized');
    }

    const stagingDirectory = join(dataSlotsRoot, `.initialize-${randomUUID()}`);
    const stagingDatabasePath = join(stagingDirectory, DATABASE_FILE_NAME);
    let stagingDatabase: DatabaseSync | undefined;
    let activated = false;

    try {
        mkdirSync(stagingDirectory);
        stagingDatabase = openDatabase(stagingDatabasePath, false);
        stagingDatabase.exec('BEGIN IMMEDIATE');
        stagingDatabase.exec(`PRAGMA application_id = ${COURSEFLOW_APPLICATION_ID}`);
        createSchemaLevel17(stagingDatabase);
        throwFailpoint(options.failpoint, 'initialize.after-schema');
        stagingDatabase.prepare(
            'INSERT INTO workspace_state (singleton, workspace_id, revision) VALUES (1, ?, 0)',
        ).run(workspaceId);
        stagingDatabase.exec(`
            INSERT INTO setup_state (
                singleton,
                last_decision,
                setup_decision_version,
                ever_reached_minimum
            ) VALUES (1, NULL, 0, 0);
            INSERT INTO setup_draft_checkpoint (
                singleton,
                checkpoint_version,
                schema_version,
                updated_at,
                opaque_payload
            ) VALUES (1, 0, NULL, NULL, NULL);
            INSERT INTO protection_watermarks (
                singleton,
                backup_needed_through,
                backup_succeeded_through
            ) VALUES (1, 0, 0);
            INSERT INTO plan_state (
                singleton,
                current_term_id,
                plan_entity_version
            ) VALUES (1, NULL, 0);
            INSERT INTO backup_configuration (
                singleton,
                configuration_version,
                backup_set_id,
                repository_schema,
                canonical_destination_path,
                destination_display_name,
                originating_command_id,
                configured_revision
            ) VALUES (1, 0, NULL, NULL, NULL, NULL, NULL, NULL);
        `);
        throwFailpoint(options.failpoint, 'initialize.after-bootstrap');
        stagingDatabase.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_LEVEL}`);
        throwFailpoint(options.failpoint, 'initialize.after-user-version');
        stagingDatabase.exec('COMMIT');
        stagingDatabase.close();
        stagingDatabase = undefined;

        const validationDatabase = openDatabase(stagingDatabasePath, true);
        try {
            validateSchemaLevel17(validationDatabase);
        } finally {
            validationDatabase.close();
        }
        throwFailpoint(options.failpoint, 'initialize.after-validation');

        renameSync(stagingDirectory, activeDirectory(dataSlotsRoot));
        activated = true;
        const activeDatabase = openDatabase(databasePath(dataSlotsRoot), false);
        const facts = validateSchemaLevel17(activeDatabase);
        return new SqliteDataStoreImplementation(activeDatabase, facts.workspaceId, facts.revision);
    } catch (error) {
        if (stagingDatabase?.isTransaction) {
            stagingDatabase.exec('ROLLBACK');
        }
        stagingDatabase?.close();
        if (!activated) {
            rmSync(stagingDirectory, { recursive: true, force: true });
        }
        throw error;
    }
}

export function openWorkspaceData(
    dataSlotsRoot: string,
    options: OpenWorkspaceDataOptions = {},
): DataOpenResult {
    const active = activeDirectory(dataSlotsRoot);
    let activeStats: ReturnType<typeof lstatSync> | undefined;
    try {
        activeStats = lstatSync(active, { throwIfNoEntry: false });
    } catch {
        return recoveryResult(databaseUnreadableProblem());
    }
    if (!activeStats) {
        return Object.freeze({ kind: 'absent' as const, sqliteVersion: SQLITE_VERSION });
    }
    if (!activeStats.isDirectory()) {
        return recoveryResult(databaseUnreadableProblem());
    }

    const path = databasePath(dataSlotsRoot);
    try {
        const databaseStats = lstatSync(path, { throwIfNoEntry: false });
        if (!databaseStats?.isFile()) {
            return recoveryResult(databaseUnreadableProblem());
        }
    } catch {
        return recoveryResult(databaseUnreadableProblem());
    }

    let validationDatabase: DatabaseSync;
    try {
        validationDatabase = openDatabase(path, true);
    } catch (error) {
        return recoveryResult(unreadableOpenProblem(error));
    }

    let expectedWorkspaceId: string;
    let expectedRevision: bigint;
    try {
        const identity = readDatabaseIdentity(validationDatabase);
        if (identity.schemaLevel === 0) {
            const problem = hasSchemaObjects(validationDatabase)
                ? integrityProblem('nonempty-level-zero')
                : integrityProblem('schema-mismatch');
            closeBestEffort(validationDatabase);
            return recoveryResult(problem);
        }
        if (identity.applicationId !== COURSEFLOW_APPLICATION_ID) {
            closeBestEffort(validationDatabase);
            return recoveryResult(integrityProblem('wrong-application-id'));
        }
        if (identity.schemaLevel > CURRENT_SCHEMA_LEVEL) {
            closeBestEffort(validationDatabase);
            return recoveryResult(incompatibleVersionProblem(identity.schemaLevel));
        }
        if (identity.schemaLevel !== CURRENT_SCHEMA_LEVEL) {
            closeBestEffort(validationDatabase);
            return recoveryResult(integrityProblem('schema-mismatch'));
        }

        const facts = validateSchemaLevel17(validationDatabase);
        expectedWorkspaceId = facts.workspaceId;
        expectedRevision = facts.revision;
    } catch (error) {
        closeBestEffort(validationDatabase);
        return recoveryResult(validationProblem(error));
    }

    if (options.readOnly) {
        return Object.freeze({
            kind: 'read-only' as const,
            sqliteVersion: SQLITE_VERSION,
            store: new SqliteDataStoreImplementation(
                validationDatabase,
                expectedWorkspaceId,
                expectedRevision,
                true,
            ),
        });
    }

    let activeDatabase: DatabaseSync;
    try {
        activeDatabase = openDatabase(path, false);
    } catch (error) {
        const disposition = classifySqliteFailure(error, 'pre-commit');
        if (disposition.kind === 'read-only') {
            return Object.freeze({
                kind: 'read-only' as const,
                sqliteVersion: SQLITE_VERSION,
                store: new SqliteDataStoreImplementation(
                    validationDatabase,
                    expectedWorkspaceId,
                    expectedRevision,
                    true,
                ),
            });
        }
        closeBestEffort(validationDatabase);
        return recoveryResult(unreadableOpenProblem(error));
    }

    try {
        const identity = readDatabaseIdentity(activeDatabase);
        if (identity.applicationId !== COURSEFLOW_APPLICATION_ID
            || identity.schemaLevel !== CURRENT_SCHEMA_LEVEL) {
            closeBestEffort(activeDatabase);
            closeBestEffort(validationDatabase);
            return recoveryResult(integrityProblem('schema-mismatch'));
        }
        const facts = validateSchemaLevel17(activeDatabase);
        if (facts.workspaceId !== expectedWorkspaceId || facts.revision !== expectedRevision) {
            closeBestEffort(activeDatabase);
            closeBestEffort(validationDatabase);
            return recoveryResult(integrityProblem('schema-mismatch'));
        }
        closeBestEffort(validationDatabase);
        return Object.freeze({
            kind: 'ready' as const,
            sqliteVersion: SQLITE_VERSION,
            store: new SqliteDataStoreImplementation(activeDatabase, facts.workspaceId, facts.revision),
        });
    } catch (error) {
        closeBestEffort(activeDatabase);
        closeBestEffort(validationDatabase);
        return recoveryResult(validationProblem(error));
    }
}

export async function openWorkspaceDataWithMigrations(
    dataSlotsRoot: string,
    options: OpenWorkspaceDataOptions = {},
): Promise<DataOpenResult> {
    const opened = openWorkspaceData(dataSlotsRoot, options);
    if (opened.kind !== 'recovery'
        || opened.problem.code !== 'integrity'
        || opened.problem.details.reason !== 'schema-mismatch') {
        return opened;
    }

    const path = databasePath(dataSlotsRoot);
    let source: DatabaseSync | undefined;
    try {
        source = openDatabase(path, true);
        const identity = readDatabaseIdentity(source);
        if (identity.applicationId !== COURSEFLOW_APPLICATION_ID
            || !isMigratableSchemaLevel(identity.schemaLevel)) {
            closeBestEffort(source);
            return opened;
        }
        const sourceFacts: SchemaFacts = SCHEMA_VALIDATORS[identity.schemaLevel](source);
        if (options.readOnly) {
            closeBestEffort(source);
            return recoveryResult(incompatibleVersionProblem(identity.schemaLevel));
        }
        if (!options.migrationSafetyCopy) {
            closeBestEffort(source);
            source = undefined;
            return recoveryResult(migrationSafetyUnavailableProblem());
        }
        await ensureMigrationSafetyCopy({
            dataSlotsRoot,
            sourceDatabase: source,
            workspaceId: sourceFacts.workspaceId,
            sourceRevision: sourceFacts.revision,
            sourceSchemaLevel: identity.schemaLevel,
            targetSchemaLevel: CURRENT_SCHEMA_LEVEL,
            binding: options.migrationSafetyCopy,
            failpoint: options.migrationFailpoint,
        });
        options.migrationFailpoint?.('migration.after-safety-copy');
        source.close();
        source = undefined;

        const maintenance = openDatabase(path, false);
        try {
            maintenance.exec('PRAGMA foreign_keys = OFF');
            const foreignKeys = maintenance.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
            if (foreignKeys.foreign_keys !== 0) {
                throw new Error('Migration could not disable foreign keys');
            }

            let schemaLevel = identity.schemaLevel;
            while (schemaLevel < CURRENT_SCHEMA_LEVEL) {
                maintenance.exec('BEGIN IMMEDIATE');
                try {
                    if (!isMigratableSchemaLevel(schemaLevel)) {
                        throw new SchemaValidationError('database-corrupt');
                    }
                    const step = schemaLadderStep(schemaLevel);
                    step.validateSource(maintenance);
                    step.migrate(maintenance);
                    step.validateTarget(maintenance);
                    if ((maintenance.prepare('PRAGMA foreign_key_check').all() as unknown[]).length !== 0) {
                        throw new SchemaValidationError('database-corrupt');
                    }
                    options.migrationFailpoint?.('migration.before-level-commit');
                    maintenance.exec('COMMIT');
                    schemaLevel += 1;
                }
                catch (error) {
                    if (maintenance.isTransaction) {
                        maintenance.exec('ROLLBACK');
                    }
                    throw error;
                }
            }

            maintenance.exec('PRAGMA foreign_keys = ON');
            const enabledForeignKeys = maintenance.prepare('PRAGMA foreign_keys').get() as {
                foreign_keys: number;
            };
            if (enabledForeignKeys.foreign_keys !== 1) {
                throw new Error('Migration could not restore foreign keys');
            }
            validateSchemaLevel17(maintenance);
        }
        finally {
            closeBestEffort(maintenance);
        }
    }

    catch (error) {
        closeBestEffort(source);
        return recoveryResult(validationProblem(error));
    }

    return openWorkspaceData(dataSlotsRoot);
}
