import { DatabaseSync } from 'node:sqlite';
import { COURSEFLOW_APPLICATION_ID } from '../schema';
import { LEVEL_1_DDL, LEVEL_1_TABLES } from './levels/level-01';
import { LEVEL_2_DDL, LEVEL_2_TABLES } from './levels/level-02';
import { LEVEL_3_AND_4_TABLES, LEVEL_3_DDL, LEVEL_3_TABLE_COLUMNS } from './levels/level-03';
import { LEVEL_4_DDL, LEVEL_4_TABLE_COLUMNS } from './levels/level-04';
import { LEVEL_5_AND_6_TABLES, LEVEL_5_DDL, LEVEL_5_TABLE_COLUMNS } from './levels/level-05';
import { LEVEL_6_DDL } from './levels/level-06';
import { LEVEL_7_DDL, LEVEL_7_TABLES } from './levels/level-07';
import { LEVEL_8_DDL, LEVEL_8_TABLES, LEVEL_8_TABLE_COLUMNS } from './levels/level-08';
import { LEVEL_9_DDL, LEVEL_9_TABLES, LEVEL_9_TABLE_COLUMNS } from './levels/level-09';
import { LEVEL_10_DDL, LEVEL_10_TABLES } from './levels/level-10';
import { LEVEL_11_DDL, LEVEL_11_TABLES } from './levels/level-11';
import { LEVEL_12_DDL, LEVEL_12_TABLES } from './levels/level-12';
import { LEVEL_13_DDL, LEVEL_13_TABLES } from './levels/level-13';
import { LEVEL_14_DDL, LEVEL_14_TABLES } from './levels/level-14';
import { LEVEL_15_DDL, LEVEL_15_TABLES } from './levels/level-15';
import { LEVEL_16_DDL, LEVEL_16_TABLES } from './levels/level-16';
import { LEVEL_17_DDL, LEVEL_17_TABLES } from './levels/level-17';
import { INTL_ZONE_RULES, isCanonicalInstant } from '../../shared/meeting-time';
import { isCanonicalUuid } from '../../shared/workspace-data-contract';
import { normalizeTaskSchedule } from '../../shared/workspace-task-contract';
import type { WeeklyTaskSchedule } from '../../shared/workspace-task-contract';
import { MAX_SETUP_DRAFT_PAYLOAD_BYTES } from '../../shared/workspace-term-contract';
import { FOREIGN_KEYS, TABLE_COLUMNS } from './tables';
import type { CurrentTable, SchemaLevel } from './tables';



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

export function rejectSchema(reason: SchemaValidationFailureReason = 'schema-mismatch'): never {
    throw new SchemaValidationError(reason);
}


export function tableNames(level: SchemaLevel): readonly CurrentTable[] {
    if (level === 1) {
        return LEVEL_1_TABLES;
    }
    if (level === 2) {
        return LEVEL_2_TABLES;
    }
    if (level === 3 || level === 4) {
        return LEVEL_3_AND_4_TABLES;
    }
    if (level === 5 || level === 6) {
        return LEVEL_5_AND_6_TABLES;
    }
    if (level === 7) {
        return LEVEL_7_TABLES;
    }
    if (level === 8) {
        return LEVEL_8_TABLES;
    }
    if (level === 9) {
        return LEVEL_9_TABLES;
    }
    if (level === 10) {
        return LEVEL_10_TABLES;
    }
    if (level === 11) {
        return LEVEL_11_TABLES;
    }
    if (level === 12) {
        return LEVEL_12_TABLES;
    }
    if (level === 13) {
        return LEVEL_13_TABLES;
    }
    if (level === 14) {
        return LEVEL_14_TABLES;
    }
    if (level === 15) {
        return LEVEL_15_TABLES;
    }
    return level === 16 ? LEVEL_16_TABLES : LEVEL_17_TABLES;
}

export function pragmaValue(database: DatabaseSync, pragma: string, field: string): unknown {
    const row = database.prepare(`PRAGMA ${pragma}`).get() as Record<string, unknown> | undefined;
    return row?.[field];
}

export function equalRows(actual: readonly unknown[], expected: readonly unknown[]): boolean {
    return JSON.stringify(actual) === JSON.stringify(expected);
}

export function normalizeTableSql(sql: string): string {
    return sql
        .replaceAll(/\s+/g, ' ')
        .replaceAll(/\s*([(),=<>])\s*/g, '$1')
        .trim()
        .toLowerCase();
}

export function expectedTableSql(table: CurrentTable, level: SchemaLevel): string {
    const ddl = level === 1
        ? LEVEL_1_DDL
        : level === 2
            ? LEVEL_2_DDL
            : level === 3
                ? LEVEL_3_DDL
                : level === 4
                    ? LEVEL_4_DDL
                    : level === 5
                        ? LEVEL_5_DDL
                        : level === 6
                            ? LEVEL_6_DDL
                            : level === 7
                                ? LEVEL_7_DDL
                                : level === 8
                                    ? LEVEL_8_DDL
                                    : level === 9
                                        ? LEVEL_9_DDL
                                        : level === 10
                                            ? LEVEL_10_DDL
                                            : level === 11
                                                ? LEVEL_11_DDL
                                                : level === 12
                                                    ? LEVEL_12_DDL
                                                    : level === 13
                                                        ? LEVEL_13_DDL
                                                        : level === 14
                                                            ? LEVEL_14_DDL
                                                            : level === 15
                                                                ? LEVEL_15_DDL
                                                                : level === 16
                                                                    ? LEVEL_16_DDL
                                                                    : LEVEL_17_DDL;
    const statement = ddl
        .split(';')
        .find((candidate) => candidate.includes(`CREATE TABLE ${table} `));
    if (!statement) {
        rejectSchema();
    }
    return normalizeTableSql(statement);
}

export function validateTables(database: DatabaseSync, level: SchemaLevel): void {
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

export function validateColumnsAndForeignKeys(
    database: DatabaseSync,
    table: CurrentTable,
    level: SchemaLevel,
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
        : level === 4 && LEVEL_4_TABLE_COLUMNS[table]
                ? LEVEL_4_TABLE_COLUMNS[table]
                : level === 5 && LEVEL_5_TABLE_COLUMNS[table]
                    ? LEVEL_5_TABLE_COLUMNS[table]
                    : level === 8 && LEVEL_8_TABLE_COLUMNS[table]
                        ? LEVEL_8_TABLE_COLUMNS[table]
                        : level === 9 && LEVEL_9_TABLE_COLUMNS[table]
                            ? LEVEL_9_TABLE_COLUMNS[table]
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

export function validateIndexes(database: DatabaseSync, table: CurrentTable, level: SchemaLevel): void {
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
    const indexByTable: Partial<Record<CurrentTable, readonly (readonly [string, number, readonly string[]])[]>> = {
        durable_followups: [['durable_followups_by_command', 0, ['originating_command_id']]],
        restore_command_receipts: [[
            'restore_command_receipts_by_session',
            0,
            ['restore_session_id'],
        ]],
        courses: [['courses_by_term', 0, ['term_id']]],
        meeting_series: [['meeting_series_by_course', 0, ['course_id']]],
        meeting_segments: [['meeting_segments_by_series', 0, ['meeting_series_id']]],
        holiday_ranges: [['holiday_ranges_by_term', 0, ['term_id']]],
        task_series: [['task_series_by_course', 0, ['course_id']]],
        task_segments: level >= 10
            ? [['task_segments_by_series_start', 1, ['task_series_id', 'logical_start_anchor']]]
            : [['task_segments_by_series', 0, ['task_series_id']]],
        task_state_history: [['task_state_history_by_command', 1, ['originating_command_id']]],
    };
    const expectedIndexesForTable = indexByTable[table] ?? [];
    const expectedIndexes = expectedIndexesForTable.map(index => [index[0], index[1], 'c', 0]);
    if (!equalRows(customIndexes, expectedIndexes)) {
        rejectSchema();
    }

    for (const expectedIndex of expectedIndexesForTable) {
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
                column.name,
                column.desc,
                column.coll,
                column.key,
            ]);
        const expectedKeyColumns = expectedIndex[2].map((column, index) => [
            index,
            column,
            0,
            'BINARY',
            1,
        ]);
        if (!equalRows(keyColumns, expectedKeyColumns)) {
            rejectSchema();
        }
    }
}

export function validateBootstrapFacts(database: DatabaseSync, level: SchemaLevel): SchemaFacts {
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

    if (level >= 11) {
        const draft = database.prepare(`
            SELECT checkpoint_version, schema_version, updated_at, opaque_payload
            FROM setup_draft_checkpoint
            WHERE singleton = 1
        `);
        draft.setReadBigInts(true);
        const draftRow = draft.get() as {
            checkpoint_version: bigint;
            schema_version: bigint | null;
            updated_at: string | null;
            opaque_payload: string | null;
        } | undefined;
        const draftCount = database.prepare('SELECT count(*) AS count FROM setup_draft_checkpoint');
        draftCount.setReadBigInts(true);
        let payloadIsJson = draftRow?.opaque_payload === null;
        if (draftRow?.opaque_payload !== null && draftRow?.opaque_payload !== undefined) {
            try {
                JSON.parse(draftRow.opaque_payload);
                payloadIsJson = true;
            }
            catch {
                payloadIsJson = false;
            }
        }
        if (!draftRow
            || (draftCount.get() as { count: bigint }).count !== 1n
            || draftRow.checkpoint_version < 0n
            || (draftRow.schema_version !== null && draftRow.schema_version !== 1n)
            || ((draftRow.schema_version === null) !== (draftRow.updated_at === null))
            || ((draftRow.schema_version === null) !== (draftRow.opaque_payload === null))
            || (draftRow.updated_at !== null && !isCanonicalInstant(draftRow.updated_at))
            || (draftRow.opaque_payload !== null
                && Buffer.byteLength(draftRow.opaque_payload, 'utf8') > MAX_SETUP_DRAFT_PAYLOAD_BYTES)
            || !payloadIsJson) {
            rejectSchema('database-corrupt');
        }
    }

    return {
        workspaceId: workspaceRow.workspace_id,
        revision: workspaceRow.revision,
    };
}

/**
 * Validates cross-row Meeting identity facts that SQLite column checks cannot express.
 * @param {DatabaseSync} database - Open CourseFlow database at schema level 5 or later.
 * @return {void}
 */
export function validateLevel5MeetingFacts(database: DatabaseSync): void {
    const overlappingSegments = database.prepare(`
        SELECT count(*) AS count
        FROM meeting_segments AS first_segment
        JOIN meeting_segments AS second_segment
            ON second_segment.meeting_series_id = first_segment.meeting_series_id
            AND second_segment.meeting_segment_id > first_segment.meeting_segment_id
            AND first_segment.logical_start_anchor
                <= coalesce(second_segment.logical_end_anchor, '9999-12-31')
            AND second_segment.logical_start_anchor
                <= coalesce(first_segment.logical_end_anchor, '9999-12-31')
    `);
    overlappingSegments.setReadBigInts(true);
    const overlapCount = (overlappingSegments.get() as { count: bigint }).count;

    const detachedOverrides = database.prepare(`
        SELECT count(*) AS count
        FROM (
            SELECT
                occurrence_override.meeting_series_id,
                occurrence_override.original_logical_anchor,
                count(meeting_segments.meeting_segment_id) AS matching_segment_count
            FROM meeting_occurrence_overrides AS occurrence_override
            LEFT JOIN meeting_segments
                ON meeting_segments.meeting_series_id = occurrence_override.meeting_series_id
                AND occurrence_override.original_logical_anchor
                    >= meeting_segments.logical_start_anchor
                AND (
                    meeting_segments.logical_end_anchor IS NULL
                    OR occurrence_override.original_logical_anchor
                        <= meeting_segments.logical_end_anchor
                )
                AND CAST(
                    julianday(occurrence_override.original_logical_anchor)
                    - julianday(meeting_segments.logical_start_anchor)
                    AS INTEGER
                ) % 7 = 0
            GROUP BY
                occurrence_override.meeting_series_id,
                occurrence_override.original_logical_anchor
            HAVING matching_segment_count <> 1
        )
    `);
    detachedOverrides.setReadBigInts(true);
    const detachedOverrideCount = (detachedOverrides.get() as { count: bigint }).count;
    const segmentlessSeries = database.prepare(`
        SELECT count(*) AS count
        FROM meeting_series
        WHERE NOT EXISTS (
            SELECT 1
            FROM meeting_segments
            WHERE meeting_segments.meeting_series_id = meeting_series.meeting_series_id
        )
    `);
    segmentlessSeries.setReadBigInts(true);
    const segmentlessSeriesCount = (segmentlessSeries.get() as { count: bigint }).count;
    if (overlapCount !== 0n
        || detachedOverrideCount !== 0n
        || segmentlessSeriesCount !== 0n) {
        rejectSchema('database-corrupt');
    }
}

/**
 * Validates the one segment owned by every once-only Task series.
 * @param {DatabaseSync} database - Open CourseFlow database at schema level 8.
 * @return {void}
 */
export function validateLevel8TaskFacts(database: DatabaseSync): void {
    const segmentlessSeries = database.prepare(`
        SELECT count(*) AS count
        FROM task_series
        WHERE NOT EXISTS (
            SELECT 1
            FROM task_segments
            WHERE task_segments.task_series_id = task_series.task_series_id
        )
    `);
    segmentlessSeries.setReadBigInts(true);
    if ((segmentlessSeries.get() as { count: bigint }).count !== 0n) {
        rejectSchema('database-corrupt');
    }
}

/**
 * Derives the first and last LocalDate anchors of a canonical weekly Task rule.
 * @param {WeeklyTaskSchedule} schedule - Canonical weekly Task schedule.
 * @return {readonly [string, string] | null} Inclusive boundary anchors, or null when none exist.
 */
export function weeklyTaskBoundaryAnchors(schedule: WeeklyTaskSchedule): readonly [string, string] | null {
    const weekdayNumber = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].indexOf(schedule.weekday);
    const startTime = Date.parse(`${schedule.startDate}T00:00:00.000Z`);
    const endTime = Date.parse(`${schedule.confirmedEndDate}T00:00:00.000Z`);
    const startWeekday = new Date(startTime).getUTCDay();
    const forwardDays = (weekdayNumber - startWeekday + 7) % 7;
    const firstTime = startTime + forwardDays * 86_400_000;
    if (firstTime > endTime) {
        return null;
    }
    const endWeekday = new Date(endTime).getUTCDay();
    const backwardDays = (endWeekday - weekdayNumber + 7) % 7;
    const lastTime = endTime - backwardDays * 86_400_000;
    return [
        new Date(firstTime).toISOString().slice(0, 10),
        new Date(lastTime).toISOString().slice(0, 10),
    ];
}

/**
 * Checks the retained Task occurrence-anchor identity encoding.
 * @param {unknown} anchor - Candidate once marker or LocalDate anchor.
 * @return {boolean} Whether the anchor is canonical.
 */
export function isCanonicalTaskAnchor(anchor: unknown): boolean {
    if (anchor === 'once') {
        return true;
    }
    if (typeof anchor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(anchor)) {
        return false;
    }
    const timestamp = Date.parse(`${anchor}T00:00:00.000Z`);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === anchor;
}

/**
 * Verifies every retained weekly Task rule and its unsupported occurrence-state boundary.
 * @param {DatabaseSync} database - Open CourseFlow database at schema level 9.
 * @return {void}
 */
export function validateLevel9TaskFacts(database: DatabaseSync, rejectWeeklyOccurrenceStates = true): void {
    const weeklyTasks = database.prepare(`
        SELECT
            weekly_start_date,
            weekly_weekday,
            weekly_local_deadline_time,
            weekly_confirmed_end_date,
            follow_teaching_week,
            terms.time_zone
        FROM task_segments
        JOIN task_series ON task_series.task_series_id = task_segments.task_series_id
        JOIN courses ON courses.course_id = task_series.course_id
        JOIN terms ON terms.term_id = courses.term_id
        WHERE schedule_kind = 'weekly'
    `).all() as Array<{
        weekly_start_date: unknown;
        weekly_weekday: unknown;
        weekly_local_deadline_time: unknown;
        weekly_confirmed_end_date: unknown;
        follow_teaching_week: unknown;
        time_zone: unknown;
    }>;
    for (const task of weeklyTasks) {
        const followTeachingWeek = task.follow_teaching_week === 1 || task.follow_teaching_week === 1n
            ? true
            : task.follow_teaching_week === 0 || task.follow_teaching_week === 0n
                ? false
                : null;
        const schedule = followTeachingWeek === null
            ? null
            : normalizeTaskSchedule({
                kind: 'weekly',
                startDate: task.weekly_start_date,
                weekday: task.weekly_weekday,
                localDeadlineTime: task.weekly_local_deadline_time,
                confirmedEndDate: task.weekly_confirmed_end_date,
                followTeachingWeek,
            });
        const termZone = task.time_zone;
        if (schedule?.kind !== 'weekly' || typeof termZone !== 'string') {
            rejectSchema('database-corrupt');
        }
        const boundaryAnchors = weeklyTaskBoundaryAnchors(schedule);
        if (boundaryAnchors === null) {
            rejectSchema('database-corrupt');
        }
        let canonicalTermZone: string;
        let boundaryInstants: string[];
        try {
            canonicalTermZone = new Intl.DateTimeFormat('en-CA', { timeZone: termZone })
                .resolvedOptions()
                .timeZone;
            boundaryInstants = boundaryAnchors.map(anchor => INTL_ZONE_RULES.resolveInstant(
                termZone,
                anchor,
                schedule.localDeadlineTime,
            ));
        }
        catch {
            rejectSchema('database-corrupt');
        }
        if (canonicalTermZone !== termZone || !boundaryInstants.every(isCanonicalInstant)) {
            rejectSchema('database-corrupt');
        }
    }

    const outsideCourseRange = database.prepare(`
        SELECT count(*) AS count
        FROM task_segments
        JOIN task_series ON task_series.task_series_id = task_segments.task_series_id
        JOIN courses ON courses.course_id = task_series.course_id
        JOIN terms ON terms.term_id = courses.term_id
        WHERE task_segments.schedule_kind = 'weekly'
            AND (
                task_segments.weekly_start_date < CASE courses.teaching_range_kind
                    WHEN 'inherit-term' THEN terms.start_date
                    ELSE courses.teaching_start_date
                END
                OR task_segments.weekly_confirmed_end_date > CASE courses.teaching_range_kind
                    WHEN 'inherit-term' THEN terms.end_date
                    ELSE courses.teaching_end_date
                END
            )
    `);
    outsideCourseRange.setReadBigInts(true);
    const weeklyOccurrenceStates = database.prepare(`
        SELECT count(*) AS count
        FROM task_occurrence_states
        JOIN task_segments ON task_segments.task_series_id = task_occurrence_states.task_series_id
        WHERE task_segments.schedule_kind = 'weekly'
    `);
    weeklyOccurrenceStates.setReadBigInts(true);
    if ((outsideCourseRange.get() as { count: bigint }).count !== 0n
        || (rejectWeeklyOccurrenceStates
            && (weeklyOccurrenceStates.get() as { count: bigint }).count !== 0n)) {
        rejectSchema('database-corrupt');
    }
}

/**
 * Validates level 10 Task anchors without consulting holiday visibility projections.
 * @param {DatabaseSync} database - Open CourseFlow database at schema level 10.
 * @return {void}
 */
export function validateLevel10TaskFacts(database: DatabaseSync): void {
    validateLevel9TaskFacts(database, false);

    const anchors = database.prepare(`
        SELECT logical_start_anchor AS anchor FROM task_segments
        UNION ALL SELECT logical_end_anchor FROM task_segments
        UNION ALL SELECT original_logical_anchor FROM task_occurrence_overrides
        UNION ALL SELECT original_logical_anchor FROM task_occurrence_states
        UNION ALL SELECT original_logical_anchor FROM task_state_history
    `).all() as Array<{ anchor: unknown }>;
    if (!anchors.every(row => isCanonicalTaskAnchor(row.anchor))) {
        rejectSchema('database-corrupt');
    }

    const overlappingSegments = database.prepare(`
        SELECT count(*) AS count
        FROM task_segments AS first_segment
        JOIN task_segments AS second_segment
            ON second_segment.task_series_id = first_segment.task_series_id
            AND second_segment.task_segment_id > first_segment.task_segment_id
            AND first_segment.schedule_kind = 'weekly'
            AND second_segment.schedule_kind = 'weekly'
            AND first_segment.logical_start_anchor <= second_segment.logical_end_anchor
            AND second_segment.logical_start_anchor <= first_segment.logical_end_anchor
    `);
    overlappingSegments.setReadBigInts(true);
    if ((overlappingSegments.get() as { count: bigint }).count !== 0n) {
        rejectSchema('database-corrupt');
    }

    const invalidStateHistory = database.prepare(`
        SELECT count(*) AS count
        FROM task_state_history AS history
        LEFT JOIN command_receipts AS receipt
            ON receipt.command_id = history.originating_command_id
        LEFT JOIN receipt_effects AS effect
            ON effect.command_id = history.originating_command_id
            AND effect.effect_order = 0
        LEFT JOIN task_series AS series
            ON series.task_series_id = history.task_series_id
        LEFT JOIN task_occurrence_states AS current_state
            ON current_state.task_series_id = history.task_series_id
            AND current_state.original_logical_anchor = history.original_logical_anchor
        WHERE receipt.command_id IS NULL
            OR receipt.result_kind <> 'committed'
            OR effect.command_id IS NULL
            OR effect.entity_kind <> 'task-series'
            OR effect.entity_id <> history.task_series_id
            OR effect.entity_version > series.entity_version
            OR NOT (
                (receipt.intent_kind = 'plan.set-task-occurrence-status'
                    AND receipt.intent_schema_version = 1
                    AND effect.effect_code = 'plan.task-occurrence-completed')
                OR (receipt.intent_kind = 'plan.set-task-occurrence-status'
                    AND receipt.intent_schema_version = 2
                    AND effect.effect_code = 'plan.task-occurrence-status-set')
                OR (receipt.intent_kind = 'plan.set-task-progress'
                    AND receipt.intent_schema_version = 1
                    AND effect.effect_code = 'plan.task-progress-set')
            )
            OR (
                SELECT count(*)
                FROM receipt_effects AS command_effect
                WHERE command_effect.command_id = history.originating_command_id
            ) <> 1
            OR (
                SELECT count(*)
                FROM durable_followups AS follow_up
                WHERE follow_up.originating_command_id = history.originating_command_id
                    AND follow_up.prerequisite_revision = receipt.committed_revision
            ) <> 1
            OR (history.before_row_present = 0 AND history.after_state_version <> 1)
            OR (history.before_row_present = 1 AND history.after_state_version <= 1)
            OR (history.consumed = 0 AND (
                current_state.task_series_id IS NULL
                OR current_state.entity_version < history.after_state_version
            ))
            OR (history.consumed = 1 AND history.before_row_present = 1 AND (
                current_state.task_series_id IS NULL
                OR current_state.entity_version <= history.after_state_version
            ))
    `);
    invalidStateHistory.setReadBigInts(true);
    if ((invalidStateHistory.get() as { count: bigint }).count !== 0n) {
        rejectSchema('database-corrupt');
    }
}

/**
 * Validates the configured BackupSet against its durable command receipt.
 * @param {DatabaseSync} database - Open CourseFlow database at schema level 12.
 * @return {void}
 */
export function validateLevel12ProtectionFacts(database: DatabaseSync): void {
    const configurationCount = database.prepare(
        'SELECT count(*) AS count FROM backup_configuration',
    );
    configurationCount.setReadBigInts(true);
    if ((configurationCount.get() as { count: bigint }).count !== 1n) {
        rejectSchema('database-corrupt');
    }
    const invalidConfiguration = database.prepare(`
        SELECT count(*) AS count
        FROM backup_configuration AS configuration
        LEFT JOIN command_receipts AS receipt
            ON receipt.command_id = configuration.originating_command_id
        LEFT JOIN receipt_effects AS effect
            ON effect.command_id = configuration.originating_command_id
            AND effect.effect_order = 0
        WHERE configuration.singleton = 1
            AND configuration.backup_set_id IS NOT NULL
            AND (
                receipt.command_id IS NULL
                OR receipt.intent_kind <> 'protect.configure-backup-destination'
                OR receipt.intent_schema_version <> 1
                OR receipt.result_kind <> 'committed'
                OR receipt.committed_revision <> configuration.configured_revision
                OR effect.effect_code <> 'protect.backup-destination-configured'
                OR effect.entity_kind <> 'backup-configuration'
                OR effect.entity_id <> configuration.backup_set_id
                OR effect.entity_version <> configuration.configuration_version
                OR (
                    SELECT count(*)
                    FROM receipt_effects AS command_effect
                    WHERE command_effect.command_id = configuration.originating_command_id
                ) <> 1
                OR (
                    SELECT count(*)
                    FROM durable_followups AS follow_up
                    WHERE follow_up.originating_command_id = configuration.originating_command_id
                        AND follow_up.prerequisite_revision = receipt.committed_revision
                ) <> 1
            )
    `);
    invalidConfiguration.setReadBigInts(true);
    if ((invalidConfiguration.get() as { count: bigint }).count !== 0n) {
        rejectSchema('database-corrupt');
    }
}

/**
 * Validates durable backup operations, completed follow-ups, and immutable success facts.
 * @param {DatabaseSync} database - Open CourseFlow database at schema level 13.
 * @return {void}
 */
export function validateLevel13ProtectionFacts(database: DatabaseSync): void {
    const watermarks = database.prepare(`
        SELECT backup_needed_through, backup_succeeded_through
        FROM protection_watermarks
        WHERE singleton = 1
    `);
    watermarks.setReadBigInts(true);
    const watermark = watermarks.get() as {
        backup_needed_through: bigint;
        backup_succeeded_through: bigint;
    };
    const followUps = database.prepare(`
        SELECT prerequisite_revision, state, follow_up_version
        FROM durable_followups
    `);
    followUps.setReadBigInts(true);
    const followUpRows = followUps.all() as Array<{
        prerequisite_revision: bigint;
        state: 'pending' | 'completed';
        follow_up_version: bigint;
    }>;
    if (followUpRows.some(row => (row.state === 'pending'
        && (row.follow_up_version !== 0n
            || row.prerequisite_revision <= watermark.backup_succeeded_through))
        || (row.state === 'completed'
            && (row.follow_up_version !== 1n
                || row.prerequisite_revision > watermark.backup_succeeded_through)))) {
        rejectSchema('database-corrupt');
    }

    const operations = database.prepare(`
        SELECT
            operation.operation_id,
            operation.backup_set_id,
            operation.backup_sequence,
            operation.snapshot_id,
            operation.target_revision,
            operation.actual_revision,
            operation.staging_directory_name,
            operation.created_at,
            operation.phase,
            snapshot.operation_id AS snapshot_operation_id,
            snapshot.backup_set_id AS snapshot_backup_set_id,
            snapshot.backup_sequence AS snapshot_backup_sequence,
            snapshot.snapshot_id AS registered_snapshot_id,
            snapshot.actual_revision AS snapshot_actual_revision,
            snapshot.succeeded_at
        FROM backup_operations AS operation
        LEFT JOIN backup_snapshots AS snapshot
            ON snapshot.operation_id = operation.operation_id
        JOIN backup_configuration AS configuration ON configuration.singleton = 1
    `);
    operations.setReadBigInts(true);
    const operationRows = operations.all() as Array<{
        operation_id: string;
        backup_set_id: string;
        backup_sequence: bigint;
        snapshot_id: string;
        target_revision: bigint;
        actual_revision: bigint | null;
        staging_directory_name: string;
        created_at: string;
        phase: string;
        snapshot_operation_id: string | null;
        snapshot_backup_set_id: string | null;
        snapshot_backup_sequence: bigint | null;
        registered_snapshot_id: string | null;
        snapshot_actual_revision: bigint | null;
        succeeded_at: string | null;
    }>;
    const configuration = database.prepare(
        'SELECT backup_set_id FROM backup_configuration WHERE singleton = 1',
    ).get() as {backup_set_id: string | null};
    const activeOperationCount = operationRows.filter(row => row.phase !== 'succeeded').length;
    if (activeOperationCount > 1 || operationRows.some(row => {
        const expectedStagingPrefix = `.staging-${row.operation_id}-`;
        const stagingNonce = row.staging_directory_name.slice(expectedStagingPrefix.length);
        const hasCheckpoint = row.phase !== 'queued';
        const succeeded = row.phase === 'succeeded';
        return configuration.backup_set_id === null
            || row.backup_set_id !== configuration.backup_set_id
            || row.target_revision > watermark.backup_needed_through
            || !isCanonicalInstant(row.created_at)
            || !row.staging_directory_name.startsWith(expectedStagingPrefix)
            || !/^[0-9a-f]{16}$/.test(stagingNonce)
            || hasCheckpoint !== (row.actual_revision !== null)
            || succeeded !== (row.snapshot_operation_id !== null)
            || (succeeded && (
                row.snapshot_backup_set_id !== row.backup_set_id
                || row.snapshot_backup_sequence !== row.backup_sequence
                || row.registered_snapshot_id !== row.snapshot_id
                || row.snapshot_actual_revision !== row.actual_revision
                || row.actual_revision! > watermark.backup_succeeded_through
                || row.succeeded_at === null
                || !isCanonicalInstant(row.succeeded_at)
            ));
    })) {
        rejectSchema('database-corrupt');
    }
}

/**
 * Validates the one resumable retention cleanup against its registered snapshot.
 * @param {DatabaseSync} database - Open CourseFlow database at schema level 14.
 * @return {void}
 */
export function validateLevel14ProtectionFacts(database: DatabaseSync): void {
    const statement = database.prepare(`
        SELECT
            cleanup.operation_id,
            cleanup.backup_set_id,
            cleanup.snapshot_id,
            cleanup.backup_sequence,
            cleanup.root_digest,
            cleanup.snapshot_directory_name,
            cleanup.quarantine_directory_name,
            cleanup.phase,
            cleanup.operation_version,
            snapshot.operation_id AS snapshot_operation_id,
            snapshot.backup_set_id AS snapshot_backup_set_id,
            snapshot.backup_sequence AS snapshot_backup_sequence,
            snapshot.root_digest AS snapshot_root_digest,
            operation.phase AS backup_operation_phase,
            configuration.backup_set_id AS configured_backup_set_id,
            (
                SELECT count(*)
                FROM backup_snapshots AS newer
                WHERE newer.backup_set_id = cleanup.backup_set_id
                    AND newer.backup_sequence > cleanup.backup_sequence
            ) AS newer_snapshot_count
        FROM backup_cleanup_operations AS cleanup
        LEFT JOIN backup_snapshots AS snapshot
            ON snapshot.snapshot_id = cleanup.snapshot_id
        LEFT JOIN backup_operations AS operation
            ON operation.operation_id = snapshot.operation_id
        JOIN backup_configuration AS configuration ON configuration.singleton = 1
        WHERE cleanup.singleton = 1
    `);
    statement.setReadBigInts(true);
    const row = statement.get() as {
        operation_id: string;
        backup_set_id: string;
        snapshot_id: string;
        backup_sequence: bigint;
        root_digest: string;
        snapshot_directory_name: string;
        quarantine_directory_name: string;
        phase: 'planned' | 'quarantined' | 'deleting';
        operation_version: bigint;
        snapshot_operation_id: string | null;
        snapshot_backup_set_id: string | null;
        snapshot_backup_sequence: bigint | null;
        snapshot_root_digest: string | null;
        backup_operation_phase: string | null;
        configured_backup_set_id: string | null;
        newer_snapshot_count: bigint;
    } | undefined;
    if (!row) {
        return;
    }
    if (row.backup_set_id !== row.configured_backup_set_id
        || row.snapshot_backup_set_id !== row.backup_set_id
        || row.snapshot_backup_sequence !== row.backup_sequence
        || row.snapshot_root_digest !== row.root_digest
        || row.snapshot_operation_id === null
        || row.backup_operation_phase !== 'succeeded'
        || row.newer_snapshot_count < 2n
        || row.snapshot_directory_name !== `snapshot-${row.snapshot_id}`
        || row.quarantine_directory_name
            !== `.quarantine-${row.operation_id}-${row.snapshot_id}`
        || (row.phase === 'planned' && row.operation_version !== 0n)
        || (row.phase === 'quarantined' && row.operation_version !== 1n)
        || (row.phase === 'deleting' && row.operation_version !== 2n)) {
        rejectSchema('database-corrupt');
    }
}

/**
 * Validates typed pre-checkpoint RestoreSession facts and their idempotent receipts.
 * @param {DatabaseSync} database - Open CourseFlow database at schema level 15.
 * @return {void}
 */
export function validateLevel15RestoreFacts(database: DatabaseSync, allowCancelled: boolean): void {
    const sessions = database.prepare(`
        SELECT
            session.restore_session_id,
            session.current_workspace_id,
            session.current_revision,
            session.phase,
            session.session_version,
            session.safety_protected_revision,
            workspace.workspace_id,
            workspace.revision,
            (
                SELECT count(*)
                FROM restore_command_receipts AS receipt
                WHERE receipt.restore_session_id = session.restore_session_id
                    AND receipt.command_kind = 'start'
                    AND receipt.result_session_version = 0
            ) AS start_receipt_count,
            (
                SELECT count(*)
                FROM restore_command_receipts AS receipt
                WHERE receipt.restore_session_id = session.restore_session_id
                    AND receipt.command_kind = 'confirm'
                    AND receipt.result_session_version = 1
            ) AS confirm_receipt_count,
            (
                SELECT count(*)
                FROM restore_command_receipts AS receipt
                WHERE receipt.restore_session_id = session.restore_session_id
                    AND receipt.command_kind = 'cancel'
                    AND receipt.result_session_version = session.session_version
            ) AS cancel_receipt_count,
            (
                SELECT count(*)
                FROM restore_command_receipts AS receipt
                WHERE receipt.restore_session_id = session.restore_session_id
            ) AS receipt_count
        FROM restore_sessions AS session
        JOIN workspace_state AS workspace ON workspace.singleton = 1
    `);
    sessions.setReadBigInts(true);
    const rows = sessions.all() as Array<{
        restore_session_id: string;
        current_workspace_id: string;
        current_revision: bigint;
        phase: 'previewed' | 'waiting-decision' | 'protection-established' | 'cancelled';
        session_version: bigint;
        safety_protected_revision: bigint | null;
        workspace_id: string;
        revision: bigint;
        start_receipt_count: bigint;
        confirm_receipt_count: bigint;
        cancel_receipt_count: bigint;
        receipt_count: bigint;
    }>;
    if (rows.some(row => row.current_workspace_id !== row.workspace_id
        || row.current_revision > row.revision
        || row.start_receipt_count !== 1n
        || (!allowCancelled && row.phase === 'cancelled')
        || (row.phase === 'previewed'
            && (row.session_version !== 0n
                || row.confirm_receipt_count !== 0n
                || row.cancel_receipt_count !== 0n
                || row.receipt_count !== 1n))
        || ((row.phase === 'waiting-decision' || row.phase === 'protection-established')
            && (row.session_version !== 1n
                || row.confirm_receipt_count !== 1n
                || row.cancel_receipt_count !== 0n
                || row.receipt_count !== 2n))
        || (row.phase === 'cancelled'
            && (row.cancel_receipt_count !== 1n
                || (row.session_version === 1n
                    ? row.confirm_receipt_count !== 0n || row.receipt_count !== 2n
                    : row.session_version !== 2n
                        || row.confirm_receipt_count !== 1n
                        || row.receipt_count !== 3n)))
        || (row.phase === 'protection-established'
            && row.safety_protected_revision !== row.current_revision))) {
        rejectSchema('database-corrupt');
    }
}

export function validateSchema(database: DatabaseSync, level: SchemaLevel): SchemaFacts {
    if (pragmaValue(database, 'application_id', 'application_id') !== COURSEFLOW_APPLICATION_ID
        || pragmaValue(database, 'user_version', 'user_version') !== level) {
        rejectSchema();
    }

    validateTables(database, level);
    for (const table of tableNames(level)) {
        validateColumnsAndForeignKeys(database, table, level);
        validateIndexes(database, table, level);
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
    if (level >= 5) {
        validateLevel5MeetingFacts(database);
    }
    if (level >= 8) {
        validateLevel8TaskFacts(database);
    }
    if (level === 9) {
        validateLevel9TaskFacts(database);
    }
    if (level >= 10) {
        validateLevel10TaskFacts(database);
    }
    if (level >= 12) {
        validateLevel12ProtectionFacts(database);
    }
    if (level >= 13) {
        validateLevel13ProtectionFacts(database);
    }
    if (level >= 14) {
        validateLevel14ProtectionFacts(database);
    }
    if (level >= 15) {
        validateLevel15RestoreFacts(database, level >= 16);
    }

    return validateBootstrapFacts(database, level);
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

/**
 * Validates exact level 5 structure and cross-row Meeting facts.
 * @param {DatabaseSync} database - Open database to validate without mutation.
 * @return {SchemaFacts} Validated bootstrap identity and revision facts.
 */
export function validateSchemaLevel5(database: DatabaseSync): SchemaFacts {
    return validateSchema(database, 5);
}

/**
 * Validates exact level 6 structure and cross-row Meeting facts.
 * @param {DatabaseSync} database - Open database to validate without mutation.
 * @return {SchemaFacts} Validated bootstrap identity and revision facts.
 */
export function validateSchemaLevel6(database: DatabaseSync): SchemaFacts {
    return validateSchema(database, 6);
}

/**
 * Validates exact level 7 HolidayRange and Meeting facts.
 * @param {DatabaseSync} database - Open database to validate without mutation.
 * @return {SchemaFacts} Validated bootstrap identity and revision facts.
 */
export function validateSchemaLevel7(database: DatabaseSync): SchemaFacts {
    return validateSchema(database, 7);
}

/**
 * Validates exact level 8 once-only Task storage and existing PLAN facts.
 * @param {DatabaseSync} database - Open database to validate without mutation.
 * @return {SchemaFacts} Validated bootstrap identity and revision facts.
 */
export function validateSchemaLevel8(database: DatabaseSync): SchemaFacts {
    return validateSchema(database, 8);
}

/**
 * Validates exact level 9 weekly Task rules and existing PLAN facts.
 * @param {DatabaseSync} database - Open database to validate without mutation.
 * @return {SchemaFacts} Validated bootstrap identity and revision facts.
 */
export function validateSchemaLevel9(database: DatabaseSync): SchemaFacts {
    return validateSchema(database, 9);
}

/**
 * Validates exact level 10 Task occurrence and one-time Undo facts.
 * @param {DatabaseSync} database - Open database to validate without mutation.
 * @return {SchemaFacts} Validated bootstrap identity and revision facts.
 */
export function validateSchemaLevel10(database: DatabaseSync): SchemaFacts {
    return validateSchema(database, 10);
}

/**
 * Validates the level 11 setup milestone and draft-checkpoint storage.
 * @param {DatabaseSync} database - Open database to validate without mutation.
 * @return {SchemaFacts} Validated bootstrap identity and revision facts.
 */
export function validateSchemaLevel11(database: DatabaseSync): SchemaFacts {
    return validateSchema(database, 11);
}

/**
 * Validates level 12 PROTECT configuration and existing formal facts.
 * @param {DatabaseSync} database - Open database to validate without mutation.
 * @return {SchemaFacts} Validated bootstrap identity and revision facts.
 */
export function validateSchemaLevel12(database: DatabaseSync): SchemaFacts {
    return validateSchema(database, 12);
}

/**
 * Validates level 13 durable backup work and immutable success registration.
 * @param {DatabaseSync} database - Open database to validate without mutation.
 * @return {SchemaFacts} Validated bootstrap identity and revision facts.
 */
export function validateSchemaLevel13(database: DatabaseSync): SchemaFacts {
    return validateSchema(database, 13);
}

/**
 * Validates level 14 durable backup retention and all earlier formal facts.
 * @param {DatabaseSync} database - Open database to validate without mutation.
 * @return {SchemaFacts} Validated bootstrap identity and revision facts.
 */
export function validateSchemaLevel14(database: DatabaseSync): SchemaFacts {
    return validateSchema(database, 14);
}

/**
 * Validates the current level 15 schema and typed RestoreSession closure.
 * @param {DatabaseSync} database - Open database to validate without mutation.
 * @return {SchemaFacts} Validated bootstrap identity and revision facts.
 */
export function validateSchemaLevel15(database: DatabaseSync): SchemaFacts {
    return validateSchema(database, 15);
}

/**
 * Validates the current level 16 schema and Restore completion receipt storage.
 * @param {DatabaseSync} database - Open database to validate without mutation.
 * @return {SchemaFacts} Validated bootstrap identity and revision facts.
 */
export function validateSchemaLevel16(database: DatabaseSync): SchemaFacts {
    return validateSchema(database, 16);
}

/**
 * Validates the current level 17 schema, which only widens the receipt ledger.
 * @param {DatabaseSync} database - Opened workspace database.
 * @return {SchemaFacts} Validated bootstrap facts.
 */
export function validateSchemaLevel17(database: DatabaseSync): SchemaFacts {
    return validateSchema(database, 17);
}
