import { randomUUID, timingSafeEqual } from 'node:crypto';
import { digestCancelMeetingOccurrence, digestChangeMeetingOccurrence, digestCreateMeetingSeries } from '../../command-digest';
import { readActiveHolidayRanges, readConflictMeetingOccurrences } from '../conflict-reads';
import { advanceSetupMinimumMilestone, currentVersions, readReceiptOutcome } from '../context';
import type { StoreContext } from '../context';
import { classifySqliteFailure, fireCommitFailpoint } from '../database';
import { isChangeMeetingOccurrenceCommand, isCurrentChangeMeetingOccurrenceCommand } from '../guards';
import type { MeetingOccurrenceMutationCommand } from '../guards';
import { decisionRequiredResult, meetingOverlapDecisionRequiredResult, meetingSeriesConflictResult, permissionCommitResult, planConflictResult, successfulCommit, writerBusyResult } from '../results';
import { CommittedCommandOutcomeUnknownError, SQLITE_INTEGER_MAX } from '../types';
import type { CommitOptions, DataCommitResult } from '../types';
import { firstWeeklyLogicalAnchor, isActiveLogicalAnchor, occurrenceDate, validateMeetingSegmentSequence } from '../../../plan/anchors';
import { meetingOccurrenceConfirmationToken } from '../../../plan/confirmation-tokens';
import { addClampedLocalDateDays, addLocalDateDays } from '../../../plan/local-date';
import { ConflictMeetingOccurrence, StoredMeetingOverride, StoredMeetingSegment, expandConflictMeetingOccurrences } from '../../../plan/meeting-occurrences';
import { meetingOverlapWarnings } from '../../../plan/meeting-overlap';
import { resolveMeetingOccurrenceTime } from '../../../shared/meeting-time';
import { CreateMeetingSeriesCommand } from '../../../shared/workspace-course-contract';
import type { CourseTeachingRangeIntent } from '../../../shared/workspace-course-contract';
export function commitMeetingSeriesSynchronously(ctx: StoreContext, 
    command: CreateMeetingSeriesCommand,
    options: CommitOptions,
): DataCommitResult {
    const digest = digestCreateMeetingSeries(command);
    let commitAttempted = false;

    try {
        ctx.database.exec('BEGIN IMMEDIATE');
        fireCommitFailpoint(options, 'commit.after-begin');

        const receipt = ctx.database.prepare(`
                SELECT payload_digest
                FROM command_receipts
                WHERE command_id = ?
            `).get(command.commandId) as { payload_digest: Uint8Array } | undefined;
        fireCommitFailpoint(options, 'commit.after-receipt-read');
        if (receipt) {
            const versions = currentVersions(ctx.database);
            if (!timingSafeEqual(receipt.payload_digest, digest)) {
                ctx.rollbackOrRequireReopen();
                return planConflictResult('command-id-reused', versions);
            }
            const outcome = readReceiptOutcome(ctx.database, command.commandId);
            ctx.rollbackOrRequireReopen();
            if (!outcome) {
                throw new Error('Stored receipt outcome is incomplete');
            }
            return successfulCommit(outcome);
        }

        const versions = currentVersions(ctx.database);
        if (versions.revision !== BigInt(command.expectedRevision)) {
            ctx.rollbackOrRequireReopen();
            return planConflictResult('expected-revision', versions);
        }
        if (versions.planVersion !== BigInt(command.expectedPlanVersion)) {
            ctx.rollbackOrRequireReopen();
            return planConflictResult('expected-entity-version', versions);
        }
        const courseStatement = ctx.database.prepare(`
                SELECT
                    courses.course_id,
                    courses.code,
                    courses.teaching_range_kind,
                    courses.teaching_start_date,
                    courses.teaching_end_date,
                    courses.entity_version,
                    terms.term_id,
                    terms.start_date AS term_start_date,
                    terms.end_date AS term_end_date,
                    terms.time_zone
                FROM courses
                JOIN plan_state ON plan_state.current_term_id = courses.term_id
                JOIN terms ON terms.term_id = courses.term_id
                WHERE plan_state.singleton = 1
                    AND courses.course_id = ?
                    AND courses.archived = 0
            `);
        courseStatement.setReadBigInts(true);
        const course = courseStatement.get(command.intent.payload.courseId) as {
            course_id: string;
            code: string;
            teaching_range_kind: CourseTeachingRangeIntent['kind'];
            teaching_start_date: string | null;
            teaching_end_date: string | null;
            entity_version: bigint;
            term_id: string;
            term_start_date: string;
            term_end_date: string;
            time_zone: string;
        } | undefined;
        if (!course) {
            ctx.rollbackOrRequireReopen();
            throw new TypeError('Meeting requires an active Course in the Current Term');
        }
        if (course.entity_version !== BigInt(command.expectedCourseVersion)) {
            ctx.rollbackOrRequireReopen();
            return planConflictResult('expected-entity-version', versions);
        }
        fireCommitFailpoint(options, 'commit.after-expected-versions');

        const teachingStartDate = course.teaching_range_kind === 'inherit-term'
            ? course.term_start_date
            : course.teaching_start_date!;
        const teachingEndDate = course.teaching_range_kind === 'inherit-term'
            ? course.term_end_date
            : course.teaching_end_date!;
        const meeting = command.intent.payload.meeting;
        const effectiveStartDate = meeting.effectiveRange.kind === 'inherit-course'
            ? teachingStartDate
            : meeting.effectiveRange.startDate;
        const effectiveEndDate = meeting.effectiveRange.kind === 'inherit-course'
            ? teachingEndDate
            : meeting.effectiveRange.endDate;
        if (effectiveStartDate < teachingStartDate || effectiveEndDate > teachingEndDate) {
            ctx.rollbackOrRequireReopen();
            throw new TypeError('Meeting range must remain inside its Course');
        }
        const logicalStartAnchor = firstWeeklyLogicalAnchor(effectiveStartDate, meeting.weekday);
        const proposedOccurrences = expandConflictMeetingOccurrences(
            Object.freeze({
                courseId: null,
                courseCode: course.code,
                meetingSeriesId: null,
            }),
            course.time_zone,
            [Object.freeze({
                meeting_segment_id: command.commandId,
                meeting_type: meeting.type,
                weekday: meeting.weekday,
                local_start: meeting.localStart,
                local_end: meeting.localEnd,
                end_day_offset: meeting.endDayOffset,
                logical_start_anchor: logicalStartAnchor,
                logical_end_anchor: null,
                effective_range_kind: meeting.effectiveRange.kind,
                effective_start_date: meeting.effectiveRange.kind === 'explicit'
                    ? meeting.effectiveRange.startDate
                    : null,
                effective_end_date: meeting.effectiveRange.kind === 'explicit'
                    ? meeting.effectiveRange.endDate
                    : null,
                resolved_start_date: effectiveStartDate,
                resolved_end_date: effectiveEndDate,
                location_kind: meeting.location.kind,
                location_value: meeting.location.kind === 'known' ? meeting.location.value : null,
            })],
            [],
            readActiveHolidayRanges(ctx.database, course.term_id),
            Object.freeze({ startDate: effectiveStartDate, endDate: effectiveEndDate }),
        );
        const overlapWindow = Object.freeze({
            startDate: addClampedLocalDateDays(effectiveStartDate, -3),
            endDate: addClampedLocalDateDays(effectiveEndDate, 3),
        });
        const overlapWarnings = meetingOverlapWarnings(
            command.commandId,
            proposedOccurrences,
            readConflictMeetingOccurrences(ctx.database, overlapWindow, course.term_id),
        );
        if (command.overlapDecision === 'review' && overlapWarnings.length > 0) {
            ctx.rollbackOrRequireReopen();
            return meetingOverlapDecisionRequiredResult(versions.revision, overlapWarnings);
        }
        if (versions.revision === SQLITE_INTEGER_MAX || versions.planVersion === SQLITE_INTEGER_MAX) {
            ctx.rollbackOrRequireReopen();
            throw ctx.enterTerminalState();
        }

        const newRevision = versions.revision + 1n;
        const newPlanVersion = versions.planVersion + 1n;
        const meetingSeriesId = randomUUID();
        const meetingSegmentId = randomUUID();
        ctx.database.prepare(`
                INSERT INTO meeting_series (
                    meeting_series_id,
                    course_id,
                    retired,
                    entity_version
                ) VALUES (?, ?, 0, 1)
            `).run(meetingSeriesId, course.course_id);
        ctx.database.prepare(`
                INSERT INTO meeting_segments (
                    meeting_segment_id,
                    meeting_series_id,
                    meeting_type,
                    weekday,
                    local_start,
                    local_end,
                    end_day_offset,
                    logical_start_anchor,
                    logical_end_anchor,
                    effective_range_kind,
                    effective_start_date,
                    effective_end_date,
                    location_kind,
                    location_value
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
            meetingSegmentId,
            meetingSeriesId,
            meeting.type,
            meeting.weekday,
            meeting.localStart,
            meeting.localEnd,
            meeting.endDayOffset,
            logicalStartAnchor,
            null,
            meeting.effectiveRange.kind,
            meeting.effectiveRange.kind === 'explicit' ? meeting.effectiveRange.startDate : null,
            meeting.effectiveRange.kind === 'explicit' ? meeting.effectiveRange.endDate : null,
            meeting.location.kind,
            meeting.location.kind === 'known' ? meeting.location.value : null,
        );
        ctx.database.prepare(`
                UPDATE plan_state
                SET plan_entity_version = ?
                WHERE singleton = 1
            `).run(newPlanVersion);
        advanceSetupMinimumMilestone(ctx.database);
        fireCommitFailpoint(options, 'commit.after-facts');

        ctx.database.prepare(
            'UPDATE workspace_state SET revision = ? WHERE singleton = 1',
        ).run(newRevision);
        fireCommitFailpoint(options, 'commit.after-revision');
        ctx.database.prepare(`
                INSERT INTO command_receipts (
                    command_id,
                    intent_kind,
                    intent_schema_version,
                    canonical_encoding,
                    digest_algorithm,
                    payload_digest,
                    committed_revision,
                    result_kind
                ) VALUES (
                    ?, 'plan.create-meeting-series', 1,
                    'courseflow-canonical-json-v1', 'sha256', ?, ?, 'committed'
                )
            `).run(command.commandId, digest, newRevision);
        fireCommitFailpoint(options, 'commit.after-receipt');
        ctx.database.prepare(`
                INSERT INTO receipt_effects (
                    command_id,
                    effect_order,
                    effect_code,
                    entity_kind,
                    entity_id,
                    entity_version
                ) VALUES (?, 0, 'plan.meeting-series-created', 'meeting-series', ?, 1)
            `).run(command.commandId, meetingSeriesId);
        ctx.database.prepare(`
                INSERT INTO durable_followups (
                    follow_up_id,
                    originating_command_id,
                    owner,
                    kind,
                    prerequisite_revision,
                    state,
                    follow_up_version
                ) VALUES (?, ?, 'protect', 'backup-needed-through', ?, 'pending', 0)
            `).run(command.followUpId, command.commandId, newRevision);
        fireCommitFailpoint(options, 'commit.after-followup');
        ctx.database.prepare(`
                UPDATE protection_watermarks
                SET backup_needed_through = ?
                WHERE singleton = 1
            `).run(newRevision);
        fireCommitFailpoint(options, 'commit.after-watermark');
        fireCommitFailpoint(options, 'commit.before-sqlite-commit');

        commitAttempted = true;
        ctx.database.exec('COMMIT');
        ctx.setRevision(newRevision);
        fireCommitFailpoint(options, 'commit.after-sqlite-commit');
        const outcome = readReceiptOutcome(ctx.database, command.commandId);
        if (!outcome) {
            throw new Error('Committed receipt outcome is missing');
        }
        return successfulCommit(outcome);
    }
    catch (error) {
        if (ctx.terminalError()) {
            throw ctx.terminalError();
        }
        if (commitAttempted) {
            throw ctx.enterTerminalState(new CommittedCommandOutcomeUnknownError(command.commandId));
        }
        ctx.rollbackOrRequireReopen();
        if (error instanceof TypeError) {
            throw error;
        }
        const disposition = classifySqliteFailure(error, 'pre-commit');
        if (disposition.kind === 'retryable-unchanged') {
            return writerBusyResult(ctx.revision());
        }
        if (disposition.kind === 'read-only') {
            ctx.markReadOnly();
            return permissionCommitResult(ctx.revision());
        }
        if (disposition.kind === 'failed-unchanged') {
            const message = disposition.reason === 'storage-full'
                ? 'Workspace data write failed: storage full'
                : 'Workspace data recovery is required';
            throw new Error(message);
        }
        throw new Error('Workspace data commit failed');
    }
}

/**
 * Commits one occurrence override or deterministic future segment split atomically.
 * @param {MeetingOccurrenceMutationCommand} command - Normalized versioned mutation.
 * @param {CommitOptions} options - Transaction failpoint controls used by tests.
 * @return {DataCommitResult} Committed receipt or unchanged structured problem.
 */
export function commitMeetingOccurrenceMutationSynchronously(ctx: StoreContext, 
    command: MeetingOccurrenceMutationCommand,
    options: CommitOptions,
): DataCommitResult {
    const digest = isChangeMeetingOccurrenceCommand(command)
        ? digestChangeMeetingOccurrence(command)
        : digestCancelMeetingOccurrence(command);
    let commitAttempted = false;

    try {
        ctx.database.exec('BEGIN IMMEDIATE');
        fireCommitFailpoint(options, 'commit.after-begin');

        const receipt = ctx.database.prepare(`
                SELECT payload_digest
                FROM command_receipts
                WHERE command_id = ?
            `).get(command.commandId) as { payload_digest: Uint8Array } | undefined;
        fireCommitFailpoint(options, 'commit.after-receipt-read');
        if (receipt) {
            const versions = currentVersions(ctx.database);
            if (!timingSafeEqual(receipt.payload_digest, digest)) {
                ctx.rollbackOrRequireReopen();
                return planConflictResult('command-id-reused', versions);
            }

            const outcome = readReceiptOutcome(ctx.database, command.commandId);
            ctx.rollbackOrRequireReopen();
            if (!outcome) {
                throw new Error('Stored receipt outcome is incomplete');
            }
            return successfulCommit(outcome);
        }

        const versions = currentVersions(ctx.database);
        const payload = command.intent.payload;
        if (isChangeMeetingOccurrenceCommand(command)
            && !isCurrentChangeMeetingOccurrenceCommand(command)) {
            ctx.rollbackOrRequireReopen();
            throw new TypeError('Legacy Meeting occurrence commands are replay-only');
        }
        const seriesStatement = ctx.database.prepare(`
                SELECT
                    meeting_series.entity_version,
                    meeting_series.retired,
                    courses.course_id,
                    courses.code AS course_code,
                    terms.term_id,
                    terms.time_zone
                FROM meeting_series
                JOIN courses ON courses.course_id = meeting_series.course_id
                JOIN terms ON terms.term_id = courses.term_id
                WHERE meeting_series.meeting_series_id = ?
            `);
        seriesStatement.setReadBigInts(true);
        const series = seriesStatement.get(payload.meetingSeriesId) as {
            entity_version: bigint;
            retired: bigint;
            course_id: string;
            course_code: string;
            term_id: string;
            time_zone: string;
        } | undefined;
        if (!series || series.retired !== 0n) {
            ctx.rollbackOrRequireReopen();
            throw new TypeError('Meeting series is not editable');
        }
        const isFutureChange = isChangeMeetingOccurrenceCommand(command)
            && command.intent.payload.scope === 'this-and-future';
        if (isFutureChange) {
            const expectedToken = command.impactWindow === null
                ? null
                : meetingOccurrenceConfirmationToken(
                    versions.revision.toString(),
                    versions.planVersion.toString(),
                    series.entity_version.toString(),
                    {
                        ...command.intent.payload,
                        scope: 'this-and-future',
                    },
                    command.impactWindow,
                );
            if (versions.revision !== BigInt(command.expectedRevision)
                || versions.planVersion !== BigInt(command.expectedPlanVersion)
                || series.entity_version !== BigInt(command.expectedMeetingSeriesVersion)
                || expectedToken === null
                || command.confirmationToken === null
                || command.confirmationToken !== expectedToken) {
                ctx.rollbackOrRequireReopen();
                return decisionRequiredResult(versions.revision);
            }
        }
        else if (versions.revision !== BigInt(command.expectedRevision)) {
            ctx.rollbackOrRequireReopen();
            return planConflictResult('expected-revision', versions);
        }
        else if (versions.planVersion !== BigInt(command.expectedPlanVersion)) {
            ctx.rollbackOrRequireReopen();
            return planConflictResult('expected-entity-version', versions);
        }
        if (series.entity_version !== BigInt(command.expectedMeetingSeriesVersion)) {
            ctx.rollbackOrRequireReopen();
            return meetingSeriesConflictResult(
                'expected-entity-version',
                versions,
                payload.meetingSeriesId,
                series.entity_version,
            );
        }
        fireCommitFailpoint(options, 'commit.after-expected-versions');

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
                ORDER BY meeting_segments.logical_start_anchor, meeting_segments.meeting_segment_id
            `).all(payload.meetingSeriesId) as StoredMeetingSegment[];
        validateMeetingSegmentSequence(segmentRows);
        const matchingSegments = segmentRows.filter(candidate => (
            isActiveLogicalAnchor(candidate, payload.originalLogicalAnchor)
        ));
        if (matchingSegments.length !== 1) {
            ctx.rollbackOrRequireReopen();
            throw new TypeError('Meeting occurrence logical anchor does not exist');
        }
        const segment = matchingSegments[0]!;
        if (isChangeMeetingOccurrenceCommand(command)) {
            const replacementDate = occurrenceDate(
                payload.originalLogicalAnchor,
                command.intent.payload.replacement.weekday,
            );
            if (replacementDate === null
                || replacementDate < segment.resolved_start_date
                || replacementDate > segment.resolved_end_date) {
                ctx.rollbackOrRequireReopen();
                throw new TypeError('Meeting occurrence replacement falls outside its effective range');
            }
        }
        if (isChangeMeetingOccurrenceCommand(command)
            && isCurrentChangeMeetingOccurrenceCommand(command)) {
            const replacement = command.intent.payload.replacement;
            const proposedObject = Object.freeze({
                courseId: series.course_id,
                courseCode: series.course_code,
                meetingSeriesId: payload.meetingSeriesId,
            });
            let proposedOccurrences: readonly ConflictMeetingOccurrence[];
            if (command.intent.payload.scope === 'only-this') {
                const date = occurrenceDate(
                    payload.originalLogicalAnchor,
                    replacement.weekday,
                )!;
                proposedOccurrences = Object.freeze([Object.freeze({
                    object: proposedObject,
                    meetingType: replacement.type,
                    originalLogicalAnchor: payload.originalLogicalAnchor,
                    date,
                    time: resolveMeetingOccurrenceTime({
                        termZone: series.time_zone,
                        date,
                        localStart: replacement.localStart,
                        localEnd: replacement.localEnd,
                        endDayOffset: replacement.endDayOffset,
                    }),
                })]);
            }
            else {
                const retainedOverrides = ctx.database.prepare(`
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
                        WHERE meeting_series_id = ? AND original_logical_anchor > ?
                        ORDER BY original_logical_anchor
                    `).all(
                    payload.meetingSeriesId,
                    payload.originalLogicalAnchor,
                ) as StoredMeetingOverride[];
                proposedOccurrences = expandConflictMeetingOccurrences(
                    proposedObject,
                    series.time_zone,
                    [Object.freeze({
                        ...segment,
                        meeting_segment_id: command.commandId,
                        meeting_type: replacement.type,
                        weekday: replacement.weekday,
                        local_start: replacement.localStart,
                        local_end: replacement.localEnd,
                        end_day_offset: replacement.endDayOffset,
                        logical_start_anchor: payload.originalLogicalAnchor,
                        logical_end_anchor: segmentRows.at(-1)!.logical_end_anchor,
                        location_kind: replacement.location.kind,
                        location_value: replacement.location.kind === 'known'
                            ? replacement.location.value
                            : null,
                    })],
                    retainedOverrides,
                    readActiveHolidayRanges(ctx.database, series.term_id),
                    Object.freeze({
                        startDate: segment.resolved_start_date,
                        endDate: segment.resolved_end_date,
                    }),
                );
            }
            const candidateDates = proposedOccurrences.map(occurrence => occurrence.date);
            if (candidateDates.length === 0) {
                ctx.rollbackOrRequireReopen();
                throw new TypeError('Meeting occurrence replacement has no effective occurrence');
            }
            const conflictWindow = Object.freeze({
                startDate: addClampedLocalDateDays(
                    candidateDates.reduce((first, date) => date < first ? date : first),
                    -3,
                ),
                endDate: addClampedLocalDateDays(
                    candidateDates.reduce((last, date) => date > last ? date : last),
                    3,
                ),
            });
            const existingOccurrences = readConflictMeetingOccurrences(ctx.database,
                conflictWindow,
                series.term_id,
            ).filter(
                occurrence => occurrence.object.meetingSeriesId !== payload.meetingSeriesId
                    || (command.intent.payload.scope === 'only-this'
                        ? occurrence.originalLogicalAnchor !== payload.originalLogicalAnchor
                        : occurrence.originalLogicalAnchor < payload.originalLogicalAnchor),
            );
            const overlapWarnings = meetingOverlapWarnings(
                command.commandId,
                proposedOccurrences,
                existingOccurrences,
            );
            if (command.overlapDecision === 'review' && overlapWarnings.length > 0) {
                ctx.rollbackOrRequireReopen();
                return meetingOverlapDecisionRequiredResult(versions.revision, overlapWarnings);
            }
        }
        if (versions.revision === SQLITE_INTEGER_MAX
            || versions.planVersion === SQLITE_INTEGER_MAX
            || series.entity_version === SQLITE_INTEGER_MAX) {
            ctx.rollbackOrRequireReopen();
            throw ctx.enterTerminalState();
        }

        const newRevision = versions.revision + 1n;
        const newPlanVersion = versions.planVersion + 1n;
        const newSeriesVersion = series.entity_version + 1n;
        if (command.intent.kind === 'plan.cancel-meeting-occurrence') {
            ctx.database.prepare(`
                    INSERT INTO meeting_occurrence_overrides (
                        meeting_series_id,
                        original_logical_anchor,
                        override_kind,
                        meeting_type,
                        weekday,
                        local_start,
                        local_end,
                        end_day_offset,
                        location_kind,
                        location_value,
                        entity_version
                    ) VALUES (?, ?, 'cancelled', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1)
                    ON CONFLICT (meeting_series_id, original_logical_anchor) DO UPDATE SET
                        override_kind = 'cancelled',
                        meeting_type = NULL,
                        weekday = NULL,
                        local_start = NULL,
                        local_end = NULL,
                        end_day_offset = NULL,
                        location_kind = NULL,
                        location_value = NULL,
                        entity_version = meeting_occurrence_overrides.entity_version + 1
                `).run(payload.meetingSeriesId, payload.originalLogicalAnchor);
        }
        else if (command.intent.payload.scope === 'only-this') {
            const replacement = command.intent.payload.replacement;
            ctx.database.prepare(`
                    INSERT INTO meeting_occurrence_overrides (
                        meeting_series_id,
                        original_logical_anchor,
                        override_kind,
                        meeting_type,
                        weekday,
                        local_start,
                        local_end,
                        end_day_offset,
                        location_kind,
                        location_value,
                        entity_version
                    ) VALUES (?, ?, 'replaced', ?, ?, ?, ?, ?, ?, ?, 1)
                    ON CONFLICT (meeting_series_id, original_logical_anchor) DO UPDATE SET
                        override_kind = 'replaced',
                        meeting_type = excluded.meeting_type,
                        weekday = excluded.weekday,
                        local_start = excluded.local_start,
                        local_end = excluded.local_end,
                        end_day_offset = excluded.end_day_offset,
                        location_kind = excluded.location_kind,
                        location_value = excluded.location_value,
                        entity_version = meeting_occurrence_overrides.entity_version + 1
                `).run(
                payload.meetingSeriesId,
                payload.originalLogicalAnchor,
                replacement.type,
                replacement.weekday,
                replacement.localStart,
                replacement.localEnd,
                replacement.endDayOffset,
                replacement.location.kind,
                replacement.location.kind === 'known' ? replacement.location.value : null,
            );
        }
        else {
            const replacement = command.intent.payload.replacement;
            const newSegmentId = randomUUID();
            const finalLogicalEndAnchor = segmentRows.at(-1)!.logical_end_anchor;
            ctx.database.prepare(`
                    DELETE FROM meeting_segments
                    WHERE meeting_series_id = ? AND logical_start_anchor > ?
                `).run(payload.meetingSeriesId, payload.originalLogicalAnchor);
            ctx.database.prepare(`
                    DELETE FROM meeting_occurrence_overrides
                    WHERE meeting_series_id = ? AND original_logical_anchor = ?
                `).run(payload.meetingSeriesId, payload.originalLogicalAnchor);
            if (payload.originalLogicalAnchor === segment.logical_start_anchor) {
                ctx.database.prepare(
                    'DELETE FROM meeting_segments WHERE meeting_segment_id = ?',
                ).run(segment.meeting_segment_id);
            }
            else {
                ctx.database.prepare(`
                        UPDATE meeting_segments
                        SET logical_end_anchor = ?
                        WHERE meeting_segment_id = ?
                    `).run(
                    addLocalDateDays(payload.originalLogicalAnchor, -7),
                    segment.meeting_segment_id,
                );
            }
            ctx.database.prepare(`
                    INSERT INTO meeting_segments (
                        meeting_segment_id,
                        meeting_series_id,
                        meeting_type,
                        weekday,
                        local_start,
                        local_end,
                        end_day_offset,
                        logical_start_anchor,
                        logical_end_anchor,
                        effective_range_kind,
                        effective_start_date,
                        effective_end_date,
                        location_kind,
                        location_value
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                newSegmentId,
                payload.meetingSeriesId,
                replacement.type,
                replacement.weekday,
                replacement.localStart,
                replacement.localEnd,
                replacement.endDayOffset,
                payload.originalLogicalAnchor,
                finalLogicalEndAnchor,
                segment.effective_range_kind,
                segment.effective_start_date,
                segment.effective_end_date,
                replacement.location.kind,
                replacement.location.kind === 'known' ? replacement.location.value : null,
            );
        }
        ctx.database.prepare(`
                UPDATE meeting_series SET entity_version = ? WHERE meeting_series_id = ?
            `).run(newSeriesVersion, payload.meetingSeriesId);
        ctx.database.prepare(`
                UPDATE plan_state SET plan_entity_version = ? WHERE singleton = 1
            `).run(newPlanVersion);
        advanceSetupMinimumMilestone(ctx.database);
        fireCommitFailpoint(options, 'commit.after-facts');

        ctx.database.prepare(
            'UPDATE workspace_state SET revision = ? WHERE singleton = 1',
        ).run(newRevision);
        fireCommitFailpoint(options, 'commit.after-revision');

        ctx.database.prepare(`
                INSERT INTO command_receipts (
                    command_id,
                    intent_kind,
                    intent_schema_version,
                    canonical_encoding,
                    digest_algorithm,
                    payload_digest,
                    committed_revision,
                    result_kind
                ) VALUES (
                    ?, ?, ?,
                    'courseflow-canonical-json-v1', 'sha256', ?, ?, 'committed'
                )
            `).run(
            command.commandId,
            command.intent.kind,
            command.intent.intentSchemaVersion,
            digest,
            newRevision,
        );
        fireCommitFailpoint(options, 'commit.after-receipt');

        ctx.database.prepare(`
                INSERT INTO receipt_effects (
                    command_id,
                    effect_order,
                    effect_code,
                    entity_kind,
                    entity_id,
                    entity_version
                ) VALUES (?, 0, ?, 'meeting-series', ?, ?)
            `).run(
            command.commandId,
            command.intent.kind === 'plan.cancel-meeting-occurrence'
                ? 'plan.meeting-occurrence-cancelled'
                : 'plan.meeting-occurrence-changed',
            payload.meetingSeriesId,
            newSeriesVersion,
        );
        ctx.database.prepare(`
                INSERT INTO durable_followups (
                    follow_up_id,
                    originating_command_id,
                    owner,
                    kind,
                    prerequisite_revision,
                    state,
                    follow_up_version
                ) VALUES (?, ?, 'protect', 'backup-needed-through', ?, 'pending', 0)
            `).run(command.followUpId, command.commandId, newRevision);
        fireCommitFailpoint(options, 'commit.after-followup');

        ctx.database.prepare(`
                UPDATE protection_watermarks
                SET backup_needed_through = ?
                WHERE singleton = 1
            `).run(newRevision);
        fireCommitFailpoint(options, 'commit.after-watermark');
        fireCommitFailpoint(options, 'commit.before-sqlite-commit');

        commitAttempted = true;
        ctx.database.exec('COMMIT');
        ctx.setRevision(newRevision);
        fireCommitFailpoint(options, 'commit.after-sqlite-commit');
        const outcome = readReceiptOutcome(ctx.database, command.commandId);
        if (!outcome) {
            throw new Error('Committed receipt outcome is missing');
        }
        return successfulCommit(outcome);
    }
    catch (error) {
        if (ctx.terminalError()) {
            throw ctx.terminalError();
        }
        if (commitAttempted) {
            throw ctx.enterTerminalState(new CommittedCommandOutcomeUnknownError(command.commandId));
        }
        ctx.rollbackOrRequireReopen();
        if (error instanceof TypeError) {
            throw error;
        }
        const disposition = classifySqliteFailure(error, 'pre-commit');
        if (disposition.kind === 'retryable-unchanged') {
            return writerBusyResult(ctx.revision());
        }
        if (disposition.kind === 'read-only') {
            ctx.markReadOnly();
            return permissionCommitResult(ctx.revision());
        }
        if (disposition.kind === 'failed-unchanged') {
            const message = disposition.reason === 'storage-full'
                ? 'Workspace data write failed: storage full'
                : 'Workspace data recovery is required';
            throw new Error(message);
        }
        throw new Error('Workspace data commit failed');
    }
}
