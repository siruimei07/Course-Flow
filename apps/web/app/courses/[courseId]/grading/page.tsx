import { notFound } from "next/navigation";
import { asCourseId, asGradingSchemeId } from "@courseflow/core";
import Link from "next/link";
import { toJsonValue } from "@courseflow/contracts";
import { getScopedCourseFlow } from "@/composition/runtime";
import { CourseSubnav } from "@/features/courses/course-subnav";
import { GradebookEditor } from "@/features/grading/gradebook-editor";
import { percent } from "@/features/shared/format";
import { PageHeading } from "@/features/shared/page-heading";

export const dynamic = "force-dynamic";

export default async function GradebookPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ new?: string; schemeId?: string }>;
}>) {
  const { courseId } = await params;
  const { academics, planning, scope } = await getScopedCourseFlow();
  const query = await searchParams;
  const creatingAlternative = query.new === "1";
  const selectedSchemeId =
    creatingAlternative || query.schemeId === undefined
      ? undefined
      : asGradingSchemeId(query.schemeId);
  const [course, currentGradebook, schemes, gradeScales] = await Promise.all([
    academics.getCourse(scope, asCourseId(courseId)),
    planning.getGradebook(scope, asCourseId(courseId), selectedSchemeId),
    planning.listGradingSchemes(scope, asCourseId(courseId)),
    planning.listLetterGradeScales(scope),
  ]);
  const gradebook =
    creatingAlternative && currentGradebook !== null
      ? {
          ...currentGradebook,
          components: [],
          currentLetter: null,
          earnedCourseBps: null,
          gradedPortionPercentBps: null,
          gradedWeightBps: 0,
          scheme: null,
          ungradedCount: 0,
          unknownWeightResultCount: 0,
          warnings: [],
        }
      : currentGradebook;
  if (course === null || gradebook === null) notFound();
  const editorPrimary = creatingAlternative
    ? schemes.length === 0
    : (gradebook.scheme?.isPrimary ?? schemes.length === 0);
  const safeGradebook = toJsonValue(gradebook) as unknown as Parameters<
    typeof GradebookEditor
  >[0]["gradebook"];
  const visibleWarnings = gradebook.warnings.filter(
    (warning) => warning.code !== "UNKNOWN_WEIGHT" || gradebook.unknownWeightResultCount === 0,
  );
  return (
    <section className="page">
      <PageHeading context={`${course.course.code} · 手工结果与覆盖权重`} title="Gradebook" />
      <CourseSubnav courseId={courseId} current="grading" />
      {schemes.length === 0 ? null : (
        <nav aria-label="替代评分方案" className="subnav">
          {schemes.map((scheme) => (
            <Link
              aria-current={gradebook.scheme?.id === scheme.id ? "page" : undefined}
              href={`/courses/${courseId}/grading?schemeId=${scheme.id}`}
              key={scheme.id}
            >
              {scheme.name}
              {scheme.isPrimary ? " · 主方案" : ""}
            </Link>
          ))}
          <Link href={`/courses/${courseId}/grading?new=1`}>＋ 新建替代方案</Link>
        </nav>
      )}
      <div className="grade-layout">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>{gradebook.scheme?.name ?? "尚未建立评分方案"}</h2>
              <p className="panel-subtitle">
                不计算 GPA、不预测最终成绩；字母等级仅在用户明确配置等级表时出现
              </p>
            </div>
            {gradebook.currentLetter === null ? null : (
              <span className="status-label">当前 {gradebook.currentLetter}</span>
            )}
          </div>
          <div className="grade-summary-grid">
            <div className="grade-summary">
              <strong>{percent(gradebook.earnedCourseBps)}</strong>
              <span>已获总评百分点</span>
            </div>
            <div className="grade-summary">
              <strong>{percent(gradebook.gradedPortionPercentBps)}</strong>
              <span>已出分部分百分比</span>
            </div>
            <div className="grade-summary">
              <strong>{percent(gradebook.gradedWeightBps)}</strong>
              <span>覆盖总评权重</span>
            </div>
          </div>
          {gradebook.unknownWeightResultCount === 0 ? null : (
            <div className="panel-body">
              <div className="status-banner" data-tone="warning">
                覆盖口径不完整：已录入的 {gradebook.unknownWeightResultCount} 个成绩因权重未知，
                未计入已获总评百分点或覆盖总评权重。填写并保存权重后会按正式结果重新计算。
              </div>
            </div>
          )}
          {visibleWarnings.length ? (
            <div className="panel-body form-stack">
              {visibleWarnings.map((warning, index) => (
                <div className="status-banner" data-tone="warning" key={`${warning.code}-${index}`}>
                  {warning.message}
                </div>
              ))}
            </div>
          ) : null}
          {gradebook.components.length === 0 ? (
            <div className="empty-state">
              <h3>还没有成绩组成</h3>
              <p>在右侧建立方案。权重可暂时留空；未知保持未知。</p>
            </div>
          ) : (
            gradebook.components.map((component) => (
              <article className="grade-component" key={component.id}>
                <div>
                  <span className="course-code-big">
                    {component.weightBps === null
                      ? "权重未知"
                      : `权重 ${percent(component.weightBps)}`}
                  </span>
                  <h3>{component.title}</h3>
                  <p>{component.ruleText || "无附加规则"}</p>
                </div>
                <div className="task-meta">
                  <strong>
                    {component.result === null
                      ? "未出分"
                      : `${Number(component.result.earnedMilli) / 1000} / ${Number(component.result.possibleMilli) / 1000}`}
                  </strong>
                  {component.resultPercentBps === null
                    ? "不纳入当前口径"
                    : component.contributionCourseBps === null
                      ? `本项 ${percent(component.resultPercentBps)} · 贡献待定（权重未知）`
                      : `本项 ${percent(component.resultPercentBps)} · 贡献 ${percent(component.contributionCourseBps)}`}
                </div>
              </article>
            ))
          )}
        </section>
        <aside className="panel grade-editor">
          <div className="panel-header">
            <div>
              <h2>评分方案与结果</h2>
              <p className="panel-subtitle">更新使用 version；冲突保留表单输入</p>
            </div>
          </div>
          <div className="panel-body">
            <GradebookEditor
              courseId={courseId}
              courseVersion={course.course.version}
              gradebook={safeGradebook}
              gradeScales={gradeScales.map((scale) => ({ id: scale.id, name: scale.name }))}
              primary={editorPrimary}
              selectedScaleId={course.course.letterGradeScaleId}
            />
          </div>
        </aside>
      </div>
    </section>
  );
}
