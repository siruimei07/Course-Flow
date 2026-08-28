/**
 * Reads active named ranges for deterministic Meeting suppression inside the current snapshot.
 * @param {string} termId - Owning Term identity.
 * @return {readonly StoredHolidayRange[]} Inclusive active ranges in deterministic order.
 */
import { DatabaseSync } from 'node:sqlite';
import { ConflictMeetingOccurrence, StoredConflictMeetingOverride, StoredConflictMeetingSegment, StoredHolidayRange, expandConflictMeetingOccurrences } from '../../plan/meeting-occurrences';
import { MeetingOccurrenceWindow } from '../../shared/workspace-course-contract';
export function readActiveHolidayRanges(database: DatabaseSync, termId: string): readonly StoredHolidayRange[] {
    return database.prepare(`
            SELECT holiday_range_id, start_date, end_date
            FROM holiday_ranges
            WHERE term_id = ? AND tombstoned = 0
            ORDER BY start_date, holiday_range_id
        `).all(termId) as StoredHolidayRange[];
}

/**
 * Reads and expands all retained Meeting occurrences from the caller's active snapshot.
 * @param {MeetingOccurrenceWindow} requestedWindow - Bounded physical start-date window.
 * @param {string} termId - Owning Term whose occurrences can share one schedule.
 * @param {readonly StoredHolidayRange[]} candidateHolidayRanges - Optional proposed active ranges.
 * @return {readonly ConflictMeetingOccurrence[]} Effective scheduled occurrences across PLAN.
 */
export function readConflictMeetingOccurrences(database: DatabaseSync, 
    requestedWindow: MeetingOccurrenceWindow,
    termId: string,
    candidateHolidayRanges?: readonly StoredHolidayRange[],
): readonly ConflictMeetingOccurrence[] {
    const holidayRanges = candidateHolidayRanges ?? readActiveHolidayRanges(database, termId);
    const segmentRows = database.prepare(`
            SELECT
                meeting_series.meeting_series_id,
                courses.course_id,
                courses.code AS course_code,
                terms.time_zone AS term_zone,
                meeting_segments.meeting_segment_id,
                meeting_segments.meeting_type,
                meeting_segments.weekday,
                meeting_segments.local_start,
                meeting_segments.local_end,
                meeting_segments.end_day_offset,
                meeting_segments.logical_start_anchor,
                meeting_segments.logical_end_anchor,
                meeting_segments.effective_range_kind,
                meeting_segments.effective_start_date,
                meeting_segments.effective_end_date,
                meeting_segments.location_kind,
                meeting_segments.location_value,
                CASE
                    WHEN meeting_segments.effective_range_kind = 'explicit'
                        THEN meeting_segments.effective_start_date
                    WHEN courses.teaching_range_kind = 'explicit'
                        THEN courses.teaching_start_date
                    ELSE terms.start_date
                END AS resolved_start_date,
                CASE
                    WHEN meeting_segments.effective_range_kind = 'explicit'
                        THEN meeting_segments.effective_end_date
                    WHEN courses.teaching_range_kind = 'explicit'
                        THEN courses.teaching_end_date
                    ELSE terms.end_date
                END AS resolved_end_date
            FROM meeting_segments
            JOIN meeting_series
                ON meeting_series.meeting_series_id = meeting_segments.meeting_series_id
            JOIN courses ON courses.course_id = meeting_series.course_id
            JOIN terms ON terms.term_id = courses.term_id
            WHERE meeting_series.retired = 0
                AND courses.archived = 0
                AND terms.archived = 0
                AND terms.term_id = ?
            ORDER BY
                meeting_series.meeting_series_id,
                meeting_segments.logical_start_anchor,
                meeting_segments.meeting_segment_id
        `).all(termId) as StoredConflictMeetingSegment[];
    const overrideRows = database.prepare(`
            SELECT
                meeting_series_id,
                original_logical_anchor,
                override_kind,
                meeting_type,
                weekday,
                local_start,
                local_end,
                end_day_offset,
                location_kind,
                location_value
            FROM meeting_occurrence_overrides
            ORDER BY meeting_series_id, original_logical_anchor
        `).all() as StoredConflictMeetingOverride[];
    const rowsBySeries = new Map<string, StoredConflictMeetingSegment[]>();
    for (const row of segmentRows) {
        const rows = rowsBySeries.get(row.meeting_series_id) ?? [];
        rows.push(row);
        rowsBySeries.set(row.meeting_series_id, rows);
    }

    const occurrences: ConflictMeetingOccurrence[] = [];
    for (const [meetingSeriesId, rows] of rowsBySeries) {
        const first = rows[0]!;
        occurrences.push(...expandConflictMeetingOccurrences(
            Object.freeze({
                courseId: first.course_id,
                courseCode: first.course_code,
                meetingSeriesId,
            }),
            first.term_zone,
            rows,
            overrideRows.filter(override => override.meeting_series_id === meetingSeriesId),
            holidayRanges,
            requestedWindow,
        ));
    }
    return Object.freeze(occurrences);
}
