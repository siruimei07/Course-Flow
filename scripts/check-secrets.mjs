import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const trackedFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  {
    encoding: "utf8",
  },
)
  .split(/\r?\n/u)
  .filter(Boolean)
  .filter((file) => !file.endsWith("pnpm-lock.yaml") && !file.startsWith("tests/fixtures/"));

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /(?:sk|rk|pk)-(?:live|prod)-[A-Za-z0-9_-]{16,}/u,
  /AKIA[0-9A-Z]{16}/u,
  /github_pat_[A-Za-z0-9_]{20,}/u,
  /(?:DEEPSEEK_(?:API_)?(?:KEY|TOKEN|SECRET)|(?:KEY|TOKEN|SECRET)_DEEPSEEK)\s*=\s*[^\s"']+/iu,
];

for (const file of trackedFiles) {
  const content = await readFile(file, "utf8").catch(() => "");
  for (const pattern of secretPatterns) {
    if (pattern.test(content)) throw new Error(`Potential secret detected in ${file}`);
  }
}

process.stdout.write(`Secret scan passed for ${trackedFiles.length} source files.\n`);
