import { holidayRangeIdCheck, termIdCheck } from '../base';
import { LEVEL_5_AND_6_TABLES } from './level-05';
import { LEVEL_6_DDL, LEVEL_6_RECEIPT_DDL } from './level-06';
export const LEVEL_7_RECEIPT_DDL = LEVEL_6_RECEIPT_DDL
    .replace(
        "                'plan.cancel-meeting-occurrence'",
        `                'plan.cancel-meeting-occurrence',
                'plan.create-holiday-range',
                'plan.update-holiday-range',
                'plan.delete-holiday-range'`,
    )
    .replace(
        `            OR (effect_code = 'plan.meeting-occurrence-cancelled' AND entity_kind = 'meeting-series')`,
        `            OR (effect_code = 'plan.meeting-occurrence-cancelled' AND entity_kind = 'meeting-series')
            OR (effect_code = 'plan.holiday-range-created' AND entity_kind = 'holiday-range')
            OR (effect_code = 'plan.holiday-range-updated' AND entity_kind = 'holiday-range')
            OR (effect_code = 'plan.holiday-range-deleted' AND entity_kind = 'holiday-range')`,
    );

export const LEVEL_7_HOLIDAY_DDL = `
    CREATE TABLE holiday_ranges (
        holiday_range_id TEXT PRIMARY KEY CHECK (${holidayRangeIdCheck}),
        term_id TEXT NOT NULL CHECK (${termIdCheck}),
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
        tombstoned INTEGER NOT NULL CHECK (tombstoned IN (0, 1)),
        entity_version INTEGER NOT NULL CHECK (entity_version > 0),
        FOREIGN KEY (term_id) REFERENCES terms(term_id) ON DELETE RESTRICT
    ) STRICT;

    CREATE INDEX holiday_ranges_by_term ON holiday_ranges(term_id);
`;

export const LEVEL_7_DDL = LEVEL_6_DDL.replace(LEVEL_6_RECEIPT_DDL, LEVEL_7_RECEIPT_DDL)
    + LEVEL_7_HOLIDAY_DDL;

export const LEVEL_7_TABLES = [
    ...LEVEL_5_AND_6_TABLES,
    'holiday_ranges',
] as const;
