import { createCourseSetupInputSchema } from "@courseflow/contracts";
import { asLetterGradeScaleId, asTermId, type CreateCourseWithSchedule } from "@courseflow/core";
import { getScopedCourseFlow } from "@/composition/runtime";
import { mutation } from "../route-support";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request) {
  return mutation(
    request,
    createCourseSetupInputSchema,
    async (input) => {
      const { academics, scope } = await getScopedCourseFlow();
      return academics.createCourseWithSchedule(scope, {
        ...input,
        letterGradeScaleId:
          input.letterGradeScaleId === null || input.letterGradeScaleId === undefined
            ? input.letterGradeScaleId
            : asLetterGradeScaleId(input.letterGradeScaleId),
        termId: asTermId(input.termId),
      } as CreateCourseWithSchedule);
    },
    201,
  );
}
