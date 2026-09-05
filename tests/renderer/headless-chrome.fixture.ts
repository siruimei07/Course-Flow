/**
 * @file Drives headless Chrome over the DevTools protocol for the tests whose subject is a layout
 * result rather than markup: which row a control lands on, how wide a label paints. One launcher
 * for all of them, so every such test finds the browser the same way and skips the same way on a
 * host without one.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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

export const browser = BROWSERS.find(candidate => candidate !== undefined && existsSync(candidate)) ?? null;

if (browser === null && process.env.COURSEFLOW_REQUIRE_BROWSER === '1') {
    throw new Error('COURSEFLOW_REQUIRE_BROWSER=1 but Chrome was not found');
}

/** The `skip` option for a test that needs the browser: the reason on a host without one, else false. */
export const skipWithoutBrowser: string | false = browser === null
    ? 'no Chrome or Chromium on this host; set CHROME_PATH to run this test'
    : false;

interface DevToolsMessage {
    readonly id?: number;
    readonly result?: unknown;
    readonly error?: { readonly message: string };
}

/**
 * Loads `html` at each viewport width in turn and evaluates `expression` in the page.
 *
 * @param {string} html A complete document with its styles inlined; it is served from a temp file.
 * @param {readonly number[]} widths Viewport widths to lay the page out at, 900px tall.
 * @param {string} expression Page-side expression whose JSON value is the measurement.
 * @return {Promise<Map<number, T>>} That value at each width.
 */
export async function evaluateAtWidths<T>(
    html: string,
    widths: readonly number[],
    expression: string,
    height = 900,
): Promise<Map<number, T>> {
    const workspace = mkdtempSync(path.join(os.tmpdir(), 'courseflow-layout-'));
    const pagePath = path.join(workspace, 'page.html');
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
    const measured = new Map<number, T>();
    let socket: WebSocket | undefined;
    try {
        // Chrome writes the port it actually took into the profile, so parallel test files cannot
        // collide on a fixed one.
        const portFile = path.join(profile, 'DevToolsActivePort');
        let port = '';
        for (let attempt = 0; attempt < 200 && port === ''; attempt += 1) {
            await new Promise(resolve => setTimeout(resolve, 50));
            if (existsSync(portFile)) {
                try {
                    port = readFileSync(portFile, 'utf8').split('\n')[0]?.trim() ?? '';
                } catch (error) {
                    // Chrome can still hold the Windows write handle after the file becomes visible.
                    if ((error as NodeJS.ErrnoException).code !== 'EBUSY') {
                        throw error;
                    }
                }
            }
        }
        if (port === '') {
            throw new Error('Chrome did not report a DevTools port');
        }

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
                width, height, deviceScaleFactor: 1, mobile: false,
            });
            await send('Page.navigate', { url: pathToFileURL(pagePath).href });
            await new Promise(resolve => setTimeout(resolve, 400));
            const evaluated = await send('Runtime.evaluate', {
                expression,
                awaitPromise: true,
                returnByValue: true,
            }) as { result: { value: T }; exceptionDetails?: { text: string } };
            if (evaluated.exceptionDetails !== undefined) {
                throw new Error(`measuring at ${width}px threw: ${evaluated.exceptionDetails.text}`);
            }
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
