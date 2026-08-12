import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./icon";
import { PrimaryNav } from "./primary-nav";
import { ThemeToggle } from "./theme-toggle";

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <>
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <div className="app-wrap">
        <div className="app-shell">
          <header className="app-header">
            <Link aria-label="CourseFlow 总览" className="brand" href="/dashboard">
              <span className="brand-mark" aria-hidden="true">
                <span />
              </span>
              <span>CourseFlow</span>
            </Link>
            <PrimaryNav />
            <div className="header-tools">
              <ThemeToggle />
              <Link aria-label="学期设置" className="icon-button" href="/terms">
                <Icon name="settings" />
              </Link>
              <span aria-label="当前开发身份" className="profile-button" title="当前开发身份">
                CF
              </span>
            </div>
          </header>
          <main className="app-main" id="main-content" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
