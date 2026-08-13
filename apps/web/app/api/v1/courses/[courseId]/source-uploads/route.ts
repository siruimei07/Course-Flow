import { beginSourceUploadInputSchema } from "@courseflow/contracts";
import { asCourseId, identityMismatch, type BeginSourceUpload } from "@courseflow/core";
import { getScopedCourseFlow } from "@/composition/runtime";
import { mutation } from "../../../route-support";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await context.params;
  return mutation(
    request,
    beginSourceUploadInputSchema,
    async (input) => {
      if (input.courseId !== courseId) throw identityMismatch("/courseId");
      const { scope, sources } = await getScopedCourseFlow();
      return sources.beginUpload(scope, {
        ...input,
        courseId: asCourseId(courseId),
      } as BeginSourceUpload);
    },
    201,
  );
}
