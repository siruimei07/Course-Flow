import { loadRuntimeConfig } from "./config";
import { migrateDatabase } from "./database";

const config = loadRuntimeConfig("worker");

void migrateDatabase(config.DATABASE_URL).then(() => {
  process.stdout.write("Database migrations are current.\n");
});
