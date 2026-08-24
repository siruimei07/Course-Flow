/**
 * @file Verifies stable Meeting occurrence identity and mutation contract normalization.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    deriveMeetingOccurrenceId,
    normalizeMeetingOccurrenceWindow,
    normalizeCancelMeetingOccurrenceCommand,
    normalizeChangeMeetingOccurrenceCommand,
} from '../../src/shared/workspace-course-contract';

const MEETING_SERIES_ID = '44444444-4444-4444-8444-444444444444';

test('IF-PLAN-QUERY: Meeting occurrence windows are exact and bounded', () => {
    assert.deepEqual(normalizeMeetingOccurrenceWindow({
        startDate: '9999-12-27',
        endDate: '9999-12-31',
    }), {
        startDate: '9999-12-27',
        endDate: '9999-12-31',
    });
    assert.throws(() => normalizeMeetingOccurrenceWindow({
        startDate: '2026-01-01',
        endDate: '2027-01-03',
    }), TypeError);
    assert.throws(() => normalizeMeetingOccurrenceWindow({
        startDate: '2026-01-01',
        endDate: '2026-01-02',
        unexpected: true,
    }), TypeError);
});

test('TEST-PLAN-005: occurrence identity is the stable typed series-and-anchor tuple', () => {
    const first = deriveMeetingOccurrenceId(MEETING_SERIES_ID, '2026-09-14');
    const recomputed = deriveMeetingOccurrenceId(MEETING_SERIES_ID, '2026-09-14');

    assert.deepEqual(first, {
        meetingSeriesId: MEETING_SERIES_ID,
        originalLogicalAnchor: '2026-09-14',
    });
    assert.deepEqual(recomputed, first);
    assert.notDeepEqual(
        deriveMeetingOccurrenceId(MEETING_SERIES_ID, '2026-09-21'),
        first,
    );
    assert.equal(Object.isFrozen(first), true);
    assert.throws(
        () => deriveMeetingOccurrenceId(MEETING_SERIES_ID, '2026-02-30'),
        TypeError,
    );
});

test('IF-PLAN-COMMAND: only-this occurrence changes normalize an exact versioned intent', () => {
    const command = normalizeChangeMeetingOccurrenceCommand({
        commandId: '77777777-7777-4777-8777-777777777777',
        followUpId: '88888888-8888-4888-8888-888888888888',
        confirmationToken: null,
        impactWindow: null,
        expectedRevision: '2',
        expectedPlanVersion: '2',
        expectedMeetingSeriesVersion: '1',
        intent: {
            kind: 'plan.change-meeting-occurrence',
            intentSchemaVersion: 1,
            payload: {
                meetingSeriesId: MEETING_SERIES_ID,
                originalLogicalAnchor: '2026-09-14',
                scope: 'only-this',
                replacement: {
                    type: 'TUT',
                    weekday: 'TUE',
                    localStart: '11:00',
                    localEnd: '12:00',
                    location: { kind: 'tba' },
                },
            },
        },
    });

    assert.equal(command.intent.payload.scope, 'only-this');
    assert.deepEqual(command.intent.payload.replacement.location, { kind: 'tba' });
    assert.throws(() => normalizeChangeMeetingOccurrenceCommand({
        ...command,
        unexpected: true,
    }), TypeError);
});

test('IF-PLAN-COMMAND: cancellation is an exact only-this occurrence intent', () => {
    const command = normalizeCancelMeetingOccurrenceCommand({
        commandId: '99999999-9999-4999-8999-999999999999',
        followUpId: 'abababab-abab-4bab-8bab-abababababab',
        expectedRevision: '2',
        expectedPlanVersion: '2',
        expectedMeetingSeriesVersion: '1',
        intent: {
            kind: 'plan.cancel-meeting-occurrence',
            intentSchemaVersion: 1,
            payload: {
                meetingSeriesId: MEETING_SERIES_ID,
                originalLogicalAnchor: '2026-10-05',
            },
        },
    });

    assert.equal(command.intent.kind, 'plan.cancel-meeting-occurrence');
    assert.throws(() => normalizeCancelMeetingOccurrenceCommand({
        ...command,
        intent: {
            ...command.intent,
            payload: { ...command.intent.payload, scope: 'this-and-future' },
        },
    }), TypeError);
});
