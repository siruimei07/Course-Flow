/**
 * @file Deterministic confirmation tokens binding occurrence previews to revisions.
 */

import { createHash } from 'node:crypto';
import { canonicalJson } from '../shared/canonical-json';
import type { MeetingOccurrenceImpactDraft, MeetingOccurrenceWindow } from '../shared/workspace-course-contract';
import type { TaskOccurrenceImpactDraft } from '../shared/workspace-task-contract';

/**
 * Binds a whole-rule confirmation to versions, exact intent, and preview window.
 * @param {string} revision - Workspace revision used by the preview.
 * @param {string} planEntityVersion - PLAN version used by the preview.
 * @param {string} meetingSeriesVersion - Meeting series version used by the preview.
 * @param {object} change - Exact future-change scope, series, anchor, and replacement facts.
 * @param {MeetingOccurrenceWindow} requestedWindow - Bounded preview window.
 * @return {string} Lowercase SHA-256 confirmation token.
 */
export function meetingOccurrenceConfirmationToken(
    revision: string,
    planEntityVersion: string,
    meetingSeriesVersion: string,
    change: Pick<
        MeetingOccurrenceImpactDraft,
        'scope' | 'meetingSeriesId' | 'originalLogicalAnchor' | 'replacement'
    >,
    requestedWindow: MeetingOccurrenceWindow,
): string {
    const encoded = canonicalJson({
        encoding: 'courseflow-meeting-impact-v1',
        revision,
        planEntityVersion,
        meetingSeriesVersion,
        scope: change.scope,
        meetingSeriesId: change.meetingSeriesId,
        originalLogicalAnchor: change.originalLogicalAnchor,
        replacement: change.replacement,
        requestedWindow,
    });
    return createHash('sha256').update(encoded, 'utf8').digest('hex');
}

/**
 * Binds a Task whole-rule confirmation to the exact versions, action, and preview window.
 * @param {string} revision - Workspace revision used by the preview.
 * @param {string} planEntityVersion - PLAN version used by the preview.
 * @param {string} taskSeriesVersion - Task series version used by the preview.
 * @param {TaskOccurrenceImpactDraft} draft - Exact normalized future change or deletion.
 * @return {string} Lowercase SHA-256 confirmation token.
 */
export function taskOccurrenceConfirmationToken(
    revision: string,
    planEntityVersion: string,
    taskSeriesVersion: string,
    draft: TaskOccurrenceImpactDraft,
): string {
    const encoded = canonicalJson({
        encoding: 'courseflow-task-impact-v1',
        revision,
        planEntityVersion,
        taskSeriesVersion,
        scope: draft.scope,
        taskSeriesId: draft.taskSeriesId,
        ...(draft.scope === 'whole-series'
            ? {}
            : { originalLogicalAnchor: draft.originalLogicalAnchor }),
        action: draft.action,
        ...(draft.action === 'change' ? { replacement: draft.replacement } : {}),
        requestedWindow: draft.requestedWindow,
    });
    return createHash('sha256').update(encoded, 'utf8').digest('hex');
}
