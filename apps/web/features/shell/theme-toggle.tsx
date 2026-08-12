"use client";

import { useEffect, useSyncExternalStore } from "react";

const themeEvent = "courseflow-theme-change";

function subscribe(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(themeEvent, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(themeEvent, onStoreChange);
  };
}

function clientSnapshot() {
  return window.localStorage.getItem("courseflow-theme") === "dark";
}

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, clientSnapshot, () => false);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  function toggle() {
    const next = !dark;
    document.documentElement.dataset.theme = next ? "dark" : "light";
    window.localStorage.setItem("courseflow-theme", next ? "dark" : "light");
    window.dispatchEvent(new Event(themeEvent));
  }
  return (
    <button
      aria-label={dark ? "切换为浅色主题" : "切换为深色主题"}
      aria-pressed={dark}
      className="theme-toggle"
      onClick={toggle}
      type="button"
    >
      <span aria-hidden="true" className="theme-toggle-track">
        <span className="theme-toggle-thumb">{dark ? "☾" : "☀"}</span>
      </span>
    </button>
  );
}
