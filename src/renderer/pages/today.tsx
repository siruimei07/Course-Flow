import type { CSSProperties, ReactElement } from 'react';
import {
    CALENDAR_EVENT_MIN_HEIGHT,
    CalendarTimedPlacement,
    calendarDayDifference,
    calendarHourLabels,
    calendarHourWindow,
    calendarMinutePixels,
    calendarTimedPlacements,
    calendarWeekdayNames,
    conflictingMeetingIds,
    courseColorFor,
    courseWeekdaySummary,
    durationLabel,
    hoursLabel,
    localInstantLabel,
    localInstantParts,
    meetingItemId,
    meetingLocationLabel,
    minuteLabel,
    nextTermMeeting,
    planItemId,
    remainingTimeLabel,
    shortWeekdayOf,
    sortedCourseMeetings,
    taskClassificationNames,
    taskItemId,
    taskSeverity,
    termWeekLabel,
    todayGreetingTitle,
    todayHeadlineMeeting,
    weekdayMarks,
} from './shared';
import {
    EmptyState,
    EndedTermState,
    PageHeader,
    PlanUnavailable,
    SetupIncompleteNotice,
    TaskItem,
    buttonAction,
} from './widgets';
import type { WorkspaceNavigationId } from '../navigation';
import type { TaskActionPresentation, WorkspacePageContentProps } from '../workspace-pages';
import type { CourseProjection } from '../../shared/workspace-course-contract';
import {
    PlanMeetingProjection,
    PlanNextTaskProjection,
    PlanTaskProjection,
} from '../../shared/workspace-plan-contract';
import type { PlanCourseTaskSummary, PlanProjection } from '../../shared/workspace-plan-contract';
import type { SetupProjection } from '../../shared/workspace-term-contract';
export type TermSpanStyle = CSSProperties & Readonly<{
    '--span-left': string;
    '--span-width': string;
}>;

export type TimelineGridStyle = CSSProperties & Readonly<{
    '--timeline-hour-count': string;
}>;

export type TimelineEventStyle = CSSProperties & Readonly<{
    '--event-top': string;
    '--event-height': string;
    '--event-left': string;
    '--event-width': string;
    '--event-min-height': string;
}>;

export type TimelineNowStyle = CSSProperties & Readonly<{ '--now-top': string }>;

export type RingStyle = CSSProperties & Readonly<{ '--ring-ratio': string }>;

export type LoadBarStyle = CSSProperties & Readonly<{ '--load': string }>;

export type TermSegmentStyle = CSSProperties & Readonly<{
    '--share': string;
    '--done': string;
}>;

/** Rows the dark card shows before folding the rest into one line. */
export const WEEK_DEADLINE_ROW_LIMIT = 5;

/** Dots under one week-load column before the fourth dot means "more than three". */
export const WEEK_LOAD_TASK_DOT_LIMIT = 3;

/**
 * Renders Today without recalculating PLAN-owned classifications, selections, or summaries.
 *
 * @param {WorkspacePageContentProps} props Existing facts and executable navigation handlers.
 * @return {ReactElement} Today page.
 */
export function TodayPage(props: WorkspacePageContentProps): ReactElement {
    const { plan, setup, setupIncomplete } = props;
    const endedTerm = !setupIncomplete && setup.currentTerm === null && setup.everReachedMinimum;
    const dayContext = plan
        ? `${plan.evaluationContext.applicableDate} · ${plan.evaluationContext.termZone}`
            + ` · ${termWeekLabel(plan)}`
        : termContextFallback(setup);

    return (
        <article
            aria-labelledby="today-page-title"
            className="workspace-page workspace-page--today"
        >
            <PageHeader
                context={dayContext}
                facts={plan === null || plan === undefined ? undefined : (
                    <TodayHeadline
                        plan={plan}
                        setup={setup}
                    />
                )}
                headingId="today-page-title"
                title={plan === null || plan === undefined
                    ? '今天先做什么'
                    : todayGreetingTitle(plan)}
                variant="today"
            />
            {setupIncomplete ? <SetupIncompleteNotice onContinueSetup={props.onContinueSetup} /> : null}
            {!plan && endedTerm ? (
                <EndedTermState
                    onCreateTerm={props.onContinueSetup}
                    onViewHistory={() => props.onNavigate('courses')}
                    setup={setup}
                />
            ) : !plan ? (
                <PlanUnavailable
                    {...props}
                    fallbackActionLabel="查看课程"
                    fallbackPage="courses"
                />
            ) : (
                <div className="workspace-grid workspace-grid--today">
                    <TodayTimeline
                        onNavigate={props.onNavigate}
                        onOpenManagement={props.onOpenManagement}
                        plan={plan}
                        setup={setup}
                    />
                    <NowCard
                        plan={plan}
                        setup={setup}
                    />
                    <WeekLoadCard plan={plan} />
                    <NextStepCard
                        onOpenTasks={() => props.onNavigate('tasks')}
                        plan={plan}
                    />
                    <TodayTasksCard
                        onCreateTask={props.onCreateTask}
                        onNavigate={props.onNavigate}
                        plan={plan}
                        taskActions={props.taskActions}
                    />
                    <CoursesCard
                        onOpenManagement={props.onOpenManagement}
                        plan={plan}
                        setup={setup}
                    />
                    <TermTasksCard
                        onCreateTask={props.onCreateTask}
                        plan={plan}
                        setup={setup}
                    />
                </div>
            )}
        </article>
    );
}

/**
 * Names the Term context used before a PLAN projection is available.
 *
 * @param {SetupProjection} setup Current setup projection.
 * @return {string} Real Term context or an explicit missing state.
 */
export function termContextFallback(setup: SetupProjection): string {
    if (!setup.currentTerm) {
        return '尚无当前学期';
    }

    return `${setup.currentTerm.name} · ${setup.currentTerm.startDate} - ${setup.currentTerm.endDate}`;
}

/**
 * Renders the Term progress capsule and the three action numbers that open the page.
 *
 * @param {Object} props Unified PLAN projection and Setup facts.
 * @return {ReactElement} Header facts.
 */
export function TodayHeadline(props: Readonly<{
    plan: PlanProjection;
    setup: SetupProjection;
}>): ReactElement {
    const { plan, setup } = props;
    const { term, termProgress } = plan;
    const { applicableDate } = plan.evaluationContext;
    const beforeStart = applicableDate < term.startDate;
    const nextMeeting = todayHeadlineMeeting(plan);
    const overdueTasks = plan.today.summary.excluded.priorOverdueTasks;
    // The axis is the whole Term, so its Holiday marks must be the whole Term's ranges.
    const holidays = setup.holidayRanges.filter(range => range.termId === term.termId);
    const axisPercent = (days: number): string => (
        `${Math.round((days / termProgress.totalDays) * 1e5) / 1e3}%`
    );
    const span = (startDay: number, dayCount: number): TermSpanStyle => ({
        '--span-left': axisPercent(startDay),
        '--span-width': axisPercent(dayCount),
    });

    return (
        <>
            <div className="term-progress">
                <p className="term-progress-heading">
                    <span className="term-progress-name">{term.name}</span>
                    <span className="term-progress-remaining">{beforeStart
                        ? `${calendarDayDifference(applicableDate, term.startDate)} 天后开学`
                        : `剩余 ${termProgress.totalDays - termProgress.elapsedDays} 天`}</span>
                </p>
                <div
                    aria-label={`学期日期进度 ${termProgress.elapsedDays} / ${termProgress.totalDays} 个学期日`}
                    className="term-progress-track"
                    role="img"
                >
                    {beforeStart ? null : (
                        <span
                            className="term-progress-elapsed"
                            style={span(0, termProgress.elapsedDays)}
                        />
                    )}
                    {holidays.map(range => {
                        const startDay = Math.max(0, calendarDayDifference(term.startDate, range.startDate));
                        const lastDay = Math.min(
                            termProgress.totalDays - 1,
                            calendarDayDifference(term.startDate, range.endDate),
                        );
                        if (lastDay < startDay) {
                            return null;
                        }
                        return (
                            <span
                                className="term-progress-holiday"
                                key={range.holidayRangeId}
                                style={span(startDay, lastDay - startDay + 1)}
                            />
                        );
                    })}
                </div>
            </div>
            <dl className="today-headline-stats">
                <div
                    className="today-headline-stat"
                    data-severity={overdueTasks > 0 ? 'critical' : 'neutral'}
                >
                    <dt>逾期任务</dt>
                    <dd>{overdueTasks}</dd>
                </div>
                <div
                    className="today-headline-stat"
                    data-severity="neutral"
                >
                    <dt>今日待完成</dt>
                    <dd>{plan.today.summary.pending}</dd>
                </div>
                <div
                    className="today-headline-stat"
                    data-severity="neutral"
                >
                    <dt>{nextMeeting.label}</dt>
                    <dd>{nextMeeting.dateTime === null
                        ? nextMeeting.value
                        : <time dateTime={nextMeeting.dateTime}>{nextMeeting.value}</time>}</dd>
                </div>
            </dl>
        </>
    );
}

/**
 * Renders today's timed occurrences on the same hour geometry the Calendar uses.
 *
 * @param {Object} props PLAN facts, Course colours, and executable handlers.
 * @return {ReactElement} Today timeline card.
 */
export function TodayTimeline(props: Readonly<{
    plan: PlanProjection;
    setup: SetupProjection;
    onNavigate: (page: WorkspaceNavigationId) => void;
    onOpenManagement: WorkspacePageContentProps['onOpenManagement'];
}>): ReactElement {
    const { plan, setup } = props;
    const { applicableDate, evaluatedAt, termZone } = plan.evaluationContext;
    const placements = calendarTimedPlacements(plan.calendar.timedItems, termZone)
        .filter(placement => placement.date === applicableDate);
    const hourWindow = calendarHourWindow(placements);
    const conflicts = conflictingMeetingIds(plan);
    const now = localInstantParts(evaluatedAt, termZone);
    const nowVisible = now.date === applicableDate
        && now.minute >= hourWindow.startHour * 60
        && now.minute <= hourWindow.endHour * 60;
    const gridStyle: TimelineGridStyle = {
        '--timeline-hour-count': `${hourWindow.endHour - hourWindow.startHour}`,
    };
    const nowStyle: TimelineNowStyle = {
        '--now-top': `${calendarMinutePixels(now.minute - hourWindow.startHour * 60)}px`,
    };
    const empty = timelineEmptyCopy(plan);

    return (
        <section
            aria-labelledby="today-timeline-title"
            className="content-card today-timeline-card"
        >
            <div className="card-heading">
                <h2 id="today-timeline-title">今日时间轴</h2>
                <p className="page-context">
                    {minuteLabel(hourWindow.startHour * 60)} - {hourWindow.endHour === 24
                        ? '24:00'
                        : minuteLabel(hourWindow.endHour * 60)}
                </p>
            </div>
            <div
                aria-label="可纵向滚动的今日时间轴"
                className="today-timeline-scroll"
                tabIndex={0}
            >
                <div
                    className="today-timeline-grid"
                    style={gridStyle}
                >
                    <ol
                        aria-hidden="true"
                        className="today-timeline-hours"
                    >
                        {calendarHourLabels(hourWindow.startHour, hourWindow.endHour).map(label => (
                            <li key={label}>{label}</li>
                        ))}
                    </ol>
                    <ol
                        aria-label="今天按时刻排列的事项"
                        className="today-timeline-lane"
                    >
                        {placements.map(placement => (
                            <TodayTimelineItem
                                conflicts={conflicts}
                                key={`${planItemId(placement.item)}:${placement.date}`}
                                placement={placement}
                                setup={setup}
                                startHour={hourWindow.startHour}
                            />
                        ))}
                        {nowVisible ? (
                            <li
                                aria-hidden="true"
                                className="today-now-line"
                                style={nowStyle}
                            />
                        ) : null}
                    </ol>
                </div>
            </div>
            {placements.length === 0 ? (
                <EmptyState
                    action={buttonAction('查看日历', () => props.onNavigate('calendar'))}
                    compact
                    id="today-timeline-empty"
                    reason={empty}
                    secondaryAction={buttonAction('添加课节', () => props.onOpenManagement('meeting'))}
                    title="今天没有课节"
                />
            ) : null}
        </section>
    );
}

/**
 * Chooses the strongest sentence the projection can actually support (UI spec §8.3).
 *
 * `plan.meetings` covers the whole Term and is already sorted and classified, so the
 * cross-week level reads its first upcoming entry; only a Term with nothing left falls
 * through to the last sentence.
 *
 * @param {PlanProjection} plan Unified PLAN projection.
 * @return {string} Student-facing reason for an empty day.
 */
export function timelineEmptyCopy(plan: PlanProjection): string {
    const laterToday = plan.today.meetings.find(meeting => meeting.classification === 'upcoming');
    if (laterToday !== undefined) {
        return `下一节 ${laterToday.occurrence.localStart} ${laterToday.courseCode}`;
    }
    const laterThisWeek = plan.week.meetings.find(meeting => meeting.classification === 'upcoming');
    if (laterThisWeek !== undefined) {
        const weekday = calendarWeekdayNames[
            new Date(`${laterThisWeek.occurrence.date}T00:00:00.000Z`).getUTCDay()
        ]!;
        return `本周下一节是${weekday} ${laterThisWeek.occurrence.localStart} 的 ${laterThisWeek.courseCode}。`;
    }
    const laterThisTerm = nextTermMeeting(plan);
    if (laterThisTerm !== undefined) {
        const { date, localStart } = laterThisTerm.occurrence;
        return `下一节 ${date.slice(5)} ${shortWeekdayOf(date)} ${localStart} ${laterThisTerm.courseCode}。`;
    }
    if (plan.term.startDate > plan.evaluationContext.applicableDate) {
        return `学期 ${plan.term.startDate} 开始，还没有排课节。`;
    }
    return '本学期没有其他课节。';
}

/**
 * Renders one timed occurrence at its exact minute position inside today's lane.
 *
 * @param {Object} props Placement, Course colours, and PLAN-owned conflict identities.
 * @return {ReactElement} One positioned timeline item.
 */
export function TodayTimelineItem(props: Readonly<{
    placement: CalendarTimedPlacement;
    setup: SetupProjection;
    startHour: number;
    conflicts: ReadonlySet<string>;
}>): ReactElement {
    const { placement } = props;
    const item = placement.item;
    const style: TimelineEventStyle = {
        '--event-top': `${calendarMinutePixels(placement.startMinute - props.startHour * 60)}px`,
        '--event-height': `${calendarMinutePixels(placement.durationMinutes)}px`,
        '--event-left': `${placement.overlapLane / placement.overlapLaneCount * 100}%`,
        '--event-width': `${100 / placement.overlapLaneCount}%`,
        '--event-min-height': `${CALENDAR_EVENT_MIN_HEIGHT}px`,
    };
    const conflicted = item.kind === 'meeting' && props.conflicts.has(meetingItemId(item));

    return (
        <li
            data-item-id={planItemId(item)}
            style={style}
            data-conflict={conflicted ? 'true' : undefined}
            data-course-color={courseColorFor(props.setup, item.courseId) ?? undefined}
            data-current={item.kind === 'meeting' && item.classification === 'in-progress'
                ? 'true'
                : undefined}
            data-start-minute={placement.startMinute}
        >
            {item.kind === 'meeting'
                ? <TodayTimelineMeeting meeting={item} />
                : <TodayTimelineTask task={item} />}
            {conflicted ? (
                <span
                    className="status-label"
                    data-severity="warning"
                >冲突</span>
            ) : null}
        </li>
    );
}

/**
 * Names one Meeting occurrence inside the timeline.
 *
 * @param {Object} props PLAN Meeting projection.
 * @return {ReactElement} Meeting label and time.
 */
export function TodayTimelineMeeting(props: Readonly<{ meeting: PlanMeetingProjection }>): ReactElement {
    const { occurrence } = props.meeting;

    return (
        <>
            <strong>{props.meeting.courseCode} · {occurrence.type}</strong>
            <span>{occurrence.localStart}-{occurrence.localEnd} · {meetingLocationLabel(occurrence.location)}</span>
        </>
    );
}

/**
 * Names one timed Task inside the timeline.
 *
 * @param {Object} props PLAN Task projection.
 * @return {ReactElement} Task label and severity.
 */
export function TodayTimelineTask(props: Readonly<{ task: PlanTaskProjection }>): ReactElement {
    return (
        <>
            <strong>{props.task.occurrence.title}</strong>
            <span
                className="status-label"
                data-severity={taskSeverity(props.task.classification)}
            >{taskClassificationNames[props.task.classification]}</span>
        </>
    );
}

export type NowCardState = 'in-class' | 'between' | 'done' | 'free' | 'before-term';

export type NowCardFacts = Readonly<{
    state: NowCardState;
    label: string;
    value: string;
    meta: string;
    clock: string;
    ratio: number | null;
    ringKind: 'course' | 'day';
    ringLabel: string;
    courseId: string | null;
    live: boolean;
}>;

/**
 * Reads the one state the 现在 card is in, in the order UI spec §8.2 fixes.
 *
 * The in-class ratio is the same time geometry as the timeline's now-line; every count
 * comes from PLAN. Nothing here classifies, selects, or sums.
 *
 * @param {PlanProjection} plan Unified PLAN projection.
 * @return {NowCardFacts} Display facts for the current moment.
 */
export function nowCardFacts(plan: PlanProjection): NowCardFacts {
    const { applicableDate, evaluatedAt, termZone } = plan.evaluationContext;
    const now = Date.parse(evaluatedAt);
    const clock = minuteLabel(localInstantParts(evaluatedAt, termZone).minute);
    const meetingLabel = (meeting: PlanMeetingProjection): string => (
        `${meeting.courseCode} ${meeting.typeLabel}`
    );
    const laterInTerm = (): string => {
        const next = nextTermMeeting(plan);
        return next === undefined
            ? '本学期没有其他课节'
            : `下一节 ${shortWeekdayOf(next.occurrence.date)} ${next.occurrence.localStart} ${next.courseCode}`;
    };

    const inProgress = plan.today.meetings.find(meeting => meeting.classification === 'in-progress');
    if (inProgress !== undefined) {
        const { occurrence } = inProgress;
        const start = Date.parse(occurrence.startInstant);
        const end = Date.parse(occurrence.endInstant);
        const ratio = Math.min(1, Math.max(0, (now - start) / (end - start)));
        return {
            state: 'in-class',
            label: '上课中',
            value: `剩 ${Math.max(1, Math.ceil((end - now) / 60_000))} 分钟`,
            meta: `${meetingLabel(inProgress)} · 至 ${occurrence.localEnd}`
                + ` · ${meetingLocationLabel(occurrence.location)}`,
            clock,
            ratio,
            ringKind: 'course',
            ringLabel: `本节课已进行 ${Math.round(ratio * 100)}%`,
            courseId: inProgress.courseId,
            live: true,
        };
    }

    const { completed, pending } = plan.today.summary.contributions.meetings;
    const dayRatio = completed + pending === 0 ? null : completed / (completed + pending);
    const dayRingLabel = `今天 ${completed + pending} 节课已上 ${completed} 节`;
    const upcoming = plan.today.meetings.find(meeting => meeting.classification === 'upcoming');
    if (upcoming !== undefined) {
        const { occurrence } = upcoming;
        return {
            state: 'between',
            label: '课间',
            value: `${durationLabel(Date.parse(occurrence.startInstant) - now)}后`,
            meta: `下一节 ${meetingLabel(upcoming)} · ${occurrence.localStart}`
                + ` · ${meetingLocationLabel(occurrence.location)}`,
            clock,
            ratio: dayRatio,
            ringKind: 'day',
            ringLabel: dayRingLabel,
            courseId: upcoming.courseId,
            live: false,
        };
    }

    const heldToday = plan.today.meetings.filter(meeting => (
        meeting.classification !== 'cancelled' && meeting.classification !== 'holiday-suppressed'
    ));
    if (heldToday.length > 0) {
        return {
            state: 'done',
            label: '今天的课上完了',
            value: `今天 ${heldToday.length} 节课已结束`,
            meta: laterInTerm(),
            clock,
            ratio: dayRatio,
            ringKind: 'day',
            ringLabel: dayRingLabel,
            courseId: nextTermMeeting(plan)?.courseId ?? null,
            live: false,
        };
    }

    if (applicableDate < plan.term.startDate) {
        const first = nextTermMeeting(plan);
        return {
            state: 'before-term',
            label: '开学前',
            value: `${calendarDayDifference(applicableDate, plan.term.startDate)} 天`,
            meta: first === undefined
                ? '还没有排课节'
                : `第一节 ${shortWeekdayOf(first.occurrence.date)} ${first.occurrence.localStart} ${first.courseCode}`
                    + ` · ${first.occurrence.date.slice(5)} · ${meetingLocationLabel(first.occurrence.location)}`,
            clock,
            ratio: null,
            ringKind: 'day',
            ringLabel: '学期尚未开始',
            courseId: first?.courseId ?? null,
            live: false,
        };
    }

    return {
        state: 'free',
        label: '今天没有课',
        value: '今天没有课',
        meta: laterInTerm(),
        clock,
        ratio: null,
        ringKind: 'day',
        ringLabel: '今天没有课节',
        courseId: nextTermMeeting(plan)?.courseId ?? null,
        live: false,
    };
}

/**
 * Renders the current moment: a clock-face ring plus the state, value, and meta lines.
 *
 * @param {Object} props Unified PLAN projection and Course colours.
 * @return {ReactElement} 现在 card.
 */
export function NowCard(props: Readonly<{
    plan: PlanProjection;
    setup: SetupProjection;
}>): ReactElement {
    const facts = nowCardFacts(props.plan);
    const ringStyle: RingStyle = { '--ring-ratio': `${facts.ratio ?? 0}` };

    return (
        <section
            aria-labelledby="today-now-title"
            className="content-card now-card"
            data-now-state={facts.state}
        >
            <div className="card-heading">
                <h2 id="today-now-title">现在</h2>
                <p className="page-context now-clock">
                    <time dateTime={props.plan.evaluationContext.evaluatedAt}>{facts.clock}</time>
                </p>
            </div>
            <div
                className="now-body"
                data-course-color={facts.courseId === null
                    ? undefined
                    : courseColorFor(props.setup, facts.courseId) ?? undefined}
                data-ring={facts.ringKind}
            >
                <svg
                    aria-label={facts.ringLabel}
                    className="now-ring"
                    role="img"
                    viewBox="0 0 96 96"
                >
                    <circle
                        className="now-ring-track"
                        cx="48"
                        cy="48"
                        pathLength="100"
                        r="42"
                    />
                    <circle
                        className="now-ring-value"
                        cx="48"
                        cy="48"
                        data-empty={facts.ratio === null ? 'true' : undefined}
                        pathLength="100"
                        r="42"
                        style={ringStyle}
                    />
                </svg>
                <div className="now-facts">
                    <span
                        className="now-state"
                        data-live={facts.live ? 'true' : undefined}
                    >{facts.label}</span>
                    <strong className="now-value">{facts.value}</strong>
                    <p className="now-meta">{facts.meta}</p>
                </div>
            </div>
        </section>
    );
}

/**
 * Renders the seven-day class load PLAN already summed, with today in the accent.
 *
 * @param {Object} props Unified PLAN projection.
 * @return {ReactElement} 本周课时 card.
 */
export function WeekLoadCard(props: Readonly<{ plan: PlanProjection }>): ReactElement {
    const { plan } = props;
    const { days } = plan.week;
    const { applicableDate } = plan.evaluationContext;
    const peak = Math.max(0, ...days.map(day => day.meetingMinutes));
    const totalMinutes = days.reduce((total, day) => total + day.meetingMinutes, 0);
    const totalCount = days.reduce((total, day) => total + day.meetingCount, 0);
    const conflict = plan.agenda.warnings[0];

    return (
        <section
            aria-labelledby="today-week-title"
            className="content-card week-load-card"
        >
            <div className="card-heading">
                <h2 id="today-week-title">本周课时</h2>
                <p className="page-context">{hoursLabel(totalMinutes)} · {totalCount} 节</p>
            </div>
            <ol
                aria-label="本周每天的课时"
                className="week-load"
            >
                {days.map(day => {
                    const barStyle: LoadBarStyle = {
                        '--load': `${peak === 0 ? 0 : day.meetingMinutes / peak}`,
                    };
                    const dots = Math.min(WEEK_LOAD_TASK_DOT_LIMIT + 1, day.taskCount);
                    return (
                        <li
                            data-current={day.date === applicableDate ? 'true' : undefined}
                            data-day={day.date}
                            data-empty={day.meetingMinutes === 0 ? 'true' : undefined}
                            key={day.date}
                        >
                            <span className="week-load-peak">{peak > 0 && day.meetingMinutes === peak
                                ? hoursLabel(day.meetingMinutes)
                                : ''}</span>
                            <span className="week-load-track">
                                <span
                                    className="week-load-bar"
                                    style={barStyle}
                                    title={`${shortWeekdayOf(day.date)} ${day.meetingCount} 节`
                                        + ` · ${day.meetingMinutes} 分钟`}
                                />
                            </span>
                            <span className="week-load-day">{shortWeekdayOf(day.date).slice(1)}</span>
                            <span
                                aria-label={`${day.taskCount} 项任务`}
                                className="week-load-tasks"
                            >
                                {Array.from({ length: dots }, (_value, index) => <i key={index} />)}
                            </span>
                            <span className="visually-hidden">
                                {shortWeekdayOf(day.date)} {day.meetingCount} 节课 {day.meetingMinutes} 分钟
                                {' '}{day.taskCount} 项任务
                            </span>
                        </li>
                    );
                })}
            </ol>
            <p
                className="week-load-note"
                role="status"
            >
                {conflict !== undefined ? (
                    <>
                        <span
                            className="status-label"
                            data-severity="warning"
                        >{plan.agenda.warnings.length} 组时间冲突</span>
                        <span>
                            {shortWeekdayOf(conflict.first.occurrence.date)} {conflict.first.occurrence.localStart}
                            {' '}{conflict.first.courseCode} 与 {conflict.second.courseCode} 重叠
                        </span>
                    </>
                ) : totalCount === 0 ? (
                    <span>{plan.term.startDate > applicableDate
                        ? `学期 ${plan.term.startDate} 开始，本周还是空的。`
                        : '本周没有课节。'}</span>
                ) : null}
            </p>
        </section>
    );
}

/**
 * Renders the one dark surface on the page: the Task PLAN already selected, over the
 * week's deadline register.
 *
 * The primary block is always the large Task and the compressed line is always the
 * small one; choosing between them by remaining time would be a Renderer selection.
 *
 * @param {Object} props Unified PLAN projection and the Task-page action.
 * @return {ReactElement} Next-step card.
 */
export function NextStepCard(props: Readonly<{
    plan: PlanProjection;
    onOpenTasks: () => void;
}>): ReactElement {
    const { large, small } = props.plan.next;
    const { termZone } = props.plan.evaluationContext;
    const nothingNext = large.kind === 'empty' && small.kind === 'empty';

    return (
        <section
            aria-labelledby="today-next-step-title"
            className="content-card next-step-card"
        >
            <h2 id="today-next-step-title">下一步</h2>
            {nothingNext ? (
                <EmptyState
                    action={buttonAction('查看任务', props.onOpenTasks)}
                    compact
                    id="today-next-step-empty"
                    reason="没有截止时间已知的待完成任务。"
                    title="暂时没有下一步"
                />
            ) : (
                <>
                    <NextStepPrimary
                        next={large}
                        termZone={termZone}
                    />
                    <NextStepSecondary next={small} />
                </>
            )}
            <WeekDeadlines plan={props.plan} />
            {nothingNext ? null : (
                <button
                    className="secondary-action"
                    onClick={props.onOpenTasks}
                    type="button"
                >查看任务</button>
            )}
        </section>
    );
}

/**
 * Renders the large Task headline and its PLAN-owned countdown.
 *
 * @param {Object} props PLAN next-large projection and the display zone.
 * @return {ReactElement} Primary block or its own distinct empty line.
 */
export function NextStepPrimary(props: Readonly<{
    next: PlanNextTaskProjection;
    termZone: string;
}>): ReactElement {
    if (props.next.kind === 'empty') {
        return (
            <p className="next-step-primary next-step-primary--empty">没有截止时间已知的大任务。</p>
        );
    }

    const { task } = props.next;

    return (
        <div
            className="next-step-primary"
            data-item-id={taskItemId(task)}
        >
            <span
                className="status-label"
                data-severity={taskSeverity(task.classification)}
            >{taskClassificationNames[task.classification]}</span>
            <strong>{task.occurrence.title}</strong>
            <p className="next-step-meta">{task.courseCode} · 大任务</p>
            <p className="next-step-countdown">
                <time dateTime={props.next.deadlineBoundary}>
                    {localInstantLabel(props.next.deadlineBoundary, props.termZone)}
                </time>
                {' · '}
                {remainingTimeLabel(props.next.remainingMilliseconds)}
            </p>
        </div>
    );
}

/**
 * Compresses the small Task to one line on the inner wash.
 *
 * @param {Object} props PLAN next-small projection.
 * @return {ReactElement} Secondary line or its own distinct empty line.
 */
export function NextStepSecondary(props: Readonly<{ next: PlanNextTaskProjection }>): ReactElement {
    if (props.next.kind === 'empty') {
        return (
            <p className="next-step-secondary next-step-secondary--empty">没有截止时间已知的小任务。</p>
        );
    }

    const { task } = props.next;

    return (
        <p
            className="next-step-secondary"
            data-item-id={taskItemId(task)}
        >
            <span className="next-step-secondary-label">小任务</span>
            <span className="next-step-secondary-title">{task.occurrence.title}</span>
            <span className="next-step-secondary-time">
                {remainingTimeLabel(props.next.remainingMilliseconds)}
            </span>
        </p>
    );
}

/**
 * Names one week Task's deadline for the register: weekday, plus the clock when timed.
 *
 * @param {PlanTaskProjection} task PLAN Task projection.
 * @param {string} termZone Workspace-owned TermZone.
 * @return {string} `周x HH:MM`, `周x`, or `TBA`.
 */
export function weekDeadlineMeta(task: PlanTaskProjection, termZone: string): string {
    const { deadline } = task.occurrence;
    if (deadline.kind === 'timed') {
        const { date, minute } = localInstantParts(deadline.instant, termZone);
        return `${shortWeekdayOf(date)} ${minuteLabel(minute)}`;
    }
    if (deadline.kind === 'date-only') {
        return shortWeekdayOf(deadline.date);
    }
    return 'TBA';
}

/**
 * Renders the week's deadline register under the next step, in PLAN's deadline order.
 *
 * Rows are not interactive: Task actions stay on 今日任务 and the Tasks page.
 *
 * @param {Object} props Unified PLAN projection.
 * @return {ReactElement} Register block with its `n/N` figure.
 */
export function WeekDeadlines(props: Readonly<{ plan: PlanProjection }>): ReactElement {
    const { tasks } = props.plan.week;
    const { termZone } = props.plan.evaluationContext;
    const completed = tasks.filter(task => task.classification === 'completed').length;
    const visible = tasks.slice(0, WEEK_DEADLINE_ROW_LIMIT);
    const hidden = tasks.length - visible.length;

    return (
        <div className="week-deadlines">
            <div className="card-heading week-deadlines-heading">
                <h3 id="today-week-deadlines-title">本周截止</h3>
                <p className="week-deadlines-count">
                    <strong>{completed}</strong>/{tasks.length}
                </p>
            </div>
            {tasks.length === 0 ? (
                <p className="week-deadlines-empty">本周没有截止的任务。</p>
            ) : (
                <ol
                    aria-labelledby="today-week-deadlines-title"
                    className="week-deadlines-list"
                >
                    {visible.map(task => {
                        const state = task.classification === 'completed' || task.classification === 'skipped'
                            ? task.classification
                            : 'pending';
                        return (
                            <li
                                data-item-id={taskItemId(task)}
                                data-severity={taskSeverity(task.classification)}
                                data-state={state}
                                key={taskItemId(task)}
                            >
                                <span
                                    aria-hidden="true"
                                    className="deadline-mark"
                                >
                                    {task.classification === 'completed' ? (
                                        <svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" /></svg>
                                    ) : null}
                                </span>
                                <span className="deadline-title">{task.occurrence.title}</span>
                                <span className="deadline-meta">
                                    {task.courseCode} · {weekDeadlineMeta(task, termZone)}
                                    {task.classification === 'overdue' ? ' · 逾期' : ''}
                                    {task.classification === 'skipped' ? ' · 已跳过' : ''}
                                </span>
                            </li>
                        );
                    })}
                </ol>
            )}
            {hidden > 0 ? <p className="week-deadlines-more">还有 {hidden} 项在任务页。</p> : null}
        </div>
    );
}

/**
 * Renders today's Tasks with the PLAN-owned task-only completion meter.
 *
 * @param {Object} props PLAN facts, Task actions, and executable handlers.
 * @return {ReactElement} Today tasks card.
 */
export function TodayTasksCard(props: Readonly<{
    plan: PlanProjection;
    taskActions?: TaskActionPresentation;
    onCreateTask: () => void;
    onNavigate: (page: WorkspaceNavigationId) => void;
}>): ReactElement {
    const { plan } = props;
    // The header counts Tasks and Meetings together; this meter is Tasks only.
    const { completed, pending } = plan.today.summary.contributions.tasks;
    const total = completed + pending;

    return (
        <section
            aria-labelledby="today-tasks-title"
            className="content-card today-tasks-card"
        >
            <div className="card-heading">
                <h2 id="today-tasks-title">今日任务</h2>
                {total === 0 ? null : (
                    <p className="today-task-progress">
                        <progress
                            aria-label="今日任务完成度"
                            max={total}
                            value={completed}
                        />
                        <span>已完成 {completed} / {total}</span>
                    </p>
                )}
            </div>
            {plan.today.tasks.length === 0 ? (
                <EmptyState
                    action={buttonAction('添加任务', props.onCreateTask)}
                    id="today-tasks-empty"
                    reason={plan.tba.tasks.length > 0
                        ? `另有 ${plan.tba.tasks.length} 项任务还没定时间，在任务页里。`
                        : '新建一个任务，或者去任务页看看其他日期。'}
                    secondaryAction={buttonAction('查看任务', () => props.onNavigate('tasks'))}
                    title="今天没有要交的任务"
                />
            ) : (
                <ul className="fact-list task-list">
                    {plan.today.tasks.map(task => (
                        <TaskItem
                            actions={props.taskActions}
                            key={taskItemId(task)}
                            task={task}
                            termZone={plan.evaluationContext.termZone}
                        />
                    ))}
                </ul>
            )}
        </section>
    );
}

/**
 * Lists the current Term's Courses that Today may show.
 *
 * @param {SetupProjection} setup Current setup projection.
 * @param {PlanProjection} plan Unified PLAN projection.
 * @return {readonly CourseProjection[]} Unarchived Courses of the projected Term, in setup order.
 */
export function currentTermCourses(setup: SetupProjection, plan: PlanProjection): readonly CourseProjection[] {
    return setup.courses.filter(course => course.termId === plan.term.termId && !course.archived);
}

/**
 * Renders the Course roster as native disclosure rows.
 *
 * `<details>` keeps the open state in the browser and reachable from the keyboard
 * without any Renderer state; the chevron is drawn, not a glyph.
 *
 * @param {Object} props Setup Courses, PLAN week facts, and the management handler.
 * @return {ReactElement} 课程 card.
 */
export function CoursesCard(props: Readonly<{
    plan: PlanProjection;
    setup: SetupProjection;
    onOpenManagement: WorkspacePageContentProps['onOpenManagement'];
}>): ReactElement {
    const courses = currentTermCourses(props.setup, props.plan);

    return (
        <section
            aria-labelledby="today-courses-title"
            className="content-card courses-card"
        >
            <div className="card-heading">
                <h2 id="today-courses-title">课程</h2>
                <p className="page-context">{courses.length} 门 · 本周 {props.plan.week.meetings.length} 节</p>
            </div>
            {courses.length === 0 ? (
                <EmptyState
                    action={buttonAction('添加课程', () => props.onOpenManagement('course'))}
                    id="today-courses-empty"
                    reason="添加当前学期的课程，课节和任务都会挂在它下面。"
                    title="还没有课程"
                />
            ) : (
                <ul className="course-roster">
                    {courses.map(course => (
                        <CourseRow
                            course={course}
                            key={course.courseId}
                        />
                    ))}
                </ul>
            )}
        </section>
    );
}

/**
 * Renders one Course as a summary row that discloses its facts and weekly slots.
 *
 * @param {Object} props One Course projection.
 * @return {ReactElement} Roster row.
 */
export function CourseRow(props: Readonly<{ course: CourseProjection }>): ReactElement {
    const { course } = props;
    const weekdays = courseWeekdaySummary(course.meetings);
    const factEntries: readonly (readonly [string, string | null])[] = [
        ['教师', course.instructor],
        ['Section', course.section],
        ['学分', course.credits],
    ];
    const facts = factEntries.filter((entry): entry is readonly [string, string] => entry[1] !== null);

    return (
        <li
            data-course-color={course.color ?? undefined}
            data-course-id={course.courseId}
        >
            <details>
                <summary>
                    <span
                        aria-hidden="true"
                        className="course-dot"
                    />
                    <strong className="course-code">{course.code}</strong>
                    <span className="course-name">{course.name}</span>
                    <span className="course-instructor">{course.instructor ?? ''}</span>
                    <span className="course-summary-meta">
                        {weekdays === '' ? '' : `${weekdays} · `}{course.meetings.length} 节/周
                    </span>
                    <svg
                        aria-hidden="true"
                        className="course-chevron"
                        viewBox="0 0 16 16"
                    ><path d="M4 6l4 4 4-4" /></svg>
                </summary>
                <div className="roster-details">
                    {facts.length === 0 ? null : (
                        <dl className="roster-facts">
                            {facts.map(([label, value]) => (
                                <div key={label}>
                                    <dt>{label}</dt>
                                    <dd>{value}</dd>
                                </div>
                            ))}
                        </dl>
                    )}
                    {course.meetings.length === 0 ? (
                        <p className="course-no-slots">还没有课节。</p>
                    ) : (
                        <ul className="course-slots">
                            {sortedCourseMeetings(course.meetings).map(meeting => (
                                <li key={meeting.meetingSeriesId}>
                                    <span>
                                        周{weekdayMarks[meeting.weekday]} {meeting.localStart}-{meeting.localEnd}
                                    </span>
                                    <span>{meeting.type.name}</span>
                                    <span>{meetingLocationLabel(meeting.location)}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </details>
        </li>
    );
}

export type TermTaskRow = PlanCourseTaskSummary & Readonly<{ color: CourseProjection['color'] }>;

/**
 * Joins PLAN's per-Course summary with Setup colours, adding 0/0 rows for Courses that
 * have no occurrences yet.
 *
 * @param {PlanProjection} plan Unified PLAN projection.
 * @param {SetupProjection} setup Current setup projection.
 * @return {readonly TermTaskRow[]} One row per current-Term Course.
 */
export function termTaskRows(plan: PlanProjection, setup: SetupProjection): readonly TermTaskRow[] {
    const summarised = plan.courses.map(course => ({
        ...course,
        color: courseColorFor(setup, course.courseId),
    }));
    const missing = currentTermCourses(setup, plan)
        .filter(course => !plan.courses.some(summary => summary.courseId === course.courseId))
        .map(course => ({
            courseId: course.courseId,
            courseCode: course.code,
            completed: 0,
            pending: 0,
            overdue: 0,
            tba: 0,
            skipped: 0,
            countable: 0,
            color: course.color,
        }));
    return [...summarised, ...missing];
}

/**
 * Renders the Term-wide Task completion PLAN summarised, one segment per Course.
 *
 * @param {Object} props PLAN summary, Setup colours, and the create handler.
 * @return {ReactElement} 学期任务 card.
 */
export function TermTasksCard(props: Readonly<{
    plan: PlanProjection;
    setup: SetupProjection;
    onCreateTask: () => void;
}>): ReactElement {
    const rows = termTaskRows(props.plan, props.setup);
    const completed = rows.reduce((total, row) => total + row.completed, 0);
    const countable = rows.reduce((total, row) => total + row.countable, 0);
    const overdue = rows.reduce((total, row) => total + row.overdue, 0);
    const tba = rows.reduce((total, row) => total + row.tba, 0);
    const percent = countable === 0 ? 0 : Math.round((completed / countable) * 100);

    return (
        <section
            aria-labelledby="today-term-tasks-title"
            className="content-card term-tasks-card"
        >
            <div className="card-heading">
                <h2 id="today-term-tasks-title">学期任务</h2>
                <p className="term-tasks-percent">{percent}%</p>
            </div>
            <p className="page-context">{countable === 0
                ? '还没有任务'
                : `已完成 ${completed} / ${countable} 项 · 按课程`}</p>
            {countable === 0 ? (
                <EmptyState
                    action={buttonAction('添加任务', props.onCreateTask)}
                    id="today-term-tasks-empty"
                    reason="给课程添加作业、测验或项目，这里会按课程统计完成度。"
                    title="还没有任务"
                />
            ) : (
                <>
                    <div
                        aria-label={`按课程的任务完成度，共 ${countable} 项，已完成 ${completed} 项`}
                        className="term-tasks-bar"
                        role="img"
                    >
                        {rows.filter(row => row.countable > 0).map(row => {
                            const style: TermSegmentStyle = {
                                '--share': `${row.countable}`,
                                '--done': `${row.completed / row.countable}`,
                            };
                            return (
                                <span
                                    data-course-color={row.color ?? undefined}
                                    data-course-id={row.courseId}
                                    key={row.courseId}
                                    style={style}
                                />
                            );
                        })}
                    </div>
                    <ul className="term-tasks-legend">
                        {rows.map(row => (
                            <li
                                data-course-color={row.color ?? undefined}
                                data-course-id={row.courseId}
                                key={row.courseId}
                            >
                                <span
                                    aria-hidden="true"
                                    className="course-dot"
                                />
                                <span>{row.courseCode}</span>
                                <span className="term-tasks-count">{row.completed}/{row.countable}</span>
                            </li>
                        ))}
                    </ul>
                    {overdue === 0 && tba === 0 ? null : (
                        <p className="term-tasks-note">
                            {overdue === 0 ? null : (
                                <span
                                    className="status-label"
                                    data-severity="critical"
                                >逾期 {overdue}</span>
                            )}
                            {tba === 0 ? null : <span className="status-label">TBA {tba}</span>}
                        </p>
                    )}
                </>
            )}
        </section>
    );
}
