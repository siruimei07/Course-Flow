import { CURRENT_SCHEMA_LEVEL, SchemaValidationError } from '../schema';
import type { DataOpenResult } from '../sqlite-data-store';
import { SQLITE_VERSION, primarySqliteCode } from './database';
import type { CurrentVersions } from './guards';
import type { CommandReceiptOutcome, ConflictReason, DataCommitResult, DataOpenProblem, ReceiptEffect, SetupDraftCheckpointWriteResult } from './types';
import type { MeetingOverlapWarning } from '../../shared/workspace-course-contract';

export function freezeTuple<T>(value: [T]): readonly [T] {
    return Object.freeze(value);
}

export function freezeEmptyTuple(): readonly [] {
    return Object.freeze([]);
}

export function freezePair<T, U>(value: [T, U]): readonly [T, U] {
    return Object.freeze(value);
}

export function committedOutcome(
    revision: bigint,
    effectCode: ReceiptEffect['code'],
    entityKind: ReceiptEffect['entity']['kind'],
    entityId: string,
    entityVersion: bigint,
    followUpId: string,
): CommandReceiptOutcome {
    const entity = Object.freeze({
        kind: entityKind,
        id: entityId,
        version: entityVersion.toString(),
    });
    const effect = Object.freeze({
        code: effectCode,
        entity,
    });
    return Object.freeze({
        kind: 'committed' as const,
        revision: revision.toString(),
        effects: freezeTuple([effect]),
        pendingFollowUps: freezeTuple([followUpId]),
    });
}

export function successfulCommit(value: CommandReceiptOutcome): DataCommitResult {
    return Object.freeze({ ok: true as const, value });
}

export function conflictResult(
    reason: ConflictReason,
    workspaceId: string,
    versions: CurrentVersions,
): DataCommitResult {
    const entityVersion = Object.freeze({
        kind: 'workspace-setup' as const,
        id: workspaceId,
        version: versions.setupVersion.toString(),
    });
    const context = Object.freeze({
        revision: versions.revision.toString(),
        entityVersions: freezeTuple([entityVersion]),
    });
    const problem = Object.freeze({
        code: 'conflict' as const,
        scope: 'operation' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezeTuple(['workspace.write' as const]),
        allowedActions: freezeTuple(['requery' as const]),
        context,
        details: Object.freeze({ reason }),
    });
    return Object.freeze({ ok: false as const, problem });
}

export function committedPairOutcome(
    revision: bigint,
    first: ReceiptEffect,
    second: ReceiptEffect,
    followUpId: string,
): CommandReceiptOutcome {
    return Object.freeze({
        kind: 'committed' as const,
        revision: revision.toString(),
        effects: freezePair([first, second]),
        pendingFollowUps: freezeTuple([followUpId]),
    });
}

export function planConflictResult(reason: ConflictReason, versions: CurrentVersions): DataCommitResult {
    const entityVersion = Object.freeze({
        kind: 'plan-state' as const,
        id: 'singleton',
        version: versions.planVersion.toString(),
    });
    const context = Object.freeze({
        revision: versions.revision.toString(),
        entityVersions: freezeTuple([entityVersion]),
    });
    const problem = Object.freeze({
        code: 'conflict' as const,
        scope: 'operation' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezeTuple(['workspace.write' as const]),
        allowedActions: freezeTuple(['requery' as const]),
        context,
        details: Object.freeze({ reason }),
    });
    return Object.freeze({ ok: false as const, problem });
}

export function protectionConflictResult(
    reason: ConflictReason,
    workspaceId: string,
    versions: CurrentVersions,
): DataCommitResult {
    const entityVersion = Object.freeze({
        kind: 'backup-configuration' as const,
        id: workspaceId,
        version: versions.protectionVersion.toString(),
    });
    const problem = Object.freeze({
        code: 'conflict' as const,
        scope: 'operation' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezeTuple(['workspace.write' as const]),
        allowedActions: freezeTuple(['requery' as const]),
        context: Object.freeze({
            revision: versions.revision.toString(),
            entityVersions: freezeTuple([entityVersion]),
        }),
        details: Object.freeze({ reason }),
    });
    return Object.freeze({ ok: false as const, problem });
}

/**
 * Builds a conflict problem carrying the authoritative Meeting series version.
 * @param {ConflictReason} reason - Stable conflict reason.
 * @param {CurrentVersions} versions - Current Workspace and PLAN versions.
 * @param {string} meetingSeriesId - Conflicted Meeting series identity.
 * @param {bigint} meetingSeriesVersion - Current Meeting series version.
 * @return {DataCommitResult} Unchanged conflict result.
 */
export function meetingSeriesConflictResult(
    reason: ConflictReason,
    versions: CurrentVersions,
    meetingSeriesId: string,
    meetingSeriesVersion: bigint,
): DataCommitResult {
    const entityVersion = Object.freeze({
        kind: 'meeting-series' as const,
        id: meetingSeriesId,
        version: meetingSeriesVersion.toString(),
    });
    const problem = Object.freeze({
        code: 'conflict' as const,
        scope: 'operation' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezeTuple(['workspace.write' as const]),
        allowedActions: freezeTuple(['requery' as const]),
        context: Object.freeze({
            revision: versions.revision.toString(),
            entityVersions: freezeTuple([entityVersion]),
        }),
        details: Object.freeze({ reason }),
    });
    return Object.freeze({ ok: false as const, problem });
}

/**
 * Builds a stale-version conflict carrying the authoritative HolidayRange revision.
 * @param {CurrentVersions} versions - Current Workspace and PLAN versions.
 * @param {string} holidayRangeId - Conflicted HolidayRange identity.
 * @param {bigint} holidayRangeVersion - Current HolidayRange entity version.
 * @return {DataCommitResult} Unchanged conflict result.
 */
export function holidayRangeConflictResult(
    versions: CurrentVersions,
    holidayRangeId: string,
    holidayRangeVersion: bigint,
): DataCommitResult {
    const entityVersion = Object.freeze({
        kind: 'holiday-range' as const,
        id: holidayRangeId,
        version: holidayRangeVersion.toString(),
    });
    const problem = Object.freeze({
        code: 'conflict' as const,
        scope: 'operation' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezeTuple(['workspace.write' as const]),
        allowedActions: freezeTuple(['requery' as const]),
        context: Object.freeze({
            revision: versions.revision.toString(),
            entityVersions: freezeTuple([entityVersion]),
        }),
        details: Object.freeze({ reason: 'expected-entity-version' as const }),
    });
    return Object.freeze({ ok: false as const, problem });
}

export function taskSeriesConflictResult(
    versions: CurrentVersions,
    taskSeriesId: string,
    taskSeriesVersion: bigint,
): DataCommitResult {
    const entityVersion = Object.freeze({
        kind: 'task-series' as const,
        id: taskSeriesId,
        version: taskSeriesVersion.toString(),
    });
    const problem = Object.freeze({
        code: 'conflict' as const,
        scope: 'operation' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezeTuple(['workspace.write' as const]),
        allowedActions: freezeTuple(['requery' as const]),
        context: Object.freeze({
            revision: versions.revision.toString(),
            entityVersions: freezeTuple([entityVersion]),
        }),
        details: Object.freeze({ reason: 'expected-entity-version' as const }),
    });
    return Object.freeze({ ok: false as const, problem });
}

export function writerBusyResult(revision: bigint): DataCommitResult {
    const problem = Object.freeze({
        code: 'operation-in-progress' as const,
        scope: 'operation' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezeTuple(['workspace.write' as const]),
        allowedActions: freezeTuple(['retry' as const]),
        context: Object.freeze({ revision: revision.toString() }),
        details: Object.freeze({ reason: 'writer-busy' as const }),
    });
    return Object.freeze({ ok: false as const, problem });
}

export function permissionProblem(): DataOpenProblem {
    return Object.freeze({
        code: 'permission' as const,
        scope: 'workspace' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezeTuple(['workspace.write' as const]),
        allowedActions: freezeEmptyTuple(),
        context: Object.freeze({}),
        details: Object.freeze({ reason: 'read-only' as const }),
    });
}

export function permissionCommitResult(revision: bigint): DataCommitResult {
    const problem = Object.freeze({
        code: 'permission' as const,
        scope: 'workspace' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezeTuple(['workspace.write' as const]),
        allowedActions: freezeEmptyTuple(),
        context: Object.freeze({ revision: revision.toString() }),
        details: Object.freeze({ reason: 'read-only' as const }),
    });
    return Object.freeze({ ok: false as const, problem });
}

/**
 * Reports the authoritative draft-stream version after an optimistic conflict.
 * @param {string} workspaceId - Stable Workspace identity.
 * @param {bigint} revision - Unchanged formal Workspace revision.
 * @param {bigint} draftVersion - Current setup draft version.
 * @return {SetupDraftCheckpointWriteResult} Unchanged conflict result.
 */
export function setupDraftConflictResult(
    workspaceId: string,
    revision: bigint,
    draftVersion: bigint,
): SetupDraftCheckpointWriteResult {
    const problem = Object.freeze({
        code: 'conflict' as const,
        scope: 'operation' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezeTuple(['workspace.write' as const]),
        allowedActions: freezeTuple(['requery' as const]),
        context: Object.freeze({
            revision: revision.toString(),
            entityVersions: freezeTuple([Object.freeze({
                kind: 'workspace-setup' as const,
                id: workspaceId,
                version: draftVersion.toString(),
            })]),
        }),
        details: Object.freeze({ reason: 'expected-entity-version' as const }),
    });
    return Object.freeze({ ok: false as const, problem });
}

/**
 * Reports a saturated Workspace write queue without changing the draft.
 * @param {bigint} revision - Unchanged formal Workspace revision.
 * @return {SetupDraftCheckpointWriteResult} Retryable unchanged result.
 */
export function setupDraftWriterBusyResult(revision: bigint): SetupDraftCheckpointWriteResult {
    const problem = Object.freeze({
        code: 'operation-in-progress' as const,
        scope: 'operation' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezeTuple(['workspace.write' as const]),
        allowedActions: freezeTuple(['retry' as const]),
        context: Object.freeze({ revision: revision.toString() }),
        details: Object.freeze({ reason: 'writer-busy' as const }),
    });
    return Object.freeze({ ok: false as const, problem });
}

/**
 * Reports that the open Workspace mode cannot persist a setup draft.
 * @param {bigint} revision - Unchanged formal Workspace revision.
 * @return {SetupDraftCheckpointWriteResult} Permission result.
 */
export function setupDraftPermissionResult(revision: bigint): SetupDraftCheckpointWriteResult {
    const problem = Object.freeze({
        code: 'permission' as const,
        scope: 'workspace' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezeTuple(['workspace.write' as const]),
        allowedActions: freezeEmptyTuple(),
        context: Object.freeze({ revision: revision.toString() }),
        details: Object.freeze({ reason: 'read-only' as const }),
    });
    return Object.freeze({ ok: false as const, problem });
}

/**
 * Builds an unchanged result requiring a fresh whole-rule impact preview.
 * @param {bigint} revision - Current Workspace revision.
 * @return {DataCommitResult} Decision-required result.
 */
export function decisionRequiredResult(revision: bigint): DataCommitResult {
    const problem = Object.freeze({
        code: 'decision-required' as const,
        scope: 'operation' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezeTuple(['workspace.write' as const]),
        allowedActions: freezeTuple(['preview' as const]),
        context: Object.freeze({ revision: revision.toString() }),
        details: Object.freeze({ reason: 'impact-confirmation-required' as const }),
    });
    return Object.freeze({ ok: false as const, problem });
}

/**
 * Builds an unchanged warning result that can be explicitly continued.
 * @param {bigint} revision - Current Workspace revision.
 * @param {readonly MeetingOverlapWarning[]} warnings - Exact overlapping occurrences and windows.
 * @return {DataCommitResult} Non-blocking overlap decision result.
 */
export function meetingOverlapDecisionRequiredResult(
    revision: bigint,
    warnings: readonly MeetingOverlapWarning[],
): DataCommitResult {
    const problem = Object.freeze({
        code: 'decision-required' as const,
        scope: 'operation' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezeTuple(['workspace.write' as const]),
        allowedActions: freezeTuple(['continue' as const]),
        context: Object.freeze({ revision: revision.toString() }),
        details: Object.freeze({
            reason: 'meeting-time-overlap' as const,
            warnings: Object.freeze([...warnings]),
        }),
    });
    return Object.freeze({ ok: false as const, problem });
}

export function incompatibleVersionProblem(actualSchemaLevel: number): DataOpenProblem {
    return Object.freeze({
        code: 'incompatible-version' as const,
        scope: 'workspace' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezePair(['workspace.read' as const, 'workspace.write' as const]),
        allowedActions: freezeEmptyTuple(),
        context: Object.freeze({}),
        details: Object.freeze({
            actualSchemaLevel,
            requiredSchemaLevel: CURRENT_SCHEMA_LEVEL,
        }),
    });
}

export function integrityProblem(
    reason: 'wrong-application-id' | 'nonempty-level-zero' | 'schema-mismatch' | 'database-corrupt',
): DataOpenProblem {
    return Object.freeze({
        code: 'integrity' as const,
        scope: 'workspace' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezePair(['workspace.read' as const, 'workspace.write' as const]),
        allowedActions: freezeEmptyTuple(),
        context: Object.freeze({}),
        details: Object.freeze({ reason }),
    });
}

export function databaseUnreadableProblem(): DataOpenProblem {
    return Object.freeze({
        code: 'recovery-required' as const,
        scope: 'workspace' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezePair(['workspace.read' as const, 'workspace.write' as const]),
        allowedActions: freezeEmptyTuple(),
        context: Object.freeze({}),
        details: Object.freeze({ reason: 'database-unreadable' as const }),
    });
}

export function migrationSafetyUnavailableProblem(): DataOpenProblem {
    return Object.freeze({
        code: 'migration-safety-unavailable' as const,
        scope: 'workspace' as const,
        dataEffect: 'unchanged' as const,
        affectedCapabilities: freezePair(['workspace.read' as const, 'workspace.write' as const]),
        allowedActions: freezeEmptyTuple(),
        context: Object.freeze({}),
        details: Object.freeze({reason: 'build-binding-missing' as const}),
    });
}

export function recoveryResult(problem: DataOpenProblem): DataOpenResult {
    return Object.freeze({
        kind: 'recovery' as const,
        sqliteVersion: SQLITE_VERSION,
        problem,
    });
}

export function unreadableOpenProblem(error: unknown): DataOpenProblem {
    const primaryCode = primarySqliteCode(error);
    if (primaryCode === 11 || primaryCode === 26) {
        return integrityProblem('database-corrupt');
    }
    return databaseUnreadableProblem();
}

export function validationProblem(error: unknown): DataOpenProblem {
    if (error instanceof SchemaValidationError) {
        return integrityProblem(error.reason);
    }
    return unreadableOpenProblem(error);
}
