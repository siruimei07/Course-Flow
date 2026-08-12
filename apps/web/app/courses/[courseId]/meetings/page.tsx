import { notFound } from "next/navigation";
import { asCourseId } from "@courseflow/core";
import { getScopedCourseFlow } from "@/composition/runtime";
import { CourseSubnav } from "@/features/courses/course-subnav";
import { MeetingExceptionForm } from "@/features/courses/meeting-exception-form";
import { meetingKindLabels } from "@/features/shared/format";
import { PageHeading } from "@/features/shared/page-heading";

export const dynamic = "force-dynamic";

export default async function MeetingsPage({
  params,
}: Readonly<{ params: Promise<{ courseId: string }> }>) {
  const { courseId } = await params;
  const { academics, scope } = await getScopedCourseFlow();
  const course = await academics.getCourse(scope, asCourseId(courseId));
  if (course === null) notFound();
  return (
    <section className="page">
      <PageHeading context={`${course.course.code} · Reading Week 与单次覆盖`} title="课节例外" />
      <CourseSubnav courseId={courseId} current="overview" />
      <div className="form-stack">
        {course.meetingPatterns.map((pattern) => (
          <section className="panel" key={pattern.id}>
            <div className="panel-header">
              <div>
                <h2>{meetingKindLabels[pattern.kind]}</h2>
                <p className="panel-subtitle">
                  {pattern.weekdays
                    .map(
                      (weekday) =>
                        ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][weekday],
                    )
                    .join("、")}{" "}
                  {pattern.localStartTime}–{pattern.localEndTime} · {pattern.locationText || "TBA"}
                </p>
              </div>
              <span className="status-label">v{pattern.version}</span>
            </div>
            <div className="panel-body">
              <MeetingExceptionForm patternId={pattern.id} timeZone={course.course.timeZone} />
              {course.meetingExceptions
                ?.filter((exception) => exception.meetingPatternId === pattern.id)
                .map((exception) => (
                  <div className="status-banner" key={exception.id}>
                    {exception.occurrenceDate} · {exception.action} · v{exception.version}
                  </div>
                ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
