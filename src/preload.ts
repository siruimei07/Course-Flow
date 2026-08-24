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
  makeCreateHolidayRangeRequest,
  makeCreateTermRequest,
  makeCancelMeetingOccurrenceRequest,
  makeChangeMeetingOccurrenceRequest,
  makeInitializeWorkspaceRequest,
  makeMeetingOccurrenceImpactRequest,
  makeMeetingSeriesQueryRequest,
  makeRestoreTermAsCurrentRequest,
  makeDeleteHolidayRangeRequest,
  makeSetupQueryRequest,
  makeUpdateTermEndDateRequest,
  makeUpdateHolidayRangeRequest,
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
  CreateHolidayRangeCommand,
  DeleteHolidayRangeCommand,
  UpdateHolidayRangeCommand,
} from './shared/workspace-holiday-contract';
import type {
  AcceptedCreateCourseWithMeetingCommand,
  CancelMeetingOccurrenceCommand,
  ChangeMeetingOccurrenceCommand,
  MeetingOccurrenceImpactDraft,
  MeetingOccurrenceWindow,
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

/**
 * Sends one normalized HolidayRange creation through the bounded Workspace channel.
 * @param {CreateHolidayRangeCommand} command - HolidayRange creation command.
 * @return {Promise<WorkspaceSetupOutcome>} Validated Workspace outcome.
 */
function createHolidayRange(command: CreateHolidayRangeCommand): Promise<WorkspaceSetupOutcome> {
  return invokeSetup((requestId, epoch) => (
    makeCreateHolidayRangeRequest(requestId, __COURSEFLOW_APP_BUILD_ID__, epoch, command)
  ));
}

/**
 * Sends one normalized HolidayRange update through the bounded Workspace channel.
 * @param {UpdateHolidayRangeCommand} command - HolidayRange update command.
 * @return {Promise<WorkspaceSetupOutcome>} Validated Workspace outcome.
 */
function updateHolidayRange(command: UpdateHolidayRangeCommand): Promise<WorkspaceSetupOutcome> {
  return invokeSetup((requestId, epoch) => (
    makeUpdateHolidayRangeRequest(requestId, __COURSEFLOW_APP_BUILD_ID__, epoch, command)
  ));
}

/**
 * Sends one normalized HolidayRange deletion through the bounded Workspace channel.
 * @param {DeleteHolidayRangeCommand} command - HolidayRange deletion command.
 * @return {Promise<WorkspaceSetupOutcome>} Validated Workspace outcome.
 */
function deleteHolidayRange(command: DeleteHolidayRangeCommand): Promise<WorkspaceSetupOutcome> {
  return invokeSetup((requestId, epoch) => (
    makeDeleteHolidayRangeRequest(requestId, __COURSEFLOW_APP_BUILD_ID__, epoch, command)
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

/**
 * Queries one Meeting series through the bounded Workspace channel.
 * @param {string} meetingSeriesId - Stable Meeting series identity.
 * @param {MeetingOccurrenceWindow} requestedWindow - Physical-date expansion window.
 * @return {Promise<WorkspaceSetupOutcome>} Validated Workspace outcome.
 */
function queryMeetingSeries(
  meetingSeriesId: string,
  requestedWindow: MeetingOccurrenceWindow,
): Promise<WorkspaceSetupOutcome> {
  return invokeSetup((requestId, epoch) => (
    makeMeetingSeriesQueryRequest(
      requestId,
      __COURSEFLOW_APP_BUILD_ID__,
      epoch,
      meetingSeriesId,
      requestedWindow,
    )
  ));
}

/**
 * Requests a version-bound whole-rule impact preview.
 * @param {MeetingOccurrenceImpactDraft} draft - Exact proposed future rule.
 * @return {Promise<WorkspaceSetupOutcome>} Validated Workspace outcome.
 */
function previewMeetingOccurrence(
  draft: MeetingOccurrenceImpactDraft,
): Promise<WorkspaceSetupOutcome> {
  return invokeSetup((requestId, epoch) => (
    makeMeetingOccurrenceImpactRequest(requestId, __COURSEFLOW_APP_BUILD_ID__, epoch, draft)
  ));
}

/**
 * Submits an only-this override or confirmed future split.
 * @param {ChangeMeetingOccurrenceCommand} command - Versioned occurrence change command.
 * @return {Promise<WorkspaceSetupOutcome>} Validated Workspace outcome.
 */
function changeMeetingOccurrence(
  command: ChangeMeetingOccurrenceCommand,
): Promise<WorkspaceSetupOutcome> {
  return invokeSetup((requestId, epoch) => (
    makeChangeMeetingOccurrenceRequest(requestId, __COURSEFLOW_APP_BUILD_ID__, epoch, command)
  ));
}

/**
 * Submits an only-this Meeting cancellation.
 * @param {CancelMeetingOccurrenceCommand} command - Versioned occurrence cancellation command.
 * @return {Promise<WorkspaceSetupOutcome>} Validated Workspace outcome.
 */
function cancelMeetingOccurrence(
  command: CancelMeetingOccurrenceCommand,
): Promise<WorkspaceSetupOutcome> {
  return invokeSetup((requestId, epoch) => (
    makeCancelMeetingOccurrenceRequest(requestId, __COURSEFLOW_APP_BUILD_ID__, epoch, command)
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
    createHolidayRange,
    updateHolidayRange,
    deleteHolidayRange,
    restoreTermAsCurrent,
    createCourseWithMeeting,
    queryMeetingSeries,
    previewMeetingOccurrence,
    changeMeetingOccurrence,
    cancelMeetingOccurrence,
  }),
);
