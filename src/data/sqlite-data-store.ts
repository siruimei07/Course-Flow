/**
 * @file Public surface of the MOD-DATA SQLite store: types, kernel, and open/initialize entry points.
 */

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

export { type SqliteDataStore } from './store/kernel';
export {
    type DataOpenResult,
    inspectRestoreDataSlot,
    inspectRestoreCompletionReceipt,
    initializeWorkspaceData,
    openWorkspaceData,
    openWorkspaceDataWithMigrations,
} from './store/open';
