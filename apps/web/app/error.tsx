"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  useEffect(() => {
    console.error("courseflow_route_error", error.digest ?? "no-digest");
  }, [error]);
  return (
    <section className="page future-state">
      <section className="panel empty-state">
        <span className="status-label" data-tone="warning">
          页面暂时不可用
        </span>
        <h1 className="secondary-title">无法读取 CourseFlow 数据</h1>
        <p>请确认 PostgreSQL 已启动且 migration 已完成。内部错误详情不会显示在页面上。</p>
        {error.digest === undefined ? null : (
          <p className="field-hint">Request digest：{error.digest}</p>
        )}
        <button className="button button-primary" onClick={reset} type="button">
          重试
        </button>
      </section>
    </section>
  );
}
