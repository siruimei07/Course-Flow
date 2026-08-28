/**
 * Attaches the per-open DATA hint and requests startup convergence when writable.
 * @return {void}
 */
import { configureBackupDestination as configureBackupDestinationFact } from '../protect/backup-configuration';
import { CommittedCommandOutcomeUnknownError } from '../data/store/types';
import { BackupDestinationPreparationError } from '../protect/backup-repository';
import { DurableBackupCoordinator, readVerifiedDataProtectionProjection } from '../protect/durable-backup';
import { RestoreCoordinator } from '../protect/restore-session';
import { BOOTSTRAP_PROTOCOL_VERSION } from '../shared/bootstrap-contract';
import { WorkspaceSetupOutcome } from '../shared/workspace-setup-contract';
import type { SelectedBackupDestinationRequest } from '../shared/workspace-setup-contract';
import { SYSTEM_CLOCK } from './host';
import type { WorkspaceHost } from './host';
import { backupConfigurationCommandOutcome, commitProblem, problem } from './outcomes';
import { recoverCommittedReceipt } from './plan-commands';
export function startDurableBackup(host: WorkspaceHost): void {
    const store = host.dataState().store;
    if (!store || host.dataState().status.kind !== 'ready') {
        return;
    }
    if (!host.restoreCoordinator() && host.options.activityControlRoot) {
        host.setRestoreCoordinator(new RestoreCoordinator(
            store,
            host.options.activityControlRoot,
            {
                dataSlotsRoot: host.dataSlotsRoot,
                clock: host.options.clock,
                failpoint: host.options.restoreFailpoint,
            },
        ));
    }
    if (host.restoreCoordinator()?.requiresMaintenance()) {
        host.setRestoreMaintenance(true);
        return;
    }
    let coordinator = host.backupCoordinator();
    if (!coordinator) {
        coordinator = new DurableBackupCoordinator(store, {
            clock: host.options.clock ?? SYSTEM_CLOCK,
            ...host.options.durableBackupOptions,
        });
        host.setBackupCoordinator(coordinator);
        const created = coordinator;
        store.setPostCommitHint(() => created.wake());
    }
    coordinator.wake();
}

export async function stopDurableBackupForRestore(host: WorkspaceHost): Promise<void> {
    try {
        host.dataState().store?.setPostCommitHint(null);
    }
    catch {
        // Restore may already have closed the prior DATA connection.
    }
    await host.backupCoordinator()?.close();
    host.setBackupCoordinator(undefined);
}

/**
 * Returns legal configured or unconfigured PROTECT state without filesystem paths.
 * @param {string} requestId - Request correlation identity.
 * @return {WorkspaceSetupOutcome} Current data-protection projection.
 */
export function queryDataProtection(host: WorkspaceHost, requestId: string): WorkspaceSetupOutcome {
    const openedStore = host.dataState().store;
    if (!openedStore) {
        const code = host.dataState().status.kind === 'recovery'
            ? 'recovery-required'
            : 'workspace-unavailable';
        return problem(host, code, '当前没有可读取的数据保护配置。', requestId);
    }
    try {
        return {
            ok: true,
            value: {
                kind: 'workspace.data-protection-projection',
                protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                appBuildId: host.appBuildId,
                requestId,
                workspaceEpoch: host.workspaceEpoch(),
                dataMode: host.dataState().status.kind === 'read-only' ? 'read-only' : 'ready',
                projection: readVerifiedDataProtectionProjection(
                    openedStore,
                    host.restoreCoordinator()?.listCandidates(),
                ),
            },
        };
    }
    catch {
        return problem(host, 'recovery-required', '无法读取一致的数据保护配置。', requestId);
    }
}

/**
 * Coordinates one selected directory through PROTECT, PLATFORM, and DATA.
 * @param {string} requestId - Request correlation identity.
 * @param {SelectedBackupDestinationRequest['command']} command - Path-free PROTECT command.
 * @param {string} selectedDirectoryPath - Main-selected directory path.
 * @return {Promise<WorkspaceSetupOutcome>} Durable receipt or structured unchanged problem.
 */
export async function configureBackupDestination(host: WorkspaceHost, 
    requestId: string,
    command: SelectedBackupDestinationRequest['command'],
    selectedDirectoryPath: string,
): Promise<WorkspaceSetupOutcome> {
    const store = host.dataState().store;
    if (!store) {
        const code = host.dataState().status.kind === 'recovery'
            ? 'recovery-required'
            : 'workspace-unavailable';
        return problem(host, code, '当前没有可写入的本地工作区。', requestId);
    }
    if (host.dataState().status.kind === 'read-only') {
        return problem(host, 'permission', '本地数据为只读，备份目的地未配置。', requestId);
    }
    try {
        const committed = await configureBackupDestinationFact({
            readProtection: () => store.readDataProtectionProjection(),
            readDestinationForCommand: commandId => (
                store.readBackupConfigurationForCommand(commandId)
            ),
            commit: accepted => store.commit(accepted, host.options.commitOptions),
        }, {
            command,
            selectedDirectoryPath,
            activeDataDirectoryPath: host.dataSlotsRoot,
            libraryRootPath: host.options.libraryRootPath ?? null,
        });
        host.setDataState({ ...host.dataState(), status: store.status() });
        if (!committed.ok) {
            return commitProblem(host,
                committed.problem,
                requestId,
                '备份目的地未配置，正式数据没有改变。',
            );
        }
        return backupConfigurationCommandOutcome(host, requestId, committed.value);
    }
    catch (error) {
        if (error instanceof CommittedCommandOutcomeUnknownError
            && error.commandId === command.commandId) {
            const receipt = await recoverCommittedReceipt(host, command.commandId);
            if (receipt) {
                return backupConfigurationCommandOutcome(host, requestId, receipt);
            }
            return problem(host,
                'recovery-required',
                '无法确认备份目的地提交结果；请重新打开工作区后查询。',
                requestId,
                'unknown',
            );
        }
        if (error instanceof BackupDestinationPreparationError) {
            if (error.reason === 'location-overlap' && error.location !== null) {
                return problem(host,
                    'validation',
                    '备份目录必须与活动数据和资料库根隔离。',
                    requestId,
                    'unchanged',
                    { reason: 'backup-location-overlap', location: error.location },
                );
            }
            if (error.reason === 'identity-conflict') {
                return problem(host,
                    'identity-conflict',
                    '所选目录中的 CourseFlow 仓库身份无效，未进行配置。',
                    requestId,
                );
            }
            if (error.reason === 'permission') {
                return problem(host, 'permission', '所选备份目录不可写，未进行配置。', requestId);
            }
            return problem(host, 'validation', '所选备份目录无效，未进行配置。', requestId);
        }
        const code = error instanceof TypeError ? 'validation' : 'recovery-required';
        return problem(host, code, '备份目的地未配置，正式数据没有改变。', requestId);
    }
}
