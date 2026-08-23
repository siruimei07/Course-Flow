/**
 * @file Renders the bounded first-run Term, Course, and Meeting setup flow.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import {
    normalizeCreateCourseWithMeetingCommand,
    type CreateCourseWithMeetingCommand,
    type CourseColor,
    type MeetingTypeCode,
    type MeetingWeekday,
} from '../shared/workspace-course-contract';
import {
    normalizeCreateTermCommand,
    type CreateTermCommand,
    type SetupProjection,
} from '../shared/workspace-term-contract';
import { setupStateFrom, type SetupState } from './setup-state';

type TermDraft = Readonly<{
    name: string;
    startDate: string;
    endDate: string;
    timeZone: string;
}>;

type CourseDraft = Readonly<{
    code: string;
    name: string;
    section: string;
    instructor: string;
    color: CourseColor | '';
    credits: string;
    meetingType: MeetingTypeCode;
    weekday: MeetingWeekday;
    localStart: string;
    localEnd: string;
    effectiveStartDate: string;
    effectiveEndDate: string;
    locationKind: 'known' | 'tba';
    locationValue: string;
}>;

const emptyTermDraft: TermDraft = {
    name: '',
    startDate: '',
    endDate: '',
    timeZone: '',
};

const courseColorNames: Record<CourseColor, string> = {
    red: '红色',
    orange: '橙色',
    yellow: '黄色',
    green: '绿色',
    blue: '蓝色',
    purple: '紫色',
    gray: '灰色',
};

const weekdayNames: Record<MeetingWeekday, string> = {
    MON: '星期一',
    TUE: '星期二',
    WED: '星期三',
    THU: '星期四',
    FRI: '星期五',
    SAT: '星期六',
    SUN: '星期日',
};

async function loadSetupState(): Promise<SetupState> {
    const bootstrap = await window.courseFlow.query();
    if (!bootstrap.ok) {
        return { kind: 'problem', message: bootstrap.problem.message };
    }
    if (bootstrap.value.workspaceData.kind === 'recovery') {
        return { kind: 'problem', message: '本地数据需要恢复，当前无法继续设置。' };
    }
    if (bootstrap.value.workspaceData.kind === 'absent') {
        const initialized = await window.courseFlow.initialize();
        if (!initialized.ok) {
            return { kind: 'problem', message: initialized.problem.message };
        }
    }

    return setupStateFrom(await window.courseFlow.querySetup());
}

function App() {
    const [state, setState] = useState<SetupState>({ kind: 'loading' });

    const load = () => {
        setState({ kind: 'loading' });
        void loadSetupState().then(setState).catch(() => {
            setState({ kind: 'problem', message: '无法连接本地 Workspace，请重试。' });
        });
    };

    useEffect(load, []);

    return (
        <main
            aria-labelledby="app-title"
            className="app-shell"
        >
            <header className="brand-header">
                <span
                    aria-hidden="true"
                    className="brand-mark"
                >C</span>
                <span
                    className="brand-name"
                    id="app-title"
                >CourseFlow</span>
            </header>

            {state.kind === 'loading' ? (
                <section
                    aria-live="polite"
                    className="status-card"
                >
                    <span
                        aria-hidden="true"
                        className="status-dot"
                    />
                    <p>正在读取本地工作区…</p>
                </section>
            ) : null}
            {state.kind === 'problem' ? (
                <section
                    aria-labelledby="problem-title"
                    className="status-card status-card--problem"
                >
                    <p className="eyebrow">本地工作区暂不可用</p>
                    <h1 id="problem-title">设置尚未完成</h1>
                    <p role="alert">{state.message}</p>
                    <button
                        className="secondary-action"
                        onClick={load}
                        type="button"
                    >重试</button>
                </section>
            ) : null}
            {state.kind === 'term' ? (
                <SetupTerm
                    dataMode={state.dataMode}
                    projection={state.projection}
                    onComplete={setState}
                />
            ) : null}
            {state.kind === 'course' ? (
                <SetupCourse
                    dataMode={state.dataMode}
                    projection={state.projection}
                    onComplete={setState}
                />
            ) : null}
            {state.kind === 'complete' ? <SetupComplete projection={state.projection} /> : null}
        </main>
    );
}

function SetupProgress({ step }: Readonly<{ step: 1 | 2 }>) {
    return (
        <aside
            aria-label="设置进度"
            className="setup-progress"
        >
            <p className="eyebrow">首次设置</p>
            <h1 id="setup-title">准备好你的课表</h1>
            <p className="setup-intro">先确定学期，再录入一门课程及其首个固定课节。</p>
            <ol className="progress-list">
                <li
                    aria-current={step === 1 ? 'step' : undefined}
                    className={step === 2 ? 'is-complete' : ''}
                >
                    <span className="progress-number">{step === 2 ? '✓' : '1'}</span>
                    <span>
                        <strong>当前学期</strong>
                        <small>名称、日期与时区</small>
                    </span>
                </li>
                <li aria-current={step === 2 ? 'step' : undefined}>
                    <span className="progress-number">2</span>
                    <span>
                        <strong>课程与首个课节</strong>
                        <small>课程事实与每周时间</small>
                    </span>
                </li>
            </ol>
            <p className="local-note"><span aria-hidden="true">●</span> 本地优先 · 无需账户</p>
        </aside>
    );
}

function SetupTerm(props: Readonly<{
    dataMode: 'ready' | 'read-only';
    projection: SetupProjection;
    onComplete(state: SetupState): void;
}>) {
    const [draft, setDraft] = useState<TermDraft>(emptyTermDraft);
    const [message, setMessage] = useState('所有信息只保存在这台设备上。');
    const [saving, setSaving] = useState(false);
    const pendingCommand = useRef<CreateTermCommand | undefined>(undefined);
    const writable = props.dataMode === 'ready';

    const updateDraft = (field: keyof TermDraft, value: string) => {
        pendingCommand.current = undefined;
        setDraft(current => ({ ...current, [field]: value }));
        setMessage('所有信息只保存在这台设备上。');
    };

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!writable || saving) {
            return;
        }

        try {
            pendingCommand.current ??= normalizeCreateTermCommand({
                commandId: globalThis.crypto.randomUUID(),
                followUpId: globalThis.crypto.randomUUID(),
                expectedRevision: props.projection.workspaceRevision,
                expectedPlanVersion: props.projection.planEntityVersion,
                intent: {
                    kind: 'plan.create-term',
                    intentSchemaVersion: 1,
                    payload: {
                        name: draft.name,
                        startDate: draft.startDate,
                        endDate: draft.endDate,
                        timeZone: draft.timeZone,
                    },
                },
            });
        }
        catch {
            setMessage('请检查学期名称、日期范围和 IANA 时区。');
            return;
        }

        setSaving(true);
        setMessage('正在正式保存当前学期…');
        const outcome = await window.courseFlow.createTerm(pendingCommand.current);
        if (!outcome.ok) {
            setSaving(false);
            setMessage(outcome.problem.message);
            return;
        }

        const refreshed = setupStateFrom(await window.courseFlow.querySetup());
        setSaving(false);
        props.onComplete(refreshed);
    };

    return (
        <section
            aria-labelledby="setup-title"
            className="setup-layout"
        >
            <SetupProgress step={1} />
            <div className="setup-form-panel">
                <div className="form-heading">
                    <p className="eyebrow">步骤 1 / 2</p>
                    <h2>创建当前学期</h2>
                    <p>日期用于界定学期；默认时区用于解释之后录入的本地时间。</p>
                </div>

                <form
                    className="setup-form"
                    onSubmit={submit}
                >
                    <label className="field field--full">
                        <span>学期名称</span>
                        <input
                            autoFocus
                            maxLength={120}
                            name="term-name"
                            placeholder="例如：2026 秋季学期"
                            required
                            type="text"
                            value={draft.name}
                            onChange={event => updateDraft('name', event.target.value)}
                        />
                    </label>

                    <label className="field">
                        <span>开始日期</span>
                        <input
                            name="start-date"
                            required
                            type="date"
                            value={draft.startDate}
                            onChange={event => updateDraft('startDate', event.target.value)}
                        />
                    </label>

                    <label className="field">
                        <span>结束日期</span>
                        <input
                            min={draft.startDate || undefined}
                            name="end-date"
                            required
                            type="date"
                            value={draft.endDate}
                            onChange={event => updateDraft('endDate', event.target.value)}
                        />
                    </label>

                    <label className="field field--full">
                        <span>默认时区</span>
                        <input
                            list="time-zone-options"
                            name="time-zone"
                            placeholder="例如：America/Toronto"
                            required
                            type="text"
                            value={draft.timeZone}
                            onChange={event => updateDraft('timeZone', event.target.value)}
                        />
                        <small>请输入 IANA 时区名称；不会用未知值代替。</small>
                    </label>
                    <datalist id="time-zone-options">
                        <option value="America/Toronto" />
                        <option value="America/Vancouver" />
                        <option value="America/New_York" />
                        <option value="Asia/Shanghai" />
                        <option value="Europe/London" />
                        <option value="UTC" />
                    </datalist>

                    <FormFooter
                        message={message}
                        problem={message.includes('请检查') || !writable}
                        saving={saving}
                        writable={writable}
                        action="创建并继续"
                    />
                </form>
            </div>
        </section>
    );
}

function initialCourseDraft(projection: SetupProjection): CourseDraft {
    const currentTerm = projection.currentTerm;
    if (!currentTerm) {
        throw new Error('Current Term is required for Course setup');
    }
    return {
        code: '',
        name: '',
        section: '',
        instructor: '',
        color: '',
        credits: '',
        meetingType: 'LEC',
        weekday: 'MON',
        localStart: '',
        localEnd: '',
        effectiveStartDate: currentTerm.startDate,
        effectiveEndDate: currentTerm.endDate,
        locationKind: 'known',
        locationValue: '',
    };
}

function SetupCourse(props: Readonly<{
    dataMode: 'ready' | 'read-only';
    projection: SetupProjection;
    onComplete(state: SetupState): void;
}>) {
    const [draft, setDraft] = useState<CourseDraft>(() => initialCourseDraft(props.projection));
    const [message, setMessage] = useState('课程与课节会在同一次提交中正式保存。');
    const [saving, setSaving] = useState(false);
    const pendingCommand = useRef<CreateCourseWithMeetingCommand | undefined>(undefined);
    const writable = props.dataMode === 'ready';
    const currentTerm = props.projection.currentTerm!;

    const updateDraft = <Field extends keyof CourseDraft>(field: Field, value: CourseDraft[Field]) => {
        pendingCommand.current = undefined;
        setDraft(current => ({ ...current, [field]: value }));
        setMessage('课程与课节会在同一次提交中正式保存。');
    };

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!writable || saving) {
            return;
        }

        try {
            pendingCommand.current ??= normalizeCreateCourseWithMeetingCommand({
                commandId: globalThis.crypto.randomUUID(),
                followUpId: globalThis.crypto.randomUUID(),
                expectedRevision: props.projection.workspaceRevision,
                expectedPlanVersion: props.projection.planEntityVersion,
                intent: {
                    kind: 'plan.create-course-with-first-meeting',
                    intentSchemaVersion: 2,
                    payload: {
                        course: {
                            code: draft.code,
                            name: draft.name,
                            section: draft.section.trim() || null,
                            instructor: draft.instructor.trim() || null,
                            color: draft.color || null,
                            credits: draft.credits.trim() || null,
                            teachingRange: { kind: 'inherit-term' },
                        },
                        meeting: {
                            type: draft.meetingType,
                            weekday: draft.weekday,
                            localStart: draft.localStart,
                            localEnd: draft.localEnd,
                            effectiveRange: draft.effectiveStartDate === currentTerm.startDate
                                && draft.effectiveEndDate === currentTerm.endDate
                                ? { kind: 'inherit-course' }
                                : {
                                    kind: 'explicit',
                                    startDate: draft.effectiveStartDate,
                                    endDate: draft.effectiveEndDate,
                                },
                            location: draft.locationKind === 'tba'
                                ? { kind: 'tba' }
                                : { kind: 'known', value: draft.locationValue },
                        },
                    },
                },
            });
        }
        catch {
            setMessage('请检查必填字段、时间范围、学分和地点。');
            return;
        }

        setSaving(true);
        setMessage('正在原子保存课程与首个课节…');
        const outcome = await window.courseFlow.createCourseWithMeeting(pendingCommand.current);
        if (!outcome.ok) {
            setSaving(false);
            setMessage(outcome.problem.message);
            return;
        }

        const refreshed = setupStateFrom(await window.courseFlow.querySetup());
        setSaving(false);
        props.onComplete(refreshed);
    };

    return (
        <section
            aria-labelledby="setup-title"
            className="setup-layout setup-layout--course"
        >
            <SetupProgress step={2} />
            <div className="setup-form-panel setup-form-panel--course">
                <div className="form-heading">
                    <p className="eyebrow">步骤 2 / 2 · {currentTerm.name}</p>
                    <h2>添加课程与首个课节</h2>
                    <p>先建立一门课程和一条每周规则；课节不能单独部分保存。</p>
                </div>

                <form
                    className="setup-form setup-form--course"
                    onSubmit={submit}
                >
                    <fieldset className="form-section field--full">
                        <legend>课程</legend>
                        <div className="form-section-grid">
                            <label className="field">
                                <span>课程代码</span>
                                <input
                                    autoFocus
                                    maxLength={32}
                                    name="course-code"
                                    onChange={event => updateDraft('code', event.target.value)}
                                    placeholder="例如：CSC108"
                                    required
                                    type="text"
                                    value={draft.code}
                                />
                            </label>
                            <label className="field">
                                <span>课程名称</span>
                                <input
                                    maxLength={120}
                                    name="course-name"
                                    onChange={event => updateDraft('name', event.target.value)}
                                    required
                                    type="text"
                                    value={draft.name}
                                />
                            </label>
                            <label className="field">
                                <span>节号（可选）</span>
                                <input
                                    maxLength={64}
                                    name="course-section"
                                    onChange={event => updateDraft('section', event.target.value)}
                                    type="text"
                                    value={draft.section}
                                />
                            </label>
                            <label className="field">
                                <span>授课教师（可选）</span>
                                <input
                                    maxLength={120}
                                    name="course-instructor"
                                    onChange={event => updateDraft('instructor', event.target.value)}
                                    type="text"
                                    value={draft.instructor}
                                />
                            </label>
                            <label className="field">
                                <span>颜色（可选）</span>
                                <select
                                    name="course-color"
                                    onChange={event => updateDraft(
                                        'color',
                                        event.target.value as CourseColor | '',
                                    )}
                                    value={draft.color}
                                >
                                    <option value="">未设置</option>
                                    <option value="red">红色</option>
                                    <option value="orange">橙色</option>
                                    <option value="yellow">黄色</option>
                                    <option value="green">绿色</option>
                                    <option value="blue">蓝色</option>
                                    <option value="purple">紫色</option>
                                    <option value="gray">灰色</option>
                                </select>
                            </label>
                            <label className="field">
                                <span>学分（可选）</span>
                                <input
                                    inputMode="decimal"
                                    name="course-credits"
                                    onChange={event => updateDraft('credits', event.target.value)}
                                    placeholder="例如：3 或 0.5"
                                    type="text"
                                    value={draft.credits}
                                />
                            </label>
                        </div>
                    </fieldset>

                    <fieldset className="form-section field--full">
                        <legend>首个课节</legend>
                        <div className="form-section-grid">
                            <label className="field">
                                <span>课节类型</span>
                                <select
                                    name="meeting-type"
                                    onChange={event => updateDraft(
                                        'meetingType',
                                        event.target.value as MeetingTypeCode,
                                    )}
                                    required
                                    value={draft.meetingType}
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
                                    onChange={event => updateDraft(
                                        'weekday',
                                        event.target.value as MeetingWeekday,
                                    )}
                                    required
                                    value={draft.weekday}
                                >
                                    <option value="MON">星期一</option>
                                    <option value="TUE">星期二</option>
                                    <option value="WED">星期三</option>
                                    <option value="THU">星期四</option>
                                    <option value="FRI">星期五</option>
                                    <option value="SAT">星期六</option>
                                    <option value="SUN">星期日</option>
                                </select>
                            </label>
                            <label className="field">
                                <span>开始时间</span>
                                <input
                                    name="meeting-start"
                                    onChange={event => updateDraft('localStart', event.target.value)}
                                    required
                                    type="time"
                                    value={draft.localStart}
                                />
                            </label>
                            <label className="field">
                                <span>结束时间</span>
                                <input
                                    name="meeting-end"
                                    onChange={event => updateDraft('localEnd', event.target.value)}
                                    required
                                    type="time"
                                    value={draft.localEnd}
                                />
                            </label>
                            <label className="field">
                                <span>生效开始日期</span>
                                <input
                                    max={currentTerm.endDate}
                                    min={currentTerm.startDate}
                                    name="meeting-effective-start"
                                    onChange={event => updateDraft('effectiveStartDate', event.target.value)}
                                    required
                                    type="date"
                                    value={draft.effectiveStartDate}
                                />
                            </label>
                            <label className="field">
                                <span>生效结束日期</span>
                                <input
                                    max={currentTerm.endDate}
                                    min={draft.effectiveStartDate || currentTerm.startDate}
                                    name="meeting-effective-end"
                                    onChange={event => updateDraft('effectiveEndDate', event.target.value)}
                                    required
                                    type="date"
                                    value={draft.effectiveEndDate}
                                />
                            </label>
                            <fieldset className="location-choice field--full">
                                <legend>地点</legend>
                                <label className="radio-option">
                                    <input
                                        checked={draft.locationKind === 'known'}
                                        name="location-kind"
                                        onChange={() => updateDraft('locationKind', 'known')}
                                        type="radio"
                                        value="known"
                                    />
                                    已知地点
                                </label>
                                <label className="radio-option">
                                    <input
                                        checked={draft.locationKind === 'tba'}
                                        name="location-kind"
                                        onChange={() => updateDraft('locationKind', 'tba')}
                                        type="radio"
                                        value="tba"
                                    />
                                    待定（TBA）
                                </label>
                                {draft.locationKind === 'known' ? (
                                    <label className="field location-input">
                                        <span>地点名称</span>
                                        <input
                                            maxLength={240}
                                            name="meeting-location"
                                            onChange={event => updateDraft('locationValue', event.target.value)}
                                            placeholder="例如：BA 1170"
                                            required
                                            type="text"
                                            value={draft.locationValue}
                                        />
                                    </label>
                                ) : null}
                            </fieldset>
                        </div>
                    </fieldset>

                    <FormFooter
                        message={message}
                        problem={message.includes('请检查') || !writable}
                        saving={saving}
                        writable={writable}
                        action="保存课程与课节"
                    />
                </form>
            </div>
        </section>
    );
}

function FormFooter(props: Readonly<{
    message: string;
    problem: boolean;
    saving: boolean;
    writable: boolean;
    action: string;
}>) {
    return (
        <div className="form-footer field--full">
            <p
                className={props.problem ? 'form-message form-message--problem' : 'form-message'}
                role="status"
            >
                {!props.writable ? '本地数据为只读；可以查看，但不能正式保存。' : props.message}
            </p>
            <button
                className="primary-action"
                disabled={!props.writable || props.saving}
                type="submit"
            >
                {props.saving ? '正在保存…' : props.action}
            </button>
        </div>
    );
}

function SetupComplete({ projection }: Readonly<{ projection: SetupProjection }>) {
    const currentTerm = projection.currentTerm;
    const course = projection.courses.find(candidate => candidate.termId === currentTerm?.termId);
    const meeting = course?.meetings[0];
    if (!currentTerm || !course || !meeting) {
        return null;
    }

    const location = meeting.location.kind === 'tba' ? '待定（TBA）' : meeting.location.value;
    const color = course.color === null ? '未设置' : `${courseColorNames[course.color]}（${course.color}）`;
    return (
        <section
            aria-labelledby="setup-complete-title"
            className="status-card setup-complete"
        >
            <span
                aria-hidden="true"
                className="success-mark"
            >✓</span>
            <p className="eyebrow">设置完成</p>
            <h1 id="setup-complete-title">{course.code} · {course.name}</h1>
            <p className="complete-term">{currentTerm.name}</p>
            <dl>
                <div><dt>学期日期</dt><dd>{currentTerm.startDate} — {currentTerm.endDate}</dd></div>
                <div><dt>默认时区</dt><dd>{currentTerm.timeZone}</dd></div>
                <div><dt>节号</dt><dd>{course.section ?? '未设置'}</dd></div>
                <div><dt>授课教师</dt><dd>{course.instructor ?? '未设置'}</dd></div>
                <div><dt>颜色</dt><dd>{color}</dd></div>
                <div><dt>学分</dt><dd>{course.credits ?? '未设置'}</dd></div>
                <div><dt>课节</dt><dd>{meeting.type.code} — {meeting.type.name}</dd></div>
                <div>
                    <dt>每周时间</dt>
                    <dd>
                        {meeting.weekday} · {weekdayNames[meeting.weekday]} · {meeting.localStart}–{meeting.localEnd}
                    </dd>
                </div>
                <div>
                    <dt>生效日期</dt>
                    <dd>{meeting.effectiveRange.startDate} — {meeting.effectiveRange.endDate}</dd>
                </div>
                <div><dt>地点</dt><dd>{location}</dd></div>
                <div><dt>学期身份</dt><dd className="stable-id">{currentTerm.termId}</dd></div>
                <div><dt>课程身份</dt><dd className="stable-id">{course.courseId}</dd></div>
                <div><dt>课节身份</dt><dd className="stable-id">{meeting.meetingSeriesId}</dd></div>
            </dl>
            <p className="continuity-note">课程与课节已正式保存在本地；重新打开应用后会读取同一组稳定身份。</p>
        </section>
    );
}

createRoot(document.getElementById('root')!).render(<App />);
