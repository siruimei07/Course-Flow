import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repositoryRoot = process.cwd();
const renderer = readFileSync(path.join(repositoryRoot, 'src/renderer/main.tsx'), 'utf8');
const styles = readFileSync(path.join(repositoryRoot, 'src/renderer/styles.css'), 'utf8');

test('UI-SETUP-01 exposes only the bounded Current Term setup fields and action', () => {
  assert.match(renderer, /当前学期/);
  assert.match(renderer, /学期名称/);
  assert.match(renderer, /开始日期/);
  assert.match(renderer, /结束日期/);
  assert.match(renderer, /默认时区/);
  assert.match(renderer, /创建并继续/);
  assert.match(renderer, /courseFlow\.initialize/);
  assert.match(renderer, /courseFlow\.querySetup/);
  assert.match(renderer, /courseFlow\.createTerm/);
  assert.doesNotMatch(renderer, /课程 meeting|Today|成绩|资料库|备份/);
});

test('UI-SETUP-01 keeps the confirmed light surface and keyboard/reduced-motion affordances', () => {
  assert.match(styles, /color-scheme:\s*light/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(styles, /\.setup-layout/);
  assert.match(styles, /\.setup-progress/);
  assert.match(styles, /\.setup-form/);
});
