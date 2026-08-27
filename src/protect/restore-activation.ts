/**
 * @file Owns ADR-08 A-only Restore activation plans, journals, restart inspection, continuation, and rollback.
 */

import {createHash, randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import path from 'node:path';

import {
    CURRENT_SCHEMA_LEVEL,
} from '../data/schema';
import {
    inspectRestoreCompletionReceipt,
    inspectRestoreDataSlot,
    openWorkspaceData,
    type RestoreCompletionReceipt,
    type RestoreCompletionReceiptInput,
    type SqliteDataStore,
} from '../data/sqlite-data-store';
import {
    listPlainDirectory,
    plainChildDirectoryExists,
    plainFileExists,
    publishBackupMember,
    readBoundedPlainFile,
    syncPlainFile,
} from '../platform/backup-snapshot-files';
import {
    observeRestoreDataSlot,
    renameRestoreDataSlot,
    requireRestoreSameVolume,
    stageRestoreDataSlot,
    type RestoreActivationFileOptions,
    type RestoreDataSlotObservation,
} from '../platform/restore-activation-files';
import {canonicalJson} from '../shared/canonical-json';
import {
    isRestoreSessionView,
    type RestoreSessionActionCommand,
    type RestoreSessionView,
} from '../shared/workspace-protection-contract';
import {
    isCanonicalUnsignedSqliteInteger,
    isCanonicalUuid,
} from '../shared/workspace-data-contract';

const RESTORE_DIRECTORY_NAME = 'restore';
const SESSION_DIRECTORY_NAME = 'session';
const JOURNAL_DIRECTORY_NAME = 'journal';
const PLAN_FILE_NAME = 'activation-plan-v1';
const ACTIVE_SLOT_NAME = 'active';
const PLAN_MAXIMUM_BYTES = 262_144;
const RECORD_MAXIMUM_BYTES = 65_536;
const TOTAL_RECORD_LIMIT = 256;
const SESSION_SCHEMA = 'courseflow-restore-session-control-v1';
const PLAN_SCHEMA = 'courseflow-activation-plan-v1';
const JOURNAL_SCHEMA = 'courseflow-activation-journal-record-v1';
const LIMITS_VERSION = 'activation-journal-limits-v1';
const CANONICAL_ENCODING = 'courseflow-canonical-json-v1';
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const MAXIMUM_JSON_DEPTH = 16;
const MAXIMUM_JSON_STRING_LENGTH = 32_767;
const TEMPORARY_PUBLICATION_NAME = /^\.tmp-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const JOURNAL_KINDS = Object.freeze([
    'armed',
    'command-resume',
    'command-rollback',
    'intent-retire-old-data',
    'observed-retire-old-data',
    'intent-install-candidate-data',
    'observed-install-candidate-data',
    'candidate-installed',
    'reopened',
    'success-receipt',
    'committed',
    'intent-quarantine-candidate-data',
    'observed-quarantine-candidate-data',
    'intent-restore-old-data',
    'observed-restore-old-data',
    'rollback-reopened',
    'rollback-receipt',
    'rolled-back',
] as const);

type JournalKind = typeof JOURNAL_KINDS[number];

type SlotState =
    | Readonly<{kind: 'absent'}>
    | Readonly<{kind: 'present'; slotFingerprint: string}>;

type DatabaseEvidence = Readonly<{
    active: SlotState;
    candidate: SlotState;
    rollback: SlotState;
    quarantine: SlotState;
}>;

type ActivationPlanV1 = Readonly<{
    schema: typeof PLAN_SCHEMA;
    limitsVersion: typeof LIMITS_VERSION;
    operationId: string;
    restoreSessionId: string;
    sessionVersion: '2';
    preCheckpointSessionDigest: string;
    previousTerminal: RestoreTerminalEvidence | null;
    candidate: Readonly<{
        snapshotId: string;
        rootDigest: string;
        sourceSchemaLevel: string;
        postMigrationSchemaLevel: string;
        workspaceId: string;
        revision: string;
    }>;
    protection: Readonly<{
        kind: 'required';
        safetySetId: string;
        rootDigest: string;
    }>;
    database: Readonly<{
        old: Readonly<{
            kind: 'validated';
            workspaceId: string;
            revision: string;
            slotFingerprint: string;
        }>;
        candidate: Readonly<{
            kind: 'present';
            workspaceId: string;
            revision: string;
            slotFingerprint: string;
        }>;
        privateLocations: Readonly<{
            active: string;
            candidateSibling: string;
            rollbackSibling: string;
            quarantineSibling: string;
        }>;
    }>;
    library: Readonly<{kind: 'absent'}>;
    versions: Readonly<{
        canonicalEncoding: typeof CANONICAL_ENCODING;
        databaseFormat: 'sqlite-schema-16';
        markerFormat: 'not-applicable';
        pathKeyEncoding: 'not-applicable';
        operationFormats: 'a-only-v1';
        planVersion: '1';
        journalVersion: '1';
    }>;
    planDigest: string;
}>;

type SessionControlRecord = Readonly<{
    schema: typeof SESSION_SCHEMA;
    operationId: string;
    restoreSessionId: string;
    sequence: string;
    previousRecordDigest: string | null;
    session: RestoreSessionView;
    createdAt: string;
    recordDigest: string;
}>;

type ActivationJournalRecord = Readonly<{
    schema: typeof JOURNAL_SCHEMA;
    operationId: string;
    sequence: string;
    kind: JournalKind;
    previousRecordDigest: string | null;
    planDigest: string;
    expectedFingerprints: unknown;
    observedFingerprints: unknown;
    createdAt: string;
    recordDigest: string;
}>;

export type RestoreActivationFailpoint = (point: string) => void;

export type RestoreActivationOptions = Readonly<{
    clock?: Readonly<{now(): string}>;
    failpoint?: RestoreActivationFailpoint;
    files?: RestoreActivationFileOptions;
}>;

export type RestoreBootState = Readonly<{
    kind: 'clear' | 'pre-checkpoint-session' | 'recovery-required' | 'committed';
    session: RestoreSessionView | null;
    terminal: RestoreTerminalEvidence | null;
}>;

export type RestoreTerminalEvidence = Readonly<{
    operationId: string;
    outcome: 'succeeded' | 'rolled-back';
    terminalRecordDigest: string;
    receiptDigest: string;
}>;

export type RestoreActivationResult = Readonly<{
    session: RestoreSessionView;
    store: SqliteDataStore;
    terminal: RestoreTerminalEvidence;
}>;

export type BeginRestoreActivationInput = Readonly<{
    store: SqliteDataStore;
    activityControlRoot: string;
    dataSlotsRoot: string;
    preparedDatabasePath: string;
    session: RestoreSessionView;
    candidateRootDigest: string;
    candidateDatabaseDigest: string;
    safetyRootDigest: string;
    previousTerminal: RestoreTerminalEvidence | null;
    command: RestoreSessionActionCommand;
}>;

export class RestoreActivationError extends Error {
    public constructor(
        public readonly code:
            | 'staging-failed'
            | 'activation-pending'
            | 'rollback-required'
            | 'conflict',
        public readonly checkpointReached: boolean,
        cause?: unknown,
    ) {
        super(code, {cause});
        this.name = 'RestoreActivationError';
    }
}

/**
 * Returns the deterministic operation directory.
 * @param {string} activityControlRoot - Stable control root.
 * @param {string} operationId - Canonical operation identity.
 * @return {string} Private operation path.
 */
function operationDirectory(activityControlRoot: string, operationId: string): string {
    return path.join(activityControlRoot, RESTORE_DIRECTORY_NAME, operationId);
}

/**
 * Rejects unknown or non-plain entries at the operation control boundary.
 * @param {string} activityControlRoot - Stable control root.
 * @param {string} operationId - Canonical operation identity.
 * @return {void}
 */
function requireOperationControlClosure(
    activityControlRoot: string,
    operationId: string,
): void {
    const operationPath = operationDirectory(activityControlRoot, operationId);
    for (const entry of listPlainDirectory(operationPath)) {
        if ([
            SESSION_DIRECTORY_NAME,
            JOURNAL_DIRECTORY_NAME,
            'candidate-validation',
            'safety',
        ].includes(entry)) {
            plainChildDirectoryExists(operationPath, entry);
        }
        else if (entry === PLAN_FILE_NAME || TEMPORARY_PUBLICATION_NAME.test(entry)) {
            plainFileExists(path.join(operationPath, entry));
        }
        else {
            throw new Error('Restore operation control closure is invalid');
        }
    }
}

/**
 * Returns an operation-owned sibling name.
 * @param {'candidate' | 'rollback' | 'quarantine'} role - Physical sibling role.
 * @param {string} operationId - Canonical operation identity.
 * @return {string} Direct-child sibling name.
 */
function slotName(
    role: 'candidate' | 'rollback' | 'quarantine',
    operationId: string,
): string {
    return `.restore-${role}-${operationId}`;
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
 * Bounds parsed JSON depth and strings before semantic use.
 * @param {unknown} value - Parsed JSON value.
 * @param {number} depth - Current nesting depth.
 * @return {void}
 */
function requireJsonBounds(value: unknown, depth = 0): void {
    if (depth > MAXIMUM_JSON_DEPTH) {
        throw new Error('Restore control JSON exceeds its depth limit');
    }
    if (typeof value === 'string') {
        if (value.length > MAXIMUM_JSON_STRING_LENGTH) {
            throw new Error('Restore control JSON string exceeds its limit');
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
 * Strictly parses canonical UTF-8 JSON within an inclusive raw-byte limit.
 * @param {Buffer} bytes - Exact immutable file bytes.
 * @param {number} maximumBytes - Inclusive raw-byte limit.
 * @return {unknown} Parsed bounded value.
 */
function parseCanonicalJson(bytes: Buffer, maximumBytes: number): unknown {
    if (bytes.byteLength > maximumBytes
        || (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF)) {
        throw new Error('Restore control file exceeds its trust boundary');
    }
    const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    const value = JSON.parse(text) as unknown;
    requireJsonBounds(value);
    if (canonicalJson(value) !== text) {
        throw new Error('Restore control file is not canonical JSON');
    }
    return value;
}

/**
 * Computes a canonical digest with the named digest field omitted.
 * @param {Record<string, unknown>} value - Complete canonical object.
 * @param {string} digestField - Digest property to omit.
 * @return {string} Lowercase SHA-256 digest.
 */
function digestWithout(value: Record<string, unknown>, digestField: string): string {
    const copy = {...value};
    delete copy[digestField];
    return createHash('sha256').update(canonicalJson(copy), 'utf8').digest('hex');
}

/**
 * Requires a canonical positive integer string.
 * @param {unknown} value - Candidate sequence.
 * @return {value is string} Whether it is positive and canonical.
 */
function isPositiveInteger(value: unknown): value is string {
    return typeof value === 'string'
        && isCanonicalUnsignedSqliteInteger(value)
        && value !== '0';
}

/**
 * Returns a deterministic timestamp from the injected or system clock.
 * @param {RestoreActivationOptions} options - Activation options.
 * @return {string} Canonical instant.
 */
function now(options: RestoreActivationOptions): string {
    const value = options.clock?.now() ?? new Date().toISOString();
    if (new Date(value).toISOString() !== value) {
        throw new TypeError('Restore activation clock returned a noncanonical instant');
    }
    return value;
}

/**
 * Runs one named phase failpoint.
 * @param {RestoreActivationOptions} options - Activation options.
 * @param {string} point - Stable phase name.
 * @return {void}
 */
function fail(options: RestoreActivationOptions, point: string): void {
    options.failpoint?.(point);
}

/**
 * Publishes immutable canonical bytes through a unique same-parent temporary file and reopens them.
 * @param {string} finalPath - Absent immutable final path.
 * @param {Buffer} bytes - Exact canonical bytes.
 * @param {number} maximumBytes - Inclusive raw limit.
 * @param {RestoreActivationOptions} options - Phase failpoints.
 * @param {string} phase - Stable plan or journal phase prefix.
 * @return {void}
 */
function publishCanonicalFile(
    finalPath: string,
    bytes: Buffer,
    maximumBytes: number,
    options: RestoreActivationOptions,
    phase: string,
): void {
    if (bytes.byteLength > maximumBytes) {
        throw new Error('Restore control file exceeds its raw-byte limit');
    }
    if (plainFileExists(finalPath)) {
        if (!readBoundedPlainFile(finalPath, maximumBytes).equals(bytes)) {
            throw new Error('Restore control file conflicts with existing evidence');
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
    if (!readBoundedPlainFile(finalPath, maximumBytes).equals(bytes)) {
        throw new Error('Restore control publication could not be reverified');
    }
    fail(options, `${phase}.after-reopen`);
}

/**
 * Validates one session-control record and its exact digest.
 * @param {unknown} value - Parsed record.
 * @return {SessionControlRecord} Validated record.
 */
function requireSessionRecord(value: unknown): SessionControlRecord {
    if (!hasExactKeys(value, [
        'schema',
        'operationId',
        'restoreSessionId',
        'sequence',
        'previousRecordDigest',
        'session',
        'createdAt',
        'recordDigest',
    ])
        || value.schema !== SESSION_SCHEMA
        || !isCanonicalUuid(value.operationId)
        || !isCanonicalUuid(value.restoreSessionId)
        || !isPositiveInteger(value.sequence)
        || !(value.previousRecordDigest === null
            || (typeof value.previousRecordDigest === 'string'
                && DIGEST_PATTERN.test(value.previousRecordDigest)))
        || !isRestoreSessionView(value.session)
        || value.session.operationId !== value.operationId
        || value.session.restoreSessionId !== value.restoreSessionId
        || typeof value.createdAt !== 'string'
        || new Date(value.createdAt).toISOString() !== value.createdAt
        || typeof value.recordDigest !== 'string'
        || !DIGEST_PATTERN.test(value.recordDigest)
        || digestWithout(value, 'recordDigest') !== value.recordDigest) {
        throw new Error('Restore session control record is invalid');
    }
    return value as SessionControlRecord;
}

/**
 * Reads and validates one complete hash chain in filename sequence order.
 * @param {string} directoryPath - Existing session-control directory.
 * @return {readonly SessionControlRecord[]} Validated chain.
 */
function readSessionRecords(directoryPath: string): readonly SessionControlRecord[] {
    const entries = listPlainDirectory(directoryPath);
    if (entries.length > TOTAL_RECORD_LIMIT) {
        throw new Error('Restore session control record limit exceeded');
    }
    entries.filter(name => TEMPORARY_PUBLICATION_NAME.test(name)).forEach(name => {
        plainFileExists(path.join(directoryPath, name));
    });
    const names = entries.filter(name => !TEMPORARY_PUBLICATION_NAME.test(name));
    const records = names.map(name => {
        const record = requireSessionRecord(parseCanonicalJson(
            readBoundedPlainFile(path.join(directoryPath, name), RECORD_MAXIMUM_BYTES),
            RECORD_MAXIMUM_BYTES,
        ));
        const expectedName = `${record.sequence.padStart(6, '0')}-session-${record.recordDigest}`;
        if (name !== expectedName) {
            throw new Error('Restore session control filename is invalid');
        }
        return record;
    });
    records.forEach((record, index) => {
        if (record.sequence !== (index + 1).toString()
            || record.previousRecordDigest !== (records[index - 1]?.recordDigest ?? null)) {
            throw new Error('Restore session control hash chain is invalid');
        }
    });
    return Object.freeze(records);
}

/**
 * Appends and revalidates one bounded pre-checkpoint session mirror record.
 * @param {string} activityControlRoot - Stable control root.
 * @param {RestoreSessionView} session - Path-free semantic session state.
 * @param {RestoreActivationOptions} options - Clock and failpoints.
 * @return {SessionControlRecord} Freshly revalidated record.
 */
export function recordRestoreSessionControl(
    activityControlRoot: string,
    session: RestoreSessionView,
    options: RestoreActivationOptions = {},
): SessionControlRecord {
    if (!isRestoreSessionView(session)) {
        throw new TypeError('Restore session control view is invalid');
    }
    const directoryPath = path.join(
        operationDirectory(activityControlRoot, session.operationId),
        SESSION_DIRECTORY_NAME,
    );
    if (!plainChildDirectoryExists(
        operationDirectory(activityControlRoot, session.operationId),
        SESSION_DIRECTORY_NAME,
    )) {
        throw new Error('Restore session control directory is missing');
    }
    const records = readSessionRecords(directoryPath);
    const prior = records.at(-1);
    if (prior && JSON.stringify(prior.session) === JSON.stringify(session)) {
        return prior;
    }
    if (records.length >= TOTAL_RECORD_LIMIT) {
        throw new Error('Restore session control record limit exceeded');
    }
    const undigested = {
        schema: SESSION_SCHEMA as typeof SESSION_SCHEMA,
        operationId: session.operationId,
        restoreSessionId: session.restoreSessionId,
        sequence: (records.length + 1).toString(),
        previousRecordDigest: prior?.recordDigest ?? null,
        session,
        createdAt: now(options),
    };
    const record: SessionControlRecord = Object.freeze({
        ...undigested,
        recordDigest: createHash('sha256')
            .update(canonicalJson(undigested), 'utf8')
            .digest('hex'),
    });
    const fileName = `${record.sequence.padStart(6, '0')}-session-${record.recordDigest}`;
    publishCanonicalFile(
        path.join(directoryPath, fileName),
        Buffer.from(canonicalJson(record), 'utf8'),
        RECORD_MAXIMUM_BYTES,
        options,
        'session-record',
    );
    return readSessionRecords(directoryPath).at(-1)!;
}

/**
 * Reads the last validated pre-checkpoint session record for one operation.
 * @param {string} activityControlRoot - Stable control root.
 * @param {string} operationId - Canonical operation identity.
 * @return {SessionControlRecord | null} Latest record or null.
 */
function latestSessionRecord(
    activityControlRoot: string,
    operationId: string,
): SessionControlRecord | null {
    const directoryPath = path.join(
        operationDirectory(activityControlRoot, operationId),
        SESSION_DIRECTORY_NAME,
    );
    if (!plainChildDirectoryExists(
        operationDirectory(activityControlRoot, operationId),
        SESSION_DIRECTORY_NAME,
    )) {
        return null;
    }
    return readSessionRecords(directoryPath).at(-1) ?? null;
}

/**
 * Converts a PLATFORM slot observation to bounded journal evidence.
 * @param {RestoreDataSlotObservation} observation - Fresh physical observation.
 * @return {SlotState} Path-free fingerprint state.
 */
function slotState(observation: RestoreDataSlotObservation): SlotState {
    return observation.kind === 'absent'
        ? Object.freeze({kind: 'absent' as const})
        : Object.freeze({
            kind: 'present' as const,
            slotFingerprint: observation.fingerprint.slotFingerprint,
        });
}

/**
 * Freshly observes every plan-owned DATA location.
 * @param {string} dataSlotsRoot - Trusted DataSlots parent.
 * @param {string} operationId - Canonical operation identity.
 * @return {DatabaseEvidence} Path-free physical evidence.
 */
function observeDatabaseEvidence(
    dataSlotsRoot: string,
    operationId: string,
): DatabaseEvidence {
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
 * Compares bounded evidence canonically.
 * @param {unknown} left - First evidence value.
 * @param {unknown} right - Second evidence value.
 * @return {boolean} Whether both values encode identically.
 */
function sameEvidence(left: unknown, right: unknown): boolean {
    return canonicalJson(left) === canonicalJson(right);
}

/**
 * Tests one bounded predecessor terminal reference.
 * @param {unknown} value - Candidate terminal evidence.
 * @param {string} operationId - Current operation that must not reference itself.
 * @return {value is RestoreTerminalEvidence} Whether the predecessor evidence is exact.
 */
function isRestoreTerminalEvidence(
    value: unknown,
    operationId: string,
): value is RestoreTerminalEvidence {
    return hasExactKeys(value, [
        'operationId',
        'outcome',
        'terminalRecordDigest',
        'receiptDigest',
    ])
        && isCanonicalUuid(value.operationId)
        && value.operationId !== operationId
        && (value.outcome === 'succeeded' || value.outcome === 'rolled-back')
        && typeof value.terminalRecordDigest === 'string'
        && DIGEST_PATTERN.test(value.terminalRecordDigest)
        && typeof value.receiptDigest === 'string'
        && DIGEST_PATTERN.test(value.receiptDigest);
}

/**
 * Validates one immutable ActivationPlanV1 including private location binding.
 * @param {unknown} value - Parsed plan.
 * @param {string} activityControlRoot - Stable control root.
 * @param {string} dataSlotsRoot - Trusted DataSlots parent.
 * @param {string} operationId - Expected operation identity.
 * @return {ActivationPlanV1} Strict validated plan.
 */
function requirePlan(
    value: unknown,
    activityControlRoot: string,
    dataSlotsRoot: string,
    operationId: string,
): ActivationPlanV1 {
    const expectedLocations = {
        active: path.join(dataSlotsRoot, ACTIVE_SLOT_NAME),
        candidateSibling: path.join(dataSlotsRoot, slotName('candidate', operationId)),
        rollbackSibling: path.join(dataSlotsRoot, slotName('rollback', operationId)),
        quarantineSibling: path.join(dataSlotsRoot, slotName('quarantine', operationId)),
    };
    if (!hasExactKeys(value, [
        'schema',
        'limitsVersion',
        'operationId',
        'restoreSessionId',
        'sessionVersion',
        'preCheckpointSessionDigest',
        'previousTerminal',
        'candidate',
        'protection',
        'database',
        'library',
        'versions',
        'planDigest',
    ])
        || value.schema !== PLAN_SCHEMA
        || value.limitsVersion !== LIMITS_VERSION
        || value.operationId !== operationId
        || !isCanonicalUuid(value.restoreSessionId)
        || value.sessionVersion !== '2'
        || typeof value.preCheckpointSessionDigest !== 'string'
        || !DIGEST_PATTERN.test(value.preCheckpointSessionDigest)
        || !(value.previousTerminal === null
            || isRestoreTerminalEvidence(value.previousTerminal, operationId))
        || !hasExactKeys(value.candidate, [
            'snapshotId',
            'rootDigest',
            'sourceSchemaLevel',
            'postMigrationSchemaLevel',
            'workspaceId',
            'revision',
        ])
        || !isCanonicalUuid(value.candidate.snapshotId)
        || typeof value.candidate.rootDigest !== 'string'
        || !DIGEST_PATTERN.test(value.candidate.rootDigest)
        || !isCanonicalUnsignedSqliteInteger(value.candidate.sourceSchemaLevel)
        || value.candidate.postMigrationSchemaLevel !== CURRENT_SCHEMA_LEVEL.toString()
        || !isCanonicalUuid(value.candidate.workspaceId)
        || !isCanonicalUnsignedSqliteInteger(value.candidate.revision)
        || !hasExactKeys(value.protection, ['kind', 'safetySetId', 'rootDigest'])
        || value.protection.kind !== 'required'
        || !isCanonicalUuid(value.protection.safetySetId)
        || typeof value.protection.rootDigest !== 'string'
        || !DIGEST_PATTERN.test(value.protection.rootDigest)
        || !hasExactKeys(value.database, ['old', 'candidate', 'privateLocations'])
        || !hasExactKeys(value.database.old, ['kind', 'workspaceId', 'revision', 'slotFingerprint'])
        || value.database.old.kind !== 'validated'
        || !isCanonicalUuid(value.database.old.workspaceId)
        || !isCanonicalUnsignedSqliteInteger(value.database.old.revision)
        || typeof value.database.old.slotFingerprint !== 'string'
        || !DIGEST_PATTERN.test(value.database.old.slotFingerprint)
        || !hasExactKeys(value.database.candidate, [
            'kind',
            'workspaceId',
            'revision',
            'slotFingerprint',
        ])
        || value.database.candidate.kind !== 'present'
        || !isCanonicalUuid(value.database.candidate.workspaceId)
        || !isCanonicalUnsignedSqliteInteger(value.database.candidate.revision)
        || typeof value.database.candidate.slotFingerprint !== 'string'
        || !DIGEST_PATTERN.test(value.database.candidate.slotFingerprint)
        || !hasExactKeys(value.database.privateLocations, [
            'active',
            'candidateSibling',
            'rollbackSibling',
            'quarantineSibling',
        ])
        || !sameEvidence(value.database.privateLocations, expectedLocations)
        || !hasExactKeys(value.library, ['kind'])
        || value.library.kind !== 'absent'
        || !hasExactKeys(value.versions, [
            'canonicalEncoding',
            'databaseFormat',
            'markerFormat',
            'pathKeyEncoding',
            'operationFormats',
            'planVersion',
            'journalVersion',
        ])
        || value.versions.canonicalEncoding !== CANONICAL_ENCODING
        || value.versions.databaseFormat !== 'sqlite-schema-16'
        || value.versions.markerFormat !== 'not-applicable'
        || value.versions.pathKeyEncoding !== 'not-applicable'
        || value.versions.operationFormats !== 'a-only-v1'
        || value.versions.planVersion !== '1'
        || value.versions.journalVersion !== '1'
        || typeof value.planDigest !== 'string'
        || !DIGEST_PATTERN.test(value.planDigest)
        || digestWithout(value, 'planDigest') !== value.planDigest) {
        throw new Error('Restore activation plan is invalid');
    }
    const sessionRecords = readSessionRecords(path.join(
        operationDirectory(activityControlRoot, operationId),
        SESSION_DIRECTORY_NAME,
    ));
    const session = sessionRecords.find(record => (
        record.recordDigest === value.preCheckpointSessionDigest
    ));
    if (!session || session.restoreSessionId !== value.restoreSessionId) {
        throw new Error('Restore activation plan session binding is invalid');
    }
    return value as ActivationPlanV1;
}

/**
 * Reads and validates one immutable activation plan.
 * @param {string} activityControlRoot - Stable control root.
 * @param {string} dataSlotsRoot - Trusted DataSlots parent.
 * @param {string} operationId - Canonical operation identity.
 * @return {ActivationPlanV1} Validated plan.
 */
function readPlan(
    activityControlRoot: string,
    dataSlotsRoot: string,
    operationId: string,
): ActivationPlanV1 {
    requireOperationControlClosure(activityControlRoot, operationId);
    const planPath = path.join(operationDirectory(activityControlRoot, operationId), PLAN_FILE_NAME);
    return requirePlan(
        parseCanonicalJson(
            readBoundedPlainFile(planPath, PLAN_MAXIMUM_BYTES),
            PLAN_MAXIMUM_BYTES,
        ),
        activityControlRoot,
        dataSlotsRoot,
        operationId,
    );
}

/**
 * Validates one activation journal record.
 * @param {unknown} value - Parsed record.
 * @param {ActivationPlanV1} plan - Bound immutable plan.
 * @return {ActivationJournalRecord} Strict outer record.
 */
function requireJournalRecord(
    value: unknown,
    plan: ActivationPlanV1,
): ActivationJournalRecord {
    if (!hasExactKeys(value, [
        'schema',
        'operationId',
        'sequence',
        'kind',
        'previousRecordDigest',
        'planDigest',
        'expectedFingerprints',
        'observedFingerprints',
        'createdAt',
        'recordDigest',
    ])
        || value.schema !== JOURNAL_SCHEMA
        || value.operationId !== plan.operationId
        || !isPositiveInteger(value.sequence)
        || typeof value.kind !== 'string'
        || !JOURNAL_KINDS.includes(value.kind as JournalKind)
        || !(value.previousRecordDigest === null
            || (typeof value.previousRecordDigest === 'string'
                && DIGEST_PATTERN.test(value.previousRecordDigest)))
        || value.planDigest !== plan.planDigest
        || typeof value.createdAt !== 'string'
        || new Date(value.createdAt).toISOString() !== value.createdAt
        || typeof value.recordDigest !== 'string'
        || !DIGEST_PATTERN.test(value.recordDigest)
        || digestWithout(value, 'recordDigest') !== value.recordDigest) {
        throw new Error('Restore activation journal record is invalid');
    }
    const record = value as ActivationJournalRecord;
    requireJournalEvidence(record, plan);
    return record;
}

/**
 * Rejects known journal kinds that do not form one legal forward or rollback prefix.
 * @param {readonly ActivationJournalRecord[]} records - Validated hash-chain records.
 * @return {void}
 */
function requireJournalTransitions(records: readonly ActivationJournalRecord[]): void {
    const forward: readonly JournalKind[] = [
        'armed',
        'intent-retire-old-data',
        'observed-retire-old-data',
        'intent-install-candidate-data',
        'observed-install-candidate-data',
        'candidate-installed',
        'reopened',
        'success-receipt',
        'committed',
    ];
    let forwardIndex = 0;
    let rollbackState:
        | 'observed-quarantine'
        | 'after-quarantine'
        | 'observed-restore'
        | 'rollback-reopened'
        | 'rollback-receipt'
        | 'rolled-back'
        | 'complete'
        | null = null;
    const commandIds = new Set<string>();
    for (const record of records) {
        if (record.kind === 'command-resume' || record.kind === 'command-rollback') {
            if (forwardIndex === 0
                || forwardIndex >= 8
                || rollbackState === 'rolled-back'
                || rollbackState === 'complete'
                || !hasExactKeys(record.expectedFingerprints, ['commandId', 'commandDigest'])
                || typeof record.expectedFingerprints.commandId !== 'string'
                || !isCanonicalUuid(record.expectedFingerprints.commandId)
                || typeof record.expectedFingerprints.commandDigest !== 'string'
                || !DIGEST_PATTERN.test(record.expectedFingerprints.commandDigest)
                || !sameEvidence(record.expectedFingerprints, record.observedFingerprints)
                || commandIds.has(record.expectedFingerprints.commandId)) {
                throw new Error('Restore activation command record is out of state');
            }
            commandIds.add(record.expectedFingerprints.commandId);
            continue;
        }
        if (rollbackState === null) {
            if (record.kind === forward[forwardIndex]) {
                forwardIndex += 1;
                continue;
            }
            if (record.kind === 'intent-quarantine-candidate-data'
                && forwardIndex >= 1
                && forwardIndex <= 7) {
                rollbackState = 'observed-quarantine';
                continue;
            }
            throw new Error('Restore forward journal transition is invalid');
        }
        if (rollbackState === 'observed-quarantine'
            && record.kind === 'observed-quarantine-candidate-data') {
            rollbackState = 'after-quarantine';
        }
        else if (rollbackState === 'after-quarantine'
            && record.kind === 'intent-restore-old-data') {
            rollbackState = 'observed-restore';
        }
        else if (rollbackState === 'after-quarantine'
            && record.kind === 'rollback-reopened') {
            rollbackState = 'rollback-receipt';
        }
        else if (rollbackState === 'observed-restore'
            && record.kind === 'observed-restore-old-data') {
            rollbackState = 'rollback-reopened';
        }
        else if (rollbackState === 'rollback-reopened'
            && record.kind === 'rollback-reopened') {
            rollbackState = 'rollback-receipt';
        }
        else if (rollbackState === 'rollback-receipt'
            && record.kind === 'rollback-receipt') {
            rollbackState = 'rolled-back';
        }
        else if (rollbackState === 'rolled-back' && record.kind === 'rolled-back') {
            rollbackState = 'complete';
        }
        else {
            throw new Error('Restore rollback journal transition is invalid');
        }
    }
}

/**
 * Reads and validates the complete activation hash chain.
 * @param {string} activityControlRoot - Stable control root.
 * @param {ActivationPlanV1} plan - Bound immutable plan.
 * @return {readonly ActivationJournalRecord[]} Validated record chain.
 */
function readJournal(
    activityControlRoot: string,
    plan: ActivationPlanV1,
): readonly ActivationJournalRecord[] {
    const operationPath = operationDirectory(activityControlRoot, plan.operationId);
    const directoryPath = path.join(operationPath, JOURNAL_DIRECTORY_NAME);
    if (!plainChildDirectoryExists(operationPath, JOURNAL_DIRECTORY_NAME)) {
        throw new Error('Restore activation journal directory is missing');
    }
    const sessionCount = readSessionRecords(path.join(operationPath, SESSION_DIRECTORY_NAME)).length;
    const entries = listPlainDirectory(directoryPath);
    if (sessionCount + entries.length > TOTAL_RECORD_LIMIT) {
        throw new Error('Restore activation record limit exceeded');
    }
    entries.filter(name => TEMPORARY_PUBLICATION_NAME.test(name)).forEach(name => {
        plainFileExists(path.join(directoryPath, name));
    });
    const names = entries.filter(name => !TEMPORARY_PUBLICATION_NAME.test(name));
    const records = names.map(name => {
        const record = requireJournalRecord(parseCanonicalJson(
            readBoundedPlainFile(path.join(directoryPath, name), RECORD_MAXIMUM_BYTES),
            RECORD_MAXIMUM_BYTES,
        ), plan);
        const expectedName = `${record.sequence.padStart(6, '0')}-${record.kind}-${record.recordDigest}`;
        if (name !== expectedName) {
            throw new Error('Restore activation journal filename is invalid');
        }
        return record;
    });
    records.forEach((record, index) => {
        if (record.sequence !== (index + 1).toString()
            || record.previousRecordDigest !== (records[index - 1]?.recordDigest ?? null)) {
            throw new Error('Restore activation journal hash chain is invalid');
        }
    });
    requireJournalTransitions(records);
    return Object.freeze(records);
}

/**
 * Appends one canonical journal record and revalidates the entire chain.
 * @param {string} activityControlRoot - Stable control root.
 * @param {ActivationPlanV1} plan - Bound immutable plan.
 * @param {JournalKind} kind - Closed record kind.
 * @param {unknown} expectedFingerprints - Bounded expected evidence.
 * @param {unknown} observedFingerprints - Bounded observed evidence or null.
 * @param {RestoreActivationOptions} options - Clock and phase failpoints.
 * @return {ActivationJournalRecord} Freshly revalidated appended record.
 */
function appendJournal(
    activityControlRoot: string,
    plan: ActivationPlanV1,
    kind: JournalKind,
    expectedFingerprints: unknown,
    observedFingerprints: unknown,
    options: RestoreActivationOptions,
): ActivationJournalRecord {
    const records = readJournal(activityControlRoot, plan);
    const prior = records.at(-1);
    const undigested = {
        schema: JOURNAL_SCHEMA as typeof JOURNAL_SCHEMA,
        operationId: plan.operationId,
        sequence: (records.length + 1).toString(),
        kind,
        previousRecordDigest: prior?.recordDigest ?? null,
        planDigest: plan.planDigest,
        expectedFingerprints,
        observedFingerprints,
        createdAt: now(options),
    };
    requireJsonBounds(undigested);
    const record: ActivationJournalRecord = Object.freeze({
        ...undigested,
        recordDigest: createHash('sha256')
            .update(canonicalJson(undigested), 'utf8')
            .digest('hex'),
    });
    const fileName = `${record.sequence.padStart(6, '0')}-${kind}-${record.recordDigest}`;
    publishCanonicalFile(
        path.join(
            operationDirectory(activityControlRoot, plan.operationId),
            JOURNAL_DIRECTORY_NAME,
            fileName,
        ),
        Buffer.from(canonicalJson(record), 'utf8'),
        RECORD_MAXIMUM_BYTES,
        options,
        `journal.${kind}`,
    );
    return readJournal(activityControlRoot, plan).at(-1)!;
}

/**
 * Builds a recovery or terminal public session from frozen pre-checkpoint evidence.
 * @param {RestoreSessionView} base - Last pre-checkpoint public view.
 * @param {'recovery-required' | 'succeeded' | 'rolled-back'} phase - Public phase.
 * @param {readonly ('resume' | 'rollback')[]} actions - Evidence-supported actions.
 * @param {'activation-pending' | 'rollback-required' | 'recovery-required' | null} problem - Public code.
 * @return {RestoreSessionView} Exact path-free session view.
 */
function activationView(
    base: RestoreSessionView,
    phase: 'recovery-required' | 'succeeded' | 'rolled-back',
    actions: readonly ('resume' | 'rollback')[],
    problem: 'activation-pending' | 'rollback-required' | 'recovery-required' | null,
): RestoreSessionView {
    const view: RestoreSessionView = Object.freeze({
        ...base,
        sessionVersion: phase === 'recovery-required' ? '2' : '3',
        phase,
        previewToken: null,
        allowedActions: Object.freeze(Array.from(actions)),
        problem: problem === null ? null : Object.freeze({code: problem}),
    });
    if (!isRestoreSessionView(view)) {
        throw new Error('Restore activation view is invalid');
    }
    return view;
}

/**
 * Requires one session-bound action command at the expected logical version.
 * @param {RestoreSessionActionCommand} command - Path-free action command.
 * @param {RestoreSessionView} session - Frozen session identity.
 * @param {string} expectedVersion - Required logical version.
 * @return {void}
 */
function requireActionCommand(
    command: RestoreSessionActionCommand,
    session: RestoreSessionView,
    expectedVersion: string,
): void {
    if (!hasExactKeys(command, ['commandId', 'restoreSessionId', 'expectedSessionVersion'])
        || !isCanonicalUuid(command.commandId)
        || command.restoreSessionId !== session.restoreSessionId
        || command.expectedSessionVersion !== expectedVersion) {
        throw new RestoreActivationError('activation-pending', true);
    }
}

/**
 * Persists or verifies one exact path-free activation command for replay detection.
 * @param {string} activityControlRoot - Stable control root.
 * @param {ActivationPlanV1} plan - Bound immutable plan.
 * @param {'command-resume' | 'command-rollback'} kind - Closed command kind.
 * @param {RestoreSessionActionCommand} command - Exact action command.
 * @param {RestoreActivationOptions} options - Journal publication options.
 * @return {void}
 */
function recordActionCommand(
    activityControlRoot: string,
    plan: ActivationPlanV1,
    kind: 'command-resume' | 'command-rollback',
    command: RestoreSessionActionCommand,
    options: RestoreActivationOptions,
): void {
    const evidence = Object.freeze({
        commandId: command.commandId,
        commandDigest: createHash('sha256')
            .update(canonicalJson(command), 'utf8')
            .digest('hex'),
    });
    const records = readJournal(activityControlRoot, plan);
    const prior = records.find(record => (
        (record.kind === 'command-resume' || record.kind === 'command-rollback')
        && hasExactKeys(record.expectedFingerprints, ['commandId', 'commandDigest'])
        && record.expectedFingerprints.commandId === command.commandId
    ));
    if (prior) {
        if (prior.kind !== kind
            || !sameEvidence(prior.expectedFingerprints, evidence)
            || !sameEvidence(prior.observedFingerprints, evidence)) {
            throw new RestoreActivationError('conflict', true);
        }
        return;
    }
    appendJournal(
        activityControlRoot,
        plan,
        kind,
        evidence,
        evidence,
        options,
    );
}

/**
 * Creates and publishes the immutable A-only activation plan.
 * @param {BeginRestoreActivationInput} input - Validated pre-checkpoint facts.
 * @param {string} oldSlotFingerprint - Closed old active slot fingerprint.
 * @param {string} candidateSlotFingerprint - Closed candidate sibling fingerprint.
 * @param {string} sessionDigest - Last pre-checkpoint session digest.
 * @param {RestoreActivationOptions} options - Clock and failpoints.
 * @return {ActivationPlanV1} Reopened validated plan.
 */
function createActivationPlan(
    input: BeginRestoreActivationInput,
    oldSlotFingerprint: string,
    candidateSlotFingerprint: string,
    sessionDigest: string,
    options: RestoreActivationOptions,
): ActivationPlanV1 {
    const operationPath = operationDirectory(input.activityControlRoot, input.session.operationId);
    const undigested = {
        schema: PLAN_SCHEMA as typeof PLAN_SCHEMA,
        limitsVersion: LIMITS_VERSION as typeof LIMITS_VERSION,
        operationId: input.session.operationId,
        restoreSessionId: input.session.restoreSessionId,
        sessionVersion: '2' as const,
        preCheckpointSessionDigest: sessionDigest,
        previousTerminal: input.previousTerminal,
        candidate: Object.freeze({
            snapshotId: input.session.candidate.snapshotId,
            rootDigest: input.candidateRootDigest,
            sourceSchemaLevel: input.session.candidate.sourceSchemaLevel,
            postMigrationSchemaLevel: input.session.candidate.preparedSchemaLevel,
            workspaceId: input.session.current.workspaceId,
            revision: input.session.candidate.actualRevision,
        }),
        protection: Object.freeze({
            kind: 'required' as const,
            safetySetId: input.session.recoverability.safetySet.state === 'verified'
                ? input.session.recoverability.safetySet.safetySetId
                : '',
            rootDigest: input.safetyRootDigest,
        }),
        database: Object.freeze({
            old: Object.freeze({
                kind: 'validated' as const,
                workspaceId: input.session.current.workspaceId,
                revision: input.session.current.revision,
                slotFingerprint: oldSlotFingerprint,
            }),
            candidate: Object.freeze({
                kind: 'present' as const,
                workspaceId: input.session.current.workspaceId,
                revision: input.session.candidate.actualRevision,
                slotFingerprint: candidateSlotFingerprint,
            }),
            privateLocations: Object.freeze({
                active: path.join(input.dataSlotsRoot, ACTIVE_SLOT_NAME),
                candidateSibling: path.join(
                    input.dataSlotsRoot,
                    slotName('candidate', input.session.operationId),
                ),
                rollbackSibling: path.join(
                    input.dataSlotsRoot,
                    slotName('rollback', input.session.operationId),
                ),
                quarantineSibling: path.join(
                    input.dataSlotsRoot,
                    slotName('quarantine', input.session.operationId),
                ),
            }),
        }),
        library: Object.freeze({kind: 'absent' as const}),
        versions: Object.freeze({
            canonicalEncoding: CANONICAL_ENCODING,
            databaseFormat: 'sqlite-schema-16' as const,
            markerFormat: 'not-applicable' as const,
            pathKeyEncoding: 'not-applicable' as const,
            operationFormats: 'a-only-v1' as const,
            planVersion: '1' as const,
            journalVersion: '1' as const,
        }),
    };
    const plan: ActivationPlanV1 = Object.freeze({
        ...undigested,
        planDigest: createHash('sha256')
            .update(canonicalJson(undigested), 'utf8')
            .digest('hex'),
    });
    publishCanonicalFile(
        path.join(operationPath, PLAN_FILE_NAME),
        Buffer.from(canonicalJson(plan), 'utf8'),
        PLAN_MAXIMUM_BYTES,
        options,
        'activation-plan',
    );
    return readPlan(
        input.activityControlRoot,
        input.dataSlotsRoot,
        input.session.operationId,
    );
}

/**
 * Returns the expected database evidence at the three forward activation boundaries.
 * @param {ActivationPlanV1} plan - Bound activation plan.
 * @return {Readonly<object>} Before, retired, and installed evidence.
 */
function forwardEvidence(plan: ActivationPlanV1): Readonly<{
    before: DatabaseEvidence;
    retired: DatabaseEvidence;
    installed: DatabaseEvidence;
}> {
    const absent = Object.freeze({kind: 'absent' as const});
    const oldSlot = Object.freeze({
        kind: 'present' as const,
        slotFingerprint: plan.database.old.slotFingerprint,
    });
    const candidateSlot = Object.freeze({
        kind: 'present' as const,
        slotFingerprint: plan.database.candidate.slotFingerprint,
    });
    return Object.freeze({
        before: Object.freeze({
            active: oldSlot,
            candidate: candidateSlot,
            rollback: absent,
            quarantine: absent,
        }),
        retired: Object.freeze({
            active: absent,
            candidate: candidateSlot,
            rollback: oldSlot,
            quarantine: absent,
        }),
        installed: Object.freeze({
            active: candidateSlot,
            candidate: absent,
            rollback: oldSlot,
            quarantine: absent,
        }),
    });
}

/**
 * Returns the two exact rollback after-states for the A-only plan.
 * @param {ActivationPlanV1} plan - Bound activation plan.
 * @return {Readonly<object>} Candidate-quarantined states before and after old DATA restore.
 */
function rollbackEvidence(plan: ActivationPlanV1): Readonly<{
    quarantinedWithOldActive: DatabaseEvidence;
    quarantinedWithOldRetired: DatabaseEvidence;
}> {
    const forward = forwardEvidence(plan);
    const absent = Object.freeze({kind: 'absent' as const});
    const candidate = forward.installed.active;
    return Object.freeze({
        quarantinedWithOldActive: Object.freeze({
            active: forward.before.active,
            candidate: absent,
            rollback: absent,
            quarantine: candidate,
        }),
        quarantinedWithOldRetired: Object.freeze({
            active: absent,
            candidate: absent,
            rollback: forward.before.active,
            quarantine: candidate,
        }),
    });
}

/**
 * Returns the path-free DATA identity proven by a full owner reopen.
 * @param {string} workspaceId - Expected Workspace identity.
 * @param {string} revision - Expected active revision.
 * @return {Readonly<object>} Typed reopened DATA evidence.
 */
function reopenedDataEvidence(workspaceId: string, revision: string): Readonly<{
    database: Readonly<{
        workspaceId: string;
        schemaLevel: string;
        revision: string;
    }>;
}> {
    return Object.freeze({
        database: Object.freeze({
            workspaceId,
            schemaLevel: CURRENT_SCHEMA_LEVEL.toString(),
            revision,
        }),
    });
}

/**
 * Validates kind-specific nested journal evidence against the immutable plan.
 * @param {ActivationJournalRecord} record - Digest-valid journal record.
 * @param {ActivationPlanV1} plan - Bound immutable plan.
 * @return {void}
 */
function requireJournalEvidence(
    record: ActivationJournalRecord,
    plan: ActivationPlanV1,
): void {
    const forward = forwardEvidence(plan);
    const rollback = rollbackEvidence(plan);
    const databaseEvidence = (database: DatabaseEvidence) => Object.freeze({database});
    const actionEvidence = (before: DatabaseEvidence, after: DatabaseEvidence) => (
        Object.freeze({before, after})
    );
    const observedActionEvidence = (after: DatabaseEvidence) => Object.freeze({after});
    const matches = (expected: unknown, observed: unknown): boolean => (
        sameEvidence(record.expectedFingerprints, expected)
        && sameEvidence(record.observedFingerprints, observed)
    );
    const isReceiptEvidence = (value: unknown): boolean => hasExactKeys(value, ['receiptDigest'])
        && typeof value.receiptDigest === 'string'
        && DIGEST_PATTERN.test(value.receiptDigest);
    let valid = false;
    switch (record.kind) {
        case 'armed':
            valid = matches(databaseEvidence(forward.before), databaseEvidence(forward.before));
            break;
        case 'command-resume':
        case 'command-rollback':
            valid = hasExactKeys(record.expectedFingerprints, ['commandId', 'commandDigest'])
                && isCanonicalUuid(record.expectedFingerprints.commandId)
                && typeof record.expectedFingerprints.commandDigest === 'string'
                && DIGEST_PATTERN.test(record.expectedFingerprints.commandDigest)
                && sameEvidence(record.expectedFingerprints, record.observedFingerprints);
            break;
        case 'intent-retire-old-data':
            valid = matches(actionEvidence(forward.before, forward.retired), null);
            break;
        case 'observed-retire-old-data':
            valid = matches(
                actionEvidence(forward.before, forward.retired),
                observedActionEvidence(forward.retired),
            );
            break;
        case 'intent-install-candidate-data':
            valid = matches(actionEvidence(forward.retired, forward.installed), null);
            break;
        case 'observed-install-candidate-data':
            valid = matches(
                actionEvidence(forward.retired, forward.installed),
                observedActionEvidence(forward.installed),
            );
            break;
        case 'candidate-installed':
            valid = matches(databaseEvidence(forward.installed), databaseEvidence(forward.installed));
            break;
        case 'reopened': {
            const reopened = reopenedDataEvidence(
                plan.database.candidate.workspaceId,
                plan.database.candidate.revision,
            );
            valid = matches(reopened, reopened);
            break;
        }
        case 'intent-quarantine-candidate-data':
        case 'observed-quarantine-candidate-data': {
            const observed = record.kind === 'intent-quarantine-candidate-data'
                ? null
                : undefined;
            const pairs = [
                [forward.before, rollback.quarantinedWithOldActive],
                [forward.retired, rollback.quarantinedWithOldRetired],
                [forward.installed, rollback.quarantinedWithOldRetired],
            ] as const;
            valid = pairs.some(([before, after]) => matches(
                actionEvidence(before, after),
                observed === null ? null : observedActionEvidence(after),
            ));
            break;
        }
        case 'intent-restore-old-data':
            valid = matches(actionEvidence(
                rollback.quarantinedWithOldRetired,
                rollback.quarantinedWithOldActive,
            ), null);
            break;
        case 'observed-restore-old-data':
            valid = matches(
                actionEvidence(
                    rollback.quarantinedWithOldRetired,
                    rollback.quarantinedWithOldActive,
                ),
                observedActionEvidence(rollback.quarantinedWithOldActive),
            );
            break;
        case 'rollback-reopened':
            valid = matches(
                reopenedDataEvidence(
                    plan.database.old.workspaceId,
                    plan.database.old.revision,
                ),
                reopenedDataEvidence(
                    plan.database.old.workspaceId,
                    plan.database.old.revision,
                ),
            );
            break;
        case 'success-receipt':
        case 'committed':
        case 'rollback-receipt':
        case 'rolled-back':
            valid = isReceiptEvidence(record.expectedFingerprints)
                && sameEvidence(record.expectedFingerprints, record.observedFingerprints);
            break;
    }
    if (!valid) {
        throw new Error('Restore activation journal evidence is invalid');
    }
}

/**
 * Appends the missing observed record only when current evidence uniquely proves an intent result.
 * @param {string} activityControlRoot - Stable control root.
 * @param {string} dataSlotsRoot - Trusted DataSlots parent.
 * @param {ActivationPlanV1} plan - Bound activation plan.
 * @param {RestoreActivationOptions} options - Clock and failpoints.
 * @return {readonly ActivationJournalRecord[]} Revalidated possibly advanced chain.
 */
function observeLostActionResponse(
    activityControlRoot: string,
    dataSlotsRoot: string,
    plan: ActivationPlanV1,
    options: RestoreActivationOptions,
): readonly ActivationJournalRecord[] {
    let records = readJournal(activityControlRoot, plan);
    const latest = records.at(-1);
    const observedKind = latest?.kind === 'intent-retire-old-data'
        ? 'observed-retire-old-data'
        : latest?.kind === 'intent-install-candidate-data'
            ? 'observed-install-candidate-data'
            : latest?.kind === 'intent-quarantine-candidate-data'
                ? 'observed-quarantine-candidate-data'
                : latest?.kind === 'intent-restore-old-data'
                    ? 'observed-restore-old-data'
                    : null;
    if (observedKind
        && hasExactKeys(latest!.expectedFingerprints, ['before', 'after'])
        && sameEvidence(
            observeDatabaseEvidence(dataSlotsRoot, plan.operationId),
            latest!.expectedFingerprints.after,
        )) {
        appendJournal(
            activityControlRoot,
            plan,
            observedKind,
            latest!.expectedFingerprints,
            Object.freeze({after: latest!.expectedFingerprints.after}),
            options,
        );
        records = readJournal(activityControlRoot, plan);
    }
    return records;
}

/**
 * Executes one intent-bound rename and appends a freshly verified observed record.
 * @param {object} input - Complete physical action facts.
 * @return {void}
 */
function executeRename(input: Readonly<{
    activityControlRoot: string;
    dataSlotsRoot: string;
    plan: ActivationPlanV1;
    intentKind: Extract<JournalKind, `intent-${string}`>;
    observedKind: Extract<JournalKind, `observed-${string}`>;
    sourceName: string;
    targetName: string;
    fingerprint: string;
    before: DatabaseEvidence;
    after: DatabaseEvidence;
    failpointPrefix: string;
    options: RestoreActivationOptions;
}>): void {
    let records = readJournal(input.activityControlRoot, input.plan);
    if (records.some(record => record.kind === input.observedKind)) {
        return;
    }
    if (!records.some(record => record.kind === input.intentKind)) {
        fail(input.options, `activation.before-${input.failpointPrefix}-intent`);
        appendJournal(
            input.activityControlRoot,
            input.plan,
            input.intentKind,
            Object.freeze({before: input.before, after: input.after}),
            null,
            input.options,
        );
        fail(input.options, `activation.after-${input.failpointPrefix}-intent`);
    }
    const observed = observeDatabaseEvidence(input.dataSlotsRoot, input.plan.operationId);
    if (sameEvidence(observed, input.before)) {
        renameRestoreDataSlot(
            input.dataSlotsRoot,
            input.sourceName,
            input.targetName,
            input.fingerprint,
        );
        fail(input.options, `activation.after-${input.failpointPrefix}-action`);
    }
    const after = observeDatabaseEvidence(input.dataSlotsRoot, input.plan.operationId);
    if (!sameEvidence(after, input.after)) {
        throw new Error('Restore physical action produced ambiguous evidence');
    }
    fail(input.options, `activation.after-${input.failpointPrefix}-observation`);
    appendJournal(
        input.activityControlRoot,
        input.plan,
        input.observedKind,
        Object.freeze({before: input.before, after: input.after}),
        Object.freeze({after}),
        input.options,
    );
    fail(input.options, `activation.after-${input.failpointPrefix}-observed`);
    records = readJournal(input.activityControlRoot, input.plan);
    if (!records.some(record => record.kind === input.observedKind)) {
        throw new Error('Restore observed record is missing');
    }
}

/**
 * Derives the bounded FLOW-00 route without exposing ready before receipt completion.
 * @param {SqliteDataStore} store - Reopened maintenance DATA.
 * @return {'setup' | 'today'} Post-restore route.
 */
function routeAfterReopen(store: SqliteDataStore): 'setup' | 'today' {
    const projection = store.readSetupProjection();
    return projection.currentTerm && projection.courses.length > 0 ? 'today' : 'setup';
}

/**
 * Creates a typed completion receipt input from the plan and last physical precommit record.
 * @param {ActivationPlanV1} plan - Bound activation plan.
 * @param {ActivationJournalRecord} precommit - Last physical precommit evidence.
 * @param {SqliteDataStore} store - Reopened target DATA.
 * @param {'succeeded' | 'rolled-back'} outcome - Completion direction.
 * @return {RestoreCompletionReceiptInput} Exact path-free receipt input.
 */
function completionReceiptInput(
    plan: ActivationPlanV1,
    precommit: ActivationJournalRecord,
    store: SqliteDataStore,
    outcome: 'succeeded' | 'rolled-back',
): RestoreCompletionReceiptInput {
    const status = store.status();
    if (status.kind !== 'ready') {
        throw new Error('Restore completion DATA is not writable');
    }
    return Object.freeze({
        operationId: plan.operationId,
        restoreSessionId: plan.restoreSessionId,
        outcome,
        sessionVersion: '3',
        sourceSnapshotId: plan.candidate.snapshotId,
        sourceRootDigest: plan.candidate.rootDigest,
        sourceSchemaLevel: plan.candidate.sourceSchemaLevel,
        postMigrationSchemaLevel: plan.candidate.postMigrationSchemaLevel,
        activeWorkspaceId: status.workspaceId,
        activeRevision: status.revision,
        library: Object.freeze({state: 'absent' as const}),
        protection: Object.freeze({
            mode: 'required' as const,
            safetySetId: plan.protection.safetySetId,
        }),
        planDigest: plan.planDigest,
        precommit: Object.freeze({
            sequence: precommit.sequence,
            recordDigest: precommit.recordDigest,
        }),
        route: routeAfterReopen(store),
        receiptFormatVersion: '1' as const,
    });
}

/**
 * Reconstructs the exact terminal head from its DATA receipt and last external record.
 * @param {string} dataSlotsRoot - Trusted DataSlots parent.
 * @param {ActivationPlanV1} plan - Bound activation plan.
 * @param {readonly ActivationJournalRecord[]} records - Validated external chain.
 * @param {'succeeded' | 'rolled-back'} outcome - Proven terminal outcome.
 * @return {RestoreTerminalEvidence} Exact predecessor evidence for a later Restore.
 */
function terminalEvidence(
    dataSlotsRoot: string,
    plan: ActivationPlanV1,
    records: readonly ActivationJournalRecord[],
    outcome: 'succeeded' | 'rolled-back',
): RestoreTerminalEvidence {
    const receipt = inspectRestoreCompletionReceipt(
        dataSlotsRoot,
        ACTIVE_SLOT_NAME,
        plan.operationId,
    );
    const terminal = records.at(-1);
    const terminalKind = outcome === 'succeeded' ? 'committed' : 'rolled-back';
    if (!receipt
        || receipt.outcome !== outcome
        || !terminal
        || terminal.kind !== terminalKind
        || !sameEvidence(terminal.expectedFingerprints, {receiptDigest: receipt.receiptDigest})
        || !sameEvidence(terminal.expectedFingerprints, terminal.observedFingerprints)) {
        throw new Error('Restore terminal evidence is incomplete');
    }
    return Object.freeze({
        operationId: plan.operationId,
        outcome,
        terminalRecordDigest: terminal.recordDigest,
        receiptDigest: receipt.receiptDigest,
    });
}

/**
 * Revalidates the terminal head that a new activation will explicitly supersede.
 * @param {BeginRestoreActivationInput} input - New activation owner facts.
 * @param {RestoreActivationOptions} options - Journal reconciliation options.
 * @return {void}
 */
function requirePreviousTerminal(
    input: BeginRestoreActivationInput,
    options: RestoreActivationOptions,
): void {
    const boot = inspectRestoreBeforeWorkspaceOpen(
        input.activityControlRoot,
        input.dataSlotsRoot,
    );
    if (boot.kind === 'recovery-required'
        || !sameEvidence(boot.terminal, input.previousTerminal)) {
        throw new Error('Restore predecessor terminal selection changed');
    }
    if (!input.previousTerminal) {
        return;
    }
    const priorPlan = readPlan(
        input.activityControlRoot,
        input.dataSlotsRoot,
        input.previousTerminal.operationId,
    );
    let records = readJournal(input.activityControlRoot, priorPlan);
    const outcome = reconcileCompletionReceipt(
        input.activityControlRoot,
        input.dataSlotsRoot,
        priorPlan,
        records,
        options,
    );
    if (outcome !== input.previousTerminal.outcome) {
        throw new Error('Restore predecessor terminal is not current');
    }
    records = readJournal(input.activityControlRoot, priorPlan);
    if (!sameEvidence(
        terminalEvidence(input.dataSlotsRoot, priorPlan, records, outcome),
        input.previousTerminal,
    )) {
        throw new Error('Restore predecessor terminal evidence changed');
    }
}

/**
 * Runs the A-only forward activation from any uniquely evidenced post-checkpoint state.
 * @param {string} activityControlRoot - Stable control root.
 * @param {string} dataSlotsRoot - Trusted DataSlots parent.
 * @param {ActivationPlanV1} plan - Bound activation plan.
 * @param {RestoreSessionView} baseSession - Frozen pre-checkpoint public view.
 * @param {RestoreActivationOptions} options - Clock and failpoints.
 * @return {Promise<RestoreActivationResult>} Reopened candidate store and terminal view.
 */
async function runForward(
    activityControlRoot: string,
    dataSlotsRoot: string,
    plan: ActivationPlanV1,
    baseSession: RestoreSessionView,
    options: RestoreActivationOptions,
): Promise<RestoreActivationResult> {
    observeLostActionResponse(activityControlRoot, dataSlotsRoot, plan, options);
    const expected = forwardEvidence(plan);
    executeRename({
        activityControlRoot,
        dataSlotsRoot,
        plan,
        intentKind: 'intent-retire-old-data',
        observedKind: 'observed-retire-old-data',
        sourceName: ACTIVE_SLOT_NAME,
        targetName: slotName('rollback', plan.operationId),
        fingerprint: plan.database.old.slotFingerprint,
        before: expected.before,
        after: expected.retired,
        failpointPrefix: 'retire',
        options,
    });
    executeRename({
        activityControlRoot,
        dataSlotsRoot,
        plan,
        intentKind: 'intent-install-candidate-data',
        observedKind: 'observed-install-candidate-data',
        sourceName: slotName('candidate', plan.operationId),
        targetName: ACTIVE_SLOT_NAME,
        fingerprint: plan.database.candidate.slotFingerprint,
        before: expected.retired,
        after: expected.installed,
        failpointPrefix: 'install',
        options,
    });
    let records = readJournal(activityControlRoot, plan);
    let precommit = records.find(record => record.kind === 'candidate-installed');
    if (!precommit) {
        const observed = observeDatabaseEvidence(dataSlotsRoot, plan.operationId);
        if (!sameEvidence(observed, expected.installed)) {
            throw new Error('Restore candidate-installed evidence is invalid');
        }
        precommit = appendJournal(
            activityControlRoot,
            plan,
            'candidate-installed',
            Object.freeze({database: expected.installed}),
            Object.freeze({database: observed}),
            options,
        );
        fail(options, 'activation.after-candidate-installed');
    }
    const opened = openWorkspaceData(dataSlotsRoot);
    if (opened.kind !== 'ready'
        || opened.store.status().workspaceId !== plan.database.candidate.workspaceId
        || opened.store.status().revision !== plan.database.candidate.revision) {
        if (opened.kind === 'ready' || opened.kind === 'read-only') {
            await opened.store.close();
        }
        throw new Error('Restore candidate reopen validation failed');
    }
    const store = opened.store;
    try {
        records = readJournal(activityControlRoot, plan);
        if (!records.some(record => record.kind === 'reopened')) {
            const reopened = reopenedDataEvidence(
                plan.database.candidate.workspaceId,
                plan.database.candidate.revision,
            );
            appendJournal(
                activityControlRoot,
                plan,
                'reopened',
                reopened,
                reopened,
                options,
            );
        }
        fail(options, 'activation.after-reopen');
        store.recordRestoreCompletionReceipt(completionReceiptInput(
            plan,
            precommit,
            store,
            'succeeded',
        ));
        fail(options, 'activation.after-success-receipt');
        records = readJournal(activityControlRoot, plan);
        if (reconcileCompletionReceipt(
            activityControlRoot,
            dataSlotsRoot,
            plan,
            records,
            options,
        ) !== 'succeeded') {
            throw new Error('Restore success receipt could not be reconciled');
        }
        fail(options, 'activation.after-committed');
        const terminal = terminalEvidence(
            dataSlotsRoot,
            plan,
            readJournal(activityControlRoot, plan),
            'succeeded',
        );
        return Object.freeze({
            session: activationView(baseSession, 'succeeded', [], null),
            store,
            terminal,
        });
    }
    catch (error) {
        await store.close();
        throw error;
    }
}

/**
 * Stages, closes, arms, and runs one new A-only activation.
 * @param {BeginRestoreActivationInput} input - Complete pre-checkpoint owner facts.
 * @param {RestoreActivationOptions} options - Clock, files, and failpoints.
 * @return {Promise<RestoreActivationResult>} Reopened candidate and terminal view.
 */
export async function beginRestoreActivation(
    input: BeginRestoreActivationInput,
    options: RestoreActivationOptions = {},
): Promise<RestoreActivationResult> {
    let checkpointReached = false;
    try {
        if (input.session.phase !== 'protection-established'
            || input.session.recoverability.safetySet.state !== 'verified'
            || !DIGEST_PATTERN.test(input.candidateRootDigest)
            || !DIGEST_PATTERN.test(input.safetyRootDigest)) {
            throw new Error('Restore activation protection is incomplete');
        }
        requireActionCommand(input.command, input.session, '1');
        requireRestoreSameVolume(input.activityControlRoot, input.dataSlotsRoot, options.files);
        requirePreviousTerminal(input, options);
        const candidateName = slotName('candidate', input.session.operationId);
        let candidateObservation = observeRestoreDataSlot(input.dataSlotsRoot, candidateName);
        if (candidateObservation.kind === 'absent') {
            stageRestoreDataSlot(
                input.preparedDatabasePath,
                input.dataSlotsRoot,
                candidateName,
                options.files,
            );
            fail(options, 'activation.after-candidate-stage');
            candidateObservation = observeRestoreDataSlot(input.dataSlotsRoot, candidateName);
        }
        if (candidateObservation.kind !== 'present') {
            throw new Error('Restore candidate staging is missing');
        }
        const candidateMembers = candidateObservation.fingerprint.members;
        if (candidateMembers.length !== 1
            || candidateMembers[0]?.path !== 'workspace.sqlite'
            || candidateMembers[0].sha256 !== input.candidateDatabaseDigest) {
            throw new Error('Restore candidate staging bytes changed');
        }
        const candidateFacts = inspectRestoreDataSlot(input.dataSlotsRoot, candidateName);
        if (candidateFacts.workspaceId !== input.session.current.workspaceId
            || candidateFacts.revision !== input.session.candidate.actualRevision
            || candidateFacts.schemaLevel !== input.session.candidate.preparedSchemaLevel) {
            throw new Error('Restore candidate staging identity changed');
        }
        candidateObservation = observeRestoreDataSlot(input.dataSlotsRoot, candidateName);
        if (candidateObservation.kind !== 'present') {
            throw new Error('Restore candidate staging changed during validation');
        }
        fail(options, 'activation.after-candidate-stage-validation');
        const sessionRecord = latestSessionRecord(
            input.activityControlRoot,
            input.session.operationId,
        );
        if (!sessionRecord || !sameEvidence(sessionRecord.session, input.session)) {
            throw new Error('Restore session control evidence is incomplete');
        }
        input.store.prepareForRestoreActivation(point => fail(options, point));
        fail(options, 'activation.before-data-close');
        await input.store.close();
        fail(options, 'activation.after-data-close');
        let oldObservation = observeRestoreDataSlot(input.dataSlotsRoot, ACTIVE_SLOT_NAME);
        if (oldObservation.kind !== 'present') {
            throw new Error('Restore active DATA is missing before checkpoint');
        }
        const oldFacts = inspectRestoreDataSlot(input.dataSlotsRoot, ACTIVE_SLOT_NAME);
        if (oldFacts.workspaceId !== input.session.current.workspaceId
            || oldFacts.revision !== input.session.current.revision) {
            throw new Error('Restore active DATA changed before checkpoint');
        }
        oldObservation = observeRestoreDataSlot(input.dataSlotsRoot, ACTIVE_SLOT_NAME);
        if (oldObservation.kind !== 'present') {
            throw new Error('Restore active DATA changed during validation');
        }
        const operationPath = operationDirectory(
            input.activityControlRoot,
            input.session.operationId,
        );
        requireOperationControlClosure(
            input.activityControlRoot,
            input.session.operationId,
        );
        if (!plainChildDirectoryExists(operationPath, JOURNAL_DIRECTORY_NAME)) {
            throw new Error('Restore activation journal directory is missing');
        }
        const plan = createActivationPlan(
            input,
            oldObservation.fingerprint.slotFingerprint,
            candidateObservation.fingerprint.slotFingerprint,
            sessionRecord.recordDigest,
            options,
        );
        const before = forwardEvidence(plan).before;
        if (!sameEvidence(
            observeDatabaseEvidence(input.dataSlotsRoot, plan.operationId),
            before,
        )) {
            throw new Error('Restore checkpoint evidence changed');
        }
        if (readJournal(input.activityControlRoot, plan).length === 0) {
            appendJournal(
                input.activityControlRoot,
                plan,
                'armed',
                Object.freeze({database: before}),
                Object.freeze({database: before}),
                options,
            );
        }
        checkpointReached = true;
        fail(options, 'activation.after-armed');
        recordActionCommand(
            input.activityControlRoot,
            plan,
            'command-resume',
            input.command,
            options,
        );
        return await runForward(
            input.activityControlRoot,
            input.dataSlotsRoot,
            plan,
            input.session,
            options,
        );
    }
    catch (error) {
        if (error instanceof RestoreActivationError) {
            throw error;
        }
        if (!checkpointReached) {
            try {
                const planPath = path.join(
                    operationDirectory(input.activityControlRoot, input.session.operationId),
                    PLAN_FILE_NAME,
                );
                if (plainFileExists(planPath)) {
                    const plan = readPlan(
                        input.activityControlRoot,
                        input.dataSlotsRoot,
                        input.session.operationId,
                    );
                    checkpointReached = readJournal(input.activityControlRoot, plan)
                        .some(record => record.kind === 'armed');
                }
            }
            catch {
                // Unreadable control evidence cannot weaken an already unknown checkpoint boundary.
                checkpointReached = true;
            }
        }
        throw new RestoreActivationError(
            checkpointReached ? 'activation-pending' : 'staging-failed',
            checkpointReached,
            error,
        );
    }
}

/**
 * Continues a previously armed activation after explicit user command.
 * @param {string} activityControlRoot - Stable control root.
 * @param {string} dataSlotsRoot - Trusted DataSlots parent.
 * @param {RestoreSessionActionCommand} command - Version-bound resume command.
 * @param {RestoreActivationOptions} options - Clock and failpoints.
 * @return {Promise<RestoreActivationResult>} Reopened candidate and terminal view.
 */
export async function continueRestoreActivation(
    activityControlRoot: string,
    dataSlotsRoot: string,
    command: RestoreSessionActionCommand,
    options: RestoreActivationOptions = {},
): Promise<RestoreActivationResult> {
    try {
        requireRestoreSameVolume(activityControlRoot, dataSlotsRoot, options.files);
        const plan = findPlanForSession(activityControlRoot, dataSlotsRoot, command.restoreSessionId);
        const sessionRecord = latestSessionRecord(activityControlRoot, plan.operationId);
        if (!sessionRecord) {
            throw new Error('Restore session evidence is missing');
        }
        requireActionCommand(command, sessionRecord.session, '2');
        recordActionCommand(
            activityControlRoot,
            plan,
            'command-resume',
            command,
            options,
        );
        return await runForward(
            activityControlRoot,
            dataSlotsRoot,
            plan,
            sessionRecord.session,
            options,
        );
    }
    catch (error) {
        if (error instanceof RestoreActivationError) {
            throw error;
        }
        throw new RestoreActivationError('activation-pending', true, error);
    }
}

/**
 * Finds the one immutable activation plan bound to a RestoreSessionId.
 * @param {string} activityControlRoot - Stable control root.
 * @param {string} dataSlotsRoot - Trusted DataSlots parent.
 * @param {string} restoreSessionId - Canonical session identity.
 * @return {ActivationPlanV1} Unique validated plan.
 */
function findPlanForSession(
    activityControlRoot: string,
    dataSlotsRoot: string,
    restoreSessionId: string,
): ActivationPlanV1 {
    if (!isCanonicalUuid(restoreSessionId)) {
        throw new TypeError('RestoreSessionId is invalid');
    }
    const restoreRoot = path.join(activityControlRoot, RESTORE_DIRECTORY_NAME);
    if (!plainChildDirectoryExists(activityControlRoot, RESTORE_DIRECTORY_NAME)) {
        throw new Error('Restore operation root is missing');
    }
    const plans = listPlainDirectory(restoreRoot).flatMap(operationId => {
        if (!isCanonicalUuid(operationId)
            || !plainChildDirectoryExists(restoreRoot, operationId)
            || !plainFileExists(path.join(restoreRoot, operationId, PLAN_FILE_NAME))) {
            return [];
        }
        const plan = readPlan(activityControlRoot, dataSlotsRoot, operationId);
        return plan.restoreSessionId === restoreSessionId ? [plan] : [];
    });
    if (plans.length !== 1) {
        throw new Error('Restore activation plan is not unique');
    }
    return plans[0]!;
}

/**
 * Reopens an active slot and verifies one expected identity.
 * @param {string} dataSlotsRoot - Trusted DataSlots parent.
 * @param {string} workspaceId - Expected WorkspaceId.
 * @param {string} revision - Expected Revision.
 * @return {SqliteDataStore} Fully reopened writable store.
 */
function reopenExpectedData(
    dataSlotsRoot: string,
    workspaceId: string,
    revision: string,
): SqliteDataStore {
    const opened = openWorkspaceData(dataSlotsRoot);
    if (opened.kind !== 'ready'
        || opened.store.status().workspaceId !== workspaceId
        || opened.store.status().revision !== revision) {
        if (opened.kind === 'ready' || opened.kind === 'read-only') {
            void opened.store.close();
        }
        throw new Error('Restore rollback DATA reopen validation failed');
    }
    return opened.store;
}

/**
 * Rolls an armed A-only activation back through candidate quarantine and old-slot restore.
 * @param {string} activityControlRoot - Stable control root.
 * @param {string} dataSlotsRoot - Trusted DataSlots parent.
 * @param {RestoreSessionActionCommand} command - Version-bound rollback command.
 * @param {RestoreActivationOptions} options - Clock and failpoints.
 * @return {Promise<RestoreActivationResult>} Reopened old DATA and terminal view.
 */
export async function rollbackRestoreActivation(
    activityControlRoot: string,
    dataSlotsRoot: string,
    command: RestoreSessionActionCommand,
    options: RestoreActivationOptions = {},
): Promise<RestoreActivationResult> {
    try {
        requireRestoreSameVolume(activityControlRoot, dataSlotsRoot, options.files);
        const plan = findPlanForSession(activityControlRoot, dataSlotsRoot, command.restoreSessionId);
        const sessionRecord = latestSessionRecord(activityControlRoot, plan.operationId);
        if (!sessionRecord) {
            throw new Error('Restore session evidence is missing');
        }
        requireActionCommand(command, sessionRecord.session, '2');
        recordActionCommand(
            activityControlRoot,
            plan,
            'command-rollback',
            command,
            options,
        );
        observeLostActionResponse(activityControlRoot, dataSlotsRoot, plan, options);
        const expected = forwardEvidence(plan);
        let current = observeDatabaseEvidence(dataSlotsRoot, plan.operationId);
        const absent = Object.freeze({kind: 'absent' as const});
        const candidate = expected.installed.active;
        const old = expected.before.active;
        const quarantineAfter = Object.freeze({
            active: current.active.kind === 'present'
                && current.active.slotFingerprint === plan.database.candidate.slotFingerprint
                ? absent
                : current.active,
            candidate: current.candidate.kind === 'present'
                && current.candidate.slotFingerprint === plan.database.candidate.slotFingerprint
                ? absent
                : current.candidate,
            rollback: current.rollback,
            quarantine: candidate,
        });
        if (!sameEvidence(current.quarantine, candidate)) {
            const sourceName = current.active.kind === 'present'
                && current.active.slotFingerprint === plan.database.candidate.slotFingerprint
                ? ACTIVE_SLOT_NAME
                : slotName('candidate', plan.operationId);
            executeRename({
                activityControlRoot,
                dataSlotsRoot,
                plan,
                intentKind: 'intent-quarantine-candidate-data',
                observedKind: 'observed-quarantine-candidate-data',
                sourceName,
                targetName: slotName('quarantine', plan.operationId),
                fingerprint: plan.database.candidate.slotFingerprint,
                before: current,
                after: quarantineAfter,
                failpointPrefix: 'quarantine',
                options,
            });
            current = observeDatabaseEvidence(dataSlotsRoot, plan.operationId);
        }
        if (current.active.kind === 'absent'
            && current.rollback.kind === 'present'
            && current.rollback.slotFingerprint === plan.database.old.slotFingerprint) {
            const restored = Object.freeze({
                ...current,
                active: old,
                rollback: absent,
            });
            executeRename({
                activityControlRoot,
                dataSlotsRoot,
                plan,
                intentKind: 'intent-restore-old-data',
                observedKind: 'observed-restore-old-data',
                sourceName: slotName('rollback', plan.operationId),
                targetName: ACTIVE_SLOT_NAME,
                fingerprint: plan.database.old.slotFingerprint,
                before: current,
                after: restored,
                failpointPrefix: 'restore-old',
                options,
            });
            current = restored;
        }
        if (current.active.kind !== 'present'
            || current.active.slotFingerprint !== plan.database.old.slotFingerprint) {
            throw new Error('Restore rollback old DATA is unavailable');
        }
        const records = readJournal(activityControlRoot, plan);
        const precommit = [...records].reverse().find(record => (
            record.kind === 'observed-quarantine-candidate-data'
            || record.kind === 'observed-restore-old-data'
        ));
        if (!precommit) {
            throw new Error('Restore rollback physical precommit evidence is missing');
        }
        const store = reopenExpectedData(
            dataSlotsRoot,
            plan.database.old.workspaceId,
            plan.database.old.revision,
        );
        try {
            if (!records.some(record => record.kind === 'rollback-reopened')) {
                const reopened = reopenedDataEvidence(
                    plan.database.old.workspaceId,
                    plan.database.old.revision,
                );
                appendJournal(
                    activityControlRoot,
                    plan,
                    'rollback-reopened',
                    reopened,
                    reopened,
                    options,
                );
            }
            store.recordRestoreCompletionReceipt(completionReceiptInput(
                plan,
                precommit,
                store,
                'rolled-back',
            ));
            fail(options, 'activation.after-rollback-receipt');
            if (reconcileCompletionReceipt(
                activityControlRoot,
                dataSlotsRoot,
                plan,
                readJournal(activityControlRoot, plan),
                options,
            ) !== 'rolled-back') {
                throw new Error('Restore rollback receipt could not be reconciled');
            }
            fail(options, 'activation.after-rolled-back');
            const terminal = terminalEvidence(
                dataSlotsRoot,
                plan,
                readJournal(activityControlRoot, plan),
                'rolled-back',
            );
            return Object.freeze({
                session: activationView(sessionRecord.session, 'rolled-back', [], null),
                store,
                terminal,
            });
        }
        catch (error) {
            await store.close();
            throw error;
        }
    }
    catch (error) {
        if (error instanceof RestoreActivationError) {
            throw error;
        }
        throw new RestoreActivationError('rollback-required', true, error);
    }
}

/**
 * Derives currently safe recovery actions from exact slot fingerprints.
 * @param {ActivationPlanV1} plan - Bound activation plan.
 * @param {DatabaseEvidence} evidence - Fresh physical evidence.
 * @param {readonly ActivationJournalRecord[]} records - Validated coordination prefix.
 * @return {readonly ('resume' | 'rollback')[]} Safe action subset.
 */
function recoveryActions(
    plan: ActivationPlanV1,
    evidence: DatabaseEvidence,
    records: readonly ActivationJournalRecord[],
): readonly ('resume' | 'rollback')[] {
    const forward = forwardEvidence(plan);
    const rollback = rollbackEvidence(plan);
    const rollbackStarted = records.some(record => (
        record.kind === 'intent-quarantine-candidate-data'
        || record.kind === 'observed-quarantine-candidate-data'
        || record.kind === 'intent-restore-old-data'
        || record.kind === 'observed-restore-old-data'
        || record.kind === 'rollback-reopened'
        || record.kind === 'rollback-receipt'
        || record.kind === 'rolled-back'
    ));
    if (rollbackStarted && [
        forward.before,
        forward.retired,
        forward.installed,
        rollback.quarantinedWithOldActive,
        rollback.quarantinedWithOldRetired,
    ].some(state => sameEvidence(evidence, state))) {
        return Object.freeze(['rollback'] as const);
    }
    if ([forward.before, forward.retired, forward.installed].some(state => (
        sameEvidence(evidence, state)
    ))) {
        return Object.freeze(['resume', 'rollback'] as const);
    }
    if ([
        rollback.quarantinedWithOldActive,
        rollback.quarantinedWithOldRetired,
    ].some(state => sameEvidence(evidence, state))) {
        return Object.freeze(['rollback'] as const);
    }
    return Object.freeze([]);
}

/**
 * Verifies an active DATA receipt and appends only its missing external terminal bookkeeping.
 * @param {string} activityControlRoot - Stable control root.
 * @param {string} dataSlotsRoot - Trusted DataSlots parent.
 * @param {ActivationPlanV1} plan - Bound immutable plan.
 * @param {readonly ActivationJournalRecord[]} records - Validated external chain.
 * @param {RestoreActivationOptions} options - Journal publication options.
 * @return {'succeeded' | 'rolled-back' | null} Proven terminal outcome, or null without a receipt.
 */
function reconcileCompletionReceipt(
    activityControlRoot: string,
    dataSlotsRoot: string,
    plan: ActivationPlanV1,
    records: readonly ActivationJournalRecord[],
    options: RestoreActivationOptions,
): 'succeeded' | 'rolled-back' | null {
    const evidence = observeDatabaseEvidence(dataSlotsRoot, plan.operationId);
    const committed = records.find(record => record.kind === 'committed');
    const rolledBack = records.find(record => record.kind === 'rolled-back');
    if (evidence.active.kind === 'absent') {
        if (committed || rolledBack) {
            throw new Error('Restore external terminal has no active DATA');
        }
        return null;
    }
    const receipt = inspectRestoreCompletionReceipt(
        dataSlotsRoot,
        ACTIVE_SLOT_NAME,
        plan.operationId,
    );
    if (!receipt) {
        if (committed || rolledBack) {
            throw new Error('Restore external terminal has no DATA receipt');
        }
        return null;
    }
    const precommit = records.find(record => (
        record.sequence === receipt.precommit.sequence
        && record.recordDigest === receipt.precommit.recordDigest
    ));
    const activeFacts = inspectRestoreDataSlot(dataSlotsRoot, ACTIVE_SLOT_NAME);
    const expectedRevision = receipt.outcome === 'succeeded'
        ? plan.database.candidate.revision
        : plan.database.old.revision;
    const expectedWorkspaceId = receipt.outcome === 'succeeded'
        ? plan.database.candidate.workspaceId
        : plan.database.old.workspaceId;
    const expectedOtherSlots = receipt.outcome === 'succeeded'
        ? Object.freeze({
            candidate: Object.freeze({kind: 'absent' as const}),
            rollback: Object.freeze({
                kind: 'present' as const,
                slotFingerprint: plan.database.old.slotFingerprint,
            }),
            quarantine: Object.freeze({kind: 'absent' as const}),
        })
        : Object.freeze({
            candidate: Object.freeze({kind: 'absent' as const}),
            rollback: Object.freeze({kind: 'absent' as const}),
            quarantine: Object.freeze({
                kind: 'present' as const,
                slotFingerprint: plan.database.candidate.slotFingerprint,
            }),
        });
    if (!precommit
        || (receipt.outcome === 'succeeded'
            ? precommit.kind !== 'candidate-installed'
            : precommit.kind !== 'observed-quarantine-candidate-data'
                && precommit.kind !== 'observed-restore-old-data')
        || receipt.operationId !== plan.operationId
        || receipt.restoreSessionId !== plan.restoreSessionId
        || receipt.sessionVersion !== '3'
        || receipt.sourceSnapshotId !== plan.candidate.snapshotId
        || receipt.sourceRootDigest !== plan.candidate.rootDigest
        || receipt.sourceSchemaLevel !== plan.candidate.sourceSchemaLevel
        || receipt.postMigrationSchemaLevel !== plan.candidate.postMigrationSchemaLevel
        || receipt.activeWorkspaceId !== expectedWorkspaceId
        || receipt.activeRevision !== expectedRevision
        || receipt.library.state !== 'absent'
        || receipt.protection.mode !== 'required'
        || receipt.protection.safetySetId !== plan.protection.safetySetId
        || receipt.planDigest !== plan.planDigest
        || activeFacts.workspaceId !== expectedWorkspaceId
        || BigInt(activeFacts.revision) < BigInt(expectedRevision)
        || evidence.active.kind !== 'present'
        || !sameEvidence(evidence.candidate, expectedOtherSlots.candidate)
        || !sameEvidence(evidence.rollback, expectedOtherSlots.rollback)
        || !sameEvidence(evidence.quarantine, expectedOtherSlots.quarantine)
        || (receipt.outcome === 'succeeded' && rolledBack !== undefined)
        || (receipt.outcome === 'rolled-back' && committed !== undefined)) {
        throw new Error('Restore DATA receipt does not match activation evidence');
    }
    const receiptEvidence = Object.freeze({receiptDigest: receipt.receiptDigest});
    const receiptKind = receipt.outcome === 'succeeded'
        ? 'success-receipt' as const
        : 'rollback-receipt' as const;
    const terminalKind = receipt.outcome === 'succeeded'
        ? 'committed' as const
        : 'rolled-back' as const;
    for (const record of records.filter(record => (
        record.kind === receiptKind || record.kind === terminalKind
    ))) {
        if (!sameEvidence(record.expectedFingerprints, receiptEvidence)
            || !sameEvidence(record.observedFingerprints, receiptEvidence)) {
            throw new Error('Restore external receipt evidence conflicts with DATA');
        }
    }
    let updated = records;
    if (!updated.some(record => record.kind === receiptKind)) {
        appendJournal(
            activityControlRoot,
            plan,
            receiptKind,
            receiptEvidence,
            receiptEvidence,
            options,
        );
        updated = readJournal(activityControlRoot, plan);
    }
    if (!updated.some(record => record.kind === terminalKind)) {
        appendJournal(
            activityControlRoot,
            plan,
            terminalKind,
            receiptEvidence,
            receiptEvidence,
            options,
        );
    }
    return receipt.outcome;
}

/**
 * Inspects external Restore coordination before any ordinary DATA open.
 * @param {string} activityControlRoot - Stable control root.
 * @param {string} dataSlotsRoot - Stable DataSlots parent.
 * @return {RestoreBootState} Path-free boot classification.
 */
export function inspectRestoreBeforeWorkspaceOpen(
    activityControlRoot: string,
    dataSlotsRoot: string,
): RestoreBootState {
    try {
        if (!plainChildDirectoryExists(activityControlRoot, RESTORE_DIRECTORY_NAME)) {
            return Object.freeze({kind: 'clear' as const, session: null, terminal: null});
        }
        requireRestoreSameVolume(activityControlRoot, dataSlotsRoot);
        const restoreRoot = path.join(activityControlRoot, RESTORE_DIRECTORY_NAME);
        const operationIds = listPlainDirectory(restoreRoot);
        const operations = operationIds.map(operationId => {
            if (!isCanonicalUuid(operationId)
                || !plainChildDirectoryExists(restoreRoot, operationId)) {
                throw new Error('Restore control operation identity is invalid');
            }
            requireOperationControlClosure(activityControlRoot, operationId);
            const sessionRecord = latestSessionRecord(activityControlRoot, operationId);
            if (!sessionRecord) {
                throw new Error('Restore control session evidence is missing');
            }
            const planPath = path.join(restoreRoot, operationId, PLAN_FILE_NAME);
            if (!plainFileExists(planPath)) {
                return Object.freeze({operationId, sessionRecord, plan: null, records: []});
            }
            const plan = readPlan(activityControlRoot, dataSlotsRoot, operationId);
            return Object.freeze({
                operationId,
                sessionRecord,
                plan,
                records: readJournal(activityControlRoot, plan),
            });
        });
        const byOperationId = new Map(operations.map(operation => [
            operation.operationId,
            operation,
        ]));
        const superseded = new Set<string>();
        for (const operation of operations) {
            if (!operation.plan
                || !operation.records.some(record => record.kind === 'armed')
                || !operation.plan.previousTerminal) {
                continue;
            }
            const previous = operation.plan.previousTerminal;
            const predecessor = byOperationId.get(previous.operationId);
            const terminalRecord = predecessor?.records.at(-1);
            const terminalKind = previous.outcome === 'succeeded' ? 'committed' : 'rolled-back';
            if (!predecessor?.plan
                || !terminalRecord
                || terminalRecord.kind !== terminalKind
                || terminalRecord.recordDigest !== previous.terminalRecordDigest
                || !sameEvidence(
                    terminalRecord.expectedFingerprints,
                    {receiptDigest: previous.receiptDigest},
                )
                || superseded.has(previous.operationId)) {
                throw new Error('Restore predecessor chain is invalid');
            }
            superseded.add(previous.operationId);
        }
        for (const operation of operations) {
            const seen = new Set<string>();
            let current = operation;
            while (current.plan?.previousTerminal) {
                if (seen.has(current.operationId)) {
                    throw new Error('Restore predecessor chain is cyclic');
                }
                seen.add(current.operationId);
                const predecessor = byOperationId.get(current.plan.previousTerminal.operationId);
                if (!predecessor) {
                    throw new Error('Restore predecessor chain is incomplete');
                }
                current = predecessor;
            }
        }
        const pending: Array<Readonly<{
            kind: 'pre-checkpoint-session' | 'recovery-required';
            session: RestoreSessionView;
        }>> = [];
        const terminals: Array<Readonly<{
            session: RestoreSessionView;
            evidence: RestoreTerminalEvidence;
        }>> = [];
        for (const operation of operations) {
            if (superseded.has(operation.operationId)) {
                continue;
            }
            if (!operation.plan) {
                if (operation.sessionRecord.session.phase === 'cancelled') {
                    continue;
                }
                pending.push(Object.freeze({
                    kind: 'pre-checkpoint-session' as const,
                    session: operation.sessionRecord.session,
                }));
                continue;
            }
            const plan = operation.plan;
            let records = operation.records;
            if (!records.some(record => record.kind === 'armed')) {
                if (operation.sessionRecord.session.phase === 'cancelled') {
                    continue;
                }
                pending.push(Object.freeze({
                    kind: 'pre-checkpoint-session' as const,
                    session: operation.sessionRecord.session,
                }));
                continue;
            }
            records = observeLostActionResponse(
                activityControlRoot,
                dataSlotsRoot,
                plan,
                {},
            );
            const completion = reconcileCompletionReceipt(
                activityControlRoot,
                dataSlotsRoot,
                plan,
                records,
                {},
            );
            if (completion) {
                records = readJournal(activityControlRoot, plan);
                terminals.push(Object.freeze({
                    session: activationView(operation.sessionRecord.session, completion, [], null),
                    evidence: terminalEvidence(dataSlotsRoot, plan, records, completion),
                }));
                continue;
            }
            const actions = recoveryActions(
                plan,
                observeDatabaseEvidence(dataSlotsRoot, operation.operationId),
                records,
            );
            const problem = actions.length === 1 && actions[0] === 'rollback'
                ? 'rollback-required'
                : actions.length === 0
                    ? 'recovery-required'
                    : 'activation-pending';
            pending.push(Object.freeze({
                kind: 'recovery-required' as const,
                session: activationView(
                    operation.sessionRecord.session,
                    'recovery-required',
                    actions,
                    problem,
                ),
            }));
        }
        if (pending.length > 1 || terminals.length > 1) {
            return Object.freeze({
                kind: 'recovery-required' as const,
                session: null,
                terminal: null,
            });
        }
        if (pending.length === 1) {
            return Object.freeze({
                ...pending[0]!,
                terminal: terminals[0]?.evidence ?? null,
            });
        }
        return terminals.length === 1
            ? Object.freeze({
                kind: 'committed' as const,
                session: terminals[0]!.session,
                terminal: terminals[0]!.evidence,
            })
            : Object.freeze({kind: 'clear' as const, session: null, terminal: null});
    }
    catch {
        return Object.freeze({kind: 'recovery-required' as const, session: null, terminal: null});
    }
}
