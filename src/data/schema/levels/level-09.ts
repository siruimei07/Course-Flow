import { taskSegmentIdCheck, taskSeriesIdCheck } from '../base';
import { LEVEL_8_DDL, LEVEL_8_RECEIPT_DDL, LEVEL_8_TABLES, LEVEL_8_TASK_DDL } from './level-08';
import { TABLE_COLUMNS } from '../tables';
export const LEVEL_9_RECEIPT_DDL = LEVEL_8_RECEIPT_DDL.replace(
    "            OR (intent_kind = 'plan.change-meeting-occurrence' AND intent_schema_version = 2)",
    `            OR (intent_kind = 'plan.change-meeting-occurrence' AND intent_schema_version = 2)
            OR (intent_kind = 'plan.create-task-series' AND intent_schema_version = 2)
            OR (intent_kind = 'plan.update-task-series' AND intent_schema_version = 2)`,
);

export const LEVEL_9_TASK_SEGMENT_DDL = `
    CREATE TABLE task_segments (
        task_segment_id TEXT PRIMARY KEY CHECK (${taskSegmentIdCheck}),
        task_series_id TEXT NOT NULL UNIQUE CHECK (${taskSeriesIdCheck}),
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

    CREATE INDEX task_segments_by_series ON task_segments(task_series_id);
`;

export const LEVEL_9_TASK_DDL = LEVEL_8_TASK_DDL.replace(
    `    CREATE TABLE task_segments (
        task_segment_id TEXT PRIMARY KEY CHECK (${taskSegmentIdCheck}),
        task_series_id TEXT NOT NULL UNIQUE CHECK (${taskSeriesIdCheck}),
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 240 AND title = trim(title)),
        task_size TEXT NOT NULL CHECK (task_size IN ('small', 'large')),
        schedule_kind TEXT NOT NULL CHECK (schedule_kind = 'once'),
        deadline_kind TEXT NOT NULL CHECK (deadline_kind IN ('date-only', 'timed', 'tba')),
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
        CHECK (
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
        ),
        FOREIGN KEY (task_series_id) REFERENCES task_series(task_series_id) ON DELETE RESTRICT
    ) STRICT;

    CREATE INDEX task_segments_by_series ON task_segments(task_series_id);
`,
    LEVEL_9_TASK_SEGMENT_DDL,
);

export const LEVEL_9_DDL = LEVEL_8_DDL
    .replace(LEVEL_8_RECEIPT_DDL, LEVEL_9_RECEIPT_DDL)
    .replace(LEVEL_8_TASK_DDL, LEVEL_9_TASK_DDL);

export const LEVEL_9_TABLE_COLUMNS: Partial<Record<keyof typeof TABLE_COLUMNS, readonly unknown[]>> = {
    task_segments: [
        ['task_segment_id', 'TEXT', 1, 1],
        ['task_series_id', 'TEXT', 1, 0],
        ['title', 'TEXT', 1, 0],
        ['task_size', 'TEXT', 1, 0],
        ['schedule_kind', 'TEXT', 1, 0],
        ['deadline_kind', 'TEXT', 0, 0],
        ['deadline_date', 'TEXT', 0, 0],
        ['deadline_instant', 'TEXT', 0, 0],
        ['deadline_display_zone', 'TEXT', 0, 0],
        ['weekly_start_date', 'TEXT', 0, 0],
        ['weekly_weekday', 'TEXT', 0, 0],
        ['weekly_local_deadline_time', 'TEXT', 0, 0],
        ['weekly_confirmed_end_date', 'TEXT', 0, 0],
        ['follow_teaching_week', 'INTEGER', 0, 0],
    ],
    task_occurrence_states: [
        ['task_series_id', 'TEXT', 1, 1],
        ['original_logical_anchor', 'TEXT', 1, 2],
        ['status', 'TEXT', 1, 0],
        ['entity_version', 'INTEGER', 1, 0],
    ],
};

export const LEVEL_9_TABLES = LEVEL_8_TABLES;
