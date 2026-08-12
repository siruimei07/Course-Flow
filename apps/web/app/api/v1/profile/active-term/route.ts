import { setActiveTermInputSchema } from "@courseflow/contracts";
import { asTermId } from "@courseflow/core";
import { getScopedCourseFlow } from "@/composition/runtime";
import { mutation } from "../../route-support";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function PUT(request: Request) {
  return mutation(request, setActiveTermInputSchema, async (input) => {
    const { academics, scope } = await getScopedCourseFlow();
    await academics.setActiveTerm(scope, asTermId(input.termId));
    return null;
  });
}
