import type { ReactElement } from 'react';
import type { WorkspaceNavigationId } from '../navigation';
import { meetingClassificationNames, meetingItemId, meetingLocationLabel, taskClassificationNames, taskDeadlineLabel, taskItemId, taskOccurrenceActionLabels } from './shared';
import type { TaskOccurrenceAction } from '../task-occurrence-actions';
import type { TaskActionPresentation, WorkspacePageContentProps } from '../workspace-pages';
import { PlanMeetingProjection, PlanTaskProjection } from '../../shared/workspace-plan-contract';
import type { SetupProjection, TermProjection } from '../../shared/workspace-term-contract';
export type EmptyStateAction =
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

export type EmptyStateProps = Readonly<{
    id: string;
    title: string;
    reason: string;
    action: EmptyStateAction;
    secondaryAction?: EmptyStateAction;
    headingLevel?: 'h2' | 'h3' | 'h4';
}>;

/**
 * Renders a consistent page title and real Term context.
 *
 * @param {Object} props Heading identity and visible copy.
 * @return {ReactElement} Page header.
 */
export function PageHeader(props: Readonly<{
    eyebrow: string;
    headingId: string;
    title: string;
    context: string;
    actions?: ReactElement;
}>): ReactElement {
    return (
        <header className="workspace-page-header">
            <p className="eyebrow">{props.eyebrow}</p>
            <h1
                id={props.headingId}
                tabIndex={-1}
            >{props.title}</h1>
            <p className="page-context">{props.context}</p>
            {props.actions === undefined ? null : (
                <div className="workspace-page-actions">{props.actions}</div>
            )}
        </header>
    );
}

/**
 * Announces that first-run setup still has missing minimum facts.
 *
 * @param {Object} props Executable setup continuation handler.
 * @return {ReactElement} Non-color setup status.
 */
export function SetupIncompleteNotice(props: Readonly<{ onContinueSetup: () => void }>): ReactElement {
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
export function EndedTermState(props: Readonly<{
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
export function PlanUnavailable(props: WorkspacePageContentProps & Readonly<{
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
export function EmptyState(props: EmptyStateProps): ReactElement {
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
export function EmptyStateActionView(props: Readonly<{ action: EmptyStateAction }>): ReactElement {
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
export function buttonAction(label: string, onAction: () => void): EmptyStateAction {
    return { kind: 'button', label, onAction };
}

/**
 * Creates a typed in-page link action for an empty state.
 *
 * @param {string} label Visible action label.
 * @param {string} href Stable in-page target.
 * @return {EmptyStateAction} Typed link action.
 */
export function linkAction(label: string, href: string): EmptyStateAction {
    return { kind: 'link', label, href };
}

/**
 * Renders one classified PLAN task without reclassifying or inventing a deadline.
 *
 * @param {Object} props Task projection.
 * @return {ReactElement} Task occurrence row.
 */
export function TaskItem(props: Readonly<{
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
 * Renders one PLAN meeting occurrence with text status and location.
 *
 * @param {Object} props Meeting projection.
 * @return {ReactElement} Meeting occurrence row.
 */
export function MeetingItem(props: Readonly<{ meeting: PlanMeetingProjection }>): ReactElement {
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
