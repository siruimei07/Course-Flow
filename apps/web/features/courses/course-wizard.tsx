"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { sendJson, type FormNotice } from "@/features/shared/api-form";
import { Icon } from "@/features/shell/icon";

type TermOption = Readonly<{
  endDate: string;
  id: string;
  name: string;
  readingWeeks: readonly Readonly<{ endDate: string; name: string; startDate: string }>[];
  startDate: string;
  timeZone: string;
}>;

type MeetingDraft = {
  kind: "lecture" | "tutorial" | "practical" | "other";
  localEndTime: string;
  localStartTime: string;
  locationText: string;
  section: string;
  title: string;
  weekdays: number[];
};

const emptyMeeting = (): MeetingDraft => ({
  kind: "lecture",
  localEndTime: "10:00",
  localStartTime: "09:00",
  locationText: "",
  section: "",
  title: "",
  weekdays: [0],
});
const labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const kindLabels = {
  lecture: "Lecture",
  tutorial: "Tutorial (TUT)",
  practical: "Practical (PRA)",
  other: "Other",
} as const;

export function CourseWizard({ terms }: Readonly<{ terms: readonly TermOption[] }>) {
  const router = useRouter();
  const heading = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState(0);
  const [notice, setNotice] = useState<FormNotice | null>(null);
  const [saving, setSaving] = useState(false);
  const [termId, setTermId] = useState(terms[0]?.id ?? "");
  const selectedTerm = useMemo(
    () => terms.find((term) => term.id === termId) ?? null,
    [termId, terms],
  );
  const [course, setCourse] = useState({
    code: "",
    colorKey: "blue",
    creditValue: "",
    instructorName: "",
    section: "",
    timeZone: terms[0]?.timeZone ?? "Asia/Shanghai",
    title: "",
  });
  const [meetings, setMeetings] = useState<MeetingDraft[]>([emptyMeeting()]);
  function move(next: number) {
    setStep(next);
    setNotice(null);
    queueMicrotask(() => heading.current?.focus());
  }
  function updateMeeting(index: number, patch: Partial<MeetingDraft>) {
    setMeetings((current) =>
      current.map((meeting, candidate) =>
        candidate === index ? { ...meeting, ...patch } : meeting,
      ),
    );
  }
  function validCurrentStep() {
    if (step === 0 && termId === "") return "请先选择学期。";
    if (step === 1 && (!course.code.trim() || !course.title.trim() || !course.timeZone.trim()))
      return "请填写课程代码、名称与时区。";
    if (
      step === 2 &&
      meetings.some(
        (meeting) =>
          meeting.weekdays.length === 0 || meeting.localStartTime >= meeting.localEndTime,
      )
    )
      return "请检查每条课节的星期和起止时间。";
    return null;
  }
  function next() {
    const issue = validCurrentStep();
    if (issue !== null) {
      setNotice({ message: issue, tone: "danger" });
      return;
    }
    move(Math.min(3, step + 1));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const result = (await sendJson("/api/v1/course-setups", "POST", {
        ...course,
        creditValue: course.creditValue || null,
        instructorName: course.instructorName || null,
        meetingPatterns: meetings.map((meeting) => ({
          ...meeting,
          locationText: meeting.locationText || null,
          section: meeting.section || null,
          title: meeting.title || null,
        })),
        section: course.section || null,
        termId,
      })) as { value?: { course?: { id?: string } }; warnings?: readonly { message: string }[] };
      const warningText = result.warnings?.map((warning) => warning.message).join("；");
      setNotice({
        message: warningText ? `课程已保存；请核对：${warningText}` : "课程与课节已保存。",
        tone: warningText ? "warning" : "success",
      });
      const id = result.value?.course?.id;
      if (id !== undefined) router.push(`/courses?courseId=${encodeURIComponent(id)}`);
      router.refresh();
    } catch (error) {
      setNotice({ message: error instanceof Error ? error.message : "保存失败。", tone: "danger" });
    } finally {
      setSaving(false);
    }
  }
  if (terms.length === 0)
    return (
      <section className="panel empty-state">
        <h2>先创建学期</h2>
        <p>课程必须属于一个真实学期，Reading Week 也在学期上定义。</p>
        <Link className="button button-primary" href="/terms">
          前往学期设置
        </Link>
      </section>
    );
  return (
    <form className="panel wizard" onSubmit={submit}>
      <header className="wizard-header">
        <p className="page-context">添加课程 · 第 {step + 1} 步，共 4 步</p>
        <h2 ref={heading} tabIndex={-1}>
          {["选择学期", "课程信息", "上课安排", "核对并保存"][step]}
        </h2>
        <ol className="step-list">
          {["学期", "课程", "课节", "核对"].map((label, index) => (
            <li
              aria-current={step === index ? "step" : undefined}
              data-complete={step > index}
              data-step={index + 1}
              key={label}
            >
              <span>{label}</span>
            </li>
          ))}
        </ol>
      </header>
      <div className="wizard-body">
        {notice === null ? null : (
          <div aria-live="polite" className="status-banner" data-tone={notice.tone}>
            {notice.message}
          </div>
        )}
        {step === 0 ? (
          <div className="form-stack">
            <div className="field">
              <label htmlFor="course-term">所属学期</label>
              <select
                id="course-term"
                onChange={(event) => {
                  const next = terms.find((term) => term.id === event.target.value);
                  setTermId(event.target.value);
                  if (next) setCourse((current) => ({ ...current, timeZone: next.timeZone }));
                }}
                value={termId}
              >
                {terms.map((term) => (
                  <option key={term.id} value={term.id}>
                    {term.name} · {term.startDate}–{term.endDate}
                  </option>
                ))}
              </select>
            </div>
            <div className="status-banner">
              课程时区默认继承学期，可在下一步显式修改。纯日期与课节本地时间不会用 UTC 午夜伪装。
            </div>
          </div>
        ) : null}
        {step === 1 ? (
          <div className="form-grid">
            <div className="field">
              <label htmlFor="course-code">课程代码</label>
              <input
                id="course-code"
                onChange={(event) => setCourse({ ...course, code: event.target.value })}
                required
                value={course.code}
              />
            </div>
            <div className="field">
              <label htmlFor="course-section">Course section（可选）</label>
              <input
                id="course-section"
                onChange={(event) => setCourse({ ...course, section: event.target.value })}
                value={course.section}
              />
            </div>
            <div className="field full">
              <label htmlFor="course-title">课程名称</label>
              <input
                id="course-title"
                onChange={(event) => setCourse({ ...course, title: event.target.value })}
                required
                value={course.title}
              />
            </div>
            <div className="field">
              <label htmlFor="course-instructor">教师（可选）</label>
              <input
                id="course-instructor"
                onChange={(event) => setCourse({ ...course, instructorName: event.target.value })}
                value={course.instructorName}
              />
            </div>
            <div className="field">
              <label htmlFor="course-credit">学分（可选）</label>
              <input
                id="course-credit"
                inputMode="decimal"
                onChange={(event) => setCourse({ ...course, creditValue: event.target.value })}
                value={course.creditValue}
              />
            </div>
            <div className="field">
              <label htmlFor="course-zone">IANA 时区</label>
              <input
                id="course-zone"
                onChange={(event) => setCourse({ ...course, timeZone: event.target.value })}
                required
                value={course.timeZone}
              />
            </div>
            <div className="field">
              <label htmlFor="course-color">课程色键</label>
              <select
                id="course-color"
                onChange={(event) => setCourse({ ...course, colorKey: event.target.value })}
                value={course.colorKey}
              >
                {["blue", "green", "purple", "orange", "red"].map((color) => (
                  <option key={color} value={color}>
                    {color}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}
        {step === 2 ? (
          <div className="form-stack">
            <div className="button-row">
              <button
                className="button button-secondary"
                onClick={() => setMeetings((current) => [...current, emptyMeeting()])}
                type="button"
              >
                <Icon name="plus" />
                添加课节
              </button>
              <button className="button button-ghost" onClick={() => setMeetings([])} type="button">
                保存为无课节课程
              </button>
            </div>
            {meetings.length === 0 ? (
              <div className="status-banner">课程可先无课节保存，之后再补充。</div>
            ) : (
              meetings.map((meeting, index) => (
                <section className="repeat-card" key={index}>
                  <div className="repeat-card-header">
                    <h3>课节 {index + 1}</h3>
                    <button
                      aria-label={`删除课节 ${index + 1}`}
                      className="button button-ghost"
                      onClick={() =>
                        setMeetings((current) =>
                          current.filter((_, candidate) => candidate !== index),
                        )
                      }
                      type="button"
                    >
                      删除
                    </button>
                  </div>
                  <div className="form-grid">
                    <div className="field">
                      <label htmlFor={`meeting-kind-${index}`}>类型</label>
                      <select
                        id={`meeting-kind-${index}`}
                        onChange={(event) =>
                          updateMeeting(index, { kind: event.target.value as MeetingDraft["kind"] })
                        }
                        value={meeting.kind}
                      >
                        {Object.entries(kindLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`meeting-section-${index}`}>课节 section（可选）</label>
                      <input
                        id={`meeting-section-${index}`}
                        onChange={(event) => updateMeeting(index, { section: event.target.value })}
                        value={meeting.section}
                      />
                    </div>
                    <fieldset className="field full">
                      <legend>星期</legend>
                      <div className="check-grid">
                        {labels.map((label, weekday) => (
                          <label className="check-chip" key={label}>
                            <input
                              checked={meeting.weekdays.includes(weekday)}
                              onChange={(event) =>
                                updateMeeting(index, {
                                  weekdays: event.target.checked
                                    ? [...meeting.weekdays, weekday].sort()
                                    : meeting.weekdays.filter((value) => value !== weekday),
                                })
                              }
                              type="checkbox"
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <div className="field">
                      <label htmlFor={`meeting-start-${index}`}>开始本地时间</label>
                      <input
                        id={`meeting-start-${index}`}
                        onChange={(event) =>
                          updateMeeting(index, { localStartTime: event.target.value })
                        }
                        type="time"
                        value={meeting.localStartTime}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`meeting-end-${index}`}>结束本地时间</label>
                      <input
                        id={`meeting-end-${index}`}
                        onChange={(event) =>
                          updateMeeting(index, { localEndTime: event.target.value })
                        }
                        type="time"
                        value={meeting.localEndTime}
                      />
                    </div>
                    <div className="field full">
                      <label htmlFor={`meeting-place-${index}`}>地点 / TBA</label>
                      <input
                        id={`meeting-place-${index}`}
                        onChange={(event) =>
                          updateMeeting(index, { locationText: event.target.value })
                        }
                        value={meeting.locationText}
                      />
                    </div>
                  </div>
                </section>
              ))
            )}
          </div>
        ) : null}
        {step === 3 ? (
          <div className="form-stack">
            <section className="status-banner">
              <strong>{selectedTerm?.name}</strong>
              <br />
              {selectedTerm?.readingWeeks.length
                ? selectedTerm.readingWeeks
                    .map((week) => `${week.name}：${week.startDate}–${week.endDate}`)
                    .join("；")
                : "未设置 Reading Week。"}
            </section>
            <ul className="review-list">
              <li>
                <strong>
                  {course.code} · {course.title}
                </strong>
                <br />
                <span className="page-context">
                  {course.timeZone} · {course.section || "未填写 section"}
                </span>
              </li>
              {meetings.length === 0 ? (
                <li>无周期课节；可保存后补充。</li>
              ) : (
                meetings.map((meeting, index) => (
                  <li key={index}>
                    <strong>{kindLabels[meeting.kind]}</strong> ·{" "}
                    {meeting.weekdays.map((weekday) => labels[weekday]).join("、")}{" "}
                    {meeting.localStartTime}–{meeting.localEndTime}
                    <br />
                    <span className="page-context">{meeting.locationText || "TBA"}</span>
                  </li>
                ))
              )}
            </ul>
            <div className="status-banner" data-tone="warning">
              Reading Week 将抑制周期课节实例，但不会删除这些规则。结构无效会阻断保存；可疑重复以
              warning 保存并提示核对。
            </div>
          </div>
        ) : null}
      </div>
      <footer className="wizard-footer">
        <Link className="button button-ghost" href="/courses">
          取消
        </Link>
        <div className="button-row">
          {step > 0 ? (
            <button
              className="button button-secondary"
              onClick={() => move(step - 1)}
              type="button"
            >
              返回
            </button>
          ) : null}
          {step < 3 ? (
            <button
              className="button button-primary"
              onClick={(event) => {
                event.preventDefault();
                next();
              }}
              type="button"
            >
              继续
            </button>
          ) : (
            <button className="button button-primary" disabled={saving} type="submit">
              {saving ? "正在保存…" : "保存课程"}
            </button>
          )}
        </div>
      </footer>
    </form>
  );
}
