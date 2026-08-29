import type { CourseDraft, HolidayDraft, MeetingDraft, TaskDraft, TermDraft } from '../setup-draft';
import { normalizeCreateCourseCommand } from '../../shared/workspace-course-contract';
export type SetupFieldErrors = Readonly<Record<string, string>>;

export type SetupSemanticFailure =
    | Readonly<{ kind: 'term'; draft: TermDraft }>
    | Readonly<{ kind: 'course'; draft: CourseDraft }>
    | Readonly<{ kind: 'meeting'; draft: MeetingDraft }>
    | Readonly<{ kind: 'task'; draft: TaskDraft }>
    | Readonly<{ kind: 'holiday'; draft: HolidayDraft }>;

export const TERM_NATIVE_FIELD_MESSAGES = {
    'term-name': '请输入学期名称。',
    'term-start-date': '请选择有效的学期开始日期。',
    'term-end-date': '结束日期不能早于开始日期。',
    'term-time-zone': '请输入 IANA 时区名称。',
} as const;

export const COURSE_NATIVE_FIELD_MESSAGES = {
    'course-code': '请输入课程代码。',
    'course-name': '请输入课程名称。',
    'course-credits': '学分格式或数值范围无效；请使用例如 3 或 0.5 的非负十进制数。',
    'course-teaching-start': '课程教学开始日期必须在当前学期范围内。',
    'course-teaching-end': '课程教学结束日期不能早于开始日期，且必须在当前学期范围内。',
} as const;

export const MEETING_NATIVE_FIELD_MESSAGES = {
    'meeting-course': '请选择一门当前课程。',
    'meeting-type': '请选择课节类型。',
    'meeting-weekday': '请选择课节星期。',
    'meeting-start': '请输入有效的课节开始时间。',
    'meeting-end': '请输入有效的课节结束时间。',
    'meeting-effective-start': '课节生效开始日期必须在课程教学范围内。',
    'meeting-effective-end': '课节生效结束日期不能早于开始日期，且必须在课程教学范围内。',
    'meeting-location': '请输入已知地点，或选择 TBA。',
} as const;

export const TASK_NATIVE_FIELD_MESSAGES = {
    'task-course': '请选择一门当前课程。',
    'task-title': '请输入任务标题。',
    'task-deadline-date': '任务截止日期必须在课程教学范围内。',
    'task-deadline-time': '请输入有效的任务截止时间。',
    'task-weekly-start': '每周任务开始日期必须在课程教学范围内。',
    'task-weekly-deadline-time': '请输入有效的每周截止时间。',
    'task-weekly-end': '确认结束日期不能早于开始日期，且必须在课程教学范围内。',
} as const;

export const HOLIDAY_NATIVE_FIELD_MESSAGES = {
    'holiday-name': '请输入假期名称。',
    'holiday-start-date': '假期开始日期必须在当前学期范围内。',
    'holiday-end-date': '假期结束日期不能早于开始日期，且必须在当前学期范围内。',
} as const;

/**
 * Checks an optional credits value through the shared Course command normalizer.
 * @param {string} credits Controlled credits text.
 * @return {boolean} Whether the shared normalizer accepts the value.
 */
export function courseCreditsAreAccepted(credits: string): boolean {
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
export function combineSetupFieldErrors(
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
 * Moves focus to a newly rendered textual problem.
 *
 * @param {React.RefObject<HTMLElement | null>} target Problem status ref.
 * @return {void}
 */
export function focusStatus(target: Readonly<{ current: HTMLElement | null }>): void {
    globalThis.requestAnimationFrame(() => target.current?.focus());
}
