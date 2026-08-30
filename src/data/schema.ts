/**
 * @file Public surface of the CourseFlow schema: application identity, per-level DDL modules, creation, migration, and validation.
 */

export { COURSEFLOW_APPLICATION_ID, CURRENT_SCHEMA_LEVEL } from './schema/base';
export {
    SCHEMA_MIGRATIONS,
    SCHEMA_VALIDATORS,
    isMigratableSchemaLevel,
    schemaLadderStep,
    type MigratableSchemaLevel,
    type SchemaLadderStep,
    type SchemaMigration,
    type SchemaValidator,
} from './schema/ladder';
export type { SchemaLevel } from './schema/tables';
export {
    SchemaValidationError,
    type SchemaFacts,
    type SchemaValidationFailureReason,
    validateSchemaLevel1, validateSchemaLevel2, validateSchemaLevel3, validateSchemaLevel4, validateSchemaLevel5, validateSchemaLevel6, validateSchemaLevel7, validateSchemaLevel8,
    validateSchemaLevel9, validateSchemaLevel10, validateSchemaLevel11, validateSchemaLevel12, validateSchemaLevel13, validateSchemaLevel14, validateSchemaLevel15, validateSchemaLevel16, validateSchemaLevel17,
} from './schema/validation';
export {
    migrateLevel0To1, migrateLevel1To2, migrateLevel2To3, migrateLevel3To4, migrateLevel4To5, migrateLevel5To6, migrateLevel6To7, migrateLevel7To8,
    migrateLevel8To9, migrateLevel9To10, migrateLevel10To11, migrateLevel11To12, migrateLevel12To13, migrateLevel13To14, migrateLevel14To15, migrateLevel15To16, migrateLevel16To17,
} from './schema/migrations';
export {
    createSchemaLevel2, createSchemaLevel3, createSchemaLevel4, createSchemaLevel5, createSchemaLevel6, createSchemaLevel7, createSchemaLevel8, createSchemaLevel9,
    createSchemaLevel10, createSchemaLevel11, createSchemaLevel12, createSchemaLevel13, createSchemaLevel14, createSchemaLevel15, createSchemaLevel16, createSchemaLevel17,
} from './schema/create';
