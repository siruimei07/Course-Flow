/**
 * @file Verifies WP-R6-01 through the Shell-to-Workspace-to-PROTECT boundary.
 */

import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {WorkspaceApplication} from '../src/workspace-application';
import {makeBootstrapRequest} from '../src/shared/bootstrap-contract';
import * as setupContract from '../src/shared/workspace-setup-contract';
import {
    BACKUP_REPOSITORY_SCHEMA,
    type ConfigureBackupDestinationCommand,
    type ConfirmRestoreSessionCommand,
    type DataProtectionProjection,
    type RestoreCandidateProjection,
    type RestoreSessionView,
    type StartRestoreSessionCommand,
} from '../src/shared/workspace-protection-contract';

const APP_BUILD_ID = 'test-build';
const CONFIGURE_COMMAND_ID = '11111111-1111-4111-8111-111111111111';
const CONFIGURE_FOLLOW_UP_ID = '22222222-2222-4222-8222-222222222222';
const START_COMMAND_ID = '33333333-3333-4333-8333-333333333333';
const CONFIRM_COMMAND_ID = '44444444-4444-4444-8444-444444444444';

type SetupContract = Readonly<{
    makeInitializeWorkspaceRequest(...args: [string, string, string]): unknown;
    makeConfigureBackupDestinationRequest(
        ...args: [string, string, string, ConfigureBackupDestinationCommand]
    ): unknown;
    makeSelectedBackupDestinationRequest(request: unknown, selectedPath: string): unknown;
    makeDataProtectionQueryRequest(...args: [string, string, string]): unknown;
    makeStartRestoreSessionRequest(
        ...args: [string, string, string, StartRestoreSessionCommand]
    ): unknown;
    makeRestoreSessionQueryRequest(...args: [string, string, string, string]): unknown;
    makeConfirmRestoreSessionRequest(
        ...args: [string, string, string, ConfirmRestoreSessionCommand]
    ): unknown;
}>;

type RestoreWorkspaceOutcome = Readonly<{
    ok: true;
    value: Readonly<{
        kind: 'workspace.restore-session';
        session: RestoreSessionView;
    }>;
}> | Readonly<{ok: false}>;

type InitializeOutcome = Readonly<{
    ok: true;
    value: Readonly<{
        kind: 'workspace.initialized';
        workspaceData: Readonly<{kind: 'ready'; workspaceId: string}>;
    }>;
}> | Readonly<{ok: false}>;

type ProtectionOutcome = Readonly<{
    ok: true;
    value: Readonly<{
        kind: 'workspace.data-protection-projection';
        projection: DataProtectionProjection;
    }>;
}> | Readonly<{ok: false}>;

function contract(): SetupContract {
    return setupContract as unknown as SetupContract;
}

function createDirectory(prefix: string): string {
    return mkdtempSync(path.join(tmpdir(), prefix));
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

test('TEST-WORKSPACE-002/TEST-PROTECT-004: restore remains path-free across Workspace', async t => {
    const dataSlotsRoot = createDirectory('courseflow-workspace-restore-data-');
    const activityControlRoot = createDirectory('courseflow-workspace-restore-control-');
    const destination = createDirectory('courseflow-workspace-restore-backup-');
    const application = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID, {
        activityControlRoot,
    });
    t.after(async () => {
        await application.close();
        for (const directory of [destination, activityControlRoot, dataSlotsRoot]) {
            rmSync(directory, {recursive: true, force: true});
        }
    });
    const initial = await bootstrap(application);
    const initialized = await application.handle(contract().makeInitializeWorkspaceRequest(
        'initialize',
        APP_BUILD_ID,
        initial.workspaceEpoch,
    ) as never) as unknown as InitializeOutcome;
    assert.equal(initialized.ok, true);
    if (!initialized.ok
        || initialized.value.kind !== 'workspace.initialized'
        || initialized.value.workspaceData.kind !== 'ready') {
        throw new Error('Expected initialized Workspace');
    }
    const configureCommand: ConfigureBackupDestinationCommand = {
        commandId: CONFIGURE_COMMAND_ID,
        followUpId: CONFIGURE_FOLLOW_UP_ID,
        workspaceId: initialized.value.workspaceData.workspaceId,
        expectedRevision: '0',
        expectedProtectionVersion: '0',
        intent: {
            kind: 'protect.configure-backup-destination',
            intentSchemaVersion: 1,
            payload: {},
        },
    };
    const publicConfigure = contract().makeConfigureBackupDestinationRequest(
        'configure',
        APP_BUILD_ID,
        initial.workspaceEpoch,
        configureCommand,
    );
    const configured = await application.handle(contract().makeSelectedBackupDestinationRequest(
        publicConfigure,
        destination,
    ) as never);
    assert.equal(configured.ok, true);
    await (application as WorkspaceApplication & {
        waitForDurableBackups(): Promise<void>;
    }).waitForDurableBackups();

    const protection = await application.handle(contract().makeDataProtectionQueryRequest(
        'protection',
        APP_BUILD_ID,
        initial.workspaceEpoch,
    ) as never) as unknown as ProtectionOutcome;
    assert.equal(protection.ok, true);
    if (!protection.ok || protection.value.kind !== 'workspace.data-protection-projection') {
        throw new Error('Expected protection projection');
    }
    assert.equal(protection.value.projection.configuration.kind, 'configured');
    if (!('backup' in protection.value.projection)) {
        throw new Error('Expected configured backup projection');
    }
    const backup = protection.value.projection.backup as typeof protection.value.projection.backup & {
        restoreCandidates: readonly RestoreCandidateProjection[];
    };
    const candidate = backup.restoreCandidates.find(
        item => item.status === 'verified',
    )!;
    const started = await application.handle(contract().makeStartRestoreSessionRequest(
        'restore-start',
        APP_BUILD_ID,
        initial.workspaceEpoch,
        {commandId: START_COMMAND_ID, candidateRef: candidate.candidateRef},
    ) as never) as unknown as RestoreWorkspaceOutcome;
    assert.equal(started.ok, true);
    if (!started.ok || started.value.kind !== 'workspace.restore-session') {
        throw new Error('Expected RestoreSession preview');
    }
    assert.equal(started.value.session.impact.replacement, 'complete');
    assert.equal(started.value.session.impact.automaticMerge, false);

    const queried = await application.handle(contract().makeRestoreSessionQueryRequest(
        'restore-query',
        APP_BUILD_ID,
        initial.workspaceEpoch,
        started.value.session.restoreSessionId,
    ) as never) as unknown as RestoreWorkspaceOutcome;
    assert.equal(queried.ok, true);
    if (!queried.ok) {
        throw new Error('Expected queried RestoreSession');
    }
    assert.deepEqual(queried.value.session, started.value.session);

    const confirmed = await application.handle(contract().makeConfirmRestoreSessionRequest(
        'restore-confirm',
        APP_BUILD_ID,
        initial.workspaceEpoch,
        {
            commandId: CONFIRM_COMMAND_ID,
            restoreSessionId: started.value.session.restoreSessionId,
            expectedSessionVersion: started.value.session.sessionVersion,
            previewToken: started.value.session.previewToken!,
        },
    ) as never) as unknown as RestoreWorkspaceOutcome;
    assert.equal(confirmed.ok, true);
    if (!confirmed.ok || confirmed.value.kind !== 'workspace.restore-session') {
        throw new Error('Expected confirmed RestoreSession');
    }
    assert.equal(confirmed.value.session.phase, 'protection-established');
    assert.equal(confirmed.value.session.recoverability.safetySet.state, 'verified');
    assert.doesNotMatch(
        JSON.stringify({protection, started, queried, confirmed}),
        /(?:[A-Za-z]:[\\/]|canonicalPath|directoryPath|workspace\.sqlite)/,
    );
    assert.equal(BACKUP_REPOSITORY_SCHEMA, 'courseflow-backup-repository-v1');
});
