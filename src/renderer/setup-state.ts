/**
 * @file Maps Workspace setup outcomes to Renderer-only UI states.
 */

import type { WorkspaceSetupOutcome } from '../shared/workspace-setup-contract';
import type { SetupProjection } from '../shared/workspace-term-contract';

export type SetupState =
    | Readonly<{ kind: 'loading' }>
    | Readonly<{
        kind: 'term';
        dataMode: 'ready' | 'read-only';
        projection: SetupProjection;
    }>
    | Readonly<{
        kind: 'course';
        dataMode: 'ready' | 'read-only';
        projection: SetupProjection;
    }>
    | Readonly<{ kind: 'complete'; projection: SetupProjection }>
    | Readonly<{ kind: 'problem'; message: string }>;

/**
 * Converts a validated Workspace outcome into the setup surface that may be shown.
 */
export function setupStateFrom(outcome: WorkspaceSetupOutcome): SetupState {
    if (!outcome.ok) {
        return { kind: 'problem', message: outcome.problem.message };
    }
    if (outcome.value.kind !== 'workspace.setup-projection') {
        return { kind: 'problem', message: 'Workspace 返回了意外的设置状态。' };
    }
    const projection = outcome.value.projection;
    if (!projection.currentTerm) {
        return { kind: 'term', dataMode: outcome.value.dataMode, projection };
    }
    if (projection.courses.length === 0) {
        return { kind: 'course', dataMode: outcome.value.dataMode, projection };
    }
    return outcome.value.dataMode === 'ready'
        ? { kind: 'complete', projection }
        : { kind: 'problem', message: '本地数据为只读；当前不能确认设置流程完成。' };
}
