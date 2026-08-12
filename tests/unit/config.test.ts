import { describe, expect, it } from "vitest";
import { ConfigError, loadRuntimeConfig } from "@courseflow/infrastructure";

const validEnvironment: NodeJS.ProcessEnv = {
  DATABASE_URL: "postgresql://courseflow:secret@127.0.0.1:5432/courseflow",
  LOG_LEVEL: "info",
  NODE_ENV: "test",
  OBJECT_STORE_ACCESS_KEY: "local-key",
  OBJECT_STORE_BUCKET: "courseflow-test",
  OBJECT_STORE_ENDPOINT: "http://127.0.0.1:4566",
  OBJECT_STORE_FORCE_PATH_STYLE: "true",
  OBJECT_STORE_REGION: "us-east-1",
  OBJECT_STORE_SECRET_KEY: "super-secret-value",
};

describe("runtime configuration boundary", () => {
  it("fails once at startup with keys but without secret values", () => {
    const secret = "must-never-appear";
    expect(() =>
      loadRuntimeConfig("web", {
        ...validEnvironment,
        DATABASE_URL: "not-a-postgres-url",
        OBJECT_STORE_SECRET_KEY: secret,
      }),
    ).toThrowError(ConfigError);

    try {
      loadRuntimeConfig("web", {
        ...validEnvironment,
        DATABASE_URL: "not-a-postgres-url",
        OBJECT_STORE_SECRET_KEY: secret,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect(String(error)).toContain("DATABASE_URL");
      expect(JSON.stringify(error)).not.toContain(secret);
    }
  });
});
