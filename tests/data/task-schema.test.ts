/**
 * @file Verifies once and weekly Task schema constraints and retained migrations.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
    COURSEFLOW_APPLICATION_ID,
    createSchemaLevel7,
    createSchemaLevel8,
    createSchemaLevel9,
    createSchemaLevel10,
    CURRENT_SCHEMA_LEVEL,
    migrateLevel7To8,
    migrateLevel9To10,
    migrateLevel10To11,
    migrateLevel11To12,
    migrateLevel12To13,
    migrateLevel13To14,
    migrateLevel14To15,
    migrateLevel15To16,
    SchemaValidationError,
    validateSchemaLevel8,
    validateSchemaLevel9,
    validateSchemaLevel10,
    validateSchemaLevel11,
    validateSchemaLevel16,
} from '../../src/data/schema';
import {
    openWorkspaceData,
    openWorkspaceDataWithMigrations as openWorkspaceDataWithMigrationsUnbound,
} from '../../src/data/sqlite-data-store';

const COURSE_ID = '22222222-2222-4222-8222-222222222222';
const TASK_SERIES_ID = '33333333-3333-4333-8333-333333333333';
const TASK_SEGMENT_ID = '44444444-4444-4444-8444-444444444444';
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const MIGRATION_SAFETY_COPY_BINDING = Object.freeze({
    createdByAppBuildId: 'development:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    rollbackTarget: Object.freeze({
        releaseVersion: '0.0.0-development-old',
        tag: 'development-old',
        appBuildId: 'development:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        artifacts: Object.freeze([
            Object.freeze({
                platform: 'darwin-arm64' as const,
                name: 'CourseFlow-0.0.0-development-old-macOS-arm64.dmg',
                sha256: 'c'.repeat(64),
            }),
            Object.freeze({
                platform: 'win32-x64' as const,
                name: 'CourseFlow-0.0.0-development-old-Windows-x64.msi',
                sha256: 'd'.repeat(64),
            }),
        ] as const),
    }),
    clock: Object.freeze({now: () => '2026-08-27T12:00:00.000Z'}),
});

/**
 * Opens an old test schema with an explicit exact development-build rollback binding.
 * @param {string} dataSlotsRoot - Isolated DATA slots root.
 * @param {Parameters<typeof openWorkspaceDataWithMigrationsUnbound>[1]} options - Migration controls.
 * @return {ReturnType<typeof openWorkspaceDataWithMigrationsUnbound>} Migration outcome promise.
 */
function openWorkspaceDataWithMigrations(
    dataSlotsRoot: string,
    options: Parameters<typeof openWorkspaceDataWithMigrationsUnbound>[1] = {},
): ReturnType<typeof openWorkspaceDataWithMigrationsUnbound> {
    return openWorkspaceDataWithMigrationsUnbound(dataSlotsRoot, {
        ...options,
        migrationSafetyCopy: MIGRATION_SAFETY_COPY_BINDING,
    });
}

/**
 * Inserts the minimal valid Workspace, Term, and Course parents for Task foreign keys.
 * @param {DatabaseSync} database - Open level 8 or 9 database.
 * @return {void}
 */
function insertTaskParents(database: DatabaseSync): void {
    database.exec(`
        INSERT INTO workspace_state (singleton, workspace_id, revision) VALUES (1, '${WORKSPACE_ID}', 0);
        INSERT INTO setup_state (singleton, last_decision, setup_decision_version, ever_reached_minimum)
            VALUES (1, NULL, 0, 0);
        INSERT INTO protection_watermarks (singleton, backup_needed_through, backup_succeeded_through)
            VALUES (1, 0, 0);
        INSERT INTO terms (term_id, name, start_date, end_date, time_zone, archived, entity_version)
            VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Fall 2026', '2026-09-01', '2026-12-20',
                'America/Toronto', 0, 1);
        INSERT INTO plan_state (singleton, current_term_id, plan_entity_version)
            VALUES (1, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1);
        INSERT INTO courses (
            course_id, term_id, code, name, section, instructor, color, credits_coefficient, credits_scale,
            teaching_range_kind, teaching_start_date, teaching_end_date, archived, entity_version
        ) VALUES (
            '${COURSE_ID}', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'CSC301', 'Software Engineering',
            NULL, NULL, NULL, NULL, NULL, 'inherit-term', NULL, NULL, 0, 1
        );
    `);
}

/**
 * Inserts a once-only Task segment with the given deadline union values.
 * @param {DatabaseSync} database - Open level 8 database.
 * @param {string} taskSeriesId - Stable Task series identity.
 * @param {string} taskSegmentId - Stable Task segment identity.
 * @param {'date-only' | 'timed' | 'tba'} deadlineKind - Explicit deadline discriminator.
 * @param {string | null} date - Date-only deadline value.
 * @param {string | null} instant - Timed deadline instant.
 * @param {string | null} zone - Timed deadline display zone.
 * @return {void}
 */
function insertOnceTask(
    database: DatabaseSync,
    taskSeriesId: string,
    taskSegmentId: string,
    deadlineKind: 'date-only' | 'timed' | 'tba',
    date: string | null,
    instant: string | null,
    zone: string | null,
): void {
    database.prepare(
        'INSERT INTO task_series (task_series_id, course_id, retired, entity_version) VALUES (?, ?, 0, 1)',
    ).run(taskSeriesId, COURSE_ID);
    database.prepare(`
        INSERT INTO task_segments (
            task_segment_id, task_series_id, title, task_size, schedule_kind, deadline_kind,
            deadline_date, deadline_instant, deadline_display_zone
        ) VALUES (?, ?, 'Assignment', 'small', 'once', ?, ?, ?, ?)
    `).run(taskSegmentId, taskSeriesId, deadlineKind, date, instant, zone);
}

/**
 * Creates a valid level 8 Workspace carrying every durable Task-adjacent record migrated at level 9.
 * @param {string} dataSlotsRoot - Temporary DATA slots root.
 * @return {void}
 */
function createLevel8WorkspaceWithTask(dataSlotsRoot: string): void {
    const activeDirectory = join(dataSlotsRoot, 'active');
    mkdirSync(activeDirectory);
    const database = new DatabaseSync(join(activeDirectory, 'workspace.sqlite'), {
        enableForeignKeyConstraints: true,
    });
    try {
        database.exec('BEGIN IMMEDIATE');
        database.exec(`PRAGMA application_id = ${COURSEFLOW_APPLICATION_ID}`);
        createSchemaLevel8(database);
        database.exec('PRAGMA user_version = 8');
        insertTaskParents(database);
        database.exec(`
            UPDATE workspace_state SET revision = 1 WHERE singleton = 1;
            UPDATE protection_watermarks SET backup_needed_through = 1 WHERE singleton = 1;
        `);
        insertOnceTask(
            database,
            TASK_SERIES_ID,
            TASK_SEGMENT_ID,
            'date-only',
            '2026-10-15',
            null,
            null,
        );
        database.prepare(`
            INSERT INTO task_occurrence_states (
                task_series_id, original_logical_anchor, status, entity_version
            ) VALUES (?, 'once', 'completed', 2)
        `).run(TASK_SERIES_ID);
        database.prepare(`
            INSERT INTO command_receipts (
                command_id, intent_kind, intent_schema_version, canonical_encoding, digest_algorithm,
                payload_digest, committed_revision, result_kind
            ) VALUES (?, 'plan.create-task-series', 1, 'courseflow-canonical-json-v1', 'sha256',
                zeroblob(32), 1, 'committed')
        `).run('55555555-5555-4555-8555-555555555555');
        database.prepare(`
            INSERT INTO receipt_effects (
                command_id, effect_order, effect_code, entity_kind, entity_id, entity_version
            ) VALUES (?, 0, 'plan.task-series-created', 'task-series', ?, 1)
        `).run('55555555-5555-4555-8555-555555555555', TASK_SERIES_ID);
        database.prepare(`
            INSERT INTO durable_followups (
                follow_up_id, originating_command_id, owner, kind, prerequisite_revision, state,
                follow_up_version
            ) VALUES (?, ?, 'protect', 'backup-needed-through', 1, 'pending', 0)
        `).run('66666666-6666-4666-8666-666666666666', '55555555-5555-4555-8555-555555555555');
        database.exec('COMMIT');
    }
    finally {
        database.close();
    }
}

/**
 * Creates a valid on-disk level 9 Workspace for level 10 migration interruption tests.
 * @param {string} dataSlotsRoot - Temporary DATA slots root.
 * @return {void}
 */
function createLevel9WorkspaceWithTask(dataSlotsRoot: string): void {
    const activeDirectory = join(dataSlotsRoot, 'active');
    mkdirSync(activeDirectory);
    const database = new DatabaseSync(join(activeDirectory, 'workspace.sqlite'), {
        enableForeignKeyConstraints: true,
    });
    try {
        database.exec('BEGIN IMMEDIATE');
        database.exec(`PRAGMA application_id = ${COURSEFLOW_APPLICATION_ID}`);
        createSchemaLevel9(database);
        database.exec('PRAGMA user_version = 9');
        insertTaskParents(database);
        insertOnceTask(
            database,
            TASK_SERIES_ID,
            TASK_SEGMENT_ID,
            'date-only',
            '2026-10-15',
            null,
            null,
        );
        database.prepare(`
            INSERT INTO task_occurrence_states (
                task_series_id, original_logical_anchor, status, entity_version
            ) VALUES (?, 'once', 'completed', 2)
        `).run(TASK_SERIES_ID);
        database.exec('COMMIT');
    }
    finally {
        database.close();
    }
}

/**
 * Verifies the exact level 8 facts that migration safety and rollback must retain.
 * @param {DatabaseSync} database - Read-only level 8 database.
 * @return {void}
 */
function assertLevel8TaskFacts(database: DatabaseSync): void {
    assert.equal(
        (database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
        8,
    );
    assert.deepEqual(validateSchemaLevel8(database), {
        workspaceId: WORKSPACE_ID,
        revision: 1n,
    });
    assert.deepEqual({ ...database.prepare(`
        SELECT schedule_kind, deadline_kind, deadline_date, deadline_instant, deadline_display_zone
        FROM task_segments WHERE task_series_id = ?
    `).get(TASK_SERIES_ID) }, {
        schedule_kind: 'once',
        deadline_kind: 'date-only',
        deadline_date: '2026-10-15',
        deadline_instant: null,
        deadline_display_zone: null,
    });
    assert.deepEqual({ ...database.prepare(`
        SELECT original_logical_anchor, status, entity_version
        FROM task_occurrence_states WHERE task_series_id = ?
    `).get(TASK_SERIES_ID) }, {
        original_logical_anchor: 'once',
        status: 'completed',
        entity_version: 2,
    });
    assert.deepEqual({ ...database.prepare(`
        SELECT
            intent_kind,
            intent_schema_version,
            canonical_encoding,
            digest_algorithm,
            hex(payload_digest) AS payload_digest,
            committed_revision,
            result_kind
        FROM command_receipts WHERE command_id = ?
    `).get('55555555-5555-4555-8555-555555555555') }, {
        intent_kind: 'plan.create-task-series',
        intent_schema_version: 1,
        canonical_encoding: 'courseflow-canonical-json-v1',
        digest_algorithm: 'sha256',
        payload_digest: '0000000000000000000000000000000000000000000000000000000000000000',
        committed_revision: 1,
        result_kind: 'committed',
    });
    assert.deepEqual({ ...database.prepare(`
        SELECT effect_order, effect_code, entity_kind, entity_id, entity_version
        FROM receipt_effects WHERE command_id = ?
    `).get('55555555-5555-4555-8555-555555555555') }, {
        effect_order: 0,
        effect_code: 'plan.task-series-created',
        entity_kind: 'task-series',
        entity_id: TASK_SERIES_ID,
        entity_version: 1,
    });
    assert.deepEqual({ ...database.prepare(`
        SELECT originating_command_id, owner, kind, prerequisite_revision, state, follow_up_version
        FROM durable_followups WHERE follow_up_id = ?
    `).get('66666666-6666-4666-8666-666666666666') }, {
        originating_command_id: '55555555-5555-4555-8555-555555555555',
        owner: 'protect',
        kind: 'backup-needed-through',
        prerequisite_revision: 1,
        state: 'pending',
        follow_up_version: 0,
    });
    assert.deepEqual({ ...database.prepare(`
        SELECT backup_needed_through, backup_succeeded_through
        FROM protection_watermarks WHERE singleton = 1
    `).get() }, {
        backup_needed_through: 1,
        backup_succeeded_through: 0,
    });
}

test('ADR-04: level 8 stores once-only Task facts with an exact deadline union', () => {
    const database = new DatabaseSync(':memory:', {
        enableForeignKeyConstraints: true,
        readBigInts: true,
    });
    try {
        database.exec(`PRAGMA application_id = ${COURSEFLOW_APPLICATION_ID}`);
        createSchemaLevel8(database);
        database.exec('PRAGMA user_version = 8');
        insertTaskParents(database);

        assert.equal(CURRENT_SCHEMA_LEVEL, 16);
        assert.equal(
            Number((database.prepare('PRAGMA user_version').get() as { user_version: bigint }).user_version),
            8,
        );
        const table = database.prepare("PRAGMA table_list('task_segments')").get() as {
            name: string;
            ncol: bigint;
            strict: bigint;
        };
        assert.equal(table.name, 'task_segments');
        assert.equal(table.ncol, 9n);
        assert.equal(table.strict, 1n);
        insertOnceTask(
            database,
            TASK_SERIES_ID,
            TASK_SEGMENT_ID,
            'date-only',
            '2026-10-15',
            null,
            null,
        );
        insertOnceTask(
            database,
            '55555555-5555-4555-8555-555555555555',
            '66666666-6666-4666-8666-666666666666',
            'timed',
            null,
            '2026-10-15T23:59:00.000Z',
            'America/Toronto',
        );
        insertOnceTask(
            database,
            '77777777-7777-4777-8777-777777777777',
            '88888888-8888-4888-8888-888888888888',
            'tba',
            null,
            null,
            null,
        );
        assert.throws(() => insertOnceTask(
            database,
            '99999999-9999-4999-8999-999999999999',
            'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            'date-only',
            '2026-10-15',
            '2026-10-15T23:59:00.000Z',
            null,
        ));
        assert.throws(() => database.prepare(`
            INSERT INTO task_occurrence_states (
                task_series_id, original_logical_anchor, status, entity_version
            ) VALUES (?, 'once', 'pending', 1)
        `).run(TASK_SERIES_ID));
        database.prepare(`
            INSERT INTO task_occurrence_states (
                task_series_id, original_logical_anchor, status, entity_version
            ) VALUES (?, 'once', 'completed', 1)
        `).run(TASK_SERIES_ID);
        assert.equal(
            (database.prepare('SELECT count(*) AS count FROM task_occurrence_states').get() as { count: bigint })
                .count,
            1n,
        );
    }
    finally {
        database.close();
    }
});

test('ADR-04/TEST-DATA-006: level 8 rejects a TaskSeries without its one segment', () => {
    const database = new DatabaseSync(':memory:', {
        enableForeignKeyConstraints: true,
    });
    try {
        database.exec(`PRAGMA application_id = ${COURSEFLOW_APPLICATION_ID}`);
        createSchemaLevel8(database);
        database.exec('PRAGMA user_version = 8');
        insertTaskParents(database);
        database.prepare(
            'INSERT INTO task_series (task_series_id, course_id, retired, entity_version) VALUES (?, ?, 0, 1)',
        ).run(TASK_SERIES_ID, COURSE_ID);

        assert.throws(
            () => validateSchemaLevel8(database),
            (error: unknown) => error instanceof SchemaValidationError
                && error.reason === 'database-corrupt',
        );
    }
    finally {
        database.close();
    }
});

test('ADR-04/TEST-DATA-006: level 7 Task migration commits atomically and validates after reopen', () => {
    const dataSlotsRoot = mkdtempSync(join(tmpdir(), 'courseflow-task-schema-'));
    const activeDirectory = join(dataSlotsRoot, 'active');
    const databasePath = join(activeDirectory, 'workspace.sqlite');
    mkdirSync(activeDirectory);
    try {
        const database = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true });
        try {
            database.exec('BEGIN IMMEDIATE');
            database.exec(`PRAGMA application_id = ${COURSEFLOW_APPLICATION_ID}`);
            createSchemaLevel7(database);
            database.exec(`
                INSERT INTO workspace_state (singleton, workspace_id, revision) VALUES (1, '${WORKSPACE_ID}', 0);
                INSERT INTO setup_state (singleton, last_decision, setup_decision_version, ever_reached_minimum)
                    VALUES (1, NULL, 0, 0);
                INSERT INTO protection_watermarks (singleton, backup_needed_through, backup_succeeded_through)
                    VALUES (1, 0, 0);
                INSERT INTO plan_state (singleton, current_term_id, plan_entity_version) VALUES (1, NULL, 0);
                PRAGMA user_version = 7;
                COMMIT;
            `);
            database.exec('BEGIN IMMEDIATE');
            migrateLevel7To8(database);
            database.exec('COMMIT');
        }
        finally {
            database.close();
        }

        const reopened = new DatabaseSync(databasePath, { readOnly: true });
        try {
            assert.equal(
                (reopened.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
                8,
            );
            assert.equal(
                (reopened.prepare('SELECT revision FROM workspace_state WHERE singleton = 1').get() as {
                    revision: number;
                }).revision,
                1,
            );
            assert.deepEqual(validateSchemaLevel8(reopened), {
                workspaceId: WORKSPACE_ID,
                revision: 1n,
            });
        }
        finally {
            reopened.close();
        }
    }
    finally {
        rmSync(dataSlotsRoot, { recursive: true, force: true });
    }
});

test('ADR-04: level 9 distinguishes weekly Task segments from once facts', () => {
    const database = new DatabaseSync(':memory:', {
        enableForeignKeyConstraints: true,
    });
    try {
        database.exec(`PRAGMA application_id = ${COURSEFLOW_APPLICATION_ID}`);
        createSchemaLevel9(database);
        database.exec('PRAGMA user_version = 9');
        insertTaskParents(database);

        assert.equal(CURRENT_SCHEMA_LEVEL, 16);
        insertOnceTask(
            database,
            TASK_SERIES_ID,
            TASK_SEGMENT_ID,
            'date-only',
            '2026-10-15',
            null,
            null,
        );
        database.prepare(`
            INSERT INTO task_series (task_series_id, course_id, retired, entity_version)
            VALUES (?, ?, 0, 1)
        `).run('55555555-5555-4555-8555-555555555555', COURSE_ID);
        database.prepare(`
            INSERT INTO task_segments (
                task_segment_id, task_series_id, title, task_size, schedule_kind, deadline_kind,
                deadline_date, deadline_instant, deadline_display_zone, weekly_start_date,
                weekly_weekday, weekly_local_deadline_time, weekly_confirmed_end_date, follow_teaching_week
            ) VALUES (?, ?, 'Weekly assignment', 'large', 'weekly', NULL, NULL, NULL, NULL,
                '2026-09-07', 'MON', '17:30', '2026-12-14', 1)
        `).run('66666666-6666-4666-8666-666666666666', '55555555-5555-4555-8555-555555555555');
        database.prepare(`
            INSERT INTO task_series (task_series_id, course_id, retired, entity_version)
            VALUES (?, ?, 0, 1)
        `).run('77777777-7777-4777-8777-777777777777', COURSE_ID);
        assert.throws(() => database.prepare(`
            INSERT INTO task_segments (
                task_segment_id, task_series_id, title, task_size, schedule_kind, deadline_kind,
                deadline_date, deadline_instant, deadline_display_zone, weekly_start_date,
                weekly_weekday, weekly_local_deadline_time, weekly_confirmed_end_date, follow_teaching_week
            ) VALUES (?, ?, 'Invalid weekly', 'small', 'weekly', 'tba', NULL, NULL, NULL,
                '2026-09-07', 'MON', '17:30', '2026-12-14', 0)
        `).run('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', '77777777-7777-4777-8777-777777777777'));
        database.prepare(`
            INSERT INTO task_series (task_series_id, course_id, retired, entity_version)
            VALUES (?, ?, 0, 1)
        `).run('88888888-8888-4888-8888-888888888888', COURSE_ID);
        assert.throws(() => database.prepare(`
            INSERT INTO task_segments (
                task_segment_id, task_series_id, title, task_size, schedule_kind, deadline_kind,
                deadline_date, deadline_instant, deadline_display_zone, weekly_start_date,
                weekly_weekday, weekly_local_deadline_time, weekly_confirmed_end_date, follow_teaching_week
            ) VALUES (?, ?, 'Invalid time', 'small', 'weekly', NULL, NULL, NULL, NULL,
                '2026-09-07', 'MON', '24:00', '2026-12-14', 0)
        `).run('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '88888888-8888-4888-8888-888888888888'));
        database.prepare(`
            INSERT INTO task_series (task_series_id, course_id, retired, entity_version)
            VALUES (?, ?, 0, 1)
        `).run('99999999-9999-4999-8999-999999999999', COURSE_ID);
        assert.throws(() => database.prepare(`
            INSERT INTO task_segments (
                task_segment_id, task_series_id, title, task_size, schedule_kind, deadline_kind,
                deadline_date, deadline_instant, deadline_display_zone
            ) VALUES (?, ?, 'Missing deadline kind', 'small', 'once', NULL, NULL, NULL, NULL)
        `).run('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '99999999-9999-4999-8999-999999999999'));
        database.prepare(`
            INSERT INTO task_series (task_series_id, course_id, retired, entity_version)
            VALUES (?, ?, 0, 1)
        `).run('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', COURSE_ID);
        assert.throws(() => database.prepare(`
            INSERT INTO task_segments (
                task_segment_id, task_series_id, title, task_size, schedule_kind, deadline_kind,
                deadline_date, deadline_instant, deadline_display_zone, weekly_start_date,
                weekly_weekday, weekly_local_deadline_time, weekly_confirmed_end_date, follow_teaching_week
            ) VALUES (?, ?, 'Malformed time', 'small', 'weekly', NULL, NULL, NULL, NULL,
                '2026-09-07', 'MON', '12::0', '2026-12-14', 0)
        `).run('ffffffff-ffff-4fff-8fff-ffffffffffff', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'));
        database.prepare(`
            INSERT INTO command_receipts (
                command_id, intent_kind, intent_schema_version, canonical_encoding, digest_algorithm,
                payload_digest, committed_revision, result_kind
            ) VALUES (?, 'plan.create-task-series', 2, 'courseflow-canonical-json-v1', 'sha256',
                zeroblob(32), 1, 'committed')
        `).run('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
        database.prepare(`
            INSERT INTO command_receipts (
                command_id, intent_kind, intent_schema_version, canonical_encoding, digest_algorithm,
                payload_digest, committed_revision, result_kind
            ) VALUES (?, 'plan.update-task-series', 2, 'courseflow-canonical-json-v1', 'sha256',
                zeroblob(32), 1, 'committed')
        `).run('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    }
    finally {
        database.close();
    }
});

test('ADR-04: level 9 rejects a weekly Task outside its Course teaching range', () => {
    const database = new DatabaseSync(':memory:', {
        enableForeignKeyConstraints: true,
    });
    try {
        database.exec(`PRAGMA application_id = ${COURSEFLOW_APPLICATION_ID}`);
        createSchemaLevel9(database);
        database.exec('PRAGMA user_version = 9');
        insertTaskParents(database);
        assert.deepEqual(validateSchemaLevel9(database), {
            workspaceId: WORKSPACE_ID,
            revision: 0n,
        });
        database.exec(`
            UPDATE courses
            SET teaching_range_kind = 'explicit',
                teaching_start_date = '2026-09-15',
                teaching_end_date = '2026-11-30'
            WHERE course_id = '${COURSE_ID}'
        `);
        database.prepare(`
            INSERT INTO task_series (task_series_id, course_id, retired, entity_version)
            VALUES (?, ?, 0, 1)
        `).run(TASK_SERIES_ID, COURSE_ID);
        database.prepare(`
            INSERT INTO task_segments (
                task_segment_id, task_series_id, title, task_size, schedule_kind, deadline_kind,
                deadline_date, deadline_instant, deadline_display_zone, weekly_start_date,
                weekly_weekday, weekly_local_deadline_time, weekly_confirmed_end_date, follow_teaching_week
            ) VALUES (?, ?, 'Out of range', 'small', 'weekly', NULL, NULL, NULL, NULL,
                '2026-09-08', 'TUE', '09:00', '2026-12-01', 1)
        `).run(TASK_SEGMENT_ID, TASK_SERIES_ID);

        assert.throws(
            () => validateSchemaLevel9(database),
            (error: unknown) => error instanceof SchemaValidationError
                && error.reason === 'database-corrupt',
        );
    }
    finally {
        database.close();
    }
});

test('ADR-04: level 9 rejects non-canonical or occurrence-free weekly Task rules', () => {
    const corruptFacts = [
        {
            name: 'non-canonical LocalDate',
            startDate: '2026-09-31',
            endDate: '2026-09-31',
            weekday: 'MON',
            termEndDate: '2026-12-20',
        },
        {
            name: 'no matching weekday',
            startDate: '2026-09-01',
            endDate: '2026-09-01',
            weekday: 'SUN',
            termEndDate: '2026-09-01',
        },
    ] as const;

    for (const facts of corruptFacts) {
        const database = new DatabaseSync(':memory:', {
            enableForeignKeyConstraints: true,
        });
        try {
            database.exec(`PRAGMA application_id = ${COURSEFLOW_APPLICATION_ID}`);
            createSchemaLevel9(database);
            database.exec('PRAGMA user_version = 9');
            insertTaskParents(database);
            database.prepare('UPDATE terms SET end_date = ?').run(facts.termEndDate);
            database.prepare(`
                INSERT INTO task_series (task_series_id, course_id, retired, entity_version)
                VALUES (?, ?, 0, 1)
            `).run(TASK_SERIES_ID, COURSE_ID);
            database.prepare(`
                INSERT INTO task_segments (
                    task_segment_id, task_series_id, title, task_size, schedule_kind, deadline_kind,
                    deadline_date, deadline_instant, deadline_display_zone, weekly_start_date,
                    weekly_weekday, weekly_local_deadline_time, weekly_confirmed_end_date,
                    follow_teaching_week
                ) VALUES (?, ?, 'Corrupt weekly', 'small', 'weekly', NULL, NULL, NULL, NULL,
                    ?, ?, '09:00', ?, 1)
            `).run(
                TASK_SEGMENT_ID,
                TASK_SERIES_ID,
                facts.startDate,
                facts.weekday,
                facts.endDate,
            );

            assert.throws(
                () => validateSchemaLevel9(database),
                (error: unknown) => error instanceof SchemaValidationError
                    && error.reason === 'database-corrupt',
                facts.name,
            );
        }
        finally {
            database.close();
        }
    }
});

test('ADR-04: level 9 rejects occurrence state attached to any weekly Task', () => {
    const database = new DatabaseSync(':memory:', {
        enableForeignKeyConstraints: true,
    });
    try {
        database.exec(`PRAGMA application_id = ${COURSEFLOW_APPLICATION_ID}`);
        createSchemaLevel9(database);
        database.exec('PRAGMA user_version = 9');
        insertTaskParents(database);
        database.prepare(`
            INSERT INTO task_series (task_series_id, course_id, retired, entity_version)
            VALUES (?, ?, 1, 1)
        `).run(TASK_SERIES_ID, COURSE_ID);
        database.prepare(`
            INSERT INTO task_segments (
                task_segment_id, task_series_id, title, task_size, schedule_kind, deadline_kind,
                deadline_date, deadline_instant, deadline_display_zone, weekly_start_date,
                weekly_weekday, weekly_local_deadline_time, weekly_confirmed_end_date, follow_teaching_week
            ) VALUES (?, ?, 'Retired weekly', 'small', 'weekly', NULL, NULL, NULL, NULL,
                '2026-09-07', 'MON', '09:00', '2026-09-07', 1)
        `).run(TASK_SEGMENT_ID, TASK_SERIES_ID);
        database.prepare(`
            INSERT INTO task_occurrence_states (
                task_series_id, original_logical_anchor, status, entity_version
            ) VALUES (?, 'once', 'completed', 1)
        `).run(TASK_SERIES_ID);

        assert.throws(
            () => validateSchemaLevel9(database),
            (error: unknown) => error instanceof SchemaValidationError
                && error.reason === 'database-corrupt',
        );
    }
    finally {
        database.close();
    }
});

test('ADR-04: level 9 rejects a weekly boundary whose TermZone Instant is not canonical', t => {
    const dataSlotsRoot = mkdtempSync(join(tmpdir(), 'courseflow-weekly-task-boundary-'));
    t.after(() => rmSync(dataSlotsRoot, { recursive: true, force: true }));
    const activeDirectory = join(dataSlotsRoot, 'active');
    mkdirSync(activeDirectory);
    const database = new DatabaseSync(join(activeDirectory, 'workspace.sqlite'), {
        enableForeignKeyConstraints: true,
    });
    try {
        database.exec(`PRAGMA application_id = ${COURSEFLOW_APPLICATION_ID}`);
        createSchemaLevel9(database);
        database.exec('PRAGMA user_version = 9');
        insertTaskParents(database);
        database.exec(`
            UPDATE terms
            SET start_date = '9999-12-31',
                end_date = '9999-12-31',
                time_zone = 'America/Toronto';
        `);
        database.prepare(`
            INSERT INTO task_series (task_series_id, course_id, retired, entity_version)
            VALUES (?, ?, 0, 1)
        `).run(TASK_SERIES_ID, COURSE_ID);
        database.prepare(`
            INSERT INTO task_segments (
                task_segment_id, task_series_id, title, task_size, schedule_kind, deadline_kind,
                deadline_date, deadline_instant, deadline_display_zone, weekly_start_date,
                weekly_weekday, weekly_local_deadline_time, weekly_confirmed_end_date, follow_teaching_week
            ) VALUES (?, ?, 'Boundary weekly', 'small', 'weekly', NULL, NULL, NULL, NULL,
                '9999-12-31', 'FRI', '23:59', '9999-12-31', 1)
        `).run(TASK_SEGMENT_ID, TASK_SERIES_ID);
        database.exec('BEGIN IMMEDIATE');
        migrateLevel9To10(database);
        database.exec('COMMIT');
        database.exec('BEGIN IMMEDIATE');
        migrateLevel10To11(database);
        database.exec('COMMIT');
        database.exec('BEGIN IMMEDIATE');
        migrateLevel11To12(database);
        database.exec('COMMIT');
        database.exec('BEGIN IMMEDIATE');
        migrateLevel12To13(database);
        database.exec('COMMIT');
        database.exec('BEGIN IMMEDIATE');
        migrateLevel13To14(database);
        database.exec('COMMIT');
        database.exec('BEGIN IMMEDIATE');
        migrateLevel14To15(database);
        database.exec('COMMIT');
        database.exec('BEGIN IMMEDIATE');
        migrateLevel15To16(database);
        database.exec('COMMIT');
    }
    finally {
        database.close();
    }

    const opened = openWorkspaceData(dataSlotsRoot);
    assert.equal(opened.kind, 'recovery');
    if (opened.kind !== 'recovery') {
        throw new Error('Expected boundary weekly Task database to require recovery');
    }
    assert.equal(opened.problem.code, 'integrity');
    assert.equal(opened.problem.details.reason, 'database-corrupt');
});

test('ADR-04: level 9 rejects a noncanonical weekly TermZone alias before core reads', async t => {
    const dataSlotsRoot = mkdtempSync(join(tmpdir(), 'courseflow-weekly-task-zone-'));
    t.after(() => rmSync(dataSlotsRoot, { recursive: true, force: true }));
    const activeDirectory = join(dataSlotsRoot, 'active');
    mkdirSync(activeDirectory);
    const database = new DatabaseSync(join(activeDirectory, 'workspace.sqlite'), {
        enableForeignKeyConstraints: true,
    });
    try {
        database.exec(`PRAGMA application_id = ${COURSEFLOW_APPLICATION_ID}`);
        createSchemaLevel9(database);
        database.exec('PRAGMA user_version = 9');
        insertTaskParents(database);
        database.exec("UPDATE terms SET time_zone = 'US/Eastern'");
        database.prepare(`
            INSERT INTO task_series (task_series_id, course_id, retired, entity_version)
            VALUES (?, ?, 0, 1)
        `).run(TASK_SERIES_ID, COURSE_ID);
        database.prepare(`
            INSERT INTO task_segments (
                task_segment_id, task_series_id, title, task_size, schedule_kind, deadline_kind,
                deadline_date, deadline_instant, deadline_display_zone, weekly_start_date,
                weekly_weekday, weekly_local_deadline_time, weekly_confirmed_end_date, follow_teaching_week
            ) VALUES (?, ?, 'Alias weekly', 'small', 'weekly', NULL, NULL, NULL, NULL,
                '2026-09-01', 'TUE', '09:00', '2026-12-15', 1)
        `).run(TASK_SEGMENT_ID, TASK_SERIES_ID);
        database.exec('BEGIN IMMEDIATE');
        migrateLevel9To10(database);
        database.exec('COMMIT');
        database.exec('BEGIN IMMEDIATE');
        migrateLevel10To11(database);
        database.exec('COMMIT');
        database.exec('BEGIN IMMEDIATE');
        migrateLevel11To12(database);
        database.exec('COMMIT');
        database.exec('BEGIN IMMEDIATE');
        migrateLevel12To13(database);
        database.exec('COMMIT');
        database.exec('BEGIN IMMEDIATE');
        migrateLevel13To14(database);
        database.exec('COMMIT');
        database.exec('BEGIN IMMEDIATE');
        migrateLevel14To15(database);
        database.exec('COMMIT');
        database.exec('BEGIN IMMEDIATE');
        migrateLevel15To16(database);
        database.exec('COMMIT');
    }
    finally {
        database.close();
    }

    const opened = openWorkspaceData(dataSlotsRoot);
    if (opened.kind === 'ready') {
        await opened.store.close();
    }
    assert.equal(opened.kind, 'recovery');
    if (opened.kind !== 'recovery') {
        throw new Error('Expected noncanonical weekly TermZone to require recovery');
    }
    assert.equal(opened.problem.code, 'integrity');
    assert.equal(opened.problem.details.reason, 'database-corrupt');
});

test('ADR-04/TEST-DATA-006: level 8 to 9 open migration retains safety and durable facts', async t => {
    const dataSlotsRoot = mkdtempSync(join(tmpdir(), 'courseflow-weekly-task-schema-'));
    t.after(() => rmSync(dataSlotsRoot, { recursive: true, force: true }));
    createLevel8WorkspaceWithTask(dataSlotsRoot);

    const opened = await openWorkspaceDataWithMigrations(dataSlotsRoot);
    assert.equal(opened.kind, 'ready');
    if (opened.kind !== 'ready') {
        throw new Error('Expected level 8 Task migration to open ready');
    }
    assert.deepEqual(opened.store.status(), {
        kind: 'ready',
        workspaceId: WORKSPACE_ID,
        schemaLevel: 16,
        revision: '9',
    });
    await opened.store.close();

    const activeDatabase = new DatabaseSync(join(dataSlotsRoot, 'active', 'workspace.sqlite'), {
        readOnly: true,
    });
    try {
        assert.deepEqual(validateSchemaLevel16(activeDatabase), {
            workspaceId: WORKSPACE_ID,
            revision: 9n,
        });
        assert.deepEqual({ ...activeDatabase.prepare(`
            SELECT schedule_kind, deadline_kind, deadline_date, weekly_start_date, follow_teaching_week
            FROM task_segments WHERE task_series_id = ?
        `).get(TASK_SERIES_ID) }, {
            schedule_kind: 'once',
            deadline_kind: 'date-only',
            deadline_date: '2026-10-15',
            weekly_start_date: null,
            follow_teaching_week: null,
        });
        assert.deepEqual({ ...activeDatabase.prepare(`
            SELECT original_logical_anchor, status, self_reported_progress, entity_version
            FROM task_occurrence_states WHERE task_series_id = ?
        `).get(TASK_SERIES_ID) }, {
            original_logical_anchor: 'once',
            status: 'completed',
            self_reported_progress: null,
            entity_version: 2,
        });
        assert.deepEqual({ ...activeDatabase.prepare(`
            SELECT
                intent_kind,
                intent_schema_version,
                canonical_encoding,
                digest_algorithm,
                hex(payload_digest) AS payload_digest,
                committed_revision,
                result_kind
            FROM command_receipts WHERE command_id = ?
        `).get('55555555-5555-4555-8555-555555555555') }, {
            intent_kind: 'plan.create-task-series',
            intent_schema_version: 1,
            canonical_encoding: 'courseflow-canonical-json-v1',
            digest_algorithm: 'sha256',
            payload_digest: '0000000000000000000000000000000000000000000000000000000000000000',
            committed_revision: 1,
            result_kind: 'committed',
        });
        assert.deepEqual({ ...activeDatabase.prepare(`
            SELECT effect_order, effect_code, entity_kind, entity_id, entity_version
            FROM receipt_effects WHERE command_id = ?
        `).get('55555555-5555-4555-8555-555555555555') }, {
            effect_order: 0,
            effect_code: 'plan.task-series-created',
            entity_kind: 'task-series',
            entity_id: TASK_SERIES_ID,
            entity_version: 1,
        });
        assert.deepEqual({ ...activeDatabase.prepare(`
            SELECT originating_command_id, owner, kind, prerequisite_revision, state, follow_up_version
            FROM durable_followups WHERE follow_up_id = ?
        `).get('66666666-6666-4666-8666-666666666666') }, {
            originating_command_id: '55555555-5555-4555-8555-555555555555',
            owner: 'protect',
            kind: 'backup-needed-through',
            prerequisite_revision: 1,
            state: 'pending',
            follow_up_version: 0,
        });
        assert.deepEqual({ ...activeDatabase.prepare(`
            SELECT backup_needed_through, backup_succeeded_through
            FROM protection_watermarks WHERE singleton = 1
        `).get() }, {
            backup_needed_through: 9,
            backup_succeeded_through: 0,
        });
    }
    finally {
        activeDatabase.close();
    }

    const safetyDirectories = readdirSync(dataSlotsRoot)
        .filter(name => name.startsWith('migration-safety-copy-'));
    assert.equal(safetyDirectories.length, 1);
    const safetyDatabase = new DatabaseSync(
        join(dataSlotsRoot, safetyDirectories[0]!, 'workspace.sqlite'),
        { readOnly: true },
    );
    try {
        assertLevel8TaskFacts(safetyDatabase);
    }
    finally {
        safetyDatabase.close();
    }
});

test('ADR-04/TEST-DATA-006: level 8 to 9 before-commit failure rolls back every fact', async t => {
    const dataSlotsRoot = mkdtempSync(join(tmpdir(), 'courseflow-weekly-task-rollback-'));
    t.after(() => rmSync(dataSlotsRoot, { recursive: true, force: true }));
    createLevel8WorkspaceWithTask(dataSlotsRoot);

    const interrupted = await openWorkspaceDataWithMigrations(dataSlotsRoot, {
        migrationFailpoint(point) {
            if (point === 'migration.before-level-commit') {
                throw new Error(point);
            }
        },
    });
    assert.equal(interrupted.kind, 'recovery');

    const activeDatabase = new DatabaseSync(join(dataSlotsRoot, 'active', 'workspace.sqlite'), {
        readOnly: true,
    });
    try {
        assertLevel8TaskFacts(activeDatabase);
    }
    finally {
        activeDatabase.close();
    }

    const safetyDirectories = readdirSync(dataSlotsRoot)
        .filter(name => name.startsWith('migration-safety-copy-'));
    assert.equal(safetyDirectories.length, 1);
    const safetyDatabase = new DatabaseSync(
        join(dataSlotsRoot, safetyDirectories[0]!, 'workspace.sqlite'),
        { readOnly: true },
    );
    try {
        assertLevel8TaskFacts(safetyDatabase);
    }
    finally {
        safetyDatabase.close();
    }
});

test('ADR-04: level 10 stores Task occurrence overrides, state, and one-time Undo facts', () => {
    const database = new DatabaseSync(':memory:', {
        enableForeignKeyConstraints: true,
    });
    try {
        database.exec(`PRAGMA application_id = ${COURSEFLOW_APPLICATION_ID}`);
        createSchemaLevel10(database);
        database.exec('PRAGMA user_version = 10');
        insertTaskParents(database);

        assert.equal(CURRENT_SCHEMA_LEVEL, 16);
        assert.deepEqual(validateSchemaLevel10(database), {
            workspaceId: WORKSPACE_ID,
            revision: 0n,
        });
        database.prepare(`
            INSERT INTO task_series (task_series_id, course_id, retired, entity_version)
            VALUES (?, ?, 0, 2)
        `).run(TASK_SERIES_ID, COURSE_ID);
        database.prepare(`
            INSERT INTO task_segments (
                task_segment_id, task_series_id, title, task_size, schedule_kind, deadline_kind,
                deadline_date, deadline_instant, deadline_display_zone, logical_start_anchor,
                logical_end_anchor
            ) VALUES (?, ?, 'One-time assignment', 'large', 'once', 'date-only', '2026-10-15',
                NULL, NULL, 'once', 'once')
        `).run(TASK_SEGMENT_ID, TASK_SERIES_ID);
        database.prepare(`
            INSERT INTO task_series (task_series_id, course_id, retired, entity_version)
            VALUES ('55555555-5555-4555-8555-555555555555', ?, 0, 1)
        `).run(COURSE_ID);
        database.prepare(`
            INSERT INTO task_segments (
                task_segment_id, task_series_id, title, task_size, schedule_kind, deadline_kind,
                deadline_date, deadline_instant, deadline_display_zone, logical_start_anchor,
                logical_end_anchor, weekly_start_date, weekly_weekday, weekly_local_deadline_time,
                weekly_confirmed_end_date, follow_teaching_week
            ) VALUES ('66666666-6666-4666-8666-666666666666',
                '55555555-5555-4555-8555-555555555555', 'Weekly assignment', 'large', 'weekly',
                NULL, NULL, NULL, NULL, '2026-09-07', '2026-09-07', '2026-09-01', 'MON', '17:30',
                '2026-12-14', 1)
        `).run();
        database.prepare(`
            INSERT INTO task_segments (
                task_segment_id, task_series_id, title, task_size, schedule_kind, deadline_kind,
                deadline_date, deadline_instant, deadline_display_zone, logical_start_anchor,
                logical_end_anchor, weekly_start_date, weekly_weekday, weekly_local_deadline_time,
                weekly_confirmed_end_date, follow_teaching_week
            ) VALUES ('77777777-7777-4777-8777-777777777777',
                '55555555-5555-4555-8555-555555555555', 'Updated weekly assignment', 'large',
                'weekly', NULL, NULL, NULL, NULL, '2026-09-14', '2026-12-14', '2026-09-01', 'MON',
                '17:30', '2026-12-14', 1)
        `).run();
        assert.throws(() => database.prepare(`
            INSERT INTO task_segments (
                task_segment_id, task_series_id, title, task_size, schedule_kind, deadline_kind,
                deadline_date, deadline_instant, deadline_display_zone, logical_start_anchor,
                logical_end_anchor, weekly_start_date, weekly_weekday, weekly_local_deadline_time,
                weekly_confirmed_end_date, follow_teaching_week
            ) VALUES ('88888888-8888-4888-8888-888888888888',
                '55555555-5555-4555-8555-555555555555', 'Duplicate start', 'large', 'weekly',
                NULL, NULL, NULL, NULL, '2026-09-14', '2026-12-14', '2026-09-01', 'MON', '17:30',
                '2026-12-14', 1)
        `).run());

        database.prepare(`
            INSERT INTO task_occurrence_overrides (
                task_series_id, original_logical_anchor, override_kind, replacement_title,
                replacement_task_size, replacement_deadline_kind, replacement_deadline_date,
                replacement_deadline_instant, replacement_deadline_display_zone, entity_version
            ) VALUES (?, '2026-09-07', 'deleted', NULL, NULL, NULL, NULL, NULL, NULL, 1)
        `).run('55555555-5555-4555-8555-555555555555');
        database.prepare(`
            INSERT INTO task_occurrence_overrides (
                task_series_id, original_logical_anchor, override_kind, replacement_title,
                replacement_task_size, replacement_deadline_kind, replacement_deadline_date,
                replacement_deadline_instant, replacement_deadline_display_zone, entity_version
            ) VALUES (?, '2026-09-14', 'replaced', 'Replacement', 'large', 'timed', NULL,
                '2026-09-14T21:30:00.000Z', 'America/Toronto', 1)
        `).run('55555555-5555-4555-8555-555555555555');
        assert.throws(() => database.prepare(`
            INSERT INTO task_occurrence_overrides (
                task_series_id, original_logical_anchor, override_kind, replacement_title,
                replacement_task_size, replacement_deadline_kind, replacement_deadline_date,
                replacement_deadline_instant, replacement_deadline_display_zone, entity_version
            ) VALUES (?, '2026-09-21', 'deleted', 'Unexpected replacement', NULL, NULL, NULL,
                NULL, NULL, 1)
        `).run('55555555-5555-4555-8555-555555555555'));

        database.prepare(`
            INSERT INTO task_occurrence_states (
                task_series_id, original_logical_anchor, status, self_reported_progress, entity_version
            ) VALUES (?, 'once', 'pending', 75, 2)
        `).run(TASK_SERIES_ID);
        database.prepare(`
            INSERT INTO task_occurrence_states (
                task_series_id, original_logical_anchor, status, self_reported_progress, entity_version
            ) VALUES (?, '2026-09-07', 'completed', 75, 1)
        `).run('55555555-5555-4555-8555-555555555555');
        database.prepare(`
            INSERT INTO task_occurrence_states (
                task_series_id, original_logical_anchor, status, self_reported_progress, entity_version
            ) VALUES (?, '2026-09-14', 'skipped', NULL, 2)
        `).run('55555555-5555-4555-8555-555555555555');
        assert.throws(() => database.prepare(`
            INSERT INTO task_occurrence_states (
                task_series_id, original_logical_anchor, status, self_reported_progress, entity_version
            ) VALUES (?, '2026-09-21', 'pending', 101, 3)
        `).run('55555555-5555-4555-8555-555555555555'));

        database.exec('BEGIN IMMEDIATE');
        try {
            assert.throws(() => database.prepare(`
                INSERT INTO task_state_history (
                    undo_token, originating_command_id, task_series_id, original_logical_anchor,
                    before_row_present, before_status, before_self_reported_progress, after_state_version,
                    consumed
                ) VALUES ('dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
                    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', ?, 'once', 0, NULL, NULL, 2, 0)
            `).run(TASK_SERIES_ID));
        }
        finally {
            database.exec('ROLLBACK');
        }

        database.exec(`
            UPDATE workspace_state SET revision = 1 WHERE singleton = 1;
            UPDATE plan_state SET plan_entity_version = 2 WHERE singleton = 1;
            UPDATE protection_watermarks SET backup_needed_through = 1 WHERE singleton = 1;
        `);
        database.prepare(`
            INSERT INTO command_receipts (
                command_id, intent_kind, intent_schema_version, canonical_encoding, digest_algorithm,
                payload_digest, committed_revision, result_kind
            ) VALUES (?, 'plan.set-task-progress', 1, 'courseflow-canonical-json-v1', 'sha256',
                zeroblob(32), 1, 'committed')
        `).run('99999999-9999-4999-8999-999999999999');
        database.prepare(`
            INSERT INTO receipt_effects (
                command_id, effect_order, effect_code, entity_kind, entity_id, entity_version
            ) VALUES (?, 0, 'plan.task-progress-set', 'task-series', ?, 2)
        `).run('99999999-9999-4999-8999-999999999999', TASK_SERIES_ID);
        database.prepare(`
            INSERT INTO durable_followups (
                follow_up_id, originating_command_id, owner, kind, prerequisite_revision, state,
                follow_up_version
            ) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ?, 'protect',
                'backup-needed-through', 1, 'pending', 0)
        `).run('99999999-9999-4999-8999-999999999999');
        database.prepare(`
            INSERT INTO task_state_history (
                undo_token, originating_command_id, task_series_id, original_logical_anchor,
                before_row_present, before_status, before_self_reported_progress, after_state_version,
                consumed
            ) VALUES ('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', ?, ?, 'once',
                1, 'pending', 50, 2, 0)
        `).run('99999999-9999-4999-8999-999999999999', TASK_SERIES_ID);
        assert.throws(() => database.prepare(`
            INSERT INTO task_state_history (
                undo_token, originating_command_id, task_series_id, original_logical_anchor,
                before_row_present, before_status, before_self_reported_progress, after_state_version,
                consumed
            ) VALUES ('cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', ?, ?, 'once',
                0, 'pending', NULL, 2, 0)
        `).run('99999999-9999-4999-8999-999999999999', TASK_SERIES_ID));
        assert.deepEqual(validateSchemaLevel10(database), {
            workspaceId: WORKSPACE_ID,
            revision: 1n,
        });

        database.prepare(`
            DELETE FROM receipt_effects WHERE command_id = ?
        `).run('99999999-9999-4999-8999-999999999999');
        assert.throws(
            () => validateSchemaLevel10(database),
            (error: unknown) => error instanceof SchemaValidationError
                && error.reason === 'database-corrupt',
        );
        database.prepare(`
            INSERT INTO receipt_effects (
                command_id, effect_order, effect_code, entity_kind, entity_id, entity_version
            ) VALUES (?, 0, 'plan.task-progress-set', 'task-series', ?, 2)
        `).run('99999999-9999-4999-8999-999999999999', TASK_SERIES_ID);

        database.prepare(`
            DELETE FROM durable_followups WHERE originating_command_id = ?
        `).run('99999999-9999-4999-8999-999999999999');
        assert.throws(
            () => validateSchemaLevel10(database),
            (error: unknown) => error instanceof SchemaValidationError
                && error.reason === 'database-corrupt',
        );
        database.prepare(`
            INSERT INTO durable_followups (
                follow_up_id, originating_command_id, owner, kind, prerequisite_revision, state,
                follow_up_version
            ) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ?, 'protect',
                'backup-needed-through', 1, 'pending', 0)
        `).run('99999999-9999-4999-8999-999999999999');

        database.prepare(`
            UPDATE receipt_effects SET entity_id = ? WHERE command_id = ?
        `).run(
            '55555555-5555-4555-8555-555555555555',
            '99999999-9999-4999-8999-999999999999',
        );
        assert.throws(
            () => validateSchemaLevel10(database),
            (error: unknown) => error instanceof SchemaValidationError
                && error.reason === 'database-corrupt',
        );
        database.prepare(`
            UPDATE receipt_effects SET entity_id = ? WHERE command_id = ?
        `).run(TASK_SERIES_ID, '99999999-9999-4999-8999-999999999999');

        database.prepare(`
            UPDATE receipt_effects SET effect_code = 'plan.task-occurrence-state-undone'
            WHERE command_id = ?
        `).run('99999999-9999-4999-8999-999999999999');
        assert.throws(
            () => validateSchemaLevel10(database),
            (error: unknown) => error instanceof SchemaValidationError
                && error.reason === 'database-corrupt',
        );
        database.prepare(`
            UPDATE receipt_effects SET effect_code = 'plan.task-progress-set' WHERE command_id = ?
        `).run('99999999-9999-4999-8999-999999999999');

        database.prepare(`
            UPDATE task_state_history SET after_state_version = 3 WHERE originating_command_id = ?
        `).run('99999999-9999-4999-8999-999999999999');
        assert.throws(
            () => validateSchemaLevel10(database),
            (error: unknown) => error instanceof SchemaValidationError
                && error.reason === 'database-corrupt',
        );
        database.prepare(`
            UPDATE task_state_history SET after_state_version = 2 WHERE originating_command_id = ?
        `).run('99999999-9999-4999-8999-999999999999');

        database.prepare(`
            INSERT INTO command_receipts (
                command_id, intent_kind, intent_schema_version, canonical_encoding, digest_algorithm,
                payload_digest, committed_revision, result_kind
            ) VALUES (?, 'plan.undo-task-occurrence-state', 1, 'courseflow-canonical-json-v1', 'sha256',
                zeroblob(32), 2, 'committed')
        `).run('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
        database.prepare(`
            INSERT INTO task_state_history (
                undo_token, originating_command_id, task_series_id, original_logical_anchor,
                before_row_present, before_status, before_self_reported_progress, after_state_version,
                consumed
            ) VALUES ('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', ?, ?, 'once',
                1, 'pending', 50, 2, 0)
        `).run('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', TASK_SERIES_ID);
        assert.throws(
            () => validateSchemaLevel10(database),
            (error: unknown) => error instanceof SchemaValidationError
                && error.reason === 'database-corrupt',
        );
        database.prepare(`
            DELETE FROM task_state_history WHERE originating_command_id = ?
        `).run('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
        database.prepare(`
            DELETE FROM command_receipts WHERE command_id = ?
        `).run('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
        assert.deepEqual(validateSchemaLevel10(database), {
            workspaceId: WORKSPACE_ID,
            revision: 1n,
        });
    }
    finally {
        database.close();
    }
});

test('ADR-04: level 9 to 10 migration retains Task facts and derives weekly segment anchors', () => {
    const database = new DatabaseSync(':memory:', {
        enableForeignKeyConstraints: true,
    });
    try {
        database.exec(`PRAGMA application_id = ${COURSEFLOW_APPLICATION_ID}`);
        createSchemaLevel9(database);
        database.exec('PRAGMA user_version = 9');
        insertTaskParents(database);
        insertOnceTask(
            database,
            TASK_SERIES_ID,
            TASK_SEGMENT_ID,
            'date-only',
            '2026-10-15',
            null,
            null,
        );
        database.prepare(`
            INSERT INTO task_occurrence_states (
                task_series_id, original_logical_anchor, status, entity_version
            ) VALUES (?, 'once', 'completed', 2)
        `).run(TASK_SERIES_ID);
        database.prepare(`
            INSERT INTO task_series (task_series_id, course_id, retired, entity_version)
            VALUES ('55555555-5555-4555-8555-555555555555', ?, 0, 1)
        `).run(COURSE_ID);
        database.prepare(`
            INSERT INTO task_segments (
                task_segment_id, task_series_id, title, task_size, schedule_kind, deadline_kind,
                deadline_date, deadline_instant, deadline_display_zone, weekly_start_date,
                weekly_weekday, weekly_local_deadline_time, weekly_confirmed_end_date, follow_teaching_week
            ) VALUES ('66666666-6666-4666-8666-666666666666',
                '55555555-5555-4555-8555-555555555555', 'Weekly assignment', 'small', 'weekly',
                NULL, NULL, NULL, NULL, '2026-09-01', 'MON', '17:30', '2026-12-14', 1)
        `).run();
        database.prepare(`
            INSERT INTO command_receipts (
                command_id, intent_kind, intent_schema_version, canonical_encoding, digest_algorithm,
                payload_digest, committed_revision, result_kind
            ) VALUES ('77777777-7777-4777-8777-777777777777', 'plan.create-task-series', 1,
                'courseflow-canonical-json-v1', 'sha256', zeroblob(32), 1, 'committed')
        `).run();
        database.prepare(`
            INSERT INTO receipt_effects (
                command_id, effect_order, effect_code, entity_kind, entity_id, entity_version
            ) VALUES ('77777777-7777-4777-8777-777777777777', 0, 'plan.task-series-created',
                'task-series', ?, 1)
        `).run(TASK_SERIES_ID);
        database.prepare(`
            INSERT INTO durable_followups (
                follow_up_id, originating_command_id, owner, kind, prerequisite_revision, state,
                follow_up_version
            ) VALUES ('88888888-8888-4888-8888-888888888888',
                '77777777-7777-4777-8777-777777777777', 'protect', 'backup-needed-through', 1,
                'pending', 0)
        `).run();

        database.exec('BEGIN IMMEDIATE');
        migrateLevel9To10(database);
        database.exec('COMMIT');

        assert.deepEqual(validateSchemaLevel10(database), {
            workspaceId: WORKSPACE_ID,
            revision: 1n,
        });
        assert.deepEqual({ ...database.prepare(`
            SELECT task_segment_id, logical_start_anchor, logical_end_anchor
            FROM task_segments WHERE task_series_id = ?
        `).get(TASK_SERIES_ID) }, {
            task_segment_id: TASK_SEGMENT_ID,
            logical_start_anchor: 'once',
            logical_end_anchor: 'once',
        });
        assert.deepEqual({ ...database.prepare(`
            SELECT logical_start_anchor, logical_end_anchor
            FROM task_segments WHERE task_series_id = '55555555-5555-4555-8555-555555555555'
        `).get() }, {
            logical_start_anchor: '2026-09-07',
            logical_end_anchor: '2026-12-14',
        });
        assert.deepEqual({ ...database.prepare(`
            SELECT status, self_reported_progress, entity_version
            FROM task_occurrence_states WHERE task_series_id = ?
        `).get(TASK_SERIES_ID) }, {
            status: 'completed',
            self_reported_progress: null,
            entity_version: 2,
        });
        assert.equal(
            (database.prepare('SELECT count(*) AS count FROM command_receipts').get() as { count: number }).count,
            1,
        );
        assert.equal(
            (database.prepare('SELECT count(*) AS count FROM receipt_effects').get() as { count: number }).count,
            1,
        );
        assert.equal(
            (database.prepare('SELECT count(*) AS count FROM durable_followups').get() as { count: number }).count,
            1,
        );
    }
    finally {
        database.close();
    }
});

test('ADR-04/FLOW-00: level 10 migration backfills setup minimum from a current Course Task', () => {
    const database = new DatabaseSync(':memory:', {
        enableForeignKeyConstraints: true,
    });
    try {
        database.exec(`PRAGMA application_id = ${COURSEFLOW_APPLICATION_ID}`);
        createSchemaLevel9(database);
        database.exec('PRAGMA user_version = 9');
        insertTaskParents(database);
        insertOnceTask(
            database,
            TASK_SERIES_ID,
            TASK_SEGMENT_ID,
            'tba',
            null,
            null,
            null,
        );
        database.exec('BEGIN IMMEDIATE');
        migrateLevel9To10(database);
        database.exec('COMMIT');
        assert.equal(validateSchemaLevel10(database).revision, 1n);

        database.exec('BEGIN IMMEDIATE');
        migrateLevel10To11(database);
        database.exec('COMMIT');

        assert.deepEqual(validateSchemaLevel11(database), {
            workspaceId: WORKSPACE_ID,
            revision: 2n,
        });
        assert.deepEqual({ ...database.prepare(`
            SELECT last_decision, setup_decision_version, ever_reached_minimum
            FROM setup_state WHERE singleton = 1
        `).get() }, {
            last_decision: null,
            setup_decision_version: 0,
            ever_reached_minimum: 1,
        });
        assert.deepEqual({ ...database.prepare(`
            SELECT checkpoint_version, schema_version, updated_at, opaque_payload
            FROM setup_draft_checkpoint WHERE singleton = 1
        `).get() }, {
            checkpoint_version: 0,
            schema_version: null,
            updated_at: null,
            opaque_payload: null,
        });
    }
    finally {
        database.close();
    }
});

test('ADR-04/TEST-DATA-006: level 9 to 10 interruption rolls back and restarts deterministically', async t => {
    for (const failpoint of ['migration.after-safety-copy', 'migration.before-level-commit'] as const) {
        const dataSlotsRoot = mkdtempSync(join(tmpdir(), 'courseflow-task-level-10-rollback-'));
        t.after(() => rmSync(dataSlotsRoot, { recursive: true, force: true }));
        createLevel9WorkspaceWithTask(dataSlotsRoot);

        const interrupted = await openWorkspaceDataWithMigrations(dataSlotsRoot, {
            migrationFailpoint(point) {
                if (point === failpoint) {
                    throw new Error(point);
                }
            },
        });
        assert.equal(interrupted.kind, 'recovery');

        const activeDatabase = new DatabaseSync(join(dataSlotsRoot, 'active', 'workspace.sqlite'), {
            readOnly: true,
        });
        try {
            assert.equal(
                (activeDatabase.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
                9,
            );
            assert.deepEqual(validateSchemaLevel9(activeDatabase), {
                workspaceId: WORKSPACE_ID,
                revision: 0n,
            });
            assert.deepEqual({ ...activeDatabase.prepare(`
                SELECT status, entity_version
                FROM task_occurrence_states
                WHERE task_series_id = ? AND original_logical_anchor = 'once'
            `).get(TASK_SERIES_ID) }, {
                status: 'completed',
                entity_version: 2,
            });
            assert.equal(
                (activeDatabase.prepare(`
                    SELECT count(*) AS count
                    FROM sqlite_schema
                    WHERE type = 'table' AND name = 'task_occurrence_overrides'
                `).get() as { count: number }).count,
                0,
            );
        }
        finally {
            activeDatabase.close();
        }

        const migrated = await openWorkspaceDataWithMigrations(dataSlotsRoot);
        assert.equal(migrated.kind, 'ready');
        if (migrated.kind !== 'ready') {
            throw new Error('Expected deterministic current migration retry');
        }
        assert.equal(migrated.store.status().schemaLevel, 16);
        assert.equal(
            migrated.store.readTaskSeriesDetail(TASK_SERIES_ID, {
                startDate: '2026-10-01',
                endDate: '2026-10-31',
            }).occurrences[0]?.status,
            'completed',
        );
        await migrated.store.close();

        const restarted = openWorkspaceData(dataSlotsRoot);
        assert.equal(restarted.kind, 'ready');
        if (restarted.kind !== 'ready') {
            throw new Error('Expected migrated current Workspace to restart');
        }
        assert.equal(restarted.store.status().schemaLevel, 16);
        await restarted.store.close();
    }
});
