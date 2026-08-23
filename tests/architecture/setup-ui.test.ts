import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repositoryRoot = process.cwd();
const renderer = readFileSync(path.join(repositoryRoot, 'src/renderer/main.tsx'), 'utf8');
const styles = readFileSync(path.join(repositoryRoot, 'src/renderer/styles.css'), 'utf8');

test('UI-SETUP-01 exposes the bounded Current Term then Course and first Meeting flow', () => {
  assert.match(renderer, /当前学期/);
  assert.match(renderer, /学期名称/);
  assert.match(renderer, /开始日期/);
  assert.match(renderer, /结束日期/);
  assert.match(renderer, /默认时区/);
  assert.match(renderer, /创建并继续/);
  assert.match(renderer, /courseFlow\.initialize/);
  assert.match(renderer, /courseFlow\.querySetup/);
  assert.match(renderer, /courseFlow\.createTerm/);
  assert.match(renderer, /课程代码/);
  assert.match(renderer, /课程名称/);
  assert.match(renderer, /节号（可选）/);
  assert.match(renderer, /授课教师（可选）/);
  assert.match(renderer, /颜色（可选）/);
  assert.match(renderer, /学分（可选）/);
  assert.match(renderer, /课节类型/);
  assert.match(renderer, /LEC — Lecture/);
  assert.match(renderer, /TUT — Tutorial/);
  assert.match(renderer, /PRA — Practical/);
  assert.match(renderer, /星期/);
  assert.match(renderer, /开始时间/);
  assert.match(renderer, /结束时间/);
  assert.match(renderer, /生效开始日期/);
  assert.match(renderer, /生效结束日期/);
  assert.match(renderer, /地点/);
  assert.match(renderer, /待定/);
  assert.match(renderer, /保存课程与课节/);
  assert.match(renderer, /courseFlow\.createCourseWithMeeting/);
  assert.match(renderer, /学期身份/);
  assert.match(renderer, /课程身份/);
  assert.match(renderer, /课节身份/);
  assert.match(renderer, /生效日期/);
  assert.doesNotMatch(renderer, /课节教师|新增课节|拆分规则|Today|成绩|资料库|备份/);
});

test('UI-SETUP-01 keeps the confirmed light surface and keyboard/reduced-motion affordances', () => {
  assert.match(styles, /color-scheme:\s*light/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(styles, /\.setup-layout/);
  assert.match(styles, /\.setup-progress/);
  assert.match(styles, /\.setup-form/);
});
