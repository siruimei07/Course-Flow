export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = Readonly<{
  durationMs?: number;
  errorCode?: string;
  requestId?: string;
  status?: string;
}>;

export interface AppLogger {
  debug(event: string, context?: LogContext): void;
  error(event: string, context?: LogContext): void;
  info(event: string, context?: LogContext): void;
  warn(event: string, context?: LogContext): void;
}

const priorities: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createLogger(options: {
  environment: string;
  level: LogLevel;
  service: string;
  write?: (line: string) => void;
}): AppLogger {
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));

  function log(level: LogLevel, event: string, context: LogContext = {}) {
    if (priorities[level] < priorities[options.level]) return;
    write(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        service: options.service,
        environment: options.environment,
        event,
        ...context,
      }),
    );
  }

  return {
    debug: (event, context) => log("debug", event, context),
    error: (event, context) => log("error", event, context),
    info: (event, context) => log("info", event, context),
    warn: (event, context) => log("warn", event, context),
  };
}
