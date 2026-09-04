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
    CURRENT_SCHEMA_LEVEL,
    SCHEMA_MIGRATIONS,
    isMigratableSchemaLevel,
    migrateLevel0To1,
} from '../src/data/schema';
import {
    deleteMigrationSafetyCopy,
    inspectMigrationSafetyCopy,
    migrationSafetyCopyDeleteConfirmationToken,
} from '../src/data/sqlite-data-store';
import {observeRestoreDataSlot, stageRestoreDataSlot} from '../src/platform/restore-activation-files';
import {
    armMigrationRollbackHandoff,
    cancelMigrationRollbackHandoff,
    continueMigrationRollbackHandoff,
    createMigrationRollbackHandoff,
    prepareMigrationRollbackHandoff,
    type MigrationRollbackHandoffFacts,
} from '../src/protect/migration-rollback-handoff';
import {makeBootstrapRequest} from '../src/shared/bootstrap-contract';
import {
    makeApplicationBuildStatusRequest,
    makeCancelMigrationRollbackRequest,
    makeConfirmMigrationRollbackRequest,
    makeContinueMigrationRollbackRequest,
    makeDeleteMigrationSafetyCopyRequest,
    makeMigrationRollbackPreviewRequest,
    makeMigrationRollbackStatusRequest,
    makeMigrationSafetyCopyQueryRequest,
} from '../src/shared/workspace-migration-contract';
import {
    makeInitializeWorkspaceRequest,
    makeRestoreSessionQueryRequest,
} from '../src/shared/workspace-setup-contract';
import {WorkspaceApplication} from '../src/workspace/application';

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

function createLevel1Workspace(): string {
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
    const dataSlotsRoot = createLevel1Workspace();

    const application = await WorkspaceApplication.open(dataSlotsRoot, SOURCE_APP_BUILD_ID, {
        migrationRollbackTarget: ROLLBACK_TARGET,
        clock: Object.freeze({now: () => '2026-08-27T12:00:00.000Z'}),
        migrationFailpoint(point) {
            if (point === 'migration.after-safety-copy') {
                throw new Error(point);
            }
        },
    });
    t.after(async () => {
        await application.close();
        rmSync(dataSlotsRoot, {recursive: true, force: true});
    });

    const status = inspectMigrationSafetyCopy(dataSlotsRoot);
    assert.equal(status.kind, 'verified');
    if (status.kind !== 'verified') {
        throw new Error('Expected Workspace migration safety evidence');
    }
    assert.equal(status.metadata.createdByAppBuildId, SOURCE_APP_BUILD_ID);
    assert.deepEqual(status.metadata.rollbackTarget, ROLLBACK_TARGET);
});

test('TEST-WORKSPACE-007/PROTECT-007: Workspace owns preview, maintenance, and exact source cancel', async t => {
    const dataSlotsRoot = createLevel1Workspace();
    const activityControlRoot = `${dataSlotsRoot}-activity-control`;
    mkdirSync(activityControlRoot);
    const applicationOptions = {
        activityControlRoot,
        migrationRollbackTarget: ROLLBACK_TARGET,
        applicationRelease: Object.freeze({
            releaseVersion: '0.0.0-development-source',
            tag: 'development-source',
        }),
        clock: Object.freeze({now: () => '2026-08-27T12:00:00.000Z'}),
    } as const;
    let application = await WorkspaceApplication.open(
        dataSlotsRoot,
        SOURCE_APP_BUILD_ID,
        applicationOptions,
    );
    t.after(async () => {
        await application.close();
        rmSync(dataSlotsRoot, {recursive: true, force: true});
        rmSync(activityControlRoot, {recursive: true, force: true});
    });
    const initial = await bootstrap(application, SOURCE_APP_BUILD_ID);
    assert.equal(initial.workspaceData.kind, 'ready');

    const build = await application.handle(makeApplicationBuildStatusRequest(
        'build-status',
        SOURCE_APP_BUILD_ID,
        initial.workspaceEpoch,
    ));
    assert.equal(build.ok, true);
    if (!build.ok || build.value.kind !== 'workspace.application-build-status') {
        throw new Error('Expected ApplicationBuildStatus');
    }
    assert.deepEqual(build.value.status.processMatch, {
        main: 'exact',
        renderer: 'exact',
        workspace: 'exact',
        allExact: true,
    });
    assert.equal(build.value.status.descriptor.appBuildId, SOURCE_APP_BUILD_ID);
    assert.deepEqual(build.value.status.descriptor.rollbackTargets, [ROLLBACK_TARGET]);
    assert.deepEqual(build.value.status.rollback, {kind: 'clear'});

    const safety = await application.handle(makeMigrationSafetyCopyQueryRequest(
        'safety-status',
        SOURCE_APP_BUILD_ID,
        initial.workspaceEpoch,
    ));
    assert.equal(safety.ok, true);
    if (!safety.ok || safety.value.kind !== 'workspace.migration-safety-copy'
        || safety.value.safetyCopy.kind !== 'verified') {
        throw new Error('Expected a verified MigrationSafetyCopy projection');
    }
    assert.equal(safety.value.safetyCopy.sourceSchemaLevel, '1');
    if (safety.value.safetyCopy.target === null) {
        throw new Error('Expected the bound exact rollback target');
    }
    assert.equal(safety.value.safetyCopy.target.appBuildId, TARGET_APP_BUILD_ID);

    const preview = await application.handle(makeMigrationRollbackPreviewRequest(
        'rollback-preview',
        SOURCE_APP_BUILD_ID,
        initial.workspaceEpoch,
    ));
    assert.equal(preview.ok, true);
    if (!preview.ok || preview.value.kind !== 'workspace.migration-rollback-session'
        || preview.value.session.phase !== 'previewed') {
        throw new Error('Expected a MigrationRollback preview');
    }
    const previewSession = preview.value.session;
    assert.deepEqual(previewSession.binding?.currentLibrary, {kind: 'absent'});
    // The live preview follows the application schema, so a level literal would go stale on the next migration.
    assert.equal(previewSession.binding?.currentData.schemaLevel, String(CURRENT_SCHEMA_LEVEL));
    assert.equal(previewSession.binding?.safetyCopy.migrationSafetyCopyId,
        safety.value.safetyCopy.migrationSafetyCopyId);

    const blockedDelete = await application.handle(makeDeleteMigrationSafetyCopyRequest(
        'blocked-safety-delete',
        SOURCE_APP_BUILD_ID,
        initial.workspaceEpoch,
        {
            commandId: '88888888-8888-4888-8888-888888888888',
            migrationSafetyCopyId: safety.value.safetyCopy.migrationSafetyCopyId,
            expectedCopyVersion: safety.value.safetyCopy.copyVersion,
            confirmationToken: safety.value.safetyCopy.deleteConfirmationToken,
        },
    ));
    assert.equal(blockedDelete.ok, false);
    assert.equal(blockedDelete.ok ? null : blockedDelete.problem.code, 'operation-in-progress');

    const confirmed = await application.handle(makeConfirmMigrationRollbackRequest(
        'rollback-confirm',
        SOURCE_APP_BUILD_ID,
        initial.workspaceEpoch,
        {
            commandId: MIGRATION_ROLLBACK_CONFIRM_COMMAND_ID,
            migrationRollbackSessionId: previewSession.migrationRollbackSessionId!,
            expectedSessionVersion: previewSession.sessionVersion!,
            previewToken: previewSession.previewToken!,
        },
    ));
    assert.equal(confirmed.ok, true);
    if (!confirmed.ok || confirmed.value.kind !== 'workspace.migration-rollback-session') {
        throw new Error('Expected a prepared MigrationRollback handoff');
    }
    assert.equal(confirmed.value.session.phase, 'awaiting-target-build');
    assert.deepEqual(confirmed.value.session.allowedActions, ['cancel-as-source']);

    const ordinary = await application.handle(makeInitializeWorkspaceRequest(
        'blocked-ordinary',
        SOURCE_APP_BUILD_ID,
        initial.workspaceEpoch,
    ));
    assert.equal(ordinary.ok, false);
    assert.equal(ordinary.ok ? null : ordinary.problem.code, 'stale-workspace');

    const maintenance = await bootstrap(application, SOURCE_APP_BUILD_ID);
    assert.notEqual(maintenance.workspaceEpoch, initial.workspaceEpoch);
    assert.equal(maintenance.workspaceData.kind, 'recovery');

    const cancelCommand = Object.freeze({
        commandId: '77777777-7777-4777-8777-777777777777',
        migrationRollbackSessionId: confirmed.value.session.migrationRollbackSessionId!,
        expectedSessionVersion: confirmed.value.session.sessionVersion!,
    });
    await assert.rejects(
        cancelMigrationRollbackHandoff(
            activityControlRoot,
            dataSlotsRoot,
            Object.freeze({
                action: 'cancel-as-source' as const,
                ...cancelCommand,
                currentAppBuildId: SOURCE_APP_BUILD_ID,
            }),
            Object.freeze({
                async reopen(): Promise<void> {},
                async libraryReconcile(): Promise<void> {},
                async flow00(): Promise<void> {},
            }),
            Object.freeze({
                failpoint(point): void {
                    if (point === 'handoff.command-cancel.after-publish') {
                        throw new Error('lost source-cancel response');
                    }
                },
            }),
        ),
        /completion-pending/,
    );
    await application.close();
    application = await WorkspaceApplication.open(
        dataSlotsRoot,
        SOURCE_APP_BUILD_ID,
        applicationOptions,
    );
    const restartedMaintenance = await bootstrap(application, SOURCE_APP_BUILD_ID);
    const retryStatus = await application.handle(makeMigrationRollbackStatusRequest(
        'rollback-retry-status',
        SOURCE_APP_BUILD_ID,
        restartedMaintenance.workspaceEpoch,
        cancelCommand.migrationRollbackSessionId,
    ));
    assert.equal(retryStatus.ok, true);
    if (!retryStatus.ok || retryStatus.value.kind !== 'workspace.migration-rollback-session') {
        throw new Error('Expected durable source-cancel retry command');
    }
    assert.deepEqual(retryStatus.value.session.retryCommand, {
        action: 'cancel-as-source',
        commandId: cancelCommand.commandId,
        expectedSessionVersion: cancelCommand.expectedSessionVersion,
    });

    const cancelled = await application.handle(makeCancelMigrationRollbackRequest(
        'rollback-cancel',
        SOURCE_APP_BUILD_ID,
        restartedMaintenance.workspaceEpoch,
        cancelCommand,
    ));
    assert.equal(cancelled.ok, true);
    if (!cancelled.ok || cancelled.value.kind !== 'workspace.migration-rollback-session') {
        throw new Error('Expected exact source cancellation');
    }
    assert.equal(cancelled.value.session.phase, 'cancelled');
    assert.equal(cancelled.value.session.outcome, 'cancelled');

    const reopened = await bootstrap(application, SOURCE_APP_BUILD_ID);
    assert.equal(reopened.workspaceData.kind, 'ready');
    const completedOperation = reopened.workspaceLifecycle.operations.find(
        operation => operation.kind === 'migration-rollback',
    );
    assert.equal(completedOperation?.operationId, cancelled.value.session.operationId);
    assert.equal(completedOperation?.state, 'cancelled');
    assert.equal(inspectMigrationSafetyCopy(dataSlotsRoot).kind, 'verified');
});

test('TEST-WORKSPACE-007: changed preview facts resume ordinary DATA without partial maintenance', async t => {
    const dataSlotsRoot = createLevel1Workspace();
    const activityControlRoot = `${dataSlotsRoot}-activity-control`;
    mkdirSync(activityControlRoot);
    const application = await WorkspaceApplication.open(dataSlotsRoot, SOURCE_APP_BUILD_ID, {
        activityControlRoot,
        migrationRollbackTarget: ROLLBACK_TARGET,
        clock: Object.freeze({now: () => '2026-08-27T12:00:00.000Z'}),
    });
    t.after(async () => {
        await application.close();
        rmSync(dataSlotsRoot, {recursive: true, force: true});
        rmSync(activityControlRoot, {recursive: true, force: true});
    });
    const initial = await bootstrap(application, SOURCE_APP_BUILD_ID);
    const safetyStatus = inspectMigrationSafetyCopy(dataSlotsRoot);
    assert.equal(safetyStatus.kind, 'verified');
    if (safetyStatus.kind !== 'verified') {
        throw new Error('Expected a migration safety copy');
    }
    const preview = await application.handle(makeMigrationRollbackPreviewRequest(
        'stale-preview',
        SOURCE_APP_BUILD_ID,
        initial.workspaceEpoch,
    ));
    assert.equal(preview.ok, true);
    if (!preview.ok || preview.value.kind !== 'workspace.migration-rollback-session') {
        throw new Error('Expected a rollback preview');
    }
    deleteMigrationSafetyCopy(
        dataSlotsRoot,
        safetyStatus.metadata.migrationSafetyCopyId,
        safetyStatus.metadata.metadataDigest,
        migrationSafetyCopyDeleteConfirmationToken(
            safetyStatus.metadata.migrationSafetyCopyId,
            safetyStatus.metadata.metadataDigest,
        ),
    );
    const confirmed = await application.handle(makeConfirmMigrationRollbackRequest(
        'stale-confirm',
        SOURCE_APP_BUILD_ID,
        initial.workspaceEpoch,
        {
            commandId: '99999999-9999-4999-8999-999999999999',
            migrationRollbackSessionId: preview.value.session.migrationRollbackSessionId!,
            expectedSessionVersion: preview.value.session.sessionVersion!,
            previewToken: preview.value.session.previewToken!,
        },
    ));
    assert.equal(confirmed.ok, false);
    assert.equal(confirmed.ok ? null : confirmed.problem.code, 'conflict');
    assert.equal(confirmed.ok ? null : confirmed.problem.dataEffect, 'unchanged');

    const ordinary = await application.handle(makeInitializeWorkspaceRequest(
        'ordinary-after-stale-preview',
        SOURCE_APP_BUILD_ID,
        initial.workspaceEpoch,
    ));
    assert.equal(ordinary.ok, true);
    const reopened = await bootstrap(application, SOURCE_APP_BUILD_ID);
    assert.equal(reopened.workspaceData.kind, 'ready');
});

test('TEST-WORKSPACE-007: explicit safety deletion is confirmation-bound and replay-safe', async t => {
    const dataSlotsRoot = createLevel1Workspace();
    const activityControlRoot = `${dataSlotsRoot}-activity-control`;
    mkdirSync(activityControlRoot);
    const application = await WorkspaceApplication.open(dataSlotsRoot, SOURCE_APP_BUILD_ID, {
        activityControlRoot,
        migrationRollbackTarget: ROLLBACK_TARGET,
        clock: Object.freeze({now: () => '2026-08-27T12:00:00.000Z'}),
    });
    t.after(async () => {
        await application.close();
        rmSync(dataSlotsRoot, {recursive: true, force: true});
        rmSync(activityControlRoot, {recursive: true, force: true});
    });
    const initial = await bootstrap(application, SOURCE_APP_BUILD_ID);
    const safety = await application.handle(makeMigrationSafetyCopyQueryRequest(
        'delete-safety-query',
        SOURCE_APP_BUILD_ID,
        initial.workspaceEpoch,
    ));
    assert.equal(safety.ok, true);
    if (!safety.ok || safety.value.kind !== 'workspace.migration-safety-copy'
        || safety.value.safetyCopy.kind !== 'verified') {
        throw new Error('Expected a verified safety copy');
    }
    const command = Object.freeze({
        commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        migrationSafetyCopyId: safety.value.safetyCopy.migrationSafetyCopyId,
        expectedCopyVersion: safety.value.safetyCopy.copyVersion,
        confirmationToken: safety.value.safetyCopy.deleteConfirmationToken,
    });
    const deleted = await application.handle(makeDeleteMigrationSafetyCopyRequest(
        'delete-safety',
        SOURCE_APP_BUILD_ID,
        initial.workspaceEpoch,
        command,
    ));
    assert.equal(deleted.ok, true);
    assert.deepEqual(deleted.ok ? deleted.value : null, {
        kind: 'workspace.migration-safety-copy',
        protocolVersion: 3,
        appBuildId: SOURCE_APP_BUILD_ID,
        requestId: 'delete-safety',
        workspaceEpoch: initial.workspaceEpoch,
        safetyCopy: {kind: 'absent'},
    });

    const replay = await application.handle(makeDeleteMigrationSafetyCopyRequest(
        'delete-safety-replay',
        SOURCE_APP_BUILD_ID,
        initial.workspaceEpoch,
        command,
    ));
    assert.equal(replay.ok, true);
    assert.deepEqual(replay.ok && replay.value.kind === 'workspace.migration-safety-copy'
        ? replay.value.safetyCopy
        : null, {kind: 'absent'});
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
            mode: 'maintenance',
        },
        {
            appBuildId: TARGET_APP_BUILD_ID,
            code: 'rollback-required',
            currentBuild: 'target',
            allowedActions: ['continue-as-target'],
            mode: 'maintenance',
        },
        {
            appBuildId: OTHER_APP_BUILD_ID,
            code: 'rollback-build-mismatch',
            currentBuild: 'other',
            allowedActions: [],
            mode: 'recovery',
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
        assert.equal(first.workspaceLifecycle.mode, expected.mode);
        assert.equal(
            first.workspaceLifecycle.route,
            expected.mode === 'maintenance' ? 'maintenance' : 'recovery',
        );
        assert.equal(
            first.workspaceLifecycle.operations.find(
                operation => operation.kind === 'migration-rollback',
            )?.state,
            'waiting-decision',
        );
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
        const wrongBuildAction = expected.appBuildId === TARGET_APP_BUILD_ID
            ? makeCancelMigrationRollbackRequest(
                'wrong-build-action',
                expected.appBuildId,
                first.workspaceEpoch,
                {
                    commandId: MIGRATION_ROLLBACK_CONTINUE_COMMAND_ID,
                    migrationRollbackSessionId: MIGRATION_ROLLBACK_SESSION_ID,
                    expectedSessionVersion: '4',
                },
            )
            : makeContinueMigrationRollbackRequest(
                'wrong-build-action',
                expected.appBuildId,
                first.workspaceEpoch,
                {
                    commandId: MIGRATION_ROLLBACK_CONTINUE_COMMAND_ID,
                    migrationRollbackSessionId: MIGRATION_ROLLBACK_SESSION_ID,
                    expectedSessionVersion: '4',
                },
            );
        const stopped = await application.handle(wrongBuildAction);
        assert.equal(stopped.ok, false);
        assert.equal(stopped.ok ? null : stopped.problem.code, 'build-mismatch');
        assert.equal(stopped.ok ? null : stopped.problem.dataEffect, 'unchanged');
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
    let dataOpenAttempted = false;

    const application = await WorkspaceApplication.open(
        fixture.dataSlotsRoot,
        TARGET_APP_BUILD_ID,
        {
            activityControlRoot: fixture.activityControlRoot,
            migrationFailpoint() {
                dataOpenAttempted = true;
                throw new Error('DATA open must remain behind the PROTECT gate');
            },
        },
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
    assert.equal(result.workspaceLifecycle.mode, 'recovery');
    assert.equal(result.workspaceLifecycle.route, 'recovery');
    assert.deepEqual(result.workspaceLifecycle.operations, []);
    assert.equal(dataOpenAttempted, false);
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
    assert.equal(result.workspaceLifecycle.mode, 'recovery');
    assert.equal(result.workspaceLifecycle.route, 'recovery');
    assert.equal(
        result.workspaceLifecycle.operations.find(
            operation => operation.kind === 'migration-rollback',
        )?.state,
        'waiting-decision',
    );
    assert.deepEqual(physicalDataSnapshot(fixture.dataSlotsRoot), before);
    await application.close();
});

function createPreviousLevelWorkspace(): string {
    const dataSlotsRoot = createLevel1Workspace();
    const database = new DatabaseSync(path.join(dataSlotsRoot, 'active', 'workspace.sqlite'), {
        enableForeignKeyConstraints: false,
    });
    try {
        database.exec('PRAGMA foreign_keys = OFF');
        for (let level = 1; level < CURRENT_SCHEMA_LEVEL - 1; level += 1) {
            if (!isMigratableSchemaLevel(level)) {
                throw new Error(`No registered forward migration starts at level ${level}`);
            }
            SCHEMA_MIGRATIONS[level](database);
        }
    }
    finally {
        database.close();
    }
    return dataSlotsRoot;
}

test('WP-UI-01 slice 10: a workspace one level behind migrates on the application open path', async t => {
    const dataSlotsRoot = createPreviousLevelWorkspace();
    const activityControlRoot = `${dataSlotsRoot}-activity-control`;
    mkdirSync(activityControlRoot);
    const application = await WorkspaceApplication.open(dataSlotsRoot, SOURCE_APP_BUILD_ID, {
        activityControlRoot,
    });
    t.after(async () => {
        await application.close();
        rmSync(dataSlotsRoot, {recursive: true, force: true});
        rmSync(activityControlRoot, {recursive: true, force: true});
    });

    const ready = await bootstrap(application, SOURCE_APP_BUILD_ID);
    assert.equal(ready.workspaceData.kind, 'ready');
    assert.notEqual(ready.workspaceLifecycle.route, 'recovery');
    assert.notEqual(ready.workspaceLifecycle.mode, 'recovery');

    const migrated = new DatabaseSync(path.join(dataSlotsRoot, 'active', 'workspace.sqlite'), {
        readOnly: true,
    });
    try {
        const version = migrated.prepare('PRAGMA user_version').get() as {user_version: number};
        assert.equal(version.user_version, CURRENT_SCHEMA_LEVEL);
        const state = migrated.prepare(
            'SELECT workspace_id FROM workspace_state WHERE singleton = 1',
        ).get() as {workspace_id: string};
        assert.equal(state.workspace_id, WORKSPACE_ID);
    }
    finally {
        migrated.close();
    }

    const status = inspectMigrationSafetyCopy(dataSlotsRoot);
    assert.equal(status.kind, 'verified');
    if (status.kind !== 'verified') {
        throw new Error('Expected a verified MigrationSafetyCopy after the forward migration');
    }
    assert.equal(status.metadata.sourceSchemaLevel, String(CURRENT_SCHEMA_LEVEL - 1));
    assert.equal(status.metadata.rollbackTarget, null);

    const safety = await application.handle(makeMigrationSafetyCopyQueryRequest(
        'safety-status-without-target',
        SOURCE_APP_BUILD_ID,
        ready.workspaceEpoch,
    ));
    assert.equal(safety.ok, true);
    if (!safety.ok || safety.value.kind !== 'workspace.migration-safety-copy'
        || safety.value.safetyCopy.kind !== 'verified') {
        throw new Error('Expected a verified MigrationSafetyCopy projection');
    }
    assert.equal(safety.value.safetyCopy.target, null);
    assert.notEqual(safety.value.safetyCopy.deleteConfirmationToken, '');
});
