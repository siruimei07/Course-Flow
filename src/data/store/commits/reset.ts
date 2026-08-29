/**
 * Commits the explicit Current Term reset and its durable receipt atomically.
 *
 * The reset removes exactly the Current Term and every fact that belongs to it:
 * its Courses, MeetingSeries, Tasks and HolidayRanges. Other Terms, their history,
 * command receipts and every protection fact are untouched.
 *
 * @param {ResetCurrentTermCommand} command - Normalized reset command.
 * @param {CommitOptions} options - Transaction failpoint controls used by tests.
 * @return {DataCommitResult} Committed receipt or unchanged structured problem.
 */
import { timingSafeEqual } from 'node:crypto';
import { digestResetCurrentTerm } from '../../command-digest';
import { currentVersions, readReceiptOutcome } from '../context';
import type { StoreContext } from '../context';
import { classifySqliteFailure, fireCommitFailpoint } from '../database';
import { permissionCommitResult, planConflictResult, successfulCommit, writerBusyResult } from '../results';
import { CommittedCommandOutcomeUnknownError, SQLITE_INTEGER_MAX } from '../types';
import type { CommitOptions, DataCommitResult } from '../types';
import { ResetCurrentTermCommand } from '../../../shared/workspace-term-contract';

export function commitResetCurrentTermSynchronously(ctx: StoreContext,
    command: ResetCurrentTermCommand,
    options: CommitOptions,
): DataCommitResult {
    const digest = digestResetCurrentTerm(command);
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

        const termId = command.intent.payload.termId;
        const currentTermRow = ctx.database.prepare(`
                SELECT current_term_id FROM plan_state WHERE singleton = 1
            `).get() as { current_term_id: string | null } | undefined;
        if (!currentTermRow || currentTermRow.current_term_id !== termId) {
            ctx.rollbackOrRequireReopen();
            throw new TypeError('Reset target is not the Current Term');
        }
        const termStatement = ctx.database.prepare(`
                SELECT name, entity_version FROM terms WHERE term_id = ?
            `);
        termStatement.setReadBigInts(true);
        const term = termStatement.get(termId) as {
            name: string;
            entity_version: bigint;
        } | undefined;
        if (!term) {
            ctx.rollbackOrRequireReopen();
            throw new TypeError('Current Term does not exist');
        }
        if (term.entity_version !== BigInt(command.expectedTermVersion)) {
            ctx.rollbackOrRequireReopen();
            return planConflictResult('expected-entity-version', versions);
        }
        // The retyped name is the user's explicit confirmation of which Term is destroyed.
        if (term.name !== command.intent.payload.confirmedTermName) {
            ctx.rollbackOrRequireReopen();
            throw new TypeError('Reset confirmation does not name the Current Term');
        }
        fireCommitFailpoint(options, 'commit.after-expected-versions');

        if (versions.revision === SQLITE_INTEGER_MAX || versions.planVersion === SQLITE_INTEGER_MAX) {
            ctx.rollbackOrRequireReopen();
            throw ctx.enterTerminalState();
        }

        // Children first: every foreign key in the plan graph is ON DELETE RESTRICT.
        ctx.database.prepare(`
                DELETE FROM task_state_history
                WHERE task_series_id IN (
                    SELECT task_series_id FROM task_series
                    WHERE course_id IN (SELECT course_id FROM courses WHERE term_id = ?)
                )
            `).run(termId);
        for (const table of [
            'task_occurrence_overrides',
            'task_occurrence_states',
            'task_segments',
        ]) {
            ctx.database.prepare(`
                    DELETE FROM ${table}
                    WHERE task_series_id IN (
                        SELECT task_series_id FROM task_series
                        WHERE course_id IN (SELECT course_id FROM courses WHERE term_id = ?)
                    )
                `).run(termId);
        }
        ctx.database.prepare(`
                DELETE FROM task_series
                WHERE course_id IN (SELECT course_id FROM courses WHERE term_id = ?)
            `).run(termId);
        for (const table of ['meeting_occurrence_overrides', 'meeting_segments']) {
            ctx.database.prepare(`
                    DELETE FROM ${table}
                    WHERE meeting_series_id IN (
                        SELECT meeting_series_id FROM meeting_series
                        WHERE course_id IN (SELECT course_id FROM courses WHERE term_id = ?)
                    )
                `).run(termId);
        }
        ctx.database.prepare(`
                DELETE FROM meeting_series
                WHERE course_id IN (SELECT course_id FROM courses WHERE term_id = ?)
            `).run(termId);
        ctx.database.prepare('DELETE FROM courses WHERE term_id = ?').run(termId);
        ctx.database.prepare('DELETE FROM holiday_ranges WHERE term_id = ?').run(termId);

        const newRevision = versions.revision + 1n;
        const newPlanVersion = versions.planVersion + 1n;
        ctx.database.prepare(`
                UPDATE plan_state
                SET current_term_id = NULL, plan_entity_version = ?
                WHERE singleton = 1
            `).run(newPlanVersion);
        ctx.database.prepare('DELETE FROM terms WHERE term_id = ?').run(termId);
        // The one-way milestone only survives while some Term still exists; an explicit
        // reset that removes the last Term returns the app to first setup.
        ctx.database.exec(`
            UPDATE setup_state
            SET ever_reached_minimum = 0
            WHERE singleton = 1
                AND NOT EXISTS (SELECT 1 FROM terms)
        `);
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
                ) VALUES (?, 0, 'plan.current-term-reset', 'term', ?, ?)
            `).run(command.commandId, termId, term.entity_version + 1n);
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
