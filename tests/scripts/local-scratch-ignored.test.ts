/**
 * @file Keeps local scratch artifacts out of `git status`, so `readDevelopmentBuildId` stays a clean
 * `development:<commit>` id and the packaged smoke can pass on a host that carries `_scratch/` references.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('the repository ignores /_scratch/ so untracked design artifacts never dirty the build id', () => {
  const lines = readFileSync(path.join(process.cwd(), '.gitignore'), 'utf8').split(/\r?\n/);
  assert.ok(lines.includes('/_scratch/'), 'expected a /_scratch/ line in .gitignore');
});
