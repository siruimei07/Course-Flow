/**
 * @file Coordinates Workspace queries and formal DATA intents for the desktop shell.
 */
import { tryRestoreMigrationRollbackBinding } from './migration-boot';
import { randomUUID } from 'node:crypto';
import {CURRENT_SCHEMA_LEVEL} from '../data/schema';
import {observeRestoreDataSlot} from '../platform/restore-activation-files';
import { BackupDestinationPreparationError } from '../protect/backup-repository';
import { queryApplicationBuildStatus } from './build-status';
import { dataStateFrom, migrationOpenOptions } from './host';
import type { WorkspaceApplicationOptions, WorkspaceDataState, WorkspaceHost } from './host';
import { bootstrap, initialize } from './lifecycle-routing';
import { cancelMigrationRollback, confirmMigrationRollback, continueMigrationRollback, deleteMigrationSafetyCopy, previewMigrationRollback, queryMigrationRollback, queryMigrationSafetyCopy } from './migration-rollback';
import { problem } from './outcomes';
import { commitHolidayRange, commitMeetingOccurrence, commitTask, createCourse, createCourseWithMeeting, createMeetingSeries, createTerm, restoreTermAsCurrent, updateTermEndDate } from './plan-commands';
import { previewMeetingOccurrence, previewTaskOccurrence, queryMeetingSeries, queryPlan, queryTaskSeries } from './plan-queries';
import { migrationRollbackEvidenceProblem, migrationRollbackProblem, requestIdFrom, requestKindFrom, restoreActivationProblem } from './projections';
import { queryDataProtection } from './protection';
import { cancelRestoreSession, confirmRestoreSession, queryRestoreSession, resumeRestoreSession, rollbackRestoreSession, startRestoreSession } from './restore';
import { discardSetupDraftCheckpoint, querySetup, saveSetupDraftCheckpoint } from './setup-commands';


import {
    CommittedCommandOutcomeUnknownError,
    SetupDraftCheckpointOutcomeUnknownError,
    consumeMigrationSafetyCopyAfterRollback,
    initializeWorkspaceData,
    inspectMigrationSafetyCopy,
    migrationSafetyCopyDeleteConfirmationToken,
    openWorkspaceDataWithMigrations,
    stageMigrationSafetyCopyForRollback,
    workspaceDataRuntimeVersion,
    type CommandReceiptOutcome,
    type BackupCleanupOperation,
    type BackupOperation,
    type CommitOptions,
    type DataCommitResult,
    type DataOpenResult,
    type MigrationRollbackTargetV1,
    type MigrationSafetyCopyStatus,
    type OpenWorkspaceDataOptions,
    type ReadSnapshotOptions,
    type SqliteDataStore,
} from '../data/sqlite-data-store';
import {
    BOOTSTRAP_PROTOCOL_VERSION,
    isWorkspaceProbeRequest,
    type BootstrapOutcome,
    type WorkspaceDataStatus,
    type DataOpenProblem,
    type WorkspaceProbeRequest,
} from '../shared/bootstrap-contract';
import type {
    WorkspaceLifecycleProjection,
    WorkspaceOperationProjection,
    WorkspacePendingFollowUpProjection,
} from '../shared/workspace-lifecycle-contract';
import {
    isWorkspaceProcessRequest,
    type CancelMeetingOccurrenceRequest,
    type ChangeMeetingOccurrenceRequest,
    type ChangeTaskOccurrenceRequest,
    type CompleteTaskRequest,
    type CreateCourseRequest,
    type CreateHolidayRangeRequest,
    type CreateCourseWithMeetingRequest,
    type CreateMeetingSeriesRequest,
    type CreateTaskRequest,
    type CreateTermRequest,
    type DeleteHolidayRangeRequest,
    type DiscardSetupDraftCheckpointRequest,
    type DeleteTaskRequest,
    type DeleteTaskOccurrenceOrSeriesRequest,
    type MeetingOccurrenceImpactRequest,
    type MeetingSeriesQueryRequest,
    type PlanQueryRequest,
    type CancelRestoreSessionRequest,
    type ConfirmRestoreSessionRequest,
    type ResumeRestoreSessionRequest,
    type RollbackRestoreSessionRequest,
    type RestoreSessionQueryRequest,
    type StartRestoreSessionRequest,
    type SelectedBackupDestinationRequest,
    type SaveSetupDraftCheckpointRequest,
    type SetTaskOccurrenceStatusRequest,
    type SetTaskProgressRequest,
    type TaskOccurrenceImpactRequest,
    type RestoreTermAsCurrentRequest,
    type UpdateTermEndDateRequest,
    type UpdateHolidayRangeRequest,
    type UpdateTaskRequest,
    type TaskSeriesQueryRequest,
    type UndoTaskOccurrenceStateRequest,
    type WorkspaceCommandResult,
    type WorkspaceSetupOutcome,
    type WorkspaceSetupProblem,
    type WorkspaceSetupProblemCode,
    type WorkspaceProcessRequest,
} from '../shared/workspace-setup-contract';
import {
    isMigrationRollbackSessionView,
    WORKSPACE_PROTOCOL_VERSION,
    type ApplicationBuildStatus,
    type ConfirmMigrationRollbackCommand,
    type DeleteMigrationSafetyCopyCommand,
    type MigrationRollbackBindingProjection,
    type MigrationRollbackActionCommand,
    type MigrationRollbackSessionView,
    type MigrationSafetyCopyProjection,
    type WorkspaceMigrationSuccessValue,
} from '../shared/workspace-migration-contract';
import { configureBackupDestination } from './protection';
import {
    DurableBackupCoordinator,
    inspectRestoreBeforeWorkspaceOpen,
    readVerifiedDataProtectionProjection,
    type DurableBackupPassOptions,
} from '../protect/durable-backup';
import {
    RestoreCoordinator,
    RestoreSessionError,
} from '../protect/restore-session';
import {
    armMigrationRollbackHandoff,
    cancelMigrationRollbackHandoff,
    continueMigrationRollbackHandoff,
    createMigrationRollbackHandoff,
    inspectMigrationRollbackHandoffFacts,
    inspectMigrationRollbackBeforeWorkspaceOpen,
    inspectNonterminalMigrationRollback,
    MigrationRollbackHandoffError,
    prepareMigrationRollbackHandoff,
    type MigrationRollbackBootState,
    type MigrationRollbackDataIdentity,
} from '../protect/migration-rollback-handoff';
import {
    bindMigrationRollbackConfirmation,
    createMigrationRollbackPreview,
    migrationRollbackConfirmationDigest,
    type MigrationRollbackPreviewFacts,
    type PreparedMigrationRollbackPreview,
} from '../protect/migration-rollback-session';
import {
    inspectBeforeWorkspaceOpen,
    type WorkspaceStartupInspection,
} from '../protect/workspace-startup';
import {
    buildPlanProjection,
    createPlanEvaluationContext,
} from '../shared/workspace-plan-contract';
import {
    localDateInTermZone,
    normalizeReconcileWorkspaceLifecycleCommand,
    normalizeRestoreTermAsCurrentCommand,
    type RestoreTermAsCurrentCommand,
    type SetupProjection,
} from '../shared/workspace-term-contract';
import {
    workspaceLifecycleFrom,
    type WorkspaceLifecycleInput,
} from './lifecycle';

export type { ClockPort, WorkspaceApplicationOptions } from './host';























export class WorkspaceApplication {
    private backupCoordinator: DurableBackupCoordinator | undefined;
    private restoreCoordinator: RestoreCoordinator | undefined;
    private migrationMaintenance = false;
    private migrationRequestInFlight = false;
    private migrationRollbackBoot: MigrationRollbackBootState | null = null;
    private migrationRollbackBinding: MigrationRollbackBindingProjection | null = null;
    private preparedMigrationRollback: PreparedMigrationRollbackPreview | null = null;
    private restoreMaintenance = false;
    private latestRestoreSession: ReturnType<RestoreCoordinator['query']> | null = null;
    private workspaceEpoch: string = randomUUID();
    private readonly host: WorkspaceHost;

    private constructor(
        private readonly dataSlotsRoot: string,
        private readonly appBuildId: string,
        private dataState: WorkspaceDataState,
        private readonly startupInspection: WorkspaceStartupInspection | null,
        private readonly options: WorkspaceApplicationOptions,
    ) {
        this.latestRestoreSession = startupInspection?.restore.session ?? null;
        this.host = Object.freeze({
            appBuildId,
            dataSlotsRoot,
            options,
            startupInspection,
            dataState: () => this.dataState,
            setDataState: (next: WorkspaceDataState) => { this.dataState = next; },
            backupCoordinator: () => this.backupCoordinator,
            setBackupCoordinator: (next: DurableBackupCoordinator | undefined) => { this.backupCoordinator = next; },
            restoreCoordinator: () => this.restoreCoordinator,
            setRestoreCoordinator: (next: RestoreCoordinator | undefined) => { this.restoreCoordinator = next; },
            latestRestoreSession: () => this.latestRestoreSession,
            setLatestRestoreSession: (next: ReturnType<RestoreCoordinator['query']> | null) => { this.latestRestoreSession = next; },
            restoreMaintenance: () => this.restoreMaintenance,
            setRestoreMaintenance: (next: boolean) => { this.restoreMaintenance = next; },
            migrationMaintenance: () => this.migrationMaintenance,
            setMigrationMaintenance: (next: boolean) => { this.migrationMaintenance = next; },
            migrationRequestInFlight: () => this.migrationRequestInFlight,
            setMigrationRequestInFlight: (next: boolean) => { this.migrationRequestInFlight = next; },
            migrationRollbackBoot: () => this.migrationRollbackBoot,
            setMigrationRollbackBoot: (next: MigrationRollbackBootState | null) => { this.migrationRollbackBoot = next; },
            migrationRollbackBinding: () => this.migrationRollbackBinding,
            setMigrationRollbackBinding: (next: MigrationRollbackBindingProjection | null) => { this.migrationRollbackBinding = next; },
            preparedMigrationRollback: () => this.preparedMigrationRollback,
            setPreparedMigrationRollback: (next: PreparedMigrationRollbackPreview | null) => { this.preparedMigrationRollback = next; },
            workspaceEpoch: () => this.workspaceEpoch,
            setWorkspaceEpoch: (next: string) => { this.workspaceEpoch = next; },
        });
    }

    public static async open(
        dataSlotsRoot: string,
        appBuildId: string,
        options: WorkspaceApplicationOptions = {},
    ): Promise<WorkspaceApplication> {
        let startupInspection: WorkspaceStartupInspection | null = null;
        let restoreBoot: ReturnType<typeof inspectRestoreBeforeWorkspaceOpen> | null = null;
        let migrationRollbackBoot: MigrationRollbackBootState | null = null;
        if (options.activityControlRoot) {
            startupInspection = inspectBeforeWorkspaceOpen(
                options.activityControlRoot,
                dataSlotsRoot,
                appBuildId,
            );
            restoreBoot = startupInspection.restore;
            migrationRollbackBoot = startupInspection.migrationRollback;
            const migrationBlocksOrdinaryOpen = migrationRollbackBoot.kind === 'maintenance'
                || migrationRollbackBoot.kind === 'recovery-required';
            const migrationOrAmbiguousRecovery = startupInspection.kind === 'recovery-required'
                && (startupInspection.reason === 'ambiguous-operations'
                    || migrationRollbackBoot.kind === 'recovery-required');
            if (migrationOrAmbiguousRecovery
                || (startupInspection.kind === 'maintenance'
                    && startupInspection.reason === 'migration-rollback')) {
                const application = new WorkspaceApplication(
                    dataSlotsRoot,
                    appBuildId,
                    {
                        sqliteVersion: workspaceDataRuntimeVersion(),
                        status: {
                            kind: 'recovery',
                            problem: migrationOrAmbiguousRecovery
                                ? migrationRollbackEvidenceProblem()
                                : migrationRollbackProblem(migrationRollbackBoot),
                        },
                    },
                    startupInspection,
                    options,
                );
                application.migrationMaintenance = migrationBlocksOrdinaryOpen;
                application.restoreMaintenance = restoreBoot.kind === 'recovery-required'
                    || (restoreBoot.kind === 'pre-checkpoint-session'
                        && restoreBoot.session?.phase === 'protection-established');
                application.migrationRollbackBoot = migrationRollbackBoot;
                tryRestoreMigrationRollbackBinding(application.host, migrationRollbackBoot);
                return application;
            }
            if (restoreBoot.kind === 'recovery-required') {
                const application = new WorkspaceApplication(
                    dataSlotsRoot,
                    appBuildId,
                    {
                        sqliteVersion: workspaceDataRuntimeVersion(),
                        status: {
                            kind: 'recovery',
                            problem: restoreActivationProblem(restoreBoot.session),
                        },
                    },
                    startupInspection,
                    options,
                );
                application.restoreMaintenance = true;
                if (restoreBoot.session) {
                    application.restoreCoordinator = RestoreCoordinator.recover(
                        options.activityControlRoot,
                        dataSlotsRoot,
                        {
                            clock: options.clock,
                            failpoint: options.restoreFailpoint,
                        },
                    );
                }
                return application;
            }
        }
        const opened = await openWorkspaceDataWithMigrations(
            dataSlotsRoot,
            migrationOpenOptions(appBuildId, options),
        );
        const application = new WorkspaceApplication(
            dataSlotsRoot,
            appBuildId,
            dataStateFrom(opened),
            startupInspection,
            options,
        );
        application.migrationRollbackBoot = migrationRollbackBoot;
        if ((restoreBoot?.kind === 'committed' || restoreBoot?.kind === 'pre-checkpoint-session')
            && restoreBoot.session
            && application.dataState.store
            && options.activityControlRoot) {
            application.restoreCoordinator = new RestoreCoordinator(
                application.dataState.store,
                options.activityControlRoot,
                {
                    dataSlotsRoot,
                    clock: options.clock,
                    failpoint: options.restoreFailpoint,
                },
                restoreBoot,
            );
        }
        application.restoreMaintenance = startupInspection?.kind === 'maintenance'
            && startupInspection.reason === 'restore';
        return application;
    }

    public handle(request: WorkspaceProbeRequest): Promise<BootstrapOutcome>;
    public handle(request: WorkspaceProcessRequest): Promise<WorkspaceSetupOutcome>;
    public handle(request: unknown): Promise<BootstrapOutcome | WorkspaceSetupOutcome>;
    public async handle(request: unknown): Promise<BootstrapOutcome | WorkspaceSetupOutcome> {
        if (isWorkspaceProbeRequest(request, this.appBuildId)) {
            return bootstrap(this.host, request);
        }

        if (!isWorkspaceProcessRequest(request, this.appBuildId, this.workspaceEpoch)) {
            const value = request as { appBuildId?: unknown; workspaceEpoch?: unknown } | null;
            const requestKind = requestKindFrom(request);
            const code = value?.appBuildId !== undefined && value.appBuildId !== this.appBuildId
                ? 'build-mismatch'
                : value?.workspaceEpoch !== undefined && value.workspaceEpoch !== this.workspaceEpoch
                    ? 'stale-workspace'
                    : (requestKind === 'workspace.term.create'
                        || requestKind === 'workspace.term.update-end-date'
                        || requestKind === 'workspace.term.restore-as-current'
                        || requestKind === 'workspace.holiday-range.create'
                        || requestKind === 'workspace.holiday-range.update'
                        || requestKind === 'workspace.holiday-range.delete'
                        || requestKind === 'workspace.task.create'
                        || requestKind === 'workspace.task.update'
                        || requestKind === 'workspace.task.delete'
                        || requestKind === 'workspace.task.complete'
                        || requestKind === 'workspace.task.set-occurrence-status'
                        || requestKind === 'workspace.task.set-progress'
                        || requestKind === 'workspace.task.change-occurrence'
                        || requestKind === 'workspace.task.delete-occurrence-or-series'
                        || requestKind === 'workspace.task.undo-occurrence-state'
                        || requestKind === 'workspace.plan.query'
                        || requestKind === 'workspace.protection.query'
                        || requestKind === 'workspace.protection.configure'
                        || requestKind === 'workspace.protection.configure-selected'
                        || requestKind === 'workspace.restore.start'
                        || requestKind === 'workspace.restore.query'
                        || requestKind === 'workspace.restore.confirm'
                        || requestKind === 'workspace.restore.cancel'
                        || requestKind === 'workspace.restore.resume'
                        || requestKind === 'workspace.restore.rollback'
                        || requestKind === 'workspace.setup-draft.save'
                        || requestKind === 'workspace.setup-draft.discard'
                        || requestKind === 'workspace.task-series.query'
                         || requestKind === 'workspace.task-occurrence.preview'
                         || requestKind === 'workspace.course.create'
                         || requestKind === 'workspace.meeting-series.create'
                         || requestKind === 'workspace.course.create-with-first-meeting'
                        || requestKind === 'workspace.meeting-series.query'
                        || requestKind === 'workspace.meeting-occurrence.preview'
                        || requestKind === 'workspace.meeting-occurrence.change'
                        || requestKind === 'workspace.meeting-occurrence.cancel'
                        || requestKind === 'workspace.application-build.query'
                        || requestKind === 'workspace.migration-safety.query'
                        || requestKind === 'workspace.migration-safety.delete'
                        || requestKind === 'workspace.migration-rollback.preview'
                        || requestKind === 'workspace.migration-rollback.query'
                        || requestKind === 'workspace.migration-rollback.confirm'
                        || requestKind === 'workspace.migration-rollback.cancel'
                        || requestKind === 'workspace.migration-rollback.continue')
                        ? 'validation'
                        : 'invalid-request';
            return problem(this.host, code, 'Workspace 请求无效。', requestIdFrom(request));
        }

        const migrationQuery = request.kind === 'workspace.application-build.query'
            || request.kind === 'workspace.migration-safety.query'
            || request.kind === 'workspace.migration-rollback.query';
        if (this.migrationRequestInFlight && !migrationQuery) {
            return problem(this.host,
                'operation-in-progress',
                '另一个迁移维护操作正在完成。',
                request.requestId,
            );
        }

        const migrationMaintenanceRequest = migrationQuery
            || request.kind === 'workspace.migration-rollback.confirm'
            || request.kind === 'workspace.migration-rollback.cancel'
            || request.kind === 'workspace.migration-rollback.continue';
        if (this.migrationMaintenance && !migrationMaintenanceRequest) {
            return problem(this.host,
                'operation-in-progress',
                '迁移回退维护期间不能执行工作区请求。',
                request.requestId,
            );
        }

        if (this.restoreMaintenance
            && request.kind !== 'workspace.application-build.query'
            && request.kind !== 'workspace.restore.query'
            && request.kind !== 'workspace.restore.cancel'
            && request.kind !== 'workspace.restore.resume'
            && request.kind !== 'workspace.restore.rollback') {
            return problem(this.host,
                'operation-in-progress',
                '恢复维护期间不能执行普通工作区请求。',
                request.requestId,
            );
        }

        switch (request.kind) {
            case 'workspace.application-build.query':
                return queryApplicationBuildStatus(this.host, request.requestId);
            case 'workspace.migration-safety.query':
                return queryMigrationSafetyCopy(this.host, request.requestId);
            case 'workspace.migration-safety.delete':
                return deleteMigrationSafetyCopy(this.host, request.requestId, request.command);
            case 'workspace.migration-rollback.preview':
                return previewMigrationRollback(this.host, request.requestId);
            case 'workspace.migration-rollback.query':
                return queryMigrationRollback(this.host,
                    request.requestId,
                    request.migrationRollbackSessionId,
                );
            case 'workspace.migration-rollback.confirm':
                return confirmMigrationRollback(this.host, request.requestId, request.command);
            case 'workspace.migration-rollback.cancel':
                return cancelMigrationRollback(this.host, request.requestId, request.command);
            case 'workspace.migration-rollback.continue':
                return continueMigrationRollback(this.host, request.requestId, request.command);
            case 'workspace.initialize':
                return initialize(this.host, request.requestId);
            case 'workspace.setup.query':
                return querySetup(this.host, request.requestId);
            case 'workspace.setup-draft.save':
                return saveSetupDraftCheckpoint(this.host, request.requestId, request.input);
            case 'workspace.setup-draft.discard':
                return discardSetupDraftCheckpoint(this.host, request.requestId, request.expectedVersion);
            case 'workspace.plan.query':
                return queryPlan(this.host, request.requestId);
            case 'workspace.protection.query':
                return queryDataProtection(this.host, request.requestId);
            case 'workspace.protection.configure-selected':
                return configureBackupDestination(this.host,
                    request.requestId,
                    request.command,
                    request.selectedDirectoryPath,
                );
            case 'workspace.restore.start':
                return startRestoreSession(this.host, request.requestId, request.command);
            case 'workspace.restore.query':
                return queryRestoreSession(this.host, request.requestId, request.restoreSessionId);
            case 'workspace.restore.confirm':
                return confirmRestoreSession(this.host, request.requestId, request.command);
            case 'workspace.restore.cancel':
                return cancelRestoreSession(this.host, request.requestId, request.command);
            case 'workspace.restore.resume':
                return resumeRestoreSession(this.host, request.requestId, request.command);
            case 'workspace.restore.rollback':
                return rollbackRestoreSession(this.host, request.requestId, request.command);
            case 'workspace.term.create':
                return createTerm(this.host, request.requestId, request.command);
            case 'workspace.term.update-end-date':
                return updateTermEndDate(this.host, request.requestId, request.command);
            case 'workspace.term.restore-as-current':
                return restoreTermAsCurrent(this.host, request.requestId, request.command);
            case 'workspace.holiday-range.create':
                return commitHolidayRange(this.host, request.requestId, request.command);
            case 'workspace.holiday-range.update':
                return commitHolidayRange(this.host, request.requestId, request.command);
            case 'workspace.holiday-range.delete':
                return commitHolidayRange(this.host, request.requestId, request.command);
            case 'workspace.task.create':
                return commitTask(this.host, request.requestId, request.command);
            case 'workspace.task.update':
                return commitTask(this.host, request.requestId, request.command);
            case 'workspace.task.delete':
                return commitTask(this.host, request.requestId, request.command);
            case 'workspace.task.complete':
                return commitTask(this.host, request.requestId, request.command);
            case 'workspace.task.set-occurrence-status':
                return commitTask(this.host, request.requestId, request.command);
            case 'workspace.task.set-progress':
                return commitTask(this.host, request.requestId, request.command);
            case 'workspace.task.change-occurrence':
                return commitTask(this.host, request.requestId, request.command);
            case 'workspace.task.delete-occurrence-or-series':
                return commitTask(this.host, request.requestId, request.command);
            case 'workspace.task.undo-occurrence-state':
                return commitTask(this.host, request.requestId, request.command);
            case 'workspace.course.create':
                return createCourse(this.host, request.requestId, request.command);
            case 'workspace.meeting-series.create':
                return createMeetingSeries(this.host, request.requestId, request.command);
            case 'workspace.course.create-with-first-meeting':
                return createCourseWithMeeting(this.host, request.requestId, request.command);
            case 'workspace.meeting-series.query':
                return queryMeetingSeries(this.host,
                    request.requestId,
                    request.meetingSeriesId,
                    request.requestedWindow,
                );
            case 'workspace.task-series.query':
                return queryTaskSeries(this.host,
                    request.requestId,
                    request.taskSeriesId,
                    request.requestedWindow,
                );
            case 'workspace.task-occurrence.preview':
                return previewTaskOccurrence(this.host, request.requestId, request.draft);
            case 'workspace.meeting-occurrence.preview':
                return previewMeetingOccurrence(this.host, request.requestId, request.draft);
            case 'workspace.meeting-occurrence.change':
                return commitMeetingOccurrence(this.host, request.requestId, request.command);
            case 'workspace.meeting-occurrence.cancel':
                return commitMeetingOccurrence(this.host, request.requestId, request.command);
        }
    }

    public async close(): Promise<void> {
        try {
            this.dataState.store?.setPostCommitHint(null);
        }
        catch {
            // A terminal DATA connection already detached its in-process hint.
        }
        await this.backupCoordinator?.close();
        await this.dataState.store?.close();
    }

    /**
     * Waits for the current best-effort backup pass without exposing snapshot state to UI.
     * @return {Promise<void>} Current background pass completion.
     */
    public async waitForDurableBackups(): Promise<void> {
        await this.backupCoordinator?.waitForIdle();
    }





































































}
