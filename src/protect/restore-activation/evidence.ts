import { CURRENT_SCHEMA_LEVEL } from '../../data/schema';
import { inspectRestoreCompletionReceipt } from '../../data/store/open';
import { observeRestoreDataSlot } from '../../platform/restore-activation-files';
import type { RestoreDataSlotObservation } from '../../platform/restore-activation-files';
import { inspectRestoreBeforeWorkspaceOpen } from '../restore-activation';
import type { RestoreTerminalEvidence } from '../restore-activation';
import { reconcileCompletionReceipt } from './activation';
import { ACTIVE_SLOT_NAME, DIGEST_PATTERN } from './protocol';
import type { ActivationJournalRecord, ActivationPlanV1, BeginRestoreActivationInput, DatabaseEvidence, RestoreActivationOptions, SlotState } from './protocol';
import { appendJournal, hasExactKeys, readJournal, readPlan, slotName } from './records';
import { canonicalJson } from '../../shared/canonical-json';
import { isCanonicalUuid } from '../../shared/workspace-data-contract';
/**
 * Converts a PLATFORM slot observation to bounded journal evidence.
 * @param {RestoreDataSlotObservation} observation - Fresh physical observation.
 * @return {SlotState} Path-free fingerprint state.
 */
export function slotState(observation: RestoreDataSlotObservation): SlotState {
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
export function observeDatabaseEvidence(
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
export function sameEvidence(left: unknown, right: unknown): boolean {
    return canonicalJson(left) === canonicalJson(right);
}

/**
 * Tests one bounded predecessor terminal reference.
 * @param {unknown} value - Candidate terminal evidence.
 * @param {string} operationId - Current operation that must not reference itself.
 * @return {value is RestoreTerminalEvidence} Whether the predecessor evidence is exact.
 */
export function isRestoreTerminalEvidence(
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
 * Returns the expected database evidence at the three forward activation boundaries.
 * @param {ActivationPlanV1} plan - Bound activation plan.
 * @return {Readonly<object>} Before, retired, and installed evidence.
 */
export function forwardEvidence(plan: ActivationPlanV1): Readonly<{
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
export function rollbackEvidence(plan: ActivationPlanV1): Readonly<{
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
export function reopenedDataEvidence(workspaceId: string, revision: string): Readonly<{
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
export function requireJournalEvidence(
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
export function observeLostActionResponse(
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
 * Reconstructs the exact terminal head from its DATA receipt and last external record.
 * @param {string} dataSlotsRoot - Trusted DataSlots parent.
 * @param {ActivationPlanV1} plan - Bound activation plan.
 * @param {readonly ActivationJournalRecord[]} records - Validated external chain.
 * @param {'succeeded' | 'rolled-back'} outcome - Proven terminal outcome.
 * @return {RestoreTerminalEvidence} Exact predecessor evidence for a later Restore.
 */
export function terminalEvidence(
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
export function requirePreviousTerminal(
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
