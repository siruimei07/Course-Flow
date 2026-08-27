/**
 * @file Verifies SQLite schema initialization, migration, and integrity gates.
 */

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
    COURSEFLOW_APPLICATION_ID,
    CURRENT_SCHEMA_LEVEL,
    createSchemaLevel13,
    createSchemaLevel2,
    migrateLevel0To1,
    migrateLevel2To3,
    migrateLevel3To4,
    migrateLevel4To5,
    validateSchemaLevel1,
} from '../../src/data/schema';
import {
    initializeWorkspaceData,
    inspectMigrationSafetyCopy,
    openWorkspaceData,
    openWorkspaceDataWithMigrations as openWorkspaceDataWithMigrationsUnbound,
    consumeMigrationSafetyCopyAfterRollback,
    stageMigrationSafetyCopyForRollback,
} from '../../src/data/sqlite-data-store';
import {
    observeRestoreDataSlot,
    renameRestoreDataSlot,
    stageRestoreDataSlot,
} from '../../src/platform/restore-activation-files';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_APP_BUILD_ID = 'development:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TARGET_APP_BUILD_ID = 'development:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const MIGRATION_ROLLBACK_OPERATION_ID = '22222222-2222-4222-8222-222222222222';
const MIGRATION_SAFETY_COPY_OPTIONS = Object.freeze({
    createdByAppBuildId: SOURCE_APP_BUILD_ID,
    rollbackTarget: Object.freeze({
        releaseVersion: '0.0.0-development-old',
        tag: 'development-old',
        appBuildId: TARGET_APP_BUILD_ID,
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
const LEGACY_COURSE_DIGEST_HEX = 'ea56e352db9e80e799cd0b31961a85849aa11d97de6995e5c7815062a6c69fbc';
const LEGACY_COURSE_COMMAND = {
    commandId: '66666666-6666-4666-8666-666666666666',
    followUpId: '77777777-7777-4777-8777-777777777777',
    expectedRevision: '2',
    expectedPlanVersion: '1',
    intent: {
        kind: 'plan.create-course-with-first-meeting',
        intentSchemaVersion: 1,
        payload: {
            course: {
                code: 'CSC301',
                name: 'Introduction to Software Engineering',
                section: 'L0101',
                instructor: 'Ada Lovelace',
                color: 'blue',
                credits: '0.5',
            },
            meeting: {
                type: 'LEC',
                weekday: 'MON',
                localStart: '09:00',
                localEnd: '10:00',
                effectiveStartDate: '2026-09-08',
                effectiveEndDate: '2026-12-18',
                location: { kind: 'known', value: 'BA 1130' },
            },
        },
    },
} as const;

function createTempDataSlots(t: test.TestContext): string {
    const dataSlotsRoot = mkdtempSync(join(tmpdir(), 'courseflow-data-'));
    t.after(() => rmSync(dataSlotsRoot, { recursive: true, force: true }));
    return dataSlotsRoot;
}

function openWorkspaceDataWithMigrations(
    dataSlotsRoot: string,
    options: Parameters<typeof openWorkspaceDataWithMigrationsUnbound>[1] = {},
) {
    return openWorkspaceDataWithMigrationsUnbound(dataSlotsRoot, {
        ...options,
        migrationSafetyCopy: options.migrationSafetyCopy ?? MIGRATION_SAFETY_COPY_OPTIONS,
    });
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

test('TEST-DATA-001/005: current schema initializes Meeting, HolidayRange, Task, and setup draft facts', async t => {
    const dataSlotsRoot = createTempDataSlots(t);
    assert.equal(COURSEFLOW_APPLICATION_ID, 0x43464C57);
    assert.equal(CURRENT_SCHEMA_LEVEL, 16);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    assert.deepEqual(store.status(), {
        kind: 'ready',
        workspaceId: WORKSPACE_ID,
        schemaLevel: 16,
        revision: '0',
    });
    await store.close();

    assert.deepEqual(readSchemaFacts(dataSlotsRoot), {
        applicationId: 0x43464C57,
        userVersion: 16,
        tables: [
            'backup_cleanup_operations',
            'backup_configuration',
            'backup_operations',
            'backup_snapshots',
            'command_receipts',
            'courses',
            'durable_followups',
            'holiday_ranges',
            'meeting_occurrence_overrides',
            'meeting_segments',
            'meeting_series',
            'plan_state',
            'protection_watermarks',
            'receipt_effects',
            'restore_command_receipts',
            'restore_completion_receipts',
            'restore_sessions',
            'setup_draft_checkpoint',
            'setup_state',
            'task_occurrence_overrides',
            'task_occurrence_states',
            'task_segments',
            'task_series',
            'task_state_history',
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

test('current schema rejects representative constraint violations without changing bootstrap facts', t => {
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
                statement: `
                    INSERT INTO receipt_effects VALUES (
                        '22222222-2222-4222-8222-222222222222',
                        0,
                        'workspace.setup-decision-recorded',
                        'workspace-setup',
                        '11111111-1111-4111-8111-111111111111',
                        0
                    )
                `,
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

test('level 10 rejects a same-name index whose required properties drift', async t => {
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
            schemaLevel: 16,
            revision: '0',
        });
        await store.close();
    }
});

test('TEST-DATA-006: level 15 sessions survive typed Restore receipt migration', async t => {
    const dataSlotsRoot = createTempDataSlots(t);
    const initialized = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    await initialized.close();

    const activeDatabasePath = join(dataSlotsRoot, 'active', 'workspace.sqlite');
    const level14Database = new DatabaseSync(activeDatabasePath);
    try {
        level14Database.exec(`
            BEGIN IMMEDIATE;
            DROP TABLE restore_completion_receipts;
            DROP TABLE restore_command_receipts;
            DROP TABLE restore_sessions;
            PRAGMA user_version = 14;
            COMMIT;
        `);
    }
    finally {
        level14Database.close();
    }

    let levelCommitCount = 0;
    const interrupted = await openWorkspaceDataWithMigrations(dataSlotsRoot, {
        migrationFailpoint(point) {
            if (point === 'migration.before-level-commit') {
                levelCommitCount += 1;
            }
            if (point === 'migration.before-level-commit' && levelCommitCount === 2) {
                throw new Error('stop-at-level-15');
            }
        },
    });
    assert.equal(interrupted.kind, 'recovery');
    const level15Database = new DatabaseSync(activeDatabasePath);
    try {
        assert.equal(
            (level15Database.prepare('PRAGMA user_version').get() as {user_version: number}).user_version,
            15,
        );
        level15Database.exec(`
            PRAGMA foreign_keys = ON;
            INSERT INTO restore_sessions (
                restore_session_id,
                operation_id,
                candidate_ref,
                snapshot_id,
                candidate_root_digest,
                candidate_database_digest,
                source_schema_level,
                prepared_schema_level,
                candidate_revision,
                validation_copy,
                current_workspace_id,
                current_revision,
                current_library_kind,
                current_library_root_id,
                current_root_generation,
                target_binding_version,
                term_count,
                course_count,
                task_series_count,
                impact_digest,
                binding_digest,
                preview_token,
                phase,
                session_version,
                problem_code,
                safety_set_id,
                safety_protected_revision,
                safety_root_digest
            ) VALUES (
                '22222222-2222-4222-8222-222222222222',
                '33333333-3333-4333-8333-333333333333',
                '44444444-4444-4444-8444-444444444444',
                '55555555-5555-4555-8555-555555555555',
                '${'a'.repeat(64)}',
                '${'b'.repeat(64)}',
                15,
                15,
                1,
                'copied',
                '${WORKSPACE_ID}',
                (SELECT revision FROM workspace_state WHERE singleton = 1),
                'absent',
                NULL,
                NULL,
                0,
                0,
                0,
                0,
                '${'c'.repeat(64)}',
                '${'d'.repeat(64)}',
                '${'e'.repeat(64)}',
                'previewed',
                0,
                NULL,
                NULL,
                NULL,
                NULL
            );
            INSERT INTO restore_command_receipts VALUES (
                '66666666-6666-4666-8666-666666666666',
                'start',
                zeroblob(32),
                '22222222-2222-4222-8222-222222222222',
                0
            );
        `);
    }
    finally {
        level15Database.close();
    }

    const opened = await openWorkspaceDataWithMigrations(dataSlotsRoot);

    assert.equal(opened.kind, 'ready');
    if (opened.kind !== 'ready') {
        throw new Error('Expected level 15 migration to open ready');
    }
    assert.deepEqual(opened.store.status(), {
        kind: 'ready',
        workspaceId: WORKSPACE_ID,
        schemaLevel: 16,
        revision: '2',
    });
    assert.equal(opened.store.readRestoreSessions()[0]?.preparedSchemaLevel, '15');
    await opened.store.close();
    assert.equal(readSchemaFacts(dataSlotsRoot).tables.includes('restore_completion_receipts'), true);
});

test('ADR-04/WP-R5-03: level 13 migrates to the resumable cleanup journal', async t => {
    const dataSlotsRoot = createTempDataSlots(t);
    const active = join(dataSlotsRoot, 'active');
    mkdirSync(active);
    const database = new DatabaseSync(join(dataSlotsRoot, 'active', 'workspace.sqlite'));
    try {
        database.exec('BEGIN IMMEDIATE');
        database.exec(`PRAGMA application_id = ${COURSEFLOW_APPLICATION_ID}`);
        createSchemaLevel13(database);
        database.prepare(
            'INSERT INTO workspace_state (singleton, workspace_id, revision) VALUES (1, ?, 3)',
        ).run(WORKSPACE_ID);
        database.exec(`
            INSERT INTO setup_state (
                singleton,
                last_decision,
                setup_decision_version,
                ever_reached_minimum
            ) VALUES (1, NULL, 0, 0);
            INSERT INTO setup_draft_checkpoint (
                singleton,
                checkpoint_version,
                schema_version,
                updated_at,
                opaque_payload
            ) VALUES (1, 0, NULL, NULL, NULL);
            INSERT INTO protection_watermarks (
                singleton,
                backup_needed_through,
                backup_succeeded_through
            ) VALUES (1, 3, 2);
            INSERT INTO plan_state (
                singleton,
                current_term_id,
                plan_entity_version
            ) VALUES (1, NULL, 0);
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
                '22222222-2222-4222-8222-222222222222',
                'protect.configure-backup-destination',
                1,
                'courseflow-canonical-json-v1',
                'sha256',
                zeroblob(32),
                1,
                'committed'
            );
            INSERT INTO receipt_effects (
                command_id,
                effect_order,
                effect_code,
                entity_kind,
                entity_id,
                entity_version
            ) VALUES (
                '22222222-2222-4222-8222-222222222222',
                0,
                'protect.backup-destination-configured',
                'backup-configuration',
                '33333333-3333-4333-8333-333333333333',
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
                '44444444-4444-4444-8444-444444444444',
                '22222222-2222-4222-8222-222222222222',
                'protect',
                'backup-needed-through',
                1,
                'completed',
                1
            );
            INSERT INTO backup_configuration (
                singleton,
                configuration_version,
                backup_set_id,
                repository_schema,
                canonical_destination_path,
                destination_display_name,
                originating_command_id,
                configured_revision
            ) VALUES (
                1,
                1,
                '33333333-3333-4333-8333-333333333333',
                'courseflow-backup-repository-v1',
                'fixture-destination',
                'fixture-destination',
                '22222222-2222-4222-8222-222222222222',
                1
            );
            INSERT INTO backup_operations VALUES (
                '55555555-5555-4555-8555-555555555555',
                '33333333-3333-4333-8333-333333333333',
                1,
                '66666666-6666-4666-8666-666666666666',
                1,
                2,
                '.staging-55555555-5555-4555-8555-555555555555-0123456789abcdef',
                '2026-08-25T12:00:00.000Z',
                'succeeded',
                7
            );
            INSERT INTO backup_snapshots VALUES (
                '66666666-6666-4666-8666-666666666666',
                '55555555-5555-4555-8555-555555555555',
                '33333333-3333-4333-8333-333333333333',
                1,
                2,
                '${'a'.repeat(64)}',
                '2026-08-25T12:00:01.000Z'
            );
            INSERT INTO backup_operations VALUES (
                '77777777-7777-4777-8777-777777777777',
                '33333333-3333-4333-8333-333333333333',
                2,
                '88888888-8888-4888-8888-888888888888',
                3,
                NULL,
                '.staging-77777777-7777-4777-8777-777777777777-fedcba9876543210',
                '2026-08-25T12:00:02.000Z',
                'queued',
                0
            );
            PRAGMA user_version = 13;
            COMMIT;
        `);
    }
    finally {
        database.close();
    }

    const opened = await openWorkspaceDataWithMigrations(dataSlotsRoot);
    assert.equal(opened.kind, 'ready');
    if (opened.kind !== 'ready') {
        throw new Error('Expected level 13 migration to open ready');
    }
    assert.deepEqual(opened.store.status(), {
        kind: 'ready',
        workspaceId: WORKSPACE_ID,
        schemaLevel: 16,
        revision: '6',
    });
    assert.equal(opened.store.readProtectionWatermark(), '6');
    assert.equal(opened.store.readBackupCleanupOperation(), null);
    assert.deepEqual(opened.store.readSuccessfulBackupSnapshots().map(snapshot => snapshot.snapshotId), [
        '66666666-6666-4666-8666-666666666666',
    ]);
    assert.equal(opened.store.readBackupOperation()?.snapshotId, '88888888-8888-4888-8888-888888888888');
    await opened.store.close();
    assert.equal(
        readdirSync(dataSlotsRoot).filter(name => name.startsWith('migration-safety-copy-')).length,
        1,
    );
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

test('TEST-DATA-007: a verified V1 safety copy is registered before the first schema write', async t => {
    const dataSlotsRoot = createTempDataSlots(t);
    createLevel1Workspace(dataSlotsRoot);
    const activeDatabasePath = join(dataSlotsRoot, 'active', 'workspace.sqlite');
    const activeBefore = readFileSync(activeDatabasePath);

    const opened = await openWorkspaceDataWithMigrations(dataSlotsRoot, {
        migrationSafetyCopy: MIGRATION_SAFETY_COPY_OPTIONS,
        migrationFailpoint(point) {
            if (point === 'migration.after-safety-copy') {
                throw new Error(point);
            }
        },
    });

    assert.equal(opened.kind, 'recovery');
    assert.deepEqual(readFileSync(activeDatabasePath), activeBefore);
    const status = inspectMigrationSafetyCopy(dataSlotsRoot);
    assert.equal(status.kind, 'verified');
    if (status.kind !== 'verified') {
        throw new Error('Expected one verified MigrationSafetyCopyV1');
    }
    assert.match(status.metadata.migrationSafetyCopyId, /^[0-9a-f-]{36}$/);
    assert.deepEqual(status.metadata, {
        schema: 'courseflow-migration-safety-copy-v1',
        limitsVersion: 'migration-safety-copy-limits-v1',
        digestVersion: 'sha256-v1',
        migrationSafetyCopyId: status.metadata.migrationSafetyCopyId,
        workspaceId: WORKSPACE_ID,
        sourceRevision: '0',
        sourceSchemaLevel: '1',
        targetSchemaLevel: '16',
        createdAt: '2026-08-27T12:00:00.000Z',
        byteSize: status.metadata.byteSize,
        closedDataSlotDigest: status.metadata.closedDataSlotDigest,
        sourceDataSlotProvenance: status.metadata.sourceDataSlotProvenance,
        createdByAppBuildId: SOURCE_APP_BUILD_ID,
        rollbackTarget: MIGRATION_SAFETY_COPY_OPTIONS.rollbackTarget,
        replacesMigrationSafetyCopyId: null,
        metadataDigest: status.metadata.metadataDigest,
    });
    assert.match(status.metadata.byteSize, /^[1-9][0-9]*$/);
    assert.match(status.metadata.closedDataSlotDigest, /^[0-9a-f]{64}$/);
    assert.match(status.metadata.metadataDigest, /^[0-9a-f]{64}$/);
    assert.deepEqual(Object.keys(status.metadata.sourceDataSlotProvenance).sort(), [
        'databaseDevice',
        'databaseInode',
        'schema',
        'slotDevice',
        'slotInode',
    ]);
    assert.equal(
        status.metadata.sourceDataSlotProvenance.schema,
        'courseflow-data-slot-stable-identity-v1',
    );
    for (const value of [
        status.metadata.sourceDataSlotProvenance.slotDevice,
        status.metadata.sourceDataSlotProvenance.slotInode,
        status.metadata.sourceDataSlotProvenance.databaseDevice,
        status.metadata.sourceDataSlotProvenance.databaseInode,
    ]) {
        assert.match(value, /^(0|[1-9][0-9]*)$/);
    }
    assert.equal(
        JSON.stringify(status.metadata.sourceDataSlotProvenance).includes(dataSlotsRoot),
        false,
    );

    const safetyDirectory = join(
        dataSlotsRoot,
        `migration-safety-copy-${status.metadata.migrationSafetyCopyId}`,
    );
    const safetyDatabase = readFileSync(join(safetyDirectory, 'workspace.sqlite'));
    assert.equal(status.metadata.byteSize, String(safetyDatabase.byteLength));
    assert.equal(
        status.metadata.closedDataSlotDigest,
        createHash('sha256').update(safetyDatabase).digest('hex'),
    );
    assert.deepEqual(readdirSync(safetyDirectory).sort(), [
        'migration-safety-copy-v1.json',
        'workspace.sqlite',
    ]);
});

test('TEST-DATA-007: current schema opens without creating a migration safety copy', async t => {
    const dataSlotsRoot = createTempDataSlots(t);
    const initialized = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    await initialized.close();

    const opened = await openWorkspaceDataWithMigrations(dataSlotsRoot);

    assert.equal(opened.kind, 'ready');
    if (opened.kind === 'ready') {
        await opened.store.close();
    }
    assert.deepEqual(inspectMigrationSafetyCopy(dataSlotsRoot), {kind: 'absent'});
    assert.deepEqual(readdirSync(dataSlotsRoot), ['active']);
});

test('TEST-DATA-007: an old schema without an exact build binding remains unchanged', async t => {
    const dataSlotsRoot = createTempDataSlots(t);
    createLevel1Workspace(dataSlotsRoot);
    const databasePath = join(dataSlotsRoot, 'active', 'workspace.sqlite');
    const before = readFileSync(databasePath);

    const opened = await openWorkspaceDataWithMigrationsUnbound(dataSlotsRoot);

    assert.equal(opened.kind, 'recovery');
    if (opened.kind !== 'recovery') {
        throw new Error('Expected an exact migration build binding to be required');
    }
    assert.deepEqual(opened.problem, {
        code: 'migration-safety-unavailable',
        scope: 'workspace',
        dataEffect: 'unchanged',
        affectedCapabilities: ['workspace.read', 'workspace.write'],
        allowedActions: [],
        context: {},
        details: {reason: 'build-binding-missing'},
    });
    assert.deepEqual(readFileSync(databasePath), before);
    assert.deepEqual(inspectMigrationSafetyCopy(dataSlotsRoot), {kind: 'absent'});
});

test('TEST-DATA-007: restart reuses the one verified copy before continuing migration', async t => {
    const dataSlotsRoot = createTempDataSlots(t);
    createLevel1Workspace(dataSlotsRoot);
    const interrupted = await openWorkspaceDataWithMigrations(dataSlotsRoot, {
        migrationFailpoint(point) {
            if (point === 'migration.after-safety-copy') {
                throw new Error(point);
            }
        },
    });
    assert.equal(interrupted.kind, 'recovery');
    const firstStatus = inspectMigrationSafetyCopy(dataSlotsRoot);
    assert.equal(firstStatus.kind, 'verified');
    if (firstStatus.kind !== 'verified') {
        throw new Error('Expected the interrupted migration copy');
    }

    const continued = await openWorkspaceDataWithMigrations(dataSlotsRoot);

    assert.equal(continued.kind, 'ready');
    if (continued.kind === 'ready') {
        await continued.store.close();
    }
    const finalStatus = inspectMigrationSafetyCopy(dataSlotsRoot);
    assert.equal(finalStatus.kind, 'verified');
    if (finalStatus.kind !== 'verified') {
        throw new Error('Expected the retained migration copy');
    }
    assert.equal(
        finalStatus.metadata.migrationSafetyCopyId,
        firstStatus.metadata.migrationSafetyCopyId,
    );
    assert.equal(
        readdirSync(dataSlotsRoot).filter(name => name.startsWith('migration-safety-copy-')).length,
        1,
    );
});

test('TEST-DATA-007: a verified copy from an earlier source revision is never reused', async t => {
    const dataSlotsRoot = createTempDataSlots(t);
    createLevel1Workspace(dataSlotsRoot);
    const first = await openWorkspaceDataWithMigrations(dataSlotsRoot, {
        migrationFailpoint(point) {
            if (point === 'migration.after-safety-copy') {
                throw new Error(point);
            }
        },
    });
    assert.equal(first.kind, 'recovery');
    const stale = inspectMigrationSafetyCopy(dataSlotsRoot);
    assert.equal(stale.kind, 'verified');
    if (stale.kind !== 'verified') {
        throw new Error('Expected the first verified copy');
    }
    addLevel1CommittedReceipt(dataSlotsRoot);

    const retried = await openWorkspaceDataWithMigrations(dataSlotsRoot, {
        migrationFailpoint(point) {
            if (point === 'migration.after-safety-copy') {
                throw new Error(point);
            }
        },
    });

    assert.equal(retried.kind, 'recovery');
    const current = inspectMigrationSafetyCopy(dataSlotsRoot);
    assert.equal(current.kind, 'verified');
    if (current.kind !== 'verified') {
        throw new Error('Expected the source-revision-bound replacement copy');
    }
    assert.notEqual(
        current.metadata.migrationSafetyCopyId,
        stale.metadata.migrationSafetyCopyId,
    );
    assert.equal(current.metadata.sourceSchemaLevel, '1');
    assert.equal(current.metadata.sourceRevision, '1');
});

test('TEST-DATA-007: an active content branch swap cannot reuse another branch safety copy', async t => {
    const dataSlotsRoot = createTempDataSlots(t);
    createLevel1Workspace(dataSlotsRoot);
    addLevel1CommittedReceipt(dataSlotsRoot);
    const interrupted = await openWorkspaceDataWithMigrations(dataSlotsRoot, {
        migrationFailpoint(point) {
            if (point === 'migration.after-safety-copy') {
                throw new Error(point);
            }
        },
    });
    assert.equal(interrupted.kind, 'recovery');
    const branchASafety = inspectMigrationSafetyCopy(dataSlotsRoot);
    assert.equal(branchASafety.kind, 'verified');
    if (branchASafety.kind !== 'verified') {
        throw new Error('Expected branch A safety copy');
    }

    const branchBName = '.migration-safety-branch-b';
    stageRestoreDataSlot(
        join(dataSlotsRoot, 'active', 'workspace.sqlite'),
        dataSlotsRoot,
        branchBName,
    );
    const branchBDatabase = new DatabaseSync(
        join(dataSlotsRoot, branchBName, 'workspace.sqlite'),
        {enableForeignKeyConstraints: true},
    );
    try {
        branchBDatabase.exec(`
            UPDATE setup_state
            SET last_decision = 'skip'
            WHERE singleton = 1;
        `);
        validateSchemaLevel1(branchBDatabase);
    }
    finally {
        branchBDatabase.close();
    }
    const branchA = observeRestoreDataSlot(dataSlotsRoot, 'active');
    const branchB = observeRestoreDataSlot(dataSlotsRoot, branchBName);
    assert.equal(branchA.kind, 'present');
    assert.equal(branchB.kind, 'present');
    if (branchA.kind !== 'present' || branchB.kind !== 'present') {
        throw new Error('Expected both test DATA branches');
    }
    renameRestoreDataSlot(
        dataSlotsRoot,
        'active',
        '.migration-safety-branch-a',
        branchA.fingerprint.slotFingerprint,
    );
    renameRestoreDataSlot(
        dataSlotsRoot,
        branchBName,
        'active',
        branchB.fingerprint.slotFingerprint,
    );

    const retried = await openWorkspaceDataWithMigrations(dataSlotsRoot, {
        migrationFailpoint(point) {
            if (point === 'migration.after-safety-copy') {
                throw new Error(point);
            }
        },
    });

    assert.equal(retried.kind, 'recovery');
    const branchBSafety = inspectMigrationSafetyCopy(dataSlotsRoot);
    assert.equal(branchBSafety.kind, 'verified');
    if (branchBSafety.kind !== 'verified') {
        throw new Error('Expected branch B safety copy');
    }
    assert.notEqual(
        branchBSafety.metadata.migrationSafetyCopyId,
        branchASafety.metadata.migrationSafetyCopyId,
    );
    assert.equal(
        readdirSync(dataSlotsRoot).filter(name => name.startsWith('migration-safety-copy-')).length,
        1,
    );
    const safetyDatabase = new DatabaseSync(join(
        dataSlotsRoot,
        `migration-safety-copy-${branchBSafety.metadata.migrationSafetyCopyId}`,
        'workspace.sqlite',
    ), {readOnly: true});
    try {
        const row = safetyDatabase.prepare(`
            SELECT last_decision
            FROM setup_state
            WHERE singleton = 1
        `).get() as {last_decision: string | null};
        assert.equal(row.last_decision, 'skip');
    }
    finally {
        safetyDatabase.close();
    }
});

test('TEST-DATA-007: every replacement interruption preserves one registered verified copy', async t => {
    for (const failpoint of [
        'migration-safety.after-database-copy',
        'migration-safety.after-metadata-write',
        'migration-safety.after-publish',
        'migration-safety.after-previous-quarantine',
        'migration-safety.after-previous-member-delete',
    ] as const) {
        const dataSlotsRoot = createTempDataSlots(t);
        createLevel1Workspace(dataSlotsRoot);
        const first = await openWorkspaceDataWithMigrations(dataSlotsRoot, {
            migrationFailpoint(point) {
                if (point === 'migration.after-safety-copy') {
                    throw new Error(point);
                }
            },
        });
        assert.equal(first.kind, 'recovery');
        const oldStatus = inspectMigrationSafetyCopy(dataSlotsRoot);
        assert.equal(oldStatus.kind, 'verified');
        if (oldStatus.kind !== 'verified') {
            throw new Error('Expected the previous verified copy');
        }
        const replacementBinding = Object.freeze({
            ...MIGRATION_SAFETY_COPY_OPTIONS,
            createdByAppBuildId: 'development:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        });

        const interrupted = await openWorkspaceDataWithMigrations(dataSlotsRoot, {
            migrationSafetyCopy: replacementBinding,
            migrationFailpoint(point) {
                if (point === failpoint) {
                    throw new Error(point);
                }
            },
        });

        assert.equal(interrupted.kind, 'recovery');
        const registered = inspectMigrationSafetyCopy(dataSlotsRoot);
        assert.equal(registered.kind, 'verified');
        if (registered.kind !== 'verified') {
            throw new Error('Expected one registered verified copy after interruption');
        }
        const replacementWasPublished = failpoint === 'migration-safety.after-publish'
            || failpoint === 'migration-safety.after-previous-quarantine'
            || failpoint === 'migration-safety.after-previous-member-delete';
        if (replacementWasPublished) {
            assert.equal(
                registered.metadata.createdByAppBuildId,
                replacementBinding.createdByAppBuildId,
            );
            assert.equal(
                registered.metadata.replacesMigrationSafetyCopyId,
                oldStatus.metadata.migrationSafetyCopyId,
            );
        }
        else {
            assert.equal(
                registered.metadata.migrationSafetyCopyId,
                oldStatus.metadata.migrationSafetyCopyId,
            );
        }

        const retried = await openWorkspaceDataWithMigrations(dataSlotsRoot, {
            migrationSafetyCopy: replacementBinding,
            migrationFailpoint(point) {
                if (point === 'migration.after-safety-copy') {
                    throw new Error(point);
                }
            },
        });
        assert.equal(retried.kind, 'recovery');
        const replaced = inspectMigrationSafetyCopy(dataSlotsRoot);
        assert.equal(replaced.kind, 'verified');
        if (replaced.kind !== 'verified') {
            throw new Error('Expected the replacement copy');
        }
        assert.notEqual(
            replaced.metadata.migrationSafetyCopyId,
            oldStatus.metadata.migrationSafetyCopyId,
        );
        assert.equal(replaced.metadata.createdByAppBuildId, replacementBinding.createdByAppBuildId);
        assert.equal(
            readdirSync(dataSlotsRoot).filter(name => name.startsWith('migration-safety-copy-')).length,
            1,
        );
        assert.equal(
            readdirSync(dataSlotsRoot).filter(name => name.startsWith('.migration-safety-')).length,
            0,
        );
    }
});

test('TEST-DATA-007: rollback staging and safety-copy consumption stay path-private and restartable', async t => {
    const dataSlotsRoot = createTempDataSlots(t);
    createLevel1Workspace(dataSlotsRoot);
    const interrupted = await openWorkspaceDataWithMigrations(dataSlotsRoot, {
        migrationFailpoint(point) {
            if (point === 'migration.after-safety-copy') {
                throw new Error(point);
            }
        },
    });
    assert.equal(interrupted.kind, 'recovery');
    const safety = inspectMigrationSafetyCopy(dataSlotsRoot);
    assert.equal(safety.kind, 'verified');
    if (safety.kind !== 'verified') {
        throw new Error('Expected rollback source copy');
    }
    const candidateName = `.migration-rollback-candidate-${MIGRATION_ROLLBACK_OPERATION_ID}`;

    const staged = stageMigrationSafetyCopyForRollback(
        dataSlotsRoot,
        safety.metadata.migrationSafetyCopyId,
        candidateName,
    );

    assert.deepEqual(staged.members, [{
        path: 'workspace.sqlite',
        byteLength: safety.metadata.byteSize,
        sha256: safety.metadata.closedDataSlotDigest,
    }]);
    assert.equal(JSON.stringify(staged).includes(dataSlotsRoot), false);
    const active = observeRestoreDataSlot(dataSlotsRoot, 'active');
    assert.equal(active.kind, 'present');
    if (active.kind !== 'present') {
        throw new Error('Expected current migrated slot');
    }
    renameRestoreDataSlot(
        dataSlotsRoot,
        'active',
        `.migration-rollback-rollback-${MIGRATION_ROLLBACK_OPERATION_ID}`,
        active.fingerprint.slotFingerprint,
    );
    renameRestoreDataSlot(
        dataSlotsRoot,
        candidateName,
        'active',
        staged.slotFingerprint,
    );

    assert.throws(() => consumeMigrationSafetyCopyAfterRollback(
        dataSlotsRoot,
        safety.metadata.migrationSafetyCopyId,
        MIGRATION_ROLLBACK_OPERATION_ID,
        {
            failpoint(point) {
                if (point === 'migration-safety-consume.after-quarantine') {
                    throw new Error(point);
                }
            },
        },
    ), /migration-safety-consume\.after-quarantine/);
    assert.deepEqual(inspectMigrationSafetyCopy(dataSlotsRoot), {kind: 'absent'});

    assert.throws(() => consumeMigrationSafetyCopyAfterRollback(
        dataSlotsRoot,
        safety.metadata.migrationSafetyCopyId,
        MIGRATION_ROLLBACK_OPERATION_ID,
        {
            failpoint(point) {
                if (point === 'migration-safety-consume.after-database-delete') {
                    throw new Error(point);
                }
            },
        },
    ), /migration-safety-consume\.after-database-delete/);
    const consumedName = [
        '.migration-safety-consumed',
        MIGRATION_ROLLBACK_OPERATION_ID,
        safety.metadata.migrationSafetyCopyId,
    ].join('-');
    assert.deepEqual(readdirSync(join(dataSlotsRoot, consumedName)), [
        'migration-safety-copy-v1.json',
    ]);

    consumeMigrationSafetyCopyAfterRollback(
        dataSlotsRoot,
        safety.metadata.migrationSafetyCopyId,
        MIGRATION_ROLLBACK_OPERATION_ID,
    );
    assert.equal(
        readdirSync(dataSlotsRoot).filter(name => name.startsWith('migration-safety-copy-')).length,
        0,
    );
    assert.equal(
        readdirSync(dataSlotsRoot).filter(name => name.startsWith('.migration-safety-consumed-')).length,
        1,
    );
});

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
        schemaLevel: 16,
        revision: '15',
    });
    await opened.store.close();

    const safetyDirectories = readdirSync(dataSlotsRoot)
        .filter((name) => name.startsWith('migration-safety-copy-'));
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

test('TEST-DATA-005/006: level 14 migrates through its retained verified safety copy', async t => {
    const dataSlotsRoot = createTempDataSlots(t);
    const initialized = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    await initialized.close();

    const activeDatabasePath = join(dataSlotsRoot, 'active', 'workspace.sqlite');
    const level14Database = new DatabaseSync(activeDatabasePath);
    try {
        level14Database.exec(`
            BEGIN IMMEDIATE;
            DROP TABLE restore_completion_receipts;
            DROP TABLE restore_command_receipts;
            DROP TABLE restore_sessions;
            PRAGMA user_version = 14;
            COMMIT;
        `);
    }
    finally {
        level14Database.close();
    }

    const opened = await openWorkspaceDataWithMigrations(dataSlotsRoot);

    assert.equal(opened.kind, 'ready');
    if (opened.kind !== 'ready') {
        throw new Error('Expected level 14 migration to open ready');
    }
    assert.deepEqual(opened.store.status(), {
        kind: 'ready',
        workspaceId: WORKSPACE_ID,
        schemaLevel: 16,
        revision: '2',
    });
    await opened.store.close();

    const safetyDirectories = readdirSync(dataSlotsRoot)
        .filter(name => name.startsWith('migration-safety-copy-'));
    assert.equal(safetyDirectories.length, 1);
    const safetyDatabase = new DatabaseSync(
        join(dataSlotsRoot, safetyDirectories[0]!, 'workspace.sqlite'),
        { readOnly: true, readBigInts: true },
    );
    try {
        assert.equal(
            (safetyDatabase.prepare('PRAGMA user_version').get() as { user_version: bigint }).user_version,
            14n,
        );
        assert.equal(
            (safetyDatabase.prepare(
                "SELECT count(*) AS count FROM pragma_table_list WHERE name LIKE 'restore_%'",
            ).get() as { count: bigint }).count,
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
    assert.equal(opened.store.status().revision, '16');
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
            readdirSync(dataSlotsRoot).filter((name) => name.startsWith('migration-safety-copy-')).length,
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
        requiredSchemaLevel: 16,
    });
    assert.deepEqual(readdirSync(dataSlotsRoot), ['active']);
});

test('TEST-DATA-005/006: read-only old schema validates before reporting incompatible', async t => {
    const dataSlotsRoot = createTempDataSlots(t);
    createLevel1Workspace(dataSlotsRoot);
    const database = new DatabaseSync(join(dataSlotsRoot, 'active', 'workspace.sqlite'));
    try {
        database.exec('DROP INDEX durable_followups_by_command');
    }
    finally {
        database.close();
    }

    const opened = await openWorkspaceDataWithMigrations(dataSlotsRoot, { readOnly: true });

    assert.equal(opened.kind, 'recovery');
    if (opened.kind !== 'recovery') {
        throw new Error('Expected invalid old read-only workspace to require recovery');
    }
    assert.equal(opened.problem.code, 'integrity');
    if (opened.problem.code !== 'integrity') {
        throw new Error('Expected invalid old schema to report integrity');
    }
    assert.deepEqual(opened.problem.details, { reason: 'schema-mismatch' });
    assert.deepEqual(readdirSync(dataSlotsRoot), ['active']);
});

function createLevel2WorkspaceWithTerm(dataSlotsRoot: string): void {
    const active = join(dataSlotsRoot, 'active');
    mkdirSync(active);
    const database = new DatabaseSync(join(active, 'workspace.sqlite'), {
        enableForeignKeyConstraints: true,
    });

    try {
        database.exec('BEGIN IMMEDIATE');
        database.exec(`PRAGMA application_id = ${COURSEFLOW_APPLICATION_ID}`);
        createSchemaLevel2(database);
        database.prepare(
            'INSERT INTO workspace_state (singleton, workspace_id, revision) VALUES (1, ?, 1)',
        ).run(WORKSPACE_ID);
        database.exec(`
            INSERT INTO setup_state (
                singleton,
                last_decision,
                setup_decision_version,
                ever_reached_minimum
            ) VALUES (1, NULL, 0, 1);
            INSERT INTO protection_watermarks (
                singleton,
                backup_needed_through,
                backup_succeeded_through
            ) VALUES (1, 1, 0);
            INSERT INTO terms (
                term_id,
                name,
                start_date,
                end_date,
                time_zone,
                archived,
                entity_version
            ) VALUES (
                '22222222-2222-4222-8222-222222222222',
                'Fall 2026',
                '2026-09-01',
                '2026-12-20',
                'America/Toronto',
                0,
                1
            );
            INSERT INTO plan_state (singleton, current_term_id, plan_entity_version)
                VALUES (1, '22222222-2222-4222-8222-222222222222', 1);
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
                'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
                'plan.create-term',
                1,
                'courseflow-canonical-json-v1',
                'sha256',
                zeroblob(32),
                1,
                'committed'
            );
            INSERT INTO receipt_effects (
                command_id,
                effect_order,
                effect_code,
                entity_kind,
                entity_id,
                entity_version
            ) VALUES (
                'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
                0,
                'plan.term-created-current',
                'term',
                '22222222-2222-4222-8222-222222222222',
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
                'ffffffff-ffff-4fff-8fff-ffffffffffff',
                'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
                'protect',
                'backup-needed-through',
                1,
                'pending',
                0
            );
            PRAGMA user_version = 2;
            COMMIT;
        `);
    }
    finally {
        database.close();
    }
}

function createLevel3WorkspaceWithCourse(dataSlotsRoot: string): void {
    createLevel2WorkspaceWithTerm(dataSlotsRoot);
    const database = new DatabaseSync(join(dataSlotsRoot, 'active', 'workspace.sqlite'), {
        enableForeignKeyConstraints: true,
    });
    try {
        database.exec('BEGIN IMMEDIATE');
        migrateLevel2To3(database);
        database.exec(`
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
                archived,
                entity_version
            ) VALUES (
                '33333333-3333-4333-8333-333333333333',
                '22222222-2222-4222-8222-222222222222',
                'CSC301',
                'Introduction to Software Engineering',
                'L0101',
                'Ada Lovelace',
                'blue',
                5,
                1,
                'inherit-term',
                0,
                1
            );
            INSERT INTO meeting_series (
                meeting_series_id,
                course_id,
                retired,
                entity_version
            ) VALUES (
                '44444444-4444-4444-8444-444444444444',
                '33333333-3333-4333-8333-333333333333',
                0,
                1
            );
            INSERT INTO meeting_segments (
                meeting_segment_id,
                meeting_series_id,
                meeting_type,
                weekday,
                local_start,
                local_end,
                effective_start_date,
                effective_end_date,
                location_kind,
                location_value
            ) VALUES (
                '55555555-5555-4555-8555-555555555555',
                '44444444-4444-4444-8444-444444444444',
                'LEC',
                'MON',
                '09:00',
                '10:00',
                '2026-09-08',
                '2026-12-18',
                'known',
                'BA 1130'
            );
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
                '66666666-6666-4666-8666-666666666666',
                'plan.create-course-with-first-meeting',
                1,
                'courseflow-canonical-json-v1',
                'sha256',
                zeroblob(32),
                3,
                'committed'
            );
            INSERT INTO receipt_effects (
                command_id,
                effect_order,
                effect_code,
                entity_kind,
                entity_id,
                entity_version
            ) VALUES
                (
                    '66666666-6666-4666-8666-666666666666',
                    0,
                    'plan.course-created',
                    'course',
                    '33333333-3333-4333-8333-333333333333',
                    1
                ),
                (
                    '66666666-6666-4666-8666-666666666666',
                    1,
                    'plan.meeting-series-created',
                    'meeting-series',
                    '44444444-4444-4444-8444-444444444444',
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
                '77777777-7777-4777-8777-777777777777',
                '66666666-6666-4666-8666-666666666666',
                'protect',
                'backup-needed-through',
                3,
                'pending',
                0
            );
            UPDATE workspace_state SET revision = 3 WHERE singleton = 1;
            UPDATE plan_state SET plan_entity_version = 2 WHERE singleton = 1;
            UPDATE protection_watermarks SET backup_needed_through = 3 WHERE singleton = 1;
            COMMIT;
        `);
        database.prepare(`
            UPDATE command_receipts
            SET payload_digest = ?
            WHERE command_id = ?
        `).run(
            Buffer.from(LEGACY_COURSE_DIGEST_HEX, 'hex'),
            LEGACY_COURSE_COMMAND.commandId,
        );
    }
    finally {
        database.close();
    }
}

/**
 * Builds a supported level 4 Course and Meeting fixture for level 5 migration tests.
 * @param {string} dataSlotsRoot - Target data-slots root.
 * @return {void}
 */
function createLevel4WorkspaceWithCourse(dataSlotsRoot: string): void {
    createLevel3WorkspaceWithCourse(dataSlotsRoot);
    const database = new DatabaseSync(join(dataSlotsRoot, 'active', 'workspace.sqlite'));
    try {
        database.exec('PRAGMA foreign_keys = OFF');
        database.exec('BEGIN IMMEDIATE');
        migrateLevel3To4(database);
        database.exec('COMMIT');
    }
    finally {
        database.close();
    }
}

/**
 * Builds a supported level 5 segment and override fixture for current migration tests.
 * @param {string} dataSlotsRoot - Target data-slots root.
 * @return {void}
 */
function createLevel5WorkspaceWithOverride(dataSlotsRoot: string): void {
    createLevel4WorkspaceWithCourse(dataSlotsRoot);
    const database = new DatabaseSync(join(dataSlotsRoot, 'active', 'workspace.sqlite'));
    try {
        database.exec(`
            PRAGMA foreign_keys = OFF;
            BEGIN IMMEDIATE;
        `);
        migrateLevel4To5(database);
        database.exec(`
            INSERT INTO meeting_occurrence_overrides (
                meeting_series_id,
                original_logical_anchor,
                override_kind,
                meeting_type,
                weekday,
                local_start,
                local_end,
                location_kind,
                location_value,
                entity_version
            ) VALUES (
                '44444444-4444-4444-8444-444444444444',
                '2026-09-21',
                'replaced',
                'TUT',
                'TUE',
                '11:00',
                '12:00',
                'tba',
                NULL,
                1
            );
            COMMIT;
        `);
    }
    finally {
        database.close();
    }
}

test('Q-TIME-01/TEST-DATA-006: level 5 offsets migrate atomically and restart at zero', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    createLevel5WorkspaceWithOverride(dataSlotsRoot);

    let reachedFailpoint = false;
    let copiedSafety = false;
    const interrupted = await openWorkspaceDataWithMigrations(dataSlotsRoot, {
        migrationFailpoint(point) {
            if (point === 'migration.after-safety-copy') {
                copiedSafety = true;
            }
            if (point === 'migration.before-level-commit') {
                reachedFailpoint = true;
                throw new Error(point);
            }
        },
    });
    assert.equal(interrupted.kind, 'recovery');
    assert.equal(copiedSafety, true);
    assert.equal(reachedFailpoint, true);
    const unchanged = new DatabaseSync(join(dataSlotsRoot, 'active', 'workspace.sqlite'), {
        readOnly: true,
        readBigInts: true,
    });
    try {
        assert.equal(
            (unchanged.prepare('PRAGMA user_version').get() as { user_version: bigint }).user_version,
            5n,
        );
        assert.equal(
            (unchanged.prepare(
                "SELECT count(*) AS count FROM pragma_table_info('meeting_segments') "
                    + "WHERE name = 'end_day_offset'",
            ).get() as { count: bigint }).count,
            0n,
        );
    }
    finally {
        unchanged.close();
    }

    const continued = await openWorkspaceDataWithMigrations(dataSlotsRoot);
    assert.equal(continued.kind, 'ready');
    if (continued.kind !== 'ready') {
        throw new Error('Expected level 5 offset migration to continue');
    }
    assert.equal(continued.store.status().revision, '16');
    const detail = continued.store.readMeetingSeriesDetail(
        '44444444-4444-4444-8444-444444444444',
        { startDate: '2026-09-01', endDate: '2026-09-30' },
    );
    assert.equal(detail.segments[0]?.endDayOffset, 0);
    const replaced = detail.occurrences.find(occurrence => (
        occurrence.occurrenceId.originalLogicalAnchor === '2026-09-21'
    ));
    assert.equal(replaced?.endDayOffset, 0);
    assert.equal(replaced?.overrideKind, 'replaced');
    assert.deepEqual(continued.store.receipt(LEGACY_COURSE_COMMAND.commandId)?.effects.map(
        effect => effect.code,
    ), ['plan.course-created', 'plan.meeting-series-created']);
    await continued.store.close();
});

test('ADR-04/TEST-DATA-006: level 4 migrates occurrences with a restartable safety boundary', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    createLevel4WorkspaceWithCourse(dataSlotsRoot);

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
            4n,
        );
        assert.equal(
            (unchanged.prepare(
                'SELECT revision FROM workspace_state WHERE singleton = 1',
            ).get() as { revision: bigint }).revision,
            4n,
        );
        assert.equal(
            (unchanged.prepare('SELECT count(*) AS count FROM meeting_segments').get() as {
                count: bigint;
            }).count,
            1n,
        );
    }
    finally {
        unchanged.close();
    }
    assert.equal(
        readdirSync(dataSlotsRoot).filter(name => name.startsWith('migration-safety-copy-')).length,
        1,
    );

    const continued = await openWorkspaceDataWithMigrations(dataSlotsRoot);
    assert.equal(continued.kind, 'ready');
    if (continued.kind !== 'ready') {
        throw new Error('Expected level 4 migration to continue');
    }
    assert.equal(continued.store.status().revision, '16');
    const detail = continued.store.readMeetingSeriesDetail(
        '44444444-4444-4444-8444-444444444444',
        { startDate: '2026-09-01', endDate: '2026-12-31' },
    );
    assert.deepEqual(detail.segments[0], {
        segmentId: '55555555-5555-4555-8555-555555555555',
        logicalStartAnchor: '2026-09-14',
        logicalEndAnchor: null,
        type: 'LEC',
        weekday: 'MON',
        localStart: '09:00',
        localEnd: '10:00',
        endDayOffset: 0,
        location: { kind: 'known', value: 'BA 1130' },
    });
    assert.deepEqual(continued.store.receipt(LEGACY_COURSE_COMMAND.commandId)?.effects.map(effect => effect.code), [
        'plan.course-created',
        'plan.meeting-series-created',
    ]);
    assert.equal(continued.store.readProtectionWatermark(), '16');
    await continued.store.close();
});

test('ADR-04/TEST-DATA-006: level 4 migration preserves an empty rule at the LocalDate ceiling', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    createLevel4WorkspaceWithCourse(dataSlotsRoot);
    const database = new DatabaseSync(join(dataSlotsRoot, 'active', 'workspace.sqlite'));
    try {
        database.exec(`
            BEGIN IMMEDIATE;
            UPDATE terms SET start_date = '9999-12-31', end_date = '9999-12-31';
            UPDATE courses
                SET teaching_range_kind = 'explicit',
                    teaching_start_date = '9999-12-31',
                    teaching_end_date = '9999-12-31';
            UPDATE meeting_segments
                SET weekday = 'SAT',
                    effective_range_kind = 'explicit',
                    effective_start_date = '9999-12-31',
                    effective_end_date = '9999-12-31';
            COMMIT;
        `);
    }
    finally {
        database.close();
    }

    const opened = await openWorkspaceDataWithMigrations(dataSlotsRoot);

    assert.equal(opened.kind, 'ready');
    if (opened.kind !== 'ready') {
        throw new Error('Expected level 4 ceiling migration to complete');
    }
    const detail = opened.store.readMeetingSeriesDetail(
        '44444444-4444-4444-8444-444444444444',
        { startDate: '9999-12-31', endDate: '9999-12-31' },
    );
    assert.equal(detail.segments[0]?.logicalStartAnchor, '9999-12-25');
    assert.equal(detail.occurrences.length, 0);
    await opened.store.close();
});

test('ADR-04: current validation rejects overlapping Meeting segments as corrupt', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    createLevel4WorkspaceWithCourse(dataSlotsRoot);
    const migrated = await openWorkspaceDataWithMigrations(dataSlotsRoot);
    assert.equal(migrated.kind, 'ready');
    if (migrated.kind !== 'ready') {
        throw new Error('Expected current migration to complete');
    }
    await migrated.store.close();

    const database = new DatabaseSync(join(dataSlotsRoot, 'active', 'workspace.sqlite'));
    try {
        database.exec(`
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
                '88888888-8888-4888-8888-888888888888',
                meeting_series_id,
                meeting_type,
                weekday,
                local_start,
                local_end,
                end_day_offset,
                logical_start_anchor,
                logical_start_anchor,
                effective_range_kind,
                effective_start_date,
                effective_end_date,
                location_kind,
                location_value
            FROM meeting_segments
            LIMIT 1;
        `);
    }
    finally {
        database.close();
    }

    const opened = openWorkspaceData(dataSlotsRoot);
    assert.equal(opened.kind, 'recovery');
    if (opened.kind === 'recovery') {
        assert.equal(opened.problem.code, 'integrity');
        assert.deepEqual(opened.problem.details, { reason: 'database-corrupt' });
    }
});

test('ADR-04: current validation rejects overrides detached from weekly anchors', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    createLevel4WorkspaceWithCourse(dataSlotsRoot);
    const migrated = await openWorkspaceDataWithMigrations(dataSlotsRoot);
    assert.equal(migrated.kind, 'ready');
    if (migrated.kind !== 'ready') {
        throw new Error('Expected current migration to complete');
    }
    await migrated.store.close();

    const database = new DatabaseSync(join(dataSlotsRoot, 'active', 'workspace.sqlite'));
    try {
        database.exec(`
            INSERT INTO meeting_occurrence_overrides (
                meeting_series_id,
                original_logical_anchor,
                override_kind,
                meeting_type,
                weekday,
                local_start,
                local_end,
                location_kind,
                location_value,
                entity_version
            ) VALUES (
                '44444444-4444-4444-8444-444444444444',
                '2026-09-15',
                'cancelled',
                NULL,
                NULL,
                NULL,
                NULL,
                NULL,
                NULL,
                1
            );
        `);
    }
    finally {
        database.close();
    }

    const opened = openWorkspaceData(dataSlotsRoot);
    assert.equal(opened.kind, 'recovery');
    if (opened.kind === 'recovery') {
        assert.equal(opened.problem.code, 'integrity');
        assert.deepEqual(opened.problem.details, { reason: 'database-corrupt' });
    }
});

test('ADR-04: current validation rejects a Meeting series without a rule segment', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    createLevel4WorkspaceWithCourse(dataSlotsRoot);
    const migrated = await openWorkspaceDataWithMigrations(dataSlotsRoot);
    assert.equal(migrated.kind, 'ready');
    if (migrated.kind !== 'ready') {
        throw new Error('Expected current migration to complete');
    }
    await migrated.store.close();

    const database = new DatabaseSync(join(dataSlotsRoot, 'active', 'workspace.sqlite'));
    try {
        database.exec('DELETE FROM meeting_segments;');
    }
    finally {
        database.close();
    }

    const opened = openWorkspaceData(dataSlotsRoot);
    assert.equal(opened.kind, 'recovery');
    if (opened.kind === 'recovery') {
        assert.equal(opened.problem.code, 'integrity');
        assert.deepEqual(opened.problem.details, { reason: 'database-corrupt' });
    }
});

test('ADR-04: level 4 migration rejects unsupported multi-segment legacy facts', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    createLevel4WorkspaceWithCourse(dataSlotsRoot);
    const database = new DatabaseSync(join(dataSlotsRoot, 'active', 'workspace.sqlite'));
    try {
        database.exec(`
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
                '88888888-8888-4888-8888-888888888888',
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
            FROM meeting_segments
            LIMIT 1;
        `);
    }
    finally {
        database.close();
    }

    const opened = await openWorkspaceDataWithMigrations(dataSlotsRoot);
    assert.equal(opened.kind, 'recovery');
});

test('TEST-DATA-002/006: level 2 Term facts migrate to current schema without identity loss', async t => {
    const dataSlotsRoot = createTempDataSlots(t);
    createLevel2WorkspaceWithTerm(dataSlotsRoot);

    const opened = await openWorkspaceDataWithMigrations(dataSlotsRoot);

    assert.equal(opened.kind, 'ready');
    if (opened.kind !== 'ready') {
        throw new Error('Expected migrated ready workspace');
    }
    assert.deepEqual(opened.store.status(), {
        kind: 'ready',
        workspaceId: WORKSPACE_ID,
        schemaLevel: 16,
        revision: '15',
    });
    assert.deepEqual(opened.store.readSetupProjection().currentTerm, {
        termId: '22222222-2222-4222-8222-222222222222',
        name: 'Fall 2026',
        startDate: '2026-09-01',
        endDate: '2026-12-20',
        timeZone: 'America/Toronto',
        archived: false,
        entityVersion: '1',
    });
    assert.deepEqual(opened.store.readSetupProjection().courses, []);
    assert.deepEqual(opened.store.receipt('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'), {
        kind: 'committed',
        revision: '1',
        effects: [{
            code: 'plan.term-created-current',
            entity: {
                kind: 'term',
                id: '22222222-2222-4222-8222-222222222222',
                version: '1',
            },
        }],
        pendingFollowUps: ['ffffffff-ffff-4fff-8fff-ffffffffffff'],
    });
    assert.equal(opened.store.readPendingFollowUps().length, 1);
    assert.equal(opened.store.readProtectionWatermark(), '15');
    await opened.store.close();

    const safetyDirectories = readdirSync(dataSlotsRoot)
        .filter((name) => name.startsWith('migration-safety-copy-'));
    assert.equal(safetyDirectories.length, 1);
    const safetyDatabase = new DatabaseSync(
        join(dataSlotsRoot, safetyDirectories[0]!, 'workspace.sqlite'),
        { readOnly: true, readBigInts: true },
    );
    try {
        assert.equal(
            (safetyDatabase.prepare('PRAGMA user_version').get() as { user_version: bigint }).user_version,
            2n,
        );
        assert.equal(
            (safetyDatabase.prepare('SELECT count(*) AS count FROM terms').get() as { count: bigint }).count,
            1n,
        );
    }
    finally {
        safetyDatabase.close();
    }
});

test('A-COURSE-007/TEST-DATA-002/006: level 3 ranges and identities migrate to current schema', async t => {
    const dataSlotsRoot = createTempDataSlots(t);
    createLevel3WorkspaceWithCourse(dataSlotsRoot);

    const opened = await openWorkspaceDataWithMigrations(dataSlotsRoot);
    assert.equal(opened.kind, 'ready');
    if (opened.kind !== 'ready') {
        throw new Error('Expected migrated ready workspace');
    }
    assert.deepEqual(opened.store.status(), {
        kind: 'ready',
        workspaceId: WORKSPACE_ID,
        schemaLevel: 16,
        revision: '16',
    });
    const projection = opened.store.readSetupProjection();
    assert.equal(projection.currentTerm?.termId, '22222222-2222-4222-8222-222222222222');
    assert.equal(projection.courses[0]?.courseId, '33333333-3333-4333-8333-333333333333');
    assert.deepEqual(projection.courses[0]?.teachingRange, {
        kind: 'inherit-term',
        startDate: '2026-09-01',
        endDate: '2026-12-20',
    });
    assert.equal(
        projection.courses[0]?.meetings[0]?.meetingSeriesId,
        '44444444-4444-4444-8444-444444444444',
    );
    assert.deepEqual(projection.courses[0]?.meetings[0]?.effectiveRange, {
        kind: 'explicit',
        startDate: '2026-09-08',
        endDate: '2026-12-18',
    });
    const meetingDetail = opened.store.readMeetingSeriesDetail(
        '44444444-4444-4444-8444-444444444444',
        { startDate: '2026-09-01', endDate: '2026-12-31' },
    );
    assert.deepEqual(meetingDetail.segments[0], {
        segmentId: '55555555-5555-4555-8555-555555555555',
        logicalStartAnchor: '2026-09-14',
        logicalEndAnchor: null,
        type: 'LEC',
        weekday: 'MON',
        localStart: '09:00',
        localEnd: '10:00',
        endDayOffset: 0,
        location: { kind: 'known', value: 'BA 1130' },
    });
    assert.deepEqual(meetingDetail.occurrences[0]?.occurrenceId, {
        meetingSeriesId: '44444444-4444-4444-8444-444444444444',
        originalLogicalAnchor: '2026-09-14',
    });
    assert.deepEqual(opened.store.receipt('66666666-6666-4666-8666-666666666666'), {
        kind: 'committed',
        revision: '3',
        effects: [
            {
                code: 'plan.course-created',
                entity: {
                    kind: 'course',
                    id: '33333333-3333-4333-8333-333333333333',
                    version: '1',
                },
            },
            {
                code: 'plan.meeting-series-created',
                entity: {
                    kind: 'meeting-series',
                    id: '44444444-4444-4444-8444-444444444444',
                    version: '1',
                },
            },
        ],
        pendingFollowUps: ['77777777-7777-4777-8777-777777777777'],
    });
    const replayed = await opened.store.commit(LEGACY_COURSE_COMMAND);
    assert.equal(replayed.ok, true);
    assert.equal(replayed.ok && replayed.value.revision, '3');
    const reused = await opened.store.commit({
        ...LEGACY_COURSE_COMMAND,
        intent: {
            ...LEGACY_COURSE_COMMAND.intent,
            payload: {
                ...LEGACY_COURSE_COMMAND.intent.payload,
                course: {
                    ...LEGACY_COURSE_COMMAND.intent.payload.course,
                    name: 'Changed legacy semantics',
                },
            },
        },
    });
    assert.equal(reused.ok, false);
    assert.equal(!reused.ok && reused.problem.details.reason, 'command-id-reused');
    await assert.rejects(opened.store.commit({
        ...LEGACY_COURSE_COMMAND,
        commandId: '88888888-8888-4888-8888-888888888888',
        followUpId: '99999999-9999-4999-8999-999999999999',
    }), TypeError);
    assert.equal(opened.store.status().revision, '16');
    await opened.store.close();

    const safetyDirectories = readdirSync(dataSlotsRoot)
        .filter(name => name.startsWith('migration-safety-copy-'));
    assert.equal(safetyDirectories.length, 1);
    const reopened = openWorkspaceData(dataSlotsRoot);
    assert.equal(reopened.kind, 'ready');
    if (reopened.kind === 'ready') {
        assert.equal(
            reopened.store.readSetupProjection().courses[0]?.meetings[0]?.meetingSeriesId,
            '44444444-4444-4444-8444-444444444444',
        );
        await reopened.store.close();
    }
});

test('level 11 migration retains a historically reached setup minimum after facts are archived', async t => {
    const dataSlotsRoot = createTempDataSlots(t);
    createLevel3WorkspaceWithCourse(dataSlotsRoot);
    const database = new DatabaseSync(join(dataSlotsRoot, 'active', 'workspace.sqlite'));
    try {
        database.exec(`
            UPDATE setup_state SET ever_reached_minimum = 0 WHERE singleton = 1;
            UPDATE courses SET archived = 1;
            UPDATE meeting_series SET retired = 1;
        `);
    }
    finally {
        database.close();
    }

    const opened = await openWorkspaceDataWithMigrations(dataSlotsRoot);
    assert.equal(opened.kind, 'ready');
    if (opened.kind !== 'ready') {
        throw new Error('Expected migrated ready workspace');
    }
    const projection = opened.store.readSetupProjection();
    assert.equal(projection.minimum.isSatisfied, false);
    assert.equal(projection.everReachedMinimum, true);
    assert.equal(projection.defaultRoute, 'today');
    await opened.store.close();
});

test('TEST-DATA-006: interrupted level 2 migration leaves all Term facts at level 2', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    createLevel2WorkspaceWithTerm(dataSlotsRoot);

    const opened = await openWorkspaceDataWithMigrations(dataSlotsRoot, {
        migrationFailpoint(point) {
            if (point === 'migration.before-level-commit') {
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
            2n,
        );
        assert.equal(
            (database.prepare('SELECT count(*) AS count FROM terms').get() as { count: bigint }).count,
            1n,
        );
        assert.equal(
            (database.prepare('SELECT count(*) AS count FROM command_receipts').get() as {
                count: bigint;
            }).count,
            1n,
        );
    }
    finally {
        database.close();
    }
    assert.equal(
        readdirSync(dataSlotsRoot).filter(name => name.startsWith('migration-safety-copy-')).length,
        1,
    );
});
