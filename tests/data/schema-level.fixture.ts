/**
 * @file Rebuilds the receipt ledger at an earlier schema level for migration fixtures.
 */

import type { DatabaseSync } from 'node:sqlite';

/**
 * Rebuilds command receipts, effects, follow-ups and Task history at one earlier level.
 *
 * Level 17 widened the accepted intent and effect codes, so a fixture that only drops
 * the tables a later level added is no longer a genuine database at the earlier level.
 * Renames run with foreign keys off and `legacy_alter_table` on, exactly as the real
 * migration path runs them, so `backup_configuration`'s foreign key is left alone.
 *
 * @param {DatabaseSync} database Opened workspace database outside a transaction.
 * @param {string} levelDdl Complete DDL of the target schema level.
 * @return {void}
 */
export function rebuildReceiptLedgerAtLevel(database: DatabaseSync, levelDdl: string): void {
    const statements = levelDdl.split(';');
    const table = (name: string): string => {
        const statement = statements.find(candidate => candidate.includes(`CREATE TABLE ${name} `));
        if (statement === undefined) {
            throw new Error(`Level DDL is missing ${name}`);
        }
        return `${statement};`;
    };
    const index = (name: string): string => {
        const statement = statements.find(candidate => (
            new RegExp(`CREATE (?:UNIQUE )?INDEX\\s+${name}\\b`).test(candidate)
        ));
        if (statement === undefined) {
            throw new Error(`Level DDL is missing index ${name}`);
        }
        return `${statement};`;
    };

    database.exec(`
        PRAGMA foreign_keys = OFF;
        PRAGMA legacy_alter_table = ON;
        ALTER TABLE task_state_history RENAME TO task_state_history_current;
        DROP INDEX task_state_history_by_command;
        ALTER TABLE durable_followups RENAME TO durable_followups_current;
        DROP INDEX durable_followups_by_command;
        ALTER TABLE command_receipts RENAME TO command_receipts_current;
        ALTER TABLE receipt_effects RENAME TO receipt_effects_current;
        PRAGMA legacy_alter_table = OFF;
        ${table('command_receipts')}
        ${table('receipt_effects')}
        ${table('durable_followups')}
        ${table('task_state_history')}
        ${index('durable_followups_by_command')}
        ${index('task_state_history_by_command')}
        INSERT INTO command_receipts SELECT * FROM command_receipts_current;
        INSERT INTO receipt_effects SELECT * FROM receipt_effects_current;
        INSERT INTO durable_followups SELECT * FROM durable_followups_current;
        INSERT INTO task_state_history SELECT * FROM task_state_history_current;
        DROP TABLE task_state_history_current;
        DROP TABLE receipt_effects_current;
        DROP TABLE durable_followups_current;
        DROP TABLE command_receipts_current;
        PRAGMA foreign_keys = ON;
    `);
}
