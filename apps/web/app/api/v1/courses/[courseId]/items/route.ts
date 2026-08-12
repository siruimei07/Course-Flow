import { createCourseItemInputSchema } from "@courseflow/contracts";
import {
  asCourseId,
  asTaskLabelId,
  identityMismatch,
  type CreateCourseItem,
} from "@courseflow/core";
import { getScopedCourseFlow } from "@/composition/runtime";
import { mutation } from "../../../route-support";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await context.params;
  return mutation(
    request,
    createCourseItemInputSchema,
    async (input) => {
      if (input.courseId !== courseId) throw identityMismatch("/courseId");
      const { planning, scope } = await getScopedCourseFlow();
      return planning.createCourseItem(scope, {
        ...input,
        courseId: asCourseId(courseId),
        labelIds: input.labelIds?.map(asTaskLabelId),
      } as CreateCourseItem);
    },
    201,
  );
}
