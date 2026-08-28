/**
 * @file Non-blocking meeting overlap warnings computed from expanded occurrences.
 */

import { MAX_MEETING_OVERLAP_WARNINGS, deriveMeetingOccurrenceId } from '../shared/workspace-course-contract';
import type { MeetingOverlapWarning } from '../shared/workspace-course-contract';
import { findMeetingTimeOverlap } from '../shared/meeting-time';
import { expandConflictMeetingOccurrences } from './meeting-occurrences';
import type {
    ConflictMeetingObject,
    ConflictMeetingOccurrence,
    StoredConflictMeetingOverride,
    StoredConflictMeetingSegment,
    StoredHolidayRange,
} from './meeting-occurrences';

/**
 * Materializes user-facing overlap warnings for proposed and retained effective occurrences.
 * @param {string} commandId - Stable draft/decision identity.
 * @param {readonly ConflictMeetingOccurrence[]} proposed - Proposed effective occurrences.
 * @param {readonly ConflictMeetingOccurrence[]} existing - Retained stored occurrences.
 * @return {readonly MeetingOverlapWarning[]} Exact positive overlaps in deterministic order.
 */
export function meetingOverlapWarnings(
    commandId: string,
    proposed: readonly ConflictMeetingOccurrence[],
    existing: readonly ConflictMeetingOccurrence[],
): readonly MeetingOverlapWarning[] {
    const warnings: MeetingOverlapWarning[] = [];
    for (const proposedOccurrence of proposed) {
        if (warnings.length >= MAX_MEETING_OVERLAP_WARNINGS) {
            break;
        }
        for (const existingOccurrence of existing) {
            const overlap = findMeetingTimeOverlap(proposedOccurrence.time, existingOccurrence.time);
            if (overlap === null) {
                continue;
            }
            warnings.push(Object.freeze({
                code: 'meeting-time-overlap' as const,
                proposed: Object.freeze({
                    commandId,
                    courseId: proposedOccurrence.object.courseId,
                    courseCode: proposedOccurrence.object.courseCode,
                    meetingSeriesId: proposedOccurrence.object.meetingSeriesId,
                    meetingType: proposedOccurrence.meetingType,
                    occurrenceId: Object.freeze({
                        meetingSeriesId: proposedOccurrence.object.meetingSeriesId,
                        originalLogicalAnchor: proposedOccurrence.originalLogicalAnchor,
                    }),
                    startInstant: proposedOccurrence.time.startInstant,
                    endInstant: proposedOccurrence.time.endInstant,
                }),
                existing: Object.freeze({
                    courseId: existingOccurrence.object.courseId!,
                    courseCode: existingOccurrence.object.courseCode,
                    meetingSeriesId: existingOccurrence.object.meetingSeriesId!,
                    meetingType: existingOccurrence.meetingType,
                    occurrenceId: deriveMeetingOccurrenceId(
                        existingOccurrence.object.meetingSeriesId!,
                        existingOccurrence.originalLogicalAnchor,
                    ),
                    startInstant: existingOccurrence.time.startInstant,
                    endInstant: existingOccurrence.time.endInstant,
                }),
                overlap,
            }));
            if (warnings.length >= MAX_MEETING_OVERLAP_WARNINGS) {
                break;
            }
        }
    }
    return Object.freeze(warnings.sort((first, second) => (
        first.overlap.startInstant.localeCompare(second.overlap.startInstant)
        || first.proposed.occurrenceId.originalLogicalAnchor.localeCompare(
            second.proposed.occurrenceId.originalLogicalAnchor,
        )
        || first.existing.occurrenceId.meetingSeriesId.localeCompare(
            second.existing.occurrenceId.meetingSeriesId,
        )
    )));
}

/**
 * Returns an order-independent identity for one derived Meeting conflict pair.
 * @param {MeetingOverlapWarning} warning - Derived overlap warning.
 * @return {string} Stable pair identity independent of proposed/existing ordering.
 */
export function meetingOverlapWarningKey(warning: MeetingOverlapWarning): string {
    return [
        `${warning.proposed.occurrenceId.meetingSeriesId}:${warning.proposed.occurrenceId.originalLogicalAnchor}`,
        `${warning.existing.occurrenceId.meetingSeriesId}:${warning.existing.occurrenceId.originalLogicalAnchor}`,
    ].sort().join('|');
}

/**
 * Derives all pairwise warnings in one bounded effective schedule.
 * @param {string} commandId - Holiday mutation command identity used by warning DTOs.
 * @param {readonly ConflictMeetingOccurrence[]} occurrences - Effective scheduled occurrences.
 * @return {readonly MeetingOverlapWarning[]} Deterministically ordered positive overlaps.
 */
export function meetingScheduleOverlapWarnings(
    commandId: string,
    occurrences: readonly ConflictMeetingOccurrence[],
): readonly MeetingOverlapWarning[] {
    const warnings: MeetingOverlapWarning[] = [];
    for (let index = 0; index < occurrences.length; index += 1) {
        warnings.push(...meetingOverlapWarnings(
            commandId,
            [occurrences[index]!],
            occurrences.slice(index + 1),
        ));
    }
    return Object.freeze(warnings.sort((first, second) => (
        first.overlap.startInstant.localeCompare(second.overlap.startInstant)
        || meetingOverlapWarningKey(first).localeCompare(meetingOverlapWarningKey(second))
    )));
}
