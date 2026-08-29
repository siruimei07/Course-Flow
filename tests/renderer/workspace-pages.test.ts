/**
 * @file Verifies the five Workspace presentation pages against real setup and PLAN projections.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ManagementSurfaceId } from '../../src/renderer/management-surfaces';
import type { WorkspaceNavigationId } from '../../src/renderer/navigation';
import {
    CalendarPage,
    CoursesPage,
    FilesPage,
    TaskActionNotice,
    TasksPage,
    TodayPage,
    WorkspacePage,
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

test('TodayPage renders only real unified Today, Week, next-task, and term-progress facts', () => {
    const html = renderWorkspacePage('today', planProjection(), true);

    assert.match(html, />Today<\/p>/);
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
    assert.match(html, /class="content-card emphasis-card"[^>]*><div class="emphasis-layer"/);
    assert.match(html, /id="today-tba-title"[^>]*>待确定<\/h2>/);
    assert.match(html, /1 项时间待确定的任务/);
    assert.match(html, /<button[^>]*>查看 TBA 任务<\/button>/);
    const tbaSection = html.match(
        /<section aria-labelledby="today-tba-title"[\s\S]*?<\/section>/,
    )?.[0] ?? '';
    assert.doesNotMatch(tbaSection, /<time|2026-09-/);
    assert.doesNotMatch(html, /出席|缺席|成绩|备份|保护|Attendance|Grade|Protect/);

    assert.equal(typeof TodayPage, 'function');
});

test('Today opens on one stat bar over a two-column dashboard', () => {
    const html = renderWorkspacePage('today');

    // The Current Term name stays visible on the home page.
    assert.match(html, /class="page-context">Fall 2026 · 2026-09-07 – 2026-09-20</);
    const statBar = html.match(
        /<section aria-labelledby="today-summary-title"[\s\S]*?<\/section>/,
    )?.[0] ?? '';
    assert.match(statBar, /当前学期课程<\/dt><dd>2</);
    assert.match(statBar, /今日课节<\/dt><dd>2</);
    assert.match(statBar, /今日待完成<\/dt><dd>\d/);
    assert.match(statBar, /今日已完成<\/dt><dd>\d/);
    assert.match(statBar, /学期日期进度/);

    // The stat bar precedes the two columns, and each column owns its own cards.
    const columns = html.match(/class="today-column[^"]*"/g) ?? [];
    assert.equal(columns.length, 2);
    assert.ok(html.indexOf('today-summary-title') < html.indexOf('today-column'));
    const primary = html.slice(
        html.indexOf('class="today-column"'),
        html.indexOf('class="today-column today-column--secondary"'),
    );
    assert.match(primary, /id="today-meetings-title"/);
    assert.match(primary, /id="today-tasks-title"/);
    assert.doesNotMatch(primary, /id="next-tasks-title"|id="week-summary-title"/);
    const secondary = html.slice(html.indexOf('class="today-column today-column--secondary"'));
    assert.match(secondary, /id="next-tasks-title"/);
    assert.match(secondary, /id="week-summary-title"/);
    assert.match(secondary, /id="today-tba-title"/);

    // The meeting list is the timeline; a missing meeting still routes to its editor.
    assert.match(html, /class="fact-list meeting-list today-timeline"/);
    const withoutMeetings = renderWorkspacePage('today', planProjection({ meetings: [] }));
    assert.match(withoutMeetings, /<button[^>]*>添加课节<\/button>/);
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

test('CoursesPage renders setup courses and distinguishes a real no-meeting state', () => {
    const html = renderToStaticMarkup(createElement(CoursesPage, {
        ...HANDLERS,
        setup: setupProjection(),
        plan: planProjection(),
        setupIncomplete: false,
    }));

    assert.match(html, />Courses<\/p>/);
    assert.match(html, /<h1[^>]*>课程<\/h1>/);
    assert.match(html, /Introduction to Computer Programming/);
    assert.match(html, /Ada Lovelace/);
    assert.match(html, /LEC/);
    assert.match(html, /BA 1170/);
    assert.match(html, /Calculus with Proofs/);
    assert.match(html, /尚未添加课节/);

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
    assert.doesNotMatch(archivedOnlyHtml, /Introduction to Computer Programming/);
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

test('CalendarPage keeps seven day columns and separates Calendar, Agenda, conflict, and TBA facts', () => {
    const html = renderToStaticMarkup(createElement(CalendarPage, {
        ...HANDLERS,
        setup: setupProjection(),
        plan: planProjection(),
        setupIncomplete: false,
    }));

    assert.match(html, />Calendar<\/p>/);
    assert.match(html, /<h1[^>]*>日历<\/h1>/);
    assert.equal((html.match(/class="calendar-day-column"/g) ?? []).length, 7);
    assert.match(html, /class="calendar-scroll-region"/);
    assert.match(html, /2026-09-07/);
    assert.match(html, /2026-09-13/);
    assert.match(html, /Reading Week/);
    assert.match(html, /议程/);
    assert.match(html, /时间冲突/);
    assert.match(html, /Confirm research topic/);
    assert.match(html, /TBA/);

    const onlyTbaHtml = renderToStaticMarkup(createElement(CalendarPage, {
        ...HANDLERS,
        setup: setupProjection(),
        plan: planProjection({ tasks: [TBA_TASK], meetings: [], holidayRanges: [] }),
        setupIncomplete: false,
    }));
    assert.match(onlyTbaHtml, /当前范围没有已排期事项/);
    assert.match(onlyTbaHtml, /Confirm research topic/);
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

test('CalendarPage gives every simultaneous item a visible lane and groups Agenda facts by date', () => {
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
    assert.equal((html.match(/data-agenda-date="2026-09-10"/g) ?? []).length, 1);
    assert.match(html, /data-agenda-date="2026-09-10"[^>]*>[\s\S]*?<time dateTime="2026-09-10">2026-09-10<\/time>/);
    assert.match(html, /data-agenda-date="2026-09-07"/);
    assert.doesNotMatch(html, /data-agenda-date="2026-09-01"/);
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

test('TasksPage groups known PLAN tasks and TBA without inventing dates', () => {
    const html = renderToStaticMarkup(createElement(TasksPage, {
        ...HANDLERS,
        setup: setupProjection(),
        plan: planProjection(),
        setupIncomplete: false,
    }));

    assert.match(html, />Tasks<\/p>/);
    assert.match(html, /<h1[^>]*>任务<\/h1>/);
    assert.match(html, /Read chapter one/);
    assert.match(html, /Draft project outline/);
    assert.match(html, /Confirm research topic/);
    assert.equal((html.match(/Confirm research topic/g) ?? []).length, 1);
    assert.match(html, /今天/);
    assert.match(html, /即将到期/);
    assert.match(html, /TBA/);

    const emptyHtml = renderToStaticMarkup(createElement(TasksPage, {
        ...HANDLERS,
        setup: setupProjection(),
        plan: planProjection({ tasks: [], meetings: [], holidayRanges: [] }),
        setupIncomplete: false,
    }));
    assert.match(emptyHtml, /当前学期还没有任务/);
    assert.match(
        emptyHtml,
        /id="scheduled-tasks-empty"[\s\S]*?<button[^>]*>添加任务<\/button>/,
    );
    assert.match(
        emptyHtml,
        /id="tba-tasks-empty"[\s\S]*?<button[^>]*>添加任务<\/button>/,
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
    assert.doesNotMatch(html, /today-tba-title|查看 TBA 任务/);
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
        assert.match(html, /不能判断是否真的没有事项/);
        assert.doesNotMatch(html, /今天没有课节|今天没有任务|当前范围没有已排期事项|当前学期还没有任务/);
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

    assert.match(html, />Files<\/p>/);
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
