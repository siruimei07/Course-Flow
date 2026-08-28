import { commandIdCheck, currentTermIdCheck, effectEntityIdCheck, termIdCheck } from '../base';
import { LEVEL_1_DDL, LEVEL_1_TABLES } from './level-01';
export const LEVEL_2_RECEIPT_DDL = `
    CREATE TABLE command_receipts (
        command_id TEXT PRIMARY KEY CHECK (${commandIdCheck}),
        intent_kind TEXT NOT NULL CHECK (
            intent_kind IN ('workspace.record-setup-decision', 'plan.create-term')
        ),
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
        effect_code TEXT NOT NULL CHECK (
            effect_code IN ('workspace.setup-decision-recorded', 'plan.term-created-current')
        ),
        entity_kind TEXT NOT NULL CHECK (entity_kind IN ('workspace-setup', 'term')),
        entity_id TEXT NOT NULL CHECK (${effectEntityIdCheck}),
        entity_version INTEGER NOT NULL CHECK (entity_version >= 0),
        PRIMARY KEY (command_id, effect_order),
        FOREIGN KEY (command_id) REFERENCES command_receipts(command_id) ON DELETE RESTRICT
    ) STRICT;
`;

export const LEVEL_2_PLAN_DDL = `
    CREATE TABLE terms (
        term_id TEXT PRIMARY KEY CHECK (${termIdCheck}),
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120 AND name = trim(name)),
        start_date TEXT NOT NULL CHECK (
            length(start_date) = 10
            AND substr(start_date, 5, 1) = '-'
            AND substr(start_date, 8, 1) = '-'
            AND start_date NOT GLOB '*[^0-9-]*'
        ),
        end_date TEXT NOT NULL CHECK (
            length(end_date) = 10
            AND substr(end_date, 5, 1) = '-'
            AND substr(end_date, 8, 1) = '-'
            AND end_date NOT GLOB '*[^0-9-]*'
            AND end_date >= start_date
        ),
        time_zone TEXT NOT NULL CHECK (length(time_zone) BETWEEN 1 AND 255),
        archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
        entity_version INTEGER NOT NULL CHECK (entity_version > 0)
    ) STRICT;

    CREATE TABLE plan_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        current_term_id TEXT CHECK (current_term_id IS NULL OR (${currentTermIdCheck})),
        plan_entity_version INTEGER NOT NULL CHECK (plan_entity_version >= 0),
        FOREIGN KEY (singleton) REFERENCES workspace_state(singleton) ON DELETE RESTRICT,
        FOREIGN KEY (current_term_id) REFERENCES terms(term_id) ON DELETE RESTRICT
    ) STRICT;
`;

export const LEVEL_2_DDL = LEVEL_1_DDL
    .replace(
        LEVEL_1_DDL.slice(
            LEVEL_1_DDL.indexOf('    CREATE TABLE command_receipts'),
            LEVEL_1_DDL.indexOf('    CREATE TABLE durable_followups'),
        ),
        LEVEL_2_RECEIPT_DDL,
    )
    + LEVEL_2_PLAN_DDL;

export const LEVEL_2_TABLES = [
    ...LEVEL_1_TABLES,
    'terms',
    'plan_state',
] as const;
