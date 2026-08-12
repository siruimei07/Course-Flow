import { describe, expect, it } from "vitest";
import {
  asCalendarExceptionId,
  asCourseId,
  asGradeComponentId,
  asGradeResultId,
  asGradingSchemeId,
  asMeetingPatternId,
  asMeetingExceptionId,
  asTermId,
  expandMeetingOccurrences,
  parseCourseItemTemporal,
  projectGradebook,
  resolveLocalDateTime,
  validateLetterGradeBands,
  type CourseSetupView,
  type GradingScheme,
} from "./index";

describe("P1 temporal and academic calendar invariants", () => {
  it.each([
    [{ kind: "unscheduled", note: "Week 6; TBA" }, "unscheduled"],
    [{ kind: "date", date: "2026-10-10" }, "date"],
    [{ kind: "deadline", at: "2026-10-11T03:59:00Z", timeZone: "America/Toronto" }, "deadline"],
    [
      {
        kind: "interval",
        startsAt: "2026-10-10T17:00:00Z",
        endsAt: "2026-10-10T19:00:00Z",
        timeZone: "America/Toronto",
      },
      "interval",
    ],
  ] as const)("keeps the %s temporal variant distinct", (input, expected) => {
    expect(parseCourseItemTemporal(input).kind).toBe(expected);
  });

  it("reports DST gaps and overlaps instead of choosing an instant", () => {
    expect(resolveLocalDateTime("2026-03-08", "02:30", "America/Toronto")).toEqual({
      kind: "gap",
    });
    expect(resolveLocalDateTime("2026-11-01", "01:30", "America/Toronto")).toMatchObject({
      kind: "overlap",
    });
    expect(resolveLocalDateTime("2026-10-20", "14:00", "America/Toronto")).toMatchObject({
      instant: "2026-10-20T18:00:00.000Z",
      kind: "exact",
    });
  });

  it("suppresses Reading Week while a kept occurrence overrides it", () => {
    const setup: CourseSetupView = {
      calendarExceptions: [
        {
          endDate: "2026-10-16",
          id: asCalendarExceptionId("00000000-0000-4000-8000-000000000002"),
          kind: "reading_week",
          name: "Reading Week",
          startDate: "2026-10-12",
          suppressesMeetings: true,
          termId: asTermId("00000000-0000-4000-8000-000000000001"),
          version: 1,
        },
      ],
      course: {
        archivedAt: null,
        code: "CSC258H5",
        colorKey: "orange",
        creditValueMilli: 500,
        id: asCourseId("00000000-0000-4000-8000-000000000003"),
        instructorName: null,
        letterGradeScaleId: null,
        section: null,
        termId: asTermId("00000000-0000-4000-8000-000000000001"),
        timeZone: "America/Toronto",
        title: "Computer Organization",
        version: 1,
      },
      meetingExceptions: [
        {
          action: "kept",
          id: asMeetingExceptionId("00000000-0000-4000-8000-000000000005"),
          meetingPatternId: asMeetingPatternId("00000000-0000-4000-8000-000000000004"),
          note: null,
          occurrenceDate: "2026-10-14",
          replacementDate: null,
          replacementEndTime: null,
          replacementLocationText: null,
          replacementStartTime: null,
          replacementTimeZone: null,
          version: 1,
        },
      ],
      meetingPatterns: [
        {
          archivedAt: null,
          courseId: asCourseId("00000000-0000-4000-8000-000000000003"),
          effectiveEndDate: null,
          effectiveStartDate: null,
          id: asMeetingPatternId("00000000-0000-4000-8000-000000000004"),
          kind: "lecture",
          localEndTime: "16:00",
          localStartTime: "14:00",
          locationText: "IB 345",
          section: null,
          title: null,
          version: 1,
          weekdays: [2],
        },
      ],
      term: {
        archivedAt: null,
        endDate: "2026-12-18",
        id: asTermId("00000000-0000-4000-8000-000000000001"),
        name: "2026 Fall",
        startDate: "2026-09-08",
        timeZone: "America/Toronto",
        version: 1,
        weekNumberingPolicy: "teaching_weeks_v1",
      },
    };

    const occurrences = expandMeetingOccurrences(setup, "2026-10-07", "2026-10-21");
    expect(occurrences.map((occurrence) => [occurrence.originalDate, occurrence.status])).toEqual([
      ["2026-10-07", "scheduled"],
      ["2026-10-14", "kept"],
      ["2026-10-21", "scheduled"],
    ]);
  });
});

describe("P1 Gradebook invariants", () => {
  it("reports earned course points, graded percentage and covered weight without zero-filling", () => {
    const scheme: GradingScheme = {
      components: [
        {
          id: asGradeComponentId("00000000-0000-4000-8000-000000000012"),
          result: {
            earnedMilli: 80_000n,
            gradeComponentId: asGradeComponentId("00000000-0000-4000-8000-000000000012"),
            id: asGradeResultId("00000000-0000-4000-8000-000000000013"),
            note: null,
            possibleMilli: 100_000n,
            version: 1,
          },
          ruleText: null,
          sortOrder: 0,
          title: "Midterm",
          weightBps: 2_000,
        },
        {
          id: asGradeComponentId("00000000-0000-4000-8000-000000000014"),
          result: null,
          ruleText: null,
          sortOrder: 1,
          title: "Final",
          weightBps: 8_000,
        },
      ],
      conditionText: null,
      courseId: asCourseId("00000000-0000-4000-8000-000000000010"),
      id: asGradingSchemeId("00000000-0000-4000-8000-000000000011"),
      isPrimary: true,
      name: "Default",
      version: 1,
    };

    expect(projectGradebook(scheme.courseId, scheme, null)).toMatchObject({
      currentLetter: null,
      earnedCourseBps: 1_600,
      gradedPortionPercentBps: 8_000,
      gradedWeightBps: 2_000,
      ungradedCount: 1,
    });
  });

  it("requires complete monotonic A/B/C/D/F boundaries", () => {
    expect(() =>
      validateLetterGradeBands([
        { letter: "A", minimumPercentBps: 8_500 },
        { letter: "B", minimumPercentBps: 7_000 },
        { letter: "C", minimumPercentBps: 7_000 },
        { letter: "D", minimumPercentBps: 5_000 },
        { letter: "F", minimumPercentBps: 0 },
      ]),
    ).toThrowError(/严格单调/u);
  });
});
