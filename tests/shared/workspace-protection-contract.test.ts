/**
 * @file Verifies bounded PROTECT commands and data-protection projections.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    BACKUP_REPOSITORY_SCHEMA,
    isDataProtectionProjection,
    normalizeAcceptedConfigureBackupDestinationCommand,
    normalizeConfigureBackupDestinationCommand,
    type ConfigureBackupDestinationCommand,
} from '../../src/shared/workspace-protection-contract';

const COMMAND = {
    commandId: '11111111-1111-4111-8111-111111111111',
    followUpId: '22222222-2222-4222-8222-222222222222',
    workspaceId: '33333333-3333-4333-8333-333333333333',
    expectedRevision: '0',
    expectedProtectionVersion: '0',
    intent: {
        kind: 'protect.configure-backup-destination',
        intentSchemaVersion: 1,
        payload: {},
    },
} as const satisfies ConfigureBackupDestinationCommand;

test('the public configure command is exact and contains no filesystem path', () => {
    const normalized = normalizeConfigureBackupDestinationCommand(COMMAND);

    assert.deepEqual(normalized, COMMAND);
    assert.equal(JSON.stringify(normalized).includes('path'), false);
    assert.throws(() => normalizeConfigureBackupDestinationCommand({
        ...COMMAND,
        selectedDirectoryPath: 'C:\\outside-the-workspace-boundary',
    }), TypeError);
});

test('the accepted configure command adds only Workspace-internal destination facts', () => {
    const normalized = normalizeAcceptedConfigureBackupDestinationCommand({
        ...COMMAND,
        destination: {
            backupSetId: '44444444-4444-4444-8444-444444444444',
            canonicalPath: 'C:\\Backups',
            displayName: 'Backups',
            repositorySchema: BACKUP_REPOSITORY_SCHEMA,
        },
    });

    assert.deepEqual(normalized.destination, {
        backupSetId: '44444444-4444-4444-8444-444444444444',
        canonicalPath: 'C:\\Backups',
        displayName: 'Backups',
        repositorySchema: BACKUP_REPOSITORY_SCHEMA,
    });
});

test('unconfigured is a valid protection projection without a persistent problem', () => {
    assert.equal(isDataProtectionProjection({
        workspaceRevision: '0',
        protectionEntityVersion: '0',
        configuration: { kind: 'unconfigured' },
    }), true);
});

test('TEST-PROTECT-003: configured projections expose persistent pending and last-success facts', () => {
    const projection = {
        workspaceRevision: '1',
        protectionEntityVersion: '1',
        configuration: {
            kind: 'configured',
            backupSetId: '44444444-4444-4444-8444-444444444444',
            repositorySchema: BACKUP_REPOSITORY_SCHEMA,
            destinationDisplayName: 'Backups',
        },
        backup: {
            state: 'pending',
            neededThrough: '3',
            succeededThrough: '2',
            lastSuccess: {
                snapshotId: '55555555-5555-4555-8555-555555555555',
                protectedThrough: '2',
                succeededAt: '2026-08-26T12:00:00.000Z',
            },
            recentVerifiedSnapshots: [{
                snapshotId: '55555555-5555-4555-8555-555555555555',
                backupSequence: '2',
                actualRevision: '2',
                succeededAt: '2026-08-26T12:00:00.000Z',
                snapshotFormatVersion: '1',
                integrity: 'verified',
            }],
            restoreCandidates: [],
            cleanup: 'idle',
        },
    } as const;

    assert.equal(isDataProtectionProjection(projection), true);
    assert.equal(JSON.stringify(projection).includes('C:\\'), false);
    assert.equal(isDataProtectionProjection({
        ...projection,
        configuration: {
            ...projection.configuration,
            canonicalPath: 'C:\\Backups',
        },
    }), false);
    assert.equal(isDataProtectionProjection({
        ...projection,
        backup: {...projection.backup, state: 'unknown'},
    }), false);
    assert.equal(isDataProtectionProjection({
        ...projection,
        backup: {...projection.backup, succeededThrough: '1'},
    }), false);
    assert.equal(isDataProtectionProjection({
        ...projection,
        backup: {
            ...projection.backup,
            recentVerifiedSnapshots: [],
        },
    }), true);
});
