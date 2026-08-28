import { SetupDraftCheckpointOutcomeUnknownError } from '../data/store/types';
import { BOOTSTRAP_PROTOCOL_VERSION } from '../shared/bootstrap-contract';
import { WorkspaceSetupOutcome } from '../shared/workspace-setup-contract';
import type { DiscardSetupDraftCheckpointRequest, SaveSetupDraftCheckpointRequest } from '../shared/workspace-setup-contract';
import { SYSTEM_CLOCK } from './host';
import type { WorkspaceHost } from './host';
import { reconcileWorkspaceLifecycle } from './lifecycle-routing';
import { commitProblem, problem } from './outcomes';
export async function querySetup(host: WorkspaceHost, requestId: string): Promise<WorkspaceSetupOutcome> {
    const openedStore = host.dataState().store;
    if (!openedStore) {
        const code = host.dataState().status.kind === 'recovery'
            ? 'recovery-required'
            : 'workspace-unavailable';
        return problem(host, code, '当前没有可读取的 setup 数据。', requestId);
    }

    try {
        const initialProjection = openedStore.readSetupProjection();
        const reconciled = await reconcileWorkspaceLifecycle(host, requestId, initialProjection);
        if (reconciled) {
            return reconciled;
        }
        return {
            ok: true,
            value: {
                kind: 'workspace.setup-projection',
                protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                appBuildId: host.appBuildId,
                requestId,
                workspaceEpoch: host.workspaceEpoch(),
                dataMode: host.dataState().status.kind === 'read-only' ? 'read-only' : 'ready',
                projection: host.dataState().store!.readSetupProjection(host.options.setupProjectionReadOptions),
            },
        };
    }
    catch {
        return problem(host, 'recovery-required', '无法读取一致的 setup 数据。', requestId);
    }
}

/**
 * Saves a Shell-owned setup checkpoint using the Workspace Clock.
 * @param {string} requestId - Request correlation identity.
 * @param {SaveSetupDraftCheckpointRequest['input']} input - Validated opaque checkpoint input.
 * @return {Promise<WorkspaceSetupOutcome>} Updated projection or structured problem.
 */
export async function saveSetupDraftCheckpoint(host: WorkspaceHost, 
    requestId: string,
    input: SaveSetupDraftCheckpointRequest['input'],
): Promise<WorkspaceSetupOutcome> {
    const openedStore = host.dataState().store;
    if (!openedStore) {
        const code = host.dataState().status.kind === 'recovery'
            ? 'recovery-required'
            : 'workspace-unavailable';
        return problem(host, code, '当前没有可保存设置草稿的数据。', requestId);
    }
    let writeSucceeded = false;
    try {
        const written = await openedStore.saveSetupDraftCheckpoint(
            input,
            (host.options.clock ?? SYSTEM_CLOCK).now(),
            host.options.commitOptions,
        );
        writeSucceeded = written.ok;
        host.setDataState({ ...host.dataState(), status: openedStore.status() });
        if (!written.ok) {
            return commitProblem(host, written.problem, requestId, '设置草稿未保存，现有数据没有改变。');
        }
        return setupProjectionAfterDraftWrite(host, requestId);
    }
    catch (error) {
        if (writeSucceeded || error instanceof SetupDraftCheckpointOutcomeUnknownError) {
            return problem(host,
                'recovery-required',
                '设置草稿结果无法确认；请重新查询设置状态。',
                requestId,
                'unknown',
            );
        }
        const code = error instanceof TypeError ? 'validation' : 'recovery-required';
        return problem(host, code, '无法保存设置草稿。', requestId);
    }
}

/**
 * Clears the setup checkpoint through its independent optimistic version stream.
 * @param {string} requestId - Request correlation identity.
 * @param {string} expectedVersion - Last observed draft version.
 * @return {Promise<WorkspaceSetupOutcome>} Updated projection or structured problem.
 */
export async function discardSetupDraftCheckpoint(host: WorkspaceHost, 
    requestId: string,
    expectedVersion: DiscardSetupDraftCheckpointRequest['expectedVersion'],
): Promise<WorkspaceSetupOutcome> {
    const openedStore = host.dataState().store;
    if (!openedStore) {
        const code = host.dataState().status.kind === 'recovery'
            ? 'recovery-required'
            : 'workspace-unavailable';
        return problem(host, code, '当前没有可丢弃设置草稿的数据。', requestId);
    }
    let writeSucceeded = false;
    try {
        const written = await openedStore.discardSetupDraftCheckpoint(
            expectedVersion,
            host.options.commitOptions,
        );
        writeSucceeded = written.ok;
        host.setDataState({ ...host.dataState(), status: openedStore.status() });
        if (!written.ok) {
            return commitProblem(host, written.problem, requestId, '设置草稿未丢弃，现有数据没有改变。');
        }
        return setupProjectionAfterDraftWrite(host, requestId);
    }
    catch (error) {
        if (writeSucceeded || error instanceof SetupDraftCheckpointOutcomeUnknownError) {
            return problem(host,
                'recovery-required',
                '设置草稿丢弃结果无法确认；请重新查询设置状态。',
                requestId,
                'unknown',
            );
        }
        const code = error instanceof TypeError ? 'validation' : 'recovery-required';
        return problem(host, code, '无法丢弃设置草稿。', requestId);
    }
}

/**
 * Reads the projection returned after a successful draft-only write.
 * @param {string} requestId - Request correlation identity.
 * @return {WorkspaceSetupOutcome} Current setup projection.
 */
export function setupProjectionAfterDraftWrite(host: WorkspaceHost, requestId: string): WorkspaceSetupOutcome {
    return {
        ok: true,
        value: {
            kind: 'workspace.setup-projection',
            protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
            appBuildId: host.appBuildId,
            requestId,
            workspaceEpoch: host.workspaceEpoch(),
            dataMode: host.dataState().status.kind === 'read-only' ? 'read-only' : 'ready',
            projection: host.dataState().store!.readSetupProjection(host.options.setupProjectionReadOptions),
        },
    };
}
