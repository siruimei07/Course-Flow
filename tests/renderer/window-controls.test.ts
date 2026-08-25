/**
 * @file Verifies accessible window chrome and its exact Shell action mapping.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    Children,
    createElement,
    isValidElement,
    type ReactElement,
    type ReactNode,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
    WindowControls,
    WindowTitlebar,
} from '../../src/renderer/WindowControls';
import type { WindowControlAction } from '../../src/shared/window-control-contract';

type ControlButtonProps = Readonly<{
    'aria-label': string;
    onClick(): void;
}>;

test('three labelled controls dispatch their exact Shell actions in order', () => {
    const actions: WindowControlAction[] = [];
    const group = WindowControls({
        onControl(action): void {
            actions.push(action);
        },
    });
    const children = (group.props as Readonly<{ children: ReactNode }>).children;
    const buttons = Children.toArray(children).filter(
        (child): child is ReactElement<ControlButtonProps> => isValidElement<ControlButtonProps>(child),
    );

    assert.deepEqual(buttons.map(button => button.props['aria-label']), [
        '最小化窗口',
        '最大化或还原窗口',
        '关闭窗口',
    ]);
    for (const button of buttons) {
        button.props.onClick();
    }
    assert.deepEqual(actions, ['minimize', 'toggle-maximize', 'close']);
});

test('startup title chrome keeps the CourseFlow identity and window controls together', () => {
    const html = renderToStaticMarkup(createElement(WindowTitlebar));

    assert.match(html, /class="startup-titlebar"/);
    assert.match(html, /aria-label="CourseFlow"/);
    assert.match(html, /aria-label="窗口控件"/);
});
