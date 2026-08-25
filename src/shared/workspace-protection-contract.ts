/**
 * @file Defines bounded PROTECT commands and data-protection projections.
 */

import {
    isCanonicalUnsignedSqliteInteger,
    isCanonicalUuid,
} from './workspace-data-contract';

export const BACKUP_REPOSITORY_SCHEMA = 'courseflow-backup-repository-v1' as const;

export type ConfigureBackupDestinationCommand = Readonly<{
    commandId: string;
    followUpId: string;
    workspaceId: string;
    expectedRevision: string;
    expectedProtectionVersion: string;
    intent: Readonly<{
        kind: 'protect.configure-backup-destination';
        intentSchemaVersion: 1;
        payload: Readonly<Record<never, never>>;
    }>;
}>;

export type AcceptedConfigureBackupDestinationCommand = ConfigureBackupDestinationCommand & Readonly<{
    destination: Readonly<{
        backupSetId: string;
        canonicalPath: string;
        displayName: string;
        repositorySchema: typeof BACKUP_REPOSITORY_SCHEMA;
    }>;
}>;

export type DataProtectionProjection = Readonly<{
    workspaceRevision: string;
    protectionEntityVersion: string;
    configuration:
        | Readonly<{ kind: 'unconfigured' }>
        | Readonly<{
            kind: 'configured';
            backupSetId: string;
            repositorySchema: typeof BACKUP_REPOSITORY_SCHEMA;
            destinationDisplayName: string;
        }>;
}>;

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
    return keys.length === expectedKeys.length
        && keys.every(key => typeof key === 'string' && expectedKeys.includes(key))
        && expectedKeys.every(key => {
            const descriptor = descriptors[key];
            return descriptor !== undefined && 'value' in descriptor && descriptor.enumerable;
        });
}

function normalizedBase(value: unknown): ConfigureBackupDestinationCommand {
    if (!hasExactDataKeys(value, [
        'commandId',
        'followUpId',
        'workspaceId',
        'expectedRevision',
        'expectedProtectionVersion',
        'intent',
    ])
        || !isCanonicalUuid(value.commandId)
        || !isCanonicalUuid(value.followUpId)
        || !isCanonicalUuid(value.workspaceId)
        || !isCanonicalUnsignedSqliteInteger(value.expectedRevision)
        || !isCanonicalUnsignedSqliteInteger(value.expectedProtectionVersion)
        || !hasExactDataKeys(value.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || value.intent.kind !== 'protect.configure-backup-destination'
        || value.intent.intentSchemaVersion !== 1
        || !hasExactDataKeys(value.intent.payload, [])) {
        throw new TypeError('Configure backup destination command is invalid');
    }
    return {
        commandId: value.commandId,
        followUpId: value.followUpId,
        workspaceId: value.workspaceId,
        expectedRevision: value.expectedRevision,
        expectedProtectionVersion: value.expectedProtectionVersion,
        intent: {
            kind: 'protect.configure-backup-destination',
            intentSchemaVersion: 1,
            payload: {},
        },
    };
}

/**
 * Normalizes the path-free Shell command accepted at the Workspace boundary.
 * @param {unknown} value - Candidate command.
 * @return {ConfigureBackupDestinationCommand} Exact public command.
 */
export function normalizeConfigureBackupDestinationCommand(
    value: unknown,
): ConfigureBackupDestinationCommand {
    return normalizedBase(value);
}

/**
 * Normalizes the command after PLATFORM has resolved and prepared its destination.
 * @param {unknown} value - Candidate accepted command.
 * @return {AcceptedConfigureBackupDestinationCommand} Exact DATA command.
 */
export function normalizeAcceptedConfigureBackupDestinationCommand(
    value: unknown,
): AcceptedConfigureBackupDestinationCommand {
    if (!hasExactDataKeys(value, [
        'commandId',
        'followUpId',
        'workspaceId',
        'expectedRevision',
        'expectedProtectionVersion',
        'intent',
        'destination',
    ])) {
        throw new TypeError('Accepted backup destination command is invalid');
    }
    const base = normalizedBase({
        commandId: value.commandId,
        followUpId: value.followUpId,
        workspaceId: value.workspaceId,
        expectedRevision: value.expectedRevision,
        expectedProtectionVersion: value.expectedProtectionVersion,
        intent: value.intent,
    });
    const destination = value.destination;
    if (!hasExactDataKeys(destination, [
        'backupSetId',
        'canonicalPath',
        'displayName',
        'repositorySchema',
    ])
        || !isCanonicalUuid(destination.backupSetId)
        || typeof destination.canonicalPath !== 'string'
        || destination.canonicalPath.length === 0
        || destination.canonicalPath.length > 32_767
        || destination.canonicalPath.includes('\0')
        || typeof destination.displayName !== 'string'
        || destination.displayName.length === 0
        || destination.displayName.length > 255
        || destination.displayName !== destination.displayName.trim()
        || destination.repositorySchema !== BACKUP_REPOSITORY_SCHEMA) {
        throw new TypeError('Accepted backup destination facts are invalid');
    }
    return {
        ...base,
        destination: {
            backupSetId: destination.backupSetId,
            canonicalPath: destination.canonicalPath,
            displayName: destination.displayName,
            repositorySchema: BACKUP_REPOSITORY_SCHEMA,
        },
    };
}

/**
 * Returns the exact accepted facts covered by a durable configuration receipt.
 * @param {AcceptedConfigureBackupDestinationCommand} command - Accepted configuration command.
 * @return {AcceptedConfigureBackupDestinationCommand} Canonical digest projection.
 */
export function configureBackupDestinationDigestProjection(
    command: AcceptedConfigureBackupDestinationCommand,
): AcceptedConfigureBackupDestinationCommand {
    return normalizeAcceptedConfigureBackupDestinationCommand(command);
}

/**
 * Validates the path-free projection returned to Shell.
 * @param {unknown} value - Candidate protection projection.
 * @return {boolean} Whether the projection has the exact supported shape.
 */
export function isDataProtectionProjection(value: unknown): value is DataProtectionProjection {
    if (!hasExactDataKeys(value, [
        'workspaceRevision',
        'protectionEntityVersion',
        'configuration',
    ])
        || !isCanonicalUnsignedSqliteInteger(value.workspaceRevision)
        || !isCanonicalUnsignedSqliteInteger(value.protectionEntityVersion)) {
        return false;
    }
    const configuration = value.configuration;
    if (hasExactDataKeys(configuration, ['kind'])) {
        return configuration.kind === 'unconfigured';
    }
    return hasExactDataKeys(configuration, [
        'kind',
        'backupSetId',
        'repositorySchema',
        'destinationDisplayName',
    ])
        && configuration.kind === 'configured'
        && isCanonicalUuid(configuration.backupSetId)
        && configuration.repositorySchema === BACKUP_REPOSITORY_SCHEMA
        && typeof configuration.destinationDisplayName === 'string'
        && configuration.destinationDisplayName.length > 0
        && configuration.destinationDisplayName.length <= 255
        && configuration.destinationDisplayName === configuration.destinationDisplayName.trim();
}
