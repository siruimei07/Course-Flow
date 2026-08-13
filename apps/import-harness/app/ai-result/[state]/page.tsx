import { notFound } from "next/navigation";
import { AiResultRegion } from "@/features/ai/ai-result-region";
import { getAiResultHarnessView } from "@/composition/import-harness";

export default async function AiResultHarnessPage({
  params,
}: Readonly<{ params: Promise<{ state: string }> }>) {
  const { state } = await params;
  const view = await getAiResultHarnessView(state);
  if (view === null) notFound();
  return (
    <section className="page">
      <AiResultRegion view={view} />
    </section>
  );
}
