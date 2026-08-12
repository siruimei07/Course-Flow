import { getOrCreateRequestId } from "@courseflow/infrastructure";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  const requestId = getOrCreateRequestId(request.headers.get("x-request-id") ?? undefined);
  return Response.json(
    { service: "web", status: "ok" },
    { headers: { "cache-control": "no-store", "x-request-id": requestId } },
  );
}
