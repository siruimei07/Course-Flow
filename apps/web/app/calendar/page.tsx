import { FuturePage } from "@/features/shared/future-page";
export default function CalendarPage() {
  return (
    <FuturePage
      description="P2 将由同一个 ScheduleSnapshot 展开课节实例与有确定日期的课程事项；Reading Week、取消与改期会使用同一规则。P1 只保存真实周期课节和单次例外，不在页面自行展开。"
      nextHref="/courses"
      nextLabel="核对课程课节"
      phase="P2"
      title="日历"
    />
  );
}
