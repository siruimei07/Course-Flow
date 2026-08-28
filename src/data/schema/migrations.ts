import { DatabaseSync } from 'node:sqlite';
import { followUpIdCheck, originatingCommandIdCheck } from './base';
import { LEVEL_1_DDL } from './levels/level-01';
import { LEVEL_2_PLAN_DDL, LEVEL_2_RECEIPT_DDL } from './levels/level-02';
import { LEVEL_3_PLAN_DDL, LEVEL_3_RECEIPT_DDL } from './levels/level-03';
import { LEVEL_4_PLAN_DDL, LEVEL_4_RECEIPT_DDL } from './levels/level-04';
import { LEVEL_5_PLAN_DDL, LEVEL_5_RECEIPT_DDL } from './levels/level-05';
import { LEVEL_6_PLAN_DDL, LEVEL_6_RECEIPT_DDL } from './levels/level-06';
import { LEVEL_7_HOLIDAY_DDL, LEVEL_7_RECEIPT_DDL } from './levels/level-07';
import { LEVEL_8_RECEIPT_DDL, LEVEL_8_TASK_DDL } from './levels/level-08';
import { LEVEL_9_RECEIPT_DDL, LEVEL_9_TASK_SEGMENT_DDL } from './levels/level-09';
import { LEVEL_10_RECEIPT_DDL, LEVEL_10_TASK_OCCURRENCE_STATE_DDL, LEVEL_10_TASK_OVERRIDE_AND_HISTORY_DDL, LEVEL_10_TASK_SEGMENT_DDL, LEVEL_10_TASK_STATE_HISTORY_DDL } from './levels/level-10';
import { LEVEL_11_RECEIPT_DDL, LEVEL_11_SETUP_DRAFT_DDL } from './levels/level-11';
import { LEVEL_12_PROTECTION_DDL, LEVEL_12_RECEIPT_DDL } from './levels/level-12';
import { LEVEL_13_PROTECTION_DDL } from './levels/level-13';
import { LEVEL_14_PROTECTION_DDL } from './levels/level-14';
import { LEVEL_15_RESTORE_DDL } from './levels/level-15';
import { LEVEL_16_RESTORE_COMPLETION_DDL, LEVEL_16_RESTORE_SESSION_DDL } from './levels/level-16';
import { rejectSchema, weeklyTaskBoundaryAnchors } from './validation';
import { normalizeTaskSchedule } from '../../shared/workspace-task-contract';
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

/**
 * Migrates level 4 Meeting rules to anchored level 5 segments and override storage.
 * @param {DatabaseSync} database - Database inside the caller-owned migration transaction.
 * @return {void}
 */
export function migrateLevel4To5(database: DatabaseSync): void {
    database.exec(`
        ALTER TABLE command_receipts RENAME TO command_receipts_level_4;
        ALTER TABLE receipt_effects RENAME TO receipt_effects_level_4;
        ALTER TABLE durable_followups RENAME TO durable_followups_level_4;
        DROP INDEX durable_followups_by_command;

        ${LEVEL_5_RECEIPT_DDL}

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

        INSERT INTO command_receipts SELECT * FROM command_receipts_level_4;
        INSERT INTO receipt_effects SELECT * FROM receipt_effects_level_4;
        INSERT INTO durable_followups SELECT * FROM durable_followups_level_4;

        DROP TABLE receipt_effects_level_4;
        DROP TABLE durable_followups_level_4;
        DROP TABLE command_receipts_level_4;

        ALTER TABLE meeting_segments RENAME TO meeting_segments_level_4;
        ALTER TABLE meeting_series RENAME TO meeting_series_level_4;
        ALTER TABLE courses RENAME TO courses_level_4;
        DROP INDEX meeting_segments_by_series;
        DROP INDEX meeting_series_by_course;
        DROP INDEX courses_by_term;

        ${LEVEL_5_PLAN_DDL}

        INSERT INTO courses SELECT * FROM courses_level_4;
        INSERT INTO meeting_series SELECT * FROM meeting_series_level_4;

        WITH resolved_segments AS (
            SELECT
                meeting_segments_level_4.*,
                CASE
                    WHEN meeting_segments_level_4.effective_range_kind = 'explicit'
                        THEN meeting_segments_level_4.effective_start_date
                    WHEN courses_level_4.teaching_range_kind = 'explicit'
                        THEN courses_level_4.teaching_start_date
                    ELSE terms.start_date
                END AS resolved_start_date,
                CASE
                    WHEN meeting_segments_level_4.effective_range_kind = 'explicit'
                        THEN meeting_segments_level_4.effective_end_date
                    WHEN courses_level_4.teaching_range_kind = 'explicit'
                        THEN courses_level_4.teaching_end_date
                    ELSE terms.end_date
                END AS resolved_end_date,
                CASE meeting_segments_level_4.weekday
                    WHEN 'SUN' THEN 0
                    WHEN 'MON' THEN 1
                    WHEN 'TUE' THEN 2
                    WHEN 'WED' THEN 3
                    WHEN 'THU' THEN 4
                    WHEN 'FRI' THEN 5
                    ELSE 6
                END AS weekday_number
            FROM meeting_segments_level_4
            JOIN meeting_series_level_4
                ON meeting_series_level_4.meeting_series_id = meeting_segments_level_4.meeting_series_id
            JOIN courses_level_4
                ON courses_level_4.course_id = meeting_series_level_4.course_id
            JOIN terms ON terms.term_id = courses_level_4.term_id
        ),
        anchored_segments AS (
            SELECT
                resolved_segments.*,
                CASE
                    WHEN date(
                        resolved_start_date,
                        printf(
                            '+%d days',
                            (weekday_number - CAST(strftime('%w', resolved_start_date) AS INTEGER) + 7) % 7
                        )
                    ) IS NOT NULL
                        THEN date(
                            resolved_start_date,
                            printf(
                                '+%d days',
                                (
                                    weekday_number
                                    - CAST(strftime('%w', resolved_start_date) AS INTEGER)
                                    + 7
                                ) % 7
                            )
                        )
                    ELSE date(
                        resolved_start_date,
                        printf(
                            '-%d days',
                            (
                                CAST(strftime('%w', resolved_start_date) AS INTEGER)
                                - weekday_number
                                + 7
                            ) % 7
                        )
                    )
                END AS first_anchor
            FROM resolved_segments
        )
        INSERT INTO meeting_segments (
            meeting_segment_id,
            meeting_series_id,
            meeting_type,
            weekday,
            local_start,
            local_end,
            logical_start_anchor,
            logical_end_anchor,
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
            first_anchor,
            NULL,
            effective_range_kind,
            effective_start_date,
            effective_end_date,
            location_kind,
            location_value
        FROM anchored_segments;

        DROP TABLE meeting_segments_level_4;
        DROP TABLE meeting_series_level_4;
        DROP TABLE courses_level_4;

        UPDATE workspace_state SET revision = revision + 1 WHERE singleton = 1;
        UPDATE protection_watermarks
            SET backup_needed_through = (
                SELECT revision FROM workspace_state WHERE singleton = 1
            )
            WHERE singleton = 1;
        PRAGMA user_version = 5;
    `);
}

/**
 * Migrates level 5 Meeting rules to explicit same-day offsets while preserving receipts.
 * @param {DatabaseSync} database - Database inside the caller-owned migration transaction.
 * @return {void}
 */
export function migrateLevel5To6(database: DatabaseSync): void {
    database.exec(`
        ALTER TABLE command_receipts RENAME TO command_receipts_level_5;
        ALTER TABLE receipt_effects RENAME TO receipt_effects_level_5;
        ALTER TABLE durable_followups RENAME TO durable_followups_level_5;
        DROP INDEX durable_followups_by_command;

        ${LEVEL_6_RECEIPT_DDL}

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

        INSERT INTO command_receipts SELECT * FROM command_receipts_level_5;
        INSERT INTO receipt_effects SELECT * FROM receipt_effects_level_5;
        INSERT INTO durable_followups SELECT * FROM durable_followups_level_5;

        DROP TABLE receipt_effects_level_5;
        DROP TABLE durable_followups_level_5;
        DROP TABLE command_receipts_level_5;

        ALTER TABLE meeting_occurrence_overrides RENAME TO meeting_occurrence_overrides_level_5;
        ALTER TABLE meeting_segments RENAME TO meeting_segments_level_5;
        ALTER TABLE meeting_series RENAME TO meeting_series_level_5;
        ALTER TABLE courses RENAME TO courses_level_5;
        DROP INDEX meeting_segments_by_series;
        DROP INDEX meeting_series_by_course;
        DROP INDEX courses_by_term;

        ${LEVEL_6_PLAN_DDL}

        INSERT INTO courses SELECT * FROM courses_level_5;
        INSERT INTO meeting_series SELECT * FROM meeting_series_level_5;
        INSERT INTO meeting_segments (
            meeting_segment_id,
            meeting_series_id,
            meeting_type,
            weekday,
            local_start,
            local_end,
            end_day_offset,
            logical_start_anchor,
            logical_end_anchor,
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
            0,
            logical_start_anchor,
            logical_end_anchor,
            effective_range_kind,
            effective_start_date,
            effective_end_date,
            location_kind,
            location_value
        FROM meeting_segments_level_5;
        INSERT INTO meeting_occurrence_overrides (
            meeting_series_id,
            original_logical_anchor,
            override_kind,
            meeting_type,
            weekday,
            local_start,
            local_end,
            end_day_offset,
            location_kind,
            location_value,
            entity_version
        )
        SELECT
            meeting_series_id,
            original_logical_anchor,
            override_kind,
            meeting_type,
            weekday,
            local_start,
            local_end,
            CASE WHEN override_kind = 'replaced' THEN 0 ELSE NULL END,
            location_kind,
            location_value,
            entity_version
        FROM meeting_occurrence_overrides_level_5;

        DROP TABLE meeting_occurrence_overrides_level_5;
        DROP TABLE meeting_segments_level_5;
        DROP TABLE meeting_series_level_5;
        DROP TABLE courses_level_5;

        UPDATE workspace_state SET revision = revision + 1 WHERE singleton = 1;
        UPDATE protection_watermarks
            SET backup_needed_through = (
                SELECT revision FROM workspace_state WHERE singleton = 1
            )
            WHERE singleton = 1;
        PRAGMA user_version = 6;
    `);
}

/**
 * Migrates level 6 to named inclusive HolidayRange storage while preserving receipts.
 * @param {DatabaseSync} database - Database inside the caller-owned migration transaction.
 * @return {void}
 */
export function migrateLevel6To7(database: DatabaseSync): void {
    database.exec(`
        ALTER TABLE command_receipts RENAME TO command_receipts_level_6;
        ALTER TABLE receipt_effects RENAME TO receipt_effects_level_6;
        ALTER TABLE durable_followups RENAME TO durable_followups_level_6;
        DROP INDEX durable_followups_by_command;

        ${LEVEL_7_RECEIPT_DDL}

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

        INSERT INTO command_receipts SELECT * FROM command_receipts_level_6;
        INSERT INTO receipt_effects SELECT * FROM receipt_effects_level_6;
        INSERT INTO durable_followups SELECT * FROM durable_followups_level_6;

        DROP TABLE receipt_effects_level_6;
        DROP TABLE durable_followups_level_6;
        DROP TABLE command_receipts_level_6;

        ${LEVEL_7_HOLIDAY_DDL}

        UPDATE workspace_state SET revision = revision + 1 WHERE singleton = 1;
        UPDATE protection_watermarks
            SET backup_needed_through = (
                SELECT revision FROM workspace_state WHERE singleton = 1
            )
            WHERE singleton = 1;
        PRAGMA user_version = 7;
    `);
}

/**
 * Migrates level 7 to once-only Task storage while preserving durable receipts.
 * @param {DatabaseSync} database - Database inside the caller-owned migration transaction.
 * @return {void}
 */
export function migrateLevel7To8(database: DatabaseSync): void {
    database.exec(`
        ALTER TABLE command_receipts RENAME TO command_receipts_level_7;
        ALTER TABLE receipt_effects RENAME TO receipt_effects_level_7;
        ALTER TABLE durable_followups RENAME TO durable_followups_level_7;
        DROP INDEX durable_followups_by_command;

        ${LEVEL_8_RECEIPT_DDL}

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

        INSERT INTO command_receipts SELECT * FROM command_receipts_level_7;
        INSERT INTO receipt_effects SELECT * FROM receipt_effects_level_7;
        INSERT INTO durable_followups SELECT * FROM durable_followups_level_7;

        DROP TABLE receipt_effects_level_7;
        DROP TABLE durable_followups_level_7;
        DROP TABLE command_receipts_level_7;

        ${LEVEL_8_TASK_DDL}

        UPDATE workspace_state SET revision = revision + 1 WHERE singleton = 1;
        UPDATE protection_watermarks
            SET backup_needed_through = (
                SELECT revision FROM workspace_state WHERE singleton = 1
            )
            WHERE singleton = 1;
        PRAGMA user_version = 8;
    `);
}

/**
 * Migrates once-only Task storage to the weekly Task rule union without losing durable records.
 * @param {DatabaseSync} database - Database inside the caller-owned migration transaction.
 * @return {void}
 */
export function migrateLevel8To9(database: DatabaseSync): void {
    database.exec(`
        ALTER TABLE command_receipts RENAME TO command_receipts_level_8;
        ALTER TABLE receipt_effects RENAME TO receipt_effects_level_8;
        ALTER TABLE durable_followups RENAME TO durable_followups_level_8;
        DROP INDEX durable_followups_by_command;

        ${LEVEL_9_RECEIPT_DDL}

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

        INSERT INTO command_receipts SELECT * FROM command_receipts_level_8;
        INSERT INTO receipt_effects SELECT * FROM receipt_effects_level_8;
        INSERT INTO durable_followups SELECT * FROM durable_followups_level_8;

        DROP TABLE receipt_effects_level_8;
        DROP TABLE durable_followups_level_8;
        DROP TABLE command_receipts_level_8;

        ALTER TABLE task_segments RENAME TO task_segments_level_8;
        DROP INDEX task_segments_by_series;
        ${LEVEL_9_TASK_SEGMENT_DDL}
        INSERT INTO task_segments (
            task_segment_id,
            task_series_id,
            title,
            task_size,
            schedule_kind,
            deadline_kind,
            deadline_date,
            deadline_instant,
            deadline_display_zone,
            weekly_start_date,
            weekly_weekday,
            weekly_local_deadline_time,
            weekly_confirmed_end_date,
            follow_teaching_week
        ) SELECT
            task_segment_id,
            task_series_id,
            title,
            task_size,
            schedule_kind,
            deadline_kind,
            deadline_date,
            deadline_instant,
            deadline_display_zone,
            NULL,
            NULL,
            NULL,
            NULL,
            NULL
        FROM task_segments_level_8;
        DROP TABLE task_segments_level_8;

        UPDATE workspace_state SET revision = revision + 1 WHERE singleton = 1;
        UPDATE protection_watermarks
            SET backup_needed_through = (
                SELECT revision FROM workspace_state WHERE singleton = 1
            )
            WHERE singleton = 1;
        PRAGMA user_version = 9;
    `);
}

/**
 * Migrates weekly Task rules to anchored segments and complete occurrence-state facts.
 * @param {DatabaseSync} database - Database inside the caller-owned migration transaction.
 * @return {void}
 */
export function migrateLevel9To10(database: DatabaseSync): void {
    const weeklySegments = database.prepare(`
        SELECT
            task_segment_id,
            weekly_start_date,
            weekly_weekday,
            weekly_local_deadline_time,
            weekly_confirmed_end_date,
            follow_teaching_week
        FROM task_segments
        WHERE schedule_kind = 'weekly'
    `).all() as Array<{
        task_segment_id: string;
        weekly_start_date: unknown;
        weekly_weekday: unknown;
        weekly_local_deadline_time: unknown;
        weekly_confirmed_end_date: unknown;
        follow_teaching_week: unknown;
    }>;
    const weeklyAnchors = weeklySegments.map((segment) => {
        const schedule = normalizeTaskSchedule({
            kind: 'weekly',
            startDate: segment.weekly_start_date,
            weekday: segment.weekly_weekday,
            localDeadlineTime: segment.weekly_local_deadline_time,
            confirmedEndDate: segment.weekly_confirmed_end_date,
            followTeachingWeek: segment.follow_teaching_week === 1 || segment.follow_teaching_week === 1n,
        });
        if (schedule?.kind !== 'weekly') {
            rejectSchema('database-corrupt');
        }
        const anchors = weeklyTaskBoundaryAnchors(schedule);
        if (anchors === null) {
            rejectSchema('database-corrupt');
        }
        return { taskSegmentId: segment.task_segment_id, anchors };
    });

    database.exec(`
        ALTER TABLE command_receipts RENAME TO command_receipts_level_9;
        ALTER TABLE receipt_effects RENAME TO receipt_effects_level_9;
        ALTER TABLE durable_followups RENAME TO durable_followups_level_9;
        DROP INDEX durable_followups_by_command;

        ${LEVEL_10_RECEIPT_DDL}

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

        INSERT INTO command_receipts SELECT * FROM command_receipts_level_9;
        INSERT INTO receipt_effects SELECT * FROM receipt_effects_level_9;
        INSERT INTO durable_followups SELECT * FROM durable_followups_level_9;

        DROP TABLE receipt_effects_level_9;
        DROP TABLE durable_followups_level_9;
        DROP TABLE command_receipts_level_9;

        ALTER TABLE task_segments RENAME TO task_segments_level_9;
        DROP INDEX task_segments_by_series;
        ALTER TABLE task_occurrence_states RENAME TO task_occurrence_states_level_9;

        ${LEVEL_10_TASK_SEGMENT_DDL}
        ${LEVEL_10_TASK_OCCURRENCE_STATE_DDL}
        ${LEVEL_10_TASK_OVERRIDE_AND_HISTORY_DDL}

        INSERT INTO task_segments (
            task_segment_id,
            task_series_id,
            title,
            task_size,
            schedule_kind,
            deadline_kind,
            deadline_date,
            deadline_instant,
            deadline_display_zone,
            logical_start_anchor,
            logical_end_anchor,
            weekly_start_date,
            weekly_weekday,
            weekly_local_deadline_time,
            weekly_confirmed_end_date,
            follow_teaching_week
        ) SELECT
            task_segment_id,
            task_series_id,
            title,
            task_size,
            schedule_kind,
            deadline_kind,
            deadline_date,
            deadline_instant,
            deadline_display_zone,
            'once',
            'once',
            weekly_start_date,
            weekly_weekday,
            weekly_local_deadline_time,
            weekly_confirmed_end_date,
            follow_teaching_week
        FROM task_segments_level_9
        WHERE schedule_kind = 'once';

        INSERT INTO task_occurrence_states (
            task_series_id,
            original_logical_anchor,
            status,
            self_reported_progress,
            entity_version
        ) SELECT
            task_series_id,
            original_logical_anchor,
            status,
            NULL,
            entity_version
        FROM task_occurrence_states_level_9;

        DROP TABLE task_occurrence_states_level_9;
    `);

    const insertWeeklySegment = database.prepare(`
        INSERT INTO task_segments (
            task_segment_id,
            task_series_id,
            title,
            task_size,
            schedule_kind,
            deadline_kind,
            deadline_date,
            deadline_instant,
            deadline_display_zone,
            logical_start_anchor,
            logical_end_anchor,
            weekly_start_date,
            weekly_weekday,
            weekly_local_deadline_time,
            weekly_confirmed_end_date,
            follow_teaching_week
        ) SELECT
            task_segment_id,
            task_series_id,
            title,
            task_size,
            schedule_kind,
            deadline_kind,
            deadline_date,
            deadline_instant,
            deadline_display_zone,
            ?,
            ?,
            weekly_start_date,
            weekly_weekday,
            weekly_local_deadline_time,
            weekly_confirmed_end_date,
            follow_teaching_week
        FROM task_segments_level_9
        WHERE task_segment_id = ?
    `);
    for (const weeklySegment of weeklyAnchors) {
        insertWeeklySegment.run(
            weeklySegment.anchors[0],
            weeklySegment.anchors[1],
            weeklySegment.taskSegmentId,
        );
    }

    database.exec(`
        DROP TABLE task_segments_level_9;

        UPDATE workspace_state SET revision = revision + 1 WHERE singleton = 1;
        UPDATE protection_watermarks
            SET backup_needed_through = (
                SELECT revision FROM workspace_state WHERE singleton = 1
            )
            WHERE singleton = 1;
        PRAGMA user_version = 10;
    `);
}

/**
 * Adds the setup draft stream and derives the retained minimum milestone from historical PLAN facts.
 * Archived Courses and retired activities still prove that the one-way minimum was once reached.
 * @param {DatabaseSync} database - Database inside the caller-owned migration transaction.
 * @return {void}
 */
export function migrateLevel10To11(database: DatabaseSync): void {
    database.exec(`
        ALTER TABLE task_state_history RENAME TO task_state_history_level_10;
        DROP INDEX task_state_history_by_command;
        ALTER TABLE command_receipts RENAME TO command_receipts_level_10;
        ALTER TABLE receipt_effects RENAME TO receipt_effects_level_10;
        ALTER TABLE durable_followups RENAME TO durable_followups_level_10;
        DROP INDEX durable_followups_by_command;

        ${LEVEL_11_RECEIPT_DDL}

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

        ${LEVEL_10_TASK_STATE_HISTORY_DDL}

        INSERT INTO command_receipts SELECT * FROM command_receipts_level_10;
        INSERT INTO receipt_effects SELECT * FROM receipt_effects_level_10;
        INSERT INTO durable_followups SELECT * FROM durable_followups_level_10;
        INSERT INTO task_state_history SELECT * FROM task_state_history_level_10;

        DROP TABLE task_state_history_level_10;
        DROP TABLE receipt_effects_level_10;
        DROP TABLE durable_followups_level_10;
        DROP TABLE command_receipts_level_10;

        ${LEVEL_11_SETUP_DRAFT_DDL}

        INSERT INTO setup_draft_checkpoint (
            singleton,
            checkpoint_version,
            schema_version,
            updated_at,
            opaque_payload
        ) VALUES (1, 0, NULL, NULL, NULL);

        UPDATE setup_state
        SET ever_reached_minimum = 1
        WHERE singleton = 1
            AND ever_reached_minimum = 0
            AND EXISTS (
                SELECT 1
                FROM courses
                WHERE EXISTS (
                    SELECT 1
                    FROM meeting_series
                    WHERE meeting_series.course_id = courses.course_id
                )
                    OR EXISTS (
                        SELECT 1
                        FROM task_series
                        WHERE task_series.course_id = courses.course_id
                    )
            );

        UPDATE workspace_state SET revision = revision + 1 WHERE singleton = 1;
        UPDATE protection_watermarks
            SET backup_needed_through = (
                SELECT revision FROM workspace_state WHERE singleton = 1
            )
            WHERE singleton = 1;
        PRAGMA user_version = 11;
    `);
}

/**
 * Adds the legal unconfigured PROTECT state and receipt vocabulary.
 * @param {DatabaseSync} database - Database inside the caller-owned migration transaction.
 * @return {void}
 */
export function migrateLevel11To12(database: DatabaseSync): void {
    database.exec(`
        ALTER TABLE task_state_history RENAME TO task_state_history_level_11;
        DROP INDEX task_state_history_by_command;
        ALTER TABLE command_receipts RENAME TO command_receipts_level_11;
        ALTER TABLE receipt_effects RENAME TO receipt_effects_level_11;
        ALTER TABLE durable_followups RENAME TO durable_followups_level_11;
        DROP INDEX durable_followups_by_command;

        ${LEVEL_12_RECEIPT_DDL}

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

        ${LEVEL_10_TASK_STATE_HISTORY_DDL}

        INSERT INTO command_receipts SELECT * FROM command_receipts_level_11;
        INSERT INTO receipt_effects SELECT * FROM receipt_effects_level_11;
        INSERT INTO durable_followups SELECT * FROM durable_followups_level_11;
        INSERT INTO task_state_history SELECT * FROM task_state_history_level_11;

        DROP TABLE task_state_history_level_11;
        DROP TABLE receipt_effects_level_11;
        DROP TABLE durable_followups_level_11;
        DROP TABLE command_receipts_level_11;

        ${LEVEL_12_PROTECTION_DDL}
        INSERT INTO backup_configuration (
            singleton,
            configuration_version,
            backup_set_id,
            repository_schema,
            canonical_destination_path,
            destination_display_name,
            originating_command_id,
            configured_revision
        ) VALUES (1, 0, NULL, NULL, NULL, NULL, NULL, NULL);

        UPDATE workspace_state SET revision = revision + 1 WHERE singleton = 1;
        UPDATE protection_watermarks
            SET backup_needed_through = (
                SELECT revision FROM workspace_state WHERE singleton = 1
            )
            WHERE singleton = 1;
        PRAGMA user_version = 12;
    `);
}

/**
 * Adds durable backup operation and immutable snapshot success facts.
 * @param {DatabaseSync} database - Database inside the caller-owned migration transaction.
 * @return {void}
 */
export function migrateLevel12To13(database: DatabaseSync): void {
    database.exec(`
        ALTER TABLE durable_followups RENAME TO durable_followups_level_12;
        DROP INDEX durable_followups_by_command;

        CREATE TABLE durable_followups (
            follow_up_id TEXT PRIMARY KEY CHECK (${followUpIdCheck}),
            originating_command_id TEXT NOT NULL CHECK (${originatingCommandIdCheck}),
            owner TEXT NOT NULL CHECK (owner = 'protect'),
            kind TEXT NOT NULL CHECK (kind = 'backup-needed-through'),
            prerequisite_revision INTEGER NOT NULL CHECK (prerequisite_revision > 0),
            state TEXT NOT NULL CHECK (state IN ('pending', 'completed')),
            follow_up_version INTEGER NOT NULL CHECK (follow_up_version IN (0, 1)),
            FOREIGN KEY (originating_command_id) REFERENCES command_receipts(command_id) ON DELETE RESTRICT
        ) STRICT;
        CREATE INDEX durable_followups_by_command
            ON durable_followups(originating_command_id);

        INSERT INTO durable_followups SELECT * FROM durable_followups_level_12;
        DROP TABLE durable_followups_level_12;

        ${LEVEL_13_PROTECTION_DDL}

        UPDATE durable_followups
        SET state = 'completed', follow_up_version = 1
        WHERE prerequisite_revision <= (
            SELECT backup_succeeded_through
            FROM protection_watermarks
            WHERE singleton = 1
        );
        UPDATE workspace_state SET revision = revision + 1 WHERE singleton = 1;
        UPDATE protection_watermarks
            SET backup_needed_through = (
                SELECT revision FROM workspace_state WHERE singleton = 1
            )
            WHERE singleton = 1;
        PRAGMA user_version = 13;
    `);
}

/**
 * Adds the resumable retention cleanup journal and marks the migration revision pending.
 * @param {DatabaseSync} database - Database inside the caller-owned migration transaction.
 * @return {void}
 */
export function migrateLevel13To14(database: DatabaseSync): void {
    database.exec(`
        ${LEVEL_14_PROTECTION_DDL}

        UPDATE workspace_state SET revision = revision + 1 WHERE singleton = 1;
        UPDATE protection_watermarks
            SET backup_needed_through = (
                SELECT revision FROM workspace_state WHERE singleton = 1
            )
            WHERE singleton = 1;
        PRAGMA user_version = 14;
    `);
}

/**
 * Adds typed pre-checkpoint RestoreSession state and marks the migration revision pending.
 * @param {DatabaseSync} database - Database inside the caller-owned migration transaction.
 * @return {void}
 */
export function migrateLevel14To15(database: DatabaseSync): void {
    database.exec(`
        ${LEVEL_15_RESTORE_DDL}

        UPDATE workspace_state SET revision = revision + 1 WHERE singleton = 1;
        UPDATE protection_watermarks
            SET backup_needed_through = (
                SELECT revision FROM workspace_state WHERE singleton = 1
            )
            WHERE singleton = 1;
        PRAGMA user_version = 15;
    `);
}

/**
 * Adds typed Restore completion receipts and marks the migration revision pending.
 * @param {DatabaseSync} database - Database inside the caller-owned migration transaction.
 * @return {void}
 */
export function migrateLevel15To16(database: DatabaseSync): void {
    database.exec(`
        ALTER TABLE restore_command_receipts RENAME TO restore_command_receipts_level_15;
        ALTER TABLE restore_sessions RENAME TO restore_sessions_level_15;
        DROP INDEX restore_command_receipts_by_session;

        ${LEVEL_16_RESTORE_SESSION_DDL}

        INSERT INTO restore_sessions SELECT * FROM restore_sessions_level_15;
        INSERT INTO restore_command_receipts SELECT * FROM restore_command_receipts_level_15;

        DROP TABLE restore_command_receipts_level_15;
        DROP TABLE restore_sessions_level_15;

        ${LEVEL_16_RESTORE_COMPLETION_DDL}

        UPDATE workspace_state SET revision = revision + 1 WHERE singleton = 1;
        UPDATE protection_watermarks
            SET backup_needed_through = (
                SELECT revision FROM workspace_state WHERE singleton = 1
            )
            WHERE singleton = 1;
        PRAGMA user_version = 16;
    `);
}
