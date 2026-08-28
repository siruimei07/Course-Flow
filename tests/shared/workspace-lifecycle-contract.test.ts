/**
 * @file Verifies the closed path-free Workspace lifecycle projection.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    isWorkspaceLifecycleProjection,
} from '../../src/shared/workspace-lifecycle-contract';
import {readyLifecycle} from './workspace-lifecycle-fixture';

test('Workspace lifecycle accepts the exact path-free mode, capability, health, and work shape', () => {
    assert.equal(isWorkspaceLifecycleProjection(readyLifecycle), true);
    assert.doesNotMatch(
        JSON.stringify(readyLifecycle),
        /(?:[A-Za-z]:[\\/]|canonicalPath|directoryPath|workspace\.sqlite|DataSlots|\/Users\/)/,
    );
});

test('Workspace lifecycle rejects unknown, noncanonical, duplicate, and contradictory values', () => {
    let accessorRead = false;
    const accessorLifecycle = {...readyLifecycle};
    Object.defineProperty(accessorLifecycle, 'capabilities', {
        enumerable: true,
        get() {
            accessorRead = true;
            return readyLifecycle.capabilities;
        },
    });
    const classLifecycle = Object.assign(new class {}, readyLifecycle);
    const duplicateOperation = {
        ...readyLifecycle,
        operations: [readyLifecycle.operations[0], readyLifecycle.operations[0]],
    };
    const duplicateFollowUp = {
        ...readyLifecycle,
        pendingFollowUps: [readyLifecycle.pendingFollowUps[0], readyLifecycle.pendingFollowUps[0]],
    };
    const operationWithPath = {
        ...readyLifecycle,
        operations: [{
            ...readyLifecycle.operations[0],
            directoryPath: 'C:\\Users\\someone\\workspace.sqlite',
        }],
    };

    for (const value of [
        {...readyLifecycle, route: 'welcome'},
        {...readyLifecycle, mode: 'recovery', route: 'today'},
        {...readyLifecycle, workspaceRevision: '01'},
        {...readyLifecycle, workspaceRevision: 42n},
        {...readyLifecycle, extra: true},
        {
            ...readyLifecycle,
            capabilities: {...readyLifecycle.capabilities, 'workspace.read': 'unknown'},
        },
        {
            ...readyLifecycle,
            capabilities: {...readyLifecycle.capabilities, extra: 'available'},
        },
        {
            ...readyLifecycle,
            moduleHealth: {...readyLifecycle.moduleHealth, 'MOD-LIBRARY': 'recovering'},
        },
        {
            ...readyLifecycle,
            operations: [{...readyLifecycle.operations[0], operationId: 'not-a-uuid'}],
        },
        {
            ...readyLifecycle,
            operations: [{...readyLifecycle.operations[0], state: 'queued'}],
        },
        operationWithPath,
        duplicateOperation,
        duplicateFollowUp,
        accessorLifecycle,
        classLifecycle,
        [],
        null,
    ]) {
        assert.equal(isWorkspaceLifecycleProjection(value), false);
    }
    assert.equal(accessorRead, false);
});

test('welcome, read-only, limited, maintenance, and recovery routes retain their distinct states', () => {
    const absent = {
        ...readyLifecycle,
        mode: 'ready',
        route: 'welcome',
        workspaceRevision: null,
        operations: [],
        pendingFollowUps: [],
    };
    const readOnly = {...readyLifecycle, mode: 'read-only'};
    const limited = {
        ...readyLifecycle,
        mode: 'limited',
        capabilities: {...readyLifecycle.capabilities, 'library.read': 'unavailable'},
        moduleHealth: {...readyLifecycle.moduleHealth, 'MOD-LIBRARY': 'unavailable'},
    };
    const maintenance = {
        ...readyLifecycle,
        mode: 'maintenance',
        route: 'maintenance',
        capabilities: {...readyLifecycle.capabilities, 'workspace.write': 'recovering'},
    };
    const recovery = {
        ...readyLifecycle,
        mode: 'recovery',
        route: 'recovery',
        workspaceRevision: null,
        operations: [{
            ...readyLifecycle.operations[0],
            kind: 'restore',
            state: 'recovery-required',
        }],
    };

    for (const value of [absent, readOnly, limited, maintenance, recovery]) {
        assert.equal(isWorkspaceLifecycleProjection(value), true);
    }
});
