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
    localInstantLabel,
    localInstantParts,
    meetingItemId,
    meetingLocationLabel,
    minuteLabel,
    planItemId,
    remainingTimeLabel,
    sevenDayDates,
    shortWeekdayNames,
    taskClassificationNames,
    taskItemId,
    taskSeverity,
    termWeekLabel,
    todayGreetingTitle,
    todayHeadlineMeeting,
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
import {
    PlanMeetingProjection,
    PlanNextTaskProjection,
    PlanTaskProjection,
} from '../../shared/workspace-plan-contract';
import type { PlanProjection } from '../../shared/workspace-plan-contract';
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

/**
 * Renders Today without recalculating PLAN-owned classifications, selections, or summaries.
 *
 * @param {WorkspacePageContentProps} props Existing facts and executable navigation handlers.
 * @return {ReactElement} Today page.
 */
export function TodayPage(props: WorkspacePageContentProps): ReactElement {
    const { plan, setup, setupIncomplete } = props;
    const endedTerm = !setupIncomplete && setup.currentTerm === null && setup.everReachedMinimum;
    const attention = plan ? attentionFacts(plan) : null;
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
                <>
                    <div className="workspace-grid workspace-grid--today">
                        <TodayTimeline
                            onNavigate={props.onNavigate}
                            onOpenManagement={props.onOpenManagement}
                            plan={plan}
                            setup={setup}
                        />

                        <NextStepCard
                            next={plan.next}
                            onOpenTasks={() => props.onNavigate('tasks')}
                            termZone={plan.evaluationContext.termZone}
                            wide={attention === null}
                        />

                        {attention === null ? null : (
                            <AttentionCard
                                facts={attention}
                                onNavigate={props.onNavigate}
                            />
                        )}

                        <TodayTasksCard
                            onCreateTask={props.onCreateTask}
                            onNavigate={props.onNavigate}
                            plan={plan}
                            taskActions={props.taskActions}
                        />

                        <WeekStrip
                            onOpenCalendar={() => props.onNavigate('calendar')}
                            plan={plan}
                        />
                    </div>
                    {attention === null ? (
                        <p
                            className="today-collapsed-note"
                            role="status"
                        >没有逾期任务、本周时间冲突或 TBA 任务，「需要注意」已隐藏。</p>
                    ) : null}
                </>
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

export type AttentionFacts = Readonly<{
    overdueTasks: number;
    conflictGroups: number;
    tbaTasks: number;
}>;

/**
 * Reads the three PLAN counts the attention slot exists for, or null when there are none.
 *
 * The conflict count covers the whole projected week, which is why its label says so.
 *
 * @param {PlanProjection} plan Unified PLAN projection.
 * @return {AttentionFacts | null} Facts worth a slot, or null when the slot must collapse.
 */
export function attentionFacts(plan: PlanProjection): AttentionFacts | null {
    const facts = {
        overdueTasks: plan.today.summary.excluded.priorOverdueTasks,
        conflictGroups: plan.agenda.warnings.length,
        tbaTasks: plan.tba.tasks.length,
    };
    if (facts.overdueTasks === 0 && facts.conflictGroups === 0 && facts.tbaTasks === 0) {
        return null;
    }
    return facts;
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
 * Chooses the strongest sentence the projected week can actually support.
 *
 * The window is Monday through Sunday, so a next class outside it is not a fact this
 * page holds; the ladder degrades to the Term start date rather than inventing one.
 *
 * @param {PlanProjection} plan Unified PLAN projection.
 * @return {string} Student-facing reason for an empty day.
 */
export function timelineEmptyCopy(plan: PlanProjection): string {
    const laterThisWeek = plan.week.meetings.find(meeting => meeting.classification === 'upcoming');
    if (laterThisWeek !== undefined) {
        const weekday = calendarWeekdayNames[
            new Date(`${laterThisWeek.occurrence.date}T00:00:00.000Z`).getUTCDay()
        ]!;
        return `本周下一节是${weekday} ${laterThisWeek.occurrence.localStart} 的 ${laterThisWeek.courseCode}。`;
    }
    if (plan.term.startDate > plan.evaluationContext.applicableDate) {
        return `学期 ${plan.term.startDate} 开始，到那时这里才会排上课节。`;
    }
    return '本周没有其他课节。';
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

/**
 * Renders the one dark surface on the page: the large Task PLAN already selected.
 *
 * The primary block is always the large Task and the compressed line is always the
 * small one; choosing between them by remaining time would be a Renderer selection.
 *
 * @param {Object} props PLAN-selected next Tasks and the Task-page action.
 * @return {ReactElement} Next-step card.
 */
export function NextStepCard(props: Readonly<{
    next: PlanProjection['next'];
    termZone: string;
    wide: boolean;
    onOpenTasks: () => void;
}>): ReactElement {
    const { large, small } = props.next;

    return (
        <section
            aria-labelledby="today-next-step-title"
            className={props.wide
                ? 'content-card next-step-card next-step-card--wide'
                : 'content-card next-step-card'}
        >
            <h2 id="today-next-step-title">下一步</h2>
            {large.kind === 'empty' && small.kind === 'empty' ? (
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
                        termZone={props.termZone}
                    />
                    <NextStepSecondary next={small} />
                </>
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
 * Renders the three counts that decide whether today needs a correction.
 *
 * @param {Object} props PLAN-owned counts and the navigation handler.
 * @return {ReactElement} Attention card.
 */
export function AttentionCard(props: Readonly<{
    facts: AttentionFacts;
    onNavigate: (page: WorkspaceNavigationId) => void;
}>): ReactElement {
    const { facts } = props;
    // Fixed precedence, so the action never changes with the order the counts arrive in.
    const action: Readonly<{ label: string; page: WorkspaceNavigationId }> = facts.overdueTasks > 0
        ? { label: '查看任务', page: 'tasks' }
        : facts.conflictGroups > 0
            ? { label: '查看日历', page: 'calendar' }
            : { label: '查看 TBA 任务', page: 'tasks' };

    return (
        <section
            aria-labelledby="today-attention-title"
            className="content-card attention-card"
        >
            <h2 id="today-attention-title">需要注意</h2>
            <dl className="attention-facts">
                {facts.overdueTasks === 0 ? null : (
                    <div data-severity="critical">
                        <dt>逾期任务</dt>
                        <dd>{facts.overdueTasks}</dd>
                    </div>
                )}
                {facts.conflictGroups === 0 ? null : (
                    <div data-severity="warning">
                        <dt>本周时间冲突</dt>
                        <dd>{facts.conflictGroups} 组</dd>
                    </div>
                )}
                {facts.tbaTasks === 0 ? null : (
                    <div data-severity="neutral">
                        <dt>TBA 任务</dt>
                        <dd>{facts.tbaTasks}</dd>
                    </div>
                )}
            </dl>
            <button
                className="secondary-action"
                onClick={() => props.onNavigate(action.page)}
                type="button"
            >{action.label}</button>
        </section>
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
                        />
                    ))}
                </ul>
            )}
        </section>
    );
}

/**
 * Renders the seven-day load strip from the PLAN-owned week window.
 *
 * Placing week facts into their own date column is the same presentation move the
 * Calendar already makes; no new classification or filter is introduced here.
 *
 * @param {Object} props Unified PLAN projection and Calendar action.
 * @return {ReactElement} Week strip card.
 */
export function WeekStrip(props: Readonly<{
    plan: PlanProjection;
    onOpenCalendar: () => void;
}>): ReactElement {
    const { plan } = props;
    const { week } = plan;
    const { applicableDate, termZone } = plan.evaluationContext;
    const dates = sevenDayDates(week.window.startDate);
    const taskDate = (task: PlanTaskProjection): string | null => {
        if (task.occurrence.deadline.kind === 'date-only') {
            return task.occurrence.deadline.date;
        }
        if (task.occurrence.deadline.kind === 'timed') {
            return localInstantParts(task.occurrence.deadline.instant, termZone).date;
        }
        return null;
    };
    const quiet = week.meetings.length === 0 && week.tasks.length === 0;

    return (
        <section
            aria-labelledby="today-week-title"
            className="content-card week-strip-card"
        >
            <div className="card-heading">
                <h2 id="today-week-title">本周</h2>
                <p className="page-context">
                    <time dateTime={week.window.startDate}>{week.window.startDate}</time>
                    {' - '}
                    <time dateTime={week.window.endDate}>{week.window.endDate}</time>
                </p>
            </div>
            <ol className="week-strip">
                {dates.map(date => (
                    <li
                        data-current={date === applicableDate ? 'true' : undefined}
                        data-day={date}
                        key={date}
                    >
                        <span className="week-strip-day">
                            {shortWeekdayNames[new Date(`${date}T00:00:00.000Z`).getUTCDay()]}
                        </span>
                        <time dateTime={date}>{date.slice(5)}</time>
                        <span className="week-strip-counts">
                            <span>{week.meetings.filter(meeting => (
                                meeting.occurrence.date === date
                            )).length} 课节</span>
                            <span>{week.tasks.filter(task => taskDate(task) === date).length} 任务</span>
                        </span>
                    </li>
                ))}
            </ol>
            {quiet ? (
                <p
                    className="week-strip-note"
                    role="status"
                >{plan.term.startDate > applicableDate
                        ? `学期 ${plan.term.startDate} 开始，本周还是空的。`
                        : '本周没有课节和任务。'}<button
                            className="secondary-action"
                            onClick={props.onOpenCalendar}
                            type="button"
                        >查看日历</button></p>
            ) : null}
        </section>
    );
}
