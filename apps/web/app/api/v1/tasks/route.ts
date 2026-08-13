import { notFound } from "@courseflow/core";
import { getScopedCourseFlow } from "@/composition/runtime";
import { query } from "../route-support";
import { taskBoardQueryFromRequest } from "../schedule-route-support";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return query(request, async () => {
    const { schedule, scope } = await getScopedCourseFlow();
    const result = await schedule.getTaskBoard(scope, taskBoardQueryFromRequest(request));
    if (result === null) throw notFound();
    return result;
  });
}
