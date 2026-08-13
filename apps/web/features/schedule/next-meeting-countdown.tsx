"use client";

import { useEffect, useState } from "react";

function label(startsAt: string, endsAt: string, now: number): string {
  if (now >= Date.parse(startsAt) && now < Date.parse(endsAt)) {
    return (
      "进行中 · 距结束 " + Math.max(1, Math.ceil((Date.parse(endsAt) - now) / 60_000)) + " 分钟"
    );
  }
  const minutes = Math.max(0, Math.ceil((Date.parse(startsAt) - now) / 60_000));
  if (minutes < 60) return minutes + " 分钟后开始";
  if (minutes < 1_440) return Math.floor(minutes / 60) + " 小时 " + (minutes % 60) + " 分钟后开始";
  return Math.ceil(minutes / 1_440) + " 天后开始";
}

export function NextMeetingCountdown({
  endsAt,
  generatedAt,
  startsAt,
}: Readonly<{ endsAt: string; generatedAt: string; startsAt: string }>) {
  const [now, setNow] = useState(() => Date.parse(generatedAt));
  useEffect(() => {
    const timer = window.setInterval(() => setNow((current) => current + 60_000), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return <span suppressHydrationWarning>{label(startsAt, endsAt, now)}</span>;
}
