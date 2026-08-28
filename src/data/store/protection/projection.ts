import type { StoreContext } from '../context';
import { readSuccessfulBackupSnapshots } from './backup-operations';
import type { BackupConfigurationForProtection, StoredBackupDestination } from '../types';
import { isCanonicalUuid } from '../../../shared/workspace-data-contract';
import { BACKUP_REPOSITORY_SCHEMA } from '../../../shared/workspace-protection-contract';
import type { DataProtectionProjection } from '../../../shared/workspace-protection-contract';
/**
 * Reads the path-free PROTECT projection from one authoritative row.
 * @return {DataProtectionProjection} Legal unconfigured or configured state.
 */
export function readDataProtectionProjection(ctx: StoreContext): DataProtectionProjection {
    ctx.requireOpen();
    const statement = ctx.database.prepare(`
            SELECT
                workspace_state.revision,
                backup_configuration.configuration_version,
                backup_configuration.backup_set_id,
                backup_configuration.repository_schema,
                backup_configuration.destination_display_name,
                protection_watermarks.backup_needed_through,
                protection_watermarks.backup_succeeded_through,
                backup_cleanup_operations.operation_id AS cleanup_operation_id,
                (
                    SELECT count(*)
                    FROM backup_snapshots
                    WHERE backup_snapshots.backup_set_id = backup_configuration.backup_set_id
                ) AS registered_snapshot_count
            FROM workspace_state
            JOIN backup_configuration
                ON backup_configuration.singleton = workspace_state.singleton
            JOIN protection_watermarks
                ON protection_watermarks.singleton = workspace_state.singleton
            LEFT JOIN backup_cleanup_operations
                ON backup_cleanup_operations.singleton = workspace_state.singleton
            WHERE workspace_state.singleton = 1
        `);
    statement.setReadBigInts(true);
    const row = statement.get() as {
        revision: bigint;
        configuration_version: bigint;
        backup_set_id: string | null;
        repository_schema: typeof BACKUP_REPOSITORY_SCHEMA | null;
        destination_display_name: string | null;
        backup_needed_through: bigint;
        backup_succeeded_through: bigint;
        cleanup_operation_id: string | null;
        registered_snapshot_count: bigint;
    };
    if (row.backup_set_id === null) {
        return Object.freeze({
            workspaceRevision: row.revision.toString(),
            protectionEntityVersion: row.configuration_version.toString(),
            configuration: Object.freeze({kind: 'unconfigured' as const}),
        });
    }
    const snapshots = readSuccessfulBackupSnapshots(ctx, )
        .slice(-2)
        .reverse()
        .map(snapshot => Object.freeze({
            snapshotId: snapshot.snapshotId,
            backupSequence: snapshot.backupSequence,
            actualRevision: snapshot.actualRevision,
            succeededAt: snapshot.succeededAt,
            snapshotFormatVersion: '1' as const,
            integrity: 'verified' as const,
        }));
    const latest = snapshots[0];
    return Object.freeze({
        workspaceRevision: row.revision.toString(),
        protectionEntityVersion: row.configuration_version.toString(),
        configuration: Object.freeze({
            kind: 'configured' as const,
            backupSetId: row.backup_set_id,
            repositorySchema: row.repository_schema!,
            destinationDisplayName: row.destination_display_name!,
        }),
        backup: Object.freeze({
            state: row.backup_needed_through === row.backup_succeeded_through
                ? 'current' as const
                : 'pending' as const,
            neededThrough: row.backup_needed_through.toString(),
            succeededThrough: row.backup_succeeded_through.toString(),
            lastSuccess: latest
                ? Object.freeze({
                    snapshotId: latest.snapshotId,
                    protectedThrough: latest.actualRevision,
                    succeededAt: latest.succeededAt,
                })
                : null,
            recentVerifiedSnapshots: Object.freeze(snapshots),
            restoreCandidates: Object.freeze([]),
            cleanup: row.cleanup_operation_id === null
                && row.registered_snapshot_count <= 2n
                ? 'idle' as const
                : 'pending' as const,
        }),
    });
}

/**
 * Reads the path-bearing internal configuration used only by the PROTECT worker.
 * @return {BackupConfigurationForProtection | null} Current configured BackupSet facts.
 */
export function readBackupConfigurationForProtection(ctx: StoreContext): BackupConfigurationForProtection | null {
    ctx.requireOpen();
    const row = ctx.database.prepare(`
            SELECT
                workspace_state.workspace_id,
                backup_configuration.backup_set_id,
                backup_configuration.canonical_destination_path,
                backup_configuration.destination_display_name,
                backup_configuration.repository_schema
            FROM workspace_state
            JOIN backup_configuration
                ON backup_configuration.singleton = workspace_state.singleton
            WHERE workspace_state.singleton = 1
        `).get() as {
        workspace_id: string;
        backup_set_id: string | null;
        canonical_destination_path: string | null;
        destination_display_name: string | null;
        repository_schema: typeof BACKUP_REPOSITORY_SCHEMA | null;
    };
    if (row.backup_set_id === null) {
        return null;
    }
    return Object.freeze({
        workspaceId: row.workspace_id,
        backupSetId: row.backup_set_id,
        canonicalPath: row.canonical_destination_path!,
        displayName: row.destination_display_name!,
        repositorySchema: row.repository_schema!,
    });
}

/**
 * Recovers accepted destination facts for exact CommandId replay inside Workspace.
 * @param {string} commandId - Durable command identity.
 * @return {StoredBackupDestination | null} Stored internal destination facts.
 */
export function readBackupConfigurationForCommand(ctx: StoreContext, commandId: string): StoredBackupDestination | null {
    ctx.requireOpen();
    if (!isCanonicalUuid(commandId)) {
        throw new TypeError('CommandId must be a canonical UUID');
    }
    const row = ctx.database.prepare(`
            SELECT
                backup_set_id,
                canonical_destination_path,
                destination_display_name,
                repository_schema
            FROM backup_configuration
            WHERE singleton = 1 AND originating_command_id = ?
        `).get(commandId) as {
        backup_set_id: string;
        canonical_destination_path: string;
        destination_display_name: string;
        repository_schema: typeof BACKUP_REPOSITORY_SCHEMA;
    } | undefined;
    return row
        ? Object.freeze({
            backupSetId: row.backup_set_id,
            canonicalPath: row.canonical_destination_path,
            displayName: row.destination_display_name,
            repositorySchema: row.repository_schema,
        })
        : null;
}
