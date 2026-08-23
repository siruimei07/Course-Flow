/**
 * @file Defines the versioned Workspace bootstrap contract and validators.
 */

import { isSupportedSqliteVersion } from './sqlite-version';
import { isCanonicalUnsignedSqliteInteger, isCanonicalUuid } from './workspace-data-contract';

export const BOOTSTRAP_PROTOCOL_VERSION = 2 as const;
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
      details: Readonly<{ actualSchemaLevel: number; requiredSchemaLevel: 4 }>;
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
    }>;

export type WorkspaceDataStatus =
  | Readonly<{ kind: 'absent' }>
  | Readonly<{
      kind: 'ready';
      workspaceId: string;
      schemaLevel: 4;
      revision: string;
    }>
  | Readonly<{
      kind: 'read-only';
      workspaceId: string;
      schemaLevel: 4;
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
    !isExactStringList(value.allowedActions, []) ||
    !isPlainObject(value.context) ||
    !hasOnlyKeys(value.context, []) ||
    !isPlainObject(value.details)
  ) {
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
      value.details.actualSchemaLevel !== 4 &&
      value.details.actualSchemaLevel >= 1 &&
      value.details.requiredSchemaLevel === 4
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

  return (
    value.code === 'recovery-required' &&
    isExactStringList(value.affectedCapabilities, ['workspace.read', 'workspace.write']) &&
    hasOnlyKeys(value.details, ['reason']) &&
    value.details.reason === 'database-unreadable'
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
    value.schemaLevel === 4 &&
    isCanonicalUnsignedSqliteInteger(value.revision) &&
    (value.kind === 'ready' || isDataOpenProblem(value.problem))
  );
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
      isWorkspaceDataStatus(ready.workspaceData)
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
