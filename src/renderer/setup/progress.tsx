import type { RefObject } from 'react';
import type { ResolvedSetupState } from '../SetupDialog';
import type { ManagementSurfaceId } from '../management-surfaces';
import type { SetupState } from '../setup-state';
import { currentTermFacts } from './checklist';
/**
 * Renders formal progress with the current black layer nested inside one white card.
 *
 * First setup owns exactly one required fact; everything else is listed as an
 * optional follow-up so the list never implies a blocked Today.
 *
 * @param {object} props Current resolved state.
 * @return {JSX.Element} Textual setup progress.
 */
export function SetupProgress(props: Readonly<{
    state: ResolvedSetupState;
}>) {
    const { state } = props;
    const hasCurrentTerm = state.projection.minimum.hasCurrentTerm;
    const facts = currentTermFacts(state.projection);
    const percentage = hasCurrentTerm ? 100 : 0;
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
                data-progress={hasCurrentTerm ? 1 : 0}
            >
                <span />
            </div>
            <div className="setup-progress-stack">
                <div className="setup-current-layer">
                    <span className="setup-current-label">
                        {hasCurrentTerm ? '首次设置已完成' : '当前学期'}
                    </span>
                    <ol className="setup-step-list">
                        <li data-status={hasCurrentTerm ? '完成' : '当前'}>
                            <span aria-hidden="true">{hasCurrentTerm ? '✓' : '•'}</span>
                            <span>
                                <strong>当前学期</strong>
                                <small>{hasCurrentTerm ? '完成' : '必需'}</small>
                            </span>
                        </li>
                        <OptionalStep
                            count={facts.courseCount}
                            label="添加课程"
                            unit="门"
                        />
                        <OptionalStep
                            count={facts.meetingCount + facts.taskCount}
                            label="课节或任务"
                            unit="条"
                        />
                        <OptionalStep
                            count={facts.holidayCount}
                            label="假期（可稍后）"
                            unit="个"
                        />
                    </ol>
                </div>
            </div>
        </aside>
    );
}

/**
 * Renders one optional follow-up with its real count instead of a blocking state.
 *
 * @param {object} props Follow-up label, committed count and its unit.
 * @return {JSX.Element} Optional progress list item.
 */
export function OptionalStep(props: Readonly<{
    count: number;
    label: string;
    unit: string;
}>) {
    return (
        <li data-status="optional">
            <span aria-hidden="true">·</span>
            <span>
                <strong>{props.label}</strong>
                <small>可选 · 已有 {props.count} {props.unit}</small>
            </span>
        </li>
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
 * Summarizes the completed minimum and routes every optional follow-up to its surface.
 *
 * @param {object} props Completed setup state and management routing.
 * @return {JSX.Element} Completion surface.
 */
export function SetupComplete(props: Readonly<{
    disabled: boolean;
    headingRef: RefObject<HTMLHeadingElement | null>;
    onOpenManagement(surface: ManagementSurfaceId): void;
    state: Extract<SetupState, { kind: 'complete' }>;
}>) {
    const { state } = props;
    const currentTerm = state.projection.currentTerm;
    const facts = currentTermFacts(state.projection);
    return (
        <div className="setup-step-panel setup-complete-panel">
            <div
                aria-atomic="true"
                aria-live="polite"
                className="setup-complete-announcement"
            >
                <p className="eyebrow">首次设置已完成</p>
                <h2
                    id="setup-complete-title"
                    ref={props.headingRef}
                    tabIndex={-1}
                >你的 Today 已经可以使用</h2>
                <p>{currentTerm === null
                    ? '当前学期'
                    : `${currentTerm.name} · ${currentTerm.startDate} - ${currentTerm.endDate}`}</p>
            </div>
            <dl className="setup-fact-list">
                <div><dt>当前学期</dt><dd>{currentTerm === null ? '缺失' : '完成'}</dd></div>
                <div><dt>课程</dt><dd>{facts.courseCount} 门</dd></div>
                <div>
                    <dt>课节或任务</dt>
                    <dd>{facts.meetingCount} 条课节 · {facts.taskCount} 条任务</dd>
                </div>
                <div><dt>假期</dt><dd>{facts.holidayCount} 个，可稍后补充</dd></div>
            </dl>
            <div
                aria-label="继续补充正式课程数据"
                className="setup-complete-actions"
            >
                <strong>继续补充</strong>
                <p>课程、课节、任务和假期都有各自的管理页面，可以随时补充，也可直接进入 Today。</p>
                <div>
                    <button
                        className="secondary-action"
                        disabled={props.disabled}
                        onClick={() => props.onOpenManagement('course')}
                        type="button"
                    >管理课程</button>
                    <button
                        className="secondary-action"
                        disabled={props.disabled}
                        onClick={() => props.onOpenManagement('meeting')}
                        type="button"
                    >管理课节</button>
                    <button
                        className="secondary-action"
                        disabled={props.disabled}
                        onClick={() => props.onOpenManagement('task')}
                        type="button"
                    >管理任务</button>
                    <button
                        className="secondary-action"
                        disabled={props.disabled}
                        onClick={() => props.onOpenManagement('holiday')}
                        type="button"
                    >管理假期</button>
                </div>
            </div>
        </div>
    );
}
