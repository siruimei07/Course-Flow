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

export type RestoreCandidateStatus =
    | 'verified'
    | 'incomplete-or-sync-pending'
    | 'corrupt'
    | 'incompatible'
    | 'unknown-entry';

export type RestoreCandidateProjection = Readonly<{
    candidateRef: string;
    candidateKind: 'snapshot' | 'unknown-entry';
    snapshotId: string | null;
    status: RestoreCandidateStatus;
    actualRevision: string | null;
    createdAt: string | null;
    compatibility: 'current' | 'migration-required' | 'unsupported' | 'unknown';
}>;

export type StartRestoreSessionCommand = Readonly<{
    commandId: string;
    candidateRef: string;
}>;

export type ConfirmRestoreSessionCommand = Readonly<{
    commandId: string;
    restoreSessionId: string;
    expectedSessionVersion: string;
    previewToken: string;
}>;

export type RestoreSessionActionCommand = Readonly<{
    commandId: string;
    restoreSessionId: string;
    expectedSessionVersion: string;
}>;

export type CancelRestoreSessionCommand = RestoreSessionActionCommand;
export type ResumeRestoreSessionCommand = RestoreSessionActionCommand;
export type RollbackRestoreSessionCommand = RestoreSessionActionCommand;

export type RestoreLibraryRootBinding =
    | Readonly<{kind: 'absent'}>
    | Readonly<{
        kind: 'present';
        libraryRootId: string;
        rootGeneration: string;
    }>;

export type RestoreImpactSummary = Readonly<{
    replacement: 'complete';
    automaticMerge: false;
    termCount: string;
    courseCount: string;
    taskSeriesCount: string;
    currentRevision: string;
    candidateRevision: string;
}>;

export type RestoreSessionView = Readonly<{
    restoreSessionId: string;
    operationId: string;
    sessionVersion: string;
    phase:
        | 'previewed'
        | 'waiting-decision'
        | 'protection-established'
        | 'recovery-required'
        | 'cancelled'
        | 'succeeded'
        | 'rolled-back';
    candidate: Readonly<{
        candidateRef: string;
        snapshotId: string;
        sourceSchemaLevel: string;
        preparedSchemaLevel: string;
        actualRevision: string;
        validationCopy: 'copied' | 'migrated';
    }>;
    current: Readonly<{
        workspaceId: string;
        revision: string;
        libraryRoot: RestoreLibraryRootBinding;
    }>;
    target: Readonly<{libraryRoot: RestoreLibraryRootBinding}>;
    impact: RestoreImpactSummary;
    recoverability: Readonly<{
        mode: 'required';
        safetySet:
            | Readonly<{state: 'pending'}>
            | Readonly<{
                state: 'verified';
                safetySetId: string;
                protectedRevision: string;
            }>;
    }>;
    previewToken: string | null;
    allowedActions: readonly (
        | 'confirm'
        | 'repreview'
        | 'cancel-before-checkpoint'
        | 'resume'
        | 'rollback'
    )[];
    problem: Readonly<{
        code:
            | 'impact-changed'
            | 'activation-pending'
            | 'rollback-required'
            | 'recovery-required';
    }> | null;
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
    restoreCandidates: readonly RestoreCandidateProjection[];
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

function isNullableCanonicalUuid(value: unknown): value is string | null {
    return value === null || isCanonicalUuid(value);
}

function isNullableCanonicalInstant(value: unknown): value is string | null {
    return value === null || isCanonicalInstant(value);
}

function isNullableCanonicalRevision(value: unknown): value is string | null {
    return value === null || (isCanonicalUnsignedSqliteInteger(value) && value !== '0');
}

/**
 * Validates one exact path-free restore candidate row.
 * @param {unknown} value - Candidate projection.
 * @return {boolean} Whether all status-dependent facts are exact.
 */
export function isRestoreCandidateProjection(
    value: unknown,
): value is RestoreCandidateProjection {
    if (!hasExactDataKeys(value, [
        'candidateRef',
        'candidateKind',
        'snapshotId',
        'status',
        'actualRevision',
        'createdAt',
        'compatibility',
    ])
        || !isCanonicalUuid(value.candidateRef)
        || !isNullableCanonicalUuid(value.snapshotId)
        || !isNullableCanonicalRevision(value.actualRevision)
        || !isNullableCanonicalInstant(value.createdAt)) {
        return false;
    }
    if (value.status === 'unknown-entry') {
        return value.candidateKind === 'unknown-entry'
            && value.snapshotId === null
            && value.actualRevision === null
            && value.createdAt === null
            && value.compatibility === 'unknown';
    }
    if (value.candidateKind !== 'snapshot' || value.snapshotId === null) {
        return false;
    }
    if (value.status === 'verified') {
        return value.actualRevision !== null
            && value.createdAt !== null
            && (value.compatibility === 'current'
                || value.compatibility === 'migration-required');
    }
    if (value.status === 'incompatible') {
        return value.actualRevision === null
            && value.createdAt === null
            && value.compatibility === 'unsupported';
    }
    return (value.status === 'incomplete-or-sync-pending' || value.status === 'corrupt')
        && value.actualRevision === null
        && value.createdAt === null
        && value.compatibility === 'unknown';
}

function isRestoreLibraryRootBinding(value: unknown): value is RestoreLibraryRootBinding {
    if (hasExactDataKeys(value, ['kind'])) {
        return value.kind === 'absent';
    }
    return hasExactDataKeys(value, ['kind', 'libraryRootId', 'rootGeneration'])
        && value.kind === 'present'
        && isCanonicalUuid(value.libraryRootId)
        && isCanonicalUuid(value.rootGeneration);
}

function isRestoreImpactSummary(value: unknown): value is RestoreImpactSummary {
    return hasExactDataKeys(value, [
        'replacement',
        'automaticMerge',
        'termCount',
        'courseCount',
        'taskSeriesCount',
        'currentRevision',
        'candidateRevision',
    ])
        && value.replacement === 'complete'
        && value.automaticMerge === false
        && isCanonicalUnsignedSqliteInteger(value.termCount)
        && isCanonicalUnsignedSqliteInteger(value.courseCount)
        && isCanonicalUnsignedSqliteInteger(value.taskSeriesCount)
        && isCanonicalUnsignedSqliteInteger(value.currentRevision)
        && isCanonicalUnsignedSqliteInteger(value.candidateRevision)
        && value.candidateRevision !== '0';
}

function isRestoreSafetySetProjection(
    value: unknown,
): value is RestoreSessionView['recoverability']['safetySet'] {
    if (hasExactDataKeys(value, ['state'])) {
        return value.state === 'pending';
    }
    return hasExactDataKeys(value, [
        'state',
        'safetySetId',
        'protectedRevision',
    ])
        && value.state === 'verified'
        && isCanonicalUuid(value.safetySetId)
        && isCanonicalUnsignedSqliteInteger(value.protectedRevision);
}

/**
 * Validates the bounded pre-checkpoint RestoreSession view exposed to Shell.
 * @param {unknown} value - Candidate session view.
 * @return {boolean} Whether the view is exact and internally consistent.
 */
export function isRestoreSessionView(value: unknown): value is RestoreSessionView {
    if (!hasExactDataKeys(value, [
        'restoreSessionId',
        'operationId',
        'sessionVersion',
        'phase',
        'candidate',
        'current',
        'target',
        'impact',
        'recoverability',
        'previewToken',
        'allowedActions',
        'problem',
    ])
        || !isCanonicalUuid(value.restoreSessionId)
        || !isCanonicalUuid(value.operationId)
        || !isCanonicalUnsignedSqliteInteger(value.sessionVersion)
        || !hasExactDataKeys(value.candidate, [
            'candidateRef',
            'snapshotId',
            'sourceSchemaLevel',
            'preparedSchemaLevel',
            'actualRevision',
            'validationCopy',
        ])
        || !isCanonicalUuid(value.candidate.candidateRef)
        || !isCanonicalUuid(value.candidate.snapshotId)
        || !isCanonicalUnsignedSqliteInteger(value.candidate.sourceSchemaLevel)
        || value.candidate.sourceSchemaLevel === '0'
        || !isCanonicalUnsignedSqliteInteger(value.candidate.preparedSchemaLevel)
        || value.candidate.preparedSchemaLevel === '0'
        || !isCanonicalUnsignedSqliteInteger(value.candidate.actualRevision)
        || value.candidate.actualRevision === '0'
        || (value.candidate.validationCopy !== 'copied'
            && value.candidate.validationCopy !== 'migrated')
        || (value.candidate.validationCopy === 'copied'
            && value.candidate.sourceSchemaLevel !== value.candidate.preparedSchemaLevel)
        || (value.candidate.validationCopy === 'migrated'
            && BigInt(value.candidate.sourceSchemaLevel)
                >= BigInt(value.candidate.preparedSchemaLevel))
        || !hasExactDataKeys(value.current, [
            'workspaceId',
            'revision',
            'libraryRoot',
        ])
        || !isCanonicalUuid(value.current.workspaceId)
        || !isCanonicalUnsignedSqliteInteger(value.current.revision)
        || !isRestoreLibraryRootBinding(value.current.libraryRoot)
        || !hasExactDataKeys(value.target, ['libraryRoot'])
        || !isRestoreLibraryRootBinding(value.target.libraryRoot)
        || !isRestoreImpactSummary(value.impact)
        || value.impact.currentRevision !== value.current.revision
        || value.impact.candidateRevision !== value.candidate.actualRevision
        || !hasExactDataKeys(value.recoverability, ['mode', 'safetySet'])
        || value.recoverability.mode !== 'required'
        || !isRestoreSafetySetProjection(value.recoverability.safetySet)
        || !Array.isArray(value.allowedActions)
        || !value.allowedActions.every(action => action === 'confirm'
            || action === 'repreview'
            || action === 'cancel-before-checkpoint'
            || action === 'resume'
            || action === 'rollback')) {
        return false;
    }
    if (value.phase === 'previewed') {
        return value.sessionVersion === '0'
            && typeof value.previewToken === 'string'
            && /^[0-9a-f]{64}$/.test(value.previewToken)
            && value.recoverability.safetySet.state === 'pending'
            && JSON.stringify(value.allowedActions)
                === JSON.stringify(['confirm', 'cancel-before-checkpoint'])
            && value.problem === null;
    }
    if (value.phase === 'waiting-decision') {
        return value.sessionVersion === '1'
            && value.previewToken === null
            && value.recoverability.safetySet.state === 'pending'
            && JSON.stringify(value.allowedActions)
                === JSON.stringify(['repreview', 'cancel-before-checkpoint'])
            && hasExactDataKeys(value.problem, ['code'])
            && value.problem.code === 'impact-changed';
    }
    if (value.phase === 'cancelled') {
        return value.previewToken === null
            && (value.sessionVersion === '1' || value.sessionVersion === '2')
            && JSON.stringify(value.allowedActions) === JSON.stringify([])
            && value.problem === null
            && (value.recoverability.safetySet.state === 'pending'
                || value.recoverability.safetySet.protectedRevision === value.current.revision);
    }
    if (value.previewToken !== null
        || value.recoverability.safetySet.state !== 'verified'
        || value.recoverability.safetySet.protectedRevision !== value.current.revision) {
        return false;
    }
    if (value.phase === 'protection-established') {
        return value.sessionVersion === '1'
            && JSON.stringify(value.allowedActions)
            === JSON.stringify(['resume', 'cancel-before-checkpoint'])
            && value.problem === null;
    }
    if (value.phase === 'recovery-required') {
        const actions = JSON.stringify(value.allowedActions);
        return value.sessionVersion === '2'
            && (actions === JSON.stringify(['resume', 'rollback'])
                || actions === JSON.stringify(['resume'])
                || actions === JSON.stringify(['rollback'])
                || actions === JSON.stringify([]))
            && hasExactDataKeys(value.problem, ['code'])
            && (value.problem.code === 'activation-pending'
                || value.problem.code === 'rollback-required'
                || value.problem.code === 'recovery-required');
    }
    return (value.phase === 'succeeded' || value.phase === 'rolled-back')
        && value.sessionVersion === '3'
        && JSON.stringify(value.allowedActions) === JSON.stringify([])
        && value.problem === null;
}

function isConfiguredBackupProjection(value: unknown): value is ConfiguredBackupProjection {
    if (!hasExactDataKeys(value, [
        'state',
        'neededThrough',
        'succeededThrough',
        'lastSuccess',
        'recentVerifiedSnapshots',
        'restoreCandidates',
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
        || !value.recentVerifiedSnapshots.every(isVerifiedBackupSnapshotProjection)
        || !Array.isArray(value.restoreCandidates)
        || !value.restoreCandidates.every(isRestoreCandidateProjection)) {
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
 * Normalizes the path-free command that starts a session from one opaque candidate.
 * @param {unknown} value - Candidate start command.
 * @return {StartRestoreSessionCommand} Exact command.
 */
export function normalizeStartRestoreSessionCommand(
    value: unknown,
): StartRestoreSessionCommand {
    if (!hasExactDataKeys(value, ['commandId', 'candidateRef'])
        || !isCanonicalUuid(value.commandId)
        || !isCanonicalUuid(value.candidateRef)) {
        throw new TypeError('Start restore session command is invalid');
    }
    return Object.freeze({
        commandId: value.commandId,
        candidateRef: value.candidateRef,
    });
}

/**
 * Normalizes the version- and preview-bound pre-checkpoint confirmation command.
 * @param {unknown} value - Candidate confirmation command.
 * @return {ConfirmRestoreSessionCommand} Exact command.
 */
export function normalizeConfirmRestoreSessionCommand(
    value: unknown,
): ConfirmRestoreSessionCommand {
    if (!hasExactDataKeys(value, [
        'commandId',
        'restoreSessionId',
        'expectedSessionVersion',
        'previewToken',
    ])
        || !isCanonicalUuid(value.commandId)
        || !isCanonicalUuid(value.restoreSessionId)
        || !isCanonicalUnsignedSqliteInteger(value.expectedSessionVersion)
        || typeof value.previewToken !== 'string'
        || !/^[0-9a-f]{64}$/.test(value.previewToken)) {
        throw new TypeError('Confirm restore session command is invalid');
    }
    return Object.freeze({
        commandId: value.commandId,
        restoreSessionId: value.restoreSessionId,
        expectedSessionVersion: value.expectedSessionVersion,
        previewToken: value.previewToken,
    });
}

function normalizeRestoreSessionActionCommand(value: unknown): RestoreSessionActionCommand {
    if (!hasExactDataKeys(value, [
        'commandId',
        'restoreSessionId',
        'expectedSessionVersion',
    ])
        || !isCanonicalUuid(value.commandId)
        || !isCanonicalUuid(value.restoreSessionId)
        || !isCanonicalUnsignedSqliteInteger(value.expectedSessionVersion)) {
        throw new TypeError('Restore session action command is invalid');
    }
    return Object.freeze({
        commandId: value.commandId,
        restoreSessionId: value.restoreSessionId,
        expectedSessionVersion: value.expectedSessionVersion,
    });
}

/**
 * Normalizes a checkpoint-preceding Restore cancellation command.
 * @param {unknown} value - Candidate cancellation command.
 * @return {CancelRestoreSessionCommand} Exact path-free command.
 */
export function normalizeCancelRestoreSessionCommand(
    value: unknown,
): CancelRestoreSessionCommand {
    return normalizeRestoreSessionActionCommand(value);
}

/**
 * Normalizes an evidence-bound Restore continuation command.
 * @param {unknown} value - Candidate continuation command.
 * @return {ResumeRestoreSessionCommand} Exact path-free command.
 */
export function normalizeResumeRestoreSessionCommand(
    value: unknown,
): ResumeRestoreSessionCommand {
    return normalizeRestoreSessionActionCommand(value);
}

/**
 * Normalizes an evidence-bound Restore rollback command.
 * @param {unknown} value - Candidate rollback command.
 * @return {RollbackRestoreSessionCommand} Exact path-free command.
 */
export function normalizeRollbackRestoreSessionCommand(
    value: unknown,
): RollbackRestoreSessionCommand {
    return normalizeRestoreSessionActionCommand(value);
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
