import { deleteVersionInputSchema, updateCourseItemInputSchema } from "@courseflow/contracts";
import { asCourseItemId, identityMismatch, type UpdateCourseItem } from "@courseflow/core";
import { getScopedCourseFlow } from "@/composition/runtime";
import { mutation } from "../../route-support";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(request: Request, context: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await context.params;
  return mutation(request, deleteVersionInputSchema, async (input) => {
    const { planning, scope } = await getScopedCourseFlow();
    await planning.deleteCourseItem(scope, {
      expectedVersion: input.expectedVersion,
      itemId: asCourseItemId(itemId),
    });
    return { deleted: true };
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await context.params;
  return mutation(request, updateCourseItemInputSchema, async (input) => {
    if (input.itemId !== itemId) throw identityMismatch("/itemId");
    const { planning, scope } = await getScopedCourseFlow();
    return planning.updateCourseItem(scope, {
      ...input,
      itemId: asCourseItemId(itemId),
    } as UpdateCourseItem);
  });
}
