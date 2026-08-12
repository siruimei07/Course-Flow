import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
await mkdir(new URL("../packages/infrastructure/dist", import.meta.url), { recursive: true });

await build({
  absWorkingDir: repositoryRoot,
  bundle: true,
  entryPoints: {
    "ensure-object-store": "packages/infrastructure/src/ensure-object-store.ts",
    migrate: "packages/infrastructure/src/migrate.ts",
    migration: "packages/infrastructure/src/migration.ts",
  },
  external: ["@aws-sdk/client-s3", "drizzle-orm", "pg", "zod"],
  format: "cjs",
  outExtension: { ".js": ".cjs" },
  outdir: "packages/infrastructure/dist",
  platform: "node",
  target: "node24",
});
