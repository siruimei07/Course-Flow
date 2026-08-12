import Link from "next/link";
import { asCourseId } from "@courseflow/core";
import { getScopedCourseFlow } from "@/composition/runtime";
import { CourseSubnav } from "@/features/courses/course-subnav";
import { courseColor, meetingKindLabels } from "@/features/shared/format";
import { PageHeading } from "@/features/shared/page-heading";
import { Icon } from "@/features/shell/icon";

export const dynamic = "force-dynamic";

export default async function CoursesPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ courseId?: string }> }>) {
  const { academics, planning, scope } = await getScopedCourseFlow();
  const [terms, courses, params] = await Promise.all([
    academics.listTerms(scope),
    academics.listCourses(scope),
    searchParams,
  ]);
  const visible = courses.filter((setup) => setup.course.archivedAt === null);
  const requested =
    params.courseId === undefined
      ? null
      : await academics.getCourse(scope, asCourseId(params.courseId));
  const selected = requested ?? visible[0] ?? null;
  const planningDetail =
    selected === null ? null : await planning.getCoursePlanning(scope, selected.course.id);
  const gradebook =
    selected === null ? null : await planning.getGradebook(scope, selected.course.id);
  return (
    <section className="page">
      <PageHeading
        actions={
          <Link className="button button-primary" href="/courses/new">
            <Icon name="plus" />
            添加课程
          </Link>
        }
        context={`${terms.find((term) => term.isActive)?.name ?? "全部学期"} · ${visible.length} 门进行中`}
        title="课程"
      />
      {visible.length === 0 ? (
        <section className="panel empty-state">
          <h2>还没有课程</h2>
          <p>添加课程时可一次保存多个 Lecture、Tutorial 与 Practical 周期课节。</p>
          <Link className="button button-primary" href="/courses/new">
            添加第一门课程
          </Link>
        </section>
      ) : (
        <>
          <CourseSubnav courseId={selected!.course.id} current="overview" />
          <div className="course-layout">
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>本学期课程</h2>
                  <p className="panel-subtitle">当前选择进入 URL，可刷新和分享</p>
                </div>
              </div>
              <div aria-label="课程列表" className="course-list" role="listbox">
                {visible.map((setup) => (
                  <Link
                    aria-selected={setup.course.id === selected!.course.id}
                    className="course-card"
                    href={`/courses?courseId=${setup.course.id}`}
                    key={setup.course.id}
                    role="option"
                    style={
                      { "--course": courseColor(setup.course.colorKey) } as React.CSSProperties
                    }
                  >
                    <span className="course-rail" />
                    <span>
                      <span className="course-code-big">{setup.course.code}</span>
                      <h3>{setup.course.title}</h3>
                      <p className="course-card-meta">
                        {setup.meetingPatterns.length} 条课节 · {setup.course.timeZone}
                      </p>
                    </span>
                    <span className="course-card-next">
                      <span className="next-item-label">课程安排</span>
                      <span className="next-item-title">
                        {setup.meetingPatterns.length
                          ? setup.meetingPatterns
                              .map((meeting) => meetingKindLabels[meeting.kind])
                              .join(" · ")
                          : "尚无周期课节"}
                      </span>
                      <span className="next-item-meta">Reading Week 保留规则</span>
                    </span>
                    <span className="status-label">v{setup.course.version}</span>
                  </Link>
                ))}
              </div>
            </section>
            <aside className="panel course-detail">
              <div className="course-detail-top">
                <span className="course-code-big">{selected!.course.code}</span>
                <h2>{selected!.course.title}</h2>
                <p>
                  {selected!.course.section || "未填写 section"} ·{" "}
                  {selected!.course.instructorName || "未填写教师"}
                </p>
                <div className="detail-stat-grid">
                  <div className="detail-stat">
                    <strong>{selected!.meetingPatterns.length}</strong>
                    <span>周期课节</span>
                  </div>
                  <div className="detail-stat">
                    <strong>{planningDetail?.items.length ?? 0}</strong>
                    <span>课程事项</span>
                  </div>
                  <div className="detail-stat">
                    <strong>{gradebook?.scheme?.version ?? "—"}</strong>
                    <span>评分版本</span>
                  </div>
                </div>
              </div>
              <div className="detail-list">
                {selected!.meetingPatterns.map((meeting) => (
                  <div className="detail-list-row" key={meeting.id}>
                    <span>
                      <strong>{meetingKindLabels[meeting.kind]}</strong>
                      <p>
                        {meeting.weekdays
                          .map(
                            (weekday) =>
                              ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][weekday],
                          )
                          .join("、")}{" "}
                        {meeting.localStartTime}–{meeting.localEndTime} ·{" "}
                        {meeting.locationText || "TBA"}
                      </p>
                    </span>
                    <span className="status-label">v{meeting.version}</span>
                  </div>
                ))}
                <Link className="detail-list-row" href={`/courses/${selected!.course.id}/meetings`}>
                  <span>
                    <strong>课节单次例外</strong>
                    <p>取消、改期或在 Reading Week 显式保留</p>
                  </span>
                  <Icon name="arrow" />
                </Link>
                <Link className="detail-list-row" href={`/courses/${selected!.course.id}/timeline`}>
                  <span>
                    <strong>课程 Timeline</strong>
                    <p>查看真实课程事项及四种时间语义</p>
                  </span>
                  <Icon name="arrow" />
                </Link>
                <Link className="detail-list-row" href={`/courses/${selected!.course.id}/grading`}>
                  <span>
                    <strong>Gradebook</strong>
                    <p>评分组成、手工结果与覆盖权重</p>
                  </span>
                  <Icon name="arrow" />
                </Link>
              </div>
            </aside>
          </div>
        </>
      )}
    </section>
  );
}
