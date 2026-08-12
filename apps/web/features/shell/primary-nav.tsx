"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icon";

const items: readonly Readonly<{ href: string; icon: IconName; label: string; match: string }>[] = [
  { href: "/dashboard", icon: "home", label: "总览", match: "/dashboard" },
  { href: "/courses", icon: "book", label: "课程", match: "/courses" },
  { href: "/calendar", icon: "calendar", label: "日历", match: "/calendar" },
  { href: "/tasks", icon: "tasks", label: "任务", match: "/tasks" },
  { href: "/sources", icon: "file", label: "资料", match: "/sources" },
  { href: "/insights", icon: "chart", label: "统计", match: "/insights" },
];

export function PrimaryNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="主要导航" className="primary-nav">
      {items.map((item) => (
        <Link
          aria-current={pathname.startsWith(item.match) ? "page" : undefined}
          className="nav-button"
          href={item.href}
          key={item.href}
        >
          <Icon name={item.icon} />
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
