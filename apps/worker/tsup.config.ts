import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  entry: ["src/index.ts"],
  format: ["cjs"],
  noExternal: ["@courseflow/infrastructure"],
  outExtension: () => ({ js: ".cjs" }),
  target: "node24",
});
