import { describe, expect, it } from "vitest";
import { asCourseId, asCourseItemId } from "../shared";
import { foldIcsLine, serializeIcs, type CalendarEvent } from "./index";

const event: CalendarEvent = {
  course: {
    code: "CSC108",
    colorKey: "blue",
    id: asCourseId("30000000-0000-4000-8000-000000000001"),
    section: null,
    title: "计算机科学导论",
  },
  description: "先读 A,B；再写 C\\D",
  displayDate: "2026-09-10",
  id: "item:50000000-0000-4000-8000-000000000001",
  lastModified: "2026-09-09T01:00:00.000Z",
  location: null,
  sequence: 2,
  sourceId: asCourseItemId("50000000-0000-4000-8000-000000000001"),
  sourceType: "course_item",
  summary: "CSC108 作业一",
  time: { date: "2026-09-10", endDate: "2026-09-11", kind: "all_day" },
  uid: "50000000-0000-4000-8000-000000000001@courseflow.local",
};

describe("ICS serialization", () => {
  it("matches the canonical all-day event output", () => {
    expect(serializeIcs([event], "2026-09-09T01:30:00.000Z", "2026 秋季")).toBe(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//CourseFlow//Schedule Snapshot//ZH-CN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:2026 秋季",
        "BEGIN:VEVENT",
        "UID:50000000-0000-4000-8000-000000000001@courseflow.local",
        "DTSTAMP:20260909T013000Z",
        "LAST-MODIFIED:20260909T010000Z",
        "SEQUENCE:2",
        "SUMMARY:CSC108 作业一",
        "DESCRIPTION:先读 A\\,B；再写 C\\\\D",
        "DTSTART;VALUE=DATE:20260910",
        "DTEND;VALUE=DATE:20260911",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
      ].join("\r\n"),
    );
  });

  it("folds at 75 UTF-8 octets without splitting Chinese characters", () => {
    const lines = foldIcsLine(`DESCRIPTION:${"课程计划".repeat(30)}`);
    const encoder = new TextEncoder();

    expect(lines.length).toBeGreaterThan(1);
    expect(lines.slice(1).every((line) => line.startsWith(" "))).toBe(true);
    expect(lines.every((line) => encoder.encode(line).byteLength <= 75)).toBe(true);
  });

  it("normalizes fractional DTSTAMP values and CRLF text", () => {
    const output = serializeIcs(
      [{ ...event, description: "第一行\r\n第二行" }],
      "2026-09-09T01:30:00.123Z",
      "CourseFlow",
    );

    expect(output).toContain("DTSTAMP:20260909T013000Z");
    expect(output).not.toContain(".123Z");
    expect(output).toContain("DESCRIPTION:第一行\\n第二行");
  });
});
