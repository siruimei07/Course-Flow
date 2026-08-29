export const COURSEFLOW_APPLICATION_ID = 0x43464C57;

export const CURRENT_SCHEMA_LEVEL = 17;

export const UUID_CHECK = `
    length(%COLUMN%) = 36
    AND %COLUMN% = lower(%COLUMN%)
    AND substr(%COLUMN%, 9, 1) = '-'
    AND substr(%COLUMN%, 14, 1) = '-'
    AND substr(%COLUMN%, 19, 1) = '-'
    AND substr(%COLUMN%, 24, 1) = '-'
    AND %COLUMN% NOT GLOB '*[^0-9a-f-]*'
`;

export const workspaceIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'workspace_id');

export const commandIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'command_id');

export const effectEntityIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'entity_id');

export const followUpIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'follow_up_id');

export const originatingCommandIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'originating_command_id');

export const termIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'term_id');

export const currentTermIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'current_term_id');

export const courseIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'course_id');

export const meetingSeriesIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'meeting_series_id');

export const meetingSegmentIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'meeting_segment_id');

export const holidayRangeIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'holiday_range_id');

export const taskSeriesIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'task_series_id');

export const taskSegmentIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'task_segment_id');

export const backupSetIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'backup_set_id');

export const operationIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'operation_id');

export const snapshotIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'snapshot_id');

export const restoreSessionIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'restore_session_id');

export const candidateRefCheck = UUID_CHECK.replaceAll('%COLUMN%', 'candidate_ref');

export const safetySetIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'safety_set_id');

export const libraryRootIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'current_library_root_id');

export const rootGenerationCheck = UUID_CHECK.replaceAll('%COLUMN%', 'current_root_generation');

export const activeWorkspaceIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'active_workspace_id');
