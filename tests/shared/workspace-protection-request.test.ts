/**
 * @file Verifies PROTECT request envelopes on the Shell and Workspace process boundaries.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    isWorkspaceProcessRequest,
    isWorkspaceSetupOutcome,
    isWorkspaceSetupRequest,
    makeConfigureBackupDestinationRequest,
    makeDataProtectionQueryRequest,
    makeSelectedBackupDestinationRequest,
} from '../../src/shared/workspace-setup-contract';
import type { ConfigureBackupDestinationCommand } from '../../src/shared/workspace-protection-contract';

const APP_BUILD_ID = 'test-build';
const WORKSPACE_EPOCH = '11111111-1111-4111-8111-111111111111';
const COMMAND = {
    commandId: '22222222-2222-4222-8222-222222222222',
    followUpId: '33333333-3333-4333-8333-333333333333',
    workspaceId: '44444444-4444-4444-8444-444444444444',
    expectedRevision: '0',
    expectedProtectionVersion: '0',
    intent: {
        kind: 'protect.configure-backup-destination',
        intentSchemaVersion: 1,
        payload: {},
    },
} as const satisfies ConfigureBackupDestinationCommand;

test('Shell sends a path-free configure intent and Main adds the selected path internally', () => {
    const request = makeConfigureBackupDestinationRequest(
        'configure',
        APP_BUILD_ID,
        WORKSPACE_EPOCH,
        COMMAND,
    );
    const selected = makeSelectedBackupDestinationRequest(request, 'C:\\Backups');

    assert.equal(isWorkspaceSetupRequest(request, APP_BUILD_ID, WORKSPACE_EPOCH), true);
    assert.equal(isWorkspaceProcessRequest(request, APP_BUILD_ID, WORKSPACE_EPOCH), false);
    assert.equal(isWorkspaceSetupRequest(selected, APP_BUILD_ID, WORKSPACE_EPOCH), false);
    assert.equal(isWorkspaceProcessRequest(selected, APP_BUILD_ID, WORKSPACE_EPOCH), true);
    assert.equal(JSON.stringify(request).includes('C:\\Backups'), false);
    assert.equal(selected.selectedDirectoryPath, 'C:\\Backups');
});

test('the protection query crosses both boundaries without a path or mutation payload', () => {
    const request = makeDataProtectionQueryRequest('query-protection', APP_BUILD_ID, WORKSPACE_EPOCH);

    assert.equal(isWorkspaceSetupRequest(request, APP_BUILD_ID, WORKSPACE_EPOCH), true);
    assert.equal(isWorkspaceProcessRequest(request, APP_BUILD_ID, WORKSPACE_EPOCH), true);
    assert.deepEqual(Object.keys(request).sort(), [
        'appBuildId',
        'kind',
        'protocolVersion',
        'requestId',
        'workspaceEpoch',
    ]);
});

test('the outcome validator accepts legal unconfigured state and rejects leaked paths', () => {
    const outcome = {
        ok: true,
        value: {
            kind: 'workspace.data-protection-projection',
            protocolVersion: 3,
            appBuildId: APP_BUILD_ID,
            requestId: 'query-protection',
            workspaceEpoch: WORKSPACE_EPOCH,
            dataMode: 'ready',
            projection: {
                workspaceRevision: '0',
                protectionEntityVersion: '0',
                configuration: { kind: 'unconfigured' },
            },
        },
    } as const;
    assert.equal(isWorkspaceSetupOutcome(
        outcome,
        APP_BUILD_ID,
        'query-protection',
        WORKSPACE_EPOCH,
    ), true);
    assert.equal(isWorkspaceSetupOutcome({
        ...outcome,
        value: {
            ...outcome.value,
            projection: {
                ...outcome.value.projection,
                canonicalPath: 'C:\\Backups',
            },
        },
    }, APP_BUILD_ID, 'query-protection', WORKSPACE_EPOCH), false);
});
