import type { WorkloadHeatmapView } from "@courseflow/core";

const bandLabels = {
  busy: "繁忙",
  light: "轻量",
  moderate: "适中",
  none: "无事项",
  overloaded: "超负荷",
} as const;

export function WorkloadHeatmap({ heatmap }: Readonly<{ heatmap: WorkloadHeatmapView }>) {
  const nonEmpty = heatmap.weeks.filter((week) => week.itemCount > 0);
  return (
    <div className="heatmap-wrap">
      <div
        aria-describedby="workload-heatmap-summary"
        aria-label="按周工作量热力图"
        className="heatmap-grid"
        role="img"
      >
        {heatmap.weeks.map((week) => (
          <span
            aria-label={
              week.startDate +
              " 至 " +
              week.endDate +
              "，" +
              week.itemCount +
              " 项，" +
              week.totalMinutes +
              " 分钟，" +
              bandLabels[week.band]
            }
            className="heatmap-cell"
            data-band={week.band}
            key={week.startDate}
            title={
              week.label +
              " · " +
              week.itemCount +
              " 项 · " +
              week.totalMinutes +
              " 分钟 · " +
              bandLabels[week.band]
            }
          >
            <span>{week.label}</span>
            <strong>{week.totalMinutes === 0 ? "—" : week.totalMinutes + "m"}</strong>
          </span>
        ))}
      </div>
      <p className="panel-subtitle" id="workload-heatmap-summary">
        事项全部归入其到期/开始所在周；用户或资料估计与启发式估计分开累计。时间待定事项{" "}
        {heatmap.unscheduledCount} 项，不进入热力图。
      </p>
      <details className="heatmap-details">
        <summary>工作量文字明细</summary>
        {nonEmpty.length === 0 ? (
          <p>当前学期没有已排期事项。</p>
        ) : (
          <table>
            <caption className="sr-only">非空周工作量列表</caption>
            <thead>
              <tr>
                <th scope="col">周</th>
                <th scope="col">事项</th>
                <th scope="col">已确认</th>
                <th scope="col">启发式</th>
                <th scope="col">负荷</th>
              </tr>
            </thead>
            <tbody>
              {nonEmpty.map((week) => (
                <tr key={week.startDate}>
                  <th scope="row">{week.label}</th>
                  <td>{week.itemCount}</td>
                  <td>{week.confirmedMinutes} 分钟</td>
                  <td>{week.heuristicMinutes} 分钟</td>
                  <td>{bandLabels[week.band]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </details>
    </div>
  );
}
