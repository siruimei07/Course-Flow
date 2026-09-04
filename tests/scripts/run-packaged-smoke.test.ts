/**
 * @file Verifies packaged smoke deadlines and exact process-tree cleanup.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, linkSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const repositoryRoot = process.cwd();
const runnerUrl = pathToFileURL(path.join(repositoryRoot, 'scripts', 'run-packaged-smoke.mjs')).href;

function fixturePids(pidPath: string): number[] {
  if (!existsSync(pidPath)) {
    return [];
  }

  const value = JSON.parse(readFileSync(pidPath, 'utf8')) as unknown;
  return Array.isArray(value) ? value.filter((pid): pid is number => Number.isInteger(pid) && pid > 0) : [];
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function waitForResidue(pids: number[], timeoutMilliseconds: number): Promise<number[]> {
  const deadline = Date.now() + timeoutMilliseconds;
  let residue = pids.filter(isRunning);

  while (residue.length > 0 && Date.now() < deadline) {
    await delay(20);
    residue = pids.filter(isRunning);
  }

  return residue;
}

async function cleanExactFixtureProcesses(pids: number[]): Promise<void> {
  if (process.platform === 'win32') {
    for (const pid of pids) {
      spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        timeout: 1_000,
        windowsHide: true,
      });
    }
  } else {
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
          throw error;
        }
      }
    }
  }

  assert.deepEqual(await waitForResidue(pids, 1_000), [], 'fixture cleanup must remove only its recorded processes');
}

for (const parentMode of ['live', 'exit', 'slow-taskkill', 'hung-taskkill'] as const) {
  const fakeTaskkill = parentMode === 'slow-taskkill' || parentMode === 'hung-taskkill';
  const scenario = parentMode === 'live'
      ? 'while the parent is live'
      : parentMode === 'exit' ? 'after the parent exits' : `with ${parentMode}`;

  test(`packaged smoke timeout is bounded and verifies inherited-stderr cleanup ${scenario}`, {
      skip: fakeTaskkill && process.platform !== 'win32',
  }, async () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'courseflow-smoke-timeout-'));
    const descendantPath = path.join(fixtureRoot, 'descendant.mjs');
    const parentPath = path.join(fixtureRoot, 'parent.mjs');
    const harnessPath = path.join(fixtureRoot, 'harness.mjs');
    const pidPath = path.join(fixtureRoot, 'pids.json');
    const helperPidPath = path.join(fixtureRoot, 'helper-pids.txt');
    const fakeTaskkillPreloadPath = path.join(fixtureRoot, 'fake-taskkill.cjs');

    if (fakeTaskkill) {
        const helperDelay = parentMode === 'hung-taskkill' ? 'Infinity' : '1_500';
        writeFileSync(fakeTaskkillPreloadPath, [
            'const fs = require(\'node:fs\');',
            'const path = require(\'node:path\');',
            'if (path.basename(process.execPath).toLowerCase() === \'taskkill.exe\') {',
            `    fs.appendFileSync(${JSON.stringify(helperPidPath)}, process.pid + '\\n');`,
            `    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${helperDelay});`,
            `    const pids = JSON.parse(fs.readFileSync(${JSON.stringify(pidPath)}, 'utf8'));`,
            '    for (const pid of pids.reverse()) {',
            '        process.kill(pid, \'SIGKILL\');',
            '    }',
            '    process.exit(0);',
            '}',
            '',
        ].join('\n'));
        linkSync(process.execPath, path.join(fixtureRoot, 'taskkill.exe'));
    }

    writeFileSync(descendantPath, "setInterval(() => {}, 1_000);\n");
    writeFileSync(
      parentPath,
      [
        "import { spawn } from 'node:child_process';",
        "import { writeFileSync } from 'node:fs';",
        'const descendant = spawn(',
        '  process.execPath,',
        '  [process.argv[2]],',
        "  { detached: process.platform === 'win32', stdio: ['ignore', 'ignore', 'inherit'], windowsHide: true },",
        ');',
        'writeFileSync(process.argv[3], JSON.stringify([process.pid, descendant.pid]));',
        "if (process.argv[4] === 'exit') {",
        '  process.exit(0);',
        '}',
        'setInterval(() => {}, 1_000);',
        '',
      ].join('\n'),
    );
    writeFileSync(
      harnessPath,
      [
        `import { runBoundedProcess } from ${JSON.stringify(runnerUrl)};`,
        'import { readFileSync } from \'node:fs\';',
        `const isRunning = ${isRunning.toString()};`,
        ...(fakeTaskkill ? [
            `process.env.PATH = ${JSON.stringify(`${fixtureRoot}${path.delimiter}`)} + process.env.PATH;`,
            `process.env.NODE_OPTIONS = ${JSON.stringify(
                `--require=${fakeTaskkillPreloadPath.split(path.sep).join('/')}`,
            )};`,
        ] : []),
        'const started = performance.now();',
        'let message;',
        'try {',
        '  await runBoundedProcess(',
        '    process.execPath,',
        '    [',
        `      ${JSON.stringify(parentPath)},`,
        `      ${JSON.stringify(descendantPath)},`,
        `      ${JSON.stringify(pidPath)},`,
        `      ${JSON.stringify(parentMode)},`,
        '    ],',
        parentMode === 'hung-taskkill'
            ? '    { timeoutMilliseconds: 100, terminationGraceMilliseconds: 1_200 },'
            : '    { timeoutMilliseconds: 100 },',
        '  );',
        "  message = 'process unexpectedly completed';",
        '} catch (error) {',
        '  message = error instanceof Error ? error.message : String(error);',
        '}',
        `const residue = JSON.parse(readFileSync(${JSON.stringify(pidPath)}, 'utf8')).filter(isRunning);`,
        'process.stdout.write(JSON.stringify({ elapsedMilliseconds: performance.now() - started, message, residue }));',
        '',
      ].join('\n'),
    );

    try {
      const execution = spawnSync(process.execPath, [harnessPath], {
        encoding: 'utf8',
        timeout: process.platform === 'win32' ? 7_500 : 3_000,
        windowsHide: true,
      });

      assert.equal(execution.status, 0, execution.stderr || execution.error?.message);
      const evidence = JSON.parse(execution.stdout) as {
          elapsedMilliseconds: number;
          message: string;
          residue: number[];
      };
      const elapsedLimit = process.platform === 'win32' && parentMode !== 'hung-taskkill' ? 6_000 : 2_000;
      assert.ok(evidence.elapsedMilliseconds < elapsedLimit, `timeout settled after ${evidence.elapsedMilliseconds}ms`);

      const pids = fixturePids(pidPath);
      assert.equal(pids.length, 2, 'fixture must record its parent and inherited-stderr descendant');
      if (parentMode === 'hung-taskkill') {
          assert.match(evidence.message, /timed out after 100ms; process tree termination failed: taskkill timed out/);
          assert.deepEqual(evidence.residue, pids, 'hung helpers must not manufacture successful cleanup');
          const helperPids = readFileSync(helperPidPath, 'utf8').trim().split(/\r?\n/).map(Number);
          assert.deepEqual(await waitForResidue(helperPids, 500), [], 'timed-out helper commands must also exit');
      } else {
          assert.match(evidence.message, /timed out after 100ms; process tree was terminated/);
          assert.deepEqual(evidence.residue, [], `${evidence.message}; PIDs ${pids.join(', ')}`);
          assert.deepEqual(pids.filter(isRunning), [], 'all recorded processes must have exited before return');
          if (parentMode === 'slow-taskkill') {
              assert.ok(evidence.elapsedMilliseconds >= 1_600, 'the slow helper must execute its full delay');
          }
      }
    } finally {
      const pids = fixturePids(pidPath);
      await cleanExactFixtureProcesses(pids);
      assert.equal(path.dirname(fixtureRoot), path.resolve(tmpdir()));
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
}

test(
  'packaged smoke reuses exited-root discovery prepared before a constrained cleanup window',
  { skip: process.platform !== 'win32' },
  async () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'courseflow-smoke-discovery-'));
    const descendantPath = path.join(fixtureRoot, 'descendant.mjs');
    const parentPath = path.join(fixtureRoot, 'parent.mjs');
    const harnessPath = path.join(fixtureRoot, 'harness.mjs');
    const pidPath = path.join(fixtureRoot, 'pids.json');

    writeFileSync(descendantPath, "setInterval(() => {}, 1_000);\n");
    writeFileSync(
      parentPath,
      [
        "import { spawn } from 'node:child_process';",
        "import { writeFileSync } from 'node:fs';",
        'const descendant = spawn(',
        '  process.execPath,',
        '  [process.argv[2]],',
        "  { detached: true, stdio: ['ignore', 'ignore', 'inherit'], windowsHide: true },",
        ');',
        'writeFileSync(process.argv[3], JSON.stringify([process.pid, descendant.pid]));',
        'process.exit(0);',
        '',
      ].join('\n'),
    );
    writeFileSync(
      harnessPath,
      [
        `import { runBoundedProcess } from ${JSON.stringify(runnerUrl)};`,
        'let message;',
        'try {',
        '  await runBoundedProcess(',
        '    process.execPath,',
        `    [${JSON.stringify(parentPath)}, ${JSON.stringify(descendantPath)}, ${JSON.stringify(pidPath)}],`,
        '    { timeoutMilliseconds: 1_500, terminationGraceMilliseconds: 600 },',
        '  );',
        "  message = 'process unexpectedly completed';",
        '} catch (error) {',
        '  message = error instanceof Error ? error.message : String(error);',
        '}',
        'process.stdout.write(JSON.stringify({ message }));',
        '',
      ].join('\n'),
    );

    try {
      const execution = spawnSync(process.execPath, [harnessPath], {
        encoding: 'utf8',
        timeout: 5_000,
        windowsHide: true,
      });

      assert.equal(execution.status, 0, execution.stderr || execution.error?.message);
      const evidence = JSON.parse(execution.stdout) as { message: string };
      assert.match(evidence.message, /timed out after 1500ms; process tree was terminated/);
      const pids = fixturePids(pidPath);
      assert.deepEqual(await waitForResidue(pids, 500), [], evidence.message);
    } finally {
      const pids = fixturePids(pidPath);
      await cleanExactFixtureProcesses(pids);
      assert.equal(path.dirname(fixtureRoot), path.resolve(tmpdir()));
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  },
);

test(
  'packaged smoke cleans the inherited-stderr descendant when the root exits during taskkill',
  { skip: process.platform !== 'win32' },
  async () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'courseflow-smoke-race-'));
    const descendantPath = path.join(fixtureRoot, 'descendant.mjs');
    const parentPath = path.join(fixtureRoot, 'parent.mjs');
    const harnessPath = path.join(fixtureRoot, 'harness.mjs');
    const pidPath = path.join(fixtureRoot, 'pids.json');
    const invocationPath = path.join(fixtureRoot, 'taskkill-invocations.txt');
    const fakeTaskkillPath = path.join(fixtureRoot, 'taskkill.exe');
    const fakeTaskkillPreloadPath = path.join(fixtureRoot, 'fake-taskkill.cjs');

    writeFileSync(descendantPath, "setInterval(() => {}, 1_000);\n");
    writeFileSync(
      parentPath,
      [
        "import { spawn } from 'node:child_process';",
        "import { writeFileSync } from 'node:fs';",
        'const descendant = spawn(',
        '  process.execPath,',
        '  [process.argv[2]],',
        "  { detached: true, stdio: ['ignore', 'ignore', 'inherit'], windowsHide: true },",
        ');',
        'writeFileSync(process.argv[3], JSON.stringify([process.pid, descendant.pid]));',
        'setInterval(() => {}, 1_000);',
        '',
      ].join('\n'),
    );
    writeFileSync(
      fakeTaskkillPreloadPath,
      [
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        "if (path.basename(process.execPath).toLowerCase() === 'taskkill.exe') {",
        "  const pidIndex = process.argv.findIndex((value) => path.basename(value).toUpperCase() === 'PID');",
        '  const rootPid = Number(process.argv[pidIndex + 1]);',
        '  const recordedPids = JSON.parse(fs.readFileSync(process.env.COURSEFLOW_FAKE_TASKKILL_PIDS, "utf8"));',
        '  const invocationPath = process.env.COURSEFLOW_FAKE_TASKKILL_INVOCATIONS;',
        '  if (rootPid !== recordedPids[0]) {',
        '    try {',
        "      process.kill(rootPid, 'SIGKILL');",
        '      fs.appendFileSync(invocationPath, `fallback:${rootPid}:exit-0\\n`);',
        '      process.exit(0);',
        '    } catch {',
        '      process.exit(129);',
        '    }',
        '  }',
        "  process.kill(rootPid, 'SIGKILL');",
        '  const waitState = new Int32Array(new SharedArrayBuffer(4));',
        '  const waitDeadline = Date.now() + 500;',
        '  while (Date.now() < waitDeadline) {',
        '    try {',
        '      process.kill(rootPid, 0);',
        '    } catch (error) {',
        "      if (error.code === 'ESRCH') {",
        '        fs.appendFileSync(invocationPath, `root:${rootPid}:exit-128\\n`);',
        '        process.exit(128);',
        '      }',
        '      throw error;',
        '    }',
        '    Atomics.wait(waitState, 0, 0, 5);',
        '  }',
        '  fs.appendFileSync(invocationPath, `root:${rootPid}:exit-128\\n`);',
        '  process.exit(128);',
        '}',
        '',
      ].join('\n'),
    );
    linkSync(process.execPath, fakeTaskkillPath);
    writeFileSync(
      harnessPath,
      [
        `import { runBoundedProcess } from ${JSON.stringify(runnerUrl)};`,
        `process.env.PATH = ${JSON.stringify(`${fixtureRoot}${path.delimiter}`)} + process.env.PATH;`,
        `process.env.COURSEFLOW_FAKE_TASKKILL_PIDS = ${JSON.stringify(pidPath)};`,
        `process.env.COURSEFLOW_FAKE_TASKKILL_INVOCATIONS = ${JSON.stringify(invocationPath)};`,
        `process.env.NODE_OPTIONS = ${JSON.stringify(
          `--require=${fakeTaskkillPreloadPath.split(path.sep).join('/')}`,
        )};`,
        'const started = performance.now();',
        'let message;',
        'try {',
        '  const result = await runBoundedProcess(',
        '    process.execPath,',
        '    [',
        `      ${JSON.stringify(parentPath)},`,
        `      ${JSON.stringify(descendantPath)},`,
        `      ${JSON.stringify(pidPath)},`,
        '    ],',
        '    { timeoutMilliseconds: 500, terminationGraceMilliseconds: 1_200 },',
        '  );',
        "  message = `process unexpectedly completed: code=${result.code}; stderr=${result.stderr.toString('utf8')}`;",
        '} catch (error) {',
        '  message = error instanceof Error ? error.message : String(error);',
        '}',
        'process.stdout.write(JSON.stringify({ elapsedMilliseconds: performance.now() - started, message }));',
        '',
      ].join('\n'),
    );

    try {
      const execution = spawnSync(process.execPath, [harnessPath], {
        encoding: 'utf8',
        timeout: 4_000,
        windowsHide: true,
      });

      assert.equal(execution.status, 0, execution.stderr || execution.error?.message);
      const evidence = JSON.parse(execution.stdout) as { elapsedMilliseconds: number; message: string };
      assert.match(evidence.message, /timed out after 500ms/);
      assert.ok(evidence.elapsedMilliseconds < 2_500, `timeout settled after ${evidence.elapsedMilliseconds}ms`);

      const pids = fixturePids(pidPath);
      assert.equal(pids.length, 2, 'fixture must record the raced root and inherited-stderr descendant');
      assert.deepEqual(readFileSync(invocationPath, 'utf8').trim().split(/\r?\n/), [
        `root:${pids[0]}:exit-128`,
        `fallback:${pids[1]}:exit-0`,
      ]);
      assert.deepEqual(await waitForResidue(pids, 500), [], evidence.message);
    } finally {
      const pids = fixturePids(pidPath);
      await cleanExactFixtureProcesses(pids);
      assert.equal(path.dirname(fixtureRoot), path.resolve(tmpdir()));
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  },
);

test(
  'packaged smoke does not report taskkill success while an exact exited-root descendant remains',
  { skip: process.platform !== 'win32' },
  async () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'courseflow-smoke-postcondition-'));
    const descendantPath = path.join(fixtureRoot, 'descendant.mjs');
    const parentPath = path.join(fixtureRoot, 'parent.mjs');
    const harnessPath = path.join(fixtureRoot, 'harness.mjs');
    const pidPath = path.join(fixtureRoot, 'pids.json');
    const invocationPath = path.join(fixtureRoot, 'taskkill-invocation.txt');
    const fakeTaskkillPath = path.join(fixtureRoot, 'taskkill.exe');
    const fakeTaskkillPreloadPath = path.join(fixtureRoot, 'fake-taskkill.cjs');

    writeFileSync(descendantPath, "setInterval(() => {}, 1_000);\n");
    writeFileSync(
      parentPath,
      [
        "import { spawn } from 'node:child_process';",
        "import { writeFileSync } from 'node:fs';",
        'const descendant = spawn(',
        '  process.execPath,',
        '  [process.argv[2]],',
        "  { detached: true, stdio: ['ignore', 'ignore', 'inherit'], windowsHide: true },",
        ');',
        'writeFileSync(process.argv[3], JSON.stringify([process.pid, descendant.pid]));',
        'process.exit(0);',
        '',
      ].join('\n'),
    );
    writeFileSync(
      fakeTaskkillPreloadPath,
      [
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        "if (path.basename(process.execPath).toLowerCase() === 'taskkill.exe') {",
        "  const pidIndex = process.argv.findIndex((value) => path.basename(value).toUpperCase() === 'PID');",
        '  fs.writeFileSync(process.env.COURSEFLOW_FAKE_TASKKILL_INVOCATION, process.argv[pidIndex + 1]);',
        '  process.exit(0);',
        '}',
        '',
      ].join('\n'),
    );
    linkSync(process.execPath, fakeTaskkillPath);
    writeFileSync(
      harnessPath,
      [
        `import { runBoundedProcess } from ${JSON.stringify(runnerUrl)};`,
        `process.env.PATH = ${JSON.stringify(`${fixtureRoot}${path.delimiter}`)} + process.env.PATH;`,
        `process.env.COURSEFLOW_FAKE_TASKKILL_INVOCATION = ${JSON.stringify(invocationPath)};`,
        `process.env.NODE_OPTIONS = ${JSON.stringify(
          `--require=${fakeTaskkillPreloadPath.split(path.sep).join('/')}`,
        )};`,
        'const started = performance.now();',
        'let message;',
        'try {',
        '  await runBoundedProcess(',
        '    process.execPath,',
        `    [${JSON.stringify(parentPath)}, ${JSON.stringify(descendantPath)}, ${JSON.stringify(pidPath)}],`,
        '    { timeoutMilliseconds: 500, terminationGraceMilliseconds: 1_200 },',
        '  );',
        "  message = 'process unexpectedly completed';",
        '} catch (error) {',
        '  message = error instanceof Error ? error.message : String(error);',
        '}',
        'process.stdout.write(JSON.stringify({ elapsedMilliseconds: performance.now() - started, message }));',
        '',
      ].join('\n'),
    );

    try {
      const execution = spawnSync(process.execPath, [harnessPath], {
        encoding: 'utf8',
        timeout: 4_000,
        windowsHide: true,
      });

      assert.equal(execution.status, 0, execution.stderr || execution.error?.message);
      const evidence = JSON.parse(execution.stdout) as { elapsedMilliseconds: number; message: string };
      assert.match(
        evidence.message,
        /timed out after 500ms; process tree termination failed: exited process descendants remain after taskkill/,
      );
      assert.ok(evidence.elapsedMilliseconds < 2_500, `timeout settled after ${evidence.elapsedMilliseconds}ms`);

      const pids = fixturePids(pidPath);
      assert.equal(pids.length, 2, 'fixture must record its exited parent and inherited-stderr descendant');
      assert.equal(Number(readFileSync(invocationPath, 'utf8')), pids[1]);
      assert.equal(isRunning(pids[1]), true, 'fake taskkill must leave the exact descendant running');
    } finally {
      const pids = fixturePids(pidPath);
      await cleanExactFixtureProcesses(pids);
      assert.equal(path.dirname(fixtureRoot), path.resolve(tmpdir()));
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  },
);
