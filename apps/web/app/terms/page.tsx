import { getScopedCourseFlow } from "@/composition/runtime";
import { PageHeading } from "@/features/shared/page-heading";
import { TermActions } from "@/features/terms/term-actions";
import { TermForm } from "@/features/terms/term-form";

export const dynamic = "force-dynamic";

export default async function TermsPage() {
  const { academics, scope } = await getScopedCourseFlow();
  const terms = await academics.listTerms(scope);
  const details = await Promise.all(terms.map((term) => academics.getTerm(scope, term.id)));
  return (
    <section className="page">
      <PageHeading
        context={`${terms.filter((term) => term.archivedAt === null).length} 个进行中 · ${terms.filter((term) => term.archivedAt !== null).length} 个已归档`}
        title="学期设置"
      />
      <div className="course-layout">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>已有学期</h2>
              <p className="panel-subtitle">起止日期、时区与校历例外共同定义课节语义</p>
            </div>
          </div>
          {terms.length === 0 ? (
            <div className="empty-state">
              <h3>还没有学期</h3>
              <p>使用右侧表单创建学期；首个学期会自动成为当前学期。</p>
            </div>
          ) : (
            <div className="term-grid panel-body">
              {terms.map((term, index) => {
                const detail = details[index];
                return (
                  <article
                    className="panel term-card"
                    data-archived={term.archivedAt === null ? undefined : "true"}
                    key={term.id}
                  >
                    <header>
                      <div>
                        <span className="course-code-big">{term.timeZone}</span>
                        <h3>{term.name}</h3>
                      </div>
                      <span className="status-label">
                        {term.archivedAt !== null ? "已归档" : term.isActive ? "当前" : "可切换"}
                      </span>
                    </header>
                    <dl>
                      <dt>日期</dt>
                      <dd>
                        {term.startDate}–{term.endDate}
                      </dd>
                      <dt>课程</dt>
                      <dd>{term.courseCount} 门</dd>
                      <dt>Reading Week</dt>
                      <dd>
                        {detail?.calendarExceptions
                          .filter((item) => item.kind === "reading_week")
                          .map((item) => `${item.startDate}–${item.endDate}`)
                          .join("；") || "未设置"}
                      </dd>
                      <dt>版本</dt>
                      <dd>v{term.version}</dd>
                    </dl>
                    <TermActions term={term} />
                  </article>
                );
              })}
            </div>
          )}
        </section>
        <aside className="panel task-form-panel">
          <div className="panel-header">
            <div>
              <h2>创建学期</h2>
              <p className="panel-subtitle">Reading Week 作为校历例外保存</p>
            </div>
          </div>
          <div className="panel-body">
            <TermForm />
          </div>
        </aside>
      </div>
    </section>
  );
}
