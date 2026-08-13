import { notFound } from "@courseflow/core";
import { getScopedCourseFlow } from "@/composition/runtime";
import { fileQuery } from "../../route-support";
import { calendarQueryFromRequest } from "../../schedule-route-support";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return fileQuery(request, async () => {
    const { schedule, scope } = await getScopedCourseFlow();
    const result = await schedule.exportCalendar(scope, calendarQueryFromRequest(request));
    if (result === null) throw notFound();
    return new Response(result.content, {
      headers: {
        "content-disposition": `attachment; filename="${result.fileName}"`,
        "content-type": result.mimeType,
        "x-courseflow-skipped-events": String(result.skipped.total),
      },
    });
  });
}
