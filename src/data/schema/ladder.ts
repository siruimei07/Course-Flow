/**
 * @file Exhaustive schema ladder: one validator per level and one forward migration per migratable level.
 */

import { DatabaseSync } from 'node:sqlite';
import { CURRENT_SCHEMA_LEVEL } from './base';
import {
    migrateLevel10To11,
    migrateLevel11To12,
    migrateLevel12To13,
    migrateLevel13To14,
    migrateLevel14To15,
    migrateLevel15To16,
    migrateLevel16To17,
    migrateLevel1To2,
    migrateLevel2To3,
    migrateLevel3To4,
    migrateLevel4To5,
    migrateLevel5To6,
    migrateLevel6To7,
    migrateLevel7To8,
    migrateLevel8To9,
    migrateLevel9To10,
} from './migrations';
import type { SchemaLevel } from './tables';
import {
    validateSchemaLevel1,
    validateSchemaLevel10,
    validateSchemaLevel11,
    validateSchemaLevel12,
    validateSchemaLevel13,
    validateSchemaLevel14,
    validateSchemaLevel15,
    validateSchemaLevel16,
    validateSchemaLevel17,
    validateSchemaLevel2,
    validateSchemaLevel3,
    validateSchemaLevel4,
    validateSchemaLevel5,
    validateSchemaLevel6,
    validateSchemaLevel7,
    validateSchemaLevel8,
    validateSchemaLevel9,
} from './validation';
import type { SchemaFacts } from './validation';

export type SchemaValidator = (database: DatabaseSync) => SchemaFacts;

export type SchemaMigration = (database: DatabaseSync) => void;

export type SchemaLadderStep = Readonly<{
    validateSource: SchemaValidator;
    migrate: SchemaMigration;
    validateTarget: SchemaValidator;
}>;

/**
 * Levels a stored database may sit at before a forward migration: every level except the current one.
 * Raising CURRENT_SCHEMA_LEVEL widens this union, so SCHEMA_MIGRATIONS stops compiling until the new
 * step is registered. That compile error is the guard against the silently skipped level this table replaces.
 */
export type MigratableSchemaLevel = Exclude<SchemaLevel, typeof CURRENT_SCHEMA_LEVEL>;

export const SCHEMA_VALIDATORS: Readonly<Record<SchemaLevel, SchemaValidator>> = Object.freeze({
    1: validateSchemaLevel1,
    2: validateSchemaLevel2,
    3: validateSchemaLevel3,
    4: validateSchemaLevel4,
    5: validateSchemaLevel5,
    6: validateSchemaLevel6,
    7: validateSchemaLevel7,
    8: validateSchemaLevel8,
    9: validateSchemaLevel9,
    10: validateSchemaLevel10,
    11: validateSchemaLevel11,
    12: validateSchemaLevel12,
    13: validateSchemaLevel13,
    14: validateSchemaLevel14,
    15: validateSchemaLevel15,
    16: validateSchemaLevel16,
    17: validateSchemaLevel17,
});

export const SCHEMA_MIGRATIONS: Readonly<Record<MigratableSchemaLevel, SchemaMigration>> = Object.freeze({
    1: migrateLevel1To2,
    2: migrateLevel2To3,
    3: migrateLevel3To4,
    4: migrateLevel4To5,
    5: migrateLevel5To6,
    6: migrateLevel6To7,
    7: migrateLevel7To8,
    8: migrateLevel8To9,
    9: migrateLevel9To10,
    10: migrateLevel10To11,
    11: migrateLevel11To12,
    12: migrateLevel12To13,
    13: migrateLevel13To14,
    14: migrateLevel14To15,
    15: migrateLevel15To16,
    16: migrateLevel16To17,
});

/**
 * Reports whether a stored user_version is a level this build can migrate forward from.
 * @param {number} schemaLevel - Level read from the stored database.
 * @return {boolean} True when a registered forward migration starts at that level.
 */
export function isMigratableSchemaLevel(schemaLevel: number): schemaLevel is MigratableSchemaLevel {
    return Object.prototype.hasOwnProperty.call(SCHEMA_MIGRATIONS, schemaLevel);
}

/**
 * Returns the validate/migrate/validate triple one forward level costs.
 * @param {MigratableSchemaLevel} schemaLevel - Level the stored database currently sits at.
 * @return {SchemaLadderStep} Source validator, forward migration, and target validator for that level.
 */
export function schemaLadderStep(schemaLevel: MigratableSchemaLevel): SchemaLadderStep {
    // Every migratable level is below CURRENT_SCHEMA_LEVEL, so its successor is itself a SchemaLevel.
    const nextLevel = (schemaLevel + 1) as SchemaLevel;
    return Object.freeze({
        validateSource: SCHEMA_VALIDATORS[schemaLevel],
        migrate: SCHEMA_MIGRATIONS[schemaLevel],
        validateTarget: SCHEMA_VALIDATORS[nextLevel],
    });
}
