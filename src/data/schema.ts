/**
 * @file Owns CourseFlow SQLite schema creation, migration, and validation.
 */

import { DatabaseSync } from 'node:sqlite';

import { isCanonicalUuid } from '../shared/workspace-data-contract';

export const COURSEFLOW_APPLICATION_ID = 0x43464C57;
export const CURRENT_SCHEMA_LEVEL = 4;

const UUID_CHECK = `
    length(%COLUMN%) = 36
    AND %COLUMN% = lower(%COLUMN%)
    AND substr(%COLUMN%, 9, 1) = '-'
    AND substr(%COLUMN%, 14, 1) = '-'
    AND substr(%COLUMN%, 19, 1) = '-'
    AND substr(%COLUMN%, 24, 1) = '-'
    AND %COLUMN% NOT GLOB '*[^0-9a-f-]*'
`;

const workspaceIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'workspace_id');
const commandIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'command_id');
const effectEntityIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'entity_id');
const followUpIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'follow_up_id');
const originatingCommandIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'originating_command_id');
const termIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'term_id');
const currentTermIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'current_term_id');
const courseIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'course_id');
const meetingSeriesIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'meeting_series_id');
const meetingSegmentIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'meeting_segment_id');

const LEVEL_1_DDL = `
    CREATE TABLE workspace_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        workspace_id TEXT NOT NULL CHECK (${workspaceIdCheck}),
        revision INTEGER NOT NULL CHECK (revision >= 0)
    ) STRICT;

    CREATE TABLE setup_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        last_decision TEXT CHECK (last_decision IS NULL OR last_decision IN ('later', 'skip')),
        setup_decision_version INTEGER NOT NULL CHECK (setup_decision_version >= 0),
        ever_reached_minimum INTEGER NOT NULL CHECK (ever_reached_minimum IN (0, 1)),
        FOREIGN KEY (singleton) REFERENCES workspace_state(singleton) ON DELETE RESTRICT
    ) STRICT;

    CREATE TABLE command_receipts (
        command_id TEXT PRIMARY KEY CHECK (${commandIdCheck}),
        intent_kind TEXT NOT NULL CHECK (intent_kind = 'workspace.record-setup-decision'),
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
        effect_code TEXT NOT NULL CHECK (effect_code = 'workspace.setup-decision-recorded'),
        entity_kind TEXT NOT NULL CHECK (entity_kind = 'workspace-setup'),
        entity_id TEXT NOT NULL CHECK (${effectEntityIdCheck}),
        entity_version INTEGER NOT NULL CHECK (entity_version >= 0),
        PRIMARY KEY (command_id, effect_order),
        FOREIGN KEY (command_id) REFERENCES command_receipts(command_id) ON DELETE RESTRICT
    ) STRICT;

    CREATE TABLE durable_followups (
        follow_up_id TEXT PRIMARY KEY CHECK (${followUpIdCheck}),
        originating_command_id TEXT NOT NULL CHECK (${originatingCommandIdCheck}),
        owner TEXT NOT NULL CHECK (owner = 'protect'),
        kind TEXT NOT NULL CHECK (kind = 'backup-needed-through'),
        prerequisite_revision INTEGER NOT NULL CHECK (prerequisite_revision > 0),
        state TEXT NOT NULL CHECK (state = 'pending'),
        follow_up_version INTEGER NOT NULL CHECK (follow_up_version = 0),
        FOREIGN KEY (originating_command_id) REFERENCES command_receipts(command_id) ON DELETE RESTRICT
    ) STRICT;

    CREATE INDEX durable_followups_by_command
        ON durable_followups(originating_command_id);

    CREATE TABLE protection_watermarks (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        backup_needed_through INTEGER NOT NULL CHECK (backup_needed_through >= 0),
        backup_succeeded_through INTEGER NOT NULL CHECK (
            backup_succeeded_through >= 0
            AND backup_succeeded_through <= backup_needed_through
        ),
        FOREIGN KEY (singleton) REFERENCES workspace_state(singleton) ON DELETE RESTRICT
    ) STRICT;
`;

const LEVEL_2_RECEIPT_DDL = `
    CREATE TABLE command_receipts (
        command_id TEXT PRIMARY KEY CHECK (${commandIdCheck}),
        intent_kind TEXT NOT NULL CHECK (
            intent_kind IN ('workspace.record-setup-decision', 'plan.create-term')
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
        effect_code TEXT NOT NULL CHECK (
            effect_code IN ('workspace.setup-decision-recorded', 'plan.term-created-current')
        ),
        entity_kind TEXT NOT NULL CHECK (entity_kind IN ('workspace-setup', 'term')),
        entity_id TEXT NOT NULL CHECK (${effectEntityIdCheck}),
        entity_version INTEGER NOT NULL CHECK (entity_version >= 0),
        PRIMARY KEY (command_id, effect_order),
        FOREIGN KEY (command_id) REFERENCES command_receipts(command_id) ON DELETE RESTRICT
    ) STRICT;
`;

const LEVEL_2_PLAN_DDL = `
    CREATE TABLE terms (
        term_id TEXT PRIMARY KEY CHECK (${termIdCheck}),
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120 AND name = trim(name)),
        start_date TEXT NOT NULL CHECK (
            length(start_date) = 10
            AND substr(start_date, 5, 1) = '-'
            AND substr(start_date, 8, 1) = '-'
            AND start_date NOT GLOB '*[^0-9-]*'
        ),
        end_date TEXT NOT NULL CHECK (
            length(end_date) = 10
            AND substr(end_date, 5, 1) = '-'
            AND substr(end_date, 8, 1) = '-'
            AND end_date NOT GLOB '*[^0-9-]*'
            AND end_date >= start_date
        ),
        time_zone TEXT NOT NULL CHECK (length(time_zone) BETWEEN 1 AND 255),
        archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
        entity_version INTEGER NOT NULL CHECK (entity_version > 0)
    ) STRICT;

    CREATE TABLE plan_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        current_term_id TEXT CHECK (current_term_id IS NULL OR (${currentTermIdCheck})),
        plan_entity_version INTEGER NOT NULL CHECK (plan_entity_version >= 0),
        FOREIGN KEY (singleton) REFERENCES workspace_state(singleton) ON DELETE RESTRICT,
        FOREIGN KEY (current_term_id) REFERENCES terms(term_id) ON DELETE RESTRICT
    ) STRICT;
`;

const LEVEL_2_DDL = LEVEL_1_DDL
    .replace(
        LEVEL_1_DDL.slice(
            LEVEL_1_DDL.indexOf('    CREATE TABLE command_receipts'),
            LEVEL_1_DDL.indexOf('    CREATE TABLE durable_followups'),
        ),
        LEVEL_2_RECEIPT_DDL,
    )
    + LEVEL_2_PLAN_DDL;

const LEVEL_3_RECEIPT_DDL = `
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

const LEVEL_3_PLAN_DDL = `
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

const LEVEL_3_DDL = LEVEL_2_DDL.replace(LEVEL_2_RECEIPT_DDL, LEVEL_3_RECEIPT_DDL)
    + LEVEL_3_PLAN_DDL;

const LEVEL_4_RECEIPT_DDL = `
    CREATE TABLE command_receipts (
        command_id TEXT PRIMARY KEY CHECK (${commandIdCheck}),
        intent_kind TEXT NOT NULL CHECK (
            intent_kind IN (
                'workspace.record-setup-decision',
                'workspace.reconcile-lifecycle',
                'plan.create-term',
                'plan.create-course-with-first-meeting',
                'plan.update-term-end-date',
                'plan.restore-term-as-current'
            )
        ),
        intent_schema_version INTEGER NOT NULL CHECK (
            intent_schema_version = 1
            OR (intent_kind = 'plan.create-course-with-first-meeting' AND intent_schema_version = 2)
        ),
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
            OR (effect_code = 'plan.term-auto-archived' AND entity_kind = 'term')
            OR (effect_code = 'plan.term-end-date-updated' AND entity_kind = 'term')
            OR (effect_code = 'plan.term-restored-current' AND entity_kind = 'term')
            OR (effect_code = 'plan.course-created' AND entity_kind = 'course')
            OR (effect_code = 'plan.meeting-series-created' AND entity_kind = 'meeting-series')
        ),
        PRIMARY KEY (command_id, effect_order),
        FOREIGN KEY (command_id) REFERENCES command_receipts(command_id) ON DELETE RESTRICT
    ) STRICT;
`;

const LEVEL_4_PLAN_DDL = `
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
        teaching_range_kind TEXT NOT NULL CHECK (teaching_range_kind IN ('inherit-term', 'explicit')),
        teaching_start_date TEXT CHECK (
            teaching_start_date IS NULL
            OR (
                length(teaching_start_date) = 10
                AND substr(teaching_start_date, 5, 1) = '-'
                AND substr(teaching_start_date, 8, 1) = '-'
                AND teaching_start_date NOT GLOB '*[^0-9-]*'
            )
        ),
        teaching_end_date TEXT CHECK (
            teaching_end_date IS NULL
            OR (
                length(teaching_end_date) = 10
                AND substr(teaching_end_date, 5, 1) = '-'
                AND substr(teaching_end_date, 8, 1) = '-'
                AND teaching_end_date NOT GLOB '*[^0-9-]*'
            )
        ),
        archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
        entity_version INTEGER NOT NULL CHECK (entity_version > 0),
        CHECK ((credits_coefficient IS NULL) = (credits_scale IS NULL)),
        CHECK (
            (
                teaching_range_kind = 'inherit-term'
                AND teaching_start_date IS NULL
                AND teaching_end_date IS NULL
            )
            OR (
                teaching_range_kind = 'explicit'
                AND teaching_start_date IS NOT NULL
                AND teaching_end_date IS NOT NULL
                AND teaching_end_date >= teaching_start_date
            )
        ),
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
        effective_range_kind TEXT NOT NULL CHECK (effective_range_kind IN ('inherit-course', 'explicit')),
        effective_start_date TEXT CHECK (
            effective_start_date IS NULL
            OR (
                length(effective_start_date) = 10
                AND substr(effective_start_date, 5, 1) = '-'
                AND substr(effective_start_date, 8, 1) = '-'
                AND effective_start_date NOT GLOB '*[^0-9-]*'
            )
        ),
        effective_end_date TEXT CHECK (
            effective_end_date IS NULL
            OR (
                length(effective_end_date) = 10
                AND substr(effective_end_date, 5, 1) = '-'
                AND substr(effective_end_date, 8, 1) = '-'
                AND effective_end_date NOT GLOB '*[^0-9-]*'
            )
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
        CHECK (
            (
                effective_range_kind = 'inherit-course'
                AND effective_start_date IS NULL
                AND effective_end_date IS NULL
            )
            OR (
                effective_range_kind = 'explicit'
                AND effective_start_date IS NOT NULL
                AND effective_end_date IS NOT NULL
                AND effective_end_date >= effective_start_date
            )
        ),
        FOREIGN KEY (meeting_series_id)
            REFERENCES meeting_series(meeting_series_id) ON DELETE RESTRICT
    ) STRICT;

    CREATE INDEX meeting_segments_by_series ON meeting_segments(meeting_series_id);
`;

const LEVEL_4_DDL = LEVEL_3_DDL
    .replace(LEVEL_3_RECEIPT_DDL, LEVEL_4_RECEIPT_DDL)
    .replace(LEVEL_3_PLAN_DDL, LEVEL_4_PLAN_DDL);

const TABLE_COLUMNS = {
    workspace_state: [
        ['singleton', 'INTEGER', 0, 1],
        ['workspace_id', 'TEXT', 1, 0],
        ['revision', 'INTEGER', 1, 0],
    ],
    setup_state: [
        ['singleton', 'INTEGER', 0, 1],
        ['last_decision', 'TEXT', 0, 0],
        ['setup_decision_version', 'INTEGER', 1, 0],
        ['ever_reached_minimum', 'INTEGER', 1, 0],
    ],
    command_receipts: [
        ['command_id', 'TEXT', 1, 1],
        ['intent_kind', 'TEXT', 1, 0],
        ['intent_schema_version', 'INTEGER', 1, 0],
        ['canonical_encoding', 'TEXT', 1, 0],
        ['digest_algorithm', 'TEXT', 1, 0],
        ['payload_digest', 'BLOB', 1, 0],
        ['committed_revision', 'INTEGER', 1, 0],
        ['result_kind', 'TEXT', 1, 0],
    ],
    receipt_effects: [
        ['command_id', 'TEXT', 1, 1],
        ['effect_order', 'INTEGER', 1, 2],
        ['effect_code', 'TEXT', 1, 0],
        ['entity_kind', 'TEXT', 1, 0],
        ['entity_id', 'TEXT', 1, 0],
        ['entity_version', 'INTEGER', 1, 0],
    ],
    durable_followups: [
        ['follow_up_id', 'TEXT', 1, 1],
        ['originating_command_id', 'TEXT', 1, 0],
        ['owner', 'TEXT', 1, 0],
        ['kind', 'TEXT', 1, 0],
        ['prerequisite_revision', 'INTEGER', 1, 0],
        ['state', 'TEXT', 1, 0],
        ['follow_up_version', 'INTEGER', 1, 0],
    ],
    protection_watermarks: [
        ['singleton', 'INTEGER', 0, 1],
        ['backup_needed_through', 'INTEGER', 1, 0],
        ['backup_succeeded_through', 'INTEGER', 1, 0],
    ],
    terms: [
        ['term_id', 'TEXT', 1, 1],
        ['name', 'TEXT', 1, 0],
        ['start_date', 'TEXT', 1, 0],
        ['end_date', 'TEXT', 1, 0],
        ['time_zone', 'TEXT', 1, 0],
        ['archived', 'INTEGER', 1, 0],
        ['entity_version', 'INTEGER', 1, 0],
    ],
    plan_state: [
        ['singleton', 'INTEGER', 0, 1],
        ['current_term_id', 'TEXT', 0, 0],
        ['plan_entity_version', 'INTEGER', 1, 0],
    ],
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
        ['teaching_start_date', 'TEXT', 0, 0],
        ['teaching_end_date', 'TEXT', 0, 0],
        ['archived', 'INTEGER', 1, 0],
        ['entity_version', 'INTEGER', 1, 0],
    ],
    meeting_series: [
        ['meeting_series_id', 'TEXT', 1, 1],
        ['course_id', 'TEXT', 1, 0],
        ['retired', 'INTEGER', 1, 0],
        ['entity_version', 'INTEGER', 1, 0],
    ],
    meeting_segments: [
        ['meeting_segment_id', 'TEXT', 1, 1],
        ['meeting_series_id', 'TEXT', 1, 0],
        ['meeting_type', 'TEXT', 1, 0],
        ['weekday', 'TEXT', 1, 0],
        ['local_start', 'TEXT', 1, 0],
        ['local_end', 'TEXT', 1, 0],
        ['effective_range_kind', 'TEXT', 1, 0],
        ['effective_start_date', 'TEXT', 0, 0],
        ['effective_end_date', 'TEXT', 0, 0],
        ['location_kind', 'TEXT', 1, 0],
        ['location_value', 'TEXT', 0, 0],
    ],
} as const;

const LEVEL_3_TABLE_COLUMNS: Partial<Record<keyof typeof TABLE_COLUMNS, readonly unknown[]>> = {
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

const FOREIGN_KEYS = {
    workspace_state: [],
    setup_state: [['singleton', 'workspace_state', 'singleton']],
    command_receipts: [],
    receipt_effects: [['command_id', 'command_receipts', 'command_id']],
    durable_followups: [['originating_command_id', 'command_receipts', 'command_id']],
    protection_watermarks: [['singleton', 'workspace_state', 'singleton']],
    terms: [],
    plan_state: [
        ['current_term_id', 'terms', 'term_id'],
        ['singleton', 'workspace_state', 'singleton'],
    ],
    courses: [['term_id', 'terms', 'term_id']],
    meeting_series: [['course_id', 'courses', 'course_id']],
    meeting_segments: [['meeting_series_id', 'meeting_series', 'meeting_series_id']],
} as const;

const LEVEL_1_TABLES = [
    'workspace_state',
    'setup_state',
    'command_receipts',
    'receipt_effects',
    'durable_followups',
    'protection_watermarks',
] as const;

const LEVEL_2_TABLES = [
    ...LEVEL_1_TABLES,
    'terms',
    'plan_state',
] as const;

type CurrentTable = keyof typeof TABLE_COLUMNS;

export type SchemaFacts = Readonly<{
    workspaceId: string;
    revision: bigint;
}>;

export type SchemaValidationFailureReason = 'schema-mismatch' | 'database-corrupt';

export class SchemaValidationError extends Error {
    public constructor(public readonly reason: SchemaValidationFailureReason) {
        super('Workspace schema validation failed');
        this.name = 'SchemaValidationError';
    }
}

function rejectSchema(reason: SchemaValidationFailureReason = 'schema-mismatch'): never {
    throw new SchemaValidationError(reason);
}

function tableNames(level: 1 | 2 | 3 | 4): readonly CurrentTable[] {
    if (level === 1) {
        return LEVEL_1_TABLES;
    }
    if (level === 2) {
        return LEVEL_2_TABLES;
    }
    return Object.keys(TABLE_COLUMNS) as CurrentTable[];
}

function pragmaValue(database: DatabaseSync, pragma: string, field: string): unknown {
    const row = database.prepare(`PRAGMA ${pragma}`).get() as Record<string, unknown> | undefined;
    return row?.[field];
}

function equalRows(actual: readonly unknown[], expected: readonly unknown[]): boolean {
    return JSON.stringify(actual) === JSON.stringify(expected);
}

function normalizeTableSql(sql: string): string {
    return sql
        .replaceAll(/\s+/g, ' ')
        .replaceAll(/\s*([(),=<>])\s*/g, '$1')
        .trim()
        .toLowerCase();
}

function expectedTableSql(table: CurrentTable, level: 1 | 2 | 3 | 4): string {
    const ddl = level === 1
        ? LEVEL_1_DDL
        : level === 2
            ? LEVEL_2_DDL
            : level === 3
                ? LEVEL_3_DDL
                : LEVEL_4_DDL;
    const statement = ddl
        .split(';')
        .find((candidate) => candidate.includes(`CREATE TABLE ${table} `));
    if (!statement) {
        rejectSchema();
    }
    return normalizeTableSql(statement);
}

function validateTables(database: DatabaseSync, level: 1 | 2 | 3 | 4): void {
    const expectedNames = Array.from(tableNames(level)).sort();
    const rows = database.prepare('PRAGMA table_list').all() as Array<{
        name: string;
        type: string;
        strict: number;
    }>;
    const actualNames = rows
        .filter((row) => row.type === 'table' && !row.name.startsWith('sqlite_'))
        .map((row) => row.name)
        .sort();
    if (!equalRows(actualNames, expectedNames)
        || !rows.filter((row) => actualNames.includes(row.name)).every((row) => row.strict === 1)) {
        rejectSchema();
    }

    const definitions = database.prepare(
        "SELECT name, sql FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all() as Array<{ name: CurrentTable; sql: string | null }>;
    if (definitions.length !== expectedNames.length
        || definitions.some((definition) => definition.sql === null
            || normalizeTableSql(definition.sql) !== expectedTableSql(definition.name, level))) {
        rejectSchema();
    }
}

function validateColumnsAndForeignKeys(
    database: DatabaseSync,
    table: CurrentTable,
    level: 1 | 2 | 3 | 4,
): void {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
        name: string;
        type: string;
        notnull: number;
        pk: number;
    }>;
    const actualColumns = columns.map((column) => [
        column.name,
        column.type,
        column.notnull,
        column.pk,
    ]);
    const expectedColumns = level === 3 && LEVEL_3_TABLE_COLUMNS[table]
        ? LEVEL_3_TABLE_COLUMNS[table]
        : TABLE_COLUMNS[table];
    if (!equalRows(actualColumns, expectedColumns)) {
        rejectSchema();
    }

    const foreignKeys = database.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{
        from: string;
        table: string;
        to: string;
        on_delete: string;
        on_update: string;
        match: string;
    }>;
    const actualForeignKeys = foreignKeys.map((foreignKey) => [
        foreignKey.from,
        foreignKey.table,
        foreignKey.to,
    ]);
    if (!equalRows(actualForeignKeys, FOREIGN_KEYS[table])
        || !foreignKeys.every((foreignKey) => foreignKey.on_delete === 'RESTRICT'
            && foreignKey.on_update === 'NO ACTION'
            && foreignKey.match === 'NONE')) {
        rejectSchema();
    }
}

function validateIndexes(database: DatabaseSync, table: CurrentTable): void {
    const indexRows = database.prepare(`PRAGMA index_list(${table})`).all() as Array<{
        name: string;
        unique: number;
        origin: string;
        partial: number;
    }>;
    const customIndexes = indexRows.filter((index) => index.origin === 'c').map((index) => [
        index.name,
        index.unique,
        index.origin,
        index.partial,
    ]);
    const indexByTable: Partial<Record<CurrentTable, readonly [string, string]>> = {
        durable_followups: ['durable_followups_by_command', 'originating_command_id'],
        courses: ['courses_by_term', 'term_id'],
        meeting_series: ['meeting_series_by_course', 'course_id'],
        meeting_segments: ['meeting_segments_by_series', 'meeting_series_id'],
    };
    const expectedIndex = indexByTable[table];
    const expectedIndexes = expectedIndex ? [[expectedIndex[0], 0, 'c', 0]] : [];
    if (!equalRows(customIndexes, expectedIndexes)) {
        rejectSchema();
    }

    if (expectedIndex) {
        const indexColumns = database.prepare(`PRAGMA index_xinfo(${expectedIndex[0]})`).all() as Array<{
            seqno: number;
            cid: number;
            name: string | null;
            desc: number;
            coll: string;
            key: number;
        }>;
        const keyColumns = indexColumns
            .filter((column) => column.key === 1)
            .map((column) => [
                column.seqno,
                column.cid,
                column.name,
                column.desc,
                column.coll,
                column.key,
            ]);
        if (!equalRows(keyColumns, [[0, 1, expectedIndex[1], 0, 'BINARY', 1]])) {
            rejectSchema();
        }
    }
}

function validateBootstrapFacts(database: DatabaseSync, level: 1 | 2 | 3 | 4): SchemaFacts {
    const workspace = database.prepare(
        'SELECT workspace_id, revision FROM workspace_state WHERE singleton = 1',
    );
    workspace.setReadBigInts(true);
    const workspaceRow = workspace.get() as { workspace_id: string; revision: bigint } | undefined;
    const setup = database.prepare(
        'SELECT last_decision, setup_decision_version, ever_reached_minimum FROM setup_state WHERE singleton = 1',
    );
    setup.setReadBigInts(true);
    const setupRow = setup.get() as {
        last_decision: 'later' | 'skip' | null;
        setup_decision_version: bigint;
        ever_reached_minimum: bigint;
    } | undefined;
    const watermarks = database.prepare(
        'SELECT backup_needed_through, backup_succeeded_through FROM protection_watermarks WHERE singleton = 1',
    );
    watermarks.setReadBigInts(true);
    const watermarkRow = watermarks.get() as {
        backup_needed_through: bigint;
        backup_succeeded_through: bigint;
    } | undefined;
    const singletonCounts = database.prepare(`
        SELECT
            (SELECT count(*) FROM workspace_state) AS workspace_count,
            (SELECT count(*) FROM setup_state) AS setup_count,
            (SELECT count(*) FROM protection_watermarks) AS watermark_count
    `);
    singletonCounts.setReadBigInts(true);
    const counts = singletonCounts.get() as {
        workspace_count: bigint;
        setup_count: bigint;
        watermark_count: bigint;
    } | undefined;

    if (!workspaceRow
        || !setupRow
        || !watermarkRow
        || !counts
        || counts.workspace_count !== 1n
        || counts.setup_count !== 1n
        || counts.watermark_count !== 1n
        || !isCanonicalUuid(workspaceRow.workspace_id)
        || workspaceRow.revision < 0n
        || (setupRow.last_decision !== null
            && setupRow.last_decision !== 'later'
            && setupRow.last_decision !== 'skip')
        || setupRow.setup_decision_version < 0n
        || (setupRow.ever_reached_minimum !== 0n && setupRow.ever_reached_minimum !== 1n)
        || watermarkRow.backup_needed_through < 0n
        || watermarkRow.backup_succeeded_through < 0n
        || watermarkRow.backup_succeeded_through > watermarkRow.backup_needed_through
        || watermarkRow.backup_needed_through > workspaceRow.revision) {
        rejectSchema();
    }

    if (level >= 2) {
        const plan = database.prepare(
            'SELECT current_term_id, plan_entity_version FROM plan_state WHERE singleton = 1',
        );
        plan.setReadBigInts(true);
        const planRow = plan.get() as {
            current_term_id: string | null;
            plan_entity_version: bigint;
        } | undefined;
        const count = database.prepare('SELECT count(*) AS count FROM plan_state');
        count.setReadBigInts(true);
        if (!planRow
            || (count.get() as { count: bigint }).count !== 1n
            || planRow.plan_entity_version < 0n
            || (planRow.current_term_id !== null && !isCanonicalUuid(planRow.current_term_id))) {
            rejectSchema();
        }
    }

    return {
        workspaceId: workspaceRow.workspace_id,
        revision: workspaceRow.revision,
    };
}

function validateSchema(database: DatabaseSync, level: 1 | 2 | 3 | 4): SchemaFacts {
    if (pragmaValue(database, 'application_id', 'application_id') !== COURSEFLOW_APPLICATION_ID
        || pragmaValue(database, 'user_version', 'user_version') !== level) {
        rejectSchema();
    }

    validateTables(database, level);
    for (const table of tableNames(level)) {
        validateColumnsAndForeignKeys(database, table, level);
        validateIndexes(database, table);
    }

    const forbiddenSchemaObjects = database.prepare(
        "SELECT count(*) AS count FROM sqlite_schema WHERE type IN ('trigger', 'view')",
    ).get() as { count: number };
    if (forbiddenSchemaObjects.count !== 0) {
        rejectSchema();
    }
    if (pragmaValue(database, 'integrity_check', 'integrity_check') !== 'ok'
        || (database.prepare('PRAGMA foreign_key_check').all() as unknown[]).length !== 0) {
        rejectSchema('database-corrupt');
    }

    return validateBootstrapFacts(database, level);
}

export function migrateLevel0To1(database: DatabaseSync): void {
    database.exec(LEVEL_1_DDL);
}

export function migrateLevel1To2(database: DatabaseSync): void {
    database.exec(`
        ALTER TABLE command_receipts RENAME TO command_receipts_level_1;
        ALTER TABLE receipt_effects RENAME TO receipt_effects_level_1;
        ALTER TABLE durable_followups RENAME TO durable_followups_level_1;
        DROP INDEX durable_followups_by_command;

        ${LEVEL_2_RECEIPT_DDL}

        CREATE TABLE durable_followups (
            follow_up_id TEXT PRIMARY KEY CHECK (${followUpIdCheck}),
            originating_command_id TEXT NOT NULL CHECK (${originatingCommandIdCheck}),
            owner TEXT NOT NULL CHECK (owner = 'protect'),
            kind TEXT NOT NULL CHECK (kind = 'backup-needed-through'),
            prerequisite_revision INTEGER NOT NULL CHECK (prerequisite_revision > 0),
            state TEXT NOT NULL CHECK (state = 'pending'),
            follow_up_version INTEGER NOT NULL CHECK (follow_up_version = 0),
            FOREIGN KEY (originating_command_id) REFERENCES command_receipts(command_id) ON DELETE RESTRICT
        ) STRICT;
        CREATE INDEX durable_followups_by_command
            ON durable_followups(originating_command_id);

        INSERT INTO command_receipts SELECT * FROM command_receipts_level_1;
        INSERT INTO receipt_effects SELECT * FROM receipt_effects_level_1;
        INSERT INTO durable_followups SELECT * FROM durable_followups_level_1;

        DROP TABLE receipt_effects_level_1;
        DROP TABLE durable_followups_level_1;
        DROP TABLE command_receipts_level_1;

        ${LEVEL_2_PLAN_DDL}
        INSERT INTO plan_state (singleton, current_term_id, plan_entity_version)
            VALUES (1, NULL, 0);
        UPDATE workspace_state SET revision = revision + 1 WHERE singleton = 1;
        UPDATE protection_watermarks
            SET backup_needed_through = (
                SELECT revision FROM workspace_state WHERE singleton = 1
            )
            WHERE singleton = 1;
        PRAGMA user_version = 2;
    `);
}

export function migrateLevel2To3(database: DatabaseSync): void {
    database.exec(`
        ALTER TABLE command_receipts RENAME TO command_receipts_level_2;
        ALTER TABLE receipt_effects RENAME TO receipt_effects_level_2;
        ALTER TABLE durable_followups RENAME TO durable_followups_level_2;
        DROP INDEX durable_followups_by_command;

        ${LEVEL_3_RECEIPT_DDL}

        CREATE TABLE durable_followups (
            follow_up_id TEXT PRIMARY KEY CHECK (${followUpIdCheck}),
            originating_command_id TEXT NOT NULL CHECK (${originatingCommandIdCheck}),
            owner TEXT NOT NULL CHECK (owner = 'protect'),
            kind TEXT NOT NULL CHECK (kind = 'backup-needed-through'),
            prerequisite_revision INTEGER NOT NULL CHECK (prerequisite_revision > 0),
            state TEXT NOT NULL CHECK (state = 'pending'),
            follow_up_version INTEGER NOT NULL CHECK (follow_up_version = 0),
            FOREIGN KEY (originating_command_id) REFERENCES command_receipts(command_id) ON DELETE RESTRICT
        ) STRICT;
        CREATE INDEX durable_followups_by_command
            ON durable_followups(originating_command_id);

        INSERT INTO command_receipts SELECT * FROM command_receipts_level_2;
        INSERT INTO receipt_effects SELECT * FROM receipt_effects_level_2;
        INSERT INTO durable_followups SELECT * FROM durable_followups_level_2;

        DROP TABLE receipt_effects_level_2;
        DROP TABLE durable_followups_level_2;
        DROP TABLE command_receipts_level_2;

        ${LEVEL_3_PLAN_DDL}
        UPDATE workspace_state SET revision = revision + 1 WHERE singleton = 1;
        UPDATE protection_watermarks
            SET backup_needed_through = (
                SELECT revision FROM workspace_state WHERE singleton = 1
            )
            WHERE singleton = 1;
        PRAGMA user_version = 3;
    `);
}

export function migrateLevel3To4(database: DatabaseSync): void {
    database.exec(`
        ALTER TABLE command_receipts RENAME TO command_receipts_level_3;
        ALTER TABLE receipt_effects RENAME TO receipt_effects_level_3;
        ALTER TABLE durable_followups RENAME TO durable_followups_level_3;
        DROP INDEX durable_followups_by_command;

        ${LEVEL_4_RECEIPT_DDL}

        CREATE TABLE durable_followups (
            follow_up_id TEXT PRIMARY KEY CHECK (${followUpIdCheck}),
            originating_command_id TEXT NOT NULL CHECK (${originatingCommandIdCheck}),
            owner TEXT NOT NULL CHECK (owner = 'protect'),
            kind TEXT NOT NULL CHECK (kind = 'backup-needed-through'),
            prerequisite_revision INTEGER NOT NULL CHECK (prerequisite_revision > 0),
            state TEXT NOT NULL CHECK (state = 'pending'),
            follow_up_version INTEGER NOT NULL CHECK (follow_up_version = 0),
            FOREIGN KEY (originating_command_id) REFERENCES command_receipts(command_id) ON DELETE RESTRICT
        ) STRICT;
        CREATE INDEX durable_followups_by_command
            ON durable_followups(originating_command_id);

        INSERT INTO command_receipts SELECT * FROM command_receipts_level_3;
        INSERT INTO receipt_effects SELECT * FROM receipt_effects_level_3;
        INSERT INTO durable_followups SELECT * FROM durable_followups_level_3;

        DROP TABLE receipt_effects_level_3;
        DROP TABLE durable_followups_level_3;
        DROP TABLE command_receipts_level_3;

        ALTER TABLE meeting_segments RENAME TO meeting_segments_level_3;
        ALTER TABLE meeting_series RENAME TO meeting_series_level_3;
        ALTER TABLE courses RENAME TO courses_level_3;
        DROP INDEX meeting_segments_by_series;
        DROP INDEX meeting_series_by_course;
        DROP INDEX courses_by_term;

        ${LEVEL_4_PLAN_DDL}

        INSERT INTO courses (
            course_id,
            term_id,
            code,
            name,
            section,
            instructor,
            color,
            credits_coefficient,
            credits_scale,
            teaching_range_kind,
            teaching_start_date,
            teaching_end_date,
            archived,
            entity_version
        )
        SELECT
            course_id,
            term_id,
            code,
            name,
            section,
            instructor,
            color,
            credits_coefficient,
            credits_scale,
            'inherit-term',
            NULL,
            NULL,
            archived,
            entity_version
        FROM courses_level_3;

        INSERT INTO meeting_series SELECT * FROM meeting_series_level_3;

        INSERT INTO meeting_segments (
            meeting_segment_id,
            meeting_series_id,
            meeting_type,
            weekday,
            local_start,
            local_end,
            effective_range_kind,
            effective_start_date,
            effective_end_date,
            location_kind,
            location_value
        )
        SELECT
            meeting_segment_id,
            meeting_series_id,
            meeting_type,
            weekday,
            local_start,
            local_end,
            'explicit',
            effective_start_date,
            effective_end_date,
            location_kind,
            location_value
        FROM meeting_segments_level_3;

        DROP TABLE meeting_segments_level_3;
        DROP TABLE meeting_series_level_3;
        DROP TABLE courses_level_3;

        UPDATE workspace_state SET revision = revision + 1 WHERE singleton = 1;
        UPDATE protection_watermarks
            SET backup_needed_through = (
                SELECT revision FROM workspace_state WHERE singleton = 1
            )
            WHERE singleton = 1;
        PRAGMA user_version = 4;
    `);
}

export function createSchemaLevel2(database: DatabaseSync): void {
    database.exec(LEVEL_2_DDL);
}

export function createSchemaLevel3(database: DatabaseSync): void {
    database.exec(LEVEL_3_DDL);
}

export function createSchemaLevel4(database: DatabaseSync): void {
    database.exec(LEVEL_4_DDL);
}

export function validateSchemaLevel1(database: DatabaseSync): SchemaFacts {
    return validateSchema(database, 1);
}

export function validateSchemaLevel2(database: DatabaseSync): SchemaFacts {
    return validateSchema(database, 2);
}

export function validateSchemaLevel3(database: DatabaseSync): SchemaFacts {
    return validateSchema(database, 3);
}

export function validateSchemaLevel4(database: DatabaseSync): SchemaFacts {
    return validateSchema(database, 4);
}
