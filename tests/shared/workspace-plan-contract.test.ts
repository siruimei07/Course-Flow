/**
 * @file Verifies unified PLAN time classification and deterministic summary selection.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildPlanProjection,
    calculateTermProgress,
    classifyMeetingOccurrence,
    classifyTaskOccurrence,
    createPlanEvaluationContext,
    isPlanProjection,
    selectNextTaskOccurrence,
    type PlanEvaluationContext,
    type PlanProjection,
} from '../../src/shared/workspace-plan-contract';
import {
    MAX_MEETING_OVERLAP_WARNINGS,
    type MeetingOccurrenceProjection,
} from '../../src/shared/workspace-course-contract';
import type { HolidayRangeProjection } from '../../src/shared/workspace-holiday-contract';
import type {
    TaskDeadline,
    TaskOccurrenceProjection,
    TaskOccurrenceStatus,
    TaskSize,
} from '../../src/shared/workspace-task-contract';
import type { TermProjection } from '../../src/shared/workspace-term-contract';

const EVALUATION_CONTEXT: PlanEvaluationContext = {
    evaluatedAt: '2026-09-10T16:00:00.000Z',
    termZone: 'America/Toronto',
    applicableDate: '2026-09-10',
    requestedWindow: {
        startDate: '2026-09-07',
        endDate: '2026-09-13',
    },
};

/**
 * Builds one real Task occurrence fixture with an independently selected deadline and state.
 * @param {string} originalLogicalAnchor - Stable logical occurrence anchor.
 * @param {TaskDeadline} deadline - Deadline under classification.
 * @param {TaskOccurrenceStatus} status - Stored independent occurrence state.
 * @param {TaskSize} size - User-selected Task scale.
 * @param {string} taskSeriesId - Stable Task series identity.
 * @return {TaskOccurrenceProjection} Complete Task occurrence DTO.
 */
function taskOccurrence(
    originalLogicalAnchor: string,
    deadline: TaskDeadline,
    status: TaskOccurrenceStatus = 'pending',
    size: TaskSize = 'small',
    taskSeriesId = '11111111-1111-4111-8111-111111111111',
): TaskOccurrenceProjection {
    return {
        occurrenceId: {
            taskSeriesId,
            originalLogicalAnchor,
        },
        title: originalLogicalAnchor,
        size,
        deadline,
        segmentId: '22222222-2222-4222-8222-222222222222',
        status,
        reportedProgress: null,
        displayProgress: status === 'completed' ? 100 : null,
        overrideKind: 'none',
    };
}

/**
 * Builds one real Meeting occurrence fixture for projection ordering and overlap checks.
 * @param {Object} value - Complete stable identity, time, type, and status facts.
 * @return {MeetingOccurrenceProjection} Complete Meeting occurrence DTO.
 */
function meetingOccurrence(value: Readonly<{
    meetingSeriesId: string;
    segmentId: string;
    date: string;
    type: MeetingOccurrenceProjection['type'];
    weekday: MeetingOccurrenceProjection['weekday'];
    localStart: string;
    localEnd: string;
    startInstant: string;
    endInstant: string;
    status?: MeetingOccurrenceProjection['status'];
}>): MeetingOccurrenceProjection {
    const status = value.status ?? 'scheduled';
    return {
        occurrenceId: {
            meetingSeriesId: value.meetingSeriesId,
            originalLogicalAnchor: value.date,
        },
        segmentId: value.segmentId,
        date: value.date,
        status,
        overrideKind: status === 'cancelled' ? 'cancelled' : null,
        type: value.type,
        weekday: value.weekday,
        localStart: value.localStart,
        localEnd: value.localEnd,
        endDayOffset: 0,
        startInstant: value.startInstant,
        endInstant: value.endInstant,
        location: { kind: 'tba' },
    };
}

test('A-VIEW-004/TEST-PLAN-006: PLAN alone classifies every Task deadline and terminal state', () => {
    const cases = [
        [taskOccurrence('overdue-date', { kind: 'date-only', date: '2026-09-09' }), 'overdue'],
        [taskOccurrence('today-date', { kind: 'date-only', date: '2026-09-10' }), 'today'],
        [taskOccurrence('near-one', { kind: 'date-only', date: '2026-09-11' }), 'near-due'],
        [taskOccurrence('near-seven', { kind: 'date-only', date: '2026-09-17' }), 'near-due'],
        [taskOccurrence('future-eight', { kind: 'date-only', date: '2026-09-18' }), 'future'],
        [taskOccurrence('timed-overdue', {
            kind: 'timed',
            instant: '2026-09-10T15:59:59.999Z',
            timeZone: 'UTC',
        }), 'overdue'],
        [taskOccurrence('timed-exact', {
            kind: 'timed',
            instant: '2026-09-10T16:00:00.000Z',
            timeZone: 'UTC',
        }), 'today'],
        [taskOccurrence('timed-term-date', {
            kind: 'timed',
            instant: '2026-09-11T03:00:00.000Z',
            timeZone: 'UTC',
        }), 'today'],
        [taskOccurrence('tba', { kind: 'tba' }), 'TBA'],
        [taskOccurrence('completed', { kind: 'date-only', date: '2026-09-11' }, 'completed'), 'completed'],
        [taskOccurrence('skipped', { kind: 'date-only', date: '2026-09-11' }, 'skipped'), 'skipped'],
    ] as const;

    assert.deepEqual(
        cases.map(([occurrence]) => classifyTaskOccurrence(occurrence, EVALUATION_CONTEXT)),
        cases.map(([, expected]) => expected),
    );
});

test('A-VIEW-003/TEST-PLAN-006: next Task uses real boundaries, stable ties, and true empty states', () => {
    const dateOnly = taskOccurrence('date-only', { kind: 'date-only', date: '2026-09-10' });
    const earlierTimedBoundary = taskOccurrence('timed', {
        kind: 'timed',
        instant: '2026-09-11T03:30:00.000Z',
        timeZone: 'UTC',
    });
    const completed = taskOccurrence(
        'completed',
        { kind: 'date-only', date: '2026-09-09' },
        'completed',
    );
    const tba = taskOccurrence('tba', { kind: 'tba' });
    const largeLaterIdentity = taskOccurrence(
        'same-boundary',
        { kind: 'timed', instant: '2026-09-12T14:00:00.000Z', timeZone: 'UTC' },
        'pending',
        'large',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    );
    const largeEarlierIdentity = taskOccurrence(
        'same-boundary',
        { kind: 'timed', instant: '2026-09-12T14:00:00.000Z', timeZone: 'UTC' },
        'pending',
        'large',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );

    const small = selectNextTaskOccurrence(
        [dateOnly, earlierTimedBoundary, completed, tba, largeLaterIdentity, largeEarlierIdentity],
        'small',
        EVALUATION_CONTEXT,
    );
    const large = selectNextTaskOccurrence(
        [largeLaterIdentity, largeEarlierIdentity],
        'large',
        EVALUATION_CONTEXT,
    );
    const empty = selectNextTaskOccurrence([completed, tba], 'small', EVALUATION_CONTEXT);

    assert.equal(small.kind, 'task');
    assert.deepEqual(small.kind === 'task' && small.occurrence.occurrenceId, earlierTimedBoundary.occurrenceId);
    assert.equal(small.kind === 'task' && small.deadlineBoundary, '2026-09-11T03:30:00.000Z');
    assert.equal(small.kind === 'task' && small.remainingMilliseconds, 41_400_000);
    assert.equal(large.kind, 'task');
    assert.deepEqual(large.kind === 'task' && large.occurrence.occurrenceId, largeEarlierIdentity.occurrenceId);
    assert.deepEqual(empty, {
        kind: 'empty',
        reason: 'no-pending-known-deadline',
    });
});

test('TEST-PLAN-007: TermZone date and date-only day-end follow DST boundaries', () => {
    const evaluatedAt = '2026-03-09T03:30:00.000Z';
    assert.deepEqual(createPlanEvaluationContext(evaluatedAt, 'America/Toronto'), {
        evaluatedAt,
        termZone: 'America/Toronto',
        applicableDate: '2026-03-08',
        requestedWindow: { startDate: '2026-03-02', endDate: '2026-03-08' },
    });
    assert.deepEqual(createPlanEvaluationContext(evaluatedAt, 'Asia/Tokyo'), {
        evaluatedAt,
        termZone: 'Asia/Tokyo',
        applicableDate: '2026-03-09',
        requestedWindow: { startDate: '2026-03-09', endDate: '2026-03-15' },
    });

    const springContext = createPlanEvaluationContext(
        '2026-03-08T05:00:00.000Z',
        'America/Toronto',
    );
    const springBoundary = selectNextTaskOccurrence([
        taskOccurrence('spring-day-end', { kind: 'date-only', date: '2026-03-08' }),
    ], 'small', springContext);
    assert.equal(springBoundary.kind === 'task' && springBoundary.deadlineBoundary, '2026-03-09T04:00:00.000Z');

    const fallContext = createPlanEvaluationContext(
        '2026-11-01T04:00:00.000Z',
        'America/Toronto',
    );
    const fallBoundary = selectNextTaskOccurrence([
        taskOccurrence('fall-day-end', { kind: 'date-only', date: '2026-11-01' }),
    ], 'small', fallContext);
    assert.equal(fallBoundary.kind === 'task' && fallBoundary.deadlineBoundary, '2026-11-02T05:00:00.000Z');
});

test('A-VIEW-001/TEST-PLAN-007: Meeting classification uses exact Instant boundaries and exclusions', () => {
    const scheduled: MeetingOccurrenceProjection = {
        occurrenceId: {
            meetingSeriesId: '33333333-3333-4333-8333-333333333333',
            originalLogicalAnchor: '2026-09-10',
        },
        segmentId: '44444444-4444-4444-8444-444444444444',
        date: '2026-09-10',
        status: 'scheduled',
        overrideKind: null,
        type: 'LEC',
        weekday: 'THU',
        localStart: '12:00',
        localEnd: '13:00',
        endDayOffset: 0,
        startInstant: '2026-09-10T16:00:00.000Z',
        endInstant: '2026-09-10T17:00:00.000Z',
        location: { kind: 'tba' },
    };

    assert.equal(classifyMeetingOccurrence(scheduled, '2026-09-10T15:59:59.999Z'), 'upcoming');
    assert.equal(classifyMeetingOccurrence(scheduled, scheduled.startInstant), 'in-progress');
    assert.equal(classifyMeetingOccurrence(scheduled, scheduled.endInstant), 'ended');
    assert.equal(classifyMeetingOccurrence({ ...scheduled, status: 'cancelled' }, scheduled.startInstant), 'cancelled');
    assert.equal(
        classifyMeetingOccurrence({ ...scheduled, status: 'holiday-suppressed' }, scheduled.endInstant),
        'holiday-suppressed',
    );
});

test('A-VIEW-006/TEST-PLAN-007: Term progress includes both endpoint dates and no Holiday deduction', () => {
    const term: TermProjection = {
        termId: '55555555-5555-4555-8555-555555555555',
        name: 'Three-day term',
        startDate: '2026-09-10',
        endDate: '2026-09-12',
        timeZone: 'America/Toronto',
        archived: false,
        entityVersion: '1',
    };

    assert.deepEqual(calculateTermProgress(term, '2026-09-09'), {
        elapsedDays: 0,
        totalDays: 3,
        ratio: 0,
    });
    assert.deepEqual(calculateTermProgress(term, '2026-09-10'), {
        elapsedDays: 1,
        totalDays: 3,
        ratio: 1 / 3,
    });
    assert.deepEqual(calculateTermProgress(term, '2026-09-11'), {
        elapsedDays: 2,
        totalDays: 3,
        ratio: 2 / 3,
    });
    assert.deepEqual(calculateTermProgress(term, '2026-09-12'), {
        elapsedDays: 3,
        totalDays: 3,
        ratio: 1,
    });
    assert.deepEqual(calculateTermProgress(term, '2026-09-13'), {
        elapsedDays: 3,
        totalDays: 3,
        ratio: 1,
    });
});

test('A-VIEW-001–006/TEST-WORKSPACE-001: one PLAN context builds Today and Week details consistently', () => {
    const term: TermProjection = {
        termId: '55555555-5555-4555-8555-555555555555',
        name: 'Two-week term',
        startDate: '2026-09-07',
        endDate: '2026-09-20',
        timeZone: EVALUATION_CONTEXT.termZone,
        archived: false,
        entityVersion: '2',
    };
    const pendingToday = taskOccurrence('pending-today', { kind: 'date-only', date: '2026-09-10' });
    const completedToday = taskOccurrence(
        'completed-today',
        { kind: 'date-only', date: '2026-09-10' },
        'completed',
        'large',
    );
    const skippedToday = taskOccurrence(
        'skipped-today',
        { kind: 'date-only', date: '2026-09-10' },
        'skipped',
    );
    const priorOverdue = taskOccurrence('prior-overdue', { kind: 'date-only', date: '2026-09-09' });
    const tba = taskOccurrence('tba-detail', { kind: 'tba' });
    const nearDue = taskOccurrence(
        'near-due',
        { kind: 'date-only', date: '2026-09-11' },
        'pending',
        'large',
    );
    const future = taskOccurrence('future', { kind: 'date-only', date: '2026-09-18' });
    const taskSources = [pendingToday, completedToday, skippedToday, priorOverdue, tba, nearDue, future]
        .map(occurrence => ({
            courseId: '66666666-6666-4666-8666-666666666666',
            courseCode: 'CSC108',
            occurrence,
        }));
    const meetingBase: MeetingOccurrenceProjection = {
        occurrenceId: {
            meetingSeriesId: '77777777-7777-4777-8777-777777777777',
            originalLogicalAnchor: '2026-09-10',
        },
        segmentId: '88888888-8888-4888-8888-888888888888',
        date: '2026-09-10',
        status: 'scheduled',
        overrideKind: null,
        type: 'LEC',
        weekday: 'THU',
        localStart: '10:00',
        localEnd: '11:00',
        endDayOffset: 0,
        startInstant: '2026-09-10T14:00:00.000Z',
        endInstant: '2026-09-10T15:00:00.000Z',
        location: { kind: 'known', value: 'BA 1170' },
    };
    const meetingSources = [
        meetingBase,
        {
            ...meetingBase,
            occurrenceId: { ...meetingBase.occurrenceId, meetingSeriesId: '99999999-9999-4999-8999-999999999999' },
            localStart: '13:00',
            localEnd: '14:00',
            startInstant: '2026-09-10T17:00:00.000Z',
            endInstant: '2026-09-10T18:00:00.000Z',
        },
        {
            ...meetingBase,
            occurrenceId: { ...meetingBase.occurrenceId, meetingSeriesId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
            status: 'cancelled' as const,
            overrideKind: 'cancelled' as const,
        },
        {
            ...meetingBase,
            occurrenceId: { ...meetingBase.occurrenceId, meetingSeriesId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
            status: 'holiday-suppressed' as const,
        },
    ].map(occurrence => ({
        courseId: '66666666-6666-4666-8666-666666666666',
        courseCode: 'CSC108',
        occurrence,
    }));
    const holiday: HolidayRangeProjection = {
        holidayRangeId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        termId: term.termId,
        name: 'Reading Week',
        startDate: '2026-09-10',
        endDate: '2026-09-11',
        entityVersion: '1',
    };

    const projection = buildPlanProjection({
        workspaceRevision: '9',
        planEntityVersion: '4',
        term,
        taskSources,
        meetingSources,
        holidayRanges: [holiday],
    }, EVALUATION_CONTEXT, 'disabled');

    assert.equal(projection.workspaceRevision, '9');
    assert.equal(projection.planEntityVersion, '4');
    assert.deepEqual(projection.evaluationContext, EVALUATION_CONTEXT);
    assert.deepEqual(projection.attendance, {
        availability: 'disabled',
        todayMeetingCountBasis: 'meeting-end-state',
    });
    assert.deepEqual(Object.fromEntries(projection.tasks.map(task => [
        task.occurrence.occurrenceId.originalLogicalAnchor,
        task.classification,
    ])), {
        'completed-today': 'completed',
        'future': 'future',
        'near-due': 'near-due',
        'pending-today': 'today',
        'prior-overdue': 'overdue',
        'skipped-today': 'skipped',
        'tba-detail': 'TBA',
    });
    assert.equal(projection.today.tasks.length, 4);
    assert.equal(projection.today.meetings.length, 4);
    assert.deepEqual(projection.today.summary, {
        completed: 2,
        pending: 2,
        contributions: {
            tasks: { completed: 1, pending: 1 },
            meetings: { completed: 1, pending: 1 },
        },
        excluded: {
            skippedTasks: 1,
            priorOverdueTasks: 1,
            tbaTasks: 1,
            cancelledMeetings: 1,
            holidaySuppressedMeetings: 1,
            missedMeetings: 0,
            unmarkedMeetings: 0,
        },
    });
    assert.deepEqual(projection.week.window, EVALUATION_CONTEXT.requestedWindow);
    assert.equal(projection.week.tasks.length, 5);
    assert.equal(projection.week.meetings.length, 3);
    assert.deepEqual(projection.week.holidayRanges, [holiday]);
    assert.deepEqual(projection.tba.tasks.map(task => task.occurrence.occurrenceId), [tba.occurrenceId]);
    assert.deepEqual(
        projection.today.meetings
            .filter(meeting => meeting.classification !== 'holiday-suppressed')
            .map(meeting => meeting.occurrence.occurrenceId),
        projection.week.meetings.map(meeting => meeting.occurrence.occurrenceId),
    );
    assert.equal(projection.next.small.kind, 'task');
    assert.deepEqual(
        projection.next.small.kind === 'task' && projection.next.small.task.occurrence.occurrenceId,
        priorOverdue.occurrenceId,
    );
    assert.equal(projection.next.large.kind, 'task');
    assert.deepEqual(
        projection.next.large.kind === 'task' && projection.next.large.task.occurrence.occurrenceId,
        nearDue.occurrenceId,
    );
    assert.deepEqual(projection.termProgress, {
        elapsedDays: 4,
        totalDays: 14,
        ratio: 2 / 7,
    });
});

test('A-CALENDAR-001–003/TEST-PLAN-008: Calendar, Agenda, and TBA reuse one classified occurrence set', () => {
    const evaluationContext: PlanEvaluationContext = {
        ...EVALUATION_CONTEXT,
        evaluatedAt: '2026-09-10T14:25:00.000Z',
    };
    const term: TermProjection = {
        termId: '55555555-5555-4555-8555-555555555555',
        name: 'Fall 2026',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        timeZone: EVALUATION_CONTEXT.termZone,
        archived: false,
        entityVersion: '3',
    };
    const weeklyTimed = taskOccurrence(
        '2026-09-10',
        {
            kind: 'timed',
            instant: '2026-09-10T14:20:00.000Z',
            timeZone: 'America/Toronto',
        },
        'pending',
        'small',
        '77777777-7777-4777-8777-777777777777',
    );
    const onceDateOnly = taskOccurrence(
        'once',
        { kind: 'date-only', date: '2026-09-10' },
        'pending',
        'large',
        '88888888-8888-4888-8888-888888888888',
    );
    const tba = taskOccurrence(
        'once',
        { kind: 'tba' },
        'pending',
        'small',
        '99999999-9999-4999-8999-999999999999',
    );
    const completedTba = taskOccurrence(
        'once',
        { kind: 'tba' },
        'completed',
        'large',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
    const skippedTba = taskOccurrence(
        'once',
        { kind: 'tba' },
        'skipped',
        'small',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    );
    const firstMeeting = meetingOccurrence({
        meetingSeriesId: '11111111-1111-4111-8111-111111111111',
        segmentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        date: '2026-09-10',
        type: 'LEC',
        weekday: 'THU',
        localStart: '10:00',
        localEnd: '11:00',
        startInstant: '2026-09-10T14:00:00.000Z',
        endInstant: '2026-09-10T15:00:00.000Z',
    });
    const cancelledMeeting = meetingOccurrence({
        meetingSeriesId: '22222222-2222-4222-8222-222222222222',
        segmentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        date: '2026-09-10',
        type: 'PRA',
        weekday: 'THU',
        localStart: '10:10',
        localEnd: '10:40',
        startInstant: '2026-09-10T14:10:00.000Z',
        endInstant: '2026-09-10T14:40:00.000Z',
        status: 'cancelled',
    });
    const secondMeeting = meetingOccurrence({
        meetingSeriesId: '33333333-3333-4333-8333-333333333333',
        segmentId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        date: '2026-09-10',
        type: 'TUT',
        weekday: 'THU',
        localStart: '10:30',
        localEnd: '11:30',
        startInstant: '2026-09-10T14:30:00.000Z',
        endInstant: '2026-09-10T15:30:00.000Z',
    });
    const suppressedMeeting = meetingOccurrence({
        meetingSeriesId: '44444444-4444-4444-8444-444444444444',
        segmentId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        date: '2026-09-12',
        type: 'LEC',
        weekday: 'SAT',
        localStart: '10:00',
        localEnd: '11:00',
        startInstant: '2026-09-12T14:00:00.000Z',
        endInstant: '2026-09-12T15:00:00.000Z',
        status: 'holiday-suppressed',
    });
    const holiday: HolidayRangeProjection = {
        holidayRangeId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        termId: term.termId,
        name: 'Reading Week',
        startDate: '2026-09-12',
        endDate: '2026-09-20',
        entityVersion: '2',
    };
    const courseId = '66666666-6666-4666-8666-666666666666';
    const projection = buildPlanProjection({
        workspaceRevision: '12',
        planEntityVersion: '8',
        term,
        taskSources: [skippedTba, completedTba, tba, onceDateOnly, weeklyTimed].map(occurrence => ({
            courseId,
            courseCode: 'CSC301',
            occurrence,
        })),
        meetingSources: [secondMeeting, suppressedMeeting, cancelledMeeting, firstMeeting]
            .map(occurrence => ({
                courseId,
                courseCode: 'CSC301',
                occurrence,
            })),
        holidayRanges: [holiday],
    }, evaluationContext, 'disabled');

    assert.equal(projection.workspaceRevision, '12');
    assert.deepEqual(projection.evaluationContext, evaluationContext);
    assert.deepEqual(projection.today.tasks.map(task => task.occurrence.occurrenceId), [
        weeklyTimed.occurrenceId,
        onceDateOnly.occurrenceId,
    ]);
    assert.deepEqual(projection.week.tasks.map(task => task.occurrence.occurrenceId), [
        weeklyTimed.occurrenceId,
        onceDateOnly.occurrenceId,
    ]);
    assert.deepEqual(projection.today.meetings.map(meeting => meeting.occurrence.occurrenceId), [
        firstMeeting.occurrenceId,
        cancelledMeeting.occurrenceId,
        secondMeeting.occurrenceId,
    ]);
    assert.deepEqual(projection.week.meetings.map(meeting => meeting.occurrence.occurrenceId), [
        firstMeeting.occurrenceId,
        cancelledMeeting.occurrenceId,
        secondMeeting.occurrenceId,
    ]);
    assert.deepEqual(projection.today.summary, {
        completed: 0,
        pending: 4,
        contributions: {
            tasks: { completed: 0, pending: 2 },
            meetings: { completed: 0, pending: 2 },
        },
        excluded: {
            skippedTasks: 0,
            priorOverdueTasks: 0,
            tbaTasks: 1,
            cancelledMeetings: 1,
            holidaySuppressedMeetings: 0,
            missedMeetings: 0,
            unmarkedMeetings: 0,
        },
    });
    assert.deepEqual(projection.termProgress, {
        elapsedDays: 10,
        totalDays: 30,
        ratio: 1 / 3,
    });
    assert.deepEqual(projection.calendar.window, evaluationContext.requestedWindow);
    assert.deepEqual(projection.calendar.timedItems.map(item => [
        item.kind,
        item.typeLabel,
        item.occurrence.occurrenceId,
        item.classification,
    ]), [
        ['meeting', 'Lecture', firstMeeting.occurrenceId, 'in-progress'],
        ['meeting', 'Practical', cancelledMeeting.occurrenceId, 'cancelled'],
        ['task', 'Task', weeklyTimed.occurrenceId, 'overdue'],
        ['meeting', 'Tutorial', secondMeeting.occurrenceId, 'upcoming'],
    ]);
    assert.deepEqual(projection.calendar.allDayItems.map(item => item.occurrence.occurrenceId), [
        onceDateOnly.occurrenceId,
    ]);
    assert.deepEqual(projection.calendar.holidaySegments.map(segment => ({
        holidayRangeId: segment.holidayRange.holidayRangeId,
        typeLabel: segment.typeLabel,
        visibleStartDate: segment.visibleStartDate,
        visibleEndDate: segment.visibleEndDate,
    })), [{
        holidayRangeId: holiday.holidayRangeId,
        typeLabel: 'Holiday',
        visibleStartDate: '2026-09-12',
        visibleEndDate: '2026-09-13',
    }]);
    assert.deepEqual(projection.agenda.items.map(item => {
        if (item.kind === 'holiday-range') {
            return ['holiday-range', item.typeLabel, item.holidayRange.holidayRangeId];
        }
        return [item.kind, item.typeLabel, item.occurrence.occurrenceId];
    }), [
        ['meeting', 'Lecture', firstMeeting.occurrenceId],
        ['meeting', 'Practical', cancelledMeeting.occurrenceId],
        ['task', 'Task', weeklyTimed.occurrenceId],
        ['meeting', 'Tutorial', secondMeeting.occurrenceId],
        ['task', 'Task', onceDateOnly.occurrenceId],
        ['holiday-range', 'Holiday', holiday.holidayRangeId],
    ]);
    assert.deepEqual(projection.agenda.warnings.map(warning => ({
        code: warning.code,
        first: warning.first.occurrence.occurrenceId,
        second: warning.second.occurrence.occurrenceId,
        overlap: warning.overlap,
    })), [{
        code: 'meeting-time-overlap',
        first: firstMeeting.occurrenceId,
        second: secondMeeting.occurrenceId,
        overlap: {
            startInstant: '2026-09-10T14:30:00.000Z',
            endInstant: '2026-09-10T15:00:00.000Z',
        },
    }]);
    assert.deepEqual(projection.tba.tasks.map(task => [
        task.typeLabel,
        task.classification,
        task.occurrence.occurrenceId,
    ]), [
        ['Task', 'TBA', tba.occurrenceId],
        ['Task', 'completed', completedTba.occurrenceId],
        ['Task', 'skipped', skippedTba.occurrenceId],
    ]);
    assert.equal(projection.calendar.timedItems.some(item => (
        item.kind === 'meeting'
        && item.occurrence.occurrenceId.meetingSeriesId
            === suppressedMeeting.occurrenceId.meetingSeriesId
    )), false);
    assert.equal(projection.agenda.items.some(item => (
        item.kind === 'meeting'
        && item.occurrence.occurrenceId.meetingSeriesId
            === suppressedMeeting.occurrenceId.meetingSeriesId
    )), false);
    const twoWeekProjection = buildPlanProjection({
        workspaceRevision: '12',
        planEntityVersion: '8',
        term,
        taskSources: [],
        meetingSources: [],
        holidayRanges: [holiday],
    }, {
        ...evaluationContext,
        requestedWindow: { startDate: '2026-09-07', endDate: '2026-09-20' },
    }, 'disabled');
    assert.deepEqual(twoWeekProjection.calendar.holidaySegments.map(segment => ({
        holidayRangeId: segment.holidayRange.holidayRangeId,
        visibleStartDate: segment.visibleStartDate,
        visibleEndDate: segment.visibleEndDate,
    })), [
        {
            holidayRangeId: holiday.holidayRangeId,
            visibleStartDate: '2026-09-12',
            visibleEndDate: '2026-09-13',
        },
        {
            holidayRangeId: holiday.holidayRangeId,
            visibleStartDate: '2026-09-14',
            visibleEndDate: '2026-09-20',
        },
    ]);
    assert.equal(twoWeekProjection.agenda.items.filter(item => item.kind === 'holiday-range').length, 1);
    assert.equal(isPlanProjection(projection), true);
    assert.equal(isPlanProjection({
        ...projection,
        agenda: {
            ...projection.agenda,
            items: Array.from(projection.agenda.items).reverse(),
        },
    }), false);
    const timedItemsWithUnknownProperty = Array.from(projection.calendar.timedItems);
    Object.defineProperty(timedItemsWithUnknownProperty, 'unknown', {
        value: true,
        enumerable: true,
    });
    assert.equal(isPlanProjection({
        ...projection,
        calendar: {
            ...projection.calendar,
            timedItems: timedItemsWithUnknownProperty,
        },
    }), false);
    const holidaySegmentWithUnknownProperty = {
        ...projection.calendar.holidaySegments[0]!,
    };
    Object.defineProperty(holidaySegmentWithUnknownProperty, Symbol('unknown'), {
        value: true,
        enumerable: true,
    });
    assert.equal(isPlanProjection({
        ...projection,
        calendar: {
            ...projection.calendar,
            holidaySegments: [holidaySegmentWithUnknownProperty],
        },
    }), false);
});

test('ADR-04/A-CALENDAR-002/TEST-PLAN-008: Agenda conflict warnings are bounded and deterministic', () => {
    const term: TermProjection = {
        termId: '11111111-1111-4111-8111-111111111111',
        name: 'Fall 2026',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        timeZone: EVALUATION_CONTEXT.termZone,
        archived: false,
        entityVersion: '1',
    };
    const occurrences = Array.from({ length: 92 }, (_unused, index) => {
        const suffix = String(index + 1).padStart(12, '0');
        return meetingOccurrence({
            meetingSeriesId: `10000000-0000-4000-8000-${suffix}`,
            segmentId: `20000000-0000-4000-8000-${suffix}`,
            date: EVALUATION_CONTEXT.applicableDate,
            type: 'LEC',
            weekday: 'THU',
            localStart: '10:00',
            localEnd: '11:00',
            startInstant: '2026-09-10T14:00:00.000Z',
            endInstant: '2026-09-10T15:00:00.000Z',
        });
    });
    /**
     * Builds the same dense schedule from any source ordering.
     * @param {readonly MeetingOccurrenceProjection[]} meetingOccurrences - Candidate source order.
     * @return {PlanProjection} Unified projection under comparison.
     */
    function buildProjection(
        meetingOccurrences: readonly MeetingOccurrenceProjection[],
    ): PlanProjection {
        return buildPlanProjection({
            workspaceRevision: '1',
            planEntityVersion: '1',
            term,
            taskSources: [],
            meetingSources: meetingOccurrences.map(occurrence => ({
                courseId: '30000000-0000-4000-8000-000000000001',
                courseCode: 'CSC301',
                occurrence,
            })),
            holidayRanges: [],
        }, EVALUATION_CONTEXT, 'disabled');
    }
    const projection = buildProjection(occurrences);

    assert.equal(projection.agenda.warnings.length, MAX_MEETING_OVERLAP_WARNINGS);
    assert.deepEqual(
        projection.agenda.warnings,
        buildProjection(Array.from(occurrences).reverse()).agenda.warnings,
    );
    assert.equal(isPlanProjection(projection), true);
});
