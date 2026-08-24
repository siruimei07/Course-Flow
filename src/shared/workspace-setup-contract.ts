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
    normalizeMeetingOccurrenceImpactDraft,
    normalizeAcceptedCreateCourseWithMeetingCommand,
    type AcceptedCreateCourseWithMeetingCommand,
    type CancelMeetingOccurrenceCommand,
    type ChangeMeetingOccurrenceCommand,
    type CourseProjection,
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
    isTaskProjection,
    normalizeCompleteTaskCommand,
    normalizeCreateTaskCommand,
    normalizeDeleteTaskCommand,
    normalizeUpdateTaskCommand,
    type CompleteTaskCommand,
    type CreateTaskCommand,
    type DeleteTaskCommand,
    type TaskProjection,
    type UpdateTaskCommand,
} from './workspace-task-contract';
import {
    normalizeCreateTermCommand,
    normalizeUpdateTermEndDateCommand,
    type CreateTermCommand,
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

export type CreateCourseWithMeetingRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.course.create-with-first-meeting';
    command: AcceptedCreateCourseWithMeetingCommand;
}>;

export type MeetingSeriesQueryRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.meeting-series.query';
    meetingSeriesId: string;
    requestedWindow: MeetingOccurrenceWindow;
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
    | CreateTermRequest
    | UpdateTermEndDateRequest
    | CreateHolidayRangeRequest
    | UpdateHolidayRangeRequest
    | DeleteHolidayRangeRequest
    | CreateTaskRequest
    | UpdateTaskRequest
    | DeleteTaskRequest
    | CompleteTaskRequest
    | RestoreTermAsCurrentRequest
    | CreateCourseWithMeetingRequest
    | MeetingSeriesQueryRequest
    | MeetingOccurrenceImpactRequest
    | ChangeMeetingOccurrenceRequest
    | CancelMeetingOccurrenceRequest;

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
        | 'plan.task-occurrence-completed';
    entity: Readonly<{
        kind: 'term' | 'course' | 'meeting-series' | 'holiday-range' | 'task-series';
        id: string;
        version: string;
    }>;
}>;

export type WorkspaceCommandResult = Readonly<{
    kind: 'committed';
    revision: string;
    effects: readonly [WorkspaceCommandEffect, ...WorkspaceCommandEffect[]];
    pendingFollowUps: readonly [string];
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

    if (value.kind === 'workspace.initialize' || value.kind === 'workspace.setup.query') {
        return hasExactDataKeys(value, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
        ]);
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
            && value.kind !== 'workspace.course.create-with-first-meeting'
            && value.kind !== 'workspace.meeting-occurrence.change'
            && value.kind !== 'workspace.meeting-occurrence.cancel')
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
        if (value.kind === 'workspace.term.create') {
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
        'currentTerm',
        'terms',
        'courses',
        'holidayRanges',
        'tasks',
    ])
        || !isCanonicalUnsignedSqliteInteger(value.workspaceRevision)
        || !isCanonicalUnsignedSqliteInteger(value.planEntityVersion)
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
        || value.kind !== 'committed'
        || !isCanonicalUnsignedSqliteInteger(value.revision)
        || !Array.isArray(value.effects)
        || (value.effects.length !== 1 && value.effects.length !== 2)
        || !Array.isArray(value.pendingFollowUps)
        || value.pendingFollowUps.length !== 1
        || !isCanonicalUuid(value.pendingFollowUps[0])) {
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
    if (value.effects.length === 1) {
        return isEffect(value.effects[0], 'plan.term-created-current', 'term')
            || isEffect(value.effects[0], 'plan.term-end-date-updated', 'term')
            || isEffect(value.effects[0], 'plan.term-restored-current', 'term')
            || isEffect(value.effects[0], 'plan.meeting-occurrence-changed', 'meeting-series')
            || isEffect(value.effects[0], 'plan.meeting-occurrence-cancelled', 'meeting-series')
            || isEffect(value.effects[0], 'plan.holiday-range-created', 'holiday-range')
            || isEffect(value.effects[0], 'plan.holiday-range-updated', 'holiday-range')
            || isEffect(value.effects[0], 'plan.holiday-range-deleted', 'holiday-range')
            || isEffect(value.effects[0], 'plan.task-series-created', 'task-series')
            || isEffect(value.effects[0], 'plan.task-series-updated', 'task-series')
            || isEffect(value.effects[0], 'plan.task-series-deleted', 'task-series')
            || isEffect(value.effects[0], 'plan.task-occurrence-completed', 'task-series');
    }
    return isEffect(value.effects[0], 'plan.course-created', 'course')
        && isEffect(value.effects[1], 'plan.meeting-series-created', 'meeting-series');
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
        return hasExactDataKeys(value, ['ok', 'problem'])
            && ((hasExactDataKeys(problem, problemKeys) && problem.code !== 'operation-in-progress')
                || overlapDetailsAreValid
                || writerBusyDetailsAreValid)
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
