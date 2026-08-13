import {
  notFound,
  validationError,
  versionConflict,
  type CommandResult,
  type UserScope,
} from "../shared";
import type { ReviewCommands, ReviewRepository } from "./repository";
import type {
  CandidatePayload,
  ImportCandidateView,
  ReviewCandidateInput,
  ReviewResult,
} from "./types";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function validateDecision(candidate: ImportCandidateView, input: ReviewCandidateInput): void {
  const issues: { code: string; message: string; path: string }[] = [];
  if (input.idempotencyKey.trim().length < 8 || input.idempotencyKey.length > 200) {
    issues.push({
      code: "INVALID_IDEMPOTENCY_KEY",
      message: "审核请求需要稳定的幂等键。",
      path: "/idempotencyKey",
    });
  }
  const accepted = input.decision === "accepted" || input.decision === "accepted_with_edits";
  if (accepted) {
    if (input.finalPayload === null) {
      issues.push({
        code: "FINAL_PAYLOAD_REQUIRED",
        message: "接受类决定必须提交完整 final payload。",
        path: "/finalPayload",
      });
    }
    if (input.application === null) {
      issues.push({
        code: "APPLICATION_REQUIRED",
        message: "接受类决定必须明确写入目标。",
        path: "/application",
      });
    }
    if (input.duplicateTargetId !== null) {
      issues.push({
        code: "DUPLICATE_TARGET_FORBIDDEN",
        message: "接受类决定不能同时指定重复目标。",
        path: "/duplicateTargetId",
      });
    }
  } else if (input.finalPayload !== null || input.application !== null) {
    issues.push({
      code: "FORMAL_WRITE_FORBIDDEN",
      message: "拒绝或重复决定不得写入正式数据。",
      path: "/application",
    });
  }
  if (input.decision === "accepted" && input.finalPayload !== null) {
    if (canonicalJson(input.finalPayload) !== canonicalJson(candidate.proposedPayload)) {
      issues.push({
        code: "EDITED_PAYLOAD_REQUIRES_EDIT_DECISION",
        message: "已修改 payload 必须选择“修改后接受”。",
        path: "/decision",
      });
    }
  }
  if (input.decision === "duplicate") {
    if (candidate.kind === "course_patch" || input.duplicateTargetId === null) {
      issues.push({
        code: "DUPLICATE_TARGET_REQUIRED",
        message: "重复决定必须指定同类正式记录。",
        path: "/duplicateTargetId",
      });
    }
  } else if (input.duplicateTargetId !== null) {
    issues.push({
      code: "DUPLICATE_TARGET_FORBIDDEN",
      message: "只有重复决定可以指定重复目标。",
      path: "/duplicateTargetId",
    });
  }
  if (input.application?.kind === "update_existing") {
    const application = input.application;
    if (application.expectedVersion < 1 || application.targetId.trim() === "") {
      issues.push({
        code: "INVALID_UPDATE_TARGET",
        message: "更新目标必须包含 ID 与正整数 version。",
        path: "/application",
      });
    }
    const target = candidate.targets.find((entry) => entry.id === application.targetId);
    if (target === undefined) {
      issues.push({
        code: "INCOMPATIBLE_UPDATE_TARGET",
        message: "更新目标不属于当前候选的兼容集合。",
        path: "/application/targetId",
      });
    }
  }
  if (
    input.duplicateTargetId !== null &&
    !candidate.targets.some((target) => target.id === input.duplicateTargetId)
  ) {
    issues.push({
      code: "INCOMPATIBLE_DUPLICATE_TARGET",
      message: "重复目标不属于同课程同类型兼容集合。",
      path: "/duplicateTargetId",
    });
  }
  if (issues.length > 0) throw validationError("审核决定无法提交。", issues);
}

function requestFingerprint(input: ReviewCandidateInput): string {
  return canonicalJson({
    application: input.application,
    candidateId: input.candidateId,
    decision: input.decision,
    duplicateTargetId: input.duplicateTargetId,
    finalPayload: input.finalPayload,
    note: input.note,
  });
}

export function createReviewCommands(repository: ReviewRepository): ReviewCommands {
  return {
    async reviewCandidate(
      scope: UserScope,
      input: ReviewCandidateInput,
    ): Promise<CommandResult<ReviewResult>> {
      const candidate = await repository.getCandidateForReview(scope, input.candidateId);
      if (candidate === null) throw notFound();
      validateDecision(candidate, input);
      const outcome = await repository.commitReviewTransaction(scope, {
        candidateFingerprint: candidate.fingerprint,
        input,
        requestFingerprint: requestFingerprint(input),
      });
      if (outcome.kind === "version_conflict") throw versionConflict(outcome.latestVersion);
      return {
        value: { ...outcome.result, replayed: outcome.kind === "replayed" },
        warnings: [],
      };
    },
  };
}

export function payloadEquals(left: CandidatePayload, right: CandidatePayload): boolean {
  return canonicalJson(left) === canonicalJson(right);
}
