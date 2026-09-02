/**
 * @file Derives Renderer-only setup and Workspace projection view state.
 */

import type { WorkspaceSetupOutcome } from '../shared/workspace-setup-contract';
import type { PlanProjection, PlanTaskProjection } from '../shared/workspace-plan-contract';
import type { TaskSize } from '../shared/workspace-task-contract';
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

/**
 * The Task page's single-selection filter: a Renderer view state, never a Query.
 *
 * It only decides which rows stay visible; every number on the page keeps its PLAN source.
 */
export type TaskListFilter =
    | Readonly<{ kind: 'all' }>
    | Readonly<{ kind: 'size'; size: TaskSize }>
    | Readonly<{ kind: 'course'; courseId: string }>;

export const ALL_TASKS_FILTER: TaskListFilter = Object.freeze({ kind: 'all' });

/**
 * Compares two filters by value.
 *
 * @param {TaskListFilter} first One filter.
 * @param {TaskListFilter} second Another filter.
 * @return {boolean} Whether both name the same selection.
 */
export function sameTaskListFilter(first: TaskListFilter, second: TaskListFilter): boolean {
    if (first.kind === 'size' && second.kind === 'size') {
        return first.size === second.size;
    }
    if (first.kind === 'course' && second.kind === 'course') {
        return first.courseId === second.courseId;
    }
    return first.kind === second.kind;
}

/**
 * Decides whether one PLAN-classified Task row stays visible under the filter.
 *
 * @param {TaskListFilter} filter Filter in effect.
 * @param {PlanTaskProjection} task PLAN Task projection.
 * @return {boolean} Whether the row is shown.
 */
export function taskListFilterAccepts(filter: TaskListFilter, task: PlanTaskProjection): boolean {
    if (filter.kind === 'size') {
        return task.occurrence.size === filter.size;
    }
    if (filter.kind === 'course') {
        return task.courseId === filter.courseId;
    }
    return true;
}

/**
 * Drops a Course selection whose Course can no longer be chosen, so a Term change or an
 * archived Course never leaves the page filtered by something it does not offer.
 *
 * @param {TaskListFilter} filter Filter held by the Shell.
 * @param {readonly string[]} courseIds Courses the page currently offers as chips.
 * @return {TaskListFilter} The same filter, or 全部 when its Course is gone.
 */
export function resolveTaskListFilter(filter: TaskListFilter, courseIds: readonly string[]): TaskListFilter {
    if (filter.kind === 'course' && !courseIds.includes(filter.courseId)) {
        return ALL_TASKS_FILTER;
    }
    return filter;
}
