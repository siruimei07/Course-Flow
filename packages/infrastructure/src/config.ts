import { z } from "zod";

const booleanText = z
  .enum(["true", "false"])
  .transform((value) => value === "true")
  .default(true);

const runtimeConfigSchema = z.object({
  APP_ORIGIN: z.url().default("http://127.0.0.1:3000"),
  DATABASE_URL: z
    .url()
    .refine((value) => value.startsWith("postgresql://") || value.startsWith("postgres://"), {
      message: "must use the postgresql protocol",
    }),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  OBJECT_STORE_ACCESS_KEY: z.string().min(1),
  OBJECT_STORE_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
  OBJECT_STORE_ENDPOINT: z.url().refine((value) => /^https?:\/\//u.test(value), {
    message: "must use http or https",
  }),
  OBJECT_STORE_FORCE_PATH_STYLE: booleanText,
  OBJECT_STORE_REGION: z.string().min(1),
  OBJECT_STORE_SECRET_KEY: z.string().min(8),
});

const workerConfigSchema = runtimeConfigSchema.extend({
  WORKER_HOST: z.string().min(1).default("127.0.0.1"),
  WORKER_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
});

export type RuntimeConfig = Readonly<
  z.output<typeof runtimeConfigSchema> & {
    service: "web" | "worker";
  }
>;

export type WorkerConfig = Readonly<
  z.output<typeof workerConfigSchema> & {
    service: "worker";
  }
>;

export class ConfigError extends Error {
  readonly code = "CONFIG_INVALID";
  readonly issues: readonly Readonly<{ key: string; reason: string }>[];

  constructor(error: z.ZodError) {
    const issues = error.issues.map((issue) => ({
      key: issue.path.join(".") || "environment",
      reason: issue.message,
    }));
    super(`Invalid configuration: ${issues.map((issue) => issue.key).join(", ")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

function parseConfig<TSchema extends z.ZodType>(schema: TSchema, environment: NodeJS.ProcessEnv) {
  const result = schema.safeParse(environment);
  if (!result.success) {
    throw new ConfigError(result.error);
  }
  return result.data;
}

export function loadRuntimeConfig(
  service: "web" | "worker",
  environment: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  return Object.freeze({ ...parseConfig(runtimeConfigSchema, environment), service });
}

export function loadWorkerConfig(environment: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return Object.freeze({ ...parseConfig(workerConfigSchema, environment), service: "worker" });
}
