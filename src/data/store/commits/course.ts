import { randomUUID, timingSafeEqual } from 'node:crypto';
import { digestCreateCourse, digestCreateCourseWithMeeting } from '../../command-digest';
import { readActiveHolidayRanges, readConflictMeetingOccurrences } from '../conflict-reads';
import { advanceSetupMinimumMilestone, currentVersions, readReceiptOutcome } from '../context';
import type { StoreContext } from '../context';
import { classifySqliteFailure, decimalToCoefficient, fireCommitFailpoint } from '../database';
import { isCurrentCourseWithMeetingCommand } from '../guards';
import { meetingOverlapDecisionRequiredResult, permissionCommitResult, planConflictResult, successfulCommit, writerBusyResult } from '../results';
import { CommittedCommandOutcomeUnknownError, SQLITE_INTEGER_MAX } from '../types';
import type { CommitOptions, DataCommitResult } from '../types';
import { firstWeeklyLogicalAnchor } from '../../../plan/anchors';
import { addClampedLocalDateDays } from '../../../plan/local-date';
import { expandConflictMeetingOccurrences } from '../../../plan/meeting-occurrences';
import { meetingOverlapWarnings } from '../../../plan/meeting-overlap';
import { AcceptedCreateCourseWithMeetingCommand, CreateCourseCommand } from '../../../shared/workspace-course-contract';
export function commitCourseSynchronously(ctx: StoreContext, 
    command: CreateCourseCommand,
    options: CommitOptions,
): DataCommitResult {
    const digest = digestCreateCourse(command);
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
        fireCommitFailpoint(options, 'commit.after-expected-versions');

        const term = ctx.database.prepare(`
                SELECT terms.term_id, terms.start_date, terms.end_date
                FROM plan_state
                JOIN terms ON terms.term_id = plan_state.current_term_id
                WHERE plan_state.singleton = 1
            `).get() as {
            term_id: string;
            start_date: string;
            end_date: string;
        } | undefined;
        if (!term) {
            ctx.rollbackOrRequireReopen();
            throw new TypeError('Course requires a Current Term');
        }
        const course = command.intent.payload.course;
        const teachingStartDate = course.teachingRange.kind === 'inherit-term'
            ? term.start_date
            : course.teachingRange.startDate;
        const teachingEndDate = course.teachingRange.kind === 'inherit-term'
            ? term.end_date
            : course.teachingRange.endDate;
        if (teachingStartDate < term.start_date || teachingEndDate > term.end_date) {
            ctx.rollbackOrRequireReopen();
            throw new TypeError('Course range must remain inside its Current Term');
        }
        if (versions.revision === SQLITE_INTEGER_MAX || versions.planVersion === SQLITE_INTEGER_MAX) {
            ctx.rollbackOrRequireReopen();
            throw ctx.enterTerminalState();
        }

        const newRevision = versions.revision + 1n;
        const newPlanVersion = versions.planVersion + 1n;
        const courseId = randomUUID();
        const [creditsCoefficient, creditsScale] = decimalToCoefficient(course.credits);
        ctx.database.prepare(`
                INSERT INTO courses (
                    course_id,
                    term_id,
                    code,
                    name,
                    section,
                    instructor,
                    color,
                    credits_coefficient,
                    credits_scale,
                    teaching_range_kind,
                    teaching_start_date,
                    teaching_end_date,
                    archived,
                    entity_version
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)
            `).run(
            courseId,
            term.term_id,
            course.code,
            course.name,
            course.section,
            course.instructor,
            course.color,
            creditsCoefficient,
            creditsScale,
            course.teachingRange.kind,
            course.teachingRange.kind === 'explicit' ? course.teachingRange.startDate : null,
            course.teachingRange.kind === 'explicit' ? course.teachingRange.endDate : null,
        );
        ctx.database.prepare(`
                UPDATE plan_state
                SET plan_entity_version = ?
                WHERE singleton = 1
            `).run(newPlanVersion);
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
                    ?, 'plan.create-course', 1,
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
                ) VALUES (?, 0, 'plan.course-created', 'course', ?, 1)
            `).run(command.commandId, courseId);
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

export function commitCourseWithMeetingSynchronously(ctx: StoreContext, 
    command: AcceptedCreateCourseWithMeetingCommand,
    options: CommitOptions,
): DataCommitResult {
    const digest = digestCreateCourseWithMeeting(command);
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
        if (!isCurrentCourseWithMeetingCommand(command)) {
            ctx.rollbackOrRequireReopen();
            throw new TypeError('Legacy Course commands are replay-only');
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
        fireCommitFailpoint(options, 'commit.after-expected-versions');

        const term = ctx.database.prepare(`
                SELECT terms.term_id, terms.start_date, terms.end_date, terms.time_zone
                FROM plan_state
                JOIN terms ON terms.term_id = plan_state.current_term_id
                WHERE plan_state.singleton = 1
            `).get() as {
            term_id: string;
            start_date: string;
            end_date: string;
            time_zone: string;
        } | undefined;
        const payload = command.intent.payload;
        if (!term) {
            ctx.rollbackOrRequireReopen();
            throw new TypeError('Course requires a Current Term');
        }
        const teachingStartDate = payload.course.teachingRange.kind === 'inherit-term'
            ? term.start_date
            : payload.course.teachingRange.startDate;
        const teachingEndDate = payload.course.teachingRange.kind === 'inherit-term'
            ? term.end_date
            : payload.course.teachingRange.endDate;
        const effectiveStartDate = payload.meeting.effectiveRange.kind === 'inherit-course'
            ? teachingStartDate
            : payload.meeting.effectiveRange.startDate;
        const effectiveEndDate = payload.meeting.effectiveRange.kind === 'inherit-course'
            ? teachingEndDate
            : payload.meeting.effectiveRange.endDate;
        if (teachingStartDate < term.start_date
            || teachingEndDate > term.end_date
            || effectiveStartDate < teachingStartDate
            || effectiveEndDate > teachingEndDate) {
            ctx.rollbackOrRequireReopen();
            throw new TypeError('Course and Meeting ranges must remain inside their owners');
        }
        const logicalStartAnchor = firstWeeklyLogicalAnchor(
            effectiveStartDate,
            payload.meeting.weekday,
        );
        const proposedOccurrences = expandConflictMeetingOccurrences(
            Object.freeze({
                courseId: null,
                courseCode: payload.course.code,
                meetingSeriesId: null,
            }),
            term.time_zone,
            [Object.freeze({
                meeting_segment_id: command.commandId,
                meeting_type: payload.meeting.type,
                weekday: payload.meeting.weekday,
                local_start: payload.meeting.localStart,
                local_end: payload.meeting.localEnd,
                end_day_offset: payload.meeting.endDayOffset,
                logical_start_anchor: logicalStartAnchor,
                logical_end_anchor: null,
                effective_range_kind: payload.meeting.effectiveRange.kind,
                effective_start_date: payload.meeting.effectiveRange.kind === 'explicit'
                    ? payload.meeting.effectiveRange.startDate
                    : null,
                effective_end_date: payload.meeting.effectiveRange.kind === 'explicit'
                    ? payload.meeting.effectiveRange.endDate
                    : null,
                resolved_start_date: effectiveStartDate,
                resolved_end_date: effectiveEndDate,
                location_kind: payload.meeting.location.kind,
                location_value: payload.meeting.location.kind === 'known'
                    ? payload.meeting.location.value
                    : null,
            })],
            [],
            readActiveHolidayRanges(ctx.database, term.term_id),
            Object.freeze({ startDate: effectiveStartDate, endDate: effectiveEndDate }),
        );
        const overlapWindow = Object.freeze({
            startDate: addClampedLocalDateDays(effectiveStartDate, -3),
            endDate: addClampedLocalDateDays(effectiveEndDate, 3),
        });
        const overlapWarnings = meetingOverlapWarnings(
            command.commandId,
            proposedOccurrences,
            readConflictMeetingOccurrences(ctx.database, overlapWindow, term.term_id),
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
        const courseId = randomUUID();
        const meetingSeriesId = randomUUID();
        const meetingSegmentId = randomUUID();
        const [creditsCoefficient, creditsScale] = decimalToCoefficient(payload.course.credits);
        ctx.database.prepare(`
                INSERT INTO courses (
                    course_id,
                    term_id,
                    code,
                    name,
                    section,
                    instructor,
                    color,
                    credits_coefficient,
                    credits_scale,
                    teaching_range_kind,
                    teaching_start_date,
                    teaching_end_date,
                    archived,
                    entity_version
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)
            `).run(
            courseId,
            term.term_id,
            payload.course.code,
            payload.course.name,
            payload.course.section,
            payload.course.instructor,
            payload.course.color,
            creditsCoefficient,
            creditsScale,
            payload.course.teachingRange.kind,
            payload.course.teachingRange.kind === 'explicit'
                ? payload.course.teachingRange.startDate
                : null,
            payload.course.teachingRange.kind === 'explicit'
                ? payload.course.teachingRange.endDate
                : null,
        );
        ctx.database.prepare(`
                INSERT INTO meeting_series (
                    meeting_series_id,
                    course_id,
                    retired,
                    entity_version
                ) VALUES (?, ?, 0, 1)
            `).run(meetingSeriesId, courseId);
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
            payload.meeting.type,
            payload.meeting.weekday,
            payload.meeting.localStart,
            payload.meeting.localEnd,
            payload.meeting.endDayOffset,
            logicalStartAnchor,
            null,
            payload.meeting.effectiveRange.kind,
            payload.meeting.effectiveRange.kind === 'explicit'
                ? payload.meeting.effectiveRange.startDate
                : null,
            payload.meeting.effectiveRange.kind === 'explicit'
                ? payload.meeting.effectiveRange.endDate
                : null,
            payload.meeting.location.kind,
            payload.meeting.location.kind === 'known' ? payload.meeting.location.value : null,
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
                    ?, 'plan.create-course-with-first-meeting', 3,
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
                ) VALUES
                    (?, 0, 'plan.course-created', 'course', ?, 1),
                    (?, 1, 'plan.meeting-series-created', 'meeting-series', ?, 1)
            `).run(command.commandId, courseId, command.commandId, meetingSeriesId);
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
