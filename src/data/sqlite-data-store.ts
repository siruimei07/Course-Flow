/**
 * @file Implements the transactional SQLite owner for Workspace facts and receipts.
 */

import {
    constants as fsConstants,
    copyFileSync,
    existsSync,
    lstatSync,
    mkdirSync,
    renameSync,
    rmSync,
} from 'node:fs';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {basename, isAbsolute, join} from 'node:path';
import { backup, DatabaseSync, type DatabaseSyncOptions } from 'node:sqlite';

import {
    normalizeCancelMeetingOccurrenceCommand,
    normalizeAcceptedChangeMeetingOccurrenceCommand,
    normalizeMeetingOccurrenceWindow,
    normalizeMeetingOccurrenceImpactDraft,
    normalizeCreateCourseCommand,
    normalizeCreateMeetingSeriesCommand,
    normalizeAcceptedCreateCourseWithMeetingCommand,
    type AcceptedCreateCourseWithMeetingCommand,
    type AcceptedChangeMeetingOccurrenceCommand,
    type CancelMeetingOccurrenceCommand,
    type ChangeMeetingOccurrenceCommand,
    type CreateCourseCommand,
    type CreateCourseWithMeetingCommand,
    type CreateMeetingSeriesCommand,
    type CourseColor,
    type CourseTeachingRangeIntent,
    type MeetingEffectiveRangeIntent,
    type MeetingLocation,
    type MeetingOverlapWarning,
    type MeetingOccurrenceId,
    type MeetingOccurrenceImpactDraft,
    type MeetingOccurrenceImpactProjection,
    type MeetingOccurrenceWindow,
    type MeetingRuleReplacement,
    type MeetingSeriesDetailProjection,
    type MeetingTypeCode,
    type MeetingWeekday,
    deriveMeetingOccurrenceId,
    MAX_MEETING_OCCURRENCE_WINDOW_DAYS,
    MAX_MEETING_OVERLAP_WARNINGS,
} from '../shared/workspace-course-contract';
import {
    INTL_ZONE_RULES,
    findMeetingTimeOverlap,
    isCanonicalInstant,
    resolveMeetingOccurrenceTime,
    type MeetingEndDayOffset,
    type MeetingInstantWindow,
} from '../shared/meeting-time';
import { canonicalJson } from '../shared/canonical-json';
import {
    isCanonicalUnsignedSqliteInteger,
    isCanonicalUuid,
    normalizeRecordSetupDecisionCommand,
    type RecordSetupDecisionCommand,
} from '../shared/workspace-data-contract';
import {
    BACKUP_REPOSITORY_SCHEMA,
    normalizeAcceptedConfigureBackupDestinationCommand,
    type AcceptedConfigureBackupDestinationCommand,
    type DataProtectionProjection,
} from '../shared/workspace-protection-contract';
import {
    normalizeCreateHolidayRangeCommand,
    normalizeDeleteHolidayRangeCommand,
    normalizeUpdateHolidayRangeCommand,
    type CreateHolidayRangeCommand,
    type DeleteHolidayRangeCommand,
    type HolidayRangeProjection,
    type HolidayRangeCommand,
    type UpdateHolidayRangeCommand,
} from '../shared/workspace-holiday-contract';
import {
    type PlanMeetingSource,
    type PlanProjectionSource,
    type PlanTaskSource,
} from '../shared/workspace-plan-contract';
import {
    localDateInTermZone,
    MAX_SETUP_DRAFT_PAYLOAD_BYTES,
    normalizeCreateTermCommand,
    normalizeReconcileWorkspaceLifecycleCommand,
    normalizeRestoreTermAsCurrentCommand,
    normalizeUpdateTermEndDateCommand,
    type CreateTermCommand,
    type ReconcileWorkspaceLifecycleCommand,
    type RestoreTermAsCurrentCommand,
    type SetupDraftCheckpoint,
    type SetupProjection,
    type TermProjection,
    type UpdateTermEndDateCommand,
} from '../shared/workspace-term-contract';
import {
    deriveTaskOccurrenceId,
    normalizeChangeTaskOccurrenceCommand,
    normalizeCompleteTaskCommand,
    normalizeCreateTaskCommand,
    normalizeDeleteTaskOccurrenceOrSeriesCommand,
    normalizeDeleteTaskCommand,
    normalizeSetTaskOccurrenceStatusCommand,
    normalizeSetTaskProgressCommand,
    normalizeTaskOccurrenceImpactDraft,
    normalizeTaskOccurrenceWindow,
    normalizeUndoTaskOccurrenceStateCommand,
    normalizeUpdateTaskCommand,
    type ChangeTaskOccurrenceCommand,
    type CompleteTaskCommand,
    type CreateTaskCommand,
    type DeleteTaskOccurrenceOrSeriesCommand,
    type DeleteTaskCommand,
    type SetTaskOccurrenceStatusCommand,
    type SetTaskProgressCommand,
    type TaskCommand,
    type TaskDeadline,
    type TaskOccurrenceImpactDraft,
    type TaskOccurrenceImpactProjection,
    type TaskOccurrenceProjection,
    type TaskOccurrenceReplacement,
    type TaskOccurrenceStatus,
    type OnceTaskOccurrenceProjection,
    type TaskOccurrenceWindow,
    type TaskSchedule,
    type TaskSeriesDetailProjection,
    type TaskSize,
    type TaskUndoCapability,
    type UndoTaskOccurrenceStateCommand,
    type UpdateTaskCommand,
    type WeeklyTaskOccurrenceProjection,
} from '../shared/workspace-task-contract';
import {
    digestCancelMeetingOccurrence,
    digestChangeMeetingOccurrence,
    digestChangeTaskOccurrence,
    digestConfigureBackupDestination,
    digestCreateCourse,
    digestCreateCourseWithMeeting,
    digestCreateMeetingSeries,
    digestCreateHolidayRange,
    digestCreateTerm,
    digestDeleteHolidayRange,
    digestDeleteTaskOccurrenceOrSeries,
    digestCompleteTask,
    digestCreateTask,
    digestDeleteTask,
    digestReconcileWorkspaceLifecycle,
    digestRecordSetupDecision,
    digestRestoreTermAsCurrent,
    digestSetTaskOccurrenceStatus,
    digestSetTaskProgress,
    digestUpdateTermEndDate,
    digestUpdateHolidayRange,
    digestUpdateTask,
    digestUndoTaskOccurrenceState,
} from './command-digest';
import {
    COURSEFLOW_APPLICATION_ID,
    CURRENT_SCHEMA_LEVEL,
    createSchemaLevel15,
    migrateLevel1To2,
    migrateLevel2To3,
    migrateLevel3To4,
    migrateLevel4To5,
    migrateLevel5To6,
    migrateLevel6To7,
    migrateLevel7To8,
    migrateLevel8To9,
    migrateLevel9To10,
    migrateLevel10To11,
    migrateLevel11To12,
    migrateLevel12To13,
    migrateLevel13To14,
    migrateLevel14To15,
    migrateLevel15To16,
    SchemaValidationError,
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
    type SchemaFacts,
} from './schema';
import {
    ensureMigrationSafetyCopy,
    inspectMigrationSafetyCopy,
    type MigrationSafetyCopyBuildBindingV1,
    type MigrationSafetyCopyFailpoint,
} from './migration-safety-copy';

export {
    consumeMigrationSafetyCopyAfterRollback,
    inspectMigrationSafetyCopy,
    stageMigrationSafetyCopyForRollback,
    type ConsumeMigrationSafetyCopyOptions,
    type MigrationSafetyCopyMetadataV1,
    type MigrationSafetyCopyStatus,
    type MigrationRollbackArtifactV1,
    type MigrationRollbackTargetV1,
} from './migration-safety-copy';

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
    migrationFailpoint?: (point: MigrationFailpoint) => void;
    migrationSafetyCopy?: MigrationSafetyCopyBuildBindingV1;
}>;

export type RestoreActivationCloseFailpoint =
    | 'activation-close.before-wal-checkpoint'
    | 'activation-close.after-wal-checkpoint';

export type RestoreDataSlotFacts = Readonly<{
    workspaceId: string;
    schemaLevel: string;
    revision: string;
}>;

export type MigrationFailpoint =
    | 'migration.after-safety-copy'
    | 'migration.before-level-commit'
    | MigrationSafetyCopyFailpoint;

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
        details: Readonly<{ actualSchemaLevel: number; requiredSchemaLevel: 15 }>;
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
    }>
    | Readonly<{
        code: 'migration-safety-unavailable';
        scope: 'workspace';
        dataEffect: 'unchanged';
        affectedCapabilities: readonly ['workspace.read', 'workspace.write'];
        allowedActions: readonly [];
        context: Readonly<Record<never, never>>;
        details: Readonly<{reason: 'build-binding-missing'}>;
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
        schemaLevel: 15;
        revision: string;
    }>
    | Readonly<{
        kind: 'read-only';
        workspaceId: string;
        schemaLevel: 15;
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
    | 'setup-draft.commit-attempted'
    | 'commit.after-sqlite-commit';

export type CommitOptions = Readonly<{
    failpoint?: (point: CommitFailpoint) => void;
}>;

export type StoredBackupDestination = AcceptedConfigureBackupDestinationCommand['destination'];

export class CommittedCommandOutcomeUnknownError extends Error {
    public constructor(public readonly commandId: string) {
        super('Committed command outcome requires receipt recovery');
        this.name = 'CommittedCommandOutcomeUnknownError';
    }
}

export class SetupDraftCheckpointOutcomeUnknownError extends Error {
    public constructor() {
        super('Setup draft checkpoint outcome requires projection reconciliation');
        this.name = 'SetupDraftCheckpointOutcomeUnknownError';
    }
}

type ReceiptEffect = Readonly<{
    code:
        | 'workspace.setup-decision-recorded'
        | 'plan.term-created-current'
        | 'plan.term-auto-archived'
        | 'plan.term-end-date-updated'
        | 'plan.term-restored-current'
        | 'plan.course-created'
        | 'plan.meeting-series-created'
        | 'plan.meeting-occurrence-changed'
        | 'plan.meeting-occurrence-cancelled'
        | 'plan.holiday-range-created'
        | 'plan.holiday-range-updated'
        | 'plan.holiday-range-deleted'
        | 'plan.task-series-created'
        | 'plan.task-series-updated'
        | 'plan.task-series-deleted'
        | 'plan.task-occurrence-completed'
        | 'plan.task-occurrence-status-set'
        | 'plan.task-progress-set'
        | 'plan.task-occurrence-changed'
        | 'plan.task-occurrence-deleted'
        | 'plan.task-occurrence-state-undone'
        | 'protect.backup-destination-configured';
    entity: Readonly<{
        kind:
            | 'workspace-setup'
            | 'term'
            | 'course'
            | 'meeting-series'
            | 'holiday-range'
            | 'task-series'
            | 'backup-configuration';
        id: string;
        version: string;
    }>;
}>;

export type CommandReceiptOutcome = Readonly<{
    kind: 'committed';
    revision: string;
    effects: readonly [ReceiptEffect, ...ReceiptEffect[]];
    pendingFollowUps: readonly [string];
    undoCapability?: TaskUndoCapability | null;
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

export type BackupOperationPhase =
    | 'queued'
    | 'database-checkpoint'
    | 'library-copy'
    | 'staging-validation'
    | 'publishing'
    | 'published-pending-record'
    | 'succeeded';

export type BackupOperation = Readonly<{
    operationId: string;
    backupSetId: string;
    backupSequence: string;
    snapshotId: string;
    targetRevision: string;
    actualRevision: string | null;
    stagingDirectoryName: string;
    createdAt: string;
    phase: BackupOperationPhase;
    version: string;
}>;

export type SuccessfulBackupSnapshot = Readonly<{
    snapshotId: string;
    backupSetId: string;
    backupSequence: string;
    actualRevision: string;
    rootDigest: string;
    succeededAt: string;
}>;

export type RestoreDatabaseFacts = BackupDatabaseFacts & Readonly<{
    termCount: string;
    courseCount: string;
    taskSeriesCount: string;
    sourceBackup: Readonly<{
        backupSetId: string;
        backupSequence: string;
        snapshotId: string;
        targetRevision: string;
    }>;
}>;

export type PreparedRestoreDatabaseFacts = RestoreDatabaseFacts & Readonly<{
    sourceSchemaLevel: string;
    preparedSchemaLevel: string;
    validationCopy: 'copied' | 'migrated';
}>;

export type StoredRestoreSession = Readonly<{
    restoreSessionId: string;
    operationId: string;
    candidateRef: string;
    snapshotId: string;
    candidateRootDigest: string;
    candidateDatabaseDigest: string;
    sourceSchemaLevel: string;
    preparedSchemaLevel: string;
    candidateRevision: string;
    validationCopy: 'copied' | 'migrated';
    currentWorkspaceId: string;
    currentRevision: string;
    currentLibrary: Readonly<{kind: 'absent'}> | Readonly<{
        kind: 'present';
        libraryRootId: string;
        rootGeneration: string;
    }>;
    targetBindingVersion: string;
    termCount: string;
    courseCount: string;
    taskSeriesCount: string;
    impactDigest: string;
    bindingDigest: string;
    previewToken: string | null;
    phase: 'previewed' | 'waiting-decision' | 'protection-established' | 'cancelled';
    sessionVersion: string;
    problemCode: 'impact-changed' | null;
    safetySetId: string | null;
    safetyProtectedRevision: string | null;
    safetyRootDigest: string | null;
}>;

export type StoredRestoreCommandReceipt = Readonly<{
    commandId: string;
    commandKind: 'start' | 'confirm' | 'cancel';
    payloadDigest: string;
    restoreSessionId: string;
    resultSessionVersion: string;
}>;

export type RestoreCompletionReceiptInput = Readonly<{
    operationId: string;
    restoreSessionId: string;
    outcome: 'succeeded' | 'rolled-back';
    sessionVersion: string;
    sourceSnapshotId: string;
    sourceRootDigest: string;
    sourceSchemaLevel: string;
    postMigrationSchemaLevel: string;
    activeWorkspaceId: string;
    activeRevision: string;
    library: Readonly<{state: 'absent'}>;
    protection: Readonly<{mode: 'required'; safetySetId: string}>;
    planDigest: string;
    precommit: Readonly<{sequence: string; recordDigest: string}>;
    route: 'setup' | 'today';
    receiptFormatVersion: '1';
}>;

export type RestoreCompletionReceipt = RestoreCompletionReceiptInput & Readonly<{
    receiptDigest: string;
}>;

export type BackupCleanupOperation = Readonly<{
    operationId: string;
    backupSetId: string;
    snapshotId: string;
    backupSequence: string;
    rootDigest: string;
    snapshotDirectoryName: string;
    quarantineDirectoryName: string;
    phase: 'planned' | 'quarantined' | 'deleting';
    version: string;
}>;

export type BackupDatabaseFacts = Readonly<{
    workspaceId: string;
    applicationId: string;
    schemaLevel: string;
    actualRevision: string;
}>;

export type BackupConfigurationForProtection = StoredBackupDestination & Readonly<{
    workspaceId: string;
}>;

type BackupOperationRow = {
    operation_id: string;
    backup_set_id: string;
    backup_sequence: bigint;
    snapshot_id: string;
    target_revision: bigint;
    actual_revision: bigint | null;
    staging_directory_name: string;
    created_at: string;
    phase: BackupOperationPhase;
    operation_version: bigint;
};

type BackupCleanupOperationRow = {
    operation_id: string;
    backup_set_id: string;
    snapshot_id: string;
    backup_sequence: bigint;
    root_digest: string;
    snapshot_directory_name: string;
    quarantine_directory_name: string;
    phase: 'planned' | 'quarantined' | 'deleting';
    operation_version: bigint;
};

type RestoreSessionRow = {
    restore_session_id: string;
    operation_id: string;
    candidate_ref: string;
    snapshot_id: string;
    candidate_root_digest: string;
    candidate_database_digest: string;
    source_schema_level: bigint;
    prepared_schema_level: bigint;
    candidate_revision: bigint;
    validation_copy: 'copied' | 'migrated';
    current_workspace_id: string;
    current_revision: bigint;
    current_library_kind: 'absent' | 'present';
    current_library_root_id: string | null;
    current_root_generation: string | null;
    target_binding_version: bigint;
    term_count: bigint;
    course_count: bigint;
    task_series_count: bigint;
    impact_digest: string;
    binding_digest: string;
    preview_token: string | null;
    phase: 'previewed' | 'waiting-decision' | 'protection-established' | 'cancelled';
    session_version: bigint;
    problem_code: 'impact-changed' | null;
    safety_set_id: string | null;
    safety_protected_revision: bigint | null;
    safety_root_digest: string | null;
};

type RestoreCompletionReceiptRow = {
    operation_id: string;
    restore_session_id: string;
    outcome: 'succeeded' | 'rolled-back';
    session_version: bigint;
    source_snapshot_id: string;
    source_root_digest: string;
    source_schema_level: bigint;
    post_migration_schema_level: bigint;
    active_workspace_id: string;
    active_revision: bigint;
    library_state: 'absent';
    protection_mode: 'required';
    safety_set_id: string;
    plan_digest: string;
    precommit_sequence: bigint;
    precommit_record_digest: string;
    route: 'setup' | 'today';
    receipt_format_version: '1';
    receipt_digest: string;
};

/**
 * Converts one validated storage row into the path-safe PROTECT operation contract.
 * @param {BackupOperationRow} row - Typed SQLite operation row.
 * @return {BackupOperation} Immutable public operation facts.
 */
function backupOperationFromRow(row: BackupOperationRow): BackupOperation {
    return Object.freeze({
        operationId: row.operation_id,
        backupSetId: row.backup_set_id,
        backupSequence: row.backup_sequence.toString(),
        snapshotId: row.snapshot_id,
        targetRevision: row.target_revision.toString(),
        actualRevision: row.actual_revision?.toString() ?? null,
        stagingDirectoryName: row.staging_directory_name,
        createdAt: row.created_at,
        phase: row.phase,
        version: row.operation_version.toString(),
    });
}

/**
 * Converts one validated cleanup journal row into the path-safe PROTECT contract.
 * @param {BackupCleanupOperationRow} row - Typed SQLite cleanup row.
 * @return {BackupCleanupOperation} Immutable cleanup operation facts.
 */
function backupCleanupOperationFromRow(row: BackupCleanupOperationRow): BackupCleanupOperation {
    return Object.freeze({
        operationId: row.operation_id,
        backupSetId: row.backup_set_id,
        snapshotId: row.snapshot_id,
        backupSequence: row.backup_sequence.toString(),
        rootDigest: row.root_digest,
        snapshotDirectoryName: row.snapshot_directory_name,
        quarantineDirectoryName: row.quarantine_directory_name,
        phase: row.phase,
        version: row.operation_version.toString(),
    });
}

function restoreSessionFromRow(row: RestoreSessionRow): StoredRestoreSession {
    return Object.freeze({
        restoreSessionId: row.restore_session_id,
        operationId: row.operation_id,
        candidateRef: row.candidate_ref,
        snapshotId: row.snapshot_id,
        candidateRootDigest: row.candidate_root_digest,
        candidateDatabaseDigest: row.candidate_database_digest,
        sourceSchemaLevel: row.source_schema_level.toString(),
        preparedSchemaLevel: row.prepared_schema_level.toString(),
        candidateRevision: row.candidate_revision.toString(),
        validationCopy: row.validation_copy,
        currentWorkspaceId: row.current_workspace_id,
        currentRevision: row.current_revision.toString(),
        currentLibrary: row.current_library_kind === 'absent'
            ? Object.freeze({kind: 'absent' as const})
            : Object.freeze({
                kind: 'present' as const,
                libraryRootId: row.current_library_root_id!,
                rootGeneration: row.current_root_generation!,
            }),
        targetBindingVersion: row.target_binding_version.toString(),
        termCount: row.term_count.toString(),
        courseCount: row.course_count.toString(),
        taskSeriesCount: row.task_series_count.toString(),
        impactDigest: row.impact_digest,
        bindingDigest: row.binding_digest,
        previewToken: row.preview_token,
        phase: row.phase,
        sessionVersion: row.session_version.toString(),
        problemCode: row.problem_code,
        safetySetId: row.safety_set_id,
        safetyProtectedRevision: row.safety_protected_revision?.toString() ?? null,
        safetyRootDigest: row.safety_root_digest,
    });
}

/**
 * Materializes one path-free completion receipt from its strict storage row.
 * @param {RestoreCompletionReceiptRow} row - Validated schema-level receipt row.
 * @return {RestoreCompletionReceipt} Immutable public receipt facts.
 */
function restoreCompletionReceiptFromRow(
    row: RestoreCompletionReceiptRow,
): RestoreCompletionReceipt {
    return Object.freeze({
        operationId: row.operation_id,
        restoreSessionId: row.restore_session_id,
        outcome: row.outcome,
        sessionVersion: row.session_version.toString(),
        sourceSnapshotId: row.source_snapshot_id,
        sourceRootDigest: row.source_root_digest,
        sourceSchemaLevel: row.source_schema_level.toString(),
        postMigrationSchemaLevel: row.post_migration_schema_level.toString(),
        activeWorkspaceId: row.active_workspace_id,
        activeRevision: row.active_revision.toString(),
        library: Object.freeze({state: 'absent' as const}),
        protection: Object.freeze({
            mode: 'required' as const,
            safetySetId: row.safety_set_id,
        }),
        planDigest: row.plan_digest,
        precommit: Object.freeze({
            sequence: row.precommit_sequence.toString(),
            recordDigest: row.precommit_record_digest,
        }),
        route: row.route,
        receiptFormatVersion: row.receipt_format_version,
        receiptDigest: row.receipt_digest,
    });
}

/**
 * Requires an object to expose exactly the named enumerable data properties.
 * @param {unknown} value - Candidate value.
 * @param {readonly string[]} keys - Complete allowed key set.
 * @return {boolean} Whether the object has the exact plain shape.
 */
function hasExactPlainKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
    if (typeof value !== 'object'
        || value === null
        || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype) {
        return false;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actualKeys = Reflect.ownKeys(descriptors);
    return actualKeys.length === keys.length
        && actualKeys.every(key => typeof key === 'string' && keys.includes(key))
        && keys.every(key => {
            const descriptor = descriptors[key];
            return descriptor !== undefined && descriptor.enumerable && 'value' in descriptor;
        });
}

/**
 * Validates the closed Restore receipt shape before DATA commits it.
 * @param {RestoreCompletionReceiptInput} input - Candidate receipt facts.
 * @return {void}
 */
function requireRestoreCompletionReceiptInput(input: RestoreCompletionReceiptInput): void {
    if (!hasExactPlainKeys(input, [
        'operationId',
        'restoreSessionId',
        'outcome',
        'sessionVersion',
        'sourceSnapshotId',
        'sourceRootDigest',
        'sourceSchemaLevel',
        'postMigrationSchemaLevel',
        'activeWorkspaceId',
        'activeRevision',
        'library',
        'protection',
        'planDigest',
        'precommit',
        'route',
        'receiptFormatVersion',
    ])
        || !isCanonicalUuid(input.operationId)
        || !isCanonicalUuid(input.restoreSessionId)
        || (input.outcome !== 'succeeded' && input.outcome !== 'rolled-back')
        || !isCanonicalUnsignedSqliteInteger(input.sessionVersion)
        || input.sessionVersion !== '3'
        || !isCanonicalUuid(input.sourceSnapshotId)
        || !/^[0-9a-f]{64}$/.test(input.sourceRootDigest)
        || !isCanonicalUnsignedSqliteInteger(input.sourceSchemaLevel)
        || BigInt(input.sourceSchemaLevel) < 13n
        || BigInt(input.sourceSchemaLevel) > BigInt(CURRENT_SCHEMA_LEVEL)
        || input.postMigrationSchemaLevel !== CURRENT_SCHEMA_LEVEL.toString()
        || !isCanonicalUuid(input.activeWorkspaceId)
        || !isCanonicalUnsignedSqliteInteger(input.activeRevision)
        || !hasExactPlainKeys(input.library, ['state'])
        || input.library.state !== 'absent'
        || !hasExactPlainKeys(input.protection, ['mode', 'safetySetId'])
        || input.protection.mode !== 'required'
        || !isCanonicalUuid(input.protection.safetySetId)
        || !/^[0-9a-f]{64}$/.test(input.planDigest)
        || !hasExactPlainKeys(input.precommit, ['sequence', 'recordDigest'])
        || !isCanonicalUnsignedSqliteInteger(input.precommit.sequence)
        || input.precommit.sequence === '0'
        || !/^[0-9a-f]{64}$/.test(input.precommit.recordDigest)
        || (input.route !== 'setup' && input.route !== 'today')
        || input.receiptFormatVersion !== '1') {
        throw new TypeError('Restore completion receipt is invalid');
    }
}

const BACKUP_PHASE_SUCCESSORS: Readonly<Partial<Record<BackupOperationPhase, BackupOperationPhase>>> = {
    'database-checkpoint': 'library-copy',
    'library-copy': 'staging-validation',
    'staging-validation': 'publishing',
    publishing: 'published-pending-record',
};

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
            kind:
                | 'workspace-setup'
                | 'plan-state'
                | 'meeting-series'
                | 'holiday-range'
                | 'task-series'
                | 'backup-configuration';
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

type DecisionRequiredProblem =
    | Readonly<{
        code: 'decision-required';
        scope: 'operation';
        dataEffect: 'unchanged';
        affectedCapabilities: readonly ['workspace.write'];
        allowedActions: readonly ['preview'];
        context: Readonly<{ revision: string }>;
        details: Readonly<{ reason: 'impact-confirmation-required' }>;
    }>
    | Readonly<{
        code: 'decision-required';
        scope: 'operation';
        dataEffect: 'unchanged';
        affectedCapabilities: readonly ['workspace.write'];
        allowedActions: readonly ['continue'];
        context: Readonly<{ revision: string }>;
        details: Readonly<{
            reason: 'meeting-time-overlap';
            warnings: readonly MeetingOverlapWarning[];
        }>;
    }>;

export type DataCommitResult =
    | Readonly<{ ok: true; value: CommandReceiptOutcome }>
    | Readonly<{
        ok: false;
        problem: ConflictProblem | WriterBusyProblem | PermissionCommitProblem | DecisionRequiredProblem;
    }>;

export type SetupDraftCheckpointWriteResult =
    | Readonly<{
        ok: true;
        value: Readonly<{ draftCheckpointVersion: string }>;
    }>
    | Readonly<{
        ok: false;
        problem: ConflictProblem | WriterBusyProblem | PermissionCommitProblem;
    }>;

type CommitWork = {
    kind: 'commit';
    command: WorkspaceDataCommand;
    options: CommitOptions;
    resolve: (result: DataCommitResult) => void;
    reject: (error: unknown) => void;
};

type SetupDraftWork = {
    kind: 'setup-draft';
    mutation:
        | Readonly<{
            kind: 'save';
            expectedVersion: string;
            schemaVersion: 1;
            updatedAt: string;
            opaquePayload: string;
        }>
        | Readonly<{
            kind: 'discard';
            expectedVersion: string;
        }>;
    options: CommitOptions;
    resolve: (result: SetupDraftCheckpointWriteResult) => void;
    reject: (error: unknown) => void;
};

type StoreWriteWork = CommitWork | SetupDraftWork;

type TermMutationCommand =
    | ReconcileWorkspaceLifecycleCommand
    | UpdateTermEndDateCommand
    | RestoreTermAsCurrentCommand;

type MeetingOccurrenceMutationCommand =
    | AcceptedChangeMeetingOccurrenceCommand
    | CancelMeetingOccurrenceCommand;

type TaskSeriesMutationCommand =
    | CreateTaskCommand
    | UpdateTaskCommand
    | DeleteTaskCommand;

type TaskOccurrenceStateMutationCommand =
    | CompleteTaskCommand
    | SetTaskOccurrenceStatusCommand
    | SetTaskProgressCommand
    | UndoTaskOccurrenceStateCommand;

type TaskOccurrenceRuleMutationCommand =
    | ChangeTaskOccurrenceCommand
    | DeleteTaskOccurrenceOrSeriesCommand;

type WorkspaceDataCommand =
    | RecordSetupDecisionCommand
    | CreateTermCommand
    | CreateCourseCommand
    | CreateMeetingSeriesCommand
    | AcceptedCreateCourseWithMeetingCommand
    | MeetingOccurrenceMutationCommand
    | HolidayRangeCommand
    | TaskCommand
    | TermMutationCommand
    | AcceptedConfigureBackupDestinationCommand;

type CurrentVersions = Readonly<{
    revision: bigint;
    setupVersion: bigint;
    planVersion: bigint;
    protectionVersion: bigint;
}>;

const COMMIT_QUEUE_CAPACITY = 64;
const SQLITE_INTEGER_MAX = 9223372036854775807n;
const runtimeSqliteVersion = process.versions.sqlite;
if (typeof runtimeSqliteVersion !== 'string') {
    throw new Error('SQLite runtime version is unavailable');
}
const SQLITE_VERSION = runtimeSqliteVersion;

/**
 * Returns the SQLite runtime version without opening an activity DATA slot.
 * @return {string} Bundled SQLite runtime version.
 */
export function workspaceDataRuntimeVersion(): string {
    return SQLITE_VERSION;
}

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

/**
 * Closes a copied database into standalone DELETE-journal form for one snapshot member.
 * @param {string} path - Exact operation-owned database copy path.
 * @return {void}
 */
function normalizeBackupDatabaseCopy(path: string): void {
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
function validateSupportedRestoreSchema(
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
    return null;
}

/**
 * Reads the bounded whole-replacement counts from one already validated database.
 * @param {DatabaseSync} database - Validated candidate or safety database.
 * @return {object} Exact DATA impact counts.
 */
function readRestoreImpactCounts(database: DatabaseSync): Readonly<{
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
function readRestoreSourceBackup(database: DatabaseSync): RestoreDatabaseFacts['sourceBackup'] {
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

function decimalFromCoefficient(coefficient: bigint, scale: bigint): string {
    if (scale === 0n) {
        return coefficient.toString();
    }
    const scaleNumber = Number(scale);
    const digits = coefficient.toString().padStart(scaleNumber + 1, '0');
    return `${digits.slice(0, -scaleNumber)}.${digits.slice(-scaleNumber)}`;
}

function decimalToCoefficient(value: string | null): readonly [bigint | null, bigint | null] {
    if (value === null) {
        return freezePair([null, null]);
    }
    const [integer, fraction = ''] = value.split('.');
    return freezePair([BigInt(integer + fraction), BigInt(fraction.length)]);
}

function meetingTypeName(type: MeetingTypeCode): 'Lecture' | 'Tutorial' | 'Practical' {
    if (type === 'LEC') {
        return 'Lecture';
    }
    return type === 'TUT' ? 'Tutorial' : 'Practical';
}

const MILLISECONDS_PER_DAY = 86_400_000;
const MEETING_WEEKDAY_NUMBERS: Readonly<Record<MeetingWeekday, number>> = Object.freeze({
    SUN: 0,
    MON: 1,
    TUE: 2,
    WED: 3,
    THU: 4,
    FRI: 5,
    SAT: 6,
});

/**
 * Converts a canonical LocalDate to a UTC arithmetic coordinate.
 * @param {string} value - Canonical LocalDate.
 * @return {number} UTC midnight milliseconds used only for date arithmetic.
 */
function localDateMilliseconds(value: string): number {
    return Date.parse(`${value}T00:00:00.000Z`);
}

/**
 * Adds an in-range number of calendar days to a canonical LocalDate.
 * @param {string} value - Canonical LocalDate.
 * @param {number} days - Signed day offset known to remain representable.
 * @return {string} Shifted canonical LocalDate.
 */
function addLocalDateDays(value: string, days: number): string {
    return new Date(localDateMilliseconds(value) + days * MILLISECONDS_PER_DAY)
        .toISOString()
        .slice(0, 10);
}

/**
 * Adds days while clamping to the supported LocalDate endpoints.
 * @param {string} value - Canonical LocalDate.
 * @param {number} days - Signed day offset.
 * @return {string} Shifted or endpoint-clamped canonical LocalDate.
 */
function addClampedLocalDateDays(value: string, days: number): string {
    const shifted = localDateMilliseconds(value) + days * MILLISECONDS_PER_DAY;
    const minimum = localDateMilliseconds('0000-01-01');
    const maximum = localDateMilliseconds('9999-12-31');
    return new Date(Math.min(maximum, Math.max(minimum, shifted))).toISOString().slice(0, 10);
}

/**
 * Splits one legal Term into non-overlapping bounded occurrence-query windows.
 * @param {string} startDate - Inclusive canonical Term start date.
 * @param {string} endDate - Inclusive canonical Term end date.
 * @return {readonly MeetingOccurrenceWindow[]} Stable windows covering the Term exactly once.
 */
function planOccurrenceWindows(
    startDate: string,
    endDate: string,
): readonly MeetingOccurrenceWindow[] {
    const windows: MeetingOccurrenceWindow[] = [];
    let windowStart = startDate;
    while (windowStart <= endDate) {
        const maximumWindowEnd = addClampedLocalDateDays(
            windowStart,
            MAX_MEETING_OCCURRENCE_WINDOW_DAYS - 1,
        );
        const windowEnd = maximumWindowEnd < endDate ? maximumWindowEnd : endDate;
        windows.push(Object.freeze({ startDate: windowStart, endDate: windowEnd }));
        if (windowEnd === endDate) {
            break;
        }
        windowStart = addLocalDateDays(windowEnd, 1);
    }
    return Object.freeze(windows);
}

/**
 * Projects a stable weekly logical anchor onto an effective weekday.
 * @param {string} originalLogicalAnchor - Stable occurrence identity anchor.
 * @param {MeetingWeekday} weekday - Effective weekday after segment or override rules.
 * @return {string | null} Physical LocalDate, or null beyond the supported date domain.
 */
function occurrenceDate(originalLogicalAnchor: string, weekday: MeetingWeekday): string | null {
    const anchorWeekday = new Date(localDateMilliseconds(originalLogicalAnchor)).getUTCDay();
    const milliseconds = localDateMilliseconds(originalLogicalAnchor)
        + (MEETING_WEEKDAY_NUMBERS[weekday] - anchorWeekday) * MILLISECONDS_PER_DAY;
    if (milliseconds < localDateMilliseconds('0000-01-01')
        || milliseconds > localDateMilliseconds('9999-12-31')) {
        return null;
    }
    return new Date(milliseconds).toISOString().slice(0, 10);
}

/**
 * Chooses the first representable weekly identity anchor for a new Meeting series.
 * @param {string} startDate - Resolved inclusive effective-range start.
 * @param {MeetingWeekday} weekday - Initial Meeting weekday.
 * @return {string} First matching anchor, using the previous match at the LocalDate ceiling.
 */
function firstWeeklyLogicalAnchor(startDate: string, weekday: MeetingWeekday): string {
    const weekdayNumber = MEETING_WEEKDAY_NUMBERS[weekday];
    const startWeekday = new Date(localDateMilliseconds(startDate)).getUTCDay();
    const forwardDays = (weekdayNumber - startWeekday + 7) % 7;
    const forwardMilliseconds = localDateMilliseconds(startDate) + forwardDays * MILLISECONDS_PER_DAY;
    return forwardMilliseconds <= localDateMilliseconds('9999-12-31')
        ? new Date(forwardMilliseconds).toISOString().slice(0, 10)
        : addLocalDateDays(startDate, forwardDays - 7);
}

/**
 * Chooses the first weekly Task anchor on or after its inclusive start without crossing LocalDate max.
 * @param {string} startDate - Inclusive Task schedule start.
 * @param {MeetingWeekday} weekday - Required Task weekday.
 * @return {string | null} First matching LocalDate, or null when no representable match exists.
 */
function firstTaskWeeklyAnchor(startDate: string, weekday: MeetingWeekday): string | null {
    const weekdayNumber = MEETING_WEEKDAY_NUMBERS[weekday];
    const startMilliseconds = localDateMilliseconds(startDate);
    const startWeekday = new Date(startMilliseconds).getUTCDay();
    const forwardDays = (weekdayNumber - startWeekday + 7) % 7;
    const forwardMilliseconds = startMilliseconds + forwardDays * MILLISECONDS_PER_DAY;
    return forwardMilliseconds > localDateMilliseconds('9999-12-31')
        ? null
        : new Date(forwardMilliseconds).toISOString().slice(0, 10);
}

/**
 * Chooses the final weekly Task anchor on or before its inclusive confirmed end.
 * @param {string} endDate - Inclusive confirmed Task schedule end.
 * @param {MeetingWeekday} weekday - Required Task weekday.
 * @return {string} Final matching LocalDate.
 */
function lastTaskWeeklyAnchor(endDate: string, weekday: MeetingWeekday): string {
    const weekdayNumber = MEETING_WEEKDAY_NUMBERS[weekday];
    const endMilliseconds = localDateMilliseconds(endDate);
    const endWeekday = new Date(endMilliseconds).getUTCDay();
    const backwardDays = (endWeekday - weekdayNumber + 7) % 7;
    return addLocalDateDays(endDate, -backwardDays);
}

type StoredMeetingSegment = Readonly<{
    meeting_segment_id: string;
    meeting_type: MeetingTypeCode;
    weekday: MeetingWeekday;
    local_start: string;
    local_end: string;
    end_day_offset: MeetingEndDayOffset;
    logical_start_anchor: string;
    logical_end_anchor: string | null;
    effective_range_kind: MeetingEffectiveRangeIntent['kind'];
    effective_start_date: string | null;
    effective_end_date: string | null;
    resolved_start_date: string;
    resolved_end_date: string;
    location_kind: 'known' | 'tba';
    location_value: string | null;
}>;

type StoredMeetingOverride = Readonly<{
    original_logical_anchor: string;
    override_kind: 'replaced' | 'cancelled';
    meeting_type: MeetingTypeCode | null;
    weekday: MeetingWeekday | null;
    local_start: string | null;
    local_end: string | null;
    end_day_offset: MeetingEndDayOffset | null;
    location_kind: 'known' | 'tba' | null;
    location_value: string | null;
}>;

type StoredConflictMeetingSegment = StoredMeetingSegment & Readonly<{
    meeting_series_id: string;
    course_id: string;
    course_code: string;
    term_zone: string;
}>;

type StoredConflictMeetingOverride = StoredMeetingOverride & Readonly<{
    meeting_series_id: string;
}>;

type StoredHolidayRange = Readonly<{
    holiday_range_id: string;
    start_date: string;
    end_date: string;
}>;

type ConflictMeetingObject = Readonly<{
    courseId: string | null;
    courseCode: string;
    meetingSeriesId: string | null;
}>;

type ConflictMeetingOccurrence = Readonly<{
    object: ConflictMeetingObject;
    meetingType: MeetingTypeCode;
    originalLogicalAnchor: string;
    date: string;
    time: MeetingInstantWindow;
}>;

/**
 * Expands effective scheduled occurrences for one Meeting series in a bounded date window.
 * @param {ConflictMeetingObject} object - Stable stored object or unsaved draft reference.
 * @param {string} termZone - Explicit TermZone owning every local time in the series.
 * @param {readonly StoredMeetingSegment[]} segments - Ordered effective rule segments.
 * @param {readonly StoredMeetingOverride[]} overrides - Replacements and cancellations by anchor.
 * @param {readonly StoredHolidayRange[]} holidayRanges - Active inclusive suppression ranges.
 * @param {MeetingOccurrenceWindow} requestedWindow - Bounded physical start-date window.
 * @return {readonly ConflictMeetingOccurrence[]} Effective scheduled occurrences only.
 */
function expandConflictMeetingOccurrences(
    object: ConflictMeetingObject,
    termZone: string,
    segments: readonly StoredMeetingSegment[],
    overrides: readonly StoredMeetingOverride[],
    holidayRanges: readonly StoredHolidayRange[],
    requestedWindow: MeetingOccurrenceWindow,
): readonly ConflictMeetingOccurrence[] {
    validateMeetingSegmentSequence(segments);
    const overrideByAnchor = new Map(overrides.map(override => [
        override.original_logical_anchor,
        override,
    ]));
    const occurrences: ConflictMeetingOccurrence[] = [];
    const seenAnchors = new Set<string>();
    for (const segment of segments) {
        for (const anchor of candidateLogicalAnchors(segment, requestedWindow)) {
            if (seenAnchors.has(anchor)) {
                throw new Error('Meeting occurrence logical anchor is duplicated');
            }
            seenAnchors.add(anchor);
            const override = overrideByAnchor.get(anchor);
            const baseDate = occurrenceDate(anchor, segment.weekday);
            const weekday = override?.override_kind === 'replaced'
                ? override.weekday!
                : segment.weekday;
            if (!isActiveLogicalAnchor(segment, anchor, segment.weekday)
                || override?.override_kind === 'cancelled') {
                continue;
            }
            const type = override?.override_kind === 'replaced'
                ? override.meeting_type!
                : segment.meeting_type;
            const localStart = override?.override_kind === 'replaced'
                ? override.local_start!
                : segment.local_start;
            const localEnd = override?.override_kind === 'replaced'
                ? override.local_end!
                : segment.local_end;
            const endDayOffset = override?.override_kind === 'replaced'
                ? override.end_day_offset!
                : segment.end_day_offset;
            const date = occurrenceDate(anchor, weekday);
            if (baseDate === null
                || date === null
                || date < requestedWindow.startDate
                || date > requestedWindow.endDate
                || (override?.override_kind !== 'replaced'
                    && holidayRanges.some(range => (
                        baseDate >= range.start_date && baseDate <= range.end_date
                    )))) {
                continue;
            }
            occurrences.push(Object.freeze({
                object,
                meetingType: type,
                originalLogicalAnchor: anchor,
                date,
                time: resolveMeetingOccurrenceTime({
                    termZone,
                    date,
                    localStart,
                    localEnd,
                    endDayOffset,
                }),
            }));
        }
    }
    return Object.freeze(occurrences);
}

/**
 * Materializes user-facing overlap warnings for proposed and retained effective occurrences.
 * @param {string} commandId - Stable draft/decision identity.
 * @param {readonly ConflictMeetingOccurrence[]} proposed - Proposed effective occurrences.
 * @param {readonly ConflictMeetingOccurrence[]} existing - Retained stored occurrences.
 * @return {readonly MeetingOverlapWarning[]} Exact positive overlaps in deterministic order.
 */
function meetingOverlapWarnings(
    commandId: string,
    proposed: readonly ConflictMeetingOccurrence[],
    existing: readonly ConflictMeetingOccurrence[],
): readonly MeetingOverlapWarning[] {
    const warnings: MeetingOverlapWarning[] = [];
    for (const proposedOccurrence of proposed) {
        if (warnings.length >= MAX_MEETING_OVERLAP_WARNINGS) {
            break;
        }
        for (const existingOccurrence of existing) {
            const overlap = findMeetingTimeOverlap(proposedOccurrence.time, existingOccurrence.time);
            if (overlap === null) {
                continue;
            }
            warnings.push(Object.freeze({
                code: 'meeting-time-overlap' as const,
                proposed: Object.freeze({
                    commandId,
                    courseId: proposedOccurrence.object.courseId,
                    courseCode: proposedOccurrence.object.courseCode,
                    meetingSeriesId: proposedOccurrence.object.meetingSeriesId,
                    meetingType: proposedOccurrence.meetingType,
                    occurrenceId: Object.freeze({
                        meetingSeriesId: proposedOccurrence.object.meetingSeriesId,
                        originalLogicalAnchor: proposedOccurrence.originalLogicalAnchor,
                    }),
                    startInstant: proposedOccurrence.time.startInstant,
                    endInstant: proposedOccurrence.time.endInstant,
                }),
                existing: Object.freeze({
                    courseId: existingOccurrence.object.courseId!,
                    courseCode: existingOccurrence.object.courseCode,
                    meetingSeriesId: existingOccurrence.object.meetingSeriesId!,
                    meetingType: existingOccurrence.meetingType,
                    occurrenceId: deriveMeetingOccurrenceId(
                        existingOccurrence.object.meetingSeriesId!,
                        existingOccurrence.originalLogicalAnchor,
                    ),
                    startInstant: existingOccurrence.time.startInstant,
                    endInstant: existingOccurrence.time.endInstant,
                }),
                overlap,
            }));
            if (warnings.length >= MAX_MEETING_OVERLAP_WARNINGS) {
                break;
            }
        }
    }
    return Object.freeze(warnings.sort((first, second) => (
        first.overlap.startInstant.localeCompare(second.overlap.startInstant)
        || first.proposed.occurrenceId.originalLogicalAnchor.localeCompare(
            second.proposed.occurrenceId.originalLogicalAnchor,
        )
        || first.existing.occurrenceId.meetingSeriesId.localeCompare(
            second.existing.occurrenceId.meetingSeriesId,
        )
    )));
}

/**
 * Returns an order-independent identity for one derived Meeting conflict pair.
 * @param {MeetingOverlapWarning} warning - Derived overlap warning.
 * @return {string} Stable pair identity independent of proposed/existing ordering.
 */
function meetingOverlapWarningKey(warning: MeetingOverlapWarning): string {
    return [
        `${warning.proposed.occurrenceId.meetingSeriesId}:${warning.proposed.occurrenceId.originalLogicalAnchor}`,
        `${warning.existing.occurrenceId.meetingSeriesId}:${warning.existing.occurrenceId.originalLogicalAnchor}`,
    ].sort().join('|');
}

/**
 * Derives all pairwise warnings in one bounded effective schedule.
 * @param {string} commandId - Holiday mutation command identity used by warning DTOs.
 * @param {readonly ConflictMeetingOccurrence[]} occurrences - Effective scheduled occurrences.
 * @return {readonly MeetingOverlapWarning[]} Deterministically ordered positive overlaps.
 */
function meetingScheduleOverlapWarnings(
    commandId: string,
    occurrences: readonly ConflictMeetingOccurrence[],
): readonly MeetingOverlapWarning[] {
    const warnings: MeetingOverlapWarning[] = [];
    for (let index = 0; index < occurrences.length; index += 1) {
        warnings.push(...meetingOverlapWarnings(
            commandId,
            [occurrences[index]!],
            occurrences.slice(index + 1),
        ));
    }
    return Object.freeze(warnings.sort((first, second) => (
        first.overlap.startInstant.localeCompare(second.overlap.startInstant)
        || meetingOverlapWarningKey(first).localeCompare(meetingOverlapWarningKey(second))
    )));
}

/**
 * Rejects an ordered segment sequence whose logical ranges overlap.
 * @param {readonly StoredMeetingSegment[]} segments - Segments ordered by logical start anchor.
 * @return {void}
 */
function validateMeetingSegmentSequence(segments: readonly StoredMeetingSegment[]): void {
    let previousEndAnchor: string | null | undefined;
    for (const segment of segments) {
        if (previousEndAnchor !== undefined
            && (previousEndAnchor === null || segment.logical_start_anchor <= previousEndAnchor)) {
            throw new Error('Meeting series has overlapping logical segments');
        }
        previousEndAnchor = segment.logical_end_anchor;
    }
}

/**
 * Tests logical range membership and the segment's seven-day cadence.
 * @param {StoredMeetingSegment} segment - Candidate owning segment.
 * @param {string} anchor - Stable logical occurrence anchor.
 * @return {boolean} Whether the anchor belongs to the segment's weekly sequence.
 */
function logicalAnchorBelongsToSegment(segment: StoredMeetingSegment, anchor: string): boolean {
    return segment.logical_start_anchor <= anchor
        && (segment.logical_end_anchor === null || segment.logical_end_anchor >= anchor)
        && (localDateMilliseconds(anchor) - localDateMilliseconds(segment.logical_start_anchor))
            % (7 * MILLISECONDS_PER_DAY) === 0;
}

/**
 * Tests whether a logical anchor produces an occurrence inside the resolved effective range.
 * @param {StoredMeetingSegment} segment - Candidate owning segment.
 * @param {string} anchor - Stable logical occurrence anchor.
 * @param {MeetingWeekday} weekday - Effective weekday used for physical range membership.
 * @return {boolean} Whether the occurrence is currently active.
 */
function isActiveLogicalAnchor(
    segment: StoredMeetingSegment,
    anchor: string,
    weekday: MeetingWeekday = segment.weekday,
): boolean {
    const date = occurrenceDate(anchor, weekday);
    return date !== null
        && logicalAnchorBelongsToSegment(segment, anchor)
        && segment.resolved_start_date <= date
        && segment.resolved_end_date >= date;
}

/**
 * Enumerates only weekly anchors that can project into a bounded physical window.
 * @param {StoredMeetingSegment} segment - Segment owning the weekly sequence.
 * @param {MeetingOccurrenceWindow} requestedWindow - Bounded physical query window.
 * @return {readonly string[]} Candidate anchors for final rule and override evaluation.
 */
function candidateLogicalAnchors(
    segment: StoredMeetingSegment,
    requestedWindow: MeetingOccurrenceWindow,
): readonly string[] {
    const weekMilliseconds = 7 * MILLISECONDS_PER_DAY;
    const requestedStart = requestedWindow.startDate > segment.resolved_start_date
        ? requestedWindow.startDate
        : segment.resolved_start_date;
    const requestedEnd = requestedWindow.endDate < segment.resolved_end_date
        ? requestedWindow.endDate
        : segment.resolved_end_date;
    if (requestedEnd < requestedStart) {
        return Object.freeze([]);
    }
    const firstAnchorMilliseconds = localDateMilliseconds(segment.logical_start_anchor);
    const earliestAnchorMilliseconds = Math.max(
        localDateMilliseconds('0000-01-01'),
        localDateMilliseconds(requestedStart) - 6 * MILLISECONDS_PER_DAY,
    );
    const latestAnchorMilliseconds = Math.min(
        localDateMilliseconds('9999-12-31'),
        localDateMilliseconds(requestedEnd) + 6 * MILLISECONDS_PER_DAY,
    );
    const minimumIndex = Math.max(0, Math.ceil(
        (earliestAnchorMilliseconds - firstAnchorMilliseconds) / weekMilliseconds,
    ));
    let maximumIndex = Math.floor(
        (latestAnchorMilliseconds - firstAnchorMilliseconds) / weekMilliseconds,
    );
    if (segment.logical_end_anchor !== null) {
        maximumIndex = Math.min(maximumIndex, Math.floor(
            (localDateMilliseconds(segment.logical_end_anchor)
                - localDateMilliseconds(segment.logical_start_anchor)) / weekMilliseconds,
        ));
    }
    if (maximumIndex < minimumIndex) {
        return Object.freeze([]);
    }
    return Object.freeze(Array.from({ length: maximumIndex - minimumIndex + 1 }, (_, index) => (
        addLocalDateDays(segment.logical_start_anchor, (minimumIndex + index) * 7)
    )));
}

/**
 * Counts weekly anchors satisfying both logical-anchor and physical-date bounds.
 * @param {StoredMeetingSegment} segment - Segment owning the logical anchor sequence.
 * @param {MeetingWeekday} weekday - Weekday used to project each anchor to a physical date.
 * @param {number} minimumAnchor - Inclusive lower logical-anchor bound in UTC milliseconds.
 * @param {number} maximumAnchor - Inclusive upper logical-anchor bound in UTC milliseconds.
 * @param {number} minimumDate - Inclusive lower physical-date bound in UTC milliseconds.
 * @param {number} maximumDate - Inclusive upper physical-date bound in UTC milliseconds.
 * @return {number} Number of active anchors satisfying every bound.
 */
function countActiveLogicalAnchors(
    segment: StoredMeetingSegment,
    weekday: MeetingWeekday,
    minimumAnchor: number,
    maximumAnchor: number,
    minimumDate: number,
    maximumDate: number,
): number {
    if (maximumAnchor < minimumAnchor || maximumDate < minimumDate) {
        return 0;
    }
    const weekMilliseconds = 7 * MILLISECONDS_PER_DAY;
    const firstAnchor = localDateMilliseconds(segment.logical_start_anchor);
    const firstAnchorWeekday = new Date(firstAnchor).getUTCDay();
    const firstDate = firstAnchor
        + (MEETING_WEEKDAY_NUMBERS[weekday] - firstAnchorWeekday) * MILLISECONDS_PER_DAY;
    const resolvedStart = localDateMilliseconds(segment.resolved_start_date);
    const resolvedEnd = localDateMilliseconds(segment.resolved_end_date);
    const localDateMaximum = localDateMilliseconds('9999-12-31');
    let minimumIndex = Math.max(
        0,
        Math.ceil((minimumAnchor - firstAnchor) / weekMilliseconds),
        Math.ceil((Math.max(minimumDate, resolvedStart) - firstDate) / weekMilliseconds),
    );
    let maximumIndex = Math.min(
        Math.floor((maximumAnchor - firstAnchor) / weekMilliseconds),
        Math.floor((Math.min(maximumDate, resolvedEnd) - firstDate) / weekMilliseconds),
        Math.floor((localDateMaximum - firstAnchor) / weekMilliseconds),
    );
    if (segment.logical_end_anchor !== null) {
        maximumIndex = Math.min(
            maximumIndex,
            Math.floor(
                (localDateMilliseconds(segment.logical_end_anchor) - firstAnchor) / weekMilliseconds,
            ),
        );
    }
    minimumIndex = Math.ceil(minimumIndex);
    maximumIndex = Math.floor(maximumIndex);
    return maximumIndex < minimumIndex ? 0 : maximumIndex - minimumIndex + 1;
}

/**
 * Detects whether a bounded preview omits an actual weekly occurrence in an anchor partition.
 * @param {readonly StoredMeetingSegment[]} segments - Ordered segments in the Meeting series.
 * @param {number} minimumAnchor - Inclusive lower logical-anchor bound in UTC milliseconds.
 * @param {number} maximumAnchor - Inclusive upper logical-anchor bound in UTC milliseconds.
 * @param {MeetingOccurrenceWindow} requestedWindow - Physical dates shown by the preview.
 * @param {MeetingWeekday | null} replacementWeekday - Proposed weekday, or null for stored rules.
 * @param {readonly StoredMeetingOverride[]} overrides - Boundary replacements that can cross the window.
 * @param {string | null} clearedOverrideAnchor - Override cleared by the proposed split, when any.
 * @return {boolean} Whether at least one matching occurrence falls outside the requested window.
 */
function hasOccurrenceOutsideRequestedWindow(
    segments: readonly StoredMeetingSegment[],
    minimumAnchor: number,
    maximumAnchor: number,
    requestedWindow: MeetingOccurrenceWindow,
    replacementWeekday: MeetingWeekday | null,
    overrides: readonly StoredMeetingOverride[],
    clearedOverrideAnchor: string | null,
): boolean {
    const localDateMinimum = localDateMilliseconds('0000-01-01');
    const localDateMaximum = localDateMilliseconds('9999-12-31');
    const requestedStart = localDateMilliseconds(requestedWindow.startDate);
    const requestedEnd = localDateMilliseconds(requestedWindow.endDate);
    let outsideCount = segments.reduce((count, segment) => {
        const weekday = replacementWeekday ?? segment.weekday;
        const total = countActiveLogicalAnchors(
            segment,
            weekday,
            minimumAnchor,
            maximumAnchor,
            localDateMinimum,
            localDateMaximum,
        );
        const visible = countActiveLogicalAnchors(
            segment,
            weekday,
            minimumAnchor,
            maximumAnchor,
            requestedStart,
            requestedEnd,
        );
        return count + total - visible;
    }, 0);

    for (const override of overrides) {
        if (override.override_kind !== 'replaced'
            || override.original_logical_anchor === clearedOverrideAnchor) {
            continue;
        }
        const anchor = localDateMilliseconds(override.original_logical_anchor);
        if (anchor < minimumAnchor || anchor > maximumAnchor) {
            continue;
        }
        const matchingSegments = segments.filter(segment => (
            logicalAnchorBelongsToSegment(segment, override.original_logical_anchor)
        ));
        if (matchingSegments.length !== 1) {
            throw new Error('Meeting override does not target a logical occurrence');
        }
        const segment = matchingSegments[0]!;
        const baseWeekday = replacementWeekday ?? segment.weekday;
        if (!isActiveLogicalAnchor(segment, override.original_logical_anchor, baseWeekday)) {
            continue;
        }
        const baseDate = occurrenceDate(override.original_logical_anchor, baseWeekday);
        const replacedDate = occurrenceDate(override.original_logical_anchor, override.weekday!);
        if (baseDate === null || replacedDate === null) {
            throw new Error('Meeting override has an invalid physical date');
        }
        const baseOutside = baseDate < requestedWindow.startDate || baseDate > requestedWindow.endDate;
        const replacementOutside = replacedDate < requestedWindow.startDate
            || replacedDate > requestedWindow.endDate;
        outsideCount += Number(replacementOutside) - Number(baseOutside);
    }
    return outsideCount > 0;
}

/**
 * Binds a whole-rule confirmation to versions, exact intent, and preview window.
 * @param {string} revision - Workspace revision used by the preview.
 * @param {string} planEntityVersion - PLAN version used by the preview.
 * @param {string} meetingSeriesVersion - Meeting series version used by the preview.
 * @param {object} change - Exact future-change scope, series, anchor, and replacement facts.
 * @param {MeetingOccurrenceWindow} requestedWindow - Bounded preview window.
 * @return {string} Lowercase SHA-256 confirmation token.
 */
function meetingOccurrenceConfirmationToken(
    revision: string,
    planEntityVersion: string,
    meetingSeriesVersion: string,
    change: Pick<
        MeetingOccurrenceImpactDraft,
        'scope' | 'meetingSeriesId' | 'originalLogicalAnchor' | 'replacement'
    >,
    requestedWindow: MeetingOccurrenceWindow,
): string {
    const encoded = canonicalJson({
        encoding: 'courseflow-meeting-impact-v1',
        revision,
        planEntityVersion,
        meetingSeriesVersion,
        scope: change.scope,
        meetingSeriesId: change.meetingSeriesId,
        originalLogicalAnchor: change.originalLogicalAnchor,
        replacement: change.replacement,
        requestedWindow,
    });
    return createHash('sha256').update(encoded, 'utf8').digest('hex');
}

/**
 * Binds a Task whole-rule confirmation to the exact versions, action, and preview window.
 * @param {string} revision - Workspace revision used by the preview.
 * @param {string} planEntityVersion - PLAN version used by the preview.
 * @param {string} taskSeriesVersion - Task series version used by the preview.
 * @param {TaskOccurrenceImpactDraft} draft - Exact normalized future change or deletion.
 * @return {string} Lowercase SHA-256 confirmation token.
 */
function taskOccurrenceConfirmationToken(
    revision: string,
    planEntityVersion: string,
    taskSeriesVersion: string,
    draft: TaskOccurrenceImpactDraft,
): string {
    const encoded = canonicalJson({
        encoding: 'courseflow-task-impact-v1',
        revision,
        planEntityVersion,
        taskSeriesVersion,
        scope: draft.scope,
        taskSeriesId: draft.taskSeriesId,
        ...(draft.scope === 'whole-series'
            ? {}
            : { originalLogicalAnchor: draft.originalLogicalAnchor }),
        action: draft.action,
        ...(draft.action === 'change' ? { replacement: draft.replacement } : {}),
        requestedWindow: draft.requestedWindow,
    });
    return createHash('sha256').update(encoded, 'utf8').digest('hex');
}

/**
 * Materializes the explicit known/TBA location union from validated stored columns.
 * @param {'known' | 'tba'} kind - Stored location discriminant.
 * @param {string | null} value - Known location text, or null for TBA.
 * @return {MeetingLocation} Immutable location DTO.
 */
function meetingLocation(kind: 'known' | 'tba', value: string | null): MeetingLocation {
    return kind === 'tba'
        ? Object.freeze({ kind: 'tba' as const })
        : Object.freeze({ kind: 'known' as const, value: value! });
}

type TaskDeadlineColumns = readonly [
    TaskDeadline['kind'],
    string | null,
    string | null,
    string | null,
];

type TaskScheduleColumns = readonly [
    TaskSchedule['kind'],
    TaskDeadline['kind'] | null,
    string | null,
    string | null,
    string | null,
    string | null,
    MeetingWeekday | null,
    string | null,
    string | null,
    0 | 1 | null,
];

function taskDeadlineColumns(deadline: TaskDeadline): TaskDeadlineColumns {
    if (deadline.kind === 'date-only') {
        return Object.freeze(['date-only', deadline.date, null, null]);
    }
    if (deadline.kind === 'timed') {
        return Object.freeze(['timed', null, deadline.instant, deadline.timeZone]);
    }
    return Object.freeze(['tba', null, null, null]);
}

/**
 * Serializes the exact once-or-weekly Task schedule union to level-9 columns.
 * @param {TaskSchedule} schedule - Canonical Task schedule.
 * @return {TaskScheduleColumns} SQLite binding tuple with the inactive union arm cleared.
 */
function taskScheduleColumns(schedule: TaskSchedule): TaskScheduleColumns {
    if (schedule.kind === 'once') {
        return Object.freeze([
            'once',
            ...taskDeadlineColumns(schedule.deadline),
            null,
            null,
            null,
            null,
            null,
        ]);
    }
    return Object.freeze([
        'weekly',
        null,
        null,
        null,
        null,
        schedule.startDate,
        schedule.weekday,
        schedule.localDeadlineTime,
        schedule.confirmedEndDate,
        schedule.followTeachingWeek ? 1 : 0,
    ]);
}

function taskDeadlineProjection(
    kind: TaskDeadline['kind'],
    date: string | null,
    instant: string | null,
    displayZone: string | null,
): TaskDeadline {
    if (kind === 'date-only') {
        return Object.freeze({ kind, date: date! });
    }
    if (kind === 'timed') {
        return Object.freeze({ kind, instant: instant!, timeZone: displayZone! });
    }
    return Object.freeze({ kind });
}

type StoredTaskSchedule = Readonly<{
    schedule_kind: TaskSchedule['kind'];
    deadline_kind: TaskDeadline['kind'] | null;
    deadline_date: string | null;
    deadline_instant: string | null;
    deadline_display_zone: string | null;
    weekly_start_date: string | null;
    weekly_weekday: MeetingWeekday | null;
    weekly_local_deadline_time: string | null;
    weekly_confirmed_end_date: string | null;
    follow_teaching_week: bigint | null;
}>;

type StoredTaskSegment = StoredTaskSchedule & Readonly<{
    task_segment_id: string;
    title: string;
    task_size: TaskSize;
    logical_start_anchor: string;
    logical_end_anchor: string;
}>;

type StoredTaskOccurrenceState = Readonly<{
    original_logical_anchor: string;
    status: TaskOccurrenceStatus;
    self_reported_progress: bigint | null;
    entity_version: bigint;
}>;

type StoredTaskOccurrenceOverride = Readonly<{
    original_logical_anchor: string;
    override_kind: 'replaced' | 'deleted';
    replacement_title: string | null;
    replacement_task_size: TaskSize | null;
    replacement_deadline_kind: TaskDeadline['kind'] | null;
    replacement_deadline_date: string | null;
    replacement_deadline_instant: string | null;
    replacement_deadline_display_zone: string | null;
    entity_version: bigint;
}>;

/**
 * Projects the independent occurrence state without conflating completion and progress.
 * @param {StoredTaskOccurrenceState | undefined} state - Optional explicit stored state.
 * @param {TaskSize} size - Effective occurrence size after any override.
 * @return {object} Canonical status plus self-reported and displayed progress.
 */
function taskOccurrenceStateProjection(
    state: StoredTaskOccurrenceState | undefined,
    size: TaskSize,
): Readonly<{
    status: TaskOccurrenceStatus;
    reportedProgress: number | null;
    displayProgress: number | null;
}> {
    const status = state?.status ?? 'pending';
    const reportedProgress = size === 'large' && state?.self_reported_progress !== null
        && state?.self_reported_progress !== undefined
        ? Number(state.self_reported_progress)
        : null;
    return Object.freeze({
        status,
        reportedProgress,
        displayProgress: size !== 'large'
            ? null
            : status === 'completed'
                ? 100
                : reportedProgress,
    });
}

/**
 * Materializes a replaced Task occurrence from its validated stored override.
 * @param {StoredTaskOccurrenceOverride} override - Stored replaced override.
 * @return {TaskOccurrenceReplacement} Exact effective Task facts.
 */
function taskOverrideReplacement(
    override: Omit<StoredTaskOccurrenceOverride, 'original_logical_anchor'>,
): TaskOccurrenceReplacement {
    if (override.override_kind !== 'replaced') {
        throw new Error('Deleted Task override has no replacement facts');
    }
    return Object.freeze({
        title: override.replacement_title!,
        size: override.replacement_task_size!,
        deadline: taskDeadlineProjection(
            override.replacement_deadline_kind!,
            override.replacement_deadline_date,
            override.replacement_deadline_instant,
            override.replacement_deadline_display_zone,
        ),
    });
}

/**
 * Finds the unique current segment owning a stable Task logical anchor.
 * @param {readonly StoredTaskSegment[]} segments - Ordered Task rule segments.
 * @param {string} anchor - Stable once or LocalDate anchor.
 * @return {StoredTaskSegment | undefined} Owning segment, if still active.
 */
function taskSegmentForAnchor(
    segments: readonly StoredTaskSegment[],
    anchor: string,
): StoredTaskSegment | undefined {
    if (anchor === 'once') {
        return segments.find(segment => segment.logical_start_anchor === 'once');
    }
    return segments.find(segment => (
        segment.schedule_kind === 'weekly'
        && anchor >= segment.logical_start_anchor
        && anchor <= segment.logical_end_anchor
        && (localDateMilliseconds(anchor) - localDateMilliseconds(segment.logical_start_anchor))
            % (7 * MILLISECONDS_PER_DAY) === 0
    ));
}

/**
 * Builds the physical deadline of one base occurrence from a stored segment.
 * @param {StoredTaskSegment} segment - Owning current segment.
 * @param {string} anchor - Stable occurrence anchor.
 * @param {string} termZone - Explicit TermZone.
 * @return {TaskDeadline} Effective deadline before an only-this override.
 */
function taskSegmentOccurrenceDeadline(
    segment: StoredTaskSegment,
    anchor: string,
    termZone: string,
): TaskDeadline {
    if (segment.schedule_kind === 'once') {
        return taskDeadlineProjection(
            segment.deadline_kind!,
            segment.deadline_date,
            segment.deadline_instant,
            segment.deadline_display_zone,
        );
    }
    const date = occurrenceDate(anchor, segment.weekly_weekday!);
    if (date === null) {
        throw new Error('Task occurrence deadline is outside the LocalDate domain');
    }
    return Object.freeze({
        kind: 'timed' as const,
        instant: INTL_ZONE_RULES.resolveInstant(
            termZone,
            date,
            segment.weekly_local_deadline_time!,
        ),
        timeZone: termZone,
    });
}

/**
 * Materializes the validated stored Task schedule discriminated union.
 * @param {StoredTaskSchedule} row - Level-9 Task schedule columns.
 * @return {TaskSchedule} Immutable exact Task schedule.
 */
function taskScheduleProjection(row: StoredTaskSchedule): TaskSchedule {
    if (row.schedule_kind === 'once') {
        return Object.freeze({
            kind: 'once',
            deadline: taskDeadlineProjection(
                row.deadline_kind!,
                row.deadline_date,
                row.deadline_instant,
                row.deadline_display_zone,
            ),
        });
    }
    return Object.freeze({
        kind: 'weekly',
        startDate: row.weekly_start_date!,
        weekday: row.weekly_weekday!,
        localDeadlineTime: row.weekly_local_deadline_time!,
        confirmedEndDate: row.weekly_confirmed_end_date!,
        followTeachingWeek: row.follow_teaching_week === 1n,
    });
}

/**
 * Reads the once deadline from either retained v1 facts or a v2 once schedule.
 * @param {CreateTaskCommand['intent']['payload'] | UpdateTaskCommand['intent']['payload']} payload
 *     - Normalized Task facts.
 * @return {TaskDeadline} Exact once deadline.
 */
function taskSchedule(
    payload: CreateTaskCommand['intent']['payload'] | UpdateTaskCommand['intent']['payload'],
): TaskSchedule {
    if ('deadline' in payload) {
        return Object.freeze({ kind: 'once', deadline: payload.deadline });
    }
    return payload.schedule;
}

/**
 * Derives the inclusive stable identity range owned by one unsplit Task rule.
 * @param {TaskSchedule} schedule - Canonical once or weekly schedule.
 * @return {readonly [string, string]} Inclusive logical start and end anchors.
 */
function taskLogicalAnchors(schedule: TaskSchedule): readonly [string, string] {
    if (schedule.kind === 'once') {
        return Object.freeze(['once', 'once']);
    }
    const first = firstTaskWeeklyAnchor(schedule.startDate, schedule.weekday);
    if (first === null || first > schedule.confirmedEndDate) {
        throw new TypeError('Weekly Task schedule has no logical occurrence');
    }
    return Object.freeze([
        first,
        lastTaskWeeklyAnchor(schedule.confirmedEndDate, schedule.weekday),
    ]);
}

function isCourseWithMeetingCommand(
    command: WorkspaceDataCommand,
): command is AcceptedCreateCourseWithMeetingCommand {
    return command.intent.kind === 'plan.create-course-with-first-meeting';
}

function isCreateCourseCommand(command: WorkspaceDataCommand): command is CreateCourseCommand {
    return command.intent.kind === 'plan.create-course';
}

function isCreateMeetingSeriesCommand(
    command: WorkspaceDataCommand,
): command is CreateMeetingSeriesCommand {
    return command.intent.kind === 'plan.create-meeting-series';
}

/**
 * Narrows an accepted Course creation to the current writable schema.
 * @param {AcceptedCreateCourseWithMeetingCommand} command - Accepted creation command.
 * @return {boolean} Whether the command carries current overlap and day-offset semantics.
 */
function isCurrentCourseWithMeetingCommand(
    command: AcceptedCreateCourseWithMeetingCommand,
): command is CreateCourseWithMeetingCommand {
    return 'overlapDecision' in command;
}

/**
 * Narrows a Workspace DATA command to a Meeting occurrence mutation.
 * @param {WorkspaceDataCommand} command - Normalized DATA command.
 * @return {boolean} Whether the command mutates one occurrence or a future rule segment.
 */
function isMeetingOccurrenceMutationCommand(
    command: WorkspaceDataCommand,
): command is MeetingOccurrenceMutationCommand {
    return command.intent.kind === 'plan.change-meeting-occurrence'
        || command.intent.kind === 'plan.cancel-meeting-occurrence';
}

/**
 * Narrows an occurrence mutation to its change variant.
 * @param {MeetingOccurrenceMutationCommand} command - Normalized occurrence mutation.
 * @return {boolean} Whether the command carries a replacement rule.
 */
function isChangeMeetingOccurrenceCommand(
    command: MeetingOccurrenceMutationCommand,
): command is AcceptedChangeMeetingOccurrenceCommand {
    return command.intent.kind === 'plan.change-meeting-occurrence';
}

/**
 * Narrows an accepted occurrence change to the current writable schema.
 * @param {AcceptedChangeMeetingOccurrenceCommand} command - Accepted change command.
 * @return {boolean} Whether the command carries current overlap and day-offset semantics.
 */
function isCurrentChangeMeetingOccurrenceCommand(
    command: AcceptedChangeMeetingOccurrenceCommand,
): command is ChangeMeetingOccurrenceCommand {
    return 'overlapDecision' in command;
}

function isTermMutationCommand(command: WorkspaceDataCommand): command is TermMutationCommand {
    return command.intent.kind === 'workspace.reconcile-lifecycle'
        || command.intent.kind === 'plan.update-term-end-date'
        || command.intent.kind === 'plan.restore-term-as-current';
}

function isHolidayRangeCommand(command: WorkspaceDataCommand): command is HolidayRangeCommand {
    return command.intent.kind === 'plan.create-holiday-range'
        || command.intent.kind === 'plan.update-holiday-range'
        || command.intent.kind === 'plan.delete-holiday-range';
}

function isTaskCommand(command: WorkspaceDataCommand): command is TaskCommand {
    return command.intent.kind === 'plan.create-task-series'
        || command.intent.kind === 'plan.update-task-series'
        || command.intent.kind === 'plan.delete-task-series'
        || command.intent.kind === 'plan.set-task-occurrence-status'
        || command.intent.kind === 'plan.set-task-progress'
        || command.intent.kind === 'plan.change-task-occurrence'
        || command.intent.kind === 'plan.delete-task-occurrence-or-series'
        || command.intent.kind === 'plan.undo-task-occurrence-state';
}

function isTaskOccurrenceStateMutationCommand(
    command: TaskCommand,
): command is TaskOccurrenceStateMutationCommand {
    return command.intent.kind === 'plan.set-task-occurrence-status'
        || command.intent.kind === 'plan.set-task-progress'
        || command.intent.kind === 'plan.undo-task-occurrence-state';
}

function isTaskOccurrenceRuleMutationCommand(
    command: TaskCommand,
): command is TaskOccurrenceRuleMutationCommand {
    return command.intent.kind === 'plan.change-task-occurrence'
        || command.intent.kind === 'plan.delete-task-occurrence-or-series';
}

function isConfigureBackupDestinationCommand(
    command: WorkspaceDataCommand,
): command is AcceptedConfigureBackupDestinationCommand {
    return command.intent.kind === 'protect.configure-backup-destination';
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
    effectCode: ReceiptEffect['code'],
    entityKind: ReceiptEffect['entity']['kind'],
    entityId: string,
    entityVersion: bigint,
    followUpId: string,
): CommandReceiptOutcome {
    const entity = Object.freeze({
        kind: entityKind,
        id: entityId,
        version: entityVersion.toString(),
    });
    const effect = Object.freeze({
        code: effectCode,
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

function committedPairOutcome(
    revision: bigint,
    first: ReceiptEffect,
    second: ReceiptEffect,
    followUpId: string,
): CommandReceiptOutcome {
    return Object.freeze({
        kind: 'committed' as const,
        revision: revision.toString(),
        effects: freezePair([first, second]),
        pendingFollowUps: freezeTuple([followUpId]),
    });
}

function planConflictResult(reason: ConflictReason, versions: CurrentVersions): DataCommitResult {
    const entityVersion = Object.freeze({
        kind: 'plan-state' as const,
        id: 'singleton',
        version: versions.planVersion.toString(),
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

function protectionConflictResult(
    reason: ConflictReason,
    workspaceId: string,
    versions: CurrentVersions,
): DataCommitResult {
    const entityVersion = Object.freeze({
        kind: 'backup-configuration' as const,
        id: workspaceId,
        version: versions.protectionVersion.toString(),
    });
    const problem = Object.freeze({
        code: 'conflict' as const,
        scope: 'operation' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezeTuple(['workspace.write' as const]),
        allowedActions: freezeTuple(['requery' as const]),
        context: Object.freeze({
            revision: versions.revision.toString(),
            entityVersions: freezeTuple([entityVersion]),
        }),
        details: Object.freeze({ reason }),
    });
    return Object.freeze({ ok: false as const, problem });
}

/**
 * Builds a conflict problem carrying the authoritative Meeting series version.
 * @param {ConflictReason} reason - Stable conflict reason.
 * @param {CurrentVersions} versions - Current Workspace and PLAN versions.
 * @param {string} meetingSeriesId - Conflicted Meeting series identity.
 * @param {bigint} meetingSeriesVersion - Current Meeting series version.
 * @return {DataCommitResult} Unchanged conflict result.
 */
function meetingSeriesConflictResult(
    reason: ConflictReason,
    versions: CurrentVersions,
    meetingSeriesId: string,
    meetingSeriesVersion: bigint,
): DataCommitResult {
    const entityVersion = Object.freeze({
        kind: 'meeting-series' as const,
        id: meetingSeriesId,
        version: meetingSeriesVersion.toString(),
    });
    const problem = Object.freeze({
        code: 'conflict' as const,
        scope: 'operation' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezeTuple(['workspace.write' as const]),
        allowedActions: freezeTuple(['requery' as const]),
        context: Object.freeze({
            revision: versions.revision.toString(),
            entityVersions: freezeTuple([entityVersion]),
        }),
        details: Object.freeze({ reason }),
    });
    return Object.freeze({ ok: false as const, problem });
}

/**
 * Builds a stale-version conflict carrying the authoritative HolidayRange revision.
 * @param {CurrentVersions} versions - Current Workspace and PLAN versions.
 * @param {string} holidayRangeId - Conflicted HolidayRange identity.
 * @param {bigint} holidayRangeVersion - Current HolidayRange entity version.
 * @return {DataCommitResult} Unchanged conflict result.
 */
function holidayRangeConflictResult(
    versions: CurrentVersions,
    holidayRangeId: string,
    holidayRangeVersion: bigint,
): DataCommitResult {
    const entityVersion = Object.freeze({
        kind: 'holiday-range' as const,
        id: holidayRangeId,
        version: holidayRangeVersion.toString(),
    });
    const problem = Object.freeze({
        code: 'conflict' as const,
        scope: 'operation' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezeTuple(['workspace.write' as const]),
        allowedActions: freezeTuple(['requery' as const]),
        context: Object.freeze({
            revision: versions.revision.toString(),
            entityVersions: freezeTuple([entityVersion]),
        }),
        details: Object.freeze({ reason: 'expected-entity-version' as const }),
    });
    return Object.freeze({ ok: false as const, problem });
}

function taskSeriesConflictResult(
    versions: CurrentVersions,
    taskSeriesId: string,
    taskSeriesVersion: bigint,
): DataCommitResult {
    const entityVersion = Object.freeze({
        kind: 'task-series' as const,
        id: taskSeriesId,
        version: taskSeriesVersion.toString(),
    });
    const problem = Object.freeze({
        code: 'conflict' as const,
        scope: 'operation' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezeTuple(['workspace.write' as const]),
        allowedActions: freezeTuple(['requery' as const]),
        context: Object.freeze({
            revision: versions.revision.toString(),
            entityVersions: freezeTuple([entityVersion]),
        }),
        details: Object.freeze({ reason: 'expected-entity-version' as const }),
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

/**
 * Reports the authoritative draft-stream version after an optimistic conflict.
 * @param {string} workspaceId - Stable Workspace identity.
 * @param {bigint} revision - Unchanged formal Workspace revision.
 * @param {bigint} draftVersion - Current setup draft version.
 * @return {SetupDraftCheckpointWriteResult} Unchanged conflict result.
 */
function setupDraftConflictResult(
    workspaceId: string,
    revision: bigint,
    draftVersion: bigint,
): SetupDraftCheckpointWriteResult {
    const problem = Object.freeze({
        code: 'conflict' as const,
        scope: 'operation' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezeTuple(['workspace.write' as const]),
        allowedActions: freezeTuple(['requery' as const]),
        context: Object.freeze({
            revision: revision.toString(),
            entityVersions: freezeTuple([Object.freeze({
                kind: 'workspace-setup' as const,
                id: workspaceId,
                version: draftVersion.toString(),
            })]),
        }),
        details: Object.freeze({ reason: 'expected-entity-version' as const }),
    });
    return Object.freeze({ ok: false as const, problem });
}

/**
 * Reports a saturated Workspace write queue without changing the draft.
 * @param {bigint} revision - Unchanged formal Workspace revision.
 * @return {SetupDraftCheckpointWriteResult} Retryable unchanged result.
 */
function setupDraftWriterBusyResult(revision: bigint): SetupDraftCheckpointWriteResult {
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

/**
 * Reports that the open Workspace mode cannot persist a setup draft.
 * @param {bigint} revision - Unchanged formal Workspace revision.
 * @return {SetupDraftCheckpointWriteResult} Permission result.
 */
function setupDraftPermissionResult(revision: bigint): SetupDraftCheckpointWriteResult {
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

/**
 * Builds an unchanged result requiring a fresh whole-rule impact preview.
 * @param {bigint} revision - Current Workspace revision.
 * @return {DataCommitResult} Decision-required result.
 */
function decisionRequiredResult(revision: bigint): DataCommitResult {
    const problem = Object.freeze({
        code: 'decision-required' as const,
        scope: 'operation' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezeTuple(['workspace.write' as const]),
        allowedActions: freezeTuple(['preview' as const]),
        context: Object.freeze({ revision: revision.toString() }),
        details: Object.freeze({ reason: 'impact-confirmation-required' as const }),
    });
    return Object.freeze({ ok: false as const, problem });
}

/**
 * Builds an unchanged warning result that can be explicitly continued.
 * @param {bigint} revision - Current Workspace revision.
 * @param {readonly MeetingOverlapWarning[]} warnings - Exact overlapping occurrences and windows.
 * @return {DataCommitResult} Non-blocking overlap decision result.
 */
function meetingOverlapDecisionRequiredResult(
    revision: bigint,
    warnings: readonly MeetingOverlapWarning[],
): DataCommitResult {
    const problem = Object.freeze({
        code: 'decision-required' as const,
        scope: 'operation' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezeTuple(['workspace.write' as const]),
        allowedActions: freezeTuple(['continue' as const]),
        context: Object.freeze({ revision: revision.toString() }),
        details: Object.freeze({
            reason: 'meeting-time-overlap' as const,
            warnings: Object.freeze([...warnings]),
        }),
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
    private readonly queue: StoreWriteWork[] = [];
    private postCommitHint: (() => void) | undefined;
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

    /**
     * Installs the lossy PostCommit wake hint used by the Workspace backup coordinator.
     * @param {(() => void) | null} hint - Current process callback, or null to detach it.
     * @return {void}
     */
    public setPostCommitHint(hint: (() => void) | null): void {
        this.requireOpen();
        this.postCommitHint = hint ?? undefined;
    }

    /**
     * Drains the synchronous owner boundary and proves WAL state before an activation close.
     * @param {(point: RestoreActivationCloseFailpoint) => void} failpoint - Phase failure injection.
     * @return {void}
     */
    public prepareForRestoreActivation(
        failpoint?: (point: RestoreActivationCloseFailpoint) => void,
    ): void {
        this.requireBackupMutationAllowed();
        if (this.running || this.queue.length !== 0 || this.database.isTransaction) {
            throw new Error('Restore activation cannot drain DATA');
        }
        this.postCommitHint = undefined;
        failpoint?.('activation-close.before-wal-checkpoint');
        const checkpoint = this.database.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as {
            busy: number;
            log: number;
            checkpointed: number;
        };
        if (checkpoint.busy !== 0 || checkpoint.log !== checkpoint.checkpointed) {
            throw new Error('Restore activation WAL checkpoint failed');
        }
        failpoint?.('activation-close.after-wal-checkpoint');
    }

    public readSetupProjection(options: ReadSnapshotOptions = {}): SetupProjection {
        this.requireOpen();
        try {
            this.database.exec('BEGIN');
            const state = this.database.prepare(`
                SELECT
                    workspace_state.revision,
                    plan_state.current_term_id,
                    plan_state.plan_entity_version,
                    setup_state.ever_reached_minimum,
                    setup_draft_checkpoint.checkpoint_version,
                    setup_draft_checkpoint.schema_version,
                    setup_draft_checkpoint.updated_at,
                    setup_draft_checkpoint.opaque_payload
                FROM workspace_state
                JOIN plan_state ON plan_state.singleton = workspace_state.singleton
                JOIN setup_state ON setup_state.singleton = workspace_state.singleton
                JOIN setup_draft_checkpoint
                    ON setup_draft_checkpoint.singleton = workspace_state.singleton
                WHERE workspace_state.singleton = 1
            `);
            state.setReadBigInts(true);
            const stateRow = state.get() as {
                revision: bigint;
                current_term_id: string | null;
                plan_entity_version: bigint;
                ever_reached_minimum: bigint;
                checkpoint_version: bigint;
                schema_version: bigint | null;
                updated_at: string | null;
                opaque_payload: string | null;
            };
            options.failpoint?.('read.after-revision');

            const termsStatement = this.database.prepare(`
                SELECT term_id, name, start_date, end_date, time_zone, archived, entity_version
                FROM terms
                ORDER BY start_date, term_id
            `);
            termsStatement.setReadBigInts(true);
            const termRows = termsStatement.all() as Array<{
                term_id: string;
                name: string;
                start_date: string;
                end_date: string;
                time_zone: string;
                archived: bigint;
                entity_version: bigint;
            }>;
            const terms = Object.freeze(termRows.map((row) => Object.freeze({
                termId: row.term_id,
                name: row.name,
                startDate: row.start_date,
                endDate: row.end_date,
                timeZone: row.time_zone,
                archived: row.archived === 1n,
                entityVersion: row.entity_version.toString(),
            })));
            const currentTerm = stateRow.current_term_id === null
                ? null
                : terms.find((term) => term.termId === stateRow.current_term_id) ?? null;
            if (stateRow.current_term_id !== null && currentTerm === null) {
                throw new Error('Current Term is missing');
            }

            const holidayStatement = this.database.prepare(`
                SELECT holiday_range_id, term_id, name, start_date, end_date, entity_version
                FROM holiday_ranges
                WHERE tombstoned = 0
                ORDER BY term_id, start_date, holiday_range_id
            `);
            holidayStatement.setReadBigInts(true);
            const holidayRows = holidayStatement.all() as Array<{
                holiday_range_id: string;
                term_id: string;
                name: string;
                start_date: string;
                end_date: string;
                entity_version: bigint;
            }>;
            const holidayRanges = Object.freeze(holidayRows.map(row => Object.freeze({
                holidayRangeId: row.holiday_range_id,
                termId: row.term_id,
                name: row.name,
                startDate: row.start_date,
                endDate: row.end_date,
                entityVersion: row.entity_version.toString(),
            })));

            const courseStatement = this.database.prepare(`
                SELECT
                    courses.course_id,
                    courses.term_id,
                    courses.code,
                    courses.name,
                    courses.section,
                    courses.instructor,
                    courses.color,
                    courses.credits_coefficient,
                    courses.credits_scale,
                    courses.teaching_range_kind,
                    courses.teaching_start_date,
                    courses.teaching_end_date,
                    courses.archived,
                    terms.start_date AS term_start_date,
                    terms.end_date AS term_end_date,
                    courses.entity_version
                FROM courses
                JOIN terms ON terms.term_id = courses.term_id
                ORDER BY code, course_id
            `);
            courseStatement.setReadBigInts(true);
            const courseRows = courseStatement.all() as Array<{
                    course_id: string;
                    term_id: string;
                    code: string;
                    name: string;
                    section: string | null;
                    instructor: string | null;
                    color: CourseColor | null;
                    credits_coefficient: bigint | null;
                    credits_scale: bigint | null;
                    teaching_range_kind: CourseTeachingRangeIntent['kind'];
                    teaching_start_date: string | null;
                    teaching_end_date: string | null;
                    archived: bigint;
                    term_start_date: string;
                    term_end_date: string;
                    entity_version: bigint;
                }>;
            const meetingStatement = this.database.prepare(`
                SELECT
                    meeting_series.meeting_series_id,
                    meeting_series.course_id,
                    meeting_series.entity_version,
                    meeting_segments.meeting_segment_id,
                    meeting_segments.logical_start_anchor,
                    meeting_segments.meeting_type,
                    meeting_segments.weekday,
                    meeting_segments.local_start,
                    meeting_segments.local_end,
                    meeting_segments.end_day_offset,
                    meeting_segments.effective_range_kind,
                    meeting_segments.effective_start_date,
                    meeting_segments.effective_end_date,
                    meeting_segments.location_kind,
                    meeting_segments.location_value
                FROM meeting_series
                JOIN meeting_segments
                    ON meeting_segments.meeting_series_id = meeting_series.meeting_series_id
                WHERE meeting_series.retired = 0
                ORDER BY
                    meeting_series.course_id,
                    meeting_series.meeting_series_id,
                    meeting_segments.logical_start_anchor,
                    meeting_segments.meeting_segment_id
            `);
            meetingStatement.setReadBigInts(true);
            const meetingRows = meetingStatement.all() as Array<{
                    meeting_series_id: string;
                    course_id: string;
                    entity_version: bigint;
                    meeting_segment_id: string;
                    logical_start_anchor: string | null;
                    meeting_type: MeetingTypeCode;
                    weekday: MeetingWeekday;
                    local_start: string;
                    local_end: string;
                    end_day_offset: bigint;
                    effective_range_kind: MeetingEffectiveRangeIntent['kind'];
                    effective_start_date: string | null;
                    effective_end_date: string | null;
                    location_kind: 'known' | 'tba';
                    location_value: string | null;
                }>;
            const latestMeetingRows = Array.from(meetingRows.reduce((latest, meeting) => {
                latest.set(meeting.meeting_series_id, meeting);
                return latest;
            }, new Map<string, typeof meetingRows[number]>()).values());
            const courses = Object.freeze(courseRows.map((course) => {
                const teachingStartDate = course.teaching_range_kind === 'inherit-term'
                    ? course.term_start_date
                    : course.teaching_start_date!;
                const teachingEndDate = course.teaching_range_kind === 'inherit-term'
                    ? course.term_end_date
                    : course.teaching_end_date!;
                return Object.freeze({
                    courseId: course.course_id,
                    termId: course.term_id,
                    code: course.code,
                    name: course.name,
                    section: course.section,
                    instructor: course.instructor,
                    color: course.color,
                    credits: course.credits_coefficient === null || course.credits_scale === null
                        ? null
                        : decimalFromCoefficient(course.credits_coefficient, course.credits_scale),
                    teachingRange: Object.freeze({
                        kind: course.teaching_range_kind,
                        startDate: teachingStartDate,
                        endDate: teachingEndDate,
                    }),
                    archived: course.archived === 1n,
                    entityVersion: course.entity_version.toString(),
                    meetings: Object.freeze(latestMeetingRows
                        .filter(meeting => meeting.course_id === course.course_id)
                        .map(meeting => Object.freeze({
                            meetingSeriesId: meeting.meeting_series_id,
                            type: Object.freeze({
                                code: meeting.meeting_type,
                                name: meetingTypeName(meeting.meeting_type),
                            }),
                            weekday: meeting.weekday,
                            localStart: meeting.local_start,
                            localEnd: meeting.local_end,
                            endDayOffset: Number(meeting.end_day_offset) as MeetingEndDayOffset,
                            effectiveRange: Object.freeze({
                                kind: meeting.effective_range_kind,
                                startDate: meeting.effective_range_kind === 'inherit-course'
                                    ? teachingStartDate
                                    : meeting.effective_start_date!,
                                endDate: meeting.effective_range_kind === 'inherit-course'
                                    ? teachingEndDate
                                    : meeting.effective_end_date!,
                            }),
                            location: meeting.location_kind === 'tba'
                                ? Object.freeze({ kind: 'tba' as const })
                                : Object.freeze({
                                    kind: 'known' as const,
                                    value: meeting.location_value!,
                                }),
                            entityVersion: meeting.entity_version.toString(),
                        }))),
                });
            }));

            const taskStatement = this.database.prepare(`
                SELECT
                    task_series.task_series_id,
                    task_series.course_id,
                    task_series.entity_version,
                    task_segments.title,
                    task_segments.task_size,
                    task_segments.schedule_kind,
                    task_segments.deadline_kind,
                    task_segments.deadline_date,
                    task_segments.deadline_instant,
                    task_segments.deadline_display_zone,
                    task_segments.weekly_start_date,
                    task_segments.weekly_weekday,
                    task_segments.weekly_local_deadline_time,
                    task_segments.weekly_confirmed_end_date,
                    task_segments.follow_teaching_week,
                    task_segments.logical_start_anchor,
                    task_occurrence_states.status,
                    task_occurrence_states.self_reported_progress,
                    task_occurrence_overrides.override_kind,
                    task_occurrence_overrides.replacement_title,
                    task_occurrence_overrides.replacement_task_size,
                    task_occurrence_overrides.replacement_deadline_kind,
                    task_occurrence_overrides.replacement_deadline_date,
                    task_occurrence_overrides.replacement_deadline_instant,
                    task_occurrence_overrides.replacement_deadline_display_zone
                FROM task_series
                JOIN task_segments ON task_segments.task_series_id = task_series.task_series_id
                LEFT JOIN task_occurrence_states
                    ON task_occurrence_states.task_series_id = task_series.task_series_id
                    AND task_occurrence_states.original_logical_anchor = 'once'
                LEFT JOIN task_occurrence_overrides
                    ON task_occurrence_overrides.task_series_id = task_series.task_series_id
                    AND task_occurrence_overrides.original_logical_anchor = 'once'
                WHERE task_series.retired = 0
                ORDER BY
                    task_series.course_id,
                    task_series.task_series_id,
                    task_segments.logical_start_anchor,
                    task_segments.task_segment_id
            `);
            taskStatement.setReadBigInts(true);
            const taskRows = taskStatement.all() as Array<{
                task_series_id: string;
                course_id: string;
                entity_version: bigint;
                title: string;
                task_size: TaskSize;
                logical_start_anchor: string;
                status: TaskOccurrenceStatus | null;
                self_reported_progress: bigint | null;
                override_kind: 'replaced' | 'deleted' | null;
                replacement_title: string | null;
                replacement_task_size: TaskSize | null;
                replacement_deadline_kind: TaskDeadline['kind'] | null;
                replacement_deadline_date: string | null;
                replacement_deadline_instant: string | null;
                replacement_deadline_display_zone: string | null;
            } & StoredTaskSchedule>;
            const latestTaskRows = Array.from(taskRows.reduce((latest, task) => {
                latest.set(task.task_series_id, task);
                return latest;
            }, new Map<string, typeof taskRows[number]>()).values());
            const tasks = Object.freeze(latestTaskRows.filter(row => (
                row.schedule_kind === 'weekly' || row.override_kind !== 'deleted'
            )).map(row => {
                const override = row.override_kind === 'replaced'
                    ? taskOverrideReplacement({ ...row, override_kind: 'replaced' })
                    : null;
                const common = {
                    taskSeriesId: row.task_series_id,
                    courseId: row.course_id,
                    title: override?.title ?? row.title,
                    size: override?.size ?? row.task_size,
                    entityVersion: row.entity_version.toString(),
                };
                const schedule = taskScheduleProjection(row);
                const state = taskOccurrenceStateProjection(
                    row.status === null
                        ? undefined
                        : {
                            original_logical_anchor: 'once',
                            status: row.status,
                            self_reported_progress: row.self_reported_progress,
                            entity_version: 1n,
                        },
                    common.size,
                );
                return schedule.kind === 'weekly'
                    ? Object.freeze({ ...common, schedule })
                    : Object.freeze({
                        ...common,
                        deadline: override?.deadline ?? schedule.deadline,
                        occurrenceId: deriveTaskOccurrenceId(row.task_series_id),
                        ...state,
                        overrideKind: override ? 'replaced' as const : 'none' as const,
                    });
            }));
            this.database.exec('COMMIT');

            const currentTermCourses = currentTerm === null
                ? []
                : courses.filter(course => course.termId === currentTerm.termId && !course.archived);
            const hasCurrentTerm = currentTerm !== null;
            const hasCurrentTermCourse = currentTermCourses.length > 0;
            const hasMeetingOrTask = currentTermCourses.some(course => course.meetings.length > 0
                || tasks.some(task => task.courseId === course.courseId));
            const minimum = Object.freeze({
                hasCurrentTerm,
                hasCurrentTermCourse,
                hasMeetingOrTask,
                isSatisfied: hasCurrentTerm && hasCurrentTermCourse && hasMeetingOrTask,
            });
            const draftCheckpoint = stateRow.schema_version === null
                ? null
                : Object.freeze({
                    draftId: 'first-setup' as const,
                    kind: 'first-setup' as const,
                    scope: 'setup-step' as const,
                    schemaVersion: Number(stateRow.schema_version) as SetupDraftCheckpoint['schemaVersion'],
                    updatedAt: stateRow.updated_at!,
                    opaquePayload: stateRow.opaque_payload!,
                });

            return Object.freeze({
                workspaceRevision: stateRow.revision.toString(),
                planEntityVersion: stateRow.plan_entity_version.toString(),
                minimum,
                everReachedMinimum: stateRow.ever_reached_minimum === 1n,
                defaultRoute: stateRow.ever_reached_minimum === 1n ? 'today' : 'setup',
                draftCheckpointVersion: stateRow.checkpoint_version.toString(),
                draftCheckpoint,
                currentTerm,
                terms,
                courses,
                holidayRanges,
                tasks,
            });
        }
        catch (error) {
            this.rollbackOrRequireReopen();
            throw error;
        }
    }

    /**
     * Reads all facts required for unified PLAN projections from one snapshot.
     * @param {ReadSnapshotOptions} options - Optional deterministic snapshot seam.
     * @return {PlanProjectionSource} Current-Term facts bound to one revision.
     */
    public readPlanProjectionSource(options: ReadSnapshotOptions = {}): PlanProjectionSource {
        this.requireOpen();
        try {
            this.database.exec('BEGIN');
            const stateStatement = this.database.prepare(`
                SELECT workspace_state.revision, plan_state.current_term_id, plan_state.plan_entity_version
                FROM workspace_state
                JOIN plan_state ON plan_state.singleton = workspace_state.singleton
                WHERE workspace_state.singleton = 1
            `);
            stateStatement.setReadBigInts(true);
            const state = stateStatement.get() as {
                revision: bigint;
                current_term_id: string | null;
                plan_entity_version: bigint;
            };
            options.failpoint?.('read.after-revision');
            if (state.current_term_id === null) {
                throw new TypeError('Current Term does not exist');
            }

            const termStatement = this.database.prepare(`
                SELECT term_id, name, start_date, end_date, time_zone, archived, entity_version
                FROM terms
                WHERE term_id = ?
            `);
            termStatement.setReadBigInts(true);
            const termRow = termStatement.get(state.current_term_id) as {
                term_id: string;
                name: string;
                start_date: string;
                end_date: string;
                time_zone: string;
                archived: bigint;
                entity_version: bigint;
            } | undefined;
            if (!termRow) {
                throw new Error('Current Term reference does not resolve');
            }
            const term: TermProjection = Object.freeze({
                termId: termRow.term_id,
                name: termRow.name,
                startDate: termRow.start_date,
                endDate: termRow.end_date,
                timeZone: termRow.time_zone,
                archived: termRow.archived === 1n,
                entityVersion: termRow.entity_version.toString(),
            });
            const requestedWindows = planOccurrenceWindows(term.startDate, term.endDate);

            const taskSeriesRows = this.database.prepare(`
                SELECT task_series.task_series_id, courses.course_id, courses.code
                FROM task_series
                JOIN courses ON courses.course_id = task_series.course_id
                WHERE courses.term_id = ? AND courses.archived = 0 AND task_series.retired = 0
                ORDER BY courses.course_id, task_series.task_series_id
            `).all(term.termId) as Array<{
                task_series_id: string;
                course_id: string;
                code: string;
            }>;
            const taskSources: PlanTaskSource[] = [];
            const seenTaskOccurrences = new Set<string>();
            for (const row of taskSeriesRows) {
                for (const requestedWindow of requestedWindows) {
                    const detail = this.readTaskSeriesDetail(row.task_series_id, requestedWindow);
                    for (const occurrence of detail.occurrences) {
                        const identity = `${occurrence.occurrenceId.taskSeriesId}\u0000`
                            + occurrence.occurrenceId.originalLogicalAnchor;
                        if (!seenTaskOccurrences.has(identity)) {
                            seenTaskOccurrences.add(identity);
                            taskSources.push(Object.freeze({
                                courseId: row.course_id,
                                courseCode: row.code,
                                occurrence,
                            }));
                        }
                    }
                }
            }

            const meetingSeriesRows = this.database.prepare(`
                SELECT meeting_series.meeting_series_id, courses.course_id, courses.code
                FROM meeting_series
                JOIN courses ON courses.course_id = meeting_series.course_id
                WHERE courses.term_id = ? AND courses.archived = 0 AND meeting_series.retired = 0
                ORDER BY courses.course_id, meeting_series.meeting_series_id
            `).all(term.termId) as Array<{
                meeting_series_id: string;
                course_id: string;
                code: string;
            }>;
            const meetingSources: PlanMeetingSource[] = [];
            const seenMeetingOccurrences = new Set<string>();
            for (const row of meetingSeriesRows) {
                for (const requestedWindow of requestedWindows) {
                    const detail = this.readMeetingSeriesDetail(row.meeting_series_id, requestedWindow);
                    for (const occurrence of detail.occurrences) {
                        const identity = `${occurrence.occurrenceId.meetingSeriesId}\u0000`
                            + occurrence.occurrenceId.originalLogicalAnchor;
                        if (!seenMeetingOccurrences.has(identity)) {
                            seenMeetingOccurrences.add(identity);
                            meetingSources.push(Object.freeze({
                                courseId: row.course_id,
                                courseCode: row.code,
                                occurrence,
                            }));
                        }
                    }
                }
            }

            const holidayStatement = this.database.prepare(`
                SELECT holiday_range_id, name, start_date, end_date, entity_version
                FROM holiday_ranges
                WHERE term_id = ? AND tombstoned = 0
                ORDER BY start_date, holiday_range_id
            `);
            holidayStatement.setReadBigInts(true);
            const holidayRows = holidayStatement.all(term.termId) as Array<{
                holiday_range_id: string;
                name: string;
                start_date: string;
                end_date: string;
                entity_version: bigint;
            }>;
            const holidayRanges: readonly HolidayRangeProjection[] = Object.freeze(
                holidayRows.map(row => Object.freeze({
                    holidayRangeId: row.holiday_range_id,
                    termId: term.termId,
                    name: row.name,
                    startDate: row.start_date,
                    endDate: row.end_date,
                    entityVersion: row.entity_version.toString(),
                })),
            );
            this.database.exec('COMMIT');
            return Object.freeze({
                workspaceRevision: state.revision.toString(),
                planEntityVersion: state.plan_entity_version.toString(),
                term,
                taskSources: Object.freeze(taskSources),
                meetingSources: Object.freeze(meetingSources),
                holidayRanges,
            });
        }
        catch (error) {
            this.rollbackOrRequireReopen();
            throw error;
        }
    }

    /**
     * Reads active named ranges for deterministic Meeting suppression inside the current snapshot.
     * @param {string} termId - Owning Term identity.
     * @return {readonly StoredHolidayRange[]} Inclusive active ranges in deterministic order.
     */
    private readActiveHolidayRanges(termId: string): readonly StoredHolidayRange[] {
        return this.database.prepare(`
            SELECT holiday_range_id, start_date, end_date
            FROM holiday_ranges
            WHERE term_id = ? AND tombstoned = 0
            ORDER BY start_date, holiday_range_id
        `).all(termId) as StoredHolidayRange[];
    }

    /**
     * Reads one bounded Task series projection without storing ordinary weekly occurrences.
     * @param {string} taskSeriesId - Stable Task series identity.
     * @param {TaskOccurrenceWindow} candidateWindow - Requested inclusive LocalDate window.
     * @return {TaskSeriesDetailProjection} Revision-bound Task rule and derived occurrences.
     */
    public readTaskSeriesDetail(
        taskSeriesId: string,
        candidateWindow: TaskOccurrenceWindow,
    ): TaskSeriesDetailProjection {
        this.requireOpen();
        if (!isCanonicalUuid(taskSeriesId)) {
            throw new TypeError('TaskSeriesId must be a canonical UUID');
        }
        const requestedWindow = normalizeTaskOccurrenceWindow(candidateWindow);

        try {
            this.database.exec('SAVEPOINT read_task_series_detail');
            const seriesStatement = this.database.prepare(`
                SELECT
                    task_series.course_id,
                    task_series.entity_version,
                    terms.term_id,
                    terms.time_zone,
                    workspace_state.revision,
                    plan_state.plan_entity_version
                FROM task_series
                JOIN courses ON courses.course_id = task_series.course_id
                JOIN terms ON terms.term_id = courses.term_id
                JOIN workspace_state ON workspace_state.singleton = 1
                JOIN plan_state ON plan_state.singleton = workspace_state.singleton
                WHERE task_series.task_series_id = ? AND task_series.retired = 0
            `);
            seriesStatement.setReadBigInts(true);
            const series = seriesStatement.get(taskSeriesId) as {
                course_id: string;
                entity_version: bigint;
                term_id: string;
                time_zone: string;
                revision: bigint;
                plan_entity_version: bigint;
            } | undefined;
            if (!series) {
                throw new TypeError('Task series does not exist');
            }

            const segmentStatement = this.database.prepare(`
                SELECT
                    task_segment_id,
                    title,
                    task_size,
                    schedule_kind,
                    deadline_kind,
                    deadline_date,
                    deadline_instant,
                    deadline_display_zone,
                    logical_start_anchor,
                    logical_end_anchor,
                    weekly_start_date,
                    weekly_weekday,
                    weekly_local_deadline_time,
                    weekly_confirmed_end_date,
                    follow_teaching_week
                FROM task_segments
                WHERE task_series_id = ?
                ORDER BY logical_start_anchor, task_segment_id
            `);
            segmentStatement.setReadBigInts(true);
            const segmentRows = segmentStatement.all(taskSeriesId) as StoredTaskSegment[];
            const latestSegment = segmentRows.at(-1);
            if (!latestSegment) {
                throw new Error('Task series has no segment');
            }
            const overrideStatement = this.database.prepare(`
                SELECT
                    original_logical_anchor,
                    override_kind,
                    replacement_title,
                    replacement_task_size,
                    replacement_deadline_kind,
                    replacement_deadline_date,
                    replacement_deadline_instant,
                    replacement_deadline_display_zone,
                    entity_version
                FROM task_occurrence_overrides
                WHERE task_series_id = ?
                ORDER BY original_logical_anchor
            `);
            overrideStatement.setReadBigInts(true);
            const overrideRows = overrideStatement.all(taskSeriesId) as StoredTaskOccurrenceOverride[];
            const stateStatement = this.database.prepare(`
                SELECT
                    original_logical_anchor,
                    status,
                    self_reported_progress,
                    entity_version
                FROM task_occurrence_states
                WHERE task_series_id = ?
                ORDER BY original_logical_anchor
            `);
            stateStatement.setReadBigInts(true);
            const stateRows = stateStatement.all(taskSeriesId) as StoredTaskOccurrenceState[];
            const schedule = taskScheduleProjection(latestSegment);
            const projectionBase = {
                workspaceRevision: series.revision.toString(),
                planEntityVersion: series.plan_entity_version.toString(),
                requestedWindow,
                termZone: series.time_zone,
                taskSeriesId,
                courseId: series.course_id,
                title: latestSegment.title,
                size: latestSegment.task_size,
                entityVersion: series.entity_version.toString(),
            } as const;
            const segments = Object.freeze(segmentRows.map(segment => Object.freeze({
                segmentId: segment.task_segment_id,
                logicalStartAnchor: segment.logical_start_anchor,
                logicalEndAnchor: segment.logical_end_anchor,
                replacement: segment.schedule_kind === 'once'
                    ? Object.freeze({
                        title: segment.title,
                        size: segment.task_size,
                        deadline: taskDeadlineProjection(
                            segment.deadline_kind!,
                            segment.deadline_date,
                            segment.deadline_instant,
                            segment.deadline_display_zone,
                        ),
                    })
                    : Object.freeze({
                        title: segment.title,
                        size: segment.task_size,
                        weekday: segment.weekly_weekday!,
                        localDeadlineTime: segment.weekly_local_deadline_time!,
                        followTeachingWeek: segment.follow_teaching_week === 1n,
                    }),
            })));
            const overrides = Object.freeze(overrideRows.map(override => (
                override.override_kind === 'deleted'
                    ? Object.freeze({
                        occurrenceId: deriveTaskOccurrenceId(
                            taskSeriesId,
                            override.original_logical_anchor,
                        ),
                        kind: 'deleted' as const,
                    })
                    : Object.freeze({
                        occurrenceId: deriveTaskOccurrenceId(
                            taskSeriesId,
                            override.original_logical_anchor,
                        ),
                        kind: 'replaced' as const,
                        replacement: taskOverrideReplacement(override),
                    })
            )));
            const historicalStates = Object.freeze(stateRows.map(state => {
                const segment = taskSegmentForAnchor(segmentRows, state.original_logical_anchor);
                const override = overrideRows.find(candidate => (
                    candidate.original_logical_anchor === state.original_logical_anchor
                ));
                const replacement = override?.override_kind === 'replaced'
                    ? taskOverrideReplacement(override)
                    : segment
                        ? Object.freeze({
                            title: segment.title,
                            size: segment.task_size,
                            deadline: taskSegmentOccurrenceDeadline(
                                segment,
                                state.original_logical_anchor,
                                series.time_zone,
                            ),
                        })
                        : null;
                if (!replacement) {
                    throw new Error('Task occurrence history has no retained facts');
                }
                return Object.freeze({
                    occurrenceId: deriveTaskOccurrenceId(taskSeriesId, state.original_logical_anchor),
                    ...taskOccurrenceStateProjection(state, replacement.size),
                    ...replacement,
                });
            }));
            let projection: TaskSeriesDetailProjection;
            if (schedule.kind === 'once') {
                const segment = segmentRows[0]!;
                const override = overrideRows.find(candidate => candidate.original_logical_anchor === 'once');
                const occurrences: OnceTaskOccurrenceProjection[] = [];
                if (override?.override_kind !== 'deleted') {
                    const replacement = override
                        ? taskOverrideReplacement(override)
                        : Object.freeze({
                            title: segment.title,
                            size: segment.task_size,
                            deadline: schedule.deadline,
                        });
                    occurrences.push(Object.freeze({
                        occurrenceId: deriveTaskOccurrenceId(taskSeriesId),
                        ...replacement,
                        segmentId: segment.task_segment_id,
                        ...taskOccurrenceStateProjection(stateRows[0], replacement.size),
                        overrideKind: override ? 'replaced' as const : 'none' as const,
                    }));
                }
                projection = Object.freeze({
                    ...projectionBase,
                    schedule,
                    segments,
                    overrides,
                    historicalStates,
                    occurrences: Object.freeze(occurrences),
                });
            }
            else {
                const occurrences: WeeklyTaskOccurrenceProjection[] = [];
                const holidayRanges = this.readActiveHolidayRanges(series.term_id);
                for (const segment of segmentRows) {
                    let anchor = segment.logical_start_anchor;
                    while (anchor <= segment.logical_end_anchor) {
                        const date = occurrenceDate(anchor, segment.weekly_weekday!);
                        if (date === null) {
                            throw new Error('Task occurrence date is outside the LocalDate domain');
                        }
                        const isHoliday = segment.follow_teaching_week === 1n
                            && holidayRanges.some(range => date >= range.start_date && date <= range.end_date);
                        const override = overrideRows.find(candidate => (
                            candidate.original_logical_anchor === anchor
                        ));
                        if (date >= requestedWindow.startDate
                            && date <= requestedWindow.endDate
                            && (!isHoliday || override?.override_kind === 'replaced')
                            && override?.override_kind !== 'deleted') {
                            const replacement = override
                                ? taskOverrideReplacement(override)
                                : Object.freeze({
                                    title: segment.title,
                                    size: segment.task_size,
                                    deadline: taskSegmentOccurrenceDeadline(segment, anchor, series.time_zone),
                                });
                            const state = stateRows.find(candidate => candidate.original_logical_anchor === anchor);
                            occurrences.push(Object.freeze({
                                occurrenceId: deriveTaskOccurrenceId(taskSeriesId, anchor),
                                ...replacement,
                                segmentId: segment.task_segment_id,
                                ...taskOccurrenceStateProjection(state, replacement.size),
                                overrideKind: override ? 'replaced' as const : 'none' as const,
                            }));
                        }
                        if (anchor > '9999-12-24') {
                            break;
                        }
                        anchor = addLocalDateDays(anchor, 7);
                    }
                }
                projection = Object.freeze({
                    ...projectionBase,
                    schedule,
                    segments,
                    overrides,
                    historicalStates,
                    occurrences: Object.freeze(occurrences),
                });
            }
            this.database.exec('RELEASE SAVEPOINT read_task_series_detail');
            return projection;
        }
        catch (error) {
            this.rollbackOrRequireReopen();
            throw error;
        }
    }

    /**
     * Previews and version-binds a Task this-and-future rule change or deletion without writing.
     * @param {TaskOccurrenceImpactDraft} candidate - Untrusted exact future mutation draft.
     * @return {TaskOccurrenceImpactProjection} Current and proposed bounded occurrence facts.
     */
    public previewTaskOccurrenceChange(
        candidate: TaskOccurrenceImpactDraft,
    ): TaskOccurrenceImpactProjection {
        this.requireOpen();
        const draft = normalizeTaskOccurrenceImpactDraft(candidate);
        const detail = this.readTaskSeriesDetail(draft.taskSeriesId, draft.requestedWindow);
        if (draft.scope === 'this-and-future' && detail.schedule.kind !== 'weekly') {
            throw new TypeError('This-and-future scope requires a weekly Task series');
        }
        const originalLogicalAnchor = draft.scope === 'whole-series'
            ? null
            : draft.originalLogicalAnchor;
        const target = originalLogicalAnchor === null
            ? null
            : detail.occurrences.find(occurrence => (
                occurrence.occurrenceId.originalLogicalAnchor === originalLogicalAnchor
            ));
        if (originalLogicalAnchor !== null && !target) {
            throw new TypeError('Task occurrence impact target is outside the requested window');
        }
        if (draft.scope === 'only-this' && target!.status !== 'pending') {
            throw new TypeError('Terminal Task occurrence history is not deletable as only-this');
        }

        try {
            this.database.exec('BEGIN');
            const versions = this.currentVersions();
            const seriesStatement = this.database.prepare(`
                SELECT
                    task_series.entity_version,
                    task_series.retired,
                    terms.term_id,
                    terms.time_zone
                FROM task_series
                JOIN courses ON courses.course_id = task_series.course_id
                JOIN terms ON terms.term_id = courses.term_id
                WHERE task_series.task_series_id = ?
            `);
            seriesStatement.setReadBigInts(true);
            const series = seriesStatement.get(draft.taskSeriesId) as {
                entity_version: bigint;
                retired: bigint;
                term_id: string;
                time_zone: string;
            } | undefined;
            if (!series
                || series.retired !== 0n
                || versions.revision.toString() !== detail.workspaceRevision
                || versions.planVersion.toString() !== detail.planEntityVersion
                || series.entity_version.toString() !== detail.entityVersion) {
                throw new Error('Task impact snapshot changed while it was being prepared');
            }

            const inAffectedScope = (anchor: string): boolean => {
                if (originalLogicalAnchor === null) {
                    return true;
                }
                return draft.scope === 'only-this'
                    ? anchor === originalLogicalAnchor
                    : anchor >= originalLogicalAnchor;
            };
            const affectedSegmentCount = draft.scope === 'whole-series'
                ? detail.segments.length
                : draft.scope === 'only-this'
                    ? 1
                    : detail.segments.filter(segment => (
                        segment.logicalEndAnchor >= originalLogicalAnchor!
                    )).length;
            const futureOverrideCount = detail.overrides.filter(override => (
                inAffectedScope(override.occurrenceId.originalLogicalAnchor)
            )).length;
            const historicalStateCount = detail.historicalStates.filter(state => (
                inAffectedScope(state.occurrenceId.originalLogicalAnchor)
                && state.status !== 'pending'
            )).length;
            const currentFutureOccurrences = Object.freeze(
                draft.scope === 'whole-series'
                    ? [...detail.occurrences]
                    : draft.scope === 'only-this'
                        ? [target!]
                        : detail.occurrences.filter(occurrence => (
                            occurrence.occurrenceId.originalLogicalAnchor >= originalLogicalAnchor!
                        )),
            );
            const futureOccurrencesAfterChange: Array<Omit<TaskOccurrenceProjection, 'segmentId'>> = [];
            if (draft.action === 'change') {
                const holidayRanges = draft.replacement.followTeachingWeek
                    ? this.readActiveHolidayRanges(series.term_id)
                    : Object.freeze([]);
                const finalAnchor = detail.segments.at(-1)!.logicalEndAnchor;
                let anchor = draft.originalLogicalAnchor;
                while (anchor <= finalAnchor) {
                    const date = occurrenceDate(anchor, draft.replacement.weekday);
                    if (date === null
                        || date < draft.requestedWindow.startDate
                        || date > draft.requestedWindow.endDate
                        || holidayRanges.some(range => date >= range.start_date && date <= range.end_date)) {
                        if (anchor > '9999-12-24') {
                            break;
                        }
                        anchor = addLocalDateDays(anchor, 7);
                        continue;
                    }
                    const state = detail.historicalStates.find(candidate => (
                        candidate.occurrenceId.originalLogicalAnchor === anchor
                    ));
                    const override = detail.overrides.find(candidate => (
                        candidate.occurrenceId.originalLogicalAnchor === anchor
                    ));
                    const retainsExactFacts = state?.status !== undefined && state.status !== 'pending'
                        || (anchor > draft.originalLogicalAnchor && override?.kind === 'replaced');
                    const exactReplacement = state && retainsExactFacts
                        ? Object.freeze({
                            title: state.title,
                            size: state.size,
                            deadline: state.deadline,
                        })
                        : override?.kind === 'replaced' && retainsExactFacts
                            ? override.replacement
                            : null;
                    const effectiveSize = exactReplacement?.size ?? draft.replacement.size;
                    const status = state?.status ?? 'pending';
                    const reportedProgress = effectiveSize === 'large'
                        ? state?.reportedProgress ?? null
                        : null;
                    futureOccurrencesAfterChange.push(Object.freeze({
                        occurrenceId: deriveTaskOccurrenceId(draft.taskSeriesId, anchor),
                        title: exactReplacement?.title ?? draft.replacement.title,
                        size: effectiveSize,
                        deadline: exactReplacement?.deadline ?? Object.freeze({
                            kind: 'timed' as const,
                            instant: INTL_ZONE_RULES.resolveInstant(
                                series.time_zone,
                                date,
                                draft.replacement.localDeadlineTime,
                            ),
                            timeZone: series.time_zone,
                        }),
                        status,
                        reportedProgress,
                        displayProgress: effectiveSize !== 'large'
                            ? null
                            : status === 'completed'
                                ? 100
                                : reportedProgress,
                        overrideKind: retainsExactFacts ? 'replaced' as const : 'none' as const,
                    }));
                    if (anchor > '9999-12-24') {
                        break;
                    }
                    anchor = addLocalDateDays(anchor, 7);
                }
            }
            const confirmationToken = taskOccurrenceConfirmationToken(
                detail.workspaceRevision,
                detail.planEntityVersion,
                detail.entityVersion,
                draft,
            );
            const choiceId = draft.scope === 'only-this'
                ? 'apply-only-this' as const
                : draft.scope === 'whole-series'
                    ? 'delete-whole-series' as const
                    : 'apply-this-and-future' as const;
            const effectCode = draft.action === 'change'
                ? 'plan.task-occurrence-changed' as const
                : draft.scope === 'whole-series'
                    ? 'plan.task-series-deleted' as const
                    : 'plan.task-occurrence-deleted' as const;
            const warnings = [
                ...(historicalStateCount === 0
                    ? []
                    : [Object.freeze({ code: 'terminal-history-retained' as const })]),
                ...(futureOverrideCount === 0
                    ? []
                    : [Object.freeze({ code: 'occurrence-overrides-retained' as const })]),
            ];
            this.database.exec('COMMIT');
            return Object.freeze({
                basedOnRevision: detail.workspaceRevision,
                planEntityVersion: detail.planEntityVersion,
                taskSeriesVersion: detail.entityVersion,
                affectedEntities: freezeTuple([Object.freeze({
                    kind: 'task-series' as const,
                    id: draft.taskSeriesId,
                    version: detail.entityVersion,
                })]),
                effects: freezeTuple([Object.freeze({
                    code: effectCode,
                    scope: draft.scope,
                    originalLogicalAnchor,
                    affectedFutureSegmentCount: affectedSegmentCount.toString(),
                    futureOverrideCount: futureOverrideCount.toString(),
                    historicalStateCount: historicalStateCount.toString(),
                    historicalStateAction: 'retain' as const,
                })]),
                warnings: Object.freeze(warnings),
                choices: freezeTuple([Object.freeze({ id: choiceId })]),
                defaultChoice: Object.freeze({ id: choiceId }),
                recoverability: Object.freeze({
                    kind: 'permanent' as const,
                    reason: draft.action === 'change'
                        ? 'task-rule-change-has-no-undo' as const
                        : 'task-deletion-has-no-undo' as const,
                }),
                unresolvedReferences: freezeEmptyTuple(),
                taskSeriesId: draft.taskSeriesId,
                originalLogicalAnchor,
                scope: draft.scope,
                action: draft.action,
                requestedWindow: draft.requestedWindow,
                affectedFutureSegmentCount: affectedSegmentCount.toString(),
                futureOverrideCount: futureOverrideCount.toString(),
                historicalStateCount: historicalStateCount.toString(),
                currentFutureOccurrences,
                futureOccurrencesAfterChange: Object.freeze(futureOccurrencesAfterChange),
                confirmationToken,
            });
        }
        catch (error) {
            this.rollbackOrRequireReopen();
            throw error;
        }
    }

    /**
     * Reads and expands all retained Meeting occurrences from the caller's active snapshot.
     * @param {MeetingOccurrenceWindow} requestedWindow - Bounded physical start-date window.
     * @param {string} termId - Owning Term whose occurrences can share one schedule.
     * @param {readonly StoredHolidayRange[]} candidateHolidayRanges - Optional proposed active ranges.
     * @return {readonly ConflictMeetingOccurrence[]} Effective scheduled occurrences across PLAN.
     */
    private readConflictMeetingOccurrences(
        requestedWindow: MeetingOccurrenceWindow,
        termId: string,
        candidateHolidayRanges?: readonly StoredHolidayRange[],
    ): readonly ConflictMeetingOccurrence[] {
        const holidayRanges = candidateHolidayRanges ?? this.readActiveHolidayRanges(termId);
        const segmentRows = this.database.prepare(`
            SELECT
                meeting_series.meeting_series_id,
                courses.course_id,
                courses.code AS course_code,
                terms.time_zone AS term_zone,
                meeting_segments.meeting_segment_id,
                meeting_segments.meeting_type,
                meeting_segments.weekday,
                meeting_segments.local_start,
                meeting_segments.local_end,
                meeting_segments.end_day_offset,
                meeting_segments.logical_start_anchor,
                meeting_segments.logical_end_anchor,
                meeting_segments.effective_range_kind,
                meeting_segments.effective_start_date,
                meeting_segments.effective_end_date,
                meeting_segments.location_kind,
                meeting_segments.location_value,
                CASE
                    WHEN meeting_segments.effective_range_kind = 'explicit'
                        THEN meeting_segments.effective_start_date
                    WHEN courses.teaching_range_kind = 'explicit'
                        THEN courses.teaching_start_date
                    ELSE terms.start_date
                END AS resolved_start_date,
                CASE
                    WHEN meeting_segments.effective_range_kind = 'explicit'
                        THEN meeting_segments.effective_end_date
                    WHEN courses.teaching_range_kind = 'explicit'
                        THEN courses.teaching_end_date
                    ELSE terms.end_date
                END AS resolved_end_date
            FROM meeting_segments
            JOIN meeting_series
                ON meeting_series.meeting_series_id = meeting_segments.meeting_series_id
            JOIN courses ON courses.course_id = meeting_series.course_id
            JOIN terms ON terms.term_id = courses.term_id
            WHERE meeting_series.retired = 0
                AND courses.archived = 0
                AND terms.archived = 0
                AND terms.term_id = ?
            ORDER BY
                meeting_series.meeting_series_id,
                meeting_segments.logical_start_anchor,
                meeting_segments.meeting_segment_id
        `).all(termId) as StoredConflictMeetingSegment[];
        const overrideRows = this.database.prepare(`
            SELECT
                meeting_series_id,
                original_logical_anchor,
                override_kind,
                meeting_type,
                weekday,
                local_start,
                local_end,
                end_day_offset,
                location_kind,
                location_value
            FROM meeting_occurrence_overrides
            ORDER BY meeting_series_id, original_logical_anchor
        `).all() as StoredConflictMeetingOverride[];
        const rowsBySeries = new Map<string, StoredConflictMeetingSegment[]>();
        for (const row of segmentRows) {
            const rows = rowsBySeries.get(row.meeting_series_id) ?? [];
            rows.push(row);
            rowsBySeries.set(row.meeting_series_id, rows);
        }

        const occurrences: ConflictMeetingOccurrence[] = [];
        for (const [meetingSeriesId, rows] of rowsBySeries) {
            const first = rows[0]!;
            occurrences.push(...expandConflictMeetingOccurrences(
                Object.freeze({
                    courseId: first.course_id,
                    courseCode: first.course_code,
                    meetingSeriesId,
                }),
                first.term_zone,
                rows,
                overrideRows.filter(override => override.meeting_series_id === meetingSeriesId),
                holidayRanges,
                requestedWindow,
            ));
        }
        return Object.freeze(occurrences);
    }

    /**
     * Reads a bounded Meeting series projection without persisting ordinary occurrences.
     * @param {string} meetingSeriesId - Stable Meeting series identity.
     * @param {MeetingOccurrenceWindow} candidateWindow - Requested physical-date window.
     * @return {MeetingSeriesDetailProjection} Revision-bound segment and occurrence projection.
     */
    public readMeetingSeriesDetail(
        meetingSeriesId: string,
        candidateWindow: MeetingOccurrenceWindow,
    ): MeetingSeriesDetailProjection {
        return this.readMeetingSeriesDetailProjection(meetingSeriesId, candidateWindow, null);
    }

    /**
     * Evaluates stored rules or a proposed future rule over one bounded window.
     * @param {string} meetingSeriesId - Stable Meeting series identity.
     * @param {MeetingOccurrenceWindow} candidateWindow - Requested physical-date window.
     * @param {MeetingOccurrenceImpactDraft | null} futureChange - Proposed split, or null for current facts.
     * @return {MeetingSeriesDetailProjection} Revision-bound derived occurrence projection.
     */
    private readMeetingSeriesDetailProjection(
        meetingSeriesId: string,
        candidateWindow: MeetingOccurrenceWindow,
        futureChange: MeetingOccurrenceImpactDraft | null,
    ): MeetingSeriesDetailProjection {
        this.requireOpen();
        if (!isCanonicalUuid(meetingSeriesId)) {
            throw new TypeError('MeetingSeriesId must be a canonical UUID');
        }
        const requestedWindow = normalizeMeetingOccurrenceWindow(candidateWindow);
        const expandedWindowStart = addClampedLocalDateDays(requestedWindow.startDate, -6);
        const expandedWindowEnd = addClampedLocalDateDays(requestedWindow.endDate, 6);

        try {
            this.database.exec('SAVEPOINT read_meeting_series_detail');
            const seriesStatement = this.database.prepare(`
                SELECT
                    meeting_series.course_id,
                    meeting_series.entity_version,
                    terms.term_id,
                    terms.time_zone,
                    workspace_state.revision,
                    plan_state.plan_entity_version
                FROM meeting_series
                JOIN courses ON courses.course_id = meeting_series.course_id
                JOIN terms ON terms.term_id = courses.term_id
                JOIN workspace_state ON workspace_state.singleton = 1
                JOIN plan_state ON plan_state.singleton = workspace_state.singleton
                WHERE meeting_series_id = ?
            `);
            seriesStatement.setReadBigInts(true);
            const series = seriesStatement.get(meetingSeriesId) as {
                course_id: string;
                entity_version: bigint;
                term_id: string;
                time_zone: string;
                revision: bigint;
                plan_entity_version: bigint;
            } | undefined;
            if (!series) {
                throw new TypeError('Meeting series does not exist');
            }
            const holidayRanges = this.readActiveHolidayRanges(series.term_id);

            const segmentRows = this.database.prepare(`
                SELECT
                    meeting_segments.meeting_segment_id,
                    meeting_segments.meeting_type,
                    meeting_segments.weekday,
                    meeting_segments.local_start,
                    meeting_segments.local_end,
                    meeting_segments.end_day_offset,
                    meeting_segments.logical_start_anchor,
                    meeting_segments.logical_end_anchor,
                    meeting_segments.effective_range_kind,
                    meeting_segments.effective_start_date,
                    meeting_segments.effective_end_date,
                    meeting_segments.location_kind,
                    meeting_segments.location_value,
                    CASE
                        WHEN meeting_segments.effective_range_kind = 'explicit'
                            THEN meeting_segments.effective_start_date
                        WHEN courses.teaching_range_kind = 'explicit'
                            THEN courses.teaching_start_date
                        ELSE terms.start_date
                    END AS resolved_start_date,
                    CASE
                        WHEN meeting_segments.effective_range_kind = 'explicit'
                            THEN meeting_segments.effective_end_date
                        WHEN courses.teaching_range_kind = 'explicit'
                            THEN courses.teaching_end_date
                        ELSE terms.end_date
                    END AS resolved_end_date
                FROM meeting_segments
                JOIN meeting_series
                    ON meeting_series.meeting_series_id = meeting_segments.meeting_series_id
                JOIN courses ON courses.course_id = meeting_series.course_id
                JOIN terms ON terms.term_id = courses.term_id
                WHERE meeting_segments.meeting_series_id = ?
                    AND meeting_segments.logical_start_anchor <= ?
                    AND (
                        meeting_segments.logical_end_anchor IS NULL
                        OR meeting_segments.logical_end_anchor >= ?
                    )
                ORDER BY meeting_segments.logical_start_anchor, meeting_segments.meeting_segment_id
            `).all(meetingSeriesId, expandedWindowEnd, expandedWindowStart) as StoredMeetingSegment[];
            const overrideRows = this.database.prepare(`
                SELECT
                    original_logical_anchor,
                    override_kind,
                    meeting_type,
                    weekday,
                    local_start,
                    local_end,
                    end_day_offset,
                    location_kind,
                    location_value
                FROM meeting_occurrence_overrides
                WHERE meeting_series_id = ?
                    AND original_logical_anchor BETWEEN ? AND ?
                ORDER BY original_logical_anchor
            `).all(meetingSeriesId, expandedWindowStart, expandedWindowEnd) as StoredMeetingOverride[];

            validateMeetingSegmentSequence(segmentRows);
            for (const override of overrideRows) {
                const matchingSegments = segmentRows.filter(segment => (
                    logicalAnchorBelongsToSegment(segment, override.original_logical_anchor)
                ));
                if (matchingSegments.length !== 1) {
                    throw new Error('Meeting override does not target a logical occurrence');
                }
            }

            const overrides = new Map(overrideRows.map(row => [row.original_logical_anchor, row]));
            const seenAnchors = new Set<string>();
            const segments = Object.freeze(segmentRows.map(row => Object.freeze({
                    segmentId: row.meeting_segment_id,
                    logicalStartAnchor: row.logical_start_anchor,
                    logicalEndAnchor: row.logical_end_anchor,
                    type: row.meeting_type,
                    weekday: row.weekday,
                    localStart: row.local_start,
                    localEnd: row.local_end,
                    endDayOffset: row.end_day_offset,
                    location: meetingLocation(row.location_kind, row.location_value),
                })));
            const occurrences = [] as Array<Readonly<{
                occurrenceId: MeetingOccurrenceId;
                segmentId: string;
                date: string;
                status: 'scheduled' | 'cancelled' | 'holiday-suppressed';
                overrideKind: 'replaced' | 'cancelled' | null;
                type: MeetingTypeCode;
                weekday: MeetingWeekday;
                localStart: string;
                localEnd: string;
                endDayOffset: MeetingEndDayOffset;
                startInstant: string;
                endInstant: string;
                location: MeetingLocation;
            }>>;
            for (const [index, segment] of segments.entries()) {
                const storedSegment = segmentRows[index]!;
                for (const anchor of candidateLogicalAnchors(storedSegment, requestedWindow)) {
                    if (seenAnchors.has(anchor)) {
                        throw new Error('Meeting occurrence logical anchor is duplicated');
                    }
                    seenAnchors.add(anchor);
                    const override = overrides.get(anchor);
                    const futureChangeApplies = futureChange !== null
                        && anchor >= futureChange.originalLogicalAnchor;
                    const retainedOverride = futureChangeApplies
                        && anchor === futureChange.originalLogicalAnchor
                        ? undefined
                        : override;
                    const baseRule: MeetingRuleReplacement = futureChangeApplies
                        ? futureChange.replacement
                        : {
                            type: segment.type,
                            weekday: segment.weekday,
                            localStart: segment.localStart,
                            localEnd: segment.localEnd,
                            endDayOffset: segment.endDayOffset,
                            location: segment.location,
                        };
                    if (!isActiveLogicalAnchor(storedSegment, anchor, baseRule.weekday)) {
                        continue;
                    }
                    const replacement: MeetingRuleReplacement = retainedOverride?.override_kind === 'replaced'
                        ? {
                            type: retainedOverride.meeting_type!,
                            weekday: retainedOverride.weekday!,
                            localStart: retainedOverride.local_start!,
                            localEnd: retainedOverride.local_end!,
                            endDayOffset: retainedOverride.end_day_offset!,
                            location: meetingLocation(
                                retainedOverride.location_kind!,
                                retainedOverride.location_value,
                            ),
                        }
                        : baseRule;
                    const baseDate = occurrenceDate(anchor, baseRule.weekday);
                    const date = occurrenceDate(anchor, replacement.weekday);
                    if (baseDate === null
                        || date === null
                        || date < requestedWindow.startDate
                        || date > requestedWindow.endDate) {
                        continue;
                    }
                    const instantWindow = resolveMeetingOccurrenceTime({
                        termZone: series.time_zone,
                        date,
                        localStart: replacement.localStart,
                        localEnd: replacement.localEnd,
                        endDayOffset: replacement.endDayOffset,
                    });
                    occurrences.push(Object.freeze({
                        occurrenceId: deriveMeetingOccurrenceId(meetingSeriesId, anchor),
                        segmentId: segment.segmentId,
                        date,
                        status: retainedOverride?.override_kind === 'cancelled'
                            ? 'cancelled'
                            : retainedOverride?.override_kind === 'replaced'
                                ? 'scheduled'
                                : holidayRanges.some(range => (
                                    baseDate >= range.start_date && baseDate <= range.end_date
                                ))
                                    ? 'holiday-suppressed'
                                    : 'scheduled',
                        overrideKind: retainedOverride?.override_kind ?? null,
                        type: replacement.type,
                        weekday: replacement.weekday,
                        localStart: replacement.localStart,
                        localEnd: replacement.localEnd,
                        endDayOffset: replacement.endDayOffset,
                        startInstant: instantWindow.startInstant,
                        endInstant: instantWindow.endInstant,
                        location: replacement.location,
                    }));
                }
            }
            this.database.exec('RELEASE SAVEPOINT read_meeting_series_detail');

            return Object.freeze({
                workspaceRevision: series.revision.toString(),
                planEntityVersion: series.plan_entity_version.toString(),
                requestedWindow,
                termZone: series.time_zone,
                meetingSeriesId,
                courseId: series.course_id,
                entityVersion: series.entity_version.toString(),
                segments,
                occurrences: Object.freeze(occurrences),
            });
        }
        catch (error) {
            this.rollbackOrRequireReopen();
            throw error;
        }
    }

    /**
     * Previews and tokenizes a this-and-future Meeting rule split.
     * @param {MeetingOccurrenceImpactDraft} candidate - Untrusted exact preview draft.
     * @return {MeetingOccurrenceImpactProjection} Version-bound current/after impact projection.
     */
    public previewMeetingOccurrenceChange(
        candidate: MeetingOccurrenceImpactDraft,
    ): MeetingOccurrenceImpactProjection {
        this.requireOpen();
        const draft = normalizeMeetingOccurrenceImpactDraft(candidate);
        const detail = this.readMeetingSeriesDetail(draft.meetingSeriesId, draft.requestedWindow);
        const target = detail.occurrences.find(occurrence => (
            occurrence.occurrenceId.originalLogicalAnchor === draft.originalLogicalAnchor
        ));
        if (!target) {
            throw new TypeError('Meeting occurrence impact target is outside the requested window');
        }
        const afterChangeDetail = this.readMeetingSeriesDetailProjection(
            draft.meetingSeriesId,
            draft.requestedWindow,
            draft,
        );

        try {
            this.database.exec('BEGIN');
            const versions = this.currentVersions();
            const seriesStatement = this.database.prepare(`
                SELECT entity_version
                FROM meeting_series
                WHERE meeting_series_id = ? AND retired = 0
            `);
            seriesStatement.setReadBigInts(true);
            const series = seriesStatement.get(draft.meetingSeriesId) as {
                entity_version: bigint;
            } | undefined;
            if (!series
                || versions.revision.toString() !== detail.workspaceRevision
                || versions.planVersion.toString() !== detail.planEntityVersion
                || series.entity_version.toString() !== detail.entityVersion
                || afterChangeDetail.workspaceRevision !== detail.workspaceRevision
                || afterChangeDetail.planEntityVersion !== detail.planEntityVersion
                || afterChangeDetail.entityVersion !== detail.entityVersion) {
                throw new Error('Meeting impact snapshot changed while it was being prepared');
            }

            const scopeSegments = this.database.prepare(`
                SELECT
                    meeting_segments.meeting_segment_id,
                    meeting_segments.meeting_type,
                    meeting_segments.weekday,
                    meeting_segments.local_start,
                    meeting_segments.local_end,
                    meeting_segments.end_day_offset,
                    meeting_segments.logical_start_anchor,
                    meeting_segments.logical_end_anchor,
                    meeting_segments.effective_range_kind,
                    meeting_segments.effective_start_date,
                    meeting_segments.effective_end_date,
                    meeting_segments.location_kind,
                    meeting_segments.location_value,
                    CASE
                        WHEN meeting_segments.effective_range_kind = 'explicit'
                            THEN meeting_segments.effective_start_date
                        WHEN courses.teaching_range_kind = 'explicit'
                            THEN courses.teaching_start_date
                        ELSE terms.start_date
                    END AS resolved_start_date,
                    CASE
                        WHEN meeting_segments.effective_range_kind = 'explicit'
                            THEN meeting_segments.effective_end_date
                        WHEN courses.teaching_range_kind = 'explicit'
                            THEN courses.teaching_end_date
                        ELSE terms.end_date
                    END AS resolved_end_date
                FROM meeting_segments
                JOIN meeting_series
                    ON meeting_series.meeting_series_id = meeting_segments.meeting_series_id
                JOIN courses ON courses.course_id = meeting_series.course_id
                JOIN terms ON terms.term_id = courses.term_id
                WHERE meeting_segments.meeting_series_id = ?
                ORDER BY meeting_segments.logical_start_anchor, meeting_segments.meeting_segment_id
            `).all(draft.meetingSeriesId) as StoredMeetingSegment[];
            validateMeetingSegmentSequence(scopeSegments);
            const range = scopeSegments.find(segment => segment.meeting_segment_id === target.segmentId);
            const boundaryOverrides = this.database.prepare(`
                SELECT
                    original_logical_anchor,
                    override_kind,
                    meeting_type,
                    weekday,
                    local_start,
                    local_end,
                    end_day_offset,
                    location_kind,
                    location_value
                FROM meeting_occurrence_overrides
                WHERE meeting_series_id = ?
                    AND original_logical_anchor BETWEEN ? AND ?
                ORDER BY original_logical_anchor
            `).all(
                draft.meetingSeriesId,
                addClampedLocalDateDays(draft.requestedWindow.startDate, -12),
                addClampedLocalDateDays(draft.requestedWindow.endDate, 12),
            ) as StoredMeetingOverride[];
            const targetDateAfterChange = occurrenceDate(
                draft.originalLogicalAnchor,
                draft.replacement.weekday,
            );
            if (!range
                || targetDateAfterChange === null
                || targetDateAfterChange < range.resolved_start_date
                || targetDateAfterChange > range.resolved_end_date) {
                throw new TypeError('Meeting occurrence replacement falls outside its effective range');
            }

            const impactStatement = this.database.prepare(`
                SELECT
                    (
                        SELECT count(*)
                        FROM meeting_segments
                        WHERE meeting_series_id = ?
                            AND (
                                logical_end_anchor IS NULL
                                OR logical_end_anchor >= ?
                            )
                    ) AS affected_segment_count,
                    (
                        SELECT count(*)
                        FROM meeting_occurrence_overrides
                        WHERE meeting_series_id = ? AND original_logical_anchor >= ?
                    ) AS future_override_count,
                    (
                        SELECT override_kind
                        FROM meeting_occurrence_overrides
                        WHERE meeting_series_id = ? AND original_logical_anchor = ?
                    ) AS target_override_kind
            `);
            impactStatement.setReadBigInts(true);
            const impact = impactStatement.get(
                draft.meetingSeriesId,
                draft.originalLogicalAnchor,
                draft.meetingSeriesId,
                draft.originalLogicalAnchor,
                draft.meetingSeriesId,
                draft.originalLogicalAnchor,
            ) as {
                affected_segment_count: bigint;
                future_override_count: bigint;
                target_override_kind: 'replaced' | 'cancelled' | null;
            };
            const confirmationToken = meetingOccurrenceConfirmationToken(
                detail.workspaceRevision,
                detail.planEntityVersion,
                detail.entityVersion,
                draft,
                draft.requestedWindow,
            );
            const minimumLocalDate = localDateMilliseconds('0000-01-01');
            const maximumLocalDate = localDateMilliseconds('9999-12-31');
            const targetAnchor = localDateMilliseconds(draft.originalLogicalAnchor);
            const historyOutsideRequestedWindow = hasOccurrenceOutsideRequestedWindow(
                scopeSegments,
                minimumLocalDate,
                targetAnchor - 1,
                draft.requestedWindow,
                null,
                boundaryOverrides,
                null,
            );
            const currentFutureOutsideRequestedWindow = hasOccurrenceOutsideRequestedWindow(
                scopeSegments,
                targetAnchor,
                maximumLocalDate,
                draft.requestedWindow,
                null,
                boundaryOverrides,
                null,
            );
            const changedFutureOutsideRequestedWindow = hasOccurrenceOutsideRequestedWindow(
                scopeSegments,
                targetAnchor,
                maximumLocalDate,
                draft.requestedWindow,
                draft.replacement.weekday,
                boundaryOverrides,
                draft.originalLogicalAnchor,
            );
            const futureOutsideRequestedWindow = currentFutureOutsideRequestedWindow
                || changedFutureOutsideRequestedWindow;
            const targetOverrideKind = impact.target_override_kind ?? 'none';
            const warnings = [] as Array<Readonly<{
                code:
                    | 'preview-window-truncated-history'
                    | 'preview-window-truncated-future'
                    | 'target-override-will-be-cleared';
            }>>;
            if (historyOutsideRequestedWindow) {
                warnings.push(Object.freeze({ code: 'preview-window-truncated-history' }));
            }
            if (futureOutsideRequestedWindow) {
                warnings.push(Object.freeze({ code: 'preview-window-truncated-future' }));
            }
            if (targetOverrideKind !== 'none') {
                warnings.push(Object.freeze({ code: 'target-override-will-be-cleared' }));
            }
            const affectedFutureSegmentCount = impact.affected_segment_count.toString();
            this.database.exec('COMMIT');

            return Object.freeze({
                basedOnRevision: detail.workspaceRevision,
                planEntityVersion: detail.planEntityVersion,
                meetingSeriesVersion: detail.entityVersion,
                affectedEntities: freezeTuple([Object.freeze({
                    kind: 'meeting-series' as const,
                    id: draft.meetingSeriesId,
                    version: detail.entityVersion,
                })]),
                effects: freezeTuple([Object.freeze({
                    code: 'plan.meeting-series-split' as const,
                    originalLogicalAnchor: draft.originalLogicalAnchor,
                    affectedFutureSegmentCount,
                    targetOverrideAction: targetOverrideKind === 'none' ? 'none' as const : 'clear' as const,
                    laterOverrideAction: 'retain' as const,
                })]),
                warnings: Object.freeze(warnings),
                choices: freezeTuple([Object.freeze({ id: 'apply-this-and-future' as const })]),
                defaultChoice: Object.freeze({ id: 'apply-this-and-future' as const }),
                recoverability: Object.freeze({
                    kind: 'permanent' as const,
                    reason: 'meeting-rule-split-has-no-undo' as const,
                }),
                unresolvedReferences: freezeEmptyTuple(),
                scope: draft.scope,
                meetingSeriesId: draft.meetingSeriesId,
                originalLogicalAnchor: draft.originalLogicalAnchor,
                requestedWindow: draft.requestedWindow,
                replacement: draft.replacement,
                targetDateAfterChange,
                targetOverrideKind,
                affectedFutureSegmentCount,
                futureOverrideCount: impact.future_override_count.toString(),
                historicalOccurrences: Object.freeze(detail.occurrences.filter(occurrence => (
                    occurrence.occurrenceId.originalLogicalAnchor < draft.originalLogicalAnchor
                ))),
                currentFutureOccurrences: Object.freeze(detail.occurrences.filter(occurrence => (
                    occurrence.occurrenceId.originalLogicalAnchor >= draft.originalLogicalAnchor
                ))),
                futureOccurrencesAfterChange: Object.freeze(afterChangeDetail.occurrences
                    .filter(occurrence => (
                        occurrence.occurrenceId.originalLogicalAnchor >= draft.originalLogicalAnchor
                    ))
                    .map(occurrence => Object.freeze({
                        occurrenceId: occurrence.occurrenceId,
                        date: occurrence.date,
                        status: occurrence.status,
                        overrideKind: occurrence.overrideKind,
                        type: occurrence.type,
                        weekday: occurrence.weekday,
                        localStart: occurrence.localStart,
                        localEnd: occurrence.localEnd,
                        endDayOffset: occurrence.endDayOffset,
                        startInstant: occurrence.startInstant,
                        endInstant: occurrence.endInstant,
                        location: occurrence.location,
                    }))),
                historyOutsideRequestedWindow,
                futureOutsideRequestedWindow,
                attendanceRecordCount: '0',
                explicitGradeReferenceCount: '0',
                confirmationToken,
            });
        }
        catch (error) {
            this.rollbackOrRequireReopen();
            throw error;
        }
    }

    public commit(
        candidate: WorkspaceDataCommand,
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
        let command: WorkspaceDataCommand;
        switch (candidate.intent.kind) {
            case 'protect.configure-backup-destination':
                command = normalizeAcceptedConfigureBackupDestinationCommand(candidate);
                break;
            case 'plan.create-term':
                command = normalizeCreateTermCommand(candidate);
                break;
            case 'plan.create-course-with-first-meeting':
                command = normalizeAcceptedCreateCourseWithMeetingCommand(candidate);
                break;
            case 'plan.create-course':
                command = normalizeCreateCourseCommand(candidate);
                break;
            case 'plan.create-meeting-series':
                command = normalizeCreateMeetingSeriesCommand(candidate);
                break;
            case 'plan.change-meeting-occurrence':
                command = normalizeAcceptedChangeMeetingOccurrenceCommand(candidate);
                break;
            case 'plan.cancel-meeting-occurrence':
                command = normalizeCancelMeetingOccurrenceCommand(candidate);
                break;
            case 'workspace.reconcile-lifecycle':
                command = normalizeReconcileWorkspaceLifecycleCommand(candidate);
                break;
            case 'plan.update-term-end-date':
                command = normalizeUpdateTermEndDateCommand(candidate);
                break;
            case 'plan.restore-term-as-current':
                command = normalizeRestoreTermAsCurrentCommand(candidate);
                break;
            case 'plan.create-holiday-range':
                command = normalizeCreateHolidayRangeCommand(candidate);
                break;
            case 'plan.update-holiday-range':
                command = normalizeUpdateHolidayRangeCommand(candidate);
                break;
            case 'plan.delete-holiday-range':
                command = normalizeDeleteHolidayRangeCommand(candidate);
                break;
            case 'plan.create-task-series':
                command = normalizeCreateTaskCommand(candidate);
                break;
            case 'plan.update-task-series':
                command = normalizeUpdateTaskCommand(candidate);
                break;
            case 'plan.delete-task-series':
                command = normalizeDeleteTaskCommand(candidate);
                break;
            case 'plan.set-task-occurrence-status':
                command = candidate.intent.intentSchemaVersion === 1
                    ? normalizeCompleteTaskCommand(candidate)
                    : normalizeSetTaskOccurrenceStatusCommand(candidate);
                break;
            case 'plan.set-task-progress':
                command = normalizeSetTaskProgressCommand(candidate);
                break;
            case 'plan.change-task-occurrence':
                command = normalizeChangeTaskOccurrenceCommand(candidate);
                break;
            case 'plan.delete-task-occurrence-or-series':
                command = normalizeDeleteTaskOccurrenceOrSeriesCommand(candidate);
                break;
            case 'plan.undo-task-occurrence-state':
                command = normalizeUndoTaskOccurrenceStateCommand(candidate);
                break;
            default:
                command = normalizeRecordSetupDecisionCommand(candidate);
        }
        if (!this.accepting) {
            return Promise.reject(new Error('Workspace data store is closing'));
        }
        if (this.queue.length >= COMMIT_QUEUE_CAPACITY) {
            return Promise.resolve(writerBusyResult(this.revision));
        }

        const pending = new Promise<DataCommitResult>((resolve, reject) => {
            this.queue.push({ kind: 'commit', command, options, resolve, reject });
        });
        if (!this.running) {
            this.running = true;
            queueMicrotask(() => this.drain());
        }
        return pending;
    }

    /**
     * Saves the bounded Shell-owned first-setup draft without changing formal Workspace facts.
     * @param {object} input - Versioned opaque JSON draft envelope.
     * @param {string} updatedAt - Workspace-clock Instant for the checkpoint.
     * @param {CommitOptions} options - Transaction failpoint controls used by tests.
     * @return {Promise<SetupDraftCheckpointWriteResult>} New draft version or unchanged problem.
     */
    public saveSetupDraftCheckpoint(
        input: Readonly<{
            expectedVersion: string;
            schemaVersion: 1;
            opaquePayload: string;
        }>,
        updatedAt: string,
        options: CommitOptions = {},
    ): Promise<SetupDraftCheckpointWriteResult> {
        if (!isCanonicalUnsignedSqliteInteger(input.expectedVersion)
            || input.schemaVersion !== 1
            || !isCanonicalInstant(updatedAt)
            || Buffer.byteLength(input.opaquePayload, 'utf8') > MAX_SETUP_DRAFT_PAYLOAD_BYTES) {
            throw new TypeError('Setup draft checkpoint is invalid or incompatible');
        }
        try {
            JSON.parse(input.opaquePayload);
        }
        catch {
            throw new TypeError('Setup draft checkpoint payload is not JSON');
        }
        return this.enqueueSetupDraftMutation({
            kind: 'save',
            expectedVersion: input.expectedVersion,
            schemaVersion: input.schemaVersion,
            updatedAt,
            opaquePayload: input.opaquePayload,
        }, options);
    }

    /**
     * Discards the first-setup draft while preserving its optimistic version stream.
     * @param {string} expectedVersion - Last observed draft-stream version.
     * @param {CommitOptions} options - Transaction failpoint controls used by tests.
     * @return {Promise<SetupDraftCheckpointWriteResult>} New draft version or unchanged problem.
     */
    public discardSetupDraftCheckpoint(
        expectedVersion: string,
        options: CommitOptions = {},
    ): Promise<SetupDraftCheckpointWriteResult> {
        if (!isCanonicalUnsignedSqliteInteger(expectedVersion)) {
            throw new TypeError('Setup draft checkpoint version is invalid');
        }
        return this.enqueueSetupDraftMutation({ kind: 'discard', expectedVersion }, options);
    }

    /**
     * Serializes setup-draft mutations with formal Workspace writes on the sole SQLite connection.
     * @param {SetupDraftWork['mutation']} mutation - Validated save or discard mutation.
     * @param {CommitOptions} options - Transaction failpoint controls used by tests.
     * @return {Promise<SetupDraftCheckpointWriteResult>} Queued write result.
     */
    private enqueueSetupDraftMutation(
        mutation: SetupDraftWork['mutation'],
        options: CommitOptions,
    ): Promise<SetupDraftCheckpointWriteResult> {
        if (this.terminalError) {
            return Promise.reject(this.terminalError);
        }
        if (this.readOnly) {
            try {
                this.requireOpen();
                return Promise.resolve(setupDraftPermissionResult(this.revision));
            }
            catch (error) {
                return Promise.reject(error);
            }
        }
        if (!this.accepting) {
            return Promise.reject(new Error('Workspace data store is closing'));
        }
        if (this.queue.length >= COMMIT_QUEUE_CAPACITY) {
            return Promise.resolve(setupDraftWriterBusyResult(this.revision));
        }

        const pending = new Promise<SetupDraftCheckpointWriteResult>((resolve, reject) => {
            this.queue.push({ kind: 'setup-draft', mutation, options, resolve, reject });
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
        return this.readProtectionWatermarks().neededThrough;
    }

    /**
     * Reads both durable backup watermarks from their singleton DATA owner.
     * @return {{neededThrough: string; succeededThrough: string}} Current watermark pair.
     */
    public readProtectionWatermarks(): Readonly<{
        neededThrough: string;
        succeededThrough: string;
    }> {
        this.requireOpen();
        const statement = this.database.prepare(`
            SELECT backup_needed_through, backup_succeeded_through
            FROM protection_watermarks
            WHERE singleton = 1
        `);
        statement.setReadBigInts(true);
        const row = statement.get() as {
            backup_needed_through: bigint;
            backup_succeeded_through: bigint;
        };
        return Object.freeze({
            neededThrough: row.backup_needed_through.toString(),
            succeededThrough: row.backup_succeeded_through.toString(),
        });
    }

    /**
     * Claims or resumes the one durable backup operation for the current merged watermark.
     * @param {object} input - Identities generated by the PROTECT coordinator for a new claim.
     * @return {BackupOperation | null} Resumable work, or null when DATA is already protected.
     */
    public claimBackupOperation(input: Readonly<{
        operationId: string;
        snapshotId: string;
        stagingDirectoryName: string;
        createdAt: string;
    }>): BackupOperation | null {
        this.requireBackupMutationAllowed();
        const expectedStagingName = new RegExp(`^\\.staging-${input.operationId}-[0-9a-f]{16}$`);
        if (!isCanonicalUuid(input.operationId)
            || !isCanonicalUuid(input.snapshotId)
            || !isCanonicalInstant(input.createdAt)
            || !expectedStagingName.test(input.stagingDirectoryName)) {
            throw new TypeError('Backup operation claim is invalid');
        }

        try {
            this.database.exec('BEGIN IMMEDIATE');
            const active = this.readBackupOperationRow(`phase <> 'succeeded'`);
            if (active) {
                this.database.exec('COMMIT');
                return backupOperationFromRow(active);
            }
            const watermarks = this.readProtectionWatermarksInsideTransaction();
            if (watermarks.backup_succeeded_through >= watermarks.backup_needed_through) {
                this.database.exec('COMMIT');
                return null;
            }
            const configuration = this.database.prepare(`
                SELECT backup_set_id
                FROM backup_configuration
                WHERE singleton = 1
            `).get() as {backup_set_id: string | null};
            if (configuration.backup_set_id === null) {
                this.database.exec('COMMIT');
                return null;
            }
            const sequenceStatement = this.database.prepare(`
                SELECT coalesce(max(backup_sequence), 0) + 1 AS next_sequence
                FROM backup_operations
                WHERE backup_set_id = ?
            `);
            sequenceStatement.setReadBigInts(true);
            const sequence = (sequenceStatement.get(configuration.backup_set_id) as {
                next_sequence: bigint;
            }).next_sequence;
            this.database.prepare(`
                INSERT INTO backup_operations (
                    operation_id,
                    backup_set_id,
                    backup_sequence,
                    snapshot_id,
                    target_revision,
                    actual_revision,
                    staging_directory_name,
                    created_at,
                    phase,
                    operation_version
                ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'queued', 0)
            `).run(
                input.operationId,
                configuration.backup_set_id,
                sequence,
                input.snapshotId,
                watermarks.backup_needed_through,
                input.stagingDirectoryName,
                input.createdAt,
            );
            const claimed = this.readBackupOperationRow('operation_id = ?', input.operationId);
            this.database.exec('COMMIT');
            return backupOperationFromRow(claimed!);
        }
        catch (error) {
            if (this.database.isTransaction) {
                this.database.exec('ROLLBACK');
            }
            throw error;
        }
    }

    /**
     * Reads the latest operation, including the most recently succeeded operation.
     * @return {BackupOperation | null} Latest durable operation.
     */
    public readBackupOperation(): BackupOperation | null {
        this.requireOpen();
        const row = this.readBackupOperationRow('1 = 1');
        return row ? backupOperationFromRow(row) : null;
    }

    /**
     * Reads the durable operation that owns one registered or in-progress snapshot identity.
     * @param {string} snapshotId - Canonical snapshot UUID.
     * @return {BackupOperation | null} Matching durable operation when registered.
     */
    public readBackupOperationForSnapshot(snapshotId: string): BackupOperation | null {
        this.requireOpen();
        if (!isCanonicalUuid(snapshotId)) {
            throw new TypeError('Snapshot identity is invalid');
        }
        const row = this.readBackupOperationRow('snapshot_id = ?', snapshotId);
        return row ? backupOperationFromRow(row) : null;
    }

    /**
     * Records the actual revision observed in the validated SQLite backup member.
     * @param {string} operationId - Claimed operation identity.
     * @param {string} actualRevision - Revision read from the checkpoint copy.
     * @return {BackupOperation} Updated durable operation.
     */
    public recordBackupCheckpoint(operationId: string, actualRevision: string): BackupOperation {
        this.requireBackupMutationAllowed();
        if (!isCanonicalUuid(operationId)
            || !isCanonicalUnsignedSqliteInteger(actualRevision)
            || actualRevision === '0') {
            throw new TypeError('Backup checkpoint facts are invalid');
        }
        return this.mutateBackupOperation(operationId, operation => {
            if (operation.phase === 'database-checkpoint'
                && operation.actual_revision === BigInt(actualRevision)) {
                return false;
            }
            if (operation.phase !== 'queued'
                || BigInt(actualRevision) < operation.target_revision) {
                throw new Error('Backup checkpoint does not match the claimed target');
            }
            this.database.prepare(`
                UPDATE backup_operations
                SET actual_revision = ?, phase = 'database-checkpoint',
                    operation_version = operation_version + 1
                WHERE operation_id = ?
            `).run(BigInt(actualRevision), operationId);
            return true;
        });
    }

    /**
     * Advances one validated filesystem phase without skipping protocol stages.
     * @param {string} operationId - Claimed operation identity.
     * @param {BackupOperationPhase} expectedPhase - Durable source phase.
     * @param {BackupOperationPhase} nextPhase - Required immediate successor.
     * @return {BackupOperation} Updated durable operation.
     */
    public advanceBackupOperation(
        operationId: string,
        expectedPhase: BackupOperationPhase,
        nextPhase: BackupOperationPhase,
    ): BackupOperation {
        this.requireBackupMutationAllowed();
        if (!isCanonicalUuid(operationId) || BACKUP_PHASE_SUCCESSORS[expectedPhase] !== nextPhase) {
            throw new TypeError('Backup phase transition is invalid');
        }
        return this.mutateBackupOperation(operationId, operation => {
            if (operation.phase === nextPhase) {
                return false;
            }
            if (operation.phase !== expectedPhase) {
                throw new Error('Backup phase transition is stale');
            }
            this.database.prepare(`
                UPDATE backup_operations
                SET phase = ?, operation_version = operation_version + 1
                WHERE operation_id = ?
            `).run(nextPhase, operationId);
            return true;
        });
    }

    /**
     * Registers an immutable published snapshot and completes covered follow-ups atomically.
     * @param {object} input - Final verified snapshot facts.
     * @return {BackupOperation} Idempotently succeeded operation.
     */
    public recordBackupSuccess(input: Readonly<{
        operationId: string;
        actualRevision: string;
        rootDigest: string;
        succeededAt: string;
    }>): BackupOperation {
        this.requireBackupMutationAllowed();
        if (!isCanonicalUuid(input.operationId)
            || !isCanonicalUnsignedSqliteInteger(input.actualRevision)
            || input.actualRevision === '0'
            || !/^[0-9a-f]{64}$/.test(input.rootDigest)
            || !isCanonicalInstant(input.succeededAt)) {
            throw new TypeError('Backup success facts are invalid');
        }
        try {
            this.database.exec('BEGIN IMMEDIATE');
            const operation = this.requireBackupOperationRow(input.operationId);
            if (operation.phase === 'succeeded') {
                const stored = this.readSuccessfulBackupSnapshot(input.operationId);
                if (stored.actualRevision !== input.actualRevision
                    || stored.rootDigest !== input.rootDigest
                    || stored.succeededAt !== input.succeededAt) {
                    throw new Error('Backup success replay does not match immutable facts');
                }
                this.database.exec('COMMIT');
                return backupOperationFromRow(operation);
            }
            if (operation.phase !== 'published-pending-record'
                || operation.actual_revision !== BigInt(input.actualRevision)) {
                throw new Error('Backup success is not ready to record');
            }
            const watermarks = this.readProtectionWatermarksInsideTransaction();
            if (operation.actual_revision > watermarks.backup_needed_through) {
                throw new Error('Backup success revision exceeds the durable watermark');
            }
            this.database.prepare(`
                INSERT INTO backup_snapshots (
                    snapshot_id,
                    operation_id,
                    backup_set_id,
                    backup_sequence,
                    actual_revision,
                    root_digest,
                    succeeded_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                operation.snapshot_id,
                operation.operation_id,
                operation.backup_set_id,
                operation.backup_sequence,
                operation.actual_revision,
                input.rootDigest,
                input.succeededAt,
            );
            this.database.prepare(`
                UPDATE protection_watermarks
                SET backup_succeeded_through = ?
                WHERE singleton = 1
            `).run(operation.actual_revision);
            this.database.prepare(`
                UPDATE durable_followups
                SET state = 'completed', follow_up_version = 1
                WHERE state = 'pending' AND prerequisite_revision <= ?
            `).run(operation.actual_revision);
            this.database.prepare(`
                UPDATE backup_operations
                SET phase = 'succeeded', operation_version = operation_version + 1
                WHERE operation_id = ?
            `).run(operation.operation_id);
            const succeeded = this.requireBackupOperationRow(operation.operation_id);
            this.database.exec('COMMIT');
            return backupOperationFromRow(succeeded);
        }
        catch (error) {
            if (this.database.isTransaction) {
                this.database.exec('ROLLBACK');
            }
            throw error;
        }
    }

    /**
     * Lists immutable success records in BackupSequence order.
     * @return {readonly SuccessfulBackupSnapshot[]} Registered snapshot facts.
     */
    public readSuccessfulBackupSnapshots(): readonly SuccessfulBackupSnapshot[] {
        this.requireOpen();
        const statement = this.database.prepare(`
            SELECT
                snapshot_id,
                backup_set_id,
                backup_sequence,
                actual_revision,
                root_digest,
                succeeded_at
            FROM backup_snapshots
            ORDER BY backup_sequence
        `);
        statement.setReadBigInts(true);
        const rows = statement.all() as Array<{
            snapshot_id: string;
            backup_set_id: string;
            backup_sequence: bigint;
            actual_revision: bigint;
            root_digest: string;
            succeeded_at: string;
        }>;
        return Object.freeze(rows.map(row => Object.freeze({
            snapshotId: row.snapshot_id,
            backupSetId: row.backup_set_id,
            backupSequence: row.backup_sequence.toString(),
            actualRevision: row.actual_revision.toString(),
            rootDigest: row.root_digest,
            succeededAt: row.succeeded_at,
        })));
    }

    /**
     * Claims one PROTECT-selected registration when two newer successes are still recorded.
     * @param {string} operationId - Fresh cleanup operation UUID.
     * @param {string} snapshotId - Freshly selected registered Snapshot UUID.
     * @return {BackupCleanupOperation | null} Resumable cleanup, or null when ineligible.
     */
    public claimBackupCleanupOperation(
        operationId: string,
        snapshotId: string,
    ): BackupCleanupOperation | null {
        this.requireBackupMutationAllowed();
        if (!isCanonicalUuid(operationId) || !isCanonicalUuid(snapshotId)) {
            throw new TypeError('Backup cleanup identity is invalid');
        }
        try {
            this.database.exec('BEGIN IMMEDIATE');
            const active = this.readBackupCleanupOperationRow();
            if (active) {
                this.database.exec('COMMIT');
                return backupCleanupOperationFromRow(active);
            }
            const candidateStatement = this.database.prepare(`
                SELECT
                    snapshot.backup_set_id,
                    snapshot.snapshot_id,
                    snapshot.backup_sequence,
                    snapshot.root_digest
                FROM backup_snapshots AS snapshot
                JOIN backup_configuration AS configuration ON configuration.singleton = 1
                WHERE snapshot.backup_set_id = configuration.backup_set_id
                    AND snapshot.snapshot_id = ?
                    AND (
                        SELECT count(*)
                        FROM backup_snapshots AS newer
                        WHERE newer.backup_set_id = snapshot.backup_set_id
                            AND newer.backup_sequence > snapshot.backup_sequence
                    ) >= 2
                LIMIT 1
            `);
            candidateStatement.setReadBigInts(true);
            const candidate = candidateStatement.get(snapshotId) as {
                backup_set_id: string;
                snapshot_id: string;
                backup_sequence: bigint;
                root_digest: string;
            } | undefined;
            if (!candidate) {
                this.database.exec('COMMIT');
                return null;
            }
            this.database.prepare(`
                INSERT INTO backup_cleanup_operations (
                    singleton,
                    operation_id,
                    backup_set_id,
                    snapshot_id,
                    backup_sequence,
                    root_digest,
                    snapshot_directory_name,
                    quarantine_directory_name,
                    phase,
                    operation_version
                ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 'planned', 0)
            `).run(
                operationId,
                candidate.backup_set_id,
                candidate.snapshot_id,
                candidate.backup_sequence,
                candidate.root_digest,
                `snapshot-${candidate.snapshot_id}`,
                `.quarantine-${operationId}-${candidate.snapshot_id}`,
            );
            const claimed = this.readBackupCleanupOperationRow();
            this.database.exec('COMMIT');
            return backupCleanupOperationFromRow(claimed!);
        }
        catch (error) {
            if (this.database.isTransaction) {
                this.database.exec('ROLLBACK');
            }
            throw error;
        }
    }

    /**
     * Reads the one durable retention cleanup journal entry.
     * @return {BackupCleanupOperation | null} Active cleanup when one exists.
     */
    public readBackupCleanupOperation(): BackupCleanupOperation | null {
        this.requireOpen();
        const row = this.readBackupCleanupOperationRow();
        return row ? backupCleanupOperationFromRow(row) : null;
    }

    /**
     * Releases a planned cleanup only after PROTECT proves no quarantine rename occurred.
     * @param {string} operationId - Persisted cleanup operation UUID.
     * @return {void}
     */
    public releasePlannedBackupCleanup(operationId: string): void {
        this.requireBackupMutationAllowed();
        if (!isCanonicalUuid(operationId)) {
            throw new TypeError('Backup cleanup operation identity is invalid');
        }
        try {
            this.database.exec('BEGIN IMMEDIATE');
            const cleanup = this.readBackupCleanupOperationRow();
            if (!cleanup) {
                this.database.exec('COMMIT');
                return;
            }
            if (cleanup.operation_id !== operationId || cleanup.phase !== 'planned') {
                throw new Error('Backup cleanup operation cannot be released');
            }
            this.database.prepare(`
                DELETE FROM backup_cleanup_operations
                WHERE singleton = 1 AND operation_id = ? AND phase = 'planned'
            `).run(operationId);
            this.database.exec('COMMIT');
        }
        catch (error) {
            if (this.database.isTransaction) {
                this.database.exec('ROLLBACK');
            }
            throw error;
        }
    }

    /**
     * Records that same-parent quarantine rename has completed.
     * @param {string} operationId - Persisted cleanup operation UUID.
     * @return {BackupCleanupOperation} Idempotently quarantined cleanup facts.
     */
    public markBackupCleanupQuarantined(operationId: string): BackupCleanupOperation {
        this.requireBackupMutationAllowed();
        if (!isCanonicalUuid(operationId)) {
            throw new TypeError('Backup cleanup operation identity is invalid');
        }
        try {
            this.database.exec('BEGIN IMMEDIATE');
            const cleanup = this.readBackupCleanupOperationRow();
            if (!cleanup || cleanup.operation_id !== operationId) {
                throw new Error('Backup cleanup operation does not exist');
            }
            if (cleanup.phase === 'planned') {
                this.database.prepare(`
                    UPDATE backup_cleanup_operations
                    SET phase = 'quarantined', operation_version = 1
                    WHERE singleton = 1
                `).run();
            }
            const updated = this.readBackupCleanupOperationRow();
            this.database.exec('COMMIT');
            return backupCleanupOperationFromRow(updated!);
        }
        catch (error) {
            if (this.database.isTransaction) {
                this.database.exec('ROLLBACK');
            }
            throw error;
        }
    }

    /**
     * Records the fully revalidated checkpoint that authorizes exact physical deletion.
     * @param {string} operationId - Persisted cleanup operation UUID.
     * @return {BackupCleanupOperation} Idempotently deletion-authorized cleanup facts.
     */
    public markBackupCleanupDeleting(operationId: string): BackupCleanupOperation {
        this.requireBackupMutationAllowed();
        if (!isCanonicalUuid(operationId)) {
            throw new TypeError('Backup cleanup operation identity is invalid');
        }
        try {
            this.database.exec('BEGIN IMMEDIATE');
            const cleanup = this.readBackupCleanupOperationRow();
            if (!cleanup || cleanup.operation_id !== operationId || cleanup.phase === 'planned') {
                throw new Error('Backup cleanup operation is not quarantined');
            }
            if (cleanup.phase === 'quarantined') {
                this.database.prepare(`
                    UPDATE backup_cleanup_operations
                    SET phase = 'deleting', operation_version = 2
                    WHERE singleton = 1
                `).run();
            }
            const updated = this.readBackupCleanupOperationRow();
            this.database.exec('COMMIT');
            return backupCleanupOperationFromRow(updated!);
        }
        catch (error) {
            if (this.database.isTransaction) {
                this.database.exec('ROLLBACK');
            }
            throw error;
        }
    }

    /**
     * Forgets one physically deleted quarantined snapshot and its succeeded operation atomically.
     * @param {string} operationId - Persisted cleanup operation UUID.
     * @return {void}
     */
    public completeBackupCleanup(operationId: string): void {
        this.requireBackupMutationAllowed();
        if (!isCanonicalUuid(operationId)) {
            throw new TypeError('Backup cleanup operation identity is invalid');
        }
        try {
            this.database.exec('BEGIN IMMEDIATE');
            const cleanup = this.readBackupCleanupOperationRow();
            if (!cleanup) {
                this.database.exec('COMMIT');
                return;
            }
            if (cleanup.operation_id !== operationId || cleanup.phase !== 'deleting') {
                throw new Error('Backup cleanup operation is not ready to complete');
            }
            const snapshotStatement = this.database.prepare(`
                SELECT snapshot.operation_id, count(newer.snapshot_id) AS newer_snapshot_count
                FROM backup_snapshots AS snapshot
                LEFT JOIN backup_snapshots AS newer
                    ON newer.backup_set_id = snapshot.backup_set_id
                    AND newer.backup_sequence > snapshot.backup_sequence
                WHERE snapshot.snapshot_id = ?
                    AND snapshot.backup_set_id = ?
                    AND snapshot.backup_sequence = ?
                    AND snapshot.root_digest = ?
                GROUP BY snapshot.operation_id
            `);
            snapshotStatement.setReadBigInts(true);
            const snapshot = snapshotStatement.get(
                cleanup.snapshot_id,
                cleanup.backup_set_id,
                cleanup.backup_sequence,
                cleanup.root_digest,
            ) as {operation_id: string; newer_snapshot_count: bigint} | undefined;
            if (!snapshot || snapshot.newer_snapshot_count < 2n) {
                throw new Error('Backup cleanup would violate retention');
            }
            this.database.prepare('DELETE FROM backup_snapshots WHERE snapshot_id = ?')
                .run(cleanup.snapshot_id);
            this.database.prepare('DELETE FROM backup_operations WHERE operation_id = ?')
                .run(snapshot.operation_id);
            this.database.prepare('DELETE FROM backup_cleanup_operations WHERE singleton = 1')
                .run();
            this.database.exec('COMMIT');
        }
        catch (error) {
            if (this.database.isTransaction) {
                this.database.exec('ROLLBACK');
            }
            throw error;
        }
    }

    /**
     * Requires a writable, nonterminal DATA connection for protection bookkeeping.
     * @return {void}
     */
    private requireBackupMutationAllowed(): void {
        this.requireOpen();
        if (this.readOnly) {
            throw new Error('Workspace data store is read-only');
        }
    }

    /**
     * Reads both protection watermarks inside the caller-owned DATA transaction.
     * @return {object} Authoritative needed and succeeded revisions.
     */
    private readProtectionWatermarksInsideTransaction(): {
        backup_needed_through: bigint;
        backup_succeeded_through: bigint;
    } {
        const statement = this.database.prepare(`
            SELECT backup_needed_through, backup_succeeded_through
            FROM protection_watermarks
            WHERE singleton = 1
        `);
        statement.setReadBigInts(true);
        return statement.get() as {
            backup_needed_through: bigint;
            backup_succeeded_through: bigint;
        };
    }

    /**
     * Reads the latest operation matching one internal fixed SQL predicate.
     * @param {string} predicate - DATA-owned SQL predicate fragment.
     * @param {...Array<string | bigint>} parameters - Bound predicate parameters.
     * @return {BackupOperationRow | undefined} Matching row when present.
     */
    private readBackupOperationRow(
        predicate: string,
        ...parameters: Array<string | bigint>
    ): BackupOperationRow | undefined {
        const statement = this.database.prepare(`
            SELECT
                operation_id,
                backup_set_id,
                backup_sequence,
                snapshot_id,
                target_revision,
                actual_revision,
                staging_directory_name,
                created_at,
                phase,
                operation_version
            FROM backup_operations
            WHERE ${predicate}
            ORDER BY backup_sequence DESC
            LIMIT 1
        `);
        statement.setReadBigInts(true);
        return statement.get(...parameters) as BackupOperationRow | undefined;
    }

    /**
     * Reads the singleton cleanup journal row inside or outside a caller-owned transaction.
     * @return {BackupCleanupOperationRow | undefined} Active cleanup storage row.
     */
    private readBackupCleanupOperationRow(): BackupCleanupOperationRow | undefined {
        const statement = this.database.prepare(`
            SELECT
                operation_id,
                backup_set_id,
                snapshot_id,
                backup_sequence,
                root_digest,
                snapshot_directory_name,
                quarantine_directory_name,
                phase,
                operation_version
            FROM backup_cleanup_operations
            WHERE singleton = 1
        `);
        statement.setReadBigInts(true);
        return statement.get() as BackupCleanupOperationRow | undefined;
    }

    /**
     * Requires one persisted operation identity.
     * @param {string} operationId - Canonical operation UUID.
     * @return {BackupOperationRow} Matching typed storage row.
     */
    private requireBackupOperationRow(operationId: string): BackupOperationRow {
        const operation = this.readBackupOperationRow('operation_id = ?', operationId);
        if (!operation) {
            throw new Error('Backup operation does not exist');
        }
        return operation;
    }

    /**
     * Applies one synchronous phase mutation inside an immediate transaction.
     * @param {string} operationId - Canonical operation UUID.
     * @param {function(BackupOperationRow): boolean} mutation - Validated row mutation.
     * @return {BackupOperation} Re-read immutable operation facts.
     */
    private mutateBackupOperation(
        operationId: string,
        mutation: (operation: BackupOperationRow) => boolean,
    ): BackupOperation {
        try {
            this.database.exec('BEGIN IMMEDIATE');
            const operation = this.requireBackupOperationRow(operationId);
            mutation(operation);
            const updated = this.requireBackupOperationRow(operationId);
            this.database.exec('COMMIT');
            return backupOperationFromRow(updated);
        }
        catch (error) {
            if (this.database.isTransaction) {
                this.database.exec('ROLLBACK');
            }
            throw error;
        }
    }

    /**
     * Reads one immutable success record for idempotent replay comparison.
     * @param {string} operationId - Canonical succeeded operation UUID.
     * @return {SuccessfulBackupSnapshot} Registered snapshot facts.
     */
    private readSuccessfulBackupSnapshot(operationId: string): SuccessfulBackupSnapshot {
        const statement = this.database.prepare(`
            SELECT
                snapshot_id,
                backup_set_id,
                backup_sequence,
                actual_revision,
                root_digest,
                succeeded_at
            FROM backup_snapshots
            WHERE operation_id = ?
        `);
        statement.setReadBigInts(true);
        const row = statement.get(operationId) as {
            snapshot_id: string;
            backup_set_id: string;
            backup_sequence: bigint;
            actual_revision: bigint;
            root_digest: string;
            succeeded_at: string;
        } | undefined;
        if (!row) {
            throw new Error('Succeeded backup operation has no snapshot record');
        }
        return Object.freeze({
            snapshotId: row.snapshot_id,
            backupSetId: row.backup_set_id,
            backupSequence: row.backup_sequence.toString(),
            actualRevision: row.actual_revision.toString(),
            rootDigest: row.root_digest,
            succeededAt: row.succeeded_at,
        });
    }

    /**
     * Reads the path-free PROTECT projection from one authoritative row.
     * @return {DataProtectionProjection} Legal unconfigured or configured state.
     */
    public readDataProtectionProjection(): DataProtectionProjection {
        this.requireOpen();
        const statement = this.database.prepare(`
            SELECT
                workspace_state.revision,
                backup_configuration.configuration_version,
                backup_configuration.backup_set_id,
                backup_configuration.repository_schema,
                backup_configuration.destination_display_name,
                protection_watermarks.backup_needed_through,
                protection_watermarks.backup_succeeded_through,
                backup_cleanup_operations.operation_id AS cleanup_operation_id,
                (
                    SELECT count(*)
                    FROM backup_snapshots
                    WHERE backup_snapshots.backup_set_id = backup_configuration.backup_set_id
                ) AS registered_snapshot_count
            FROM workspace_state
            JOIN backup_configuration
                ON backup_configuration.singleton = workspace_state.singleton
            JOIN protection_watermarks
                ON protection_watermarks.singleton = workspace_state.singleton
            LEFT JOIN backup_cleanup_operations
                ON backup_cleanup_operations.singleton = workspace_state.singleton
            WHERE workspace_state.singleton = 1
        `);
        statement.setReadBigInts(true);
        const row = statement.get() as {
            revision: bigint;
            configuration_version: bigint;
            backup_set_id: string | null;
            repository_schema: typeof BACKUP_REPOSITORY_SCHEMA | null;
            destination_display_name: string | null;
            backup_needed_through: bigint;
            backup_succeeded_through: bigint;
            cleanup_operation_id: string | null;
            registered_snapshot_count: bigint;
        };
        if (row.backup_set_id === null) {
            return Object.freeze({
                workspaceRevision: row.revision.toString(),
                protectionEntityVersion: row.configuration_version.toString(),
                configuration: Object.freeze({kind: 'unconfigured' as const}),
            });
        }
        const snapshots = this.readSuccessfulBackupSnapshots()
            .slice(-2)
            .reverse()
            .map(snapshot => Object.freeze({
                snapshotId: snapshot.snapshotId,
                backupSequence: snapshot.backupSequence,
                actualRevision: snapshot.actualRevision,
                succeededAt: snapshot.succeededAt,
                snapshotFormatVersion: '1' as const,
                integrity: 'verified' as const,
            }));
        const latest = snapshots[0];
        return Object.freeze({
            workspaceRevision: row.revision.toString(),
            protectionEntityVersion: row.configuration_version.toString(),
            configuration: Object.freeze({
                kind: 'configured' as const,
                backupSetId: row.backup_set_id,
                repositorySchema: row.repository_schema!,
                destinationDisplayName: row.destination_display_name!,
            }),
            backup: Object.freeze({
                state: row.backup_needed_through === row.backup_succeeded_through
                    ? 'current' as const
                    : 'pending' as const,
                neededThrough: row.backup_needed_through.toString(),
                succeededThrough: row.backup_succeeded_through.toString(),
                lastSuccess: latest
                    ? Object.freeze({
                        snapshotId: latest.snapshotId,
                        protectedThrough: latest.actualRevision,
                        succeededAt: latest.succeededAt,
                    })
                    : null,
                recentVerifiedSnapshots: Object.freeze(snapshots),
                restoreCandidates: Object.freeze([]),
                cleanup: row.cleanup_operation_id === null
                    && row.registered_snapshot_count <= 2n
                    ? 'idle' as const
                    : 'pending' as const,
            }),
        });
    }

    /**
     * Reads the path-bearing internal configuration used only by the PROTECT worker.
     * @return {BackupConfigurationForProtection | null} Current configured BackupSet facts.
     */
    public readBackupConfigurationForProtection(): BackupConfigurationForProtection | null {
        this.requireOpen();
        const row = this.database.prepare(`
            SELECT
                workspace_state.workspace_id,
                backup_configuration.backup_set_id,
                backup_configuration.canonical_destination_path,
                backup_configuration.destination_display_name,
                backup_configuration.repository_schema
            FROM workspace_state
            JOIN backup_configuration
                ON backup_configuration.singleton = workspace_state.singleton
            WHERE workspace_state.singleton = 1
        `).get() as {
            workspace_id: string;
            backup_set_id: string | null;
            canonical_destination_path: string | null;
            destination_display_name: string | null;
            repository_schema: typeof BACKUP_REPOSITORY_SCHEMA | null;
        };
        if (row.backup_set_id === null) {
            return null;
        }
        return Object.freeze({
            workspaceId: row.workspace_id,
            backupSetId: row.backup_set_id,
            canonicalPath: row.canonical_destination_path!,
            displayName: row.destination_display_name!,
            repositorySchema: row.repository_schema!,
        });
    }

    /**
     * Reads every typed pre-checkpoint RestoreSession for restart reconstruction.
     * @return {readonly StoredRestoreSession[]} Sessions ordered by stable identity.
     */
    public readRestoreSessions(): readonly StoredRestoreSession[] {
        this.requireOpen();
        const statement = this.database.prepare(`
            SELECT *
            FROM restore_sessions
            ORDER BY restore_session_id
        `);
        statement.setReadBigInts(true);
        return Object.freeze((statement.all() as RestoreSessionRow[]).map(restoreSessionFromRow));
    }

    /**
     * Reads one durable restore command receipt for exact CommandId replay.
     * @param {string} commandId - Canonical command identity.
     * @return {StoredRestoreCommandReceipt | null} Matching receipt or null.
     */
    public readRestoreCommandReceipt(commandId: string): StoredRestoreCommandReceipt | null {
        this.requireOpen();
        if (!isCanonicalUuid(commandId)) {
            throw new TypeError('Restore CommandId is invalid');
        }
        const row = this.database.prepare(`
            SELECT
                command_id,
                command_kind,
                payload_digest,
                restore_session_id,
                result_session_version
            FROM restore_command_receipts
            WHERE command_id = ?
        `).get(commandId) as {
            command_id: string;
            command_kind: 'start' | 'confirm' | 'cancel';
            payload_digest: Uint8Array;
            restore_session_id: string;
            result_session_version: bigint;
        } | undefined;
        return row
            ? Object.freeze({
                commandId: row.command_id,
                commandKind: row.command_kind,
                payloadDigest: Buffer.from(row.payload_digest).toString('hex'),
                restoreSessionId: row.restore_session_id,
                resultSessionVersion: row.result_session_version.toString(),
            })
            : null;
    }

    /**
     * Reads and verifies the typed receipt for one completed Restore activation.
     * @param {string} operationId - Stable Restore operation identity.
     * @return {RestoreCompletionReceipt | null} Exact receipt or null.
     */
    public readRestoreCompletionReceipt(operationId: string): RestoreCompletionReceipt | null {
        this.requireOpen();
        if (!isCanonicalUuid(operationId)) {
            throw new TypeError('Restore OperationId is invalid');
        }
        const row = this.database.prepare(`
            SELECT *
            FROM restore_completion_receipts
            WHERE operation_id = ?
        `).get(operationId) as RestoreCompletionReceiptRow | undefined;
        if (!row) {
            return null;
        }
        const receipt = restoreCompletionReceiptFromRow(row);
        const {receiptDigest, ...input} = receipt;
        const observedDigest = createHash('sha256')
            .update(canonicalJson(input), 'utf8')
            .digest('hex');
        if (observedDigest !== receiptDigest) {
            throw new Error('Restore completion receipt digest is invalid');
        }
        return receipt;
    }

    /**
     * Commits a path-free success or rollback receipt against this exact reopened DATA.
     * @param {RestoreCompletionReceiptInput} input - Reopen-validated completion facts.
     * @return {RestoreCompletionReceipt} New or idempotently replayed receipt.
     */
    public recordRestoreCompletionReceipt(
        input: RestoreCompletionReceiptInput,
    ): RestoreCompletionReceipt {
        this.requireBackupMutationAllowed();
        requireRestoreCompletionReceiptInput(input);
        if (input.activeWorkspaceId !== this.workspaceId
            || input.activeRevision !== this.revision.toString()) {
            throw new Error('Restore receipt does not match active DATA');
        }
        const receiptDigest = createHash('sha256')
            .update(canonicalJson(input), 'utf8')
            .digest('hex');
        const existing = this.readRestoreCompletionReceipt(input.operationId);
        if (existing) {
            if (existing.receiptDigest !== receiptDigest) {
                throw new Error('Restore completion receipt conflict');
            }
            return existing;
        }
        try {
            this.database.exec('BEGIN IMMEDIATE');
            const sessionRows = this.database.prepare(`
                SELECT
                    restore_session_id,
                    operation_id,
                    phase,
                    session_version,
                    safety_set_id
                FROM restore_sessions
                WHERE restore_session_id = ? OR operation_id = ?
            `).all(input.restoreSessionId, input.operationId) as Array<{
                restore_session_id: string;
                operation_id: string;
                phase: StoredRestoreSession['phase'];
                session_version: number;
                safety_set_id: string | null;
            }>;
            if (sessionRows.length > 1
                || (sessionRows.length === 1
                    && (sessionRows[0]!.restore_session_id !== input.restoreSessionId
                        || sessionRows[0]!.operation_id !== input.operationId
                        || sessionRows[0]!.phase !== 'protection-established'
                        || sessionRows[0]!.session_version !== 1
                        || sessionRows[0]!.safety_set_id !== input.protection.safetySetId))) {
                throw new Error('Restore completion conflicts with pre-checkpoint DATA facts');
            }
            if (sessionRows.length === 1) {
                this.database.prepare(`
                    DELETE FROM restore_command_receipts
                    WHERE restore_session_id = ?
                `).run(input.restoreSessionId);
                this.database.prepare(`
                    DELETE FROM restore_sessions
                    WHERE restore_session_id = ? AND operation_id = ?
                `).run(input.restoreSessionId, input.operationId);
            }
            this.database.prepare(`
                INSERT INTO restore_completion_receipts (
                    operation_id,
                    restore_session_id,
                    outcome,
                    session_version,
                    source_snapshot_id,
                    source_root_digest,
                    source_schema_level,
                    post_migration_schema_level,
                    active_workspace_id,
                    active_revision,
                    library_state,
                    protection_mode,
                    safety_set_id,
                    plan_digest,
                    precommit_sequence,
                    precommit_record_digest,
                    route,
                    receipt_format_version,
                    receipt_digest
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'absent', 'required', ?, ?, ?, ?, ?, '1', ?)
            `).run(
                input.operationId,
                input.restoreSessionId,
                input.outcome,
                BigInt(input.sessionVersion),
                input.sourceSnapshotId,
                input.sourceRootDigest,
                BigInt(input.sourceSchemaLevel),
                BigInt(input.postMigrationSchemaLevel),
                input.activeWorkspaceId,
                BigInt(input.activeRevision),
                input.protection.safetySetId,
                input.planDigest,
                BigInt(input.precommit.sequence),
                input.precommit.recordDigest,
                input.route,
                receiptDigest,
            );
            this.database.exec('COMMIT');
        }
        catch (error) {
            this.rollbackOrRequireReopen();
            throw error;
        }
        const stored = this.readRestoreCompletionReceipt(input.operationId);
        if (!stored) {
            throw new Error('Restore completion receipt is missing after commit');
        }
        return stored;
    }

    /**
     * Atomically stores a previewed RestoreSession and its start receipt.
     * @param {StoredRestoreSession} session - Complete preview-bound typed facts.
     * @param {StoredRestoreCommandReceipt} receipt - Matching start receipt.
     * @return {void}
     */
    public createRestoreSession(
        session: StoredRestoreSession,
        receipt: StoredRestoreCommandReceipt,
    ): void {
        this.requireBackupMutationAllowed();
        if (session.phase !== 'previewed'
            || session.sessionVersion !== '0'
            || receipt.commandKind !== 'start'
            || receipt.restoreSessionId !== session.restoreSessionId
            || receipt.resultSessionVersion !== '0'
            || !/^[0-9a-f]{64}$/.test(receipt.payloadDigest)) {
            throw new TypeError('RestoreSession start facts are invalid');
        }
        try {
            this.database.exec('BEGIN IMMEDIATE');
            this.database.prepare(`
                INSERT INTO restore_sessions (
                    restore_session_id,
                    operation_id,
                    candidate_ref,
                    snapshot_id,
                    candidate_root_digest,
                    candidate_database_digest,
                    source_schema_level,
                    prepared_schema_level,
                    candidate_revision,
                    validation_copy,
                    current_workspace_id,
                    current_revision,
                    current_library_kind,
                    current_library_root_id,
                    current_root_generation,
                    target_binding_version,
                    term_count,
                    course_count,
                    task_series_count,
                    impact_digest,
                    binding_digest,
                    preview_token,
                    phase,
                    session_version,
                    problem_code,
                    safety_set_id,
                    safety_protected_revision,
                    safety_root_digest
                ) VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?
                )
            `).run(
                session.restoreSessionId,
                session.operationId,
                session.candidateRef,
                session.snapshotId,
                session.candidateRootDigest,
                session.candidateDatabaseDigest,
                BigInt(session.sourceSchemaLevel),
                BigInt(session.preparedSchemaLevel),
                BigInt(session.candidateRevision),
                session.validationCopy,
                session.currentWorkspaceId,
                BigInt(session.currentRevision),
                session.currentLibrary.kind,
                session.currentLibrary.kind === 'present'
                    ? session.currentLibrary.libraryRootId
                    : null,
                session.currentLibrary.kind === 'present'
                    ? session.currentLibrary.rootGeneration
                    : null,
                BigInt(session.targetBindingVersion),
                BigInt(session.termCount),
                BigInt(session.courseCount),
                BigInt(session.taskSeriesCount),
                session.impactDigest,
                session.bindingDigest,
                session.previewToken,
                session.phase,
                BigInt(session.sessionVersion),
                session.problemCode,
                session.safetySetId,
                session.safetyProtectedRevision === null
                    ? null
                    : BigInt(session.safetyProtectedRevision),
                session.safetyRootDigest,
            );
            this.insertRestoreCommandReceipt(receipt);
            this.database.exec('COMMIT');
        }
        catch (error) {
            this.rollbackOrRequireReopen();
            throw error;
        }
    }

    /**
     * Atomically advances one preview and records its exact confirm receipt.
     * @param {StoredRestoreSession} session - Complete next typed state.
     * @param {string} expectedVersion - Required current session version.
     * @param {StoredRestoreCommandReceipt} receipt - Matching confirmation receipt.
     * @return {void}
     */
    public advanceRestoreSession(
        session: StoredRestoreSession,
        expectedVersion: string,
        receipt: StoredRestoreCommandReceipt,
    ): void {
        this.requireBackupMutationAllowed();
        if (expectedVersion !== '0'
            || session.sessionVersion !== '1'
            || session.phase === 'previewed'
            || receipt.commandKind !== 'confirm'
            || receipt.restoreSessionId !== session.restoreSessionId
            || receipt.resultSessionVersion !== '1'
            || !/^[0-9a-f]{64}$/.test(receipt.payloadDigest)) {
            throw new TypeError('RestoreSession transition facts are invalid');
        }
        try {
            this.database.exec('BEGIN IMMEDIATE');
            const result = this.database.prepare(`
                UPDATE restore_sessions
                SET
                    preview_token = ?,
                    phase = ?,
                    session_version = ?,
                    problem_code = ?,
                    safety_set_id = ?,
                    safety_protected_revision = ?,
                    safety_root_digest = ?
                WHERE restore_session_id = ? AND session_version = ?
            `).run(
                session.previewToken,
                session.phase,
                BigInt(session.sessionVersion),
                session.problemCode,
                session.safetySetId,
                session.safetyProtectedRevision === null
                    ? null
                    : BigInt(session.safetyProtectedRevision),
                session.safetyRootDigest,
                session.restoreSessionId,
                BigInt(expectedVersion),
            );
            if (BigInt(result.changes) !== 1n) {
                throw new Error('RestoreSession version changed');
            }
            this.insertRestoreCommandReceipt(receipt);
            this.database.exec('COMMIT');
        }
        catch (error) {
            this.rollbackOrRequireReopen();
            throw error;
        }
    }

    /**
     * Atomically cancels one pre-checkpoint RestoreSession and records its command receipt.
     * @param {StoredRestoreSession} session - Exact cancelled typed state.
     * @param {string} expectedVersion - Required current session version.
     * @param {StoredRestoreCommandReceipt} receipt - Matching cancellation receipt.
     * @return {void}
     */
    public cancelRestoreSession(
        session: StoredRestoreSession,
        expectedVersion: string,
        receipt: StoredRestoreCommandReceipt,
    ): void {
        this.requireBackupMutationAllowed();
        if (!isCanonicalUnsignedSqliteInteger(expectedVersion)
            || (expectedVersion !== '0' && expectedVersion !== '1')
            || session.sessionVersion !== (BigInt(expectedVersion) + 1n).toString()
            || session.phase !== 'cancelled'
            || session.previewToken !== null
            || session.problemCode !== null
            || receipt.commandKind !== 'cancel'
            || receipt.restoreSessionId !== session.restoreSessionId
            || receipt.resultSessionVersion !== session.sessionVersion
            || !/^[0-9a-f]{64}$/.test(receipt.payloadDigest)) {
            throw new TypeError('RestoreSession cancellation facts are invalid');
        }
        try {
            this.database.exec('BEGIN IMMEDIATE');
            const result = this.database.prepare(`
                UPDATE restore_sessions
                SET
                    preview_token = NULL,
                    phase = 'cancelled',
                    session_version = ?,
                    problem_code = NULL
                WHERE restore_session_id = ?
                    AND session_version = ?
                    AND phase <> 'cancelled'
            `).run(
                BigInt(session.sessionVersion),
                session.restoreSessionId,
                BigInt(expectedVersion),
            );
            if (BigInt(result.changes) !== 1n) {
                throw new Error('RestoreSession version changed');
            }
            this.insertRestoreCommandReceipt(receipt);
            this.database.exec('COMMIT');
        }
        catch (error) {
            this.rollbackOrRequireReopen();
            throw error;
        }
    }

    private insertRestoreCommandReceipt(receipt: StoredRestoreCommandReceipt): void {
        this.database.prepare(`
            INSERT INTO restore_command_receipts (
                command_id,
                command_kind,
                payload_digest,
                restore_session_id,
                result_session_version
            ) VALUES (?, ?, ?, ?, ?)
        `).run(
            receipt.commandId,
            receipt.commandKind,
            Buffer.from(receipt.payloadDigest, 'hex'),
            receipt.restoreSessionId,
            BigInt(receipt.resultSessionVersion),
        );
    }

    /**
     * Revalidates one raw snapshot database as a supported restore candidate.
     * @param {string} candidatePath - Exact immutable snapshot member path.
     * @return {RestoreDatabaseFacts} Fresh identity, revision, schema, and impact facts.
     */
    public inspectRestoreCandidateDatabase(candidatePath: string): RestoreDatabaseFacts {
        this.requireOpen();
        if (!isAbsolute(candidatePath) || candidatePath.includes('\0')) {
            throw new TypeError('Restore candidate database path is invalid');
        }
        const candidate = openDatabase(candidatePath, true);
        try {
            const identity = readDatabaseIdentity(candidate);
            const facts = validateSupportedRestoreSchema(candidate, identity.schemaLevel);
            if (identity.applicationId !== COURSEFLOW_APPLICATION_ID
                || facts === null
                || facts.workspaceId !== this.workspaceId
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
    public prepareRestoreCandidateDatabaseCopy(
        sourcePath: string,
        destinationPath: string,
    ): PreparedRestoreDatabaseFacts {
        this.requireOpen();
        if (!isAbsolute(sourcePath)
            || sourcePath.includes('\0')
            || !isAbsolute(destinationPath)
            || destinationPath.includes('\0')) {
            throw new TypeError('Restore candidate copy paths are invalid');
        }
        const sourceFacts = this.inspectRestoreCandidateDatabase(sourcePath);
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
        const preparedFacts = this.inspectRestoreCandidateDatabase(destinationPath);
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
    public async writeRestoreSafetyDatabaseCopy(
        destinationPath: string,
        expectedRevision: string,
    ): Promise<BackupDatabaseFacts> {
        this.requireBackupMutationAllowed();
        if (!isAbsolute(destinationPath)
            || destinationPath.includes('\0')
            || !isCanonicalUnsignedSqliteInteger(expectedRevision)) {
            throw new TypeError('Restore safety database destination is invalid');
        }
        await backup(this.database, destinationPath);
        normalizeBackupDatabaseCopy(destinationPath);
        return this.validateRestoreSafetyDatabaseCopy(destinationPath, expectedRevision);
    }

    /**
     * Revalidates one healthy RestoreSafetySet DATA member against the current schema.
     * @param {string} copyPath - Exact copied database path.
     * @param {string} minimumRevision - Minimum revision the copy must cover.
     * @return {BackupDatabaseFacts} Fresh current DATA facts.
     */
    public validateRestoreSafetyDatabaseCopy(
        copyPath: string,
        minimumRevision: string,
    ): BackupDatabaseFacts {
        this.requireOpen();
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
                || facts.workspaceId !== this.workspaceId
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
    public async writeBackupDatabaseCopy(
        destinationPath: string,
        targetRevision: string,
    ): Promise<BackupDatabaseFacts> {
        this.requireBackupMutationAllowed();
        if (!isAbsolute(destinationPath)
            || destinationPath.includes('\0')
            || !isCanonicalUnsignedSqliteInteger(targetRevision)
            || targetRevision === '0') {
            throw new TypeError('Backup database destination is invalid');
        }
        await backup(this.database, destinationPath);
        normalizeBackupDatabaseCopy(destinationPath);
        return this.validateBackupDatabaseCopy(destinationPath, targetRevision);
    }

    /**
     * Revalidates one existing backup member without consulting cached checkpoint facts.
     * @param {string} copyPath - Exact copied database path.
     * @param {string} targetRevision - Durable revision the copy must cover.
     * @return {BackupDatabaseFacts} Fresh database identity and actual revision.
     */
    public validateBackupDatabaseCopy(
        copyPath: string,
        targetRevision: string,
    ): BackupDatabaseFacts {
        this.requireOpen();
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
                || facts.workspaceId !== this.workspaceId
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

    /**
     * Recovers accepted destination facts for exact CommandId replay inside Workspace.
     * @param {string} commandId - Durable command identity.
     * @return {StoredBackupDestination | null} Stored internal destination facts.
     */
    public readBackupConfigurationForCommand(commandId: string): StoredBackupDestination | null {
        this.requireOpen();
        if (!isCanonicalUuid(commandId)) {
            throw new TypeError('CommandId must be a canonical UUID');
        }
        const row = this.database.prepare(`
            SELECT
                backup_set_id,
                canonical_destination_path,
                destination_display_name,
                repository_schema
            FROM backup_configuration
            WHERE singleton = 1 AND originating_command_id = ?
        `).get(commandId) as {
            backup_set_id: string;
            canonical_destination_path: string;
            destination_display_name: string;
            repository_schema: typeof BACKUP_REPOSITORY_SCHEMA;
        } | undefined;
        return row
            ? Object.freeze({
                backupSetId: row.backup_set_id,
                canonicalPath: row.canonical_destination_path,
                displayName: row.destination_display_name,
                repositorySchema: row.repository_schema,
            })
            : null;
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
                setup_state.setup_decision_version,
                plan_state.plan_entity_version,
                backup_configuration.configuration_version
            FROM workspace_state
            JOIN setup_state ON setup_state.singleton = workspace_state.singleton
            JOIN plan_state ON plan_state.singleton = workspace_state.singleton
            JOIN backup_configuration ON backup_configuration.singleton = workspace_state.singleton
            WHERE workspace_state.singleton = 1
        `);
        statement.setReadBigInts(true);
        const row = statement.get() as {
            revision: bigint;
            setup_decision_version: bigint;
            plan_entity_version: bigint;
            configuration_version: bigint;
        };
        return {
            revision: row.revision,
            setupVersion: row.setup_decision_version,
            planVersion: row.plan_entity_version,
            protectionVersion: row.configuration_version,
        };
    }

    /**
     * Advances the one-way setup milestone from current formal PLAN facts.
     * @return {void}
     */
    private advanceSetupMinimumMilestone(): void {
        this.database.exec(`
            UPDATE setup_state
            SET ever_reached_minimum = 1
            WHERE singleton = 1
                AND ever_reached_minimum = 0
                AND EXISTS (
                    SELECT 1
                    FROM plan_state
                    JOIN courses ON courses.term_id = plan_state.current_term_id
                        AND courses.archived = 0
                    WHERE plan_state.singleton = 1
                        AND (
                            EXISTS (
                                SELECT 1
                                FROM meeting_series
                                WHERE meeting_series.course_id = courses.course_id
                                    AND meeting_series.retired = 0
                            )
                            OR EXISTS (
                                SELECT 1
                                FROM task_series
                                WHERE task_series.course_id = courses.course_id
                                    AND task_series.retired = 0
                            )
                        )
                )
        `);
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

        const effects = this.database.prepare(`
            SELECT effect_code, entity_kind, entity_id, entity_version
            FROM receipt_effects
            WHERE command_id = ?
            ORDER BY effect_order
        `);
        effects.setReadBigInts(true);
        const effectRows = effects.all(commandId) as Array<{
            effect_code: ReceiptEffect['code'];
            entity_kind: ReceiptEffect['entity']['kind'];
            entity_id: string;
            entity_version: bigint;
        }>;
        const followUp = this.database.prepare(`
            SELECT follow_up_id
            FROM durable_followups
            WHERE originating_command_id = ?
            ORDER BY follow_up_id
        `).get(commandId) as { follow_up_id: string };
        const materializedEffects = effectRows.map((row) => Object.freeze({
            code: row.effect_code,
            entity: Object.freeze({
                kind: row.entity_kind,
                id: row.entity_id,
                version: row.entity_version.toString(),
            }),
        }));
        const undoRow = this.database.prepare(`
            SELECT undo_token, task_series_id, original_logical_anchor
            FROM task_state_history
            WHERE originating_command_id = ?
        `).get(commandId) as {
            undo_token: string;
            task_series_id: string;
            original_logical_anchor: string;
        } | undefined;
        const attachUndoCapability = (outcome: CommandReceiptOutcome): CommandReceiptOutcome => {
            if (!undoRow) {
                return outcome;
            }
            const taskEffect = materializedEffects.find(effect => (
                effect.entity.kind === 'task-series' && effect.entity.id === undoRow.task_series_id
            ));
            if (!taskEffect) {
                throw new Error('Stored Task Undo capability has no matching receipt effect');
            }
            return Object.freeze({
                ...outcome,
                undoCapability: Object.freeze({
                    token: undoRow.undo_token,
                    taskSeriesId: undoRow.task_series_id,
                    originalLogicalAnchor: undoRow.original_logical_anchor,
                    committedRevision: receiptRow.committed_revision.toString(),
                    validThroughTaskSeriesVersion: taskEffect.entity.version,
                }),
            });
        };
        if (materializedEffects.length === 1) {
            const [effect] = materializedEffects;
            return attachUndoCapability(committedOutcome(
                receiptRow.committed_revision,
                effect!.code,
                effect!.entity.kind,
                effect!.entity.id,
                BigInt(effect!.entity.version),
                followUp.follow_up_id,
            ));
        }
        if (materializedEffects.length === 2) {
            return attachUndoCapability(committedPairOutcome(
                receiptRow.committed_revision,
                materializedEffects[0]!,
                materializedEffects[1]!,
                followUp.follow_up_id,
            ));
        }
        throw new Error('Stored receipt outcome has an invalid effect count');
    }

    private commitSynchronously(
        command: WorkspaceDataCommand,
        options: CommitOptions,
    ): DataCommitResult {
        if (isConfigureBackupDestinationCommand(command)) {
            return this.commitBackupConfigurationSynchronously(command, options);
        }
        if (!('expectedPlanVersion' in command)) {
            return this.commitSetupSynchronously(command, options);
        }
        if (isCourseWithMeetingCommand(command)) {
            return this.commitCourseWithMeetingSynchronously(command, options);
        }
        if (isCreateCourseCommand(command)) {
            return this.commitCourseSynchronously(command, options);
        }
        if (isCreateMeetingSeriesCommand(command)) {
            return this.commitMeetingSeriesSynchronously(command, options);
        }
        if (isMeetingOccurrenceMutationCommand(command)) {
            return this.commitMeetingOccurrenceMutationSynchronously(command, options);
        }
        if (isTermMutationCommand(command)) {
            return this.commitTermMutationSynchronously(command, options);
        }
        if (isHolidayRangeCommand(command)) {
            return this.commitHolidayRangeSynchronously(command, options);
        }
        if (isTaskCommand(command)) {
            if (isTaskOccurrenceStateMutationCommand(command)) {
                return this.commitTaskOccurrenceStateSynchronously(command, options);
            }
            if (isTaskOccurrenceRuleMutationCommand(command)) {
                return this.commitTaskOccurrenceRuleSynchronously(command, options);
            }
            return this.commitTaskSynchronously(command, options);
        }
        return this.commitTermSynchronously(command, options);
    }

    /**
     * Commits one setup-draft stream update without advancing formal revision or follow-ups.
     * @param {SetupDraftWork['mutation']} mutation - Validated queued mutation.
     * @param {CommitOptions} options - Transaction failpoint controls used by tests.
     * @return {SetupDraftCheckpointWriteResult} Committed version or unchanged problem.
     */
    private writeSetupDraftSynchronously(
        mutation: SetupDraftWork['mutation'],
        options: CommitOptions,
    ): SetupDraftCheckpointWriteResult {
        let commitAttempted = false;
        try {
            this.database.exec('BEGIN IMMEDIATE');
            const draft = this.database.prepare(`
                SELECT workspace_state.revision, setup_draft_checkpoint.checkpoint_version
                FROM workspace_state
                JOIN setup_draft_checkpoint
                    ON setup_draft_checkpoint.singleton = workspace_state.singleton
                WHERE workspace_state.singleton = 1
            `);
            draft.setReadBigInts(true);
            const row = draft.get() as { revision: bigint; checkpoint_version: bigint };
            if (row.checkpoint_version !== BigInt(mutation.expectedVersion)) {
                this.rollbackOrRequireReopen();
                return setupDraftConflictResult(this.workspaceId, row.revision, row.checkpoint_version);
            }
            if (row.checkpoint_version === SQLITE_INTEGER_MAX) {
                this.rollbackOrRequireReopen();
                throw this.enterTerminalState();
            }

            const newVersion = row.checkpoint_version + 1n;
            if (mutation.kind === 'save') {
                this.database.prepare(`
                    UPDATE setup_draft_checkpoint
                    SET checkpoint_version = ?, schema_version = ?, updated_at = ?, opaque_payload = ?
                    WHERE singleton = 1
                `).run(
                    newVersion,
                    mutation.schemaVersion,
                    mutation.updatedAt,
                    mutation.opaquePayload,
                );
            }
            else {
                this.database.prepare(`
                    UPDATE setup_draft_checkpoint
                    SET checkpoint_version = ?, schema_version = NULL, updated_at = NULL, opaque_payload = NULL
                    WHERE singleton = 1
                `).run(newVersion);
            }

            fireCommitFailpoint(options, 'commit.before-sqlite-commit');
            commitAttempted = true;
            fireCommitFailpoint(options, 'setup-draft.commit-attempted');
            this.database.exec('COMMIT');
            fireCommitFailpoint(options, 'commit.after-sqlite-commit');
            return Object.freeze({
                ok: true as const,
                value: Object.freeze({ draftCheckpointVersion: newVersion.toString() }),
            });
        }
        catch (error) {
            if (this.terminalError) {
                throw this.terminalError;
            }
            if (commitAttempted) {
                throw this.enterTerminalState(new SetupDraftCheckpointOutcomeUnknownError());
            }
            this.rollbackOrRequireReopen();
            if (error instanceof TypeError) {
                throw error;
            }
            const disposition = classifySqliteFailure(error, 'pre-commit');
            if (disposition.kind === 'retryable-unchanged') {
                return setupDraftWriterBusyResult(this.revision);
            }
            if (disposition.kind === 'read-only') {
                this.readOnly = true;
                return setupDraftPermissionResult(this.revision);
            }
            throw new Error('Workspace setup draft write failed');
        }
    }

    private commitBackupConfigurationSynchronously(
        command: AcceptedConfigureBackupDestinationCommand,
        options: CommitOptions,
    ): DataCommitResult {
        const digest = digestConfigureBackupDestination(command);
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
                    return protectionConflictResult('command-id-reused', this.workspaceId, versions);
                }
                const outcome = this.readReceiptOutcome(command.commandId);
                this.rollbackOrRequireReopen();
                if (!outcome) {
                    throw new Error('Stored backup configuration receipt is incomplete');
                }
                return successfulCommit(outcome);
            }

            const versions = this.currentVersions();
            if (command.workspaceId !== this.workspaceId
                || versions.protectionVersion !== BigInt(command.expectedProtectionVersion)) {
                this.rollbackOrRequireReopen();
                return protectionConflictResult('expected-entity-version', this.workspaceId, versions);
            }
            if (versions.revision !== BigInt(command.expectedRevision)) {
                this.rollbackOrRequireReopen();
                return protectionConflictResult('expected-revision', this.workspaceId, versions);
            }
            const current = this.database.prepare(`
                SELECT backup_set_id
                FROM backup_configuration
                WHERE singleton = 1
            `).get() as { backup_set_id: string | null };
            if (current.backup_set_id !== null) {
                this.rollbackOrRequireReopen();
                return protectionConflictResult('expected-entity-version', this.workspaceId, versions);
            }
            fireCommitFailpoint(options, 'commit.after-expected-versions');

            if (versions.revision === SQLITE_INTEGER_MAX
                || versions.protectionVersion === SQLITE_INTEGER_MAX) {
                this.rollbackOrRequireReopen();
                throw this.enterTerminalState();
            }
            const newRevision = versions.revision + 1n;
            const newProtectionVersion = versions.protectionVersion + 1n;
            this.database.prepare(`
                UPDATE backup_configuration
                SET
                    configuration_version = ?,
                    backup_set_id = ?,
                    repository_schema = ?,
                    canonical_destination_path = ?,
                    destination_display_name = ?,
                    originating_command_id = ?,
                    configured_revision = ?
                WHERE singleton = 1
            `).run(
                newProtectionVersion,
                command.destination.backupSetId,
                command.destination.repositorySchema,
                command.destination.canonicalPath,
                command.destination.displayName,
                command.commandId,
                newRevision,
            );
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
                    ?, 'protect.configure-backup-destination', 1,
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
                ) VALUES (
                    ?, 0, 'protect.backup-destination-configured',
                    'backup-configuration', ?, ?
                )
            `).run(command.commandId, command.destination.backupSetId, newProtectionVersion);
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
                throw new Error('Committed backup configuration receipt is missing');
            }
            return successfulCommit(outcome);
        }
        catch (error) {
            if (this.terminalError) {
                throw this.terminalError;
            }
            if (commitAttempted) {
                throw this.enterTerminalState(new CommittedCommandOutcomeUnknownError(command.commandId));
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
            throw new Error('Workspace backup configuration commit failed');
        }
    }

    private commitSetupSynchronously(
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

    private commitTermSynchronously(
        command: CreateTermCommand,
        options: CommitOptions,
    ): DataCommitResult {
        const digest = digestCreateTerm(command);
        const termId = randomUUID();
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
                    return planConflictResult('command-id-reused', versions);
                }

                const outcome = this.readReceiptOutcome(command.commandId);
                this.rollbackOrRequireReopen();
                if (!outcome) {
                    throw new Error('Stored receipt outcome is incomplete');
                }
                return successfulCommit(outcome);
            }

            const versions = this.currentVersions();
            if (versions.revision !== BigInt(command.expectedRevision)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-revision', versions);
            }
            if (versions.planVersion !== BigInt(command.expectedPlanVersion)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-entity-version', versions);
            }
            fireCommitFailpoint(options, 'commit.after-expected-versions');

            if (versions.revision === SQLITE_INTEGER_MAX || versions.planVersion === SQLITE_INTEGER_MAX) {
                this.rollbackOrRequireReopen();
                throw this.enterTerminalState();
            }

            const newRevision = versions.revision + 1n;
            const newPlanVersion = versions.planVersion + 1n;
            const payload = command.intent.payload;
            this.database.prepare(`
                INSERT INTO terms (
                    term_id,
                    name,
                    start_date,
                    end_date,
                    time_zone,
                    archived,
                    entity_version
                ) VALUES (?, ?, ?, ?, ?, 0, 1)
            `).run(termId, payload.name, payload.startDate, payload.endDate, payload.timeZone);
            this.database.prepare(`
                UPDATE plan_state
                SET current_term_id = ?, plan_entity_version = ?
                WHERE singleton = 1
            `).run(termId, newPlanVersion);
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
                    ?, 'plan.create-term', 1,
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
                ) VALUES (?, 0, 'plan.term-created-current', 'term', ?, 1)
            `).run(command.commandId, termId);
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
        }
        catch (error) {
            if (this.terminalError) {
                throw this.terminalError;
            }
            if (commitAttempted) {
                throw this.enterTerminalState(new CommittedCommandOutcomeUnknownError(command.commandId));
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

    private commitCourseSynchronously(
        command: CreateCourseCommand,
        options: CommitOptions,
    ): DataCommitResult {
        const digest = digestCreateCourse(command);
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
                    return planConflictResult('command-id-reused', versions);
                }
                const outcome = this.readReceiptOutcome(command.commandId);
                this.rollbackOrRequireReopen();
                if (!outcome) {
                    throw new Error('Stored receipt outcome is incomplete');
                }
                return successfulCommit(outcome);
            }

            const versions = this.currentVersions();
            if (versions.revision !== BigInt(command.expectedRevision)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-revision', versions);
            }
            if (versions.planVersion !== BigInt(command.expectedPlanVersion)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-entity-version', versions);
            }
            fireCommitFailpoint(options, 'commit.after-expected-versions');

            const term = this.database.prepare(`
                SELECT terms.term_id, terms.start_date, terms.end_date
                FROM plan_state
                JOIN terms ON terms.term_id = plan_state.current_term_id
                WHERE plan_state.singleton = 1
            `).get() as {
                term_id: string;
                start_date: string;
                end_date: string;
            } | undefined;
            if (!term) {
                this.rollbackOrRequireReopen();
                throw new TypeError('Course requires a Current Term');
            }
            const course = command.intent.payload.course;
            const teachingStartDate = course.teachingRange.kind === 'inherit-term'
                ? term.start_date
                : course.teachingRange.startDate;
            const teachingEndDate = course.teachingRange.kind === 'inherit-term'
                ? term.end_date
                : course.teachingRange.endDate;
            if (teachingStartDate < term.start_date || teachingEndDate > term.end_date) {
                this.rollbackOrRequireReopen();
                throw new TypeError('Course range must remain inside its Current Term');
            }
            if (versions.revision === SQLITE_INTEGER_MAX || versions.planVersion === SQLITE_INTEGER_MAX) {
                this.rollbackOrRequireReopen();
                throw this.enterTerminalState();
            }

            const newRevision = versions.revision + 1n;
            const newPlanVersion = versions.planVersion + 1n;
            const courseId = randomUUID();
            const [creditsCoefficient, creditsScale] = decimalToCoefficient(course.credits);
            this.database.prepare(`
                INSERT INTO courses (
                    course_id,
                    term_id,
                    code,
                    name,
                    section,
                    instructor,
                    color,
                    credits_coefficient,
                    credits_scale,
                    teaching_range_kind,
                    teaching_start_date,
                    teaching_end_date,
                    archived,
                    entity_version
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)
            `).run(
                courseId,
                term.term_id,
                course.code,
                course.name,
                course.section,
                course.instructor,
                course.color,
                creditsCoefficient,
                creditsScale,
                course.teachingRange.kind,
                course.teachingRange.kind === 'explicit' ? course.teachingRange.startDate : null,
                course.teachingRange.kind === 'explicit' ? course.teachingRange.endDate : null,
            );
            this.database.prepare(`
                UPDATE plan_state
                SET plan_entity_version = ?
                WHERE singleton = 1
            `).run(newPlanVersion);
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
                    ?, 'plan.create-course', 1,
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
                ) VALUES (?, 0, 'plan.course-created', 'course', ?, 1)
            `).run(command.commandId, courseId);
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
        }
        catch (error) {
            if (this.terminalError) {
                throw this.terminalError;
            }
            if (commitAttempted) {
                throw this.enterTerminalState(new CommittedCommandOutcomeUnknownError(command.commandId));
            }
            this.rollbackOrRequireReopen();
            if (error instanceof TypeError) {
                throw error;
            }
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

    private commitMeetingSeriesSynchronously(
        command: CreateMeetingSeriesCommand,
        options: CommitOptions,
    ): DataCommitResult {
        const digest = digestCreateMeetingSeries(command);
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
                    return planConflictResult('command-id-reused', versions);
                }
                const outcome = this.readReceiptOutcome(command.commandId);
                this.rollbackOrRequireReopen();
                if (!outcome) {
                    throw new Error('Stored receipt outcome is incomplete');
                }
                return successfulCommit(outcome);
            }

            const versions = this.currentVersions();
            if (versions.revision !== BigInt(command.expectedRevision)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-revision', versions);
            }
            if (versions.planVersion !== BigInt(command.expectedPlanVersion)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-entity-version', versions);
            }
            const courseStatement = this.database.prepare(`
                SELECT
                    courses.course_id,
                    courses.code,
                    courses.teaching_range_kind,
                    courses.teaching_start_date,
                    courses.teaching_end_date,
                    courses.entity_version,
                    terms.term_id,
                    terms.start_date AS term_start_date,
                    terms.end_date AS term_end_date,
                    terms.time_zone
                FROM courses
                JOIN plan_state ON plan_state.current_term_id = courses.term_id
                JOIN terms ON terms.term_id = courses.term_id
                WHERE plan_state.singleton = 1
                    AND courses.course_id = ?
                    AND courses.archived = 0
            `);
            courseStatement.setReadBigInts(true);
            const course = courseStatement.get(command.intent.payload.courseId) as {
                course_id: string;
                code: string;
                teaching_range_kind: CourseTeachingRangeIntent['kind'];
                teaching_start_date: string | null;
                teaching_end_date: string | null;
                entity_version: bigint;
                term_id: string;
                term_start_date: string;
                term_end_date: string;
                time_zone: string;
            } | undefined;
            if (!course) {
                this.rollbackOrRequireReopen();
                throw new TypeError('Meeting requires an active Course in the Current Term');
            }
            if (course.entity_version !== BigInt(command.expectedCourseVersion)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-entity-version', versions);
            }
            fireCommitFailpoint(options, 'commit.after-expected-versions');

            const teachingStartDate = course.teaching_range_kind === 'inherit-term'
                ? course.term_start_date
                : course.teaching_start_date!;
            const teachingEndDate = course.teaching_range_kind === 'inherit-term'
                ? course.term_end_date
                : course.teaching_end_date!;
            const meeting = command.intent.payload.meeting;
            const effectiveStartDate = meeting.effectiveRange.kind === 'inherit-course'
                ? teachingStartDate
                : meeting.effectiveRange.startDate;
            const effectiveEndDate = meeting.effectiveRange.kind === 'inherit-course'
                ? teachingEndDate
                : meeting.effectiveRange.endDate;
            if (effectiveStartDate < teachingStartDate || effectiveEndDate > teachingEndDate) {
                this.rollbackOrRequireReopen();
                throw new TypeError('Meeting range must remain inside its Course');
            }
            const logicalStartAnchor = firstWeeklyLogicalAnchor(effectiveStartDate, meeting.weekday);
            const proposedOccurrences = expandConflictMeetingOccurrences(
                Object.freeze({
                    courseId: null,
                    courseCode: course.code,
                    meetingSeriesId: null,
                }),
                course.time_zone,
                [Object.freeze({
                    meeting_segment_id: command.commandId,
                    meeting_type: meeting.type,
                    weekday: meeting.weekday,
                    local_start: meeting.localStart,
                    local_end: meeting.localEnd,
                    end_day_offset: meeting.endDayOffset,
                    logical_start_anchor: logicalStartAnchor,
                    logical_end_anchor: null,
                    effective_range_kind: meeting.effectiveRange.kind,
                    effective_start_date: meeting.effectiveRange.kind === 'explicit'
                        ? meeting.effectiveRange.startDate
                        : null,
                    effective_end_date: meeting.effectiveRange.kind === 'explicit'
                        ? meeting.effectiveRange.endDate
                        : null,
                    resolved_start_date: effectiveStartDate,
                    resolved_end_date: effectiveEndDate,
                    location_kind: meeting.location.kind,
                    location_value: meeting.location.kind === 'known' ? meeting.location.value : null,
                })],
                [],
                this.readActiveHolidayRanges(course.term_id),
                Object.freeze({ startDate: effectiveStartDate, endDate: effectiveEndDate }),
            );
            const overlapWindow = Object.freeze({
                startDate: addClampedLocalDateDays(effectiveStartDate, -3),
                endDate: addClampedLocalDateDays(effectiveEndDate, 3),
            });
            const overlapWarnings = meetingOverlapWarnings(
                command.commandId,
                proposedOccurrences,
                this.readConflictMeetingOccurrences(overlapWindow, course.term_id),
            );
            if (command.overlapDecision === 'review' && overlapWarnings.length > 0) {
                this.rollbackOrRequireReopen();
                return meetingOverlapDecisionRequiredResult(versions.revision, overlapWarnings);
            }
            if (versions.revision === SQLITE_INTEGER_MAX || versions.planVersion === SQLITE_INTEGER_MAX) {
                this.rollbackOrRequireReopen();
                throw this.enterTerminalState();
            }

            const newRevision = versions.revision + 1n;
            const newPlanVersion = versions.planVersion + 1n;
            const meetingSeriesId = randomUUID();
            const meetingSegmentId = randomUUID();
            this.database.prepare(`
                INSERT INTO meeting_series (
                    meeting_series_id,
                    course_id,
                    retired,
                    entity_version
                ) VALUES (?, ?, 0, 1)
            `).run(meetingSeriesId, course.course_id);
            this.database.prepare(`
                INSERT INTO meeting_segments (
                    meeting_segment_id,
                    meeting_series_id,
                    meeting_type,
                    weekday,
                    local_start,
                    local_end,
                    end_day_offset,
                    logical_start_anchor,
                    logical_end_anchor,
                    effective_range_kind,
                    effective_start_date,
                    effective_end_date,
                    location_kind,
                    location_value
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                meetingSegmentId,
                meetingSeriesId,
                meeting.type,
                meeting.weekday,
                meeting.localStart,
                meeting.localEnd,
                meeting.endDayOffset,
                logicalStartAnchor,
                null,
                meeting.effectiveRange.kind,
                meeting.effectiveRange.kind === 'explicit' ? meeting.effectiveRange.startDate : null,
                meeting.effectiveRange.kind === 'explicit' ? meeting.effectiveRange.endDate : null,
                meeting.location.kind,
                meeting.location.kind === 'known' ? meeting.location.value : null,
            );
            this.database.prepare(`
                UPDATE plan_state
                SET plan_entity_version = ?
                WHERE singleton = 1
            `).run(newPlanVersion);
            this.advanceSetupMinimumMilestone();
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
                    ?, 'plan.create-meeting-series', 1,
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
                ) VALUES (?, 0, 'plan.meeting-series-created', 'meeting-series', ?, 1)
            `).run(command.commandId, meetingSeriesId);
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
        }
        catch (error) {
            if (this.terminalError) {
                throw this.terminalError;
            }
            if (commitAttempted) {
                throw this.enterTerminalState(new CommittedCommandOutcomeUnknownError(command.commandId));
            }
            this.rollbackOrRequireReopen();
            if (error instanceof TypeError) {
                throw error;
            }
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

    private commitCourseWithMeetingSynchronously(
        command: AcceptedCreateCourseWithMeetingCommand,
        options: CommitOptions,
    ): DataCommitResult {
        const digest = digestCreateCourseWithMeeting(command);
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
                    return planConflictResult('command-id-reused', versions);
                }

                const outcome = this.readReceiptOutcome(command.commandId);
                this.rollbackOrRequireReopen();
                if (!outcome) {
                    throw new Error('Stored receipt outcome is incomplete');
                }
                return successfulCommit(outcome);
            }
            if (!isCurrentCourseWithMeetingCommand(command)) {
                this.rollbackOrRequireReopen();
                throw new TypeError('Legacy Course commands are replay-only');
            }

            const versions = this.currentVersions();
            if (versions.revision !== BigInt(command.expectedRevision)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-revision', versions);
            }
            if (versions.planVersion !== BigInt(command.expectedPlanVersion)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-entity-version', versions);
            }
            fireCommitFailpoint(options, 'commit.after-expected-versions');

            const term = this.database.prepare(`
                SELECT terms.term_id, terms.start_date, terms.end_date, terms.time_zone
                FROM plan_state
                JOIN terms ON terms.term_id = plan_state.current_term_id
                WHERE plan_state.singleton = 1
            `).get() as {
                term_id: string;
                start_date: string;
                end_date: string;
                time_zone: string;
            } | undefined;
            const payload = command.intent.payload;
            if (!term) {
                this.rollbackOrRequireReopen();
                throw new TypeError('Course requires a Current Term');
            }
            const teachingStartDate = payload.course.teachingRange.kind === 'inherit-term'
                ? term.start_date
                : payload.course.teachingRange.startDate;
            const teachingEndDate = payload.course.teachingRange.kind === 'inherit-term'
                ? term.end_date
                : payload.course.teachingRange.endDate;
            const effectiveStartDate = payload.meeting.effectiveRange.kind === 'inherit-course'
                ? teachingStartDate
                : payload.meeting.effectiveRange.startDate;
            const effectiveEndDate = payload.meeting.effectiveRange.kind === 'inherit-course'
                ? teachingEndDate
                : payload.meeting.effectiveRange.endDate;
            if (teachingStartDate < term.start_date
                || teachingEndDate > term.end_date
                || effectiveStartDate < teachingStartDate
                || effectiveEndDate > teachingEndDate) {
                this.rollbackOrRequireReopen();
                throw new TypeError('Course and Meeting ranges must remain inside their owners');
            }
            const logicalStartAnchor = firstWeeklyLogicalAnchor(
                effectiveStartDate,
                payload.meeting.weekday,
            );
            const proposedOccurrences = expandConflictMeetingOccurrences(
                Object.freeze({
                    courseId: null,
                    courseCode: payload.course.code,
                    meetingSeriesId: null,
                }),
                term.time_zone,
                [Object.freeze({
                    meeting_segment_id: command.commandId,
                    meeting_type: payload.meeting.type,
                    weekday: payload.meeting.weekday,
                    local_start: payload.meeting.localStart,
                    local_end: payload.meeting.localEnd,
                    end_day_offset: payload.meeting.endDayOffset,
                    logical_start_anchor: logicalStartAnchor,
                    logical_end_anchor: null,
                    effective_range_kind: payload.meeting.effectiveRange.kind,
                    effective_start_date: payload.meeting.effectiveRange.kind === 'explicit'
                        ? payload.meeting.effectiveRange.startDate
                        : null,
                    effective_end_date: payload.meeting.effectiveRange.kind === 'explicit'
                        ? payload.meeting.effectiveRange.endDate
                        : null,
                    resolved_start_date: effectiveStartDate,
                    resolved_end_date: effectiveEndDate,
                    location_kind: payload.meeting.location.kind,
                    location_value: payload.meeting.location.kind === 'known'
                        ? payload.meeting.location.value
                        : null,
                })],
                [],
                this.readActiveHolidayRanges(term.term_id),
                Object.freeze({ startDate: effectiveStartDate, endDate: effectiveEndDate }),
            );
            const overlapWindow = Object.freeze({
                startDate: addClampedLocalDateDays(effectiveStartDate, -3),
                endDate: addClampedLocalDateDays(effectiveEndDate, 3),
            });
            const overlapWarnings = meetingOverlapWarnings(
                command.commandId,
                proposedOccurrences,
                this.readConflictMeetingOccurrences(overlapWindow, term.term_id),
            );
            if (command.overlapDecision === 'review' && overlapWarnings.length > 0) {
                this.rollbackOrRequireReopen();
                return meetingOverlapDecisionRequiredResult(versions.revision, overlapWarnings);
            }
            if (versions.revision === SQLITE_INTEGER_MAX || versions.planVersion === SQLITE_INTEGER_MAX) {
                this.rollbackOrRequireReopen();
                throw this.enterTerminalState();
            }

            const newRevision = versions.revision + 1n;
            const newPlanVersion = versions.planVersion + 1n;
            const courseId = randomUUID();
            const meetingSeriesId = randomUUID();
            const meetingSegmentId = randomUUID();
            const [creditsCoefficient, creditsScale] = decimalToCoefficient(payload.course.credits);
            this.database.prepare(`
                INSERT INTO courses (
                    course_id,
                    term_id,
                    code,
                    name,
                    section,
                    instructor,
                    color,
                    credits_coefficient,
                    credits_scale,
                    teaching_range_kind,
                    teaching_start_date,
                    teaching_end_date,
                    archived,
                    entity_version
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)
            `).run(
                courseId,
                term.term_id,
                payload.course.code,
                payload.course.name,
                payload.course.section,
                payload.course.instructor,
                payload.course.color,
                creditsCoefficient,
                creditsScale,
                payload.course.teachingRange.kind,
                payload.course.teachingRange.kind === 'explicit'
                    ? payload.course.teachingRange.startDate
                    : null,
                payload.course.teachingRange.kind === 'explicit'
                    ? payload.course.teachingRange.endDate
                    : null,
            );
            this.database.prepare(`
                INSERT INTO meeting_series (
                    meeting_series_id,
                    course_id,
                    retired,
                    entity_version
                ) VALUES (?, ?, 0, 1)
            `).run(meetingSeriesId, courseId);
            this.database.prepare(`
                INSERT INTO meeting_segments (
                    meeting_segment_id,
                    meeting_series_id,
                    meeting_type,
                    weekday,
                    local_start,
                    local_end,
                    end_day_offset,
                    logical_start_anchor,
                    logical_end_anchor,
                    effective_range_kind,
                    effective_start_date,
                    effective_end_date,
                    location_kind,
                    location_value
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                meetingSegmentId,
                meetingSeriesId,
                payload.meeting.type,
                payload.meeting.weekday,
                payload.meeting.localStart,
                payload.meeting.localEnd,
                payload.meeting.endDayOffset,
                logicalStartAnchor,
                null,
                payload.meeting.effectiveRange.kind,
                payload.meeting.effectiveRange.kind === 'explicit'
                    ? payload.meeting.effectiveRange.startDate
                    : null,
                payload.meeting.effectiveRange.kind === 'explicit'
                    ? payload.meeting.effectiveRange.endDate
                    : null,
                payload.meeting.location.kind,
                payload.meeting.location.kind === 'known' ? payload.meeting.location.value : null,
            );
            this.database.prepare(`
                UPDATE plan_state
                SET plan_entity_version = ?
                WHERE singleton = 1
            `).run(newPlanVersion);
            this.advanceSetupMinimumMilestone();
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
                    ?, 'plan.create-course-with-first-meeting', 3,
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
                ) VALUES
                    (?, 0, 'plan.course-created', 'course', ?, 1),
                    (?, 1, 'plan.meeting-series-created', 'meeting-series', ?, 1)
            `).run(command.commandId, courseId, command.commandId, meetingSeriesId);
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
        }
        catch (error) {
            if (this.terminalError) {
                throw this.terminalError;
            }
            if (commitAttempted) {
                throw this.enterTerminalState(new CommittedCommandOutcomeUnknownError(command.commandId));
            }
            this.rollbackOrRequireReopen();
            if (error instanceof TypeError) {
                throw error;
            }
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

    /**
     * Commits one occurrence override or deterministic future segment split atomically.
     * @param {MeetingOccurrenceMutationCommand} command - Normalized versioned mutation.
     * @param {CommitOptions} options - Transaction failpoint controls used by tests.
     * @return {DataCommitResult} Committed receipt or unchanged structured problem.
     */
    private commitMeetingOccurrenceMutationSynchronously(
        command: MeetingOccurrenceMutationCommand,
        options: CommitOptions,
    ): DataCommitResult {
        const digest = isChangeMeetingOccurrenceCommand(command)
            ? digestChangeMeetingOccurrence(command)
            : digestCancelMeetingOccurrence(command);
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
                    return planConflictResult('command-id-reused', versions);
                }

                const outcome = this.readReceiptOutcome(command.commandId);
                this.rollbackOrRequireReopen();
                if (!outcome) {
                    throw new Error('Stored receipt outcome is incomplete');
                }
                return successfulCommit(outcome);
            }

            const versions = this.currentVersions();
            const payload = command.intent.payload;
            if (isChangeMeetingOccurrenceCommand(command)
                && !isCurrentChangeMeetingOccurrenceCommand(command)) {
                this.rollbackOrRequireReopen();
                throw new TypeError('Legacy Meeting occurrence commands are replay-only');
            }
            const seriesStatement = this.database.prepare(`
                SELECT
                    meeting_series.entity_version,
                    meeting_series.retired,
                    courses.course_id,
                    courses.code AS course_code,
                    terms.term_id,
                    terms.time_zone
                FROM meeting_series
                JOIN courses ON courses.course_id = meeting_series.course_id
                JOIN terms ON terms.term_id = courses.term_id
                WHERE meeting_series.meeting_series_id = ?
            `);
            seriesStatement.setReadBigInts(true);
            const series = seriesStatement.get(payload.meetingSeriesId) as {
                entity_version: bigint;
                retired: bigint;
                course_id: string;
                course_code: string;
                term_id: string;
                time_zone: string;
            } | undefined;
            if (!series || series.retired !== 0n) {
                this.rollbackOrRequireReopen();
                throw new TypeError('Meeting series is not editable');
            }
            const isFutureChange = isChangeMeetingOccurrenceCommand(command)
                && command.intent.payload.scope === 'this-and-future';
            if (isFutureChange) {
                const expectedToken = command.impactWindow === null
                    ? null
                    : meetingOccurrenceConfirmationToken(
                        versions.revision.toString(),
                        versions.planVersion.toString(),
                        series.entity_version.toString(),
                        {
                            ...command.intent.payload,
                            scope: 'this-and-future',
                        },
                        command.impactWindow,
                    );
                if (versions.revision !== BigInt(command.expectedRevision)
                    || versions.planVersion !== BigInt(command.expectedPlanVersion)
                    || series.entity_version !== BigInt(command.expectedMeetingSeriesVersion)
                    || expectedToken === null
                    || command.confirmationToken === null
                    || command.confirmationToken !== expectedToken) {
                    this.rollbackOrRequireReopen();
                    return decisionRequiredResult(versions.revision);
                }
            }
            else if (versions.revision !== BigInt(command.expectedRevision)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-revision', versions);
            }
            else if (versions.planVersion !== BigInt(command.expectedPlanVersion)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-entity-version', versions);
            }
            if (series.entity_version !== BigInt(command.expectedMeetingSeriesVersion)) {
                this.rollbackOrRequireReopen();
                return meetingSeriesConflictResult(
                    'expected-entity-version',
                    versions,
                    payload.meetingSeriesId,
                    series.entity_version,
                );
            }
            fireCommitFailpoint(options, 'commit.after-expected-versions');

            const segmentRows = this.database.prepare(`
                SELECT
                    meeting_segments.meeting_segment_id,
                    meeting_segments.meeting_type,
                    meeting_segments.weekday,
                    meeting_segments.local_start,
                    meeting_segments.local_end,
                    meeting_segments.end_day_offset,
                    meeting_segments.logical_start_anchor,
                    meeting_segments.logical_end_anchor,
                    meeting_segments.effective_range_kind,
                    meeting_segments.effective_start_date,
                    meeting_segments.effective_end_date,
                    meeting_segments.location_kind,
                    meeting_segments.location_value,
                    CASE
                        WHEN meeting_segments.effective_range_kind = 'explicit'
                            THEN meeting_segments.effective_start_date
                        WHEN courses.teaching_range_kind = 'explicit'
                            THEN courses.teaching_start_date
                        ELSE terms.start_date
                    END AS resolved_start_date,
                    CASE
                        WHEN meeting_segments.effective_range_kind = 'explicit'
                            THEN meeting_segments.effective_end_date
                        WHEN courses.teaching_range_kind = 'explicit'
                            THEN courses.teaching_end_date
                        ELSE terms.end_date
                    END AS resolved_end_date
                FROM meeting_segments
                JOIN meeting_series
                    ON meeting_series.meeting_series_id = meeting_segments.meeting_series_id
                JOIN courses ON courses.course_id = meeting_series.course_id
                JOIN terms ON terms.term_id = courses.term_id
                WHERE meeting_segments.meeting_series_id = ?
                ORDER BY meeting_segments.logical_start_anchor, meeting_segments.meeting_segment_id
            `).all(payload.meetingSeriesId) as StoredMeetingSegment[];
            validateMeetingSegmentSequence(segmentRows);
            const matchingSegments = segmentRows.filter(candidate => (
                isActiveLogicalAnchor(candidate, payload.originalLogicalAnchor)
            ));
            if (matchingSegments.length !== 1) {
                this.rollbackOrRequireReopen();
                throw new TypeError('Meeting occurrence logical anchor does not exist');
            }
            const segment = matchingSegments[0]!;
            if (isChangeMeetingOccurrenceCommand(command)) {
                const replacementDate = occurrenceDate(
                    payload.originalLogicalAnchor,
                    command.intent.payload.replacement.weekday,
                );
                if (replacementDate === null
                    || replacementDate < segment.resolved_start_date
                    || replacementDate > segment.resolved_end_date) {
                    this.rollbackOrRequireReopen();
                    throw new TypeError('Meeting occurrence replacement falls outside its effective range');
                }
            }
            if (isChangeMeetingOccurrenceCommand(command)
                && isCurrentChangeMeetingOccurrenceCommand(command)) {
                const replacement = command.intent.payload.replacement;
                const proposedObject = Object.freeze({
                    courseId: series.course_id,
                    courseCode: series.course_code,
                    meetingSeriesId: payload.meetingSeriesId,
                });
                let proposedOccurrences: readonly ConflictMeetingOccurrence[];
                if (command.intent.payload.scope === 'only-this') {
                    const date = occurrenceDate(
                        payload.originalLogicalAnchor,
                        replacement.weekday,
                    )!;
                    proposedOccurrences = Object.freeze([Object.freeze({
                        object: proposedObject,
                        meetingType: replacement.type,
                        originalLogicalAnchor: payload.originalLogicalAnchor,
                        date,
                        time: resolveMeetingOccurrenceTime({
                            termZone: series.time_zone,
                            date,
                            localStart: replacement.localStart,
                            localEnd: replacement.localEnd,
                            endDayOffset: replacement.endDayOffset,
                        }),
                    })]);
                }
                else {
                    const retainedOverrides = this.database.prepare(`
                        SELECT
                            original_logical_anchor,
                            override_kind,
                            meeting_type,
                            weekday,
                            local_start,
                            local_end,
                            end_day_offset,
                            location_kind,
                            location_value
                        FROM meeting_occurrence_overrides
                        WHERE meeting_series_id = ? AND original_logical_anchor > ?
                        ORDER BY original_logical_anchor
                    `).all(
                        payload.meetingSeriesId,
                        payload.originalLogicalAnchor,
                    ) as StoredMeetingOverride[];
                    proposedOccurrences = expandConflictMeetingOccurrences(
                        proposedObject,
                        series.time_zone,
                        [Object.freeze({
                            ...segment,
                            meeting_segment_id: command.commandId,
                            meeting_type: replacement.type,
                            weekday: replacement.weekday,
                            local_start: replacement.localStart,
                            local_end: replacement.localEnd,
                            end_day_offset: replacement.endDayOffset,
                            logical_start_anchor: payload.originalLogicalAnchor,
                            logical_end_anchor: segmentRows.at(-1)!.logical_end_anchor,
                            location_kind: replacement.location.kind,
                            location_value: replacement.location.kind === 'known'
                                ? replacement.location.value
                                : null,
                        })],
                        retainedOverrides,
                        this.readActiveHolidayRanges(series.term_id),
                        Object.freeze({
                            startDate: segment.resolved_start_date,
                            endDate: segment.resolved_end_date,
                        }),
                    );
                }
                const candidateDates = proposedOccurrences.map(occurrence => occurrence.date);
                if (candidateDates.length === 0) {
                    this.rollbackOrRequireReopen();
                    throw new TypeError('Meeting occurrence replacement has no effective occurrence');
                }
                const conflictWindow = Object.freeze({
                    startDate: addClampedLocalDateDays(
                        candidateDates.reduce((first, date) => date < first ? date : first),
                        -3,
                    ),
                    endDate: addClampedLocalDateDays(
                        candidateDates.reduce((last, date) => date > last ? date : last),
                        3,
                    ),
                });
                const existingOccurrences = this.readConflictMeetingOccurrences(
                    conflictWindow,
                    series.term_id,
                ).filter(
                    occurrence => occurrence.object.meetingSeriesId !== payload.meetingSeriesId
                        || (command.intent.payload.scope === 'only-this'
                            ? occurrence.originalLogicalAnchor !== payload.originalLogicalAnchor
                            : occurrence.originalLogicalAnchor < payload.originalLogicalAnchor),
                );
                const overlapWarnings = meetingOverlapWarnings(
                    command.commandId,
                    proposedOccurrences,
                    existingOccurrences,
                );
                if (command.overlapDecision === 'review' && overlapWarnings.length > 0) {
                    this.rollbackOrRequireReopen();
                    return meetingOverlapDecisionRequiredResult(versions.revision, overlapWarnings);
                }
            }
            if (versions.revision === SQLITE_INTEGER_MAX
                || versions.planVersion === SQLITE_INTEGER_MAX
                || series.entity_version === SQLITE_INTEGER_MAX) {
                this.rollbackOrRequireReopen();
                throw this.enterTerminalState();
            }

            const newRevision = versions.revision + 1n;
            const newPlanVersion = versions.planVersion + 1n;
            const newSeriesVersion = series.entity_version + 1n;
            if (command.intent.kind === 'plan.cancel-meeting-occurrence') {
                this.database.prepare(`
                    INSERT INTO meeting_occurrence_overrides (
                        meeting_series_id,
                        original_logical_anchor,
                        override_kind,
                        meeting_type,
                        weekday,
                        local_start,
                        local_end,
                        end_day_offset,
                        location_kind,
                        location_value,
                        entity_version
                    ) VALUES (?, ?, 'cancelled', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1)
                    ON CONFLICT (meeting_series_id, original_logical_anchor) DO UPDATE SET
                        override_kind = 'cancelled',
                        meeting_type = NULL,
                        weekday = NULL,
                        local_start = NULL,
                        local_end = NULL,
                        end_day_offset = NULL,
                        location_kind = NULL,
                        location_value = NULL,
                        entity_version = meeting_occurrence_overrides.entity_version + 1
                `).run(payload.meetingSeriesId, payload.originalLogicalAnchor);
            }
            else if (command.intent.payload.scope === 'only-this') {
                const replacement = command.intent.payload.replacement;
                this.database.prepare(`
                    INSERT INTO meeting_occurrence_overrides (
                        meeting_series_id,
                        original_logical_anchor,
                        override_kind,
                        meeting_type,
                        weekday,
                        local_start,
                        local_end,
                        end_day_offset,
                        location_kind,
                        location_value,
                        entity_version
                    ) VALUES (?, ?, 'replaced', ?, ?, ?, ?, ?, ?, ?, 1)
                    ON CONFLICT (meeting_series_id, original_logical_anchor) DO UPDATE SET
                        override_kind = 'replaced',
                        meeting_type = excluded.meeting_type,
                        weekday = excluded.weekday,
                        local_start = excluded.local_start,
                        local_end = excluded.local_end,
                        end_day_offset = excluded.end_day_offset,
                        location_kind = excluded.location_kind,
                        location_value = excluded.location_value,
                        entity_version = meeting_occurrence_overrides.entity_version + 1
                `).run(
                    payload.meetingSeriesId,
                    payload.originalLogicalAnchor,
                    replacement.type,
                    replacement.weekday,
                    replacement.localStart,
                    replacement.localEnd,
                    replacement.endDayOffset,
                    replacement.location.kind,
                    replacement.location.kind === 'known' ? replacement.location.value : null,
                );
            }
            else {
                const replacement = command.intent.payload.replacement;
                const newSegmentId = randomUUID();
                const finalLogicalEndAnchor = segmentRows.at(-1)!.logical_end_anchor;
                this.database.prepare(`
                    DELETE FROM meeting_segments
                    WHERE meeting_series_id = ? AND logical_start_anchor > ?
                `).run(payload.meetingSeriesId, payload.originalLogicalAnchor);
                this.database.prepare(`
                    DELETE FROM meeting_occurrence_overrides
                    WHERE meeting_series_id = ? AND original_logical_anchor = ?
                `).run(payload.meetingSeriesId, payload.originalLogicalAnchor);
                if (payload.originalLogicalAnchor === segment.logical_start_anchor) {
                    this.database.prepare(
                        'DELETE FROM meeting_segments WHERE meeting_segment_id = ?',
                    ).run(segment.meeting_segment_id);
                }
                else {
                    this.database.prepare(`
                        UPDATE meeting_segments
                        SET logical_end_anchor = ?
                        WHERE meeting_segment_id = ?
                    `).run(
                        addLocalDateDays(payload.originalLogicalAnchor, -7),
                        segment.meeting_segment_id,
                    );
                }
                this.database.prepare(`
                    INSERT INTO meeting_segments (
                        meeting_segment_id,
                        meeting_series_id,
                        meeting_type,
                        weekday,
                        local_start,
                        local_end,
                        end_day_offset,
                        logical_start_anchor,
                        logical_end_anchor,
                        effective_range_kind,
                        effective_start_date,
                        effective_end_date,
                        location_kind,
                        location_value
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    newSegmentId,
                    payload.meetingSeriesId,
                    replacement.type,
                    replacement.weekday,
                    replacement.localStart,
                    replacement.localEnd,
                    replacement.endDayOffset,
                    payload.originalLogicalAnchor,
                    finalLogicalEndAnchor,
                    segment.effective_range_kind,
                    segment.effective_start_date,
                    segment.effective_end_date,
                    replacement.location.kind,
                    replacement.location.kind === 'known' ? replacement.location.value : null,
                );
            }
            this.database.prepare(`
                UPDATE meeting_series SET entity_version = ? WHERE meeting_series_id = ?
            `).run(newSeriesVersion, payload.meetingSeriesId);
            this.database.prepare(`
                UPDATE plan_state SET plan_entity_version = ? WHERE singleton = 1
            `).run(newPlanVersion);
            this.advanceSetupMinimumMilestone();
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
                    ?, ?, ?,
                    'courseflow-canonical-json-v1', 'sha256', ?, ?, 'committed'
                )
            `).run(
                command.commandId,
                command.intent.kind,
                command.intent.intentSchemaVersion,
                digest,
                newRevision,
            );
            fireCommitFailpoint(options, 'commit.after-receipt');

            this.database.prepare(`
                INSERT INTO receipt_effects (
                    command_id,
                    effect_order,
                    effect_code,
                    entity_kind,
                    entity_id,
                    entity_version
                ) VALUES (?, 0, ?, 'meeting-series', ?, ?)
            `).run(
                command.commandId,
                command.intent.kind === 'plan.cancel-meeting-occurrence'
                    ? 'plan.meeting-occurrence-cancelled'
                    : 'plan.meeting-occurrence-changed',
                payload.meetingSeriesId,
                newSeriesVersion,
            );
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
        }
        catch (error) {
            if (this.terminalError) {
                throw this.terminalError;
            }
            if (commitAttempted) {
                throw this.enterTerminalState(new CommittedCommandOutcomeUnknownError(command.commandId));
            }
            this.rollbackOrRequireReopen();
            if (error instanceof TypeError) {
                throw error;
            }
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

    /**
     * Commits one named HolidayRange lifecycle transition and its durable receipt atomically.
     * @param {HolidayRangeCommand} command - Normalized create, update, or delete command.
     * @param {CommitOptions} options - Transaction failpoint controls used by tests.
     * @return {DataCommitResult} Committed receipt or unchanged structured problem.
     */
    private commitHolidayRangeSynchronously(
        command: HolidayRangeCommand,
        options: CommitOptions,
    ): DataCommitResult {
        const digest = command.intent.kind === 'plan.create-holiday-range'
            ? digestCreateHolidayRange(command as CreateHolidayRangeCommand)
            : command.intent.kind === 'plan.update-holiday-range'
                ? digestUpdateHolidayRange(command as UpdateHolidayRangeCommand)
                : digestDeleteHolidayRange(command as DeleteHolidayRangeCommand);
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
                    return planConflictResult('command-id-reused', versions);
                }
                const outcome = this.readReceiptOutcome(command.commandId);
                this.rollbackOrRequireReopen();
                if (!outcome) {
                    throw new Error('Stored receipt outcome is incomplete');
                }
                return successfulCommit(outcome);
            }

            const versions = this.currentVersions();
            if (versions.revision !== BigInt(command.expectedRevision)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-revision', versions);
            }
            if (versions.planVersion !== BigInt(command.expectedPlanVersion)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-entity-version', versions);
            }

            const existing = command.intent.kind === 'plan.create-holiday-range'
                ? undefined
                : (() => {
                    const statement = this.database.prepare(`
                        SELECT
                            term_id,
                            name,
                            start_date,
                            end_date,
                            tombstoned,
                            entity_version
                        FROM holiday_ranges
                        WHERE holiday_range_id = ?
                    `);
                    statement.setReadBigInts(true);
                    return statement.get(command.intent.payload.holidayRangeId) as {
                        term_id: string;
                        name: string;
                        start_date: string;
                        end_date: string;
                        tombstoned: bigint;
                        entity_version: bigint;
                    } | undefined;
                })();
            if (command.intent.kind !== 'plan.create-holiday-range') {
                if (!existing || existing.tombstoned !== 0n) {
                    this.rollbackOrRequireReopen();
                    throw new TypeError('HolidayRange is not editable');
                }
                const expectedHolidayRangeVersion = (command as (
                    UpdateHolidayRangeCommand | DeleteHolidayRangeCommand
                )).expectedHolidayRangeVersion;
                if (existing.entity_version !== BigInt(expectedHolidayRangeVersion)) {
                    this.rollbackOrRequireReopen();
                    return holidayRangeConflictResult(
                        versions,
                        command.intent.payload.holidayRangeId,
                        existing.entity_version,
                    );
                }
            }
            fireCommitFailpoint(options, 'commit.after-expected-versions');

            const termId = command.intent.kind === 'plan.create-holiday-range'
                ? command.intent.payload.termId
                : existing!.term_id;
            const term = this.database.prepare(`
                SELECT start_date, end_date
                FROM terms
                WHERE term_id = ?
            `).get(termId) as { start_date: string; end_date: string } | undefined;
            if (!term) {
                this.rollbackOrRequireReopen();
                throw new TypeError('HolidayRange owning Term does not exist');
            }
            if (command.intent.kind !== 'plan.delete-holiday-range'
                && (command.intent.payload.startDate < term.start_date
                    || command.intent.payload.endDate > term.end_date)) {
                this.rollbackOrRequireReopen();
                throw new TypeError('HolidayRange falls outside its Term');
            }
            if (command.intent.kind !== 'plan.create-holiday-range') {
                const mutation = command as UpdateHolidayRangeCommand | DeleteHolidayRangeCommand;
                if (mutation.overlapDecision === 'review') {
                    const activeHolidayRanges = this.readActiveHolidayRanges(termId);
                    const holidayRangeId = mutation.intent.payload.holidayRangeId;
                    let candidateHolidayRanges: readonly StoredHolidayRange[];
                    let changedStartDate = existing!.start_date;
                    let changedEndDate = existing!.end_date;
                    if (mutation.intent.kind === 'plan.update-holiday-range') {
                        const update = mutation as UpdateHolidayRangeCommand;
                        candidateHolidayRanges = activeHolidayRanges.map(range => (
                            range.holiday_range_id === holidayRangeId
                                ? Object.freeze({
                                    holiday_range_id: range.holiday_range_id,
                                    start_date: update.intent.payload.startDate,
                                    end_date: update.intent.payload.endDate,
                                })
                                : range
                        ));
                        changedStartDate = update.intent.payload.startDate < changedStartDate
                            ? update.intent.payload.startDate
                            : changedStartDate;
                        changedEndDate = update.intent.payload.endDate > changedEndDate
                            ? update.intent.payload.endDate
                            : changedEndDate;
                    }
                    else {
                        candidateHolidayRanges = activeHolidayRanges.filter(range => (
                            range.holiday_range_id !== holidayRangeId
                        ));
                    }
                    const conflictWindow = Object.freeze({
                        startDate: addClampedLocalDateDays(changedStartDate, -3),
                        endDate: addClampedLocalDateDays(changedEndDate, 3),
                    });
                    const beforeWarnings = meetingScheduleOverlapWarnings(
                        command.commandId,
                        this.readConflictMeetingOccurrences(
                            conflictWindow,
                            termId,
                            activeHolidayRanges,
                        ),
                    );
                    const existingWarningKeys = new Set(beforeWarnings.map(meetingOverlapWarningKey));
                    const introducedWarnings = meetingScheduleOverlapWarnings(
                        command.commandId,
                        this.readConflictMeetingOccurrences(
                            conflictWindow,
                            termId,
                            candidateHolidayRanges,
                        ),
                    ).filter(warning => !existingWarningKeys.has(meetingOverlapWarningKey(warning)))
                        .slice(0, MAX_MEETING_OVERLAP_WARNINGS);
                    if (introducedWarnings.length > 0) {
                        this.rollbackOrRequireReopen();
                        return meetingOverlapDecisionRequiredResult(
                            versions.revision,
                            Object.freeze(introducedWarnings),
                        );
                    }
                }
            }
            const existingVersion = existing?.entity_version ?? 0n;
            if (versions.revision === SQLITE_INTEGER_MAX
                || versions.planVersion === SQLITE_INTEGER_MAX
                || existingVersion === SQLITE_INTEGER_MAX) {
                this.rollbackOrRequireReopen();
                throw this.enterTerminalState();
            }

            const holidayRangeId = command.intent.kind === 'plan.create-holiday-range'
                ? randomUUID()
                : command.intent.payload.holidayRangeId;
            const newRevision = versions.revision + 1n;
            const newPlanVersion = versions.planVersion + 1n;
            const newHolidayRangeVersion = existingVersion + 1n;
            if (command.intent.kind === 'plan.create-holiday-range') {
                this.database.prepare(`
                    INSERT INTO holiday_ranges (
                        holiday_range_id,
                        term_id,
                        name,
                        start_date,
                        end_date,
                        tombstoned,
                        entity_version
                    ) VALUES (?, ?, ?, ?, ?, 0, 1)
                `).run(
                    holidayRangeId,
                    termId,
                    command.intent.payload.name,
                    command.intent.payload.startDate,
                    command.intent.payload.endDate,
                );
            }
            else if (command.intent.kind === 'plan.update-holiday-range') {
                this.database.prepare(`
                    UPDATE holiday_ranges
                    SET name = ?, start_date = ?, end_date = ?, entity_version = ?
                    WHERE holiday_range_id = ? AND tombstoned = 0
                `).run(
                    command.intent.payload.name,
                    command.intent.payload.startDate,
                    command.intent.payload.endDate,
                    newHolidayRangeVersion,
                    holidayRangeId,
                );
            }
            else {
                this.database.prepare(`
                    UPDATE holiday_ranges
                    SET tombstoned = 1, entity_version = ?
                    WHERE holiday_range_id = ? AND tombstoned = 0
                `).run(newHolidayRangeVersion, holidayRangeId);
            }
            this.database.prepare(`
                UPDATE plan_state SET plan_entity_version = ? WHERE singleton = 1
            `).run(newPlanVersion);
            this.advanceSetupMinimumMilestone();
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
                ) VALUES (?, ?, 1, 'courseflow-canonical-json-v1', 'sha256', ?, ?, 'committed')
            `).run(command.commandId, command.intent.kind, digest, newRevision);
            fireCommitFailpoint(options, 'commit.after-receipt');

            const effectCode: ReceiptEffect['code'] = command.intent.kind === 'plan.create-holiday-range'
                ? 'plan.holiday-range-created'
                : command.intent.kind === 'plan.update-holiday-range'
                    ? 'plan.holiday-range-updated'
                    : 'plan.holiday-range-deleted';
            this.database.prepare(`
                INSERT INTO receipt_effects (
                    command_id,
                    effect_order,
                    effect_code,
                    entity_kind,
                    entity_id,
                    entity_version
                ) VALUES (?, 0, ?, 'holiday-range', ?, ?)
            `).run(command.commandId, effectCode, holidayRangeId, newHolidayRangeVersion);
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
        }
        catch (error) {
            if (this.terminalError) {
                throw this.terminalError;
            }
            if (commitAttempted) {
                throw this.enterTerminalState(new CommittedCommandOutcomeUnknownError(command.commandId));
            }
            this.rollbackOrRequireReopen();
            if (error instanceof TypeError) {
                throw error;
            }
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

    /**
     * Commits one scoped Task occurrence/rule mutation and its receipt atomically.
     * @param {TaskOccurrenceRuleMutationCommand} command - Canonical scoped Task mutation.
     * @param {CommitOptions} options - Transaction failpoint controls used by tests.
     * @return {DataCommitResult} Committed receipt or unchanged structured problem.
     */
    private commitTaskOccurrenceRuleSynchronously(
        command: TaskOccurrenceRuleMutationCommand,
        options: CommitOptions,
    ): DataCommitResult {
        const changeCommand = command.intent.kind === 'plan.change-task-occurrence'
            ? command as ChangeTaskOccurrenceCommand
            : null;
        const deleteCommand = changeCommand === null
            ? command as DeleteTaskOccurrenceOrSeriesCommand
            : null;
        const digest = changeCommand
            ? digestChangeTaskOccurrence(changeCommand)
            : digestDeleteTaskOccurrenceOrSeries(deleteCommand!);
        let commitAttempted = false;

        try {
            this.database.exec('BEGIN IMMEDIATE');
            fireCommitFailpoint(options, 'commit.after-begin');
            const receipt = this.database.prepare(`
                SELECT payload_digest FROM command_receipts WHERE command_id = ?
            `).get(command.commandId) as { payload_digest: Uint8Array } | undefined;
            fireCommitFailpoint(options, 'commit.after-receipt-read');
            if (receipt) {
                const versions = this.currentVersions();
                if (!timingSafeEqual(receipt.payload_digest, digest)) {
                    this.rollbackOrRequireReopen();
                    return planConflictResult('command-id-reused', versions);
                }
                const outcome = this.readReceiptOutcome(command.commandId);
                this.rollbackOrRequireReopen();
                if (!outcome) {
                    throw new Error('Stored Task occurrence rule receipt is incomplete');
                }
                return successfulCommit(outcome);
            }

            const versions = this.currentVersions();
            const payload = command.intent.payload;
            const taskSeriesId = payload.taskSeriesId;
            const scope = payload.scope;
            const originalLogicalAnchor = scope === 'whole-series'
                ? null
                : (payload as { originalLogicalAnchor: string }).originalLogicalAnchor;
            const seriesStatement = this.database.prepare(`
                SELECT
                    task_series.entity_version,
                    task_series.retired,
                    terms.time_zone,
                    CASE courses.teaching_range_kind
                        WHEN 'explicit' THEN courses.teaching_start_date
                        ELSE terms.start_date
                    END AS teaching_start_date,
                    CASE courses.teaching_range_kind
                        WHEN 'explicit' THEN courses.teaching_end_date
                        ELSE terms.end_date
                    END AS teaching_end_date
                FROM task_series
                JOIN courses ON courses.course_id = task_series.course_id
                JOIN terms ON terms.term_id = courses.term_id
                WHERE task_series.task_series_id = ?
            `);
            seriesStatement.setReadBigInts(true);
            const series = seriesStatement.get(taskSeriesId) as {
                entity_version: bigint;
                retired: bigint;
                time_zone: string;
                teaching_start_date: string;
                teaching_end_date: string;
            } | undefined;
            if (!series || series.retired !== 0n) {
                this.rollbackOrRequireReopen();
                throw new TypeError('Task series is not editable');
            }

            const isFuture = scope === 'this-and-future';
            const requiresPreview = isFuture || deleteCommand !== null;
            if (requiresPreview) {
                const requestedWindow = command.impactWindow;
                let draft: TaskOccurrenceImpactDraft | null = null;
                if (requestedWindow !== null) {
                    draft = changeCommand
                        ? Object.freeze({
                            scope: 'this-and-future' as const,
                            taskSeriesId,
                            originalLogicalAnchor: originalLogicalAnchor!,
                            action: 'change' as const,
                            replacement: (changeCommand.intent.payload as Extract<
                                ChangeTaskOccurrenceCommand['intent']['payload'],
                                { scope: 'this-and-future' }
                            >).replacement,
                            requestedWindow,
                        })
                        : scope === 'whole-series'
                            ? Object.freeze({
                                scope: 'whole-series' as const,
                                taskSeriesId,
                                action: 'delete' as const,
                                requestedWindow,
                            })
                            : Object.freeze({
                                scope,
                                taskSeriesId,
                                originalLogicalAnchor: originalLogicalAnchor!,
                                action: 'delete' as const,
                                requestedWindow,
                            });
                }
                const expectedToken = draft === null
                    ? null
                    : taskOccurrenceConfirmationToken(
                        versions.revision.toString(),
                        versions.planVersion.toString(),
                        series.entity_version.toString(),
                        draft,
                    );
                if (versions.revision !== BigInt(command.expectedRevision)
                    || versions.planVersion !== BigInt(command.expectedPlanVersion)
                    || series.entity_version !== BigInt(command.expectedTaskSeriesVersion)
                    || expectedToken === null
                    || command.confirmationToken === null
                    || command.confirmationToken !== expectedToken) {
                    this.rollbackOrRequireReopen();
                    return decisionRequiredResult(versions.revision);
                }
            }
            else if (versions.revision !== BigInt(command.expectedRevision)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-revision', versions);
            }
            else if (versions.planVersion !== BigInt(command.expectedPlanVersion)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-entity-version', versions);
            }
            else if (series.entity_version !== BigInt(command.expectedTaskSeriesVersion)) {
                this.rollbackOrRequireReopen();
                return taskSeriesConflictResult(versions, taskSeriesId, series.entity_version);
            }
            fireCommitFailpoint(options, 'commit.after-expected-versions');

            if (versions.revision === SQLITE_INTEGER_MAX
                || versions.planVersion === SQLITE_INTEGER_MAX
                || series.entity_version === SQLITE_INTEGER_MAX) {
                this.rollbackOrRequireReopen();
                throw this.enterTerminalState();
            }
            const newRevision = versions.revision + 1n;
            const newPlanVersion = versions.planVersion + 1n;
            const newSeriesVersion = series.entity_version + 1n;

            if (scope === 'whole-series') {
                this.database.prepare(`
                    UPDATE task_series SET retired = 1 WHERE task_series_id = ? AND retired = 0
                `).run(taskSeriesId);
            }
            else {
                const segmentStatement = this.database.prepare(`
                    SELECT
                        task_segment_id,
                        title,
                        task_size,
                        schedule_kind,
                        deadline_kind,
                        deadline_date,
                        deadline_instant,
                        deadline_display_zone,
                        logical_start_anchor,
                        logical_end_anchor,
                        weekly_start_date,
                        weekly_weekday,
                        weekly_local_deadline_time,
                        weekly_confirmed_end_date,
                        follow_teaching_week
                    FROM task_segments
                    WHERE task_series_id = ?
                    ORDER BY logical_start_anchor, task_segment_id
                `);
                segmentStatement.setReadBigInts(true);
                const segments = segmentStatement.all(taskSeriesId) as StoredTaskSegment[];
                const segment = taskSegmentForAnchor(segments, originalLogicalAnchor!);
                const overrideStatement = this.database.prepare(`
                    SELECT
                        original_logical_anchor,
                        override_kind,
                        replacement_title,
                        replacement_task_size,
                        replacement_deadline_kind,
                        replacement_deadline_date,
                        replacement_deadline_instant,
                        replacement_deadline_display_zone,
                        entity_version
                    FROM task_occurrence_overrides
                    WHERE task_series_id = ?
                    ORDER BY original_logical_anchor
                `);
                overrideStatement.setReadBigInts(true);
                const overrides = overrideStatement.all(taskSeriesId) as StoredTaskOccurrenceOverride[];
                const targetOverride = overrides.find(candidate => (
                    candidate.original_logical_anchor === originalLogicalAnchor
                ));
                if (!segment || targetOverride?.override_kind === 'deleted') {
                    this.rollbackOrRequireReopen();
                    throw new TypeError('Task occurrence is not active');
                }
                if (isFuture && segment.schedule_kind !== 'weekly') {
                    this.rollbackOrRequireReopen();
                    throw new TypeError('This-and-future scope requires a weekly Task series');
                }
                if (overrides.some(override => override.entity_version === SQLITE_INTEGER_MAX)) {
                    this.rollbackOrRequireReopen();
                    throw this.enterTerminalState();
                }

                const stateStatement = this.database.prepare(`
                    SELECT
                        original_logical_anchor,
                        status,
                        self_reported_progress,
                        entity_version
                    FROM task_occurrence_states
                    WHERE task_series_id = ?
                    ORDER BY original_logical_anchor
                `);
                stateStatement.setReadBigInts(true);
                const states = stateStatement.all(taskSeriesId) as StoredTaskOccurrenceState[];
                const targetState = states.find(state => (
                    state.original_logical_anchor === originalLogicalAnchor
                ));
                const replacementForAnchor = (anchor: string): TaskOccurrenceReplacement => {
                    const override = overrides.find(candidate => candidate.original_logical_anchor === anchor);
                    if (override?.override_kind === 'replaced') {
                        return taskOverrideReplacement(override);
                    }
                    const owner = taskSegmentForAnchor(segments, anchor);
                    if (!owner) {
                        throw new Error('Task occurrence state has no retained facts');
                    }
                    return Object.freeze({
                        title: owner.title,
                        size: owner.task_size,
                        deadline: taskSegmentOccurrenceDeadline(owner, anchor, series.time_zone),
                    });
                };
                const writeReplacementOverride = (
                    anchor: string,
                    replacement: TaskOccurrenceReplacement,
                ): void => {
                    this.database.prepare(`
                        INSERT INTO task_occurrence_overrides (
                            task_series_id,
                            original_logical_anchor,
                            override_kind,
                            replacement_title,
                            replacement_task_size,
                            replacement_deadline_kind,
                            replacement_deadline_date,
                            replacement_deadline_instant,
                            replacement_deadline_display_zone,
                            entity_version
                        ) VALUES (?, ?, 'replaced', ?, ?, ?, ?, ?, ?, 1)
                        ON CONFLICT (task_series_id, original_logical_anchor) DO UPDATE SET
                            override_kind = 'replaced',
                            replacement_title = excluded.replacement_title,
                            replacement_task_size = excluded.replacement_task_size,
                            replacement_deadline_kind = excluded.replacement_deadline_kind,
                            replacement_deadline_date = excluded.replacement_deadline_date,
                            replacement_deadline_instant = excluded.replacement_deadline_instant,
                            replacement_deadline_display_zone = excluded.replacement_deadline_display_zone,
                            entity_version = task_occurrence_overrides.entity_version + 1
                    `).run(
                        taskSeriesId,
                        anchor,
                        replacement.title,
                        replacement.size,
                        ...taskDeadlineColumns(replacement.deadline),
                    );
                };

                if (changeCommand && scope === 'only-this') {
                    if (targetState && targetState.status !== 'pending') {
                        this.rollbackOrRequireReopen();
                        throw new TypeError('Terminal Task occurrence history is not editable');
                    }
                    const replacement = (changeCommand.intent.payload as Extract<
                        ChangeTaskOccurrenceCommand['intent']['payload'],
                        { scope: 'only-this' }
                    >).replacement;
                    writeReplacementOverride(originalLogicalAnchor!, replacement);
                }
                else if (deleteCommand && scope === 'only-this') {
                    if (targetState && targetState.status !== 'pending') {
                        this.rollbackOrRequireReopen();
                        throw new TypeError('Terminal Task occurrence history is not deletable as only-this');
                    }
                    this.database.prepare(`
                        INSERT INTO task_occurrence_overrides (
                            task_series_id,
                            original_logical_anchor,
                            override_kind,
                            replacement_title,
                            replacement_task_size,
                            replacement_deadline_kind,
                            replacement_deadline_date,
                            replacement_deadline_instant,
                            replacement_deadline_display_zone,
                            entity_version
                        ) VALUES (?, ?, 'deleted', NULL, NULL, NULL, NULL, NULL, NULL, 1)
                        ON CONFLICT (task_series_id, original_logical_anchor) DO UPDATE SET
                            override_kind = 'deleted',
                            replacement_title = NULL,
                            replacement_task_size = NULL,
                            replacement_deadline_kind = NULL,
                            replacement_deadline_date = NULL,
                            replacement_deadline_instant = NULL,
                            replacement_deadline_display_zone = NULL,
                            entity_version = task_occurrence_overrides.entity_version + 1
                    `).run(taskSeriesId, originalLogicalAnchor);
                }
                else {
                    const retainedStates = states.filter(state => (
                        state.original_logical_anchor >= originalLogicalAnchor!
                        && (deleteCommand !== null || state.status !== 'pending')
                    ));
                    for (const state of retainedStates) {
                        writeReplacementOverride(
                            state.original_logical_anchor,
                            replacementForAnchor(state.original_logical_anchor),
                        );
                    }

                    const finalLogicalEndAnchor = segments.at(-1)!.logical_end_anchor;
                    this.database.prepare(`
                        DELETE FROM task_segments
                        WHERE task_series_id = ? AND logical_start_anchor > ?
                    `).run(taskSeriesId, originalLogicalAnchor);
                    if (changeCommand) {
                        if (!targetState || targetState.status === 'pending') {
                            this.database.prepare(`
                                DELETE FROM task_occurrence_overrides
                                WHERE task_series_id = ? AND original_logical_anchor = ?
                            `).run(taskSeriesId, originalLogicalAnchor);
                        }
                        const replacement = (changeCommand.intent.payload as Extract<
                            ChangeTaskOccurrenceCommand['intent']['payload'],
                            { scope: 'this-and-future' }
                        >).replacement;
                        const firstDate = occurrenceDate(originalLogicalAnchor!, replacement.weekday);
                        const lastDate = occurrenceDate(finalLogicalEndAnchor, replacement.weekday);
                        if (firstDate === null
                            || lastDate === null
                            || firstDate < series.teaching_start_date
                            || lastDate > series.teaching_end_date) {
                            this.rollbackOrRequireReopen();
                            throw new TypeError('Task future replacement falls outside the Course range');
                        }
                        const boundaryInstants = [firstDate, lastDate].map(date => (
                            INTL_ZONE_RULES.resolveInstant(
                                series.time_zone,
                                date,
                                replacement.localDeadlineTime,
                            )
                        ));
                        if (!boundaryInstants.every(isCanonicalInstant)) {
                            this.rollbackOrRequireReopen();
                            throw new TypeError('Task future replacement has an invalid deadline');
                        }
                        if (originalLogicalAnchor === segment.logical_start_anchor) {
                            this.database.prepare(`
                                DELETE FROM task_segments WHERE task_segment_id = ?
                            `).run(segment.task_segment_id);
                        }
                        else {
                            this.database.prepare(`
                                UPDATE task_segments SET logical_end_anchor = ? WHERE task_segment_id = ?
                            `).run(addLocalDateDays(originalLogicalAnchor!, -7), segment.task_segment_id);
                        }
                        this.database.prepare(`
                            INSERT INTO task_segments (
                                task_segment_id,
                                task_series_id,
                                title,
                                task_size,
                                schedule_kind,
                                deadline_kind,
                                deadline_date,
                                deadline_instant,
                                deadline_display_zone,
                                weekly_start_date,
                                weekly_weekday,
                                weekly_local_deadline_time,
                                weekly_confirmed_end_date,
                                follow_teaching_week,
                                logical_start_anchor,
                                logical_end_anchor
                            ) VALUES (
                                ?, ?, ?, ?, 'weekly', NULL, NULL, NULL, NULL,
                                ?, ?, ?, ?, ?, ?, ?
                            )
                        `).run(
                            randomUUID(),
                            taskSeriesId,
                            replacement.title,
                            replacement.size,
                            segment.weekly_start_date,
                            replacement.weekday,
                            replacement.localDeadlineTime,
                            segments.at(-1)!.weekly_confirmed_end_date,
                            replacement.followTeachingWeek ? 1 : 0,
                            originalLogicalAnchor,
                            finalLogicalEndAnchor,
                        );
                    }
                    else {
                        this.database.prepare(`
                            DELETE FROM task_occurrence_overrides
                            WHERE task_series_id = ?
                                AND original_logical_anchor >= ?
                                AND NOT EXISTS (
                                    SELECT 1
                                    FROM task_occurrence_states
                                    WHERE task_occurrence_states.task_series_id
                                        = task_occurrence_overrides.task_series_id
                                        AND task_occurrence_states.original_logical_anchor
                                            = task_occurrence_overrides.original_logical_anchor
                                )
                        `).run(taskSeriesId, originalLogicalAnchor);
                        if (originalLogicalAnchor === segment.logical_start_anchor) {
                            const hasEarlierSegment = segments.some(candidate => (
                                candidate.logical_start_anchor < originalLogicalAnchor!
                            ));
                            if (hasEarlierSegment) {
                                this.database.prepare(`
                                    DELETE FROM task_segments WHERE task_segment_id = ?
                                `).run(segment.task_segment_id);
                            }
                            else {
                                this.database.prepare(`
                                    UPDATE task_series SET retired = 1 WHERE task_series_id = ?
                                `).run(taskSeriesId);
                            }
                        }
                        else {
                            this.database.prepare(`
                                UPDATE task_segments SET logical_end_anchor = ? WHERE task_segment_id = ?
                            `).run(addLocalDateDays(originalLogicalAnchor!, -7), segment.task_segment_id);
                        }
                    }
                }
            }

            this.database.prepare(`
                UPDATE task_series SET entity_version = ? WHERE task_series_id = ?
            `).run(newSeriesVersion, taskSeriesId);
            this.database.prepare(`
                UPDATE plan_state SET plan_entity_version = ? WHERE singleton = 1
            `).run(newPlanVersion);
            fireCommitFailpoint(options, 'commit.after-facts');
            this.database.prepare(`
                UPDATE workspace_state SET revision = ? WHERE singleton = 1
            `).run(newRevision);
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
                ) VALUES (?, ?, 1, 'courseflow-canonical-json-v1', 'sha256', ?, ?, 'committed')
            `).run(command.commandId, command.intent.kind, digest, newRevision);
            fireCommitFailpoint(options, 'commit.after-receipt');
            const effectCode: ReceiptEffect['code'] = changeCommand
                ? 'plan.task-occurrence-changed'
                : deleteCommand!.intent.payload.scope === 'whole-series'
                    ? 'plan.task-series-deleted'
                    : 'plan.task-occurrence-deleted';
            this.database.prepare(`
                INSERT INTO receipt_effects (
                    command_id,
                    effect_order,
                    effect_code,
                    entity_kind,
                    entity_id,
                    entity_version
                ) VALUES (?, 0, ?, 'task-series', ?, ?)
            `).run(command.commandId, effectCode, taskSeriesId, newSeriesVersion);
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
                throw new Error('Committed Task occurrence rule receipt outcome is missing');
            }
            return successfulCommit(outcome);
        }
        catch (error) {
            if (this.terminalError) {
                throw this.terminalError;
            }
            if (commitAttempted) {
                throw this.enterTerminalState(new CommittedCommandOutcomeUnknownError(command.commandId));
            }
            this.rollbackOrRequireReopen();
            if (error instanceof TypeError) {
                throw error;
            }
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

    /**
     * Commits one independent Task occurrence state/progress transition or formal Undo.
     * @param {TaskOccurrenceStateMutationCommand} command - Canonical state mutation.
     * @param {CommitOptions} options - Transaction failpoint controls used by tests.
     * @return {DataCommitResult} Committed receipt or unchanged structured problem.
     */
    private commitTaskOccurrenceStateSynchronously(
        command: TaskOccurrenceStateMutationCommand,
        options: CommitOptions,
    ): DataCommitResult {
        const digest = command.intent.kind === 'plan.set-task-progress'
            ? digestSetTaskProgress(command as SetTaskProgressCommand)
            : command.intent.kind === 'plan.undo-task-occurrence-state'
                ? digestUndoTaskOccurrenceState(command as UndoTaskOccurrenceStateCommand)
                : command.intent.intentSchemaVersion === 1
                    ? digestCompleteTask(command as CompleteTaskCommand)
                    : digestSetTaskOccurrenceStatus(command as SetTaskOccurrenceStatusCommand);
        let commitAttempted = false;

        try {
            this.database.exec('BEGIN IMMEDIATE');
            fireCommitFailpoint(options, 'commit.after-begin');
            const receipt = this.database.prepare(`
                SELECT payload_digest FROM command_receipts WHERE command_id = ?
            `).get(command.commandId) as { payload_digest: Uint8Array } | undefined;
            fireCommitFailpoint(options, 'commit.after-receipt-read');
            if (receipt) {
                const versions = this.currentVersions();
                if (!timingSafeEqual(receipt.payload_digest, digest)) {
                    this.rollbackOrRequireReopen();
                    return planConflictResult('command-id-reused', versions);
                }
                const outcome = this.readReceiptOutcome(command.commandId);
                this.rollbackOrRequireReopen();
                if (!outcome) {
                    throw new Error('Stored Task occurrence receipt is incomplete');
                }
                return successfulCommit(outcome);
            }

            const versions = this.currentVersions();
            const payload = command.intent.payload;
            const seriesStatement = this.database.prepare(`
                SELECT retired, entity_version
                FROM task_series
                WHERE task_series_id = ?
            `);
            seriesStatement.setReadBigInts(true);
            const series = seriesStatement.get(payload.taskSeriesId) as {
                retired: bigint;
                entity_version: bigint;
            } | undefined;
            if (!series || series.retired !== 0n) {
                this.rollbackOrRequireReopen();
                throw new TypeError('Task series is not editable');
            }
            if (versions.revision !== BigInt(command.expectedRevision)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-revision', versions);
            }
            if (versions.planVersion !== BigInt(command.expectedPlanVersion)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-entity-version', versions);
            }
            if (series.entity_version !== BigInt(command.expectedTaskSeriesVersion)) {
                this.rollbackOrRequireReopen();
                return taskSeriesConflictResult(versions, payload.taskSeriesId, series.entity_version);
            }
            fireCommitFailpoint(options, 'commit.after-expected-versions');

            const segmentStatement = this.database.prepare(`
                SELECT
                    task_segment_id,
                    title,
                    task_size,
                    schedule_kind,
                    deadline_kind,
                    deadline_date,
                    deadline_instant,
                    deadline_display_zone,
                    logical_start_anchor,
                    logical_end_anchor,
                    weekly_start_date,
                    weekly_weekday,
                    weekly_local_deadline_time,
                    weekly_confirmed_end_date,
                    follow_teaching_week
                FROM task_segments
                WHERE task_series_id = ?
                ORDER BY logical_start_anchor, task_segment_id
            `);
            segmentStatement.setReadBigInts(true);
            const segments = segmentStatement.all(payload.taskSeriesId) as StoredTaskSegment[];
            const segment = taskSegmentForAnchor(segments, payload.originalLogicalAnchor);
            const overrideStatement = this.database.prepare(`
                SELECT
                    original_logical_anchor,
                    override_kind,
                    replacement_title,
                    replacement_task_size,
                    replacement_deadline_kind,
                    replacement_deadline_date,
                    replacement_deadline_instant,
                    replacement_deadline_display_zone,
                    entity_version
                FROM task_occurrence_overrides
                WHERE task_series_id = ? AND original_logical_anchor = ?
            `);
            overrideStatement.setReadBigInts(true);
            const override = overrideStatement.get(
                payload.taskSeriesId,
                payload.originalLogicalAnchor,
            ) as StoredTaskOccurrenceOverride | undefined;
            if (!segment || override?.override_kind === 'deleted') {
                this.rollbackOrRequireReopen();
                throw new TypeError('Task occurrence is not active');
            }
            const effectiveSize = override?.override_kind === 'replaced'
                ? override.replacement_task_size!
                : segment.task_size;
            const stateStatement = this.database.prepare(`
                SELECT
                    original_logical_anchor,
                    status,
                    self_reported_progress,
                    entity_version
                FROM task_occurrence_states
                WHERE task_series_id = ? AND original_logical_anchor = ?
            `);
            stateStatement.setReadBigInts(true);
            const state = stateStatement.get(
                payload.taskSeriesId,
                payload.originalLogicalAnchor,
            ) as StoredTaskOccurrenceState | undefined;
            const currentStatus = state?.status ?? 'pending';
            const currentProgress = state?.self_reported_progress ?? null;
            const currentStateVersion = state?.entity_version ?? 0n;
            if (versions.revision === SQLITE_INTEGER_MAX
                || versions.planVersion === SQLITE_INTEGER_MAX
                || series.entity_version === SQLITE_INTEGER_MAX
                || currentStateVersion === SQLITE_INTEGER_MAX) {
                this.rollbackOrRequireReopen();
                throw this.enterTerminalState();
            }

            const newRevision = versions.revision + 1n;
            const newPlanVersion = versions.planVersion + 1n;
            const newSeriesVersion = series.entity_version + 1n;
            const newStateVersion = currentStateVersion + 1n;
            let undoToken: string | null = null;
            let effectCode: ReceiptEffect['code'];
            if (command.intent.kind === 'plan.undo-task-occurrence-state') {
                const undoPayload = (command as UndoTaskOccurrenceStateCommand).intent.payload;
                const historyStatement = this.database.prepare(`
                    SELECT
                        task_state_history.before_row_present,
                        task_state_history.before_status,
                        task_state_history.before_self_reported_progress,
                        task_state_history.after_state_version,
                        task_state_history.consumed,
                        receipt_effects.entity_version AS valid_through_task_series_version
                    FROM task_state_history
                    JOIN receipt_effects
                        ON receipt_effects.command_id = task_state_history.originating_command_id
                        AND receipt_effects.effect_order = 0
                        AND receipt_effects.entity_kind = 'task-series'
                        AND receipt_effects.entity_id = task_state_history.task_series_id
                    WHERE task_state_history.undo_token = ?
                        AND task_state_history.task_series_id = ?
                        AND task_state_history.original_logical_anchor = ?
                `);
                historyStatement.setReadBigInts(true);
                const history = historyStatement.get(
                    undoPayload.token,
                    payload.taskSeriesId,
                    payload.originalLogicalAnchor,
                ) as {
                    before_row_present: bigint;
                    before_status: TaskOccurrenceStatus | null;
                    before_self_reported_progress: bigint | null;
                    after_state_version: bigint;
                    consumed: bigint;
                    valid_through_task_series_version: bigint;
                } | undefined;
                if (!history
                    || history.consumed !== 0n
                    || series.entity_version !== history.valid_through_task_series_version
                    || !state
                    || state.entity_version !== history.after_state_version) {
                    this.rollbackOrRequireReopen();
                    return taskSeriesConflictResult(versions, payload.taskSeriesId, series.entity_version);
                }
                if (history.before_row_present === 0n) {
                    this.database.prepare(`
                        DELETE FROM task_occurrence_states
                        WHERE task_series_id = ? AND original_logical_anchor = ?
                    `).run(payload.taskSeriesId, payload.originalLogicalAnchor);
                }
                else {
                    this.database.prepare(`
                        UPDATE task_occurrence_states
                        SET status = ?, self_reported_progress = ?, entity_version = ?
                        WHERE task_series_id = ? AND original_logical_anchor = ?
                    `).run(
                        history.before_status,
                        history.before_self_reported_progress,
                        newStateVersion,
                        payload.taskSeriesId,
                        payload.originalLogicalAnchor,
                    );
                }
                this.database.prepare(`
                    UPDATE task_state_history SET consumed = 1 WHERE undo_token = ?
                `).run(undoPayload.token);
                effectCode = 'plan.task-occurrence-state-undone';
            }
            else {
                let nextStatus = currentStatus;
                let nextProgress = currentProgress;
                if (command.intent.kind === 'plan.set-task-progress') {
                    if (effectiveSize !== 'large' || currentStatus !== 'pending') {
                        this.rollbackOrRequireReopen();
                        throw new TypeError('Progress applies only to a pending large Task occurrence');
                    }
                    nextProgress = command.intent.payload.reportedProgress === null
                        ? null
                        : BigInt(command.intent.payload.reportedProgress);
                    if (nextProgress === currentProgress) {
                        this.rollbackOrRequireReopen();
                        throw new TypeError('Task progress is already set to the requested value');
                    }
                    effectCode = 'plan.task-progress-set';
                }
                else {
                    nextStatus = command.intent.payload.status;
                    if (nextStatus === currentStatus) {
                        this.rollbackOrRequireReopen();
                        throw new TypeError('Task occurrence already has the requested status');
                    }
                    effectCode = command.intent.intentSchemaVersion === 1
                        ? 'plan.task-occurrence-completed'
                        : 'plan.task-occurrence-status-set';
                }
                this.database.prepare(`
                    INSERT INTO task_occurrence_states (
                        task_series_id,
                        original_logical_anchor,
                        status,
                        self_reported_progress,
                        entity_version
                    ) VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT (task_series_id, original_logical_anchor) DO UPDATE SET
                        status = excluded.status,
                        self_reported_progress = excluded.self_reported_progress,
                        entity_version = excluded.entity_version
                `).run(
                    payload.taskSeriesId,
                    payload.originalLogicalAnchor,
                    nextStatus,
                    nextProgress,
                    newStateVersion,
                );
                undoToken = createHash('sha256').update(randomUUID(), 'utf8').digest('hex');
            }
            this.database.prepare(`
                UPDATE task_series SET entity_version = ? WHERE task_series_id = ?
            `).run(newSeriesVersion, payload.taskSeriesId);
            this.database.prepare(`
                UPDATE plan_state SET plan_entity_version = ? WHERE singleton = 1
            `).run(newPlanVersion);
            fireCommitFailpoint(options, 'commit.after-facts');

            this.database.prepare(`
                UPDATE workspace_state SET revision = ? WHERE singleton = 1
            `).run(newRevision);
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
                ) VALUES (?, ?, ?, 'courseflow-canonical-json-v1', 'sha256', ?, ?, 'committed')
            `).run(
                command.commandId,
                command.intent.kind,
                command.intent.intentSchemaVersion,
                digest,
                newRevision,
            );
            fireCommitFailpoint(options, 'commit.after-receipt');
            this.database.prepare(`
                INSERT INTO receipt_effects (
                    command_id,
                    effect_order,
                    effect_code,
                    entity_kind,
                    entity_id,
                    entity_version
                ) VALUES (?, 0, ?, 'task-series', ?, ?)
            `).run(command.commandId, effectCode, payload.taskSeriesId, newSeriesVersion);
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
            if (undoToken !== null) {
                this.database.prepare(`
                    INSERT INTO task_state_history (
                        undo_token,
                        originating_command_id,
                        task_series_id,
                        original_logical_anchor,
                        before_row_present,
                        before_status,
                        before_self_reported_progress,
                        after_state_version,
                        consumed
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
                `).run(
                    undoToken,
                    command.commandId,
                    payload.taskSeriesId,
                    payload.originalLogicalAnchor,
                    state ? 1 : 0,
                    state?.status ?? null,
                    state?.self_reported_progress ?? null,
                    newStateVersion,
                );
            }
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
            if (!outcome || (undoToken !== null && outcome.undoCapability?.token !== undoToken)) {
                throw new Error('Committed Task occurrence receipt outcome is missing');
            }
            return successfulCommit(outcome);
        }
        catch (error) {
            if (this.terminalError) {
                throw this.terminalError;
            }
            if (commitAttempted) {
                throw this.enterTerminalState(new CommittedCommandOutcomeUnknownError(command.commandId));
            }
            this.rollbackOrRequireReopen();
            if (error instanceof TypeError) {
                throw error;
            }
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

    /**
     * Commits one bounded Task lifecycle transition and its durable receipt atomically.
     * @param {TaskSeriesMutationCommand} command - Normalized Task series command.
     * @param {CommitOptions} options - Transaction failpoint controls used by tests.
     * @return {DataCommitResult} Committed receipt or unchanged structured problem.
     */
    private commitTaskSynchronously(
        command: TaskSeriesMutationCommand,
        options: CommitOptions,
    ): DataCommitResult {
        const digest = command.intent.kind === 'plan.create-task-series'
            ? digestCreateTask(command as CreateTaskCommand)
            : command.intent.kind === 'plan.update-task-series'
                ? digestUpdateTask(command as UpdateTaskCommand)
                : digestDeleteTask(command as DeleteTaskCommand);
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
                    return planConflictResult('command-id-reused', versions);
                }
                const outcome = this.readReceiptOutcome(command.commandId);
                this.rollbackOrRequireReopen();
                if (!outcome) {
                    throw new Error('Stored receipt outcome is incomplete');
                }
                return successfulCommit(outcome);
            }

            const versions = this.currentVersions();
            if (versions.revision !== BigInt(command.expectedRevision)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-revision', versions);
            }
            if (versions.planVersion !== BigInt(command.expectedPlanVersion)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-entity-version', versions);
            }

            const existing = command.intent.kind === 'plan.create-task-series'
                ? undefined
                : (() => {
                    const statement = this.database.prepare(`
                        SELECT
                            task_series.course_id,
                            task_series.retired,
                            task_series.entity_version,
                            (
                                SELECT schedule_kind
                                FROM task_segments
                                WHERE task_segments.task_series_id = task_series.task_series_id
                                ORDER BY logical_start_anchor, task_segment_id
                                LIMIT 1
                            ) AS schedule_kind,
                            (
                                SELECT status
                                FROM task_occurrence_states
                                WHERE task_occurrence_states.task_series_id = task_series.task_series_id
                                    AND task_occurrence_states.original_logical_anchor = 'once'
                            ) AS status,
                            (
                                SELECT count(*)
                                FROM task_segments
                                WHERE task_segments.task_series_id = task_series.task_series_id
                            ) AS segment_count,
                            (
                                SELECT count(*)
                                FROM task_occurrence_states
                                WHERE task_occurrence_states.task_series_id = task_series.task_series_id
                            ) AS state_count,
                            (
                                SELECT count(*)
                                FROM task_occurrence_overrides
                                WHERE task_occurrence_overrides.task_series_id = task_series.task_series_id
                            ) AS override_count
                        FROM task_series
                        WHERE task_series.task_series_id = ?
                    `);
                    statement.setReadBigInts(true);
                    return statement.get(command.intent.payload.taskSeriesId) as {
                        course_id: string;
                        retired: bigint;
                        entity_version: bigint;
                        schedule_kind: TaskSchedule['kind'];
                        status: TaskOccurrenceStatus | null;
                        segment_count: bigint;
                        state_count: bigint;
                        override_count: bigint;
                    } | undefined;
                })();
            if (command.intent.kind !== 'plan.create-task-series') {
                const mutation = command as UpdateTaskCommand | DeleteTaskCommand;
                if (!existing || existing.retired !== 0n) {
                    this.rollbackOrRequireReopen();
                    throw new TypeError('Task series is not editable');
                }
                if (existing.entity_version !== BigInt(mutation.expectedTaskSeriesVersion)) {
                    this.rollbackOrRequireReopen();
                    return taskSeriesConflictResult(
                        versions,
                        command.intent.payload.taskSeriesId,
                        existing.entity_version,
                    );
                }
            }
            fireCommitFailpoint(options, 'commit.after-expected-versions');

            if (command.intent.kind === 'plan.delete-task-series') {
                this.rollbackOrRequireReopen();
                return decisionRequiredResult(versions.revision);
            }

            const courseId = command.intent.kind === 'plan.create-task-series'
                || command.intent.kind === 'plan.update-task-series'
                ? command.intent.payload.courseId
                : existing!.course_id;
            const sourceCourseId = existing?.course_id ?? courseId;
            const courseStatement = this.database.prepare(`
                SELECT count(*) AS count
                FROM courses
                JOIN terms ON terms.term_id = courses.term_id
                JOIN plan_state ON plan_state.singleton = 1
                WHERE courses.course_id IN (?, ?)
                    AND courses.archived = 0
                    AND terms.archived = 0
                    AND plan_state.current_term_id = courses.term_id
            `);
            courseStatement.setReadBigInts(true);
            const activeCurrentCourseCount = (courseStatement.get(courseId, sourceCourseId) as {
                count: bigint;
            }).count;
            const requiredCourseCount = courseId === sourceCourseId ? 1n : 2n;
            if (activeCurrentCourseCount !== requiredCourseCount) {
                this.rollbackOrRequireReopen();
                throw new TypeError('Task requires an active Current Term Course');
            }
            const proposedSchedule = command.intent.kind === 'plan.create-task-series'
                || command.intent.kind === 'plan.update-task-series'
                ? taskSchedule(command.intent.payload)
                : null;
            if (command.intent.kind === 'plan.update-task-series'
                && existing!.schedule_kind === 'once'
                && proposedSchedule!.kind === 'weekly'
                && existing!.status !== null) {
                this.rollbackOrRequireReopen();
                throw new TypeError('Completed once Task cannot become weekly without preserving instance state');
            }
            if (command.intent.kind === 'plan.update-task-series'
                && (existing!.segment_count !== 1n
                    || existing!.state_count !== 0n
                    || existing!.override_count !== 0n)) {
                this.rollbackOrRequireReopen();
                throw new TypeError('Task history requires scoped occurrence editing');
            }
            if (proposedSchedule?.kind === 'weekly') {
                const courseRange = this.database.prepare(`
                    SELECT
                        CASE
                            WHEN courses.teaching_range_kind = 'explicit'
                                THEN courses.teaching_start_date
                            ELSE terms.start_date
                        END AS teaching_start_date,
                        CASE
                            WHEN courses.teaching_range_kind = 'explicit'
                                THEN courses.teaching_end_date
                            ELSE terms.end_date
                        END AS teaching_end_date,
                        terms.time_zone AS term_zone
                    FROM courses
                    JOIN terms ON terms.term_id = courses.term_id
                    WHERE courses.course_id = ?
                `).get(courseId) as {
                    teaching_start_date: string;
                    teaching_end_date: string;
                    term_zone: string;
                };
                const firstAnchor = firstTaskWeeklyAnchor(
                    proposedSchedule.startDate,
                    proposedSchedule.weekday,
                );
                if (proposedSchedule.startDate < courseRange.teaching_start_date
                    || proposedSchedule.confirmedEndDate > courseRange.teaching_end_date
                    || firstAnchor === null
                    || firstAnchor > proposedSchedule.confirmedEndDate) {
                    this.rollbackOrRequireReopen();
                    throw new TypeError('Weekly Task range must produce an occurrence inside the Course range');
                }
                const lastAnchor = lastTaskWeeklyAnchor(
                    proposedSchedule.confirmedEndDate,
                    proposedSchedule.weekday,
                );
                const boundaryInstants = [firstAnchor, lastAnchor].map(anchor => (
                    INTL_ZONE_RULES.resolveInstant(
                        courseRange.term_zone,
                        anchor,
                        proposedSchedule.localDeadlineTime,
                    )
                ));
                if (!boundaryInstants.every(isCanonicalInstant)) {
                    this.rollbackOrRequireReopen();
                    throw new TypeError('Weekly Task deadline must resolve to canonical Instants');
                }
            }

            const existingVersion = existing?.entity_version ?? 0n;
            if (versions.revision === SQLITE_INTEGER_MAX
                || versions.planVersion === SQLITE_INTEGER_MAX
                || existingVersion === SQLITE_INTEGER_MAX) {
                this.rollbackOrRequireReopen();
                throw this.enterTerminalState();
            }

            const taskSeriesId = command.intent.kind === 'plan.create-task-series'
                ? randomUUID()
                : command.intent.payload.taskSeriesId;
            const newRevision = versions.revision + 1n;
            const newPlanVersion = versions.planVersion + 1n;
            const newTaskSeriesVersion = existingVersion + 1n;
            if (command.intent.kind === 'plan.create-task-series') {
                const taskRule = taskSchedule(command.intent.payload);
                const schedule = taskScheduleColumns(taskRule);
                const logicalAnchors = taskLogicalAnchors(taskRule);
                this.database.prepare(`
                    INSERT INTO task_series (
                        task_series_id,
                        course_id,
                        retired,
                        entity_version
                    ) VALUES (?, ?, 0, 1)
                `).run(taskSeriesId, courseId);
                this.database.prepare(`
                    INSERT INTO task_segments (
                        task_segment_id,
                        task_series_id,
                        title,
                        task_size,
                        schedule_kind,
                        deadline_kind,
                        deadline_date,
                        deadline_instant,
                        deadline_display_zone,
                        weekly_start_date,
                        weekly_weekday,
                        weekly_local_deadline_time,
                        weekly_confirmed_end_date,
                        follow_teaching_week,
                        logical_start_anchor,
                        logical_end_anchor
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    randomUUID(),
                    taskSeriesId,
                    command.intent.payload.title,
                    command.intent.payload.size,
                    ...schedule,
                    ...logicalAnchors,
                );
            }
            else if (command.intent.kind === 'plan.update-task-series') {
                const taskRule = taskSchedule(command.intent.payload);
                const schedule = taskScheduleColumns(taskRule);
                const logicalAnchors = taskLogicalAnchors(taskRule);
                this.database.prepare(`
                    UPDATE task_series
                    SET course_id = ?, entity_version = ?
                    WHERE task_series_id = ? AND retired = 0
                `).run(courseId, newTaskSeriesVersion, taskSeriesId);
                this.database.prepare(`
                    UPDATE task_segments
                    SET
                        title = ?,
                        task_size = ?,
                        schedule_kind = ?,
                        deadline_kind = ?,
                        deadline_date = ?,
                        deadline_instant = ?,
                        deadline_display_zone = ?,
                        weekly_start_date = ?,
                        weekly_weekday = ?,
                        weekly_local_deadline_time = ?,
                        weekly_confirmed_end_date = ?,
                        follow_teaching_week = ?,
                        logical_start_anchor = ?,
                        logical_end_anchor = ?
                    WHERE task_series_id = ?
                `).run(
                    command.intent.payload.title,
                    command.intent.payload.size,
                    ...schedule,
                    ...logicalAnchors,
                    taskSeriesId,
                );
            }
            this.database.prepare(`
                UPDATE plan_state SET plan_entity_version = ? WHERE singleton = 1
            `).run(newPlanVersion);
            this.advanceSetupMinimumMilestone();
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
                ) VALUES (?, ?, ?, 'courseflow-canonical-json-v1', 'sha256', ?, ?, 'committed')
            `).run(
                command.commandId,
                command.intent.kind,
                command.intent.intentSchemaVersion,
                digest,
                newRevision,
            );
            fireCommitFailpoint(options, 'commit.after-receipt');

            const effectCode: ReceiptEffect['code'] = command.intent.kind === 'plan.create-task-series'
                ? 'plan.task-series-created'
                : 'plan.task-series-updated';
            this.database.prepare(`
                INSERT INTO receipt_effects (
                    command_id,
                    effect_order,
                    effect_code,
                    entity_kind,
                    entity_id,
                    entity_version
                ) VALUES (?, 0, ?, 'task-series', ?, ?)
            `).run(command.commandId, effectCode, taskSeriesId, newTaskSeriesVersion);
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
        }
        catch (error) {
            if (this.terminalError) {
                throw this.terminalError;
            }
            if (commitAttempted) {
                throw this.enterTerminalState(new CommittedCommandOutcomeUnknownError(command.commandId));
            }
            this.rollbackOrRequireReopen();
            if (error instanceof TypeError) {
                throw error;
            }
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

    private commitTermMutationSynchronously(
        command: TermMutationCommand,
        options: CommitOptions,
    ): DataCommitResult {
        const digest = command.intent.kind === 'workspace.reconcile-lifecycle'
            ? digestReconcileWorkspaceLifecycle(command as ReconcileWorkspaceLifecycleCommand)
            : command.intent.kind === 'plan.update-term-end-date'
                ? digestUpdateTermEndDate(command as UpdateTermEndDateCommand)
                : digestRestoreTermAsCurrent(command as RestoreTermAsCurrentCommand);
        const effectCode: ReceiptEffect['code'] = command.intent.kind === 'workspace.reconcile-lifecycle'
            ? 'plan.term-auto-archived'
            : command.intent.kind === 'plan.update-term-end-date'
                ? 'plan.term-end-date-updated'
                : 'plan.term-restored-current';
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
                    return planConflictResult('command-id-reused', versions);
                }

                const outcome = this.readReceiptOutcome(command.commandId);
                this.rollbackOrRequireReopen();
                if (!outcome) {
                    throw new Error('Stored receipt outcome is incomplete');
                }
                return successfulCommit(outcome);
            }

            const versions = this.currentVersions();
            if (versions.revision !== BigInt(command.expectedRevision)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-revision', versions);
            }
            if (versions.planVersion !== BigInt(command.expectedPlanVersion)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-entity-version', versions);
            }

            const term = this.database.prepare(`
                SELECT
                    terms.term_id,
                    terms.start_date,
                    terms.end_date,
                    terms.time_zone,
                    terms.archived,
                    terms.entity_version,
                    plan_state.current_term_id
                FROM terms
                JOIN plan_state ON plan_state.singleton = 1
                WHERE terms.term_id = ?
            `);
            term.setReadBigInts(true);
            const termRow = term.get(command.intent.payload.termId) as {
                term_id: string;
                start_date: string;
                end_date: string;
                time_zone: string;
                archived: bigint;
                entity_version: bigint;
                current_term_id: string | null;
            } | undefined;
            if (!termRow || termRow.entity_version !== BigInt(command.expectedTermVersion)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-entity-version', versions);
            }
            fireCommitFailpoint(options, 'commit.after-expected-versions');

            const evaluation = 'evaluation' in command
                ? command.evaluation
                : command.intent.kind === 'workspace.reconcile-lifecycle'
                    ? command.intent.payload.evaluation
                    : null;
            if (evaluation
                && (evaluation.termZone !== termRow.time_zone
                    || localDateInTermZone(evaluation.evaluatedAt, termRow.time_zone)
                        !== evaluation.applicableDate)) {
                this.rollbackOrRequireReopen();
                throw new TypeError('Term evaluation no longer matches the target Term');
            }

            if (command.intent.kind === 'workspace.reconcile-lifecycle') {
                if (termRow.current_term_id !== termRow.term_id
                    || termRow.archived !== 0n
                    || command.intent.payload.evaluation.applicableDate <= termRow.end_date) {
                    this.rollbackOrRequireReopen();
                    throw new TypeError('Current Term is not eligible for automatic archive');
                }
            }
            else if (command.intent.kind === 'plan.update-term-end-date') {
                const newEndDate = command.intent.payload.endDate;
                if (newEndDate < termRow.start_date) {
                    this.rollbackOrRequireReopen();
                    throw new TypeError('Term end date must not precede its start date');
                }

                const strandedHolidayRange = this.database.prepare(`
                    SELECT holiday_range_id
                    FROM holiday_ranges
                    WHERE term_id = ? AND tombstoned = 0 AND end_date > ?
                    LIMIT 1
                `).get(termRow.term_id, newEndDate) as { holiday_range_id: string } | undefined;
                if (strandedHolidayRange) {
                    this.rollbackOrRequireReopen();
                    throw new TypeError('Corrected Term range would exclude a HolidayRange');
                }

                const courseStatement = this.database.prepare(`
                    SELECT
                        course_id,
                        teaching_range_kind,
                        teaching_start_date,
                        teaching_end_date
                    FROM courses
                    WHERE term_id = ?
                `);
                const courses = courseStatement.all(termRow.term_id) as Array<{
                    course_id: string;
                    teaching_range_kind: CourseTeachingRangeIntent['kind'];
                    teaching_start_date: string | null;
                    teaching_end_date: string | null;
                }>;
                const resolvedCourses = courses.map(course => ({
                    courseId: course.course_id,
                    startDate: course.teaching_range_kind === 'inherit-term'
                        ? termRow.start_date
                        : course.teaching_start_date!,
                    endDate: course.teaching_range_kind === 'inherit-term'
                        ? newEndDate
                        : course.teaching_end_date!,
                }));
                if (resolvedCourses.some(course => (
                    course.startDate < termRow.start_date || course.endDate > newEndDate
                ))) {
                    this.rollbackOrRequireReopen();
                    throw new TypeError('Corrected Term range would exclude a Course');
                }

                const meetingStatement = this.database.prepare(`
                    SELECT
                        meeting_series.course_id,
                        meeting_segments.effective_range_kind,
                        meeting_segments.effective_start_date,
                        meeting_segments.effective_end_date
                    FROM meeting_segments
                    JOIN meeting_series
                        ON meeting_series.meeting_series_id = meeting_segments.meeting_series_id
                    JOIN courses ON courses.course_id = meeting_series.course_id
                    WHERE courses.term_id = ?
                `);
                const meetings = meetingStatement.all(termRow.term_id) as Array<{
                    course_id: string;
                    effective_range_kind: MeetingEffectiveRangeIntent['kind'];
                    effective_start_date: string | null;
                    effective_end_date: string | null;
                }>;
                const meetingOutsideCourse = meetings.some(meeting => {
                    const course = resolvedCourses.find(candidate => candidate.courseId === meeting.course_id)!;
                    const startDate = meeting.effective_range_kind === 'inherit-course'
                        ? course.startDate
                        : meeting.effective_start_date!;
                    const endDate = meeting.effective_range_kind === 'inherit-course'
                        ? course.endDate
                        : meeting.effective_end_date!;
                    return startDate < course.startDate || endDate > course.endDate;
                });
                if (meetingOutsideCourse) {
                    this.rollbackOrRequireReopen();
                    throw new TypeError('Corrected Term range would exclude a Meeting');
                }

                const weeklyTasks = this.database.prepare(`
                    SELECT
                        task_series.course_id,
                        task_segments.weekly_start_date,
                        task_segments.weekly_confirmed_end_date
                    FROM task_segments
                    JOIN task_series ON task_series.task_series_id = task_segments.task_series_id
                    JOIN courses ON courses.course_id = task_series.course_id
                    WHERE courses.term_id = ?
                        AND task_segments.schedule_kind = 'weekly'
                `).all(termRow.term_id) as Array<{
                    course_id: string;
                    weekly_start_date: string;
                    weekly_confirmed_end_date: string;
                }>;
                const taskOutsideCourse = weeklyTasks.some(task => {
                    const course = resolvedCourses.find(candidate => candidate.courseId === task.course_id)!;
                    return task.weekly_start_date < course.startDate
                        || task.weekly_confirmed_end_date > course.endDate;
                });
                if (taskOutsideCourse) {
                    this.rollbackOrRequireReopen();
                    throw new TypeError('Corrected Term range would exclude a weekly Task');
                }
            }
            else if (termRow.archived !== 1n
                || termRow.current_term_id !== null
                || evaluation === null
                || evaluation.applicableDate > termRow.end_date) {
                this.rollbackOrRequireReopen();
                throw new TypeError('Term is not eligible to restore as Current');
            }

            if (versions.revision === SQLITE_INTEGER_MAX
                || versions.planVersion === SQLITE_INTEGER_MAX
                || termRow.entity_version === SQLITE_INTEGER_MAX) {
                this.rollbackOrRequireReopen();
                throw this.enterTerminalState();
            }

            const newRevision = versions.revision + 1n;
            const newPlanVersion = versions.planVersion + 1n;
            const newTermVersion = termRow.entity_version + 1n;
            if (command.intent.kind === 'workspace.reconcile-lifecycle') {
                this.database.prepare(`
                    UPDATE terms SET archived = 1, entity_version = ? WHERE term_id = ?
                `).run(newTermVersion, termRow.term_id);
                this.database.prepare(`
                    UPDATE plan_state
                    SET current_term_id = NULL, plan_entity_version = ?
                    WHERE singleton = 1
                `).run(newPlanVersion);
            }
            else if (command.intent.kind === 'plan.update-term-end-date') {
                this.database.prepare(`
                    UPDATE terms SET end_date = ?, entity_version = ? WHERE term_id = ?
                `).run(command.intent.payload.endDate, newTermVersion, termRow.term_id);
                this.database.prepare(`
                    UPDATE plan_state SET plan_entity_version = ? WHERE singleton = 1
                `).run(newPlanVersion);
            }
            else {
                this.database.prepare(`
                    UPDATE terms SET archived = 0, entity_version = ? WHERE term_id = ?
                `).run(newTermVersion, termRow.term_id);
                this.database.prepare(`
                    UPDATE plan_state
                    SET current_term_id = ?, plan_entity_version = ?
                    WHERE singleton = 1
                `).run(termRow.term_id, newPlanVersion);
            }
            this.advanceSetupMinimumMilestone();
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
                ) VALUES (?, ?, 1, 'courseflow-canonical-json-v1', 'sha256', ?, ?, 'committed')
            `).run(command.commandId, command.intent.kind, digest, newRevision);
            fireCommitFailpoint(options, 'commit.after-receipt');

            this.database.prepare(`
                INSERT INTO receipt_effects (
                    command_id,
                    effect_order,
                    effect_code,
                    entity_kind,
                    entity_id,
                    entity_version
                ) VALUES (?, 0, ?, 'term', ?, ?)
            `).run(command.commandId, effectCode, termRow.term_id, newTermVersion);
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
        }
        catch (error) {
            if (this.terminalError) {
                throw this.terminalError;
            }
            if (commitAttempted) {
                throw this.enterTerminalState(new CommittedCommandOutcomeUnknownError(command.commandId));
            }
            this.rollbackOrRequireReopen();
            if (error instanceof TypeError) {
                throw error;
            }
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
                if (work.kind === 'commit') {
                    const result = this.commitSynchronously(work.command, work.options);
                    work.resolve(result);
                    if (result.ok) {
                        this.schedulePostCommitHint();
                    }
                }
                else {
                    work.resolve(this.writeSetupDraftSynchronously(work.mutation, work.options));
                }
            } catch (error) {
                work.reject(error);
                if (work.kind === 'commit' && error instanceof CommittedCommandOutcomeUnknownError) {
                    this.schedulePostCommitHint();
                }
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

    /**
     * Schedules the detachable best-effort PostCommit wake after local outcome resolution.
     * @return {void}
     */
    private schedulePostCommitHint(): void {
        const hint = this.postCommitHint;
        if (!hint) {
            return;
        }
        queueMicrotask(() => {
            if (this.postCommitHint !== hint) {
                return;
            }
            try {
                hint();
            }
            catch {
                // DurableFollowUp remains authoritative when the best-effort hint fails.
            }
        });
    }

    private enterTerminalState(error = new Error('Workspace data store requires reopen')): Error {
        if (this.terminalError) {
            return this.terminalError;
        }

        this.terminalError = error;
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

function migrationSafetyUnavailableProblem(): DataOpenProblem {
    return Object.freeze({
        code: 'migration-safety-unavailable' as const,
        scope: 'workspace' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezePair(['workspace.read' as const, 'workspace.write' as const]),
        allowedActions: freezeEmptyTuple(),
        context: Object.freeze({}),
        details: Object.freeze({reason: 'build-binding-missing' as const}),
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
        const facts = validateSchemaLevel15(candidate);
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
        validateSchemaLevel15(database);
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
        createSchemaLevel15(stagingDatabase);
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
            validateSchemaLevel15(validationDatabase);
        } finally {
            validationDatabase.close();
        }
        throwFailpoint(options.failpoint, 'initialize.after-validation');

        renameSync(stagingDirectory, activeDirectory(dataSlotsRoot));
        activated = true;
        const activeDatabase = openDatabase(databasePath(dataSlotsRoot), false);
        const facts = validateSchemaLevel15(activeDatabase);
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

        const facts = validateSchemaLevel15(validationDatabase);
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
        const facts = validateSchemaLevel15(activeDatabase);
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
            || (identity.schemaLevel !== 1
                && identity.schemaLevel !== 2
                && identity.schemaLevel !== 3
                && identity.schemaLevel !== 4
                && identity.schemaLevel !== 5
                && identity.schemaLevel !== 6
                && identity.schemaLevel !== 7
                && identity.schemaLevel !== 8
                && identity.schemaLevel !== 9
                && identity.schemaLevel !== 10
                && identity.schemaLevel !== 11
                && identity.schemaLevel !== 12
                && identity.schemaLevel !== 13
                && identity.schemaLevel !== 14
                && identity.schemaLevel !== 15)) {
            closeBestEffort(source);
            return opened;
        }
        let sourceFacts: SchemaFacts;
        if (identity.schemaLevel === 1) {
            sourceFacts = validateSchemaLevel1(source);
        }
        else if (identity.schemaLevel === 2) {
            sourceFacts = validateSchemaLevel2(source);
        }
        else if (identity.schemaLevel === 3) {
            sourceFacts = validateSchemaLevel3(source);
        }
        else if (identity.schemaLevel === 4) {
            sourceFacts = validateSchemaLevel4(source);
        }
        else if (identity.schemaLevel === 5) {
            sourceFacts = validateSchemaLevel5(source);
        }
        else if (identity.schemaLevel === 6) {
            sourceFacts = validateSchemaLevel6(source);
        }
        else if (identity.schemaLevel === 7) {
            sourceFacts = validateSchemaLevel7(source);
        }
        else if (identity.schemaLevel === 8) {
            sourceFacts = validateSchemaLevel8(source);
        }
        else if (identity.schemaLevel === 9) {
            sourceFacts = validateSchemaLevel9(source);
        }
        else if (identity.schemaLevel === 10) {
            sourceFacts = validateSchemaLevel10(source);
        }
        else if (identity.schemaLevel === 11) {
            sourceFacts = validateSchemaLevel11(source);
        }
        else if (identity.schemaLevel === 12) {
            sourceFacts = validateSchemaLevel12(source);
        }
        else if (identity.schemaLevel === 13) {
            sourceFacts = validateSchemaLevel13(source);
        }
        else if (identity.schemaLevel === 14) {
            sourceFacts = validateSchemaLevel14(source);
        }
        else {
            sourceFacts = validateSchemaLevel15(source);
        }
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
                    if (schemaLevel === 1) {
                        validateSchemaLevel1(maintenance);
                        migrateLevel1To2(maintenance);
                        validateSchemaLevel2(maintenance);
                    }
                    else if (schemaLevel === 2) {
                        validateSchemaLevel2(maintenance);
                        migrateLevel2To3(maintenance);
                        validateSchemaLevel3(maintenance);
                    }
                    else if (schemaLevel === 3) {
                        validateSchemaLevel3(maintenance);
                        migrateLevel3To4(maintenance);
                        validateSchemaLevel4(maintenance);
                    }
                    else if (schemaLevel === 4) {
                        validateSchemaLevel4(maintenance);
                        migrateLevel4To5(maintenance);
                        validateSchemaLevel5(maintenance);
                    }
                    else if (schemaLevel === 5) {
                        validateSchemaLevel5(maintenance);
                        migrateLevel5To6(maintenance);
                        validateSchemaLevel6(maintenance);
                    }
                    else if (schemaLevel === 6) {
                        validateSchemaLevel6(maintenance);
                        migrateLevel6To7(maintenance);
                        validateSchemaLevel7(maintenance);
                    }
                    else if (schemaLevel === 7) {
                        validateSchemaLevel7(maintenance);
                        migrateLevel7To8(maintenance);
                        validateSchemaLevel8(maintenance);
                    }
                    else if (schemaLevel === 8) {
                        validateSchemaLevel8(maintenance);
                        migrateLevel8To9(maintenance);
                        validateSchemaLevel9(maintenance);
                    }
                    else if (schemaLevel === 9) {
                        validateSchemaLevel9(maintenance);
                        migrateLevel9To10(maintenance);
                        validateSchemaLevel10(maintenance);
                    }
                    else if (schemaLevel === 10) {
                        validateSchemaLevel10(maintenance);
                        migrateLevel10To11(maintenance);
                        validateSchemaLevel11(maintenance);
                    }
                    else if (schemaLevel === 11) {
                        validateSchemaLevel11(maintenance);
                        migrateLevel11To12(maintenance);
                        validateSchemaLevel12(maintenance);
                    }
                    else if (schemaLevel === 12) {
                        validateSchemaLevel12(maintenance);
                        migrateLevel12To13(maintenance);
                        validateSchemaLevel13(maintenance);
                    }
                    else if (schemaLevel === 13) {
                        validateSchemaLevel13(maintenance);
                        migrateLevel13To14(maintenance);
                        validateSchemaLevel14(maintenance);
                    }
                    else if (schemaLevel === 14) {
                        validateSchemaLevel14(maintenance);
                        migrateLevel14To15(maintenance);
                        validateSchemaLevel15(maintenance);
                    }
                    else {
                        validateSchemaLevel15(maintenance);
                        migrateLevel15To16(maintenance);
                        validateSchemaLevel16(maintenance);
                    }
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
            validateSchemaLevel15(maintenance);
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
