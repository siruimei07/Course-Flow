import { saveLetterGradeScaleInputSchema } from "@courseflow/contracts";
import { asLetterGradeScaleId, type SaveLetterGradeScale } from "@courseflow/core";
import { getScopedCourseFlow } from "@/composition/runtime";
import { mutation } from "../../route-support";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request) {
  return mutation(
    request,
    saveLetterGradeScaleInputSchema,
    async (input) => {
      const { planning, scope } = await getScopedCourseFlow();
      return planning.saveLetterGradeScale(scope, {
        ...input,
        scaleId: input.scaleId === undefined ? undefined : asLetterGradeScaleId(input.scaleId),
      } as SaveLetterGradeScale);
    },
    201,
  );
}
