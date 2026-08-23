import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createTermDigestProjection,
    normalizeCreateTermCommand,
} from '../../src/shared/workspace-term-contract';

const VALID_COMMAND = {
    commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    followUpId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    expectedRevision: '0',
    expectedPlanVersion: '0',
    intent: {
        kind: 'plan.create-term',
        intentSchemaVersion: 1,
        payload: {
            name: 'Fall 2026',
            startDate: '2026-09-08',
            endDate: '2026-12-18',
            timeZone: 'America/Toronto',
        },
    },
} as const;

test('A-TERM-001: CreateTerm normalizes a valid bounded DTO before the PLAN boundary', () => {
    assert.deepEqual(normalizeCreateTermCommand(VALID_COMMAND), VALID_COMMAND);
});

test('A-TERM-001/TEST-PLAN-001/007: CreateTerm rejects invalid names, dates, ranges, and zones', () => {
    const invalidPayloads = [
        { ...VALID_COMMAND.intent.payload, name: '   ' },
        { ...VALID_COMMAND.intent.payload, name: 'x'.repeat(121) },
        { ...VALID_COMMAND.intent.payload, startDate: '2026-02-30' },
        { ...VALID_COMMAND.intent.payload, endDate: '2026-09-07' },
        { ...VALID_COMMAND.intent.payload, timeZone: 'Toronto/Local' },
    ];

    for (const payload of invalidPayloads) {
        assert.throws(
            () => normalizeCreateTermCommand({
                ...VALID_COMMAND,
                intent: { ...VALID_COMMAND.intent, payload },
            }),
            TypeError,
        );
    }
});

test('CreateTerm rejects unknown fields and non-canonical protocol values', () => {
    for (const command of [
        { ...VALID_COMMAND, extra: true },
        { ...VALID_COMMAND, expectedRevision: '01' },
        { ...VALID_COMMAND, expectedPlanVersion: 0 },
        {
            ...VALID_COMMAND,
            intent: {
                ...VALID_COMMAND.intent,
                payload: { ...VALID_COMMAND.intent.payload, extra: true },
            },
        },
    ]) {
        assert.throws(() => normalizeCreateTermCommand(command), TypeError);
    }
});

test('TEST-DATA-002: CreateTerm digest projection excludes CommandId and includes all commit semantics', () => {
    const normalized = normalizeCreateTermCommand(VALID_COMMAND);
    const projection = createTermDigestProjection(normalized);

    assert.deepEqual(projection, {
        encoding: 'courseflow-canonical-json-v1',
        intent: VALID_COMMAND.intent,
        expectedRevision: '0',
        expectedEntityVersions: [{
            entityKind: 'plan-state',
            entityId: 'singleton',
            version: '0',
        }],
        durableFollowUps: [{
            followUpId: VALID_COMMAND.followUpId,
            owner: 'protect',
            kind: 'backup-needed-through',
        }],
    });
    assert.equal(JSON.stringify(projection).includes(VALID_COMMAND.commandId), false);
    assert.notDeepEqual(
        projection,
        createTermDigestProjection(normalizeCreateTermCommand({
            ...VALID_COMMAND,
            intent: {
                ...VALID_COMMAND.intent,
                payload: { ...VALID_COMMAND.intent.payload, name: 'Winter 2027' },
            },
        })),
    );
});
