import { setCourseItemStateInputSchema } from "@courseflow/contracts";
import { asCourseItemId, identityMismatch } from "@courseflow/core";
import { getScopedCourseFlow } from "@/composition/runtime";
import { mutation } from "../../../route-support";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(request: Request, context: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await context.params;
  return mutation(request, setCourseItemStateInputSchema, async (input) => {
    if (input.itemId !== itemId) throw identityMismatch("/itemId");
    const { planning, scope } = await getScopedCourseFlow();
    return planning.setCourseItemState(scope, { ...input, itemId: asCourseItemId(itemId) });
  });
}
