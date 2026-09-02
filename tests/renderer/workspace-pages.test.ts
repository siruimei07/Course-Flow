/**
 * @file Verifies the five Workspace presentation pages against real setup and PLAN projections.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ManagementSurfaceId } from '../../src/renderer/management-surfaces';
import type { WorkspaceNavigationId } from '../../src/renderer/navigation';
import type { TaskListFilter } from '../../src/renderer/workspace-view-state';
import {
    CalendarPage,
    CoursesPage,
    FilesPage,
    TaskActionNotice,
    TasksPage,
    TodayPage,
    WorkspacePage,
    type CalendarWeekPresentation,
    type TaskActionPresentation,
} from '../../src/renderer/workspace-pages';
import {
    buildPlanProjection,
    type PlanEvaluationContext,
    type PlanProjection,
} from '../../src/shared/workspace-plan-contract';
import type {
    CourseProjection,
    MeetingOccurrenceProjection,
} from '../../src/shared/workspace-course-contract';
import type { HolidayRangeProjection } from '../../src/shared/workspace-holiday-contract';
import type { TaskOccurrenceProjection } from '../../src/shared/workspace-task-contract';
import type { SetupProjection, TermProjection } from '../../src/shared/workspace-term-contract';

const TERM: TermProjection = {
    termId: '11111111-1111-4111-8111-111111111111',
    name: 'Fall 2026',
    startDate: '2026-09-07',
    endDate: '2026-09-20',
    timeZone: 'America/Toronto',
    archived: false,
    entityVersion: '1',
};

const COURSE: CourseProjection = {
    courseId: '22222222-2222-4222-8222-222222222222',
    termId: TERM.termId,
    code: 'CSC108',
    name: 'Introduction to Computer Programming',
    section: 'L0101',
    instructor: 'Ada Lovelace',
    color: 'blue',
    credits: '0.5',
    teachingRange: {
        kind: 'inherit-term',
        startDate: TERM.startDate,
        endDate: TERM.endDate,
    },
    archived: false,
    entityVersion: '1',
    meetings: [{
        meetingSeriesId: '33333333-3333-4333-8333-333333333333',
        type: { code: 'LEC', name: 'Lecture' },
        weekday: 'THU',
        localStart: '13:00',
        localEnd: '14:00',
        endDayOffset: 0,
        effectiveRange: {
            kind: 'inherit-course',
            startDate: TERM.startDate,
            endDate: TERM.endDate,
        },
        location: { kind: 'known', value: 'BA 1170' },
        entityVersion: '1',
    }],
};

const COURSE_WITHOUT_MEETINGS: CourseProjection = {
    ...COURSE,
    courseId: '44444444-4444-4444-8444-444444444444',
    code: 'MAT137',
    name: 'Calculus with Proofs',
    section: null,
    instructor: null,
    color: 'purple',
    credits: null,
    meetings: [],
};

const EVALUATION_CONTEXT: PlanEvaluationContext = {
    evaluatedAt: '2026-09-10T16:00:00.000Z',
    termZone: TERM.timeZone,
    applicableDate: '2026-09-10',
    requestedWindow: {
        startDate: '2026-09-07',
        endDate: '2026-09-13',
    },
};

const TODAY_MEETING: MeetingOccurrenceProjection = {
    occurrenceId: {
        meetingSeriesId: COURSE.meetings[0].meetingSeriesId,
        originalLogicalAnchor: '2026-09-10',
    },
    segmentId: '55555555-5555-4555-8555-555555555555',
    date: '2026-09-10',
    status: 'scheduled',
    overrideKind: null,
    type: 'LEC',
    weekday: 'THU',
    localStart: '13:00',
    localEnd: '14:00',
    endDayOffset: 0,
    startInstant: '2026-09-10T17:00:00.000Z',
    endInstant: '2026-09-10T18:00:00.000Z',
    location: { kind: 'known', value: 'BA 1170' },
};

const OVERLAPPING_MEETING: MeetingOccurrenceProjection = {
    ...TODAY_MEETING,
    occurrenceId: {
        meetingSeriesId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        originalLogicalAnchor: '2026-09-10',
    },
    segmentId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    type: 'TUT',
    localStart: '13:30',
    localEnd: '14:30',
    startInstant: '2026-09-10T17:30:00.000Z',
    endInstant: '2026-09-10T18:30:00.000Z',
    location: { kind: 'tba' },
};

const THIRD_OVERLAPPING_MEETING: MeetingOccurrenceProjection = {
    ...TODAY_MEETING,
    occurrenceId: {
        meetingSeriesId: '14141414-1414-4414-8414-141414141414',
        originalLogicalAnchor: '2026-09-10',
    },
    segmentId: '15151515-1515-4515-8515-151515151515',
    type: 'PRA',
    localStart: '13:45',
    localEnd: '14:15',
    startInstant: '2026-09-10T17:45:00.000Z',
    endInstant: '2026-09-10T18:15:00.000Z',
    location: { kind: 'known', value: 'BA 1200' },
};

const TUESDAY_MEETING: MeetingOccurrenceProjection = {
    ...TODAY_MEETING,
    occurrenceId: {
        meetingSeriesId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        originalLogicalAnchor: '2026-09-08',
    },
    segmentId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    date: '2026-09-08',
    weekday: 'TUE',
    localStart: '09:00',
    localEnd: '10:30',
    startInstant: '2026-09-08T13:00:00.000Z',
    endInstant: '2026-09-08T14:30:00.000Z',
};

const HOLIDAY: HolidayRangeProjection = {
    holidayRangeId: '66666666-6666-4666-8666-666666666666',
    termId: TERM.termId,
    name: 'Reading Week',
    startDate: '2026-09-12',
    endDate: '2026-09-13',
    entityVersion: '1',
};

const MONDAY_TO_WEDNESDAY_HOLIDAY: HolidayRangeProjection = {
    ...HOLIDAY,
    holidayRangeId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    name: 'Orientation Break',
    startDate: '2026-09-07',
    endDate: '2026-09-09',
};

const PRE_WINDOW_HOLIDAY: HolidayRangeProjection = {
    ...HOLIDAY,
    holidayRangeId: '16161616-1616-4616-8616-161616161616',
    name: 'Orientation Week',
    startDate: '2026-09-01',
    endDate: '2026-09-08',
};

/**
 * Creates one occurrence that can feed the real PLAN projection builder.
 *
 * @param {Object} value Task identity, title, size, and deadline facts.
 * @return {TaskOccurrenceProjection} A complete pending occurrence projection.
 */
function taskOccurrence(value: Readonly<{
    taskSeriesId: string;
    title: string;
    size: TaskOccurrenceProjection['size'];
    deadline: TaskOccurrenceProjection['deadline'];
}>): TaskOccurrenceProjection {
    return {
        occurrenceId: {
            taskSeriesId: value.taskSeriesId,
            originalLogicalAnchor: 'once',
        },
        title: value.title,
        size: value.size,
        deadline: value.deadline,
        segmentId: '77777777-7777-4777-8777-777777777777',
        status: 'pending',
        reportedProgress: null,
        displayProgress: null,
        overrideKind: 'none',
    };
}

const SMALL_TASK = taskOccurrence({
    taskSeriesId: '88888888-8888-4888-8888-888888888888',
    title: 'Read chapter one',
    size: 'small',
    deadline: { kind: 'date-only', date: '2026-09-10' },
});

const LARGE_TASK = taskOccurrence({
    taskSeriesId: '99999999-9999-4999-8999-999999999999',
    title: 'Draft project outline',
    size: 'large',
    deadline: { kind: 'date-only', date: '2026-09-11' },
});

const TBA_TASK = taskOccurrence({
    taskSeriesId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    title: 'Confirm research topic',
    size: 'small',
    deadline: { kind: 'tba' },
});

const WEDNESDAY_ALL_DAY_TASK = taskOccurrence({
    taskSeriesId: '12121212-1212-4212-8212-121212121212',
    title: 'Submit lab notes',
    size: 'small',
    deadline: { kind: 'date-only', date: '2026-09-09' },
});

const FRIDAY_TIMED_TASK = taskOccurrence({
    taskSeriesId: '13131313-1313-4313-8313-131313131313',
    title: 'Project checkpoint',
    size: 'large',
    deadline: {
        kind: 'timed',
        instant: '2026-09-11T14:00:00.000Z',
        timeZone: TERM.timeZone,
    },
});

const FRIDAY_ADJACENT_TASK = taskOccurrence({
    taskSeriesId: '17171717-1717-4717-8717-171717171717',
    title: 'Adjacent checkpoint',
    size: 'small',
    deadline: {
        kind: 'timed',
        instant: '2026-09-11T14:30:00.000Z',
        timeZone: TERM.timeZone,
    },
});

const HANDLERS = {
    onContinueSetup(): void {},
    onCreateTask(): void {},
    onOpenManagement(_surface: ManagementSurfaceId): void {},
    onNavigate(_page: WorkspaceNavigationId): void {},
};

const TASK_ACTIONS: TaskActionPresentation = {
    writable: true,
    busyItemId: null,
    problem: null,
    canRunAction(): boolean {
        return true;
    },
    undo: {
        actionLabel: '撤销',
        message: '任务状态已保存。',
        submitting: false,
    },
    onAction(): void {},
    onUndo(): void {},
    onUndoHoverChange(): void {},
    onUndoFocusChange(): void {},
};

/**
 * Builds the setup facts consumed directly by the Course page and setup notices.
 *
 * @param {Partial<SetupProjection>} overrides Projection fields to replace.
 * @return {SetupProjection} Complete setup projection.
 */
function setupProjection(overrides: Partial<SetupProjection> = {}): SetupProjection {
    return {
        workspaceRevision: '5',
        planEntityVersion: '3',
        minimum: {
            hasCurrentTerm: true,
            hasCurrentTermCourse: true,
            hasMeetingOrTask: true,
            isSatisfied: true,
        },
        everReachedMinimum: true,
        defaultRoute: 'today',
        draftCheckpointVersion: '0',
        draftCheckpoint: null,
        currentTerm: TERM,
        terms: [TERM],
        courses: [COURSE, COURSE_WITHOUT_MEETINGS],
        holidayRanges: [HOLIDAY],
        tasks: [],
        ...overrides,
    };
}

/**
 * Builds one unified PLAN projection without duplicating its classifications or summaries in the test.
 *
 * @param {Object} options Optional real occurrence collections.
 * @return {PlanProjection} Unified projection for one stable evaluation context.
 */
function planProjection(options: Readonly<{
    tasks?: readonly TaskOccurrenceProjection[];
    meetings?: readonly MeetingOccurrenceProjection[];
    holidayRanges?: readonly HolidayRangeProjection[];
    evaluationContext?: PlanEvaluationContext;
}> = {}): PlanProjection {
    const tasks = options.tasks ?? [SMALL_TASK, LARGE_TASK, TBA_TASK];
    const meetings = options.meetings ?? [TODAY_MEETING, OVERLAPPING_MEETING];

    return buildPlanProjection({
        workspaceRevision: '5',
        planEntityVersion: '3',
        term: TERM,
        taskSources: tasks.map(occurrence => ({
            courseId: COURSE.courseId,
            courseCode: COURSE.code,
            occurrence,
        })),
        meetingSources: meetings.map(occurrence => ({
            courseId: COURSE.courseId,
            courseCode: COURSE.code,
            occurrence,
        })),
        holidayRanges: options.holidayRanges ?? [HOLIDAY],
    }, options.evaluationContext ?? EVALUATION_CONTEXT, 'unavailable');
}

/**
 * Renders the shared dispatcher with inert but real button handlers.
 *
 * @param {WorkspaceNavigationId} page Page selected by the fixed navigation.
 * @param {PlanProjection | null} plan Unified plan data when available.
 * @param {boolean} setupIncomplete Whether the first-run minimum remains incomplete.
 * @return {string} Static semantic HTML.
 */
function renderWorkspacePage(
    page: WorkspaceNavigationId,
    plan: PlanProjection | null = planProjection(),
    setupIncomplete = false,
): string {
    return renderToStaticMarkup(createElement(WorkspacePage, {
        ...HANDLERS,
        page,
        setup: setupProjection(),
        plan,
        setupIncomplete,
    }));
}

/**
 * Renders the Calendar page with the week presentation the Shell always supplies.
 *
 * @param {PlanProjection} plan Unified plan data evaluated for the visible week.
 * @param {Partial<CalendarWeekPresentation>} week Week presentation fields to replace.
 * @return {string} Static semantic HTML.
 */
function renderCalendarPage(
    plan: PlanProjection = planProjection(),
    week: Partial<CalendarWeekPresentation> = {},
): string {
    return renderToStaticMarkup(createElement(CalendarPage, {
        ...HANDLERS,
        setup: setupProjection(),
        plan,
        setupIncomplete: false,
        calendarWeek: {
            offset: 0,
            busy: false,
            problem: null,
            plan: null,
            selectedDate: null,
            onSelectDate(): void {},
            onShift(): void {},
            onReturnToCurrentWeek(): void {},
            ...week,
        },
    }));
}

test('TodayPage renders only real unified Today, Week, next-task, and term-progress facts', () => {
    const html = renderWorkspacePage('today', planProjection(), true);

    assert.match(html, /<h1[^>]*>星期四，下午好<\/h1>/);
    assert.match(html, /2026-09-10/);
    assert.match(html, /America\/Toronto/);
    assert.match(html, /Read chapter one/);
    assert.match(html, /Draft project outline/);
    assert.match(html, /剩余时间/);
    assert.match(html, /CSC108/);
    assert.match(html, /BA 1170/);
    assert.match(html, /data-item-id="meeting:33333333-3333-4333-8333-333333333333:2026-09-10"/);
    assert.match(html, /data-item-id="task:88888888-8888-4888-8888-888888888888:once"/);
    assert.match(html, /2026-09-07/);
    assert.match(html, /2026-09-13/);
    assert.match(html, /4 \/ 14/);
    assert.match(html, /设置未完成/);
    assert.match(html, /继续设置/);
    assert.match(html, /class="content-card next-step-card"/);
    // Slice 12: the three attention facts sit in the cards that own their scope.
    assert.doesNotMatch(html, /today-attention-title|需要注意/);
    const weekLoad = html.match(
        /<section aria-labelledby="today-week-title"[\s\S]*?<\/section>/,
    )?.[0] ?? '';
    assert.match(weekLoad, /data-severity="warning">1 组时间冲突</);
    assert.match(weekLoad, /周四 13:00 CSC108 与 CSC108 重叠/);
    const termTasks = html.match(
        /<section aria-labelledby="today-term-tasks-title"[\s\S]*?<\/section>/,
    )?.[0] ?? '';
    assert.match(termTasks, /class="status-label">TBA 1</);
    assert.doesNotMatch(html, /出席|缺席|成绩|备份|保护|Attendance|Grade|Protect/);

    assert.equal(typeof TodayPage, 'function');
});

test('Today opens on a four-column grid with the day timeline as its left spine', () => {
    const html = renderWorkspacePage('today');

    // The Current Term name moved into the header capsule, with its own remaining-day fact.
    assert.match(html, /class="term-progress-name">Fall 2026</);
    assert.match(html, /class="term-progress-remaining">剩余 10 天</);
    assert.match(html, /class="term-progress-elapsed"/);

    // Three action numbers, not the old four-counter stat bar.
    const headline = html.match(
        /<dl class="today-headline-stats">[\s\S]*?<\/dl>/,
    )?.[0] ?? '';
    assert.match(headline, /逾期任务<\/dt><dd[^>]*>0</);
    assert.match(headline, /今日待完成<\/dt><dd[^>]*>3</);
    assert.match(headline, /下一节<\/dt><dd[^>]*><time dateTime="13:00">13:00</);
    assert.doesNotMatch(headline, /当前学期课程|今日已完成/);
    assert.doesNotMatch(html, /today-summary-title|today-column/);

    // The seven slots appear in reading order; none of them is conditional.
    const order = [
        'today-timeline-title',
        'today-now-title',
        'today-week-title',
        'today-next-step-title',
        'today-tasks-title',
        'today-courses-title',
        'today-term-tasks-title',
    ].map(id => html.indexOf(id));
    assert.ok(order.every(position => position >= 0), 'every Today slot must render');
    assert.deepEqual(order.toSorted((left, right) => left - right), order);
    assert.match(html, /class="workspace-grid workspace-grid--today"/);
    assert.doesNotMatch(html, /week-strip|attention-card|today-collapsed-note|next-step-card--wide/);

    // The timeline places real occurrences on the shared 33px hour geometry.
    assert.match(html, /--timeline-hour-count:15/);
    assert.match(
        html,
        /data-item-id="meeting:33333333-3333-4333-8333-333333333333:2026-09-10"[^>]*--event-top:198px/,
    );
    assert.match(html, /class="today-now-line"[^>]*style="--now-top:165px"/);

    // A day without meetings still draws the rail and offers one real next step.
    const withoutMeetings = renderWorkspacePage('today', planProjection({ meetings: [] }));
    assert.match(withoutMeetings, /class="today-timeline-hours"/);
    assert.match(withoutMeetings, /id="today-timeline-empty"/);
});

test('Today keeps every slot on a quiet day and drops only the facts that are zero', () => {
    const quiet = planProjection({
        meetings: [TODAY_MEETING],
        tasks: [SMALL_TASK, LARGE_TASK],
    });
    assert.equal(quiet.today.summary.excluded.priorOverdueTasks, 0);
    assert.equal(quiet.agenda.warnings.length, 0);
    assert.equal(quiet.tba.tasks.length, 0);

    const html = renderWorkspacePage('today', quiet);

    for (const id of ['today-now-title', 'today-week-title', 'today-next-step-title', 'today-courses-title',
        'today-term-tasks-title']) {
        assert.match(html, new RegExp(`id="${id}"`), `${id} stays in the grid`);
    }
    assert.doesNotMatch(html, /组时间冲突|>TBA \d+<|逾期 \d+</);
    assert.doesNotMatch(html, /today-attention-title|today-collapsed-note|next-step-card--wide/);
});

test('the 现在 card reads one state at a time from the PLAN classifications', () => {
    // 12:00 Toronto with two upcoming classes: between classes, day ring at 0 of 2.
    const between = renderWorkspacePage('today');
    const nowCard = (html: string): string => html.match(
        /<section aria-labelledby="today-now-title"[\s\S]*?<\/section>/,
    )?.[0] ?? '';
    assert.match(nowCard(between), /data-now-state="between"/);
    assert.match(nowCard(between), /class="page-context now-clock"><time dateTime="2026-09-10T16:00:00.000Z">12:00</);
    assert.match(nowCard(between), /class="now-state">课间</);
    assert.match(nowCard(between), /class="now-value">1 小时后</);
    assert.match(nowCard(between), /下一节 CSC108 Lecture · 13:00 · BA 1170/);
    assert.match(nowCard(between), /data-course-color="blue" data-ring="day"/);
    assert.match(nowCard(between), /--ring-ratio:0"/);

    // 13:20 Toronto inside the lecture: in-class ratio and the Course colour on the arc.
    const inClass = renderWorkspacePage('today', planProjection({
        evaluationContext: { ...EVALUATION_CONTEXT, evaluatedAt: '2026-09-10T17:20:00.000Z' },
    }));
    assert.match(nowCard(inClass), /data-now-state="in-class"/);
    assert.match(nowCard(inClass), /class="now-state" data-live="true">上课中</);
    assert.match(nowCard(inClass), /class="now-value">剩 40 分钟</);
    assert.match(nowCard(inClass), /CSC108 Lecture · 至 14:00 · BA 1170/);
    assert.match(nowCard(inClass), /data-course-color="blue" data-ring="course"/);
    assert.match(nowCard(inClass), /--ring-ratio:0.333/);

    // 15:00 Toronto after both classes: the day is done, the next class is read from the Term list.
    const done = renderWorkspacePage('today', planProjection({
        meetings: [TODAY_MEETING, OVERLAPPING_MEETING, {
            ...TUESDAY_MEETING,
            occurrenceId: { ...TUESDAY_MEETING.occurrenceId, originalLogicalAnchor: '2026-09-15' },
            date: '2026-09-15',
            startInstant: '2026-09-15T13:00:00.000Z',
            endInstant: '2026-09-15T14:30:00.000Z',
        }],
        evaluationContext: { ...EVALUATION_CONTEXT, evaluatedAt: '2026-09-10T19:00:00.000Z' },
    }));
    assert.match(nowCard(done), /data-now-state="done"/);
    assert.match(nowCard(done), /class="now-value">今天 2 节课已结束</);
    assert.match(nowCard(done), /下一节 周二 09:00 CSC108/);
    assert.match(nowCard(done), /--ring-ratio:1"/);

    // No class today inside the Term.
    const free = renderWorkspacePage('today', planProjection({ meetings: [TUESDAY_MEETING] }));
    assert.match(nowCard(free), /data-now-state="free"/);
    assert.match(nowCard(free), /class="now-value">今天没有课</);
    assert.match(nowCard(free), /本学期没有其他课节/);
    assert.match(nowCard(free), /data-empty="true"/);

    // Before the Term starts: days to go and the first class of the Term.
    const beforeTerm = renderWorkspacePage('today', planProjection({
        meetings: [TODAY_MEETING],
        evaluationContext: {
            evaluatedAt: '2026-09-01T16:00:00.000Z',
            termZone: TERM.timeZone,
            applicableDate: '2026-09-01',
            requestedWindow: { startDate: '2026-08-31', endDate: '2026-09-06' },
        },
    }));
    assert.match(nowCard(beforeTerm), /data-now-state="before-term"/);
    assert.match(nowCard(beforeTerm), /class="now-state">开学前</);
    assert.match(nowCard(beforeTerm), /class="now-value">6 天</);
    assert.match(nowCard(beforeTerm), /第一节 周四 13:00 CSC108 · 09-10 · BA 1170/);
});

test('the 本周课时 chart plots the PLAN day load and marks today without relying on colour', () => {
    const html = renderWorkspacePage('today');
    const card = html.match(/<section aria-labelledby="today-week-title"[\s\S]*?<\/section>/)?.[0] ?? '';

    assert.match(card, /class="page-context">2 小时 · 2 节</);
    assert.equal((card.match(/<li /g) ?? []).length, 7);
    assert.match(card, /data-current="true" data-day="2026-09-10"[^>]*>/);
    assert.match(card, /data-day="2026-09-10"[^>]*><span class="week-load-peak">2 小时</);
    assert.match(card, /data-day="2026-09-10"[\s\S]*?--load:1"/);
    assert.match(card, /data-day="2026-09-07" data-empty="true"[\s\S]*?--load:0"/);
    // Task dots: one deadline on Thursday and one on Friday, none elsewhere.
    assert.match(card, /data-day="2026-09-10"[\s\S]*?class="week-load-tasks"><i><\/i><\/span>/);
    assert.match(card, /data-day="2026-09-11"[\s\S]*?class="week-load-tasks"><i><\/i><\/span>/);
    assert.match(card, /周四 2 节课 120 分钟 1 项任务/);

    const beforeTerm = renderWorkspacePage('today', planProjection({
        meetings: [],
        tasks: [],
        evaluationContext: {
            evaluatedAt: '2026-09-01T16:00:00.000Z',
            termZone: TERM.timeZone,
            applicableDate: '2026-09-01',
            requestedWindow: { startDate: '2026-08-31', endDate: '2026-09-06' },
        },
    }));
    assert.match(beforeTerm, /学期 2026-09-07 开始，本周还是空的。/);
});

test('the dark card lists the week deadlines PLAN ordered and never acts on them', () => {
    const html = renderWorkspacePage('today', planProjection({
        tasks: [SMALL_TASK, LARGE_TASK, TBA_TASK, WEDNESDAY_ALL_DAY_TASK, FRIDAY_TIMED_TASK, FRIDAY_ADJACENT_TASK, {
            ...SMALL_TASK,
            occurrenceId: { ...SMALL_TASK.occurrenceId, taskSeriesId: '18181818-1818-4818-8818-181818181818' },
            title: 'Finished reading',
            status: 'completed',
        }],
    }));
    const card = html.match(/<section aria-labelledby="today-next-step-title"[\s\S]*?<\/section>/)?.[0] ?? '';

    assert.match(card, /<h3 id="today-week-deadlines-title">本周截止<\/h3>/);
    assert.match(card, /class="week-deadlines-count"><strong>1<\/strong>\/6</);
    const rows = card.match(/<li data-item-id="task:[^"]+"[^>]*>/g) ?? [];
    assert.equal(rows.length, 5, 'five rows at most');
    assert.match(card, /还有 1 项在任务页。/);
    assert.match(rows[0]!, /data-severity="critical" data-state="pending"/);
    assert.match(card, /Submit lab notes<\/span><span class="deadline-meta">CSC108 · 周三 · 逾期</);
    assert.match(card, /data-state="completed"[\s\S]*?<svg viewBox="0 0 16 16">/);
    assert.match(card, /Project checkpoint<\/span><span class="deadline-meta">CSC108 · 周五 10:00</);
    assert.doesNotMatch(card, /<button[^>]*data-task-action/);
    assert.equal((card.match(/<button/g) ?? []).length, 1);

    const empty = renderWorkspacePage('today', planProjection({ tasks: [] }));
    assert.match(empty, /class="week-deadlines-count"><strong>0<\/strong>\/0</);
    assert.match(empty, /本周没有截止的任务。/);
});

test('the 课程 roster is native disclosure rows over the current Term Courses', () => {
    const html = renderWorkspacePage('today');
    const card = html.match(/<section aria-labelledby="today-courses-title"[\s\S]*?<\/section>/)?.[0] ?? '';

    assert.match(card, /class="page-context">2 门 · 本周 2 节</);
    assert.equal((card.match(/<details>/g) ?? []).length, 2);
    assert.match(card, /data-course-color="blue" data-course-id="22222222-2222-4222-8222-222222222222"/);
    assert.match(
        card,
        /class="course-code">CSC108<\/strong><span class="course-name">Introduction to Computer Programming</,
    );
    assert.match(card, /class="course-instructor">Ada Lovelace</);
    assert.match(card, /class="course-summary-meta">周四 · 1 节/);
    assert.match(card, /周四 13:00-14:00<\/span><span>Lecture<\/span><span>BA 1170</);
    assert.match(card, /<dt>教师<\/dt><dd>Ada Lovelace<\/dd>/);
    assert.match(card, /<dt>学分<\/dt><dd>0.5<\/dd>/);
    assert.match(card, /class="course-summary-meta">0 节\/周/);
    assert.match(card, /还没有课节。/);
    assert.doesNotMatch(card, /<dt>Section<\/dt><dd><\/dd>/);
    assert.match(card, /<svg aria-hidden="true" class="course-chevron"/);

    const noCourses = renderToStaticMarkup(createElement(WorkspacePage, {
        ...HANDLERS,
        page: 'today',
        setup: setupProjection({ courses: [] }),
        plan: planProjection(),
        setupIncomplete: false,
    }));
    assert.match(noCourses, /id="today-courses-empty"[^>]*>还没有课程</);
    assert.match(noCourses, />添加课程</);
});

test('the 学期任务 card renders the PLAN per-Course summary with one segment per Course', () => {
    const html = renderWorkspacePage('today');
    const card = html.match(/<section aria-labelledby="today-term-tasks-title"[\s\S]*?<\/section>/)?.[0] ?? '';

    assert.match(card, /class="term-tasks-percent">0%</);
    assert.match(card, /class="page-context">已完成 0 \/ 3 项 · 按课程</);
    assert.match(card, /aria-label="按课程的任务完成度，共 3 项，已完成 0 项"/);
    assert.match(
        card,
        /data-course-color="blue" data-course-id="22222222-2222-4222-8222-222222222222" style="--share:3;--done:0"/,
    );
    // A Course without occurrences is listed at 0/0 but gets no bar segment.
    assert.match(card, /MAT137<\/span><span class="term-tasks-count">0\/0</);
    assert.doesNotMatch(card, /data-course-id="44444444-4444-4444-8444-444444444444" style=/);
    assert.match(card, /class="status-label">TBA 1</);
    assert.doesNotMatch(card, /逾期 \d/);

    const withProgress = renderWorkspacePage('today', planProjection({
        tasks: [SMALL_TASK, WEDNESDAY_ALL_DAY_TASK, { ...LARGE_TASK, status: 'completed', displayProgress: 100 }],
    }));
    const progressed = withProgress.match(
        /<section aria-labelledby="today-term-tasks-title"[\s\S]*?<\/section>/,
    )?.[0] ?? '';
    assert.match(progressed, /class="term-tasks-percent">33%</);
    assert.match(progressed, /style="--share:3;--done:0.333/);
    assert.match(progressed, /data-severity="critical">逾期 1</);

    const empty = renderWorkspacePage('today', planProjection({ tasks: [] }));
    assert.match(empty, /class="term-tasks-percent">0%</);
    assert.match(empty, /id="today-term-tasks-empty"[^>]*>还没有任务</);
});

test('timed deadlines read as TermZone date-times wherever a Task row renders', () => {
    const plan = planProjection({ tasks: [FRIDAY_TIMED_TASK] });
    // Slice 14: a Task row reaches the Calendar through the detail of the day it falls on.
    const calendar = renderCalendarPage(plan, { selectedDate: '2026-09-11' });
    assert.match(calendar, /<time dateTime="2026-09-11T14:00:00.000Z">2026-09-11 10:00<\/time>/);
    assert.doesNotMatch(calendar, /2026-09-11T14:00:00.000Z · America\/Toronto/);
    // Slice 13: the Task page names the day and weekday in the row itself, never behind a tooltip.
    const tasks = renderWorkspacePage('tasks', plan);
    assert.match(tasks, /<time dateTime="2026-09-11T14:00:00.000Z">09-11 周五 10:00<\/time>/);
    assert.doesNotMatch(tasks, /title="2026-09-11|2026-09-11T14:00:00.000Z · America\/Toronto/);
    const dueToday = renderWorkspacePage('today', planProjection({
        tasks: [{
            ...FRIDAY_TIMED_TASK,
            deadline: { kind: 'timed', instant: '2026-09-10T20:00:00.000Z', timeZone: TERM.timeZone },
        }],
    }));
    assert.match(dueToday, /<time dateTime="2026-09-10T20:00:00.000Z">2026-09-10 16:00<\/time>/);
    assert.doesNotMatch(dueToday, /2026-09-10T20:00:00.000Z · America\/Toronto/);
});

test('Today conflict marks come only from the PLAN agenda warnings', () => {
    const withWarnings = planProjection();
    assert.equal(withWarnings.agenda.warnings.length, 1);
    const marked = renderWorkspacePage('today', withWarnings);
    assert.equal((marked.match(/data-conflict="true"/g) ?? []).length, 2);
    assert.match(marked, /class="status-label" data-severity="warning">冲突</);

    // Same overlapping occurrences, no PLAN warning: the Renderer must not invent one.
    const silenced: PlanProjection = {
        ...withWarnings,
        agenda: { ...withWarnings.agenda, warnings: [] },
    };
    const unmarked = renderWorkspacePage('today', silenced);
    assert.doesNotMatch(unmarked, /data-conflict="true"|>冲突</);
    assert.match(unmarked, /data-item-id="meeting:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:2026-09-10"/);
});

test('the dark next-step surface is one card and never repeats one empty sentence', () => {
    const html = renderWorkspacePage('today');

    // D2: one card plus an inner wash, not a card inside a layer inside a card.
    assert.doesNotMatch(html, /emphasis-layer|emphasis-card/);
    assert.doesNotMatch(html, /class="next-task-card"/);
    assert.match(html, /class="content-card next-step-card"[\s\S]*?class="next-step-primary"/);
    assert.match(html, /class="next-step-secondary"/);
    assert.doesNotMatch(html, /下一个小任务|下一个大任务/);

    // D10: both sizes empty collapses to a single block with a single action.
    const empty = renderWorkspacePage('today', planProjection({ tasks: [] }));
    const card = empty.match(
        /<section aria-labelledby="today-next-step-title"[\s\S]*?<\/section>/,
    )?.[0] ?? '';
    assert.equal((card.match(/没有截止时间已知的待完成任务。/g) ?? []).length, 1);
    assert.equal((card.match(/<button/g) ?? []).length, 1);

    // Only one size empty keeps two distinct sentences, never the same line twice.
    const largeOnly = renderWorkspacePage('today', planProjection({ tasks: [LARGE_TASK] }));
    const largeCard = largeOnly.match(
        /<section aria-labelledby="today-next-step-title"[\s\S]*?<\/section>/,
    )?.[0] ?? '';
    assert.match(largeCard, /Draft project outline/);
    assert.match(largeCard, /没有截止时间已知的小任务。/);
    assert.doesNotMatch(largeCard, /没有截止时间已知的大任务。/);
});

test('no Workspace page header renders a kicker above its heading', () => {
    for (const page of ['today', 'courses', 'calendar', 'tasks', 'files'] as const) {
        const html = renderWorkspacePage(page);
        const header = html.match(/<header class="workspace-page-header[\s\S]*?<\/header>/)?.[0]
            ?? '';
        assert.ok(header.length > 0, `${page} must render a page header`);
        assert.doesNotMatch(header, /class="eyebrow"/);
        assert.match(header, /^<header class="workspace-page-header[^"]*"><h1/);
    }
});
test('Today greeting uses the PLAN TermZone when UTC is already on the next date', () => {
    const html = renderWorkspacePage('today', planProjection({
        evaluationContext: {
            ...EVALUATION_CONTEXT,
            evaluatedAt: '2026-09-11T02:00:00.000Z',
        },
    }));

    assert.match(html, /<h1[^>]*>星期四，晚上好<\/h1>/);
    assert.doesNotMatch(html, /星期五|早上好/);
});

test('UI-COURSE-01 a Course card carries identity, its weekly rules, and PLAN completion', () => {
    const html = renderToStaticMarkup(createElement(CoursesPage, {
        ...HANDLERS,
        setup: setupProjection(),
        plan: planProjection(),
        setupIncomplete: false,
    }));

    assert.match(html, /<h1[^>]*>课程<\/h1>/);
    // Header facts: the visible Course count; MAT137 has no credit, so no total can be honest.
    const headline = html.match(/<dl class="page-headline-stats">[\s\S]*?<\/dl>/)?.[0] ?? '';
    assert.match(headline, /<dt>课程<\/dt><dd>2<\/dd>/);
    assert.doesNotMatch(headline, /学分/);
    // Identity: the colour is an attribute, and the heading names the Course by code then name.
    assert.match(
        html,
        new RegExp(
            '<li class="content-card course-card" data-course-color="blue"[^>]*>'
            + '<header class="course-card-header"><h3 class="course-card-heading">'
            + '<span class="course-card-identity"><span aria-hidden="true" class="course-dot"></span>'
            + '<span class="course-card-code">CSC108</span></span>'
            + '<span class="course-card-name">Introduction to Computer Programming</span></h3>'
            + '<p class="course-card-credits">0.5 学分</p>'
            + '<p class="course-card-meta">Ada Lovelace · L0101</p></header>',
        ),
    );
    // The weekly rule keeps its full type name; the room belongs to the Calendar, not to this card.
    assert.match(
        html,
        new RegExp(
            '<p class="course-block-label">每周课节</p><dl class="course-slot-groups">'
            + '<div><dt>Lecture</dt><dd><ul class="course-slot-chips">'
            + '<li>周四 13:00-14:00</li></ul></dd></div></dl>',
        ),
    );
    assert.doesNotMatch(html, /BA 1170/);
    // A teaching range that follows the Term says nothing the header has not said already.
    assert.doesNotMatch(html, /教学范围/);
    // Optional fields nobody filled in stay absent instead of printing a placeholder six times.
    assert.doesNotMatch(html, /未设置/);
    // No chip on a live Term, and no entry the build cannot open.
    assert.doesNotMatch(html, /已归档|>当前<|>编辑</);
    assert.doesNotMatch(html, /course-facts|meeting-rule-list/);
    // Completion is PLAN's own row for this Course: two pending plus one TBA, none finished.
    assert.match(
        html,
        new RegExp(
            '<div class="course-progress"><p class="course-block-label">任务完成度</p>'
            + '<p class="course-progress-count">已完成 0 / 3 项</p>'
            + '<p class="course-progress-note"><span class="status-label">TBA 1</span></p>'
            + '<div aria-hidden="true" class="term-tasks-bar course-progress-bar">'
            + '<span style="--done:0"></span></div></div>',
        ),
    );
    // MAT137 has no Meeting rule, so the card shows that one thing and not a second empty state.
    assert.match(html, /Calculus with Proofs/);
    assert.match(html, /尚未添加课节/);
    assert.doesNotMatch(html, /还没有任务。/);

    const emptyHtml = renderToStaticMarkup(createElement(CoursesPage, {
        ...HANDLERS,
        setup: setupProjection({
            minimum: {
                hasCurrentTerm: true,
                hasCurrentTermCourse: false,
                hasMeetingOrTask: false,
                isSatisfied: false,
            },
            everReachedMinimum: false,
            defaultRoute: 'setup',
            courses: [],
        }),
        plan: null,
        setupIncomplete: true,
    }));
    assert.match(emptyHtml, /当前学期还没有课程/);
    assert.match(emptyHtml, /继续设置/);
    assert.match(emptyHtml, /<button[^>]*type="button"/);

    const noCurrentTermHtml = renderToStaticMarkup(createElement(CoursesPage, {
        ...HANDLERS,
        setup: setupProjection({
            minimum: {
                hasCurrentTerm: false,
                hasCurrentTermCourse: false,
                hasMeetingOrTask: false,
                isSatisfied: false,
            },
            currentTerm: null,
        }),
        plan: null,
        setupIncomplete: true,
    }));
    assert.match(noCurrentTermHtml, /尚无当前学期/);
    assert.match(noCurrentTermHtml, /无法确定要显示哪一组课程/);
    assert.doesNotMatch(noCurrentTermHtml, /Introduction to Computer Programming/);

    const archivedOnlyHtml = renderToStaticMarkup(createElement(CoursesPage, {
        ...HANDLERS,
        setup: setupProjection({
            minimum: {
                hasCurrentTerm: true,
                hasCurrentTermCourse: false,
                hasMeetingOrTask: false,
                isSatisfied: false,
            },
            courses: [{ ...COURSE, archived: true }],
        }),
        plan: null,
        setupIncomplete: true,
    }));
    assert.match(archivedOnlyHtml, /当前学期还没有课程/);
    // The archived Course is real history, so it keeps its own place instead of disappearing.
    const mainGrid = archivedOnlyHtml.slice(0, archivedOnlyHtml.indexOf('<details'));
    assert.doesNotMatch(mainGrid, /Introduction to Computer Programming/);
    assert.match(archivedOnlyHtml, /<details class="course-archive"><summary><span>已归档课程 1 门<\/span>/);
    assert.match(archivedOnlyHtml, /<details[\s\S]*Introduction to Computer Programming/);
});

test('UI-COURSE-01 archived Courses fold under the roster and history is not split twice', () => {
    const archived = { ...COURSE_WITHOUT_MEETINGS, archived: true };
    const html = renderToStaticMarkup(createElement(CoursesPage, {
        ...HANDLERS,
        setup: setupProjection({ courses: [COURSE, archived] }),
        plan: planProjection(),
        setupIncomplete: false,
    }));

    // The grid holds the live Course only, and the header numbers count that same set.
    assert.match(html, /<dt>课程<\/dt><dd>1<\/dd>/);
    assert.match(html, /<dt>学分<\/dt><dd>0.5<\/dd>/);
    const grid = html.match(/<ul class="workspace-grid workspace-grid--courses">[\s\S]*?<\/section>/)?.[0] ?? '';
    assert.match(grid, /CSC108/);
    assert.doesNotMatch(grid, /MAT137/);
    // The disclosure is closed by default and native, so it needs no Renderer state.
    assert.match(html, /<details class="course-archive"><summary><span>已归档课程 1 门<\/span>/);
    assert.doesNotMatch(html, /<details class="course-archive" open/);
    const archive = html.slice(html.indexOf('<details class="course-archive"'));
    assert.match(archive, /MAT137/);
    // Archived is the one Course state a badge still has to carry.
    assert.match(archive, /<p class="status-label" data-severity="neutral">已归档<\/p>/);

    // Nothing archived means no disclosure at all, not an empty one.
    const live = renderToStaticMarkup(createElement(CoursesPage, {
        ...HANDLERS,
        setup: setupProjection(),
        plan: planProjection(),
        setupIncomplete: false,
    }));
    assert.doesNotMatch(live, /course-archive/);

    // History is already history: it stays in one grid and keeps its own badge.
    const historyHtml = renderToStaticMarkup(createElement(CoursesPage, {
        ...HANDLERS,
        setup: setupProjection({
            minimum: {
                hasCurrentTerm: false,
                hasCurrentTermCourse: false,
                hasMeetingOrTask: false,
                isSatisfied: false,
            },
            currentTerm: null,
            courses: [{ ...COURSE, archived: true }],
        }),
        plan: null,
        setupIncomplete: false,
    }));
    assert.match(historyHtml, /<h2[^>]*id="course-list-title">历史课程<\/h2>/);
    assert.doesNotMatch(historyHtml, /course-archive/);
    assert.match(historyHtml, /已归档/);
    assert.doesNotMatch(historyHtml, /添加课程|添加课节/);
});

test('UI-COURSE-01 the header sums credits only when every visible Course carries one', () => {
    const summed = renderToStaticMarkup(createElement(CoursesPage, {
        ...HANDLERS,
        setup: setupProjection({
            courses: [COURSE, { ...COURSE_WITHOUT_MEETINGS, credits: '1.25' }],
        }),
        plan: planProjection(),
        setupIncomplete: false,
    }));
    assert.match(summed, /<dt>课程<\/dt><dd>2<\/dd>/);
    assert.match(summed, /<dt>学分<\/dt><dd>1.75<\/dd>/);

    // One Course without a credit withdraws the whole total instead of counting it as zero.
    const partial = renderToStaticMarkup(createElement(CoursesPage, {
        ...HANDLERS,
        setup: setupProjection(),
        plan: planProjection(),
        setupIncomplete: false,
    }));
    assert.match(partial, /<dt>课程<\/dt><dd>2<\/dd>/);
    assert.doesNotMatch(partial, /<dt>学分<\/dt>/);
    // The Course that does carry one still prints it on its own card.
    assert.match(partial, /<p class="course-card-credits">0.5 学分<\/p>/);

    // The archived Course sits outside the grid, so it is outside the count and the sum.
    const withArchived = renderToStaticMarkup(createElement(CoursesPage, {
        ...HANDLERS,
        setup: setupProjection({
            courses: [COURSE, { ...COURSE, courseId: 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', archived: true }],
        }),
        plan: planProjection(),
        setupIncomplete: false,
    }));
    assert.match(withArchived, /<dt>课程<\/dt><dd>1<\/dd>/);
    assert.match(withArchived, /<dt>学分<\/dt><dd>0.5<\/dd>/);
});

test('A-COURSE-001 the completion meter reads PLAN per-Course counts and degrades honestly', () => {
    // PLAN counts one completed of two countable for this Course; skipped never joins the denominator.
    const plan = planProjection({
        tasks: [
            { ...SMALL_TASK, status: 'completed' },
            LARGE_TASK,
            { ...TBA_TASK, status: 'skipped' as const },
        ],
    });
    const html = renderToStaticMarkup(createElement(CoursesPage, {
        ...HANDLERS,
        setup: setupProjection(),
        plan,
        setupIncomplete: false,
    }));
    assert.match(html, /<p class="course-progress-count">已完成 1 \/ 2 项<\/p>/);
    assert.match(html, /<span style="--done:0.5"><\/span>/);
    assert.doesNotMatch(html, /TBA 1/);

    // A Course PLAN never summarised, but that has rules, says so in one sentence and offers nothing.
    const quiet = renderToStaticMarkup(createElement(CoursesPage, {
        ...HANDLERS,
        setup: setupProjection({ courses: [{ ...COURSE_WITHOUT_MEETINGS, meetings: COURSE.meetings }] }),
        plan: planProjection(),
        setupIncomplete: false,
    }));
    assert.match(quiet, /<p class="course-progress-empty">还没有任务。<\/p>/);
    assert.doesNotMatch(quiet, /course-progress-bar/);

    // Without PLAN the page stays on its setup facts and says once why the meters are gone.
    const unavailable = renderToStaticMarkup(createElement(CoursesPage, {
        ...HANDLERS,
        onRetryPlan(): void {},
        setup: setupProjection(),
        plan: null,
        setupIncomplete: false,
    }));
    assert.match(unavailable, /Introduction to Computer Programming/);
    assert.doesNotMatch(unavailable, /course-progress|计划数据当前不可用|无法显示计划事项/);
    assert.match(
        unavailable,
        new RegExp(
            '<div class="status-banner courses-plan-banner"><p role="status">'
            + '这次没能读到计划，每门课的任务完成度暂时不显示；课程本身的事实照常显示。</p>'
            + '<button class="secondary-action" type="button">重试</button></div>',
        ),
    );
    // No Course, no notice: there is nothing for the missing meters to be missing from.
    const emptyTerm = renderToStaticMarkup(createElement(CoursesPage, {
        ...HANDLERS,
        setup: setupProjection({ courses: [] }),
        plan: null,
        setupIncomplete: false,
    }));
    assert.doesNotMatch(emptyTerm, /courses-plan-banner/);
});

test('UI-COURSE-01 weekly rules merge by clock and only a shortened range is written out', () => {
    const wednesday = {
        ...COURSE.meetings[0],
        meetingSeriesId: '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a',
        weekday: 'WED' as const,
    };
    const shortened = {
        ...COURSE.meetings[0],
        meetingSeriesId: '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b',
        type: { code: 'TUT', name: 'Tutorial' } as const,
        weekday: 'TUE' as const,
        localStart: '22:00',
        localEnd: '01:00',
        endDayOffset: 1 as const,
        effectiveRange: {
            kind: 'explicit' as const,
            startDate: '2026-09-14',
            endDate: '2026-09-18',
        },
    };
    const html = renderToStaticMarkup(createElement(CoursesPage, {
        ...HANDLERS,
        setup: setupProjection({
            courses: [{
                ...COURSE,
                teachingRange: { kind: 'explicit', startDate: TERM.startDate, endDate: '2026-09-18' },
                meetings: [COURSE.meetings[0]!, wednesday, shortened],
            }],
        }),
        plan: planProjection(),
        setupIncomplete: false,
    }));

    // Two rules that share a clock read as one line, in weekday order.
    assert.match(html, /<dt>Lecture<\/dt><dd><ul class="course-slot-chips"><li>周三 四 13:00-14:00<\/li>/);
    // A next-day end stays visible, and only the rule that shortened its own range says so.
    assert.match(
        html,
        /<dt>Tutorial<\/dt><dd><ul class="course-slot-chips"><li>周二 22:00-次日 01:00 · 2026-09-14 起<\/li>/,
    );
    // The Course itself shortened the Term range, so that one line appears.
    assert.match(html, /<p class="course-card-range">教学范围 2026-09-07 - 2026-09-18<\/p>/);
});

test('an ended setup milestone keeps Today and Courses on truthful historical facts', () => {
    const endedTerm = { ...TERM, archived: true };
    const historicalCourse = { ...COURSE, archived: true };
    const endedSetup = setupProjection({
        minimum: {
            hasCurrentTerm: false,
            hasCurrentTermCourse: false,
            hasMeetingOrTask: false,
            isSatisfied: false,
        },
        everReachedMinimum: true,
        defaultRoute: 'today',
        currentTerm: null,
        terms: [endedTerm],
        courses: [historicalCourse],
        holidayRanges: [],
    });
    const todayHtml = renderToStaticMarkup(createElement(TodayPage, {
        ...HANDLERS,
        setup: endedSetup,
        plan: null,
        setupIncomplete: false,
    }));

    assert.match(todayHtml, /学期已结束/);
    assert.match(todayHtml, /Fall 2026/);
    assert.match(todayHtml, /日期进度[^<]*100%/);
    assert.match(todayHtml, /class="primary-action"[^>]*>创建新学期<\/button>/);
    assert.match(todayHtml, /class="secondary-action"[^>]*>查看历史课程<\/button>/);
    assert.doesNotMatch(todayHtml, /计划数据当前不可用|无法显示计划事项/);

    const coursesHtml = renderToStaticMarkup(createElement(CoursesPage, {
        ...HANDLERS,
        setup: endedSetup,
        plan: null,
        setupIncomplete: false,
    }));
    assert.match(coursesHtml, /历史课程/);
    assert.match(coursesHtml, /Introduction to Computer Programming/);
    assert.match(coursesHtml, /已归档/);
    assert.doesNotMatch(coursesHtml, /历史课程不会冒充当前课程/);
});

test('CalendarPage keeps seven day columns and separates the grid, the day detail, and TBA facts', () => {
    const html = renderCalendarPage();

    assert.match(html, /<h1[^>]*>日历<\/h1>/);
    assert.equal((html.match(/class="calendar-day-column"/g) ?? []).length, 7);
    assert.match(html, /class="calendar-scroll-region"/);
    assert.match(html, /2026-09-07/);
    assert.match(html, /2026-09-13/);
    assert.match(html, /Reading Week/);
    assert.match(html, /class="content-card calendar-day-card"/);
    assert.match(html, /时间冲突/);
    assert.match(html, /Confirm research topic/);
    assert.match(html, /TBA/);
    // The header carries the week range and the week load as sums of the PLAN per-day counts.
    assert.match(html, /class="calendar-week-load">2 节课 · 2 项任务</);
    // The whole-week Agenda list is gone: the same facts are the grid and one day's detail.
    assert.doesNotMatch(html, /agenda-date-group|agenda-groups|id="agenda-title"/);

    const onlyTbaHtml = renderCalendarPage(
        planProjection({ tasks: [TBA_TASK], meetings: [], holidayRanges: [] }),
    );
    assert.match(onlyTbaHtml, /当前范围没有已排期事项/);
    assert.match(onlyTbaHtml, /Confirm research topic/);
    // No date-only Task and no visible Holiday: the all-day lane is not drawn at all.
    assert.doesNotMatch(onlyTbaHtml, /class="calendar-all-day-grid"/);
});

test('A-CALENDAR-001: Calendar week controls move the grid without moving today', () => {
    const shifts: number[] = [];
    const nextWeekPlan = planProjection({
        evaluationContext: {
            ...EVALUATION_CONTEXT,
            requestedWindow: { startDate: '2026-09-14', endDate: '2026-09-20' },
        },
    });
    const html = renderToStaticMarkup(createElement(CalendarPage, {
        ...HANDLERS,
        setup: setupProjection(),
        plan: planProjection(),
        setupIncomplete: false,
        calendarWeek: {
            offset: 1,
            busy: false,
            problem: null,
            plan: nextWeekPlan,
            selectedDate: null,
            onSelectDate(): void {},
            onShift(weeks: number): void {
                shifts.push(weeks);
            },
            onReturnToCurrentWeek(): void {},
        },
    }));

    assert.match(html, /aria-label="日历周导航"/);
    assert.match(html, />上一周<\/button>/);
    assert.match(html, />下一周<\/button>/);
    assert.match(html, /<button(?![^>]*disabled)[^>]*>回到本周<\/button>/);
    assert.match(html, /1 周后/);
    assert.match(html, /2026-09-14/);
    assert.match(html, /2026-09-20/);
    // The requested week does not contain the applicable date, so no column claims 今天.
    assert.doesNotMatch(html, /class="calendar-current-label"/);
    assert.deepEqual(shifts, []);

    const currentWeekHtml = renderToStaticMarkup(createElement(CalendarPage, {
        ...HANDLERS,
        setup: setupProjection(),
        plan: planProjection(),
        setupIncomplete: false,
        calendarWeek: {
            offset: 0,
            busy: true,
            problem: '无法读取该周的统一计划投影；正式数据没有改变。',
            plan: null,
            selectedDate: null,
            onSelectDate(): void {},
            onShift(): void {},
            onReturnToCurrentWeek(): void {},
        },
    }));
    assert.match(currentWeekHtml, /正在读取…/);
    assert.match(currentWeekHtml, /<button(?=[^>]*disabled)[^>]*>回到本周<\/button>/);
    assert.match(currentWeekHtml, /无法读取该周的统一计划投影/);
    assert.match(currentWeekHtml, /class="calendar-current-label"/);
});

test('CalendarPage places real items in shared date columns with truthful vertical time and holiday spans', () => {
    const html = renderToStaticMarkup(createElement(CalendarPage, {
        ...HANDLERS,
        setup: setupProjection(),
        plan: planProjection({
            tasks: [WEDNESDAY_ALL_DAY_TASK, FRIDAY_TIMED_TASK],
            meetings: [TUESDAY_MEETING],
            holidayRanges: [MONDAY_TO_WEDNESDAY_HOLIDAY],
        }),
        setupIncomplete: false,
    }));

    assert.match(
        html,
        new RegExp(
            'data-item-id="meeting:dddddddd-dddd-4ddd-8ddd-dddddddddddd:2026-09-08"'
            + '[^>]*data-calendar-date="2026-09-08"[^>]*data-start-minute="540"'
            + '[^>]*data-duration-minutes="90"',
        ),
    );
    assert.match(
        html,
        new RegExp(
            'data-item-id="task:12121212-1212-4212-8212-121212121212:once"'
            + '[^>]*data-calendar-date="2026-09-09"',
        ),
    );
    assert.match(
        html,
        new RegExp(
            'data-item-id="task:13131313-1313-4313-8313-131313131313:once"'
            + '[^>]*data-calendar-date="2026-09-11"[^>]*data-start-minute="600"'
            + '[^>]*data-duration-minutes="30"',
        ),
    );
    assert.match(
        html,
        new RegExp(
            'data-item-id="holiday:ffffffff-ffff-4fff-8fff-ffffffffffff:2026-09-07:2026-09-09"'
            + '[^>]*data-start-column="1"[^>]*data-end-column="4"',
        ),
    );
});

test('the Calendar hour band defaults to 07:00–22:00 and widens for real outliers', () => {
    const html = renderWorkspacePage('calendar');

    assert.match(html, /class="calendar-hour-band-probe"|--calendar-hour-count:\s*15/);
    assert.match(html, />07:00<\/li>/);
    assert.match(html, />21:00<\/li>/);
    assert.doesNotMatch(html, />00:00<\/li>/);
    assert.doesNotMatch(html, />23:00<\/li>/);
    // 13:00 sits six hours into the band, not thirteen.
    assert.match(html, /--calendar-event-top:\s*198px/);

    const lateMeeting = {
        ...TODAY_MEETING,
        occurrenceId: {
            meetingSeriesId: '19191919-1919-4919-8919-191919191919',
            originalLogicalAnchor: '2026-09-10',
        },
        segmentId: '20202020-2020-4020-8020-202020202020',
        localStart: '22:30',
        localEnd: '23:30',
        startInstant: '2026-09-11T02:30:00.000Z',
        endInstant: '2026-09-11T03:30:00.000Z',
    };
    const widened = renderToStaticMarkup(createElement(CalendarPage, {
        ...HANDLERS,
        setup: setupProjection(),
        plan: planProjection({ meetings: [lateMeeting], tasks: [], holidayRanges: [] }),
        setupIncomplete: false,
    }));
    // A real 22:30 item is never hidden; the band grows to contain it.
    assert.match(widened, />22:00<\/li>/);
    assert.match(widened, />23:00<\/li>/);
    assert.match(widened, /--calendar-hour-count:\s*17/);
});

test('CalendarPage gives every simultaneous item a visible lane and names one day in its detail', () => {
    const html = renderToStaticMarkup(createElement(CalendarPage, {
        ...HANDLERS,
        setup: setupProjection(),
        plan: planProjection({
            meetings: [TODAY_MEETING, OVERLAPPING_MEETING, THIRD_OVERLAPPING_MEETING],
            holidayRanges: [PRE_WINDOW_HOLIDAY],
        }),
        setupIncomplete: false,
    }));

    assert.match(
        html,
        new RegExp(
            'data-item-id="meeting:33333333-3333-4333-8333-333333333333:2026-09-10"[^>]*'
            + 'data-overlap-lane="0"[^>]*data-overlap-lane-count="3"',
        ),
    );
    assert.match(
        html,
        new RegExp(
            'data-item-id="meeting:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:2026-09-10"[^>]*'
            + 'data-overlap-lane="1"[^>]*data-overlap-lane-count="3"',
        ),
    );
    assert.match(
        html,
        new RegExp(
            'data-item-id="meeting:14141414-1414-4414-8414-141414141414:2026-09-10"[^>]*'
            + 'data-overlap-lane="2"[^>]*data-overlap-lane-count="3"',
        ),
    );
    // One panel, one day: the detail names the selected day and nothing else.
    assert.equal((html.match(/data-agenda-date="2026-09-10"/g) ?? []).length, 1);
    assert.match(html, /id="calendar-day-title">周四 <time dateTime="2026-09-10">09-10<\/time>/);
    assert.doesNotMatch(html, /data-agenda-date="2026-09-07"|data-agenda-date="2026-09-01"/);
});

test('CalendarPage lanes adjacent short items by their rendered minimum height', () => {
    const html = renderToStaticMarkup(createElement(CalendarPage, {
        ...HANDLERS,
        setup: setupProjection(),
        plan: planProjection({
            tasks: [FRIDAY_TIMED_TASK, FRIDAY_ADJACENT_TASK],
            meetings: [],
            holidayRanges: [],
        }),
        setupIncomplete: false,
    }));

    assert.match(
        html,
        /task:13131313-1313-4313-8313-131313131313:once[^>]*data-overlap-lane="0"[^>]*data-overlap-lane-count="2"/,
    );
    assert.match(
        html,
        /task:17171717-1717-4717-8717-171717171717:once[^>]*data-overlap-lane="1"[^>]*data-overlap-lane-count="2"/,
    );
});

test('UI-CALENDAR-02 the selected day only chooses which day the detail reads', () => {
    const writes: string[] = [];
    const plan = planProjection();
    const detail = (html: string): string => (
        html.match(/<section aria-labelledby="calendar-day-title"[\s\S]*?<\/section>/)?.[0] ?? ''
    );

    // No held day: the detail opens on today and reads today's own PLAN facts.
    const thursday = renderCalendarPage(plan, { onSelectDate: date => writes.push(date) });
    assert.match(thursday, /data-agenda-date="2026-09-10"/);
    assert.match(detail(thursday), /class="page-context">2 节课 · 1 项任务</);
    assert.match(detail(thursday), /Read chapter one/);
    assert.doesNotMatch(detail(thursday), /Draft project outline/);

    // Another day swaps the panel and nothing else: 今天 and the header numbers stay put.
    const friday = renderCalendarPage(plan, { selectedDate: '2026-09-11' });
    assert.match(friday, /data-agenda-date="2026-09-11"/);
    assert.match(detail(friday), /Draft project outline/);
    assert.doesNotMatch(detail(friday), /Read chapter one/);
    assert.equal((friday.match(/class="calendar-current-label"/g) ?? []).length, 1);
    assert.match(friday, /class="calendar-week-load">2 节课 · 2 项任务</);
    assert.match(friday, /class="page-context">0 节课 · 1 项任务</);

    // A day inside the week with nothing on it says so and offers the way back to today.
    const tuesday = renderCalendarPage(plan, { selectedDate: '2026-09-08' });
    assert.match(detail(tuesday), /id="calendar-day-empty"[^>]*>这一天没有已排期事项/);
    assert.match(detail(tuesday), /这一周还有 2 节课和 2 项任务/);
    assert.match(detail(tuesday), /<button[^>]*>看今天<\/button>/);
    // Rendering never writes the view state.
    assert.deepEqual(writes, []);
});

test('A-CALENDAR-001 the day tablist is one Tab stop and its selection resets with the week', () => {
    const html = renderCalendarPage();
    const tabs = html.match(/<button aria-controls="calendar-day-detail"[^>]*>/g) ?? [];

    assert.match(html, /role="tablist"/);
    assert.match(html, /id="calendar-day-detail"[^>]*role="tabpanel"/);
    assert.equal(tabs.length, 7);
    // One radio-style Tab stop: only the selected head is in the tab order.
    assert.equal(tabs.filter(tab => tab.includes('tabindex="0"')).length, 1);
    assert.match(tabs[3] ?? '', /aria-current="date" aria-selected="true"[^>]*data-selected="true"/);
    assert.match(tabs[0] ?? '', /aria-selected="false"[^>]*tabindex="-1"/);
    assert.match(html, /class="calendar-day-weekday">周一<\/span><time dateTime="2026-09-07">09-07</);

    // A held day from last week cannot survive into a week that does not draw it.
    const nextWeek = planProjection({
        evaluationContext: {
            ...EVALUATION_CONTEXT,
            requestedWindow: { startDate: '2026-09-14', endDate: '2026-09-20' },
        },
    });
    const moved = renderCalendarPage(planProjection(), {
        offset: 1,
        plan: nextWeek,
        selectedDate: '2026-09-10',
    });
    assert.match(moved, /data-agenda-date="2026-09-14"/);
    assert.doesNotMatch(moved, /class="calendar-current-label"/);
});

test('the Calendar conflict chip and the warning ground come only from the PLAN agenda warnings', () => {
    const marked = renderCalendarPage();

    assert.match(
        marked,
        /<button class="status-label calendar-conflict-chip" data-severity="warning" type="button">1 组时间冲突<\/button>/,
    );
    // Both overlapping Meetings say 冲突 in words, not only in their warning ground.
    assert.equal((marked.match(/data-conflict="true"/g) ?? []).length, 2);
    assert.match(marked, /冲突 · 13:00-14:00 · /);
    assert.match(marked, /data-course-color="blue"/);

    // One Meeting cannot overlap itself: no chip, no warning ground, no invented count.
    const silent = renderCalendarPage(planProjection({ meetings: [TODAY_MEETING] }));
    assert.doesNotMatch(silent, /calendar-conflict-chip|组时间冲突|data-conflict="true"/);
});

test('TasksPage groups known PLAN tasks by their classification and keeps TBA in its own card', () => {
    const html = renderToStaticMarkup(createElement(TasksPage, {
        ...HANDLERS,
        setup: setupProjection(),
        plan: planProjection(),
        setupIncomplete: false,
    }));

    assert.match(html, /<h1[^>]*>任务<\/h1>/);
    // Header numbers are PLAN sums: two pending rows with a deadline plus one TBA, no overdue, two due this week.
    const headline = html.match(/<dl class="page-headline-stats">[\s\S]*?<\/dl>/)?.[0] ?? '';
    assert.match(headline, /待完成<\/dt><dd>3</);
    assert.match(headline, /data-severity="neutral"><dt>逾期<\/dt><dd>0</);
    assert.match(headline, /本周截止<\/dt><dd>2</);
    // Facts and the page action share the header's right-hand container instead of overlapping the title.
    assert.match(
        html,
        new RegExp(
            '<div class="workspace-page-side"><div class="workspace-page-facts">[\\s\\S]*?</div>'
            + '<div class="workspace-page-actions"><button class="primary-action" type="button">添加任务</button>',
        ),
    );

    const card = html.match(/<section aria-labelledby="task-groups-title"[\s\S]*?<\/section>/)?.[0] ?? '';
    assert.match(
        card,
        new RegExp(
            '<h3 class="task-group-title" data-severity="warning" id="task-group-today">今天 '
            + '<span class="task-group-count">1 项</span></h3>'
            + '<ol aria-labelledby="task-group-today" class="task-rows">',
        ),
    );
    assert.match(card, /id="task-group-near-due">即将到期 <span class="task-group-count">1 项<\/span>/);
    assert.doesNotMatch(card, /task-group-overdue|task-group-future|task-archive/);
    // The heading names the state, so no row repeats it as a chip; the deadline is the row's fact.
    assert.doesNotMatch(card, /class="status-label"/);
    assert.match(card, /Read chapter one[\s\S]*?<time dateTime="2026-09-10">今天<\/time>/);
    assert.match(card, /Draft project outline[\s\S]*?<time dateTime="2026-09-11">09-11 周五<\/time>/);
    assert.match(card, /<span class="task-row-meta"><span>CSC108 · 小任务<\/span><\/span>/);
    assert.doesNotMatch(card, /Confirm research topic/);

    const tba = html.match(/<section aria-labelledby="tba-tasks-title"[\s\S]*?<\/section>/)?.[0] ?? '';
    assert.match(tba, /<h2 id="tba-tasks-title">TBA<\/h2><p class="page-context">1 项<\/p>/);
    assert.match(tba, /还没定日期或时间，不算倒计时，也不会逾期。/);
    assert.match(tba, /Confirm research topic/);
    assert.equal((html.match(/Confirm research topic/g) ?? []).length, 1);
    assert.match(html, /<section aria-labelledby="tasks-by-course-title" class="content-card by-course-card">/);

    const emptyHtml = renderToStaticMarkup(createElement(TasksPage, {
        ...HANDLERS,
        setup: setupProjection(),
        plan: planProjection({ tasks: [], meetings: [], holidayRanges: [] }),
        setupIncomplete: false,
    }));
    assert.match(emptyHtml, /id="task-groups-empty"[^>]*>当前学期还没有任务</);
    assert.match(emptyHtml, /给课程添加作业、测验或项目，它们会按截止时间排在这里。/);
    assert.match(
        emptyHtml,
        /id="task-groups-empty"[\s\S]*?<button[^>]*>添加任务<\/button><button[^>]*>查看课程<\/button>/,
    );
    assert.match(emptyHtml, /待完成<\/dt><dd>0</);
    // Nothing to summarise: the right column and the filter are not rendered at all.
    assert.doesNotMatch(emptyHtml, /tasks-by-course-title|tba-tasks-title|task-filter/);
});

test('the Task page orders groups and rows by PLAN facts and folds finished rows', () => {
    const finished = {
        ...SMALL_TASK,
        occurrenceId: { ...SMALL_TASK.occurrenceId, taskSeriesId: '18181818-1818-4818-8818-181818181818' },
        title: 'Finished reading',
        status: 'completed' as const,
    };
    const finishedTba = {
        ...TBA_TASK,
        occurrenceId: { ...TBA_TASK.occurrenceId, taskSeriesId: '21212121-2121-4121-8121-212121212121' },
        title: 'Finished TBA reading',
        status: 'completed' as const,
    };
    const skipped = {
        ...SMALL_TASK,
        occurrenceId: { ...SMALL_TASK.occurrenceId, taskSeriesId: '22222222-2222-4222-8222-222222222223' },
        title: 'Skipped warm-up',
        status: 'skipped' as const,
    };
    const dueTodayTimed = {
        ...FRIDAY_TIMED_TASK,
        occurrenceId: { ...FRIDAY_TIMED_TASK.occurrenceId, taskSeriesId: '23232323-2323-4323-8323-232323232323' },
        title: 'Timed today',
        deadline: { kind: 'timed' as const, instant: '2026-09-10T20:00:00.000Z', timeZone: TERM.timeZone },
    };
    const farReport = taskOccurrence({
        taskSeriesId: '24242424-2424-4424-8424-242424242424',
        title: 'Far report',
        size: 'large',
        deadline: { kind: 'date-only', date: '2026-09-19' },
    });
    const html = renderWorkspacePage('tasks', planProjection({
        tasks: [LARGE_TASK, FRIDAY_TIMED_TASK, WEDNESDAY_ALL_DAY_TASK, TBA_TASK, finished, finishedTba, skipped,
            dueTodayTimed, farReport],
    }));
    const card = html.match(/<section aria-labelledby="task-groups-title"[\s\S]*?<\/section>/)?.[0] ?? '';

    // Groups in reading order, each exactly one PLAN classification; finished rows fold last.
    const order = [
        'task-group-overdue',
        'task-group-today',
        'task-group-near-due',
        'task-group-future',
        'class="task-archive"',
        'task-group-completed',
        'task-group-skipped',
    ].map(marker => card.indexOf(marker));
    assert.ok(order.every(position => position >= 0), 'every group and the archive must render');
    assert.deepEqual(order.toSorted((left, right) => left - right), order);

    // Overdue keeps the original deadline and says how many days have passed.
    assert.match(
        card,
        new RegExp(
            'data-classification="overdue"[\\s\\S]*?Submit lab notes[\\s\\S]*?'
            + '<time dateTime="2026-09-09">09-09 周三</time><span class="task-row-overdue">逾期 1 天</span>',
        ),
    );
    // Under the 今天 heading a timed row shows only the clock.
    assert.match(card, /data-classification="today"[\s\S]*?<time dateTime="2026-09-10T20:00:00.000Z">16:00<\/time>/);
    // Inside 即将到期 PLAN's comparator puts Friday 10:00 before the date-only Friday deadline.
    const nearDue = card.match(/data-classification="near-due"[\s\S]*?<\/ol>/)?.[0] ?? '';
    assert.match(nearDue, /Project checkpoint[\s\S]*?Draft project outline/);
    assert.match(
        card,
        /data-classification="future"[\s\S]*?Far report[\s\S]*?<time dateTime="2026-09-19">09-19 周六<\/time>/,
    );
    // Finished rows fold into one native disclosure; a completed TBA task lives there, not in the TBA card.
    assert.match(card, new RegExp(
        '<details class="task-archive"><summary><span>已完成 2 项 · 已跳过 1 项</span>'
        + '<svg aria-hidden="true" class="course-chevron"',
    ));
    assert.match(
        card,
        new RegExp(
            'data-classification="completed"[\\s\\S]*?Finished TBA reading[\\s\\S]*?'
            + '<span class="task-row-deadline"><span>TBA</span></span>',
        ),
    );
    assert.equal((html.match(/Finished TBA reading/g) ?? []).length, 1);
    const tba = html.match(/<section aria-labelledby="tba-tasks-title"[\s\S]*?<\/section>/)?.[0] ?? '';
    assert.match(tba, /<p class="page-context">1 项<\/p>/);
    assert.doesNotMatch(tba, /Finished TBA reading/);
    // 逾期 in the header equals the overdue group and turns critical; 待完成 counts the TBA row too.
    const headline = html.match(/<dl class="page-headline-stats">[\s\S]*?<\/dl>/)?.[0] ?? '';
    assert.match(headline, /待完成<\/dt><dd>6</);
    assert.match(headline, /data-severity="critical"><dt>逾期<\/dt><dd>1</);
    assert.match(headline, /本周截止<\/dt><dd>6</);

    // The label ladder's other rungs: a timed deadline passed earlier today reads 今天 HH:mm with no
    // day count, and a deadline in another year carries its full date.
    const ladder = renderWorkspacePage('tasks', planProjection({
        tasks: [
            {
                ...FRIDAY_TIMED_TASK,
                deadline: { kind: 'timed' as const, instant: '2026-09-10T12:00:00.000Z', timeZone: TERM.timeZone },
            },
            { ...LARGE_TASK, deadline: { kind: 'date-only' as const, date: '2027-01-05' } },
        ],
    }));
    assert.match(
        ladder,
        /data-classification="overdue"[\s\S]*?<time dateTime="2026-09-10T12:00:00.000Z">今天 08:00<\/time><\/span>/,
    );
    assert.match(ladder, /data-classification="future"[\s\S]*?<time dateTime="2027-01-05">2027-01-05 周二<\/time>/);
    assert.match(ladder, /data-severity="critical"><dt>逾期<\/dt><dd>1</);

    // The folded groups run newest first with TBA last: 09-11, then 09-09, then the TBA deadline.
    const folded = renderWorkspacePage('tasks', planProjection({
        tasks: [
            SMALL_TASK,
            { ...LARGE_TASK, status: 'completed' },
            { ...WEDNESDAY_ALL_DAY_TASK, status: 'completed' },
            { ...TBA_TASK, status: 'completed' },
        ],
    }));
    const foldedCompleted = folded.match(/data-classification="completed"[\s\S]*?<\/ol>/)?.[0] ?? '';
    assert.match(foldedCompleted, /Draft project outline[\s\S]*?Submit lab notes[\s\S]*?Confirm research topic/);
});

test('the Task page filter only hides rows and never changes a PLAN number', () => {
    const render = (
        filter: TaskListFilter,
        plan = planProjection(),
        writes: TaskListFilter[] = [],
    ): string => renderToStaticMarkup(createElement(TasksPage, {
        ...HANDLERS,
        setup: setupProjection(),
        plan,
        setupIncomplete: false,
        taskList: {
            filter,
            onFilterChange(next): void {
                writes.push(next);
            },
        },
    }));

    const chip = (checked: boolean, label: string): RegExp => new RegExp(
        `<button aria-checked="${checked}" class="task-filter-chip" role="radio" `
        + `tabindex="${checked ? 0 : -1}" type="button">${label}</button>`,
    );
    const large = render({ kind: 'size', size: 'large' });
    // One radio group, one Tab stop: the checked chip is the only one in the tab order.
    assert.match(large, /<div aria-label="筛选任务" class="task-filter" role="radiogroup">/);
    assert.match(large, chip(false, '全部'));
    assert.match(large, chip(true, '大任务'));
    assert.match(large, new RegExp(
        'class="task-filter-chip task-filter-chip--course" role="radio" tabindex="-1" type="button">'
        + '<span aria-hidden="true" class="course-dot" data-course-color="blue"></span>CSC108</button>',
    ));
    // A Course without any Task occurrence gets no chip.
    assert.doesNotMatch(large, /MAT137<\/button>/);
    assert.match(large, /<p class="page-context task-filter-summary" role="status">大任务 · 显示 1 \/ 2 项<\/p>/);
    assert.match(large, /Draft project outline/);
    assert.doesNotMatch(large, /Read chapter one/);
    // The header keeps its PLAN sums whatever the filter shows.
    assert.match(large, /待完成<\/dt><dd>3</);
    // The TBA card is narrowed too and says so, while its heading count stays the PLAN fact.
    assert.match(large, /<h2 id="tba-tasks-title">TBA<\/h2><p class="page-context">显示 0 \/ 1 项<\/p>/);
    assert.match(large, /当前筛选下没有 TBA 任务。/);

    const course = render({ kind: 'course', courseId: COURSE.courseId });
    assert.match(course, /role="status">CSC108 · 显示 2 \/ 2 项</);
    assert.match(course, /<p class="page-context">显示 1 \/ 1 项<\/p>/);
    // The 按课程 shares echo the checked Course with a ring and with words.
    assert.match(
        course,
        /data-course-id="22222222-2222-4222-8222-222222222222" data-selected="true" style="--share:3;--done:0"/,
    );
    assert.match(course, /aria-label="按课程的任务完成度，共 3 项，已完成 0 项，已筛选 CSC108"/);
    assert.match(course, new RegExp(
        'data-selected="true"><span aria-hidden="true" class="course-dot"></span><span>CSC108</span>'
        + '<span class="term-tasks-count">0/3</span><span class="visually-hidden">已筛选</span>',
    ));

    // A Course the page no longer offers falls back to 全部 at render time, without a state write.
    const writes: TaskListFilter[] = [];
    const stale = render({ kind: 'course', courseId: COURSE_WITHOUT_MEETINGS.courseId }, planProjection(), writes);
    assert.match(stale, chip(true, '全部'));
    assert.match(stale, /role="status">共 2 项</);
    assert.doesNotMatch(stale, /data-selected/);
    assert.deepEqual(writes, []);

    // A filter that hides every pending row keeps one sentence and the way back.
    const hidden = render({ kind: 'size', size: 'small' }, planProjection({ tasks: [LARGE_TASK] }));
    assert.match(hidden, new RegExp(
        '<div class="task-filter-empty"><p>当前筛选下没有待完成任务。</p>'
        + '<button class="secondary-action" type="button">清除筛选</button></div>',
    ));
    assert.match(hidden, /role="status">小任务 · 显示 0 \/ 1 项</);

    // Group and archive counts are visible rows, not PLAN totals: two near-due rows, one shown.
    const narrowed = render({ kind: 'size', size: 'large' }, planProjection({
        tasks: [
            SMALL_TASK,
            LARGE_TASK,
            FRIDAY_ADJACENT_TASK,
            {
                ...SMALL_TASK,
                occurrenceId: { ...SMALL_TASK.occurrenceId, taskSeriesId: '25252525-2525-4525-8525-252525252525' },
                status: 'completed',
            },
            {
                ...LARGE_TASK,
                occurrenceId: { ...LARGE_TASK.occurrenceId, taskSeriesId: '26262626-2626-4626-8626-262626262626' },
                status: 'skipped',
            },
        ],
    }));
    assert.match(narrowed, /id="task-group-near-due">即将到期 <span class="task-group-count">1 项<\/span>/);
    assert.match(narrowed, /role="status">大任务 · 显示 1 \/ 3 项</);
    assert.match(narrowed, /<details class="task-archive"><summary><span>已完成 0 项 · 已跳过 1 项<\/span>/);
    assert.doesNotMatch(narrowed, /Adjacent checkpoint|task-group-today|task-group-completed/);
    // The disclosure stays mounted when the filter hides every archived row.
    const archiveHidden = render({ kind: 'size', size: 'small' }, planProjection({
        tasks: [SMALL_TASK, { ...LARGE_TASK, status: 'completed' }],
    }));
    assert.match(archiveHidden, /<details class="task-archive"><summary><span>已完成 0 项 · 已跳过 0 项<\/span>/);
    assert.match(archiveHidden, /当前筛选下没有已完成或已跳过的任务。/);

    // Without a filter presentation the page renders no chips and no status line.
    assert.doesNotMatch(renderWorkspacePage('tasks'), /task-filter/);
});

test('the Task page empty ladder names the missing object and one real next step', () => {
    const noCourses = renderToStaticMarkup(createElement(TasksPage, {
        ...HANDLERS,
        setup: setupProjection({
            minimum: {
                hasCurrentTerm: true,
                hasCurrentTermCourse: false,
                hasMeetingOrTask: false,
                isSatisfied: false,
            },
            courses: [],
        }),
        plan: planProjection({ tasks: [], meetings: [], holidayRanges: [] }),
        setupIncomplete: true,
    }));
    const noCoursesCard = noCourses.match(/<section aria-labelledby="task-groups-title"[\s\S]*?<\/section>/)?.[0] ?? '';
    assert.match(noCoursesCard, /id="task-groups-empty"[^>]*>还没有课程</);
    assert.match(noCoursesCard, /先添加一门课程，任务会挂在它下面。/);
    assert.equal((noCoursesCard.match(/<button/g) ?? []).length, 1);
    assert.match(noCoursesCard, />添加课程</);

    const beforeTerm = renderWorkspacePage('tasks', planProjection({
        tasks: [],
        meetings: [],
        evaluationContext: {
            evaluatedAt: '2026-09-01T16:00:00.000Z',
            termZone: TERM.timeZone,
            applicableDate: '2026-09-01',
            requestedWindow: { startDate: '2026-08-31', endDate: '2026-09-06' },
        },
    }));
    assert.match(beforeTerm, /学期 2026-09-07 开始，还没有任务。/);

    const done = renderWorkspacePage('tasks', planProjection({
        tasks: [{ ...SMALL_TASK, status: 'completed' }, { ...LARGE_TASK, status: 'skipped' }],
    }));
    assert.match(done, /id="task-groups-empty"[^>]*>没有待完成的任务</);
    assert.match(done, /本学期的任务都已完成或跳过。/);
    assert.match(done, /已完成 1 项 · 已跳过 1 项/);
    assert.match(done, /待完成<\/dt><dd>0</);
    assert.match(done, /<p class="task-rows-empty">每个任务都有日期了。<\/p>/);

    const tbaOnly = renderWorkspacePage('tasks', planProjection({ tasks: [TBA_TASK] }));
    assert.match(tbaOnly, /还有 1 项没定时间的任务在 TBA 里。/);
    assert.match(tbaOnly, /<a class="secondary-action" href="#tba-task-list">查看 TBA 任务<\/a>/);
    assert.match(tbaOnly, /待完成<\/dt><dd>1</);
    assert.match(
        tbaOnly,
        /<section aria-labelledby="tba-tasks-title" class="content-card tba-tasks-card" id="tba-task-list">/,
    );
});

test('Today task empty state exposes the real supplemental Task editor action', () => {
    const html = renderToStaticMarkup(createElement(TodayPage, {
        ...HANDLERS,
        setup: setupProjection(),
        plan: planProjection({ tasks: [], meetings: [], holidayRanges: [] }),
        setupIncomplete: false,
    }));

    assert.match(
        html,
        /id="today-tasks-empty"[\s\S]*?<button[^>]*>添加任务<\/button>/,
    );
    assert.match(html, /id="today-tasks-empty"[\s\S]*?>查看任务<\/button>/);
    assert.doesNotMatch(html, /today-attention-title|查看 TBA 任务/);
});

test('Today and Tasks expose persistent direct actions with one non-focus-stealing Undo surface', () => {
    const tasksHtml = renderToStaticMarkup(createElement(TasksPage, {
        ...HANDLERS,
        setup: setupProjection(),
        plan: planProjection(),
        setupIncomplete: false,
        taskActions: TASK_ACTIONS,
    }));
    assert.equal((tasksHtml.match(/>完成<\/button>/g) ?? []).length, 3);
    assert.equal((tasksHtml.match(/>跳过<\/button>/g) ?? []).length, 3);
    assert.match(
        tasksHtml,
        /<li data-item-id="task:[^"]+" tabindex="-1">[\s\S]*?data-task-action="complete"/,
    );

    const todayHtml = renderToStaticMarkup(createElement(TodayPage, {
        ...HANDLERS,
        setup: setupProjection(),
        plan: planProjection(),
        setupIncomplete: false,
        taskActions: TASK_ACTIONS,
    }));
    assert.match(todayHtml, /data-task-action="complete"/);
    assert.match(todayHtml, /data-task-action="skip"/);

    const feedbackHtml = renderToStaticMarkup(createElement(TaskActionNotice, {
        presentation: TASK_ACTIONS,
    }));
    assert.match(feedbackHtml, /任务状态已保存。/);
    assert.match(feedbackHtml, /<button[^>]*>撤销<\/button>/);
    assert.match(feedbackHtml, /aria-live="polite"/);
    assert.doesNotMatch(feedbackHtml, /autofocus/);

    const lockedHtml = renderToStaticMarkup(createElement(TasksPage, {
        ...HANDLERS,
        setup: setupProjection(),
        plan: planProjection(),
        setupIncomplete: false,
        taskActions: {
            ...TASK_ACTIONS,
            canRunAction(_task, action): boolean {
                return action === 'complete';
            },
        },
    }));
    assert.match(lockedHtml, /data-task-action="complete"/);
    assert.match(lockedHtml, /data-task-action="skip" disabled=""/);
});

test('unknown Undo feedback offers only an exact retry without success copy', () => {
    const html = renderToStaticMarkup(createElement(TaskActionNotice, {
        presentation: {
            ...TASK_ACTIONS,
            problem: '无法连接本地 Workspace；撤销提交结果尚无法确认。',
            undo: {
                actionLabel: '精确重试撤销',
                message: '撤销结果尚无法确认；请精确重试本次撤销请求。',
                submitting: false,
            },
        },
    }));

    assert.match(html, /撤销结果尚无法确认/);
    assert.match(html, /<button[^>]*>精确重试撤销<\/button>/);
    assert.doesNotMatch(html, /任务状态已保存|6 秒/);
});

test('a missing PLAN projection is unavailable rather than a fabricated empty list', () => {
    const pages = [TodayPage, CalendarPage, TasksPage];

    for (const Page of pages) {
        const html = renderToStaticMarkup(createElement(Page, {
            ...HANDLERS,
            setup: setupProjection(),
            plan: null,
            setupIncomplete: false,
        }));

        assert.match(html, /计划数据当前不可用/);
        assert.match(html, /无法判断今天到底有没有事/);
        assert.doesNotMatch(
            html,
            /今天没有课节|今天没有要交的任务|当前范围没有已排期事项|当前学期还没有任务/,
        );
    }

    const retryHtml = renderToStaticMarkup(createElement(CalendarPage, {
        ...HANDLERS,
        setup: setupProjection(),
        plan: null,
        planProblem: '统一计划读取失败，请重试。',
        setupIncomplete: false,
        onRetryPlan(): void {},
    }));
    assert.match(retryHtml, /统一计划读取失败，请重试。/);
    assert.match(retryHtml, /<button[^>]*>重试<\/button>/);
});

test('FilesPage reports unavailable library facts and exposes only executable bounded exits', () => {
    const html = renderWorkspacePage('files', null, true);

    assert.match(html, /<h1[^>]*>文件<\/h1>/);
    assert.match(html, /当前 Workspace 没有提供资料库投影，因此不能判断文件列表是否为空。/);
    assert.match(html, /返回 Today/);
    assert.match(html, /继续设置/);
    assert.equal((html.match(/<button/g) ?? []).length, 2);
    assert.doesNotMatch(html, /即将推出|示例文件|模拟文件|添加文件|打开目录|重新扫描/);
    assert.doesNotMatch(html, /出席|缺席|成绩|备份|保护|Attendance|Grade|Protect/);

    assert.equal(typeof FilesPage, 'function');
    assert.equal(typeof WorkspacePage, 'function');
});
