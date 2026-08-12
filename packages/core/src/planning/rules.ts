import {
  asCourseItemId,
  asGradeComponentId,
  asGradeResultId,
  asGradingSchemeId,
  asLetterGradeScaleId,
  asTaskLabelId,
  ianaTimeZone,
  instant,
  localDate,
  validationError,
  type CommandResult,
  type DomainWarning,
} from "../shared";
import type { IdGenerator } from "../runtime";
import type {
  CourseItem,
  CreateCourseItem,
  GradeResult,
  CourseItemTemporal,
  GradebookSnapshot,
  GradingScheme,
  LetterGradeBand,
  LetterGradeScale,
  SaveGradeResult,
  SaveGradingScheme,
  SaveLetterGradeScale,
  SaveTaskLabel,
  TaskLabel,
} from "./types";

export function normalizeLabelName(value: string): Readonly<{
  displayName: string;
  normalizedName: string;
}> {
  const displayName = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (displayName.length === 0 || displayName.length > 80) {
    throw validationError("标签名称长度无效。", [
      { code: "INVALID_LABEL_NAME", message: "标签名称必须为 1–80 个字符。", path: "/displayName" },
    ]);
  }
  return { displayName, normalizedName: displayName.toLocaleLowerCase("und") };
}

function optionalText(value: string | null | undefined, max: number, path: string): string | null {
  if (value === undefined || value === null || value.trim() === "") return null;
  const normalized = value.trim();
  if (normalized.length > max) {
    throw validationError("文本过长。", [
      { code: "INVALID_TEXT_LENGTH", message: `最多 ${max} 个字符。`, path },
    ]);
  }
  return normalized;
}

function requiredText(value: string, max: number, path: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > max) {
    throw validationError("请检查必填文本。", [
      { code: "INVALID_TEXT_LENGTH", message: `长度必须为 1–${max} 个字符。`, path },
    ]);
  }
  return normalized;
}

export function buildTaskLabel(input: SaveTaskLabel, ids: IdGenerator): TaskLabel {
  const name = normalizeLabelName(input.displayName);
  return {
    colorKey: input.colorKey,
    displayName: name.displayName,
    id: input.labelId ?? asTaskLabelId(ids.nextId()),
    normalizedName: name.normalizedName,
    termId: input.termId,
    version: input.expectedVersion === undefined ? 1 : input.expectedVersion + 1,
  };
}

export function buildCourseItem(
  input: CreateCourseItem,
  ids: IdGenerator,
  labels: readonly TaskLabel[],
): CourseItem {
  if (
    input.estimatedMinutes !== undefined &&
    input.estimatedMinutes !== null &&
    (!Number.isInteger(input.estimatedMinutes) || input.estimatedMinutes <= 0)
  ) {
    throw validationError("预计投入必须是正整数分钟。", [
      { code: "INVALID_ESTIMATE", message: "请输入正整数分钟。", path: "/estimatedMinutes" },
    ]);
  }
  if (
    input.progressBps !== undefined &&
    input.progressBps !== null &&
    (!Number.isInteger(input.progressBps) || input.progressBps < 0 || input.progressBps > 10_000)
  ) {
    throw validationError("准备进度必须在 0–100%。", [
      { code: "INVALID_PROGRESS", message: "准备进度必须在 0–100%。", path: "/progressBps" },
    ]);
  }
  return {
    courseId: input.courseId,
    details: optionalText(input.details, 10_000, "/details"),
    estimatedMinutes: input.estimatedMinutes ?? null,
    estimateSource:
      input.estimatedMinutes === undefined || input.estimatedMinutes === null ? null : "user",
    id: asCourseItemId(ids.nextId()),
    kind: input.kind,
    labels,
    progressBps: input.progressBps ?? null,
    state: "planned",
    temporal: parseCourseItemTemporal(input.temporal),
    title: requiredText(input.title, 200, "/title"),
    version: 1,
  };
}

export function buildGradingScheme(
  input: SaveGradingScheme,
  ids: IdGenerator,
  previousResults: ReadonlyMap<string, GradeResult> = new Map(),
): CommandResult<GradingScheme> {
  if (input.components.length === 0) {
    throw validationError("评分方案至少包含一个成绩组成。", [
      { code: "EMPTY_GRADING_SCHEME", message: "请添加至少一个成绩组成。", path: "/components" },
    ]);
  }
  const warnings: DomainWarning[] = [];
  let knownTotal = 0;
  const components = input.components.map((component, index) => {
    if (
      component.weightBps !== undefined &&
      component.weightBps !== null &&
      (!Number.isInteger(component.weightBps) ||
        component.weightBps < 0 ||
        component.weightBps > 10_000)
    ) {
      throw validationError("权重必须在 0–100%。", [
        {
          code: "INVALID_WEIGHT",
          message: "权重必须是 0–100% 的整数基点。",
          path: `/components/${index}/weightBps`,
        },
      ]);
    }
    const weightBps = component.weightBps ?? null;
    knownTotal += weightBps ?? 0;
    const id = component.id ?? asGradeComponentId(ids.nextId());
    return {
      id,
      result: previousResults.get(id) ?? null,
      ruleText: optionalText(component.ruleText, 4_000, `/components/${index}/ruleText`),
      sortOrder: index,
      title: requiredText(component.title, 200, `/components/${index}/title`),
      weightBps,
    };
  });
  if (components.some((component) => component.weightBps === null)) {
    warnings.push({ code: "UNKNOWN_WEIGHT", message: "部分成绩组成权重未知，将保持未知。" });
  }
  if (knownTotal !== 10_000) {
    warnings.push({
      code: "WEIGHT_TOTAL_NOT_100",
      message: `已知权重合计为 ${(knownTotal / 100).toFixed(2)}%，允许保存但请核对。`,
    });
  }
  return {
    value: {
      components,
      conditionText: optionalText(input.conditionText, 4_000, "/conditionText"),
      courseId: input.courseId,
      id: input.schemeId ?? asGradingSchemeId(ids.nextId()),
      isPrimary: input.isPrimary,
      name: requiredText(input.name, 120, "/name"),
      version: input.expectedVersion === undefined ? 1 : input.expectedVersion + 1,
    },
    warnings,
  };
}

export function buildGradeResult(
  input: SaveGradeResult,
  ids: IdGenerator,
  existingId?: GradeResult["id"],
): CommandResult<GradeResult> {
  const earnedMilli = decimalScoreToMilli(input.earned, "/earned");
  const possibleMilli = decimalScoreToMilli(input.possible, "/possible");
  if (possibleMilli <= 0n) {
    throw validationError("满分必须大于 0。", [
      { code: "INVALID_POSSIBLE_SCORE", message: "满分必须大于 0。", path: "/possible" },
    ]);
  }
  return {
    value: {
      earnedMilli,
      gradeComponentId: input.gradeComponentId,
      id: existingId ?? asGradeResultId(ids.nextId()),
      note: optionalText(input.note, 2_000, "/note"),
      possibleMilli,
      version: input.expectedVersion === undefined ? 1 : input.expectedVersion + 1,
    },
    warnings:
      earnedMilli > possibleMilli
        ? [{ code: "BONUS_RESULT", message: "得分高于满分；将按 bonus 保留并计入覆盖口径。" }]
        : [],
  };
}

export function buildLetterGradeScale(
  input: SaveLetterGradeScale,
  ids: IdGenerator,
): LetterGradeScale {
  return {
    bands: validateLetterGradeBands(input.bands),
    id: input.scaleId ?? asLetterGradeScaleId(ids.nextId()),
    name: requiredText(input.name, 120, "/name"),
    version: input.expectedVersion === undefined ? 1 : input.expectedVersion + 1,
  };
}

export function parseCourseItemTemporal(input: {
  kind: "unscheduled" | "date" | "deadline" | "interval";
  note?: string | null;
  date?: string;
  at?: string;
  startsAt?: string;
  endsAt?: string;
  timeZone?: string;
}): CourseItemTemporal {
  const note = input.note?.trim() || null;
  switch (input.kind) {
    case "unscheduled":
      return { kind: "unscheduled", note };
    case "date":
      if (input.date === undefined) {
        throw validationError("纯日期事项缺少日期。", [
          { code: "TEMPORAL_FIELD_REQUIRED", message: "请选择日期。", path: "/temporal/date" },
        ]);
      }
      return { date: localDate(input.date, "/temporal/date"), kind: "date", note };
    case "deadline":
      if (input.at === undefined || input.timeZone === undefined) {
        throw validationError("截止事项缺少确定时刻或时区。", [
          { code: "TEMPORAL_FIELD_REQUIRED", message: "请输入截止时刻与时区。", path: "/temporal" },
        ]);
      }
      return {
        at: instant(input.at, "/temporal/at"),
        kind: "deadline",
        note,
        timeZone: ianaTimeZone(input.timeZone, "/temporal/timeZone"),
      };
    case "interval": {
      if (
        input.startsAt === undefined ||
        input.endsAt === undefined ||
        input.timeZone === undefined
      ) {
        throw validationError("时间区间缺少开始、结束或时区。", [
          { code: "TEMPORAL_FIELD_REQUIRED", message: "请输入完整时间区间。", path: "/temporal" },
        ]);
      }
      const startsAt = instant(input.startsAt, "/temporal/startsAt");
      const endsAt = instant(input.endsAt, "/temporal/endsAt");
      if (Date.parse(endsAt) <= Date.parse(startsAt)) {
        throw validationError("时间区间结束必须晚于开始。", [
          { code: "INVALID_INTERVAL", message: "结束必须晚于开始。", path: "/temporal/endsAt" },
        ]);
      }
      return {
        endsAt,
        kind: "interval",
        note,
        startsAt,
        timeZone: ianaTimeZone(input.timeZone, "/temporal/timeZone"),
      };
    }
  }
}

export function decimalScoreToMilli(value: string, path: string): bigint {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,3})?$/u.test(normalized)) {
    throw validationError("分数必须是非负且最多三位小数。", [
      { code: "INVALID_SCORE", message: "分数必须是非负且最多三位小数。", path },
    ]);
  }
  const [whole = "0", fraction = ""] = normalized.split(".");
  return BigInt(whole) * 1_000n + BigInt(fraction.padEnd(3, "0"));
}

function roundHalfUp(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) throw new RangeError("roundHalfUp denominator must be positive.");
  return Number((numerator * 2n + denominator) / (denominator * 2n));
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

function addFraction(
  left: Readonly<{ denominator: bigint; numerator: bigint }>,
  right: Readonly<{ denominator: bigint; numerator: bigint }>,
) {
  const numerator = left.numerator * right.denominator + right.numerator * left.denominator;
  const denominator = left.denominator * right.denominator;
  const divisor = greatestCommonDivisor(numerator, denominator);
  return { denominator: denominator / divisor, numerator: numerator / divisor };
}

export function validateLetterGradeBands(
  bands: readonly LetterGradeBand[],
): readonly LetterGradeBand[] {
  const expected = ["A", "B", "C", "D", "F"] as const;
  const byLetter = new Map(bands.map((band) => [band.letter, band.minimumPercentBps]));
  if (bands.length !== 5 || expected.some((letter) => !byLetter.has(letter))) {
    throw validationError("等级表必须完整包含 A/B/C/D/F。", [
      { code: "INCOMPLETE_GRADE_SCALE", message: "请提供 A/B/C/D/F 五档边界。", path: "/bands" },
    ]);
  }
  const values = expected.map((letter) => byLetter.get(letter)!);
  if (
    values.some((value) => !Number.isInteger(value) || value < 0 || value > 10_000) ||
    values[4] !== 0 ||
    !(
      values[0]! > values[1]! &&
      values[1]! > values[2]! &&
      values[2]! > values[3]! &&
      values[3]! > values[4]!
    )
  ) {
    throw validationError("等级边界必须严格单调，且 F 从 0% 开始。", [
      {
        code: "INVALID_GRADE_BOUNDARIES",
        message: "要求 A > B > C > D > F=0，且都在 0–100%。",
        path: "/bands",
      },
    ]);
  }
  return expected.map((letter) => ({ letter, minimumPercentBps: byLetter.get(letter)! }));
}

function letterFor(
  percentBps: number | null,
  scale: LetterGradeScale | null,
): GradebookSnapshot["currentLetter"] {
  if (percentBps === null || scale === null) return null;
  return scale.bands.find((band) => percentBps >= band.minimumPercentBps)?.letter ?? null;
}

export function projectGradebook(
  courseId: GradebookSnapshot["courseId"],
  scheme: GradingScheme | null,
  scale: LetterGradeScale | null,
): GradebookSnapshot {
  if (scheme === null) {
    return {
      components: [],
      courseId,
      currentLetter: null,
      earnedCourseBps: null,
      gradedPortionPercentBps: null,
      gradedWeightBps: 0,
      scheme: null,
      unknownWeightResultCount: 0,
      ungradedCount: 0,
      warnings: [],
    };
  }
  let earnedCourse = { denominator: 1n, numerator: 0n };
  let gradedWeightBps = 0;
  let unknownWeightResultCount = 0;
  let ungradedCount = 0;
  const warnings: DomainWarning[] = [];
  const components = scheme.components.map((component) => {
    if (component.result === null) {
      ungradedCount += 1;
      return { ...component, contributionCourseBps: null, resultPercentBps: null };
    }
    const result = component.result;
    const resultPercentBps = roundHalfUp(result.earnedMilli * 10_000n, result.possibleMilli);
    if (result.earnedMilli > result.possibleMilli) {
      warnings.push({
        code: "BONUS_RESULT",
        message: `${component.title} 的得分高于满分，按 bonus 保留。`,
      });
    }
    if (component.weightBps === null) {
      unknownWeightResultCount += 1;
      return { ...component, contributionCourseBps: null, resultPercentBps };
    }
    earnedCourse = addFraction(earnedCourse, {
      denominator: result.possibleMilli,
      numerator: result.earnedMilli * BigInt(component.weightBps),
    });
    gradedWeightBps += component.weightBps;
    return {
      ...component,
      contributionCourseBps: roundHalfUp(
        result.earnedMilli * BigInt(component.weightBps),
        result.possibleMilli,
      ),
      resultPercentBps,
    };
  });
  const knownWeightTotal = scheme.components.reduce(
    (sum, component) => sum + (component.weightBps ?? 0),
    0,
  );
  if (scheme.components.some((component) => component.weightBps === null)) {
    warnings.push({ code: "UNKNOWN_WEIGHT", message: "部分成绩组成权重未知，未纳入覆盖口径。" });
  }
  if (knownWeightTotal !== 10_000) {
    warnings.push({
      code: "WEIGHT_TOTAL_NOT_100",
      message: `已知权重合计为 ${(knownWeightTotal / 100).toFixed(2)}%，允许保存但请核对。`,
    });
  }
  const earnedCourseBps =
    gradedWeightBps === 0 ? null : roundHalfUp(earnedCourse.numerator, earnedCourse.denominator);
  const gradedPortionPercentBps =
    gradedWeightBps === 0
      ? null
      : roundHalfUp(
          earnedCourse.numerator * 10_000n,
          earnedCourse.denominator * BigInt(gradedWeightBps),
        );
  return {
    components,
    courseId: scheme.courseId,
    currentLetter: letterFor(gradedPortionPercentBps, scale),
    earnedCourseBps,
    gradedPortionPercentBps,
    gradedWeightBps,
    scheme: {
      conditionText: scheme.conditionText,
      courseId: scheme.courseId,
      id: scheme.id,
      isPrimary: scheme.isPrimary,
      name: scheme.name,
      version: scheme.version,
    },
    unknownWeightResultCount,
    ungradedCount,
    warnings,
  };
}
