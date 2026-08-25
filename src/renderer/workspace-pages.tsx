/**
 * @file Renders the five bounded Workspace pages from existing setup and unified PLAN projections.
 */

import type { CSSProperties, ReactElement } from 'react';

import type { WorkspaceNavigationId } from './navigation';
import type { TaskOccurrenceAction } from './task-occurrence-actions';
import type {
    AgendaItemProjection,
    CalendarHolidaySegmentProjection,
    PlanMeetingProjection,
    PlanNextTaskProjection,
    PlanProjection,
    PlanTaskProjection,
    TaskTimeClassification,
    MeetingTimeClassification,
} from '../shared/workspace-plan-contract';
import type {
    CourseColor,
    CourseProjection,
    MeetingLocation,
    MeetingSeriesProjection,
} from '../shared/workspace-course-contract';
import type { TaskDeadline } from '../shared/workspace-task-contract';
import type { SetupProjection, TermProjection } from '../shared/workspace-term-contract';

export type WorkspacePageHandlers = Readonly<{
    onNavigate: (page: WorkspaceNavigationId) => void;
    onContinueSetup: () => void;
    onCreateTask: () => void;
    onRetryPlan?: () => void;
    taskActions?: TaskActionPresentation;
}>;

export type TaskActionPresentation = Readonly<{
    writable: boolean;
    busyItemId: string | null;
    problem: string | null;
    canRunAction(task: PlanTaskProjection, action: TaskOccurrenceAction): boolean;
    undo: Readonly<{
        actionLabel: string;
        message: string;
        submitting: boolean;
    }> | null;
    onAction(task: PlanTaskProjection, action: TaskOccurrenceAction): void;
    onUndo(): void;
    onUndoHoverChange(hovered: boolean): void;
    onUndoFocusChange(focused: boolean): void;
}>;

export type WorkspacePageContentProps = WorkspacePageHandlers & Readonly<{
    setup: SetupProjection;
    plan?: PlanProjection | null;
    planProblem?: string | null;
    setupIncomplete: boolean;
}>;

export type WorkspacePageProps = WorkspacePageContentProps & Readonly<{
    page: WorkspaceNavigationId;
}>;

type EmptyStateAction =
    | Readonly<{
        kind: 'button';
        label: string;
        onAction: () => void;
    }>
    | Readonly<{
        kind: 'link';
        label: string;
        href: string;
    }>;

type EmptyStateProps = Readonly<{
    id: string;
    title: string;
    reason: string;
    action: EmptyStateAction;
    secondaryAction?: EmptyStateAction;
    headingLevel?: 'h2' | 'h3' | 'h4';
}>;

const taskClassificationNames: Readonly<Record<TaskTimeClassification, string>> = {
    overdue: '逾期',
    today: '今天',
    'near-due': '即将到期',
    future: '未来',
    completed: '已完成',
    skipped: '已跳过',
    TBA: 'TBA',
};

const taskOccurrenceActionLabels: Readonly<Record<TaskOccurrenceAction, string>> = {
    complete: '完成',
    skip: '跳过',
    restore: '恢复待完成',
};

const meetingClassificationNames: Readonly<Record<MeetingTimeClassification, string>> = {
    upcoming: '即将开始',
    'in-progress': '进行中',
    ended: '已结束',
    cancelled: '已取消',
    'holiday-suppressed': '假期抑制',
};

const courseColorNames: Readonly<Record<CourseColor, string>> = {
    red: '红色',
    orange: '橙色',
    yellow: '黄色',
    green: '绿色',
    blue: '蓝色',
    purple: '紫色',
    gray: '灰色',
};

const weekdayNames: Readonly<Record<MeetingSeriesProjection['weekday'], string>> = {
    MON: '星期一',
    TUE: '星期二',
    WED: '星期三',
    THU: '星期四',
    FRI: '星期五',
    SAT: '星期六',
    SUN: '星期日',
};

const calendarWeekdayNames = [
    '星期日',
    '星期一',
    '星期二',
    '星期三',
    '星期四',
    '星期五',
    '星期六',
] as const;

const percentageFormatter = new Intl.NumberFormat('zh-CN', {
    style: 'percent',
    maximumFractionDigits: 0,
});

/**
 * Dispatches one fixed navigation destination to its pure presentation component.
 *
 * @param {WorkspacePageProps} props Existing setup/PLAN facts, route, and executable handlers.
 * @return {ReactElement} Selected Workspace page.
 */
export function WorkspacePage(props: WorkspacePageProps): ReactElement {
    const { page, ...contentProps } = props;

    if (page === 'today') {
        return <TodayPage {...contentProps} />;
    }
    if (page === 'courses') {
        return <CoursesPage {...contentProps} />;
    }
    if (page === 'calendar') {
        return <CalendarPage {...contentProps} />;
    }
    if (page === 'tasks') {
        return <TasksPage {...contentProps} />;
    }

    return <FilesPage {...contentProps} />;
}

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
 * Renders current setup Course facts without synthesizing missing meetings.
 *
 * @param {WorkspacePageContentProps} props Existing setup facts and executable handlers.
 * @return {ReactElement} Course list page.
 */
export function CoursesPage(props: WorkspacePageContentProps): ReactElement {
    const { setup, setupIncomplete } = props;
    const currentTermId = setup.currentTerm?.termId;
    const historicalMode = currentTermId === undefined
        && !setupIncomplete
        && setup.everReachedMinimum;
    const currentCourses = currentTermId
        ? setup.courses.filter(course => course.termId === currentTermId && !course.archived)
        : [];
    const displayedCourses = historicalMode ? setup.courses : currentCourses;

    return (
        <article
            aria-labelledby="courses-page-title"
            className="workspace-page workspace-page--courses"
        >
            <PageHeader
                context={historicalMode
                    ? `${displayedCourses.length} 门历史课程`
                    : `${termContext(setup)} · ${displayedCourses.length} 门课程`}
                eyebrow="Courses"
                headingId="courses-page-title"
                title="课程"
            />
            {setupIncomplete ? <SetupIncompleteNotice onContinueSetup={props.onContinueSetup} /> : null}
            <section
                aria-labelledby="course-list-title"
                className="page-section"
            >
                <h2
                    className={historicalMode ? undefined : 'visually-hidden'}
                    id="course-list-title"
                >{historicalMode ? '历史课程' : '当前学期课程'}</h2>
                {displayedCourses.length === 0 ? (
                    <EmptyState
                        action={buttonAction('继续设置', props.onContinueSetup)}
                        id="courses-empty"
                        reason={historicalMode
                            ? '曾达到最低设置条件，但当前投影没有可显示的历史课程。'
                            : currentTermId
                            ? '最低设置条件还缺少当前学期课程，因此这里没有课程事实。'
                            : '尚无当前学期，无法确定要显示哪一组课程；历史课程不会冒充当前课程。'}
                        title={historicalMode
                            ? '没有可显示的历史课程'
                            : currentTermId
                                ? '当前学期还没有课程'
                                : '尚无当前学期'}
                    />
                ) : (
                    <div className="workspace-grid workspace-grid--courses">
                        {displayedCourses.map(course => (
                            <CourseCard
                                course={course}
                                historical={historicalMode}
                                key={course.courseId}
                                onContinueSetup={props.onContinueSetup}
                            />
                        ))}
                    </div>
                )}
            </section>
        </article>
    );
}

/**
 * Renders the unified seven-day Calendar, Agenda, warnings, and separate TBA group.
 *
 * @param {WorkspacePageContentProps} props Existing PLAN facts and executable handlers.
 * @return {ReactElement} Calendar page.
 */
export function CalendarPage(props: WorkspacePageContentProps): ReactElement {
    const { plan, setup, setupIncomplete } = props;

    return (
        <article
            aria-labelledby="calendar-page-title"
            className="workspace-page workspace-page--calendar"
        >
            <PageHeader
                context={termContext(setup)}
                eyebrow="Calendar"
                headingId="calendar-page-title"
                title="日历"
            />
            {setupIncomplete ? <SetupIncompleteNotice onContinueSetup={props.onContinueSetup} /> : null}
            {!plan ? (
                <PlanUnavailable
                    {...props}
                    fallbackActionLabel="返回 Today"
                    fallbackPage="today"
                />
            ) : (
                <CalendarContent
                    onNavigate={props.onNavigate}
                    plan={plan}
                />
            )}
        </article>
    );
}

/**
 * Renders classified known-deadline Tasks and TBA Tasks from the same PLAN projection.
 *
 * @param {WorkspacePageContentProps} props Existing PLAN facts and executable handlers.
 * @return {ReactElement} Task list page.
 */
export function TasksPage(props: WorkspacePageContentProps): ReactElement {
    const { plan, setup, setupIncomplete } = props;
    const knownTasks = plan?.tasks.filter(task => task.classification !== 'TBA') ?? [];

    return (
        <article
            aria-labelledby="tasks-page-title"
            className="workspace-page workspace-page--tasks"
        >
            <PageHeader
                context={termContext(setup)}
                eyebrow="Tasks"
                headingId="tasks-page-title"
                title="任务"
            />
            {setupIncomplete ? <SetupIncompleteNotice onContinueSetup={props.onContinueSetup} /> : null}
            {!plan ? (
                <PlanUnavailable
                    {...props}
                    fallbackActionLabel="返回 Today"
                    fallbackPage="today"
                />
            ) : (
                <div className="workspace-grid workspace-grid--tasks">
                    <section
                        aria-labelledby="scheduled-tasks-title"
                        className="content-card scheduled-tasks-card"
                    >
                        <h2 id="scheduled-tasks-title">已排期任务</h2>
                        {knownTasks.length === 0 ? (
                            <EmptyState
                                action={plan.tba.tasks.length > 0
                                    ? linkAction('查看 TBA 任务', '#tba-task-list')
                                    : buttonAction('添加任务', props.onCreateTask)}
                                id="scheduled-tasks-empty"
                                reason={plan.tba.tasks.length > 0
                                    ? '当前学期没有已排期任务；未确定日期的任务仍在 TBA 分组。'
                                    : '统一计划投影确认当前学期没有任务，因此列表不会填入示例事项。'}
                                secondaryAction={plan.tba.tasks.length > 0
                                    ? buttonAction('添加任务', props.onCreateTask)
                                    : buttonAction('查看课程', () => props.onNavigate('courses'))}
                                title={plan.tba.tasks.length > 0
                                    ? '当前没有已排期任务'
                                    : '当前学期还没有任务'}
                            />
                        ) : (
                            <ul className="fact-list task-list">
                                {knownTasks.map(task => (
                                    <TaskItem
                                        actions={props.taskActions}
                                        key={taskItemId(task)}
                                        task={task}
                                    />
                                ))}
                            </ul>
                        )}
                    </section>

                    <section
                        aria-labelledby="tba-tasks-title"
                        className="content-card tba-tasks-card"
                        id="tba-task-list"
                    >
                        <h2 id="tba-tasks-title">TBA</h2>
                        <p className="section-intro">日期或时间尚未确定；这些任务不参与倒计时与逾期判断。</p>
                        {plan.tba.tasks.length === 0 ? (
                            <EmptyState
                                action={buttonAction('添加任务', props.onCreateTask)}
                                id="tba-tasks-empty"
                                reason="统一计划投影中的任务都已有日期或时间，没有需要补充日期的事项。"
                                title="没有 TBA 任务"
                            />
                        ) : (
                            <ul className="fact-list task-list task-list--tba">
                                {plan.tba.tasks.map(task => (
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
            )}
        </article>
    );
}

/**
 * Renders an honest unavailable Files surface without inventing file capabilities.
 *
 * @param {WorkspacePageContentProps} props Existing setup state and bounded exit handlers.
 * @return {ReactElement} Files page.
 */
export function FilesPage(props: WorkspacePageContentProps): ReactElement {
    return (
        <article
            aria-labelledby="files-page-title"
            className="workspace-page workspace-page--files"
        >
            <PageHeader
                context={termContext(props.setup)}
                eyebrow="Files"
                headingId="files-page-title"
                title="文件"
            />
            <section
                aria-labelledby="files-state-title"
                className="content-card files-state-card"
            >
                <h2 id="files-state-title">资料库事实不可用</h2>
                <EmptyState
                    action={buttonAction('返回 Today', () => props.onNavigate('today'))}
                    headingLevel="h3"
                    id="files-empty"
                    reason="当前 Workspace 没有提供资料库投影，因此不能判断文件列表是否为空。"
                    secondaryAction={props.setupIncomplete
                        ? buttonAction('继续设置', props.onContinueSetup)
                        : undefined}
                    title="无法显示文件列表"
                />
            </section>
        </article>
    );
}

/**
 * Renders a consistent page title and real Term context.
 *
 * @param {Object} props Heading identity and visible copy.
 * @return {ReactElement} Page header.
 */
function PageHeader(props: Readonly<{
    eyebrow: string;
    headingId: string;
    title: string;
    context: string;
}>): ReactElement {
    return (
        <header className="workspace-page-header">
            <p className="eyebrow">{props.eyebrow}</p>
            <h1
                id={props.headingId}
                tabIndex={-1}
            >{props.title}</h1>
            <p className="page-context">{props.context}</p>
        </header>
    );
}

/**
 * Announces that first-run setup still has missing minimum facts.
 *
 * @param {Object} props Executable setup continuation handler.
 * @return {ReactElement} Non-color setup status.
 */
function SetupIncompleteNotice(props: Readonly<{ onContinueSetup: () => void }>): ReactElement {
    return (
        <aside
            aria-labelledby="setup-incomplete-title"
            className="status-banner status-banner--setup"
        >
            <div>
                <h2 id="setup-incomplete-title">设置未完成</h2>
                <p role="status">缺少最低设置事实的区域会保持真实空状态；已保存的区域仍可使用。</p>
            </div>
            <button
                className="secondary-action"
                onClick={props.onContinueSetup}
                type="button"
            >继续设置</button>
        </aside>
    );
}

/**
 * Shows the real post-Term route without treating an inapplicable PLAN query as a failure.
 *
 * @param {Object} props Historical setup facts and executable navigation actions.
 * @return {ReactElement} Completed-Term status nested inside the white emphasis card.
 */
function EndedTermState(props: Readonly<{
    onCreateTerm: () => void;
    onViewHistory: () => void;
    setup: SetupProjection;
}>): ReactElement {
    const latestTerm = props.setup.terms.reduce<TermProjection | null>((latest, candidate) => {
        if (latest === null
            || candidate.endDate > latest.endDate
            || (candidate.endDate === latest.endDate && candidate.termId > latest.termId)) {
            return candidate;
        }
        return latest;
    }, null);

    return (
        <section
            aria-labelledby="ended-term-title"
            className="content-card emphasis-card term-ended-card"
        >
            <div className="emphasis-layer">
                <p className="status-label">历史状态</p>
                <h2 id="ended-term-title">学期已结束</h2>
                <p role="status">
                    {latestTerm?.name ?? '最近学期'} 已结束；日期进度保持 100%，历史课程和课节仍保留。
                </p>
                <div className="term-ended-actions">
                    <button
                        className="primary-action"
                        onClick={props.onCreateTerm}
                        type="button"
                    >创建新学期</button>
                    <button
                        className="secondary-action"
                        onClick={props.onViewHistory}
                        type="button"
                    >查看历史课程</button>
                </div>
            </div>
        </section>
    );
}

/**
 * Distinguishes an unavailable PLAN projection from a valid projection with empty arrays.
 *
 * @param {Object} props Page facts, retry behavior, and bounded fallback destination.
 * @return {ReactElement} Honest projection-unavailable state.
 */
function PlanUnavailable(props: WorkspacePageContentProps & Readonly<{
    fallbackActionLabel: string;
    fallbackPage: WorkspaceNavigationId;
}>): ReactElement {
    const reason = props.planProblem
        ?? (props.setupIncomplete
            ? '最低设置事实尚未齐全，因此目前没有可读取的统一计划投影。'
            : props.setup.currentTerm === null
                ? '当前没有适用的 Current Term，因此没有可读取的统一计划投影。'
                : '统一计划投影未返回，因此不能判断是否真的没有事项。');
    let action = buttonAction(props.fallbackActionLabel, () => props.onNavigate(props.fallbackPage));

    if (props.onRetryPlan) {
        action = buttonAction('重试', props.onRetryPlan);
    } else if (props.setupIncomplete) {
        action = buttonAction('继续设置', props.onContinueSetup);
    }

    return (
        <section
            aria-labelledby="plan-unavailable-section-title"
            className="content-card unavailable-card"
        >
            <h2 id="plan-unavailable-section-title">计划数据当前不可用</h2>
            <EmptyState
                action={action}
                id="plan-unavailable"
                reason={reason}
                title="无法显示计划事项"
            />
        </section>
    );
}

/**
 * Renders a real empty or unavailable state with its reason and executable next step.
 *
 * @param {EmptyStateProps} props Stable heading, reason, and actions.
 * @return {ReactElement} Reusable semantic empty-state block.
 */
function EmptyState(props: EmptyStateProps): ReactElement {
    const Heading = props.headingLevel ?? 'h3';

    return (
        <div
            aria-labelledby={props.id}
            className="empty-state"
            role="group"
        >
            <Heading id={props.id}>{props.title}</Heading>
            <p
                className="empty-state-reason"
                role="status"
            >{props.reason}</p>
            <div className="empty-state-actions">
                <EmptyStateActionView action={props.action} />
                {props.secondaryAction ? <EmptyStateActionView action={props.secondaryAction} /> : null}
            </div>
        </div>
    );
}

/**
 * Renders one button or in-page link without inventing an unavailable action.
 *
 * @param {Object} props One executable empty-state action.
 * @return {ReactElement} Button or link action.
 */
function EmptyStateActionView(props: Readonly<{ action: EmptyStateAction }>): ReactElement {
    if (props.action.kind === 'link') {
        return (
            <a
                className="secondary-action"
                href={props.action.href}
            >{props.action.label}</a>
        );
    }

    return (
        <button
            className="secondary-action"
            onClick={props.action.onAction}
            type="button"
        >{props.action.label}</button>
    );
}

/**
 * Creates a typed button action for an empty state.
 *
 * @param {string} label Visible action label.
 * @param {Function} onAction Executable callback.
 * @return {EmptyStateAction} Typed button action.
 */
function buttonAction(label: string, onAction: () => void): EmptyStateAction {
    return { kind: 'button', label, onAction };
}

/**
 * Creates a typed in-page link action for an empty state.
 *
 * @param {string} label Visible action label.
 * @param {string} href Stable in-page target.
 * @return {EmptyStateAction} Typed link action.
 */
function linkAction(label: string, href: string): EmptyStateAction {
    return { kind: 'link', label, href };
}

/**
 * Renders the next task already selected by PLAN.
 *
 * @param {Object} props Size label, selected projection, and Task-page action.
 * @return {ReactElement} Next-task card or true empty state.
 */
function NextTaskCard(props: Readonly<{
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
function WeekSummary(props: Readonly<{
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

/**
 * Renders one Course and its persisted meeting rules.
 *
 * @param {Object} props Course projection and executable setup action.
 * @return {ReactElement} Course card.
 */
function CourseCard(props: Readonly<{
    course: CourseProjection;
    historical?: boolean;
    onContinueSetup: () => void;
}>): ReactElement {
    const { course } = props;
    const colorName = course.color ? courseColorNames[course.color] : '未设置';
    const colorClass = course.color ?? 'neutral';

    return (
        <article
            className={`content-card course-card course-card--${colorClass}`}
            data-item-id={course.courseId}
        >
            <header className="course-card-header">
                <p className="status-label">
                    {course.archived ? '已归档' : props.historical ? '历史' : '当前'}
                </p>
                <h2>{course.code}</h2>
                <p>{course.name}</p>
            </header>
            <dl className="course-facts">
                <div>
                    <dt>教学范围</dt>
                    <dd>{course.teachingRange.startDate} – {course.teachingRange.endDate}</dd>
                </div>
                <div>
                    <dt>Section</dt>
                    <dd>{course.section ?? '未设置'}</dd>
                </div>
                <div>
                    <dt>教授</dt>
                    <dd>{course.instructor ?? '未设置'}</dd>
                </div>
                <div>
                    <dt>课程色</dt>
                    <dd>{colorName}</dd>
                </div>
                <div>
                    <dt>学分</dt>
                    <dd>{course.credits ?? '未设置'}</dd>
                </div>
            </dl>
            <section
                aria-labelledby={`course-${course.courseId}-meetings-title`}
                className="course-meetings"
            >
                <h3 id={`course-${course.courseId}-meetings-title`}>课节规则</h3>
                {course.meetings.length === 0 ? (
                    <EmptyState
                        action={buttonAction(
                            props.historical ? '创建新学期' : '继续设置',
                            props.onContinueSetup,
                        )}
                        headingLevel="h4"
                        id={`course-${course.courseId}-meetings-empty`}
                        reason={props.historical
                            ? '这门历史课程没有保存课节规则；不会为它补造日程。'
                            : '这门课程已保存，但还没有真实课节规则。'}
                        title="尚未添加课节"
                    />
                ) : (
                    <ul className="fact-list meeting-rule-list">
                        {course.meetings.map(meeting => (
                            <MeetingRuleItem
                                key={meeting.meetingSeriesId}
                                meeting={meeting}
                            />
                        ))}
                    </ul>
                )}
            </section>
        </article>
    );
}

/**
 * Renders one stable meeting rule from a Course projection.
 *
 * @param {Object} props Meeting-series projection.
 * @return {ReactElement} Meeting rule row.
 */
function MeetingRuleItem(props: Readonly<{ meeting: MeetingSeriesProjection }>): ReactElement {
    const { meeting } = props;

    return (
        <li data-item-id={meeting.meetingSeriesId}>
            <strong>{meeting.type.code} · {meeting.type.name}</strong>
            <span>{weekdayNames[meeting.weekday]} {meeting.localStart}–{meeting.localEnd}</span>
            <span>{meetingLocationLabel(meeting.location)}</span>
            <small>{meeting.effectiveRange.startDate} – {meeting.effectiveRange.endDate}</small>
        </li>
    );
}

/**
 * Renders Calendar and Agenda structures only when a PLAN projection is available.
 *
 * @param {Object} props Unified PLAN and navigation handler.
 * @return {ReactElement} Seven-day Calendar, Agenda, warnings, and TBA group.
 */
function CalendarContent(props: Readonly<{
    plan: PlanProjection;
    onNavigate: (page: WorkspaceNavigationId) => void;
}>): ReactElement {
    const { calendar, agenda, tba } = props.plan;
    const dates = sevenDayDates(calendar.window.startDate);
    const timedPlacements = calendarTimedPlacements(
        calendar.timedItems,
        props.plan.evaluationContext.termZone,
    );
    const agendaGroups = groupAgendaItems(
        agenda.items,
        props.plan.evaluationContext.termZone,
        calendar.window.startDate,
    );
    const hasCalendarFacts = calendar.timedItems.length > 0
        || calendar.allDayItems.length > 0
        || calendar.holidaySegments.length > 0;

    return (
        <>
            <section
                aria-labelledby="calendar-week-title"
                className="content-card calendar-card"
            >
                <h2 id="calendar-week-title">七日课表</h2>
                <p className="page-context">
                    <time dateTime={calendar.window.startDate}>{calendar.window.startDate}</time>
                    {' – '}
                    <time dateTime={calendar.window.endDate}>{calendar.window.endDate}</time>
                </p>
                <div
                    aria-label="可横向滚动的七日课表"
                    className="calendar-scroll-region"
                    tabIndex={0}
                >
                    <div className="calendar-grid-shell">
                        <div
                            aria-hidden="true"
                            className="calendar-grid-corner"
                        >日期</div>
                        <ol className="calendar-day-grid">
                            {dates.map(date => (
                                <li
                                    className="calendar-day-column"
                                    data-current={
                                        date === props.plan.evaluationContext.applicableDate
                                            ? 'true'
                                            : undefined
                                    }
                                    data-day={date}
                                    key={date}
                                >
                                    <time
                                        aria-current={
                                            date === props.plan.evaluationContext.applicableDate
                                                ? 'date'
                                                : undefined
                                        }
                                        dateTime={date}
                                    >{date}</time>
                                    {date === props.plan.evaluationContext.applicableDate ? (
                                        <span className="calendar-current-label">今天</span>
                                    ) : null}
                                </li>
                            ))}
                        </ol>
                        <div className="calendar-all-day-label">全天</div>
                        <ol
                            aria-label="全天事项和日期范围"
                            className="calendar-all-day-grid"
                        >
                            {calendar.holidaySegments.map(holiday => (
                                <CalendarHolidayItem
                                    dates={dates}
                                    holiday={holiday}
                                    key={calendarHolidayItemId(holiday)}
                                />
                            ))}
                            {calendar.allDayItems.map(task => (
                                <CalendarAllDayTaskItem
                                    dates={dates}
                                    key={taskItemId(task)}
                                    task={task}
                                />
                            ))}
                        </ol>
                        <ol
                            aria-hidden="true"
                            className="calendar-time-labels"
                        >
                            {calendarHourLabels().map(label => (
                                <li key={label}>{label}</li>
                            ))}
                        </ol>
                        <ol
                            aria-label="按日期和时间排列的事项"
                            className="calendar-time-grid"
                        >
                            {dates.map(date => (
                             <li
                                className="calendar-time-column"
                                data-calendar-date={date}
                                data-current={
                                    date === props.plan.evaluationContext.applicableDate
                                        ? 'true'
                                        : undefined
                                }
                                key={date}
                             >
                                <time
                                    className="visually-hidden"
                                    dateTime={date}
                                >{date}</time>
                                <ol className="calendar-timed-item-list">
                                    {timedPlacements.filter(placement => placement.date === date).map(
                                        placement => (
                                            <CalendarTimedItem
                                                key={`${planItemId(placement.item)}:${placement.date}`}
                                                placement={placement}
                                            />
                                        ),
                                    )}
                                </ol>
                             </li>
                            ))}
                        </ol>
                    </div>
                </div>
                {!hasCalendarFacts ? (
                    <p
                        className="calendar-empty-status"
                        role="status"
                    >此七日网格没有已排期事项。</p>
                ) : null}
            </section>

            <div className="workspace-grid workspace-grid--calendar-details">
                <section
                    aria-labelledby="agenda-title"
                    className="content-card agenda-card"
                >
                    <h2 id="agenda-title">议程</h2>
                    {agenda.items.length === 0 ? (
                        <EmptyState
                            action={tba.tasks.length > 0
                                ? buttonAction('查看任务页', () => props.onNavigate('tasks'))
                                : buttonAction('查看课程', () => props.onNavigate('courses'))}
                            id="agenda-empty"
                            reason={tba.tasks.length > 0
                                ? '当前范围没有已排期事项；尚未确定日期的任务仍保留在 TBA 分组。'
                                : '统一计划投影确认当前范围没有课节、任务或假期。'}
                            title="当前范围没有已排期事项"
                        />
                    ) : (
                        <div className="agenda-groups">
                            {agendaGroups.map(group => {
                                const groupKey = group.date ?? 'tba';
                                return (
                                    <section
                                        aria-labelledby={`agenda-date-${groupKey}`}
                                        className="agenda-date-group"
                                        data-agenda-date={groupKey}
                                        key={groupKey}
                                    >
                                        <h3 id={`agenda-date-${groupKey}`}>
                                            {group.date === null
                                                ? '日期待定'
                                                : <time dateTime={group.date}>{group.date}</time>}
                                        </h3>
                                        <ul className="fact-list agenda-list">
                                            {group.items.map(item => (
                                                <AgendaItem
                                                    item={item}
                                                    key={agendaItemId(item)}
                                                />
                                            ))}
                                        </ul>
                                    </section>
                                );
                            })}
                        </div>
                    )}
                    {agenda.warnings.length > 0 ? (
                        <aside
                            aria-labelledby="calendar-conflicts-title"
                            className="calendar-conflicts"
                        >
                            <h3 id="calendar-conflicts-title">时间冲突</h3>
                            <ul className="fact-list conflict-list">
                                {agenda.warnings.map(warning => (
                                    <li
                                        data-item-id={
                                            `${meetingItemId(warning.first)}:${meetingItemId(warning.second)}`
                                        }
                                        key={
                                            `${meetingItemId(warning.first)}:${meetingItemId(warning.second)}`
                                        }
                                    >
                                        <span className="status-label">时间冲突</span>
                                        <p>{warning.first.courseCode} 与 {warning.second.courseCode}</p>
                                        <time dateTime={warning.overlap.startInstant}>
                                            {warning.overlap.startInstant}
                                        </time>
                                        {' – '}
                                        <time dateTime={warning.overlap.endInstant}>
                                            {warning.overlap.endInstant}
                                        </time>
                                    </li>
                                ))}
                            </ul>
                        </aside>
                    ) : null}
                </section>

                <section
                    aria-labelledby="calendar-tba-title"
                    className="content-card calendar-tba-card"
                >
                    <h2 id="calendar-tba-title">TBA</h2>
                    <p className="section-intro">尚无日期或时间的任务不会落入虚构日历位置。</p>
                    {tba.tasks.length === 0 ? (
                        <EmptyState
                            action={buttonAction('查看任务', () => props.onNavigate('tasks'))}
                            id="calendar-tba-empty"
                            reason="统一计划投影中的任务都已有日期或时间。"
                            title="没有 TBA 事项"
                        />
                    ) : (
                        <ul className="fact-list task-list task-list--tba">
                            {tba.tasks.map(task => (
                                <TaskItem
                                    key={taskItemId(task)}
                                    task={task}
                                />
                            ))}
                        </ul>
                    )}
                </section>
            </div>
        </>
    );
}

/**
 * Renders one PLAN meeting occurrence with text status and location.
 *
 * @param {Object} props Meeting projection.
 * @return {ReactElement} Meeting occurrence row.
 */
function MeetingItem(props: Readonly<{ meeting: PlanMeetingProjection }>): ReactElement {
    const { meeting } = props;

    return (
        <li data-item-id={meetingItemId(meeting)}>
            <span className="status-label">{meetingClassificationNames[meeting.classification]}</span>
            <strong>{meeting.courseCode} · {meeting.occurrence.type}</strong>
            <span>{meeting.occurrence.localStart}–{meeting.occurrence.localEnd}</span>
            <span>{meetingLocationLabel(meeting.occurrence.location)}</span>
        </li>
    );
}

/**
 * Renders one classified PLAN task without reclassifying or inventing a deadline.
 *
 * @param {Object} props Task projection.
 * @return {ReactElement} Task occurrence row.
 */
function TaskItem(props: Readonly<{
    task: PlanTaskProjection;
    actions?: TaskActionPresentation;
}>): ReactElement {
    const { actions, task } = props;
    const itemId = taskItemId(task);
    const availableActions: readonly TaskOccurrenceAction[] = task.occurrence.status === 'pending'
        ? ['complete', 'skip']
        : ['restore'];
    const busy = actions?.busyItemId === itemId;

    return (
        <li
            data-item-id={itemId}
            tabIndex={-1}
        >
            <span className="status-label">{taskClassificationNames[task.classification]}</span>
            <strong>{task.occurrence.title}</strong>
            <span>{task.courseCode} · {task.occurrence.size === 'small' ? '小任务' : '大任务'}</span>
            <span>{taskDeadlineLabel(task.occurrence.deadline)}</span>
            {task.occurrence.displayProgress === null ? null : (
                <span>进度 {task.occurrence.displayProgress}%</span>
            )}
            {actions === undefined ? null : (
                <div
                    aria-label={`${task.occurrence.title} 状态操作`}
                    className="task-direct-actions"
                    role="group"
                >
                    {availableActions.map(action => (
                        <button
                            data-task-action={action}
                            disabled={!actions.writable
                                || actions.busyItemId !== null
                                || !actions.canRunAction(task, action)}
                            key={action}
                            onClick={() => actions.onAction(task, action)}
                            type="button"
                        >{taskOccurrenceActionLabels[action]}</button>
                    ))}
                    {busy ? <small role="status">正在保存任务状态…</small> : null}
                    {!actions.writable ? <small>只读模式</small> : null}
                </div>
            )}
        </li>
    );
}

/**
 * Renders one global, non-focus-stealing Task status/Undo surface.
 *
 * @param {Object} props Renderer task-action presentation and interaction callbacks.
 * @return {ReactElement | null} Visible failure or six-second Undo feedback.
 */
export function TaskActionNotice(props: Readonly<{
    presentation: TaskActionPresentation;
}>): ReactElement | null {
    const { presentation } = props;
    if (presentation.problem === null && presentation.undo === null) {
        return null;
    }

    return (
        <aside
            aria-atomic="true"
            aria-live="polite"
            className="task-action-feedback"
            onBlur={event => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                    presentation.onUndoFocusChange(false);
                }
            }}
            onFocus={() => presentation.onUndoFocusChange(true)}
            onMouseEnter={() => presentation.onUndoHoverChange(true)}
            onMouseLeave={() => presentation.onUndoHoverChange(false)}
        >
            {presentation.problem === null ? null : (
                <p
                    className="task-action-problem"
                    role="alert"
                >{presentation.problem}</p>
            )}
            {presentation.undo === null ? null : (
                <div className="task-undo-toast">
                    <p role="status">{presentation.undo.message}</p>
                    <button
                        disabled={presentation.undo.submitting}
                        onClick={presentation.onUndo}
                        type="button"
                    >{presentation.undo.submitting
                            ? `正在${presentation.undo.actionLabel}…`
                            : presentation.undo.actionLabel}</button>
                </div>
            )}
        </aside>
    );
}

/**
 * Renders one Calendar timed or all-day PLAN item.
 *
 * @param {Object} props Calendar item projection.
 * @return {ReactElement} Calendar event row.
 */
type CalendarTimedPlacement = Readonly<{
    date: string;
    startMinute: number;
    durationMinutes: number;
    continuation: boolean;
    item: PlanMeetingProjection | PlanTaskProjection;
    overlapLane: number;
    overlapLaneCount: number;
}>;

type CalendarEventStyle = CSSProperties & Readonly<{
    '--calendar-event-top': string;
    '--calendar-event-height': string;
    '--calendar-event-left': string;
    '--calendar-event-min-height': string;
    '--calendar-event-width': string;
}>;

const CALENDAR_MINUTE_HEIGHT = 0.55;
const CALENDAR_EVENT_MIN_HEIGHT = 30;
const CALENDAR_EVENT_MIN_DURATION = Math.ceil(
    CALENDAR_EVENT_MIN_HEIGHT / CALENDAR_MINUTE_HEIGHT,
);

/**
 * Renders one timed occurrence inside its exact date lane and vertical minute range.
 *
 * @param {Object} props Placement derived only from existing PLAN occurrence facts.
 * @return {ReactElement} One positioned Calendar event.
 */
function CalendarTimedItem(props: Readonly<{
    placement: CalendarTimedPlacement;
}>): ReactElement {
    const { placement } = props;
    const item = placement.item;
    const style: CalendarEventStyle = {
        '--calendar-event-top': `${placement.startMinute * CALENDAR_MINUTE_HEIGHT}px`,
        '--calendar-event-height': `${placement.durationMinutes * CALENDAR_MINUTE_HEIGHT}px`,
        '--calendar-event-left': `${placement.overlapLane / placement.overlapLaneCount * 100}%`,
        '--calendar-event-min-height': `${CALENDAR_EVENT_MIN_HEIGHT}px`,
        '--calendar-event-width': `${100 / placement.overlapLaneCount}%`,
    };
    const label = item.kind === 'meeting'
        ? `${item.courseCode} · ${item.occurrence.type}`
        : item.occurrence.title;
    const detail = item.kind === 'meeting'
        ? `${item.occurrence.localStart}–${item.occurrence.localEnd}`
        : `${item.courseCode} · ${placement.date} ${minuteLabel(placement.startMinute)}`;

    return (
        <li
            data-item-id={planItemId(item)}
            data-calendar-date={placement.date}
            data-start-minute={placement.startMinute}
            data-duration-minutes={placement.durationMinutes}
            data-continuation={placement.continuation ? 'true' : undefined}
            data-overlap-lane={placement.overlapLane}
            data-overlap-lane-count={placement.overlapLaneCount}
            style={style}
        >
            <span className="status-label">
                {item.kind === 'meeting'
                    ? meetingClassificationNames[item.classification]
                    : taskClassificationNames[item.classification]}
            </span>
            <strong>{label}</strong>
            <span>{detail}</span>
        </li>
    );
}

/**
 * Renders one date-only Task in its existing Calendar date column.
 *
 * @param {Object} props Date-only PLAN task and the visible shared columns.
 * @return {ReactElement} One all-day Task card.
 */
function CalendarAllDayTaskItem(props: Readonly<{
    task: PlanTaskProjection;
    dates: readonly string[];
}>): ReactElement {
    const deadline = props.task.occurrence.deadline;
    const date = deadline.kind === 'date-only' ? deadline.date : '';
    const column = props.dates.indexOf(date) + 1;

    return (
        <li
            className="calendar-all-day-item"
            data-item-id={taskItemId(props.task)}
            data-calendar-date={date}
            style={{ gridColumn: `${column} / ${column + 1}` }}
        >
            <span className="status-label">全天 · {taskClassificationNames[props.task.classification]}</span>
            <strong>{props.task.occurrence.title}</strong>
            <span>{props.task.courseCode}</span>
        </li>
    );
}

/**
 * Renders one continuous Holiday segment in the visible Calendar week.
 *
 * @param {Object} props Holiday segment projection.
 * @return {ReactElement} Holiday lane row.
 */
function CalendarHolidayItem(props: Readonly<{
    holiday: CalendarHolidaySegmentProjection;
    dates: readonly string[];
}>): ReactElement {
    const { holiday } = props;
    const startColumn = props.dates.indexOf(holiday.visibleStartDate) + 1;
    const endColumn = props.dates.indexOf(holiday.visibleEndDate) + 2;

    return (
        <li
            className="calendar-holiday-item"
            data-item-id={calendarHolidayItemId(holiday)}
            data-start-column={startColumn}
            data-end-column={endColumn}
            style={{ gridColumn: `${startColumn} / ${endColumn}` }}
        >
            <span className="status-label">假期</span>
            <strong>{holiday.holidayRange.name}</strong>
            <span>{holiday.visibleStartDate} – {holiday.visibleEndDate}</span>
        </li>
    );
}

/**
 * Renders one Agenda item while preserving its existing PLAN kind.
 *
 * @param {Object} props Agenda item projection.
 * @return {ReactElement} Agenda row.
 */
function AgendaItem(props: Readonly<{ item: AgendaItemProjection }>): ReactElement {
    if (props.item.kind === 'meeting') {
        return <MeetingItem meeting={props.item} />;
    }
    if (props.item.kind === 'task') {
        return <TaskItem task={props.item} />;
    }

    return (
        <li data-item-id={props.item.holidayRange.holidayRangeId}>
            <span className="status-label">假期</span>
            <strong>{props.item.holidayRange.name}</strong>
            <span>{props.item.holidayRange.startDate} – {props.item.holidayRange.endDate}</span>
        </li>
    );
}

type AgendaDateGroup = Readonly<{
    date: string | null;
    items: readonly AgendaItemProjection[];
}>;

/**
 * Groups existing Agenda facts under their real local date without changing item kinds.
 * @param {readonly AgendaItemProjection[]} items PLAN-owned Agenda order.
 * @param {string} termZone Workspace-owned Calendar zone.
 * @param {string} windowStart First visible LocalDate in the requested window.
 * @return {readonly AgendaDateGroup[]} Chronological local-date groups.
 */
function groupAgendaItems(
    items: readonly AgendaItemProjection[],
    termZone: string,
    windowStart: string,
): readonly AgendaDateGroup[] {
    const groups = new Map<string | null, AgendaItemProjection[]>();
    for (const item of items) {
        const date = agendaItemDate(item, termZone, windowStart);
        const group = groups.get(date) ?? [];
        group.push(item);
        groups.set(date, group);
    }

    return [...groups.entries()].toSorted(([first], [second]) => {
        if (first === null) {
            return 1;
        }
        if (second === null) {
            return -1;
        }
        return first.localeCompare(second);
    }).map(([date, groupItems]) => ({ date, items: groupItems }));
}

/**
 * Reads one Agenda fact's local date from its existing occurrence or range.
 * @param {AgendaItemProjection} item PLAN-owned Agenda fact.
 * @param {string} termZone Workspace-owned Calendar zone.
 * @param {string} windowStart First visible LocalDate in the requested window.
 * @return {string | null} LocalDate, or null only for an unexpected TBA Agenda item.
 */
function agendaItemDate(
    item: AgendaItemProjection,
    termZone: string,
    windowStart: string,
): string | null {
    if (item.kind === 'meeting') {
        return item.occurrence.date;
    }
    if (item.kind === 'holiday-range') {
        return item.holidayRange.startDate > windowStart
            ? item.holidayRange.startDate
            : windowStart;
    }
    if (item.occurrence.deadline.kind === 'date-only') {
        return item.occurrence.deadline.date;
    }
    if (item.occurrence.deadline.kind === 'timed') {
        return localInstantParts(item.occurrence.deadline.instant, termZone).date;
    }
    return null;
}

/**
 * Builds the Today heading from the PLAN-owned local date and evaluation Instant.
 * @param {PlanProjection} plan Unified PLAN evaluation context.
 * @return {string} Local weekday followed by a stable time-of-day greeting.
 */
function todayGreetingTitle(plan: PlanProjection): string {
    const applicableDate = new Date(`${plan.evaluationContext.applicableDate}T00:00:00.000Z`);
    const weekday = calendarWeekdayNames[applicableDate.getUTCDay()];
    const localHour = Math.floor(localInstantParts(
        plan.evaluationContext.evaluatedAt,
        plan.evaluationContext.termZone,
    ).minute / 60);
    let greeting = '晚上好';
    if (localHour >= 5 && localHour < 12) {
        greeting = '早上好';
    }
    else if (localHour < 18 && localHour >= 12) {
        greeting = '下午好';
    }
    return `${weekday}，${greeting}`;
}

/**
 * Returns seven stable LocalDate labels for the visible Calendar columns.
 *
 * @param {string} startDate First date from the PLAN-owned Calendar window.
 * @return {readonly string[]} Seven consecutive display dates.
 */
function sevenDayDates(startDate: string): readonly string[] {
    const startCoordinate = Date.parse(`${startDate}T00:00:00.000Z`);
    const millisecondsPerDay = 86_400_000;

    return [0, 1, 2, 3, 4, 5, 6].map(offset => (
        new Date(startCoordinate + offset * millisecondsPerDay).toISOString().slice(0, 10)
    ));
}

/**
 * Converts existing timed PLAN items into date-lane placements without changing their meaning.
 * Overnight Meetings are split at midnight so both visible date columns remain truthful.
 *
 * @param {readonly (PlanMeetingProjection | PlanTaskProjection)[]} items Timed PLAN items.
 * @param {string} termZone Workspace-owned Calendar zone.
 * @return {readonly CalendarTimedPlacement[]} Stable minute placements for the seven-day grid.
 */
function calendarTimedPlacements(
    items: readonly (PlanMeetingProjection | PlanTaskProjection)[],
    termZone: string,
): readonly CalendarTimedPlacement[] {
    const placements = items.flatMap(item => {
        if (item.kind === 'task') {
            if (item.occurrence.deadline.kind !== 'timed') {
                return [];
            }
            const local = localInstantParts(item.occurrence.deadline.instant, termZone);
            return [{
                date: local.date,
                startMinute: local.minute,
                durationMinutes: 30,
                continuation: false,
                item,
            }];
        }

        const startMinute = localTimeMinute(item.occurrence.localStart);
        const endMinute = localTimeMinute(item.occurrence.localEnd);
        const totalDuration = endMinute
            + item.occurrence.endDayOffset * 1_440
            - startMinute;
        const firstDuration = Math.min(totalDuration, 1_440 - startMinute);
        const placements: CalendarTimedPlacementSource[] = [{
            date: item.occurrence.date,
            startMinute,
            durationMinutes: firstDuration,
            continuation: false,
            item,
        }];
        const remainingDuration = totalDuration - firstDuration;
        if (remainingDuration > 0) {
            placements.push({
                date: addCalendarDays(item.occurrence.date, 1),
                startMinute: 0,
                durationMinutes: remainingDuration,
                continuation: true,
                item,
            });
        }
        return placements;
    });
    return assignCalendarOverlapLanes(placements);
}

type CalendarTimedPlacementSource = Omit<
    CalendarTimedPlacement,
    'overlapLane' | 'overlapLaneCount'
>;

/**
 * Assigns non-overlapping visual lanes to each connected overlap cluster.
 * @param {readonly CalendarTimedPlacementSource[]} placements Exact date/minute placements.
 * @return {readonly CalendarTimedPlacement[]} Placements with deterministic lane geometry.
 */
function assignCalendarOverlapLanes(
    placements: readonly CalendarTimedPlacementSource[],
): readonly CalendarTimedPlacement[] {
    const laneByPlacement = new Map<CalendarTimedPlacementSource, Readonly<{
        lane: number;
        laneCount: number;
    }>>();
    const dates = [...new Set(placements.map(placement => placement.date))];

    for (const date of dates) {
        const sorted = placements.filter(placement => placement.date === date).toSorted((first, second) => (
            first.startMinute - second.startMinute
            || second.durationMinutes - first.durationMinutes
            || planItemId(first.item).localeCompare(planItemId(second.item))
        ));
        let cluster: CalendarTimedPlacementSource[] = [];
        let clusterEnd = -1;

        const flushCluster = (): void => {
            const laneEnds: number[] = [];
            const assigned = cluster.map(placement => {
                const availableLane = laneEnds.findIndex(endMinute => endMinute <= placement.startMinute);
                const lane = availableLane === -1 ? laneEnds.length : availableLane;
                laneEnds[lane] = placement.startMinute + Math.max(
                    placement.durationMinutes,
                    CALENDAR_EVENT_MIN_DURATION,
                );
                return { placement, lane };
            });
            for (const value of assigned) {
                laneByPlacement.set(value.placement, {
                    lane: value.lane,
                    laneCount: laneEnds.length,
                });
            }
            cluster = [];
            clusterEnd = -1;
        };

        for (const placement of sorted) {
            if (cluster.length > 0 && placement.startMinute >= clusterEnd) {
                flushCluster();
            }
            cluster.push(placement);
            clusterEnd = Math.max(
                clusterEnd,
                placement.startMinute + Math.max(
                    placement.durationMinutes,
                    CALENDAR_EVENT_MIN_DURATION,
                ),
            );
        }
        if (cluster.length > 0) {
            flushCluster();
        }
    }

    return placements.map(placement => {
        const lane = laneByPlacement.get(placement) ?? { lane: 0, laneCount: 1 };
        return {
            ...placement,
            overlapLane: lane.lane,
            overlapLaneCount: lane.laneCount,
        };
    });
}

/**
 * Converts a canonical Instant to LocalDate and minute-of-day in the Workspace TermZone.
 *
 * @param {string} instant Canonical timed Task deadline.
 * @param {string} timeZone Workspace-owned IANA zone.
 * @return {Object} Local date and minute used by the shared Calendar grid.
 */
function localInstantParts(
    instant: string,
    timeZone: string,
): Readonly<{ date: string; minute: number }> {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(new Date(instant));
    const value = (type: Intl.DateTimeFormatPartTypes): string => (
        parts.find(part => part.type === type)?.value ?? ''
    );
    return {
        date: `${value('year')}-${value('month')}-${value('day')}`,
        minute: Number(value('hour')) * 60 + Number(value('minute')),
    };
}

/**
 * Converts one canonical local clock to minute-of-day.
 *
 * @param {string} value Canonical HH:mm.
 * @return {number} Minute offset from local midnight.
 */
function localTimeMinute(value: string): number {
    const [hour, minute] = value.split(':').map(Number);
    return hour! * 60 + minute!;
}

/**
 * Adds one bounded number of days without consulting the host time zone.
 *
 * @param {string} date Canonical LocalDate.
 * @param {number} days Whole day offset.
 * @return {string} Shifted canonical LocalDate.
 */
function addCalendarDays(date: string, days: number): string {
    const millisecondsPerDay = 86_400_000;
    return new Date(
        Date.parse(`${date}T00:00:00.000Z`) + days * millisecondsPerDay,
    ).toISOString().slice(0, 10);
}

/**
 * Builds the stable labels for the full 24-hour vertical Calendar grid.
 *
 * @return {readonly string[]} One label per hour.
 */
function calendarHourLabels(): readonly string[] {
    return Array.from({ length: 24 }, (_value, hour) => `${String(hour).padStart(2, '0')}:00`);
}

/**
 * Formats one minute-of-day as a local clock.
 *
 * @param {number} minute Minute offset from midnight.
 * @return {string} HH:mm label.
 */
function minuteLabel(minute: number): string {
    const hour = Math.floor(minute / 60);
    return `${String(hour).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/**
 * Returns visible context without substituting a historical or invented Term.
 *
 * @param {SetupProjection} setup Current setup projection.
 * @return {string} Current Term context or an explicit missing state.
 */
function termContext(setup: SetupProjection): string {
    if (!setup.currentTerm) {
        return '尚无当前学期';
    }

    return `${setup.currentTerm.name} · ${setup.currentTerm.startDate} – ${setup.currentTerm.endDate}`;
}

/**
 * Formats a persisted deadline union without assigning TBA to a date.
 *
 * @param {TaskDeadline} deadline Persisted occurrence deadline.
 * @return {string} User-visible deadline fact.
 */
function taskDeadlineLabel(deadline: TaskDeadline): string {
    if (deadline.kind === 'date-only') {
        return deadline.date;
    }
    if (deadline.kind === 'timed') {
        return `${deadline.instant} · ${deadline.timeZone}`;
    }

    return 'TBA';
}

/**
 * Formats PLAN-owned remaining milliseconds for display without selecting or reclassifying a Task.
 *
 * @param {number} remainingMilliseconds Signed duration supplied by PLAN.
 * @return {string} Coarse, stable countdown text.
 */
function remainingTimeLabel(remainingMilliseconds: number): string {
    if (remainingMilliseconds === 0) {
        return '现在到期';
    }

    const magnitude = Math.abs(remainingMilliseconds);
    const prefix = remainingMilliseconds > 0 ? '剩余时间' : '已逾期';
    const minutes = Math.max(1, Math.ceil(magnitude / 60_000));
    if (minutes < 60) {
        return `${prefix}：${minutes} 分钟`;
    }

    const hours = Math.ceil(magnitude / 3_600_000);
    if (hours < 24) {
        return `${prefix}：${hours} 小时`;
    }

    return `${prefix}：${Math.ceil(magnitude / 86_400_000)} 天`;
}

/**
 * Formats a meeting location while preserving TBA as its own state.
 *
 * @param {MeetingLocation} location Persisted meeting location.
 * @return {string} Known location text or TBA.
 */
function meetingLocationLabel(location: MeetingLocation): string {
    return location.kind === 'known' ? location.value : 'TBA';
}

/**
 * Builds the stable identity used for a rendered Task occurrence.
 *
 * @param {PlanTaskProjection} task PLAN task projection.
 * @return {string} Stable Task occurrence identity.
 */
function taskItemId(task: PlanTaskProjection): string {
    const { occurrenceId } = task.occurrence;
    return `task:${occurrenceId.taskSeriesId}:${occurrenceId.originalLogicalAnchor}`;
}

/**
 * Builds the stable identity used for a rendered Meeting occurrence.
 *
 * @param {PlanMeetingProjection} meeting PLAN meeting projection.
 * @return {string} Stable Meeting occurrence identity.
 */
function meetingItemId(meeting: PlanMeetingProjection): string {
    const { occurrenceId } = meeting.occurrence;
    return `meeting:${occurrenceId.meetingSeriesId}:${occurrenceId.originalLogicalAnchor}`;
}

/**
 * Builds the stable identity used for a visible Holiday segment.
 *
 * @param {CalendarHolidaySegmentProjection} holiday Calendar holiday segment.
 * @return {string} Stable range and visible-segment identity.
 */
function calendarHolidayItemId(holiday: CalendarHolidaySegmentProjection): string {
    return [
        'holiday',
        holiday.holidayRange.holidayRangeId,
        holiday.visibleStartDate,
        holiday.visibleEndDate,
    ].join(':');
}

/**
 * Returns a stable key for a Calendar PLAN item.
 *
 * @param {PlanMeetingProjection | PlanTaskProjection} item Calendar item.
 * @return {string} Stable occurrence identity.
 */
function planItemId(item: PlanMeetingProjection | PlanTaskProjection): string {
    return item.kind === 'meeting' ? meetingItemId(item) : taskItemId(item);
}

/**
 * Returns a stable key for an Agenda item.
 *
 * @param {AgendaItemProjection} item Agenda item.
 * @return {string} Stable occurrence or Holiday identity.
 */
function agendaItemId(item: AgendaItemProjection): string {
    if (item.kind === 'meeting') {
        return meetingItemId(item);
    }
    if (item.kind === 'task') {
        return taskItemId(item);
    }

    return `holiday:${item.holidayRange.holidayRangeId}`;
}
