import { backupSetIdCheck, originatingCommandIdCheck } from '../base';
import { LEVEL_11_DDL, LEVEL_11_RECEIPT_DDL, LEVEL_11_TABLES } from './level-11';
export const LEVEL_12_RECEIPT_DDL = LEVEL_11_RECEIPT_DDL
    .replace(
        "                'plan.create-meeting-series'",
        `                'plan.create-meeting-series',
                'protect.configure-backup-destination'`,
    )
    .replace(
        "            OR (effect_code = 'plan.task-occurrence-state-undone' AND entity_kind = 'task-series')",
        `            OR (effect_code = 'plan.task-occurrence-state-undone' AND entity_kind = 'task-series')
            OR (effect_code = 'protect.backup-destination-configured'
                AND entity_kind = 'backup-configuration')`,
    );

export const LEVEL_12_PROTECTION_DDL = `
    CREATE TABLE backup_configuration (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        configuration_version INTEGER NOT NULL CHECK (configuration_version >= 0),
        backup_set_id TEXT CHECK (backup_set_id IS NULL OR (${backupSetIdCheck})),
        repository_schema TEXT CHECK (
            repository_schema IS NULL OR repository_schema = 'courseflow-backup-repository-v1'
        ),
        canonical_destination_path TEXT CHECK (
            canonical_destination_path IS NULL
            OR (
                length(canonical_destination_path) BETWEEN 1 AND 32767
                AND instr(canonical_destination_path, char(0)) = 0
            )
        ),
        destination_display_name TEXT CHECK (
            destination_display_name IS NULL
            OR (
                length(destination_display_name) BETWEEN 1 AND 255
                AND destination_display_name = trim(destination_display_name)
            )
        ),
        originating_command_id TEXT CHECK (
            originating_command_id IS NULL OR (${originatingCommandIdCheck})
        ),
        configured_revision INTEGER CHECK (configured_revision IS NULL OR configured_revision > 0),
        CHECK (
            (
                backup_set_id IS NULL
                AND repository_schema IS NULL
                AND canonical_destination_path IS NULL
                AND destination_display_name IS NULL
                AND originating_command_id IS NULL
                AND configured_revision IS NULL
            )
            OR (
                configuration_version > 0
                AND backup_set_id IS NOT NULL
                AND repository_schema IS NOT NULL
                AND canonical_destination_path IS NOT NULL
                AND destination_display_name IS NOT NULL
                AND originating_command_id IS NOT NULL
                AND configured_revision IS NOT NULL
            )
        ),
        FOREIGN KEY (singleton) REFERENCES workspace_state(singleton) ON DELETE RESTRICT,
        FOREIGN KEY (originating_command_id) REFERENCES command_receipts(command_id)
            ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
    ) STRICT;
`;

export const LEVEL_12_DDL = LEVEL_11_DDL.replace(LEVEL_11_RECEIPT_DDL, LEVEL_12_RECEIPT_DDL)
    + LEVEL_12_PROTECTION_DDL;

export const LEVEL_12_TABLES = [
    ...LEVEL_11_TABLES,
    'backup_configuration',
] as const;
