import { saveMeetingExceptionInputSchema } from "@courseflow/contracts";
import { asMeetingPatternId, identityMismatch, type SaveMeetingException } from "@courseflow/core";
import { getScopedCourseFlow } from "@/composition/runtime";
import { mutation } from "../../../../route-support";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(
  request: Request,
  context: { params: Promise<{ localDate: string; patternId: string }> },
) {
  const { localDate, patternId } = await context.params;
  return mutation(request, saveMeetingExceptionInputSchema, async (input) => {
    if (input.meetingPatternId !== patternId || input.occurrenceDate !== localDate) {
      throw identityMismatch("/meetingPatternId");
    }
    const { academics, scope } = await getScopedCourseFlow();
    return academics.saveMeetingException(scope, {
      ...input,
      meetingPatternId: asMeetingPatternId(patternId),
    } as SaveMeetingException);
  });
}
