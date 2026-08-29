/**
 * Produces all current PLAN view facts from one revision and one Clock evaluation.
 * @param {string} requestId - Request correlation identity.
 * @return {WorkspaceSetupOutcome} Unified PLAN projection or structured problem.
 */
import { BOOTSTRAP_PROTOCOL_VERSION } from '../shared/bootstrap-contract';
import { buildPlanProjection, createPlanEvaluationContext } from '../shared/workspace-plan-contract';
import { WorkspaceSetupOutcome } from '../shared/workspace-setup-contract';
import type { MeetingOccurrenceImpactRequest, MeetingSeriesQueryRequest, PlanQueryRequest, TaskOccurrenceImpactRequest, TaskSeriesQueryRequest } from '../shared/workspace-setup-contract';
import { SYSTEM_CLOCK } from './host';
import type { WorkspaceHost } from './host';
import { problem } from './outcomes';
export function queryPlan(
    host: WorkspaceHost,
    requestId: PlanQueryRequest['requestId'],
    requestedWindow?: PlanQueryRequest['requestedWindow'],
): WorkspaceSetupOutcome {
    const openedStore = host.dataState().store;
    if (!openedStore) {
        const code = host.dataState().status.kind === 'recovery'
            ? 'recovery-required'
            : 'workspace-unavailable';
        return problem(host, code, '当前没有可读取的计划数据。', requestId);
    }

    try {
        const evaluatedAt = (host.options.clock ?? SYSTEM_CLOCK).now();
        const source = openedStore.readPlanProjectionSource();
        const context = createPlanEvaluationContext(
            evaluatedAt,
            source.term.timeZone,
            requestedWindow,
        );
        return {
            ok: true,
            value: {
                kind: 'workspace.plan-projection',
                protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                appBuildId: host.appBuildId,
                requestId,
                workspaceEpoch: host.workspaceEpoch(),
                dataMode: host.dataState().status.kind === 'read-only' ? 'read-only' : 'ready',
                projection: buildPlanProjection(source, context, 'unavailable'),
            },
        };
    }
    catch (error) {
        const code = error instanceof TypeError ? 'workspace-unavailable' : 'recovery-required';
        return problem(host, code, '无法读取一致的统一计划数据。', requestId);
    }
}

/**
 * Routes a bounded Meeting series query to DATA and wraps its Workspace outcome.
 * @param {string} requestId - Request correlation identity.
 * @param {string} meetingSeriesId - Stable Meeting series identity.
 * @param {MeetingOccurrenceWindow} requestedWindow - Requested physical-date window.
 * @return {Promise<WorkspaceSetupOutcome>} Query projection or structured problem.
 */
export async function queryMeetingSeries(host: WorkspaceHost, 
    requestId: string,
    meetingSeriesId: MeetingSeriesQueryRequest['meetingSeriesId'],
    requestedWindow: MeetingSeriesQueryRequest['requestedWindow'],
): Promise<WorkspaceSetupOutcome> {
    const openedStore = host.dataState().store;
    if (!openedStore) {
        const code = host.dataState().status.kind === 'recovery'
            ? 'recovery-required'
            : 'workspace-unavailable';
        return problem(host, code, '当前没有可读取的课节规则数据。', requestId);
    }

    try {
        return {
            ok: true,
            value: {
                kind: 'workspace.meeting-series-projection',
                protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                appBuildId: host.appBuildId,
                requestId,
                workspaceEpoch: host.workspaceEpoch(),
                dataMode: host.dataState().status.kind === 'read-only' ? 'read-only' : 'ready',
                projection: openedStore.readMeetingSeriesDetail(meetingSeriesId, requestedWindow),
            },
        };
    }
    catch (error) {
        const code = error instanceof TypeError ? 'validation' : 'recovery-required';
        return problem(host, code, '无法读取一致的课节规则数据。', requestId);
    }
}

/**
 * Routes a bounded Task series query to DATA and wraps its Workspace outcome.
 * @param {string} requestId - Request correlation identity.
 * @param {string} taskSeriesId - Stable Task series identity.
 * @param {TaskSeriesQueryRequest['requestedWindow']} requestedWindow - Requested physical-date window.
 * @return {Promise<WorkspaceSetupOutcome>} Query projection or structured problem.
 */
export async function queryTaskSeries(host: WorkspaceHost, 
    requestId: string,
    taskSeriesId: TaskSeriesQueryRequest['taskSeriesId'],
    requestedWindow: TaskSeriesQueryRequest['requestedWindow'],
): Promise<WorkspaceSetupOutcome> {
    const openedStore = host.dataState().store;
    if (!openedStore) {
        const code = host.dataState().status.kind === 'recovery'
            ? 'recovery-required'
            : 'workspace-unavailable';
        return problem(host, code, '当前没有可读取的任务规则数据。', requestId);
    }

    try {
        return {
            ok: true,
            value: {
                kind: 'workspace.task-series-projection',
                protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                appBuildId: host.appBuildId,
                requestId,
                workspaceEpoch: host.workspaceEpoch(),
                dataMode: host.dataState().status.kind === 'read-only' ? 'read-only' : 'ready',
                projection: openedStore.readTaskSeriesDetail(taskSeriesId, requestedWindow),
            },
        };
    }
    catch (error) {
        const code = error instanceof TypeError ? 'validation' : 'recovery-required';
        return problem(host, code, '无法读取一致的任务规则数据。', requestId);
    }
}

/**
 * Routes a whole-rule Meeting impact draft to the DATA preview owner.
 * @param {string} requestId - Request correlation identity.
 * @param {MeetingOccurrenceImpactDraft} draft - Exact proposed future rule.
 * @return {Promise<WorkspaceSetupOutcome>} Impact projection or structured problem.
 */
export async function previewMeetingOccurrence(host: WorkspaceHost, 
    requestId: string,
    draft: MeetingOccurrenceImpactRequest['draft'],
): Promise<WorkspaceSetupOutcome> {
    const openedStore = host.dataState().store;
    if (!openedStore) {
        const code = host.dataState().status.kind === 'recovery'
            ? 'recovery-required'
            : 'workspace-unavailable';
        return problem(host, code, '当前没有可读取的课节规则数据。', requestId);
    }

    try {
        return {
            ok: true,
            value: {
                kind: 'workspace.meeting-occurrence-impact',
                protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                appBuildId: host.appBuildId,
                requestId,
                workspaceEpoch: host.workspaceEpoch(),
                dataMode: host.dataState().status.kind === 'read-only' ? 'read-only' : 'ready',
                projection: openedStore.previewMeetingOccurrenceChange(draft),
            },
        };
    }
    catch (error) {
        const code = error instanceof TypeError ? 'validation' : 'recovery-required';
        return problem(host, code, '无法预览课节规则影响。', requestId);
    }
}

/**
 * Routes a future Task split/delete draft to the DATA preview owner without committing facts.
 * @param {string} requestId - Request correlation identity.
 * @param {TaskOccurrenceImpactRequest['draft']} draft - Exact future Task change or deletion.
 * @return {Promise<WorkspaceSetupOutcome>} Impact projection or structured problem.
 */
export async function previewTaskOccurrence(host: WorkspaceHost, 
    requestId: string,
    draft: TaskOccurrenceImpactRequest['draft'],
): Promise<WorkspaceSetupOutcome> {
    const openedStore = host.dataState().store;
    if (!openedStore) {
        const code = host.dataState().status.kind === 'recovery'
            ? 'recovery-required'
            : 'workspace-unavailable';
        return problem(host, code, '当前没有可读取的任务规则数据。', requestId);
    }

    try {
        return {
            ok: true,
            value: {
                kind: 'workspace.task-occurrence-impact',
                protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                appBuildId: host.appBuildId,
                requestId,
                workspaceEpoch: host.workspaceEpoch(),
                dataMode: host.dataState().status.kind === 'read-only' ? 'read-only' : 'ready',
                projection: openedStore.previewTaskOccurrenceChange(draft),
            },
        };
    }
    catch (error) {
        const code = error instanceof TypeError ? 'validation' : 'recovery-required';
        return problem(host, code, '无法预览任务规则影响。', requestId);
    }
}
