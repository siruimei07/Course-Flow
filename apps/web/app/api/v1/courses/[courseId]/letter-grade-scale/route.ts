import { setCourseLetterGradeScaleInputSchema } from "@courseflow/contracts";
import { asCourseId, asLetterGradeScaleId, identityMismatch } from "@courseflow/core";
import { getScopedCourseFlow } from "@/composition/runtime";
import { mutation } from "../../../route-support";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(request: Request, context: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await context.params;
  return mutation(request, setCourseLetterGradeScaleInputSchema, async (input) => {
    if (input.courseId !== courseId) throw identityMismatch("/courseId");
    const { academics, scope } = await getScopedCourseFlow();
    return academics.setCourseLetterGradeScale(scope, {
      courseId: asCourseId(courseId),
      expectedVersion: input.expectedVersion,
      letterGradeScaleId:
        input.letterGradeScaleId === null ? null : asLetterGradeScaleId(input.letterGradeScaleId),
    });
  });
}
