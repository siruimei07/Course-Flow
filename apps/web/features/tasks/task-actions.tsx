"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { sendJson } from "@/features/shared/api-form";

export function TaskActions({
  itemId,
  state,
  title,
  version,
}: Readonly<{
  itemId: string;
  state: "planned" | "completed" | "cancelled";
  title: string;
  version: number;
}>) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [nextTitle, setNextTitle] = useState(title);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function action(work: () => Promise<unknown>, success: string) {
    setSaving(true);
    setMessage(null);
    try {
      await work();
      setMessage(success);
      setEditing(false);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败。");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="form-stack">
      {editing ? (
        <div className="field">
          <label htmlFor={`edit-${itemId}`}>编辑标题</label>
          <input
            id={`edit-${itemId}`}
            onChange={(event) => setNextTitle(event.target.value)}
            value={nextTitle}
          />
          <div className="button-row">
            <button
              className="button button-secondary"
              disabled={saving || !nextTitle.trim()}
              onClick={() =>
                action(
                  () =>
                    fetch(`/api/v1/course-items/${itemId}`, {
                      body: JSON.stringify({ expectedVersion: version, itemId, title: nextTitle }),
                      headers: {
                        "content-type": "application/json",
                        origin: window.location.origin,
                      },
                      method: "PATCH",
                    }).then(async (response) => {
                      if (!response.ok) {
                        const body = (await response.json()) as { detail?: string };
                        throw new Error(body.detail ?? "更新失败。");
                      }
                    }),
                  "标题已更新。",
                )
              }
              type="button"
            >
              保存编辑
            </button>
            <button className="button button-ghost" onClick={() => setEditing(false)} type="button">
              取消
            </button>
          </div>
        </div>
      ) : (
        <div className="button-row">
          <button className="button button-ghost" onClick={() => setEditing(true)} type="button">
            编辑
          </button>
          <button
            className="button button-ghost"
            disabled={saving}
            onClick={() =>
              action(
                () =>
                  sendJson(`/api/v1/course-items/${itemId}/state`, "PUT", {
                    expectedVersion: version,
                    itemId,
                    state: state === "completed" ? "planned" : "completed",
                  }),
                state === "completed" ? "事项已恢复为计划中。" : "事项已标记完成。",
              )
            }
            type="button"
          >
            {state === "completed" ? "恢复" : "完成"}
          </button>
          <button
            className="button button-ghost"
            disabled={saving}
            onClick={() =>
              action(
                () =>
                  sendJson(`/api/v1/course-items/${itemId}/state`, "PUT", {
                    expectedVersion: version,
                    itemId,
                    state: "cancelled",
                  }),
                "事项已取消。",
              )
            }
            type="button"
          >
            取消事项
          </button>
          <button
            className="button button-ghost"
            disabled={saving}
            onClick={() =>
              action(
                () =>
                  fetch(`/api/v1/course-items/${itemId}`, {
                    body: JSON.stringify({ expectedVersion: version }),
                    headers: {
                      "content-type": "application/json",
                      origin: window.location.origin,
                    },
                    method: "DELETE",
                  }).then(async (response) => {
                    if (!response.ok) {
                      const body = (await response.json()) as { detail?: string };
                      throw new Error(body.detail ?? "删除失败。");
                    }
                  }),
                "事项已软删除。",
              )
            }
            type="button"
          >
            软删除
          </button>
        </div>
      )}
      {message === null ? null : (
        <p aria-live="polite" className="field-hint">
          {message}
        </p>
      )}
    </div>
  );
}
