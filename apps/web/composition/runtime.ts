import {
  asUserId,
  createAcademics,
  createPlanning,
  type Academics,
  type Planning,
  type UserScope,
} from "@courseflow/core";
import {
  ConfigError,
  createLogger,
  createPostgresCourseFlowRepository,
  createRuntimeDependencies,
  loadRuntimeConfig,
  type PostgresCourseFlowRepository,
  type ReadinessReport,
} from "@courseflow/infrastructure";
import { randomUUID } from "node:crypto";

export interface AuthSessionPort {
  getUserScope(): Promise<UserScope>;
}

export class DevelopmentIdentityAdapter implements AuthSessionPort {
  readonly #repository: PostgresCourseFlowRepository;

  constructor(repository: PostgresCourseFlowRepository) {
    this.#repository = repository;
  }

  async getUserScope(): Promise<UserScope> {
    return this.#repository.ensureUserProfile({
      authSubject: process.env.AUTH_DEVELOPMENT_SUBJECT ?? "development:courseflow-local-user",
      displayName: process.env.AUTH_DEVELOPMENT_DISPLAY_NAME ?? "CourseFlow Student",
      locale: "zh-CN",
      timeZone: process.env.AUTH_DEVELOPMENT_TIME_ZONE ?? "Asia/Shanghai",
      userId: asUserId(
        process.env.AUTH_DEVELOPMENT_USER_ID ?? "00000000-0000-4000-8000-000000000001",
      ),
    });
  }
}

type WebRuntime = Readonly<{
  academics?: Academics;
  auth?: AuthSessionPort;
  configError?: ConfigError;
  planning?: Planning;
  readiness: () => Promise<ReadinessReport>;
}>;

declare global {
  var courseflowWebRuntime: WebRuntime | undefined;
}

function createWebRuntime(): WebRuntime {
  try {
    const config = loadRuntimeConfig("web");
    const logger = createLogger({
      environment: config.NODE_ENV,
      level: config.LOG_LEVEL,
      service: config.service,
    });
    const dependencies = createRuntimeDependencies(config);
    if (process.env.AUTH_MODE !== "development") {
      throw new Error(
        "No production auth adapter is configured. Set AUTH_MODE=development only for local development and tests.",
      );
    }
    const repository = createPostgresCourseFlowRepository({
      clock: { now: () => new Date() },
      databaseUrl: config.DATABASE_URL,
      ids: { nextId: randomUUID },
    });
    logger.info("runtime_started", { status: "auth_development" });
    return {
      academics: createAcademics(repository),
      auth: new DevelopmentIdentityAdapter(repository),
      planning: createPlanning(repository),
      readiness: dependencies.readiness,
    };
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    return {
      configError: error,
      readiness: async () => ({
        checks: { objectStore: "not_ready", postgres: "not_ready" },
        status: "not_ready",
      }),
    };
  }
}

export function getWebRuntime(): WebRuntime {
  globalThis.courseflowWebRuntime ??= createWebRuntime();
  return globalThis.courseflowWebRuntime;
}

export async function getScopedCourseFlow(): Promise<
  Readonly<{
    academics: Academics;
    planning: Planning;
    scope: UserScope;
  }>
> {
  const runtime = getWebRuntime();
  if (
    runtime.configError !== undefined ||
    runtime.academics === undefined ||
    runtime.auth === undefined ||
    runtime.planning === undefined
  ) {
    throw runtime.configError ?? new Error("CourseFlow runtime is unavailable.");
  }
  return {
    academics: runtime.academics,
    planning: runtime.planning,
    scope: await runtime.auth.getUserScope(),
  };
}
