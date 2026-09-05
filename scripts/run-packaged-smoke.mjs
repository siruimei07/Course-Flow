/**
 * @file Runs the packaged wrapper smoke probe with bounded process-tree cleanup.
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const outRoot = path.resolve('out');
const timeoutMilliseconds = 20_000;
// Windows helper startup and process discovery can exceed one second under test-suite load.
const terminationGraceMilliseconds = process.platform === 'win32' ? 5_000 : 1_000;

function expectedWrapper(relativePath) {
  if (process.platform === 'win32' && process.arch === 'x64') {
    return /(?:^|\/)[^/]+-win32-x64\/CourseFlow Dev\.exe$/.test(relativePath);
  }
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return /(?:^|\/)[^/]+-darwin-arm64\/CourseFlow Dev\.app\/Contents\/MacOS\/CourseFlow Dev$/.test(relativePath);
  }
  throw new Error(`unsupported host ${process.platform}/${process.arch}; expected win32/x64 or darwin/arm64`);
}

export function findWrapper() {
  if (!existsSync(outRoot)) {
    throw new Error('out/ does not exist; run pnpm package first');
  }

  const candidates = [];
  const pendingDirectories = [outRoot];
  while (pendingDirectories.length > 0) {
    const directory = pendingDirectories.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pendingDirectories.push(entryPath);
      } else if (entry.isFile()) {
        const relativePath = path.relative(outRoot, entryPath).split(path.sep).join('/');
        if (expectedWrapper(relativePath)) {
          candidates.push(entryPath);
        }
      }
    }
  }

  if (candidates.length === 0) {
    throw new Error(`no final wrapper for ${process.platform}/${process.arch} under out/; run pnpm package`);
  }
  if (candidates.length > 1) {
    throw new Error(
      `found ${candidates.length} final wrappers for ${process.platform}/${process.arch}` +
        ' under out/; remove stale packages',
    );
  }
  return candidates[0];
}

function remainingGrace(graceDeadline) {
  return Math.max(0, graceDeadline - Date.now());
}

/**
 * Starts one helper command bounded by the caller's absolute cleanup deadline.
 *
 * @param {string} command Executable name.
 * @param {string[]} args Exact arguments.
 * @param {object} options Capture and deadline options.
 * @return {object} Promise and idempotent cancellation handle.
 */
function startBoundedCommand(command, args, { captureStderr = false, captureStdout = false, deadline }) {
  let commandChild;
  let commandTimer;
  let finish;
  let settled = false;
  const stderr = [];
  const stdout = [];

  const promise = new Promise((resolve) => {
    finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(commandTimer);
      resolve({
        ...result,
        stderr: Buffer.concat(stderr).toString('utf8'),
        stdout: Buffer.concat(stdout).toString('utf8'),
      });
    };

    const commandTimeout = remainingGrace(deadline);
    if (commandTimeout === 0) {
      finish({ kind: 'timed-out' });
      return;
    }

    commandChild = spawn(command, args, {
      stdio: ['ignore', captureStdout ? 'pipe' : 'ignore', captureStderr ? 'pipe' : 'ignore'],
      windowsHide: true,
    });
    commandChild.stdout?.on('data', (chunk) => stdout.push(chunk));
    commandChild.stderr?.on('data', (chunk) => stderr.push(chunk));
    commandChild.once('error', (error) => finish({ error, kind: 'error' }));
    commandChild.once('close', (code, signal) => finish({ code, kind: 'close', signal }));
    commandTimer = setTimeout(() => {
      commandChild.kill();
      commandChild.stdout?.destroy();
      commandChild.stderr?.destroy();
      commandChild.unref();
      finish({ kind: 'timed-out' });
    }, commandTimeout);
  });

  return {
    cancel() {
      if (settled) {
        return;
      }
      commandChild?.kill();
      commandChild?.stdout?.destroy();
      commandChild?.stderr?.destroy();
      commandChild?.unref();
      finish({ kind: 'cancelled' });
    },
    promise,
  };
}

/**
 * Starts exact Windows descendant discovery while the root PID evidence is fresh.
 *
 * @param {number} rootPid Recorded root PID.
 * @param {number} rootStartedAt Root creation lower bound in epoch milliseconds.
 * @param {number} rootExitedAt Root exit upper bound in epoch milliseconds.
 * @param {number} graceDeadline Absolute cleanup deadline.
 * @return {object} Promise and cancellation handle for the path-free PID snapshot.
 */
function startWindowsDescendantDiscovery(rootPid, rootStartedAt, rootExitedAt, graceDeadline) {
  const command = [
    '$query = "SELECT ProcessId, CreationDate FROM Win32_Process',
    `WHERE ParentProcessId = ${rootPid}";`,
    '$searcher = [System.Management.ManagementObjectSearcher]::new($query);',
    '$searcher.Get() | ForEach-Object {',
    '"{0}`t{1:O}" -f $_.ProcessId,',
    '[System.Management.ManagementDateTimeConverter]::ToDateTime($_.CreationDate)',
    '}',
  ].join(' ');
  const execution = startBoundedCommand(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
    {
      captureStderr: true,
      captureStdout: true,
      deadline: graceDeadline,
    },
  );
  return {
    cancel: execution.cancel,
    promise: execution.promise.then((result) => {
      if (result.kind === 'timed-out') {
        return { failure: 'process discovery timed out' };
      }
      if (result.kind === 'cancelled') {
        return { failure: 'process discovery was cancelled' };
      }
      if (result.kind === 'error') {
        return { failure: result.error.message };
      }
      if (result.code !== 0) {
        const detail = result.stderr.trim();
        return {
          failure: `process discovery exited with code ${String(result.code)}${detail ? `: ${detail}` : ''}`,
        };
      }

      const targetPids = result.stdout
        .split(/\r?\n/)
        .flatMap((line) => {
          const [pidText, createdText] = line.trim().split('\t');
          const pid = Number(pidText);
          const createdAt = Date.parse(createdText);
          const belongsToRecordedRoot = createdAt >= rootStartedAt && createdAt <= rootExitedAt;
          return Number.isInteger(pid) && pid > 0 && belongsToRecordedRoot ? [pid] : [];
        });
      return { targetPids: [...new Set(targetPids)] };
    }),
  };
}

/**
 * Terminates exact Windows process trees within the shared cleanup deadline.
 *
 * @param {number[]} targetPids Verified process identities.
 * @param {number} graceDeadline Absolute cleanup deadline.
 * @return {Promise<string | undefined>} Failure reason, or undefined after taskkill success.
 */
async function killWindowsProcessTrees(targetPids, graceDeadline) {
  if (targetPids.length === 0) {
    return undefined;
  }

  const pidArguments = targetPids.flatMap((pid) => ['/PID', String(pid)]);
  const execution = startBoundedCommand('taskkill.exe', [...pidArguments, '/T', '/F'], {
    deadline: graceDeadline,
  });
  const result = await execution.promise;
  if (result.kind === 'timed-out') {
    return 'taskkill timed out';
  }
  if (result.kind === 'error') {
    return result.error.message;
  }
  if (result.kind === 'cancelled') {
    return 'taskkill was cancelled';
  }
  return result.code === 0 ? undefined : `taskkill exited with code ${String(result.code)}`;
}

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

/**
 * Polls the exact process postcondition without blocking child-process events.
 *
 * @param {number[]} targetPids Verified process identities.
 * @param {number} graceDeadline Absolute cleanup deadline.
 * @return {Promise<number[]>} Processes still live when the deadline is reached.
 */
async function waitForProcessExit(targetPids, graceDeadline) {
  let remainingPids = targetPids.filter(processIsRunning);
  while (remainingPids.length > 0) {
    const waitTimeout = remainingGrace(graceDeadline);
    if (waitTimeout === 0) {
      return remainingPids;
    }
    await delay(Math.min(20, waitTimeout));
    remainingPids = targetPids.filter(processIsRunning);
  }
  return [];
}

/**
 * Awaits one cached discovery handle and preserves its stable failure vocabulary.
 *
 * @param {object} discovery Descendant discovery handle.
 * @return {Promise<object>} Exact target PIDs or a failure reason.
 */
async function exitedRootTargets(discovery) {
  const result = await discovery.promise;
  return result.failure ? { failure: result.failure } : { targetPids: result.targetPids };
}

/**
 * Cleans and verifies descendants after their recorded root has exited.
 *
 * @param {object} discovery Cached exact descendant discovery.
 * @param {number} graceDeadline Absolute cleanup deadline.
 * @return {Promise<string | undefined>} Failure reason, or undefined after verified cleanup.
 */
async function terminateExitedRoot(discovery, graceDeadline) {
  const targetResult = await exitedRootTargets(discovery);
  if (targetResult.failure) {
    return targetResult.failure;
  }
  if (targetResult.targetPids.length === 0) {
    return 'exited process had no verifiable live descendants';
  }

  const killFailure = await killWindowsProcessTrees(targetResult.targetPids, graceDeadline);
  if (killFailure) {
    return killFailure;
  }
  const remainingPids = await waitForProcessExit(targetResult.targetPids, graceDeadline);
  return remainingPids.length > 0
    ? `exited process descendants remain after taskkill: ${remainingPids.join(', ')}`
    : undefined;
}

/**
 * Terminates the live root tree or its exact exited-root descendants.
 *
 * @param {import('node:child_process').ChildProcess} child Spawned root process.
 * @param {number} graceDeadline Absolute cleanup deadline.
 * @param {number} rootStartedAt Root creation lower bound.
 * @param {Function} observeRootExit Returns current exit evidence and cached discovery.
 * @return {Promise<string | undefined>} Failure reason, or undefined after cleanup.
 */
async function terminateProcessTree(child, graceDeadline, rootStartedAt, observeRootExit) {
  if (child.pid === undefined) {
    return 'spawned process did not expose a PID';
  }

  if (process.platform === 'win32') {
    let exitEvidence = observeRootExit();
    if (exitEvidence.discovery) {
      return terminateExitedRoot(exitEvidence.discovery, graceDeadline);
    }

    // Preserve cleanup time for exact descendant discovery if the root-tree command stalls.
    const initialDeadline = Date.now() + Math.floor(remainingGrace(graceDeadline) / 2);
    const initialFailure = await killWindowsProcessTrees([child.pid], initialDeadline);
    if (!initialFailure) {
      return undefined;
    }

    exitEvidence = observeRootExit();
    const fallbackDiscovery =
      exitEvidence.discovery ??
      startWindowsDescendantDiscovery(child.pid, rootStartedAt, Date.now(), graceDeadline);
    const targetResult = await exitedRootTargets(fallbackDiscovery);
    if (targetResult.failure) {
      return `${initialFailure}; descendant fallback failed: ${targetResult.failure}`;
    }
    const fallbackFailure = await killWindowsProcessTrees(targetResult.targetPids, graceDeadline);
    if (fallbackFailure) {
      return `${initialFailure}; descendant fallback failed: ${fallbackFailure}`;
    }
    const remainingPids = await waitForProcessExit(targetResult.targetPids, graceDeadline);
    if (remainingPids.length > 0) {
      return `${initialFailure}; descendants remain after fallback: ${remainingPids.join(', ')}`;
    }
    return processIsRunning(child.pid)
      ? `${initialFailure}; root process remains after exact descendant fallback`
      : undefined;
  }

  try {
    process.kill(-child.pid, 'SIGKILL');
    const remainingProcessGroup = await waitForProcessExit([-child.pid], graceDeadline);
    return remainingProcessGroup.length === 0 ? undefined : 'process group remains after SIGKILL';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Runs one process until close or a timeout with verified process-tree cleanup.
 *
 * @param {string} command Executable path.
 * @param {string[]} args Exact arguments.
 * @param {object} options Timeout, cleanup grace, description, and native window visibility.
 * @return {Promise<object>} Closed process result.
 */
export function runBoundedProcess(
  command,
  args,
  {
      timeoutMilliseconds: processTimeout,
      terminationGraceMilliseconds: terminationGrace = terminationGraceMilliseconds,
      description = 'process',
      windowsHide = true,
  },
) {
  return new Promise((resolve, reject) => {
    const rootStartedAt = Date.now();
    const processDeadline = rootStartedAt + processTimeout;
    const terminationDeadline = processDeadline + terminationGrace;
    const child = spawn(command, args, {
      detached: process.platform !== 'win32',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide,
    });
    const stdout = [];
    const stderr = [];
    let settled = false;
    let deadline;
    let rootExitedAt;
    let rootExitDiscovery;

    const observeRootExit = (observedAt) => {
      if (rootExitedAt === undefined && observedAt !== undefined) {
        rootExitedAt = observedAt;
      }
      if (
        process.platform === 'win32' &&
        rootExitedAt !== undefined &&
        rootExitDiscovery === undefined &&
        child.pid !== undefined
      ) {
        rootExitDiscovery = startWindowsDescendantDiscovery(
          child.pid,
          rootStartedAt,
          rootExitedAt,
          terminationDeadline,
        );
      }
      return { discovery: rootExitDiscovery, rootExitedAt };
    };

    const settle = (action) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(deadline);
      rootExitDiscovery?.cancel();
      action();
    };

    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', (error) => {
      settle(() => reject(new Error(`could not start ${description}: ${error.message}`)));
    });
    child.once('exit', () => {
      observeRootExit(Date.now());
    });
    child.once('close', (code, signal) => {
      settle(() => resolve({ code, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
    });

    deadline = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(deadline);
      if (child.exitCode !== null || child.signalCode !== null) {
        observeRootExit(Date.now());
      }

      void (async () => {
        let terminationFailure;
        try {
          terminationFailure = await terminateProcessTree(
            child,
            terminationDeadline,
            rootStartedAt,
            observeRootExit,
          );
        } catch (error) {
          terminationFailure = error instanceof Error ? error.message : String(error);
        }
        const terminationResult = terminationFailure
          ? `process tree termination failed: ${terminationFailure}`
          : 'process tree was terminated';
        rootExitDiscovery?.cancel();
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        reject(new Error(`${description} timed out after ${processTimeout}ms; ${terminationResult}`));
      })();
    }, processTimeout);
  });
}

function runWrapper(wrapperPath) {
  return runBoundedProcess(wrapperPath, ['--courseflow-smoke'], {
    timeoutMilliseconds,
    terminationGraceMilliseconds,
    description: 'final wrapper',
  });
}

function parseSmokeLine(stdout) {
  const nonEmptyLines = stdout
    .toString('utf8')
    .split(/\r\n|\n|\r/)
    .filter((line) => line.trim().length > 0);

  if (nonEmptyLines.length !== 1) {
    throw new Error(`stdout must contain exactly one non-empty JSON line; received ${nonEmptyLines.length}`);
  }

  try {
    return JSON.parse(nonEmptyLines[0].trim());
  } catch {
    throw new Error('the single non-empty stdout line is not valid JSON');
  }
}

function supportedSqliteVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) {
    return false;
  }
  const [major, minor] = match.slice(1, 3).map(Number);
  return major > 3 || (major === 3 && minor >= 37);
}

function validateSmokeResult(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('smoke JSON must be an object');
  }

  const expectedKeys = ['appBuildId', 'dataRootClass', 'kind', 'ok', 'sqliteVersion'];
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys)) {
    throw new Error('smoke JSON does not have the exact required shape');
  }
  if (value.kind !== 'courseflow.smoke' || value.ok !== true) {
    throw new Error('smoke JSON did not report courseflow.smoke success');
  }
  if (typeof value.appBuildId !== 'string' || !/^development:[0-9a-f]{40}$/.test(value.appBuildId)) {
    throw new Error('appBuildId must be a clean development:<40 lowercase hex> build');
  }
  if (typeof value.sqliteVersion !== 'string' || !supportedSqliteVersion(value.sqliteVersion)) {
    throw new Error('sqliteVersion must be a supported SQLite release >= 3.37.0');
  }
  if (value.dataRootClass !== 'verified-local') {
    throw new Error('dataRootClass must be verified-local');
  }

  const serialized = JSON.stringify(value);
  if (/[A-Za-z]:(?:\\\\|\/)|\\\\\\\\|\/Users\//.test(serialized)) {
    throw new Error('smoke JSON must not serialize a Windows, UNC, or macOS user path');
  }
  return value;
}

async function main() {
  const wrapper = findWrapper();
  const result = await runWrapper(wrapper);
  if (result.code !== 0) {
    const signal = result.signal ? ` (${result.signal})` : '';
    throw new Error(`final wrapper exited with code ${String(result.code)}${signal}`);
  }
  if (result.stderr.length !== 0) {
    throw new Error(`final wrapper wrote ${result.stderr.length} byte(s) to stderr`);
  }

  const smoke = validateSmokeResult(parseSmokeLine(result.stdout));
  const platformEvidence = `${process.platform}/${process.arch} ${smoke.appBuildId}`;
  process.stdout.write(
    `PASS packaged smoke ${platformEvidence} SQLite ${smoke.sqliteVersion} verified-local\n`,
  );
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`FAIL packaged smoke: ${message}\n`);
    process.exitCode = 1;
  });
}
