/**
 * @file Defines Term facts, lifecycle commands, and explicit-zone date evaluation.
 */

import type { CanonicalValue } from './canonical-json';
import type { CourseProjection } from './workspace-course-contract';
import type { HolidayRangeProjection } from './workspace-holiday-contract';
import type { TaskProjection } from './workspace-task-contract';
import {
    isCanonicalUnsignedSqliteInteger,
    isCanonicalUuid,
} from './workspace-data-contract';

export type TermProjection = Readonly<{
    termId: string;
    name: string;
    startDate: string;
    endDate: string;
    timeZone: string;
    archived: boolean;
    entityVersion: string;
}>;

export const SETUP_DRAFT_SCHEMA_VERSION = 1;
export const MAX_SETUP_DRAFT_PAYLOAD_BYTES = 65_536;

export type SetupDraftCheckpoint = Readonly<{
    draftId: 'first-setup';
    kind: 'first-setup';
    scope: 'setup-step';
    schemaVersion: typeof SETUP_DRAFT_SCHEMA_VERSION;
    updatedAt: string;
    opaquePayload: string;
}>;

export type SetupMinimumProjection = Readonly<{
    hasCurrentTerm: boolean;
    hasCurrentTermCourse: boolean;
    hasMeetingOrTask: boolean;
    isSatisfied: boolean;
}>;

export type SetupProjection = Readonly<{
    workspaceRevision: string;
    planEntityVersion: string;
    minimum: SetupMinimumProjection;
    everReachedMinimum: boolean;
    defaultRoute: 'setup' | 'today';
    draftCheckpointVersion: string;
    draftCheckpoint: SetupDraftCheckpoint | null;
    currentTerm: TermProjection | null;
    terms: readonly TermProjection[];
    courses: readonly CourseProjection[];
    holidayRanges: readonly HolidayRangeProjection[];
    tasks: readonly TaskProjection[];
}>;

export type CreateTermCommand = Readonly<{
    commandId: string;
    followUpId: string;
    expectedRevision: string;
    expectedPlanVersion: string;
    intent: Readonly<{
        kind: 'plan.create-term';
        intentSchemaVersion: 1;
        payload: Readonly<{
            name: string;
            startDate: string;
            endDate: string;
            timeZone: string;
        }>;
    }>;
}>;

export type TermEvaluation = Readonly<{
    evaluatedAt: string;
    termZone: string;
    applicableDate: string;
}>;

type TermMutationCommandBase = Readonly<{
    commandId: string;
    followUpId: string;
    expectedRevision: string;
    expectedPlanVersion: string;
    expectedTermVersion: string;
}>;

export type ReconcileWorkspaceLifecycleCommand = TermMutationCommandBase & Readonly<{
    intent: Readonly<{
        kind: 'workspace.reconcile-lifecycle';
        intentSchemaVersion: 1;
        payload: Readonly<{
            termId: string;
            evaluation: TermEvaluation;
        }>;
    }>;
}>;

export type UpdateTermEndDateCommand = TermMutationCommandBase & Readonly<{
    intent: Readonly<{
        kind: 'plan.update-term-end-date';
        intentSchemaVersion: 1;
        payload: Readonly<{
            termId: string;
            endDate: string;
        }>;
    }>;
}>;

export type RestoreTermAsCurrentCommand = TermMutationCommandBase & Readonly<{
    evaluation: TermEvaluation;
    intent: Readonly<{
        kind: 'plan.restore-term-as-current';
        intentSchemaVersion: 1;
        payload: Readonly<{ termId: string }>;
    }>;
}>;

export type ResetCurrentTermCommand = TermMutationCommandBase & Readonly<{
    intent: Readonly<{
        kind: 'plan.reset-current-term';
        intentSchemaVersion: 1;
        payload: Readonly<{
            termId: string;
            /** Exact Term name the user retyped; DATA refuses a mismatch. */
            confirmedTermName: string;
        }>;
    }>;
}>;

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_TERM_NAME_LENGTH = 120;

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function hasExactDataKeys(value: unknown, expectedKeys: readonly string[]): value is Record<string, unknown> {
    if (!isPlainObject(value)) {
        return false;
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key === 'symbol') || keys.length !== expectedKeys.length) {
        return false;
    }

    return expectedKeys.every((key) => {
        const descriptor = descriptors[key];
        return descriptor !== undefined
            && 'value' in descriptor
            && descriptor.enumerable
            && expectedKeys.includes(key);
    });
}

export function isCanonicalLocalDate(value: unknown): value is string {
    if (typeof value !== 'string') {
        return false;
    }

    const match = LOCAL_DATE_PATTERN.exec(value);
    if (!match) {
        return false;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(year, month - 1, day);
    return date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day;
}

/** ponytail: Keep only the latest explicit zone; revisit if concurrent multi-zone views need reuse. */
let recentTermZone: {
    input: string;
    canonicalZone: string;
    formatter: Intl.DateTimeFormat;
} | null = null;

/**
 * Reuses date formatting only after validating an explicit time zone.
 * @param {unknown} value - Candidate explicit IANA zone identity.
 * @return {Object | null} Validated zone and formatter, or null for an invalid zone.
 */
function termZoneFormatting(value: unknown): typeof recentTermZone {
    if (typeof value !== 'string' || value.length === 0) {
        return null;
    }
    if (recentTermZone !== null
        && (value === recentTermZone.input || value === recentTermZone.canonicalZone)) {
        return recentTermZone;
    }

    try {
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: value,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
        recentTermZone = {input: value, canonicalZone: formatter.resolvedOptions().timeZone, formatter};
        return recentTermZone;
    }
    catch {
        return null;
    }
}

function canonicalTimeZone(value: unknown): string | null {
    return termZoneFormatting(value)?.canonicalZone ?? null;
}

/**
 * Converts an Instant to its calendar date using only the explicit TermZone.
 */
export function localDateInTermZone(evaluatedAt: string, termZone: string): string {
    const zoneFormatting = termZoneFormatting(termZone);
    if (!INSTANT_PATTERN.test(evaluatedAt)
        || new Date(evaluatedAt).toISOString() !== evaluatedAt
        || zoneFormatting === null) {
        throw new TypeError('Term evaluation has invalid time values');
    }

    const parts = zoneFormatting.formatter.formatToParts(new Date(evaluatedAt));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

/**
 * Validates that an EvaluationContext date was derived from its explicit zone and Instant.
 */
function normalizeTermEvaluation(value: unknown): TermEvaluation {
    if (!hasExactDataKeys(value, ['evaluatedAt', 'termZone', 'applicableDate'])
        || typeof value.evaluatedAt !== 'string'
        || typeof value.termZone !== 'string'
        || !isCanonicalLocalDate(value.applicableDate)
        || localDateInTermZone(value.evaluatedAt, value.termZone) !== value.applicableDate) {
        throw new TypeError('Term evaluation is inconsistent');
    }
    const termZone = canonicalTimeZone(value.termZone);
    if (termZone === null) {
        throw new TypeError('Term evaluation has invalid zone');
    }
    return {
        evaluatedAt: value.evaluatedAt,
        termZone,
        applicableDate: value.applicableDate,
    };
}

/**
 * Validates the shared optimistic-concurrency fields for a Term mutation.
 */
function normalizeTermMutationBase(
    value: unknown,
    additionalKeys: readonly string[] = [],
): TermMutationCommandBase & Record<string, unknown> {
    if (!hasExactDataKeys(value, [
        'commandId',
        'followUpId',
        'expectedRevision',
        'expectedPlanVersion',
        'expectedTermVersion',
        'intent',
        ...additionalKeys,
    ])
        || !isCanonicalUuid(value.commandId)
        || !isCanonicalUuid(value.followUpId)
        || !isCanonicalUnsignedSqliteInteger(value.expectedRevision)
        || !isCanonicalUnsignedSqliteInteger(value.expectedPlanVersion)
        || !isCanonicalUnsignedSqliteInteger(value.expectedTermVersion)) {
        throw new TypeError('Term mutation command has invalid fields');
    }
    return value as TermMutationCommandBase & Record<string, unknown>;
}

/**
 * Normalizes the system lifecycle Intent before PLAN/DATA evaluation.
 */
export function normalizeReconcileWorkspaceLifecycleCommand(
    value: unknown,
): ReconcileWorkspaceLifecycleCommand {
    const base = normalizeTermMutationBase(value);
    if (!hasExactDataKeys(base.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || base.intent.kind !== 'workspace.reconcile-lifecycle'
        || base.intent.intentSchemaVersion !== 1
        || !hasExactDataKeys(base.intent.payload, ['termId', 'evaluation'])
        || !isCanonicalUuid(base.intent.payload.termId)) {
        throw new TypeError('Lifecycle command has invalid fields');
    }
    return {
        commandId: base.commandId,
        followUpId: base.followUpId,
        expectedRevision: base.expectedRevision,
        expectedPlanVersion: base.expectedPlanVersion,
        expectedTermVersion: base.expectedTermVersion,
        intent: {
            kind: 'workspace.reconcile-lifecycle',
            intentSchemaVersion: 1,
            payload: {
                termId: base.intent.payload.termId,
                evaluation: normalizeTermEvaluation(base.intent.payload.evaluation),
            },
        },
    };
}

/**
 * Normalizes an explicit Term end-date correction.
 */
export function normalizeUpdateTermEndDateCommand(value: unknown): UpdateTermEndDateCommand {
    const base = normalizeTermMutationBase(value);
    if (!hasExactDataKeys(base.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || base.intent.kind !== 'plan.update-term-end-date'
        || base.intent.intentSchemaVersion !== 1
        || !hasExactDataKeys(base.intent.payload, ['termId', 'endDate'])
        || !isCanonicalUuid(base.intent.payload.termId)
        || !isCanonicalLocalDate(base.intent.payload.endDate)) {
        throw new TypeError('Update Term command has invalid fields');
    }
    return {
        commandId: base.commandId,
        followUpId: base.followUpId,
        expectedRevision: base.expectedRevision,
        expectedPlanVersion: base.expectedPlanVersion,
        expectedTermVersion: base.expectedTermVersion,
        intent: {
            kind: 'plan.update-term-end-date',
            intentSchemaVersion: 1,
            payload: {
                termId: base.intent.payload.termId,
                endDate: base.intent.payload.endDate,
            },
        },
    };
}

/**
 * Normalizes an explicit Current Term reset and its retyped confirmation.
 *
 * @param {unknown} value Untrusted command from the Shell.
 * @return {ResetCurrentTermCommand} Validated reset command.
 */
export function normalizeResetCurrentTermCommand(value: unknown): ResetCurrentTermCommand {
    const base = normalizeTermMutationBase(value);
    if (!hasExactDataKeys(base.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || base.intent.kind !== 'plan.reset-current-term'
        || base.intent.intentSchemaVersion !== 1
        || !hasExactDataKeys(base.intent.payload, ['termId', 'confirmedTermName'])
        || !isCanonicalUuid(base.intent.payload.termId)
        || typeof base.intent.payload.confirmedTermName !== 'string'
        || base.intent.payload.confirmedTermName.length === 0
        || base.intent.payload.confirmedTermName.length > MAX_TERM_NAME_LENGTH) {
        throw new TypeError('Reset Current Term command has invalid fields');
    }
    return {
        commandId: base.commandId,
        followUpId: base.followUpId,
        expectedRevision: base.expectedRevision,
        expectedPlanVersion: base.expectedPlanVersion,
        expectedTermVersion: base.expectedTermVersion,
        intent: {
            kind: 'plan.reset-current-term',
            intentSchemaVersion: 1,
            payload: {
                termId: base.intent.payload.termId,
                confirmedTermName: base.intent.payload.confirmedTermName,
            },
        },
    };
}

/**
 * Normalizes an explicit restore using the Workspace-derived EvaluationContext.
 */
export function normalizeRestoreTermAsCurrentCommand(value: unknown): RestoreTermAsCurrentCommand {
    const base = normalizeTermMutationBase(value, ['evaluation']);
    if (!hasExactDataKeys(base.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || base.intent.kind !== 'plan.restore-term-as-current'
        || base.intent.intentSchemaVersion !== 1
        || !hasExactDataKeys(base.intent.payload, ['termId'])
        || !isCanonicalUuid(base.intent.payload.termId)) {
        throw new TypeError('Restore Term command has invalid fields');
    }
    return {
        commandId: base.commandId,
        followUpId: base.followUpId,
        expectedRevision: base.expectedRevision,
        expectedPlanVersion: base.expectedPlanVersion,
        expectedTermVersion: base.expectedTermVersion,
        evaluation: normalizeTermEvaluation(base.evaluation),
        intent: {
            kind: 'plan.restore-term-as-current',
            intentSchemaVersion: 1,
            payload: { termId: base.intent.payload.termId },
        },
    };
}

export function normalizeCreateTermCommand(value: unknown): CreateTermCommand {
    if (!hasExactDataKeys(value, [
        'commandId',
        'followUpId',
        'expectedRevision',
        'expectedPlanVersion',
        'intent',
    ])
        || !isCanonicalUuid(value.commandId)
        || !isCanonicalUuid(value.followUpId)
        || !isCanonicalUnsignedSqliteInteger(value.expectedRevision)
        || !isCanonicalUnsignedSqliteInteger(value.expectedPlanVersion)
        || !hasExactDataKeys(value.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || value.intent.kind !== 'plan.create-term'
        || value.intent.intentSchemaVersion !== 1
        || !hasExactDataKeys(value.intent.payload, ['name', 'startDate', 'endDate', 'timeZone'])) {
        throw new TypeError('CreateTermCommand has invalid fields');
    }

    const name = typeof value.intent.payload.name === 'string'
        ? value.intent.payload.name.trim()
        : '';
    const startDate = value.intent.payload.startDate;
    const endDate = value.intent.payload.endDate;
    const timeZone = canonicalTimeZone(value.intent.payload.timeZone);
    if (name.length === 0
        || name.length > MAX_TERM_NAME_LENGTH
        || !isCanonicalLocalDate(startDate)
        || !isCanonicalLocalDate(endDate)
        || endDate < startDate
        || timeZone === null) {
        throw new TypeError('CreateTermCommand has invalid Term fields');
    }

    return {
        commandId: value.commandId,
        followUpId: value.followUpId,
        expectedRevision: value.expectedRevision,
        expectedPlanVersion: value.expectedPlanVersion,
        intent: {
            kind: 'plan.create-term',
            intentSchemaVersion: 1,
            payload: { name, startDate, endDate, timeZone },
        },
    };
}

export function createTermDigestProjection(command: CreateTermCommand): CanonicalValue {
    return {
        encoding: 'courseflow-canonical-json-v1',
        intent: command.intent,
        expectedRevision: command.expectedRevision,
        expectedEntityVersions: [{
            entityKind: 'plan-state',
            entityId: 'singleton',
            version: command.expectedPlanVersion,
        }],
        durableFollowUps: [{
            followUpId: command.followUpId,
            owner: 'protect',
            kind: 'backup-needed-through',
        }],
    };
}

/**
 * Builds the canonical receipt digest projection shared by Term lifecycle mutations.
 * Restore evaluation is trusted commit context rather than stable user intent, so
 * retries bind the same Term/versions/follow-up while Workspace may advance its Clock.
 */
function termMutationDigestProjection(
    command: ReconcileWorkspaceLifecycleCommand
        | UpdateTermEndDateCommand
        | RestoreTermAsCurrentCommand
        | ResetCurrentTermCommand,
): CanonicalValue {
    return {
        encoding: 'courseflow-canonical-json-v1',
        intent: command.intent,
        expectedRevision: command.expectedRevision,
        expectedEntityVersions: [
            {
                entityKind: 'plan-state',
                entityId: 'singleton',
                version: command.expectedPlanVersion,
            },
            {
                entityKind: 'term',
                entityId: command.intent.payload.termId,
                version: command.expectedTermVersion,
            },
        ],
        durableFollowUps: [{
            followUpId: command.followUpId,
            owner: 'protect',
            kind: 'backup-needed-through',
        }],
    };
}

export function reconcileWorkspaceLifecycleDigestProjection(
    command: ReconcileWorkspaceLifecycleCommand,
): CanonicalValue {
    return termMutationDigestProjection(command);
}

export function updateTermEndDateDigestProjection(command: UpdateTermEndDateCommand): CanonicalValue {
    return termMutationDigestProjection(command);
}

export function restoreTermAsCurrentDigestProjection(command: RestoreTermAsCurrentCommand): CanonicalValue {
    return termMutationDigestProjection(command);
}

/**
 * Builds the canonical receipt digest projection for the Current Term reset.
 * @param {ResetCurrentTermCommand} command Validated reset command.
 * @return {CanonicalValue} Canonical digest projection.
 */
export function resetCurrentTermDigestProjection(command: ResetCurrentTermCommand): CanonicalValue {
    return termMutationDigestProjection(command);
}
