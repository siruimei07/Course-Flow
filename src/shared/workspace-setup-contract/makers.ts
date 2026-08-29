import { BOOTSTRAP_PROTOCOL_VERSION } from '../bootstrap-contract';
import { AcceptedCreateCourseWithMeetingCommand, CancelMeetingOccurrenceCommand, ChangeMeetingOccurrenceCommand, CreateCourseCommand, CreateMeetingSeriesCommand, MeetingOccurrenceImpactDraft, MeetingOccurrenceWindow, normalizeAcceptedCreateCourseWithMeetingCommand, normalizeCancelMeetingOccurrenceCommand, normalizeCreateCourseCommand, normalizeCreateMeetingSeriesCommand, normalizeMeetingOccurrenceImpactDraft } from '../workspace-course-contract';
import { isMeetingOccurrenceWindow } from '../workspace-course-contract/guards';
import { normalizeChangeMeetingOccurrenceCommand } from '../workspace-course-contract/makers';
import { isCanonicalUnsignedSqliteInteger, isCanonicalUuid } from '../workspace-data-contract';
import { CreateHolidayRangeCommand, DeleteHolidayRangeCommand, UpdateHolidayRangeCommand, normalizeCreateHolidayRangeCommand, normalizeDeleteHolidayRangeCommand, normalizeUpdateHolidayRangeCommand } from '../workspace-holiday-contract';
import { ConfigureBackupDestinationCommand, ConfirmRestoreSessionCommand, StartRestoreSessionCommand, normalizeCancelRestoreSessionCommand, normalizeConfigureBackupDestinationCommand, normalizeConfirmRestoreSessionCommand, normalizeResumeRestoreSessionCommand, normalizeRollbackRestoreSessionCommand, normalizeStartRestoreSessionCommand } from '../workspace-protection-contract';
import type { CancelRestoreSessionCommand, ResumeRestoreSessionCommand, RollbackRestoreSessionCommand } from '../workspace-protection-contract';
import type { CancelMeetingOccurrenceRequest, CancelRestoreSessionRequest, ChangeMeetingOccurrenceRequest, ChangeTaskOccurrenceRequest, CompleteTaskRequest, ConfirmRestoreSessionRequest, CreateCourseRequest, CreateCourseWithMeetingRequest, CreateHolidayRangeRequest, CreateMeetingSeriesRequest, CreateTaskRequest, CreateTermRequest, DeleteHolidayRangeRequest, DeleteTaskOccurrenceOrSeriesRequest, DeleteTaskRequest, DiscardSetupDraftCheckpointRequest, MeetingOccurrenceImpactRequest, MeetingSeriesQueryRequest, PlanQueryRequest, RestoreSessionQueryRequest, RestoreTermAsCurrentRequest, RestoreTermAsCurrentRequestCommand, ResumeRestoreSessionRequest, RollbackRestoreSessionRequest, SaveSetupDraftCheckpointInput, SaveSetupDraftCheckpointRequest, SelectedBackupDestinationRequest, SetTaskOccurrenceStatusRequest, SetTaskProgressRequest, StartRestoreSessionRequest, TaskOccurrenceImpactRequest, TaskSeriesQueryRequest, UndoTaskOccurrenceStateRequest, UpdateHolidayRangeRequest, UpdateTaskRequest, UpdateTermEndDateRequest } from '../workspace-setup-contract';
import { isSetupDraftPayload } from './guards';
import { hasExactDataKeys } from './types';
import type { ConfigureBackupDestinationRequest, DataProtectionQueryRequest, InitializeWorkspaceRequest, SetupQueryRequest } from './types';
import { ChangeTaskOccurrenceCommand, CompleteTaskCommand, CreateTaskCommand, DeleteTaskCommand, DeleteTaskOccurrenceOrSeriesCommand, SetTaskOccurrenceStatusCommand, SetTaskProgressCommand, TaskOccurrenceImpactDraft, TaskOccurrenceWindow, UndoTaskOccurrenceStateCommand, UpdateTaskCommand, isTaskOccurrenceWindow, normalizeChangeTaskOccurrenceCommand, normalizeCompleteTaskCommand, normalizeCreateTaskCommand, normalizeDeleteTaskCommand, normalizeDeleteTaskOccurrenceOrSeriesCommand, normalizeSetTaskOccurrenceStatusCommand, normalizeSetTaskProgressCommand, normalizeTaskOccurrenceImpactDraft, normalizeUndoTaskOccurrenceStateCommand, normalizeUpdateTaskCommand } from '../workspace-task-contract';
import { CreateTermCommand, SETUP_DRAFT_SCHEMA_VERSION, UpdateTermEndDateCommand, normalizeCreateTermCommand, normalizeUpdateTermEndDateCommand } from '../workspace-term-contract';
export function normalizeRestoreTermAsCurrentRequestCommand(
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
    requestedWindow?: MeetingOccurrenceWindow,
): PlanQueryRequest {
    const base = {
        kind: 'workspace.plan.query',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
    } as const;
    if (requestedWindow === undefined) {
        return base;
    }
    if (!isMeetingOccurrenceWindow(requestedWindow)) {
        throw new TypeError('PLAN requested window must be a canonical LocalDate range');
    }
    return { ...base, requestedWindow: { ...requestedWindow } };
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
