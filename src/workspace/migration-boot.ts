/**
 * Reads the current rollback kernel state without opening ordinary DATA.
 * @return {MigrationRollbackBootState} Fresh boot classification.
 */
import { inspectMigrationSafetyCopy } from '../data/sqlite-data-store';
import { inspectMigrationRollbackBeforeWorkspaceOpen, inspectMigrationRollbackHandoffFacts, inspectNonterminalMigrationRollback } from '../protect/migration-rollback-handoff';
import type { MigrationRollbackBootState } from '../protect/migration-rollback-handoff';
import { inspectRestoreBeforeWorkspaceOpen } from '../protect/restore-activation';
import { isMigrationRollbackSessionView } from '../shared/workspace-migration-contract';
import type { MigrationRollbackSessionView } from '../shared/workspace-migration-contract';
import type { WorkspaceHost } from './host';
import { migrationRollbackRecoveryView, migrationSafetyCopyProjection } from './projections';
export function currentMigrationRollbackBoot(host: WorkspaceHost): MigrationRollbackBootState {
    if (!host.options.activityControlRoot) {
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
        host.options.activityControlRoot,
        host.dataSlotsRoot,
        host.appBuildId,
    );
    host.setMigrationRollbackBoot(boot);
    return boot;
}

/**
 * Reconstructs the path-free binding from immutable handoff and DATA metadata.
 * @param {MigrationRollbackBootState} boot Fresh exact-build classification.
 * @return {void}
 */
export function tryRestoreMigrationRollbackBinding(host: WorkspaceHost, boot: MigrationRollbackBootState): void {
    if (!host.options.activityControlRoot
        || !boot.migrationRollbackSessionId
        || boot.kind === 'recovery-required') {
        return;
    }
    try {
        const facts = inspectMigrationRollbackHandoffFacts(
            host.options.activityControlRoot,
            host.dataSlotsRoot,
            boot.migrationRollbackSessionId,
        );
        const safety = inspectMigrationSafetyCopy(host.dataSlotsRoot);
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
        host.setMigrationRollbackBinding(Object.freeze({
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
        }));
    }
    catch {
        host.setMigrationRollbackBinding(null);
    }
}

/**
 * Maps a kernel status to the complete Shell projection.
 * @param {MigrationRollbackBootState} status Fresh path-free kernel status.
 * @return {MigrationRollbackSessionView} Validated Shell projection.
 */
export function migrationViewFrom(host: WorkspaceHost, status: MigrationRollbackBootState): MigrationRollbackSessionView {
    if (status.kind === 'clear'
        || status.kind === 'recovery-required'
        || !status.migrationRollbackSessionId
        || !status.operationId
        || !status.sessionVersion
        || !status.phase
        || !status.currentBuild) {
        return migrationRollbackRecoveryView();
    }
    if (!host.migrationRollbackBinding()) {
        tryRestoreMigrationRollbackBinding(host, status);
    }
    const binding = host.migrationRollbackBinding();
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
 * Reads live restore and rollback mutex state before an ordinary mutation.
 * @return {boolean} Whether no global destructive operation is pending.
 */
export function migrationOperationsAreClear(host: WorkspaceHost): boolean {
    const activityControlRoot = host.options.activityControlRoot;
    if (!activityControlRoot) {
        return false;
    }
    const restore = inspectRestoreBeforeWorkspaceOpen(
        activityControlRoot,
        host.dataSlotsRoot,
    );
    const rollback = inspectNonterminalMigrationRollback(
        activityControlRoot,
        host.dataSlotsRoot,
    );
    return (restore.kind === 'clear' || restore.kind === 'committed')
        && rollback.kind === 'clear';
}
