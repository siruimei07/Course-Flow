/**
 * @file Renders the settings surface, its category navigation and the entries it owns.
 */

import {
    useEffect,
    useRef,
    useState,
    type KeyboardEvent,
    type ReactElement,
    type SyntheticEvent,
} from 'react';

import type { ResolvedSetupState } from './SetupDialog';
import { setupStateFrom } from './setup-state';
import { focusStatus } from './setup/field-errors';
import type { WorkspaceSetupOutcome } from '../shared/workspace-setup-contract';
import {
    normalizeResetCurrentTermCommand,
    type ResetCurrentTermCommand,
} from '../shared/workspace-term-contract';

import type {
    ApplicationBuildStatus,
    MigrationSafetyCopyProjection,
} from '../shared/workspace-migration-contract';
import type { SetupProjection } from '../shared/workspace-term-contract';
import type { ManagementSurfaceId } from './management-surfaces';
import { currentTermFacts, currentTermHolidayCount } from './setup/checklist';

/**
 * Confirmed settings categories in their visible order.
 *
 * @const
 * @type {readonly object[]}
 */
export const SETTINGS_CATEGORIES = [
    { id: 'term', label: '学期与课程' },
    { id: 'data', label: '数据与备份' },
    { id: 'about', label: '关于与版本' },
] as const;

export type SettingsCategoryId = typeof SETTINGS_CATEGORIES[number]['id'];

export type SettingsDialogProps = Readonly<{
    buildStatus: ApplicationBuildStatus | null;
    dataMode: 'ready' | 'read-only';
    open: boolean;
    safetyCopy: MigrationSafetyCopyProjection;
    setup: SetupProjection;
    onClose(): void;
    onOpenDataProtection(): void;
    onOpenManagement(surface: ManagementSurfaceId): void;
    onOpenSetup(): void;
    onProjection(state: ResolvedSetupState): void;
}>;

/**
 * Returns the category that should receive focus for one navigation key.
 *
 * @param {SettingsCategoryId} currentCategory Currently focused category.
 * @param {string} key KeyboardEvent key value.
 * @return {SettingsCategoryId | null} Next category, or null when the key is not a navigation key.
 */
export function settingsCategoryFromKey(
    currentCategory: SettingsCategoryId,
    key: string,
): SettingsCategoryId | null {
    if (key === 'Home') {
        return SETTINGS_CATEGORIES[0].id;
    }
    if (key === 'End') {
        return SETTINGS_CATEGORIES.at(-1)!.id;
    }
    if (key !== 'ArrowUp' && key !== 'ArrowDown') {
        return null;
    }

    const currentIndex = SETTINGS_CATEGORIES.findIndex(item => item.id === currentCategory);
    const direction = key === 'ArrowDown' ? 1 : -1;
    const targetIndex = (
        currentIndex + direction + SETTINGS_CATEGORIES.length
    ) % SETTINGS_CATEGORIES.length;
    return SETTINGS_CATEGORIES[targetIndex].id;
}

/**
 * Summarizes the migration safety copy without repeating the data surface itself.
 *
 * @param {MigrationSafetyCopyProjection} safetyCopy Validated safety-copy projection.
 * @return {string} Readable status for the settings summary.
 */
export function safetyCopySummary(safetyCopy: MigrationSafetyCopyProjection): string {
    if (safetyCopy.kind === 'verified') {
        return `已验证，源 schema ${safetyCopy.sourceSchemaLevel}`;
    }
    return safetyCopy.kind === 'absent' ? '没有迁移安全副本' : '副本无法重新验证';
}

/**
 * Renders the settings surface as a modal page with left category navigation.
 *
 * @param {SettingsDialogProps} props Validated projections and Shell callbacks.
 * @return {ReactElement} Accessible settings surface.
 */
export function SettingsDialog(props: SettingsDialogProps): ReactElement {
    const [category, setCategory] = useState<SettingsCategoryId>('term');
    const dialogRef = useRef<HTMLDialogElement>(null);
    const categoryRefs = useRef(new Map<SettingsCategoryId, HTMLButtonElement>());

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) {
            return;
        }
        if (props.open && !dialog.open) {
            setCategory('term');
            dialog.showModal();
        }
        else if (!props.open && dialog.open) {
            dialog.close();
        }
    }, [props.open]);

    /**
     * Keeps native Escape cancellation on the Shell close path.
     *
     * @param {SyntheticEvent<HTMLDialogElement>} event Native dialog cancel event.
     * @return {void}
     */
    const cancel = (event: SyntheticEvent<HTMLDialogElement>): void => {
        event.preventDefault();
        props.onClose();
    };

    /**
     * Moves selection and DOM focus together for category arrow keys.
     *
     * @param {KeyboardEvent<HTMLButtonElement>} event Category key event.
     * @param {SettingsCategoryId} currentCategory Currently focused category.
     * @return {void}
     */
    const moveCategoryFocus = (
        event: KeyboardEvent<HTMLButtonElement>,
        currentCategory: SettingsCategoryId,
    ): void => {
        const target = settingsCategoryFromKey(currentCategory, event.key);
        if (target === null) {
            return;
        }

        event.preventDefault();
        setCategory(target);
        categoryRefs.current.get(target)?.focus();
    };

    return (
        <dialog
            aria-labelledby="settings-dialog-title"
            aria-modal="true"
            className="settings-dialog"
            onCancel={cancel}
            ref={dialogRef}
        >
            <div className="settings-modal">
                <header className="settings-modal-header">
                    <h1 id="settings-dialog-title">设置</h1>
                    <div className="settings-modal-actions">
                        <button
                            aria-label="关闭设置"
                            onClick={props.onClose}
                            type="button"
                        >关闭</button>
                    </div>
                </header>
                <div className="settings-modal-body">
                    <nav
                        aria-label="设置分类"
                        className="settings-category-nav"
                    >
                        {SETTINGS_CATEGORIES.map(item => (
                            <button
                                aria-current={category === item.id ? 'true' : undefined}
                                className="settings-category-button"
                                key={item.id}
                                onClick={() => setCategory(item.id)}
                                onKeyDown={event => moveCategoryFocus(event, item.id)}
                                ref={element => {
                                    if (element === null) {
                                        categoryRefs.current.delete(item.id);
                                    }
                                    else {
                                        categoryRefs.current.set(item.id, element);
                                    }
                                }}
                                type="button"
                            >{item.label}</button>
                        ))}
                    </nav>
                    <section
                        aria-label={SETTINGS_CATEGORIES.find(item => item.id === category)!.label}
                        className="settings-panel"
                        tabIndex={-1}
                    >
                        {category === 'term' ? <TermSettings {...props} /> : null}
                        {category === 'data' ? <DataSettings {...props} /> : null}
                        {category === 'about' ? <AboutSettings {...props} /> : null}
                    </section>
                </div>
            </div>
        </dialog>
    );
}

/**
 * Shows the formal Current Term facts and the single entry that edits them.
 *
 * @param {SettingsDialogProps} props Validated projections and Shell callbacks.
 * @return {ReactElement} Term and course settings panel.
 */
export function TermSettings(props: SettingsDialogProps): ReactElement {
    const currentTerm = props.setup.currentTerm;
    const currentCourses = props.setup.courses.filter(course => (
        course.termId === currentTerm?.termId && !course.archived
    ));
    const meetingCount = currentCourses.reduce((total, course) => total + course.meetings.length, 0);
    const courseIds = new Set(currentCourses.map(course => course.courseId));
    const taskCount = props.setup.tasks.filter(task => courseIds.has(task.courseId)).length;
    return (
        <div className="settings-section">
            <div className="card-heading">
                <h2>学期与课程</h2>
                <p className="page-context">{currentTerm?.name ?? '尚无当前学期'}</p>
            </div>
            <p className="section-intro">学期、课程、课节和假期都存在这台电脑上；在这里改完，Today 和日历会跟着变。</p>
            <dl className="settings-fact-list">
                <div><dt>当前学期</dt><dd>{currentTerm?.name ?? '尚无当前学期'}</dd></div>
                <div>
                    <dt>起止日期</dt>
                    <dd>{currentTerm === null
                        ? '未设置'
                        : `${currentTerm.startDate} 至 ${currentTerm.endDate}`}</dd>
                </div>
                <div><dt>默认时区</dt><dd>{currentTerm?.timeZone ?? '未设置'}</dd></div>
                <div><dt>课程</dt><dd>{currentCourses.length} 门</dd></div>
                <div><dt>课节与任务</dt><dd>{meetingCount} 条课节 · {taskCount} 条任务</dd></div>
                <div><dt>假期</dt><dd>{currentTermHolidayCount(props.setup)} 个</dd></div>
            </dl>
            <div className="settings-section-actions">
                {currentTerm === null ? (
                    <button
                        className="primary-action"
                        onClick={props.onOpenSetup}
                        type="button"
                    >完成首次设置</button>
                ) : null}
                <button
                    className={currentTerm === null ? 'secondary-action' : 'primary-action'}
                    onClick={() => props.onOpenManagement('term')}
                    type="button"
                >管理学期</button>
                <button
                    className="secondary-action"
                    onClick={() => props.onOpenManagement('course')}
                    type="button"
                >管理课程</button>
                <button
                    className="secondary-action"
                    onClick={() => props.onOpenManagement('meeting')}
                    type="button"
                >管理课节</button>
                <button
                    className="secondary-action"
                    onClick={() => props.onOpenManagement('task')}
                    type="button"
                >管理任务</button>
                <button
                    className="secondary-action"
                    onClick={() => props.onOpenManagement('holiday')}
                    type="button"
                >管理假期</button>
            </div>
            <CurrentTermReset {...props} />
        </div>
    );
}

/**
 * Offers the one irreversible entry that deletes the Current Term and everything under it.
 *
 * The button stays disabled until the exact Term name is retyped, so the destructive
 * request can only leave the Shell after a deliberate confirmation. An unknown result is
 * never guessed: the exact command is retained and retried rather than rebuilt.
 *
 * @param {SettingsDialogProps} props Validated projections and Shell callbacks.
 * @return {ReactElement} Current Term reset panel.
 */
export function CurrentTermReset(props: SettingsDialogProps): ReactElement {
    const currentTerm = props.setup.currentTerm;
    const [confirmation, setConfirmation] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [pendingCommand, setPendingCommand] = useState<ResetCurrentTermCommand | null>(null);
    const statusRef = useRef<HTMLParagraphElement | null>(null);

    if (currentTerm === null) {
        return (
            <div className="settings-section settings-section--danger">
                <h3>重置当前学期</h3>
                <p className="section-intro">还没有当前学期，没有可以重置的东西。</p>
            </div>
        );
    }

    const writable = props.dataMode === 'ready';
    const confirmed = confirmation === currentTerm.name;
    const facts = currentTermFacts(props.setup);

    /**
     * Sends, or exactly retries, the confirmed Current Term reset.
     *
     * @return {Promise<void>}
     */
    const submitReset = async (): Promise<void> => {
        if (!writable || busy || (pendingCommand === null && !confirmed)) {
            return;
        }

        let command = pendingCommand;
        try {
            command ??= normalizeResetCurrentTermCommand({
                commandId: globalThis.crypto.randomUUID(),
                followUpId: globalThis.crypto.randomUUID(),
                expectedRevision: props.setup.workspaceRevision,
                expectedPlanVersion: props.setup.planEntityVersion,
                expectedTermVersion: currentTerm.entityVersion,
                intent: {
                    kind: 'plan.reset-current-term',
                    intentSchemaVersion: 1,
                    payload: {
                        termId: currentTerm.termId,
                        confirmedTermName: confirmation,
                    },
                },
            });
        }
        catch {
            setMessage('确认名称与当前学期不一致；正式数据没有改变。');
            focusStatus(statusRef);
            return;
        }

        setBusy(true);
        setMessage('正在重置当前学期…');
        let outcome: WorkspaceSetupOutcome;
        try {
            outcome = await window.courseFlow.resetCurrentTerm(command);
        }
        catch {
            setBusy(false);
            setPendingCommand(command);
            setMessage('无法连接本地 Workspace；重置结果尚无法确认，本次请求仍保留，请精确重试。');
            focusStatus(statusRef);
            return;
        }
        if (!outcome.ok) {
            setBusy(false);
            setPendingCommand(outcome.problem.dataEffect === 'unknown' ? command : null);
            setMessage(outcome.problem.dataEffect === 'unknown'
                ? `${outcome.problem.message} 结果尚无法确认；本次请求仍保留，请精确重试。`
                : `${outcome.problem.message} 正式数据没有改变。`);
            focusStatus(statusRef);
            return;
        }

        setPendingCommand(null);
        let refreshed: WorkspaceSetupOutcome;
        try {
            refreshed = await window.courseFlow.querySetup();
        }
        catch {
            setBusy(false);
            setConfirmation('');
            setMessage('当前学期已重置，但无法刷新这个页面；请关闭设置后重新打开。');
            focusStatus(statusRef);
            return;
        }
        const nextState = setupStateFrom(refreshed);
        setBusy(false);
        setConfirmation('');
        if (nextState.kind === 'problem' || nextState.kind === 'loading') {
            setMessage('当前学期已重置，但无法刷新这个页面；请关闭设置后重新打开。');
            focusStatus(statusRef);
            return;
        }

        setMessage('当前学期及其课程、课节、任务和假期已删除；可以重新完成首次设置。');
        props.onProjection(nextState);
    };

    return (
        <div className="settings-section settings-section--danger">
            <h3>重置当前学期</h3>
            <p>
                <span>这会永久删除 </span>
                <strong>{currentTerm.name}</strong>
                <span>{`，以及它下面的 ${facts.courseCount} 门课程、${facts.meetingCount} 条课节、`
                    + `${facts.taskCount} 条任务和 ${facts.holidayCount} 个假期。`
                    + '其他学期与本地备份不受影响，但这一步不能撤销。'}</span>
            </p>
            <label className="field field--full">
                <span>输入学期名称「{currentTerm.name}」以确认</span>
                <input
                    autoComplete="off"
                    disabled={!writable || busy}
                    name="reset-term-confirmation"
                    onChange={event => setConfirmation(event.currentTarget.value)}
                    type="text"
                    value={confirmation}
                />
            </label>
            <div className="settings-section-actions">
                <button
                    className="destructive-action"
                    disabled={!writable || busy || (pendingCommand === null && !confirmed)}
                    onClick={() => void submitReset()}
                    type="button"
                >{pendingCommand === null ? '重置当前学期' : '精确重试重置'}</button>
            </div>
            <p
                aria-live="polite"
                className="form-status"
                ref={statusRef}
                tabIndex={-1}
            >{message === '' && !writable ? '只读模式不能重置当前学期。' : message}</p>
        </div>
    );
}

/**
 * Summarizes local data protection and routes to the surface that owns it.
 *
 * @param {SettingsDialogProps} props Validated projections and Shell callbacks.
 * @return {ReactElement} Data and backup settings panel.
 */
export function DataSettings(props: SettingsDialogProps): ReactElement {
    return (
        <div className="settings-section">
            <h2>数据与备份</h2>
            <p className="section-intro">课程和任务只存在这台电脑上，不会上传。备份、恢复和升级前的副本都在下面那一页管理。</p>
            <dl className="settings-fact-list">
                <div>
                    <dt>数据模式</dt>
                    <dd>{props.dataMode === 'read-only' ? '只读模式' : '可写入'}</dd>
                </div>
                <div><dt>迁移安全副本</dt><dd>{safetyCopySummary(props.safetyCopy)}</dd></div>
            </dl>
            <button
                className="primary-action"
                onClick={props.onOpenDataProtection}
                type="button"
            >打开数据与备份</button>
        </div>
    );
}

/**
 * Shows the exact build identity already confirmed by Workspace, or its absence.
 *
 * @param {SettingsDialogProps} props Validated projections and Shell callbacks.
 * @return {ReactElement} About and version settings panel.
 */
export function AboutSettings(props: SettingsDialogProps): ReactElement {
    const descriptor = props.buildStatus?.descriptor ?? null;
    if (descriptor === null) {
        return (
            <div className="settings-section">
                <h2>关于与版本</h2>
                <p
                    className="section-intro"
                    role="status"
                >当前无法读取精确构建身份；课程与任务数据没有改变。</p>
            </div>
        );
    }
    return (
        <div className="settings-section">
            <h2>关于与版本</h2>
            <p className="section-intro">下面这些信息由这台电脑上的程序自己确认，不来自网络。</p>
            <dl className="settings-fact-list">
                <div><dt>版本</dt><dd>{descriptor.releaseVersion}</dd></div>
                <div><dt>Tag</dt><dd><code>{descriptor.tag}</code></dd></div>
                <div><dt>AppBuildId</dt><dd><code>{descriptor.appBuildId}</code></dd></div>
                <div><dt>平台</dt><dd>{descriptor.platform} · {descriptor.architecture}</dd></div>
                <div><dt>当前 schema</dt><dd>{descriptor.currentSchemaLevel}</dd></div>
                <div><dt>Electron</dt><dd>{descriptor.runtimes.electron}</dd></div>
                <div><dt>Chromium</dt><dd>{descriptor.runtimes.chromium}</dd></div>
                <div><dt>Node</dt><dd>{descriptor.runtimes.node}</dd></div>
                <div><dt>SQLite</dt><dd>{descriptor.runtimes.sqlite}</dd></div>
            </dl>
        </div>
    );
}
