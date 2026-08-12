import {
  createLogger,
  createRuntimeDependencies,
  loadWorkerConfig,
} from "@courseflow/infrastructure";

export function composeWorker() {
  const config = loadWorkerConfig();
  const logger = createLogger({
    environment: config.NODE_ENV,
    level: config.LOG_LEVEL,
    service: config.service,
  });
  const dependencies = createRuntimeDependencies(config);
  return { config, dependencies, logger };
}
