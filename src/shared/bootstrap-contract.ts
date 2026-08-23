import { isSupportedSqliteVersion } from './sqlite-version';

export const BOOTSTRAP_PROTOCOL_VERSION = 1 as const;
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

export type BootstrapReady = Readonly<{
  protocolVersion: typeof BOOTSTRAP_PROTOCOL_VERSION;
  appBuildId: string;
  requestId: string;
  workspaceProcess: 'ready';
  sqliteVersion: string;
  dataRootClass: 'verified-local';
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
const readyKeys = ['protocolVersion', 'appBuildId', 'requestId', 'workspaceProcess', 'sqliteVersion', 'dataRootClass'];
const problemKeys = ['code', 'message', 'requestId', 'appBuildId'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowedKeys.length && keys.every((key) => allowedKeys.includes(key));
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
      ready.dataRootClass === 'verified-local'
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
