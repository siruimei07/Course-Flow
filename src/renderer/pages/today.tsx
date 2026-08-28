import type { ReactElement } from 'react';
import { meetingItemId, percentageFormatter, remainingTimeLabel, taskClassificationNames, taskItemId, termContext, todayGreetingTitle } from './shared';
import { EmptyState, EndedTermState, MeetingItem, PageHeader, PlanUnavailable, SetupIncompleteNotice, TaskItem, buttonAction } from './widgets';
import type { WorkspacePageContentProps } from '../workspace-pages';
import { PlanNextTaskProjection } from '../../shared/workspace-plan-contract';
import type { PlanProjection } from '../../shared/workspace-plan-contract';
/**
 * Renders Today without recalculating PLAN-owned classifications, selections, or summaries.
 *
 * @param {WorkspacePageContentProps} props Existing facts and executable navigation handlers.
 * @return {ReactElement} Today page.
 */
export function TodayPage(props: WorkspacePageContentProps): ReactElement {
    const { plan, setup, setupIncomplete } = props;
    const endedTerm = !setupIncomplete && setup.currentTerm === null && setup.everReachedMinimum;

    return (
        <article
            aria-labelledby="today-page-title"
            className="workspace-page workspace-page--today"
        >
            <PageHeader
                context={termContext(setup)}
                eyebrow="Today"
                headingId="today-page-title"
                title={plan === null || plan === undefined
                    ? '今天先做什么'
                    : todayGreetingTitle(plan)}
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
                    <section
                        aria-labelledby="today-summary-title"
                        className="content-card today-summary-card"
                    >
                        <h2 id="today-summary-title">今日概览</h2>
                        <p className="page-context">
                            <time dateTime={plan.evaluationContext.applicableDate}>
                                {plan.evaluationContext.applicableDate}
                            </time>
                            {' · '}
                            {plan.evaluationContext.termZone}
                        </p>
                        <dl className="summary-facts">
                            <div className="summary-fact">
                                <dt>今日已完成</dt>
                                <dd>{plan.today.summary.completed}</dd>
                            </div>
                            <div className="summary-fact">
                                <dt>今日待完成</dt>
                                <dd>{plan.today.summary.pending}</dd>
                            </div>
                            <div className="summary-fact summary-fact--progress">
                                <dt>学期日期进度</dt>
                                <dd>
                                    <progress
                                        aria-label="学期日期进度"
                                        max={1}
                                        value={plan.termProgress.ratio}
                                    >
                                        {percentageFormatter.format(plan.termProgress.ratio)}
                                    </progress>
                                    <span>{percentageFormatter.format(plan.termProgress.ratio)}</span>
                                    <small>
                                        {plan.termProgress.elapsedDays} / {plan.termProgress.totalDays} 个学期日
                                    </small>
                                </dd>
                            </div>
                        </dl>
                    </section>

                    <div className="workspace-grid workspace-grid--today">
                        <section
                            aria-labelledby="today-meetings-title"
                            className="content-card today-meetings-card"
                        >
                            <h2 id="today-meetings-title">今日课节</h2>
                            {plan.today.meetings.length === 0 ? (
                                <EmptyState
                                    action={buttonAction('查看课程', () => props.onNavigate('courses'))}
                                    id="today-meetings-empty"
                                    reason="统一计划投影确认今天没有应显示的课节；取消或假期抑制不会伪装成课程。"
                                    title="今天没有课节"
                                />
                            ) : (
                                <ul className="fact-list meeting-list">
                                    {plan.today.meetings.map(meeting => (
                                        <MeetingItem
                                            key={meetingItemId(meeting)}
                                            meeting={meeting}
                                        />
                                    ))}
                                </ul>
                            )}
                        </section>

                        <section
                            aria-labelledby="today-tasks-title"
                            className="content-card today-tasks-card"
                        >
                            <h2 id="today-tasks-title">今日任务</h2>
                            {plan.today.tasks.length === 0 ? (
                                <EmptyState
                                    action={buttonAction('添加任务', props.onCreateTask)}
                                    id="today-tasks-empty"
                                    reason="统一计划投影确认今天没有任务；其他日期和 TBA 任务仍保留在任务页。"
                                    secondaryAction={buttonAction(
                                        '查看任务',
                                        () => props.onNavigate('tasks'),
                                    )}
                                    title="今天没有任务"
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
                    </div>

                    <section
                        aria-labelledby="next-tasks-title"
                        className="content-card emphasis-card"
                    >
                        <div className="emphasis-layer">
                            <h2 id="next-tasks-title">下一步</h2>
                            <div className="next-task-grid">
                                <NextTaskCard
                                    label="下一个小任务"
                                    next={plan.next.small}
                                    onOpenTasks={() => props.onNavigate('tasks')}
                                />
                                <NextTaskCard
                                    label="下一个大任务"
                                    next={plan.next.large}
                                    onOpenTasks={() => props.onNavigate('tasks')}
                                />
                            </div>
                        </div>
                    </section>

                    {plan.tba.tasks.length > 0 ? (
                        <section
                            aria-labelledby="today-tba-title"
                            className="content-card today-tba-card"
                        >
                            <h2 id="today-tba-title">待确定</h2>
                            <p className="section-intro">
                                {plan.tba.tasks.length} 项时间待确定的任务不会进入倒计时。
                            </p>
                            <div className="empty-state-actions">
                                <button
                                    className="secondary-action"
                                    onClick={() => props.onNavigate('tasks')}
                                    type="button"
                                >查看 TBA 任务</button>
                            </div>
                        </section>
                    ) : null}

                    <WeekSummary
                        onOpenCalendar={() => props.onNavigate('calendar')}
                        plan={plan}
                    />
                </>
            )}
        </article>
    );
}

/**
 * Renders the next task already selected by PLAN.
 *
 * @param {Object} props Size label, selected projection, and Task-page action.
 * @return {ReactElement} Next-task card or true empty state.
 */
export function NextTaskCard(props: Readonly<{
    label: string;
    next: PlanNextTaskProjection;
    onOpenTasks: () => void;
}>): ReactElement {
    return (
        <article className="next-task-card">
            <h3>{props.label}</h3>
            {props.next.kind === 'empty' ? (
                <div
                    className="empty-state empty-state--compact"
                >
                    <p role="status">没有待完成且截止时间已知的对应任务。</p>
                    <button
                        className="secondary-action"
                        onClick={props.onOpenTasks}
                        type="button"
                    >查看任务</button>
                </div>
            ) : (
                <div
                    className="next-task-fact"
                    data-item-id={taskItemId(props.next.task)}
                >
                    <p className="status-label">{taskClassificationNames[props.next.task.classification]}</p>
                    <strong>{props.next.task.occurrence.title}</strong>
                    <span>{props.next.task.courseCode}</span>
                    <time dateTime={props.next.deadlineBoundary}>{props.next.deadlineBoundary}</time>
                    <span>{remainingTimeLabel(props.next.remainingMilliseconds)}</span>
                </div>
            )}
        </article>
    );
}

/**
 * Renders a compact summary of the PLAN-owned current week projection.
 *
 * @param {Object} props Unified PLAN projection and Calendar action.
 * @return {ReactElement} Week summary.
 */
export function WeekSummary(props: Readonly<{
    plan: PlanProjection;
    onOpenCalendar: () => void;
}>): ReactElement {
    const { week } = props.plan;
    const hasFacts = week.tasks.length > 0 || week.meetings.length > 0 || week.holidayRanges.length > 0;

    return (
        <section
            aria-labelledby="week-summary-title"
            className="content-card week-summary-card"
        >
            <h2 id="week-summary-title">本周摘要</h2>
            <p className="page-context">
                <time dateTime={week.window.startDate}>{week.window.startDate}</time>
                {' – '}
                <time dateTime={week.window.endDate}>{week.window.endDate}</time>
            </p>
            {hasFacts ? (
                <>
                    <dl className="summary-facts summary-facts--week">
                        <div className="summary-fact">
                            <dt>课节</dt>
                            <dd>{week.meetings.length}</dd>
                        </div>
                        <div className="summary-fact">
                            <dt>任务</dt>
                            <dd>{week.tasks.length}</dd>
                        </div>
                        <div className="summary-fact">
                            <dt>假期</dt>
                            <dd>{week.holidayRanges.length}</dd>
                        </div>
                    </dl>
                    {week.holidayRanges.length > 0 ? (
                        <ul className="fact-list holiday-list">
                            {week.holidayRanges.map(holiday => (
                                <li
                                    data-item-id={holiday.holidayRangeId}
                                    key={holiday.holidayRangeId}
                                >
                                    <strong>{holiday.name}</strong>
                                    <span>{holiday.startDate} – {holiday.endDate}</span>
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </>
            ) : (
                <EmptyState
                    action={buttonAction('查看日历', props.onOpenCalendar)}
                    id="week-summary-empty"
                    reason="统一计划投影确认本周没有课节、任务或假期，因此摘要没有事项。"
                    title="本周没有计划事项"
                />
            )}
        </section>
    );
}
