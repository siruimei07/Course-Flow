import { createHash } from 'node:crypto';
import { insertRestoreCommandReceipt } from '../context';
import type { StoreContext } from '../context';
import { requireRestoreCompletionReceiptInput, restoreCompletionReceiptFromRow, restoreSessionFromRow } from '../rows';
import type { RestoreCompletionReceiptRow, RestoreSessionRow } from '../rows';
import type { RestoreCompletionReceipt, RestoreCompletionReceiptInput, StoredRestoreCommandReceipt, StoredRestoreSession } from '../types';
import { canonicalJson } from '../../../shared/canonical-json';
import { isCanonicalUnsignedSqliteInteger, isCanonicalUuid } from '../../../shared/workspace-data-contract';
/**
 * Reads every typed pre-checkpoint RestoreSession for restart reconstruction.
 * @return {readonly StoredRestoreSession[]} Sessions ordered by stable identity.
 */
export function readRestoreSessions(ctx: StoreContext): readonly StoredRestoreSession[] {
    ctx.requireOpen();
    const statement = ctx.database.prepare(`
            SELECT *
            FROM restore_sessions
            ORDER BY restore_session_id
        `);
    statement.setReadBigInts(true);
    return Object.freeze((statement.all() as RestoreSessionRow[]).map(restoreSessionFromRow));
}

/**
 * Reads one durable restore command receipt for exact CommandId replay.
 * @param {string} commandId - Canonical command identity.
 * @return {StoredRestoreCommandReceipt | null} Matching receipt or null.
 */
export function readRestoreCommandReceipt(ctx: StoreContext, commandId: string): StoredRestoreCommandReceipt | null {
    ctx.requireOpen();
    if (!isCanonicalUuid(commandId)) {
        throw new TypeError('Restore CommandId is invalid');
    }
    const row = ctx.database.prepare(`
            SELECT
                command_id,
                command_kind,
                payload_digest,
                restore_session_id,
                result_session_version
            FROM restore_command_receipts
            WHERE command_id = ?
        `).get(commandId) as {
        command_id: string;
        command_kind: 'start' | 'confirm' | 'cancel';
        payload_digest: Uint8Array;
        restore_session_id: string;
        result_session_version: bigint;
    } | undefined;
    return row
        ? Object.freeze({
            commandId: row.command_id,
            commandKind: row.command_kind,
            payloadDigest: Buffer.from(row.payload_digest).toString('hex'),
            restoreSessionId: row.restore_session_id,
            resultSessionVersion: row.result_session_version.toString(),
        })
        : null;
}

/**
 * Reads and verifies the typed receipt for one completed Restore activation.
 * @param {string} operationId - Stable Restore operation identity.
 * @return {RestoreCompletionReceipt | null} Exact receipt or null.
 */
export function readRestoreCompletionReceipt(ctx: StoreContext, operationId: string): RestoreCompletionReceipt | null {
    ctx.requireOpen();
    if (!isCanonicalUuid(operationId)) {
        throw new TypeError('Restore OperationId is invalid');
    }
    const row = ctx.database.prepare(`
            SELECT *
            FROM restore_completion_receipts
            WHERE operation_id = ?
        `).get(operationId) as RestoreCompletionReceiptRow | undefined;
    if (!row) {
        return null;
    }
    const receipt = restoreCompletionReceiptFromRow(row);
    const {receiptDigest, ...input} = receipt;
    const observedDigest = createHash('sha256')
        .update(canonicalJson(input), 'utf8')
        .digest('hex');
    if (observedDigest !== receiptDigest) {
        throw new Error('Restore completion receipt digest is invalid');
    }
    return receipt;
}

/**
 * Commits a path-free success or rollback receipt against this exact reopened DATA.
 * @param {RestoreCompletionReceiptInput} input - Reopen-validated completion facts.
 * @return {RestoreCompletionReceipt} New or idempotently replayed receipt.
 */
export function recordRestoreCompletionReceipt(ctx: StoreContext, 
    input: RestoreCompletionReceiptInput,
): RestoreCompletionReceipt {
    ctx.requireBackupMutationAllowed();
    requireRestoreCompletionReceiptInput(input);
    if (input.activeWorkspaceId !== ctx.workspaceId
        || input.activeRevision !== ctx.revision().toString()) {
        throw new Error('Restore receipt does not match active DATA');
    }
    const receiptDigest = createHash('sha256')
        .update(canonicalJson(input), 'utf8')
        .digest('hex');
    const existing = readRestoreCompletionReceipt(ctx, input.operationId);
    if (existing) {
        if (existing.receiptDigest !== receiptDigest) {
            throw new Error('Restore completion receipt conflict');
        }
        return existing;
    }
    try {
        ctx.database.exec('BEGIN IMMEDIATE');
        const sessionRows = ctx.database.prepare(`
                SELECT
                    restore_session_id,
                    operation_id,
                    phase,
                    session_version,
                    safety_set_id
                FROM restore_sessions
                WHERE restore_session_id = ? OR operation_id = ?
            `).all(input.restoreSessionId, input.operationId) as Array<{
            restore_session_id: string;
            operation_id: string;
            phase: StoredRestoreSession['phase'];
            session_version: number;
            safety_set_id: string | null;
        }>;
        if (sessionRows.length > 1
            || (sessionRows.length === 1
                && (sessionRows[0]!.restore_session_id !== input.restoreSessionId
                    || sessionRows[0]!.operation_id !== input.operationId
                    || sessionRows[0]!.phase !== 'protection-established'
                    || sessionRows[0]!.session_version !== 1
                    || sessionRows[0]!.safety_set_id !== input.protection.safetySetId))) {
            throw new Error('Restore completion conflicts with pre-checkpoint DATA facts');
        }
        if (sessionRows.length === 1) {
            ctx.database.prepare(`
                    DELETE FROM restore_command_receipts
                    WHERE restore_session_id = ?
                `).run(input.restoreSessionId);
            ctx.database.prepare(`
                    DELETE FROM restore_sessions
                    WHERE restore_session_id = ? AND operation_id = ?
                `).run(input.restoreSessionId, input.operationId);
        }
        ctx.database.prepare(`
                INSERT INTO restore_completion_receipts (
                    operation_id,
                    restore_session_id,
                    outcome,
                    session_version,
                    source_snapshot_id,
                    source_root_digest,
                    source_schema_level,
                    post_migration_schema_level,
                    active_workspace_id,
                    active_revision,
                    library_state,
                    protection_mode,
                    safety_set_id,
                    plan_digest,
                    precommit_sequence,
                    precommit_record_digest,
                    route,
                    receipt_format_version,
                    receipt_digest
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'absent', 'required', ?, ?, ?, ?, ?, '1', ?)
            `).run(
            input.operationId,
            input.restoreSessionId,
            input.outcome,
            BigInt(input.sessionVersion),
            input.sourceSnapshotId,
            input.sourceRootDigest,
            BigInt(input.sourceSchemaLevel),
            BigInt(input.postMigrationSchemaLevel),
            input.activeWorkspaceId,
            BigInt(input.activeRevision),
            input.protection.safetySetId,
            input.planDigest,
            BigInt(input.precommit.sequence),
            input.precommit.recordDigest,
            input.route,
            receiptDigest,
        );
        ctx.database.exec('COMMIT');
    }
    catch (error) {
        ctx.rollbackOrRequireReopen();
        throw error;
    }
    const stored = readRestoreCompletionReceipt(ctx, input.operationId);
    if (!stored) {
        throw new Error('Restore completion receipt is missing after commit');
    }
    return stored;
}

/**
 * Atomically stores a previewed RestoreSession and its start receipt.
 * @param {StoredRestoreSession} session - Complete preview-bound typed facts.
 * @param {StoredRestoreCommandReceipt} receipt - Matching start receipt.
 * @return {void}
 */
export function createRestoreSession(ctx: StoreContext, 
    session: StoredRestoreSession,
    receipt: StoredRestoreCommandReceipt,
): void {
    ctx.requireBackupMutationAllowed();
    if (session.phase !== 'previewed'
        || session.sessionVersion !== '0'
        || receipt.commandKind !== 'start'
        || receipt.restoreSessionId !== session.restoreSessionId
        || receipt.resultSessionVersion !== '0'
        || !/^[0-9a-f]{64}$/.test(receipt.payloadDigest)) {
        throw new TypeError('RestoreSession start facts are invalid');
    }
    try {
        ctx.database.exec('BEGIN IMMEDIATE');
        ctx.database.prepare(`
                INSERT INTO restore_sessions (
                    restore_session_id,
                    operation_id,
                    candidate_ref,
                    snapshot_id,
                    candidate_root_digest,
                    candidate_database_digest,
                    source_schema_level,
                    prepared_schema_level,
                    candidate_revision,
                    validation_copy,
                    current_workspace_id,
                    current_revision,
                    current_library_kind,
                    current_library_root_id,
                    current_root_generation,
                    target_binding_version,
                    term_count,
                    course_count,
                    task_series_count,
                    impact_digest,
                    binding_digest,
                    preview_token,
                    phase,
                    session_version,
                    problem_code,
                    safety_set_id,
                    safety_protected_revision,
                    safety_root_digest
                ) VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?
                )
            `).run(
            session.restoreSessionId,
            session.operationId,
            session.candidateRef,
            session.snapshotId,
            session.candidateRootDigest,
            session.candidateDatabaseDigest,
            BigInt(session.sourceSchemaLevel),
            BigInt(session.preparedSchemaLevel),
            BigInt(session.candidateRevision),
            session.validationCopy,
            session.currentWorkspaceId,
            BigInt(session.currentRevision),
            session.currentLibrary.kind,
            session.currentLibrary.kind === 'present'
                ? session.currentLibrary.libraryRootId
                : null,
            session.currentLibrary.kind === 'present'
                ? session.currentLibrary.rootGeneration
                : null,
            BigInt(session.targetBindingVersion),
            BigInt(session.termCount),
            BigInt(session.courseCount),
            BigInt(session.taskSeriesCount),
            session.impactDigest,
            session.bindingDigest,
            session.previewToken,
            session.phase,
            BigInt(session.sessionVersion),
            session.problemCode,
            session.safetySetId,
            session.safetyProtectedRevision === null
                ? null
                : BigInt(session.safetyProtectedRevision),
            session.safetyRootDigest,
        );
        insertRestoreCommandReceipt(ctx.database, receipt);
        ctx.database.exec('COMMIT');
    }
    catch (error) {
        ctx.rollbackOrRequireReopen();
        throw error;
    }
}

/**
 * Atomically advances one preview and records its exact confirm receipt.
 * @param {StoredRestoreSession} session - Complete next typed state.
 * @param {string} expectedVersion - Required current session version.
 * @param {StoredRestoreCommandReceipt} receipt - Matching confirmation receipt.
 * @return {void}
 */
export function advanceRestoreSession(ctx: StoreContext, 
    session: StoredRestoreSession,
    expectedVersion: string,
    receipt: StoredRestoreCommandReceipt,
): void {
    ctx.requireBackupMutationAllowed();
    if (expectedVersion !== '0'
        || session.sessionVersion !== '1'
        || session.phase === 'previewed'
        || receipt.commandKind !== 'confirm'
        || receipt.restoreSessionId !== session.restoreSessionId
        || receipt.resultSessionVersion !== '1'
        || !/^[0-9a-f]{64}$/.test(receipt.payloadDigest)) {
        throw new TypeError('RestoreSession transition facts are invalid');
    }
    try {
        ctx.database.exec('BEGIN IMMEDIATE');
        const result = ctx.database.prepare(`
                UPDATE restore_sessions
                SET
                    preview_token = ?,
                    phase = ?,
                    session_version = ?,
                    problem_code = ?,
                    safety_set_id = ?,
                    safety_protected_revision = ?,
                    safety_root_digest = ?
                WHERE restore_session_id = ? AND session_version = ?
            `).run(
            session.previewToken,
            session.phase,
            BigInt(session.sessionVersion),
            session.problemCode,
            session.safetySetId,
            session.safetyProtectedRevision === null
                ? null
                : BigInt(session.safetyProtectedRevision),
            session.safetyRootDigest,
            session.restoreSessionId,
            BigInt(expectedVersion),
        );
        if (BigInt(result.changes) !== 1n) {
            throw new Error('RestoreSession version changed');
        }
        insertRestoreCommandReceipt(ctx.database, receipt);
        ctx.database.exec('COMMIT');
    }
    catch (error) {
        ctx.rollbackOrRequireReopen();
        throw error;
    }
}

/**
 * Atomically cancels one pre-checkpoint RestoreSession and records its command receipt.
 * @param {StoredRestoreSession} session - Exact cancelled typed state.
 * @param {string} expectedVersion - Required current session version.
 * @param {StoredRestoreCommandReceipt} receipt - Matching cancellation receipt.
 * @return {void}
 */
export function cancelRestoreSession(ctx: StoreContext, 
    session: StoredRestoreSession,
    expectedVersion: string,
    receipt: StoredRestoreCommandReceipt,
): void {
    ctx.requireBackupMutationAllowed();
    if (!isCanonicalUnsignedSqliteInteger(expectedVersion)
        || (expectedVersion !== '0' && expectedVersion !== '1')
        || session.sessionVersion !== (BigInt(expectedVersion) + 1n).toString()
        || session.phase !== 'cancelled'
        || session.previewToken !== null
        || session.problemCode !== null
        || receipt.commandKind !== 'cancel'
        || receipt.restoreSessionId !== session.restoreSessionId
        || receipt.resultSessionVersion !== session.sessionVersion
        || !/^[0-9a-f]{64}$/.test(receipt.payloadDigest)) {
        throw new TypeError('RestoreSession cancellation facts are invalid');
    }
    try {
        ctx.database.exec('BEGIN IMMEDIATE');
        const result = ctx.database.prepare(`
                UPDATE restore_sessions
                SET
                    preview_token = NULL,
                    phase = 'cancelled',
                    session_version = ?,
                    problem_code = NULL
                WHERE restore_session_id = ?
                    AND session_version = ?
                    AND phase <> 'cancelled'
            `).run(
            BigInt(session.sessionVersion),
            session.restoreSessionId,
            BigInt(expectedVersion),
        );
        if (BigInt(result.changes) !== 1n) {
            throw new Error('RestoreSession version changed');
        }
        insertRestoreCommandReceipt(ctx.database, receipt);
        ctx.database.exec('COMMIT');
    }
    catch (error) {
        ctx.rollbackOrRequireReopen();
        throw error;
    }
}
