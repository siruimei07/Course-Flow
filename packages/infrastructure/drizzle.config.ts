import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  migrations: { prefix: "timestamp" },
  out: "./drizzle",
  schema: "./src/schema.ts",
  strict: true,
  verbose: true,
});
