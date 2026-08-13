"use client";

import type {
  CandidatePayload,
  CourseItemCandidatePayload,
  ImportCandidateView,
  ImportReviewView,
  ReviewDecision,
} from "@courseflow/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Icon } from "@courseflow-web/features/shell/icon";

const decisionCopy: Readonly<
  Record<ReviewDecision, Readonly<{ description: string; label: string }>>
> = {
  accepted: { description: "保持 Candidate 原样，并明确新建或更新目标。", label: "接受" },
  accepted_with_edits: {
    description: "保存完整 final payload，再明确新建或更新目标。",
    label: "修改后接受",
  },
  duplicate: { description: "关联同类正式记录，不创建或更新正式数据。", label: "标记重复" },
  rejected: { description: "记录审核决定，不创建或更新正式数据。", label: "拒绝" },
};

const runStatusCopy: Readonly<Record<ImportReviewView["status"], string>> = {
  awaiting_review: "等待审核",
  cancelled: "已取消",
  extracting: "正在抽取",
  failed: "导入失败",
  normalizing: "正在规范化",
  partially_reviewed: "部分已审核",
  preparing: "正在准备原文",
  queued: "排队中",
  reviewed: "审核完成",
  validating: "正在验证",
};

const candidateKindCopy = {
  course_item: "课程事项",
  course_patch: "课程字段",
  grading_scheme: "评分方案",
} as const;

function isCourseItemPayload(payload: CandidatePayload): payload is CourseItemCandidatePayload {
  return "courseId" in payload && "temporal" in payload && "kind" in payload && "title" in payload;
}

function clonePayload(payload: CandidatePayload): CandidatePayload {
  return JSON.parse(JSON.stringify(payload)) as CandidatePayload;
}

function temporalSummary(payload: CourseItemCandidatePayload): string {
  if (payload.temporal.kind === "deadline") {
    return `${payload.temporal.at} · ${payload.temporal.timeZone}`;
  }
  if (payload.temporal.kind === "date") return payload.temporal.date;
  if (payload.temporal.kind === "interval") {
    return `${payload.temporal.startsAt} → ${payload.temporal.endsAt} · ${payload.temporal.timeZone}`;
  }
  return payload.temporal.note ?? "TBA / 未排期";
}

function CandidatePayloadView({ payload }: Readonly<{ payload: CandidatePayload }>) {
  if (isCourseItemPayload(payload)) {
    return (
      <dl className="candidate-payload-list">
        <div>
          <dt>事项名称</dt>
          <dd>{payload.title}</dd>
        </div>
        <div>
          <dt>类型</dt>
          <dd>{payload.kind}</dd>
        </div>
        <div>
          <dt>时间语义</dt>
          <dd>
            {payload.temporal.kind} · {temporalSummary(payload)}
          </dd>
        </div>
        <div>
          <dt>预计投入</dt>
          <dd>{payload.estimatedMinutes === null ? "未知" : `${payload.estimatedMinutes} 分钟`}</dd>
        </div>
        <div>
          <dt>说明</dt>
          <dd>{payload.details ?? "无"}</dd>
        </div>
      </dl>
    );
  }
  if ("components" in payload) {
    return (
      <dl className="candidate-payload-list">
        <div>
          <dt>方案名称</dt>
          <dd>{payload.name}</dd>
        </div>
        <div>
          <dt>正式主方案</dt>
          <dd>{payload.isPrimary ? "是" : "否"}</dd>
        </div>
        <div>
          <dt>评分组成</dt>
          <dd>
            {payload.components
              .map(
                (component) =>
                  `${component.title} · ${component.weightBps === null ? "权重未知" : `${component.weightBps / 100}%`}`,
              )
              .join("；")}
          </dd>
        </div>
      </dl>
    );
  }
  return (
    <dl className="candidate-payload-list">
      <div>
        <dt>课程代码</dt>
        <dd>{payload.code ?? "不修改"}</dd>
      </div>
      <div>
        <dt>课程名称</dt>
        <dd>{payload.title ?? "不修改"}</dd>
      </div>
      <div>
        <dt>班级 / Section</dt>
        <dd>{payload.section ?? "不修改"}</dd>
      </div>
      <div>
        <dt>教师</dt>
        <dd>{payload.instructorName ?? "不修改"}</dd>
      </div>
    </dl>
  );
}

function RunProgress({ view }: Readonly<{ view: ImportReviewView }>) {
  const percent =
    view.progressTotal === 0 ? 0 : Math.round((view.progressCurrent / view.progressTotal) * 100);
  return (
    <section className="panel import-progress-panel" aria-labelledby="import-progress-title">
      <div className="import-progress-copy">
        <span className="import-run-glyph" aria-hidden="true">
          <Icon name="file" />
        </span>
        <span>
          <span className="import-eyebrow">Import Run · v{view.runVersion}</span>
          <h2 id="import-progress-title">{view.source.displayName}</h2>
          <small>
            {view.source.courseCode} · {view.currentStage}
          </small>
        </span>
      </div>
      <div className="import-progress-meter">
        <div>
          <strong>{runStatusCopy[view.status]}</strong>
          <span>{percent}%</span>
        </div>
        <progress
          aria-label={`导入进度 ${percent}%`}
          max={Math.max(1, view.progressTotal)}
          value={view.progressCurrent}
        />
        <small>
          {view.progressCurrent} / {view.progressTotal} 个页级步骤完成
        </small>
      </div>
      <dl className="import-progress-counts" aria-label="审核进度">
        <div>
          <dt>候选</dt>
          <dd>{view.progress.total}</dd>
        </div>
        <div>
          <dt>接受</dt>
          <dd>{view.progress.accepted}</dd>
        </div>
        <div>
          <dt>已修改</dt>
          <dd>{view.progress.edited}</dd>
        </div>
        <div>
          <dt>拒绝</dt>
          <dd>{view.progress.rejected}</dd>
        </div>
        <div>
          <dt>重复</dt>
          <dd>{view.progress.duplicate}</dd>
        </div>
        <div>
          <dt>待审核</dt>
          <dd>{view.progress.remaining}</dd>
        </div>
      </dl>
    </section>
  );
}

function NonReviewState({ view }: Readonly<{ view: ImportReviewView }>) {
  if (view.error !== null) {
    return (
      <section
        className="panel import-terminal-state"
        data-state="failed"
        aria-labelledby="import-failed-title"
      >
        <span className="import-terminal-icon" aria-hidden="true">
          !
        </span>
        <div>
          <span className="status-label">{view.error.code}</span>
          <h2 id="import-failed-title">导入尝试失败</h2>
          <p>{view.error.message}</p>
          <p>
            <strong>失败边界：</strong>Source 原文仍然可用；Candidate、Review Decision
            与正式数据均未部分写入。
          </p>
          <div className="button-row">
            <Link className="button button-primary" href={`/sources?sourceId=${view.source.id}`}>
              查看原始 Source
            </Link>
            <Link className="button button-secondary" href="/sources">
              返回资料库
            </Link>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section
      className="panel import-terminal-state"
      data-state="processing"
      aria-labelledby="import-processing-title"
    >
      <span className="import-processing-spinner" aria-hidden="true" />
      <div>
        <span className="status-label">{view.currentStage}</span>
        <h2 id="import-processing-title">正在构建可审核候选</h2>
        <p>
          页面会保留当前阶段与失败边界。只有 Candidate 和 Evidence 整批事务写入后，审核区才会出现。
        </p>
        <ol className="import-stage-list">
          {[
            ["preparing", "准备页级输入"],
            ["extracting", "抽取结构化候选"],
            ["normalizing", "规范化日期与成绩"],
            ["validating", "验证 Candidate 与 Evidence"],
            ["awaiting_review", "等待用户审核"],
          ].map(([stage, label]) => (
            <li aria-current={view.currentStage === stage ? "step" : undefined} key={stage}>
              {label}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function EvidencePanel({
  candidate,
  panelRef,
}: Readonly<{
  candidate: ImportCandidateView;
  panelRef: (node: HTMLElement | null) => void;
}>) {
  return (
    <section
      className="review-evidence-panel"
      aria-labelledby="evidence-panel-title"
      ref={panelRef}
      tabIndex={-1}
    >
      <div className="review-section-heading">
        <span>
          <span className="import-eyebrow">Evidence · 原始 contract</span>
          <h2 id="evidence-panel-title">逐字段核对来源</h2>
        </span>
        <span className="status-label">{candidate.evidence.length} 条</span>
      </div>
      {candidate.evidence.length === 0 ? (
        <div className="status-banner" data-tone="danger">
          该 Candidate 没有 Evidence；不得盲目接受。
        </div>
      ) : (
        <div className="evidence-stack">
          {candidate.evidence.map(
            ({ confidenceMilli, evidence, fieldPath, inference, isPrimary }) => (
              <article
                className="evidence-card"
                data-locator={evidence.locatorStatus}
                key={`${evidence.id}:${fieldPath}`}
              >
                <header>
                  <span>
                    <strong>{evidence.originalFilename}</strong>
                    <small>
                      第 {evidence.pageNumber} 页 · {fieldPath}
                    </small>
                  </span>
                  <span className="evidence-locator-status">
                    {evidence.locatorStatus === "verified_text"
                      ? "文本已验证"
                      : evidence.locatorStatus === "vision_only"
                        ? "仅页图定位"
                        : "未验证"}
                  </span>
                </header>
                <blockquote>{evidence.quote}</blockquote>
                <p className="evidence-preview-contract">
                  字段 AI 估计 {confidenceMilli / 10}% · 推断说明：{inference}
                </p>
                <dl className="evidence-contract-meta">
                  <div>
                    <dt>主证据</dt>
                    <dd>{isPrimary ? "是" : "否"}</dd>
                  </div>
                  <div>
                    <dt>页码</dt>
                    <dd>{evidence.pageNumber}（1-based）</dd>
                  </div>
                  <div>
                    <dt>bbox</dt>
                    <dd>
                      {evidence.bbox === null
                        ? "无"
                        : `${evidence.bbox.x}, ${evidence.bbox.y}, ${evidence.bbox.width}, ${evidence.bbox.height}`}
                    </dd>
                  </div>
                  <div>
                    <dt>text hash</dt>
                    <dd>{evidence.textHash}</dd>
                  </div>
                </dl>
                <p className="evidence-preview-contract">
                  受控页图预览按 Source owner scope 单独签发；Evidence 本身不保存公开 URL。
                </p>
              </article>
            ),
          )}
        </div>
      )}
    </section>
  );
}

type ReviewNotice = Readonly<{ message: string; tone: "danger" | "success" | "warning" }>;

export function ImportWorkbench({ view }: Readonly<{ view: ImportReviewView }>) {
  const router = useRouter();
  const reviewable = useMemo(
    () => view.candidates.filter((candidate) => candidate.decision === null),
    [view.candidates],
  );
  const firstCandidate = reviewable[0] ?? view.candidates[0] ?? null;
  const [selectedId, setSelectedId] = useState(firstCandidate?.id ?? "");
  const selected =
    view.candidates.find((candidate) => candidate.id === selectedId) ?? firstCandidate;
  const [decision, setDecision] = useState<ReviewDecision>("accepted");
  const [applicationKind, setApplicationKind] = useState<"create" | "update_existing">("create");
  const [targetId, setTargetId] = useState(selected?.targets[0]?.id ?? "");
  const [duplicateTargetId, setDuplicateTargetId] = useState(selected?.targets[0]?.id ?? "");
  const [draft, setDraft] = useState<CandidatePayload | null>(
    selected === null ? null : clonePayload(selected.proposedPayload),
  );
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState<ReviewNotice | null>(null);
  const [saving, setSaving] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const candidateButtons = useRef(new Map<string, HTMLButtonElement>());
  const evidencePanel = useRef<HTMLElement | null>(null);
  const reviewForm = useRef<HTMLFormElement | null>(null);

  function rotateIdempotencyKey() {
    setIdempotencyKey(crypto.randomUUID());
  }

  function selectCandidate(candidate: ImportCandidateView, focus = false) {
    setSelectedId(candidate.id);
    setDraft(clonePayload(candidate.proposedPayload));
    setTargetId(candidate.targets[0]?.id ?? "");
    setDuplicateTargetId(candidate.targets[0]?.id ?? "");
    setDecision("accepted");
    setApplicationKind("create");
    setNote("");
    setNotice(null);
    setIdempotencyKey(crypto.randomUUID());
    if (focus) requestAnimationFrame(() => candidateButtons.current.get(candidate.id)?.focus());
  }

  function moveCandidate(direction: -1 | 1) {
    if (selected === null || view.candidates.length === 0) return;
    const index = view.candidates.findIndex((candidate) => candidate.id === selected.id);
    const next =
      view.candidates[(index + direction + view.candidates.length) % view.candidates.length];
    if (next !== undefined) selectCandidate(next, true);
  }

  function handleWorkbenchKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const textInput = target.matches("input, select, textarea");
    if (event.altKey && event.key === "ArrowDown") {
      event.preventDefault();
      moveCandidate(1);
    } else if (event.altKey && event.key === "ArrowUp") {
      event.preventDefault();
      moveCandidate(-1);
    } else if (!textInput && event.key.toLowerCase() === "e") {
      event.preventDefault();
      evidencePanel.current?.focus();
    } else if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      reviewForm.current?.requestSubmit();
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selected === null || selected.decision !== null || draft === null) return;
    const accepted = decision === "accepted" || decision === "accepted_with_edits";
    const target = selected.targets.find((entry) => entry.id === targetId);
    const application = accepted
      ? applicationKind === "create"
        ? { kind: "create" as const }
        : target === undefined
          ? null
          : {
              expectedVersion: target.version,
              kind: "update_existing" as const,
              targetId: target.id,
            }
      : null;
    if (accepted && application === null) {
      setNotice({ message: "请选择一个仍然可用的更新目标，或改为新建正式记录。", tone: "danger" });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/v1/candidates/${selected.id}/decision`, {
        body: JSON.stringify({
          application,
          decision,
          duplicateTargetId: decision === "duplicate" ? duplicateTargetId || null : null,
          finalPayload: accepted ? draft : null,
          note: note.trim() || null,
        }),
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
          origin: window.location.origin,
          ...(view.conflict === null
            ? {}
            : { "x-courseflow-harness-scenario": "version-conflict" }),
        },
        method: "PUT",
      });
      const payload = (await response.json()) as {
        data?: Readonly<{ value?: Readonly<{ replayed?: boolean }> }>;
        detail?: string;
        errors?: readonly Readonly<{ message: string }>[];
      };
      if (!response.ok) {
        const message =
          payload.errors?.map((issue) => issue.message).join("；") ||
          payload.detail ||
          "审核决定未保存。";
        setNotice({
          message:
            response.status === 409
              ? `版本冲突：${message} Candidate 仍保持未决，请比较最新目标。`
              : message,
          tone: "danger",
        });
        return;
      }
      setNotice({
        message: payload.data?.value?.replayed
          ? "已返回同一幂等决定；没有重复写入正式数据。"
          : "Review Decision、Application 与正式记录已在同一事务中提交。",
        tone: "success",
      });
      router.refresh();
    } catch (error) {
      setNotice({
        message: error instanceof Error ? error.message : "网络中断；重试会复用同一幂等键。",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  }

  if (view.candidates.length === 0) {
    return (
      <div className="import-page-stack">
        <RunProgress view={view} />
        <NonReviewState view={view} />
      </div>
    );
  }

  return (
    <div className="import-page-stack" onKeyDown={handleWorkbenchKeyDown}>
      <RunProgress view={view} />
      {view.conflict === null ? null : (
        <div className="status-banner import-conflict-banner" data-tone="danger" role="alert">
          <strong>Version conflict · 最新目标 v{view.conflict.latestVersion}</strong>
          <span>{view.conflict.message}</span>
        </div>
      )}
      {view.status === "partially_reviewed" ? (
        <div className="status-banner" data-tone="warning" role="status">
          已提交的决定不会因后续某个候选失败而回滚；剩余 {view.progress.remaining}{" "}
          个候选逐项事务审核。
        </div>
      ) : null}
      <div className="import-review-workspace">
        <aside className="panel candidate-queue" aria-label="候选审核队列">
          <div className="candidate-queue-head">
            <span>
              <span className="import-eyebrow">Candidate</span>
              <h2>审核队列</h2>
            </span>
            <span className="status-label">{view.progress.remaining} 待审核</span>
          </div>
          <div className="candidate-queue-list">
            {view.candidates.map((candidate, index) => (
              <button
                aria-pressed={selected?.id === candidate.id}
                className="candidate-queue-button"
                data-decided={candidate.decision !== null}
                key={candidate.id}
                onClick={() => selectCandidate(candidate)}
                ref={(node) => {
                  if (node === null) candidateButtons.current.delete(candidate.id);
                  else candidateButtons.current.set(candidate.id, node);
                }}
                type="button"
              >
                <span className="candidate-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="candidate-queue-copy">
                  <strong>{candidate.title}</strong>
                  <small>
                    {candidateKindCopy[candidate.kind]} · AI 估计 {candidate.confidenceMilli / 10}%
                  </small>
                </span>
                <span className="candidate-queue-state">
                  {candidate.decision === null
                    ? candidate.warnings.some((warning) => warning.severity === "blocking")
                      ? "需核验"
                      : "未决"
                    : decisionCopy[candidate.decision.decision].label}
                </span>
              </button>
            ))}
          </div>
          <div className="keyboard-review-hints" aria-label="键盘审核快捷键">
            <span>
              <kbd>Alt</kbd> + <kbd>↑</kbd>/<kbd>↓</kbd> 切换
            </span>
            <span>
              <kbd>E</kbd> Evidence
            </span>
            <span>
              <kbd>Ctrl</kbd> + <kbd>Enter</kbd> 提交
            </span>
          </div>
        </aside>

        {selected === null ? null : (
          <main className="panel review-workbench" aria-label={`审核候选：${selected.title}`}>
            <header className="review-workbench-head">
              <span>
                <span className="import-eyebrow">不可变 Candidate · {selected.schemaVersion}</span>
                <h1>{selected.title}</h1>
                <small>
                  {candidateKindCopy[selected.kind]} · fingerprint {selected.fingerprint}
                </small>
              </span>
              <span className="confidence-badge" data-confidence={selected.confidenceLabel}>
                AI 估计 {selected.confidenceMilli / 10}% · {selected.confidenceLabel}
              </span>
            </header>
            {selected.warnings.length === 0 ? null : (
              <section className="candidate-warning-stack" aria-label="候选警告">
                {[...selected.warnings]
                  .sort(
                    (left, right) =>
                      ({ blocking: 0, warning: 1, info: 2 })[left.severity] -
                      { blocking: 0, warning: 1, info: 2 }[right.severity],
                  )
                  .map((warning) => (
                    <div
                      className="candidate-warning"
                      data-severity={warning.severity}
                      key={warning.code}
                    >
                      <strong>
                        {warning.severity === "blocking"
                          ? "必须核验"
                          : warning.severity === "warning"
                            ? "注意"
                            : "提示"}{" "}
                        · {warning.code}
                      </strong>
                      <span>{warning.message}</span>
                    </div>
                  ))}
              </section>
            )}
            <div className="review-two-zone">
              <section className="review-decision-panel" aria-labelledby="review-decision-title">
                <div className="review-section-heading">
                  <span>
                    <span className="import-eyebrow">Candidate → Review Decision → 正式数据</span>
                    <h2 id="review-decision-title">候选与决定</h2>
                  </span>
                  <span className="status-label">
                    {selected.decision === null ? "尚未写入" : "已决定"}
                  </span>
                </div>
                <section
                  className="candidate-original-card"
                  aria-labelledby="candidate-original-title"
                >
                  <h3 id="candidate-original-title">原始 Candidate payload</h3>
                  <CandidatePayloadView payload={selected.proposedPayload} />
                </section>
                {selected.decision === null ? (
                  <form className="review-decision-form" onSubmit={submit} ref={reviewForm}>
                    {notice === null ? null : (
                      <div aria-live="polite" className="status-banner" data-tone={notice.tone}>
                        {notice.message}
                      </div>
                    )}
                    <fieldset className="review-decision-fieldset">
                      <legend>Review Decision（必选且显式保存）</legend>
                      <div className="decision-option-grid">
                        {(Object.keys(decisionCopy) as ReviewDecision[]).map((value) => (
                          <label
                            className="decision-option"
                            data-selected={decision === value}
                            key={value}
                          >
                            <input
                              checked={decision === value}
                              disabled={
                                value === "duplicate" &&
                                (selected.kind === "course_patch" || selected.targets.length === 0)
                              }
                              name="decision"
                              onChange={() => {
                                setDecision(value);
                                if (value === "accepted")
                                  setDraft(clonePayload(selected.proposedPayload));
                                rotateIdempotencyKey();
                              }}
                              type="radio"
                              value={value}
                            />
                            <span>
                              <strong>{decisionCopy[value].label}</strong>
                              <small>{decisionCopy[value].description}</small>
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    <section className="review-target-card" aria-labelledby="review-target-title">
                      <span className="import-eyebrow">写入目标 · 不会被按钮文案隐藏</span>
                      <h3 id="review-target-title">正式数据应用</h3>
                      {decision === "rejected" ? (
                        <p>
                          <strong>不写入正式数据。</strong>只创建 rejected Review Decision。
                        </p>
                      ) : decision === "duplicate" ? (
                        <div className="field">
                          <label htmlFor="duplicate-target">重复目标（不修改该记录）</label>
                          <select
                            id="duplicate-target"
                            onChange={(event) => {
                              setDuplicateTargetId(event.target.value);
                              rotateIdempotencyKey();
                            }}
                            required
                            value={duplicateTargetId}
                          >
                            {selected.targets.map((target) => (
                              <option key={target.id} value={target.id}>
                                {target.label} · v{target.version}
                              </option>
                            ))}
                          </select>
                          <p className="field-hint">正式写入：无；保存 duplicate target 关联。</p>
                        </div>
                      ) : (
                        <fieldset className="application-options">
                          <legend>Application</legend>
                          <label>
                            <input
                              checked={applicationKind === "create"}
                              name="application"
                              onChange={() => {
                                setApplicationKind("create");
                                rotateIdempotencyKey();
                              }}
                              type="radio"
                            />
                            新建正式 {candidateKindCopy[selected.kind]}
                          </label>
                          <label>
                            <input
                              checked={applicationKind === "update_existing"}
                              disabled={selected.targets.length === 0}
                              name="application"
                              onChange={() => {
                                setApplicationKind("update_existing");
                                rotateIdempotencyKey();
                              }}
                              type="radio"
                            />
                            更新现有兼容记录
                          </label>
                          {applicationKind === "update_existing" && selected.targets.length > 0 ? (
                            <div className="field full">
                              <label htmlFor="application-target">更新目标与 expectedVersion</label>
                              <select
                                id="application-target"
                                onChange={(event) => {
                                  setTargetId(event.target.value);
                                  rotateIdempotencyKey();
                                }}
                                value={targetId}
                              >
                                {selected.targets.map((target) => (
                                  <option key={target.id} value={target.id}>
                                    {target.label} · expected v{target.version}
                                  </option>
                                ))}
                              </select>
                              <p className="field-hint">
                                目标版本不匹配时返回 409；Candidate 保持未决，不自动覆盖。
                              </p>
                            </div>
                          ) : null}
                        </fieldset>
                      )}
                    </section>

                    {(decision === "accepted" || decision === "accepted_with_edits") &&
                    draft !== null ? (
                      <section className="final-payload-card" aria-labelledby="final-payload-title">
                        <span className="import-eyebrow">审计快照</span>
                        <h3 id="final-payload-title">完整 final payload</h3>
                        {decision === "accepted_with_edits" && isCourseItemPayload(draft) ? (
                          <div className="form-stack">
                            <div className="field">
                              <label htmlFor="final-title">事项名称</label>
                              <input
                                id="final-title"
                                onChange={(event) => {
                                  setDraft({ ...draft, title: event.target.value });
                                  rotateIdempotencyKey();
                                }}
                                required
                                value={draft.title}
                              />
                            </div>
                            <div className="field">
                              <label htmlFor="final-details">说明</label>
                              <textarea
                                id="final-details"
                                onChange={(event) => {
                                  setDraft({ ...draft, details: event.target.value || null });
                                  rotateIdempotencyKey();
                                }}
                                value={draft.details ?? ""}
                              />
                            </div>
                            <div className="field">
                              <label htmlFor="final-estimate">预计投入（分钟）</label>
                              <input
                                id="final-estimate"
                                min="1"
                                onChange={(event) => {
                                  setDraft({
                                    ...draft,
                                    estimatedMinutes:
                                      event.target.value === "" ? null : Number(event.target.value),
                                  });
                                  rotateIdempotencyKey();
                                }}
                                type="number"
                                value={draft.estimatedMinutes ?? ""}
                              />
                            </div>
                          </div>
                        ) : (
                          <CandidatePayloadView payload={draft} />
                        )}
                      </section>
                    ) : null}
                    <div className="field">
                      <label htmlFor="review-note">审核说明（可选）</label>
                      <textarea
                        id="review-note"
                        maxLength={2000}
                        onChange={(event) => {
                          setNote(event.target.value);
                          rotateIdempotencyKey();
                        }}
                        value={note}
                      />
                    </div>
                    <div className="review-submit-row">
                      <span>
                        <strong>将保存：{decisionCopy[decision].label}</strong>
                        <small>
                          {decision === "accepted" || decision === "accepted_with_edits"
                            ? applicationKind === "create"
                              ? "正式目标：新建记录"
                              : `正式目标：更新 ${targetId || "未选择"}`
                            : "正式目标：不写入"}
                        </small>
                      </span>
                      <button
                        className="button button-primary"
                        disabled={
                          saving ||
                          (selected.warnings.some((warning) => warning.severity === "blocking") &&
                            decision === "accepted")
                        }
                        type="submit"
                      >
                        <Icon name="check" />
                        {saving ? "正在提交…" : "提交审核决定"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <section className="review-completed-card" aria-label="已保存的审核决定">
                    <span className="status-label">
                      {decisionCopy[selected.decision.decision].label}
                    </span>
                    <h3>该 Candidate 已有唯一 Review Decision</h3>
                    <p>
                      {selected.decision.application === null
                        ? "没有写入正式数据。"
                        : `${selected.decision.application.action === "created" ? "新建" : "更新"}目标 ${selected.decision.application.targetId}，版本 ${selected.decision.application.targetVersionBefore ?? "无"} → ${selected.decision.application.targetVersionAfter}。`}
                    </p>
                    {selected.decision.finalPayload === null ? null : (
                      <CandidatePayloadView payload={selected.decision.finalPayload} />
                    )}
                  </section>
                )}
              </section>
              <div>
                <EvidencePanel
                  candidate={selected}
                  panelRef={(node) => {
                    evidencePanel.current = node;
                  }}
                />
              </div>
            </div>
          </main>
        )}
      </div>
      <footer className="import-version-footer">
        <span>pipeline {view.versions.pipeline}</span>
        <span>schema {view.versions.extractionSchema}</span>
        <span>normalization {view.versions.normalizationPolicy}</span>
        <span>prompt {view.versions.prompt}</span>
      </footer>
    </div>
  );
}
