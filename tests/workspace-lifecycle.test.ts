/**
 * @file Verifies Workspace-owned FLOW-00 mode, route, capability, and health aggregation.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    workspaceLifecycleFrom,
    type WorkspaceLifecycleInput,
} from '../src/workspace/lifecycle';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const operationId = '22222222-2222-4222-8222-222222222222';
const followUpId = '33333333-3333-4333-8333-333333333333';
const commandId = '44444444-4444-4444-8444-444444444444';

function readyInput(overrides: Partial<WorkspaceLifecycleInput> = {}): WorkspaceLifecycleInput {
    return {
        workspaceData: {
            kind: 'ready',
            workspaceId,
            schemaLevel: 17,
            revision: '7',
        },
        setupRoute: 'setup',
        startupDisposition: 'ordinary',
        moduleStatus: {},
        operations: [],
        pendingFollowUps: [],
        ...overrides,
    };
}

test('FLOW-00 routes absent, unfinished, milestone, and read-only DATA without collapsing states', () => {
    const welcome = workspaceLifecycleFrom(readyInput({
        workspaceData: {kind: 'absent'},
        setupRoute: null,
    }));
    assert.equal(welcome.mode, 'ready');
    assert.equal(welcome.route, 'welcome');
    assert.equal(welcome.workspaceRevision, null);
    assert.equal(welcome.capabilities['workspace.initialize'], 'available');
    assert.equal(welcome.capabilities['workspace.read'], 'unavailable');

    const setup = workspaceLifecycleFrom(readyInput());
    assert.equal(setup.route, 'setup');
    assert.equal(setup.workspaceRevision, '7');

    const today = workspaceLifecycleFrom(readyInput({setupRoute: 'today'}));
    assert.equal(today.route, 'today');

    const readOnly = workspaceLifecycleFrom(readyInput({
        workspaceData: {
            kind: 'read-only',
            workspaceId,
            schemaLevel: 17,
            revision: '7',
            problem: {
                code: 'permission',
                scope: 'workspace',
                dataEffect: 'unchanged',
                affectedCapabilities: ['workspace.write'],
                allowedActions: [],
                context: {},
                details: {reason: 'read-only'},
            },
        },
        setupRoute: 'today',
    }));
    assert.equal(readOnly.mode, 'read-only');
    assert.equal(readOnly.route, 'today');
    assert.equal(readOnly.capabilities['workspace.read'], 'available');
    assert.equal(readOnly.capabilities['workspace.write'], 'unavailable');
    assert.equal(readOnly.capabilities['plan.write'], 'unavailable');
});

test('TEST-WORKSPACE-003 isolates disabled, unavailable, degraded, and recovering modules', () => {
    const disabled = workspaceLifecycleFrom(readyInput());
    assert.equal(disabled.mode, 'ready');
    assert.equal(disabled.capabilities['attend.read'], 'disabled-by-user');

    const unavailable = workspaceLifecycleFrom(readyInput({
        setupRoute: 'today',
        moduleStatus: {
            library: {health: 'unavailable', capability: 'unavailable'},
        },
    }));
    assert.equal(unavailable.mode, 'limited');
    assert.equal(unavailable.moduleHealth['MOD-LIBRARY'], 'unavailable');
    assert.equal(unavailable.capabilities['library.read'], 'unavailable');
    assert.equal(unavailable.capabilities['plan.write'], 'available');

    const recovering = workspaceLifecycleFrom(readyInput({
        moduleStatus: {
            grade: {health: 'recovery-required', capability: 'recovering'},
        },
    }));
    assert.equal(recovering.mode, 'limited');
    assert.equal(recovering.capabilities['grade.read'], 'recovering');

    const cleanupPending = workspaceLifecycleFrom(readyInput({
        operations: [{
            operationId,
            owner: 'protect',
            kind: 'backup-cleanup',
            state: 'running',
            version: '1',
        }],
    }));
    assert.equal(cleanupPending.mode, 'limited');
    assert.equal(cleanupPending.moduleHealth['MOD-PROTECT'], 'degraded');
    assert.equal(cleanupPending.capabilities['protect.backup'], 'recovering');
    assert.equal(cleanupPending.capabilities['plan.write'], 'available');
});

test('TEST-WORKSPACE-005 exposes recovered operations and follow-ups without paths', () => {
    const lifecycle = workspaceLifecycleFrom(readyInput({
        setupRoute: 'today',
        operations: [{
            operationId,
            owner: 'protect',
            kind: 'backup',
            state: 'running',
            version: '2',
        }],
        pendingFollowUps: [{
            followUpId,
            originatingCommandId: commandId,
            owner: 'protect',
            kind: 'backup-needed-through',
            prerequisiteRevision: '7',
            state: 'pending',
            version: '0',
        }],
    }));

    assert.equal(lifecycle.operations[0]?.operationId, operationId);
    assert.equal(lifecycle.pendingFollowUps[0]?.followUpId, followUpId);
    assert.doesNotMatch(
        JSON.stringify(lifecycle),
        /(?:[A-Za-z]:[\\/]|canonicalPath|directoryPath|workspace\.sqlite|\/Users\/)/,
    );
});

test('maintenance and recovery take precedence and close ordinary capabilities', () => {
    const maintenance = workspaceLifecycleFrom(readyInput({
        startupDisposition: 'maintenance',
        operations: [{
            operationId,
            owner: 'protect',
            kind: 'restore',
            state: 'accepted',
            version: '1',
        }],
    }));
    assert.equal(maintenance.mode, 'maintenance');
    assert.equal(maintenance.route, 'maintenance');
    assert.equal(maintenance.capabilities['workspace.read'], 'recovering');
    assert.equal(maintenance.capabilities['workspace.write'], 'recovering');
    assert.equal(maintenance.capabilities['protect.backup'], 'unavailable');

    const recovery = workspaceLifecycleFrom(readyInput({
        workspaceData: {
            kind: 'recovery',
            problem: {
                code: 'recovery-required',
                scope: 'workspace',
                dataEffect: 'unchanged',
                affectedCapabilities: ['workspace.read', 'workspace.write'],
                allowedActions: [],
                context: {},
                details: {reason: 'database-unreadable'},
            },
        },
        setupRoute: null,
        startupDisposition: 'recovery',
    }));
    assert.equal(recovery.mode, 'recovery');
    assert.equal(recovery.route, 'recovery');
    assert.equal(recovery.workspaceRevision, null);
    assert.equal(recovery.moduleHealth['MOD-DATA'], 'recovery-required');
    assert.equal(recovery.capabilities['protect.restore'], 'recovering');
});
