import Link from "next/link";
import { getScopedCourseFlow } from "@/composition/runtime";
import { courseColor, courseItemKindLabels, formatTemporal } from "@/features/shared/format";
import { PageHeading } from "@/features/shared/page-heading";
import { TaskEditor } from "@/features/tasks/task-editor";
import { TaskActions } from "@/features/tasks/task-actions";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const { academics, planning, scope } = await getScopedCourseFlow();
  const courses = (await academics.listCourses(scope)).filter(
    (setup) => setup.course.archivedAt === null,
  );
  const plans = await Promise.all(
    courses.map((setup) => planning.getCoursePlanning(scope, setup.course.id)),
  );
  const items = courses.flatMap((setup, index) =>
    (plans[index]?.items ?? []).map((item) => ({ course: setup.course, item })),
  );
  const labels = Array.from(
    new Map(plans.flatMap((plan) => plan?.labels ?? []).map((label) => [label.id, label])).values(),
  );
  return (
    <section className="page">
      <PageHeading
        context={`${items.length} 个正式课程事项 · 基础列表（P2 再接派生分组）`}
        title="任务"
      />
      {courses.length === 0 ? (
        <section className="panel empty-state">
          <h2>先添加课程</h2>
          <p>课程事项必须属于真实课程；这里不会创建第二套任务真相。</p>
          <Link className="button button-primary" href="/courses/new">
            添加课程
          </Link>
        </section>
      ) : (
        <div className="task-layout">
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>全部事项</h2>
                <p className="panel-subtitle">四种时间语义与标签直接来自 Planning query</p>
              </div>
            </div>
            {items.length === 0 ? (
              <div className="empty-state">
                <h3>还没有事项</h3>
                <p>用右侧表单添加第一项；未排期、纯日期、截止与区间都保持原语义。</p>
              </div>
            ) : (
              <div className="task-list">
                {items.map(({ course, item }) => (
                  <article className="task-row" key={item.id}>
                    <span
                      className="task-kind-rail"
                      style={{ background: courseColor(course.colorKey) }}
                    />
                    <div>
                      <span className="course-code-big">
                        {course.code} · {courseItemKindLabels[item.kind]}
                      </span>
                      <h3>{item.title}</h3>
                      <div className="task-badges">
                        {item.labels.map((label) => (
                          <span className="meta-label" key={label.id}>
                            {label.displayName}
                          </span>
                        ))}
                        <span className="meta-label">{item.state}</span>
                        {item.progressBps === null ? null : (
                          <span className="meta-label">准备进度 {item.progressBps / 100}%</span>
                        )}
                      </div>
                      <TaskActions
                        itemId={item.id}
                        state={item.state}
                        title={item.title}
                        version={item.version}
                      />
                    </div>
                    <div className="task-meta">
                      <strong>{formatTemporal(item.temporal)}</strong>
                      {item.estimatedMinutes === null
                        ? "未填写预计投入"
                        : `预计 ${item.estimatedMinutes} 分钟`}{" "}
                      · v{item.version}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
          <aside className="panel task-form-panel">
            <div className="panel-header">
              <div>
                <h2>添加事项 / 标签</h2>
                <p className="panel-subtitle">同一 command 服务任务页和课程 Timeline</p>
              </div>
            </div>
            <div className="panel-body">
              <TaskEditor
                courses={courses.map((setup) => ({
                  id: setup.course.id,
                  label: `${setup.course.code} · ${setup.course.title}`,
                  termId: setup.course.termId,
                  timeZone: setup.course.timeZone,
                }))}
                labels={labels.map((label) => ({
                  colorKey: label.colorKey,
                  displayName: label.displayName,
                  id: label.id,
                  termId: label.termId,
                }))}
              />
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
