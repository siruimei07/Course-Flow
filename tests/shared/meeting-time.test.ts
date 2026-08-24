/**
 * @file Verifies explicit TermZone Meeting occurrence windows and overlap boundaries.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    findMeetingTimeOverlap,
    isCanonicalInstant,
    resolveMeetingOccurrenceTime,
} from '../../src/shared/meeting-time';

test('Q-TIME-01: Meeting windows resolve only through the supplied TermZone', () => {
    const toronto = resolveMeetingOccurrenceTime({
        termZone: 'America/Toronto',
        date: '2026-02-02',
        localStart: '09:00',
        localEnd: '10:00',
        endDayOffset: 0,
    });
    const utc = resolveMeetingOccurrenceTime({
        termZone: 'UTC',
        date: '2026-02-02',
        localStart: '09:00',
        localEnd: '10:00',
        endDayOffset: 0,
    });

    assert.equal(toronto.startInstant, '2026-02-02T14:00:00.000Z');
    assert.equal(toronto.endInstant, '2026-02-02T15:00:00.000Z');
    assert.equal(utc.startInstant, '2026-02-02T09:00:00.000Z');
    assert.equal(utc.endInstant, '2026-02-02T10:00:00.000Z');
    assert.deepEqual(resolveMeetingOccurrenceTime({
        termZone: 'UTC',
        date: '0000-01-01',
        localStart: '09:00',
        localEnd: '10:00',
        endDayOffset: 0,
    }), {
        startInstant: '0000-01-01T09:00:00.000Z',
        endInstant: '0000-01-01T10:00:00.000Z',
    });
});

test('Q-TIME-01/TEST-PLAN-007: next-day Meeting ends use the next TermZone LocalDate', () => {
    const window = resolveMeetingOccurrenceTime({
        termZone: 'America/Toronto',
        date: '2026-03-07',
        localStart: '23:30',
        localEnd: '03:30',
        endDayOffset: 1,
    });

    assert.equal(window.startInstant, '2026-03-08T04:30:00.000Z');
    assert.equal(window.endInstant, '2026-03-08T07:30:00.000Z');
});

test('Q-TIME-01/TEST-PLAN-007: DST gap and overlap use deterministic compatible ZoneRules', () => {
    const spring = resolveMeetingOccurrenceTime({
        termZone: 'America/Toronto',
        date: '2026-03-08',
        localStart: '01:30',
        localEnd: '03:30',
        endDayOffset: 0,
    });
    const springGap = resolveMeetingOccurrenceTime({
        termZone: 'America/Toronto',
        date: '2026-03-08',
        localStart: '02:30',
        localEnd: '04:00',
        endDayOffset: 0,
    });
    const fall = resolveMeetingOccurrenceTime({
        termZone: 'America/Toronto',
        date: '2026-11-01',
        localStart: '01:30',
        localEnd: '02:30',
        endDayOffset: 0,
    });

    assert.deepEqual(
        [spring.startInstant, spring.endInstant],
        ['2026-03-08T06:30:00.000Z', '2026-03-08T07:30:00.000Z'],
    );
    assert.deepEqual(
        [springGap.startInstant, springGap.endInstant],
        ['2026-03-08T07:30:00.000Z', '2026-03-08T08:00:00.000Z'],
    );
    assert.deepEqual(
        [fall.startInstant, fall.endInstant],
        ['2026-11-01T05:30:00.000Z', '2026-11-01T07:30:00.000Z'],
    );
});

test('A-COURSE-006: exact boundaries do not overlap but positive intersections do', () => {
    const first = {
        startInstant: '2026-02-02T14:00:00.000Z',
        endInstant: '2026-02-02T15:00:00.000Z',
    };

    assert.equal(findMeetingTimeOverlap(first, {
        startInstant: '2026-02-02T15:00:00.000Z',
        endInstant: '2026-02-02T16:00:00.000Z',
    }), null);
    assert.deepEqual(findMeetingTimeOverlap(first, {
        startInstant: '2026-02-02T14:30:00.000Z',
        endInstant: '2026-02-02T15:30:00.000Z',
    }), {
        startInstant: '2026-02-02T14:30:00.000Z',
        endInstant: '2026-02-02T15:00:00.000Z',
    });
    assert.equal(isCanonicalInstant(first.startInstant), true);
    assert.equal(isCanonicalInstant('2026-99-99T14:00:00.000Z'), false);
});
