/**
 * @file Coordinates Workspace queries and formal DATA intents for the desktop shell.
 */

import { randomUUID } from 'node:crypto';

import {
    CommittedCommandOutcomeUnknownError,
    SetupDraftCheckpointOutcomeUnknownError,
    consumeMigrationSafetyCopyAfterRollback,
    deleteMigrationSafetyCopy,
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
import {CURRENT_SCHEMA_LEVEL} from '../data/schema';
import {observeRestoreDataSlot} from '../platform/restore-activation-files';
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
import {
    configureBackupDestination,
} from '../protect/backup-configuration';
import { BackupDestinationPreparationError } from '../protect/backup-repository';
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

export interface ClockPort {
    now(): string;
}

const SYSTEM_CLOCK: ClockPort = {
    now(): string {
        return new Date().toISOString();
    },
};

export type WorkspaceApplicationOptions = Omit<OpenWorkspaceDataOptions, 'migrationSafetyCopy'> & Readonly<{
    commitOptions?: CommitOptions;
    clock?: ClockPort;
    durableBackupOptions?: DurableBackupPassOptions;
    activityControlRoot?: string;
    restoreFailpoint?: (point: string) => void;
    libraryRootPath?: string | null;
    migrationRollbackTarget?: MigrationRollbackTargetV1;
    applicationRelease?: Readonly<{
        releaseVersion: string;
        tag: string;
    }>;
    setupProjectionReadOptions?: ReadSnapshotOptions;
    moduleStatus?: WorkspaceLifecycleInput['moduleStatus'];
}>;

type WorkspaceDataState = Readonly<{
    sqliteVersion: string;
    status: WorkspaceDataStatus;
    store?: SqliteDataStore;
}>;

type DataCommitProblem = Extract<DataCommitResult, { ok: false }>['problem'];

function requestIdFrom(value: unknown): string | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return null;
    }
    const requestId = (value as { requestId?: unknown }).requestId;
    return typeof requestId === 'string' ? requestId : null;
}

function requestKindFrom(value: unknown): unknown {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return undefined;
    }
    return (value as { kind?: unknown }).kind;
}

function dataStateFrom(opened: DataOpenResult): WorkspaceDataState {
    if (opened.kind === 'absent') {
        return { sqliteVersion: opened.sqliteVersion, status: { kind: 'absent' } };
    }
    if (opened.kind === 'recovery') {
        return {
            sqliteVersion: opened.sqliteVersion,
            status: { kind: 'recovery', problem: opened.problem },
        };
    }
    return {
        sqliteVersion: opened.sqliteVersion,
        status: opened.store.status(),
        store: opened.store,
    };
}

function migrationOpenOptions(
    appBuildId: string,
    options: WorkspaceApplicationOptions,
): OpenWorkspaceDataOptions {
    return Object.freeze({
        readOnly: options.readOnly,
        migrationFailpoint: options.migrationFailpoint,
        migrationSafetyCopy: options.migrationRollbackTarget
            ? Object.freeze({
                createdByAppBuildId: appBuildId,
                rollbackTarget: options.migrationRollbackTarget,
                clock: options.clock,
            })
            : undefined,
    });
}

function restoreActivationProblem(
    session: ReturnType<RestoreCoordinator['query']> | null,
): DataOpenProblem {
    if (!session) {
        return Object.freeze({
            code: 'recovery-required' as const,
            scope: 'workspace' as const,
            dataEffect: 'unchanged' as const,
            affectedCapabilities: Object.freeze(['workspace.read', 'workspace.write'] as const),
            allowedActions: Object.freeze([] as const),
            context: Object.freeze({}),
            details: Object.freeze({reason: 'database-unreadable' as const}),
        });
    }
    const allowedActions = Object.freeze(session.allowedActions.filter(
        (action): action is 'resume' | 'rollback' => action === 'resume' || action === 'rollback',
    ));
    return Object.freeze({
        code: 'recovery-required' as const,
        scope: 'workspace' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: Object.freeze(['workspace.read', 'workspace.write'] as const),
        allowedActions,
        context: Object.freeze({
            restoreSessionId: session.restoreSessionId,
            operationId: session.operationId,
        }),
        details: Object.freeze({reason: 'restore-activation-pending' as const}),
    });
}

function migrationRollbackEvidenceProblem(): DataOpenProblem {
    return Object.freeze({
        code: 'recovery-required' as const,
        scope: 'workspace' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: Object.freeze(['workspace.read', 'workspace.write'] as const),
        allowedActions: Object.freeze([] as const),
        context: Object.freeze({}),
        details: Object.freeze({reason: 'migration-rollback-evidence' as const}),
    });
}

type MigrationRollbackNonterminalPhase =
    | 'planned'
    | 'prepared'
    | 'armed'
    | 'awaiting-target-build'
    | 'completing'
    | 'cancelling';

function isMigrationRollbackNonterminalPhase(
    value: MigrationRollbackBootState['phase'],
): value is MigrationRollbackNonterminalPhase {
    return value === 'planned'
        || value === 'prepared'
        || value === 'armed'
        || value === 'awaiting-target-build'
        || value === 'completing'
        || value === 'cancelling';
}

function migrationRollbackProblem(boot: MigrationRollbackBootState): DataOpenProblem {
    if (boot.kind !== 'maintenance'
        || !boot.migrationRollbackSessionId
        || !boot.operationId
        || !boot.requiredBuilds
        || !boot.currentBuild
        || !isMigrationRollbackNonterminalPhase(boot.phase)) {
        return migrationRollbackEvidenceProblem();
    }
    const context = Object.freeze({
        migrationRollbackSessionId: boot.migrationRollbackSessionId,
        operationId: boot.operationId,
    });
    const details = Object.freeze({
        reason: 'migration-rollback-pending' as const,
        phase: boot.phase,
        currentBuild: boot.currentBuild,
        requiredBuilds: Object.freeze({...boot.requiredBuilds}),
    });
    if (boot.currentBuild === 'other') {
        return Object.freeze({
            code: 'rollback-build-mismatch' as const,
            scope: 'workspace' as const,
            dataEffect: 'unchanged' as const,
            affectedCapabilities: Object.freeze(['workspace.read', 'workspace.write'] as const),
            allowedActions: Object.freeze([] as const),
            context,
            details: Object.freeze({...details, currentBuild: 'other' as const}),
        });
    }
    const allowedActions = boot.currentBuild === 'source'
        ? boot.allowedActions.includes('cancel-as-source')
            ? Object.freeze(['cancel-as-source'] as const)
            : Object.freeze([] as const)
        : boot.allowedActions.includes('continue-as-target')
            ? Object.freeze(['continue-as-target'] as const)
            : Object.freeze([] as const);
    return Object.freeze({
        code: 'rollback-required' as const,
        scope: 'workspace' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: Object.freeze(['workspace.read', 'workspace.write'] as const),
        allowedActions,
        context,
        details: Object.freeze({...details, currentBuild: boot.currentBuild}),
    });
}

/**
 * Projects one physical rollback target without exposing paths.
 * @param {MigrationRollbackTargetV1} target Exact persisted target.
 * @return {MigrationRollbackBindingProjection['targetBuild']} Path-free target projection.
 */
function migrationRollbackTargetProjection(
    target: MigrationRollbackTargetV1,
): MigrationRollbackBindingProjection['targetBuild'] {
    return Object.freeze({
        releaseVersion: target.releaseVersion,
        tag: target.tag,
        appBuildId: target.appBuildId,
        artifacts: Object.freeze(target.artifacts.map(artifact => Object.freeze({
            platform: artifact.platform,
            name: artifact.name,
            sha256: artifact.sha256,
        }))) as MigrationRollbackBindingProjection['targetBuild']['artifacts'],
    });
}

/**
 * Projects DATA-owned safety status into the Workspace contract.
 * @param {MigrationSafetyCopyStatus} status Fresh DATA status.
 * @return {MigrationSafetyCopyProjection} Path-free safety projection.
 */
function migrationSafetyCopyProjection(
    status: MigrationSafetyCopyStatus,
): MigrationSafetyCopyProjection {
    if (status.kind !== 'verified') {
        return Object.freeze({kind: status.kind});
    }
    return Object.freeze({
        kind: 'verified' as const,
        integrity: 'verified' as const,
        migrationSafetyCopyId: status.metadata.migrationSafetyCopyId,
        copyVersion: status.metadata.metadataDigest,
        deleteConfirmationToken: migrationSafetyCopyDeleteConfirmationToken(
            status.metadata.migrationSafetyCopyId,
            status.metadata.metadataDigest,
        ),
        workspaceId: status.metadata.workspaceId,
        sourceRevision: status.metadata.sourceRevision,
        sourceSchemaLevel: status.metadata.sourceSchemaLevel,
        createdAt: status.metadata.createdAt,
        byteSize: status.metadata.byteSize,
        target: migrationRollbackTargetProjection(status.metadata.rollbackTarget),
    });
}

/**
 * Returns the fail-closed view used when physical evidence cannot prove an action.
 * @return {MigrationRollbackSessionView} Recovery view with no allowed action.
 */
function migrationRollbackRecoveryView(): MigrationRollbackSessionView {
    return Object.freeze({
        migrationRollbackSessionId: null,
        operationId: null,
        sessionVersion: null,
        phase: 'recovery-required' as const,
        currentBuild: 'recovery-required' as const,
        binding: null,
        previewToken: null,
        retryCommand: null,
        allowedActions: Object.freeze([] as const),
        outcome: null,
        problem: Object.freeze({code: 'recovery-required' as const}),
    });
}

/**
 * Projects the running source release into one rollback binding.
 * @param {string} appBuildId Exact source application build.
 * @param {WorkspaceApplicationOptions} options Workspace release options.
 * @return {MigrationRollbackBindingProjection['sourceBuild']} Path-free source build.
 */
function sourceBuildProjection(
    appBuildId: string,
    options: WorkspaceApplicationOptions,
): MigrationRollbackBindingProjection['sourceBuild'] {
    return Object.freeze({
        releaseVersion: options.applicationRelease?.releaseVersion ?? '0.0.0-development',
        tag: options.applicationRelease?.tag ?? appBuildId,
        appBuildId,
    });
}

/**
 * Maps the latest durable backup row to its path-free lifecycle handle.
 * @param {BackupOperation | null} operation Latest durable backup row.
 * @param {boolean} activelyRunning Whether this process is currently advancing it.
 * @return {WorkspaceOperationProjection | null} Lifecycle handle when one exists.
 */
function backupOperationProjection(
    operation: BackupOperation | null,
    activelyRunning: boolean,
): WorkspaceOperationProjection | null {
    if (!operation) {
        return null;
    }
    return Object.freeze({
        operationId: operation.operationId,
        owner: 'protect' as const,
        kind: 'backup' as const,
        state: operation.phase === 'succeeded'
            ? 'succeeded' as const
            : activelyRunning ? 'running' as const : 'recovery-required' as const,
        version: operation.version,
    });
}

/**
 * Maps active retention cleanup to its path-free lifecycle handle.
 * @param {BackupCleanupOperation | null} operation Active cleanup row.
 * @return {WorkspaceOperationProjection | null} Lifecycle handle when cleanup is pending.
 */
function backupCleanupOperationProjection(
    operation: BackupCleanupOperation | null,
): WorkspaceOperationProjection | null {
    if (!operation) {
        return null;
    }
    return Object.freeze({
        operationId: operation.operationId,
        owner: 'protect' as const,
        kind: 'backup-cleanup' as const,
        state: 'running' as const,
        version: operation.version,
    });
}

/**
 * Maps the latest Restore session to the shared operation vocabulary.
 * @param {ReturnType<RestoreCoordinator['query']> | null} session Latest Restore session.
 * @return {WorkspaceOperationProjection | null} Path-free Restore handle.
 */
function restoreOperationProjection(
    session: ReturnType<RestoreCoordinator['query']> | null,
): WorkspaceOperationProjection | null {
    if (!session) {
        return null;
    }
    const state = session.phase === 'previewed' || session.phase === 'waiting-decision'
        ? 'waiting-decision' as const
        : session.phase === 'protection-established'
            ? 'accepted' as const
            : session.phase === 'recovery-required'
                ? 'recovery-required' as const
                : session.phase === 'cancelled' || session.phase === 'rolled-back'
                    ? 'cancelled' as const
                    : 'succeeded' as const;
    return Object.freeze({
        operationId: session.operationId,
        owner: 'protect' as const,
        kind: 'restore' as const,
        state,
        version: session.sessionVersion,
    });
}

/**
 * Maps rollback boot evidence to the shared operation vocabulary.
 * @param {MigrationRollbackBootState | null} boot Latest rollback classification.
 * @return {WorkspaceOperationProjection | null} Path-free rollback handle.
 */
function migrationRollbackOperationProjection(
    boot: MigrationRollbackBootState | null,
): WorkspaceOperationProjection | null {
    if (!boot?.operationId || !boot.sessionVersion) {
        return null;
    }
    const state = boot.kind === 'recovery-required'
        ? 'recovery-required' as const
        : boot.kind === 'succeeded'
            ? 'succeeded' as const
            : boot.kind === 'cancelled'
                ? 'cancelled' as const
                : boot.allowedActions.length > 0 || boot.phase === 'awaiting-target-build'
                    ? 'waiting-decision' as const
                    : 'running' as const;
    return Object.freeze({
        operationId: boot.operationId,
        owner: 'protect' as const,
        kind: 'migration-rollback' as const,
        state,
        version: boot.sessionVersion,
    });
}

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
    private workspaceEpoch = randomUUID();

    private constructor(
        private readonly dataSlotsRoot: string,
        private readonly appBuildId: string,
        private dataState: WorkspaceDataState,
        private readonly startupInspection: WorkspaceStartupInspection | null,
        private readonly options: WorkspaceApplicationOptions,
    ) {
        this.latestRestoreSession = startupInspection?.restore.session ?? null;
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
                application.tryRestoreMigrationRollbackBinding(migrationRollbackBoot);
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
            return this.bootstrap(request);
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
            return this.problem(code, 'Workspace 请求无效。', requestIdFrom(request));
        }

        const migrationQuery = request.kind === 'workspace.application-build.query'
            || request.kind === 'workspace.migration-safety.query'
            || request.kind === 'workspace.migration-rollback.query';
        if (this.migrationRequestInFlight && !migrationQuery) {
            return this.problem(
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
            return this.problem(
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
            return this.problem(
                'operation-in-progress',
                '恢复维护期间不能执行普通工作区请求。',
                request.requestId,
            );
        }

        switch (request.kind) {
            case 'workspace.application-build.query':
                return this.queryApplicationBuildStatus(request.requestId);
            case 'workspace.migration-safety.query':
                return this.queryMigrationSafetyCopy(request.requestId);
            case 'workspace.migration-safety.delete':
                return this.deleteMigrationSafetyCopy(request.requestId, request.command);
            case 'workspace.migration-rollback.preview':
                return this.previewMigrationRollback(request.requestId);
            case 'workspace.migration-rollback.query':
                return this.queryMigrationRollback(
                    request.requestId,
                    request.migrationRollbackSessionId,
                );
            case 'workspace.migration-rollback.confirm':
                return this.confirmMigrationRollback(request.requestId, request.command);
            case 'workspace.migration-rollback.cancel':
                return this.cancelMigrationRollback(request.requestId, request.command);
            case 'workspace.migration-rollback.continue':
                return this.continueMigrationRollback(request.requestId, request.command);
            case 'workspace.initialize':
                return this.initialize(request.requestId);
            case 'workspace.setup.query':
                return this.querySetup(request.requestId);
            case 'workspace.setup-draft.save':
                return this.saveSetupDraftCheckpoint(request.requestId, request.input);
            case 'workspace.setup-draft.discard':
                return this.discardSetupDraftCheckpoint(request.requestId, request.expectedVersion);
            case 'workspace.plan.query':
                return this.queryPlan(request.requestId);
            case 'workspace.protection.query':
                return this.queryDataProtection(request.requestId);
            case 'workspace.protection.configure-selected':
                return this.configureBackupDestination(
                    request.requestId,
                    request.command,
                    request.selectedDirectoryPath,
                );
            case 'workspace.restore.start':
                return this.startRestoreSession(request.requestId, request.command);
            case 'workspace.restore.query':
                return this.queryRestoreSession(request.requestId, request.restoreSessionId);
            case 'workspace.restore.confirm':
                return this.confirmRestoreSession(request.requestId, request.command);
            case 'workspace.restore.cancel':
                return this.cancelRestoreSession(request.requestId, request.command);
            case 'workspace.restore.resume':
                return this.resumeRestoreSession(request.requestId, request.command);
            case 'workspace.restore.rollback':
                return this.rollbackRestoreSession(request.requestId, request.command);
            case 'workspace.term.create':
                return this.createTerm(request.requestId, request.command);
            case 'workspace.term.update-end-date':
                return this.updateTermEndDate(request.requestId, request.command);
            case 'workspace.term.restore-as-current':
                return this.restoreTermAsCurrent(request.requestId, request.command);
            case 'workspace.holiday-range.create':
                return this.commitHolidayRange(request.requestId, request.command);
            case 'workspace.holiday-range.update':
                return this.commitHolidayRange(request.requestId, request.command);
            case 'workspace.holiday-range.delete':
                return this.commitHolidayRange(request.requestId, request.command);
            case 'workspace.task.create':
                return this.commitTask(request.requestId, request.command);
            case 'workspace.task.update':
                return this.commitTask(request.requestId, request.command);
            case 'workspace.task.delete':
                return this.commitTask(request.requestId, request.command);
            case 'workspace.task.complete':
                return this.commitTask(request.requestId, request.command);
            case 'workspace.task.set-occurrence-status':
                return this.commitTask(request.requestId, request.command);
            case 'workspace.task.set-progress':
                return this.commitTask(request.requestId, request.command);
            case 'workspace.task.change-occurrence':
                return this.commitTask(request.requestId, request.command);
            case 'workspace.task.delete-occurrence-or-series':
                return this.commitTask(request.requestId, request.command);
            case 'workspace.task.undo-occurrence-state':
                return this.commitTask(request.requestId, request.command);
            case 'workspace.course.create':
                return this.createCourse(request.requestId, request.command);
            case 'workspace.meeting-series.create':
                return this.createMeetingSeries(request.requestId, request.command);
            case 'workspace.course.create-with-first-meeting':
                return this.createCourseWithMeeting(request.requestId, request.command);
            case 'workspace.meeting-series.query':
                return this.queryMeetingSeries(
                    request.requestId,
                    request.meetingSeriesId,
                    request.requestedWindow,
                );
            case 'workspace.task-series.query':
                return this.queryTaskSeries(
                    request.requestId,
                    request.taskSeriesId,
                    request.requestedWindow,
                );
            case 'workspace.task-occurrence.preview':
                return this.previewTaskOccurrence(request.requestId, request.draft);
            case 'workspace.meeting-occurrence.preview':
                return this.previewMeetingOccurrence(request.requestId, request.draft);
            case 'workspace.meeting-occurrence.change':
                return this.commitMeetingOccurrence(request.requestId, request.command);
            case 'workspace.meeting-occurrence.cancel':
                return this.commitMeetingOccurrence(request.requestId, request.command);
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

    /**
     * Returns the exact local development build descriptor and rollback classification.
     * @param {string} requestId Request correlation identity.
     * @return {WorkspaceSetupOutcome} Path-free ApplicationBuildStatus outcome.
     */
    private queryApplicationBuildStatus(requestId: string): WorkspaceSetupOutcome {
        try {
            const match = /^development:([0-9a-f]{40})$/.exec(this.appBuildId);
            if (!match
                || (process.platform !== 'darwin' && process.platform !== 'win32')
                || (process.arch !== 'arm64' && process.arch !== 'x64')
                || (process.platform === 'darwin') !== (process.arch === 'arm64')) {
                throw new Error('Application build identity is unsupported');
            }
            const boot = this.currentMigrationRollbackBoot();
            let rollback: ApplicationBuildStatus['rollback'] = Object.freeze({kind: 'clear'});
            if (boot.kind === 'recovery-required') {
                rollback = Object.freeze({kind: 'recovery-required'});
            }
            else if (boot.kind === 'maintenance'
                && boot.currentBuild
                && boot.requiredBuilds) {
                rollback = Object.freeze({
                    kind: 'classified' as const,
                    currentBuild: boot.currentBuild,
                    sourceAppBuildId: boot.requiredBuilds.sourceAppBuildId,
                    targetAppBuildId: boot.requiredBuilds.targetAppBuildId,
                });
            }
            const status: ApplicationBuildStatus = Object.freeze({
                descriptor: Object.freeze({
                    descriptorVersion: '1' as const,
                    applicationId: 'io.github.siruimei07.courseflow.dev' as const,
                    releaseVersion: this.options.applicationRelease?.releaseVersion
                        ?? '0.0.0-development',
                    tag: this.options.applicationRelease?.tag ?? this.appBuildId,
                    appBuildId: this.appBuildId,
                    fullCommit: match[1]!,
                    platform: process.platform,
                    architecture: process.arch,
                    variant: 'development' as const,
                    workspaceProtocolVersion: WORKSPACE_PROTOCOL_VERSION,
                    currentSchemaLevel: CURRENT_SCHEMA_LEVEL.toString(),
                    formats: Object.freeze({
                        snapshot: '1' as const,
                        backupRepository: '1' as const,
                        restoreActivation: '1' as const,
                        migrationSafetyCopy: '1' as const,
                        migrationRollbackHandoff: '1' as const,
                    }),
                    runtimes: Object.freeze({
                        electron: process.versions.electron ?? 'not-running-in-electron',
                        chromium: process.versions.chrome ?? 'not-running-in-electron',
                        node: process.versions.node,
                        sqlite: workspaceDataRuntimeVersion(),
                    }),
                    rollbackTargets: this.options.migrationRollbackTarget
                        ? Object.freeze([
                            migrationRollbackTargetProjection(
                                this.options.migrationRollbackTarget,
                            ),
                        ])
                        : Object.freeze([]),
                }),
                processMatch: Object.freeze({
                    main: 'exact' as const,
                    renderer: 'exact' as const,
                    workspace: 'exact' as const,
                    allExact: true as const,
                }),
                rollback,
            });
            return this.migrationValue({
                kind: 'workspace.application-build-status',
                protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                appBuildId: this.appBuildId,
                requestId,
                workspaceEpoch: this.workspaceEpoch,
                status,
            });
        }
        catch {
            return this.problem(
                'recovery-required',
                '无法确认当前应用构建身份。',
                requestId,
            );
        }
    }

    /**
     * Returns the only registered migration safety copy without exposing a path.
     * @param {string} requestId Request correlation identity.
     * @return {WorkspaceSetupOutcome} Current MigrationSafetyCopy projection.
     */
    private queryMigrationSafetyCopy(requestId: string): WorkspaceSetupOutcome {
        return this.migrationSafetyOutcome(
            requestId,
            migrationSafetyCopyProjection(inspectMigrationSafetyCopy(this.dataSlotsRoot)),
        );
    }

    /**
     * Explicitly deletes one freshly matched migration safety copy.
     * @param {string} requestId Request correlation identity.
     * @param {DeleteMigrationSafetyCopyCommand} command Exact observed copy identity.
     * @return {WorkspaceSetupOutcome} Absent projection after logical deletion commits.
     */
    private deleteMigrationSafetyCopy(
        requestId: string,
        command: DeleteMigrationSafetyCopyCommand,
    ): WorkspaceSetupOutcome {
        if (this.migrationRequestInFlight) {
            return this.problem(
                'operation-in-progress',
                '另一个迁移维护操作正在完成。',
                requestId,
            );
        }
        this.migrationRequestInFlight = true;
        try {
            if (this.options.readOnly || this.dataState.status.kind === 'read-only') {
                return this.problem('permission', '迁移安全副本未删除。', requestId);
            }
            if (this.preparedMigrationRollback || !this.migrationOperationsAreClear()) {
                return this.problem(
                    'operation-in-progress',
                    '恢复或迁移回退正在进行，迁移安全副本未删除。',
                    requestId,
                );
            }
            deleteMigrationSafetyCopy(
                this.dataSlotsRoot,
                command.migrationSafetyCopyId,
                command.expectedCopyVersion,
                command.confirmationToken,
            );
            return this.migrationSafetyOutcome(
                requestId,
                migrationSafetyCopyProjection(inspectMigrationSafetyCopy(this.dataSlotsRoot)),
            );
        }
        catch (error) {
            const code = error instanceof TypeError ? 'validation' : 'conflict';
            return this.problem(code, '迁移安全副本未删除。', requestId);
        }
        finally {
            this.migrationRequestInFlight = false;
        }
    }

    /**
     * Creates a fresh rollback preview bound to closed DATA and the current build.
     * @param {string} requestId Request correlation identity.
     * @return {Promise<WorkspaceSetupOutcome>} Preview session or unchanged problem.
     */
    private async previewMigrationRollback(requestId: string): Promise<WorkspaceSetupOutcome> {
        if (this.migrationRequestInFlight) {
            return this.problem(
                'operation-in-progress',
                '另一个迁移维护操作正在完成。',
                requestId,
            );
        }
        this.migrationRequestInFlight = true;
        try {
            if (this.options.readOnly || this.dataState.status.kind !== 'ready') {
                return this.problem('permission', '当前工作区不能预览迁移回退。', requestId);
            }
            if (!this.options.activityControlRoot || !this.migrationOperationsAreClear()) {
                return this.problem(
                    'operation-in-progress',
                    '恢复或迁移回退正在进行。',
                    requestId,
                );
            }
            const facts = await this.captureMigrationRollbackPreviewFacts(true);
            const prepared = createMigrationRollbackPreview(facts, Object.freeze({
                migrationRollbackSessionId: randomUUID(),
                operationId: randomUUID(),
            }));
            this.preparedMigrationRollback = prepared;
            this.migrationRollbackBinding = prepared.view.binding;
            return this.migrationSessionOutcome(requestId, prepared.view);
        }
        catch {
            return this.problem(
                'recovery-required',
                '无法形成一致的迁移回退预览。',
                requestId,
            );
        }
        finally {
            this.migrationRequestInFlight = false;
        }
    }

    /**
     * Queries the current preview, durable maintenance, or recovery session.
     * @param {string} requestId Request correlation identity.
     * @param {string | null} migrationRollbackSessionId Exact session or current session.
     * @return {WorkspaceSetupOutcome} Current rollback session projection.
     */
    private queryMigrationRollback(
        requestId: string,
        migrationRollbackSessionId: string | null,
    ): WorkspaceSetupOutcome {
        const preview = this.preparedMigrationRollback?.view;
        if (preview
            && (migrationRollbackSessionId === null
                || preview.migrationRollbackSessionId === migrationRollbackSessionId)) {
            return this.migrationSessionOutcome(requestId, preview);
        }
        const boot = this.currentMigrationRollbackBoot();
        if (boot.kind === 'clear') {
            return this.problem('validation', '当前没有迁移回退会话。', requestId);
        }
        if (boot.kind === 'recovery-required') {
            return this.migrationSessionOutcome(requestId, migrationRollbackRecoveryView());
        }
        if (migrationRollbackSessionId !== null
            && boot.migrationRollbackSessionId !== migrationRollbackSessionId) {
            return this.problem('validation', '迁移回退会话身份不匹配。', requestId);
        }
        return this.migrationSessionOutcome(requestId, this.migrationViewFrom(boot));
    }

    /**
     * Converts a preview confirmation into the durable R6-03 handoff.
     * @param {string} requestId Request correlation identity.
     * @param {ConfirmMigrationRollbackCommand} command Preview-bound confirmation.
     * @return {Promise<WorkspaceSetupOutcome>} Maintenance status after durable progress.
     */
    private async confirmMigrationRollback(
        requestId: string,
        command: ConfirmMigrationRollbackCommand,
    ): Promise<WorkspaceSetupOutcome> {
        if (this.migrationRequestInFlight) {
            return this.problem(
                'operation-in-progress',
                '另一个迁移维护操作正在完成。',
                requestId,
            );
        }
        this.migrationRequestInFlight = true;
        let refreshedFacts: MigrationRollbackPreviewFacts | null = null;
        try {
            const activityControlRoot = this.options.activityControlRoot;
            if (!activityControlRoot) {
                return this.problem('validation', '当前构建没有迁移回退控制根。', requestId);
            }
            let handoffFacts;
            const prepared = this.preparedMigrationRollback;
            if (prepared) {
                this.migrationMaintenance = true;
                refreshedFacts = await this.captureMigrationRollbackPreviewFacts(false);
                try {
                    handoffFacts = bindMigrationRollbackConfirmation(
                        prepared,
                        command,
                        refreshedFacts,
                    );
                }
                catch {
                    this.migrationMaintenance = false;
                    await this.reopenMigrationData(refreshedFacts.currentData);
                    this.startDurableBackup();
                    this.preparedMigrationRollback = null;
                    this.migrationRollbackBinding = null;
                    return this.problem(
                        'conflict',
                        '迁移回退影响已变化，请重新预览。',
                        requestId,
                    );
                }
                this.migrationRollbackBinding = prepared.view.binding;
                createMigrationRollbackHandoff(
                    activityControlRoot,
                    this.dataSlotsRoot,
                    handoffFacts,
                );
            }
            else {
                handoffFacts = inspectMigrationRollbackHandoffFacts(
                    activityControlRoot,
                    this.dataSlotsRoot,
                    command.migrationRollbackSessionId,
                );
                if (handoffFacts.previewDigest !== command.previewToken
                    || handoffFacts.confirmationDigest
                        !== migrationRollbackConfirmationDigest(command)) {
                    return this.problem('conflict', '迁移回退确认与原预览不匹配。', requestId);
                }
                this.migrationMaintenance = true;
                this.tryRestoreMigrationRollbackBinding(this.currentMigrationRollbackBoot());
            }
            let status = inspectMigrationRollbackBeforeWorkspaceOpen(
                activityControlRoot,
                this.dataSlotsRoot,
                this.appBuildId,
            );
            if (status.kind === 'maintenance' && status.phase === 'planned') {
                status = prepareMigrationRollbackHandoff(
                    activityControlRoot,
                    this.dataSlotsRoot,
                    command.migrationRollbackSessionId,
                    input => stageMigrationSafetyCopyForRollback(
                        this.dataSlotsRoot,
                        input.migrationSafetyCopyId,
                        input.candidateSlotName,
                    ),
                );
            }
            if (status.kind === 'maintenance'
                && (status.phase === 'prepared'
                    || status.phase === 'armed'
                    || status.phase === 'awaiting-target-build')) {
                status = armMigrationRollbackHandoff(
                    activityControlRoot,
                    this.dataSlotsRoot,
                    Object.freeze({
                        action: 'confirm' as const,
                        commandId: command.commandId,
                        migrationRollbackSessionId: command.migrationRollbackSessionId,
                        expectedSessionVersion: '2',
                        currentAppBuildId: this.appBuildId,
                    }),
                );
            }
            this.preparedMigrationRollback = null;
            this.migrationRollbackBoot = status;
            const outcome = this.migrationSessionOutcome(
                requestId,
                this.migrationViewFrom(status),
            );
            this.workspaceEpoch = randomUUID();
            return outcome;
        }
        catch (error) {
            if (error instanceof MigrationRollbackHandoffError
                && error.code === 'build-mismatch') {
                return this.problem(
                    'build-mismatch',
                    '当前应用构建不能执行这项迁移回退动作。',
                    requestId,
                );
            }
            if (error instanceof MigrationRollbackHandoffError
                && error.code === 'command-conflict') {
                return this.problem(
                    'conflict',
                    '迁移回退命令身份已被不同动作使用。',
                    requestId,
                );
            }
            const activityControlRoot = this.options.activityControlRoot;
            if (activityControlRoot) {
                const boot = inspectMigrationRollbackBeforeWorkspaceOpen(
                    activityControlRoot,
                    this.dataSlotsRoot,
                    this.appBuildId,
                );
                this.migrationRollbackBoot = boot;
                if (boot.kind === 'maintenance') {
                    this.migrationMaintenance = true;
                    this.preparedMigrationRollback = null;
                    this.tryRestoreMigrationRollbackBinding(boot);
                    const outcome = this.migrationSessionOutcome(
                        requestId,
                        this.migrationViewFrom(boot),
                    );
                    this.workspaceEpoch = randomUUID();
                    return outcome;
                }
                if (boot.kind === 'clear') {
                    if (refreshedFacts && !this.dataState.store) {
                        await this.reopenMigrationData(refreshedFacts.currentData);
                    }
                    if (this.dataState.store) {
                        this.migrationMaintenance = false;
                        this.preparedMigrationRollback = null;
                        this.migrationRollbackBinding = null;
                        this.startDurableBackup();
                        return this.problem(
                            'conflict',
                            '迁移回退影响已变化，请重新预览。',
                            requestId,
                        );
                    }
                }
            }
            if (refreshedFacts && !this.dataState.store) {
                try {
                    await this.reopenMigrationData(refreshedFacts.currentData);
                    this.migrationMaintenance = false;
                    this.startDurableBackup();
                }
                catch {
                    this.migrationMaintenance = true;
                }
            }
            const code = error instanceof MigrationRollbackHandoffError
                && error.code === 'build-mismatch'
                ? 'build-mismatch'
                : 'recovery-required';
            return this.problem(code, '迁移回退确认未能安全完成。', requestId);
        }
        finally {
            this.migrationRequestInFlight = false;
        }
    }

    /**
     * Cancels as the exact source build and restores the retained migrated DATA.
     * @param {string} requestId Request correlation identity.
     * @param {MigrationRollbackActionCommand} command Exact session action.
     * @return {Promise<WorkspaceSetupOutcome>} Terminal or retryable maintenance state.
     */
    private async cancelMigrationRollback(
        requestId: string,
        command: MigrationRollbackActionCommand,
    ): Promise<WorkspaceSetupOutcome> {
        return this.completeMigrationRollback(requestId, command, 'cancel-as-source');
    }

    /**
     * Continues as the exact rollback target and consumes the installed safety copy.
     * @param {string} requestId Request correlation identity.
     * @param {MigrationRollbackActionCommand} command Exact session action.
     * @return {Promise<WorkspaceSetupOutcome>} Terminal or retryable maintenance state.
     */
    private async continueMigrationRollback(
        requestId: string,
        command: MigrationRollbackActionCommand,
    ): Promise<WorkspaceSetupOutcome> {
        return this.completeMigrationRollback(requestId, command, 'continue-as-target');
    }

    /**
     * Runs one exact-build terminal branch through reopen, Library, and FLOW-00 gates.
     * @param {string} requestId Request correlation identity.
     * @param {MigrationRollbackActionCommand} command Exact action command.
     * @param {'cancel-as-source' | 'continue-as-target'} action Exact build branch.
     * @return {Promise<WorkspaceSetupOutcome>} Terminal or pending state.
     */
    private async completeMigrationRollback(
        requestId: string,
        command: MigrationRollbackActionCommand,
        action: 'cancel-as-source' | 'continue-as-target',
    ): Promise<WorkspaceSetupOutcome> {
        if (this.migrationRequestInFlight) {
            return this.problem(
                'operation-in-progress',
                '另一个迁移维护操作正在完成。',
                requestId,
            );
        }
        this.migrationRequestInFlight = true;
        try {
            const activityControlRoot = this.options.activityControlRoot;
            if (!activityControlRoot) {
                return this.problem('validation', '当前构建没有迁移回退控制根。', requestId);
            }
            const kernelCommand = Object.freeze({
                action,
                commandId: command.commandId,
                migrationRollbackSessionId: command.migrationRollbackSessionId,
                expectedSessionVersion: command.expectedSessionVersion,
                currentAppBuildId: this.appBuildId,
            });
            const callbacks = Object.freeze({
                reopen: (expected: MigrationRollbackDataIdentity) => (
                    this.reopenMigrationData(expected)
                ),
                libraryReconcile: async () => {
                    // MOD-LIBRARY is absent in R6; the explicit empty binding is already reconciled.
                },
                flow00: () => this.runMigrationRollbackFlow00(),
            });
            const status = action === 'cancel-as-source'
                ? await cancelMigrationRollbackHandoff(
                    activityControlRoot,
                    this.dataSlotsRoot,
                    kernelCommand,
                    callbacks,
                )
                : await continueMigrationRollbackHandoff(
                    activityControlRoot,
                    this.dataSlotsRoot,
                    kernelCommand,
                    Object.freeze({
                        ...callbacks,
                        consumeSafetyCopy: async input => {
                            consumeMigrationSafetyCopyAfterRollback(
                                this.dataSlotsRoot,
                                input.migrationSafetyCopyId,
                                input.operationId,
                            );
                        },
                    }),
                );
            this.migrationRollbackBoot = status;
            const outcome = this.migrationSessionOutcome(
                requestId,
                this.migrationViewFrom(status),
            );
            if (status.kind === 'succeeded' || status.kind === 'cancelled') {
                this.migrationMaintenance = false;
                this.preparedMigrationRollback = null;
                this.startDurableBackup();
                this.workspaceEpoch = randomUUID();
            }
            return outcome;
        }
        catch (error) {
            if (error instanceof MigrationRollbackHandoffError
                && error.code === 'build-mismatch') {
                return this.problem(
                    'build-mismatch',
                    '当前应用构建不能执行这项迁移回退动作。',
                    requestId,
                );
            }
            if (error instanceof MigrationRollbackHandoffError
                && error.code === 'command-conflict') {
                return this.problem(
                    'conflict',
                    '迁移回退命令身份已被不同动作使用。',
                    requestId,
                );
            }
            const activityControlRoot = this.options.activityControlRoot;
            if (activityControlRoot) {
                const boot = inspectMigrationRollbackBeforeWorkspaceOpen(
                    activityControlRoot,
                    this.dataSlotsRoot,
                    this.appBuildId,
                );
                this.migrationRollbackBoot = boot;
                if (boot.kind === 'maintenance') {
                    this.migrationMaintenance = true;
                    this.tryRestoreMigrationRollbackBinding(boot);
                    return this.migrationSessionOutcome(requestId, this.migrationViewFrom(boot));
                }
            }
            return this.problem(
                'recovery-required',
                '迁移回退仍需维护，未报告完成。',
                requestId,
                'unknown',
            );
        }
        finally {
            this.migrationRequestInFlight = false;
        }
    }

    /**
     * Captures the current closed DATA identity and reopens it when requested.
     * @param {boolean} reopenAfterCapture Whether normal operation resumes after capture.
     * @return {Promise<MigrationRollbackPreviewFacts>} Fresh owner-private facts.
     */
    private async captureMigrationRollbackPreviewFacts(
        reopenAfterCapture: boolean,
    ): Promise<MigrationRollbackPreviewFacts> {
        const status = this.dataState.status;
        if (status.kind !== 'ready' || !this.dataState.store) {
            throw new Error('Migration rollback requires writable DATA');
        }
        const expected: MigrationRollbackDataIdentity = Object.freeze({
            workspaceId: status.workspaceId,
            schemaLevel: status.schemaLevel.toString(),
            revision: status.revision,
        });
        await this.closeDataForMigration();
        try {
            const safetyStatus = inspectMigrationSafetyCopy(this.dataSlotsRoot);
            if (safetyStatus.kind !== 'verified') {
                throw new Error('Migration safety copy is unavailable');
            }
            const active = observeRestoreDataSlot(this.dataSlotsRoot, 'active');
            const member = active.kind === 'present' ? active.fingerprint.members[0] : undefined;
            if (active.kind !== 'present'
                || active.fingerprint.members.length !== 1
                || member?.path !== 'workspace.sqlite') {
                throw new Error('Active DATA closure changed');
            }
            return Object.freeze({
                safetyCopy: Object.freeze({
                    projection: migrationSafetyCopyProjection(safetyStatus) as Extract<
                        MigrationSafetyCopyProjection,
                        Readonly<{kind: 'verified'}>
                    >,
                    closedDataSlotDigest: safetyStatus.metadata.closedDataSlotDigest,
                }),
                currentData: Object.freeze({
                    ...expected,
                    byteLength: member.byteLength,
                    digest: member.sha256,
                    slotFingerprint: active.fingerprint.slotFingerprint,
                }),
                currentLibrary: Object.freeze({kind: 'absent' as const}),
                sourceBuild: sourceBuildProjection(this.appBuildId, this.options),
            });
        }
        catch (error) {
            if (!reopenAfterCapture) {
                await this.reopenMigrationData(expected);
                this.startDurableBackup();
            }
            throw error;
        }
        finally {
            if (reopenAfterCapture) {
                await this.reopenMigrationData(expected);
                this.startDurableBackup();
            }
        }
    }

    /**
     * Closes background owners and DATA before physical rollback evidence is observed.
     * @return {Promise<void>} Completion after the active connection is closed.
     */
    private async closeDataForMigration(): Promise<void> {
        const store = this.dataState.store;
        if (!store) {
            throw new Error('Workspace DATA is not open');
        }
        try {
            store.setPostCommitHint(null);
        }
        catch {
            // A terminal connection may already have detached its hint.
        }
        await this.backupCoordinator?.close();
        this.backupCoordinator = undefined;
        if (this.restoreCoordinator?.requiresMaintenance()) {
            throw new Error('Restore maintenance blocks MigrationRollback');
        }
        this.restoreCoordinator = undefined;
        await store.close();
        this.dataState = Object.freeze({
            sqliteVersion: this.dataState.sqliteVersion,
            status: Object.freeze({
                kind: 'recovery' as const,
                problem: migrationRollbackEvidenceProblem(),
            }),
        });
    }

    /**
     * Opens the exact DATA chosen by the handoff and rejects any identity drift.
     * @param {MigrationRollbackDataIdentity} expected Exact durable identity.
     * @return {Promise<void>} Completion after the validated store is adopted.
     */
    private async reopenMigrationData(expected: MigrationRollbackDataIdentity): Promise<void> {
        if (this.dataState.store) {
            const status = this.dataState.store.status();
            if (status.workspaceId === expected.workspaceId
                && status.schemaLevel.toString() === expected.schemaLevel
                && status.revision === expected.revision) {
                return;
            }
            await this.dataState.store.close();
        }
        const opened = await openWorkspaceDataWithMigrations(
            this.dataSlotsRoot,
            migrationOpenOptions(this.appBuildId, this.options),
        );
        this.dataState = dataStateFrom(opened);
        const status = this.dataState.status;
        if (opened.kind !== 'ready'
            || status.kind !== 'ready'
            || status.workspaceId !== expected.workspaceId
            || status.schemaLevel.toString() !== expected.schemaLevel
            || status.revision !== expected.revision) {
            if (opened.kind === 'ready' || opened.kind === 'read-only') {
                await opened.store.close();
            }
            this.dataState = Object.freeze({
                sqliteVersion: workspaceDataRuntimeVersion(),
                status: Object.freeze({
                    kind: 'recovery' as const,
                    problem: migrationRollbackEvidenceProblem(),
                }),
            });
            throw new Error('Migration rollback reopened DATA identity changed');
        }
    }

    /**
     * Runs FLOW-00 after the selected DATA is open and before a terminal receipt.
     * @return {Promise<void>} Completion after lifecycle reconciliation succeeds.
     */
    private async runMigrationRollbackFlow00(): Promise<void> {
        if (!this.dataState.store) {
            throw new Error('Migration rollback DATA is not open');
        }
        const projection = this.dataState.store.readSetupProjection();
        const problem = await this.reconcileWorkspaceLifecycle(randomUUID(), projection);
        if (problem !== null) {
            throw new Error('FLOW-00 reconciliation did not complete');
        }
    }

    /**
     * Reads live restore and rollback mutex state before an ordinary mutation.
     * @return {boolean} Whether no global destructive operation is pending.
     */
    private migrationOperationsAreClear(): boolean {
        const activityControlRoot = this.options.activityControlRoot;
        if (!activityControlRoot) {
            return false;
        }
        const restore = inspectRestoreBeforeWorkspaceOpen(
            activityControlRoot,
            this.dataSlotsRoot,
        );
        const rollback = inspectNonterminalMigrationRollback(
            activityControlRoot,
            this.dataSlotsRoot,
        );
        return (restore.kind === 'clear' || restore.kind === 'committed')
            && rollback.kind === 'clear';
    }

    /**
     * Reads the current rollback kernel state without opening ordinary DATA.
     * @return {MigrationRollbackBootState} Fresh boot classification.
     */
    private currentMigrationRollbackBoot(): MigrationRollbackBootState {
        if (!this.options.activityControlRoot) {
            return Object.freeze({
                kind: 'clear' as const,
                migrationRollbackSessionId: null,
                operationId: null,
                sessionVersion: null,
                phase: null,
                currentBuild: null,
                requiredBuilds: null,
                allowedActions: Object.freeze([] as const),
                retryCommand: null,
                outcome: null,
            });
        }
        const boot = inspectMigrationRollbackBeforeWorkspaceOpen(
            this.options.activityControlRoot,
            this.dataSlotsRoot,
            this.appBuildId,
        );
        this.migrationRollbackBoot = boot;
        return boot;
    }

    /**
     * Reconstructs the path-free binding from immutable handoff and DATA metadata.
     * @param {MigrationRollbackBootState} boot Fresh exact-build classification.
     * @return {void}
     */
    private tryRestoreMigrationRollbackBinding(boot: MigrationRollbackBootState): void {
        if (!this.options.activityControlRoot
            || !boot.migrationRollbackSessionId
            || boot.kind === 'recovery-required') {
            return;
        }
        try {
            const facts = inspectMigrationRollbackHandoffFacts(
                this.options.activityControlRoot,
                this.dataSlotsRoot,
                boot.migrationRollbackSessionId,
            );
            const safety = inspectMigrationSafetyCopy(this.dataSlotsRoot);
            if (safety.kind !== 'verified'
                || safety.metadata.migrationSafetyCopyId
                    !== facts.safetyCopy.migrationSafetyCopyId
                || safety.metadata.closedDataSlotDigest !== facts.safetyCopy.digest) {
                return;
            }
            const safetyCopy = migrationSafetyCopyProjection(safety);
            if (safetyCopy.kind !== 'verified') {
                return;
            }
            this.migrationRollbackBinding = Object.freeze({
                safetyCopy,
                currentData: Object.freeze({
                    workspaceId: facts.currentData.workspaceId,
                    schemaLevel: facts.currentData.schemaLevel,
                    revision: facts.currentData.revision,
                }),
                currentLibrary: Object.freeze({kind: 'absent' as const}),
                sourceBuild: Object.freeze({
                    releaseVersion: facts.currentReleaseVersion,
                    tag: facts.currentAppBuildId,
                    appBuildId: facts.currentAppBuildId,
                }),
                targetBuild: safetyCopy.target,
                impact: Object.freeze({
                    replacement: 'complete' as const,
                    automaticMerge: false as const,
                    currentRevision: facts.currentData.revision,
                    targetRevision: facts.safetyCopy.revision,
                    structuredDataChanges: 'discarded-after-target-revision' as const,
                    libraryFiles: 'remain-in-place' as const,
                    libraryReconciliation: 'full' as const,
                }),
            });
        }
        catch {
            this.migrationRollbackBinding = null;
        }
    }

    /**
     * Maps a kernel status to the complete Shell projection.
     * @param {MigrationRollbackBootState} status Fresh path-free kernel status.
     * @return {MigrationRollbackSessionView} Validated Shell projection.
     */
    private migrationViewFrom(status: MigrationRollbackBootState): MigrationRollbackSessionView {
        if (status.kind === 'clear'
            || status.kind === 'recovery-required'
            || !status.migrationRollbackSessionId
            || !status.operationId
            || !status.sessionVersion
            || !status.phase
            || !status.currentBuild) {
            return migrationRollbackRecoveryView();
        }
        if (!this.migrationRollbackBinding) {
            this.tryRestoreMigrationRollbackBinding(status);
        }
        const binding = this.migrationRollbackBinding;
        if (!binding
            || (status.kind === 'succeeded' || status.kind === 'cancelled')
                && status.currentBuild === 'other') {
            return migrationRollbackRecoveryView();
        }
        const view: MigrationRollbackSessionView = Object.freeze({
            migrationRollbackSessionId: status.migrationRollbackSessionId,
            operationId: status.operationId,
            sessionVersion: status.sessionVersion,
            phase: status.phase,
            currentBuild: status.currentBuild,
            binding,
            previewToken: null,
            retryCommand: status.retryCommand
                && status.allowedActions.includes(status.retryCommand.action)
                ? Object.freeze({...status.retryCommand})
                : null,
            allowedActions: status.allowedActions,
            outcome: status.outcome,
            problem: null,
        });
        return isMigrationRollbackSessionView(view)
            ? view
            : migrationRollbackRecoveryView();
    }

    /**
     * Wraps one migration success value in the common Workspace outcome.
     * @param {WorkspaceMigrationSuccessValue} value Exact success value.
     * @return {WorkspaceSetupOutcome} Common success envelope.
     */
    private migrationValue(value: WorkspaceMigrationSuccessValue): WorkspaceSetupOutcome {
        return Object.freeze({ok: true as const, value});
    }

    private migrationSafetyOutcome(
        requestId: string,
        safetyCopy: MigrationSafetyCopyProjection,
    ): WorkspaceSetupOutcome {
        return this.migrationValue(Object.freeze({
            kind: 'workspace.migration-safety-copy' as const,
            protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
            appBuildId: this.appBuildId,
            requestId,
            workspaceEpoch: this.workspaceEpoch,
            safetyCopy,
        }));
    }

    private migrationSessionOutcome(
        requestId: string,
        session: MigrationRollbackSessionView,
    ): WorkspaceSetupOutcome {
        return this.migrationValue(Object.freeze({
            kind: 'workspace.migration-rollback-session' as const,
            protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
            appBuildId: this.appBuildId,
            requestId,
            workspaceEpoch: this.workspaceEpoch,
            session,
        }));
    }

    /**
     * Attaches the per-open DATA hint and requests startup convergence when writable.
     * @return {void}
     */
    private startDurableBackup(): void {
        const store = this.dataState.store;
        if (!store || this.dataState.status.kind !== 'ready') {
            return;
        }
        if (!this.restoreCoordinator && this.options.activityControlRoot) {
            this.restoreCoordinator = new RestoreCoordinator(
                store,
                this.options.activityControlRoot,
                {
                    dataSlotsRoot: this.dataSlotsRoot,
                    clock: this.options.clock,
                    failpoint: this.options.restoreFailpoint,
                },
            );
        }
        if (this.restoreCoordinator?.requiresMaintenance()) {
            this.restoreMaintenance = true;
            return;
        }
        if (!this.backupCoordinator) {
            const coordinator = new DurableBackupCoordinator(store, {
                clock: this.options.clock ?? SYSTEM_CLOCK,
                ...this.options.durableBackupOptions,
            });
            this.backupCoordinator = coordinator;
            store.setPostCommitHint(() => coordinator.wake());
        }
        this.backupCoordinator.wake();
    }

    /**
     * Reduces current owner state to the lifecycle mode-precedence input.
     * @return {WorkspaceLifecycleInput['startupDisposition']} Current startup disposition.
     */
    private lifecycleDisposition(): WorkspaceLifecycleInput['startupDisposition'] {
        if (this.dataState.status.kind === 'recovery') {
            return this.dataState.status.problem.code === 'rollback-required'
                ? 'maintenance'
                : 'recovery';
        }
        return this.migrationMaintenance || this.restoreMaintenance
            ? 'maintenance'
            : 'ordinary';
    }

    /**
     * Restores current durable operation handles without leaking owner storage facts.
     * @return {readonly WorkspaceOperationProjection[]} Current path-free operation handles.
     */
    private lifecycleOperations(): readonly WorkspaceOperationProjection[] {
        const store = this.dataState.store;
        const migrationBoot = this.migrationMaintenance
            ? this.currentMigrationRollbackBoot()
            : this.migrationRollbackBoot ?? this.startupInspection?.migrationRollback ?? null;
        return Object.freeze([
            restoreOperationProjection(this.latestRestoreSession),
            migrationRollbackOperationProjection(migrationBoot),
            backupOperationProjection(
                store?.readBackupOperation() ?? null,
                this.backupCoordinator?.isRunning() ?? false,
            ),
            backupCleanupOperationProjection(store?.readBackupCleanupOperation() ?? null),
        ].filter((operation): operation is WorkspaceOperationProjection => operation !== null));
    }

    /**
     * Reconciles FLOW-00 and builds the authoritative startup projection.
     * @param {string} requestId Bootstrap request correlation identity.
     * @return {Promise<WorkspaceLifecycleProjection>} Current lifecycle projection.
     */
    private async workspaceLifecycle(requestId: string): Promise<WorkspaceLifecycleProjection> {
        let setupRoute: WorkspaceLifecycleInput['setupRoute'] = null;
        let startupDisposition = this.lifecycleDisposition();
        if (this.dataState.store && startupDisposition === 'ordinary') {
            const initialProjection = this.dataState.store.readSetupProjection();
            const reconciled = await this.reconcileWorkspaceLifecycle(requestId, initialProjection);
            if (reconciled) {
                startupDisposition = 'recovery';
            }
            else {
                setupRoute = this.dataState.store.readSetupProjection(
                    this.options.setupProjectionReadOptions,
                ).defaultRoute;
            }
        }
        const pendingFollowUps: readonly WorkspacePendingFollowUpProjection[] = this.dataState.store
            ?.readPendingFollowUps() ?? Object.freeze([]);
        return workspaceLifecycleFrom({
            workspaceData: this.dataState.status,
            setupRoute,
            startupDisposition,
            moduleStatus: this.options.moduleStatus ?? Object.freeze({}),
            operations: this.lifecycleOperations(),
            pendingFollowUps,
        });
    }

    private async bootstrap(request: WorkspaceProbeRequest): Promise<BootstrapOutcome> {
        const workspaceLifecycle = await this.workspaceLifecycle(request.requestId);
        if (workspaceLifecycle.route === 'setup' || workspaceLifecycle.route === 'today') {
            this.startDurableBackup();
        }
        return {
            ok: true,
            value: {
                protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                appBuildId: this.appBuildId,
                requestId: request.requestId,
                workspaceProcess: 'ready',
                sqliteVersion: this.dataState.sqliteVersion,
                dataRootClass: request.dataRootClass,
                workspaceEpoch: this.workspaceEpoch,
                workspaceData: this.dataState.status,
                workspaceLifecycle,
            },
        };
    }

    private initialize(requestId: string): WorkspaceSetupOutcome {
        if (this.dataState.status.kind === 'recovery') {
            return this.problem('recovery-required', '本地数据需要恢复，不能开始设置。', requestId);
        }
        if (this.options.readOnly) {
            return this.problem('permission', '本地数据为只读，不能开始设置。', requestId);
        }
        if (this.dataState.status.kind === 'absent') {
            try {
                const store = initializeWorkspaceData(this.dataSlotsRoot, randomUUID());
                this.dataState = {
                    sqliteVersion: this.dataState.sqliteVersion,
                    status: store.status(),
                    store,
                };
            }
            catch {
                return this.problem('workspace-unavailable', '无法创建本地工作区。', requestId);
            }
        }

        return {
            ok: true,
            value: {
                kind: 'workspace.initialized',
                protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                appBuildId: this.appBuildId,
                requestId,
                workspaceEpoch: this.workspaceEpoch,
                workspaceData: this.dataState.status,
            },
        };
    }

    private async querySetup(requestId: string): Promise<WorkspaceSetupOutcome> {
        if (!this.dataState.store) {
            const code = this.dataState.status.kind === 'recovery'
                ? 'recovery-required'
                : 'workspace-unavailable';
            return this.problem(code, '当前没有可读取的 setup 数据。', requestId);
        }

        try {
            const initialProjection = this.dataState.store.readSetupProjection();
            const reconciled = await this.reconcileWorkspaceLifecycle(requestId, initialProjection);
            if (reconciled) {
                return reconciled;
            }
            return {
                ok: true,
                value: {
                    kind: 'workspace.setup-projection',
                    protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                    appBuildId: this.appBuildId,
                    requestId,
                    workspaceEpoch: this.workspaceEpoch,
                    dataMode: this.dataState.status.kind === 'read-only' ? 'read-only' : 'ready',
                    projection: this.dataState.store.readSetupProjection(this.options.setupProjectionReadOptions),
                },
            };
        }
        catch {
            return this.problem('recovery-required', '无法读取一致的 setup 数据。', requestId);
        }
    }

    /**
     * Saves a Shell-owned setup checkpoint using the Workspace Clock.
     * @param {string} requestId - Request correlation identity.
     * @param {SaveSetupDraftCheckpointRequest['input']} input - Validated opaque checkpoint input.
     * @return {Promise<WorkspaceSetupOutcome>} Updated projection or structured problem.
     */
    private async saveSetupDraftCheckpoint(
        requestId: string,
        input: SaveSetupDraftCheckpointRequest['input'],
    ): Promise<WorkspaceSetupOutcome> {
        if (!this.dataState.store) {
            const code = this.dataState.status.kind === 'recovery'
                ? 'recovery-required'
                : 'workspace-unavailable';
            return this.problem(code, '当前没有可保存设置草稿的数据。', requestId);
        }
        let writeSucceeded = false;
        try {
            const written = await this.dataState.store.saveSetupDraftCheckpoint(
                input,
                (this.options.clock ?? SYSTEM_CLOCK).now(),
                this.options.commitOptions,
            );
            writeSucceeded = written.ok;
            this.dataState = { ...this.dataState, status: this.dataState.store.status() };
            if (!written.ok) {
                return this.commitProblem(written.problem, requestId, '设置草稿未保存，现有数据没有改变。');
            }
            return this.setupProjectionAfterDraftWrite(requestId);
        }
        catch (error) {
            if (writeSucceeded || error instanceof SetupDraftCheckpointOutcomeUnknownError) {
                return this.problem(
                    'recovery-required',
                    '设置草稿结果无法确认；请重新查询设置状态。',
                    requestId,
                    'unknown',
                );
            }
            const code = error instanceof TypeError ? 'validation' : 'recovery-required';
            return this.problem(code, '无法保存设置草稿。', requestId);
        }
    }

    /**
     * Clears the setup checkpoint through its independent optimistic version stream.
     * @param {string} requestId - Request correlation identity.
     * @param {string} expectedVersion - Last observed draft version.
     * @return {Promise<WorkspaceSetupOutcome>} Updated projection or structured problem.
     */
    private async discardSetupDraftCheckpoint(
        requestId: string,
        expectedVersion: DiscardSetupDraftCheckpointRequest['expectedVersion'],
    ): Promise<WorkspaceSetupOutcome> {
        if (!this.dataState.store) {
            const code = this.dataState.status.kind === 'recovery'
                ? 'recovery-required'
                : 'workspace-unavailable';
            return this.problem(code, '当前没有可丢弃设置草稿的数据。', requestId);
        }
        let writeSucceeded = false;
        try {
            const written = await this.dataState.store.discardSetupDraftCheckpoint(
                expectedVersion,
                this.options.commitOptions,
            );
            writeSucceeded = written.ok;
            this.dataState = { ...this.dataState, status: this.dataState.store.status() };
            if (!written.ok) {
                return this.commitProblem(written.problem, requestId, '设置草稿未丢弃，现有数据没有改变。');
            }
            return this.setupProjectionAfterDraftWrite(requestId);
        }
        catch (error) {
            if (writeSucceeded || error instanceof SetupDraftCheckpointOutcomeUnknownError) {
                return this.problem(
                    'recovery-required',
                    '设置草稿丢弃结果无法确认；请重新查询设置状态。',
                    requestId,
                    'unknown',
                );
            }
            const code = error instanceof TypeError ? 'validation' : 'recovery-required';
            return this.problem(code, '无法丢弃设置草稿。', requestId);
        }
    }

    /**
     * Reads the projection returned after a successful draft-only write.
     * @param {string} requestId - Request correlation identity.
     * @return {WorkspaceSetupOutcome} Current setup projection.
     */
    private setupProjectionAfterDraftWrite(requestId: string): WorkspaceSetupOutcome {
        return {
            ok: true,
            value: {
                kind: 'workspace.setup-projection',
                protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                appBuildId: this.appBuildId,
                requestId,
                workspaceEpoch: this.workspaceEpoch,
                dataMode: this.dataState.status.kind === 'read-only' ? 'read-only' : 'ready',
                projection: this.dataState.store!.readSetupProjection(this.options.setupProjectionReadOptions),
            },
        };
    }

    /**
     * Produces all current PLAN view facts from one revision and one Clock evaluation.
     * @param {string} requestId - Request correlation identity.
     * @return {WorkspaceSetupOutcome} Unified PLAN projection or structured problem.
     */
    private queryPlan(requestId: PlanQueryRequest['requestId']): WorkspaceSetupOutcome {
        if (!this.dataState.store) {
            const code = this.dataState.status.kind === 'recovery'
                ? 'recovery-required'
                : 'workspace-unavailable';
            return this.problem(code, '当前没有可读取的计划数据。', requestId);
        }

        try {
            const evaluatedAt = (this.options.clock ?? SYSTEM_CLOCK).now();
            const source = this.dataState.store.readPlanProjectionSource();
            const context = createPlanEvaluationContext(evaluatedAt, source.term.timeZone);
            return {
                ok: true,
                value: {
                    kind: 'workspace.plan-projection',
                    protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                    appBuildId: this.appBuildId,
                    requestId,
                    workspaceEpoch: this.workspaceEpoch,
                    dataMode: this.dataState.status.kind === 'read-only' ? 'read-only' : 'ready',
                    projection: buildPlanProjection(source, context, 'unavailable'),
                },
            };
        }
        catch (error) {
            const code = error instanceof TypeError ? 'workspace-unavailable' : 'recovery-required';
            return this.problem(code, '无法读取一致的统一计划数据。', requestId);
        }
    }

    /**
     * Returns legal configured or unconfigured PROTECT state without filesystem paths.
     * @param {string} requestId - Request correlation identity.
     * @return {WorkspaceSetupOutcome} Current data-protection projection.
     */
    private queryDataProtection(requestId: string): WorkspaceSetupOutcome {
        if (!this.dataState.store) {
            const code = this.dataState.status.kind === 'recovery'
                ? 'recovery-required'
                : 'workspace-unavailable';
            return this.problem(code, '当前没有可读取的数据保护配置。', requestId);
        }
        try {
            return {
                ok: true,
                value: {
                    kind: 'workspace.data-protection-projection',
                    protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                    appBuildId: this.appBuildId,
                    requestId,
                    workspaceEpoch: this.workspaceEpoch,
                    dataMode: this.dataState.status.kind === 'read-only' ? 'read-only' : 'ready',
                    projection: readVerifiedDataProtectionProjection(
                        this.dataState.store,
                        this.restoreCoordinator?.listCandidates(),
                    ),
                },
            };
        }
        catch {
            return this.problem('recovery-required', '无法读取一致的数据保护配置。', requestId);
        }
    }

    private async startRestoreSession(
        requestId: string,
        command: StartRestoreSessionRequest['command'],
    ): Promise<WorkspaceSetupOutcome> {
        if (!this.restoreCoordinator || this.dataState.status.kind !== 'ready') {
            return this.problem(
                'workspace-unavailable',
                '当前工作区不能开始恢复会话。',
                requestId,
            );
        }
        try {
            await this.backupCoordinator?.waitForIdle();
            const session = await this.restoreCoordinator.start(command);
            this.latestRestoreSession = session;
            return this.restoreSessionOutcome(requestId, session);
        }
        catch (error) {
            return this.restoreProblem(error, requestId, '无法开始恢复会话。');
        }
    }

    private queryRestoreSession(
        requestId: string,
        restoreSessionId: RestoreSessionQueryRequest['restoreSessionId'],
    ): WorkspaceSetupOutcome {
        if (!this.restoreCoordinator) {
            return this.problem(
                'workspace-unavailable',
                '当前工作区没有可查询的恢复会话。',
                requestId,
            );
        }
        try {
            const session = this.restoreCoordinator.query(restoreSessionId);
            this.latestRestoreSession = session;
            return this.restoreSessionOutcome(requestId, session);
        }
        catch (error) {
            return this.restoreProblem(error, requestId, '无法查询恢复会话。');
        }
    }

    private async confirmRestoreSession(
        requestId: string,
        command: ConfirmRestoreSessionRequest['command'],
    ): Promise<WorkspaceSetupOutcome> {
        if (!this.restoreCoordinator || this.dataState.status.kind !== 'ready') {
            return this.problem(
                'workspace-unavailable',
                '当前工作区不能确认恢复预览。',
                requestId,
            );
        }
        try {
            await this.backupCoordinator?.waitForIdle();
            const session = await this.restoreCoordinator.confirm(command);
            if (session.phase === 'protection-established') {
                await this.stopDurableBackupForRestore();
                this.restoreMaintenance = true;
            }
            this.latestRestoreSession = session;
            return this.restoreSessionOutcome(requestId, session);
        }
        catch (error) {
            return this.restoreProblem(error, requestId, '无法确认恢复预览。');
        }
    }

    private async cancelRestoreSession(
        requestId: string,
        command: CancelRestoreSessionRequest['command'],
    ): Promise<WorkspaceSetupOutcome> {
        if (!this.restoreCoordinator || this.dataState.status.kind !== 'ready') {
            return this.problem(
                'workspace-unavailable',
                '当前工作区不能取消恢复会话。',
                requestId,
            );
        }
        try {
            await this.backupCoordinator?.waitForIdle();
            const session = await this.restoreCoordinator.cancelBeforeCheckpoint(command);
            this.restoreMaintenance = false;
            this.latestRestoreSession = session;
            this.startDurableBackup();
            return this.restoreSessionOutcome(requestId, session);
        }
        catch (error) {
            return this.restoreProblem(error, requestId, '无法取消恢复会话。');
        }
    }

    private async resumeRestoreSession(
        requestId: string,
        command: ResumeRestoreSessionRequest['command'],
    ): Promise<WorkspaceSetupOutcome> {
        if (!this.restoreCoordinator) {
            return this.problem(
                'workspace-unavailable',
                '当前工作区没有可继续的恢复会话。',
                requestId,
            );
        }
        await this.stopDurableBackupForRestore();
        try {
            const session = await this.restoreCoordinator.resume(command);
            if (!this.adoptRestoreStore()) {
                throw new RestoreSessionError('recovery-required');
            }
            this.restoreMaintenance = false;
            this.latestRestoreSession = session;
            this.startDurableBackup();
            const outcome = this.restoreSessionOutcome(requestId, session);
            this.workspaceEpoch = randomUUID();
            return outcome;
        }
        catch (error) {
            const outcome = this.restoreProblem(error, requestId, '无法继续恢复会话。');
            if (this.adoptRestoreStore()) {
                this.restoreMaintenance = true;
            }
            else {
                this.restoreMaintenance = true;
                this.enterRestoreRecovery(command.restoreSessionId);
                this.workspaceEpoch = randomUUID();
            }
            return outcome;
        }
    }

    private async rollbackRestoreSession(
        requestId: string,
        command: RollbackRestoreSessionRequest['command'],
    ): Promise<WorkspaceSetupOutcome> {
        if (!this.restoreCoordinator) {
            return this.problem(
                'workspace-unavailable',
                '当前工作区没有可回滚的恢复会话。',
                requestId,
            );
        }
        await this.stopDurableBackupForRestore();
        try {
            const session = await this.restoreCoordinator.rollback(command);
            if (!this.adoptRestoreStore()) {
                throw new RestoreSessionError('recovery-required');
            }
            this.restoreMaintenance = false;
            this.latestRestoreSession = session;
            this.startDurableBackup();
            const outcome = this.restoreSessionOutcome(requestId, session);
            this.workspaceEpoch = randomUUID();
            return outcome;
        }
        catch (error) {
            const outcome = this.restoreProblem(error, requestId, '无法回滚恢复会话。');
            if (this.adoptRestoreStore()) {
                this.restoreMaintenance = true;
            }
            else {
                this.restoreMaintenance = true;
                this.enterRestoreRecovery(command.restoreSessionId);
                this.workspaceEpoch = randomUUID();
            }
            return outcome;
        }
    }

    private async stopDurableBackupForRestore(): Promise<void> {
        try {
            this.dataState.store?.setPostCommitHint(null);
        }
        catch {
            // Restore may already have closed the prior DATA connection.
        }
        await this.backupCoordinator?.close();
        this.backupCoordinator = undefined;
    }

    private adoptRestoreStore(): boolean {
        const store = this.restoreCoordinator?.activeStore();
        if (!store) {
            return false;
        }
        this.dataState = {
            sqliteVersion: workspaceDataRuntimeVersion(),
            status: store.status(),
            store,
        };
        return true;
    }

    private enterRestoreRecovery(restoreSessionId: string): void {
        let session: ReturnType<RestoreCoordinator['query']> | null = null;
        try {
            session = this.restoreCoordinator?.query(restoreSessionId) ?? null;
        }
        catch {
            // A corrupt external chain remains a closed, actionless recovery state.
        }
        this.dataState = {
            sqliteVersion: workspaceDataRuntimeVersion(),
            status: {
                kind: 'recovery',
                problem: restoreActivationProblem(session),
            },
        };
    }

    private restoreSessionOutcome(
        requestId: string,
        session: ReturnType<RestoreCoordinator['query']>,
    ): WorkspaceSetupOutcome {
        return {
            ok: true,
            value: {
                kind: 'workspace.restore-session',
                protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                appBuildId: this.appBuildId,
                requestId,
                workspaceEpoch: this.workspaceEpoch,
                session,
            },
        };
    }

    private restoreProblem(
        error: unknown,
        requestId: string,
        message: string,
    ): WorkspaceSetupOutcome {
        if (error instanceof RestoreSessionError) {
            if (error.code === 'conflict') {
                return this.problem('conflict', message, requestId);
            }
            if (error.code === 'identity-conflict' || error.code === 'not-found') {
                return this.problem('identity-conflict', message, requestId);
            }
            if (error.code === 'snapshot-incomplete'
                || error.code === 'snapshot-corrupt'
                || error.code === 'incompatible-version'
                || error.code === 'library-safety-unavailable') {
                return this.problem('validation', message, requestId);
            }
        }
        return this.problem('recovery-required', message, requestId);
    }

    /**
     * Coordinates one selected directory through PROTECT, PLATFORM, and DATA.
     * @param {string} requestId - Request correlation identity.
     * @param {SelectedBackupDestinationRequest['command']} command - Path-free PROTECT command.
     * @param {string} selectedDirectoryPath - Main-selected directory path.
     * @return {Promise<WorkspaceSetupOutcome>} Durable receipt or structured unchanged problem.
     */
    private async configureBackupDestination(
        requestId: string,
        command: SelectedBackupDestinationRequest['command'],
        selectedDirectoryPath: string,
    ): Promise<WorkspaceSetupOutcome> {
        const store = this.dataState.store;
        if (!store) {
            const code = this.dataState.status.kind === 'recovery'
                ? 'recovery-required'
                : 'workspace-unavailable';
            return this.problem(code, '当前没有可写入的本地工作区。', requestId);
        }
        if (this.dataState.status.kind === 'read-only') {
            return this.problem('permission', '本地数据为只读，备份目的地未配置。', requestId);
        }
        try {
            const committed = await configureBackupDestination({
                readProtection: () => store.readDataProtectionProjection(),
                readDestinationForCommand: commandId => (
                    store.readBackupConfigurationForCommand(commandId)
                ),
                commit: accepted => store.commit(accepted, this.options.commitOptions),
            }, {
                command,
                selectedDirectoryPath,
                activeDataDirectoryPath: this.dataSlotsRoot,
                libraryRootPath: this.options.libraryRootPath ?? null,
            });
            this.dataState = { ...this.dataState, status: store.status() };
            if (!committed.ok) {
                return this.commitProblem(
                    committed.problem,
                    requestId,
                    '备份目的地未配置，正式数据没有改变。',
                );
            }
            return this.backupConfigurationCommandOutcome(requestId, committed.value);
        }
        catch (error) {
            if (error instanceof CommittedCommandOutcomeUnknownError
                && error.commandId === command.commandId) {
                const receipt = await this.recoverCommittedReceipt(command.commandId);
                if (receipt) {
                    return this.backupConfigurationCommandOutcome(requestId, receipt);
                }
                return this.problem(
                    'recovery-required',
                    '无法确认备份目的地提交结果；请重新打开工作区后查询。',
                    requestId,
                    'unknown',
                );
            }
            if (error instanceof BackupDestinationPreparationError) {
                if (error.reason === 'location-overlap' && error.location !== null) {
                    return this.problem(
                        'validation',
                        '备份目录必须与活动数据和资料库根隔离。',
                        requestId,
                        'unchanged',
                        { reason: 'backup-location-overlap', location: error.location },
                    );
                }
                if (error.reason === 'identity-conflict') {
                    return this.problem(
                        'identity-conflict',
                        '所选目录中的 CourseFlow 仓库身份无效，未进行配置。',
                        requestId,
                    );
                }
                if (error.reason === 'permission') {
                    return this.problem('permission', '所选备份目录不可写，未进行配置。', requestId);
                }
                return this.problem('validation', '所选备份目录无效，未进行配置。', requestId);
            }
            const code = error instanceof TypeError ? 'validation' : 'recovery-required';
            return this.problem(code, '备份目的地未配置，正式数据没有改变。', requestId);
        }
    }

    /**
     * Routes a bounded Meeting series query to DATA and wraps its Workspace outcome.
     * @param {string} requestId - Request correlation identity.
     * @param {string} meetingSeriesId - Stable Meeting series identity.
     * @param {MeetingOccurrenceWindow} requestedWindow - Requested physical-date window.
     * @return {Promise<WorkspaceSetupOutcome>} Query projection or structured problem.
     */
    private async queryMeetingSeries(
        requestId: string,
        meetingSeriesId: MeetingSeriesQueryRequest['meetingSeriesId'],
        requestedWindow: MeetingSeriesQueryRequest['requestedWindow'],
    ): Promise<WorkspaceSetupOutcome> {
        if (!this.dataState.store) {
            const code = this.dataState.status.kind === 'recovery'
                ? 'recovery-required'
                : 'workspace-unavailable';
            return this.problem(code, '当前没有可读取的课节规则数据。', requestId);
        }

        try {
            return {
                ok: true,
                value: {
                    kind: 'workspace.meeting-series-projection',
                    protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                    appBuildId: this.appBuildId,
                    requestId,
                    workspaceEpoch: this.workspaceEpoch,
                    dataMode: this.dataState.status.kind === 'read-only' ? 'read-only' : 'ready',
                    projection: this.dataState.store.readMeetingSeriesDetail(meetingSeriesId, requestedWindow),
                },
            };
        }
        catch (error) {
            const code = error instanceof TypeError ? 'validation' : 'recovery-required';
            return this.problem(code, '无法读取一致的课节规则数据。', requestId);
        }
    }

    /**
     * Routes a bounded Task series query to DATA and wraps its Workspace outcome.
     * @param {string} requestId - Request correlation identity.
     * @param {string} taskSeriesId - Stable Task series identity.
     * @param {TaskSeriesQueryRequest['requestedWindow']} requestedWindow - Requested physical-date window.
     * @return {Promise<WorkspaceSetupOutcome>} Query projection or structured problem.
     */
    private async queryTaskSeries(
        requestId: string,
        taskSeriesId: TaskSeriesQueryRequest['taskSeriesId'],
        requestedWindow: TaskSeriesQueryRequest['requestedWindow'],
    ): Promise<WorkspaceSetupOutcome> {
        if (!this.dataState.store) {
            const code = this.dataState.status.kind === 'recovery'
                ? 'recovery-required'
                : 'workspace-unavailable';
            return this.problem(code, '当前没有可读取的任务规则数据。', requestId);
        }

        try {
            return {
                ok: true,
                value: {
                    kind: 'workspace.task-series-projection',
                    protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                    appBuildId: this.appBuildId,
                    requestId,
                    workspaceEpoch: this.workspaceEpoch,
                    dataMode: this.dataState.status.kind === 'read-only' ? 'read-only' : 'ready',
                    projection: this.dataState.store.readTaskSeriesDetail(taskSeriesId, requestedWindow),
                },
            };
        }
        catch (error) {
            const code = error instanceof TypeError ? 'validation' : 'recovery-required';
            return this.problem(code, '无法读取一致的任务规则数据。', requestId);
        }
    }

    /**
     * Routes a whole-rule Meeting impact draft to the DATA preview owner.
     * @param {string} requestId - Request correlation identity.
     * @param {MeetingOccurrenceImpactDraft} draft - Exact proposed future rule.
     * @return {Promise<WorkspaceSetupOutcome>} Impact projection or structured problem.
     */
    private async previewMeetingOccurrence(
        requestId: string,
        draft: MeetingOccurrenceImpactRequest['draft'],
    ): Promise<WorkspaceSetupOutcome> {
        if (!this.dataState.store) {
            const code = this.dataState.status.kind === 'recovery'
                ? 'recovery-required'
                : 'workspace-unavailable';
            return this.problem(code, '当前没有可读取的课节规则数据。', requestId);
        }

        try {
            return {
                ok: true,
                value: {
                    kind: 'workspace.meeting-occurrence-impact',
                    protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                    appBuildId: this.appBuildId,
                    requestId,
                    workspaceEpoch: this.workspaceEpoch,
                    dataMode: this.dataState.status.kind === 'read-only' ? 'read-only' : 'ready',
                    projection: this.dataState.store.previewMeetingOccurrenceChange(draft),
                },
            };
        }
        catch (error) {
            const code = error instanceof TypeError ? 'validation' : 'recovery-required';
            return this.problem(code, '无法预览课节规则影响。', requestId);
        }
    }

    /**
     * Routes a future Task split/delete draft to the DATA preview owner without committing facts.
     * @param {string} requestId - Request correlation identity.
     * @param {TaskOccurrenceImpactRequest['draft']} draft - Exact future Task change or deletion.
     * @return {Promise<WorkspaceSetupOutcome>} Impact projection or structured problem.
     */
    private async previewTaskOccurrence(
        requestId: string,
        draft: TaskOccurrenceImpactRequest['draft'],
    ): Promise<WorkspaceSetupOutcome> {
        if (!this.dataState.store) {
            const code = this.dataState.status.kind === 'recovery'
                ? 'recovery-required'
                : 'workspace-unavailable';
            return this.problem(code, '当前没有可读取的任务规则数据。', requestId);
        }

        try {
            return {
                ok: true,
                value: {
                    kind: 'workspace.task-occurrence-impact',
                    protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                    appBuildId: this.appBuildId,
                    requestId,
                    workspaceEpoch: this.workspaceEpoch,
                    dataMode: this.dataState.status.kind === 'read-only' ? 'read-only' : 'ready',
                    projection: this.dataState.store.previewTaskOccurrenceChange(draft),
                },
            };
        }
        catch (error) {
            const code = error instanceof TypeError ? 'validation' : 'recovery-required';
            return this.problem(code, '无法预览任务规则影响。', requestId);
        }
    }

    private async reconcileWorkspaceLifecycle(
        requestId: string,
        projection: SetupProjection,
    ): Promise<WorkspaceSetupOutcome | null> {
        const term = projection.currentTerm;
        if (!term || this.dataState.status.kind === 'read-only') {
            return null;
        }

        const evaluatedAt = (this.options.clock ?? SYSTEM_CLOCK).now();
        const applicableDate = localDateInTermZone(evaluatedAt, term.timeZone);
        if (applicableDate <= term.endDate) {
            return null;
        }

        const command = normalizeReconcileWorkspaceLifecycleCommand({
            commandId: randomUUID(),
            followUpId: randomUUID(),
            expectedRevision: projection.workspaceRevision,
            expectedPlanVersion: projection.planEntityVersion,
            expectedTermVersion: term.entityVersion,
            intent: {
                kind: 'workspace.reconcile-lifecycle',
                intentSchemaVersion: 1,
                payload: {
                    termId: term.termId,
                    evaluation: {
                        evaluatedAt,
                        termZone: term.timeZone,
                        applicableDate,
                    },
                },
            },
        });

        try {
            const committed = await this.dataState.store!.commit(command, this.options.commitOptions);
            this.dataState = {
                ...this.dataState,
                status: this.dataState.store!.status(),
            };
            if (!committed.ok) {
                return this.commitProblem(
                    committed.problem,
                    requestId,
                    '学期生命周期未更新，正式数据没有改变。',
                );
            }
            return null;
        }
        catch (error) {
            if (error instanceof CommittedCommandOutcomeUnknownError
                && error.commandId === command.commandId) {
                const receipt = await this.recoverCommittedReceipt(command.commandId);
                if (receipt?.effects[0]?.code === 'plan.term-auto-archived') {
                    return null;
                }
            }
            return this.problem(
                'recovery-required',
                '无法确认学期生命周期提交结果；请重新打开工作区后查询。',
                requestId,
                error instanceof CommittedCommandOutcomeUnknownError ? 'unknown' : 'unchanged',
            );
        }
    }

    private async createTerm(
        requestId: string,
        command: CreateTermRequest['command'],
    ): Promise<WorkspaceSetupOutcome> {
        return this.commitTermCommand(requestId, command, '当前学期未保存，正式数据没有改变。');
    }

    private async updateTermEndDate(
        requestId: string,
        command: UpdateTermEndDateRequest['command'],
    ): Promise<WorkspaceSetupOutcome> {
        return this.commitTermCommand(requestId, command, '学期结束日未更新，正式数据没有改变。');
    }

    private async restoreTermAsCurrent(
        requestId: string,
        command: RestoreTermAsCurrentRequest['command'],
    ): Promise<WorkspaceSetupOutcome> {
        if (!this.dataState.store) {
            const code = this.dataState.status.kind === 'recovery'
                ? 'recovery-required'
                : 'workspace-unavailable';
            return this.problem(code, '当前没有可写入的本地工作区。', requestId);
        }

        try {
            const projection = this.dataState.store.readSetupProjection();
            const term = projection.terms.find(candidate => (
                candidate.termId === command.intent.payload.termId
            ));
            if (!term) {
                return this.problem('validation', '要恢复的学期不存在，正式数据没有改变。', requestId);
            }
            const evaluatedAt = (this.options.clock ?? SYSTEM_CLOCK).now();
            const resolvedCommand = normalizeRestoreTermAsCurrentCommand({
                ...command,
                evaluation: {
                    evaluatedAt,
                    termZone: term.timeZone,
                    applicableDate: localDateInTermZone(evaluatedAt, term.timeZone),
                },
            });
            return this.commitTermCommand(
                requestId,
                resolvedCommand,
                '学期未恢复为当前学期，正式数据没有改变。',
            );
        }
        catch (error) {
            const code = error instanceof TypeError ? 'validation' : 'recovery-required';
            return this.problem(code, '学期未恢复为当前学期，正式数据没有改变。', requestId);
        }
    }

    private async commitTermCommand(
        requestId: string,
        command:
            | CreateTermRequest['command']
            | UpdateTermEndDateRequest['command']
            | RestoreTermAsCurrentCommand,
        unchangedMessage: string,
    ): Promise<WorkspaceSetupOutcome> {
        if (!this.dataState.store) {
            const code = this.dataState.status.kind === 'recovery'
                ? 'recovery-required'
                : 'workspace-unavailable';
            return this.problem(code, '当前没有可写入的本地工作区。', requestId);
        }

        try {
            const committed = await this.dataState.store.commit(command, this.options.commitOptions);
            this.dataState = {
                ...this.dataState,
                status: this.dataState.store.status(),
            };
            if (!committed.ok) {
                return this.commitProblem(committed.problem, requestId, unchangedMessage);
            }
            return this.termCommandOutcome(requestId, committed.value);
        }
        catch (error) {
            if (error instanceof CommittedCommandOutcomeUnknownError
                && error.commandId === command.commandId) {
                const receipt = await this.recoverCommittedReceipt(command.commandId);
                if (receipt) {
                    return this.termCommandOutcome(requestId, receipt);
                }
                return this.problem(
                    'recovery-required',
                    '提交结果无法从持久回执确认；请重新打开工作区后查询。',
                    requestId,
                    'unknown',
                );
            }
            const code = error instanceof TypeError ? 'validation' : 'recovery-required';
            return this.problem(code, unchangedMessage, requestId);
        }
    }

    /**
     * Commits one HolidayRange transition through DATA and preserves receipt recovery.
     * @param {string} requestId - Workspace request correlation identity.
     * @param {CreateHolidayRangeCommand | UpdateHolidayRangeCommand | DeleteHolidayRangeCommand} command
     *     - Normalized HolidayRange command.
     * @return {Promise<WorkspaceSetupOutcome>} Committed result, warning, or structured problem.
     */
    private async commitHolidayRange(
        requestId: string,
        command:
            | CreateHolidayRangeRequest['command']
            | UpdateHolidayRangeRequest['command']
            | DeleteHolidayRangeRequest['command'],
    ): Promise<WorkspaceSetupOutcome> {
        if (!this.dataState.store) {
            const code = this.dataState.status.kind === 'recovery'
                ? 'recovery-required'
                : 'workspace-unavailable';
            return this.problem(code, '当前没有可写入的本地工作区。', requestId);
        }
        const expectedEffect = command.intent.kind === 'plan.create-holiday-range'
            ? 'plan.holiday-range-created' as const
            : command.intent.kind === 'plan.update-holiday-range'
                ? 'plan.holiday-range-updated' as const
                : 'plan.holiday-range-deleted' as const;

        try {
            const committed = await this.dataState.store.commit(command, this.options.commitOptions);
            this.dataState = {
                ...this.dataState,
                status: this.dataState.store.status(),
            };
            if (!committed.ok) {
                return this.commitProblem(
                    committed.problem,
                    requestId,
                    '假期范围未更改，正式数据没有改变。',
                    '假期变更会恢复有时间冲突的课节；确认继续后可保存。',
                );
            }
            return this.holidayRangeCommandOutcome(requestId, committed.value, expectedEffect);
        }
        catch (error) {
            if (error instanceof CommittedCommandOutcomeUnknownError
                && error.commandId === command.commandId) {
                const receipt = await this.recoverCommittedReceipt(command.commandId);
                if (receipt) {
                    return this.holidayRangeCommandOutcome(requestId, receipt, expectedEffect);
                }
                return this.problem(
                    'recovery-required',
                    '提交结果无法从持久回执确认；请重新打开工作区后查询。',
                    requestId,
                    'unknown',
                );
            }
            const code = error instanceof TypeError ? 'validation' : 'recovery-required';
            return this.problem(code, '假期范围未更改，正式数据没有改变。', requestId);
        }
    }

    /**
     * Commits one bounded one-time Task transition and recovers uncertain receipts.
     * @param {string} requestId - Workspace request correlation identity.
     * @param {CreateTaskRequest['command'] | UpdateTaskRequest['command']
     *     | DeleteTaskRequest['command'] | CompleteTaskRequest['command']
     *     | SetTaskOccurrenceStatusRequest['command'] | SetTaskProgressRequest['command']
     *     | ChangeTaskOccurrenceRequest['command'] | DeleteTaskOccurrenceOrSeriesRequest['command']
     *     | UndoTaskOccurrenceStateRequest['command']} command - Task command.
     * @return {Promise<WorkspaceSetupOutcome>} Committed result or structured problem.
     */
    private async commitTask(
        requestId: string,
        command:
            | CreateTaskRequest['command']
            | UpdateTaskRequest['command']
            | DeleteTaskRequest['command']
            | CompleteTaskRequest['command']
            | SetTaskOccurrenceStatusRequest['command']
            | SetTaskProgressRequest['command']
            | ChangeTaskOccurrenceRequest['command']
            | DeleteTaskOccurrenceOrSeriesRequest['command']
            | UndoTaskOccurrenceStateRequest['command'],
    ): Promise<WorkspaceSetupOutcome> {
        if (!this.dataState.store) {
            const code = this.dataState.status.kind === 'recovery'
                ? 'recovery-required'
                : 'workspace-unavailable';
            return this.problem(code, '当前没有可写入的本地工作区。', requestId);
        }
        const expectedEffect = command.intent.kind === 'plan.create-task-series'
            ? 'plan.task-series-created' as const
            : command.intent.kind === 'plan.update-task-series'
                ? 'plan.task-series-updated' as const
                : command.intent.kind === 'plan.delete-task-series'
                    ? 'plan.task-series-deleted' as const
                    : command.intent.kind === 'plan.set-task-progress'
                        ? 'plan.task-progress-set' as const
                        : command.intent.kind === 'plan.change-task-occurrence'
                            ? 'plan.task-occurrence-changed' as const
                        : command.intent.kind === 'plan.delete-task-occurrence-or-series'
                                ? command.intent.payload.scope === 'whole-series'
                                    ? 'plan.task-series-deleted' as const
                                    : 'plan.task-occurrence-deleted' as const
                                : command.intent.kind === 'plan.undo-task-occurrence-state'
                                    ? 'plan.task-occurrence-state-undone' as const
                                    : command.intent.intentSchemaVersion === 1
                                        ? 'plan.task-occurrence-completed' as const
                                        : 'plan.task-occurrence-status-set' as const;

        try {
            const committed = await this.dataState.store.commit(command, this.options.commitOptions);
            this.dataState = {
                ...this.dataState,
                status: this.dataState.store.status(),
            };
            if (!committed.ok) {
                return this.commitProblem(
                    committed.problem,
                    requestId,
                    '任务未更改，正式数据没有改变。',
                );
            }
            return this.taskCommandOutcome(requestId, committed.value, expectedEffect);
        }
        catch (error) {
            if (error instanceof CommittedCommandOutcomeUnknownError
                && error.commandId === command.commandId) {
                const receipt = await this.recoverCommittedReceipt(command.commandId);
                if (receipt) {
                    return this.taskCommandOutcome(requestId, receipt, expectedEffect);
                }
                return this.problem(
                    'recovery-required',
                    '提交结果无法从持久回执确认；请重新打开工作区后查询。',
                    requestId,
                    'unknown',
                );
            }
            const code = error instanceof TypeError ? 'validation' : 'recovery-required';
            return this.problem(code, '任务未更改，正式数据没有改变。', requestId);
        }
    }

    private async createCourse(
        requestId: string,
        command: CreateCourseRequest['command'],
    ): Promise<WorkspaceSetupOutcome> {
        if (!this.dataState.store) {
            const code = this.dataState.status.kind === 'recovery'
                ? 'recovery-required'
                : 'workspace-unavailable';
            return this.problem(code, '当前没有可写入的本地工作区。', requestId);
        }
        try {
            const committed = await this.dataState.store.commit(command, this.options.commitOptions);
            this.dataState = { ...this.dataState, status: this.dataState.store.status() };
            if (!committed.ok) {
                return this.commitProblem(committed.problem, requestId, '课程未保存，正式数据没有改变。');
            }
            return this.singleCreationCommandOutcome(
                requestId,
                committed.value,
                'plan.course-created',
                'course',
            );
        }
        catch (error) {
            if (error instanceof CommittedCommandOutcomeUnknownError
                && error.commandId === command.commandId) {
                const receipt = await this.recoverCommittedReceipt(command.commandId);
                if (receipt) {
                    return this.singleCreationCommandOutcome(
                        requestId,
                        receipt,
                        'plan.course-created',
                        'course',
                    );
                }
                return this.problem(
                    'recovery-required',
                    '提交结果无法从持久回执确认；请重新打开工作区后查询。',
                    requestId,
                    'unknown',
                );
            }
            const code = error instanceof TypeError ? 'validation' : 'recovery-required';
            return this.problem(code, '课程未保存，正式数据没有改变。', requestId);
        }
    }

    private async createMeetingSeries(
        requestId: string,
        command: CreateMeetingSeriesRequest['command'],
    ): Promise<WorkspaceSetupOutcome> {
        if (!this.dataState.store) {
            const code = this.dataState.status.kind === 'recovery'
                ? 'recovery-required'
                : 'workspace-unavailable';
            return this.problem(code, '当前没有可写入的本地工作区。', requestId);
        }
        try {
            const committed = await this.dataState.store.commit(command, this.options.commitOptions);
            this.dataState = { ...this.dataState, status: this.dataState.store.status() };
            if (!committed.ok) {
                return this.commitProblem(
                    committed.problem,
                    requestId,
                    '课节未保存，正式数据没有改变。',
                    '检测到课节时间重叠；确认继续后可按原时间保存。',
                );
            }
            return this.singleCreationCommandOutcome(
                requestId,
                committed.value,
                'plan.meeting-series-created',
                'meeting-series',
            );
        }
        catch (error) {
            if (error instanceof CommittedCommandOutcomeUnknownError
                && error.commandId === command.commandId) {
                const receipt = await this.recoverCommittedReceipt(command.commandId);
                if (receipt) {
                    return this.singleCreationCommandOutcome(
                        requestId,
                        receipt,
                        'plan.meeting-series-created',
                        'meeting-series',
                    );
                }
                return this.problem(
                    'recovery-required',
                    '提交结果无法从持久回执确认；请重新打开工作区后查询。',
                    requestId,
                    'unknown',
                );
            }
            const code = error instanceof TypeError ? 'validation' : 'recovery-required';
            return this.problem(code, '课节未保存，正式数据没有改变。', requestId);
        }
    }

    private async createCourseWithMeeting(
        requestId: string,
        command: CreateCourseWithMeetingRequest['command'],
    ): Promise<WorkspaceSetupOutcome> {
        if (!this.dataState.store) {
            const code = this.dataState.status.kind === 'recovery'
                ? 'recovery-required'
                : 'workspace-unavailable';
            return this.problem(code, '当前没有可写入的本地工作区。', requestId);
        }

        try {
            const committed = await this.dataState.store.commit(command, this.options.commitOptions);
            this.dataState = {
                ...this.dataState,
                status: this.dataState.store.status(),
            };
            if (!committed.ok) {
                return this.commitProblem(
                    committed.problem,
                    requestId,
                    '课程与首个课节未保存，正式数据没有改变。',
                    '检测到课节时间重叠；确认继续后可按原时间保存。',
                );
            }
            return this.courseCommandOutcome(requestId, committed.value);
        }
        catch (error) {
            if (error instanceof CommittedCommandOutcomeUnknownError
                && error.commandId === command.commandId) {
                const receipt = await this.recoverCommittedReceipt(command.commandId);
                if (receipt) {
                    return this.courseCommandOutcome(requestId, receipt);
                }
                return this.problem(
                    'recovery-required',
                    '提交结果无法从持久回执确认；请重新打开工作区后查询。',
                    requestId,
                    'unknown',
                );
            }
            const code = error instanceof TypeError ? 'validation' : 'recovery-required';
            return this.problem(code, '课程与首个课节未保存，正式数据没有改变。', requestId);
        }
    }

    /**
     * Commits a scoped Meeting occurrence mutation and preserves receipt recovery semantics.
     * @param {string} requestId - Request correlation identity.
     * @param {ChangeMeetingOccurrenceCommand | CancelMeetingOccurrenceCommand} command - Versioned mutation.
     * @return {Promise<WorkspaceSetupOutcome>} Committed outcome or structured problem.
     */
    private async commitMeetingOccurrence(
        requestId: string,
        command: ChangeMeetingOccurrenceRequest['command'] | CancelMeetingOccurrenceRequest['command'],
    ): Promise<WorkspaceSetupOutcome> {
        if (!this.dataState.store) {
            const code = this.dataState.status.kind === 'recovery'
                ? 'recovery-required'
                : 'workspace-unavailable';
            return this.problem(code, '当前没有可写入的本地工作区。', requestId);
        }
        const expectedEffect = command.intent.kind === 'plan.cancel-meeting-occurrence'
            ? 'plan.meeting-occurrence-cancelled'
            : 'plan.meeting-occurrence-changed';

        try {
            const committed = await this.dataState.store.commit(command, this.options.commitOptions);
            this.dataState = {
                ...this.dataState,
                status: this.dataState.store.status(),
            };
            if (!committed.ok) {
                return this.commitProblem(
                    committed.problem,
                    requestId,
                    '课节实例未更改，正式数据没有改变。',
                    '检测到课节时间重叠；确认继续后可按原时间保存。',
                );
            }
            return this.meetingOccurrenceCommandOutcome(requestId, committed.value, expectedEffect);
        }
        catch (error) {
            if (error instanceof CommittedCommandOutcomeUnknownError
                && error.commandId === command.commandId) {
                const receipt = await this.recoverCommittedReceipt(command.commandId);
                if (receipt) {
                    return this.meetingOccurrenceCommandOutcome(requestId, receipt, expectedEffect);
                }
                return this.problem(
                    'recovery-required',
                    '提交结果无法从持久回执确认；请重新打开工作区后查询。',
                    requestId,
                    'unknown',
                );
            }
            const code = error instanceof TypeError ? 'validation' : 'recovery-required';
            return this.problem(code, '课节实例未更改，正式数据没有改变。', requestId);
        }
    }

    private async recoverCommittedReceipt(commandId: string): Promise<CommandReceiptOutcome | null> {
        try {
            const reopened = await openWorkspaceDataWithMigrations(
                this.dataSlotsRoot,
                migrationOpenOptions(this.appBuildId, this.options),
            );
            this.dataState = dataStateFrom(reopened);
            return this.dataState.store?.receipt(commandId) ?? null;
        }
        catch {
            return null;
        }
    }

    private backupConfigurationCommandOutcome(
        requestId: string,
        committed: CommandReceiptOutcome,
    ): WorkspaceSetupOutcome {
        const effect = committed.effects[0];
        if (committed.effects.length !== 1
            || effect.code !== 'protect.backup-destination-configured'
            || effect.entity.kind !== 'backup-configuration') {
            return this.problem(
                'recovery-required',
                '命令回执与备份配置事实不一致。',
                requestId,
                'unknown',
            );
        }
        const outcome: WorkspaceCommandResult = {
            kind: 'committed',
            revision: committed.revision,
            effects: [{
                code: 'protect.backup-destination-configured',
                entity: {
                    kind: 'backup-configuration',
                    id: effect.entity.id,
                    version: effect.entity.version,
                },
            }],
            pendingFollowUps: [committed.pendingFollowUps[0]],
        };
        return {
            ok: true,
            value: {
                kind: 'workspace.command-outcome',
                protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                appBuildId: this.appBuildId,
                requestId,
                workspaceEpoch: this.workspaceEpoch,
                outcome,
            },
        };
    }

    private termCommandOutcome(
        requestId: string,
        committed: CommandReceiptOutcome,
    ): WorkspaceSetupOutcome {
        const effect = committed.effects[0];
        if (committed.effects.length !== 1
            || (effect.code !== 'plan.term-created-current'
                && effect.code !== 'plan.term-end-date-updated'
                && effect.code !== 'plan.term-restored-current')
            || effect.entity.kind !== 'term') {
            return this.problem(
                'recovery-required',
                '命令回执与学期事实不一致。',
                requestId,
                'unknown',
            );
        }
        const outcome: WorkspaceCommandResult = {
            kind: 'committed',
            revision: committed.revision,
            effects: [{
                code: effect.code,
                entity: {
                    kind: effect.entity.kind,
                    id: effect.entity.id,
                    version: effect.entity.version,
                },
            }],
            pendingFollowUps: [committed.pendingFollowUps[0]],
        };
        return {
            ok: true,
            value: {
                kind: 'workspace.command-outcome',
                protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                appBuildId: this.appBuildId,
                requestId,
                workspaceEpoch: this.workspaceEpoch,
                outcome,
            },
        };
    }

    /**
     * Maps one exact durable HolidayRange effect into the Workspace command outcome.
     * @param {string} requestId - Workspace request correlation identity.
     * @param {CommandReceiptOutcome} committed - Durable DATA receipt outcome.
     * @param {string} expectedEffect - Exact lifecycle effect required by the request.
     * @return {WorkspaceSetupOutcome} Validated command outcome or recovery problem.
     */
    private holidayRangeCommandOutcome(
        requestId: string,
        committed: CommandReceiptOutcome,
        expectedEffect:
            | 'plan.holiday-range-created'
            | 'plan.holiday-range-updated'
            | 'plan.holiday-range-deleted',
    ): WorkspaceSetupOutcome {
        const effect = committed.effects[0];
        if (committed.effects.length !== 1
            || effect.code !== expectedEffect
            || effect.entity.kind !== 'holiday-range') {
            return this.problem(
                'recovery-required',
                '命令回执与假期范围事实不一致。',
                requestId,
                'unknown',
            );
        }
        const outcome: WorkspaceCommandResult = {
            kind: 'committed',
            revision: committed.revision,
            effects: [{
                code: effect.code,
                entity: {
                    kind: 'holiday-range',
                    id: effect.entity.id,
                    version: effect.entity.version,
                },
            }],
            pendingFollowUps: [committed.pendingFollowUps[0]],
        };
        return {
            ok: true,
            value: {
                kind: 'workspace.command-outcome',
                protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                appBuildId: this.appBuildId,
                requestId,
                workspaceEpoch: this.workspaceEpoch,
                outcome,
            },
        };
    }

    /**
     * Maps one exact durable Task effect into the Workspace command outcome.
     * @param {string} requestId - Workspace request correlation identity.
     * @param {CommandReceiptOutcome} committed - Durable DATA receipt outcome.
     * @param {string} expectedEffect - Exact Task effect required by the request.
     * @return {WorkspaceSetupOutcome} Validated command outcome or recovery problem.
     */
    private taskCommandOutcome(
        requestId: string,
        committed: CommandReceiptOutcome,
        expectedEffect:
            | 'plan.task-series-created'
            | 'plan.task-series-updated'
            | 'plan.task-series-deleted'
            | 'plan.task-occurrence-completed'
            | 'plan.task-occurrence-status-set'
            | 'plan.task-progress-set'
            | 'plan.task-occurrence-changed'
            | 'plan.task-occurrence-deleted'
            | 'plan.task-occurrence-state-undone',
    ): WorkspaceSetupOutcome {
        const effect = committed.effects[0];
        if (committed.effects.length !== 1
            || effect.code !== expectedEffect
            || effect.entity.kind !== 'task-series') {
            return this.problem(
                'recovery-required',
                '命令回执与任务事实不一致。',
                requestId,
                'unknown',
            );
        }
        const outcome: WorkspaceCommandResult = {
            kind: 'committed',
            revision: committed.revision,
            effects: [{
                code: effect.code,
                entity: {
                    kind: 'task-series',
                    id: effect.entity.id,
                    version: effect.entity.version,
                },
            }],
            pendingFollowUps: [committed.pendingFollowUps[0]],
            ...(committed.undoCapability === undefined
                ? {}
                : { undoCapability: committed.undoCapability }),
        };
        return {
            ok: true,
            value: {
                kind: 'workspace.command-outcome',
                protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                appBuildId: this.appBuildId,
                requestId,
                workspaceEpoch: this.workspaceEpoch,
                outcome,
            },
        };
    }

    private singleCreationCommandOutcome(
        requestId: string,
        committed: CommandReceiptOutcome,
        expectedEffect: 'plan.course-created' | 'plan.meeting-series-created',
        expectedEntityKind: 'course' | 'meeting-series',
    ): WorkspaceSetupOutcome {
        const effect = committed.effects[0];
        if (committed.effects.length !== 1
            || effect.code !== expectedEffect
            || effect.entity.kind !== expectedEntityKind) {
            return this.problem(
                'recovery-required',
                '命令回执与课程或课节事实不一致。',
                requestId,
                'unknown',
            );
        }
        const outcome: WorkspaceCommandResult = {
            kind: 'committed',
            revision: committed.revision,
            effects: [{
                code: expectedEffect,
                entity: {
                    kind: expectedEntityKind,
                    id: effect.entity.id,
                    version: effect.entity.version,
                },
            }],
            pendingFollowUps: [committed.pendingFollowUps[0]],
        };
        return {
            ok: true,
            value: {
                kind: 'workspace.command-outcome',
                protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                appBuildId: this.appBuildId,
                requestId,
                workspaceEpoch: this.workspaceEpoch,
                outcome,
            },
        };
    }

    private courseCommandOutcome(
        requestId: string,
        committed: CommandReceiptOutcome,
    ): WorkspaceSetupOutcome {
        const courseEffect = committed.effects[0];
        const meetingEffect = committed.effects[1];
        if (committed.effects.length !== 2
            || courseEffect.code !== 'plan.course-created'
            || courseEffect.entity.kind !== 'course'
            || meetingEffect.code !== 'plan.meeting-series-created'
            || meetingEffect.entity.kind !== 'meeting-series') {
            return this.problem(
                'recovery-required',
                '命令回执与课程事实不一致。',
                requestId,
                'unknown',
            );
        }
        const outcome: WorkspaceCommandResult = {
            kind: 'committed',
            revision: committed.revision,
            effects: [
                {
                    code: courseEffect.code,
                    entity: {
                        kind: 'course',
                        id: courseEffect.entity.id,
                        version: courseEffect.entity.version,
                    },
                },
                {
                    code: meetingEffect.code,
                    entity: {
                        kind: 'meeting-series',
                        id: meetingEffect.entity.id,
                        version: meetingEffect.entity.version,
                    },
                },
            ],
            pendingFollowUps: [committed.pendingFollowUps[0]],
        };
        return {
            ok: true,
            value: {
                kind: 'workspace.command-outcome',
                protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                appBuildId: this.appBuildId,
                requestId,
                workspaceEpoch: this.workspaceEpoch,
                outcome,
            },
        };
    }

    /**
     * Validates and maps a durable Meeting occurrence receipt into the Workspace contract.
     * @param {string} requestId - Request correlation identity.
     * @param {CommandReceiptOutcome} committed - Durable DATA receipt outcome.
     * @param {'plan.meeting-occurrence-changed' | 'plan.meeting-occurrence-cancelled'} expectedEffect - Intent effect.
     * @return {WorkspaceSetupOutcome} Exact Workspace command outcome or recovery problem.
     */
    private meetingOccurrenceCommandOutcome(
        requestId: string,
        committed: CommandReceiptOutcome,
        expectedEffect: 'plan.meeting-occurrence-changed' | 'plan.meeting-occurrence-cancelled',
    ): WorkspaceSetupOutcome {
        const effect = committed.effects[0];
        if (committed.effects.length !== 1
            || effect.code !== expectedEffect
            || effect.entity.kind !== 'meeting-series') {
            return this.problem(
                'recovery-required',
                '命令回执与课节实例事实不一致。',
                requestId,
                'unknown',
            );
        }
        const outcome: WorkspaceCommandResult = {
            kind: 'committed',
            revision: committed.revision,
            effects: [{
                code: effect.code,
                entity: {
                    kind: 'meeting-series',
                    id: effect.entity.id,
                    version: effect.entity.version,
                },
            }],
            pendingFollowUps: [committed.pendingFollowUps[0]],
        };
        return {
            ok: true,
            value: {
                kind: 'workspace.command-outcome',
                protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                appBuildId: this.appBuildId,
                requestId,
                workspaceEpoch: this.workspaceEpoch,
                outcome,
            },
        };
    }

    /**
     * Preserves DATA commit semantics at the Workspace boundary.
     * @param {DataCommitProblem} problem - DATA-owned stable commit problem.
     * @param {string} requestId - Workspace request correlation identity.
     * @param {string} unchangedMessage - Domain message for an unchanged write.
     * @param {string} overlapMessage - Optional domain message for Meeting overlap.
     * @return {WorkspaceSetupOutcome} Workspace-owned structured problem.
     */
    private commitProblem(
        problem: DataCommitProblem,
        requestId: string,
        unchangedMessage: string,
        overlapMessage?: string,
    ): WorkspaceSetupOutcome {
        if (problem.code === 'decision-required'
            && problem.details.reason === 'meeting-time-overlap'
            && overlapMessage !== undefined) {
            return this.problem(
                'decision-required',
                overlapMessage,
                requestId,
                'unchanged',
                problem.details,
            );
        }
        if (problem.code === 'operation-in-progress') {
            return this.problem(
                'operation-in-progress',
                '另一个写入正在完成；请重试，正式数据没有改变。',
                requestId,
                'unchanged',
                problem.details,
            );
        }
        return this.problem(problem.code, unchangedMessage, requestId);
    }

    private problem(
        code: WorkspaceSetupProblemCode,
        message: string,
        requestId: string | null,
        dataEffect: 'unchanged' | 'unknown' = 'unchanged',
        details?: NonNullable<WorkspaceSetupProblem['details']>,
    ): WorkspaceSetupOutcome {
        return {
            ok: false,
            problem: {
                code,
                message,
                requestId,
                appBuildId: this.appBuildId,
                workspaceEpoch: this.workspaceEpoch,
                dataEffect,
                ...(details === undefined ? {} : { details }),
            },
        };
    }
}
