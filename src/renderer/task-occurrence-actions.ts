/**
 * @file Coordinates direct Task occurrence actions through the Workspace bridge.
 */

import {
    advanceTaskCommandState,
    createTaskCommandState,
    receiveTaskCommandOutcome,
    receiveTaskRequeryOutcome,
    receiveTaskUndoOutcome,
    saveTaskDraft,
    setTaskUndoToastPaused,
    startTaskSubmission,
    startTaskUndo,
    type TaskCommandState,
} from './task-command-state';
import type {
    SetTaskOccurrenceStatusCommand,
    TaskOccurrenceId,
    TaskOccurrenceStatus,
    TaskOccurrenceWindow,
    TaskSeriesDetailProjection,
    UndoTaskOccurrenceStateCommand,
} from '../shared/workspace-task-contract';
import type { WorkspaceSetupOutcome } from '../shared/workspace-setup-contract';

export type TaskOccurrenceAction = 'complete' | 'skip' | 'restore';

export type TaskOccurrenceActionPort = Readonly<{
    setTaskOccurrenceStatus(command: SetTaskOccurrenceStatusCommand): Promise<WorkspaceSetupOutcome>;
    undoTaskOccurrenceState(command: UndoTaskOccurrenceStateCommand): Promise<WorkspaceSetupOutcome>;
    queryTaskSeries(
        taskSeriesId: string,
        requestedWindow: TaskOccurrenceWindow,
    ): Promise<WorkspaceSetupOutcome>;
}>;

export type TaskOccurrenceActionsState = Readonly<{
    commandState: TaskCommandState;
    isUndoHovered: boolean;
    isUndoFocused: boolean;
    pendingActionCommand: SetTaskOccurrenceStatusCommand | null;
    pendingUndoCommand: UndoTaskOccurrenceStateCommand | null;
}>;

export type TaskOccurrenceActionOptions = Readonly<{
    port: TaskOccurrenceActionPort;
    makeId(): string;
    now(): number;
    onStateChange(state: TaskOccurrenceActionsState): void;
}>;

/**
 * Maps a direct user action to its formal occurrence status.
 *
 * @const
 * @type {Readonly<Record<TaskOccurrenceAction, TaskOccurrenceStatus>>}
 */
const STATUS_BY_ACTION: Readonly<Record<TaskOccurrenceAction, TaskOccurrenceStatus>> = Object.freeze({
    complete: 'completed',
    skip: 'skipped',
    restore: 'pending',
});

/**
 * Direct actions for a pending occurrence.
 *
 * @const
 * @type {readonly TaskOccurrenceAction[]}
 */
const PENDING_ACTIONS: readonly TaskOccurrenceAction[] = Object.freeze(['complete', 'skip']);

/**
 * Direct action for a completed or skipped occurrence.
 *
 * @const
 * @type {readonly TaskOccurrenceAction[]}
 */
const RESTORE_ACTIONS: readonly TaskOccurrenceAction[] = Object.freeze(['restore']);

/**
 * Empty action set for an occurrence outside the current projection.
 *
 * @const
 * @type {readonly TaskOccurrenceAction[]}
 */
const NO_ACTIONS: readonly TaskOccurrenceAction[] = Object.freeze([]);

/**
 * Creates direct-action state around a Workspace-confirmed Task projection.
 * @param {TaskSeriesDetailProjection} projection - Current formal Task projection.
 * @return {TaskOccurrenceActionsState} Initial direct-action state.
 */
export function createTaskOccurrenceActionsState(
    projection: TaskSeriesDetailProjection,
): TaskOccurrenceActionsState {
    return {
        commandState: createTaskCommandState(projection),
        isUndoHovered: false,
        isUndoFocused: false,
        pendingActionCommand: null,
        pendingUndoCommand: null,
    };
}

/**
 * Reports whether a retained transport-unknown command is the same visible action.
 * @param {TaskOccurrenceActionsState} state Renderer state holding any pending request.
 * @param {TaskOccurrenceId} occurrenceId Stable occurrence selected by the user.
 * @param {TaskOccurrenceAction} action Visible action selected by the user.
 * @return {boolean} Whether retry must reuse the retained command IDs.
 */
function pendingTaskOccurrenceAction(
    state: TaskOccurrenceActionsState,
    occurrenceId: TaskOccurrenceId,
    action: TaskOccurrenceAction,
): SetTaskOccurrenceStatusCommand | null {
    const command = state.pendingActionCommand;
    return command !== null
        && command.intent.payload.taskSeriesId === occurrenceId.taskSeriesId
        && command.intent.payload.originalLogicalAnchor === occurrenceId.originalLogicalAnchor
        && command.intent.payload.status === STATUS_BY_ACTION[action]
        ? command
        : null;
}

/**
 * Reports whether a retained transport-unknown command is the same visible action.
 * @param {TaskOccurrenceActionsState} state Renderer state holding any pending request.
 * @param {TaskOccurrenceId} occurrenceId Stable occurrence selected by the user.
 * @param {TaskOccurrenceAction} action Visible action selected by the user.
 * @return {boolean} Whether retry must reuse the retained command IDs.
 */
export function hasPendingTaskOccurrenceAction(
    state: TaskOccurrenceActionsState,
    occurrenceId: TaskOccurrenceId,
    action: TaskOccurrenceAction,
): boolean {
    return pendingTaskOccurrenceAction(state, occurrenceId, action) !== null;
}

/**
 * Reports whether one transport-unknown mutation still owns the action surface.
 * @param {TaskOccurrenceActionsState} state Renderer state holding retained requests.
 * @return {boolean} Whether only the exact retained request may be retried.
 */
export function hasPendingTaskOccurrenceRequest(state: TaskOccurrenceActionsState): boolean {
    return state.pendingActionCommand !== null || state.pendingUndoCommand !== null;
}

/**
 * Finds the formal status for one projected occurrence.
 * @param {TaskSeriesDetailProjection} projection - Current formal Task projection.
 * @param {TaskOccurrenceId} occurrenceId - Stable occurrence identity.
 * @return {TaskOccurrenceStatus | null} Current status, or null when the occurrence is absent.
 */
function findTaskOccurrenceStatus(
    projection: TaskSeriesDetailProjection,
    occurrenceId: TaskOccurrenceId,
): TaskOccurrenceStatus | null {
    const occurrence = projection.occurrences.find(candidate => (
        candidate.occurrenceId.taskSeriesId === occurrenceId.taskSeriesId
        && candidate.occurrenceId.originalLogicalAnchor === occurrenceId.originalLogicalAnchor
    ));
    return occurrence?.status ?? null;
}

/**
 * Reports whether a direct action is valid for the current formal status.
 * @param {TaskOccurrenceStatus} status - Current formal occurrence status.
 * @param {TaskOccurrenceAction} action - Requested direct action.
 * @return {boolean} Whether the action is currently available.
 */
function isTaskOccurrenceActionAvailable(
    status: TaskOccurrenceStatus,
    action: TaskOccurrenceAction,
): boolean {
    return status === 'pending' ? action !== 'restore' : action === 'restore';
}

/**
 * Lists the direct actions valid for one formally projected occurrence.
 * @param {TaskOccurrenceActionsState} state - Current Renderer action state.
 * @param {TaskOccurrenceId} occurrenceId - Stable occurrence identity.
 * @return {readonly TaskOccurrenceAction[]} Available direct actions in display order.
 */
export function availableTaskOccurrenceActions(
    state: TaskOccurrenceActionsState,
    occurrenceId: TaskOccurrenceId,
): readonly TaskOccurrenceAction[] {
    const projection = state.commandState.projection;
    if (projection === null) {
        return NO_ACTIONS;
    }
    const status = findTaskOccurrenceStatus(projection, occurrenceId);
    if (status === null) {
        return NO_ACTIONS;
    }
    return status === 'pending' ? PENDING_ACTIONS : RESTORE_ACTIONS;
}

/**
 * Applies the combined hover/focus state to the Undo Toast clock.
 * @param {TaskOccurrenceActionsState} state - Current Renderer action state.
 * @param {boolean} isUndoHovered - Whether the Toast has pointer hover.
 * @param {boolean} isUndoFocused - Whether the Toast contains keyboard focus.
 * @param {number} now - Current Unix milliseconds.
 * @return {TaskOccurrenceActionsState} State with the correct combined pause behavior.
 */
function setTaskUndoToastInteraction(
    state: TaskOccurrenceActionsState,
    isUndoHovered: boolean,
    isUndoFocused: boolean,
    now: number,
): TaskOccurrenceActionsState {
    return {
        ...state,
        isUndoHovered,
        isUndoFocused,
        commandState: setTaskUndoToastPaused(
            state.commandState,
            isUndoHovered || isUndoFocused,
            now,
        ),
    };
}

/**
 * Pauses or resumes Undo expiry for pointer hover without overriding focus.
 * @param {TaskOccurrenceActionsState} state - Current Renderer action state.
 * @param {boolean} isHovered - Whether the pointer is inside the Undo Toast.
 * @param {number} now - Current Unix milliseconds.
 * @return {TaskOccurrenceActionsState} Updated interaction and Toast state.
 */
export function setTaskUndoToastHovered(
    state: TaskOccurrenceActionsState,
    isHovered: boolean,
    now: number,
): TaskOccurrenceActionsState {
    return setTaskUndoToastInteraction(state, isHovered, state.isUndoFocused, now);
}

/**
 * Pauses or resumes Undo expiry for keyboard focus without overriding hover.
 * @param {TaskOccurrenceActionsState} state - Current Renderer action state.
 * @param {boolean} isFocused - Whether keyboard focus is inside the Undo Toast.
 * @param {number} now - Current Unix milliseconds.
 * @return {TaskOccurrenceActionsState} Updated interaction and Toast state.
 */
export function setTaskUndoToastFocused(
    state: TaskOccurrenceActionsState,
    isFocused: boolean,
    now: number,
): TaskOccurrenceActionsState {
    return setTaskUndoToastInteraction(state, state.isUndoHovered, isFocused, now);
}

/**
 * Removes an expired Undo Toast unless hover or focus currently pauses it.
 * @param {TaskOccurrenceActionsState} state - Current Renderer action state.
 * @param {number} now - Current Unix milliseconds.
 * @return {TaskOccurrenceActionsState} State advanced to the supplied time.
 */
export function advanceTaskOccurrenceActionsState(
    state: TaskOccurrenceActionsState,
    now: number,
): TaskOccurrenceActionsState {
    return {
        ...state,
        commandState: advanceTaskCommandState(state.commandState, now),
    };
}

/**
 * Runs one direct completion, skip, or restore and refreshes formal state from Workspace.
 * @param {TaskOccurrenceActionsState} state - Current Renderer action state.
 * @param {TaskOccurrenceId} occurrenceId - Stable occurrence identity.
 * @param {TaskOccurrenceAction} action - Direct action selected by the user.
 * @param {TaskOccurrenceActionOptions} options - Workspace, identity, clock, and observation ports.
 * @return {Promise<TaskOccurrenceActionsState>} Last state reached by the bounded operation.
 */
export async function runTaskOccurrenceAction(
    state: TaskOccurrenceActionsState,
    occurrenceId: TaskOccurrenceId,
    action: TaskOccurrenceAction,
    options: TaskOccurrenceActionOptions,
): Promise<TaskOccurrenceActionsState> {
    const projection = state.commandState.projection;
    if (state.commandState.submitting
        || projection === null
        || (hasPendingTaskOccurrenceRequest(state)
            && !hasPendingTaskOccurrenceAction(state, occurrenceId, action))) {
        return state;
    }

    const status = findTaskOccurrenceStatus(projection, occurrenceId);
    if (status === null || !isTaskOccurrenceActionAvailable(status, action)) {
        return state;
    }

    const retainedCommand = pendingTaskOccurrenceAction(
        state,
        occurrenceId,
        action,
    );
    const command: SetTaskOccurrenceStatusCommand = retainedCommand ?? {
        commandId: options.makeId(),
        followUpId: options.makeId(),
        expectedRevision: projection.workspaceRevision,
        expectedPlanVersion: projection.planEntityVersion,
        expectedTaskSeriesVersion: projection.entityVersion,
        intent: {
            kind: 'plan.set-task-occurrence-status',
            intentSchemaVersion: 2,
            payload: {
                taskSeriesId: occurrenceId.taskSeriesId,
                originalLogicalAnchor: occurrenceId.originalLogicalAnchor,
                status: STATUS_BY_ACTION[action],
            },
        },
    };
    let nextState: TaskOccurrenceActionsState = {
        ...state,
        commandState: startTaskSubmission(saveTaskDraft(state.commandState, command)),
        pendingActionCommand: command,
    };
    options.onStateChange(nextState);

    const commandOutcome = await options.port.setTaskOccurrenceStatus(command);
    const retainPendingCommand = !commandOutcome.ok
        && commandOutcome.problem.dataEffect === 'unknown';
    nextState = {
        ...nextState,
        commandState: receiveTaskCommandOutcome(nextState.commandState, commandOutcome, options.now()),
        pendingActionCommand: retainPendingCommand ? command : null,
    };
    options.onStateChange(nextState);

    const requeryRequest = nextState.commandState.requeryRequest;
    if (requeryRequest === null || requeryRequest.kind !== 'task-series-detail') {
        return nextState;
    }

    const requeryOutcome = await options.port.queryTaskSeries(
        requeryRequest.taskSeriesId,
        projection.requestedWindow,
    );
    nextState = {
        ...nextState,
        commandState: receiveTaskRequeryOutcome(nextState.commandState, requeryOutcome),
    };
    options.onStateChange(nextState);
    return nextState;
}

/**
 * Runs the visible occurrence Undo and refreshes formal state from Workspace.
 * @param {TaskOccurrenceActionsState} state - Current Renderer action state.
 * @param {TaskOccurrenceActionOptions} options - Workspace, identity, clock, and observation ports.
 * @return {Promise<TaskOccurrenceActionsState>} Last state reached by the bounded operation.
 */
export async function runTaskOccurrenceUndo(
    state: TaskOccurrenceActionsState,
    options: TaskOccurrenceActionOptions,
): Promise<TaskOccurrenceActionsState> {
    if (state.pendingActionCommand !== null) {
        return state;
    }
    const now = options.now();
    const currentState = state.pendingUndoCommand === null
        ? advanceTaskOccurrenceActionsState(state, now)
        : state;
    const projection = currentState.commandState.projection;
    const capability = currentState.commandState.undoCapability;
    if (currentState.commandState.submitting
        || currentState.commandState.requeryRequest !== null
        || currentState.commandState.undoToast === null
        || projection === null
        || capability === null
        || projection.taskSeriesId !== capability.taskSeriesId
        || projection.entityVersion !== capability.validThroughTaskSeriesVersion) {
        if (currentState !== state) {
            options.onStateChange(currentState);
        }
        return currentState;
    }

    const retainedCommand = currentState.pendingUndoCommand;
    const command: UndoTaskOccurrenceStateCommand = retainedCommand !== null
        && retainedCommand.intent.payload.token === capability.token
        && retainedCommand.intent.payload.taskSeriesId === capability.taskSeriesId
        && retainedCommand.intent.payload.originalLogicalAnchor === capability.originalLogicalAnchor
        ? retainedCommand
        : {
            commandId: options.makeId(),
            followUpId: options.makeId(),
            expectedRevision: projection.workspaceRevision,
            expectedPlanVersion: projection.planEntityVersion,
            expectedTaskSeriesVersion: projection.entityVersion,
            intent: {
                kind: 'plan.undo-task-occurrence-state',
                intentSchemaVersion: 1,
                payload: {
                    token: capability.token,
                    taskSeriesId: capability.taskSeriesId,
                    originalLogicalAnchor: capability.originalLogicalAnchor,
                },
            },
        };
    let nextState: TaskOccurrenceActionsState = {
        ...currentState,
        commandState: startTaskUndo(currentState.commandState),
        pendingUndoCommand: command,
    };
    options.onStateChange(nextState);

    const undoOutcome = await options.port.undoTaskOccurrenceState(command);
    const retainPendingCommand = !undoOutcome.ok
        && undoOutcome.problem.dataEffect === 'unknown';
    const receivedCommandState = receiveTaskUndoOutcome(nextState.commandState, undoOutcome);
    nextState = {
        ...nextState,
        commandState: retainPendingCommand
            ? {
                ...receivedCommandState,
                undoCapability: nextState.commandState.undoCapability,
                undoToast: nextState.commandState.undoToast,
            }
            : receivedCommandState,
        isUndoHovered: retainPendingCommand ? nextState.isUndoHovered : false,
        isUndoFocused: retainPendingCommand ? nextState.isUndoFocused : false,
        pendingUndoCommand: retainPendingCommand ? command : null,
    };
    options.onStateChange(nextState);

    const requeryRequest = nextState.commandState.requeryRequest;
    if (requeryRequest === null || requeryRequest.kind !== 'task-series-detail') {
        return nextState;
    }

    const requeryOutcome = await options.port.queryTaskSeries(
        requeryRequest.taskSeriesId,
        projection.requestedWindow,
    );
    nextState = {
        ...nextState,
        commandState: receiveTaskRequeryOutcome(nextState.commandState, requeryOutcome),
    };
    options.onStateChange(nextState);
    return nextState;
}
