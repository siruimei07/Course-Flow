/**
 * @file Verifies persistent backup configuration and BackupSet identity isolation in DATA.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
    CommittedCommandOutcomeUnknownError,
    initializeWorkspaceData,
    openWorkspaceData,
    openWorkspaceDataWithMigrations,
    type SqliteDataStore,
} from '../../src/data/sqlite-data-store';
import {
    COURSEFLOW_APPLICATION_ID,
    createSchemaLevel11,
} from '../../src/data/schema';
import {
    BACKUP_REPOSITORY_SCHEMA,
    normalizeAcceptedConfigureBackupDestinationCommand,
    type AcceptedConfigureBackupDestinationCommand,
} from '../../src/shared/workspace-protection-contract';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const COMMAND_ID = '22222222-2222-4222-8222-222222222222';
const FOLLOW_UP_ID = '33333333-3333-4333-8333-333333333333';
const FIRST_BACKUP_SET_ID = '44444444-4444-4444-8444-444444444444';
const SECOND_BACKUP_SET_ID = '55555555-5555-4555-8555-555555555555';

function createTempDataSlots(t: test.TestContext): string {
    const dataSlotsRoot = mkdtempSync(path.join(tmpdir(), 'courseflow-protection-data-'));
    t.after(() => rmSync(dataSlotsRoot, { recursive: true, force: true }));
    return dataSlotsRoot;
}

function makeCommand(
    canonicalPath: string,
    backupSetId = FIRST_BACKUP_SET_ID,
    overrides: Partial<AcceptedConfigureBackupDestinationCommand> = {},
): AcceptedConfigureBackupDestinationCommand {
    return normalizeAcceptedConfigureBackupDestinationCommand({
        commandId: COMMAND_ID,
        followUpId: FOLLOW_UP_ID,
        workspaceId: WORKSPACE_ID,
        expectedRevision: '0',
        expectedProtectionVersion: '0',
        intent: {
            kind: 'protect.configure-backup-destination',
            intentSchemaVersion: 1,
            payload: {},
        },
        destination: {
            backupSetId,
            canonicalPath,
            displayName: path.basename(canonicalPath),
            repositorySchema: BACKUP_REPOSITORY_SCHEMA,
        },
        ...overrides,
    });
}

function requireReady(dataSlotsRoot: string): SqliteDataStore {
    const opened = openWorkspaceData(dataSlotsRoot);
    assert.equal(opened.kind, 'ready');
    if (opened.kind !== 'ready') {
        throw new Error('Expected ready Workspace DATA');
    }
    return opened.store;
}

function createLevel11Workspace(dataSlotsRoot: string): void {
    const activeDirectory = path.join(dataSlotsRoot, 'active');
    mkdirSync(activeDirectory);
    const database = new DatabaseSync(path.join(activeDirectory, 'workspace.sqlite'), {
        enableForeignKeyConstraints: true,
    });
    try {
        database.exec(`
            BEGIN IMMEDIATE;
            PRAGMA application_id = ${COURSEFLOW_APPLICATION_ID};
        `);
        createSchemaLevel11(database);
        database.prepare(
            'INSERT INTO workspace_state (singleton, workspace_id, revision) VALUES (1, ?, 4)',
        ).run(WORKSPACE_ID);
        database.exec(`
            INSERT INTO setup_state VALUES (1, NULL, 0, 0);
            INSERT INTO setup_draft_checkpoint VALUES (1, 0, NULL, NULL, NULL);
            INSERT INTO protection_watermarks VALUES (1, 4, 0);
            INSERT INTO plan_state VALUES (1, NULL, 0);
            PRAGMA user_version = 11;
            COMMIT;
        `);
    }
    finally {
        database.close();
    }
}

test('A-DATA-002/TEST-PROTECT-001: unconfigured protection is legal and survives reopen', async t => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);

    assert.deepEqual(store.readDataProtectionProjection(), {
        workspaceRevision: '0',
        protectionEntityVersion: '0',
        configuration: { kind: 'unconfigured' },
    });
    await store.close();

    const reopened = requireReady(dataSlotsRoot);
    assert.deepEqual(reopened.readDataProtectionProjection(), {
        workspaceRevision: '0',
        protectionEntityVersion: '0',
        configuration: { kind: 'unconfigured' },
    });
    await reopened.close();
});

test('A-DATA-002: configuration commits atomically, replays, conflicts, and survives restart', async t => {
    const dataSlotsRoot = createTempDataSlots(t);
    const destination = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const command = makeCommand(destination);

    const committed = await store.commit(command);
    assert.equal(committed.ok, true);
    if (!committed.ok) {
        throw new Error('Expected committed backup configuration');
    }
    assert.deepEqual(committed.value, {
        kind: 'committed',
        revision: '1',
        effects: [{
            code: 'protect.backup-destination-configured',
            entity: {
                kind: 'backup-configuration',
                id: FIRST_BACKUP_SET_ID,
                version: '1',
            },
        }],
        pendingFollowUps: [FOLLOW_UP_ID],
    });
    assert.deepEqual(store.readDataProtectionProjection(), {
        workspaceRevision: '1',
        protectionEntityVersion: '1',
        configuration: {
            kind: 'configured',
            backupSetId: FIRST_BACKUP_SET_ID,
            repositorySchema: BACKUP_REPOSITORY_SCHEMA,
            destinationDisplayName: path.basename(destination),
        },
    });
    assert.deepEqual(await store.commit(command), committed);

    const reused = await store.commit(makeCommand(`${destination}-changed`));
    assert.equal(reused.ok, false);
    if (reused.ok) {
        throw new Error('Expected CommandId reuse conflict');
    }
    assert.equal(reused.problem.details.reason, 'command-id-reused');
    await store.close();

    const reopened = requireReady(dataSlotsRoot);
    assert.deepEqual(reopened.readDataProtectionProjection(), {
        workspaceRevision: '1',
        protectionEntityVersion: '1',
        configuration: {
            kind: 'configured',
            backupSetId: FIRST_BACKUP_SET_ID,
            repositorySchema: BACKUP_REPOSITORY_SCHEMA,
            destinationDisplayName: path.basename(destination),
        },
    });
    assert.deepEqual(reopened.readBackupConfigurationForCommand(COMMAND_ID), command.destination);
    await reopened.close();
});

test('ADR-03: a pre-COMMIT failure leaves configuration, revision, receipt, and watermark unchanged', async t => {
    const dataSlotsRoot = createTempDataSlots(t);
    const destination = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);

    await assert.rejects(store.commit(makeCommand(destination), {
        failpoint(point) {
            if (point === 'commit.after-facts') {
                throw new Error('injected configuration failure');
            }
        },
    }), /Workspace backup configuration commit failed/);
    assert.deepEqual(store.readDataProtectionProjection(), {
        workspaceRevision: '0',
        protectionEntityVersion: '0',
        configuration: { kind: 'unconfigured' },
    });
    assert.equal(store.receipt(COMMAND_ID), null);
    assert.equal(store.readProtectionWatermark(), '0');
    await store.close();

    const reopened = requireReady(dataSlotsRoot);
    assert.deepEqual(reopened.readDataProtectionProjection().configuration, { kind: 'unconfigured' });
    assert.equal(reopened.receipt(COMMAND_ID), null);
    await reopened.close();
});

test('ADR-03: a lost post-COMMIT response remains recoverable by the durable receipt', async t => {
    const dataSlotsRoot = createTempDataSlots(t);
    const destination = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);

    await assert.rejects(store.commit(makeCommand(destination), {
        failpoint(point) {
            if (point === 'commit.after-sqlite-commit') {
                throw new Error('lost configuration response');
            }
        },
    }), CommittedCommandOutcomeUnknownError);
    await store.close();

    const reopened = requireReady(dataSlotsRoot);
    const receipt = reopened.receipt(COMMAND_ID);
    assert.equal(receipt?.effects[0]?.entity.id, FIRST_BACKUP_SET_ID);
    assert.equal(reopened.readDataProtectionProjection().configuration.kind, 'configured');
    await reopened.close();
});

test('TEST-PROTECT-001: independent stores retain distinct BackupSets for the same Workspace', async t => {
    const firstDataSlots = createTempDataSlots(t);
    const secondDataSlots = createTempDataSlots(t);
    const destination = createTempDataSlots(t);
    const first = initializeWorkspaceData(firstDataSlots, WORKSPACE_ID);
    const second = initializeWorkspaceData(secondDataSlots, WORKSPACE_ID);

    const firstResult = await first.commit(makeCommand(destination));
    const secondResult = await second.commit(makeCommand(destination, SECOND_BACKUP_SET_ID, {
        commandId: '66666666-6666-4666-8666-666666666666',
        followUpId: '77777777-7777-4777-8777-777777777777',
    }));
    assert.equal(firstResult.ok, true);
    assert.equal(secondResult.ok, true);
    assert.equal(first.readDataProtectionProjection().configuration.kind, 'configured');
    assert.equal(second.readDataProtectionProjection().configuration.kind, 'configured');
    assert.notDeepEqual(
        first.readDataProtectionProjection().configuration,
        second.readDataProtectionProjection().configuration,
    );
    await first.close();
    await second.close();
});

test('schema level 11 migrates to a legal unconfigured protection state', async t => {
    const dataSlotsRoot = createTempDataSlots(t);
    createLevel11Workspace(dataSlotsRoot);

    const opened = await openWorkspaceDataWithMigrations(dataSlotsRoot);
    assert.equal(opened.kind, 'ready');
    if (opened.kind !== 'ready') {
        throw new Error('Expected current migrated DATA');
    }
    assert.equal(opened.store.status().schemaLevel, 13);
    assert.equal(opened.store.status().revision, '6');
    assert.deepEqual(opened.store.readDataProtectionProjection().configuration, { kind: 'unconfigured' });
    await opened.store.close();
});
