import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createCourseWithMeetingDigestProjection,
    normalizeCreateCourseWithMeetingCommand,
} from '../../src/shared/workspace-course-contract';

const VALID_COMMAND = {
    commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    followUpId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    expectedRevision: '1',
    expectedPlanVersion: '1',
    intent: {
        kind: 'plan.create-course-with-first-meeting',
        intentSchemaVersion: 1,
        payload: {
            course: {
                code: 'CSC108',
                name: 'Introduction to Computer Programming',
                section: 'LEC0101',
                instructor: 'Ada Lovelace',
                color: 'blue',
                credits: '3',
            },
            meeting: {
                type: 'LEC',
                weekday: 'MON',
                localStart: '09:00',
                localEnd: '10:00',
                effectiveStartDate: '2026-09-08',
                effectiveEndDate: '2026-12-18',
                location: { kind: 'known', value: 'BA 1170' },
            },
        },
    },
} as const;

test('A-COURSE-001–004: CreateCourseWithFirstMeeting normalizes every persisted fact', () => {
    assert.deepEqual(normalizeCreateCourseWithMeetingCommand(VALID_COMMAND), VALID_COMMAND);

    const normalized = normalizeCreateCourseWithMeetingCommand({
        ...VALID_COMMAND,
        intent: {
            ...VALID_COMMAND.intent,
            payload: {
                course: {
                    ...VALID_COMMAND.intent.payload.course,
                    code: '  CSC108  ',
                    section: null,
                    instructor: null,
                    color: null,
                    credits: '3.0',
                },
                meeting: {
                    ...VALID_COMMAND.intent.payload.meeting,
                    location: { kind: 'known', value: '  BA 1170  ' },
                },
            },
        },
    });

    assert.deepEqual(normalized.intent.payload.course, {
        code: 'CSC108',
        name: 'Introduction to Computer Programming',
        section: null,
        instructor: null,
        color: null,
        credits: '3',
    });
    assert.deepEqual(normalized.intent.payload.meeting.location, {
        kind: 'known',
        value: 'BA 1170',
    });
});

test('A-COURSE-003/TEST-PLAN-002: only LEC, TUT, and PRA meeting types are accepted', () => {
    for (const type of ['LEC', 'TUT', 'PRA'] as const) {
        const normalized = normalizeCreateCourseWithMeetingCommand({
            ...VALID_COMMAND,
            intent: {
                ...VALID_COMMAND.intent,
                payload: {
                    ...VALID_COMMAND.intent.payload,
                    meeting: { ...VALID_COMMAND.intent.payload.meeting, type },
                },
            },
        });
        assert.equal(normalized.intent.payload.meeting.type, type);
    }

    assert.throws(() => normalizeCreateCourseWithMeetingCommand({
        ...VALID_COMMAND,
        intent: {
            ...VALID_COMMAND.intent,
            payload: {
                ...VALID_COMMAND.intent.payload,
                meeting: { ...VALID_COMMAND.intent.payload.meeting, type: 'SEM' },
            },
        },
    }), TypeError);
});

test('A-COURSE-004/TEST-PLAN-001/007: weekday, local times, and effective dates are validated', () => {
    const invalidMeetings = [
        { ...VALID_COMMAND.intent.payload.meeting, weekday: 'FUNDAY' },
        { ...VALID_COMMAND.intent.payload.meeting, localStart: '9:00' },
        { ...VALID_COMMAND.intent.payload.meeting, localStart: '10:00', localEnd: '10:00' },
        { ...VALID_COMMAND.intent.payload.meeting, localStart: '11:00', localEnd: '10:00' },
        { ...VALID_COMMAND.intent.payload.meeting, effectiveStartDate: '2026-02-30' },
        {
            ...VALID_COMMAND.intent.payload.meeting,
            effectiveStartDate: '2026-12-19',
            effectiveEndDate: '2026-12-18',
        },
    ];

    for (const meeting of invalidMeetings) {
        assert.throws(() => normalizeCreateCourseWithMeetingCommand({
            ...VALID_COMMAND,
            intent: {
                ...VALID_COMMAND.intent,
                payload: { ...VALID_COMMAND.intent.payload, meeting },
            },
        }), TypeError);
    }
});

test('A-COURSE-004/Q-STATE-01: known location and TBA are distinct exact unions', () => {
    const tba = normalizeCreateCourseWithMeetingCommand({
        ...VALID_COMMAND,
        intent: {
            ...VALID_COMMAND.intent,
            payload: {
                ...VALID_COMMAND.intent.payload,
                meeting: {
                    ...VALID_COMMAND.intent.payload.meeting,
                    location: { kind: 'tba' },
                },
            },
        },
    });
    assert.deepEqual(tba.intent.payload.meeting.location, { kind: 'tba' });

    for (const location of [
        { kind: 'known', value: '' },
        { kind: 'known', value: '   ' },
        { kind: 'tba', value: 'BA 1170' },
        { kind: 'unknown' },
    ]) {
        assert.throws(() => normalizeCreateCourseWithMeetingCommand({
            ...VALID_COMMAND,
            intent: {
                ...VALID_COMMAND.intent,
                payload: {
                    ...VALID_COMMAND.intent.payload,
                    meeting: { ...VALID_COMMAND.intent.payload.meeting, location },
                },
            },
        }), TypeError);
    }
});

test('A-COURSE-001: optional Course facts and exact credits reject placeholders or lossy values', () => {
    const invalidCourses = [
        { ...VALID_COMMAND.intent.payload.course, code: '   ' },
        { ...VALID_COMMAND.intent.payload.course, name: '   ' },
        { ...VALID_COMMAND.intent.payload.course, section: '' },
        { ...VALID_COMMAND.intent.payload.course, instructor: '' },
        { ...VALID_COMMAND.intent.payload.course, color: 'pink' },
        { ...VALID_COMMAND.intent.payload.course, credits: '-1' },
        { ...VALID_COMMAND.intent.payload.course, credits: '1.1234567' },
        { ...VALID_COMMAND.intent.payload.course, credits: '1234567890123456789' },
    ];

    for (const course of invalidCourses) {
        assert.throws(() => normalizeCreateCourseWithMeetingCommand({
            ...VALID_COMMAND,
            intent: {
                ...VALID_COMMAND.intent,
                payload: { ...VALID_COMMAND.intent.payload, course },
            },
        }), TypeError);
    }
});

test('A-COURSE-001–004: unknown fields and a Meeting instructor override are rejected', () => {
    for (const command of [
        { ...VALID_COMMAND, extra: true },
        { ...VALID_COMMAND, expectedRevision: '01' },
        {
            ...VALID_COMMAND,
            intent: {
                ...VALID_COMMAND.intent,
                payload: {
                    ...VALID_COMMAND.intent.payload,
                    meeting: {
                        ...VALID_COMMAND.intent.payload.meeting,
                        instructor: 'Meeting override',
                    },
                },
            },
        },
    ]) {
        assert.throws(() => normalizeCreateCourseWithMeetingCommand(command), TypeError);
    }
});

test('TEST-DATA-002: Course/Meeting digest excludes CommandId and includes all commit semantics', () => {
    const normalized = normalizeCreateCourseWithMeetingCommand(VALID_COMMAND);
    const projection = createCourseWithMeetingDigestProjection(normalized);

    assert.equal(JSON.stringify(projection).includes(VALID_COMMAND.commandId), false);
    assert.deepEqual(projection, {
        encoding: 'courseflow-canonical-json-v1',
        intent: VALID_COMMAND.intent,
        expectedRevision: '1',
        expectedEntityVersions: [{
            entityKind: 'plan-state',
            entityId: 'singleton',
            version: '1',
        }],
        durableFollowUps: [{
            followUpId: VALID_COMMAND.followUpId,
            owner: 'protect',
            kind: 'backup-needed-through',
        }],
    });
});
