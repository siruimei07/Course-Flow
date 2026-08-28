/**
 * @file Task schedule, segment, and occurrence-state projections shared by commits and reads.
 */

import type {
    TaskDeadline,
    TaskOccurrenceReplacement,
    TaskOccurrenceStatus,
    TaskSchedule,
    TaskSize,
} from '../shared/workspace-task-contract';
import type { CreateTaskCommand, UpdateTaskCommand } from '../shared/workspace-task-contract';
import type { MeetingWeekday } from '../shared/workspace-course-contract';
import { firstTaskWeeklyAnchor, lastTaskWeeklyAnchor, occurrenceDate } from './anchors';
import { MEETING_WEEKDAY_NUMBERS, MILLISECONDS_PER_DAY, addLocalDateDays, localDateMilliseconds } from './local-date';
import { INTL_ZONE_RULES } from '../shared/meeting-time';

export type TaskDeadlineColumns = readonly [
    TaskDeadline['kind'],
    string | null,
    string | null,
    string | null,
];

export type TaskScheduleColumns = readonly [
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

export function taskDeadlineColumns(deadline: TaskDeadline): TaskDeadlineColumns {
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
export function taskScheduleColumns(schedule: TaskSchedule): TaskScheduleColumns {
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

export function taskDeadlineProjection(
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

export type StoredTaskSchedule = Readonly<{
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

export type StoredTaskSegment = StoredTaskSchedule & Readonly<{
    task_segment_id: string;
    title: string;
    task_size: TaskSize;
    logical_start_anchor: string;
    logical_end_anchor: string;
}>;

export type StoredTaskOccurrenceState = Readonly<{
    original_logical_anchor: string;
    status: TaskOccurrenceStatus;
    self_reported_progress: bigint | null;
    entity_version: bigint;
}>;

export type StoredTaskOccurrenceOverride = Readonly<{
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
export function taskOccurrenceStateProjection(
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
export function taskOverrideReplacement(
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
export function taskSegmentForAnchor(
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
export function taskSegmentOccurrenceDeadline(
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
export function taskScheduleProjection(row: StoredTaskSchedule): TaskSchedule {
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
export function taskSchedule(
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
export function taskLogicalAnchors(schedule: TaskSchedule): readonly [string, string] {
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
