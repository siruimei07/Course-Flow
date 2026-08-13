import type { AiResultRegionView } from "@courseflow/core";

const actionCopy = {
  configure: "检查配置",
  manual: "改用手工表单",
  retry: "重试",
} as const;

export function AiResultRegion({ view }: Readonly<{ view: AiResultRegionView }>) {
  return (
    <section
      aria-live="polite"
      aria-labelledby="ai-result-region-title"
      className="ai-result-region"
    >
      <header>
        <div>
          <span className="import-eyebrow">Conditional contract harness</span>
          <h2 id="ai-result-region-title">AI 结果区</h2>
        </div>
        <span className="status-label">{view.status}</span>
      </header>
      {view.status === "idle" ? (
        <div className="ai-state-card">
          <h3>尚未开始</h3>
          <p>这里不会在默认生产 UI 中出现；隔离 harness 只验证安全 view model。</p>
        </div>
      ) : null}
      {view.status === "generating" ? (
        <div aria-busy="true" className="ai-state-card">
          <h3>正在生成</h3>
          <p>{view.question}</p>
          <button className="button button-secondary" type="button">
            取消
          </button>
        </div>
      ) : null}
      {view.status === "completed" ? (
        <div className="ai-state-card">
          <p className="ai-question">问题：{view.question}</p>
          {view.result.blocks.map((block, index) => (
            <p key={`${block.kind}-${index}`}>{block.text}</p>
          ))}
          {view.result.citations.length === 0 ? null : (
            <section aria-labelledby="ai-citations-title">
              <h3 id="ai-citations-title">已核对引用</h3>
              <ul>
                {view.result.citations.map((citation) => (
                  <li key={`${citation.recordId}@${citation.version}`}>{citation.label}</li>
                ))}
              </ul>
            </section>
          )}
          {view.result.assumptions.length === 0 ? null : (
            <section aria-labelledby="ai-assumptions-title">
              <h3 id="ai-assumptions-title">假设</h3>
              <ul>
                {view.result.assumptions.map((assumption) => (
                  <li key={assumption}>{assumption}</li>
                ))}
              </ul>
            </section>
          )}
          {view.result.draft === null ? null : (
            <section className="ai-draft-card" aria-labelledby="ai-draft-title">
              <span className="meta-label">尚未保存</span>
              <h3 id="ai-draft-title">课程事项表单草稿</h3>
              <dl>
                <div>
                  <dt>标题</dt>
                  <dd>{view.result.draft.title}</dd>
                </div>
                <div>
                  <dt>类型</dt>
                  <dd>{view.result.draft.kind}</dd>
                </div>
              </dl>
              <a
                className="button button-primary"
                href={`/tasks?courseId=${view.result.draft.courseId}`}
              >
                打开既有手工表单
              </a>
            </section>
          )}
        </div>
      ) : null}
      {view.status === "cancelled" || view.status === "failed" ? (
        <div className="status-banner" data-tone="danger" role="alert">
          <strong>{view.status === "cancelled" ? "已取消" : "生成失败"}</strong>
          <p>{view.problem.message}</p>
          <p>问题已保留：{view.question}</p>
          <div className="ai-recovery-actions">
            {view.problem.actions.map((action) => (
              <button className="button button-secondary" key={action} type="button">
                {actionCopy[action]}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
