import { CURRENT_SCHEMA_LEVEL } from '../schema';
import type { BackupCleanupOperation, BackupOperation, BackupOperationPhase, RestoreCompletionReceipt, RestoreCompletionReceiptInput, StoredRestoreSession } from './types';
import { isCanonicalUnsignedSqliteInteger, isCanonicalUuid } from '../../shared/workspace-data-contract';

export type BackupOperationRow = {
    operation_id: string;
    backup_set_id: string;
    backup_sequence: bigint;
    snapshot_id: string;
    target_revision: bigint;
    actual_revision: bigint | null;
    staging_directory_name: string;
    created_at: string;
    phase: BackupOperationPhase;
    operation_version: bigint;
};

export type BackupCleanupOperationRow = {
    operation_id: string;
    backup_set_id: string;
    snapshot_id: string;
    backup_sequence: bigint;
    root_digest: string;
    snapshot_directory_name: string;
    quarantine_directory_name: string;
    phase: 'planned' | 'quarantined' | 'deleting';
    operation_version: bigint;
};

export type RestoreSessionRow = {
    restore_session_id: string;
    operation_id: string;
    candidate_ref: string;
    snapshot_id: string;
    candidate_root_digest: string;
    candidate_database_digest: string;
    source_schema_level: bigint;
    prepared_schema_level: bigint;
    candidate_revision: bigint;
    validation_copy: 'copied' | 'migrated';
    current_workspace_id: string;
    current_revision: bigint;
    current_library_kind: 'absent' | 'present';
    current_library_root_id: string | null;
    current_root_generation: string | null;
    target_binding_version: bigint;
    term_count: bigint;
    course_count: bigint;
    task_series_count: bigint;
    impact_digest: string;
    binding_digest: string;
    preview_token: string | null;
    phase: 'previewed' | 'waiting-decision' | 'protection-established' | 'cancelled';
    session_version: bigint;
    problem_code: 'impact-changed' | null;
    safety_set_id: string | null;
    safety_protected_revision: bigint | null;
    safety_root_digest: string | null;
};

export type RestoreCompletionReceiptRow = {
    operation_id: string;
    restore_session_id: string;
    outcome: 'succeeded' | 'rolled-back';
    session_version: bigint;
    source_snapshot_id: string;
    source_root_digest: string;
    source_schema_level: bigint;
    post_migration_schema_level: bigint;
    active_workspace_id: string;
    active_revision: bigint;
    library_state: 'absent';
    protection_mode: 'required';
    safety_set_id: string;
    plan_digest: string;
    precommit_sequence: bigint;
    precommit_record_digest: string;
    route: 'setup' | 'today';
    receipt_format_version: '1';
    receipt_digest: string;
};

/**
 * Converts one validated storage row into the path-safe PROTECT operation contract.
 * @param {BackupOperationRow} row - Typed SQLite operation row.
 * @return {BackupOperation} Immutable public operation facts.
 */
export function backupOperationFromRow(row: BackupOperationRow): BackupOperation {
    return Object.freeze({
        operationId: row.operation_id,
        backupSetId: row.backup_set_id,
        backupSequence: row.backup_sequence.toString(),
        snapshotId: row.snapshot_id,
        targetRevision: row.target_revision.toString(),
        actualRevision: row.actual_revision?.toString() ?? null,
        stagingDirectoryName: row.staging_directory_name,
        createdAt: row.created_at,
        phase: row.phase,
        version: row.operation_version.toString(),
    });
}

/**
 * Converts one validated cleanup journal row into the path-safe PROTECT contract.
 * @param {BackupCleanupOperationRow} row - Typed SQLite cleanup row.
 * @return {BackupCleanupOperation} Immutable cleanup operation facts.
 */
export function backupCleanupOperationFromRow(row: BackupCleanupOperationRow): BackupCleanupOperation {
    return Object.freeze({
        operationId: row.operation_id,
        backupSetId: row.backup_set_id,
        snapshotId: row.snapshot_id,
        backupSequence: row.backup_sequence.toString(),
        rootDigest: row.root_digest,
        snapshotDirectoryName: row.snapshot_directory_name,
        quarantineDirectoryName: row.quarantine_directory_name,
        phase: row.phase,
        version: row.operation_version.toString(),
    });
}

export function restoreSessionFromRow(row: RestoreSessionRow): StoredRestoreSession {
    return Object.freeze({
        restoreSessionId: row.restore_session_id,
        operationId: row.operation_id,
        candidateRef: row.candidate_ref,
        snapshotId: row.snapshot_id,
        candidateRootDigest: row.candidate_root_digest,
        candidateDatabaseDigest: row.candidate_database_digest,
        sourceSchemaLevel: row.source_schema_level.toString(),
        preparedSchemaLevel: row.prepared_schema_level.toString(),
        candidateRevision: row.candidate_revision.toString(),
        validationCopy: row.validation_copy,
        currentWorkspaceId: row.current_workspace_id,
        currentRevision: row.current_revision.toString(),
        currentLibrary: row.current_library_kind === 'absent'
            ? Object.freeze({kind: 'absent' as const})
            : Object.freeze({
                kind: 'present' as const,
                libraryRootId: row.current_library_root_id!,
                rootGeneration: row.current_root_generation!,
            }),
        targetBindingVersion: row.target_binding_version.toString(),
        termCount: row.term_count.toString(),
        courseCount: row.course_count.toString(),
        taskSeriesCount: row.task_series_count.toString(),
        impactDigest: row.impact_digest,
        bindingDigest: row.binding_digest,
        previewToken: row.preview_token,
        phase: row.phase,
        sessionVersion: row.session_version.toString(),
        problemCode: row.problem_code,
        safetySetId: row.safety_set_id,
        safetyProtectedRevision: row.safety_protected_revision?.toString() ?? null,
        safetyRootDigest: row.safety_root_digest,
    });
}

/**
 * Materializes one path-free completion receipt from its strict storage row.
 * @param {RestoreCompletionReceiptRow} row - Validated schema-level receipt row.
 * @return {RestoreCompletionReceipt} Immutable public receipt facts.
 */
export function restoreCompletionReceiptFromRow(
    row: RestoreCompletionReceiptRow,
): RestoreCompletionReceipt {
    return Object.freeze({
        operationId: row.operation_id,
        restoreSessionId: row.restore_session_id,
        outcome: row.outcome,
        sessionVersion: row.session_version.toString(),
        sourceSnapshotId: row.source_snapshot_id,
        sourceRootDigest: row.source_root_digest,
        sourceSchemaLevel: row.source_schema_level.toString(),
        postMigrationSchemaLevel: row.post_migration_schema_level.toString(),
        activeWorkspaceId: row.active_workspace_id,
        activeRevision: row.active_revision.toString(),
        library: Object.freeze({state: 'absent' as const}),
        protection: Object.freeze({
            mode: 'required' as const,
            safetySetId: row.safety_set_id,
        }),
        planDigest: row.plan_digest,
        precommit: Object.freeze({
            sequence: row.precommit_sequence.toString(),
            recordDigest: row.precommit_record_digest,
        }),
        route: row.route,
        receiptFormatVersion: row.receipt_format_version,
        receiptDigest: row.receipt_digest,
    });
}

/**
 * Requires an object to expose exactly the named enumerable data properties.
 * @param {unknown} value - Candidate value.
 * @param {readonly string[]} keys - Complete allowed key set.
 * @return {boolean} Whether the object has the exact plain shape.
 */
export function hasExactPlainKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
    if (typeof value !== 'object'
        || value === null
        || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype) {
        return false;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actualKeys = Reflect.ownKeys(descriptors);
    return actualKeys.length === keys.length
        && actualKeys.every(key => typeof key === 'string' && keys.includes(key))
        && keys.every(key => {
            const descriptor = descriptors[key];
            return descriptor !== undefined && descriptor.enumerable && 'value' in descriptor;
        });
}

/**
 * Validates the closed Restore receipt shape before DATA commits it.
 * @param {RestoreCompletionReceiptInput} input - Candidate receipt facts.
 * @return {void}
 */
export function requireRestoreCompletionReceiptInput(input: RestoreCompletionReceiptInput): void {
    if (!hasExactPlainKeys(input, [
        'operationId',
        'restoreSessionId',
        'outcome',
        'sessionVersion',
        'sourceSnapshotId',
        'sourceRootDigest',
        'sourceSchemaLevel',
        'postMigrationSchemaLevel',
        'activeWorkspaceId',
        'activeRevision',
        'library',
        'protection',
        'planDigest',
        'precommit',
        'route',
        'receiptFormatVersion',
    ])
        || !isCanonicalUuid(input.operationId)
        || !isCanonicalUuid(input.restoreSessionId)
        || (input.outcome !== 'succeeded' && input.outcome !== 'rolled-back')
        || !isCanonicalUnsignedSqliteInteger(input.sessionVersion)
        || input.sessionVersion !== '3'
        || !isCanonicalUuid(input.sourceSnapshotId)
        || !/^[0-9a-f]{64}$/.test(input.sourceRootDigest)
        || !isCanonicalUnsignedSqliteInteger(input.sourceSchemaLevel)
        || BigInt(input.sourceSchemaLevel) < 13n
        || BigInt(input.sourceSchemaLevel) > BigInt(CURRENT_SCHEMA_LEVEL)
        || input.postMigrationSchemaLevel !== CURRENT_SCHEMA_LEVEL.toString()
        || !isCanonicalUuid(input.activeWorkspaceId)
        || !isCanonicalUnsignedSqliteInteger(input.activeRevision)
        || !hasExactPlainKeys(input.library, ['state'])
        || input.library.state !== 'absent'
        || !hasExactPlainKeys(input.protection, ['mode', 'safetySetId'])
        || input.protection.mode !== 'required'
        || !isCanonicalUuid(input.protection.safetySetId)
        || !/^[0-9a-f]{64}$/.test(input.planDigest)
        || !hasExactPlainKeys(input.precommit, ['sequence', 'recordDigest'])
        || !isCanonicalUnsignedSqliteInteger(input.precommit.sequence)
        || input.precommit.sequence === '0'
        || !/^[0-9a-f]{64}$/.test(input.precommit.recordDigest)
        || (input.route !== 'setup' && input.route !== 'today')
        || input.receiptFormatVersion !== '1') {
        throw new TypeError('Restore completion receipt is invalid');
    }
}

export const BACKUP_PHASE_SUCCESSORS: Readonly<Partial<Record<BackupOperationPhase, BackupOperationPhase>>> = {
    'database-checkpoint': 'library-copy',
    'library-copy': 'staging-validation',
    'staging-validation': 'publishing',
    publishing: 'published-pending-record',
};
