import type { ResolvedSetupState, SetupDialogProps } from '../SetupDialog';
import { decodeSetupDraft } from '../setup-draft';
import type { SetupDraft } from '../setup-draft';
/**
 * Selects the current editing step from formal setup facts.
 *
 * @param {ResolvedSetupState} state Current formal setup state.
 * @return {'term' | 'course' | 'activity'} Restorable editing step.
 */
export function editableStepFrom(state: ResolvedSetupState): SetupDraft['step'] {
    if (state.kind === 'term' || state.kind === 'course' || state.kind === 'activity') {
        return state.kind;
    }
    return 'holiday';
}

export const SETUP_CHECKLIST_STEPS: readonly SetupDraft['step'][] = [
    'term',
    'course',
    'activity',
    'holiday',
];

/**
 * Selects the first checklist step not yet proven by formal setup facts.
 * @param {ResolvedSetupState} state Current formal setup state.
 * @return {SetupDraft['step']} Current editable or optional checklist step.
 */
export function currentSetupChecklistStepFrom(state: ResolvedSetupState): SetupDraft['step'] {
    const minimum = state.projection.minimum;
    return !minimum.hasCurrentTerm
        ? 'term'
        : !minimum.hasCurrentTermCourse
            ? 'course'
            : !minimum.hasMeetingOrTask ? 'activity' : 'holiday';
}

/**
 * Selects bounded previous and next destinations from formal checklist facts.
 * @param {ResolvedSetupState} state Current formal setup state.
 * @param {SetupDraft['step']} activeStep Checklist step currently shown.
 * @param {boolean} blocked Whether a draft or mutation owns the editing surface.
 * @return {object} Adjacent completed/current destinations, or null at each boundary.
 */
export function setupChecklistNavigationFrom(
    state: ResolvedSetupState,
    activeStep: SetupDraft['step'],
    blocked: boolean,
): Readonly<{
    previous: SetupDraft['step'] | null;
    next: SetupDraft['step'] | null;
}> {
    if (blocked) {
        return { previous: null, next: null };
    }
    const currentStep = currentSetupChecklistStepFrom(state);
    const activeIndex = SETUP_CHECKLIST_STEPS.indexOf(activeStep);
    const currentIndex = SETUP_CHECKLIST_STEPS.indexOf(currentStep);
    if (activeIndex < 0 || activeIndex > currentIndex) {
        return { previous: null, next: null };
    }
    return {
        previous: activeIndex === 0 ? null : SETUP_CHECKLIST_STEPS[activeIndex - 1] ?? null,
        next: activeIndex === currentIndex ? null : SETUP_CHECKLIST_STEPS[activeIndex + 1] ?? null,
    };
}

/**
 * Restores a supplemental editor only when a completed setup checkpoint names it.
 * @param {ResolvedSetupState} state Current formal setup and Shell checkpoint.
 * @return {'course' | 'activity' | null} Supplemental editor to resume.
 */
export function completeEditorFrom(
    state: ResolvedSetupState,
): 'course' | 'activity' | null {
    if (state.kind !== 'complete' || state.projection.draftCheckpoint === null) {
        return null;
    }
    const restored = decodeSetupDraft(state.projection.draftCheckpoint.opaquePayload);
    return restored?.step === 'course' || restored?.step === 'activity'
        ? restored.step
        : null;
}

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

/**
 * Creates controlled input defaults without inventing any domain fact.
 *
 * @param {ResolvedSetupState} state Current formal setup state.
 * @return {SetupDraft} Empty or checkpoint-restored Shell editing model.
 */
export function initialDraftFrom(
    state: ResolvedSetupState,
    entryIntent: SetupDialogProps['entryIntent'] = 'default',
): SetupDraft {
    const restored = state.projection.draftCheckpoint === null
        ? null
        : decodeSetupDraft(state.projection.draftCheckpoint.opaquePayload);
    if (restored !== null) {
        return restored;
    }

    const currentTerm = state.projection.currentTerm;
    const currentCourse = state.projection.courses.find(course => (
        course.termId === currentTerm?.termId && !course.archived
    ));
    const startsInTaskEditor = entryIntent === 'task'
        && (state.kind === 'activity' || state.kind === 'complete');
    return {
        step: startsInTaskEditor ? 'activity' : editableStepFrom(state),
        activityKind: startsInTaskEditor ? 'task' : 'meeting',
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

/**
 * Selects the completed-setup editor without overriding a compatible saved draft.
 * @param {ResolvedSetupState} state Current formal setup and checkpoint.
 * @param {'default' | 'task'=} entryIntent Explicit Shell entry destination.
 * @return {'course' | 'activity' | null} Editor that should be visible immediately.
 */
export function completeEditorForEntry(
    state: ResolvedSetupState,
    entryIntent: SetupDialogProps['entryIntent'] = 'default',
): 'course' | 'activity' | null {
    const restoredEditor = completeEditorFrom(state);
    if (restoredEditor !== null) {
        return restoredEditor;
    }
    return state.kind === 'complete'
        && state.projection.draftCheckpoint === null
        && entryIntent === 'task'
        ? 'activity'
        : null;
}

/**
 * Aligns progress with a resumed supplemental editor or the current checklist step.
 * @param {ResolvedSetupState} state Current formal setup and checkpoint.
 * @param {'default' | 'task'=} entryIntent Explicit Shell entry destination.
 * @return {SetupDraft['step']} Checklist step whose surface is visible.
 */
export function visibleChecklistStepFrom(
    state: ResolvedSetupState,
    entryIntent: SetupDialogProps['entryIntent'],
): SetupDraft['step'] {
    return completeEditorForEntry(state, entryIntent) ?? currentSetupChecklistStepFrom(state);
}
