import { backupSetIdCheck, operationIdCheck, snapshotIdCheck } from '../base';
import { LEVEL_12_DDL, LEVEL_12_TABLES } from './level-12';
export const LEVEL_13_PROTECTION_DDL = `
    CREATE TABLE backup_operations (
        operation_id TEXT PRIMARY KEY CHECK (${operationIdCheck}),
        backup_set_id TEXT NOT NULL CHECK (${backupSetIdCheck}),
        backup_sequence INTEGER NOT NULL CHECK (backup_sequence > 0),
        snapshot_id TEXT NOT NULL UNIQUE CHECK (${snapshotIdCheck}),
        target_revision INTEGER NOT NULL CHECK (target_revision > 0),
        actual_revision INTEGER CHECK (
            actual_revision IS NULL OR actual_revision >= target_revision
        ),
        staging_directory_name TEXT NOT NULL CHECK (
            length(staging_directory_name) BETWEEN 1 AND 255
            AND instr(staging_directory_name, '/') = 0
            AND instr(staging_directory_name, char(92)) = 0
        ),
        created_at TEXT NOT NULL,
        phase TEXT NOT NULL CHECK (
            phase IN (
                'queued',
                'database-checkpoint',
                'library-copy',
                'staging-validation',
                'publishing',
                'published-pending-record',
                'succeeded'
            )
        ),
        operation_version INTEGER NOT NULL CHECK (operation_version >= 0),
        UNIQUE (backup_set_id, backup_sequence)
    ) STRICT;

    CREATE TABLE backup_snapshots (
        snapshot_id TEXT PRIMARY KEY CHECK (${snapshotIdCheck}),
        operation_id TEXT NOT NULL UNIQUE CHECK (${operationIdCheck}),
        backup_set_id TEXT NOT NULL CHECK (${backupSetIdCheck}),
        backup_sequence INTEGER NOT NULL CHECK (backup_sequence > 0),
        actual_revision INTEGER NOT NULL CHECK (actual_revision > 0),
        root_digest TEXT NOT NULL CHECK (
            length(root_digest) = 64
            AND root_digest = lower(root_digest)
            AND root_digest NOT GLOB '*[^0-9a-f]*'
        ),
        succeeded_at TEXT NOT NULL,
        UNIQUE (backup_set_id, backup_sequence),
        FOREIGN KEY (operation_id) REFERENCES backup_operations(operation_id) ON DELETE RESTRICT
    ) STRICT;
`;

export const LEVEL_13_DDL = LEVEL_12_DDL
    .replace(
        "state TEXT NOT NULL CHECK (state = 'pending')",
        "state TEXT NOT NULL CHECK (state IN ('pending', 'completed'))",
    )
    .replace(
        'follow_up_version INTEGER NOT NULL CHECK (follow_up_version = 0)',
        'follow_up_version INTEGER NOT NULL CHECK (follow_up_version IN (0, 1))',
    )
    + LEVEL_13_PROTECTION_DDL;

export const LEVEL_13_TABLES = [
    ...LEVEL_12_TABLES,
    'backup_operations',
    'backup_snapshots',
] as const;
