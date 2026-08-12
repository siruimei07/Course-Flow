import { saveGradeResultInputSchema } from "@courseflow/contracts";
import { asGradeComponentId, identityMismatch, type SaveGradeResult } from "@courseflow/core";
import { getScopedCourseFlow } from "@/composition/runtime";
import { mutation } from "../../../route-support";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(request: Request, context: { params: Promise<{ componentId: string }> }) {
  const { componentId } = await context.params;
  return mutation(request, saveGradeResultInputSchema, async (input) => {
    if (input.gradeComponentId !== componentId) throw identityMismatch("/gradeComponentId");
    const { planning, scope } = await getScopedCourseFlow();
    return planning.saveGradeResult(scope, {
      ...input,
      gradeComponentId: asGradeComponentId(componentId),
    } as SaveGradeResult);
  });
}
