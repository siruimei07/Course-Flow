/**
 * @file Binds the path-free MigrationRollback preview to the physical handoff facts.
 */

import {createHash} from 'node:crypto';

import {canonicalJson} from '../shared/canonical-json';
import {
    isMigrationRollbackSessionView,
    isMigrationSafetyCopyProjection,
    normalizeConfirmMigrationRollbackCommand,
    type BoundMigrationSafetyCopyProjection,
    type ConfirmMigrationRollbackCommand,
    type MigrationRollbackSessionView,
} from '../shared/workspace-migration-contract';
import {isCanonicalUuid} from '../shared/workspace-data-contract';
import type {RestoreLibraryRootBinding} from '../shared/workspace-protection-contract';
import type {MigrationRollbackHandoffFacts} from './migration-rollback-handoff';

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const MAXIMUM_IDENTITY_LENGTH = 1_024;

export type MigrationRollbackPreviewFacts = Readonly<{
    safetyCopy: Readonly<{
        projection: BoundMigrationSafetyCopyProjection;
        closedDataSlotDigest: string;
    }>;
    currentData: Readonly<{
        workspaceId: string;
        schemaLevel: string;
        revision: string;
        byteLength: string;
        digest: string;
        slotFingerprint: string;
    }>;
    currentLibrary: RestoreLibraryRootBinding;
    sourceBuild: Readonly<{
        releaseVersion: string;
        tag: string;
        appBuildId: string;
    }>;
}>;

export type MigrationRollbackPreviewIdentity = Readonly<{
    migrationRollbackSessionId: string;
    operationId: string;
}>;

export type PreparedMigrationRollbackPreview = Readonly<{
    view: MigrationRollbackSessionView;
    facts: MigrationRollbackPreviewFacts;
    factsDigest: string;
}>;

/**
 * Tests one canonical unsigned integer string.
 * @param {unknown} value Candidate value.
 * @return {boolean} Whether the value is canonical.
 */
function isCanonicalUnsigned(value: unknown): value is string {
    return typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value);
}

/**
 * Tests one bounded build or release identity.
 * @param {unknown} value Candidate value.
 * @return {boolean} Whether the identity is bounded and canonical.
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
 * Closes one path-free Library binding at the PROTECT boundary.
 * @param {RestoreLibraryRootBinding} value Candidate binding.
 * @return {RestoreLibraryRootBinding} Immutable validated binding.
 */
function requireLibraryBinding(value: RestoreLibraryRootBinding): RestoreLibraryRootBinding {
    if (value.kind === 'absent') {
        return Object.freeze({kind: 'absent' as const});
    }
    if (!isCanonicalUuid(value.libraryRootId) || !isCanonicalUuid(value.rootGeneration)) {
        throw new TypeError('MigrationRollback Library binding is invalid');
    }
    return Object.freeze({
        kind: 'present' as const,
        libraryRootId: value.libraryRootId,
        rootGeneration: value.rootGeneration,
    });
}

/**
 * Validates and freezes every private preview fact.
 * @param {MigrationRollbackPreviewFacts} facts Candidate preview facts.
 * @return {MigrationRollbackPreviewFacts} Immutable normalized facts.
 */
function normalizePreviewFacts(
    facts: MigrationRollbackPreviewFacts,
): MigrationRollbackPreviewFacts {
    if (!isMigrationSafetyCopyProjection(facts.safetyCopy.projection)
        || facts.safetyCopy.projection.kind !== 'verified'
        || !isDigest(facts.safetyCopy.closedDataSlotDigest)
        || !isCanonicalUuid(facts.currentData.workspaceId)
        || !isCanonicalUnsigned(facts.currentData.schemaLevel)
        || facts.currentData.schemaLevel === '0'
        || !isCanonicalUnsigned(facts.currentData.revision)
        || !isCanonicalUnsigned(facts.currentData.byteLength)
        || facts.currentData.byteLength === '0'
        || !isDigest(facts.currentData.digest)
        || !isDigest(facts.currentData.slotFingerprint)
        || facts.currentData.workspaceId !== facts.safetyCopy.projection.workspaceId
        || !isBoundedIdentity(facts.sourceBuild.releaseVersion)
        || !isBoundedIdentity(facts.sourceBuild.tag)
        || !isBoundedIdentity(facts.sourceBuild.appBuildId)
        || facts.sourceBuild.appBuildId === facts.safetyCopy.projection.target.appBuildId) {
        throw new TypeError('MigrationRollback preview facts are invalid');
    }
    return Object.freeze({
        safetyCopy: Object.freeze({
            projection: facts.safetyCopy.projection,
            closedDataSlotDigest: facts.safetyCopy.closedDataSlotDigest,
        }),
        currentData: Object.freeze({...facts.currentData}),
        currentLibrary: requireLibraryBinding(facts.currentLibrary),
        sourceBuild: Object.freeze({...facts.sourceBuild}),
    });
}

/**
 * Computes one canonical SHA-256 digest.
 * @param {unknown} value Canonicalizable value.
 * @return {string} Lowercase digest.
 */
function digest(value: unknown): string {
    return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

/**
 * Binds all preview facts to one versioned digest.
 * @param {MigrationRollbackPreviewFacts} facts Normalized preview facts.
 * @return {string} Versioned facts digest.
 */
function previewFactsDigest(facts: MigrationRollbackPreviewFacts): string {
    return digest(Object.freeze({
        schema: 'courseflow-migration-rollback-preview-facts-v1',
        facts,
    }));
}

/**
 * Returns the immutable digest persisted by the handoff for command replay checks.
 * @param {ConfirmMigrationRollbackCommand} command Public preview-bound command.
 * @return {string} Canonical command digest.
 */
export function migrationRollbackConfirmationDigest(
    command: ConfirmMigrationRollbackCommand,
): string {
    return digest(Object.freeze({
        schema: 'courseflow-migration-rollback-confirmation-v1',
        command: normalizeConfirmMigrationRollbackCommand(command),
    }));
}

/**
 * Creates one path-free preview and retains the physical evidence only inside PROTECT.
 * @param {MigrationRollbackPreviewFacts} facts Fresh DATA, Library, and build facts.
 * @param {MigrationRollbackPreviewIdentity} identity Stable new session identities.
 * @return {PreparedMigrationRollbackPreview} Shell view plus owner-private confirmation state.
 */
export function createMigrationRollbackPreview(
    facts: MigrationRollbackPreviewFacts,
    identity: MigrationRollbackPreviewIdentity,
): PreparedMigrationRollbackPreview {
    if (!isCanonicalUuid(identity.migrationRollbackSessionId)
        || !isCanonicalUuid(identity.operationId)) {
        throw new TypeError('MigrationRollback preview identity is invalid');
    }
    const normalizedFacts = normalizePreviewFacts(facts);
    const factsDigest = previewFactsDigest(normalizedFacts);
    const previewToken = digest(Object.freeze({
        schema: 'courseflow-migration-rollback-preview-token-v1',
        migrationRollbackSessionId: identity.migrationRollbackSessionId,
        operationId: identity.operationId,
        sessionVersion: '0',
        factsDigest,
    }));
    const safetyCopy = normalizedFacts.safetyCopy.projection;
    const view: MigrationRollbackSessionView = Object.freeze({
        migrationRollbackSessionId: identity.migrationRollbackSessionId,
        operationId: identity.operationId,
        sessionVersion: '0',
        phase: 'previewed' as const,
        currentBuild: 'source' as const,
        binding: Object.freeze({
            safetyCopy,
            currentData: Object.freeze({
                workspaceId: normalizedFacts.currentData.workspaceId,
                schemaLevel: normalizedFacts.currentData.schemaLevel,
                revision: normalizedFacts.currentData.revision,
            }),
            currentLibrary: normalizedFacts.currentLibrary,
            sourceBuild: normalizedFacts.sourceBuild,
            targetBuild: safetyCopy.target,
            impact: Object.freeze({
                replacement: 'complete' as const,
                automaticMerge: false as const,
                currentRevision: normalizedFacts.currentData.revision,
                targetRevision: safetyCopy.sourceRevision,
                structuredDataChanges: 'discarded-after-target-revision' as const,
                libraryFiles: 'remain-in-place' as const,
                libraryReconciliation: 'full' as const,
            }),
        }),
        previewToken,
        retryCommand: null,
        allowedActions: Object.freeze(['confirm'] as const),
        outcome: null,
        problem: null,
    });
    if (!isMigrationRollbackSessionView(view)) {
        throw new Error('MigrationRollback preview projection is inconsistent');
    }
    return Object.freeze({view, facts: normalizedFacts, factsDigest});
}

/**
 * Revalidates the preview and derives the exact R6-03 handoff facts.
 * @param {PreparedMigrationRollbackPreview} prepared Owner-retained preview state.
 * @param {ConfirmMigrationRollbackCommand} command Shell confirmation.
 * @param {MigrationRollbackPreviewFacts} refreshedFacts Fresh pre-handoff facts.
 * @return {MigrationRollbackHandoffFacts} Immutable physical-kernel facts.
 */
export function bindMigrationRollbackConfirmation(
    prepared: PreparedMigrationRollbackPreview,
    command: ConfirmMigrationRollbackCommand,
    refreshedFacts: MigrationRollbackPreviewFacts,
): MigrationRollbackHandoffFacts {
    const normalizedCommand = normalizeConfirmMigrationRollbackCommand(command);
    if (normalizedCommand.migrationRollbackSessionId
            !== prepared.view.migrationRollbackSessionId
        || normalizedCommand.expectedSessionVersion !== '0'
        || normalizedCommand.previewToken !== prepared.view.previewToken) {
        throw new Error('MigrationRollback preview-token mismatch');
    }
    const normalizedRefreshedFacts = normalizePreviewFacts(refreshedFacts);
    if (previewFactsDigest(normalizedRefreshedFacts) !== prepared.factsDigest) {
        throw new Error('MigrationRollback impact-changed');
    }
    const safetyCopy = normalizedRefreshedFacts.safetyCopy.projection;
    return Object.freeze({
        migrationRollbackSessionId: normalizedCommand.migrationRollbackSessionId,
        operationId: prepared.view.operationId!,
        sourceAppBuildId: normalizedRefreshedFacts.sourceBuild.appBuildId,
        currentAppBuildId: normalizedRefreshedFacts.sourceBuild.appBuildId,
        targetAppBuildId: safetyCopy.target.appBuildId,
        sourceReleaseVersion: normalizedRefreshedFacts.sourceBuild.releaseVersion,
        currentReleaseVersion: normalizedRefreshedFacts.sourceBuild.releaseVersion,
        targetReleaseVersion: safetyCopy.target.releaseVersion,
        previewDigest: normalizedCommand.previewToken,
        confirmationDigest: migrationRollbackConfirmationDigest(normalizedCommand),
        safetyCopy: Object.freeze({
            migrationSafetyCopyId: safetyCopy.migrationSafetyCopyId,
            workspaceId: safetyCopy.workspaceId,
            schemaLevel: safetyCopy.sourceSchemaLevel,
            revision: safetyCopy.sourceRevision,
            byteLength: safetyCopy.byteSize,
            digest: normalizedRefreshedFacts.safetyCopy.closedDataSlotDigest,
        }),
        currentData: Object.freeze({
            workspaceId: normalizedRefreshedFacts.currentData.workspaceId,
            schemaLevel: normalizedRefreshedFacts.currentData.schemaLevel,
            revision: normalizedRefreshedFacts.currentData.revision,
            byteLength: normalizedRefreshedFacts.currentData.byteLength,
            digest: normalizedRefreshedFacts.currentData.digest,
            slotFingerprint: normalizedRefreshedFacts.currentData.slotFingerprint,
        }),
    });
}
