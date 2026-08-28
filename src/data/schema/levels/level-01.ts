import { commandIdCheck, effectEntityIdCheck, followUpIdCheck, originatingCommandIdCheck, workspaceIdCheck } from '../base';
export const LEVEL_1_DDL = `
    CREATE TABLE workspace_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        workspace_id TEXT NOT NULL CHECK (${workspaceIdCheck}),
        revision INTEGER NOT NULL CHECK (revision >= 0)
    ) STRICT;

    CREATE TABLE setup_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        last_decision TEXT CHECK (last_decision IS NULL OR last_decision IN ('later', 'skip')),
        setup_decision_version INTEGER NOT NULL CHECK (setup_decision_version >= 0),
        ever_reached_minimum INTEGER NOT NULL CHECK (ever_reached_minimum IN (0, 1)),
        FOREIGN KEY (singleton) REFERENCES workspace_state(singleton) ON DELETE RESTRICT
    ) STRICT;

    CREATE TABLE command_receipts (
        command_id TEXT PRIMARY KEY CHECK (${commandIdCheck}),
        intent_kind TEXT NOT NULL CHECK (intent_kind = 'workspace.record-setup-decision'),
        intent_schema_version INTEGER NOT NULL CHECK (intent_schema_version = 1),
        canonical_encoding TEXT NOT NULL CHECK (canonical_encoding = 'courseflow-canonical-json-v1'),
        digest_algorithm TEXT NOT NULL CHECK (digest_algorithm = 'sha256'),
        payload_digest BLOB NOT NULL CHECK (length(payload_digest) = 32),
        committed_revision INTEGER NOT NULL CHECK (committed_revision > 0),
        result_kind TEXT NOT NULL CHECK (result_kind = 'committed')
    ) STRICT;

    CREATE TABLE receipt_effects (
        command_id TEXT NOT NULL CHECK (${commandIdCheck}),
        effect_order INTEGER NOT NULL CHECK (effect_order >= 0),
        effect_code TEXT NOT NULL CHECK (effect_code = 'workspace.setup-decision-recorded'),
        entity_kind TEXT NOT NULL CHECK (entity_kind = 'workspace-setup'),
        entity_id TEXT NOT NULL CHECK (${effectEntityIdCheck}),
        entity_version INTEGER NOT NULL CHECK (entity_version >= 0),
        PRIMARY KEY (command_id, effect_order),
        FOREIGN KEY (command_id) REFERENCES command_receipts(command_id) ON DELETE RESTRICT
    ) STRICT;

    CREATE TABLE durable_followups (
        follow_up_id TEXT PRIMARY KEY CHECK (${followUpIdCheck}),
        originating_command_id TEXT NOT NULL CHECK (${originatingCommandIdCheck}),
        owner TEXT NOT NULL CHECK (owner = 'protect'),
        kind TEXT NOT NULL CHECK (kind = 'backup-needed-through'),
        prerequisite_revision INTEGER NOT NULL CHECK (prerequisite_revision > 0),
        state TEXT NOT NULL CHECK (state = 'pending'),
        follow_up_version INTEGER NOT NULL CHECK (follow_up_version = 0),
        FOREIGN KEY (originating_command_id) REFERENCES command_receipts(command_id) ON DELETE RESTRICT
    ) STRICT;

    CREATE INDEX durable_followups_by_command
        ON durable_followups(originating_command_id);

    CREATE TABLE protection_watermarks (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        backup_needed_through INTEGER NOT NULL CHECK (backup_needed_through >= 0),
        backup_succeeded_through INTEGER NOT NULL CHECK (
            backup_succeeded_through >= 0
            AND backup_succeeded_through <= backup_needed_through
        ),
        FOREIGN KEY (singleton) REFERENCES workspace_state(singleton) ON DELETE RESTRICT
    ) STRICT;
`;

export const LEVEL_1_TABLES = [
    'workspace_state',
    'setup_state',
    'command_receipts',
    'receipt_effects',
    'durable_followups',
    'protection_watermarks',
] as const;
