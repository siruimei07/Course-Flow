/**
 * @file Aggregated public surface of the plan contract.
 */

export {
    type AgendaConflictWarning,
    type AgendaHolidayRangeProjection,
    type AgendaItemProjection,
    type AgendaProjection,
    type CalendarHolidaySegmentProjection,
    type CalendarWindowProjection,
    type MeetingTimeClassification,
    type NextTaskProjection,
    type PlanAttendanceAvailability,
    type PlanAttendanceProjection,
    type PlanEvaluationContext,
    type PlanMeetingProjection,
    type PlanMeetingSource,
    type PlanNextTaskProjection,
    type PlanProjection,
    type PlanProjectionSource,
    type PlanTaskProjection,
    type PlanTaskSource,
    type TaskTimeClassification,
    type TbaProjection,
    type TermProgressProjection,
    type TodaySummaryProjection,
    buildPlanProjection,
    calculateTermProgress,
    classifyMeetingOccurrence,
    classifyTaskOccurrence,
    createPlanEvaluationContext,
    selectNextTaskOccurrence,
} from './workspace-plan-contract/types';

export {
    isPlanProjection,
} from './workspace-plan-contract/guards';
