"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { sendJson, type FormNotice } from "@/features/shared/api-form";
import { Icon } from "@/features/shell/icon";

type ComponentDraft = { id?: string; ruleText: string; title: string; weight: string };
type GradebookData = Readonly<{
  components: readonly Readonly<{
    id: string;
    result: null | Readonly<{ earnedMilli: string; possibleMilli: string; version: number }>;
    ruleText: string | null;
    title: string;
    weightBps: number | null;
  }>[];
  scheme: null | Readonly<{
    conditionText: string | null;
    id: string;
    name: string;
    version: number;
  }>;
}>;

type GradeScaleOption = Readonly<{ id: string; name: string }>;
const gradeLetters = ["A", "B", "C", "D", "F"] as const;

export function GradebookEditor({
  courseId,
  courseVersion,
  gradebook,
  gradeScales,
  primary,
  selectedScaleId,
}: Readonly<{
  courseId: string;
  courseVersion: number;
  gradebook: GradebookData;
  gradeScales: readonly GradeScaleOption[];
  primary: boolean;
  selectedScaleId: string | null;
}>) {
  const router = useRouter();
  const [notice, setNotice] = useState<FormNotice | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(gradebook.scheme?.name ?? "主要评分方案");
  const [conditionText, setConditionText] = useState(gradebook.scheme?.conditionText ?? "");
  const [scaleId, setScaleId] = useState(selectedScaleId ?? "");
  const [scaleName, setScaleName] = useState("");
  const [bandInputs, setBandInputs] = useState<Record<(typeof gradeLetters)[number], string>>({
    A: "",
    B: "",
    C: "",
    D: "",
    F: "0",
  });
  const [components, setComponents] = useState<ComponentDraft[]>(
    gradebook.components.length
      ? gradebook.components.map((component) => ({
          id: component.id,
          ruleText: component.ruleText ?? "",
          title: component.title,
          weight: component.weightBps === null ? "" : String(component.weightBps / 100),
        }))
      : [{ ruleText: "", title: "", weight: "" }],
  );
  function update(index: number, patch: Partial<ComponentDraft>) {
    setComponents((current) =>
      current.map((component, candidate) =>
        candidate === index ? { ...component, ...patch } : component,
      ),
    );
  }
  async function saveScheme(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const body = {
        components: components.map((component) => ({
          id: component.id,
          ruleText: component.ruleText || null,
          title: component.title,
          weightBps: component.weight === "" ? null : Math.round(Number(component.weight) * 100),
        })),
        conditionText: conditionText || null,
        courseId,
        expectedVersion: gradebook.scheme?.version,
        isPrimary: primary,
        name,
        schemeId: gradebook.scheme?.id,
      };
      const url =
        gradebook.scheme === null
          ? `/api/v1/courses/${courseId}/grading-schemes`
          : `/api/v1/courses/${courseId}/grading-schemes/${gradebook.scheme.id}`;
      await sendJson(url, gradebook.scheme === null ? "POST" : "PUT", body);
      setNotice({ message: "评分方案已保存；未知权重保持未知，未出分不会按 0。", tone: "success" });
      router.refresh();
    } catch (error) {
      setNotice({
        message: error instanceof Error ? error.message : "评分方案保存失败。",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  }
  async function saveResult(event: FormEvent<HTMLFormElement>, componentId: string) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    const data = new FormData(event.currentTarget);
    const current = gradebook.components.find((component) => component.id === componentId)?.result;
    try {
      await sendJson(`/api/v1/grade-components/${componentId}/result`, "PUT", {
        earned: data.get("earned"),
        expectedVersion: current?.version,
        gradeComponentId: componentId,
        note: null,
        possible: data.get("possible"),
      });
      setNotice({ message: "手工成绩已保存，覆盖口径已重新计算。", tone: "success" });
      router.refresh();
    } catch (error) {
      setNotice({
        message: error instanceof Error ? error.message : "成绩保存失败。",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  }
  async function removeResult(componentId: string, version: number) {
    setSaving(true);
    setNotice(null);
    try {
      await sendJson(`/api/v1/grade-components/${componentId}/result/delete`, "POST", {
        expectedVersion: version,
      });
      setNotice({ message: "误录结果已删除；该组成恢复为未出分，不会按零分。", tone: "success" });
      router.refresh();
    } catch (error) {
      setNotice({ message: error instanceof Error ? error.message : "删除失败。", tone: "danger" });
    } finally {
      setSaving(false);
    }
  }
  async function createScale() {
    setSaving(true);
    setNotice(null);
    try {
      const result = (await sendJson("/api/v1/profile/letter-grade-scales", "POST", {
        bands: gradeLetters.map((letter) => ({
          letter,
          minimumPercentBps: Math.round(Number(bandInputs[letter]) * 100),
        })),
        name: scaleName,
      })) as { value?: { id?: string } };
      const id = result.value?.id;
      setNotice({
        message: "等级表已保存。请在刷新后显式绑定到课程；不会用于 GPA。",
        tone: "success",
      });
      if (id !== undefined) setScaleId(id);
      router.refresh();
    } catch (error) {
      setNotice({
        message: error instanceof Error ? error.message : "等级表保存失败。",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  }
  async function bindScale() {
    setSaving(true);
    setNotice(null);
    try {
      await sendJson(`/api/v1/courses/${courseId}/letter-grade-scale`, "PUT", {
        courseId,
        expectedVersion: courseVersion,
        letterGradeScaleId: scaleId || null,
      });
      setNotice({
        message: scaleId
          ? "等级表已绑定；当前字母等级只按已出分部分显示。"
          : "等级表已解绑，字母换算恢复未知。",
        tone: "success",
      });
      router.refresh();
    } catch (error) {
      setNotice({ message: error instanceof Error ? error.message : "绑定失败。", tone: "danger" });
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
      <form className="form-stack" onSubmit={saveScheme}>
        <div className="field">
          <label htmlFor="scheme-name">方案名称</label>
          <input
            id="scheme-name"
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
        </div>
        <div className="field">
          <label htmlFor="scheme-condition">方案条件 / 说明（可选）</label>
          <textarea
            id="scheme-condition"
            onChange={(event) => setConditionText(event.target.value)}
            value={conditionText}
          />
        </div>
        {components.map((component, index) => (
          <section className="repeat-card" key={component.id ?? index}>
            <div className="repeat-card-header">
              <h3>成绩组成 {index + 1}</h3>
              <button
                className="button button-ghost"
                disabled={components.length === 1}
                onClick={() =>
                  setComponents((current) => current.filter((_, candidate) => candidate !== index))
                }
                type="button"
              >
                删除
              </button>
            </div>
            <div className="form-grid">
              <div className="field">
                <label htmlFor={`grade-title-${index}`}>名称</label>
                <input
                  id={`grade-title-${index}`}
                  onChange={(event) => update(index, { title: event.target.value })}
                  required
                  value={component.title}
                />
              </div>
              <div className="field">
                <label htmlFor={`grade-weight-${index}`}>权重 %（留空=未知）</label>
                <input
                  id={`grade-weight-${index}`}
                  max="100"
                  min="0"
                  onChange={(event) => update(index, { weight: event.target.value })}
                  step="0.01"
                  type="number"
                  value={component.weight}
                />
              </div>
              <div className="field full">
                <label htmlFor={`grade-rule-${index}`}>复杂规则原文（仅展示）</label>
                <input
                  id={`grade-rule-${index}`}
                  onChange={(event) => update(index, { ruleText: event.target.value })}
                  placeholder="例如：Best 5 of 6；首版不自动执行"
                  value={component.ruleText}
                />
              </div>
            </div>
          </section>
        ))}
        <div className="button-row">
          <button
            className="button button-secondary"
            onClick={() =>
              setComponents((current) => [...current, { ruleText: "", title: "", weight: "" }])
            }
            type="button"
          >
            <Icon name="plus" />
            添加组成
          </button>
          <button className="button button-primary" disabled={saving} type="submit">
            {saving ? "正在保存…" : gradebook.scheme === null ? "创建评分方案" : "更新评分方案"}
          </button>
        </div>
      </form>
      {gradebook.scheme === null ? null : (
        <section className="temporal-fields">
          <h3>手工录入已公布结果</h3>
          <p className="field-hint">
            每个组成首版只录一个老师已公布的汇总结果；复杂规则只展示，不做最终预测。
          </p>
          {gradebook.components.map((component) => (
            <div className="form-stack" key={component.id}>
              <form
                className="grade-result-form"
                onSubmit={(event) => saveResult(event, component.id)}
              >
                <div className="field">
                  <label htmlFor={`earned-${component.id}`}>{component.title} 得分</label>
                  <input
                    defaultValue={
                      component.result === null
                        ? ""
                        : Number(BigInt(component.result.earnedMilli)) / 1000
                    }
                    id={`earned-${component.id}`}
                    name="earned"
                    required
                  />
                </div>
                <span aria-hidden="true">/</span>
                <div className="field">
                  <label htmlFor={`possible-${component.id}`}>满分</label>
                  <input
                    defaultValue={
                      component.result === null
                        ? ""
                        : Number(BigInt(component.result.possibleMilli)) / 1000
                    }
                    id={`possible-${component.id}`}
                    name="possible"
                    required
                  />
                </div>
                <button className="button button-secondary" disabled={saving} type="submit">
                  {component.result === null ? "记录结果" : "覆盖结果"}
                </button>
              </form>
              {component.result === null ? null : (
                <button
                  className="button button-ghost"
                  disabled={saving}
                  onClick={() => removeResult(component.id, component.result!.version)}
                  type="button"
                >
                  删除误录结果，恢复未出分
                </button>
              )}
            </div>
          ))}
        </section>
      )}
      <section className="temporal-fields">
        <h3>A/B/C/D/F 等级表（可选）</h3>
        <p className="field-hint">
          CourseFlow 不提供学校默认值；只有手工确认并绑定后才显示字母等级，不计算 GPA。
        </p>
        <div className="field">
          <label htmlFor="grade-scale">课程等级表</label>
          <select
            id="grade-scale"
            onChange={(event) => setScaleId(event.target.value)}
            value={scaleId}
          >
            <option value="">不启用字母换算</option>
            {gradeScales.map((scale) => (
              <option key={scale.id} value={scale.id}>
                {scale.name}
              </option>
            ))}
          </select>
        </div>
        <div className="temporal-fields">
          <div className="field">
            <label htmlFor="scale-name">新等级表名称</label>
            <input
              id="scale-name"
              onChange={(event) => setScaleName(event.target.value)}
              placeholder="按学校官方规则命名"
              value={scaleName}
            />
          </div>
          <div className="form-grid">
            {gradeLetters.map((letter) => (
              <div className="field" key={letter}>
                <label htmlFor={`band-${letter}`}>{letter} 最低百分比</label>
                <input
                  id={`band-${letter}`}
                  max="100"
                  min="0"
                  onChange={(event) =>
                    setBandInputs((current) => ({ ...current, [letter]: event.target.value }))
                  }
                  required={letter !== "F"}
                  step="0.01"
                  type="number"
                  value={bandInputs[letter]}
                />
              </div>
            ))}
          </div>
          <button
            className="button button-secondary"
            disabled={
              saving ||
              !scaleName.trim() ||
              gradeLetters.some((letter) => bandInputs[letter] === "")
            }
            onClick={createScale}
            type="button"
          >
            确认并保存这组边界
          </button>
        </div>
        <button
          className="button button-primary"
          disabled={saving}
          onClick={bindScale}
          type="button"
        >
          绑定所选等级表
        </button>
      </section>
    </div>
  );
}
