import { createTermInputSchema } from "@courseflow/contracts";
import type { CreateTerm } from "@courseflow/core";
import { getScopedCourseFlow } from "@/composition/runtime";
import { mutation, query } from "../route-support";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return query(request, async () => {
    const { academics, scope } = await getScopedCourseFlow();
    return academics.listTerms(scope);
  });
}

export function POST(request: Request) {
  return mutation(
    request,
    createTermInputSchema,
    async (input) => {
      const { academics, scope } = await getScopedCourseFlow();
      return academics.createTerm(scope, input as CreateTerm);
    },
    201,
  );
}
