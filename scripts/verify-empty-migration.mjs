import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import pg from "pg";

const { Client } = pg;
const require = createRequire(import.meta.url);
const { migrateDatabase } = require("../packages/infrastructure/dist/migration.cjs");
const configuredUrl = process.env.DATABASE_URL;
if (configuredUrl === undefined) {
  throw new Error("DATABASE_URL is required for migration verification.");
}

const adminUrl = new URL(configuredUrl);
const databaseName = `courseflow_p0_${randomUUID().replaceAll("-", "")}`;
const testUrl = new URL(configuredUrl);
testUrl.pathname = `/${databaseName}`;

const admin = new Client({ connectionString: adminUrl.toString() });
await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  await migrateDatabase(testUrl.toString());

  const verification = new Client({ connectionString: testUrl.toString() });
  await verification.connect();
  try {
    const schema = await verification.query(
      "select exists(select 1 from information_schema.schemata where schema_name = 'courseflow') as exists",
    );
    const migration = await verification.query(
      "select count(*)::text as count from drizzle.__drizzle_migrations",
    );
    if (schema.rows[0]?.exists !== true || migration.rows[0]?.count !== "1") {
      throw new Error("The empty database did not reach the expected P0 migration state.");
    }
  } finally {
    await verification.end();
  }

  process.stdout.write("Empty PostgreSQL database migrated to the P0 baseline.\n");
} finally {
  await admin.query(
    "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
    [databaseName],
  );
  await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  await admin.end();
}
