import type { WorkspaceDataStatus } from '../shared/bootstrap-contract';
import type { MigrationRollbackTargetV1 } from '../data/sqlite-data-store';
import type { SqliteDataStore } from '../data/store/kernel';
import type { DataOpenResult } from '../data/store/open';
import type { CommitOptions, DataCommitResult, OpenWorkspaceDataOptions, ReadSnapshotOptions } from '../data/store/types';
import { DurableBackupCoordinator } from '../protect/durable-backup';
import type { DurableBackupPassOptions } from '../protect/durable-backup';
import type { MigrationRollbackBootState } from '../protect/migration-rollback-handoff';
import type { PreparedMigrationRollbackPreview } from '../protect/migration-rollback-session';
import { RestoreCoordinator } from '../protect/restore-session';
import type { WorkspaceStartupInspection } from '../protect/workspace-startup';
import type { MigrationRollbackBindingProjection } from '../shared/workspace-migration-contract';
import type { WorkspaceLifecycleInput } from './lifecycle';
export interface ClockPort {
    now(): string;
}

export const SYSTEM_CLOCK: ClockPort = {
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

export type WorkspaceDataState = Readonly<{
    sqliteVersion: string;
    status: WorkspaceDataStatus;
    store?: SqliteDataStore;
}>;

export type DataCommitProblem = Extract<DataCommitResult, { ok: false }>['problem'];

export function dataStateFrom(opened: DataOpenResult): WorkspaceDataState {
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

export function migrationOpenOptions(
    appBuildId: string,
    options: WorkspaceApplicationOptions,
): OpenWorkspaceDataOptions {
    return Object.freeze({
        readOnly: options.readOnly,
        migrationFailpoint: options.migrationFailpoint,
        migrationSafetyCopy: Object.freeze({
            createdByAppBuildId: appBuildId,
            rollbackTarget: options.migrationRollbackTarget ?? null,
            clock: options.clock,
        }),
    });
}

/**
 * Mutable-state port the Workspace application hands to its extracted request units.
 */
export type WorkspaceHost = Readonly<{
    appBuildId: string;
    dataSlotsRoot: string;
    options: WorkspaceApplicationOptions;
    startupInspection: WorkspaceStartupInspection | null;
    dataState(): WorkspaceDataState;
    setDataState(next: WorkspaceDataState): void;
    backupCoordinator(): DurableBackupCoordinator | undefined;
    setBackupCoordinator(next: DurableBackupCoordinator | undefined): void;
    restoreCoordinator(): RestoreCoordinator | undefined;
    setRestoreCoordinator(next: RestoreCoordinator | undefined): void;
    latestRestoreSession(): ReturnType<RestoreCoordinator['query']> | null;
    setLatestRestoreSession(next: ReturnType<RestoreCoordinator['query']> | null): void;
    restoreMaintenance(): boolean;
    setRestoreMaintenance(next: boolean): void;
    migrationMaintenance(): boolean;
    setMigrationMaintenance(next: boolean): void;
    migrationRequestInFlight(): boolean;
    setMigrationRequestInFlight(next: boolean): void;
    migrationRollbackBoot(): MigrationRollbackBootState | null;
    setMigrationRollbackBoot(next: MigrationRollbackBootState | null): void;
    migrationRollbackBinding(): MigrationRollbackBindingProjection | null;
    setMigrationRollbackBinding(next: MigrationRollbackBindingProjection | null): void;
    preparedMigrationRollback(): PreparedMigrationRollbackPreview | null;
    setPreparedMigrationRollback(next: PreparedMigrationRollbackPreview | null): void;
    workspaceEpoch(): string;
    setWorkspaceEpoch(next: string): void;
}>;
