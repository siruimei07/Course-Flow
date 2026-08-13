"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { sendJson } from "../shared/api-form";

export function SourceDeleteButton({
  sourceId,
  version,
}: Readonly<{ sourceId: string; version: number }>) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    if (!window.confirm("删除后将立即撤销原文预览。确定删除这份资料吗？")) return;
    setDeleting(true);
    setError(null);
    try {
      await sendJson(`/api/v1/source-documents/${sourceId}`, "DELETE", {
        expectedVersion: version,
      });
      router.push("/sources");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除失败，请刷新后重试。");
      setDeleting(false);
    }
  }

  return (
    <div className="source-delete-control">
      <button className="button button-ghost" disabled={deleting} onClick={remove} type="button">
        {deleting ? "正在删除…" : "删除资料"}
      </button>
      {error === null ? null : (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
