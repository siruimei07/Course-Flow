import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { DatabaseSyncOptions } from 'node:sqlite';
import { validateSchemaLevel13, validateSchemaLevel14, validateSchemaLevel15, validateSchemaLevel16, validateSchemaLevel17 } from '../schema';
import { freezePair } from './results';
import type { CommitFailpoint, CommitOptions, InitializeFailpoint, RestoreDatabaseFacts } from './types';

export const ACTIVE_DIRECTORY_NAME = 'active';

export const DATABASE_FILE_NAME = 'workspace.sqlite';

export const DATABASE_OPTIONS: DatabaseSyncOptions = {
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
    allowUnknownNamedParameters: false,
    defensive: true,
    timeout: 5_000,
};

export const runtimeSqliteVersion = process.versions.sqlite;
if (typeof runtimeSqliteVersion !== 'string') {
    throw new Error('SQLite runtime version is unavailable');
}

export const SQLITE_VERSION = runtimeSqliteVersion;

/**
 * Returns the SQLite runtime version without opening an activity DATA slot.
 * @return {string} Bundled SQLite runtime version.
 */
export function workspaceDataRuntimeVersion(): string {
    return SQLITE_VERSION;
}

export function activeDirectory(dataSlotsRoot: string): string {
    return join(dataSlotsRoot, ACTIVE_DIRECTORY_NAME);
}

export function databasePath(dataSlotsRoot: string): string {
    return join(activeDirectory(dataSlotsRoot), DATABASE_FILE_NAME);
}

export function configureDatabase(database: DatabaseSync): void {
    const journalMode = database.prepare('PRAGMA journal_mode = WAL').get() as { journal_mode: unknown };
    database.exec('PRAGMA synchronous = FULL');
    database.exec('PRAGMA foreign_keys = ON');
    database.exec('PRAGMA trusted_schema = OFF');

    const synchronous = database.prepare('PRAGMA synchronous').get() as { synchronous: unknown };
    const foreignKeys = database.prepare('PRAGMA foreign_keys').get() as { foreign_keys: unknown };
    const trustedSchema = database.prepare('PRAGMA trusted_schema').get() as { trusted_schema: unknown };
    if (journalMode.journal_mode !== 'wal'
        || synchronous.synchronous !== 2
        || foreignKeys.foreign_keys !== 1
        || trustedSchema.trusted_schema !== 0) {
        throw new Error('Workspace database configuration failed');
    }
}

export function configureReadOnlyDatabase(database: DatabaseSync): void {
    database.exec('PRAGMA foreign_keys = ON');
    database.exec('PRAGMA trusted_schema = OFF');
    database.exec('PRAGMA query_only = ON');

    const foreignKeys = database.prepare('PRAGMA foreign_keys').get() as { foreign_keys: unknown };
    const trustedSchema = database.prepare('PRAGMA trusted_schema').get() as { trusted_schema: unknown };
    const queryOnly = database.prepare('PRAGMA query_only').get() as { query_only: unknown };
    if (foreignKeys.foreign_keys !== 1
        || trustedSchema.trusted_schema !== 0
        || queryOnly.query_only !== 1) {
        throw new Error('Workspace read-only database configuration failed');
    }
}

export function openDatabase(path: string, readOnly: boolean): DatabaseSync {
    const database = new DatabaseSync(path, { ...DATABASE_OPTIONS, readOnly });
    try {
        if (readOnly) {
            configureReadOnlyDatabase(database);
        } else {
            configureDatabase(database);
        }
        return database;
    } catch (error) {
        database.close();
        throw error;
    }
}

export function throwFailpoint(failpoint: InitializeFailpoint | undefined, expected: InitializeFailpoint): void {
    if (failpoint === expected) {
        throw new Error(expected);
    }
}

export function fireCommitFailpoint(options: CommitOptions, point: CommitFailpoint): void {
    options.failpoint?.(point);
}

/**
 * Closes a copied database into standalone DELETE-journal form for one snapshot member.
 * @param {string} path - Exact operation-owned database copy path.
 * @return {void}
 */
export function normalizeBackupDatabaseCopy(path: string): void {
    const database = new DatabaseSync(path, DATABASE_OPTIONS);
    try {
        database.exec('PRAGMA foreign_keys = ON');
        database.exec('PRAGMA trusted_schema = OFF');
        const journalMode = database.prepare('PRAGMA journal_mode = DELETE').get() as {
            journal_mode: unknown;
        };
        database.exec('PRAGMA synchronous = FULL');
        if (journalMode.journal_mode !== 'delete') {
            throw new Error('Backup database could not become a standalone member');
        }
    }
    finally {
        database.close();
    }
}

/**
 * Validates a supported restore candidate schema without changing its bytes.
 * @param {DatabaseSync} database - Read-only candidate database.
 * @param {number} schemaLevel - Fresh application schema level.
 * @return {SchemaFacts | null} Validated identity or null for an unsupported level.
 */
export function validateSupportedRestoreSchema(
    database: DatabaseSync,
    schemaLevel: number,
): Readonly<{workspaceId: string; revision: bigint}> | null {
    if (schemaLevel === 13) {
        return validateSchemaLevel13(database);
    }
    if (schemaLevel === 14) {
        return validateSchemaLevel14(database);
    }
    if (schemaLevel === 15) {
        return validateSchemaLevel15(database);
    }
    if (schemaLevel === 16) {
        return validateSchemaLevel16(database);
    }
    if (schemaLevel === 17) {
        return validateSchemaLevel17(database);
    }
    return null;
}

/**
 * Reads the bounded whole-replacement counts from one already validated database.
 * @param {DatabaseSync} database - Validated candidate or safety database.
 * @return {object} Exact DATA impact counts.
 */
export function readRestoreImpactCounts(database: DatabaseSync): Readonly<{
    termCount: string;
    courseCount: string;
    taskSeriesCount: string;
}> {
    const statement = database.prepare(`
        SELECT
            (SELECT count(*) FROM terms) AS term_count,
            (SELECT count(*) FROM courses) AS course_count,
            (SELECT count(*) FROM task_series) AS task_series_count
    `);
    statement.setReadBigInts(true);
    const row = statement.get() as {
        term_count: bigint;
        course_count: bigint;
        task_series_count: bigint;
    };
    return Object.freeze({
        termCount: row.term_count.toString(),
        courseCount: row.course_count.toString(),
        taskSeriesCount: row.task_series_count.toString(),
    });
}

/**
 * Reads the one queued source operation frozen into an ADR-07 snapshot database.
 * @param {DatabaseSync} database - Validated candidate database.
 * @return {object} Manifest-binding source snapshot facts.
 */
export function readRestoreSourceBackup(database: DatabaseSync): RestoreDatabaseFacts['sourceBackup'] {
    const statement = database.prepare(`
        SELECT backup_set_id, backup_sequence, snapshot_id, target_revision, phase
        FROM backup_operations
        WHERE phase <> 'succeeded'
    `);
    statement.setReadBigInts(true);
    const rows = statement.all() as Array<{
        backup_set_id: string;
        backup_sequence: bigint;
        snapshot_id: string;
        target_revision: bigint;
        phase: string;
    }>;
    if (rows.length !== 1 || rows[0]!.phase !== 'queued') {
        throw new Error('Restore candidate lacks its queued source backup operation');
    }
    const row = rows[0]!;
    return Object.freeze({
        backupSetId: row.backup_set_id,
        backupSequence: row.backup_sequence.toString(),
        snapshotId: row.snapshot_id,
        targetRevision: row.target_revision.toString(),
    });
}

export function decimalFromCoefficient(coefficient: bigint, scale: bigint): string {
    if (scale === 0n) {
        return coefficient.toString();
    }
    const scaleNumber = Number(scale);
    const digits = coefficient.toString().padStart(scaleNumber + 1, '0');
    return `${digits.slice(0, -scaleNumber)}.${digits.slice(-scaleNumber)}`;
}

export function decimalToCoefficient(value: string | null): readonly [bigint | null, bigint | null] {
    if (value === null) {
        return freezePair([null, null]);
    }
    const [integer, fraction = ''] = value.split('.');
    return freezePair([BigInt(integer + fraction), BigInt(fraction.length)]);
}

export type SqliteOperationStage = 'pre-commit' | 'commit-outcome-unknown';

export type SqliteFailureDisposition =
    | Readonly<{ kind: 'retryable-unchanged'; reason: 'writer-busy' }>
    | Readonly<{ kind: 'read-only'; reason: 'permission' }>
    | Readonly<{ kind: 'failed-unchanged'; reason: 'storage-full' | 'recovery-required' }>
    | Readonly<{ kind: 'reopen-required' }>
    | Readonly<{ kind: 'unmapped' }>;

export function classifySqliteFailure(
    error: unknown,
    stage: SqliteOperationStage,
): SqliteFailureDisposition {
    let primaryCode: number | undefined;
    let systemCode: unknown;
    if (typeof error === 'object' && error !== null) {
        if ('errcode' in error && typeof error.errcode === 'number') {
            primaryCode = error.errcode & 0xFF;
        }
        if ('code' in error) {
            systemCode = error.code;
        }
    }

    if (stage === 'commit-outcome-unknown' && (primaryCode === 10 || primaryCode === 13)) {
        return Object.freeze({ kind: 'reopen-required' as const });
    }
    if (primaryCode === 5 || primaryCode === 6) {
        return Object.freeze({ kind: 'retryable-unchanged' as const, reason: 'writer-busy' as const });
    }
    if (primaryCode === 8 || systemCode === 'EACCES' || systemCode === 'EPERM') {
        return Object.freeze({ kind: 'read-only' as const, reason: 'permission' as const });
    }
    if (primaryCode === 13) {
        return Object.freeze({ kind: 'failed-unchanged' as const, reason: 'storage-full' as const });
    }
    if (primaryCode === 10) {
        return Object.freeze({ kind: 'failed-unchanged' as const, reason: 'recovery-required' as const });
    }
    return Object.freeze({ kind: 'unmapped' as const });
}

export function closeBestEffort(database: DatabaseSync | undefined): void {
    try {
        database?.close();
    } catch {
        // The stable open classification does not depend on a second close failure.
    }
}

export function primarySqliteCode(error: unknown): number | undefined {
    if (typeof error !== 'object'
        || error === null
        || !('errcode' in error)
        || typeof error.errcode !== 'number') {
        return undefined;
    }
    return error.errcode & 0xFF;
}

export function readDatabaseIdentity(database: DatabaseSync): Readonly<{
    applicationId: number;
    schemaLevel: number;
}> {
    const applicationId = database.prepare('PRAGMA application_id').get() as { application_id: number };
    const userVersion = database.prepare('PRAGMA user_version').get() as { user_version: number };
    return {
        applicationId: applicationId.application_id,
        schemaLevel: userVersion.user_version,
    };
}

export function hasSchemaObjects(database: DatabaseSync): boolean {
    const row = database.prepare(`
        SELECT count(*) AS count
        FROM sqlite_schema
        WHERE name NOT LIKE 'sqlite_%'
    `).get() as { count: number };
    return row.count !== 0;
}
