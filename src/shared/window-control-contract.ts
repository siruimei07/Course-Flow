/**
 * @file Defines the bounded Shell window-control action contract.
 */

export type WindowControlAction = 'minimize' | 'toggle-maximize' | 'close';

/** Fixed Renderer-to-Main channel for bounded window controls. */
export const WINDOW_CONTROL_CHANNEL = 'courseflow:window-control';

/**
 * Checks whether an untrusted value is one supported window action.
 *
 * @param {unknown} value Untrusted Renderer value.
 * @return {boolean} Whether the value is an exact window action.
 */
export function isWindowControlAction(value: unknown): value is WindowControlAction {
    return value === 'minimize' || value === 'toggle-maximize' || value === 'close';
}
