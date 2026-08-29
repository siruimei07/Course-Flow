import { commitBackupConfigurationSynchronously } from './backup-configuration';
import { commitCourseSynchronously, commitCourseWithMeetingSynchronously } from './course';
import { commitHolidayRangeSynchronously } from './holiday';
import { commitMeetingOccurrenceMutationSynchronously, commitMeetingSeriesSynchronously } from './meeting';
import { commitResetCurrentTermSynchronously } from './reset';
import { commitSetupSynchronously } from './setup';
import { commitTaskOccurrenceRuleSynchronously, commitTaskOccurrenceStateSynchronously, commitTaskSynchronously } from './task';
import { commitTermMutationSynchronously, commitTermSynchronously } from './term';
import type { StoreContext } from '../context';
import { isResetCurrentTermCommand, isConfigureBackupDestinationCommand, isCourseWithMeetingCommand, isCreateCourseCommand, isCreateMeetingSeriesCommand, isHolidayRangeCommand, isMeetingOccurrenceMutationCommand, isTaskCommand, isTaskOccurrenceRuleMutationCommand, isTaskOccurrenceStateMutationCommand, isTermMutationCommand } from '../guards';
import type { WorkspaceDataCommand } from '../guards';
import type { CommitOptions, DataCommitResult } from '../types';
export function commitSynchronously(ctx: StoreContext, 
    command: WorkspaceDataCommand,
    options: CommitOptions,
): DataCommitResult {
    if (isConfigureBackupDestinationCommand(command)) {
        return commitBackupConfigurationSynchronously(ctx, command, options);
    }
    if (!('expectedPlanVersion' in command)) {
        return commitSetupSynchronously(ctx, command, options);
    }
    if (isCourseWithMeetingCommand(command)) {
        return commitCourseWithMeetingSynchronously(ctx, command, options);
    }
    if (isCreateCourseCommand(command)) {
        return commitCourseSynchronously(ctx, command, options);
    }
    if (isCreateMeetingSeriesCommand(command)) {
        return commitMeetingSeriesSynchronously(ctx, command, options);
    }
    if (isMeetingOccurrenceMutationCommand(command)) {
        return commitMeetingOccurrenceMutationSynchronously(ctx, command, options);
    }
    if (isResetCurrentTermCommand(command)) {
        return commitResetCurrentTermSynchronously(ctx, command, options);
    }
    if (isTermMutationCommand(command)) {
        return commitTermMutationSynchronously(ctx, command, options);
    }
    if (isHolidayRangeCommand(command)) {
        return commitHolidayRangeSynchronously(ctx, command, options);
    }
    if (isTaskCommand(command)) {
        if (isTaskOccurrenceStateMutationCommand(command)) {
            return commitTaskOccurrenceStateSynchronously(ctx, command, options);
        }
        if (isTaskOccurrenceRuleMutationCommand(command)) {
            return commitTaskOccurrenceRuleSynchronously(ctx, command, options);
        }
        return commitTaskSynchronously(ctx, command, options);
    }
    return commitTermSynchronously(ctx, command, options);
}
