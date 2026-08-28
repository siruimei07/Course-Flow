/**
 * @file Aggregates Workspace mode, route, capabilities, health, and durable work.
 */

import type {WorkspaceDataStatus} from '../shared/bootstrap-contract';
import {
    isWorkspaceLifecycleProjection,
    type CapabilityState,
    type ModuleHealth,
    type WorkspaceLifecycleProjection,
    type WorkspaceOperationProjection,
    type WorkspacePendingFollowUpProjection,
} from '../shared/workspace-lifecycle-contract';

export type WorkspaceModuleStatus = Readonly<{
    health: ModuleHealth;
    capability: CapabilityState;
}>;

export type WorkspaceLifecycleInput = Readonly<{
    workspaceData: WorkspaceDataStatus;
    setupRoute: 'setup' | 'today' | null;
    startupDisposition: 'ordinary' | 'maintenance' | 'recovery';
    moduleStatus: Readonly<Partial<Record<
        'attend' | 'library' | 'grade' | 'protect',
        WorkspaceModuleStatus
    >>>;
    operations: readonly WorkspaceOperationProjection[];
    pendingFollowUps: readonly WorkspacePendingFollowUpProjection[];
}>;

const DISABLED_MODULE: WorkspaceModuleStatus = Object.freeze({
    health: 'healthy' as const,
    capability: 'disabled-by-user' as const,
});
const AVAILABLE_MODULE: WorkspaceModuleStatus = Object.freeze({
    health: 'healthy' as const,
    capability: 'available' as const,
});

function protectionStatusFrom(input: WorkspaceLifecycleInput): WorkspaceModuleStatus {
    const configured = input.moduleStatus.protect ?? AVAILABLE_MODULE;
    const pendingCleanup = input.operations.some(operation => (
        operation.kind === 'backup-cleanup'
        && operation.state !== 'succeeded'
        && operation.state !== 'cancelled'
    ));
    const pendingBackupRecovery = input.operations.some(operation => (
        operation.kind === 'backup'
        && (operation.state === 'recovery-required' || operation.state === 'failed')
    ));
    if ((pendingCleanup || pendingBackupRecovery) && configured.health === 'healthy') {
        return Object.freeze({
            health: 'degraded' as const,
            capability: 'recovering' as const,
        });
    }
    return configured;
}

function moduleCausesLimited(status: WorkspaceModuleStatus): boolean {
    return status.capability !== 'disabled-by-user'
        && (status.health !== 'healthy'
            || status.capability === 'unavailable'
            || status.capability === 'recovering');
}

function activeRevision(workspaceData: WorkspaceDataStatus): string | null {
    return workspaceData.kind === 'ready' || workspaceData.kind === 'read-only'
        ? workspaceData.revision
        : null;
}

/**
 * Derives the single FLOW-00 lifecycle projection from already validated owner facts.
 * @param {WorkspaceLifecycleInput} input Current DATA, setup, module, operation, and follow-up facts.
 * @return {WorkspaceLifecycleProjection} Frozen path-free Workspace projection.
 */
export function workspaceLifecycleFrom(
    input: WorkspaceLifecycleInput,
): WorkspaceLifecycleProjection {
    const attend = input.moduleStatus.attend ?? DISABLED_MODULE;
    const library = input.moduleStatus.library ?? DISABLED_MODULE;
    const grade = input.moduleStatus.grade ?? DISABLED_MODULE;
    const protect = protectionStatusFrom(input);
    const setupUnavailable = input.startupDisposition === 'ordinary'
        && (input.workspaceData.kind === 'ready'
        || input.workspaceData.kind === 'read-only')
        && input.setupRoute === null;
    const recovery = input.startupDisposition === 'recovery'
        || (input.workspaceData.kind === 'recovery'
            && input.startupDisposition !== 'maintenance')
        || setupUnavailable;
    const maintenance = !recovery && input.startupDisposition === 'maintenance';
    const readOnly = !recovery && !maintenance && input.workspaceData.kind === 'read-only';
    const limited = !recovery
        && !maintenance
        && !readOnly
        && [attend, library, grade, protect].some(moduleCausesLimited);
    const mode = recovery
        ? 'recovery' as const
        : maintenance
            ? 'maintenance' as const
            : readOnly
                ? 'read-only' as const
                : limited
                    ? 'limited' as const
                    : 'ready' as const;
    const route = recovery
        ? 'recovery' as const
        : maintenance
            ? 'maintenance' as const
            : input.workspaceData.kind === 'absent'
                ? 'welcome' as const
                : input.setupRoute ?? 'recovery';
    const hasActiveData = input.workspaceData.kind === 'ready'
        || input.workspaceData.kind === 'read-only';
    const writable = input.workspaceData.kind === 'ready';
    const capabilities = {
        'workspace.initialize': input.workspaceData.kind === 'absent' && !maintenance && !recovery
            ? 'available' as const
            : 'unavailable' as const,
        'workspace.read': recovery || maintenance
            ? 'recovering' as const
            : hasActiveData ? 'available' as const : 'unavailable' as const,
        'workspace.write': recovery || maintenance
            ? 'recovering' as const
            : writable ? 'available' as const : 'unavailable' as const,
        'plan.read': recovery || maintenance
            ? 'recovering' as const
            : hasActiveData ? 'available' as const : 'unavailable' as const,
        'plan.write': recovery || maintenance
            ? 'recovering' as const
            : writable ? 'available' as const : 'unavailable' as const,
        'attend.read': recovery || maintenance ? 'unavailable' as const : attend.capability,
        'attend.write': recovery || maintenance ? 'unavailable' as const : attend.capability,
        'library.read': recovery || maintenance ? 'unavailable' as const : library.capability,
        'library.write': recovery || maintenance ? 'unavailable' as const : library.capability,
        'grade.read': recovery || maintenance ? 'unavailable' as const : grade.capability,
        'grade.write': recovery || maintenance ? 'unavailable' as const : grade.capability,
        'protect.backup': recovery || maintenance || !writable
            ? 'unavailable' as const
            : protect.capability,
        'protect.restore': recovery || maintenance ? 'recovering' as const : protect.capability,
    };
    const projection: WorkspaceLifecycleProjection = Object.freeze({
        mode,
        route,
        workspaceRevision: activeRevision(input.workspaceData),
        capabilities: Object.freeze(capabilities),
        moduleHealth: Object.freeze({
            'MOD-DATA': recovery && input.workspaceData.kind === 'recovery'
                ? 'recovery-required' as const
                : 'healthy' as const,
            'MOD-PLAN': setupUnavailable ? 'recovery-required' as const : 'healthy' as const,
            'MOD-ATTEND': attend.health,
            'MOD-LIBRARY': library.health,
            'MOD-GRADE': grade.health,
            'MOD-PROTECT': input.startupDisposition === 'recovery'
                ? 'recovery-required' as const
                : protect.health,
        }),
        operations: Object.freeze(input.operations.map(operation => Object.freeze({...operation}))),
        pendingFollowUps: Object.freeze(input.pendingFollowUps.map(followUp => (
            Object.freeze({...followUp})
        ))),
    });
    if (!isWorkspaceLifecycleProjection(projection)) {
        throw new Error('Workspace lifecycle projection is invalid');
    }
    return projection;
}
