import type { CanonicalValue } from './canonical-json';
import {
    isCanonicalUnsignedSqliteInteger,
    isCanonicalUuid,
} from './workspace-data-contract';

export type TermProjection = Readonly<{
    termId: string;
    name: string;
    startDate: string;
    endDate: string;
    timeZone: string;
    entityVersion: string;
}>;

export type SetupProjection = Readonly<{
    workspaceRevision: string;
    planEntityVersion: string;
    currentTerm: TermProjection | null;
    terms: readonly TermProjection[];
}>;

export type CreateTermCommand = Readonly<{
    commandId: string;
    followUpId: string;
    expectedRevision: string;
    expectedPlanVersion: string;
    intent: Readonly<{
        kind: 'plan.create-term';
        intentSchemaVersion: 1;
        payload: Readonly<{
            name: string;
            startDate: string;
            endDate: string;
            timeZone: string;
        }>;
    }>;
}>;

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_TERM_NAME_LENGTH = 120;

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function hasExactDataKeys(value: unknown, expectedKeys: readonly string[]): value is Record<string, unknown> {
    if (!isPlainObject(value)) {
        return false;
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key === 'symbol') || keys.length !== expectedKeys.length) {
        return false;
    }

    return expectedKeys.every((key) => {
        const descriptor = descriptors[key];
        return descriptor !== undefined
            && 'value' in descriptor
            && descriptor.enumerable
            && expectedKeys.includes(key);
    });
}

function isCanonicalLocalDate(value: unknown): value is string {
    if (typeof value !== 'string') {
        return false;
    }

    const match = LOCAL_DATE_PATTERN.exec(value);
    if (!match) {
        return false;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(year, month - 1, day);
    return date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day;
}

function canonicalTimeZone(value: unknown): string | null {
    if (typeof value !== 'string' || value.length === 0) {
        return null;
    }

    try {
        return new Intl.DateTimeFormat('en-CA', { timeZone: value }).resolvedOptions().timeZone;
    }
    catch {
        return null;
    }
}

export function normalizeCreateTermCommand(value: unknown): CreateTermCommand {
    if (!hasExactDataKeys(value, [
        'commandId',
        'followUpId',
        'expectedRevision',
        'expectedPlanVersion',
        'intent',
    ])
        || !isCanonicalUuid(value.commandId)
        || !isCanonicalUuid(value.followUpId)
        || !isCanonicalUnsignedSqliteInteger(value.expectedRevision)
        || !isCanonicalUnsignedSqliteInteger(value.expectedPlanVersion)
        || !hasExactDataKeys(value.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || value.intent.kind !== 'plan.create-term'
        || value.intent.intentSchemaVersion !== 1
        || !hasExactDataKeys(value.intent.payload, ['name', 'startDate', 'endDate', 'timeZone'])) {
        throw new TypeError('CreateTermCommand has invalid fields');
    }

    const name = typeof value.intent.payload.name === 'string'
        ? value.intent.payload.name.trim()
        : '';
    const startDate = value.intent.payload.startDate;
    const endDate = value.intent.payload.endDate;
    const timeZone = canonicalTimeZone(value.intent.payload.timeZone);
    if (name.length === 0
        || name.length > MAX_TERM_NAME_LENGTH
        || !isCanonicalLocalDate(startDate)
        || !isCanonicalLocalDate(endDate)
        || endDate < startDate
        || timeZone === null) {
        throw new TypeError('CreateTermCommand has invalid Term fields');
    }

    return {
        commandId: value.commandId,
        followUpId: value.followUpId,
        expectedRevision: value.expectedRevision,
        expectedPlanVersion: value.expectedPlanVersion,
        intent: {
            kind: 'plan.create-term',
            intentSchemaVersion: 1,
            payload: { name, startDate, endDate, timeZone },
        },
    };
}

export function createTermDigestProjection(command: CreateTermCommand): CanonicalValue {
    return {
        encoding: 'courseflow-canonical-json-v1',
        intent: command.intent,
        expectedRevision: command.expectedRevision,
        expectedEntityVersions: [{
            entityKind: 'plan-state',
            entityId: 'singleton',
            version: command.expectedPlanVersion,
        }],
        durableFollowUps: [{
            followUpId: command.followUpId,
            owner: 'protect',
            kind: 'backup-needed-through',
        }],
    };
}
