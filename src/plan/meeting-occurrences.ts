/**
 * @file Deterministic meeting occurrence expansion over stored segments, overrides, and holidays.
 */

import type {
    MeetingEffectiveRangeIntent,
    MeetingLocation,
    MeetingOccurrenceWindow,
    MeetingTypeCode,
    MeetingWeekday,
} from '../shared/workspace-course-contract';
import type { MeetingEndDayOffset, MeetingInstantWindow } from '../shared/meeting-time';
import { resolveMeetingOccurrenceTime } from '../shared/meeting-time';
import { candidateLogicalAnchors, isActiveLogicalAnchor, occurrenceDate, validateMeetingSegmentSequence } from './anchors';
import { addLocalDateDays } from './local-date';

export function meetingTypeName(type: MeetingTypeCode): 'Lecture' | 'Tutorial' | 'Practical' {
    if (type === 'LEC') {
        return 'Lecture';
    }
    return type === 'TUT' ? 'Tutorial' : 'Practical';
}

export type StoredMeetingSegment = Readonly<{
    meeting_segment_id: string;
    meeting_type: MeetingTypeCode;
    weekday: MeetingWeekday;
    local_start: string;
    local_end: string;
    end_day_offset: MeetingEndDayOffset;
    logical_start_anchor: string;
    logical_end_anchor: string | null;
    effective_range_kind: MeetingEffectiveRangeIntent['kind'];
    effective_start_date: string | null;
    effective_end_date: string | null;
    resolved_start_date: string;
    resolved_end_date: string;
    location_kind: 'known' | 'tba';
    location_value: string | null;
}>;

export type StoredMeetingOverride = Readonly<{
    original_logical_anchor: string;
    override_kind: 'replaced' | 'cancelled';
    meeting_type: MeetingTypeCode | null;
    weekday: MeetingWeekday | null;
    local_start: string | null;
    local_end: string | null;
    end_day_offset: MeetingEndDayOffset | null;
    location_kind: 'known' | 'tba' | null;
    location_value: string | null;
}>;

export type StoredConflictMeetingSegment = StoredMeetingSegment & Readonly<{
    meeting_series_id: string;
    course_id: string;
    course_code: string;
    term_zone: string;
}>;

export type StoredConflictMeetingOverride = StoredMeetingOverride & Readonly<{
    meeting_series_id: string;
}>;

export type StoredHolidayRange = Readonly<{
    holiday_range_id: string;
    start_date: string;
    end_date: string;
}>;

export type ConflictMeetingObject = Readonly<{
    courseId: string | null;
    courseCode: string;
    meetingSeriesId: string | null;
}>;

export type ConflictMeetingOccurrence = Readonly<{
    object: ConflictMeetingObject;
    meetingType: MeetingTypeCode;
    originalLogicalAnchor: string;
    date: string;
    time: MeetingInstantWindow;
}>;

/**
 * Expands effective scheduled occurrences for one Meeting series in a bounded date window.
 * @param {ConflictMeetingObject} object - Stable stored object or unsaved draft reference.
 * @param {string} termZone - Explicit TermZone owning every local time in the series.
 * @param {readonly StoredMeetingSegment[]} segments - Ordered effective rule segments.
 * @param {readonly StoredMeetingOverride[]} overrides - Replacements and cancellations by anchor.
 * @param {readonly StoredHolidayRange[]} holidayRanges - Active inclusive suppression ranges.
 * @param {MeetingOccurrenceWindow} requestedWindow - Bounded physical start-date window.
 * @return {readonly ConflictMeetingOccurrence[]} Effective scheduled occurrences only.
 */
export function expandConflictMeetingOccurrences(
    object: ConflictMeetingObject,
    termZone: string,
    segments: readonly StoredMeetingSegment[],
    overrides: readonly StoredMeetingOverride[],
    holidayRanges: readonly StoredHolidayRange[],
    requestedWindow: MeetingOccurrenceWindow,
): readonly ConflictMeetingOccurrence[] {
    validateMeetingSegmentSequence(segments);
    const overrideByAnchor = new Map(overrides.map(override => [
        override.original_logical_anchor,
        override,
    ]));
    const occurrences: ConflictMeetingOccurrence[] = [];
    const seenAnchors = new Set<string>();
    for (const segment of segments) {
        for (const anchor of candidateLogicalAnchors(segment, requestedWindow)) {
            if (seenAnchors.has(anchor)) {
                throw new Error('Meeting occurrence logical anchor is duplicated');
            }
            seenAnchors.add(anchor);
            const override = overrideByAnchor.get(anchor);
            const baseDate = occurrenceDate(anchor, segment.weekday);
            const weekday = override?.override_kind === 'replaced'
                ? override.weekday!
                : segment.weekday;
            if (!isActiveLogicalAnchor(segment, anchor, segment.weekday)
                || override?.override_kind === 'cancelled') {
                continue;
            }
            const type = override?.override_kind === 'replaced'
                ? override.meeting_type!
                : segment.meeting_type;
            const localStart = override?.override_kind === 'replaced'
                ? override.local_start!
                : segment.local_start;
            const localEnd = override?.override_kind === 'replaced'
                ? override.local_end!
                : segment.local_end;
            const endDayOffset = override?.override_kind === 'replaced'
                ? override.end_day_offset!
                : segment.end_day_offset;
            const date = occurrenceDate(anchor, weekday);
            if (baseDate === null
                || date === null
                || date < requestedWindow.startDate
                || date > requestedWindow.endDate
                || (override?.override_kind !== 'replaced'
                    && holidayRanges.some(range => (
                        baseDate >= range.start_date && baseDate <= range.end_date
                    )))) {
                continue;
            }
            occurrences.push(Object.freeze({
                object,
                meetingType: type,
                originalLogicalAnchor: anchor,
                date,
                time: resolveMeetingOccurrenceTime({
                    termZone,
                    date,
                    localStart,
                    localEnd,
                    endDayOffset,
                }),
            }));
        }
    }
    return Object.freeze(occurrences);
}

/**
 * Materializes the explicit known/TBA location union from validated stored columns.
 * @param {'known' | 'tba'} kind - Stored location discriminant.
 * @param {string | null} value - Known location text, or null for TBA.
 * @return {MeetingLocation} Immutable location DTO.
 */
export function meetingLocation(kind: 'known' | 'tba', value: string | null): MeetingLocation {
    return kind === 'tba'
        ? Object.freeze({ kind: 'tba' as const })
        : Object.freeze({ kind: 'known' as const, value: value! });
}
