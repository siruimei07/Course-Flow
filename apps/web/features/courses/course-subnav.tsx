import Link from "next/link";

export function CourseSubnav({
  courseId,
  current,
}: Readonly<{ courseId: string; current: "overview" | "timeline" | "grading" }>) {
  const items = [
    { key: "overview", href: `/courses?courseId=${courseId}`, label: "课程总览" },
    { key: "timeline", href: `/courses/${courseId}/timeline`, label: "Timeline" },
    { key: "grading", href: `/courses/${courseId}/grading`, label: "Gradebook" },
  ] as const;
  return (
    <nav aria-label="课程支持页面" className="subnav">
      {items.map((item) => (
        <Link
          aria-current={item.key === current ? "page" : undefined}
          href={item.href}
          key={item.key}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
