/**
 * @file Defines path-free application-build and migration rollback Workspace contracts.
 */

import {isCanonicalInstant} from './meeting-time';
import {BOOTSTRAP_PROTOCOL_VERSION} from './bootstrap-contract';
import {
    isCanonicalUnsignedSqliteInteger,
    isCanonicalUuid,
} from './workspace-data-contract';
import type {RestoreLibraryRootBinding} from './workspace-protection-contract';

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const PORTABLE_ARTIFACT_PATTERN = /^[^/\\\0]+$/;
const MAXIMUM_IDENTITY_LENGTH = 1_024;

export type WorkspaceProtocolVersion = `${typeof BOOTSTRAP_PROTOCOL_VERSION}`;
export const WORKSPACE_PROTOCOL_VERSION: WorkspaceProtocolVersion = `${BOOTSTRAP_PROTOCOL_VERSION}`;

export type MigrationRollbackArtifactProjection = Readonly<{
    platform: 'darwin-arm64' | 'win32-x64';
    name: string;
    sha256: string;
}>;

export type MigrationRollbackTargetProjection = Readonly<{
    releaseVersion: string;
    tag: string;
    appBuildId: string;
    artifacts: readonly [
        MigrationRollbackArtifactProjection,
        MigrationRollbackArtifactProjection,
    ];
}>;

export type ApplicationReleaseDescriptor = Readonly<{
    descriptorVersion: '1';
    applicationId: 'io.github.siruimei07.courseflow.dev';
    releaseVersion: string;
    tag: string;
    appBuildId: string;
    fullCommit: string;
    platform: 'darwin' | 'win32';
    architecture: 'arm64' | 'x64';
    variant: 'development';
    workspaceProtocolVersion: WorkspaceProtocolVersion;
    currentSchemaLevel: string;
    formats: Readonly<{
        snapshot: '1';
        backupRepository: '1';
        restoreActivation: '1';
        migrationSafetyCopy: '1';
        migrationRollbackHandoff: '1';
    }>;
    runtimes: Readonly<{
        electron: string;
        chromium: string;
        node: string;
        sqlite: string;
    }>;
    rollbackTargets: readonly MigrationRollbackTargetProjection[];
}>;

export type ApplicationBuildStatus = Readonly<{
    descriptor: ApplicationReleaseDescriptor;
    processMatch: Readonly<{
        main: 'exact';
        renderer: 'exact';
        workspace: 'exact';
        allExact: true;
    }>;
    rollback:
        | Readonly<{kind: 'clear'}>
        | Readonly<{
            kind: 'classified';
            currentBuild: 'source' | 'target' | 'other';
            sourceAppBuildId: string;
            targetAppBuildId: string;
        }>
        | Readonly<{kind: 'recovery-required'}>;
}>;

export type MigrationSafetyCopyProjection =
    | Readonly<{kind: 'absent'}>
    | Readonly<{kind: 'unavailable'}>
    | Readonly<{
        kind: 'verified';
        integrity: 'verified';
        migrationSafetyCopyId: string;
        copyVersion: string;
        deleteConfirmationToken: string;
        workspaceId: string;
        sourceRevision: string;
        sourceSchemaLevel: string;
        createdAt: string;
        byteSize: string;
        target: MigrationRollbackTargetProjection;
    }>;

export type DeleteMigrationSafetyCopyCommand = Readonly<{
    commandId: string;
    migrationSafetyCopyId: string;
    expectedCopyVersion: string;
    confirmationToken: string;
}>;

export type ConfirmMigrationRollbackCommand = Readonly<{
    commandId: string;
    migrationRollbackSessionId: string;
    expectedSessionVersion: string;
    previewToken: string;
}>;

export type MigrationRollbackActionCommand = Readonly<{
    commandId: string;
    migrationRollbackSessionId: string;
    expectedSessionVersion: string;
}>;

export type MigrationRollbackRetryCommand = Readonly<{
    action: 'cancel-as-source' | 'continue-as-target';
    commandId: string;
    expectedSessionVersion: string;
}>;

export type MigrationRollbackImpactSummary = Readonly<{
    replacement: 'complete';
    automaticMerge: false;
    currentRevision: string;
    targetRevision: string;
    structuredDataChanges: 'discarded-after-target-revision';
    libraryFiles: 'remain-in-place';
    libraryReconciliation: 'full';
}>;

export type MigrationRollbackBindingProjection = Readonly<{
    safetyCopy: Extract<MigrationSafetyCopyProjection, Readonly<{kind: 'verified'}>>;
    currentData: Readonly<{
        workspaceId: string;
        schemaLevel: string;
        revision: string;
    }>;
    currentLibrary: RestoreLibraryRootBinding;
    sourceBuild: Readonly<{
        releaseVersion: string;
        tag: string;
        appBuildId: string;
    }>;
    targetBuild: MigrationRollbackTargetProjection;
    impact: MigrationRollbackImpactSummary;
}>;

type MigrationRollbackPhase =
    | 'previewed'
    | 'planned'
    | 'prepared'
    | 'armed'
    | 'awaiting-target-build'
    | 'completing'
    | 'cancelling'
    | 'succeeded'
    | 'cancelled'
    | 'recovery-required';

export type MigrationRollbackSessionView = Readonly<{
    migrationRollbackSessionId: string | null;
    operationId: string | null;
    sessionVersion: string | null;
    phase: MigrationRollbackPhase;
    currentBuild: 'source' | 'target' | 'other' | 'recovery-required';
    binding: MigrationRollbackBindingProjection | null;
    previewToken: string | null;
    retryCommand: MigrationRollbackRetryCommand | null;
    allowedActions: readonly ('confirm' | 'cancel-as-source' | 'continue-as-target')[];
    outcome: 'succeeded' | 'cancelled' | null;
    problem: Readonly<{
        code:
            | 'impact-changed'
            | 'activation-pending'
            | 'completion-pending'
            | 'build-mismatch'
            | 'recovery-required';
    }> | null;
}>;

type WorkspaceMigrationRequestBase = Readonly<{
    protocolVersion: typeof BOOTSTRAP_PROTOCOL_VERSION;
    appBuildId: string;
    requestId: string;
    workspaceEpoch: string;
}>;

export type ApplicationBuildStatusRequest = WorkspaceMigrationRequestBase & Readonly<{
    kind: 'workspace.application-build.query';
}>;

export type MigrationSafetyCopyQueryRequest = WorkspaceMigrationRequestBase & Readonly<{
    kind: 'workspace.migration-safety.query';
}>;

export type DeleteMigrationSafetyCopyRequest = WorkspaceMigrationRequestBase & Readonly<{
    kind: 'workspace.migration-safety.delete';
    command: DeleteMigrationSafetyCopyCommand;
}>;

export type MigrationRollbackPreviewRequest = WorkspaceMigrationRequestBase & Readonly<{
    kind: 'workspace.migration-rollback.preview';
}>;

export type MigrationRollbackStatusRequest = WorkspaceMigrationRequestBase & Readonly<{
    kind: 'workspace.migration-rollback.query';
    migrationRollbackSessionId: string | null;
}>;

export type ConfirmMigrationRollbackRequest = WorkspaceMigrationRequestBase & Readonly<{
    kind: 'workspace.migration-rollback.confirm';
    command: ConfirmMigrationRollbackCommand;
}>;

export type CancelMigrationRollbackRequest = WorkspaceMigrationRequestBase & Readonly<{
    kind: 'workspace.migration-rollback.cancel';
    command: MigrationRollbackActionCommand;
}>;

export type ContinueMigrationRollbackRequest = WorkspaceMigrationRequestBase & Readonly<{
    kind: 'workspace.migration-rollback.continue';
    command: MigrationRollbackActionCommand;
}>;

export type WorkspaceMigrationRequest =
    | ApplicationBuildStatusRequest
    | MigrationSafetyCopyQueryRequest
    | DeleteMigrationSafetyCopyRequest
    | MigrationRollbackPreviewRequest
    | MigrationRollbackStatusRequest
    | ConfirmMigrationRollbackRequest
    | CancelMigrationRollbackRequest
    | ContinueMigrationRollbackRequest;

export type WorkspaceMigrationSuccessValue =
    | Readonly<{
        kind: 'workspace.application-build-status';
        protocolVersion: typeof BOOTSTRAP_PROTOCOL_VERSION;
        appBuildId: string;
        requestId: string;
        workspaceEpoch: string;
        status: ApplicationBuildStatus;
    }>
    | Readonly<{
        kind: 'workspace.migration-safety-copy';
        protocolVersion: typeof BOOTSTRAP_PROTOCOL_VERSION;
        appBuildId: string;
        requestId: string;
        workspaceEpoch: string;
        safetyCopy: MigrationSafetyCopyProjection;
    }>
    | Readonly<{
        kind: 'workspace.migration-rollback-session';
        protocolVersion: typeof BOOTSTRAP_PROTOCOL_VERSION;
        appBuildId: string;
        requestId: string;
        workspaceEpoch: string;
        session: MigrationRollbackSessionView;
    }>;

/**
 * Tests whether a value is a plain data object.
 * @param {unknown} value Candidate value.
 * @return {boolean} Whether the value has a plain prototype.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

/**
 * Tests the complete enumerable own-key closure of one DTO object.
 * @param {unknown} value Candidate value.
 * @param {readonly string[]} expectedKeys Complete allowed key set.
 * @return {boolean} Whether the object has exactly those data keys.
 */
function hasExactDataKeys(
    value: unknown,
    expectedKeys: readonly string[],
): value is Record<string, unknown> {
    if (!isPlainObject(value)) {
        return false;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    return keys.length === expectedKeys.length
        && keys.every(key => typeof key === 'string' && expectedKeys.includes(key))
        && expectedKeys.every(key => {
            const descriptor = descriptors[key];
            return descriptor !== undefined && descriptor.enumerable && 'value' in descriptor;
        });
}

/**
 * Tests one bounded protocol identity.
 * @param {unknown} value Candidate value.
 * @return {boolean} Whether the value is canonical and bounded.
 */
function isBoundedIdentity(value: unknown): value is string {
    return typeof value === 'string'
        && value.length > 0
        && value.length <= MAXIMUM_IDENTITY_LENGTH
        && value === value.trim()
        && !value.includes('\0');
}

/**
 * Tests one lowercase SHA-256 digest.
 * @param {unknown} value Candidate value.
 * @return {boolean} Whether the value is a digest.
 */
function isDigest(value: unknown): value is string {
    return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

/**
 * Validates one exact, path-free rollback release target.
 * @param {unknown} value Candidate target.
 * @return {boolean} Whether both platform artifacts form a closed target.
 */
function isRollbackTarget(value: unknown): value is MigrationRollbackTargetProjection {
    if (!hasExactDataKeys(value, ['releaseVersion', 'tag', 'appBuildId', 'artifacts'])
        || !isBoundedIdentity(value.releaseVersion)
        || !isBoundedIdentity(value.tag)
        || !isBoundedIdentity(value.appBuildId)
        || !Array.isArray(value.artifacts)
        || value.artifacts.length !== 2) {
        return false;
    }
    const artifactsAreValid = value.artifacts.every(artifact => (
        hasExactDataKeys(artifact, ['platform', 'name', 'sha256'])
        && (artifact.platform === 'darwin-arm64' || artifact.platform === 'win32-x64')
        && isBoundedIdentity(artifact.name)
        && PORTABLE_ARTIFACT_PATTERN.test(artifact.name)
        && isDigest(artifact.sha256)
    ));
    return artifactsAreValid
        && value.artifacts[0]?.platform === 'darwin-arm64'
        && value.artifacts[1]?.platform === 'win32-x64';
}

/**
 * Validates the exact local BuildDescriptor-backed application status.
 * @param {unknown} value Candidate status.
 * @return {boolean} Whether the status is closed and internally consistent.
 */
export function isApplicationBuildStatus(value: unknown): value is ApplicationBuildStatus {
    if (!hasExactDataKeys(value, ['descriptor', 'processMatch', 'rollback'])
        || !hasExactDataKeys(value.descriptor, [
            'descriptorVersion',
            'applicationId',
            'releaseVersion',
            'tag',
            'appBuildId',
            'fullCommit',
            'platform',
            'architecture',
            'variant',
            'workspaceProtocolVersion',
            'currentSchemaLevel',
            'formats',
            'runtimes',
            'rollbackTargets',
        ])
        || value.descriptor.descriptorVersion !== '1'
        || value.descriptor.applicationId !== 'io.github.siruimei07.courseflow.dev'
        || !isBoundedIdentity(value.descriptor.releaseVersion)
        || !isBoundedIdentity(value.descriptor.tag)
        || typeof value.descriptor.appBuildId !== 'string'
        || !value.descriptor.appBuildId.startsWith('development:')
        || typeof value.descriptor.fullCommit !== 'string'
        || !COMMIT_PATTERN.test(value.descriptor.fullCommit)
        || value.descriptor.appBuildId !== `development:${value.descriptor.fullCommit}`
        || (value.descriptor.platform !== 'darwin' && value.descriptor.platform !== 'win32')
        || (value.descriptor.architecture !== 'arm64' && value.descriptor.architecture !== 'x64')
        || (value.descriptor.platform === 'darwin') !== (value.descriptor.architecture === 'arm64')
        || value.descriptor.variant !== 'development'
        || value.descriptor.workspaceProtocolVersion !== WORKSPACE_PROTOCOL_VERSION
        || !isCanonicalUnsignedSqliteInteger(value.descriptor.currentSchemaLevel)
        || value.descriptor.currentSchemaLevel === '0'
        || !hasExactDataKeys(value.descriptor.formats, [
            'snapshot',
            'backupRepository',
            'restoreActivation',
            'migrationSafetyCopy',
            'migrationRollbackHandoff',
        ])
        || Object.values(value.descriptor.formats).some(version => version !== '1')
        || !hasExactDataKeys(value.descriptor.runtimes, [
            'electron',
            'chromium',
            'node',
            'sqlite',
        ])
        || Object.values(value.descriptor.runtimes).some(version => !isBoundedIdentity(version))
        || !Array.isArray(value.descriptor.rollbackTargets)
        || !value.descriptor.rollbackTargets.every(isRollbackTarget)
        || !hasExactDataKeys(value.processMatch, [
            'main',
            'renderer',
            'workspace',
            'allExact',
        ])
        || value.processMatch.main !== 'exact'
        || value.processMatch.renderer !== 'exact'
        || value.processMatch.workspace !== 'exact'
        || value.processMatch.allExact !== true
        || !isPlainObject(value.rollback)) {
        return false;
    }
    const rollback: unknown = value.rollback;
    if (hasExactDataKeys(rollback, ['kind'])) {
        return rollback.kind === 'clear' || rollback.kind === 'recovery-required';
    }
    return hasExactDataKeys(rollback, [
        'kind',
        'currentBuild',
        'sourceAppBuildId',
        'targetAppBuildId',
    ])
        && rollback.kind === 'classified'
        && (rollback.currentBuild === 'source'
            || rollback.currentBuild === 'target'
            || rollback.currentBuild === 'other')
        && isBoundedIdentity(rollback.sourceAppBuildId)
        && isBoundedIdentity(rollback.targetAppBuildId)
        && rollback.sourceAppBuildId !== rollback.targetAppBuildId;
}

/**
 * Validates one path-free DATA-owned migration safety projection.
 * @param {unknown} value Candidate projection.
 * @return {boolean} Whether the projection is exact.
 */
export function isMigrationSafetyCopyProjection(
    value: unknown,
): value is MigrationSafetyCopyProjection {
    if (hasExactDataKeys(value, ['kind'])) {
        return value.kind === 'absent' || value.kind === 'unavailable';
    }
    return hasExactDataKeys(value, [
        'kind',
        'integrity',
        'migrationSafetyCopyId',
        'copyVersion',
        'deleteConfirmationToken',
        'workspaceId',
        'sourceRevision',
        'sourceSchemaLevel',
        'createdAt',
        'byteSize',
        'target',
    ])
        && value.kind === 'verified'
        && value.integrity === 'verified'
        && isCanonicalUuid(value.migrationSafetyCopyId)
        && isDigest(value.copyVersion)
        && isDigest(value.deleteConfirmationToken)
        && isCanonicalUuid(value.workspaceId)
        && isCanonicalUnsignedSqliteInteger(value.sourceRevision)
        && isCanonicalUnsignedSqliteInteger(value.sourceSchemaLevel)
        && value.sourceSchemaLevel !== '0'
        && isCanonicalInstant(value.createdAt)
        && isCanonicalUnsignedSqliteInteger(value.byteSize)
        && value.byteSize !== '0'
        && isRollbackTarget(value.target);
}

/**
 * Validates one path-free Library root binding.
 * @param {unknown} value Candidate binding.
 * @return {boolean} Whether the binding is exact.
 */
function isLibraryRootBinding(value: unknown): value is RestoreLibraryRootBinding {
    if (hasExactDataKeys(value, ['kind'])) {
        return value.kind === 'absent';
    }
    return hasExactDataKeys(value, ['kind', 'libraryRootId', 'rootGeneration'])
        && value.kind === 'present'
        && isCanonicalUuid(value.libraryRootId)
        && isCanonicalUuid(value.rootGeneration);
}

/**
 * Validates the complete copy, DATA, Library, build, and impact binding.
 * @param {unknown} value Candidate binding.
 * @return {boolean} Whether every bound fact agrees.
 */
function isMigrationRollbackBinding(
    value: unknown,
): value is MigrationRollbackBindingProjection {
    if (!hasExactDataKeys(value, [
        'safetyCopy',
        'currentData',
        'currentLibrary',
        'sourceBuild',
        'targetBuild',
        'impact',
    ])
        || !isMigrationSafetyCopyProjection(value.safetyCopy)
        || value.safetyCopy.kind !== 'verified'
        || !hasExactDataKeys(value.currentData, [
            'workspaceId',
            'schemaLevel',
            'revision',
        ])
        || !isCanonicalUuid(value.currentData.workspaceId)
        || !isCanonicalUnsignedSqliteInteger(value.currentData.schemaLevel)
        || value.currentData.schemaLevel === '0'
        || !isCanonicalUnsignedSqliteInteger(value.currentData.revision)
        || !isLibraryRootBinding(value.currentLibrary)
        || !hasExactDataKeys(value.sourceBuild, [
            'releaseVersion',
            'tag',
            'appBuildId',
        ])
        || !isBoundedIdentity(value.sourceBuild.releaseVersion)
        || !isBoundedIdentity(value.sourceBuild.tag)
        || !isBoundedIdentity(value.sourceBuild.appBuildId)
        || !isRollbackTarget(value.targetBuild)
        || value.sourceBuild.appBuildId === value.targetBuild.appBuildId
        || JSON.stringify(value.safetyCopy.target) !== JSON.stringify(value.targetBuild)
        || value.currentData.workspaceId !== value.safetyCopy.workspaceId
        || !hasExactDataKeys(value.impact, [
            'replacement',
            'automaticMerge',
            'currentRevision',
            'targetRevision',
            'structuredDataChanges',
            'libraryFiles',
            'libraryReconciliation',
        ])) {
        return false;
    }
    return value.impact.replacement === 'complete'
        && value.impact.automaticMerge === false
        && value.impact.currentRevision === value.currentData.revision
        && value.impact.targetRevision === value.safetyCopy.sourceRevision
        && value.impact.structuredDataChanges === 'discarded-after-target-revision'
        && value.impact.libraryFiles === 'remain-in-place'
        && value.impact.libraryReconciliation === 'full';
}

/**
 * Validates a complete preview, maintenance, recovery, or terminal rollback view.
 * @param {unknown} value Candidate view.
 * @return {boolean} Whether phase, build, actions, and binding agree.
 */
export function isMigrationRollbackSessionView(
    value: unknown,
): value is MigrationRollbackSessionView {
    if (!hasExactDataKeys(value, [
        'migrationRollbackSessionId',
        'operationId',
        'sessionVersion',
        'phase',
        'currentBuild',
        'binding',
        'previewToken',
        'retryCommand',
        'allowedActions',
        'outcome',
        'problem',
    ])
        || !Array.isArray(value.allowedActions)) {
        return false;
    }
    if (value.phase === 'recovery-required') {
        return value.migrationRollbackSessionId === null
            && value.operationId === null
            && value.sessionVersion === null
            && value.currentBuild === 'recovery-required'
            && value.binding === null
            && value.previewToken === null
            && value.retryCommand === null
            && value.allowedActions.length === 0
            && value.outcome === null
            && hasExactDataKeys(value.problem, ['code'])
            && value.problem.code === 'recovery-required';
    }
    if (!isCanonicalUuid(value.migrationRollbackSessionId)
        || !isCanonicalUuid(value.operationId)
        || !isCanonicalUnsignedSqliteInteger(value.sessionVersion)
        || !isMigrationRollbackBinding(value.binding)) {
        return false;
    }
    const retryCommand = value.retryCommand;
    if (retryCommand !== null
        && (!hasExactDataKeys(retryCommand, [
            'action',
            'commandId',
            'expectedSessionVersion',
        ])
            || (retryCommand.action !== 'cancel-as-source'
                && retryCommand.action !== 'continue-as-target')
            || !isCanonicalUuid(retryCommand.commandId)
            || !isCanonicalUnsignedSqliteInteger(retryCommand.expectedSessionVersion))) {
        return false;
    }
    if (value.phase === 'previewed') {
        return value.sessionVersion === '0'
            && value.currentBuild === 'source'
            && isDigest(value.previewToken)
            && retryCommand === null
            && JSON.stringify(value.allowedActions) === JSON.stringify(['confirm'])
            && value.outcome === null
            && value.problem === null;
    }
    if (value.previewToken !== null || value.problem !== null) {
        return false;
    }
    if (value.phase === 'succeeded' || value.phase === 'cancelled') {
        return (value.currentBuild === 'source' || value.currentBuild === 'target')
            && retryCommand === null
            && value.allowedActions.length === 0
            && value.outcome === value.phase;
    }
    const supportedPhase = value.phase === 'planned'
        || value.phase === 'prepared'
        || value.phase === 'armed'
        || value.phase === 'awaiting-target-build'
        || value.phase === 'completing'
        || value.phase === 'cancelling';
    if (!supportedPhase || value.outcome !== null
        || (value.currentBuild !== 'source'
            && value.currentBuild !== 'target'
            && value.currentBuild !== 'other')) {
        return false;
    }
    const actions = JSON.stringify(value.allowedActions);
    if (value.currentBuild === 'other') {
        return retryCommand === null && actions === JSON.stringify([]);
    }
    if (value.currentBuild === 'source') {
        const cancellable = value.phase !== 'completing';
        return actions === JSON.stringify(cancellable ? ['cancel-as-source'] : [])
            && (value.phase === 'cancelling'
                ? retryCommand?.action === 'cancel-as-source'
                : retryCommand === null);
    }
    const continuable = value.phase === 'armed'
        || value.phase === 'awaiting-target-build'
        || value.phase === 'completing';
    return actions === JSON.stringify(continuable ? ['continue-as-target'] : [])
        && (value.phase === 'completing'
            ? retryCommand?.action === 'continue-as-target'
            : retryCommand === null);
}

/**
 * Creates the common exact-build and Workspace-lease request fields.
 * @param {string} requestId Correlation identity.
 * @param {string} appBuildId Exact application build.
 * @param {string} workspaceEpoch Exact Workspace lease.
 * @return {WorkspaceMigrationRequestBase} Common request fields.
 */
function requestBase(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
): WorkspaceMigrationRequestBase {
    return {
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
    };
}

/**
 * Creates an ApplicationBuildStatus query.
 * @param {string} requestId Correlation identity.
 * @param {string} appBuildId Exact application build.
 * @param {string} workspaceEpoch Exact Workspace lease.
 * @return {ApplicationBuildStatusRequest} Closed request.
 */
export function makeApplicationBuildStatusRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
): ApplicationBuildStatusRequest {
    return {
        kind: 'workspace.application-build.query',
        ...requestBase(requestId, appBuildId, workspaceEpoch),
    };
}

/**
 * Creates a MigrationSafetyCopy status query.
 * @param {string} requestId Correlation identity.
 * @param {string} appBuildId Exact application build.
 * @param {string} workspaceEpoch Exact Workspace lease.
 * @return {MigrationSafetyCopyQueryRequest} Closed request.
 */
export function makeMigrationSafetyCopyQueryRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
): MigrationSafetyCopyQueryRequest {
    return {
        kind: 'workspace.migration-safety.query',
        ...requestBase(requestId, appBuildId, workspaceEpoch),
    };
}

/**
 * Validates and freezes an exact safety-copy deletion command.
 * @param {unknown} value Candidate command.
 * @return {DeleteMigrationSafetyCopyCommand} Closed command.
 */
export function normalizeDeleteMigrationSafetyCopyCommand(
    value: unknown,
): DeleteMigrationSafetyCopyCommand {
    if (!hasExactDataKeys(value, [
        'commandId',
        'migrationSafetyCopyId',
        'expectedCopyVersion',
        'confirmationToken',
    ])
        || !isCanonicalUuid(value.commandId)
        || !isCanonicalUuid(value.migrationSafetyCopyId)
        || !isDigest(value.expectedCopyVersion)
        || !isDigest(value.confirmationToken)) {
        throw new TypeError('Delete MigrationSafetyCopy command is invalid');
    }
    return Object.freeze({
        commandId: value.commandId,
        migrationSafetyCopyId: value.migrationSafetyCopyId,
        expectedCopyVersion: value.expectedCopyVersion,
        confirmationToken: value.confirmationToken,
    });
}

/**
 * Creates a preview-bound safety-copy deletion request.
 * @param {string} requestId Correlation identity.
 * @param {string} appBuildId Exact application build.
 * @param {string} workspaceEpoch Exact Workspace lease.
 * @param {DeleteMigrationSafetyCopyCommand} command Exact deletion command.
 * @return {DeleteMigrationSafetyCopyRequest} Closed request.
 */
export function makeDeleteMigrationSafetyCopyRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: DeleteMigrationSafetyCopyCommand,
): DeleteMigrationSafetyCopyRequest {
    return {
        kind: 'workspace.migration-safety.delete',
        ...requestBase(requestId, appBuildId, workspaceEpoch),
        command: normalizeDeleteMigrationSafetyCopyCommand(command),
    };
}

/**
 * Creates a fresh migration rollback preview query.
 * @param {string} requestId Correlation identity.
 * @param {string} appBuildId Exact application build.
 * @param {string} workspaceEpoch Exact Workspace lease.
 * @return {MigrationRollbackPreviewRequest} Closed request.
 */
export function makeMigrationRollbackPreviewRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
): MigrationRollbackPreviewRequest {
    return {
        kind: 'workspace.migration-rollback.preview',
        ...requestBase(requestId, appBuildId, workspaceEpoch),
    };
}

/**
 * Creates a migration rollback status query.
 * @param {string} requestId Correlation identity.
 * @param {string} appBuildId Exact application build.
 * @param {string} workspaceEpoch Exact Workspace lease.
 * @param {string | null} migrationRollbackSessionId Expected session or startup query.
 * @return {MigrationRollbackStatusRequest} Closed request.
 */
export function makeMigrationRollbackStatusRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    migrationRollbackSessionId: string | null,
): MigrationRollbackStatusRequest {
    if (migrationRollbackSessionId !== null
        && !isCanonicalUuid(migrationRollbackSessionId)) {
        throw new TypeError('MigrationRollback session identity is invalid');
    }
    return {
        kind: 'workspace.migration-rollback.query',
        ...requestBase(requestId, appBuildId, workspaceEpoch),
        migrationRollbackSessionId,
    };
}

/**
 * Validates and freezes one preview confirmation command.
 * @param {unknown} value Candidate command.
 * @return {ConfirmMigrationRollbackCommand} Closed command.
 */
export function normalizeConfirmMigrationRollbackCommand(
    value: unknown,
): ConfirmMigrationRollbackCommand {
    if (!hasExactDataKeys(value, [
        'commandId',
        'migrationRollbackSessionId',
        'expectedSessionVersion',
        'previewToken',
    ])
        || !isCanonicalUuid(value.commandId)
        || !isCanonicalUuid(value.migrationRollbackSessionId)
        || !isCanonicalUnsignedSqliteInteger(value.expectedSessionVersion)
        || !isDigest(value.previewToken)) {
        throw new TypeError('Confirm MigrationRollback command is invalid');
    }
    return Object.freeze({
        commandId: value.commandId,
        migrationRollbackSessionId: value.migrationRollbackSessionId,
        expectedSessionVersion: value.expectedSessionVersion,
        previewToken: value.previewToken,
    });
}

/**
 * Creates a preview-bound rollback confirmation request.
 * @param {string} requestId Correlation identity.
 * @param {string} appBuildId Exact application build.
 * @param {string} workspaceEpoch Exact Workspace lease.
 * @param {ConfirmMigrationRollbackCommand} command Exact confirmation command.
 * @return {ConfirmMigrationRollbackRequest} Closed request.
 */
export function makeConfirmMigrationRollbackRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: ConfirmMigrationRollbackCommand,
): ConfirmMigrationRollbackRequest {
    return {
        kind: 'workspace.migration-rollback.confirm',
        ...requestBase(requestId, appBuildId, workspaceEpoch),
        command: normalizeConfirmMigrationRollbackCommand(command),
    };
}

/**
 * Validates and freezes one source-cancel or target-continue command.
 * @param {unknown} value Candidate command.
 * @return {MigrationRollbackActionCommand} Closed command.
 */
export function normalizeMigrationRollbackActionCommand(
    value: unknown,
): MigrationRollbackActionCommand {
    if (!hasExactDataKeys(value, [
        'commandId',
        'migrationRollbackSessionId',
        'expectedSessionVersion',
    ])
        || !isCanonicalUuid(value.commandId)
        || !isCanonicalUuid(value.migrationRollbackSessionId)
        || !isCanonicalUnsignedSqliteInteger(value.expectedSessionVersion)) {
        throw new TypeError('MigrationRollback action command is invalid');
    }
    return Object.freeze({
        commandId: value.commandId,
        migrationRollbackSessionId: value.migrationRollbackSessionId,
        expectedSessionVersion: value.expectedSessionVersion,
    });
}

/**
 * Creates one exact-build rollback action request.
 * @param {'workspace.migration-rollback.cancel' | 'workspace.migration-rollback.continue'} kind Action request kind.
 * @param {string} requestId Correlation identity.
 * @param {string} appBuildId Exact application build.
 * @param {string} workspaceEpoch Exact Workspace lease.
 * @param {MigrationRollbackActionCommand} command Exact action command.
 * @return {CancelMigrationRollbackRequest | ContinueMigrationRollbackRequest} Closed request.
 */
function makeMigrationRollbackActionRequest(
    kind: 'workspace.migration-rollback.cancel' | 'workspace.migration-rollback.continue',
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: MigrationRollbackActionCommand,
): CancelMigrationRollbackRequest | ContinueMigrationRollbackRequest {
    return {
        kind,
        ...requestBase(requestId, appBuildId, workspaceEpoch),
        command: normalizeMigrationRollbackActionCommand(command),
    };
}

/**
 * Creates an exact source-build cancel request.
 * @param {string} requestId Correlation identity.
 * @param {string} appBuildId Exact application build.
 * @param {string} workspaceEpoch Exact Workspace lease.
 * @param {MigrationRollbackActionCommand} command Exact action command.
 * @return {CancelMigrationRollbackRequest} Closed request.
 */
export function makeCancelMigrationRollbackRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: MigrationRollbackActionCommand,
): CancelMigrationRollbackRequest {
    return makeMigrationRollbackActionRequest(
        'workspace.migration-rollback.cancel',
        requestId,
        appBuildId,
        workspaceEpoch,
        command,
    ) as CancelMigrationRollbackRequest;
}

/**
 * Creates an exact target-build continue request.
 * @param {string} requestId Correlation identity.
 * @param {string} appBuildId Exact application build.
 * @param {string} workspaceEpoch Exact Workspace lease.
 * @param {MigrationRollbackActionCommand} command Exact action command.
 * @return {ContinueMigrationRollbackRequest} Closed request.
 */
export function makeContinueMigrationRollbackRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: MigrationRollbackActionCommand,
): ContinueMigrationRollbackRequest {
    return makeMigrationRollbackActionRequest(
        'workspace.migration-rollback.continue',
        requestId,
        appBuildId,
        workspaceEpoch,
        command,
    ) as ContinueMigrationRollbackRequest;
}

/**
 * Validates every public migration request before Workspace dispatch.
 * @param {unknown} value Candidate request.
 * @param {string} expectedBuildId Exact application build.
 * @param {string} expectedWorkspaceEpoch Exact Workspace lease.
 * @return {boolean} Whether the request is closed and safe to dispatch.
 */
export function isWorkspaceMigrationRequest(
    value: unknown,
    expectedBuildId: string,
    expectedWorkspaceEpoch: string,
): value is WorkspaceMigrationRequest {
    if (!isPlainObject(value)
        || value.protocolVersion !== BOOTSTRAP_PROTOCOL_VERSION
        || value.appBuildId !== expectedBuildId
        || value.workspaceEpoch !== expectedWorkspaceEpoch
        || !isBoundedIdentity(value.requestId)
        || !isBoundedIdentity(value.appBuildId)
        || !isCanonicalUuid(value.workspaceEpoch)) {
        return false;
    }
    const baseKeys = [
        'kind',
        'protocolVersion',
        'appBuildId',
        'requestId',
        'workspaceEpoch',
    ];
    if (value.kind === 'workspace.application-build.query'
        || value.kind === 'workspace.migration-safety.query'
        || value.kind === 'workspace.migration-rollback.preview') {
        return hasExactDataKeys(value, baseKeys);
    }
    if (value.kind === 'workspace.migration-rollback.query') {
        return hasExactDataKeys(value, [...baseKeys, 'migrationRollbackSessionId'])
            && (value.migrationRollbackSessionId === null
                || isCanonicalUuid(value.migrationRollbackSessionId));
    }
    if (value.kind !== 'workspace.migration-safety.delete'
        && value.kind !== 'workspace.migration-rollback.confirm'
        && value.kind !== 'workspace.migration-rollback.cancel'
        && value.kind !== 'workspace.migration-rollback.continue') {
        return false;
    }
    if (!hasExactDataKeys(value, [...baseKeys, 'command'])) {
        return false;
    }
    try {
        if (value.kind === 'workspace.migration-safety.delete') {
            normalizeDeleteMigrationSafetyCopyCommand(value.command);
        }
        else if (value.kind === 'workspace.migration-rollback.confirm') {
            normalizeConfirmMigrationRollbackCommand(value.command);
        }
        else {
            normalizeMigrationRollbackActionCommand(value.command);
        }
        return true;
    }
    catch {
        return false;
    }
}

/**
 * Validates a migration success value inside the common Workspace envelope.
 * @param {unknown} value Candidate success value.
 * @param {string} expectedBuildId Exact application build.
 * @param {string} expectedRequestId Correlated request.
 * @param {string} expectedWorkspaceEpoch Exact Workspace lease.
 * @return {boolean} Whether the value is exact.
 */
export function isWorkspaceMigrationSuccessValue(
    value: unknown,
    expectedBuildId: string,
    expectedRequestId: string,
    expectedWorkspaceEpoch: string,
): value is WorkspaceMigrationSuccessValue {
    if (!isPlainObject(value)
        || value.protocolVersion !== BOOTSTRAP_PROTOCOL_VERSION
        || value.appBuildId !== expectedBuildId
        || value.requestId !== expectedRequestId
        || value.workspaceEpoch !== expectedWorkspaceEpoch) {
        return false;
    }
    const baseKeys = [
        'kind',
        'protocolVersion',
        'appBuildId',
        'requestId',
        'workspaceEpoch',
    ];
    if (value.kind === 'workspace.application-build-status') {
        return hasExactDataKeys(value, [...baseKeys, 'status'])
            && isApplicationBuildStatus(value.status);
    }
    if (value.kind === 'workspace.migration-safety-copy') {
        return hasExactDataKeys(value, [...baseKeys, 'safetyCopy'])
            && isMigrationSafetyCopyProjection(value.safetyCopy);
    }
    return value.kind === 'workspace.migration-rollback-session'
        && hasExactDataKeys(value, [...baseKeys, 'session'])
        && isMigrationRollbackSessionView(value.session);
}
