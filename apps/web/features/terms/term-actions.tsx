"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { sendJson, type FormNotice } from "@/features/shared/api-form";

type TermInput = Readonly<{
  archivedAt: string | null;
  endDate: string;
  id: string;
  isActive: boolean;
  name: string;
  startDate: string;
  timeZone: string;
  version: number;
}>;

export function TermActions({ term }: Readonly<{ term: TermInput }>) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<FormNotice | null>(null);
  const [saving, setSaving] = useState(false);

  async function act(work: () => Promise<unknown>, message: string) {
    setSaving(true);
    setNotice(null);
    try {
      await work();
      setNotice({ message, tone: "success" });
      setEditing(false);
      router.refresh();
    } catch (error) {
      setNotice({
        message: error instanceof Error ? error.message : "操作失败，请重试。",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  }

  function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void act(
      () =>
        sendJson(`/api/v1/terms/${term.id}`, "PATCH", {
          endDate: data.get("endDate"),
          expectedVersion: term.version,
          name: data.get("name"),
          startDate: data.get("startDate"),
          termId: term.id,
          timeZone: data.get("timeZone"),
        }),
      "学期信息已更新。",
    );
  }

  return (
    <div className="form-stack term-actions">
      {editing ? (
        <form className="form-stack" onSubmit={update}>
          <div className="form-grid">
            <div className="field full">
              <label htmlFor={`term-name-${term.id}`}>学期名称</label>
              <input defaultValue={term.name} id={`term-name-${term.id}`} name="name" required />
            </div>
            <div className="field">
              <label htmlFor={`term-start-${term.id}`}>开始日期</label>
              <input
                defaultValue={term.startDate}
                id={`term-start-${term.id}`}
                name="startDate"
                required
                type="date"
              />
            </div>
            <div className="field">
              <label htmlFor={`term-end-${term.id}`}>结束日期</label>
              <input
                defaultValue={term.endDate}
                id={`term-end-${term.id}`}
                name="endDate"
                required
                type="date"
              />
            </div>
            <div className="field full">
              <label htmlFor={`term-zone-${term.id}`}>IANA 时区</label>
              <input
                defaultValue={term.timeZone}
                id={`term-zone-${term.id}`}
                name="timeZone"
                required
              />
            </div>
          </div>
          <div className="button-row">
            <button className="button button-secondary" disabled={saving} type="submit">
              保存编辑
            </button>
            <button className="button button-ghost" onClick={() => setEditing(false)} type="button">
              取消
            </button>
          </div>
        </form>
      ) : (
        <div className="button-row">
          {term.archivedAt === null && !term.isActive ? (
            <button
              className="button button-secondary"
              disabled={saving}
              onClick={() =>
                void act(
                  () => sendJson("/api/v1/profile/active-term", "PUT", { termId: term.id }),
                  "当前学期已切换。",
                )
              }
              type="button"
            >
              设为当前
            </button>
          ) : null}
          <button
            className="button button-ghost"
            disabled={saving || term.archivedAt !== null}
            onClick={() => setEditing(true)}
            type="button"
          >
            编辑
          </button>
          <button
            className="button button-ghost"
            disabled={saving}
            onClick={() =>
              void act(
                () =>
                  sendJson(`/api/v1/terms/${term.id}/archive`, "PUT", {
                    archived: term.archivedAt === null,
                    expectedVersion: term.version,
                    termId: term.id,
                  }),
                term.archivedAt === null ? "学期已归档；它不再是当前学期。" : "学期已恢复。",
              )
            }
            type="button"
          >
            {term.archivedAt === null ? "归档" : "恢复"}
          </button>
        </div>
      )}
      {notice === null ? null : (
        <p aria-live="polite" className="field-hint" data-tone={notice.tone}>
          {notice.message}
        </p>
      )}
    </div>
  );
}
