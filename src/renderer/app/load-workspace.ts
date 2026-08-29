import type { WorkspaceDataStatus } from '../../shared/bootstrap-contract';

import { ResolvedSetupState } from '../SetupDialog';
import { setupStateFrom } from '../setup-state';
import { planProjectionStateFrom } from '../workspace-view-state';
import { WorkspaceMode } from '../../shared/workspace-lifecycle-contract';
import type { ApplicationBuildStatus, MigrationRollbackSessionView, MigrationSafetyCopyProjection } from '../../shared/workspace-migration-contract';
import type { PlanProjection } from '../../shared/workspace-plan-contract';
import type { SetupProjection } from '../../shared/workspace-term-contract';
export type WorkspaceLoadResult =
    | Readonly<{
        kind: 'welcome';
    }>
    | Readonly<{
        kind: 'maintenance';
        message: string;
    }>
    | Readonly<{
        kind: 'recovery';
        message: string;
    }>
    | Readonly<{
        kind: 'problem';
        message: string;
    }>
    | Readonly<{
        kind: 'migration-maintenance';
        buildStatus: ApplicationBuildStatus | null;
        session: MigrationRollbackSessionView;
        problem: string | null;
    }>
    | Readonly<{
        kind: 'ready';
        setup: ResolvedSetupState;
        plan: PlanProjection | null;
        planProblem: string | null;
        buildStatus: ApplicationBuildStatus | null;
        migrationSafetyCopy: MigrationSafetyCopyProjection;
        migrationProblem: string | null;
        route: 'setup' | 'today';
        workspaceMode: Extract<WorkspaceMode, 'ready' | 'limited' | 'read-only'>;
    }>;

export type PlanLoadResult = Readonly<{
    plan: PlanProjection | null;
    planProblem: string | null;
}>;

export type MigrationProtectionLoad = Readonly<{
    buildStatus: ApplicationBuildStatus | null;
    migrationSafetyCopy: MigrationSafetyCopyProjection;
    migrationProblem: string | null;
}>;

/**
 * Loads PLAN only when a Current Term makes the query applicable.
 *
 * @param {Window['courseFlow']} bridge Bounded preload bridge.
 * @param {SetupProjection} setup Validated Setup projection.
 * @return {Promise<PlanLoadResult>} Available PLAN facts or an explicit failure.
 */
export async function loadPlan(
    bridge: Window['courseFlow'],
    setup: SetupProjection,
): Promise<PlanLoadResult> {
    if (setup.currentTerm === null) {
        return { plan: null, planProblem: null };
    }

    try {
        const planState = planProjectionStateFrom(await bridge.queryPlan());
        if (planState.kind === 'unavailable') {
            return { plan: null, planProblem: planState.message };
        }
        return { plan: planState.projection, planProblem: null };
    }
    catch {
        return {
            plan: null,
            planProblem: '无法读取统一计划投影；正式学期与课程数据没有改变。',
        };
    }
}

/**
 * Creates the fail-closed Renderer fallback when Workspace status is unavailable.
 * @return {MigrationRollbackSessionView} Recovery view with no allowed action.
 */
export function rollbackRecoveryView(): MigrationRollbackSessionView {
    return {
        migrationRollbackSessionId: null,
        operationId: null,
        sessionVersion: null,
        phase: 'recovery-required',
        currentBuild: 'recovery-required',
        binding: null,
        previewToken: null,
        retryCommand: null,
        allowedActions: [],
        outcome: null,
        problem: {code: 'recovery-required'},
    };
}

/**
 * Loads build and migration-safety projections without blocking the PLAN core.
 * @param {Window['courseFlow']} bridge Bounded preload bridge.
 * @return {Promise<MigrationProtectionLoad>} Available projections and scoped problem.
 */
export async function loadMigrationProtection(
    bridge: Window['courseFlow'],
): Promise<MigrationProtectionLoad> {
    let buildStatus: ApplicationBuildStatus | null = null;
    let migrationSafetyCopy: MigrationSafetyCopyProjection = {kind: 'unavailable'};
    const problems: string[] = [];
    try {
        const outcome = await bridge.queryApplicationBuildStatus();
        if (outcome.ok && outcome.value.kind === 'workspace.application-build-status') {
            buildStatus = outcome.value.status;
        }
        else {
            problems.push(outcome.ok ? '当前构建状态不可用。' : outcome.problem.message);
        }
    }
    catch {
        problems.push('无法读取当前构建状态。');
    }
    try {
        const outcome = await bridge.queryMigrationSafetyCopy();
        if (outcome.ok && outcome.value.kind === 'workspace.migration-safety-copy') {
            migrationSafetyCopy = outcome.value.safetyCopy;
        }
        else {
            problems.push(outcome.ok ? '迁移安全副本状态不可用。' : outcome.problem.message);
        }
    }
    catch {
        problems.push('无法读取迁移安全副本状态。');
    }
    return {
        buildStatus,
        migrationSafetyCopy,
        migrationProblem: problems.length === 0 ? null : problems.join(' '),
    };
}

/**
 * Extracts the rollback startup route from one Workspace DATA recovery status.
 * @param {WorkspaceDataStatus} problem Bootstrap DATA status.
 * @return {string | null | undefined} Session, evidence-only recovery, or non-rollback state.
 */
export function migrationRollbackSessionIdFrom(
    problem: WorkspaceDataStatus,
): string | null | undefined {
    if (problem.kind !== 'recovery') {
        return undefined;
    }
    const details = problem.problem.details;
    const reason = 'reason' in details ? details.reason : null;
    if (reason === 'migration-rollback-evidence') {
        return null;
    }
    if (reason !== 'migration-rollback-pending') {
        return undefined;
    }
    return 'migrationRollbackSessionId' in problem.problem.context
        ? problem.problem.context.migrationRollbackSessionId
        : null;
}

/**
 * Loads the exclusive rollback route before any ordinary Workspace query.
 * @param {Window['courseFlow']} bridge Bounded preload bridge.
 * @param {string | null} migrationRollbackSessionId Exact session or recovery evidence.
 * @return {Promise<Extract<WorkspaceLoadResult, {kind: 'migration-maintenance'}>>} Dedicated route.
 */
export async function loadMigrationMaintenance(
    bridge: Window['courseFlow'],
    migrationRollbackSessionId: string | null,
): Promise<Extract<WorkspaceLoadResult, Readonly<{kind: 'migration-maintenance'}>>> {
    let buildStatus: ApplicationBuildStatus | null = null;
    let session = rollbackRecoveryView();
    const problems: string[] = [];
    try {
        const outcome = await bridge.queryApplicationBuildStatus();
        if (outcome.ok && outcome.value.kind === 'workspace.application-build-status') {
            buildStatus = outcome.value.status;
        }
        else {
            problems.push(outcome.ok ? '当前构建状态不可用。' : outcome.problem.message);
        }
    }
    catch {
        problems.push('无法读取当前构建状态。');
    }
    try {
        const outcome = await bridge.queryMigrationRollbackStatus(migrationRollbackSessionId);
        if (outcome.ok && outcome.value.kind === 'workspace.migration-rollback-session') {
            session = outcome.value.session;
        }
        else {
            problems.push(outcome.ok ? '回退状态不可用。' : outcome.problem.message);
        }
    }
    catch {
        problems.push('无法读取迁移回退状态。');
    }
    return {
        kind: 'migration-maintenance',
        buildStatus,
        session,
        problem: problems.length === 0 ? null : problems.join(' '),
    };
}

/**
 * Resolves startup through Bootstrap, SetupProjection, and the existing PLAN projection.
 *
 * @param {Window['courseFlow']} bridge Bounded preload bridge.
 * @return {Promise<WorkspaceLoadResult>} Shell-ready projection state or one blocking problem.
 */
export async function loadWorkspace(
    bridge: Window['courseFlow'],
): Promise<WorkspaceLoadResult> {
    try {
        const bootstrap = await bridge.query();
        if (!bootstrap.ok) {
            return { kind: 'problem', message: bootstrap.problem.message };
        }
        const lifecycle = bootstrap.value.workspaceLifecycle;
        if (lifecycle.route === 'welcome') {
            return {kind: 'welcome'};
        }
        if (lifecycle.route === 'maintenance' || lifecycle.route === 'recovery') {
            const migrationRollbackSessionId = migrationRollbackSessionIdFrom(
                bootstrap.value.workspaceData,
            );
            if (migrationRollbackSessionId !== undefined) {
                return loadMigrationMaintenance(bridge, migrationRollbackSessionId);
            }
            return {
                kind: lifecycle.route,
                message: lifecycle.route === 'maintenance'
                    ? '本地工作区正在完成已确认的维护操作；普通读写和备份暂时关闭。'
                    : '本地工作区需要根据当前证据恢复；不会自动执行继续、回滚或取消。',
            };
        }
        if (bootstrap.value.workspaceData.kind === 'absent'
            || bootstrap.value.workspaceData.kind === 'recovery'
            || lifecycle.mode === 'maintenance'
            || lifecycle.mode === 'recovery') {
            return {
                kind: 'recovery',
                message: 'Workspace 启动状态不一致，已停止普通工作区查询。',
            };
        }

        const [setupOutcome, migrationProtection] = await Promise.all([
            bridge.querySetup(),
            loadMigrationProtection(bridge),
        ]);
        const setupState = setupStateFrom(setupOutcome);
        if (setupState.kind === 'problem') {
            return { kind: 'problem', message: setupState.message };
        }
        if (setupState.kind === 'loading') {
            return { kind: 'problem', message: 'Workspace 未返回设置投影。' };
        }

        return {
            kind: 'ready',
            setup: setupState,
            ...await loadPlan(bridge, setupState.projection),
            ...migrationProtection,
            route: lifecycle.route,
            workspaceMode: lifecycle.mode,
        };
    }
    catch {
        return {
            kind: 'problem',
            message: '无法连接本地 Workspace，请重试。',
        };
    }
}
