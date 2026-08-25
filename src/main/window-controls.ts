/**
 * @file Applies bounded Shell actions to the active Electron window.
 */

import type { WindowControlAction } from '../shared/window-control-contract';

interface WindowControlTarget {
    close(): void;
    isMaximized(): boolean;
    maximize(): void;
    minimize(): void;
    unmaximize(): void;
}

/**
 * Applies one validated Shell action to the active window.
 *
 * @param {WindowControlTarget} window Active application window.
 * @param {WindowControlAction} action Validated action.
 * @return {void}
 */
export function applyWindowControl(window: WindowControlTarget, action: WindowControlAction): void {
    if (action === 'minimize') {
        window.minimize();
        return;
    }
    if (action === 'close') {
        window.close();
        return;
    }
    if (window.isMaximized()) {
        window.unmaximize();
        return;
    }
    window.maximize();
}
