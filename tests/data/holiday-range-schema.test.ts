/**
 * @file Verifies the current HolidayRange schema manifest and local constraints.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
    COURSEFLOW_APPLICATION_ID,
    CURRENT_SCHEMA_LEVEL,
    createSchemaLevel6,
} from '../../src/data/schema';
import {
    initializeWorkspaceData,
    openWorkspaceDataWithMigrations,
} from '../../src/data/sqlite-data-store';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

/**
 * Creates an isolated DATA slots root and removes it after the test.
 * @param {test.TestContext} t - Node test lifecycle context.
 * @return {string} Fresh data slots root.
 */
function createTempDataSlots(t: test.TestContext): string {
    const dataSlotsRoot = mkdtempSync(join(tmpdir(), 'courseflow-holiday-schema-'));
    t.after(() => rmSync(dataSlotsRoot, { recursive: true, force: true }));
    return dataSlotsRoot;
}

/**
 * Creates a valid empty level 6 workspace for migration tests.
 * @param {string} dataSlotsRoot - Isolated DATA slots root.
 * @return {void}
 */
function createLevel6Workspace(dataSlotsRoot: string): void {
    const activeDirectory = join(dataSlotsRoot, 'active');
    mkdirSync(activeDirectory);
    const database = new DatabaseSync(join(activeDirectory, 'workspace.sqlite'), {
        readBigInts: true,
        enableForeignKeyConstraints: true,
    });
    try {
        database.exec('BEGIN IMMEDIATE');
        database.exec(`PRAGMA application_id = ${COURSEFLOW_APPLICATION_ID}`);
        createSchemaLevel6(database);
        database.prepare(
            'INSERT INTO workspace_state (singleton, workspace_id, revision) VALUES (1, ?, 0)',
        ).run(WORKSPACE_ID);
        database.exec(`
            INSERT INTO setup_state (
                singleton,
                last_decision,
                setup_decision_version,
                ever_reached_minimum
            ) VALUES (1, NULL, 0, 0);
            INSERT INTO protection_watermarks (
                singleton,
                backup_needed_through,
                backup_succeeded_through
            ) VALUES (1, 0, 0);
            INSERT INTO plan_state (
                singleton,
                current_term_id,
                plan_entity_version
            ) VALUES (1, NULL, 0);
            PRAGMA user_version = 6;
            COMMIT;
        `);
    }
    finally {
        database.close();
    }
}

test('ADR-04/A-TERM-004: level 8 retains one strict HolidayRange row per inclusive range', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    assert.equal(CURRENT_SCHEMA_LEVEL, 8);
    assert.equal(store.status().schemaLevel, 8);
    await store.close();

    const database = new DatabaseSync(join(dataSlotsRoot, 'active', 'workspace.sqlite'), {
        readOnly: true,
        readBigInts: true,
    });
    try {
        const userVersion = database.prepare('PRAGMA user_version').get() as { user_version: bigint };
        const table = database.prepare("PRAGMA table_list('holiday_ranges')").get() as {
            name: string;
            strict: bigint;
        };
        const columns = database.prepare('PRAGMA table_info(holiday_ranges)').all().map(row => {
            const column = row as { name: string; type: string; notnull: bigint; pk: bigint };
            return [column.name, column.type, column.notnull, column.pk];
        });
        const foreignKeys = database.prepare('PRAGMA foreign_key_list(holiday_ranges)').all().map(row => {
            const foreignKey = row as { from: string; table: string; to: string; on_delete: string };
            return [foreignKey.from, foreignKey.table, foreignKey.to, foreignKey.on_delete];
        });
        const indexes = database.prepare('PRAGMA index_list(holiday_ranges)').all().map(row => {
            const index = row as { name: string; origin: string; partial: bigint };
            return [index.name, index.origin, index.partial];
        });

        assert.equal(userVersion.user_version, 8n);
        assert.equal(table.name, 'holiday_ranges');
        assert.equal(table.strict, 1n);
        assert.deepEqual(columns, [
            ['holiday_range_id', 'TEXT', 1n, 1n],
            ['term_id', 'TEXT', 1n, 0n],
            ['name', 'TEXT', 1n, 0n],
            ['start_date', 'TEXT', 1n, 0n],
            ['end_date', 'TEXT', 1n, 0n],
            ['tombstoned', 'INTEGER', 1n, 0n],
            ['entity_version', 'INTEGER', 1n, 0n],
        ]);
        assert.deepEqual(foreignKeys, [['term_id', 'terms', 'term_id', 'RESTRICT']]);
        assert.deepEqual(indexes, [
            ['holiday_ranges_by_term', 'c', 0n],
            ['sqlite_autoindex_holiday_ranges_1', 'pk', 0n],
        ]);
    }
    finally {
        database.close();
    }
});

test('ADR-04/TEST-DATA-006: level 6 migrates through HolidayRange storage atomically', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    createLevel6Workspace(dataSlotsRoot);

    const interrupted = await openWorkspaceDataWithMigrations(dataSlotsRoot, {
        migrationFailpoint(point) {
            if (point === 'migration.before-level-commit') {
                throw new Error(point);
            }
        },
    });
    assert.equal(interrupted.kind, 'recovery');

    const unchanged = new DatabaseSync(join(dataSlotsRoot, 'active', 'workspace.sqlite'), {
        readOnly: true,
        readBigInts: true,
    });
    try {
        assert.equal(
            (unchanged.prepare('PRAGMA user_version').get() as { user_version: bigint }).user_version,
            6n,
        );
        assert.equal(
            (unchanged.prepare(
                "SELECT count(*) AS count FROM sqlite_schema WHERE type = 'table' AND name = 'holiday_ranges'",
            ).get() as { count: bigint }).count,
            0n,
        );
    }
    finally {
        unchanged.close();
    }
    assert.equal(
        readdirSync(dataSlotsRoot).filter(name => name.startsWith('migration-safety-level-6-')).length,
        1,
    );

    const continued = await openWorkspaceDataWithMigrations(dataSlotsRoot);
    assert.equal(continued.kind, 'ready');
    if (continued.kind !== 'ready') {
        throw new Error('Expected level 6 HolidayRange migration to continue');
    }
    assert.equal(continued.store.status().schemaLevel, 8);
    assert.equal(continued.store.status().revision, '2');
    await continued.store.close();
});
