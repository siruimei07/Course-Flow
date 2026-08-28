import { commandIdCheck, courseIdCheck, effectEntityIdCheck, meetingSegmentIdCheck, meetingSeriesIdCheck, termIdCheck } from '../base';
import { LEVEL_2_DDL, LEVEL_2_RECEIPT_DDL, LEVEL_2_TABLES } from './level-02';
import { TABLE_COLUMNS } from '../tables';
export const LEVEL_3_RECEIPT_DDL = `
    CREATE TABLE command_receipts (
        command_id TEXT PRIMARY KEY CHECK (${commandIdCheck}),
        intent_kind TEXT NOT NULL CHECK (
            intent_kind IN (
                'workspace.record-setup-decision',
                'plan.create-term',
                'plan.create-course-with-first-meeting'
            )
        ),
        intent_schema_version INTEGER NOT NULL CHECK (intent_schema_version = 1),
        canonical_encoding TEXT NOT NULL CHECK (canonical_encoding = 'courseflow-canonical-json-v1'),
        digest_algorithm TEXT NOT NULL CHECK (digest_algorithm = 'sha256'),
        payload_digest BLOB NOT NULL CHECK (length(payload_digest) = 32),
        committed_revision INTEGER NOT NULL CHECK (committed_revision > 0),
        result_kind TEXT NOT NULL CHECK (result_kind = 'committed')
    ) STRICT;

    CREATE TABLE receipt_effects (
        command_id TEXT NOT NULL CHECK (${commandIdCheck}),
        effect_order INTEGER NOT NULL CHECK (effect_order >= 0),
        effect_code TEXT NOT NULL,
        entity_kind TEXT NOT NULL,
        entity_id TEXT NOT NULL CHECK (${effectEntityIdCheck}),
        entity_version INTEGER NOT NULL CHECK (entity_version >= 0),
        CHECK (
            (effect_code = 'workspace.setup-decision-recorded' AND entity_kind = 'workspace-setup')
            OR (effect_code = 'plan.term-created-current' AND entity_kind = 'term')
            OR (effect_code = 'plan.course-created' AND entity_kind = 'course')
            OR (effect_code = 'plan.meeting-series-created' AND entity_kind = 'meeting-series')
        ),
        PRIMARY KEY (command_id, effect_order),
        FOREIGN KEY (command_id) REFERENCES command_receipts(command_id) ON DELETE RESTRICT
    ) STRICT;
`;

export const LEVEL_3_PLAN_DDL = `
    CREATE TABLE courses (
        course_id TEXT PRIMARY KEY CHECK (${courseIdCheck}),
        term_id TEXT NOT NULL CHECK (${termIdCheck}),
        code TEXT NOT NULL CHECK (length(code) BETWEEN 1 AND 32 AND code = trim(code)),
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120 AND name = trim(name)),
        section TEXT CHECK (section IS NULL OR (length(section) BETWEEN 1 AND 64 AND section = trim(section))),
        instructor TEXT CHECK (
            instructor IS NULL
            OR (length(instructor) BETWEEN 1 AND 120 AND instructor = trim(instructor))
        ),
        color TEXT CHECK (
            color IS NULL
            OR color IN ('red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray')
        ),
        credits_coefficient INTEGER CHECK (credits_coefficient IS NULL OR credits_coefficient >= 0),
        credits_scale INTEGER CHECK (credits_scale IS NULL OR credits_scale BETWEEN 0 AND 6),
        teaching_range_kind TEXT NOT NULL CHECK (teaching_range_kind = 'inherit-term'),
        archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
        entity_version INTEGER NOT NULL CHECK (entity_version > 0),
        CHECK ((credits_coefficient IS NULL) = (credits_scale IS NULL)),
        FOREIGN KEY (term_id) REFERENCES terms(term_id) ON DELETE RESTRICT
    ) STRICT;

    CREATE INDEX courses_by_term ON courses(term_id);

    CREATE TABLE meeting_series (
        meeting_series_id TEXT PRIMARY KEY CHECK (${meetingSeriesIdCheck}),
        course_id TEXT NOT NULL CHECK (${courseIdCheck}),
        retired INTEGER NOT NULL CHECK (retired IN (0, 1)),
        entity_version INTEGER NOT NULL CHECK (entity_version > 0),
        FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE RESTRICT
    ) STRICT;

    CREATE INDEX meeting_series_by_course ON meeting_series(course_id);

    CREATE TABLE meeting_segments (
        meeting_segment_id TEXT PRIMARY KEY CHECK (${meetingSegmentIdCheck}),
        meeting_series_id TEXT NOT NULL CHECK (${meetingSeriesIdCheck}),
        meeting_type TEXT NOT NULL CHECK (meeting_type IN ('LEC', 'TUT', 'PRA')),
        weekday TEXT NOT NULL CHECK (weekday IN ('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN')),
        local_start TEXT NOT NULL CHECK (
            length(local_start) = 5
            AND substr(local_start, 3, 1) = ':'
            AND local_start NOT GLOB '*[^0-9:]*'
        ),
        local_end TEXT NOT NULL CHECK (
            length(local_end) = 5
            AND substr(local_end, 3, 1) = ':'
            AND local_end NOT GLOB '*[^0-9:]*'
            AND local_end > local_start
        ),
        effective_start_date TEXT NOT NULL CHECK (
            length(effective_start_date) = 10
            AND substr(effective_start_date, 5, 1) = '-'
            AND substr(effective_start_date, 8, 1) = '-'
            AND effective_start_date NOT GLOB '*[^0-9-]*'
        ),
        effective_end_date TEXT NOT NULL CHECK (
            length(effective_end_date) = 10
            AND substr(effective_end_date, 5, 1) = '-'
            AND substr(effective_end_date, 8, 1) = '-'
            AND effective_end_date NOT GLOB '*[^0-9-]*'
            AND effective_end_date >= effective_start_date
        ),
        location_kind TEXT NOT NULL CHECK (location_kind IN ('known', 'tba')),
        location_value TEXT CHECK (
            (location_kind = 'tba' AND location_value IS NULL)
            OR (
                location_kind = 'known'
                AND length(location_value) BETWEEN 1 AND 240
                AND location_value = trim(location_value)
            )
        ),
        FOREIGN KEY (meeting_series_id)
            REFERENCES meeting_series(meeting_series_id) ON DELETE RESTRICT
    ) STRICT;

    CREATE INDEX meeting_segments_by_series ON meeting_segments(meeting_series_id);
`;

export const LEVEL_3_DDL = LEVEL_2_DDL.replace(LEVEL_2_RECEIPT_DDL, LEVEL_3_RECEIPT_DDL)
    + LEVEL_3_PLAN_DDL;

export const LEVEL_3_TABLE_COLUMNS: Partial<Record<keyof typeof TABLE_COLUMNS, readonly unknown[]>> = {
    courses: [
        ['course_id', 'TEXT', 1, 1],
        ['term_id', 'TEXT', 1, 0],
        ['code', 'TEXT', 1, 0],
        ['name', 'TEXT', 1, 0],
        ['section', 'TEXT', 0, 0],
        ['instructor', 'TEXT', 0, 0],
        ['color', 'TEXT', 0, 0],
        ['credits_coefficient', 'INTEGER', 0, 0],
        ['credits_scale', 'INTEGER', 0, 0],
        ['teaching_range_kind', 'TEXT', 1, 0],
        ['archived', 'INTEGER', 1, 0],
        ['entity_version', 'INTEGER', 1, 0],
    ],
    meeting_segments: [
        ['meeting_segment_id', 'TEXT', 1, 1],
        ['meeting_series_id', 'TEXT', 1, 0],
        ['meeting_type', 'TEXT', 1, 0],
        ['weekday', 'TEXT', 1, 0],
        ['local_start', 'TEXT', 1, 0],
        ['local_end', 'TEXT', 1, 0],
        ['effective_start_date', 'TEXT', 1, 0],
        ['effective_end_date', 'TEXT', 1, 0],
        ['location_kind', 'TEXT', 1, 0],
        ['location_value', 'TEXT', 0, 0],
    ],
};

export const LEVEL_3_AND_4_TABLES = [
    ...LEVEL_2_TABLES,
    'courses',
    'meeting_series',
    'meeting_segments',
] as const;
