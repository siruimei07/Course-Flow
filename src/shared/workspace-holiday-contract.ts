/**
 * @file Defines HolidayRange facts, commands, and durable digest projections.
 */

import type { CanonicalValue } from './canonical-json';
import {
    isCanonicalUnsignedSqliteInteger,
    isCanonicalUuid,
} from './workspace-data-contract';
import { isCanonicalLocalDate } from './workspace-term-contract';

export type HolidayRangeProjection = Readonly<{
    holidayRangeId: string;
    termId: string;
    name: string;
    startDate: string;
    endDate: string;
    entityVersion: string;
}>;

type HolidayRangeCommandBase = Readonly<{
    commandId: string;
    followUpId: string;
    expectedRevision: string;
    expectedPlanVersion: string;
}>;

export type CreateHolidayRangeCommand = HolidayRangeCommandBase & Readonly<{
    intent: Readonly<{
        kind: 'plan.create-holiday-range';
        intentSchemaVersion: 1;
        payload: Readonly<{
            termId: string;
            name: string;
            startDate: string;
            endDate: string;
        }>;
    }>;
}>;

type ExistingHolidayRangeCommandBase = HolidayRangeCommandBase & Readonly<{
    expectedHolidayRangeVersion: string;
    overlapDecision: 'review' | 'continue';
}>;

export type UpdateHolidayRangeCommand = ExistingHolidayRangeCommandBase & Readonly<{
    intent: Readonly<{
        kind: 'plan.update-holiday-range';
        intentSchemaVersion: 1;
        payload: Readonly<{
            holidayRangeId: string;
            name: string;
            startDate: string;
            endDate: string;
        }>;
    }>;
}>;

export type DeleteHolidayRangeCommand = ExistingHolidayRangeCommandBase & Readonly<{
    intent: Readonly<{
        kind: 'plan.delete-holiday-range';
        intentSchemaVersion: 1;
        payload: Readonly<{ holidayRangeId: string }>;
    }>;
}>;

export type HolidayRangeCommand =
    | CreateHolidayRangeCommand
    | UpdateHolidayRangeCommand
    | DeleteHolidayRangeCommand;

const MAX_HOLIDAY_RANGE_NAME_LENGTH = 120;

/**
 * Narrows an untrusted value to a plain object with exact enumerable data keys.
 * @param {unknown} value - Candidate structured-clone value.
 * @param {readonly string[]} expectedKeys - Exact allowed keys.
 * @return {boolean} Whether the value has only the expected data properties.
 */
function hasExactDataKeys(value: unknown, expectedKeys: readonly string[]): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        return false;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    return keys.length === expectedKeys.length
        && keys.every(key => typeof key === 'string' && expectedKeys.includes(key))
        && expectedKeys.every(key => {
            const descriptor = descriptors[key];
            return descriptor !== undefined && 'value' in descriptor && descriptor.enumerable;
        });
}

/**
 * Validates an active HolidayRange projection crossing the Workspace seam.
 * @param {unknown} value - Candidate active range projection.
 * @return {boolean} Whether every identity, date, and version fact is canonical.
 */
export function isHolidayRangeProjection(value: unknown): value is HolidayRangeProjection {
    if (!hasExactDataKeys(value, [
        'holidayRangeId',
        'termId',
        'name',
        'startDate',
        'endDate',
        'entityVersion',
    ])) {
        return false;
    }
    return isCanonicalUuid(value.holidayRangeId)
        && isCanonicalUuid(value.termId)
        && typeof value.name === 'string'
        && value.name.length > 0
        && value.name.length <= MAX_HOLIDAY_RANGE_NAME_LENGTH
        && value.name === value.name.trim()
        && isCanonicalLocalDate(value.startDate)
        && isCanonicalLocalDate(value.endDate)
        && value.endDate >= value.startDate
        && isCanonicalUnsignedSqliteInteger(value.entityVersion)
        && value.entityVersion !== '0';
}

/**
 * Normalizes common command identities and optimistic-concurrency versions.
 * @param {unknown} value - Candidate HolidayRange command.
 * @param {readonly string[]} additionalKeys - Variant-specific top-level keys.
 * @return {HolidayRangeCommandBase & Record<string, unknown>} Validated shared fields.
 */
function normalizeCommandBase(
    value: unknown,
    additionalKeys: readonly string[] = [],
): HolidayRangeCommandBase & Record<string, unknown> {
    if (!hasExactDataKeys(value, [
        'commandId',
        'followUpId',
        'expectedRevision',
        'expectedPlanVersion',
        ...additionalKeys,
        'intent',
    ])
        || !isCanonicalUuid(value.commandId)
        || !isCanonicalUuid(value.followUpId)
        || !isCanonicalUnsignedSqliteInteger(value.expectedRevision)
        || !isCanonicalUnsignedSqliteInteger(value.expectedPlanVersion)) {
        throw new TypeError('HolidayRange command has invalid fields');
    }
    return value as HolidayRangeCommandBase & Record<string, unknown>;
}

/**
 * Normalizes a bounded HolidayRange name and inclusive LocalDate pair.
 * @param {unknown} value - Candidate range facts.
 * @param {boolean} includeTermId - Whether the payload creates a range in a Term.
 * @return {Record<string, string>} Canonical range facts.
 */
function normalizeRangePayload(value: unknown, includeTermId: boolean): Record<string, string> {
    const keys = includeTermId
        ? ['termId', 'name', 'startDate', 'endDate']
        : ['holidayRangeId', 'name', 'startDate', 'endDate'];
    if (!hasExactDataKeys(value, keys)) {
        throw new TypeError('HolidayRange payload has invalid fields');
    }
    const identityKey = includeTermId ? 'termId' : 'holidayRangeId';
    const identity = value[identityKey];
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    if (!isCanonicalUuid(identity)
        || name.length === 0
        || name.length > MAX_HOLIDAY_RANGE_NAME_LENGTH
        || !isCanonicalLocalDate(value.startDate)
        || !isCanonicalLocalDate(value.endDate)
        || value.endDate < value.startDate) {
        throw new TypeError('HolidayRange payload has invalid facts');
    }
    return {
        [identityKey]: identity,
        name,
        startDate: value.startDate,
        endDate: value.endDate,
    };
}

/**
 * Normalizes a CreateHolidayRange intent before PLAN evaluation.
 * @param {unknown} value - Candidate command DTO.
 * @return {CreateHolidayRangeCommand} Canonical create command.
 */
export function normalizeCreateHolidayRangeCommand(value: unknown): CreateHolidayRangeCommand {
    const base = normalizeCommandBase(value);
    if (!hasExactDataKeys(base.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || base.intent.kind !== 'plan.create-holiday-range'
        || base.intent.intentSchemaVersion !== 1) {
        throw new TypeError('CreateHolidayRange intent has invalid fields');
    }
    const payload = normalizeRangePayload(base.intent.payload, true);
    return {
        commandId: base.commandId,
        followUpId: base.followUpId,
        expectedRevision: base.expectedRevision,
        expectedPlanVersion: base.expectedPlanVersion,
        intent: {
            kind: 'plan.create-holiday-range',
            intentSchemaVersion: 1,
            payload: {
                termId: payload.termId!,
                name: payload.name!,
                startDate: payload.startDate!,
                endDate: payload.endDate!,
            },
        },
    };
}

/**
 * Normalizes shared fields for an existing HolidayRange mutation.
 * @param {unknown} value - Candidate update or delete command.
 * @return {ExistingHolidayRangeCommandBase & Record<string, unknown>} Canonical shared mutation fields.
 */
function normalizeExistingCommandBase(
    value: unknown,
): ExistingHolidayRangeCommandBase & Record<string, unknown> {
    const base = normalizeCommandBase(value, ['expectedHolidayRangeVersion', 'overlapDecision']);
    if (!isCanonicalUnsignedSqliteInteger(base.expectedHolidayRangeVersion)
        || (base.overlapDecision !== 'review' && base.overlapDecision !== 'continue')) {
        throw new TypeError('HolidayRange mutation has invalid fields');
    }
    return base as ExistingHolidayRangeCommandBase & Record<string, unknown>;
}

/**
 * Normalizes an UpdateHolidayRange intent before PLAN evaluation.
 * @param {unknown} value - Candidate command DTO.
 * @return {UpdateHolidayRangeCommand} Canonical update command.
 */
export function normalizeUpdateHolidayRangeCommand(value: unknown): UpdateHolidayRangeCommand {
    const base = normalizeExistingCommandBase(value);
    if (!hasExactDataKeys(base.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || base.intent.kind !== 'plan.update-holiday-range'
        || base.intent.intentSchemaVersion !== 1) {
        throw new TypeError('UpdateHolidayRange intent has invalid fields');
    }
    const payload = normalizeRangePayload(base.intent.payload, false);
    return {
        commandId: base.commandId,
        followUpId: base.followUpId,
        expectedRevision: base.expectedRevision,
        expectedPlanVersion: base.expectedPlanVersion,
        expectedHolidayRangeVersion: base.expectedHolidayRangeVersion,
        overlapDecision: base.overlapDecision,
        intent: {
            kind: 'plan.update-holiday-range',
            intentSchemaVersion: 1,
            payload: {
                holidayRangeId: payload.holidayRangeId!,
                name: payload.name!,
                startDate: payload.startDate!,
                endDate: payload.endDate!,
            },
        },
    };
}

/**
 * Normalizes a DeleteHolidayRange intent before PLAN evaluation.
 * @param {unknown} value - Candidate command DTO.
 * @return {DeleteHolidayRangeCommand} Canonical delete command.
 */
export function normalizeDeleteHolidayRangeCommand(value: unknown): DeleteHolidayRangeCommand {
    const base = normalizeExistingCommandBase(value);
    if (!hasExactDataKeys(base.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || base.intent.kind !== 'plan.delete-holiday-range'
        || base.intent.intentSchemaVersion !== 1
        || !hasExactDataKeys(base.intent.payload, ['holidayRangeId'])
        || !isCanonicalUuid(base.intent.payload.holidayRangeId)) {
        throw new TypeError('DeleteHolidayRange intent has invalid fields');
    }
    return {
        commandId: base.commandId,
        followUpId: base.followUpId,
        expectedRevision: base.expectedRevision,
        expectedPlanVersion: base.expectedPlanVersion,
        expectedHolidayRangeVersion: base.expectedHolidayRangeVersion,
        overlapDecision: base.overlapDecision,
        intent: {
            kind: 'plan.delete-holiday-range',
            intentSchemaVersion: 1,
            payload: { holidayRangeId: base.intent.payload.holidayRangeId },
        },
    };
}

/**
 * Builds the canonical receipt projection shared by HolidayRange commands.
 * @param {HolidayRangeCommand} command - Normalized create, update, or delete command.
 * @return {CanonicalValue} Stable digest preimage without CommandId.
 */
function holidayRangeDigestProjection(command: HolidayRangeCommand): CanonicalValue {
    const expectedEntityVersions: CanonicalValue[] = [{
        entityKind: 'plan-state',
        entityId: 'singleton',
        version: command.expectedPlanVersion,
    }];
    if ('expectedHolidayRangeVersion' in command) {
        expectedEntityVersions.push({
            entityKind: 'holiday-range',
            entityId: command.intent.payload.holidayRangeId,
            version: command.expectedHolidayRangeVersion,
        });
    }
    return {
        encoding: 'courseflow-canonical-json-v1',
        intent: command.intent,
        ...('overlapDecision' in command ? { overlapDecision: command.overlapDecision } : {}),
        expectedRevision: command.expectedRevision,
        expectedEntityVersions,
        durableFollowUps: [{
            followUpId: command.followUpId,
            owner: 'protect',
            kind: 'backup-needed-through',
        }],
    };
}

/**
 * Builds a CreateHolidayRange digest projection.
 * @param {CreateHolidayRangeCommand} command - Canonical create command.
 * @return {CanonicalValue} Stable digest preimage.
 */
export function createHolidayRangeDigestProjection(command: CreateHolidayRangeCommand): CanonicalValue {
    return holidayRangeDigestProjection(command);
}

/**
 * Builds an UpdateHolidayRange digest projection.
 * @param {UpdateHolidayRangeCommand} command - Canonical update command.
 * @return {CanonicalValue} Stable digest preimage.
 */
export function updateHolidayRangeDigestProjection(command: UpdateHolidayRangeCommand): CanonicalValue {
    return holidayRangeDigestProjection(command);
}

/**
 * Builds a DeleteHolidayRange digest projection.
 * @param {DeleteHolidayRangeCommand} command - Canonical delete command.
 * @return {CanonicalValue} Stable digest preimage.
 */
export function deleteHolidayRangeDigestProjection(command: DeleteHolidayRangeCommand): CanonicalValue {
    return holidayRangeDigestProjection(command);
}
