import { LEVEL_10_DDL, LEVEL_10_RECEIPT_DDL, LEVEL_10_TABLES } from './level-10';
export const LEVEL_11_SETUP_DRAFT_DDL = `
    CREATE TABLE setup_draft_checkpoint (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        checkpoint_version INTEGER NOT NULL CHECK (checkpoint_version >= 0),
        schema_version INTEGER CHECK (schema_version IS NULL OR schema_version = 1),
        updated_at TEXT,
        opaque_payload TEXT,
        CHECK (
            (schema_version IS NULL AND updated_at IS NULL AND opaque_payload IS NULL)
            OR (schema_version = 1 AND updated_at IS NOT NULL AND opaque_payload IS NOT NULL)
        ),
        FOREIGN KEY (singleton) REFERENCES workspace_state(singleton) ON DELETE RESTRICT
    ) STRICT;
`;

export const LEVEL_11_RECEIPT_DDL = LEVEL_10_RECEIPT_DDL.replace(
    "                'plan.undo-task-occurrence-state'",
    `                'plan.undo-task-occurrence-state',
                'plan.create-course',
                'plan.create-meeting-series'`,
);

export const LEVEL_11_DDL = LEVEL_10_DDL.replace(LEVEL_10_RECEIPT_DDL, LEVEL_11_RECEIPT_DDL)
    + LEVEL_11_SETUP_DRAFT_DDL;

export const LEVEL_11_TABLES = [
    ...LEVEL_10_TABLES,
    'setup_draft_checkpoint',
] as const;
