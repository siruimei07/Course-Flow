import { describe, expect, it } from "vitest";
import {
  calendarQuerySchema,
  scheduleQuerySchema,
  taskBoardQuerySchema,
} from "../../packages/contracts/src/index";
import { calendarQueryFromRequest } from "../../apps/web/app/api/v1/schedule-route-support";

describe("P2 schedule HTTP query contracts", () => {
  it("accepts bounded public query shapes", () => {
    expect(
      scheduleQuerySchema.parse({
        from: "2026-09-07",
        termId: "10000000-0000-4000-8000-000000000001",
        to: "2026-10-04",
      }),
    ).toMatchObject({ from: "2026-09-07", to: "2026-10-04" });
    expect(
      taskBoardQuerySchema.parse({
        group: "near",
        labelIds: ["20000000-0000-4000-8000-000000000001"],
        search: "quiz",
        termId: "10000000-0000-4000-8000-000000000001",
      }),
    ).toMatchObject({ group: "near" });
    expect(
      calendarQuerySchema.parse({
        courseIds: ["30000000-0000-4000-8000-000000000001"],
        includeItems: false,
        termId: "10000000-0000-4000-8000-000000000001",
      }),
    ).toMatchObject({ includeItems: false });
  });

  it("rejects invalid identities, dates, groups and oversized filters", () => {
    expect(() => scheduleQuerySchema.parse({ termId: "not-a-uuid" })).toThrow();
    expect(() =>
      scheduleQuerySchema.parse({
        from: "09/07/2026",
        termId: "10000000-0000-4000-8000-000000000001",
      }),
    ).toThrow();
    expect(() =>
      taskBoardQuerySchema.parse({
        group: "everything",
        termId: "10000000-0000-4000-8000-000000000001",
      }),
    ).toThrow();
    expect(() =>
      calendarQuerySchema.parse({
        courseIds: Array.from(
          { length: 25 },
          (_, index) => "30000000-0000-4000-8000-" + index.toString().padStart(12, "0"),
        ),
        termId: "10000000-0000-4000-8000-000000000001",
      }),
    ).toThrow();
    expect(() =>
      calendarQueryFromRequest(
        new Request(
          "https://courseflow.local/api/v1/calendar?termId=10000000-0000-4000-8000-000000000001&includeItems=maybe",
        ),
      ),
    ).toThrow();
  });
});
