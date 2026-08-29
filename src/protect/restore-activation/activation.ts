import path from 'node:path';
import { createHash } from 'node:crypto';
import { SqliteDataStore } from '../../data/store/kernel';
import { inspectRestoreCompletionReceipt, inspectRestoreDataSlot, openWorkspaceData } from '../../data/store/open';
import { RestoreCompletionReceiptInput } from '../../data/store/types';
import { listPlainDirectory, plainChildDirectoryExists, plainFileExists } from '../../platform/backup-snapshot-files';
import { observeRestoreDataSlot, renameRestoreDataSlot, requireRestoreSameVolume, stageRestoreDataSlot } from '../../platform/restore-activation-files';
import { RestoreActivationError } from '../restore-activation';
import type { RestoreBootState, RestoreTerminalEvidence } from '../restore-activation';
import { forwardEvidence, observeDatabaseEvidence, observeLostActionResponse, reopenedDataEvidence, requirePreviousTerminal, rollbackEvidence, sameEvidence, terminalEvidence } from './evidence';
import { ACTIVE_SLOT_NAME, CANONICAL_ENCODING, DIGEST_PATTERN, JOURNAL_DIRECTORY_NAME, LIMITS_VERSION, PLAN_FILE_NAME, PLAN_MAXIMUM_BYTES, PLAN_SCHEMA, RECORD_MAXIMUM_BYTES, RESTORE_DIRECTORY_NAME, SESSION_DIRECTORY_NAME, SESSION_SCHEMA, TOTAL_RECORD_LIMIT } from './protocol';
import type { ActivationJournalRecord, ActivationPlanV1, BeginRestoreActivationInput, DatabaseEvidence, JournalKind, RestoreActivationOptions, RestoreActivationResult, SessionControlRecord } from './protocol';
import { appendJournal, fail, latestSessionRecord, now, operationDirectory, publishCanonicalFile, readJournal, readPlan, readSessionRecords, recordActionCommand, requireActionCommand, requireOperationControlClosure, slotName } from './records';
import { canonicalJson } from '../../shared/canonical-json';
import { isCanonicalUuid } from '../../shared/workspace-data-contract';
import { RestoreSessionActionCommand, isRestoreSessionView } from '../../shared/workspace-protection-contract';
import type { RestoreSessionView } from '../../shared/workspace-protection-contract';
/**
 * Builds a recovery or terminal public session from frozen pre-checkpoint evidence.
 * @param {RestoreSessionView} base - Last pre-checkpoint public view.
 * @param {'recovery-required' | 'succeeded' | 'rolled-back'} phase - Public phase.
 * @param {readonly ('resume' | 'rollback')[]} actions - Evidence-supported actions.
 * @param {'activation-pending' | 'rollback-required' | 'recovery-required' | null} problem - Public code.
 * @return {RestoreSessionView} Exact path-free session view.
 */
export function activationView(
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
 * Creates and publishes the immutable A-only activation plan.
 * @param {BeginRestoreActivationInput} input - Validated pre-checkpoint facts.
 * @param {string} oldSlotFingerprint - Closed old active slot fingerprint.
 * @param {string} candidateSlotFingerprint - Closed candidate sibling fingerprint.
 * @param {string} sessionDigest - Last pre-checkpoint session digest.
 * @param {RestoreActivationOptions} options - Clock and failpoints.
 * @return {ActivationPlanV1} Reopened validated plan.
 */
export function createActivationPlan(
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
 * Executes one intent-bound rename and appends a freshly verified observed record.
 * @param {object} input - Complete physical action facts.
 * @return {void}
 */
export function executeRename(input: Readonly<{
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
export function routeAfterReopen(store: SqliteDataStore): 'setup' | 'today' {
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
export function completionReceiptInput(
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
 * Runs the A-only forward activation from any uniquely evidenced post-checkpoint state.
 * @param {string} activityControlRoot - Stable control root.
 * @param {string} dataSlotsRoot - Trusted DataSlots parent.
 * @param {ActivationPlanV1} plan - Bound activation plan.
 * @param {RestoreSessionView} baseSession - Frozen pre-checkpoint public view.
 * @param {RestoreActivationOptions} options - Clock and failpoints.
 * @return {Promise<RestoreActivationResult>} Reopened candidate store and terminal view.
 */
export async function runForward(
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
 * Finds the one immutable activation plan bound to a RestoreSessionId.
 * @param {string} activityControlRoot - Stable control root.
 * @param {string} dataSlotsRoot - Trusted DataSlots parent.
 * @param {string} restoreSessionId - Canonical session identity.
 * @return {ActivationPlanV1} Unique validated plan.
 */
export function findPlanForSession(
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
export function reopenExpectedData(
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
 * Derives currently safe recovery actions from exact slot fingerprints.
 * @param {ActivationPlanV1} plan - Bound activation plan.
 * @param {DatabaseEvidence} evidence - Fresh physical evidence.
 * @param {readonly ActivationJournalRecord[]} records - Validated coordination prefix.
 * @return {readonly ('resume' | 'rollback')[]} Safe action subset.
 */
export function recoveryActions(
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
export function reconcileCompletionReceipt(
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
