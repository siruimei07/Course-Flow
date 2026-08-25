/**
 * @file Verifies the Shell-owned first-setup draft payload boundary.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    decodeSetupDraft,
    encodeSetupDraft,
    type SetupDraft,
} from '../../src/renderer/setup-draft';

const draft: SetupDraft = {
    step: 'course',
    activityKind: 'meeting',
    term: {
        name: 'Fall 2026',
        startDate: '2026-09-08',
        endDate: '2026-12-18',
        timeZone: 'America/Toronto',
    },
    course: {
        code: 'CSC108',
        name: '',
        section: '',
        instructor: '',
        color: '',
        credits: '',
        teachingStartDate: '2026-09-08',
        teachingEndDate: '2026-12-18',
    },
    meeting: {
        courseId: '22222222-2222-4222-8222-222222222222',
        meetingType: 'LEC',
        weekday: 'MON',
        localStart: '',
        localEnd: '',
        endDayOffset: 0,
        effectiveStartDate: '2026-09-08',
        effectiveEndDate: '2026-12-18',
        locationKind: 'known',
        locationValue: '',
    },
    task: {
        courseId: '22222222-2222-4222-8222-222222222222',
        title: '',
        size: 'small',
        scheduleKind: 'once',
        deadlineKind: 'tba',
        deadlineDate: '',
        deadlineTime: '',
        weeklyStartDate: '2026-09-08',
        weeklyWeekday: 'MON',
        weeklyDeadlineTime: '',
        weeklyEndDate: '2026-12-18',
        followTeachingWeek: false,
    },
    holiday: {
        name: 'Reading',
        startDate: '',
        endDate: '',
    },
};

test('an incomplete setup draft round-trips without becoming a domain fact', () => {
    assert.deepEqual(decodeSetupDraft(encodeSetupDraft(draft)), draft);
});

test('a pre-Holiday version-one draft remains restorable with an empty optional branch', () => {
    const legacyDraft = { ...draft } as Record<string, unknown>;
    delete legacyDraft.holiday;

    assert.deepEqual(decodeSetupDraft(JSON.stringify(legacyDraft)), {
        ...draft,
        holiday: {
            name: '',
            startDate: '',
            endDate: '',
        },
    });
});

test('a malformed or incompatible payload is rejected instead of guessed', () => {
    assert.equal(decodeSetupDraft('{"step":"course"}'), null);
    assert.equal(decodeSetupDraft('{not-json'), null);
    assert.equal(decodeSetupDraft(JSON.stringify({
        ...draft,
        step: 'protect',
    })), null);
    assert.equal(decodeSetupDraft(JSON.stringify({
        ...draft,
        activityKind: 'attendance',
    })), null);
});
