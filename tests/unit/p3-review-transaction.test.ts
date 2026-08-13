import { describe, expect, it } from "vitest";
import {
  asCandidateId,
  asCourseId,
  asEvidenceId,
  asSourceAssetId,
  asUserId,
  createReviewCommands,
  type CandidateId,
  type ImportCandidateView,
  type ReviewCommitCommand,
  type ReviewCommitOutcome,
  type ReviewRepository,
  type ReviewResult,
  type UserScope,
} from "@courseflow/core";

const candidateId = asCandidateId("20000000-0000-4000-8000-000000000001");
const courseId = asCourseId("10000000-0000-4000-8000-000000000001");
const targetId = "70000000-0000-4000-8000-000000000001";
const scope: UserScope = { userId: asUserId("00000000-0000-4000-8000-000000000001") };

function candidate(): ImportCandidateView {
  return {
    confidenceLabel: "high",
    confidenceMilli: 930,
    decision: null,
    evidence: [
      {
        confidenceMilli: 930,
        evidence: {
          bbox: null,
          id: asEvidenceId("30000000-0000-4000-8000-000000000001"),
          locatorStatus: "verified_text",
          originalFilename: "lab-guide.pdf",
          pageNumber: 6,
          quote: "Lab Report 1",
          sourceAssetId: asSourceAssetId("40000000-0000-4000-8000-000000000001"),
          textHash: "sha256:verified-text-fixture",
        },
        fieldPath: "/title",
        inference: "原文直接支持事项标题。",
        isPrimary: true,
      },
    ],
    fingerprint: "immutable-candidate-fingerprint",
    id: candidateId,
    kind: "course_item",
    proposedPayload: {
      courseId,
      details: null,
      estimatedMinutes: 120,
      kind: "lab",
      temporal: { date: "2026-09-26", kind: "date", note: null },
      title: "Lab Report 1",
    },
    schemaVersion: "course-item-candidate-v1",
    sortOrder: 0,
    targets: [{ id: targetId, label: "Existing lab", summary: "same course", version: 3 }],
    title: "Lab Report 1",
    warnings: [],
  };
}

class AtomicReviewRepository implements ReviewRepository {
  candidate = candidate();
  decisions = new Map<CandidateId, ReviewResult>();
  formalWrites = 0;
  idempotency = new Map<string, Readonly<{ fingerprint: string; result: ReviewResult }>>();
  injectFailureAfterFormalValidation = false;
  targetVersion = 3;

  async getCandidateForReview(
    queryScope: UserScope,
    queryCandidateId: CandidateId,
  ): Promise<ImportCandidateView | null> {
    if (queryScope.userId !== scope.userId || queryCandidateId !== candidateId) return null;
    return this.decisions.has(candidateId) ? { ...this.candidate, decision: null } : this.candidate;
  }

  async commitReviewTransaction(
    _scope: UserScope,
    command: ReviewCommitCommand,
  ): Promise<ReviewCommitOutcome> {
    const key = `${command.input.candidateId}:${command.input.idempotencyKey}`;
    const replay = this.idempotency.get(key);
    if (replay !== undefined) {
      return replay.fingerprint === command.requestFingerprint
        ? { kind: "replayed", result: replay.result }
        : { kind: "version_conflict" };
    }
    if (this.decisions.has(command.input.candidateId)) return { kind: "version_conflict" };
    if (command.candidateFingerprint !== this.candidate.fingerprint) {
      return { kind: "version_conflict" };
    }
    const application = command.input.application;
    if (
      application?.kind === "update_existing" &&
      application.expectedVersion !== this.targetVersion
    ) {
      return { kind: "version_conflict", latestVersion: this.targetVersion };
    }

    // The adapter stages formal, Decision, Application, progress and idempotency state in a clone.
    const stagedFormalWrites = this.formalWrites + (application === null ? 0 : 1);
    if (this.injectFailureAfterFormalValidation) throw new Error("injected transaction failure");
    const nextVersion =
      application?.kind === "update_existing"
        ? this.targetVersion + 1
        : application === null
          ? null
          : 1;
    const result: ReviewResult = {
      candidateId,
      decision: command.input.decision,
      progress: {
        accepted: command.input.decision === "accepted" ? 1 : 0,
        duplicate: command.input.decision === "duplicate" ? 1 : 0,
        edited: command.input.decision === "accepted_with_edits" ? 1 : 0,
        rejected: command.input.decision === "rejected" ? 1 : 0,
        remaining: 0,
        total: 1,
      },
      replayed: false,
      target:
        application === null || nextVersion === null
          ? null
          : {
              action: application.kind === "create" ? "created" : "updated",
              id:
                application.kind === "create"
                  ? "71000000-0000-4000-8000-000000000001"
                  : application.targetId,
              version: nextVersion,
            },
    };
    this.formalWrites = stagedFormalWrites;
    if (application?.kind === "update_existing") this.targetVersion = nextVersion!;
    this.decisions.set(candidateId, result);
    this.idempotency.set(key, { fingerprint: command.requestFingerprint, result });
    return { kind: "committed", result };
  }
}

function acceptedCommand(idempotencyKey: string, expectedVersion = 3) {
  return {
    application: { expectedVersion, kind: "update_existing" as const, targetId },
    candidateId,
    decision: "accepted" as const,
    duplicateTargetId: null,
    finalPayload: candidate().proposedPayload,
    idempotencyKey,
    note: null,
  };
}

describe("P3 review transaction contract", () => {
  it("commits one formal write and replays the same idempotent decision", async () => {
    const repository = new AtomicReviewRepository();
    const commands = createReviewCommands(repository);
    const first = await commands.reviewCandidate(scope, acceptedCommand("stable-request-001"));
    const replay = await commands.reviewCandidate(scope, acceptedCommand("stable-request-001"));

    expect(first.value).toMatchObject({
      replayed: false,
      target: { action: "updated", version: 4 },
    });
    expect(replay.value).toMatchObject({
      replayed: true,
      target: { action: "updated", version: 4 },
    });
    expect(repository.formalWrites).toBe(1);
    expect(repository.decisions.size).toBe(1);
  });

  it("keeps Candidate unresolved when the formal target version conflicts", async () => {
    const repository = new AtomicReviewRepository();
    repository.targetVersion = 4;
    const commands = createReviewCommands(repository);

    await expect(
      commands.reviewCandidate(scope, acceptedCommand("stable-request-002", 3)),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT", latestVersion: 4 });
    expect(repository.formalWrites).toBe(0);
    expect(repository.decisions.size).toBe(0);
  });

  it("rolls back formal and decision state when the transaction fails", async () => {
    const repository = new AtomicReviewRepository();
    repository.injectFailureAfterFormalValidation = true;
    const commands = createReviewCommands(repository);

    await expect(
      commands.reviewCandidate(scope, acceptedCommand("stable-request-003")),
    ).rejects.toThrow("injected transaction failure");
    expect(repository.formalWrites).toBe(0);
    expect(repository.decisions.size).toBe(0);
    expect(repository.idempotency.size).toBe(0);
  });

  it("rejects hidden writes and edited payloads with the wrong decision type", async () => {
    const repository = new AtomicReviewRepository();
    const commands = createReviewCommands(repository);

    await expect(
      commands.reviewCandidate(scope, {
        ...acceptedCommand("stable-request-004"),
        decision: "rejected",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      commands.reviewCandidate(scope, {
        ...acceptedCommand("stable-request-005"),
        finalPayload: { ...candidate().proposedPayload, title: "Edited title" },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(repository.formalWrites).toBe(0);
  });
});
