import assert from 'node:assert/strict';
import test from 'node:test';

import { digestRecordSetupDecision } from '../../src/data/command-digest';
import {
    normalizeRecordSetupDecisionCommand,
    recordSetupDecisionDigestProjection,
} from '../../src/shared/workspace-data-contract';
import { canonicalJson } from '../../src/shared/canonical-json';

const GOLDEN_CANONICAL_TEXT = '{"durableFollowUps":[{"followUpId":"22222222-2222-4222-8222-222222222222",'
    + '"kind":"backup-needed-through","owner":"protect"}],"encoding":"courseflow-canonical-json-v1",'
    + '"expectedEntityVersions":[{"entityId":"11111111-1111-4111-8111-111111111111",'
    + '"entityKind":"workspace-setup","version":"0"}],"expectedRevision":"0",'
    + '"intent":{"intentSchemaVersion":1,"kind":"workspace.record-setup-decision",'
    + '"payload":{"decision":"later"}}}';
const GOLDEN_SHA256 = '556616ce11b365703b18bc6e3d7802a0e399a42c345df879016e6c02f5ddc90c';

function makeCommand(overrides: Record<string, unknown> = {}) {
    return normalizeRecordSetupDecisionCommand({
        commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        workspaceId: '11111111-1111-4111-8111-111111111111',
        intent: {
            kind: 'workspace.record-setup-decision',
            intentSchemaVersion: 1,
            payload: { decision: 'later' },
        },
        followUpId: '22222222-2222-4222-8222-222222222222',
        expectedRevision: '0',
        expectedSetupVersion: '0',
        ...overrides,
    });
}

test('TEST-DATA-002: canonical command digest matches the v1 golden vector', () => {
    const command = makeCommand();

    assert.equal(canonicalJson(recordSetupDecisionDigestProjection(command)), GOLDEN_CANONICAL_TEXT);
    assert.equal(Buffer.from(digestRecordSetupDecision(command)).toString('hex'), GOLDEN_SHA256);
});

test('record setup digest excludes command identity but changes with semantic payload', () => {
    const original = makeCommand();
    const reordered = makeCommand({
        intent: {
            payload: { decision: 'later' },
            intentSchemaVersion: 1,
            kind: 'workspace.record-setup-decision',
        },
    });

    assert.deepEqual(digestRecordSetupDecision(original), digestRecordSetupDecision(reordered));
    assert.deepEqual(
        digestRecordSetupDecision(original),
        digestRecordSetupDecision(makeCommand({ commandId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })),
    );
    assert.notDeepEqual(
        digestRecordSetupDecision(original),
        digestRecordSetupDecision(makeCommand({
            intent: {
                kind: 'workspace.record-setup-decision',
                intentSchemaVersion: 1,
                payload: { decision: 'skip' },
            },
        })),
    );
    assert.notDeepEqual(
        digestRecordSetupDecision(original),
        digestRecordSetupDecision(makeCommand({ expectedSetupVersion: '1' })),
    );
    assert.notDeepEqual(
        digestRecordSetupDecision(original),
        digestRecordSetupDecision(makeCommand({ followUpId: '33333333-3333-4333-8333-333333333333' })),
    );
});

test('normalizeRecordSetupDecisionCommand accepts only canonical 64-bit unsigned strings', () => {
    for (const field of ['expectedRevision', 'expectedSetupVersion'] as const) {
        for (const version of ['0', '9223372036854775807']) {
            assert.equal(makeCommand({ [field]: version })[field], version);
        }

        for (const version of ['01', '9223372036854775808']) {
            assert.throws(() => makeCommand({ [field]: version }), TypeError);
        }
    }
});

test('normalizeRecordSetupDecisionCommand rejects unknown or malformed DTO fields', () => {
    const valid = {
        commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        workspaceId: '11111111-1111-4111-8111-111111111111',
        intent: {
            kind: 'workspace.record-setup-decision',
            intentSchemaVersion: 1,
            payload: { decision: 'later' },
        },
        followUpId: '22222222-2222-4222-8222-222222222222',
        expectedRevision: '0',
        expectedSetupVersion: '0',
    };

    for (const value of [
        { ...valid, extra: true },
        { ...valid, commandId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' },
        { ...valid, expectedRevision: 0 },
        { ...valid, intent: { ...valid.intent, payload: { decision: 'choice' } } },
        { ...valid, intent: { ...valid.intent, payload: { decision: 'later', extra: true } } },
    ]) {
        assert.throws(() => normalizeRecordSetupDecisionCommand(value), TypeError);
    }
});
