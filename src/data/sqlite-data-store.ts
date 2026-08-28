/**
 * @file Implements the transactional SQLite owner for Workspace facts and receipts.
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {basename, isAbsolute, join} from 'node:path';
import { backup, DatabaseSync, type DatabaseSyncOptions } from 'node:sqlite';
import { canonicalJson } from '../shared/canonical-json';
import { commitSynchronously } from './store/commits/dispatch';
import { writeSetupDraftSynchronously } from './store/commits/setup';
import { readActiveHolidayRanges } from './store/conflict-reads';
import { currentVersions, insertRestoreCommandReceipt, readReceiptOutcome } from './store/context';
import type { StoreContext } from './store/context';
import { DATABASE_FILE_NAME, SQLITE_VERSION, activeDirectory, classifySqliteFailure, closeBestEffort, databasePath, decimalFromCoefficient, decimalToCoefficient, fireCommitFailpoint, hasSchemaObjects, normalizeBackupDatabaseCopy, openDatabase, readDatabaseIdentity, readRestoreImpactCounts, readRestoreSourceBackup, throwFailpoint, validateSupportedRestoreSchema } from './store/database';
import { isChangeMeetingOccurrenceCommand, isConfigureBackupDestinationCommand, isCourseWithMeetingCommand, isCreateCourseCommand, isCreateMeetingSeriesCommand, isCurrentChangeMeetingOccurrenceCommand, isCurrentCourseWithMeetingCommand, isHolidayRangeCommand, isMeetingOccurrenceMutationCommand, isTaskCommand, isTaskOccurrenceRuleMutationCommand, isTaskOccurrenceStateMutationCommand, isTermMutationCommand } from './store/guards';
import type { CurrentVersions, MeetingOccurrenceMutationCommand, TaskOccurrenceRuleMutationCommand, TaskOccurrenceStateMutationCommand, TaskSeriesMutationCommand, TermMutationCommand, WorkspaceDataCommand } from './store/guards';
import { committedOutcome, committedPairOutcome, conflictResult, databaseUnreadableProblem, decisionRequiredResult, freezeEmptyTuple, freezeTuple, holidayRangeConflictResult, incompatibleVersionProblem, integrityProblem, meetingOverlapDecisionRequiredResult, meetingSeriesConflictResult, migrationSafetyUnavailableProblem, permissionCommitResult, permissionProblem, planConflictResult, protectionConflictResult, recoveryResult, setupDraftConflictResult, setupDraftPermissionResult, setupDraftWriterBusyResult, successfulCommit, taskSeriesConflictResult, unreadableOpenProblem, validationProblem, writerBusyResult } from './store/results';
import { BACKUP_PHASE_SUCCESSORS, backupCleanupOperationFromRow, backupOperationFromRow, requireRestoreCompletionReceiptInput, restoreCompletionReceiptFromRow, restoreSessionFromRow } from './store/rows';
import type { BackupCleanupOperationRow, BackupOperationRow, RestoreCompletionReceiptRow, RestoreSessionRow } from './store/rows';
import { COMMIT_QUEUE_CAPACITY, CommittedCommandOutcomeUnknownError, SQLITE_INTEGER_MAX, SetupDraftCheckpointOutcomeUnknownError } from './store/types';
import type { BackupCleanupOperation, BackupConfigurationForProtection, BackupDatabaseFacts, BackupOperation, BackupOperationPhase, CommandReceiptOutcome, CommitOptions, DataCommitResult, DataOpenProblem, DurableFollowUp, InitializeWorkspaceDataOptions, OpenWorkspaceDataOptions, PreparedRestoreDatabaseFacts, ReadSnapshotOptions, ReceiptEffect, RestoreActivationCloseFailpoint, RestoreCompletionReceipt, RestoreCompletionReceiptInput, RestoreDataSlotFacts, RestoreDatabaseFacts, SetupDraftCheckpointWriteResult, SetupDraftWork, StoreWriteWork, StoredBackupDestination, StoredRestoreCommandReceipt, StoredRestoreSession, SuccessfulBackupSnapshot, WorkspaceDataStatus, WorkspaceSetupSnapshot } from './store/types';

import {
    constants as fsConstants,
    copyFileSync,
    existsSync,
    lstatSync,
    mkdirSync,
    renameSync,
    rmSync,
} from 'node:fs';

import {
    normalizeCancelMeetingOccurrenceCommand,
    normalizeAcceptedChangeMeetingOccurrenceCommand,
    normalizeMeetingOccurrenceWindow,
    normalizeMeetingOccurrenceImpactDraft,
    normalizeCreateCourseCommand,
    normalizeCreateMeetingSeriesCommand,
    normalizeAcceptedCreateCourseWithMeetingCommand,
    type AcceptedCreateCourseWithMeetingCommand,
    type AcceptedChangeMeetingOccurrenceCommand,
    type CancelMeetingOccurrenceCommand,
    type ChangeMeetingOccurrenceCommand,
    type CreateCourseCommand,
    type CreateCourseWithMeetingCommand,
    type CreateMeetingSeriesCommand,
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
    MAX_MEETING_OCCURRENCE_WINDOW_DAYS,
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
import {
    isCanonicalUnsignedSqliteInteger,
    isCanonicalUuid,
    normalizeRecordSetupDecisionCommand,
    type RecordSetupDecisionCommand,
} from '../shared/workspace-data-contract';
import {
    BACKUP_REPOSITORY_SCHEMA,
    normalizeAcceptedConfigureBackupDestinationCommand,
    type AcceptedConfigureBackupDestinationCommand,
    type DataProtectionProjection,
} from '../shared/workspace-protection-contract';
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
    MAX_SETUP_DRAFT_PAYLOAD_BYTES,
    normalizeCreateTermCommand,
    normalizeReconcileWorkspaceLifecycleCommand,
    normalizeRestoreTermAsCurrentCommand,
    normalizeUpdateTermEndDateCommand,
    type CreateTermCommand,
    type ReconcileWorkspaceLifecycleCommand,
    type RestoreTermAsCurrentCommand,
    type SetupDraftCheckpoint,
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
    digestConfigureBackupDestination,
    digestCreateCourse,
    digestCreateCourseWithMeeting,
    digestCreateMeetingSeries,
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
    createSchemaLevel16,
    migrateLevel1To2,
    migrateLevel2To3,
    migrateLevel3To4,
    migrateLevel4To5,
    migrateLevel5To6,
    migrateLevel6To7,
    migrateLevel7To8,
    migrateLevel8To9,
    migrateLevel9To10,
    migrateLevel10To11,
    migrateLevel11To12,
    migrateLevel12To13,
    migrateLevel13To14,
    migrateLevel14To15,
    migrateLevel15To16,
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
    validateSchemaLevel11,
    validateSchemaLevel12,
    validateSchemaLevel13,
    validateSchemaLevel14,
    validateSchemaLevel15,
    validateSchemaLevel16,
    type SchemaFacts,
} from './schema';
import {
    ensureMigrationSafetyCopy,
    inspectMigrationSafetyCopy,
    type MigrationSafetyCopyBuildBindingV1,
    type MigrationSafetyCopyFailpoint,
} from './migration-safety-copy';
export {
    CommittedCommandOutcomeUnknownError,
    SetupDraftCheckpointOutcomeUnknownError,
    type InitializeFailpoint,
    type InitializeWorkspaceDataOptions,
    type OpenWorkspaceDataOptions,
    type RestoreActivationCloseFailpoint,
    type RestoreDataSlotFacts,
    type MigrationFailpoint,
    type DataOpenProblem,
    type WorkspaceDataStatus,
    type WorkspaceSetupSnapshot,
    type ReadSnapshotOptions,
    type CommitFailpoint,
    type CommitOptions,
    type StoredBackupDestination,
    type CommandReceiptOutcome,
    type DurableFollowUp,
    type BackupOperationPhase,
    type BackupOperation,
    type SuccessfulBackupSnapshot,
    type RestoreDatabaseFacts,
    type PreparedRestoreDatabaseFacts,
    type StoredRestoreSession,
    type StoredRestoreCommandReceipt,
    type RestoreCompletionReceiptInput,
    type RestoreCompletionReceipt,
    type BackupCleanupOperation,
    type BackupDatabaseFacts,
    type BackupConfigurationForProtection,
    type DataCommitResult,
    type SetupDraftCheckpointWriteResult,
} from './store/types';
export {
    workspaceDataRuntimeVersion,
    classifySqliteFailure,
    type SqliteFailureDisposition,
} from './store/database';

export {
    consumeMigrationSafetyCopyAfterRollback,
    deleteMigrationSafetyCopy,
    inspectMigrationSafetyCopy,
    migrationSafetyCopyDeleteConfirmationToken,
    stageMigrationSafetyCopyForRollback,
    type ConsumeMigrationSafetyCopyOptions,
    type DeleteMigrationSafetyCopyOptions,
    type MigrationSafetyCopyMetadataV1,
    type MigrationSafetyCopyStatus,
    type MigrationRollbackArtifactV1,
    type MigrationRollbackTargetV1,
} from './migration-safety-copy';
import {
    firstTaskWeeklyAnchor,
    firstWeeklyLogicalAnchor,
    candidateLogicalAnchors,
    hasOccurrenceOutsideRequestedWindow,
    isActiveLogicalAnchor,
    lastTaskWeeklyAnchor,
    logicalAnchorBelongsToSegment,
    occurrenceDate,
    planOccurrenceWindows,
    validateMeetingSegmentSequence,
} from '../plan/anchors';
import {
    addClampedLocalDateDays,
    addLocalDateDays,
    localDateMilliseconds,
} from '../plan/local-date';
import {
    expandConflictMeetingOccurrences,
    meetingLocation,
    meetingTypeName,
} from '../plan/meeting-occurrences';
import type {
    ConflictMeetingOccurrence,
    StoredConflictMeetingOverride,
    StoredConflictMeetingSegment,
    StoredHolidayRange,
    StoredMeetingOverride,
    StoredMeetingSegment,
} from '../plan/meeting-occurrences';
import {
    meetingOverlapWarningKey,
    meetingOverlapWarnings,
    meetingScheduleOverlapWarnings,
} from '../plan/meeting-overlap';
import {
    meetingOccurrenceConfirmationToken,
    taskOccurrenceConfirmationToken,
} from '../plan/confirmation-tokens';
import {
    taskDeadlineColumns,
    taskDeadlineProjection,
    taskLogicalAnchors,
    taskOccurrenceStateProjection,
    taskOverrideReplacement,
    taskSchedule,
    taskScheduleColumns,
    taskScheduleProjection,
    taskSegmentForAnchor,
    taskSegmentOccurrenceDeadline,
} from '../plan/task-schedule';
import type {
    StoredTaskOccurrenceOverride,
    StoredTaskOccurrenceState,
    StoredTaskSchedule,
    StoredTaskSegment,
} from '../plan/task-schedule';









export type DataOpenResult =
    | Readonly<{ kind: 'absent'; sqliteVersion: string }>
    | Readonly<{ kind: 'ready'; sqliteVersion: string; store: SqliteDataStore }>
    | Readonly<{ kind: 'read-only'; sqliteVersion: string; store: SqliteDataStore }>
    | Readonly<{ kind: 'recovery'; sqliteVersion: string; problem: DataOpenProblem }>;





















































































































































class SqliteDataStoreImplementation {
    private accepting = true;
    private closed = false;
    private closePromise: Promise<void> | undefined;
    private finishClose: (() => void) | undefined;
    private failClose: ((error: unknown) => void) | undefined;
    private readonly queue: StoreWriteWork[] = [];
    private postCommitHint: (() => void) | undefined;
    private revision: bigint;
    private running = false;
    private terminalError: Error | undefined;
    private readonly storeContext: StoreContext;

    public constructor(
        private readonly database: DatabaseSync,
        private readonly workspaceId: string,
        revision: bigint,
        private readOnly = false,
    ) {
        this.revision = revision;
        this.storeContext = Object.freeze({
            database,
            workspaceId,
            revision: () => this.revision,
            setRevision: (next: bigint) => { this.revision = next; },
            isReadOnly: () => this.readOnly,
            markReadOnly: () => { this.readOnly = true; },
            terminalError: () => this.terminalError,
            enterTerminalState: (error?: Error) => error === undefined ? this.enterTerminalState() : this.enterTerminalState(error),
            rollbackOrRequireReopen: () => this.rollbackOrRequireReopen(),
        });
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

    /**
     * Installs the lossy PostCommit wake hint used by the Workspace backup coordinator.
     * @param {(() => void) | null} hint - Current process callback, or null to detach it.
     * @return {void}
     */
    public setPostCommitHint(hint: (() => void) | null): void {
        this.requireOpen();
        this.postCommitHint = hint ?? undefined;
    }

    /**
     * Drains the synchronous owner boundary and proves WAL state before an activation close.
     * @param {(point: RestoreActivationCloseFailpoint) => void} failpoint - Phase failure injection.
     * @return {void}
     */
    public prepareForRestoreActivation(
        failpoint?: (point: RestoreActivationCloseFailpoint) => void,
    ): void {
        this.requireBackupMutationAllowed();
        if (this.running || this.queue.length !== 0 || this.database.isTransaction) {
            throw new Error('Restore activation cannot drain DATA');
        }
        this.postCommitHint = undefined;
        failpoint?.('activation-close.before-wal-checkpoint');
        const checkpoint = this.database.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as {
            busy: number;
            log: number;
            checkpointed: number;
        };
        if (checkpoint.busy !== 0 || checkpoint.log !== checkpoint.checkpointed) {
            throw new Error('Restore activation WAL checkpoint failed');
        }
        failpoint?.('activation-close.after-wal-checkpoint');
    }

    public readSetupProjection(options: ReadSnapshotOptions = {}): SetupProjection {
        this.requireOpen();
        try {
            this.database.exec('BEGIN');
            const state = this.database.prepare(`
                SELECT
                    workspace_state.revision,
                    plan_state.current_term_id,
                    plan_state.plan_entity_version,
                    setup_state.ever_reached_minimum,
                    setup_draft_checkpoint.checkpoint_version,
                    setup_draft_checkpoint.schema_version,
                    setup_draft_checkpoint.updated_at,
                    setup_draft_checkpoint.opaque_payload
                FROM workspace_state
                JOIN plan_state ON plan_state.singleton = workspace_state.singleton
                JOIN setup_state ON setup_state.singleton = workspace_state.singleton
                JOIN setup_draft_checkpoint
                    ON setup_draft_checkpoint.singleton = workspace_state.singleton
                WHERE workspace_state.singleton = 1
            `);
            state.setReadBigInts(true);
            const stateRow = state.get() as {
                revision: bigint;
                current_term_id: string | null;
                plan_entity_version: bigint;
                ever_reached_minimum: bigint;
                checkpoint_version: bigint;
                schema_version: bigint | null;
                updated_at: string | null;
                opaque_payload: string | null;
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
                WHERE meeting_series.retired = 0
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

            const currentTermCourses = currentTerm === null
                ? []
                : courses.filter(course => course.termId === currentTerm.termId && !course.archived);
            const hasCurrentTerm = currentTerm !== null;
            const hasCurrentTermCourse = currentTermCourses.length > 0;
            const hasMeetingOrTask = currentTermCourses.some(course => course.meetings.length > 0
                || tasks.some(task => task.courseId === course.courseId));
            const minimum = Object.freeze({
                hasCurrentTerm,
                hasCurrentTermCourse,
                hasMeetingOrTask,
                isSatisfied: hasCurrentTerm && hasCurrentTermCourse && hasMeetingOrTask,
            });
            const draftCheckpoint = stateRow.schema_version === null
                ? null
                : Object.freeze({
                    draftId: 'first-setup' as const,
                    kind: 'first-setup' as const,
                    scope: 'setup-step' as const,
                    schemaVersion: Number(stateRow.schema_version) as SetupDraftCheckpoint['schemaVersion'],
                    updatedAt: stateRow.updated_at!,
                    opaquePayload: stateRow.opaque_payload!,
                });

            return Object.freeze({
                workspaceRevision: stateRow.revision.toString(),
                planEntityVersion: stateRow.plan_entity_version.toString(),
                minimum,
                everReachedMinimum: stateRow.ever_reached_minimum === 1n,
                defaultRoute: stateRow.ever_reached_minimum === 1n ? 'today' : 'setup',
                draftCheckpointVersion: stateRow.checkpoint_version.toString(),
                draftCheckpoint,
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
            const requestedWindows = planOccurrenceWindows(term.startDate, term.endDate);

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
            const seenTaskOccurrences = new Set<string>();
            for (const row of taskSeriesRows) {
                for (const requestedWindow of requestedWindows) {
                    const detail = this.readTaskSeriesDetail(row.task_series_id, requestedWindow);
                    for (const occurrence of detail.occurrences) {
                        const identity = `${occurrence.occurrenceId.taskSeriesId}\u0000`
                            + occurrence.occurrenceId.originalLogicalAnchor;
                        if (!seenTaskOccurrences.has(identity)) {
                            seenTaskOccurrences.add(identity);
                            taskSources.push(Object.freeze({
                                courseId: row.course_id,
                                courseCode: row.code,
                                occurrence,
                            }));
                        }
                    }
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
            const seenMeetingOccurrences = new Set<string>();
            for (const row of meetingSeriesRows) {
                for (const requestedWindow of requestedWindows) {
                    const detail = this.readMeetingSeriesDetail(row.meeting_series_id, requestedWindow);
                    for (const occurrence of detail.occurrences) {
                        const identity = `${occurrence.occurrenceId.meetingSeriesId}\u0000`
                            + occurrence.occurrenceId.originalLogicalAnchor;
                        if (!seenMeetingOccurrences.has(identity)) {
                            seenMeetingOccurrences.add(identity);
                            meetingSources.push(Object.freeze({
                                courseId: row.course_id,
                                courseCode: row.code,
                                occurrence,
                            }));
                        }
                    }
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
                const holidayRanges = readActiveHolidayRanges(this.database, series.term_id);
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
            const versions = currentVersions(this.database);
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
                    ? readActiveHolidayRanges(this.database, series.term_id)
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
            const holidayRanges = readActiveHolidayRanges(this.database, series.term_id);

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
            const versions = currentVersions(this.database);
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
            case 'protect.configure-backup-destination':
                command = normalizeAcceptedConfigureBackupDestinationCommand(candidate);
                break;
            case 'plan.create-term':
                command = normalizeCreateTermCommand(candidate);
                break;
            case 'plan.create-course-with-first-meeting':
                command = normalizeAcceptedCreateCourseWithMeetingCommand(candidate);
                break;
            case 'plan.create-course':
                command = normalizeCreateCourseCommand(candidate);
                break;
            case 'plan.create-meeting-series':
                command = normalizeCreateMeetingSeriesCommand(candidate);
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
            this.queue.push({ kind: 'commit', command, options, resolve, reject });
        });
        if (!this.running) {
            this.running = true;
            queueMicrotask(() => this.drain());
        }
        return pending;
    }

    /**
     * Saves the bounded Shell-owned first-setup draft without changing formal Workspace facts.
     * @param {object} input - Versioned opaque JSON draft envelope.
     * @param {string} updatedAt - Workspace-clock Instant for the checkpoint.
     * @param {CommitOptions} options - Transaction failpoint controls used by tests.
     * @return {Promise<SetupDraftCheckpointWriteResult>} New draft version or unchanged problem.
     */
    public saveSetupDraftCheckpoint(
        input: Readonly<{
            expectedVersion: string;
            schemaVersion: 1;
            opaquePayload: string;
        }>,
        updatedAt: string,
        options: CommitOptions = {},
    ): Promise<SetupDraftCheckpointWriteResult> {
        if (!isCanonicalUnsignedSqliteInteger(input.expectedVersion)
            || input.schemaVersion !== 1
            || !isCanonicalInstant(updatedAt)
            || Buffer.byteLength(input.opaquePayload, 'utf8') > MAX_SETUP_DRAFT_PAYLOAD_BYTES) {
            throw new TypeError('Setup draft checkpoint is invalid or incompatible');
        }
        try {
            JSON.parse(input.opaquePayload);
        }
        catch {
            throw new TypeError('Setup draft checkpoint payload is not JSON');
        }
        return this.enqueueSetupDraftMutation({
            kind: 'save',
            expectedVersion: input.expectedVersion,
            schemaVersion: input.schemaVersion,
            updatedAt,
            opaquePayload: input.opaquePayload,
        }, options);
    }

    /**
     * Discards the first-setup draft while preserving its optimistic version stream.
     * @param {string} expectedVersion - Last observed draft-stream version.
     * @param {CommitOptions} options - Transaction failpoint controls used by tests.
     * @return {Promise<SetupDraftCheckpointWriteResult>} New draft version or unchanged problem.
     */
    public discardSetupDraftCheckpoint(
        expectedVersion: string,
        options: CommitOptions = {},
    ): Promise<SetupDraftCheckpointWriteResult> {
        if (!isCanonicalUnsignedSqliteInteger(expectedVersion)) {
            throw new TypeError('Setup draft checkpoint version is invalid');
        }
        return this.enqueueSetupDraftMutation({ kind: 'discard', expectedVersion }, options);
    }

    /**
     * Serializes setup-draft mutations with formal Workspace writes on the sole SQLite connection.
     * @param {SetupDraftWork['mutation']} mutation - Validated save or discard mutation.
     * @param {CommitOptions} options - Transaction failpoint controls used by tests.
     * @return {Promise<SetupDraftCheckpointWriteResult>} Queued write result.
     */
    private enqueueSetupDraftMutation(
        mutation: SetupDraftWork['mutation'],
        options: CommitOptions,
    ): Promise<SetupDraftCheckpointWriteResult> {
        if (this.terminalError) {
            return Promise.reject(this.terminalError);
        }
        if (this.readOnly) {
            try {
                this.requireOpen();
                return Promise.resolve(setupDraftPermissionResult(this.revision));
            }
            catch (error) {
                return Promise.reject(error);
            }
        }
        if (!this.accepting) {
            return Promise.reject(new Error('Workspace data store is closing'));
        }
        if (this.queue.length >= COMMIT_QUEUE_CAPACITY) {
            return Promise.resolve(setupDraftWriterBusyResult(this.revision));
        }

        const pending = new Promise<SetupDraftCheckpointWriteResult>((resolve, reject) => {
            this.queue.push({ kind: 'setup-draft', mutation, options, resolve, reject });
        });
        if (!this.running) {
            this.running = true;
            queueMicrotask(() => this.drain());
        }
        return pending;
    }

    public receipt(commandId: string): CommandReceiptOutcome | null {
        this.requireOpen();
        return readReceiptOutcome(this.database, commandId);
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
        return this.readProtectionWatermarks().neededThrough;
    }

    /**
     * Reads both durable backup watermarks from their singleton DATA owner.
     * @return {{neededThrough: string; succeededThrough: string}} Current watermark pair.
     */
    public readProtectionWatermarks(): Readonly<{
        neededThrough: string;
        succeededThrough: string;
    }> {
        this.requireOpen();
        const statement = this.database.prepare(`
            SELECT backup_needed_through, backup_succeeded_through
            FROM protection_watermarks
            WHERE singleton = 1
        `);
        statement.setReadBigInts(true);
        const row = statement.get() as {
            backup_needed_through: bigint;
            backup_succeeded_through: bigint;
        };
        return Object.freeze({
            neededThrough: row.backup_needed_through.toString(),
            succeededThrough: row.backup_succeeded_through.toString(),
        });
    }

    /**
     * Claims or resumes the one durable backup operation for the current merged watermark.
     * @param {object} input - Identities generated by the PROTECT coordinator for a new claim.
     * @return {BackupOperation | null} Resumable work, or null when DATA is already protected.
     */
    public claimBackupOperation(input: Readonly<{
        operationId: string;
        snapshotId: string;
        stagingDirectoryName: string;
        createdAt: string;
    }>): BackupOperation | null {
        this.requireBackupMutationAllowed();
        const expectedStagingName = new RegExp(`^\\.staging-${input.operationId}-[0-9a-f]{16}$`);
        if (!isCanonicalUuid(input.operationId)
            || !isCanonicalUuid(input.snapshotId)
            || !isCanonicalInstant(input.createdAt)
            || !expectedStagingName.test(input.stagingDirectoryName)) {
            throw new TypeError('Backup operation claim is invalid');
        }

        try {
            this.database.exec('BEGIN IMMEDIATE');
            const active = this.readBackupOperationRow(`phase <> 'succeeded'`);
            if (active) {
                this.database.exec('COMMIT');
                return backupOperationFromRow(active);
            }
            const watermarks = this.readProtectionWatermarksInsideTransaction();
            if (watermarks.backup_succeeded_through >= watermarks.backup_needed_through) {
                this.database.exec('COMMIT');
                return null;
            }
            const configuration = this.database.prepare(`
                SELECT backup_set_id
                FROM backup_configuration
                WHERE singleton = 1
            `).get() as {backup_set_id: string | null};
            if (configuration.backup_set_id === null) {
                this.database.exec('COMMIT');
                return null;
            }
            const sequenceStatement = this.database.prepare(`
                SELECT coalesce(max(backup_sequence), 0) + 1 AS next_sequence
                FROM backup_operations
                WHERE backup_set_id = ?
            `);
            sequenceStatement.setReadBigInts(true);
            const sequence = (sequenceStatement.get(configuration.backup_set_id) as {
                next_sequence: bigint;
            }).next_sequence;
            this.database.prepare(`
                INSERT INTO backup_operations (
                    operation_id,
                    backup_set_id,
                    backup_sequence,
                    snapshot_id,
                    target_revision,
                    actual_revision,
                    staging_directory_name,
                    created_at,
                    phase,
                    operation_version
                ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'queued', 0)
            `).run(
                input.operationId,
                configuration.backup_set_id,
                sequence,
                input.snapshotId,
                watermarks.backup_needed_through,
                input.stagingDirectoryName,
                input.createdAt,
            );
            const claimed = this.readBackupOperationRow('operation_id = ?', input.operationId);
            this.database.exec('COMMIT');
            return backupOperationFromRow(claimed!);
        }
        catch (error) {
            if (this.database.isTransaction) {
                this.database.exec('ROLLBACK');
            }
            throw error;
        }
    }

    /**
     * Reads the latest operation, including the most recently succeeded operation.
     * @return {BackupOperation | null} Latest durable operation.
     */
    public readBackupOperation(): BackupOperation | null {
        this.requireOpen();
        const row = this.readBackupOperationRow('1 = 1');
        return row ? backupOperationFromRow(row) : null;
    }

    /**
     * Reads the durable operation that owns one registered or in-progress snapshot identity.
     * @param {string} snapshotId - Canonical snapshot UUID.
     * @return {BackupOperation | null} Matching durable operation when registered.
     */
    public readBackupOperationForSnapshot(snapshotId: string): BackupOperation | null {
        this.requireOpen();
        if (!isCanonicalUuid(snapshotId)) {
            throw new TypeError('Snapshot identity is invalid');
        }
        const row = this.readBackupOperationRow('snapshot_id = ?', snapshotId);
        return row ? backupOperationFromRow(row) : null;
    }

    /**
     * Records the actual revision observed in the validated SQLite backup member.
     * @param {string} operationId - Claimed operation identity.
     * @param {string} actualRevision - Revision read from the checkpoint copy.
     * @return {BackupOperation} Updated durable operation.
     */
    public recordBackupCheckpoint(operationId: string, actualRevision: string): BackupOperation {
        this.requireBackupMutationAllowed();
        if (!isCanonicalUuid(operationId)
            || !isCanonicalUnsignedSqliteInteger(actualRevision)
            || actualRevision === '0') {
            throw new TypeError('Backup checkpoint facts are invalid');
        }
        return this.mutateBackupOperation(operationId, operation => {
            if (operation.phase === 'database-checkpoint'
                && operation.actual_revision === BigInt(actualRevision)) {
                return false;
            }
            if (operation.phase !== 'queued'
                || BigInt(actualRevision) < operation.target_revision) {
                throw new Error('Backup checkpoint does not match the claimed target');
            }
            this.database.prepare(`
                UPDATE backup_operations
                SET actual_revision = ?, phase = 'database-checkpoint',
                    operation_version = operation_version + 1
                WHERE operation_id = ?
            `).run(BigInt(actualRevision), operationId);
            return true;
        });
    }

    /**
     * Advances one validated filesystem phase without skipping protocol stages.
     * @param {string} operationId - Claimed operation identity.
     * @param {BackupOperationPhase} expectedPhase - Durable source phase.
     * @param {BackupOperationPhase} nextPhase - Required immediate successor.
     * @return {BackupOperation} Updated durable operation.
     */
    public advanceBackupOperation(
        operationId: string,
        expectedPhase: BackupOperationPhase,
        nextPhase: BackupOperationPhase,
    ): BackupOperation {
        this.requireBackupMutationAllowed();
        if (!isCanonicalUuid(operationId) || BACKUP_PHASE_SUCCESSORS[expectedPhase] !== nextPhase) {
            throw new TypeError('Backup phase transition is invalid');
        }
        return this.mutateBackupOperation(operationId, operation => {
            if (operation.phase === nextPhase) {
                return false;
            }
            if (operation.phase !== expectedPhase) {
                throw new Error('Backup phase transition is stale');
            }
            this.database.prepare(`
                UPDATE backup_operations
                SET phase = ?, operation_version = operation_version + 1
                WHERE operation_id = ?
            `).run(nextPhase, operationId);
            return true;
        });
    }

    /**
     * Registers an immutable published snapshot and completes covered follow-ups atomically.
     * @param {object} input - Final verified snapshot facts.
     * @return {BackupOperation} Idempotently succeeded operation.
     */
    public recordBackupSuccess(input: Readonly<{
        operationId: string;
        actualRevision: string;
        rootDigest: string;
        succeededAt: string;
    }>): BackupOperation {
        this.requireBackupMutationAllowed();
        if (!isCanonicalUuid(input.operationId)
            || !isCanonicalUnsignedSqliteInteger(input.actualRevision)
            || input.actualRevision === '0'
            || !/^[0-9a-f]{64}$/.test(input.rootDigest)
            || !isCanonicalInstant(input.succeededAt)) {
            throw new TypeError('Backup success facts are invalid');
        }
        try {
            this.database.exec('BEGIN IMMEDIATE');
            const operation = this.requireBackupOperationRow(input.operationId);
            if (operation.phase === 'succeeded') {
                const stored = this.readSuccessfulBackupSnapshot(input.operationId);
                if (stored.actualRevision !== input.actualRevision
                    || stored.rootDigest !== input.rootDigest
                    || stored.succeededAt !== input.succeededAt) {
                    throw new Error('Backup success replay does not match immutable facts');
                }
                this.database.exec('COMMIT');
                return backupOperationFromRow(operation);
            }
            if (operation.phase !== 'published-pending-record'
                || operation.actual_revision !== BigInt(input.actualRevision)) {
                throw new Error('Backup success is not ready to record');
            }
            const watermarks = this.readProtectionWatermarksInsideTransaction();
            if (operation.actual_revision > watermarks.backup_needed_through) {
                throw new Error('Backup success revision exceeds the durable watermark');
            }
            this.database.prepare(`
                INSERT INTO backup_snapshots (
                    snapshot_id,
                    operation_id,
                    backup_set_id,
                    backup_sequence,
                    actual_revision,
                    root_digest,
                    succeeded_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                operation.snapshot_id,
                operation.operation_id,
                operation.backup_set_id,
                operation.backup_sequence,
                operation.actual_revision,
                input.rootDigest,
                input.succeededAt,
            );
            this.database.prepare(`
                UPDATE protection_watermarks
                SET backup_succeeded_through = ?
                WHERE singleton = 1
            `).run(operation.actual_revision);
            this.database.prepare(`
                UPDATE durable_followups
                SET state = 'completed', follow_up_version = 1
                WHERE state = 'pending' AND prerequisite_revision <= ?
            `).run(operation.actual_revision);
            this.database.prepare(`
                UPDATE backup_operations
                SET phase = 'succeeded', operation_version = operation_version + 1
                WHERE operation_id = ?
            `).run(operation.operation_id);
            const succeeded = this.requireBackupOperationRow(operation.operation_id);
            this.database.exec('COMMIT');
            return backupOperationFromRow(succeeded);
        }
        catch (error) {
            if (this.database.isTransaction) {
                this.database.exec('ROLLBACK');
            }
            throw error;
        }
    }

    /**
     * Lists immutable success records in BackupSequence order.
     * @return {readonly SuccessfulBackupSnapshot[]} Registered snapshot facts.
     */
    public readSuccessfulBackupSnapshots(): readonly SuccessfulBackupSnapshot[] {
        this.requireOpen();
        const statement = this.database.prepare(`
            SELECT
                snapshot_id,
                backup_set_id,
                backup_sequence,
                actual_revision,
                root_digest,
                succeeded_at
            FROM backup_snapshots
            ORDER BY backup_sequence
        `);
        statement.setReadBigInts(true);
        const rows = statement.all() as Array<{
            snapshot_id: string;
            backup_set_id: string;
            backup_sequence: bigint;
            actual_revision: bigint;
            root_digest: string;
            succeeded_at: string;
        }>;
        return Object.freeze(rows.map(row => Object.freeze({
            snapshotId: row.snapshot_id,
            backupSetId: row.backup_set_id,
            backupSequence: row.backup_sequence.toString(),
            actualRevision: row.actual_revision.toString(),
            rootDigest: row.root_digest,
            succeededAt: row.succeeded_at,
        })));
    }

    /**
     * Claims one PROTECT-selected registration when two newer successes are still recorded.
     * @param {string} operationId - Fresh cleanup operation UUID.
     * @param {string} snapshotId - Freshly selected registered Snapshot UUID.
     * @return {BackupCleanupOperation | null} Resumable cleanup, or null when ineligible.
     */
    public claimBackupCleanupOperation(
        operationId: string,
        snapshotId: string,
    ): BackupCleanupOperation | null {
        this.requireBackupMutationAllowed();
        if (!isCanonicalUuid(operationId) || !isCanonicalUuid(snapshotId)) {
            throw new TypeError('Backup cleanup identity is invalid');
        }
        try {
            this.database.exec('BEGIN IMMEDIATE');
            const active = this.readBackupCleanupOperationRow();
            if (active) {
                this.database.exec('COMMIT');
                return backupCleanupOperationFromRow(active);
            }
            const candidateStatement = this.database.prepare(`
                SELECT
                    snapshot.backup_set_id,
                    snapshot.snapshot_id,
                    snapshot.backup_sequence,
                    snapshot.root_digest
                FROM backup_snapshots AS snapshot
                JOIN backup_configuration AS configuration ON configuration.singleton = 1
                WHERE snapshot.backup_set_id = configuration.backup_set_id
                    AND snapshot.snapshot_id = ?
                    AND (
                        SELECT count(*)
                        FROM backup_snapshots AS newer
                        WHERE newer.backup_set_id = snapshot.backup_set_id
                            AND newer.backup_sequence > snapshot.backup_sequence
                    ) >= 2
                LIMIT 1
            `);
            candidateStatement.setReadBigInts(true);
            const candidate = candidateStatement.get(snapshotId) as {
                backup_set_id: string;
                snapshot_id: string;
                backup_sequence: bigint;
                root_digest: string;
            } | undefined;
            if (!candidate) {
                this.database.exec('COMMIT');
                return null;
            }
            this.database.prepare(`
                INSERT INTO backup_cleanup_operations (
                    singleton,
                    operation_id,
                    backup_set_id,
                    snapshot_id,
                    backup_sequence,
                    root_digest,
                    snapshot_directory_name,
                    quarantine_directory_name,
                    phase,
                    operation_version
                ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 'planned', 0)
            `).run(
                operationId,
                candidate.backup_set_id,
                candidate.snapshot_id,
                candidate.backup_sequence,
                candidate.root_digest,
                `snapshot-${candidate.snapshot_id}`,
                `.quarantine-${operationId}-${candidate.snapshot_id}`,
            );
            const claimed = this.readBackupCleanupOperationRow();
            this.database.exec('COMMIT');
            return backupCleanupOperationFromRow(claimed!);
        }
        catch (error) {
            if (this.database.isTransaction) {
                this.database.exec('ROLLBACK');
            }
            throw error;
        }
    }

    /**
     * Reads the one durable retention cleanup journal entry.
     * @return {BackupCleanupOperation | null} Active cleanup when one exists.
     */
    public readBackupCleanupOperation(): BackupCleanupOperation | null {
        this.requireOpen();
        const row = this.readBackupCleanupOperationRow();
        return row ? backupCleanupOperationFromRow(row) : null;
    }

    /**
     * Releases a planned cleanup only after PROTECT proves no quarantine rename occurred.
     * @param {string} operationId - Persisted cleanup operation UUID.
     * @return {void}
     */
    public releasePlannedBackupCleanup(operationId: string): void {
        this.requireBackupMutationAllowed();
        if (!isCanonicalUuid(operationId)) {
            throw new TypeError('Backup cleanup operation identity is invalid');
        }
        try {
            this.database.exec('BEGIN IMMEDIATE');
            const cleanup = this.readBackupCleanupOperationRow();
            if (!cleanup) {
                this.database.exec('COMMIT');
                return;
            }
            if (cleanup.operation_id !== operationId || cleanup.phase !== 'planned') {
                throw new Error('Backup cleanup operation cannot be released');
            }
            this.database.prepare(`
                DELETE FROM backup_cleanup_operations
                WHERE singleton = 1 AND operation_id = ? AND phase = 'planned'
            `).run(operationId);
            this.database.exec('COMMIT');
        }
        catch (error) {
            if (this.database.isTransaction) {
                this.database.exec('ROLLBACK');
            }
            throw error;
        }
    }

    /**
     * Records that same-parent quarantine rename has completed.
     * @param {string} operationId - Persisted cleanup operation UUID.
     * @return {BackupCleanupOperation} Idempotently quarantined cleanup facts.
     */
    public markBackupCleanupQuarantined(operationId: string): BackupCleanupOperation {
        this.requireBackupMutationAllowed();
        if (!isCanonicalUuid(operationId)) {
            throw new TypeError('Backup cleanup operation identity is invalid');
        }
        try {
            this.database.exec('BEGIN IMMEDIATE');
            const cleanup = this.readBackupCleanupOperationRow();
            if (!cleanup || cleanup.operation_id !== operationId) {
                throw new Error('Backup cleanup operation does not exist');
            }
            if (cleanup.phase === 'planned') {
                this.database.prepare(`
                    UPDATE backup_cleanup_operations
                    SET phase = 'quarantined', operation_version = 1
                    WHERE singleton = 1
                `).run();
            }
            const updated = this.readBackupCleanupOperationRow();
            this.database.exec('COMMIT');
            return backupCleanupOperationFromRow(updated!);
        }
        catch (error) {
            if (this.database.isTransaction) {
                this.database.exec('ROLLBACK');
            }
            throw error;
        }
    }

    /**
     * Records the fully revalidated checkpoint that authorizes exact physical deletion.
     * @param {string} operationId - Persisted cleanup operation UUID.
     * @return {BackupCleanupOperation} Idempotently deletion-authorized cleanup facts.
     */
    public markBackupCleanupDeleting(operationId: string): BackupCleanupOperation {
        this.requireBackupMutationAllowed();
        if (!isCanonicalUuid(operationId)) {
            throw new TypeError('Backup cleanup operation identity is invalid');
        }
        try {
            this.database.exec('BEGIN IMMEDIATE');
            const cleanup = this.readBackupCleanupOperationRow();
            if (!cleanup || cleanup.operation_id !== operationId || cleanup.phase === 'planned') {
                throw new Error('Backup cleanup operation is not quarantined');
            }
            if (cleanup.phase === 'quarantined') {
                this.database.prepare(`
                    UPDATE backup_cleanup_operations
                    SET phase = 'deleting', operation_version = 2
                    WHERE singleton = 1
                `).run();
            }
            const updated = this.readBackupCleanupOperationRow();
            this.database.exec('COMMIT');
            return backupCleanupOperationFromRow(updated!);
        }
        catch (error) {
            if (this.database.isTransaction) {
                this.database.exec('ROLLBACK');
            }
            throw error;
        }
    }

    /**
     * Forgets one physically deleted quarantined snapshot and its succeeded operation atomically.
     * @param {string} operationId - Persisted cleanup operation UUID.
     * @return {void}
     */
    public completeBackupCleanup(operationId: string): void {
        this.requireBackupMutationAllowed();
        if (!isCanonicalUuid(operationId)) {
            throw new TypeError('Backup cleanup operation identity is invalid');
        }
        try {
            this.database.exec('BEGIN IMMEDIATE');
            const cleanup = this.readBackupCleanupOperationRow();
            if (!cleanup) {
                this.database.exec('COMMIT');
                return;
            }
            if (cleanup.operation_id !== operationId || cleanup.phase !== 'deleting') {
                throw new Error('Backup cleanup operation is not ready to complete');
            }
            const snapshotStatement = this.database.prepare(`
                SELECT snapshot.operation_id, count(newer.snapshot_id) AS newer_snapshot_count
                FROM backup_snapshots AS snapshot
                LEFT JOIN backup_snapshots AS newer
                    ON newer.backup_set_id = snapshot.backup_set_id
                    AND newer.backup_sequence > snapshot.backup_sequence
                WHERE snapshot.snapshot_id = ?
                    AND snapshot.backup_set_id = ?
                    AND snapshot.backup_sequence = ?
                    AND snapshot.root_digest = ?
                GROUP BY snapshot.operation_id
            `);
            snapshotStatement.setReadBigInts(true);
            const snapshot = snapshotStatement.get(
                cleanup.snapshot_id,
                cleanup.backup_set_id,
                cleanup.backup_sequence,
                cleanup.root_digest,
            ) as {operation_id: string; newer_snapshot_count: bigint} | undefined;
            if (!snapshot || snapshot.newer_snapshot_count < 2n) {
                throw new Error('Backup cleanup would violate retention');
            }
            this.database.prepare('DELETE FROM backup_snapshots WHERE snapshot_id = ?')
                .run(cleanup.snapshot_id);
            this.database.prepare('DELETE FROM backup_operations WHERE operation_id = ?')
                .run(snapshot.operation_id);
            this.database.prepare('DELETE FROM backup_cleanup_operations WHERE singleton = 1')
                .run();
            this.database.exec('COMMIT');
        }
        catch (error) {
            if (this.database.isTransaction) {
                this.database.exec('ROLLBACK');
            }
            throw error;
        }
    }

    /**
     * Requires a writable, nonterminal DATA connection for protection bookkeeping.
     * @return {void}
     */
    private requireBackupMutationAllowed(): void {
        this.requireOpen();
        if (this.readOnly) {
            throw new Error('Workspace data store is read-only');
        }
    }

    /**
     * Reads both protection watermarks inside the caller-owned DATA transaction.
     * @return {object} Authoritative needed and succeeded revisions.
     */
    private readProtectionWatermarksInsideTransaction(): {
        backup_needed_through: bigint;
        backup_succeeded_through: bigint;
    } {
        const statement = this.database.prepare(`
            SELECT backup_needed_through, backup_succeeded_through
            FROM protection_watermarks
            WHERE singleton = 1
        `);
        statement.setReadBigInts(true);
        return statement.get() as {
            backup_needed_through: bigint;
            backup_succeeded_through: bigint;
        };
    }

    /**
     * Reads the latest operation matching one internal fixed SQL predicate.
     * @param {string} predicate - DATA-owned SQL predicate fragment.
     * @param {...Array<string | bigint>} parameters - Bound predicate parameters.
     * @return {BackupOperationRow | undefined} Matching row when present.
     */
    private readBackupOperationRow(
        predicate: string,
        ...parameters: Array<string | bigint>
    ): BackupOperationRow | undefined {
        const statement = this.database.prepare(`
            SELECT
                operation_id,
                backup_set_id,
                backup_sequence,
                snapshot_id,
                target_revision,
                actual_revision,
                staging_directory_name,
                created_at,
                phase,
                operation_version
            FROM backup_operations
            WHERE ${predicate}
            ORDER BY backup_sequence DESC
            LIMIT 1
        `);
        statement.setReadBigInts(true);
        return statement.get(...parameters) as BackupOperationRow | undefined;
    }

    /**
     * Reads the singleton cleanup journal row inside or outside a caller-owned transaction.
     * @return {BackupCleanupOperationRow | undefined} Active cleanup storage row.
     */
    private readBackupCleanupOperationRow(): BackupCleanupOperationRow | undefined {
        const statement = this.database.prepare(`
            SELECT
                operation_id,
                backup_set_id,
                snapshot_id,
                backup_sequence,
                root_digest,
                snapshot_directory_name,
                quarantine_directory_name,
                phase,
                operation_version
            FROM backup_cleanup_operations
            WHERE singleton = 1
        `);
        statement.setReadBigInts(true);
        return statement.get() as BackupCleanupOperationRow | undefined;
    }

    /**
     * Requires one persisted operation identity.
     * @param {string} operationId - Canonical operation UUID.
     * @return {BackupOperationRow} Matching typed storage row.
     */
    private requireBackupOperationRow(operationId: string): BackupOperationRow {
        const operation = this.readBackupOperationRow('operation_id = ?', operationId);
        if (!operation) {
            throw new Error('Backup operation does not exist');
        }
        return operation;
    }

    /**
     * Applies one synchronous phase mutation inside an immediate transaction.
     * @param {string} operationId - Canonical operation UUID.
     * @param {function(BackupOperationRow): boolean} mutation - Validated row mutation.
     * @return {BackupOperation} Re-read immutable operation facts.
     */
    private mutateBackupOperation(
        operationId: string,
        mutation: (operation: BackupOperationRow) => boolean,
    ): BackupOperation {
        try {
            this.database.exec('BEGIN IMMEDIATE');
            const operation = this.requireBackupOperationRow(operationId);
            mutation(operation);
            const updated = this.requireBackupOperationRow(operationId);
            this.database.exec('COMMIT');
            return backupOperationFromRow(updated);
        }
        catch (error) {
            if (this.database.isTransaction) {
                this.database.exec('ROLLBACK');
            }
            throw error;
        }
    }

    /**
     * Reads one immutable success record for idempotent replay comparison.
     * @param {string} operationId - Canonical succeeded operation UUID.
     * @return {SuccessfulBackupSnapshot} Registered snapshot facts.
     */
    private readSuccessfulBackupSnapshot(operationId: string): SuccessfulBackupSnapshot {
        const statement = this.database.prepare(`
            SELECT
                snapshot_id,
                backup_set_id,
                backup_sequence,
                actual_revision,
                root_digest,
                succeeded_at
            FROM backup_snapshots
            WHERE operation_id = ?
        `);
        statement.setReadBigInts(true);
        const row = statement.get(operationId) as {
            snapshot_id: string;
            backup_set_id: string;
            backup_sequence: bigint;
            actual_revision: bigint;
            root_digest: string;
            succeeded_at: string;
        } | undefined;
        if (!row) {
            throw new Error('Succeeded backup operation has no snapshot record');
        }
        return Object.freeze({
            snapshotId: row.snapshot_id,
            backupSetId: row.backup_set_id,
            backupSequence: row.backup_sequence.toString(),
            actualRevision: row.actual_revision.toString(),
            rootDigest: row.root_digest,
            succeededAt: row.succeeded_at,
        });
    }

    /**
     * Reads the path-free PROTECT projection from one authoritative row.
     * @return {DataProtectionProjection} Legal unconfigured or configured state.
     */
    public readDataProtectionProjection(): DataProtectionProjection {
        this.requireOpen();
        const statement = this.database.prepare(`
            SELECT
                workspace_state.revision,
                backup_configuration.configuration_version,
                backup_configuration.backup_set_id,
                backup_configuration.repository_schema,
                backup_configuration.destination_display_name,
                protection_watermarks.backup_needed_through,
                protection_watermarks.backup_succeeded_through,
                backup_cleanup_operations.operation_id AS cleanup_operation_id,
                (
                    SELECT count(*)
                    FROM backup_snapshots
                    WHERE backup_snapshots.backup_set_id = backup_configuration.backup_set_id
                ) AS registered_snapshot_count
            FROM workspace_state
            JOIN backup_configuration
                ON backup_configuration.singleton = workspace_state.singleton
            JOIN protection_watermarks
                ON protection_watermarks.singleton = workspace_state.singleton
            LEFT JOIN backup_cleanup_operations
                ON backup_cleanup_operations.singleton = workspace_state.singleton
            WHERE workspace_state.singleton = 1
        `);
        statement.setReadBigInts(true);
        const row = statement.get() as {
            revision: bigint;
            configuration_version: bigint;
            backup_set_id: string | null;
            repository_schema: typeof BACKUP_REPOSITORY_SCHEMA | null;
            destination_display_name: string | null;
            backup_needed_through: bigint;
            backup_succeeded_through: bigint;
            cleanup_operation_id: string | null;
            registered_snapshot_count: bigint;
        };
        if (row.backup_set_id === null) {
            return Object.freeze({
                workspaceRevision: row.revision.toString(),
                protectionEntityVersion: row.configuration_version.toString(),
                configuration: Object.freeze({kind: 'unconfigured' as const}),
            });
        }
        const snapshots = this.readSuccessfulBackupSnapshots()
            .slice(-2)
            .reverse()
            .map(snapshot => Object.freeze({
                snapshotId: snapshot.snapshotId,
                backupSequence: snapshot.backupSequence,
                actualRevision: snapshot.actualRevision,
                succeededAt: snapshot.succeededAt,
                snapshotFormatVersion: '1' as const,
                integrity: 'verified' as const,
            }));
        const latest = snapshots[0];
        return Object.freeze({
            workspaceRevision: row.revision.toString(),
            protectionEntityVersion: row.configuration_version.toString(),
            configuration: Object.freeze({
                kind: 'configured' as const,
                backupSetId: row.backup_set_id,
                repositorySchema: row.repository_schema!,
                destinationDisplayName: row.destination_display_name!,
            }),
            backup: Object.freeze({
                state: row.backup_needed_through === row.backup_succeeded_through
                    ? 'current' as const
                    : 'pending' as const,
                neededThrough: row.backup_needed_through.toString(),
                succeededThrough: row.backup_succeeded_through.toString(),
                lastSuccess: latest
                    ? Object.freeze({
                        snapshotId: latest.snapshotId,
                        protectedThrough: latest.actualRevision,
                        succeededAt: latest.succeededAt,
                    })
                    : null,
                recentVerifiedSnapshots: Object.freeze(snapshots),
                restoreCandidates: Object.freeze([]),
                cleanup: row.cleanup_operation_id === null
                    && row.registered_snapshot_count <= 2n
                    ? 'idle' as const
                    : 'pending' as const,
            }),
        });
    }

    /**
     * Reads the path-bearing internal configuration used only by the PROTECT worker.
     * @return {BackupConfigurationForProtection | null} Current configured BackupSet facts.
     */
    public readBackupConfigurationForProtection(): BackupConfigurationForProtection | null {
        this.requireOpen();
        const row = this.database.prepare(`
            SELECT
                workspace_state.workspace_id,
                backup_configuration.backup_set_id,
                backup_configuration.canonical_destination_path,
                backup_configuration.destination_display_name,
                backup_configuration.repository_schema
            FROM workspace_state
            JOIN backup_configuration
                ON backup_configuration.singleton = workspace_state.singleton
            WHERE workspace_state.singleton = 1
        `).get() as {
            workspace_id: string;
            backup_set_id: string | null;
            canonical_destination_path: string | null;
            destination_display_name: string | null;
            repository_schema: typeof BACKUP_REPOSITORY_SCHEMA | null;
        };
        if (row.backup_set_id === null) {
            return null;
        }
        return Object.freeze({
            workspaceId: row.workspace_id,
            backupSetId: row.backup_set_id,
            canonicalPath: row.canonical_destination_path!,
            displayName: row.destination_display_name!,
            repositorySchema: row.repository_schema!,
        });
    }

    /**
     * Reads every typed pre-checkpoint RestoreSession for restart reconstruction.
     * @return {readonly StoredRestoreSession[]} Sessions ordered by stable identity.
     */
    public readRestoreSessions(): readonly StoredRestoreSession[] {
        this.requireOpen();
        const statement = this.database.prepare(`
            SELECT *
            FROM restore_sessions
            ORDER BY restore_session_id
        `);
        statement.setReadBigInts(true);
        return Object.freeze((statement.all() as RestoreSessionRow[]).map(restoreSessionFromRow));
    }

    /**
     * Reads one durable restore command receipt for exact CommandId replay.
     * @param {string} commandId - Canonical command identity.
     * @return {StoredRestoreCommandReceipt | null} Matching receipt or null.
     */
    public readRestoreCommandReceipt(commandId: string): StoredRestoreCommandReceipt | null {
        this.requireOpen();
        if (!isCanonicalUuid(commandId)) {
            throw new TypeError('Restore CommandId is invalid');
        }
        const row = this.database.prepare(`
            SELECT
                command_id,
                command_kind,
                payload_digest,
                restore_session_id,
                result_session_version
            FROM restore_command_receipts
            WHERE command_id = ?
        `).get(commandId) as {
            command_id: string;
            command_kind: 'start' | 'confirm' | 'cancel';
            payload_digest: Uint8Array;
            restore_session_id: string;
            result_session_version: bigint;
        } | undefined;
        return row
            ? Object.freeze({
                commandId: row.command_id,
                commandKind: row.command_kind,
                payloadDigest: Buffer.from(row.payload_digest).toString('hex'),
                restoreSessionId: row.restore_session_id,
                resultSessionVersion: row.result_session_version.toString(),
            })
            : null;
    }

    /**
     * Reads and verifies the typed receipt for one completed Restore activation.
     * @param {string} operationId - Stable Restore operation identity.
     * @return {RestoreCompletionReceipt | null} Exact receipt or null.
     */
    public readRestoreCompletionReceipt(operationId: string): RestoreCompletionReceipt | null {
        this.requireOpen();
        if (!isCanonicalUuid(operationId)) {
            throw new TypeError('Restore OperationId is invalid');
        }
        const row = this.database.prepare(`
            SELECT *
            FROM restore_completion_receipts
            WHERE operation_id = ?
        `).get(operationId) as RestoreCompletionReceiptRow | undefined;
        if (!row) {
            return null;
        }
        const receipt = restoreCompletionReceiptFromRow(row);
        const {receiptDigest, ...input} = receipt;
        const observedDigest = createHash('sha256')
            .update(canonicalJson(input), 'utf8')
            .digest('hex');
        if (observedDigest !== receiptDigest) {
            throw new Error('Restore completion receipt digest is invalid');
        }
        return receipt;
    }

    /**
     * Commits a path-free success or rollback receipt against this exact reopened DATA.
     * @param {RestoreCompletionReceiptInput} input - Reopen-validated completion facts.
     * @return {RestoreCompletionReceipt} New or idempotently replayed receipt.
     */
    public recordRestoreCompletionReceipt(
        input: RestoreCompletionReceiptInput,
    ): RestoreCompletionReceipt {
        this.requireBackupMutationAllowed();
        requireRestoreCompletionReceiptInput(input);
        if (input.activeWorkspaceId !== this.workspaceId
            || input.activeRevision !== this.revision.toString()) {
            throw new Error('Restore receipt does not match active DATA');
        }
        const receiptDigest = createHash('sha256')
            .update(canonicalJson(input), 'utf8')
            .digest('hex');
        const existing = this.readRestoreCompletionReceipt(input.operationId);
        if (existing) {
            if (existing.receiptDigest !== receiptDigest) {
                throw new Error('Restore completion receipt conflict');
            }
            return existing;
        }
        try {
            this.database.exec('BEGIN IMMEDIATE');
            const sessionRows = this.database.prepare(`
                SELECT
                    restore_session_id,
                    operation_id,
                    phase,
                    session_version,
                    safety_set_id
                FROM restore_sessions
                WHERE restore_session_id = ? OR operation_id = ?
            `).all(input.restoreSessionId, input.operationId) as Array<{
                restore_session_id: string;
                operation_id: string;
                phase: StoredRestoreSession['phase'];
                session_version: number;
                safety_set_id: string | null;
            }>;
            if (sessionRows.length > 1
                || (sessionRows.length === 1
                    && (sessionRows[0]!.restore_session_id !== input.restoreSessionId
                        || sessionRows[0]!.operation_id !== input.operationId
                        || sessionRows[0]!.phase !== 'protection-established'
                        || sessionRows[0]!.session_version !== 1
                        || sessionRows[0]!.safety_set_id !== input.protection.safetySetId))) {
                throw new Error('Restore completion conflicts with pre-checkpoint DATA facts');
            }
            if (sessionRows.length === 1) {
                this.database.prepare(`
                    DELETE FROM restore_command_receipts
                    WHERE restore_session_id = ?
                `).run(input.restoreSessionId);
                this.database.prepare(`
                    DELETE FROM restore_sessions
                    WHERE restore_session_id = ? AND operation_id = ?
                `).run(input.restoreSessionId, input.operationId);
            }
            this.database.prepare(`
                INSERT INTO restore_completion_receipts (
                    operation_id,
                    restore_session_id,
                    outcome,
                    session_version,
                    source_snapshot_id,
                    source_root_digest,
                    source_schema_level,
                    post_migration_schema_level,
                    active_workspace_id,
                    active_revision,
                    library_state,
                    protection_mode,
                    safety_set_id,
                    plan_digest,
                    precommit_sequence,
                    precommit_record_digest,
                    route,
                    receipt_format_version,
                    receipt_digest
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'absent', 'required', ?, ?, ?, ?, ?, '1', ?)
            `).run(
                input.operationId,
                input.restoreSessionId,
                input.outcome,
                BigInt(input.sessionVersion),
                input.sourceSnapshotId,
                input.sourceRootDigest,
                BigInt(input.sourceSchemaLevel),
                BigInt(input.postMigrationSchemaLevel),
                input.activeWorkspaceId,
                BigInt(input.activeRevision),
                input.protection.safetySetId,
                input.planDigest,
                BigInt(input.precommit.sequence),
                input.precommit.recordDigest,
                input.route,
                receiptDigest,
            );
            this.database.exec('COMMIT');
        }
        catch (error) {
            this.rollbackOrRequireReopen();
            throw error;
        }
        const stored = this.readRestoreCompletionReceipt(input.operationId);
        if (!stored) {
            throw new Error('Restore completion receipt is missing after commit');
        }
        return stored;
    }

    /**
     * Atomically stores a previewed RestoreSession and its start receipt.
     * @param {StoredRestoreSession} session - Complete preview-bound typed facts.
     * @param {StoredRestoreCommandReceipt} receipt - Matching start receipt.
     * @return {void}
     */
    public createRestoreSession(
        session: StoredRestoreSession,
        receipt: StoredRestoreCommandReceipt,
    ): void {
        this.requireBackupMutationAllowed();
        if (session.phase !== 'previewed'
            || session.sessionVersion !== '0'
            || receipt.commandKind !== 'start'
            || receipt.restoreSessionId !== session.restoreSessionId
            || receipt.resultSessionVersion !== '0'
            || !/^[0-9a-f]{64}$/.test(receipt.payloadDigest)) {
            throw new TypeError('RestoreSession start facts are invalid');
        }
        try {
            this.database.exec('BEGIN IMMEDIATE');
            this.database.prepare(`
                INSERT INTO restore_sessions (
                    restore_session_id,
                    operation_id,
                    candidate_ref,
                    snapshot_id,
                    candidate_root_digest,
                    candidate_database_digest,
                    source_schema_level,
                    prepared_schema_level,
                    candidate_revision,
                    validation_copy,
                    current_workspace_id,
                    current_revision,
                    current_library_kind,
                    current_library_root_id,
                    current_root_generation,
                    target_binding_version,
                    term_count,
                    course_count,
                    task_series_count,
                    impact_digest,
                    binding_digest,
                    preview_token,
                    phase,
                    session_version,
                    problem_code,
                    safety_set_id,
                    safety_protected_revision,
                    safety_root_digest
                ) VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?
                )
            `).run(
                session.restoreSessionId,
                session.operationId,
                session.candidateRef,
                session.snapshotId,
                session.candidateRootDigest,
                session.candidateDatabaseDigest,
                BigInt(session.sourceSchemaLevel),
                BigInt(session.preparedSchemaLevel),
                BigInt(session.candidateRevision),
                session.validationCopy,
                session.currentWorkspaceId,
                BigInt(session.currentRevision),
                session.currentLibrary.kind,
                session.currentLibrary.kind === 'present'
                    ? session.currentLibrary.libraryRootId
                    : null,
                session.currentLibrary.kind === 'present'
                    ? session.currentLibrary.rootGeneration
                    : null,
                BigInt(session.targetBindingVersion),
                BigInt(session.termCount),
                BigInt(session.courseCount),
                BigInt(session.taskSeriesCount),
                session.impactDigest,
                session.bindingDigest,
                session.previewToken,
                session.phase,
                BigInt(session.sessionVersion),
                session.problemCode,
                session.safetySetId,
                session.safetyProtectedRevision === null
                    ? null
                    : BigInt(session.safetyProtectedRevision),
                session.safetyRootDigest,
            );
            insertRestoreCommandReceipt(this.database, receipt);
            this.database.exec('COMMIT');
        }
        catch (error) {
            this.rollbackOrRequireReopen();
            throw error;
        }
    }

    /**
     * Atomically advances one preview and records its exact confirm receipt.
     * @param {StoredRestoreSession} session - Complete next typed state.
     * @param {string} expectedVersion - Required current session version.
     * @param {StoredRestoreCommandReceipt} receipt - Matching confirmation receipt.
     * @return {void}
     */
    public advanceRestoreSession(
        session: StoredRestoreSession,
        expectedVersion: string,
        receipt: StoredRestoreCommandReceipt,
    ): void {
        this.requireBackupMutationAllowed();
        if (expectedVersion !== '0'
            || session.sessionVersion !== '1'
            || session.phase === 'previewed'
            || receipt.commandKind !== 'confirm'
            || receipt.restoreSessionId !== session.restoreSessionId
            || receipt.resultSessionVersion !== '1'
            || !/^[0-9a-f]{64}$/.test(receipt.payloadDigest)) {
            throw new TypeError('RestoreSession transition facts are invalid');
        }
        try {
            this.database.exec('BEGIN IMMEDIATE');
            const result = this.database.prepare(`
                UPDATE restore_sessions
                SET
                    preview_token = ?,
                    phase = ?,
                    session_version = ?,
                    problem_code = ?,
                    safety_set_id = ?,
                    safety_protected_revision = ?,
                    safety_root_digest = ?
                WHERE restore_session_id = ? AND session_version = ?
            `).run(
                session.previewToken,
                session.phase,
                BigInt(session.sessionVersion),
                session.problemCode,
                session.safetySetId,
                session.safetyProtectedRevision === null
                    ? null
                    : BigInt(session.safetyProtectedRevision),
                session.safetyRootDigest,
                session.restoreSessionId,
                BigInt(expectedVersion),
            );
            if (BigInt(result.changes) !== 1n) {
                throw new Error('RestoreSession version changed');
            }
            insertRestoreCommandReceipt(this.database, receipt);
            this.database.exec('COMMIT');
        }
        catch (error) {
            this.rollbackOrRequireReopen();
            throw error;
        }
    }

    /**
     * Atomically cancels one pre-checkpoint RestoreSession and records its command receipt.
     * @param {StoredRestoreSession} session - Exact cancelled typed state.
     * @param {string} expectedVersion - Required current session version.
     * @param {StoredRestoreCommandReceipt} receipt - Matching cancellation receipt.
     * @return {void}
     */
    public cancelRestoreSession(
        session: StoredRestoreSession,
        expectedVersion: string,
        receipt: StoredRestoreCommandReceipt,
    ): void {
        this.requireBackupMutationAllowed();
        if (!isCanonicalUnsignedSqliteInteger(expectedVersion)
            || (expectedVersion !== '0' && expectedVersion !== '1')
            || session.sessionVersion !== (BigInt(expectedVersion) + 1n).toString()
            || session.phase !== 'cancelled'
            || session.previewToken !== null
            || session.problemCode !== null
            || receipt.commandKind !== 'cancel'
            || receipt.restoreSessionId !== session.restoreSessionId
            || receipt.resultSessionVersion !== session.sessionVersion
            || !/^[0-9a-f]{64}$/.test(receipt.payloadDigest)) {
            throw new TypeError('RestoreSession cancellation facts are invalid');
        }
        try {
            this.database.exec('BEGIN IMMEDIATE');
            const result = this.database.prepare(`
                UPDATE restore_sessions
                SET
                    preview_token = NULL,
                    phase = 'cancelled',
                    session_version = ?,
                    problem_code = NULL
                WHERE restore_session_id = ?
                    AND session_version = ?
                    AND phase <> 'cancelled'
            `).run(
                BigInt(session.sessionVersion),
                session.restoreSessionId,
                BigInt(expectedVersion),
            );
            if (BigInt(result.changes) !== 1n) {
                throw new Error('RestoreSession version changed');
            }
            insertRestoreCommandReceipt(this.database, receipt);
            this.database.exec('COMMIT');
        }
        catch (error) {
            this.rollbackOrRequireReopen();
            throw error;
        }
    }


    /**
     * Revalidates one raw snapshot database as a supported restore candidate.
     * @param {string} candidatePath - Exact immutable snapshot member path.
     * @return {RestoreDatabaseFacts} Fresh identity, revision, schema, and impact facts.
     */
    public inspectRestoreCandidateDatabase(candidatePath: string): RestoreDatabaseFacts {
        this.requireOpen();
        if (!isAbsolute(candidatePath) || candidatePath.includes('\0')) {
            throw new TypeError('Restore candidate database path is invalid');
        }
        const candidate = openDatabase(candidatePath, true);
        try {
            const identity = readDatabaseIdentity(candidate);
            const facts = validateSupportedRestoreSchema(candidate, identity.schemaLevel);
            if (identity.applicationId !== COURSEFLOW_APPLICATION_ID
                || facts === null
                || facts.workspaceId !== this.workspaceId
                || facts.revision <= 0n) {
                throw new Error('Restore candidate database identity is invalid');
            }
            return Object.freeze({
                workspaceId: facts.workspaceId,
                applicationId: identity.applicationId.toString(),
                schemaLevel: identity.schemaLevel.toString(),
                actualRevision: facts.revision.toString(),
                ...readRestoreImpactCounts(candidate),
                sourceBackup: readRestoreSourceBackup(candidate),
            });
        }
        finally {
            candidate.close();
        }
    }

    /**
     * Copies and migrates one verified candidate in an isolated validation directory.
     * @param {string} sourcePath - Immutable raw snapshot database member.
     * @param {string} destinationPath - Absent operation-owned validation copy path.
     * @return {PreparedRestoreDatabaseFacts} Validated prepared copy facts.
     */
    public prepareRestoreCandidateDatabaseCopy(
        sourcePath: string,
        destinationPath: string,
    ): PreparedRestoreDatabaseFacts {
        this.requireOpen();
        if (!isAbsolute(sourcePath)
            || sourcePath.includes('\0')
            || !isAbsolute(destinationPath)
            || destinationPath.includes('\0')) {
            throw new TypeError('Restore candidate copy paths are invalid');
        }
        const sourceFacts = this.inspectRestoreCandidateDatabase(sourcePath);
        copyFileSync(sourcePath, destinationPath, fsConstants.COPYFILE_EXCL);
        const prepared = openDatabase(destinationPath, false);
        try {
            let schemaLevel = Number(sourceFacts.schemaLevel);
            while (schemaLevel < CURRENT_SCHEMA_LEVEL) {
                prepared.exec('BEGIN IMMEDIATE');
                try {
                    if (schemaLevel === 13) {
                        validateSchemaLevel13(prepared);
                        migrateLevel13To14(prepared);
                        validateSchemaLevel14(prepared);
                    }
                    else if (schemaLevel === 14) {
                        validateSchemaLevel14(prepared);
                        migrateLevel14To15(prepared);
                        validateSchemaLevel15(prepared);
                    }
                    else if (schemaLevel === 15) {
                        validateSchemaLevel15(prepared);
                        migrateLevel15To16(prepared);
                        validateSchemaLevel16(prepared);
                    }
                    else {
                        throw new Error('Restore candidate schema is unsupported');
                    }
                    prepared.exec('COMMIT');
                    schemaLevel += 1;
                }
                catch (error) {
                    if (prepared.isTransaction) {
                        prepared.exec('ROLLBACK');
                    }
                    throw error;
                }
            }
        }
        finally {
            prepared.close();
        }
        normalizeBackupDatabaseCopy(destinationPath);
        const preparedFacts = this.inspectRestoreCandidateDatabase(destinationPath);
        return Object.freeze({
            ...preparedFacts,
            sourceSchemaLevel: sourceFacts.schemaLevel,
            preparedSchemaLevel: preparedFacts.schemaLevel,
            validationCopy: sourceFacts.schemaLevel === preparedFacts.schemaLevel
                ? 'copied'
                : 'migrated',
        });
    }

    /**
     * Writes and verifies a healthy current DATA member for a RestoreSafetySet.
     * @param {string} destinationPath - Absent operation-owned safety member path.
     * @param {string} expectedRevision - Minimum preview-bound current revision.
     * @return {Promise<BackupDatabaseFacts>} Fresh copied current DATA facts.
     */
    public async writeRestoreSafetyDatabaseCopy(
        destinationPath: string,
        expectedRevision: string,
    ): Promise<BackupDatabaseFacts> {
        this.requireBackupMutationAllowed();
        if (!isAbsolute(destinationPath)
            || destinationPath.includes('\0')
            || !isCanonicalUnsignedSqliteInteger(expectedRevision)) {
            throw new TypeError('Restore safety database destination is invalid');
        }
        await backup(this.database, destinationPath);
        normalizeBackupDatabaseCopy(destinationPath);
        return this.validateRestoreSafetyDatabaseCopy(destinationPath, expectedRevision);
    }

    /**
     * Revalidates one healthy RestoreSafetySet DATA member against the current schema.
     * @param {string} copyPath - Exact copied database path.
     * @param {string} minimumRevision - Minimum revision the copy must cover.
     * @return {BackupDatabaseFacts} Fresh current DATA facts.
     */
    public validateRestoreSafetyDatabaseCopy(
        copyPath: string,
        minimumRevision: string,
    ): BackupDatabaseFacts {
        this.requireOpen();
        if (!isAbsolute(copyPath)
            || copyPath.includes('\0')
            || !isCanonicalUnsignedSqliteInteger(minimumRevision)) {
            throw new TypeError('Restore safety database validation input is invalid');
        }
        const copied = openDatabase(copyPath, true);
        try {
            const identity = readDatabaseIdentity(copied);
            const facts = validateSupportedRestoreSchema(copied, identity.schemaLevel);
            if (identity.applicationId !== COURSEFLOW_APPLICATION_ID
                || identity.schemaLevel !== CURRENT_SCHEMA_LEVEL
                || facts === null
                || facts.workspaceId !== this.workspaceId
                || facts.revision < BigInt(minimumRevision)) {
                throw new Error('Restore safety database does not match current DATA');
            }
            return Object.freeze({
                workspaceId: facts.workspaceId,
                applicationId: identity.applicationId.toString(),
                schemaLevel: identity.schemaLevel.toString(),
                actualRevision: facts.revision.toString(),
            });
        }
        finally {
            copied.close();
        }
    }

    /**
     * Writes a consistent SQLite backup member and returns facts read from that exact copy.
     * @param {string} destinationPath - Absent operation-owned temporary file.
     * @param {string} targetRevision - Durable revision the copy must cover.
     * @return {Promise<BackupDatabaseFacts>} Validated copied database identity and actual revision.
     */
    public async writeBackupDatabaseCopy(
        destinationPath: string,
        targetRevision: string,
    ): Promise<BackupDatabaseFacts> {
        this.requireBackupMutationAllowed();
        if (!isAbsolute(destinationPath)
            || destinationPath.includes('\0')
            || !isCanonicalUnsignedSqliteInteger(targetRevision)
            || targetRevision === '0') {
            throw new TypeError('Backup database destination is invalid');
        }
        await backup(this.database, destinationPath);
        normalizeBackupDatabaseCopy(destinationPath);
        return this.validateBackupDatabaseCopy(destinationPath, targetRevision);
    }

    /**
     * Revalidates one existing backup member without consulting cached checkpoint facts.
     * @param {string} copyPath - Exact copied database path.
     * @param {string} targetRevision - Durable revision the copy must cover.
     * @return {BackupDatabaseFacts} Fresh database identity and actual revision.
     */
    public validateBackupDatabaseCopy(
        copyPath: string,
        targetRevision: string,
    ): BackupDatabaseFacts {
        this.requireOpen();
        if (!isAbsolute(copyPath)
            || copyPath.includes('\0')
            || !isCanonicalUnsignedSqliteInteger(targetRevision)
            || targetRevision === '0') {
            throw new TypeError('Backup database validation input is invalid');
        }
        const copied = openDatabase(copyPath, true);
        try {
            const identity = readDatabaseIdentity(copied);
            const facts = identity.schemaLevel === 13
                ? validateSchemaLevel13(copied)
                : identity.schemaLevel === 14
                    ? validateSchemaLevel14(copied)
                    : identity.schemaLevel === 15
                        ? validateSchemaLevel15(copied)
                        : identity.schemaLevel === 16
                            ? validateSchemaLevel16(copied)
                            : null;
            if (identity.applicationId !== COURSEFLOW_APPLICATION_ID
                || facts === null
                || facts.workspaceId !== this.workspaceId
                || facts.revision < BigInt(targetRevision)) {
                throw new Error('Backup database copy does not cover the target revision');
            }
            return Object.freeze({
                workspaceId: facts.workspaceId,
                applicationId: identity.applicationId.toString(),
                schemaLevel: identity.schemaLevel.toString(),
                actualRevision: facts.revision.toString(),
            });
        }
        finally {
            copied.close();
        }
    }

    /**
     * Recovers accepted destination facts for exact CommandId replay inside Workspace.
     * @param {string} commandId - Durable command identity.
     * @return {StoredBackupDestination | null} Stored internal destination facts.
     */
    public readBackupConfigurationForCommand(commandId: string): StoredBackupDestination | null {
        this.requireOpen();
        if (!isCanonicalUuid(commandId)) {
            throw new TypeError('CommandId must be a canonical UUID');
        }
        const row = this.database.prepare(`
            SELECT
                backup_set_id,
                canonical_destination_path,
                destination_display_name,
                repository_schema
            FROM backup_configuration
            WHERE singleton = 1 AND originating_command_id = ?
        `).get(commandId) as {
            backup_set_id: string;
            canonical_destination_path: string;
            destination_display_name: string;
            repository_schema: typeof BACKUP_REPOSITORY_SCHEMA;
        } | undefined;
        return row
            ? Object.freeze({
                backupSetId: row.backup_set_id,
                canonicalPath: row.canonical_destination_path,
                displayName: row.destination_display_name,
                repositorySchema: row.repository_schema,
            })
            : null;
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


















    private drain(): void {
        let work = this.queue.shift();
        while (work) {
            try {
                if (work.kind === 'commit') {
                    const result = commitSynchronously(this.storeContext, work.command, work.options);
                    work.resolve(result);
                    if (result.ok) {
                        this.schedulePostCommitHint();
                    }
                }
                else {
                    work.resolve(writeSetupDraftSynchronously(this.storeContext, work.mutation, work.options));
                }
            } catch (error) {
                work.reject(error);
                if (work.kind === 'commit' && error instanceof CommittedCommandOutcomeUnknownError) {
                    this.schedulePostCommitHint();
                }
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

    /**
     * Schedules the detachable best-effort PostCommit wake after local outcome resolution.
     * @return {void}
     */
    private schedulePostCommitHint(): void {
        const hint = this.postCommitHint;
        if (!hint) {
            return;
        }
        queueMicrotask(() => {
            if (this.postCommitHint !== hint) {
                return;
            }
            try {
                hint();
            }
            catch {
                // DurableFollowUp remains authoritative when the best-effort hint fails.
            }
        });
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












/**
 * Reopens and fully validates one closed operation-owned DATA sibling without making it active.
 * @param {string} dataSlotsRoot - Trusted DataSlots parent.
 * @param {string} slotName - Exact direct-child DataSlot name.
 * @return {RestoreDataSlotFacts} Fresh current-schema identity and revision.
 */
export function inspectRestoreDataSlot(
    dataSlotsRoot: string,
    slotName: string,
): RestoreDataSlotFacts {
    if (!isAbsolute(dataSlotsRoot)
        || dataSlotsRoot.includes('\0')
        || slotName.length === 0
        || slotName === '.'
        || slotName === '..'
        || slotName.includes('\0')
        || basename(slotName) !== slotName) {
        throw new TypeError('Restore DataSlot location is invalid');
    }
    const candidate = openDatabase(join(dataSlotsRoot, slotName, DATABASE_FILE_NAME), true);
    try {
        const identity = readDatabaseIdentity(candidate);
        if (identity.applicationId !== COURSEFLOW_APPLICATION_ID
            || identity.schemaLevel !== CURRENT_SCHEMA_LEVEL) {
            throw new Error('Restore DataSlot database identity is invalid');
        }
        const facts = validateSchemaLevel16(candidate);
        return Object.freeze({
            workspaceId: facts.workspaceId,
            schemaLevel: identity.schemaLevel.toString(),
            revision: facts.revision.toString(),
        });
    }
    finally {
        candidate.close();
    }
}

/**
 * Reads and verifies one completion receipt from a closed operation-owned DATA slot.
 * @param {string} dataSlotsRoot - Trusted DataSlots parent.
 * @param {string} slotName - Exact direct-child DataSlot name.
 * @param {string} operationId - Stable Restore operation identity.
 * @return {RestoreCompletionReceipt | null} Verified receipt or null.
 */
export function inspectRestoreCompletionReceipt(
    dataSlotsRoot: string,
    slotName: string,
    operationId: string,
): RestoreCompletionReceipt | null {
    if (!isAbsolute(dataSlotsRoot)
        || dataSlotsRoot.includes('\0')
        || slotName.length === 0
        || slotName === '.'
        || slotName === '..'
        || slotName.includes('\0')
        || basename(slotName) !== slotName
        || !isCanonicalUuid(operationId)) {
        throw new TypeError('Restore receipt location is invalid');
    }
    const database = openDatabase(join(dataSlotsRoot, slotName, DATABASE_FILE_NAME), true);
    try {
        const identity = readDatabaseIdentity(database);
        if (identity.applicationId !== COURSEFLOW_APPLICATION_ID
            || identity.schemaLevel !== CURRENT_SCHEMA_LEVEL) {
            throw new Error('Restore receipt DATA identity is invalid');
        }
        validateSchemaLevel16(database);
        const row = database.prepare(`
            SELECT *
            FROM restore_completion_receipts
            WHERE operation_id = ?
        `).get(operationId) as RestoreCompletionReceiptRow | undefined;
        if (!row) {
            return null;
        }
        const receipt = restoreCompletionReceiptFromRow(row);
        const {receiptDigest, ...input} = receipt;
        requireRestoreCompletionReceiptInput(input);
        const observedDigest = createHash('sha256')
            .update(canonicalJson(input), 'utf8')
            .digest('hex');
        if (observedDigest !== receiptDigest) {
            throw new Error('Restore completion receipt digest is invalid');
        }
        return receipt;
    }
    finally {
        database.close();
    }
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
        createSchemaLevel16(stagingDatabase);
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
            INSERT INTO setup_draft_checkpoint (
                singleton,
                checkpoint_version,
                schema_version,
                updated_at,
                opaque_payload
            ) VALUES (1, 0, NULL, NULL, NULL);
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
            INSERT INTO backup_configuration (
                singleton,
                configuration_version,
                backup_set_id,
                repository_schema,
                canonical_destination_path,
                destination_display_name,
                originating_command_id,
                configured_revision
            ) VALUES (1, 0, NULL, NULL, NULL, NULL, NULL, NULL);
        `);
        throwFailpoint(options.failpoint, 'initialize.after-bootstrap');
        stagingDatabase.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_LEVEL}`);
        throwFailpoint(options.failpoint, 'initialize.after-user-version');
        stagingDatabase.exec('COMMIT');
        stagingDatabase.close();
        stagingDatabase = undefined;

        const validationDatabase = openDatabase(stagingDatabasePath, true);
        try {
            validateSchemaLevel16(validationDatabase);
        } finally {
            validationDatabase.close();
        }
        throwFailpoint(options.failpoint, 'initialize.after-validation');

        renameSync(stagingDirectory, activeDirectory(dataSlotsRoot));
        activated = true;
        const activeDatabase = openDatabase(databasePath(dataSlotsRoot), false);
        const facts = validateSchemaLevel16(activeDatabase);
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

        const facts = validateSchemaLevel16(validationDatabase);
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
        const facts = validateSchemaLevel16(activeDatabase);
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
                && identity.schemaLevel !== 9
                && identity.schemaLevel !== 10
                && identity.schemaLevel !== 11
                && identity.schemaLevel !== 12
                && identity.schemaLevel !== 13
                && identity.schemaLevel !== 14
                && identity.schemaLevel !== 15)) {
            closeBestEffort(source);
            return opened;
        }
        let sourceFacts: SchemaFacts;
        if (identity.schemaLevel === 1) {
            sourceFacts = validateSchemaLevel1(source);
        }
        else if (identity.schemaLevel === 2) {
            sourceFacts = validateSchemaLevel2(source);
        }
        else if (identity.schemaLevel === 3) {
            sourceFacts = validateSchemaLevel3(source);
        }
        else if (identity.schemaLevel === 4) {
            sourceFacts = validateSchemaLevel4(source);
        }
        else if (identity.schemaLevel === 5) {
            sourceFacts = validateSchemaLevel5(source);
        }
        else if (identity.schemaLevel === 6) {
            sourceFacts = validateSchemaLevel6(source);
        }
        else if (identity.schemaLevel === 7) {
            sourceFacts = validateSchemaLevel7(source);
        }
        else if (identity.schemaLevel === 8) {
            sourceFacts = validateSchemaLevel8(source);
        }
        else if (identity.schemaLevel === 9) {
            sourceFacts = validateSchemaLevel9(source);
        }
        else if (identity.schemaLevel === 10) {
            sourceFacts = validateSchemaLevel10(source);
        }
        else if (identity.schemaLevel === 11) {
            sourceFacts = validateSchemaLevel11(source);
        }
        else if (identity.schemaLevel === 12) {
            sourceFacts = validateSchemaLevel12(source);
        }
        else if (identity.schemaLevel === 13) {
            sourceFacts = validateSchemaLevel13(source);
        }
        else if (identity.schemaLevel === 14) {
            sourceFacts = validateSchemaLevel14(source);
        }
        else {
            sourceFacts = validateSchemaLevel15(source);
        }
        if (options.readOnly) {
            closeBestEffort(source);
            return recoveryResult(incompatibleVersionProblem(identity.schemaLevel));
        }
        if (!options.migrationSafetyCopy) {
            closeBestEffort(source);
            source = undefined;
            return recoveryResult(migrationSafetyUnavailableProblem());
        }
        await ensureMigrationSafetyCopy({
            dataSlotsRoot,
            sourceDatabase: source,
            workspaceId: sourceFacts.workspaceId,
            sourceRevision: sourceFacts.revision,
            sourceSchemaLevel: identity.schemaLevel,
            targetSchemaLevel: CURRENT_SCHEMA_LEVEL,
            binding: options.migrationSafetyCopy,
            failpoint: options.migrationFailpoint,
        });
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
                    else if (schemaLevel === 9) {
                        validateSchemaLevel9(maintenance);
                        migrateLevel9To10(maintenance);
                        validateSchemaLevel10(maintenance);
                    }
                    else if (schemaLevel === 10) {
                        validateSchemaLevel10(maintenance);
                        migrateLevel10To11(maintenance);
                        validateSchemaLevel11(maintenance);
                    }
                    else if (schemaLevel === 11) {
                        validateSchemaLevel11(maintenance);
                        migrateLevel11To12(maintenance);
                        validateSchemaLevel12(maintenance);
                    }
                    else if (schemaLevel === 12) {
                        validateSchemaLevel12(maintenance);
                        migrateLevel12To13(maintenance);
                        validateSchemaLevel13(maintenance);
                    }
                    else if (schemaLevel === 13) {
                        validateSchemaLevel13(maintenance);
                        migrateLevel13To14(maintenance);
                        validateSchemaLevel14(maintenance);
                    }
                    else if (schemaLevel === 14) {
                        validateSchemaLevel14(maintenance);
                        migrateLevel14To15(maintenance);
                        validateSchemaLevel15(maintenance);
                    }
                    else {
                        validateSchemaLevel15(maintenance);
                        migrateLevel15To16(maintenance);
                        validateSchemaLevel16(maintenance);
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
            validateSchemaLevel16(maintenance);
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
