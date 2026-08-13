import { notFound } from "next/navigation";
import { getImportHarnessView } from "@/composition/import-harness";
import { ImportWorkbench } from "@/features/imports/import-workbench";

export const dynamic = "force-dynamic";

export default async function ImportRunPage({
  params,
}: Readonly<{ params: Promise<{ runId: string }> }>) {
  const { runId } = await params;
  const view = getImportHarnessView(runId);
  if (view === null) notFound();
  return (
    <section className="page import-page">
      <div className="page-heading">
        <div className="page-heading-copy">
          <p className="page-context">隔离 contract harness · 默认生产组合不安装 AI 能力</p>
          <h1 className="secondary-title">导入与审核</h1>
        </div>
      </div>
      <ImportWorkbench view={view} />
    </section>
  );
}
