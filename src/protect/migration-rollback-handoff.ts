/**
 * @file Owns the bounded ADR-10 MigrationRollbackHandoffV1 physical coordination kernel.
 */

import {createHash, randomUUID} from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';

import {
    ensureSnapshotStagingDirectory,
    listPlainDirectory,
    plainChildDirectoryExists,
    plainFileExists,
    publishBackupMember,
    publishSnapshotDirectory,
    readBoundedPlainFile,
    syncPlainFile,
} from '../platform/backup-snapshot-files';
import {
    observeRestoreDataSlot,
    renameRestoreDataSlot,
    requireRestoreSameVolume,
    type RestoreActivationFileOptions,
    type RestoreDataSlotFingerprint,
    type RestoreDataSlotObservation,
} from '../platform/restore-activation-files';
import {canonicalJson} from '../shared/canonical-json';
import {
    isCanonicalUnsignedSqliteInteger,
    isCanonicalUuid,
} from '../shared/workspace-data-contract';
import {inspectRestoreBeforeWorkspaceOpen} from './restore-activation';

const MIGRATION_ROLLBACK_DIRECTORY_NAME = 'migration-rollback';
const JOURNAL_DIRECTORY_NAME = 'journal';
const ACTIVE_SLOT_NAME = 'active';
const RECORD_MAXIMUM_BYTES = 65_536;
const TOTAL_RECORD_LIMIT = 256;
const RECORD_SCHEMA = 'courseflow-migration-rollback-handoff-v1';
const LIMITS_VERSION = 'migration-rollback-handoff-limits-v1';
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const TEMPORARY_PUBLICATION_NAME = /^\.tmp-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAXIMUM_JSON_DEPTH = 12;
const MAXIMUM_JSON_STRING_LENGTH = 1_024;

const RECORD_KINDS = Object.freeze([
    'planned',
    'intent-stage-safety',
    'observed-stage-safety',
    'prepared',
    'command-confirm',
    'intent-retire-current',
    'observed-retire-current',
    'armed',
    'intent-install-safety',
    'observed-install-safety',
    'awaiting-target-build',
    'command-continue',
    'completing',
    'succeeded',
    'command-cancel',
    'intent-quarantine-safety',
    'observed-quarantine-safety',
    'intent-restore-current',
    'observed-restore-current',
    'cancelling',
    'cancelled',
] as const);

type RecordKind = typeof RECORD_KINDS[number];
type BuildClassification = 'source' | 'target' | 'other';
type AllowedAction = 'cancel-as-source' | 'continue-as-target';
type NonterminalPhase =
    | 'planned'
    | 'prepared'
    | 'armed'
    | 'awaiting-target-build'
    | 'completing'
    | 'cancelling';
type TerminalPhase = 'succeeded' | 'cancelled';

export type MigrationRollbackDataIdentity = Readonly<{
    workspaceId: string;
    schemaLevel: string;
    revision: string;
}>;

export type MigrationRollbackHandoffFacts = Readonly<{
    migrationRollbackSessionId: string;
    operationId: string;
    sourceAppBuildId: string;
    currentAppBuildId: string;
    targetAppBuildId: string;
    sourceReleaseVersion: string;
    currentReleaseVersion: string;
    targetReleaseVersion: string;
    previewDigest: string;
    confirmationDigest: string;
    safetyCopy: Readonly<{
        migrationSafetyCopyId: string;
        workspaceId: string;
        schemaLevel: string;
        revision: string;
        byteLength: string;
        digest: string;
    }>;
    currentData: Readonly<{
        workspaceId: string;
        schemaLevel: string;
        revision: string;
        byteLength: string;
        digest: string;
        slotFingerprint: string;
    }>;
}>;

export type MigrationRollbackCommand = Readonly<{
    action: 'confirm' | 'continue-as-target' | 'cancel-as-source';
    commandId: string;
    migrationRollbackSessionId: string;
    expectedSessionVersion: string;
    currentAppBuildId: string;
}>;

export type MigrationRollbackBaseCompletionCallbacks = Readonly<{
    reopen(expected: MigrationRollbackDataIdentity): Promise<void>;
    libraryReconcile(): Promise<void>;
    flow00(): Promise<void>;
}>;

export type MigrationRollbackTargetCompletionCallbacks =
    MigrationRollbackBaseCompletionCallbacks & Readonly<{
        consumeSafetyCopy(input: Readonly<{
            migrationSafetyCopyId: string;
            operationId: string;
        }>): Promise<void>;
    }>;

export type MigrationRollbackSafetyStagingPort = (
    input: Readonly<{
        migrationSafetyCopyId: string;
        candidateSlotName: string;
    }>,
) => RestoreDataSlotFingerprint;

export type MigrationRollbackHandoffOptions = Readonly<{
    failpoint?: (point: string) => void;
    files?: RestoreActivationFileOptions;
}>;

export type MigrationRollbackStatus = Readonly<{
    kind: 'maintenance' | 'recovery-required' | 'succeeded' | 'cancelled';
    migrationRollbackSessionId: string | null;
    operationId: string | null;
    sessionVersion: string | null;
    phase: NonterminalPhase | TerminalPhase | 'recovery-required' | null;
    currentBuild: BuildClassification | null;
    requiredBuilds: Readonly<{
        sourceAppBuildId: string;
        sourceReleaseVersion: string;
        targetAppBuildId: string;
        targetReleaseVersion: string;
    }> | null;
    allowedActions: readonly AllowedAction[];
    retryCommand: Readonly<{
        action: 'continue-as-target' | 'cancel-as-source';
        commandId: string;
        expectedSessionVersion: string;
    }> | null;
    outcome: TerminalPhase | null;
}>;

export type MigrationRollbackBootState = MigrationRollbackStatus | Readonly<{
    kind: 'clear';
    migrationRollbackSessionId: null;
    operationId: null;
    sessionVersion: null;
    phase: null;
    currentBuild: null;
    requiredBuilds: null;
    allowedActions: readonly [];
    retryCommand: null;
    outcome: null;
}>;

export type NonterminalMigrationRollbackInspection = Readonly<{
    kind: 'clear' | 'nonterminal' | 'recovery-required';
    migrationRollbackSessionId: string | null;
    operationId: string | null;
}>;

export class MigrationRollbackHandoffError extends Error {
    public constructor(
        public readonly code:
            | 'activation-pending'
            | 'completion-pending'
            | 'command-conflict'
            | 'build-mismatch'
            | 'recovery-required',
        cause?: unknown,
    ) {
        super(code, {cause});
        this.name = 'MigrationRollbackHandoffError';
    }
}

type SlotState = Readonly<{
    kind: 'absent' | 'present';
    slotFingerprint: string | null;
}>;

type PhysicalEvidence = Readonly<{
    active: SlotState;
    candidate: SlotState;
    rollback: SlotState;
    quarantine: SlotState;
}>;

type CommandEvidence = Readonly<{
    action: MigrationRollbackCommand['action'];
    commandId: string;
    commandDigest: string;
    currentAppBuildId: string;
    expectedSessionVersion: string;
}>;

type HandoffRecord = Readonly<{
    schema: typeof RECORD_SCHEMA;
    limitsVersion: typeof LIMITS_VERSION;
    handoff: MigrationRollbackHandoffFacts;
    sequence: string;
    kind: RecordKind;
    phase: NonterminalPhase | TerminalPhase;
    allowedActorAppBuildIds: readonly string[];
    previousRecordDigest: string | null;
    before: PhysicalEvidence | null;
    after: PhysicalEvidence | null;
    command: CommandEvidence | null;
    receiptDigest: string | null;
    recordDigest: string;
}>;

function recordPhase(kind: RecordKind): NonterminalPhase | TerminalPhase {
    if (kind === 'planned' || kind === 'intent-stage-safety') {
        return 'planned';
    }
    if (kind === 'observed-stage-safety'
        || kind === 'prepared'
        || kind === 'command-confirm'
        || kind === 'intent-retire-current') {
        return 'prepared';
    }
    if (kind === 'observed-retire-current'
        || kind === 'armed'
        || kind === 'intent-install-safety') {
        return 'armed';
    }
    if (kind === 'observed-install-safety' || kind === 'awaiting-target-build') {
        return 'awaiting-target-build';
    }
    if (kind === 'command-continue' || kind === 'completing') {
        return 'completing';
    }
    if (kind === 'succeeded') {
        return 'succeeded';
    }
    if (kind === 'cancelled') {
        return 'cancelled';
    }
    return 'cancelling';
}

function allowedActors(
    handoff: MigrationRollbackHandoffFacts,
    phase: NonterminalPhase | TerminalPhase,
): readonly string[] {
    if (phase === 'planned' || phase === 'prepared' || phase === 'cancelling') {
        return Object.freeze([handoff.currentAppBuildId]);
    }
    if (phase === 'armed' || phase === 'awaiting-target-build') {
        return Object.freeze([handoff.currentAppBuildId, handoff.targetAppBuildId]);
    }
    if (phase === 'completing') {
        return Object.freeze([handoff.targetAppBuildId]);
    }
    return Object.freeze([]);
}

/**
 * Tests exact enumerable plain-object keys.
 * @param {unknown} value - Candidate object.
 * @param {readonly string[]} keys - Complete allowed key set.
 * @return {boolean} Whether the candidate has exactly those data properties.
 */
function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
    if (typeof value !== 'object'
        || value === null
        || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype) {
        return false;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Reflect.ownKeys(descriptors);
    return actual.length === keys.length
        && actual.every(key => typeof key === 'string' && keys.includes(key))
        && keys.every(key => {
            const descriptor = descriptors[key];
            return descriptor !== undefined && descriptor.enumerable && 'value' in descriptor;
        });
}

/**
 * Compares bounded evidence canonically.
 * @param {unknown} left - First evidence value.
 * @param {unknown} right - Second evidence value.
 * @return {boolean} Whether both values encode identically.
 */
function sameEvidence(left: unknown, right: unknown): boolean {
    return canonicalJson(left) === canonicalJson(right);
}

/**
 * Computes a canonical digest with one named field omitted.
 * @param {Record<string, unknown>} value - Complete canonical object.
 * @param {string} digestField - Field omitted from digest input.
 * @return {string} Lowercase SHA-256 digest.
 */
function digestWithout(value: Record<string, unknown>, digestField: string): string {
    const copy = {...value};
    delete copy[digestField];
    return createHash('sha256').update(canonicalJson(copy), 'utf8').digest('hex');
}

/**
 * Requires bounded JSON structure before semantic use.
 * @param {unknown} value - Parsed JSON value.
 * @param {number} depth - Current nesting depth.
 * @return {void}
 */
function requireJsonBounds(value: unknown, depth = 0): void {
    if (depth > MAXIMUM_JSON_DEPTH) {
        throw new Error('Migration rollback handoff depth limit exceeded');
    }
    if (typeof value === 'string') {
        if (value.length > MAXIMUM_JSON_STRING_LENGTH) {
            throw new Error('Migration rollback handoff string limit exceeded');
        }
        return;
    }
    if (Array.isArray(value)) {
        value.forEach(item => requireJsonBounds(item, depth + 1));
        return;
    }
    if (typeof value === 'object' && value !== null) {
        Object.entries(value).forEach(([key, item]) => {
            requireJsonBounds(key, depth + 1);
            requireJsonBounds(item, depth + 1);
        });
    }
}

/**
 * Strictly parses one canonical bounded UTF-8 record.
 * @param {Buffer} bytes - Exact immutable bytes.
 * @return {unknown} Parsed bounded value.
 */
function parseCanonicalRecord(bytes: Buffer): unknown {
    if (bytes.byteLength > RECORD_MAXIMUM_BYTES
        || (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF)) {
        throw new Error('Migration rollback handoff raw limit exceeded');
    }
    const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    const value = JSON.parse(text) as unknown;
    requireJsonBounds(value);
    if (canonicalJson(value) !== text) {
        throw new Error('Migration rollback handoff is not canonical');
    }
    return value;
}

/**
 * Tests one bounded nonempty identity string.
 * @param {unknown} value - Candidate string.
 * @return {boolean} Whether the string stays within the V1 core.
 */
function isBoundedIdentity(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 255;
}

/**
 * Validates immutable handoff facts.
 * @param {unknown} value - Candidate facts.
 * @return {MigrationRollbackHandoffFacts} Strict facts.
 */
function requireHandoffFacts(value: unknown): MigrationRollbackHandoffFacts {
    if (!hasExactKeys(value, [
        'migrationRollbackSessionId',
        'operationId',
        'sourceAppBuildId',
        'currentAppBuildId',
        'targetAppBuildId',
        'sourceReleaseVersion',
        'currentReleaseVersion',
        'targetReleaseVersion',
        'previewDigest',
        'confirmationDigest',
        'safetyCopy',
        'currentData',
    ])
        || !isCanonicalUuid(value.migrationRollbackSessionId)
        || !isCanonicalUuid(value.operationId)
        || !isBoundedIdentity(value.sourceAppBuildId)
        || !isBoundedIdentity(value.currentAppBuildId)
        || value.sourceAppBuildId !== value.currentAppBuildId
        || !isBoundedIdentity(value.targetAppBuildId)
        || value.currentAppBuildId === value.targetAppBuildId
        || !isBoundedIdentity(value.sourceReleaseVersion)
        || !isBoundedIdentity(value.currentReleaseVersion)
        || value.sourceReleaseVersion !== value.currentReleaseVersion
        || !isBoundedIdentity(value.targetReleaseVersion)
        || typeof value.previewDigest !== 'string'
        || !DIGEST_PATTERN.test(value.previewDigest)
        || typeof value.confirmationDigest !== 'string'
        || !DIGEST_PATTERN.test(value.confirmationDigest)
        || !hasExactKeys(value.safetyCopy, [
            'migrationSafetyCopyId',
            'workspaceId',
            'schemaLevel',
            'revision',
            'byteLength',
            'digest',
        ])
        || !isCanonicalUuid(value.safetyCopy.migrationSafetyCopyId)
        || !isCanonicalUuid(value.safetyCopy.workspaceId)
        || !isCanonicalUnsignedSqliteInteger(value.safetyCopy.schemaLevel)
        || !isCanonicalUnsignedSqliteInteger(value.safetyCopy.revision)
        || !isCanonicalUnsignedSqliteInteger(value.safetyCopy.byteLength)
        || typeof value.safetyCopy.digest !== 'string'
        || !DIGEST_PATTERN.test(value.safetyCopy.digest)
        || !hasExactKeys(value.currentData, [
            'workspaceId',
            'schemaLevel',
            'revision',
            'byteLength',
            'digest',
            'slotFingerprint',
        ])
        || !isCanonicalUuid(value.currentData.workspaceId)
        || value.currentData.workspaceId !== value.safetyCopy.workspaceId
        || !isCanonicalUnsignedSqliteInteger(value.currentData.schemaLevel)
        || !isCanonicalUnsignedSqliteInteger(value.currentData.revision)
        || !isCanonicalUnsignedSqliteInteger(value.currentData.byteLength)
        || typeof value.currentData.digest !== 'string'
        || !DIGEST_PATTERN.test(value.currentData.digest)
        || typeof value.currentData.slotFingerprint !== 'string'
        || !DIGEST_PATTERN.test(value.currentData.slotFingerprint)) {
        throw new TypeError('Migration rollback handoff facts are invalid');
    }
    return value as MigrationRollbackHandoffFacts;
}

function fingerprintForMember(byteLength: string, digest: string): string {
    return createHash('sha256').update(canonicalJson({
        schema: 'courseflow-data-slot-fingerprint-v1',
        members: [{path: 'workspace.sqlite', byteLength, sha256: digest}],
    }), 'utf8').digest('hex');
}

/**
 * Returns the operation control directory.
 * @param {string} activityControlRoot - Stable activity control root.
 * @param {string} operationId - Canonical operation identity.
 * @return {string} Private operation path.
 */
function operationDirectory(activityControlRoot: string, operationId: string): string {
    return path.join(activityControlRoot, MIGRATION_ROLLBACK_DIRECTORY_NAME, operationId);
}

/**
 * Returns one deterministic operation-owned DATA sibling name.
 * @param {'candidate' | 'rollback' | 'quarantine'} role - Physical sibling role.
 * @param {string} operationId - Canonical operation identity.
 * @return {string} Direct-child slot name.
 */
function slotName(
    role: 'candidate' | 'rollback' | 'quarantine',
    operationId: string,
): string {
    return `.migration-rollback-${role}-${operationId}`;
}

/**
 * Converts a PLATFORM observation to path-free evidence.
 * @param {RestoreDataSlotObservation} observation - Fresh slot observation.
 * @return {SlotState} Closed path-free slot state.
 */
function slotState(observation: RestoreDataSlotObservation): SlotState {
    return observation.kind === 'absent'
        ? Object.freeze({kind: 'absent' as const, slotFingerprint: null})
        : Object.freeze({
            kind: 'present' as const,
            slotFingerprint: observation.fingerprint.slotFingerprint,
        });
}

/**
 * Freshly observes all operation-owned DATA locations.
 * @param {string} dataSlotsRoot - Trusted DataSlots parent.
 * @param {string} operationId - Canonical operation identity.
 * @return {PhysicalEvidence} Complete path-free physical state.
 */
function observePhysical(dataSlotsRoot: string, operationId: string): PhysicalEvidence {
    return Object.freeze({
        active: slotState(observeRestoreDataSlot(dataSlotsRoot, ACTIVE_SLOT_NAME)),
        candidate: slotState(observeRestoreDataSlot(
            dataSlotsRoot,
            slotName('candidate', operationId),
        )),
        rollback: slotState(observeRestoreDataSlot(
            dataSlotsRoot,
            slotName('rollback', operationId),
        )),
        quarantine: slotState(observeRestoreDataSlot(
            dataSlotsRoot,
            slotName('quarantine', operationId),
        )),
    });
}

/**
 * Returns all exact physical states permitted by the immutable facts.
 * @param {MigrationRollbackHandoffFacts} facts - Immutable handoff facts.
 * @return {Readonly<object>} Closed physical state set.
 */
function physicalStates(facts: MigrationRollbackHandoffFacts): Readonly<{
    planned: PhysicalEvidence;
    prepared: PhysicalEvidence;
    retired: PhysicalEvidence;
    installed: PhysicalEvidence;
    quarantinedRetired: PhysicalEvidence;
    quarantinedInstalled: PhysicalEvidence;
    cancelled: PhysicalEvidence;
}> {
    const absent = Object.freeze({kind: 'absent' as const, slotFingerprint: null});
    const current = Object.freeze({
        kind: 'present' as const,
        slotFingerprint: facts.currentData.slotFingerprint,
    });
    const safetyFingerprint = fingerprintForMember(
        facts.safetyCopy.byteLength,
        facts.safetyCopy.digest,
    );
    const safety = Object.freeze({
        kind: 'present' as const,
        slotFingerprint: safetyFingerprint,
    });
    return Object.freeze({
        planned: Object.freeze({active: current, candidate: absent, rollback: absent, quarantine: absent}),
        prepared: Object.freeze({active: current, candidate: safety, rollback: absent, quarantine: absent}),
        retired: Object.freeze({active: absent, candidate: safety, rollback: current, quarantine: absent}),
        installed: Object.freeze({active: safety, candidate: absent, rollback: current, quarantine: absent}),
        quarantinedRetired: Object.freeze({active: absent, candidate: absent, rollback: current, quarantine: safety}),
        quarantinedInstalled: Object.freeze({active: absent, candidate: absent, rollback: current, quarantine: safety}),
        cancelled: Object.freeze({active: current, candidate: absent, rollback: absent, quarantine: safety}),
    });
}

/**
 * Requires one exact path-free slot state.
 * @param {unknown} value - Candidate slot state.
 * @return {boolean} Whether the slot state is closed and valid.
 */
function isSlotState(value: unknown): value is SlotState {
    return hasExactKeys(value, ['kind', 'slotFingerprint'])
        && (value.kind === 'absent' || value.kind === 'present')
        && (value.kind === 'absent'
            ? value.slotFingerprint === null
            : typeof value.slotFingerprint === 'string' && DIGEST_PATTERN.test(value.slotFingerprint));
}

/**
 * Requires one exact physical evidence value.
 * @param {unknown} value - Candidate evidence.
 * @return {boolean} Whether the evidence is the closed V1 shape.
 */
function isPhysicalEvidence(value: unknown): value is PhysicalEvidence {
    return hasExactKeys(value, ['active', 'candidate', 'rollback', 'quarantine'])
        && isSlotState(value.active)
        && isSlotState(value.candidate)
        && isSlotState(value.rollback)
        && isSlotState(value.quarantine);
}

/**
 * Requires one exact command evidence value.
 * @param {unknown} value - Candidate command evidence.
 * @return {boolean} Whether the command evidence is closed and canonical.
 */
function isCommandEvidence(value: unknown): value is CommandEvidence {
    return hasExactKeys(value, [
        'action',
        'commandId',
        'commandDigest',
        'currentAppBuildId',
        'expectedSessionVersion',
    ])
        && (value.action === 'confirm'
            || value.action === 'continue-as-target'
            || value.action === 'cancel-as-source')
        && isCanonicalUuid(value.commandId)
        && typeof value.commandDigest === 'string'
        && DIGEST_PATTERN.test(value.commandDigest)
        && isBoundedIdentity(value.currentAppBuildId)
        && isCanonicalUnsignedSqliteInteger(value.expectedSessionVersion);
}

/**
 * Validates kind-specific fixed evidence.
 * @param {HandoffRecord} record - Digest-valid record.
 * @return {void}
 */
function requireRecordEvidence(record: HandoffRecord): void {
    const states = physicalStates(record.handoff);
    const matches = (before: PhysicalEvidence | null, after: PhysicalEvidence | null): boolean => (
        sameEvidence(record.before, before) && sameEvidence(record.after, after)
    );
    let valid = false;
    switch (record.kind) {
        case 'planned':
            valid = matches(states.planned, states.planned);
            break;
        case 'intent-stage-safety':
        case 'observed-stage-safety':
            valid = matches(states.planned, states.prepared);
            break;
        case 'prepared':
            valid = matches(states.prepared, states.prepared);
            break;
        case 'intent-retire-current':
        case 'observed-retire-current':
            valid = matches(states.prepared, states.retired);
            break;
        case 'armed':
            valid = matches(states.retired, states.retired);
            break;
        case 'intent-install-safety':
        case 'observed-install-safety':
            valid = matches(states.retired, states.installed);
            break;
        case 'awaiting-target-build':
        case 'completing':
            valid = matches(states.installed, states.installed);
            break;
        case 'intent-quarantine-safety':
        case 'observed-quarantine-safety':
            valid = (matches(states.retired, states.quarantinedRetired)
                || matches(states.installed, states.quarantinedInstalled));
            break;
        case 'intent-restore-current':
        case 'observed-restore-current':
            valid = matches(states.quarantinedRetired, states.cancelled);
            break;
        case 'cancelling':
            valid = matches(states.cancelled, states.cancelled);
            break;
        case 'succeeded':
            valid = matches(states.installed, states.installed);
            break;
        case 'cancelled':
            valid = matches(record.before, record.after)
                && (sameEvidence(record.after, states.planned)
                    || sameEvidence(record.after, states.prepared)
                    || sameEvidence(record.after, states.cancelled));
            break;
        case 'command-confirm':
        case 'command-continue':
        case 'command-cancel':
            valid = record.before === null && record.after === null;
            break;
    }
    const isCommandKind = record.kind === 'command-confirm'
        || record.kind === 'command-continue'
        || record.kind === 'command-cancel';
    const commandMatchesKind = record.kind === 'command-confirm'
        ? record.command?.action === 'confirm'
        : record.kind === 'command-continue'
            ? record.command?.action === 'continue-as-target'
            : record.kind === 'command-cancel'
                ? record.command?.action === 'cancel-as-source'
                : true;
    const isTerminal = record.kind === 'succeeded' || record.kind === 'cancelled';
    const expectedReceiptDigest = isTerminal
        ? terminalReceiptDigest(record.handoff, record.kind as TerminalPhase)
        : null;
    if (!valid
        || !commandMatchesKind
        || (isCommandKind ? !isCommandEvidence(record.command) : record.command !== null)
        || record.receiptDigest !== expectedReceiptDigest) {
        throw new Error('Migration rollback record evidence is invalid');
    }
}

/**
 * Validates one handoff record and its digest.
 * @param {unknown} value - Parsed candidate record.
 * @return {HandoffRecord} Strict record.
 */
function requireRecord(value: unknown): HandoffRecord {
    if (!hasExactKeys(value, [
        'schema',
        'limitsVersion',
        'handoff',
        'sequence',
        'kind',
        'phase',
        'allowedActorAppBuildIds',
        'previousRecordDigest',
        'before',
        'after',
        'command',
        'receiptDigest',
        'recordDigest',
    ])
        || value.schema !== RECORD_SCHEMA
        || value.limitsVersion !== LIMITS_VERSION
        || !isCanonicalUnsignedSqliteInteger(value.sequence)
        || value.sequence === '0'
        || typeof value.kind !== 'string'
        || !RECORD_KINDS.includes(value.kind as RecordKind)
        || value.phase !== recordPhase(value.kind as RecordKind)
        || !Array.isArray(value.allowedActorAppBuildIds)
        || !(value.previousRecordDigest === null
            || (typeof value.previousRecordDigest === 'string'
                && DIGEST_PATTERN.test(value.previousRecordDigest)))
        || !(value.before === null || isPhysicalEvidence(value.before))
        || !(value.after === null || isPhysicalEvidence(value.after))
        || !(value.command === null || isCommandEvidence(value.command))
        || !(value.receiptDigest === null
            || (typeof value.receiptDigest === 'string' && DIGEST_PATTERN.test(value.receiptDigest)))
        || typeof value.recordDigest !== 'string'
        || !DIGEST_PATTERN.test(value.recordDigest)
        || digestWithout(value, 'recordDigest') !== value.recordDigest) {
        throw new Error('Migration rollback handoff record is invalid');
    }
    requireHandoffFacts(value.handoff);
    const record = value as HandoffRecord;
    if (!sameEvidence(record.allowedActorAppBuildIds, allowedActors(record.handoff, record.phase))) {
        throw new Error('Migration rollback allowed actor evidence is invalid');
    }
    requireRecordEvidence(record);
    return record;
}

/**
 * Validates the closed transition history and command identities.
 * @param {readonly HandoffRecord[]} records - Digest-valid record chain.
 * @return {void}
 */
function requireTransitions(records: readonly HandoffRecord[]): void {
    if (records[0]?.kind !== 'planned'
        || records.filter(record => record.kind === 'planned').length !== 1
        || records.filter(record => record.kind === 'prepared').length > 1
        || records.filter(record => record.kind === 'succeeded').length > 1
        || records.filter(record => record.kind === 'cancelled').length > 1) {
        throw new Error('Migration rollback handoff transition is invalid');
    }
    const terminalIndex = records.findIndex(record => (
        record.kind === 'succeeded' || record.kind === 'cancelled'
    ));
    if (terminalIndex >= 0 && terminalIndex !== records.length - 1) {
        throw new Error('Migration rollback terminal record is not final');
    }
    const commandIds = new Map<string, string>();
    const confirmCount = records.filter(record => record.kind === 'command-confirm').length;
    const continueCount = records.filter(record => record.kind === 'command-continue').length;
    const cancelCount = records.filter(record => record.kind === 'command-cancel').length;
    if (confirmCount > 1 || continueCount > 1 || cancelCount > 1
        || (continueCount > 0 && cancelCount > 0)) {
        throw new Error('Migration rollback command branch is invalid');
    }
    for (const record of records) {
        if (!record.command) {
            continue;
        }
        const prior = commandIds.get(record.command.commandId);
        if (prior !== undefined && prior !== record.command.commandDigest) {
            throw new Error('Migration rollback CommandId conflicts');
        }
        if (prior !== undefined) {
            throw new Error('Migration rollback command is duplicated');
        }
        commandIds.set(record.command.commandId, record.command.commandDigest);
    }
    const requireBefore = (kind: RecordKind, dependency: RecordKind): void => {
        const index = records.findIndex(record => record.kind === kind);
        if (index >= 0 && !records.slice(0, index).some(record => record.kind === dependency)) {
            throw new Error('Migration rollback handoff transition dependency is missing');
        }
    };
    requireBefore('prepared', 'planned');
    requireBefore('intent-stage-safety', 'planned');
    requireBefore('observed-stage-safety', 'intent-stage-safety');
    requireBefore('prepared', 'observed-stage-safety');
    requireBefore('command-confirm', 'prepared');
    requireBefore('intent-retire-current', 'command-confirm');
    requireBefore('observed-retire-current', 'intent-retire-current');
    requireBefore('armed', 'observed-retire-current');
    requireBefore('intent-install-safety', 'observed-retire-current');
    requireBefore('observed-install-safety', 'intent-install-safety');
    requireBefore('awaiting-target-build', 'observed-install-safety');
    requireBefore('completing', 'command-continue');
    requireBefore('succeeded', 'completing');
    requireBefore('intent-quarantine-safety', 'command-cancel');
    requireBefore('observed-quarantine-safety', 'intent-quarantine-safety');
    requireBefore('intent-restore-current', 'observed-quarantine-safety');
    requireBefore('observed-restore-current', 'intent-restore-current');
    requireBefore('cancelling', 'command-cancel');
    requireBefore('cancelled', 'command-cancel');
}

/**
 * Requires the known control-directory closure.
 * @param {string} activityControlRoot - Stable activity control root.
 * @param {string} operationId - Canonical operation identity.
 * @return {void}
 */
function requireOperationClosure(activityControlRoot: string, operationId: string): void {
    const operationPath = operationDirectory(activityControlRoot, operationId);
    const entries = listPlainDirectory(operationPath);
    if (entries.length !== 1 || entries[0] !== JOURNAL_DIRECTORY_NAME
        || !plainChildDirectoryExists(operationPath, JOURNAL_DIRECTORY_NAME)) {
        throw new Error('Migration rollback operation closure is invalid');
    }
}

/**
 * Reads and validates one complete append-only handoff chain.
 * @param {string} activityControlRoot - Stable activity control root.
 * @param {string} operationId - Canonical operation identity.
 * @return {readonly HandoffRecord[]} Validated record chain.
 */
function readRecords(
    activityControlRoot: string,
    operationId: string,
): readonly HandoffRecord[] {
    requireOperationClosure(activityControlRoot, operationId);
    const journalPath = path.join(operationDirectory(
        activityControlRoot,
        operationId,
    ), JOURNAL_DIRECTORY_NAME);
    const entries = listPlainDirectory(journalPath);
    if (entries.length > TOTAL_RECORD_LIMIT) {
        throw new Error('Migration rollback journal entry limit exceeded');
    }
    entries.filter(name => TEMPORARY_PUBLICATION_NAME.test(name)).forEach(name => {
        plainFileExists(path.join(journalPath, name));
    });
    const names = entries.filter(name => !TEMPORARY_PUBLICATION_NAME.test(name));
    if (names.length === 0 || names.length > TOTAL_RECORD_LIMIT) {
        throw new Error('Migration rollback handoff record count is invalid');
    }
    const records = names.map(name => {
        const record = requireRecord(parseCanonicalRecord(readBoundedPlainFile(
            path.join(journalPath, name),
            RECORD_MAXIMUM_BYTES,
        )));
        const expectedName = `${record.sequence.padStart(6, '0')}-${record.kind}-${record.recordDigest}`;
        if (name !== expectedName) {
            throw new Error('Migration rollback handoff filename is invalid');
        }
        return record;
    });
    const handoff = records[0]!.handoff;
    records.forEach((record, index) => {
        if (record.sequence !== (index + 1).toString()
            || record.previousRecordDigest !== (records[index - 1]?.recordDigest ?? null)
            || !sameEvidence(record.handoff, handoff)) {
            throw new Error('Migration rollback handoff hash chain is invalid');
        }
    });
    requireTransitions(records);
    return Object.freeze(records);
}

/**
 * Runs one stable injected failpoint.
 * @param {MigrationRollbackHandoffOptions} options - Kernel options.
 * @param {string} point - Stable failpoint name.
 * @return {void}
 */
function fail(options: MigrationRollbackHandoffOptions, point: string): void {
    options.failpoint?.(point);
}

/**
 * Publishes immutable canonical bytes and verifies the reopened result.
 * @param {string} finalPath - Absent final path.
 * @param {Buffer} bytes - Exact canonical bytes.
 * @param {MigrationRollbackHandoffOptions} options - Publication options.
 * @param {string} phase - Stable phase name.
 * @return {void}
 */
function publishRecord(
    finalPath: string,
    bytes: Buffer,
    options: MigrationRollbackHandoffOptions,
    phase: string,
): void {
    if (bytes.byteLength > RECORD_MAXIMUM_BYTES) {
        throw new Error('Migration rollback record raw limit exceeded');
    }
    if (plainFileExists(finalPath)) {
        if (!readBoundedPlainFile(finalPath, RECORD_MAXIMUM_BYTES).equals(bytes)) {
            throw new Error('Migration rollback record publication conflicts');
        }
        return;
    }
    const temporaryPath = path.join(path.dirname(finalPath), `.tmp-${randomUUID()}`);
    fail(options, `${phase}.before-temp-write`);
    writeFileSync(temporaryPath, bytes, {flag: 'wx'});
    fail(options, `${phase}.after-temp-write`);
    syncPlainFile(temporaryPath);
    fail(options, `${phase}.after-temp-sync`);
    fail(options, `${phase}.after-temp-close`);
    publishBackupMember(temporaryPath, finalPath);
    fail(options, `${phase}.after-publish`);
    if (!readBoundedPlainFile(finalPath, RECORD_MAXIMUM_BYTES).equals(bytes)) {
        throw new Error('Migration rollback record could not be reopened');
    }
    fail(options, `${phase}.after-reopen`);
}

/**
 * Appends and revalidates one closed handoff record.
 * @param {string} activityControlRoot - Stable activity control root.
 * @param {MigrationRollbackHandoffFacts} handoff - Immutable operation facts.
 * @param {RecordKind} kind - Closed record kind.
 * @param {PhysicalEvidence | null} before - Typed before evidence.
 * @param {PhysicalEvidence | null} after - Typed after evidence.
 * @param {CommandEvidence | null} commandEvidence - Typed command evidence.
 * @param {string | null} receiptDigest - Terminal receipt digest.
 * @param {MigrationRollbackHandoffOptions} options - Clock and failpoints.
 * @return {HandoffRecord} Reopened appended record.
 */
function appendRecord(
    activityControlRoot: string,
    handoff: MigrationRollbackHandoffFacts,
    kind: RecordKind,
    before: PhysicalEvidence | null,
    after: PhysicalEvidence | null,
    commandEvidence: CommandEvidence | null,
    receiptDigest: string | null,
    options: MigrationRollbackHandoffOptions,
): HandoffRecord {
    const records = readRecords(activityControlRoot, handoff.operationId);
    if (records.length >= TOTAL_RECORD_LIMIT) {
        throw new Error('Migration rollback handoff record limit exceeded');
    }
    const prior = records.at(-1)!;
    const undigested = {
        schema: RECORD_SCHEMA as typeof RECORD_SCHEMA,
        limitsVersion: LIMITS_VERSION as typeof LIMITS_VERSION,
        handoff,
        sequence: (records.length + 1).toString(),
        kind,
        phase: recordPhase(kind),
        allowedActorAppBuildIds: allowedActors(handoff, recordPhase(kind)),
        previousRecordDigest: prior.recordDigest,
        before,
        after,
        command: commandEvidence,
        receiptDigest,
    };
    const record: HandoffRecord = Object.freeze({
        ...undigested,
        recordDigest: createHash('sha256')
            .update(canonicalJson(undigested), 'utf8')
            .digest('hex'),
    });
    requireRecordEvidence(record);
    const fileName = `${record.sequence.padStart(6, '0')}-${record.kind}-${record.recordDigest}`;
    publishRecord(
        path.join(operationDirectory(
            activityControlRoot,
            handoff.operationId,
        ), JOURNAL_DIRECTORY_NAME, fileName),
        Buffer.from(canonicalJson(record), 'utf8'),
        options,
        `handoff.${kind}`,
    );
    return readRecords(activityControlRoot, handoff.operationId).at(-1)!;
}

/**
 * Creates the first immutable planned record in a new operation directory.
 * @param {string} activityControlRoot - Stable activity control root.
 * @param {MigrationRollbackHandoffFacts} handoff - Strict operation facts.
 * @param {PhysicalEvidence} evidence - Fresh unchanged current evidence.
 * @param {MigrationRollbackHandoffOptions} options - Clock and failpoints.
 * @return {HandoffRecord} Reopened planned record.
 */
function publishInitialRecord(
    activityControlRoot: string,
    handoff: MigrationRollbackHandoffFacts,
    evidence: PhysicalEvidence,
    options: MigrationRollbackHandoffOptions,
    journalPath = path.join(operationDirectory(
        activityControlRoot,
        handoff.operationId,
    ), JOURNAL_DIRECTORY_NAME),
): HandoffRecord {
    const undigested = {
        schema: RECORD_SCHEMA as typeof RECORD_SCHEMA,
        limitsVersion: LIMITS_VERSION as typeof LIMITS_VERSION,
        handoff,
        sequence: '1',
        kind: 'planned' as const,
        phase: 'planned' as const,
        allowedActorAppBuildIds: allowedActors(handoff, 'planned'),
        previousRecordDigest: null,
        before: evidence,
        after: evidence,
        command: null,
        receiptDigest: null,
    };
    const record: HandoffRecord = Object.freeze({
        ...undigested,
        recordDigest: createHash('sha256')
            .update(canonicalJson(undigested), 'utf8')
            .digest('hex'),
    });
    requireRecordEvidence(record);
    const fileName = `000001-planned-${record.recordDigest}`;
    publishRecord(
        path.join(journalPath, fileName),
        Buffer.from(canonicalJson(record), 'utf8'),
        options,
        'handoff.planned',
    );
    return requireRecord(parseCanonicalRecord(readBoundedPlainFile(
        path.join(journalPath, fileName),
        RECORD_MAXIMUM_BYTES,
    )));
}

/**
 * Binds every surviving unpublished record byte to the exact retried operation facts.
 * @param {string} temporaryOperationPath - Deterministic unpublished operation directory.
 * @param {MigrationRollbackHandoffFacts} handoff - Exact caller-owned immutable facts.
 * @param {PhysicalEvidence} evidence - Fresh unchanged DATA evidence.
 * @return {void}
 */
function requireTemporaryOperationEvidence(
    temporaryOperationPath: string,
    handoff: MigrationRollbackHandoffFacts,
    evidence: PhysicalEvidence,
): void {
    const entries = listPlainDirectory(temporaryOperationPath);
    if (entries.length !== 1 || entries[0] !== JOURNAL_DIRECTORY_NAME
        || !plainChildDirectoryExists(temporaryOperationPath, JOURNAL_DIRECTORY_NAME)) {
        throw new Error('Migration rollback temporary operation closure changed');
    }
    const journalPath = path.join(temporaryOperationPath, JOURNAL_DIRECTORY_NAME);
    const recordNames = listPlainDirectory(journalPath);
    if (recordNames.length > TOTAL_RECORD_LIMIT
        || recordNames.filter(name => !TEMPORARY_PUBLICATION_NAME.test(name)).length > 1) {
        throw new Error('Migration rollback temporary journal closure changed');
    }
    for (const recordName of recordNames) {
        const record = requireRecord(parseCanonicalRecord(readBoundedPlainFile(
            path.join(journalPath, recordName),
            RECORD_MAXIMUM_BYTES,
        )));
        const finalName = `000001-planned-${record.recordDigest}`;
        if (record.kind !== 'planned'
            || record.sequence !== '1'
            || record.previousRecordDigest !== null
            || (!TEMPORARY_PUBLICATION_NAME.test(recordName) && recordName !== finalName)
            || !sameEvidence(record.handoff, handoff)
            || !sameEvidence(record.before, evidence)
            || !sameEvidence(record.after, evidence)) {
            throw new Error('Migration rollback temporary record identity changed');
        }
    }
}

/**
 * Returns all strict operation chains under the activity root.
 * @param {string} activityControlRoot - Stable activity control root.
 * @return {readonly (readonly HandoffRecord[])[]} Validated operation chains.
 */
function readOperations(
    activityControlRoot: string,
    ignoredTemporaryOperationName?: string,
): readonly (readonly HandoffRecord[])[] {
    if (!plainChildDirectoryExists(activityControlRoot, MIGRATION_ROLLBACK_DIRECTORY_NAME)) {
        return Object.freeze([]);
    }
    const root = path.join(activityControlRoot, MIGRATION_ROLLBACK_DIRECTORY_NAME);
    const entries = listPlainDirectory(root);
    if (ignoredTemporaryOperationName
        && entries.includes(ignoredTemporaryOperationName)
        && (!TEMPORARY_PUBLICATION_NAME.test(ignoredTemporaryOperationName)
            || !plainChildDirectoryExists(root, ignoredTemporaryOperationName))) {
        throw new Error('Migration rollback temporary operation identity is invalid');
    }
    const operationIds = entries.filter(name => name !== ignoredTemporaryOperationName);
    if (operationIds.length > TOTAL_RECORD_LIMIT) {
        throw new Error('Migration rollback operation limit exceeded');
    }
    return Object.freeze(operationIds.map(operationId => {
        if (!isCanonicalUuid(operationId) || !plainChildDirectoryExists(root, operationId)) {
            throw new Error('Migration rollback operation identity is invalid');
        }
        return readRecords(activityControlRoot, operationId);
    }));
}

/**
 * Finds one unique handoff by session identity.
 * @param {string} activityControlRoot - Stable activity control root.
 * @param {string} sessionId - Canonical session identity.
 * @return {readonly HandoffRecord[]} Unique operation chain.
 */
function findRecordsForSession(
    activityControlRoot: string,
    sessionId: string,
): readonly HandoffRecord[] {
    if (!isCanonicalUuid(sessionId)) {
        throw new TypeError('MigrationRollbackSessionId is invalid');
    }
    const matches = readOperations(activityControlRoot).filter(records => (
        records[0]!.handoff.migrationRollbackSessionId === sessionId
    ));
    if (matches.length !== 1) {
        throw new Error('Migration rollback handoff is not unique');
    }
    return matches[0]!;
}

/**
 * Derives the public phase from durable evidence.
 * @param {readonly HandoffRecord[]} records - Validated operation chain.
 * @param {PhysicalEvidence} observed - Fresh physical evidence.
 * @return {NonterminalPhase | TerminalPhase} Proven phase.
 */
function derivePhase(
    records: readonly HandoffRecord[],
    observed: PhysicalEvidence,
): NonterminalPhase | TerminalPhase {
    const handoff = records[0]!.handoff;
    const states = physicalStates(handoff);
    const kinds = new Set(records.map(record => record.kind));
    if (kinds.has('succeeded')) {
        return 'succeeded';
    }
    if (kinds.has('cancelled')) {
        return 'cancelled';
    }
    if (kinds.has('command-cancel')) {
        if (![
            states.planned,
            states.prepared,
            states.retired,
            states.installed,
            states.quarantinedRetired,
            states.cancelled,
        ].some(state => sameEvidence(observed, state))) {
            throw new Error('Migration rollback cancellation evidence changed');
        }
        return 'cancelling';
    }
    if (kinds.has('command-continue')) {
        if (![states.retired, states.installed].some(state => sameEvidence(observed, state))) {
            throw new Error('Migration rollback completion evidence changed');
        }
        return 'completing';
    }
    if (kinds.has('cancelling')
        || sameEvidence(observed, states.quarantinedRetired)
        || sameEvidence(observed, states.cancelled)) {
        return 'cancelling';
    }
    if (kinds.has('completing')) {
        if (!sameEvidence(observed, states.installed)) {
            throw new Error('Migration rollback completion evidence changed');
        }
        return 'completing';
    }
    if (kinds.has('observed-install-safety')
        || kinds.has('awaiting-target-build')
        || sameEvidence(observed, states.installed)) {
        return 'awaiting-target-build';
    }
    if (kinds.has('observed-retire-current')
        || kinds.has('armed')
        || kinds.has('intent-install-safety')
        || sameEvidence(observed, states.retired)) {
        return 'armed';
    }
    if (kinds.has('prepared')) {
        if (!sameEvidence(observed, states.prepared)) {
            throw new Error('Migration rollback prepared evidence changed');
        }
        return 'prepared';
    }
    if (!sameEvidence(observed, states.planned)) {
        throw new Error('Migration rollback planned evidence changed');
    }
    return 'planned';
}

/**
 * Returns the public version for one durable phase.
 * @param {NonterminalPhase | TerminalPhase} phase - Proven phase.
 * @return {string} Canonical SessionVersion.
 */
function versionForPhase(phase: NonterminalPhase | TerminalPhase): string {
    switch (phase) {
        case 'planned':
            return '1';
        case 'prepared':
            return '2';
        case 'armed':
            return '3';
        case 'awaiting-target-build':
            return '4';
        case 'completing':
        case 'cancelling':
            return '5';
        case 'succeeded':
        case 'cancelled':
            return '6';
    }
}

/**
 * Classifies the calling build against exact immutable identities.
 * @param {MigrationRollbackHandoffFacts} handoff - Immutable handoff facts.
 * @param {string} appBuildId - Calling build identity.
 * @return {BuildClassification} Exact source, target, or other classification.
 */
function classifyBuild(
    handoff: MigrationRollbackHandoffFacts,
    appBuildId: string,
): BuildClassification {
    if (appBuildId === handoff.currentAppBuildId) {
        return 'source';
    }
    if (appBuildId === handoff.targetAppBuildId) {
        return 'target';
    }
    return 'other';
}

/**
 * Builds one path-free status projection.
 * @param {readonly HandoffRecord[]} records - Validated operation chain.
 * @param {PhysicalEvidence} observed - Fresh physical evidence.
 * @param {string} appBuildId - Calling build identity.
 * @return {MigrationRollbackStatus} Path-free status.
 */
function statusFrom(
    records: readonly HandoffRecord[],
    observed: PhysicalEvidence,
    appBuildId: string,
): MigrationRollbackStatus {
    const handoff = records[0]!.handoff;
    const phase = derivePhase(records, observed);
    const currentBuild = classifyBuild(handoff, appBuildId);
    const terminal = phase === 'succeeded' || phase === 'cancelled';
    let allowedActions: readonly AllowedAction[] = [];
    if (!terminal) {
        if ((phase === 'planned' || phase === 'prepared') && currentBuild === 'source') {
            allowedActions = Object.freeze(['cancel-as-source'] as const);
        }
        else if ((phase === 'armed' || phase === 'awaiting-target-build')
            && currentBuild === 'source') {
            allowedActions = Object.freeze(['cancel-as-source'] as const);
        }
        else if ((phase === 'armed'
            || phase === 'awaiting-target-build'
            || phase === 'completing')
            && currentBuild === 'target') {
            allowedActions = Object.freeze(['continue-as-target'] as const);
        }
        else if (phase === 'cancelling' && currentBuild === 'source') {
            allowedActions = Object.freeze(['cancel-as-source'] as const);
        }
    }
    const durableCompletionCommand = terminal
        ? undefined
        : records.find(record => (
            record.kind === 'command-continue' || record.kind === 'command-cancel'
        ));
    const retryCommand = durableCompletionCommand?.command
        ? Object.freeze({
            action: durableCompletionCommand.command.action as
                'continue-as-target' | 'cancel-as-source',
            commandId: durableCompletionCommand.command.commandId,
            expectedSessionVersion: durableCompletionCommand.command.expectedSessionVersion,
        })
        : null;
    return Object.freeze({
        kind: terminal ? phase : 'maintenance',
        migrationRollbackSessionId: handoff.migrationRollbackSessionId,
        operationId: handoff.operationId,
        sessionVersion: versionForPhase(phase),
        phase,
        currentBuild,
        requiredBuilds: Object.freeze({
            sourceAppBuildId: handoff.currentAppBuildId,
            sourceReleaseVersion: handoff.currentReleaseVersion,
            targetAppBuildId: handoff.targetAppBuildId,
            targetReleaseVersion: handoff.targetReleaseVersion,
        }),
        allowedActions,
        retryCommand,
        outcome: terminal ? phase : null,
    });
}

/**
 * Reconciles only a missing observed record when the disk uniquely proves the action result.
 * @param {string} activityControlRoot - Stable activity control root.
 * @param {string} dataSlotsRoot - Trusted DataSlots parent.
 * @param {readonly HandoffRecord[]} records - Current validated chain.
 * @param {MigrationRollbackHandoffOptions} options - Publication options.
 * @return {readonly HandoffRecord[]} Possibly advanced chain.
 */
function observeLostResponse(
    activityControlRoot: string,
    dataSlotsRoot: string,
    records: readonly HandoffRecord[],
    options: MigrationRollbackHandoffOptions,
): readonly HandoffRecord[] {
    const latest = records.at(-1)!;
    const observedKind = latest.kind === 'intent-stage-safety'
        ? 'observed-stage-safety'
        : latest.kind === 'intent-retire-current'
        ? 'observed-retire-current'
        : latest.kind === 'intent-install-safety'
            ? 'observed-install-safety'
            : latest.kind === 'intent-quarantine-safety'
                ? 'observed-quarantine-safety'
                : latest.kind === 'intent-restore-current'
                    ? 'observed-restore-current'
                    : null;
    if (observedKind && latest.after && sameEvidence(
        observePhysical(dataSlotsRoot, latest.handoff.operationId),
        latest.after,
    )) {
        appendRecord(
            activityControlRoot,
            latest.handoff,
            observedKind,
            latest.before,
            latest.after,
            null,
            null,
            options,
        );
        return readRecords(activityControlRoot, latest.handoff.operationId);
    }
    return records;
}

/**
 * Rejects a new CommandId or opposite direction after a completion branch is durable.
 * @param {readonly HandoffRecord[]} records - Current validated chain.
 * @param {'command-continue' | 'command-cancel'} requestedKind - Requested branch.
 * @param {string} commandId - Requested command identity.
 * @return {void}
 */
function requireAvailableCommandBranch(
    records: readonly HandoffRecord[],
    requestedKind: 'command-continue' | 'command-cancel',
    commandId: string,
): void {
    const locked = records.find(record => (
        record.kind === 'command-continue' || record.kind === 'command-cancel'
    ));
    if (locked && (locked.kind !== requestedKind || locked.command?.commandId !== commandId)) {
        throw new MigrationRollbackHandoffError('command-conflict');
    }
}

/**
 * Validates a command and persists its canonical replay identity.
 * @param {string} activityControlRoot - Stable activity control root.
 * @param {readonly HandoffRecord[]} records - Validated operation chain.
 * @param {MigrationRollbackCommand} command - Exact caller command.
 * @param {RecordKind} kind - Closed command record kind.
 * @param {MigrationRollbackHandoffOptions} options - Publication options.
 * @return {readonly HandoffRecord[]} Revalidated chain including the command.
 */
function recordCommand(
    activityControlRoot: string,
    records: readonly HandoffRecord[],
    command: MigrationRollbackCommand,
    kind: 'command-confirm' | 'command-continue' | 'command-cancel',
    options: MigrationRollbackHandoffOptions,
): readonly HandoffRecord[] {
    const handoff = records[0]!.handoff;
    if (!hasExactKeys(command, [
        'action',
        'commandId',
        'migrationRollbackSessionId',
        'expectedSessionVersion',
        'currentAppBuildId',
    ])
        || !isCanonicalUuid(command.commandId)
        || command.migrationRollbackSessionId !== handoff.migrationRollbackSessionId
        || !isCanonicalUnsignedSqliteInteger(command.expectedSessionVersion)
        || !isBoundedIdentity(command.currentAppBuildId)
        || (kind === 'command-confirm' && command.action !== 'confirm')
        || (kind === 'command-continue' && command.action !== 'continue-as-target')
        || (kind === 'command-cancel' && command.action !== 'cancel-as-source')) {
        throw new MigrationRollbackHandoffError('command-conflict');
    }
    const commandDigest = createHash('sha256')
        .update(canonicalJson(command), 'utf8')
        .digest('hex');
    if (kind === 'command-continue' || kind === 'command-cancel') {
        requireAvailableCommandBranch(records, kind, command.commandId);
    }
    const prior = records.find(record => record.command?.commandId === command.commandId);
    if (prior) {
        if (prior.kind !== kind || prior.command?.commandDigest !== commandDigest) {
            throw new MigrationRollbackHandoffError('command-conflict');
        }
        return records;
    }
    const evidence = Object.freeze({
        action: command.action,
        commandId: command.commandId,
        commandDigest,
        currentAppBuildId: command.currentAppBuildId,
        expectedSessionVersion: command.expectedSessionVersion,
    });
    appendRecord(activityControlRoot, handoff, kind, null, null, evidence, null, options);
    return readRecords(activityControlRoot, handoff.operationId);
}

/**
 * Executes or observes one write-ahead physical rename.
 * @param {object} input - Complete action facts.
 * @return {readonly HandoffRecord[]} Revalidated chain with observed evidence.
 */
function executeRename(input: Readonly<{
    activityControlRoot: string;
    dataSlotsRoot: string;
    records: readonly HandoffRecord[];
    intentKind:
        | 'intent-retire-current'
        | 'intent-install-safety'
        | 'intent-quarantine-safety'
        | 'intent-restore-current';
    observedKind:
        | 'observed-retire-current'
        | 'observed-install-safety'
        | 'observed-quarantine-safety'
        | 'observed-restore-current';
    sourceName: string;
    targetName: string;
    fingerprint: string;
    before: PhysicalEvidence;
    after: PhysicalEvidence;
    failpointName: string;
    options: MigrationRollbackHandoffOptions;
}>): readonly HandoffRecord[] {
    const handoff = input.records[0]!.handoff;
    let records = input.records;
    if (records.some(record => record.kind === input.observedKind)) {
        return records;
    }
    if (!records.some(record => record.kind === input.intentKind)) {
        fail(input.options, `physical.before-${input.failpointName}-intent`);
        appendRecord(
            input.activityControlRoot,
            handoff,
            input.intentKind,
            input.before,
            input.after,
            null,
            null,
            input.options,
        );
        fail(input.options, `physical.after-${input.failpointName}-intent`);
        records = readRecords(input.activityControlRoot, handoff.operationId);
    }
    const observedBefore = observePhysical(input.dataSlotsRoot, handoff.operationId);
    if (sameEvidence(observedBefore, input.before)) {
        fail(input.options, `physical.before-${input.failpointName}-action`);
        renameRestoreDataSlot(
            input.dataSlotsRoot,
            input.sourceName,
            input.targetName,
            input.fingerprint,
        );
        fail(input.options, `physical.after-${input.failpointName}-action`);
    }
    const observedAfter = observePhysical(input.dataSlotsRoot, handoff.operationId);
    if (!sameEvidence(observedAfter, input.after)) {
        throw new Error('Migration rollback physical evidence is ambiguous');
    }
    fail(input.options, `physical.after-${input.failpointName}-observation`);
    appendRecord(
        input.activityControlRoot,
        handoff,
        input.observedKind,
        input.before,
        input.after,
        null,
        null,
        input.options,
    );
    fail(input.options, `physical.after-${input.failpointName}-observed`);
    return readRecords(input.activityControlRoot, handoff.operationId);
}

/**
 * Runs the three completion gates in their fixed order.
 * @param {MigrationRollbackCompletionCallbacks} callbacks - Injected owner callbacks.
 * @param {MigrationRollbackDataIdentity} expected - Expected active DATA identity.
 * @param {MigrationRollbackHandoffOptions} options - Completion failpoints.
 * @return {Promise<void>} Resolves only after FLOW-00 succeeds.
 */
async function runCompletionCallbacks(
    callbacks: MigrationRollbackBaseCompletionCallbacks,
    expected: MigrationRollbackDataIdentity,
    options: MigrationRollbackHandoffOptions,
): Promise<void> {
    fail(options, 'completion.before-reopen');
    await callbacks.reopen(expected);
    fail(options, 'completion.after-reopen');
    await callbacks.libraryReconcile();
    fail(options, 'completion.after-library-reconcile');
    await callbacks.flow00();
    fail(options, 'completion.after-flow00');
}

/**
 * Derives a path-free terminal receipt digest from the completed gates.
 * @param {MigrationRollbackHandoffFacts} handoff - Immutable operation facts.
 * @param {TerminalPhase} outcome - Completed direction.
 * @return {string} Canonical terminal receipt digest.
 */
function terminalReceiptDigest(
    handoff: MigrationRollbackHandoffFacts,
    outcome: TerminalPhase,
): string {
    return createHash('sha256').update(canonicalJson({
        schema: 'courseflow-migration-rollback-receipt-v1',
        migrationRollbackSessionId: handoff.migrationRollbackSessionId,
        operationId: handoff.operationId,
        outcome,
        workspaceId: handoff.safetyCopy.workspaceId,
        revision: outcome === 'succeeded'
            ? handoff.safetyCopy.revision
            : handoff.currentData.revision,
    }), 'utf8').digest('hex');
}

/**
 * Creates a planned, immutable MigrationRollbackHandoffV1 operation.
 * @param {string} activityControlRoot - Stable activity control root.
 * @param {string} dataSlotsRoot - Trusted DataSlots parent.
 * @param {MigrationRollbackHandoffFacts} facts - Caller-owned validated rollback facts.
 * @param {MigrationRollbackHandoffOptions} options - Clock, files, and failpoints.
 * @return {MigrationRollbackStatus} Path-free planned status.
 */
export function createMigrationRollbackHandoff(
    activityControlRoot: string,
    dataSlotsRoot: string,
    facts: MigrationRollbackHandoffFacts,
    options: MigrationRollbackHandoffOptions = {},
): MigrationRollbackStatus {
    try {
        const handoff = requireHandoffFacts(facts);
        requireRestoreSameVolume(activityControlRoot, dataSlotsRoot, options.files);
        const temporaryOperationName = `.tmp-${handoff.operationId}`;
        if (plainChildDirectoryExists(activityControlRoot, MIGRATION_ROLLBACK_DIRECTORY_NAME)) {
            const migrationRoot = path.join(activityControlRoot, MIGRATION_ROLLBACK_DIRECTORY_NAME);
            if (plainChildDirectoryExists(migrationRoot, handoff.operationId)) {
                const records = readRecords(activityControlRoot, handoff.operationId);
                if (!sameEvidence(records[0]!.handoff, handoff)) {
                    throw new Error('Migration rollback operation identity conflicts');
                }
                return statusFrom(
                    records,
                    observePhysical(dataSlotsRoot, handoff.operationId),
                    handoff.currentAppBuildId,
                );
            }
        }
        if (readOperations(activityControlRoot, temporaryOperationName).length
            >= TOTAL_RECORD_LIMIT) {
            throw new Error('Migration rollback operation limit exceeded');
        }
        const existing = inspectNonterminalMigrationRollbackIgnoringTemporary(
            activityControlRoot,
            dataSlotsRoot,
            temporaryOperationName,
        );
        if (existing.kind !== 'clear') {
            throw new Error('Another MigrationRollback handoff is nonterminal');
        }
        const restore = inspectRestoreBeforeWorkspaceOpen(activityControlRoot, dataSlotsRoot);
        if (restore.kind !== 'clear' && restore.kind !== 'committed') {
            throw new Error('Restore activation blocks MigrationRollback');
        }
        const observed = observePhysical(dataSlotsRoot, handoff.operationId);
        if (!sameEvidence(observed, physicalStates(handoff).planned)) {
            throw new Error('Migration rollback initial DATA evidence changed');
        }
        if (!plainChildDirectoryExists(activityControlRoot, MIGRATION_ROLLBACK_DIRECTORY_NAME)) {
            mkdirSync(path.join(activityControlRoot, MIGRATION_ROLLBACK_DIRECTORY_NAME));
        }
        const migrationRoot = path.join(activityControlRoot, MIGRATION_ROLLBACK_DIRECTORY_NAME);
        const temporaryOperationPath = ensureSnapshotStagingDirectory(
            migrationRoot,
            temporaryOperationName,
        );
        const temporaryJournalPath = ensureSnapshotStagingDirectory(
            temporaryOperationPath,
            JOURNAL_DIRECTORY_NAME,
        );
        requireTemporaryOperationEvidence(temporaryOperationPath, handoff, observed);
        publishInitialRecord(
            activityControlRoot,
            handoff,
            observed,
            options,
            temporaryJournalPath,
        );
        fail(options, 'handoff.operation.before-publish');
        publishSnapshotDirectory(
            temporaryOperationPath,
            operationDirectory(activityControlRoot, handoff.operationId),
        );
        fail(options, 'handoff.operation.after-publish');
        const records = readRecords(activityControlRoot, handoff.operationId);
        return statusFrom(records, observed, handoff.currentAppBuildId);
    }
    catch (error) {
        if (error instanceof MigrationRollbackHandoffError) {
            throw error;
        }
        throw new MigrationRollbackHandoffError('recovery-required', error);
    }
}

/**
 * Stages and freshly observes the caller-owned closed safety database.
 * @param {string} activityControlRoot - Stable activity control root.
 * @param {string} dataSlotsRoot - Trusted DataSlots parent.
 * @param {string} migrationRollbackSessionId - Canonical session identity.
 * @param {string} safetyDatabasePath - Caller-owned closed database path.
 * @param {MigrationRollbackHandoffOptions} options - Files and failpoints.
 * @return {MigrationRollbackStatus} Path-free prepared status.
 */
export function prepareMigrationRollbackHandoff(
    activityControlRoot: string,
    dataSlotsRoot: string,
    migrationRollbackSessionId: string,
    stageSafetyCopy: MigrationRollbackSafetyStagingPort,
    options: MigrationRollbackHandoffOptions = {},
): MigrationRollbackStatus {
    try {
        requireRestoreSameVolume(activityControlRoot, dataSlotsRoot, options.files);
        let records = findRecordsForSession(activityControlRoot, migrationRollbackSessionId);
        const handoff = records[0]!.handoff;
        const states = physicalStates(handoff);
        let observed = observePhysical(dataSlotsRoot, handoff.operationId);
        const hasPreparedRecord = records.some(record => record.kind === 'prepared');
        if (hasPreparedRecord) {
            const phase = derivePhase(records, observed);
            if (phase !== 'prepared') {
                throw new Error('Migration rollback prepared evidence is inconsistent');
            }
            return statusFrom(records, observed, handoff.currentAppBuildId);
        }
        if (!records.some(record => record.kind === 'planned')) {
            throw new Error('Migration rollback handoff is past preparation');
        }
        if (!records.some(record => record.kind === 'intent-stage-safety')) {
            appendRecord(
                activityControlRoot,
                handoff,
                'intent-stage-safety',
                states.planned,
                states.prepared,
                null,
                null,
                options,
            );
            records = readRecords(activityControlRoot, handoff.operationId);
        }
        if (sameEvidence(observed, states.planned)) {
            fail(options, 'physical.before-stage-safety');
            const staged = stageSafetyCopy(Object.freeze({
                migrationSafetyCopyId: handoff.safetyCopy.migrationSafetyCopyId,
                candidateSlotName: slotName('candidate', handoff.operationId),
            }));
            if (staged.slotFingerprint !== states.prepared.candidate.slotFingerprint) {
                throw new Error('Migration rollback staging port returned conflicting evidence');
            }
            fail(options, 'physical.after-stage-safety');
            observed = observePhysical(dataSlotsRoot, handoff.operationId);
        }
        if (!sameEvidence(observed, states.prepared)) {
            throw new Error('Migration rollback safety staging evidence changed');
        }
        const candidate = observeRestoreDataSlot(
            dataSlotsRoot,
            slotName('candidate', handoff.operationId),
        );
        if (candidate.kind !== 'present'
            || candidate.fingerprint.members.length !== 1
            || candidate.fingerprint.members[0]?.path !== 'workspace.sqlite'
            || candidate.fingerprint.members[0].byteLength !== handoff.safetyCopy.byteLength
            || candidate.fingerprint.members[0].sha256 !== handoff.safetyCopy.digest) {
            throw new Error('Migration rollback safety bytes changed');
        }
        fail(options, 'physical.after-stage-safety-observation');
        if (!records.some(record => record.kind === 'observed-stage-safety')) {
            appendRecord(
                activityControlRoot,
                handoff,
                'observed-stage-safety',
                states.planned,
                states.prepared,
                null,
                null,
                options,
            );
        }
        appendRecord(
            activityControlRoot,
            handoff,
            'prepared',
            states.prepared,
            states.prepared,
            null,
            null,
            options,
        );
        records = readRecords(activityControlRoot, handoff.operationId);
        return statusFrom(records, observed, handoff.currentAppBuildId);
    }
    catch (error) {
        if (error instanceof MigrationRollbackHandoffError) {
            throw error;
        }
        throw new MigrationRollbackHandoffError('activation-pending', error);
    }
}

/**
 * Reconciles the checkpoint and installs the safety slot for exact-build handoff.
 * @param {string} activityControlRoot - Stable activity control root.
 * @param {string} dataSlotsRoot - Trusted DataSlots parent.
 * @param {MigrationRollbackCommand} command - Version-bound confirm command.
 * @param {MigrationRollbackHandoffOptions} options - Files and failpoints.
 * @return {MigrationRollbackStatus} Path-free awaiting-target status.
 */
export function armMigrationRollbackHandoff(
    activityControlRoot: string,
    dataSlotsRoot: string,
    command: MigrationRollbackCommand,
    options: MigrationRollbackHandoffOptions = {},
): MigrationRollbackStatus {
    try {
        requireRestoreSameVolume(activityControlRoot, dataSlotsRoot, options.files);
        let records = findRecordsForSession(
            activityControlRoot,
            command.migrationRollbackSessionId,
        );
        const handoff = records[0]!.handoff;
        const states = physicalStates(handoff);
        records = observeLostResponse(activityControlRoot, dataSlotsRoot, records, options);
        let phase = derivePhase(records, observePhysical(dataSlotsRoot, handoff.operationId));
        const replay = records.find(record => record.command?.commandId === command.commandId);
        if (!replay
            && (phase !== 'prepared'
                || command.expectedSessionVersion !== '2'
                || command.currentAppBuildId !== handoff.currentAppBuildId)) {
            throw new MigrationRollbackHandoffError('build-mismatch');
        }
        records = recordCommand(
            activityControlRoot,
            records,
            command,
            'command-confirm',
            options,
        );
        phase = derivePhase(records, observePhysical(dataSlotsRoot, handoff.operationId));
        if (phase === 'awaiting-target-build') {
            return statusFrom(
                records,
                observePhysical(dataSlotsRoot, handoff.operationId),
                handoff.currentAppBuildId,
            );
        }
        records = executeRename({
            activityControlRoot,
            dataSlotsRoot,
            records,
            intentKind: 'intent-retire-current',
            observedKind: 'observed-retire-current',
            sourceName: ACTIVE_SLOT_NAME,
            targetName: slotName('rollback', handoff.operationId),
            fingerprint: handoff.currentData.slotFingerprint,
            before: states.prepared,
            after: states.retired,
            failpointName: 'retire-current',
            options,
        });
        if (!records.some(record => record.kind === 'armed')) {
            appendRecord(
                activityControlRoot,
                handoff,
                'armed',
                states.retired,
                states.retired,
                null,
                null,
                options,
            );
            fail(options, 'physical.after-armed');
            records = readRecords(activityControlRoot, handoff.operationId);
        }
        records = executeRename({
            activityControlRoot,
            dataSlotsRoot,
            records,
            intentKind: 'intent-install-safety',
            observedKind: 'observed-install-safety',
            sourceName: slotName('candidate', handoff.operationId),
            targetName: ACTIVE_SLOT_NAME,
            fingerprint: states.installed.active.slotFingerprint!,
            before: states.retired,
            after: states.installed,
            failpointName: 'install-safety',
            options,
        });
        if (!records.some(record => record.kind === 'awaiting-target-build')) {
            appendRecord(
                activityControlRoot,
                handoff,
                'awaiting-target-build',
                states.installed,
                states.installed,
                null,
                null,
                options,
            );
            records = readRecords(activityControlRoot, handoff.operationId);
        }
        return statusFrom(
            records,
            observePhysical(dataSlotsRoot, handoff.operationId),
            handoff.currentAppBuildId,
        );
    }
    catch (error) {
        if (error instanceof MigrationRollbackHandoffError) {
            throw error;
        }
        throw new MigrationRollbackHandoffError('activation-pending', error);
    }
}

/**
 * Continues as the exact target build and records success only after all completion gates.
 * @param {string} activityControlRoot - Stable activity control root.
 * @param {string} dataSlotsRoot - Trusted DataSlots parent.
 * @param {MigrationRollbackCommand} command - Exact target command.
 * @param {MigrationRollbackCompletionCallbacks} callbacks - Reopen/reconcile/FLOW-00 gates.
 * @param {MigrationRollbackHandoffOptions} options - Files and failpoints.
 * @return {Promise<MigrationRollbackStatus>} Path-free terminal or retryable status.
 */
export async function continueMigrationRollbackHandoff(
    activityControlRoot: string,
    dataSlotsRoot: string,
    command: MigrationRollbackCommand,
    callbacks: MigrationRollbackTargetCompletionCallbacks,
    options: MigrationRollbackHandoffOptions = {},
): Promise<MigrationRollbackStatus> {
    try {
        requireRestoreSameVolume(activityControlRoot, dataSlotsRoot, options.files);
        let records = findRecordsForSession(
            activityControlRoot,
            command.migrationRollbackSessionId,
        );
        const handoff = records[0]!.handoff;
        const states = physicalStates(handoff);
        records = observeLostResponse(activityControlRoot, dataSlotsRoot, records, options);
        let observed = observePhysical(dataSlotsRoot, handoff.operationId);
        let phase = derivePhase(records, observed);
        const replay = records.find(record => record.command?.commandId === command.commandId);
        requireAvailableCommandBranch(records, 'command-continue', command.commandId);
        if (!replay
            && ((phase !== 'armed' && phase !== 'awaiting-target-build')
                || command.expectedSessionVersion !== versionForPhase(phase)
                || command.currentAppBuildId !== handoff.targetAppBuildId)) {
            throw new MigrationRollbackHandoffError('build-mismatch');
        }
        records = recordCommand(
            activityControlRoot,
            records,
            command,
            'command-continue',
            options,
        );
        if (sameEvidence(observed, states.retired)) {
            records = executeRename({
                activityControlRoot,
                dataSlotsRoot,
                records,
                intentKind: 'intent-install-safety',
                observedKind: 'observed-install-safety',
                sourceName: slotName('candidate', handoff.operationId),
                targetName: ACTIVE_SLOT_NAME,
                fingerprint: states.installed.active.slotFingerprint!,
                before: states.retired,
                after: states.installed,
                failpointName: 'install-safety',
                options,
            });
            observed = observePhysical(dataSlotsRoot, handoff.operationId);
            phase = derivePhase(records, observed);
        }
        if (phase === 'succeeded') {
            return statusFrom(records, observed, command.currentAppBuildId);
        }
        if (phase !== 'awaiting-target-build' && phase !== 'completing') {
            throw new Error('Migration rollback target continuation is not safe');
        }
        if (!records.some(record => record.kind === 'completing')) {
            appendRecord(
                activityControlRoot,
                handoff,
                'completing',
                states.installed,
                states.installed,
                null,
                null,
                options,
            );
            records = readRecords(activityControlRoot, handoff.operationId);
        }
        await runCompletionCallbacks(callbacks, Object.freeze({
            workspaceId: handoff.safetyCopy.workspaceId,
            schemaLevel: handoff.safetyCopy.schemaLevel,
            revision: handoff.safetyCopy.revision,
        }), options);
        await callbacks.consumeSafetyCopy(Object.freeze({
            migrationSafetyCopyId: handoff.safetyCopy.migrationSafetyCopyId,
            operationId: handoff.operationId,
        }));
        fail(options, 'completion.after-consume-safety-copy');
        const receiptDigest = terminalReceiptDigest(handoff, 'succeeded');
        appendRecord(
            activityControlRoot,
            handoff,
            'succeeded',
            states.installed,
            states.installed,
            null,
            receiptDigest,
            options,
        );
        records = readRecords(activityControlRoot, handoff.operationId);
        return statusFrom(records, states.installed, command.currentAppBuildId);
    }
    catch (error) {
        if (error instanceof MigrationRollbackHandoffError) {
            throw error;
        }
        throw new MigrationRollbackHandoffError('completion-pending', error);
    }
}

/**
 * Cancels before checkpoint or restores retained migrated DATA as the exact source build.
 * @param {string} activityControlRoot - Stable activity control root.
 * @param {string} dataSlotsRoot - Trusted DataSlots parent.
 * @param {MigrationRollbackCommand} command - Exact source cancel command.
 * @param {MigrationRollbackCompletionCallbacks} callbacks - Reopen/reconcile/FLOW-00 gates.
 * @param {MigrationRollbackHandoffOptions} options - Files and failpoints.
 * @return {Promise<MigrationRollbackStatus>} Path-free cancelled status.
 */
export async function cancelMigrationRollbackHandoff(
    activityControlRoot: string,
    dataSlotsRoot: string,
    command: MigrationRollbackCommand,
    callbacks: MigrationRollbackBaseCompletionCallbacks,
    options: MigrationRollbackHandoffOptions = {},
): Promise<MigrationRollbackStatus> {
    try {
        requireRestoreSameVolume(activityControlRoot, dataSlotsRoot, options.files);
        let records = findRecordsForSession(
            activityControlRoot,
            command.migrationRollbackSessionId,
        );
        const handoff = records[0]!.handoff;
        const states = physicalStates(handoff);
        records = observeLostResponse(activityControlRoot, dataSlotsRoot, records, options);
        let observed = observePhysical(dataSlotsRoot, handoff.operationId);
        let phase = derivePhase(records, observed);
        const replay = records.find(record => record.command?.commandId === command.commandId);
        requireAvailableCommandBranch(records, 'command-cancel', command.commandId);
        if (!replay
            && ((phase === 'succeeded' || phase === 'cancelled')
                || command.expectedSessionVersion !== versionForPhase(phase)
                || command.currentAppBuildId !== handoff.currentAppBuildId)) {
            throw new MigrationRollbackHandoffError('build-mismatch');
        }
        records = recordCommand(
            activityControlRoot,
            records,
            command,
            'command-cancel',
            options,
        );
        if (phase === 'cancelled') {
            return statusFrom(records, observed, command.currentAppBuildId);
        }
        if (sameEvidence(observed, states.planned) || sameEvidence(observed, states.prepared)) {
            await runCompletionCallbacks(callbacks, Object.freeze({
                workspaceId: handoff.currentData.workspaceId,
                schemaLevel: handoff.currentData.schemaLevel,
                revision: handoff.currentData.revision,
            }), options);
            const receiptDigest = terminalReceiptDigest(handoff, 'cancelled');
            appendRecord(
                activityControlRoot,
                handoff,
                'cancelled',
                observed,
                observed,
                null,
                receiptDigest,
                options,
            );
            records = readRecords(activityControlRoot, handoff.operationId);
            return statusFrom(records, observed, command.currentAppBuildId);
        }
        if (phase !== 'armed'
            && phase !== 'awaiting-target-build'
            && phase !== 'cancelling') {
            throw new Error('Migration rollback source cancellation is not safe');
        }
        if (sameEvidence(observed, states.retired) || sameEvidence(observed, states.installed)) {
            const before = observed;
            const after = sameEvidence(observed, states.installed)
                ? states.quarantinedInstalled
                : states.quarantinedRetired;
            const sourceName = sameEvidence(observed, states.installed)
                ? ACTIVE_SLOT_NAME
                : slotName('candidate', handoff.operationId);
            records = executeRename({
                activityControlRoot,
                dataSlotsRoot,
                records,
                intentKind: 'intent-quarantine-safety',
                observedKind: 'observed-quarantine-safety',
                sourceName,
                targetName: slotName('quarantine', handoff.operationId),
                fingerprint: states.installed.active.slotFingerprint!,
                before,
                after,
                failpointName: 'quarantine-safety',
                options,
            });
            observed = observePhysical(dataSlotsRoot, handoff.operationId);
        }
        if (sameEvidence(observed, states.quarantinedRetired)) {
            records = executeRename({
                activityControlRoot,
                dataSlotsRoot,
                records,
                intentKind: 'intent-restore-current',
                observedKind: 'observed-restore-current',
                sourceName: slotName('rollback', handoff.operationId),
                targetName: ACTIVE_SLOT_NAME,
                fingerprint: handoff.currentData.slotFingerprint,
                before: states.quarantinedRetired,
                after: states.cancelled,
                failpointName: 'restore-current',
                options,
            });
            observed = observePhysical(dataSlotsRoot, handoff.operationId);
        }
        if (!sameEvidence(observed, states.cancelled)) {
            throw new Error('Migration rollback retained DATA evidence is ambiguous');
        }
        if (!records.some(record => record.kind === 'cancelling')) {
            appendRecord(
                activityControlRoot,
                handoff,
                'cancelling',
                states.cancelled,
                states.cancelled,
                null,
                null,
                options,
            );
            records = readRecords(activityControlRoot, handoff.operationId);
        }
        await runCompletionCallbacks(callbacks, Object.freeze({
            workspaceId: handoff.currentData.workspaceId,
            schemaLevel: handoff.currentData.schemaLevel,
            revision: handoff.currentData.revision,
        }), options);
        const receiptDigest = terminalReceiptDigest(handoff, 'cancelled');
        appendRecord(
            activityControlRoot,
            handoff,
            'cancelled',
            states.cancelled,
            states.cancelled,
            null,
            receiptDigest,
            options,
        );
        records = readRecords(activityControlRoot, handoff.operationId);
        return statusFrom(records, states.cancelled, command.currentAppBuildId);
    }
    catch (error) {
        if (error instanceof MigrationRollbackHandoffError) {
            throw error;
        }
        throw new MigrationRollbackHandoffError('completion-pending', error);
    }
}

/**
 * Inspects the MigrationRollback handoff before ordinary Workspace DATA open.
 * @param {string} activityControlRoot - Stable activity control root.
 * @param {string} dataSlotsRoot - Trusted DataSlots parent.
 * @param {string} currentAppBuildId - Calling build identity.
 * @return {MigrationRollbackBootState} Path-free exact-build boot state.
 */
export function inspectMigrationRollbackBeforeWorkspaceOpen(
    activityControlRoot: string,
    dataSlotsRoot: string,
    currentAppBuildId: string,
): MigrationRollbackBootState {
    try {
        if (!isBoundedIdentity(currentAppBuildId)) {
            throw new TypeError('AppBuildId is invalid');
        }
        requireRestoreSameVolume(activityControlRoot, dataSlotsRoot);
        const operations = readOperations(activityControlRoot);
        if (operations.length === 0) {
            return Object.freeze({
                kind: 'clear' as const,
                migrationRollbackSessionId: null,
                operationId: null,
                sessionVersion: null,
                phase: null,
                currentBuild: null,
                requiredBuilds: null,
                allowedActions: Object.freeze([] as const),
                retryCommand: null,
                outcome: null,
            });
        }
        const classified = operations.map(initialRecords => {
            const handoff = initialRecords[0]!.handoff;
            const terminal = initialRecords.at(-1)?.kind === 'succeeded'
                || initialRecords.at(-1)?.kind === 'cancelled';
            if (terminal) {
                return Object.freeze({
                    records: initialRecords,
                    observed: null,
                    phase: initialRecords.at(-1)!.kind as TerminalPhase,
                });
            }
            const records = observeLostResponse(
                activityControlRoot,
                dataSlotsRoot,
                initialRecords,
                {},
            );
            const observed = observePhysical(dataSlotsRoot, handoff.operationId);
            const phase = derivePhase(records, observed);
            return Object.freeze({records, observed, phase});
        });
        const nonterminal = classified.filter(operation => (
            operation.phase !== 'succeeded' && operation.phase !== 'cancelled'
        ));
        if (nonterminal.length > 1) {
            throw new Error('Multiple MigrationRollback handoffs are nonterminal');
        }
        const selected = nonterminal[0] ?? classified.at(-1)!;
        const observed = selected.observed ?? observePhysical(
            dataSlotsRoot,
            selected.records[0]!.handoff.operationId,
        );
        return statusFrom(selected.records, observed, currentAppBuildId);
    }
    catch {
        return Object.freeze({
            kind: 'recovery-required' as const,
            migrationRollbackSessionId: null,
            operationId: null,
            sessionVersion: null,
            phase: 'recovery-required' as const,
            currentBuild: null,
            requiredBuilds: null,
            allowedActions: Object.freeze([]),
            retryCommand: null,
            outcome: null,
        });
    }
}

/**
 * Reads the immutable path-free handoff facts for one exact session.
 * @param {string} activityControlRoot Stable activity control root.
 * @param {string} dataSlotsRoot Trusted DataSlots parent.
 * @param {string} migrationRollbackSessionId Exact session identity.
 * @return {MigrationRollbackHandoffFacts} Validated immutable handoff facts.
 */
export function inspectMigrationRollbackHandoffFacts(
    activityControlRoot: string,
    dataSlotsRoot: string,
    migrationRollbackSessionId: string,
): MigrationRollbackHandoffFacts {
    if (!isCanonicalUuid(migrationRollbackSessionId)) {
        throw new TypeError('MigrationRollback session identity is invalid');
    }
    requireRestoreSameVolume(activityControlRoot, dataSlotsRoot);
    const records = findRecordsForSession(activityControlRoot, migrationRollbackSessionId);
    return records[0]!.handoff;
}

/**
 * Exposes the narrow global-mutual-exclusion inspection for the PROTECT coordinator.
 * @param {string} activityControlRoot - Stable activity control root.
 * @param {string} dataSlotsRoot - Trusted DataSlots parent.
 * @return {NonterminalMigrationRollbackInspection} Path-free mutex evidence.
 */
function inspectNonterminalMigrationRollbackIgnoringTemporary(
    activityControlRoot: string,
    dataSlotsRoot: string,
    ignoredTemporaryOperationName?: string,
): NonterminalMigrationRollbackInspection {
    try {
        requireRestoreSameVolume(activityControlRoot, dataSlotsRoot);
        const operations = readOperations(activityControlRoot, ignoredTemporaryOperationName);
        const pending = operations.filter(records => {
            if (records.at(-1)?.kind === 'succeeded' || records.at(-1)?.kind === 'cancelled') {
                return false;
            }
            const phase = derivePhase(
                records,
                observePhysical(dataSlotsRoot, records[0]!.handoff.operationId),
            );
            return phase !== 'succeeded' && phase !== 'cancelled';
        });
        if (pending.length > 1) {
            throw new Error('Multiple MigrationRollback handoffs are nonterminal');
        }
        if (pending.length === 0) {
            return Object.freeze({
                kind: 'clear' as const,
                migrationRollbackSessionId: null,
                operationId: null,
            });
        }
        const handoff = pending[0]![0]!.handoff;
        return Object.freeze({
            kind: 'nonterminal' as const,
            migrationRollbackSessionId: handoff.migrationRollbackSessionId,
            operationId: handoff.operationId,
        });
    }
    catch {
        return Object.freeze({
            kind: 'recovery-required' as const,
            migrationRollbackSessionId: null,
            operationId: null,
        });
    }
}

/**
 * Exposes the narrow global-mutual-exclusion inspection for the PROTECT coordinator.
 * @param {string} activityControlRoot - Stable activity control root.
 * @param {string} dataSlotsRoot - Trusted DataSlots parent.
 * @return {NonterminalMigrationRollbackInspection} Path-free mutex evidence.
 */
export function inspectNonterminalMigrationRollback(
    activityControlRoot: string,
    dataSlotsRoot: string,
): NonterminalMigrationRollbackInspection {
    return inspectNonterminalMigrationRollbackIgnoringTemporary(
        activityControlRoot,
        dataSlotsRoot,
    );
}
