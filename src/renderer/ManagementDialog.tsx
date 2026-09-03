/**
 * @file Renders the management surfaces that own Term, Course, Meeting, Task and Holiday edits.
 */

import {
    useEffect,
    useReducer,
    useRef,
    useState,
    type KeyboardEvent,
    type ReactElement,
} from 'react';

import type { ResolvedSetupState } from './SetupDialog';
import { setupStateFrom } from './setup-state';
import {
    MANAGEMENT_SURFACES,
    managementSurfaceFromKey,
    type ManagementSurfaceId,
} from './management-surfaces';
import { emptyDraftFrom } from './setup/checklist';
import { focusStatus } from './setup/field-errors';
import { CourseForm, HolidayForm, MeetingForm, TaskForm, TermForm } from './setup/forms';
import {
    reducePendingSetupMutation,
    retryPendingSetupMutation,
    setupMutationProblemMessage,
    type PendingSetupMutation,
} from './setup/mutation';
import { weekdayNames } from './pages/shared';
import type { SetupDraft } from './setup-draft';
import type { WorkspaceSetupOutcome } from '../shared/workspace-setup-contract';

export type ManagementDialogProps = Readonly<{
    open: boolean;
    surface: ManagementSurfaceId;
    state: ResolvedSetupState;
    onClose(): void;
    onProjection(state: ResolvedSetupState): void;
    onSurfaceChange(surface: ManagementSurfaceId): void;
}>;

const SURFACE_INTROS: Readonly<Record<ManagementSurfaceId, string>> = {
    term: '当前学期决定所有本地时间的解释方式。新建学期会成为新的当前学期，已保存的历史学期不会被删除。',
    course: '课程先独立保存；课节和任务分别在各自的页面里添加。',
    meeting: '课节属于当前学期的某一门课程；未知地点必须明确选择 TBA。',
    task: '任务属于当前学期的某一门课程；截止时间未知时保持 TBA，不会被默认值填补。',
    holiday: '假期只对当前学期生效，会抑制周期课节和跟随教学周的任务。',
};

/**
 * Renders one modal management surface with left navigation over the five editors.
 *
 * @param {ManagementDialogProps} props Validated projections and Shell callbacks.
 * @return {ReactElement} Accessible management surface.
 */
export function ManagementDialog(props: ManagementDialogProps): ReactElement {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const statusRef = useRef<HTMLParagraphElement>(null);
    const surfaceRefs = useRef(new Map<ManagementSurfaceId, HTMLButtonElement>());
    const readOnly = props.state.dataMode === 'read-only';
    const [draft, setDraft] = useState<SetupDraft>(() => emptyDraftFrom(props.state));
    const [message, setMessage] = useState(readOnly
        ? '只读模式；可以查看已保存的正式数据，但不能新增或更改。'
        : '未提交的输入只保留在这个窗口里，不会写入正式数据。');
    const [commandBusy, setCommandBusy] = useState(false);
    const [pendingMutationState, dispatchPendingMutation] = useReducer(
        reducePendingSetupMutation,
        { pending: null },
    );
    const pendingMutation = pendingMutationState.pending;
    const hasPendingMutation = pendingMutation !== null;

    useEffect(() => {
        const dialog = dialogRef.current;
        if (dialog === null) {
            return;
        }
        if (props.open && !dialog.open) {
            dialog.showModal();
        }
        if (!props.open && dialog.open) {
            dialog.close();
        }
    }, [props.open]);

    /**
     * Closes the native modal before the Shell restores the prior focus target.
     *
     * @return {void}
     */
    const closeDialog = (): void => {
        if (hasPendingMutation) {
            dispatchPendingMutation({ kind: 'exit-attempted' });
            setMessage('正式请求结果尚未确认；请先精确重试本次请求，再关闭管理页面。');
            focusStatus(statusRef);
            return;
        }
        const dialog = dialogRef.current;
        if (dialog?.open) {
            dialog.close();
        }
        props.onClose();
    };

    /**
     * Switches surfaces only while no formal request is still unconfirmed.
     *
     * @param {ManagementSurfaceId} surface Requested management surface.
     * @return {void}
     */
    const selectSurface = (surface: ManagementSurfaceId): void => {
        if (hasPendingMutation) {
            dispatchPendingMutation({ kind: 'branch-switch-attempted' });
            setMessage('先精确重试未确认的正式请求，再切换管理页面。');
            focusStatus(statusRef);
            return;
        }
        props.onSurfaceChange(surface);
    };

    /**
     * Moves selection and DOM focus together for surface arrow keys.
     *
     * @param {KeyboardEvent<HTMLButtonElement>} event Surface key event.
     * @param {ManagementSurfaceId} currentSurface Currently focused surface.
     * @return {void}
     */
    const moveSurfaceFocus = (
        event: KeyboardEvent<HTMLButtonElement>,
        currentSurface: ManagementSurfaceId,
    ): void => {
        const target = managementSurfaceFromKey(currentSurface, event.key);
        if (target === null) {
            return;
        }

        event.preventDefault();
        selectSurface(target);
        surfaceRefs.current.get(target)?.focus();
    };

    /**
     * Refreshes formal facts after one committed management command.
     *
     * @return {Promise<void>}
     */
    const refreshAfterCommit = async (): Promise<void> => {
        let outcome: WorkspaceSetupOutcome;
        try {
            outcome = await window.courseFlow.querySetup();
        }
        catch {
            setMessage('正式数据已保存，但无法刷新这个页面；请关闭后重新打开。');
            focusStatus(statusRef);
            return;
        }
        const nextState = setupStateFrom(outcome);
        if (nextState.kind === 'problem' || nextState.kind === 'loading') {
            const problem = nextState.kind === 'problem'
                ? nextState.message
                : 'Workspace 未返回可恢复的设置状态。';
            setMessage(`正式数据已保存，但无法刷新这个页面：${problem}`);
            focusStatus(statusRef);
            return;
        }

        setDraft(emptyDraftFrom(nextState));
        setMessage('正式数据已保存；下面的列表已刷新。');
        props.onProjection(nextState);
    };

    /**
     * Retries the exact retained command after an unknown formal result.
     *
     * @return {Promise<void>}
     */
    const retryPendingMutation = async (): Promise<void> => {
        if (pendingMutation === null || commandBusy) {
            return;
        }

        setCommandBusy(true);
        setMessage('正在使用保留的 command ID 精确重试正式请求…');
        let outcome: WorkspaceSetupOutcome;
        try {
            outcome = await retryPendingSetupMutation(pendingMutation, window.courseFlow);
        }
        catch {
            setCommandBusy(false);
            setMessage('无法连接本地 Workspace；结果仍未知，原请求和全部输入继续保留。');
            focusStatus(statusRef);
            return;
        }
        if (!outcome.ok && outcome.problem.dataEffect === 'unknown') {
            setCommandBusy(false);
            setMessage(setupMutationProblemMessage(outcome.problem, '正式数据没有改变。'));
            focusStatus(statusRef);
            return;
        }

        dispatchPendingMutation({ kind: 'resolved' });
        if (!outcome.ok) {
            setCommandBusy(false);
            setMessage(setupMutationProblemMessage(outcome.problem, '正式数据没有改变。'));
            focusStatus(statusRef);
            return;
        }

        setMessage('原请求已由 Workspace 精确确认；正式数据已保存。');
        await refreshAfterCommit();
        setCommandBusy(false);
    };

    const retainUnknown = (pending: PendingSetupMutation): void => {
        dispatchPendingMutation({ kind: 'retain-unknown', pending });
    };

    const resolveSettled = (kind: PendingSetupMutation['kind']): void => {
        if (pendingMutation?.kind === kind) {
            dispatchPendingMutation({ kind: 'resolved' });
        }
    };

    const editorBlocked = (kind: PendingSetupMutation['kind']): boolean => (
        hasPendingMutation && pendingMutation.kind !== kind
    );

    const changeDraft = <Branch extends keyof SetupDraft>(
        branch: Branch,
        value: SetupDraft[Branch],
    ): void => {
        setDraft(current => ({ ...current, [branch]: value }));
        setMessage('有未提交输入；正式数据尚未改变。');
    };

    const activeSurface = MANAGEMENT_SURFACES.find(item => item.id === props.surface)
        ?? MANAGEMENT_SURFACES[0];

    return (
        <dialog
            aria-labelledby="management-dialog-title"
            aria-modal="true"
            className="settings-dialog management-dialog"
            onCancel={event => {
                event.preventDefault();
                closeDialog();
            }}
            ref={dialogRef}
        >
            <div
                aria-busy={commandBusy}
                className="settings-modal"
            >
                <header className="settings-modal-header">
                    <h1 id="management-dialog-title">学期与课程管理</h1>
                    <div className="settings-modal-actions">
                        <button
                            aria-label="关闭管理页面"
                            disabled={commandBusy}
                            onClick={closeDialog}
                            type="button"
                        >关闭</button>
                    </div>
                </header>
                <div className="settings-modal-body">
                    <nav
                        aria-label="管理分类"
                        className="settings-category-nav"
                    >
                        {MANAGEMENT_SURFACES.map(item => (
                            <button
                                aria-current={props.surface === item.id ? 'true' : undefined}
                                className="settings-category-button"
                                key={item.id}
                                onClick={() => selectSurface(item.id)}
                                onKeyDown={event => moveSurfaceFocus(event, item.id)}
                                ref={element => {
                                    if (element === null) {
                                        surfaceRefs.current.delete(item.id);
                                    }
                                    else {
                                        surfaceRefs.current.set(item.id, element);
                                    }
                                }}
                                type="button"
                            >{item.label}</button>
                        ))}
                    </nav>
                    <section
                        aria-label={activeSurface.label}
                        className="settings-panel management-panel"
                        tabIndex={-1}
                    >
                        <p className="section-intro">{SURFACE_INTROS[props.surface]}</p>
                        <ManagementFacts
                            state={props.state}
                            surface={props.surface}
                        />
                        {props.surface === 'term' ? (
                            <TermForm
                                blocked={editorBlocked('term')}
                                dataMode={props.state.dataMode}
                                draft={draft.term}
                                inputLocked={hasPendingMutation}
                                pendingCommand={pendingMutation?.kind === 'term'
                                    ? pendingMutation.command
                                    : null}
                                projection={props.state.projection}
                                onChange={value => changeDraft('term', value)}
                                onBusyChange={setCommandBusy}
                                onCommitted={refreshAfterCommit}
                                onSettled={() => resolveSettled('term')}
                                onUnknown={command => retainUnknown({ kind: 'term', command })}
                            />
                        ) : null}
                        {props.surface === 'course' ? (
                            <CourseForm
                                blocked={editorBlocked('course')}
                                dataMode={props.state.dataMode}
                                draft={draft.course}
                                inputLocked={hasPendingMutation}
                                pendingCommand={pendingMutation?.kind === 'course'
                                    ? pendingMutation.command
                                    : null}
                                projection={props.state.projection}
                                onChange={value => changeDraft('course', value)}
                                onBusyChange={setCommandBusy}
                                onCommitted={refreshAfterCommit}
                                onSettled={() => resolveSettled('course')}
                                onUnknown={command => retainUnknown({ kind: 'course', command })}
                            />
                        ) : null}
                        {props.surface === 'meeting' ? (
                            <div className="setup-step-panel">
                                <h2>添加课节</h2>
                                <MeetingForm
                                    blocked={editorBlocked('meeting')}
                                    dataMode={props.state.dataMode}
                                    draft={draft.meeting}
                                    inputLocked={hasPendingMutation}
                                    pendingCommand={pendingMutation?.kind === 'meeting'
                                        ? pendingMutation.command
                                        : null}
                                    projection={props.state.projection}
                                    onChange={value => changeDraft('meeting', value)}
                                    onBusyChange={setCommandBusy}
                                    onCommitted={refreshAfterCommit}
                                    onSettled={() => resolveSettled('meeting')}
                                    onUnknown={command => retainUnknown({ kind: 'meeting', command })}
                                />
                            </div>
                        ) : null}
                        {props.surface === 'task' ? (
                            <div className="setup-step-panel">
                                <h2>添加任务</h2>
                                <TaskForm
                                    blocked={editorBlocked('task')}
                                    dataMode={props.state.dataMode}
                                    draft={draft.task}
                                    inputLocked={hasPendingMutation}
                                    pendingCommand={pendingMutation?.kind === 'task'
                                        ? pendingMutation.command
                                        : null}
                                    projection={props.state.projection}
                                    onChange={value => changeDraft('task', value)}
                                    onBusyChange={setCommandBusy}
                                    onCommitted={refreshAfterCommit}
                                    onSettled={() => resolveSettled('task')}
                                    onUnknown={command => retainUnknown({ kind: 'task', command })}
                                />
                            </div>
                        ) : null}
                        {props.surface === 'holiday' ? (
                            <HolidayForm
                                autoFocusName={false}
                                blocked={editorBlocked('holiday')}
                                dataMode={props.state.dataMode}
                                draft={draft.holiday}
                                exitBlocked={hasPendingMutation}
                                inputLocked={hasPendingMutation}
                                pendingCommand={pendingMutation?.kind === 'holiday'
                                    ? pendingMutation.command
                                    : null}
                                projection={props.state.projection}
                                onBusyChange={setCommandBusy}
                                onChange={value => changeDraft('holiday', value)}
                                onCommitted={refreshAfterCommit}
                                onSettled={() => resolveSettled('holiday')}
                                onSkip={closeDialog}
                                onUnknown={command => retainUnknown({ kind: 'holiday', command })}
                            />
                        ) : null}
                    </section>
                </div>
                <footer className="settings-modal-footer">
                    <p
                        className="checkpoint-message"
                        ref={statusRef}
                        role="status"
                        tabIndex={-1}
                    >{message}</p>
                    {pendingMutation !== null ? (
                        <button
                            className="secondary-action"
                            disabled={commandBusy}
                            onClick={() => void retryPendingMutation()}
                            type="button"
                        >精确重试未确认请求</button>
                    ) : null}
                </footer>
            </div>
        </dialog>
    );
}

/**
 * Lists the committed facts the selected management surface owns.
 *
 * @param {object} props Selected surface and validated Setup projection.
 * @return {ReactElement} Read-only fact list or its real empty state.
 */
export function ManagementFacts(props: Readonly<{
    state: ResolvedSetupState;
    surface: ManagementSurfaceId;
}>): ReactElement {
    const projection = props.state.projection;
    const currentTerm = projection.currentTerm;
    const courses = projection.courses.filter(course => (
        course.termId === currentTerm?.termId && !course.archived
    ));
    const courseIds = new Set(courses.map(course => course.courseId));
    const rows = props.surface === 'term'
        ? projection.terms.map(term => ({
            id: term.termId,
            title: term.name,
            detail: `${term.startDate} - ${term.endDate} · ${term.timeZone}`,
            note: term.termId === currentTerm?.termId
                ? '当前学期'
                : term.archived ? '已归档' : '历史',
            current: term.termId === currentTerm?.termId,
        }))
        : props.surface === 'course'
            ? courses.map(course => ({
                id: course.courseId,
                title: `${course.code} · ${course.name}`,
                detail: `${course.teachingRange.startDate} - ${course.teachingRange.endDate}`,
                note: `${course.meetings.length} 条课节`,
                current: false,
            }))
            : props.surface === 'meeting'
                ? courses.flatMap(course => course.meetings.map(meeting => ({
                    id: meeting.meetingSeriesId,
                    title: `${course.code} · ${meeting.type.code}`,
                    detail: `${weekdayNames[meeting.weekday]} ${meeting.localStart}-${meeting.localEnd}`,
                    note: meeting.location.kind === 'tba' ? 'TBA' : meeting.location.value,
                    current: false,
                })))
                : props.surface === 'task'
                    ? projection.tasks.filter(task => courseIds.has(task.courseId)).map(task => ({
                        id: task.taskSeriesId,
                        title: task.title,
                        detail: courses.find(course => course.courseId === task.courseId)?.code
                            ?? '未知课程',
                        note: 'schedule' in task ? '每周' : '一次性',
                        current: false,
                    }))
                    : projection.holidayRanges
                        .filter(range => range.termId === currentTerm?.termId)
                        .map(range => ({
                            id: range.holidayRangeId,
                            title: range.name,
                            detail: `${range.startDate} - ${range.endDate}`,
                            note: '当前学期',
                            current: false,
                        }));

    if (rows.length === 0) {
        return (
            <p
                className="empty-state empty-state-reason"
                role="status"
            >当前没有已保存的记录；下面的表单会创建第一条。</p>
        );
    }

    return (
        <ul className="fact-list management-fact-list">
            {rows.map(row => (
                <li
                    data-current={row.current ? 'true' : undefined}
                    data-item-id={row.id}
                    key={row.id}
                >
                    <strong>{row.title}</strong>
                    <span>{row.detail}</span>
                    <span
                        className="status-label"
                        data-severity="neutral"
                    >{row.note}</span>
                </li>
            ))}
        </ul>
    );
}

export {
    MANAGEMENT_SURFACES,
    managementSurfaceFromKey,
    type ManagementSurfaceId,
} from './management-surfaces';
