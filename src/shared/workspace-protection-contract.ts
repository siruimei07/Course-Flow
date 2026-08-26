/**
 * @file Defines bounded PROTECT commands and data-protection projections.
 */

import {
    isCanonicalUnsignedSqliteInteger,
    isCanonicalUuid,
} from './workspace-data-contract';
import {isCanonicalInstant} from './meeting-time';

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

export type VerifiedBackupSnapshotProjection = Readonly<{
    snapshotId: string;
    backupSequence: string;
    actualRevision: string;
    succeededAt: string;
    snapshotFormatVersion: '1';
    integrity: 'verified';
}>;

export type ConfiguredBackupProjection = Readonly<{
    state: 'pending' | 'current';
    neededThrough: string;
    succeededThrough: string;
    lastSuccess: Readonly<{
        snapshotId: string;
        protectedThrough: string;
        succeededAt: string;
    }> | null;
    recentVerifiedSnapshots: readonly VerifiedBackupSnapshotProjection[];
    cleanup: 'idle' | 'pending';
}>;

type DataProtectionProjectionBase = Readonly<{
    workspaceRevision: string;
    protectionEntityVersion: string;
}>;

export type DataProtectionProjection = DataProtectionProjectionBase & (
    | Readonly<{configuration: Readonly<{kind: 'unconfigured'}>}>
    | Readonly<{
        configuration: Readonly<{
            kind: 'configured';
            backupSetId: string;
            repositorySchema: typeof BACKUP_REPOSITORY_SCHEMA;
            destinationDisplayName: string;
        }>;
        backup: ConfiguredBackupProjection;
    }>
);

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

function isVerifiedBackupSnapshotProjection(
    value: unknown,
): value is VerifiedBackupSnapshotProjection {
    return hasExactDataKeys(value, [
        'snapshotId',
        'backupSequence',
        'actualRevision',
        'succeededAt',
        'snapshotFormatVersion',
        'integrity',
    ])
        && isCanonicalUuid(value.snapshotId)
        && isCanonicalUnsignedSqliteInteger(value.backupSequence)
        && value.backupSequence !== '0'
        && isCanonicalUnsignedSqliteInteger(value.actualRevision)
        && value.actualRevision !== '0'
        && isCanonicalInstant(value.succeededAt)
        && value.snapshotFormatVersion === '1'
        && value.integrity === 'verified';
}

function isConfiguredBackupProjection(value: unknown): value is ConfiguredBackupProjection {
    if (!hasExactDataKeys(value, [
        'state',
        'neededThrough',
        'succeededThrough',
        'lastSuccess',
        'recentVerifiedSnapshots',
        'cleanup',
    ])
        || (value.state !== 'pending' && value.state !== 'current')
        || !isCanonicalUnsignedSqliteInteger(value.neededThrough)
        || !isCanonicalUnsignedSqliteInteger(value.succeededThrough)
        || BigInt(value.succeededThrough) > BigInt(value.neededThrough)
        || (value.state === 'pending') !== (value.neededThrough !== value.succeededThrough)
        || (value.cleanup !== 'idle' && value.cleanup !== 'pending')
        || !Array.isArray(value.recentVerifiedSnapshots)
        || value.recentVerifiedSnapshots.length > 2
        || !value.recentVerifiedSnapshots.every(isVerifiedBackupSnapshotProjection)) {
        return false;
    }
    const snapshots = value.recentVerifiedSnapshots;
    if (snapshots.some((snapshot, index) => index > 0
        && BigInt(snapshot.backupSequence) >= BigInt(snapshots[index - 1]!.backupSequence))) {
        return false;
    }
    const lastSuccess = value.lastSuccess;
    if (lastSuccess === null) {
        return snapshots.length === 0 && value.succeededThrough === '0';
    }
    if (!hasExactDataKeys(lastSuccess, [
        'snapshotId',
        'protectedThrough',
        'succeededAt',
    ])
        || !isCanonicalUuid(lastSuccess.snapshotId)
        || !isCanonicalUnsignedSqliteInteger(lastSuccess.protectedThrough)
        || lastSuccess.protectedThrough === '0'
        || !isCanonicalInstant(lastSuccess.succeededAt)) {
        return false;
    }
    if (lastSuccess.protectedThrough !== value.succeededThrough) {
        return false;
    }
    const listedLastSuccess = snapshots.find(
        snapshot => snapshot.snapshotId === lastSuccess.snapshotId,
    );
    return !listedLastSuccess
        || (lastSuccess.protectedThrough === listedLastSuccess.actualRevision
            && lastSuccess.succeededAt === listedLastSuccess.succeededAt);
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
    if (!isPlainObject(value)
        || !isCanonicalUnsignedSqliteInteger(value.workspaceRevision)
        || !isCanonicalUnsignedSqliteInteger(value.protectionEntityVersion)) {
        return false;
    }
    const configuration = value.configuration;
    if (hasExactDataKeys(configuration, ['kind'])) {
        return hasExactDataKeys(value, [
            'workspaceRevision',
            'protectionEntityVersion',
            'configuration',
        ]) && configuration.kind === 'unconfigured';
    }
    return hasExactDataKeys(value, [
        'workspaceRevision',
        'protectionEntityVersion',
        'configuration',
        'backup',
    ]) && hasExactDataKeys(configuration, [
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
        && configuration.destinationDisplayName === configuration.destinationDisplayName.trim()
        && isConfiguredBackupProjection(value.backup);
}
