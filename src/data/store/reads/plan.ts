import type { StoreContext } from '../context';
import { readMeetingSeriesDetail } from './meeting';
import { createTaskSeriesDetailReader } from './task';
import type { ReadSnapshotOptions } from '../types';
import { planOccurrenceWindows } from '../../../plan/anchors';
import type { HolidayRangeProjection } from '../../../shared/workspace-holiday-contract';
import type { PlanMeetingSource, PlanProjectionSource, PlanTaskSource } from '../../../shared/workspace-plan-contract';
import type { TermProjection } from '../../../shared/workspace-term-contract';
/**
 * Reads all facts required for unified PLAN projections from one snapshot.
 * @param {ReadSnapshotOptions} options - Optional deterministic snapshot seam.
 * @return {PlanProjectionSource} Current-Term facts bound to one revision.
 */
export function readPlanProjectionSource(ctx: StoreContext, options: ReadSnapshotOptions = {}): PlanProjectionSource {
    ctx.requireOpen();
    try {
        ctx.database.exec('BEGIN');
        const stateStatement = ctx.database.prepare(`
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

        const termStatement = ctx.database.prepare(`
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

        const taskSeriesRows = ctx.database.prepare(`
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
        const readTaskSeriesDetail = createTaskSeriesDetailReader(ctx);
        for (const row of taskSeriesRows) {
            for (const requestedWindow of requestedWindows) {
                const detail = readTaskSeriesDetail(row.task_series_id, requestedWindow);
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

        const meetingSeriesRows = ctx.database.prepare(`
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
                const detail = readMeetingSeriesDetail(ctx, row.meeting_series_id, requestedWindow);
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

        const holidayStatement = ctx.database.prepare(`
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
        ctx.database.exec('COMMIT');
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
        ctx.rollbackOrRequireReopen();
        throw error;
    }
}
