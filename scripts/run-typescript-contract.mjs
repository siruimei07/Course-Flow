import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const entryPoint = process.argv[2];
if (entryPoint === undefined || !entryPoint.endsWith(".ts")) {
  throw new Error("Usage: node scripts/run-typescript-contract.mjs <entry.ts>");
}

const environment = { ...process.env };
for (const line of (await readFile(".env", "utf8")).split(/\r?\n/u)) {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("#")) continue;
  const separator = trimmed.indexOf("=");
  if (separator < 1) continue;
  const key = trimmed.slice(0, separator).trim();
  const value = trimmed.slice(separator + 1).trim();
  environment[key] ??= value;
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), "courseflow-contract-"));
const output = join(temporaryDirectory, "contract.cjs");
try {
  await build({
    absWorkingDir: process.cwd(),
    bundle: true,
    entryPoints: [entryPoint],
    format: "cjs",
    outfile: output,
    platform: "node",
    target: "node24",
  });
  const child = spawn(process.execPath, [output], { env: environment, stdio: "inherit" });
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal !== null) reject(new Error(`Contract process ended with ${signal}.`));
      else resolve(code ?? 1);
    });
  });
  if (exitCode !== 0) process.exitCode = exitCode;
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}
