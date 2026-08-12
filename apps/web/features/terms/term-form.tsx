"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { sendJson, type FormNotice } from "@/features/shared/api-form";

export function TermForm() {
  const router = useRouter();
  const [notice, setNotice] = useState<FormNotice | null>(null);
  const [saving, setSaving] = useState(false);
  const [readingWeek, setReadingWeek] = useState(true);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await sendJson("/api/v1/terms", "POST", {
        endDate: data.get("endDate"),
        name: data.get("name"),
        startDate: data.get("startDate"),
        timeZone: data.get("timeZone"),
        readingWeeks: readingWeek
          ? [
              {
                endDate: data.get("readingWeekEnd"),
                name: data.get("readingWeekName"),
                startDate: data.get("readingWeekStart"),
              },
            ]
          : [],
      });
      form.reset();
      setNotice({
        message: "学期与 Reading Week 已保存。刷新后仍会从 PostgreSQL 读取。",
        tone: "success",
      });
      router.refresh();
    } catch (error) {
      setNotice({ message: error instanceof Error ? error.message : "保存失败。", tone: "danger" });
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
      <div className="form-grid">
        <div className="field full">
          <label htmlFor="term-name">学期名称</label>
          <input id="term-name" name="name" required placeholder="例如：2026 秋季" />
        </div>
        <div className="field">
          <label htmlFor="term-start">开始日期</label>
          <input id="term-start" name="startDate" required type="date" />
        </div>
        <div className="field">
          <label htmlFor="term-end">结束日期</label>
          <input id="term-end" name="endDate" required type="date" />
        </div>
        <div className="field full">
          <label htmlFor="term-zone">IANA 时区</label>
          <input defaultValue="Asia/Shanghai" id="term-zone" name="timeZone" required />
          <p className="field-hint">纯日期保持纯日期；课节本地时间按此时区解释。</p>
        </div>
      </div>
      <label className="check-chip">
        <input
          checked={readingWeek}
          onChange={(event) => setReadingWeek(event.target.checked)}
          type="checkbox"
        />
        {readingWeek ? "✓ " : ""}包含 Reading Week
      </label>
      {readingWeek ? (
        <div className="temporal-fields">
          <div className="form-grid">
            <div className="field full">
              <label htmlFor="rw-name">例外名称</label>
              <input defaultValue="Reading Week" id="rw-name" name="readingWeekName" required />
            </div>
            <div className="field">
              <label htmlFor="rw-start">开始日期</label>
              <input id="rw-start" name="readingWeekStart" required type="date" />
            </div>
            <div className="field">
              <label htmlFor="rw-end">结束日期</label>
              <input id="rw-end" name="readingWeekEnd" required type="date" />
            </div>
          </div>
          <p className="field-hint">
            区间内默认暂停周期课节，但不删除课节规则；单次 kept/rescheduled 可以覆盖。
          </p>
        </div>
      ) : null}
      <div className="form-footer">
        <button className="button button-primary" disabled={saving} type="submit">
          {saving ? "正在保存…" : "创建学期"}
        </button>
      </div>
    </form>
  );
}
