/**
 * @file Declares the bounded CourseFlow API exposed to the Renderer.
 */

import type { BootstrapOutcome } from '../shared/bootstrap-contract';
import type {
  RestoreTermAsCurrentRequestCommand,
  WorkspaceSetupOutcome,
} from '../shared/workspace-setup-contract';
import type {
  CreateTermCommand,
  UpdateTermEndDateCommand,
} from '../shared/workspace-term-contract';
import type {
  CreateHolidayRangeCommand,
  DeleteHolidayRangeCommand,
  UpdateHolidayRangeCommand,
} from '../shared/workspace-holiday-contract';
import type {
  CompleteTaskCommand,
  CreateTaskCommand,
  DeleteTaskCommand,
  UpdateTaskCommand,
} from '../shared/workspace-task-contract';
import type {
  AcceptedCreateCourseWithMeetingCommand,
  CancelMeetingOccurrenceCommand,
  ChangeMeetingOccurrenceCommand,
  MeetingOccurrenceImpactDraft,
  MeetingOccurrenceWindow,
} from '../shared/workspace-course-contract';

declare global {
  interface Window {
    courseFlow: Readonly<{
      query(): Promise<BootstrapOutcome>;
      initialize(): Promise<WorkspaceSetupOutcome>;
      querySetup(): Promise<WorkspaceSetupOutcome>;
      createTerm(command: CreateTermCommand): Promise<WorkspaceSetupOutcome>;
      updateTermEndDate(command: UpdateTermEndDateCommand): Promise<WorkspaceSetupOutcome>;
      createHolidayRange(command: CreateHolidayRangeCommand): Promise<WorkspaceSetupOutcome>;
      updateHolidayRange(command: UpdateHolidayRangeCommand): Promise<WorkspaceSetupOutcome>;
      deleteHolidayRange(command: DeleteHolidayRangeCommand): Promise<WorkspaceSetupOutcome>;
      createTask(command: CreateTaskCommand): Promise<WorkspaceSetupOutcome>;
      updateTask(command: UpdateTaskCommand): Promise<WorkspaceSetupOutcome>;
      deleteTask(command: DeleteTaskCommand): Promise<WorkspaceSetupOutcome>;
      completeTask(command: CompleteTaskCommand): Promise<WorkspaceSetupOutcome>;
      restoreTermAsCurrent(command: RestoreTermAsCurrentRequestCommand): Promise<WorkspaceSetupOutcome>;
      createCourseWithMeeting(command: AcceptedCreateCourseWithMeetingCommand): Promise<WorkspaceSetupOutcome>;
      queryMeetingSeries(
        meetingSeriesId: string,
        requestedWindow: MeetingOccurrenceWindow,
      ): Promise<WorkspaceSetupOutcome>;
      previewMeetingOccurrence(draft: MeetingOccurrenceImpactDraft): Promise<WorkspaceSetupOutcome>;
      changeMeetingOccurrence(command: ChangeMeetingOccurrenceCommand): Promise<WorkspaceSetupOutcome>;
      cancelMeetingOccurrence(command: CancelMeetingOccurrenceCommand): Promise<WorkspaceSetupOutcome>;
    }>;
  }
}

export {};
