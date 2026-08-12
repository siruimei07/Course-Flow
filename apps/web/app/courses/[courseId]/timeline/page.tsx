import { notFound } from "next/navigation";
import { asCourseId } from "@courseflow/core";
import { getScopedCourseFlow } from "@/composition/runtime";
import { CourseSubnav } from "@/features/courses/course-subnav";
import { courseItemKindLabels, formatTemporal } from "@/features/shared/format";
import { PageHeading } from "@/features/shared/page-heading";

export const dynamic = "force-dynamic";

export default async function TimelinePage({
  params,
}: Readonly<{ params: Promise<{ courseId: string }> }>) {
  const { courseId } = await params;
  const { academics, planning, scope } = await getScopedCourseFlow();
  const [course, detail] = await Promise.all([
    academics.getCourse(scope, asCourseId(courseId)),
    planning.getCoursePlanning(scope, asCourseId(courseId)),
  ]);
  if (course === null || detail === null) notFound();
  return (
    <section className="page">
      <PageHeading
        context={`${course.course.code} · ${course.course.timeZone}`}
        title="课程 Timeline"
      />
      <CourseSubnav courseId={courseId} current="timeline" />
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>{course.course.title}</h2>
            <p className="panel-subtitle">有日期区与 TBA 均来自同一 Course Item 集合</p>
          </div>
        </div>
        {detail.items.length === 0 ? (
          <div className="empty-state">
            <h3>还没有课程事项</h3>
            <p>从任务页添加事项后，这里会读取同一正式记录。</p>
          </div>
        ) : (
          <div className="timeline">
            {[...detail.items]
              .sort((left, right) =>
                formatTemporal(left.temporal).localeCompare(formatTemporal(right.temporal)),
              )
              .map((item) => (
                <article className="timeline-item" key={item.id}>
                  <div className="timeline-time">{formatTemporal(item.temporal)}</div>
                  <div>
                    <span className="course-code-big">
                      {courseItemKindLabels[item.kind]} · v{item.version}
                    </span>
                    <h3>{item.title}</h3>
                    <p>{item.details || "未填写说明"}</p>
                    <div className="task-badges">
                      {item.labels.map((label) => (
                        <span className="meta-label" key={label.id}>
                          {label.displayName}
                        </span>
                      ))}
                    </div>
                  </div>
                </article>
              ))}
          </div>
        )}
      </section>
    </section>
  );
}
