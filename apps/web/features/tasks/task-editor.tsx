"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { sendJson, type FormNotice } from "@/features/shared/api-form";
import { Icon } from "@/features/shell/icon";

type CourseOption = Readonly<{ id: string; label: string; termId: string; timeZone: string }>;
type LabelOption = Readonly<{ colorKey: string; displayName: string; id: string; termId: string }>;

export function TaskEditor({
  courses,
  initialCourseId,
  labels,
}: Readonly<{
  courses: readonly CourseOption[];
  initialCourseId?: string;
  labels: readonly LabelOption[];
}>) {
  const router = useRouter();
  const [courseId, setCourseId] = useState(
    courses.some((course) => course.id === initialCourseId)
      ? initialCourseId!
      : (courses[0]?.id ?? ""),
  );
  const selectedCourse = courses.find((course) => course.id === courseId) ?? null;
  const availableLabels = useMemo(
    () => labels.filter((label) => label.termId === selectedCourse?.termId),
    [labels, selectedCourse],
  );
  const [temporalKind, setTemporalKind] = useState<
    "unscheduled" | "date" | "deadline" | "interval"
  >("unscheduled");
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [notice, setNotice] = useState<FormNotice | null>(null);
  const [saving, setSaving] = useState(false);
  const [labelName, setLabelName] = useState("");

  async function createLabel() {
    if (selectedCourse === null || !labelName.trim()) return;
    setSaving(true);
    setNotice(null);
    try {
      await sendJson(`/api/v1/terms/${selectedCourse.termId}/task-labels`, "POST", {
        colorKey: "purple",
        displayName: labelName,
        termId: selectedCourse.termId,
      });
      setLabelName("");
      setNotice({ message: "标签已保存，可刷新后用于该学期事项。", tone: "success" });
      router.refresh();
    } catch (error) {
      setNotice({
        message: error instanceof Error ? error.message : "标签保存失败。",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    const note = String(data.get("temporalNote") ?? "") || null;
    const temporal =
      temporalKind === "unscheduled"
        ? { kind: "unscheduled" as const, note }
        : temporalKind === "date"
          ? { date: data.get("localDate"), kind: "date" as const, note }
          : temporalKind === "deadline"
            ? {
                at: data.get("dueAt"),
                kind: "deadline" as const,
                note,
                timeZone: selectedCourse?.timeZone,
              }
            : {
                endsAt: data.get("endsAt"),
                kind: "interval" as const,
                note,
                startsAt: data.get("startsAt"),
                timeZone: selectedCourse?.timeZone,
              };
    try {
      await sendJson(`/api/v1/courses/${courseId}/items`, "POST", {
        courseId,
        details: String(data.get("details") ?? "") || null,
        estimatedMinutes: data.get("estimatedMinutes")
          ? Number(data.get("estimatedMinutes"))
          : null,
        kind: data.get("kind"),
        labelIds: selectedLabels,
        progressBps: data.get("progressPercent")
          ? Math.round(Number(data.get("progressPercent")) * 100)
          : null,
        temporal,
        title: data.get("title"),
      });
      form.reset();
      setSelectedLabels([]);
      setTemporalKind("unscheduled");
      setNotice({
        message: "课程事项已保存；刷新与课程 Timeline 均从同一正式记录回读。",
        tone: "success",
      });
      router.refresh();
    } catch (error) {
      setNotice({
        message: error instanceof Error ? error.message : "事项保存失败。",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="form-stack">
      {notice === null ? null : (
        <div aria-live="polite" className="status-banner" data-tone={notice.tone}>
          {notice.message}
        </div>
      )}
      <form className="form-stack" onSubmit={submit}>
        <div className="field">
          <label htmlFor="task-course">课程</label>
          <select
            id="task-course"
            onChange={(event) => {
              setCourseId(event.target.value);
              setSelectedLabels([]);
            }}
            value={courseId}
          >
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.label}
              </option>
            ))}
          </select>
        </div>
        <div className="form-grid">
          <div className="field full">
            <label htmlFor="task-title">事项标题</label>
            <input id="task-title" name="title" required />
          </div>
          <div className="field">
            <label htmlFor="task-kind">类型</label>
            <select id="task-kind" name="kind">
              <option value="assignment">作业</option>
              <option value="exam">考试</option>
              <option value="quiz">测验</option>
              <option value="lab">实验</option>
              <option value="project">项目</option>
              <option value="presentation">展示</option>
              <option value="reading">阅读</option>
              <option value="milestone">里程碑</option>
              <option value="other">其他</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="task-estimate">预计投入（分钟，可选）</label>
            <input id="task-estimate" min="1" name="estimatedMinutes" type="number" />
          </div>
          <div className="field">
            <label htmlFor="task-progress">准备进度 %（可选）</label>
            <input id="task-progress" max="100" min="0" name="progressPercent" type="number" />
            <p className="field-hint">这是准备进度，不是成绩。</p>
          </div>
          <div className="field full">
            <label htmlFor="task-details">说明（可选）</label>
            <textarea id="task-details" name="details" />
          </div>
        </div>
        <fieldset className="field">
          <legend>时间语义</legend>
          <select
            aria-label="时间语义"
            onChange={(event) => setTemporalKind(event.target.value as typeof temporalKind)}
            value={temporalKind}
          >
            <option value="unscheduled">未排期 / TBA</option>
            <option value="date">纯日期</option>
            <option value="deadline">确定截止时刻</option>
            <option value="interval">时间区间</option>
          </select>
        </fieldset>
        <div className="temporal-fields">
          {temporalKind === "date" ? (
            <div className="field">
              <label htmlFor="task-date">日期</label>
              <input id="task-date" name="localDate" required type="date" />
            </div>
          ) : null}
          {temporalKind === "deadline" ? (
            <div className="field">
              <label htmlFor="task-due">确定截止时刻（含 UTC offset）</label>
              <input
                id="task-due"
                name="dueAt"
                pattern=".*(?:Z|[+-][0-9]{2}:[0-9]{2})$"
                placeholder="2026-10-11T23:59:00+08:00"
                required
              />
              <p className="field-hint">
                必须显式包含 Z 或 ±HH:mm；课程展示时区保留为 {selectedCourse?.timeZone}
                ，不会按设备时区猜测。
              </p>
            </div>
          ) : null}
          {temporalKind === "interval" ? (
            <div className="form-grid">
              <div className="field">
                <label htmlFor="task-starts">开始确定时刻（含 offset）</label>
                <input
                  id="task-starts"
                  name="startsAt"
                  pattern=".*(?:Z|[+-][0-9]{2}:[0-9]{2})$"
                  placeholder="2026-10-10T17:00:00+08:00"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="task-ends">结束确定时刻（含 offset）</label>
                <input
                  id="task-ends"
                  name="endsAt"
                  pattern=".*(?:Z|[+-][0-9]{2}:[0-9]{2})$"
                  placeholder="2026-10-10T19:00:00+08:00"
                  required
                />
              </div>
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="task-note">时间备注（可选）</label>
            <input
              id="task-note"
              name="temporalNote"
              placeholder={
                temporalKind === "unscheduled" ? "例如：Week 6，日期待定" : "原始语义备注"
              }
            />
          </div>
        </div>
        <fieldset className="field">
          <legend>标签（学期内复用）</legend>
          {availableLabels.length === 0 ? (
            <p className="field-hint">该学期还没有标签，可在下方先创建。</p>
          ) : (
            <div className="button-row">
              {availableLabels.map((label) => (
                <label className="check-chip" key={label.id}>
                  <input
                    checked={selectedLabels.includes(label.id)}
                    onChange={(event) =>
                      setSelectedLabels((current) =>
                        event.target.checked
                          ? [...current, label.id]
                          : current.filter((id) => id !== label.id),
                      )
                    }
                    type="checkbox"
                  />
                  {label.displayName}
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <div className="form-footer">
          <button
            className="button button-primary"
            disabled={saving || courseId === ""}
            type="submit"
          >
            <Icon name="plus" />
            {saving ? "正在保存…" : "添加事项"}
          </button>
        </div>
      </form>
      <div className="temporal-fields">
        <div className="field">
          <label htmlFor="new-label">创建本学期标签</label>
          <input
            id="new-label"
            onChange={(event) => setLabelName(event.target.value)}
            placeholder="例如：需讨论"
            value={labelName}
          />
        </div>
        <button
          className="button button-secondary"
          disabled={saving || !labelName.trim()}
          onClick={createLabel}
          type="button"
        >
          <Icon name="tag" />
          保存标签
        </button>
      </div>
    </div>
  );
}
