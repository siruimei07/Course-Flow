import Link from "next/link";
import { asCourseId } from "@courseflow/core";
import { getScopedCourseFlow } from "@/composition/runtime";
import { CalendarEventCard } from "@/features/schedule/calendar-event-card";
import { PageHeading } from "@/features/shared/page-heading";

export const dynamic = "force-dynamic";

function addDays(date: string, amount: number): string {
  const value = new Date(date + "T00:00:00Z");
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function isoWeekday(date: string): number {
  return (new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7;
}

function weekStart(date: string, startsOn: number): string {
  return addDays(date, -((isoWeekday(date) - startsOn + 7) % 7));
}

function isLocalDate(value: string | undefined): value is string {
  if (value === undefined || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  return !Number.isNaN(Date.parse(value + "T00:00:00Z"));
}

function dateInZone(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date(instant));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return values.get("year") + "-" + values.get("month") + "-" + values.get("day");
}

function calendarHref(
  parameters: Readonly<{
    courseId?: string;
    from?: string;
    items?: string;
    meetings?: string;
    view?: string;
  }>,
  change: Readonly<{
    courseId?: string | null;
    from?: string;
    items?: string;
    meetings?: string;
    view?: string;
  }>,
): string {
  const merged = { ...parameters, ...change };
  const query = new URLSearchParams();
  for (const key of ["courseId", "from", "items", "meetings", "view"] as const) {
    const value = merged[key];
    if (value) query.set(key, value);
  }
  return "/calendar?" + query.toString();
}

export default async function CalendarPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{
    courseId?: string;
    from?: string;
    items?: string;
    meetings?: string;
    view?: string;
  }>;
}>) {
  const { academics, schedule, scope } = await getScopedCourseFlow();
  const [terms, parameters] = await Promise.all([academics.listTerms(scope), searchParams]);
  const active =
    terms.find((term) => term.isActive && term.archivedAt === null) ??
    terms.find((term) => term.archivedAt === null) ??
    null;
  const calendar =
    active === null
      ? null
      : await schedule.getCalendar(scope, {
          ...(parameters.courseId === undefined
            ? {}
            : { courseIds: [asCourseId(parameters.courseId)] }),
          includeItems: parameters.items !== "0",
          includeMeetings: parameters.meetings !== "0",
          termId: active.id,
        });

  if (active === null || calendar === null) {
    return (
      <section className="page">
        <PageHeading context="还没有当前学期" title="日历" />
        <section className="panel empty-state">
          <h2>先创建当前学期</h2>
          <p>日历只展示由正式课程记录派生的课节与已确认时间事项。</p>
          <Link className="button button-primary" href="/terms">
            前往学期
          </Link>
        </section>
      </section>
    );
  }

  const today = dateInZone(calendar.generatedAt, calendar.timeZone);
  const defaultFocus =
    today < calendar.term.startDate
      ? calendar.term.startDate
      : today > calendar.term.endDate
        ? calendar.term.endDate
        : today;
  const selectedStart = weekStart(
    isLocalDate(parameters.from) ? parameters.from : defaultFocus,
    calendar.weekStartsOn,
  );
  const days = Array.from({ length: 7 }, (_, index) => addDays(selectedStart, index));
  const selectedEnd = days[6]!;
  const events = calendar.events.filter(
    (event) => event.displayDate >= selectedStart && event.displayDate <= selectedEnd,
  );
  const byDate = new Map(
    days.map((date) => [date, events.filter((event) => event.displayDate === date)]),
  );
  const view = parameters.view === "agenda" ? "agenda" : "week";
  const exportParameters = new URLSearchParams({ termId: active.id });
  if (parameters.courseId) exportParameters.append("courseId", parameters.courseId);
  exportParameters.set("includeItems", String(parameters.items !== "0"));
  exportParameters.set("includeMeetings", String(parameters.meetings !== "0"));

  return (
    <section className="page">
      <PageHeading
        actions={
          <a
            className="button button-primary"
            href={"/api/v1/calendar/export.ics?" + exportParameters.toString()}
          >
            导出 ICS
          </a>
        }
        context={
          active.name + " · " + calendar.timeZone + " · " + selectedStart + "—" + selectedEnd
        }
        title="日历"
      />
      <section className="panel calendar-toolbar" aria-label="日历筛选">
        <div className="button-row">
          <Link
            className="button button-secondary"
            href={calendarHref(parameters, { from: addDays(selectedStart, -7) })}
          >
            上一周
          </Link>
          <Link
            className="button button-secondary"
            href={calendarHref(parameters, {
              from: weekStart(defaultFocus, calendar.weekStartsOn),
            })}
          >
            当前周
          </Link>
          <Link
            className="button button-secondary"
            href={calendarHref(parameters, { from: addDays(selectedStart, 7) })}
          >
            下一周
          </Link>
        </div>
        <nav aria-label="日历视图" className="filter-chips">
          <Link
            aria-current={view === "week" ? "page" : undefined}
            href={calendarHref(parameters, { view: "week" })}
          >
            周视图
          </Link>
          <Link
            aria-current={view === "agenda" ? "page" : undefined}
            href={calendarHref(parameters, { view: "agenda" })}
          >
            议程
          </Link>
        </nav>
        <nav aria-label="事件类型" className="filter-chips">
          <Link
            aria-current={parameters.meetings !== "0" ? "page" : undefined}
            href={calendarHref(parameters, { meetings: parameters.meetings === "0" ? "1" : "0" })}
          >
            课节
          </Link>
          <Link
            aria-current={parameters.items !== "0" ? "page" : undefined}
            href={calendarHref(parameters, { items: parameters.items === "0" ? "1" : "0" })}
          >
            课程事项
          </Link>
        </nav>
        <nav aria-label="课程筛选" className="filter-chips">
          <Link
            aria-current={parameters.courseId === undefined ? "page" : undefined}
            href={calendarHref(parameters, { courseId: null })}
          >
            全部课程
          </Link>
          {calendar.courses.map((course) => (
            <Link
              aria-current={parameters.courseId === course.id ? "page" : undefined}
              href={calendarHref(parameters, { courseId: course.id })}
              key={course.id}
            >
              {course.code}
            </Link>
          ))}
        </nav>
      </section>

      {view === "week" ? (
        <section className="panel calendar-scroll" aria-label="周日历">
          <div className="calendar-week">
            {days.map((date) => (
              <section className="calendar-day" data-today={date === today || undefined} key={date}>
                <header>
                  <span>
                    {new Intl.DateTimeFormat("zh-CN", {
                      timeZone: "UTC",
                      weekday: "short",
                    }).format(new Date(date + "T12:00:00Z"))}
                  </span>
                  <strong>{date.slice(5).replace("-", "/")}</strong>
                </header>
                <div className="calendar-day-events">
                  {byDate.get(date)?.length === 0 ? (
                    <span className="calendar-empty">无安排</span>
                  ) : (
                    byDate
                      .get(date)
                      ?.map((event) => (
                        <CalendarEventCard
                          event={event}
                          key={event.id}
                          timeZone={calendar.timeZone}
                        />
                      ))
                  )}
                </div>
              </section>
            ))}
          </div>
        </section>
      ) : (
        <section className="panel calendar-agenda" aria-label="议程列表">
          {events.length === 0 ? (
            <div className="empty-state compact">
              <p>这一周没有符合筛选条件的安排。</p>
            </div>
          ) : (
            days.map((date) =>
              byDate.get(date)?.length === 0 ? null : (
                <section className="agenda-day" key={date}>
                  <h2>{date}</h2>
                  <div>
                    {byDate.get(date)?.map((event) => (
                      <CalendarEventCard
                        event={event}
                        key={event.id}
                        timeZone={calendar.timeZone}
                      />
                    ))}
                  </div>
                </section>
              ),
            )
          )}
        </section>
      )}
      <div className="calendar-footer-note">
        <p>
          ICS 已跳过 {calendar.skipped.total} 项时间待定事项；纯日期保持全天，deadline
          保持确定时刻。
        </p>
        <p className="snapshot-note">
          Snapshot {calendar.snapshotId} · {calendar.policyVersions.conflicts}
        </p>
      </div>
    </section>
  );
}
