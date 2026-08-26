/**
 * @file Runs the single Workspace utility process and its bounded request transport.
 */

import { makeBootstrapProblem } from './shared/bootstrap-contract';
import type { WorkspaceSetupOutcome } from './shared/workspace-setup-contract';
import { WorkspaceApplication } from './workspace-application';

const parentPort = process.parentPort;

if (!parentPort) {
  throw new Error('CourseFlow Workspace utility process requires process.parentPort.');
}

const workspaceRoots = workspaceRootsFrom(process.argv);
const applicationPromise = workspaceRoots
  ? WorkspaceApplication.open(workspaceRoots.dataSlotsRoot, __COURSEFLOW_APP_BUILD_ID__, {
      activityControlRoot: workspaceRoots.activityControlRoot,
    }).catch(() => undefined)
  : Promise.resolve(undefined);
const inFlight = new Set<Promise<void>>();
let acceptsRequests = true;
let lifecycleClosePromise: Promise<void> | undefined;

process.on('exit', () => {
  void applicationPromise.then((application) => application?.close()).catch(() => {});
});

parentPort.on('message', (event) => {
  const request = event.data;

  if (isLifecycleCloseRequest(request)) {
    acceptsRequests = false;
    lifecycleClosePromise ??= closeWorkspace();
    void lifecycleClosePromise.then(() => {
      parentPort.postMessage({ kind: 'workspace.lifecycle.closed' });
    }).catch(() => {});
    return;
  }

  const operation = handleRequest(request);
  inFlight.add(operation);
  void operation.finally(() => inFlight.delete(operation));
});

async function handleRequest(request: unknown): Promise<void> {
  if (!acceptsRequests) {
    parentPort.postMessage(unavailableOutcome(request));
    return;
  }

  const application = await applicationPromise;
  if (!application) {
    parentPort.postMessage(unavailableOutcome(request));
    return;
  }

  parentPort.postMessage(await application.handle(request));
}

function unavailableOutcome(request: unknown) {
  const requestId = requestIdFrom(request);
  if (requestKindFrom(request) === 'bootstrap.status') {
    return makeBootstrapProblem(
      isBuildMismatch(request) ? 'build-mismatch' : 'workspace-unavailable',
      'Workspace is unavailable. Please try again.',
      __COURSEFLOW_APP_BUILD_ID__,
      requestId,
    );
  }

  const outcome: WorkspaceSetupOutcome = {
    ok: false,
    problem: {
      code: isBuildMismatch(request) ? 'build-mismatch' : 'workspace-unavailable',
      message: 'Workspace is unavailable. Please try again.',
      requestId,
      appBuildId: __COURSEFLOW_APP_BUILD_ID__,
      workspaceEpoch: workspaceEpochFrom(request),
      dataEffect: 'unchanged',
    },
  };
  return outcome;
}

function requestIdFrom(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const requestId = (value as { requestId?: unknown }).requestId;
  return typeof requestId === 'string' ? requestId : null;
}

function requestKindFrom(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  return (value as { kind?: unknown }).kind;
}

function workspaceEpochFrom(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return '';
  }
  const workspaceEpoch = (value as { workspaceEpoch?: unknown }).workspaceEpoch;
  return typeof workspaceEpoch === 'string' ? workspaceEpoch : '';
}

function isBuildMismatch(value: unknown): boolean {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && typeof (value as { appBuildId?: unknown }).appBuildId === 'string'
    && (value as { appBuildId: string }).appBuildId !== __COURSEFLOW_APP_BUILD_ID__;
}

function isLifecycleCloseRequest(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length === 1
    && descriptors.kind !== undefined
    && 'value' in descriptors.kind
    && descriptors.kind.enumerable === true
    && descriptors.kind.value === 'workspace.lifecycle.close';
}

async function closeWorkspace(): Promise<void> {
  await Promise.allSettled([...inFlight]);
  const application = await applicationPromise;
  await application?.close();
}

function workspaceRootsFrom(argv: readonly string[]): Readonly<{
  dataSlotsRoot: string;
  activityControlRoot: string;
}> | undefined {
  const dataMarker = '--courseflow-data-slots-root';
  const activityMarker = '--courseflow-activity-control-root';
  const dataIndex = argv.indexOf(dataMarker);
  const activityIndex = argv.indexOf(activityMarker);
  if (dataIndex !== argv.length - 4
    || activityIndex !== argv.length - 2
    || argv.lastIndexOf(dataMarker) !== dataIndex
    || argv.lastIndexOf(activityMarker) !== activityIndex) {
    return undefined;
  }

  const dataSlotsRoot = argv[dataIndex + 1];
  const activityControlRoot = argv[activityIndex + 1];
  return typeof dataSlotsRoot === 'string'
    && dataSlotsRoot.length > 0
    && typeof activityControlRoot === 'string'
    && activityControlRoot.length > 0
    ? {dataSlotsRoot, activityControlRoot}
    : undefined;
}
