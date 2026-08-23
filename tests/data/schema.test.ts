import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
    COURSEFLOW_APPLICATION_ID,
    CURRENT_SCHEMA_LEVEL,
    migrateLevel0To1,
} from '../../src/data/schema';
import {
    initializeWorkspaceData,
    openWorkspaceData,
    openWorkspaceDataWithMigrations,
} from '../../src/data/sqlite-data-store';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

function createTempDataSlots(t: test.TestContext): string {
    const dataSlotsRoot = mkdtempSync(join(tmpdir(), 'courseflow-data-'));
    t.after(() => rmSync(dataSlotsRoot, { recursive: true, force: true }));
    return dataSlotsRoot;
}

function readSchemaFacts(dataSlotsRoot: string) {
    const database = new DatabaseSync(join(dataSlotsRoot, 'active', 'workspace.sqlite'), {
        readOnly: true,
        readBigInts: true,
    });

    try {
        const applicationId = database.prepare('PRAGMA application_id').get() as { application_id: bigint };
        const userVersion = database.prepare('PRAGMA user_version').get() as { user_version: bigint };
        const tableRows = database.prepare("PRAGMA table_list").all() as Array<{
            name: string;
            type: string;
            strict: bigint;
        }>;
        const revision = database.prepare(
            'SELECT revision FROM workspace_state WHERE singleton = 1',
        );
        revision.setReadBigInts(true);
        const workspace = revision.get() as { revision: bigint };

        return {
            applicationId: Number(applicationId.application_id),
            userVersion: Number(userVersion.user_version),
            tables: tableRows
                .filter((row) => row.type === 'table' && !row.name.startsWith('sqlite_'))
                .map((row) => row.name)
                .sort(),
            allStrict: tableRows
                .filter((row) => row.type === 'table' && !row.name.startsWith('sqlite_'))
                .every((row) => row.strict === 1n),
            revision: workspace.revision,
        };
    } finally {
        database.close();
    }
}

function assertUnchangedAfterRejectedWrite(dataSlotsRoot: string, statement: string): void {
    const database = new DatabaseSync(join(dataSlotsRoot, 'active', 'workspace.sqlite'), {
        enableForeignKeyConstraints: true,
        readBigInts: true,
    });

    try {
        database.exec('BEGIN IMMEDIATE');
        assert.throws(() => database.exec(statement));
        database.exec('ROLLBACK');

        const revision = database.prepare(
            'SELECT revision FROM workspace_state WHERE singleton = 1',
        );
        revision.setReadBigInts(true);
        const receipts = database.prepare('SELECT count(*) AS count FROM command_receipts');
        receipts.setReadBigInts(true);
        const followUps = database.prepare('SELECT count(*) AS count FROM durable_followups');
        followUps.setReadBigInts(true);

        assert.equal((revision.get() as { revision: bigint }).revision, 0n);
        assert.equal((receipts.get() as { count: bigint }).count, 0n);
        assert.equal((followUps.get() as { count: bigint }).count, 0n);
    } finally {
        database.close();
    }
}

test('TEST-DATA-001/005: level 2 initializes the common and delivered Term schema and reopens', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    assert.equal(COURSEFLOW_APPLICATION_ID, 0x43464C57);
    assert.equal(CURRENT_SCHEMA_LEVEL, 2);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    assert.deepEqual(store.status(), {
        kind: 'ready',
        workspaceId: WORKSPACE_ID,
        schemaLevel: 2,
        revision: '0',
    });
    await store.close();

    assert.deepEqual(readSchemaFacts(dataSlotsRoot), {
        applicationId: 0x43464C57,
        userVersion: 2,
        tables: [
            'command_receipts',
            'durable_followups',
            'plan_state',
            'protection_watermarks',
            'receipt_effects',
            'setup_state',
            'terms',
            'workspace_state',
        ],
        allStrict: true,
        revision: 0n,
    });

    const reopened = openWorkspaceData(dataSlotsRoot);
    assert.equal(reopened.kind, 'ready');
    if (reopened.kind === 'ready') {
        await reopened.store.close();
    }
});

test('level 2 rejects representative constraint violations without changing bootstrap facts', (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const activeDatabase = join(dataSlotsRoot, 'active', 'workspace.sqlite');

    return store.close().then(() => {
        for (const { statement } of [
            {
                statement: "UPDATE setup_state SET last_decision = 'invalid' WHERE singleton = 1",
            },
            {
                statement: "UPDATE workspace_state SET revision = 'zero' WHERE singleton = 1",
            },
            {
                statement: "INSERT INTO receipt_effects VALUES ('22222222-2222-4222-8222-222222222222', 0, 'workspace.setup-decision-recorded', 'workspace-setup', '11111111-1111-4111-8111-111111111111', 0)",
            },
            {
                statement: "INSERT INTO protection_watermarks VALUES (1, 0, 0)",
            },
        ]) {
            assertUnchangedAfterRejectedWrite(dataSlotsRoot, statement);
        }

        assert.ok(existsSync(activeDatabase));
    });
});

test('level 2 rejects a same-name index whose required properties drift', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    await store.close();

    const database = new DatabaseSync(join(dataSlotsRoot, 'active', 'workspace.sqlite'));
    try {
        database.exec(`
            DROP INDEX durable_followups_by_command;
            CREATE UNIQUE INDEX durable_followups_by_command
                ON durable_followups(originating_command_id COLLATE NOCASE DESC);
        `);
    } finally {
        database.close();
    }

    assert.deepEqual(openWorkspaceData(dataSlotsRoot), {
        kind: 'recovery',
        sqliteVersion: process.versions.sqlite,
        problem: {
            code: 'integrity',
            scope: 'workspace',
            dataEffect: 'unchanged',
            affectedCapabilities: ['workspace.read', 'workspace.write'],
            allowedActions: [],
            context: {},
            details: { reason: 'schema-mismatch' },
        },
    });
});

test('initialization failpoints leave no active slot and permit a clean retry', async (t) => {
    for (const failpoint of [
        'initialize.after-schema',
        'initialize.after-bootstrap',
        'initialize.after-user-version',
        'initialize.after-validation',
    ] as const) {
        const dataSlotsRoot = createTempDataSlots(t);
        assert.throws(
            () => initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID, { failpoint }),
            new RegExp(failpoint),
        );
        assert.equal(openWorkspaceData(dataSlotsRoot).kind, 'absent');
        assert.equal(existsSync(join(dataSlotsRoot, 'active')), false);

        const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
        assert.deepEqual(store.status(), {
            kind: 'ready',
            workspaceId: WORKSPACE_ID,
            schemaLevel: 2,
            revision: '0',
        });
        await store.close();
    }
});

function createLevel1Workspace(dataSlotsRoot: string): void {
    const active = join(dataSlotsRoot, 'active');
    mkdirSync(active);
    const database = new DatabaseSync(join(active, 'workspace.sqlite'), {
        enableForeignKeyConstraints: true,
    });

    try {
        database.exec('BEGIN IMMEDIATE');
        database.exec(`PRAGMA application_id = ${COURSEFLOW_APPLICATION_ID}`);
        migrateLevel0To1(database);
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
            PRAGMA user_version = 1;
            COMMIT;
        `);
    }
    finally {
        database.close();
    }
}

function addLevel1CommittedReceipt(dataSlotsRoot: string): void {
    const database = new DatabaseSync(join(dataSlotsRoot, 'active', 'workspace.sqlite'), {
        enableForeignKeyConstraints: true,
    });
    try {
        database.exec('BEGIN IMMEDIATE');
        database.exec(`
            UPDATE workspace_state SET revision = 1 WHERE singleton = 1;
            UPDATE setup_state
                SET last_decision = 'later', setup_decision_version = 1
                WHERE singleton = 1;
            UPDATE protection_watermarks SET backup_needed_through = 1 WHERE singleton = 1;
        `);
        database.prepare(`
            INSERT INTO command_receipts (
                command_id,
                intent_kind,
                intent_schema_version,
                canonical_encoding,
                digest_algorithm,
                payload_digest,
                committed_revision,
                result_kind
            ) VALUES (
                'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                'workspace.record-setup-decision',
                1,
                'courseflow-canonical-json-v1',
                'sha256',
                ?,
                1,
                'committed'
            )
        `).run(new Uint8Array(32));
        database.exec(`
            INSERT INTO receipt_effects (
                command_id,
                effect_order,
                effect_code,
                entity_kind,
                entity_id,
                entity_version
            ) VALUES (
                'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                0,
                'workspace.setup-decision-recorded',
                'workspace-setup',
                '${WORKSPACE_ID}',
                1
            );
            INSERT INTO durable_followups (
                follow_up_id,
                originating_command_id,
                owner,
                kind,
                prerequisite_revision,
                state,
                follow_up_version
            ) VALUES (
                'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                'protect',
                'backup-needed-through',
                1,
                'pending',
                0
            );
            COMMIT;
        `);
    }
    finally {
        database.close();
    }
}

test('TEST-DATA-006: level 1 migrates through a retained verified safety copy', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    createLevel1Workspace(dataSlotsRoot);

    const opened = await openWorkspaceDataWithMigrations(dataSlotsRoot);

    assert.equal(opened.kind, 'ready');
    if (opened.kind !== 'ready') {
        throw new Error('Expected migrated ready workspace');
    }
    assert.deepEqual(opened.store.status(), {
        kind: 'ready',
        workspaceId: WORKSPACE_ID,
        schemaLevel: 2,
        revision: '1',
    });
    await opened.store.close();

    const safetyDirectories = readdirSync(dataSlotsRoot)
        .filter((name) => name.startsWith('migration-safety-level-1-'));
    assert.equal(safetyDirectories.length, 1);
    const safetyDatabase = new DatabaseSync(
        join(dataSlotsRoot, safetyDirectories[0]!, 'workspace.sqlite'),
        { readOnly: true, readBigInts: true },
    );
    try {
        assert.equal(
            (safetyDatabase.prepare('PRAGMA user_version').get() as { user_version: bigint }).user_version,
            1n,
        );
        assert.equal(
            (safetyDatabase.prepare(
                'SELECT revision FROM workspace_state WHERE singleton = 1',
            ).get() as { revision: bigint }).revision,
            0n,
        );
    }
    finally {
        safetyDatabase.close();
    }
});

test('TEST-DATA-002/006: level 1 migration preserves receipts and pending follow-ups', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    createLevel1Workspace(dataSlotsRoot);
    addLevel1CommittedReceipt(dataSlotsRoot);

    const opened = await openWorkspaceDataWithMigrations(dataSlotsRoot);

    assert.equal(opened.kind, 'ready');
    if (opened.kind !== 'ready') {
        throw new Error('Expected migrated ready workspace');
    }
    assert.equal(opened.store.status().revision, '2');
    assert.deepEqual(opened.store.receipt('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), {
        kind: 'committed',
        revision: '1',
        effects: [{
            code: 'workspace.setup-decision-recorded',
            entity: { kind: 'workspace-setup', id: WORKSPACE_ID, version: '1' },
        }],
        pendingFollowUps: ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
    });
    assert.equal(opened.store.readPendingFollowUps().length, 1);
    await opened.store.close();
});

test('TEST-DATA-006: migration interruption retains level 1 facts and its verified safety copy', async (t) => {
    for (const failpoint of ['migration.after-safety-copy', 'migration.before-level-commit'] as const) {
        const dataSlotsRoot = createTempDataSlots(t);
        createLevel1Workspace(dataSlotsRoot);

        const opened = await openWorkspaceDataWithMigrations(dataSlotsRoot, {
            migrationFailpoint(point) {
                if (point === failpoint) {
                    throw new Error(point);
                }
            },
        });

        assert.equal(opened.kind, 'recovery');
        const database = new DatabaseSync(join(dataSlotsRoot, 'active', 'workspace.sqlite'), {
            readOnly: true,
            readBigInts: true,
        });
        try {
            assert.equal(
                (database.prepare('PRAGMA user_version').get() as { user_version: bigint }).user_version,
                1n,
            );
            assert.equal(
                (database.prepare(
                    'SELECT revision FROM workspace_state WHERE singleton = 1',
                ).get() as { revision: bigint }).revision,
                0n,
            );
        }
        finally {
            database.close();
        }
        assert.equal(
            readdirSync(dataSlotsRoot).filter((name) => name.startsWith('migration-safety-level-1-')).length,
            1,
        );
    }
});

test('TEST-DATA-005/006: a read-only old level stops without migration or reset', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    createLevel1Workspace(dataSlotsRoot);

    const opened = await openWorkspaceDataWithMigrations(dataSlotsRoot, { readOnly: true });

    assert.equal(opened.kind, 'recovery');
    if (opened.kind !== 'recovery') {
        throw new Error('Expected old read-only workspace to require recovery');
    }
    assert.equal(opened.problem.code, 'incompatible-version');
    assert.deepEqual(opened.problem.details, {
        actualSchemaLevel: 1,
        requiredSchemaLevel: 2,
    });
    assert.deepEqual(readdirSync(dataSlotsRoot), ['active']);
});
