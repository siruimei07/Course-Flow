/**
 * @file Implements the transactional SQLite owner for Workspace facts and receipts.
 */

import { existsSync, lstatSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { backup, DatabaseSync, type DatabaseSyncOptions } from 'node:sqlite';

import {
    normalizeCancelMeetingOccurrenceCommand,
    normalizeAcceptedChangeMeetingOccurrenceCommand,
    normalizeMeetingOccurrenceWindow,
    normalizeMeetingOccurrenceImpactDraft,
    normalizeAcceptedCreateCourseWithMeetingCommand,
    type AcceptedCreateCourseWithMeetingCommand,
    type AcceptedChangeMeetingOccurrenceCommand,
    type CancelMeetingOccurrenceCommand,
    type ChangeMeetingOccurrenceCommand,
    type CreateCourseWithMeetingCommand,
    type CourseColor,
    type CourseTeachingRangeIntent,
    type MeetingEffectiveRangeIntent,
    type MeetingLocation,
    type MeetingOverlapWarning,
    type MeetingOccurrenceId,
    type MeetingOccurrenceImpactDraft,
    type MeetingOccurrenceImpactProjection,
    type MeetingOccurrenceWindow,
    type MeetingRuleReplacement,
    type MeetingSeriesDetailProjection,
    type MeetingTypeCode,
    type MeetingWeekday,
    deriveMeetingOccurrenceId,
    MAX_MEETING_OVERLAP_WARNINGS,
} from '../shared/workspace-course-contract';
import {
    INTL_ZONE_RULES,
    findMeetingTimeOverlap,
    isCanonicalInstant,
    resolveMeetingOccurrenceTime,
    type MeetingEndDayOffset,
    type MeetingInstantWindow,
} from '../shared/meeting-time';
import { canonicalJson } from '../shared/canonical-json';
import {
    isCanonicalUuid,
    normalizeRecordSetupDecisionCommand,
    type RecordSetupDecisionCommand,
} from '../shared/workspace-data-contract';
import {
    normalizeCreateHolidayRangeCommand,
    normalizeDeleteHolidayRangeCommand,
    normalizeUpdateHolidayRangeCommand,
    type CreateHolidayRangeCommand,
    type DeleteHolidayRangeCommand,
    type HolidayRangeProjection,
    type HolidayRangeCommand,
    type UpdateHolidayRangeCommand,
} from '../shared/workspace-holiday-contract';
import {
    type PlanMeetingSource,
    type PlanProjectionSource,
    type PlanTaskSource,
} from '../shared/workspace-plan-contract';
import {
    localDateInTermZone,
    normalizeCreateTermCommand,
    normalizeReconcileWorkspaceLifecycleCommand,
    normalizeRestoreTermAsCurrentCommand,
    normalizeUpdateTermEndDateCommand,
    type CreateTermCommand,
    type ReconcileWorkspaceLifecycleCommand,
    type RestoreTermAsCurrentCommand,
    type SetupProjection,
    type TermProjection,
    type UpdateTermEndDateCommand,
} from '../shared/workspace-term-contract';
import {
    deriveTaskOccurrenceId,
    normalizeChangeTaskOccurrenceCommand,
    normalizeCompleteTaskCommand,
    normalizeCreateTaskCommand,
    normalizeDeleteTaskOccurrenceOrSeriesCommand,
    normalizeDeleteTaskCommand,
    normalizeSetTaskOccurrenceStatusCommand,
    normalizeSetTaskProgressCommand,
    normalizeTaskOccurrenceImpactDraft,
    normalizeTaskOccurrenceWindow,
    normalizeUndoTaskOccurrenceStateCommand,
    normalizeUpdateTaskCommand,
    type ChangeTaskOccurrenceCommand,
    type CompleteTaskCommand,
    type CreateTaskCommand,
    type DeleteTaskOccurrenceOrSeriesCommand,
    type DeleteTaskCommand,
    type SetTaskOccurrenceStatusCommand,
    type SetTaskProgressCommand,
    type TaskCommand,
    type TaskDeadline,
    type TaskOccurrenceImpactDraft,
    type TaskOccurrenceImpactProjection,
    type TaskOccurrenceProjection,
    type TaskOccurrenceReplacement,
    type TaskOccurrenceStatus,
    type OnceTaskOccurrenceProjection,
    type TaskOccurrenceWindow,
    type TaskSchedule,
    type TaskSeriesDetailProjection,
    type TaskSize,
    type TaskUndoCapability,
    type UndoTaskOccurrenceStateCommand,
    type UpdateTaskCommand,
    type WeeklyTaskOccurrenceProjection,
} from '../shared/workspace-task-contract';
import {
    digestCancelMeetingOccurrence,
    digestChangeMeetingOccurrence,
    digestChangeTaskOccurrence,
    digestCreateCourseWithMeeting,
    digestCreateHolidayRange,
    digestCreateTerm,
    digestDeleteHolidayRange,
    digestDeleteTaskOccurrenceOrSeries,
    digestCompleteTask,
    digestCreateTask,
    digestDeleteTask,
    digestReconcileWorkspaceLifecycle,
    digestRecordSetupDecision,
    digestRestoreTermAsCurrent,
    digestSetTaskOccurrenceStatus,
    digestSetTaskProgress,
    digestUpdateTermEndDate,
    digestUpdateHolidayRange,
    digestUpdateTask,
    digestUndoTaskOccurrenceState,
} from './command-digest';
import {
    COURSEFLOW_APPLICATION_ID,
    CURRENT_SCHEMA_LEVEL,
    createSchemaLevel10,
    migrateLevel1To2,
    migrateLevel2To3,
    migrateLevel3To4,
    migrateLevel4To5,
    migrateLevel5To6,
    migrateLevel6To7,
    migrateLevel7To8,
    migrateLevel8To9,
    migrateLevel9To10,
    SchemaValidationError,
    validateSchemaLevel1,
    validateSchemaLevel2,
    validateSchemaLevel3,
    validateSchemaLevel4,
    validateSchemaLevel5,
    validateSchemaLevel6,
    validateSchemaLevel7,
    validateSchemaLevel8,
    validateSchemaLevel9,
    validateSchemaLevel10,
} from './schema';

const ACTIVE_DIRECTORY_NAME = 'active';
const DATABASE_FILE_NAME = 'workspace.sqlite';
const DATABASE_OPTIONS: DatabaseSyncOptions = {
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
    allowUnknownNamedParameters: false,
    defensive: true,
    timeout: 5_000,
};

export type InitializeFailpoint =
    | 'initialize.after-schema'
    | 'initialize.after-bootstrap'
    | 'initialize.after-user-version'
    | 'initialize.after-validation';

export type InitializeWorkspaceDataOptions = Readonly<{
    failpoint?: InitializeFailpoint;
}>;

export type OpenWorkspaceDataOptions = Readonly<{
    readOnly?: boolean;
    migrationFailpoint?: (point: MigrationFailpoint) => void;
}>;

export type MigrationFailpoint =
    | 'migration.after-safety-copy'
    | 'migration.before-level-commit';

export type DataOpenProblem =
    | Readonly<{
        code: 'permission';
        scope: 'workspace';
        dataEffect: 'unchanged';
        affectedCapabilities: readonly ['workspace.write'];
        allowedActions: readonly [];
        context: Readonly<Record<never, never>>;
        details: Readonly<{ reason: 'read-only' }>;
    }>
    | Readonly<{
        code: 'incompatible-version';
        scope: 'workspace';
        dataEffect: 'unchanged';
        affectedCapabilities: readonly ['workspace.read', 'workspace.write'];
        allowedActions: readonly [];
        context: Readonly<Record<never, never>>;
        details: Readonly<{ actualSchemaLevel: number; requiredSchemaLevel: 10 }>;
    }>
    | Readonly<{
        code: 'integrity';
        scope: 'workspace';
        dataEffect: 'unchanged';
        affectedCapabilities: readonly ['workspace.read', 'workspace.write'];
        allowedActions: readonly [];
        context: Readonly<Record<never, never>>;
        details: Readonly<{
            reason: 'wrong-application-id' | 'nonempty-level-zero' | 'schema-mismatch' | 'database-corrupt';
        }>;
    }>
    | Readonly<{
        code: 'recovery-required';
        scope: 'workspace';
        dataEffect: 'unchanged';
        affectedCapabilities: readonly ['workspace.read', 'workspace.write'];
        allowedActions: readonly [];
        context: Readonly<Record<never, never>>;
        details: Readonly<{ reason: 'database-unreadable' }>;
    }>;

export type DataOpenResult =
    | Readonly<{ kind: 'absent'; sqliteVersion: string }>
    | Readonly<{ kind: 'ready'; sqliteVersion: string; store: SqliteDataStore }>
    | Readonly<{ kind: 'read-only'; sqliteVersion: string; store: SqliteDataStore }>
    | Readonly<{ kind: 'recovery'; sqliteVersion: string; problem: DataOpenProblem }>;

export type WorkspaceDataStatus =
    | Readonly<{
        kind: 'ready';
        workspaceId: string;
        schemaLevel: 10;
        revision: string;
    }>
    | Readonly<{
        kind: 'read-only';
        workspaceId: string;
        schemaLevel: 10;
        revision: string;
        problem: DataOpenProblem;
    }>;

export type WorkspaceSetupSnapshot = Readonly<{
    revision: string;
    setup: Readonly<{
        workspaceId: string;
        lastDecision: 'later' | 'skip' | null;
        entityVersion: string;
    }>;
}>;

export type ReadSnapshotOptions = Readonly<{
    failpoint?: (point: 'read.after-revision') => void;
}>;

export type CommitFailpoint =
    | 'commit.after-begin'
    | 'commit.after-receipt-read'
    | 'commit.after-expected-versions'
    | 'commit.after-facts'
    | 'commit.after-revision'
    | 'commit.after-receipt'
    | 'commit.after-followup'
    | 'commit.after-watermark'
    | 'commit.before-sqlite-commit'
    | 'commit.after-sqlite-commit';

export type CommitOptions = Readonly<{
    failpoint?: (point: CommitFailpoint) => void;
}>;

export class CommittedCommandOutcomeUnknownError extends Error {
    public constructor(public readonly commandId: string) {
        super('Committed command outcome requires receipt recovery');
        this.name = 'CommittedCommandOutcomeUnknownError';
    }
}

type ReceiptEffect = Readonly<{
    code:
        | 'workspace.setup-decision-recorded'
        | 'plan.term-created-current'
        | 'plan.term-auto-archived'
        | 'plan.term-end-date-updated'
        | 'plan.term-restored-current'
        | 'plan.course-created'
        | 'plan.meeting-series-created'
        | 'plan.meeting-occurrence-changed'
        | 'plan.meeting-occurrence-cancelled'
        | 'plan.holiday-range-created'
        | 'plan.holiday-range-updated'
        | 'plan.holiday-range-deleted'
        | 'plan.task-series-created'
        | 'plan.task-series-updated'
        | 'plan.task-series-deleted'
        | 'plan.task-occurrence-completed'
        | 'plan.task-occurrence-status-set'
        | 'plan.task-progress-set'
        | 'plan.task-occurrence-changed'
        | 'plan.task-occurrence-deleted'
        | 'plan.task-occurrence-state-undone';
    entity: Readonly<{
        kind:
            | 'workspace-setup'
            | 'term'
            | 'course'
            | 'meeting-series'
            | 'holiday-range'
            | 'task-series';
        id: string;
        version: string;
    }>;
}>;

export type CommandReceiptOutcome = Readonly<{
    kind: 'committed';
    revision: string;
    effects: readonly [ReceiptEffect, ...ReceiptEffect[]];
    pendingFollowUps: readonly [string];
    undoCapability?: TaskUndoCapability | null;
}>;

export type DurableFollowUp = Readonly<{
    followUpId: string;
    originatingCommandId: string;
    owner: 'protect';
    kind: 'backup-needed-through';
    prerequisiteRevision: string;
    state: 'pending';
    version: '0';
}>;

type ConflictReason = 'command-id-reused' | 'expected-revision' | 'expected-entity-version';

type ConflictProblem = Readonly<{
    code: 'conflict';
    scope: 'operation';
    dataEffect: 'unchanged';
    affectedCapabilities: readonly ['workspace.write'];
    allowedActions: readonly ['requery'];
    context: Readonly<{
        revision: string;
        entityVersions: readonly [Readonly<{
            kind:
                | 'workspace-setup'
                | 'plan-state'
                | 'meeting-series'
                | 'holiday-range'
                | 'task-series';
            id: string;
            version: string;
        }>];
    }>;
    details: Readonly<{ reason: ConflictReason }>;
}>;

type WriterBusyProblem = Readonly<{
    code: 'operation-in-progress';
    scope: 'operation';
    dataEffect: 'unchanged';
    affectedCapabilities: readonly ['workspace.write'];
    allowedActions: readonly ['retry'];
    context: Readonly<{ revision: string }>;
    details: Readonly<{ reason: 'writer-busy' }>;
}>;

type PermissionCommitProblem = Readonly<{
    code: 'permission';
    scope: 'workspace';
    dataEffect: 'unchanged';
    affectedCapabilities: readonly ['workspace.write'];
    allowedActions: readonly [];
    context: Readonly<{ revision: string }>;
    details: Readonly<{ reason: 'read-only' }>;
}>;

type DecisionRequiredProblem =
    | Readonly<{
        code: 'decision-required';
        scope: 'operation';
        dataEffect: 'unchanged';
        affectedCapabilities: readonly ['workspace.write'];
        allowedActions: readonly ['preview'];
        context: Readonly<{ revision: string }>;
        details: Readonly<{ reason: 'impact-confirmation-required' }>;
    }>
    | Readonly<{
        code: 'decision-required';
        scope: 'operation';
        dataEffect: 'unchanged';
        affectedCapabilities: readonly ['workspace.write'];
        allowedActions: readonly ['continue'];
        context: Readonly<{ revision: string }>;
        details: Readonly<{
            reason: 'meeting-time-overlap';
            warnings: readonly MeetingOverlapWarning[];
        }>;
    }>;

export type DataCommitResult =
    | Readonly<{ ok: true; value: CommandReceiptOutcome }>
    | Readonly<{
        ok: false;
        problem: ConflictProblem | WriterBusyProblem | PermissionCommitProblem | DecisionRequiredProblem;
    }>;

type CommitWork = {
    command: WorkspaceDataCommand;
    options: CommitOptions;
    resolve: (result: DataCommitResult) => void;
    reject: (error: unknown) => void;
};

type TermMutationCommand =
    | ReconcileWorkspaceLifecycleCommand
    | UpdateTermEndDateCommand
    | RestoreTermAsCurrentCommand;

type MeetingOccurrenceMutationCommand =
    | AcceptedChangeMeetingOccurrenceCommand
    | CancelMeetingOccurrenceCommand;

type TaskSeriesMutationCommand =
    | CreateTaskCommand
    | UpdateTaskCommand
    | DeleteTaskCommand;

type TaskOccurrenceStateMutationCommand =
    | CompleteTaskCommand
    | SetTaskOccurrenceStatusCommand
    | SetTaskProgressCommand
    | UndoTaskOccurrenceStateCommand;

type TaskOccurrenceRuleMutationCommand =
    | ChangeTaskOccurrenceCommand
    | DeleteTaskOccurrenceOrSeriesCommand;

type WorkspaceDataCommand =
    | RecordSetupDecisionCommand
    | CreateTermCommand
    | AcceptedCreateCourseWithMeetingCommand
    | MeetingOccurrenceMutationCommand
    | HolidayRangeCommand
    | TaskCommand
    | TermMutationCommand;

type CurrentVersions = Readonly<{
    revision: bigint;
    setupVersion: bigint;
    planVersion: bigint;
}>;

const COMMIT_QUEUE_CAPACITY = 64;
const SQLITE_INTEGER_MAX = 9223372036854775807n;
const runtimeSqliteVersion = process.versions.sqlite;
if (typeof runtimeSqliteVersion !== 'string') {
    throw new Error('SQLite runtime version is unavailable');
}
const SQLITE_VERSION = runtimeSqliteVersion;

function activeDirectory(dataSlotsRoot: string): string {
    return join(dataSlotsRoot, ACTIVE_DIRECTORY_NAME);
}

function databasePath(dataSlotsRoot: string): string {
    return join(activeDirectory(dataSlotsRoot), DATABASE_FILE_NAME);
}

function configureDatabase(database: DatabaseSync): void {
    const journalMode = database.prepare('PRAGMA journal_mode = WAL').get() as { journal_mode: unknown };
    database.exec('PRAGMA synchronous = FULL');
    database.exec('PRAGMA foreign_keys = ON');
    database.exec('PRAGMA trusted_schema = OFF');

    const synchronous = database.prepare('PRAGMA synchronous').get() as { synchronous: unknown };
    const foreignKeys = database.prepare('PRAGMA foreign_keys').get() as { foreign_keys: unknown };
    const trustedSchema = database.prepare('PRAGMA trusted_schema').get() as { trusted_schema: unknown };
    if (journalMode.journal_mode !== 'wal'
        || synchronous.synchronous !== 2
        || foreignKeys.foreign_keys !== 1
        || trustedSchema.trusted_schema !== 0) {
        throw new Error('Workspace database configuration failed');
    }
}

function configureReadOnlyDatabase(database: DatabaseSync): void {
    database.exec('PRAGMA foreign_keys = ON');
    database.exec('PRAGMA trusted_schema = OFF');
    database.exec('PRAGMA query_only = ON');

    const foreignKeys = database.prepare('PRAGMA foreign_keys').get() as { foreign_keys: unknown };
    const trustedSchema = database.prepare('PRAGMA trusted_schema').get() as { trusted_schema: unknown };
    const queryOnly = database.prepare('PRAGMA query_only').get() as { query_only: unknown };
    if (foreignKeys.foreign_keys !== 1
        || trustedSchema.trusted_schema !== 0
        || queryOnly.query_only !== 1) {
        throw new Error('Workspace read-only database configuration failed');
    }
}

function openDatabase(path: string, readOnly: boolean): DatabaseSync {
    const database = new DatabaseSync(path, { ...DATABASE_OPTIONS, readOnly });
    try {
        if (readOnly) {
            configureReadOnlyDatabase(database);
        } else {
            configureDatabase(database);
        }
        return database;
    } catch (error) {
        database.close();
        throw error;
    }
}

function throwFailpoint(failpoint: InitializeFailpoint | undefined, expected: InitializeFailpoint): void {
    if (failpoint === expected) {
        throw new Error(expected);
    }
}

function fireCommitFailpoint(options: CommitOptions, point: CommitFailpoint): void {
    options.failpoint?.(point);
}

function decimalFromCoefficient(coefficient: bigint, scale: bigint): string {
    if (scale === 0n) {
        return coefficient.toString();
    }
    const scaleNumber = Number(scale);
    const digits = coefficient.toString().padStart(scaleNumber + 1, '0');
    return `${digits.slice(0, -scaleNumber)}.${digits.slice(-scaleNumber)}`;
}

function decimalToCoefficient(value: string | null): readonly [bigint | null, bigint | null] {
    if (value === null) {
        return freezePair([null, null]);
    }
    const [integer, fraction = ''] = value.split('.');
    return freezePair([BigInt(integer + fraction), BigInt(fraction.length)]);
}

function meetingTypeName(type: MeetingTypeCode): 'Lecture' | 'Tutorial' | 'Practical' {
    if (type === 'LEC') {
        return 'Lecture';
    }
    return type === 'TUT' ? 'Tutorial' : 'Practical';
}

const MILLISECONDS_PER_DAY = 86_400_000;
const MEETING_WEEKDAY_NUMBERS: Readonly<Record<MeetingWeekday, number>> = Object.freeze({
    SUN: 0,
    MON: 1,
    TUE: 2,
    WED: 3,
    THU: 4,
    FRI: 5,
    SAT: 6,
});

/**
 * Converts a canonical LocalDate to a UTC arithmetic coordinate.
 * @param {string} value - Canonical LocalDate.
 * @return {number} UTC midnight milliseconds used only for date arithmetic.
 */
function localDateMilliseconds(value: string): number {
    return Date.parse(`${value}T00:00:00.000Z`);
}

/**
 * Adds an in-range number of calendar days to a canonical LocalDate.
 * @param {string} value - Canonical LocalDate.
 * @param {number} days - Signed day offset known to remain representable.
 * @return {string} Shifted canonical LocalDate.
 */
function addLocalDateDays(value: string, days: number): string {
    return new Date(localDateMilliseconds(value) + days * MILLISECONDS_PER_DAY)
        .toISOString()
        .slice(0, 10);
}

/**
 * Adds days while clamping to the supported LocalDate endpoints.
 * @param {string} value - Canonical LocalDate.
 * @param {number} days - Signed day offset.
 * @return {string} Shifted or endpoint-clamped canonical LocalDate.
 */
function addClampedLocalDateDays(value: string, days: number): string {
    const shifted = localDateMilliseconds(value) + days * MILLISECONDS_PER_DAY;
    const minimum = localDateMilliseconds('0000-01-01');
    const maximum = localDateMilliseconds('9999-12-31');
    return new Date(Math.min(maximum, Math.max(minimum, shifted))).toISOString().slice(0, 10);
}

/**
 * Projects a stable weekly logical anchor onto an effective weekday.
 * @param {string} originalLogicalAnchor - Stable occurrence identity anchor.
 * @param {MeetingWeekday} weekday - Effective weekday after segment or override rules.
 * @return {string | null} Physical LocalDate, or null beyond the supported date domain.
 */
function occurrenceDate(originalLogicalAnchor: string, weekday: MeetingWeekday): string | null {
    const anchorWeekday = new Date(localDateMilliseconds(originalLogicalAnchor)).getUTCDay();
    const milliseconds = localDateMilliseconds(originalLogicalAnchor)
        + (MEETING_WEEKDAY_NUMBERS[weekday] - anchorWeekday) * MILLISECONDS_PER_DAY;
    if (milliseconds < localDateMilliseconds('0000-01-01')
        || milliseconds > localDateMilliseconds('9999-12-31')) {
        return null;
    }
    return new Date(milliseconds).toISOString().slice(0, 10);
}

/**
 * Chooses the first representable weekly identity anchor for a new Meeting series.
 * @param {string} startDate - Resolved inclusive effective-range start.
 * @param {MeetingWeekday} weekday - Initial Meeting weekday.
 * @return {string} First matching anchor, using the previous match at the LocalDate ceiling.
 */
function firstWeeklyLogicalAnchor(startDate: string, weekday: MeetingWeekday): string {
    const weekdayNumber = MEETING_WEEKDAY_NUMBERS[weekday];
    const startWeekday = new Date(localDateMilliseconds(startDate)).getUTCDay();
    const forwardDays = (weekdayNumber - startWeekday + 7) % 7;
    const forwardMilliseconds = localDateMilliseconds(startDate) + forwardDays * MILLISECONDS_PER_DAY;
    return forwardMilliseconds <= localDateMilliseconds('9999-12-31')
        ? new Date(forwardMilliseconds).toISOString().slice(0, 10)
        : addLocalDateDays(startDate, forwardDays - 7);
}

/**
 * Chooses the first weekly Task anchor on or after its inclusive start without crossing LocalDate max.
 * @param {string} startDate - Inclusive Task schedule start.
 * @param {MeetingWeekday} weekday - Required Task weekday.
 * @return {string | null} First matching LocalDate, or null when no representable match exists.
 */
function firstTaskWeeklyAnchor(startDate: string, weekday: MeetingWeekday): string | null {
    const weekdayNumber = MEETING_WEEKDAY_NUMBERS[weekday];
    const startMilliseconds = localDateMilliseconds(startDate);
    const startWeekday = new Date(startMilliseconds).getUTCDay();
    const forwardDays = (weekdayNumber - startWeekday + 7) % 7;
    const forwardMilliseconds = startMilliseconds + forwardDays * MILLISECONDS_PER_DAY;
    return forwardMilliseconds > localDateMilliseconds('9999-12-31')
        ? null
        : new Date(forwardMilliseconds).toISOString().slice(0, 10);
}

/**
 * Chooses the final weekly Task anchor on or before its inclusive confirmed end.
 * @param {string} endDate - Inclusive confirmed Task schedule end.
 * @param {MeetingWeekday} weekday - Required Task weekday.
 * @return {string} Final matching LocalDate.
 */
function lastTaskWeeklyAnchor(endDate: string, weekday: MeetingWeekday): string {
    const weekdayNumber = MEETING_WEEKDAY_NUMBERS[weekday];
    const endMilliseconds = localDateMilliseconds(endDate);
    const endWeekday = new Date(endMilliseconds).getUTCDay();
    const backwardDays = (endWeekday - weekdayNumber + 7) % 7;
    return addLocalDateDays(endDate, -backwardDays);
}

type StoredMeetingSegment = Readonly<{
    meeting_segment_id: string;
    meeting_type: MeetingTypeCode;
    weekday: MeetingWeekday;
    local_start: string;
    local_end: string;
    end_day_offset: MeetingEndDayOffset;
    logical_start_anchor: string;
    logical_end_anchor: string | null;
    effective_range_kind: MeetingEffectiveRangeIntent['kind'];
    effective_start_date: string | null;
    effective_end_date: string | null;
    resolved_start_date: string;
    resolved_end_date: string;
    location_kind: 'known' | 'tba';
    location_value: string | null;
}>;

type StoredMeetingOverride = Readonly<{
    original_logical_anchor: string;
    override_kind: 'replaced' | 'cancelled';
    meeting_type: MeetingTypeCode | null;
    weekday: MeetingWeekday | null;
    local_start: string | null;
    local_end: string | null;
    end_day_offset: MeetingEndDayOffset | null;
    location_kind: 'known' | 'tba' | null;
    location_value: string | null;
}>;

type StoredConflictMeetingSegment = StoredMeetingSegment & Readonly<{
    meeting_series_id: string;
    course_id: string;
    course_code: string;
    term_zone: string;
}>;

type StoredConflictMeetingOverride = StoredMeetingOverride & Readonly<{
    meeting_series_id: string;
}>;

type StoredHolidayRange = Readonly<{
    holiday_range_id: string;
    start_date: string;
    end_date: string;
}>;

type ConflictMeetingObject = Readonly<{
    courseId: string | null;
    courseCode: string;
    meetingSeriesId: string | null;
}>;

type ConflictMeetingOccurrence = Readonly<{
    object: ConflictMeetingObject;
    meetingType: MeetingTypeCode;
    originalLogicalAnchor: string;
    date: string;
    time: MeetingInstantWindow;
}>;

/**
 * Expands effective scheduled occurrences for one Meeting series in a bounded date window.
 * @param {ConflictMeetingObject} object - Stable stored object or unsaved draft reference.
 * @param {string} termZone - Explicit TermZone owning every local time in the series.
 * @param {readonly StoredMeetingSegment[]} segments - Ordered effective rule segments.
 * @param {readonly StoredMeetingOverride[]} overrides - Replacements and cancellations by anchor.
 * @param {readonly StoredHolidayRange[]} holidayRanges - Active inclusive suppression ranges.
 * @param {MeetingOccurrenceWindow} requestedWindow - Bounded physical start-date window.
 * @return {readonly ConflictMeetingOccurrence[]} Effective scheduled occurrences only.
 */
function expandConflictMeetingOccurrences(
    object: ConflictMeetingObject,
    termZone: string,
    segments: readonly StoredMeetingSegment[],
    overrides: readonly StoredMeetingOverride[],
    holidayRanges: readonly StoredHolidayRange[],
    requestedWindow: MeetingOccurrenceWindow,
): readonly ConflictMeetingOccurrence[] {
    validateMeetingSegmentSequence(segments);
    const overrideByAnchor = new Map(overrides.map(override => [
        override.original_logical_anchor,
        override,
    ]));
    const occurrences: ConflictMeetingOccurrence[] = [];
    const seenAnchors = new Set<string>();
    for (const segment of segments) {
        for (const anchor of candidateLogicalAnchors(segment, requestedWindow)) {
            if (seenAnchors.has(anchor)) {
                throw new Error('Meeting occurrence logical anchor is duplicated');
            }
            seenAnchors.add(anchor);
            const override = overrideByAnchor.get(anchor);
            const baseDate = occurrenceDate(anchor, segment.weekday);
            const weekday = override?.override_kind === 'replaced'
                ? override.weekday!
                : segment.weekday;
            if (!isActiveLogicalAnchor(segment, anchor, segment.weekday)
                || override?.override_kind === 'cancelled') {
                continue;
            }
            const type = override?.override_kind === 'replaced'
                ? override.meeting_type!
                : segment.meeting_type;
            const localStart = override?.override_kind === 'replaced'
                ? override.local_start!
                : segment.local_start;
            const localEnd = override?.override_kind === 'replaced'
                ? override.local_end!
                : segment.local_end;
            const endDayOffset = override?.override_kind === 'replaced'
                ? override.end_day_offset!
                : segment.end_day_offset;
            const date = occurrenceDate(anchor, weekday);
            if (baseDate === null
                || date === null
                || date < requestedWindow.startDate
                || date > requestedWindow.endDate
                || (override?.override_kind !== 'replaced'
                    && holidayRanges.some(range => (
                        baseDate >= range.start_date && baseDate <= range.end_date
                    )))) {
                continue;
            }
            occurrences.push(Object.freeze({
                object,
                meetingType: type,
                originalLogicalAnchor: anchor,
                date,
                time: resolveMeetingOccurrenceTime({
                    termZone,
                    date,
                    localStart,
                    localEnd,
                    endDayOffset,
                }),
            }));
        }
    }
    return Object.freeze(occurrences);
}

/**
 * Materializes user-facing overlap warnings for proposed and retained effective occurrences.
 * @param {string} commandId - Stable draft/decision identity.
 * @param {readonly ConflictMeetingOccurrence[]} proposed - Proposed effective occurrences.
 * @param {readonly ConflictMeetingOccurrence[]} existing - Retained stored occurrences.
 * @return {readonly MeetingOverlapWarning[]} Exact positive overlaps in deterministic order.
 */
function meetingOverlapWarnings(
    commandId: string,
    proposed: readonly ConflictMeetingOccurrence[],
    existing: readonly ConflictMeetingOccurrence[],
): readonly MeetingOverlapWarning[] {
    const warnings: MeetingOverlapWarning[] = [];
    for (const proposedOccurrence of proposed) {
        if (warnings.length >= MAX_MEETING_OVERLAP_WARNINGS) {
            break;
        }
        for (const existingOccurrence of existing) {
            const overlap = findMeetingTimeOverlap(proposedOccurrence.time, existingOccurrence.time);
            if (overlap === null) {
                continue;
            }
            warnings.push(Object.freeze({
                code: 'meeting-time-overlap' as const,
                proposed: Object.freeze({
                    commandId,
                    courseId: proposedOccurrence.object.courseId,
                    courseCode: proposedOccurrence.object.courseCode,
                    meetingSeriesId: proposedOccurrence.object.meetingSeriesId,
                    meetingType: proposedOccurrence.meetingType,
                    occurrenceId: Object.freeze({
                        meetingSeriesId: proposedOccurrence.object.meetingSeriesId,
                        originalLogicalAnchor: proposedOccurrence.originalLogicalAnchor,
                    }),
                    startInstant: proposedOccurrence.time.startInstant,
                    endInstant: proposedOccurrence.time.endInstant,
                }),
                existing: Object.freeze({
                    courseId: existingOccurrence.object.courseId!,
                    courseCode: existingOccurrence.object.courseCode,
                    meetingSeriesId: existingOccurrence.object.meetingSeriesId!,
                    meetingType: existingOccurrence.meetingType,
                    occurrenceId: deriveMeetingOccurrenceId(
                        existingOccurrence.object.meetingSeriesId!,
                        existingOccurrence.originalLogicalAnchor,
                    ),
                    startInstant: existingOccurrence.time.startInstant,
                    endInstant: existingOccurrence.time.endInstant,
                }),
                overlap,
            }));
            if (warnings.length >= MAX_MEETING_OVERLAP_WARNINGS) {
                break;
            }
        }
    }
    return Object.freeze(warnings.sort((first, second) => (
        first.overlap.startInstant.localeCompare(second.overlap.startInstant)
        || first.proposed.occurrenceId.originalLogicalAnchor.localeCompare(
            second.proposed.occurrenceId.originalLogicalAnchor,
        )
        || first.existing.occurrenceId.meetingSeriesId.localeCompare(
            second.existing.occurrenceId.meetingSeriesId,
        )
    )));
}

/**
 * Returns an order-independent identity for one derived Meeting conflict pair.
 * @param {MeetingOverlapWarning} warning - Derived overlap warning.
 * @return {string} Stable pair identity independent of proposed/existing ordering.
 */
function meetingOverlapWarningKey(warning: MeetingOverlapWarning): string {
    return [
        `${warning.proposed.occurrenceId.meetingSeriesId}:${warning.proposed.occurrenceId.originalLogicalAnchor}`,
        `${warning.existing.occurrenceId.meetingSeriesId}:${warning.existing.occurrenceId.originalLogicalAnchor}`,
    ].sort().join('|');
}

/**
 * Derives all pairwise warnings in one bounded effective schedule.
 * @param {string} commandId - Holiday mutation command identity used by warning DTOs.
 * @param {readonly ConflictMeetingOccurrence[]} occurrences - Effective scheduled occurrences.
 * @return {readonly MeetingOverlapWarning[]} Deterministically ordered positive overlaps.
 */
function meetingScheduleOverlapWarnings(
    commandId: string,
    occurrences: readonly ConflictMeetingOccurrence[],
): readonly MeetingOverlapWarning[] {
    const warnings: MeetingOverlapWarning[] = [];
    for (let index = 0; index < occurrences.length; index += 1) {
        warnings.push(...meetingOverlapWarnings(
            commandId,
            [occurrences[index]!],
            occurrences.slice(index + 1),
        ));
    }
    return Object.freeze(warnings.sort((first, second) => (
        first.overlap.startInstant.localeCompare(second.overlap.startInstant)
        || meetingOverlapWarningKey(first).localeCompare(meetingOverlapWarningKey(second))
    )));
}

/**
 * Rejects an ordered segment sequence whose logical ranges overlap.
 * @param {readonly StoredMeetingSegment[]} segments - Segments ordered by logical start anchor.
 * @return {void}
 */
function validateMeetingSegmentSequence(segments: readonly StoredMeetingSegment[]): void {
    let previousEndAnchor: string | null | undefined;
    for (const segment of segments) {
        if (previousEndAnchor !== undefined
            && (previousEndAnchor === null || segment.logical_start_anchor <= previousEndAnchor)) {
            throw new Error('Meeting series has overlapping logical segments');
        }
        previousEndAnchor = segment.logical_end_anchor;
    }
}

/**
 * Tests logical range membership and the segment's seven-day cadence.
 * @param {StoredMeetingSegment} segment - Candidate owning segment.
 * @param {string} anchor - Stable logical occurrence anchor.
 * @return {boolean} Whether the anchor belongs to the segment's weekly sequence.
 */
function logicalAnchorBelongsToSegment(segment: StoredMeetingSegment, anchor: string): boolean {
    return segment.logical_start_anchor <= anchor
        && (segment.logical_end_anchor === null || segment.logical_end_anchor >= anchor)
        && (localDateMilliseconds(anchor) - localDateMilliseconds(segment.logical_start_anchor))
            % (7 * MILLISECONDS_PER_DAY) === 0;
}

/**
 * Tests whether a logical anchor produces an occurrence inside the resolved effective range.
 * @param {StoredMeetingSegment} segment - Candidate owning segment.
 * @param {string} anchor - Stable logical occurrence anchor.
 * @param {MeetingWeekday} weekday - Effective weekday used for physical range membership.
 * @return {boolean} Whether the occurrence is currently active.
 */
function isActiveLogicalAnchor(
    segment: StoredMeetingSegment,
    anchor: string,
    weekday: MeetingWeekday = segment.weekday,
): boolean {
    const date = occurrenceDate(anchor, weekday);
    return date !== null
        && logicalAnchorBelongsToSegment(segment, anchor)
        && segment.resolved_start_date <= date
        && segment.resolved_end_date >= date;
}

/**
 * Enumerates only weekly anchors that can project into a bounded physical window.
 * @param {StoredMeetingSegment} segment - Segment owning the weekly sequence.
 * @param {MeetingOccurrenceWindow} requestedWindow - Bounded physical query window.
 * @return {readonly string[]} Candidate anchors for final rule and override evaluation.
 */
function candidateLogicalAnchors(
    segment: StoredMeetingSegment,
    requestedWindow: MeetingOccurrenceWindow,
): readonly string[] {
    const weekMilliseconds = 7 * MILLISECONDS_PER_DAY;
    const requestedStart = requestedWindow.startDate > segment.resolved_start_date
        ? requestedWindow.startDate
        : segment.resolved_start_date;
    const requestedEnd = requestedWindow.endDate < segment.resolved_end_date
        ? requestedWindow.endDate
        : segment.resolved_end_date;
    if (requestedEnd < requestedStart) {
        return Object.freeze([]);
    }
    const firstAnchorMilliseconds = localDateMilliseconds(segment.logical_start_anchor);
    const earliestAnchorMilliseconds = Math.max(
        localDateMilliseconds('0000-01-01'),
        localDateMilliseconds(requestedStart) - 6 * MILLISECONDS_PER_DAY,
    );
    const latestAnchorMilliseconds = Math.min(
        localDateMilliseconds('9999-12-31'),
        localDateMilliseconds(requestedEnd) + 6 * MILLISECONDS_PER_DAY,
    );
    const minimumIndex = Math.max(0, Math.ceil(
        (earliestAnchorMilliseconds - firstAnchorMilliseconds) / weekMilliseconds,
    ));
    let maximumIndex = Math.floor(
        (latestAnchorMilliseconds - firstAnchorMilliseconds) / weekMilliseconds,
    );
    if (segment.logical_end_anchor !== null) {
        maximumIndex = Math.min(maximumIndex, Math.floor(
            (localDateMilliseconds(segment.logical_end_anchor)
                - localDateMilliseconds(segment.logical_start_anchor)) / weekMilliseconds,
        ));
    }
    if (maximumIndex < minimumIndex) {
        return Object.freeze([]);
    }
    return Object.freeze(Array.from({ length: maximumIndex - minimumIndex + 1 }, (_, index) => (
        addLocalDateDays(segment.logical_start_anchor, (minimumIndex + index) * 7)
    )));
}

/**
 * Counts weekly anchors satisfying both logical-anchor and physical-date bounds.
 * @param {StoredMeetingSegment} segment - Segment owning the logical anchor sequence.
 * @param {MeetingWeekday} weekday - Weekday used to project each anchor to a physical date.
 * @param {number} minimumAnchor - Inclusive lower logical-anchor bound in UTC milliseconds.
 * @param {number} maximumAnchor - Inclusive upper logical-anchor bound in UTC milliseconds.
 * @param {number} minimumDate - Inclusive lower physical-date bound in UTC milliseconds.
 * @param {number} maximumDate - Inclusive upper physical-date bound in UTC milliseconds.
 * @return {number} Number of active anchors satisfying every bound.
 */
function countActiveLogicalAnchors(
    segment: StoredMeetingSegment,
    weekday: MeetingWeekday,
    minimumAnchor: number,
    maximumAnchor: number,
    minimumDate: number,
    maximumDate: number,
): number {
    if (maximumAnchor < minimumAnchor || maximumDate < minimumDate) {
        return 0;
    }
    const weekMilliseconds = 7 * MILLISECONDS_PER_DAY;
    const firstAnchor = localDateMilliseconds(segment.logical_start_anchor);
    const firstAnchorWeekday = new Date(firstAnchor).getUTCDay();
    const firstDate = firstAnchor
        + (MEETING_WEEKDAY_NUMBERS[weekday] - firstAnchorWeekday) * MILLISECONDS_PER_DAY;
    const resolvedStart = localDateMilliseconds(segment.resolved_start_date);
    const resolvedEnd = localDateMilliseconds(segment.resolved_end_date);
    const localDateMaximum = localDateMilliseconds('9999-12-31');
    let minimumIndex = Math.max(
        0,
        Math.ceil((minimumAnchor - firstAnchor) / weekMilliseconds),
        Math.ceil((Math.max(minimumDate, resolvedStart) - firstDate) / weekMilliseconds),
    );
    let maximumIndex = Math.min(
        Math.floor((maximumAnchor - firstAnchor) / weekMilliseconds),
        Math.floor((Math.min(maximumDate, resolvedEnd) - firstDate) / weekMilliseconds),
        Math.floor((localDateMaximum - firstAnchor) / weekMilliseconds),
    );
    if (segment.logical_end_anchor !== null) {
        maximumIndex = Math.min(
            maximumIndex,
            Math.floor(
                (localDateMilliseconds(segment.logical_end_anchor) - firstAnchor) / weekMilliseconds,
            ),
        );
    }
    minimumIndex = Math.ceil(minimumIndex);
    maximumIndex = Math.floor(maximumIndex);
    return maximumIndex < minimumIndex ? 0 : maximumIndex - minimumIndex + 1;
}

/**
 * Detects whether a bounded preview omits an actual weekly occurrence in an anchor partition.
 * @param {readonly StoredMeetingSegment[]} segments - Ordered segments in the Meeting series.
 * @param {number} minimumAnchor - Inclusive lower logical-anchor bound in UTC milliseconds.
 * @param {number} maximumAnchor - Inclusive upper logical-anchor bound in UTC milliseconds.
 * @param {MeetingOccurrenceWindow} requestedWindow - Physical dates shown by the preview.
 * @param {MeetingWeekday | null} replacementWeekday - Proposed weekday, or null for stored rules.
 * @param {readonly StoredMeetingOverride[]} overrides - Boundary replacements that can cross the window.
 * @param {string | null} clearedOverrideAnchor - Override cleared by the proposed split, when any.
 * @return {boolean} Whether at least one matching occurrence falls outside the requested window.
 */
function hasOccurrenceOutsideRequestedWindow(
    segments: readonly StoredMeetingSegment[],
    minimumAnchor: number,
    maximumAnchor: number,
    requestedWindow: MeetingOccurrenceWindow,
    replacementWeekday: MeetingWeekday | null,
    overrides: readonly StoredMeetingOverride[],
    clearedOverrideAnchor: string | null,
): boolean {
    const localDateMinimum = localDateMilliseconds('0000-01-01');
    const localDateMaximum = localDateMilliseconds('9999-12-31');
    const requestedStart = localDateMilliseconds(requestedWindow.startDate);
    const requestedEnd = localDateMilliseconds(requestedWindow.endDate);
    let outsideCount = segments.reduce((count, segment) => {
        const weekday = replacementWeekday ?? segment.weekday;
        const total = countActiveLogicalAnchors(
            segment,
            weekday,
            minimumAnchor,
            maximumAnchor,
            localDateMinimum,
            localDateMaximum,
        );
        const visible = countActiveLogicalAnchors(
            segment,
            weekday,
            minimumAnchor,
            maximumAnchor,
            requestedStart,
            requestedEnd,
        );
        return count + total - visible;
    }, 0);

    for (const override of overrides) {
        if (override.override_kind !== 'replaced'
            || override.original_logical_anchor === clearedOverrideAnchor) {
            continue;
        }
        const anchor = localDateMilliseconds(override.original_logical_anchor);
        if (anchor < minimumAnchor || anchor > maximumAnchor) {
            continue;
        }
        const matchingSegments = segments.filter(segment => (
            logicalAnchorBelongsToSegment(segment, override.original_logical_anchor)
        ));
        if (matchingSegments.length !== 1) {
            throw new Error('Meeting override does not target a logical occurrence');
        }
        const segment = matchingSegments[0]!;
        const baseWeekday = replacementWeekday ?? segment.weekday;
        if (!isActiveLogicalAnchor(segment, override.original_logical_anchor, baseWeekday)) {
            continue;
        }
        const baseDate = occurrenceDate(override.original_logical_anchor, baseWeekday);
        const replacedDate = occurrenceDate(override.original_logical_anchor, override.weekday!);
        if (baseDate === null || replacedDate === null) {
            throw new Error('Meeting override has an invalid physical date');
        }
        const baseOutside = baseDate < requestedWindow.startDate || baseDate > requestedWindow.endDate;
        const replacementOutside = replacedDate < requestedWindow.startDate
            || replacedDate > requestedWindow.endDate;
        outsideCount += Number(replacementOutside) - Number(baseOutside);
    }
    return outsideCount > 0;
}

/**
 * Binds a whole-rule confirmation to versions, exact intent, and preview window.
 * @param {string} revision - Workspace revision used by the preview.
 * @param {string} planEntityVersion - PLAN version used by the preview.
 * @param {string} meetingSeriesVersion - Meeting series version used by the preview.
 * @param {object} change - Exact future-change scope, series, anchor, and replacement facts.
 * @param {MeetingOccurrenceWindow} requestedWindow - Bounded preview window.
 * @return {string} Lowercase SHA-256 confirmation token.
 */
function meetingOccurrenceConfirmationToken(
    revision: string,
    planEntityVersion: string,
    meetingSeriesVersion: string,
    change: Pick<
        MeetingOccurrenceImpactDraft,
        'scope' | 'meetingSeriesId' | 'originalLogicalAnchor' | 'replacement'
    >,
    requestedWindow: MeetingOccurrenceWindow,
): string {
    const encoded = canonicalJson({
        encoding: 'courseflow-meeting-impact-v1',
        revision,
        planEntityVersion,
        meetingSeriesVersion,
        scope: change.scope,
        meetingSeriesId: change.meetingSeriesId,
        originalLogicalAnchor: change.originalLogicalAnchor,
        replacement: change.replacement,
        requestedWindow,
    });
    return createHash('sha256').update(encoded, 'utf8').digest('hex');
}

/**
 * Binds a Task whole-rule confirmation to the exact versions, action, and preview window.
 * @param {string} revision - Workspace revision used by the preview.
 * @param {string} planEntityVersion - PLAN version used by the preview.
 * @param {string} taskSeriesVersion - Task series version used by the preview.
 * @param {TaskOccurrenceImpactDraft} draft - Exact normalized future change or deletion.
 * @return {string} Lowercase SHA-256 confirmation token.
 */
function taskOccurrenceConfirmationToken(
    revision: string,
    planEntityVersion: string,
    taskSeriesVersion: string,
    draft: TaskOccurrenceImpactDraft,
): string {
    const encoded = canonicalJson({
        encoding: 'courseflow-task-impact-v1',
        revision,
        planEntityVersion,
        taskSeriesVersion,
        scope: draft.scope,
        taskSeriesId: draft.taskSeriesId,
        ...(draft.scope === 'whole-series'
            ? {}
            : { originalLogicalAnchor: draft.originalLogicalAnchor }),
        action: draft.action,
        ...(draft.action === 'change' ? { replacement: draft.replacement } : {}),
        requestedWindow: draft.requestedWindow,
    });
    return createHash('sha256').update(encoded, 'utf8').digest('hex');
}

/**
 * Materializes the explicit known/TBA location union from validated stored columns.
 * @param {'known' | 'tba'} kind - Stored location discriminant.
 * @param {string | null} value - Known location text, or null for TBA.
 * @return {MeetingLocation} Immutable location DTO.
 */
function meetingLocation(kind: 'known' | 'tba', value: string | null): MeetingLocation {
    return kind === 'tba'
        ? Object.freeze({ kind: 'tba' as const })
        : Object.freeze({ kind: 'known' as const, value: value! });
}

type TaskDeadlineColumns = readonly [
    TaskDeadline['kind'],
    string | null,
    string | null,
    string | null,
];

type TaskScheduleColumns = readonly [
    TaskSchedule['kind'],
    TaskDeadline['kind'] | null,
    string | null,
    string | null,
    string | null,
    string | null,
    MeetingWeekday | null,
    string | null,
    string | null,
    0 | 1 | null,
];

function taskDeadlineColumns(deadline: TaskDeadline): TaskDeadlineColumns {
    if (deadline.kind === 'date-only') {
        return Object.freeze(['date-only', deadline.date, null, null]);
    }
    if (deadline.kind === 'timed') {
        return Object.freeze(['timed', null, deadline.instant, deadline.timeZone]);
    }
    return Object.freeze(['tba', null, null, null]);
}

/**
 * Serializes the exact once-or-weekly Task schedule union to level-9 columns.
 * @param {TaskSchedule} schedule - Canonical Task schedule.
 * @return {TaskScheduleColumns} SQLite binding tuple with the inactive union arm cleared.
 */
function taskScheduleColumns(schedule: TaskSchedule): TaskScheduleColumns {
    if (schedule.kind === 'once') {
        return Object.freeze([
            'once',
            ...taskDeadlineColumns(schedule.deadline),
            null,
            null,
            null,
            null,
            null,
        ]);
    }
    return Object.freeze([
        'weekly',
        null,
        null,
        null,
        null,
        schedule.startDate,
        schedule.weekday,
        schedule.localDeadlineTime,
        schedule.confirmedEndDate,
        schedule.followTeachingWeek ? 1 : 0,
    ]);
}

function taskDeadlineProjection(
    kind: TaskDeadline['kind'],
    date: string | null,
    instant: string | null,
    displayZone: string | null,
): TaskDeadline {
    if (kind === 'date-only') {
        return Object.freeze({ kind, date: date! });
    }
    if (kind === 'timed') {
        return Object.freeze({ kind, instant: instant!, timeZone: displayZone! });
    }
    return Object.freeze({ kind });
}

type StoredTaskSchedule = Readonly<{
    schedule_kind: TaskSchedule['kind'];
    deadline_kind: TaskDeadline['kind'] | null;
    deadline_date: string | null;
    deadline_instant: string | null;
    deadline_display_zone: string | null;
    weekly_start_date: string | null;
    weekly_weekday: MeetingWeekday | null;
    weekly_local_deadline_time: string | null;
    weekly_confirmed_end_date: string | null;
    follow_teaching_week: bigint | null;
}>;

type StoredTaskSegment = StoredTaskSchedule & Readonly<{
    task_segment_id: string;
    title: string;
    task_size: TaskSize;
    logical_start_anchor: string;
    logical_end_anchor: string;
}>;

type StoredTaskOccurrenceState = Readonly<{
    original_logical_anchor: string;
    status: TaskOccurrenceStatus;
    self_reported_progress: bigint | null;
    entity_version: bigint;
}>;

type StoredTaskOccurrenceOverride = Readonly<{
    original_logical_anchor: string;
    override_kind: 'replaced' | 'deleted';
    replacement_title: string | null;
    replacement_task_size: TaskSize | null;
    replacement_deadline_kind: TaskDeadline['kind'] | null;
    replacement_deadline_date: string | null;
    replacement_deadline_instant: string | null;
    replacement_deadline_display_zone: string | null;
    entity_version: bigint;
}>;

/**
 * Projects the independent occurrence state without conflating completion and progress.
 * @param {StoredTaskOccurrenceState | undefined} state - Optional explicit stored state.
 * @param {TaskSize} size - Effective occurrence size after any override.
 * @return {object} Canonical status plus self-reported and displayed progress.
 */
function taskOccurrenceStateProjection(
    state: StoredTaskOccurrenceState | undefined,
    size: TaskSize,
): Readonly<{
    status: TaskOccurrenceStatus;
    reportedProgress: number | null;
    displayProgress: number | null;
}> {
    const status = state?.status ?? 'pending';
    const reportedProgress = size === 'large' && state?.self_reported_progress !== null
        && state?.self_reported_progress !== undefined
        ? Number(state.self_reported_progress)
        : null;
    return Object.freeze({
        status,
        reportedProgress,
        displayProgress: size !== 'large'
            ? null
            : status === 'completed'
                ? 100
                : reportedProgress,
    });
}

/**
 * Materializes a replaced Task occurrence from its validated stored override.
 * @param {StoredTaskOccurrenceOverride} override - Stored replaced override.
 * @return {TaskOccurrenceReplacement} Exact effective Task facts.
 */
function taskOverrideReplacement(
    override: Omit<StoredTaskOccurrenceOverride, 'original_logical_anchor'>,
): TaskOccurrenceReplacement {
    if (override.override_kind !== 'replaced') {
        throw new Error('Deleted Task override has no replacement facts');
    }
    return Object.freeze({
        title: override.replacement_title!,
        size: override.replacement_task_size!,
        deadline: taskDeadlineProjection(
            override.replacement_deadline_kind!,
            override.replacement_deadline_date,
            override.replacement_deadline_instant,
            override.replacement_deadline_display_zone,
        ),
    });
}

/**
 * Finds the unique current segment owning a stable Task logical anchor.
 * @param {readonly StoredTaskSegment[]} segments - Ordered Task rule segments.
 * @param {string} anchor - Stable once or LocalDate anchor.
 * @return {StoredTaskSegment | undefined} Owning segment, if still active.
 */
function taskSegmentForAnchor(
    segments: readonly StoredTaskSegment[],
    anchor: string,
): StoredTaskSegment | undefined {
    if (anchor === 'once') {
        return segments.find(segment => segment.logical_start_anchor === 'once');
    }
    return segments.find(segment => (
        segment.schedule_kind === 'weekly'
        && anchor >= segment.logical_start_anchor
        && anchor <= segment.logical_end_anchor
        && (localDateMilliseconds(anchor) - localDateMilliseconds(segment.logical_start_anchor))
            % (7 * MILLISECONDS_PER_DAY) === 0
    ));
}

/**
 * Builds the physical deadline of one base occurrence from a stored segment.
 * @param {StoredTaskSegment} segment - Owning current segment.
 * @param {string} anchor - Stable occurrence anchor.
 * @param {string} termZone - Explicit TermZone.
 * @return {TaskDeadline} Effective deadline before an only-this override.
 */
function taskSegmentOccurrenceDeadline(
    segment: StoredTaskSegment,
    anchor: string,
    termZone: string,
): TaskDeadline {
    if (segment.schedule_kind === 'once') {
        return taskDeadlineProjection(
            segment.deadline_kind!,
            segment.deadline_date,
            segment.deadline_instant,
            segment.deadline_display_zone,
        );
    }
    const date = occurrenceDate(anchor, segment.weekly_weekday!);
    if (date === null) {
        throw new Error('Task occurrence deadline is outside the LocalDate domain');
    }
    return Object.freeze({
        kind: 'timed' as const,
        instant: INTL_ZONE_RULES.resolveInstant(
            termZone,
            date,
            segment.weekly_local_deadline_time!,
        ),
        timeZone: termZone,
    });
}

/**
 * Materializes the validated stored Task schedule discriminated union.
 * @param {StoredTaskSchedule} row - Level-9 Task schedule columns.
 * @return {TaskSchedule} Immutable exact Task schedule.
 */
function taskScheduleProjection(row: StoredTaskSchedule): TaskSchedule {
    if (row.schedule_kind === 'once') {
        return Object.freeze({
            kind: 'once',
            deadline: taskDeadlineProjection(
                row.deadline_kind!,
                row.deadline_date,
                row.deadline_instant,
                row.deadline_display_zone,
            ),
        });
    }
    return Object.freeze({
        kind: 'weekly',
        startDate: row.weekly_start_date!,
        weekday: row.weekly_weekday!,
        localDeadlineTime: row.weekly_local_deadline_time!,
        confirmedEndDate: row.weekly_confirmed_end_date!,
        followTeachingWeek: row.follow_teaching_week === 1n,
    });
}

/**
 * Reads the once deadline from either retained v1 facts or a v2 once schedule.
 * @param {CreateTaskCommand['intent']['payload'] | UpdateTaskCommand['intent']['payload']} payload
 *     - Normalized Task facts.
 * @return {TaskDeadline} Exact once deadline.
 */
function taskSchedule(
    payload: CreateTaskCommand['intent']['payload'] | UpdateTaskCommand['intent']['payload'],
): TaskSchedule {
    if ('deadline' in payload) {
        return Object.freeze({ kind: 'once', deadline: payload.deadline });
    }
    return payload.schedule;
}

/**
 * Derives the inclusive stable identity range owned by one unsplit Task rule.
 * @param {TaskSchedule} schedule - Canonical once or weekly schedule.
 * @return {readonly [string, string]} Inclusive logical start and end anchors.
 */
function taskLogicalAnchors(schedule: TaskSchedule): readonly [string, string] {
    if (schedule.kind === 'once') {
        return Object.freeze(['once', 'once']);
    }
    const first = firstTaskWeeklyAnchor(schedule.startDate, schedule.weekday);
    if (first === null || first > schedule.confirmedEndDate) {
        throw new TypeError('Weekly Task schedule has no logical occurrence');
    }
    return Object.freeze([
        first,
        lastTaskWeeklyAnchor(schedule.confirmedEndDate, schedule.weekday),
    ]);
}

function isCourseWithMeetingCommand(
    command: WorkspaceDataCommand,
): command is AcceptedCreateCourseWithMeetingCommand {
    return command.intent.kind === 'plan.create-course-with-first-meeting';
}

/**
 * Narrows an accepted Course creation to the current writable schema.
 * @param {AcceptedCreateCourseWithMeetingCommand} command - Accepted creation command.
 * @return {boolean} Whether the command carries current overlap and day-offset semantics.
 */
function isCurrentCourseWithMeetingCommand(
    command: AcceptedCreateCourseWithMeetingCommand,
): command is CreateCourseWithMeetingCommand {
    return 'overlapDecision' in command;
}

/**
 * Narrows a Workspace DATA command to a Meeting occurrence mutation.
 * @param {WorkspaceDataCommand} command - Normalized DATA command.
 * @return {boolean} Whether the command mutates one occurrence or a future rule segment.
 */
function isMeetingOccurrenceMutationCommand(
    command: WorkspaceDataCommand,
): command is MeetingOccurrenceMutationCommand {
    return command.intent.kind === 'plan.change-meeting-occurrence'
        || command.intent.kind === 'plan.cancel-meeting-occurrence';
}

/**
 * Narrows an occurrence mutation to its change variant.
 * @param {MeetingOccurrenceMutationCommand} command - Normalized occurrence mutation.
 * @return {boolean} Whether the command carries a replacement rule.
 */
function isChangeMeetingOccurrenceCommand(
    command: MeetingOccurrenceMutationCommand,
): command is AcceptedChangeMeetingOccurrenceCommand {
    return command.intent.kind === 'plan.change-meeting-occurrence';
}

/**
 * Narrows an accepted occurrence change to the current writable schema.
 * @param {AcceptedChangeMeetingOccurrenceCommand} command - Accepted change command.
 * @return {boolean} Whether the command carries current overlap and day-offset semantics.
 */
function isCurrentChangeMeetingOccurrenceCommand(
    command: AcceptedChangeMeetingOccurrenceCommand,
): command is ChangeMeetingOccurrenceCommand {
    return 'overlapDecision' in command;
}

function isTermMutationCommand(command: WorkspaceDataCommand): command is TermMutationCommand {
    return command.intent.kind === 'workspace.reconcile-lifecycle'
        || command.intent.kind === 'plan.update-term-end-date'
        || command.intent.kind === 'plan.restore-term-as-current';
}

function isHolidayRangeCommand(command: WorkspaceDataCommand): command is HolidayRangeCommand {
    return command.intent.kind === 'plan.create-holiday-range'
        || command.intent.kind === 'plan.update-holiday-range'
        || command.intent.kind === 'plan.delete-holiday-range';
}

function isTaskCommand(command: WorkspaceDataCommand): command is TaskCommand {
    return command.intent.kind === 'plan.create-task-series'
        || command.intent.kind === 'plan.update-task-series'
        || command.intent.kind === 'plan.delete-task-series'
        || command.intent.kind === 'plan.set-task-occurrence-status'
        || command.intent.kind === 'plan.set-task-progress'
        || command.intent.kind === 'plan.change-task-occurrence'
        || command.intent.kind === 'plan.delete-task-occurrence-or-series'
        || command.intent.kind === 'plan.undo-task-occurrence-state';
}

function isTaskOccurrenceStateMutationCommand(
    command: TaskCommand,
): command is TaskOccurrenceStateMutationCommand {
    return command.intent.kind === 'plan.set-task-occurrence-status'
        || command.intent.kind === 'plan.set-task-progress'
        || command.intent.kind === 'plan.undo-task-occurrence-state';
}

function isTaskOccurrenceRuleMutationCommand(
    command: TaskCommand,
): command is TaskOccurrenceRuleMutationCommand {
    return command.intent.kind === 'plan.change-task-occurrence'
        || command.intent.kind === 'plan.delete-task-occurrence-or-series';
}

function freezeTuple<T>(value: [T]): readonly [T] {
    return Object.freeze(value);
}

function freezeEmptyTuple(): readonly [] {
    return Object.freeze([]);
}

function freezePair<T, U>(value: [T, U]): readonly [T, U] {
    return Object.freeze(value);
}

function committedOutcome(
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

function successfulCommit(value: CommandReceiptOutcome): DataCommitResult {
    return Object.freeze({ ok: true as const, value });
}

function conflictResult(
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

function committedPairOutcome(
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

function planConflictResult(reason: ConflictReason, versions: CurrentVersions): DataCommitResult {
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

/**
 * Builds a conflict problem carrying the authoritative Meeting series version.
 * @param {ConflictReason} reason - Stable conflict reason.
 * @param {CurrentVersions} versions - Current Workspace and PLAN versions.
 * @param {string} meetingSeriesId - Conflicted Meeting series identity.
 * @param {bigint} meetingSeriesVersion - Current Meeting series version.
 * @return {DataCommitResult} Unchanged conflict result.
 */
function meetingSeriesConflictResult(
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
function holidayRangeConflictResult(
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

function taskSeriesConflictResult(
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

function writerBusyResult(revision: bigint): DataCommitResult {
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

function permissionProblem(): DataOpenProblem {
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

function permissionCommitResult(revision: bigint): DataCommitResult {
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
function decisionRequiredResult(revision: bigint): DataCommitResult {
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
function meetingOverlapDecisionRequiredResult(
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

type SqliteOperationStage = 'pre-commit' | 'commit-outcome-unknown';

export type SqliteFailureDisposition =
    | Readonly<{ kind: 'retryable-unchanged'; reason: 'writer-busy' }>
    | Readonly<{ kind: 'read-only'; reason: 'permission' }>
    | Readonly<{ kind: 'failed-unchanged'; reason: 'storage-full' | 'recovery-required' }>
    | Readonly<{ kind: 'reopen-required' }>
    | Readonly<{ kind: 'unmapped' }>;

export function classifySqliteFailure(
    error: unknown,
    stage: SqliteOperationStage,
): SqliteFailureDisposition {
    let primaryCode: number | undefined;
    let systemCode: unknown;
    if (typeof error === 'object' && error !== null) {
        if ('errcode' in error && typeof error.errcode === 'number') {
            primaryCode = error.errcode & 0xFF;
        }
        if ('code' in error) {
            systemCode = error.code;
        }
    }

    if (stage === 'commit-outcome-unknown' && (primaryCode === 10 || primaryCode === 13)) {
        return Object.freeze({ kind: 'reopen-required' as const });
    }
    if (primaryCode === 5 || primaryCode === 6) {
        return Object.freeze({ kind: 'retryable-unchanged' as const, reason: 'writer-busy' as const });
    }
    if (primaryCode === 8 || systemCode === 'EACCES' || systemCode === 'EPERM') {
        return Object.freeze({ kind: 'read-only' as const, reason: 'permission' as const });
    }
    if (primaryCode === 13) {
        return Object.freeze({ kind: 'failed-unchanged' as const, reason: 'storage-full' as const });
    }
    if (primaryCode === 10) {
        return Object.freeze({ kind: 'failed-unchanged' as const, reason: 'recovery-required' as const });
    }
    return Object.freeze({ kind: 'unmapped' as const });
}

class SqliteDataStoreImplementation {
    private accepting = true;
    private closed = false;
    private closePromise: Promise<void> | undefined;
    private finishClose: (() => void) | undefined;
    private failClose: ((error: unknown) => void) | undefined;
    private readonly queue: CommitWork[] = [];
    private revision: bigint;
    private running = false;
    private terminalError: Error | undefined;

    public constructor(
        private readonly database: DatabaseSync,
        private readonly workspaceId: string,
        revision: bigint,
        private readOnly = false,
    ) {
        this.revision = revision;
    }

    public status(): WorkspaceDataStatus {
        this.requireOpen();
        if (this.readOnly) {
            return Object.freeze({
                kind: 'read-only' as const,
                workspaceId: this.workspaceId,
                schemaLevel: CURRENT_SCHEMA_LEVEL,
                revision: this.revision.toString(),
                problem: permissionProblem(),
            });
        }
        return {
            kind: 'ready',
            workspaceId: this.workspaceId,
            schemaLevel: CURRENT_SCHEMA_LEVEL,
            revision: this.revision.toString(),
        };
    }

    public readWorkspaceSetupSnapshot(
        options: ReadSnapshotOptions = {},
    ): WorkspaceSetupSnapshot {
        this.requireOpen();
        try {
            this.database.exec('BEGIN');
            const revisionStatement = this.database.prepare(
                'SELECT revision FROM workspace_state WHERE singleton = 1',
            );
            revisionStatement.setReadBigInts(true);
            const revision = (revisionStatement.get() as { revision: bigint }).revision;
            options.failpoint?.('read.after-revision');

            const setupStatement = this.database.prepare(`
                SELECT workspace_state.workspace_id, setup_state.last_decision, setup_state.setup_decision_version
                FROM workspace_state
                JOIN setup_state ON setup_state.singleton = workspace_state.singleton
                WHERE workspace_state.singleton = 1
            `);
            setupStatement.setReadBigInts(true);
            const setup = setupStatement.get() as {
                workspace_id: string;
                last_decision: 'later' | 'skip' | null;
                setup_decision_version: bigint;
            };
            this.database.exec('COMMIT');

            return Object.freeze({
                revision: revision.toString(),
                setup: Object.freeze({
                    workspaceId: setup.workspace_id,
                    lastDecision: setup.last_decision,
                    entityVersion: setup.setup_decision_version.toString(),
                }),
            });
        } catch (error) {
            this.rollbackOrRequireReopen();
            throw error;
        }
    }

    public readSetupProjection(options: ReadSnapshotOptions = {}): SetupProjection {
        this.requireOpen();
        try {
            this.database.exec('BEGIN');
            const state = this.database.prepare(`
                SELECT workspace_state.revision, plan_state.current_term_id, plan_state.plan_entity_version
                FROM workspace_state
                JOIN plan_state ON plan_state.singleton = workspace_state.singleton
                WHERE workspace_state.singleton = 1
            `);
            state.setReadBigInts(true);
            const stateRow = state.get() as {
                revision: bigint;
                current_term_id: string | null;
                plan_entity_version: bigint;
            };
            options.failpoint?.('read.after-revision');

            const termsStatement = this.database.prepare(`
                SELECT term_id, name, start_date, end_date, time_zone, archived, entity_version
                FROM terms
                ORDER BY start_date, term_id
            `);
            termsStatement.setReadBigInts(true);
            const termRows = termsStatement.all() as Array<{
                term_id: string;
                name: string;
                start_date: string;
                end_date: string;
                time_zone: string;
                archived: bigint;
                entity_version: bigint;
            }>;
            const terms = Object.freeze(termRows.map((row) => Object.freeze({
                termId: row.term_id,
                name: row.name,
                startDate: row.start_date,
                endDate: row.end_date,
                timeZone: row.time_zone,
                archived: row.archived === 1n,
                entityVersion: row.entity_version.toString(),
            })));
            const currentTerm = stateRow.current_term_id === null
                ? null
                : terms.find((term) => term.termId === stateRow.current_term_id) ?? null;
            if (stateRow.current_term_id !== null && currentTerm === null) {
                throw new Error('Current Term is missing');
            }

            const holidayStatement = this.database.prepare(`
                SELECT holiday_range_id, term_id, name, start_date, end_date, entity_version
                FROM holiday_ranges
                WHERE tombstoned = 0
                ORDER BY term_id, start_date, holiday_range_id
            `);
            holidayStatement.setReadBigInts(true);
            const holidayRows = holidayStatement.all() as Array<{
                holiday_range_id: string;
                term_id: string;
                name: string;
                start_date: string;
                end_date: string;
                entity_version: bigint;
            }>;
            const holidayRanges = Object.freeze(holidayRows.map(row => Object.freeze({
                holidayRangeId: row.holiday_range_id,
                termId: row.term_id,
                name: row.name,
                startDate: row.start_date,
                endDate: row.end_date,
                entityVersion: row.entity_version.toString(),
            })));

            const courseStatement = this.database.prepare(`
                SELECT
                    courses.course_id,
                    courses.term_id,
                    courses.code,
                    courses.name,
                    courses.section,
                    courses.instructor,
                    courses.color,
                    courses.credits_coefficient,
                    courses.credits_scale,
                    courses.teaching_range_kind,
                    courses.teaching_start_date,
                    courses.teaching_end_date,
                    courses.archived,
                    terms.start_date AS term_start_date,
                    terms.end_date AS term_end_date,
                    courses.entity_version
                FROM courses
                JOIN terms ON terms.term_id = courses.term_id
                ORDER BY code, course_id
            `);
            courseStatement.setReadBigInts(true);
            const courseRows = courseStatement.all() as Array<{
                    course_id: string;
                    term_id: string;
                    code: string;
                    name: string;
                    section: string | null;
                    instructor: string | null;
                    color: CourseColor | null;
                    credits_coefficient: bigint | null;
                    credits_scale: bigint | null;
                    teaching_range_kind: CourseTeachingRangeIntent['kind'];
                    teaching_start_date: string | null;
                    teaching_end_date: string | null;
                    archived: bigint;
                    term_start_date: string;
                    term_end_date: string;
                    entity_version: bigint;
                }>;
            const meetingStatement = this.database.prepare(`
                SELECT
                    meeting_series.meeting_series_id,
                    meeting_series.course_id,
                    meeting_series.entity_version,
                    meeting_segments.meeting_segment_id,
                    meeting_segments.logical_start_anchor,
                    meeting_segments.meeting_type,
                    meeting_segments.weekday,
                    meeting_segments.local_start,
                    meeting_segments.local_end,
                    meeting_segments.end_day_offset,
                    meeting_segments.effective_range_kind,
                    meeting_segments.effective_start_date,
                    meeting_segments.effective_end_date,
                    meeting_segments.location_kind,
                    meeting_segments.location_value
                FROM meeting_series
                JOIN meeting_segments
                    ON meeting_segments.meeting_series_id = meeting_series.meeting_series_id
                ORDER BY
                    meeting_series.course_id,
                    meeting_series.meeting_series_id,
                    meeting_segments.logical_start_anchor,
                    meeting_segments.meeting_segment_id
            `);
            meetingStatement.setReadBigInts(true);
            const meetingRows = meetingStatement.all() as Array<{
                    meeting_series_id: string;
                    course_id: string;
                    entity_version: bigint;
                    meeting_segment_id: string;
                    logical_start_anchor: string | null;
                    meeting_type: MeetingTypeCode;
                    weekday: MeetingWeekday;
                    local_start: string;
                    local_end: string;
                    end_day_offset: bigint;
                    effective_range_kind: MeetingEffectiveRangeIntent['kind'];
                    effective_start_date: string | null;
                    effective_end_date: string | null;
                    location_kind: 'known' | 'tba';
                    location_value: string | null;
                }>;
            const latestMeetingRows = Array.from(meetingRows.reduce((latest, meeting) => {
                latest.set(meeting.meeting_series_id, meeting);
                return latest;
            }, new Map<string, typeof meetingRows[number]>()).values());
            const courses = Object.freeze(courseRows.map((course) => {
                const teachingStartDate = course.teaching_range_kind === 'inherit-term'
                    ? course.term_start_date
                    : course.teaching_start_date!;
                const teachingEndDate = course.teaching_range_kind === 'inherit-term'
                    ? course.term_end_date
                    : course.teaching_end_date!;
                return Object.freeze({
                    courseId: course.course_id,
                    termId: course.term_id,
                    code: course.code,
                    name: course.name,
                    section: course.section,
                    instructor: course.instructor,
                    color: course.color,
                    credits: course.credits_coefficient === null || course.credits_scale === null
                        ? null
                        : decimalFromCoefficient(course.credits_coefficient, course.credits_scale),
                    teachingRange: Object.freeze({
                        kind: course.teaching_range_kind,
                        startDate: teachingStartDate,
                        endDate: teachingEndDate,
                    }),
                    archived: course.archived === 1n,
                    entityVersion: course.entity_version.toString(),
                    meetings: Object.freeze(latestMeetingRows
                        .filter(meeting => meeting.course_id === course.course_id)
                        .map(meeting => Object.freeze({
                            meetingSeriesId: meeting.meeting_series_id,
                            type: Object.freeze({
                                code: meeting.meeting_type,
                                name: meetingTypeName(meeting.meeting_type),
                            }),
                            weekday: meeting.weekday,
                            localStart: meeting.local_start,
                            localEnd: meeting.local_end,
                            endDayOffset: Number(meeting.end_day_offset) as MeetingEndDayOffset,
                            effectiveRange: Object.freeze({
                                kind: meeting.effective_range_kind,
                                startDate: meeting.effective_range_kind === 'inherit-course'
                                    ? teachingStartDate
                                    : meeting.effective_start_date!,
                                endDate: meeting.effective_range_kind === 'inherit-course'
                                    ? teachingEndDate
                                    : meeting.effective_end_date!,
                            }),
                            location: meeting.location_kind === 'tba'
                                ? Object.freeze({ kind: 'tba' as const })
                                : Object.freeze({
                                    kind: 'known' as const,
                                    value: meeting.location_value!,
                                }),
                            entityVersion: meeting.entity_version.toString(),
                        }))),
                });
            }));

            const taskStatement = this.database.prepare(`
                SELECT
                    task_series.task_series_id,
                    task_series.course_id,
                    task_series.entity_version,
                    task_segments.title,
                    task_segments.task_size,
                    task_segments.schedule_kind,
                    task_segments.deadline_kind,
                    task_segments.deadline_date,
                    task_segments.deadline_instant,
                    task_segments.deadline_display_zone,
                    task_segments.weekly_start_date,
                    task_segments.weekly_weekday,
                    task_segments.weekly_local_deadline_time,
                    task_segments.weekly_confirmed_end_date,
                    task_segments.follow_teaching_week,
                    task_segments.logical_start_anchor,
                    task_occurrence_states.status,
                    task_occurrence_states.self_reported_progress,
                    task_occurrence_overrides.override_kind,
                    task_occurrence_overrides.replacement_title,
                    task_occurrence_overrides.replacement_task_size,
                    task_occurrence_overrides.replacement_deadline_kind,
                    task_occurrence_overrides.replacement_deadline_date,
                    task_occurrence_overrides.replacement_deadline_instant,
                    task_occurrence_overrides.replacement_deadline_display_zone
                FROM task_series
                JOIN task_segments ON task_segments.task_series_id = task_series.task_series_id
                LEFT JOIN task_occurrence_states
                    ON task_occurrence_states.task_series_id = task_series.task_series_id
                    AND task_occurrence_states.original_logical_anchor = 'once'
                LEFT JOIN task_occurrence_overrides
                    ON task_occurrence_overrides.task_series_id = task_series.task_series_id
                    AND task_occurrence_overrides.original_logical_anchor = 'once'
                WHERE task_series.retired = 0
                ORDER BY
                    task_series.course_id,
                    task_series.task_series_id,
                    task_segments.logical_start_anchor,
                    task_segments.task_segment_id
            `);
            taskStatement.setReadBigInts(true);
            const taskRows = taskStatement.all() as Array<{
                task_series_id: string;
                course_id: string;
                entity_version: bigint;
                title: string;
                task_size: TaskSize;
                logical_start_anchor: string;
                status: TaskOccurrenceStatus | null;
                self_reported_progress: bigint | null;
                override_kind: 'replaced' | 'deleted' | null;
                replacement_title: string | null;
                replacement_task_size: TaskSize | null;
                replacement_deadline_kind: TaskDeadline['kind'] | null;
                replacement_deadline_date: string | null;
                replacement_deadline_instant: string | null;
                replacement_deadline_display_zone: string | null;
            } & StoredTaskSchedule>;
            const latestTaskRows = Array.from(taskRows.reduce((latest, task) => {
                latest.set(task.task_series_id, task);
                return latest;
            }, new Map<string, typeof taskRows[number]>()).values());
            const tasks = Object.freeze(latestTaskRows.filter(row => (
                row.schedule_kind === 'weekly' || row.override_kind !== 'deleted'
            )).map(row => {
                const override = row.override_kind === 'replaced'
                    ? taskOverrideReplacement({ ...row, override_kind: 'replaced' })
                    : null;
                const common = {
                    taskSeriesId: row.task_series_id,
                    courseId: row.course_id,
                    title: override?.title ?? row.title,
                    size: override?.size ?? row.task_size,
                    entityVersion: row.entity_version.toString(),
                };
                const schedule = taskScheduleProjection(row);
                const state = taskOccurrenceStateProjection(
                    row.status === null
                        ? undefined
                        : {
                            original_logical_anchor: 'once',
                            status: row.status,
                            self_reported_progress: row.self_reported_progress,
                            entity_version: 1n,
                        },
                    common.size,
                );
                return schedule.kind === 'weekly'
                    ? Object.freeze({ ...common, schedule })
                    : Object.freeze({
                        ...common,
                        deadline: override?.deadline ?? schedule.deadline,
                        occurrenceId: deriveTaskOccurrenceId(row.task_series_id),
                        ...state,
                        overrideKind: override ? 'replaced' as const : 'none' as const,
                    });
            }));
            this.database.exec('COMMIT');

            return Object.freeze({
                workspaceRevision: stateRow.revision.toString(),
                planEntityVersion: stateRow.plan_entity_version.toString(),
                currentTerm,
                terms,
                courses,
                holidayRanges,
                tasks,
            });
        }
        catch (error) {
            this.rollbackOrRequireReopen();
            throw error;
        }
    }

    /**
     * Reads all facts required for unified PLAN projections from one snapshot.
     * @param {ReadSnapshotOptions} options - Optional deterministic snapshot seam.
     * @return {PlanProjectionSource} Current-Term facts bound to one revision.
     */
    public readPlanProjectionSource(options: ReadSnapshotOptions = {}): PlanProjectionSource {
        this.requireOpen();
        try {
            this.database.exec('BEGIN');
            const stateStatement = this.database.prepare(`
                SELECT workspace_state.revision, plan_state.current_term_id, plan_state.plan_entity_version
                FROM workspace_state
                JOIN plan_state ON plan_state.singleton = workspace_state.singleton
                WHERE workspace_state.singleton = 1
            `);
            stateStatement.setReadBigInts(true);
            const state = stateStatement.get() as {
                revision: bigint;
                current_term_id: string | null;
                plan_entity_version: bigint;
            };
            options.failpoint?.('read.after-revision');
            if (state.current_term_id === null) {
                throw new TypeError('Current Term does not exist');
            }

            const termStatement = this.database.prepare(`
                SELECT term_id, name, start_date, end_date, time_zone, archived, entity_version
                FROM terms
                WHERE term_id = ?
            `);
            termStatement.setReadBigInts(true);
            const termRow = termStatement.get(state.current_term_id) as {
                term_id: string;
                name: string;
                start_date: string;
                end_date: string;
                time_zone: string;
                archived: bigint;
                entity_version: bigint;
            } | undefined;
            if (!termRow) {
                throw new Error('Current Term reference does not resolve');
            }
            const term: TermProjection = Object.freeze({
                termId: termRow.term_id,
                name: termRow.name,
                startDate: termRow.start_date,
                endDate: termRow.end_date,
                timeZone: termRow.time_zone,
                archived: termRow.archived === 1n,
                entityVersion: termRow.entity_version.toString(),
            });
            const requestedWindow = Object.freeze({
                startDate: term.startDate,
                endDate: term.endDate,
            });

            const taskSeriesRows = this.database.prepare(`
                SELECT task_series.task_series_id, courses.course_id, courses.code
                FROM task_series
                JOIN courses ON courses.course_id = task_series.course_id
                WHERE courses.term_id = ? AND courses.archived = 0 AND task_series.retired = 0
                ORDER BY courses.course_id, task_series.task_series_id
            `).all(term.termId) as Array<{
                task_series_id: string;
                course_id: string;
                code: string;
            }>;
            const taskSources: PlanTaskSource[] = [];
            for (const row of taskSeriesRows) {
                const detail = this.readTaskSeriesDetail(row.task_series_id, requestedWindow);
                for (const occurrence of detail.occurrences) {
                    taskSources.push(Object.freeze({
                        courseId: row.course_id,
                        courseCode: row.code,
                        occurrence,
                    }));
                }
            }

            const meetingSeriesRows = this.database.prepare(`
                SELECT meeting_series.meeting_series_id, courses.course_id, courses.code
                FROM meeting_series
                JOIN courses ON courses.course_id = meeting_series.course_id
                WHERE courses.term_id = ? AND courses.archived = 0 AND meeting_series.retired = 0
                ORDER BY courses.course_id, meeting_series.meeting_series_id
            `).all(term.termId) as Array<{
                meeting_series_id: string;
                course_id: string;
                code: string;
            }>;
            const meetingSources: PlanMeetingSource[] = [];
            for (const row of meetingSeriesRows) {
                const detail = this.readMeetingSeriesDetail(row.meeting_series_id, requestedWindow);
                for (const occurrence of detail.occurrences) {
                    meetingSources.push(Object.freeze({
                        courseId: row.course_id,
                        courseCode: row.code,
                        occurrence,
                    }));
                }
            }

            const holidayStatement = this.database.prepare(`
                SELECT holiday_range_id, name, start_date, end_date, entity_version
                FROM holiday_ranges
                WHERE term_id = ? AND tombstoned = 0
                ORDER BY start_date, holiday_range_id
            `);
            holidayStatement.setReadBigInts(true);
            const holidayRows = holidayStatement.all(term.termId) as Array<{
                holiday_range_id: string;
                name: string;
                start_date: string;
                end_date: string;
                entity_version: bigint;
            }>;
            const holidayRanges: readonly HolidayRangeProjection[] = Object.freeze(
                holidayRows.map(row => Object.freeze({
                    holidayRangeId: row.holiday_range_id,
                    termId: term.termId,
                    name: row.name,
                    startDate: row.start_date,
                    endDate: row.end_date,
                    entityVersion: row.entity_version.toString(),
                })),
            );
            this.database.exec('COMMIT');
            return Object.freeze({
                workspaceRevision: state.revision.toString(),
                planEntityVersion: state.plan_entity_version.toString(),
                term,
                taskSources: Object.freeze(taskSources),
                meetingSources: Object.freeze(meetingSources),
                holidayRanges,
            });
        }
        catch (error) {
            this.rollbackOrRequireReopen();
            throw error;
        }
    }

    /**
     * Reads active named ranges for deterministic Meeting suppression inside the current snapshot.
     * @param {string} termId - Owning Term identity.
     * @return {readonly StoredHolidayRange[]} Inclusive active ranges in deterministic order.
     */
    private readActiveHolidayRanges(termId: string): readonly StoredHolidayRange[] {
        return this.database.prepare(`
            SELECT holiday_range_id, start_date, end_date
            FROM holiday_ranges
            WHERE term_id = ? AND tombstoned = 0
            ORDER BY start_date, holiday_range_id
        `).all(termId) as StoredHolidayRange[];
    }

    /**
     * Reads one bounded Task series projection without storing ordinary weekly occurrences.
     * @param {string} taskSeriesId - Stable Task series identity.
     * @param {TaskOccurrenceWindow} candidateWindow - Requested inclusive LocalDate window.
     * @return {TaskSeriesDetailProjection} Revision-bound Task rule and derived occurrences.
     */
    public readTaskSeriesDetail(
        taskSeriesId: string,
        candidateWindow: TaskOccurrenceWindow,
    ): TaskSeriesDetailProjection {
        this.requireOpen();
        if (!isCanonicalUuid(taskSeriesId)) {
            throw new TypeError('TaskSeriesId must be a canonical UUID');
        }
        const requestedWindow = normalizeTaskOccurrenceWindow(candidateWindow);

        try {
            this.database.exec('SAVEPOINT read_task_series_detail');
            const seriesStatement = this.database.prepare(`
                SELECT
                    task_series.course_id,
                    task_series.entity_version,
                    terms.term_id,
                    terms.time_zone,
                    workspace_state.revision,
                    plan_state.plan_entity_version
                FROM task_series
                JOIN courses ON courses.course_id = task_series.course_id
                JOIN terms ON terms.term_id = courses.term_id
                JOIN workspace_state ON workspace_state.singleton = 1
                JOIN plan_state ON plan_state.singleton = workspace_state.singleton
                WHERE task_series.task_series_id = ? AND task_series.retired = 0
            `);
            seriesStatement.setReadBigInts(true);
            const series = seriesStatement.get(taskSeriesId) as {
                course_id: string;
                entity_version: bigint;
                term_id: string;
                time_zone: string;
                revision: bigint;
                plan_entity_version: bigint;
            } | undefined;
            if (!series) {
                throw new TypeError('Task series does not exist');
            }

            const segmentStatement = this.database.prepare(`
                SELECT
                    task_segment_id,
                    title,
                    task_size,
                    schedule_kind,
                    deadline_kind,
                    deadline_date,
                    deadline_instant,
                    deadline_display_zone,
                    logical_start_anchor,
                    logical_end_anchor,
                    weekly_start_date,
                    weekly_weekday,
                    weekly_local_deadline_time,
                    weekly_confirmed_end_date,
                    follow_teaching_week
                FROM task_segments
                WHERE task_series_id = ?
                ORDER BY logical_start_anchor, task_segment_id
            `);
            segmentStatement.setReadBigInts(true);
            const segmentRows = segmentStatement.all(taskSeriesId) as StoredTaskSegment[];
            const latestSegment = segmentRows.at(-1);
            if (!latestSegment) {
                throw new Error('Task series has no segment');
            }
            const overrideStatement = this.database.prepare(`
                SELECT
                    original_logical_anchor,
                    override_kind,
                    replacement_title,
                    replacement_task_size,
                    replacement_deadline_kind,
                    replacement_deadline_date,
                    replacement_deadline_instant,
                    replacement_deadline_display_zone,
                    entity_version
                FROM task_occurrence_overrides
                WHERE task_series_id = ?
                ORDER BY original_logical_anchor
            `);
            overrideStatement.setReadBigInts(true);
            const overrideRows = overrideStatement.all(taskSeriesId) as StoredTaskOccurrenceOverride[];
            const stateStatement = this.database.prepare(`
                SELECT
                    original_logical_anchor,
                    status,
                    self_reported_progress,
                    entity_version
                FROM task_occurrence_states
                WHERE task_series_id = ?
                ORDER BY original_logical_anchor
            `);
            stateStatement.setReadBigInts(true);
            const stateRows = stateStatement.all(taskSeriesId) as StoredTaskOccurrenceState[];
            const schedule = taskScheduleProjection(latestSegment);
            const projectionBase = {
                workspaceRevision: series.revision.toString(),
                planEntityVersion: series.plan_entity_version.toString(),
                requestedWindow,
                termZone: series.time_zone,
                taskSeriesId,
                courseId: series.course_id,
                title: latestSegment.title,
                size: latestSegment.task_size,
                entityVersion: series.entity_version.toString(),
            } as const;
            const segments = Object.freeze(segmentRows.map(segment => Object.freeze({
                segmentId: segment.task_segment_id,
                logicalStartAnchor: segment.logical_start_anchor,
                logicalEndAnchor: segment.logical_end_anchor,
                replacement: segment.schedule_kind === 'once'
                    ? Object.freeze({
                        title: segment.title,
                        size: segment.task_size,
                        deadline: taskDeadlineProjection(
                            segment.deadline_kind!,
                            segment.deadline_date,
                            segment.deadline_instant,
                            segment.deadline_display_zone,
                        ),
                    })
                    : Object.freeze({
                        title: segment.title,
                        size: segment.task_size,
                        weekday: segment.weekly_weekday!,
                        localDeadlineTime: segment.weekly_local_deadline_time!,
                        followTeachingWeek: segment.follow_teaching_week === 1n,
                    }),
            })));
            const overrides = Object.freeze(overrideRows.map(override => (
                override.override_kind === 'deleted'
                    ? Object.freeze({
                        occurrenceId: deriveTaskOccurrenceId(
                            taskSeriesId,
                            override.original_logical_anchor,
                        ),
                        kind: 'deleted' as const,
                    })
                    : Object.freeze({
                        occurrenceId: deriveTaskOccurrenceId(
                            taskSeriesId,
                            override.original_logical_anchor,
                        ),
                        kind: 'replaced' as const,
                        replacement: taskOverrideReplacement(override),
                    })
            )));
            const historicalStates = Object.freeze(stateRows.map(state => {
                const segment = taskSegmentForAnchor(segmentRows, state.original_logical_anchor);
                const override = overrideRows.find(candidate => (
                    candidate.original_logical_anchor === state.original_logical_anchor
                ));
                const replacement = override?.override_kind === 'replaced'
                    ? taskOverrideReplacement(override)
                    : segment
                        ? Object.freeze({
                            title: segment.title,
                            size: segment.task_size,
                            deadline: taskSegmentOccurrenceDeadline(
                                segment,
                                state.original_logical_anchor,
                                series.time_zone,
                            ),
                        })
                        : null;
                if (!replacement) {
                    throw new Error('Task occurrence history has no retained facts');
                }
                return Object.freeze({
                    occurrenceId: deriveTaskOccurrenceId(taskSeriesId, state.original_logical_anchor),
                    ...taskOccurrenceStateProjection(state, replacement.size),
                    ...replacement,
                });
            }));
            let projection: TaskSeriesDetailProjection;
            if (schedule.kind === 'once') {
                const segment = segmentRows[0]!;
                const override = overrideRows.find(candidate => candidate.original_logical_anchor === 'once');
                const occurrences: OnceTaskOccurrenceProjection[] = [];
                if (override?.override_kind !== 'deleted') {
                    const replacement = override
                        ? taskOverrideReplacement(override)
                        : Object.freeze({
                            title: segment.title,
                            size: segment.task_size,
                            deadline: schedule.deadline,
                        });
                    occurrences.push(Object.freeze({
                        occurrenceId: deriveTaskOccurrenceId(taskSeriesId),
                        ...replacement,
                        segmentId: segment.task_segment_id,
                        ...taskOccurrenceStateProjection(stateRows[0], replacement.size),
                        overrideKind: override ? 'replaced' as const : 'none' as const,
                    }));
                }
                projection = Object.freeze({
                    ...projectionBase,
                    schedule,
                    segments,
                    overrides,
                    historicalStates,
                    occurrences: Object.freeze(occurrences),
                });
            }
            else {
                const occurrences: WeeklyTaskOccurrenceProjection[] = [];
                const holidayRanges = this.readActiveHolidayRanges(series.term_id);
                for (const segment of segmentRows) {
                    let anchor = segment.logical_start_anchor;
                    while (anchor <= segment.logical_end_anchor) {
                        const date = occurrenceDate(anchor, segment.weekly_weekday!);
                        if (date === null) {
                            throw new Error('Task occurrence date is outside the LocalDate domain');
                        }
                        const isHoliday = segment.follow_teaching_week === 1n
                            && holidayRanges.some(range => date >= range.start_date && date <= range.end_date);
                        const override = overrideRows.find(candidate => (
                            candidate.original_logical_anchor === anchor
                        ));
                        if (date >= requestedWindow.startDate
                            && date <= requestedWindow.endDate
                            && (!isHoliday || override?.override_kind === 'replaced')
                            && override?.override_kind !== 'deleted') {
                            const replacement = override
                                ? taskOverrideReplacement(override)
                                : Object.freeze({
                                    title: segment.title,
                                    size: segment.task_size,
                                    deadline: taskSegmentOccurrenceDeadline(segment, anchor, series.time_zone),
                                });
                            const state = stateRows.find(candidate => candidate.original_logical_anchor === anchor);
                            occurrences.push(Object.freeze({
                                occurrenceId: deriveTaskOccurrenceId(taskSeriesId, anchor),
                                ...replacement,
                                segmentId: segment.task_segment_id,
                                ...taskOccurrenceStateProjection(state, replacement.size),
                                overrideKind: override ? 'replaced' as const : 'none' as const,
                            }));
                        }
                        if (anchor > '9999-12-24') {
                            break;
                        }
                        anchor = addLocalDateDays(anchor, 7);
                    }
                }
                projection = Object.freeze({
                    ...projectionBase,
                    schedule,
                    segments,
                    overrides,
                    historicalStates,
                    occurrences: Object.freeze(occurrences),
                });
            }
            this.database.exec('RELEASE SAVEPOINT read_task_series_detail');
            return projection;
        }
        catch (error) {
            this.rollbackOrRequireReopen();
            throw error;
        }
    }

    /**
     * Previews and version-binds a Task this-and-future rule change or deletion without writing.
     * @param {TaskOccurrenceImpactDraft} candidate - Untrusted exact future mutation draft.
     * @return {TaskOccurrenceImpactProjection} Current and proposed bounded occurrence facts.
     */
    public previewTaskOccurrenceChange(
        candidate: TaskOccurrenceImpactDraft,
    ): TaskOccurrenceImpactProjection {
        this.requireOpen();
        const draft = normalizeTaskOccurrenceImpactDraft(candidate);
        const detail = this.readTaskSeriesDetail(draft.taskSeriesId, draft.requestedWindow);
        if (draft.scope === 'this-and-future' && detail.schedule.kind !== 'weekly') {
            throw new TypeError('This-and-future scope requires a weekly Task series');
        }
        const originalLogicalAnchor = draft.scope === 'whole-series'
            ? null
            : draft.originalLogicalAnchor;
        const target = originalLogicalAnchor === null
            ? null
            : detail.occurrences.find(occurrence => (
                occurrence.occurrenceId.originalLogicalAnchor === originalLogicalAnchor
            ));
        if (originalLogicalAnchor !== null && !target) {
            throw new TypeError('Task occurrence impact target is outside the requested window');
        }
        if (draft.scope === 'only-this' && target!.status !== 'pending') {
            throw new TypeError('Terminal Task occurrence history is not deletable as only-this');
        }

        try {
            this.database.exec('BEGIN');
            const versions = this.currentVersions();
            const seriesStatement = this.database.prepare(`
                SELECT
                    task_series.entity_version,
                    task_series.retired,
                    terms.term_id,
                    terms.time_zone
                FROM task_series
                JOIN courses ON courses.course_id = task_series.course_id
                JOIN terms ON terms.term_id = courses.term_id
                WHERE task_series.task_series_id = ?
            `);
            seriesStatement.setReadBigInts(true);
            const series = seriesStatement.get(draft.taskSeriesId) as {
                entity_version: bigint;
                retired: bigint;
                term_id: string;
                time_zone: string;
            } | undefined;
            if (!series
                || series.retired !== 0n
                || versions.revision.toString() !== detail.workspaceRevision
                || versions.planVersion.toString() !== detail.planEntityVersion
                || series.entity_version.toString() !== detail.entityVersion) {
                throw new Error('Task impact snapshot changed while it was being prepared');
            }

            const inAffectedScope = (anchor: string): boolean => {
                if (originalLogicalAnchor === null) {
                    return true;
                }
                return draft.scope === 'only-this'
                    ? anchor === originalLogicalAnchor
                    : anchor >= originalLogicalAnchor;
            };
            const affectedSegmentCount = draft.scope === 'whole-series'
                ? detail.segments.length
                : draft.scope === 'only-this'
                    ? 1
                    : detail.segments.filter(segment => (
                        segment.logicalEndAnchor >= originalLogicalAnchor!
                    )).length;
            const futureOverrideCount = detail.overrides.filter(override => (
                inAffectedScope(override.occurrenceId.originalLogicalAnchor)
            )).length;
            const historicalStateCount = detail.historicalStates.filter(state => (
                inAffectedScope(state.occurrenceId.originalLogicalAnchor)
                && state.status !== 'pending'
            )).length;
            const currentFutureOccurrences = Object.freeze(
                draft.scope === 'whole-series'
                    ? [...detail.occurrences]
                    : draft.scope === 'only-this'
                        ? [target!]
                        : detail.occurrences.filter(occurrence => (
                            occurrence.occurrenceId.originalLogicalAnchor >= originalLogicalAnchor!
                        )),
            );
            const futureOccurrencesAfterChange: Array<Omit<TaskOccurrenceProjection, 'segmentId'>> = [];
            if (draft.action === 'change') {
                const holidayRanges = draft.replacement.followTeachingWeek
                    ? this.readActiveHolidayRanges(series.term_id)
                    : Object.freeze([]);
                const finalAnchor = detail.segments.at(-1)!.logicalEndAnchor;
                let anchor = draft.originalLogicalAnchor;
                while (anchor <= finalAnchor) {
                    const date = occurrenceDate(anchor, draft.replacement.weekday);
                    if (date === null
                        || date < draft.requestedWindow.startDate
                        || date > draft.requestedWindow.endDate
                        || holidayRanges.some(range => date >= range.start_date && date <= range.end_date)) {
                        if (anchor > '9999-12-24') {
                            break;
                        }
                        anchor = addLocalDateDays(anchor, 7);
                        continue;
                    }
                    const state = detail.historicalStates.find(candidate => (
                        candidate.occurrenceId.originalLogicalAnchor === anchor
                    ));
                    const override = detail.overrides.find(candidate => (
                        candidate.occurrenceId.originalLogicalAnchor === anchor
                    ));
                    const retainsExactFacts = state?.status !== undefined && state.status !== 'pending'
                        || (anchor > draft.originalLogicalAnchor && override?.kind === 'replaced');
                    const exactReplacement = state && retainsExactFacts
                        ? Object.freeze({
                            title: state.title,
                            size: state.size,
                            deadline: state.deadline,
                        })
                        : override?.kind === 'replaced' && retainsExactFacts
                            ? override.replacement
                            : null;
                    const effectiveSize = exactReplacement?.size ?? draft.replacement.size;
                    const status = state?.status ?? 'pending';
                    const reportedProgress = effectiveSize === 'large'
                        ? state?.reportedProgress ?? null
                        : null;
                    futureOccurrencesAfterChange.push(Object.freeze({
                        occurrenceId: deriveTaskOccurrenceId(draft.taskSeriesId, anchor),
                        title: exactReplacement?.title ?? draft.replacement.title,
                        size: effectiveSize,
                        deadline: exactReplacement?.deadline ?? Object.freeze({
                            kind: 'timed' as const,
                            instant: INTL_ZONE_RULES.resolveInstant(
                                series.time_zone,
                                date,
                                draft.replacement.localDeadlineTime,
                            ),
                            timeZone: series.time_zone,
                        }),
                        status,
                        reportedProgress,
                        displayProgress: effectiveSize !== 'large'
                            ? null
                            : status === 'completed'
                                ? 100
                                : reportedProgress,
                        overrideKind: retainsExactFacts ? 'replaced' as const : 'none' as const,
                    }));
                    if (anchor > '9999-12-24') {
                        break;
                    }
                    anchor = addLocalDateDays(anchor, 7);
                }
            }
            const confirmationToken = taskOccurrenceConfirmationToken(
                detail.workspaceRevision,
                detail.planEntityVersion,
                detail.entityVersion,
                draft,
            );
            const choiceId = draft.scope === 'only-this'
                ? 'apply-only-this' as const
                : draft.scope === 'whole-series'
                    ? 'delete-whole-series' as const
                    : 'apply-this-and-future' as const;
            const effectCode = draft.action === 'change'
                ? 'plan.task-occurrence-changed' as const
                : draft.scope === 'whole-series'
                    ? 'plan.task-series-deleted' as const
                    : 'plan.task-occurrence-deleted' as const;
            const warnings = [
                ...(historicalStateCount === 0
                    ? []
                    : [Object.freeze({ code: 'terminal-history-retained' as const })]),
                ...(futureOverrideCount === 0
                    ? []
                    : [Object.freeze({ code: 'occurrence-overrides-retained' as const })]),
            ];
            this.database.exec('COMMIT');
            return Object.freeze({
                basedOnRevision: detail.workspaceRevision,
                planEntityVersion: detail.planEntityVersion,
                taskSeriesVersion: detail.entityVersion,
                affectedEntities: freezeTuple([Object.freeze({
                    kind: 'task-series' as const,
                    id: draft.taskSeriesId,
                    version: detail.entityVersion,
                })]),
                effects: freezeTuple([Object.freeze({
                    code: effectCode,
                    scope: draft.scope,
                    originalLogicalAnchor,
                    affectedFutureSegmentCount: affectedSegmentCount.toString(),
                    futureOverrideCount: futureOverrideCount.toString(),
                    historicalStateCount: historicalStateCount.toString(),
                    historicalStateAction: 'retain' as const,
                })]),
                warnings: Object.freeze(warnings),
                choices: freezeTuple([Object.freeze({ id: choiceId })]),
                defaultChoice: Object.freeze({ id: choiceId }),
                recoverability: Object.freeze({
                    kind: 'permanent' as const,
                    reason: draft.action === 'change'
                        ? 'task-rule-change-has-no-undo' as const
                        : 'task-deletion-has-no-undo' as const,
                }),
                unresolvedReferences: freezeEmptyTuple(),
                taskSeriesId: draft.taskSeriesId,
                originalLogicalAnchor,
                scope: draft.scope,
                action: draft.action,
                requestedWindow: draft.requestedWindow,
                affectedFutureSegmentCount: affectedSegmentCount.toString(),
                futureOverrideCount: futureOverrideCount.toString(),
                historicalStateCount: historicalStateCount.toString(),
                currentFutureOccurrences,
                futureOccurrencesAfterChange: Object.freeze(futureOccurrencesAfterChange),
                confirmationToken,
            });
        }
        catch (error) {
            this.rollbackOrRequireReopen();
            throw error;
        }
    }

    /**
     * Reads and expands all retained Meeting occurrences from the caller's active snapshot.
     * @param {MeetingOccurrenceWindow} requestedWindow - Bounded physical start-date window.
     * @param {string} termId - Owning Term whose occurrences can share one schedule.
     * @param {readonly StoredHolidayRange[]} candidateHolidayRanges - Optional proposed active ranges.
     * @return {readonly ConflictMeetingOccurrence[]} Effective scheduled occurrences across PLAN.
     */
    private readConflictMeetingOccurrences(
        requestedWindow: MeetingOccurrenceWindow,
        termId: string,
        candidateHolidayRanges?: readonly StoredHolidayRange[],
    ): readonly ConflictMeetingOccurrence[] {
        const holidayRanges = candidateHolidayRanges ?? this.readActiveHolidayRanges(termId);
        const segmentRows = this.database.prepare(`
            SELECT
                meeting_series.meeting_series_id,
                courses.course_id,
                courses.code AS course_code,
                terms.time_zone AS term_zone,
                meeting_segments.meeting_segment_id,
                meeting_segments.meeting_type,
                meeting_segments.weekday,
                meeting_segments.local_start,
                meeting_segments.local_end,
                meeting_segments.end_day_offset,
                meeting_segments.logical_start_anchor,
                meeting_segments.logical_end_anchor,
                meeting_segments.effective_range_kind,
                meeting_segments.effective_start_date,
                meeting_segments.effective_end_date,
                meeting_segments.location_kind,
                meeting_segments.location_value,
                CASE
                    WHEN meeting_segments.effective_range_kind = 'explicit'
                        THEN meeting_segments.effective_start_date
                    WHEN courses.teaching_range_kind = 'explicit'
                        THEN courses.teaching_start_date
                    ELSE terms.start_date
                END AS resolved_start_date,
                CASE
                    WHEN meeting_segments.effective_range_kind = 'explicit'
                        THEN meeting_segments.effective_end_date
                    WHEN courses.teaching_range_kind = 'explicit'
                        THEN courses.teaching_end_date
                    ELSE terms.end_date
                END AS resolved_end_date
            FROM meeting_segments
            JOIN meeting_series
                ON meeting_series.meeting_series_id = meeting_segments.meeting_series_id
            JOIN courses ON courses.course_id = meeting_series.course_id
            JOIN terms ON terms.term_id = courses.term_id
            WHERE meeting_series.retired = 0
                AND courses.archived = 0
                AND terms.archived = 0
                AND terms.term_id = ?
            ORDER BY
                meeting_series.meeting_series_id,
                meeting_segments.logical_start_anchor,
                meeting_segments.meeting_segment_id
        `).all(termId) as StoredConflictMeetingSegment[];
        const overrideRows = this.database.prepare(`
            SELECT
                meeting_series_id,
                original_logical_anchor,
                override_kind,
                meeting_type,
                weekday,
                local_start,
                local_end,
                end_day_offset,
                location_kind,
                location_value
            FROM meeting_occurrence_overrides
            ORDER BY meeting_series_id, original_logical_anchor
        `).all() as StoredConflictMeetingOverride[];
        const rowsBySeries = new Map<string, StoredConflictMeetingSegment[]>();
        for (const row of segmentRows) {
            const rows = rowsBySeries.get(row.meeting_series_id) ?? [];
            rows.push(row);
            rowsBySeries.set(row.meeting_series_id, rows);
        }

        const occurrences: ConflictMeetingOccurrence[] = [];
        for (const [meetingSeriesId, rows] of rowsBySeries) {
            const first = rows[0]!;
            occurrences.push(...expandConflictMeetingOccurrences(
                Object.freeze({
                    courseId: first.course_id,
                    courseCode: first.course_code,
                    meetingSeriesId,
                }),
                first.term_zone,
                rows,
                overrideRows.filter(override => override.meeting_series_id === meetingSeriesId),
                holidayRanges,
                requestedWindow,
            ));
        }
        return Object.freeze(occurrences);
    }

    /**
     * Reads a bounded Meeting series projection without persisting ordinary occurrences.
     * @param {string} meetingSeriesId - Stable Meeting series identity.
     * @param {MeetingOccurrenceWindow} candidateWindow - Requested physical-date window.
     * @return {MeetingSeriesDetailProjection} Revision-bound segment and occurrence projection.
     */
    public readMeetingSeriesDetail(
        meetingSeriesId: string,
        candidateWindow: MeetingOccurrenceWindow,
    ): MeetingSeriesDetailProjection {
        return this.readMeetingSeriesDetailProjection(meetingSeriesId, candidateWindow, null);
    }

    /**
     * Evaluates stored rules or a proposed future rule over one bounded window.
     * @param {string} meetingSeriesId - Stable Meeting series identity.
     * @param {MeetingOccurrenceWindow} candidateWindow - Requested physical-date window.
     * @param {MeetingOccurrenceImpactDraft | null} futureChange - Proposed split, or null for current facts.
     * @return {MeetingSeriesDetailProjection} Revision-bound derived occurrence projection.
     */
    private readMeetingSeriesDetailProjection(
        meetingSeriesId: string,
        candidateWindow: MeetingOccurrenceWindow,
        futureChange: MeetingOccurrenceImpactDraft | null,
    ): MeetingSeriesDetailProjection {
        this.requireOpen();
        if (!isCanonicalUuid(meetingSeriesId)) {
            throw new TypeError('MeetingSeriesId must be a canonical UUID');
        }
        const requestedWindow = normalizeMeetingOccurrenceWindow(candidateWindow);
        const expandedWindowStart = addClampedLocalDateDays(requestedWindow.startDate, -6);
        const expandedWindowEnd = addClampedLocalDateDays(requestedWindow.endDate, 6);

        try {
            this.database.exec('SAVEPOINT read_meeting_series_detail');
            const seriesStatement = this.database.prepare(`
                SELECT
                    meeting_series.course_id,
                    meeting_series.entity_version,
                    terms.term_id,
                    terms.time_zone,
                    workspace_state.revision,
                    plan_state.plan_entity_version
                FROM meeting_series
                JOIN courses ON courses.course_id = meeting_series.course_id
                JOIN terms ON terms.term_id = courses.term_id
                JOIN workspace_state ON workspace_state.singleton = 1
                JOIN plan_state ON plan_state.singleton = workspace_state.singleton
                WHERE meeting_series_id = ?
            `);
            seriesStatement.setReadBigInts(true);
            const series = seriesStatement.get(meetingSeriesId) as {
                course_id: string;
                entity_version: bigint;
                term_id: string;
                time_zone: string;
                revision: bigint;
                plan_entity_version: bigint;
            } | undefined;
            if (!series) {
                throw new TypeError('Meeting series does not exist');
            }
            const holidayRanges = this.readActiveHolidayRanges(series.term_id);

            const segmentRows = this.database.prepare(`
                SELECT
                    meeting_segments.meeting_segment_id,
                    meeting_segments.meeting_type,
                    meeting_segments.weekday,
                    meeting_segments.local_start,
                    meeting_segments.local_end,
                    meeting_segments.end_day_offset,
                    meeting_segments.logical_start_anchor,
                    meeting_segments.logical_end_anchor,
                    meeting_segments.effective_range_kind,
                    meeting_segments.effective_start_date,
                    meeting_segments.effective_end_date,
                    meeting_segments.location_kind,
                    meeting_segments.location_value,
                    CASE
                        WHEN meeting_segments.effective_range_kind = 'explicit'
                            THEN meeting_segments.effective_start_date
                        WHEN courses.teaching_range_kind = 'explicit'
                            THEN courses.teaching_start_date
                        ELSE terms.start_date
                    END AS resolved_start_date,
                    CASE
                        WHEN meeting_segments.effective_range_kind = 'explicit'
                            THEN meeting_segments.effective_end_date
                        WHEN courses.teaching_range_kind = 'explicit'
                            THEN courses.teaching_end_date
                        ELSE terms.end_date
                    END AS resolved_end_date
                FROM meeting_segments
                JOIN meeting_series
                    ON meeting_series.meeting_series_id = meeting_segments.meeting_series_id
                JOIN courses ON courses.course_id = meeting_series.course_id
                JOIN terms ON terms.term_id = courses.term_id
                WHERE meeting_segments.meeting_series_id = ?
                    AND meeting_segments.logical_start_anchor <= ?
                    AND (
                        meeting_segments.logical_end_anchor IS NULL
                        OR meeting_segments.logical_end_anchor >= ?
                    )
                ORDER BY meeting_segments.logical_start_anchor, meeting_segments.meeting_segment_id
            `).all(meetingSeriesId, expandedWindowEnd, expandedWindowStart) as StoredMeetingSegment[];
            const overrideRows = this.database.prepare(`
                SELECT
                    original_logical_anchor,
                    override_kind,
                    meeting_type,
                    weekday,
                    local_start,
                    local_end,
                    end_day_offset,
                    location_kind,
                    location_value
                FROM meeting_occurrence_overrides
                WHERE meeting_series_id = ?
                    AND original_logical_anchor BETWEEN ? AND ?
                ORDER BY original_logical_anchor
            `).all(meetingSeriesId, expandedWindowStart, expandedWindowEnd) as StoredMeetingOverride[];

            validateMeetingSegmentSequence(segmentRows);
            for (const override of overrideRows) {
                const matchingSegments = segmentRows.filter(segment => (
                    logicalAnchorBelongsToSegment(segment, override.original_logical_anchor)
                ));
                if (matchingSegments.length !== 1) {
                    throw new Error('Meeting override does not target a logical occurrence');
                }
            }

            const overrides = new Map(overrideRows.map(row => [row.original_logical_anchor, row]));
            const seenAnchors = new Set<string>();
            const segments = Object.freeze(segmentRows.map(row => Object.freeze({
                    segmentId: row.meeting_segment_id,
                    logicalStartAnchor: row.logical_start_anchor,
                    logicalEndAnchor: row.logical_end_anchor,
                    type: row.meeting_type,
                    weekday: row.weekday,
                    localStart: row.local_start,
                    localEnd: row.local_end,
                    endDayOffset: row.end_day_offset,
                    location: meetingLocation(row.location_kind, row.location_value),
                })));
            const occurrences = [] as Array<Readonly<{
                occurrenceId: MeetingOccurrenceId;
                segmentId: string;
                date: string;
                status: 'scheduled' | 'cancelled' | 'holiday-suppressed';
                overrideKind: 'replaced' | 'cancelled' | null;
                type: MeetingTypeCode;
                weekday: MeetingWeekday;
                localStart: string;
                localEnd: string;
                endDayOffset: MeetingEndDayOffset;
                startInstant: string;
                endInstant: string;
                location: MeetingLocation;
            }>>;
            for (const [index, segment] of segments.entries()) {
                const storedSegment = segmentRows[index]!;
                for (const anchor of candidateLogicalAnchors(storedSegment, requestedWindow)) {
                    if (seenAnchors.has(anchor)) {
                        throw new Error('Meeting occurrence logical anchor is duplicated');
                    }
                    seenAnchors.add(anchor);
                    const override = overrides.get(anchor);
                    const futureChangeApplies = futureChange !== null
                        && anchor >= futureChange.originalLogicalAnchor;
                    const retainedOverride = futureChangeApplies
                        && anchor === futureChange.originalLogicalAnchor
                        ? undefined
                        : override;
                    const baseRule: MeetingRuleReplacement = futureChangeApplies
                        ? futureChange.replacement
                        : {
                            type: segment.type,
                            weekday: segment.weekday,
                            localStart: segment.localStart,
                            localEnd: segment.localEnd,
                            endDayOffset: segment.endDayOffset,
                            location: segment.location,
                        };
                    if (!isActiveLogicalAnchor(storedSegment, anchor, baseRule.weekday)) {
                        continue;
                    }
                    const replacement: MeetingRuleReplacement = retainedOverride?.override_kind === 'replaced'
                        ? {
                            type: retainedOverride.meeting_type!,
                            weekday: retainedOverride.weekday!,
                            localStart: retainedOverride.local_start!,
                            localEnd: retainedOverride.local_end!,
                            endDayOffset: retainedOverride.end_day_offset!,
                            location: meetingLocation(
                                retainedOverride.location_kind!,
                                retainedOverride.location_value,
                            ),
                        }
                        : baseRule;
                    const baseDate = occurrenceDate(anchor, baseRule.weekday);
                    const date = occurrenceDate(anchor, replacement.weekday);
                    if (baseDate === null
                        || date === null
                        || date < requestedWindow.startDate
                        || date > requestedWindow.endDate) {
                        continue;
                    }
                    const instantWindow = resolveMeetingOccurrenceTime({
                        termZone: series.time_zone,
                        date,
                        localStart: replacement.localStart,
                        localEnd: replacement.localEnd,
                        endDayOffset: replacement.endDayOffset,
                    });
                    occurrences.push(Object.freeze({
                        occurrenceId: deriveMeetingOccurrenceId(meetingSeriesId, anchor),
                        segmentId: segment.segmentId,
                        date,
                        status: retainedOverride?.override_kind === 'cancelled'
                            ? 'cancelled'
                            : retainedOverride?.override_kind === 'replaced'
                                ? 'scheduled'
                                : holidayRanges.some(range => (
                                    baseDate >= range.start_date && baseDate <= range.end_date
                                ))
                                    ? 'holiday-suppressed'
                                    : 'scheduled',
                        overrideKind: retainedOverride?.override_kind ?? null,
                        type: replacement.type,
                        weekday: replacement.weekday,
                        localStart: replacement.localStart,
                        localEnd: replacement.localEnd,
                        endDayOffset: replacement.endDayOffset,
                        startInstant: instantWindow.startInstant,
                        endInstant: instantWindow.endInstant,
                        location: replacement.location,
                    }));
                }
            }
            this.database.exec('RELEASE SAVEPOINT read_meeting_series_detail');

            return Object.freeze({
                workspaceRevision: series.revision.toString(),
                planEntityVersion: series.plan_entity_version.toString(),
                requestedWindow,
                termZone: series.time_zone,
                meetingSeriesId,
                courseId: series.course_id,
                entityVersion: series.entity_version.toString(),
                segments,
                occurrences: Object.freeze(occurrences),
            });
        }
        catch (error) {
            this.rollbackOrRequireReopen();
            throw error;
        }
    }

    /**
     * Previews and tokenizes a this-and-future Meeting rule split.
     * @param {MeetingOccurrenceImpactDraft} candidate - Untrusted exact preview draft.
     * @return {MeetingOccurrenceImpactProjection} Version-bound current/after impact projection.
     */
    public previewMeetingOccurrenceChange(
        candidate: MeetingOccurrenceImpactDraft,
    ): MeetingOccurrenceImpactProjection {
        this.requireOpen();
        const draft = normalizeMeetingOccurrenceImpactDraft(candidate);
        const detail = this.readMeetingSeriesDetail(draft.meetingSeriesId, draft.requestedWindow);
        const target = detail.occurrences.find(occurrence => (
            occurrence.occurrenceId.originalLogicalAnchor === draft.originalLogicalAnchor
        ));
        if (!target) {
            throw new TypeError('Meeting occurrence impact target is outside the requested window');
        }
        const afterChangeDetail = this.readMeetingSeriesDetailProjection(
            draft.meetingSeriesId,
            draft.requestedWindow,
            draft,
        );

        try {
            this.database.exec('BEGIN');
            const versions = this.currentVersions();
            const seriesStatement = this.database.prepare(`
                SELECT entity_version
                FROM meeting_series
                WHERE meeting_series_id = ? AND retired = 0
            `);
            seriesStatement.setReadBigInts(true);
            const series = seriesStatement.get(draft.meetingSeriesId) as {
                entity_version: bigint;
            } | undefined;
            if (!series
                || versions.revision.toString() !== detail.workspaceRevision
                || versions.planVersion.toString() !== detail.planEntityVersion
                || series.entity_version.toString() !== detail.entityVersion
                || afterChangeDetail.workspaceRevision !== detail.workspaceRevision
                || afterChangeDetail.planEntityVersion !== detail.planEntityVersion
                || afterChangeDetail.entityVersion !== detail.entityVersion) {
                throw new Error('Meeting impact snapshot changed while it was being prepared');
            }

            const scopeSegments = this.database.prepare(`
                SELECT
                    meeting_segments.meeting_segment_id,
                    meeting_segments.meeting_type,
                    meeting_segments.weekday,
                    meeting_segments.local_start,
                    meeting_segments.local_end,
                    meeting_segments.end_day_offset,
                    meeting_segments.logical_start_anchor,
                    meeting_segments.logical_end_anchor,
                    meeting_segments.effective_range_kind,
                    meeting_segments.effective_start_date,
                    meeting_segments.effective_end_date,
                    meeting_segments.location_kind,
                    meeting_segments.location_value,
                    CASE
                        WHEN meeting_segments.effective_range_kind = 'explicit'
                            THEN meeting_segments.effective_start_date
                        WHEN courses.teaching_range_kind = 'explicit'
                            THEN courses.teaching_start_date
                        ELSE terms.start_date
                    END AS resolved_start_date,
                    CASE
                        WHEN meeting_segments.effective_range_kind = 'explicit'
                            THEN meeting_segments.effective_end_date
                        WHEN courses.teaching_range_kind = 'explicit'
                            THEN courses.teaching_end_date
                        ELSE terms.end_date
                    END AS resolved_end_date
                FROM meeting_segments
                JOIN meeting_series
                    ON meeting_series.meeting_series_id = meeting_segments.meeting_series_id
                JOIN courses ON courses.course_id = meeting_series.course_id
                JOIN terms ON terms.term_id = courses.term_id
                WHERE meeting_segments.meeting_series_id = ?
                ORDER BY meeting_segments.logical_start_anchor, meeting_segments.meeting_segment_id
            `).all(draft.meetingSeriesId) as StoredMeetingSegment[];
            validateMeetingSegmentSequence(scopeSegments);
            const range = scopeSegments.find(segment => segment.meeting_segment_id === target.segmentId);
            const boundaryOverrides = this.database.prepare(`
                SELECT
                    original_logical_anchor,
                    override_kind,
                    meeting_type,
                    weekday,
                    local_start,
                    local_end,
                    end_day_offset,
                    location_kind,
                    location_value
                FROM meeting_occurrence_overrides
                WHERE meeting_series_id = ?
                    AND original_logical_anchor BETWEEN ? AND ?
                ORDER BY original_logical_anchor
            `).all(
                draft.meetingSeriesId,
                addClampedLocalDateDays(draft.requestedWindow.startDate, -12),
                addClampedLocalDateDays(draft.requestedWindow.endDate, 12),
            ) as StoredMeetingOverride[];
            const targetDateAfterChange = occurrenceDate(
                draft.originalLogicalAnchor,
                draft.replacement.weekday,
            );
            if (!range
                || targetDateAfterChange === null
                || targetDateAfterChange < range.resolved_start_date
                || targetDateAfterChange > range.resolved_end_date) {
                throw new TypeError('Meeting occurrence replacement falls outside its effective range');
            }

            const impactStatement = this.database.prepare(`
                SELECT
                    (
                        SELECT count(*)
                        FROM meeting_segments
                        WHERE meeting_series_id = ?
                            AND (
                                logical_end_anchor IS NULL
                                OR logical_end_anchor >= ?
                            )
                    ) AS affected_segment_count,
                    (
                        SELECT count(*)
                        FROM meeting_occurrence_overrides
                        WHERE meeting_series_id = ? AND original_logical_anchor >= ?
                    ) AS future_override_count,
                    (
                        SELECT override_kind
                        FROM meeting_occurrence_overrides
                        WHERE meeting_series_id = ? AND original_logical_anchor = ?
                    ) AS target_override_kind
            `);
            impactStatement.setReadBigInts(true);
            const impact = impactStatement.get(
                draft.meetingSeriesId,
                draft.originalLogicalAnchor,
                draft.meetingSeriesId,
                draft.originalLogicalAnchor,
                draft.meetingSeriesId,
                draft.originalLogicalAnchor,
            ) as {
                affected_segment_count: bigint;
                future_override_count: bigint;
                target_override_kind: 'replaced' | 'cancelled' | null;
            };
            const confirmationToken = meetingOccurrenceConfirmationToken(
                detail.workspaceRevision,
                detail.planEntityVersion,
                detail.entityVersion,
                draft,
                draft.requestedWindow,
            );
            const minimumLocalDate = localDateMilliseconds('0000-01-01');
            const maximumLocalDate = localDateMilliseconds('9999-12-31');
            const targetAnchor = localDateMilliseconds(draft.originalLogicalAnchor);
            const historyOutsideRequestedWindow = hasOccurrenceOutsideRequestedWindow(
                scopeSegments,
                minimumLocalDate,
                targetAnchor - 1,
                draft.requestedWindow,
                null,
                boundaryOverrides,
                null,
            );
            const currentFutureOutsideRequestedWindow = hasOccurrenceOutsideRequestedWindow(
                scopeSegments,
                targetAnchor,
                maximumLocalDate,
                draft.requestedWindow,
                null,
                boundaryOverrides,
                null,
            );
            const changedFutureOutsideRequestedWindow = hasOccurrenceOutsideRequestedWindow(
                scopeSegments,
                targetAnchor,
                maximumLocalDate,
                draft.requestedWindow,
                draft.replacement.weekday,
                boundaryOverrides,
                draft.originalLogicalAnchor,
            );
            const futureOutsideRequestedWindow = currentFutureOutsideRequestedWindow
                || changedFutureOutsideRequestedWindow;
            const targetOverrideKind = impact.target_override_kind ?? 'none';
            const warnings = [] as Array<Readonly<{
                code:
                    | 'preview-window-truncated-history'
                    | 'preview-window-truncated-future'
                    | 'target-override-will-be-cleared';
            }>>;
            if (historyOutsideRequestedWindow) {
                warnings.push(Object.freeze({ code: 'preview-window-truncated-history' }));
            }
            if (futureOutsideRequestedWindow) {
                warnings.push(Object.freeze({ code: 'preview-window-truncated-future' }));
            }
            if (targetOverrideKind !== 'none') {
                warnings.push(Object.freeze({ code: 'target-override-will-be-cleared' }));
            }
            const affectedFutureSegmentCount = impact.affected_segment_count.toString();
            this.database.exec('COMMIT');

            return Object.freeze({
                basedOnRevision: detail.workspaceRevision,
                planEntityVersion: detail.planEntityVersion,
                meetingSeriesVersion: detail.entityVersion,
                affectedEntities: freezeTuple([Object.freeze({
                    kind: 'meeting-series' as const,
                    id: draft.meetingSeriesId,
                    version: detail.entityVersion,
                })]),
                effects: freezeTuple([Object.freeze({
                    code: 'plan.meeting-series-split' as const,
                    originalLogicalAnchor: draft.originalLogicalAnchor,
                    affectedFutureSegmentCount,
                    targetOverrideAction: targetOverrideKind === 'none' ? 'none' as const : 'clear' as const,
                    laterOverrideAction: 'retain' as const,
                })]),
                warnings: Object.freeze(warnings),
                choices: freezeTuple([Object.freeze({ id: 'apply-this-and-future' as const })]),
                defaultChoice: Object.freeze({ id: 'apply-this-and-future' as const }),
                recoverability: Object.freeze({
                    kind: 'permanent' as const,
                    reason: 'meeting-rule-split-has-no-undo' as const,
                }),
                unresolvedReferences: freezeEmptyTuple(),
                scope: draft.scope,
                meetingSeriesId: draft.meetingSeriesId,
                originalLogicalAnchor: draft.originalLogicalAnchor,
                requestedWindow: draft.requestedWindow,
                replacement: draft.replacement,
                targetDateAfterChange,
                targetOverrideKind,
                affectedFutureSegmentCount,
                futureOverrideCount: impact.future_override_count.toString(),
                historicalOccurrences: Object.freeze(detail.occurrences.filter(occurrence => (
                    occurrence.occurrenceId.originalLogicalAnchor < draft.originalLogicalAnchor
                ))),
                currentFutureOccurrences: Object.freeze(detail.occurrences.filter(occurrence => (
                    occurrence.occurrenceId.originalLogicalAnchor >= draft.originalLogicalAnchor
                ))),
                futureOccurrencesAfterChange: Object.freeze(afterChangeDetail.occurrences
                    .filter(occurrence => (
                        occurrence.occurrenceId.originalLogicalAnchor >= draft.originalLogicalAnchor
                    ))
                    .map(occurrence => Object.freeze({
                        occurrenceId: occurrence.occurrenceId,
                        date: occurrence.date,
                        status: occurrence.status,
                        overrideKind: occurrence.overrideKind,
                        type: occurrence.type,
                        weekday: occurrence.weekday,
                        localStart: occurrence.localStart,
                        localEnd: occurrence.localEnd,
                        endDayOffset: occurrence.endDayOffset,
                        startInstant: occurrence.startInstant,
                        endInstant: occurrence.endInstant,
                        location: occurrence.location,
                    }))),
                historyOutsideRequestedWindow,
                futureOutsideRequestedWindow,
                attendanceRecordCount: '0',
                explicitGradeReferenceCount: '0',
                confirmationToken,
            });
        }
        catch (error) {
            this.rollbackOrRequireReopen();
            throw error;
        }
    }

    public commit(
        candidate: WorkspaceDataCommand,
        options: CommitOptions = {},
    ): Promise<DataCommitResult> {
        if (this.terminalError) {
            return Promise.reject(this.terminalError);
        }
        if (this.readOnly) {
            try {
                this.requireOpen();
                return Promise.resolve(permissionCommitResult(this.revision));
            } catch (error) {
                return Promise.reject(error);
            }
        }
        let command: WorkspaceDataCommand;
        switch (candidate.intent.kind) {
            case 'plan.create-term':
                command = normalizeCreateTermCommand(candidate);
                break;
            case 'plan.create-course-with-first-meeting':
                command = normalizeAcceptedCreateCourseWithMeetingCommand(candidate);
                break;
            case 'plan.change-meeting-occurrence':
                command = normalizeAcceptedChangeMeetingOccurrenceCommand(candidate);
                break;
            case 'plan.cancel-meeting-occurrence':
                command = normalizeCancelMeetingOccurrenceCommand(candidate);
                break;
            case 'workspace.reconcile-lifecycle':
                command = normalizeReconcileWorkspaceLifecycleCommand(candidate);
                break;
            case 'plan.update-term-end-date':
                command = normalizeUpdateTermEndDateCommand(candidate);
                break;
            case 'plan.restore-term-as-current':
                command = normalizeRestoreTermAsCurrentCommand(candidate);
                break;
            case 'plan.create-holiday-range':
                command = normalizeCreateHolidayRangeCommand(candidate);
                break;
            case 'plan.update-holiday-range':
                command = normalizeUpdateHolidayRangeCommand(candidate);
                break;
            case 'plan.delete-holiday-range':
                command = normalizeDeleteHolidayRangeCommand(candidate);
                break;
            case 'plan.create-task-series':
                command = normalizeCreateTaskCommand(candidate);
                break;
            case 'plan.update-task-series':
                command = normalizeUpdateTaskCommand(candidate);
                break;
            case 'plan.delete-task-series':
                command = normalizeDeleteTaskCommand(candidate);
                break;
            case 'plan.set-task-occurrence-status':
                command = candidate.intent.intentSchemaVersion === 1
                    ? normalizeCompleteTaskCommand(candidate)
                    : normalizeSetTaskOccurrenceStatusCommand(candidate);
                break;
            case 'plan.set-task-progress':
                command = normalizeSetTaskProgressCommand(candidate);
                break;
            case 'plan.change-task-occurrence':
                command = normalizeChangeTaskOccurrenceCommand(candidate);
                break;
            case 'plan.delete-task-occurrence-or-series':
                command = normalizeDeleteTaskOccurrenceOrSeriesCommand(candidate);
                break;
            case 'plan.undo-task-occurrence-state':
                command = normalizeUndoTaskOccurrenceStateCommand(candidate);
                break;
            default:
                command = normalizeRecordSetupDecisionCommand(candidate);
        }
        if (!this.accepting) {
            return Promise.reject(new Error('Workspace data store is closing'));
        }
        if (this.queue.length >= COMMIT_QUEUE_CAPACITY) {
            return Promise.resolve(writerBusyResult(this.revision));
        }

        const pending = new Promise<DataCommitResult>((resolve, reject) => {
            this.queue.push({ command, options, resolve, reject });
        });
        if (!this.running) {
            this.running = true;
            queueMicrotask(() => this.drain());
        }
        return pending;
    }

    public receipt(commandId: string): CommandReceiptOutcome | null {
        this.requireOpen();
        return this.readReceiptOutcome(commandId);
    }

    public readPendingFollowUps(): readonly DurableFollowUp[] {
        this.requireOpen();
        const statement = this.database.prepare(`
            SELECT
                follow_up_id,
                originating_command_id,
                prerequisite_revision,
                follow_up_version
            FROM durable_followups
            WHERE state = 'pending'
            ORDER BY prerequisite_revision, follow_up_id
        `);
        statement.setReadBigInts(true);
        const rows = statement.all() as Array<{
            follow_up_id: string;
            originating_command_id: string;
            prerequisite_revision: bigint;
            follow_up_version: bigint;
        }>;
        return Object.freeze(rows.map(row => Object.freeze({
            followUpId: row.follow_up_id,
            originatingCommandId: row.originating_command_id,
            owner: 'protect' as const,
            kind: 'backup-needed-through' as const,
            prerequisiteRevision: row.prerequisite_revision.toString(),
            state: 'pending' as const,
            version: row.follow_up_version.toString() as '0',
        })));
    }

    public readProtectionWatermark(): string {
        this.requireOpen();
        const statement = this.database.prepare(
            'SELECT backup_needed_through FROM protection_watermarks WHERE singleton = 1',
        );
        statement.setReadBigInts(true);
        const row = statement.get() as { backup_needed_through: bigint };
        return row.backup_needed_through.toString();
    }

    public close(): Promise<void> {
        if (this.terminalError) {
            return Promise.resolve();
        }
        if (this.closePromise) {
            return this.closePromise;
        }

        this.accepting = false;
        this.closePromise = new Promise<void>((resolve, reject) => {
            this.finishClose = resolve;
            this.failClose = reject;
        });
        if (!this.running && this.queue.length === 0) {
            this.closeDatabase();
        }
        return this.closePromise;
    }

    private rollbackOrRequireReopen(): void {
        try {
            if (!this.database.isTransaction) {
                return;
            }
            this.database.exec('ROLLBACK');
            if (!this.database.isTransaction) {
                return;
            }
        } catch {
            // Any unproven transaction state follows the same terminal path below.
        }
        throw this.enterTerminalState();
    }

    private currentVersions(): CurrentVersions {
        const statement = this.database.prepare(`
            SELECT
                workspace_state.revision,
                setup_state.setup_decision_version,
                plan_state.plan_entity_version
            FROM workspace_state
            JOIN setup_state ON setup_state.singleton = workspace_state.singleton
            JOIN plan_state ON plan_state.singleton = workspace_state.singleton
            WHERE workspace_state.singleton = 1
        `);
        statement.setReadBigInts(true);
        const row = statement.get() as {
            revision: bigint;
            setup_decision_version: bigint;
            plan_entity_version: bigint;
        };
        return {
            revision: row.revision,
            setupVersion: row.setup_decision_version,
            planVersion: row.plan_entity_version,
        };
    }

    private readReceiptOutcome(commandId: string): CommandReceiptOutcome | null {
        const receipt = this.database.prepare(`
            SELECT committed_revision
            FROM command_receipts
            WHERE command_id = ?
        `);
        receipt.setReadBigInts(true);
        const receiptRow = receipt.get(commandId) as { committed_revision: bigint } | undefined;
        if (!receiptRow) {
            return null;
        }

        const effects = this.database.prepare(`
            SELECT effect_code, entity_kind, entity_id, entity_version
            FROM receipt_effects
            WHERE command_id = ?
            ORDER BY effect_order
        `);
        effects.setReadBigInts(true);
        const effectRows = effects.all(commandId) as Array<{
            effect_code: ReceiptEffect['code'];
            entity_kind: ReceiptEffect['entity']['kind'];
            entity_id: string;
            entity_version: bigint;
        }>;
        const followUp = this.database.prepare(`
            SELECT follow_up_id
            FROM durable_followups
            WHERE originating_command_id = ?
            ORDER BY follow_up_id
        `).get(commandId) as { follow_up_id: string };
        const materializedEffects = effectRows.map((row) => Object.freeze({
            code: row.effect_code,
            entity: Object.freeze({
                kind: row.entity_kind,
                id: row.entity_id,
                version: row.entity_version.toString(),
            }),
        }));
        const undoRow = this.database.prepare(`
            SELECT undo_token, task_series_id, original_logical_anchor
            FROM task_state_history
            WHERE originating_command_id = ?
        `).get(commandId) as {
            undo_token: string;
            task_series_id: string;
            original_logical_anchor: string;
        } | undefined;
        const attachUndoCapability = (outcome: CommandReceiptOutcome): CommandReceiptOutcome => {
            if (!undoRow) {
                return outcome;
            }
            const taskEffect = materializedEffects.find(effect => (
                effect.entity.kind === 'task-series' && effect.entity.id === undoRow.task_series_id
            ));
            if (!taskEffect) {
                throw new Error('Stored Task Undo capability has no matching receipt effect');
            }
            return Object.freeze({
                ...outcome,
                undoCapability: Object.freeze({
                    token: undoRow.undo_token,
                    taskSeriesId: undoRow.task_series_id,
                    originalLogicalAnchor: undoRow.original_logical_anchor,
                    committedRevision: receiptRow.committed_revision.toString(),
                    validThroughTaskSeriesVersion: taskEffect.entity.version,
                }),
            });
        };
        if (materializedEffects.length === 1) {
            const [effect] = materializedEffects;
            return attachUndoCapability(committedOutcome(
                receiptRow.committed_revision,
                effect!.code,
                effect!.entity.kind,
                effect!.entity.id,
                BigInt(effect!.entity.version),
                followUp.follow_up_id,
            ));
        }
        if (materializedEffects.length === 2) {
            return attachUndoCapability(committedPairOutcome(
                receiptRow.committed_revision,
                materializedEffects[0]!,
                materializedEffects[1]!,
                followUp.follow_up_id,
            ));
        }
        throw new Error('Stored receipt outcome has an invalid effect count');
    }

    private commitSynchronously(
        command: WorkspaceDataCommand,
        options: CommitOptions,
    ): DataCommitResult {
        if (!('expectedPlanVersion' in command)) {
            return this.commitSetupSynchronously(command, options);
        }
        if (isCourseWithMeetingCommand(command)) {
            return this.commitCourseWithMeetingSynchronously(command, options);
        }
        if (isMeetingOccurrenceMutationCommand(command)) {
            return this.commitMeetingOccurrenceMutationSynchronously(command, options);
        }
        if (isTermMutationCommand(command)) {
            return this.commitTermMutationSynchronously(command, options);
        }
        if (isHolidayRangeCommand(command)) {
            return this.commitHolidayRangeSynchronously(command, options);
        }
        if (isTaskCommand(command)) {
            if (isTaskOccurrenceStateMutationCommand(command)) {
                return this.commitTaskOccurrenceStateSynchronously(command, options);
            }
            if (isTaskOccurrenceRuleMutationCommand(command)) {
                return this.commitTaskOccurrenceRuleSynchronously(command, options);
            }
            return this.commitTaskSynchronously(command, options);
        }
        return this.commitTermSynchronously(command, options);
    }

    private commitSetupSynchronously(
        command: RecordSetupDecisionCommand,
        options: CommitOptions,
    ): DataCommitResult {
        const digest = digestRecordSetupDecision(command);
        let commitAttempted = false;

        try {
            this.database.exec('BEGIN IMMEDIATE');
            fireCommitFailpoint(options, 'commit.after-begin');

            const receipt = this.database.prepare(`
                SELECT payload_digest
                FROM command_receipts
                WHERE command_id = ?
            `).get(command.commandId) as { payload_digest: Uint8Array } | undefined;
            fireCommitFailpoint(options, 'commit.after-receipt-read');
            if (receipt) {
                const versions = this.currentVersions();
                if (!timingSafeEqual(receipt.payload_digest, digest)) {
                    this.rollbackOrRequireReopen();
                    return conflictResult('command-id-reused', this.workspaceId, versions);
                }

                const outcome = this.readReceiptOutcome(command.commandId);
                this.rollbackOrRequireReopen();
                if (!outcome) {
                    throw new Error('Stored receipt outcome is incomplete');
                }
                return successfulCommit(outcome);
            }

            const versions = this.currentVersions();
            if (command.workspaceId !== this.workspaceId) {
                this.rollbackOrRequireReopen();
                return conflictResult('expected-entity-version', this.workspaceId, versions);
            }
            const expectedRevision = BigInt(command.expectedRevision);
            const expectedSetupVersion = BigInt(command.expectedSetupVersion);
            if (versions.revision !== expectedRevision) {
                this.rollbackOrRequireReopen();
                return conflictResult('expected-revision', this.workspaceId, versions);
            }
            if (versions.setupVersion !== expectedSetupVersion) {
                this.rollbackOrRequireReopen();
                return conflictResult('expected-entity-version', this.workspaceId, versions);
            }
            fireCommitFailpoint(options, 'commit.after-expected-versions');

            if (versions.revision === SQLITE_INTEGER_MAX || versions.setupVersion === SQLITE_INTEGER_MAX) {
                this.rollbackOrRequireReopen();
                throw this.enterTerminalState();
            }

            const newRevision = versions.revision + 1n;
            const newSetupVersion = versions.setupVersion + 1n;
            this.database.prepare(`
                UPDATE setup_state
                SET last_decision = ?, setup_decision_version = ?
                WHERE singleton = 1
            `).run(command.intent.payload.decision, newSetupVersion);
            fireCommitFailpoint(options, 'commit.after-facts');

            this.database.prepare(
                'UPDATE workspace_state SET revision = ? WHERE singleton = 1',
            ).run(newRevision);
            fireCommitFailpoint(options, 'commit.after-revision');

            this.database.prepare(`
                INSERT INTO command_receipts (
                    command_id,
                    intent_kind,
                    intent_schema_version,
                    canonical_encoding,
                    digest_algorithm,
                    payload_digest,
                    committed_revision,
                    result_kind
                ) VALUES (
                    ?, 'workspace.record-setup-decision', 1,
                    'courseflow-canonical-json-v1', 'sha256', ?, ?, 'committed'
                )
            `).run(command.commandId, digest, newRevision);
            fireCommitFailpoint(options, 'commit.after-receipt');

            this.database.prepare(`
                INSERT INTO receipt_effects (
                    command_id,
                    effect_order,
                    effect_code,
                    entity_kind,
                    entity_id,
                    entity_version
                ) VALUES (?, 0, 'workspace.setup-decision-recorded', 'workspace-setup', ?, ?)
            `).run(command.commandId, this.workspaceId, newSetupVersion);
            this.database.prepare(`
                INSERT INTO durable_followups (
                    follow_up_id,
                    originating_command_id,
                    owner,
                    kind,
                    prerequisite_revision,
                    state,
                    follow_up_version
                ) VALUES (?, ?, 'protect', 'backup-needed-through', ?, 'pending', 0)
            `).run(command.followUpId, command.commandId, newRevision);
            fireCommitFailpoint(options, 'commit.after-followup');

            this.database.prepare(`
                UPDATE protection_watermarks
                SET backup_needed_through = ?
                WHERE singleton = 1
            `).run(newRevision);
            fireCommitFailpoint(options, 'commit.after-watermark');
            fireCommitFailpoint(options, 'commit.before-sqlite-commit');

            commitAttempted = true;
            this.database.exec('COMMIT');
            this.revision = newRevision;
            fireCommitFailpoint(options, 'commit.after-sqlite-commit');
            const outcome = this.readReceiptOutcome(command.commandId);
            if (!outcome) {
                throw new Error('Committed receipt outcome is missing');
            }
            return successfulCommit(outcome);
        } catch (error) {
            if (this.terminalError) {
                throw this.terminalError;
            }
            if (commitAttempted) {
                throw this.enterTerminalState();
            }
            this.rollbackOrRequireReopen();
            const disposition = classifySqliteFailure(error, 'pre-commit');
            if (disposition.kind === 'retryable-unchanged') {
                return writerBusyResult(this.revision);
            }
            if (disposition.kind === 'read-only') {
                this.readOnly = true;
                return permissionCommitResult(this.revision);
            }
            if (disposition.kind === 'failed-unchanged') {
                const message = disposition.reason === 'storage-full'
                    ? 'Workspace data write failed: storage full'
                    : 'Workspace data recovery is required';
                throw new Error(message);
            }
            throw new Error('Workspace data commit failed');
        }
    }

    private commitTermSynchronously(
        command: CreateTermCommand,
        options: CommitOptions,
    ): DataCommitResult {
        const digest = digestCreateTerm(command);
        const termId = randomUUID();
        let commitAttempted = false;

        try {
            this.database.exec('BEGIN IMMEDIATE');
            fireCommitFailpoint(options, 'commit.after-begin');

            const receipt = this.database.prepare(`
                SELECT payload_digest
                FROM command_receipts
                WHERE command_id = ?
            `).get(command.commandId) as { payload_digest: Uint8Array } | undefined;
            fireCommitFailpoint(options, 'commit.after-receipt-read');
            if (receipt) {
                const versions = this.currentVersions();
                if (!timingSafeEqual(receipt.payload_digest, digest)) {
                    this.rollbackOrRequireReopen();
                    return planConflictResult('command-id-reused', versions);
                }

                const outcome = this.readReceiptOutcome(command.commandId);
                this.rollbackOrRequireReopen();
                if (!outcome) {
                    throw new Error('Stored receipt outcome is incomplete');
                }
                return successfulCommit(outcome);
            }

            const versions = this.currentVersions();
            if (versions.revision !== BigInt(command.expectedRevision)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-revision', versions);
            }
            if (versions.planVersion !== BigInt(command.expectedPlanVersion)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-entity-version', versions);
            }
            fireCommitFailpoint(options, 'commit.after-expected-versions');

            if (versions.revision === SQLITE_INTEGER_MAX || versions.planVersion === SQLITE_INTEGER_MAX) {
                this.rollbackOrRequireReopen();
                throw this.enterTerminalState();
            }

            const newRevision = versions.revision + 1n;
            const newPlanVersion = versions.planVersion + 1n;
            const payload = command.intent.payload;
            this.database.prepare(`
                INSERT INTO terms (
                    term_id,
                    name,
                    start_date,
                    end_date,
                    time_zone,
                    archived,
                    entity_version
                ) VALUES (?, ?, ?, ?, ?, 0, 1)
            `).run(termId, payload.name, payload.startDate, payload.endDate, payload.timeZone);
            this.database.prepare(`
                UPDATE plan_state
                SET current_term_id = ?, plan_entity_version = ?
                WHERE singleton = 1
            `).run(termId, newPlanVersion);
            fireCommitFailpoint(options, 'commit.after-facts');

            this.database.prepare(
                'UPDATE workspace_state SET revision = ? WHERE singleton = 1',
            ).run(newRevision);
            fireCommitFailpoint(options, 'commit.after-revision');

            this.database.prepare(`
                INSERT INTO command_receipts (
                    command_id,
                    intent_kind,
                    intent_schema_version,
                    canonical_encoding,
                    digest_algorithm,
                    payload_digest,
                    committed_revision,
                    result_kind
                ) VALUES (
                    ?, 'plan.create-term', 1,
                    'courseflow-canonical-json-v1', 'sha256', ?, ?, 'committed'
                )
            `).run(command.commandId, digest, newRevision);
            fireCommitFailpoint(options, 'commit.after-receipt');

            this.database.prepare(`
                INSERT INTO receipt_effects (
                    command_id,
                    effect_order,
                    effect_code,
                    entity_kind,
                    entity_id,
                    entity_version
                ) VALUES (?, 0, 'plan.term-created-current', 'term', ?, 1)
            `).run(command.commandId, termId);
            this.database.prepare(`
                INSERT INTO durable_followups (
                    follow_up_id,
                    originating_command_id,
                    owner,
                    kind,
                    prerequisite_revision,
                    state,
                    follow_up_version
                ) VALUES (?, ?, 'protect', 'backup-needed-through', ?, 'pending', 0)
            `).run(command.followUpId, command.commandId, newRevision);
            fireCommitFailpoint(options, 'commit.after-followup');

            this.database.prepare(`
                UPDATE protection_watermarks
                SET backup_needed_through = ?
                WHERE singleton = 1
            `).run(newRevision);
            fireCommitFailpoint(options, 'commit.after-watermark');
            fireCommitFailpoint(options, 'commit.before-sqlite-commit');

            commitAttempted = true;
            this.database.exec('COMMIT');
            this.revision = newRevision;
            fireCommitFailpoint(options, 'commit.after-sqlite-commit');
            const outcome = this.readReceiptOutcome(command.commandId);
            if (!outcome) {
                throw new Error('Committed receipt outcome is missing');
            }
            return successfulCommit(outcome);
        }
        catch (error) {
            if (this.terminalError) {
                throw this.terminalError;
            }
            if (commitAttempted) {
                throw this.enterTerminalState(new CommittedCommandOutcomeUnknownError(command.commandId));
            }
            this.rollbackOrRequireReopen();
            const disposition = classifySqliteFailure(error, 'pre-commit');
            if (disposition.kind === 'retryable-unchanged') {
                return writerBusyResult(this.revision);
            }
            if (disposition.kind === 'read-only') {
                this.readOnly = true;
                return permissionCommitResult(this.revision);
            }
            if (disposition.kind === 'failed-unchanged') {
                const message = disposition.reason === 'storage-full'
                    ? 'Workspace data write failed: storage full'
                    : 'Workspace data recovery is required';
                throw new Error(message);
            }
            throw new Error('Workspace data commit failed');
        }
    }

    private commitCourseWithMeetingSynchronously(
        command: AcceptedCreateCourseWithMeetingCommand,
        options: CommitOptions,
    ): DataCommitResult {
        const digest = digestCreateCourseWithMeeting(command);
        let commitAttempted = false;

        try {
            this.database.exec('BEGIN IMMEDIATE');
            fireCommitFailpoint(options, 'commit.after-begin');

            const receipt = this.database.prepare(`
                SELECT payload_digest
                FROM command_receipts
                WHERE command_id = ?
            `).get(command.commandId) as { payload_digest: Uint8Array } | undefined;
            fireCommitFailpoint(options, 'commit.after-receipt-read');
            if (receipt) {
                const versions = this.currentVersions();
                if (!timingSafeEqual(receipt.payload_digest, digest)) {
                    this.rollbackOrRequireReopen();
                    return planConflictResult('command-id-reused', versions);
                }

                const outcome = this.readReceiptOutcome(command.commandId);
                this.rollbackOrRequireReopen();
                if (!outcome) {
                    throw new Error('Stored receipt outcome is incomplete');
                }
                return successfulCommit(outcome);
            }
            if (!isCurrentCourseWithMeetingCommand(command)) {
                this.rollbackOrRequireReopen();
                throw new TypeError('Legacy Course commands are replay-only');
            }

            const versions = this.currentVersions();
            if (versions.revision !== BigInt(command.expectedRevision)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-revision', versions);
            }
            if (versions.planVersion !== BigInt(command.expectedPlanVersion)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-entity-version', versions);
            }
            fireCommitFailpoint(options, 'commit.after-expected-versions');

            const term = this.database.prepare(`
                SELECT terms.term_id, terms.start_date, terms.end_date, terms.time_zone
                FROM plan_state
                JOIN terms ON terms.term_id = plan_state.current_term_id
                WHERE plan_state.singleton = 1
            `).get() as {
                term_id: string;
                start_date: string;
                end_date: string;
                time_zone: string;
            } | undefined;
            const payload = command.intent.payload;
            if (!term) {
                this.rollbackOrRequireReopen();
                throw new TypeError('Course requires a Current Term');
            }
            const teachingStartDate = payload.course.teachingRange.kind === 'inherit-term'
                ? term.start_date
                : payload.course.teachingRange.startDate;
            const teachingEndDate = payload.course.teachingRange.kind === 'inherit-term'
                ? term.end_date
                : payload.course.teachingRange.endDate;
            const effectiveStartDate = payload.meeting.effectiveRange.kind === 'inherit-course'
                ? teachingStartDate
                : payload.meeting.effectiveRange.startDate;
            const effectiveEndDate = payload.meeting.effectiveRange.kind === 'inherit-course'
                ? teachingEndDate
                : payload.meeting.effectiveRange.endDate;
            if (teachingStartDate < term.start_date
                || teachingEndDate > term.end_date
                || effectiveStartDate < teachingStartDate
                || effectiveEndDate > teachingEndDate) {
                this.rollbackOrRequireReopen();
                throw new TypeError('Course and Meeting ranges must remain inside their owners');
            }
            const logicalStartAnchor = firstWeeklyLogicalAnchor(
                effectiveStartDate,
                payload.meeting.weekday,
            );
            const proposedOccurrences = expandConflictMeetingOccurrences(
                Object.freeze({
                    courseId: null,
                    courseCode: payload.course.code,
                    meetingSeriesId: null,
                }),
                term.time_zone,
                [Object.freeze({
                    meeting_segment_id: command.commandId,
                    meeting_type: payload.meeting.type,
                    weekday: payload.meeting.weekday,
                    local_start: payload.meeting.localStart,
                    local_end: payload.meeting.localEnd,
                    end_day_offset: payload.meeting.endDayOffset,
                    logical_start_anchor: logicalStartAnchor,
                    logical_end_anchor: null,
                    effective_range_kind: payload.meeting.effectiveRange.kind,
                    effective_start_date: payload.meeting.effectiveRange.kind === 'explicit'
                        ? payload.meeting.effectiveRange.startDate
                        : null,
                    effective_end_date: payload.meeting.effectiveRange.kind === 'explicit'
                        ? payload.meeting.effectiveRange.endDate
                        : null,
                    resolved_start_date: effectiveStartDate,
                    resolved_end_date: effectiveEndDate,
                    location_kind: payload.meeting.location.kind,
                    location_value: payload.meeting.location.kind === 'known'
                        ? payload.meeting.location.value
                        : null,
                })],
                [],
                this.readActiveHolidayRanges(term.term_id),
                Object.freeze({ startDate: effectiveStartDate, endDate: effectiveEndDate }),
            );
            const overlapWindow = Object.freeze({
                startDate: addClampedLocalDateDays(effectiveStartDate, -3),
                endDate: addClampedLocalDateDays(effectiveEndDate, 3),
            });
            const overlapWarnings = meetingOverlapWarnings(
                command.commandId,
                proposedOccurrences,
                this.readConflictMeetingOccurrences(overlapWindow, term.term_id),
            );
            if (command.overlapDecision === 'review' && overlapWarnings.length > 0) {
                this.rollbackOrRequireReopen();
                return meetingOverlapDecisionRequiredResult(versions.revision, overlapWarnings);
            }
            if (versions.revision === SQLITE_INTEGER_MAX || versions.planVersion === SQLITE_INTEGER_MAX) {
                this.rollbackOrRequireReopen();
                throw this.enterTerminalState();
            }

            const newRevision = versions.revision + 1n;
            const newPlanVersion = versions.planVersion + 1n;
            const courseId = randomUUID();
            const meetingSeriesId = randomUUID();
            const meetingSegmentId = randomUUID();
            const [creditsCoefficient, creditsScale] = decimalToCoefficient(payload.course.credits);
            this.database.prepare(`
                INSERT INTO courses (
                    course_id,
                    term_id,
                    code,
                    name,
                    section,
                    instructor,
                    color,
                    credits_coefficient,
                    credits_scale,
                    teaching_range_kind,
                    teaching_start_date,
                    teaching_end_date,
                    archived,
                    entity_version
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)
            `).run(
                courseId,
                term.term_id,
                payload.course.code,
                payload.course.name,
                payload.course.section,
                payload.course.instructor,
                payload.course.color,
                creditsCoefficient,
                creditsScale,
                payload.course.teachingRange.kind,
                payload.course.teachingRange.kind === 'explicit'
                    ? payload.course.teachingRange.startDate
                    : null,
                payload.course.teachingRange.kind === 'explicit'
                    ? payload.course.teachingRange.endDate
                    : null,
            );
            this.database.prepare(`
                INSERT INTO meeting_series (
                    meeting_series_id,
                    course_id,
                    retired,
                    entity_version
                ) VALUES (?, ?, 0, 1)
            `).run(meetingSeriesId, courseId);
            this.database.prepare(`
                INSERT INTO meeting_segments (
                    meeting_segment_id,
                    meeting_series_id,
                    meeting_type,
                    weekday,
                    local_start,
                    local_end,
                    end_day_offset,
                    logical_start_anchor,
                    logical_end_anchor,
                    effective_range_kind,
                    effective_start_date,
                    effective_end_date,
                    location_kind,
                    location_value
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                meetingSegmentId,
                meetingSeriesId,
                payload.meeting.type,
                payload.meeting.weekday,
                payload.meeting.localStart,
                payload.meeting.localEnd,
                payload.meeting.endDayOffset,
                logicalStartAnchor,
                null,
                payload.meeting.effectiveRange.kind,
                payload.meeting.effectiveRange.kind === 'explicit'
                    ? payload.meeting.effectiveRange.startDate
                    : null,
                payload.meeting.effectiveRange.kind === 'explicit'
                    ? payload.meeting.effectiveRange.endDate
                    : null,
                payload.meeting.location.kind,
                payload.meeting.location.kind === 'known' ? payload.meeting.location.value : null,
            );
            this.database.prepare(`
                UPDATE plan_state
                SET plan_entity_version = ?
                WHERE singleton = 1
            `).run(newPlanVersion);
            fireCommitFailpoint(options, 'commit.after-facts');

            this.database.prepare(
                'UPDATE workspace_state SET revision = ? WHERE singleton = 1',
            ).run(newRevision);
            fireCommitFailpoint(options, 'commit.after-revision');

            this.database.prepare(`
                INSERT INTO command_receipts (
                    command_id,
                    intent_kind,
                    intent_schema_version,
                    canonical_encoding,
                    digest_algorithm,
                    payload_digest,
                    committed_revision,
                    result_kind
                ) VALUES (
                    ?, 'plan.create-course-with-first-meeting', 3,
                    'courseflow-canonical-json-v1', 'sha256', ?, ?, 'committed'
                )
            `).run(command.commandId, digest, newRevision);
            fireCommitFailpoint(options, 'commit.after-receipt');

            this.database.prepare(`
                INSERT INTO receipt_effects (
                    command_id,
                    effect_order,
                    effect_code,
                    entity_kind,
                    entity_id,
                    entity_version
                ) VALUES
                    (?, 0, 'plan.course-created', 'course', ?, 1),
                    (?, 1, 'plan.meeting-series-created', 'meeting-series', ?, 1)
            `).run(command.commandId, courseId, command.commandId, meetingSeriesId);
            this.database.prepare(`
                INSERT INTO durable_followups (
                    follow_up_id,
                    originating_command_id,
                    owner,
                    kind,
                    prerequisite_revision,
                    state,
                    follow_up_version
                ) VALUES (?, ?, 'protect', 'backup-needed-through', ?, 'pending', 0)
            `).run(command.followUpId, command.commandId, newRevision);
            fireCommitFailpoint(options, 'commit.after-followup');

            this.database.prepare(`
                UPDATE protection_watermarks
                SET backup_needed_through = ?
                WHERE singleton = 1
            `).run(newRevision);
            fireCommitFailpoint(options, 'commit.after-watermark');
            fireCommitFailpoint(options, 'commit.before-sqlite-commit');

            commitAttempted = true;
            this.database.exec('COMMIT');
            this.revision = newRevision;
            fireCommitFailpoint(options, 'commit.after-sqlite-commit');
            const outcome = this.readReceiptOutcome(command.commandId);
            if (!outcome) {
                throw new Error('Committed receipt outcome is missing');
            }
            return successfulCommit(outcome);
        }
        catch (error) {
            if (this.terminalError) {
                throw this.terminalError;
            }
            if (commitAttempted) {
                throw this.enterTerminalState(new CommittedCommandOutcomeUnknownError(command.commandId));
            }
            this.rollbackOrRequireReopen();
            if (error instanceof TypeError) {
                throw error;
            }
            const disposition = classifySqliteFailure(error, 'pre-commit');
            if (disposition.kind === 'retryable-unchanged') {
                return writerBusyResult(this.revision);
            }
            if (disposition.kind === 'read-only') {
                this.readOnly = true;
                return permissionCommitResult(this.revision);
            }
            if (disposition.kind === 'failed-unchanged') {
                const message = disposition.reason === 'storage-full'
                    ? 'Workspace data write failed: storage full'
                    : 'Workspace data recovery is required';
                throw new Error(message);
            }
            throw new Error('Workspace data commit failed');
        }
    }

    /**
     * Commits one occurrence override or deterministic future segment split atomically.
     * @param {MeetingOccurrenceMutationCommand} command - Normalized versioned mutation.
     * @param {CommitOptions} options - Transaction failpoint controls used by tests.
     * @return {DataCommitResult} Committed receipt or unchanged structured problem.
     */
    private commitMeetingOccurrenceMutationSynchronously(
        command: MeetingOccurrenceMutationCommand,
        options: CommitOptions,
    ): DataCommitResult {
        const digest = isChangeMeetingOccurrenceCommand(command)
            ? digestChangeMeetingOccurrence(command)
            : digestCancelMeetingOccurrence(command);
        let commitAttempted = false;

        try {
            this.database.exec('BEGIN IMMEDIATE');
            fireCommitFailpoint(options, 'commit.after-begin');

            const receipt = this.database.prepare(`
                SELECT payload_digest
                FROM command_receipts
                WHERE command_id = ?
            `).get(command.commandId) as { payload_digest: Uint8Array } | undefined;
            fireCommitFailpoint(options, 'commit.after-receipt-read');
            if (receipt) {
                const versions = this.currentVersions();
                if (!timingSafeEqual(receipt.payload_digest, digest)) {
                    this.rollbackOrRequireReopen();
                    return planConflictResult('command-id-reused', versions);
                }

                const outcome = this.readReceiptOutcome(command.commandId);
                this.rollbackOrRequireReopen();
                if (!outcome) {
                    throw new Error('Stored receipt outcome is incomplete');
                }
                return successfulCommit(outcome);
            }

            const versions = this.currentVersions();
            const payload = command.intent.payload;
            if (isChangeMeetingOccurrenceCommand(command)
                && !isCurrentChangeMeetingOccurrenceCommand(command)) {
                this.rollbackOrRequireReopen();
                throw new TypeError('Legacy Meeting occurrence commands are replay-only');
            }
            const seriesStatement = this.database.prepare(`
                SELECT
                    meeting_series.entity_version,
                    meeting_series.retired,
                    courses.course_id,
                    courses.code AS course_code,
                    terms.term_id,
                    terms.time_zone
                FROM meeting_series
                JOIN courses ON courses.course_id = meeting_series.course_id
                JOIN terms ON terms.term_id = courses.term_id
                WHERE meeting_series.meeting_series_id = ?
            `);
            seriesStatement.setReadBigInts(true);
            const series = seriesStatement.get(payload.meetingSeriesId) as {
                entity_version: bigint;
                retired: bigint;
                course_id: string;
                course_code: string;
                term_id: string;
                time_zone: string;
            } | undefined;
            if (!series || series.retired !== 0n) {
                this.rollbackOrRequireReopen();
                throw new TypeError('Meeting series is not editable');
            }
            const isFutureChange = isChangeMeetingOccurrenceCommand(command)
                && command.intent.payload.scope === 'this-and-future';
            if (isFutureChange) {
                const expectedToken = command.impactWindow === null
                    ? null
                    : meetingOccurrenceConfirmationToken(
                        versions.revision.toString(),
                        versions.planVersion.toString(),
                        series.entity_version.toString(),
                        {
                            ...command.intent.payload,
                            scope: 'this-and-future',
                        },
                        command.impactWindow,
                    );
                if (versions.revision !== BigInt(command.expectedRevision)
                    || versions.planVersion !== BigInt(command.expectedPlanVersion)
                    || series.entity_version !== BigInt(command.expectedMeetingSeriesVersion)
                    || expectedToken === null
                    || command.confirmationToken === null
                    || command.confirmationToken !== expectedToken) {
                    this.rollbackOrRequireReopen();
                    return decisionRequiredResult(versions.revision);
                }
            }
            else if (versions.revision !== BigInt(command.expectedRevision)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-revision', versions);
            }
            else if (versions.planVersion !== BigInt(command.expectedPlanVersion)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-entity-version', versions);
            }
            if (series.entity_version !== BigInt(command.expectedMeetingSeriesVersion)) {
                this.rollbackOrRequireReopen();
                return meetingSeriesConflictResult(
                    'expected-entity-version',
                    versions,
                    payload.meetingSeriesId,
                    series.entity_version,
                );
            }
            fireCommitFailpoint(options, 'commit.after-expected-versions');

            const segmentRows = this.database.prepare(`
                SELECT
                    meeting_segments.meeting_segment_id,
                    meeting_segments.meeting_type,
                    meeting_segments.weekday,
                    meeting_segments.local_start,
                    meeting_segments.local_end,
                    meeting_segments.end_day_offset,
                    meeting_segments.logical_start_anchor,
                    meeting_segments.logical_end_anchor,
                    meeting_segments.effective_range_kind,
                    meeting_segments.effective_start_date,
                    meeting_segments.effective_end_date,
                    meeting_segments.location_kind,
                    meeting_segments.location_value,
                    CASE
                        WHEN meeting_segments.effective_range_kind = 'explicit'
                            THEN meeting_segments.effective_start_date
                        WHEN courses.teaching_range_kind = 'explicit'
                            THEN courses.teaching_start_date
                        ELSE terms.start_date
                    END AS resolved_start_date,
                    CASE
                        WHEN meeting_segments.effective_range_kind = 'explicit'
                            THEN meeting_segments.effective_end_date
                        WHEN courses.teaching_range_kind = 'explicit'
                            THEN courses.teaching_end_date
                        ELSE terms.end_date
                    END AS resolved_end_date
                FROM meeting_segments
                JOIN meeting_series
                    ON meeting_series.meeting_series_id = meeting_segments.meeting_series_id
                JOIN courses ON courses.course_id = meeting_series.course_id
                JOIN terms ON terms.term_id = courses.term_id
                WHERE meeting_segments.meeting_series_id = ?
                ORDER BY meeting_segments.logical_start_anchor, meeting_segments.meeting_segment_id
            `).all(payload.meetingSeriesId) as StoredMeetingSegment[];
            validateMeetingSegmentSequence(segmentRows);
            const matchingSegments = segmentRows.filter(candidate => (
                isActiveLogicalAnchor(candidate, payload.originalLogicalAnchor)
            ));
            if (matchingSegments.length !== 1) {
                this.rollbackOrRequireReopen();
                throw new TypeError('Meeting occurrence logical anchor does not exist');
            }
            const segment = matchingSegments[0]!;
            if (isChangeMeetingOccurrenceCommand(command)) {
                const replacementDate = occurrenceDate(
                    payload.originalLogicalAnchor,
                    command.intent.payload.replacement.weekday,
                );
                if (replacementDate === null
                    || replacementDate < segment.resolved_start_date
                    || replacementDate > segment.resolved_end_date) {
                    this.rollbackOrRequireReopen();
                    throw new TypeError('Meeting occurrence replacement falls outside its effective range');
                }
            }
            if (isChangeMeetingOccurrenceCommand(command)
                && isCurrentChangeMeetingOccurrenceCommand(command)) {
                const replacement = command.intent.payload.replacement;
                const proposedObject = Object.freeze({
                    courseId: series.course_id,
                    courseCode: series.course_code,
                    meetingSeriesId: payload.meetingSeriesId,
                });
                let proposedOccurrences: readonly ConflictMeetingOccurrence[];
                if (command.intent.payload.scope === 'only-this') {
                    const date = occurrenceDate(
                        payload.originalLogicalAnchor,
                        replacement.weekday,
                    )!;
                    proposedOccurrences = Object.freeze([Object.freeze({
                        object: proposedObject,
                        meetingType: replacement.type,
                        originalLogicalAnchor: payload.originalLogicalAnchor,
                        date,
                        time: resolveMeetingOccurrenceTime({
                            termZone: series.time_zone,
                            date,
                            localStart: replacement.localStart,
                            localEnd: replacement.localEnd,
                            endDayOffset: replacement.endDayOffset,
                        }),
                    })]);
                }
                else {
                    const retainedOverrides = this.database.prepare(`
                        SELECT
                            original_logical_anchor,
                            override_kind,
                            meeting_type,
                            weekday,
                            local_start,
                            local_end,
                            end_day_offset,
                            location_kind,
                            location_value
                        FROM meeting_occurrence_overrides
                        WHERE meeting_series_id = ? AND original_logical_anchor > ?
                        ORDER BY original_logical_anchor
                    `).all(
                        payload.meetingSeriesId,
                        payload.originalLogicalAnchor,
                    ) as StoredMeetingOverride[];
                    proposedOccurrences = expandConflictMeetingOccurrences(
                        proposedObject,
                        series.time_zone,
                        [Object.freeze({
                            ...segment,
                            meeting_segment_id: command.commandId,
                            meeting_type: replacement.type,
                            weekday: replacement.weekday,
                            local_start: replacement.localStart,
                            local_end: replacement.localEnd,
                            end_day_offset: replacement.endDayOffset,
                            logical_start_anchor: payload.originalLogicalAnchor,
                            logical_end_anchor: segmentRows.at(-1)!.logical_end_anchor,
                            location_kind: replacement.location.kind,
                            location_value: replacement.location.kind === 'known'
                                ? replacement.location.value
                                : null,
                        })],
                        retainedOverrides,
                        this.readActiveHolidayRanges(series.term_id),
                        Object.freeze({
                            startDate: segment.resolved_start_date,
                            endDate: segment.resolved_end_date,
                        }),
                    );
                }
                const candidateDates = proposedOccurrences.map(occurrence => occurrence.date);
                if (candidateDates.length === 0) {
                    this.rollbackOrRequireReopen();
                    throw new TypeError('Meeting occurrence replacement has no effective occurrence');
                }
                const conflictWindow = Object.freeze({
                    startDate: addClampedLocalDateDays(
                        candidateDates.reduce((first, date) => date < first ? date : first),
                        -3,
                    ),
                    endDate: addClampedLocalDateDays(
                        candidateDates.reduce((last, date) => date > last ? date : last),
                        3,
                    ),
                });
                const existingOccurrences = this.readConflictMeetingOccurrences(
                    conflictWindow,
                    series.term_id,
                ).filter(
                    occurrence => occurrence.object.meetingSeriesId !== payload.meetingSeriesId
                        || (command.intent.payload.scope === 'only-this'
                            ? occurrence.originalLogicalAnchor !== payload.originalLogicalAnchor
                            : occurrence.originalLogicalAnchor < payload.originalLogicalAnchor),
                );
                const overlapWarnings = meetingOverlapWarnings(
                    command.commandId,
                    proposedOccurrences,
                    existingOccurrences,
                );
                if (command.overlapDecision === 'review' && overlapWarnings.length > 0) {
                    this.rollbackOrRequireReopen();
                    return meetingOverlapDecisionRequiredResult(versions.revision, overlapWarnings);
                }
            }
            if (versions.revision === SQLITE_INTEGER_MAX
                || versions.planVersion === SQLITE_INTEGER_MAX
                || series.entity_version === SQLITE_INTEGER_MAX) {
                this.rollbackOrRequireReopen();
                throw this.enterTerminalState();
            }

            const newRevision = versions.revision + 1n;
            const newPlanVersion = versions.planVersion + 1n;
            const newSeriesVersion = series.entity_version + 1n;
            if (command.intent.kind === 'plan.cancel-meeting-occurrence') {
                this.database.prepare(`
                    INSERT INTO meeting_occurrence_overrides (
                        meeting_series_id,
                        original_logical_anchor,
                        override_kind,
                        meeting_type,
                        weekday,
                        local_start,
                        local_end,
                        end_day_offset,
                        location_kind,
                        location_value,
                        entity_version
                    ) VALUES (?, ?, 'cancelled', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1)
                    ON CONFLICT (meeting_series_id, original_logical_anchor) DO UPDATE SET
                        override_kind = 'cancelled',
                        meeting_type = NULL,
                        weekday = NULL,
                        local_start = NULL,
                        local_end = NULL,
                        end_day_offset = NULL,
                        location_kind = NULL,
                        location_value = NULL,
                        entity_version = meeting_occurrence_overrides.entity_version + 1
                `).run(payload.meetingSeriesId, payload.originalLogicalAnchor);
            }
            else if (command.intent.payload.scope === 'only-this') {
                const replacement = command.intent.payload.replacement;
                this.database.prepare(`
                    INSERT INTO meeting_occurrence_overrides (
                        meeting_series_id,
                        original_logical_anchor,
                        override_kind,
                        meeting_type,
                        weekday,
                        local_start,
                        local_end,
                        end_day_offset,
                        location_kind,
                        location_value,
                        entity_version
                    ) VALUES (?, ?, 'replaced', ?, ?, ?, ?, ?, ?, ?, 1)
                    ON CONFLICT (meeting_series_id, original_logical_anchor) DO UPDATE SET
                        override_kind = 'replaced',
                        meeting_type = excluded.meeting_type,
                        weekday = excluded.weekday,
                        local_start = excluded.local_start,
                        local_end = excluded.local_end,
                        end_day_offset = excluded.end_day_offset,
                        location_kind = excluded.location_kind,
                        location_value = excluded.location_value,
                        entity_version = meeting_occurrence_overrides.entity_version + 1
                `).run(
                    payload.meetingSeriesId,
                    payload.originalLogicalAnchor,
                    replacement.type,
                    replacement.weekday,
                    replacement.localStart,
                    replacement.localEnd,
                    replacement.endDayOffset,
                    replacement.location.kind,
                    replacement.location.kind === 'known' ? replacement.location.value : null,
                );
            }
            else {
                const replacement = command.intent.payload.replacement;
                const newSegmentId = randomUUID();
                const finalLogicalEndAnchor = segmentRows.at(-1)!.logical_end_anchor;
                this.database.prepare(`
                    DELETE FROM meeting_segments
                    WHERE meeting_series_id = ? AND logical_start_anchor > ?
                `).run(payload.meetingSeriesId, payload.originalLogicalAnchor);
                this.database.prepare(`
                    DELETE FROM meeting_occurrence_overrides
                    WHERE meeting_series_id = ? AND original_logical_anchor = ?
                `).run(payload.meetingSeriesId, payload.originalLogicalAnchor);
                if (payload.originalLogicalAnchor === segment.logical_start_anchor) {
                    this.database.prepare(
                        'DELETE FROM meeting_segments WHERE meeting_segment_id = ?',
                    ).run(segment.meeting_segment_id);
                }
                else {
                    this.database.prepare(`
                        UPDATE meeting_segments
                        SET logical_end_anchor = ?
                        WHERE meeting_segment_id = ?
                    `).run(
                        addLocalDateDays(payload.originalLogicalAnchor, -7),
                        segment.meeting_segment_id,
                    );
                }
                this.database.prepare(`
                    INSERT INTO meeting_segments (
                        meeting_segment_id,
                        meeting_series_id,
                        meeting_type,
                        weekday,
                        local_start,
                        local_end,
                        end_day_offset,
                        logical_start_anchor,
                        logical_end_anchor,
                        effective_range_kind,
                        effective_start_date,
                        effective_end_date,
                        location_kind,
                        location_value
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    newSegmentId,
                    payload.meetingSeriesId,
                    replacement.type,
                    replacement.weekday,
                    replacement.localStart,
                    replacement.localEnd,
                    replacement.endDayOffset,
                    payload.originalLogicalAnchor,
                    finalLogicalEndAnchor,
                    segment.effective_range_kind,
                    segment.effective_start_date,
                    segment.effective_end_date,
                    replacement.location.kind,
                    replacement.location.kind === 'known' ? replacement.location.value : null,
                );
            }
            this.database.prepare(`
                UPDATE meeting_series SET entity_version = ? WHERE meeting_series_id = ?
            `).run(newSeriesVersion, payload.meetingSeriesId);
            this.database.prepare(`
                UPDATE plan_state SET plan_entity_version = ? WHERE singleton = 1
            `).run(newPlanVersion);
            fireCommitFailpoint(options, 'commit.after-facts');

            this.database.prepare(
                'UPDATE workspace_state SET revision = ? WHERE singleton = 1',
            ).run(newRevision);
            fireCommitFailpoint(options, 'commit.after-revision');

            this.database.prepare(`
                INSERT INTO command_receipts (
                    command_id,
                    intent_kind,
                    intent_schema_version,
                    canonical_encoding,
                    digest_algorithm,
                    payload_digest,
                    committed_revision,
                    result_kind
                ) VALUES (
                    ?, ?, ?,
                    'courseflow-canonical-json-v1', 'sha256', ?, ?, 'committed'
                )
            `).run(
                command.commandId,
                command.intent.kind,
                command.intent.intentSchemaVersion,
                digest,
                newRevision,
            );
            fireCommitFailpoint(options, 'commit.after-receipt');

            this.database.prepare(`
                INSERT INTO receipt_effects (
                    command_id,
                    effect_order,
                    effect_code,
                    entity_kind,
                    entity_id,
                    entity_version
                ) VALUES (?, 0, ?, 'meeting-series', ?, ?)
            `).run(
                command.commandId,
                command.intent.kind === 'plan.cancel-meeting-occurrence'
                    ? 'plan.meeting-occurrence-cancelled'
                    : 'plan.meeting-occurrence-changed',
                payload.meetingSeriesId,
                newSeriesVersion,
            );
            this.database.prepare(`
                INSERT INTO durable_followups (
                    follow_up_id,
                    originating_command_id,
                    owner,
                    kind,
                    prerequisite_revision,
                    state,
                    follow_up_version
                ) VALUES (?, ?, 'protect', 'backup-needed-through', ?, 'pending', 0)
            `).run(command.followUpId, command.commandId, newRevision);
            fireCommitFailpoint(options, 'commit.after-followup');

            this.database.prepare(`
                UPDATE protection_watermarks
                SET backup_needed_through = ?
                WHERE singleton = 1
            `).run(newRevision);
            fireCommitFailpoint(options, 'commit.after-watermark');
            fireCommitFailpoint(options, 'commit.before-sqlite-commit');

            commitAttempted = true;
            this.database.exec('COMMIT');
            this.revision = newRevision;
            fireCommitFailpoint(options, 'commit.after-sqlite-commit');
            const outcome = this.readReceiptOutcome(command.commandId);
            if (!outcome) {
                throw new Error('Committed receipt outcome is missing');
            }
            return successfulCommit(outcome);
        }
        catch (error) {
            if (this.terminalError) {
                throw this.terminalError;
            }
            if (commitAttempted) {
                throw this.enterTerminalState(new CommittedCommandOutcomeUnknownError(command.commandId));
            }
            this.rollbackOrRequireReopen();
            if (error instanceof TypeError) {
                throw error;
            }
            const disposition = classifySqliteFailure(error, 'pre-commit');
            if (disposition.kind === 'retryable-unchanged') {
                return writerBusyResult(this.revision);
            }
            if (disposition.kind === 'read-only') {
                this.readOnly = true;
                return permissionCommitResult(this.revision);
            }
            if (disposition.kind === 'failed-unchanged') {
                const message = disposition.reason === 'storage-full'
                    ? 'Workspace data write failed: storage full'
                    : 'Workspace data recovery is required';
                throw new Error(message);
            }
            throw new Error('Workspace data commit failed');
        }
    }

    /**
     * Commits one named HolidayRange lifecycle transition and its durable receipt atomically.
     * @param {HolidayRangeCommand} command - Normalized create, update, or delete command.
     * @param {CommitOptions} options - Transaction failpoint controls used by tests.
     * @return {DataCommitResult} Committed receipt or unchanged structured problem.
     */
    private commitHolidayRangeSynchronously(
        command: HolidayRangeCommand,
        options: CommitOptions,
    ): DataCommitResult {
        const digest = command.intent.kind === 'plan.create-holiday-range'
            ? digestCreateHolidayRange(command as CreateHolidayRangeCommand)
            : command.intent.kind === 'plan.update-holiday-range'
                ? digestUpdateHolidayRange(command as UpdateHolidayRangeCommand)
                : digestDeleteHolidayRange(command as DeleteHolidayRangeCommand);
        let commitAttempted = false;

        try {
            this.database.exec('BEGIN IMMEDIATE');
            fireCommitFailpoint(options, 'commit.after-begin');

            const receipt = this.database.prepare(`
                SELECT payload_digest
                FROM command_receipts
                WHERE command_id = ?
            `).get(command.commandId) as { payload_digest: Uint8Array } | undefined;
            fireCommitFailpoint(options, 'commit.after-receipt-read');
            if (receipt) {
                const versions = this.currentVersions();
                if (!timingSafeEqual(receipt.payload_digest, digest)) {
                    this.rollbackOrRequireReopen();
                    return planConflictResult('command-id-reused', versions);
                }
                const outcome = this.readReceiptOutcome(command.commandId);
                this.rollbackOrRequireReopen();
                if (!outcome) {
                    throw new Error('Stored receipt outcome is incomplete');
                }
                return successfulCommit(outcome);
            }

            const versions = this.currentVersions();
            if (versions.revision !== BigInt(command.expectedRevision)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-revision', versions);
            }
            if (versions.planVersion !== BigInt(command.expectedPlanVersion)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-entity-version', versions);
            }

            const existing = command.intent.kind === 'plan.create-holiday-range'
                ? undefined
                : (() => {
                    const statement = this.database.prepare(`
                        SELECT
                            term_id,
                            name,
                            start_date,
                            end_date,
                            tombstoned,
                            entity_version
                        FROM holiday_ranges
                        WHERE holiday_range_id = ?
                    `);
                    statement.setReadBigInts(true);
                    return statement.get(command.intent.payload.holidayRangeId) as {
                        term_id: string;
                        name: string;
                        start_date: string;
                        end_date: string;
                        tombstoned: bigint;
                        entity_version: bigint;
                    } | undefined;
                })();
            if (command.intent.kind !== 'plan.create-holiday-range') {
                if (!existing || existing.tombstoned !== 0n) {
                    this.rollbackOrRequireReopen();
                    throw new TypeError('HolidayRange is not editable');
                }
                const expectedHolidayRangeVersion = (command as (
                    UpdateHolidayRangeCommand | DeleteHolidayRangeCommand
                )).expectedHolidayRangeVersion;
                if (existing.entity_version !== BigInt(expectedHolidayRangeVersion)) {
                    this.rollbackOrRequireReopen();
                    return holidayRangeConflictResult(
                        versions,
                        command.intent.payload.holidayRangeId,
                        existing.entity_version,
                    );
                }
            }
            fireCommitFailpoint(options, 'commit.after-expected-versions');

            const termId = command.intent.kind === 'plan.create-holiday-range'
                ? command.intent.payload.termId
                : existing!.term_id;
            const term = this.database.prepare(`
                SELECT start_date, end_date
                FROM terms
                WHERE term_id = ?
            `).get(termId) as { start_date: string; end_date: string } | undefined;
            if (!term) {
                this.rollbackOrRequireReopen();
                throw new TypeError('HolidayRange owning Term does not exist');
            }
            if (command.intent.kind !== 'plan.delete-holiday-range'
                && (command.intent.payload.startDate < term.start_date
                    || command.intent.payload.endDate > term.end_date)) {
                this.rollbackOrRequireReopen();
                throw new TypeError('HolidayRange falls outside its Term');
            }
            if (command.intent.kind !== 'plan.create-holiday-range') {
                const mutation = command as UpdateHolidayRangeCommand | DeleteHolidayRangeCommand;
                if (mutation.overlapDecision === 'review') {
                    const activeHolidayRanges = this.readActiveHolidayRanges(termId);
                    const holidayRangeId = mutation.intent.payload.holidayRangeId;
                    let candidateHolidayRanges: readonly StoredHolidayRange[];
                    let changedStartDate = existing!.start_date;
                    let changedEndDate = existing!.end_date;
                    if (mutation.intent.kind === 'plan.update-holiday-range') {
                        const update = mutation as UpdateHolidayRangeCommand;
                        candidateHolidayRanges = activeHolidayRanges.map(range => (
                            range.holiday_range_id === holidayRangeId
                                ? Object.freeze({
                                    holiday_range_id: range.holiday_range_id,
                                    start_date: update.intent.payload.startDate,
                                    end_date: update.intent.payload.endDate,
                                })
                                : range
                        ));
                        changedStartDate = update.intent.payload.startDate < changedStartDate
                            ? update.intent.payload.startDate
                            : changedStartDate;
                        changedEndDate = update.intent.payload.endDate > changedEndDate
                            ? update.intent.payload.endDate
                            : changedEndDate;
                    }
                    else {
                        candidateHolidayRanges = activeHolidayRanges.filter(range => (
                            range.holiday_range_id !== holidayRangeId
                        ));
                    }
                    const conflictWindow = Object.freeze({
                        startDate: addClampedLocalDateDays(changedStartDate, -3),
                        endDate: addClampedLocalDateDays(changedEndDate, 3),
                    });
                    const beforeWarnings = meetingScheduleOverlapWarnings(
                        command.commandId,
                        this.readConflictMeetingOccurrences(
                            conflictWindow,
                            termId,
                            activeHolidayRanges,
                        ),
                    );
                    const existingWarningKeys = new Set(beforeWarnings.map(meetingOverlapWarningKey));
                    const introducedWarnings = meetingScheduleOverlapWarnings(
                        command.commandId,
                        this.readConflictMeetingOccurrences(
                            conflictWindow,
                            termId,
                            candidateHolidayRanges,
                        ),
                    ).filter(warning => !existingWarningKeys.has(meetingOverlapWarningKey(warning)))
                        .slice(0, MAX_MEETING_OVERLAP_WARNINGS);
                    if (introducedWarnings.length > 0) {
                        this.rollbackOrRequireReopen();
                        return meetingOverlapDecisionRequiredResult(
                            versions.revision,
                            Object.freeze(introducedWarnings),
                        );
                    }
                }
            }
            const existingVersion = existing?.entity_version ?? 0n;
            if (versions.revision === SQLITE_INTEGER_MAX
                || versions.planVersion === SQLITE_INTEGER_MAX
                || existingVersion === SQLITE_INTEGER_MAX) {
                this.rollbackOrRequireReopen();
                throw this.enterTerminalState();
            }

            const holidayRangeId = command.intent.kind === 'plan.create-holiday-range'
                ? randomUUID()
                : command.intent.payload.holidayRangeId;
            const newRevision = versions.revision + 1n;
            const newPlanVersion = versions.planVersion + 1n;
            const newHolidayRangeVersion = existingVersion + 1n;
            if (command.intent.kind === 'plan.create-holiday-range') {
                this.database.prepare(`
                    INSERT INTO holiday_ranges (
                        holiday_range_id,
                        term_id,
                        name,
                        start_date,
                        end_date,
                        tombstoned,
                        entity_version
                    ) VALUES (?, ?, ?, ?, ?, 0, 1)
                `).run(
                    holidayRangeId,
                    termId,
                    command.intent.payload.name,
                    command.intent.payload.startDate,
                    command.intent.payload.endDate,
                );
            }
            else if (command.intent.kind === 'plan.update-holiday-range') {
                this.database.prepare(`
                    UPDATE holiday_ranges
                    SET name = ?, start_date = ?, end_date = ?, entity_version = ?
                    WHERE holiday_range_id = ? AND tombstoned = 0
                `).run(
                    command.intent.payload.name,
                    command.intent.payload.startDate,
                    command.intent.payload.endDate,
                    newHolidayRangeVersion,
                    holidayRangeId,
                );
            }
            else {
                this.database.prepare(`
                    UPDATE holiday_ranges
                    SET tombstoned = 1, entity_version = ?
                    WHERE holiday_range_id = ? AND tombstoned = 0
                `).run(newHolidayRangeVersion, holidayRangeId);
            }
            this.database.prepare(`
                UPDATE plan_state SET plan_entity_version = ? WHERE singleton = 1
            `).run(newPlanVersion);
            fireCommitFailpoint(options, 'commit.after-facts');

            this.database.prepare(
                'UPDATE workspace_state SET revision = ? WHERE singleton = 1',
            ).run(newRevision);
            fireCommitFailpoint(options, 'commit.after-revision');

            this.database.prepare(`
                INSERT INTO command_receipts (
                    command_id,
                    intent_kind,
                    intent_schema_version,
                    canonical_encoding,
                    digest_algorithm,
                    payload_digest,
                    committed_revision,
                    result_kind
                ) VALUES (?, ?, 1, 'courseflow-canonical-json-v1', 'sha256', ?, ?, 'committed')
            `).run(command.commandId, command.intent.kind, digest, newRevision);
            fireCommitFailpoint(options, 'commit.after-receipt');

            const effectCode: ReceiptEffect['code'] = command.intent.kind === 'plan.create-holiday-range'
                ? 'plan.holiday-range-created'
                : command.intent.kind === 'plan.update-holiday-range'
                    ? 'plan.holiday-range-updated'
                    : 'plan.holiday-range-deleted';
            this.database.prepare(`
                INSERT INTO receipt_effects (
                    command_id,
                    effect_order,
                    effect_code,
                    entity_kind,
                    entity_id,
                    entity_version
                ) VALUES (?, 0, ?, 'holiday-range', ?, ?)
            `).run(command.commandId, effectCode, holidayRangeId, newHolidayRangeVersion);
            this.database.prepare(`
                INSERT INTO durable_followups (
                    follow_up_id,
                    originating_command_id,
                    owner,
                    kind,
                    prerequisite_revision,
                    state,
                    follow_up_version
                ) VALUES (?, ?, 'protect', 'backup-needed-through', ?, 'pending', 0)
            `).run(command.followUpId, command.commandId, newRevision);
            fireCommitFailpoint(options, 'commit.after-followup');

            this.database.prepare(`
                UPDATE protection_watermarks
                SET backup_needed_through = ?
                WHERE singleton = 1
            `).run(newRevision);
            fireCommitFailpoint(options, 'commit.after-watermark');
            fireCommitFailpoint(options, 'commit.before-sqlite-commit');

            commitAttempted = true;
            this.database.exec('COMMIT');
            this.revision = newRevision;
            fireCommitFailpoint(options, 'commit.after-sqlite-commit');
            const outcome = this.readReceiptOutcome(command.commandId);
            if (!outcome) {
                throw new Error('Committed receipt outcome is missing');
            }
            return successfulCommit(outcome);
        }
        catch (error) {
            if (this.terminalError) {
                throw this.terminalError;
            }
            if (commitAttempted) {
                throw this.enterTerminalState(new CommittedCommandOutcomeUnknownError(command.commandId));
            }
            this.rollbackOrRequireReopen();
            if (error instanceof TypeError) {
                throw error;
            }
            const disposition = classifySqliteFailure(error, 'pre-commit');
            if (disposition.kind === 'retryable-unchanged') {
                return writerBusyResult(this.revision);
            }
            if (disposition.kind === 'read-only') {
                this.readOnly = true;
                return permissionCommitResult(this.revision);
            }
            if (disposition.kind === 'failed-unchanged') {
                const message = disposition.reason === 'storage-full'
                    ? 'Workspace data write failed: storage full'
                    : 'Workspace data recovery is required';
                throw new Error(message);
            }
            throw new Error('Workspace data commit failed');
        }
    }

    /**
     * Commits one scoped Task occurrence/rule mutation and its receipt atomically.
     * @param {TaskOccurrenceRuleMutationCommand} command - Canonical scoped Task mutation.
     * @param {CommitOptions} options - Transaction failpoint controls used by tests.
     * @return {DataCommitResult} Committed receipt or unchanged structured problem.
     */
    private commitTaskOccurrenceRuleSynchronously(
        command: TaskOccurrenceRuleMutationCommand,
        options: CommitOptions,
    ): DataCommitResult {
        const changeCommand = command.intent.kind === 'plan.change-task-occurrence'
            ? command as ChangeTaskOccurrenceCommand
            : null;
        const deleteCommand = changeCommand === null
            ? command as DeleteTaskOccurrenceOrSeriesCommand
            : null;
        const digest = changeCommand
            ? digestChangeTaskOccurrence(changeCommand)
            : digestDeleteTaskOccurrenceOrSeries(deleteCommand!);
        let commitAttempted = false;

        try {
            this.database.exec('BEGIN IMMEDIATE');
            fireCommitFailpoint(options, 'commit.after-begin');
            const receipt = this.database.prepare(`
                SELECT payload_digest FROM command_receipts WHERE command_id = ?
            `).get(command.commandId) as { payload_digest: Uint8Array } | undefined;
            fireCommitFailpoint(options, 'commit.after-receipt-read');
            if (receipt) {
                const versions = this.currentVersions();
                if (!timingSafeEqual(receipt.payload_digest, digest)) {
                    this.rollbackOrRequireReopen();
                    return planConflictResult('command-id-reused', versions);
                }
                const outcome = this.readReceiptOutcome(command.commandId);
                this.rollbackOrRequireReopen();
                if (!outcome) {
                    throw new Error('Stored Task occurrence rule receipt is incomplete');
                }
                return successfulCommit(outcome);
            }

            const versions = this.currentVersions();
            const payload = command.intent.payload;
            const taskSeriesId = payload.taskSeriesId;
            const scope = payload.scope;
            const originalLogicalAnchor = scope === 'whole-series'
                ? null
                : (payload as { originalLogicalAnchor: string }).originalLogicalAnchor;
            const seriesStatement = this.database.prepare(`
                SELECT
                    task_series.entity_version,
                    task_series.retired,
                    terms.time_zone,
                    CASE courses.teaching_range_kind
                        WHEN 'explicit' THEN courses.teaching_start_date
                        ELSE terms.start_date
                    END AS teaching_start_date,
                    CASE courses.teaching_range_kind
                        WHEN 'explicit' THEN courses.teaching_end_date
                        ELSE terms.end_date
                    END AS teaching_end_date
                FROM task_series
                JOIN courses ON courses.course_id = task_series.course_id
                JOIN terms ON terms.term_id = courses.term_id
                WHERE task_series.task_series_id = ?
            `);
            seriesStatement.setReadBigInts(true);
            const series = seriesStatement.get(taskSeriesId) as {
                entity_version: bigint;
                retired: bigint;
                time_zone: string;
                teaching_start_date: string;
                teaching_end_date: string;
            } | undefined;
            if (!series || series.retired !== 0n) {
                this.rollbackOrRequireReopen();
                throw new TypeError('Task series is not editable');
            }

            const isFuture = scope === 'this-and-future';
            const requiresPreview = isFuture || deleteCommand !== null;
            if (requiresPreview) {
                const requestedWindow = command.impactWindow;
                let draft: TaskOccurrenceImpactDraft | null = null;
                if (requestedWindow !== null) {
                    draft = changeCommand
                        ? Object.freeze({
                            scope: 'this-and-future' as const,
                            taskSeriesId,
                            originalLogicalAnchor: originalLogicalAnchor!,
                            action: 'change' as const,
                            replacement: (changeCommand.intent.payload as Extract<
                                ChangeTaskOccurrenceCommand['intent']['payload'],
                                { scope: 'this-and-future' }
                            >).replacement,
                            requestedWindow,
                        })
                        : scope === 'whole-series'
                            ? Object.freeze({
                                scope: 'whole-series' as const,
                                taskSeriesId,
                                action: 'delete' as const,
                                requestedWindow,
                            })
                            : Object.freeze({
                                scope,
                                taskSeriesId,
                                originalLogicalAnchor: originalLogicalAnchor!,
                                action: 'delete' as const,
                                requestedWindow,
                            });
                }
                const expectedToken = draft === null
                    ? null
                    : taskOccurrenceConfirmationToken(
                        versions.revision.toString(),
                        versions.planVersion.toString(),
                        series.entity_version.toString(),
                        draft,
                    );
                if (versions.revision !== BigInt(command.expectedRevision)
                    || versions.planVersion !== BigInt(command.expectedPlanVersion)
                    || series.entity_version !== BigInt(command.expectedTaskSeriesVersion)
                    || expectedToken === null
                    || command.confirmationToken === null
                    || command.confirmationToken !== expectedToken) {
                    this.rollbackOrRequireReopen();
                    return decisionRequiredResult(versions.revision);
                }
            }
            else if (versions.revision !== BigInt(command.expectedRevision)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-revision', versions);
            }
            else if (versions.planVersion !== BigInt(command.expectedPlanVersion)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-entity-version', versions);
            }
            else if (series.entity_version !== BigInt(command.expectedTaskSeriesVersion)) {
                this.rollbackOrRequireReopen();
                return taskSeriesConflictResult(versions, taskSeriesId, series.entity_version);
            }
            fireCommitFailpoint(options, 'commit.after-expected-versions');

            if (versions.revision === SQLITE_INTEGER_MAX
                || versions.planVersion === SQLITE_INTEGER_MAX
                || series.entity_version === SQLITE_INTEGER_MAX) {
                this.rollbackOrRequireReopen();
                throw this.enterTerminalState();
            }
            const newRevision = versions.revision + 1n;
            const newPlanVersion = versions.planVersion + 1n;
            const newSeriesVersion = series.entity_version + 1n;

            if (scope === 'whole-series') {
                this.database.prepare(`
                    UPDATE task_series SET retired = 1 WHERE task_series_id = ? AND retired = 0
                `).run(taskSeriesId);
            }
            else {
                const segmentStatement = this.database.prepare(`
                    SELECT
                        task_segment_id,
                        title,
                        task_size,
                        schedule_kind,
                        deadline_kind,
                        deadline_date,
                        deadline_instant,
                        deadline_display_zone,
                        logical_start_anchor,
                        logical_end_anchor,
                        weekly_start_date,
                        weekly_weekday,
                        weekly_local_deadline_time,
                        weekly_confirmed_end_date,
                        follow_teaching_week
                    FROM task_segments
                    WHERE task_series_id = ?
                    ORDER BY logical_start_anchor, task_segment_id
                `);
                segmentStatement.setReadBigInts(true);
                const segments = segmentStatement.all(taskSeriesId) as StoredTaskSegment[];
                const segment = taskSegmentForAnchor(segments, originalLogicalAnchor!);
                const overrideStatement = this.database.prepare(`
                    SELECT
                        original_logical_anchor,
                        override_kind,
                        replacement_title,
                        replacement_task_size,
                        replacement_deadline_kind,
                        replacement_deadline_date,
                        replacement_deadline_instant,
                        replacement_deadline_display_zone,
                        entity_version
                    FROM task_occurrence_overrides
                    WHERE task_series_id = ?
                    ORDER BY original_logical_anchor
                `);
                overrideStatement.setReadBigInts(true);
                const overrides = overrideStatement.all(taskSeriesId) as StoredTaskOccurrenceOverride[];
                const targetOverride = overrides.find(candidate => (
                    candidate.original_logical_anchor === originalLogicalAnchor
                ));
                if (!segment || targetOverride?.override_kind === 'deleted') {
                    this.rollbackOrRequireReopen();
                    throw new TypeError('Task occurrence is not active');
                }
                if (isFuture && segment.schedule_kind !== 'weekly') {
                    this.rollbackOrRequireReopen();
                    throw new TypeError('This-and-future scope requires a weekly Task series');
                }
                if (overrides.some(override => override.entity_version === SQLITE_INTEGER_MAX)) {
                    this.rollbackOrRequireReopen();
                    throw this.enterTerminalState();
                }

                const stateStatement = this.database.prepare(`
                    SELECT
                        original_logical_anchor,
                        status,
                        self_reported_progress,
                        entity_version
                    FROM task_occurrence_states
                    WHERE task_series_id = ?
                    ORDER BY original_logical_anchor
                `);
                stateStatement.setReadBigInts(true);
                const states = stateStatement.all(taskSeriesId) as StoredTaskOccurrenceState[];
                const targetState = states.find(state => (
                    state.original_logical_anchor === originalLogicalAnchor
                ));
                const replacementForAnchor = (anchor: string): TaskOccurrenceReplacement => {
                    const override = overrides.find(candidate => candidate.original_logical_anchor === anchor);
                    if (override?.override_kind === 'replaced') {
                        return taskOverrideReplacement(override);
                    }
                    const owner = taskSegmentForAnchor(segments, anchor);
                    if (!owner) {
                        throw new Error('Task occurrence state has no retained facts');
                    }
                    return Object.freeze({
                        title: owner.title,
                        size: owner.task_size,
                        deadline: taskSegmentOccurrenceDeadline(owner, anchor, series.time_zone),
                    });
                };
                const writeReplacementOverride = (
                    anchor: string,
                    replacement: TaskOccurrenceReplacement,
                ): void => {
                    this.database.prepare(`
                        INSERT INTO task_occurrence_overrides (
                            task_series_id,
                            original_logical_anchor,
                            override_kind,
                            replacement_title,
                            replacement_task_size,
                            replacement_deadline_kind,
                            replacement_deadline_date,
                            replacement_deadline_instant,
                            replacement_deadline_display_zone,
                            entity_version
                        ) VALUES (?, ?, 'replaced', ?, ?, ?, ?, ?, ?, 1)
                        ON CONFLICT (task_series_id, original_logical_anchor) DO UPDATE SET
                            override_kind = 'replaced',
                            replacement_title = excluded.replacement_title,
                            replacement_task_size = excluded.replacement_task_size,
                            replacement_deadline_kind = excluded.replacement_deadline_kind,
                            replacement_deadline_date = excluded.replacement_deadline_date,
                            replacement_deadline_instant = excluded.replacement_deadline_instant,
                            replacement_deadline_display_zone = excluded.replacement_deadline_display_zone,
                            entity_version = task_occurrence_overrides.entity_version + 1
                    `).run(
                        taskSeriesId,
                        anchor,
                        replacement.title,
                        replacement.size,
                        ...taskDeadlineColumns(replacement.deadline),
                    );
                };

                if (changeCommand && scope === 'only-this') {
                    if (targetState && targetState.status !== 'pending') {
                        this.rollbackOrRequireReopen();
                        throw new TypeError('Terminal Task occurrence history is not editable');
                    }
                    const replacement = (changeCommand.intent.payload as Extract<
                        ChangeTaskOccurrenceCommand['intent']['payload'],
                        { scope: 'only-this' }
                    >).replacement;
                    writeReplacementOverride(originalLogicalAnchor!, replacement);
                }
                else if (deleteCommand && scope === 'only-this') {
                    if (targetState && targetState.status !== 'pending') {
                        this.rollbackOrRequireReopen();
                        throw new TypeError('Terminal Task occurrence history is not deletable as only-this');
                    }
                    this.database.prepare(`
                        INSERT INTO task_occurrence_overrides (
                            task_series_id,
                            original_logical_anchor,
                            override_kind,
                            replacement_title,
                            replacement_task_size,
                            replacement_deadline_kind,
                            replacement_deadline_date,
                            replacement_deadline_instant,
                            replacement_deadline_display_zone,
                            entity_version
                        ) VALUES (?, ?, 'deleted', NULL, NULL, NULL, NULL, NULL, NULL, 1)
                        ON CONFLICT (task_series_id, original_logical_anchor) DO UPDATE SET
                            override_kind = 'deleted',
                            replacement_title = NULL,
                            replacement_task_size = NULL,
                            replacement_deadline_kind = NULL,
                            replacement_deadline_date = NULL,
                            replacement_deadline_instant = NULL,
                            replacement_deadline_display_zone = NULL,
                            entity_version = task_occurrence_overrides.entity_version + 1
                    `).run(taskSeriesId, originalLogicalAnchor);
                }
                else {
                    const retainedStates = states.filter(state => (
                        state.original_logical_anchor >= originalLogicalAnchor!
                        && (deleteCommand !== null || state.status !== 'pending')
                    ));
                    for (const state of retainedStates) {
                        writeReplacementOverride(
                            state.original_logical_anchor,
                            replacementForAnchor(state.original_logical_anchor),
                        );
                    }

                    const finalLogicalEndAnchor = segments.at(-1)!.logical_end_anchor;
                    this.database.prepare(`
                        DELETE FROM task_segments
                        WHERE task_series_id = ? AND logical_start_anchor > ?
                    `).run(taskSeriesId, originalLogicalAnchor);
                    if (changeCommand) {
                        if (!targetState || targetState.status === 'pending') {
                            this.database.prepare(`
                                DELETE FROM task_occurrence_overrides
                                WHERE task_series_id = ? AND original_logical_anchor = ?
                            `).run(taskSeriesId, originalLogicalAnchor);
                        }
                        const replacement = (changeCommand.intent.payload as Extract<
                            ChangeTaskOccurrenceCommand['intent']['payload'],
                            { scope: 'this-and-future' }
                        >).replacement;
                        const firstDate = occurrenceDate(originalLogicalAnchor!, replacement.weekday);
                        const lastDate = occurrenceDate(finalLogicalEndAnchor, replacement.weekday);
                        if (firstDate === null
                            || lastDate === null
                            || firstDate < series.teaching_start_date
                            || lastDate > series.teaching_end_date) {
                            this.rollbackOrRequireReopen();
                            throw new TypeError('Task future replacement falls outside the Course range');
                        }
                        const boundaryInstants = [firstDate, lastDate].map(date => (
                            INTL_ZONE_RULES.resolveInstant(
                                series.time_zone,
                                date,
                                replacement.localDeadlineTime,
                            )
                        ));
                        if (!boundaryInstants.every(isCanonicalInstant)) {
                            this.rollbackOrRequireReopen();
                            throw new TypeError('Task future replacement has an invalid deadline');
                        }
                        if (originalLogicalAnchor === segment.logical_start_anchor) {
                            this.database.prepare(`
                                DELETE FROM task_segments WHERE task_segment_id = ?
                            `).run(segment.task_segment_id);
                        }
                        else {
                            this.database.prepare(`
                                UPDATE task_segments SET logical_end_anchor = ? WHERE task_segment_id = ?
                            `).run(addLocalDateDays(originalLogicalAnchor!, -7), segment.task_segment_id);
                        }
                        this.database.prepare(`
                            INSERT INTO task_segments (
                                task_segment_id,
                                task_series_id,
                                title,
                                task_size,
                                schedule_kind,
                                deadline_kind,
                                deadline_date,
                                deadline_instant,
                                deadline_display_zone,
                                weekly_start_date,
                                weekly_weekday,
                                weekly_local_deadline_time,
                                weekly_confirmed_end_date,
                                follow_teaching_week,
                                logical_start_anchor,
                                logical_end_anchor
                            ) VALUES (
                                ?, ?, ?, ?, 'weekly', NULL, NULL, NULL, NULL,
                                ?, ?, ?, ?, ?, ?, ?
                            )
                        `).run(
                            randomUUID(),
                            taskSeriesId,
                            replacement.title,
                            replacement.size,
                            segment.weekly_start_date,
                            replacement.weekday,
                            replacement.localDeadlineTime,
                            segments.at(-1)!.weekly_confirmed_end_date,
                            replacement.followTeachingWeek ? 1 : 0,
                            originalLogicalAnchor,
                            finalLogicalEndAnchor,
                        );
                    }
                    else {
                        this.database.prepare(`
                            DELETE FROM task_occurrence_overrides
                            WHERE task_series_id = ?
                                AND original_logical_anchor >= ?
                                AND NOT EXISTS (
                                    SELECT 1
                                    FROM task_occurrence_states
                                    WHERE task_occurrence_states.task_series_id
                                        = task_occurrence_overrides.task_series_id
                                        AND task_occurrence_states.original_logical_anchor
                                            = task_occurrence_overrides.original_logical_anchor
                                )
                        `).run(taskSeriesId, originalLogicalAnchor);
                        if (originalLogicalAnchor === segment.logical_start_anchor) {
                            const hasEarlierSegment = segments.some(candidate => (
                                candidate.logical_start_anchor < originalLogicalAnchor!
                            ));
                            if (hasEarlierSegment) {
                                this.database.prepare(`
                                    DELETE FROM task_segments WHERE task_segment_id = ?
                                `).run(segment.task_segment_id);
                            }
                            else {
                                this.database.prepare(`
                                    UPDATE task_series SET retired = 1 WHERE task_series_id = ?
                                `).run(taskSeriesId);
                            }
                        }
                        else {
                            this.database.prepare(`
                                UPDATE task_segments SET logical_end_anchor = ? WHERE task_segment_id = ?
                            `).run(addLocalDateDays(originalLogicalAnchor!, -7), segment.task_segment_id);
                        }
                    }
                }
            }

            this.database.prepare(`
                UPDATE task_series SET entity_version = ? WHERE task_series_id = ?
            `).run(newSeriesVersion, taskSeriesId);
            this.database.prepare(`
                UPDATE plan_state SET plan_entity_version = ? WHERE singleton = 1
            `).run(newPlanVersion);
            fireCommitFailpoint(options, 'commit.after-facts');
            this.database.prepare(`
                UPDATE workspace_state SET revision = ? WHERE singleton = 1
            `).run(newRevision);
            fireCommitFailpoint(options, 'commit.after-revision');
            this.database.prepare(`
                INSERT INTO command_receipts (
                    command_id,
                    intent_kind,
                    intent_schema_version,
                    canonical_encoding,
                    digest_algorithm,
                    payload_digest,
                    committed_revision,
                    result_kind
                ) VALUES (?, ?, 1, 'courseflow-canonical-json-v1', 'sha256', ?, ?, 'committed')
            `).run(command.commandId, command.intent.kind, digest, newRevision);
            fireCommitFailpoint(options, 'commit.after-receipt');
            const effectCode: ReceiptEffect['code'] = changeCommand
                ? 'plan.task-occurrence-changed'
                : deleteCommand!.intent.payload.scope === 'whole-series'
                    ? 'plan.task-series-deleted'
                    : 'plan.task-occurrence-deleted';
            this.database.prepare(`
                INSERT INTO receipt_effects (
                    command_id,
                    effect_order,
                    effect_code,
                    entity_kind,
                    entity_id,
                    entity_version
                ) VALUES (?, 0, ?, 'task-series', ?, ?)
            `).run(command.commandId, effectCode, taskSeriesId, newSeriesVersion);
            this.database.prepare(`
                INSERT INTO durable_followups (
                    follow_up_id,
                    originating_command_id,
                    owner,
                    kind,
                    prerequisite_revision,
                    state,
                    follow_up_version
                ) VALUES (?, ?, 'protect', 'backup-needed-through', ?, 'pending', 0)
            `).run(command.followUpId, command.commandId, newRevision);
            fireCommitFailpoint(options, 'commit.after-followup');
            this.database.prepare(`
                UPDATE protection_watermarks
                SET backup_needed_through = ?
                WHERE singleton = 1
            `).run(newRevision);
            fireCommitFailpoint(options, 'commit.after-watermark');
            fireCommitFailpoint(options, 'commit.before-sqlite-commit');

            commitAttempted = true;
            this.database.exec('COMMIT');
            this.revision = newRevision;
            fireCommitFailpoint(options, 'commit.after-sqlite-commit');
            const outcome = this.readReceiptOutcome(command.commandId);
            if (!outcome) {
                throw new Error('Committed Task occurrence rule receipt outcome is missing');
            }
            return successfulCommit(outcome);
        }
        catch (error) {
            if (this.terminalError) {
                throw this.terminalError;
            }
            if (commitAttempted) {
                throw this.enterTerminalState(new CommittedCommandOutcomeUnknownError(command.commandId));
            }
            this.rollbackOrRequireReopen();
            if (error instanceof TypeError) {
                throw error;
            }
            const disposition = classifySqliteFailure(error, 'pre-commit');
            if (disposition.kind === 'retryable-unchanged') {
                return writerBusyResult(this.revision);
            }
            if (disposition.kind === 'read-only') {
                this.readOnly = true;
                return permissionCommitResult(this.revision);
            }
            if (disposition.kind === 'failed-unchanged') {
                const message = disposition.reason === 'storage-full'
                    ? 'Workspace data write failed: storage full'
                    : 'Workspace data recovery is required';
                throw new Error(message);
            }
            throw new Error('Workspace data commit failed');
        }
    }

    /**
     * Commits one independent Task occurrence state/progress transition or formal Undo.
     * @param {TaskOccurrenceStateMutationCommand} command - Canonical state mutation.
     * @param {CommitOptions} options - Transaction failpoint controls used by tests.
     * @return {DataCommitResult} Committed receipt or unchanged structured problem.
     */
    private commitTaskOccurrenceStateSynchronously(
        command: TaskOccurrenceStateMutationCommand,
        options: CommitOptions,
    ): DataCommitResult {
        const digest = command.intent.kind === 'plan.set-task-progress'
            ? digestSetTaskProgress(command as SetTaskProgressCommand)
            : command.intent.kind === 'plan.undo-task-occurrence-state'
                ? digestUndoTaskOccurrenceState(command as UndoTaskOccurrenceStateCommand)
                : command.intent.intentSchemaVersion === 1
                    ? digestCompleteTask(command as CompleteTaskCommand)
                    : digestSetTaskOccurrenceStatus(command as SetTaskOccurrenceStatusCommand);
        let commitAttempted = false;

        try {
            this.database.exec('BEGIN IMMEDIATE');
            fireCommitFailpoint(options, 'commit.after-begin');
            const receipt = this.database.prepare(`
                SELECT payload_digest FROM command_receipts WHERE command_id = ?
            `).get(command.commandId) as { payload_digest: Uint8Array } | undefined;
            fireCommitFailpoint(options, 'commit.after-receipt-read');
            if (receipt) {
                const versions = this.currentVersions();
                if (!timingSafeEqual(receipt.payload_digest, digest)) {
                    this.rollbackOrRequireReopen();
                    return planConflictResult('command-id-reused', versions);
                }
                const outcome = this.readReceiptOutcome(command.commandId);
                this.rollbackOrRequireReopen();
                if (!outcome) {
                    throw new Error('Stored Task occurrence receipt is incomplete');
                }
                return successfulCommit(outcome);
            }

            const versions = this.currentVersions();
            const payload = command.intent.payload;
            const seriesStatement = this.database.prepare(`
                SELECT retired, entity_version
                FROM task_series
                WHERE task_series_id = ?
            `);
            seriesStatement.setReadBigInts(true);
            const series = seriesStatement.get(payload.taskSeriesId) as {
                retired: bigint;
                entity_version: bigint;
            } | undefined;
            if (!series || series.retired !== 0n) {
                this.rollbackOrRequireReopen();
                throw new TypeError('Task series is not editable');
            }
            if (versions.revision !== BigInt(command.expectedRevision)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-revision', versions);
            }
            if (versions.planVersion !== BigInt(command.expectedPlanVersion)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-entity-version', versions);
            }
            if (series.entity_version !== BigInt(command.expectedTaskSeriesVersion)) {
                this.rollbackOrRequireReopen();
                return taskSeriesConflictResult(versions, payload.taskSeriesId, series.entity_version);
            }
            fireCommitFailpoint(options, 'commit.after-expected-versions');

            const segmentStatement = this.database.prepare(`
                SELECT
                    task_segment_id,
                    title,
                    task_size,
                    schedule_kind,
                    deadline_kind,
                    deadline_date,
                    deadline_instant,
                    deadline_display_zone,
                    logical_start_anchor,
                    logical_end_anchor,
                    weekly_start_date,
                    weekly_weekday,
                    weekly_local_deadline_time,
                    weekly_confirmed_end_date,
                    follow_teaching_week
                FROM task_segments
                WHERE task_series_id = ?
                ORDER BY logical_start_anchor, task_segment_id
            `);
            segmentStatement.setReadBigInts(true);
            const segments = segmentStatement.all(payload.taskSeriesId) as StoredTaskSegment[];
            const segment = taskSegmentForAnchor(segments, payload.originalLogicalAnchor);
            const overrideStatement = this.database.prepare(`
                SELECT
                    original_logical_anchor,
                    override_kind,
                    replacement_title,
                    replacement_task_size,
                    replacement_deadline_kind,
                    replacement_deadline_date,
                    replacement_deadline_instant,
                    replacement_deadline_display_zone,
                    entity_version
                FROM task_occurrence_overrides
                WHERE task_series_id = ? AND original_logical_anchor = ?
            `);
            overrideStatement.setReadBigInts(true);
            const override = overrideStatement.get(
                payload.taskSeriesId,
                payload.originalLogicalAnchor,
            ) as StoredTaskOccurrenceOverride | undefined;
            if (!segment || override?.override_kind === 'deleted') {
                this.rollbackOrRequireReopen();
                throw new TypeError('Task occurrence is not active');
            }
            const effectiveSize = override?.override_kind === 'replaced'
                ? override.replacement_task_size!
                : segment.task_size;
            const stateStatement = this.database.prepare(`
                SELECT
                    original_logical_anchor,
                    status,
                    self_reported_progress,
                    entity_version
                FROM task_occurrence_states
                WHERE task_series_id = ? AND original_logical_anchor = ?
            `);
            stateStatement.setReadBigInts(true);
            const state = stateStatement.get(
                payload.taskSeriesId,
                payload.originalLogicalAnchor,
            ) as StoredTaskOccurrenceState | undefined;
            const currentStatus = state?.status ?? 'pending';
            const currentProgress = state?.self_reported_progress ?? null;
            const currentStateVersion = state?.entity_version ?? 0n;
            if (versions.revision === SQLITE_INTEGER_MAX
                || versions.planVersion === SQLITE_INTEGER_MAX
                || series.entity_version === SQLITE_INTEGER_MAX
                || currentStateVersion === SQLITE_INTEGER_MAX) {
                this.rollbackOrRequireReopen();
                throw this.enterTerminalState();
            }

            const newRevision = versions.revision + 1n;
            const newPlanVersion = versions.planVersion + 1n;
            const newSeriesVersion = series.entity_version + 1n;
            const newStateVersion = currentStateVersion + 1n;
            let undoToken: string | null = null;
            let effectCode: ReceiptEffect['code'];
            if (command.intent.kind === 'plan.undo-task-occurrence-state') {
                const undoPayload = (command as UndoTaskOccurrenceStateCommand).intent.payload;
                const historyStatement = this.database.prepare(`
                    SELECT
                        task_state_history.before_row_present,
                        task_state_history.before_status,
                        task_state_history.before_self_reported_progress,
                        task_state_history.after_state_version,
                        task_state_history.consumed,
                        receipt_effects.entity_version AS valid_through_task_series_version
                    FROM task_state_history
                    JOIN receipt_effects
                        ON receipt_effects.command_id = task_state_history.originating_command_id
                        AND receipt_effects.effect_order = 0
                        AND receipt_effects.entity_kind = 'task-series'
                        AND receipt_effects.entity_id = task_state_history.task_series_id
                    WHERE task_state_history.undo_token = ?
                        AND task_state_history.task_series_id = ?
                        AND task_state_history.original_logical_anchor = ?
                `);
                historyStatement.setReadBigInts(true);
                const history = historyStatement.get(
                    undoPayload.token,
                    payload.taskSeriesId,
                    payload.originalLogicalAnchor,
                ) as {
                    before_row_present: bigint;
                    before_status: TaskOccurrenceStatus | null;
                    before_self_reported_progress: bigint | null;
                    after_state_version: bigint;
                    consumed: bigint;
                    valid_through_task_series_version: bigint;
                } | undefined;
                if (!history
                    || history.consumed !== 0n
                    || series.entity_version !== history.valid_through_task_series_version
                    || !state
                    || state.entity_version !== history.after_state_version) {
                    this.rollbackOrRequireReopen();
                    return taskSeriesConflictResult(versions, payload.taskSeriesId, series.entity_version);
                }
                if (history.before_row_present === 0n) {
                    this.database.prepare(`
                        DELETE FROM task_occurrence_states
                        WHERE task_series_id = ? AND original_logical_anchor = ?
                    `).run(payload.taskSeriesId, payload.originalLogicalAnchor);
                }
                else {
                    this.database.prepare(`
                        UPDATE task_occurrence_states
                        SET status = ?, self_reported_progress = ?, entity_version = ?
                        WHERE task_series_id = ? AND original_logical_anchor = ?
                    `).run(
                        history.before_status,
                        history.before_self_reported_progress,
                        newStateVersion,
                        payload.taskSeriesId,
                        payload.originalLogicalAnchor,
                    );
                }
                this.database.prepare(`
                    UPDATE task_state_history SET consumed = 1 WHERE undo_token = ?
                `).run(undoPayload.token);
                effectCode = 'plan.task-occurrence-state-undone';
            }
            else {
                let nextStatus = currentStatus;
                let nextProgress = currentProgress;
                if (command.intent.kind === 'plan.set-task-progress') {
                    if (effectiveSize !== 'large' || currentStatus !== 'pending') {
                        this.rollbackOrRequireReopen();
                        throw new TypeError('Progress applies only to a pending large Task occurrence');
                    }
                    nextProgress = command.intent.payload.reportedProgress === null
                        ? null
                        : BigInt(command.intent.payload.reportedProgress);
                    if (nextProgress === currentProgress) {
                        this.rollbackOrRequireReopen();
                        throw new TypeError('Task progress is already set to the requested value');
                    }
                    effectCode = 'plan.task-progress-set';
                }
                else {
                    nextStatus = command.intent.payload.status;
                    if (nextStatus === currentStatus) {
                        this.rollbackOrRequireReopen();
                        throw new TypeError('Task occurrence already has the requested status');
                    }
                    effectCode = command.intent.intentSchemaVersion === 1
                        ? 'plan.task-occurrence-completed'
                        : 'plan.task-occurrence-status-set';
                }
                this.database.prepare(`
                    INSERT INTO task_occurrence_states (
                        task_series_id,
                        original_logical_anchor,
                        status,
                        self_reported_progress,
                        entity_version
                    ) VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT (task_series_id, original_logical_anchor) DO UPDATE SET
                        status = excluded.status,
                        self_reported_progress = excluded.self_reported_progress,
                        entity_version = excluded.entity_version
                `).run(
                    payload.taskSeriesId,
                    payload.originalLogicalAnchor,
                    nextStatus,
                    nextProgress,
                    newStateVersion,
                );
                undoToken = createHash('sha256').update(randomUUID(), 'utf8').digest('hex');
            }
            this.database.prepare(`
                UPDATE task_series SET entity_version = ? WHERE task_series_id = ?
            `).run(newSeriesVersion, payload.taskSeriesId);
            this.database.prepare(`
                UPDATE plan_state SET plan_entity_version = ? WHERE singleton = 1
            `).run(newPlanVersion);
            fireCommitFailpoint(options, 'commit.after-facts');

            this.database.prepare(`
                UPDATE workspace_state SET revision = ? WHERE singleton = 1
            `).run(newRevision);
            fireCommitFailpoint(options, 'commit.after-revision');
            this.database.prepare(`
                INSERT INTO command_receipts (
                    command_id,
                    intent_kind,
                    intent_schema_version,
                    canonical_encoding,
                    digest_algorithm,
                    payload_digest,
                    committed_revision,
                    result_kind
                ) VALUES (?, ?, ?, 'courseflow-canonical-json-v1', 'sha256', ?, ?, 'committed')
            `).run(
                command.commandId,
                command.intent.kind,
                command.intent.intentSchemaVersion,
                digest,
                newRevision,
            );
            fireCommitFailpoint(options, 'commit.after-receipt');
            this.database.prepare(`
                INSERT INTO receipt_effects (
                    command_id,
                    effect_order,
                    effect_code,
                    entity_kind,
                    entity_id,
                    entity_version
                ) VALUES (?, 0, ?, 'task-series', ?, ?)
            `).run(command.commandId, effectCode, payload.taskSeriesId, newSeriesVersion);
            this.database.prepare(`
                INSERT INTO durable_followups (
                    follow_up_id,
                    originating_command_id,
                    owner,
                    kind,
                    prerequisite_revision,
                    state,
                    follow_up_version
                ) VALUES (?, ?, 'protect', 'backup-needed-through', ?, 'pending', 0)
            `).run(command.followUpId, command.commandId, newRevision);
            fireCommitFailpoint(options, 'commit.after-followup');
            if (undoToken !== null) {
                this.database.prepare(`
                    INSERT INTO task_state_history (
                        undo_token,
                        originating_command_id,
                        task_series_id,
                        original_logical_anchor,
                        before_row_present,
                        before_status,
                        before_self_reported_progress,
                        after_state_version,
                        consumed
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
                `).run(
                    undoToken,
                    command.commandId,
                    payload.taskSeriesId,
                    payload.originalLogicalAnchor,
                    state ? 1 : 0,
                    state?.status ?? null,
                    state?.self_reported_progress ?? null,
                    newStateVersion,
                );
            }
            this.database.prepare(`
                UPDATE protection_watermarks
                SET backup_needed_through = ?
                WHERE singleton = 1
            `).run(newRevision);
            fireCommitFailpoint(options, 'commit.after-watermark');
            fireCommitFailpoint(options, 'commit.before-sqlite-commit');

            commitAttempted = true;
            this.database.exec('COMMIT');
            this.revision = newRevision;
            fireCommitFailpoint(options, 'commit.after-sqlite-commit');
            const outcome = this.readReceiptOutcome(command.commandId);
            if (!outcome || (undoToken !== null && outcome.undoCapability?.token !== undoToken)) {
                throw new Error('Committed Task occurrence receipt outcome is missing');
            }
            return successfulCommit(outcome);
        }
        catch (error) {
            if (this.terminalError) {
                throw this.terminalError;
            }
            if (commitAttempted) {
                throw this.enterTerminalState(new CommittedCommandOutcomeUnknownError(command.commandId));
            }
            this.rollbackOrRequireReopen();
            if (error instanceof TypeError) {
                throw error;
            }
            const disposition = classifySqliteFailure(error, 'pre-commit');
            if (disposition.kind === 'retryable-unchanged') {
                return writerBusyResult(this.revision);
            }
            if (disposition.kind === 'read-only') {
                this.readOnly = true;
                return permissionCommitResult(this.revision);
            }
            if (disposition.kind === 'failed-unchanged') {
                const message = disposition.reason === 'storage-full'
                    ? 'Workspace data write failed: storage full'
                    : 'Workspace data recovery is required';
                throw new Error(message);
            }
            throw new Error('Workspace data commit failed');
        }
    }

    /**
     * Commits one bounded Task lifecycle transition and its durable receipt atomically.
     * @param {TaskSeriesMutationCommand} command - Normalized Task series command.
     * @param {CommitOptions} options - Transaction failpoint controls used by tests.
     * @return {DataCommitResult} Committed receipt or unchanged structured problem.
     */
    private commitTaskSynchronously(
        command: TaskSeriesMutationCommand,
        options: CommitOptions,
    ): DataCommitResult {
        const digest = command.intent.kind === 'plan.create-task-series'
            ? digestCreateTask(command as CreateTaskCommand)
            : command.intent.kind === 'plan.update-task-series'
                ? digestUpdateTask(command as UpdateTaskCommand)
                : digestDeleteTask(command as DeleteTaskCommand);
        let commitAttempted = false;

        try {
            this.database.exec('BEGIN IMMEDIATE');
            fireCommitFailpoint(options, 'commit.after-begin');

            const receipt = this.database.prepare(`
                SELECT payload_digest
                FROM command_receipts
                WHERE command_id = ?
            `).get(command.commandId) as { payload_digest: Uint8Array } | undefined;
            fireCommitFailpoint(options, 'commit.after-receipt-read');
            if (receipt) {
                const versions = this.currentVersions();
                if (!timingSafeEqual(receipt.payload_digest, digest)) {
                    this.rollbackOrRequireReopen();
                    return planConflictResult('command-id-reused', versions);
                }
                const outcome = this.readReceiptOutcome(command.commandId);
                this.rollbackOrRequireReopen();
                if (!outcome) {
                    throw new Error('Stored receipt outcome is incomplete');
                }
                return successfulCommit(outcome);
            }

            const versions = this.currentVersions();
            if (versions.revision !== BigInt(command.expectedRevision)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-revision', versions);
            }
            if (versions.planVersion !== BigInt(command.expectedPlanVersion)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-entity-version', versions);
            }

            const existing = command.intent.kind === 'plan.create-task-series'
                ? undefined
                : (() => {
                    const statement = this.database.prepare(`
                        SELECT
                            task_series.course_id,
                            task_series.retired,
                            task_series.entity_version,
                            (
                                SELECT schedule_kind
                                FROM task_segments
                                WHERE task_segments.task_series_id = task_series.task_series_id
                                ORDER BY logical_start_anchor, task_segment_id
                                LIMIT 1
                            ) AS schedule_kind,
                            (
                                SELECT status
                                FROM task_occurrence_states
                                WHERE task_occurrence_states.task_series_id = task_series.task_series_id
                                    AND task_occurrence_states.original_logical_anchor = 'once'
                            ) AS status,
                            (
                                SELECT count(*)
                                FROM task_segments
                                WHERE task_segments.task_series_id = task_series.task_series_id
                            ) AS segment_count,
                            (
                                SELECT count(*)
                                FROM task_occurrence_states
                                WHERE task_occurrence_states.task_series_id = task_series.task_series_id
                            ) AS state_count,
                            (
                                SELECT count(*)
                                FROM task_occurrence_overrides
                                WHERE task_occurrence_overrides.task_series_id = task_series.task_series_id
                            ) AS override_count
                        FROM task_series
                        WHERE task_series.task_series_id = ?
                    `);
                    statement.setReadBigInts(true);
                    return statement.get(command.intent.payload.taskSeriesId) as {
                        course_id: string;
                        retired: bigint;
                        entity_version: bigint;
                        schedule_kind: TaskSchedule['kind'];
                        status: TaskOccurrenceStatus | null;
                        segment_count: bigint;
                        state_count: bigint;
                        override_count: bigint;
                    } | undefined;
                })();
            if (command.intent.kind !== 'plan.create-task-series') {
                const mutation = command as UpdateTaskCommand | DeleteTaskCommand;
                if (!existing || existing.retired !== 0n) {
                    this.rollbackOrRequireReopen();
                    throw new TypeError('Task series is not editable');
                }
                if (existing.entity_version !== BigInt(mutation.expectedTaskSeriesVersion)) {
                    this.rollbackOrRequireReopen();
                    return taskSeriesConflictResult(
                        versions,
                        command.intent.payload.taskSeriesId,
                        existing.entity_version,
                    );
                }
            }
            fireCommitFailpoint(options, 'commit.after-expected-versions');

            if (command.intent.kind === 'plan.delete-task-series') {
                this.rollbackOrRequireReopen();
                return decisionRequiredResult(versions.revision);
            }

            const courseId = command.intent.kind === 'plan.create-task-series'
                || command.intent.kind === 'plan.update-task-series'
                ? command.intent.payload.courseId
                : existing!.course_id;
            const sourceCourseId = existing?.course_id ?? courseId;
            const courseStatement = this.database.prepare(`
                SELECT count(*) AS count
                FROM courses
                JOIN terms ON terms.term_id = courses.term_id
                JOIN plan_state ON plan_state.singleton = 1
                WHERE courses.course_id IN (?, ?)
                    AND courses.archived = 0
                    AND terms.archived = 0
                    AND plan_state.current_term_id = courses.term_id
            `);
            courseStatement.setReadBigInts(true);
            const activeCurrentCourseCount = (courseStatement.get(courseId, sourceCourseId) as {
                count: bigint;
            }).count;
            const requiredCourseCount = courseId === sourceCourseId ? 1n : 2n;
            if (activeCurrentCourseCount !== requiredCourseCount) {
                this.rollbackOrRequireReopen();
                throw new TypeError('Task requires an active Current Term Course');
            }
            const proposedSchedule = command.intent.kind === 'plan.create-task-series'
                || command.intent.kind === 'plan.update-task-series'
                ? taskSchedule(command.intent.payload)
                : null;
            if (command.intent.kind === 'plan.update-task-series'
                && existing!.schedule_kind === 'once'
                && proposedSchedule!.kind === 'weekly'
                && existing!.status !== null) {
                this.rollbackOrRequireReopen();
                throw new TypeError('Completed once Task cannot become weekly without preserving instance state');
            }
            if (command.intent.kind === 'plan.update-task-series'
                && (existing!.segment_count !== 1n
                    || existing!.state_count !== 0n
                    || existing!.override_count !== 0n)) {
                this.rollbackOrRequireReopen();
                throw new TypeError('Task history requires scoped occurrence editing');
            }
            if (proposedSchedule?.kind === 'weekly') {
                const courseRange = this.database.prepare(`
                    SELECT
                        CASE
                            WHEN courses.teaching_range_kind = 'explicit'
                                THEN courses.teaching_start_date
                            ELSE terms.start_date
                        END AS teaching_start_date,
                        CASE
                            WHEN courses.teaching_range_kind = 'explicit'
                                THEN courses.teaching_end_date
                            ELSE terms.end_date
                        END AS teaching_end_date,
                        terms.time_zone AS term_zone
                    FROM courses
                    JOIN terms ON terms.term_id = courses.term_id
                    WHERE courses.course_id = ?
                `).get(courseId) as {
                    teaching_start_date: string;
                    teaching_end_date: string;
                    term_zone: string;
                };
                const firstAnchor = firstTaskWeeklyAnchor(
                    proposedSchedule.startDate,
                    proposedSchedule.weekday,
                );
                if (proposedSchedule.startDate < courseRange.teaching_start_date
                    || proposedSchedule.confirmedEndDate > courseRange.teaching_end_date
                    || firstAnchor === null
                    || firstAnchor > proposedSchedule.confirmedEndDate) {
                    this.rollbackOrRequireReopen();
                    throw new TypeError('Weekly Task range must produce an occurrence inside the Course range');
                }
                const lastAnchor = lastTaskWeeklyAnchor(
                    proposedSchedule.confirmedEndDate,
                    proposedSchedule.weekday,
                );
                const boundaryInstants = [firstAnchor, lastAnchor].map(anchor => (
                    INTL_ZONE_RULES.resolveInstant(
                        courseRange.term_zone,
                        anchor,
                        proposedSchedule.localDeadlineTime,
                    )
                ));
                if (!boundaryInstants.every(isCanonicalInstant)) {
                    this.rollbackOrRequireReopen();
                    throw new TypeError('Weekly Task deadline must resolve to canonical Instants');
                }
            }

            const existingVersion = existing?.entity_version ?? 0n;
            if (versions.revision === SQLITE_INTEGER_MAX
                || versions.planVersion === SQLITE_INTEGER_MAX
                || existingVersion === SQLITE_INTEGER_MAX) {
                this.rollbackOrRequireReopen();
                throw this.enterTerminalState();
            }

            const taskSeriesId = command.intent.kind === 'plan.create-task-series'
                ? randomUUID()
                : command.intent.payload.taskSeriesId;
            const newRevision = versions.revision + 1n;
            const newPlanVersion = versions.planVersion + 1n;
            const newTaskSeriesVersion = existingVersion + 1n;
            if (command.intent.kind === 'plan.create-task-series') {
                const taskRule = taskSchedule(command.intent.payload);
                const schedule = taskScheduleColumns(taskRule);
                const logicalAnchors = taskLogicalAnchors(taskRule);
                this.database.prepare(`
                    INSERT INTO task_series (
                        task_series_id,
                        course_id,
                        retired,
                        entity_version
                    ) VALUES (?, ?, 0, 1)
                `).run(taskSeriesId, courseId);
                this.database.prepare(`
                    INSERT INTO task_segments (
                        task_segment_id,
                        task_series_id,
                        title,
                        task_size,
                        schedule_kind,
                        deadline_kind,
                        deadline_date,
                        deadline_instant,
                        deadline_display_zone,
                        weekly_start_date,
                        weekly_weekday,
                        weekly_local_deadline_time,
                        weekly_confirmed_end_date,
                        follow_teaching_week,
                        logical_start_anchor,
                        logical_end_anchor
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    randomUUID(),
                    taskSeriesId,
                    command.intent.payload.title,
                    command.intent.payload.size,
                    ...schedule,
                    ...logicalAnchors,
                );
            }
            else if (command.intent.kind === 'plan.update-task-series') {
                const taskRule = taskSchedule(command.intent.payload);
                const schedule = taskScheduleColumns(taskRule);
                const logicalAnchors = taskLogicalAnchors(taskRule);
                this.database.prepare(`
                    UPDATE task_series
                    SET course_id = ?, entity_version = ?
                    WHERE task_series_id = ? AND retired = 0
                `).run(courseId, newTaskSeriesVersion, taskSeriesId);
                this.database.prepare(`
                    UPDATE task_segments
                    SET
                        title = ?,
                        task_size = ?,
                        schedule_kind = ?,
                        deadline_kind = ?,
                        deadline_date = ?,
                        deadline_instant = ?,
                        deadline_display_zone = ?,
                        weekly_start_date = ?,
                        weekly_weekday = ?,
                        weekly_local_deadline_time = ?,
                        weekly_confirmed_end_date = ?,
                        follow_teaching_week = ?,
                        logical_start_anchor = ?,
                        logical_end_anchor = ?
                    WHERE task_series_id = ?
                `).run(
                    command.intent.payload.title,
                    command.intent.payload.size,
                    ...schedule,
                    ...logicalAnchors,
                    taskSeriesId,
                );
            }
            this.database.prepare(`
                UPDATE plan_state SET plan_entity_version = ? WHERE singleton = 1
            `).run(newPlanVersion);
            fireCommitFailpoint(options, 'commit.after-facts');

            this.database.prepare(
                'UPDATE workspace_state SET revision = ? WHERE singleton = 1',
            ).run(newRevision);
            fireCommitFailpoint(options, 'commit.after-revision');

            this.database.prepare(`
                INSERT INTO command_receipts (
                    command_id,
                    intent_kind,
                    intent_schema_version,
                    canonical_encoding,
                    digest_algorithm,
                    payload_digest,
                    committed_revision,
                    result_kind
                ) VALUES (?, ?, ?, 'courseflow-canonical-json-v1', 'sha256', ?, ?, 'committed')
            `).run(
                command.commandId,
                command.intent.kind,
                command.intent.intentSchemaVersion,
                digest,
                newRevision,
            );
            fireCommitFailpoint(options, 'commit.after-receipt');

            const effectCode: ReceiptEffect['code'] = command.intent.kind === 'plan.create-task-series'
                ? 'plan.task-series-created'
                : 'plan.task-series-updated';
            this.database.prepare(`
                INSERT INTO receipt_effects (
                    command_id,
                    effect_order,
                    effect_code,
                    entity_kind,
                    entity_id,
                    entity_version
                ) VALUES (?, 0, ?, 'task-series', ?, ?)
            `).run(command.commandId, effectCode, taskSeriesId, newTaskSeriesVersion);
            this.database.prepare(`
                INSERT INTO durable_followups (
                    follow_up_id,
                    originating_command_id,
                    owner,
                    kind,
                    prerequisite_revision,
                    state,
                    follow_up_version
                ) VALUES (?, ?, 'protect', 'backup-needed-through', ?, 'pending', 0)
            `).run(command.followUpId, command.commandId, newRevision);
            fireCommitFailpoint(options, 'commit.after-followup');

            this.database.prepare(`
                UPDATE protection_watermarks
                SET backup_needed_through = ?
                WHERE singleton = 1
            `).run(newRevision);
            fireCommitFailpoint(options, 'commit.after-watermark');
            fireCommitFailpoint(options, 'commit.before-sqlite-commit');

            commitAttempted = true;
            this.database.exec('COMMIT');
            this.revision = newRevision;
            fireCommitFailpoint(options, 'commit.after-sqlite-commit');
            const outcome = this.readReceiptOutcome(command.commandId);
            if (!outcome) {
                throw new Error('Committed receipt outcome is missing');
            }
            return successfulCommit(outcome);
        }
        catch (error) {
            if (this.terminalError) {
                throw this.terminalError;
            }
            if (commitAttempted) {
                throw this.enterTerminalState(new CommittedCommandOutcomeUnknownError(command.commandId));
            }
            this.rollbackOrRequireReopen();
            if (error instanceof TypeError) {
                throw error;
            }
            const disposition = classifySqliteFailure(error, 'pre-commit');
            if (disposition.kind === 'retryable-unchanged') {
                return writerBusyResult(this.revision);
            }
            if (disposition.kind === 'read-only') {
                this.readOnly = true;
                return permissionCommitResult(this.revision);
            }
            if (disposition.kind === 'failed-unchanged') {
                const message = disposition.reason === 'storage-full'
                    ? 'Workspace data write failed: storage full'
                    : 'Workspace data recovery is required';
                throw new Error(message);
            }
            throw new Error('Workspace data commit failed');
        }
    }

    private commitTermMutationSynchronously(
        command: TermMutationCommand,
        options: CommitOptions,
    ): DataCommitResult {
        const digest = command.intent.kind === 'workspace.reconcile-lifecycle'
            ? digestReconcileWorkspaceLifecycle(command as ReconcileWorkspaceLifecycleCommand)
            : command.intent.kind === 'plan.update-term-end-date'
                ? digestUpdateTermEndDate(command as UpdateTermEndDateCommand)
                : digestRestoreTermAsCurrent(command as RestoreTermAsCurrentCommand);
        const effectCode: ReceiptEffect['code'] = command.intent.kind === 'workspace.reconcile-lifecycle'
            ? 'plan.term-auto-archived'
            : command.intent.kind === 'plan.update-term-end-date'
                ? 'plan.term-end-date-updated'
                : 'plan.term-restored-current';
        let commitAttempted = false;

        try {
            this.database.exec('BEGIN IMMEDIATE');
            fireCommitFailpoint(options, 'commit.after-begin');

            const receipt = this.database.prepare(`
                SELECT payload_digest
                FROM command_receipts
                WHERE command_id = ?
            `).get(command.commandId) as { payload_digest: Uint8Array } | undefined;
            fireCommitFailpoint(options, 'commit.after-receipt-read');
            if (receipt) {
                const versions = this.currentVersions();
                if (!timingSafeEqual(receipt.payload_digest, digest)) {
                    this.rollbackOrRequireReopen();
                    return planConflictResult('command-id-reused', versions);
                }

                const outcome = this.readReceiptOutcome(command.commandId);
                this.rollbackOrRequireReopen();
                if (!outcome) {
                    throw new Error('Stored receipt outcome is incomplete');
                }
                return successfulCommit(outcome);
            }

            const versions = this.currentVersions();
            if (versions.revision !== BigInt(command.expectedRevision)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-revision', versions);
            }
            if (versions.planVersion !== BigInt(command.expectedPlanVersion)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-entity-version', versions);
            }

            const term = this.database.prepare(`
                SELECT
                    terms.term_id,
                    terms.start_date,
                    terms.end_date,
                    terms.time_zone,
                    terms.archived,
                    terms.entity_version,
                    plan_state.current_term_id
                FROM terms
                JOIN plan_state ON plan_state.singleton = 1
                WHERE terms.term_id = ?
            `);
            term.setReadBigInts(true);
            const termRow = term.get(command.intent.payload.termId) as {
                term_id: string;
                start_date: string;
                end_date: string;
                time_zone: string;
                archived: bigint;
                entity_version: bigint;
                current_term_id: string | null;
            } | undefined;
            if (!termRow || termRow.entity_version !== BigInt(command.expectedTermVersion)) {
                this.rollbackOrRequireReopen();
                return planConflictResult('expected-entity-version', versions);
            }
            fireCommitFailpoint(options, 'commit.after-expected-versions');

            const evaluation = 'evaluation' in command
                ? command.evaluation
                : command.intent.kind === 'workspace.reconcile-lifecycle'
                    ? command.intent.payload.evaluation
                    : null;
            if (evaluation
                && (evaluation.termZone !== termRow.time_zone
                    || localDateInTermZone(evaluation.evaluatedAt, termRow.time_zone)
                        !== evaluation.applicableDate)) {
                this.rollbackOrRequireReopen();
                throw new TypeError('Term evaluation no longer matches the target Term');
            }

            if (command.intent.kind === 'workspace.reconcile-lifecycle') {
                if (termRow.current_term_id !== termRow.term_id
                    || termRow.archived !== 0n
                    || command.intent.payload.evaluation.applicableDate <= termRow.end_date) {
                    this.rollbackOrRequireReopen();
                    throw new TypeError('Current Term is not eligible for automatic archive');
                }
            }
            else if (command.intent.kind === 'plan.update-term-end-date') {
                const newEndDate = command.intent.payload.endDate;
                if (newEndDate < termRow.start_date) {
                    this.rollbackOrRequireReopen();
                    throw new TypeError('Term end date must not precede its start date');
                }

                const strandedHolidayRange = this.database.prepare(`
                    SELECT holiday_range_id
                    FROM holiday_ranges
                    WHERE term_id = ? AND tombstoned = 0 AND end_date > ?
                    LIMIT 1
                `).get(termRow.term_id, newEndDate) as { holiday_range_id: string } | undefined;
                if (strandedHolidayRange) {
                    this.rollbackOrRequireReopen();
                    throw new TypeError('Corrected Term range would exclude a HolidayRange');
                }

                const courseStatement = this.database.prepare(`
                    SELECT
                        course_id,
                        teaching_range_kind,
                        teaching_start_date,
                        teaching_end_date
                    FROM courses
                    WHERE term_id = ?
                `);
                const courses = courseStatement.all(termRow.term_id) as Array<{
                    course_id: string;
                    teaching_range_kind: CourseTeachingRangeIntent['kind'];
                    teaching_start_date: string | null;
                    teaching_end_date: string | null;
                }>;
                const resolvedCourses = courses.map(course => ({
                    courseId: course.course_id,
                    startDate: course.teaching_range_kind === 'inherit-term'
                        ? termRow.start_date
                        : course.teaching_start_date!,
                    endDate: course.teaching_range_kind === 'inherit-term'
                        ? newEndDate
                        : course.teaching_end_date!,
                }));
                if (resolvedCourses.some(course => (
                    course.startDate < termRow.start_date || course.endDate > newEndDate
                ))) {
                    this.rollbackOrRequireReopen();
                    throw new TypeError('Corrected Term range would exclude a Course');
                }

                const meetingStatement = this.database.prepare(`
                    SELECT
                        meeting_series.course_id,
                        meeting_segments.effective_range_kind,
                        meeting_segments.effective_start_date,
                        meeting_segments.effective_end_date
                    FROM meeting_segments
                    JOIN meeting_series
                        ON meeting_series.meeting_series_id = meeting_segments.meeting_series_id
                    JOIN courses ON courses.course_id = meeting_series.course_id
                    WHERE courses.term_id = ?
                `);
                const meetings = meetingStatement.all(termRow.term_id) as Array<{
                    course_id: string;
                    effective_range_kind: MeetingEffectiveRangeIntent['kind'];
                    effective_start_date: string | null;
                    effective_end_date: string | null;
                }>;
                const meetingOutsideCourse = meetings.some(meeting => {
                    const course = resolvedCourses.find(candidate => candidate.courseId === meeting.course_id)!;
                    const startDate = meeting.effective_range_kind === 'inherit-course'
                        ? course.startDate
                        : meeting.effective_start_date!;
                    const endDate = meeting.effective_range_kind === 'inherit-course'
                        ? course.endDate
                        : meeting.effective_end_date!;
                    return startDate < course.startDate || endDate > course.endDate;
                });
                if (meetingOutsideCourse) {
                    this.rollbackOrRequireReopen();
                    throw new TypeError('Corrected Term range would exclude a Meeting');
                }

                const weeklyTasks = this.database.prepare(`
                    SELECT
                        task_series.course_id,
                        task_segments.weekly_start_date,
                        task_segments.weekly_confirmed_end_date
                    FROM task_segments
                    JOIN task_series ON task_series.task_series_id = task_segments.task_series_id
                    JOIN courses ON courses.course_id = task_series.course_id
                    WHERE courses.term_id = ?
                        AND task_segments.schedule_kind = 'weekly'
                `).all(termRow.term_id) as Array<{
                    course_id: string;
                    weekly_start_date: string;
                    weekly_confirmed_end_date: string;
                }>;
                const taskOutsideCourse = weeklyTasks.some(task => {
                    const course = resolvedCourses.find(candidate => candidate.courseId === task.course_id)!;
                    return task.weekly_start_date < course.startDate
                        || task.weekly_confirmed_end_date > course.endDate;
                });
                if (taskOutsideCourse) {
                    this.rollbackOrRequireReopen();
                    throw new TypeError('Corrected Term range would exclude a weekly Task');
                }
            }
            else if (termRow.archived !== 1n
                || termRow.current_term_id !== null
                || evaluation === null
                || evaluation.applicableDate > termRow.end_date) {
                this.rollbackOrRequireReopen();
                throw new TypeError('Term is not eligible to restore as Current');
            }

            if (versions.revision === SQLITE_INTEGER_MAX
                || versions.planVersion === SQLITE_INTEGER_MAX
                || termRow.entity_version === SQLITE_INTEGER_MAX) {
                this.rollbackOrRequireReopen();
                throw this.enterTerminalState();
            }

            const newRevision = versions.revision + 1n;
            const newPlanVersion = versions.planVersion + 1n;
            const newTermVersion = termRow.entity_version + 1n;
            if (command.intent.kind === 'workspace.reconcile-lifecycle') {
                this.database.prepare(`
                    UPDATE terms SET archived = 1, entity_version = ? WHERE term_id = ?
                `).run(newTermVersion, termRow.term_id);
                this.database.prepare(`
                    UPDATE plan_state
                    SET current_term_id = NULL, plan_entity_version = ?
                    WHERE singleton = 1
                `).run(newPlanVersion);
            }
            else if (command.intent.kind === 'plan.update-term-end-date') {
                this.database.prepare(`
                    UPDATE terms SET end_date = ?, entity_version = ? WHERE term_id = ?
                `).run(command.intent.payload.endDate, newTermVersion, termRow.term_id);
                this.database.prepare(`
                    UPDATE plan_state SET plan_entity_version = ? WHERE singleton = 1
                `).run(newPlanVersion);
            }
            else {
                this.database.prepare(`
                    UPDATE terms SET archived = 0, entity_version = ? WHERE term_id = ?
                `).run(newTermVersion, termRow.term_id);
                this.database.prepare(`
                    UPDATE plan_state
                    SET current_term_id = ?, plan_entity_version = ?
                    WHERE singleton = 1
                `).run(termRow.term_id, newPlanVersion);
            }
            fireCommitFailpoint(options, 'commit.after-facts');

            this.database.prepare(
                'UPDATE workspace_state SET revision = ? WHERE singleton = 1',
            ).run(newRevision);
            fireCommitFailpoint(options, 'commit.after-revision');

            this.database.prepare(`
                INSERT INTO command_receipts (
                    command_id,
                    intent_kind,
                    intent_schema_version,
                    canonical_encoding,
                    digest_algorithm,
                    payload_digest,
                    committed_revision,
                    result_kind
                ) VALUES (?, ?, 1, 'courseflow-canonical-json-v1', 'sha256', ?, ?, 'committed')
            `).run(command.commandId, command.intent.kind, digest, newRevision);
            fireCommitFailpoint(options, 'commit.after-receipt');

            this.database.prepare(`
                INSERT INTO receipt_effects (
                    command_id,
                    effect_order,
                    effect_code,
                    entity_kind,
                    entity_id,
                    entity_version
                ) VALUES (?, 0, ?, 'term', ?, ?)
            `).run(command.commandId, effectCode, termRow.term_id, newTermVersion);
            this.database.prepare(`
                INSERT INTO durable_followups (
                    follow_up_id,
                    originating_command_id,
                    owner,
                    kind,
                    prerequisite_revision,
                    state,
                    follow_up_version
                ) VALUES (?, ?, 'protect', 'backup-needed-through', ?, 'pending', 0)
            `).run(command.followUpId, command.commandId, newRevision);
            fireCommitFailpoint(options, 'commit.after-followup');

            this.database.prepare(`
                UPDATE protection_watermarks
                SET backup_needed_through = ?
                WHERE singleton = 1
            `).run(newRevision);
            fireCommitFailpoint(options, 'commit.after-watermark');
            fireCommitFailpoint(options, 'commit.before-sqlite-commit');

            commitAttempted = true;
            this.database.exec('COMMIT');
            this.revision = newRevision;
            fireCommitFailpoint(options, 'commit.after-sqlite-commit');
            const outcome = this.readReceiptOutcome(command.commandId);
            if (!outcome) {
                throw new Error('Committed receipt outcome is missing');
            }
            return successfulCommit(outcome);
        }
        catch (error) {
            if (this.terminalError) {
                throw this.terminalError;
            }
            if (commitAttempted) {
                throw this.enterTerminalState(new CommittedCommandOutcomeUnknownError(command.commandId));
            }
            this.rollbackOrRequireReopen();
            if (error instanceof TypeError) {
                throw error;
            }
            const disposition = classifySqliteFailure(error, 'pre-commit');
            if (disposition.kind === 'retryable-unchanged') {
                return writerBusyResult(this.revision);
            }
            if (disposition.kind === 'read-only') {
                this.readOnly = true;
                return permissionCommitResult(this.revision);
            }
            if (disposition.kind === 'failed-unchanged') {
                const message = disposition.reason === 'storage-full'
                    ? 'Workspace data write failed: storage full'
                    : 'Workspace data recovery is required';
                throw new Error(message);
            }
            throw new Error('Workspace data commit failed');
        }
    }

    private drain(): void {
        let work = this.queue.shift();
        while (work) {
            try {
                work.resolve(this.commitSynchronously(work.command, work.options));
            } catch (error) {
                work.reject(error);
                if (this.terminalError) {
                    break;
                }
            }
            work = this.queue.shift();
        }

        this.running = false;
        if (!this.accepting && !this.terminalError) {
            this.closeDatabase();
        }
    }

    private enterTerminalState(error = new Error('Workspace data store requires reopen')): Error {
        if (this.terminalError) {
            return this.terminalError;
        }

        this.terminalError = error;
        this.accepting = false;
        let work = this.queue.shift();
        while (work) {
            work.reject(this.terminalError);
            work = this.queue.shift();
        }
        try {
            this.database.close();
        } catch {
            // Reopen is required regardless of whether best-effort close succeeds.
        }
        this.closed = true;
        this.finishClose?.();
        this.finishClose = undefined;
        this.failClose = undefined;
        return this.terminalError;
    }

    private closeDatabase(): void {
        try {
            this.database.close();
            this.closed = true;
            this.finishClose?.();
        } catch (error) {
            this.failClose?.(error);
        } finally {
            this.finishClose = undefined;
            this.failClose = undefined;
        }
    }

    private requireOpen(): void {
        if (this.terminalError) {
            throw this.terminalError;
        }
        if (this.closed) {
            throw new Error('Workspace data store is closed');
        }
    }
}

export type SqliteDataStore = InstanceType<typeof SqliteDataStoreImplementation>;

function incompatibleVersionProblem(actualSchemaLevel: number): DataOpenProblem {
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

function integrityProblem(
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

function databaseUnreadableProblem(): DataOpenProblem {
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

function recoveryResult(problem: DataOpenProblem): DataOpenResult {
    return Object.freeze({
        kind: 'recovery' as const,
        sqliteVersion: SQLITE_VERSION,
        problem,
    });
}

function closeBestEffort(database: DatabaseSync | undefined): void {
    try {
        database?.close();
    } catch {
        // The stable open classification does not depend on a second close failure.
    }
}

function primarySqliteCode(error: unknown): number | undefined {
    if (typeof error !== 'object'
        || error === null
        || !('errcode' in error)
        || typeof error.errcode !== 'number') {
        return undefined;
    }
    return error.errcode & 0xFF;
}

function unreadableOpenProblem(error: unknown): DataOpenProblem {
    const primaryCode = primarySqliteCode(error);
    if (primaryCode === 11 || primaryCode === 26) {
        return integrityProblem('database-corrupt');
    }
    return databaseUnreadableProblem();
}

function validationProblem(error: unknown): DataOpenProblem {
    if (error instanceof SchemaValidationError) {
        return integrityProblem(error.reason);
    }
    return unreadableOpenProblem(error);
}

function readDatabaseIdentity(database: DatabaseSync): Readonly<{
    applicationId: number;
    schemaLevel: number;
}> {
    const applicationId = database.prepare('PRAGMA application_id').get() as { application_id: number };
    const userVersion = database.prepare('PRAGMA user_version').get() as { user_version: number };
    return {
        applicationId: applicationId.application_id,
        schemaLevel: userVersion.user_version,
    };
}

function hasSchemaObjects(database: DatabaseSync): boolean {
    const row = database.prepare(`
        SELECT count(*) AS count
        FROM sqlite_schema
        WHERE name NOT LIKE 'sqlite_%'
    `).get() as { count: number };
    return row.count !== 0;
}

export function initializeWorkspaceData(
    dataSlotsRoot: string,
    workspaceId: string,
    options: InitializeWorkspaceDataOptions = {},
): SqliteDataStore {
    if (!isCanonicalUuid(workspaceId)) {
        throw new TypeError('WorkspaceId must be a canonical UUID');
    }
    if (existsSync(activeDirectory(dataSlotsRoot))) {
        throw new Error('Workspace data is already initialized');
    }

    const stagingDirectory = join(dataSlotsRoot, `.initialize-${randomUUID()}`);
    const stagingDatabasePath = join(stagingDirectory, DATABASE_FILE_NAME);
    let stagingDatabase: DatabaseSync | undefined;
    let activated = false;

    try {
        mkdirSync(stagingDirectory);
        stagingDatabase = openDatabase(stagingDatabasePath, false);
        stagingDatabase.exec('BEGIN IMMEDIATE');
        stagingDatabase.exec(`PRAGMA application_id = ${COURSEFLOW_APPLICATION_ID}`);
        createSchemaLevel10(stagingDatabase);
        throwFailpoint(options.failpoint, 'initialize.after-schema');
        stagingDatabase.prepare(
            'INSERT INTO workspace_state (singleton, workspace_id, revision) VALUES (1, ?, 0)',
        ).run(workspaceId);
        stagingDatabase.exec(`
            INSERT INTO setup_state (
                singleton,
                last_decision,
                setup_decision_version,
                ever_reached_minimum
            ) VALUES (1, NULL, 0, 0);
            INSERT INTO protection_watermarks (
                singleton,
                backup_needed_through,
                backup_succeeded_through
            ) VALUES (1, 0, 0);
            INSERT INTO plan_state (
                singleton,
                current_term_id,
                plan_entity_version
            ) VALUES (1, NULL, 0);
        `);
        throwFailpoint(options.failpoint, 'initialize.after-bootstrap');
        stagingDatabase.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_LEVEL}`);
        throwFailpoint(options.failpoint, 'initialize.after-user-version');
        stagingDatabase.exec('COMMIT');
        stagingDatabase.close();
        stagingDatabase = undefined;

        const validationDatabase = openDatabase(stagingDatabasePath, true);
        try {
            validateSchemaLevel10(validationDatabase);
        } finally {
            validationDatabase.close();
        }
        throwFailpoint(options.failpoint, 'initialize.after-validation');

        renameSync(stagingDirectory, activeDirectory(dataSlotsRoot));
        activated = true;
        const activeDatabase = openDatabase(databasePath(dataSlotsRoot), false);
        const facts = validateSchemaLevel10(activeDatabase);
        return new SqliteDataStoreImplementation(activeDatabase, facts.workspaceId, facts.revision);
    } catch (error) {
        if (stagingDatabase?.isTransaction) {
            stagingDatabase.exec('ROLLBACK');
        }
        stagingDatabase?.close();
        if (!activated) {
            rmSync(stagingDirectory, { recursive: true, force: true });
        }
        throw error;
    }
}

export function openWorkspaceData(
    dataSlotsRoot: string,
    options: OpenWorkspaceDataOptions = {},
): DataOpenResult {
    const active = activeDirectory(dataSlotsRoot);
    let activeStats: ReturnType<typeof lstatSync> | undefined;
    try {
        activeStats = lstatSync(active, { throwIfNoEntry: false });
    } catch {
        return recoveryResult(databaseUnreadableProblem());
    }
    if (!activeStats) {
        return Object.freeze({ kind: 'absent' as const, sqliteVersion: SQLITE_VERSION });
    }
    if (!activeStats.isDirectory()) {
        return recoveryResult(databaseUnreadableProblem());
    }

    const path = databasePath(dataSlotsRoot);
    try {
        const databaseStats = lstatSync(path, { throwIfNoEntry: false });
        if (!databaseStats?.isFile()) {
            return recoveryResult(databaseUnreadableProblem());
        }
    } catch {
        return recoveryResult(databaseUnreadableProblem());
    }

    let validationDatabase: DatabaseSync;
    try {
        validationDatabase = openDatabase(path, true);
    } catch (error) {
        return recoveryResult(unreadableOpenProblem(error));
    }

    let expectedWorkspaceId: string;
    let expectedRevision: bigint;
    try {
        const identity = readDatabaseIdentity(validationDatabase);
        if (identity.schemaLevel === 0) {
            const problem = hasSchemaObjects(validationDatabase)
                ? integrityProblem('nonempty-level-zero')
                : integrityProblem('schema-mismatch');
            closeBestEffort(validationDatabase);
            return recoveryResult(problem);
        }
        if (identity.applicationId !== COURSEFLOW_APPLICATION_ID) {
            closeBestEffort(validationDatabase);
            return recoveryResult(integrityProblem('wrong-application-id'));
        }
        if (identity.schemaLevel > CURRENT_SCHEMA_LEVEL) {
            closeBestEffort(validationDatabase);
            return recoveryResult(incompatibleVersionProblem(identity.schemaLevel));
        }
        if (identity.schemaLevel !== CURRENT_SCHEMA_LEVEL) {
            closeBestEffort(validationDatabase);
            return recoveryResult(integrityProblem('schema-mismatch'));
        }

        const facts = validateSchemaLevel10(validationDatabase);
        expectedWorkspaceId = facts.workspaceId;
        expectedRevision = facts.revision;
    } catch (error) {
        closeBestEffort(validationDatabase);
        return recoveryResult(validationProblem(error));
    }

    if (options.readOnly) {
        return Object.freeze({
            kind: 'read-only' as const,
            sqliteVersion: SQLITE_VERSION,
            store: new SqliteDataStoreImplementation(
                validationDatabase,
                expectedWorkspaceId,
                expectedRevision,
                true,
            ),
        });
    }

    let activeDatabase: DatabaseSync;
    try {
        activeDatabase = openDatabase(path, false);
    } catch (error) {
        const disposition = classifySqliteFailure(error, 'pre-commit');
        if (disposition.kind === 'read-only') {
            return Object.freeze({
                kind: 'read-only' as const,
                sqliteVersion: SQLITE_VERSION,
                store: new SqliteDataStoreImplementation(
                    validationDatabase,
                    expectedWorkspaceId,
                    expectedRevision,
                    true,
                ),
            });
        }
        closeBestEffort(validationDatabase);
        return recoveryResult(unreadableOpenProblem(error));
    }

    try {
        const identity = readDatabaseIdentity(activeDatabase);
        if (identity.applicationId !== COURSEFLOW_APPLICATION_ID
            || identity.schemaLevel !== CURRENT_SCHEMA_LEVEL) {
            closeBestEffort(activeDatabase);
            closeBestEffort(validationDatabase);
            return recoveryResult(integrityProblem('schema-mismatch'));
        }
        const facts = validateSchemaLevel10(activeDatabase);
        if (facts.workspaceId !== expectedWorkspaceId || facts.revision !== expectedRevision) {
            closeBestEffort(activeDatabase);
            closeBestEffort(validationDatabase);
            return recoveryResult(integrityProblem('schema-mismatch'));
        }
        closeBestEffort(validationDatabase);
        return Object.freeze({
            kind: 'ready' as const,
            sqliteVersion: SQLITE_VERSION,
            store: new SqliteDataStoreImplementation(activeDatabase, facts.workspaceId, facts.revision),
        });
    } catch (error) {
        closeBestEffort(activeDatabase);
        closeBestEffort(validationDatabase);
        return recoveryResult(validationProblem(error));
    }
}

export async function openWorkspaceDataWithMigrations(
    dataSlotsRoot: string,
    options: OpenWorkspaceDataOptions = {},
): Promise<DataOpenResult> {
    const opened = openWorkspaceData(dataSlotsRoot, options);
    if (opened.kind !== 'recovery'
        || opened.problem.code !== 'integrity'
        || opened.problem.details.reason !== 'schema-mismatch') {
        return opened;
    }

    const path = databasePath(dataSlotsRoot);
    let source: DatabaseSync | undefined;
    try {
        source = openDatabase(path, true);
        const identity = readDatabaseIdentity(source);
        if (identity.applicationId !== COURSEFLOW_APPLICATION_ID
            || (identity.schemaLevel !== 1
                && identity.schemaLevel !== 2
                && identity.schemaLevel !== 3
                && identity.schemaLevel !== 4
                && identity.schemaLevel !== 5
                && identity.schemaLevel !== 6
                && identity.schemaLevel !== 7
                && identity.schemaLevel !== 8
                && identity.schemaLevel !== 9)) {
            closeBestEffort(source);
            return opened;
        }
        if (identity.schemaLevel === 1) {
            validateSchemaLevel1(source);
        }
        else if (identity.schemaLevel === 2) {
            validateSchemaLevel2(source);
        }
        else if (identity.schemaLevel === 3) {
            validateSchemaLevel3(source);
        }
        else if (identity.schemaLevel === 4) {
            validateSchemaLevel4(source);
        }
        else if (identity.schemaLevel === 5) {
            validateSchemaLevel5(source);
        }
        else if (identity.schemaLevel === 6) {
            validateSchemaLevel6(source);
        }
        else if (identity.schemaLevel === 7) {
            validateSchemaLevel7(source);
        }
        else if (identity.schemaLevel === 8) {
            validateSchemaLevel8(source);
        }
        else {
            validateSchemaLevel9(source);
        }
        if (options.readOnly) {
            closeBestEffort(source);
            return recoveryResult(incompatibleVersionProblem(identity.schemaLevel));
        }
        const safetyDirectory = join(
            dataSlotsRoot,
            `migration-safety-level-${identity.schemaLevel}-${randomUUID()}`,
        );
        mkdirSync(safetyDirectory);
        const safetyPath = join(safetyDirectory, DATABASE_FILE_NAME);
        await backup(source, safetyPath);
        const safetyDatabase = openDatabase(safetyPath, true);
        try {
            if (identity.schemaLevel === 1) {
                validateSchemaLevel1(safetyDatabase);
            }
            else if (identity.schemaLevel === 2) {
                validateSchemaLevel2(safetyDatabase);
            }
            else if (identity.schemaLevel === 3) {
                validateSchemaLevel3(safetyDatabase);
            }
            else if (identity.schemaLevel === 4) {
                validateSchemaLevel4(safetyDatabase);
            }
            else if (identity.schemaLevel === 5) {
                validateSchemaLevel5(safetyDatabase);
            }
            else if (identity.schemaLevel === 6) {
                validateSchemaLevel6(safetyDatabase);
            }
            else if (identity.schemaLevel === 7) {
                validateSchemaLevel7(safetyDatabase);
            }
            else if (identity.schemaLevel === 8) {
                validateSchemaLevel8(safetyDatabase);
            }
            else {
                validateSchemaLevel9(safetyDatabase);
            }
        }
        finally {
            safetyDatabase.close();
        }
        options.migrationFailpoint?.('migration.after-safety-copy');
        source.close();
        source = undefined;

        const maintenance = openDatabase(path, false);
        try {
            maintenance.exec('PRAGMA foreign_keys = OFF');
            const foreignKeys = maintenance.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
            if (foreignKeys.foreign_keys !== 0) {
                throw new Error('Migration could not disable foreign keys');
            }

            let schemaLevel = identity.schemaLevel;
            while (schemaLevel < CURRENT_SCHEMA_LEVEL) {
                maintenance.exec('BEGIN IMMEDIATE');
                try {
                    if (schemaLevel === 1) {
                        validateSchemaLevel1(maintenance);
                        migrateLevel1To2(maintenance);
                        validateSchemaLevel2(maintenance);
                    }
                    else if (schemaLevel === 2) {
                        validateSchemaLevel2(maintenance);
                        migrateLevel2To3(maintenance);
                        validateSchemaLevel3(maintenance);
                    }
                    else if (schemaLevel === 3) {
                        validateSchemaLevel3(maintenance);
                        migrateLevel3To4(maintenance);
                        validateSchemaLevel4(maintenance);
                    }
                    else if (schemaLevel === 4) {
                        validateSchemaLevel4(maintenance);
                        migrateLevel4To5(maintenance);
                        validateSchemaLevel5(maintenance);
                    }
                    else if (schemaLevel === 5) {
                        validateSchemaLevel5(maintenance);
                        migrateLevel5To6(maintenance);
                        validateSchemaLevel6(maintenance);
                    }
                    else if (schemaLevel === 6) {
                        validateSchemaLevel6(maintenance);
                        migrateLevel6To7(maintenance);
                        validateSchemaLevel7(maintenance);
                    }
                    else if (schemaLevel === 7) {
                        validateSchemaLevel7(maintenance);
                        migrateLevel7To8(maintenance);
                        validateSchemaLevel8(maintenance);
                    }
                    else if (schemaLevel === 8) {
                        validateSchemaLevel8(maintenance);
                        migrateLevel8To9(maintenance);
                        validateSchemaLevel9(maintenance);
                    }
                    else {
                        validateSchemaLevel9(maintenance);
                        migrateLevel9To10(maintenance);
                        validateSchemaLevel10(maintenance);
                    }
                    if ((maintenance.prepare('PRAGMA foreign_key_check').all() as unknown[]).length !== 0) {
                        throw new SchemaValidationError('database-corrupt');
                    }
                    options.migrationFailpoint?.('migration.before-level-commit');
                    maintenance.exec('COMMIT');
                    schemaLevel += 1;
                }
                catch (error) {
                    if (maintenance.isTransaction) {
                        maintenance.exec('ROLLBACK');
                    }
                    throw error;
                }
            }

            maintenance.exec('PRAGMA foreign_keys = ON');
            const enabledForeignKeys = maintenance.prepare('PRAGMA foreign_keys').get() as {
                foreign_keys: number;
            };
            if (enabledForeignKeys.foreign_keys !== 1) {
                throw new Error('Migration could not restore foreign keys');
            }
            validateSchemaLevel10(maintenance);
        }
        finally {
            closeBestEffort(maintenance);
        }
    }
    catch (error) {
        closeBestEffort(source);
        return recoveryResult(validationProblem(error));
    }

    return openWorkspaceData(dataSlotsRoot);
}
