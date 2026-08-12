import type { CourseItem, MeetingKind } from "@courseflow/core";

export const meetingKindLabels: Readonly<Record<MeetingKind, string>> = {
  lecture: "Lecture",
  tutorial: "Tutorial (TUT)",
  practical: "Practical (PRA)",
  other: "Other",
};

export const courseItemKindLabels: Readonly<Record<CourseItem["kind"], string>> = {
  assignment: "作业",
  exam: "考试",
  quiz: "测验",
  lab: "实验",
  project: "项目",
  presentation: "展示",
  reading: "阅读",
  milestone: "里程碑",
  other: "其他",
};

export function formatTemporal(temporal: CourseItem["temporal"]): string {
  switch (temporal.kind) {
    case "unscheduled":
      return temporal.note === null ? "TBA · 未排期" : `TBA · ${temporal.note}`;
    case "date":
      return `${temporal.date} · 全天日期`;
    case "deadline":
      return `${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: temporal.timeZone }).format(new Date(temporal.at))} · 截止`;
    case "interval":
      return `${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: temporal.timeZone }).format(new Date(temporal.startsAt))}–${new Intl.DateTimeFormat("zh-CN", { timeStyle: "short", timeZone: temporal.timeZone }).format(new Date(temporal.endsAt))} · 时间区间`;
  }
}

export function percent(bps: number | null): string {
  return bps === null ? "未知" : `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

export function courseColor(key: string): string {
  return `var(--course-${key})`;
}
