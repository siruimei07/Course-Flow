import {
  calendarQuerySchema,
  scheduleQuerySchema,
  taskBoardQuerySchema,
} from "@courseflow/contracts";
import { asCourseId, asTaskLabelId, asTermId } from "@courseflow/core";

function optionalBoolean(value: string | null): boolean | string | undefined {
  if (value === null) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function baseValues(request: Request) {
  const parameters = new URL(request.url).searchParams;
  return {
    displayTimeZone: parameters.get("displayTimeZone") ?? undefined,
    from: parameters.get("from") ?? undefined,
    parameters,
    termId: parameters.get("termId"),
    to: parameters.get("to") ?? undefined,
  };
}

export function scheduleQueryFromRequest(request: Request) {
  const values = baseValues(request);
  const parsed = scheduleQuerySchema.parse({
    displayTimeZone: values.displayTimeZone,
    from: values.from,
    termId: values.termId,
    to: values.to,
  });
  return {
    ...(parsed.displayTimeZone === undefined ? {} : { displayTimeZone: parsed.displayTimeZone }),
    ...(parsed.from === undefined ? {} : { from: parsed.from }),
    termId: asTermId(parsed.termId),
    ...(parsed.to === undefined ? {} : { to: parsed.to }),
  };
}

export function taskBoardQueryFromRequest(request: Request) {
  const { parameters, ...values } = baseValues(request);
  const parsed = taskBoardQuerySchema.parse({
    ...values,
    group: parameters.get("group") ?? undefined,
    labelIds: parameters.has("labelId") ? parameters.getAll("labelId") : undefined,
    search: parameters.get("search") ?? undefined,
  });
  return {
    ...scheduleQueryFromRequest(request),
    ...(parsed.group === undefined ? {} : { group: parsed.group }),
    ...(parsed.labelIds === undefined ? {} : { labelIds: parsed.labelIds.map(asTaskLabelId) }),
    ...(parsed.search === undefined ? {} : { search: parsed.search }),
  };
}

export function calendarQueryFromRequest(request: Request) {
  const { parameters, ...values } = baseValues(request);
  const parsed = calendarQuerySchema.parse({
    ...values,
    courseIds: parameters.has("courseId") ? parameters.getAll("courseId") : undefined,
    includeItems: optionalBoolean(parameters.get("includeItems")),
    includeMeetings: optionalBoolean(parameters.get("includeMeetings")),
  });
  return {
    ...scheduleQueryFromRequest(request),
    ...(parsed.courseIds === undefined ? {} : { courseIds: parsed.courseIds.map(asCourseId) }),
    ...(parsed.includeItems === undefined ? {} : { includeItems: parsed.includeItems }),
    ...(parsed.includeMeetings === undefined ? {} : { includeMeetings: parsed.includeMeetings }),
  };
}
