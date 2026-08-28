/**
 * @file Defines the closed, path-free Workspace lifecycle startup projection.
 */

import {
    isCanonicalUnsignedSqliteInteger,
    isCanonicalUuid,
} from './workspace-data-contract';

export const WORKSPACE_CAPABILITY_NAMES = Object.freeze([
    'workspace.initialize',
    'workspace.read',
    'workspace.write',
    'plan.read',
    'plan.write',
    'attend.read',
    'attend.write',
    'library.read',
    'library.write',
    'grade.read',
    'grade.write',
    'protect.backup',
    'protect.restore',
] as const);

export const WORKSPACE_MODULE_IDS = Object.freeze([
    'MOD-DATA',
    'MOD-PLAN',
    'MOD-ATTEND',
    'MOD-LIBRARY',
    'MOD-GRADE',
    'MOD-PROTECT',
] as const);

export type WorkspaceCapabilityName = typeof WORKSPACE_CAPABILITY_NAMES[number];
export type WorkspaceModuleId = typeof WORKSPACE_MODULE_IDS[number];
export type CapabilityState = 'available' | 'disabled-by-user' | 'unavailable' | 'recovering';
export type ModuleHealth = 'healthy' | 'degraded' | 'unavailable' | 'recovery-required';
export type WorkspaceMode = 'ready' | 'limited' | 'read-only' | 'maintenance' | 'recovery';
export type WorkspaceRoute = 'welcome' | 'setup' | 'today' | 'maintenance' | 'recovery';
export type WorkspaceOperationState =
    | 'accepted'
    | 'running'
    | 'waiting-decision'
    | 'recovery-required'
    | 'succeeded'
    | 'failed'
    | 'cancelled';

export type WorkspaceOperationProjection = Readonly<{
    operationId: string;
    owner: 'protect';
    kind: 'backup' | 'backup-cleanup' | 'restore' | 'migration-rollback';
    state: WorkspaceOperationState;
    version: string;
}>;

export type WorkspacePendingFollowUpProjection = Readonly<{
    followUpId: string;
    originatingCommandId: string;
    owner: 'protect';
    kind: 'backup-needed-through';
    prerequisiteRevision: string;
    state: 'pending';
    version: '0';
}>;

export type WorkspaceLifecycleProjection = Readonly<{
    mode: WorkspaceMode;
    route: WorkspaceRoute;
    workspaceRevision: string | null;
    capabilities: Readonly<Record<WorkspaceCapabilityName, CapabilityState>>;
    moduleHealth: Readonly<Record<WorkspaceModuleId, ModuleHealth>>;
    operations: readonly WorkspaceOperationProjection[];
    pendingFollowUps: readonly WorkspacePendingFollowUpProjection[];
}>;

const LIFECYCLE_KEYS = Object.freeze([
    'mode',
    'route',
    'workspaceRevision',
    'capabilities',
    'moduleHealth',
    'operations',
    'pendingFollowUps',
]);
const OPERATION_KEYS = Object.freeze(['operationId', 'owner', 'kind', 'state', 'version']);
const FOLLOW_UP_KEYS = Object.freeze([
    'followUpId',
    'originatingCommandId',
    'owner',
    'kind',
    'prerequisiteRevision',
    'state',
    'version',
]);
function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    return keys.length === expected.length
        && keys.every(key => typeof key === 'string' && expected.includes(key))
        && expected.every(key => {
            const descriptor = descriptors[key];
            return descriptor !== undefined && 'value' in descriptor && descriptor.enumerable;
        });
}

function isCapabilityState(value: unknown): value is CapabilityState {
    return value === 'available'
        || value === 'disabled-by-user'
        || value === 'unavailable'
        || value === 'recovering';
}

function isModuleHealth(value: unknown): value is ModuleHealth {
    return value === 'healthy'
        || value === 'degraded'
        || value === 'unavailable'
        || value === 'recovery-required';
}

function isWorkspaceMode(value: unknown): value is WorkspaceMode {
    return value === 'ready'
        || value === 'limited'
        || value === 'read-only'
        || value === 'maintenance'
        || value === 'recovery';
}

function isWorkspaceRoute(value: unknown): value is WorkspaceRoute {
    return value === 'welcome'
        || value === 'setup'
        || value === 'today'
        || value === 'maintenance'
        || value === 'recovery';
}

function isWorkspaceOperationState(value: unknown): value is WorkspaceOperationState {
    return value === 'accepted'
        || value === 'running'
        || value === 'waiting-decision'
        || value === 'recovery-required'
        || value === 'succeeded'
        || value === 'failed'
        || value === 'cancelled';
}

function isOperation(value: unknown): value is WorkspaceOperationProjection {
    if (!isPlainObject(value)
        || !hasOnlyKeys(value, OPERATION_KEYS)
        || !isCanonicalUuid(value.operationId)
        || value.owner !== 'protect'
        || !isCanonicalUnsignedSqliteInteger(value.version)
        || !isWorkspaceOperationState(value.state)) {
        return false;
    }
    return value.kind === 'backup'
        || value.kind === 'backup-cleanup'
        || value.kind === 'restore'
        || value.kind === 'migration-rollback';
}

function isPendingFollowUp(value: unknown): value is WorkspacePendingFollowUpProjection {
    return isPlainObject(value)
        && hasOnlyKeys(value, FOLLOW_UP_KEYS)
        && isCanonicalUuid(value.followUpId)
        && isCanonicalUuid(value.originatingCommandId)
        && value.owner === 'protect'
        && value.kind === 'backup-needed-through'
        && isCanonicalUnsignedSqliteInteger(value.prerequisiteRevision)
        && value.state === 'pending'
        && value.version === '0';
}

function hasUniqueIdentities<T>(
    values: readonly T[],
    identity: (value: T) => string,
): boolean {
    return new Set(values.map(identity)).size === values.length;
}

function routeMatchesMode(
    mode: WorkspaceMode,
    route: WorkspaceRoute,
    workspaceRevision: string | null,
): boolean {
    if (route === 'welcome') {
        return workspaceRevision === null && mode !== 'maintenance' && mode !== 'recovery';
    }
    if (route === 'maintenance') {
        return mode === 'maintenance';
    }
    if (route === 'recovery') {
        return mode === 'recovery';
    }
    return workspaceRevision !== null && mode !== 'maintenance' && mode !== 'recovery';
}

/**
 * Validates the exact path-free Workspace lifecycle projection.
 * @param {unknown} value Candidate transport value.
 * @return {boolean} Whether the candidate is a current lifecycle projection.
 */
export function isWorkspaceLifecycleProjection(
    value: unknown,
): value is WorkspaceLifecycleProjection {
    if (!isPlainObject(value) || !hasOnlyKeys(value, LIFECYCLE_KEYS)) {
        return false;
    }
    const capabilities = isPlainObject(value.capabilities)
        ? value.capabilities
        : null;
    const moduleHealth = isPlainObject(value.moduleHealth)
        ? value.moduleHealth
        : null;
    if (!isWorkspaceMode(value.mode)
        || !isWorkspaceRoute(value.route)
        || (value.workspaceRevision !== null
            && !isCanonicalUnsignedSqliteInteger(value.workspaceRevision))
        || capabilities === null
        || !hasOnlyKeys(capabilities, WORKSPACE_CAPABILITY_NAMES)
        || !WORKSPACE_CAPABILITY_NAMES.every(name => isCapabilityState(capabilities[name]))
        || moduleHealth === null
        || !hasOnlyKeys(moduleHealth, WORKSPACE_MODULE_IDS)
        || !WORKSPACE_MODULE_IDS.every(moduleId => isModuleHealth(moduleHealth[moduleId]))
        || !Array.isArray(value.operations)
        || !value.operations.every(isOperation)
        || !hasUniqueIdentities(value.operations, operation => operation.operationId)
        || !Array.isArray(value.pendingFollowUps)
        || !value.pendingFollowUps.every(isPendingFollowUp)
        || !hasUniqueIdentities(value.pendingFollowUps, followUp => followUp.followUpId)) {
        return false;
    }
    return routeMatchesMode(value.mode, value.route, value.workspaceRevision);
}
