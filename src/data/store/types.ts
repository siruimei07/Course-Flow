import type { MigrationSafetyCopyBuildBindingV1, MigrationSafetyCopyFailpoint } from '../migration-safety-copy';
import type { WorkspaceDataCommand } from './guards';
import type { MeetingOverlapWarning } from '../../shared/workspace-course-contract';
import type { AcceptedConfigureBackupDestinationCommand } from '../../shared/workspace-protection-contract';
import type { TaskUndoCapability } from '../../shared/workspace-task-contract';

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
        details: Readonly<{ actualSchemaLevel: number; requiredSchemaLevel: 17 }>;
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

export type WorkspaceDataStatus =
    | Readonly<{
        kind: 'ready';
        workspaceId: string;
        schemaLevel: 17;
        revision: string;
    }>
    | Readonly<{
        kind: 'read-only';
        workspaceId: string;
        schemaLevel: 17;
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

export type ReceiptEffect = Readonly<{
    code:
        | 'workspace.setup-decision-recorded'
        | 'plan.term-created-current'
        | 'plan.term-auto-archived'
        | 'plan.term-end-date-updated'
        | 'plan.term-restored-current'
        | 'plan.current-term-reset'
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

export type ConflictReason = 'command-id-reused' | 'expected-revision' | 'expected-entity-version';

export type ConflictProblem = Readonly<{
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

export type WriterBusyProblem = Readonly<{
    code: 'operation-in-progress';
    scope: 'operation';
    dataEffect: 'unchanged';
    affectedCapabilities: readonly ['workspace.write'];
    allowedActions: readonly ['retry'];
    context: Readonly<{ revision: string }>;
    details: Readonly<{ reason: 'writer-busy' }>;
}>;

export type PermissionCommitProblem = Readonly<{
    code: 'permission';
    scope: 'workspace';
    dataEffect: 'unchanged';
    affectedCapabilities: readonly ['workspace.write'];
    allowedActions: readonly [];
    context: Readonly<{ revision: string }>;
    details: Readonly<{ reason: 'read-only' }>;
}>;

export type DecisionRequiredProblem =
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

export type CommitWork = {
    kind: 'commit';
    command: WorkspaceDataCommand;
    options: CommitOptions;
    resolve: (result: DataCommitResult) => void;
    reject: (error: unknown) => void;
};

export type SetupDraftWork = {
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

export type StoreWriteWork = CommitWork | SetupDraftWork;

export const COMMIT_QUEUE_CAPACITY = 64;

export const SQLITE_INTEGER_MAX = 9223372036854775807n;
