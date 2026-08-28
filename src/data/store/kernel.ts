/**
 * @file Stateful SQLite store kernel: connection ownership, write queue, and public delegation surface.
 */
import { readWorkspaceSetupSnapshot as readWorkspaceSetupSnapshotUnit, readSetupProjection as readSetupProjectionUnit } from './reads/setup';
import { readPlanProjectionSource as readPlanProjectionSourceUnit } from './reads/plan';
import { readTaskSeriesDetail as readTaskSeriesDetailUnit, previewTaskOccurrenceChange as previewTaskOccurrenceChangeUnit } from './reads/task';
import { readMeetingSeriesDetail as readMeetingSeriesDetailUnit, previewMeetingOccurrenceChange as previewMeetingOccurrenceChangeUnit } from './reads/meeting';
import { receipt as receiptUnit, readPendingFollowUps as readPendingFollowUpsUnit, readProtectionWatermark as readProtectionWatermarkUnit, readProtectionWatermarks as readProtectionWatermarksUnit } from './protection/follow-ups';
import { claimBackupOperation as claimBackupOperationUnit, readBackupOperation as readBackupOperationUnit, readBackupOperationForSnapshot as readBackupOperationForSnapshotUnit, recordBackupCheckpoint as recordBackupCheckpointUnit, advanceBackupOperation as advanceBackupOperationUnit, recordBackupSuccess as recordBackupSuccessUnit, readSuccessfulBackupSnapshots as readSuccessfulBackupSnapshotsUnit } from './protection/backup-operations';
import { claimBackupCleanupOperation as claimBackupCleanupOperationUnit, readBackupCleanupOperation as readBackupCleanupOperationUnit, releasePlannedBackupCleanup as releasePlannedBackupCleanupUnit, markBackupCleanupQuarantined as markBackupCleanupQuarantinedUnit, markBackupCleanupDeleting as markBackupCleanupDeletingUnit, completeBackupCleanup as completeBackupCleanupUnit } from './protection/backup-cleanup';
import { readDataProtectionProjection as readDataProtectionProjectionUnit, readBackupConfigurationForProtection as readBackupConfigurationForProtectionUnit, readBackupConfigurationForCommand as readBackupConfigurationForCommandUnit } from './protection/projection';
import { readRestoreSessions as readRestoreSessionsUnit, readRestoreCommandReceipt as readRestoreCommandReceiptUnit, readRestoreCompletionReceipt as readRestoreCompletionReceiptUnit, recordRestoreCompletionReceipt as recordRestoreCompletionReceiptUnit, createRestoreSession as createRestoreSessionUnit, advanceRestoreSession as advanceRestoreSessionUnit, cancelRestoreSession as cancelRestoreSessionUnit } from './protection/restore-store';
import { inspectRestoreCandidateDatabase as inspectRestoreCandidateDatabaseUnit, prepareRestoreCandidateDatabaseCopy as prepareRestoreCandidateDatabaseCopyUnit, writeRestoreSafetyDatabaseCopy as writeRestoreSafetyDatabaseCopyUnit, validateRestoreSafetyDatabaseCopy as validateRestoreSafetyDatabaseCopyUnit, writeBackupDatabaseCopy as writeBackupDatabaseCopyUnit, validateBackupDatabaseCopy as validateBackupDatabaseCopyUnit } from './protection/restore-candidates';
import { DatabaseSync } from 'node:sqlite';
import { CURRENT_SCHEMA_LEVEL } from '../schema';
import { commitSynchronously } from './commits/dispatch';
import { writeSetupDraftSynchronously } from './commits/setup';
import type { StoreContext } from './context';
import type { WorkspaceDataCommand } from './guards';
import { permissionCommitResult, permissionProblem, setupDraftPermissionResult, setupDraftWriterBusyResult, writerBusyResult } from './results';
import { COMMIT_QUEUE_CAPACITY, CommittedCommandOutcomeUnknownError } from './types';
import type { BackupCleanupOperation, BackupConfigurationForProtection, BackupDatabaseFacts, BackupOperation, BackupOperationPhase, CommandReceiptOutcome, CommitOptions, DataCommitResult, DurableFollowUp, PreparedRestoreDatabaseFacts, ReadSnapshotOptions, RestoreActivationCloseFailpoint, RestoreCompletionReceipt, RestoreCompletionReceiptInput, RestoreDatabaseFacts, SetupDraftCheckpointWriteResult, SetupDraftWork, StoreWriteWork, StoredBackupDestination, StoredRestoreCommandReceipt, StoredRestoreSession, SuccessfulBackupSnapshot, WorkspaceDataStatus, WorkspaceSetupSnapshot } from './types';
import { isCanonicalInstant } from '../../shared/meeting-time';
import { MeetingOccurrenceImpactDraft, MeetingOccurrenceWindow, normalizeAcceptedChangeMeetingOccurrenceCommand, normalizeAcceptedCreateCourseWithMeetingCommand, normalizeCancelMeetingOccurrenceCommand, normalizeCreateCourseCommand, normalizeCreateMeetingSeriesCommand } from '../../shared/workspace-course-contract';
import type { MeetingOccurrenceImpactProjection, MeetingSeriesDetailProjection } from '../../shared/workspace-course-contract';
import { isCanonicalUnsignedSqliteInteger, normalizeRecordSetupDecisionCommand } from '../../shared/workspace-data-contract';
import { normalizeCreateHolidayRangeCommand, normalizeDeleteHolidayRangeCommand, normalizeUpdateHolidayRangeCommand } from '../../shared/workspace-holiday-contract';
import { PlanProjectionSource } from '../../shared/workspace-plan-contract';
import { normalizeAcceptedConfigureBackupDestinationCommand } from '../../shared/workspace-protection-contract';
import type { DataProtectionProjection } from '../../shared/workspace-protection-contract';
import { TaskOccurrenceImpactDraft, TaskOccurrenceWindow, normalizeChangeTaskOccurrenceCommand, normalizeCompleteTaskCommand, normalizeCreateTaskCommand, normalizeDeleteTaskCommand, normalizeDeleteTaskOccurrenceOrSeriesCommand, normalizeSetTaskOccurrenceStatusCommand, normalizeSetTaskProgressCommand, normalizeUndoTaskOccurrenceStateCommand, normalizeUpdateTaskCommand } from '../../shared/workspace-task-contract';
import type { TaskOccurrenceImpactProjection, TaskSeriesDetailProjection } from '../../shared/workspace-task-contract';
import { MAX_SETUP_DRAFT_PAYLOAD_BYTES, normalizeCreateTermCommand, normalizeReconcileWorkspaceLifecycleCommand, normalizeRestoreTermAsCurrentCommand, normalizeUpdateTermEndDateCommand } from '../../shared/workspace-term-contract';
import type { SetupProjection } from '../../shared/workspace-term-contract';
export class SqliteDataStoreImplementation {
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
