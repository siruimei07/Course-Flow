/**
 * @file Exposes the bounded CourseFlow Workspace Interface to the Renderer.
 */

import { contextBridge, ipcRenderer } from 'electron';
import {
  isBootstrapOutcome,
  makeBootstrapProblem,
  makeBootstrapRequest,
  WORKSPACE_QUERY_CHANNEL,
  type BootstrapOutcome,
} from './shared/bootstrap-contract';
import {
  isWorkspaceSetupOutcome,
  makeCreateCourseWithMeetingRequest,
  makeCreateTermRequest,
  makeInitializeWorkspaceRequest,
  makeRestoreTermAsCurrentRequest,
  makeSetupQueryRequest,
  makeUpdateTermEndDateRequest,
  WORKSPACE_SETUP_CHANNEL,
  type RestoreTermAsCurrentRequestCommand,
  type WorkspaceSetupOutcome,
  type WorkspaceSetupRequest,
} from './shared/workspace-setup-contract';
import type {
  CreateTermCommand,
  UpdateTermEndDateCommand,
} from './shared/workspace-term-contract';
import type {
  AcceptedCreateCourseWithMeetingCommand,
} from './shared/workspace-course-contract';

let workspaceEpoch: string | undefined;

async function queryWorkspaceStatus(): Promise<BootstrapOutcome> {
  const request = makeBootstrapRequest(globalThis.crypto.randomUUID(), __COURSEFLOW_APP_BUILD_ID__);

  try {
    const outcome = await ipcRenderer.invoke(WORKSPACE_QUERY_CHANNEL, request);
    if (isBootstrapOutcome(outcome, __COURSEFLOW_APP_BUILD_ID__, request.requestId)) {
      workspaceEpoch = outcome.ok ? outcome.value.workspaceEpoch : undefined;
      return outcome;
    }
    workspaceEpoch = undefined;
    return makeBootstrapProblem(
          'workspace-unavailable',
          'Workspace is unavailable. Please try again.',
          __COURSEFLOW_APP_BUILD_ID__,
          request.requestId,
        );
  } catch {
    workspaceEpoch = undefined;
    return makeBootstrapProblem(
      'workspace-unavailable',
      'Workspace is unavailable. Please try again.',
      __COURSEFLOW_APP_BUILD_ID__,
      request.requestId,
    );
  }
}

async function invokeSetup(
  makeRequest: (requestId: string, workspaceEpoch: string) => WorkspaceSetupRequest,
): Promise<WorkspaceSetupOutcome> {
  const requestId = globalThis.crypto.randomUUID();
  const epoch = workspaceEpoch ?? '';
  if (!workspaceEpoch) {
    return unavailableSetupOutcome(requestId, epoch);
  }

  try {
    const request = makeRequest(requestId, workspaceEpoch);
    const outcome = await ipcRenderer.invoke(WORKSPACE_SETUP_CHANNEL, request);
    return isWorkspaceSetupOutcome(outcome, __COURSEFLOW_APP_BUILD_ID__, requestId, workspaceEpoch)
      ? outcome
      : unavailableSetupOutcome(requestId, workspaceEpoch);
  } catch {
    return unavailableSetupOutcome(requestId, workspaceEpoch);
  }
}

function unavailableSetupOutcome(requestId: string, epoch: string): WorkspaceSetupOutcome {
  return {
    ok: false,
    problem: {
      code: 'workspace-unavailable',
      message: 'Workspace is unavailable. Please try again.',
      requestId,
      appBuildId: __COURSEFLOW_APP_BUILD_ID__,
      workspaceEpoch: epoch,
      dataEffect: 'unchanged',
    },
  };
}

function initializeWorkspace(): Promise<WorkspaceSetupOutcome> {
  return invokeSetup((requestId, epoch) => (
    makeInitializeWorkspaceRequest(requestId, __COURSEFLOW_APP_BUILD_ID__, epoch)
  ));
}

function querySetup(): Promise<WorkspaceSetupOutcome> {
  return invokeSetup((requestId, epoch) => (
    makeSetupQueryRequest(requestId, __COURSEFLOW_APP_BUILD_ID__, epoch)
  ));
}

function createTerm(command: CreateTermCommand): Promise<WorkspaceSetupOutcome> {
  return invokeSetup((requestId, epoch) => (
    makeCreateTermRequest(requestId, __COURSEFLOW_APP_BUILD_ID__, epoch, command)
  ));
}

function updateTermEndDate(command: UpdateTermEndDateCommand): Promise<WorkspaceSetupOutcome> {
  return invokeSetup((requestId, epoch) => (
    makeUpdateTermEndDateRequest(requestId, __COURSEFLOW_APP_BUILD_ID__, epoch, command)
  ));
}

function restoreTermAsCurrent(
  command: RestoreTermAsCurrentRequestCommand,
): Promise<WorkspaceSetupOutcome> {
  return invokeSetup((requestId, epoch) => (
    makeRestoreTermAsCurrentRequest(requestId, __COURSEFLOW_APP_BUILD_ID__, epoch, command)
  ));
}

function createCourseWithMeeting(
  command: AcceptedCreateCourseWithMeetingCommand,
): Promise<WorkspaceSetupOutcome> {
  return invokeSetup((requestId, epoch) => (
    makeCreateCourseWithMeetingRequest(
      requestId,
      __COURSEFLOW_APP_BUILD_ID__,
      epoch,
      command,
    )
  ));
}

contextBridge.exposeInMainWorld(
  'courseFlow',
  Object.freeze({
    query: queryWorkspaceStatus,
    initialize: initializeWorkspace,
    querySetup,
    createTerm,
    updateTermEndDate,
    restoreTermAsCurrent,
    createCourseWithMeeting,
  }),
);
