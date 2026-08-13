import type { CalendarEvent } from "@courseflow/core";
import { courseColor } from "@/features/shared/format";

function timeLabel(event: CalendarEvent, timeZone: string): string {
  if (event.time.kind === "all_day") return "全天";
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone,
  });
  if (event.time.kind === "instant")
    return "截止 " + formatter.format(new Date(event.time.startsAt));
  return (
    formatter.format(new Date(event.time.startsAt)) +
    "—" +
    formatter.format(new Date(event.time.endsAt))
  );
}

export function CalendarEventCard({
  event,
  timeZone,
}: Readonly<{ event: CalendarEvent; timeZone: string }>) {
  return (
    <article
      className="calendar-event"
      style={{ "--course": courseColor(event.course.colorKey) } as React.CSSProperties}
    >
      <span className="calendar-event-time">{timeLabel(event, timeZone)}</span>
      <strong>{event.summary}</strong>
      <small>
        {event.sourceType === "meeting_occurrence" ? "课节" : "课程事项"}
        {event.location === null ? "" : " · " + event.location}
      </small>
    </article>
  );
}
