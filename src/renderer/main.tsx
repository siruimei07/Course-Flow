import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { BootstrapOutcome } from '../shared/bootstrap-contract';

type WorkspaceStatus =
  | { kind: 'loading' }
  | { kind: 'ready'; outcome: Extract<BootstrapOutcome, { ok: true }> }
  | { kind: 'problem'; outcome: Extract<BootstrapOutcome, { ok: false }> };

function statusFrom(outcome: BootstrapOutcome): WorkspaceStatus {
  return outcome.ok ? { kind: 'ready', outcome } : { kind: 'problem', outcome };
}

function App() {
  const [status, setStatus] = useState<WorkspaceStatus>({ kind: 'loading' });

  useEffect(() => {
    void window.courseFlow.query().then((outcome) => setStatus(statusFrom(outcome)));
  }, []);

  const retry = () => {
    setStatus({ kind: 'loading' });
    void window.courseFlow.query().then((outcome) => setStatus(statusFrom(outcome)));
  };

  const content =
    status.kind === 'loading' ? (
      <p role="status">正在连接 Workspace 进程…</p>
    ) : status.kind === 'ready' ? (
      <>
        <p role="status">Workspace 进程已就绪</p>
        <p>Build {status.outcome.value.appBuildId.split(':')[1]?.slice(0, 12) ?? 'unknown'}</p>
        <p>SQLite {status.outcome.value.sqliteVersion}</p>
        <p>本地开发数据根已验证</p>
      </>
    ) : (
      <>
        <p role="alert">{status.outcome.problem.message}</p>
        <button type="button" onClick={retry}>
          重试
        </button>
      </>
    );

  return (
    <main className="app-shell" aria-labelledby="app-title">
      <h1 id="app-title">CourseFlow</h1>
      <p>本地优先课程工作区</p>
      {content}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
