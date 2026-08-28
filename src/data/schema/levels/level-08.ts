import { courseIdCheck, taskSegmentIdCheck, taskSeriesIdCheck } from '../base';
import { LEVEL_7_DDL, LEVEL_7_RECEIPT_DDL, LEVEL_7_TABLES } from './level-07';
import { TABLE_COLUMNS } from '../tables';
export const LEVEL_8_RECEIPT_DDL = LEVEL_7_RECEIPT_DDL
    .replace(
        "                'plan.delete-holiday-range'",
        `                'plan.delete-holiday-range',
                'plan.create-task-series',
                'plan.update-task-series',
                'plan.delete-task-series',
                'plan.set-task-occurrence-status'`,
    )
    .replace(
        `            OR (effect_code = 'plan.holiday-range-deleted' AND entity_kind = 'holiday-range')`,
        `            OR (effect_code = 'plan.holiday-range-deleted' AND entity_kind = 'holiday-range')
            OR (effect_code = 'plan.task-series-created' AND entity_kind = 'task-series')
            OR (effect_code = 'plan.task-series-updated' AND entity_kind = 'task-series')
            OR (effect_code = 'plan.task-series-deleted' AND entity_kind = 'task-series')
            OR (effect_code = 'plan.task-occurrence-completed' AND entity_kind = 'task-series')`,
    );

export const LEVEL_8_TASK_OCCURRENCE_STATE_DDL = `
    CREATE TABLE task_occurrence_states (
        task_series_id TEXT NOT NULL CHECK (${taskSeriesIdCheck}),
        original_logical_anchor TEXT NOT NULL CHECK (original_logical_anchor = 'once'),
        status TEXT NOT NULL CHECK (status = 'completed'),
        entity_version INTEGER NOT NULL CHECK (entity_version > 0),
        PRIMARY KEY (task_series_id, original_logical_anchor),
        FOREIGN KEY (task_series_id) REFERENCES task_series(task_series_id) ON DELETE RESTRICT
    ) STRICT;
`;

export const LEVEL_8_TASK_DDL = `
    CREATE TABLE task_series (
        task_series_id TEXT PRIMARY KEY CHECK (${taskSeriesIdCheck}),
        course_id TEXT NOT NULL CHECK (${courseIdCheck}),
        retired INTEGER NOT NULL CHECK (retired IN (0, 1)),
        entity_version INTEGER NOT NULL CHECK (entity_version > 0),
        FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE RESTRICT
    ) STRICT;

    CREATE INDEX task_series_by_course ON task_series(course_id);

    CREATE TABLE task_segments (
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

    ${LEVEL_8_TASK_OCCURRENCE_STATE_DDL}
`;

export const LEVEL_8_DDL = LEVEL_7_DDL.replace(LEVEL_7_RECEIPT_DDL, LEVEL_8_RECEIPT_DDL)
    + LEVEL_8_TASK_DDL;

export const LEVEL_8_TABLE_COLUMNS: Partial<Record<keyof typeof TABLE_COLUMNS, readonly unknown[]>> = {
    task_segments: [
        ['task_segment_id', 'TEXT', 1, 1],
        ['task_series_id', 'TEXT', 1, 0],
        ['title', 'TEXT', 1, 0],
        ['task_size', 'TEXT', 1, 0],
        ['schedule_kind', 'TEXT', 1, 0],
        ['deadline_kind', 'TEXT', 1, 0],
        ['deadline_date', 'TEXT', 0, 0],
        ['deadline_instant', 'TEXT', 0, 0],
        ['deadline_display_zone', 'TEXT', 0, 0],
    ],
    task_occurrence_states: [
        ['task_series_id', 'TEXT', 1, 1],
        ['original_logical_anchor', 'TEXT', 1, 2],
        ['status', 'TEXT', 1, 0],
        ['entity_version', 'INTEGER', 1, 0],
    ],
};

export const LEVEL_8_TABLES = [
    ...LEVEL_7_TABLES,
    'task_series',
    'task_segments',
    'task_occurrence_states',
] as const;
