import type { CommandResult, SourceAssetId, SourceDocumentId, UserScope } from "../shared";
import type {
  InspectedSourceObject,
  SourceDocumentSummary,
  SourceLibraryQuery,
  SourceLibrarySnapshot,
  SourcePreview,
  SourceUploadPlan,
  UploadingSource,
} from "./types";

export type CreateSourceUploadRecord = Readonly<{
  assets: readonly Readonly<{
    declaredByteSize: number;
    declaredMimeType: string;
    id: SourceAssetId;
    originalFilename: string;
    position: number;
    storageKey: string;
  }>[];
  courseId: import("../shared").CourseId;
  displayName: string;
  id: SourceDocumentId;
  kind: import("./types").SourceKind;
  uploadExpiresAt: string;
}>;

export type CompleteSourceUploadRecord = Readonly<{
  assets: readonly Readonly<{
    id: SourceAssetId;
    inspection: InspectedSourceObject;
  }>[];
  contentFingerprint: string;
  expectedVersion: number;
  pageCount: number | null;
  sourceId: SourceDocumentId;
}>;

export type DeletedSourceRecord = Readonly<{
  cleanupPending: boolean;
  storageKeys: readonly string[];
}>;

export interface SourceLibraryRepository {
  completeUpload(
    scope: UserScope,
    input: CompleteSourceUploadRecord,
  ): Promise<CommandResult<SourceDocumentSummary>>;
  createUpload(scope: UserScope, input: CreateSourceUploadRecord): Promise<SourceDocumentSummary>;
  deleteSource(
    scope: UserScope,
    sourceId: SourceDocumentId,
    expectedVersion: number,
  ): Promise<DeletedSourceRecord>;
  markCleanupComplete(scope: UserScope, sourceId: SourceDocumentId): Promise<void>;
  getSource(scope: UserScope, sourceId: SourceDocumentId): Promise<SourceDocumentSummary | null>;
  getPreviewAsset(
    scope: UserScope,
    sourceId: SourceDocumentId,
  ): Promise<Readonly<{
    filename: string;
    mimeType: string;
    storageKey: string;
  }> | null>;
  getUploadingSource(scope: UserScope, sourceId: SourceDocumentId): Promise<UploadingSource | null>;
  listSources(scope: UserScope, query: SourceLibraryQuery): Promise<SourceLibrarySnapshot>;
}

export interface SourceObjectStore {
  createPreviewTarget(
    storageKey: string,
    filename: string,
    mimeType: string,
  ): Promise<SourcePreview>;
  createUploadTarget(
    storageKey: string,
    mimeType: string,
  ): Promise<
    Readonly<{ expiresAt: string; headers: Readonly<Record<string, string>>; url: string }>
  >;
  deleteMany(storageKeys: readonly string[]): Promise<void>;
  hashText(value: string): string;
  inspect(storageKey: string): Promise<InspectedSourceObject>;
}

export interface SourceLibraryCommands {
  beginUpload(
    scope: UserScope,
    input: import("./types").BeginSourceUpload,
  ): Promise<CommandResult<SourceUploadPlan>>;
  completeUpload(
    scope: UserScope,
    input: import("./types").CompleteSourceUpload,
  ): Promise<CommandResult<SourceDocumentSummary>>;
  deleteSource(scope: UserScope, input: import("./types").DeleteSource): Promise<void>;
}

export interface SourceQueries {
  getSourcePreview(scope: UserScope, sourceId: SourceDocumentId): Promise<SourcePreview>;
  listSources(scope: UserScope, query?: SourceLibraryQuery): Promise<SourceLibrarySnapshot>;
}

export type SourceLibrary = SourceLibraryCommands & SourceQueries;
