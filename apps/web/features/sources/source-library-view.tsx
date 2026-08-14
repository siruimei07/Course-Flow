import Link from "next/link";
import type { SourceDocumentSummary } from "@courseflow/core";
import { Icon } from "../shell/icon";
import { PageHeading } from "../shared/page-heading";
import { SourceDeleteButton } from "./source-delete-button";
import { SourceUploadForm } from "./source-upload-form";

const sourceKindCopy = {
  assignment_brief: "作业说明",
  other: "其他原文",
  screenshot_set: "连续截图",
  syllabus: "课程大纲",
} as const;

const sourceStatusCopy = {
  ready: "可预览",
  rejected: "校验失败",
  uploading: "上传未完成",
} as const;

export type SourceLibraryCourse = Readonly<{
  colorKey: string;
  code: string;
  id: string;
  title: string;
}>;

export type SourceLibraryParameters = Readonly<{
  courseId?: string;
  q?: string;
  sourceId?: string;
  status?: string;
}>;

function sourcesHref(basePath: string, parameters: SourceLibraryParameters) {
  const query = new URLSearchParams();
  if (parameters.courseId) query.set("courseId", parameters.courseId);
  if (parameters.q) query.set("q", parameters.q);
  if (parameters.sourceId) query.set("sourceId", parameters.sourceId);
  if (parameters.status) query.set("status", parameters.status);
  const value = query.toString();
  return value === "" ? basePath : `${basePath}?${value}`;
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function SourceLibraryView({
  allSources,
  basePath = "/sources",
  courses,
  filteredSources,
  parameters,
  selected,
  uploadCompleted = false,
}: Readonly<{
  allSources: readonly SourceDocumentSummary[];
  basePath?: string;
  courses: readonly SourceLibraryCourse[];
  filteredSources: readonly SourceDocumentSummary[];
  parameters: SourceLibraryParameters;
  selected: SourceDocumentSummary | null;
  uploadCompleted?: boolean;
}>) {
  const courseCounts = new Map<string, number>();
  allSources.forEach((source) => {
    courseCounts.set(source.courseId, (courseCounts.get(source.courseId) ?? 0) + 1);
  });
  const uploadCourseId = parameters.courseId ?? selected?.courseId;

  return (
    <section className="page source-page">
      <PageHeading context="保留课程原文；完成上传不会自动写入正式课程记录" title="资料库" />
      {uploadCompleted ? (
        <div className="status-banner" data-tone="success" role="status">
          资料已通过服务端校验；没有自动创建任何正式课程数据。
        </div>
      ) : null}
      {courses.length === 0 ? (
        <section className="panel empty-state">
          <h2>先添加课程</h2>
          <p>每份 Source Document 必须属于当前用户的一门真实课程。</p>
          <Link className="button button-primary" href="/courses/new">
            添加课程
          </Link>
        </section>
      ) : (
        <div className="source-library-workspace">
          <aside className="panel source-library-sidebar">
            <div className="source-sidebar-head">
              <h2>课程范围</h2>
              <p>{allSources.length} 份未删除资料</p>
            </div>
            <nav aria-label="按课程筛选资料" className="source-course-nav">
              <Link
                aria-current={parameters.courseId === undefined ? "page" : undefined}
                href={sourcesHref(basePath, {
                  ...(parameters.q === undefined ? {} : { q: parameters.q }),
                  ...(parameters.status === undefined ? {} : { status: parameters.status }),
                })}
              >
                <Icon name="file" />
                <span>全部资料</span>
                <small>{allSources.length}</small>
              </Link>
              {courses.map((course) => (
                <Link
                  aria-current={parameters.courseId === course.id ? "page" : undefined}
                  href={sourcesHref(basePath, {
                    courseId: course.id,
                    ...(parameters.q === undefined ? {} : { q: parameters.q }),
                    ...(parameters.status === undefined ? {} : { status: parameters.status }),
                  })}
                  key={course.id}
                >
                  <span className="source-course-dot" data-course={course.colorKey} />
                  <span>{course.code}</span>
                  <small>{courseCounts.get(course.id) ?? 0}</small>
                </Link>
              ))}
            </nav>
            <div className="source-sidebar-note">
              <strong>先确认，再写入</strong>
              <p>Source 是原文容器，不是计划。只有你明确提交手工表单才会创建正式数据。</p>
            </div>
          </aside>

          <section className="panel source-library-browser" aria-label="资料列表">
            <form action={basePath} className="source-browser-toolbar" role="search">
              {parameters.courseId === undefined ? null : (
                <input name="courseId" type="hidden" value={parameters.courseId} />
              )}
              <label className="source-search" htmlFor="source-search">
                <Icon name="file" />
                <span className="sr-only">搜索资料名称或课程代码</span>
                <input
                  defaultValue={parameters.q}
                  id="source-search"
                  name="q"
                  placeholder="搜索资料名称或课程代码"
                />
              </label>
              <label className="source-status-filter" htmlFor="source-status-filter">
                <span className="sr-only">资料状态</span>
                <select
                  defaultValue={parameters.status ?? ""}
                  id="source-status-filter"
                  name="status"
                >
                  <option value="">全部状态</option>
                  <option value="ready">可预览</option>
                  <option value="uploading">上传未完成</option>
                  <option value="rejected">校验失败</option>
                </select>
              </label>
              <button className="button button-dark" type="submit">
                筛选
              </button>
            </form>
            <div className="source-browser-summary">
              <div>
                <strong>{parameters.courseId === undefined ? "全部资料" : "课程资料"}</strong>
                <span>{filteredSources.length} 个结果</span>
              </div>
              <a className="text-link" href="#source-upload">
                添加原文
              </a>
            </div>
            {filteredSources.length === 0 ? (
              <div className="source-library-empty">
                <span className="source-file-glyph" aria-hidden="true">
                  <Icon name="file" />
                </span>
                <h3>这个范围还没有资料</h3>
                <p>添加原文后，它会先经过文件校验；不会自动生成课程、事项或成绩。</p>
                <a className="button button-primary" href="#source-upload">
                  添加课程原文
                </a>
              </div>
            ) : (
              <div className="source-table-scroll" tabIndex={0} aria-label="可滚动的资料表格">
                <table className="source-table">
                  <thead>
                    <tr>
                      <th scope="col">资料</th>
                      <th scope="col">课程</th>
                      <th scope="col">大小</th>
                      <th scope="col">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSources.map((source) => {
                      const href = sourcesHref(basePath, { ...parameters, sourceId: source.id });
                      const byteSize = source.assets.reduce(
                        (total, asset) => total + asset.byteSize,
                        0,
                      );
                      return (
                        <tr aria-selected={selected?.id === source.id} key={source.id}>
                          <td>
                            <Link className="source-file-cell" href={href}>
                              <span className="source-file-glyph" aria-hidden="true">
                                <Icon name="file" />
                              </span>
                              <span>
                                <strong>{source.displayName}</strong>
                                <small>
                                  {sourceKindCopy[source.kind]} · {source.assets.length} 个文件
                                </small>
                              </span>
                            </Link>
                          </td>
                          <td>{source.courseCode}</td>
                          <td>{formatBytes(byteSize)}</td>
                          <td>
                            <span className="source-state" data-state={source.status}>
                              {sourceStatusCopy[source.status as keyof typeof sourceStatusCopy] ??
                                source.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <aside className="panel source-library-inspector" aria-label="资料详情">
            {selected === null ? (
              <div className="source-inspector-empty">
                <Icon name="file" />
                <h2>选择一份资料</h2>
                <p>这里会显示原文件、校验状态与手工写入目标。</p>
              </div>
            ) : (
              <>
                <header className="source-inspector-head">
                  <span className="source-file-glyph" aria-hidden="true">
                    <Icon name="file" />
                  </span>
                  <span>
                    <strong>{selected.displayName}</strong>
                    <small>
                      {selected.courseCode} · {sourceKindCopy[selected.kind]}
                    </small>
                  </span>
                </header>
                <div className="source-inspector-scroll">
                  {selected.status === "ready" ? (
                    <a
                      className="button button-dark source-preview-button"
                      href={`/api/v1/source-documents/${selected.id}/preview`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      查看原始文件
                      <Icon name="arrow" />
                    </a>
                  ) : (
                    <div className="status-banner" data-tone="danger" role="status">
                      <strong>
                        {sourceStatusCopy[selected.status as keyof typeof sourceStatusCopy]}
                      </strong>
                      <br />
                      原文件未进入 ready；正式数据没有变化。请重新添加原文件。
                    </div>
                  )}
                  <dl className="source-detail-list">
                    <div>
                      <dt>写入状态</dt>
                      <dd>仅 Source，尚未写入正式课程数据</dd>
                    </div>
                    <div>
                      <dt>原始文件</dt>
                      <dd>{selected.assets.map((asset) => asset.originalFilename).join("、")}</dd>
                    </div>
                    <div>
                      <dt>内容指纹</dt>
                      <dd>{selected.contentFingerprint?.slice(0, 12) ?? "校验完成后生成"}</dd>
                    </div>
                    <div>
                      <dt>页面</dt>
                      <dd>{selected.pageCount === null ? "未知" : `${selected.pageCount} 页`}</dd>
                    </div>
                    <div>
                      <dt>版本</dt>
                      <dd>v{selected.version}</dd>
                    </div>
                  </dl>
                  <section className="source-manual-card">
                    <span className="meta-label">写入目标</span>
                    <h3>从原文手工录入</h3>
                    <p>打开既有表单后由你输入并保存；Source 内容不会预填或静默提交。</p>
                    <div className="source-manual-actions">
                      <Link
                        className="button button-primary"
                        href={`/tasks?courseId=${selected.courseId}&sourceId=${selected.id}`}
                      >
                        课程事项
                      </Link>
                      <Link
                        className="button button-secondary"
                        href={`/courses/${selected.courseId}/meetings?sourceId=${selected.id}`}
                      >
                        课节
                      </Link>
                      <Link
                        className="button button-secondary"
                        href={`/courses/${selected.courseId}/grading?sourceId=${selected.id}`}
                      >
                        评分方案
                      </Link>
                    </div>
                  </section>
                  <div className="source-contract-note">
                    <strong>手工核对</strong>
                    <p>原文与表单保持分离；你可以随时返回预览核对页码和内容。</p>
                  </div>
                  <SourceDeleteButton sourceId={selected.id} version={selected.version} />
                </div>
              </>
            )}
            <div className="source-upload-drawer" id="source-upload">
              <SourceUploadForm
                courses={courses.map((course) => ({
                  id: course.id,
                  label: `${course.code} · ${course.title}`,
                }))}
                {...(uploadCourseId === undefined ? {} : { initialCourseId: uploadCourseId })}
              />
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
