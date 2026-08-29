import { LEVEL_12_RECEIPT_DDL } from './level-12';
import { LEVEL_16_DDL, LEVEL_16_RESTORE_COMPLETION_DDL, LEVEL_16_RESTORE_SESSION_DDL, LEVEL_16_TABLES } from './level-16';

/**
 * Widens the receipt ledger for the explicit Current Term reset.
 *
 * Only the intent kind and its single effect are added; every existing receipt row
 * stays valid, so the migration copies the ledger across unchanged.
 *
 * @const
 * @type {string}
 */
export const LEVEL_17_RECEIPT_DDL = LEVEL_12_RECEIPT_DDL
    .replace(
        "                'protect.configure-backup-destination'",
        `                'protect.configure-backup-destination',
                'plan.reset-current-term'`,
    )
    .replace(
        `            OR (effect_code = 'protect.backup-destination-configured'
                AND entity_kind = 'backup-configuration')`,
        `            OR (effect_code = 'protect.backup-destination-configured'
                AND entity_kind = 'backup-configuration')
            OR (effect_code = 'plan.current-term-reset' AND entity_kind = 'term')`,
    );

/**
 * Accepts Restore candidates prepared at the new level without changing any column.
 *
 * @const
 * @type {string}
 */
export const LEVEL_17_RESTORE_SESSION_DDL = LEVEL_16_RESTORE_SESSION_DDL
    .replace('source_schema_level BETWEEN 13 AND 16', 'source_schema_level BETWEEN 13 AND 17')
    .replace('prepared_schema_level BETWEEN 15 AND 16', 'prepared_schema_level BETWEEN 15 AND 17');

export const LEVEL_17_RESTORE_COMPLETION_DDL = LEVEL_16_RESTORE_COMPLETION_DDL
    .replace('source_schema_level BETWEEN 13 AND 16', 'source_schema_level BETWEEN 13 AND 17')
    .replace('post_migration_schema_level = 16', 'post_migration_schema_level = 17');

export const LEVEL_17_DDL = LEVEL_16_DDL
    .replace(LEVEL_12_RECEIPT_DDL, LEVEL_17_RECEIPT_DDL)
    .replace(LEVEL_16_RESTORE_SESSION_DDL, LEVEL_17_RESTORE_SESSION_DDL)
    .replace(LEVEL_16_RESTORE_COMPLETION_DDL, LEVEL_17_RESTORE_COMPLETION_DDL);

export const LEVEL_17_TABLES = LEVEL_16_TABLES;
