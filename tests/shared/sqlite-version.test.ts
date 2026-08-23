import assert from 'node:assert/strict';
import test from 'node:test';

import { isSupportedSqliteVersion } from '../../src/shared/sqlite-version';

test('isSupportedSqliteVersion accepts the minimum and later numeric SQLite releases', () => {
  for (const version of ['3.37.0', '3.50.4', '4.0.0']) {
    assert.equal(isSupportedSqliteVersion(version), true, `expected ${version} to be supported`);
  }
});

test('isSupportedSqliteVersion rejects releases below the minimum and malformed version strings', () => {
  for (const version of ['3.36.9', '3.37', '3.37.0.1', '-3.37.0', '3.-37.0', 'three.37.0', '']) {
    assert.equal(isSupportedSqliteVersion(version), false, `expected ${JSON.stringify(version)} to be rejected`);
  }
});
