export default function HomePage() {
  return (
    <main className="p0-shell">
      <section aria-labelledby="courseflow-title" className="p0-panel">
        <p className="p0-eyebrow">仓库与质量骨架</p>
        <h1 id="courseflow-title">CourseFlow</h1>
        <p>
          应用骨架已经可以运行。课程、课表、课程事项与资料审核等正式功能将在后续阶段接入；当前页面不展示示例课程数据。
        </p>
        <a className="p0-health-link" href="/api/health">
          查看 Web 健康状态
        </a>
      </section>
    </main>
  );
}
