/**
 * @file Computes canonical digests for durable Workspace command receipts.
 */

import { createHash } from 'node:crypto';

import { canonicalJson } from '../shared/canonical-json';
import {
    cancelMeetingOccurrenceDigestProjection,
    changeMeetingOccurrenceDigestProjection,
    createCourseDigestProjection,
    createCourseWithMeetingDigestProjection,
    createMeetingSeriesDigestProjection,
    type AcceptedChangeMeetingOccurrenceCommand,
    type AcceptedCreateCourseWithMeetingCommand,
    type CancelMeetingOccurrenceCommand,
    type CreateCourseCommand,
    type CreateMeetingSeriesCommand,
} from '../shared/workspace-course-contract';
import {
    recordSetupDecisionDigestProjection,
    type RecordSetupDecisionCommand,
} from '../shared/workspace-data-contract';
import {
    createHolidayRangeDigestProjection,
    deleteHolidayRangeDigestProjection,
    updateHolidayRangeDigestProjection,
    type CreateHolidayRangeCommand,
    type DeleteHolidayRangeCommand,
    type UpdateHolidayRangeCommand,
} from '../shared/workspace-holiday-contract';
import {
    createTermDigestProjection,
    reconcileWorkspaceLifecycleDigestProjection,
    restoreTermAsCurrentDigestProjection,
    updateTermEndDateDigestProjection,
    type CreateTermCommand,
    type ReconcileWorkspaceLifecycleCommand,
    type RestoreTermAsCurrentCommand,
    type UpdateTermEndDateCommand,
} from '../shared/workspace-term-contract';
import {
    changeTaskOccurrenceDigestProjection,
    completeTaskDigestProjection,
    createTaskDigestProjection,
    deleteTaskOccurrenceOrSeriesDigestProjection,
    deleteTaskDigestProjection,
    setTaskOccurrenceStatusDigestProjection,
    setTaskProgressDigestProjection,
    undoTaskOccurrenceStateDigestProjection,
    updateTaskDigestProjection,
    type ChangeTaskOccurrenceCommand,
    type CompleteTaskCommand,
    type CreateTaskCommand,
    type DeleteTaskOccurrenceOrSeriesCommand,
    type DeleteTaskCommand,
    type SetTaskOccurrenceStatusCommand,
    type SetTaskProgressCommand,
    type UndoTaskOccurrenceStateCommand,
    type UpdateTaskCommand,
} from '../shared/workspace-task-contract';

export function digestRecordSetupDecision(command: RecordSetupDecisionCommand): Uint8Array {
    const canonicalText = canonicalJson(recordSetupDecisionDigestProjection(command));
    return createHash('sha256').update(canonicalText, 'utf8').digest();
}

export function digestCreateTerm(command: CreateTermCommand): Uint8Array {
    const canonicalText = canonicalJson(createTermDigestProjection(command));
    return createHash('sha256').update(canonicalText, 'utf8').digest();
}

export function digestCreateCourseWithMeeting(command: AcceptedCreateCourseWithMeetingCommand): Uint8Array {
    const canonicalText = canonicalJson(createCourseWithMeetingDigestProjection(command));
    return createHash('sha256').update(canonicalText, 'utf8').digest();
}

/**
 * Hashes the canonical Course creation receipt payload.
 * @param {CreateCourseCommand} command - Normalized Course creation command.
 * @return {Uint8Array} SHA-256 digest bytes.
 */
export function digestCreateCourse(command: CreateCourseCommand): Uint8Array {
    return createHash('sha256').update(canonicalJson(createCourseDigestProjection(command)), 'utf8').digest();
}

/**
 * Hashes the canonical Meeting-series creation receipt payload.
 * @param {CreateMeetingSeriesCommand} command - Normalized Meeting-series creation command.
 * @return {Uint8Array} SHA-256 digest bytes.
 */
export function digestCreateMeetingSeries(command: CreateMeetingSeriesCommand): Uint8Array {
    return createHash('sha256').update(canonicalJson(createMeetingSeriesDigestProjection(command)), 'utf8').digest();
}

/**
 * Hashes the canonical scoped Meeting occurrence change receipt payload.
 * @param {AcceptedChangeMeetingOccurrenceCommand} command - Accepted occurrence change command.
 * @return {Uint8Array} SHA-256 digest bytes.
 */
export function digestChangeMeetingOccurrence(
    command: AcceptedChangeMeetingOccurrenceCommand,
): Uint8Array {
    const canonicalText = canonicalJson(changeMeetingOccurrenceDigestProjection(command));
    return createHash('sha256').update(canonicalText, 'utf8').digest();
}

/**
 * Hashes the canonical only-this Meeting cancellation receipt payload.
 * @param {CancelMeetingOccurrenceCommand} command - Normalized occurrence cancellation command.
 * @return {Uint8Array} SHA-256 digest bytes.
 */
export function digestCancelMeetingOccurrence(command: CancelMeetingOccurrenceCommand): Uint8Array {
    const canonicalText = canonicalJson(cancelMeetingOccurrenceDigestProjection(command));
    return createHash('sha256').update(canonicalText, 'utf8').digest();
}

export function digestReconcileWorkspaceLifecycle(command: ReconcileWorkspaceLifecycleCommand): Uint8Array {
    const canonicalText = canonicalJson(reconcileWorkspaceLifecycleDigestProjection(command));
    return createHash('sha256').update(canonicalText, 'utf8').digest();
}

export function digestUpdateTermEndDate(command: UpdateTermEndDateCommand): Uint8Array {
    const canonicalText = canonicalJson(updateTermEndDateDigestProjection(command));
    return createHash('sha256').update(canonicalText, 'utf8').digest();
}

export function digestRestoreTermAsCurrent(command: RestoreTermAsCurrentCommand): Uint8Array {
    const canonicalText = canonicalJson(restoreTermAsCurrentDigestProjection(command));
    return createHash('sha256').update(canonicalText, 'utf8').digest();
}

/**
 * Hashes the canonical HolidayRange creation receipt payload.
 * @param {CreateHolidayRangeCommand} command - Normalized HolidayRange creation command.
 * @return {Uint8Array} SHA-256 digest bytes.
 */
export function digestCreateHolidayRange(command: CreateHolidayRangeCommand): Uint8Array {
    const canonicalText = canonicalJson(createHolidayRangeDigestProjection(command));
    return createHash('sha256').update(canonicalText, 'utf8').digest();
}

/**
 * Hashes the canonical HolidayRange update receipt payload.
 * @param {UpdateHolidayRangeCommand} command - Normalized HolidayRange update command.
 * @return {Uint8Array} SHA-256 digest bytes.
 */
export function digestUpdateHolidayRange(command: UpdateHolidayRangeCommand): Uint8Array {
    const canonicalText = canonicalJson(updateHolidayRangeDigestProjection(command));
    return createHash('sha256').update(canonicalText, 'utf8').digest();
}

/**
 * Hashes the canonical HolidayRange deletion receipt payload.
 * @param {DeleteHolidayRangeCommand} command - Normalized HolidayRange deletion command.
 * @return {Uint8Array} SHA-256 digest bytes.
 */
export function digestDeleteHolidayRange(command: DeleteHolidayRangeCommand): Uint8Array {
    const canonicalText = canonicalJson(deleteHolidayRangeDigestProjection(command));
    return createHash('sha256').update(canonicalText, 'utf8').digest();
}

export function digestCreateTask(command: CreateTaskCommand): Uint8Array {
    const canonicalText = canonicalJson(createTaskDigestProjection(command));
    return createHash('sha256').update(canonicalText, 'utf8').digest();
}

export function digestUpdateTask(command: UpdateTaskCommand): Uint8Array {
    const canonicalText = canonicalJson(updateTaskDigestProjection(command));
    return createHash('sha256').update(canonicalText, 'utf8').digest();
}

export function digestDeleteTask(command: DeleteTaskCommand): Uint8Array {
    const canonicalText = canonicalJson(deleteTaskDigestProjection(command));
    return createHash('sha256').update(canonicalText, 'utf8').digest();
}

export function digestCompleteTask(command: CompleteTaskCommand): Uint8Array {
    const canonicalText = canonicalJson(completeTaskDigestProjection(command));
    return createHash('sha256').update(canonicalText, 'utf8').digest();
}

export function digestSetTaskOccurrenceStatus(command: SetTaskOccurrenceStatusCommand): Uint8Array {
    const canonicalText = canonicalJson(setTaskOccurrenceStatusDigestProjection(command));
    return createHash('sha256').update(canonicalText, 'utf8').digest();
}

export function digestSetTaskProgress(command: SetTaskProgressCommand): Uint8Array {
    const canonicalText = canonicalJson(setTaskProgressDigestProjection(command));
    return createHash('sha256').update(canonicalText, 'utf8').digest();
}

export function digestChangeTaskOccurrence(command: ChangeTaskOccurrenceCommand): Uint8Array {
    const canonicalText = canonicalJson(changeTaskOccurrenceDigestProjection(command));
    return createHash('sha256').update(canonicalText, 'utf8').digest();
}

export function digestDeleteTaskOccurrenceOrSeries(
    command: DeleteTaskOccurrenceOrSeriesCommand,
): Uint8Array {
    const canonicalText = canonicalJson(deleteTaskOccurrenceOrSeriesDigestProjection(command));
    return createHash('sha256').update(canonicalText, 'utf8').digest();
}

export function digestUndoTaskOccurrenceState(command: UndoTaskOccurrenceStateCommand): Uint8Array {
    const canonicalText = canonicalJson(undoTaskOccurrenceStateDigestProjection(command));
    return createHash('sha256').update(canonicalText, 'utf8').digest();
}
