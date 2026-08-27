/**
 * @file Verifies preview binding before the MigrationRollback handoff kernel.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    bindMigrationRollbackConfirmation,
    createMigrationRollbackPreview,
    type MigrationRollbackPreviewFacts,
} from '../../src/protect/migration-rollback-session';
import type {
    ConfirmMigrationRollbackCommand,
    MigrationSafetyCopyProjection,
} from '../../src/shared/workspace-migration-contract';

const SOURCE_APP_BUILD_ID = 'development:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TARGET_APP_BUILD_ID = 'development:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const SAFETY_COPY_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const OPERATION_ID = '44444444-4444-4444-8444-444444444444';
const COMMAND_ID = '55555555-5555-4555-8555-555555555555';

const TARGET = Object.freeze({
    releaseVersion: '0.0.0-development-target',
    tag: 'development-target',
    appBuildId: TARGET_APP_BUILD_ID,
    artifacts: Object.freeze([
        Object.freeze({
            platform: 'darwin-arm64' as const,
            name: 'CourseFlow-target-macOS-arm64.dmg',
            sha256: 'a'.repeat(64),
        }),
        Object.freeze({
            platform: 'win32-x64' as const,
            name: 'CourseFlow-target-Windows-x64.msi',
            sha256: 'b'.repeat(64),
        }),
    ] as const),
});

const SAFETY_COPY = Object.freeze({
    kind: 'verified' as const,
    integrity: 'verified' as const,
    migrationSafetyCopyId: SAFETY_COPY_ID,
    copyVersion: 'c'.repeat(64),
    deleteConfirmationToken: 'f'.repeat(64),
    workspaceId: WORKSPACE_ID,
    sourceRevision: '7',
    sourceSchemaLevel: '15',
    createdAt: '2026-08-27T12:00:00.000Z',
    byteSize: '4096',
    target: TARGET,
}) satisfies MigrationSafetyCopyProjection;

function previewFacts(revision = '9'): MigrationRollbackPreviewFacts {
    return Object.freeze({
        safetyCopy: Object.freeze({
            projection: SAFETY_COPY,
            closedDataSlotDigest: 'd'.repeat(64),
        }),
        currentData: Object.freeze({
            workspaceId: WORKSPACE_ID,
            schemaLevel: '16',
            revision,
            byteLength: '8192',
            digest: 'e'.repeat(64),
            slotFingerprint: 'f'.repeat(64),
        }),
        currentLibrary: Object.freeze({kind: 'absent' as const}),
        sourceBuild: Object.freeze({
            releaseVersion: '0.0.0-development-source',
            tag: 'development-source',
            appBuildId: SOURCE_APP_BUILD_ID,
        }),
    });
}

function confirmation(previewToken: string): ConfirmMigrationRollbackCommand {
    return Object.freeze({
        commandId: COMMAND_ID,
        migrationRollbackSessionId: SESSION_ID,
        expectedSessionVersion: '0',
        previewToken,
    });
}

test('TEST-PROTECT-007: preview binds copy, DATA, Library, builds, and impact without paths', () => {
    const prepared = createMigrationRollbackPreview(previewFacts(), {
        migrationRollbackSessionId: SESSION_ID,
        operationId: OPERATION_ID,
    });

    assert.equal(prepared.view.phase, 'previewed');
    assert.deepEqual(prepared.view.allowedActions, ['confirm']);
    assert.equal(prepared.view.binding?.safetyCopy.migrationSafetyCopyId, SAFETY_COPY_ID);
    assert.equal(prepared.view.binding?.currentData.revision, '9');
    assert.deepEqual(prepared.view.binding?.currentLibrary, {kind: 'absent'});
    assert.equal(prepared.view.binding?.sourceBuild.appBuildId, SOURCE_APP_BUILD_ID);
    assert.equal(prepared.view.binding?.targetBuild.appBuildId, TARGET_APP_BUILD_ID);
    assert.deepEqual(prepared.view.binding?.impact, {
        replacement: 'complete',
        automaticMerge: false,
        currentRevision: '9',
        targetRevision: '7',
        structuredDataChanges: 'discarded-after-target-revision',
        libraryFiles: 'remain-in-place',
        libraryReconciliation: 'full',
    });
    assert.match(prepared.view.previewToken ?? '', /^[0-9a-f]{64}$/);
    assert.doesNotMatch(
        JSON.stringify(prepared.view),
        /(?:[A-Za-z]:[\\/]|directoryPath|dataSlot|slotFingerprint|journal)/i,
    );
});

test('TEST-PROTECT-007: confirm is deterministic for replay and rejects changed bound facts', () => {
    const facts = previewFacts();
    const prepared = createMigrationRollbackPreview(facts, {
        migrationRollbackSessionId: SESSION_ID,
        operationId: OPERATION_ID,
    });
    const command = confirmation(prepared.view.previewToken!);

    const first = bindMigrationRollbackConfirmation(prepared, command, facts);
    const replay = bindMigrationRollbackConfirmation(prepared, command, facts);
    assert.deepEqual(replay, first);
    assert.equal(first.migrationRollbackSessionId, SESSION_ID);
    assert.equal(first.operationId, OPERATION_ID);
    assert.equal(first.currentData.slotFingerprint, 'f'.repeat(64));
    assert.throws(
        () => bindMigrationRollbackConfirmation(prepared, command, previewFacts('10')),
        /impact-changed/,
    );
    assert.throws(
        () => bindMigrationRollbackConfirmation(
            prepared,
            confirmation('0'.repeat(64)),
            facts,
        ),
        /preview-token/,
    );
});
