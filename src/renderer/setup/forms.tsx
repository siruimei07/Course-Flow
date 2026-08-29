import type { KeyboardEvent } from 'react';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { ResolvedSetupState } from '../SetupDialog';
import type { CourseDraft, HolidayDraft, MeetingDraft, SetupDraft, TaskDraft, TermDraft } from '../setup-draft';
import { currentTermHolidayCount } from './checklist';
import { COURSE_NATIVE_FIELD_MESSAGES, HOLIDAY_NATIVE_FIELD_MESSAGES, MEETING_NATIVE_FIELD_MESSAGES, SetupFieldError, TASK_NATIVE_FIELD_MESSAGES, TERM_NATIVE_FIELD_MESSAGES, combineSetupFieldErrors, focusFirstSetupFieldError, focusStatus, setupFieldErrorAttributes, setupNativeFieldErrors, setupSemanticFailureErrors } from './field-errors';
import type { SetupFieldErrors } from './field-errors';
import { COURSE_COLOR_NAMES, WEEKDAY_NAMES } from './labels';
import { setupMutationProblemMessage } from './mutation';
import type { PendingSetupMutation } from './mutation';
import { INTL_ZONE_RULES } from '../../shared/meeting-time';
import { CourseColor, CreateCourseCommand, CreateMeetingSeriesCommand, MeetingTypeCode, normalizeCreateCourseCommand, normalizeCreateMeetingSeriesCommand } from '../../shared/workspace-course-contract';
import type { MeetingWeekday } from '../../shared/workspace-course-contract';
import { CreateHolidayRangeCommand, normalizeCreateHolidayRangeCommand } from '../../shared/workspace-holiday-contract';
import { WorkspaceSetupOutcome } from '../../shared/workspace-setup-contract';
import { CreateTaskCommand, normalizeCreateTaskCommand } from '../../shared/workspace-task-contract';
import { CreateTermCommand, normalizeCreateTermCommand } from '../../shared/workspace-term-contract';
/**
 * Adds the approved non-blocking HolidayRange branch after the minimum is satisfied.
 *
 * @param {object} props Controlled optional Holiday draft and formal commit callbacks.
 * @return {JSX.Element | null} HolidayRange form or no surface without a Current Term.
 */
export function HolidayForm(props: Readonly<{
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
export function TermForm(props: Readonly<{
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
            <p className="eyebrow">当前学期</p>
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
export function CourseForm(props: Readonly<{
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
            <p className="eyebrow">课程 · {currentTerm.name}</p>
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
 * Creates a real MeetingSeries for a current Course.
 *
 * @param {object} props Controlled Meeting draft and formal projection.
 * @return {JSX.Element} Meeting form.
 */
export function MeetingForm(props: Readonly<{
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
export function TaskForm(props: Readonly<{
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
export function FormStatus(props: Readonly<{
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
