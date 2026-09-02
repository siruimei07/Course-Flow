import { useRef } from 'react';
import type { KeyboardEvent, ReactElement, RefObject } from 'react';
import {
    calendarDayDifference,
    courseColorFor,
    localInstantParts,
    minuteLabel,
    shortWeekdayOf,
    taskClassificationNames,
    taskItemId,
    taskSeverity,
    termContext,
} from './shared';
import { CourseTaskShares, currentTermCourses, termTaskRows, termTaskTotals } from './today';
import {
    EmptyState,
    PageHeader,
    PlanUnavailable,
    SetupIncompleteNotice,
    TaskDirectActions,
    buttonAction,
    linkAction,
} from './widgets';
import type { WorkspaceNavigationId } from '../navigation';
import type { TaskActionPresentation, TaskListPresentation, WorkspacePageContentProps } from '../workspace-pages';
import {
    ALL_TASKS_FILTER,
    resolveTaskListFilter,
    sameTaskListFilter,
    taskListFilterAccepts,
} from '../workspace-view-state';
import type { TaskListFilter } from '../workspace-view-state';
import type { CourseColor, CourseProjection } from '../../shared/workspace-course-contract';
import { compareTasksByDeadline } from '../../shared/workspace-plan-contract';
import type { PlanProjection, PlanTaskProjection, TaskTimeClassification } from '../../shared/workspace-plan-contract';
import type { SetupProjection } from '../../shared/workspace-term-contract';
/** Pending groups in reading order; each group is exactly one PLAN classification. */
export const TASK_GROUP_ORDER: readonly TaskTimeClassification[] = ['overdue', 'today', 'near-due', 'future'];

/** Folded groups under the pending ones; each is exactly one PLAN classification. */
export const TASK_ARCHIVE_ORDER: readonly TaskTimeClassification[] = ['completed', 'skipped'];

export type TaskGroup = Readonly<{
    classification: TaskTimeClassification;
    tasks: readonly PlanTaskProjection[];
    visible: readonly PlanTaskProjection[];
}>;

export type TaskDeadlineCell = Readonly<{
    label: string;
    dateTime: string | null;
    overdueDays: number;
}>;

export type TaskFilterOption = Readonly<{
    filter: TaskListFilter;
    label: string;
    color?: CourseColor | null;
}>;

/**
 * Renders the Term's Tasks grouped by the classification PLAN already gave each occurrence.
 *
 * @param {WorkspacePageContentProps} props Existing PLAN facts, view state, and executable handlers.
 * @return {ReactElement} Task page.
 */
export function TasksPage(props: WorkspacePageContentProps): ReactElement {
    const { plan, setup, setupIncomplete, taskList } = props;
    const options = plan ? taskFilterOptions(plan, setup) : [];
    const filter = resolveTaskListFilter(
        taskList?.filter ?? ALL_TASKS_FILTER,
        options.flatMap(option => (option.filter.kind === 'course' ? [option.filter.courseId] : [])),
    );

    return (
        <article
            aria-labelledby="tasks-page-title"
            className="workspace-page workspace-page--tasks"
        >
            <PageHeader
                actions={(
                    <button
                        className="primary-action"
                        onClick={props.onCreateTask}
                        type="button"
                    >添加任务</button>
                )}
                context={termContext(setup)}
                facts={plan ? <TasksHeadline plan={plan} /> : undefined}
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
                    <TaskGroupsCard
                        filter={filter}
                        onCreateTask={props.onCreateTask}
                        onNavigate={props.onNavigate}
                        onOpenManagement={props.onOpenManagement}
                        options={options}
                        plan={plan}
                        setup={setup}
                        taskActions={props.taskActions}
                        taskList={taskList}
                    />
                    {plan.tasks.length === 0 ? null : (
                        <div className="tasks-side">
                            <TasksByCourseCard
                                plan={plan}
                                selectedCourseId={filter.kind === 'course' ? filter.courseId : null}
                                setup={setup}
                            />
                            <TbaTasksCard
                                filter={filter}
                                plan={plan}
                                setup={setup}
                                taskActions={props.taskActions}
                            />
                        </div>
                    )}
                </div>
            )}
        </article>
    );
}

/**
 * Renders the three page numbers: sums of PLAN per-Course counts and one PLAN list length.
 *
 * 待完成 counts every occurrence that is neither done nor skipped, TBA included, so a student
 * whose only open Tasks are TBA never reads "nothing to do"; 逾期 is part of it.
 *
 * @param {Object} props Unified PLAN projection.
 * @return {ReactElement} Header facts.
 */
export function TasksHeadline(props: Readonly<{ plan: PlanProjection }>): ReactElement {
    const { plan } = props;
    const pending = plan.courses.reduce((total, row) => total + row.pending + row.tba, 0);
    const overdue = plan.courses.reduce((total, row) => total + row.overdue, 0);

    return (
        <dl className="page-headline-stats">
            <div
                className="page-headline-stat"
                data-severity="neutral"
            >
                <dt>待完成</dt>
                <dd>{pending}</dd>
            </div>
            <div
                className="page-headline-stat"
                data-severity={overdue > 0 ? 'critical' : 'neutral'}
            >
                <dt>逾期</dt>
                <dd>{overdue}</dd>
            </div>
            <div
                className="page-headline-stat"
                data-severity="neutral"
            >
                <dt>本周截止</dt>
                <dd>{plan.week.tasks.length}</dd>
            </div>
        </dl>
    );
}

/**
 * Builds the filter chips: 全部, the two sizes, then every current-Term Course with a Task
 * occurrence, in setup order.
 *
 * @param {PlanProjection} plan Unified PLAN projection.
 * @param {SetupProjection} setup Current setup projection.
 * @return {readonly TaskFilterOption[]} Chip options in display order.
 */
export function taskFilterOptions(plan: PlanProjection, setup: SetupProjection): readonly TaskFilterOption[] {
    const courses = currentTermCourses(setup, plan).filter(course => (
        plan.courses.some(row => row.courseId === course.courseId && row.countable + row.skipped > 0)
    ));
    return [
        { filter: ALL_TASKS_FILTER, label: '全部' },
        { filter: { kind: 'size', size: 'large' }, label: '大任务' },
        { filter: { kind: 'size', size: 'small' }, label: '小任务' },
        ...courses.map((course): TaskFilterOption => ({
            filter: { kind: 'course', courseId: course.courseId },
            label: course.code,
            color: course.color,
        })),
    ];
}

/**
 * Puts every PLAN-classified row into the group of its own classification.
 *
 * The order inside a group is PLAN's own deadline comparator, the one `plan.week.tasks`
 * uses, because `plan.tasks` itself arrives in identity order. Ordering rows for display is
 * presentation, not selection.
 *
 * @param {PlanProjection} plan Unified PLAN projection.
 * @param {readonly TaskTimeClassification[]} order Group classifications in reading order.
 * @param {TaskListFilter} filter Renderer view state deciding which rows stay visible.
 * @param {boolean} newestFirst Whether the latest deadline leads, used by the folded groups.
 * @return {readonly TaskGroup[]} One group per requested classification.
 */
export function taskGroups(
    plan: PlanProjection,
    order: readonly TaskTimeClassification[],
    filter: TaskListFilter,
    newestFirst = false,
): readonly TaskGroup[] {
    const compare = compareTasksByDeadline(plan.evaluationContext);
    return order.map(classification => {
        const tasks = plan.tasks
            .filter(task => task.classification === classification)
            .sort((first, second) => (newestFirst ? compare(second, first) : compare(first, second)));
        return {
            classification,
            tasks,
            visible: tasks.filter(task => taskListFilterAccepts(filter, task)),
        };
    });
}

/**
 * Names one deadline relative to the PLAN day while keeping the exact value in `dateTime`.
 *
 * Rows under the 今天 heading show only the clock; every other dated row shows the date,
 * so no fact hides behind a tooltip. The overdue day count is the difference of two PLAN
 * dates, the same arithmetic Today uses for 天后开学.
 *
 * @param {PlanTaskProjection} task PLAN Task projection.
 * @param {PlanProjection} plan Unified PLAN projection.
 * @return {TaskDeadlineCell} Visible label, machine-readable value, and days overdue.
 */
export function taskDeadlineCell(task: PlanTaskProjection, plan: PlanProjection): TaskDeadlineCell {
    const { deadline } = task.occurrence;
    if (deadline.kind === 'tba') {
        return { label: 'TBA', dateTime: null, overdueDays: 0 };
    }
    const { applicableDate, termZone } = plan.evaluationContext;
    const local = deadline.kind === 'timed'
        ? localInstantParts(deadline.instant, termZone)
        : { date: deadline.date, minute: null };
    const clock = local.minute === null ? '' : minuteLabel(local.minute);
    const dateTime = deadline.kind === 'timed' ? deadline.instant : deadline.date;
    const overdueDays = task.classification === 'overdue'
        ? Math.max(0, calendarDayDifference(local.date, applicableDate))
        : 0;
    if (task.classification === 'today') {
        return { label: clock === '' ? '今天' : clock, dateTime, overdueDays };
    }
    let day = `${local.date.slice(5)} ${shortWeekdayOf(local.date)}`;
    if (local.date === applicableDate) {
        day = '今天';
    } else if (local.date.slice(0, 4) !== applicableDate.slice(0, 4)) {
        day = `${local.date} ${shortWeekdayOf(local.date)}`;
    }

    return {
        label: clock === '' ? day : `${day} ${clock}`,
        dateTime,
        overdueDays,
    };
}

/**
 * Renders the grouped register: filter chips, the four pending groups, and the folded archive.
 *
 * @param {Object} props PLAN facts, Course colours, view state, Task actions, and handlers.
 * @return {ReactElement} 按截止时间 card.
 */
export function TaskGroupsCard(props: Readonly<{
    plan: PlanProjection;
    setup: SetupProjection;
    filter: TaskListFilter;
    options: readonly TaskFilterOption[];
    taskList?: TaskListPresentation;
    taskActions?: TaskActionPresentation;
    onCreateTask: () => void;
    onNavigate: (page: WorkspaceNavigationId) => void;
    onOpenManagement: WorkspacePageContentProps['onOpenManagement'];
}>): ReactElement {
    const { filter, options, plan, setup, taskList } = props;
    const filterGroupRef = useRef<HTMLDivElement>(null);
    const groups = taskGroups(plan, TASK_GROUP_ORDER, filter);
    const archive = taskGroups(plan, TASK_ARCHIVE_ORDER, filter, true);
    const pending = groups.reduce((total, group) => total + group.tasks.length, 0);
    const visiblePending = groups.reduce((total, group) => total + group.visible.length, 0);
    const filterLabel = options.find(option => sameTaskListFilter(option.filter, filter))?.label ?? '全部';
    const filtered = filter.kind !== 'all';
    const showChips = taskList !== undefined && plan.tasks.length > 0;
    const tba = plan.tasks.filter(task => task.classification === 'TBA').length;
    const nothingPending = plan.next.small.kind === 'empty' && plan.next.large.kind === 'empty';
    const beforeTerm = plan.evaluationContext.applicableDate < plan.term.startDate;
    const clearFilter = (): void => {
        taskList?.onFilterChange(ALL_TASKS_FILTER);
        globalThis.requestAnimationFrame(() => {
            filterGroupRef.current?.querySelector<HTMLElement>('[role="radio"]')?.focus();
        });
    };
    let body: ReactElement | readonly ReactElement[];
    if (plan.tasks.length === 0 && !setup.minimum.hasCurrentTermCourse) {
        body = (
            <EmptyState
                action={buttonAction('添加课程', () => props.onOpenManagement('course'))}
                id="task-groups-empty"
                reason="先添加一门课程，任务会挂在它下面。"
                title="还没有课程"
            />
        );
    } else if (plan.tasks.length === 0) {
        body = (
            <EmptyState
                action={buttonAction('添加任务', props.onCreateTask)}
                id="task-groups-empty"
                reason={beforeTerm
                    ? `学期 ${plan.term.startDate} 开始，还没有任务。`
                    : '给课程添加作业、测验或项目，它们会按截止时间排在这里。'}
                secondaryAction={buttonAction('查看课程', () => props.onNavigate('courses'))}
                title="当前学期还没有任务"
            />
        );
    } else if (nothingPending) {
        body = (
            <EmptyState
                action={buttonAction('添加任务', props.onCreateTask)}
                id="task-groups-empty"
                reason={tba > 0 ? `还有 ${tba} 项没定时间的任务在 TBA 里。` : '本学期的任务都已完成或跳过。'}
                secondaryAction={tba > 0 ? linkAction('查看 TBA 任务', '#tba-task-list') : undefined}
                title="没有待完成的任务"
            />
        );
    } else if (visiblePending === 0) {
        body = (
            <div className="task-filter-empty">
                <p>当前筛选下没有待完成任务。</p>
                <button
                    className="secondary-action"
                    onClick={clearFilter}
                    type="button"
                >清除筛选</button>
            </div>
        );
    } else {
        body = groups.filter(group => group.visible.length > 0).map(group => (
            <TaskGroupSection
                group={group}
                key={group.classification}
                plan={plan}
                setup={setup}
                taskActions={props.taskActions}
            />
        ));
    }

    return (
        <section
            aria-labelledby="task-groups-title"
            className="content-card task-groups-card"
        >
            <div className="card-heading">
                <h2 id="task-groups-title">按截止时间</h2>
                {showChips ? (
                    <p
                        className="page-context task-filter-summary"
                        role="status"
                    >{filtered ? `${filterLabel} · 显示 ${visiblePending} / ${pending} 项` : `共 ${pending} 项`}</p>
                ) : null}
            </div>
            {showChips ? (
                <TaskFilterChips
                    filter={filter}
                    groupRef={filterGroupRef}
                    onSelect={next => taskList.onFilterChange(next)}
                    options={options}
                />
            ) : null}
            {body}
            <TaskArchive
                archive={archive}
                plan={plan}
                setup={setup}
                taskActions={props.taskActions}
            />
        </section>
    );
}

/**
 * Renders the filter as one radio group: one Tab stop, arrow keys move and select.
 *
 * @param {Object} props Chip options, the resolved filter, the group ref, and the select handler.
 * @return {ReactElement} Radio group of chips.
 */
export function TaskFilterChips(props: Readonly<{
    options: readonly TaskFilterOption[];
    filter: TaskListFilter;
    groupRef: RefObject<HTMLDivElement | null>;
    onSelect: (next: TaskListFilter) => void;
}>): ReactElement {
    const { options } = props;
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        const radios = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
        const index = radios.findIndex(radio => radio === document.activeElement);
        if (index < 0) {
            return;
        }
        const steps: Readonly<Record<string, number>> = {
            ArrowRight: index + 1,
            ArrowDown: index + 1,
            ArrowLeft: index - 1,
            ArrowUp: index - 1,
            Home: 0,
            End: radios.length - 1,
        };
        const step = steps[event.key];
        if (step === undefined) {
            return;
        }
        event.preventDefault();
        const next = (step + radios.length) % radios.length;
        radios[next]?.focus();
        const option = options[next];
        if (option !== undefined) {
            props.onSelect(option.filter);
        }
    };

    return (
        <div
            aria-label="筛选任务"
            className="task-filter"
            onKeyDown={onKeyDown}
            ref={props.groupRef}
            role="radiogroup"
        >
            {options.map(option => {
                const checked = sameTaskListFilter(props.filter, option.filter);
                const course = option.filter.kind === 'course';
                const key = option.filter.kind === 'course'
                    ? option.filter.courseId
                    : `${option.filter.kind}:${option.label}`;
                return (
                    <button
                        aria-checked={checked}
                        className={course ? 'task-filter-chip task-filter-chip--course' : 'task-filter-chip'}
                        key={key}
                        onClick={() => props.onSelect(option.filter)}
                        role="radio"
                        tabIndex={checked ? 0 : -1}
                        type="button"
                    >
                        {course ? (
                            <span
                                aria-hidden="true"
                                className="course-dot"
                                data-course-color={option.color ?? undefined}
                            />
                        ) : null}
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}

/**
 * Renders one classification group: a heading with the visible count over hairline rows.
 *
 * @param {Object} props Group, Course colours, PLAN dates, and Task actions.
 * @return {ReactElement} Group block.
 */
export function TaskGroupSection(props: Readonly<{
    group: TaskGroup;
    plan: PlanProjection;
    setup: SetupProjection;
    taskActions?: TaskActionPresentation;
}>): ReactElement {
    const { group } = props;
    const headingId = `task-group-${group.classification}`;

    return (
        <div
            className="task-group"
            data-classification={group.classification}
        >
            <h3
                className="task-group-title"
                data-severity={taskSeverity(group.classification)}
                id={headingId}
            >
                {taskClassificationNames[group.classification]}
                {' '}
                <span className="task-group-count">{group.visible.length} 项</span>
            </h3>
            <ol
                aria-labelledby={headingId}
                className="task-rows"
            >
                {group.visible.map(task => (
                    <TaskRow
                        actions={props.taskActions}
                        color={courseColorFor(props.setup, task.courseId)}
                        deadline={taskDeadlineCell(task, props.plan)}
                        key={taskItemId(task)}
                        task={task}
                    />
                ))}
            </ol>
        </div>
    );
}

/**
 * Renders one Task row: Course dot, title and meta, deadline, and direct actions.
 *
 * The row keeps `data-item-id` and `tabindex="-1"` so the Shell can return focus to it
 * after an action; the group heading already names the state, so no chip repeats it.
 *
 * @param {Object} props Task projection, Course colour, deadline cell, and Task actions.
 * @return {ReactElement} Task row.
 */
export function TaskRow(props: Readonly<{
    task: PlanTaskProjection;
    color: CourseColor | null;
    deadline: TaskDeadlineCell | null;
    actions?: TaskActionPresentation;
}>): ReactElement {
    const { deadline, task } = props;
    const { occurrence } = task;

    return (
        <li
            data-item-id={taskItemId(task)}
            tabIndex={-1}
        >
            <span
                aria-hidden="true"
                className="course-dot"
                data-course-color={props.color ?? undefined}
            />
            <div className="task-row-text">
                <strong>{occurrence.title}</strong>
                <span className="task-row-meta">
                    <span>{task.courseCode} · {occurrence.size === 'small' ? '小任务' : '大任务'}</span>
                    {occurrence.displayProgress === null ? null : <span>进度 {occurrence.displayProgress}%</span>}
                </span>
            </div>
            {deadline === null ? null : (
                <span className="task-row-deadline">
                    {deadline.dateTime === null
                        ? <span>{deadline.label}</span>
                        : <time dateTime={deadline.dateTime}>{deadline.label}</time>}
                    {deadline.overdueDays > 0
                        ? <span className="task-row-overdue">逾期 {deadline.overdueDays} 天</span>
                        : null}
                </span>
            )}
            {props.actions === undefined ? null : (
                <TaskDirectActions
                    actions={props.actions}
                    task={task}
                />
            )}
        </li>
    );
}

/**
 * Renders the folded completed and skipped groups, or nothing when neither has a row.
 *
 * Under a filter the disclosure stays mounted even when every archived row is hidden, so the
 * browser keeps its open state and the summary stays reachable.
 *
 * @param {Object} props Archive groups, Course colours, PLAN dates, and Task actions.
 * @return {ReactElement | null} Native disclosure over the archive groups.
 */
export function TaskArchive(props: Readonly<{
    archive: readonly TaskGroup[];
    plan: PlanProjection;
    setup: SetupProjection;
    taskActions?: TaskActionPresentation;
}>): ReactElement | null {
    const visible = props.archive.filter(group => group.visible.length > 0);
    if (!props.archive.some(group => group.tasks.length > 0)) {
        return null;
    }
    const count = (classification: TaskTimeClassification): number => (
        props.archive.find(group => group.classification === classification)?.visible.length ?? 0
    );

    return (
        <details className="task-archive">
            <summary>
                <span>已完成 {count('completed')} 项 · 已跳过 {count('skipped')} 项</span>
                <svg
                    aria-hidden="true"
                    className="course-chevron"
                    viewBox="0 0 16 16"
                ><path d="M4 6l4 4 4-4" /></svg>
            </summary>
            {visible.length === 0 ? (
                <p className="task-rows-empty">当前筛选下没有已完成或已跳过的任务。</p>
            ) : visible.map(group => (
                <TaskGroupSection
                    group={group}
                    key={group.classification}
                    plan={props.plan}
                    setup={props.setup}
                    taskActions={props.taskActions}
                />
            ))}
        </details>
    );
}

/**
 * Renders the per-Course completion PLAN summarised, echoing the checked Course chip.
 *
 * @param {Object} props PLAN summary, Setup colours, and the filtered Course identity.
 * @return {ReactElement} 按课程 card.
 */
export function TasksByCourseCard(props: Readonly<{
    plan: PlanProjection;
    setup: SetupProjection;
    selectedCourseId: string | null;
}>): ReactElement {
    const rows = termTaskRows(props.plan, props.setup);
    const totals = termTaskTotals(rows);

    return (
        <section
            aria-labelledby="tasks-by-course-title"
            className="content-card by-course-card"
        >
            <div className="card-heading">
                <h2 id="tasks-by-course-title">按课程</h2>
                <p className="term-tasks-percent">{totals.percent}%</p>
            </div>
            <p className="page-context">{totals.countable === 0
                ? '还没有任务。'
                : `已完成 ${totals.completed} / ${totals.countable} 项`}</p>
            {totals.countable === 0 ? null : (
                <CourseTaskShares
                    rows={rows}
                    selectedCourseId={props.selectedCourseId}
                />
            )}
        </section>
    );
}

/**
 * Renders the pending Tasks PLAN classified as TBA; they never enter a deadline group.
 *
 * @param {Object} props PLAN facts, Course colours, the filter, and Task actions.
 * @return {ReactElement} TBA card.
 */
export function TbaTasksCard(props: Readonly<{
    plan: PlanProjection;
    setup: SetupProjection;
    filter: TaskListFilter;
    taskActions?: TaskActionPresentation;
}>): ReactElement {
    const tasks = props.plan.tasks.filter(task => task.classification === 'TBA');
    const visible = tasks.filter(task => taskListFilterAccepts(props.filter, task));
    const filtered = props.filter.kind !== 'all' && tasks.length > 0;

    return (
        <section
            aria-labelledby="tba-tasks-title"
            className="content-card tba-tasks-card"
            id="tba-task-list"
        >
            <div className="card-heading">
                <h2 id="tba-tasks-title">TBA</h2>
                <p className="page-context">{filtered
                    ? `显示 ${visible.length} / ${tasks.length} 项`
                    : `${tasks.length} 项`}</p>
            </div>
            {tasks.length === 0 ? (
                <p className="task-rows-empty">每个任务都有日期了。</p>
            ) : visible.length === 0 ? (
                <p className="task-rows-empty">当前筛选下没有 TBA 任务。</p>
            ) : (
                <>
                    <p className="section-intro">还没定日期或时间，不算倒计时，也不会逾期。</p>
                    <ol
                        aria-labelledby="tba-tasks-title"
                        className="task-rows"
                    >
                        {visible.map(task => (
                            <TaskRow
                                actions={props.taskActions}
                                color={courseColorFor(props.setup, task.courseId)}
                                deadline={null}
                                key={taskItemId(task)}
                                task={task}
                            />
                        ))}
                    </ol>
                </>
            )}
        </section>
    );
}
