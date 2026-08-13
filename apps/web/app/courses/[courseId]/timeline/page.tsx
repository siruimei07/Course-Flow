import { notFound } from "next/navigation";
import { asCourseId } from "@courseflow/core";
import { getScopedCourseFlow } from "@/composition/runtime";
import { CourseSubnav } from "@/features/courses/course-subnav";
import { courseItemKindLabels } from "@/features/shared/format";
import { PageHeading } from "@/features/shared/page-heading";

export const dynamic = "force-dynamic";

export default async function TimelinePage({
  params,
}: Readonly<{ params: Promise<{ courseId: string }> }>) {
  const { courseId } = await params;
  const { academics, schedule, scope } = await getScopedCourseFlow();
  const course = await academics.getCourse(scope, asCourseId(courseId));
  if (course === null || course.course.archivedAt !== null) notFound();
  const timeline = await schedule.getCourseTimeline(scope, {
    courseId: course.course.id,
    termId: course.course.termId,
  });
  if (timeline === null) notFound();

  return (
    <section className="page">
      <PageHeading context={course.course.code + " · " + timeline.timeZone} title="课程 Timeline" />
      <CourseSubnav courseId={courseId} current="timeline" />
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>{course.course.title}</h2>
            <p className="panel-subtitle">有日期区与 TBA 区都来自当前正式 ScheduleSnapshot</p>
          </div>
        </div>
        {timeline.items.length === 0 ? (
          <div className="empty-state">
            <h3>还没有课程事项</h3>
            <p>从任务页添加事项后，这里会从同一正式记录重新投影。</p>
          </div>
        ) : (
          <div className="timeline">
            {timeline.items.map((item) => (
              <article className="timeline-item" key={item.id}>
                <div className="timeline-time">{item.temporalLabel}</div>
                <div>
                  <span className="course-code-big">
                    {courseItemKindLabels[item.kind]} · {item.workloadMinutes} 分钟
                  </span>
                  <h3>{item.title}</h3>
                  <p>{item.details || "未填写说明"}</p>
                  <div className="task-badges">
                    {item.labels.map((label) => (
                      <span className="meta-label" key={label.id}>
                        {label.displayName}
                      </span>
                    ))}
                    {item.systemLabels.map((label) => (
                      <span className="meta-label" key={label}>
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <p className="snapshot-note page-snapshot">
        Snapshot {timeline.snapshotId} · {timeline.policyVersions.taskGrouping}
      </p>
    </section>
  );
}
