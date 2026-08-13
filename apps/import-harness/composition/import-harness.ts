import {
  DeterministicDeepSeekResponsesFake,
  asCandidateId,
  asCourseId,
  asEvidenceId,
  asImportRunId,
  asSourceAssetId,
  asSourceDocumentId,
  createReviewCommands,
  runPlanningAssistantPipeline,
  type AiResultRegionView,
  type CandidateId,
  type ImportCandidateView,
  type ImportProgressView,
  type ImportReviewView,
  type ReviewCommitCommand,
  type ReviewCommitOutcome,
  type ReviewCommands,
  type ReviewDecisionView,
  type ReviewRepository,
  type ReviewResult,
  type UserScope,
} from "@courseflow/core";

const ids = {
  candidateOne: asCandidateId("20000000-0000-4000-8000-000000000001"),
  candidateTwo: asCandidateId("20000000-0000-4000-8000-000000000002"),
  candidateThree: asCandidateId("20000000-0000-4000-8000-000000000003"),
  course: asCourseId("10000000-0000-4000-8000-000000000001"),
  evidenceOne: asEvidenceId("30000000-0000-4000-8000-000000000001"),
  evidenceTwo: asEvidenceId("30000000-0000-4000-8000-000000000002"),
  evidenceThree: asEvidenceId("30000000-0000-4000-8000-000000000003"),
  run: asImportRunId("40000000-0000-4000-8000-000000000001"),
  source: asSourceDocumentId("50000000-0000-4000-8000-000000000001"),
  sourceAsset: asSourceAssetId("60000000-0000-4000-8000-000000000001"),
  target: "70000000-0000-4000-8000-000000000001",
} as const;

const longEvidence =
  "Lab Report 1 is due on September 26 at 11:59 PM and is worth 10% of the final grade. " +
  "Your submission must include the complete circuit diagram, the measured timing table, a short explanation of each discrepancy, and an appendix containing the raw observations from every trial. " +
  "If the learning platform is unavailable, keep the timestamped local copy and contact the teaching team. This paragraph intentionally remains long so the review interface proves that original Evidence is never truncated, collapsed, or replaced by an AI summary during keyboard and 200% zoom review.";

function candidateFixtures(): readonly ImportCandidateView[] {
  return [
    {
      confidenceLabel: "high",
      confidenceMilli: 930,
      decision: null,
      evidence: [
        {
          confidenceMilli: 930,
          evidence: {
            bbox: { height: 0.12, width: 0.78, x: 0.11, y: 0.41 },
            id: ids.evidenceOne,
            locatorStatus: "verified_text",
            originalFilename: "CSC258 Lab Guide.pdf",
            pageNumber: 6,
            quote: longEvidence,
            sourceAssetId: ids.sourceAsset,
            textHash: "sha256:8a2e9f83a1e5685f6c9f12b2ef1931c8",
          },
          fieldPath: "/temporal/at",
          inference: "原文明确给出截止日期与时刻。",
          isPrimary: true,
        },
      ],
      fingerprint: "candidate-course-item-lab-report-1-v1",
      id: ids.candidateOne,
      kind: "course_item",
      proposedPayload: {
        courseId: ids.course,
        details: "Worth 10% of the final grade.",
        estimatedMinutes: 300,
        kind: "lab",
        temporal: {
          at: "2026-09-26T23:59:00-04:00",
          kind: "deadline",
          note: "原文写明 11:59 PM",
          timeZone: "America/Toronto",
        },
        title: "实验报告 1",
      },
      schemaVersion: "course-item-candidate-v1",
      sortOrder: 0,
      targets: [
        {
          id: ids.target,
          label: "实验报告草稿",
          summary: "同课程现有 Lab · 截止日期未设置",
          version: 3,
        },
      ],
      title: "实验报告 1",
      warnings: [
        {
          code: "EXISTING_MATCH_REQUIRES_DECISION",
          message: "发现同课程同类型的现有事项；请明确新建还是更新。",
          severity: "warning",
        },
      ],
    },
    {
      confidenceLabel: "low",
      confidenceMilli: 580,
      decision: null,
      evidence: [
        {
          confidenceMilli: 580,
          evidence: {
            bbox: null,
            id: ids.evidenceTwo,
            locatorStatus: "unverified",
            originalFilename: "CSC258 Lab Guide.pdf",
            pageNumber: 8,
            quote:
              "Lab Report 2 — submit near the end of October; the exact date will be announced.",
            sourceAssetId: ids.sourceAsset,
            textHash: "sha256:454106ba5639f03d9fbe1961d347c7f0",
          },
          fieldPath: "/temporal/note",
          inference: "原文只说明十月底附近，准确日期仍待公布。",
          isPrimary: true,
        },
      ],
      fingerprint: "candidate-course-item-lab-report-2-v1",
      id: ids.candidateTwo,
      kind: "course_item",
      proposedPayload: {
        courseId: ids.course,
        details: null,
        estimatedMinutes: null,
        kind: "lab",
        temporal: { kind: "unscheduled", note: "October，准确日期待公布" },
        title: "实验报告 2",
      },
      schemaVersion: "course-item-candidate-v1",
      sortOrder: 1,
      targets: [],
      title: "实验报告 2",
      warnings: [
        {
          code: "EVIDENCE_UNVERIFIED",
          message: "Evidence 无法在文本层中定位；必须查看原始页后再决定。",
          severity: "blocking",
        },
        {
          code: "DATE_UNCERTAIN",
          message: "原文没有给出确定日期，保持 TBA，不能猜测截止日。",
          severity: "warning",
        },
      ],
    },
    {
      confidenceLabel: "medium",
      confidenceMilli: 740,
      decision: null,
      evidence: [
        {
          confidenceMilli: 740,
          evidence: {
            bbox: null,
            id: ids.evidenceThree,
            locatorStatus: "vision_only",
            originalFilename: "Project rubric.png",
            pageNumber: 11,
            quote: "Final project presentation — date TBA — 15%",
            sourceAssetId: ids.sourceAsset,
            textHash: "sha256:0fe048d601cd2493100521fb1a21b87d",
          },
          fieldPath: "/title",
          inference: "页图明确出现演示名称，但日期保持 TBA。",
          isPrimary: true,
        },
      ],
      fingerprint: "candidate-course-item-project-presentation-v1",
      id: ids.candidateThree,
      kind: "course_item",
      proposedPayload: {
        courseId: ids.course,
        details: "Weight: 15%",
        estimatedMinutes: 240,
        kind: "presentation",
        temporal: { kind: "unscheduled", note: "date TBA" },
        title: "期末项目演示",
      },
      schemaVersion: "course-item-candidate-v1",
      sortOrder: 2,
      targets: [],
      title: "期末项目演示",
      warnings: [
        {
          code: "VISION_ONLY_EVIDENCE",
          message: "Evidence 只来自页图定位；请对照原图。",
          severity: "info",
        },
      ],
    },
  ];
}

type HarnessState = {
  decisions: Map<CandidateId, ReviewDecisionView>;
  idempotency: Map<string, Readonly<{ fingerprint: string; result: ReviewResult }>>;
  targetVersions: Map<string, number>;
};

declare global {
  var courseflowImportHarnessState: HarnessState | undefined;
}

function state(): HarnessState {
  globalThis.courseflowImportHarnessState ??= {
    decisions: new Map(),
    idempotency: new Map(),
    targetVersions: new Map([[ids.target, 3]]),
  };
  return globalThis.courseflowImportHarnessState;
}

function progress(candidates: readonly ImportCandidateView[]): ImportProgressView {
  const decided = candidates.filter((candidate) => candidate.decision !== null);
  return {
    accepted: decided.filter((candidate) => candidate.decision?.decision === "accepted").length,
    duplicate: decided.filter((candidate) => candidate.decision?.decision === "duplicate").length,
    edited: decided.filter((candidate) => candidate.decision?.decision === "accepted_with_edits")
      .length,
    rejected: decided.filter((candidate) => candidate.decision?.decision === "rejected").length,
    remaining: candidates.length - decided.length,
    total: candidates.length,
  };
}

function liveCandidates(): readonly ImportCandidateView[] {
  const current = state();
  return candidateFixtures().map((candidate) => ({
    ...candidate,
    decision: current.decisions.get(candidate.id) ?? null,
    targets: candidate.targets.map((target) => ({
      ...target,
      version: current.targetVersions.get(target.id) ?? target.version,
    })),
  }));
}

function baseView(candidates: readonly ImportCandidateView[]): ImportReviewView {
  const reviewProgress = progress(candidates);
  return {
    candidates,
    conflict: null,
    currentStage: "awaiting_review",
    error: null,
    progress: reviewProgress,
    progressCurrent: 12,
    progressTotal: 12,
    runId: ids.run,
    runVersion: 4,
    source: {
      courseCode: "CSC258H5",
      courseId: ids.course,
      displayName: "CSC258 Lab Guide.pdf",
      id: ids.source,
    },
    status:
      reviewProgress.remaining === 0
        ? "reviewed"
        : reviewProgress.remaining === candidates.length
          ? "awaiting_review"
          : "partially_reviewed",
    versions: {
      extractionSchema: "extraction-v1",
      normalizationPolicy: "normalization-v1",
      pipeline: "pipeline-v1",
      prompt: "prompt-v1",
    },
  };
}

function withDecision(
  candidate: ImportCandidateView,
  decision: ReviewDecisionView,
): ImportCandidateView {
  return { ...candidate, decision };
}

export function isImportHarnessEnabled(): boolean {
  return process.env.COURSEFLOW_IMPORT_HARNESS === "enabled";
}

export function getImportHarnessView(runId: string): ImportReviewView | null {
  if (!isImportHarnessEnabled()) return null;
  if (runId === "demo-processing") {
    return {
      ...baseView([]),
      currentStage: "extracting",
      progressCurrent: 5,
      progressTotal: 12,
      status: "extracting",
    };
  }
  if (runId === "demo-error") {
    return {
      ...baseView([]),
      currentStage: "failed",
      error: {
        code: "PROVIDER_TRANSIENT",
        message: "外部解析服务暂时不可用；原始 Source 仍可预览，正式课程数据没有变化。",
        retryable: true,
      },
      progressCurrent: 4,
      progressTotal: 12,
      status: "failed",
    };
  }
  if (runId === "demo-conflict") {
    return {
      ...baseView(candidateFixtures()),
      conflict: {
        latestVersion: 4,
        message: "目标事项在审核期间被修改。Candidate 保持未决；请比较最新正式记录后重新决定。",
      },
    };
  }
  if (runId === "demo-partial") {
    const candidates = candidateFixtures();
    const first = candidates[0]!;
    return {
      ...baseView([
        withDecision(first, {
          application: {
            action: "created",
            targetId: "71000000-0000-4000-8000-000000000001",
            targetVersionAfter: 1,
            targetVersionBefore: null,
          },
          decidedAt: "2026-09-09T02:00:00.000Z",
          decision: "accepted",
          finalPayload: first.proposedPayload,
          note: null,
        }),
        ...candidates.slice(1),
      ]),
      status: "partially_reviewed",
    };
  }
  if (runId === "demo-review") return baseView(liveCandidates());
  return null;
}

class HarnessReviewRepository implements ReviewRepository {
  async getCandidateForReview(
    _scope: UserScope,
    candidateId: CandidateId,
  ): Promise<ImportCandidateView | null> {
    return liveCandidates().find((candidate) => candidate.id === candidateId) ?? null;
  }

  async commitReviewTransaction(
    _scope: UserScope,
    command: ReviewCommitCommand,
  ): Promise<ReviewCommitOutcome> {
    const current = state();
    const candidate = liveCandidates().find((entry) => entry.id === command.input.candidateId);
    if (candidate === undefined || candidate.fingerprint !== command.candidateFingerprint) {
      return { kind: "version_conflict" };
    }
    const key = `${candidate.id}:${command.input.idempotencyKey}`;
    const prior = current.idempotency.get(key);
    if (prior !== undefined) {
      return prior.fingerprint === command.requestFingerprint
        ? { kind: "replayed", result: prior.result }
        : { kind: "version_conflict" };
    }
    if (current.decisions.has(candidate.id)) return { kind: "version_conflict" };

    let target: ReviewResult["target"] = null;
    let application: ReviewDecisionView["application"] = null;
    const nextVersions = new Map(current.targetVersions);
    if (command.input.application?.kind === "update_existing") {
      const latest = current.targetVersions.get(command.input.application.targetId);
      if (latest !== command.input.application.expectedVersion) {
        return {
          kind: "version_conflict",
          ...(latest === undefined ? {} : { latestVersion: latest }),
        };
      }
      const nextVersion = latest + 1;
      target = {
        action: "updated",
        id: command.input.application.targetId,
        version: nextVersion,
      };
      application = {
        action: "updated",
        targetId: target.id,
        targetVersionAfter: nextVersion,
        targetVersionBefore: latest,
      };
      nextVersions.set(target.id, nextVersion);
    } else if (command.input.application?.kind === "create") {
      const createdId = `71000000-0000-4000-8000-${candidate.sortOrder
        .toString()
        .padStart(12, "0")}`;
      target = { action: "created", id: createdId, version: 1 };
      application = {
        action: "created",
        targetId: createdId,
        targetVersionAfter: 1,
        targetVersionBefore: null,
      };
    }

    const decision: ReviewDecisionView = {
      application,
      decidedAt: new Date().toISOString(),
      decision: command.input.decision,
      finalPayload: command.input.finalPayload,
      note: command.input.note,
    };
    const nextDecisions = new Map(current.decisions).set(candidate.id, decision);
    const nextCandidates = candidateFixtures().map((entry) => ({
      ...entry,
      decision: nextDecisions.get(entry.id) ?? null,
    }));
    const result: ReviewResult = {
      candidateId: candidate.id,
      decision: command.input.decision,
      progress: progress(nextCandidates),
      replayed: false,
      target,
    };
    const nextIdempotency = new Map(current.idempotency).set(key, {
      fingerprint: command.requestFingerprint,
      result,
    });

    // Publish all staged state together, mirroring the production transaction boundary.
    current.targetVersions = nextVersions;
    current.decisions = nextDecisions;
    current.idempotency = nextIdempotency;
    return { kind: "committed", result };
  }
}

let commands: ReviewCommands | undefined;

export function getImportHarnessCommands(): ReviewCommands | null {
  if (!isImportHarnessEnabled()) return null;
  commands ??= createReviewCommands(new HarnessReviewRepository());
  return commands;
}

export function primeImportHarnessVersionConflict(): void {
  if (isImportHarnessEnabled()) state().targetVersions.set(ids.target, 4);
}

const assistantQuestion = "请帮我为 Problem Set 1 起草手工表单。";

function assistantContext() {
  return {
    conversation: [
      { role: "user" as const, text: "我需要安排这份作业。" },
      { role: "assistant" as const, text: "我只会使用已确认的课程事实。" },
    ],
    facts: [
      {
        label: "Problem Set 1 · 2026-09-30",
        recordId: "item-1",
        text: "Problem Set 1 is due on 2026-09-30.",
        version: 2,
      },
    ],
    ownerScopeHash: "isolated-harness-owner",
    request: {
      courseId: ids.course,
      purpose: "prefill_course_item" as const,
      question: assistantQuestion,
    },
    snapshotId: "formal-snapshot-fixture-v1",
  };
}

function completedAssistantEnvelope(outputText: string) {
  return {
    id: "response_fixture_not_exposed",
    model: "deepseek-v4-pro-fixture",
    output: [
      {
        content: [{ text: outputText, type: "output_text" as const }],
        role: "assistant" as const,
        type: "message" as const,
      },
    ],
    status: "completed" as const,
  };
}

export async function getAiResultHarnessView(
  stateName: string,
): Promise<AiResultRegionView | null> {
  if (!isImportHarnessEnabled()) return null;
  if (stateName === "idle") {
    return { problem: null, question: "", result: null, status: "idle" };
  }
  if (stateName === "generating") {
    return { problem: null, question: assistantQuestion, result: null, status: "generating" };
  }
  if (stateName === "completed") {
    return runPlanningAssistantPipeline({
      context: assistantContext(),
      responses: new DeterministicDeepSeekResponsesFake(
        completedAssistantEnvelope(
          JSON.stringify({
            answer: "先核对 9 月 30 日到期的 Problem Set 1。",
            assumptions: ["学习时段仍由你确认。"],
            citations: [{ label: "ignored", recordId: "item-1", version: 2 }],
            draft: {
              courseId: ids.course,
              details: "对照资料后补充说明",
              estimatedMinutes: 120,
              kind: "assignment",
              temporal: { date: "2026-09-30", kind: "date", note: null },
              title: "Problem Set 1 分解",
              type: "course_item_prefill",
            },
          }),
        ),
      ),
    });
  }
  if (stateName === "cancelled") {
    const controller = new AbortController();
    controller.abort();
    return runPlanningAssistantPipeline({
      context: assistantContext(),
      responses: new DeterministicDeepSeekResponsesFake(completedAssistantEnvelope("{}")),
      signal: controller.signal,
    });
  }
  if (stateName === "failed") {
    return runPlanningAssistantPipeline({
      context: assistantContext(),
      responses: new DeterministicDeepSeekResponsesFake(
        completedAssistantEnvelope(
          JSON.stringify({
            answer: "<script>unsafe provider markup</script>",
            assumptions: [],
            citations: [],
            draft: null,
          }),
        ),
      ),
    });
  }
  return null;
}
