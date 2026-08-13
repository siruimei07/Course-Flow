import { describe, expect, it } from "vitest";
import { assertSameOrigin, fileQuery } from "../../apps/web/app/api/v1/route-support";

describe("P1 HTTP mutation boundary", () => {
  it("accepts an exact Origin or browser same-origin signal and rejects missing/cross-site signals", () => {
    expect(
      assertSameOrigin(
        new Request("https://courseflow.local/api/v1/terms", {
          headers: { host: "courseflow.local", origin: "https://courseflow.local" },
          method: "POST",
        }),
        "same-origin",
      ),
    ).toBeNull();
    expect(
      assertSameOrigin(
        new Request("https://courseflow.local/api/v1/terms", {
          headers: { host: "courseflow.local", "sec-fetch-site": "same-origin" },
          method: "POST",
        }),
        "browser-signal",
      ),
    ).toBeNull();
    expect(
      assertSameOrigin(
        new Request("https://courseflow.local/api/v1/terms", {
          headers: {
            host: "courseflow.local",
            origin: "https://attacker.invalid",
            "sec-fetch-site": "cross-site",
          },
          method: "POST",
        }),
        "cross-site",
      )?.status,
    ).toBe(403);
    expect(
      assertSameOrigin(
        new Request("https://courseflow.local/api/v1/terms", { method: "POST" }),
        "missing-signal",
      )?.status,
    ).toBe(403);
  });

  it("preserves redirects while adding file-response safety headers", async () => {
    const response = await fileQuery(
      new Request("https://courseflow.local/api/v1/source-documents/source-id/preview"),
      async () => Response.redirect("https://private-object-store.invalid/signed", 307),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://private-object-store.invalid/signed");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });
});
