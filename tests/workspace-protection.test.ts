/**
 * @file Verifies the WP-R5-01 slice through the Workspace application boundary.
 */

import assert from 'node:assert/strict';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { WorkspaceApplication } from '../src/workspace-application';
import { makeBootstrapRequest } from '../src/shared/bootstrap-contract';
import {
    makeConfigureBackupDestinationRequest,
    makeDataProtectionQueryRequest,
    makeInitializeWorkspaceRequest,
    makeSelectedBackupDestinationRequest,
} from '../src/shared/workspace-setup-contract';
import {
    BACKUP_REPOSITORY_SCHEMA,
    type ConfigureBackupDestinationCommand,
} from '../src/shared/workspace-protection-contract';

const APP_BUILD_ID = 'test-build';
const COMMAND_ID = '11111111-1111-4111-8111-111111111111';
const FOLLOW_UP_ID = '22222222-2222-4222-8222-222222222222';

type BackupAwareWorkspaceApplication = WorkspaceApplication & Readonly<{
    waitForDurableBackups(): Promise<void>;
}>;

function createDirectory(t: test.TestContext, name: string): string {
    const directory = mkdtempSync(path.join(tmpdir(), `courseflow-${name}-`));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    return directory;
}

async function bootstrap(application: WorkspaceApplication) {
    const outcome = await application.handle({
        ...makeBootstrapRequest('bootstrap', APP_BUILD_ID),
        dataRootClass: 'verified-local' as const,
    });
    assert.equal(outcome.ok, true);
    if (!outcome.ok || !('workspaceEpoch' in outcome.value)) {
        throw new Error('Expected ready Workspace bootstrap');
    }
    return outcome.value;
}

function command(workspaceId: string): ConfigureBackupDestinationCommand {
    return {
        commandId: COMMAND_ID,
        followUpId: FOLLOW_UP_ID,
        workspaceId,
        expectedRevision: '0',
        expectedProtectionVersion: '0',
        intent: {
            kind: 'protect.configure-backup-destination',
            intentSchemaVersion: 1,
            payload: {},
        },
    };
}

test('A-DATA-002/TEST-PROTECT-001: unconfigured, configure, replay, and restart form one slice', async t => {
    const dataSlotsRoot = createDirectory(t, 'workspace-protection');
    const destination = createDirectory(t, 'backup-destination');
    const application = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID);
    const initial = await bootstrap(application);
    const initialized = await application.handle(makeInitializeWorkspaceRequest(
        'initialize',
        APP_BUILD_ID,
        initial.workspaceEpoch,
    ));
    assert.equal(initialized.ok, true);
    if (!initialized.ok
        || initialized.value.kind !== 'workspace.initialized'
        || initialized.value.workspaceData.kind !== 'ready') {
        throw new Error('Expected initialized Workspace');
    }
    const workspaceId = initialized.value.workspaceData.workspaceId;

    const before = await application.handle(makeDataProtectionQueryRequest(
        'protection-before',
        APP_BUILD_ID,
        initial.workspaceEpoch,
    ));
    assert.equal(before.ok, true);
    if (!before.ok || before.value.kind !== 'workspace.data-protection-projection') {
        throw new Error('Expected protection projection');
    }
    assert.deepEqual(before.value.projection, {
        workspaceRevision: '0',
        protectionEntityVersion: '0',
        configuration: { kind: 'unconfigured' },
    });

    const publicRequest = makeConfigureBackupDestinationRequest(
        'configure',
        APP_BUILD_ID,
        initial.workspaceEpoch,
        command(workspaceId),
    );
    const selectedRequest = makeSelectedBackupDestinationRequest(publicRequest, destination);
    const configured = await application.handle(selectedRequest);
    assert.equal(configured.ok, true);
    if (!configured.ok || configured.value.kind !== 'workspace.command-outcome') {
        throw new Error('Expected configuration command outcome');
    }
    const backupSetId = configured.value.outcome.effects[0]!.entity.id;
    assert.equal(configured.value.outcome.effects[0]!.code, 'protect.backup-destination-configured');
    assert.match(backupSetId, /^[0-9a-f-]{36}$/);
    assert.deepEqual(await application.handle(selectedRequest), configured);

    const differentDestination = createDirectory(t, 'different-backup-destination');
    const reused = await application.handle(makeSelectedBackupDestinationRequest(
        publicRequest,
        differentDestination,
    ));
    assert.equal(reused.ok, false);
    if (reused.ok) {
        throw new Error('Expected changed destination to reject CommandId reuse');
    }
    assert.equal(reused.problem.code, 'conflict');
    assert.equal(existsSync(path.join(differentDestination, 'CourseFlow')), false);

    const after = await application.handle(makeDataProtectionQueryRequest(
        'protection-after',
        APP_BUILD_ID,
        initial.workspaceEpoch,
    ));
    assert.equal(after.ok, true);
    if (!after.ok || after.value.kind !== 'workspace.data-protection-projection') {
        throw new Error('Expected configured protection projection');
    }
    assert.deepEqual(after.value.projection.configuration, {
        kind: 'configured',
        backupSetId,
        repositorySchema: BACKUP_REPOSITORY_SCHEMA,
        destinationDisplayName: path.basename(destination),
    });
    assert.doesNotMatch(JSON.stringify(after), /workspace\.sqlite|[A-Za-z]:[\\/]|canonicalPath/);

    await application.close();
    assert.equal(existsSync(path.join(destination, 'CourseFlow')), true);
    assert.equal(readdirSync(path.join(
        destination,
        'CourseFlow',
        workspaceId,
        backupSetId,
    )).length, 1);

    const restarted = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID);
    const restartedBootstrap = await bootstrap(restarted);
    const restartedProjection = await restarted.handle(makeDataProtectionQueryRequest(
        'protection-restarted',
        APP_BUILD_ID,
        restartedBootstrap.workspaceEpoch,
    ));
    assert.equal(restartedProjection.ok, true);
    if (!restartedProjection.ok
        || restartedProjection.value.kind !== 'workspace.data-protection-projection') {
        throw new Error('Expected restarted protection projection');
    }
    assert.deepEqual(restartedProjection.value.projection, after.value.projection);
    await restarted.close();
});

test('TEST-DATA-004/FLOW-04: a formal commit wakes backup asynchronously', async t => {
    const dataSlotsRoot = createDirectory(t, 'workspace-durable-backup');
    const destination = createDirectory(t, 'durable-backup-destination');
    const application = await WorkspaceApplication.open(
        dataSlotsRoot,
        APP_BUILD_ID,
    ) as BackupAwareWorkspaceApplication;
    const initial = await bootstrap(application);
    const initialized = await application.handle(makeInitializeWorkspaceRequest(
        'initialize-durable-backup',
        APP_BUILD_ID,
        initial.workspaceEpoch,
    ));
    assert.equal(initialized.ok, true);
    if (!initialized.ok
        || initialized.value.kind !== 'workspace.initialized'
        || initialized.value.workspaceData.kind !== 'ready') {
        throw new Error('Expected initialized Workspace');
    }
    const configured = await application.handle(makeSelectedBackupDestinationRequest(
        makeConfigureBackupDestinationRequest(
            'configure-durable-backup',
            APP_BUILD_ID,
            initial.workspaceEpoch,
            command(initialized.value.workspaceData.workspaceId),
        ),
        destination,
    ));
    assert.equal(configured.ok, true);
    if (!configured.ok || configured.value.kind !== 'workspace.command-outcome') {
        throw new Error('Expected committed backup configuration');
    }
    assert.equal(typeof application.waitForDurableBackups, 'function');
    await application.waitForDurableBackups();
    const backupSetId = configured.value.outcome.effects[0]!.entity.id;
    const backupSetPath = path.join(
        destination,
        'CourseFlow',
        initialized.value.workspaceData.workspaceId,
        backupSetId,
    );
    assert.equal(readdirSync(backupSetPath).length, 1);
    assert.match(readdirSync(backupSetPath)[0]!, /^snapshot-[0-9a-f-]{36}$/);
    await application.close();
});

test('FLOW-04: an asynchronous backup failure never rolls back the local commit', async t => {
    const dataSlotsRoot = createDirectory(t, 'workspace-failed-durable-backup');
    const destination = createDirectory(t, 'failed-durable-backup-destination');
    const application = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID, {
        durableBackupOptions: {
            failpoint(point: string): void {
                if (point === 'backup.after-database-temp-write') {
                    throw new Error('injected asynchronous backup failure');
                }
            },
        },
    } as unknown as Parameters<typeof WorkspaceApplication.open>[2]) as BackupAwareWorkspaceApplication;
    const initial = await bootstrap(application);
    const initialized = await application.handle(makeInitializeWorkspaceRequest(
        'initialize-failed-backup',
        APP_BUILD_ID,
        initial.workspaceEpoch,
    ));
    assert.equal(initialized.ok, true);
    if (!initialized.ok
        || initialized.value.kind !== 'workspace.initialized'
        || initialized.value.workspaceData.kind !== 'ready') {
        throw new Error('Expected initialized Workspace');
    }
    const configured = await application.handle(makeSelectedBackupDestinationRequest(
        makeConfigureBackupDestinationRequest(
            'configure-failed-backup',
            APP_BUILD_ID,
            initial.workspaceEpoch,
            command(initialized.value.workspaceData.workspaceId),
        ),
        destination,
    ));
    assert.equal(configured.ok, true);
    await application.waitForDurableBackups();
    const projection = await application.handle(makeDataProtectionQueryRequest(
        'query-after-failed-backup',
        APP_BUILD_ID,
        initial.workspaceEpoch,
    ));
    assert.equal(projection.ok, true);
    if (!projection.ok || projection.value.kind !== 'workspace.data-protection-projection') {
        throw new Error('Expected committed protection projection');
    }
    assert.equal(projection.value.projection.workspaceRevision, '1');
    assert.equal(projection.value.projection.configuration.kind, 'configured');
    await application.close();

    const restarted = await WorkspaceApplication.open(
        dataSlotsRoot,
        APP_BUILD_ID,
    ) as BackupAwareWorkspaceApplication;
    await restarted.waitForDurableBackups();
    assert.equal(readdirSync(path.join(
        destination,
        'CourseFlow',
        initialized.value.workspaceData.workspaceId,
        (projection.value.projection.configuration as {backupSetId: string}).backupSetId,
    )).length, 1);
    await restarted.close();
});

test('three-location conflicts remain unchanged and never create a repository', async t => {
    const dataSlotsRoot = createDirectory(t, 'workspace-location-conflict');
    const libraryRoot = path.join(createDirectory(t, 'library-container'), 'library');
    mkdirSync(libraryRoot);
    const nestedDataDestination = path.join(dataSlotsRoot, 'backup-destination');
    mkdirSync(nestedDataDestination);
    const application = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID, { libraryRootPath: libraryRoot });
    const initial = await bootstrap(application);
    const initialized = await application.handle(makeInitializeWorkspaceRequest(
        'initialize',
        APP_BUILD_ID,
        initial.workspaceEpoch,
    ));
    assert.equal(initialized.ok, true);
    if (!initialized.ok
        || initialized.value.kind !== 'workspace.initialized'
        || initialized.value.workspaceData.kind !== 'ready') {
        throw new Error('Expected initialized Workspace');
    }
    const publicRequest = makeConfigureBackupDestinationRequest(
        'configure-overlap',
        APP_BUILD_ID,
        initial.workspaceEpoch,
        command(initialized.value.workspaceData.workspaceId),
    );
    for (const [selectedPath, location] of [
        [path.join(dataSlotsRoot, 'active'), 'active-data'],
        [nestedDataDestination, 'active-data'],
        [libraryRoot, 'library-root'],
    ] as const) {
        const outcome = await application.handle(makeSelectedBackupDestinationRequest(publicRequest, selectedPath));
        assert.equal(outcome.ok, false);
        if (outcome.ok) {
            throw new Error('Expected location conflict');
        }
        assert.equal(outcome.problem.code, 'validation');
        assert.deepEqual(outcome.problem.details, {
            reason: 'backup-location-overlap',
            location,
        });
    }
    const projection = await application.handle(makeDataProtectionQueryRequest(
        'protection-unchanged',
        APP_BUILD_ID,
        initial.workspaceEpoch,
    ));
    assert.equal(projection.ok, true);
    if (!projection.ok || projection.value.kind !== 'workspace.data-protection-projection') {
        throw new Error('Expected unchanged protection projection');
    }
    assert.deepEqual(projection.value.projection.configuration, { kind: 'unconfigured' });
    await application.close();
});

test('pre-COMMIT failure and stale revision leave no repository identity behind', async t => {
    const dataSlotsRoot = createDirectory(t, 'workspace-configuration-failure');
    const destination = createDirectory(t, 'configuration-failure-destination');
    let failBeforeCommit = false;
    const application = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID, {
        commitOptions: {
            failpoint(point) {
                if (failBeforeCommit && point === 'commit.after-facts') {
                    failBeforeCommit = false;
                    throw new Error('injected backup configuration failure');
                }
            },
        },
    });
    const initial = await bootstrap(application);
    const initialized = await application.handle(makeInitializeWorkspaceRequest(
        'initialize',
        APP_BUILD_ID,
        initial.workspaceEpoch,
    ));
    assert.equal(initialized.ok, true);
    if (!initialized.ok
        || initialized.value.kind !== 'workspace.initialized'
        || initialized.value.workspaceData.kind !== 'ready') {
        throw new Error('Expected initialized Workspace');
    }
    const workspaceId = initialized.value.workspaceData.workspaceId;
    failBeforeCommit = true;
    const failed = await application.handle(makeSelectedBackupDestinationRequest(
        makeConfigureBackupDestinationRequest(
            'configure-pre-commit-failure',
            APP_BUILD_ID,
            initial.workspaceEpoch,
            command(workspaceId),
        ),
        destination,
    ));
    assert.equal(failed.ok, false);
    assert.equal(failBeforeCommit, false);
    assert.deepEqual(readdirSync(destination), []);

    const staleCommand: ConfigureBackupDestinationCommand = {
        ...command(workspaceId),
        commandId: '44444444-4444-4444-8444-444444444444',
        followUpId: '55555555-5555-4555-8555-555555555555',
        expectedRevision: '1',
    };
    const stale = await application.handle(makeSelectedBackupDestinationRequest(
        makeConfigureBackupDestinationRequest(
            'configure-stale-revision',
            APP_BUILD_ID,
            initial.workspaceEpoch,
            staleCommand,
        ),
        destination,
    ));
    assert.equal(stale.ok, false);
    if (stale.ok) {
        throw new Error('Expected stale configuration conflict');
    }
    assert.equal(stale.problem.code, 'conflict');
    assert.deepEqual(readdirSync(destination), []);

    const projection = await application.handle(makeDataProtectionQueryRequest(
        'protection-after-failures',
        APP_BUILD_ID,
        initial.workspaceEpoch,
    ));
    assert.equal(projection.ok, true);
    if (!projection.ok || projection.value.kind !== 'workspace.data-protection-projection') {
        throw new Error('Expected unchanged protection projection');
    }
    assert.deepEqual(projection.value.projection, {
        workspaceRevision: '0',
        protectionEntityVersion: '0',
        configuration: { kind: 'unconfigured' },
    });
    await application.close();

    const restarted = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID);
    const restartedBootstrap = await bootstrap(restarted);
    const restartedProjection = await restarted.handle(makeDataProtectionQueryRequest(
        'protection-restarted-after-failures',
        APP_BUILD_ID,
        restartedBootstrap.workspaceEpoch,
    ));
    assert.equal(restartedProjection.ok, true);
    if (!restartedProjection.ok
        || restartedProjection.value.kind !== 'workspace.data-protection-projection') {
        throw new Error('Expected restarted protection projection');
    }
    assert.deepEqual(restartedProjection.value.projection.configuration, { kind: 'unconfigured' });
    await restarted.close();
});

test('an unowned CourseFlow directory reports identity conflict without claiming it', async t => {
    const dataSlotsRoot = createDirectory(t, 'workspace-identity-conflict');
    const destination = createDirectory(t, 'identity-conflict-destination');
    mkdirSync(path.join(destination, 'CourseFlow'));
    const application = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID);
    const initial = await bootstrap(application);
    const initialized = await application.handle(makeInitializeWorkspaceRequest(
        'initialize',
        APP_BUILD_ID,
        initial.workspaceEpoch,
    ));
    assert.equal(initialized.ok, true);
    if (!initialized.ok
        || initialized.value.kind !== 'workspace.initialized'
        || initialized.value.workspaceData.kind !== 'ready') {
        throw new Error('Expected initialized Workspace');
    }
    const request = makeConfigureBackupDestinationRequest(
        'configure-conflict',
        APP_BUILD_ID,
        initial.workspaceEpoch,
        command(initialized.value.workspaceData.workspaceId),
    );
    const outcome = await application.handle(makeSelectedBackupDestinationRequest(request, destination));

    assert.equal(outcome.ok, false);
    if (outcome.ok) {
        throw new Error('Expected repository identity conflict');
    }
    assert.equal(outcome.problem.code, 'identity-conflict');
    assert.deepEqual(readdirSync(path.join(destination, 'CourseFlow')), []);
    await application.close();
});
