/**
 * @file Defines bounded setup and PLAN requests crossing the Workspace boundary.
 */

import {
    isCourseProjection,
    isMeetingOccurrenceImpactProjection,
    isMeetingOverlapWarning,
    isMeetingOccurrenceWindow,
    isMeetingSeriesDetailProjection,
    MAX_MEETING_OVERLAP_WARNINGS,
    normalizeCancelMeetingOccurrenceCommand,
    normalizeChangeMeetingOccurrenceCommand,
    normalizeCreateCourseCommand,
    normalizeCreateMeetingSeriesCommand,
    normalizeMeetingOccurrenceImpactDraft,
    normalizeAcceptedCreateCourseWithMeetingCommand,
    type AcceptedCreateCourseWithMeetingCommand,
    type CancelMeetingOccurrenceCommand,
    type ChangeMeetingOccurrenceCommand,
    type CourseProjection,
    type CreateCourseCommand,
    type CreateMeetingSeriesCommand,
    type MeetingSeriesDetailProjection,
    type MeetingOccurrenceWindow,
    type MeetingOccurrenceImpactDraft,
    type MeetingOccurrenceImpactProjection,
    type MeetingOverlapWarning,
} from './workspace-course-contract';
import {
    BOOTSTRAP_PROTOCOL_VERSION,
    type WorkspaceDataStatus,
} from './bootstrap-contract';
import {
    isCanonicalUnsignedSqliteInteger,
    isCanonicalUuid,
} from './workspace-data-contract';
import {
    isDataProtectionProjection,
    isRestoreSessionView,
    normalizeCancelRestoreSessionCommand,
    normalizeConfirmRestoreSessionCommand,
    normalizeConfigureBackupDestinationCommand,
    normalizeResumeRestoreSessionCommand,
    normalizeRollbackRestoreSessionCommand,
    normalizeStartRestoreSessionCommand,
    type CancelRestoreSessionCommand,
    type ConfirmRestoreSessionCommand,
    type ConfigureBackupDestinationCommand,
    type DataProtectionProjection,
    type RestoreSessionView,
    type ResumeRestoreSessionCommand,
    type RollbackRestoreSessionCommand,
    type StartRestoreSessionCommand,
} from './workspace-protection-contract';
import {
    isHolidayRangeProjection,
    normalizeCreateHolidayRangeCommand,
    normalizeDeleteHolidayRangeCommand,
    normalizeUpdateHolidayRangeCommand,
    type CreateHolidayRangeCommand,
    type DeleteHolidayRangeCommand,
    type HolidayRangeProjection,
    type UpdateHolidayRangeCommand,
} from './workspace-holiday-contract';
import {
    isPlanProjection,
    type PlanProjection,
} from './workspace-plan-contract';
import { isCanonicalInstant } from './meeting-time';
import {
    isTaskOccurrenceWindow,
    isTaskOccurrenceImpactProjection,
    isTaskProjection,
    isTaskSeriesDetailProjection,
    normalizeChangeTaskOccurrenceCommand,
    normalizeCompleteTaskCommand,
    normalizeCreateTaskCommand,
    normalizeDeleteTaskOccurrenceOrSeriesCommand,
    normalizeDeleteTaskCommand,
    normalizeSetTaskOccurrenceStatusCommand,
    normalizeSetTaskProgressCommand,
    normalizeTaskOccurrenceImpactDraft,
    normalizeUndoTaskOccurrenceStateCommand,
    normalizeUpdateTaskCommand,
    type ChangeTaskOccurrenceCommand,
    type CompleteTaskCommand,
    type CreateTaskCommand,
    type DeleteTaskOccurrenceOrSeriesCommand,
    type DeleteTaskCommand,
    type SetTaskOccurrenceStatusCommand,
    type SetTaskProgressCommand,
    type TaskOccurrenceImpactDraft,
    type TaskOccurrenceImpactProjection,
    type TaskOccurrenceWindow,
    type TaskProjection,
    type TaskSeriesDetailProjection,
    type TaskUndoCapability,
    type UndoTaskOccurrenceStateCommand,
    type UpdateTaskCommand,
} from './workspace-task-contract';
import {
    isCanonicalLocalDate,
    MAX_SETUP_DRAFT_PAYLOAD_BYTES,
    normalizeCreateTermCommand,
    normalizeUpdateTermEndDateCommand,
    SETUP_DRAFT_SCHEMA_VERSION,
    type CreateTermCommand,
    type SetupDraftCheckpoint,
    type SetupProjection,
    type TermProjection,
    type UpdateTermEndDateCommand,
} from './workspace-term-contract';

export const WORKSPACE_SETUP_CHANNEL = 'courseflow:workspace-setup' as const;

type WorkspaceRequestBase = Readonly<{
    protocolVersion: typeof BOOTSTRAP_PROTOCOL_VERSION;
    appBuildId: string;
    requestId: string;
    workspaceEpoch: string;
}>;

export type InitializeWorkspaceRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.initialize';
}>;

export type SetupQueryRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.setup.query';
}>;

export type SaveSetupDraftCheckpointInput = Readonly<{
    expectedVersion: string;
    schemaVersion: typeof SETUP_DRAFT_SCHEMA_VERSION;
    opaquePayload: string;
}>;

export type SaveSetupDraftCheckpointRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.setup-draft.save';
    input: SaveSetupDraftCheckpointInput;
}>;

export type DiscardSetupDraftCheckpointRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.setup-draft.discard';
    expectedVersion: string;
}>;

export type PlanQueryRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.plan.query';
}>;

export type DataProtectionQueryRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.protection.query';
}>;

export type ConfigureBackupDestinationRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.protection.configure';
    command: ConfigureBackupDestinationCommand;
}>;

export type StartRestoreSessionRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.restore.start';
    command: StartRestoreSessionCommand;
}>;

export type RestoreSessionQueryRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.restore.query';
    restoreSessionId: string;
}>;

export type ConfirmRestoreSessionRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.restore.confirm';
    command: ConfirmRestoreSessionCommand;
}>;

export type CancelRestoreSessionRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.restore.cancel';
    command: CancelRestoreSessionCommand;
}>;

export type ResumeRestoreSessionRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.restore.resume';
    command: ResumeRestoreSessionCommand;
}>;

export type RollbackRestoreSessionRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.restore.rollback';
    command: RollbackRestoreSessionCommand;
}>;

export type SelectedBackupDestinationRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.protection.configure-selected';
    command: ConfigureBackupDestinationCommand;
    selectedDirectoryPath: string;
}>;

export type CreateTermRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.term.create';
    command: CreateTermCommand;
}>;

export type UpdateTermEndDateRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.term.update-end-date';
    command: UpdateTermEndDateCommand;
}>;

export type CreateHolidayRangeRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.holiday-range.create';
    command: CreateHolidayRangeCommand;
}>;

export type UpdateHolidayRangeRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.holiday-range.update';
    command: UpdateHolidayRangeCommand;
}>;

export type DeleteHolidayRangeRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.holiday-range.delete';
    command: DeleteHolidayRangeCommand;
}>;

export type CreateTaskRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.task.create';
    command: CreateTaskCommand;
}>;

export type UpdateTaskRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.task.update';
    command: UpdateTaskCommand;
}>;

export type DeleteTaskRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.task.delete';
    command: DeleteTaskCommand;
}>;

export type CompleteTaskRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.task.complete';
    command: CompleteTaskCommand;
}>;

export type SetTaskOccurrenceStatusRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.task.set-occurrence-status';
    command: SetTaskOccurrenceStatusCommand;
}>;

export type SetTaskProgressRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.task.set-progress';
    command: SetTaskProgressCommand;
}>;

export type ChangeTaskOccurrenceRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.task.change-occurrence';
    command: ChangeTaskOccurrenceCommand;
}>;

export type DeleteTaskOccurrenceOrSeriesRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.task.delete-occurrence-or-series';
    command: DeleteTaskOccurrenceOrSeriesCommand;
}>;

export type UndoTaskOccurrenceStateRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.task.undo-occurrence-state';
    command: UndoTaskOccurrenceStateCommand;
}>;

export type RestoreTermAsCurrentRequestCommand = Readonly<{
    commandId: string;
    followUpId: string;
    expectedRevision: string;
    expectedPlanVersion: string;
    expectedTermVersion: string;
    intent: Readonly<{
        kind: 'plan.restore-term-as-current';
        intentSchemaVersion: 1;
        payload: Readonly<{ termId: string }>;
    }>;
}>;

export type RestoreTermAsCurrentRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.term.restore-as-current';
    command: RestoreTermAsCurrentRequestCommand;
}>;

export type CreateCourseRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.course.create';
    command: CreateCourseCommand;
}>;

export type CreateMeetingSeriesRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.meeting-series.create';
    command: CreateMeetingSeriesCommand;
}>;

export type CreateCourseWithMeetingRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.course.create-with-first-meeting';
    command: AcceptedCreateCourseWithMeetingCommand;
}>;

export type MeetingSeriesQueryRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.meeting-series.query';
    meetingSeriesId: string;
    requestedWindow: MeetingOccurrenceWindow;
}>;

export type TaskSeriesQueryRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.task-series.query';
    taskSeriesId: string;
    requestedWindow: TaskOccurrenceWindow;
}>;

export type TaskOccurrenceImpactRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.task-occurrence.preview';
    draft: TaskOccurrenceImpactDraft;
}>;

export type MeetingOccurrenceImpactRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.meeting-occurrence.preview';
    draft: MeetingOccurrenceImpactDraft;
}>;

export type ChangeMeetingOccurrenceRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.meeting-occurrence.change';
    command: ChangeMeetingOccurrenceCommand;
}>;

export type CancelMeetingOccurrenceRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.meeting-occurrence.cancel';
    command: CancelMeetingOccurrenceCommand;
}>;

export type WorkspaceSetupRequest =
    | InitializeWorkspaceRequest
    | SetupQueryRequest
    | SaveSetupDraftCheckpointRequest
    | DiscardSetupDraftCheckpointRequest
    | PlanQueryRequest
    | DataProtectionQueryRequest
    | ConfigureBackupDestinationRequest
    | StartRestoreSessionRequest
    | RestoreSessionQueryRequest
    | ConfirmRestoreSessionRequest
    | CancelRestoreSessionRequest
    | ResumeRestoreSessionRequest
    | RollbackRestoreSessionRequest
    | CreateTermRequest
    | UpdateTermEndDateRequest
    | CreateHolidayRangeRequest
    | UpdateHolidayRangeRequest
    | DeleteHolidayRangeRequest
    | CreateTaskRequest
    | UpdateTaskRequest
    | DeleteTaskRequest
    | CompleteTaskRequest
    | SetTaskOccurrenceStatusRequest
    | SetTaskProgressRequest
    | ChangeTaskOccurrenceRequest
    | DeleteTaskOccurrenceOrSeriesRequest
    | UndoTaskOccurrenceStateRequest
    | RestoreTermAsCurrentRequest
    | CreateCourseRequest
    | CreateMeetingSeriesRequest
    | CreateCourseWithMeetingRequest
    | MeetingSeriesQueryRequest
    | TaskSeriesQueryRequest
    | TaskOccurrenceImpactRequest
    | MeetingOccurrenceImpactRequest
    | ChangeMeetingOccurrenceRequest
    | CancelMeetingOccurrenceRequest;

export type WorkspaceProcessRequest =
    | Exclude<WorkspaceSetupRequest, ConfigureBackupDestinationRequest>
    | SelectedBackupDestinationRequest;

type WorkspaceCommandEffect = Readonly<{
    code:
        | 'plan.term-created-current'
        | 'plan.term-end-date-updated'
        | 'plan.term-restored-current'
        | 'plan.course-created'
        | 'plan.meeting-series-created'
        | 'plan.meeting-occurrence-changed'
        | 'plan.meeting-occurrence-cancelled'
        | 'plan.holiday-range-created'
        | 'plan.holiday-range-updated'
        | 'plan.holiday-range-deleted'
        | 'plan.task-series-created'
        | 'plan.task-series-updated'
        | 'plan.task-series-deleted'
        | 'plan.task-occurrence-completed'
        | 'plan.task-occurrence-status-set'
        | 'plan.task-progress-set'
        | 'plan.task-occurrence-changed'
        | 'plan.task-occurrence-deleted'
        | 'plan.task-occurrence-state-undone'
        | 'protect.backup-destination-configured';
    entity: Readonly<{
        kind:
            | 'term'
            | 'course'
            | 'meeting-series'
            | 'holiday-range'
            | 'task-series'
            | 'backup-configuration';
        id: string;
        version: string;
    }>;
}>;

export type WorkspaceCommandResult = Readonly<{
    kind: 'committed';
    revision: string;
    effects: readonly [WorkspaceCommandEffect, ...WorkspaceCommandEffect[]];
    pendingFollowUps: readonly [string];
    undoCapability?: TaskUndoCapability | null;
}>;

export type WorkspaceSetupProblemCode =
    | 'invalid-request'
    | 'build-mismatch'
    | 'stale-workspace'
    | 'workspace-unavailable'
    | 'validation'
    | 'permission'
    | 'conflict'
    | 'decision-required'
    | 'operation-in-progress'
    | 'identity-conflict'
    | 'user-cancelled'
    | 'recovery-required';

export type WorkspaceSetupProblem = Readonly<{
    code: WorkspaceSetupProblemCode;
    message: string;
    requestId: string | null;
    appBuildId: string;
    workspaceEpoch: string;
    dataEffect: 'unchanged' | 'unknown';
    details?:
        | Readonly<{
            reason: 'meeting-time-overlap';
            warnings: readonly MeetingOverlapWarning[];
        }>
        | Readonly<{
            reason: 'backup-location-overlap';
            location: 'active-data' | 'library-root';
        }>
        | Readonly<{ reason: 'writer-busy' }>;
}>;

export type WorkspaceSetupOutcome =
    | Readonly<{
        ok: true;
        value: Readonly<{
            kind: 'workspace.initialized';
            protocolVersion: typeof BOOTSTRAP_PROTOCOL_VERSION;
            appBuildId: string;
            requestId: string;
            workspaceEpoch: string;
            workspaceData: WorkspaceDataStatus;
        }>;
    }>
    | Readonly<{
        ok: true;
        value: Readonly<{
            kind: 'workspace.setup-projection';
            protocolVersion: typeof BOOTSTRAP_PROTOCOL_VERSION;
            appBuildId: string;
            requestId: string;
            workspaceEpoch: string;
            dataMode: 'ready' | 'read-only';
            projection: SetupProjection;
        }>;
    }>
    | Readonly<{
        ok: true;
        value: Readonly<{
            kind: 'workspace.plan-projection';
            protocolVersion: typeof BOOTSTRAP_PROTOCOL_VERSION;
            appBuildId: string;
            requestId: string;
            workspaceEpoch: string;
            dataMode: 'ready' | 'read-only';
            projection: PlanProjection;
        }>;
    }>
    | Readonly<{
        ok: true;
        value: Readonly<{
            kind: 'workspace.data-protection-projection';
            protocolVersion: typeof BOOTSTRAP_PROTOCOL_VERSION;
            appBuildId: string;
            requestId: string;
            workspaceEpoch: string;
            dataMode: 'ready' | 'read-only';
            projection: DataProtectionProjection;
        }>;
    }>
    | Readonly<{
        ok: true;
        value: Readonly<{
            kind: 'workspace.restore-session';
            protocolVersion: typeof BOOTSTRAP_PROTOCOL_VERSION;
            appBuildId: string;
            requestId: string;
            workspaceEpoch: string;
            session: RestoreSessionView;
        }>;
    }>
    | Readonly<{
        ok: true;
        value: Readonly<{
            kind: 'workspace.command-outcome';
            protocolVersion: typeof BOOTSTRAP_PROTOCOL_VERSION;
            appBuildId: string;
            requestId: string;
            workspaceEpoch: string;
            outcome: WorkspaceCommandResult;
        }>;
    }>
    | Readonly<{
        ok: true;
        value: Readonly<{
            kind: 'workspace.meeting-series-projection';
            protocolVersion: typeof BOOTSTRAP_PROTOCOL_VERSION;
            appBuildId: string;
            requestId: string;
            workspaceEpoch: string;
            dataMode: 'ready' | 'read-only';
            projection: MeetingSeriesDetailProjection;
        }>;
    }>
    | Readonly<{
        ok: true;
        value: Readonly<{
            kind: 'workspace.task-series-projection';
            protocolVersion: typeof BOOTSTRAP_PROTOCOL_VERSION;
            appBuildId: string;
            requestId: string;
            workspaceEpoch: string;
            dataMode: 'ready' | 'read-only';
            projection: TaskSeriesDetailProjection;
        }>;
    }>
    | Readonly<{
        ok: true;
        value: Readonly<{
            kind: 'workspace.task-occurrence-impact';
            protocolVersion: typeof BOOTSTRAP_PROTOCOL_VERSION;
            appBuildId: string;
            requestId: string;
            workspaceEpoch: string;
            dataMode: 'ready' | 'read-only';
            projection: TaskOccurrenceImpactProjection;
        }>;
    }>
    | Readonly<{
        ok: true;
        value: Readonly<{
            kind: 'workspace.meeting-occurrence-impact';
            protocolVersion: typeof BOOTSTRAP_PROTOCOL_VERSION;
            appBuildId: string;
            requestId: string;
            workspaceEpoch: string;
            dataMode: 'ready' | 'read-only';
            projection: MeetingOccurrenceImpactProjection;
        }>;
    }>
    | Readonly<{ ok: false; problem: WorkspaceSetupProblem }>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function hasExactDataKeys(value: unknown, expectedKeys: readonly string[]): value is Record<string, unknown> {
    if (!isPlainObject(value)) {
        return false;
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    return keys.length === expectedKeys.length
        && keys.every((key) => typeof key === 'string' && expectedKeys.includes(key))
        && expectedKeys.every((key) => {
            const descriptor = descriptors[key];
            return descriptor !== undefined && 'value' in descriptor && descriptor.enumerable;
        });
}

/**
 * Accepts JSON syntax within the first-setup draft byte boundary without interpreting Shell fields.
 * @param {unknown} value - Candidate opaque payload.
 * @return {boolean} Whether the payload is bounded JSON text.
 */
function isSetupDraftPayload(value: unknown): value is string {
    if (typeof value !== 'string'
        || new TextEncoder().encode(value).byteLength > MAX_SETUP_DRAFT_PAYLOAD_BYTES) {
        return false;
    }
    try {
        JSON.parse(value);
        return true;
    }
    catch {
        return false;
    }
}

/**
 * Validates the exact Workspace projection envelope around a Shell-owned setup draft.
 * @param {unknown} value - Candidate checkpoint projection.
 * @return {boolean} Whether the checkpoint matches the supported version.
 */
function isSetupDraftCheckpoint(value: unknown): value is SetupDraftCheckpoint {
    return hasExactDataKeys(value, [
        'draftId',
        'kind',
        'scope',
        'schemaVersion',
        'updatedAt',
        'opaquePayload',
    ])
        && value.draftId === 'first-setup'
        && value.kind === 'first-setup'
        && value.scope === 'setup-step'
        && value.schemaVersion === SETUP_DRAFT_SCHEMA_VERSION
        && isCanonicalInstant(value.updatedAt)
        && isSetupDraftPayload(value.opaquePayload);
}

function isRequestBase(value: Record<string, unknown>): boolean {
    return value.protocolVersion === BOOTSTRAP_PROTOCOL_VERSION
        && typeof value.appBuildId === 'string'
        && value.appBuildId.length > 0
        && typeof value.requestId === 'string'
        && value.requestId.length > 0
        && isCanonicalUuid(value.workspaceEpoch);
}

function normalizeRestoreTermAsCurrentRequestCommand(
    value: unknown,
): RestoreTermAsCurrentRequestCommand {
    if (!hasExactDataKeys(value, [
        'commandId',
        'followUpId',
        'expectedRevision',
        'expectedPlanVersion',
        'expectedTermVersion',
        'intent',
    ])
        || !isCanonicalUuid(value.commandId)
        || !isCanonicalUuid(value.followUpId)
        || !isCanonicalUnsignedSqliteInteger(value.expectedRevision)
        || !isCanonicalUnsignedSqliteInteger(value.expectedPlanVersion)
        || !isCanonicalUnsignedSqliteInteger(value.expectedTermVersion)
        || !hasExactDataKeys(value.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || value.intent.kind !== 'plan.restore-term-as-current'
        || value.intent.intentSchemaVersion !== 1
        || !hasExactDataKeys(value.intent.payload, ['termId'])
        || !isCanonicalUuid(value.intent.payload.termId)) {
        throw new TypeError('Restore Term request has invalid fields');
    }
    return {
        commandId: value.commandId,
        followUpId: value.followUpId,
        expectedRevision: value.expectedRevision,
        expectedPlanVersion: value.expectedPlanVersion,
        expectedTermVersion: value.expectedTermVersion,
        intent: {
            kind: 'plan.restore-term-as-current',
            intentSchemaVersion: 1,
            payload: { termId: value.intent.payload.termId },
        },
    };
}

export function makeInitializeWorkspaceRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
): InitializeWorkspaceRequest {
    return {
        kind: 'workspace.initialize',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
    };
}

export function makeSetupQueryRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
): SetupQueryRequest {
    return {
        kind: 'workspace.setup.query',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
    };
}

/**
 * Builds one bounded save for the Shell-owned first-setup draft.
 * @param {string} requestId - Request correlation identity.
 * @param {string} appBuildId - Calling application build identity.
 * @param {string} workspaceEpoch - Active Workspace process epoch.
 * @param {SaveSetupDraftCheckpointInput} input - Opaque JSON and expected draft-stream version.
 * @return {SaveSetupDraftCheckpointRequest} Exact Workspace request.
 */
export function makeSaveSetupDraftCheckpointRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    input: SaveSetupDraftCheckpointInput,
): SaveSetupDraftCheckpointRequest {
    if (!hasExactDataKeys(input, ['expectedVersion', 'schemaVersion', 'opaquePayload'])
        || !isCanonicalUnsignedSqliteInteger(input.expectedVersion)
        || input.schemaVersion !== SETUP_DRAFT_SCHEMA_VERSION
        || !isSetupDraftPayload(input.opaquePayload)) {
        throw new TypeError('Setup draft checkpoint is invalid or incompatible');
    }
    return {
        kind: 'workspace.setup-draft.save',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        input: {
            expectedVersion: input.expectedVersion,
            schemaVersion: input.schemaVersion,
            opaquePayload: input.opaquePayload,
        },
    };
}

/**
 * Builds one optimistic discard for the first-setup draft stream.
 * @param {string} requestId - Request correlation identity.
 * @param {string} appBuildId - Calling application build identity.
 * @param {string} workspaceEpoch - Active Workspace process epoch.
 * @param {string} expectedVersion - Last observed draft-stream version.
 * @return {DiscardSetupDraftCheckpointRequest} Exact Workspace request.
 */
export function makeDiscardSetupDraftCheckpointRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    expectedVersion: string,
): DiscardSetupDraftCheckpointRequest {
    if (!isCanonicalUnsignedSqliteInteger(expectedVersion)) {
        throw new TypeError('Setup draft checkpoint version is invalid');
    }
    return {
        kind: 'workspace.setup-draft.discard',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        expectedVersion,
    };
}

/**
 * Builds the exact unified PLAN projection query.
 * @param {string} requestId - Request correlation identity.
 * @param {string} appBuildId - Calling application build identity.
 * @param {string} workspaceEpoch - Active Workspace process epoch.
 * @return {PlanQueryRequest} Exact Workspace request.
 */
export function makePlanQueryRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
): PlanQueryRequest {
    return {
        kind: 'workspace.plan.query',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
    };
}

/**
 * Builds the exact path-free data-protection query.
 * @param {string} requestId - Request correlation identity.
 * @param {string} appBuildId - Calling application build identity.
 * @param {string} workspaceEpoch - Active Workspace process epoch.
 * @return {DataProtectionQueryRequest} Exact Workspace request.
 */
export function makeDataProtectionQueryRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
): DataProtectionQueryRequest {
    return {
        kind: 'workspace.protection.query',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
    };
}

/**
 * Builds the exact path-free request that starts one RestoreSession.
 * @param {string} requestId - Request correlation identity.
 * @param {string} appBuildId - Calling application build identity.
 * @param {string} workspaceEpoch - Active Workspace process epoch.
 * @param {StartRestoreSessionCommand} command - Opaque verified-candidate command.
 * @return {StartRestoreSessionRequest} Exact Workspace request.
 */
export function makeStartRestoreSessionRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: StartRestoreSessionCommand,
): StartRestoreSessionRequest {
    return {
        kind: 'workspace.restore.start',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        command: normalizeStartRestoreSessionCommand(command),
    };
}

/**
 * Builds a side-effect-free RestoreSession query.
 * @param {string} requestId - Request correlation identity.
 * @param {string} appBuildId - Calling application build identity.
 * @param {string} workspaceEpoch - Active Workspace process epoch.
 * @param {string} restoreSessionId - Stable session identity.
 * @return {RestoreSessionQueryRequest} Exact Workspace request.
 */
export function makeRestoreSessionQueryRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    restoreSessionId: string,
): RestoreSessionQueryRequest {
    if (!isCanonicalUuid(restoreSessionId)) {
        throw new TypeError('RestoreSessionId is invalid');
    }
    return {
        kind: 'workspace.restore.query',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        restoreSessionId,
    };
}

/**
 * Builds the exact preview-bound RestoreSession confirmation request.
 * @param {string} requestId - Request correlation identity.
 * @param {string} appBuildId - Calling application build identity.
 * @param {string} workspaceEpoch - Active Workspace process epoch.
 * @param {ConfirmRestoreSessionCommand} command - Versioned confirmation command.
 * @return {ConfirmRestoreSessionRequest} Exact Workspace request.
 */
export function makeConfirmRestoreSessionRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: ConfirmRestoreSessionCommand,
): ConfirmRestoreSessionRequest {
    return {
        kind: 'workspace.restore.confirm',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        command: normalizeConfirmRestoreSessionCommand(command),
    };
}

/** Builds the exact pre-checkpoint Restore cancellation request. */
export function makeCancelRestoreSessionRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: CancelRestoreSessionCommand,
): CancelRestoreSessionRequest {
    return {
        kind: 'workspace.restore.cancel',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        command: normalizeCancelRestoreSessionCommand(command),
    };
}

/** Builds the exact evidence-bound Restore continuation request. */
export function makeResumeRestoreSessionRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: ResumeRestoreSessionCommand,
): ResumeRestoreSessionRequest {
    return {
        kind: 'workspace.restore.resume',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        command: normalizeResumeRestoreSessionCommand(command),
    };
}

/** Builds the exact evidence-bound Restore rollback request. */
export function makeRollbackRestoreSessionRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: RollbackRestoreSessionCommand,
): RollbackRestoreSessionRequest {
    return {
        kind: 'workspace.restore.rollback',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        command: normalizeRollbackRestoreSessionCommand(command),
    };
}

/**
 * Builds the Shell intent that asks Main to choose a backup directory.
 * @param {string} requestId - Request correlation identity.
 * @param {string} appBuildId - Calling application build identity.
 * @param {string} workspaceEpoch - Active Workspace process epoch.
 * @param {ConfigureBackupDestinationCommand} command - Versioned PROTECT command.
 * @return {ConfigureBackupDestinationRequest} Path-free Shell request.
 */
export function makeConfigureBackupDestinationRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: ConfigureBackupDestinationCommand,
): ConfigureBackupDestinationRequest {
    return {
        kind: 'workspace.protection.configure',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        command: normalizeConfigureBackupDestinationCommand(command),
    };
}

/**
 * Adds Main's native-picker result for the trusted Workspace process only.
 * @param {ConfigureBackupDestinationRequest} request - Validated path-free Shell request.
 * @param {string} selectedDirectoryPath - Native selected directory path.
 * @return {SelectedBackupDestinationRequest} Workspace-internal request.
 */
export function makeSelectedBackupDestinationRequest(
    request: ConfigureBackupDestinationRequest,
    selectedDirectoryPath: string,
): SelectedBackupDestinationRequest {
    if (typeof selectedDirectoryPath !== 'string'
        || selectedDirectoryPath.length === 0
        || selectedDirectoryPath.length > 32_767
        || selectedDirectoryPath.includes('\0')) {
        throw new TypeError('Selected backup directory path is invalid');
    }
    return {
        kind: 'workspace.protection.configure-selected',
        protocolVersion: request.protocolVersion,
        appBuildId: request.appBuildId,
        requestId: request.requestId,
        workspaceEpoch: request.workspaceEpoch,
        command: normalizeConfigureBackupDestinationCommand(request.command),
        selectedDirectoryPath,
    };
}

export function makeCreateTermRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: CreateTermCommand,
): CreateTermRequest {
    return {
        kind: 'workspace.term.create',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        command: normalizeCreateTermCommand(command),
    };
}

export function makeUpdateTermEndDateRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: UpdateTermEndDateCommand,
): UpdateTermEndDateRequest {
    return {
        kind: 'workspace.term.update-end-date',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        command: normalizeUpdateTermEndDateCommand(command),
    };
}

/**
 * Builds an exact named HolidayRange creation request.
 * @param {string} requestId - Correlation identity.
 * @param {string} appBuildId - Current build identity.
 * @param {string} workspaceEpoch - Active Workspace process epoch.
 * @param {CreateHolidayRangeCommand} command - Candidate creation command.
 * @return {CreateHolidayRangeRequest} Normalized Workspace request.
 */
export function makeCreateHolidayRangeRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: CreateHolidayRangeCommand,
): CreateHolidayRangeRequest {
    return {
        kind: 'workspace.holiday-range.create',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        command: normalizeCreateHolidayRangeCommand(command),
    };
}

/**
 * Builds an exact named HolidayRange update request.
 * @param {string} requestId - Correlation identity.
 * @param {string} appBuildId - Current build identity.
 * @param {string} workspaceEpoch - Active Workspace process epoch.
 * @param {UpdateHolidayRangeCommand} command - Candidate update command.
 * @return {UpdateHolidayRangeRequest} Normalized Workspace request.
 */
export function makeUpdateHolidayRangeRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: UpdateHolidayRangeCommand,
): UpdateHolidayRangeRequest {
    return {
        kind: 'workspace.holiday-range.update',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        command: normalizeUpdateHolidayRangeCommand(command),
    };
}

/**
 * Builds an exact named HolidayRange deletion request.
 * @param {string} requestId - Correlation identity.
 * @param {string} appBuildId - Current build identity.
 * @param {string} workspaceEpoch - Active Workspace process epoch.
 * @param {DeleteHolidayRangeCommand} command - Candidate deletion command.
 * @return {DeleteHolidayRangeRequest} Normalized Workspace request.
 */
export function makeDeleteHolidayRangeRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: DeleteHolidayRangeCommand,
): DeleteHolidayRangeRequest {
    return {
        kind: 'workspace.holiday-range.delete',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        command: normalizeDeleteHolidayRangeCommand(command),
    };
}

/**
 * Builds one exact one-time Task creation request.
 * @param {string} requestId - Correlation identity.
 * @param {string} appBuildId - Current build identity.
 * @param {string} workspaceEpoch - Active Workspace process epoch.
 * @param {CreateTaskCommand} command - Candidate creation command.
 * @return {CreateTaskRequest} Normalized Workspace request.
 */
export function makeCreateTaskRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: CreateTaskCommand,
): CreateTaskRequest {
    return {
        kind: 'workspace.task.create',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        command: normalizeCreateTaskCommand(command),
    };
}

/**
 * Builds one exact one-time Task update request.
 * @param {string} requestId - Correlation identity.
 * @param {string} appBuildId - Current build identity.
 * @param {string} workspaceEpoch - Active Workspace process epoch.
 * @param {UpdateTaskCommand} command - Candidate update command.
 * @return {UpdateTaskRequest} Normalized Workspace request.
 */
export function makeUpdateTaskRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: UpdateTaskCommand,
): UpdateTaskRequest {
    return {
        kind: 'workspace.task.update',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        command: normalizeUpdateTaskCommand(command),
    };
}

/**
 * Builds one exact one-time Task deletion request.
 * @param {string} requestId - Correlation identity.
 * @param {string} appBuildId - Current build identity.
 * @param {string} workspaceEpoch - Active Workspace process epoch.
 * @param {DeleteTaskCommand} command - Candidate deletion command.
 * @return {DeleteTaskRequest} Normalized Workspace request.
 */
export function makeDeleteTaskRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: DeleteTaskCommand,
): DeleteTaskRequest {
    return {
        kind: 'workspace.task.delete',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        command: normalizeDeleteTaskCommand(command),
    };
}

/**
 * Builds the bounded pending-to-completed transition for a one-time Task occurrence.
 * @param {string} requestId - Correlation identity.
 * @param {string} appBuildId - Current build identity.
 * @param {string} workspaceEpoch - Active Workspace process epoch.
 * @param {CompleteTaskCommand} command - Candidate completion command.
 * @return {CompleteTaskRequest} Normalized Workspace request.
 */
export function makeCompleteTaskRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: CompleteTaskCommand,
): CompleteTaskRequest {
    return {
        kind: 'workspace.task.complete',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        command: normalizeCompleteTaskCommand(command),
    };
}

export function makeSetTaskOccurrenceStatusRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: SetTaskOccurrenceStatusCommand,
): SetTaskOccurrenceStatusRequest {
    return {
        kind: 'workspace.task.set-occurrence-status',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        command: normalizeSetTaskOccurrenceStatusCommand(command),
    };
}

export function makeSetTaskProgressRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: SetTaskProgressCommand,
): SetTaskProgressRequest {
    return {
        kind: 'workspace.task.set-progress',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        command: normalizeSetTaskProgressCommand(command),
    };
}

export function makeChangeTaskOccurrenceRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: ChangeTaskOccurrenceCommand,
): ChangeTaskOccurrenceRequest {
    return {
        kind: 'workspace.task.change-occurrence',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        command: normalizeChangeTaskOccurrenceCommand(command),
    };
}

export function makeDeleteTaskOccurrenceOrSeriesRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: DeleteTaskOccurrenceOrSeriesCommand,
): DeleteTaskOccurrenceOrSeriesRequest {
    return {
        kind: 'workspace.task.delete-occurrence-or-series',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        command: normalizeDeleteTaskOccurrenceOrSeriesCommand(command),
    };
}

export function makeUndoTaskOccurrenceStateRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: UndoTaskOccurrenceStateCommand,
): UndoTaskOccurrenceStateRequest {
    return {
        kind: 'workspace.task.undo-occurrence-state',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        command: normalizeUndoTaskOccurrenceStateCommand(command),
    };
}

export function makeRestoreTermAsCurrentRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: RestoreTermAsCurrentRequestCommand,
): RestoreTermAsCurrentRequest {
    return {
        kind: 'workspace.term.restore-as-current',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        command: normalizeRestoreTermAsCurrentRequestCommand(command),
    };
}

/**
 * Builds the Course-only request used before first setup asks for an activity.
 * @param {string} requestId - Request correlation identity.
 * @param {string} appBuildId - Calling application build identity.
 * @param {string} workspaceEpoch - Active Workspace process epoch.
 * @param {CreateCourseCommand} command - Candidate Course command.
 * @return {CreateCourseRequest} Canonical Workspace request.
 */
export function makeCreateCourseRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: CreateCourseCommand,
): CreateCourseRequest {
    return {
        kind: 'workspace.course.create',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        command: normalizeCreateCourseCommand(command),
    };
}

/**
 * Builds a Meeting series creation request for an existing Course.
 * @param {string} requestId - Request correlation identity.
 * @param {string} appBuildId - Calling application build identity.
 * @param {string} workspaceEpoch - Active Workspace process epoch.
 * @param {CreateMeetingSeriesCommand} command - Candidate Meeting series command.
 * @return {CreateMeetingSeriesRequest} Canonical Workspace request.
 */
export function makeCreateMeetingSeriesRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: CreateMeetingSeriesCommand,
): CreateMeetingSeriesRequest {
    return {
        kind: 'workspace.meeting-series.create',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        command: normalizeCreateMeetingSeriesCommand(command),
    };
}

export function makeCreateCourseWithMeetingRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: AcceptedCreateCourseWithMeetingCommand,
): CreateCourseWithMeetingRequest {
    return {
        kind: 'workspace.course.create-with-first-meeting',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        command: normalizeAcceptedCreateCourseWithMeetingCommand(command),
    };
}

/**
 * Builds an exact bounded Meeting series query request.
 * @param {string} requestId - Request correlation identity.
 * @param {string} appBuildId - Calling application build identity.
 * @param {string} workspaceEpoch - Active Workspace process epoch.
 * @param {string} meetingSeriesId - Stable Meeting series identity.
 * @param {MeetingOccurrenceWindow} requestedWindow - Physical-date expansion window.
 * @return {MeetingSeriesQueryRequest} Canonical Workspace request.
 */
export function makeMeetingSeriesQueryRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    meetingSeriesId: string,
    requestedWindow: MeetingOccurrenceWindow,
): MeetingSeriesQueryRequest {
    if (!isCanonicalUuid(meetingSeriesId) || !isMeetingOccurrenceWindow(requestedWindow)) {
        throw new TypeError('Meeting series query requires a canonical ID and bounded window');
    }
    return {
        kind: 'workspace.meeting-series.query',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        meetingSeriesId,
        requestedWindow: Object.freeze({ ...requestedWindow }),
    };
}

/**
 * Builds an exact bounded Task series query request.
 * @param {string} requestId - Request correlation identity.
 * @param {string} appBuildId - Calling application build identity.
 * @param {string} workspaceEpoch - Active Workspace process epoch.
 * @param {string} taskSeriesId - Stable Task series identity.
 * @param {TaskOccurrenceWindow} requestedWindow - Physical-date expansion window.
 * @return {TaskSeriesQueryRequest} Canonical Workspace request.
 */
export function makeTaskSeriesQueryRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    taskSeriesId: string,
    requestedWindow: TaskOccurrenceWindow,
): TaskSeriesQueryRequest {
    if (!isCanonicalUuid(taskSeriesId) || !isTaskOccurrenceWindow(requestedWindow)) {
        throw new TypeError('Task series query requires a canonical ID and bounded window');
    }
    return {
        kind: 'workspace.task-series.query',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        taskSeriesId,
        requestedWindow: Object.freeze({ ...requestedWindow }),
    };
}

export function makeTaskOccurrenceImpactRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    draft: TaskOccurrenceImpactDraft,
): TaskOccurrenceImpactRequest {
    return {
        kind: 'workspace.task-occurrence.preview',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        draft: normalizeTaskOccurrenceImpactDraft(draft),
    };
}

/**
 * Builds an exact whole-rule Meeting impact preview request.
 * @param {string} requestId - Request correlation identity.
 * @param {string} appBuildId - Calling application build identity.
 * @param {string} workspaceEpoch - Active Workspace process epoch.
 * @param {MeetingOccurrenceImpactDraft} draft - Canonical future-change draft.
 * @return {MeetingOccurrenceImpactRequest} Canonical Workspace request.
 */
export function makeMeetingOccurrenceImpactRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    draft: MeetingOccurrenceImpactDraft,
): MeetingOccurrenceImpactRequest {
    return {
        kind: 'workspace.meeting-occurrence.preview',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        draft: normalizeMeetingOccurrenceImpactDraft(draft),
    };
}

/**
 * Builds an exact scoped Meeting occurrence change request.
 * @param {string} requestId - Request correlation identity.
 * @param {string} appBuildId - Calling application build identity.
 * @param {string} workspaceEpoch - Active Workspace process epoch.
 * @param {ChangeMeetingOccurrenceCommand} command - Versioned occurrence change command.
 * @return {ChangeMeetingOccurrenceRequest} Canonical Workspace request.
 */
export function makeChangeMeetingOccurrenceRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: ChangeMeetingOccurrenceCommand,
): ChangeMeetingOccurrenceRequest {
    return {
        kind: 'workspace.meeting-occurrence.change',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        command: normalizeChangeMeetingOccurrenceCommand(command),
    };
}

/**
 * Builds an exact only-this Meeting cancellation request.
 * @param {string} requestId - Request correlation identity.
 * @param {string} appBuildId - Calling application build identity.
 * @param {string} workspaceEpoch - Active Workspace process epoch.
 * @param {CancelMeetingOccurrenceCommand} command - Versioned cancellation command.
 * @return {CancelMeetingOccurrenceRequest} Canonical Workspace request.
 */
export function makeCancelMeetingOccurrenceRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: CancelMeetingOccurrenceCommand,
): CancelMeetingOccurrenceRequest {
    return {
        kind: 'workspace.meeting-occurrence.cancel',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        command: normalizeCancelMeetingOccurrenceCommand(command),
    };
}

export function isWorkspaceSetupRequest(
    value: unknown,
    expectedBuildId: string,
    expectedWorkspaceEpoch: string,
): value is WorkspaceSetupRequest {
    if (!isPlainObject(value)
        || value.appBuildId !== expectedBuildId
        || value.workspaceEpoch !== expectedWorkspaceEpoch
        || !isRequestBase(value)) {
        return false;
    }

    if (value.kind === 'workspace.initialize'
        || value.kind === 'workspace.setup.query'
        || value.kind === 'workspace.plan.query'
        || value.kind === 'workspace.protection.query') {
        return hasExactDataKeys(value, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
        ]);
    }
    if (value.kind === 'workspace.setup-draft.save') {
        return hasExactDataKeys(value, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
            'input',
        ])
            && hasExactDataKeys(value.input, ['expectedVersion', 'schemaVersion', 'opaquePayload'])
            && isCanonicalUnsignedSqliteInteger(value.input.expectedVersion)
            && value.input.schemaVersion === SETUP_DRAFT_SCHEMA_VERSION
            && isSetupDraftPayload(value.input.opaquePayload);
    }
    if (value.kind === 'workspace.setup-draft.discard') {
        return hasExactDataKeys(value, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
            'expectedVersion',
        ]) && isCanonicalUnsignedSqliteInteger(value.expectedVersion);
    }
    if (value.kind === 'workspace.restore.query') {
        return hasExactDataKeys(value, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
            'restoreSessionId',
        ]) && isCanonicalUuid(value.restoreSessionId);
    }
    if (value.kind === 'workspace.meeting-series.query') {
        return hasExactDataKeys(value, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
            'meetingSeriesId',
            'requestedWindow',
        ])
            && isCanonicalUuid(value.meetingSeriesId)
            && isMeetingOccurrenceWindow(value.requestedWindow);
    }
    if (value.kind === 'workspace.task-series.query') {
        return hasExactDataKeys(value, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
            'taskSeriesId',
            'requestedWindow',
        ])
            && isCanonicalUuid(value.taskSeriesId)
            && isTaskOccurrenceWindow(value.requestedWindow);
    }
    if (value.kind === 'workspace.task-occurrence.preview') {
        if (!hasExactDataKeys(value, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
            'draft',
        ])) {
            return false;
        }
        try {
            normalizeTaskOccurrenceImpactDraft(value.draft);
            return true;
        }
        catch {
            return false;
        }
    }
    if (value.kind === 'workspace.meeting-occurrence.preview') {
        if (!hasExactDataKeys(value, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
            'draft',
        ])) {
            return false;
        }
        try {
            normalizeMeetingOccurrenceImpactDraft(value.draft);
            return true;
        }
        catch {
            return false;
        }
    }
    if ((value.kind !== 'workspace.term.create'
            && value.kind !== 'workspace.term.update-end-date'
            && value.kind !== 'workspace.term.restore-as-current'
            && value.kind !== 'workspace.holiday-range.create'
            && value.kind !== 'workspace.holiday-range.update'
            && value.kind !== 'workspace.holiday-range.delete'
            && value.kind !== 'workspace.task.create'
            && value.kind !== 'workspace.task.update'
            && value.kind !== 'workspace.task.delete'
            && value.kind !== 'workspace.task.complete'
            && value.kind !== 'workspace.task.set-occurrence-status'
            && value.kind !== 'workspace.task.set-progress'
            && value.kind !== 'workspace.task.change-occurrence'
            && value.kind !== 'workspace.task.delete-occurrence-or-series'
            && value.kind !== 'workspace.task.undo-occurrence-state'
            && value.kind !== 'workspace.course.create'
            && value.kind !== 'workspace.meeting-series.create'
            && value.kind !== 'workspace.course.create-with-first-meeting'
            && value.kind !== 'workspace.meeting-occurrence.change'
            && value.kind !== 'workspace.meeting-occurrence.cancel'
            && value.kind !== 'workspace.restore.start'
            && value.kind !== 'workspace.restore.confirm'
            && value.kind !== 'workspace.restore.cancel'
            && value.kind !== 'workspace.restore.resume'
            && value.kind !== 'workspace.restore.rollback'
            && value.kind !== 'workspace.protection.configure')
        || !hasExactDataKeys(value, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
            'command',
        ])) {
        return false;
    }

    try {
        if (value.kind === 'workspace.protection.configure') {
            normalizeConfigureBackupDestinationCommand(value.command);
        }
        else if (value.kind === 'workspace.restore.start') {
            normalizeStartRestoreSessionCommand(value.command);
        }
        else if (value.kind === 'workspace.restore.confirm') {
            normalizeConfirmRestoreSessionCommand(value.command);
        }
        else if (value.kind === 'workspace.restore.cancel') {
            normalizeCancelRestoreSessionCommand(value.command);
        }
        else if (value.kind === 'workspace.restore.resume') {
            normalizeResumeRestoreSessionCommand(value.command);
        }
        else if (value.kind === 'workspace.restore.rollback') {
            normalizeRollbackRestoreSessionCommand(value.command);
        }
        else if (value.kind === 'workspace.term.create') {
            normalizeCreateTermCommand(value.command);
        }
        else if (value.kind === 'workspace.term.update-end-date') {
            normalizeUpdateTermEndDateCommand(value.command);
        }
        else if (value.kind === 'workspace.term.restore-as-current') {
            normalizeRestoreTermAsCurrentRequestCommand(value.command);
        }
        else if (value.kind === 'workspace.holiday-range.create') {
            normalizeCreateHolidayRangeCommand(value.command);
        }
        else if (value.kind === 'workspace.holiday-range.update') {
            normalizeUpdateHolidayRangeCommand(value.command);
        }
        else if (value.kind === 'workspace.holiday-range.delete') {
            normalizeDeleteHolidayRangeCommand(value.command);
        }
        else if (value.kind === 'workspace.task.create') {
            normalizeCreateTaskCommand(value.command);
        }
        else if (value.kind === 'workspace.task.update') {
            normalizeUpdateTaskCommand(value.command);
        }
        else if (value.kind === 'workspace.task.delete') {
            normalizeDeleteTaskCommand(value.command);
        }
        else if (value.kind === 'workspace.task.complete') {
            normalizeCompleteTaskCommand(value.command);
        }
        else if (value.kind === 'workspace.task.set-occurrence-status') {
            normalizeSetTaskOccurrenceStatusCommand(value.command);
        }
        else if (value.kind === 'workspace.task.set-progress') {
            normalizeSetTaskProgressCommand(value.command);
        }
        else if (value.kind === 'workspace.task.change-occurrence') {
            normalizeChangeTaskOccurrenceCommand(value.command);
        }
        else if (value.kind === 'workspace.task.delete-occurrence-or-series') {
            normalizeDeleteTaskOccurrenceOrSeriesCommand(value.command);
        }
        else if (value.kind === 'workspace.task.undo-occurrence-state') {
            normalizeUndoTaskOccurrenceStateCommand(value.command);
        }
        else if (value.kind === 'workspace.course.create') {
            normalizeCreateCourseCommand(value.command);
        }
        else if (value.kind === 'workspace.meeting-series.create') {
            normalizeCreateMeetingSeriesCommand(value.command);
        }
        else if (value.kind === 'workspace.course.create-with-first-meeting') {
            normalizeAcceptedCreateCourseWithMeetingCommand(value.command);
        }
        else if (value.kind === 'workspace.meeting-occurrence.change') {
            normalizeChangeMeetingOccurrenceCommand(value.command);
        }
        else {
            normalizeCancelMeetingOccurrenceCommand(value.command);
        }
        return true;
    }
    catch {
        return false;
    }
}

/**
 * Validates requests accepted by the Workspace utility process after Main adaptation.
 * @param {unknown} value - Candidate process request.
 * @param {string} expectedBuildId - Active application build identity.
 * @param {string} expectedWorkspaceEpoch - Active Workspace process epoch.
 * @return {boolean} Whether the request is safe for Workspace dispatch.
 */
export function isWorkspaceProcessRequest(
    value: unknown,
    expectedBuildId: string,
    expectedWorkspaceEpoch: string,
): value is WorkspaceProcessRequest {
    if (isWorkspaceSetupRequest(value, expectedBuildId, expectedWorkspaceEpoch)) {
        return value.kind !== 'workspace.protection.configure';
    }
    if (!isPlainObject(value)
        || value.kind !== 'workspace.protection.configure-selected'
        || value.appBuildId !== expectedBuildId
        || value.workspaceEpoch !== expectedWorkspaceEpoch
        || !isRequestBase(value)
        || !hasExactDataKeys(value, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
            'command',
            'selectedDirectoryPath',
        ])
        || typeof value.selectedDirectoryPath !== 'string'
        || value.selectedDirectoryPath.length === 0
        || value.selectedDirectoryPath.length > 32_767
        || value.selectedDirectoryPath.includes('\0')) {
        return false;
    }
    try {
        normalizeConfigureBackupDestinationCommand(value.command);
        return true;
    }
    catch {
        return false;
    }
}

function isTermProjection(value: unknown): boolean {
    return hasExactDataKeys(value, [
        'termId',
        'name',
        'startDate',
        'endDate',
        'timeZone',
        'archived',
        'entityVersion',
    ])
        && isCanonicalUuid(value.termId)
        && typeof value.name === 'string'
        && typeof value.startDate === 'string'
        && typeof value.endDate === 'string'
        && typeof value.timeZone === 'string'
        && typeof value.archived === 'boolean'
        && isCanonicalUnsignedSqliteInteger(value.entityVersion);
}

function sameTermProjection(first: TermProjection, second: TermProjection): boolean {
    return first.termId === second.termId
        && first.name === second.name
        && first.startDate === second.startDate
        && first.endDate === second.endDate
        && first.timeZone === second.timeZone
        && first.archived === second.archived
        && first.entityVersion === second.entityVersion;
}

function isSetupProjection(value: unknown): boolean {
    if (!hasExactDataKeys(value, [
        'workspaceRevision',
        'planEntityVersion',
        'minimum',
        'everReachedMinimum',
        'defaultRoute',
        'draftCheckpointVersion',
        'draftCheckpoint',
        'currentTerm',
        'terms',
        'courses',
        'holidayRanges',
        'tasks',
    ])
        || !isCanonicalUnsignedSqliteInteger(value.workspaceRevision)
        || !isCanonicalUnsignedSqliteInteger(value.planEntityVersion)
        || !hasExactDataKeys(value.minimum, [
            'hasCurrentTerm',
            'hasCurrentTermCourse',
            'hasMeetingOrTask',
            'isSatisfied',
        ])
        || typeof value.minimum.hasCurrentTerm !== 'boolean'
        || typeof value.minimum.hasCurrentTermCourse !== 'boolean'
        || typeof value.minimum.hasMeetingOrTask !== 'boolean'
        || typeof value.minimum.isSatisfied !== 'boolean'
        || typeof value.everReachedMinimum !== 'boolean'
        || (value.defaultRoute !== 'setup' && value.defaultRoute !== 'today')
        || !isCanonicalUnsignedSqliteInteger(value.draftCheckpointVersion)
        || (value.draftCheckpoint !== null && !isSetupDraftCheckpoint(value.draftCheckpoint))
        || (value.currentTerm !== null && !isTermProjection(value.currentTerm))
        || !Array.isArray(value.terms)
        || !value.terms.every(isTermProjection)
        || !Array.isArray(value.courses)
        || !value.courses.every(isCourseProjection)
        || !Array.isArray(value.holidayRanges)
        || !value.holidayRanges.every(isHolidayRangeProjection)
        || !Array.isArray(value.tasks)
        || !value.tasks.every(isTaskProjection)) {
        return false;
    }

    const minimum = value.minimum as SetupProjection['minimum'];
    const terms = value.terms as TermProjection[];
    const courses = value.courses as CourseProjection[];
    const holidayRanges = value.holidayRanges as HolidayRangeProjection[];
    const tasks = value.tasks as TaskProjection[];
    if (value.currentTerm !== null) {
        const currentTerm = value.currentTerm as TermProjection;
        const storedTerm = terms.find(term => term.termId === currentTerm.termId);
        if (!storedTerm || !sameTermProjection(currentTerm, storedTerm)) {
            return false;
        }
    }
    const currentTerm = value.currentTerm as TermProjection | null;
    const currentTermCourses = currentTerm === null
        ? []
        : courses.filter(course => course.termId === currentTerm.termId && !course.archived);
    const hasMeetingOrTask = currentTermCourses.some(course => course.meetings.length > 0
        || tasks.some(task => task.courseId === course.courseId));
    if (minimum.hasCurrentTerm !== (currentTerm !== null)
        || minimum.hasCurrentTermCourse !== (currentTermCourses.length > 0)
        || minimum.hasMeetingOrTask !== hasMeetingOrTask
        || minimum.isSatisfied !== (minimum.hasCurrentTerm
            && minimum.hasCurrentTermCourse
            && minimum.hasMeetingOrTask)
        || value.defaultRoute !== (value.everReachedMinimum ? 'today' : 'setup')) {
        return false;
    }
    return courses.every(course => {
        const term = terms.find(candidate => candidate.termId === course.termId);
        return term !== undefined
            && course.teachingRange.startDate >= term.startDate
            && course.teachingRange.endDate <= term.endDate
            && (course.teachingRange.kind !== 'inherit-term'
                || (course.teachingRange.startDate === term.startDate
                    && course.teachingRange.endDate === term.endDate));
    }) && holidayRanges.every(holidayRange => {
        const term = terms.find(candidate => candidate.termId === holidayRange.termId);
        return term !== undefined
            && holidayRange.startDate >= term.startDate
            && holidayRange.endDate <= term.endDate;
    }) && tasks.every(task => courses.some(course => course.courseId === task.courseId));
}

function isWorkspaceCommandResult(value: unknown): value is WorkspaceCommandResult {
    if (!hasExactDataKeys(value, ['kind', 'revision', 'effects', 'pendingFollowUps'])
        && !hasExactDataKeys(value, ['kind', 'revision', 'effects', 'pendingFollowUps', 'undoCapability'])) {
        return false;
    }
    if (value.kind !== 'committed'
        || !isCanonicalUnsignedSqliteInteger(value.revision)
        || !Array.isArray(value.effects)
        || (value.effects.length !== 1 && value.effects.length !== 2)
        || !Array.isArray(value.pendingFollowUps)
        || value.pendingFollowUps.length !== 1
        || !isCanonicalUuid(value.pendingFollowUps[0])) {
        return false;
    }

    const undoCapability = 'undoCapability' in value ? value.undoCapability : null;
    if (undoCapability !== null
        && (!hasExactDataKeys(undoCapability, [
            'token',
            'taskSeriesId',
            'originalLogicalAnchor',
            'committedRevision',
            'validThroughTaskSeriesVersion',
        ])
            || typeof undoCapability.token !== 'string'
            || !/^[0-9a-f]{64}$/.test(undoCapability.token)
            || !isCanonicalUuid(undoCapability.taskSeriesId)
            || (undoCapability.originalLogicalAnchor !== 'once'
                && !isCanonicalLocalDate(undoCapability.originalLogicalAnchor))
            || !isCanonicalUnsignedSqliteInteger(undoCapability.committedRevision)
            || !isCanonicalUnsignedSqliteInteger(undoCapability.validThroughTaskSeriesVersion))) {
        return false;
    }

    const isEffect = (
        effect: unknown,
        code: WorkspaceCommandEffect['code'],
        entityKind: WorkspaceCommandEffect['entity']['kind'],
    ): boolean => hasExactDataKeys(effect, ['code', 'entity'])
        && effect.code === code
        && hasExactDataKeys(effect.entity, ['kind', 'id', 'version'])
        && effect.entity.kind === entityKind
        && isCanonicalUuid(effect.entity.id)
        && isCanonicalUnsignedSqliteInteger(effect.entity.version);
    const effectsAreValid = value.effects.length === 1
        ? isEffect(value.effects[0], 'plan.term-created-current', 'term')
            || isEffect(value.effects[0], 'plan.term-end-date-updated', 'term')
            || isEffect(value.effects[0], 'plan.term-restored-current', 'term')
            || isEffect(value.effects[0], 'plan.course-created', 'course')
            || isEffect(value.effects[0], 'plan.meeting-series-created', 'meeting-series')
            || isEffect(value.effects[0], 'plan.meeting-occurrence-changed', 'meeting-series')
            || isEffect(value.effects[0], 'plan.meeting-occurrence-cancelled', 'meeting-series')
            || isEffect(value.effects[0], 'plan.holiday-range-created', 'holiday-range')
            || isEffect(value.effects[0], 'plan.holiday-range-updated', 'holiday-range')
            || isEffect(value.effects[0], 'plan.holiday-range-deleted', 'holiday-range')
            || isEffect(value.effects[0], 'plan.task-series-created', 'task-series')
            || isEffect(value.effects[0], 'plan.task-series-updated', 'task-series')
            || isEffect(value.effects[0], 'plan.task-series-deleted', 'task-series')
            || isEffect(value.effects[0], 'plan.task-occurrence-completed', 'task-series')
            || isEffect(value.effects[0], 'plan.task-occurrence-status-set', 'task-series')
            || isEffect(value.effects[0], 'plan.task-progress-set', 'task-series')
            || isEffect(value.effects[0], 'plan.task-occurrence-changed', 'task-series')
            || isEffect(value.effects[0], 'plan.task-occurrence-deleted', 'task-series')
            || isEffect(value.effects[0], 'plan.task-occurrence-state-undone', 'task-series')
            || isEffect(
                value.effects[0],
                'protect.backup-destination-configured',
                'backup-configuration',
            )
        : isEffect(value.effects[0], 'plan.course-created', 'course')
            && isEffect(value.effects[1], 'plan.meeting-series-created', 'meeting-series');
    if (!effectsAreValid || undoCapability === null) {
        return effectsAreValid;
    }

    const reversibleEffect = value.effects.length === 1
        ? value.effects[0] as WorkspaceCommandEffect
        : null;
    return reversibleEffect !== null
        && [
            'plan.task-occurrence-completed',
            'plan.task-occurrence-status-set',
            'plan.task-progress-set',
        ].includes(reversibleEffect.code)
        && undoCapability.committedRevision === value.revision
        && undoCapability.taskSeriesId === reversibleEffect.entity.id
        && undoCapability.validThroughTaskSeriesVersion === reversibleEffect.entity.version;
}

export function isWorkspaceSetupOutcome(
    value: unknown,
    expectedBuildId: string,
    expectedRequestId: string,
    expectedWorkspaceEpoch: string,
): value is WorkspaceSetupOutcome {
    if (!isPlainObject(value)) {
        return false;
    }

    if (value.ok === false) {
        const problem = value.problem;
        const problemKeys = [
            'code',
            'message',
            'requestId',
            'appBuildId',
            'workspaceEpoch',
            'dataEffect',
        ];
        const hasProblemDetails = hasExactDataKeys(problem, [...problemKeys, 'details']);
        const overlapDetailsAreValid = hasProblemDetails
            && problem.code === 'decision-required'
            && hasExactDataKeys(problem.details, ['reason', 'warnings'])
            && problem.details.reason === 'meeting-time-overlap'
            && Array.isArray(problem.details.warnings)
            && problem.details.warnings.length > 0
            && problem.details.warnings.length <= MAX_MEETING_OVERLAP_WARNINGS
            && problem.details.warnings.length === Object.keys(problem.details.warnings).length
            && problem.details.warnings.every(isMeetingOverlapWarning);
        const writerBusyDetailsAreValid = hasProblemDetails
            && problem.code === 'operation-in-progress'
            && hasExactDataKeys(problem.details, ['reason'])
            && problem.details.reason === 'writer-busy';
        const backupOverlapDetailsAreValid = hasProblemDetails
            && problem.code === 'validation'
            && hasExactDataKeys(problem.details, ['reason', 'location'])
            && problem.details.reason === 'backup-location-overlap'
            && (problem.details.location === 'active-data'
                || problem.details.location === 'library-root');
        return hasExactDataKeys(value, ['ok', 'problem'])
            && ((hasExactDataKeys(problem, problemKeys) && problem.code !== 'operation-in-progress')
                || overlapDetailsAreValid
                || writerBusyDetailsAreValid
                || backupOverlapDetailsAreValid)
            && [
                'invalid-request',
                'build-mismatch',
                'stale-workspace',
                'workspace-unavailable',
                'validation',
                'permission',
                'conflict',
                'decision-required',
                'operation-in-progress',
                'identity-conflict',
                'user-cancelled',
                'recovery-required',
            ].includes(problem.code as string)
            && typeof problem.message === 'string'
            && problem.message.length > 0
            && problem.requestId === expectedRequestId
            && problem.appBuildId === expectedBuildId
            && problem.workspaceEpoch === expectedWorkspaceEpoch
            && (problem.dataEffect === 'unchanged'
                || (problem.code === 'recovery-required' && problem.dataEffect === 'unknown'));
    }

    if (value.ok !== true || !hasExactDataKeys(value, ['ok', 'value']) || !isPlainObject(value.value)) {
        return false;
    }
    const outcome = value.value;
    const common = outcome.protocolVersion === BOOTSTRAP_PROTOCOL_VERSION
        && outcome.appBuildId === expectedBuildId
        && outcome.requestId === expectedRequestId
        && outcome.workspaceEpoch === expectedWorkspaceEpoch;
    if (!common) {
        return false;
    }

    if (outcome.kind === 'workspace.setup-projection') {
        return hasExactDataKeys(outcome, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
            'dataMode',
            'projection',
        ])
            && (outcome.dataMode === 'ready' || outcome.dataMode === 'read-only')
            && isSetupProjection(outcome.projection);
    }
    if (outcome.kind === 'workspace.plan-projection') {
        return hasExactDataKeys(outcome, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
            'dataMode',
            'projection',
        ])
            && (outcome.dataMode === 'ready' || outcome.dataMode === 'read-only')
            && isPlanProjection(outcome.projection);
    }
    if (outcome.kind === 'workspace.data-protection-projection') {
        return hasExactDataKeys(outcome, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
            'dataMode',
            'projection',
        ])
            && (outcome.dataMode === 'ready' || outcome.dataMode === 'read-only')
            && isDataProtectionProjection(outcome.projection);
    }
    if (outcome.kind === 'workspace.restore-session') {
        return hasExactDataKeys(outcome, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
            'session',
        ]) && isRestoreSessionView(outcome.session);
    }
    if (outcome.kind === 'workspace.meeting-series-projection') {
        return hasExactDataKeys(outcome, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
            'dataMode',
            'projection',
        ])
            && (outcome.dataMode === 'ready' || outcome.dataMode === 'read-only')
            && isMeetingSeriesDetailProjection(outcome.projection);
    }
    if (outcome.kind === 'workspace.task-series-projection') {
        return hasExactDataKeys(outcome, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
            'dataMode',
            'projection',
        ])
            && (outcome.dataMode === 'ready' || outcome.dataMode === 'read-only')
            && isTaskSeriesDetailProjection(outcome.projection);
    }
    if (outcome.kind === 'workspace.task-occurrence-impact') {
        return hasExactDataKeys(outcome, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
            'dataMode',
            'projection',
        ])
            && (outcome.dataMode === 'ready' || outcome.dataMode === 'read-only')
            && isTaskOccurrenceImpactProjection(outcome.projection);
    }
    if (outcome.kind === 'workspace.meeting-occurrence-impact') {
        return hasExactDataKeys(outcome, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
            'dataMode',
            'projection',
        ])
            && (outcome.dataMode === 'ready' || outcome.dataMode === 'read-only')
            && isMeetingOccurrenceImpactProjection(outcome.projection);
    }
    if (outcome.kind === 'workspace.command-outcome') {
        return hasExactDataKeys(outcome, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
            'outcome',
        ])
            && isWorkspaceCommandResult(outcome.outcome);
    }
    return outcome.kind === 'workspace.initialized'
        && hasExactDataKeys(outcome, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
            'workspaceData',
        ])
        && isPlainObject(outcome.workspaceData)
        && (outcome.workspaceData.kind === 'ready' || outcome.workspaceData.kind === 'read-only');
}
