import type { ReactElement } from 'react';
import { taskItemId, termContext } from './shared';
import { EmptyState, PageHeader, PlanUnavailable, SetupIncompleteNotice, TaskItem, buttonAction, linkAction } from './widgets';
import type { WorkspacePageContentProps } from '../workspace-pages';
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
                actions={(
                    <button
                        className="primary-action"
                        onClick={props.onCreateTask}
                        type="button"
                    >添加任务</button>
                )}
                context={termContext(setup)}
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
                                        termZone={plan.evaluationContext.termZone}
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
                                        termZone={plan.evaluationContext.termZone}
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
