import assert from 'node:assert/strict';
import test from 'node:test';

import { createSmokeOutput } from '../../src/main/smoke-output';

test('smoke success writes its complete line before exiting once', () => {
  const events: string[] = [];
  const emit = createSmokeOutput(
    (line) => events.push(`write:${line}`),
    (code) => events.push(`exit:${code}`),
  );

  emit({ kind: 'courseflow.smoke', ok: true, sqliteVersion: '3.53.1', dataRootClass: 'verified-local' }, 0);

  assert.deepEqual(events, [
    'write:{"kind":"courseflow.smoke","ok":true,"sqliteVersion":"3.53.1","dataRootClass":"verified-local"}\n',
    'exit:0',
  ]);
  emit({ kind: 'courseflow.smoke', ok: false }, 1);

  assert.equal(events.length, 2);
});

test('smoke failure and startup failure use the same synchronous one-shot exit path', () => {
  for (const label of ['failure', 'startup failure']) {
    const events: string[] = [];
    const emit = createSmokeOutput(
      (line) => events.push(`write:${line}`),
      (code) => events.push(`exit:${code}`),
    );

    emit({ kind: 'courseflow.smoke', ok: false }, 1);

    assert.deepEqual(events, ['write:{"kind":"courseflow.smoke","ok":false}\n', 'exit:1'], `${label} must exit once with code 1`);
  }
});

test('smoke stdout write errors finish nonzero after the failed synchronous write', () => {
  const events: string[] = [];
  const exitCodes: number[] = [];
  const emit = createSmokeOutput(
    () => {
      events.push('write');
      throw new Error('EPIPE');
    },
    (code) => exitCodes.push(code),
  );

  emit({ kind: 'courseflow.smoke', ok: true }, 0);
  emit({ kind: 'courseflow.smoke', ok: false }, 1);

  assert.deepEqual(events, ['write']);
  assert.deepEqual(exitCodes, [1]);
});
