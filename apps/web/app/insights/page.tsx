import { FuturePage } from "@/features/shared/future-page";
export default function InsightsPage() {
  return (
    <FuturePage
      description="首批 Insight 的输入范围、公式和最小数据量尚未定义，因此不迁移原型中的统计 fixture。Gradebook 当前只显示手工结果与覆盖口径。"
      nextHref="/courses"
      nextLabel="查看课程 Gradebook"
      phase="P6"
      title="统计"
    />
  );
}
