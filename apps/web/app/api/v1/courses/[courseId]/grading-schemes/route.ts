import { saveGradingSchemeInputSchema } from "@courseflow/contracts";
import {
  asCourseId,
  asGradeComponentId,
  asGradingSchemeId,
  identityMismatch,
  type SaveGradingScheme,
} from "@courseflow/core";
import { getScopedCourseFlow } from "@/composition/runtime";
import { mutation } from "../../../route-support";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await context.params;
  return mutation(
    request,
    saveGradingSchemeInputSchema,
    async (input) => {
      if (input.courseId !== courseId) throw identityMismatch("/courseId");
      const { planning, scope } = await getScopedCourseFlow();
      return planning.saveGradingScheme(scope, {
        ...input,
        components: input.components.map((component) => ({
          ...component,
          id: component.id === undefined ? undefined : asGradeComponentId(component.id),
        })),
        courseId: asCourseId(courseId),
        schemeId: input.schemeId === undefined ? undefined : asGradingSchemeId(input.schemeId),
      } as SaveGradingScheme);
    },
    201,
  );
}
