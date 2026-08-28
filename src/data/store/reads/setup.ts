import type { StoreContext } from '../context';
import { decimalFromCoefficient } from '../database';
import type { ReadSnapshotOptions, WorkspaceSetupSnapshot } from '../types';
import { meetingTypeName } from '../../../plan/meeting-occurrences';
import { StoredTaskSchedule, taskOccurrenceStateProjection, taskOverrideReplacement, taskScheduleProjection } from '../../../plan/task-schedule';
import type { MeetingEndDayOffset } from '../../../shared/meeting-time';
import { CourseColor, MeetingEffectiveRangeIntent, MeetingTypeCode } from '../../../shared/workspace-course-contract';
import type { CourseTeachingRangeIntent, MeetingWeekday } from '../../../shared/workspace-course-contract';
import { TaskDeadline, TaskOccurrenceStatus, deriveTaskOccurrenceId } from '../../../shared/workspace-task-contract';
import type { TaskSize } from '../../../shared/workspace-task-contract';
import type { SetupDraftCheckpoint, SetupProjection } from '../../../shared/workspace-term-contract';
export function readWorkspaceSetupSnapshot(ctx: StoreContext, 
    options: ReadSnapshotOptions = {},
): WorkspaceSetupSnapshot {
    ctx.requireOpen();
    try {
        ctx.database.exec('BEGIN');
        const revisionStatement = ctx.database.prepare(
            'SELECT revision FROM workspace_state WHERE singleton = 1',
        );
        revisionStatement.setReadBigInts(true);
        const revision = (revisionStatement.get() as { revision: bigint }).revision;
        options.failpoint?.('read.after-revision');

        const setupStatement = ctx.database.prepare(`
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
        ctx.database.exec('COMMIT');

        return Object.freeze({
            revision: revision.toString(),
            setup: Object.freeze({
                workspaceId: setup.workspace_id,
                lastDecision: setup.last_decision,
                entityVersion: setup.setup_decision_version.toString(),
            }),
        });
    } catch (error) {
        ctx.rollbackOrRequireReopen();
        throw error;
    }
}

export function readSetupProjection(ctx: StoreContext, options: ReadSnapshotOptions = {}): SetupProjection {
    ctx.requireOpen();
    try {
        ctx.database.exec('BEGIN');
        const state = ctx.database.prepare(`
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

        const termsStatement = ctx.database.prepare(`
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

        const holidayStatement = ctx.database.prepare(`
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

        const courseStatement = ctx.database.prepare(`
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
        const meetingStatement = ctx.database.prepare(`
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

        const taskStatement = ctx.database.prepare(`
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
        ctx.database.exec('COMMIT');

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
        ctx.rollbackOrRequireReopen();
        throw error;
    }
}
