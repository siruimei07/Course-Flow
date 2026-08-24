/**
 * @file Computes canonical digests for durable Workspace command receipts.
 */

import { createHash } from 'node:crypto';

import { canonicalJson } from '../shared/canonical-json';
import {
    cancelMeetingOccurrenceDigestProjection,
    changeMeetingOccurrenceDigestProjection,
    createCourseWithMeetingDigestProjection,
    type AcceptedCreateCourseWithMeetingCommand,
    type CancelMeetingOccurrenceCommand,
    type ChangeMeetingOccurrenceCommand,
} from '../shared/workspace-course-contract';
import {
    recordSetupDecisionDigestProjection,
    type RecordSetupDecisionCommand,
} from '../shared/workspace-data-contract';
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
 * @param {ChangeMeetingOccurrenceCommand} command - Normalized occurrence change command.
 * @return {Uint8Array} SHA-256 digest bytes.
 */
export function digestChangeMeetingOccurrence(command: ChangeMeetingOccurrenceCommand): Uint8Array {
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
