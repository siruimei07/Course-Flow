import type { ResolvedSetupState } from '../SetupDialog';
import { decodeSetupDraft } from '../setup-draft';
import type { SetupDraft } from '../setup-draft';

/**
 * Counts only HolidayRange facts owned by the Current Term.
 * @param {ResolvedSetupState['projection']} projection Formal Setup projection.
 * @return {number} Current Term HolidayRange count.
 */
export function currentTermHolidayCount(
    projection: ResolvedSetupState['projection'],
): number {
    const currentTermId = projection.currentTerm?.termId;
    return currentTermId === undefined
        ? 0
        : projection.holidayRanges.filter(range => range.termId === currentTermId).length;
}

export type CurrentTermFacts = Readonly<{
    courseCount: number;
    meetingCount: number;
    taskCount: number;
    holidayCount: number;
}>;

/**
 * Counts the optional Current Term facts that first setup no longer requires.
 *
 * @param {ResolvedSetupState['projection']} projection Formal Setup projection.
 * @return {CurrentTermFacts} Counts owned by the Current Term.
 */
export function currentTermFacts(
    projection: ResolvedSetupState['projection'],
): CurrentTermFacts {
    const currentTermId = projection.currentTerm?.termId;
    const courses = projection.courses.filter(course => (
        course.termId === currentTermId && !course.archived
    ));
    const courseIds = new Set(courses.map(course => course.courseId));
    return {
        courseCount: courses.length,
        meetingCount: courses.reduce((total, course) => total + course.meetings.length, 0),
        taskCount: projection.tasks.filter(task => courseIds.has(task.courseId)).length,
        holidayCount: currentTermHolidayCount(projection),
    };
}

/**
 * Creates controlled input defaults without inventing any domain fact.
 *
 * @param {ResolvedSetupState} state Current formal setup state.
 * @return {SetupDraft} Empty or checkpoint-restored Shell editing model.
 */
export function initialDraftFrom(state: ResolvedSetupState): SetupDraft {
    const restored = state.projection.draftCheckpoint === null
        ? null
        : decodeSetupDraft(state.projection.draftCheckpoint.opaquePayload);
    if (restored !== null) {
        return restored;
    }

    return emptyDraftFrom(state);
}

/**
 * Creates the same controlled defaults without consulting the first-setup checkpoint.
 *
 * Management editors are opened deliberately for one surface, so they never restore
 * the checkpoint that only first setup owns.
 *
 * @param {ResolvedSetupState} state Current formal setup state.
 * @return {SetupDraft} Empty Shell editing model.
 */
export function emptyDraftFrom(state: ResolvedSetupState): SetupDraft {
    const currentTerm = state.projection.currentTerm;
    const currentCourse = state.projection.courses.find(course => (
        course.termId === currentTerm?.termId && !course.archived
    ));
    return {
        step: currentTerm === null ? 'term' : 'course',
        activityKind: 'meeting',
        term: {
            name: '',
            startDate: '',
            endDate: '',
            timeZone: '',
        },
        course: {
            code: '',
            name: '',
            section: '',
            instructor: '',
            color: '',
            credits: '',
            teachingStartDate: currentTerm?.startDate ?? '',
            teachingEndDate: currentTerm?.endDate ?? '',
        },
        meeting: {
            courseId: currentCourse?.courseId ?? '',
            meetingType: 'LEC',
            weekday: 'MON',
            localStart: '',
            localEnd: '',
            endDayOffset: 0,
            effectiveStartDate: currentCourse?.teachingRange.startDate ?? currentTerm?.startDate ?? '',
            effectiveEndDate: currentCourse?.teachingRange.endDate ?? currentTerm?.endDate ?? '',
            locationKind: 'known',
            locationValue: '',
        },
        task: {
            courseId: currentCourse?.courseId ?? '',
            title: '',
            size: 'small',
            scheduleKind: 'once',
            deadlineKind: 'tba',
            deadlineDate: '',
            deadlineTime: '',
            weeklyStartDate: currentCourse?.teachingRange.startDate ?? currentTerm?.startDate ?? '',
            weeklyWeekday: 'MON',
            weeklyDeadlineTime: '',
            weeklyEndDate: currentCourse?.teachingRange.endDate ?? currentTerm?.endDate ?? '',
            followTeachingWeek: false,
        },
        holiday: {
            name: '',
            startDate: '',
            endDate: '',
        },
    };
}
