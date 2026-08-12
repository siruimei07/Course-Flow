import {
  ConfigError,
  createLogger,
  createRuntimeDependencies,
  loadRuntimeConfig,
  type ReadinessReport,
} from "@courseflow/infrastructure";

type WebRuntime = Readonly<{
  configError?: ConfigError;
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
    logger.info("runtime_started");
    return { readiness: dependencies.readiness };
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
