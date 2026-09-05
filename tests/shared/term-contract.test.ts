/**
 * @file Verifies Term command normalization, digests, and explicit-zone date evaluation.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createTermDigestProjection,
    localDateInTermZone,
    normalizeCreateTermCommand,
    normalizeResetCurrentTermCommand,
    resetCurrentTermDigestProjection,
} from '../../src/shared/workspace-term-contract';
import {
    WORKSPACE_SETUP_VALIDATION_REQUEST_KINDS,
    isWorkspaceSetupRequest,
    makeResetCurrentTermRequest,
} from '../../src/shared/workspace-setup-contract';

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

test('A-TERM-003: the same Instant resolves only through the supplied TermZone', () => {
    const instant = '2026-12-19T04:59:59.999Z';
    assert.equal(localDateInTermZone(instant, 'America/Toronto'), '2026-12-18');
    assert.equal(localDateInTermZone(instant, 'UTC'), '2026-12-19');
    assert.equal(localDateInTermZone(instant, 'Pacific/Kiritimati'), '2026-12-19');
});

test('G7: repeated TermZone evaluation reuses its validated date formatter', () => {
    const instant = '2026-12-19T04:59:59.999Z';
    localDateInTermZone(instant, 'UTC');
    const originalDateTimeFormat = Intl.DateTimeFormat;
    let constructions = 0;
    Intl.DateTimeFormat = new Proxy(originalDateTimeFormat, {
        construct(target, argumentsList, newTarget) {
            constructions += 1;
            return Reflect.construct(target, argumentsList, newTarget);
        },
    });

    try {
        assert.deepEqual(normalizeCreateTermCommand(VALID_COMMAND), VALID_COMMAND);
        for (let index = 0; index < 16; index += 1) {
            assert.equal(localDateInTermZone(instant, 'America/Toronto'), '2026-12-18');
        }
        assert.equal(constructions, 1);
    }
    finally {
        Intl.DateTimeFormat = originalDateTimeFormat;
    }
});

test('A-TERM-003: formatter reuse preserves zone changes, DST boundaries, and invalid-input rejection', () => {
    const cases = [
        ['2026-03-08T04:59:59.999Z', 'America/Toronto', '2026-03-07'],
        ['2026-03-08T05:00:00.000Z', 'America/Toronto', '2026-03-08'],
        ['2026-03-09T03:59:59.999Z', 'America/Toronto', '2026-03-08'],
        ['2026-03-09T04:00:00.000Z', 'America/Toronto', '2026-03-09'],
        ['2026-11-01T03:59:59.999Z', 'America/Toronto', '2026-10-31'],
        ['2026-11-01T04:00:00.000Z', 'America/Toronto', '2026-11-01'],
        ['2026-11-02T04:59:59.999Z', 'America/Toronto', '2026-11-01'],
        ['2026-11-02T05:00:00.000Z', 'America/Toronto', '2026-11-02'],
        ['2026-11-02T04:59:59.999Z', 'UTC', '2026-11-02'],
        ['2026-11-02T04:59:59.999Z', 'America/Toronto', '2026-11-01'],
    ];
    for (const [instant, zone, expectedDate] of cases) {
        assert.equal(localDateInTermZone(instant, zone), expectedDate);
    }

    for (const zone of ['', 'Toronto/Local', undefined]) {
        assert.throws(() => localDateInTermZone(cases[0][0], zone as string), TypeError);
    }
    for (const instant of ['not-an-instant', '2026-02-30T00:00:00.000Z']) {
        assert.throws(() => localDateInTermZone(instant, 'America/Toronto'), TypeError);
    }
    assert.equal(localDateInTermZone(cases[0][0], 'America/Toronto'), '2026-03-07');
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

const VALID_RESET = {
    commandId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    followUpId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    expectedRevision: '4',
    expectedPlanVersion: '3',
    expectedTermVersion: '1',
    intent: {
        kind: 'plan.reset-current-term',
        intentSchemaVersion: 1,
        payload: {
            termId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            confirmedTermName: 'Fall 2026',
        },
    },
} as const;

test('ResetCurrentTerm normalizes a confirmed reset and rejects every unconfirmed shape', () => {
    assert.deepEqual(normalizeResetCurrentTermCommand(VALID_RESET), VALID_RESET);

    for (const invalid of [
        // A blank confirmation is not a confirmation.
        { ...VALID_RESET, intent: { ...VALID_RESET.intent, payload: { ...VALID_RESET.intent.payload, confirmedTermName: '' } } },
        // The Term must be addressed by canonical identity, never by name alone.
        { ...VALID_RESET, intent: { ...VALID_RESET.intent, payload: { ...VALID_RESET.intent.payload, termId: 'Fall 2026' } } },
        // Optimistic concurrency is mandatory for a destructive Term command.
        { ...VALID_RESET, expectedTermVersion: undefined },
        { ...VALID_RESET, intent: { ...VALID_RESET.intent, intentSchemaVersion: 2 } },
        { ...VALID_RESET, intent: { ...VALID_RESET.intent, kind: 'plan.delete-term' } },
        // Unknown payload fields never reach DATA.
        { ...VALID_RESET, intent: { ...VALID_RESET.intent, payload: { ...VALID_RESET.intent.payload, cascade: true } } },
    ]) {
        assert.throws(() => normalizeResetCurrentTermCommand(invalid), TypeError);
    }
});

test('the reset digest binds the Term identity and both expected versions, never the CommandId', () => {
    const projection = resetCurrentTermDigestProjection(normalizeResetCurrentTermCommand(VALID_RESET));

    assert.deepEqual(projection, {
        encoding: 'courseflow-canonical-json-v1',
        intent: VALID_RESET.intent,
        expectedRevision: '4',
        expectedEntityVersions: [
            { entityKind: 'plan-state', entityId: 'singleton', version: '3' },
            { entityKind: 'term', entityId: VALID_RESET.intent.payload.termId, version: '1' },
        ],
        durableFollowUps: [{
            followUpId: VALID_RESET.followUpId,
            owner: 'protect',
            kind: 'backup-needed-through',
        }],
    });
    assert.equal(JSON.stringify(projection).includes(VALID_RESET.commandId), false);
});

test('the reset request envelope is accepted only in its exact declared shape', () => {
    const request = makeResetCurrentTermRequest(
        'ffffffff-ffff-4fff-8fff-ffffffffffff',
        'development:abc123',
        '99999999-9999-4999-8999-999999999999',
        normalizeResetCurrentTermCommand(VALID_RESET),
    );

    assert.equal(request.kind, 'workspace.term.reset-current');
    assert.equal(isWorkspaceSetupRequest(request, 'development:abc123', '99999999-9999-4999-8999-999999999999'), true);
    // A malformed reset is a validation failure, not an unknown request kind.
    assert.equal(
        (WORKSPACE_SETUP_VALIDATION_REQUEST_KINDS as readonly string[])
            .includes('workspace.term.reset-current'),
        true,
    );
    assert.equal(isWorkspaceSetupRequest({ ...request, command: { ...VALID_RESET, intent: { ...VALID_RESET.intent, payload: { termId: VALID_RESET.intent.payload.termId, confirmedTermName: '' } } } }, 'development:abc123', '99999999-9999-4999-8999-999999999999'), false);
    assert.equal(isWorkspaceSetupRequest({ ...request, extra: 1 }, 'development:abc123', '99999999-9999-4999-8999-999999999999'), false);
    assert.throws(
        () => makeResetCurrentTermRequest('ffffffff-ffff-4fff-8fff-ffffffffffff', 'development:abc123', '99999999-9999-4999-8999-999999999999', { ...VALID_RESET, expectedTermVersion: '-1' } as never),
        TypeError,
    );
});
