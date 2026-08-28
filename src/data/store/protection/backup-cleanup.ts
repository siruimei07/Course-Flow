import { DatabaseSync } from 'node:sqlite';
import type { StoreContext } from '../context';
import { backupCleanupOperationFromRow } from '../rows';
import type { BackupCleanupOperationRow } from '../rows';
import type { BackupCleanupOperation } from '../types';
import { isCanonicalUuid } from '../../../shared/workspace-data-contract';
/**
 * Claims one PROTECT-selected registration when two newer successes are still recorded.
 * @param {string} operationId - Fresh cleanup operation UUID.
 * @param {string} snapshotId - Freshly selected registered Snapshot UUID.
 * @return {BackupCleanupOperation | null} Resumable cleanup, or null when ineligible.
 */
export function claimBackupCleanupOperation(ctx: StoreContext, 
    operationId: string,
    snapshotId: string,
): BackupCleanupOperation | null {
    ctx.requireBackupMutationAllowed();
    if (!isCanonicalUuid(operationId) || !isCanonicalUuid(snapshotId)) {
        throw new TypeError('Backup cleanup identity is invalid');
    }
    try {
        ctx.database.exec('BEGIN IMMEDIATE');
        const active = readBackupCleanupOperationRow(ctx.database, );
        if (active) {
            ctx.database.exec('COMMIT');
            return backupCleanupOperationFromRow(active);
        }
        const candidateStatement = ctx.database.prepare(`
                SELECT
                    snapshot.backup_set_id,
                    snapshot.snapshot_id,
                    snapshot.backup_sequence,
                    snapshot.root_digest
                FROM backup_snapshots AS snapshot
                JOIN backup_configuration AS configuration ON configuration.singleton = 1
                WHERE snapshot.backup_set_id = configuration.backup_set_id
                    AND snapshot.snapshot_id = ?
                    AND (
                        SELECT count(*)
                        FROM backup_snapshots AS newer
                        WHERE newer.backup_set_id = snapshot.backup_set_id
                            AND newer.backup_sequence > snapshot.backup_sequence
                    ) >= 2
                LIMIT 1
            `);
        candidateStatement.setReadBigInts(true);
        const candidate = candidateStatement.get(snapshotId) as {
            backup_set_id: string;
            snapshot_id: string;
            backup_sequence: bigint;
            root_digest: string;
        } | undefined;
        if (!candidate) {
            ctx.database.exec('COMMIT');
            return null;
        }
        ctx.database.prepare(`
                INSERT INTO backup_cleanup_operations (
                    singleton,
                    operation_id,
                    backup_set_id,
                    snapshot_id,
                    backup_sequence,
                    root_digest,
                    snapshot_directory_name,
                    quarantine_directory_name,
                    phase,
                    operation_version
                ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 'planned', 0)
            `).run(
            operationId,
            candidate.backup_set_id,
            candidate.snapshot_id,
            candidate.backup_sequence,
            candidate.root_digest,
            `snapshot-${candidate.snapshot_id}`,
            `.quarantine-${operationId}-${candidate.snapshot_id}`,
        );
        const claimed = readBackupCleanupOperationRow(ctx.database, );
        ctx.database.exec('COMMIT');
        return backupCleanupOperationFromRow(claimed!);
    }
    catch (error) {
        if (ctx.database.isTransaction) {
            ctx.database.exec('ROLLBACK');
        }
        throw error;
    }
}

/**
 * Reads the one durable retention cleanup journal entry.
 * @return {BackupCleanupOperation | null} Active cleanup when one exists.
 */
export function readBackupCleanupOperation(ctx: StoreContext): BackupCleanupOperation | null {
    ctx.requireOpen();
    const row = readBackupCleanupOperationRow(ctx.database, );
    return row ? backupCleanupOperationFromRow(row) : null;
}

/**
 * Reads the singleton cleanup journal row inside or outside a caller-owned transaction.
 * @return {BackupCleanupOperationRow | undefined} Active cleanup storage row.
 */
export function readBackupCleanupOperationRow(database: DatabaseSync): BackupCleanupOperationRow | undefined {
    const statement = database.prepare(`
            SELECT
                operation_id,
                backup_set_id,
                snapshot_id,
                backup_sequence,
                root_digest,
                snapshot_directory_name,
                quarantine_directory_name,
                phase,
                operation_version
            FROM backup_cleanup_operations
            WHERE singleton = 1
        `);
    statement.setReadBigInts(true);
    return statement.get() as BackupCleanupOperationRow | undefined;
}

/**
 * Releases a planned cleanup only after PROTECT proves no quarantine rename occurred.
 * @param {string} operationId - Persisted cleanup operation UUID.
 * @return {void}
 */
export function releasePlannedBackupCleanup(ctx: StoreContext, operationId: string): void {
    ctx.requireBackupMutationAllowed();
    if (!isCanonicalUuid(operationId)) {
        throw new TypeError('Backup cleanup operation identity is invalid');
    }
    try {
        ctx.database.exec('BEGIN IMMEDIATE');
        const cleanup = readBackupCleanupOperationRow(ctx.database, );
        if (!cleanup) {
            ctx.database.exec('COMMIT');
            return;
        }
        if (cleanup.operation_id !== operationId || cleanup.phase !== 'planned') {
            throw new Error('Backup cleanup operation cannot be released');
        }
        ctx.database.prepare(`
                DELETE FROM backup_cleanup_operations
                WHERE singleton = 1 AND operation_id = ? AND phase = 'planned'
            `).run(operationId);
        ctx.database.exec('COMMIT');
    }
    catch (error) {
        if (ctx.database.isTransaction) {
            ctx.database.exec('ROLLBACK');
        }
        throw error;
    }
}

/**
 * Records that same-parent quarantine rename has completed.
 * @param {string} operationId - Persisted cleanup operation UUID.
 * @return {BackupCleanupOperation} Idempotently quarantined cleanup facts.
 */
export function markBackupCleanupQuarantined(ctx: StoreContext, operationId: string): BackupCleanupOperation {
    ctx.requireBackupMutationAllowed();
    if (!isCanonicalUuid(operationId)) {
        throw new TypeError('Backup cleanup operation identity is invalid');
    }
    try {
        ctx.database.exec('BEGIN IMMEDIATE');
        const cleanup = readBackupCleanupOperationRow(ctx.database, );
        if (!cleanup || cleanup.operation_id !== operationId) {
            throw new Error('Backup cleanup operation does not exist');
        }
        if (cleanup.phase === 'planned') {
            ctx.database.prepare(`
                    UPDATE backup_cleanup_operations
                    SET phase = 'quarantined', operation_version = 1
                    WHERE singleton = 1
                `).run();
        }
        const updated = readBackupCleanupOperationRow(ctx.database, );
        ctx.database.exec('COMMIT');
        return backupCleanupOperationFromRow(updated!);
    }
    catch (error) {
        if (ctx.database.isTransaction) {
            ctx.database.exec('ROLLBACK');
        }
        throw error;
    }
}

/**
 * Records the fully revalidated checkpoint that authorizes exact physical deletion.
 * @param {string} operationId - Persisted cleanup operation UUID.
 * @return {BackupCleanupOperation} Idempotently deletion-authorized cleanup facts.
 */
export function markBackupCleanupDeleting(ctx: StoreContext, operationId: string): BackupCleanupOperation {
    ctx.requireBackupMutationAllowed();
    if (!isCanonicalUuid(operationId)) {
        throw new TypeError('Backup cleanup operation identity is invalid');
    }
    try {
        ctx.database.exec('BEGIN IMMEDIATE');
        const cleanup = readBackupCleanupOperationRow(ctx.database, );
        if (!cleanup || cleanup.operation_id !== operationId || cleanup.phase === 'planned') {
            throw new Error('Backup cleanup operation is not quarantined');
        }
        if (cleanup.phase === 'quarantined') {
            ctx.database.prepare(`
                    UPDATE backup_cleanup_operations
                    SET phase = 'deleting', operation_version = 2
                    WHERE singleton = 1
                `).run();
        }
        const updated = readBackupCleanupOperationRow(ctx.database, );
        ctx.database.exec('COMMIT');
        return backupCleanupOperationFromRow(updated!);
    }
    catch (error) {
        if (ctx.database.isTransaction) {
            ctx.database.exec('ROLLBACK');
        }
        throw error;
    }
}

/**
 * Forgets one physically deleted quarantined snapshot and its succeeded operation atomically.
 * @param {string} operationId - Persisted cleanup operation UUID.
 * @return {void}
 */
export function completeBackupCleanup(ctx: StoreContext, operationId: string): void {
    ctx.requireBackupMutationAllowed();
    if (!isCanonicalUuid(operationId)) {
        throw new TypeError('Backup cleanup operation identity is invalid');
    }
    try {
        ctx.database.exec('BEGIN IMMEDIATE');
        const cleanup = readBackupCleanupOperationRow(ctx.database, );
        if (!cleanup) {
            ctx.database.exec('COMMIT');
            return;
        }
        if (cleanup.operation_id !== operationId || cleanup.phase !== 'deleting') {
            throw new Error('Backup cleanup operation is not ready to complete');
        }
        const snapshotStatement = ctx.database.prepare(`
                SELECT snapshot.operation_id, count(newer.snapshot_id) AS newer_snapshot_count
                FROM backup_snapshots AS snapshot
                LEFT JOIN backup_snapshots AS newer
                    ON newer.backup_set_id = snapshot.backup_set_id
                    AND newer.backup_sequence > snapshot.backup_sequence
                WHERE snapshot.snapshot_id = ?
                    AND snapshot.backup_set_id = ?
                    AND snapshot.backup_sequence = ?
                    AND snapshot.root_digest = ?
                GROUP BY snapshot.operation_id
            `);
        snapshotStatement.setReadBigInts(true);
        const snapshot = snapshotStatement.get(
            cleanup.snapshot_id,
            cleanup.backup_set_id,
            cleanup.backup_sequence,
            cleanup.root_digest,
        ) as {operation_id: string; newer_snapshot_count: bigint} | undefined;
        if (!snapshot || snapshot.newer_snapshot_count < 2n) {
            throw new Error('Backup cleanup would violate retention');
        }
        ctx.database.prepare('DELETE FROM backup_snapshots WHERE snapshot_id = ?')
            .run(cleanup.snapshot_id);
        ctx.database.prepare('DELETE FROM backup_operations WHERE operation_id = ?')
            .run(snapshot.operation_id);
        ctx.database.prepare('DELETE FROM backup_cleanup_operations WHERE singleton = 1')
            .run();
        ctx.database.exec('COMMIT');
    }
    catch (error) {
        if (ctx.database.isTransaction) {
            ctx.database.exec('ROLLBACK');
        }
        throw error;
    }
}
