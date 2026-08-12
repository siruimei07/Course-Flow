import { saveGradingSchemeInputSchema } from "@courseflow/contracts";
import {
  asCourseId,
  asGradeComponentId,
  asGradingSchemeId,
  identityMismatch,
  type SaveGradingScheme,
} from "@courseflow/core";
import { getScopedCourseFlow } from "@/composition/runtime";
import { mutation } from "../../../../route-support";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(
  request: Request,
  context: { params: Promise<{ courseId: string; schemeId: string }> },
) {
  const { courseId, schemeId } = await context.params;
  return mutation(request, saveGradingSchemeInputSchema, async (input) => {
    if (input.courseId !== courseId || input.schemeId !== schemeId)
      throw identityMismatch("/schemeId");
    const { planning, scope } = await getScopedCourseFlow();
    return planning.saveGradingScheme(scope, {
      ...input,
      components: input.components.map((component) => ({
        ...component,
        id: component.id === undefined ? undefined : asGradeComponentId(component.id),
      })),
      courseId: asCourseId(courseId),
      schemeId: asGradingSchemeId(schemeId),
    } as SaveGradingScheme);
  });
}
