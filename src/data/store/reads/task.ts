import { readActiveHolidayRanges } from '../conflict-reads';
import { currentVersions } from '../context';
import type { StoreContext } from '../context';
import { freezeEmptyTuple, freezeTuple } from '../results';
import { occurrenceDate } from '../../../plan/anchors';
import { taskOccurrenceConfirmationToken } from '../../../plan/confirmation-tokens';
import { addLocalDateDays } from '../../../plan/local-date';
import { StoredTaskOccurrenceOverride, StoredTaskOccurrenceState, StoredTaskSegment, taskDeadlineProjection, taskOccurrenceStateProjection, taskOverrideReplacement, taskScheduleProjection, taskSegmentForAnchor, taskSegmentOccurrenceDeadline } from '../../../plan/task-schedule';
import { INTL_ZONE_RULES } from '../../../shared/meeting-time';
import { isCanonicalUuid } from '../../../shared/workspace-data-contract';
import { TaskOccurrenceImpactDraft, TaskOccurrenceWindow, deriveTaskOccurrenceId, normalizeTaskOccurrenceImpactDraft, normalizeTaskOccurrenceWindow } from '../../../shared/workspace-task-contract';
import type { OnceTaskOccurrenceProjection, TaskOccurrenceImpactProjection, TaskOccurrenceProjection, TaskSeriesDetailProjection, WeeklyTaskOccurrenceProjection } from '../../../shared/workspace-task-contract';
/**
 * Reads one bounded Task series projection without storing ordinary weekly occurrences.
 * @param {string} taskSeriesId - Stable Task series identity.
 * @param {TaskOccurrenceWindow} candidateWindow - Requested inclusive LocalDate window.
 * @return {TaskSeriesDetailProjection} Revision-bound Task rule and derived occurrences.
 */
export function readTaskSeriesDetail(ctx: StoreContext, 
    taskSeriesId: string,
    candidateWindow: TaskOccurrenceWindow,
): TaskSeriesDetailProjection {
    ctx.requireOpen();
    if (!isCanonicalUuid(taskSeriesId)) {
        throw new TypeError('TaskSeriesId must be a canonical UUID');
    }
    const requestedWindow = normalizeTaskOccurrenceWindow(candidateWindow);

    try {
        ctx.database.exec('SAVEPOINT read_task_series_detail');
        const seriesStatement = ctx.database.prepare(`
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

        const segmentStatement = ctx.database.prepare(`
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
        const overrideStatement = ctx.database.prepare(`
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
        const stateStatement = ctx.database.prepare(`
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
            const holidayRanges = readActiveHolidayRanges(ctx.database, series.term_id);
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
        ctx.database.exec('RELEASE SAVEPOINT read_task_series_detail');
        return projection;
    }
    catch (error) {
        ctx.rollbackOrRequireReopen();
        throw error;
    }
}

/**
 * Previews and version-binds a Task this-and-future rule change or deletion without writing.
 * @param {TaskOccurrenceImpactDraft} candidate - Untrusted exact future mutation draft.
 * @return {TaskOccurrenceImpactProjection} Current and proposed bounded occurrence facts.
 */
export function previewTaskOccurrenceChange(ctx: StoreContext, 
    candidate: TaskOccurrenceImpactDraft,
): TaskOccurrenceImpactProjection {
    ctx.requireOpen();
    const draft = normalizeTaskOccurrenceImpactDraft(candidate);
    const detail = readTaskSeriesDetail(ctx, draft.taskSeriesId, draft.requestedWindow);
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
        ctx.database.exec('BEGIN');
        const versions = currentVersions(ctx.database);
        const seriesStatement = ctx.database.prepare(`
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
                ? readActiveHolidayRanges(ctx.database, series.term_id)
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
        ctx.database.exec('COMMIT');
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
        ctx.rollbackOrRequireReopen();
        throw error;
    }
}
