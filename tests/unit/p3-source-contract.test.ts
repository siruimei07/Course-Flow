import { describe, expect, it } from "vitest";
import {
  asCourseId,
  asSourceDocumentId,
  asUserId,
  createSourceLibrary,
  type CommandResult,
  type CompleteSourceUploadRecord,
  type CreateSourceUploadRecord,
  type DeletedSourceRecord,
  type InspectedSourceObject,
  type SourceDocumentSummary,
  type SourceLibraryRepository,
  type SourceLibrarySnapshot,
  type SourceObjectStore,
  type SourcePreview,
  type UploadingSource,
  type UserScope,
} from "@courseflow/core";
import { FixedClock, SequenceIdGenerator } from "@courseflow/test-support";

const scope: UserScope = { userId: asUserId("00000000-0000-4000-8000-000000000001") };
const courseId = asCourseId("10000000-0000-4000-8000-000000000001");

class MemorySourceRepository implements SourceLibraryRepository {
  cleanupCompleteWrites = 0;
  completionWrites = 0;
  source: SourceDocumentSummary | null = null;
  upload: UploadingSource | null = null;

  async createUpload(_scope: UserScope, input: CreateSourceUploadRecord) {
    this.source = {
      assets: input.assets.map((asset) => ({
        byteSize: asset.declaredByteSize,
        height: null,
        id: asset.id,
        originalFilename: asset.originalFilename,
        position: asset.position,
        sha256: null,
        sniffedMimeType: null,
        width: null,
      })),
      contentFingerprint: null,
      courseCode: "CSC258H5",
      courseId,
      courseTitle: "Computer Organization",
      createdAt: "2026-08-13T00:00:00.000Z",
      deletedAt: null,
      displayName: input.displayName,
      id: input.id,
      kind: input.kind,
      pageCount: null,
      status: "uploading",
      version: 1,
    };
    this.upload = {
      assets: input.assets,
      document: this.source,
      uploadExpiresAt: input.uploadExpiresAt,
    };
    return this.source;
  }

  async getUploadingSource() {
    return this.upload;
  }
  async getSource() {
    return this.source;
  }
  async getPreviewAsset() {
    if (this.source?.status !== "ready") return null;
    return { filename: "guide.pdf", mimeType: "application/pdf", storageKey: "opaque/key" };
  }
  async listSources(): Promise<SourceLibrarySnapshot> {
    return {
      sources: this.source === null ? [] : [this.source],
      total: this.source === null ? 0 : 1,
    };
  }
  async completeUpload(
    _scope: UserScope,
    input: CompleteSourceUploadRecord,
  ): Promise<CommandResult<SourceDocumentSummary>> {
    if (this.source === null) throw new Error("missing source");
    if (this.source.status === "ready" && this.source.version === input.expectedVersion + 1) {
      return { value: this.source, warnings: [] };
    }
    this.completionWrites += 1;
    this.source = {
      ...this.source,
      assets: this.source.assets.map((asset) => {
        const inspection = input.assets.find((entry) => entry.id === asset.id)!.inspection;
        return { ...asset, ...inspection };
      }),
      contentFingerprint: input.contentFingerprint,
      pageCount: input.pageCount,
      status: "ready",
      version: 2,
    };
    this.upload = null;
    return { value: this.source, warnings: [] };
  }
  async deleteSource(): Promise<DeletedSourceRecord> {
    return { cleanupPending: true, storageKeys: ["opaque/key"] };
  }
  async markCleanupComplete() {
    this.cleanupCompleteWrites += 1;
  }
}

class MemoryObjectStore implements SourceObjectStore {
  deletedKeys: readonly string[] = [];
  inspection: InspectedSourceObject = {
    byteSize: 128,
    height: null,
    pageCount: 2,
    sha256: "abc",
    sniffedMimeType: "application/pdf",
    width: null,
  };
  async createUploadTarget() {
    return {
      expiresAt: "2026-08-13T00:15:00.000Z",
      headers: { "content-type": "application/pdf" },
      url: "https://private.invalid/put",
    };
  }
  async createPreviewTarget(): Promise<SourcePreview> {
    return {
      expiresAt: "2026-08-13T00:15:00.000Z",
      filename: "guide.pdf",
      mimeType: "application/pdf",
      url: "https://private.invalid/get",
    };
  }
  async deleteMany(storageKeys: readonly string[]) {
    this.deletedKeys = storageKeys;
  }
  hashText(value: string) {
    return `fingerprint:${value}`;
  }
  async inspect() {
    return this.inspection;
  }
}

describe("P3 Source Library contract", () => {
  it("creates an opaque direct-upload plan and only completes after server inspection", async () => {
    const repository = new MemorySourceRepository();
    const objectStore = new MemoryObjectStore();
    const sourceLibrary = createSourceLibrary({
      clock: new FixedClock("2026-08-13T00:00:00.000Z"),
      ids: new SequenceIdGenerator([
        "50000000-0000-4000-8000-000000000001",
        "60000000-0000-4000-8000-000000000001",
      ]),
      objectStore,
      repository,
    });
    const plan = await sourceLibrary.beginUpload(scope, {
      assets: [
        {
          byteSize: 128,
          declaredMimeType: "application/pdf",
          originalFilename: "../../guide.pdf",
          position: 0,
        },
      ],
      courseId,
      displayName: "Course guide",
      kind: "syllabus",
    });

    expect(plan.value.source.status).toBe("uploading");
    expect(plan.value.targets[0]?.uploadUrl).not.toContain("guide.pdf");
    expect(repository.upload?.assets[0]?.storageKey).toMatch(/^source\/[0-9a-f-]+\/[0-9a-f-]+$/u);

    const completed = await sourceLibrary.completeUpload(scope, {
      expectedVersion: 1,
      sourceId: asSourceDocumentId(plan.value.source.id),
    });
    expect(completed.value).toMatchObject({ pageCount: 2, status: "ready", version: 2 });
    const replay = await sourceLibrary.completeUpload(scope, {
      expectedVersion: 1,
      sourceId: completed.value.id,
    });
    expect(replay.value).toEqual(completed.value);
    expect(repository.completionWrites).toBe(1);
    await expect(sourceLibrary.getSourcePreview(scope, completed.value.id)).resolves.toMatchObject({
      mimeType: "application/pdf",
    });
  });

  it("keeps uploading when stored bytes do not match the declared plan", async () => {
    const repository = new MemorySourceRepository();
    const objectStore = new MemoryObjectStore();
    objectStore.inspection = { ...objectStore.inspection, byteSize: 127 };
    const sourceLibrary = createSourceLibrary({
      clock: new FixedClock("2026-08-13T00:00:00.000Z"),
      ids: new SequenceIdGenerator([
        "50000000-0000-4000-8000-000000000001",
        "60000000-0000-4000-8000-000000000001",
      ]),
      objectStore,
      repository,
    });
    const plan = await sourceLibrary.beginUpload(scope, {
      assets: [
        {
          byteSize: 128,
          declaredMimeType: "application/pdf",
          originalFilename: "guide.pdf",
          position: 0,
        },
      ],
      courseId,
      displayName: "Course guide",
      kind: "syllabus",
    });

    await expect(
      sourceLibrary.completeUpload(scope, { expectedVersion: 1, sourceId: plan.value.source.id }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(repository.source?.status).toBe("uploading");
  });

  it("marks cleanup complete only after private objects are deleted", async () => {
    const repository = new MemorySourceRepository();
    const objectStore = new MemoryObjectStore();
    const sourceLibrary = createSourceLibrary({
      clock: new FixedClock("2026-08-13T00:00:00.000Z"),
      ids: new SequenceIdGenerator(["unused-id"]),
      objectStore,
      repository,
    });
    await sourceLibrary.deleteSource(scope, {
      expectedVersion: 2,
      sourceId: asSourceDocumentId("50000000-0000-4000-8000-000000000001"),
    });
    expect(objectStore.deletedKeys).toEqual(["opaque/key"]);
    expect(repository.cleanupCompleteWrites).toBe(1);

    objectStore.deleteMany = async () => {
      throw new Error("object store unavailable");
    };
    await expect(
      sourceLibrary.deleteSource(scope, {
        expectedVersion: 2,
        sourceId: asSourceDocumentId("50000000-0000-4000-8000-000000000001"),
      }),
    ).rejects.toThrow("object store unavailable");
    expect(repository.cleanupCompleteWrites).toBe(1);
  });
});
