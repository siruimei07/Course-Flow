import { describe, expect, it } from "vitest";
import { FixedClock, SequenceIdGenerator } from "@courseflow/test-support";

describe("deterministic test support", () => {
  it("returns fixed time and IDs without wall-clock or randomness", () => {
    const clock = new FixedClock("2026-08-12T09:00:00.000Z");
    const ids = new SequenceIdGenerator(["id_001", "id_002"]);

    expect(clock.now().toISOString()).toBe("2026-08-12T09:00:00.000Z");
    expect(ids.nextId()).toBe("id_001");
    expect(ids.nextId()).toBe("id_002");
  });
});
