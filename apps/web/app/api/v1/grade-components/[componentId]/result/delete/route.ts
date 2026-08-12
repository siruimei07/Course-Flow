import { deleteVersionInputSchema } from "@courseflow/contracts";
import { asGradeComponentId } from "@courseflow/core";
import { getScopedCourseFlow } from "@/composition/runtime";
import { mutation } from "../../../../route-support";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request, context: { params: Promise<{ componentId: string }> }) {
  return context.params.then(({ componentId }) =>
    mutation(request, deleteVersionInputSchema, async (input) => {
      const { planning, scope } = await getScopedCourseFlow();
      await planning.deleteGradeResult(scope, {
        expectedVersion: input.expectedVersion,
        gradeComponentId: asGradeComponentId(componentId),
      });
      return { deleted: true };
    }),
  );
}
