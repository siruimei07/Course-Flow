import { candidateRefCheck, commandIdCheck, libraryRootIdCheck, operationIdCheck, restoreSessionIdCheck, rootGenerationCheck, safetySetIdCheck, snapshotIdCheck, workspaceIdCheck } from '../base';
import { LEVEL_14_DDL, LEVEL_14_TABLES } from './level-14';
export const LEVEL_15_RESTORE_DDL = `
    CREATE TABLE restore_sessions (
        restore_session_id TEXT PRIMARY KEY CHECK (${restoreSessionIdCheck}),
        operation_id TEXT NOT NULL UNIQUE CHECK (${operationIdCheck}),
        candidate_ref TEXT NOT NULL CHECK (${candidateRefCheck}),
        snapshot_id TEXT NOT NULL CHECK (${snapshotIdCheck}),
        candidate_root_digest TEXT NOT NULL CHECK (
            length(candidate_root_digest) = 64
            AND candidate_root_digest = lower(candidate_root_digest)
            AND candidate_root_digest NOT GLOB '*[^0-9a-f]*'
        ),
        candidate_database_digest TEXT NOT NULL CHECK (
            length(candidate_database_digest) = 64
            AND candidate_database_digest = lower(candidate_database_digest)
            AND candidate_database_digest NOT GLOB '*[^0-9a-f]*'
        ),
        source_schema_level INTEGER NOT NULL CHECK (source_schema_level BETWEEN 13 AND 15),
        prepared_schema_level INTEGER NOT NULL CHECK (prepared_schema_level = 15),
        candidate_revision INTEGER NOT NULL CHECK (candidate_revision > 0),
        validation_copy TEXT NOT NULL CHECK (validation_copy IN ('copied', 'migrated')),
        current_workspace_id TEXT NOT NULL CHECK (${workspaceIdCheck.replaceAll(
            'workspace_id',
            'current_workspace_id',
        )}),
        current_revision INTEGER NOT NULL CHECK (current_revision >= 0),
        current_library_kind TEXT NOT NULL CHECK (current_library_kind IN ('absent', 'present')),
        current_library_root_id TEXT CHECK (
            current_library_root_id IS NULL OR (${libraryRootIdCheck})
        ),
        current_root_generation TEXT CHECK (
            current_root_generation IS NULL OR (${rootGenerationCheck})
        ),
        target_binding_version INTEGER NOT NULL CHECK (target_binding_version >= 0),
        term_count INTEGER NOT NULL CHECK (term_count >= 0),
        course_count INTEGER NOT NULL CHECK (course_count >= 0),
        task_series_count INTEGER NOT NULL CHECK (task_series_count >= 0),
        impact_digest TEXT NOT NULL CHECK (
            length(impact_digest) = 64
            AND impact_digest = lower(impact_digest)
            AND impact_digest NOT GLOB '*[^0-9a-f]*'
        ),
        binding_digest TEXT NOT NULL CHECK (
            length(binding_digest) = 64
            AND binding_digest = lower(binding_digest)
            AND binding_digest NOT GLOB '*[^0-9a-f]*'
        ),
        preview_token TEXT CHECK (
            preview_token IS NULL OR (
                length(preview_token) = 64
                AND preview_token = lower(preview_token)
                AND preview_token NOT GLOB '*[^0-9a-f]*'
            )
        ),
        phase TEXT NOT NULL CHECK (
            phase IN ('previewed', 'waiting-decision', 'protection-established')
        ),
        session_version INTEGER NOT NULL CHECK (session_version >= 0),
        problem_code TEXT CHECK (problem_code IS NULL OR problem_code = 'impact-changed'),
        safety_set_id TEXT CHECK (safety_set_id IS NULL OR (${safetySetIdCheck})),
        safety_protected_revision INTEGER CHECK (
            safety_protected_revision IS NULL OR safety_protected_revision >= 0
        ),
        safety_root_digest TEXT CHECK (
            safety_root_digest IS NULL OR (
                length(safety_root_digest) = 64
                AND safety_root_digest = lower(safety_root_digest)
                AND safety_root_digest NOT GLOB '*[^0-9a-f]*'
            )
        ),
        CHECK (
            (validation_copy = 'copied' AND source_schema_level = prepared_schema_level)
            OR (validation_copy = 'migrated' AND source_schema_level < prepared_schema_level)
        ),
        CHECK (
            (current_library_kind = 'absent'
                AND current_library_root_id IS NULL
                AND current_root_generation IS NULL)
            OR (current_library_kind = 'present'
                AND current_library_root_id IS NOT NULL
                AND current_root_generation IS NOT NULL)
        ),
        CHECK (
            (phase = 'previewed'
                AND session_version = 0
                AND preview_token IS NOT NULL
                AND problem_code IS NULL
                AND safety_set_id IS NULL
                AND safety_protected_revision IS NULL
                AND safety_root_digest IS NULL)
            OR (phase = 'waiting-decision'
                AND session_version = 1
                AND preview_token IS NULL
                AND problem_code = 'impact-changed'
                AND safety_set_id IS NULL
                AND safety_protected_revision IS NULL
                AND safety_root_digest IS NULL)
            OR (phase = 'protection-established'
                AND session_version = 1
                AND preview_token IS NULL
                AND problem_code IS NULL
                AND safety_set_id IS NOT NULL
                AND safety_protected_revision = current_revision
                AND safety_root_digest IS NOT NULL)
        )
    ) STRICT;

    CREATE TABLE restore_command_receipts (
        command_id TEXT PRIMARY KEY CHECK (${commandIdCheck}),
        command_kind TEXT NOT NULL CHECK (command_kind IN ('start', 'confirm')),
        payload_digest BLOB NOT NULL CHECK (length(payload_digest) = 32),
        restore_session_id TEXT NOT NULL CHECK (${restoreSessionIdCheck}),
        result_session_version INTEGER NOT NULL CHECK (result_session_version IN (0, 1)),
        FOREIGN KEY (restore_session_id)
            REFERENCES restore_sessions(restore_session_id) ON DELETE RESTRICT
    ) STRICT;

    CREATE INDEX restore_command_receipts_by_session
        ON restore_command_receipts(restore_session_id);
`;

export const LEVEL_15_DDL = LEVEL_14_DDL + LEVEL_15_RESTORE_DDL;

export const LEVEL_15_TABLES = [
    ...LEVEL_14_TABLES,
    'restore_sessions',
    'restore_command_receipts',
] as const;
