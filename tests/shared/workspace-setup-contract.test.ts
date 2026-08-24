/**
 * @file Verifies cross-entity invariants on Workspace setup projections.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    isWorkspaceSetupOutcome,
    isWorkspaceSetupRequest,
    makeCreateCourseWithMeetingRequest,
} from '../../src/shared/workspace-setup-contract';

const APP_BUILD_ID = 'development:1234567890abcdef1234567890abcdef12345678';
const REQUEST_ID = 'request';
const WORKSPACE_EPOCH = '11111111-1111-4111-8111-111111111111';
const TERM = {
    termId: '22222222-2222-4222-8222-222222222222',
    name: 'Fall 2026',
    startDate: '2026-09-01',
    endDate: '2026-12-20',
    timeZone: 'America/Toronto',
    archived: false,
    entityVersion: '1',
} as const;
const COURSE = {
    courseId: '33333333-3333-4333-8333-333333333333',
    termId: TERM.termId,
    code: 'CSC301',
    name: 'Introduction to Software Engineering',
    section: null,
    instructor: null,
    color: null,
    credits: null,
    teachingRange: {
        kind: 'inherit-term',
        startDate: TERM.startDate,
        endDate: TERM.endDate,
    },
    archived: false,
    entityVersion: '1',
    meetings: [{
        meetingSeriesId: '44444444-4444-4444-8444-444444444444',
        type: { code: 'LEC', name: 'Lecture' },
        weekday: 'MON',
        localStart: '09:00',
        localEnd: '10:00',
        endDayOffset: 0,
        effectiveRange: {
            kind: 'inherit-course',
            startDate: TERM.startDate,
            endDate: TERM.endDate,
        },
        location: { kind: 'tba' },
        entityVersion: '1',
    }],
} as const;
const HOLIDAY_RANGE = {
    holidayRangeId: '55555555-5555-4555-8555-555555555555',
    termId: TERM.termId,
    name: 'Reading Week',
    startDate: '2026-10-12',
    endDate: '2026-10-16',
    entityVersion: '1',
} as const;
const TASK = {
    taskSeriesId: '66666666-6666-4666-8666-666666666666',
    courseId: COURSE.courseId,
    title: 'Submit design review',
    size: 'small',
    deadline: { kind: 'tba' },
    occurrenceId: {
        taskSeriesId: '66666666-6666-4666-8666-666666666666',
        originalLogicalAnchor: 'once',
    },
    status: 'pending',
    entityVersion: '1',
} as const;

function outcomeWithCourse(course: unknown): unknown {
    return {
        ok: true,
        value: {
            kind: 'workspace.setup-projection',
            protocolVersion: 2,
            appBuildId: APP_BUILD_ID,
            requestId: REQUEST_ID,
            workspaceEpoch: WORKSPACE_EPOCH,
            dataMode: 'ready',
            projection: {
                workspaceRevision: '2',
                planEntityVersion: '2',
                currentTerm: TERM,
                terms: [TERM],
                courses: [course],
                holidayRanges: [HOLIDAY_RANGE],
                tasks: [TASK],
            },
        },
    };
}

function accepts(course: unknown): boolean {
    return isWorkspaceSetupOutcome(
        outcomeWithCourse(course),
        APP_BUILD_ID,
        REQUEST_ID,
        WORKSPACE_EPOCH,
    );
}

test('A-COURSE-007: Workspace projection accepts exact inherited owner boundaries', () => {
    assert.equal(accepts(COURSE), true);
});

test('A-TERM-004: Workspace projection validates active HolidayRange ownership and bounds', () => {
    assert.equal(accepts(COURSE), true);
    const base = outcomeWithCourse(COURSE) as {
        value: { projection: { holidayRanges: unknown[] } };
    };
    for (const holidayRange of [
        { ...HOLIDAY_RANGE, termId: '66666666-6666-4666-8666-666666666666' },
        { ...HOLIDAY_RANGE, startDate: '2026-08-31' },
        { ...HOLIDAY_RANGE, endDate: '2026-12-21' },
        { ...HOLIDAY_RANGE, tombstoned: false },
    ]) {
        assert.equal(isWorkspaceSetupOutcome({
            ...base,
            value: {
                ...base.value,
                projection: { ...base.value.projection, holidayRanges: [holidayRange] },
            },
        }, APP_BUILD_ID, REQUEST_ID, WORKSPACE_EPOCH), false);
    }
});

test('A-COURSE-007: Workspace projection rejects dangling and out-of-owner ranges', () => {
    const invalidCourses = [
        { ...COURSE, termId: '55555555-5555-4555-8555-555555555555' },
        {
            ...COURSE,
            teachingRange: { ...COURSE.teachingRange, startDate: '2026-09-02' },
        },
        {
            ...COURSE,
            teachingRange: {
                kind: 'explicit',
                startDate: '2026-08-31',
                endDate: TERM.endDate,
            },
        },
        {
            ...COURSE,
            meetings: [{
                ...COURSE.meetings[0],
                effectiveRange: {
                    kind: 'inherit-course',
                    startDate: '2026-09-02',
                    endDate: TERM.endDate,
                },
            }],
        },
        {
            ...COURSE,
            meetings: [{
                ...COURSE.meetings[0],
                effectiveRange: {
                    kind: 'explicit',
                    startDate: TERM.startDate,
                    endDate: '2026-12-21',
                },
            }],
        },
    ];

    for (const course of invalidCourses) {
        assert.equal(accepts(course), false);
    }
});

test('A-TASK-001/TEST-PLAN-001: Workspace projection rejects dangling Task ownership', () => {
    const base = outcomeWithCourse(COURSE) as {
        value: { projection: { tasks: unknown[] } };
    };
    for (const task of [
        { ...TASK, courseId: '77777777-7777-4777-8777-777777777777' },
        {
            ...TASK,
            occurrenceId: { ...TASK.occurrenceId, taskSeriesId: COURSE.courseId },
        },
        { ...TASK, deadline: { kind: 'tba', date: '2026-10-12' } },
    ]) {
        assert.equal(isWorkspaceSetupOutcome({
            ...base,
            value: {
                ...base.value,
                projection: { ...base.value.projection, tasks: [task] },
            },
        }, APP_BUILD_ID, REQUEST_ID, WORKSPACE_EPOCH), false);
    }
});

test('TEST-DATA-005: Workspace boundary preserves writer-busy retry semantics', () => {
    assert.equal(isWorkspaceSetupOutcome({
        ok: false,
        problem: {
            code: 'operation-in-progress',
            message: '另一个写入正在完成；请重试。',
            requestId: REQUEST_ID,
            appBuildId: APP_BUILD_ID,
            workspaceEpoch: WORKSPACE_EPOCH,
            dataEffect: 'unchanged',
            details: { reason: 'writer-busy' },
        },
    }, APP_BUILD_ID, REQUEST_ID, WORKSPACE_EPOCH), true);
});

test('TEST-DATA-002/006: Workspace boundary retains schema-1 Course receipt replay DTOs', () => {
    const request = makeCreateCourseWithMeetingRequest(
        REQUEST_ID,
        APP_BUILD_ID,
        WORKSPACE_EPOCH,
        {
            commandId: '66666666-6666-4666-8666-666666666666',
            followUpId: '77777777-7777-4777-8777-777777777777',
            expectedRevision: '2',
            expectedPlanVersion: '1',
            intent: {
                kind: 'plan.create-course-with-first-meeting',
                intentSchemaVersion: 1,
                payload: {
                    course: {
                        code: COURSE.code,
                        name: COURSE.name,
                        section: 'L0101',
                        instructor: 'Ada Lovelace',
                        color: 'blue',
                        credits: '0.5',
                    },
                    meeting: {
                        type: 'LEC',
                        weekday: 'MON',
                        localStart: '09:00',
                        localEnd: '10:00',
                        effectiveStartDate: '2026-09-08',
                        effectiveEndDate: '2026-12-18',
                        location: { kind: 'known', value: 'BA 1130' },
                    },
                },
            },
        },
    );
    assert.equal(isWorkspaceSetupRequest(request, APP_BUILD_ID, WORKSPACE_EPOCH), true);
});
