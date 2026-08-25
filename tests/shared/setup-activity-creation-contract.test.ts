/**
 * @file Verifies independent Course and Meeting creation commands used by first setup.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createCourseDigestProjection,
    createMeetingSeriesDigestProjection,
    normalizeCreateCourseCommand,
    normalizeCreateMeetingSeriesCommand,
} from '../../src/shared/workspace-course-contract';
import {
    isWorkspaceSetupRequest,
    makeCreateCourseRequest,
    makeCreateMeetingSeriesRequest,
} from '../../src/shared/workspace-setup-contract';

const COURSE = {
    code: 'CSC108',
    name: 'Introduction to Computer Programming',
    section: 'LEC0101',
    instructor: 'Ada Lovelace',
    color: 'blue',
    credits: '3',
    teachingRange: { kind: 'inherit-term' },
} as const;

const MEETING = {
    type: 'LEC',
    weekday: 'MON',
    localStart: '09:00',
    localEnd: '10:00',
    endDayOffset: 0,
    effectiveRange: { kind: 'inherit-course' },
    location: { kind: 'known', value: 'BA 1170' },
} as const;

const CREATE_COURSE = {
    commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    followUpId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    expectedRevision: '1',
    expectedPlanVersion: '1',
    intent: {
        kind: 'plan.create-course',
        intentSchemaVersion: 1,
        payload: { course: COURSE },
    },
} as const;

const CREATE_MEETING = {
    commandId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    followUpId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    overlapDecision: 'review',
    expectedRevision: '2',
    expectedPlanVersion: '2',
    expectedCourseVersion: '1',
    intent: {
        kind: 'plan.create-meeting-series',
        intentSchemaVersion: 1,
        payload: {
            courseId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            meeting: MEETING,
        },
    },
} as const;

test('UF-A-02: Course and Meeting normalize as independent formal setup commands', () => {
    assert.deepEqual(normalizeCreateCourseCommand(CREATE_COURSE), CREATE_COURSE);
    assert.deepEqual(normalizeCreateMeetingSeriesCommand(CREATE_MEETING), CREATE_MEETING);

    const normalizedCourse = normalizeCreateCourseCommand({
        ...CREATE_COURSE,
        intent: {
            ...CREATE_COURSE.intent,
            payload: {
                course: {
                    ...COURSE,
                    code: '  CSC108  ',
                    credits: '3.0',
                },
            },
        },
    });
    assert.equal(normalizedCourse.intent.payload.course.code, 'CSC108');
    assert.equal(normalizedCourse.intent.payload.course.credits, '3');

    const normalizedMeeting = normalizeCreateMeetingSeriesCommand({
        ...CREATE_MEETING,
        intent: {
            ...CREATE_MEETING.intent,
            payload: {
                ...CREATE_MEETING.intent.payload,
                meeting: {
                    ...MEETING,
                    location: { kind: 'known', value: '  BA 1170  ' },
                },
            },
        },
    });
    assert.deepEqual(normalizedMeeting.intent.payload.meeting.location, {
        kind: 'known',
        value: 'BA 1170',
    });
});

test('UF-A-02/TEST-DATA-002: setup activity digests bind facts and versions without CommandId', () => {
    const courseDigest = createCourseDigestProjection(CREATE_COURSE);
    const meetingDigest = createMeetingSeriesDigestProjection(CREATE_MEETING);

    assert.equal(JSON.stringify(courseDigest).includes(CREATE_COURSE.commandId), false);
    assert.equal(JSON.stringify(meetingDigest).includes(CREATE_MEETING.commandId), false);
    assert.deepEqual((meetingDigest as Readonly<{
        expectedEntityVersions: readonly unknown[];
    }>).expectedEntityVersions, [
        { entityKind: 'plan-state', entityId: 'singleton', version: '2' },
        {
            entityKind: 'course',
            entityId: CREATE_MEETING.intent.payload.courseId,
            version: '1',
        },
    ]);
});

test('UF-A-02: independent creation commands reject extra or mismatched fields', () => {
    assert.throws(() => normalizeCreateCourseCommand({ ...CREATE_COURSE, meeting: MEETING }), TypeError);
    assert.throws(() => normalizeCreateMeetingSeriesCommand({
        ...CREATE_MEETING,
        expectedCourseVersion: '0',
    }), TypeError);
    assert.throws(() => normalizeCreateMeetingSeriesCommand({
        ...CREATE_MEETING,
        intent: {
            ...CREATE_MEETING.intent,
            payload: { ...CREATE_MEETING.intent.payload, courseId: 'not-a-course-id' },
        },
    }), TypeError);
});

test('IF-WORKSPACE: independent creation requests cross only the bounded Workspace channel', () => {
    const epoch = '99999999-9999-4999-8999-999999999999';
    const course = makeCreateCourseRequest('course-request', 'build', epoch, CREATE_COURSE);
    const meeting = makeCreateMeetingSeriesRequest('meeting-request', 'build', epoch, CREATE_MEETING);

    assert.equal(isWorkspaceSetupRequest(course, 'build', epoch), true);
    assert.equal(isWorkspaceSetupRequest(meeting, 'build', epoch), true);
    assert.equal(isWorkspaceSetupRequest(
        { ...course, command: { ...CREATE_COURSE, extra: true } },
        'build',
        epoch,
    ), false);
    assert.equal(isWorkspaceSetupRequest({
        ...meeting,
        command: { ...CREATE_MEETING, expectedCourseVersion: '0' },
    }, 'build', epoch), false);
});
