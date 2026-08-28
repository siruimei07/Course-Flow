/**
 * Commits one named HolidayRange lifecycle transition and its durable receipt atomically.
 * @param {HolidayRangeCommand} command - Normalized create, update, or delete command.
 * @param {CommitOptions} options - Transaction failpoint controls used by tests.
 * @return {DataCommitResult} Committed receipt or unchanged structured problem.
 */
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { digestCreateHolidayRange, digestDeleteHolidayRange, digestUpdateHolidayRange } from '../../command-digest';
import { readActiveHolidayRanges, readConflictMeetingOccurrences } from '../conflict-reads';
import { advanceSetupMinimumMilestone, currentVersions, readReceiptOutcome } from '../context';
import type { StoreContext } from '../context';
import { classifySqliteFailure, fireCommitFailpoint } from '../database';
import { holidayRangeConflictResult, meetingOverlapDecisionRequiredResult, permissionCommitResult, planConflictResult, successfulCommit, writerBusyResult } from '../results';
import { CommittedCommandOutcomeUnknownError, SQLITE_INTEGER_MAX } from '../types';
import type { CommitOptions, DataCommitResult, ReceiptEffect } from '../types';
import { addClampedLocalDateDays } from '../../../plan/local-date';
import { StoredHolidayRange } from '../../../plan/meeting-occurrences';
import { meetingOverlapWarningKey, meetingScheduleOverlapWarnings } from '../../../plan/meeting-overlap';
import { MAX_MEETING_OVERLAP_WARNINGS } from '../../../shared/workspace-course-contract';
import { CreateHolidayRangeCommand, DeleteHolidayRangeCommand, UpdateHolidayRangeCommand } from '../../../shared/workspace-holiday-contract';
import type { HolidayRangeCommand } from '../../../shared/workspace-holiday-contract';
export function commitHolidayRangeSynchronously(ctx: StoreContext, 
    command: HolidayRangeCommand,
    options: CommitOptions,
): DataCommitResult {
    const digest = command.intent.kind === 'plan.create-holiday-range'
        ? digestCreateHolidayRange(command as CreateHolidayRangeCommand)
        : command.intent.kind === 'plan.update-holiday-range'
            ? digestUpdateHolidayRange(command as UpdateHolidayRangeCommand)
            : digestDeleteHolidayRange(command as DeleteHolidayRangeCommand);
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

        const existing = command.intent.kind === 'plan.create-holiday-range'
            ? undefined
            : (() => {
                const statement = ctx.database.prepare(`
                        SELECT
                            term_id,
                            name,
                            start_date,
                            end_date,
                            tombstoned,
                            entity_version
                        FROM holiday_ranges
                        WHERE holiday_range_id = ?
                    `);
                statement.setReadBigInts(true);
                return statement.get(command.intent.payload.holidayRangeId) as {
                    term_id: string;
                    name: string;
                    start_date: string;
                    end_date: string;
                    tombstoned: bigint;
                    entity_version: bigint;
                } | undefined;
            })();
        if (command.intent.kind !== 'plan.create-holiday-range') {
            if (!existing || existing.tombstoned !== 0n) {
                ctx.rollbackOrRequireReopen();
                throw new TypeError('HolidayRange is not editable');
            }
            const expectedHolidayRangeVersion = (command as (
                UpdateHolidayRangeCommand | DeleteHolidayRangeCommand
            )).expectedHolidayRangeVersion;
            if (existing.entity_version !== BigInt(expectedHolidayRangeVersion)) {
                ctx.rollbackOrRequireReopen();
                return holidayRangeConflictResult(
                    versions,
                    command.intent.payload.holidayRangeId,
                    existing.entity_version,
                );
            }
        }
        fireCommitFailpoint(options, 'commit.after-expected-versions');

        const termId = command.intent.kind === 'plan.create-holiday-range'
            ? command.intent.payload.termId
            : existing!.term_id;
        const term = ctx.database.prepare(`
                SELECT start_date, end_date
                FROM terms
                WHERE term_id = ?
            `).get(termId) as { start_date: string; end_date: string } | undefined;
        if (!term) {
            ctx.rollbackOrRequireReopen();
            throw new TypeError('HolidayRange owning Term does not exist');
        }
        if (command.intent.kind !== 'plan.delete-holiday-range'
            && (command.intent.payload.startDate < term.start_date
                || command.intent.payload.endDate > term.end_date)) {
            ctx.rollbackOrRequireReopen();
            throw new TypeError('HolidayRange falls outside its Term');
        }
        if (command.intent.kind !== 'plan.create-holiday-range') {
            const mutation = command as UpdateHolidayRangeCommand | DeleteHolidayRangeCommand;
            if (mutation.overlapDecision === 'review') {
                const activeHolidayRanges = readActiveHolidayRanges(ctx.database, termId);
                const holidayRangeId = mutation.intent.payload.holidayRangeId;
                let candidateHolidayRanges: readonly StoredHolidayRange[];
                let changedStartDate = existing!.start_date;
                let changedEndDate = existing!.end_date;
                if (mutation.intent.kind === 'plan.update-holiday-range') {
                    const update = mutation as UpdateHolidayRangeCommand;
                    candidateHolidayRanges = activeHolidayRanges.map(range => (
                        range.holiday_range_id === holidayRangeId
                            ? Object.freeze({
                                holiday_range_id: range.holiday_range_id,
                                start_date: update.intent.payload.startDate,
                                end_date: update.intent.payload.endDate,
                            })
                            : range
                    ));
                    changedStartDate = update.intent.payload.startDate < changedStartDate
                        ? update.intent.payload.startDate
                        : changedStartDate;
                    changedEndDate = update.intent.payload.endDate > changedEndDate
                        ? update.intent.payload.endDate
                        : changedEndDate;
                }
                else {
                    candidateHolidayRanges = activeHolidayRanges.filter(range => (
                        range.holiday_range_id !== holidayRangeId
                    ));
                }
                const conflictWindow = Object.freeze({
                    startDate: addClampedLocalDateDays(changedStartDate, -3),
                    endDate: addClampedLocalDateDays(changedEndDate, 3),
                });
                const beforeWarnings = meetingScheduleOverlapWarnings(
                    command.commandId,
                    readConflictMeetingOccurrences(ctx.database,
                        conflictWindow,
                        termId,
                        activeHolidayRanges,
                    ),
                );
                const existingWarningKeys = new Set(beforeWarnings.map(meetingOverlapWarningKey));
                const introducedWarnings = meetingScheduleOverlapWarnings(
                    command.commandId,
                    readConflictMeetingOccurrences(ctx.database,
                        conflictWindow,
                        termId,
                        candidateHolidayRanges,
                    ),
                ).filter(warning => !existingWarningKeys.has(meetingOverlapWarningKey(warning)))
                    .slice(0, MAX_MEETING_OVERLAP_WARNINGS);
                if (introducedWarnings.length > 0) {
                    ctx.rollbackOrRequireReopen();
                    return meetingOverlapDecisionRequiredResult(
                        versions.revision,
                        Object.freeze(introducedWarnings),
                    );
                }
            }
        }
        const existingVersion = existing?.entity_version ?? 0n;
        if (versions.revision === SQLITE_INTEGER_MAX
            || versions.planVersion === SQLITE_INTEGER_MAX
            || existingVersion === SQLITE_INTEGER_MAX) {
            ctx.rollbackOrRequireReopen();
            throw ctx.enterTerminalState();
        }

        const holidayRangeId = command.intent.kind === 'plan.create-holiday-range'
            ? randomUUID()
            : command.intent.payload.holidayRangeId;
        const newRevision = versions.revision + 1n;
        const newPlanVersion = versions.planVersion + 1n;
        const newHolidayRangeVersion = existingVersion + 1n;
        if (command.intent.kind === 'plan.create-holiday-range') {
            ctx.database.prepare(`
                    INSERT INTO holiday_ranges (
                        holiday_range_id,
                        term_id,
                        name,
                        start_date,
                        end_date,
                        tombstoned,
                        entity_version
                    ) VALUES (?, ?, ?, ?, ?, 0, 1)
                `).run(
                holidayRangeId,
                termId,
                command.intent.payload.name,
                command.intent.payload.startDate,
                command.intent.payload.endDate,
            );
        }
        else if (command.intent.kind === 'plan.update-holiday-range') {
            ctx.database.prepare(`
                    UPDATE holiday_ranges
                    SET name = ?, start_date = ?, end_date = ?, entity_version = ?
                    WHERE holiday_range_id = ? AND tombstoned = 0
                `).run(
                command.intent.payload.name,
                command.intent.payload.startDate,
                command.intent.payload.endDate,
                newHolidayRangeVersion,
                holidayRangeId,
            );
        }
        else {
            ctx.database.prepare(`
                    UPDATE holiday_ranges
                    SET tombstoned = 1, entity_version = ?
                    WHERE holiday_range_id = ? AND tombstoned = 0
                `).run(newHolidayRangeVersion, holidayRangeId);
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
                ) VALUES (?, ?, 1, 'courseflow-canonical-json-v1', 'sha256', ?, ?, 'committed')
            `).run(command.commandId, command.intent.kind, digest, newRevision);
        fireCommitFailpoint(options, 'commit.after-receipt');

        const effectCode: ReceiptEffect['code'] = command.intent.kind === 'plan.create-holiday-range'
            ? 'plan.holiday-range-created'
            : command.intent.kind === 'plan.update-holiday-range'
                ? 'plan.holiday-range-updated'
                : 'plan.holiday-range-deleted';
        ctx.database.prepare(`
                INSERT INTO receipt_effects (
                    command_id,
                    effect_order,
                    effect_code,
                    entity_kind,
                    entity_id,
                    entity_version
                ) VALUES (?, 0, ?, 'holiday-range', ?, ?)
            `).run(command.commandId, effectCode, holidayRangeId, newHolidayRangeVersion);
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
