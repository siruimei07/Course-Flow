/**
 * @file Pins the wrapped topbar's focus order in a real browser. The shipped bar is a CSS grid, so
 * which row an element lands on is a layout result, not a fact any text assertion can reach: the
 * defect this guards against is a control that reads above another while being tabbed after it.
 * The test drives headless Chrome over the DevTools protocol and skips when no browser is present.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { WorkspaceShell } from '../../src/renderer/App';
import type { TaskActionPresentation } from '../../src/renderer/workspace-pages';
import type { SetupProjection } from '../../src/shared/workspace-term-contract';
import { readRendererStyles } from './renderer-styles.fixture';

/** Where a browser usually is. CHROME_PATH wins so a host can point at its own build. */
const BROWSERS: ReadonlyArray<string | undefined> = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
];
const browser = BROWSERS.find(candidate => candidate !== undefined && existsSync(candidate)) ?? null;

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

interface DevToolsMessage {
    readonly id?: number;
    readonly result?: unknown;
    readonly error?: { readonly message: string };
}

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

async function measureTopbar(html: string, widths: readonly number[]): Promise<Map<number, TopbarLayout>> {
    const workspace = mkdtempSync(path.join(os.tmpdir(), 'courseflow-topbar-'));
    const pagePath = path.join(workspace, 'topbar.html');
    writeFileSync(pagePath, html);
    const profile = path.join(workspace, 'profile');
    const chrome = spawn(String(browser), [
        '--headless=new',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-gpu',
        '--hide-scrollbars',
        'about:blank',
    ], { stdio: 'ignore' });
    const measured = new Map<number, TopbarLayout>();
    let socket: WebSocket | undefined;
    try {
        // Chrome writes the port it actually took into the profile, so parallel test files cannot
        // collide on a fixed one.
        const portFile = path.join(profile, 'DevToolsActivePort');
        let port = '';
        for (let attempt = 0; attempt < 200 && port === ''; attempt += 1) {
            await new Promise(resolve => setTimeout(resolve, 50));
            if (existsSync(portFile)) {
                port = readFileSync(portFile, 'utf8').split('\n')[0]?.trim() ?? '';
            }
        }
        assert.notEqual(port, '', 'Chrome did not report a DevTools port');

        const target = await (await fetch(
            `http://127.0.0.1:${port}/json/new?about:blank`,
            { method: 'PUT' },
        )).json() as { webSocketDebuggerUrl: string };
        socket = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise<void>((resolve, reject) => {
            socket?.addEventListener('open', () => resolve(), { once: true });
            socket?.addEventListener('error', () => reject(new Error('DevTools socket failed')), { once: true });
        });
        let nextId = 0;
        const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
        socket.addEventListener('message', event => {
            const message = JSON.parse(String(event.data)) as DevToolsMessage;
            if (message.id === undefined) {
                return;
            }
            const waiter = pending.get(message.id);
            pending.delete(message.id);
            if (message.error) {
                waiter?.reject(new Error(message.error.message));
            } else {
                waiter?.resolve(message.result);
            }
        });
        const send = (method: string, params: Record<string, unknown> = {}): Promise<unknown> => (
            new Promise((resolve, reject) => {
                nextId += 1;
                pending.set(nextId, { resolve, reject });
                socket?.send(JSON.stringify({ id: nextId, method, params }));
            })
        );

        await send('Runtime.enable');
        for (const width of widths) {
            await send('Emulation.setDeviceMetricsOverride', {
                width, height: 900, deviceScaleFactor: 1, mobile: false,
            });
            await send('Page.navigate', { url: pathToFileURL(pagePath).href });
            await new Promise(resolve => setTimeout(resolve, 400));
            const evaluated = await send('Runtime.evaluate', {
                expression: MEASURE,
                returnByValue: true,
            }) as { result: { value: TopbarLayout }; exceptionDetails?: { text: string } };
            assert.equal(evaluated.exceptionDetails, undefined, `measuring at ${width}px threw`);
            measured.set(width, evaluated.result.value);
        }
    } finally {
        socket?.close();
        // Windows keeps the profile locked until the process is really gone, and a temp directory
        // that outlives the run is litter, not a result: never let the cleanup decide the verdict.
        await new Promise<void>(resolve => {
            const done = setTimeout(resolve, 2000);
            chrome.once('exit', () => {
                clearTimeout(done);
                resolve();
            });
            chrome.kill();
        });
        try {
            rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        } catch {
            // The browser still holds a handle. The directory is disposable.
        }
    }
    return measured;
}

test(
    'the wrapped topbar keeps navigation on the first row and tabs it in reading order',
    {
        skip: browser === null
            ? 'no Chrome or Chromium on this host; set CHROME_PATH to run this test'
            : false,
    },
    async () => {
        // read-only is the widest the actions ever get: it adds the data mode badge beside 设置.
        for (const dataMode of ['ready', 'read-only'] as const) {
            const measured = await measureTopbar(shellPage(dataMode), [1280, 820, 620]);

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
