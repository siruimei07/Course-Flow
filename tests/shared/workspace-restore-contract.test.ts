/**
 * @file Verifies the path-free WP-R6-01 candidate and RestoreSession contract.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import * as protectionContract from '../../src/shared/workspace-protection-contract';

const CANDIDATE_REF = '11111111-1111-4111-8111-111111111111';
const SNAPSHOT_ID = '22222222-2222-4222-8222-222222222222';
const COMMAND_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const OPERATION_ID = '55555555-5555-4555-8555-555555555555';
const WORKSPACE_ID = '66666666-6666-4666-8666-666666666666';

type RestoreContract = Readonly<{
    normalizeStartRestoreSessionCommand(value: unknown): unknown;
    normalizeConfirmRestoreSessionCommand(value: unknown): unknown;
    isRestoreCandidateProjection(value: unknown): boolean;
    isRestoreSessionView(value: unknown): boolean;
}>;

function contract(): RestoreContract {
    return protectionContract as unknown as RestoreContract;
}

test('TEST-PROTECT-004: all five candidate states are exact and path-free', () => {
    const common = {
        candidateRef: CANDIDATE_REF,
        candidateKind: 'snapshot',
        snapshotId: SNAPSHOT_ID,
        actualRevision: null,
        createdAt: null,
        compatibility: 'unknown',
    } as const;
    const candidates = [
        {
            ...common,
            status: 'verified',
            actualRevision: '7',
            createdAt: '2026-08-26T12:00:00.000Z',
            compatibility: 'current',
        },
        {...common, status: 'incomplete-or-sync-pending'},
        {...common, status: 'corrupt'},
        {...common, status: 'incompatible', compatibility: 'unsupported'},
        {
            ...common,
            candidateKind: 'unknown-entry',
            snapshotId: null,
            status: 'unknown-entry',
        },
    ] as const;

    for (const candidate of candidates) {
        assert.equal(contract().isRestoreCandidateProjection(candidate), true);
        assert.doesNotMatch(JSON.stringify(candidate), /(?:[A-Za-z]:[\\/]|canonicalPath|directoryPath)/);
    }
    assert.equal(contract().isRestoreCandidateProjection({
        ...candidates[0],
        directoryPath: 'C:\\Backups\\snapshot',
    }), false);
    assert.equal(contract().isRestoreCandidateProjection({
        ...candidates[0],
        status: 'verified',
        actualRevision: null,
    }), false);
});

test('TEST-WORKSPACE-002: start and confirm commands are exact canonical envelopes', () => {
    const start = {
        commandId: COMMAND_ID,
        candidateRef: CANDIDATE_REF,
    } as const;
    const confirm = {
        commandId: COMMAND_ID,
        restoreSessionId: SESSION_ID,
        expectedSessionVersion: '0',
        previewToken: 'a'.repeat(64),
    } as const;

    assert.deepEqual(contract().normalizeStartRestoreSessionCommand(start), start);
    assert.deepEqual(contract().normalizeConfirmRestoreSessionCommand(confirm), confirm);
    assert.throws(() => contract().normalizeStartRestoreSessionCommand({
        ...start,
        candidatePath: 'C:\\Backups\\snapshot',
    }), TypeError);
    assert.throws(() => contract().normalizeConfirmRestoreSessionCommand({
        ...confirm,
        expectedSessionVersion: '01',
    }), TypeError);
});

test('A-DATA-005/006: preview declares complete replacement and required recoverability', () => {
    const view = {
        restoreSessionId: SESSION_ID,
        operationId: OPERATION_ID,
        sessionVersion: '0',
        phase: 'previewed',
        candidate: {
            candidateRef: CANDIDATE_REF,
            snapshotId: SNAPSHOT_ID,
            sourceSchemaLevel: '14',
            preparedSchemaLevel: '15',
            actualRevision: '7',
            validationCopy: 'migrated',
        },
        current: {
            workspaceId: WORKSPACE_ID,
            revision: '9',
            libraryRoot: {kind: 'absent'},
        },
        target: {libraryRoot: {kind: 'absent'}},
        impact: {
            replacement: 'complete',
            automaticMerge: false,
            termCount: '2',
            courseCount: '4',
            taskSeriesCount: '8',
            currentRevision: '9',
            candidateRevision: '7',
        },
        recoverability: {
            mode: 'required',
            safetySet: {state: 'pending'},
        },
        previewToken: 'b'.repeat(64),
        allowedActions: ['confirm', 'cancel-before-checkpoint'],
        problem: null,
    } as const;

    assert.equal(contract().isRestoreSessionView(view), true);
    assert.equal(view.impact.replacement, 'complete');
    assert.equal(view.impact.automaticMerge, false);
    assert.equal(view.recoverability.mode, 'required');
    assert.doesNotMatch(JSON.stringify(view), /(?:[A-Za-z]:[\\/]|canonicalPath|directoryPath|sqlite)/i);
    assert.equal(contract().isRestoreSessionView({
        ...view,
        impact: {...view.impact, automaticMerge: true},
    }), false);
    assert.equal(contract().isRestoreSessionView({
        ...view,
        phase: 'protection-established',
        recoverability: {
            mode: 'required',
            safetySet: {
                state: 'verified',
                safetySetId: SESSION_ID,
                protectedRevision: '8',
            },
        },
        previewToken: null,
        allowedActions: ['cancel-before-checkpoint'],
    }), false);
});
