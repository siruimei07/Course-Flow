import { randomUUID, timingSafeEqual } from 'node:crypto';
import { digestCreateTerm, digestReconcileWorkspaceLifecycle, digestRestoreTermAsCurrent, digestUpdateTermEndDate } from '../../command-digest';
import { advanceSetupMinimumMilestone, currentVersions, readReceiptOutcome } from '../context';
import type { StoreContext } from '../context';
import { classifySqliteFailure, fireCommitFailpoint } from '../database';
import type { TermMutationCommand } from '../guards';
import { permissionCommitResult, planConflictResult, successfulCommit, writerBusyResult } from '../results';
import { CommittedCommandOutcomeUnknownError, SQLITE_INTEGER_MAX } from '../types';
import type { CommitOptions, DataCommitResult, ReceiptEffect } from '../types';
import { MeetingEffectiveRangeIntent } from '../../../shared/workspace-course-contract';
import type { CourseTeachingRangeIntent } from '../../../shared/workspace-course-contract';
import { CreateTermCommand, UpdateTermEndDateCommand, localDateInTermZone } from '../../../shared/workspace-term-contract';
import type { ReconcileWorkspaceLifecycleCommand, RestoreTermAsCurrentCommand } from '../../../shared/workspace-term-contract';
export function commitTermSynchronously(ctx: StoreContext, 
    command: CreateTermCommand,
    options: CommitOptions,
): DataCommitResult {
    const digest = digestCreateTerm(command);
    const termId = randomUUID();
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

        if (versions.revision === SQLITE_INTEGER_MAX || versions.planVersion === SQLITE_INTEGER_MAX) {
            ctx.rollbackOrRequireReopen();
            throw ctx.enterTerminalState();
        }

        const newRevision = versions.revision + 1n;
        const newPlanVersion = versions.planVersion + 1n;
        const payload = command.intent.payload;
        ctx.database.prepare(`
                INSERT INTO terms (
                    term_id,
                    name,
                    start_date,
                    end_date,
                    time_zone,
                    archived,
                    entity_version
                ) VALUES (?, ?, ?, ?, ?, 0, 1)
            `).run(termId, payload.name, payload.startDate, payload.endDate, payload.timeZone);
        ctx.database.prepare(`
                UPDATE plan_state
                SET current_term_id = ?, plan_entity_version = ?
                WHERE singleton = 1
            `).run(termId, newPlanVersion);
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
                    ?, 'plan.create-term', 1,
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
                ) VALUES (?, 0, 'plan.term-created-current', 'term', ?, 1)
            `).run(command.commandId, termId);
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

export function commitTermMutationSynchronously(ctx: StoreContext, 
    command: TermMutationCommand,
    options: CommitOptions,
): DataCommitResult {
    const digest = command.intent.kind === 'workspace.reconcile-lifecycle'
        ? digestReconcileWorkspaceLifecycle(command as ReconcileWorkspaceLifecycleCommand)
        : command.intent.kind === 'plan.update-term-end-date'
            ? digestUpdateTermEndDate(command as UpdateTermEndDateCommand)
            : digestRestoreTermAsCurrent(command as RestoreTermAsCurrentCommand);
    const effectCode: ReceiptEffect['code'] = command.intent.kind === 'workspace.reconcile-lifecycle'
        ? 'plan.term-auto-archived'
        : command.intent.kind === 'plan.update-term-end-date'
            ? 'plan.term-end-date-updated'
            : 'plan.term-restored-current';
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

        const term = ctx.database.prepare(`
                SELECT
                    terms.term_id,
                    terms.start_date,
                    terms.end_date,
                    terms.time_zone,
                    terms.archived,
                    terms.entity_version,
                    plan_state.current_term_id
                FROM terms
                JOIN plan_state ON plan_state.singleton = 1
                WHERE terms.term_id = ?
            `);
        term.setReadBigInts(true);
        const termRow = term.get(command.intent.payload.termId) as {
            term_id: string;
            start_date: string;
            end_date: string;
            time_zone: string;
            archived: bigint;
            entity_version: bigint;
            current_term_id: string | null;
        } | undefined;
        if (!termRow || termRow.entity_version !== BigInt(command.expectedTermVersion)) {
            ctx.rollbackOrRequireReopen();
            return planConflictResult('expected-entity-version', versions);
        }
        fireCommitFailpoint(options, 'commit.after-expected-versions');

        const evaluation = 'evaluation' in command
            ? command.evaluation
            : command.intent.kind === 'workspace.reconcile-lifecycle'
                ? command.intent.payload.evaluation
                : null;
        if (evaluation
            && (evaluation.termZone !== termRow.time_zone
                || localDateInTermZone(evaluation.evaluatedAt, termRow.time_zone)
                    !== evaluation.applicableDate)) {
            ctx.rollbackOrRequireReopen();
            throw new TypeError('Term evaluation no longer matches the target Term');
        }

        if (command.intent.kind === 'workspace.reconcile-lifecycle') {
            if (termRow.current_term_id !== termRow.term_id
                || termRow.archived !== 0n
                || command.intent.payload.evaluation.applicableDate <= termRow.end_date) {
                ctx.rollbackOrRequireReopen();
                throw new TypeError('Current Term is not eligible for automatic archive');
            }
        }
        else if (command.intent.kind === 'plan.update-term-end-date') {
            const newEndDate = command.intent.payload.endDate;
            if (newEndDate < termRow.start_date) {
                ctx.rollbackOrRequireReopen();
                throw new TypeError('Term end date must not precede its start date');
            }

            const strandedHolidayRange = ctx.database.prepare(`
                    SELECT holiday_range_id
                    FROM holiday_ranges
                    WHERE term_id = ? AND tombstoned = 0 AND end_date > ?
                    LIMIT 1
                `).get(termRow.term_id, newEndDate) as { holiday_range_id: string } | undefined;
            if (strandedHolidayRange) {
                ctx.rollbackOrRequireReopen();
                throw new TypeError('Corrected Term range would exclude a HolidayRange');
            }

            const courseStatement = ctx.database.prepare(`
                    SELECT
                        course_id,
                        teaching_range_kind,
                        teaching_start_date,
                        teaching_end_date
                    FROM courses
                    WHERE term_id = ?
                `);
            const courses = courseStatement.all(termRow.term_id) as Array<{
                course_id: string;
                teaching_range_kind: CourseTeachingRangeIntent['kind'];
                teaching_start_date: string | null;
                teaching_end_date: string | null;
            }>;
            const resolvedCourses = courses.map(course => ({
                courseId: course.course_id,
                startDate: course.teaching_range_kind === 'inherit-term'
                    ? termRow.start_date
                    : course.teaching_start_date!,
                endDate: course.teaching_range_kind === 'inherit-term'
                    ? newEndDate
                    : course.teaching_end_date!,
            }));
            if (resolvedCourses.some(course => (
                course.startDate < termRow.start_date || course.endDate > newEndDate
            ))) {
                ctx.rollbackOrRequireReopen();
                throw new TypeError('Corrected Term range would exclude a Course');
            }

            const meetingStatement = ctx.database.prepare(`
                    SELECT
                        meeting_series.course_id,
                        meeting_segments.effective_range_kind,
                        meeting_segments.effective_start_date,
                        meeting_segments.effective_end_date
                    FROM meeting_segments
                    JOIN meeting_series
                        ON meeting_series.meeting_series_id = meeting_segments.meeting_series_id
                    JOIN courses ON courses.course_id = meeting_series.course_id
                    WHERE courses.term_id = ?
                `);
            const meetings = meetingStatement.all(termRow.term_id) as Array<{
                course_id: string;
                effective_range_kind: MeetingEffectiveRangeIntent['kind'];
                effective_start_date: string | null;
                effective_end_date: string | null;
            }>;
            const meetingOutsideCourse = meetings.some(meeting => {
                const course = resolvedCourses.find(candidate => candidate.courseId === meeting.course_id)!;
                const startDate = meeting.effective_range_kind === 'inherit-course'
                    ? course.startDate
                    : meeting.effective_start_date!;
                const endDate = meeting.effective_range_kind === 'inherit-course'
                    ? course.endDate
                    : meeting.effective_end_date!;
                return startDate < course.startDate || endDate > course.endDate;
            });
            if (meetingOutsideCourse) {
                ctx.rollbackOrRequireReopen();
                throw new TypeError('Corrected Term range would exclude a Meeting');
            }

            const weeklyTasks = ctx.database.prepare(`
                    SELECT
                        task_series.course_id,
                        task_segments.weekly_start_date,
                        task_segments.weekly_confirmed_end_date
                    FROM task_segments
                    JOIN task_series ON task_series.task_series_id = task_segments.task_series_id
                    JOIN courses ON courses.course_id = task_series.course_id
                    WHERE courses.term_id = ?
                        AND task_segments.schedule_kind = 'weekly'
                `).all(termRow.term_id) as Array<{
                course_id: string;
                weekly_start_date: string;
                weekly_confirmed_end_date: string;
            }>;
            const taskOutsideCourse = weeklyTasks.some(task => {
                const course = resolvedCourses.find(candidate => candidate.courseId === task.course_id)!;
                return task.weekly_start_date < course.startDate
                    || task.weekly_confirmed_end_date > course.endDate;
            });
            if (taskOutsideCourse) {
                ctx.rollbackOrRequireReopen();
                throw new TypeError('Corrected Term range would exclude a weekly Task');
            }
        }
        else if (termRow.archived !== 1n
            || termRow.current_term_id !== null
            || evaluation === null
            || evaluation.applicableDate > termRow.end_date) {
            ctx.rollbackOrRequireReopen();
            throw new TypeError('Term is not eligible to restore as Current');
        }

        if (versions.revision === SQLITE_INTEGER_MAX
            || versions.planVersion === SQLITE_INTEGER_MAX
            || termRow.entity_version === SQLITE_INTEGER_MAX) {
            ctx.rollbackOrRequireReopen();
            throw ctx.enterTerminalState();
        }

        const newRevision = versions.revision + 1n;
        const newPlanVersion = versions.planVersion + 1n;
        const newTermVersion = termRow.entity_version + 1n;
        if (command.intent.kind === 'workspace.reconcile-lifecycle') {
            ctx.database.prepare(`
                    UPDATE terms SET archived = 1, entity_version = ? WHERE term_id = ?
                `).run(newTermVersion, termRow.term_id);
            ctx.database.prepare(`
                    UPDATE plan_state
                    SET current_term_id = NULL, plan_entity_version = ?
                    WHERE singleton = 1
                `).run(newPlanVersion);
        }
        else if (command.intent.kind === 'plan.update-term-end-date') {
            ctx.database.prepare(`
                    UPDATE terms SET end_date = ?, entity_version = ? WHERE term_id = ?
                `).run(command.intent.payload.endDate, newTermVersion, termRow.term_id);
            ctx.database.prepare(`
                    UPDATE plan_state SET plan_entity_version = ? WHERE singleton = 1
                `).run(newPlanVersion);
        }
        else {
            ctx.database.prepare(`
                    UPDATE terms SET archived = 0, entity_version = ? WHERE term_id = ?
                `).run(newTermVersion, termRow.term_id);
            ctx.database.prepare(`
                    UPDATE plan_state
                    SET current_term_id = ?, plan_entity_version = ?
                    WHERE singleton = 1
                `).run(termRow.term_id, newPlanVersion);
        }
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
                ) VALUES (?, ?, 1, 'courseflow-canonical-json-v1', 'sha256', ?, ?, 'committed')
            `).run(command.commandId, command.intent.kind, digest, newRevision);
        fireCommitFailpoint(options, 'commit.after-receipt');

        ctx.database.prepare(`
                INSERT INTO receipt_effects (
                    command_id,
                    effect_order,
                    effect_code,
                    entity_kind,
                    entity_id,
                    entity_version
                ) VALUES (?, 0, ?, 'term', ?, ?)
            `).run(command.commandId, effectCode, termRow.term_id, newTermVersion);
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
