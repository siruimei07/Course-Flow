/**
 * @file Declares the bounded CourseFlow API exposed to the Renderer.
 */

import type { BootstrapOutcome } from '../shared/bootstrap-contract';
import type {
  RestoreTermAsCurrentRequestCommand,
  SaveSetupDraftCheckpointInput,
  WorkspaceSetupOutcome,
} from '../shared/workspace-setup-contract';
import type {
  CreateTermCommand,
  ResetCurrentTermCommand,
  UpdateTermEndDateCommand,
} from '../shared/workspace-term-contract';
import type {
  CreateHolidayRangeCommand,
  DeleteHolidayRangeCommand,
  UpdateHolidayRangeCommand,
} from '../shared/workspace-holiday-contract';
import type {
  CompleteTaskCommand,
  ChangeTaskOccurrenceCommand,
  CreateTaskCommand,
  DeleteTaskCommand,
  DeleteTaskOccurrenceOrSeriesCommand,
  SetTaskOccurrenceStatusCommand,
  SetTaskProgressCommand,
  TaskOccurrenceImpactDraft,
  UpdateTaskCommand,
  UndoTaskOccurrenceStateCommand,
  TaskOccurrenceWindow,
} from '../shared/workspace-task-contract';
import type {
  AcceptedCreateCourseWithMeetingCommand,
  CancelMeetingOccurrenceCommand,
  ChangeMeetingOccurrenceCommand,
  CreateCourseCommand,
  CreateMeetingSeriesCommand,
  MeetingOccurrenceImpactDraft,
  MeetingOccurrenceWindow,
} from '../shared/workspace-course-contract';
import type { WindowControlAction } from '../shared/window-control-contract';
import type {
  ConfirmMigrationRollbackCommand,
  DeleteMigrationSafetyCopyCommand,
  MigrationRollbackActionCommand,
} from '../shared/workspace-migration-contract';
import type {
  ConfigureBackupDestinationCommand,
  ConfirmRestoreSessionCommand,
  RestoreSessionActionCommand,
  StartRestoreSessionCommand,
} from '../shared/workspace-protection-contract';

declare global {
  interface Window {
    courseFlow: Readonly<{
      query(): Promise<BootstrapOutcome>;
      initialize(): Promise<WorkspaceSetupOutcome>;
      querySetup(): Promise<WorkspaceSetupOutcome>;
      queryApplicationBuildStatus(): Promise<WorkspaceSetupOutcome>;
      queryMigrationSafetyCopy(): Promise<WorkspaceSetupOutcome>;
      deleteMigrationSafetyCopy(command: DeleteMigrationSafetyCopyCommand): Promise<WorkspaceSetupOutcome>;
      previewMigrationRollback(): Promise<WorkspaceSetupOutcome>;
      queryMigrationRollbackStatus(
        migrationRollbackSessionId: string | null,
      ): Promise<WorkspaceSetupOutcome>;
      confirmMigrationRollback(command: ConfirmMigrationRollbackCommand): Promise<WorkspaceSetupOutcome>;
      cancelMigrationRollback(command: MigrationRollbackActionCommand): Promise<WorkspaceSetupOutcome>;
      continueMigrationRollback(command: MigrationRollbackActionCommand): Promise<WorkspaceSetupOutcome>;
      queryDataProtection(): Promise<WorkspaceSetupOutcome>;
      configureBackupDestination(command: ConfigureBackupDestinationCommand): Promise<WorkspaceSetupOutcome>;
      startRestoreSession(command: StartRestoreSessionCommand): Promise<WorkspaceSetupOutcome>;
      queryRestoreSession(restoreSessionId: string): Promise<WorkspaceSetupOutcome>;
      confirmRestoreSession(command: ConfirmRestoreSessionCommand): Promise<WorkspaceSetupOutcome>;
      cancelRestoreSession(command: RestoreSessionActionCommand): Promise<WorkspaceSetupOutcome>;
      resumeRestoreSession(command: RestoreSessionActionCommand): Promise<WorkspaceSetupOutcome>;
      rollbackRestoreSession(command: RestoreSessionActionCommand): Promise<WorkspaceSetupOutcome>;
      saveSetupDraftCheckpoint(input: SaveSetupDraftCheckpointInput): Promise<WorkspaceSetupOutcome>;
      discardSetupDraftCheckpoint(expectedVersion: string): Promise<WorkspaceSetupOutcome>;
      queryPlan(requestedWindow?: MeetingOccurrenceWindow): Promise<WorkspaceSetupOutcome>;
      createTerm(command: CreateTermCommand): Promise<WorkspaceSetupOutcome>;
      updateTermEndDate(command: UpdateTermEndDateCommand): Promise<WorkspaceSetupOutcome>;
      resetCurrentTerm(command: ResetCurrentTermCommand): Promise<WorkspaceSetupOutcome>;
      createHolidayRange(command: CreateHolidayRangeCommand): Promise<WorkspaceSetupOutcome>;
      updateHolidayRange(command: UpdateHolidayRangeCommand): Promise<WorkspaceSetupOutcome>;
      deleteHolidayRange(command: DeleteHolidayRangeCommand): Promise<WorkspaceSetupOutcome>;
      createTask(command: CreateTaskCommand): Promise<WorkspaceSetupOutcome>;
      updateTask(command: UpdateTaskCommand): Promise<WorkspaceSetupOutcome>;
      deleteTask(command: DeleteTaskCommand): Promise<WorkspaceSetupOutcome>;
      completeTask(command: CompleteTaskCommand): Promise<WorkspaceSetupOutcome>;
      setTaskOccurrenceStatus(command: SetTaskOccurrenceStatusCommand): Promise<WorkspaceSetupOutcome>;
      setTaskProgress(command: SetTaskProgressCommand): Promise<WorkspaceSetupOutcome>;
      changeTaskOccurrence(command: ChangeTaskOccurrenceCommand): Promise<WorkspaceSetupOutcome>;
      deleteTaskOccurrenceOrSeries(
        command: DeleteTaskOccurrenceOrSeriesCommand,
      ): Promise<WorkspaceSetupOutcome>;
      undoTaskOccurrenceState(command: UndoTaskOccurrenceStateCommand): Promise<WorkspaceSetupOutcome>;
      restoreTermAsCurrent(command: RestoreTermAsCurrentRequestCommand): Promise<WorkspaceSetupOutcome>;
      createCourse(command: CreateCourseCommand): Promise<WorkspaceSetupOutcome>;
      createMeetingSeries(command: CreateMeetingSeriesCommand): Promise<WorkspaceSetupOutcome>;
      createCourseWithMeeting(command: AcceptedCreateCourseWithMeetingCommand): Promise<WorkspaceSetupOutcome>;
      queryMeetingSeries(
        meetingSeriesId: string,
        requestedWindow: MeetingOccurrenceWindow,
      ): Promise<WorkspaceSetupOutcome>;
      queryTaskSeries(
        taskSeriesId: string,
        requestedWindow: TaskOccurrenceWindow,
      ): Promise<WorkspaceSetupOutcome>;
      previewTaskOccurrence(draft: TaskOccurrenceImpactDraft): Promise<WorkspaceSetupOutcome>;
      previewMeetingOccurrence(draft: MeetingOccurrenceImpactDraft): Promise<WorkspaceSetupOutcome>;
      changeMeetingOccurrence(command: ChangeMeetingOccurrenceCommand): Promise<WorkspaceSetupOutcome>;
      cancelMeetingOccurrence(command: CancelMeetingOccurrenceCommand): Promise<WorkspaceSetupOutcome>;
    }>;
    courseFlowWindow: Readonly<{
      control(action: WindowControlAction): void;
    }>;
  }
}

export {};
