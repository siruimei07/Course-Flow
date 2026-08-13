import Link from "next/link";
import {
  asCourseId,
  asSourceDocumentId,
  asTaskLabelId,
  type SourceDocumentSummary,
  type TaskGroupKey,
} from "@courseflow/core";
import { getScopedCourseFlow } from "@/composition/runtime";
import { ScheduleTaskRow } from "@/features/schedule/schedule-task-row";
import { PageHeading } from "@/features/shared/page-heading";
import { TaskEditor } from "@/features/tasks/task-editor";

export const dynamic = "force-dynamic";

const groupCopy: Readonly<Record<TaskGroupKey, Readonly<{ description: string; title: string }>>> =
  {
    major: { description: "重要考核、里程碑或超过 7 天的事项", title: "持续准备" },
    near: { description: "未来 7 天内的短期事项", title: "本周推进" },
    priority: { description: "已逾期、今天或明天需要处理", title: "先完成" },
    tba: { description: "保留原始 TBA 语义，不进入日历或热力图", title: "时间待确认" },
  };

function filterHref(
  current: Readonly<{ group?: string; labelId?: string; q?: string }>,
  change: Readonly<{ group?: string | null; labelId?: string | null }>,
): string {
  const parameters = new URLSearchParams();
  const group = change.group === undefined ? current.group : change.group;
  const labelId = change.labelId === undefined ? current.labelId : change.labelId;
  if (group) parameters.set("group", group);
  if (labelId) parameters.set("labelId", labelId);
  if (current.q) parameters.set("q", current.q);
  const query = parameters.toString();
  return query === "" ? "/tasks" : "/tasks?" + query;
}

export default async function TasksPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{
    courseId?: string;
    group?: string;
    labelId?: string;
    q?: string;
    sourceId?: string;
  }>;
}>) {
  const { academics, schedule, scope, sources } = await getScopedCourseFlow();
  const [terms, parameters] = await Promise.all([academics.listTerms(scope), searchParams]);
  const active =
    terms.find((term) => term.isActive && term.archivedAt === null) ??
    terms.find((term) => term.archivedAt === null) ??
    null;
  const validGroups = new Set<TaskGroupKey>(["priority", "near", "major", "tba"]);
  const selectedGroup =
    parameters.group !== undefined && validGroups.has(parameters.group as TaskGroupKey)
      ? (parameters.group as TaskGroupKey)
      : undefined;
  const [board, courseSetups] =
    active === null
      ? [null, []]
      : await Promise.all([
          schedule.getTaskBoard(scope, {
            ...(selectedGroup === undefined ? {} : { group: selectedGroup }),
            ...(parameters.labelId === undefined
              ? {}
              : { labelIds: [asTaskLabelId(parameters.labelId)] }),
            ...(parameters.q === undefined ? {} : { search: parameters.q }),
            termId: active.id,
          }),
          academics.listCourses(scope, active.id),
        ]);
  const courses = courseSetups.filter((setup) => setup.course.archivedAt === null);
  let sourceContext: SourceDocumentSummary | null = null;
  if (parameters.sourceId !== undefined && parameters.courseId !== undefined) {
    const selectedCourse = courses.find((setup) => setup.course.id === parameters.courseId);
    if (selectedCourse !== undefined) {
      const sourceLibrary = await sources.listSources(scope, {
        courseId: asCourseId(parameters.courseId),
      });
      sourceContext =
        sourceLibrary.sources.find(
          (source) =>
            source.id === asSourceDocumentId(parameters.sourceId!) && source.status === "ready",
        ) ?? null;
    }
  }
  const total =
    board === null ? 0 : Object.values(board.groups).reduce((sum, items) => sum + items.length, 0);

  return (
    <section className="page">
      <PageHeading
        context={
          active === null ? "还没有当前学期" : active.name + " · " + total + " 个匹配的可行动事项"
        }
        title="任务"
      />
      {active === null || board === null ? (
        <section className="panel empty-state">
          <h2>先创建当前学期</h2>
          <p>任务投影只读取当前用户、当前正式学期的数据。</p>
          <Link className="button button-primary" href="/terms">
            前往学期
          </Link>
        </section>
      ) : courses.length === 0 ? (
        <section className="panel empty-state">
          <h2>先添加课程</h2>
          <p>课程事项必须属于真实课程；这里不会创建第二套任务真相。</p>
          <Link className="button button-primary" href="/courses/new">
            添加课程
          </Link>
        </section>
      ) : (
        <>
          {sourceContext === null ? null : (
            <section className="panel source-manual-context" aria-labelledby="source-manual-title">
              <div>
                <span className="meta-label">对照资料手工录入</span>
                <h2 id="source-manual-title">{sourceContext.displayName}</h2>
                <p>原文不会预填或提交任何字段。请在新标签页查看资料，再由你填写下面的既有表单。</p>
              </div>
              <div className="source-manual-context-actions">
                <a
                  className="button button-dark"
                  href={`/api/v1/source-documents/${sourceContext.id}/preview`}
                  rel="noreferrer"
                  target="_blank"
                >
                  查看原始文件
                </a>
                <Link
                  className="button button-secondary"
                  href={`/sources?courseId=${sourceContext.courseId}&sourceId=${sourceContext.id}`}
                >
                  返回资料库
                </Link>
              </div>
            </section>
          )}
          <section className="panel task-filters" aria-label="任务筛选">
            <form action="/tasks" className="task-search" role="search">
              {selectedGroup === undefined ? null : (
                <input name="group" type="hidden" value={selectedGroup} />
              )}
              {parameters.labelId === undefined ? null : (
                <input name="labelId" type="hidden" value={parameters.labelId} />
              )}
              <label className="sr-only" htmlFor="task-search">
                搜索任务
              </label>
              <input
                defaultValue={parameters.q}
                id="task-search"
                name="q"
                placeholder="搜索课程、标题或说明"
              />
              <button className="button button-dark" type="submit">
                搜索
              </button>
            </form>
            <nav aria-label="任务分组" className="filter-chips">
              <Link
                aria-current={selectedGroup === undefined ? "page" : undefined}
                href={filterHref(parameters, { group: null })}
              >
                全部
              </Link>
              {(Object.keys(groupCopy) as TaskGroupKey[]).map((group) => (
                <Link
                  aria-current={selectedGroup === group ? "page" : undefined}
                  href={filterHref(parameters, { group })}
                  key={group}
                >
                  {groupCopy[group].title}
                </Link>
              ))}
            </nav>
            {board.labels.length === 0 ? null : (
              <nav aria-label="任务标签" className="filter-chips">
                <Link
                  aria-current={parameters.labelId === undefined ? "page" : undefined}
                  href={filterHref(parameters, { labelId: null })}
                >
                  全部标签
                </Link>
                {board.labels.map((label) => (
                  <Link
                    aria-current={parameters.labelId === label.id ? "page" : undefined}
                    href={filterHref(parameters, { labelId: label.id })}
                    key={label.id}
                  >
                    {label.displayName}
                  </Link>
                ))}
              </nav>
            )}
          </section>

          <div className="task-layout">
            <section className="task-board" aria-label="任务分组">
              {(Object.keys(groupCopy) as TaskGroupKey[]).map((group) =>
                selectedGroup !== undefined && selectedGroup !== group ? null : (
                  <section className="panel task-group" key={group}>
                    <div className="panel-header">
                      <div>
                        <h2>{groupCopy[group].title}</h2>
                        <p className="panel-subtitle">{groupCopy[group].description}</p>
                      </div>
                      <span className="metric-small">{board.groups[group].length}</span>
                    </div>
                    {board.groups[group].length === 0 ? (
                      <div className="empty-state compact">
                        <p>这个分组暂时没有匹配事项。</p>
                      </div>
                    ) : (
                      <div className="task-list">
                        {board.groups[group].map((item) => (
                          <ScheduleTaskRow item={item} key={item.id} />
                        ))}
                      </div>
                    )}
                  </section>
                ),
              )}
            </section>
            <aside className="panel task-form-panel">
              <div className="panel-header">
                <div>
                  <h2>添加事项 / 标签</h2>
                  <p className="panel-subtitle">保存后由同一正式 snapshot 重新投影</p>
                </div>
              </div>
              <div className="panel-body">
                <TaskEditor
                  courses={courses.map((setup) => ({
                    id: setup.course.id,
                    label: setup.course.code + " · " + setup.course.title,
                    termId: setup.course.termId,
                    timeZone: setup.course.timeZone,
                  }))}
                  labels={board.labels.map((label) => ({
                    colorKey: label.colorKey,
                    displayName: label.displayName,
                    id: label.id,
                    termId: label.termId,
                  }))}
                  {...(parameters.courseId === undefined
                    ? {}
                    : { initialCourseId: parameters.courseId })}
                />
              </div>
            </aside>
          </div>
          <p className="snapshot-note page-snapshot">
            Snapshot {board.snapshotId} · {board.timeZone} · {board.policyVersions.taskGrouping}
          </p>
        </>
      )}
    </section>
  );
}
