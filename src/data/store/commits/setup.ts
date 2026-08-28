import { timingSafeEqual } from 'node:crypto';
import { digestRecordSetupDecision } from '../../command-digest';
import { currentVersions, readReceiptOutcome } from '../context';
import type { StoreContext } from '../context';
import { classifySqliteFailure, fireCommitFailpoint } from '../database';
import { conflictResult, permissionCommitResult, setupDraftConflictResult, setupDraftPermissionResult, setupDraftWriterBusyResult, successfulCommit, writerBusyResult } from '../results';
import { SQLITE_INTEGER_MAX, SetupDraftCheckpointOutcomeUnknownError } from '../types';
import type { CommitOptions, DataCommitResult, SetupDraftCheckpointWriteResult, SetupDraftWork } from '../types';
import type { RecordSetupDecisionCommand } from '../../../shared/workspace-data-contract';
export function commitSetupSynchronously(ctx: StoreContext, 
    command: RecordSetupDecisionCommand,
    options: CommitOptions,
): DataCommitResult {
    const digest = digestRecordSetupDecision(command);
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
                return conflictResult('command-id-reused', ctx.workspaceId, versions);
            }

            const outcome = readReceiptOutcome(ctx.database, command.commandId);
            ctx.rollbackOrRequireReopen();
            if (!outcome) {
                throw new Error('Stored receipt outcome is incomplete');
            }
            return successfulCommit(outcome);
        }

        const versions = currentVersions(ctx.database);
        if (command.workspaceId !== ctx.workspaceId) {
            ctx.rollbackOrRequireReopen();
            return conflictResult('expected-entity-version', ctx.workspaceId, versions);
        }
        const expectedRevision = BigInt(command.expectedRevision);
        const expectedSetupVersion = BigInt(command.expectedSetupVersion);
        if (versions.revision !== expectedRevision) {
            ctx.rollbackOrRequireReopen();
            return conflictResult('expected-revision', ctx.workspaceId, versions);
        }
        if (versions.setupVersion !== expectedSetupVersion) {
            ctx.rollbackOrRequireReopen();
            return conflictResult('expected-entity-version', ctx.workspaceId, versions);
        }
        fireCommitFailpoint(options, 'commit.after-expected-versions');

        if (versions.revision === SQLITE_INTEGER_MAX || versions.setupVersion === SQLITE_INTEGER_MAX) {
            ctx.rollbackOrRequireReopen();
            throw ctx.enterTerminalState();
        }

        const newRevision = versions.revision + 1n;
        const newSetupVersion = versions.setupVersion + 1n;
        ctx.database.prepare(`
                UPDATE setup_state
                SET last_decision = ?, setup_decision_version = ?
                WHERE singleton = 1
            `).run(command.intent.payload.decision, newSetupVersion);
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
                    ?, 'workspace.record-setup-decision', 1,
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
                ) VALUES (?, 0, 'workspace.setup-decision-recorded', 'workspace-setup', ?, ?)
            `).run(command.commandId, ctx.workspaceId, newSetupVersion);
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
    } catch (error) {
        if (ctx.terminalError()) {
            throw ctx.terminalError();
        }
        if (commitAttempted) {
            throw ctx.enterTerminalState();
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

/**
 * Commits one setup-draft stream update without advancing formal revision or follow-ups.
 * @param {SetupDraftWork['mutation']} mutation - Validated queued mutation.
 * @param {CommitOptions} options - Transaction failpoint controls used by tests.
 * @return {SetupDraftCheckpointWriteResult} Committed version or unchanged problem.
 */
export function writeSetupDraftSynchronously(ctx: StoreContext, 
    mutation: SetupDraftWork['mutation'],
    options: CommitOptions,
): SetupDraftCheckpointWriteResult {
    let commitAttempted = false;
    try {
        ctx.database.exec('BEGIN IMMEDIATE');
        const draft = ctx.database.prepare(`
                SELECT workspace_state.revision, setup_draft_checkpoint.checkpoint_version
                FROM workspace_state
                JOIN setup_draft_checkpoint
                    ON setup_draft_checkpoint.singleton = workspace_state.singleton
                WHERE workspace_state.singleton = 1
            `);
        draft.setReadBigInts(true);
        const row = draft.get() as { revision: bigint; checkpoint_version: bigint };
        if (row.checkpoint_version !== BigInt(mutation.expectedVersion)) {
            ctx.rollbackOrRequireReopen();
            return setupDraftConflictResult(ctx.workspaceId, row.revision, row.checkpoint_version);
        }
        if (row.checkpoint_version === SQLITE_INTEGER_MAX) {
            ctx.rollbackOrRequireReopen();
            throw ctx.enterTerminalState();
        }

        const newVersion = row.checkpoint_version + 1n;
        if (mutation.kind === 'save') {
            ctx.database.prepare(`
                    UPDATE setup_draft_checkpoint
                    SET checkpoint_version = ?, schema_version = ?, updated_at = ?, opaque_payload = ?
                    WHERE singleton = 1
                `).run(
                newVersion,
                mutation.schemaVersion,
                mutation.updatedAt,
                mutation.opaquePayload,
            );
        }
        else {
            ctx.database.prepare(`
                    UPDATE setup_draft_checkpoint
                    SET checkpoint_version = ?, schema_version = NULL, updated_at = NULL, opaque_payload = NULL
                    WHERE singleton = 1
                `).run(newVersion);
        }

        fireCommitFailpoint(options, 'commit.before-sqlite-commit');
        commitAttempted = true;
        fireCommitFailpoint(options, 'setup-draft.commit-attempted');
        ctx.database.exec('COMMIT');
        fireCommitFailpoint(options, 'commit.after-sqlite-commit');
        return Object.freeze({
            ok: true as const,
            value: Object.freeze({ draftCheckpointVersion: newVersion.toString() }),
        });
    }
    catch (error) {
        if (ctx.terminalError()) {
            throw ctx.terminalError();
        }
        if (commitAttempted) {
            throw ctx.enterTerminalState(new SetupDraftCheckpointOutcomeUnknownError());
        }
        ctx.rollbackOrRequireReopen();
        if (error instanceof TypeError) {
            throw error;
        }
        const disposition = classifySqliteFailure(error, 'pre-commit');
        if (disposition.kind === 'retryable-unchanged') {
            return setupDraftWriterBusyResult(ctx.revision());
        }
        if (disposition.kind === 'read-only') {
            ctx.markReadOnly();
            return setupDraftPermissionResult(ctx.revision());
        }
        throw new Error('Workspace setup draft write failed');
    }
}
