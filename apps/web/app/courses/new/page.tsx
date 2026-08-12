import { getScopedCourseFlow } from "@/composition/runtime";
import { CourseWizard } from "@/features/courses/course-wizard";
import { PageHeading } from "@/features/shared/page-heading";

export const dynamic = "force-dynamic";

export default async function NewCoursePage() {
  const { academics, scope } = await getScopedCourseFlow();
  const terms = await academics.listTerms(scope);
  const availableTerms = terms.filter((term) => term.archivedAt === null);
  const details = await Promise.all(
    availableTerms.map((term) => academics.getTerm(scope, term.id)),
  );
  return (
    <section className="page">
      <PageHeading context="学期 → 课程 → 多条课节 → Reading Week 核对" title="添加课程" />
      <CourseWizard
        terms={availableTerms.map((term, index) => ({
          endDate: term.endDate,
          id: term.id,
          name: term.name,
          readingWeeks:
            details[index]?.calendarExceptions
              .filter((exception) => exception.kind === "reading_week")
              .map((exception) => ({
                endDate: exception.endDate,
                name: exception.name,
                startDate: exception.startDate,
              })) ?? [],
          startDate: term.startDate,
          timeZone: term.timeZone,
        }))}
      />
    </section>
  );
}
