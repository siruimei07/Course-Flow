import { BOOTSTRAP_PROTOCOL_VERSION, WorkspaceDataStatus } from '../bootstrap-contract';
import { AcceptedCreateCourseWithMeetingCommand, CancelMeetingOccurrenceCommand, ChangeMeetingOccurrenceCommand, CreateCourseCommand, CreateMeetingSeriesCommand, MeetingOccurrenceImpactDraft, MeetingOccurrenceImpactProjection, MeetingOccurrenceWindow, MeetingOverlapWarning, MeetingSeriesDetailProjection } from '../workspace-course-contract';
import { CreateHolidayRangeCommand, DeleteHolidayRangeCommand, UpdateHolidayRangeCommand } from '../workspace-holiday-contract';
import type { WorkspaceMigrationRequest, WorkspaceMigrationSuccessValue } from '../workspace-migration-contract';
import { PlanProjection } from '../workspace-plan-contract';
import { ConfigureBackupDestinationCommand, ConfirmRestoreSessionCommand, StartRestoreSessionCommand } from '../workspace-protection-contract';
import type { CancelRestoreSessionCommand, DataProtectionProjection, RestoreSessionView, ResumeRestoreSessionCommand, RollbackRestoreSessionCommand } from '../workspace-protection-contract';
import { isPlainObject } from './guards';
import { ChangeTaskOccurrenceCommand, CompleteTaskCommand, CreateTaskCommand, DeleteTaskCommand, DeleteTaskOccurrenceOrSeriesCommand, SetTaskOccurrenceStatusCommand, SetTaskProgressCommand, TaskOccurrenceImpactDraft, TaskOccurrenceImpactProjection, TaskOccurrenceWindow, TaskSeriesDetailProjection, TaskUndoCapability, UndoTaskOccurrenceStateCommand, UpdateTaskCommand } from '../workspace-task-contract';
import { CreateTermCommand, SETUP_DRAFT_SCHEMA_VERSION, SetupProjection, TermProjection, UpdateTermEndDateCommand } from '../workspace-term-contract';
export const WORKSPACE_SETUP_CHANNEL = 'courseflow:workspace-setup' as const;

/**
 * Request kinds whose malformed payloads still identify a known Workspace intent.
 * The Main transport reports these as `validation` instead of `invalid-request`.
 */
export const WORKSPACE_SETUP_VALIDATION_REQUEST_KINDS = Object.freeze([
    'workspace.term.create',
    'workspace.term.update-end-date',
    'workspace.term.restore-as-current',
    'workspace.holiday-range.create',
    'workspace.holiday-range.update',
    'workspace.holiday-range.delete',
    'workspace.course.create-with-first-meeting',
    'workspace.meeting-series.query',
    'workspace.task-series.query',
    'workspace.task.set-occurrence-status',
    'workspace.task.set-progress',
    'workspace.task.change-occurrence',
    'workspace.task.delete-occurrence-or-series',
    'workspace.task.undo-occurrence-state',
    'workspace.task-occurrence.preview',
    'workspace.meeting-occurrence.preview',
    'workspace.meeting-occurrence.change',
    'workspace.meeting-occurrence.cancel',
    'workspace.protection.query',
    'workspace.protection.configure',
    'workspace.application-build.query',
    'workspace.migration-safety.query',
    'workspace.migration-safety.delete',
    'workspace.migration-rollback.preview',
    'workspace.migration-rollback.query',
    'workspace.migration-rollback.confirm',
    'workspace.migration-rollback.cancel',
    'workspace.migration-rollback.continue',
] as const);

export type WorkspaceRequestBase = Readonly<{
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
    /** Explicit Calendar window; absent means the Current Term week that contains today. */
    requestedWindow?: MeetingOccurrenceWindow;
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
    | CancelMeetingOccurrenceRequest
    | WorkspaceMigrationRequest;

export type WorkspaceProcessRequest =
    | Exclude<WorkspaceSetupRequest, ConfigureBackupDestinationRequest>
    | SelectedBackupDestinationRequest;

export type WorkspaceCommandEffect = Readonly<{
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
        value: WorkspaceMigrationSuccessValue;
    }>
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

export function hasExactDataKeys(value: unknown, expectedKeys: readonly string[]): value is Record<string, unknown> {
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

export function sameTermProjection(first: TermProjection, second: TermProjection): boolean {
    return first.termId === second.termId
        && first.name === second.name
        && first.startDate === second.startDate
        && first.endDate === second.endDate
        && first.timeZone === second.timeZone
        && first.archived === second.archived
        && first.entityVersion === second.entityVersion;
}
