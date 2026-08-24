/**
 * @file Defines Task facts, command DTOs, stable identity, and receipt digest projections.
 */

import type { CanonicalValue } from './canonical-json';
import {
    isMeetingOccurrenceWindow,
    normalizeMeetingOccurrenceWindow,
    type MeetingOccurrenceWindow,
    type MeetingWeekday,
} from './workspace-course-contract';
import { INTL_ZONE_RULES, isCanonicalInstant } from './meeting-time';
import {
    isCanonicalUnsignedSqliteInteger,
    isCanonicalUuid,
} from './workspace-data-contract';
import { isCanonicalLocalDate } from './workspace-term-contract';

export type TaskSize = 'small' | 'large';

export type TaskDeadline =
    | Readonly<{ kind: 'date-only'; date: string }>
    | Readonly<{ kind: 'timed'; instant: string; timeZone: string }>
    | Readonly<{ kind: 'tba' }>;

export type WeeklyTaskSchedule = Readonly<{
    kind: 'weekly';
    startDate: string;
    weekday: MeetingWeekday;
    localDeadlineTime: string;
    confirmedEndDate: string;
    followTeachingWeek: boolean;
}>;

export type OnceTaskSchedule = Readonly<{
    kind: 'once';
    deadline: TaskDeadline;
}>;

export type TaskSchedule =
    | OnceTaskSchedule
    | WeeklyTaskSchedule;

export type TaskOccurrenceWindow = MeetingOccurrenceWindow;

export type TaskOccurrenceId = Readonly<{
    taskSeriesId: string;
    originalLogicalAnchor: string;
}>;

type TaskProjectionBase = Readonly<{
    taskSeriesId: string;
    courseId: string;
    title: string;
    size: TaskSize;
    entityVersion: string;
}>;

export type TaskProjection =
    | TaskProjectionBase & Readonly<{
        deadline: TaskDeadline;
        occurrenceId: TaskOccurrenceId;
        status: 'pending' | 'completed';
    }>
    | TaskProjectionBase & Readonly<{
        schedule: WeeklyTaskSchedule;
        deadline?: never;
        occurrenceId?: never;
        status?: never;
    }>;

export type OnceTaskOccurrenceProjection = Readonly<{
    occurrenceId: TaskOccurrenceId;
    deadline: TaskDeadline;
    status: 'pending' | 'completed';
}>;

export type WeeklyTaskOccurrenceProjection = Readonly<{
    occurrenceId: TaskOccurrenceId;
    deadline: TaskDeadline;
}>;

export type TaskOccurrenceProjection =
    | OnceTaskOccurrenceProjection
    | WeeklyTaskOccurrenceProjection;

type TaskSeriesDetailProjectionBase = Readonly<{
    workspaceRevision: string;
    planEntityVersion: string;
    requestedWindow: TaskOccurrenceWindow;
    termZone: string;
    taskSeriesId: string;
    courseId: string;
    title: string;
    size: TaskSize;
    entityVersion: string;
}>;

export type TaskSeriesDetailProjection =
    | TaskSeriesDetailProjectionBase & Readonly<{
        schedule: OnceTaskSchedule;
        occurrences: readonly OnceTaskOccurrenceProjection[];
    }>
    | TaskSeriesDetailProjectionBase & Readonly<{
        schedule: WeeklyTaskSchedule;
        occurrences: readonly WeeklyTaskOccurrenceProjection[];
    }>;

type TaskCommandBase = Readonly<{
    commandId: string;
    followUpId: string;
    expectedRevision: string;
    expectedPlanVersion: string;
}>;

type ExistingTaskCommandBase = TaskCommandBase & Readonly<{
    expectedTaskSeriesVersion: string;
}>;

type OnceTaskFacts = Readonly<{
    courseId: string;
    title: string;
    size: TaskSize;
    deadline: TaskDeadline;
}>;

type ScheduledTaskFacts = Readonly<{
    courseId: string;
    title: string;
    size: TaskSize;
    schedule: TaskSchedule;
}>;

export type CreateTaskCommand = TaskCommandBase & (
    | Readonly<{
        intent: Readonly<{
            kind: 'plan.create-task-series';
            intentSchemaVersion: 1;
            payload: OnceTaskFacts;
        }>;
    }>
    | Readonly<{
        intent: Readonly<{
            kind: 'plan.create-task-series';
            intentSchemaVersion: 2;
            payload: ScheduledTaskFacts;
        }>;
    }>
);

export type UpdateTaskCommand = ExistingTaskCommandBase & (
    | Readonly<{
        intent: Readonly<{
            kind: 'plan.update-task-series';
            intentSchemaVersion: 1;
            payload: OnceTaskFacts & Readonly<{ taskSeriesId: string }>;
        }>;
    }>
    | Readonly<{
        intent: Readonly<{
            kind: 'plan.update-task-series';
            intentSchemaVersion: 2;
            payload: ScheduledTaskFacts & Readonly<{ taskSeriesId: string }>;
        }>;
    }>
);

export type DeleteTaskCommand = ExistingTaskCommandBase & Readonly<{
    intent: Readonly<{
        kind: 'plan.delete-task-series';
        intentSchemaVersion: 1;
        payload: Readonly<{ taskSeriesId: string }>;
    }>;
}>;

export type CompleteTaskCommand = ExistingTaskCommandBase & Readonly<{
    intent: Readonly<{
        kind: 'plan.set-task-occurrence-status';
        intentSchemaVersion: 1;
        payload: Readonly<{
            taskSeriesId: string;
            originalLogicalAnchor: 'once';
            status: 'completed';
        }>;
    }>;
}>;

export type TaskCommand =
    | CreateTaskCommand
    | UpdateTaskCommand
    | DeleteTaskCommand
    | CompleteTaskCommand;

const MAX_TASK_TITLE_LENGTH = 240;
const TASK_WEEKDAYS = new Set<MeetingWeekday>([
    'MON',
    'TUE',
    'WED',
    'THU',
    'FRI',
    'SAT',
    'SUN',
]);
const LOCAL_TIME_PATTERN = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
const MAX_TASK_OCCURRENCE_ITEMS = 54;
const TASK_WEEKDAY_NUMBERS: Readonly<Record<MeetingWeekday, number>> = Object.freeze({
    SUN: 0,
    MON: 1,
    TUE: 2,
    WED: 3,
    THU: 4,
    FRI: 5,
    SAT: 6,
});

/**
 * Narrows an untrusted value to a plain object with exact enumerable data keys.
 * @param {unknown} value - Candidate structured-clone value.
 * @param {readonly string[]} expectedKeys - Exact allowed keys.
 * @return {boolean} Whether the value has only the expected data properties.
 */
function hasExactDataKeys(value: unknown, expectedKeys: readonly string[]): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        return false;
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    return keys.length === expectedKeys.length
        && keys.every(key => typeof key === 'string' && expectedKeys.includes(key))
        && expectedKeys.every(key => {
            const descriptor = descriptors[key];
            return descriptor !== undefined && 'value' in descriptor && descriptor.enumerable;
        });
}

/**
 * Rejects sparse arrays and arrays carrying structured-clone properties beyond indexed values.
 * @param {unknown} value - Candidate array crossing the Workspace boundary.
 * @return {boolean} Whether every slot is one enumerable data property and no extras exist.
 */
function isDenseArray(value: unknown): value is unknown[] {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
        return false;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== value.length + 1) {
        return false;
    }
    return Array.from({ length: value.length }, (_, index) => String(index)).every(key => {
        const descriptor = descriptors[key];
        return descriptor !== undefined && 'value' in descriptor && descriptor.enumerable;
    });
}

/**
 * Resolves one explicit IANA display zone through the runtime tzdb.
 * @param {unknown} value - Candidate zone value.
 * @return {string | null} Canonical zone, or null when invalid.
 */
function canonicalTimeZone(value: unknown): string | null {
    if (typeof value !== 'string' || value.length === 0) {
        return null;
    }

    try {
        return new Intl.DateTimeFormat('en-CA', { timeZone: value }).resolvedOptions().timeZone;
    }
    catch {
        return null;
    }
}

/**
 * Normalizes one explicit Task deadline union without assigning a made-up date to TBA.
 * @param {unknown} value - Candidate deadline DTO.
 * @return {TaskDeadline | null} Canonical deadline, or null when invalid.
 */
function normalizeTaskDeadline(value: unknown): TaskDeadline | null {
    if (!hasExactDataKeys(value, ['kind'])) {
        if (!hasExactDataKeys(value, ['kind', 'date'])
            && !hasExactDataKeys(value, ['kind', 'instant', 'timeZone'])) {
            return null;
        }
    }

    if (value.kind === 'tba' && hasExactDataKeys(value, ['kind'])) {
        return { kind: 'tba' };
    }
    if (value.kind === 'date-only'
        && hasExactDataKeys(value, ['kind', 'date'])
        && isCanonicalLocalDate(value.date)) {
        return { kind: 'date-only', date: value.date };
    }
    if (value.kind === 'timed'
        && hasExactDataKeys(value, ['kind', 'instant', 'timeZone'])
        && isCanonicalInstant(value.instant)) {
        const timeZone = canonicalTimeZone(value.timeZone);
        return timeZone === null ? null : { kind: 'timed', instant: value.instant, timeZone };
    }
    return null;
}

/**
 * Validates that a deadline is already in canonical DTO form.
 * @param {unknown} value - Candidate deadline DTO.
 * @return {boolean} Whether the deadline has exact canonical fields.
 */
function isCanonicalTaskDeadline(value: unknown): value is TaskDeadline {
    const deadline = normalizeTaskDeadline(value);
    if (deadline === null || !hasExactDataKeys(value, Object.keys(deadline))) {
        return false;
    }
    return deadline.kind === 'tba'
        || (deadline.kind === 'date-only' && value.date === deadline.date)
        || (deadline.kind === 'timed'
            && value.instant === deadline.instant
            && value.timeZone === deadline.timeZone);
}

/**
 * Normalizes the exact once-or-weekly Task schedule union.
 * @param {unknown} value - Candidate Task schedule.
 * @return {TaskSchedule | null} Canonical schedule, or null when invalid.
 */
export function normalizeTaskSchedule(value: unknown): TaskSchedule | null {
    if (hasExactDataKeys(value, ['kind', 'deadline']) && value.kind === 'once') {
        const deadline = normalizeTaskDeadline(value.deadline);
        return deadline === null ? null : { kind: 'once', deadline };
    }
    if (!hasExactDataKeys(value, [
        'kind',
        'startDate',
        'weekday',
        'localDeadlineTime',
        'confirmedEndDate',
        'followTeachingWeek',
    ])
        || value.kind !== 'weekly'
        || !isCanonicalLocalDate(value.startDate)
        || !TASK_WEEKDAYS.has(value.weekday as MeetingWeekday)
        || typeof value.localDeadlineTime !== 'string'
        || !LOCAL_TIME_PATTERN.test(value.localDeadlineTime)
        || !isCanonicalLocalDate(value.confirmedEndDate)
        || value.confirmedEndDate < value.startDate
        || typeof value.followTeachingWeek !== 'boolean') {
        return null;
    }
    return {
        kind: 'weekly',
        startDate: value.startDate,
        weekday: value.weekday as MeetingWeekday,
        localDeadlineTime: value.localDeadlineTime,
        confirmedEndDate: value.confirmedEndDate,
        followTeachingWeek: value.followTeachingWeek,
    };
}

/**
 * Validates that a schedule is already in canonical DTO form.
 * @param {unknown} value - Candidate Task schedule.
 * @return {boolean} Whether the schedule has exact canonical fields.
 */
function isCanonicalTaskSchedule(value: unknown): value is TaskSchedule {
    const schedule = normalizeTaskSchedule(value);
    if (schedule === null) {
        return false;
    }
    if (schedule.kind === 'once') {
        return hasExactDataKeys(value, ['kind', 'deadline'])
            && isCanonicalTaskDeadline(value.deadline);
    }
    return hasExactDataKeys(value, [
        'kind',
        'startDate',
        'weekday',
        'localDeadlineTime',
        'confirmedEndDate',
        'followTeachingWeek',
    ])
        && value.startDate === schedule.startDate
        && value.weekday === schedule.weekday
        && value.localDeadlineTime === schedule.localDeadlineTime
        && value.confirmedEndDate === schedule.confirmedEndDate
        && value.followTeachingWeek === schedule.followTeachingWeek;
}

/**
 * Normalizes the bounded physical-date window used to expand Task occurrences.
 * @param {unknown} value - Candidate expansion window.
 * @return {TaskOccurrenceWindow} Frozen canonical window.
 */
export function normalizeTaskOccurrenceWindow(value: unknown): TaskOccurrenceWindow {
    return normalizeMeetingOccurrenceWindow(value);
}

/**
 * Validates the bounded physical-date window used to expand Task occurrences.
 * @param {unknown} value - Candidate expansion window.
 * @return {boolean} Whether the window is exact, canonical, ordered, and bounded.
 */
export function isTaskOccurrenceWindow(value: unknown): value is TaskOccurrenceWindow {
    return isMeetingOccurrenceWindow(value);
}

/**
 * Tests whether one canonical LocalDate matches a weekly Task weekday.
 * @param {string} localDate - Candidate occurrence anchor.
 * @param {MeetingWeekday} weekday - Required weekly weekday.
 * @return {boolean} Whether the LocalDate falls on the requested weekday.
 */
function matchesWeekday(localDate: string, weekday: MeetingWeekday): boolean {
    return new Date(`${localDate}T00:00:00.000Z`).getUTCDay() === TASK_WEEKDAY_NUMBERS[weekday];
}

/**
 * Validates one derived occurrence against its owning Task schedule and TermZone.
 * @param {unknown} value - Candidate occurrence DTO.
 * @param {string} taskSeriesId - Owning Task series identity.
 * @param {TaskSchedule} schedule - Canonical owning schedule.
 * @param {TaskOccurrenceWindow} requestedWindow - Bounded expansion window.
 * @param {string} termZone - Explicit owning TermZone.
 * @return {boolean} Whether identity, deadline, and schedule-owned fields are coherent.
 */
function isTaskOccurrenceProjection(
    value: unknown,
    taskSeriesId: string,
    schedule: TaskSchedule,
    requestedWindow: TaskOccurrenceWindow,
    termZone: string,
): value is TaskOccurrenceProjection {
    const expectedKeys = schedule.kind === 'once'
        ? ['occurrenceId', 'deadline', 'status']
        : ['occurrenceId', 'deadline'];
    if (!hasExactDataKeys(value, expectedKeys)
        || !hasExactDataKeys(value.occurrenceId, ['taskSeriesId', 'originalLogicalAnchor'])
        || value.occurrenceId.taskSeriesId !== taskSeriesId
        || !isCanonicalTaskDeadline(value.deadline)) {
        return false;
    }
    const anchor = value.occurrenceId.originalLogicalAnchor;
    if (schedule.kind === 'once') {
        return anchor === 'once'
            && (value.status === 'pending' || value.status === 'completed')
            && JSON.stringify(value.deadline) === JSON.stringify(schedule.deadline);
    }
    if (!isCanonicalLocalDate(anchor)
        || anchor < schedule.startDate
        || anchor > schedule.confirmedEndDate
        || anchor < requestedWindow.startDate
        || anchor > requestedWindow.endDate
        || !matchesWeekday(anchor, schedule.weekday)
        || value.deadline.kind !== 'timed'
        || value.deadline.timeZone !== termZone) {
        return false;
    }
    return value.deadline.instant === INTL_ZONE_RULES.resolveInstant(
        termZone,
        anchor,
        schedule.localDeadlineTime,
    );
}

/**
 * Validates one bounded Task series detail crossing the Workspace query seam.
 * @param {unknown} value - Candidate Task series detail.
 * @return {boolean} Whether the projection is exact and internally coherent.
 */
export function isTaskSeriesDetailProjection(value: unknown): value is TaskSeriesDetailProjection {
    if (!hasExactDataKeys(value, [
        'workspaceRevision',
        'planEntityVersion',
        'requestedWindow',
        'termZone',
        'taskSeriesId',
        'courseId',
        'title',
        'size',
        'schedule',
        'entityVersion',
        'occurrences',
    ])
        || !isCanonicalUnsignedSqliteInteger(value.workspaceRevision)
        || !isCanonicalUnsignedSqliteInteger(value.planEntityVersion)
        || !isTaskOccurrenceWindow(value.requestedWindow)
        || canonicalTimeZone(value.termZone) !== value.termZone
        || !isCanonicalUuid(value.taskSeriesId)
        || !isCanonicalUuid(value.courseId)
        || typeof value.title !== 'string'
        || value.title.length === 0
        || value.title.length > MAX_TASK_TITLE_LENGTH
        || value.title !== value.title.trim()
        || (value.size !== 'small' && value.size !== 'large')
        || !isCanonicalTaskSchedule(value.schedule)
        || !isCanonicalUnsignedSqliteInteger(value.entityVersion)
        || value.entityVersion === '0'
        || !isDenseArray(value.occurrences)
        || value.occurrences.length > MAX_TASK_OCCURRENCE_ITEMS) {
        return false;
    }
    const occurrences = value.occurrences as unknown[];
    if (value.schedule.kind === 'once' && occurrences.length !== 1) {
        return false;
    }
    if (!occurrences.every(occurrence => isTaskOccurrenceProjection(
        occurrence,
        value.taskSeriesId as string,
        value.schedule as TaskSchedule,
        value.requestedWindow as TaskOccurrenceWindow,
        value.termZone as string,
    ))) {
        return false;
    }
    const anchors = occurrences.map(occurrence => (
        (occurrence as TaskOccurrenceProjection).occurrenceId.originalLogicalAnchor
    ));
    return new Set(anchors).size === anchors.length
        && anchors.every((anchor, index) => index === 0 || anchor > anchors[index - 1]!);
}

/**
 * Normalizes one Course-linked Task fact payload for the requested schema version.
 * @param {unknown} value - Candidate Task facts.
 * @param {boolean} includeTaskSeriesId - Whether the payload targets an existing Task series.
 * @return {TaskFacts & Record<string, unknown> | null} Canonical facts, or null when invalid.
 */
function normalizeTaskFacts(
    value: unknown,
    includeTaskSeriesId: boolean,
    intentSchemaVersion: 1 | 2,
): Record<string, unknown> | null {
    const scheduleKey = intentSchemaVersion === 1 ? 'deadline' : 'schedule';
    const expectedKeys = includeTaskSeriesId
        ? ['taskSeriesId', 'courseId', 'title', 'size', scheduleKey]
        : ['courseId', 'title', 'size', scheduleKey];
    if (!hasExactDataKeys(value, expectedKeys)
        || !isCanonicalUuid(value.courseId)
        || (includeTaskSeriesId && !isCanonicalUuid(value.taskSeriesId))
        || (value.size !== 'small' && value.size !== 'large')) {
        return null;
    }

    const title = typeof value.title === 'string' ? value.title.trim() : '';
    const schedule = intentSchemaVersion === 1
        ? normalizeTaskDeadline(value.deadline)
        : normalizeTaskSchedule(value.schedule);
    if (title.length === 0 || title.length > MAX_TASK_TITLE_LENGTH || schedule === null) {
        return null;
    }

    const facts = intentSchemaVersion === 1
        ? { courseId: value.courseId, title, size: value.size, deadline: schedule }
        : { courseId: value.courseId, title, size: value.size, schedule };
    return includeTaskSeriesId ? { taskSeriesId: value.taskSeriesId, ...facts } : facts;
}

/**
 * Normalizes shared command identity and optimistic-concurrency fields.
 * @param {unknown} value - Candidate command DTO.
 * @param {boolean} requiresTaskSeriesVersion - Whether the command targets an existing Task series.
 * @return {TaskCommandBase & Record<string, unknown>} Canonical shared fields.
 */
function normalizeCommandBase(
    value: unknown,
    requiresTaskSeriesVersion: boolean,
): TaskCommandBase & Record<string, unknown> {
    const expectedKeys = requiresTaskSeriesVersion
        ? [
            'commandId',
            'followUpId',
            'expectedRevision',
            'expectedPlanVersion',
            'expectedTaskSeriesVersion',
            'intent',
        ]
        : ['commandId', 'followUpId', 'expectedRevision', 'expectedPlanVersion', 'intent'];
    if (!hasExactDataKeys(value, expectedKeys)
        || !isCanonicalUuid(value.commandId)
        || !isCanonicalUuid(value.followUpId)
        || !isCanonicalUnsignedSqliteInteger(value.expectedRevision)
        || !isCanonicalUnsignedSqliteInteger(value.expectedPlanVersion)
        || (requiresTaskSeriesVersion
            && !isCanonicalUnsignedSqliteInteger(value.expectedTaskSeriesVersion))) {
        throw new TypeError('Task command has invalid fields');
    }
    return value as TaskCommandBase & Record<string, unknown>;
}

/**
 * Derives a stable Task occurrence identity without a stored ordinary occurrence row.
 * @param {string} taskSeriesId - Stable Task series identity.
 * @return {TaskOccurrenceId} Frozen stable tuple identity.
 */
export function deriveTaskOccurrenceId(
    taskSeriesId: string,
    originalLogicalAnchor: string = 'once',
): TaskOccurrenceId {
    if (!isCanonicalUuid(taskSeriesId)
        || (originalLogicalAnchor !== 'once' && !isCanonicalLocalDate(originalLogicalAnchor))) {
        throw new TypeError('TaskOccurrenceId requires a canonical series and logical anchor');
    }
    return Object.freeze({ taskSeriesId, originalLogicalAnchor });
}

/**
 * Validates an active Task summary projection crossing the Workspace query seam.
 * @param {unknown} value - Candidate Task projection.
 * @return {boolean} Whether the projection is exact and canonical.
 */
export function isTaskProjection(value: unknown): value is TaskProjection {
    const commonKeys = [
        'taskSeriesId',
        'courseId',
        'title',
        'size',
        'entityVersion',
    ];
    if (!hasExactDataKeys(value, [...commonKeys, 'deadline', 'occurrenceId', 'status'])
        && !hasExactDataKeys(value, [...commonKeys, 'schedule'])) {
        return false;
    }
    if (!isCanonicalUuid(value.taskSeriesId)
        || !isCanonicalUuid(value.courseId)
        || typeof value.title !== 'string'
        || value.title.length === 0
        || value.title.length > MAX_TASK_TITLE_LENGTH
        || value.title !== value.title.trim()
        || (value.size !== 'small' && value.size !== 'large')
        || !isCanonicalUnsignedSqliteInteger(value.entityVersion)
        || value.entityVersion === '0') {
        return false;
    }
    if ('schedule' in value) {
        return isCanonicalTaskSchedule(value.schedule) && value.schedule.kind === 'weekly';
    }
    if (!isCanonicalTaskDeadline(value.deadline)
        || !hasExactDataKeys(value.occurrenceId, ['taskSeriesId', 'originalLogicalAnchor'])
        || value.occurrenceId.taskSeriesId !== value.taskSeriesId
        || value.occurrenceId.originalLogicalAnchor !== 'once'
        || (value.status !== 'pending' && value.status !== 'completed')) {
        return false;
    }
    return true;
}

/**
 * Normalizes a Course-linked Task creation command.
 * @param {unknown} value - Candidate command DTO.
 * @return {CreateTaskCommand} Canonical Task creation command.
 */
export function normalizeCreateTaskCommand(value: unknown): CreateTaskCommand {
    const base = normalizeCommandBase(value, false);
    if (!hasExactDataKeys(base.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || base.intent.kind !== 'plan.create-task-series'
        || (base.intent.intentSchemaVersion !== 1 && base.intent.intentSchemaVersion !== 2)) {
        throw new TypeError('Create Task command has invalid intent');
    }
    const intentSchemaVersion = base.intent.intentSchemaVersion;
    const task = normalizeTaskFacts(base.intent.payload, false, intentSchemaVersion);
    if (task === null) {
        throw new TypeError('Create Task command has invalid Task facts');
    }
    const command = {
        commandId: base.commandId,
        followUpId: base.followUpId,
        expectedRevision: base.expectedRevision,
        expectedPlanVersion: base.expectedPlanVersion,
        intent: {
            kind: 'plan.create-task-series',
            intentSchemaVersion,
            payload: task,
        },
    };
    return command as CreateTaskCommand;
}

/**
 * Normalizes an existing Task edit command.
 * @param {unknown} value - Candidate command DTO.
 * @return {UpdateTaskCommand} Canonical Task update command.
 */
export function normalizeUpdateTaskCommand(value: unknown): UpdateTaskCommand {
    const base = normalizeCommandBase(value, true);
    if (!hasExactDataKeys(base.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || base.intent.kind !== 'plan.update-task-series'
        || (base.intent.intentSchemaVersion !== 1 && base.intent.intentSchemaVersion !== 2)) {
        throw new TypeError('Update Task command has invalid intent');
    }
    const intentSchemaVersion = base.intent.intentSchemaVersion;
    const task = normalizeTaskFacts(base.intent.payload, true, intentSchemaVersion);
    if (task === null || typeof task.taskSeriesId !== 'string') {
        throw new TypeError('Update Task command has invalid Task facts');
    }
    const payload = intentSchemaVersion === 1
        ? {
            taskSeriesId: task.taskSeriesId,
            courseId: task.courseId,
            title: task.title,
            size: task.size,
            deadline: task.deadline,
        }
        : {
            taskSeriesId: task.taskSeriesId,
            courseId: task.courseId,
            title: task.title,
            size: task.size,
            schedule: task.schedule,
        };
    const command = {
        commandId: base.commandId,
        followUpId: base.followUpId,
        expectedRevision: base.expectedRevision,
        expectedPlanVersion: base.expectedPlanVersion,
        expectedTaskSeriesVersion: base.expectedTaskSeriesVersion as string,
        intent: {
            kind: 'plan.update-task-series',
            intentSchemaVersion,
            payload,
        },
    };
    return command as UpdateTaskCommand;
}

/**
 * Normalizes a Task series deletion command.
 * @param {unknown} value - Candidate command DTO.
 * @return {DeleteTaskCommand} Canonical Task deletion command.
 */
export function normalizeDeleteTaskCommand(value: unknown): DeleteTaskCommand {
    const base = normalizeCommandBase(value, true);
    if (!hasExactDataKeys(base.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || base.intent.kind !== 'plan.delete-task-series'
        || base.intent.intentSchemaVersion !== 1
        || !hasExactDataKeys(base.intent.payload, ['taskSeriesId'])
        || !isCanonicalUuid(base.intent.payload.taskSeriesId)) {
        throw new TypeError('Delete Task command has invalid fields');
    }
    return {
        commandId: base.commandId,
        followUpId: base.followUpId,
        expectedRevision: base.expectedRevision,
        expectedPlanVersion: base.expectedPlanVersion,
        expectedTaskSeriesVersion: base.expectedTaskSeriesVersion as string,
        intent: {
            kind: 'plan.delete-task-series',
            intentSchemaVersion: 1,
            payload: { taskSeriesId: base.intent.payload.taskSeriesId },
        },
    };
}

/**
 * Normalizes the single approved status change for a once Task occurrence.
 * @param {unknown} value - Candidate command DTO.
 * @return {CompleteTaskCommand} Canonical Task completion command.
 */
export function normalizeCompleteTaskCommand(value: unknown): CompleteTaskCommand {
    const base = normalizeCommandBase(value, true);
    if (!hasExactDataKeys(base.intent, ['kind', 'intentSchemaVersion', 'payload'])
        || base.intent.kind !== 'plan.set-task-occurrence-status'
        || base.intent.intentSchemaVersion !== 1
        || !hasExactDataKeys(base.intent.payload, [
            'taskSeriesId',
            'originalLogicalAnchor',
            'status',
        ])
        || !isCanonicalUuid(base.intent.payload.taskSeriesId)
        || base.intent.payload.originalLogicalAnchor !== 'once'
        || base.intent.payload.status !== 'completed') {
        throw new TypeError('Complete Task command has invalid fields');
    }
    return {
        commandId: base.commandId,
        followUpId: base.followUpId,
        expectedRevision: base.expectedRevision,
        expectedPlanVersion: base.expectedPlanVersion,
        expectedTaskSeriesVersion: base.expectedTaskSeriesVersion as string,
        intent: {
            kind: 'plan.set-task-occurrence-status',
            intentSchemaVersion: 1,
            payload: {
                taskSeriesId: base.intent.payload.taskSeriesId,
                originalLogicalAnchor: 'once',
                status: 'completed',
            },
        },
    };
}

/**
 * Builds the shared canonical receipt projection for Task commands.
 * @param {CreateTaskCommand | UpdateTaskCommand | DeleteTaskCommand | CompleteTaskCommand} command
 * - Canonical Task command.
 * @return {CanonicalValue} Stable receipt digest projection without CommandId.
 */
function taskDigestProjection(
    command: CreateTaskCommand | UpdateTaskCommand | DeleteTaskCommand | CompleteTaskCommand,
): CanonicalValue {
    const expectedEntityVersions: CanonicalValue[] = [{
        entityKind: 'plan-state',
        entityId: 'singleton',
        version: command.expectedPlanVersion,
    }];
    if ('expectedTaskSeriesVersion' in command) {
        const taskSeriesId = command.intent.payload.taskSeriesId;
        expectedEntityVersions.push({
            entityKind: 'task-series',
            entityId: taskSeriesId,
            version: command.expectedTaskSeriesVersion,
        });
    }
    return {
        encoding: 'courseflow-canonical-json-v1',
        intent: command.intent,
        expectedRevision: command.expectedRevision,
        expectedEntityVersions,
        durableFollowUps: [{
            followUpId: command.followUpId,
            owner: 'protect',
            kind: 'backup-needed-through',
        }],
    };
}

/**
 * Builds the canonical receipt digest projection for Task creation.
 * @param {CreateTaskCommand} command - Canonical Task creation command.
 * @return {CanonicalValue} Stable receipt digest projection.
 */
export function createTaskDigestProjection(command: CreateTaskCommand): CanonicalValue {
    return taskDigestProjection(command);
}

/**
 * Builds the canonical receipt digest projection for Task edits.
 * @param {UpdateTaskCommand} command - Canonical Task update command.
 * @return {CanonicalValue} Stable receipt digest projection.
 */
export function updateTaskDigestProjection(command: UpdateTaskCommand): CanonicalValue {
    return taskDigestProjection(command);
}

/**
 * Builds the canonical receipt digest projection for Task deletion.
 * @param {DeleteTaskCommand} command - Canonical Task deletion command.
 * @return {CanonicalValue} Stable receipt digest projection.
 */
export function deleteTaskDigestProjection(command: DeleteTaskCommand): CanonicalValue {
    return taskDigestProjection(command);
}

/**
 * Builds the canonical receipt digest projection for once Task completion.
 * @param {CompleteTaskCommand} command - Canonical Task completion command.
 * @return {CanonicalValue} Stable receipt digest projection.
 */
export function completeTaskDigestProjection(command: CompleteTaskCommand): CanonicalValue {
    return taskDigestProjection(command);
}
