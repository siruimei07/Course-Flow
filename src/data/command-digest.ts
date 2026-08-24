/**
 * @file Computes canonical digests for durable Workspace command receipts.
 */

import { createHash } from 'node:crypto';

import { canonicalJson } from '../shared/canonical-json';
import {
    cancelMeetingOccurrenceDigestProjection,
    changeMeetingOccurrenceDigestProjection,
    createCourseWithMeetingDigestProjection,
    type AcceptedChangeMeetingOccurrenceCommand,
    type AcceptedCreateCourseWithMeetingCommand,
    type CancelMeetingOccurrenceCommand,
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
    completeTaskDigestProjection,
    createTaskDigestProjection,
    deleteTaskDigestProjection,
    updateTaskDigestProjection,
    type CompleteTaskCommand,
    type CreateTaskCommand,
    type DeleteTaskCommand,
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
