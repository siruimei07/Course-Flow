import type { CourseId, SourceAssetId, SourceDocumentId } from "../shared";

export const sourceKinds = ["syllabus", "assignment_brief", "screenshot_set", "other"] as const;
export type SourceKind = (typeof sourceKinds)[number];

export const sourceStatuses = ["uploading", "ready", "rejected", "deleted"] as const;
export type SourceStatus = (typeof sourceStatuses)[number];

export type SourceAssetSummary = Readonly<{
  byteSize: number;
  height: number | null;
  id: SourceAssetId;
  originalFilename: string;
  position: number;
  sha256: string | null;
  sniffedMimeType: string | null;
  width: number | null;
}>;

export type SourceDocumentSummary = Readonly<{
  assets: readonly SourceAssetSummary[];
  contentFingerprint: string | null;
  courseCode: string;
  courseId: CourseId;
  courseTitle: string;
  createdAt: string;
  deletedAt: string | null;
  displayName: string;
  id: SourceDocumentId;
  kind: SourceKind;
  pageCount: number | null;
  status: SourceStatus;
  version: number;
}>;

export type SourceLibraryQuery = Readonly<{
  courseId?: CourseId;
  search?: string;
  status?: Exclude<SourceStatus, "deleted">;
}>;

export type SourceLibrarySnapshot = Readonly<{
  sources: readonly SourceDocumentSummary[];
  total: number;
}>;

export type BeginSourceUpload = Readonly<{
  assets: readonly Readonly<{
    byteSize: number;
    declaredMimeType: string;
    originalFilename: string;
    position: number;
  }>[];
  courseId: CourseId;
  displayName: string;
  kind: SourceKind;
}>;

export type UploadTarget = Readonly<{
  assetId: SourceAssetId;
  headers: Readonly<Record<string, string>>;
  method: "PUT";
  position: number;
  uploadUrl: string;
}>;

export type SourceUploadPlan = Readonly<{
  expiresAt: string;
  source: SourceDocumentSummary;
  targets: readonly UploadTarget[];
}>;

export type CompleteSourceUpload = Readonly<{
  expectedVersion: number;
  sourceId: SourceDocumentId;
}>;

export type DeleteSource = Readonly<{
  expectedVersion: number;
  sourceId: SourceDocumentId;
}>;

export type SourcePreview = Readonly<{
  expiresAt: string;
  filename: string;
  mimeType: string;
  url: string;
}>;

export type UploadingSourceAsset = Readonly<{
  declaredByteSize: number;
  declaredMimeType: string;
  id: SourceAssetId;
  originalFilename: string;
  position: number;
  storageKey: string;
}>;

export type UploadingSource = Readonly<{
  assets: readonly UploadingSourceAsset[];
  document: SourceDocumentSummary;
  uploadExpiresAt: string;
}>;

export type InspectedSourceObject = Readonly<{
  byteSize: number;
  height: number | null;
  pageCount: number | null;
  sha256: string;
  sniffedMimeType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
  width: number | null;
}>;
