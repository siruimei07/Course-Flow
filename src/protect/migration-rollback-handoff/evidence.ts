import { createHash } from 'node:crypto';
import { observeRestoreDataSlot } from '../../platform/restore-activation-files';
import type { RestoreDataSlotObservation } from '../../platform/restore-activation-files';
import { MigrationRollbackHandoffFacts } from '../migration-rollback-handoff';
import { ACTIVE_SLOT_NAME } from './protocol';
import type { AllowedAction, BuildClassification, HandoffRecord, MigrationRollbackHandoffOptions, MigrationRollbackStatus, NonterminalPhase, PhysicalEvidence, SlotState, TerminalPhase } from './protocol';
import { appendRecord, fingerprintForMember, readRecords, sameEvidence, slotName } from './records';
import { canonicalJson } from '../../shared/canonical-json';
/**
 * Converts a PLATFORM observation to path-free evidence.
 * @param {RestoreDataSlotObservation} observation - Fresh slot observation.
 * @return {SlotState} Closed path-free slot state.
 */
export function slotState(observation: RestoreDataSlotObservation): SlotState {
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
export function observePhysical(dataSlotsRoot: string, operationId: string): PhysicalEvidence {
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
export function physicalStates(facts: MigrationRollbackHandoffFacts): Readonly<{
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
 * Derives the public phase from durable evidence.
 * @param {readonly HandoffRecord[]} records - Validated operation chain.
 * @param {PhysicalEvidence} observed - Fresh physical evidence.
 * @return {NonterminalPhase | TerminalPhase} Proven phase.
 */
export function derivePhase(
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
export function versionForPhase(phase: NonterminalPhase | TerminalPhase): string {
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
export function classifyBuild(
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
export function statusFrom(
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
export function observeLostResponse(
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
 * Derives a path-free terminal receipt digest from the completed gates.
 * @param {MigrationRollbackHandoffFacts} handoff - Immutable operation facts.
 * @param {TerminalPhase} outcome - Completed direction.
 * @return {string} Canonical terminal receipt digest.
 */
export function terminalReceiptDigest(
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
