/**
 * @file Verifies the unified pre-DATA PROTECT startup classification.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    classifyWorkspaceStartupInspection,
} from '../../src/protect/workspace-startup';
import type {MigrationRollbackBootState} from '../../src/protect/migration-rollback-handoff';
import type {RestoreBootState} from '../../src/protect/restore-activation';
import type {RestoreSessionView} from '../../src/shared/workspace-protection-contract';

const restoreSession = {
    restoreSessionId: '11111111-1111-4111-8111-111111111111',
    operationId: '22222222-2222-4222-8222-222222222222',
    sessionVersion: '1',
    phase: 'waiting-decision',
} as unknown as RestoreSessionView;

const clearRestore: RestoreBootState = {
    kind: 'clear',
    session: null,
    terminal: null,
};
const clearRollback: MigrationRollbackBootState = {
    kind: 'clear',
    migrationRollbackSessionId: null,
    operationId: null,
    sessionVersion: null,
    phase: null,
    currentBuild: null,
    requiredBuilds: null,
    allowedActions: [],
    retryCommand: null,
    outcome: null,
};
const maintenanceRollback: MigrationRollbackBootState = {
    kind: 'maintenance',
    migrationRollbackSessionId: '33333333-3333-4333-8333-333333333333',
    operationId: '44444444-4444-4444-8444-444444444444',
    sessionVersion: '2',
    phase: 'awaiting-target-build',
    currentBuild: 'target',
    requiredBuilds: {
        sourceAppBuildId: 'source-build',
        sourceReleaseVersion: '2.0.0',
        targetAppBuildId: 'target-build',
        targetReleaseVersion: '1.0.0',
    },
    allowedActions: ['continue-as-target'],
    retryCommand: null,
    outcome: null,
};

test('preview and waiting-decision Restore sessions remain ordinary and queryable', () => {
    for (const phase of ['previewed', 'waiting-decision'] as const) {
        const restore: RestoreBootState = {
            kind: 'pre-checkpoint-session',
            session: {...restoreSession, phase},
            terminal: null,
        };
        const inspection = classifyWorkspaceStartupInspection(restore, clearRollback);
        assert.equal(inspection.kind, 'ordinary');
        assert.equal(inspection.restore.session?.phase, phase);
    }
});

test('confirmed Restore and MigrationRollback sessions enter maintenance', () => {
    const confirmedRestore: RestoreBootState = {
        kind: 'pre-checkpoint-session',
        session: {...restoreSession, phase: 'protection-established'},
        terminal: null,
    };
    assert.equal(
        classifyWorkspaceStartupInspection(confirmedRestore, clearRollback).kind,
        'maintenance',
    );
    assert.equal(
        classifyWorkspaceStartupInspection(clearRestore, maintenanceRollback).kind,
        'maintenance',
    );
});

test('uncertain or ambiguous activation evidence enters recovery without inventing actions', () => {
    const recoveryRestore: RestoreBootState = {
        kind: 'recovery-required',
        session: {...restoreSession, phase: 'recovery-required', allowedActions: []},
        terminal: null,
    };
    assert.equal(
        classifyWorkspaceStartupInspection(recoveryRestore, clearRollback).kind,
        'recovery-required',
    );

    const ambiguous = classifyWorkspaceStartupInspection({
        kind: 'pre-checkpoint-session',
        session: restoreSession,
        terminal: null,
    }, maintenanceRollback);
    assert.equal(ambiguous.kind, 'recovery-required');
    assert.equal(ambiguous.reason, 'ambiguous-operations');
});
