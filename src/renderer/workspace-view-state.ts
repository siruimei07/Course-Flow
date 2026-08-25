/**
 * @file Derives Renderer-only setup and Workspace projection view state.
 */

import type { WorkspaceSetupOutcome } from '../shared/workspace-setup-contract';
import type { PlanProjection } from '../shared/workspace-plan-contract';
import type { SetupProjection } from '../shared/workspace-term-contract';

export type WorkspaceProjectionState<T> =
    | Readonly<{
        kind: 'available';
        dataMode: 'ready' | 'read-only';
        projection: T;
    }>
    | Readonly<{
        kind: 'unavailable';
        message: string;
    }>;

export type SetupMinimumEvaluation = Readonly<{
    hasCurrentTerm: boolean;
    hasCurrentCourse: boolean;
    hasMeetingOrTask: boolean;
    meetsMinimum: boolean;
}>;

export type InitialWorkspaceSurface = SetupProjection['defaultRoute'];

/**
 * Uses the Workspace-owned lifecycle decision for the startup surface.
 *
 * @param {SetupProjection} projection Validated Workspace Setup projection.
 * @return {InitialWorkspaceSurface} Setup or Today startup surface.
 */
export function initialWorkspaceSurfaceFrom(
    projection: SetupProjection,
): InitialWorkspaceSurface {
    return projection.defaultRoute;
}

/**
 * Selects an available Setup projection without treating an empty projection as failure.
 *
 * @param {WorkspaceSetupOutcome} outcome Validated Workspace response.
 * @return {WorkspaceProjectionState<SetupProjection>} Setup availability and projection.
 */
export function setupProjectionStateFrom(
    outcome: WorkspaceSetupOutcome,
): WorkspaceProjectionState<SetupProjection> {
    if (!outcome.ok) {
        return { kind: 'unavailable', message: outcome.problem.message };
    }
    if (outcome.value.kind !== 'workspace.setup-projection') {
        return { kind: 'unavailable', message: 'Workspace 返回了意外的设置投影。' };
    }
    return {
        kind: 'available',
        dataMode: outcome.value.dataMode,
        projection: outcome.value.projection,
    };
}

/**
 * Selects an available PLAN projection without treating empty occurrence sets as failure.
 *
 * @param {WorkspaceSetupOutcome} outcome Validated Workspace response.
 * @return {WorkspaceProjectionState<PlanProjection>} PLAN availability and projection.
 */
export function planProjectionStateFrom(
    outcome: WorkspaceSetupOutcome,
): WorkspaceProjectionState<PlanProjection> {
    if (!outcome.ok) {
        return { kind: 'unavailable', message: outcome.problem.message };
    }
    if (outcome.value.kind !== 'workspace.plan-projection') {
        return { kind: 'unavailable', message: 'Workspace 返回了意外的计划投影。' };
    }
    return {
        kind: 'available',
        dataMode: outcome.value.dataMode,
        projection: outcome.value.projection,
    };
}

/**
 * Maps the Workspace-owned formal minimum into text-ready Renderer names.
 *
 * @param {SetupProjection} projection Validated Workspace Setup projection.
 * @return {SetupMinimumEvaluation} Text-ready minimum-condition states.
 */
export function evaluateSetupMinimum(projection: SetupProjection): SetupMinimumEvaluation {
    return {
        hasCurrentTerm: projection.minimum.hasCurrentTerm,
        hasCurrentCourse: projection.minimum.hasCurrentTermCourse,
        hasMeetingOrTask: projection.minimum.hasMeetingOrTask,
        meetsMinimum: projection.minimum.isSatisfied,
    };
}
