import { toJsonValue } from "@courseflow/contracts";
import { DomainError } from "@courseflow/core";
import { ConfigError, getOrCreateRequestId } from "@courseflow/infrastructure";
import { ZodError, type ZodType } from "zod";

type Handler<T> = (input: T, requestId: string) => Promise<unknown>;

function problem(
  requestId: string,
  status: number,
  code: string,
  title: string,
  detail: string,
  errors: readonly unknown[] = [],
) {
  return Response.json(
    {
      code,
      detail,
      errors,
      requestId,
      status,
      title,
      type: `https://courseflow.local/problems/${code.toLowerCase().replaceAll("_", "-")}`,
    },
    { headers: { "cache-control": "no-store", "x-request-id": requestId }, status },
  );
}

export function assertSameOrigin(request: Request, requestId: string): Response | null {
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host") || requestUrl.host;
  const protocol = forwardedProtocol || requestUrl.protocol.slice(0, -1);
  const expected = `${protocol}://${host}`;
  const actual = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (actual !== null ? actual !== expected : fetchSite !== "same-origin") {
    return problem(
      requestId,
      403,
      "CSRF_ORIGIN_REJECTED",
      "请求来源无效",
      "请从 CourseFlow 页面重新提交。",
      [],
    );
  }
  return null;
}

function failure(error: unknown, requestId: string): Response {
  if (error instanceof ZodError) {
    return problem(
      requestId,
      422,
      "VALIDATION_FAILED",
      "提交内容无效",
      "请检查标出的字段。",
      error.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: `/${issue.path.join("/")}`,
      })),
    );
  }
  if (error instanceof DomainError) {
    const status =
      error.code === "NOT_FOUND"
        ? 404
        : error.code === "VERSION_CONFLICT"
          ? 409
          : error.code === "AUTH_REQUIRED"
            ? 401
            : 422;
    return problem(
      requestId,
      status,
      error.code,
      status === 404 ? "未找到记录" : status === 409 ? "记录已变化" : "提交内容无效",
      error.message,
      error.issues,
    );
  }
  if (error instanceof ConfigError) {
    return problem(requestId, 503, error.code, "服务尚未就绪", "请检查应用配置后重试。", []);
  }
  return problem(requestId, 500, "INTERNAL_ERROR", "暂时无法完成请求", "请稍后重试。", []);
}

export async function fileQuery(
  request: Request,
  handler: (requestId: string) => Promise<Response>,
): Promise<Response> {
  const requestId = getOrCreateRequestId(request.headers.get("x-request-id") ?? undefined);
  try {
    const response = await handler(requestId);
    const headers = new Headers(response.headers);
    headers.set("cache-control", "no-store");
    headers.set("x-request-id", requestId);
    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  } catch (error) {
    return failure(error, requestId);
  }
}

export async function mutation<T>(
  request: Request,
  schema: ZodType<T>,
  handler: Handler<T>,
  status = 200,
): Promise<Response> {
  const requestId = getOrCreateRequestId(request.headers.get("x-request-id") ?? undefined);
  const originFailure = assertSameOrigin(request, requestId);
  if (originFailure !== null) return originFailure;
  try {
    const input = schema.parse(await request.json());
    const data = await handler(input, requestId);
    return Response.json(
      { data: toJsonValue(data), meta: { requestId } },
      { headers: { "cache-control": "no-store", "x-request-id": requestId }, status },
    );
  } catch (error) {
    return failure(error, requestId);
  }
}

export async function query(
  request: Request,
  handler: (requestId: string) => Promise<unknown>,
): Promise<Response> {
  const requestId = getOrCreateRequestId(request.headers.get("x-request-id") ?? undefined);
  try {
    const data = await handler(requestId);
    return Response.json(
      { data: toJsonValue(data), meta: { requestId } },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    return failure(error, requestId);
  }
}
