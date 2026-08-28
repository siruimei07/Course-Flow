import { LEVEL_5_DDL, LEVEL_5_PLAN_DDL, LEVEL_5_RECEIPT_DDL } from './level-05';
export const LEVEL_6_RECEIPT_DDL = LEVEL_5_RECEIPT_DDL.replace(
    `            intent_schema_version = 1
            OR (intent_kind = 'plan.create-course-with-first-meeting' AND intent_schema_version = 2)`,
    `            intent_schema_version = 1
            OR (
                intent_kind = 'plan.create-course-with-first-meeting'
                AND intent_schema_version IN (2, 3)
            )
            OR (intent_kind = 'plan.change-meeting-occurrence' AND intent_schema_version = 2)`,
);

export const LEVEL_6_PLAN_DDL = LEVEL_5_PLAN_DDL.replace(
    `        local_end TEXT NOT NULL CHECK (
            length(local_end) = 5
            AND substr(local_end, 3, 1) = ':'
            AND local_end NOT GLOB '*[^0-9:]*'
            AND local_end > local_start
        ),
        logical_start_anchor`,
    `        local_end TEXT NOT NULL CHECK (
            length(local_end) = 5
            AND substr(local_end, 3, 1) = ':'
            AND local_end NOT GLOB '*[^0-9:]*'
        ),
        end_day_offset INTEGER NOT NULL CHECK (end_day_offset IN (0, 1)),
        logical_start_anchor`,
).replace(
    `        CHECK (logical_end_anchor IS NULL OR logical_end_anchor >= logical_start_anchor),`,
    `        CHECK (end_day_offset = 1 OR local_end > local_start),
        CHECK (logical_end_anchor IS NULL OR logical_end_anchor >= logical_start_anchor),`,
).replace(
    `        location_kind TEXT CHECK (location_kind IS NULL OR location_kind IN ('known', 'tba')),`,
    `        end_day_offset INTEGER CHECK (end_day_offset IS NULL OR end_day_offset IN (0, 1)),
        location_kind TEXT CHECK (location_kind IS NULL OR location_kind IN ('known', 'tba')),`,
).replace(
    `                AND local_end IS NULL
                AND location_kind IS NULL`,
    `                AND local_end IS NULL
                AND end_day_offset IS NULL
                AND location_kind IS NULL`,
).replace(
    `                AND local_end IS NOT NULL
                AND local_end > local_start
                AND location_kind IS NOT NULL`,
    `                AND local_end IS NOT NULL
                AND end_day_offset IS NOT NULL
                AND (end_day_offset = 1 OR local_end > local_start)
                AND location_kind IS NOT NULL`,
);

export const LEVEL_6_DDL = LEVEL_5_DDL
    .replace(LEVEL_5_RECEIPT_DDL, LEVEL_6_RECEIPT_DDL)
    .replace(LEVEL_5_PLAN_DDL, LEVEL_6_PLAN_DDL);
