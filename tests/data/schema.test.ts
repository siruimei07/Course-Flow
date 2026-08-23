import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { COURSEFLOW_APPLICATION_ID, CURRENT_SCHEMA_LEVEL } from '../../src/data/schema';
import { initializeWorkspaceData, openWorkspaceData } from '../../src/data/sqlite-data-store';

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

test('TEST-DATA-001/005: level 1 initializes only the current common schema and reopens', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    assert.equal(COURSEFLOW_APPLICATION_ID, 0x43464C57);
    assert.equal(CURRENT_SCHEMA_LEVEL, 1);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    assert.deepEqual(store.status(), {
        kind: 'ready',
        workspaceId: WORKSPACE_ID,
        schemaLevel: 1,
        revision: '0',
    });
    await store.close();

    assert.deepEqual(readSchemaFacts(dataSlotsRoot), {
        applicationId: 0x43464C57,
        userVersion: 1,
        tables: [
            'command_receipts',
            'durable_followups',
            'protection_watermarks',
            'receipt_effects',
            'setup_state',
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

test('level 1 rejects representative constraint violations without changing bootstrap facts', (t) => {
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

test('level 1 rejects a same-name index whose required properties drift', async (t) => {
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
            schemaLevel: 1,
            revision: '0',
        });
        await store.close();
    }
});
