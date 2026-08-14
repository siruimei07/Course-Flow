// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { sendJson } from "./api-form";

describe("sendJson problem mapping", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("turns the stable version-conflict code into an actionable Chinese recovery message", async () => {
    const request = vi.fn().mockResolvedValue(
      Response.json(
        {
          code: "VERSION_CONFLICT",
          detail: "The record changed after it was loaded.",
          errors: [],
        },
        { status: 409 },
      ),
    );
    vi.stubGlobal("fetch", request);

    await expect(
      sendJson("/api/v1/course-items/item-1/state", "PUT", {
        expectedVersion: 1,
        itemId: "item-1",
        state: "completed",
      }),
    ).rejects.toThrow("记录已被其他页面更新。请刷新后重试；本次操作没有覆盖新版本。");
    expect(request).toHaveBeenCalledWith(
      "/api/v1/course-items/item-1/state",
      expect.objectContaining({ method: "PUT" }),
    );
  });
});
