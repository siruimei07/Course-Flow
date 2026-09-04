/**
 * @file Pins the wrapped topbar's focus order in a real browser. The shipped bar is a CSS grid, so
 * which row an element lands on is a layout result, not a fact any text assertion can reach: the
 * defect this guards against is a control that reads above another while being tabbed after it.
 * The test drives headless Chrome through the shared fixture and skips when no browser is present.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { WorkspaceShell } from '../../src/renderer/App';
import type { TaskActionPresentation } from '../../src/renderer/workspace-pages';
import type { SetupProjection } from '../../src/shared/workspace-term-contract';
import { evaluateAtWidths, skipWithoutBrowser } from './headless-chrome.fixture';
import { readRendererStyles } from './renderer-styles.fixture';

const noop = (): void => {};

const setup: SetupProjection = {
    workspaceRevision: '0',
    planEntityVersion: '0',
    minimum: {
        hasCurrentTerm: false,
        hasCurrentTermCourse: false,
        hasMeetingOrTask: false,
        isSatisfied: false,
    },
    everReachedMinimum: true,
    defaultRoute: 'today',
    draftCheckpointVersion: '0',
    draftCheckpoint: null,
    currentTerm: null,
    terms: [],
    courses: [],
    holidayRanges: [],
    tasks: [],
};

const taskActions: TaskActionPresentation = {
    writable: true,
    busyItemId: null,
    problem: null,
    canRunAction(): boolean {
        return true;
    },
    undo: null,
    onAction: noop,
    onUndo: noop,
    onUndoHoverChange: noop,
    onUndoFocusChange: noop,
};

function shellPage(dataMode: 'ready' | 'read-only'): string {
    const body = renderToStaticMarkup(createElement(WorkspaceShell, {
        activePage: 'today',
        dataMode,
        setup,
        plan: null,
        planProblem: null,
        onNavigate: noop,
        calendarWeek: {
            offset: 0,
            busy: false,
            problem: null,
            plan: null,
            selectedDate: null,
            onSelectDate: noop,
            onShift: noop,
            onReturnToCurrentWeek: noop,
        },
        onCreateTask: noop,
        onOpenManagement: noop,
        onOpenSettings: noop,
        onOpenSetup: noop,
        onRetryPlan: noop,
        taskActions,
    }));
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>topbar</title>'
        + `<style>${readRendererStyles()}</style></head><body><div id="root">${body}</div></body></html>`;
}

/**
 * What the page reports back for one viewport: where the four topbar regions were placed, and how
 * the focusable controls order by markup against how they order by reading position.
 */
interface TopbarLayout {
    readonly rowCount: number;
    readonly labels: readonly string[];
    /** For each control in markup order, its index in reading order. */
    readonly readingIndexByMarkup: readonly number[];
    readonly placement: Readonly<Record<string, { readonly row: string; readonly column: string }>>;
}

/**
 * Runs in the page. Rows come from the painted boxes because an auto placed item computes its
 * grid position as `auto`; the declared placement is read alongside so both have to agree.
 */
const MEASURE = `(() => {
    const style = document.createElement('style');
    style.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }';
    document.head.appendChild(style);
    const bar = document.querySelector('.topbar');
    const controls = [...bar.querySelectorAll('button, a[href]')].filter(element => {
        const box = element.getBoundingClientRect();
        const computed = getComputedStyle(element);
        return computed.display !== 'none' && computed.visibility !== 'hidden'
            && box.width > 0 && box.height > 0;
    }).map((element, index) => {
        const box = element.getBoundingClientRect();
        return {
            markup: index,
            label: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim(),
            left: box.left,
            centre: box.top + box.height / 2,
        };
    });
    const rows = [];
    for (const control of [...controls].sort((a, b) => a.centre - b.centre || a.left - b.left)) {
        const row = rows.find(candidate => Math.abs(candidate.centre - control.centre) < 14);
        if (row) { row.items.push(control); } else { rows.push({ centre: control.centre, items: [control] }); }
    }
    const reading = rows.flatMap(row => [...row.items].sort((a, b) => a.left - b.left));
    const placement = {};
    for (const selector of ['.brand-pill', '.primary-nav', '.topbar-actions', '.window-controls']) {
        const region = bar.querySelector(':scope > ' + selector);
        const computed = getComputedStyle(region);
        placement[selector] = { row: computed.gridRowStart, column: computed.gridColumnStart };
    }
    style.remove();
    return {
        rowCount: rows.length,
        labels: controls.map(control => control.label),
        readingIndexByMarkup: controls.map(control => reading.indexOf(control)),
        placement,
    };
})()`;

/** The three regions in markup order, then the nine controls they contain, also in markup order. */
const CONTROLS_IN_MARKUP_ORDER = [
    'Today', 'Courses', 'Calendar', 'Tasks', 'Files',
    '打开设置',
    '最小化窗口', '最大化或还原窗口', '关闭窗口',
];

/**
 * The wrapped bar accepts exactly one inversion: the window controls hold the top right corner the
 * platform reserves for them, so they read before the actions that sit on the second row while
 * being tabbed after. Every navigation button reads exactly where it is written.
 */
const WRAPPED_READING_ORDER = [0, 1, 2, 3, 4, 8, 5, 6, 7];
const SINGLE_ROW_READING_ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 8];

test(
    'the wrapped topbar keeps navigation on the first row and tabs it in reading order',
    {
        skip: skipWithoutBrowser,
    },
    async () => {
        // read-only is the widest the actions ever get: it adds the data mode badge beside 设置.
        for (const dataMode of ['ready', 'read-only'] as const) {
            const measured = await evaluateAtWidths<TopbarLayout>(shellPage(dataMode), [1280, 820, 620], MEASURE);

            const wide = measured.get(1280);
            assert.ok(wide !== undefined);
            assert.deepEqual(wide.labels, CONTROLS_IN_MARKUP_ORDER, `${dataMode} at 1280px`);
            assert.equal(wide.rowCount, 1, `${dataMode}: the bar must not wrap at 1280px`);
            assert.deepEqual(
                wide.readingIndexByMarkup,
                SINGLE_ROW_READING_ORDER,
                `${dataMode} at 1280px: one row must tab left to right`,
            );

            for (const width of [820, 620]) {
                const layout = measured.get(width);
                assert.ok(layout !== undefined);
                assert.deepEqual(layout.labels, CONTROLS_IN_MARKUP_ORDER, `${dataMode} at ${width}px`);
                assert.equal(layout.rowCount, 2, `${dataMode} at ${width}px: the bar wraps to two rows`);
                assert.deepEqual(
                    layout.placement,
                    {
                        '.brand-pill': { row: '1', column: '1' },
                        '.primary-nav': { row: '1', column: '2' },
                        '.topbar-actions': { row: '2', column: '1' },
                        '.window-controls': { row: '1', column: '3' },
                    },
                    `${dataMode} at ${width}px: declared grid placement`,
                );
                assert.deepEqual(
                    layout.readingIndexByMarkup,
                    WRAPPED_READING_ORDER,
                    `${dataMode} at ${width}px: navigation must read where it is written, and the`
                        + ' window controls are the only pair allowed to read before what follows them',
                );
            }
        }
    },
);
