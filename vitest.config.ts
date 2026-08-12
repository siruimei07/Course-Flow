import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    clearMocks: true,
    include: ["apps/**/*.test.{ts,tsx}", "packages/**/*.test.{ts,tsx}", "tests/unit/**/*.test.ts"],
    passWithNoTests: false,
    setupFiles: ["./tests/setup.ts"],
  },
});
