import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { WorkspaceSetupOutcome } from '../shared/workspace-setup-contract';
import {
    normalizeCreateTermCommand,
    type CreateTermCommand,
    type SetupProjection,
} from '../shared/workspace-term-contract';

type SetupState =
    | Readonly<{ kind: 'loading' }>
    | Readonly<{
        kind: 'setup';
        dataMode: 'ready' | 'read-only';
        projection: SetupProjection;
    }>
    | Readonly<{ kind: 'complete'; projection: SetupProjection }>
    | Readonly<{ kind: 'problem'; message: string }>;

type TermDraft = Readonly<{
    name: string;
    startDate: string;
    endDate: string;
    timeZone: string;
}>;

const emptyDraft: TermDraft = {
    name: '',
    startDate: '',
    endDate: '',
    timeZone: '',
};

function setupStateFrom(outcome: WorkspaceSetupOutcome): SetupState {
    if (!outcome.ok) {
        return { kind: 'problem', message: outcome.problem.message };
    }
    if (outcome.value.kind !== 'workspace.setup-projection') {
        return { kind: 'problem', message: 'Workspace 返回了意外的设置状态。' };
    }
    return outcome.value.projection.currentTerm
        ? { kind: 'complete', projection: outcome.value.projection }
        : {
            kind: 'setup',
            dataMode: outcome.value.dataMode,
            projection: outcome.value.projection,
        };
}

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
        <main className="app-shell" aria-labelledby="app-title">
            <header className="brand-header">
                <span className="brand-mark" aria-hidden="true">C</span>
                <span id="app-title" className="brand-name">CourseFlow</span>
            </header>

            {state.kind === 'loading' && (
                <section className="status-card" aria-live="polite">
                    <span className="status-dot" aria-hidden="true" />
                    <p>正在读取本地工作区…</p>
                </section>
            )}
            {state.kind === 'problem' && (
                <section className="status-card status-card--problem" aria-labelledby="problem-title">
                    <p className="eyebrow">本地工作区暂不可用</p>
                    <h1 id="problem-title">设置尚未完成</h1>
                    <p role="alert">{state.message}</p>
                    <button className="secondary-action" type="button" onClick={load}>重试</button>
                </section>
            )}
            {state.kind === 'setup' && (
                <SetupTerm
                    dataMode={state.dataMode}
                    projection={state.projection}
                    onComplete={setState}
                />
            )}
            {state.kind === 'complete' && <CurrentTerm projection={state.projection} />}
        </main>
    );
}

function SetupTerm(props: Readonly<{
    dataMode: 'ready' | 'read-only';
    projection: SetupProjection;
    onComplete(state: SetupState): void;
}>) {
    const [draft, setDraft] = useState<TermDraft>(emptyDraft);
    const [message, setMessage] = useState('所有信息只保存在这台设备上。');
    const [saving, setSaving] = useState(false);
    const pendingCommand = useRef<CreateTermCommand | undefined>(undefined);
    const writable = props.dataMode === 'ready';

    const updateDraft = (field: keyof TermDraft, value: string) => {
        pendingCommand.current = undefined;
        setDraft((current) => ({ ...current, [field]: value }));
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
        <section className="setup-layout" aria-labelledby="setup-title">
            <aside className="setup-progress" aria-label="设置进度">
                <p className="eyebrow">首次设置</p>
                <h1 id="setup-title">准备好你的学期</h1>
                <p className="setup-intro">先确定当前学期，CourseFlow 才能把之后的安排放在正确的时间范围内。</p>
                <ol className="progress-list">
                    <li aria-current="step">
                        <span className="progress-number">1</span>
                        <span>
                            <strong>当前学期</strong>
                            <small>名称、日期与时区</small>
                        </span>
                    </li>
                </ol>
                <p className="local-note"><span aria-hidden="true">●</span> 本地优先 · 无需账户</p>
            </aside>

            <div className="setup-form-panel">
                <div className="form-heading">
                    <p className="eyebrow">步骤 1 / 1</p>
                    <h2>创建当前学期</h2>
                    <p>日期用于界定这个学期；默认时区用于解释之后录入的本地时间。</p>
                </div>

                <form className="setup-form" onSubmit={submit}>
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
                            onChange={(event) => updateDraft('name', event.target.value)}
                        />
                    </label>

                    <label className="field">
                        <span>开始日期</span>
                        <input
                            name="start-date"
                            required
                            type="date"
                            value={draft.startDate}
                            onChange={(event) => updateDraft('startDate', event.target.value)}
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
                            onChange={(event) => updateDraft('endDate', event.target.value)}
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
                            onChange={(event) => updateDraft('timeZone', event.target.value)}
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

                    <div className="form-footer field--full">
                        <p className={message.includes('请检查') || !writable ? 'form-message form-message--problem' : 'form-message'} role="status">
                            {!writable ? '本地数据为只读；可以查看，但不能正式保存。' : message}
                        </p>
                        <button className="primary-action" disabled={!writable || saving} type="submit">
                            {saving ? '正在保存…' : '创建并继续'}
                        </button>
                    </div>
                </form>
            </div>
        </section>
    );
}

function CurrentTerm({ projection }: Readonly<{ projection: SetupProjection }>) {
    const currentTerm = projection.currentTerm;
    if (!currentTerm) {
        return null;
    }

    return (
        <section className="status-card current-term" aria-labelledby="current-term-title">
            <span className="success-mark" aria-hidden="true">✓</span>
            <p className="eyebrow">设置完成</p>
            <h1 id="current-term-title">{currentTerm.name}</h1>
            <dl>
                <div><dt>日期</dt><dd>{currentTerm.startDate} — {currentTerm.endDate}</dd></div>
                <div><dt>默认时区</dt><dd>{currentTerm.timeZone}</dd></div>
                <div><dt>学期身份</dt><dd className="term-id">{currentTerm.termId}</dd></div>
            </dl>
            <p className="continuity-note">当前学期已正式保存在本地；重新打开应用后会继续读取同一学期。</p>
        </section>
    );
}

createRoot(document.getElementById('root')!).render(<App />);
