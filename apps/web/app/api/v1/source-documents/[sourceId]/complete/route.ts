import { completeSourceUploadInputSchema } from "@courseflow/contracts";
import { asSourceDocumentId } from "@courseflow/core";
import { getScopedCourseFlow } from "@/composition/runtime";
import { mutation } from "../../../route-support";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await context.params;
  return mutation(request, completeSourceUploadInputSchema, async (input) => {
    const { scope, sources } = await getScopedCourseFlow();
    return sources.completeUpload(scope, {
      expectedVersion: input.expectedVersion,
      sourceId: asSourceDocumentId(sourceId),
    });
  });
}
