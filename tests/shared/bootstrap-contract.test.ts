/**
 * @file Verifies the exact versioned Workspace bootstrap boundary.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BOOTSTRAP_PROTOCOL_VERSION,
  makeBootstrapProblem,
  makeBootstrapRequest,
  isBootstrapOutcome,
  isBootstrapRequest,
  isWorkspaceProbeRequest,
} from '../../src/shared/bootstrap-contract';

const buildId = '0.0.0-dev';
const requestId = 'req-1';
const workspaceEpoch = '11111111-1111-4111-8111-111111111111';
const workspaceId = '22222222-2222-4222-8222-222222222222';

test('makeBootstrapRequest emits only the bootstrap query fields', () => {
  assert.deepEqual(makeBootstrapRequest(requestId, buildId), {
    kind: 'bootstrap.status',
    protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
    appBuildId: buildId,
    requestId,
  });
});

test('isBootstrapRequest rejects values outside the exact bootstrap request shape', () => {
  const validRequest = {
    kind: 'bootstrap.status',
    protocolVersion: 2,
    appBuildId: buildId,
    requestId,
  };

  for (const value of [
    { ...validRequest, kind: 'bootstrap.other' },
    { ...validRequest, appBuildId: 'other-build' },
    { ...validRequest, appBuildId: 1 },
    { ...validRequest, protocolVersion: 1 },
    { ...validRequest, requestId: '' },
    { ...validRequest, requestId: 1 },
    { ...validRequest, unexpected: true },
    [validRequest],
    null,
  ]) {
    assert.equal(isBootstrapRequest(value, buildId), false);
  }

  assert.equal(isBootstrapRequest(validRequest, buildId), true);
});

test('isBootstrapOutcome accepts only complete path-free states correlated to its request and build', () => {
  const validOutcome = {
    ok: true,
    value: {
      protocolVersion: 2,
      appBuildId: buildId,
      requestId,
      workspaceProcess: 'ready',
      sqliteVersion: '3.50.4',
      dataRootClass: 'verified-local',
      workspaceEpoch,
      workspaceData: {
        kind: 'ready',
        workspaceId,
        schemaLevel: 6,
        revision: '42',
      },
    },
  };

  assert.equal(isBootstrapOutcome(validOutcome, buildId, requestId), true);
  assert.doesNotMatch(JSON.stringify(validOutcome.value), /DataSlots|workspace\.sqlite|[A-Za-z]:[\\/]|\/Users\//);

  for (const workspaceData of [
    { kind: 'absent' },
    validOutcome.value.workspaceData,
    {
      kind: 'read-only',
      workspaceId,
      schemaLevel: 6,
      revision: '42',
      problem: {
        code: 'permission',
        scope: 'workspace',
        dataEffect: 'unchanged',
        affectedCapabilities: ['workspace.write'],
        allowedActions: [],
        context: {},
        details: { reason: 'read-only' },
      },
    },
    {
      kind: 'recovery',
      problem: {
        code: 'incompatible-version',
        scope: 'workspace',
        dataEffect: 'unchanged',
        affectedCapabilities: ['workspace.read', 'workspace.write'],
        allowedActions: [],
        context: {},
        details: { actualSchemaLevel: 2, requiredSchemaLevel: 6 },
      },
    },
    {
      kind: 'recovery',
      problem: {
        code: 'integrity',
        scope: 'workspace',
        dataEffect: 'unchanged',
        affectedCapabilities: ['workspace.read', 'workspace.write'],
        allowedActions: [],
        context: {},
        details: { reason: 'database-corrupt' },
      },
    },
  ]) {
    assert.equal(
      isBootstrapOutcome({ ...validOutcome, value: { ...validOutcome.value, workspaceData } }, buildId, requestId),
      true,
    );
  }

  for (const value of [
    { ok: 'true', value: validOutcome.value },
    { ...validOutcome, value: { ...validOutcome.value, appBuildId: 'other-build' } },
    { ...validOutcome, value: { ...validOutcome.value, requestId: 'req-2' } },
    { ...validOutcome, value: { ...validOutcome.value, protocolVersion: 1 } },
    { ...validOutcome, value: { ...validOutcome.value, workspaceProcess: 'starting' } },
    { ...validOutcome, value: { ...validOutcome.value, sqliteVersion: '3.36.9' } },
    { ...validOutcome, value: { ...validOutcome.value, sqliteVersion: '3.50' } },
    { ...validOutcome, value: { ...validOutcome.value, dataRootClass: 'unknown' } },
    { ...validOutcome, value: { ...validOutcome.value, dataRootClass: undefined } },
    { ...validOutcome, value: { ...validOutcome.value, workspaceEpoch: 'not-a-uuid' } },
    { ...validOutcome, value: { ...validOutcome.value, workspaceEpoch: Buffer.from('workspace-epoch') } },
    {
      ...validOutcome,
      value: { ...validOutcome.value, workspaceData: { kind: 'ready', workspaceId, schemaLevel: 6, revision: '01' } },
    },
    {
      ...validOutcome,
      value: { ...validOutcome.value, workspaceData: { kind: 'ready', workspaceId, schemaLevel: 2, revision: '42' } },
    },
    { ...validOutcome, value: { ...validOutcome.value, workspaceData: { kind: 'absent', extra: true } } },
    {
      ...validOutcome,
      value: { ...validOutcome.value, workspaceData: { kind: 'recovery', problem: { code: 'integrity' } } },
    },
    {
      ...validOutcome,
      value: {
        ...validOutcome.value,
        workspaceData: {
          kind: 'recovery',
          problem: {
            code: 'incompatible-version',
            scope: 'workspace',
            dataEffect: 'unchanged',
            affectedCapabilities: ['workspace.read', 'workspace.write'],
            allowedActions: [],
            context: {},
            details: { actualSchemaLevel: 6, requiredSchemaLevel: 6 },
          },
        },
      },
    },
    {
      ...validOutcome,
      value: {
        ...validOutcome.value,
        workspaceData: { kind: 'read-only', workspaceId, schemaLevel: 6, revision: 42n, problem: {} },
      },
    },
    { ...validOutcome, value: { ...validOutcome.value, extra: true } },
    { ...validOutcome, extra: true },
    { ok: true, value: null },
    { ok: true, value: [] },
    [],
    null,
  ]) {
    assert.equal(isBootstrapOutcome(value, buildId, requestId), false);
  }
});

test('isBootstrapOutcome accepts only known, complete bootstrap problems', () => {
  assert.deepEqual(
    makeBootstrapProblem('workspace-unavailable', 'Workspace is starting.', buildId, requestId),
    {
      ok: false,
      problem: {
        code: 'workspace-unavailable',
        message: 'Workspace is starting.',
        requestId,
        appBuildId: buildId,
      },
    },
  );

  const validOutcome = {
    ok: false,
    problem: {
      code: 'workspace-unavailable',
      message: 'Workspace is starting.',
      requestId,
      appBuildId: buildId,
    },
  };

  for (const code of ['invalid-request', 'build-mismatch', 'workspace-unavailable', 'sqlite-unsupported'] as const) {
    assert.equal(
      isBootstrapOutcome(makeBootstrapProblem(code, 'Workspace is starting.', buildId, requestId), buildId, requestId),
      true,
    );
  }

  for (const value of [
    { ...validOutcome, problem: { ...validOutcome.problem, code: 'internal-error' } },
    { ...validOutcome, problem: { ...validOutcome.problem, message: '' } },
    { ...validOutcome, problem: { ...validOutcome.problem, message: 1 } },
    { ...validOutcome, problem: { ...validOutcome.problem, requestId: 'req-2' } },
    { ...validOutcome, problem: { ...validOutcome.problem, requestId: null } },
    { ...validOutcome, problem: { ...validOutcome.problem, appBuildId: 'other-build' } },
    { ...validOutcome, problem: { ...validOutcome.problem, extra: true } },
    { ...validOutcome, extra: true },
  ]) {
    assert.equal(isBootstrapOutcome(value, buildId, requestId), false);
  }
});

test('isWorkspaceProbeRequest accepts only a build-correlated verified-local probe', () => {
  const validProbe = {
    kind: 'bootstrap.status',
    protocolVersion: 2,
    appBuildId: buildId,
    requestId,
    dataRootClass: 'verified-local',
  };

  assert.equal(isWorkspaceProbeRequest(validProbe, buildId), true);

  for (const value of [
    { ...validProbe, dataRootClass: 'unverified' },
    { ...validProbe, appBuildId: 'other-build' },
    { ...validProbe, extra: true },
    { kind: 'bootstrap.status', protocolVersion: 2, appBuildId: buildId, requestId },
  ]) {
    assert.equal(isWorkspaceProbeRequest(value, buildId), false);
  }
});
