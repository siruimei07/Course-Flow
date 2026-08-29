import { CreateCourseCommand, CreateMeetingSeriesCommand } from '../../shared/workspace-course-contract';
import { CreateHolidayRangeCommand } from '../../shared/workspace-holiday-contract';
import { WorkspaceSetupOutcome, WorkspaceSetupProblem } from '../../shared/workspace-setup-contract';
import { CreateTaskCommand } from '../../shared/workspace-task-contract';
import { CreateTermCommand } from '../../shared/workspace-term-contract';
export type SetupCheckpointTarget = Readonly<{
    schemaVersion: 1;
    opaquePayload: string;
}> | null;

export type PendingSetupMutation =
    | Readonly<{ kind: 'term'; command: CreateTermCommand }>
    | Readonly<{ kind: 'course'; command: CreateCourseCommand }>
    | Readonly<{ kind: 'meeting'; command: CreateMeetingSeriesCommand }>
    | Readonly<{ kind: 'task'; command: CreateTaskCommand }>
    | Readonly<{ kind: 'holiday'; command: CreateHolidayRangeCommand }>;

export type PendingSetupMutationState = Readonly<{
    pending: PendingSetupMutation | null;
}>;

export type PendingSetupMutationEvent =
    | Readonly<{ kind: 'retain-unknown'; pending: PendingSetupMutation }>
    | Readonly<{ kind: 'resolved' }>
    | Readonly<{
        kind: 'exit-attempted' | 'branch-switch-attempted' | 'projection-advanced';
    }>;

export type SetupMutationRetryPort = Readonly<{
    createTerm(command: CreateTermCommand): Promise<WorkspaceSetupOutcome>;
    createCourse(command: CreateCourseCommand): Promise<WorkspaceSetupOutcome>;
    createMeetingSeries(command: CreateMeetingSeriesCommand): Promise<WorkspaceSetupOutcome>;
    createTask(command: CreateTaskCommand): Promise<WorkspaceSetupOutcome>;
    createHolidayRange(command: CreateHolidayRangeCommand): Promise<WorkspaceSetupOutcome>;
}>;

/**
 * Retains one ambiguous mutation across UI-only boundaries until Workspace resolves it.
 * @param {PendingSetupMutationState} state Current unresolved Setup request.
 * @param {PendingSetupMutationEvent} event Mutation result or attempted UI boundary.
 * @return {PendingSetupMutationState} Lifecycle state with exact command identity preserved.
 */
export function reducePendingSetupMutation(
    state: PendingSetupMutationState,
    event: PendingSetupMutationEvent,
): PendingSetupMutationState {
    if (event.kind === 'retain-unknown') {
        return { pending: event.pending };
    }
    return event.kind === 'resolved' ? { pending: null } : state;
}

/**
 * Retries the exact retained Setup command through its original Workspace mutation.
 * @param {PendingSetupMutation} pending Ambiguous request including original command IDs.
 * @param {SetupMutationRetryPort} port Bounded Setup mutation bridge.
 * @return {Promise<WorkspaceSetupOutcome>} Correlated Workspace result for that same command.
 */
export function retryPendingSetupMutation(
    pending: PendingSetupMutation,
    port: SetupMutationRetryPort,
): Promise<WorkspaceSetupOutcome> {
    switch (pending.kind) {
        case 'term':
            return port.createTerm(pending.command);
        case 'course':
            return port.createCourse(pending.command);
        case 'meeting':
            return port.createMeetingSeries(pending.command);
        case 'task':
            return port.createTask(pending.command);
        case 'holiday':
            return port.createHolidayRange(pending.command);
    }
}

/**
 * Describes a failed Setup mutation without guessing whether a sent request committed.
 * @param {WorkspaceSetupProblem} problem Structured Workspace mutation problem.
 * @param {string} unchangedStatement Exact statement for a known unchanged result.
 * @return {string} User-facing status that preserves the problem's data-effect truth.
 */
export function setupMutationProblemMessage(
    problem: WorkspaceSetupProblem,
    unchangedStatement: string,
): string {
    return problem.dataEffect === 'unknown'
        ? `${problem.message} 结果尚无法确认；全部输入、草稿和本次请求仍保留，请重试或重新打开设置核对。`
        : `${problem.message} ${unchangedStatement}`;
}

/**
 * Checks whether a correlated Setup projection proves the requested checkpoint state.
 * @param {WorkspaceSetupOutcome} outcome Candidate direct response or reconciliation query.
 * @param {string} expectedVersion Version observed before the checkpoint mutation.
 * @param {SetupCheckpointTarget} expectedCheckpoint Exact saved payload, or null after discard.
 * @return {boolean} Whether the projection proves the requested checkpoint state.
 */
export function setupCheckpointMatches(
    outcome: WorkspaceSetupOutcome,
    expectedVersion: string,
    expectedCheckpoint: SetupCheckpointTarget,
): boolean {
    if (!outcome.ok || outcome.value.kind !== 'workspace.setup-projection') {
        return false;
    }
    const projection = outcome.value.projection;
    if (BigInt(projection.draftCheckpointVersion) <= BigInt(expectedVersion)) {
        return false;
    }
    if (expectedCheckpoint === null) {
        return projection.draftCheckpoint === null;
    }
    return projection.draftCheckpoint?.schemaVersion === expectedCheckpoint.schemaVersion
        && projection.draftCheckpoint.opaquePayload === expectedCheckpoint.opaquePayload;
}

/**
 * Requeries checkpoint truth only when a sent mutation did not prove its own result.
 * @param {WorkspaceSetupOutcome | null} outcome Direct response, or null after transport rejection.
 * @param {string} expectedVersion Version observed before the checkpoint mutation.
 * @param {SetupCheckpointTarget} expectedCheckpoint Exact saved payload, or null after discard.
 * @param {Function} querySetup Bounded read used to reconcile persisted checkpoint truth.
 * @return {Promise<WorkspaceSetupOutcome | null>} Projection proving the target, or null.
 */
export async function reconcileSetupCheckpoint(
    outcome: WorkspaceSetupOutcome | null,
    expectedVersion: string,
    expectedCheckpoint: SetupCheckpointTarget,
    querySetup: () => Promise<WorkspaceSetupOutcome>,
): Promise<WorkspaceSetupOutcome | null> {
    if (outcome !== null && setupCheckpointMatches(outcome, expectedVersion, expectedCheckpoint)) {
        return outcome;
    }
    if (outcome !== null
        && !outcome.ok
        && outcome.problem.dataEffect === 'unchanged'
        && outcome.problem.code !== 'conflict') {
        return null;
    }
    try {
        const queriedOutcome = await querySetup();
        return setupCheckpointMatches(queriedOutcome, expectedVersion, expectedCheckpoint)
            ? queriedOutcome
            : null;
    }
    catch {
        return null;
    }
}
