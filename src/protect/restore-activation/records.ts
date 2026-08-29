import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { CURRENT_SCHEMA_LEVEL } from '../../data/schema';
import { listPlainDirectory, plainChildDirectoryExists, plainFileExists, publishBackupMember, readBoundedPlainFile, syncPlainFile } from '../../platform/backup-snapshot-files';
import { RestoreActivationError } from '../restore-activation';
import { isRestoreTerminalEvidence, requireJournalEvidence, sameEvidence } from './evidence';
import { ACTIVE_SLOT_NAME, CANONICAL_ENCODING, DIGEST_PATTERN, JOURNAL_DIRECTORY_NAME, JOURNAL_KINDS, JOURNAL_SCHEMA, LIMITS_VERSION, MAXIMUM_JSON_DEPTH, MAXIMUM_JSON_STRING_LENGTH, PLAN_FILE_NAME, PLAN_MAXIMUM_BYTES, PLAN_SCHEMA, RECORD_MAXIMUM_BYTES, RESTORE_DIRECTORY_NAME, SESSION_DIRECTORY_NAME, SESSION_SCHEMA, TEMPORARY_PUBLICATION_NAME, TOTAL_RECORD_LIMIT } from './protocol';
import type { ActivationJournalRecord, ActivationPlanV1, JournalKind, RestoreActivationOptions, SessionControlRecord } from './protocol';
import { canonicalJson } from '../../shared/canonical-json';
import { isCanonicalUnsignedSqliteInteger, isCanonicalUuid } from '../../shared/workspace-data-contract';
import { RestoreSessionActionCommand, isRestoreSessionView } from '../../shared/workspace-protection-contract';
import type { RestoreSessionView } from '../../shared/workspace-protection-contract';
/**
 * Returns the deterministic operation directory.
 * @param {string} activityControlRoot - Stable control root.
 * @param {string} operationId - Canonical operation identity.
 * @return {string} Private operation path.
 */
export function operationDirectory(activityControlRoot: string, operationId: string): string {
    return path.join(activityControlRoot, RESTORE_DIRECTORY_NAME, operationId);
}

/**
 * Rejects unknown or non-plain entries at the operation control boundary.
 * @param {string} activityControlRoot - Stable control root.
 * @param {string} operationId - Canonical operation identity.
 * @return {void}
 */
export function requireOperationControlClosure(
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
export function slotName(
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
export function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
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
export function requireJsonBounds(value: unknown, depth = 0): void {
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
export function parseCanonicalJson(bytes: Buffer, maximumBytes: number): unknown {
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
export function digestWithout(value: Record<string, unknown>, digestField: string): string {
    const copy = {...value};
    delete copy[digestField];
    return createHash('sha256').update(canonicalJson(copy), 'utf8').digest('hex');
}

/**
 * Requires a canonical positive integer string.
 * @param {unknown} value - Candidate sequence.
 * @return {value is string} Whether it is positive and canonical.
 */
export function isPositiveInteger(value: unknown): value is string {
    return typeof value === 'string'
        && isCanonicalUnsignedSqliteInteger(value)
        && value !== '0';
}

/**
 * Returns a deterministic timestamp from the injected or system clock.
 * @param {RestoreActivationOptions} options - Activation options.
 * @return {string} Canonical instant.
 */
export function now(options: RestoreActivationOptions): string {
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
export function fail(options: RestoreActivationOptions, point: string): void {
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
export function publishCanonicalFile(
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
export function requireSessionRecord(value: unknown): SessionControlRecord {
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
export function readSessionRecords(directoryPath: string): readonly SessionControlRecord[] {
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
 * Reads the last validated pre-checkpoint session record for one operation.
 * @param {string} activityControlRoot - Stable control root.
 * @param {string} operationId - Canonical operation identity.
 * @return {SessionControlRecord | null} Latest record or null.
 */
export function latestSessionRecord(
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
 * Validates one immutable ActivationPlanV1 including private location binding.
 * @param {unknown} value - Parsed plan.
 * @param {string} activityControlRoot - Stable control root.
 * @param {string} dataSlotsRoot - Trusted DataSlots parent.
 * @param {string} operationId - Expected operation identity.
 * @return {ActivationPlanV1} Strict validated plan.
 */
export function requirePlan(
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
export function readPlan(
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
export function requireJournalRecord(
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
export function requireJournalTransitions(records: readonly ActivationJournalRecord[]): void {
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
export function readJournal(
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
export function appendJournal(
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
 * Requires one session-bound action command at the expected logical version.
 * @param {RestoreSessionActionCommand} command - Path-free action command.
 * @param {RestoreSessionView} session - Frozen session identity.
 * @param {string} expectedVersion - Required logical version.
 * @return {void}
 */
export function requireActionCommand(
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
export function recordActionCommand(
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
