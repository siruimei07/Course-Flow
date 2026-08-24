/**
 * @file Coordinates Renderer-only Task command state without owning Task facts.
 */

import type {
    TaskCommand,
    TaskOccurrenceImpactProjection,
    TaskSeriesDetailProjection,
    TaskUndoCapability,
} from '../shared/workspace-task-contract';
import type {
    WorkspaceSetupOutcome,
    WorkspaceSetupProblem,
} from '../shared/workspace-setup-contract';

const UNDO_TOAST_DURATION_MS = 6_000;

export type TaskUndoToast = Readonly<{
    capability: TaskUndoCapability;
    expiresAt: number;
    pausedAt: number | null;
}>;

export type TaskRequeryRequest = Readonly<{
    kind: 'task-series-detail' | 'task-list';
    taskSeriesId: string;
    committedRevision: string;
    minimumTaskSeriesVersion: string;
    submittedDraft: TaskCommand | null;
}>;

export type TaskCommandState = Readonly<{
    draft: TaskCommand | null;
    submitting: boolean;
    submissionDraft: TaskCommand | null;
    undoSubmission: TaskUndoCapability | null;
    requeryRequest: TaskRequeryRequest | null;
    projection: TaskSeriesDetailProjection | null;
    impactProjection: TaskOccurrenceImpactProjection | null;
    problem: WorkspaceSetupProblem | null;
    pendingFollowUps: readonly string[];
    undoCapability: TaskUndoCapability | null;
    undoToast: TaskUndoToast | null;
}>;

/**
 * Creates the Renderer state around the last Workspace-confirmed Task projection.
 * @param {TaskSeriesDetailProjection} projection - Formal Task projection already returned by Workspace.
 * @return {TaskCommandState} Empty Task command state.
 */
export function createTaskCommandState(projection: TaskSeriesDetailProjection): TaskCommandState {
    return {
        draft: null,
        submitting: false,
        submissionDraft: null,
        undoSubmission: null,
        requeryRequest: null,
        projection,
        impactProjection: null,
        problem: null,
        pendingFollowUps: Object.freeze([]),
        undoCapability: null,
        undoToast: null,
    };
}

/**
 * Saves the current Task draft without changing the formal projection.
 * @param {TaskCommandState} state - Current Renderer command state.
 * @param {TaskCommand} draft - Locally editable Task command draft.
 * @return {TaskCommandState} State retaining the newly saved draft.
 */
export function saveTaskDraft(state: TaskCommandState, draft: TaskCommand): TaskCommandState {
    return { ...state, draft, impactProjection: null };
}

/**
 * Marks a saved Task command as in flight.
 * @param {TaskCommandState} state - Current Renderer command state.
 * @return {TaskCommandState} Submitting state with any older problem dismissed.
 */
export function startTaskSubmission(state: TaskCommandState): TaskCommandState {
    return {
        ...state,
        submitting: true,
        submissionDraft: state.draft,
        undoSubmission: null,
        problem: null,
    };
}

function taskSeriesIdFromDraft(draft: TaskCommand): string | null {
    if (draft.intent.kind === 'plan.create-task-series') {
        return null;
    }
    return draft.intent.payload.taskSeriesId;
}

function requiresTaskListRefresh(draft: TaskCommand): boolean {
    return draft.intent.kind === 'plan.delete-task-series'
        || (draft.intent.kind === 'plan.delete-task-occurrence-or-series'
            && draft.intent.payload.scope === 'whole-series');
}

function taskUndoStateAfterProjection(
    state: TaskCommandState,
    taskSeriesId: string,
    taskSeriesVersion: string | null,
): Pick<TaskCommandState, 'undoCapability' | 'undoToast' | 'undoSubmission'> {
    const isInvalid = (capability: TaskUndoCapability): boolean => (
        capability.taskSeriesId === taskSeriesId
        && (taskSeriesVersion === null
            || BigInt(taskSeriesVersion) > BigInt(capability.validThroughTaskSeriesVersion))
    );
    return {
        undoCapability: state.undoCapability !== null && isInvalid(state.undoCapability)
            ? null
            : state.undoCapability,
        undoToast: state.undoToast !== null && isInvalid(state.undoToast.capability)
            ? null
            : state.undoToast,
        undoSubmission: state.undoSubmission !== null && isInvalid(state.undoSubmission)
            ? null
            : state.undoSubmission,
    };
}

/**
 * Records the exact Workspace response to a Task command.
 * @param {TaskCommandState} state - Current Renderer command state.
 * @param {WorkspaceSetupOutcome} outcome - Validated Workspace command response.
 * @param {number} now - Injected current Unix milliseconds for deterministic Toast expiry.
 * @return {TaskCommandState} State that either retains its draft or requests a formal requery.
 */
export function receiveTaskCommandOutcome(
    state: TaskCommandState,
    outcome: WorkspaceSetupOutcome,
    now: number,
): TaskCommandState {
    if (!outcome.ok) {
        return {
            ...state,
            submitting: false,
            submissionDraft: null,
            impactProjection: null,
            problem: outcome.problem,
        };
    }
    if (outcome.value.kind !== 'workspace.command-outcome') {
        return { ...state, submitting: false, submissionDraft: null };
    }

    const submittedDraft = state.submissionDraft;
    const result = outcome.value.outcome;
    const effect = result.effects.length === 1 ? result.effects[0] : null;
    if (submittedDraft === null
        || effect === null
        || effect.entity.kind !== 'task-series'
        || (taskSeriesIdFromDraft(submittedDraft) !== null
            && taskSeriesIdFromDraft(submittedDraft) !== effect.entity.id)) {
        return { ...state, submitting: false, submissionDraft: null };
    }

    const undoCapability = result.undoCapability ?? null;
    return {
        ...state,
        submitting: false,
        submissionDraft: null,
        requeryRequest: {
            kind: requiresTaskListRefresh(submittedDraft) ? 'task-list' : 'task-series-detail',
            taskSeriesId: effect.entity.id,
            committedRevision: result.revision,
            minimumTaskSeriesVersion: effect.entity.version,
            submittedDraft,
        },
        impactProjection: null,
        problem: null,
        pendingFollowUps: Object.freeze([...result.pendingFollowUps]),
        undoCapability,
        undoToast: undoCapability === null
            ? null
            : {
                capability: undoCapability,
                expiresAt: now + UNDO_TOAST_DURATION_MS,
                pausedAt: null,
            },
    };
}

/**
 * Records a Workspace impact preview without treating it as committed Task state.
 * @param {TaskCommandState} state - Current Renderer command state.
 * @param {WorkspaceSetupOutcome} outcome - Validated Workspace preview response.
 * @return {TaskCommandState} State carrying either a confirmable preview or its problem.
 */
export function receiveTaskPreviewOutcome(
    state: TaskCommandState,
    outcome: WorkspaceSetupOutcome,
): TaskCommandState {
    if (!outcome.ok) {
        return { ...state, impactProjection: null, problem: outcome.problem };
    }
    if (outcome.value.kind !== 'workspace.task-occurrence-impact') {
        return state;
    }
    return { ...state, impactProjection: outcome.value.projection, problem: null };
}

/**
 * Applies only a successful Task requery; a command receipt is never a replacement projection.
 * @param {TaskCommandState} state - Current Renderer command state.
 * @param {WorkspaceSetupOutcome} outcome - Validated Workspace Task-series query response.
 * @return {TaskCommandState} State updated from a current formal projection when available.
 */
export function receiveTaskRequeryOutcome(
    state: TaskCommandState,
    outcome: WorkspaceSetupOutcome,
): TaskCommandState {
    if (!outcome.ok) {
        return { ...state, problem: outcome.problem };
    }
    const request = state.requeryRequest;
    if (request === null) {
        return state;
    }

    if (request.kind === 'task-series-detail') {
        if (outcome.value.kind !== 'workspace.task-series-projection'
            || outcome.value.projection.taskSeriesId !== request.taskSeriesId
            || BigInt(outcome.value.projection.workspaceRevision) < BigInt(request.committedRevision)
            || BigInt(outcome.value.projection.entityVersion)
                < BigInt(request.minimumTaskSeriesVersion)) {
            return state;
        }
        return {
            ...state,
            ...taskUndoStateAfterProjection(
                state,
                request.taskSeriesId,
                outcome.value.projection.entityVersion,
            ),
            draft: state.draft === request.submittedDraft ? null : state.draft,
            requeryRequest: null,
            projection: outcome.value.projection,
            problem: null,
        };
    }

    if (outcome.value.kind !== 'workspace.setup-projection'
        || BigInt(outcome.value.projection.workspaceRevision) < BigInt(request.committedRevision)
        || outcome.value.projection.tasks.some(task => task.taskSeriesId === request.taskSeriesId)) {
        return state;
    }
    return {
        ...state,
        ...taskUndoStateAfterProjection(state, request.taskSeriesId, null),
        draft: state.draft === request.submittedDraft ? null : state.draft,
        requeryRequest: null,
        projection: null,
        problem: null,
    };
}

/**
 * Marks an Undo request as in flight while preserving the last formal projection.
 * @param {TaskCommandState} state - Current Renderer command state.
 * @return {TaskCommandState} Submitting state for the Undo command.
 */
export function startTaskUndo(state: TaskCommandState): TaskCommandState {
    return {
        ...state,
        submitting: true,
        submissionDraft: null,
        undoSubmission: state.undoCapability,
        problem: null,
    };
}

/**
 * Records an Undo response without inferring an optimistic Task projection.
 * @param {TaskCommandState} state - Current Renderer command state.
 * @param {WorkspaceSetupOutcome} outcome - Validated Workspace Undo response.
 * @return {TaskCommandState} State retaining the projection and any reported problem.
 */
export function receiveTaskUndoOutcome(
    state: TaskCommandState,
    outcome: WorkspaceSetupOutcome,
): TaskCommandState {
    if (!outcome.ok) {
        const submittedCapability = state.undoSubmission;
        return {
            ...state,
            submitting: false,
            undoSubmission: null,
            problem: outcome.problem,
            undoCapability: outcome.problem.code === 'conflict'
                && state.undoCapability === submittedCapability
                ? null
                : state.undoCapability,
            undoToast: null,
        };
    }
    if (outcome.value.kind !== 'workspace.command-outcome') {
        return { ...state, submitting: false, undoSubmission: null, undoToast: null };
    }

    const submittedCapability = state.undoSubmission;
    const result = outcome.value.outcome;
    const effect = result.effects.length === 1 ? result.effects[0] : null;
    if (submittedCapability === null
        || effect === null
        || effect.code !== 'plan.task-occurrence-state-undone'
        || effect.entity.kind !== 'task-series'
        || effect.entity.id !== submittedCapability.taskSeriesId) {
        return { ...state, submitting: false, undoSubmission: null, undoToast: null };
    }
    return {
        ...state,
        submitting: false,
        undoSubmission: null,
        requeryRequest: {
            kind: 'task-series-detail',
            taskSeriesId: effect.entity.id,
            committedRevision: result.revision,
            minimumTaskSeriesVersion: effect.entity.version,
            submittedDraft: null,
        },
        problem: null,
        pendingFollowUps: Object.freeze([...result.pendingFollowUps]),
        undoCapability: state.undoCapability === submittedCapability ? null : state.undoCapability,
        undoToast: null,
    };
}

/**
 * Pauses or resumes the visible Undo Toast lifetime during pointer or keyboard interaction.
 * @param {TaskCommandState} state - Current Renderer command state.
 * @param {boolean} paused - Whether interaction should pause the Toast lifetime.
 * @param {number} now - Injected current Unix milliseconds.
 * @return {TaskCommandState} State with the Toast clock paused or shifted on resume.
 */
export function setTaskUndoToastPaused(
    state: TaskCommandState,
    paused: boolean,
    now: number,
): TaskCommandState {
    const toast = state.undoToast;
    if (toast === null) {
        return state;
    }
    if (paused) {
        if (toast.pausedAt !== null) {
            return state;
        }
        if (now >= toast.expiresAt) {
            return { ...state, undoToast: null };
        }
        return { ...state, undoToast: { ...toast, pausedAt: now } };
    }
    if (toast.pausedAt === null) {
        return state;
    }
    return {
        ...state,
        undoToast: {
            ...toast,
            expiresAt: toast.expiresAt + Math.max(0, now - toast.pausedAt),
            pausedAt: null,
        },
    };
}

/**
 * Hides an expired Undo Toast while keeping the separate pending restore capability available.
 * @param {TaskCommandState} state - Current Renderer command state.
 * @param {number} now - Injected current Unix milliseconds.
 * @return {TaskCommandState} State with the Toast removed only after its six-second lifetime.
 */
export function advanceTaskCommandState(state: TaskCommandState, now: number): TaskCommandState {
    if (
        state.undoToast === null
        || state.undoToast.pausedAt !== null
        || now < state.undoToast.expiresAt
    ) {
        return state;
    }
    return { ...state, undoToast: null };
}
