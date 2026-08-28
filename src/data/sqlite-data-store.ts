/**
 * @file Implements the transactional SQLite owner for Workspace facts and receipts.
 */
import { receipt as receiptUnit, readPendingFollowUps as readPendingFollowUpsUnit, readProtectionWatermark as readProtectionWatermarkUnit, readProtectionWatermarks as readProtectionWatermarksUnit } from './store/protection/follow-ups';
import { claimBackupOperation as claimBackupOperationUnit, readBackupOperation as readBackupOperationUnit, readBackupOperationForSnapshot as readBackupOperationForSnapshotUnit, recordBackupCheckpoint as recordBackupCheckpointUnit, advanceBackupOperation as advanceBackupOperationUnit, recordBackupSuccess as recordBackupSuccessUnit, readSuccessfulBackupSnapshots as readSuccessfulBackupSnapshotsUnit } from './store/protection/backup-operations';
import { claimBackupCleanupOperation as claimBackupCleanupOperationUnit, readBackupCleanupOperation as readBackupCleanupOperationUnit, releasePlannedBackupCleanup as releasePlannedBackupCleanupUnit, markBackupCleanupQuarantined as markBackupCleanupQuarantinedUnit, markBackupCleanupDeleting as markBackupCleanupDeletingUnit, completeBackupCleanup as completeBackupCleanupUnit } from './store/protection/backup-cleanup';
import { readDataProtectionProjection as readDataProtectionProjectionUnit, readBackupConfigurationForProtection as readBackupConfigurationForProtectionUnit, readBackupConfigurationForCommand as readBackupConfigurationForCommandUnit } from './store/protection/projection';
import { readRestoreSessions as readRestoreSessionsUnit, readRestoreCommandReceipt as readRestoreCommandReceiptUnit, readRestoreCompletionReceipt as readRestoreCompletionReceiptUnit, recordRestoreCompletionReceipt as recordRestoreCompletionReceiptUnit, createRestoreSession as createRestoreSessionUnit, advanceRestoreSession as advanceRestoreSessionUnit, cancelRestoreSession as cancelRestoreSessionUnit } from './store/protection/restore-store';
import { inspectRestoreCandidateDatabase as inspectRestoreCandidateDatabaseUnit, prepareRestoreCandidateDatabaseCopy as prepareRestoreCandidateDatabaseCopyUnit, writeRestoreSafetyDatabaseCopy as writeRestoreSafetyDatabaseCopyUnit, validateRestoreSafetyDatabaseCopy as validateRestoreSafetyDatabaseCopyUnit, writeBackupDatabaseCopy as writeBackupDatabaseCopyUnit, validateBackupDatabaseCopy as validateBackupDatabaseCopyUnit } from './store/protection/restore-candidates';
import { readSetupProjection as readSetupProjectionUnit, readWorkspaceSetupSnapshot as readWorkspaceSetupSnapshotUnit } from './store/reads/setup';
import { readPlanProjectionSource as readPlanProjectionSourceUnit } from './store/reads/plan';
import { previewTaskOccurrenceChange as previewTaskOccurrenceChangeUnit, readTaskSeriesDetail as readTaskSeriesDetailUnit } from './store/reads/task';
import { previewMeetingOccurrenceChange as previewMeetingOccurrenceChangeUnit, readMeetingSeriesDetail as readMeetingSeriesDetailUnit } from './store/reads/meeting';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {basename, isAbsolute, join} from 'node:path';
import { backup, DatabaseSync, type DatabaseSyncOptions } from 'node:sqlite';
import { canonicalJson } from '../shared/canonical-json';
import { commitSynchronously } from './store/commits/dispatch';
import { writeSetupDraftSynchronously } from './store/commits/setup';
import { readActiveHolidayRanges } from './store/conflict-reads';
import { currentVersions, insertRestoreCommandReceipt, readReceiptOutcome } from './store/context';
import type { StoreContext } from './store/context';
import { DATABASE_FILE_NAME, SQLITE_VERSION, activeDirectory, classifySqliteFailure, closeBestEffort, databasePath, decimalFromCoefficient, decimalToCoefficient, fireCommitFailpoint, hasSchemaObjects, normalizeBackupDatabaseCopy, openDatabase, readDatabaseIdentity, readRestoreImpactCounts, readRestoreSourceBackup, throwFailpoint, validateSupportedRestoreSchema } from './store/database';
import { isChangeMeetingOccurrenceCommand, isConfigureBackupDestinationCommand, isCourseWithMeetingCommand, isCreateCourseCommand, isCreateMeetingSeriesCommand, isCurrentChangeMeetingOccurrenceCommand, isCurrentCourseWithMeetingCommand, isHolidayRangeCommand, isMeetingOccurrenceMutationCommand, isTaskCommand, isTaskOccurrenceRuleMutationCommand, isTaskOccurrenceStateMutationCommand, isTermMutationCommand } from './store/guards';
import type { CurrentVersions, MeetingOccurrenceMutationCommand, TaskOccurrenceRuleMutationCommand, TaskOccurrenceStateMutationCommand, TaskSeriesMutationCommand, TermMutationCommand, WorkspaceDataCommand } from './store/guards';
import { committedOutcome, committedPairOutcome, conflictResult, databaseUnreadableProblem, decisionRequiredResult, freezeEmptyTuple, freezeTuple, holidayRangeConflictResult, incompatibleVersionProblem, integrityProblem, meetingOverlapDecisionRequiredResult, meetingSeriesConflictResult, migrationSafetyUnavailableProblem, permissionCommitResult, permissionProblem, planConflictResult, protectionConflictResult, recoveryResult, setupDraftConflictResult, setupDraftPermissionResult, setupDraftWriterBusyResult, successfulCommit, taskSeriesConflictResult, unreadableOpenProblem, validationProblem, writerBusyResult } from './store/results';
import { BACKUP_PHASE_SUCCESSORS, backupCleanupOperationFromRow, backupOperationFromRow, requireRestoreCompletionReceiptInput, restoreCompletionReceiptFromRow, restoreSessionFromRow } from './store/rows';
import type { BackupCleanupOperationRow, BackupOperationRow, RestoreCompletionReceiptRow, RestoreSessionRow } from './store/rows';
import { COMMIT_QUEUE_CAPACITY, CommittedCommandOutcomeUnknownError, SQLITE_INTEGER_MAX, SetupDraftCheckpointOutcomeUnknownError } from './store/types';
import type { BackupCleanupOperation, BackupConfigurationForProtection, BackupDatabaseFacts, BackupOperation, BackupOperationPhase, CommandReceiptOutcome, CommitOptions, DataCommitResult, DataOpenProblem, DurableFollowUp, InitializeWorkspaceDataOptions, OpenWorkspaceDataOptions, PreparedRestoreDatabaseFacts, ReadSnapshotOptions, ReceiptEffect, RestoreActivationCloseFailpoint, RestoreCompletionReceipt, RestoreCompletionReceiptInput, RestoreDataSlotFacts, RestoreDatabaseFacts, SetupDraftCheckpointWriteResult, SetupDraftWork, StoreWriteWork, StoredBackupDestination, StoredRestoreCommandReceipt, StoredRestoreSession, SuccessfulBackupSnapshot, WorkspaceDataStatus, WorkspaceSetupSnapshot } from './store/types';

import {
    constants as fsConstants,
    copyFileSync,
    existsSync,
    lstatSync,
    mkdirSync,
    renameSync,
    rmSync,
} from 'node:fs';

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
    createSchemaLevel16,
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
    CommittedCommandOutcomeUnknownError,
    SetupDraftCheckpointOutcomeUnknownError,
    type InitializeFailpoint,
    type InitializeWorkspaceDataOptions,
    type OpenWorkspaceDataOptions,
    type RestoreActivationCloseFailpoint,
    type RestoreDataSlotFacts,
    type MigrationFailpoint,
    type DataOpenProblem,
    type WorkspaceDataStatus,
    type WorkspaceSetupSnapshot,
    type ReadSnapshotOptions,
    type CommitFailpoint,
    type CommitOptions,
    type StoredBackupDestination,
    type CommandReceiptOutcome,
    type DurableFollowUp,
    type BackupOperationPhase,
    type BackupOperation,
    type SuccessfulBackupSnapshot,
    type RestoreDatabaseFacts,
    type PreparedRestoreDatabaseFacts,
    type StoredRestoreSession,
    type StoredRestoreCommandReceipt,
    type RestoreCompletionReceiptInput,
    type RestoreCompletionReceipt,
    type BackupCleanupOperation,
    type BackupDatabaseFacts,
    type BackupConfigurationForProtection,
    type DataCommitResult,
    type SetupDraftCheckpointWriteResult,
} from './store/types';
export {
    workspaceDataRuntimeVersion,
    classifySqliteFailure,
    type SqliteFailureDisposition,
} from './store/database';

export {
    consumeMigrationSafetyCopyAfterRollback,
    deleteMigrationSafetyCopy,
    inspectMigrationSafetyCopy,
    migrationSafetyCopyDeleteConfirmationToken,
    stageMigrationSafetyCopyForRollback,
    type ConsumeMigrationSafetyCopyOptions,
    type DeleteMigrationSafetyCopyOptions,
    type MigrationSafetyCopyMetadataV1,
    type MigrationSafetyCopyStatus,
    type MigrationRollbackArtifactV1,
    type MigrationRollbackTargetV1,
} from './migration-safety-copy';
import {
    firstTaskWeeklyAnchor,
    firstWeeklyLogicalAnchor,
    candidateLogicalAnchors,
    hasOccurrenceOutsideRequestedWindow,
    isActiveLogicalAnchor,
    lastTaskWeeklyAnchor,
    logicalAnchorBelongsToSegment,
    occurrenceDate,
    planOccurrenceWindows,
    validateMeetingSegmentSequence,
} from '../plan/anchors';
import {
    addClampedLocalDateDays,
    addLocalDateDays,
    localDateMilliseconds,
} from '../plan/local-date';
import {
    expandConflictMeetingOccurrences,
    meetingLocation,
    meetingTypeName,
} from '../plan/meeting-occurrences';
import type {
    ConflictMeetingOccurrence,
    StoredConflictMeetingOverride,
    StoredConflictMeetingSegment,
    StoredHolidayRange,
    StoredMeetingOverride,
    StoredMeetingSegment,
} from '../plan/meeting-occurrences';
import {
    meetingOverlapWarningKey,
    meetingOverlapWarnings,
    meetingScheduleOverlapWarnings,
} from '../plan/meeting-overlap';
import {
    meetingOccurrenceConfirmationToken,
    taskOccurrenceConfirmationToken,
} from '../plan/confirmation-tokens';
import {
    taskDeadlineColumns,
    taskDeadlineProjection,
    taskLogicalAnchors,
    taskOccurrenceStateProjection,
    taskOverrideReplacement,
    taskSchedule,
    taskScheduleColumns,
    taskScheduleProjection,
    taskSegmentForAnchor,
    taskSegmentOccurrenceDeadline,
} from '../plan/task-schedule';
import type {
    StoredTaskOccurrenceOverride,
    StoredTaskOccurrenceState,
    StoredTaskSchedule,
    StoredTaskSegment,
} from '../plan/task-schedule';









export type DataOpenResult =
    | Readonly<{ kind: 'absent'; sqliteVersion: string }>
    | Readonly<{ kind: 'ready'; sqliteVersion: string; store: SqliteDataStore }>
    | Readonly<{ kind: 'read-only'; sqliteVersion: string; store: SqliteDataStore }>
    | Readonly<{ kind: 'recovery'; sqliteVersion: string; problem: DataOpenProblem }>;





















































































































































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
    private readonly storeContext: StoreContext;

    public constructor(
        private readonly database: DatabaseSync,
        private readonly workspaceId: string,
        revision: bigint,
        private readOnly = false,
    ) {
        this.revision = revision;
        this.storeContext = Object.freeze({
            database,
            workspaceId,
            revision: () => this.revision,
            setRevision: (next: bigint) => { this.revision = next; },
            isReadOnly: () => this.readOnly,
            markReadOnly: () => { this.readOnly = true; },
            terminalError: () => this.terminalError,
            enterTerminalState: (error?: Error) => error === undefined ? this.enterTerminalState() : this.enterTerminalState(error),
            rollbackOrRequireReopen: () => this.rollbackOrRequireReopen(),
            requireOpen: () => this.requireOpen(),
            requireBackupMutationAllowed: () => this.requireBackupMutationAllowed(),
        });
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
        return readWorkspaceSetupSnapshotUnit(this.storeContext, options);
    }

    public readSetupProjection(options: ReadSnapshotOptions = {}): SetupProjection {
        return readSetupProjectionUnit(this.storeContext, options);
    }

    public readPlanProjectionSource(options: ReadSnapshotOptions = {}): PlanProjectionSource {
        return readPlanProjectionSourceUnit(this.storeContext, options);
    }

    public readTaskSeriesDetail(
        taskSeriesId: string,
        candidateWindow: TaskOccurrenceWindow,
    ): TaskSeriesDetailProjection {
        return readTaskSeriesDetailUnit(this.storeContext, taskSeriesId, candidateWindow);
    }

    public previewTaskOccurrenceChange(
        candidate: TaskOccurrenceImpactDraft,
    ): TaskOccurrenceImpactProjection {
        return previewTaskOccurrenceChangeUnit(this.storeContext, candidate);
    }

    public readMeetingSeriesDetail(
        meetingSeriesId: string,
        candidateWindow: MeetingOccurrenceWindow,
    ): MeetingSeriesDetailProjection {
        return readMeetingSeriesDetailUnit(this.storeContext, meetingSeriesId, candidateWindow);
    }

    public previewMeetingOccurrenceChange(
        candidate: MeetingOccurrenceImpactDraft,
    ): MeetingOccurrenceImpactProjection {
        return previewMeetingOccurrenceChangeUnit(this.storeContext, candidate);
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
        return receiptUnit(this.storeContext, commandId);
    }

    public readPendingFollowUps(): readonly DurableFollowUp[] {
        return readPendingFollowUpsUnit(this.storeContext);
    }

    public readProtectionWatermark(): string {
        return readProtectionWatermarkUnit(this.storeContext);
    }

    public readProtectionWatermarks(): Readonly<{
        neededThrough: string;
        succeededThrough: string;
    }> {
        return readProtectionWatermarksUnit(this.storeContext);
    }

    public claimBackupOperation(input: Readonly<{
        operationId: string;
        snapshotId: string;
        stagingDirectoryName: string;
        createdAt: string;
    }>): BackupOperation | null {
        return claimBackupOperationUnit(this.storeContext, input);
    }

    public readBackupOperation(): BackupOperation | null {
        return readBackupOperationUnit(this.storeContext);
    }

    public readBackupOperationForSnapshot(snapshotId: string): BackupOperation | null {
        return readBackupOperationForSnapshotUnit(this.storeContext, snapshotId);
    }

    public recordBackupCheckpoint(operationId: string, actualRevision: string): BackupOperation {
        return recordBackupCheckpointUnit(this.storeContext, operationId, actualRevision);
    }

    public advanceBackupOperation(
        operationId: string,
        expectedPhase: BackupOperationPhase,
        nextPhase: BackupOperationPhase,
    ): BackupOperation {
        return advanceBackupOperationUnit(this.storeContext, operationId, expectedPhase, nextPhase);
    }

    public recordBackupSuccess(input: Readonly<{
        operationId: string;
        actualRevision: string;
        rootDigest: string;
        succeededAt: string;
    }>): BackupOperation {
        return recordBackupSuccessUnit(this.storeContext, input);
    }

    public readSuccessfulBackupSnapshots(): readonly SuccessfulBackupSnapshot[] {
        return readSuccessfulBackupSnapshotsUnit(this.storeContext);
    }

    public claimBackupCleanupOperation(
        operationId: string,
        snapshotId: string,
    ): BackupCleanupOperation | null {
        return claimBackupCleanupOperationUnit(this.storeContext, operationId, snapshotId);
    }

    public readBackupCleanupOperation(): BackupCleanupOperation | null {
        return readBackupCleanupOperationUnit(this.storeContext);
    }

    public releasePlannedBackupCleanup(operationId: string): void {
        return releasePlannedBackupCleanupUnit(this.storeContext, operationId);
    }

    public markBackupCleanupQuarantined(operationId: string): BackupCleanupOperation {
        return markBackupCleanupQuarantinedUnit(this.storeContext, operationId);
    }

    public markBackupCleanupDeleting(operationId: string): BackupCleanupOperation {
        return markBackupCleanupDeletingUnit(this.storeContext, operationId);
    }

    public completeBackupCleanup(operationId: string): void {
        return completeBackupCleanupUnit(this.storeContext, operationId);
    }

    public readDataProtectionProjection(): DataProtectionProjection {
        return readDataProtectionProjectionUnit(this.storeContext);
    }

    public readBackupConfigurationForProtection(): BackupConfigurationForProtection | null {
        return readBackupConfigurationForProtectionUnit(this.storeContext);
    }

    public readBackupConfigurationForCommand(commandId: string): StoredBackupDestination | null {
        return readBackupConfigurationForCommandUnit(this.storeContext, commandId);
    }

    public readRestoreSessions(): readonly StoredRestoreSession[] {
        return readRestoreSessionsUnit(this.storeContext);
    }

    public readRestoreCommandReceipt(commandId: string): StoredRestoreCommandReceipt | null {
        return readRestoreCommandReceiptUnit(this.storeContext, commandId);
    }

    public readRestoreCompletionReceipt(operationId: string): RestoreCompletionReceipt | null {
        return readRestoreCompletionReceiptUnit(this.storeContext, operationId);
    }

    public recordRestoreCompletionReceipt(
        input: RestoreCompletionReceiptInput,
    ): RestoreCompletionReceipt {
        return recordRestoreCompletionReceiptUnit(this.storeContext, input);
    }

    public createRestoreSession(
        session: StoredRestoreSession,
        receipt: StoredRestoreCommandReceipt,
    ): void {
        return createRestoreSessionUnit(this.storeContext, session, receipt);
    }

    public advanceRestoreSession(
        session: StoredRestoreSession,
        expectedVersion: string,
        receipt: StoredRestoreCommandReceipt,
    ): void {
        return advanceRestoreSessionUnit(this.storeContext, session, expectedVersion, receipt);
    }

    public cancelRestoreSession(
        session: StoredRestoreSession,
        expectedVersion: string,
        receipt: StoredRestoreCommandReceipt,
    ): void {
        return cancelRestoreSessionUnit(this.storeContext, session, expectedVersion, receipt);
    }

    public inspectRestoreCandidateDatabase(candidatePath: string): RestoreDatabaseFacts {
        return inspectRestoreCandidateDatabaseUnit(this.storeContext, candidatePath);
    }

    public prepareRestoreCandidateDatabaseCopy(
        sourcePath: string,
        destinationPath: string,
    ): PreparedRestoreDatabaseFacts {
        return prepareRestoreCandidateDatabaseCopyUnit(this.storeContext, sourcePath, destinationPath);
    }

    public async writeRestoreSafetyDatabaseCopy(
        destinationPath: string,
        expectedRevision: string,
    ): Promise<BackupDatabaseFacts> {
        return writeRestoreSafetyDatabaseCopyUnit(this.storeContext, destinationPath, expectedRevision);
    }

    public validateRestoreSafetyDatabaseCopy(
        copyPath: string,
        minimumRevision: string,
    ): BackupDatabaseFacts {
        return validateRestoreSafetyDatabaseCopyUnit(this.storeContext, copyPath, minimumRevision);
    }

    public async writeBackupDatabaseCopy(
        destinationPath: string,
        targetRevision: string,
    ): Promise<BackupDatabaseFacts> {
        return writeBackupDatabaseCopyUnit(this.storeContext, destinationPath, targetRevision);
    }

    public validateBackupDatabaseCopy(
        copyPath: string,
        targetRevision: string,
    ): BackupDatabaseFacts {
        return validateBackupDatabaseCopyUnit(this.storeContext, copyPath, targetRevision);
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


















    private drain(): void {
        let work = this.queue.shift();
        while (work) {
            try {
                if (work.kind === 'commit') {
                    const result = commitSynchronously(this.storeContext, work.command, work.options);
                    work.resolve(result);
                    if (result.ok) {
                        this.schedulePostCommitHint();
                    }
                }
                else {
                    work.resolve(writeSetupDraftSynchronously(this.storeContext, work.mutation, work.options));
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
        const facts = validateSchemaLevel16(candidate);
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
        validateSchemaLevel16(database);
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
        createSchemaLevel16(stagingDatabase);
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
            validateSchemaLevel16(validationDatabase);
        } finally {
            validationDatabase.close();
        }
        throwFailpoint(options.failpoint, 'initialize.after-validation');

        renameSync(stagingDirectory, activeDirectory(dataSlotsRoot));
        activated = true;
        const activeDatabase = openDatabase(databasePath(dataSlotsRoot), false);
        const facts = validateSchemaLevel16(activeDatabase);
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

        const facts = validateSchemaLevel16(validationDatabase);
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
        const facts = validateSchemaLevel16(activeDatabase);
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
            validateSchemaLevel16(maintenance);
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
