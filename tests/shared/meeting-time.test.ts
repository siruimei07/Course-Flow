/**
 * @file Verifies explicit TermZone Meeting occurrence windows and overlap boundaries.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    INTL_ZONE_RULES,
    findMeetingTimeOverlap,
    isCanonicalInstant,
    resolveMeetingOccurrenceTime,
} from '../../src/shared/meeting-time';

test('G7: repeated explicit-zone resolution reuses its validated local formatter', () => {
    INTL_ZONE_RULES.resolveInstant('UTC', '2026-02-02', '09:00');
    const originalDateTimeFormat = Intl.DateTimeFormat;
    let constructions = 0;
    Intl.DateTimeFormat = new Proxy(originalDateTimeFormat, {
        construct(target, argumentsList, newTarget) {
            constructions += 1;
            return Reflect.construct(target, argumentsList, newTarget);
        },
    });

    try {
        for (let index = 0; index < 16; index += 1) {
            assert.equal(
                INTL_ZONE_RULES.resolveInstant('America/Toronto', '2026-02-02', '09:00'),
                '2026-02-02T14:00:00.000Z',
            );
        }
        assert.equal(constructions, 1);
    }
    finally {
        Intl.DateTimeFormat = originalDateTimeFormat;
    }
});

test('G7: repeated local times reuse bounded results and recompute after the limit', () => {
    INTL_ZONE_RULES.resolveInstant('UTC', '2026-02-02', '09:00');
    const originalDateTimeFormat = Intl.DateTimeFormat;
    const restorations: (() => void)[] = [];
    let formattingCalls = 0;
    Intl.DateTimeFormat = new Proxy(originalDateTimeFormat, {
        construct(target, argumentsList, newTarget) {
            const formatter = Reflect.construct(target, argumentsList, newTarget) as Intl.DateTimeFormat;
            const formatToParts = formatter.formatToParts;
            formatter.formatToParts = instant => {
                formattingCalls += 1;
                return formatToParts.call(formatter, instant);
            };
            restorations.push(() => {
                formatter.formatToParts = formatToParts;
            });
            return formatter;
        },
    });

    try {
        const cases = [
            ['2026-03-08', '02:30', '2026-03-08T07:30:00.000Z'],
            ['2026-11-01', '01:30', '2026-11-01T05:30:00.000Z'],
        ];
        for (const [date, time, instant] of cases) {
            assert.equal(INTL_ZONE_RULES.resolveInstant('America/Toronto', date, time), instant);
        }
        const initialWork = formattingCalls;
        assert.ok(initialWork > 0);
        for (let index = 0; index < 16; index += 1) {
            for (const [date, time, instant] of cases) {
                assert.equal(INTL_ZONE_RULES.resolveInstant('America/Toronto', date, time), instant);
            }
        }
        assert.equal(formattingCalls, initialWork);

        let lastDate = '2026-01-01';
        for (let index = 0; index <= 512; index += 1) {
            lastDate = new Date(Date.UTC(2026, 0, 1) + index * 86_400_000).toISOString().slice(0, 10);
            assert.equal(INTL_ZONE_RULES.resolveInstant('UTC', lastDate, '09:00'), `${lastDate}T09:00:00.000Z`);
        }
        const workAfterLimit = formattingCalls;
        assert.equal(INTL_ZONE_RULES.resolveInstant('UTC', lastDate, '09:00'), `${lastDate}T09:00:00.000Z`);
        assert.equal(formattingCalls, workAfterLimit);
        assert.equal(INTL_ZONE_RULES.resolveInstant('UTC', '2026-01-01', '09:00'), '2026-01-01T09:00:00.000Z');
        assert.ok(formattingCalls > workAfterLimit);
    }
    finally {
        Intl.DateTimeFormat = originalDateTimeFormat;
        for (const restore of restorations) {
            restore();
        }
    }
});

test('Q-TIME-01: formatter reuse preserves explicit zone changes and rejects invalid inputs', () => {
    for (const [zone, expectedInstant] of [
        ['America/Toronto', '2026-02-02T14:00:00.000Z'],
        ['UTC', '2026-02-02T09:00:00.000Z'],
        ['US/Eastern', '2026-02-02T14:00:00.000Z'],
        ['America/New_York', '2026-02-02T14:00:00.000Z'],
        ['America/Toronto', '2026-02-02T14:00:00.000Z'],
    ]) {
        assert.equal(INTL_ZONE_RULES.resolveInstant(zone, '2026-02-02', '09:00'), expectedInstant);
    }
    for (const zone of ['', 'Toronto/Local', undefined]) {
        assert.throws(() => INTL_ZONE_RULES.resolveInstant(zone as string, '2026-02-02', '09:00'), TypeError);
    }
    for (const [date, time] of [['2026-02-30', '09:00'], ['2026-02-02', '24:00']]) {
        assert.throws(() => INTL_ZONE_RULES.resolveInstant('America/Toronto', date, time), TypeError);
    }
    assert.throws(
        () => INTL_ZONE_RULES.resolveInstant('America/Toronto', '2026-02-02', ['09:00'] as unknown as string),
        TypeError,
    );
    assert.equal(
        INTL_ZONE_RULES.resolveInstant('America/Toronto', '2026-02-02', '09:00'),
        '2026-02-02T14:00:00.000Z',
    );
});

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
