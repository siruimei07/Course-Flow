import type { CandidateId, CommandResult, UserScope } from "../shared";
import type { ImportCandidateView, ReviewCandidateInput, ReviewResult } from "./types";

export type ReviewCommitCommand = Readonly<{
  candidateFingerprint: string;
  input: ReviewCandidateInput;
  requestFingerprint: string;
}>;

export type ReviewCommitOutcome =
  | Readonly<{ kind: "committed"; result: ReviewResult }>
  | Readonly<{ kind: "replayed"; result: ReviewResult }>
  | Readonly<{ kind: "version_conflict"; latestVersion?: number }>;

export interface ReviewRepository {
  /**
   * Locks and revalidates the immutable Candidate, applies formal data, writes the Decision and
   * Application, and updates run progress in one transaction. No partial state may escape.
   */
  commitReviewTransaction(
    scope: UserScope,
    command: ReviewCommitCommand,
  ): Promise<ReviewCommitOutcome>;
  getCandidateForReview(
    scope: UserScope,
    candidateId: CandidateId,
  ): Promise<ImportCandidateView | null>;
}

export interface ReviewCommands {
  reviewCandidate(
    scope: UserScope,
    input: ReviewCandidateInput,
  ): Promise<CommandResult<ReviewResult>>;
}
