import type { Clock, IdGenerator } from "../runtime";
import {
  asSourceAssetId,
  asSourceDocumentId,
  notFound,
  validationError,
  type CommandResult,
  type SourceDocumentId,
  type UserScope,
} from "../shared";
import type { SourceLibrary, SourceLibraryRepository, SourceObjectStore } from "./repository";
import type {
  BeginSourceUpload,
  CompleteSourceUpload,
  DeleteSource,
  SourceDocumentSummary,
  SourceLibraryQuery,
  SourceLibrarySnapshot,
  SourcePreview,
  SourceUploadPlan,
} from "./types";

const allowedMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const maximumAssetBytes = 50 * 1024 * 1024;
const maximumDocumentBytes = 200 * 1024 * 1024;
const maximumAssets = 24;
const uploadLifetimeMs = 15 * 60 * 1_000;

type SourceLibraryDependencies = Readonly<{
  clock: Clock;
  ids: IdGenerator;
  objectStore: SourceObjectStore;
  repository: SourceLibraryRepository;
}>;

function validateBeginUpload(input: BeginSourceUpload): void {
  const issues: { code: string; message: string; path: string }[] = [];
  if (input.displayName.trim().length === 0 || input.displayName.trim().length > 200) {
    issues.push({
      code: "INVALID_DISPLAY_NAME",
      message: "资料名称应为 1–200 个字符。",
      path: "/displayName",
    });
  }
  if (input.assets.length === 0 || input.assets.length > maximumAssets) {
    issues.push({
      code: "INVALID_ASSET_COUNT",
      message: `每份资料需要 1–${maximumAssets} 个文件。`,
      path: "/assets",
    });
  }
  const positions = new Set<number>();
  let totalBytes = 0;
  input.assets.forEach((asset, index) => {
    totalBytes += asset.byteSize;
    if (
      !Number.isSafeInteger(asset.position) ||
      asset.position < 0 ||
      positions.has(asset.position)
    ) {
      issues.push({
        code: "INVALID_ASSET_POSITION",
        message: "文件顺序必须唯一且从 0 开始。",
        path: `/assets/${index}/position`,
      });
    }
    positions.add(asset.position);
    if (asset.originalFilename.trim().length === 0 || asset.originalFilename.length > 255) {
      issues.push({
        code: "INVALID_FILENAME",
        message: "文件名应为 1–255 个字符。",
        path: `/assets/${index}/originalFilename`,
      });
    }
    if (!allowedMimeTypes.has(asset.declaredMimeType)) {
      issues.push({
        code: "UNSUPPORTED_MEDIA_TYPE",
        message: "只接受 PDF、PNG、JPEG 或 WebP。",
        path: `/assets/${index}/declaredMimeType`,
      });
    }
    if (
      !Number.isSafeInteger(asset.byteSize) ||
      asset.byteSize < 1 ||
      asset.byteSize > maximumAssetBytes
    ) {
      issues.push({
        code: "INVALID_FILE_SIZE",
        message: "单个文件必须小于等于 50 MB。",
        path: `/assets/${index}/byteSize`,
      });
    }
  });
  if (totalBytes > maximumDocumentBytes) {
    issues.push({
      code: "DOCUMENT_TOO_LARGE",
      message: "整份资料必须小于等于 200 MB。",
      path: "/assets",
    });
  }
  for (let expected = 0; expected < input.assets.length; expected += 1) {
    if (!positions.has(expected)) {
      issues.push({
        code: "NON_CONTIGUOUS_ASSET_POSITIONS",
        message: "文件顺序必须从 0 开始且连续。",
        path: "/assets",
      });
      break;
    }
  }
  if (issues.length > 0) throw validationError("无法开始上传。", issues);
}

function validateInspection(
  asset: import("./types").UploadingSourceAsset,
  inspection: import("./types").InspectedSourceObject,
): void {
  const issues: { code: string; message: string; path: string }[] = [];
  if (inspection.byteSize !== asset.declaredByteSize) {
    issues.push({
      code: "FILE_SIZE_MISMATCH",
      message: "上传文件大小与上传计划不一致。",
      path: `/assets/${asset.position}/byteSize`,
    });
  }
  if (!allowedMimeTypes.has(inspection.sniffedMimeType)) {
    issues.push({
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "文件内容不是受支持的 PDF 或图片。",
      path: `/assets/${asset.position}`,
    });
  }
  if (inspection.sniffedMimeType !== asset.declaredMimeType) {
    issues.push({
      code: "MIME_TYPE_MISMATCH",
      message: "文件内容类型与上传计划声明不一致。",
      path: `/assets/${asset.position}/declaredMimeType`,
    });
  }
  if (inspection.byteSize > maximumAssetBytes) {
    issues.push({
      code: "FILE_TOO_LARGE",
      message: "服务端检测到文件超过 50 MB。",
      path: `/assets/${asset.position}`,
    });
  }
  if (issues.length > 0) throw validationError("上传文件校验失败。", issues);
}

export function createSourceLibrary(dependencies: SourceLibraryDependencies): SourceLibrary {
  const { clock, ids, objectStore, repository } = dependencies;

  async function beginUpload(
    scope: UserScope,
    input: BeginSourceUpload,
  ): Promise<CommandResult<SourceUploadPlan>> {
    validateBeginUpload(input);
    const sourceId = asSourceDocumentId(ids.nextId());
    const uploadExpiresAt = new Date(clock.now().getTime() + uploadLifetimeMs).toISOString();
    const assets = [...input.assets]
      .sort((left, right) => left.position - right.position)
      .map((asset) => {
        const id = asSourceAssetId(ids.nextId());
        return {
          declaredByteSize: asset.byteSize,
          declaredMimeType: asset.declaredMimeType,
          id,
          originalFilename: asset.originalFilename.trim(),
          position: asset.position,
          storageKey: `source/${sourceId}/${id}`,
        };
      });
    const source = await repository.createUpload(scope, {
      assets,
      courseId: input.courseId,
      displayName: input.displayName.trim(),
      id: sourceId,
      kind: input.kind,
      uploadExpiresAt,
    });
    const targets = await Promise.all(
      assets.map(async (asset) => {
        const target = await objectStore.createUploadTarget(
          asset.storageKey,
          asset.declaredMimeType,
        );
        return {
          assetId: asset.id,
          headers: target.headers,
          method: "PUT" as const,
          position: asset.position,
          uploadUrl: target.url,
        };
      }),
    );
    return { value: { expiresAt: uploadExpiresAt, source, targets }, warnings: [] };
  }

  async function completeUpload(
    scope: UserScope,
    input: CompleteSourceUpload,
  ): Promise<CommandResult<SourceDocumentSummary>> {
    const upload = await repository.getUploadingSource(scope, input.sourceId);
    if (upload === null) {
      const existing = await repository.getSource(scope, input.sourceId);
      if (existing?.status === "ready" && existing.version === input.expectedVersion + 1) {
        return { value: existing, warnings: [] };
      }
      throw notFound();
    }
    if (Date.parse(upload.uploadExpiresAt) <= clock.now().getTime()) {
      throw validationError("上传计划已过期。", [
        {
          code: "UPLOAD_EXPIRED",
          message: "请重新选择文件并创建新的上传计划。",
          path: "/sourceId",
        },
      ]);
    }
    const inspected = await Promise.all(
      upload.assets.map(async (asset) => {
        const inspection = await objectStore.inspect(asset.storageKey);
        validateInspection(asset, inspection);
        return { id: asset.id, inspection };
      }),
    );
    const contentFingerprint = objectStore.hashText(
      inspected.map(({ inspection }) => inspection.sha256).join(":"),
    );
    const pageCounts = inspected.map(({ inspection }) => inspection.pageCount);
    const pageCount = pageCounts.every((value) => value !== null)
      ? pageCounts.reduce<number>((total, value) => total + (value ?? 0), 0)
      : null;
    return repository.completeUpload(scope, {
      assets: inspected,
      contentFingerprint,
      expectedVersion: input.expectedVersion,
      pageCount,
      sourceId: input.sourceId,
    });
  }

  async function deleteSource(scope: UserScope, input: DeleteSource): Promise<void> {
    const deleted = await repository.deleteSource(scope, input.sourceId, input.expectedVersion);
    await objectStore.deleteMany(deleted.storageKeys);
    if (deleted.cleanupPending) await repository.markCleanupComplete(scope, input.sourceId);
  }

  async function getSourcePreview(
    scope: UserScope,
    sourceId: SourceDocumentId,
  ): Promise<SourcePreview> {
    const previewAsset = await repository.getPreviewAsset(scope, sourceId);
    if (previewAsset === null) throw notFound();
    return objectStore.createPreviewTarget(
      previewAsset.storageKey,
      previewAsset.filename,
      previewAsset.mimeType,
    );
  }

  function listSources(
    scope: UserScope,
    query: SourceLibraryQuery = {},
  ): Promise<SourceLibrarySnapshot> {
    return repository.listSources(scope, query);
  }

  return { beginUpload, completeUpload, deleteSource, getSourcePreview, listSources };
}
