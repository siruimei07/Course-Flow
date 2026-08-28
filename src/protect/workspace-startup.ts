/**
 * @file Composes the read-only PROTECT gate required before ordinary Workspace DATA open.
 */

import {
    inspectMigrationRollbackBeforeWorkspaceOpen,
    type MigrationRollbackBootState,
} from './migration-rollback-handoff';
import {
    inspectRestoreBeforeWorkspaceOpen,
    type RestoreBootState,
} from './restore-activation';

export type WorkspaceStartupInspection = Readonly<{
    kind: 'ordinary' | 'maintenance' | 'recovery-required';
    reason: 'none' | 'restore' | 'migration-rollback' | 'ambiguous-operations' | 'evidence';
    restore: RestoreBootState;
    migrationRollback: MigrationRollbackBootState;
}>;

function restoreIsNonterminal(restore: RestoreBootState): boolean {
    return restore.kind === 'pre-checkpoint-session' || restore.kind === 'recovery-required';
}

function restoreRequiresMaintenance(restore: RestoreBootState): boolean {
    return restore.kind === 'pre-checkpoint-session'
        && restore.session?.phase === 'protection-established';
}

function migrationIsNonterminal(migration: MigrationRollbackBootState): boolean {
    return migration.kind === 'maintenance' || migration.kind === 'recovery-required';
}

/**
 * Classifies existing path-free owner results without interpreting physical phases in Workspace.
 * @param {RestoreBootState} restore Existing Restore startup result.
 * @param {MigrationRollbackBootState} migrationRollback Existing rollback startup result.
 * @return {WorkspaceStartupInspection} Unified ordinary, maintenance, or recovery gate.
 */
export function classifyWorkspaceStartupInspection(
    restore: RestoreBootState,
    migrationRollback: MigrationRollbackBootState,
): WorkspaceStartupInspection {
    if (restoreIsNonterminal(restore) && migrationIsNonterminal(migrationRollback)) {
        return Object.freeze({
            kind: 'recovery-required' as const,
            reason: 'ambiguous-operations' as const,
            restore,
            migrationRollback,
        });
    }
    if (restore.kind === 'recovery-required' || migrationRollback.kind === 'recovery-required') {
        return Object.freeze({
            kind: 'recovery-required' as const,
            reason: 'evidence' as const,
            restore,
            migrationRollback,
        });
    }
    if (restoreRequiresMaintenance(restore)) {
        return Object.freeze({
            kind: 'maintenance' as const,
            reason: 'restore' as const,
            restore,
            migrationRollback,
        });
    }
    if (migrationRollback.kind === 'maintenance') {
        return Object.freeze({
            kind: 'maintenance' as const,
            reason: 'migration-rollback' as const,
            restore,
            migrationRollback,
        });
    }
    return Object.freeze({
        kind: 'ordinary' as const,
        reason: 'none' as const,
        restore,
        migrationRollback,
    });
}

/**
 * Performs the single PROTECT-owned inspection required before Workspace DATA open.
 * Existing inspectors may append proof-only observations or completion records; this
 * function never invokes a physical continue, rollback, or cancel action.
 * @param {string} activityControlRoot Stable ActivityControlRoot.
 * @param {string} dataSlotsRoot Trusted DataSlots root.
 * @param {string} appBuildId Exact current application build.
 * @return {WorkspaceStartupInspection} Unified startup gate and owner states.
 */
export function inspectBeforeWorkspaceOpen(
    activityControlRoot: string,
    dataSlotsRoot: string,
    appBuildId: string,
): WorkspaceStartupInspection {
    const restore = inspectRestoreBeforeWorkspaceOpen(activityControlRoot, dataSlotsRoot);
    const migrationRollback = inspectMigrationRollbackBeforeWorkspaceOpen(
        activityControlRoot,
        dataSlotsRoot,
        appBuildId,
    );
    return classifyWorkspaceStartupInspection(restore, migrationRollback);
}
