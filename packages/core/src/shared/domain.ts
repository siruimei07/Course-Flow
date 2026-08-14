export type Brand<TValue, TBrand extends string> = TValue & { readonly __brand: TBrand };

export type UserId = Brand<string, "UserId">;
export type TermId = Brand<string, "TermId">;
export type CalendarExceptionId = Brand<string, "CalendarExceptionId">;
export type CourseId = Brand<string, "CourseId">;
export type MeetingPatternId = Brand<string, "MeetingPatternId">;
export type MeetingExceptionId = Brand<string, "MeetingExceptionId">;
export type CourseItemId = Brand<string, "CourseItemId">;
export type TaskLabelId = Brand<string, "TaskLabelId">;
export type GradingSchemeId = Brand<string, "GradingSchemeId">;
export type GradeComponentId = Brand<string, "GradeComponentId">;
export type GradeResultId = Brand<string, "GradeResultId">;
export type LetterGradeScaleId = Brand<string, "LetterGradeScaleId">;
export type SourceDocumentId = Brand<string, "SourceDocumentId">;
export type SourceAssetId = Brand<string, "SourceAssetId">;

export type UserScope = Readonly<{ userId: UserId }>;

export type DomainIssue = Readonly<{
  code: string;
  message: string;
  path?: string;
}>;

export type DomainWarning = Readonly<{
  code: string;
  message: string;
  path?: string;
}>;

export type DomainErrorCode =
  "AUTH_REQUIRED" | "NOT_FOUND" | "VALIDATION_FAILED" | "VERSION_CONFLICT";

const domainErrorBrand = Symbol.for("courseflow.domain-error");

export class DomainError extends Error {
  readonly [domainErrorBrand] = true;

  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly issues: readonly DomainIssue[] = [],
    readonly latestVersion?: number,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return (
    typeof error === "object" &&
    error !== null &&
    domainErrorBrand in error &&
    (error as Record<PropertyKey, unknown>)[domainErrorBrand] === true
  );
}

export type CommandResult<TValue> = Readonly<{
  value: TValue;
  warnings: readonly DomainWarning[];
}>;

export function asUserId(value: string): UserId {
  return value as UserId;
}

export function asTermId(value: string): TermId {
  return value as TermId;
}

export function asCalendarExceptionId(value: string): CalendarExceptionId {
  return value as CalendarExceptionId;
}

export function asCourseId(value: string): CourseId {
  return value as CourseId;
}

export function asMeetingPatternId(value: string): MeetingPatternId {
  return value as MeetingPatternId;
}

export function asMeetingExceptionId(value: string): MeetingExceptionId {
  return value as MeetingExceptionId;
}

export function asCourseItemId(value: string): CourseItemId {
  return value as CourseItemId;
}

export function asTaskLabelId(value: string): TaskLabelId {
  return value as TaskLabelId;
}

export function asGradingSchemeId(value: string): GradingSchemeId {
  return value as GradingSchemeId;
}

export function asGradeComponentId(value: string): GradeComponentId {
  return value as GradeComponentId;
}

export function asGradeResultId(value: string): GradeResultId {
  return value as GradeResultId;
}

export function asLetterGradeScaleId(value: string): LetterGradeScaleId {
  return value as LetterGradeScaleId;
}

export function asSourceDocumentId(value: string): SourceDocumentId {
  return value as SourceDocumentId;
}

export function asSourceAssetId(value: string): SourceAssetId {
  return value as SourceAssetId;
}

export function validationError(message: string, issues: readonly DomainIssue[]): DomainError {
  return new DomainError("VALIDATION_FAILED", message, issues);
}

export function identityMismatch(path: string): DomainError {
  return validationError("路由身份与提交内容不一致。", [
    { code: "IDENTITY_MISMATCH", message: "请刷新页面后重新提交。", path },
  ]);
}

export function notFound(): DomainError {
  return new DomainError("NOT_FOUND", "The requested private resource was not found.");
}

export function versionConflict(latestVersion?: number): DomainError {
  return new DomainError(
    "VERSION_CONFLICT",
    "The record changed after it was loaded.",
    [],
    latestVersion,
  );
}
