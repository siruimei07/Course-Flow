import { updateTermInputSchema } from "@courseflow/contracts";
import { asTermId, identityMismatch, type UpdateTerm } from "@courseflow/core";
import { getScopedCourseFlow } from "@/composition/runtime";
import { mutation } from "../../route-support";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ termId: string }> }) {
  const { termId } = await context.params;
  return mutation(request, updateTermInputSchema, async (input) => {
    if (input.termId !== termId) throw identityMismatch("/termId");
    const { academics, scope } = await getScopedCourseFlow();
    return academics.updateTerm(scope, {
      ...input,
      termId: asTermId(termId),
    } as UpdateTerm);
  });
}
