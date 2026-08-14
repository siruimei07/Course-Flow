"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Icon } from "../shell/icon";
import { sendJson, type FormNotice } from "../shared/api-form";

type CourseOption = Readonly<{ id: string; label: string }>;

type UploadPlan = Readonly<{
  expiresAt: string;
  source: Readonly<{ id: string; version: number }>;
  targets: readonly Readonly<{
    headers: Readonly<Record<string, string>>;
    position: number;
    uploadUrl: string;
  }>[];
}>;

export function SourceUploadForm({
  courses,
  initialCourseId,
}: Readonly<{ courses: readonly CourseOption[]; initialCourseId?: string }>) {
  const router = useRouter();
  const [courseId, setCourseId] = useState(
    courses.some((course) => course.id === initialCourseId)
      ? initialCourseId!
      : (courses[0]?.id ?? ""),
  );
  const [notice, setNotice] = useState<FormNotice | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const files = data.getAll("assets").filter((value): value is File => value instanceof File);
    if (files.length === 0 || files.some((file) => file.size === 0)) {
      setNotice({ message: "请选择至少一个非空的 PDF 或图片。", tone: "danger" });
      return;
    }
    setSaving(true);
    setNotice({ message: "正在创建私有上传计划…", tone: "warning" });
    try {
      const planResult = (await sendJson(`/api/v1/courses/${courseId}/source-uploads`, "POST", {
        assets: files.map((file, position) => ({
          byteSize: file.size,
          declaredMimeType: file.type,
          originalFilename: file.name,
          position,
        })),
        courseId,
        displayName: String(data.get("displayName") ?? "").trim() || files[0]?.name,
        kind: data.get("kind"),
      })) as Readonly<{ value: UploadPlan }>;
      const plan = planResult.value;
      setNotice({
        message: `上传计划有效至 ${new Date(plan.expiresAt).toLocaleTimeString("zh-CN")}；正在传输原文件…`,
        tone: "warning",
      });
      for (const target of [...plan.targets].sort(
        (left, right) => left.position - right.position,
      )) {
        const file = files[target.position];
        if (file === undefined) throw new Error("上传计划与文件顺序不一致，请重新选择文件。");
        const uploadResponse = await fetch(target.uploadUrl, {
          body: file,
          headers: target.headers,
          method: "PUT",
        });
        if (!uploadResponse.ok)
          throw new Error("原文件传输失败；资料仍保持 uploading，可重新选择文件上传。");
      }
      const completed = (await sendJson(
        `/api/v1/source-documents/${plan.source.id}/complete`,
        "POST",
        { expectedVersion: plan.source.version },
      )) as Readonly<{ value: Readonly<{ id: string }> }>;
      setNotice({
        message: "资料已通过服务端校验；没有自动创建任何正式课程数据。",
        tone: "success",
      });
      form.reset();
      router.push(`/sources?courseId=${courseId}&sourceId=${completed.value.id}&upload=completed`);
      router.refresh();
    } catch (error) {
      setNotice({
        message: error instanceof Error ? error.message : "上传失败，请保留原文件后重试。",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="source-upload-form" onSubmit={submit}>
      <div className="source-upload-title">
        <span className="source-file-glyph" aria-hidden="true">
          <Icon name="plus" />
        </span>
        <span>
          <strong>添加课程原文</strong>
          <small>PDF、PNG、JPEG 或 WebP · 单文件最多 50 MB</small>
        </span>
      </div>
      {notice === null ? null : (
        <div aria-live="polite" className="status-banner" data-tone={notice.tone}>
          {notice.message}
        </div>
      )}
      <div className="field">
        <label htmlFor="source-course">关联课程</label>
        <select
          id="source-course"
          onChange={(event) => setCourseId(event.target.value)}
          value={courseId}
        >
          {courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="source-kind">资料类型</label>
        <select defaultValue="syllabus" id="source-kind" name="kind">
          <option value="syllabus">课程大纲</option>
          <option value="assignment_brief">作业说明</option>
          <option value="screenshot_set">连续截图</option>
          <option value="other">其他原文</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="source-name">资料名称（可选）</label>
        <input
          id="source-name"
          maxLength={200}
          name="displayName"
          placeholder="默认使用首个文件名"
        />
      </div>
      <div className="field">
        <label className="source-file-picker" htmlFor="source-assets">
          <Icon name="file" />
          <span>选择原文件</span>
        </label>
        <input
          accept="application/pdf,image/png,image/jpeg,image/webp"
          className="sr-only"
          id="source-assets"
          multiple
          name="assets"
          required
          type="file"
        />
        <p className="field-hint">
          一组连续截图会保留为同一份 Source Document；文件顺序就是预览页序。
        </p>
      </div>
      <button className="button button-primary" disabled={saving || courseId === ""} type="submit">
        <Icon name="plus" />
        {saving ? "正在上传…" : "创建资料"}
      </button>
    </form>
  );
}
