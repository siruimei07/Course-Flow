import { activeWorkspaceIdCheck, operationIdCheck, restoreSessionIdCheck, safetySetIdCheck, snapshotIdCheck } from '../base';
import { LEVEL_14_DDL } from './level-14';
import { LEVEL_15_RESTORE_DDL, LEVEL_15_TABLES } from './level-15';
export const LEVEL_16_RESTORE_SESSION_DDL = LEVEL_15_RESTORE_DDL
    .replace('source_schema_level BETWEEN 13 AND 15', 'source_schema_level BETWEEN 13 AND 16')
    .replace(
        'prepared_schema_level = 15',
        'prepared_schema_level BETWEEN 15 AND 16',
    )
    .replace(
        "phase IN ('previewed', 'waiting-decision', 'protection-established')",
        "phase IN ('previewed', 'waiting-decision', 'protection-established', 'cancelled')",
    )
    .replace(
        "command_kind IN ('start', 'confirm')",
        "command_kind IN ('start', 'confirm', 'cancel')",
    )
    .replace('result_session_version IN (0, 1)', 'result_session_version BETWEEN 0 AND 2')
    .replace(
        `AND safety_root_digest IS NOT NULL)
        )
    ) STRICT;`,
        `AND safety_root_digest IS NOT NULL)
            OR (phase = 'cancelled'
                AND session_version IN (1, 2)
                AND preview_token IS NULL
                AND problem_code IS NULL
                AND (
                    (safety_set_id IS NULL
                        AND safety_protected_revision IS NULL
                        AND safety_root_digest IS NULL)
                    OR (safety_set_id IS NOT NULL
                        AND safety_protected_revision = current_revision
                        AND safety_root_digest IS NOT NULL)
                ))
        )
    ) STRICT;`,
    );

export const LEVEL_16_RESTORE_COMPLETION_DDL = `
    CREATE TABLE restore_completion_receipts (
        operation_id TEXT PRIMARY KEY CHECK (${operationIdCheck}),
        restore_session_id TEXT NOT NULL UNIQUE CHECK (${restoreSessionIdCheck}),
        outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'rolled-back')),
        session_version INTEGER NOT NULL CHECK (session_version = 3),
        source_snapshot_id TEXT NOT NULL CHECK (${snapshotIdCheck.replaceAll(
            'snapshot_id',
            'source_snapshot_id',
        )}),
        source_root_digest TEXT NOT NULL CHECK (
            length(source_root_digest) = 64
            AND source_root_digest = lower(source_root_digest)
            AND source_root_digest NOT GLOB '*[^0-9a-f]*'
        ),
        source_schema_level INTEGER NOT NULL CHECK (source_schema_level BETWEEN 13 AND 16),
        post_migration_schema_level INTEGER NOT NULL CHECK (post_migration_schema_level = 16),
        active_workspace_id TEXT NOT NULL CHECK (${activeWorkspaceIdCheck}),
        active_revision INTEGER NOT NULL CHECK (active_revision >= 0),
        library_state TEXT NOT NULL CHECK (library_state = 'absent'),
        protection_mode TEXT NOT NULL CHECK (protection_mode = 'required'),
        safety_set_id TEXT NOT NULL CHECK (${safetySetIdCheck}),
        plan_digest TEXT NOT NULL CHECK (
            length(plan_digest) = 64
            AND plan_digest = lower(plan_digest)
            AND plan_digest NOT GLOB '*[^0-9a-f]*'
        ),
        precommit_sequence INTEGER NOT NULL CHECK (precommit_sequence > 0),
        precommit_record_digest TEXT NOT NULL CHECK (
            length(precommit_record_digest) = 64
            AND precommit_record_digest = lower(precommit_record_digest)
            AND precommit_record_digest NOT GLOB '*[^0-9a-f]*'
        ),
        route TEXT NOT NULL CHECK (route IN ('setup', 'today')),
        receipt_format_version TEXT NOT NULL CHECK (receipt_format_version = '1'),
        receipt_digest TEXT NOT NULL CHECK (
            length(receipt_digest) = 64
            AND receipt_digest = lower(receipt_digest)
            AND receipt_digest NOT GLOB '*[^0-9a-f]*'
        )
    ) STRICT;
`;

export const LEVEL_16_DDL = LEVEL_14_DDL
    + LEVEL_16_RESTORE_SESSION_DDL
    + LEVEL_16_RESTORE_COMPLETION_DDL;

export const LEVEL_16_TABLES = [
    ...LEVEL_15_TABLES,
    'restore_completion_receipts',
] as const;
