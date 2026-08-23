import { randomUUID } from 'node:crypto';
import { openWorkspaceData, type SqliteDataStore } from './data/sqlite-data-store';
import {
  BOOTSTRAP_PROTOCOL_VERSION,
  isWorkspaceProbeRequest,
  makeBootstrapProblem,
  type BootstrapOutcome,
  type WorkspaceDataStatus,
} from './shared/bootstrap-contract';

const parentPort = process.parentPort;

if (!parentPort) {
  throw new Error('CourseFlow Workspace utility process requires process.parentPort.');
}

const workspaceEpoch = randomUUID();
const dataSlotsRoot = dataSlotsRootFrom(process.argv);
const workspaceState = dataSlotsRoot ? openWorkspaceState(dataSlotsRoot) : undefined;
let acceptsBootstrap = true;
let lifecycleClosePromise: Promise<void> | undefined;

process.on('exit', () => {
  try {
    void workspaceState?.store?.close();
  } catch {
    // The process is exiting; the DATA owner has no caller left to notify.
  }
});

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

  if (isLifecycleCloseRequest(request)) {
    acceptsBootstrap = false;
    if (!lifecycleClosePromise) {
      lifecycleClosePromise = closeWorkspace();
      void lifecycleClosePromise.then(() => {
        parentPort.postMessage({ kind: 'workspace.lifecycle.closed' });
      }).catch(() => {});
    }
    return;
  }

  if (!acceptsBootstrap || !isWorkspaceProbeRequest(request, __COURSEFLOW_APP_BUILD_ID__)) {
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

  parentPort.postMessage(bootstrapWorkspace(request));
});

function isLifecycleCloseRequest(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return (
    Reflect.ownKeys(descriptors).length === 1 &&
    descriptors.kind !== undefined &&
    'value' in descriptors.kind &&
    descriptors.kind.enumerable === true &&
    descriptors.kind.value === 'workspace.lifecycle.close'
  );
}

async function closeWorkspace(): Promise<void> {
  await workspaceState?.store?.close();
}

function dataSlotsRootFrom(argv: readonly string[]): string | undefined {
  const marker = '--courseflow-data-slots-root';
  const markerIndex = argv.indexOf(marker);
  if (markerIndex !== argv.length - 2 || argv.lastIndexOf(marker) !== markerIndex) {
    return undefined;
  }

  const value = argv[markerIndex + 1];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

type WorkspaceState = Readonly<{
  sqliteVersion: string;
  workspaceData: WorkspaceDataStatus;
  store?: SqliteDataStore;
}>;

function openWorkspaceState(dataSlotsRoot: string): WorkspaceState | undefined {
  try {
    const opened = openWorkspaceData(dataSlotsRoot);
    if (opened.kind === 'absent') {
      return { sqliteVersion: opened.sqliteVersion, workspaceData: { kind: 'absent' } };
    }

    if (opened.kind === 'recovery') {
      return {
        sqliteVersion: opened.sqliteVersion,
        workspaceData: { kind: 'recovery', problem: opened.problem },
      };
    }

    return {
      sqliteVersion: opened.sqliteVersion,
      workspaceData: opened.store.status(),
      store: opened.store,
    };
  } catch {
    return undefined;
  }
}

function bootstrapWorkspace(
  request: import('./shared/bootstrap-contract').WorkspaceProbeRequest,
): BootstrapOutcome {
  if (!workspaceState) {
    return makeBootstrapProblem(
      'workspace-unavailable',
      'Workspace is unavailable. Please try again.',
      __COURSEFLOW_APP_BUILD_ID__,
      request.requestId,
    );
  }

  return {
    ok: true,
    value: {
      protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
      appBuildId: __COURSEFLOW_APP_BUILD_ID__,
      requestId: request.requestId,
      workspaceProcess: 'ready',
      sqliteVersion: workspaceState.sqliteVersion,
      dataRootClass: request.dataRootClass,
      workspaceEpoch,
      workspaceData: workspaceState.workspaceData,
    },
  };
}
