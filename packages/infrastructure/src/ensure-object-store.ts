import { loadRuntimeConfig } from "./config";
import { ensureObjectStoreBucket } from "./dependencies";

const config = loadRuntimeConfig("worker");

void ensureObjectStoreBucket(config).then(() => {
  process.stdout.write(`Object-store bucket ${config.OBJECT_STORE_BUCKET} is ready.\n`);
});
