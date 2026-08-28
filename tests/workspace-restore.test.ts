/**
 * @file Verifies WP-R6-01 through the Shell-to-Workspace-to-PROTECT boundary.
 */

import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {WorkspaceApplication} from '../src/workspace/application';
import {makeBootstrapRequest} from '../src/shared/bootstrap-contract';
import * as setupContract from '../src/shared/workspace-setup-contract';
import {
    BACKUP_REPOSITORY_SCHEMA,
    type ConfigureBackupDestinationCommand,
    type ConfirmRestoreSessionCommand,
    type DataProtectionProjection,
    type RestoreCandidateProjection,
    type RestoreSessionActionCommand,
    type RestoreSessionView,
    type StartRestoreSessionCommand,
} from '../src/shared/workspace-protection-contract';

const APP_BUILD_ID = 'test-build';
const CONFIGURE_COMMAND_ID = '11111111-1111-4111-8111-111111111111';
const CONFIGURE_FOLLOW_UP_ID = '22222222-2222-4222-8222-222222222222';
const START_COMMAND_ID = '33333333-3333-4333-8333-333333333333';
const CONFIRM_COMMAND_ID = '44444444-4444-4444-8444-444444444444';
const RESUME_COMMAND_ID = '55555555-5555-4555-8555-555555555555';
const ROLLBACK_COMMAND_ID = '66666666-6666-4666-8666-666666666666';
const SECOND_START_COMMAND_ID = '77777777-7777-4777-8777-777777777777';

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
    makeResumeRestoreSessionRequest(
        ...args: [string, string, string, RestoreSessionActionCommand]
    ): unknown;
    makeRollbackRestoreSessionRequest(
        ...args: [string, string, string, RestoreSessionActionCommand]
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

async function prepareProtectedRestore(
    t: test.TestContext,
    restoreFailpoint?: (point: string) => void,
) {
    const dataSlotsRoot = createDirectory('courseflow-workspace-restore-data-');
    const activityControlRoot = createDirectory('courseflow-workspace-restore-control-');
    const destination = createDirectory('courseflow-workspace-restore-backup-');
    const application = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID, {
        activityControlRoot,
        restoreFailpoint,
    });
    const applications = [application];
    t.after(async () => {
        for (const current of applications) {
            await current.close();
        }
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
    const initializedBootstrap = await bootstrap(application);
    assert.equal(initializedBootstrap.workspaceLifecycle.route, 'setup');
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
    await application.waitForDurableBackups();
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
    const candidate = backup.restoreCandidates.find(item => item.status === 'verified')!;
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
    return {
        activityControlRoot,
        application,
        applications,
        confirmed,
        dataSlotsRoot,
        initial,
        protection,
        queried,
        started,
    };
}

test('TEST-WORKSPACE-002/TEST-PROTECT-004: restore remains path-free across Workspace', async t => {
    const fixture = await prepareProtectedRestore(t);
    const {application, confirmed, initial, protection, queried, started} = fixture;
    assert.equal(started.value.session.impact.replacement, 'complete');
    assert.equal(started.value.session.impact.automaticMerge, false);
    assert.equal(confirmed.value.session.phase, 'protection-established');
    assert.equal(confirmed.value.session.recoverability.safetySet.state, 'verified');
    const maintenance = await bootstrap(application);
    assert.equal(maintenance.workspaceLifecycle.mode, 'maintenance');
    assert.equal(maintenance.workspaceLifecycle.route, 'maintenance');
    assert.equal(
        maintenance.workspaceLifecycle.operations.find(operation => operation.kind === 'restore')?.state,
        'accepted',
    );
    assert.equal(maintenance.workspaceLifecycle.capabilities['protect.backup'], 'unavailable');
    const blockedOrdinary = await application.handle(contract().makeInitializeWorkspaceRequest(
        'blocked-during-restore',
        APP_BUILD_ID,
        initial.workspaceEpoch,
    ) as never);
    assert.equal(blockedOrdinary.ok, false);

    const resumed = await application.handle(contract().makeResumeRestoreSessionRequest(
        'restore-resume',
        APP_BUILD_ID,
        initial.workspaceEpoch,
        {
            commandId: RESUME_COMMAND_ID,
            restoreSessionId: confirmed.value.session.restoreSessionId,
            expectedSessionVersion: confirmed.value.session.sessionVersion,
        },
    ) as never) as unknown as RestoreWorkspaceOutcome;
    assert.equal(resumed.ok, true);
    if (!resumed.ok || resumed.value.kind !== 'workspace.restore-session') {
        throw new Error('Expected succeeded RestoreSession');
    }
    assert.equal(resumed.value.session.phase, 'succeeded');
    const afterActivation = await bootstrap(application);
    assert.notEqual(afterActivation.workspaceEpoch, initial.workspaceEpoch);
    assert.equal(afterActivation.workspaceData.kind, 'ready');
    const stale = await application.handle(contract().makeDataProtectionQueryRequest(
        'stale-after-restore',
        APP_BUILD_ID,
        initial.workspaceEpoch,
    ) as never);
    assert.equal(stale.ok, false);
    assert.equal(stale.ok ? null : stale.problem.code, 'stale-workspace');
    assert.doesNotMatch(
        JSON.stringify({protection, started, queried, confirmed, resumed, afterActivation, stale}),
        /(?:[A-Za-z]:[\\/]|canonicalPath|directoryPath|workspace\.sqlite)/,
    );
    assert.equal(BACKUP_REPOSITORY_SCHEMA, 'courseflow-backup-repository-v1');
});

test('FLOW-05: armed recovery blocks ordinary open until explicit rollback reopens DATA', async t => {
    const fixture = await prepareProtectedRestore(t, point => {
        if (point === 'activation.after-retire-action') {
            throw new Error(point);
        }
    });
    const failed = await fixture.application.handle(contract().makeResumeRestoreSessionRequest(
        'restore-resume',
        APP_BUILD_ID,
        fixture.initial.workspaceEpoch,
        {
            commandId: RESUME_COMMAND_ID,
            restoreSessionId: fixture.confirmed.value.session.restoreSessionId,
            expectedSessionVersion: fixture.confirmed.value.session.sessionVersion,
        },
    ) as never);
    assert.equal(failed.ok, false);
    assert.equal(existsSync(path.join(fixture.dataSlotsRoot, 'active')), false);
    await fixture.application.close();

    const restarted = await WorkspaceApplication.open(
        fixture.dataSlotsRoot,
        APP_BUILD_ID,
        {activityControlRoot: fixture.activityControlRoot},
    );
    fixture.applications.push(restarted);
    const recovery = await bootstrap(restarted);
    assert.equal(recovery.workspaceData.kind, 'recovery');
    if (recovery.workspaceData.kind !== 'recovery') {
        throw new Error('Expected activation recovery gate');
    }
    assert.equal(recovery.workspaceData.problem.code, 'recovery-required');
    assert.equal(
        'reason' in recovery.workspaceData.problem.details
            ? recovery.workspaceData.problem.details.reason
            : null,
        'restore-activation-pending',
    );
    assert.deepEqual(recovery.workspaceData.problem.allowedActions, ['resume', 'rollback']);
    assert.equal(recovery.workspaceLifecycle.mode, 'recovery');
    assert.equal(recovery.workspaceLifecycle.route, 'recovery');
    assert.equal(
        recovery.workspaceLifecycle.operations.find(operation => operation.kind === 'restore')?.state,
        'recovery-required',
    );
    const ordinary = await restarted.handle(contract().makeDataProtectionQueryRequest(
        'ordinary-query',
        APP_BUILD_ID,
        recovery.workspaceEpoch,
    ) as never);
    assert.equal(ordinary.ok, false);

    const rolledBack = await restarted.handle(contract().makeRollbackRestoreSessionRequest(
        'restore-rollback',
        APP_BUILD_ID,
        recovery.workspaceEpoch,
        {
            commandId: ROLLBACK_COMMAND_ID,
            restoreSessionId: fixture.confirmed.value.session.restoreSessionId,
            expectedSessionVersion: '2',
        },
    ) as never) as unknown as RestoreWorkspaceOutcome;
    assert.equal(rolledBack.ok, true);
    if (!rolledBack.ok || rolledBack.value.kind !== 'workspace.restore-session') {
        throw new Error('Expected rolled-back RestoreSession');
    }
    assert.equal(rolledBack.value.session.phase, 'rolled-back');
    const reopened = await bootstrap(restarted);
    assert.equal(reopened.workspaceData.kind, 'ready');
    assert.notEqual(reopened.workspaceEpoch, recovery.workspaceEpoch);

    await restarted.close();
    const terminalRestart = await WorkspaceApplication.open(
        fixture.dataSlotsRoot,
        APP_BUILD_ID,
        {activityControlRoot: fixture.activityControlRoot},
    );
    fixture.applications.push(terminalRestart);
    const terminalBootstrap = await bootstrap(terminalRestart);
    assert.equal(terminalBootstrap.workspaceData.kind, 'ready');
    assert.equal(terminalBootstrap.workspaceLifecycle.route, 'setup');
    const terminalQuery = await terminalRestart.handle(contract().makeRestoreSessionQueryRequest(
        'terminal-query',
        APP_BUILD_ID,
        terminalBootstrap.workspaceEpoch,
        rolledBack.value.session.restoreSessionId,
    ) as never) as unknown as RestoreWorkspaceOutcome;
    assert.equal(terminalQuery.ok, true);
    if (!terminalQuery.ok || terminalQuery.value.kind !== 'workspace.restore-session') {
        throw new Error('Expected terminal RestoreSession after restart');
    }
    assert.equal(terminalQuery.value.session.phase, 'rolled-back');

    await terminalRestart.waitForDurableBackups();
    const terminalProtection = await terminalRestart.handle(
        contract().makeDataProtectionQueryRequest(
            'terminal-protection',
            APP_BUILD_ID,
            terminalBootstrap.workspaceEpoch,
        ) as never,
    ) as unknown as ProtectionOutcome;
    assert.equal(terminalProtection.ok, true);
    if (!terminalProtection.ok
        || terminalProtection.value.kind !== 'workspace.data-protection-projection'
        || terminalProtection.value.projection.configuration.kind !== 'configured'
        || !('backup' in terminalProtection.value.projection)) {
        throw new Error('Expected usable protection after terminal restart');
    }
    const nextCandidate = terminalProtection.value.projection.backup.restoreCandidates
        .find(candidate => candidate.status === 'verified');
    assert.ok(nextCandidate);
    const secondStarted = await terminalRestart.handle(contract().makeStartRestoreSessionRequest(
        'second-restore-start',
        APP_BUILD_ID,
        terminalBootstrap.workspaceEpoch,
        {commandId: SECOND_START_COMMAND_ID, candidateRef: nextCandidate.candidateRef},
    ) as never) as unknown as RestoreWorkspaceOutcome;
    assert.equal(secondStarted.ok, true);
    if (!secondStarted.ok || secondStarted.value.kind !== 'workspace.restore-session') {
        throw new Error('Expected a new RestoreSession after rollback');
    }
    await terminalRestart.close();

    const preCheckpointRestart = await WorkspaceApplication.open(
        fixture.dataSlotsRoot,
        APP_BUILD_ID,
        {activityControlRoot: fixture.activityControlRoot},
    );
    fixture.applications.push(preCheckpointRestart);
    const preCheckpointBootstrap = await bootstrap(preCheckpointRestart);
    assert.equal(preCheckpointBootstrap.workspaceLifecycle.mode, 'ready');
    assert.equal(preCheckpointBootstrap.workspaceLifecycle.route, 'setup');
    assert.equal(
        preCheckpointBootstrap.workspaceLifecycle.operations.find(
            operation => operation.kind === 'restore',
        )?.state,
        'waiting-decision',
    );
    const ordinaryAfterSecondStart = await preCheckpointRestart.handle(
        contract().makeDataProtectionQueryRequest(
            'second-restore-protection',
            APP_BUILD_ID,
            preCheckpointBootstrap.workspaceEpoch,
        ) as never,
    );
    assert.equal(ordinaryAfterSecondStart.ok, true);
    assert.doesNotMatch(
        JSON.stringify({
            recovery,
            rolledBack,
            reopened,
            terminalBootstrap,
            terminalQuery,
            secondStarted,
            preCheckpointBootstrap,
        }),
        /(?:[A-Za-z]:[\\/]|canonicalPath|directoryPath|workspace\.sqlite)/,
    );
});
