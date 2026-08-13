import type {
  CandidateId,
  CourseId,
  EvidenceId,
  ImportRunId,
  SourceAssetId,
  SourceDocumentId,
} from "../shared";

export const reviewDecisions = [
  "accepted",
  "accepted_with_edits",
  "rejected",
  "duplicate",
] as const;
export type ReviewDecision = (typeof reviewDecisions)[number];

export type EvidenceLocatorStatus = "unverified" | "verified_text" | "vision_only";

export type EvidenceView = Readonly<{
  bbox: Readonly<{ height: number; width: number; x: number; y: number }> | null;
  id: EvidenceId;
  locatorStatus: EvidenceLocatorStatus;
  originalFilename: string;
  pageNumber: number;
  quote: string;
  sourceAssetId: SourceAssetId;
  textHash: string;
}>;

export type CandidateWarningView = Readonly<{
  code: string;
  message: string;
  severity: "blocking" | "info" | "warning";
}>;

export type CoursePatchCandidatePayload = Readonly<{
  code?: string;
  instructorName?: string | null;
  section?: string | null;
  title?: string;
}>;

export type CourseItemCandidatePayload = Readonly<{
  courseId: CourseId;
  details: string | null;
  estimatedMinutes: number | null;
  kind:
    | "assignment"
    | "exam"
    | "lab"
    | "milestone"
    | "other"
    | "presentation"
    | "project"
    | "quiz"
    | "reading";
  temporal:
    | Readonly<{ kind: "unscheduled"; note: string | null }>
    | Readonly<{ date: string; kind: "date"; note: string | null }>
    | Readonly<{ at: string; kind: "deadline"; note: string | null; timeZone: string }>
    | Readonly<{
        endsAt: string;
        kind: "interval";
        note: string | null;
        startsAt: string;
        timeZone: string;
      }>;
  title: string;
}>;

export type GradingSchemeCandidatePayload = Readonly<{
  components: readonly Readonly<{
    ruleText: string | null;
    title: string;
    weightBps: number | null;
  }>[];
  conditionText: string | null;
  courseId: CourseId;
  isPrimary: boolean;
  name: string;
}>;

export type CandidatePayload =
  CourseItemCandidatePayload | CoursePatchCandidatePayload | GradingSchemeCandidatePayload;

export type CandidateKind = "course_item" | "course_patch" | "grading_scheme";

export type CandidateEvidenceView = Readonly<{
  confidenceMilli: number;
  evidence: EvidenceView;
  fieldPath: string;
  inference: string;
  isPrimary: boolean;
}>;

export type ReviewTargetView = Readonly<{
  id: string;
  label: string;
  summary: string;
  version: number;
}>;

export type ReviewDecisionView = Readonly<{
  application: Readonly<{
    action: "created" | "updated";
    targetId: string;
    targetVersionAfter: number;
    targetVersionBefore: number | null;
  }> | null;
  decision: ReviewDecision;
  decidedAt: string;
  finalPayload: CandidatePayload | null;
  note: string | null;
}>;

export type ImportCandidateView = Readonly<{
  confidenceLabel: "high" | "low" | "medium";
  confidenceMilli: number;
  decision: ReviewDecisionView | null;
  evidence: readonly CandidateEvidenceView[];
  fingerprint: string;
  id: CandidateId;
  kind: CandidateKind;
  proposedPayload: CandidatePayload;
  schemaVersion: string;
  sortOrder: number;
  targets: readonly ReviewTargetView[];
  title: string;
  warnings: readonly CandidateWarningView[];
}>;

export type ImportRunStatus =
  | "awaiting_review"
  | "cancelled"
  | "extracting"
  | "failed"
  | "normalizing"
  | "partially_reviewed"
  | "preparing"
  | "queued"
  | "reviewed"
  | "validating";

export type ImportProgressView = Readonly<{
  accepted: number;
  duplicate: number;
  edited: number;
  rejected: number;
  remaining: number;
  total: number;
}>;

export type ImportReviewView = Readonly<{
  candidates: readonly ImportCandidateView[];
  conflict: Readonly<{ latestVersion: number; message: string }> | null;
  currentStage: string;
  error: Readonly<{ code: string; message: string; retryable: boolean }> | null;
  progress: ImportProgressView;
  progressCurrent: number;
  progressTotal: number;
  runId: ImportRunId;
  runVersion: number;
  source: Readonly<{
    courseCode: string;
    courseId: CourseId;
    displayName: string;
    id: SourceDocumentId;
  }>;
  status: ImportRunStatus;
  versions: Readonly<{
    extractionSchema: string;
    normalizationPolicy: string;
    pipeline: string;
    prompt: string;
  }>;
}>;

export type ReviewApplication =
  | Readonly<{ kind: "create" }>
  | Readonly<{ expectedVersion: number; kind: "update_existing"; targetId: string }>;

export type ReviewCandidateInput = Readonly<{
  application: ReviewApplication | null;
  candidateId: CandidateId;
  decision: ReviewDecision;
  duplicateTargetId: string | null;
  finalPayload: CandidatePayload | null;
  idempotencyKey: string;
  note: string | null;
}>;

export type ReviewResult = Readonly<{
  candidateId: CandidateId;
  decision: ReviewDecision;
  progress: ImportProgressView;
  replayed: boolean;
  target: Readonly<{ action: "created" | "updated"; id: string; version: number }> | null;
}>;
