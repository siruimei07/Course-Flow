import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const outRoot = path.resolve('out');
const timeoutMilliseconds = 20_000;
const terminationGraceMilliseconds = 1_000;

function expectedWrapper(relativePath) {
  if (process.platform === 'win32' && process.arch === 'x64') {
    return /(?:^|\/)[^/]+-win32-x64\/CourseFlow Dev\.exe$/.test(relativePath);
  }
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return /(?:^|\/)[^/]+-darwin-arm64\/CourseFlow Dev\.app\/Contents\/MacOS\/CourseFlow Dev$/.test(relativePath);
  }
  throw new Error(`unsupported host ${process.platform}/${process.arch}; expected win32/x64 or darwin/arm64`);
}

function findWrapper() {
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

function findWindowsDescendants(rootPid, rootStartedAt, rootExitedAt, graceDeadline) {
  const snapshotTimeout = remainingGrace(graceDeadline);
  if (snapshotTimeout === 0) {
    throw new Error('termination grace elapsed before descendant discovery');
  }

  const command = [
    `Get-CimInstance Win32_Process -Filter "ParentProcessId = ${rootPid}"`,
    '| ForEach-Object {',
    '"{0}`t{1:O}" -f $_.ProcessId, $_.CreationDate',
    '}',
  ].join(' ');
  const snapshot = spawnSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: snapshotTimeout,
      windowsHide: true,
    },
  );
  if (snapshot.error) {
    throw snapshot.error;
  }
  if (snapshot.status !== 0) {
    throw new Error(`process discovery exited with code ${String(snapshot.status)}`);
  }

  return snapshot.stdout
    .split(/\r?\n/)
    .flatMap((line) => {
      const [pidText, createdText] = line.trim().split('\t');
      const pid = Number(pidText);
      const createdAt = Date.parse(createdText);
      const belongsToRecordedRoot = createdAt >= rootStartedAt && createdAt <= rootExitedAt;
      return Number.isInteger(pid) && pid > 0 && belongsToRecordedRoot ? [pid] : [];
    });
}

function killWindowsProcessTrees(targetPids, graceDeadline) {
  if (targetPids.length === 0) {
    return undefined;
  }

  const killTimeout = remainingGrace(graceDeadline);
  if (killTimeout === 0) {
    return 'termination grace elapsed before process tree kill';
  }
  const pidArguments = targetPids.flatMap((pid) => ['/PID', String(pid)]);
  const result = spawnSync('taskkill.exe', [...pidArguments, '/T', '/F'], {
    stdio: 'ignore',
    timeout: killTimeout,
    windowsHide: true,
  });
  if (result.error) {
    return result.error.message;
  }
  return result.status === 0 ? undefined : `taskkill exited with code ${String(result.status)}`;
}

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function terminateProcessTree(child, graceMilliseconds, rootStartedAt, rootExitedAt) {
  if (child.pid === undefined) {
    return 'spawned process did not expose a PID';
  }

  if (process.platform === 'win32') {
    const graceDeadline = Date.now() + graceMilliseconds;
    let targetPids = [child.pid];
    if (rootExitedAt !== undefined) {
      try {
        targetPids = findWindowsDescendants(child.pid, rootStartedAt, rootExitedAt, graceDeadline);
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
      if (targetPids.length === 0) {
        return 'exited process had no verifiable live descendants';
      }
      const killFailure = killWindowsProcessTrees(targetPids, graceDeadline);
      if (killFailure) {
        return killFailure;
      }

      const waitState = new Int32Array(new SharedArrayBuffer(4));
      let remainingPids = targetPids.filter(processIsRunning);
      while (remainingPids.length > 0) {
        const waitTimeout = remainingGrace(graceDeadline);
        if (waitTimeout === 0) {
          return `exited process descendants remain after taskkill: ${remainingPids.join(', ')}`;
        }
        Atomics.wait(waitState, 0, 0, Math.min(20, waitTimeout));
        remainingPids = targetPids.filter(processIsRunning);
      }
      return undefined;
    }

    const initialFailure = killWindowsProcessTrees(targetPids, graceDeadline);
    if (!initialFailure) {
      return undefined;
    }

    // spawnSync blocks libuv's exit callback; Node retains the root handle, so Windows cannot reuse its PID here.
    try {
      targetPids = findWindowsDescendants(child.pid, rootStartedAt, Date.now(), graceDeadline);
    } catch (error) {
      const fallbackFailure = error instanceof Error ? error.message : String(error);
      return `${initialFailure}; descendant fallback failed: ${fallbackFailure}`;
    }
    const fallbackFailure = killWindowsProcessTrees(targetPids, graceDeadline);
    if (fallbackFailure) {
      return `${initialFailure}; descendant fallback failed: ${fallbackFailure}`;
    }
    return processIsRunning(child.pid)
      ? `${initialFailure}; root process remains after exact descendant fallback`
      : undefined;
  }

  try {
    process.kill(-child.pid, 'SIGKILL');
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function runBoundedProcess(
  command,
  args,
  { timeoutMilliseconds: processTimeout, terminationGraceMilliseconds: terminationGrace, description = 'process' },
) {
  return new Promise((resolve, reject) => {
    const rootStartedAt = Date.now();
    const child = spawn(command, args, {
      detached: process.platform !== 'win32',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    let settled = false;
    let deadline;
    let rootExitedAt;

    const settle = (action) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(deadline);
      action();
    };

    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', (error) => {
      settle(() => reject(new Error(`could not start ${description}: ${error.message}`)));
    });
    child.once('exit', () => {
      rootExitedAt = Date.now();
    });
    child.once('close', (code, signal) => {
      settle(() => resolve({ code, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
    });

    deadline = setTimeout(() => {
      const observedExit =
        rootExitedAt ?? (child.exitCode !== null || child.signalCode !== null ? Date.now() : undefined);
      const terminationFailure = terminateProcessTree(child, terminationGrace, rootStartedAt, observedExit);
      const terminationResult = terminationFailure
        ? `process tree termination failed: ${terminationFailure}`
        : 'process tree was terminated';
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      settle(() =>
        reject(
          new Error(`${description} timed out after ${processTimeout}ms; ${terminationResult}`),
        ),
      );
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
