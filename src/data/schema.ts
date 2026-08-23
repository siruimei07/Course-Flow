import { DatabaseSync } from 'node:sqlite';

import { isCanonicalUuid } from '../shared/workspace-data-contract';

export const COURSEFLOW_APPLICATION_ID = 0x43464C57;
export const CURRENT_SCHEMA_LEVEL = 2;

const UUID_CHECK = `
    length(%COLUMN%) = 36
    AND %COLUMN% = lower(%COLUMN%)
    AND substr(%COLUMN%, 9, 1) = '-'
    AND substr(%COLUMN%, 14, 1) = '-'
    AND substr(%COLUMN%, 19, 1) = '-'
    AND substr(%COLUMN%, 24, 1) = '-'
    AND %COLUMN% NOT GLOB '*[^0-9a-f-]*'
`;

const workspaceIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'workspace_id');
const commandIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'command_id');
const effectEntityIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'entity_id');
const followUpIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'follow_up_id');
const originatingCommandIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'originating_command_id');
const termIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'term_id');
const currentTermIdCheck = UUID_CHECK.replaceAll('%COLUMN%', 'current_term_id');

const LEVEL_1_DDL = `
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

const LEVEL_2_RECEIPT_DDL = `
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

const LEVEL_2_PLAN_DDL = `
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

const LEVEL_2_DDL = LEVEL_1_DDL
    .replace(
        LEVEL_1_DDL.slice(
            LEVEL_1_DDL.indexOf('    CREATE TABLE command_receipts'),
            LEVEL_1_DDL.indexOf('    CREATE TABLE durable_followups'),
        ),
        LEVEL_2_RECEIPT_DDL,
    )
    + LEVEL_2_PLAN_DDL;

const TABLE_COLUMNS = {
    workspace_state: [
        ['singleton', 'INTEGER', 0, 1],
        ['workspace_id', 'TEXT', 1, 0],
        ['revision', 'INTEGER', 1, 0],
    ],
    setup_state: [
        ['singleton', 'INTEGER', 0, 1],
        ['last_decision', 'TEXT', 0, 0],
        ['setup_decision_version', 'INTEGER', 1, 0],
        ['ever_reached_minimum', 'INTEGER', 1, 0],
    ],
    command_receipts: [
        ['command_id', 'TEXT', 1, 1],
        ['intent_kind', 'TEXT', 1, 0],
        ['intent_schema_version', 'INTEGER', 1, 0],
        ['canonical_encoding', 'TEXT', 1, 0],
        ['digest_algorithm', 'TEXT', 1, 0],
        ['payload_digest', 'BLOB', 1, 0],
        ['committed_revision', 'INTEGER', 1, 0],
        ['result_kind', 'TEXT', 1, 0],
    ],
    receipt_effects: [
        ['command_id', 'TEXT', 1, 1],
        ['effect_order', 'INTEGER', 1, 2],
        ['effect_code', 'TEXT', 1, 0],
        ['entity_kind', 'TEXT', 1, 0],
        ['entity_id', 'TEXT', 1, 0],
        ['entity_version', 'INTEGER', 1, 0],
    ],
    durable_followups: [
        ['follow_up_id', 'TEXT', 1, 1],
        ['originating_command_id', 'TEXT', 1, 0],
        ['owner', 'TEXT', 1, 0],
        ['kind', 'TEXT', 1, 0],
        ['prerequisite_revision', 'INTEGER', 1, 0],
        ['state', 'TEXT', 1, 0],
        ['follow_up_version', 'INTEGER', 1, 0],
    ],
    protection_watermarks: [
        ['singleton', 'INTEGER', 0, 1],
        ['backup_needed_through', 'INTEGER', 1, 0],
        ['backup_succeeded_through', 'INTEGER', 1, 0],
    ],
    terms: [
        ['term_id', 'TEXT', 1, 1],
        ['name', 'TEXT', 1, 0],
        ['start_date', 'TEXT', 1, 0],
        ['end_date', 'TEXT', 1, 0],
        ['time_zone', 'TEXT', 1, 0],
        ['archived', 'INTEGER', 1, 0],
        ['entity_version', 'INTEGER', 1, 0],
    ],
    plan_state: [
        ['singleton', 'INTEGER', 0, 1],
        ['current_term_id', 'TEXT', 0, 0],
        ['plan_entity_version', 'INTEGER', 1, 0],
    ],
} as const;

const FOREIGN_KEYS = {
    workspace_state: [],
    setup_state: [['singleton', 'workspace_state', 'singleton']],
    command_receipts: [],
    receipt_effects: [['command_id', 'command_receipts', 'command_id']],
    durable_followups: [['originating_command_id', 'command_receipts', 'command_id']],
    protection_watermarks: [['singleton', 'workspace_state', 'singleton']],
    terms: [],
    plan_state: [
        ['current_term_id', 'terms', 'term_id'],
        ['singleton', 'workspace_state', 'singleton'],
    ],
} as const;

const LEVEL_1_TABLES = [
    'workspace_state',
    'setup_state',
    'command_receipts',
    'receipt_effects',
    'durable_followups',
    'protection_watermarks',
] as const;

type CurrentTable = keyof typeof TABLE_COLUMNS;

export type SchemaFacts = Readonly<{
    workspaceId: string;
    revision: bigint;
}>;

export type SchemaValidationFailureReason = 'schema-mismatch' | 'database-corrupt';

export class SchemaValidationError extends Error {
    public constructor(public readonly reason: SchemaValidationFailureReason) {
        super('Workspace schema validation failed');
        this.name = 'SchemaValidationError';
    }
}

function rejectSchema(reason: SchemaValidationFailureReason = 'schema-mismatch'): never {
    throw new SchemaValidationError(reason);
}

function tableNames(level: 1 | 2): readonly CurrentTable[] {
    return level === 1
        ? LEVEL_1_TABLES
        : Object.keys(TABLE_COLUMNS) as CurrentTable[];
}

function pragmaValue(database: DatabaseSync, pragma: string, field: string): unknown {
    const row = database.prepare(`PRAGMA ${pragma}`).get() as Record<string, unknown> | undefined;
    return row?.[field];
}

function equalRows(actual: readonly unknown[], expected: readonly unknown[]): boolean {
    return JSON.stringify(actual) === JSON.stringify(expected);
}

function normalizeTableSql(sql: string): string {
    return sql
        .replaceAll(/\s+/g, ' ')
        .replaceAll(/\s*([(),=<>])\s*/g, '$1')
        .trim()
        .toLowerCase();
}

function expectedTableSql(table: CurrentTable, level: 1 | 2): string {
    const ddl = level === 1 ? LEVEL_1_DDL : LEVEL_2_DDL;
    const statement = ddl
        .split(';')
        .find((candidate) => candidate.includes(`CREATE TABLE ${table} `));
    if (!statement) {
        rejectSchema();
    }
    return normalizeTableSql(statement);
}

function validateTables(database: DatabaseSync, level: 1 | 2): void {
    const expectedNames = Array.from(tableNames(level)).sort();
    const rows = database.prepare('PRAGMA table_list').all() as Array<{
        name: string;
        type: string;
        strict: number;
    }>;
    const actualNames = rows
        .filter((row) => row.type === 'table' && !row.name.startsWith('sqlite_'))
        .map((row) => row.name)
        .sort();
    if (!equalRows(actualNames, expectedNames)
        || !rows.filter((row) => actualNames.includes(row.name)).every((row) => row.strict === 1)) {
        rejectSchema();
    }

    const definitions = database.prepare(
        "SELECT name, sql FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all() as Array<{ name: CurrentTable; sql: string | null }>;
    if (definitions.length !== expectedNames.length
        || definitions.some((definition) => definition.sql === null
            || normalizeTableSql(definition.sql) !== expectedTableSql(definition.name, level))) {
        rejectSchema();
    }
}

function validateColumnsAndForeignKeys(database: DatabaseSync, table: CurrentTable): void {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
        name: string;
        type: string;
        notnull: number;
        pk: number;
    }>;
    const actualColumns = columns.map((column) => [
        column.name,
        column.type,
        column.notnull,
        column.pk,
    ]);
    if (!equalRows(actualColumns, TABLE_COLUMNS[table])) {
        rejectSchema();
    }

    const foreignKeys = database.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{
        from: string;
        table: string;
        to: string;
        on_delete: string;
        on_update: string;
        match: string;
    }>;
    const actualForeignKeys = foreignKeys.map((foreignKey) => [
        foreignKey.from,
        foreignKey.table,
        foreignKey.to,
    ]);
    if (!equalRows(actualForeignKeys, FOREIGN_KEYS[table])
        || !foreignKeys.every((foreignKey) => foreignKey.on_delete === 'RESTRICT'
            && foreignKey.on_update === 'NO ACTION'
            && foreignKey.match === 'NONE')) {
        rejectSchema();
    }
}

function validateIndexes(database: DatabaseSync, table: CurrentTable): void {
    const indexRows = database.prepare(`PRAGMA index_list(${table})`).all() as Array<{
        name: string;
        unique: number;
        origin: string;
        partial: number;
    }>;
    const customIndexes = indexRows.filter((index) => index.origin === 'c').map((index) => [
        index.name,
        index.unique,
        index.origin,
        index.partial,
    ]);
    const expectedIndexes = table === 'durable_followups'
        ? [['durable_followups_by_command', 0, 'c', 0]]
        : [];
    if (!equalRows(customIndexes, expectedIndexes)) {
        rejectSchema();
    }

    if (table === 'durable_followups') {
        const indexColumns = database.prepare('PRAGMA index_xinfo(durable_followups_by_command)').all() as Array<{
            seqno: number;
            cid: number;
            name: string | null;
            desc: number;
            coll: string;
            key: number;
        }>;
        const keyColumns = indexColumns
            .filter((column) => column.key === 1)
            .map((column) => [
                column.seqno,
                column.cid,
                column.name,
                column.desc,
                column.coll,
                column.key,
            ]);
        if (!equalRows(keyColumns, [[0, 1, 'originating_command_id', 0, 'BINARY', 1]])) {
            rejectSchema();
        }
    }
}

function validateBootstrapFacts(database: DatabaseSync, level: 1 | 2): SchemaFacts {
    const workspace = database.prepare(
        'SELECT workspace_id, revision FROM workspace_state WHERE singleton = 1',
    );
    workspace.setReadBigInts(true);
    const workspaceRow = workspace.get() as { workspace_id: string; revision: bigint } | undefined;
    const setup = database.prepare(
        'SELECT last_decision, setup_decision_version, ever_reached_minimum FROM setup_state WHERE singleton = 1',
    );
    setup.setReadBigInts(true);
    const setupRow = setup.get() as {
        last_decision: 'later' | 'skip' | null;
        setup_decision_version: bigint;
        ever_reached_minimum: bigint;
    } | undefined;
    const watermarks = database.prepare(
        'SELECT backup_needed_through, backup_succeeded_through FROM protection_watermarks WHERE singleton = 1',
    );
    watermarks.setReadBigInts(true);
    const watermarkRow = watermarks.get() as {
        backup_needed_through: bigint;
        backup_succeeded_through: bigint;
    } | undefined;
    const singletonCounts = database.prepare(`
        SELECT
            (SELECT count(*) FROM workspace_state) AS workspace_count,
            (SELECT count(*) FROM setup_state) AS setup_count,
            (SELECT count(*) FROM protection_watermarks) AS watermark_count
    `);
    singletonCounts.setReadBigInts(true);
    const counts = singletonCounts.get() as {
        workspace_count: bigint;
        setup_count: bigint;
        watermark_count: bigint;
    } | undefined;

    if (!workspaceRow
        || !setupRow
        || !watermarkRow
        || !counts
        || counts.workspace_count !== 1n
        || counts.setup_count !== 1n
        || counts.watermark_count !== 1n
        || !isCanonicalUuid(workspaceRow.workspace_id)
        || workspaceRow.revision < 0n
        || (setupRow.last_decision !== null
            && setupRow.last_decision !== 'later'
            && setupRow.last_decision !== 'skip')
        || setupRow.setup_decision_version < 0n
        || (setupRow.ever_reached_minimum !== 0n && setupRow.ever_reached_minimum !== 1n)
        || watermarkRow.backup_needed_through < 0n
        || watermarkRow.backup_succeeded_through < 0n
        || watermarkRow.backup_succeeded_through > watermarkRow.backup_needed_through
        || watermarkRow.backup_needed_through > workspaceRow.revision) {
        rejectSchema();
    }

    if (level === 2) {
        const plan = database.prepare(
            'SELECT current_term_id, plan_entity_version FROM plan_state WHERE singleton = 1',
        );
        plan.setReadBigInts(true);
        const planRow = plan.get() as {
            current_term_id: string | null;
            plan_entity_version: bigint;
        } | undefined;
        const count = database.prepare('SELECT count(*) AS count FROM plan_state');
        count.setReadBigInts(true);
        if (!planRow
            || (count.get() as { count: bigint }).count !== 1n
            || planRow.plan_entity_version < 0n
            || (planRow.current_term_id !== null && !isCanonicalUuid(planRow.current_term_id))) {
            rejectSchema();
        }
    }

    return {
        workspaceId: workspaceRow.workspace_id,
        revision: workspaceRow.revision,
    };
}

function validateSchema(database: DatabaseSync, level: 1 | 2): SchemaFacts {
    if (pragmaValue(database, 'application_id', 'application_id') !== COURSEFLOW_APPLICATION_ID
        || pragmaValue(database, 'user_version', 'user_version') !== level) {
        rejectSchema();
    }

    validateTables(database, level);
    for (const table of tableNames(level)) {
        validateColumnsAndForeignKeys(database, table);
        validateIndexes(database, table);
    }

    const forbiddenSchemaObjects = database.prepare(
        "SELECT count(*) AS count FROM sqlite_schema WHERE type IN ('trigger', 'view')",
    ).get() as { count: number };
    if (forbiddenSchemaObjects.count !== 0) {
        rejectSchema();
    }
    if (pragmaValue(database, 'integrity_check', 'integrity_check') !== 'ok'
        || (database.prepare('PRAGMA foreign_key_check').all() as unknown[]).length !== 0) {
        rejectSchema('database-corrupt');
    }

    return validateBootstrapFacts(database, level);
}

export function migrateLevel0To1(database: DatabaseSync): void {
    database.exec(LEVEL_1_DDL);
}

export function migrateLevel1To2(database: DatabaseSync): void {
    database.exec(`
        ALTER TABLE command_receipts RENAME TO command_receipts_level_1;
        ALTER TABLE receipt_effects RENAME TO receipt_effects_level_1;
        ALTER TABLE durable_followups RENAME TO durable_followups_level_1;
        DROP INDEX durable_followups_by_command;

        ${LEVEL_2_RECEIPT_DDL}

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

        INSERT INTO command_receipts SELECT * FROM command_receipts_level_1;
        INSERT INTO receipt_effects SELECT * FROM receipt_effects_level_1;
        INSERT INTO durable_followups SELECT * FROM durable_followups_level_1;

        DROP TABLE receipt_effects_level_1;
        DROP TABLE durable_followups_level_1;
        DROP TABLE command_receipts_level_1;

        ${LEVEL_2_PLAN_DDL}
        INSERT INTO plan_state (singleton, current_term_id, plan_entity_version)
            VALUES (1, NULL, 0);
        UPDATE workspace_state SET revision = revision + 1 WHERE singleton = 1;
        UPDATE protection_watermarks
            SET backup_needed_through = (
                SELECT revision FROM workspace_state WHERE singleton = 1
            )
            WHERE singleton = 1;
        PRAGMA user_version = 2;
    `);
}

export function createSchemaLevel2(database: DatabaseSync): void {
    database.exec(LEVEL_2_DDL);
}

export function validateSchemaLevel1(database: DatabaseSync): SchemaFacts {
    return validateSchema(database, 1);
}

export function validateSchemaLevel2(database: DatabaseSync): SchemaFacts {
    return validateSchema(database, 2);
}
