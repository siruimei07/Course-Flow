import { originatingCommandIdCheck, taskSegmentIdCheck, taskSeriesIdCheck } from '../base';
import { LEVEL_8_TASK_OCCURRENCE_STATE_DDL } from './level-08';
import { LEVEL_9_DDL, LEVEL_9_RECEIPT_DDL, LEVEL_9_TABLES, LEVEL_9_TASK_DDL, LEVEL_9_TASK_SEGMENT_DDL } from './level-09';
export const LEVEL_10_RECEIPT_DDL = LEVEL_9_RECEIPT_DDL
    .replace(
        "                'plan.set-task-occurrence-status'",
        `                'plan.set-task-occurrence-status',
                'plan.set-task-progress',
                'plan.change-task-occurrence',
                'plan.delete-task-occurrence-or-series',
                'plan.undo-task-occurrence-state'`,
    )
    .replace(
        "            OR (intent_kind = 'plan.update-task-series' AND intent_schema_version = 2)",
        `            OR (intent_kind = 'plan.update-task-series' AND intent_schema_version = 2)
            OR (intent_kind = 'plan.set-task-occurrence-status' AND intent_schema_version = 2)
            OR (intent_kind = 'plan.set-task-progress' AND intent_schema_version = 1)
            OR (intent_kind = 'plan.change-task-occurrence' AND intent_schema_version = 1)
            OR (intent_kind = 'plan.delete-task-occurrence-or-series' AND intent_schema_version = 1)
            OR (intent_kind = 'plan.undo-task-occurrence-state' AND intent_schema_version = 1)`,
    )
    .replace(
        `            OR (effect_code = 'plan.task-occurrence-completed' AND entity_kind = 'task-series')`,
        `            OR (effect_code = 'plan.task-occurrence-completed' AND entity_kind = 'task-series')
            OR (effect_code = 'plan.task-occurrence-status-set' AND entity_kind = 'task-series')
            OR (effect_code = 'plan.task-progress-set' AND entity_kind = 'task-series')
            OR (effect_code = 'plan.task-occurrence-changed' AND entity_kind = 'task-series')
            OR (effect_code = 'plan.task-occurrence-deleted' AND entity_kind = 'task-series')
            OR (effect_code = 'plan.task-occurrence-state-undone' AND entity_kind = 'task-series')`,
    );

export const LEVEL_10_TASK_SEGMENT_DDL = `
    CREATE TABLE task_segments (
        task_segment_id TEXT PRIMARY KEY CHECK (${taskSegmentIdCheck}),
        task_series_id TEXT NOT NULL CHECK (${taskSeriesIdCheck}),
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 240 AND title = trim(title)),
        task_size TEXT NOT NULL CHECK (task_size IN ('small', 'large')),
        schedule_kind TEXT NOT NULL CHECK (schedule_kind IN ('once', 'weekly')),
        deadline_kind TEXT CHECK (deadline_kind IN ('date-only', 'timed', 'tba')),
        deadline_date TEXT CHECK (
            deadline_date IS NULL
            OR (
                length(deadline_date) = 10
                AND substr(deadline_date, 5, 1) = '-'
                AND substr(deadline_date, 8, 1) = '-'
                AND deadline_date NOT GLOB '*[^0-9-]*'
            )
        ),
        deadline_instant TEXT,
        deadline_display_zone TEXT CHECK (
            deadline_display_zone IS NULL
            OR length(deadline_display_zone) BETWEEN 1 AND 255
        ),
        logical_start_anchor TEXT NOT NULL CHECK (
            logical_start_anchor = 'once'
            OR (
                length(logical_start_anchor) = 10
                AND substr(logical_start_anchor, 5, 1) = '-'
                AND substr(logical_start_anchor, 8, 1) = '-'
                AND logical_start_anchor NOT GLOB '*[^0-9-]*'
            )
        ),
        logical_end_anchor TEXT NOT NULL CHECK (
            logical_end_anchor = 'once'
            OR (
                length(logical_end_anchor) = 10
                AND substr(logical_end_anchor, 5, 1) = '-'
                AND substr(logical_end_anchor, 8, 1) = '-'
                AND logical_end_anchor NOT GLOB '*[^0-9-]*'
            )
        ),
        weekly_start_date TEXT CHECK (
            weekly_start_date IS NULL
            OR (
                length(weekly_start_date) = 10
                AND substr(weekly_start_date, 5, 1) = '-'
                AND substr(weekly_start_date, 8, 1) = '-'
                AND weekly_start_date NOT GLOB '*[^0-9-]*'
            )
        ),
        weekly_weekday TEXT CHECK (
            weekly_weekday IS NULL
            OR weekly_weekday IN ('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN')
        ),
        weekly_local_deadline_time TEXT CHECK (
            weekly_local_deadline_time IS NULL
            OR (
                weekly_local_deadline_time GLOB '[0-2][0-9]:[0-5][0-9]'
                AND CAST(substr(weekly_local_deadline_time, 1, 2) AS INTEGER) BETWEEN 0 AND 23
            )
        ),
        weekly_confirmed_end_date TEXT CHECK (
            weekly_confirmed_end_date IS NULL
            OR (
                length(weekly_confirmed_end_date) = 10
                AND substr(weekly_confirmed_end_date, 5, 1) = '-'
                AND substr(weekly_confirmed_end_date, 8, 1) = '-'
                AND weekly_confirmed_end_date NOT GLOB '*[^0-9-]*'
            )
        ),
        follow_teaching_week INTEGER CHECK (follow_teaching_week IN (0, 1)),
        CHECK (
            (
                schedule_kind = 'once'
                AND logical_start_anchor = 'once'
                AND logical_end_anchor = 'once'
                AND deadline_kind IS NOT NULL
                AND weekly_start_date IS NULL
                AND weekly_weekday IS NULL
                AND weekly_local_deadline_time IS NULL
                AND weekly_confirmed_end_date IS NULL
                AND follow_teaching_week IS NULL
                AND (
                    (deadline_kind = 'date-only'
                        AND deadline_date IS NOT NULL
                        AND deadline_instant IS NULL
                        AND deadline_display_zone IS NULL)
                    OR (deadline_kind = 'timed'
                        AND deadline_date IS NULL
                        AND deadline_instant IS NOT NULL
                        AND deadline_display_zone IS NOT NULL)
                    OR (deadline_kind = 'tba'
                        AND deadline_date IS NULL
                        AND deadline_instant IS NULL
                        AND deadline_display_zone IS NULL)
                )
            )
            OR (
                schedule_kind = 'weekly'
                AND logical_start_anchor <> 'once'
                AND logical_end_anchor <> 'once'
                AND logical_end_anchor >= logical_start_anchor
                AND deadline_kind IS NULL
                AND deadline_date IS NULL
                AND deadline_instant IS NULL
                AND deadline_display_zone IS NULL
                AND weekly_start_date IS NOT NULL
                AND weekly_weekday IS NOT NULL
                AND weekly_local_deadline_time IS NOT NULL
                AND weekly_confirmed_end_date IS NOT NULL
                AND weekly_confirmed_end_date >= weekly_start_date
                AND follow_teaching_week IS NOT NULL
            )
        ),
        FOREIGN KEY (task_series_id) REFERENCES task_series(task_series_id) ON DELETE RESTRICT
    ) STRICT;

    CREATE UNIQUE INDEX task_segments_by_series_start
        ON task_segments(task_series_id, logical_start_anchor);
`;

export const LEVEL_10_TASK_OCCURRENCE_STATE_DDL = `
    CREATE TABLE task_occurrence_states (
        task_series_id TEXT NOT NULL CHECK (${taskSeriesIdCheck}),
        original_logical_anchor TEXT NOT NULL CHECK (
            original_logical_anchor = 'once'
            OR (
                length(original_logical_anchor) = 10
                AND substr(original_logical_anchor, 5, 1) = '-'
                AND substr(original_logical_anchor, 8, 1) = '-'
                AND original_logical_anchor NOT GLOB '*[^0-9-]*'
            )
        ),
        status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'skipped')),
        self_reported_progress INTEGER CHECK (self_reported_progress BETWEEN 0 AND 100),
        entity_version INTEGER NOT NULL CHECK (entity_version > 0),
        PRIMARY KEY (task_series_id, original_logical_anchor),
        FOREIGN KEY (task_series_id) REFERENCES task_series(task_series_id) ON DELETE RESTRICT
    ) STRICT;
`;

export const LEVEL_10_TASK_OVERRIDE_AND_HISTORY_DDL = `
    CREATE TABLE task_occurrence_overrides (
        task_series_id TEXT NOT NULL CHECK (${taskSeriesIdCheck}),
        original_logical_anchor TEXT NOT NULL CHECK (
            original_logical_anchor = 'once'
            OR (
                length(original_logical_anchor) = 10
                AND substr(original_logical_anchor, 5, 1) = '-'
                AND substr(original_logical_anchor, 8, 1) = '-'
                AND original_logical_anchor NOT GLOB '*[^0-9-]*'
            )
        ),
        override_kind TEXT NOT NULL CHECK (override_kind IN ('replaced', 'deleted')),
        replacement_title TEXT CHECK (
            replacement_title IS NULL
            OR (length(replacement_title) BETWEEN 1 AND 240 AND replacement_title = trim(replacement_title))
        ),
        replacement_task_size TEXT CHECK (replacement_task_size IS NULL OR replacement_task_size IN ('small', 'large')),
        replacement_deadline_kind TEXT CHECK (
            replacement_deadline_kind IS NULL OR replacement_deadline_kind IN ('date-only', 'timed', 'tba')
        ),
        replacement_deadline_date TEXT CHECK (
            replacement_deadline_date IS NULL
            OR (
                length(replacement_deadline_date) = 10
                AND substr(replacement_deadline_date, 5, 1) = '-'
                AND substr(replacement_deadline_date, 8, 1) = '-'
                AND replacement_deadline_date NOT GLOB '*[^0-9-]*'
            )
        ),
        replacement_deadline_instant TEXT,
        replacement_deadline_display_zone TEXT CHECK (
            replacement_deadline_display_zone IS NULL
            OR length(replacement_deadline_display_zone) BETWEEN 1 AND 255
        ),
        entity_version INTEGER NOT NULL CHECK (entity_version > 0),
        CHECK (
            (
                override_kind = 'deleted'
                AND replacement_title IS NULL
                AND replacement_task_size IS NULL
                AND replacement_deadline_kind IS NULL
                AND replacement_deadline_date IS NULL
                AND replacement_deadline_instant IS NULL
                AND replacement_deadline_display_zone IS NULL
            )
            OR (
                override_kind = 'replaced'
                AND replacement_title IS NOT NULL
                AND replacement_task_size IS NOT NULL
                AND replacement_deadline_kind IS NOT NULL
                AND (
                    (replacement_deadline_kind = 'date-only'
                        AND replacement_deadline_date IS NOT NULL
                        AND replacement_deadline_instant IS NULL
                        AND replacement_deadline_display_zone IS NULL)
                    OR (replacement_deadline_kind = 'timed'
                        AND replacement_deadline_date IS NULL
                        AND replacement_deadline_instant IS NOT NULL
                        AND replacement_deadline_display_zone IS NOT NULL)
                    OR (replacement_deadline_kind = 'tba'
                        AND replacement_deadline_date IS NULL
                        AND replacement_deadline_instant IS NULL
                        AND replacement_deadline_display_zone IS NULL)
                )
            )
        ),
        PRIMARY KEY (task_series_id, original_logical_anchor),
        FOREIGN KEY (task_series_id) REFERENCES task_series(task_series_id) ON DELETE RESTRICT
    ) STRICT;

    CREATE TABLE task_state_history (
        undo_token TEXT PRIMARY KEY CHECK (
            length(undo_token) = 64
            AND undo_token = lower(undo_token)
            AND undo_token NOT GLOB '*[^0-9a-f]*'
        ),
        originating_command_id TEXT NOT NULL CHECK (${originatingCommandIdCheck}),
        task_series_id TEXT NOT NULL CHECK (${taskSeriesIdCheck}),
        original_logical_anchor TEXT NOT NULL CHECK (
            original_logical_anchor = 'once'
            OR (
                length(original_logical_anchor) = 10
                AND substr(original_logical_anchor, 5, 1) = '-'
                AND substr(original_logical_anchor, 8, 1) = '-'
                AND original_logical_anchor NOT GLOB '*[^0-9-]*'
            )
        ),
        before_row_present INTEGER NOT NULL CHECK (before_row_present IN (0, 1)),
        before_status TEXT CHECK (before_status IN ('pending', 'completed', 'skipped')),
        before_self_reported_progress INTEGER CHECK (before_self_reported_progress BETWEEN 0 AND 100),
        after_state_version INTEGER NOT NULL CHECK (after_state_version > 0),
        consumed INTEGER NOT NULL CHECK (consumed IN (0, 1)),
        CHECK (
            (before_row_present = 0 AND before_status IS NULL AND before_self_reported_progress IS NULL)
            OR (before_row_present = 1 AND before_status IS NOT NULL)
        ),
        FOREIGN KEY (originating_command_id) REFERENCES command_receipts(command_id)
            ON DELETE RESTRICT,
        FOREIGN KEY (task_series_id) REFERENCES task_series(task_series_id) ON DELETE RESTRICT
    ) STRICT;

    CREATE UNIQUE INDEX task_state_history_by_command
        ON task_state_history(originating_command_id);
`;

export const LEVEL_10_TASK_STATE_HISTORY_DDL = LEVEL_10_TASK_OVERRIDE_AND_HISTORY_DDL.slice(
    LEVEL_10_TASK_OVERRIDE_AND_HISTORY_DDL.indexOf('    CREATE TABLE task_state_history'),
);

export const LEVEL_10_TASK_DDL = LEVEL_9_TASK_DDL
    .replace(LEVEL_9_TASK_SEGMENT_DDL, LEVEL_10_TASK_SEGMENT_DDL)
    .replace(LEVEL_8_TASK_OCCURRENCE_STATE_DDL, LEVEL_10_TASK_OCCURRENCE_STATE_DDL)
    + LEVEL_10_TASK_OVERRIDE_AND_HISTORY_DDL;

export const LEVEL_10_DDL = LEVEL_9_DDL
    .replace(LEVEL_9_RECEIPT_DDL, LEVEL_10_RECEIPT_DDL)
    .replace(LEVEL_9_TASK_DDL, LEVEL_10_TASK_DDL);

export const LEVEL_10_TABLES = [
    ...LEVEL_9_TABLES,
    'task_occurrence_overrides',
    'task_state_history',
] as const;
