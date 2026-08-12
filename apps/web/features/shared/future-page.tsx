import Link from "next/link";
import { PageHeading } from "./page-heading";

export function FuturePage({
  description,
  nextHref,
  nextLabel,
  phase,
  title,
}: Readonly<{
  description: string;
  nextHref: string;
  nextLabel: string;
  phase: string;
  title: string;
}>) {
  return (
    <section className="page future-state">
      <PageHeading context={`${phase} · 真实空状态`} title={title} />
      <section className="panel empty-state">
        <span className="status-label">尚未接入正式投影</span>
        <h2>入口保留，数据不造假</h2>
        <p>{description}</p>
        <Link className="button button-primary" href={nextHref}>
          {nextLabel}
        </Link>
      </section>
    </section>
  );
}
