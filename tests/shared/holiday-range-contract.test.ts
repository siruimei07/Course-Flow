/**
 * @file Verifies HolidayRange command normalization and durable digest semantics.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createHolidayRangeDigestProjection,
    deleteHolidayRangeDigestProjection,
    isHolidayRangeProjection,
    normalizeCreateHolidayRangeCommand,
    normalizeDeleteHolidayRangeCommand,
    normalizeUpdateHolidayRangeCommand,
    updateHolidayRangeDigestProjection,
} from '../../src/shared/workspace-holiday-contract';

const TERM_ID = '22222222-2222-4222-8222-222222222222';
const HOLIDAY_RANGE_ID = '33333333-3333-4333-8333-333333333333';
const COMMAND_BASE = {
    commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    followUpId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    expectedRevision: '4',
    expectedPlanVersion: '4',
} as const;

test('A-TERM-004: HolidayRange create normalizes one named inclusive range', () => {
    const command = normalizeCreateHolidayRangeCommand({
        ...COMMAND_BASE,
        intent: {
            kind: 'plan.create-holiday-range',
            intentSchemaVersion: 1,
            payload: {
                termId: TERM_ID,
                name: '  Reading Week  ',
                startDate: '2026-10-12',
                endDate: '2026-10-16',
            },
        },
    });

    assert.deepEqual(command.intent.payload, {
        termId: TERM_ID,
        name: 'Reading Week',
        startDate: '2026-10-12',
        endDate: '2026-10-16',
    });
});

test('A-TERM-004: only active bounded HolidayRange facts cross the query seam', () => {
    const projection = {
        holidayRangeId: HOLIDAY_RANGE_ID,
        termId: TERM_ID,
        name: 'Reading Week',
        startDate: '2026-10-12',
        endDate: '2026-10-16',
        entityVersion: '1',
    } as const;

    assert.equal(isHolidayRangeProjection(projection), true);
    assert.equal(isHolidayRangeProjection({ ...projection, tombstoned: false }), false);
    assert.equal(isHolidayRangeProjection({ ...projection, endDate: '2026-10-11' }), false);
    assert.equal(isHolidayRangeProjection({ ...projection, entityVersion: '01' }), false);
});

test('A-TERM-004: HolidayRange update and delete bind stable identity and version', () => {
    const updated = normalizeUpdateHolidayRangeCommand({
        ...COMMAND_BASE,
        expectedHolidayRangeVersion: '1',
        overlapDecision: 'review',
        intent: {
            kind: 'plan.update-holiday-range',
            intentSchemaVersion: 1,
            payload: {
                holidayRangeId: HOLIDAY_RANGE_ID,
                name: 'Fall Break',
                startDate: '2026-10-13',
                endDate: '2026-10-15',
            },
        },
    });
    const deleted = normalizeDeleteHolidayRangeCommand({
        ...COMMAND_BASE,
        expectedHolidayRangeVersion: '2',
        overlapDecision: 'continue',
        intent: {
            kind: 'plan.delete-holiday-range',
            intentSchemaVersion: 1,
            payload: { holidayRangeId: HOLIDAY_RANGE_ID },
        },
    });

    assert.equal(updated.intent.payload.holidayRangeId, HOLIDAY_RANGE_ID);
    assert.equal(updated.overlapDecision, 'review');
    assert.equal(deleted.intent.payload.holidayRangeId, HOLIDAY_RANGE_ID);
    assert.equal(deleted.expectedHolidayRangeVersion, '2');
});

test('A-TERM-004: HolidayRange commands reject malformed ranges and unknown fields', () => {
    const validCreate = {
        ...COMMAND_BASE,
        intent: {
            kind: 'plan.create-holiday-range',
            intentSchemaVersion: 1,
            payload: {
                termId: TERM_ID,
                name: 'Reading Week',
                startDate: '2026-10-12',
                endDate: '2026-10-16',
            },
        },
    } as const;
    const invalidCreates = [
        { ...validCreate, unexpected: true },
        {
            ...validCreate,
            intent: {
                ...validCreate.intent,
                payload: { ...validCreate.intent.payload, name: '   ' },
            },
        },
        {
            ...validCreate,
            intent: {
                ...validCreate.intent,
                payload: { ...validCreate.intent.payload, startDate: '2026-10-17' },
            },
        },
        {
            ...validCreate,
            intent: {
                ...validCreate.intent,
                payload: { ...validCreate.intent.payload, endDate: '2026-02-30' },
            },
        },
    ];

    for (const command of invalidCreates) {
        assert.throws(() => normalizeCreateHolidayRangeCommand(command), TypeError);
    }
    assert.throws(() => normalizeUpdateHolidayRangeCommand({
        ...COMMAND_BASE,
        expectedHolidayRangeVersion: '1',
        overlapDecision: 'ignore',
        intent: {
            kind: 'plan.update-holiday-range',
            intentSchemaVersion: 1,
            payload: {
                holidayRangeId: HOLIDAY_RANGE_ID,
                name: 'Reading Week',
                startDate: '2026-10-12',
                endDate: '2026-10-16',
            },
        },
    }), TypeError);
    assert.throws(() => normalizeDeleteHolidayRangeCommand({
        ...COMMAND_BASE,
        expectedHolidayRangeVersion: '01',
        overlapDecision: 'review',
        intent: {
            kind: 'plan.delete-holiday-range',
            intentSchemaVersion: 1,
            payload: { holidayRangeId: HOLIDAY_RANGE_ID },
        },
    }), TypeError);
});

test('ADR-04/TEST-DATA-002: HolidayRange digests bind facts, versions, and overlap choice', () => {
    const created = normalizeCreateHolidayRangeCommand({
        ...COMMAND_BASE,
        intent: {
            kind: 'plan.create-holiday-range',
            intentSchemaVersion: 1,
            payload: {
                termId: TERM_ID,
                name: 'Reading Week',
                startDate: '2026-10-12',
                endDate: '2026-10-16',
            },
        },
    });
    const updated = normalizeUpdateHolidayRangeCommand({
        ...COMMAND_BASE,
        expectedHolidayRangeVersion: '1',
        overlapDecision: 'review',
        intent: {
            kind: 'plan.update-holiday-range',
            intentSchemaVersion: 1,
            payload: {
                holidayRangeId: HOLIDAY_RANGE_ID,
                name: 'Fall Break',
                startDate: '2026-10-13',
                endDate: '2026-10-15',
            },
        },
    });
    const deleted = normalizeDeleteHolidayRangeCommand({
        ...COMMAND_BASE,
        expectedHolidayRangeVersion: '2',
        overlapDecision: 'continue',
        intent: {
            kind: 'plan.delete-holiday-range',
            intentSchemaVersion: 1,
            payload: { holidayRangeId: HOLIDAY_RANGE_ID },
        },
    });

    assert.equal(JSON.stringify(createHolidayRangeDigestProjection(created)).includes(created.commandId), false);
    assert.deepEqual(updateHolidayRangeDigestProjection(updated), {
        encoding: 'courseflow-canonical-json-v1',
        intent: updated.intent,
        overlapDecision: 'review',
        expectedRevision: '4',
        expectedEntityVersions: [
            { entityKind: 'plan-state', entityId: 'singleton', version: '4' },
            { entityKind: 'holiday-range', entityId: HOLIDAY_RANGE_ID, version: '1' },
        ],
        durableFollowUps: [{
            followUpId: COMMAND_BASE.followUpId,
            owner: 'protect',
            kind: 'backup-needed-through',
        }],
    });
    const deleteProjection = deleteHolidayRangeDigestProjection(deleted) as Readonly<{
        overlapDecision?: unknown;
    }>;
    assert.equal(deleteProjection.overlapDecision, 'continue');
});
