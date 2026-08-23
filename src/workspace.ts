import { DatabaseSync } from 'node:sqlite';
import { isSupportedSqliteVersion } from './shared/sqlite-version';
import {
  BOOTSTRAP_PROTOCOL_VERSION,
  isWorkspaceProbeRequest,
  makeBootstrapProblem,
  type BootstrapOutcome,
} from './shared/bootstrap-contract';

const parentPort = process.parentPort;

if (!parentPort) {
  throw new Error('CourseFlow Workspace utility process requires process.parentPort.');
}

function requestIdFrom(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const requestId = (value as { requestId?: unknown }).requestId;
  return typeof requestId === 'string' ? requestId : null;
}

function isBuildMismatch(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { appBuildId?: unknown }).appBuildId === 'string' &&
    (value as { appBuildId: string }).appBuildId !== __COURSEFLOW_APP_BUILD_ID__
  );
}

parentPort.on('message', (event) => {
  const request = event.data;

  if (!isWorkspaceProbeRequest(request, __COURSEFLOW_APP_BUILD_ID__)) {
    parentPort.postMessage(
      makeBootstrapProblem(
        isBuildMismatch(request) ? 'build-mismatch' : 'invalid-request',
        'Workspace request is unavailable.',
        __COURSEFLOW_APP_BUILD_ID__,
        requestIdFrom(request),
      ),
    );
    return;
  }

  parentPort.postMessage(probeWorkspace(request));
});

function probeWorkspace(request: import('./shared/bootstrap-contract').WorkspaceProbeRequest): BootstrapOutcome {
  let database: DatabaseSync | undefined;

  try {
    database = new DatabaseSync(':memory:');
    const row = database.prepare('SELECT sqlite_version() AS version').get() as { version?: unknown };
    if (typeof row.version !== 'string') {
      return makeBootstrapProblem(
        'workspace-unavailable',
        'Workspace is unavailable. Please try again.',
        __COURSEFLOW_APP_BUILD_ID__,
        request.requestId,
      );
    }

    if (!isSupportedSqliteVersion(row.version)) {
      return makeBootstrapProblem(
        'sqlite-unsupported',
        'The bundled SQLite runtime is unsupported.',
        __COURSEFLOW_APP_BUILD_ID__,
        request.requestId,
      );
    }

    const outcome: BootstrapOutcome = {
      ok: true,
      value: {
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId: __COURSEFLOW_APP_BUILD_ID__,
        requestId: request.requestId,
        workspaceProcess: 'ready',
        sqliteVersion: row.version,
        dataRootClass: request.dataRootClass,
      },
    };
    return outcome;
  } catch {
    return makeBootstrapProblem(
      'workspace-unavailable',
      'Workspace is unavailable. Please try again.',
      __COURSEFLOW_APP_BUILD_ID__,
      request.requestId,
    );
  } finally {
    database?.close();
  }
}
