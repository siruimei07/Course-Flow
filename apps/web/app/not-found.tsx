import Link from "next/link";

export default function NotFoundPage() {
  return (
    <section className="page future-state">
      <section className="panel empty-state">
        <span className="status-label">404</span>
        <h1 className="secondary-title">没有找到这条私有记录</h1>
        <p>
          记录可能不存在，也可能不属于当前用户；CourseFlow 不区分这两种情况，以避免泄露私有 ID。
        </p>
        <Link className="button button-primary" href="/dashboard">
          返回总览
        </Link>
      </section>
    </section>
  );
}
