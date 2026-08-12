import { saveTaskLabelInputSchema } from "@courseflow/contracts";
import { asTaskLabelId, asTermId, identityMismatch, type SaveTaskLabel } from "@courseflow/core";
import { getScopedCourseFlow } from "@/composition/runtime";
import { mutation } from "../../../route-support";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ termId: string }> }) {
  const { termId } = await context.params;
  return mutation(
    request,
    saveTaskLabelInputSchema,
    async (input) => {
      if (input.termId !== termId) throw identityMismatch("/termId");
      const { planning, scope } = await getScopedCourseFlow();
      return planning.saveTaskLabel(scope, {
        ...input,
        labelId: input.labelId === undefined ? undefined : asTaskLabelId(input.labelId),
        termId: asTermId(termId),
      } as SaveTaskLabel);
    },
    201,
  );
}
