import { commandIdCheck, effectEntityIdCheck, meetingSeriesIdCheck } from '../base';
import { LEVEL_3_AND_4_TABLES } from './level-03';
import { LEVEL_4_DDL, LEVEL_4_PLAN_DDL, LEVEL_4_RECEIPT_DDL } from './level-04';
import { TABLE_COLUMNS } from '../tables';
export const LEVEL_5_RECEIPT_DDL = `
    CREATE TABLE command_receipts (
        command_id TEXT PRIMARY KEY CHECK (${commandIdCheck}),
        intent_kind TEXT NOT NULL CHECK (
            intent_kind IN (
                'workspace.record-setup-decision',
                'workspace.reconcile-lifecycle',
                'plan.create-term',
                'plan.create-course-with-first-meeting',
                'plan.update-term-end-date',
                'plan.restore-term-as-current',
                'plan.change-meeting-occurrence',
                'plan.cancel-meeting-occurrence'
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
            OR (effect_code = 'plan.meeting-occurrence-changed' AND entity_kind = 'meeting-series')
            OR (effect_code = 'plan.meeting-occurrence-cancelled' AND entity_kind = 'meeting-series')
        ),
        PRIMARY KEY (command_id, effect_order),
        FOREIGN KEY (command_id) REFERENCES command_receipts(command_id) ON DELETE RESTRICT
    ) STRICT;
`;

export const LEVEL_5_PLAN_DDL = LEVEL_4_PLAN_DDL.replace(
    "        effective_range_kind TEXT NOT NULL CHECK (effective_range_kind IN ('inherit-course', 'explicit')),",
    `        logical_start_anchor TEXT NOT NULL CHECK (
            length(logical_start_anchor) = 10
            AND substr(logical_start_anchor, 5, 1) = '-'
            AND substr(logical_start_anchor, 8, 1) = '-'
            AND logical_start_anchor NOT GLOB '*[^0-9-]*'
        ),
        logical_end_anchor TEXT CHECK (
            logical_end_anchor IS NULL
            OR (
                length(logical_end_anchor) = 10
                AND substr(logical_end_anchor, 5, 1) = '-'
                AND substr(logical_end_anchor, 8, 1) = '-'
                AND logical_end_anchor NOT GLOB '*[^0-9-]*'
            )
        ),
        effective_range_kind TEXT NOT NULL CHECK (effective_range_kind IN ('inherit-course', 'explicit')),`,
).replace(
    `        CHECK (
            (
                effective_range_kind = 'inherit-course'`,
    `        CHECK (logical_end_anchor IS NULL OR logical_end_anchor >= logical_start_anchor),
        CHECK (
            (
                effective_range_kind = 'inherit-course'`,
) + `
    CREATE TABLE meeting_occurrence_overrides (
        meeting_series_id TEXT NOT NULL CHECK (${meetingSeriesIdCheck}),
        original_logical_anchor TEXT NOT NULL CHECK (
            length(original_logical_anchor) = 10
            AND substr(original_logical_anchor, 5, 1) = '-'
            AND substr(original_logical_anchor, 8, 1) = '-'
            AND original_logical_anchor NOT GLOB '*[^0-9-]*'
        ),
        override_kind TEXT NOT NULL CHECK (override_kind IN ('replaced', 'cancelled')),
        meeting_type TEXT CHECK (meeting_type IS NULL OR meeting_type IN ('LEC', 'TUT', 'PRA')),
        weekday TEXT CHECK (weekday IS NULL OR weekday IN ('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN')),
        local_start TEXT CHECK (
            local_start IS NULL
            OR (
                length(local_start) = 5
                AND substr(local_start, 3, 1) = ':'
                AND local_start NOT GLOB '*[^0-9:]*'
            )
        ),
        local_end TEXT CHECK (
            local_end IS NULL
            OR (
                length(local_end) = 5
                AND substr(local_end, 3, 1) = ':'
                AND local_end NOT GLOB '*[^0-9:]*'
            )
        ),
        location_kind TEXT CHECK (location_kind IS NULL OR location_kind IN ('known', 'tba')),
        location_value TEXT CHECK (
            location_value IS NULL
            OR (length(location_value) BETWEEN 1 AND 240 AND location_value = trim(location_value))
        ),
        entity_version INTEGER NOT NULL CHECK (entity_version > 0),
        CHECK (
            (
                override_kind = 'cancelled'
                AND meeting_type IS NULL
                AND weekday IS NULL
                AND local_start IS NULL
                AND local_end IS NULL
                AND location_kind IS NULL
                AND location_value IS NULL
            )
            OR (
                override_kind = 'replaced'
                AND meeting_type IS NOT NULL
                AND weekday IS NOT NULL
                AND local_start IS NOT NULL
                AND local_end IS NOT NULL
                AND local_end > local_start
                AND location_kind IS NOT NULL
                AND (
                    (location_kind = 'tba' AND location_value IS NULL)
                    OR (location_kind = 'known' AND location_value IS NOT NULL)
                )
            )
        ),
        PRIMARY KEY (meeting_series_id, original_logical_anchor),
        FOREIGN KEY (meeting_series_id)
            REFERENCES meeting_series(meeting_series_id) ON DELETE RESTRICT
    ) STRICT;
`;

export const LEVEL_5_DDL = LEVEL_4_DDL
    .replace(LEVEL_4_RECEIPT_DDL, LEVEL_5_RECEIPT_DDL)
    .replace(LEVEL_4_PLAN_DDL, LEVEL_5_PLAN_DDL);

export const LEVEL_5_TABLE_COLUMNS: Partial<Record<keyof typeof TABLE_COLUMNS, readonly unknown[]>> = {
    meeting_segments: TABLE_COLUMNS.meeting_segments.filter(column => column[0] !== 'end_day_offset'),
    meeting_occurrence_overrides: TABLE_COLUMNS.meeting_occurrence_overrides.filter(
        column => column[0] !== 'end_day_offset',
    ),
};

export const LEVEL_5_AND_6_TABLES = [
    ...LEVEL_3_AND_4_TABLES,
    'meeting_occurrence_overrides',
] as const;
