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
        kind: 'complete';
        dataMode: 'ready' | 'read-only';
        projection: SetupProjection;
    }>
    | Readonly<{ kind: 'problem'; message: string }>;

/**
 * Converts a validated Workspace outcome into the setup surface that may be shown.
 *
 * First setup owns exactly one required fact, the Current Term; Courses, Meetings,
 * Tasks and HolidayRanges are added later from their own management surfaces.
 *
 * @param {WorkspaceSetupOutcome} outcome Validated Workspace setup outcome.
 * @return {SetupState} Renderer-only setup state.
 */
export function setupStateFrom(outcome: WorkspaceSetupOutcome): SetupState {
    if (!outcome.ok) {
        return { kind: 'problem', message: outcome.problem.message };
    }
    if (outcome.value.kind !== 'workspace.setup-projection') {
        return { kind: 'problem', message: 'Workspace 返回了意外的设置状态。' };
    }
    const projection = outcome.value.projection;
    if (!projection.minimum.hasCurrentTerm) {
        return { kind: 'term', dataMode: outcome.value.dataMode, projection };
    }
    return {
        kind: 'complete',
        dataMode: outcome.value.dataMode,
        projection,
    };
}
