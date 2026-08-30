import type { DataOpenProblem } from '../shared/bootstrap-contract';
import { migrationSafetyCopyDeleteConfirmationToken } from '../data/sqlite-data-store';
import type { MigrationRollbackTargetV1, MigrationSafetyCopyStatus } from '../data/sqlite-data-store';
import type { BackupCleanupOperation, BackupOperation } from '../data/store/types';
import type { MigrationRollbackBootState } from '../protect/migration-rollback-handoff';
import { RestoreCoordinator } from '../protect/restore-session';
import { WorkspaceOperationProjection } from '../shared/workspace-lifecycle-contract';
import type { MigrationRollbackBindingProjection, MigrationRollbackSessionView, MigrationSafetyCopyProjection } from '../shared/workspace-migration-contract';
import type { WorkspaceApplicationOptions } from './host';
export function requestIdFrom(value: unknown): string | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return null;
    }
    const requestId = (value as { requestId?: unknown }).requestId;
    return typeof requestId === 'string' ? requestId : null;
}

export function requestKindFrom(value: unknown): unknown {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return undefined;
    }
    return (value as { kind?: unknown }).kind;
}

export function restoreActivationProblem(
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

export function migrationRollbackEvidenceProblem(): DataOpenProblem {
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

export type MigrationRollbackNonterminalPhase =
    | 'planned'
    | 'prepared'
    | 'armed'
    | 'awaiting-target-build'
    | 'completing'
    | 'cancelling';

export function isMigrationRollbackNonterminalPhase(
    value: MigrationRollbackBootState['phase'],
): value is MigrationRollbackNonterminalPhase {
    return value === 'planned'
        || value === 'prepared'
        || value === 'armed'
        || value === 'awaiting-target-build'
        || value === 'completing'
        || value === 'cancelling';
}

export function migrationRollbackProblem(boot: MigrationRollbackBootState): DataOpenProblem {
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
export function migrationRollbackTargetProjection(
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
export function migrationSafetyCopyProjection(
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
        target: status.metadata.rollbackTarget === null
            ? null
            : migrationRollbackTargetProjection(status.metadata.rollbackTarget),
    });
}

/**
 * Returns the fail-closed view used when physical evidence cannot prove an action.
 * @return {MigrationRollbackSessionView} Recovery view with no allowed action.
 */
export function migrationRollbackRecoveryView(): MigrationRollbackSessionView {
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
export function sourceBuildProjection(
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
export function backupOperationProjection(
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
export function backupCleanupOperationProjection(
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
export function restoreOperationProjection(
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
export function migrationRollbackOperationProjection(
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
