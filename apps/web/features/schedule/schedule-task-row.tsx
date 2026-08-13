import type { ScheduleItemView } from "@courseflow/core";
import { courseColor, courseItemKindLabels } from "@/features/shared/format";
import { TaskActions } from "@/features/tasks/task-actions";

export function ScheduleTaskRow({ item }: Readonly<{ item: ScheduleItemView }>) {
  return (
    <article className="task-row">
      <span
        aria-hidden="true"
        className="task-kind-rail"
        style={{ background: courseColor(item.course.colorKey) }}
      />
      <div>
        <span className="course-code-big">
          {item.course.code} · {courseItemKindLabels[item.kind]}
        </span>
        <h3>{item.title}</h3>
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
        <strong>{item.temporalLabel}</strong>
        {item.workloadMinutes} 分钟 ·{" "}
        {item.workloadSource === "heuristic" ? "启发式估计" : "已确认估计"}
      </div>
    </article>
  );
}
