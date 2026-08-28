/**
 * @file Loads Workspace projections and renders the accessible CourseFlow shell.
 */

import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type KeyboardEvent,
    type ReactElement,
} from 'react';

import type {WorkspaceDataStatus} from '../shared/bootstrap-contract';
import type {WorkspaceMode} from '../shared/workspace-lifecycle-contract';
import type {
    PlanProjection,
    PlanTaskProjection,
} from '../shared/workspace-plan-contract';
import type {
    ApplicationBuildStatus,
    MigrationRollbackSessionView,
    MigrationSafetyCopyProjection,
} from '../shared/workspace-migration-contract';
import {
    isTaskOccurrenceWindow,
    type TaskOccurrenceId,
    type TaskOccurrenceWindow,
    type TaskSeriesDetailProjection,
} from '../shared/workspace-task-contract';
import {
    type SetupProjection,
} from '../shared/workspace-term-contract';
import {
    navigationTargetFromKey,
    WORKSPACE_NAVIGATION_ITEMS,
    type WorkspaceNavigationId,
} from './navigation';
import { SetupDialog } from './SetupDialog';
import {
    MigrationMaintenanceSurface,
    MigrationProtectionDialog,
    type MigrationProtectionDialogMode,
} from './MigrationRollbackSurface';
import { setupStateFrom, type SetupState } from './setup-state';
import {
    advanceTaskOccurrenceActionsState,
    createTaskOccurrenceActionsState,
    hasPendingTaskOccurrenceAction,
    hasPendingTaskOccurrenceRequest,
    runTaskOccurrenceAction,
    runTaskOccurrenceUndo,
    setTaskUndoToastFocused,
    setTaskUndoToastHovered,
    type TaskOccurrenceAction,
    type TaskOccurrenceActionsState,
} from './task-occurrence-actions';
import {planProjectionStateFrom} from './workspace-view-state';
import { WindowControls, WindowTitlebar } from './WindowControls';
import {
    TaskActionNotice,
    WorkspacePage,
    type TaskActionPresentation,
} from './workspace-pages';

type ResolvedSetupState = Extract<SetupState, { projection: SetupProjection }>;

export type WorkspaceLoadResult =
    | Readonly<{
        kind: 'welcome';
    }>
    | Readonly<{
        kind: 'maintenance';
        message: string;
    }>
    | Readonly<{
        kind: 'recovery';
        message: string;
    }>
    | Readonly<{
        kind: 'problem';
        message: string;
    }>
    | Readonly<{
        kind: 'migration-maintenance';
        buildStatus: ApplicationBuildStatus | null;
        session: MigrationRollbackSessionView;
        problem: string | null;
    }>
    | Readonly<{
        kind: 'ready';
        setup: ResolvedSetupState;
        plan: PlanProjection | null;
        planProblem: string | null;
        buildStatus: ApplicationBuildStatus | null;
        migrationSafetyCopy: MigrationSafetyCopyProjection;
        migrationProblem: string | null;
        route: 'setup' | 'today';
        workspaceMode: Extract<WorkspaceMode, 'ready' | 'limited' | 'read-only'>;
    }>;

type AppState = Readonly<{ kind: 'loading' }> | WorkspaceLoadResult;

export type WorkspaceShellProps = Readonly<{
    activePage: WorkspaceNavigationId;
    dataMode: 'ready' | 'read-only';
    setup: SetupProjection;
    plan: PlanProjection | null;
    planProblem: string | null;
    taskActions: TaskActionPresentation;
    onNavigate(page: WorkspaceNavigationId): void;
    onCreateTask(): void;
    onOpenDataProtection(): void;
    onOpenSetup(): void;
    onRetryPlan(): void;
}>;

type PlanLoadResult = Readonly<{
    plan: PlanProjection | null;
    planProblem: string | null;
}>;

const MILLISECONDS_PER_DAY = 86_400_000;

export type TaskActionAppBridge = Pick<
    Window['courseFlow'],
    | 'queryTaskSeries'
    | 'setTaskOccurrenceStatus'
    | 'undoTaskOccurrenceState'
    | 'querySetup'
    | 'queryPlan'
>;

export type TaskActionWorkspaceRefresh = Readonly<{
    setup: ResolvedSetupState;
    plan: PlanProjection;
}>;

export type WorkspaceTaskActionResult = Readonly<{
    actionState: TaskOccurrenceActionsState | null;
    refresh: TaskActionWorkspaceRefresh | null;
    problem: string | null;
}>;

export type RunWorkspaceTaskOccurrenceActionOptions = Readonly<{
    actionState?: TaskOccurrenceActionsState;
    bridge: TaskActionAppBridge;
    plan: Pick<PlanProjection, 'evaluationContext' | 'term'>;
    occurrenceId: TaskOccurrenceId;
    action: TaskOccurrenceAction;
    makeId(): string;
    now(): number;
    onStateChange(state: TaskOccurrenceActionsState | null): void;
}>;

export type RunWorkspaceTaskOccurrenceUndoOptions = Readonly<{
    bridge: TaskActionAppBridge;
    actionState: TaskOccurrenceActionsState;
    makeId(): string;
    now(): number;
    onStateChange(state: TaskOccurrenceActionsState | null): void;
}>;

/**
 * Calculates the next Undo expiry wake-up from the authoritative Toast clock.
 * @param {TaskOccurrenceActionsState} state Current direct-action state.
 * @param {number} now Current Unix milliseconds.
 * @return {number | null} Non-negative delay, or null while absent/paused.
 */
export function taskUndoTimerDelayFrom(
    state: TaskOccurrenceActionsState,
    now: number,
): number | null {
    if (state.pendingUndoCommand !== null) {
        return null;
    }
    const toast = state.commandState.undoToast;
    if (toast === null || toast.pausedAt !== null) {
        return null;
    }
    return Math.max(0, toast.expiresAt - now);
}

/**
 * Advances an expired Undo Toast only when no retained Undo request owns it.
 * @param {TaskOccurrenceActionsState | null} state Current Task action control state.
 * @param {number} now Current Unix milliseconds.
 * @return {TaskOccurrenceActionsState | null} Safely advanced or retained state.
 */
export function advanceTaskUndoTimerState(
    state: TaskOccurrenceActionsState | null,
    now: number,
): TaskOccurrenceActionsState | null {
    return state === null || state.pendingUndoCommand !== null
        ? state
        : advanceTaskOccurrenceActionsState(state, now);
}

/**
 * Derives honest Undo feedback without changing the retained command or timer state.
 * @param {TaskOccurrenceActionsState | null} state Current Task action control state.
 * @param {boolean} submitting Whether the visible Undo action is unavailable while work is active.
 * @return {TaskActionPresentation['undo']} Visible Undo feedback or no surface.
 */
export function taskUndoPresentationFrom(
    state: TaskOccurrenceActionsState | null,
    submitting: boolean,
): TaskActionPresentation['undo'] {
    if (state === null
        || state.pendingActionCommand !== null
        || state.commandState.undoToast === null) {
        return null;
    }

    const resultUnknown = state.pendingUndoCommand !== null;
    return {
        actionLabel: resultUnknown ? '精确重试撤销' : '撤销',
        message: resultUnknown
            ? '撤销结果尚无法确认；请精确重试本次撤销请求。'
            : '任务状态已保存，可在 6 秒内撤销。',
        submitting,
    };
}

/**
 * Builds the presentation identity shared by PLAN Task rows and busy feedback.
 * @param {TaskOccurrenceId} occurrenceId Stable Task occurrence identity.
 * @return {string} Workspace-page item identity.
 */
function taskPresentationItemId(
    occurrenceId: Pick<TaskOccurrenceId, 'taskSeriesId' | 'originalLogicalAnchor'>,
): string {
    return `task:${occurrenceId.taskSeriesId}:${occurrenceId.originalLogicalAnchor}`;
}

/**
 * Restores a Task control without letting fixed feedback cover its focus ring.
 * @param {Pick<HTMLElement, 'focus' | 'scrollIntoView'>} target Connected focus target.
 * @return {void}
 */
export function focusTaskActionTarget(
    target: Pick<HTMLElement, 'focus' | 'scrollIntoView'>,
): void {
    target.focus({ preventScroll: true });
    target.scrollIntoView({
        behavior: 'auto',
        block: 'center',
        inline: 'nearest',
    });
}

const PAGE_HEADING_IDS: Readonly<Record<WorkspaceNavigationId, string>> = {
    today: 'today-page-title',
    courses: 'courses-page-title',
    calendar: 'calendar-page-title',
    tasks: 'tasks-page-title',
    files: 'files-page-title',
};

/**
 * Selects one matching Task-series detail response.
 * @param {Awaited<ReturnType<TaskActionAppBridge['queryTaskSeries']>>} outcome Workspace response.
 * @param {string} taskSeriesId Requested stable Task-series identity.
 * @return {TaskSeriesDetailProjection | string} Formal detail or a user-facing problem.
 */
function taskSeriesDetailFrom(
    outcome: Awaited<ReturnType<TaskActionAppBridge['queryTaskSeries']>>,
    taskSeriesId: string,
): TaskSeriesDetailProjection | string {
    if (!outcome.ok) {
        return outcome.problem.message;
    }
    if (outcome.value.kind !== 'workspace.task-series-projection'
        || outcome.value.projection.taskSeriesId !== taskSeriesId) {
        return 'Workspace 返回了意外的任务详情。';
    }
    return outcome.value.projection;
}

/**
 * Refreshes Setup and PLAN together after one confirmed Task mutation.
 * @param {TaskActionAppBridge} bridge Bounded preload bridge.
 * @return {Promise<TaskActionWorkspaceRefresh | string>} Fresh projections or a scoped problem.
 */
async function refreshAfterTaskAction(
    bridge: TaskActionAppBridge,
): Promise<TaskActionWorkspaceRefresh | string> {
    try {
        const [setupOutcome, planOutcome] = await Promise.all([
            bridge.querySetup(),
            bridge.queryPlan(),
        ]);
        const setup = setupStateFrom(setupOutcome);
        if (setup.kind === 'loading' || setup.kind === 'problem') {
            return setup.kind === 'problem' ? setup.message : 'Workspace 未返回设置投影。';
        }
        const plan = planProjectionStateFrom(planOutcome);
        if (plan.kind === 'unavailable') {
            return plan.message;
        }
        return { setup, plan: plan.projection };
    }
    catch {
        return '任务已保存，但无法刷新工作区投影；请重试。';
    }
}

/**
 * Reports whether a Task action reached a newer formal detail projection.
 * @param {TaskSeriesDetailProjection} before Formal projection before the command.
 * @param {TaskOccurrenceActionsState} after Renderer state after command/requery.
 * @return {boolean} Whether persistence and the bounded formal requery both succeeded.
 */
function taskActionReachedFormalProjection(
    before: TaskSeriesDetailProjection,
    after: TaskOccurrenceActionsState,
): boolean {
    const projection = after.commandState.projection;
    return after.commandState.problem === null
        && after.commandState.requeryRequest === null
        && projection !== null
        && projection.taskSeriesId === before.taskSeriesId
        && BigInt(projection.workspaceRevision) > BigInt(before.workspaceRevision)
        && BigInt(projection.entityVersion) > BigInt(before.entityVersion);
}

/**
 * Leaves a rejected transport request available for idempotent retry without
 * pretending that the Workspace did or did not commit it.
 * @param {TaskOccurrenceActionsState} state State observed after invoking the mutation.
 * @return {TaskOccurrenceActionsState} Idle Renderer state retaining the exact request.
 */
function settleUnknownTaskTransport(
    state: TaskOccurrenceActionsState,
): TaskOccurrenceActionsState {
    return {
        ...state,
        commandState: {
            ...state.commandState,
            submitting: false,
            submissionDraft: null,
            undoSubmission: null,
        },
    };
}

/**
 * Chooses a formal Task-detail window without exceeding the Workspace query
 * limit for an extended Term.
 * @param {Pick<PlanProjection, 'evaluationContext' | 'term'>} plan Current PLAN projection.
 * @param {TaskOccurrenceId} occurrenceId Stable target occurrence identity.
 * @return {TaskOccurrenceWindow} Valid bounded window for detail and confirmation queries.
 */
function taskOccurrenceQueryWindowFrom(
    plan: Pick<PlanProjection, 'evaluationContext' | 'term'>,
    occurrenceId: TaskOccurrenceId,
): TaskOccurrenceWindow {
    const termWindow = {
        startDate: plan.term.startDate,
        endDate: plan.term.endDate,
    };
    if (isTaskOccurrenceWindow(termWindow)) {
        return termWindow;
    }
    const originalLogicalAnchor = occurrenceId.originalLogicalAnchor;
    if (originalLogicalAnchor === 'once') {
        return plan.evaluationContext.requestedWindow;
    }
    const anchorMilliseconds = Date.parse(`${originalLogicalAnchor}T00:00:00.000Z`);
    const minimumDate = Date.parse('0000-01-01T00:00:00.000Z');
    const maximumDate = Date.parse('9999-12-31T00:00:00.000Z');
    const shiftedDate = (days: number): string => new Date(Math.min(
        maximumDate,
        Math.max(minimumDate, anchorMilliseconds + days * MILLISECONDS_PER_DAY),
    )).toISOString().slice(0, 10);
    return Object.freeze({
        startDate: shiftedDate(-6),
        endDate: shiftedDate(6),
    });
}

/**
 * Loads one bounded Task detail, runs a direct action, then refreshes composite projections.
 * @param {RunWorkspaceTaskOccurrenceActionOptions} options Action, Workspace, clock, and observer ports.
 * @return {Promise<WorkspaceTaskActionResult>} Final control state and optional Workspace refresh.
 */
export async function runWorkspaceTaskOccurrenceAction(
    options: RunWorkspaceTaskOccurrenceActionOptions,
): Promise<WorkspaceTaskActionResult> {
    let actionState: TaskOccurrenceActionsState | null = null;
    try {
        const retainedState = options.actionState;
        if (retainedState !== undefined
            && hasPendingTaskOccurrenceRequest(retainedState)
            && !hasPendingTaskOccurrenceAction(
                retainedState,
                options.occurrenceId,
                options.action,
            )) {
            return {
                actionState: retainedState,
                refresh: null,
                problem: '请先重试或核对上次结果未知的任务请求。',
            };
        }
        const requestedWindow = taskOccurrenceQueryWindowFrom(options.plan, options.occurrenceId);
        let detailResult: TaskSeriesDetailProjection;
        if (retainedState !== undefined
            && retainedState.commandState.projection !== null
            && hasPendingTaskOccurrenceAction(
                retainedState,
                options.occurrenceId,
                options.action,
            )) {
            actionState = retainedState;
            detailResult = retainedState.commandState.projection;
        }
        else {
            const queriedDetail = taskSeriesDetailFrom(
                await options.bridge.queryTaskSeries(
                    options.occurrenceId.taskSeriesId,
                    requestedWindow,
                ),
                options.occurrenceId.taskSeriesId,
            );
            if (typeof queriedDetail === 'string') {
                return { actionState: null, refresh: null, problem: queriedDetail };
            }
            detailResult = queriedDetail;
            actionState = createTaskOccurrenceActionsState(detailResult);
            options.onStateChange(actionState);
        }
        actionState = await runTaskOccurrenceAction(
            actionState,
            options.occurrenceId,
            options.action,
            {
                port: options.bridge,
                makeId: options.makeId,
                now: options.now,
                onStateChange(nextState) {
                    actionState = nextState;
                    options.onStateChange(nextState);
                },
            },
        );
        if (!taskActionReachedFormalProjection(detailResult, actionState)) {
            return {
                actionState,
                refresh: null,
                problem: actionState.commandState.problem?.message
                    ?? '任务状态已变化，请刷新后重试。',
            };
        }

        const refresh = await refreshAfterTaskAction(options.bridge);
        if (typeof refresh === 'string') {
            return { actionState, refresh: null, problem: refresh };
        }
        return { actionState, refresh, problem: null };
    }
    catch {
        if (actionState !== null && actionState.commandState.requeryRequest !== null) {
            return {
                actionState,
                refresh: null,
                problem: '任务状态已保存，但无法验证最新投影；请刷新后重试。',
            };
        }
        if (actionState !== null) {
            const settledState = settleUnknownTaskTransport(actionState);
            options.onStateChange(settledState);
            return {
                actionState: settledState,
                refresh: null,
                problem: '无法连接本地 Workspace；任务提交结果尚无法确认。再次选择相同操作会使用本次请求重试。',
            };
        }
        return {
            actionState: null,
            refresh: null,
            problem: '无法读取正式任务详情，因此没有发起任务更改。',
        };
    }
}

/**
 * Runs a visible Task Undo, confirms it through a bounded formal requery, then refreshes composites.
 * @param {RunWorkspaceTaskOccurrenceUndoOptions} options Undo state, Workspace, clock, and observer ports.
 * @return {Promise<WorkspaceTaskActionResult>} Final control state and optional Workspace refresh.
 */
export async function runWorkspaceTaskOccurrenceUndo(
    options: RunWorkspaceTaskOccurrenceUndoOptions,
): Promise<WorkspaceTaskActionResult> {
    if (options.actionState.pendingActionCommand !== null) {
        return {
            actionState: options.actionState,
            refresh: null,
            problem: '请先重试或核对上次结果未知的任务请求。',
        };
    }
    const before = options.actionState.commandState.projection;
    if (before === null) {
        return {
            actionState: options.actionState,
            refresh: null,
            problem: '没有可撤销的正式任务状态。',
        };
    }

    let actionState = options.actionState;
    try {
        actionState = await runTaskOccurrenceUndo(actionState, {
            port: options.bridge,
            makeId: options.makeId,
            now: options.now,
            onStateChange(nextState) {
                actionState = nextState;
                options.onStateChange(nextState);
            },
        });
        if (!taskActionReachedFormalProjection(before, actionState)) {
            return {
                actionState,
                refresh: null,
                problem: actionState.commandState.problem?.message
                    ?? '撤销未完成，请刷新后重试。',
            };
        }

        const refresh = await refreshAfterTaskAction(options.bridge);
        if (typeof refresh === 'string') {
            return { actionState, refresh: null, problem: refresh };
        }
        return { actionState, refresh, problem: null };
    }
    catch {
        if (actionState.commandState.requeryRequest !== null) {
            return {
                actionState,
                refresh: null,
                problem: '任务状态已撤销，但无法验证最新投影；请刷新后重试。',
            };
        }
        const settledState = settleUnknownTaskTransport(actionState);
        options.onStateChange(settledState);
        return {
            actionState: settledState,
            refresh: null,
            problem: '无法连接本地 Workspace；撤销提交结果尚无法确认。再次选择撤销会使用本次请求重试。',
        };
    }
}

/**
 * Loads PLAN only when a Current Term makes the query applicable.
 *
 * @param {Window['courseFlow']} bridge Bounded preload bridge.
 * @param {SetupProjection} setup Validated Setup projection.
 * @return {Promise<PlanLoadResult>} Available PLAN facts or an explicit failure.
 */
async function loadPlan(
    bridge: Window['courseFlow'],
    setup: SetupProjection,
): Promise<PlanLoadResult> {
    if (setup.currentTerm === null) {
        return { plan: null, planProblem: null };
    }

    try {
        const planState = planProjectionStateFrom(await bridge.queryPlan());
        if (planState.kind === 'unavailable') {
            return { plan: null, planProblem: planState.message };
        }
        return { plan: planState.projection, planProblem: null };
    }
    catch {
        return {
            plan: null,
            planProblem: '无法读取统一计划投影；正式学期与课程数据没有改变。',
        };
    }
}

type MigrationProtectionLoad = Readonly<{
    buildStatus: ApplicationBuildStatus | null;
    migrationSafetyCopy: MigrationSafetyCopyProjection;
    migrationProblem: string | null;
}>;

/**
 * Creates the fail-closed Renderer fallback when Workspace status is unavailable.
 * @return {MigrationRollbackSessionView} Recovery view with no allowed action.
 */
function rollbackRecoveryView(): MigrationRollbackSessionView {
    return {
        migrationRollbackSessionId: null,
        operationId: null,
        sessionVersion: null,
        phase: 'recovery-required',
        currentBuild: 'recovery-required',
        binding: null,
        previewToken: null,
        retryCommand: null,
        allowedActions: [],
        outcome: null,
        problem: {code: 'recovery-required'},
    };
}

/**
 * Loads build and migration-safety projections without blocking the PLAN core.
 * @param {Window['courseFlow']} bridge Bounded preload bridge.
 * @return {Promise<MigrationProtectionLoad>} Available projections and scoped problem.
 */
async function loadMigrationProtection(
    bridge: Window['courseFlow'],
): Promise<MigrationProtectionLoad> {
    let buildStatus: ApplicationBuildStatus | null = null;
    let migrationSafetyCopy: MigrationSafetyCopyProjection = {kind: 'unavailable'};
    const problems: string[] = [];
    try {
        const outcome = await bridge.queryApplicationBuildStatus();
        if (outcome.ok && outcome.value.kind === 'workspace.application-build-status') {
            buildStatus = outcome.value.status;
        }
        else {
            problems.push(outcome.ok ? '当前构建状态不可用。' : outcome.problem.message);
        }
    }
    catch {
        problems.push('无法读取当前构建状态。');
    }
    try {
        const outcome = await bridge.queryMigrationSafetyCopy();
        if (outcome.ok && outcome.value.kind === 'workspace.migration-safety-copy') {
            migrationSafetyCopy = outcome.value.safetyCopy;
        }
        else {
            problems.push(outcome.ok ? '迁移安全副本状态不可用。' : outcome.problem.message);
        }
    }
    catch {
        problems.push('无法读取迁移安全副本状态。');
    }
    return {
        buildStatus,
        migrationSafetyCopy,
        migrationProblem: problems.length === 0 ? null : problems.join(' '),
    };
}

/**
 * Extracts the rollback startup route from one Workspace DATA recovery status.
 * @param {WorkspaceDataStatus} problem Bootstrap DATA status.
 * @return {string | null | undefined} Session, evidence-only recovery, or non-rollback state.
 */
function migrationRollbackSessionIdFrom(
    problem: WorkspaceDataStatus,
): string | null | undefined {
    if (problem.kind !== 'recovery') {
        return undefined;
    }
    const details = problem.problem.details;
    const reason = 'reason' in details ? details.reason : null;
    if (reason === 'migration-rollback-evidence') {
        return null;
    }
    if (reason !== 'migration-rollback-pending') {
        return undefined;
    }
    return 'migrationRollbackSessionId' in problem.problem.context
        ? problem.problem.context.migrationRollbackSessionId
        : null;
}

/**
 * Loads the exclusive rollback route before any ordinary Workspace query.
 * @param {Window['courseFlow']} bridge Bounded preload bridge.
 * @param {string | null} migrationRollbackSessionId Exact session or recovery evidence.
 * @return {Promise<Extract<WorkspaceLoadResult, {kind: 'migration-maintenance'}>>} Dedicated route.
 */
async function loadMigrationMaintenance(
    bridge: Window['courseFlow'],
    migrationRollbackSessionId: string | null,
): Promise<Extract<WorkspaceLoadResult, Readonly<{kind: 'migration-maintenance'}>>> {
    let buildStatus: ApplicationBuildStatus | null = null;
    let session = rollbackRecoveryView();
    const problems: string[] = [];
    try {
        const outcome = await bridge.queryApplicationBuildStatus();
        if (outcome.ok && outcome.value.kind === 'workspace.application-build-status') {
            buildStatus = outcome.value.status;
        }
        else {
            problems.push(outcome.ok ? '当前构建状态不可用。' : outcome.problem.message);
        }
    }
    catch {
        problems.push('无法读取当前构建状态。');
    }
    try {
        const outcome = await bridge.queryMigrationRollbackStatus(migrationRollbackSessionId);
        if (outcome.ok && outcome.value.kind === 'workspace.migration-rollback-session') {
            session = outcome.value.session;
        }
        else {
            problems.push(outcome.ok ? '回退状态不可用。' : outcome.problem.message);
        }
    }
    catch {
        problems.push('无法读取迁移回退状态。');
    }
    return {
        kind: 'migration-maintenance',
        buildStatus,
        session,
        problem: problems.length === 0 ? null : problems.join(' '),
    };
}

/**
 * Resolves startup through Bootstrap, SetupProjection, and the existing PLAN projection.
 *
 * @param {Window['courseFlow']} bridge Bounded preload bridge.
 * @return {Promise<WorkspaceLoadResult>} Shell-ready projection state or one blocking problem.
 */
export async function loadWorkspace(
    bridge: Window['courseFlow'],
): Promise<WorkspaceLoadResult> {
    try {
        const bootstrap = await bridge.query();
        if (!bootstrap.ok) {
            return { kind: 'problem', message: bootstrap.problem.message };
        }
        const lifecycle = bootstrap.value.workspaceLifecycle;
        if (lifecycle.route === 'welcome') {
            return {kind: 'welcome'};
        }
        if (lifecycle.route === 'maintenance' || lifecycle.route === 'recovery') {
            const migrationRollbackSessionId = migrationRollbackSessionIdFrom(
                bootstrap.value.workspaceData,
            );
            if (migrationRollbackSessionId !== undefined) {
                return loadMigrationMaintenance(bridge, migrationRollbackSessionId);
            }
            return {
                kind: lifecycle.route,
                message: lifecycle.route === 'maintenance'
                    ? '本地工作区正在完成已确认的维护操作；普通读写和备份暂时关闭。'
                    : '本地工作区需要根据当前证据恢复；不会自动执行继续、回滚或取消。',
            };
        }
        if (bootstrap.value.workspaceData.kind === 'absent'
            || bootstrap.value.workspaceData.kind === 'recovery'
            || lifecycle.mode === 'maintenance'
            || lifecycle.mode === 'recovery') {
            return {
                kind: 'recovery',
                message: 'Workspace 启动状态不一致，已停止普通工作区查询。',
            };
        }

        const [setupOutcome, migrationProtection] = await Promise.all([
            bridge.querySetup(),
            loadMigrationProtection(bridge),
        ]);
        const setupState = setupStateFrom(setupOutcome);
        if (setupState.kind === 'problem') {
            return { kind: 'problem', message: setupState.message };
        }
        if (setupState.kind === 'loading') {
            return { kind: 'problem', message: 'Workspace 未返回设置投影。' };
        }

        return {
            kind: 'ready',
            setup: setupState,
            ...await loadPlan(bridge, setupState.projection),
            ...migrationProtection,
            route: lifecycle.route,
            workspaceMode: lifecycle.mode,
        };
    }
    catch {
        return {
            kind: 'problem',
            message: '无法连接本地 Workspace，请重试。',
        };
    }
}

/**
 * Presents the explicit first-run boundary without creating DATA on observation.
 * @param {{onStart(): void}} props Explicit local initialization action.
 * @return {ReactElement} Accessible welcome surface.
 */
export function WelcomeSurface({onStart}: Readonly<{onStart(): void}>): ReactElement {
    return (
        <main className="startup-surface">
            <section
                aria-labelledby="workspace-welcome-title"
                className="status-card"
            >
                <p className="eyebrow">CourseFlow</p>
                <h1 id="workspace-welcome-title">欢迎使用 CourseFlow</h1>
                <p>课程与任务数据只保存在这台设备上；开始后可随时继续未完成的设置。</p>
                <button
                    className="primary-action"
                    onClick={onStart}
                    type="button"
                >开始新的本地工作区</button>
            </section>
        </main>
    );
}

/**
 * Owns the interruptible setup overlay, navigation state, and projection refreshes.
 *
 * @return {ReactElement} CourseFlow application root.
 */
export function App(): ReactElement {
    const [state, setState] = useState<AppState>({ kind: 'loading' });
    const [activePage, setActivePage] = useState<WorkspaceNavigationId>('today');
    const [setupOpen, setSetupOpen] = useState(false);
    const [setupEntryIntent, setSetupEntryIntent] = useState<'default' | 'task'>('default');
    const [migrationDialogOpen, setMigrationDialogOpen] = useState(false);
    const [migrationDialogMode, setMigrationDialogMode] = useState<MigrationProtectionDialogMode>(
        'overview',
    );
    const [migrationRollbackPreview, setMigrationRollbackPreview] = useState<
        MigrationRollbackSessionView | null
    >(null);
    const [migrationBusy, setMigrationBusy] = useState(false);
    const [migrationActionProblem, setMigrationActionProblem] = useState<string | null>(null);
    const [taskActionState, setTaskActionState] = useState<TaskOccurrenceActionsState | null>(null);
    const [taskActionBusyItemId, setTaskActionBusyItemId] = useState<string | null>(null);
    const [taskActionProblem, setTaskActionProblem] = useState<string | null>(null);
    const returnFocusRef = useRef<HTMLElement | null>(null);
    const migrationReturnFocusRef = useRef<HTMLElement | null>(null);
    const taskActionInFlightRef = useRef(false);
    const taskActionFocusRef = useRef<Readonly<{
        itemId: string;
        page: WorkspaceNavigationId;
        trigger: HTMLElement | null;
    }> | null>(null);

    const reload = useCallback((): void => {
        taskActionInFlightRef.current = false;
        taskActionFocusRef.current = null;
        setTaskActionState(null);
        setTaskActionBusyItemId(null);
        setTaskActionProblem(null);
        setMigrationDialogOpen(false);
        setMigrationDialogMode('overview');
        setMigrationRollbackPreview(null);
        setMigrationBusy(false);
        setMigrationActionProblem(null);
        setState({ kind: 'loading' });
        void loadWorkspace(window.courseFlow).then(result => {
            setState(result);
            if (result.kind === 'ready') {
                setActivePage('today');
                setSetupOpen(result.route === 'setup');
            }
        });
    }, []);

    useEffect(reload, [reload]);

    const startNewWorkspace = (): void => {
        setState({kind: 'loading'});
        void window.courseFlow.initialize().then(outcome => {
            if (!outcome.ok) {
                setState({kind: 'problem', message: outcome.problem.message});
                return;
            }
            reload();
        }).catch(() => {
            setState({kind: 'problem', message: '无法创建本地工作区，请重试。'});
        });
    };

    const undoExpiresAt = taskActionState?.commandState.undoToast?.expiresAt ?? null;
    const undoPausedAt = taskActionState?.commandState.undoToast?.pausedAt ?? null;
    useEffect(() => {
        if (taskActionState === null) {
            return;
        }
        const delay = taskUndoTimerDelayFrom(taskActionState, Date.now());
        if (delay === null) {
            return;
        }

        const timer = globalThis.setTimeout(() => {
            setTaskActionState(current => advanceTaskUndoTimerState(current, Date.now()));
        }, delay);
        return () => globalThis.clearTimeout(timer);
    }, [undoExpiresAt, undoPausedAt]);

    const openSetupWithIntent = (entryIntent: 'default' | 'task'): void => {
        returnFocusRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        setSetupEntryIntent(entryIntent);
        setSetupOpen(true);
    };

    const openSetup = (): void => openSetupWithIntent('default');
    const openTaskSetup = (): void => openSetupWithIntent('task');

    const focusPageHeading = (page: WorkspaceNavigationId): void => {
        globalThis.requestAnimationFrame(() => {
            document.getElementById(PAGE_HEADING_IDS[page])?.focus();
        });
    };

    const closeSetup = (destination: 'current' | 'today'): void => {
        setSetupOpen(false);
        if (destination === 'today') {
            setActivePage('today');
            focusPageHeading('today');
            return;
        }

        const returnTarget = returnFocusRef.current;
        globalThis.requestAnimationFrame(() => {
            if (returnTarget?.isConnected) {
                returnTarget.focus();
            }
            else {
                document.getElementById(PAGE_HEADING_IDS[activePage])?.focus();
            }
        });
    };

    const openDataProtection = (): void => {
        if (state.kind !== 'ready') {
            return;
        }
        migrationReturnFocusRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        setMigrationDialogMode('overview');
        setMigrationRollbackPreview(null);
        setMigrationActionProblem(state.migrationProblem);
        setMigrationDialogOpen(true);
    };

    const closeDataProtection = (): void => {
        if (migrationBusy) {
            return;
        }
        setMigrationDialogOpen(false);
        setMigrationDialogMode('overview');
        setMigrationRollbackPreview(null);
        const returnTarget = migrationReturnFocusRef.current;
        globalThis.requestAnimationFrame(() => {
            if (returnTarget?.isConnected) {
                returnTarget.focus();
            }
        });
    };

    const previewMigrationRollback = (): void => {
        if (migrationBusy || state.kind !== 'ready') {
            return;
        }
        setMigrationBusy(true);
        setMigrationActionProblem(null);
        void window.courseFlow.previewMigrationRollback().then(outcome => {
            if (!outcome.ok) {
                setMigrationActionProblem(outcome.problem.message);
                if (outcome.problem.dataEffect === 'unknown') {
                    reload();
                }
                return;
            }
            if (outcome.value.kind !== 'workspace.migration-rollback-session'
                || outcome.value.session.phase !== 'previewed') {
                setMigrationActionProblem('Workspace 返回了意外的迁移回退预览。');
                return;
            }
            setMigrationRollbackPreview(outcome.value.session);
            setMigrationDialogMode('rollback-preview');
        }).catch(() => {
            setMigrationActionProblem('无法连接本地 Workspace；当前数据没有改变。');
        }).finally(() => setMigrationBusy(false));
    };

    const deleteMigrationSafety = (): void => {
        if (migrationBusy
            || state.kind !== 'ready'
            || state.migrationSafetyCopy.kind !== 'verified') {
            return;
        }
        const safetyCopy = state.migrationSafetyCopy;
        setMigrationBusy(true);
        setMigrationActionProblem(null);
        void window.courseFlow.deleteMigrationSafetyCopy({
            commandId: globalThis.crypto.randomUUID(),
            migrationSafetyCopyId: safetyCopy.migrationSafetyCopyId,
            expectedCopyVersion: safetyCopy.copyVersion,
            confirmationToken: safetyCopy.deleteConfirmationToken,
        }).then(outcome => {
            if (!outcome.ok) {
                setMigrationActionProblem(outcome.problem.message);
                if (outcome.problem.dataEffect === 'unknown') {
                    reload();
                }
                return;
            }
            if (outcome.value.kind !== 'workspace.migration-safety-copy') {
                setMigrationActionProblem('Workspace 返回了意外的迁移安全副本状态。');
                return;
            }
            const nextSafetyCopy = outcome.value.safetyCopy;
            setState(current => current.kind === 'ready'
                ? {...current, migrationSafetyCopy: nextSafetyCopy}
                : current);
            setMigrationDialogMode('overview');
            setMigrationActionProblem('迁移安全副本已删除。');
        }).catch(() => {
            setMigrationActionProblem('删除结果尚无法确认；请重新读取副本状态。');
            reload();
        }).finally(() => setMigrationBusy(false));
    };

    const confirmMigrationRollback = (): void => {
        const preview = migrationRollbackPreview;
        if (migrationBusy
            || state.kind !== 'ready'
            || preview?.phase !== 'previewed'
            || !preview.migrationRollbackSessionId
            || !preview.sessionVersion
            || !preview.previewToken) {
            return;
        }
        setMigrationBusy(true);
        setMigrationActionProblem(null);
        void window.courseFlow.confirmMigrationRollback({
            commandId: globalThis.crypto.randomUUID(),
            migrationRollbackSessionId: preview.migrationRollbackSessionId,
            expectedSessionVersion: preview.sessionVersion,
            previewToken: preview.previewToken,
        }).then(outcome => {
            if (!outcome.ok) {
                setMigrationActionProblem(outcome.problem.message);
                if (outcome.problem.dataEffect === 'unknown') {
                    reload();
                }
                return;
            }
            if (outcome.value.kind !== 'workspace.migration-rollback-session') {
                setMigrationActionProblem('Workspace 返回了意外的迁移回退状态。');
                return;
            }
            setMigrationDialogOpen(false);
            reload();
        }).catch(() => {
            setMigrationActionProblem('确认结果尚无法确认；CourseFlow 将重新检查回退状态。');
            reload();
        }).finally(() => setMigrationBusy(false));
    };

    const runMigrationMaintenanceAction = (
        action: 'cancel-as-source' | 'continue-as-target',
    ): void => {
        if (migrationBusy
            || state.kind !== 'migration-maintenance'
            || !state.session.migrationRollbackSessionId
            || !state.session.sessionVersion) {
            return;
        }
        const retryCommand = state.session.retryCommand?.action === action
            ? state.session.retryCommand
            : null;
        const command = {
            commandId: retryCommand?.commandId ?? globalThis.crypto.randomUUID(),
            migrationRollbackSessionId: state.session.migrationRollbackSessionId,
            expectedSessionVersion: retryCommand?.expectedSessionVersion
                ?? state.session.sessionVersion,
        };
        setMigrationBusy(true);
        setMigrationActionProblem(null);
        const request = action === 'cancel-as-source'
            ? window.courseFlow.cancelMigrationRollback(command)
            : window.courseFlow.continueMigrationRollback(command);
        void request.then(outcome => {
            if (!outcome.ok) {
                setMigrationActionProblem(outcome.problem.message);
                if (outcome.problem.dataEffect === 'unknown') {
                    reload();
                }
                return;
            }
            if (outcome.value.kind !== 'workspace.migration-rollback-session') {
                setMigrationActionProblem('Workspace 返回了意外的迁移回退状态。');
                return;
            }
            if (outcome.value.session.phase === 'succeeded'
                || outcome.value.session.phase === 'cancelled') {
                reload();
                return;
            }
            const nextSession = outcome.value.session;
            setState(current => current.kind === 'migration-maintenance'
                ? {...current, session: nextSession}
                : current);
        }).catch(() => {
            setMigrationActionProblem('操作结果尚无法确认；请重新检查迁移回退状态。');
            reload();
        }).finally(() => setMigrationBusy(false));
    };

    const refreshPlan = useCallback((setup: SetupProjection): void => {
        void loadPlan(window.courseFlow, setup).then(result => {
            setState(current => current.kind === 'ready'
                && current.setup.projection.workspaceRevision === setup.workspaceRevision
                ? { ...current, ...result }
                : current);
        });
    }, []);

    const acceptSetupProjection = (setup: ResolvedSetupState): void => {
        setState(current => current.kind === 'ready'
            ? {
                ...current,
                setup,
                plan: setup.projection.currentTerm === null ? null : current.plan,
                planProblem: null,
            }
            : current);
        refreshPlan(setup.projection);
    };

    const observeTaskActionState = (nextState: TaskOccurrenceActionsState | null): void => {
        setTaskActionState(nextState);
        const problem = nextState?.commandState.problem?.message;
        if (problem !== undefined) {
            setTaskActionProblem(problem);
        }
    };

    const acceptTaskActionResult = (result: WorkspaceTaskActionResult): void => {
        setTaskActionState(result.actionState);
        setTaskActionProblem(result.problem);
        const refresh = result.refresh;
        if (refresh !== null) {
            setState(current => current.kind === 'ready'
                ? {
                    ...current,
                    setup: refresh.setup,
                    plan: refresh.plan,
                    planProblem: null,
                }
                : current);
        }
    };

    const finishUnexpectedTaskActionFailure = (): void => {
        setTaskActionState(null);
        setTaskActionProblem('无法连接本地 Workspace；提交结果尚无法确认。');
    };

    const rememberTaskActionFocus = (itemId: string): void => {
        taskActionFocusRef.current = {
            itemId,
            page: activePage,
            trigger: document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null,
        };
    };

    const restoreTaskActionFocus = (): void => {
        const target = taskActionFocusRef.current;
        taskActionFocusRef.current = null;
        if (target === null) {
            return;
        }

        globalThis.requestAnimationFrame(() => {
            if (taskActionFocusRef.current !== null) {
                return;
            }
            const active = document.activeElement;
            if (active instanceof HTMLElement
                && active !== document.body
                && active !== target.trigger
                && active.isConnected) {
                return;
            }
            if (target.trigger?.isConnected
                && (!(target.trigger instanceof HTMLButtonElement) || !target.trigger.disabled)) {
                focusTaskActionTarget(target.trigger);
                return;
            }
            const row = Array.from(document.querySelectorAll<HTMLElement>('[data-item-id]')).find(candidate => (
                candidate.dataset.itemId === target.itemId
            ));
            const rowAction = row?.querySelector<HTMLButtonElement>('button:not(:disabled)');
            const focusTarget = rowAction ?? row ?? document.getElementById(PAGE_HEADING_IDS[target.page]);
            if (focusTarget !== null) {
                focusTaskActionTarget(focusTarget);
            }
        });
    };

    const runTaskAction = (
        task: PlanTaskProjection,
        action: TaskOccurrenceAction,
    ): void => {
        if (taskActionInFlightRef.current
            || state.kind !== 'ready'
            || state.setup.dataMode === 'read-only'
            || state.plan === null) {
            return;
        }

        const occurrenceId = task.occurrence.occurrenceId;
        const retainedActionState = taskActionState ?? undefined;
        rememberTaskActionFocus(taskPresentationItemId(occurrenceId));
        taskActionInFlightRef.current = true;
        setTaskActionBusyItemId(taskPresentationItemId(occurrenceId));
        setTaskActionProblem(null);
        void runWorkspaceTaskOccurrenceAction({
            bridge: window.courseFlow,
            plan: state.plan,
            occurrenceId,
            action,
            actionState: retainedActionState,
            makeId: () => globalThis.crypto.randomUUID(),
            now: Date.now,
            onStateChange: observeTaskActionState,
        }).then(acceptTaskActionResult).catch(finishUnexpectedTaskActionFailure).finally(() => {
            taskActionInFlightRef.current = false;
            setTaskActionBusyItemId(null);
            restoreTaskActionFocus();
        });
    };

    const undoTaskAction = (): void => {
        const capability = taskActionState?.commandState.undoCapability;
        if (taskActionInFlightRef.current
            || state.kind !== 'ready'
            || state.setup.dataMode === 'read-only'
            || taskActionState === null
            || taskActionState.commandState.undoToast === null
            || capability === null
            || capability === undefined) {
            return;
        }

        const itemId = taskPresentationItemId(capability);
        rememberTaskActionFocus(itemId);
        taskActionInFlightRef.current = true;
        setTaskActionBusyItemId(itemId);
        setTaskActionProblem(null);
        void runWorkspaceTaskOccurrenceUndo({
            bridge: window.courseFlow,
            actionState: taskActionState,
            makeId: () => globalThis.crypto.randomUUID(),
            now: Date.now,
            onStateChange: observeTaskActionState,
        }).then(acceptTaskActionResult).catch(finishUnexpectedTaskActionFailure).finally(() => {
            taskActionInFlightRef.current = false;
            setTaskActionBusyItemId(null);
            restoreTaskActionFocus();
        });
    };

    const setTaskUndoHovered = (hovered: boolean): void => {
        setTaskActionState(current => current === null
            ? null
            : setTaskUndoToastHovered(current, hovered, Date.now()));
    };

    const setTaskUndoFocused = (focused: boolean): void => {
        setTaskActionState(current => current === null
            ? null
            : setTaskUndoToastFocused(current, focused, Date.now()));
    };

    if (state.kind === 'loading') {
        return (
            <div className="startup-frame">
                <WindowTitlebar />
                <main className="startup-surface">
                    <section
                        aria-live="polite"
                        className="status-card"
                    >
                        <p className="eyebrow">CourseFlow</p>
                        <h1>正在读取本地工作区</h1>
                        <p>课程数据仍保存在这台设备上。</p>
                    </section>
                </main>
            </div>
        );
    }

    if (state.kind === 'migration-maintenance') {
        return (
            <div className="startup-frame">
                <WindowTitlebar />
                <MigrationMaintenanceSurface
                    buildStatus={state.buildStatus}
                    busy={migrationBusy}
                    onCancel={() => runMigrationMaintenanceAction('cancel-as-source')}
                    onContinue={() => runMigrationMaintenanceAction('continue-as-target')}
                    onRetry={reload}
                    problem={migrationActionProblem ?? state.problem}
                    session={state.session}
                />
            </div>
        );
    }

    if (state.kind === 'welcome') {
        return (
            <div className="startup-frame">
                <WindowTitlebar />
                <WelcomeSurface onStart={startNewWorkspace} />
            </div>
        );
    }

    if (state.kind === 'maintenance' || state.kind === 'recovery') {
        const recovery = state.kind === 'recovery';
        return (
            <div className="startup-frame">
                <WindowTitlebar />
                <main className="startup-surface">
                    <section
                        aria-labelledby="workspace-lifecycle-title"
                        className={`status-card${recovery ? ' status-card--problem' : ''}`}
                    >
                        <p className="eyebrow">{recovery ? 'Recovery' : 'Maintenance'}</p>
                        <h1 id="workspace-lifecycle-title">
                            {recovery ? '需要恢复本地工作区' : '正在维护本地工作区'}
                        </h1>
                        <p role={recovery ? 'alert' : 'status'}>{state.message}</p>
                        <button
                            className="primary-action"
                            onClick={reload}
                            type="button"
                        >重新检查</button>
                    </section>
                </main>
            </div>
        );
    }

    if (state.kind === 'problem') {
        return (
            <div className="startup-frame">
                <WindowTitlebar />
                <main className="startup-surface">
                    <section
                        aria-labelledby="workspace-problem-title"
                        className="status-card status-card--problem"
                    >
                        <p className="eyebrow">Workspace unavailable</p>
                        <h1 id="workspace-problem-title">暂时无法打开工作区</h1>
                        <p role="alert">{state.message}</p>
                        <button
                            className="primary-action"
                            onClick={reload}
                            type="button"
                        >重试</button>
                    </section>
                </main>
            </div>
        );
    }

    const taskActions: TaskActionPresentation = {
        writable: state.setup.dataMode === 'ready',
        busyItemId: taskActionBusyItemId,
        problem: taskActionProblem,
        canRunAction(task, action): boolean {
            if (taskActionState === null || !hasPendingTaskOccurrenceRequest(taskActionState)) {
                return true;
            }
            return hasPendingTaskOccurrenceAction(
                taskActionState,
                task.occurrence.occurrenceId,
                action,
            );
        },
        undo: taskUndoPresentationFrom(
            taskActionState,
            state.setup.dataMode === 'read-only'
                || taskActionBusyItemId !== null
                || taskActionState?.commandState.submitting === true
                || taskActionState?.commandState.requeryRequest !== null,
        ),
        onAction: runTaskAction,
        onUndo: undoTaskAction,
        onUndoHoverChange: setTaskUndoHovered,
        onUndoFocusChange: setTaskUndoFocused,
    };

    return (
        <>
            <WorkspaceShell
                activePage={activePage}
                dataMode={state.setup.dataMode}
                onNavigate={setActivePage}
                onCreateTask={openTaskSetup}
                onOpenDataProtection={openDataProtection}
                onOpenSetup={openSetup}
                onRetryPlan={() => refreshPlan(state.setup.projection)}
                plan={state.plan}
                planProblem={state.planProblem}
                setup={state.setup.projection}
                taskActions={taskActions}
            />
            <SetupDialog
                entryIntent={setupEntryIntent}
                onClose={closeSetup}
                onProjection={acceptSetupProjection}
                open={setupOpen}
                state={state.setup}
            />
            <MigrationProtectionDialog
                buildStatus={state.buildStatus}
                busy={migrationBusy}
                mode={migrationDialogMode}
                onClose={closeDataProtection}
                onConfirmDelete={deleteMigrationSafety}
                onConfirmRollback={confirmMigrationRollback}
                onModeChange={mode => {
                    setMigrationDialogMode(mode);
                    setMigrationActionProblem(null);
                }}
                onPreviewRollback={previewMigrationRollback}
                open={migrationDialogOpen}
                problem={migrationActionProblem}
                rollbackPreview={migrationRollbackPreview}
                safetyCopy={state.migrationSafetyCopy}
            />
        </>
    );
}

/**
 * Renders the five fixed destinations and one bounded Workspace page.
 *
 * @param {WorkspaceShellProps} props Validated projections and Shell callbacks.
 * @return {ReactElement} Accessible Workspace shell.
 */
export function WorkspaceShell(props: WorkspaceShellProps): ReactElement {
    const navigationRefs = useRef(new Map<WorkspaceNavigationId, HTMLButtonElement>());
    const taskFeedbackVisible = props.taskActions.problem !== null || props.taskActions.undo !== null;

    /**
     * Moves selection and DOM focus together for navigation arrow keys.
     *
     * @param {KeyboardEvent<HTMLButtonElement>} event Navigation key event.
     * @param {WorkspaceNavigationId} currentPage Currently focused destination.
     * @return {void}
     */
    const moveNavigationFocus = (
        event: KeyboardEvent<HTMLButtonElement>,
        currentPage: WorkspaceNavigationId,
    ): void => {
        const target = navigationTargetFromKey(currentPage, event.key);
        if (target === null) {
            return;
        }

        event.preventDefault();
        props.onNavigate(target);
        navigationRefs.current.get(target)?.focus();
    };

    const setupIncomplete = !props.setup.everReachedMinimum;
    return (
        <div className={taskFeedbackVisible
            ? 'workspace-frame workspace-frame--task-feedback'
            : 'workspace-frame'}>
            <a
                className="skip-link"
                href="#workspace-content"
            >跳到主要内容</a>
            <header className="topbar">
                <div
                    aria-label="CourseFlow"
                    className="brand-pill"
                >
                    <span
                        aria-hidden="true"
                        className="brand-symbol"
                    >C</span>
                    <span>CourseFlow</span>
                </div>
                <nav
                    aria-label="主导航"
                    className="primary-nav"
                >
                    {WORKSPACE_NAVIGATION_ITEMS.map(item => (
                        <button
                            aria-current={props.activePage === item.id ? 'page' : undefined}
                            className="navigation-button"
                            key={item.id}
                            onClick={() => props.onNavigate(item.id)}
                            onKeyDown={event => moveNavigationFocus(event, item.id)}
                            ref={element => {
                                if (element === null) {
                                    navigationRefs.current.delete(item.id);
                                }
                                else {
                                    navigationRefs.current.set(item.id, element);
                                }
                            }}
                            type="button"
                        >{item.label}</button>
                    ))}
                </nav>
                <div className="topbar-actions">
                    {props.dataMode === 'read-only' ? (
                        <span className="data-mode-status">只读模式</span>
                    ) : null}
                    {setupIncomplete ? (
                        <span className="setup-status-text">设置未完成</span>
                    ) : null}
                    <button
                        aria-label="打开数据与备份"
                        className="settings-button"
                        onClick={props.onOpenDataProtection}
                        type="button"
                    >数据与备份</button>
                    <button
                        aria-label="打开设置"
                        className="settings-button"
                        onClick={props.onOpenSetup}
                        type="button"
                    >设置</button>
                </div>
                <WindowControls />
            </header>
            <main
                className="workspace-content"
                id="workspace-content"
                tabIndex={-1}
            >
                <WorkspacePage
                    onContinueSetup={props.onOpenSetup}
                    onCreateTask={props.onCreateTask}
                    onNavigate={page => {
                        props.onNavigate(page);
                        globalThis.requestAnimationFrame(() => {
                            document.getElementById(PAGE_HEADING_IDS[page])?.focus();
                        });
                    }}
                    onRetryPlan={props.planProblem === null ? undefined : props.onRetryPlan}
                    page={props.activePage}
                    plan={props.plan}
                    planProblem={props.planProblem}
                    setup={props.setup}
                    setupIncomplete={setupIncomplete}
                    taskActions={props.taskActions}
                />
            </main>
            <TaskActionNotice presentation={props.taskActions} />
            <p
                aria-live="polite"
                className="visually-hidden"
            >当前页面：{props.activePage}</p>
        </div>
    );
}
