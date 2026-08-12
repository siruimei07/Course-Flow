import { validationError } from "./domain";

export type LocalDate = string;
export type LocalTime = string;
export type Instant = string;
export type IanaTimeZone = string;

const localDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/u;
const localTimePattern = /^(\d{2}):(\d{2})$/u;
const instantOffsetPattern = /(?:Z|[+-]\d{2}:\d{2})$/iu;

type LocalDateParts = Readonly<{ day: number; month: number; year: number }>;
type LocalDateTimeParts = LocalDateParts & Readonly<{ hour: number; minute: number }>;

function parseLocalDateParts(value: string, path = "/date"): LocalDateParts {
  const match = localDatePattern.exec(value);
  if (match === null) {
    throw validationError("日期必须使用 YYYY-MM-DD。", [
      { code: "INVALID_LOCAL_DATE", message: "日期必须使用 YYYY-MM-DD。", path },
    ]);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw validationError("日期不存在。", [
      { code: "INVALID_LOCAL_DATE", message: "日期不存在。", path },
    ]);
  }
  return { day, month, year };
}

function parseLocalTimeParts(value: string, path = "/time") {
  const match = localTimePattern.exec(value);
  if (match === null) {
    throw validationError("时间必须使用 HH:mm。", [
      { code: "INVALID_LOCAL_TIME", message: "时间必须使用 HH:mm。", path },
    ]);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw validationError("本地时间不存在。", [
      { code: "INVALID_LOCAL_TIME", message: "本地时间不存在。", path },
    ]);
  }
  return { hour, minute };
}

export function localDate(value: string, path?: string): LocalDate {
  parseLocalDateParts(value, path);
  return value;
}

export function localTime(value: string, path?: string): LocalTime {
  parseLocalTimeParts(value, path);
  return value;
}

export function instant(value: string, path = "/instant"): Instant {
  if (!instantOffsetPattern.test(value) || Number.isNaN(Date.parse(value))) {
    throw validationError("确定时刻必须包含 UTC offset。", [
      { code: "INVALID_INSTANT", message: "确定时刻必须包含 UTC offset。", path },
    ]);
  }
  return new Date(value).toISOString();
}

export function ianaTimeZone(value: string, path = "/timeZone"): IanaTimeZone {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return value;
  } catch {
    throw validationError("请输入有效的 IANA 时区。", [
      { code: "INVALID_TIME_ZONE", message: "请输入有效的 IANA 时区。", path },
    ]);
  }
}

export function compareLocalDates(left: LocalDate, right: LocalDate): number {
  return left.localeCompare(right);
}

export function compareLocalTimes(left: LocalTime, right: LocalTime): number {
  return left.localeCompare(right);
}

function epochMillisecondsForDate(value: LocalDate): number {
  const { day, month, year } = parseLocalDateParts(value);
  return Date.UTC(year, month - 1, day);
}

export function addLocalDateDays(value: LocalDate, amount: number): LocalDate {
  const probe = new Date(epochMillisecondsForDate(value) + amount * 86_400_000);
  return probe.toISOString().slice(0, 10);
}

export function localDateWeekday(value: LocalDate): number {
  const utcWeekday = new Date(epochMillisecondsForDate(value)).getUTCDay();
  return (utcWeekday + 6) % 7;
}

function partsInTimeZone(at: number, timeZone: IanaTimeZone): LocalDateTimeParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(at);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return {
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
    month: Number(values.get("month")),
    year: Number(values.get("year")),
  };
}

function sameLocalDateTime(left: LocalDateTimeParts, right: LocalDateTimeParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute
  );
}

function timeZoneOffset(at: number, timeZone: IanaTimeZone): number {
  const local = partsInTimeZone(at, timeZone);
  const representedAsUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
  );
  return representedAsUtc - Math.floor(at / 60_000) * 60_000;
}

export type LocalDateTimeResolution =
  | Readonly<{ kind: "exact"; instant: Instant }>
  | Readonly<{ kind: "gap" }>
  | Readonly<{ instants: readonly [Instant, Instant]; kind: "overlap" }>;

/** Resolve a wall-clock value without silently selecting a side of a DST transition. */
export function resolveLocalDateTime(
  dateValue: LocalDate,
  timeValue: LocalTime,
  zoneValue: IanaTimeZone,
): LocalDateTimeResolution {
  const date = parseLocalDateParts(dateValue);
  const time = parseLocalTimeParts(timeValue);
  const zone = ianaTimeZone(zoneValue);
  const target: LocalDateTimeParts = { ...date, ...time };
  const wallClockAsUtc = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute);
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    offsets.add(timeZoneOffset(wallClockAsUtc + hours * 3_600_000, zone));
  }
  const matches = [...offsets]
    .map((offset) => wallClockAsUtc - offset)
    .filter((candidate) => sameLocalDateTime(partsInTimeZone(candidate, zone), target))
    .sort((left, right) => left - right)
    .filter((candidate, index, all) => index === 0 || candidate !== all[index - 1]);
  if (matches.length === 0) return { kind: "gap" };
  if (matches.length > 1) {
    return {
      instants: [new Date(matches[0]!).toISOString(), new Date(matches[1]!).toISOString()],
      kind: "overlap",
    };
  }
  return { instant: new Date(matches[0]!).toISOString(), kind: "exact" };
}
