import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDevelopmentRoots } from '../../src/main/runtime-paths';

test('resolveDevelopmentRoots creates three distinct Windows local development roots', () => {
  assert.deepEqual(
    resolveDevelopmentRoots({
      platform: 'win32',
      localAppData: 'C:\\Users\\A\\AppData\\Local',
      appData: 'C:\\Users\\A\\AppData\\Roaming',
    }),
    {
      activityControlRoot: 'C:\\Users\\A\\AppData\\Local\\CourseFlow Dev\\ActivityControl',
      dataSlotsRoot: 'C:\\Users\\A\\AppData\\Local\\CourseFlow Dev\\DataSlots',
      chromiumRoot: 'C:\\Users\\A\\AppData\\Local\\CourseFlow Dev\\Chromium',
      dataRootClass: 'verified-local',
    },
  );
});

test('resolveDevelopmentRoots rejects unsupported Windows roots instead of falling back', () => {
  for (const localAppData of [
    undefined,
    'relative\\local',
    '\\rooted-without-drive',
    '/rooted-without-drive',
    '\\\\server\\share\\local',
  ]) {
    assert.throws(
      () => resolveDevelopmentRoots({ platform: 'win32', localAppData, appData: 'C:\\Users\\A\\AppData\\Roaming' }),
      /LOCALAPPDATA.*absolute local path/i,
    );
  }
});

test('resolveDevelopmentRoots creates three distinct macOS Application Support roots', () => {
  assert.deepEqual(
    resolveDevelopmentRoots({
      platform: 'darwin',
      localAppData: undefined,
      appData: '/Users/a/Library/Application Support',
    }),
    {
      activityControlRoot: '/Users/a/Library/Application Support/CourseFlow Dev/ActivityControl',
      dataSlotsRoot: '/Users/a/Library/Application Support/CourseFlow Dev/DataSlots',
      chromiumRoot: '/Users/a/Library/Application Support/CourseFlow Dev/Chromium',
      dataRootClass: 'verified-local',
    },
  );
});

test('resolveDevelopmentRoots rejects relative macOS appData and Linux', () => {
  assert.throws(
    () => resolveDevelopmentRoots({ platform: 'darwin', localAppData: undefined, appData: 'relative/app-data' }),
    /appData.*absolute macOS path/i,
  );
  assert.throws(
    () => resolveDevelopmentRoots({ platform: 'linux', localAppData: '/tmp', appData: '/tmp' }), /Unsupported platform: linux/);
});
