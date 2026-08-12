import { getOrCreateRequestId } from "@courseflow/infrastructure";
import { getWebRuntime } from "../../../composition/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = getOrCreateRequestId(request.headers.get("x-request-id") ?? undefined);
  const runtimeState = getWebRuntime();
  const readiness = await runtimeState.readiness();
  const body = runtimeState.configError
    ? { ...readiness, code: runtimeState.configError.code, service: "web" }
    : { ...readiness, service: "web" };
  return Response.json(body, {
    headers: { "cache-control": "no-store", "x-request-id": requestId },
    status: readiness.status === "ready" ? 200 : 503,
  });
}
