import { readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";

const denied = new Set(["AGPL-3.0", "AGPL-3.0-only", "AGPL-3.0-or-later", "SSPL-1.0"]);
const visited = new Set();
const violations = new Set();

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function resolveDependencyRoot(from, dependency) {
  let current = from;

  while (true) {
    const candidate = path.join(current, "node_modules", ...dependency.split("/"));
    try {
      return await realpath(candidate);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

async function inspectPackage(packageRoot) {
  let resolvedRoot;
  try {
    resolvedRoot = await realpath(packageRoot);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (visited.has(resolvedRoot)) return;
  visited.add(resolvedRoot);

  const manifest = await readJson(path.join(resolvedRoot, "package.json"));
  const licenses =
    typeof manifest.license === "string" ? (manifest.license.match(/[A-Za-z0-9.-]+/g) ?? []) : [];

  for (const license of licenses) {
    if (denied.has(license)) violations.add(`${manifest.name}@${manifest.version}: ${license}`);
  }

  const dependencies = {
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
  };

  for (const dependency of Object.keys(dependencies)) {
    const dependencyRoot = await resolveDependencyRoot(resolvedRoot, dependency);
    if (dependencyRoot) await inspectPackage(dependencyRoot);
  }
}

for (const workspaceGroup of ["apps", "packages"]) {
  for (const entry of await readdir(workspaceGroup, { withFileTypes: true })) {
    if (entry.isDirectory()) await inspectPackage(path.join(workspaceGroup, entry.name));
  }
}

if (violations.size > 0) {
  throw new Error(`Denied production licenses found: ${[...violations].join(", ")}`);
}

process.stdout.write(
  `Production dependency license policy passed (${visited.size} packages checked).\n`,
);
