/**
 * @file Renders and persists the interruptible first-setup editing flow.
 */

import {
    useEffect,
    useReducer,
    useRef,
    useState,
    type FormEvent,
    type KeyboardEvent,
    type RefObject,
} from 'react';

import {
    normalizeCreateCourseCommand,
    normalizeCreateMeetingSeriesCommand,
    type CreateCourseCommand,
    type CreateMeetingSeriesCommand,
    type CourseColor,
    type MeetingTypeCode,
    type MeetingWeekday,
} from '../shared/workspace-course-contract';
import {
    normalizeCreateHolidayRangeCommand,
    type CreateHolidayRangeCommand,
} from '../shared/workspace-holiday-contract';
import { INTL_ZONE_RULES } from '../shared/meeting-time';
import type {
    WorkspaceSetupOutcome,
    WorkspaceSetupProblem,
} from '../shared/workspace-setup-contract';
import { normalizeCreateTaskCommand, type CreateTaskCommand } from '../shared/workspace-task-contract';
import { normalizeCreateTermCommand, type CreateTermCommand } from '../shared/workspace-term-contract';
import {
    decodeSetupDraft,
    encodeSetupDraft,
    type CourseDraft,
    type HolidayDraft,
    type MeetingDraft,
    type SetupDraft,
    type TaskDraft,
    type TermDraft,
} from './setup-draft';
import { setupStateFrom, type SetupState } from './setup-state';

export type ResolvedSetupState = Exclude<
    SetupState,
    Readonly<{ kind: 'loading' }> | Readonly<{ kind: 'problem'; message: string }>
>;

export type SetupDialogProps = Readonly<{
    entryIntent?: 'default' | 'task';
    open: boolean;
    state: ResolvedSetupState;
    onProjection(state: ResolvedSetupState): void;
    onClose(destination: 'current' | 'today'): void;
}>;

type SetupCheckpointTarget = Readonly<{
    schemaVersion: 1;
    opaquePayload: string;
}> | null;

export type PendingSetupMutation =
    | Readonly<{ kind: 'term'; command: CreateTermCommand }>
    | Readonly<{ kind: 'course'; command: CreateCourseCommand }>
    | Readonly<{ kind: 'meeting'; command: CreateMeetingSeriesCommand }>
    | Readonly<{ kind: 'task'; command: CreateTaskCommand }>
    | Readonly<{ kind: 'holiday'; command: CreateHolidayRangeCommand }>;

export type PendingSetupMutationState = Readonly<{
    pending: PendingSetupMutation | null;
}>;

export type PendingSetupMutationEvent =
    | Readonly<{ kind: 'retain-unknown'; pending: PendingSetupMutation }>
    | Readonly<{ kind: 'resolved' }>
    | Readonly<{
        kind: 'exit-attempted' | 'branch-switch-attempted' | 'projection-advanced';
    }>;

export type SetupMutationRetryPort = Readonly<{
    createTerm(command: CreateTermCommand): Promise<WorkspaceSetupOutcome>;
    createCourse(command: CreateCourseCommand): Promise<WorkspaceSetupOutcome>;
    createMeetingSeries(command: CreateMeetingSeriesCommand): Promise<WorkspaceSetupOutcome>;
    createTask(command: CreateTaskCommand): Promise<WorkspaceSetupOutcome>;
    createHolidayRange(command: CreateHolidayRangeCommand): Promise<WorkspaceSetupOutcome>;
}>;

/**
 * Retains one ambiguous mutation across UI-only boundaries until Workspace resolves it.
 * @param {PendingSetupMutationState} state Current unresolved Setup request.
 * @param {PendingSetupMutationEvent} event Mutation result or attempted UI boundary.
 * @return {PendingSetupMutationState} Lifecycle state with exact command identity preserved.
 */
export function reducePendingSetupMutation(
    state: PendingSetupMutationState,
    event: PendingSetupMutationEvent,
): PendingSetupMutationState {
    if (event.kind === 'retain-unknown') {
        return { pending: event.pending };
    }
    return event.kind === 'resolved' ? { pending: null } : state;
}

/**
 * Retries the exact retained Setup command through its original Workspace mutation.
 * @param {PendingSetupMutation} pending Ambiguous request including original command IDs.
 * @param {SetupMutationRetryPort} port Bounded Setup mutation bridge.
 * @return {Promise<WorkspaceSetupOutcome>} Correlated Workspace result for that same command.
 */
export function retryPendingSetupMutation(
    pending: PendingSetupMutation,
    port: SetupMutationRetryPort,
): Promise<WorkspaceSetupOutcome> {
    switch (pending.kind) {
        case 'term':
            return port.createTerm(pending.command);
        case 'course':
            return port.createCourse(pending.command);
        case 'meeting':
            return port.createMeetingSeries(pending.command);
        case 'task':
            return port.createTask(pending.command);
        case 'holiday':
            return port.createHolidayRange(pending.command);
    }
}

const COURSE_COLOR_NAMES: Readonly<Record<CourseColor, string>> = {
    red: '红色',
    orange: '橙色',
    yellow: '黄色',
    green: '绿色',
    blue: '蓝色',
    purple: '紫色',
    gray: '灰色',
};

const WEEKDAY_NAMES: Readonly<Record<MeetingWeekday, string>> = {
    MON: '星期一',
    TUE: '星期二',
    WED: '星期三',
    THU: '星期四',
    FRI: '星期五',
    SAT: '星期六',
    SUN: '星期日',
};

/**
 * Describes a failed Setup mutation without guessing whether a sent request committed.
 * @param {WorkspaceSetupProblem} problem Structured Workspace mutation problem.
 * @param {string} unchangedStatement Exact statement for a known unchanged result.
 * @return {string} User-facing status that preserves the problem's data-effect truth.
 */
export function setupMutationProblemMessage(
    problem: WorkspaceSetupProblem,
    unchangedStatement: string,
): string {
    return problem.dataEffect === 'unknown'
        ? `${problem.message} 结果尚无法确认；全部输入、草稿和本次请求仍保留，请重试或重新打开设置核对。`
        : `${problem.message} ${unchangedStatement}`;
}

/**
 * Checks whether a correlated Setup projection proves the requested checkpoint state.
 * @param {WorkspaceSetupOutcome} outcome Candidate direct response or reconciliation query.
 * @param {string} expectedVersion Version observed before the checkpoint mutation.
 * @param {SetupCheckpointTarget} expectedCheckpoint Exact saved payload, or null after discard.
 * @return {boolean} Whether the projection proves the requested checkpoint state.
 */
export function setupCheckpointMatches(
    outcome: WorkspaceSetupOutcome,
    expectedVersion: string,
    expectedCheckpoint: SetupCheckpointTarget,
): boolean {
    if (!outcome.ok || outcome.value.kind !== 'workspace.setup-projection') {
        return false;
    }
    const projection = outcome.value.projection;
    if (BigInt(projection.draftCheckpointVersion) <= BigInt(expectedVersion)) {
        return false;
    }
    if (expectedCheckpoint === null) {
        return projection.draftCheckpoint === null;
    }
    return projection.draftCheckpoint?.schemaVersion === expectedCheckpoint.schemaVersion
        && projection.draftCheckpoint.opaquePayload === expectedCheckpoint.opaquePayload;
}

/**
 * Requeries checkpoint truth only when a sent mutation did not prove its own result.
 * @param {WorkspaceSetupOutcome | null} outcome Direct response, or null after transport rejection.
 * @param {string} expectedVersion Version observed before the checkpoint mutation.
 * @param {SetupCheckpointTarget} expectedCheckpoint Exact saved payload, or null after discard.
 * @param {Function} querySetup Bounded read used to reconcile persisted checkpoint truth.
 * @return {Promise<WorkspaceSetupOutcome | null>} Projection proving the target, or null.
 */
export async function reconcileSetupCheckpoint(
    outcome: WorkspaceSetupOutcome | null,
    expectedVersion: string,
    expectedCheckpoint: SetupCheckpointTarget,
    querySetup: () => Promise<WorkspaceSetupOutcome>,
): Promise<WorkspaceSetupOutcome | null> {
    if (outcome !== null && setupCheckpointMatches(outcome, expectedVersion, expectedCheckpoint)) {
        return outcome;
    }
    if (outcome !== null
        && !outcome.ok
        && outcome.problem.dataEffect === 'unchanged'
        && outcome.problem.code !== 'conflict') {
        return null;
    }
    try {
        const queriedOutcome = await querySetup();
        return setupCheckpointMatches(queriedOutcome, expectedVersion, expectedCheckpoint)
            ? queriedOutcome
            : null;
    }
    catch {
        return null;
    }
}

/**
 * Selects the current editing step from formal setup facts.
 *
 * @param {ResolvedSetupState} state Current formal setup state.
 * @return {'term' | 'course' | 'activity'} Restorable editing step.
 */
function editableStepFrom(state: ResolvedSetupState): SetupDraft['step'] {
    if (state.kind === 'term' || state.kind === 'course' || state.kind === 'activity') {
        return state.kind;
    }
    return 'holiday';
}

const SETUP_CHECKLIST_STEPS: readonly SetupDraft['step'][] = [
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
function currentSetupChecklistStepFrom(state: ResolvedSetupState): SetupDraft['step'] {
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
function completeEditorFrom(
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
function currentTermHolidayCount(
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
function initialDraftFrom(
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
function completeEditorForEntry(
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
function visibleChecklistStepFrom(
    state: ResolvedSetupState,
    entryIntent: SetupDialogProps['entryIntent'],
): SetupDraft['step'] {
    return completeEditorForEntry(state, entryIntent) ?? currentSetupChecklistStepFrom(state);
}

/**
 * Moves focus to a newly rendered textual problem.
 *
 * @param {React.RefObject<HTMLElement | null>} target Problem status ref.
 * @return {void}
 */
function focusStatus(target: Readonly<{ current: HTMLElement | null }>): void {
    globalThis.requestAnimationFrame(() => target.current?.focus());
}

export type SetupFieldErrors = Readonly<Record<string, string>>;

export type SetupSemanticFailure =
    | Readonly<{ kind: 'term'; draft: TermDraft }>
    | Readonly<{ kind: 'course'; draft: CourseDraft }>
    | Readonly<{ kind: 'meeting'; draft: MeetingDraft }>
    | Readonly<{ kind: 'task'; draft: TaskDraft }>
    | Readonly<{ kind: 'holiday'; draft: HolidayDraft }>;

const TERM_NATIVE_FIELD_MESSAGES = {
    'term-name': '请输入学期名称。',
    'term-start-date': '请选择有效的学期开始日期。',
    'term-end-date': '结束日期不能早于开始日期。',
    'term-time-zone': '请输入 IANA 时区名称。',
} as const;

const COURSE_NATIVE_FIELD_MESSAGES = {
    'course-code': '请输入课程代码。',
    'course-name': '请输入课程名称。',
    'course-credits': '学分格式或数值范围无效；请使用例如 3 或 0.5 的非负十进制数。',
    'course-teaching-start': '课程教学开始日期必须在当前学期范围内。',
    'course-teaching-end': '课程教学结束日期不能早于开始日期，且必须在当前学期范围内。',
} as const;

const MEETING_NATIVE_FIELD_MESSAGES = {
    'meeting-course': '请选择一门当前课程。',
    'meeting-type': '请选择课节类型。',
    'meeting-weekday': '请选择课节星期。',
    'meeting-start': '请输入有效的课节开始时间。',
    'meeting-end': '请输入有效的课节结束时间。',
    'meeting-effective-start': '课节生效开始日期必须在课程教学范围内。',
    'meeting-effective-end': '课节生效结束日期不能早于开始日期，且必须在课程教学范围内。',
    'meeting-location': '请输入已知地点，或选择 TBA。',
} as const;

const TASK_NATIVE_FIELD_MESSAGES = {
    'task-course': '请选择一门当前课程。',
    'task-title': '请输入任务标题。',
    'task-deadline-date': '任务截止日期必须在课程教学范围内。',
    'task-deadline-time': '请输入有效的任务截止时间。',
    'task-weekly-start': '每周任务开始日期必须在课程教学范围内。',
    'task-weekly-deadline-time': '请输入有效的每周截止时间。',
    'task-weekly-end': '确认结束日期不能早于开始日期，且必须在课程教学范围内。',
} as const;

const HOLIDAY_NATIVE_FIELD_MESSAGES = {
    'holiday-name': '请输入假期名称。',
    'holiday-start-date': '假期开始日期必须在当前学期范围内。',
    'holiday-end-date': '假期结束日期不能早于开始日期，且必须在当前学期范围内。',
} as const;

/**
 * Checks an optional credits value through the shared Course command normalizer.
 * @param {string} credits Controlled credits text.
 * @return {boolean} Whether the shared normalizer accepts the value.
 */
function courseCreditsAreAccepted(credits: string): boolean {
    try {
        normalizeCreateCourseCommand({
            commandId: '00000000-0000-4000-8000-000000000001',
            followUpId: '00000000-0000-4000-8000-000000000002',
            expectedRevision: '0',
            expectedPlanVersion: '0',
            intent: {
                kind: 'plan.create-course',
                intentSchemaVersion: 1,
                payload: {
                    course: {
                        code: 'VALID',
                        name: 'Valid course',
                        section: null,
                        instructor: null,
                        color: null,
                        credits: credits.trim() || null,
                        teachingRange: { kind: 'inherit-term' },
                    },
                },
            },
        });
        return true;
    }
    catch {
        return false;
    }
}

/**
 * Merges native and semantic failures in the form's visual field order.
 * @param {Readonly<Record<string, string>>} fieldOrder Ordered field message catalog.
 * @param {readonly SetupFieldErrors[]} groups Independently detected errors.
 * @return {SetupFieldErrors} One ordered error map for rendering and focus.
 */
function combineSetupFieldErrors(
    fieldOrder: Readonly<Record<string, string>>,
    ...groups: readonly SetupFieldErrors[]
): SetupFieldErrors {
    const combined = Object.assign({}, ...groups) as Record<string, string>;
    const ordered: Record<string, string> = {};
    Object.keys(fieldOrder).forEach(name => {
        if (combined[name] !== undefined) {
            ordered[name] = combined[name];
        }
    });
    Object.entries(combined).forEach(([name, message]) => {
        if (ordered[name] === undefined) {
            ordered[name] = message;
        }
    });
    return ordered;
}

/**
 * Locates non-native or cross-field failures after a shared normalizer rejects a Setup draft.
 * The returned explanations are presentation only; the shared normalizer remains authoritative.
 * @param {SetupSemanticFailure} failure Rejected form kind and retained controlled input.
 * @return {SetupFieldErrors} Specific errors in visual field order.
 */
export function setupSemanticFailureErrors(failure: SetupSemanticFailure): SetupFieldErrors {
    const errors: Record<string, string> = {};
    switch (failure.kind) {
        case 'term': {
            if (failure.draft.name.length > 0 && failure.draft.name.trim().length === 0) {
                errors['term-name'] = '学期名称不能只包含空格。';
            }
            if (failure.draft.startDate.length > 0
                && failure.draft.endDate.length > 0
                && failure.draft.endDate < failure.draft.startDate) {
                errors['term-end-date'] = '结束日期不能早于开始日期。';
            }
            if (failure.draft.timeZone.length > 0) {
                try {
                    new Intl.DateTimeFormat('en-CA', {
                        timeZone: failure.draft.timeZone,
                    }).resolvedOptions();
                }
                catch {
                    errors['term-time-zone'] = '请输入有效的 IANA 时区，例如 America/Toronto。';
                }
            }
            break;
        }
        case 'course':
            if (failure.draft.code.length > 0 && failure.draft.code.trim().length === 0) {
                errors['course-code'] = '课程代码不能只包含空格。';
            }
            if (failure.draft.name.length > 0 && failure.draft.name.trim().length === 0) {
                errors['course-name'] = '课程名称不能只包含空格。';
            }
            if (!courseCreditsAreAccepted(failure.draft.credits)) {
                errors['course-credits'] = '学分格式或数值范围无效；请使用例如 3 或 0.5 的非负十进制数。';
            }
            if (failure.draft.teachingStartDate.length > 0
                && failure.draft.teachingEndDate.length > 0
                && failure.draft.teachingEndDate < failure.draft.teachingStartDate) {
                errors['course-teaching-end'] = '课程教学结束日期不能早于开始日期。';
            }
            break;
        case 'meeting':
            if (failure.draft.localStart.length > 0
                && failure.draft.localEnd.length > 0
                && failure.draft.endDayOffset === 0
                && failure.draft.localEnd <= failure.draft.localStart) {
                errors['meeting-end'] = '同日课节的结束时间必须晚于开始时间。';
            }
            if (failure.draft.effectiveStartDate.length > 0
                && failure.draft.effectiveEndDate.length > 0
                && failure.draft.effectiveEndDate < failure.draft.effectiveStartDate) {
                errors['meeting-effective-end'] = '课节生效结束日期不能早于开始日期。';
            }
            if (failure.draft.locationKind === 'known'
                && failure.draft.locationValue.length > 0
                && failure.draft.locationValue.trim().length === 0) {
                errors['meeting-location'] = '已知地点不能只包含空格；地点未知时请选择 TBA。';
            }
            break;
        case 'task':
            if (failure.draft.title.length > 0 && failure.draft.title.trim().length === 0) {
                errors['task-title'] = '任务标题不能只包含空格。';
            }
            if (failure.draft.scheduleKind === 'weekly'
                && failure.draft.weeklyStartDate.length > 0
                && failure.draft.weeklyEndDate.length > 0
                && failure.draft.weeklyEndDate < failure.draft.weeklyStartDate) {
                errors['task-weekly-end'] = '每周任务的确认结束日期不能早于开始日期。';
            }
            break;
        case 'holiday':
            if (failure.draft.name.length > 0 && failure.draft.name.trim().length === 0) {
                errors['holiday-name'] = '假期名称不能只包含空格。';
            }
            if (failure.draft.startDate.length > 0
                && failure.draft.endDate.length > 0
                && failure.draft.endDate < failure.draft.startDate) {
                errors['holiday-end-date'] = '假期结束日期不能早于开始日期。';
            }
            break;
    }
    return errors;
}

/**
 * Converts existing HTML constraint validity into adjacent localized field messages.
 * @param {Pick<HTMLFormElement, 'elements'>} form Submitted form whose constraints own native checks.
 * @param {Readonly<Record<string, string>>} messages Field-specific localized explanations.
 * @return {SetupFieldErrors} Invalid controls in form message order.
 */
export function setupNativeFieldErrors(
    form: Pick<HTMLFormElement, 'elements'>,
    messages: Readonly<Record<string, string>>,
): SetupFieldErrors {
    const errors: Record<string, string> = {};
    Object.entries(messages).forEach(([name, message]) => {
        const control = form.elements.namedItem(name);
        const validity = control === null ? null : Reflect.get(control, 'validity');
        if (typeof validity === 'object'
            && validity !== null
            && Reflect.get(validity, 'valid') === false) {
            errors[name] = message;
        }
    });
    return errors;
}

/**
 * Associates one controlled field with its persistent hint and current error.
 * @param {string} name Stable form control name.
 * @param {SetupFieldErrors} errors Current field errors.
 * @param {readonly string[]} descriptionIds Existing non-error descriptions.
 * @return {object} React ARIA attributes for the control.
 */
export function setupFieldErrorAttributes(
    name: string,
    errors: SetupFieldErrors,
    descriptionIds: readonly string[] = [],
): Readonly<{
    'aria-describedby': string | undefined;
    'aria-invalid': true | undefined;
}> {
    const hasError = errors[name] !== undefined;
    const describedBy = hasError
        ? [...descriptionIds, `${name}-error`]
        : descriptionIds;
    return {
        'aria-describedby': describedBy.length === 0 ? undefined : describedBy.join(' '),
        'aria-invalid': hasError ? true : undefined,
    };
}

/**
 * Focuses the first invalid named control after React has rendered its description.
 * @param {Pick<HTMLFormElement, 'elements'> | null} form Submitted form.
 * @param {SetupFieldErrors} errors Ordered field errors.
 * @return {void}
 */
export function focusFirstSetupFieldError(
    form: Pick<HTMLFormElement, 'elements'> | null,
    errors: SetupFieldErrors,
): void {
    const name = Object.keys(errors)[0];
    if (form === null || name === undefined) {
        return;
    }
    globalThis.requestAnimationFrame(() => {
        const control = form.elements.namedItem(name);
        const focus = control === null ? null : Reflect.get(control, 'focus');
        if (typeof focus === 'function') {
            focus.call(control);
        }
    });
}

/**
 * Renders one localized field error next to its associated control.
 * @param {object} props Stable field name and current errors.
 * @return {JSX.Element | null} Focusable description or no element while valid.
 */
export function SetupFieldError(props: Readonly<{
    errors: SetupFieldErrors;
    name: string;
}>) {
    const message = props.errors[props.name];
    return message === undefined ? null : (
        <small
            className="field-error"
            id={`${props.name}-error`}
            tabIndex={-1}
        >{message}</small>
    );
}

/**
 * Renders the modal setup flow and saves Shell drafts before every explicit exit.
 *
 * @param {SetupDialogProps} props Setup state and lifecycle callbacks.
 * @return {JSX.Element} Native modal dialog.
 */
export function SetupDialog(props: SetupDialogProps) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const setupWorkspaceRef = useRef<HTMLElement>(null);
    const statusRef = useRef<HTMLParagraphElement>(null);
    const completionHeadingRef = useRef<HTMLHeadingElement>(null);
    const isDirty = useRef(false);
    const readOnly = props.state.dataMode === 'read-only';
    const [draft, setDraft] = useState<SetupDraft>(() => initialDraftFrom(props.state, props.entryIntent));
    const [checkpointMessage, setCheckpointMessage] = useState(readOnly
        ? '只读模式；可以查看现有设置和草稿，但不能更改或丢弃。'
        : '未提交输入会保存为本地草稿。');
    const [savingCheckpoint, setSavingCheckpoint] = useState(false);
    const [commandBusy, setCommandBusy] = useState(false);
    const [pendingMutationState, dispatchPendingMutation] = useReducer(
        reducePendingSetupMutation,
        { pending: null },
    );
    const [completeEditor, setCompleteEditor] = useState<'course' | 'activity' | null>(() => (
        completeEditorForEntry(props.state, props.entryIntent)
    ));
    const [activeChecklistStep, setActiveChecklistStep] = useState<SetupDraft['step']>(() => (
        visibleChecklistStepFrom(props.state, props.entryIntent)
    ));
    const pendingMutation = pendingMutationState.pending;
    const hasPendingMutation = pendingMutation !== null;
    const checkpoint = props.state.projection.draftCheckpoint;
    const checkpointIsIncompatible = checkpoint !== null
        && decodeSetupDraft(checkpoint.opaquePayload) === null;
    const hasUncommittedDraft = isDirty.current || (checkpoint !== null
        && !checkpointIsIncompatible);
    const currentChecklistStep = currentSetupChecklistStepFrom(props.state);
    const reviewingChecklistStep = completeEditor !== null
        || activeChecklistStep === currentChecklistStep
        ? null
        : activeChecklistStep;
    const setupNavigationBlocked = savingCheckpoint
        || commandBusy
        || hasPendingMutation
        || hasUncommittedDraft
        || checkpointIsIncompatible
        || completeEditor !== null;
    const checklistNavigation = setupChecklistNavigationFrom(
        props.state,
        activeChecklistStep,
        setupNavigationBlocked,
    );

    useEffect(() => {
        const dialog = dialogRef.current;
        if (dialog === null) {
            return;
        }
        if (props.open && !dialog.open) {
            dialog.showModal();
        }
        if (!props.open && dialog.open) {
            dialog.close();
        }
    }, [props.open]);

    useEffect(() => {
        if (!isDirty.current) {
            setDraft(initialDraftFrom(props.state, props.entryIntent));
        }
    }, [
        props.entryIntent,
        props.open,
        props.state.kind,
        props.state.projection.workspaceRevision,
        props.state.projection.draftCheckpointVersion,
    ]);

    useEffect(() => {
        if (pendingMutation === null) {
            setActiveChecklistStep(visibleChecklistStepFrom(props.state, props.entryIntent));
        }
    }, [
        pendingMutation,
        props.entryIntent,
        props.open,
        props.state.kind,
        props.state.projection.workspaceRevision,
    ]);

    useEffect(() => {
        if (pendingMutation !== null) {
            dispatchPendingMutation({ kind: 'projection-advanced' });
        }
    }, [props.state.projection.workspaceRevision]);

    useEffect(() => {
        if (!props.open
            || props.state.kind !== 'complete'
            || props.entryIntent === 'task'
            || completeEditor !== null
            || (checkpoint !== null && !checkpointIsIncompatible)
            || completeEditorFrom(props.state) !== null) {
            return;
        }
        const completionFocusFrame = globalThis.requestAnimationFrame(() => (
            completionHeadingRef.current?.focus()
        ));
        return () => globalThis.cancelAnimationFrame(completionFocusFrame);
    }, [
        checkpointIsIncompatible,
        completeEditor,
        props.entryIntent,
        props.open,
        props.state.kind,
        props.state.projection.draftCheckpointVersion,
    ]);

    useEffect(() => {
        if (!props.open || props.state.kind !== 'complete') {
            setCompleteEditor(null);
            return;
        }
        if (!isDirty.current) {
            setCompleteEditor(completeEditorForEntry(props.state, props.entryIntent));
        }
    }, [
        props.entryIntent,
        props.open,
        props.state.kind,
        props.state.projection.draftCheckpointVersion,
    ]);

    /**
     * Updates one controlled draft branch and marks it as needing a checkpoint.
     *
     * @param {'term' | 'course' | 'meeting' | 'task'} branch Draft branch.
     * @param {TermDraft | CourseDraft | MeetingDraft | TaskDraft} value Updated branch value.
     * @return {void}
     */
    const updateDraft = (
        branch: 'term' | 'course' | 'meeting' | 'task' | 'holiday',
        value: TermDraft | CourseDraft | MeetingDraft | TaskDraft | HolidayDraft,
    ): void => {
        const completedStep = branch === 'course'
            ? 'course'
            : branch === 'meeting' || branch === 'task' ? 'activity' : 'holiday';
        isDirty.current = true;
        setDraft(current => ({
            ...current,
            step: props.state.kind === 'complete' ? completedStep : editableStepFrom(props.state),
            [branch]: value,
        }));
        setCheckpointMessage('有未提交输入；请先提交当前表单，或保存进度并退出。');
    };

    const retainUnknownMutation = (pending: PendingSetupMutation): void => {
        dispatchPendingMutation({ kind: 'retain-unknown', pending });
    };

    const resolvePendingMutation = (kind: PendingSetupMutation['kind']): void => {
        if (pendingMutation?.kind === kind) {
            dispatchPendingMutation({ kind: 'resolved' });
        }
    };

    /**
     * Selects the explicit Meeting-or-Task branch and checkpoints that choice.
     *
     * @param {'meeting' | 'task'} activityKind Selected setup activity.
     * @return {void}
     */
    const updateActivityKind = (activityKind: SetupDraft['activityKind']): void => {
        if (hasPendingMutation) {
            dispatchPendingMutation({ kind: 'branch-switch-attempted' });
            setCheckpointMessage('先精确重试未确认的正式请求，再切换添加方式。');
            focusStatus(statusRef);
            return;
        }
        isDirty.current = true;
        setDraft(current => ({ ...current, activityKind, step: 'activity' }));
        setCheckpointMessage('已选择添加方式；退出时会先保存本地草稿。');
    };

    /**
     * Moves among completed checklist facts and the current editable step.
     * @param {SetupDraft['step'] | null} target Adjacent destination already authorized by formal facts.
     * @return {void}
     */
    const navigateChecklist = (target: SetupDraft['step'] | null): void => {
        if (target === null
            || (target !== checklistNavigation.previous && target !== checklistNavigation.next)) {
            return;
        }
        setActiveChecklistStep(target);
        setCheckpointMessage(target === currentChecklistStep
            ? '已返回当前设置步骤；正式数据和草稿没有改变。'
            : '正在查看已完成的正式设置；正式数据和草稿没有改变。');
        globalThis.requestAnimationFrame(() => setupWorkspaceRef.current?.focus());
    };

    /**
     * Ends native modal focus containment before the parent restores the prior target.
     *
     * @param {'current' | 'today'} destination Surface requested after closing.
     * @return {void}
     */
    const closeDialog = (destination: 'current' | 'today'): void => {
        const dialog = dialogRef.current;
        if (dialog?.open) {
            dialog.close();
        }
        props.onClose(destination);
    };

    /**
     * Saves a dirty draft, then closes only after Workspace confirms persistence.
     *
     * @param {'current' | 'today'} destination Surface requested after closing.
     * @return {Promise<void>}
     */
    const saveAndClose = async (destination: 'current' | 'today'): Promise<void> => {
        if (savingCheckpoint || commandBusy) {
            return;
        }
        if (hasPendingMutation) {
            dispatchPendingMutation({ kind: 'exit-attempted' });
            setCheckpointMessage('正式请求结果尚未确认；请先精确重试本次请求，再退出设置。');
            focusStatus(statusRef);
            return;
        }
        if (checkpointIsIncompatible || !isDirty.current || props.state.dataMode === 'read-only') {
            closeDialog(destination);
            return;
        }

        setSavingCheckpoint(true);
        setCheckpointMessage('正在保存设置草稿…');
        const expectedVersion = props.state.projection.draftCheckpointVersion;
        const opaquePayload = encodeSetupDraft({
            ...draft,
            step: props.state.kind === 'complete'
                ? draft.step
                : editableStepFrom(props.state),
        });
        const expectedCheckpoint = { schemaVersion: 1, opaquePayload } as const;
        let outcome: WorkspaceSetupOutcome | null = null;
        try {
            outcome = await window.courseFlow.saveSetupDraftCheckpoint({
                expectedVersion,
                schemaVersion: 1,
                opaquePayload,
            });
        }
        catch {
        }
        const reconciledOutcome = await reconcileSetupCheckpoint(
            outcome,
            expectedVersion,
            expectedCheckpoint,
            () => window.courseFlow.querySetup(),
        );
        setSavingCheckpoint(false);
        if (reconciledOutcome === null) {
            setCheckpointMessage(outcome !== null && !outcome.ok
                ? setupMutationProblemMessage(outcome.problem, '草稿未保存。')
                : '草稿保存结果尚无法确认；全部输入、草稿和本次请求仍保留，请重新打开设置核对。');
            focusStatus(statusRef);
            return;
        }
        const nextState = setupStateFrom(reconciledOutcome);
        if (nextState.kind === 'problem' || nextState.kind === 'loading') {
            const message = nextState.kind === 'problem'
                ? nextState.message
                : 'Workspace 未返回可恢复的设置状态。';
            setCheckpointMessage(`草稿保存结果尚无法确认：${message}`);
            focusStatus(statusRef);
            return;
        }

        isDirty.current = false;
        props.onProjection(nextState);
        closeDialog(destination);
    };

    /**
     * Discards an incompatible checkpoint only after the user explicitly chooses it.
     *
     * @return {Promise<void>}
     */
    const discardIncompatibleCheckpoint = async (): Promise<void> => {
        if (savingCheckpoint || commandBusy || props.state.dataMode === 'read-only') {
            return;
        }

        setSavingCheckpoint(true);
        const expectedVersion = props.state.projection.draftCheckpointVersion;
        let outcome: WorkspaceSetupOutcome | null = null;
        try {
            outcome = await window.courseFlow.discardSetupDraftCheckpoint(
                expectedVersion,
            );
        }
        catch {
        }
        const reconciledOutcome = await reconcileSetupCheckpoint(
            outcome,
            expectedVersion,
            null,
            () => window.courseFlow.querySetup(),
        );
        setSavingCheckpoint(false);
        if (reconciledOutcome === null) {
            setCheckpointMessage(outcome !== null && !outcome.ok
                ? setupMutationProblemMessage(outcome.problem, '旧草稿未丢弃。')
                : '旧草稿丢弃结果尚无法确认；当前草稿和本次请求仍保留，请重新打开设置核对。');
            focusStatus(statusRef);
            return;
        }
        const nextState = setupStateFrom(reconciledOutcome);
        if (nextState.kind === 'problem' || nextState.kind === 'loading') {
            const message = nextState.kind === 'problem'
                ? nextState.message
                : 'Workspace 未返回可恢复的设置状态。';
            setCheckpointMessage(`旧草稿丢弃结果尚无法确认：${message}`);
            focusStatus(statusRef);
            return;
        }

        isDirty.current = false;
        setDraft(initialDraftFrom(nextState));
        setCheckpointMessage('旧草稿已丢弃；正式课程数据没有改变。');
        props.onProjection(nextState);
    };

    /**
     * Refreshes formal setup facts after one command and consumes its draft checkpoint.
     *
     * @return {Promise<void>}
     */
    const refreshAfterCommit = async (): Promise<void> => {
        let outcome: WorkspaceSetupOutcome;
        try {
            outcome = await window.courseFlow.querySetup();
        }
        catch {
            setCheckpointMessage('正式数据已保存，但无法刷新设置进度；请退出后重新打开。');
            focusStatus(statusRef);
            return;
        }
        if (checkpoint !== null && props.state.dataMode === 'ready') {
            const expectedVersion = props.state.projection.draftCheckpointVersion;
            let discarded: WorkspaceSetupOutcome | null = null;
            try {
                discarded = await window.courseFlow.discardSetupDraftCheckpoint(
                    expectedVersion,
                );
            }
            catch {
            }
            const reconciledDiscard = await reconcileSetupCheckpoint(
                discarded,
                expectedVersion,
                null,
                () => window.courseFlow.querySetup(),
            );
            if (reconciledDiscard !== null) {
                outcome = reconciledDiscard;
            }
            else if (discarded !== null && !discarded.ok) {
                setCheckpointMessage(discarded.problem.dataEffect === 'unknown'
                    ? `${discarded.problem.message} 正式数据已保存；旧草稿清理结果尚无法确认，`
                        + '请重新打开设置核对。'
                    : `${discarded.problem.message} 正式数据已保存；旧草稿未清理，`
                        + '下次设置会以正式进度为准。');
            }
            else {
                setCheckpointMessage('正式数据已保存；旧草稿清理结果尚无法确认，请重新打开设置核对。');
            }
        }

        const nextState = setupStateFrom(outcome);
        if (nextState.kind === 'problem' || nextState.kind === 'loading') {
            const message = nextState.kind === 'problem'
                ? nextState.message
                : 'Workspace 未返回可恢复的设置状态。';
            setCheckpointMessage(`正式数据已保存，但无法刷新设置进度：${message}`);
            focusStatus(statusRef);
            return;
        }

        isDirty.current = false;
        setDraft(initialDraftFrom(nextState));
        props.onProjection(nextState);
    };

    const retryPendingMutation = async (): Promise<void> => {
        if (pendingMutation === null || savingCheckpoint || commandBusy) {
            return;
        }

        setCommandBusy(true);
        setCheckpointMessage('正在使用保留的 command ID 精确重试正式请求…');
        let outcome: WorkspaceSetupOutcome;
        try {
            outcome = await retryPendingSetupMutation(pendingMutation, window.courseFlow);
        }
        catch {
            setCommandBusy(false);
            setCheckpointMessage('无法连接本地 Workspace；结果仍未知，原请求和全部输入继续保留。');
            focusStatus(statusRef);
            return;
        }
        if (!outcome.ok && outcome.problem.dataEffect === 'unknown') {
            setCommandBusy(false);
            setCheckpointMessage(setupMutationProblemMessage(outcome.problem, '正式数据没有改变。'));
            focusStatus(statusRef);
            return;
        }

        dispatchPendingMutation({ kind: 'resolved' });
        if (!outcome.ok) {
            setCommandBusy(false);
            setCheckpointMessage(setupMutationProblemMessage(outcome.problem, '正式数据没有改变。'));
            focusStatus(statusRef);
            return;
        }

        setCheckpointMessage('原请求已由 Workspace 精确确认；正式数据已保存。');
        await refreshAfterCommit();
        setCommandBusy(false);
    };

    return (
        <dialog
            aria-labelledby="setup-dialog-title"
            aria-modal="true"
            className="setup-dialog"
            onCancel={event => {
                event.preventDefault();
                void saveAndClose('current');
            }}
            ref={dialogRef}
        >
            <div
                aria-busy={savingCheckpoint || commandBusy}
                className="setup-modal"
            >
                <header className="setup-modal-header">
                    <div>
                        <p className="eyebrow">First setup</p>
                        <h1 id="setup-dialog-title">完成首次设置</h1>
                    </div>
                    <div className="setup-modal-actions">
                        <button
                            disabled={savingCheckpoint || commandBusy || hasPendingMutation}
                            onClick={() => void saveAndClose('current')}
                            type="button"
                        >{readOnly ? '关闭' : '保存进度并退出'}</button>
                        <button
                            aria-label={readOnly ? '关闭设置' : '保存设置草稿并关闭'}
                            className="icon-button"
                            disabled={savingCheckpoint || commandBusy || hasPendingMutation}
                            onClick={() => void saveAndClose('current')}
                            type="button"
                        >×</button>
                    </div>
                </header>
                <div className="setup-modal-body">
                    <SetupProgress
                        activeStep={activeChecklistStep}
                        state={props.state}
                    />
                    <section
                        aria-label="当前设置步骤"
                        className="setup-workspace"
                        ref={setupWorkspaceRef}
                        tabIndex={-1}
                    >
                        {checkpointIsIncompatible ? (
                            <IncompatibleDraft
                                dataMode={props.state.dataMode}
                                saving={savingCheckpoint || hasPendingMutation}
                                onDiscard={() => void discardIncompatibleCheckpoint()}
                            />
                        ) : null}
                        {!checkpointIsIncompatible && reviewingChecklistStep !== null ? (
                            <SetupFactReview
                                state={props.state}
                                step={reviewingChecklistStep}
                            />
                        ) : null}
                        {!checkpointIsIncompatible
                            && reviewingChecklistStep === null
                            && props.state.kind === 'term' ? (
                            <TermForm
                                blocked={savingCheckpoint
                                    || (hasPendingMutation && pendingMutation.kind !== 'term')}
                                dataMode={props.state.dataMode}
                                draft={draft.term}
                                inputLocked={hasPendingMutation}
                                pendingCommand={pendingMutation?.kind === 'term'
                                    ? pendingMutation.command
                                    : null}
                                projection={props.state.projection}
                                onChange={value => updateDraft('term', value)}
                                onBusyChange={setCommandBusy}
                                onCommitted={refreshAfterCommit}
                                onSettled={() => resolvePendingMutation('term')}
                                onUnknown={command => retainUnknownMutation({ kind: 'term', command })}
                            />
                        ) : null}
                        {!checkpointIsIncompatible
                            && reviewingChecklistStep === null
                            && props.state.kind === 'course' ? (
                            <CourseForm
                                blocked={savingCheckpoint
                                    || (hasPendingMutation && pendingMutation.kind !== 'course')}
                                dataMode={props.state.dataMode}
                                draft={draft.course}
                                inputLocked={hasPendingMutation}
                                pendingCommand={pendingMutation?.kind === 'course'
                                    ? pendingMutation.command
                                    : null}
                                projection={props.state.projection}
                                onChange={value => updateDraft('course', value)}
                                onBusyChange={setCommandBusy}
                                onCommitted={refreshAfterCommit}
                                onSettled={() => resolvePendingMutation('course')}
                                onUnknown={command => retainUnknownMutation({ kind: 'course', command })}
                            />
                        ) : null}
                        {!checkpointIsIncompatible
                            && reviewingChecklistStep === null
                            && props.state.kind === 'activity' ? (
                            <ActivityStep
                                blocked={savingCheckpoint}
                                dataMode={props.state.dataMode}
                                draft={draft}
                                inputLocked={hasPendingMutation}
                                pendingMutation={pendingMutation}
                                projection={props.state.projection}
                                selectionBlocked={hasPendingMutation}
                                onActivityKindChange={updateActivityKind}
                                onBusyChange={setCommandBusy}
                                onMeetingChange={value => updateDraft('meeting', value)}
                                onTaskChange={value => updateDraft('task', value)}
                                onCommitted={refreshAfterCommit}
                                onSettled={resolvePendingMutation}
                                onUnknown={retainUnknownMutation}
                            />
                        ) : null}
                        {!checkpointIsIncompatible
                            && reviewingChecklistStep === null
                            && props.state.kind === 'complete' ? (
                            <>
                                <SetupComplete
                                    activeEditor={completeEditor}
                                    disabled={savingCheckpoint
                                        || commandBusy
                                        || readOnly
                                        || hasPendingMutation
                                        || hasUncommittedDraft}
                                    headingRef={completionHeadingRef}
                                    onEdit={editor => {
                                        setActiveChecklistStep(editor);
                                        setCompleteEditor(editor);
                                    }}
                                    state={props.state}
                                />
                                {completeEditor === 'course' ? (
                                    <CourseForm
                                        blocked={savingCheckpoint
                                            || (hasPendingMutation && pendingMutation.kind !== 'course')}
                                        dataMode={props.state.dataMode}
                                        draft={draft.course}
                                        inputLocked={hasPendingMutation}
                                        pendingCommand={pendingMutation?.kind === 'course'
                                            ? pendingMutation.command
                                            : null}
                                        projection={props.state.projection}
                                        onChange={value => updateDraft('course', value)}
                                        onBusyChange={setCommandBusy}
                                        onCommitted={refreshAfterCommit}
                                        onSettled={() => resolvePendingMutation('course')}
                                        onUnknown={command => retainUnknownMutation({ kind: 'course', command })}
                                    />
                                ) : null}
                                {completeEditor === 'activity' ? (
                                    <ActivityStep
                                        blocked={savingCheckpoint}
                                        dataMode={props.state.dataMode}
                                        draft={draft}
                                        inputLocked={hasPendingMutation}
                                        pendingMutation={pendingMutation}
                                        projection={props.state.projection}
                                        selectionBlocked={hasPendingMutation}
                                        onActivityKindChange={updateActivityKind}
                                        onBusyChange={setCommandBusy}
                                        onMeetingChange={value => updateDraft('meeting', value)}
                                        onTaskChange={value => updateDraft('task', value)}
                                        onCommitted={refreshAfterCommit}
                                        onSettled={resolvePendingMutation}
                                        onUnknown={retainUnknownMutation}
                                    />
                                ) : null}
                                {completeEditor === null ? (
                                    <HolidayForm
                                        autoFocusName={checkpoint !== null && draft.step === 'holiday'}
                                        blocked={savingCheckpoint
                                            || (hasPendingMutation && pendingMutation.kind !== 'holiday')}
                                        dataMode={props.state.dataMode}
                                        draft={draft.holiday}
                                        exitBlocked={hasPendingMutation}
                                        inputLocked={hasPendingMutation}
                                        pendingCommand={pendingMutation?.kind === 'holiday'
                                            ? pendingMutation.command
                                            : null}
                                        projection={props.state.projection}
                                        onBusyChange={setCommandBusy}
                                        onChange={value => updateDraft('holiday', value)}
                                        onCommitted={refreshAfterCommit}
                                        onSettled={() => resolvePendingMutation('holiday')}
                                        onSkip={() => void saveAndClose('today')}
                                        onUnknown={command => retainUnknownMutation({ kind: 'holiday', command })}
                                    />
                                ) : (
                                    <button
                                        className="secondary-action setup-summary-action"
                                        disabled={savingCheckpoint
                                            || commandBusy
                                            || hasPendingMutation
                                            || hasUncommittedDraft}
                                        onClick={() => {
                                            setActiveChecklistStep(currentChecklistStep);
                                            setCompleteEditor(null);
                                            globalThis.requestAnimationFrame(() => (
                                                completionHeadingRef.current?.focus()
                                            ));
                                        }}
                                        type="button"
                                    >返回完成概览与假期</button>
                                )}
                            </>
                        ) : null}
                    </section>
                </div>
                <footer className="setup-modal-footer">
                    <div
                        aria-label="设置步骤导航"
                        className="setup-step-navigation"
                    >
                        <button
                            className="secondary-action"
                            disabled={checklistNavigation.previous === null}
                            onClick={() => navigateChecklist(checklistNavigation.previous)}
                            type="button"
                        >上一步</button>
                        <button
                            className="secondary-action"
                            disabled={checklistNavigation.next === null}
                            onClick={() => navigateChecklist(checklistNavigation.next)}
                            type="button"
                        >下一步</button>
                    </div>
                    <p
                        className="checkpoint-message"
                        ref={statusRef}
                        role="status"
                        tabIndex={-1}
                    >{checkpointMessage}</p>
                    <div className="setup-footer-actions">
                        {pendingMutation !== null ? (
                            <button
                                className="secondary-action"
                                disabled={savingCheckpoint || commandBusy}
                                onClick={() => void retryPendingMutation()}
                                type="button"
                            >精确重试未确认请求</button>
                        ) : null}
                        <button
                            className="primary-action"
                            disabled={savingCheckpoint || commandBusy || hasPendingMutation}
                            onClick={() => void saveAndClose('today')}
                            type="button"
                        >进入今天</button>
                    </div>
                </footer>
            </div>
        </dialog>
    );
}

/**
 * Renders formal progress with the current black layer nested inside one white card.
 *
 * @param {object} props Current resolved state and visible checklist step.
 * @return {JSX.Element} Textual setup progress.
 */
function SetupProgress(props: Readonly<{
    activeStep: SetupDraft['step'];
    state: ResolvedSetupState;
}>) {
    const { activeStep, state } = props;
    const minimum = state.projection.minimum;
    const completedCount = [
        minimum.hasCurrentTerm,
        minimum.hasCurrentTermCourse,
        minimum.hasMeetingOrTask,
    ].filter(Boolean).length;
    const percentage = Math.round(completedCount / 3 * 100);
    const currentLabel = activeStep === 'term'
        ? '当前学期'
        : activeStep === 'course'
            ? '添加课程'
            : activeStep === 'activity'
                ? '添加课节或任务'
                : '假期（可稍后）';
    return (
        <aside
            aria-label="设置进度"
            className="setup-progress-card"
        >
            <div className="setup-progress-heading">
                <span>设置进度</span>
                <strong>{percentage}%</strong>
            </div>
            <div
                aria-hidden="true"
                className="progress-track"
                data-progress={completedCount}
            >
                <span />
            </div>
            <div className="setup-current-layer">
                <p>当前重点</p>
                <strong>{currentLabel}</strong>
                <span>{completedCount} / 3 个最低条件已完成</span>
            </div>
            <ol className="setup-step-list">
                <ProgressStep
                    complete={minimum.hasCurrentTerm}
                    current={activeStep === 'term'}
                    label="当前学期"
                />
                <ProgressStep
                    complete={minimum.hasCurrentTermCourse}
                    current={activeStep === 'course'}
                    label="添加课程"
                />
                <ProgressStep
                    complete={minimum.hasMeetingOrTask}
                    current={activeStep === 'activity'}
                    label="课节或任务"
                />
                <li data-status={activeStep === 'holiday' ? '当前' : 'optional'}>
                    <span aria-hidden="true">4</span>
                    <span>
                        <strong>假期（可稍后）</strong>
                        <small>{activeStep === 'holiday' ? '当前' : '不阻止进入 Today'}</small>
                    </span>
                </li>
            </ol>
        </aside>
    );
}

/**
 * Renders one numbered progress row with a textual state.
 *
 * @param {object} props Step label and formal state.
 * @return {JSX.Element} Progress list item.
 */
function ProgressStep(props: Readonly<{
    complete: boolean;
    current: boolean;
    label: string;
}>) {
    const status = props.current ? '当前' : props.complete ? '完成' : '待完成';
    return (
        <li data-status={status}>
            <span aria-hidden="true">{props.complete ? '✓' : '•'}</span>
            <span><strong>{props.label}</strong><small>{status}</small></span>
        </li>
    );
}

/**
 * Shows only committed facts while the user reviews an earlier checklist step.
 * @param {object} props Formal projection and selected checklist step.
 * @return {JSX.Element} Read-only fact summary without an editing command.
 */
function SetupFactReview(props: Readonly<{
    state: ResolvedSetupState;
    step: SetupDraft['step'];
}>) {
    const currentTerm = props.state.projection.currentTerm;
    const currentCourses = props.state.projection.courses.filter(course => (
        course.termId === currentTerm?.termId && !course.archived
    ));
    const meetingCount = currentCourses.reduce((total, course) => total + course.meetings.length, 0);
    const courseIds = new Set(currentCourses.map(course => course.courseId));
    const taskCount = props.state.projection.tasks.filter(task => courseIds.has(task.courseId)).length;
    const view = props.step === 'term'
        ? {
            title: '当前学期',
            facts: [
                ['名称', currentTerm?.name ?? '正式投影不可用'],
                ['日期', currentTerm === null ? '正式投影不可用' : `${currentTerm.startDate} 至 ${currentTerm.endDate}`],
                ['时区', currentTerm?.timeZone ?? '正式投影不可用'],
            ],
        }
        : props.step === 'course'
            ? {
                title: '当前课程',
                facts: [
                    ['数量', `${currentCourses.length} 门`],
                    ['课程', currentCourses.map(course => `${course.code} · ${course.name}`).join('、')],
                ],
            }
            : props.step === 'activity'
                ? {
                    title: '课节或任务',
                    facts: [
                        ['课节', `${meetingCount} 条`],
                        ['任务', `${taskCount} 条`],
                    ],
                }
                : {
                    title: '假期（可稍后）',
                    facts: [['当前假期', `${currentTermHolidayCount(props.state.projection)} 个`]],
                };
    return (
        <div className="setup-step-panel setup-review-panel">
            <p className="eyebrow">查看已完成步骤</p>
            <h2>{view.title}</h2>
            <p>以下内容来自正式 Workspace 投影；前后导航不会修改正式数据或草稿。</p>
            <dl className="setup-fact-list">
                {view.facts.map(([label, value]) => (
                    <div key={label}><dt>{label}</dt><dd>{value || '未提供'}</dd></div>
                ))}
            </dl>
        </div>
    );
}

/**
 * Explains an unreadable Shell draft and exposes only explicit discard.
 *
 * @param {object} props Draft capability and callback.
 * @return {JSX.Element} Incompatible-draft recovery surface.
 */
function IncompatibleDraft(props: Readonly<{
    dataMode: 'ready' | 'read-only';
    saving: boolean;
    onDiscard(): void;
}>) {
    return (
        <div className="setup-step-panel">
            <p className="eyebrow">草稿需要处理</p>
            <h2>这份设置草稿无法由当前版本读取</h2>
            <p>{props.dataMode === 'read-only'
                ? '正式学期、课程、课节和任务没有改变。只读模式不能丢弃这份旧草稿。'
                : '正式学期、课程、课节和任务没有改变。你可以进入 Today，或明确丢弃旧草稿后重新填写。'}</p>
            <button
                className="secondary-action"
                disabled={props.saving || props.dataMode === 'read-only'}
                onClick={props.onDiscard}
                type="button"
            >丢弃旧草稿</button>
        </div>
    );
}

/**
 * Summarizes the formal minimum without exposing internal identifiers as primary content.
 *
 * @param {object} props Completed setup state.
 * @return {JSX.Element} Completion surface.
 */
function SetupComplete(props: Readonly<{
    activeEditor: 'course' | 'activity' | null;
    disabled: boolean;
    headingRef: RefObject<HTMLHeadingElement | null>;
    onEdit(editor: 'course' | 'activity'): void;
    state: Extract<SetupState, { kind: 'complete' }>;
}>) {
    const { state } = props;
    const currentTerm = state.projection.currentTerm;
    const currentCourses = state.projection.courses.filter(course => (
        course.termId === currentTerm?.termId && !course.archived
    ));
    const meetingCount = currentCourses.reduce((total, course) => total + course.meetings.length, 0);
    const courseIds = new Set(currentCourses.map(course => course.courseId));
    const taskCount = state.projection.tasks.filter(task => courseIds.has(task.courseId)).length;
    const holidayCount = currentTermHolidayCount(state.projection);
    return (
        <div className="setup-step-panel setup-complete-panel">
            <div
                aria-atomic="true"
                aria-live="polite"
                className="setup-complete-announcement"
            >
                <p className="eyebrow">最低条件已满足</p>
                <h2
                    id="setup-complete-title"
                    ref={props.headingRef}
                    tabIndex={-1}
                >你的 Today 已经可以使用</h2>
                <p>{currentTerm?.name ?? '当前学期'} · {currentCourses.length} 门课程</p>
            </div>
            <dl className="setup-fact-list">
                <div><dt>当前学期</dt><dd>{currentTerm === null ? '缺失' : '完成'}</dd></div>
                <div><dt>课程</dt><dd>{currentCourses.length} 门</dd></div>
                <div><dt>课节或任务</dt><dd>{meetingCount} 条课节 · {taskCount} 条任务</dd></div>
                <div><dt>假期</dt><dd>{holidayCount} 个，可稍后补充</dd></div>
            </dl>
            <div
                aria-label="继续补充正式课程数据"
                className="setup-complete-actions"
            >
                <strong>继续补充</strong>
                <p>可以继续添加真实课程、课节或任务，也可直接进入 Today。</p>
                <div>
                    <button
                        aria-pressed={props.activeEditor === 'course'}
                        className="secondary-action"
                        disabled={props.disabled}
                        onClick={() => props.onEdit('course')}
                        type="button"
                    >添加另一门课程</button>
                    <button
                        aria-pressed={props.activeEditor === 'activity'}
                        className="secondary-action"
                        disabled={props.disabled}
                        onClick={() => props.onEdit('activity')}
                        type="button"
                    >添加课节或任务</button>
                </div>
            </div>
        </div>
    );
}

/**
 * Adds the approved non-blocking HolidayRange branch after the minimum is satisfied.
 *
 * @param {object} props Controlled optional Holiday draft and formal commit callbacks.
 * @return {JSX.Element | null} HolidayRange form or no surface without a Current Term.
 */
function HolidayForm(props: Readonly<{
    autoFocusName: boolean;
    blocked: boolean;
    dataMode: 'ready' | 'read-only';
    draft: HolidayDraft;
    exitBlocked: boolean;
    inputLocked: boolean;
    pendingCommand: CreateHolidayRangeCommand | null;
    projection: ResolvedSetupState['projection'];
    onBusyChange(busy: boolean): void;
    onChange(value: HolidayDraft): void;
    onCommitted(): Promise<void>;
    onSettled(): void;
    onSkip(): void;
    onUnknown(command: CreateHolidayRangeCommand): void;
}>) {
    const [message, setMessage] = useState('假期不会阻止进入 Today；只保存你明确填写的日期。');
    const [saving, setSaving] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<SetupFieldErrors>({});
    const formRef = useRef<HTMLFormElement>(null);
    const messageRef = useRef<HTMLParagraphElement>(null);
    const writable = props.dataMode === 'ready';
    const currentTerm = props.projection.currentTerm;
    if (currentTerm === null) {
        return null;
    }
    const holidayCount = currentTermHolidayCount(props.projection);

    const changeField = (field: keyof HolidayDraft, value: string): void => {
        props.onChange({ ...props.draft, [field]: value });
        setFieldErrors({});
        setMessage('有未提交输入；正式假期范围尚未改变。');
    };

    const submitHoliday = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault();
        if (!writable || saving || props.blocked) {
            return;
        }

        const validationErrors = combineSetupFieldErrors(
            HOLIDAY_NATIVE_FIELD_MESSAGES,
            setupNativeFieldErrors(event.currentTarget, HOLIDAY_NATIVE_FIELD_MESSAGES),
            setupSemanticFailureErrors({ kind: 'holiday', draft: props.draft }),
        );
        if (Object.keys(validationErrors).length > 0) {
            setFieldErrors(validationErrors);
            setMessage('请修正已标注的假期字段；正式数据没有改变。');
            focusFirstSetupFieldError(event.currentTarget, validationErrors);
            return;
        }

        let command = props.pendingCommand;
        try {
            command ??= normalizeCreateHolidayRangeCommand({
                commandId: globalThis.crypto.randomUUID(),
                followUpId: globalThis.crypto.randomUUID(),
                expectedRevision: props.projection.workspaceRevision,
                expectedPlanVersion: props.projection.planEntityVersion,
                intent: {
                    kind: 'plan.create-holiday-range',
                    intentSchemaVersion: 1,
                    payload: {
                        termId: currentTerm.termId,
                        name: props.draft.name,
                        startDate: props.draft.startDate,
                        endDate: props.draft.endDate,
                    },
                },
            });
        }
        catch {
            const semanticErrors = setupSemanticFailureErrors({ kind: 'holiday', draft: props.draft });
            const errors = Object.keys(semanticErrors).length === 0
                ? { 'holiday-name': '假期资料不符合保存规则，请从名称开始核对。' }
                : semanticErrors;
            setFieldErrors(errors);
            setMessage('请修正已标注的假期字段；正式数据没有改变。');
            focusFirstSetupFieldError(formRef.current, errors);
            return;
        }

        setSaving(true);
        props.onBusyChange(true);
        setMessage('正在正式保存假期…');
        let outcome: WorkspaceSetupOutcome;
        try {
            outcome = await window.courseFlow.createHolidayRange(command);
        }
        catch {
            setSaving(false);
            props.onBusyChange(false);
            props.onUnknown(command);
            setMessage('无法连接本地 Workspace；保存结果尚无法确认，全部输入和本次请求仍保留。');
            focusStatus(messageRef);
            return;
        }
        if (!outcome.ok) {
            setSaving(false);
            props.onBusyChange(false);
            if (outcome.problem.dataEffect === 'unknown') {
                props.onUnknown(command);
            }
            else {
                props.onSettled();
            }
            setMessage(setupMutationProblemMessage(outcome.problem, '正式数据没有改变。'));
            focusStatus(messageRef);
            return;
        }

        props.onSettled();
        await props.onCommitted();
        setSaving(false);
        props.onBusyChange(false);
        setMessage('假期已保存；可以继续添加，或进入 Today。');
    };

    return (
        <div className="setup-step-panel setup-holiday-panel">
            <p className="eyebrow">可选步骤</p>
            <h2>添加假期（可选）</h2>
            <p>
                当前已有 {holidayCount} 个假期。周期课节和选择
                “跟随教学周”的任务会消费这些正式范围。
            </p>
            <form
                className="setup-form"
                noValidate
                onSubmit={event => void submitHoliday(event)}
                ref={formRef}
            >
                <fieldset
                    className="form-control-group"
                    disabled={!writable || saving || props.blocked || props.inputLocked}
                >
                    <legend className="visually-hidden">假期范围</legend>
                    <label className="field field--full">
                        <span>假期名称</span>
                        <input
                            {...setupFieldErrorAttributes('holiday-name', fieldErrors)}
                            autoFocus={props.autoFocusName}
                            maxLength={120}
                            name="holiday-name"
                            onChange={event => changeField('name', event.currentTarget.value)}
                            placeholder="例如：Reading Week"
                            required
                            type="text"
                            value={props.draft.name}
                        />
                        <SetupFieldError
                            errors={fieldErrors}
                            name="holiday-name"
                        />
                    </label>
                    <label className="field">
                        <span>开始日期</span>
                        <input
                            {...setupFieldErrorAttributes('holiday-start-date', fieldErrors)}
                            max={currentTerm.endDate}
                            min={currentTerm.startDate}
                            name="holiday-start-date"
                            onChange={event => changeField('startDate', event.currentTarget.value)}
                            required
                            type="date"
                            value={props.draft.startDate}
                        />
                        <SetupFieldError
                            errors={fieldErrors}
                            name="holiday-start-date"
                        />
                    </label>
                    <label className="field">
                        <span>结束日期</span>
                        <input
                            {...setupFieldErrorAttributes('holiday-end-date', fieldErrors)}
                            max={currentTerm.endDate}
                            min={props.draft.startDate || currentTerm.startDate}
                            name="holiday-end-date"
                            onChange={event => changeField('endDate', event.currentTarget.value)}
                            required
                            type="date"
                            value={props.draft.endDate}
                        />
                        <SetupFieldError
                            errors={fieldErrors}
                            name="holiday-end-date"
                        />
                    </label>
                </fieldset>
                <div className="form-footer field--full">
                    <p
                        ref={messageRef}
                        role="status"
                        tabIndex={-1}
                    >{writable ? message : '本地数据为只读；可以查看，但不能正式保存。'}</p>
                    <button
                        className="primary-action"
                        disabled={!writable || saving || props.blocked}
                        type="submit"
                    >{saving
                            ? '正在保存…'
                            : props.pendingCommand === null ? '保存假期' : '精确重试保存假期'}</button>
                </div>
            </form>
            <button
                className="secondary-action"
                disabled={saving || props.blocked || props.exitBlocked}
                onClick={props.onSkip}
                type="button"
            >暂不添加，进入 Today</button>
        </div>
    );
}

/**
 * Creates the formal Current Term while retaining invalid input in the Shell draft.
 *
 * @param {object} props Controlled Term form state and commit callback.
 * @return {JSX.Element} Current-Term form.
 */
function TermForm(props: Readonly<{
    blocked: boolean;
    dataMode: 'ready' | 'read-only';
    draft: TermDraft;
    inputLocked: boolean;
    pendingCommand: CreateTermCommand | null;
    projection: ResolvedSetupState['projection'];
    onChange(value: TermDraft): void;
    onBusyChange(busy: boolean): void;
    onCommitted(): Promise<void>;
    onSettled(): void;
    onUnknown(command: CreateTermCommand): void;
}>) {
    const [message, setMessage] = useState('日期与时区会决定之后所有本地时间的解释方式。');
    const [saving, setSaving] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<SetupFieldErrors>({});
    const formRef = useRef<HTMLFormElement>(null);
    const messageRef = useRef<HTMLParagraphElement>(null);
    const writable = props.dataMode === 'ready';

    /**
     * Updates one Term draft field before any formal command is retained.
     *
     * @param {keyof TermDraft} field Edited field.
     * @param {string} value Current input value.
     * @return {void}
     */
    const changeField = (field: keyof TermDraft, value: string): void => {
        props.onChange({ ...props.draft, [field]: value });
        setFieldErrors({});
        setMessage('有未提交输入；正式学期尚未改变。');
    };

    /**
     * Normalizes and submits one Current Term command.
     *
     * @param {FormEvent<HTMLFormElement>} event Native form submit event.
     * @return {Promise<void>}
     */
    const submitTerm = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault();
        if (!writable || saving || props.blocked) {
            return;
        }

        const validationErrors = combineSetupFieldErrors(
            TERM_NATIVE_FIELD_MESSAGES,
            setupNativeFieldErrors(event.currentTarget, TERM_NATIVE_FIELD_MESSAGES),
            setupSemanticFailureErrors({ kind: 'term', draft: props.draft }),
        );
        if (Object.keys(validationErrors).length > 0) {
            setFieldErrors(validationErrors);
            setMessage('请修正已标注的学期字段；正式数据没有改变。');
            focusFirstSetupFieldError(event.currentTarget, validationErrors);
            return;
        }

        let command = props.pendingCommand;
        try {
            command ??= normalizeCreateTermCommand({
                commandId: globalThis.crypto.randomUUID(),
                followUpId: globalThis.crypto.randomUUID(),
                expectedRevision: props.projection.workspaceRevision,
                expectedPlanVersion: props.projection.planEntityVersion,
                intent: {
                    kind: 'plan.create-term',
                    intentSchemaVersion: 1,
                    payload: props.draft,
                },
            });
        }
        catch {
            const semanticErrors = setupSemanticFailureErrors({ kind: 'term', draft: props.draft });
            const errors = Object.keys(semanticErrors).length === 0
                ? { 'term-name': '学期资料不符合保存规则，请从名称开始核对。' }
                : semanticErrors;
            setFieldErrors(errors);
            setMessage('请修正已标注的学期字段；正式数据没有改变。');
            focusFirstSetupFieldError(formRef.current, errors);
            return;
        }

        setSaving(true);
        props.onBusyChange(true);
        setMessage('正在正式保存当前学期…');
        let outcome: WorkspaceSetupOutcome;
        try {
            outcome = await window.courseFlow.createTerm(command);
        }
        catch {
            setSaving(false);
            props.onBusyChange(false);
            props.onUnknown(command);
            setMessage('无法连接本地 Workspace；提交结果尚无法确认，全部输入和本次请求仍保留。');
            focusStatus(messageRef);
            return;
        }
        if (!outcome.ok) {
            setSaving(false);
            props.onBusyChange(false);
            if (outcome.problem.dataEffect === 'unknown') {
                props.onUnknown(command);
            }
            else {
                props.onSettled();
            }
            setMessage(setupMutationProblemMessage(outcome.problem, '正式数据没有改变。'));
            focusStatus(messageRef);
            return;
        }

        props.onSettled();
        await props.onCommitted();
        setSaving(false);
        props.onBusyChange(false);
    };

    return (
        <div className="setup-step-panel">
            <p className="eyebrow">步骤 1 / 3</p>
            <h2>创建当前学期</h2>
            <p>先确定名称、起止日期和默认时区。所有信息只保存在这台设备上。</p>
            <form
                className="setup-form"
                noValidate
                onSubmit={submitTerm}
                ref={formRef}
            >
                <fieldset
                    className="form-control-group"
                    disabled={!writable || saving || props.blocked || props.inputLocked}
                >
                    <legend className="visually-hidden">学期资料</legend>
                    <label className="field field--full">
                        <span>学期名称</span>
                        <input
                            {...setupFieldErrorAttributes('term-name', fieldErrors)}
                            autoFocus
                            maxLength={120}
                            name="term-name"
                            onChange={event => changeField('name', event.target.value)}
                            placeholder="例如：2026 秋季学期"
                            required
                            type="text"
                            value={props.draft.name}
                        />
                        <SetupFieldError
                            errors={fieldErrors}
                            name="term-name"
                        />
                    </label>
                    <label className="field">
                        <span>开始日期</span>
                        <input
                            {...setupFieldErrorAttributes('term-start-date', fieldErrors)}
                            name="term-start-date"
                            onChange={event => changeField('startDate', event.target.value)}
                            required
                            type="date"
                            value={props.draft.startDate}
                        />
                        <SetupFieldError
                            errors={fieldErrors}
                            name="term-start-date"
                        />
                    </label>
                    <label className="field">
                        <span>结束日期</span>
                        <input
                            {...setupFieldErrorAttributes('term-end-date', fieldErrors)}
                            min={props.draft.startDate || undefined}
                            name="term-end-date"
                            onChange={event => changeField('endDate', event.target.value)}
                            required
                            type="date"
                            value={props.draft.endDate}
                        />
                        <SetupFieldError
                            errors={fieldErrors}
                            name="term-end-date"
                        />
                    </label>
                    <label className="field field--full">
                        <span>默认时区</span>
                        <input
                            {...setupFieldErrorAttributes(
                                'term-time-zone',
                                fieldErrors,
                                ['term-time-zone-hint'],
                            )}
                            list="time-zone-options"
                            name="term-time-zone"
                            onChange={event => changeField('timeZone', event.target.value)}
                            placeholder="例如：America/Toronto"
                            required
                            type="text"
                            value={props.draft.timeZone}
                        />
                        <small id="term-time-zone-hint">
                            请输入 IANA 时区名称；未知值不会被默认替代。
                        </small>
                        <SetupFieldError
                            errors={fieldErrors}
                            name="term-time-zone"
                        />
                    </label>
                    <datalist id="time-zone-options">
                        <option value="America/Toronto" />
                        <option value="America/Vancouver" />
                        <option value="America/New_York" />
                        <option value="Asia/Shanghai" />
                        <option value="Europe/London" />
                        <option value="UTC" />
                    </datalist>
                </fieldset>
                <FormStatus
                    action={props.pendingCommand === null ? '创建并继续' : '精确重试创建学期'}
                    message={message}
                    messageRef={messageRef}
                    saving={saving || props.blocked}
                    writable={writable}
                />
            </form>
        </div>
    );
}

/**
 * Creates one standalone Course before the user chooses a Meeting or Task.
 *
 * @param {object} props Controlled Course draft and formal projection.
 * @return {JSX.Element} Course form.
 */
function CourseForm(props: Readonly<{
    blocked: boolean;
    dataMode: 'ready' | 'read-only';
    draft: CourseDraft;
    inputLocked: boolean;
    pendingCommand: CreateCourseCommand | null;
    projection: ResolvedSetupState['projection'];
    onChange(value: CourseDraft): void;
    onBusyChange(busy: boolean): void;
    onCommitted(): Promise<void>;
    onSettled(): void;
    onUnknown(command: CreateCourseCommand): void;
}>) {
    const [message, setMessage] = useState('课程先独立保存；下一步再明确选择课节或任务。');
    const [saving, setSaving] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<SetupFieldErrors>({});
    const formRef = useRef<HTMLFormElement>(null);
    const messageRef = useRef<HTMLParagraphElement>(null);
    const writable = props.dataMode === 'ready';
    const currentTerm = props.projection.currentTerm;
    if (currentTerm === null) {
        return null;
    }

    const changeField = <Field extends keyof CourseDraft>(
        field: Field,
        value: CourseDraft[Field],
    ): void => {
        props.onChange({ ...props.draft, [field]: value });
        setFieldErrors({});
        setMessage('有未提交输入；正式课程尚未改变。');
    };

    const submitCourse = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault();
        if (!writable || saving || props.blocked) {
            return;
        }

        const validationErrors = combineSetupFieldErrors(
            COURSE_NATIVE_FIELD_MESSAGES,
            setupNativeFieldErrors(event.currentTarget, COURSE_NATIVE_FIELD_MESSAGES),
            setupSemanticFailureErrors({ kind: 'course', draft: props.draft }),
        );
        if (Object.keys(validationErrors).length > 0) {
            setFieldErrors(validationErrors);
            setMessage('请修正已标注的课程字段；正式数据没有改变。');
            focusFirstSetupFieldError(event.currentTarget, validationErrors);
            return;
        }

        let command = props.pendingCommand;
        try {
            command ??= normalizeCreateCourseCommand({
                commandId: globalThis.crypto.randomUUID(),
                followUpId: globalThis.crypto.randomUUID(),
                expectedRevision: props.projection.workspaceRevision,
                expectedPlanVersion: props.projection.planEntityVersion,
                intent: {
                    kind: 'plan.create-course',
                    intentSchemaVersion: 1,
                    payload: {
                        course: {
                            code: props.draft.code,
                            name: props.draft.name,
                            section: props.draft.section.trim() || null,
                            instructor: props.draft.instructor.trim() || null,
                            color: props.draft.color || null,
                            credits: props.draft.credits.trim() || null,
                            teachingRange: props.draft.teachingStartDate === currentTerm.startDate
                                && props.draft.teachingEndDate === currentTerm.endDate
                                ? { kind: 'inherit-term' }
                                : {
                                    kind: 'explicit',
                                    startDate: props.draft.teachingStartDate,
                                    endDate: props.draft.teachingEndDate,
                                },
                        },
                    },
                },
            });
        }
        catch {
            const semanticErrors = setupSemanticFailureErrors({ kind: 'course', draft: props.draft });
            const errors = Object.keys(semanticErrors).length === 0
                ? { 'course-code': '课程资料不符合保存规则，请从课程代码开始核对。' }
                : semanticErrors;
            setFieldErrors(errors);
            setMessage('请修正已标注的课程字段；正式数据没有改变。');
            focusFirstSetupFieldError(formRef.current, errors);
            return;
        }

        setSaving(true);
        props.onBusyChange(true);
        setMessage('正在正式保存课程…');
        let outcome: WorkspaceSetupOutcome;
        try {
            outcome = await window.courseFlow.createCourse(command);
        }
        catch {
            setSaving(false);
            props.onBusyChange(false);
            props.onUnknown(command);
            setMessage('无法连接本地 Workspace；提交结果尚无法确认，全部输入和本次请求仍保留。');
            focusStatus(messageRef);
            return;
        }
        if (!outcome.ok) {
            setSaving(false);
            props.onBusyChange(false);
            if (outcome.problem.dataEffect === 'unknown') {
                props.onUnknown(command);
            }
            else {
                props.onSettled();
            }
            setMessage(setupMutationProblemMessage(outcome.problem, '正式数据没有改变。'));
            focusStatus(messageRef);
            return;
        }

        props.onSettled();
        await props.onCommitted();
        setSaving(false);
        props.onBusyChange(false);
    };

    return (
        <div className="setup-step-panel">
            <p className="eyebrow">步骤 2 / 3 · {currentTerm.name}</p>
            <h2>添加课程</h2>
            <p>教学范围默认与学期相同；课程晚开始或提前结束时可以明确缩短。</p>
            <form
                className="setup-form setup-form--course"
                noValidate
                onSubmit={submitCourse}
                ref={formRef}
            >
                <fieldset
                    className="form-control-group"
                    disabled={!writable || saving || props.blocked || props.inputLocked}
                >
                    <legend className="visually-hidden">课程资料</legend>
                    <label className="field">
                        <span>课程代码</span>
                        <input
                            {...setupFieldErrorAttributes('course-code', fieldErrors)}
                            autoFocus
                            maxLength={32}
                            name="course-code"
                            onChange={event => changeField('code', event.target.value)}
                            placeholder="例如：CSC108"
                            required
                            type="text"
                            value={props.draft.code}
                        />
                        <SetupFieldError
                            errors={fieldErrors}
                            name="course-code"
                        />
                    </label>
                    <label className="field">
                        <span>课程名称</span>
                        <input
                            {...setupFieldErrorAttributes('course-name', fieldErrors)}
                            maxLength={120}
                            name="course-name"
                            onChange={event => changeField('name', event.target.value)}
                            required
                            type="text"
                            value={props.draft.name}
                        />
                        <SetupFieldError
                            errors={fieldErrors}
                            name="course-name"
                        />
                    </label>
                    <label className="field">
                        <span>节号（可选）</span>
                        <input
                            maxLength={64}
                            name="course-section"
                            onChange={event => changeField('section', event.target.value)}
                            type="text"
                            value={props.draft.section}
                        />
                    </label>
                    <label className="field">
                        <span>授课教师（可选）</span>
                        <input
                            maxLength={120}
                            name="course-instructor"
                            onChange={event => changeField('instructor', event.target.value)}
                            type="text"
                            value={props.draft.instructor}
                        />
                    </label>
                    <label className="field">
                        <span>颜色（可选）</span>
                        <select
                            name="course-color"
                            onChange={event => changeField('color', event.target.value as CourseColor | '')}
                            value={props.draft.color}
                        >
                            <option value="">未设置</option>
                            {Object.entries(COURSE_COLOR_NAMES).map(([value, label]) => (
                                <option
                                    key={value}
                                    value={value}
                                >{label}</option>
                            ))}
                        </select>
                    </label>
                    <label className="field">
                        <span>学分（可选）</span>
                        <input
                            {...setupFieldErrorAttributes('course-credits', fieldErrors)}
                            inputMode="decimal"
                            name="course-credits"
                            onChange={event => changeField('credits', event.target.value)}
                            placeholder="例如：3 或 0.5"
                            type="text"
                            value={props.draft.credits}
                        />
                        <SetupFieldError
                            errors={fieldErrors}
                            name="course-credits"
                        />
                    </label>
                    <label className="field">
                        <span>课程教学开始日期</span>
                        <input
                            {...setupFieldErrorAttributes('course-teaching-start', fieldErrors)}
                            max={currentTerm.endDate}
                            min={currentTerm.startDate}
                            name="course-teaching-start"
                            onChange={event => changeField('teachingStartDate', event.target.value)}
                            required
                            type="date"
                            value={props.draft.teachingStartDate}
                        />
                        <SetupFieldError
                            errors={fieldErrors}
                            name="course-teaching-start"
                        />
                    </label>
                    <label className="field">
                        <span>课程教学结束日期</span>
                        <input
                            {...setupFieldErrorAttributes('course-teaching-end', fieldErrors)}
                            max={currentTerm.endDate}
                            min={props.draft.teachingStartDate || currentTerm.startDate}
                            name="course-teaching-end"
                            onChange={event => changeField('teachingEndDate', event.target.value)}
                            required
                            type="date"
                            value={props.draft.teachingEndDate}
                        />
                        <SetupFieldError
                            errors={fieldErrors}
                            name="course-teaching-end"
                        />
                    </label>
                </fieldset>
                <FormStatus
                    action={props.pendingCommand === null ? '保存课程并继续' : '精确重试保存课程'}
                    message={message}
                    messageRef={messageRef}
                    saving={saving || props.blocked}
                    writable={writable}
                />
            </form>
        </div>
    );
}

/**
 * Makes the Meeting-or-Task decision explicit and preserves it in the setup draft.
 *
 * @param {object} props Controlled activity drafts and formal projection.
 * @return {JSX.Element} Activity choice with the selected real form.
 */
function ActivityStep(props: Readonly<{
    blocked: boolean;
    dataMode: 'ready' | 'read-only';
    draft: SetupDraft;
    inputLocked: boolean;
    pendingMutation: PendingSetupMutation | null;
    projection: ResolvedSetupState['projection'];
    selectionBlocked: boolean;
    onActivityKindChange(value: SetupDraft['activityKind']): void;
    onBusyChange(busy: boolean): void;
    onMeetingChange(value: MeetingDraft): void;
    onTaskChange(value: TaskDraft): void;
    onCommitted(): Promise<void>;
    onSettled(kind: PendingSetupMutation['kind']): void;
    onUnknown(pending: PendingSetupMutation): void;
}>) {
    const chooseFromKey = (
        event: KeyboardEvent<HTMLButtonElement>,
        current: SetupDraft['activityKind'],
    ): void => {
        if (event.key !== 'ArrowLeft'
            && event.key !== 'ArrowRight'
            && event.key !== 'Home'
            && event.key !== 'End') {
            return;
        }
        event.preventDefault();
        const target = event.key === 'Home'
            ? 'meeting'
            : event.key === 'End'
                ? 'task'
                : current === 'meeting' ? 'task' : 'meeting';
        props.onActivityKindChange(target);
        globalThis.requestAnimationFrame(() => {
            document.getElementById(`activity-choice-${target}`)?.focus();
        });
    };

    return (
        <div className="setup-step-panel">
            <p className="eyebrow">步骤 3 / 3</p>
            <h2>添加课节或任务</h2>
            <p>选择一种真实活动即可达到最低条件；以后仍可继续补充另一种。</p>
            <div
                aria-label="选择添加方式"
                className="activity-choice"
                role="group"
            >
                <button
                    aria-pressed={props.draft.activityKind === 'meeting'}
                    autoFocus={props.draft.activityKind === 'meeting'}
                    disabled={props.dataMode === 'read-only'
                        || props.blocked
                        || props.selectionBlocked}
                    id="activity-choice-meeting"
                    onClick={() => props.onActivityKindChange('meeting')}
                    onKeyDown={event => chooseFromKey(event, 'meeting')}
                    type="button"
                >添加课节</button>
                <button
                    aria-pressed={props.draft.activityKind === 'task'}
                    autoFocus={props.draft.activityKind === 'task'}
                    disabled={props.dataMode === 'read-only'
                        || props.blocked
                        || props.selectionBlocked}
                    id="activity-choice-task"
                    onClick={() => props.onActivityKindChange('task')}
                    onKeyDown={event => chooseFromKey(event, 'task')}
                    type="button"
                >添加任务</button>
            </div>
            {props.draft.activityKind === 'meeting' ? (
                <MeetingForm
                    blocked={props.blocked
                        || (props.pendingMutation !== null
                            && props.pendingMutation.kind !== 'meeting')}
                    dataMode={props.dataMode}
                    draft={props.draft.meeting}
                    inputLocked={props.inputLocked}
                    pendingCommand={props.pendingMutation?.kind === 'meeting'
                        ? props.pendingMutation.command
                        : null}
                    projection={props.projection}
                    onChange={props.onMeetingChange}
                    onBusyChange={props.onBusyChange}
                    onCommitted={props.onCommitted}
                    onSettled={() => props.onSettled('meeting')}
                    onUnknown={command => props.onUnknown({ kind: 'meeting', command })}
                />
            ) : (
                <TaskForm
                    blocked={props.blocked
                        || (props.pendingMutation !== null
                            && props.pendingMutation.kind !== 'task')}
                    dataMode={props.dataMode}
                    draft={props.draft.task}
                    inputLocked={props.inputLocked}
                    pendingCommand={props.pendingMutation?.kind === 'task'
                        ? props.pendingMutation.command
                        : null}
                    projection={props.projection}
                    onChange={props.onTaskChange}
                    onBusyChange={props.onBusyChange}
                    onCommitted={props.onCommitted}
                    onSettled={() => props.onSettled('task')}
                    onUnknown={command => props.onUnknown({ kind: 'task', command })}
                />
            )}
        </div>
    );
}

/**
 * Creates a real MeetingSeries for a current Course.
 *
 * @param {object} props Controlled Meeting draft and formal projection.
 * @return {JSX.Element} Meeting form.
 */
function MeetingForm(props: Readonly<{
    blocked: boolean;
    dataMode: 'ready' | 'read-only';
    draft: MeetingDraft;
    inputLocked: boolean;
    pendingCommand: CreateMeetingSeriesCommand | null;
    projection: ResolvedSetupState['projection'];
    onChange(value: MeetingDraft): void;
    onBusyChange(busy: boolean): void;
    onCommitted(): Promise<void>;
    onSettled(): void;
    onUnknown(command: CreateMeetingSeriesCommand): void;
}>) {
    const [message, setMessage] = useState('课节会引用课程教师；未知地点请明确选择 TBA。');
    const [saving, setSaving] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<SetupFieldErrors>({});
    const formRef = useRef<HTMLFormElement>(null);
    const messageRef = useRef<HTMLParagraphElement>(null);
    const writable = props.dataMode === 'ready';
    const currentCourses = props.projection.courses.filter(course => (
        course.termId === props.projection.currentTerm?.termId && !course.archived
    ));
    const selectedCourse = currentCourses.find(course => course.courseId === props.draft.courseId);

    const changeField = <Field extends keyof MeetingDraft>(
        field: Field,
        value: MeetingDraft[Field],
    ): void => {
        props.onChange({ ...props.draft, [field]: value });
        setFieldErrors({});
        setMessage('有未提交输入；正式课节尚未改变。');
    };

    const changeCourse = (courseId: string): void => {
        const course = currentCourses.find(candidate => candidate.courseId === courseId);
        props.onChange({
            ...props.draft,
            courseId,
            effectiveStartDate: course?.teachingRange.startDate ?? props.draft.effectiveStartDate,
            effectiveEndDate: course?.teachingRange.endDate ?? props.draft.effectiveEndDate,
        });
        setFieldErrors({});
        setMessage('已切换课程并采用它的教学范围；正式课节尚未改变。');
    };

    const submitMeeting = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault();
        if (!writable || saving || props.blocked) {
            return;
        }

        const validationErrors = combineSetupFieldErrors(
            MEETING_NATIVE_FIELD_MESSAGES,
            setupNativeFieldErrors(event.currentTarget, MEETING_NATIVE_FIELD_MESSAGES),
            setupSemanticFailureErrors({ kind: 'meeting', draft: props.draft }),
        );
        if (Object.keys(validationErrors).length > 0) {
            setFieldErrors(validationErrors);
            setMessage('请修正已标注的课节字段；正式数据没有改变。');
            focusFirstSetupFieldError(event.currentTarget, validationErrors);
            return;
        }
        if (selectedCourse === undefined) {
            const errors = { 'meeting-course': '请选择一门当前课程。' };
            setFieldErrors(errors);
            setMessage('请修正已标注的课节字段；正式数据没有改变。');
            focusFirstSetupFieldError(event.currentTarget, errors);
            return;
        }

        let command = props.pendingCommand;
        try {
            command ??= normalizeCreateMeetingSeriesCommand({
                commandId: globalThis.crypto.randomUUID(),
                followUpId: globalThis.crypto.randomUUID(),
                overlapDecision: 'review',
                expectedRevision: props.projection.workspaceRevision,
                expectedPlanVersion: props.projection.planEntityVersion,
                expectedCourseVersion: selectedCourse.entityVersion,
                intent: {
                    kind: 'plan.create-meeting-series',
                    intentSchemaVersion: 1,
                    payload: {
                        courseId: props.draft.courseId,
                        meeting: {
                            type: props.draft.meetingType,
                            weekday: props.draft.weekday,
                            localStart: props.draft.localStart,
                            localEnd: props.draft.localEnd,
                            endDayOffset: props.draft.endDayOffset,
                            effectiveRange: props.draft.effectiveStartDate
                                === selectedCourse.teachingRange.startDate
                                && props.draft.effectiveEndDate === selectedCourse.teachingRange.endDate
                                ? { kind: 'inherit-course' }
                                : {
                                    kind: 'explicit',
                                    startDate: props.draft.effectiveStartDate,
                                    endDate: props.draft.effectiveEndDate,
                                },
                            location: props.draft.locationKind === 'tba'
                                ? { kind: 'tba' }
                                : { kind: 'known', value: props.draft.locationValue },
                        },
                    },
                },
            });
        }
        catch {
            const semanticErrors = setupSemanticFailureErrors({ kind: 'meeting', draft: props.draft });
            const errors = Object.keys(semanticErrors).length === 0
                ? { 'meeting-course': '课节资料不符合保存规则，请从课程开始核对。' }
                : semanticErrors;
            setFieldErrors(errors);
            setMessage('请修正已标注的课节字段；正式数据没有改变。');
            focusFirstSetupFieldError(formRef.current, errors);
            return;
        }

        setSaving(true);
        props.onBusyChange(true);
        setMessage('正在正式保存课节…');
        let outcome: WorkspaceSetupOutcome;
        try {
            outcome = await window.courseFlow.createMeetingSeries(command);
        }
        catch {
            setSaving(false);
            props.onBusyChange(false);
            props.onUnknown(command);
            setMessage('无法连接本地 Workspace；提交结果尚无法确认，全部输入和本次请求仍保留。');
            focusStatus(messageRef);
            return;
        }
        if (!outcome.ok && outcome.problem.details?.reason === 'meeting-time-overlap') {
            props.onSettled();
            const conflicts = outcome.problem.details.warnings
                .slice(0, 5)
                .map(warning => (
                    `${warning.proposed.courseCode} ${warning.proposed.startInstant}–`
                    + `${warning.proposed.endInstant} / ${warning.existing.courseCode} `
                    + `${warning.existing.startInstant}–${warning.existing.endInstant}`
                ))
                .join('\n');
            const shouldContinue = globalThis.confirm(
                `${outcome.problem.message}\n\n${conflicts}\n\n是否仍按原时间保存？`,
            );
            if (!shouldContinue) {
                setSaving(false);
                props.onBusyChange(false);
                setMessage('已保留全部输入；正式数据没有改变。');
                return;
            }
            command = normalizeCreateMeetingSeriesCommand({
                ...command,
                overlapDecision: 'continue',
            });
            try {
                outcome = await window.courseFlow.createMeetingSeries(command);
            }
            catch {
                setSaving(false);
                props.onBusyChange(false);
                props.onUnknown(command);
                setMessage('无法连接本地 Workspace；提交结果尚无法确认，全部输入和本次请求仍保留。');
                focusStatus(messageRef);
                return;
            }
        }
        if (!outcome.ok) {
            setSaving(false);
            props.onBusyChange(false);
            if (outcome.problem.dataEffect === 'unknown') {
                props.onUnknown(command);
            }
            else {
                props.onSettled();
            }
            setMessage(setupMutationProblemMessage(outcome.problem, '正式数据没有改变。'));
            focusStatus(messageRef);
            return;
        }

        props.onSettled();
        await props.onCommitted();
        setSaving(false);
        props.onBusyChange(false);
    };

    return (
        <form
            className="setup-form activity-form"
            noValidate
            onSubmit={submitMeeting}
            ref={formRef}
        >
            <h3>课节详情</h3>
            <fieldset
                className="form-control-group"
                disabled={!writable || saving || props.blocked || props.inputLocked}
            >
                <legend className="visually-hidden">课节资料</legend>
                <label className="field field--full">
                    <span>课程</span>
                    <select
                        {...setupFieldErrorAttributes('meeting-course', fieldErrors)}
                        name="meeting-course"
                        onChange={event => changeCourse(event.target.value)}
                        required
                        value={props.draft.courseId}
                    >
                        <option value="">选择课程</option>
                        {currentCourses.map(course => (
                            <option
                                key={course.courseId}
                                value={course.courseId}
                            >{course.code} · {course.name}</option>
                        ))}
                    </select>
                    <SetupFieldError
                        errors={fieldErrors}
                        name="meeting-course"
                    />
                </label>
                <label className="field">
                    <span>课节类型</span>
                    <select
                        name="meeting-type"
                        onChange={event => changeField('meetingType', event.target.value as MeetingTypeCode)}
                        required
                        value={props.draft.meetingType}
                    >
                        <option value="LEC">LEC — Lecture</option>
                        <option value="TUT">TUT — Tutorial</option>
                        <option value="PRA">PRA — Practical</option>
                    </select>
                </label>
                <label className="field">
                    <span>星期</span>
                    <select
                        name="meeting-weekday"
                        onChange={event => changeField('weekday', event.target.value as MeetingWeekday)}
                        required
                        value={props.draft.weekday}
                    >
                        {Object.entries(WEEKDAY_NAMES).map(([value, label]) => (
                            <option
                                key={value}
                                value={value}
                            >{label}</option>
                        ))}
                    </select>
                </label>
                <label className="field">
                    <span>开始时间</span>
                    <input
                        {...setupFieldErrorAttributes('meeting-start', fieldErrors)}
                        name="meeting-start"
                        onChange={event => changeField('localStart', event.target.value)}
                        required
                        type="time"
                        value={props.draft.localStart}
                    />
                    <SetupFieldError
                        errors={fieldErrors}
                        name="meeting-start"
                    />
                </label>
                <label className="field">
                    <span>结束时间</span>
                    <input
                        {...setupFieldErrorAttributes('meeting-end', fieldErrors)}
                        name="meeting-end"
                        onChange={event => changeField('localEnd', event.target.value)}
                        required
                        type="time"
                        value={props.draft.localEnd}
                    />
                    <SetupFieldError
                        errors={fieldErrors}
                        name="meeting-end"
                    />
                </label>
                <label className="field">
                    <span>结束日</span>
                    <select
                        name="meeting-end-day"
                        onChange={event => changeField('endDayOffset', Number(event.target.value) as 0 | 1)}
                        value={props.draft.endDayOffset}
                    >
                        <option value={0}>同日</option>
                        <option value={1}>次日</option>
                    </select>
                </label>
                <label className="field">
                    <span>生效开始日期</span>
                    <input
                        {...setupFieldErrorAttributes('meeting-effective-start', fieldErrors)}
                        max={selectedCourse?.teachingRange.endDate}
                        min={selectedCourse?.teachingRange.startDate}
                        name="meeting-effective-start"
                        onChange={event => changeField('effectiveStartDate', event.target.value)}
                        required
                        type="date"
                        value={props.draft.effectiveStartDate}
                    />
                    <SetupFieldError
                        errors={fieldErrors}
                        name="meeting-effective-start"
                    />
                </label>
                <label className="field">
                    <span>生效结束日期</span>
                    <input
                        {...setupFieldErrorAttributes('meeting-effective-end', fieldErrors)}
                        max={selectedCourse?.teachingRange.endDate}
                        min={props.draft.effectiveStartDate || selectedCourse?.teachingRange.startDate}
                        name="meeting-effective-end"
                        onChange={event => changeField('effectiveEndDate', event.target.value)}
                        required
                        type="date"
                        value={props.draft.effectiveEndDate}
                    />
                    <SetupFieldError
                        errors={fieldErrors}
                        name="meeting-effective-end"
                    />
                </label>
                <div
                    aria-labelledby="meeting-location-label"
                    className="location-choice field--full"
                    role="group"
                >
                    <span id="meeting-location-label">地点</span>
                    <label className="radio-option">
                        <input
                            checked={props.draft.locationKind === 'known'}
                            name="location-kind"
                            onChange={() => changeField('locationKind', 'known')}
                            type="radio"
                            value="known"
                        />
                        已知地点
                    </label>
                    <label className="radio-option">
                        <input
                            checked={props.draft.locationKind === 'tba'}
                            name="location-kind"
                            onChange={() => changeField('locationKind', 'tba')}
                            type="radio"
                            value="tba"
                        />
                        待定（TBA）
                    </label>
                    {props.draft.locationKind === 'known' ? (
                        <label className="field location-input">
                            <span>地点名称</span>
                            <input
                                {...setupFieldErrorAttributes('meeting-location', fieldErrors)}
                                maxLength={240}
                                name="meeting-location"
                                onChange={event => changeField('locationValue', event.target.value)}
                                placeholder="例如：BA 1170"
                                required
                                type="text"
                                value={props.draft.locationValue}
                            />
                            <SetupFieldError
                                errors={fieldErrors}
                                name="meeting-location"
                            />
                        </label>
                    ) : null}
                </div>
            </fieldset>
            <FormStatus
                action={props.pendingCommand === null ? '保存课节' : '精确重试保存课节'}
                message={message}
                messageRef={messageRef}
                saving={saving || props.blocked}
                writable={writable}
            />
        </form>
    );
}

/**
 * Creates a real once or weekly Task for a current Course.
 *
 * @param {object} props Controlled Task draft and formal projection.
 * @return {JSX.Element} Task alternative form.
 */
function TaskForm(props: Readonly<{
    blocked: boolean;
    dataMode: 'ready' | 'read-only';
    draft: TaskDraft;
    inputLocked: boolean;
    pendingCommand: CreateTaskCommand | null;
    projection: ResolvedSetupState['projection'];
    onChange(value: TaskDraft): void;
    onBusyChange(busy: boolean): void;
    onCommitted(): Promise<void>;
    onSettled(): void;
    onUnknown(command: CreateTaskCommand): void;
}>) {
    const [message, setMessage] = useState('一次性任务可用日期、精确时间或 TBA；每周任务需要确认范围。');
    const [saving, setSaving] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<SetupFieldErrors>({});
    const formRef = useRef<HTMLFormElement>(null);
    const messageRef = useRef<HTMLParagraphElement>(null);
    const writable = props.dataMode === 'ready';
    const currentCourses = props.projection.courses.filter(course => (
        course.termId === props.projection.currentTerm?.termId && !course.archived
    ));
    const currentTerm = props.projection.currentTerm;
    const selectedCourse = currentCourses.find(course => course.courseId === props.draft.courseId);

    /**
     * Updates one controlled Task draft field.
     *
     * @param {keyof TaskDraft} field Edited field.
     * @param {TaskDraft[keyof TaskDraft]} value Current input value.
     * @return {void}
     */
    const changeField = <Field extends keyof TaskDraft>(
        field: Field,
        value: TaskDraft[Field],
    ): void => {
        props.onChange({ ...props.draft, [field]: value });
        setFieldErrors({});
        setMessage('有未提交输入；正式任务尚未改变。');
    };

    const changeCourse = (courseId: string): void => {
        const course = currentCourses.find(candidate => candidate.courseId === courseId);
        props.onChange({
            ...props.draft,
            courseId,
            weeklyStartDate: course?.teachingRange.startDate ?? props.draft.weeklyStartDate,
            weeklyEndDate: course?.teachingRange.endDate ?? props.draft.weeklyEndDate,
        });
        setFieldErrors({});
        setMessage('已切换课程并采用它的教学范围；正式任务尚未改变。');
    };

    /**
     * Normalizes and submits one approved once or weekly Task schedule.
     *
     * @param {FormEvent<HTMLFormElement>} event Native form submit event.
     * @return {Promise<void>}
     */
    const submitTask = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault();
        if (!writable || saving || props.blocked) {
            return;
        }

        if (currentTerm === null) {
            return;
        }

        const validationErrors = combineSetupFieldErrors(
            TASK_NATIVE_FIELD_MESSAGES,
            setupNativeFieldErrors(event.currentTarget, TASK_NATIVE_FIELD_MESSAGES),
            setupSemanticFailureErrors({ kind: 'task', draft: props.draft }),
        );
        if (Object.keys(validationErrors).length > 0) {
            setFieldErrors(validationErrors);
            setMessage('请修正已标注的任务字段；正式数据没有改变。');
            focusFirstSetupFieldError(event.currentTarget, validationErrors);
            return;
        }
        if (selectedCourse === undefined) {
            const errors = { 'task-course': '请选择一门当前课程。' };
            setFieldErrors(errors);
            setMessage('请修正已标注的任务字段；正式数据没有改变。');
            focusFirstSetupFieldError(event.currentTarget, errors);
            return;
        }

        let command = props.pendingCommand;
        try {
            const schedule = props.draft.scheduleKind === 'weekly'
                ? {
                    kind: 'weekly' as const,
                    startDate: props.draft.weeklyStartDate,
                    weekday: props.draft.weeklyWeekday,
                    localDeadlineTime: props.draft.weeklyDeadlineTime,
                    confirmedEndDate: props.draft.weeklyEndDate,
                    followTeachingWeek: props.draft.followTeachingWeek,
                }
                : null;
            const deadline = props.draft.deadlineKind === 'tba'
                ? { kind: 'tba' as const }
                : props.draft.deadlineKind === 'date-only'
                    ? { kind: 'date-only' as const, date: props.draft.deadlineDate }
                    : {
                        kind: 'timed' as const,
                        instant: INTL_ZONE_RULES.resolveInstant(
                            currentTerm.timeZone,
                            props.draft.deadlineDate,
                            props.draft.deadlineTime,
                        ),
                        timeZone: currentTerm.timeZone,
                    };
            command ??= normalizeCreateTaskCommand({
                commandId: globalThis.crypto.randomUUID(),
                followUpId: globalThis.crypto.randomUUID(),
                expectedRevision: props.projection.workspaceRevision,
                expectedPlanVersion: props.projection.planEntityVersion,
                intent: {
                    kind: 'plan.create-task-series',
                    intentSchemaVersion: schedule === null ? 1 : 2,
                    payload: schedule === null
                        ? {
                            courseId: props.draft.courseId,
                            title: props.draft.title,
                            size: props.draft.size,
                            deadline,
                        }
                        : {
                            courseId: props.draft.courseId,
                            title: props.draft.title,
                            size: props.draft.size,
                            schedule,
                        },
                },
            });
        }
        catch {
            const semanticErrors = setupSemanticFailureErrors({ kind: 'task', draft: props.draft });
            const errors = Object.keys(semanticErrors).length === 0
                ? { 'task-title': '任务资料不符合保存规则，请从标题开始核对。' }
                : semanticErrors;
            setFieldErrors(errors);
            setMessage('请修正已标注的任务字段；正式数据没有改变。');
            focusFirstSetupFieldError(formRef.current, errors);
            return;
        }

        setSaving(true);
        props.onBusyChange(true);
        setMessage('正在正式保存任务…');
        let outcome: WorkspaceSetupOutcome;
        try {
            outcome = await window.courseFlow.createTask(command);
        }
        catch {
            setSaving(false);
            props.onBusyChange(false);
            props.onUnknown(command);
            setMessage('无法连接本地 Workspace；提交结果尚无法确认，全部输入和本次请求仍保留。');
            focusStatus(messageRef);
            return;
        }
        if (!outcome.ok) {
            setSaving(false);
            props.onBusyChange(false);
            if (outcome.problem.dataEffect === 'unknown') {
                props.onUnknown(command);
            }
            else {
                props.onSettled();
            }
            setMessage(setupMutationProblemMessage(outcome.problem, '正式数据没有改变。'));
            focusStatus(messageRef);
            return;
        }

        props.onSettled();
        await props.onCommitted();
        setSaving(false);
        props.onBusyChange(false);
    };

    return (
        <form
            className="setup-form activity-form"
            noValidate
            onSubmit={submitTask}
            ref={formRef}
        >
            <h3>任务详情</h3>
            <fieldset
                className="form-control-group"
                disabled={!writable || saving || props.blocked || props.inputLocked}
            >
                <legend className="visually-hidden">任务资料</legend>
                <label className="field field--full">
                    <span>课程</span>
                    <select
                        {...setupFieldErrorAttributes('task-course', fieldErrors)}
                        name="task-course"
                        onChange={event => changeCourse(event.target.value)}
                        required
                        value={props.draft.courseId}
                    >
                        <option value="">选择课程</option>
                        {currentCourses.map(course => (
                            <option
                                key={course.courseId}
                                value={course.courseId}
                            >{course.code} · {course.name}</option>
                        ))}
                    </select>
                    <SetupFieldError
                        errors={fieldErrors}
                        name="task-course"
                    />
                </label>
                <label className="field field--full">
                    <span>任务标题</span>
                    <input
                        {...setupFieldErrorAttributes('task-title', fieldErrors)}
                        maxLength={240}
                        name="task-title"
                        onChange={event => changeField('title', event.target.value)}
                        required
                        type="text"
                        value={props.draft.title}
                    />
                    <SetupFieldError
                        errors={fieldErrors}
                        name="task-title"
                    />
                </label>
                <label className="field">
                    <span>任务规模</span>
                    <select
                        name="task-size"
                        onChange={event => changeField('size', event.target.value as TaskDraft['size'])}
                        value={props.draft.size}
                    >
                        <option value="small">小任务</option>
                        <option value="large">大任务</option>
                    </select>
                </label>
                <label className="field">
                    <span>任务安排</span>
                    <select
                        name="task-schedule-kind"
                        onChange={event => changeField(
                            'scheduleKind',
                            event.target.value as TaskDraft['scheduleKind'],
                        )}
                        value={props.draft.scheduleKind}
                    >
                        <option value="once">一次性</option>
                        <option value="weekly">每周重复</option>
                    </select>
                </label>
                {props.draft.scheduleKind === 'once' ? (
                    <>
                        <label className="field">
                            <span>截止状态</span>
                            <select
                                name="task-deadline-kind"
                                onChange={event => changeField(
                                    'deadlineKind',
                                    event.target.value as TaskDraft['deadlineKind'],
                                )}
                                value={props.draft.deadlineKind}
                            >
                                <option value="tba">待定（TBA）</option>
                                <option value="date-only">纯日期</option>
                                <option value="timed">精确时间</option>
                            </select>
                        </label>
                        {props.draft.deadlineKind !== 'tba' ? (
                            <label className="field">
                                <span>截止日期</span>
                                <input
                                    {...setupFieldErrorAttributes('task-deadline-date', fieldErrors)}
                                    max={selectedCourse?.teachingRange.endDate}
                                    min={selectedCourse?.teachingRange.startDate}
                                    name="task-deadline-date"
                                    onChange={event => changeField('deadlineDate', event.target.value)}
                                    required
                                    type="date"
                                    value={props.draft.deadlineDate}
                                />
                                <SetupFieldError
                                    errors={fieldErrors}
                                    name="task-deadline-date"
                                />
                            </label>
                        ) : null}
                        {props.draft.deadlineKind === 'timed' ? (
                            <label className="field">
                                <span>截止时间 · {currentTerm?.timeZone ?? '学期时区未知'}</span>
                                <input
                                    {...setupFieldErrorAttributes('task-deadline-time', fieldErrors)}
                                    name="task-deadline-time"
                                    onChange={event => changeField('deadlineTime', event.target.value)}
                                    required
                                    type="time"
                                    value={props.draft.deadlineTime}
                                />
                                <SetupFieldError
                                    errors={fieldErrors}
                                    name="task-deadline-time"
                                />
                            </label>
                        ) : null}
                    </>
                ) : (
                    <>
                        <label className="field">
                            <span>重复开始日期</span>
                            <input
                                {...setupFieldErrorAttributes('task-weekly-start', fieldErrors)}
                                max={selectedCourse?.teachingRange.endDate}
                                min={selectedCourse?.teachingRange.startDate}
                                name="task-weekly-start"
                                onChange={event => changeField('weeklyStartDate', event.target.value)}
                                required
                                type="date"
                                value={props.draft.weeklyStartDate}
                            />
                            <SetupFieldError
                                errors={fieldErrors}
                                name="task-weekly-start"
                            />
                        </label>
                        <label className="field">
                            <span>星期</span>
                            <select
                                name="task-weekly-weekday"
                                onChange={event => changeField(
                                    'weeklyWeekday',
                                    event.target.value as MeetingWeekday,
                                )}
                                value={props.draft.weeklyWeekday}
                            >
                                {Object.entries(WEEKDAY_NAMES).map(([value, label]) => (
                                    <option
                                        key={value}
                                        value={value}
                                    >{label}</option>
                                ))}
                            </select>
                        </label>
                        <label className="field">
                            <span>每周截止时间</span>
                            <input
                                {...setupFieldErrorAttributes('task-weekly-deadline-time', fieldErrors)}
                                name="task-weekly-deadline-time"
                                onChange={event => changeField('weeklyDeadlineTime', event.target.value)}
                                required
                                type="time"
                                value={props.draft.weeklyDeadlineTime}
                            />
                            <SetupFieldError
                                errors={fieldErrors}
                                name="task-weekly-deadline-time"
                            />
                        </label>
                        <label className="field">
                            <span>确认结束日期</span>
                            <input
                                {...setupFieldErrorAttributes('task-weekly-end', fieldErrors)}
                                max={selectedCourse?.teachingRange.endDate}
                                min={props.draft.weeklyStartDate || undefined}
                                name="task-weekly-end"
                                onChange={event => changeField('weeklyEndDate', event.target.value)}
                                required
                                type="date"
                                value={props.draft.weeklyEndDate}
                            />
                            <SetupFieldError
                                errors={fieldErrors}
                                name="task-weekly-end"
                            />
                        </label>
                        <label className="check-option field--full">
                            <input
                                checked={props.draft.followTeachingWeek}
                                name="task-follow-teaching-week"
                                onChange={event => changeField('followTeachingWeek', event.target.checked)}
                                type="checkbox"
                            />
                            <span>跟随教学周；命名假期内暂停这条每周任务</span>
                        </label>
                        {currentTermHolidayCount(props.projection) === 0 ? (
                            <p
                                className="form-hint field--full"
                                role="status"
                            >
                                当前还没有命名假期。可先保存任务；最低条件满足后可添加假期，
                                或明确选择暂不添加。
                            </p>
                        ) : null}
                    </>
                )}
            </fieldset>
            <FormStatus
                action={props.pendingCommand === null ? '保存任务' : '精确重试保存任务'}
                message={message}
                messageRef={messageRef}
                saving={saving || props.blocked}
                writable={writable}
            />
        </form>
    );
}

/**
 * Renders one form's textual save status and primary submit action.
 *
 * @param {object} props Message, capability, and button label.
 * @return {JSX.Element} Shared form footer.
 */
function FormStatus(props: Readonly<{
    action: string;
    message: string;
    messageRef: Readonly<{ current: HTMLParagraphElement | null }>;
    saving: boolean;
    writable: boolean;
}>) {
    return (
        <div className="form-footer field--full">
            <p
                ref={props.messageRef}
                role="status"
                tabIndex={-1}
            >
                {props.writable
                    ? props.message
                    : '本地数据为只读；可以查看，但不能正式保存。'}
            </p>
            <button
                className="primary-action"
                disabled={!props.writable || props.saving}
                type="submit"
            >{props.saving ? '正在保存…' : props.action}</button>
        </div>
    );
}
