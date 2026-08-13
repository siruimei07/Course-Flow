import { notFound } from "@courseflow/core";
import { getScopedCourseFlow } from "@/composition/runtime";
import { query } from "../route-support";
import { scheduleQueryFromRequest } from "../schedule-route-support";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return query(request, async () => {
    const { schedule, scope } = await getScopedCourseFlow();
    const result = await schedule.getDashboard(scope, scheduleQueryFromRequest(request));
    if (result === null) throw notFound();
    return result;
  });
}
