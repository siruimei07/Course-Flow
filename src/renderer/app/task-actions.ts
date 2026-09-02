import { ResolvedSetupState } from '../SetupDialog';
import { setupStateFrom } from '../setup-state';
import { TaskOccurrenceAction, advanceTaskOccurrenceActionsState, createTaskOccurrenceActionsState, hasPendingTaskOccurrenceAction, hasPendingTaskOccurrenceRequest, runTaskOccurrenceAction, runTaskOccurrenceUndo } from '../task-occurrence-actions';
import type { TaskOccurrenceActionsState } from '../task-occurrence-actions';
import type { TaskActionPresentation } from '../workspace-pages';
import { planProjectionStateFrom } from '../workspace-view-state';
import type { PlanProjection } from '../../shared/workspace-plan-contract';
import { TaskOccurrenceId, TaskOccurrenceWindow, isTaskOccurrenceWindow } from '../../shared/workspace-task-contract';
import type { TaskSeriesDetailProjection } from '../../shared/workspace-task-contract';
export const MILLISECONDS_PER_DAY = 86_400_000;

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
export function taskPresentationItemId(
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

export type TaskActionFocusRow<T> = Readonly<{
    itemId: string;
    /** Inside a closed `<details>`: in the DOM, but focus() would be a no-op. */
    hidden: boolean;
    element: T;
    action: T | null;
    summary: T | null;
}>;

/**
 * Chooses where focus returns once the pressed button is gone: the acted row's next
 * enabled action, then the row itself; when that row left the visible list (it moved
 * into the folded archive or the filter hides it), the row that followed it, so a
 * keyboard user keeps working down the list; then the summary of the closed disclosure
 * that now holds it; finally the page heading.
 * @param {Object} options Rows as rendered now, the acted and following identities, and the heading.
 * @return {T | null} Element to focus, or null when nothing is left to focus.
 */
export function taskActionFocusTargetFrom<T>(options: Readonly<{
    rows: readonly TaskActionFocusRow<T>[];
    itemId: string;
    nextItemId: string | null;
    heading: T | null;
}>): T | null {
    // One occurrence can render several elements with the same identity (Today shows a Task on
    // the timeline and in its task list), so prefer the match that can actually take focus.
    const rowFor = (itemId: string | null): TaskActionFocusRow<T> | null => {
        const matches = options.rows.filter(row => row.itemId === itemId);
        return matches.find(row => !row.hidden && row.action !== null)
            ?? matches.find(row => !row.hidden)
            ?? matches[0]
            ?? null;
    };
    const row = rowFor(options.itemId);
    const next = rowFor(options.nextItemId);
    const visible = [row, next].find(candidate => candidate !== null && !candidate.hidden) ?? null;
    if (visible !== null) {
        return visible.action ?? visible.element;
    }
    return row?.summary ?? next?.summary ?? options.heading;
}

/**
 * Names the Task row that follows one identity in the rendered order, or null at the end.
 * @param {readonly string[]} itemIds Task row identities in DOM order.
 * @param {string} itemId The acted row.
 * @return {string | null} The following identity.
 */
export function nextTaskItemIdFrom(itemIds: readonly string[], itemId: string): string | null {
    const index = itemIds.indexOf(itemId);
    return index < 0 ? null : itemIds[index + 1] ?? null;
}

/**
 * Selects one matching Task-series detail response.
 * @param {Awaited<ReturnType<TaskActionAppBridge['queryTaskSeries']>>} outcome Workspace response.
 * @param {string} taskSeriesId Requested stable Task-series identity.
 * @return {TaskSeriesDetailProjection | string} Formal detail or a user-facing problem.
 */
export function taskSeriesDetailFrom(
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
export async function refreshAfterTaskAction(
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
export function taskActionReachedFormalProjection(
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
export function settleUnknownTaskTransport(
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
export function taskOccurrenceQueryWindowFrom(
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
