/**
 * @file Defines the versioned Workspace bootstrap contract and validators.
 */

import { isSupportedSqliteVersion } from './sqlite-version';
import { isCanonicalUnsignedSqliteInteger, isCanonicalUuid } from './workspace-data-contract';
import {
  isWorkspaceLifecycleProjection,
  type WorkspaceLifecycleProjection,
} from './workspace-lifecycle-contract';

export const BOOTSTRAP_PROTOCOL_VERSION = 3 as const;
export const WORKSPACE_QUERY_CHANNEL = 'courseflow:workspace-query' as const;

export type BootstrapRequest = Readonly<{
  kind: 'bootstrap.status';
  protocolVersion: typeof BOOTSTRAP_PROTOCOL_VERSION;
  appBuildId: string;
  requestId: string;
}>;

export type WorkspaceProbeRequest = BootstrapRequest &
  Readonly<{
    dataRootClass: 'verified-local';
  }>;

export type DataOpenProblem =
  | Readonly<{
      code: 'permission';
      scope: 'workspace';
      dataEffect: 'unchanged';
      affectedCapabilities: readonly ['workspace.write'];
      allowedActions: readonly [];
      context: Readonly<Record<never, never>>;
      details: Readonly<{ reason: 'read-only' }>;
    }>
  | Readonly<{
      code: 'incompatible-version';
      scope: 'workspace';
      dataEffect: 'unchanged';
      affectedCapabilities: readonly ['workspace.read', 'workspace.write'];
      allowedActions: readonly [];
      context: Readonly<Record<never, never>>;
      details: Readonly<{ actualSchemaLevel: number; requiredSchemaLevel: 16 }>;
    }>
  | Readonly<{
      code: 'integrity';
      scope: 'workspace';
      dataEffect: 'unchanged';
      affectedCapabilities: readonly ['workspace.read', 'workspace.write'];
      allowedActions: readonly [];
      context: Readonly<Record<never, never>>;
      details: Readonly<{
        reason: 'wrong-application-id' | 'nonempty-level-zero' | 'schema-mismatch' | 'database-corrupt';
      }>;
    }>
  | Readonly<{
      code: 'recovery-required';
      scope: 'workspace';
      dataEffect: 'unchanged';
      affectedCapabilities: readonly ['workspace.read', 'workspace.write'];
      allowedActions: readonly [];
      context: Readonly<Record<never, never>>;
      details: Readonly<{ reason: 'database-unreadable' }>;
    }>
  | Readonly<{
      code: 'migration-safety-unavailable';
      scope: 'workspace';
      dataEffect: 'unchanged';
      affectedCapabilities: readonly ['workspace.read', 'workspace.write'];
      allowedActions: readonly [];
      context: Readonly<Record<never, never>>;
      details: Readonly<{ reason: 'build-binding-missing' }>;
    }>
  | Readonly<{
      code: 'rollback-required';
      scope: 'workspace';
      dataEffect: 'unchanged';
      affectedCapabilities: readonly ['workspace.read', 'workspace.write'];
      allowedActions: readonly ('cancel-as-source' | 'continue-as-target')[];
      context: Readonly<{
        migrationRollbackSessionId: string;
        operationId: string;
      }>;
      details: Readonly<{
        reason: 'migration-rollback-pending';
        phase: 'planned' | 'prepared' | 'armed' | 'awaiting-target-build' | 'completing' | 'cancelling';
        currentBuild: 'source' | 'target';
        requiredBuilds: Readonly<{
          sourceAppBuildId: string;
          sourceReleaseVersion: string;
          targetAppBuildId: string;
          targetReleaseVersion: string;
        }>;
      }>;
    }>
  | Readonly<{
      code: 'rollback-build-mismatch';
      scope: 'workspace';
      dataEffect: 'unchanged';
      affectedCapabilities: readonly ['workspace.read', 'workspace.write'];
      allowedActions: readonly [];
      context: Readonly<{
        migrationRollbackSessionId: string;
        operationId: string;
      }>;
      details: Readonly<{
        reason: 'migration-rollback-pending';
        phase: 'planned' | 'prepared' | 'armed' | 'awaiting-target-build' | 'completing' | 'cancelling';
        currentBuild: 'other';
        requiredBuilds: Readonly<{
          sourceAppBuildId: string;
          sourceReleaseVersion: string;
          targetAppBuildId: string;
          targetReleaseVersion: string;
        }>;
      }>;
    }>
  | Readonly<{
      code: 'recovery-required';
      scope: 'workspace';
      dataEffect: 'unchanged';
      affectedCapabilities: readonly ['workspace.read', 'workspace.write'];
      allowedActions: readonly [];
      context: Readonly<Record<never, never>>;
      details: Readonly<{ reason: 'migration-rollback-evidence' }>;
    }>
  | Readonly<{
      code: 'recovery-required';
      scope: 'workspace';
      dataEffect: 'unchanged';
      affectedCapabilities: readonly ['workspace.read', 'workspace.write'];
      allowedActions: readonly ('resume' | 'rollback')[];
      context: Readonly<{
        restoreSessionId: string;
        operationId: string;
      }>;
      details: Readonly<{ reason: 'restore-activation-pending' }>;
    }>;

export type WorkspaceDataStatus =
  | Readonly<{ kind: 'absent' }>
  | Readonly<{
      kind: 'ready';
      workspaceId: string;
      schemaLevel: 16;
      revision: string;
    }>
  | Readonly<{
      kind: 'read-only';
      workspaceId: string;
      schemaLevel: 16;
      revision: string;
      problem: DataOpenProblem;
    }>
  | Readonly<{ kind: 'recovery'; problem: DataOpenProblem }>;

export type BootstrapReady = Readonly<{
  protocolVersion: typeof BOOTSTRAP_PROTOCOL_VERSION;
  appBuildId: string;
  requestId: string;
  workspaceProcess: 'ready';
  sqliteVersion: string;
  dataRootClass: 'verified-local';
  workspaceEpoch: string;
  workspaceData: WorkspaceDataStatus;
  workspaceLifecycle: WorkspaceLifecycleProjection;
}>;

export type BootstrapProblemCode =
  | 'invalid-request'
  | 'build-mismatch'
  | 'workspace-unavailable'
  | 'sqlite-unsupported';

export type BootstrapOutcome =
  | Readonly<{ ok: true; value: BootstrapReady }>
  | Readonly<{
      ok: false;
      problem: Readonly<{
        code: BootstrapProblemCode;
        message: string;
        requestId: string | null;
        appBuildId: string;
      }>;
    }>;

const requestKeys = ['kind', 'protocolVersion', 'appBuildId', 'requestId'];
const probeRequestKeys = [...requestKeys, 'dataRootClass'];
const readyKeys = [
  'protocolVersion',
  'appBuildId',
  'requestId',
  'workspaceProcess',
  'sqliteVersion',
  'dataRootClass',
  'workspaceEpoch',
  'workspaceData',
  'workspaceLifecycle',
];
const problemKeys = ['code', 'message', 'requestId', 'appBuildId'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  return (
    keys.length === allowedKeys.length &&
    keys.every((key) => typeof key === 'string' && allowedKeys.includes(key)) &&
    allowedKeys.every((key) => {
      const descriptor = descriptors[key];
      return descriptor !== undefined && 'value' in descriptor && descriptor.enumerable;
    })
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isBootstrapProblemCode(value: unknown): value is BootstrapProblemCode {
  return (
    value === 'invalid-request' ||
    value === 'build-mismatch' ||
    value === 'workspace-unavailable' ||
    value === 'sqlite-unsupported'
  );
}

function isExactStringList(value: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item, index) => item === expected[index])
  );
}

function isBoundedIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 255;
}

function isMigrationRollbackPhase(value: unknown): boolean {
  return value === 'planned'
    || value === 'prepared'
    || value === 'armed'
    || value === 'awaiting-target-build'
    || value === 'completing'
    || value === 'cancelling';
}

function isMigrationRollbackRequiredBuilds(value: unknown): boolean {
  return isPlainObject(value)
    && hasOnlyKeys(value, [
      'sourceAppBuildId',
      'sourceReleaseVersion',
      'targetAppBuildId',
      'targetReleaseVersion',
    ])
    && isBoundedIdentity(value.sourceAppBuildId)
    && isBoundedIdentity(value.sourceReleaseVersion)
    && isBoundedIdentity(value.targetAppBuildId)
    && value.targetAppBuildId !== value.sourceAppBuildId
    && isBoundedIdentity(value.targetReleaseVersion);
}

function isDataOpenProblem(value: unknown): value is DataOpenProblem {
  if (
    !isPlainObject(value) ||
    !hasOnlyKeys(value, [
      'code',
      'scope',
      'dataEffect',
      'affectedCapabilities',
      'allowedActions',
      'context',
      'details',
    ]) ||
    value.scope !== 'workspace' ||
    value.dataEffect !== 'unchanged' ||
    !isPlainObject(value.context) ||
    !isPlainObject(value.details)
  ) {
    return false;
  }

  if (value.code === 'recovery-required'
    && hasOnlyKeys(value.details, ['reason'])
    && value.details.reason === 'restore-activation-pending') {
    const actions = JSON.stringify(value.allowedActions);
    return isExactStringList(value.affectedCapabilities, ['workspace.read', 'workspace.write'])
      && (actions === JSON.stringify(['resume', 'rollback'])
        || actions === JSON.stringify(['resume'])
        || actions === JSON.stringify(['rollback'])
        || actions === JSON.stringify([]))
      && hasOnlyKeys(value.context, ['restoreSessionId', 'operationId'])
      && isCanonicalUuid(value.context.restoreSessionId)
      && isCanonicalUuid(value.context.operationId);
  }

  if ((value.code === 'rollback-required' || value.code === 'rollback-build-mismatch')
    && hasOnlyKeys(value.context, ['migrationRollbackSessionId', 'operationId'])
    && isCanonicalUuid(value.context.migrationRollbackSessionId)
    && isCanonicalUuid(value.context.operationId)
    && hasOnlyKeys(value.details, ['reason', 'phase', 'currentBuild', 'requiredBuilds'])
    && value.details.reason === 'migration-rollback-pending'
    && isMigrationRollbackPhase(value.details.phase)
    && isMigrationRollbackRequiredBuilds(value.details.requiredBuilds)
    && isExactStringList(value.affectedCapabilities, ['workspace.read', 'workspace.write'])) {
    if (value.code === 'rollback-build-mismatch') {
      return value.details.currentBuild === 'other'
        && isExactStringList(value.allowedActions, []);
    }
    if (value.details.currentBuild === 'source') {
      return isExactStringList(value.allowedActions, [])
        || isExactStringList(value.allowedActions, ['cancel-as-source']);
    }
    return value.details.currentBuild === 'target'
      && (isExactStringList(value.allowedActions, [])
        || isExactStringList(value.allowedActions, ['continue-as-target']));
  }

  if (!isExactStringList(value.allowedActions, []) || !hasOnlyKeys(value.context, [])) {
    return false;
  }

  if (value.code === 'permission') {
    return (
      isExactStringList(value.affectedCapabilities, ['workspace.write']) &&
      hasOnlyKeys(value.details, ['reason']) &&
      value.details.reason === 'read-only'
    );
  }

  if (value.code === 'incompatible-version') {
    return (
      isExactStringList(value.affectedCapabilities, ['workspace.read', 'workspace.write']) &&
      hasOnlyKeys(value.details, ['actualSchemaLevel', 'requiredSchemaLevel']) &&
      typeof value.details.actualSchemaLevel === 'number' &&
      Number.isSafeInteger(value.details.actualSchemaLevel) &&
      value.details.actualSchemaLevel !== 16 &&
      value.details.actualSchemaLevel >= 1 &&
      value.details.requiredSchemaLevel === 16
    );
  }

  if (value.code === 'integrity') {
    return (
      isExactStringList(value.affectedCapabilities, ['workspace.read', 'workspace.write']) &&
      hasOnlyKeys(value.details, ['reason']) &&
      (value.details.reason === 'wrong-application-id' ||
        value.details.reason === 'nonempty-level-zero' ||
        value.details.reason === 'schema-mismatch' ||
        value.details.reason === 'database-corrupt')
    );
  }

  if (value.code === 'migration-safety-unavailable') {
    return isExactStringList(value.affectedCapabilities, ['workspace.read', 'workspace.write'])
      && hasOnlyKeys(value.details, ['reason'])
      && value.details.reason === 'build-binding-missing';
  }

  return (
    value.code === 'recovery-required' &&
    isExactStringList(value.affectedCapabilities, ['workspace.read', 'workspace.write']) &&
    hasOnlyKeys(value.details, ['reason']) &&
    (value.details.reason === 'database-unreadable'
      || value.details.reason === 'migration-rollback-evidence')
  );
}

function isWorkspaceDataStatus(value: unknown): value is WorkspaceDataStatus {
  if (!isPlainObject(value) || typeof value.kind !== 'string') {
    return false;
  }

  if (value.kind === 'absent') {
    return hasOnlyKeys(value, ['kind']);
  }

  if (value.kind === 'recovery') {
    return hasOnlyKeys(value, ['kind', 'problem']) && isDataOpenProblem(value.problem);
  }

  const statusKeys = value.kind === 'read-only'
    ? ['kind', 'workspaceId', 'schemaLevel', 'revision', 'problem']
    : ['kind', 'workspaceId', 'schemaLevel', 'revision'];
  return (
    (value.kind === 'ready' || value.kind === 'read-only') &&
    hasOnlyKeys(value, statusKeys) &&
    isCanonicalUuid(value.workspaceId) &&
    value.schemaLevel === 16 &&
    isCanonicalUnsignedSqliteInteger(value.revision) &&
    (value.kind === 'ready' || isDataOpenProblem(value.problem))
  );
}

function lifecycleMatchesWorkspaceData(
  workspaceData: WorkspaceDataStatus,
  lifecycle: WorkspaceLifecycleProjection,
): boolean {
  if (workspaceData.kind === 'absent') {
    return lifecycle.route === 'welcome'
      && lifecycle.workspaceRevision === null
      && (lifecycle.mode === 'ready' || lifecycle.mode === 'limited');
  }
  if (workspaceData.kind === 'recovery') {
    return lifecycle.workspaceRevision === null
      && (lifecycle.mode === 'maintenance' || lifecycle.mode === 'recovery');
  }
  if (lifecycle.workspaceRevision !== workspaceData.revision) {
    return false;
  }
  return workspaceData.kind === 'read-only'
    ? lifecycle.mode === 'read-only'
      || lifecycle.mode === 'maintenance'
      || lifecycle.mode === 'recovery'
    : lifecycle.mode !== 'read-only';
}

export function makeBootstrapRequest(requestId: string, appBuildId: string): BootstrapRequest {
  return {
    kind: 'bootstrap.status',
    protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
    appBuildId,
    requestId,
  };
}

export function makeBootstrapProblem(
  code: BootstrapProblemCode,
  message: string,
  appBuildId: string,
  requestId: string | null,
): BootstrapOutcome {
  return {
    ok: false,
    problem: { code, message, requestId, appBuildId },
  };
}

export function isBootstrapRequest(value: unknown, expectedBuildId: string): value is BootstrapRequest {
  return (
    isPlainObject(value) &&
    hasOnlyKeys(value, requestKeys) &&
    value.kind === 'bootstrap.status' &&
    value.protocolVersion === BOOTSTRAP_PROTOCOL_VERSION &&
    value.appBuildId === expectedBuildId &&
    isNonEmptyString(value.appBuildId) &&
    isNonEmptyString(value.requestId)
  );
}

export function isWorkspaceProbeRequest(value: unknown, expectedBuildId: string): value is WorkspaceProbeRequest {
  return (
    isPlainObject(value) &&
    hasOnlyKeys(value, probeRequestKeys) &&
    value.kind === 'bootstrap.status' &&
    value.protocolVersion === BOOTSTRAP_PROTOCOL_VERSION &&
    value.appBuildId === expectedBuildId &&
    isNonEmptyString(value.appBuildId) &&
    isNonEmptyString(value.requestId) &&
    value.dataRootClass === 'verified-local'
  );
}

export function isBootstrapOutcome(
  value: unknown,
  expectedBuildId: string,
  expectedRequestId: string,
): value is BootstrapOutcome {
  if (!isPlainObject(value)) {
    return false;
  }

  if (value.ok === true) {
    const ready = value.value;
    return (
      hasOnlyKeys(value, ['ok', 'value']) &&
      isPlainObject(ready) &&
      hasOnlyKeys(ready, readyKeys) &&
      ready.protocolVersion === BOOTSTRAP_PROTOCOL_VERSION &&
      ready.appBuildId === expectedBuildId &&
      isNonEmptyString(ready.appBuildId) &&
      ready.requestId === expectedRequestId &&
      isNonEmptyString(ready.requestId) &&
      ready.workspaceProcess === 'ready' &&
      isNonEmptyString(ready.sqliteVersion) &&
      isSupportedSqliteVersion(ready.sqliteVersion) &&
      ready.dataRootClass === 'verified-local' &&
      isCanonicalUuid(ready.workspaceEpoch) &&
      isWorkspaceDataStatus(ready.workspaceData) &&
      isWorkspaceLifecycleProjection(ready.workspaceLifecycle) &&
      lifecycleMatchesWorkspaceData(ready.workspaceData, ready.workspaceLifecycle)
    );
  }

  if (value.ok === false) {
    const problem = value.problem;
    return (
      hasOnlyKeys(value, ['ok', 'problem']) &&
      isPlainObject(problem) &&
      hasOnlyKeys(problem, problemKeys) &&
      isBootstrapProblemCode(problem.code) &&
      isNonEmptyString(problem.message) &&
      problem.requestId === expectedRequestId &&
      problem.appBuildId === expectedBuildId &&
      isNonEmptyString(problem.appBuildId)
    );
  }

  return false;
}
