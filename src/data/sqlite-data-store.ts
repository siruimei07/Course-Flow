import { existsSync, lstatSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync, type DatabaseSyncOptions } from 'node:sqlite';

import {
    isCanonicalUuid,
    normalizeRecordSetupDecisionCommand,
    type RecordSetupDecisionCommand,
} from '../shared/workspace-data-contract';
import { digestRecordSetupDecision } from './command-digest';
import {
    COURSEFLOW_APPLICATION_ID,
    CURRENT_SCHEMA_LEVEL,
    migrateLevel0To1,
    SchemaValidationError,
    validateSchemaLevel1,
} from './schema';

const ACTIVE_DIRECTORY_NAME = 'active';
const DATABASE_FILE_NAME = 'workspace.sqlite';
const DATABASE_OPTIONS: DatabaseSyncOptions = {
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
    allowUnknownNamedParameters: false,
    defensive: true,
    timeout: 5_000,
};

export type InitializeFailpoint =
    | 'initialize.after-schema'
    | 'initialize.after-bootstrap'
    | 'initialize.after-user-version'
    | 'initialize.after-validation';

export type InitializeWorkspaceDataOptions = Readonly<{
    failpoint?: InitializeFailpoint;
}>;

export type OpenWorkspaceDataOptions = Readonly<{
    readOnly?: boolean;
}>;

export type DataOpenProblem =
    | Readonly<{
        code: 'permission';
        scope: 'workspace';
        dataEffect: 'unchanged';
        affectedCapabilities: readonly ['workspace.write'];
        allowedActions: readonly [];
        context: Readonly<Record<never, never>>;
        details: Readonly<{ reason: 'read-only' }>;
    }>
    | Readonly<{
        code: 'incompatible-version';
        scope: 'workspace';
        dataEffect: 'unchanged';
        affectedCapabilities: readonly ['workspace.read', 'workspace.write'];
        allowedActions: readonly [];
        context: Readonly<Record<never, never>>;
        details: Readonly<{ actualSchemaLevel: number; requiredSchemaLevel: 1 }>;
    }>
    | Readonly<{
        code: 'integrity';
        scope: 'workspace';
        dataEffect: 'unchanged';
        affectedCapabilities: readonly ['workspace.read', 'workspace.write'];
        allowedActions: readonly [];
        context: Readonly<Record<never, never>>;
        details: Readonly<{
            reason: 'wrong-application-id' | 'nonempty-level-zero' | 'schema-mismatch' | 'database-corrupt';
        }>;
    }>
    | Readonly<{
        code: 'recovery-required';
        scope: 'workspace';
        dataEffect: 'unchanged';
        affectedCapabilities: readonly ['workspace.read', 'workspace.write'];
        allowedActions: readonly [];
        context: Readonly<Record<never, never>>;
        details: Readonly<{ reason: 'database-unreadable' }>;
    }>;

export type DataOpenResult =
    | Readonly<{ kind: 'absent'; sqliteVersion: string }>
    | Readonly<{ kind: 'ready'; sqliteVersion: string; store: SqliteDataStore }>
    | Readonly<{ kind: 'read-only'; sqliteVersion: string; store: SqliteDataStore }>
    | Readonly<{ kind: 'recovery'; sqliteVersion: string; problem: DataOpenProblem }>;

export type WorkspaceDataStatus =
    | Readonly<{
        kind: 'ready';
        workspaceId: string;
        schemaLevel: 1;
        revision: string;
    }>
    | Readonly<{
        kind: 'read-only';
        workspaceId: string;
        schemaLevel: 1;
        revision: string;
        problem: DataOpenProblem;
    }>;

export type WorkspaceSetupSnapshot = Readonly<{
    revision: string;
    setup: Readonly<{
        workspaceId: string;
        lastDecision: 'later' | 'skip' | null;
        entityVersion: string;
    }>;
}>;

export type ReadSnapshotOptions = Readonly<{
    failpoint?: (point: 'read.after-revision') => void;
}>;

export type CommitFailpoint =
    | 'commit.after-begin'
    | 'commit.after-receipt-read'
    | 'commit.after-expected-versions'
    | 'commit.after-facts'
    | 'commit.after-revision'
    | 'commit.after-receipt'
    | 'commit.after-followup'
    | 'commit.after-watermark'
    | 'commit.before-sqlite-commit'
    | 'commit.after-sqlite-commit';

export type CommitOptions = Readonly<{
    failpoint?: (point: CommitFailpoint) => void;
}>;

export type CommandReceiptOutcome = Readonly<{
    kind: 'committed';
    revision: string;
    effects: readonly [Readonly<{
        code: 'workspace.setup-decision-recorded';
        entity: Readonly<{
            kind: 'workspace-setup';
            id: string;
            version: string;
        }>;
    }>];
    pendingFollowUps: readonly [string];
}>;

export type DurableFollowUp = Readonly<{
    followUpId: string;
    originatingCommandId: string;
    owner: 'protect';
    kind: 'backup-needed-through';
    prerequisiteRevision: string;
    state: 'pending';
    version: '0';
}>;

type ConflictReason = 'command-id-reused' | 'expected-revision' | 'expected-entity-version';

type ConflictProblem = Readonly<{
    code: 'conflict';
    scope: 'operation';
    dataEffect: 'unchanged';
    affectedCapabilities: readonly ['workspace.write'];
    allowedActions: readonly ['requery'];
    context: Readonly<{
        revision: string;
        entityVersions: readonly [Readonly<{
            kind: 'workspace-setup';
            id: string;
            version: string;
        }>];
    }>;
    details: Readonly<{ reason: ConflictReason }>;
}>;

type WriterBusyProblem = Readonly<{
    code: 'operation-in-progress';
    scope: 'operation';
    dataEffect: 'unchanged';
    affectedCapabilities: readonly ['workspace.write'];
    allowedActions: readonly ['retry'];
    context: Readonly<{ revision: string }>;
    details: Readonly<{ reason: 'writer-busy' }>;
}>;

type PermissionCommitProblem = Readonly<{
    code: 'permission';
    scope: 'workspace';
    dataEffect: 'unchanged';
    affectedCapabilities: readonly ['workspace.write'];
    allowedActions: readonly [];
    context: Readonly<{ revision: string }>;
    details: Readonly<{ reason: 'read-only' }>;
}>;

export type DataCommitResult =
    | Readonly<{ ok: true; value: CommandReceiptOutcome }>
    | Readonly<{ ok: false; problem: ConflictProblem | WriterBusyProblem | PermissionCommitProblem }>;

type CommitWork = {
    command: RecordSetupDecisionCommand;
    options: CommitOptions;
    resolve: (result: DataCommitResult) => void;
    reject: (error: unknown) => void;
};

type CurrentVersions = Readonly<{
    revision: bigint;
    setupVersion: bigint;
}>;

const COMMIT_QUEUE_CAPACITY = 64;
const SQLITE_INTEGER_MAX = 9223372036854775807n;
const runtimeSqliteVersion = process.versions.sqlite;
if (typeof runtimeSqliteVersion !== 'string') {
    throw new Error('SQLite runtime version is unavailable');
}
const SQLITE_VERSION = runtimeSqliteVersion;

function activeDirectory(dataSlotsRoot: string): string {
    return join(dataSlotsRoot, ACTIVE_DIRECTORY_NAME);
}

function databasePath(dataSlotsRoot: string): string {
    return join(activeDirectory(dataSlotsRoot), DATABASE_FILE_NAME);
}

function configureDatabase(database: DatabaseSync): void {
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

function configureReadOnlyDatabase(database: DatabaseSync): void {
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

function openDatabase(path: string, readOnly: boolean): DatabaseSync {
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

function throwFailpoint(failpoint: InitializeFailpoint | undefined, expected: InitializeFailpoint): void {
    if (failpoint === expected) {
        throw new Error(expected);
    }
}

function fireCommitFailpoint(options: CommitOptions, point: CommitFailpoint): void {
    options.failpoint?.(point);
}

function freezeTuple<T>(value: [T]): readonly [T] {
    return Object.freeze(value);
}

function freezeEmptyTuple(): readonly [] {
    return Object.freeze([]);
}

function freezePair<T, U>(value: [T, U]): readonly [T, U] {
    return Object.freeze(value);
}

function committedOutcome(
    revision: bigint,
    workspaceId: string,
    setupVersion: bigint,
    followUpId: string,
): CommandReceiptOutcome {
    const entity = Object.freeze({
        kind: 'workspace-setup' as const,
        id: workspaceId,
        version: setupVersion.toString(),
    });
    const effect = Object.freeze({
        code: 'workspace.setup-decision-recorded' as const,
        entity,
    });
    return Object.freeze({
        kind: 'committed' as const,
        revision: revision.toString(),
        effects: freezeTuple([effect]),
        pendingFollowUps: freezeTuple([followUpId]),
    });
}

function successfulCommit(value: CommandReceiptOutcome): DataCommitResult {
    return Object.freeze({ ok: true as const, value });
}

function conflictResult(
    reason: ConflictReason,
    workspaceId: string,
    versions: CurrentVersions,
): DataCommitResult {
    const entityVersion = Object.freeze({
        kind: 'workspace-setup' as const,
        id: workspaceId,
        version: versions.setupVersion.toString(),
    });
    const context = Object.freeze({
        revision: versions.revision.toString(),
        entityVersions: freezeTuple([entityVersion]),
    });
    const problem = Object.freeze({
        code: 'conflict' as const,
        scope: 'operation' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezeTuple(['workspace.write' as const]),
        allowedActions: freezeTuple(['requery' as const]),
        context,
        details: Object.freeze({ reason }),
    });
    return Object.freeze({ ok: false as const, problem });
}

function writerBusyResult(revision: bigint): DataCommitResult {
    const problem = Object.freeze({
        code: 'operation-in-progress' as const,
        scope: 'operation' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezeTuple(['workspace.write' as const]),
        allowedActions: freezeTuple(['retry' as const]),
        context: Object.freeze({ revision: revision.toString() }),
        details: Object.freeze({ reason: 'writer-busy' as const }),
    });
    return Object.freeze({ ok: false as const, problem });
}

function permissionProblem(): DataOpenProblem {
    return Object.freeze({
        code: 'permission' as const,
        scope: 'workspace' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezeTuple(['workspace.write' as const]),
        allowedActions: freezeEmptyTuple(),
        context: Object.freeze({}),
        details: Object.freeze({ reason: 'read-only' as const }),
    });
}

function permissionCommitResult(revision: bigint): DataCommitResult {
    const problem = Object.freeze({
        code: 'permission' as const,
        scope: 'workspace' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezeTuple(['workspace.write' as const]),
        allowedActions: freezeEmptyTuple(),
        context: Object.freeze({ revision: revision.toString() }),
        details: Object.freeze({ reason: 'read-only' as const }),
    });
    return Object.freeze({ ok: false as const, problem });
}

type SqliteOperationStage = 'pre-commit' | 'commit-outcome-unknown';

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

class SqliteDataStoreImplementation {
    private accepting = true;
    private closed = false;
    private closePromise: Promise<void> | undefined;
    private finishClose: (() => void) | undefined;
    private failClose: ((error: unknown) => void) | undefined;
    private readonly queue: CommitWork[] = [];
    private revision: bigint;
    private running = false;
    private terminalError: Error | undefined;

    public constructor(
        private readonly database: DatabaseSync,
        private readonly workspaceId: string,
        revision: bigint,
        private readOnly = false,
    ) {
        this.revision = revision;
    }

    public status(): WorkspaceDataStatus {
        this.requireOpen();
        if (this.readOnly) {
            return Object.freeze({
                kind: 'read-only' as const,
                workspaceId: this.workspaceId,
                schemaLevel: CURRENT_SCHEMA_LEVEL,
                revision: this.revision.toString(),
                problem: permissionProblem(),
            });
        }
        return {
            kind: 'ready',
            workspaceId: this.workspaceId,
            schemaLevel: CURRENT_SCHEMA_LEVEL,
            revision: this.revision.toString(),
        };
    }

    public readWorkspaceSetupSnapshot(
        options: ReadSnapshotOptions = {},
    ): WorkspaceSetupSnapshot {
        this.requireOpen();
        try {
            this.database.exec('BEGIN');
            const revisionStatement = this.database.prepare(
                'SELECT revision FROM workspace_state WHERE singleton = 1',
            );
            revisionStatement.setReadBigInts(true);
            const revision = (revisionStatement.get() as { revision: bigint }).revision;
            options.failpoint?.('read.after-revision');

            const setupStatement = this.database.prepare(`
                SELECT workspace_state.workspace_id, setup_state.last_decision, setup_state.setup_decision_version
                FROM workspace_state
                JOIN setup_state ON setup_state.singleton = workspace_state.singleton
                WHERE workspace_state.singleton = 1
            `);
            setupStatement.setReadBigInts(true);
            const setup = setupStatement.get() as {
                workspace_id: string;
                last_decision: 'later' | 'skip' | null;
                setup_decision_version: bigint;
            };
            this.database.exec('COMMIT');

            return Object.freeze({
                revision: revision.toString(),
                setup: Object.freeze({
                    workspaceId: setup.workspace_id,
                    lastDecision: setup.last_decision,
                    entityVersion: setup.setup_decision_version.toString(),
                }),
            });
        } catch (error) {
            this.rollbackOrRequireReopen();
            throw error;
        }
    }

    public commit(
        candidate: RecordSetupDecisionCommand,
        options: CommitOptions = {},
    ): Promise<DataCommitResult> {
        if (this.terminalError) {
            return Promise.reject(this.terminalError);
        }
        if (this.readOnly) {
            try {
                this.requireOpen();
                return Promise.resolve(permissionCommitResult(this.revision));
            } catch (error) {
                return Promise.reject(error);
            }
        }
        const command = normalizeRecordSetupDecisionCommand(candidate);
        if (!this.accepting) {
            return Promise.reject(new Error('Workspace data store is closing'));
        }
        if (this.queue.length >= COMMIT_QUEUE_CAPACITY) {
            return Promise.resolve(writerBusyResult(this.revision));
        }

        const pending = new Promise<DataCommitResult>((resolve, reject) => {
            this.queue.push({ command, options, resolve, reject });
        });
        if (!this.running) {
            this.running = true;
            queueMicrotask(() => this.drain());
        }
        return pending;
    }

    public receipt(commandId: string): CommandReceiptOutcome | null {
        this.requireOpen();
        return this.readReceiptOutcome(commandId);
    }

    public readPendingFollowUps(): readonly DurableFollowUp[] {
        this.requireOpen();
        const statement = this.database.prepare(`
            SELECT
                follow_up_id,
                originating_command_id,
                prerequisite_revision,
                follow_up_version
            FROM durable_followups
            WHERE state = 'pending'
            ORDER BY prerequisite_revision, follow_up_id
        `);
        statement.setReadBigInts(true);
        const rows = statement.all() as Array<{
            follow_up_id: string;
            originating_command_id: string;
            prerequisite_revision: bigint;
            follow_up_version: bigint;
        }>;
        return Object.freeze(rows.map(row => Object.freeze({
            followUpId: row.follow_up_id,
            originatingCommandId: row.originating_command_id,
            owner: 'protect' as const,
            kind: 'backup-needed-through' as const,
            prerequisiteRevision: row.prerequisite_revision.toString(),
            state: 'pending' as const,
            version: row.follow_up_version.toString() as '0',
        })));
    }

    public readProtectionWatermark(): string {
        this.requireOpen();
        const statement = this.database.prepare(
            'SELECT backup_needed_through FROM protection_watermarks WHERE singleton = 1',
        );
        statement.setReadBigInts(true);
        const row = statement.get() as { backup_needed_through: bigint };
        return row.backup_needed_through.toString();
    }

    public close(): Promise<void> {
        if (this.terminalError) {
            return Promise.resolve();
        }
        if (this.closePromise) {
            return this.closePromise;
        }

        this.accepting = false;
        this.closePromise = new Promise<void>((resolve, reject) => {
            this.finishClose = resolve;
            this.failClose = reject;
        });
        if (!this.running && this.queue.length === 0) {
            this.closeDatabase();
        }
        return this.closePromise;
    }

    private rollbackOrRequireReopen(): void {
        try {
            if (!this.database.isTransaction) {
                return;
            }
            this.database.exec('ROLLBACK');
            if (!this.database.isTransaction) {
                return;
            }
        } catch {
            // Any unproven transaction state follows the same terminal path below.
        }
        throw this.enterTerminalState();
    }

    private currentVersions(): CurrentVersions {
        const statement = this.database.prepare(`
            SELECT
                workspace_state.revision,
                setup_state.setup_decision_version
            FROM workspace_state
            JOIN setup_state ON setup_state.singleton = workspace_state.singleton
            WHERE workspace_state.singleton = 1
        `);
        statement.setReadBigInts(true);
        const row = statement.get() as {
            revision: bigint;
            setup_decision_version: bigint;
        };
        return {
            revision: row.revision,
            setupVersion: row.setup_decision_version,
        };
    }

    private readReceiptOutcome(commandId: string): CommandReceiptOutcome | null {
        const receipt = this.database.prepare(`
            SELECT committed_revision
            FROM command_receipts
            WHERE command_id = ?
        `);
        receipt.setReadBigInts(true);
        const receiptRow = receipt.get(commandId) as { committed_revision: bigint } | undefined;
        if (!receiptRow) {
            return null;
        }

        const effect = this.database.prepare(`
            SELECT entity_id, entity_version
            FROM receipt_effects
            WHERE command_id = ? AND effect_order = 0
        `);
        effect.setReadBigInts(true);
        const effectRow = effect.get(commandId) as {
            entity_id: string;
            entity_version: bigint;
        };
        const followUp = this.database.prepare(`
            SELECT follow_up_id
            FROM durable_followups
            WHERE originating_command_id = ?
            ORDER BY follow_up_id
        `).get(commandId) as { follow_up_id: string };
        return committedOutcome(
            receiptRow.committed_revision,
            effectRow.entity_id,
            effectRow.entity_version,
            followUp.follow_up_id,
        );
    }

    private commitSynchronously(
        command: RecordSetupDecisionCommand,
        options: CommitOptions,
    ): DataCommitResult {
        const digest = digestRecordSetupDecision(command);
        let commitAttempted = false;

        try {
            this.database.exec('BEGIN IMMEDIATE');
            fireCommitFailpoint(options, 'commit.after-begin');

            const receipt = this.database.prepare(`
                SELECT payload_digest
                FROM command_receipts
                WHERE command_id = ?
            `).get(command.commandId) as { payload_digest: Uint8Array } | undefined;
            fireCommitFailpoint(options, 'commit.after-receipt-read');
            if (receipt) {
                const versions = this.currentVersions();
                if (!timingSafeEqual(receipt.payload_digest, digest)) {
                    this.rollbackOrRequireReopen();
                    return conflictResult('command-id-reused', this.workspaceId, versions);
                }

                const outcome = this.readReceiptOutcome(command.commandId);
                this.rollbackOrRequireReopen();
                if (!outcome) {
                    throw new Error('Stored receipt outcome is incomplete');
                }
                return successfulCommit(outcome);
            }

            const versions = this.currentVersions();
            if (command.workspaceId !== this.workspaceId) {
                this.rollbackOrRequireReopen();
                return conflictResult('expected-entity-version', this.workspaceId, versions);
            }
            const expectedRevision = BigInt(command.expectedRevision);
            const expectedSetupVersion = BigInt(command.expectedSetupVersion);
            if (versions.revision !== expectedRevision) {
                this.rollbackOrRequireReopen();
                return conflictResult('expected-revision', this.workspaceId, versions);
            }
            if (versions.setupVersion !== expectedSetupVersion) {
                this.rollbackOrRequireReopen();
                return conflictResult('expected-entity-version', this.workspaceId, versions);
            }
            fireCommitFailpoint(options, 'commit.after-expected-versions');

            if (versions.revision === SQLITE_INTEGER_MAX || versions.setupVersion === SQLITE_INTEGER_MAX) {
                this.rollbackOrRequireReopen();
                throw this.enterTerminalState();
            }

            const newRevision = versions.revision + 1n;
            const newSetupVersion = versions.setupVersion + 1n;
            this.database.prepare(`
                UPDATE setup_state
                SET last_decision = ?, setup_decision_version = ?
                WHERE singleton = 1
            `).run(command.intent.payload.decision, newSetupVersion);
            fireCommitFailpoint(options, 'commit.after-facts');

            this.database.prepare(
                'UPDATE workspace_state SET revision = ? WHERE singleton = 1',
            ).run(newRevision);
            fireCommitFailpoint(options, 'commit.after-revision');

            this.database.prepare(`
                INSERT INTO command_receipts (
                    command_id,
                    intent_kind,
                    intent_schema_version,
                    canonical_encoding,
                    digest_algorithm,
                    payload_digest,
                    committed_revision,
                    result_kind
                ) VALUES (
                    ?, 'workspace.record-setup-decision', 1,
                    'courseflow-canonical-json-v1', 'sha256', ?, ?, 'committed'
                )
            `).run(command.commandId, digest, newRevision);
            fireCommitFailpoint(options, 'commit.after-receipt');

            this.database.prepare(`
                INSERT INTO receipt_effects (
                    command_id,
                    effect_order,
                    effect_code,
                    entity_kind,
                    entity_id,
                    entity_version
                ) VALUES (?, 0, 'workspace.setup-decision-recorded', 'workspace-setup', ?, ?)
            `).run(command.commandId, this.workspaceId, newSetupVersion);
            this.database.prepare(`
                INSERT INTO durable_followups (
                    follow_up_id,
                    originating_command_id,
                    owner,
                    kind,
                    prerequisite_revision,
                    state,
                    follow_up_version
                ) VALUES (?, ?, 'protect', 'backup-needed-through', ?, 'pending', 0)
            `).run(command.followUpId, command.commandId, newRevision);
            fireCommitFailpoint(options, 'commit.after-followup');

            this.database.prepare(`
                UPDATE protection_watermarks
                SET backup_needed_through = ?
                WHERE singleton = 1
            `).run(newRevision);
            fireCommitFailpoint(options, 'commit.after-watermark');
            fireCommitFailpoint(options, 'commit.before-sqlite-commit');

            commitAttempted = true;
            this.database.exec('COMMIT');
            this.revision = newRevision;
            fireCommitFailpoint(options, 'commit.after-sqlite-commit');
            const outcome = this.readReceiptOutcome(command.commandId);
            if (!outcome) {
                throw new Error('Committed receipt outcome is missing');
            }
            return successfulCommit(outcome);
        } catch (error) {
            if (this.terminalError) {
                throw this.terminalError;
            }
            if (commitAttempted) {
                throw this.enterTerminalState();
            }
            this.rollbackOrRequireReopen();
            const disposition = classifySqliteFailure(error, 'pre-commit');
            if (disposition.kind === 'retryable-unchanged') {
                return writerBusyResult(this.revision);
            }
            if (disposition.kind === 'read-only') {
                this.readOnly = true;
                return permissionCommitResult(this.revision);
            }
            if (disposition.kind === 'failed-unchanged') {
                const message = disposition.reason === 'storage-full'
                    ? 'Workspace data write failed: storage full'
                    : 'Workspace data recovery is required';
                throw new Error(message);
            }
            throw new Error('Workspace data commit failed');
        }
    }

    private drain(): void {
        let work = this.queue.shift();
        while (work) {
            try {
                work.resolve(this.commitSynchronously(work.command, work.options));
            } catch (error) {
                work.reject(error);
                if (this.terminalError) {
                    break;
                }
            }
            work = this.queue.shift();
        }

        this.running = false;
        if (!this.accepting && !this.terminalError) {
            this.closeDatabase();
        }
    }

    private enterTerminalState(): Error {
        if (this.terminalError) {
            return this.terminalError;
        }

        this.terminalError = new Error('Workspace data store requires reopen');
        this.accepting = false;
        let work = this.queue.shift();
        while (work) {
            work.reject(this.terminalError);
            work = this.queue.shift();
        }
        try {
            this.database.close();
        } catch {
            // Reopen is required regardless of whether best-effort close succeeds.
        }
        this.closed = true;
        this.finishClose?.();
        this.finishClose = undefined;
        this.failClose = undefined;
        return this.terminalError;
    }

    private closeDatabase(): void {
        try {
            this.database.close();
            this.closed = true;
            this.finishClose?.();
        } catch (error) {
            this.failClose?.(error);
        } finally {
            this.finishClose = undefined;
            this.failClose = undefined;
        }
    }

    private requireOpen(): void {
        if (this.terminalError) {
            throw this.terminalError;
        }
        if (this.closed) {
            throw new Error('Workspace data store is closed');
        }
    }
}

export type SqliteDataStore = InstanceType<typeof SqliteDataStoreImplementation>;

function incompatibleVersionProblem(actualSchemaLevel: number): DataOpenProblem {
    return Object.freeze({
        code: 'incompatible-version' as const,
        scope: 'workspace' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezePair(['workspace.read' as const, 'workspace.write' as const]),
        allowedActions: freezeEmptyTuple(),
        context: Object.freeze({}),
        details: Object.freeze({
            actualSchemaLevel,
            requiredSchemaLevel: CURRENT_SCHEMA_LEVEL,
        }),
    });
}

function integrityProblem(
    reason: 'wrong-application-id' | 'nonempty-level-zero' | 'schema-mismatch' | 'database-corrupt',
): DataOpenProblem {
    return Object.freeze({
        code: 'integrity' as const,
        scope: 'workspace' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezePair(['workspace.read' as const, 'workspace.write' as const]),
        allowedActions: freezeEmptyTuple(),
        context: Object.freeze({}),
        details: Object.freeze({ reason }),
    });
}

function databaseUnreadableProblem(): DataOpenProblem {
    return Object.freeze({
        code: 'recovery-required' as const,
        scope: 'workspace' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezePair(['workspace.read' as const, 'workspace.write' as const]),
        allowedActions: freezeEmptyTuple(),
        context: Object.freeze({}),
        details: Object.freeze({ reason: 'database-unreadable' as const }),
    });
}

function recoveryResult(problem: DataOpenProblem): DataOpenResult {
    return Object.freeze({
        kind: 'recovery' as const,
        sqliteVersion: SQLITE_VERSION,
        problem,
    });
}

function closeBestEffort(database: DatabaseSync | undefined): void {
    try {
        database?.close();
    } catch {
        // The stable open classification does not depend on a second close failure.
    }
}

function primarySqliteCode(error: unknown): number | undefined {
    if (typeof error !== 'object'
        || error === null
        || !('errcode' in error)
        || typeof error.errcode !== 'number') {
        return undefined;
    }
    return error.errcode & 0xFF;
}

function unreadableOpenProblem(error: unknown): DataOpenProblem {
    const primaryCode = primarySqliteCode(error);
    if (primaryCode === 11 || primaryCode === 26) {
        return integrityProblem('database-corrupt');
    }
    return databaseUnreadableProblem();
}

function validationProblem(error: unknown): DataOpenProblem {
    if (error instanceof SchemaValidationError) {
        return integrityProblem(error.reason);
    }
    return unreadableOpenProblem(error);
}

function readDatabaseIdentity(database: DatabaseSync): Readonly<{
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

function hasSchemaObjects(database: DatabaseSync): boolean {
    const row = database.prepare(`
        SELECT count(*) AS count
        FROM sqlite_schema
        WHERE name NOT LIKE 'sqlite_%'
    `).get() as { count: number };
    return row.count !== 0;
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
        migrateLevel0To1(stagingDatabase);
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
            INSERT INTO protection_watermarks (
                singleton,
                backup_needed_through,
                backup_succeeded_through
            ) VALUES (1, 0, 0);
        `);
        throwFailpoint(options.failpoint, 'initialize.after-bootstrap');
        stagingDatabase.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_LEVEL}`);
        throwFailpoint(options.failpoint, 'initialize.after-user-version');
        stagingDatabase.exec('COMMIT');
        stagingDatabase.close();
        stagingDatabase = undefined;

        const validationDatabase = openDatabase(stagingDatabasePath, true);
        try {
            validateSchemaLevel1(validationDatabase);
        } finally {
            validationDatabase.close();
        }
        throwFailpoint(options.failpoint, 'initialize.after-validation');

        renameSync(stagingDirectory, activeDirectory(dataSlotsRoot));
        activated = true;
        const activeDatabase = openDatabase(databasePath(dataSlotsRoot), false);
        const facts = validateSchemaLevel1(activeDatabase);
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

        const facts = validateSchemaLevel1(validationDatabase);
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
        const facts = validateSchemaLevel1(activeDatabase);
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
