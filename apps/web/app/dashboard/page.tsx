import Link from "next/link";
import { getScopedCourseFlow } from "@/composition/runtime";
import { PageHeading } from "@/features/shared/page-heading";
import { Icon } from "@/features/shell/icon";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { academics, planning, scope } = await getScopedCourseFlow();
  const [terms, courses] = await Promise.all([
    academics.listTerms(scope),
    academics.listCourses(scope),
  ]);
  const active =
    terms.find((term) => term.isActive && term.archivedAt === null) ??
    terms.find((term) => term.archivedAt === null) ??
    null;
  const activeCourses =
    active === null
      ? []
      : courses.filter(
          (course) => course.course.termId === active.id && course.course.archivedAt === null,
        );
  const plans = await Promise.all(
    activeCourses.map((course) => planning.getCoursePlanning(scope, course.course.id)),
  );
  const itemCount = plans.reduce((sum, plan) => sum + (plan?.items.length ?? 0), 0);
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
            : `${active.name} · ${active.startDate}–${active.endDate}`
        }
        title="总览"
      />
      {active === null ? (
        <section className="panel empty-state">
          <h2>从一个真实学期开始</h2>
          <p>创建学期并填写 Reading Week，随后即可添加课程、课节、事项与成绩。</p>
          <Link className="button button-primary" href="/terms">
            创建第一个学期
          </Link>
        </section>
      ) : (
        <div className="dashboard-grid">
          <section className="panel dashboard-card">
            <h2>本学期课程</h2>
            <strong className="metric">{activeCourses.length}</strong>
            <p>进行中的正式课程；课程数据来自当前登录用户的 PostgreSQL scope。</p>
            <Link className="button button-secondary" href="/courses">
              查看课程
            </Link>
          </section>
          <section className="panel dashboard-card">
            <h2>周期课节规则</h2>
            <strong className="metric">
              {activeCourses.reduce(
                (sum, course) =>
                  sum +
                  course.meetingPatterns.filter((meeting) => meeting.archivedAt === null).length,
                0,
              )}
            </strong>
            <p>Lecture、Tutorial 与 Practical 以周期规则保存；Reading Week 不删除规则。</p>
            <Link className="button button-secondary" href="/courses">
              核对安排
            </Link>
          </section>
          <section className="panel dashboard-card">
            <h2>课程事项</h2>
            <strong className="metric">{itemCount}</strong>
            <p>这里仅摘要真实事项；短中长期派生分组将在 P2 由统一 TaskBoardSnapshot 接入。</p>
            <Link className="button button-secondary" href="/tasks">
              管理事项
            </Link>
          </section>
        </div>
      )}
    </section>
  );
}
