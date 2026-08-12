import { setTermArchivedInputSchema } from "@courseflow/contracts";
import { asTermId, identityMismatch } from "@courseflow/core";
import { getScopedCourseFlow } from "@/composition/runtime";
import { mutation } from "../../../route-support";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(request: Request, context: { params: Promise<{ termId: string }> }) {
  const { termId } = await context.params;
  return mutation(request, setTermArchivedInputSchema, async (input) => {
    if (input.termId !== termId) throw identityMismatch("/termId");
    const { academics, scope } = await getScopedCourseFlow();
    return academics.setTermArchived(scope, {
      ...input,
      termId: asTermId(termId),
    });
  });
}
