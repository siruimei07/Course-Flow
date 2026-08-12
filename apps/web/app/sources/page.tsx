import { FuturePage } from "@/features/shared/future-page";
export default function SourcesPage() {
  return (
    <FuturePage
      description="P3 才接入上传与候选审核。自动抽取始终只是候选，用户确认前不会写入这里已经完成的学期、课节、事项或评分方案。"
      nextHref="/tasks"
      nextLabel="管理手工事项"
      phase="P3"
      title="资料"
    />
  );
}
