import type {WorkspaceDataStatus} from '../shared/bootstrap-contract';
import type {WorkspaceMode} from '../shared/workspace-lifecycle-contract';
import { ManagementDialog } from './ManagementDialog';
import type { ManagementSurfaceId } from './management-surfaces';
import { SettingsDialog } from './SettingsDialog';
import { SetupDialog } from './SetupDialog';
import { setupStateFrom, type SetupState } from './setup-state';
import { ALL_TASKS_FILTER, planProjectionStateFrom, type TaskListFilter } from './workspace-view-state';
import { WindowControls, WindowTitlebar } from './WindowControls';
import { loadPlan, loadWorkspace } from './app/load-workspace';
import type { WorkspaceLoadResult } from './app/load-workspace';
import {
    advanceTaskUndoTimerState,
    focusTaskActionTarget,
    nextTaskItemIdFrom,
    runWorkspaceTaskOccurrenceAction,
    runWorkspaceTaskOccurrenceUndo,
    taskActionFocusTargetFrom,
    taskPresentationItemId,
    taskUndoPresentationFrom,
    taskUndoTimerDelayFrom,
} from './app/task-actions';
import type { WorkspaceTaskActionResult } from './app/task-actions';
/**
 * @file Loads Workspace projections and renders the accessible CourseFlow shell.
 */

import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type KeyboardEvent,
    type ReactElement,
} from 'react';

import type {
    PlanProjection,
    PlanTaskProjection,
} from '../shared/workspace-plan-contract';
import type {
    ApplicationBuildStatus,
    MigrationRollbackSessionView,
    MigrationSafetyCopyProjection,
} from '../shared/workspace-migration-contract';
import {
    isTaskOccurrenceWindow,
    type TaskOccurrenceId,
    type TaskOccurrenceWindow,
    type TaskSeriesDetailProjection,
} from '../shared/workspace-task-contract';
import {
    type SetupProjection,
} from '../shared/workspace-term-contract';
import {
    navigationTargetFromKey,
    WORKSPACE_NAVIGATION_ITEMS,
    type WorkspaceNavigationId,
} from './navigation';
import {
    MigrationMaintenanceSurface,
    MigrationProtectionDialog,
    type MigrationProtectionDialogMode,
} from './MigrationRollbackSurface';
import {
    advanceTaskOccurrenceActionsState,
    createTaskOccurrenceActionsState,
    hasPendingTaskOccurrenceAction,
    hasPendingTaskOccurrenceRequest,
    runTaskOccurrenceAction,
    runTaskOccurrenceUndo,
    setTaskUndoToastFocused,
    setTaskUndoToastHovered,
    type TaskOccurrenceAction,
    type TaskOccurrenceActionsState,
} from './task-occurrence-actions';
import {
    TaskActionNotice,
    WorkspacePage,
    type CalendarWeekPresentation,
    type TaskActionPresentation,
    type TaskListPresentation,
} from './workspace-pages';
import { addCalendarDays } from './pages/shared';

type ResolvedSetupState = Extract<SetupState, { projection: SetupProjection }>;


type AppState = Readonly<{ kind: 'loading' }> | WorkspaceLoadResult;

export type WorkspaceShellProps = Readonly<{
    activePage: WorkspaceNavigationId;
    dataMode: 'ready' | 'read-only';
    setup: SetupProjection;
    plan: PlanProjection | null;
    planProblem: string | null;
    taskActions: TaskActionPresentation;
    calendarWeek: CalendarWeekPresentation;
    taskList?: TaskListPresentation;
    onNavigate(page: WorkspaceNavigationId): void;
    onCreateTask(): void;
    onOpenManagement(surface: ManagementSurfaceId): void;
    onOpenSettings(): void;
    onOpenSetup(): void;
    onRetryPlan(): void;
}>;













const PAGE_HEADING_IDS: Readonly<Record<WorkspaceNavigationId, string>> = {
    today: 'today-page-title',
    courses: 'courses-page-title',
    calendar: 'calendar-page-title',
    tasks: 'tasks-page-title',
    files: 'files-page-title',
};

// Shown when Workspace could not answer for one explicit Calendar week; the reader sees it, so
// it names the page's own facts rather than the projection behind them.
const CALENDAR_WEEK_UNAVAILABLE = '这次没能读到这一周的计划；正式数据没有改变。';















/**
 * Presents the explicit first-run boundary without creating DATA on observation.
 * @param {{onStart(): void}} props Explicit local initialization action.
 * @return {ReactElement} Accessible welcome surface.
 */
export function WelcomeSurface({onStart}: Readonly<{onStart(): void}>): ReactElement {
    return (
        <main className="startup-surface">
            <section
                aria-labelledby="workspace-welcome-title"
                className="status-card"
            >
                <p className="eyebrow">CourseFlow</p>
                <h1 id="workspace-welcome-title">欢迎使用 CourseFlow</h1>
                <p>课程与任务数据只保存在这台设备上；开始后可随时继续未完成的设置。</p>
                <button
                    className="primary-action"
                    onClick={onStart}
                    type="button"
                >开始新的本地工作区</button>
            </section>
        </main>
    );
}

/**
 * Owns the interruptible setup overlay, navigation state, and projection refreshes.
 *
 * @return {ReactElement} CourseFlow application root.
 */
export function App(): ReactElement {
    const [state, setState] = useState<AppState>({ kind: 'loading' });
    const [activePage, setActivePage] = useState<WorkspaceNavigationId>('today');
    const [setupOpen, setSetupOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [calendarWeekOffset, setCalendarWeekOffset] = useState(0);
    const [calendarWeekPlan, setCalendarWeekPlan] = useState<PlanProjection | null>(null);
    const [calendarWeekBusy, setCalendarWeekBusy] = useState(false);
    const [calendarWeekProblem, setCalendarWeekProblem] = useState<string | null>(null);
    // Renderer view state: which day the Calendar detail reads; null follows today.
    const [calendarSelectedDate, setCalendarSelectedDate] = useState<string | null>(null);
    const [taskListFilter, setTaskListFilter] = useState<TaskListFilter>(ALL_TASKS_FILTER);
    const [managementOpen, setManagementOpen] = useState(false);
    const [managementSurface, setManagementSurface] = useState<ManagementSurfaceId>('course');
    const [migrationDialogOpen, setMigrationDialogOpen] = useState(false);
    const [migrationDialogMode, setMigrationDialogMode] = useState<MigrationProtectionDialogMode>(
        'overview',
    );
    const [migrationRollbackPreview, setMigrationRollbackPreview] = useState<
        MigrationRollbackSessionView | null
    >(null);
    const [migrationBusy, setMigrationBusy] = useState(false);
    const [migrationActionProblem, setMigrationActionProblem] = useState<string | null>(null);
    const [taskActionState, setTaskActionState] = useState<TaskOccurrenceActionsState | null>(null);
    const [taskActionBusyItemId, setTaskActionBusyItemId] = useState<string | null>(null);
    const [taskActionProblem, setTaskActionProblem] = useState<string | null>(null);
    const returnFocusRef = useRef<HTMLElement | null>(null);
    const settingsReturnFocusRef = useRef<HTMLElement | null>(null);
    const migrationReturnFocusRef = useRef<HTMLElement | null>(null);
    const managementReturnFocusRef = useRef<HTMLElement | null>(null);
    const taskActionInFlightRef = useRef(false);
    const taskActionFocusRef = useRef<Readonly<{
        itemId: string;
        nextItemId: string | null;
        page: WorkspaceNavigationId;
        trigger: HTMLElement | null;
    }> | null>(null);

    const reload = useCallback((): void => {
        taskActionInFlightRef.current = false;
        taskActionFocusRef.current = null;
        setTaskActionState(null);
        setTaskActionBusyItemId(null);
        setTaskActionProblem(null);
        setSettingsOpen(false);
        setMigrationDialogOpen(false);
        setMigrationDialogMode('overview');
        setMigrationRollbackPreview(null);
        setMigrationBusy(false);
        setMigrationActionProblem(null);
        setState({ kind: 'loading' });
        void loadWorkspace(window.courseFlow).then(result => {
            setState(result);
            if (result.kind === 'ready') {
                setActivePage('today');
                setSetupOpen(result.route === 'setup');
            }
        });
    }, []);

    useEffect(reload, [reload]);

    const startNewWorkspace = (): void => {
        setState({kind: 'loading'});
        void window.courseFlow.initialize().then(outcome => {
            if (!outcome.ok) {
                setState({kind: 'problem', message: outcome.problem.message});
                return;
            }
            reload();
        }).catch(() => {
            setState({kind: 'problem', message: '无法创建本地工作区，请重试。'});
        });
    };

    const undoExpiresAt = taskActionState?.commandState.undoToast?.expiresAt ?? null;
    const undoPausedAt = taskActionState?.commandState.undoToast?.pausedAt ?? null;
    useEffect(() => {
        if (taskActionState === null) {
            return;
        }
        const delay = taskUndoTimerDelayFrom(taskActionState, Date.now());
        if (delay === null) {
            return;
        }

        const timer = globalThis.setTimeout(() => {
            setTaskActionState(current => advanceTaskUndoTimerState(current, Date.now()));
        }, delay);
        return () => globalThis.clearTimeout(timer);
    }, [undoExpiresAt, undoPausedAt]);

    const openSetup = (): void => {
        returnFocusRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        setSettingsOpen(false);
        setManagementOpen(false);
        setSetupOpen(true);
    };

    const openManagement = (surface: ManagementSurfaceId): void => {
        managementReturnFocusRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        setSettingsOpen(false);
        setSetupOpen(false);
        setManagementSurface(surface);
        setManagementOpen(true);
    };

    const closeManagement = (): void => {
        setManagementOpen(false);
        const returnTarget = managementReturnFocusRef.current;
        globalThis.requestAnimationFrame(() => {
            if (returnTarget?.isConnected) {
                returnTarget.focus();
            }
            else {
                document.getElementById(PAGE_HEADING_IDS[activePage])?.focus();
            }
        });
    };

    const openSettings = (): void => {
        settingsReturnFocusRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        setSettingsOpen(true);
    };

    const closeSettings = (): void => {
        setSettingsOpen(false);
        const returnTarget = settingsReturnFocusRef.current;
        globalThis.requestAnimationFrame(() => {
            if (returnTarget?.isConnected) {
                returnTarget.focus();
            }
        });
    };

    const focusPageHeading = (page: WorkspaceNavigationId): void => {
        globalThis.requestAnimationFrame(() => {
            document.getElementById(PAGE_HEADING_IDS[page])?.focus();
        });
    };

    const closeSetup = (destination: 'current' | 'today'): void => {
        setSetupOpen(false);
        if (destination === 'today') {
            setActivePage('today');
            focusPageHeading('today');
            return;
        }

        const returnTarget = returnFocusRef.current;
        globalThis.requestAnimationFrame(() => {
            if (returnTarget?.isConnected) {
                returnTarget.focus();
            }
            else {
                document.getElementById(PAGE_HEADING_IDS[activePage])?.focus();
            }
        });
    };

    const openDataProtection = (): void => {
        if (state.kind !== 'ready') {
            return;
        }
        migrationReturnFocusRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        setSettingsOpen(false);
        setMigrationDialogMode('overview');
        setMigrationRollbackPreview(null);
        setMigrationActionProblem(state.migrationProblem);
        setMigrationDialogOpen(true);
    };

    const closeDataProtection = (): void => {
        if (migrationBusy) {
            return;
        }
        setMigrationDialogOpen(false);
        setMigrationDialogMode('overview');
        setMigrationRollbackPreview(null);
        const returnTarget = migrationReturnFocusRef.current;
        globalThis.requestAnimationFrame(() => {
            if (returnTarget?.isConnected) {
                returnTarget.focus();
            }
        });
    };

    const previewMigrationRollback = (): void => {
        if (migrationBusy || state.kind !== 'ready') {
            return;
        }
        setMigrationBusy(true);
        setMigrationActionProblem(null);
        void window.courseFlow.previewMigrationRollback().then(outcome => {
            if (!outcome.ok) {
                setMigrationActionProblem(outcome.problem.message);
                if (outcome.problem.dataEffect === 'unknown') {
                    reload();
                }
                return;
            }
            if (outcome.value.kind !== 'workspace.migration-rollback-session'
                || outcome.value.session.phase !== 'previewed') {
                setMigrationActionProblem('Workspace 返回了意外的迁移回退预览。');
                return;
            }
            setMigrationRollbackPreview(outcome.value.session);
            setMigrationDialogMode('rollback-preview');
        }).catch(() => {
            setMigrationActionProblem('无法连接本地 Workspace；当前数据没有改变。');
        }).finally(() => setMigrationBusy(false));
    };

    const deleteMigrationSafety = (): void => {
        if (migrationBusy
            || state.kind !== 'ready'
            || state.migrationSafetyCopy.kind !== 'verified') {
            return;
        }
        const safetyCopy = state.migrationSafetyCopy;
        setMigrationBusy(true);
        setMigrationActionProblem(null);
        void window.courseFlow.deleteMigrationSafetyCopy({
            commandId: globalThis.crypto.randomUUID(),
            migrationSafetyCopyId: safetyCopy.migrationSafetyCopyId,
            expectedCopyVersion: safetyCopy.copyVersion,
            confirmationToken: safetyCopy.deleteConfirmationToken,
        }).then(outcome => {
            if (!outcome.ok) {
                setMigrationActionProblem(outcome.problem.message);
                if (outcome.problem.dataEffect === 'unknown') {
                    reload();
                }
                return;
            }
            if (outcome.value.kind !== 'workspace.migration-safety-copy') {
                setMigrationActionProblem('Workspace 返回了意外的迁移安全副本状态。');
                return;
            }
            const nextSafetyCopy = outcome.value.safetyCopy;
            setState(current => current.kind === 'ready'
                ? {...current, migrationSafetyCopy: nextSafetyCopy}
                : current);
            setMigrationDialogMode('overview');
            setMigrationActionProblem('迁移安全副本已删除。');
        }).catch(() => {
            setMigrationActionProblem('删除结果尚无法确认；请重新读取副本状态。');
            reload();
        }).finally(() => setMigrationBusy(false));
    };

    const confirmMigrationRollback = (): void => {
        const preview = migrationRollbackPreview;
        if (migrationBusy
            || state.kind !== 'ready'
            || preview?.phase !== 'previewed'
            || !preview.migrationRollbackSessionId
            || !preview.sessionVersion
            || !preview.previewToken) {
            return;
        }
        setMigrationBusy(true);
        setMigrationActionProblem(null);
        void window.courseFlow.confirmMigrationRollback({
            commandId: globalThis.crypto.randomUUID(),
            migrationRollbackSessionId: preview.migrationRollbackSessionId,
            expectedSessionVersion: preview.sessionVersion,
            previewToken: preview.previewToken,
        }).then(outcome => {
            if (!outcome.ok) {
                setMigrationActionProblem(outcome.problem.message);
                if (outcome.problem.dataEffect === 'unknown') {
                    reload();
                }
                return;
            }
            if (outcome.value.kind !== 'workspace.migration-rollback-session') {
                setMigrationActionProblem('Workspace 返回了意外的迁移回退状态。');
                return;
            }
            setMigrationDialogOpen(false);
            reload();
        }).catch(() => {
            setMigrationActionProblem('确认结果尚无法确认；CourseFlow 将重新检查回退状态。');
            reload();
        }).finally(() => setMigrationBusy(false));
    };

    const runMigrationMaintenanceAction = (
        action: 'cancel-as-source' | 'continue-as-target',
    ): void => {
        if (migrationBusy
            || state.kind !== 'migration-maintenance'
            || !state.session.migrationRollbackSessionId
            || !state.session.sessionVersion) {
            return;
        }
        const retryCommand = state.session.retryCommand?.action === action
            ? state.session.retryCommand
            : null;
        const command = {
            commandId: retryCommand?.commandId ?? globalThis.crypto.randomUUID(),
            migrationRollbackSessionId: state.session.migrationRollbackSessionId,
            expectedSessionVersion: retryCommand?.expectedSessionVersion
                ?? state.session.sessionVersion,
        };
        setMigrationBusy(true);
        setMigrationActionProblem(null);
        const request = action === 'cancel-as-source'
            ? window.courseFlow.cancelMigrationRollback(command)
            : window.courseFlow.continueMigrationRollback(command);
        void request.then(outcome => {
            if (!outcome.ok) {
                setMigrationActionProblem(outcome.problem.message);
                if (outcome.problem.dataEffect === 'unknown') {
                    reload();
                }
                return;
            }
            if (outcome.value.kind !== 'workspace.migration-rollback-session') {
                setMigrationActionProblem('Workspace 返回了意外的迁移回退状态。');
                return;
            }
            if (outcome.value.session.phase === 'succeeded'
                || outcome.value.session.phase === 'cancelled') {
                reload();
                return;
            }
            const nextSession = outcome.value.session;
            setState(current => current.kind === 'migration-maintenance'
                ? {...current, session: nextSession}
                : current);
        }).catch(() => {
            setMigrationActionProblem('操作结果尚无法确认；请重新检查迁移回退状态。');
            reload();
        }).finally(() => setMigrationBusy(false));
    };

    const refreshPlan = useCallback((setup: SetupProjection): void => {
        // A committed change invalidates any week the Calendar wandered to.
        setCalendarWeekOffset(0);
        setCalendarWeekPlan(null);
        setCalendarWeekProblem(null);
        setCalendarSelectedDate(null);
        void loadPlan(window.courseFlow, setup).then(result => {
            setState(current => current.kind === 'ready'
                && current.setup.projection.workspaceRevision === setup.workspaceRevision
                ? { ...current, ...result }
                : current);
        });
    }, []);

    /**
     * Asks Workspace for one explicit Calendar week without moving Today or the week summary.
     *
     * @param {number} offset Whole weeks away from the week that contains today.
     * @return {void}
     */
    const showCalendarWeek = (offset: number): void => {
        if (state.kind !== 'ready' || state.plan === null || calendarWeekBusy) {
            return;
        }
        if (offset === 0) {
            setCalendarWeekOffset(0);
            setCalendarWeekPlan(null);
            setCalendarWeekProblem(null);
            setCalendarSelectedDate(null);
            return;
        }

        const currentWeekStart = addCalendarDays(
            state.plan.calendar.window.startDate,
            -calendarWeekOffset * 7,
        );
        const startDate = addCalendarDays(currentWeekStart, offset * 7);
        const requestedWindow = { startDate, endDate: addCalendarDays(startDate, 6) };
        setCalendarWeekBusy(true);
        setCalendarWeekProblem(null);
        void loadPlan(window.courseFlow, state.setup.projection, requestedWindow)
            .then(result => {
                if (result.plan === null) {
                    setCalendarWeekProblem(result.planProblem ?? CALENDAR_WEEK_UNAVAILABLE);
                    return;
                }
                setCalendarWeekOffset(offset);
                setCalendarWeekPlan(result.plan);
                // Another week is another set of days; the detail falls back to today or that Monday.
                setCalendarSelectedDate(null);
            })
            .catch(() => setCalendarWeekProblem(CALENDAR_WEEK_UNAVAILABLE))
            .finally(() => setCalendarWeekBusy(false));
    };

    const acceptSetupProjection = (setup: ResolvedSetupState): void => {
        setState(current => current.kind === 'ready'
            ? {
                ...current,
                setup,
                plan: setup.projection.currentTerm === null ? null : current.plan,
                planProblem: null,
            }
            : current);
        refreshPlan(setup.projection);
    };

    const observeTaskActionState = (nextState: TaskOccurrenceActionsState | null): void => {
        setTaskActionState(nextState);
        const problem = nextState?.commandState.problem?.message;
        if (problem !== undefined) {
            setTaskActionProblem(problem);
        }
    };

    const acceptTaskActionResult = (result: WorkspaceTaskActionResult): void => {
        setTaskActionState(result.actionState);
        setTaskActionProblem(result.problem);
        const refresh = result.refresh;
        if (refresh !== null) {
            setState(current => current.kind === 'ready'
                ? {
                    ...current,
                    setup: refresh.setup,
                    plan: refresh.plan,
                    planProblem: null,
                }
                : current);
        }
    };

    const finishUnexpectedTaskActionFailure = (): void => {
        setTaskActionState(null);
        setTaskActionProblem('无法连接本地 Workspace；提交结果尚无法确认。');
    };

    const rememberTaskActionFocus = (itemId: string): void => {
        // The Task row that follows the acted one, captured now because the acted row may
        // leave the visible list (Tasks page archive, filter) before focus is restored.
        const rows = Array.from(
            document.querySelectorAll<HTMLElement>('[data-item-id^="task:"][tabindex]'),
        );
        taskActionFocusRef.current = {
            itemId,
            nextItemId: nextTaskItemIdFrom(rows.map(row => row.dataset.itemId ?? ''), itemId),
            page: activePage,
            trigger: document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null,
        };
    };

    const restoreTaskActionFocus = (): void => {
        const target = taskActionFocusRef.current;
        taskActionFocusRef.current = null;
        if (target === null) {
            return;
        }

        globalThis.requestAnimationFrame(() => {
            if (taskActionFocusRef.current !== null) {
                return;
            }
            const active = document.activeElement;
            if (active instanceof HTMLElement
                && active !== document.body
                && active !== target.trigger
                && active.isConnected) {
                return;
            }
            if (target.trigger?.isConnected
                && (!(target.trigger instanceof HTMLButtonElement) || !target.trigger.disabled)) {
                focusTaskActionTarget(target.trigger);
                return;
            }
            // Only rows that can take focus count: Today also stamps the identity on timeline items.
            const rows = Array.from(
                document.querySelectorAll<HTMLElement>('[data-item-id][tabindex]'),
            ).map(element => ({
                itemId: element.dataset.itemId ?? '',
                hidden: element.closest('details:not([open])') !== null,
                element,
                action: element.querySelector<HTMLButtonElement>('button:not(:disabled)'),
                summary: element.closest('details')?.querySelector<HTMLElement>('summary') ?? null,
            }));
            const focusTarget = taskActionFocusTargetFrom({
                rows,
                itemId: target.itemId,
                nextItemId: target.nextItemId,
                heading: document.getElementById(PAGE_HEADING_IDS[target.page]),
            });
            if (focusTarget !== null) {
                focusTaskActionTarget(focusTarget);
            }
        });
    };

    const runTaskAction = (
        task: PlanTaskProjection,
        action: TaskOccurrenceAction,
    ): void => {
        if (taskActionInFlightRef.current
            || state.kind !== 'ready'
            || state.setup.dataMode === 'read-only'
            || state.plan === null) {
            return;
        }

        const occurrenceId = task.occurrence.occurrenceId;
        const retainedActionState = taskActionState ?? undefined;
        rememberTaskActionFocus(taskPresentationItemId(occurrenceId));
        taskActionInFlightRef.current = true;
        setTaskActionBusyItemId(taskPresentationItemId(occurrenceId));
        setTaskActionProblem(null);
        void runWorkspaceTaskOccurrenceAction({
            bridge: window.courseFlow,
            plan: state.plan,
            occurrenceId,
            action,
            actionState: retainedActionState,
            makeId: () => globalThis.crypto.randomUUID(),
            now: Date.now,
            onStateChange: observeTaskActionState,
        }).then(acceptTaskActionResult).catch(finishUnexpectedTaskActionFailure).finally(() => {
            taskActionInFlightRef.current = false;
            setTaskActionBusyItemId(null);
            restoreTaskActionFocus();
        });
    };

    const undoTaskAction = (): void => {
        const capability = taskActionState?.commandState.undoCapability;
        if (taskActionInFlightRef.current
            || state.kind !== 'ready'
            || state.setup.dataMode === 'read-only'
            || taskActionState === null
            || taskActionState.commandState.undoToast === null
            || capability === null
            || capability === undefined) {
            return;
        }

        const itemId = taskPresentationItemId(capability);
        rememberTaskActionFocus(itemId);
        taskActionInFlightRef.current = true;
        setTaskActionBusyItemId(itemId);
        setTaskActionProblem(null);
        void runWorkspaceTaskOccurrenceUndo({
            bridge: window.courseFlow,
            actionState: taskActionState,
            makeId: () => globalThis.crypto.randomUUID(),
            now: Date.now,
            onStateChange: observeTaskActionState,
        }).then(acceptTaskActionResult).catch(finishUnexpectedTaskActionFailure).finally(() => {
            taskActionInFlightRef.current = false;
            setTaskActionBusyItemId(null);
            restoreTaskActionFocus();
        });
    };

    const setTaskUndoHovered = (hovered: boolean): void => {
        setTaskActionState(current => current === null
            ? null
            : setTaskUndoToastHovered(current, hovered, Date.now()));
    };

    const setTaskUndoFocused = (focused: boolean): void => {
        setTaskActionState(current => current === null
            ? null
            : setTaskUndoToastFocused(current, focused, Date.now()));
    };

    if (state.kind === 'loading') {
        return (
            <div className="startup-frame">
                <WindowTitlebar />
                <main className="startup-surface">
                    <section
                        aria-live="polite"
                        className="status-card"
                    >
                        <p className="eyebrow">CourseFlow</p>
                        <h1>正在读取本地工作区</h1>
                        <p>课程数据仍保存在这台设备上。</p>
                    </section>
                </main>
            </div>
        );
    }

    if (state.kind === 'migration-maintenance') {
        return (
            <div className="startup-frame">
                <WindowTitlebar />
                <MigrationMaintenanceSurface
                    buildStatus={state.buildStatus}
                    busy={migrationBusy}
                    onCancel={() => runMigrationMaintenanceAction('cancel-as-source')}
                    onContinue={() => runMigrationMaintenanceAction('continue-as-target')}
                    onRetry={reload}
                    problem={migrationActionProblem ?? state.problem}
                    session={state.session}
                />
            </div>
        );
    }

    if (state.kind === 'welcome') {
        return (
            <div className="startup-frame">
                <WindowTitlebar />
                <WelcomeSurface onStart={startNewWorkspace} />
            </div>
        );
    }

    if (state.kind === 'maintenance' || state.kind === 'recovery') {
        const recovery = state.kind === 'recovery';
        return (
            <div className="startup-frame">
                <WindowTitlebar />
                <main className="startup-surface">
                    <section
                        aria-labelledby="workspace-lifecycle-title"
                        className={`status-card${recovery ? ' status-card--problem' : ''}`}
                    >
                        <p className="eyebrow">{recovery ? 'Recovery' : 'Maintenance'}</p>
                        <h1 id="workspace-lifecycle-title">
                            {recovery ? '需要恢复本地工作区' : '正在维护本地工作区'}
                        </h1>
                        <p role={recovery ? 'alert' : 'status'}>{state.message}</p>
                        <button
                            className="primary-action"
                            onClick={reload}
                            type="button"
                        >重新检查</button>
                    </section>
                </main>
            </div>
        );
    }

    if (state.kind === 'problem') {
        return (
            <div className="startup-frame">
                <WindowTitlebar />
                <main className="startup-surface">
                    <section
                        aria-labelledby="workspace-problem-title"
                        className="status-card status-card--problem"
                    >
                        <p className="eyebrow">Workspace unavailable</p>
                        <h1 id="workspace-problem-title">暂时无法打开工作区</h1>
                        <p role="alert">{state.message}</p>
                        <button
                            className="primary-action"
                            onClick={reload}
                            type="button"
                        >重试</button>
                    </section>
                </main>
            </div>
        );
    }

    const taskActions: TaskActionPresentation = {
        writable: state.setup.dataMode === 'ready',
        busyItemId: taskActionBusyItemId,
        problem: taskActionProblem,
        canRunAction(task, action): boolean {
            if (taskActionState === null || !hasPendingTaskOccurrenceRequest(taskActionState)) {
                return true;
            }
            return hasPendingTaskOccurrenceAction(
                taskActionState,
                task.occurrence.occurrenceId,
                action,
            );
        },
        undo: taskUndoPresentationFrom(
            taskActionState,
            state.setup.dataMode === 'read-only'
                || taskActionBusyItemId !== null
                || taskActionState?.commandState.submitting === true
                || taskActionState?.commandState.requeryRequest !== null,
        ),
        onAction: runTaskAction,
        onUndo: undoTaskAction,
        onUndoHoverChange: setTaskUndoHovered,
        onUndoFocusChange: setTaskUndoFocused,
    };

    return (
        <>
            <WorkspaceShell
                activePage={activePage}
                calendarWeek={{
                    offset: calendarWeekOffset,
                    busy: calendarWeekBusy,
                    problem: calendarWeekProblem,
                    plan: calendarWeekPlan,
                    selectedDate: calendarSelectedDate,
                    onSelectDate: setCalendarSelectedDate,
                    onShift: weeks => showCalendarWeek(calendarWeekOffset + weeks),
                    onReturnToCurrentWeek: () => showCalendarWeek(0),
                }}
                dataMode={state.setup.dataMode}
                onNavigate={setActivePage}
                onCreateTask={() => openManagement('task')}
                onOpenManagement={openManagement}
                onOpenSettings={openSettings}
                onOpenSetup={openSetup}
                onRetryPlan={() => refreshPlan(state.setup.projection)}
                plan={state.plan}
                planProblem={state.planProblem}
                setup={state.setup.projection}
                taskActions={taskActions}
                taskList={{ filter: taskListFilter, onFilterChange: setTaskListFilter }}
            />
            <SettingsDialog
                buildStatus={state.buildStatus}
                dataMode={state.setup.dataMode}
                onClose={closeSettings}
                onOpenDataProtection={openDataProtection}
                onOpenManagement={openManagement}
                onOpenSetup={openSetup}
                onProjection={acceptSetupProjection}
                open={settingsOpen}
                safetyCopy={state.migrationSafetyCopy}
                setup={state.setup.projection}
            />
            <SetupDialog
                onClose={closeSetup}
                onOpenManagement={openManagement}
                onProjection={acceptSetupProjection}
                open={setupOpen}
                state={state.setup}
            />
            <ManagementDialog
                onClose={closeManagement}
                onProjection={acceptSetupProjection}
                onSurfaceChange={setManagementSurface}
                open={managementOpen}
                state={state.setup}
                surface={managementSurface}
            />
            <MigrationProtectionDialog
                buildStatus={state.buildStatus}
                busy={migrationBusy}
                mode={migrationDialogMode}
                onClose={closeDataProtection}
                onConfirmDelete={deleteMigrationSafety}
                onConfirmRollback={confirmMigrationRollback}
                onModeChange={mode => {
                    setMigrationDialogMode(mode);
                    setMigrationActionProblem(null);
                }}
                onPreviewRollback={previewMigrationRollback}
                open={migrationDialogOpen}
                problem={migrationActionProblem}
                rollbackPreview={migrationRollbackPreview}
                safetyCopy={state.migrationSafetyCopy}
            />
        </>
    );
}

/**
 * Renders the five fixed destinations and one bounded Workspace page.
 *
 * @param {WorkspaceShellProps} props Validated projections and Shell callbacks.
 * @return {ReactElement} Accessible Workspace shell.
 */
export function WorkspaceShell(props: WorkspaceShellProps): ReactElement {
    const navigationRefs = useRef(new Map<WorkspaceNavigationId, HTMLButtonElement>());
    const taskFeedbackVisible = props.taskActions.problem !== null || props.taskActions.undo !== null;

    /**
     * Moves selection and DOM focus together for navigation arrow keys.
     *
     * @param {KeyboardEvent<HTMLButtonElement>} event Navigation key event.
     * @param {WorkspaceNavigationId} currentPage Currently focused destination.
     * @return {void}
     */
    const moveNavigationFocus = (
        event: KeyboardEvent<HTMLButtonElement>,
        currentPage: WorkspaceNavigationId,
    ): void => {
        const target = navigationTargetFromKey(currentPage, event.key);
        if (target === null) {
            return;
        }

        event.preventDefault();
        props.onNavigate(target);
        navigationRefs.current.get(target)?.focus();
    };

    const setupIncomplete = !props.setup.everReachedMinimum;
    return (
        <div className={taskFeedbackVisible
            ? 'workspace-frame workspace-frame--task-feedback'
            : 'workspace-frame'}>
            <a
                className="skip-link"
                href="#workspace-content"
            >跳到主要内容</a>
            <header className="topbar">
                <div
                    aria-label="CourseFlow"
                    className="brand-pill"
                >
                    <span
                        aria-hidden="true"
                        className="brand-symbol"
                    >C</span>
                    <span>CourseFlow</span>
                </div>
                <nav
                    aria-label="主导航"
                    className="primary-nav"
                >
                    {WORKSPACE_NAVIGATION_ITEMS.map(item => (
                        <button
                            aria-current={props.activePage === item.id ? 'page' : undefined}
                            className="navigation-button"
                            key={item.id}
                            onClick={() => props.onNavigate(item.id)}
                            onKeyDown={event => moveNavigationFocus(event, item.id)}
                            ref={element => {
                                if (element === null) {
                                    navigationRefs.current.delete(item.id);
                                }
                                else {
                                    navigationRefs.current.set(item.id, element);
                                }
                            }}
                            type="button"
                        >{item.label}</button>
                    ))}
                </nav>
                <div className="topbar-actions">
                    {props.dataMode === 'read-only' ? (
                        <span className="data-mode-status">只读模式</span>
                    ) : null}
                    {setupIncomplete ? (
                        <span className="setup-status-text">设置未完成</span>
                    ) : null}
                    <button
                        aria-label="打开设置"
                        className="settings-button"
                        onClick={props.onOpenSettings}
                        type="button"
                    >设置</button>
                </div>
                <WindowControls />
            </header>
            <main
                className="workspace-content"
                id="workspace-content"
                tabIndex={-1}
            >
                <WorkspacePage
                    calendarWeek={props.calendarWeek}
                    onContinueSetup={props.onOpenSetup}
                    onCreateTask={props.onCreateTask}
                    onOpenManagement={props.onOpenManagement}
                    onNavigate={page => {
                        props.onNavigate(page);
                        globalThis.requestAnimationFrame(() => {
                            document.getElementById(PAGE_HEADING_IDS[page])?.focus();
                        });
                    }}
                    onRetryPlan={props.planProblem === null ? undefined : props.onRetryPlan}
                    page={props.activePage}
                    plan={props.plan}
                    planProblem={props.planProblem}
                    setup={props.setup}
                    setupIncomplete={setupIncomplete}
                    taskActions={props.taskActions}
                    taskList={props.taskList}
                />
            </main>
            <TaskActionNotice presentation={props.taskActions} />
            <p
                aria-live="polite"
                className="visually-hidden"
            >当前页面：{props.activePage}</p>
        </div>
    );
}

export { loadWorkspace, type WorkspaceLoadResult } from './app/load-workspace';
export {
    advanceTaskUndoTimerState,
    focusTaskActionTarget,
    nextTaskItemIdFrom,
    taskActionFocusTargetFrom,
    runWorkspaceTaskOccurrenceAction,
    runWorkspaceTaskOccurrenceUndo,
    taskUndoPresentationFrom,
    taskUndoTimerDelayFrom,
    type RunWorkspaceTaskOccurrenceActionOptions,
    type RunWorkspaceTaskOccurrenceUndoOptions,
    type TaskActionAppBridge,
    type TaskActionWorkspaceRefresh,
    type WorkspaceTaskActionResult,
} from './app/task-actions';
