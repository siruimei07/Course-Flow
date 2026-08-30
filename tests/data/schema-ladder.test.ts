/**
 * @file Verifies the schema ladder registers exactly one validator per level and one migration per migratable level.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    CURRENT_SCHEMA_LEVEL,
    SCHEMA_MIGRATIONS,
    SCHEMA_VALIDATORS,
    isMigratableSchemaLevel,
} from '../../src/data/schema';

function registeredLevels(table: Readonly<Record<number, unknown>>): readonly number[] {
    return Object.keys(table).map(Number).sort((left, right) => left - right);
}

function levelRange(from: number, through: number): readonly number[] {
    const levels: number[] = [];
    for (let level = from; level <= through; level += 1) {
        levels.push(level);
    }
    return levels;
}

test('every schema level owns a validator', () => {
    assert.deepEqual(
        registeredLevels(SCHEMA_VALIDATORS),
        levelRange(1, CURRENT_SCHEMA_LEVEL),
    );
});

test('every level below the current one owns a forward migration', () => {
    assert.deepEqual(
        registeredLevels(SCHEMA_MIGRATIONS),
        levelRange(1, CURRENT_SCHEMA_LEVEL - 1),
    );
});

test('the level immediately below the current one is migratable and the current one is not', () => {
    assert.equal(isMigratableSchemaLevel(CURRENT_SCHEMA_LEVEL - 1), true);
    assert.equal(isMigratableSchemaLevel(CURRENT_SCHEMA_LEVEL), false);
    assert.equal(isMigratableSchemaLevel(CURRENT_SCHEMA_LEVEL + 1), false);
    assert.equal(isMigratableSchemaLevel(0), false);
});
