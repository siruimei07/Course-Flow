import { randomUUID } from 'node:crypto';
import { workspaceDataRuntimeVersion } from '../data/store/database';
import { RestoreCoordinator, RestoreSessionError } from '../protect/restore-session';
import { WorkspaceSetupOutcome } from '../shared/workspace-setup-contract';
import type { CancelRestoreSessionRequest, ConfirmRestoreSessionRequest, RestoreSessionQueryRequest, ResumeRestoreSessionRequest, RollbackRestoreSessionRequest, StartRestoreSessionRequest } from '../shared/workspace-setup-contract';
import type { WorkspaceHost } from './host';
import { problem, restoreProblem, restoreSessionOutcome } from './outcomes';
import { restoreActivationProblem } from './projections';
import { startDurableBackup, stopDurableBackupForRestore } from './protection';
export async function startRestoreSession(host: WorkspaceHost, 
    requestId: string,
    command: StartRestoreSessionRequest['command'],
): Promise<WorkspaceSetupOutcome> {
    const coordinator = host.restoreCoordinator();
    if (!coordinator || host.dataState().status.kind !== 'ready') {
        return problem(host,
            'workspace-unavailable',
            '当前工作区不能开始恢复会话。',
            requestId,
        );
    }
    try {
        await host.backupCoordinator()?.waitForIdle();
        const session = await coordinator.start(command);
        host.setLatestRestoreSession(session);
        return restoreSessionOutcome(host, requestId, session);
    }
    catch (error) {
        return restoreProblem(host, error, requestId, '无法开始恢复会话。');
    }
}

export function queryRestoreSession(host: WorkspaceHost, 
    requestId: string,
    restoreSessionId: RestoreSessionQueryRequest['restoreSessionId'],
): WorkspaceSetupOutcome {
    const coordinator = host.restoreCoordinator();
    if (!coordinator) {
        return problem(host,
            'workspace-unavailable',
            '当前工作区没有可查询的恢复会话。',
            requestId,
        );
    }
    try {
        const session = coordinator.query(restoreSessionId);
        host.setLatestRestoreSession(session);
        return restoreSessionOutcome(host, requestId, session);
    }
    catch (error) {
        return restoreProblem(host, error, requestId, '无法查询恢复会话。');
    }
}

export async function confirmRestoreSession(host: WorkspaceHost, 
    requestId: string,
    command: ConfirmRestoreSessionRequest['command'],
): Promise<WorkspaceSetupOutcome> {
    const coordinator = host.restoreCoordinator();
    if (!coordinator || host.dataState().status.kind !== 'ready') {
        return problem(host,
            'workspace-unavailable',
            '当前工作区不能确认恢复预览。',
            requestId,
        );
    }
    try {
        await host.backupCoordinator()?.waitForIdle();
        const session = await coordinator.confirm(command);
        if (session.phase === 'protection-established') {
            await stopDurableBackupForRestore(host);
            host.setRestoreMaintenance(true);
        }
        host.setLatestRestoreSession(session);
        return restoreSessionOutcome(host, requestId, session);
    }
    catch (error) {
        return restoreProblem(host, error, requestId, '无法确认恢复预览。');
    }
}

export async function cancelRestoreSession(host: WorkspaceHost, 
    requestId: string,
    command: CancelRestoreSessionRequest['command'],
): Promise<WorkspaceSetupOutcome> {
    const coordinator = host.restoreCoordinator();
    if (!coordinator || host.dataState().status.kind !== 'ready') {
        return problem(host,
            'workspace-unavailable',
            '当前工作区不能取消恢复会话。',
            requestId,
        );
    }
    try {
        await host.backupCoordinator()?.waitForIdle();
        const session = await coordinator.cancelBeforeCheckpoint(command);
        host.setRestoreMaintenance(false);
        host.setLatestRestoreSession(session);
        startDurableBackup(host);
        return restoreSessionOutcome(host, requestId, session);
    }
    catch (error) {
        return restoreProblem(host, error, requestId, '无法取消恢复会话。');
    }
}

export async function resumeRestoreSession(host: WorkspaceHost, 
    requestId: string,
    command: ResumeRestoreSessionRequest['command'],
): Promise<WorkspaceSetupOutcome> {
    const coordinator = host.restoreCoordinator();
    if (!coordinator) {
        return problem(host,
            'workspace-unavailable',
            '当前工作区没有可继续的恢复会话。',
            requestId,
        );
    }
    await stopDurableBackupForRestore(host);
    try {
        const session = await coordinator.resume(command);
        if (!adoptRestoreStore(host)) {
            throw new RestoreSessionError('recovery-required');
        }
        host.setRestoreMaintenance(false);
        host.setLatestRestoreSession(session);
        startDurableBackup(host);
        const outcome = restoreSessionOutcome(host, requestId, session);
        host.setWorkspaceEpoch(randomUUID());
        return outcome;
    }
    catch (error) {
        const outcome = restoreProblem(host, error, requestId, '无法继续恢复会话。');
        if (adoptRestoreStore(host)) {
            host.setRestoreMaintenance(true);
        }
        else {
            host.setRestoreMaintenance(true);
            enterRestoreRecovery(host, command.restoreSessionId);
            host.setWorkspaceEpoch(randomUUID());
        }
        return outcome;
    }
}

export async function rollbackRestoreSession(host: WorkspaceHost, 
    requestId: string,
    command: RollbackRestoreSessionRequest['command'],
): Promise<WorkspaceSetupOutcome> {
    const coordinator = host.restoreCoordinator();
    if (!coordinator) {
        return problem(host,
            'workspace-unavailable',
            '当前工作区没有可回滚的恢复会话。',
            requestId,
        );
    }
    await stopDurableBackupForRestore(host);
    try {
        const session = await coordinator.rollback(command);
        if (!adoptRestoreStore(host)) {
            throw new RestoreSessionError('recovery-required');
        }
        host.setRestoreMaintenance(false);
        host.setLatestRestoreSession(session);
        startDurableBackup(host);
        const outcome = restoreSessionOutcome(host, requestId, session);
        host.setWorkspaceEpoch(randomUUID());
        return outcome;
    }
    catch (error) {
        const outcome = restoreProblem(host, error, requestId, '无法回滚恢复会话。');
        if (adoptRestoreStore(host)) {
            host.setRestoreMaintenance(true);
        }
        else {
            host.setRestoreMaintenance(true);
            enterRestoreRecovery(host, command.restoreSessionId);
            host.setWorkspaceEpoch(randomUUID());
        }
        return outcome;
    }
}

export function adoptRestoreStore(host: WorkspaceHost): boolean {
    const store = host.restoreCoordinator()?.activeStore();
    if (!store) {
        return false;
    }
    host.setDataState({
        sqliteVersion: workspaceDataRuntimeVersion(),
        status: store.status(),
        store,
    });
    return true;
}

export function enterRestoreRecovery(host: WorkspaceHost, restoreSessionId: string): void {
    let session: ReturnType<RestoreCoordinator['query']> | null = null;
    try {
        session = host.restoreCoordinator()?.query(restoreSessionId) ?? null;
    }
    catch {
        // A corrupt external chain remains a closed, actionless recovery state.
    }
    host.setDataState({
        sqliteVersion: workspaceDataRuntimeVersion(),
        status: {
            kind: 'recovery',
            problem: restoreActivationProblem(session),
        },
    });
}
