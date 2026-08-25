/**
 * @file Verifies the bounded Shell window-control action contract.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { isWindowControlAction } from '../../src/shared/window-control-contract';

test('window controls accept only the three supported Shell actions', () => {
    for (const action of ['minimize', 'toggle-maximize', 'close']) {
        assert.equal(isWindowControlAction(action), true);
    }

    for (const value of [
        'maximize',
        'restore',
        'open-devtools',
        '',
        null,
        1,
        { action: 'close' },
    ]) {
        assert.equal(isWindowControlAction(value), false);
    }
});
