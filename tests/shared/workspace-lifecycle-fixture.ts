/**
 * @file Provides one valid Workspace lifecycle contract fixture for boundary tests.
 */

import type {WorkspaceLifecycleProjection} from '../../src/shared/workspace-lifecycle-contract';

export const readyLifecycle: WorkspaceLifecycleProjection = {
    mode: 'ready',
    route: 'today',
    workspaceRevision: '42',
    capabilities: {
        'workspace.initialize': 'unavailable',
        'workspace.read': 'available',
        'workspace.write': 'available',
        'plan.read': 'available',
        'plan.write': 'available',
        'attend.read': 'disabled-by-user',
        'attend.write': 'disabled-by-user',
        'library.read': 'disabled-by-user',
        'library.write': 'disabled-by-user',
        'grade.read': 'disabled-by-user',
        'grade.write': 'disabled-by-user',
        'protect.backup': 'available',
        'protect.restore': 'available',
    },
    moduleHealth: {
        'MOD-DATA': 'healthy',
        'MOD-PLAN': 'healthy',
        'MOD-ATTEND': 'healthy',
        'MOD-LIBRARY': 'healthy',
        'MOD-GRADE': 'healthy',
        'MOD-PROTECT': 'healthy',
    },
    operations: [{
        operationId: '33333333-3333-4333-8333-333333333333',
        owner: 'protect',
        kind: 'backup',
        state: 'running',
        version: '2',
    }],
    pendingFollowUps: [{
        followUpId: '44444444-4444-4444-8444-444444444444',
        originatingCommandId: '55555555-5555-4555-8555-555555555555',
        owner: 'protect',
        kind: 'backup-needed-through',
        prerequisiteRevision: '42',
        state: 'pending',
        version: '0',
    }],
};
