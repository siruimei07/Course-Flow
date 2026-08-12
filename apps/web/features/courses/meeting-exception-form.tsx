"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { sendJson, type FormNotice } from "@/features/shared/api-form";

export function MeetingExceptionForm({
  patternId,
  timeZone,
}: Readonly<{ patternId: string; timeZone: string }>) {
  const router = useRouter();
  const [action, setAction] = useState<"cancelled" | "kept" | "rescheduled">("cancelled");
  const [notice, setNotice] = useState<FormNotice | null>(null);
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    const data = new FormData(event.currentTarget);
    const occurrenceDate = String(data.get("occurrenceDate"));
    try {
      await sendJson(`/api/v1/meeting-patterns/${patternId}/exceptions/${occurrenceDate}`, "PUT", {
        action,
        meetingPatternId: patternId,
        note: String(data.get("note") ?? "") || null,
        occurrenceDate,
        replacementDate: action === "rescheduled" ? data.get("replacementDate") : null,
        replacementEndTime: action === "rescheduled" ? data.get("replacementEndTime") : null,
        replacementLocationText:
          action === "rescheduled"
            ? String(data.get("replacementLocationText") ?? "") || null
            : null,
        replacementStartTime: action === "rescheduled" ? data.get("replacementStartTime") : null,
        replacementTimeZone: action === "rescheduled" ? timeZone : null,
      });
      setNotice({ message: "课节单次例外已保存；原周期规则仍保留。", tone: "success" });
      router.refresh();
    } catch (error) {
      setNotice({
        message: error instanceof Error ? error.message : "例外保存失败。",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="form-stack" onSubmit={submit}>
      {notice === null ? null : (
        <div aria-live="polite" className="status-banner" data-tone={notice.tone}>
          {notice.message}
        </div>
      )}
      <div className="field">
        <label htmlFor={`exception-date-${patternId}`}>原计划日期</label>
        <input id={`exception-date-${patternId}`} name="occurrenceDate" required type="date" />
        <p className="field-hint">必须是该周期课节按星期和有效范围本应发生的日期。</p>
      </div>
      <div className="field">
        <label htmlFor={`exception-action-${patternId}`}>动作</label>
        <select
          id={`exception-action-${patternId}`}
          onChange={(event) => setAction(event.target.value as typeof action)}
          value={action}
        >
          <option value="cancelled">取消本次课</option>
          <option value="kept">Reading Week 仍保留本次课</option>
          <option value="rescheduled">改期</option>
        </select>
      </div>
      {action === "rescheduled" ? (
        <div className="form-grid">
          <div className="field">
            <label htmlFor={`replacement-date-${patternId}`}>替代日期</label>
            <input
              id={`replacement-date-${patternId}`}
              name="replacementDate"
              required
              type="date"
            />
          </div>
          <div className="field">
            <label htmlFor={`replacement-place-${patternId}`}>替代地点</label>
            <input id={`replacement-place-${patternId}`} name="replacementLocationText" />
          </div>
          <div className="field">
            <label htmlFor={`replacement-start-${patternId}`}>替代开始时间</label>
            <input
              id={`replacement-start-${patternId}`}
              name="replacementStartTime"
              required
              type="time"
            />
          </div>
          <div className="field">
            <label htmlFor={`replacement-end-${patternId}`}>替代结束时间</label>
            <input
              id={`replacement-end-${patternId}`}
              name="replacementEndTime"
              required
              type="time"
            />
          </div>
        </div>
      ) : null}
      <div className="field">
        <label htmlFor={`exception-note-${patternId}`}>说明（可选）</label>
        <input id={`exception-note-${patternId}`} name="note" />
      </div>
      <button className="button button-secondary" disabled={saving} type="submit">
        {saving ? "正在保存…" : "保存单次例外"}
      </button>
    </form>
  );
}
