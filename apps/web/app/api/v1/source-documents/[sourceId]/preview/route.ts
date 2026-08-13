import { asSourceDocumentId } from "@courseflow/core";
import { getScopedCourseFlow } from "@/composition/runtime";
import { fileQuery } from "../../../route-support";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await context.params;
  return fileQuery(request, async () => {
    const { scope, sources } = await getScopedCourseFlow();
    const preview = await sources.getSourcePreview(scope, asSourceDocumentId(sourceId));
    return Response.redirect(preview.url, 307);
  });
}
