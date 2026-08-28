import { backupSetIdCheck, operationIdCheck, snapshotIdCheck } from '../base';
import { LEVEL_13_DDL, LEVEL_13_TABLES } from './level-13';
export const LEVEL_14_PROTECTION_DDL = `
    CREATE TABLE backup_cleanup_operations (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        operation_id TEXT NOT NULL UNIQUE CHECK (${operationIdCheck}),
        backup_set_id TEXT NOT NULL CHECK (${backupSetIdCheck}),
        snapshot_id TEXT NOT NULL UNIQUE CHECK (${snapshotIdCheck}),
        backup_sequence INTEGER NOT NULL CHECK (backup_sequence > 0),
        root_digest TEXT NOT NULL CHECK (
            length(root_digest) = 64
            AND root_digest = lower(root_digest)
            AND root_digest NOT GLOB '*[^0-9a-f]*'
        ),
        snapshot_directory_name TEXT NOT NULL CHECK (
            snapshot_directory_name = 'snapshot-' || snapshot_id
        ),
        quarantine_directory_name TEXT NOT NULL CHECK (
            quarantine_directory_name = '.quarantine-' || operation_id || '-' || snapshot_id
        ),
        phase TEXT NOT NULL CHECK (phase IN ('planned', 'quarantined', 'deleting')),
        operation_version INTEGER NOT NULL CHECK (
            (phase = 'planned' AND operation_version = 0)
            OR (phase = 'quarantined' AND operation_version = 1)
            OR (phase = 'deleting' AND operation_version = 2)
        )
    ) STRICT;
`;

export const LEVEL_14_DDL = LEVEL_13_DDL + LEVEL_14_PROTECTION_DDL;

export const LEVEL_14_TABLES = [
    ...LEVEL_13_TABLES,
    'backup_cleanup_operations',
] as const;
