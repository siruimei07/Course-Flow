/**
 * @file Verifies the closed, path-free Workspace migration and build contract.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    isApplicationBuildStatus,
    isMigrationRollbackSessionView,
    isMigrationSafetyCopyProjection,
    isWorkspaceMigrationRequest,
    makeApplicationBuildStatusRequest,
    makeCancelMigrationRollbackRequest,
    makeConfirmMigrationRollbackRequest,
    makeContinueMigrationRollbackRequest,
    makeDeleteMigrationSafetyCopyRequest,
    makeMigrationRollbackPreviewRequest,
    makeMigrationRollbackStatusRequest,
    makeMigrationSafetyCopyQueryRequest,
    type ApplicationBuildStatus,
    type MigrationRollbackSessionView,
    type MigrationSafetyCopyProjection,
} from '../../src/shared/workspace-migration-contract';

const APP_BUILD_ID = 'development:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TARGET_APP_BUILD_ID = 'development:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const WORKSPACE_EPOCH = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const SAFETY_COPY_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const OPERATION_ID = '55555555-5555-4555-8555-555555555555';
const COMMAND_ID = '66666666-6666-4666-8666-666666666666';
const TOKEN = 'c'.repeat(64);

const TARGET = Object.freeze({
    releaseVersion: '0.0.0-development-target',
    tag: 'development-target',
    appBuildId: TARGET_APP_BUILD_ID,
    artifacts: Object.freeze([
        Object.freeze({
            platform: 'darwin-arm64' as const,
            name: 'CourseFlow-target-macOS-arm64.dmg',
            sha256: 'd'.repeat(64),
        }),
        Object.freeze({
            platform: 'win32-x64' as const,
            name: 'CourseFlow-target-Windows-x64.msi',
            sha256: 'e'.repeat(64),
        }),
    ] as const),
});

const SAFETY_COPY = Object.freeze({
    kind: 'verified' as const,
    integrity: 'verified' as const,
    migrationSafetyCopyId: SAFETY_COPY_ID,
    copyVersion: TOKEN,
    deleteConfirmationToken: 'f'.repeat(64),
    workspaceId: WORKSPACE_ID,
    sourceRevision: '7',
    sourceSchemaLevel: '15',
    createdAt: '2026-08-27T12:00:00.000Z',
    byteSize: '4096',
    target: TARGET,
}) satisfies MigrationSafetyCopyProjection;

const BUILD_STATUS = Object.freeze({
    descriptor: Object.freeze({
        descriptorVersion: '1' as const,
        applicationId: 'io.github.siruimei07.courseflow.dev' as const,
        releaseVersion: '0.0.0-development-source',
        tag: 'development-source',
        appBuildId: APP_BUILD_ID,
        fullCommit: 'a'.repeat(40),
        platform: 'win32' as const,
        architecture: 'x64' as const,
        variant: 'development' as const,
        workspaceProtocolVersion: '2' as const,
        currentSchemaLevel: '16',
        formats: Object.freeze({
            snapshot: '1' as const,
            backupRepository: '1' as const,
            restoreActivation: '1' as const,
            migrationSafetyCopy: '1' as const,
            migrationRollbackHandoff: '1' as const,
        }),
        runtimes: Object.freeze({
            electron: '43.4.1',
            chromium: '142.0.0.0',
            node: '24.19.0',
            sqlite: '3.50.4',
        }),
        packaging: Object.freeze({
            electronForge: '7.11.2',
            vite: '8.2.2',
            typescript: '7.0.2',
        }),
        rollbackTargets: Object.freeze([TARGET]),
    }),
    processMatch: Object.freeze({
        main: 'exact' as const,
        renderer: 'exact' as const,
        workspace: 'exact' as const,
        allExact: true as const,
    }),
    rollback: Object.freeze({kind: 'clear' as const}),
}) satisfies ApplicationBuildStatus;

const PREVIEW = Object.freeze({
    migrationRollbackSessionId: SESSION_ID,
    operationId: OPERATION_ID,
    sessionVersion: '0',
    phase: 'previewed' as const,
    currentBuild: 'source' as const,
    binding: Object.freeze({
        safetyCopy: SAFETY_COPY,
        currentData: Object.freeze({
            workspaceId: WORKSPACE_ID,
            schemaLevel: '16',
            revision: '9',
        }),
        currentLibrary: Object.freeze({kind: 'absent' as const}),
        sourceBuild: Object.freeze({
            releaseVersion: '0.0.0-development-source',
            tag: 'development-source',
            appBuildId: APP_BUILD_ID,
        }),
        targetBuild: TARGET,
        impact: Object.freeze({
            replacement: 'complete' as const,
            automaticMerge: false as const,
            currentRevision: '9',
            targetRevision: '7',
            structuredDataChanges: 'discarded-after-target-revision' as const,
            libraryFiles: 'remain-in-place' as const,
            libraryReconciliation: 'full' as const,
        }),
    }),
    previewToken: TOKEN,
    retryCommand: null,
    allowedActions: Object.freeze(['confirm'] as const),
    outcome: null,
    problem: null,
}) satisfies MigrationRollbackSessionView;

test('ApplicationBuildStatus is exact, local, and rejects mixed process claims', () => {
    assert.equal(isApplicationBuildStatus(BUILD_STATUS), true);
    assert.equal(isApplicationBuildStatus({
        ...BUILD_STATUS,
        processMatch: {...BUILD_STATUS.processMatch, workspace: 'mixed'},
    }), false);
    assert.equal(isApplicationBuildStatus({
        ...BUILD_STATUS,
        descriptor: {...BUILD_STATUS.descriptor, absolutePath: 'C:\\CourseFlow'},
    }), false);
    assert.equal(isApplicationBuildStatus({
        ...BUILD_STATUS,
        descriptor: {
            ...BUILD_STATUS.descriptor,
            appBuildId: TARGET_APP_BUILD_ID,
        },
    }), false);
});

test('MigrationSafetyCopy and rollback preview validators reject extra fields and paths', () => {
    assert.equal(isMigrationSafetyCopyProjection({kind: 'absent'}), true);
    assert.equal(isMigrationSafetyCopyProjection({kind: 'unavailable'}), true);
    assert.equal(isMigrationSafetyCopyProjection(SAFETY_COPY), true);
    assert.equal(isMigrationSafetyCopyProjection({...SAFETY_COPY, directoryPath: 'C:\\Data'}), false);
    assert.equal(isMigrationRollbackSessionView(PREVIEW), true);
    assert.equal(isMigrationRollbackSessionView({
        ...PREVIEW,
        binding: {...PREVIEW.binding, dataSlot: 'active'},
    }), false);
    assert.equal(isMigrationRollbackSessionView({
        ...PREVIEW,
        allowedActions: ['continue-as-target'],
    }), false);
    const retry = {
        ...PREVIEW,
        sessionVersion: '5',
        phase: 'completing',
        currentBuild: 'target',
        previewToken: null,
        retryCommand: {
            action: 'continue-as-target',
            commandId: COMMAND_ID,
            expectedSessionVersion: '4',
        },
        allowedActions: ['continue-as-target'],
    };
    assert.equal(isMigrationRollbackSessionView(retry), true);
    assert.equal(isMigrationRollbackSessionView({...retry, retryCommand: null}), false);
});

test('all rollback requests are exact, version-bound, and path-free', () => {
    const base = ['request', APP_BUILD_ID, WORKSPACE_EPOCH] as const;
    const action = Object.freeze({
        commandId: COMMAND_ID,
        migrationRollbackSessionId: SESSION_ID,
        expectedSessionVersion: '4',
    });
    const deleteRequest = makeDeleteMigrationSafetyCopyRequest(...base, {
        commandId: COMMAND_ID,
        migrationSafetyCopyId: SAFETY_COPY_ID,
        expectedCopyVersion: TOKEN,
        confirmationToken: SAFETY_COPY.deleteConfirmationToken,
    });
    const requests = [
        makeApplicationBuildStatusRequest(...base),
        makeMigrationSafetyCopyQueryRequest(...base),
        deleteRequest,
        makeMigrationRollbackPreviewRequest(...base),
        makeMigrationRollbackStatusRequest(...base, SESSION_ID),
        makeConfirmMigrationRollbackRequest(...base, {
            commandId: COMMAND_ID,
            migrationRollbackSessionId: SESSION_ID,
            expectedSessionVersion: '0',
            previewToken: TOKEN,
        }),
        makeCancelMigrationRollbackRequest(...base, action),
        makeContinueMigrationRollbackRequest(...base, action),
    ];

    assert.equal(requests.every(request => (
        isWorkspaceMigrationRequest(request, APP_BUILD_ID, WORKSPACE_EPOCH)
    )), true);
    assert.equal(requests.some(request => (
        /(?:[A-Za-z]:[\\/]|directoryPath|dataSlot|journal)/i.test(JSON.stringify(request))
    )), false);
    assert.equal(isWorkspaceMigrationRequest({
        ...deleteRequest,
        command: {...deleteRequest.command, expectedCopyVersion: 'short'},
    }, APP_BUILD_ID, WORKSPACE_EPOCH), false);
    assert.equal(isWorkspaceMigrationRequest({
        ...deleteRequest,
        command: {...deleteRequest.command, confirmationToken: 'short'},
    }, APP_BUILD_ID, WORKSPACE_EPOCH), false);
    assert.equal(isWorkspaceMigrationRequest({...requests[0], extra: true}, APP_BUILD_ID, WORKSPACE_EPOCH), false);
});
