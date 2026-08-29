import { DatabaseSync } from 'node:sqlite';
import { LEVEL_2_DDL } from './levels/level-02';
import { LEVEL_3_DDL } from './levels/level-03';
import { LEVEL_4_DDL } from './levels/level-04';
import { LEVEL_5_DDL } from './levels/level-05';
import { LEVEL_6_DDL } from './levels/level-06';
import { LEVEL_7_DDL } from './levels/level-07';
import { LEVEL_8_DDL } from './levels/level-08';
import { LEVEL_9_DDL } from './levels/level-09';
import { LEVEL_10_DDL } from './levels/level-10';
import { LEVEL_11_DDL } from './levels/level-11';
import { LEVEL_12_DDL } from './levels/level-12';
import { LEVEL_13_DDL } from './levels/level-13';
import { LEVEL_14_DDL } from './levels/level-14';
import { LEVEL_15_DDL } from './levels/level-15';
import { LEVEL_16_DDL } from './levels/level-16';
import { LEVEL_17_DDL } from './levels/level-17';
export function createSchemaLevel2(database: DatabaseSync): void {
    database.exec(LEVEL_2_DDL);
}

export function createSchemaLevel3(database: DatabaseSync): void {
    database.exec(LEVEL_3_DDL);
}

export function createSchemaLevel4(database: DatabaseSync): void {
    database.exec(LEVEL_4_DDL);
}

/**
 * Creates the retained level 5 schema in an empty database.
 * @param {DatabaseSync} database - Database inside the caller-owned initialization transaction.
 * @return {void}
 */
export function createSchemaLevel5(database: DatabaseSync): void {
    database.exec(LEVEL_5_DDL);
}

/**
 * Creates the retained level 6 schema in an empty database.
 * @param {DatabaseSync} database - Database inside the caller-owned initialization transaction.
 * @return {void}
 */
export function createSchemaLevel6(database: DatabaseSync): void {
    database.exec(LEVEL_6_DDL);
}

/**
 * Creates the retained level 7 schema in an empty database.
 * @param {DatabaseSync} database - Database inside the caller-owned initialization transaction.
 * @return {void}
 */
export function createSchemaLevel7(database: DatabaseSync): void {
    database.exec(LEVEL_7_DDL);
}

/**
 * Creates the complete current level 8 schema in an empty database.
 * @param {DatabaseSync} database - Database inside the caller-owned initialization transaction.
 * @return {void}
 */
export function createSchemaLevel8(database: DatabaseSync): void {
    database.exec(LEVEL_8_DDL);
}

/**
 * Creates the complete current level 9 schema in an empty database.
 * @param {DatabaseSync} database - Database inside the caller-owned initialization transaction.
 * @return {void}
 */
export function createSchemaLevel9(database: DatabaseSync): void {
    database.exec(LEVEL_9_DDL);
}

/**
 * Creates the complete current level 10 schema in an empty database.
 * @param {DatabaseSync} database - Database inside the caller-owned initialization transaction.
 * @return {void}
 */
export function createSchemaLevel10(database: DatabaseSync): void {
    database.exec(LEVEL_10_DDL);
}

/**
 * Creates the complete current level 11 schema in an empty database.
 * @param {DatabaseSync} database - Database inside the caller-owned initialization transaction.
 * @return {void}
 */
export function createSchemaLevel11(database: DatabaseSync): void {
    database.exec(LEVEL_11_DDL);
}

/**
 * Creates the current level 12 schema with PROTECT configuration storage.
 * @param {DatabaseSync} database - Database inside the caller-owned initialization transaction.
 * @return {void}
 */
export function createSchemaLevel12(database: DatabaseSync): void {
    database.exec(LEVEL_12_DDL);
}

/**
 * Creates the current level 13 schema with durable backup operation storage.
 * @param {DatabaseSync} database - Database inside the caller-owned initialization transaction.
 * @return {void}
 */
export function createSchemaLevel13(database: DatabaseSync): void {
    database.exec(LEVEL_13_DDL);
}

/**
 * Creates the current level 14 schema with resumable retention cleanup storage.
 * @param {DatabaseSync} database - Database inside the caller-owned initialization transaction.
 * @return {void}
 */
export function createSchemaLevel14(database: DatabaseSync): void {
    database.exec(LEVEL_14_DDL);
}

/**
 * Creates the current level 15 schema with typed pre-checkpoint RestoreSession storage.
 * @param {DatabaseSync} database - Database inside the caller-owned initialization transaction.
 * @return {void}
 */
export function createSchemaLevel15(database: DatabaseSync): void {
    database.exec(LEVEL_15_DDL);
}

/**
 * Creates the current level 16 schema with typed Restore completion receipts.
 * @param {DatabaseSync} database - Database inside the caller-owned initialization transaction.
 * @return {void}
 */
export function createSchemaLevel16(database: DatabaseSync): void {
    database.exec(LEVEL_16_DDL);
}

/**
 * Creates the complete current level 17 schema in an empty database.
 * @param {DatabaseSync} database - Database inside the caller-owned initialization transaction.
 * @return {void}
 */
export function createSchemaLevel17(database: DatabaseSync): void {
    database.exec(LEVEL_17_DDL);
}
