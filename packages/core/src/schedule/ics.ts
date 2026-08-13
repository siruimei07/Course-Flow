import type { CalendarEvent } from "./types";

function escapeText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(/\r\n|\r|\n/gu, "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
}

function utcValue(value: string): string {
  return new Date(value)
    .toISOString()
    .replace(/\.\d{3}Z$/u, "Z")
    .replaceAll("-", "")
    .replaceAll(":", "");
}

function dateValue(value: string): string {
  return value.replaceAll("-", "");
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** RFC 5545 line folding without splitting a multi-byte UTF-8 code point. */
export function foldIcsLine(line: string): readonly string[] {
  const folded: string[] = [];
  let current = "";
  for (const character of line) {
    if (current !== "" && utf8Length(`${current}${character}`) > 75) {
      folded.push(current);
      current = ` ${character}`;
    } else {
      current += character;
    }
  }
  folded.push(current);
  return folded;
}

function eventLines(event: CalendarEvent, generatedAt: string): readonly string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${escapeText(event.uid)}`,
    `DTSTAMP:${utcValue(generatedAt)}`,
  ];
  if (event.lastModified !== null) lines.push(`LAST-MODIFIED:${utcValue(event.lastModified)}`);
  lines.push(`SEQUENCE:${event.sequence}`, `SUMMARY:${escapeText(event.summary)}`);
  if (event.description !== null) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.location !== null) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.time.kind === "all_day") {
    lines.push(
      `DTSTART;VALUE=DATE:${dateValue(event.time.date)}`,
      `DTEND;VALUE=DATE:${dateValue(event.time.endDate)}`,
    );
  } else if (event.time.kind === "instant") {
    lines.push(`DTSTART:${utcValue(event.time.startsAt)}`);
  } else {
    lines.push(`DTSTART:${utcValue(event.time.startsAt)}`, `DTEND:${utcValue(event.time.endsAt)}`);
  }
  lines.push("END:VEVENT");
  return lines;
}

export function serializeIcs(
  events: readonly CalendarEvent[],
  generatedAt: string,
  calendarName: string,
): string {
  const logicalLines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CourseFlow//Schedule Snapshot//ZH-CN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    ...events.flatMap((event) => eventLines(event, generatedAt)),
    "END:VCALENDAR",
  ];
  return `${logicalLines.flatMap(foldIcsLine).join("\r\n")}\r\n`;
}
