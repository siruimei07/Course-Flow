import type { BootstrapOutcome } from '../shared/bootstrap-contract';
import type { WorkspaceSetupOutcome } from '../shared/workspace-setup-contract';
import type { CreateTermCommand } from '../shared/workspace-term-contract';
import type { CreateCourseWithMeetingCommand } from '../shared/workspace-course-contract';

declare global {
  interface Window {
    courseFlow: Readonly<{
      query(): Promise<BootstrapOutcome>;
      initialize(): Promise<WorkspaceSetupOutcome>;
      querySetup(): Promise<WorkspaceSetupOutcome>;
      createTerm(command: CreateTermCommand): Promise<WorkspaceSetupOutcome>;
      createCourseWithMeeting(command: CreateCourseWithMeetingCommand): Promise<WorkspaceSetupOutcome>;
    }>;
  }
}

export {};
