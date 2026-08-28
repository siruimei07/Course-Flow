import { readActiveHolidayRanges } from '../conflict-reads';
import { currentVersions } from '../context';
import type { StoreContext } from '../context';
import { freezeEmptyTuple, freezeTuple } from '../results';
import { candidateLogicalAnchors, hasOccurrenceOutsideRequestedWindow, isActiveLogicalAnchor, logicalAnchorBelongsToSegment, occurrenceDate, validateMeetingSegmentSequence } from '../../../plan/anchors';
import { meetingOccurrenceConfirmationToken } from '../../../plan/confirmation-tokens';
import { addClampedLocalDateDays, localDateMilliseconds } from '../../../plan/local-date';
import { StoredMeetingOverride, StoredMeetingSegment, meetingLocation } from '../../../plan/meeting-occurrences';
import { resolveMeetingOccurrenceTime } from '../../../shared/meeting-time';
import type { MeetingEndDayOffset } from '../../../shared/meeting-time';
import { MeetingLocation, MeetingOccurrenceImpactDraft, MeetingOccurrenceWindow, MeetingTypeCode, deriveMeetingOccurrenceId, normalizeMeetingOccurrenceImpactDraft, normalizeMeetingOccurrenceWindow } from '../../../shared/workspace-course-contract';
import type { MeetingOccurrenceId, MeetingOccurrenceImpactProjection, MeetingRuleReplacement, MeetingSeriesDetailProjection, MeetingWeekday } from '../../../shared/workspace-course-contract';
import { isCanonicalUuid } from '../../../shared/workspace-data-contract';
/**
 * Reads a bounded Meeting series projection without persisting ordinary occurrences.
 * @param {string} meetingSeriesId - Stable Meeting series identity.
 * @param {MeetingOccurrenceWindow} candidateWindow - Requested physical-date window.
 * @return {MeetingSeriesDetailProjection} Revision-bound segment and occurrence projection.
 */
export function readMeetingSeriesDetail(ctx: StoreContext, 
    meetingSeriesId: string,
    candidateWindow: MeetingOccurrenceWindow,
): MeetingSeriesDetailProjection {
    return readMeetingSeriesDetailProjection(ctx, meetingSeriesId, candidateWindow, null);
}

/**
 * Evaluates stored rules or a proposed future rule over one bounded window.
 * @param {string} meetingSeriesId - Stable Meeting series identity.
 * @param {MeetingOccurrenceWindow} candidateWindow - Requested physical-date window.
 * @param {MeetingOccurrenceImpactDraft | null} futureChange - Proposed split, or null for current facts.
 * @return {MeetingSeriesDetailProjection} Revision-bound derived occurrence projection.
 */
export function readMeetingSeriesDetailProjection(ctx: StoreContext, 
    meetingSeriesId: string,
    candidateWindow: MeetingOccurrenceWindow,
    futureChange: MeetingOccurrenceImpactDraft | null,
): MeetingSeriesDetailProjection {
    ctx.requireOpen();
    if (!isCanonicalUuid(meetingSeriesId)) {
        throw new TypeError('MeetingSeriesId must be a canonical UUID');
    }
    const requestedWindow = normalizeMeetingOccurrenceWindow(candidateWindow);
    const expandedWindowStart = addClampedLocalDateDays(requestedWindow.startDate, -6);
    const expandedWindowEnd = addClampedLocalDateDays(requestedWindow.endDate, 6);

    try {
        ctx.database.exec('SAVEPOINT read_meeting_series_detail');
        const seriesStatement = ctx.database.prepare(`
                SELECT
                    meeting_series.course_id,
                    meeting_series.entity_version,
                    terms.term_id,
                    terms.time_zone,
                    workspace_state.revision,
                    plan_state.plan_entity_version
                FROM meeting_series
                JOIN courses ON courses.course_id = meeting_series.course_id
                JOIN terms ON terms.term_id = courses.term_id
                JOIN workspace_state ON workspace_state.singleton = 1
                JOIN plan_state ON plan_state.singleton = workspace_state.singleton
                WHERE meeting_series_id = ?
            `);
        seriesStatement.setReadBigInts(true);
        const series = seriesStatement.get(meetingSeriesId) as {
            course_id: string;
            entity_version: bigint;
            term_id: string;
            time_zone: string;
            revision: bigint;
            plan_entity_version: bigint;
        } | undefined;
        if (!series) {
            throw new TypeError('Meeting series does not exist');
        }
        const holidayRanges = readActiveHolidayRanges(ctx.database, series.term_id);

        const segmentRows = ctx.database.prepare(`
                SELECT
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
                WHERE meeting_segments.meeting_series_id = ?
                    AND meeting_segments.logical_start_anchor <= ?
                    AND (
                        meeting_segments.logical_end_anchor IS NULL
                        OR meeting_segments.logical_end_anchor >= ?
                    )
                ORDER BY meeting_segments.logical_start_anchor, meeting_segments.meeting_segment_id
            `).all(meetingSeriesId, expandedWindowEnd, expandedWindowStart) as StoredMeetingSegment[];
        const overrideRows = ctx.database.prepare(`
                SELECT
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
                WHERE meeting_series_id = ?
                    AND original_logical_anchor BETWEEN ? AND ?
                ORDER BY original_logical_anchor
            `).all(meetingSeriesId, expandedWindowStart, expandedWindowEnd) as StoredMeetingOverride[];

        validateMeetingSegmentSequence(segmentRows);
        for (const override of overrideRows) {
            const matchingSegments = segmentRows.filter(segment => (
                logicalAnchorBelongsToSegment(segment, override.original_logical_anchor)
            ));
            if (matchingSegments.length !== 1) {
                throw new Error('Meeting override does not target a logical occurrence');
            }
        }

        const overrides = new Map(overrideRows.map(row => [row.original_logical_anchor, row]));
        const seenAnchors = new Set<string>();
        const segments = Object.freeze(segmentRows.map(row => Object.freeze({
                segmentId: row.meeting_segment_id,
                logicalStartAnchor: row.logical_start_anchor,
                logicalEndAnchor: row.logical_end_anchor,
                type: row.meeting_type,
                weekday: row.weekday,
                localStart: row.local_start,
                localEnd: row.local_end,
                endDayOffset: row.end_day_offset,
                location: meetingLocation(row.location_kind, row.location_value),
            })));
        const occurrences = [] as Array<Readonly<{
            occurrenceId: MeetingOccurrenceId;
            segmentId: string;
            date: string;
            status: 'scheduled' | 'cancelled' | 'holiday-suppressed';
            overrideKind: 'replaced' | 'cancelled' | null;
            type: MeetingTypeCode;
            weekday: MeetingWeekday;
            localStart: string;
            localEnd: string;
            endDayOffset: MeetingEndDayOffset;
            startInstant: string;
            endInstant: string;
            location: MeetingLocation;
        }>>;
        for (const [index, segment] of segments.entries()) {
            const storedSegment = segmentRows[index]!;
            for (const anchor of candidateLogicalAnchors(storedSegment, requestedWindow)) {
                if (seenAnchors.has(anchor)) {
                    throw new Error('Meeting occurrence logical anchor is duplicated');
                }
                seenAnchors.add(anchor);
                const override = overrides.get(anchor);
                const futureChangeApplies = futureChange !== null
                    && anchor >= futureChange.originalLogicalAnchor;
                const retainedOverride = futureChangeApplies
                    && anchor === futureChange.originalLogicalAnchor
                    ? undefined
                    : override;
                const baseRule: MeetingRuleReplacement = futureChangeApplies
                    ? futureChange.replacement
                    : {
                        type: segment.type,
                        weekday: segment.weekday,
                        localStart: segment.localStart,
                        localEnd: segment.localEnd,
                        endDayOffset: segment.endDayOffset,
                        location: segment.location,
                    };
                if (!isActiveLogicalAnchor(storedSegment, anchor, baseRule.weekday)) {
                    continue;
                }
                const replacement: MeetingRuleReplacement = retainedOverride?.override_kind === 'replaced'
                    ? {
                        type: retainedOverride.meeting_type!,
                        weekday: retainedOverride.weekday!,
                        localStart: retainedOverride.local_start!,
                        localEnd: retainedOverride.local_end!,
                        endDayOffset: retainedOverride.end_day_offset!,
                        location: meetingLocation(
                            retainedOverride.location_kind!,
                            retainedOverride.location_value,
                        ),
                    }
                    : baseRule;
                const baseDate = occurrenceDate(anchor, baseRule.weekday);
                const date = occurrenceDate(anchor, replacement.weekday);
                if (baseDate === null
                    || date === null
                    || date < requestedWindow.startDate
                    || date > requestedWindow.endDate) {
                    continue;
                }
                const instantWindow = resolveMeetingOccurrenceTime({
                    termZone: series.time_zone,
                    date,
                    localStart: replacement.localStart,
                    localEnd: replacement.localEnd,
                    endDayOffset: replacement.endDayOffset,
                });
                occurrences.push(Object.freeze({
                    occurrenceId: deriveMeetingOccurrenceId(meetingSeriesId, anchor),
                    segmentId: segment.segmentId,
                    date,
                    status: retainedOverride?.override_kind === 'cancelled'
                        ? 'cancelled'
                        : retainedOverride?.override_kind === 'replaced'
                            ? 'scheduled'
                            : holidayRanges.some(range => (
                                baseDate >= range.start_date && baseDate <= range.end_date
                            ))
                                ? 'holiday-suppressed'
                                : 'scheduled',
                    overrideKind: retainedOverride?.override_kind ?? null,
                    type: replacement.type,
                    weekday: replacement.weekday,
                    localStart: replacement.localStart,
                    localEnd: replacement.localEnd,
                    endDayOffset: replacement.endDayOffset,
                    startInstant: instantWindow.startInstant,
                    endInstant: instantWindow.endInstant,
                    location: replacement.location,
                }));
            }
        }
        ctx.database.exec('RELEASE SAVEPOINT read_meeting_series_detail');

        return Object.freeze({
            workspaceRevision: series.revision.toString(),
            planEntityVersion: series.plan_entity_version.toString(),
            requestedWindow,
            termZone: series.time_zone,
            meetingSeriesId,
            courseId: series.course_id,
            entityVersion: series.entity_version.toString(),
            segments,
            occurrences: Object.freeze(occurrences),
        });
    }
    catch (error) {
        ctx.rollbackOrRequireReopen();
        throw error;
    }
}

/**
 * Previews and tokenizes a this-and-future Meeting rule split.
 * @param {MeetingOccurrenceImpactDraft} candidate - Untrusted exact preview draft.
 * @return {MeetingOccurrenceImpactProjection} Version-bound current/after impact projection.
 */
export function previewMeetingOccurrenceChange(ctx: StoreContext, 
    candidate: MeetingOccurrenceImpactDraft,
): MeetingOccurrenceImpactProjection {
    ctx.requireOpen();
    const draft = normalizeMeetingOccurrenceImpactDraft(candidate);
    const detail = readMeetingSeriesDetail(ctx, draft.meetingSeriesId, draft.requestedWindow);
    const target = detail.occurrences.find(occurrence => (
        occurrence.occurrenceId.originalLogicalAnchor === draft.originalLogicalAnchor
    ));
    if (!target) {
        throw new TypeError('Meeting occurrence impact target is outside the requested window');
    }
    const afterChangeDetail = readMeetingSeriesDetailProjection(ctx, 
        draft.meetingSeriesId,
        draft.requestedWindow,
        draft,
    );

    try {
        ctx.database.exec('BEGIN');
        const versions = currentVersions(ctx.database);
        const seriesStatement = ctx.database.prepare(`
                SELECT entity_version
                FROM meeting_series
                WHERE meeting_series_id = ? AND retired = 0
            `);
        seriesStatement.setReadBigInts(true);
        const series = seriesStatement.get(draft.meetingSeriesId) as {
            entity_version: bigint;
        } | undefined;
        if (!series
            || versions.revision.toString() !== detail.workspaceRevision
            || versions.planVersion.toString() !== detail.planEntityVersion
            || series.entity_version.toString() !== detail.entityVersion
            || afterChangeDetail.workspaceRevision !== detail.workspaceRevision
            || afterChangeDetail.planEntityVersion !== detail.planEntityVersion
            || afterChangeDetail.entityVersion !== detail.entityVersion) {
            throw new Error('Meeting impact snapshot changed while it was being prepared');
        }

        const scopeSegments = ctx.database.prepare(`
                SELECT
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
                WHERE meeting_segments.meeting_series_id = ?
                ORDER BY meeting_segments.logical_start_anchor, meeting_segments.meeting_segment_id
            `).all(draft.meetingSeriesId) as StoredMeetingSegment[];
        validateMeetingSegmentSequence(scopeSegments);
        const range = scopeSegments.find(segment => segment.meeting_segment_id === target.segmentId);
        const boundaryOverrides = ctx.database.prepare(`
                SELECT
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
                WHERE meeting_series_id = ?
                    AND original_logical_anchor BETWEEN ? AND ?
                ORDER BY original_logical_anchor
            `).all(
            draft.meetingSeriesId,
            addClampedLocalDateDays(draft.requestedWindow.startDate, -12),
            addClampedLocalDateDays(draft.requestedWindow.endDate, 12),
        ) as StoredMeetingOverride[];
        const targetDateAfterChange = occurrenceDate(
            draft.originalLogicalAnchor,
            draft.replacement.weekday,
        );
        if (!range
            || targetDateAfterChange === null
            || targetDateAfterChange < range.resolved_start_date
            || targetDateAfterChange > range.resolved_end_date) {
            throw new TypeError('Meeting occurrence replacement falls outside its effective range');
        }

        const impactStatement = ctx.database.prepare(`
                SELECT
                    (
                        SELECT count(*)
                        FROM meeting_segments
                        WHERE meeting_series_id = ?
                            AND (
                                logical_end_anchor IS NULL
                                OR logical_end_anchor >= ?
                            )
                    ) AS affected_segment_count,
                    (
                        SELECT count(*)
                        FROM meeting_occurrence_overrides
                        WHERE meeting_series_id = ? AND original_logical_anchor >= ?
                    ) AS future_override_count,
                    (
                        SELECT override_kind
                        FROM meeting_occurrence_overrides
                        WHERE meeting_series_id = ? AND original_logical_anchor = ?
                    ) AS target_override_kind
            `);
        impactStatement.setReadBigInts(true);
        const impact = impactStatement.get(
            draft.meetingSeriesId,
            draft.originalLogicalAnchor,
            draft.meetingSeriesId,
            draft.originalLogicalAnchor,
            draft.meetingSeriesId,
            draft.originalLogicalAnchor,
        ) as {
            affected_segment_count: bigint;
            future_override_count: bigint;
            target_override_kind: 'replaced' | 'cancelled' | null;
        };
        const confirmationToken = meetingOccurrenceConfirmationToken(
            detail.workspaceRevision,
            detail.planEntityVersion,
            detail.entityVersion,
            draft,
            draft.requestedWindow,
        );
        const minimumLocalDate = localDateMilliseconds('0000-01-01');
        const maximumLocalDate = localDateMilliseconds('9999-12-31');
        const targetAnchor = localDateMilliseconds(draft.originalLogicalAnchor);
        const historyOutsideRequestedWindow = hasOccurrenceOutsideRequestedWindow(
            scopeSegments,
            minimumLocalDate,
            targetAnchor - 1,
            draft.requestedWindow,
            null,
            boundaryOverrides,
            null,
        );
        const currentFutureOutsideRequestedWindow = hasOccurrenceOutsideRequestedWindow(
            scopeSegments,
            targetAnchor,
            maximumLocalDate,
            draft.requestedWindow,
            null,
            boundaryOverrides,
            null,
        );
        const changedFutureOutsideRequestedWindow = hasOccurrenceOutsideRequestedWindow(
            scopeSegments,
            targetAnchor,
            maximumLocalDate,
            draft.requestedWindow,
            draft.replacement.weekday,
            boundaryOverrides,
            draft.originalLogicalAnchor,
        );
        const futureOutsideRequestedWindow = currentFutureOutsideRequestedWindow
            || changedFutureOutsideRequestedWindow;
        const targetOverrideKind = impact.target_override_kind ?? 'none';
        const warnings = [] as Array<Readonly<{
            code:
                | 'preview-window-truncated-history'
                | 'preview-window-truncated-future'
                | 'target-override-will-be-cleared';
        }>>;
        if (historyOutsideRequestedWindow) {
            warnings.push(Object.freeze({ code: 'preview-window-truncated-history' }));
        }
        if (futureOutsideRequestedWindow) {
            warnings.push(Object.freeze({ code: 'preview-window-truncated-future' }));
        }
        if (targetOverrideKind !== 'none') {
            warnings.push(Object.freeze({ code: 'target-override-will-be-cleared' }));
        }
        const affectedFutureSegmentCount = impact.affected_segment_count.toString();
        ctx.database.exec('COMMIT');

        return Object.freeze({
            basedOnRevision: detail.workspaceRevision,
            planEntityVersion: detail.planEntityVersion,
            meetingSeriesVersion: detail.entityVersion,
            affectedEntities: freezeTuple([Object.freeze({
                kind: 'meeting-series' as const,
                id: draft.meetingSeriesId,
                version: detail.entityVersion,
            })]),
            effects: freezeTuple([Object.freeze({
                code: 'plan.meeting-series-split' as const,
                originalLogicalAnchor: draft.originalLogicalAnchor,
                affectedFutureSegmentCount,
                targetOverrideAction: targetOverrideKind === 'none' ? 'none' as const : 'clear' as const,
                laterOverrideAction: 'retain' as const,
            })]),
            warnings: Object.freeze(warnings),
            choices: freezeTuple([Object.freeze({ id: 'apply-this-and-future' as const })]),
            defaultChoice: Object.freeze({ id: 'apply-this-and-future' as const }),
            recoverability: Object.freeze({
                kind: 'permanent' as const,
                reason: 'meeting-rule-split-has-no-undo' as const,
            }),
            unresolvedReferences: freezeEmptyTuple(),
            scope: draft.scope,
            meetingSeriesId: draft.meetingSeriesId,
            originalLogicalAnchor: draft.originalLogicalAnchor,
            requestedWindow: draft.requestedWindow,
            replacement: draft.replacement,
            targetDateAfterChange,
            targetOverrideKind,
            affectedFutureSegmentCount,
            futureOverrideCount: impact.future_override_count.toString(),
            historicalOccurrences: Object.freeze(detail.occurrences.filter(occurrence => (
                occurrence.occurrenceId.originalLogicalAnchor < draft.originalLogicalAnchor
            ))),
            currentFutureOccurrences: Object.freeze(detail.occurrences.filter(occurrence => (
                occurrence.occurrenceId.originalLogicalAnchor >= draft.originalLogicalAnchor
            ))),
            futureOccurrencesAfterChange: Object.freeze(afterChangeDetail.occurrences
                .filter(occurrence => (
                    occurrence.occurrenceId.originalLogicalAnchor >= draft.originalLogicalAnchor
                ))
                .map(occurrence => Object.freeze({
                    occurrenceId: occurrence.occurrenceId,
                    date: occurrence.date,
                    status: occurrence.status,
                    overrideKind: occurrence.overrideKind,
                    type: occurrence.type,
                    weekday: occurrence.weekday,
                    localStart: occurrence.localStart,
                    localEnd: occurrence.localEnd,
                    endDayOffset: occurrence.endDayOffset,
                    startInstant: occurrence.startInstant,
                    endInstant: occurrence.endInstant,
                    location: occurrence.location,
                }))),
            historyOutsideRequestedWindow,
            futureOutsideRequestedWindow,
            attendanceRecordCount: '0',
            explicitGradeReferenceCount: '0',
            confirmationToken,
        });
    }
    catch (error) {
        ctx.rollbackOrRequireReopen();
        throw error;
    }
}
