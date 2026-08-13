import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { Pool } from "pg";
import type { RuntimeConfig } from "./config";

export type DependencyName = "objectStore" | "postgres";

export type ReadinessReport = Readonly<{
  checks: Readonly<Record<DependencyName, "ready" | "not_ready">>;
  status: "ready" | "not_ready";
}>;

export function createS3Client(config: RuntimeConfig) {
  const options: S3ClientConfig = {
    credentials: {
      accessKeyId: config.OBJECT_STORE_ACCESS_KEY,
      secretAccessKey: config.OBJECT_STORE_SECRET_KEY,
    },
    endpoint: config.OBJECT_STORE_ENDPOINT,
    forcePathStyle: config.OBJECT_STORE_FORCE_PATH_STYLE,
    region: config.OBJECT_STORE_REGION,
  };
  return new S3Client(options);
}

export function createRuntimeDependencies(config: RuntimeConfig) {
  const postgres = new Pool({
    connectionString: config.DATABASE_URL,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 10_000,
    max: 4,
    query_timeout: 2_000,
  });
  const objectStore = createS3Client(config);

  async function readiness(): Promise<ReadinessReport> {
    const [postgresResult, objectStoreResult] = await Promise.allSettled([
      postgres.query("select 1"),
      objectStore.send(new HeadBucketCommand({ Bucket: config.OBJECT_STORE_BUCKET }), {
        abortSignal: AbortSignal.timeout(2_000),
      }),
    ]);
    const checks = {
      postgres: postgresResult.status === "fulfilled" ? "ready" : "not_ready",
      objectStore: objectStoreResult.status === "fulfilled" ? "ready" : "not_ready",
    } as const;
    return {
      checks,
      status: checks.postgres === "ready" && checks.objectStore === "ready" ? "ready" : "not_ready",
    };
  }

  return {
    close: async () => {
      objectStore.destroy();
      await postgres.end();
    },
    readiness,
  };
}

export async function ensureObjectStoreBucket(config: RuntimeConfig): Promise<void> {
  const objectStore = createS3Client(config);
  try {
    await objectStore.send(new HeadBucketCommand({ Bucket: config.OBJECT_STORE_BUCKET }), {
      abortSignal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    const statusCode =
      typeof error === "object" && error !== null && "$metadata" in error
        ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode
        : undefined;
    if (statusCode !== 404) throw error;
    await objectStore.send(new CreateBucketCommand({ Bucket: config.OBJECT_STORE_BUCKET }), {
      abortSignal: AbortSignal.timeout(5_000),
    });
  } finally {
    try {
      await objectStore.send(
        new PutBucketCorsCommand({
          Bucket: config.OBJECT_STORE_BUCKET,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedHeaders: ["content-type"],
                AllowedMethods: ["GET", "HEAD", "PUT"],
                AllowedOrigins: [config.APP_ORIGIN],
                ExposeHeaders: ["etag"],
                MaxAgeSeconds: 900,
              },
            ],
          },
        }),
        { abortSignal: AbortSignal.timeout(5_000) },
      );
    } finally {
      objectStore.destroy();
    }
  }
}
