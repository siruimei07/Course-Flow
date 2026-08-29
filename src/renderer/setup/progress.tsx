import type { RefObject } from 'react';
import type { ResolvedSetupState } from '../SetupDialog';
import type { SetupDraft } from '../setup-draft';
import type { SetupState } from '../setup-state';
import { currentTermHolidayCount } from './checklist';
/**
 * Renders formal progress with the current black layer nested inside one white card.
 *
 * @param {object} props Current resolved state and visible checklist step.
 * @return {JSX.Element} Textual setup progress.
 */
export function SetupProgress(props: Readonly<{
    activeStep: SetupDraft['step'];
    state: ResolvedSetupState;
}>) {
    const { activeStep, state } = props;
    const minimum = state.projection.minimum;
    const completedCount = [
        minimum.hasCurrentTerm,
        minimum.hasCurrentTermCourse,
        minimum.hasMeetingOrTask,
    ].filter(Boolean).length;
    const percentage = Math.round(completedCount / 3 * 100);
    const currentLabel = activeStep === 'term'
        ? '当前学期'
        : activeStep === 'course'
            ? '添加课程'
            : activeStep === 'activity'
                ? '添加课节或任务'
                : '假期（可稍后）';
    return (
        <aside
            aria-label="设置进度"
            className="setup-progress-card"
        >
            <div className="setup-progress-heading">
                <span>设置进度</span>
                <strong>{percentage}%</strong>
            </div>
            <div
                aria-hidden="true"
                className="progress-track"
                data-progress={completedCount}
            >
                <span />
            </div>
            <div className="setup-progress-stack">
                <div
                    className="setup-progress-pad"
                    aria-hidden="true"
                />
                <div className="setup-current-layer">
                    <span className="setup-current-label">{currentLabel}</span>
                    <ol className="setup-step-list">
                        <ProgressStep
                            complete={minimum.hasCurrentTerm}
                            current={activeStep === 'term'}
                            label="当前学期"
                        />
                        <ProgressStep
                            complete={minimum.hasCurrentTermCourse}
                            current={activeStep === 'course'}
                            label="添加课程"
                        />
                        <ProgressStep
                            complete={minimum.hasMeetingOrTask}
                            current={activeStep === 'activity'}
                            label="课节或任务"
                        />
                        <li data-status={activeStep === 'holiday' ? '当前' : 'optional'}>
                            <span aria-hidden="true">4</span>
                            <span>
                                <strong>假期（可稍后）</strong>
                                <small>{activeStep === 'holiday' ? '当前' : '不阻止进入 Today'}</small>
                            </span>
                        </li>
                    </ol>
                </div>
            </div>
        </aside>
    );
}

/**
 * Renders one numbered progress row with a textual state.
 *
 * @param {object} props Step label and formal state.
 * @return {JSX.Element} Progress list item.
 */
export function ProgressStep(props: Readonly<{
    complete: boolean;
    current: boolean;
    label: string;
}>) {
    const status = props.current ? '当前' : props.complete ? '完成' : '待完成';
    return (
        <li data-status={status}>
            <span aria-hidden="true">{props.complete ? '✓' : '•'}</span>
            <span><strong>{props.label}</strong><small>{status}</small></span>
        </li>
    );
}

/**
 * Shows only committed facts while the user reviews an earlier checklist step.
 * @param {object} props Formal projection and selected checklist step.
 * @return {JSX.Element} Read-only fact summary without an editing command.
 */
export function SetupFactReview(props: Readonly<{
    state: ResolvedSetupState;
    step: SetupDraft['step'];
}>) {
    const currentTerm = props.state.projection.currentTerm;
    const currentCourses = props.state.projection.courses.filter(course => (
        course.termId === currentTerm?.termId && !course.archived
    ));
    const meetingCount = currentCourses.reduce((total, course) => total + course.meetings.length, 0);
    const courseIds = new Set(currentCourses.map(course => course.courseId));
    const taskCount = props.state.projection.tasks.filter(task => courseIds.has(task.courseId)).length;
    const view = props.step === 'term'
        ? {
            title: '当前学期',
            facts: [
                ['名称', currentTerm?.name ?? '正式投影不可用'],
                ['日期', currentTerm === null ? '正式投影不可用' : `${currentTerm.startDate} 至 ${currentTerm.endDate}`],
                ['时区', currentTerm?.timeZone ?? '正式投影不可用'],
            ],
        }
        : props.step === 'course'
            ? {
                title: '当前课程',
                facts: [
                    ['数量', `${currentCourses.length} 门`],
                    ['课程', currentCourses.map(course => `${course.code} · ${course.name}`).join('、')],
                ],
            }
            : props.step === 'activity'
                ? {
                    title: '课节或任务',
                    facts: [
                        ['课节', `${meetingCount} 条`],
                        ['任务', `${taskCount} 条`],
                    ],
                }
                : {
                    title: '假期（可稍后）',
                    facts: [['当前假期', `${currentTermHolidayCount(props.state.projection)} 个`]],
                };
    return (
        <div className="setup-step-panel setup-review-panel">
            <p className="eyebrow">查看已完成步骤</p>
            <h2>{view.title}</h2>
            <p>以下内容来自正式 Workspace 投影；前后导航不会修改正式数据或草稿。</p>
            <dl className="setup-fact-list">
                {view.facts.map(([label, value]) => (
                    <div key={label}><dt>{label}</dt><dd>{value || '未提供'}</dd></div>
                ))}
            </dl>
        </div>
    );
}

/**
 * Explains an unreadable Shell draft and exposes only explicit discard.
 *
 * @param {object} props Draft capability and callback.
 * @return {JSX.Element} Incompatible-draft recovery surface.
 */
export function IncompatibleDraft(props: Readonly<{
    dataMode: 'ready' | 'read-only';
    saving: boolean;
    onDiscard(): void;
}>) {
    return (
        <div className="setup-step-panel">
            <p className="eyebrow">草稿需要处理</p>
            <h2>这份设置草稿无法由当前版本读取</h2>
            <p>{props.dataMode === 'read-only'
                ? '正式学期、课程、课节和任务没有改变。只读模式不能丢弃这份旧草稿。'
                : '正式学期、课程、课节和任务没有改变。你可以进入 Today，或明确丢弃旧草稿后重新填写。'}</p>
            <button
                className="secondary-action"
                disabled={props.saving || props.dataMode === 'read-only'}
                onClick={props.onDiscard}
                type="button"
            >丢弃旧草稿</button>
        </div>
    );
}

/**
 * Summarizes the formal minimum without exposing internal identifiers as primary content.
 *
 * @param {object} props Completed setup state.
 * @return {JSX.Element} Completion surface.
 */
export function SetupComplete(props: Readonly<{
    activeEditor: 'course' | 'activity' | null;
    disabled: boolean;
    headingRef: RefObject<HTMLHeadingElement | null>;
    onEdit(editor: 'course' | 'activity'): void;
    state: Extract<SetupState, { kind: 'complete' }>;
}>) {
    const { state } = props;
    const currentTerm = state.projection.currentTerm;
    const currentCourses = state.projection.courses.filter(course => (
        course.termId === currentTerm?.termId && !course.archived
    ));
    const meetingCount = currentCourses.reduce((total, course) => total + course.meetings.length, 0);
    const courseIds = new Set(currentCourses.map(course => course.courseId));
    const taskCount = state.projection.tasks.filter(task => courseIds.has(task.courseId)).length;
    const holidayCount = currentTermHolidayCount(state.projection);
    return (
        <div className="setup-step-panel setup-complete-panel">
            <div
                aria-atomic="true"
                aria-live="polite"
                className="setup-complete-announcement"
            >
                <p className="eyebrow">最低条件已满足</p>
                <h2
                    id="setup-complete-title"
                    ref={props.headingRef}
                    tabIndex={-1}
                >你的 Today 已经可以使用</h2>
                <p>{currentTerm?.name ?? '当前学期'} · {currentCourses.length} 门课程</p>
            </div>
            <dl className="setup-fact-list">
                <div><dt>当前学期</dt><dd>{currentTerm === null ? '缺失' : '完成'}</dd></div>
                <div><dt>课程</dt><dd>{currentCourses.length} 门</dd></div>
                <div><dt>课节或任务</dt><dd>{meetingCount} 条课节 · {taskCount} 条任务</dd></div>
                <div><dt>假期</dt><dd>{holidayCount} 个，可稍后补充</dd></div>
            </dl>
            <div
                aria-label="继续补充正式课程数据"
                className="setup-complete-actions"
            >
                <strong>继续补充</strong>
                <p>可以继续添加真实课程、课节或任务，也可直接进入 Today。</p>
                <div>
                    <button
                        aria-pressed={props.activeEditor === 'course'}
                        className="secondary-action"
                        disabled={props.disabled}
                        onClick={() => props.onEdit('course')}
                        type="button"
                    >添加另一门课程</button>
                    <button
                        aria-pressed={props.activeEditor === 'activity'}
                        className="secondary-action"
                        disabled={props.disabled}
                        onClick={() => props.onEdit('activity')}
                        type="button"
                    >添加课节或任务</button>
                </div>
            </div>
        </div>
    );
}
