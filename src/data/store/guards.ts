import { AcceptedCreateCourseWithMeetingCommand, CancelMeetingOccurrenceCommand, ChangeMeetingOccurrenceCommand, CreateCourseCommand, CreateMeetingSeriesCommand } from '../../shared/workspace-course-contract';
import type { AcceptedChangeMeetingOccurrenceCommand, CreateCourseWithMeetingCommand } from '../../shared/workspace-course-contract';
import type { RecordSetupDecisionCommand } from '../../shared/workspace-data-contract';
import type { HolidayRangeCommand } from '../../shared/workspace-holiday-contract';
import type { AcceptedConfigureBackupDestinationCommand } from '../../shared/workspace-protection-contract';
import { ChangeTaskOccurrenceCommand, CompleteTaskCommand, CreateTaskCommand, DeleteTaskCommand, DeleteTaskOccurrenceOrSeriesCommand, SetTaskOccurrenceStatusCommand, SetTaskProgressCommand, TaskCommand, UndoTaskOccurrenceStateCommand, UpdateTaskCommand } from '../../shared/workspace-task-contract';
import { CreateTermCommand, UpdateTermEndDateCommand } from '../../shared/workspace-term-contract';
import type { ReconcileWorkspaceLifecycleCommand, RestoreTermAsCurrentCommand } from '../../shared/workspace-term-contract';

export type TermMutationCommand =
    | ReconcileWorkspaceLifecycleCommand
    | UpdateTermEndDateCommand
    | RestoreTermAsCurrentCommand;

export type MeetingOccurrenceMutationCommand =
    | AcceptedChangeMeetingOccurrenceCommand
    | CancelMeetingOccurrenceCommand;

export type TaskSeriesMutationCommand =
    | CreateTaskCommand
    | UpdateTaskCommand
    | DeleteTaskCommand;

export type TaskOccurrenceStateMutationCommand =
    | CompleteTaskCommand
    | SetTaskOccurrenceStatusCommand
    | SetTaskProgressCommand
    | UndoTaskOccurrenceStateCommand;

export type TaskOccurrenceRuleMutationCommand =
    | ChangeTaskOccurrenceCommand
    | DeleteTaskOccurrenceOrSeriesCommand;

export type WorkspaceDataCommand =
    | RecordSetupDecisionCommand
    | CreateTermCommand
    | CreateCourseCommand
    | CreateMeetingSeriesCommand
    | AcceptedCreateCourseWithMeetingCommand
    | MeetingOccurrenceMutationCommand
    | HolidayRangeCommand
    | TaskCommand
    | TermMutationCommand
    | AcceptedConfigureBackupDestinationCommand;

export type CurrentVersions = Readonly<{
    revision: bigint;
    setupVersion: bigint;
    planVersion: bigint;
    protectionVersion: bigint;
}>;

export function isCourseWithMeetingCommand(
    command: WorkspaceDataCommand,
): command is AcceptedCreateCourseWithMeetingCommand {
    return command.intent.kind === 'plan.create-course-with-first-meeting';
}

export function isCreateCourseCommand(command: WorkspaceDataCommand): command is CreateCourseCommand {
    return command.intent.kind === 'plan.create-course';
}

export function isCreateMeetingSeriesCommand(
    command: WorkspaceDataCommand,
): command is CreateMeetingSeriesCommand {
    return command.intent.kind === 'plan.create-meeting-series';
}

/**
 * Narrows an accepted Course creation to the current writable schema.
 * @param {AcceptedCreateCourseWithMeetingCommand} command - Accepted creation command.
 * @return {boolean} Whether the command carries current overlap and day-offset semantics.
 */
export function isCurrentCourseWithMeetingCommand(
    command: AcceptedCreateCourseWithMeetingCommand,
): command is CreateCourseWithMeetingCommand {
    return 'overlapDecision' in command;
}

/**
 * Narrows a Workspace DATA command to a Meeting occurrence mutation.
 * @param {WorkspaceDataCommand} command - Normalized DATA command.
 * @return {boolean} Whether the command mutates one occurrence or a future rule segment.
 */
export function isMeetingOccurrenceMutationCommand(
    command: WorkspaceDataCommand,
): command is MeetingOccurrenceMutationCommand {
    return command.intent.kind === 'plan.change-meeting-occurrence'
        || command.intent.kind === 'plan.cancel-meeting-occurrence';
}

/**
 * Narrows an occurrence mutation to its change variant.
 * @param {MeetingOccurrenceMutationCommand} command - Normalized occurrence mutation.
 * @return {boolean} Whether the command carries a replacement rule.
 */
export function isChangeMeetingOccurrenceCommand(
    command: MeetingOccurrenceMutationCommand,
): command is AcceptedChangeMeetingOccurrenceCommand {
    return command.intent.kind === 'plan.change-meeting-occurrence';
}

/**
 * Narrows an accepted occurrence change to the current writable schema.
 * @param {AcceptedChangeMeetingOccurrenceCommand} command - Accepted change command.
 * @return {boolean} Whether the command carries current overlap and day-offset semantics.
 */
export function isCurrentChangeMeetingOccurrenceCommand(
    command: AcceptedChangeMeetingOccurrenceCommand,
): command is ChangeMeetingOccurrenceCommand {
    return 'overlapDecision' in command;
}

export function isTermMutationCommand(command: WorkspaceDataCommand): command is TermMutationCommand {
    return command.intent.kind === 'workspace.reconcile-lifecycle'
        || command.intent.kind === 'plan.update-term-end-date'
        || command.intent.kind === 'plan.restore-term-as-current';
}

export function isHolidayRangeCommand(command: WorkspaceDataCommand): command is HolidayRangeCommand {
    return command.intent.kind === 'plan.create-holiday-range'
        || command.intent.kind === 'plan.update-holiday-range'
        || command.intent.kind === 'plan.delete-holiday-range';
}

export function isTaskCommand(command: WorkspaceDataCommand): command is TaskCommand {
    return command.intent.kind === 'plan.create-task-series'
        || command.intent.kind === 'plan.update-task-series'
        || command.intent.kind === 'plan.delete-task-series'
        || command.intent.kind === 'plan.set-task-occurrence-status'
        || command.intent.kind === 'plan.set-task-progress'
        || command.intent.kind === 'plan.change-task-occurrence'
        || command.intent.kind === 'plan.delete-task-occurrence-or-series'
        || command.intent.kind === 'plan.undo-task-occurrence-state';
}

export function isTaskOccurrenceStateMutationCommand(
    command: TaskCommand,
): command is TaskOccurrenceStateMutationCommand {
    return command.intent.kind === 'plan.set-task-occurrence-status'
        || command.intent.kind === 'plan.set-task-progress'
        || command.intent.kind === 'plan.undo-task-occurrence-state';
}

export function isTaskOccurrenceRuleMutationCommand(
    command: TaskCommand,
): command is TaskOccurrenceRuleMutationCommand {
    return command.intent.kind === 'plan.change-task-occurrence'
        || command.intent.kind === 'plan.delete-task-occurrence-or-series';
}

export function isConfigureBackupDestinationCommand(
    command: WorkspaceDataCommand,
): command is AcceptedConfigureBackupDestinationCommand {
    return command.intent.kind === 'protect.configure-backup-destination';
}
