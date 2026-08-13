import {
  asCourseId,
  asSourceAssetId,
  asSourceDocumentId,
  notFound,
  validationError,
  versionConflict,
  type CommandResult,
  type CompleteSourceUploadRecord,
  type CreateSourceUploadRecord,
  type DeletedSourceRecord,
  type SourceAssetSummary,
  type SourceDocumentId,
  type SourceDocumentSummary,
  type SourceKind,
  type SourceLibraryQuery,
  type SourceLibraryRepository,
  type SourceLibrarySnapshot,
  type SourceStatus,
  type UploadingSource,
  type UserScope,
} from "@courseflow/core";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

type SourceRow = QueryResultRow & {
  cleanup_status: "complete" | "not_requested" | "pending";
  content_fingerprint: string | null;
  course_code: string;
  course_id: string;
  course_title: string;
  created_at: Date | string;
  deleted_at: Date | string | null;
  display_name: string;
  id: string;
  kind: SourceKind;
  page_count: number | null;
  status: SourceStatus;
  upload_expires_at: Date | string;
  version: number;
};

type AssetRow = QueryResultRow & {
  byte_size: number | string;
  declared_mime_type: string;
  height: number | null;
  id: string;
  original_filename: string;
  position: number;
  sha256: string | null;
  sniffed_mime_type: string | null;
  storage_key: string;
  width: number | null;
};

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function asNullableIso(value: Date | string | null): string | null {
  return value === null ? null : asIso(value);
}

function mapAsset(row: AssetRow): SourceAssetSummary {
  return {
    byteSize: Number(row.byte_size),
    height: row.height,
    id: asSourceAssetId(row.id),
    originalFilename: row.original_filename,
    position: row.position,
    sha256: row.sha256,
    sniffedMimeType: row.sniffed_mime_type,
    width: row.width,
  };
}

function mapSource(row: SourceRow, assets: readonly SourceAssetSummary[]): SourceDocumentSummary {
  return {
    assets,
    contentFingerprint: row.content_fingerprint,
    courseCode: row.course_code,
    courseId: asCourseId(row.course_id),
    courseTitle: row.course_title,
    createdAt: asIso(row.created_at),
    deletedAt: asNullableIso(row.deleted_at),
    displayName: row.display_name,
    id: asSourceDocumentId(row.id),
    kind: row.kind,
    pageCount: row.page_count,
    status: row.status,
    version: row.version,
  };
}

export class PostgresSourceLibraryRepository implements SourceLibraryRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  async #transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query("begin");
      const value = await work(client);
      await client.query("commit");
      return value;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async #loadSource(
    client: Pick<PoolClient, "query">,
    scope: UserScope,
    sourceId: SourceDocumentId,
    lock = false,
  ): Promise<Readonly<{ assets: readonly AssetRow[]; row: SourceRow }> | null> {
    const sourceResult = await client.query<SourceRow>(
      `select d.id,d.course_id,d.kind,d.display_name,d.status,d.content_fingerprint,d.cleanup_status,
              d.page_count,d.deleted_at,d.created_at,d.upload_expires_at,d.version,
              c.code as course_code,c.title as course_title
         from courseflow.source_documents d
         join courseflow.courses c on c.id=d.course_id
         join courseflow.academic_terms t on t.id=c.term_id
        where d.id=$1 and t.owner_user_id=$2${lock ? " for update of d" : ""}`,
      [sourceId, scope.userId],
    );
    const row = sourceResult.rows[0];
    if (row === undefined) return null;
    const assets = await client.query<AssetRow>(
      `select id,position,storage_key,original_filename,declared_mime_type,
              sniffed_mime_type,byte_size,sha256,width,height
         from courseflow.source_assets
        where source_document_id=$1 order by position,id`,
      [sourceId],
    );
    return { assets: assets.rows, row };
  }

  async createUpload(
    scope: UserScope,
    input: CreateSourceUploadRecord,
  ): Promise<SourceDocumentSummary> {
    return this.#transaction(async (client) => {
      const course = await client.query<{ id: string }>(
        `select c.id
           from courseflow.courses c
           join courseflow.academic_terms t on t.id=c.term_id
          where c.id=$1 and t.owner_user_id=$2 and c.archived_at is null and t.archived_at is null
          for share of c`,
        [input.courseId, scope.userId],
      );
      if (course.rows[0] === undefined) throw notFound();
      await client.query(
        `insert into courseflow.source_documents
          (id,course_id,kind,display_name,status,upload_expires_at,version)
         values ($1,$2,$3,$4,'uploading',$5,1)`,
        [input.id, input.courseId, input.kind, input.displayName, input.uploadExpiresAt],
      );
      for (const asset of input.assets) {
        await client.query(
          `insert into courseflow.source_assets
            (id,source_document_id,position,storage_key,original_filename,declared_mime_type,byte_size)
           values ($1,$2,$3,$4,$5,$6,$7)`,
          [
            asset.id,
            input.id,
            asset.position,
            asset.storageKey,
            asset.originalFilename,
            asset.declaredMimeType,
            asset.declaredByteSize,
          ],
        );
      }
      const created = await this.#loadSource(client, scope, input.id);
      if (created === null) throw notFound();
      return mapSource(created.row, created.assets.map(mapAsset));
    });
  }

  async getSource(
    scope: UserScope,
    sourceId: SourceDocumentId,
  ): Promise<SourceDocumentSummary | null> {
    const loaded = await this.#loadSource(this.#pool, scope, sourceId);
    return loaded === null ? null : mapSource(loaded.row, loaded.assets.map(mapAsset));
  }

  async getUploadingSource(
    scope: UserScope,
    sourceId: SourceDocumentId,
  ): Promise<UploadingSource | null> {
    const loaded = await this.#loadSource(this.#pool, scope, sourceId);
    if (loaded === null || loaded.row.status !== "uploading") return null;
    return {
      assets: loaded.assets.map((asset) => ({
        declaredByteSize: Number(asset.byte_size),
        declaredMimeType: asset.declared_mime_type,
        id: asSourceAssetId(asset.id),
        originalFilename: asset.original_filename,
        position: asset.position,
        storageKey: asset.storage_key,
      })),
      document: mapSource(loaded.row, loaded.assets.map(mapAsset)),
      uploadExpiresAt: asIso(loaded.row.upload_expires_at),
    };
  }

  async completeUpload(
    scope: UserScope,
    input: CompleteSourceUploadRecord,
  ): Promise<CommandResult<SourceDocumentSummary>> {
    return this.#transaction(async (client) => {
      const loaded = await this.#loadSource(client, scope, input.sourceId, true);
      if (loaded === null) throw notFound();
      if (loaded.row.status === "ready" && loaded.row.version === input.expectedVersion + 1) {
        return {
          value: mapSource(loaded.row, loaded.assets.map(mapAsset)),
          warnings: [],
        };
      }
      if (loaded.row.version !== input.expectedVersion) throw versionConflict(loaded.row.version);
      if (loaded.row.status !== "uploading") {
        throw validationError("资料当前不能完成上传。", [
          {
            code: "INVALID_SOURCE_STATE",
            message: "只有 uploading 资料可以完成上传。",
            path: "/sourceId",
          },
        ]);
      }
      const inspectedById = new Map(input.assets.map((asset) => [asset.id, asset.inspection]));
      if (inspectedById.size !== loaded.assets.length) {
        throw validationError("上传文件集合不完整。", [
          { code: "ASSET_SET_MISMATCH", message: "请重新创建上传计划。", path: "/assets" },
        ]);
      }
      for (const asset of loaded.assets) {
        const inspection = inspectedById.get(asSourceAssetId(asset.id));
        if (inspection === undefined) {
          throw validationError("上传文件集合不完整。", [
            { code: "ASSET_SET_MISMATCH", message: "请重新创建上传计划。", path: "/assets" },
          ]);
        }
        await client.query(
          `update courseflow.source_assets
              set sniffed_mime_type=$1,byte_size=$2,sha256=$3,width=$4,height=$5
            where id=$6 and source_document_id=$7`,
          [
            inspection.sniffedMimeType,
            inspection.byteSize,
            inspection.sha256,
            inspection.width,
            inspection.height,
            asset.id,
            input.sourceId,
          ],
        );
      }
      const updated = await client.query(
        `update courseflow.source_documents
            set status='ready',content_fingerprint=$1,page_count=$2,version=version+1
          where id=$3 and version=$4 and status='uploading'`,
        [input.contentFingerprint, input.pageCount, input.sourceId, input.expectedVersion],
      );
      if (updated.rowCount !== 1) throw versionConflict(loaded.row.version);
      const duplicates = await client.query<{ id: string }>(
        `select id from courseflow.source_documents
          where course_id=$1 and id<>$2 and status='ready' and content_fingerprint=$3
          limit 1`,
        [loaded.row.course_id, input.sourceId, input.contentFingerprint],
      );
      const ready = await this.#loadSource(client, scope, input.sourceId);
      if (ready === null) throw notFound();
      return {
        value: mapSource(ready.row, ready.assets.map(mapAsset)),
        warnings:
          duplicates.rows[0] === undefined
            ? []
            : [
                {
                  code: "DUPLICATE_SOURCE_CONTENT",
                  message: "同一课程已有内容相同的资料；本次资料仍已保留。",
                  path: "/sourceId",
                },
              ],
      };
    });
  }

  async deleteSource(
    scope: UserScope,
    sourceId: SourceDocumentId,
    expectedVersion: number,
  ): Promise<DeletedSourceRecord> {
    return this.#transaction(async (client) => {
      const loaded = await this.#loadSource(client, scope, sourceId, true);
      if (loaded === null) throw notFound();
      if (loaded.row.status === "deleted" && loaded.row.version === expectedVersion + 1) {
        return {
          cleanupPending: loaded.row.cleanup_status === "pending",
          storageKeys: loaded.assets.map((asset) => asset.storage_key),
        };
      }
      if (loaded.row.version !== expectedVersion) throw versionConflict(loaded.row.version);
      await client.query(
        `update courseflow.source_documents
            set status='deleted',deleted_at=now(),cleanup_status='pending',version=version+1
          where id=$1 and version=$2`,
        [sourceId, expectedVersion],
      );
      return {
        cleanupPending: true,
        storageKeys: loaded.assets.map((asset) => asset.storage_key),
      };
    });
  }

  async markCleanupComplete(scope: UserScope, sourceId: SourceDocumentId): Promise<void> {
    const updated = await this.#pool.query(
      `update courseflow.source_documents d
          set cleanup_status='complete'
         from courseflow.courses c
         join courseflow.academic_terms t on t.id=c.term_id
        where d.id=$1 and d.course_id=c.id and t.owner_user_id=$2
          and d.status='deleted' and d.cleanup_status='pending'`,
      [sourceId, scope.userId],
    );
    if (updated.rowCount !== 1) {
      const loaded = await this.#loadSource(this.#pool, scope, sourceId);
      if (loaded === null) throw notFound();
      if (loaded.row.status !== "deleted" || loaded.row.cleanup_status !== "complete") {
        throw validationError("资料清理状态无效。", [
          {
            code: "INVALID_SOURCE_CLEANUP_STATE",
            message: "资料尚未进入可完成的清理状态。",
            path: "/sourceId",
          },
        ]);
      }
    }
  }

  async getPreviewAsset(
    scope: UserScope,
    sourceId: SourceDocumentId,
  ): Promise<Readonly<{ filename: string; mimeType: string; storageKey: string }> | null> {
    const result = await this.#pool.query<{
      original_filename: string;
      sniffed_mime_type: string;
      storage_key: string;
    }>(
      `select a.original_filename,a.sniffed_mime_type,a.storage_key
         from courseflow.source_assets a
         join courseflow.source_documents d on d.id=a.source_document_id
         join courseflow.courses c on c.id=d.course_id
         join courseflow.academic_terms t on t.id=c.term_id
        where d.id=$1 and t.owner_user_id=$2 and d.status='ready' and a.position=0
        limit 1`,
      [sourceId, scope.userId],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          filename: row.original_filename,
          mimeType: row.sniffed_mime_type,
          storageKey: row.storage_key,
        };
  }

  async listSources(scope: UserScope, query: SourceLibraryQuery): Promise<SourceLibrarySnapshot> {
    const values: unknown[] = [scope.userId];
    const conditions = ["t.owner_user_id=$1", "d.status<>'deleted'"];
    if (query.courseId !== undefined) {
      values.push(query.courseId);
      conditions.push(`d.course_id=$${values.length}`);
    }
    if (query.status !== undefined) {
      values.push(query.status);
      conditions.push(`d.status=$${values.length}`);
    }
    if (query.search !== undefined && query.search.trim() !== "") {
      values.push(`%${query.search.trim()}%`);
      conditions.push(`(d.display_name ilike $${values.length} or c.code ilike $${values.length})`);
    }
    const result = await this.#pool.query<{ id: string; total_count: string }>(
      `select d.id,count(*) over() as total_count
         from courseflow.source_documents d
         join courseflow.courses c on c.id=d.course_id
         join courseflow.academic_terms t on t.id=c.term_id
        where ${conditions.join(" and ")}
        order by d.created_at desc,d.id desc`,
      values,
    );
    const sources: SourceDocumentSummary[] = [];
    for (const row of result.rows) {
      const loaded = await this.#loadSource(this.#pool, scope, asSourceDocumentId(row.id));
      if (loaded !== null) sources.push(mapSource(loaded.row, loaded.assets.map(mapAsset)));
    }
    return { sources, total: Number(result.rows[0]?.total_count ?? 0) };
  }
}

export function createPostgresSourceLibraryRepository(
  databaseUrl: string,
): PostgresSourceLibraryRepository {
  return new PostgresSourceLibraryRepository(
    new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000, max: 4 }),
  );
}
