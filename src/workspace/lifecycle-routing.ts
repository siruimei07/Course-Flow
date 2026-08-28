/**
 * Reduces current owner state to the lifecycle mode-precedence input.
 * @return {WorkspaceLifecycleInput['startupDisposition']} Current startup disposition.
 */
import { randomUUID } from 'node:crypto';
import { initializeWorkspaceData } from '../data/store/open';
import { CommittedCommandOutcomeUnknownError } from '../data/store/types';
import { BOOTSTRAP_PROTOCOL_VERSION } from '../shared/bootstrap-contract';
import type { BootstrapOutcome, WorkspaceProbeRequest } from '../shared/bootstrap-contract';
import { WorkspaceOperationProjection, WorkspacePendingFollowUpProjection } from '../shared/workspace-lifecycle-contract';
import type { WorkspaceLifecycleProjection } from '../shared/workspace-lifecycle-contract';
import { WorkspaceSetupOutcome } from '../shared/workspace-setup-contract';
import { localDateInTermZone, normalizeReconcileWorkspaceLifecycleCommand } from '../shared/workspace-term-contract';
import type { SetupProjection } from '../shared/workspace-term-contract';
import { SYSTEM_CLOCK } from './host';
import type { WorkspaceHost } from './host';
import { workspaceLifecycleFrom } from './lifecycle';
import type { WorkspaceLifecycleInput } from './lifecycle';
import { currentMigrationRollbackBoot } from './migration-boot';
import { commitProblem, problem } from './outcomes';
import { recoverCommittedReceipt } from './plan-commands';
import { backupCleanupOperationProjection, backupOperationProjection, migrationRollbackOperationProjection, restoreOperationProjection } from './projections';
import { startDurableBackup } from './protection';
export function lifecycleDisposition(host: WorkspaceHost): WorkspaceLifecycleInput['startupDisposition'] {
    const status = host.dataState().status;
    if (status.kind === 'recovery') {
        return status.problem.code === 'rollback-required'
            ? 'maintenance'
            : 'recovery';
    }
    return host.migrationMaintenance() || host.restoreMaintenance()
        ? 'maintenance'
        : 'ordinary';
}

/**
 * Restores current durable operation handles without leaking owner storage facts.
 * @return {readonly WorkspaceOperationProjection[]} Current path-free operation handles.
 */
export function lifecycleOperations(host: WorkspaceHost): readonly WorkspaceOperationProjection[] {
    const store = host.dataState().store;
    const migrationBoot = host.migrationMaintenance()
        ? currentMigrationRollbackBoot(host)
        : host.migrationRollbackBoot() ?? host.startupInspection?.migrationRollback ?? null;
    return Object.freeze([
        restoreOperationProjection(host.latestRestoreSession()),
        migrationRollbackOperationProjection(migrationBoot),
        backupOperationProjection(
            store?.readBackupOperation() ?? null,
            host.backupCoordinator()?.isRunning() ?? false,
        ),
        backupCleanupOperationProjection(store?.readBackupCleanupOperation() ?? null),
    ].filter((operation): operation is WorkspaceOperationProjection => operation !== null));
}

/**
 * Reconciles FLOW-00 and builds the authoritative startup projection.
 * @param {string} requestId Bootstrap request correlation identity.
 * @return {Promise<WorkspaceLifecycleProjection>} Current lifecycle projection.
 */
export async function workspaceLifecycle(host: WorkspaceHost, requestId: string): Promise<WorkspaceLifecycleProjection> {
    let setupRoute: WorkspaceLifecycleInput['setupRoute'] = null;
    let startupDisposition = lifecycleDisposition(host);
    const openedStore = host.dataState().store;
    if (openedStore && startupDisposition === 'ordinary') {
        const initialProjection = openedStore.readSetupProjection();
        const reconciled = await reconcileWorkspaceLifecycle(host, requestId, initialProjection);
        if (reconciled) {
            startupDisposition = 'recovery';
        }
        else {
            setupRoute = host.dataState().store!.readSetupProjection(
                host.options.setupProjectionReadOptions,
            ).defaultRoute;
        }
    }
    const pendingFollowUps: readonly WorkspacePendingFollowUpProjection[] = host.dataState().store
        ?.readPendingFollowUps() ?? Object.freeze([]);
    return workspaceLifecycleFrom({
        workspaceData: host.dataState().status,
        setupRoute,
        startupDisposition,
        moduleStatus: host.options.moduleStatus ?? Object.freeze({}),
        operations: lifecycleOperations(host),
        pendingFollowUps,
    });
}

export async function bootstrap(host: WorkspaceHost, request: WorkspaceProbeRequest): Promise<BootstrapOutcome> {
    const lifecycle = await workspaceLifecycle(host, request.requestId);
    if (lifecycle.route === 'setup' || lifecycle.route === 'today') {
        startDurableBackup(host);
    }
    return {
        ok: true,
        value: {
            protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
            appBuildId: host.appBuildId,
            requestId: request.requestId,
            workspaceProcess: 'ready',
            sqliteVersion: host.dataState().sqliteVersion,
            dataRootClass: request.dataRootClass,
            workspaceEpoch: host.workspaceEpoch(),
            workspaceData: host.dataState().status,
            workspaceLifecycle: lifecycle,
        },
    };
}

export function initialize(host: WorkspaceHost, requestId: string): WorkspaceSetupOutcome {
    if (host.dataState().status.kind === 'recovery') {
        return problem(host, 'recovery-required', '本地数据需要恢复，不能开始设置。', requestId);
    }
    if (host.options.readOnly) {
        return problem(host, 'permission', '本地数据为只读，不能开始设置。', requestId);
    }
    if (host.dataState().status.kind === 'absent') {
        try {
            const store = initializeWorkspaceData(host.dataSlotsRoot, randomUUID());
            host.setDataState({
                sqliteVersion: host.dataState().sqliteVersion,
                status: store.status(),
                store,
            });
        }
        catch {
            return problem(host, 'workspace-unavailable', '无法创建本地工作区。', requestId);
        }
    }

    return {
        ok: true,
        value: {
            kind: 'workspace.initialized',
            protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
            appBuildId: host.appBuildId,
            requestId,
            workspaceEpoch: host.workspaceEpoch(),
            workspaceData: host.dataState().status,
        },
    };
}

export async function reconcileWorkspaceLifecycle(host: WorkspaceHost, 
    requestId: string,
    projection: SetupProjection,
): Promise<WorkspaceSetupOutcome | null> {
    const term = projection.currentTerm;
    if (!term || host.dataState().status.kind === 'read-only') {
        return null;
    }

    const evaluatedAt = (host.options.clock ?? SYSTEM_CLOCK).now();
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
        const committed = await host.dataState().store!.commit(command, host.options.commitOptions);
        host.setDataState({
            ...host.dataState(),
            status: host.dataState().store!.status(),
        });
        if (!committed.ok) {
            return commitProblem(host,
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
            const receipt = await recoverCommittedReceipt(host, command.commandId);
            if (receipt?.effects[0]?.code === 'plan.term-auto-archived') {
                return null;
            }
        }
        return problem(host,
            'recovery-required',
            '无法确认学期生命周期提交结果；请重新打开工作区后查询。',
            requestId,
            error instanceof CommittedCommandOutcomeUnknownError ? 'unknown' : 'unchanged',
        );
    }
}
