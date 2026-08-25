/**
 * @file Renders the accessible custom chrome for the containing desktop window.
 */

import type { ReactElement } from 'react';

import type { WindowControlAction } from '../shared/window-control-contract';

export type WindowControlsProps = Readonly<{
    onControl?(action: WindowControlAction): void;
}>;

/**
 * Sends one control action through an injected test seam or the bounded preload surface.
 *
 * @param {WindowControlsProps} props Optional control callback.
 * @param {WindowControlAction} action Supported window action.
 * @return {void}
 */
function controlWindow(props: WindowControlsProps, action: WindowControlAction): void {
    if (props.onControl !== undefined) {
        props.onControl(action);
        return;
    }
    window.courseFlowWindow.control(action);
}

/**
 * Renders the three bounded Shell controls for the containing desktop window.
 *
 * @param {WindowControlsProps} props Optional control callback.
 * @return {ReactElement} Accessible minimize, maximize/restore, and close controls.
 */
export function WindowControls(props: WindowControlsProps = {}): ReactElement {
    return (
        <div
            aria-label="窗口控件"
            className="window-controls"
            role="group"
        >
            <button
                aria-label="最小化窗口"
                className="window-control-button window-control-button--minimize"
                onClick={() => controlWindow(props, 'minimize')}
                title="最小化"
                type="button"
            >
                <svg
                    aria-hidden="true"
                    className="window-control-icon"
                    focusable="false"
                    viewBox="0 0 16 16"
                >
                    <path d="M4 8h8" />
                </svg>
            </button>
            <button
                aria-label="最大化或还原窗口"
                className="window-control-button window-control-button--maximize"
                onClick={() => controlWindow(props, 'toggle-maximize')}
                title="最大化或还原"
                type="button"
            >
                <svg
                    aria-hidden="true"
                    className="window-control-icon"
                    focusable="false"
                    viewBox="0 0 16 16"
                >
                    <rect
                        height="7.5"
                        rx="1"
                        width="7.5"
                        x="4.25"
                        y="4.25"
                    />
                </svg>
            </button>
            <button
                aria-label="关闭窗口"
                className="window-control-button window-control-button--close"
                onClick={() => controlWindow(props, 'close')}
                title="关闭"
                type="button"
            >
                <svg
                    aria-hidden="true"
                    className="window-control-icon"
                    focusable="false"
                    viewBox="0 0 16 16"
                >
                    <path d="m5 5 6 6m0-6-6 6" />
                </svg>
            </button>
        </div>
    );
}

/**
 * Renders compact title chrome for startup surfaces that do not have Workspace navigation.
 *
 * @return {ReactElement} Draggable CourseFlow identity and window controls.
 */
export function WindowTitlebar(): ReactElement {
    return (
        <header className="startup-titlebar">
            <div
                aria-label="CourseFlow"
                className="brand-pill"
            >
                <span
                    aria-hidden="true"
                    className="brand-symbol"
                >C</span>
                <span>CourseFlow</span>
            </div>
            <WindowControls />
        </header>
    );
}
