"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { sendJson } from "@/features/shared/api-form";
import { Icon } from "@/features/shell/icon";

export function TaskCompletionButton({
  itemId,
  title,
  version,
}: Readonly<{
  itemId: string;
  title: string;
  version: number;
}>) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const errorId = `complete-error-${itemId}`;

  async function complete() {
    setSaving(true);
    setError(null);
    try {
      await sendJson(`/api/v1/course-items/${itemId}/state`, "PUT", {
        expectedVersion: version,
        itemId,
        state: "completed",
      });
      const nextSearchParams = new URLSearchParams(searchParams.toString());
      nextSearchParams.set("notice", "completed");
      router.replace(`${pathname}?${nextSearchParams.toString()}`, { scroll: false });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法完成该事项，请重试。");
      setSaving(false);
    }
  }

  return (
    <>
      <button
        aria-busy={saving}
        aria-describedby={error === null ? undefined : errorId}
        aria-label={saving ? `正在完成：${title}` : `标记完成：${title}`}
        className="task-complete-control"
        disabled={saving}
        onClick={complete}
        type="button"
      >
        <Icon name="check" />
      </button>
      {error === null ? null : (
        <p className="field-error task-completion-error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </>
  );
}
