import { reviewCandidateBodySchema } from "@courseflow/contracts";
import {
  asCandidateId,
  asUserId,
  type CandidatePayload,
  type ReviewCandidateInput,
} from "@courseflow/core";
import {
  getImportHarnessCommands,
  primeImportHarnessVersionConflict,
} from "@/composition/import-harness";
import { mutation } from "@courseflow-web/app/api/v1/route-support";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(request: Request, context: { params: Promise<{ candidateId: string }> }) {
  const commands = getImportHarnessCommands();
  if (commands === null) return new Response(null, { status: 404 });
  const { candidateId } = await context.params;
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (request.headers.get("x-courseflow-harness-scenario") === "version-conflict") {
    primeImportHarnessVersionConflict();
  }
  return mutation(request, reviewCandidateBodySchema, async (input) =>
    commands.reviewCandidate({ userId: asUserId("00000000-0000-4000-8000-000000000001") }, {
      ...input,
      candidateId: asCandidateId(candidateId),
      finalPayload: input.finalPayload as CandidatePayload | null,
      idempotencyKey,
    } as ReviewCandidateInput),
  );
}
