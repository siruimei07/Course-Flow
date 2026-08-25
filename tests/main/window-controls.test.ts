/**
 * @file Verifies bounded BrowserWindow actions independently of Electron startup.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyWindowControl } from '../../src/main/window-controls';

type WindowDouble = Readonly<{
    calls: string[];
    target: Readonly<{
        close(): void;
        isMaximized(): boolean;
        maximize(): void;
        minimize(): void;
        unmaximize(): void;
    }>;
}>;

/**
 * Creates one observable BrowserWindow stand-in.
 *
 * @param {boolean} maximized Initial maximized state.
 * @return {WindowDouble} Observable window target and action log.
 */
function makeWindowDouble(maximized = false): WindowDouble {
    const calls: string[] = [];
    return {
        calls,
        target: {
            close(): void {
                calls.push('close');
            },
            isMaximized(): boolean {
                calls.push('is-maximized');
                return maximized;
            },
            maximize(): void {
                calls.push('maximize');
            },
            minimize(): void {
                calls.push('minimize');
            },
            unmaximize(): void {
                calls.push('unmaximize');
            },
        },
    };
}

test('minimize and close dispatch only their matching BrowserWindow action', () => {
    const minimized = makeWindowDouble();
    applyWindowControl(minimized.target, 'minimize');
    assert.deepEqual(minimized.calls, ['minimize']);

    const closed = makeWindowDouble();
    applyWindowControl(closed.target, 'close');
    assert.deepEqual(closed.calls, ['close']);
});

test('toggle maximize chooses maximize or restore from the current window state', () => {
    const restored = makeWindowDouble();
    applyWindowControl(restored.target, 'toggle-maximize');
    assert.deepEqual(restored.calls, ['is-maximized', 'maximize']);

    const maximized = makeWindowDouble(true);
    applyWindowControl(maximized.target, 'toggle-maximize');
    assert.deepEqual(maximized.calls, ['is-maximized', 'unmaximize']);
});
