import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "CourseFlow · Import Contract Harness",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        <div className="app-wrap">
          <div className="app-shell">
            <header className="harness-header">
              <div>
                <strong>CourseFlow</strong>
                <span>隔离导入 contract harness</span>
              </div>
              <span>不进入 production web manifest</span>
            </header>
            <main className="app-main" id="main-content" tabIndex={-1}>
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
