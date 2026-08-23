import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { WorkspaceSupervisor } from '../../src/main/workspace-supervisor';
import { makeBootstrapRequest } from '../../src/shared/bootstrap-contract';

const repositoryRoot = process.cwd();
const appBuildId = '0.0.0-dev';

class FakeUtilityProcess extends EventEmitter {
  readonly messages: unknown[] = [];
  killed = false;
  killCount = 0;

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  kill(): void {
    this.killed = true;
    this.killCount += 1;
  }
}

type ScheduledTimer = { callback: () => void; cleared: boolean; delay: number };

function useControlledTimers(t: test.TestContext): ScheduledTimer[] {
  const timers: ScheduledTimer[] = [];
  const setTimeout = globalThis.setTimeout;
  const clearTimeout = globalThis.clearTimeout;

  globalThis.setTimeout = ((callback: () => void, delay?: number) => {
    const timer = { callback, cleared: false, delay: delay ?? 0 };
    timers.push(timer);
    return timer as unknown as ReturnType<typeof setTimeout>;
  }) as typeof globalThis.setTimeout;
  globalThis.clearTimeout = ((timer: ScheduledTimer) => {
    timer.cleared = true;
  }) as unknown as typeof globalThis.clearTimeout;

  t.after(() => {
    globalThis.setTimeout = setTimeout;
    globalThis.clearTimeout = clearTimeout;
  });

  return timers;
}

function unavailable(requestId: string) {
  return {
    ok: false as const,
    problem: {
      code: 'workspace-unavailable' as const,
      message: 'Workspace is unavailable. Please try again.',
      requestId,
      appBuildId,
    },
  };
}

test('WorkspaceSupervisor resolves a matching ready response and clears its timeout', async (t) => {
  const timers = useControlledTimers(t);
  const child = new FakeUtilityProcess();
  const supervisor = new WorkspaceSupervisor(appBuildId, child);
  const request = makeBootstrapRequest('request-ready', appBuildId);
  const outcomePromise = supervisor.query(request, 'verified-local');

  assert.deepEqual(child.messages, [{ ...request, dataRootClass: 'verified-local' }]);
  assert.equal(timers.length, 1);
  assert.equal(timers[0]!.delay, 5_000);

  child.emit('message', {
    ok: true,
    value: {
      protocolVersion: 1,
      appBuildId,
      requestId: 'request-ready',
      workspaceProcess: 'ready',
      sqliteVersion: '3.50.4',
      dataRootClass: 'verified-local',
    },
  });

  assert.deepEqual(await outcomePromise, {
    ok: true,
    value: {
      protocolVersion: 1,
      appBuildId,
      requestId: 'request-ready',
      workspaceProcess: 'ready',
      sqliteVersion: '3.50.4',
      dataRootClass: 'verified-local',
    },
  });
  assert.equal(timers[0]!.cleared, true);
});

test('WorkspaceSupervisor maps malformed response data to an unavailable problem', async () => {
  const child = new FakeUtilityProcess();
  const supervisor = new WorkspaceSupervisor(appBuildId, child);
  const outcomePromise = supervisor.query(makeBootstrapRequest('request-malformed', appBuildId), 'verified-local');

  child.emit('message', { ok: true, value: { workspaceProcess: 'ready' } });

  assert.deepEqual(await outcomePromise, unavailable('request-malformed'));
});

test('WorkspaceSupervisor maps an elapsed response timer to an unavailable problem', async (t) => {
  const timers = useControlledTimers(t);
  const child = new FakeUtilityProcess();
  const supervisor = new WorkspaceSupervisor(appBuildId, child);
  const outcomePromise = supervisor.query(makeBootstrapRequest('request-timeout', appBuildId), 'verified-local');

  timers[0]!.callback();

  assert.deepEqual(await outcomePromise, unavailable('request-timeout'));
});

test('WorkspaceSupervisor settles pending and later queries as unavailable after child exit', async () => {
  const child = new FakeUtilityProcess();
  const supervisor = new WorkspaceSupervisor(appBuildId, child);
  const pending = supervisor.query(makeBootstrapRequest('request-exit', appBuildId), 'verified-local');

  child.emit('exit');

  assert.deepEqual(await pending, unavailable('request-exit'));
  assert.deepEqual(
    await supervisor.query(makeBootstrapRequest('request-after-exit', appBuildId), 'verified-local'),
    unavailable('request-after-exit'),
  );
});

test('WorkspaceSupervisor handles child error before exit without leaving a pending query', async (t) => {
  const timers = useControlledTimers(t);
  const child = new FakeUtilityProcess();
  const supervisor = new WorkspaceSupervisor(appBuildId, child);
  const pending = supervisor.query(makeBootstrapRequest('request-error', appBuildId), 'verified-local');

  assert.doesNotThrow(() => child.emit('error', new Error('utility failure')));

  assert.equal(timers[0]!.cleared, true);
  assert.deepEqual(await pending, unavailable('request-error'));
  child.emit('exit', 1);
  assert.deepEqual(
    await supervisor.query(makeBootstrapRequest('request-after-error', appBuildId), 'verified-local'),
    unavailable('request-after-error'),
  );
});

test('WorkspaceSupervisor disposes child resources once after child error', async (t) => {
  const timers = useControlledTimers(t);
  const child = new FakeUtilityProcess();
  const supervisor = new WorkspaceSupervisor(appBuildId, child);
  const pending = supervisor.query(makeBootstrapRequest('request-error-dispose', appBuildId), 'verified-local');

  child.emit('error', new Error('utility failure'));
  assert.deepEqual(await pending, unavailable('request-error-dispose'));

  supervisor.dispose();
  supervisor.dispose();

  assert.equal(timers[0]!.cleared, true);
  assert.equal(child.killCount, 1);
  assert.equal(child.listenerCount('message'), 0);
  assert.equal(child.listenerCount('error'), 0);
  assert.equal(child.listenerCount('exit'), 0);
});

test('WorkspaceSupervisor disposal clears pending timers, settles queries, and kills the single child', async (t) => {
  const timers = useControlledTimers(t);
  const child = new FakeUtilityProcess();
  const supervisor = new WorkspaceSupervisor(appBuildId, child);
  const pending = supervisor.query(makeBootstrapRequest('request-dispose', appBuildId), 'verified-local');

  supervisor.dispose();

  assert.equal(child.killed, true);
  assert.equal(timers[0]!.cleared, true);
  assert.deepEqual(await pending, unavailable('request-dispose'));
  assert.throws(() => child.emit('error', new Error('after disposal')));
});

test('Workspace entry keeps the trusted process boundary and shared channel consumers', () => {
  const workspace = readFileSync(path.join(repositoryRoot, 'src/workspace.ts'), 'utf8');
  const main = readFileSync(path.join(repositoryRoot, 'src/main.ts'), 'utf8');
  const preload = readFileSync(path.join(repositoryRoot, 'src/preload.ts'), 'utf8');
  const renderer = readFileSync(path.join(repositoryRoot, 'src/renderer/main.tsx'), 'utf8');

  assert.equal((main.match(/utilityProcess\.fork/g) ?? []).length, 1);
  assert.match(main, /path\.join\(__dirname, 'workspace\.js'\)/);
  assert.match(main, /WORKSPACE_QUERY_CHANNEL/);
  assert.match(preload, /WORKSPACE_QUERY_CHANNEL/);
  assert.match(workspace, /process\.parentPort/);
  assert.doesNotMatch(workspace, /BrowserWindow|from ['"](?:node:fs|node:path|electron)['"]/);
  assert.doesNotMatch(renderer, /courseflow:workspace-query/);
});
