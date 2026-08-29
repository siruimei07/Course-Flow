import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { ensureSnapshotStagingDirectory, plainChildDirectoryExists, publishSnapshotDirectory } from '../../platform/backup-snapshot-files';
import { observeRestoreDataSlot, renameRestoreDataSlot, requireRestoreSameVolume } from '../../platform/restore-activation-files';
import { inspectRestoreBeforeWorkspaceOpen } from '../durable-backup';
import { MigrationRollbackHandoffError, MigrationRollbackHandoffFacts } from '../migration-rollback-handoff';
import type { MigrationRollbackBootState, MigrationRollbackDataIdentity } from '../migration-rollback-handoff';
import { derivePhase, observeLostResponse, observePhysical, physicalStates, statusFrom, terminalReceiptDigest, versionForPhase } from './evidence';
import { ACTIVE_SLOT_NAME, JOURNAL_DIRECTORY_NAME, MIGRATION_ROLLBACK_DIRECTORY_NAME, TOTAL_RECORD_LIMIT } from './protocol';
import type { HandoffRecord, MigrationRollbackBaseCompletionCallbacks, MigrationRollbackCommand, MigrationRollbackHandoffOptions, MigrationRollbackSafetyStagingPort, MigrationRollbackStatus, MigrationRollbackTargetCompletionCallbacks, NonterminalMigrationRollbackInspection, PhysicalEvidence, TerminalPhase } from './protocol';
import { appendRecord, fail, findRecordsForSession, hasExactKeys, isBoundedIdentity, operationDirectory, publishInitialRecord, readOperations, readRecords, requireHandoffFacts, requireTemporaryOperationEvidence, sameEvidence, slotName } from './records';
import { canonicalJson } from '../../shared/canonical-json';
import { isCanonicalUnsignedSqliteInteger, isCanonicalUuid } from '../../shared/workspace-data-contract';
/**
 * Rejects a new CommandId or opposite direction after a completion branch is durable.
 * @param {readonly HandoffRecord[]} records - Current validated chain.
 * @param {'command-continue' | 'command-cancel'} requestedKind - Requested branch.
 * @param {string} commandId - Requested command identity.
 * @return {void}
 */
export function requireAvailableCommandBranch(
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
export function recordCommand(
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
export function executeRename(input: Readonly<{
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
export async function runCompletionCallbacks(
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
export function inspectNonterminalMigrationRollbackIgnoringTemporary(
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
