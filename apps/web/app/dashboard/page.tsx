import Link from "next/link";
import { getScopedCourseFlow } from "@/composition/runtime";
import { NextMeetingCountdown } from "@/features/schedule/next-meeting-countdown";
import { WorkloadHeatmap } from "@/features/schedule/workload-heatmap";
import { PageHeading } from "@/features/shared/page-heading";
import { Icon } from "@/features/shell/icon";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { academics, schedule, scope } = await getScopedCourseFlow();
  const terms = await academics.listTerms(scope);
  const active =
    terms.find((term) => term.isActive && term.archivedAt === null) ??
    terms.find((term) => term.archivedAt === null) ??
    null;
  const dashboard =
    active === null ? null : await schedule.getDashboard(scope, { termId: active.id });

  return (
    <section className="page">
      <PageHeading
        actions={
          <Link
            className="button button-primary"
            href={active === null ? "/terms" : "/courses/new"}
          >
            <Icon name="plus" />
            {active === null ? "创建学期" : "添加课程"}
          </Link>
        }
        context={
          active === null
            ? "还没有当前学期"
            : active.name + " · " + active.startDate + "—" + active.endDate
        }
        title="总览"
      />
      {active === null || dashboard === null ? (
        <section className="panel empty-state">
          <h2>从一个真实学期开始</h2>
          <p>创建学期并填写 Reading Week，随后即可添加课程、课节、事项与成绩。</p>
          <Link className="button button-primary" href="/terms">
            创建第一个学期
          </Link>
        </section>
      ) : (
        <div className="dashboard-layout">
          <section className="panel hero-progress">
            <div>
              <span className="eyebrow">学期进度</span>
              <strong>{(dashboard.termProgress.progressBps / 100).toFixed(0)}%</strong>
              <p>
                {dashboard.termProgress.status === "not_started"
                  ? "学期尚未开始"
                  : dashboard.termProgress.status === "ended"
                    ? "学期已经结束"
                    : dashboard.termProgress.isPaused
                      ? dashboard.termProgress.currentException?.name + " · 进度暂停"
                      : "教学周 " + dashboard.termProgress.teachingWeekNumber}
              </p>
            </div>
            <div
              className="progress-track"
              aria-label={"学期进度 " + dashboard.termProgress.progressBps / 100 + "%"}
            >
              <span style={{ width: dashboard.termProgress.progressBps / 100 + "%" }} />
            </div>
            <span className="snapshot-note">
              {dashboard.timeZone} · {dashboard.policyVersions.termProgress}
            </span>
          </section>

          <section className="panel next-meeting-card">
            <div className="panel-header">
              <div>
                <span className="eyebrow">下一节课程</span>
                <h2>今天与近期</h2>
              </div>
              <Link className="button button-secondary" href="/calendar">
                打开日历
              </Link>
            </div>
            {dashboard.nextMeeting === null ? (
              <div className="empty-state compact">
                <h3>当前范围没有后续课节</h3>
                <p>周期课节、取消、改期和 Reading Week 已按同一规则展开。</p>
              </div>
            ) : (
              <article className="next-meeting">
                <span
                  aria-hidden="true"
                  className="course-dot"
                  data-color={dashboard.nextMeeting.course.colorKey}
                />
                <div>
                  <span className="course-code-big">{dashboard.nextMeeting.course.code}</span>
                  <h3>{dashboard.nextMeeting.title}</h3>
                  <p>
                    {dashboard.nextMeeting.startTimeLabel}—{dashboard.nextMeeting.endTimeLabel} ·{" "}
                    {dashboard.nextMeeting.locationText ?? "地点待定"}
                  </p>
                </div>
                <strong className="countdown">
                  <NextMeetingCountdown
                    endsAt={dashboard.nextMeeting.endsAt}
                    generatedAt={dashboard.generatedAt}
                    startsAt={dashboard.nextMeeting.startsAt}
                  />
                </strong>
              </article>
            )}
            <div className="today-strip" aria-label="今天的课节">
              {dashboard.todayMeetings.length === 0 ? (
                <p>今天没有课程。</p>
              ) : (
                dashboard.todayMeetings.map((meeting) => (
                  <span key={meeting.id}>
                    <strong>{meeting.startTimeLabel}</strong> {meeting.course.code} ·{" "}
                    {meeting.title}
                  </span>
                ))
              )}
            </div>
          </section>

          <section className="panel dashboard-span">
            <div className="panel-header">
              <div>
                <span className="eyebrow">本学期工作量</span>
                <h2>每周热力图</h2>
              </div>
              <Link className="button button-secondary" href="/tasks">
                查看任务
              </Link>
            </div>
            <div className="panel-body">
              <WorkloadHeatmap heatmap={dashboard.heatmap} />
            </div>
          </section>

          <section className="panel dashboard-list-card">
            <div className="panel-header">
              <div>
                <span className="eyebrow">先完成</span>
                <h2>今天与明天</h2>
              </div>
              <span className="metric-small">{dashboard.priorityTasks.length}</span>
            </div>
            <div className="compact-list">
              {dashboard.priorityTasks.length === 0 ? (
                <p>没有临近事项。</p>
              ) : (
                dashboard.priorityTasks.slice(0, 4).map((item) => (
                  <Link href="/tasks?group=priority" key={item.id}>
                    <span>{item.course.code}</span>
                    <strong>{item.title}</strong>
                    <small>{item.displayDateLabel}</small>
                  </Link>
                ))
              )}
            </div>
          </section>

          <section className="panel dashboard-list-card">
            <div className="panel-header">
              <div>
                <span className="eyebrow">核对提醒</span>
                <h2>冲突与集中截止</h2>
              </div>
              <span className="metric-small">{dashboard.conflicts.length}</span>
            </div>
            <div className="compact-list">
              {dashboard.conflicts.length === 0 ? (
                <p>没有发现需要核对的冲突。</p>
              ) : (
                dashboard.conflicts.slice(0, 4).map((conflict) => (
                  <article data-tone={conflict.severity} key={conflict.id}>
                    <span>{conflict.kind === "hard_overlap" ? "硬冲突" : "提醒"}</span>
                    <strong>{conflict.title}</strong>
                    <small>{conflict.description}</small>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
