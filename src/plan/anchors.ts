/**
 * @file Logical-anchor calculus for weekly meeting and task occurrence identity.
 */

import { MAX_MEETING_OCCURRENCE_WINDOW_DAYS } from '../shared/workspace-course-contract';
import type { MeetingOccurrenceWindow, MeetingWeekday } from '../shared/workspace-course-contract';
import { MEETING_WEEKDAY_NUMBERS, MILLISECONDS_PER_DAY, addClampedLocalDateDays, addLocalDateDays, localDateMilliseconds } from './local-date';
import type { StoredMeetingOverride, StoredMeetingSegment } from './meeting-occurrences';

/**
 * Splits one legal Term into non-overlapping bounded occurrence-query windows.
 * @param {string} startDate - Inclusive canonical Term start date.
 * @param {string} endDate - Inclusive canonical Term end date.
 * @return {readonly MeetingOccurrenceWindow[]} Stable windows covering the Term exactly once.
 */
export function planOccurrenceWindows(
    startDate: string,
    endDate: string,
): readonly MeetingOccurrenceWindow[] {
    const windows: MeetingOccurrenceWindow[] = [];
    let windowStart = startDate;
    while (windowStart <= endDate) {
        const maximumWindowEnd = addClampedLocalDateDays(
            windowStart,
            MAX_MEETING_OCCURRENCE_WINDOW_DAYS - 1,
        );
        const windowEnd = maximumWindowEnd < endDate ? maximumWindowEnd : endDate;
        windows.push(Object.freeze({ startDate: windowStart, endDate: windowEnd }));
        if (windowEnd === endDate) {
            break;
        }
        windowStart = addLocalDateDays(windowEnd, 1);
    }
    return Object.freeze(windows);
}

/**
 * Projects a stable weekly logical anchor onto an effective weekday.
 * @param {string} originalLogicalAnchor - Stable occurrence identity anchor.
 * @param {MeetingWeekday} weekday - Effective weekday after segment or override rules.
 * @return {string | null} Physical LocalDate, or null beyond the supported date domain.
 */
export function occurrenceDate(originalLogicalAnchor: string, weekday: MeetingWeekday): string | null {
    const anchorWeekday = new Date(localDateMilliseconds(originalLogicalAnchor)).getUTCDay();
    const milliseconds = localDateMilliseconds(originalLogicalAnchor)
        + (MEETING_WEEKDAY_NUMBERS[weekday] - anchorWeekday) * MILLISECONDS_PER_DAY;
    if (milliseconds < localDateMilliseconds('0000-01-01')
        || milliseconds > localDateMilliseconds('9999-12-31')) {
        return null;
    }
    return new Date(milliseconds).toISOString().slice(0, 10);
}

/**
 * Chooses the first representable weekly identity anchor for a new Meeting series.
 * @param {string} startDate - Resolved inclusive effective-range start.
 * @param {MeetingWeekday} weekday - Initial Meeting weekday.
 * @return {string} First matching anchor, using the previous match at the LocalDate ceiling.
 */
export function firstWeeklyLogicalAnchor(startDate: string, weekday: MeetingWeekday): string {
    const weekdayNumber = MEETING_WEEKDAY_NUMBERS[weekday];
    const startWeekday = new Date(localDateMilliseconds(startDate)).getUTCDay();
    const forwardDays = (weekdayNumber - startWeekday + 7) % 7;
    const forwardMilliseconds = localDateMilliseconds(startDate) + forwardDays * MILLISECONDS_PER_DAY;
    return forwardMilliseconds <= localDateMilliseconds('9999-12-31')
        ? new Date(forwardMilliseconds).toISOString().slice(0, 10)
        : addLocalDateDays(startDate, forwardDays - 7);
}

/**
 * Chooses the first weekly Task anchor on or after its inclusive start without crossing LocalDate max.
 * @param {string} startDate - Inclusive Task schedule start.
 * @param {MeetingWeekday} weekday - Required Task weekday.
 * @return {string | null} First matching LocalDate, or null when no representable match exists.
 */
export function firstTaskWeeklyAnchor(startDate: string, weekday: MeetingWeekday): string | null {
    const weekdayNumber = MEETING_WEEKDAY_NUMBERS[weekday];
    const startMilliseconds = localDateMilliseconds(startDate);
    const startWeekday = new Date(startMilliseconds).getUTCDay();
    const forwardDays = (weekdayNumber - startWeekday + 7) % 7;
    const forwardMilliseconds = startMilliseconds + forwardDays * MILLISECONDS_PER_DAY;
    return forwardMilliseconds > localDateMilliseconds('9999-12-31')
        ? null
        : new Date(forwardMilliseconds).toISOString().slice(0, 10);
}

/**
 * Chooses the final weekly Task anchor on or before its inclusive confirmed end.
 * @param {string} endDate - Inclusive confirmed Task schedule end.
 * @param {MeetingWeekday} weekday - Required Task weekday.
 * @return {string} Final matching LocalDate.
 */
export function lastTaskWeeklyAnchor(endDate: string, weekday: MeetingWeekday): string {
    const weekdayNumber = MEETING_WEEKDAY_NUMBERS[weekday];
    const endMilliseconds = localDateMilliseconds(endDate);
    const endWeekday = new Date(endMilliseconds).getUTCDay();
    const backwardDays = (endWeekday - weekdayNumber + 7) % 7;
    return addLocalDateDays(endDate, -backwardDays);
}

/**
 * Rejects an ordered segment sequence whose logical ranges overlap.
 * @param {readonly StoredMeetingSegment[]} segments - Segments ordered by logical start anchor.
 * @return {void}
 */
export function validateMeetingSegmentSequence(segments: readonly StoredMeetingSegment[]): void {
    let previousEndAnchor: string | null | undefined;
    for (const segment of segments) {
        if (previousEndAnchor !== undefined
            && (previousEndAnchor === null || segment.logical_start_anchor <= previousEndAnchor)) {
            throw new Error('Meeting series has overlapping logical segments');
        }
        previousEndAnchor = segment.logical_end_anchor;
    }
}

/**
 * Tests logical range membership and the segment's seven-day cadence.
 * @param {StoredMeetingSegment} segment - Candidate owning segment.
 * @param {string} anchor - Stable logical occurrence anchor.
 * @return {boolean} Whether the anchor belongs to the segment's weekly sequence.
 */
export function logicalAnchorBelongsToSegment(segment: StoredMeetingSegment, anchor: string): boolean {
    return segment.logical_start_anchor <= anchor
        && (segment.logical_end_anchor === null || segment.logical_end_anchor >= anchor)
        && (localDateMilliseconds(anchor) - localDateMilliseconds(segment.logical_start_anchor))
            % (7 * MILLISECONDS_PER_DAY) === 0;
}

/**
 * Tests whether a logical anchor produces an occurrence inside the resolved effective range.
 * @param {StoredMeetingSegment} segment - Candidate owning segment.
 * @param {string} anchor - Stable logical occurrence anchor.
 * @param {MeetingWeekday} weekday - Effective weekday used for physical range membership.
 * @return {boolean} Whether the occurrence is currently active.
 */
export function isActiveLogicalAnchor(
    segment: StoredMeetingSegment,
    anchor: string,
    weekday: MeetingWeekday = segment.weekday,
): boolean {
    const date = occurrenceDate(anchor, weekday);
    return date !== null
        && logicalAnchorBelongsToSegment(segment, anchor)
        && segment.resolved_start_date <= date
        && segment.resolved_end_date >= date;
}

/**
 * Enumerates only weekly anchors that can project into a bounded physical window.
 * @param {StoredMeetingSegment} segment - Segment owning the weekly sequence.
 * @param {MeetingOccurrenceWindow} requestedWindow - Bounded physical query window.
 * @return {readonly string[]} Candidate anchors for final rule and override evaluation.
 */
export function candidateLogicalAnchors(
    segment: StoredMeetingSegment,
    requestedWindow: MeetingOccurrenceWindow,
): readonly string[] {
    const weekMilliseconds = 7 * MILLISECONDS_PER_DAY;
    const requestedStart = requestedWindow.startDate > segment.resolved_start_date
        ? requestedWindow.startDate
        : segment.resolved_start_date;
    const requestedEnd = requestedWindow.endDate < segment.resolved_end_date
        ? requestedWindow.endDate
        : segment.resolved_end_date;
    if (requestedEnd < requestedStart) {
        return Object.freeze([]);
    }
    const firstAnchorMilliseconds = localDateMilliseconds(segment.logical_start_anchor);
    const earliestAnchorMilliseconds = Math.max(
        localDateMilliseconds('0000-01-01'),
        localDateMilliseconds(requestedStart) - 6 * MILLISECONDS_PER_DAY,
    );
    const latestAnchorMilliseconds = Math.min(
        localDateMilliseconds('9999-12-31'),
        localDateMilliseconds(requestedEnd) + 6 * MILLISECONDS_PER_DAY,
    );
    const minimumIndex = Math.max(0, Math.ceil(
        (earliestAnchorMilliseconds - firstAnchorMilliseconds) / weekMilliseconds,
    ));
    let maximumIndex = Math.floor(
        (latestAnchorMilliseconds - firstAnchorMilliseconds) / weekMilliseconds,
    );
    if (segment.logical_end_anchor !== null) {
        maximumIndex = Math.min(maximumIndex, Math.floor(
            (localDateMilliseconds(segment.logical_end_anchor)
                - localDateMilliseconds(segment.logical_start_anchor)) / weekMilliseconds,
        ));
    }
    if (maximumIndex < minimumIndex) {
        return Object.freeze([]);
    }
    return Object.freeze(Array.from({ length: maximumIndex - minimumIndex + 1 }, (_, index) => (
        addLocalDateDays(segment.logical_start_anchor, (minimumIndex + index) * 7)
    )));
}

/**
 * Counts weekly anchors satisfying both logical-anchor and physical-date bounds.
 * @param {StoredMeetingSegment} segment - Segment owning the logical anchor sequence.
 * @param {MeetingWeekday} weekday - Weekday used to project each anchor to a physical date.
 * @param {number} minimumAnchor - Inclusive lower logical-anchor bound in UTC milliseconds.
 * @param {number} maximumAnchor - Inclusive upper logical-anchor bound in UTC milliseconds.
 * @param {number} minimumDate - Inclusive lower physical-date bound in UTC milliseconds.
 * @param {number} maximumDate - Inclusive upper physical-date bound in UTC milliseconds.
 * @return {number} Number of active anchors satisfying every bound.
 */
export function countActiveLogicalAnchors(
    segment: StoredMeetingSegment,
    weekday: MeetingWeekday,
    minimumAnchor: number,
    maximumAnchor: number,
    minimumDate: number,
    maximumDate: number,
): number {
    if (maximumAnchor < minimumAnchor || maximumDate < minimumDate) {
        return 0;
    }
    const weekMilliseconds = 7 * MILLISECONDS_PER_DAY;
    const firstAnchor = localDateMilliseconds(segment.logical_start_anchor);
    const firstAnchorWeekday = new Date(firstAnchor).getUTCDay();
    const firstDate = firstAnchor
        + (MEETING_WEEKDAY_NUMBERS[weekday] - firstAnchorWeekday) * MILLISECONDS_PER_DAY;
    const resolvedStart = localDateMilliseconds(segment.resolved_start_date);
    const resolvedEnd = localDateMilliseconds(segment.resolved_end_date);
    const localDateMaximum = localDateMilliseconds('9999-12-31');
    let minimumIndex = Math.max(
        0,
        Math.ceil((minimumAnchor - firstAnchor) / weekMilliseconds),
        Math.ceil((Math.max(minimumDate, resolvedStart) - firstDate) / weekMilliseconds),
    );
    let maximumIndex = Math.min(
        Math.floor((maximumAnchor - firstAnchor) / weekMilliseconds),
        Math.floor((Math.min(maximumDate, resolvedEnd) - firstDate) / weekMilliseconds),
        Math.floor((localDateMaximum - firstAnchor) / weekMilliseconds),
    );
    if (segment.logical_end_anchor !== null) {
        maximumIndex = Math.min(
            maximumIndex,
            Math.floor(
                (localDateMilliseconds(segment.logical_end_anchor) - firstAnchor) / weekMilliseconds,
            ),
        );
    }
    minimumIndex = Math.ceil(minimumIndex);
    maximumIndex = Math.floor(maximumIndex);
    return maximumIndex < minimumIndex ? 0 : maximumIndex - minimumIndex + 1;
}

/**
 * Detects whether a bounded preview omits an actual weekly occurrence in an anchor partition.
 * @param {readonly StoredMeetingSegment[]} segments - Ordered segments in the Meeting series.
 * @param {number} minimumAnchor - Inclusive lower logical-anchor bound in UTC milliseconds.
 * @param {number} maximumAnchor - Inclusive upper logical-anchor bound in UTC milliseconds.
 * @param {MeetingOccurrenceWindow} requestedWindow - Physical dates shown by the preview.
 * @param {MeetingWeekday | null} replacementWeekday - Proposed weekday, or null for stored rules.
 * @param {readonly StoredMeetingOverride[]} overrides - Boundary replacements that can cross the window.
 * @param {string | null} clearedOverrideAnchor - Override cleared by the proposed split, when any.
 * @return {boolean} Whether at least one matching occurrence falls outside the requested window.
 */
export function hasOccurrenceOutsideRequestedWindow(
    segments: readonly StoredMeetingSegment[],
    minimumAnchor: number,
    maximumAnchor: number,
    requestedWindow: MeetingOccurrenceWindow,
    replacementWeekday: MeetingWeekday | null,
    overrides: readonly StoredMeetingOverride[],
    clearedOverrideAnchor: string | null,
): boolean {
    const localDateMinimum = localDateMilliseconds('0000-01-01');
    const localDateMaximum = localDateMilliseconds('9999-12-31');
    const requestedStart = localDateMilliseconds(requestedWindow.startDate);
    const requestedEnd = localDateMilliseconds(requestedWindow.endDate);
    let outsideCount = segments.reduce((count, segment) => {
        const weekday = replacementWeekday ?? segment.weekday;
        const total = countActiveLogicalAnchors(
            segment,
            weekday,
            minimumAnchor,
            maximumAnchor,
            localDateMinimum,
            localDateMaximum,
        );
        const visible = countActiveLogicalAnchors(
            segment,
            weekday,
            minimumAnchor,
            maximumAnchor,
            requestedStart,
            requestedEnd,
        );
        return count + total - visible;
    }, 0);

    for (const override of overrides) {
        if (override.override_kind !== 'replaced'
            || override.original_logical_anchor === clearedOverrideAnchor) {
            continue;
        }
        const anchor = localDateMilliseconds(override.original_logical_anchor);
        if (anchor < minimumAnchor || anchor > maximumAnchor) {
            continue;
        }
        const matchingSegments = segments.filter(segment => (
            logicalAnchorBelongsToSegment(segment, override.original_logical_anchor)
        ));
        if (matchingSegments.length !== 1) {
            throw new Error('Meeting override does not target a logical occurrence');
        }
        const segment = matchingSegments[0]!;
        const baseWeekday = replacementWeekday ?? segment.weekday;
        if (!isActiveLogicalAnchor(segment, override.original_logical_anchor, baseWeekday)) {
            continue;
        }
        const baseDate = occurrenceDate(override.original_logical_anchor, baseWeekday);
        const replacedDate = occurrenceDate(override.original_logical_anchor, override.weekday!);
        if (baseDate === null || replacedDate === null) {
            throw new Error('Meeting override has an invalid physical date');
        }
        const baseOutside = baseDate < requestedWindow.startDate || baseDate > requestedWindow.endDate;
        const replacementOutside = replacedDate < requestedWindow.startDate
            || replacedDate > requestedWindow.endDate;
        outsideCount += Number(replacementOutside) - Number(baseOutside);
    }
    return outsideCount > 0;
}
