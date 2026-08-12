import { createServer } from "node:http";
import { getOrCreateRequestId } from "@courseflow/infrastructure";
import { composeWorker } from "./composition/runtime";

const { config, dependencies, logger } = composeWorker();

function sendJson(
  response: import("node:http").ServerResponse,
  statusCode: number,
  requestId: string,
  body: object,
) {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "x-request-id": requestId,
  });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  const requestId = getOrCreateRequestId(
    typeof request.headers["x-request-id"] === "string"
      ? request.headers["x-request-id"]
      : undefined,
  );
  const startedAt = performance.now();

  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, requestId, { service: "worker", status: "ok" });
  } else if (request.method === "GET" && request.url === "/ready") {
    const readiness = await dependencies.readiness();
    sendJson(response, readiness.status === "ready" ? 200 : 503, requestId, {
      ...readiness,
      service: "worker",
    });
  } else {
    sendJson(response, 404, requestId, {
      code: "NOT_FOUND",
      requestId,
      status: 404,
      title: "Not found",
      type: "about:blank",
    });
  }

  logger.info("http_request_completed", {
    durationMs: Math.round(performance.now() - startedAt),
    requestId,
    status: String(response.statusCode),
  });
});

server.listen(config.WORKER_PORT, config.WORKER_HOST, () => {
  logger.info("worker_started", { status: "listening" });
});

async function shutdown() {
  server.close();
  await dependencies.close();
  logger.info("worker_stopped");
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
