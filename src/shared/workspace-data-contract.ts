import type { CanonicalValue } from './canonical-json';

export type RecordSetupDecisionCommand = Readonly<{
    commandId: string;
    workspaceId: string;
    intent: Readonly<{
        kind: 'workspace.record-setup-decision';
        intentSchemaVersion: 1;
        payload: Readonly<{ decision: 'later' | 'skip' }>;
    }>;
    expectedRevision: string;
    expectedSetupVersion: string;
    followUpId: string;
}>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SQLITE_INTEGER_MAX = '9223372036854775807';

export function isCanonicalUuid(value: unknown): value is string {
    return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function isCanonicalUnsignedSqliteInteger(value: unknown): value is string {
    if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) {
        return false;
    }
    return value.length < SQLITE_INTEGER_MAX.length
        || (value.length === SQLITE_INTEGER_MAX.length && value <= SQLITE_INTEGER_MAX);
}

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

export function normalizeRecordSetupDecisionCommand(value: unknown): RecordSetupDecisionCommand {
    if (!hasExactDataKeys(value, [
        'commandId',
        'workspaceId',
        'intent',
        'followUpId',
        'expectedRevision',
        'expectedSetupVersion',
    ])) {
        throw new TypeError('RecordSetupDecisionCommand has unexpected fields');
    }

    if (!isCanonicalUuid(value.commandId)
        || !isCanonicalUuid(value.workspaceId)
        || !isCanonicalUuid(value.followUpId)
        || !isCanonicalUnsignedSqliteInteger(value.expectedRevision)
        || !isCanonicalUnsignedSqliteInteger(value.expectedSetupVersion)
        || !hasExactDataKeys(value.intent, ['kind', 'intentSchemaVersion', 'payload'])) {
        throw new TypeError('RecordSetupDecisionCommand has invalid fields');
    }

    if (value.intent.kind !== 'workspace.record-setup-decision'
        || value.intent.intentSchemaVersion !== 1
        || !hasExactDataKeys(value.intent.payload, ['decision'])
        || (value.intent.payload.decision !== 'later' && value.intent.payload.decision !== 'skip')) {
        throw new TypeError('RecordSetupDecisionCommand has invalid intent');
    }

    return {
        commandId: value.commandId,
        workspaceId: value.workspaceId,
        intent: {
            kind: 'workspace.record-setup-decision',
            intentSchemaVersion: 1,
            payload: { decision: value.intent.payload.decision },
        },
        followUpId: value.followUpId,
        expectedRevision: value.expectedRevision,
        expectedSetupVersion: value.expectedSetupVersion,
    };
}

export function recordSetupDecisionDigestProjection(command: RecordSetupDecisionCommand): CanonicalValue {
    return {
        encoding: 'courseflow-canonical-json-v1',
        intent: command.intent,
        expectedRevision: command.expectedRevision,
        expectedEntityVersions: [{
            entityKind: 'workspace-setup',
            entityId: command.workspaceId,
            version: command.expectedSetupVersion,
        }],
        durableFollowUps: [{
            followUpId: command.followUpId,
            owner: 'protect',
            kind: 'backup-needed-through',
        }],
    };
}
