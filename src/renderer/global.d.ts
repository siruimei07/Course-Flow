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
  AcceptedCreateCourseWithMeetingCommand,
} from '../shared/workspace-course-contract';

declare global {
  interface Window {
    courseFlow: Readonly<{
      query(): Promise<BootstrapOutcome>;
      initialize(): Promise<WorkspaceSetupOutcome>;
      querySetup(): Promise<WorkspaceSetupOutcome>;
      createTerm(command: CreateTermCommand): Promise<WorkspaceSetupOutcome>;
      updateTermEndDate(command: UpdateTermEndDateCommand): Promise<WorkspaceSetupOutcome>;
      restoreTermAsCurrent(command: RestoreTermAsCurrentRequestCommand): Promise<WorkspaceSetupOutcome>;
      createCourseWithMeeting(command: AcceptedCreateCourseWithMeetingCommand): Promise<WorkspaceSetupOutcome>;
    }>;
  }
}

export {};
