import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { listPlainDirectory, plainChildDirectoryExists, plainFileExists, publishBackupMember, readBoundedPlainFile, syncPlainFile } from '../../platform/backup-snapshot-files';
import { MigrationRollbackHandoffFacts } from '../migration-rollback-handoff';
import { physicalStates, terminalReceiptDigest } from './evidence';
import { DIGEST_PATTERN, JOURNAL_DIRECTORY_NAME, LIMITS_VERSION, MAXIMUM_JSON_DEPTH, MAXIMUM_JSON_STRING_LENGTH, MIGRATION_ROLLBACK_DIRECTORY_NAME, RECORD_KINDS, RECORD_MAXIMUM_BYTES, RECORD_SCHEMA, TEMPORARY_PUBLICATION_NAME, TOTAL_RECORD_LIMIT } from './protocol';
import type { CommandEvidence, HandoffRecord, MigrationRollbackHandoffOptions, NonterminalPhase, PhysicalEvidence, RecordKind, SlotState, TerminalPhase } from './protocol';
import { canonicalJson } from '../../shared/canonical-json';
import { isCanonicalUnsignedSqliteInteger, isCanonicalUuid } from '../../shared/workspace-data-contract';
export function recordPhase(kind: RecordKind): NonterminalPhase | TerminalPhase {
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

export function allowedActors(
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
 * Compares bounded evidence canonically.
 * @param {unknown} left - First evidence value.
 * @param {unknown} right - Second evidence value.
 * @return {boolean} Whether both values encode identically.
 */
export function sameEvidence(left: unknown, right: unknown): boolean {
    return canonicalJson(left) === canonicalJson(right);
}

/**
 * Computes a canonical digest with one named field omitted.
 * @param {Record<string, unknown>} value - Complete canonical object.
 * @param {string} digestField - Field omitted from digest input.
 * @return {string} Lowercase SHA-256 digest.
 */
export function digestWithout(value: Record<string, unknown>, digestField: string): string {
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
export function requireJsonBounds(value: unknown, depth = 0): void {
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
export function parseCanonicalRecord(bytes: Buffer): unknown {
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
export function isBoundedIdentity(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 255;
}

/**
 * Validates immutable handoff facts.
 * @param {unknown} value - Candidate facts.
 * @return {MigrationRollbackHandoffFacts} Strict facts.
 */
export function requireHandoffFacts(value: unknown): MigrationRollbackHandoffFacts {
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

export function fingerprintForMember(byteLength: string, digest: string): string {
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
export function operationDirectory(activityControlRoot: string, operationId: string): string {
    return path.join(activityControlRoot, MIGRATION_ROLLBACK_DIRECTORY_NAME, operationId);
}

/**
 * Returns one deterministic operation-owned DATA sibling name.
 * @param {'candidate' | 'rollback' | 'quarantine'} role - Physical sibling role.
 * @param {string} operationId - Canonical operation identity.
 * @return {string} Direct-child slot name.
 */
export function slotName(
    role: 'candidate' | 'rollback' | 'quarantine',
    operationId: string,
): string {
    return `.migration-rollback-${role}-${operationId}`;
}

/**
 * Requires one exact path-free slot state.
 * @param {unknown} value - Candidate slot state.
 * @return {boolean} Whether the slot state is closed and valid.
 */
export function isSlotState(value: unknown): value is SlotState {
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
export function isPhysicalEvidence(value: unknown): value is PhysicalEvidence {
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
export function isCommandEvidence(value: unknown): value is CommandEvidence {
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
export function requireRecordEvidence(record: HandoffRecord): void {
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
export function requireRecord(value: unknown): HandoffRecord {
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
export function requireTransitions(records: readonly HandoffRecord[]): void {
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
export function requireOperationClosure(activityControlRoot: string, operationId: string): void {
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
export function readRecords(
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
export function fail(options: MigrationRollbackHandoffOptions, point: string): void {
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
export function publishRecord(
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
export function appendRecord(
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
export function publishInitialRecord(
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
export function requireTemporaryOperationEvidence(
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
export function readOperations(
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
export function findRecordsForSession(
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
