/**
 * @file Verifies Workspace-owned build binding and pre-open migration rollback routing.
 */

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';

import {
    COURSEFLOW_APPLICATION_ID,
    migrateLevel0To1,
} from '../src/data/schema';
import {inspectMigrationSafetyCopy} from '../src/data/sqlite-data-store';
import {observeRestoreDataSlot, stageRestoreDataSlot} from '../src/platform/restore-activation-files';
import {
    armMigrationRollbackHandoff,
    continueMigrationRollbackHandoff,
    createMigrationRollbackHandoff,
    prepareMigrationRollbackHandoff,
    type MigrationRollbackHandoffFacts,
} from '../src/protect/migration-rollback-handoff';
import {makeBootstrapRequest} from '../src/shared/bootstrap-contract';
import {
    makeInitializeWorkspaceRequest,
    makeRestoreSessionQueryRequest,
} from '../src/shared/workspace-setup-contract';
import {WorkspaceApplication} from '../src/workspace-application';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_APP_BUILD_ID = 'development:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TARGET_APP_BUILD_ID = 'development:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const OTHER_APP_BUILD_ID = 'development:cccccccccccccccccccccccccccccccccccccccc';
const MIGRATION_SAFETY_COPY_ID = '22222222-2222-4222-8222-222222222222';
const MIGRATION_ROLLBACK_SESSION_ID = '33333333-3333-4333-8333-333333333333';
const MIGRATION_ROLLBACK_OPERATION_ID = '44444444-4444-4444-8444-444444444444';
const MIGRATION_ROLLBACK_CONFIRM_COMMAND_ID = '55555555-5555-4555-8555-555555555555';
const MIGRATION_ROLLBACK_CONTINUE_COMMAND_ID = '66666666-6666-4666-8666-666666666666';
const ROLLBACK_TARGET = Object.freeze({
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
});

function createLevel1Workspace(t: test.TestContext): string {
    const dataSlotsRoot = mkdtempSync(path.join(tmpdir(), 'courseflow-workspace-migration-'));
    const active = path.join(dataSlotsRoot, 'active');
    mkdirSync(active);
    const database = new DatabaseSync(path.join(active, 'workspace.sqlite'), {
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
    t.after(() => rmSync(dataSlotsRoot, {recursive: true, force: true}));
    return dataSlotsRoot;
}

type RollbackFixture = Readonly<{
    activityControlRoot: string;
    dataSlotsRoot: string;
    safetyDatabasePath: string;
    facts: MigrationRollbackHandoffFacts;
}>;

function sha256(bytes: string | Buffer): string {
    return createHash('sha256').update(bytes).digest('hex');
}

function createRollbackFixture(t: test.TestContext): RollbackFixture {
    const root = mkdtempSync(path.join(tmpdir(), 'courseflow-workspace-rollback-'));
    const activityControlRoot = path.join(root, 'activity-control');
    const dataSlotsRoot = path.join(root, 'data-slots');
    const activeSlot = path.join(dataSlotsRoot, 'active');
    const safetyDatabasePath = path.join(root, 'migration-safety.sqlite');
    mkdirSync(activityControlRoot);
    mkdirSync(dataSlotsRoot);
    mkdirSync(activeSlot);
    writeFileSync(path.join(activeSlot, 'workspace.sqlite'), 'migrated-non-sqlite-data');
    writeFileSync(safetyDatabasePath, 'safety-non-sqlite-data');
    const active = observeRestoreDataSlot(dataSlotsRoot, 'active');
    assert.equal(active.kind, 'present');
    t.after(() => rmSync(root, {recursive: true, force: true}));
    return Object.freeze({
        activityControlRoot,
        dataSlotsRoot,
        safetyDatabasePath,
        facts: Object.freeze({
            migrationRollbackSessionId: MIGRATION_ROLLBACK_SESSION_ID,
            operationId: MIGRATION_ROLLBACK_OPERATION_ID,
            sourceAppBuildId: SOURCE_APP_BUILD_ID,
            currentAppBuildId: SOURCE_APP_BUILD_ID,
            targetAppBuildId: TARGET_APP_BUILD_ID,
            sourceReleaseVersion: '2.0.0-development',
            currentReleaseVersion: '2.0.0-development',
            targetReleaseVersion: '1.0.0-development',
            previewDigest: sha256('preview'),
            confirmationDigest: sha256('confirmation'),
            safetyCopy: Object.freeze({
                migrationSafetyCopyId: MIGRATION_SAFETY_COPY_ID,
                workspaceId: WORKSPACE_ID,
                schemaLevel: '15',
                revision: '7',
                byteLength: Buffer.byteLength('safety-non-sqlite-data').toString(),
                digest: sha256('safety-non-sqlite-data'),
            }),
            currentData: Object.freeze({
                workspaceId: WORKSPACE_ID,
                schemaLevel: '16',
                revision: '9',
                byteLength: Buffer.byteLength('migrated-non-sqlite-data').toString(),
                digest: sha256('migrated-non-sqlite-data'),
                slotFingerprint: active.kind === 'present'
                    ? active.fingerprint.slotFingerprint
                    : '',
            }),
        }),
    });
}

function prepareArmedRollback(fixture: RollbackFixture): void {
    createMigrationRollbackHandoff(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
        fixture.facts,
    );
    prepareMigrationRollbackHandoff(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
        MIGRATION_ROLLBACK_SESSION_ID,
        input => {
            assert.equal(input.migrationSafetyCopyId, MIGRATION_SAFETY_COPY_ID);
            return stageRestoreDataSlot(
                fixture.safetyDatabasePath,
                fixture.dataSlotsRoot,
                input.candidateSlotName,
            );
        },
    );
    armMigrationRollbackHandoff(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
        Object.freeze({
            action: 'confirm',
            commandId: MIGRATION_ROLLBACK_CONFIRM_COMMAND_ID,
            migrationRollbackSessionId: MIGRATION_ROLLBACK_SESSION_ID,
            expectedSessionVersion: '2',
            currentAppBuildId: SOURCE_APP_BUILD_ID,
        }),
    );
}

function physicalDataSnapshot(dataSlotsRoot: string): readonly string[] {
    return Object.freeze(readdirSync(dataSlotsRoot).sort().map(slotName => {
        const databaseBytes = readFileSync(path.join(dataSlotsRoot, slotName, 'workspace.sqlite'));
        return `${slotName}:${databaseBytes.byteLength}:${sha256(databaseBytes)}`;
    }));
}

async function bootstrap(application: WorkspaceApplication, appBuildId: string) {
    const outcome = await application.handle({
        ...makeBootstrapRequest('bootstrap-migration', appBuildId),
        dataRootClass: 'verified-local' as const,
    });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) {
        throw new Error('Expected Workspace bootstrap outcome');
    }
    return outcome.value;
}

test('TEST-WORKSPACE-007: Workspace binds migration safety metadata to its exact build', async t => {
    const dataSlotsRoot = createLevel1Workspace(t);

    const application = await WorkspaceApplication.open(dataSlotsRoot, SOURCE_APP_BUILD_ID, {
        migrationRollbackTarget: ROLLBACK_TARGET,
        clock: Object.freeze({now: () => '2026-08-27T12:00:00.000Z'}),
        migrationFailpoint(point) {
            if (point === 'migration.after-safety-copy') {
                throw new Error(point);
            }
        },
    });
    t.after(() => application.close());

    const status = inspectMigrationSafetyCopy(dataSlotsRoot);
    assert.equal(status.kind, 'verified');
    if (status.kind !== 'verified') {
        throw new Error('Expected Workspace migration safety evidence');
    }
    assert.equal(status.metadata.createdByAppBuildId, SOURCE_APP_BUILD_ID);
    assert.deepEqual(status.metadata.rollbackTarget, ROLLBACK_TARGET);
});

test('TEST-WORKSPACE-005/007: pre-DATA boot classifies rollback builds without physical continuation', async t => {
    const fixture = createRollbackFixture(t);
    prepareArmedRollback(fixture);
    const before = physicalDataSnapshot(fixture.dataSlotsRoot);

    const cases = [
        {
            appBuildId: SOURCE_APP_BUILD_ID,
            code: 'rollback-required',
            currentBuild: 'source',
            allowedActions: ['cancel-as-source'],
        },
        {
            appBuildId: TARGET_APP_BUILD_ID,
            code: 'rollback-required',
            currentBuild: 'target',
            allowedActions: ['continue-as-target'],
        },
        {
            appBuildId: OTHER_APP_BUILD_ID,
            code: 'rollback-build-mismatch',
            currentBuild: 'other',
            allowedActions: [],
        },
    ] as const;

    for (const expected of cases) {
        const application = await WorkspaceApplication.open(
            fixture.dataSlotsRoot,
            expected.appBuildId,
            {activityControlRoot: fixture.activityControlRoot},
        );
        const first = await bootstrap(application, expected.appBuildId);
        assert.equal(first.workspaceData.kind, 'recovery');
        if (first.workspaceData.kind !== 'recovery') {
            throw new Error('Expected MigrationRollback boot gate');
        }
        const problem = first.workspaceData.problem as unknown as Readonly<{
            code: string;
            allowedActions: readonly string[];
            details: Readonly<{
                currentBuild: string;
                requiredBuilds: Readonly<Record<string, string>>;
            }>;
        }>;
        assert.equal(problem.code, expected.code);
        assert.deepEqual(problem.allowedActions, expected.allowedActions);
        assert.equal(problem.details.currentBuild, expected.currentBuild);
        assert.deepEqual(
            problem.details.requiredBuilds,
            {
                sourceAppBuildId: SOURCE_APP_BUILD_ID,
                sourceReleaseVersion: '2.0.0-development',
                targetAppBuildId: TARGET_APP_BUILD_ID,
                targetReleaseVersion: '1.0.0-development',
            },
        );
        const ordinary = await application.handle(makeInitializeWorkspaceRequest(
            'ordinary-request',
            expected.appBuildId,
            first.workspaceEpoch,
        ));
        assert.equal(ordinary.ok, false);
        assert.equal(ordinary.ok ? null : ordinary.problem.code, 'operation-in-progress');
        const restore = await application.handle(makeRestoreSessionQueryRequest(
            'restore-request',
            expected.appBuildId,
            first.workspaceEpoch,
            '66666666-6666-4666-8666-666666666666',
        ));
        assert.equal(restore.ok, false);
        assert.equal(restore.ok ? null : restore.problem.code, 'operation-in-progress');
        assert.deepEqual(physicalDataSnapshot(fixture.dataSlotsRoot), before);
        assert.doesNotMatch(
            JSON.stringify(first.workspaceData),
            /(?:[A-Za-z]:[\\/]|workspace\.sqlite|DataSlots|journal)/,
        );
        await application.close();
        const restarted = await WorkspaceApplication.open(
            fixture.dataSlotsRoot,
            expected.appBuildId,
            {activityControlRoot: fixture.activityControlRoot},
        );
        const restartedView = await bootstrap(restarted, expected.appBuildId);
        assert.deepEqual(restartedView.workspaceData, first.workspaceData);
        assert.deepEqual(physicalDataSnapshot(fixture.dataSlotsRoot), before);
        await restarted.close();
    }
});

test('TEST-WORKSPACE-005: corrupt rollback handoff fails closed before opening DATA', async t => {
    const fixture = createRollbackFixture(t);
    prepareArmedRollback(fixture);
    const journalDirectory = path.join(
        fixture.activityControlRoot,
        'migration-rollback',
        MIGRATION_ROLLBACK_OPERATION_ID,
        'journal',
    );
    const finalRecord = readdirSync(journalDirectory)
        .filter(name => !name.startsWith('.tmp-'))
        .sort()
        .at(-1);
    assert.ok(finalRecord);
    writeFileSync(path.join(journalDirectory, finalRecord), '{}');
    const before = physicalDataSnapshot(fixture.dataSlotsRoot);

    const application = await WorkspaceApplication.open(
        fixture.dataSlotsRoot,
        TARGET_APP_BUILD_ID,
        {activityControlRoot: fixture.activityControlRoot},
    );
    const result = await bootstrap(application, TARGET_APP_BUILD_ID);
    assert.equal(result.workspaceData.kind, 'recovery');
    if (result.workspaceData.kind !== 'recovery') {
        throw new Error('Expected corrupt handoff recovery gate');
    }
    assert.equal(result.workspaceData.problem.code, 'recovery-required');
    assert.deepEqual(result.workspaceData.problem.allowedActions, []);
    assert.deepEqual(result.workspaceData.problem.context, {});
    assert.deepEqual(result.workspaceData.problem.details, {
        reason: 'migration-rollback-evidence',
    });
    assert.deepEqual(physicalDataSnapshot(fixture.dataSlotsRoot), before);
    await application.close();
});

test('TEST-WORKSPACE-005: clear and terminal rollback evidence permit ordinary DATA open', async t => {
    await t.test('clear', async t => {
        const fixture = createRollbackFixture(t);
        const application = await WorkspaceApplication.open(
            fixture.dataSlotsRoot,
            SOURCE_APP_BUILD_ID,
            {activityControlRoot: fixture.activityControlRoot},
        );
        const result = await bootstrap(application, SOURCE_APP_BUILD_ID);
        assert.equal(result.workspaceData.kind, 'recovery');
        if (result.workspaceData.kind !== 'recovery') {
            throw new Error('Expected non-SQLite DATA open to fail');
        }
        assert.equal(result.workspaceData.problem.code, 'integrity');
        await application.close();
    });

    await t.test('terminal', async t => {
        const fixture = createRollbackFixture(t);
        prepareArmedRollback(fixture);
        const completed = await continueMigrationRollbackHandoff(
            fixture.activityControlRoot,
            fixture.dataSlotsRoot,
            Object.freeze({
                action: 'continue-as-target',
                commandId: MIGRATION_ROLLBACK_CONTINUE_COMMAND_ID,
                migrationRollbackSessionId: MIGRATION_ROLLBACK_SESSION_ID,
                expectedSessionVersion: '4',
                currentAppBuildId: TARGET_APP_BUILD_ID,
            }),
            Object.freeze({
                async reopen(): Promise<void> {},
                async libraryReconcile(): Promise<void> {},
                async flow00(): Promise<void> {},
                async consumeSafetyCopy(): Promise<void> {},
            }),
        );
        assert.equal(completed.kind, 'succeeded');
        const application = await WorkspaceApplication.open(
            fixture.dataSlotsRoot,
            TARGET_APP_BUILD_ID,
            {activityControlRoot: fixture.activityControlRoot},
        );
        const result = await bootstrap(application, TARGET_APP_BUILD_ID);
        assert.equal(result.workspaceData.kind, 'recovery');
        if (result.workspaceData.kind !== 'recovery') {
            throw new Error('Expected non-SQLite DATA open to fail');
        }
        assert.equal(result.workspaceData.problem.code, 'integrity');
        await application.close();
    });
});

test('TEST-WORKSPACE-005: simultaneous Restore and rollback evidence exposes no action', async t => {
    const fixture = createRollbackFixture(t);
    prepareArmedRollback(fixture);
    mkdirSync(path.join(fixture.activityControlRoot, 'restore'));
    mkdirSync(path.join(fixture.activityControlRoot, 'restore', 'not-an-operation'));
    const before = physicalDataSnapshot(fixture.dataSlotsRoot);

    const application = await WorkspaceApplication.open(
        fixture.dataSlotsRoot,
        SOURCE_APP_BUILD_ID,
        {activityControlRoot: fixture.activityControlRoot},
    );
    const result = await bootstrap(application, SOURCE_APP_BUILD_ID);
    assert.equal(result.workspaceData.kind, 'recovery');
    if (result.workspaceData.kind !== 'recovery') {
        throw new Error('Expected conflicting activation recovery gate');
    }
    assert.equal(result.workspaceData.problem.code, 'recovery-required');
    assert.deepEqual(result.workspaceData.problem.allowedActions, []);
    assert.deepEqual(result.workspaceData.problem.context, {});
    assert.deepEqual(result.workspaceData.problem.details, {
        reason: 'migration-rollback-evidence',
    });
    assert.deepEqual(physicalDataSnapshot(fixture.dataSlotsRoot), before);
    await application.close();
});
