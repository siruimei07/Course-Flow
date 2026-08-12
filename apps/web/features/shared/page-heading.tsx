import type { ReactNode } from "react";

export function PageHeading({
  actions,
  context,
  title,
}: Readonly<{ actions?: ReactNode; context: string; title: string }>) {
  return (
    <div className="page-heading">
      <div className="page-heading-copy">
        <p className="page-context">{context}</p>
        <h1 className="secondary-title">{title}</h1>
      </div>
      {actions === undefined ? null : <div className="heading-actions">{actions}</div>}
    </div>
  );
}
