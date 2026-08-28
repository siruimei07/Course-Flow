import { timingSafeEqual } from 'node:crypto';
import { digestConfigureBackupDestination } from '../../command-digest';
import { currentVersions, readReceiptOutcome } from '../context';
import type { StoreContext } from '../context';
import { classifySqliteFailure, fireCommitFailpoint } from '../database';
import { permissionCommitResult, protectionConflictResult, successfulCommit, writerBusyResult } from '../results';
import { CommittedCommandOutcomeUnknownError, SQLITE_INTEGER_MAX } from '../types';
import type { CommitOptions, DataCommitResult } from '../types';
import type { AcceptedConfigureBackupDestinationCommand } from '../../../shared/workspace-protection-contract';
export function commitBackupConfigurationSynchronously(ctx: StoreContext, 
    command: AcceptedConfigureBackupDestinationCommand,
    options: CommitOptions,
): DataCommitResult {
    const digest = digestConfigureBackupDestination(command);
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
                return protectionConflictResult('command-id-reused', ctx.workspaceId, versions);
            }
            const outcome = readReceiptOutcome(ctx.database, command.commandId);
            ctx.rollbackOrRequireReopen();
            if (!outcome) {
                throw new Error('Stored backup configuration receipt is incomplete');
            }
            return successfulCommit(outcome);
        }

        const versions = currentVersions(ctx.database);
        if (command.workspaceId !== ctx.workspaceId
            || versions.protectionVersion !== BigInt(command.expectedProtectionVersion)) {
            ctx.rollbackOrRequireReopen();
            return protectionConflictResult('expected-entity-version', ctx.workspaceId, versions);
        }
        if (versions.revision !== BigInt(command.expectedRevision)) {
            ctx.rollbackOrRequireReopen();
            return protectionConflictResult('expected-revision', ctx.workspaceId, versions);
        }
        const current = ctx.database.prepare(`
                SELECT backup_set_id
                FROM backup_configuration
                WHERE singleton = 1
            `).get() as { backup_set_id: string | null };
        if (current.backup_set_id !== null) {
            ctx.rollbackOrRequireReopen();
            return protectionConflictResult('expected-entity-version', ctx.workspaceId, versions);
        }
        fireCommitFailpoint(options, 'commit.after-expected-versions');

        if (versions.revision === SQLITE_INTEGER_MAX
            || versions.protectionVersion === SQLITE_INTEGER_MAX) {
            ctx.rollbackOrRequireReopen();
            throw ctx.enterTerminalState();
        }
        const newRevision = versions.revision + 1n;
        const newProtectionVersion = versions.protectionVersion + 1n;
        ctx.database.prepare(`
                UPDATE backup_configuration
                SET
                    configuration_version = ?,
                    backup_set_id = ?,
                    repository_schema = ?,
                    canonical_destination_path = ?,
                    destination_display_name = ?,
                    originating_command_id = ?,
                    configured_revision = ?
                WHERE singleton = 1
            `).run(
            newProtectionVersion,
            command.destination.backupSetId,
            command.destination.repositorySchema,
            command.destination.canonicalPath,
            command.destination.displayName,
            command.commandId,
            newRevision,
        );
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
                    ?, 'protect.configure-backup-destination', 1,
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
                ) VALUES (
                    ?, 0, 'protect.backup-destination-configured',
                    'backup-configuration', ?, ?
                )
            `).run(command.commandId, command.destination.backupSetId, newProtectionVersion);
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
            throw new Error('Committed backup configuration receipt is missing');
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
        throw new Error('Workspace backup configuration commit failed');
    }
}
