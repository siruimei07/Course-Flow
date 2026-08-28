/**
 * Commits one bounded Task lifecycle transition and its durable receipt atomically.
 * @param {TaskSeriesMutationCommand} command - Normalized Task series command.
 * @param {CommitOptions} options - Transaction failpoint controls used by tests.
 * @return {DataCommitResult} Committed receipt or unchanged structured problem.
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { digestChangeTaskOccurrence, digestCompleteTask, digestCreateTask, digestDeleteTask, digestDeleteTaskOccurrenceOrSeries, digestSetTaskOccurrenceStatus, digestSetTaskProgress, digestUndoTaskOccurrenceState, digestUpdateTask } from '../../command-digest';
import { advanceSetupMinimumMilestone, currentVersions, readReceiptOutcome } from '../context';
import type { StoreContext } from '../context';
import { classifySqliteFailure, fireCommitFailpoint } from '../database';
import type { TaskOccurrenceRuleMutationCommand, TaskOccurrenceStateMutationCommand, TaskSeriesMutationCommand } from '../guards';
import { decisionRequiredResult, permissionCommitResult, planConflictResult, successfulCommit, taskSeriesConflictResult, writerBusyResult } from '../results';
import { CommittedCommandOutcomeUnknownError, SQLITE_INTEGER_MAX } from '../types';
import type { CommitOptions, DataCommitResult, ReceiptEffect } from '../types';
import { firstTaskWeeklyAnchor, lastTaskWeeklyAnchor, occurrenceDate } from '../../../plan/anchors';
import { taskOccurrenceConfirmationToken } from '../../../plan/confirmation-tokens';
import { addLocalDateDays } from '../../../plan/local-date';
import { StoredTaskOccurrenceOverride, StoredTaskOccurrenceState, StoredTaskSegment, taskDeadlineColumns, taskLogicalAnchors, taskOverrideReplacement, taskSchedule, taskScheduleColumns, taskSegmentForAnchor, taskSegmentOccurrenceDeadline } from '../../../plan/task-schedule';
import { INTL_ZONE_RULES, isCanonicalInstant } from '../../../shared/meeting-time';
import { ChangeTaskOccurrenceCommand, CompleteTaskCommand, CreateTaskCommand, DeleteTaskCommand, DeleteTaskOccurrenceOrSeriesCommand, SetTaskOccurrenceStatusCommand, SetTaskProgressCommand, TaskOccurrenceImpactDraft, TaskOccurrenceReplacement, TaskOccurrenceStatus, TaskSchedule, UndoTaskOccurrenceStateCommand, UpdateTaskCommand } from '../../../shared/workspace-task-contract';
export function commitTaskSynchronously(ctx: StoreContext, 
    command: TaskSeriesMutationCommand,
    options: CommitOptions,
): DataCommitResult {
    const digest = command.intent.kind === 'plan.create-task-series'
        ? digestCreateTask(command as CreateTaskCommand)
        : command.intent.kind === 'plan.update-task-series'
            ? digestUpdateTask(command as UpdateTaskCommand)
            : digestDeleteTask(command as DeleteTaskCommand);
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

        const existing = command.intent.kind === 'plan.create-task-series'
            ? undefined
            : (() => {
                const statement = ctx.database.prepare(`
                        SELECT
                            task_series.course_id,
                            task_series.retired,
                            task_series.entity_version,
                            (
                                SELECT schedule_kind
                                FROM task_segments
                                WHERE task_segments.task_series_id = task_series.task_series_id
                                ORDER BY logical_start_anchor, task_segment_id
                                LIMIT 1
                            ) AS schedule_kind,
                            (
                                SELECT status
                                FROM task_occurrence_states
                                WHERE task_occurrence_states.task_series_id = task_series.task_series_id
                                    AND task_occurrence_states.original_logical_anchor = 'once'
                            ) AS status,
                            (
                                SELECT count(*)
                                FROM task_segments
                                WHERE task_segments.task_series_id = task_series.task_series_id
                            ) AS segment_count,
                            (
                                SELECT count(*)
                                FROM task_occurrence_states
                                WHERE task_occurrence_states.task_series_id = task_series.task_series_id
                            ) AS state_count,
                            (
                                SELECT count(*)
                                FROM task_occurrence_overrides
                                WHERE task_occurrence_overrides.task_series_id = task_series.task_series_id
                            ) AS override_count
                        FROM task_series
                        WHERE task_series.task_series_id = ?
                    `);
                statement.setReadBigInts(true);
                return statement.get(command.intent.payload.taskSeriesId) as {
                    course_id: string;
                    retired: bigint;
                    entity_version: bigint;
                    schedule_kind: TaskSchedule['kind'];
                    status: TaskOccurrenceStatus | null;
                    segment_count: bigint;
                    state_count: bigint;
                    override_count: bigint;
                } | undefined;
            })();
        if (command.intent.kind !== 'plan.create-task-series') {
            const mutation = command as UpdateTaskCommand | DeleteTaskCommand;
            if (!existing || existing.retired !== 0n) {
                ctx.rollbackOrRequireReopen();
                throw new TypeError('Task series is not editable');
            }
            if (existing.entity_version !== BigInt(mutation.expectedTaskSeriesVersion)) {
                ctx.rollbackOrRequireReopen();
                return taskSeriesConflictResult(
                    versions,
                    command.intent.payload.taskSeriesId,
                    existing.entity_version,
                );
            }
        }
        fireCommitFailpoint(options, 'commit.after-expected-versions');

        if (command.intent.kind === 'plan.delete-task-series') {
            ctx.rollbackOrRequireReopen();
            return decisionRequiredResult(versions.revision);
        }

        const courseId = command.intent.kind === 'plan.create-task-series'
            || command.intent.kind === 'plan.update-task-series'
            ? command.intent.payload.courseId
            : existing!.course_id;
        const sourceCourseId = existing?.course_id ?? courseId;
        const courseStatement = ctx.database.prepare(`
                SELECT count(*) AS count
                FROM courses
                JOIN terms ON terms.term_id = courses.term_id
                JOIN plan_state ON plan_state.singleton = 1
                WHERE courses.course_id IN (?, ?)
                    AND courses.archived = 0
                    AND terms.archived = 0
                    AND plan_state.current_term_id = courses.term_id
            `);
        courseStatement.setReadBigInts(true);
        const activeCurrentCourseCount = (courseStatement.get(courseId, sourceCourseId) as {
            count: bigint;
        }).count;
        const requiredCourseCount = courseId === sourceCourseId ? 1n : 2n;
        if (activeCurrentCourseCount !== requiredCourseCount) {
            ctx.rollbackOrRequireReopen();
            throw new TypeError('Task requires an active Current Term Course');
        }
        const proposedSchedule = command.intent.kind === 'plan.create-task-series'
            || command.intent.kind === 'plan.update-task-series'
            ? taskSchedule(command.intent.payload)
            : null;
        if (command.intent.kind === 'plan.update-task-series'
            && existing!.schedule_kind === 'once'
            && proposedSchedule!.kind === 'weekly'
            && existing!.status !== null) {
            ctx.rollbackOrRequireReopen();
            throw new TypeError('Completed once Task cannot become weekly without preserving instance state');
        }
        if (command.intent.kind === 'plan.update-task-series'
            && (existing!.segment_count !== 1n
                || existing!.state_count !== 0n
                || existing!.override_count !== 0n)) {
            ctx.rollbackOrRequireReopen();
            throw new TypeError('Task history requires scoped occurrence editing');
        }
        if (proposedSchedule?.kind === 'weekly') {
            const courseRange = ctx.database.prepare(`
                    SELECT
                        CASE
                            WHEN courses.teaching_range_kind = 'explicit'
                                THEN courses.teaching_start_date
                            ELSE terms.start_date
                        END AS teaching_start_date,
                        CASE
                            WHEN courses.teaching_range_kind = 'explicit'
                                THEN courses.teaching_end_date
                            ELSE terms.end_date
                        END AS teaching_end_date,
                        terms.time_zone AS term_zone
                    FROM courses
                    JOIN terms ON terms.term_id = courses.term_id
                    WHERE courses.course_id = ?
                `).get(courseId) as {
                teaching_start_date: string;
                teaching_end_date: string;
                term_zone: string;
            };
            const firstAnchor = firstTaskWeeklyAnchor(
                proposedSchedule.startDate,
                proposedSchedule.weekday,
            );
            if (proposedSchedule.startDate < courseRange.teaching_start_date
                || proposedSchedule.confirmedEndDate > courseRange.teaching_end_date
                || firstAnchor === null
                || firstAnchor > proposedSchedule.confirmedEndDate) {
                ctx.rollbackOrRequireReopen();
                throw new TypeError('Weekly Task range must produce an occurrence inside the Course range');
            }
            const lastAnchor = lastTaskWeeklyAnchor(
                proposedSchedule.confirmedEndDate,
                proposedSchedule.weekday,
            );
            const boundaryInstants = [firstAnchor, lastAnchor].map(anchor => (
                INTL_ZONE_RULES.resolveInstant(
                    courseRange.term_zone,
                    anchor,
                    proposedSchedule.localDeadlineTime,
                )
            ));
            if (!boundaryInstants.every(isCanonicalInstant)) {
                ctx.rollbackOrRequireReopen();
                throw new TypeError('Weekly Task deadline must resolve to canonical Instants');
            }
        }

        const existingVersion = existing?.entity_version ?? 0n;
        if (versions.revision === SQLITE_INTEGER_MAX
            || versions.planVersion === SQLITE_INTEGER_MAX
            || existingVersion === SQLITE_INTEGER_MAX) {
            ctx.rollbackOrRequireReopen();
            throw ctx.enterTerminalState();
        }

        const taskSeriesId = command.intent.kind === 'plan.create-task-series'
            ? randomUUID()
            : command.intent.payload.taskSeriesId;
        const newRevision = versions.revision + 1n;
        const newPlanVersion = versions.planVersion + 1n;
        const newTaskSeriesVersion = existingVersion + 1n;
        if (command.intent.kind === 'plan.create-task-series') {
            const taskRule = taskSchedule(command.intent.payload);
            const schedule = taskScheduleColumns(taskRule);
            const logicalAnchors = taskLogicalAnchors(taskRule);
            ctx.database.prepare(`
                    INSERT INTO task_series (
                        task_series_id,
                        course_id,
                        retired,
                        entity_version
                    ) VALUES (?, ?, 0, 1)
                `).run(taskSeriesId, courseId);
            ctx.database.prepare(`
                    INSERT INTO task_segments (
                        task_segment_id,
                        task_series_id,
                        title,
                        task_size,
                        schedule_kind,
                        deadline_kind,
                        deadline_date,
                        deadline_instant,
                        deadline_display_zone,
                        weekly_start_date,
                        weekly_weekday,
                        weekly_local_deadline_time,
                        weekly_confirmed_end_date,
                        follow_teaching_week,
                        logical_start_anchor,
                        logical_end_anchor
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                randomUUID(),
                taskSeriesId,
                command.intent.payload.title,
                command.intent.payload.size,
                ...schedule,
                ...logicalAnchors,
            );
        }
        else if (command.intent.kind === 'plan.update-task-series') {
            const taskRule = taskSchedule(command.intent.payload);
            const schedule = taskScheduleColumns(taskRule);
            const logicalAnchors = taskLogicalAnchors(taskRule);
            ctx.database.prepare(`
                    UPDATE task_series
                    SET course_id = ?, entity_version = ?
                    WHERE task_series_id = ? AND retired = 0
                `).run(courseId, newTaskSeriesVersion, taskSeriesId);
            ctx.database.prepare(`
                    UPDATE task_segments
                    SET
                        title = ?,
                        task_size = ?,
                        schedule_kind = ?,
                        deadline_kind = ?,
                        deadline_date = ?,
                        deadline_instant = ?,
                        deadline_display_zone = ?,
                        weekly_start_date = ?,
                        weekly_weekday = ?,
                        weekly_local_deadline_time = ?,
                        weekly_confirmed_end_date = ?,
                        follow_teaching_week = ?,
                        logical_start_anchor = ?,
                        logical_end_anchor = ?
                    WHERE task_series_id = ?
                `).run(
                command.intent.payload.title,
                command.intent.payload.size,
                ...schedule,
                ...logicalAnchors,
                taskSeriesId,
            );
        }
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
                ) VALUES (?, ?, ?, 'courseflow-canonical-json-v1', 'sha256', ?, ?, 'committed')
            `).run(
            command.commandId,
            command.intent.kind,
            command.intent.intentSchemaVersion,
            digest,
            newRevision,
        );
        fireCommitFailpoint(options, 'commit.after-receipt');

        const effectCode: ReceiptEffect['code'] = command.intent.kind === 'plan.create-task-series'
            ? 'plan.task-series-created'
            : 'plan.task-series-updated';
        ctx.database.prepare(`
                INSERT INTO receipt_effects (
                    command_id,
                    effect_order,
                    effect_code,
                    entity_kind,
                    entity_id,
                    entity_version
                ) VALUES (?, 0, ?, 'task-series', ?, ?)
            `).run(command.commandId, effectCode, taskSeriesId, newTaskSeriesVersion);
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
 * Commits one independent Task occurrence state/progress transition or formal Undo.
 * @param {TaskOccurrenceStateMutationCommand} command - Canonical state mutation.
 * @param {CommitOptions} options - Transaction failpoint controls used by tests.
 * @return {DataCommitResult} Committed receipt or unchanged structured problem.
 */
export function commitTaskOccurrenceStateSynchronously(ctx: StoreContext, 
    command: TaskOccurrenceStateMutationCommand,
    options: CommitOptions,
): DataCommitResult {
    const digest = command.intent.kind === 'plan.set-task-progress'
        ? digestSetTaskProgress(command as SetTaskProgressCommand)
        : command.intent.kind === 'plan.undo-task-occurrence-state'
            ? digestUndoTaskOccurrenceState(command as UndoTaskOccurrenceStateCommand)
            : command.intent.intentSchemaVersion === 1
                ? digestCompleteTask(command as CompleteTaskCommand)
                : digestSetTaskOccurrenceStatus(command as SetTaskOccurrenceStatusCommand);
    let commitAttempted = false;

    try {
        ctx.database.exec('BEGIN IMMEDIATE');
        fireCommitFailpoint(options, 'commit.after-begin');
        const receipt = ctx.database.prepare(`
                SELECT payload_digest FROM command_receipts WHERE command_id = ?
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
                throw new Error('Stored Task occurrence receipt is incomplete');
            }
            return successfulCommit(outcome);
        }

        const versions = currentVersions(ctx.database);
        const payload = command.intent.payload;
        const seriesStatement = ctx.database.prepare(`
                SELECT retired, entity_version
                FROM task_series
                WHERE task_series_id = ?
            `);
        seriesStatement.setReadBigInts(true);
        const series = seriesStatement.get(payload.taskSeriesId) as {
            retired: bigint;
            entity_version: bigint;
        } | undefined;
        if (!series || series.retired !== 0n) {
            ctx.rollbackOrRequireReopen();
            throw new TypeError('Task series is not editable');
        }
        if (versions.revision !== BigInt(command.expectedRevision)) {
            ctx.rollbackOrRequireReopen();
            return planConflictResult('expected-revision', versions);
        }
        if (versions.planVersion !== BigInt(command.expectedPlanVersion)) {
            ctx.rollbackOrRequireReopen();
            return planConflictResult('expected-entity-version', versions);
        }
        if (series.entity_version !== BigInt(command.expectedTaskSeriesVersion)) {
            ctx.rollbackOrRequireReopen();
            return taskSeriesConflictResult(versions, payload.taskSeriesId, series.entity_version);
        }
        fireCommitFailpoint(options, 'commit.after-expected-versions');

        const segmentStatement = ctx.database.prepare(`
                SELECT
                    task_segment_id,
                    title,
                    task_size,
                    schedule_kind,
                    deadline_kind,
                    deadline_date,
                    deadline_instant,
                    deadline_display_zone,
                    logical_start_anchor,
                    logical_end_anchor,
                    weekly_start_date,
                    weekly_weekday,
                    weekly_local_deadline_time,
                    weekly_confirmed_end_date,
                    follow_teaching_week
                FROM task_segments
                WHERE task_series_id = ?
                ORDER BY logical_start_anchor, task_segment_id
            `);
        segmentStatement.setReadBigInts(true);
        const segments = segmentStatement.all(payload.taskSeriesId) as StoredTaskSegment[];
        const segment = taskSegmentForAnchor(segments, payload.originalLogicalAnchor);
        const overrideStatement = ctx.database.prepare(`
                SELECT
                    original_logical_anchor,
                    override_kind,
                    replacement_title,
                    replacement_task_size,
                    replacement_deadline_kind,
                    replacement_deadline_date,
                    replacement_deadline_instant,
                    replacement_deadline_display_zone,
                    entity_version
                FROM task_occurrence_overrides
                WHERE task_series_id = ? AND original_logical_anchor = ?
            `);
        overrideStatement.setReadBigInts(true);
        const override = overrideStatement.get(
            payload.taskSeriesId,
            payload.originalLogicalAnchor,
        ) as StoredTaskOccurrenceOverride | undefined;
        if (!segment || override?.override_kind === 'deleted') {
            ctx.rollbackOrRequireReopen();
            throw new TypeError('Task occurrence is not active');
        }
        const effectiveSize = override?.override_kind === 'replaced'
            ? override.replacement_task_size!
            : segment.task_size;
        const stateStatement = ctx.database.prepare(`
                SELECT
                    original_logical_anchor,
                    status,
                    self_reported_progress,
                    entity_version
                FROM task_occurrence_states
                WHERE task_series_id = ? AND original_logical_anchor = ?
            `);
        stateStatement.setReadBigInts(true);
        const state = stateStatement.get(
            payload.taskSeriesId,
            payload.originalLogicalAnchor,
        ) as StoredTaskOccurrenceState | undefined;
        const currentStatus = state?.status ?? 'pending';
        const currentProgress = state?.self_reported_progress ?? null;
        const currentStateVersion = state?.entity_version ?? 0n;
        if (versions.revision === SQLITE_INTEGER_MAX
            || versions.planVersion === SQLITE_INTEGER_MAX
            || series.entity_version === SQLITE_INTEGER_MAX
            || currentStateVersion === SQLITE_INTEGER_MAX) {
            ctx.rollbackOrRequireReopen();
            throw ctx.enterTerminalState();
        }

        const newRevision = versions.revision + 1n;
        const newPlanVersion = versions.planVersion + 1n;
        const newSeriesVersion = series.entity_version + 1n;
        const newStateVersion = currentStateVersion + 1n;
        let undoToken: string | null = null;
        let effectCode: ReceiptEffect['code'];
        if (command.intent.kind === 'plan.undo-task-occurrence-state') {
            const undoPayload = (command as UndoTaskOccurrenceStateCommand).intent.payload;
            const historyStatement = ctx.database.prepare(`
                    SELECT
                        task_state_history.before_row_present,
                        task_state_history.before_status,
                        task_state_history.before_self_reported_progress,
                        task_state_history.after_state_version,
                        task_state_history.consumed,
                        receipt_effects.entity_version AS valid_through_task_series_version
                    FROM task_state_history
                    JOIN receipt_effects
                        ON receipt_effects.command_id = task_state_history.originating_command_id
                        AND receipt_effects.effect_order = 0
                        AND receipt_effects.entity_kind = 'task-series'
                        AND receipt_effects.entity_id = task_state_history.task_series_id
                    WHERE task_state_history.undo_token = ?
                        AND task_state_history.task_series_id = ?
                        AND task_state_history.original_logical_anchor = ?
                `);
            historyStatement.setReadBigInts(true);
            const history = historyStatement.get(
                undoPayload.token,
                payload.taskSeriesId,
                payload.originalLogicalAnchor,
            ) as {
                before_row_present: bigint;
                before_status: TaskOccurrenceStatus | null;
                before_self_reported_progress: bigint | null;
                after_state_version: bigint;
                consumed: bigint;
                valid_through_task_series_version: bigint;
            } | undefined;
            if (!history
                || history.consumed !== 0n
                || series.entity_version !== history.valid_through_task_series_version
                || !state
                || state.entity_version !== history.after_state_version) {
                ctx.rollbackOrRequireReopen();
                return taskSeriesConflictResult(versions, payload.taskSeriesId, series.entity_version);
            }
            if (history.before_row_present === 0n) {
                ctx.database.prepare(`
                        DELETE FROM task_occurrence_states
                        WHERE task_series_id = ? AND original_logical_anchor = ?
                    `).run(payload.taskSeriesId, payload.originalLogicalAnchor);
            }
            else {
                ctx.database.prepare(`
                        UPDATE task_occurrence_states
                        SET status = ?, self_reported_progress = ?, entity_version = ?
                        WHERE task_series_id = ? AND original_logical_anchor = ?
                    `).run(
                    history.before_status,
                    history.before_self_reported_progress,
                    newStateVersion,
                    payload.taskSeriesId,
                    payload.originalLogicalAnchor,
                );
            }
            ctx.database.prepare(`
                    UPDATE task_state_history SET consumed = 1 WHERE undo_token = ?
                `).run(undoPayload.token);
            effectCode = 'plan.task-occurrence-state-undone';
        }
        else {
            let nextStatus = currentStatus;
            let nextProgress = currentProgress;
            if (command.intent.kind === 'plan.set-task-progress') {
                if (effectiveSize !== 'large' || currentStatus !== 'pending') {
                    ctx.rollbackOrRequireReopen();
                    throw new TypeError('Progress applies only to a pending large Task occurrence');
                }
                nextProgress = command.intent.payload.reportedProgress === null
                    ? null
                    : BigInt(command.intent.payload.reportedProgress);
                if (nextProgress === currentProgress) {
                    ctx.rollbackOrRequireReopen();
                    throw new TypeError('Task progress is already set to the requested value');
                }
                effectCode = 'plan.task-progress-set';
            }
            else {
                nextStatus = command.intent.payload.status;
                if (nextStatus === currentStatus) {
                    ctx.rollbackOrRequireReopen();
                    throw new TypeError('Task occurrence already has the requested status');
                }
                effectCode = command.intent.intentSchemaVersion === 1
                    ? 'plan.task-occurrence-completed'
                    : 'plan.task-occurrence-status-set';
            }
            ctx.database.prepare(`
                    INSERT INTO task_occurrence_states (
                        task_series_id,
                        original_logical_anchor,
                        status,
                        self_reported_progress,
                        entity_version
                    ) VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT (task_series_id, original_logical_anchor) DO UPDATE SET
                        status = excluded.status,
                        self_reported_progress = excluded.self_reported_progress,
                        entity_version = excluded.entity_version
                `).run(
                payload.taskSeriesId,
                payload.originalLogicalAnchor,
                nextStatus,
                nextProgress,
                newStateVersion,
            );
            undoToken = createHash('sha256').update(randomUUID(), 'utf8').digest('hex');
        }
        ctx.database.prepare(`
                UPDATE task_series SET entity_version = ? WHERE task_series_id = ?
            `).run(newSeriesVersion, payload.taskSeriesId);
        ctx.database.prepare(`
                UPDATE plan_state SET plan_entity_version = ? WHERE singleton = 1
            `).run(newPlanVersion);
        fireCommitFailpoint(options, 'commit.after-facts');

        ctx.database.prepare(`
                UPDATE workspace_state SET revision = ? WHERE singleton = 1
            `).run(newRevision);
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
                ) VALUES (?, ?, ?, 'courseflow-canonical-json-v1', 'sha256', ?, ?, 'committed')
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
                ) VALUES (?, 0, ?, 'task-series', ?, ?)
            `).run(command.commandId, effectCode, payload.taskSeriesId, newSeriesVersion);
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
        if (undoToken !== null) {
            ctx.database.prepare(`
                    INSERT INTO task_state_history (
                        undo_token,
                        originating_command_id,
                        task_series_id,
                        original_logical_anchor,
                        before_row_present,
                        before_status,
                        before_self_reported_progress,
                        after_state_version,
                        consumed
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
                `).run(
                undoToken,
                command.commandId,
                payload.taskSeriesId,
                payload.originalLogicalAnchor,
                state ? 1 : 0,
                state?.status ?? null,
                state?.self_reported_progress ?? null,
                newStateVersion,
            );
        }
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
        if (!outcome || (undoToken !== null && outcome.undoCapability?.token !== undoToken)) {
            throw new Error('Committed Task occurrence receipt outcome is missing');
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
 * Commits one scoped Task occurrence/rule mutation and its receipt atomically.
 * @param {TaskOccurrenceRuleMutationCommand} command - Canonical scoped Task mutation.
 * @param {CommitOptions} options - Transaction failpoint controls used by tests.
 * @return {DataCommitResult} Committed receipt or unchanged structured problem.
 */
export function commitTaskOccurrenceRuleSynchronously(ctx: StoreContext, 
    command: TaskOccurrenceRuleMutationCommand,
    options: CommitOptions,
): DataCommitResult {
    const changeCommand = command.intent.kind === 'plan.change-task-occurrence'
        ? command as ChangeTaskOccurrenceCommand
        : null;
    const deleteCommand = changeCommand === null
        ? command as DeleteTaskOccurrenceOrSeriesCommand
        : null;
    const digest = changeCommand
        ? digestChangeTaskOccurrence(changeCommand)
        : digestDeleteTaskOccurrenceOrSeries(deleteCommand!);
    let commitAttempted = false;

    try {
        ctx.database.exec('BEGIN IMMEDIATE');
        fireCommitFailpoint(options, 'commit.after-begin');
        const receipt = ctx.database.prepare(`
                SELECT payload_digest FROM command_receipts WHERE command_id = ?
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
                throw new Error('Stored Task occurrence rule receipt is incomplete');
            }
            return successfulCommit(outcome);
        }

        const versions = currentVersions(ctx.database);
        const payload = command.intent.payload;
        const taskSeriesId = payload.taskSeriesId;
        const scope = payload.scope;
        const originalLogicalAnchor = scope === 'whole-series'
            ? null
            : (payload as { originalLogicalAnchor: string }).originalLogicalAnchor;
        const seriesStatement = ctx.database.prepare(`
                SELECT
                    task_series.entity_version,
                    task_series.retired,
                    terms.time_zone,
                    CASE courses.teaching_range_kind
                        WHEN 'explicit' THEN courses.teaching_start_date
                        ELSE terms.start_date
                    END AS teaching_start_date,
                    CASE courses.teaching_range_kind
                        WHEN 'explicit' THEN courses.teaching_end_date
                        ELSE terms.end_date
                    END AS teaching_end_date
                FROM task_series
                JOIN courses ON courses.course_id = task_series.course_id
                JOIN terms ON terms.term_id = courses.term_id
                WHERE task_series.task_series_id = ?
            `);
        seriesStatement.setReadBigInts(true);
        const series = seriesStatement.get(taskSeriesId) as {
            entity_version: bigint;
            retired: bigint;
            time_zone: string;
            teaching_start_date: string;
            teaching_end_date: string;
        } | undefined;
        if (!series || series.retired !== 0n) {
            ctx.rollbackOrRequireReopen();
            throw new TypeError('Task series is not editable');
        }

        const isFuture = scope === 'this-and-future';
        const requiresPreview = isFuture || deleteCommand !== null;
        if (requiresPreview) {
            const requestedWindow = command.impactWindow;
            let draft: TaskOccurrenceImpactDraft | null = null;
            if (requestedWindow !== null) {
                draft = changeCommand
                    ? Object.freeze({
                        scope: 'this-and-future' as const,
                        taskSeriesId,
                        originalLogicalAnchor: originalLogicalAnchor!,
                        action: 'change' as const,
                        replacement: (changeCommand.intent.payload as Extract<
                            ChangeTaskOccurrenceCommand['intent']['payload'],
                            { scope: 'this-and-future' }
                        >).replacement,
                        requestedWindow,
                    })
                    : scope === 'whole-series'
                        ? Object.freeze({
                            scope: 'whole-series' as const,
                            taskSeriesId,
                            action: 'delete' as const,
                            requestedWindow,
                        })
                        : Object.freeze({
                            scope,
                            taskSeriesId,
                            originalLogicalAnchor: originalLogicalAnchor!,
                            action: 'delete' as const,
                            requestedWindow,
                        });
            }
            const expectedToken = draft === null
                ? null
                : taskOccurrenceConfirmationToken(
                    versions.revision.toString(),
                    versions.planVersion.toString(),
                    series.entity_version.toString(),
                    draft,
                );
            if (versions.revision !== BigInt(command.expectedRevision)
                || versions.planVersion !== BigInt(command.expectedPlanVersion)
                || series.entity_version !== BigInt(command.expectedTaskSeriesVersion)
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
        else if (series.entity_version !== BigInt(command.expectedTaskSeriesVersion)) {
            ctx.rollbackOrRequireReopen();
            return taskSeriesConflictResult(versions, taskSeriesId, series.entity_version);
        }
        fireCommitFailpoint(options, 'commit.after-expected-versions');

        if (versions.revision === SQLITE_INTEGER_MAX
            || versions.planVersion === SQLITE_INTEGER_MAX
            || series.entity_version === SQLITE_INTEGER_MAX) {
            ctx.rollbackOrRequireReopen();
            throw ctx.enterTerminalState();
        }
        const newRevision = versions.revision + 1n;
        const newPlanVersion = versions.planVersion + 1n;
        const newSeriesVersion = series.entity_version + 1n;

        if (scope === 'whole-series') {
            ctx.database.prepare(`
                    UPDATE task_series SET retired = 1 WHERE task_series_id = ? AND retired = 0
                `).run(taskSeriesId);
        }
        else {
            const segmentStatement = ctx.database.prepare(`
                    SELECT
                        task_segment_id,
                        title,
                        task_size,
                        schedule_kind,
                        deadline_kind,
                        deadline_date,
                        deadline_instant,
                        deadline_display_zone,
                        logical_start_anchor,
                        logical_end_anchor,
                        weekly_start_date,
                        weekly_weekday,
                        weekly_local_deadline_time,
                        weekly_confirmed_end_date,
                        follow_teaching_week
                    FROM task_segments
                    WHERE task_series_id = ?
                    ORDER BY logical_start_anchor, task_segment_id
                `);
            segmentStatement.setReadBigInts(true);
            const segments = segmentStatement.all(taskSeriesId) as StoredTaskSegment[];
            const segment = taskSegmentForAnchor(segments, originalLogicalAnchor!);
            const overrideStatement = ctx.database.prepare(`
                    SELECT
                        original_logical_anchor,
                        override_kind,
                        replacement_title,
                        replacement_task_size,
                        replacement_deadline_kind,
                        replacement_deadline_date,
                        replacement_deadline_instant,
                        replacement_deadline_display_zone,
                        entity_version
                    FROM task_occurrence_overrides
                    WHERE task_series_id = ?
                    ORDER BY original_logical_anchor
                `);
            overrideStatement.setReadBigInts(true);
            const overrides = overrideStatement.all(taskSeriesId) as StoredTaskOccurrenceOverride[];
            const targetOverride = overrides.find(candidate => (
                candidate.original_logical_anchor === originalLogicalAnchor
            ));
            if (!segment || targetOverride?.override_kind === 'deleted') {
                ctx.rollbackOrRequireReopen();
                throw new TypeError('Task occurrence is not active');
            }
            if (isFuture && segment.schedule_kind !== 'weekly') {
                ctx.rollbackOrRequireReopen();
                throw new TypeError('This-and-future scope requires a weekly Task series');
            }
            if (overrides.some(override => override.entity_version === SQLITE_INTEGER_MAX)) {
                ctx.rollbackOrRequireReopen();
                throw ctx.enterTerminalState();
            }

            const stateStatement = ctx.database.prepare(`
                    SELECT
                        original_logical_anchor,
                        status,
                        self_reported_progress,
                        entity_version
                    FROM task_occurrence_states
                    WHERE task_series_id = ?
                    ORDER BY original_logical_anchor
                `);
            stateStatement.setReadBigInts(true);
            const states = stateStatement.all(taskSeriesId) as StoredTaskOccurrenceState[];
            const targetState = states.find(state => (
                state.original_logical_anchor === originalLogicalAnchor
            ));
            const replacementForAnchor = (anchor: string): TaskOccurrenceReplacement => {
                const override = overrides.find(candidate => candidate.original_logical_anchor === anchor);
                if (override?.override_kind === 'replaced') {
                    return taskOverrideReplacement(override);
                }
                const owner = taskSegmentForAnchor(segments, anchor);
                if (!owner) {
                    throw new Error('Task occurrence state has no retained facts');
                }
                return Object.freeze({
                    title: owner.title,
                    size: owner.task_size,
                    deadline: taskSegmentOccurrenceDeadline(owner, anchor, series.time_zone),
                });
            };
            const writeReplacementOverride = (
                anchor: string,
                replacement: TaskOccurrenceReplacement,
            ): void => {
                ctx.database.prepare(`
                        INSERT INTO task_occurrence_overrides (
                            task_series_id,
                            original_logical_anchor,
                            override_kind,
                            replacement_title,
                            replacement_task_size,
                            replacement_deadline_kind,
                            replacement_deadline_date,
                            replacement_deadline_instant,
                            replacement_deadline_display_zone,
                            entity_version
                        ) VALUES (?, ?, 'replaced', ?, ?, ?, ?, ?, ?, 1)
                        ON CONFLICT (task_series_id, original_logical_anchor) DO UPDATE SET
                            override_kind = 'replaced',
                            replacement_title = excluded.replacement_title,
                            replacement_task_size = excluded.replacement_task_size,
                            replacement_deadline_kind = excluded.replacement_deadline_kind,
                            replacement_deadline_date = excluded.replacement_deadline_date,
                            replacement_deadline_instant = excluded.replacement_deadline_instant,
                            replacement_deadline_display_zone = excluded.replacement_deadline_display_zone,
                            entity_version = task_occurrence_overrides.entity_version + 1
                    `).run(
                    taskSeriesId,
                    anchor,
                    replacement.title,
                    replacement.size,
                    ...taskDeadlineColumns(replacement.deadline),
                );
            };

            if (changeCommand && scope === 'only-this') {
                if (targetState && targetState.status !== 'pending') {
                    ctx.rollbackOrRequireReopen();
                    throw new TypeError('Terminal Task occurrence history is not editable');
                }
                const replacement = (changeCommand.intent.payload as Extract<
                    ChangeTaskOccurrenceCommand['intent']['payload'],
                    { scope: 'only-this' }
                >).replacement;
                writeReplacementOverride(originalLogicalAnchor!, replacement);
            }
            else if (deleteCommand && scope === 'only-this') {
                if (targetState && targetState.status !== 'pending') {
                    ctx.rollbackOrRequireReopen();
                    throw new TypeError('Terminal Task occurrence history is not deletable as only-this');
                }
                ctx.database.prepare(`
                        INSERT INTO task_occurrence_overrides (
                            task_series_id,
                            original_logical_anchor,
                            override_kind,
                            replacement_title,
                            replacement_task_size,
                            replacement_deadline_kind,
                            replacement_deadline_date,
                            replacement_deadline_instant,
                            replacement_deadline_display_zone,
                            entity_version
                        ) VALUES (?, ?, 'deleted', NULL, NULL, NULL, NULL, NULL, NULL, 1)
                        ON CONFLICT (task_series_id, original_logical_anchor) DO UPDATE SET
                            override_kind = 'deleted',
                            replacement_title = NULL,
                            replacement_task_size = NULL,
                            replacement_deadline_kind = NULL,
                            replacement_deadline_date = NULL,
                            replacement_deadline_instant = NULL,
                            replacement_deadline_display_zone = NULL,
                            entity_version = task_occurrence_overrides.entity_version + 1
                    `).run(taskSeriesId, originalLogicalAnchor);
            }
            else {
                const retainedStates = states.filter(state => (
                    state.original_logical_anchor >= originalLogicalAnchor!
                    && (deleteCommand !== null || state.status !== 'pending')
                ));
                for (const state of retainedStates) {
                    writeReplacementOverride(
                        state.original_logical_anchor,
                        replacementForAnchor(state.original_logical_anchor),
                    );
                }

                const finalLogicalEndAnchor = segments.at(-1)!.logical_end_anchor;
                ctx.database.prepare(`
                        DELETE FROM task_segments
                        WHERE task_series_id = ? AND logical_start_anchor > ?
                    `).run(taskSeriesId, originalLogicalAnchor);
                if (changeCommand) {
                    if (!targetState || targetState.status === 'pending') {
                        ctx.database.prepare(`
                                DELETE FROM task_occurrence_overrides
                                WHERE task_series_id = ? AND original_logical_anchor = ?
                            `).run(taskSeriesId, originalLogicalAnchor);
                    }
                    const replacement = (changeCommand.intent.payload as Extract<
                        ChangeTaskOccurrenceCommand['intent']['payload'],
                        { scope: 'this-and-future' }
                    >).replacement;
                    const firstDate = occurrenceDate(originalLogicalAnchor!, replacement.weekday);
                    const lastDate = occurrenceDate(finalLogicalEndAnchor, replacement.weekday);
                    if (firstDate === null
                        || lastDate === null
                        || firstDate < series.teaching_start_date
                        || lastDate > series.teaching_end_date) {
                        ctx.rollbackOrRequireReopen();
                        throw new TypeError('Task future replacement falls outside the Course range');
                    }
                    const boundaryInstants = [firstDate, lastDate].map(date => (
                        INTL_ZONE_RULES.resolveInstant(
                            series.time_zone,
                            date,
                            replacement.localDeadlineTime,
                        )
                    ));
                    if (!boundaryInstants.every(isCanonicalInstant)) {
                        ctx.rollbackOrRequireReopen();
                        throw new TypeError('Task future replacement has an invalid deadline');
                    }
                    if (originalLogicalAnchor === segment.logical_start_anchor) {
                        ctx.database.prepare(`
                                DELETE FROM task_segments WHERE task_segment_id = ?
                            `).run(segment.task_segment_id);
                    }
                    else {
                        ctx.database.prepare(`
                                UPDATE task_segments SET logical_end_anchor = ? WHERE task_segment_id = ?
                            `).run(addLocalDateDays(originalLogicalAnchor!, -7), segment.task_segment_id);
                    }
                    ctx.database.prepare(`
                            INSERT INTO task_segments (
                                task_segment_id,
                                task_series_id,
                                title,
                                task_size,
                                schedule_kind,
                                deadline_kind,
                                deadline_date,
                                deadline_instant,
                                deadline_display_zone,
                                weekly_start_date,
                                weekly_weekday,
                                weekly_local_deadline_time,
                                weekly_confirmed_end_date,
                                follow_teaching_week,
                                logical_start_anchor,
                                logical_end_anchor
                            ) VALUES (
                                ?, ?, ?, ?, 'weekly', NULL, NULL, NULL, NULL,
                                ?, ?, ?, ?, ?, ?, ?
                            )
                        `).run(
                        randomUUID(),
                        taskSeriesId,
                        replacement.title,
                        replacement.size,
                        segment.weekly_start_date,
                        replacement.weekday,
                        replacement.localDeadlineTime,
                        segments.at(-1)!.weekly_confirmed_end_date,
                        replacement.followTeachingWeek ? 1 : 0,
                        originalLogicalAnchor,
                        finalLogicalEndAnchor,
                    );
                }
                else {
                    ctx.database.prepare(`
                            DELETE FROM task_occurrence_overrides
                            WHERE task_series_id = ?
                                AND original_logical_anchor >= ?
                                AND NOT EXISTS (
                                    SELECT 1
                                    FROM task_occurrence_states
                                    WHERE task_occurrence_states.task_series_id
                                        = task_occurrence_overrides.task_series_id
                                        AND task_occurrence_states.original_logical_anchor
                                            = task_occurrence_overrides.original_logical_anchor
                                )
                        `).run(taskSeriesId, originalLogicalAnchor);
                    if (originalLogicalAnchor === segment.logical_start_anchor) {
                        const hasEarlierSegment = segments.some(candidate => (
                            candidate.logical_start_anchor < originalLogicalAnchor!
                        ));
                        if (hasEarlierSegment) {
                            ctx.database.prepare(`
                                    DELETE FROM task_segments WHERE task_segment_id = ?
                                `).run(segment.task_segment_id);
                        }
                        else {
                            ctx.database.prepare(`
                                    UPDATE task_series SET retired = 1 WHERE task_series_id = ?
                                `).run(taskSeriesId);
                        }
                    }
                    else {
                        ctx.database.prepare(`
                                UPDATE task_segments SET logical_end_anchor = ? WHERE task_segment_id = ?
                            `).run(addLocalDateDays(originalLogicalAnchor!, -7), segment.task_segment_id);
                    }
                }
            }
        }

        ctx.database.prepare(`
                UPDATE task_series SET entity_version = ? WHERE task_series_id = ?
            `).run(newSeriesVersion, taskSeriesId);
        ctx.database.prepare(`
                UPDATE plan_state SET plan_entity_version = ? WHERE singleton = 1
            `).run(newPlanVersion);
        fireCommitFailpoint(options, 'commit.after-facts');
        ctx.database.prepare(`
                UPDATE workspace_state SET revision = ? WHERE singleton = 1
            `).run(newRevision);
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
        const effectCode: ReceiptEffect['code'] = changeCommand
            ? 'plan.task-occurrence-changed'
            : deleteCommand!.intent.payload.scope === 'whole-series'
                ? 'plan.task-series-deleted'
                : 'plan.task-occurrence-deleted';
        ctx.database.prepare(`
                INSERT INTO receipt_effects (
                    command_id,
                    effect_order,
                    effect_code,
                    entity_kind,
                    entity_id,
                    entity_version
                ) VALUES (?, 0, ?, 'task-series', ?, ?)
            `).run(command.commandId, effectCode, taskSeriesId, newSeriesVersion);
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
            throw new Error('Committed Task occurrence rule receipt outcome is missing');
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
