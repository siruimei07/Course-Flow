import { contextBridge, ipcRenderer } from 'electron';
import {
  isBootstrapOutcome,
  makeBootstrapProblem,
  makeBootstrapRequest,
  WORKSPACE_QUERY_CHANNEL,
  type BootstrapOutcome,
} from './shared/bootstrap-contract';

async function queryWorkspaceStatus(): Promise<BootstrapOutcome> {
  const request = makeBootstrapRequest(globalThis.crypto.randomUUID(), __COURSEFLOW_APP_BUILD_ID__);

  try {
    const outcome = await ipcRenderer.invoke(WORKSPACE_QUERY_CHANNEL, request);
    return isBootstrapOutcome(outcome, __COURSEFLOW_APP_BUILD_ID__, request.requestId)
      ? outcome
      : makeBootstrapProblem(
          'workspace-unavailable',
          'Workspace is unavailable. Please try again.',
          __COURSEFLOW_APP_BUILD_ID__,
          request.requestId,
        );
  } catch {
    return makeBootstrapProblem(
      'workspace-unavailable',
      'Workspace is unavailable. Please try again.',
      __COURSEFLOW_APP_BUILD_ID__,
      request.requestId,
    );
  }
}

contextBridge.exposeInMainWorld(
  'courseFlow',
  Object.freeze({
    query: queryWorkspaceStatus,
  }),
);
