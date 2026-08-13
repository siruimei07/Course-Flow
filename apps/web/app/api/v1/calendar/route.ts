import { notFound } from "@courseflow/core";
import { getScopedCourseFlow } from "@/composition/runtime";
import { query } from "../route-support";
import { calendarQueryFromRequest } from "../schedule-route-support";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return query(request, async () => {
    const { schedule, scope } = await getScopedCourseFlow();
    const result = await schedule.getCalendar(scope, calendarQueryFromRequest(request));
    if (result === null) throw notFound();
    return result;
  });
}
