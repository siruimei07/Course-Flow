/**
 * @file Verifies the once-only Task schema, constraints, and level 7 migration.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
    COURSEFLOW_APPLICATION_ID,
    createSchemaLevel7,
    createSchemaLevel8,
    CURRENT_SCHEMA_LEVEL,
    migrateLevel7To8,
    SchemaValidationError,
    validateSchemaLevel8,
} from '../../src/data/schema';

const COURSE_ID = '22222222-2222-4222-8222-222222222222';
const TASK_SERIES_ID = '33333333-3333-4333-8333-333333333333';
const TASK_SEGMENT_ID = '44444444-4444-4444-8444-444444444444';
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

/**
 * Inserts the minimal valid Workspace, Term, and Course parents for Task foreign keys.
 * @param {DatabaseSync} database - Open level 8 database.
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

        assert.equal(CURRENT_SCHEMA_LEVEL, 8);
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
