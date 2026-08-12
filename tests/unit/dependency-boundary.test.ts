import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("core dependency boundary", () => {
  it("rejects a deliberate framework import fixture", () => {
    const fixture = path.resolve("tests/fixtures/dependency-boundaries/core-imports-next.ts");

    const result = spawnSync(
      process.execPath,
      ["node_modules/eslint/bin/eslint.js", "--no-ignore", "--format", "json", fixture],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "packages/core owns domain contracts and cannot depend on UI, framework, database, queue, or provider code.",
    );
  });
});
