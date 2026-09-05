/**
 * @file Measures isolated packaged startup and formal Renderer query/commit round trips for G-A.
 */

import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';

import {findWrapper, runBoundedProcess} from './run-packaged-smoke.mjs';

/** @const {string} Repository containing the packaged wrapper and matching compiled seed tool. */
const REPOSITORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Rejects ambiguous arguments and any existing reference tree before starting an application.
 * @param {string[]} args Exact CLI arguments.
 * @return {string} New absolute output directory.
 */
function parseOutput(args) {
    assert.ok(args.length === 2 && args[0] === '--output',
        'Usage: node scripts/measure-ga-packaged.mjs --output ABSOLUTE_NEW_DIRECTORY');
    assert.ok(path.isAbsolute(args[1]), '--output must be absolute');
    const output = path.resolve(args[1]);
    assert.equal(existsSync(output), false, '--output already exists; existing DATA is never overwritten');
    return output;
}

/**
 * Retains original samples and uses the approved nearest-rank quantiles without dropping outliers.
 * @param {number[]} samples Successful elapsed measurements in original order.
 * @param {number} budget Approved p95 ceiling in milliseconds.
 * @return {object} Distribution and this endpoint's budget verdict.
 */
function summarize(samples, budget) {
    assert.ok(samples.length >= 20 && samples.every(value => Number.isFinite(value) && value >= 0));
    const ordered = Array.from(samples).sort((left, right) => left - right);
    const quantile = percentile => ordered[Math.ceil(percentile * ordered.length) - 1];
    return {
        count: samples.length,
        p50Milliseconds: quantile(0.5),
        p95Milliseconds: quantile(0.95),
        p99Milliseconds: samples.length >= 100 ? quantile(0.99) : null,
        maxMilliseconds: ordered.at(-1),
        samplesMilliseconds: samples,
        approvedP95BudgetMilliseconds: budget,
        passed: quantile(0.95) <= budget,
    };
}

/**
 * Connects to one local DevTools endpoint with bounded requests and no browser dependency.
 * @param {string} url WebSocket URL returned by the isolated wrapper.
 * @return {Promise<object>} Protocol connection and page evaluation helper.
 */
async function connect(url) {
    const socket = new WebSocket(url);
    const pending = new Map();
    let nextId = 0;
    await new Promise((resolve, reject) => {
        const deadline = setTimeout(() => {
            socket.close();
            reject(new Error('DevTools connection timed out'));
        }, 10_000);
        socket.addEventListener('open', () => {
            clearTimeout(deadline);
            resolve();
        }, {once: true});
        socket.addEventListener('error', () => {
            clearTimeout(deadline);
            reject(new Error('DevTools connection failed'));
        }, {once: true});
    });
    socket.addEventListener('message', event => {
        const message = JSON.parse(String(event.data));
        const waiting = pending.get(message.id);
        if (!waiting) {
            return;
        }
        pending.delete(message.id);
        clearTimeout(waiting.deadline);
        if (message.error) {
            waiting.reject(new Error(message.error.message));
        } else {
            waiting.resolve(message.result);
        }
    });
    socket.addEventListener('close', () => {
        for (const waiting of pending.values()) {
            clearTimeout(waiting.deadline);
            waiting.reject(new Error('DevTools connection closed'));
        }
        pending.clear();
    });

    /**
     * Sends one bounded protocol operation.
     * @param {string} method DevTools method.
     * @param {object} params Protocol arguments.
     * @return {Promise<object>} Matching result.
     */
    function send(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = ++nextId;
            const deadline = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`DevTools ${method} timed out`));
            }, 15_000);
            pending.set(id, {resolve, reject, deadline});
            socket.send(JSON.stringify({id, method, params}));
        });
    }
    return {
        send,
        requestBrowserClose() {
            // Electron's DevToolsManagerDelegate quits without acknowledging Browser.close.
            // Process close, observed by runBoundedProcess, is the completion evidence.
            socket.send(JSON.stringify({id: ++nextId, method: 'Browser.close'}));
        },
        async evaluate(expression) {
            const result = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
            assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
            return result.result.value;
        },
        close() {
            socket.close();
        },
    };
}

/**
 * Waits for the wrapper's own published endpoint; its application owns the Chromium path.
 * @param {string} portFile Isolated Chromium/Session/DevToolsActivePort path.
 * @return {Promise<object>} Renderer target and browser endpoint.
 */
async function rendererEndpoint(portFile) {
    const deadline = performance.now() + 20_000;
    while (performance.now() < deadline) {
        await delay(25);
        let lines;
        try {
            lines = readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
        } catch (error) {
            if (error.code === 'ENOENT' || error.code === 'EBUSY') {
                continue;
            }
            throw error;
        }
        if (!lines[0] || !lines[1]) {
            continue;
        }
        const base = `http://127.0.0.1:${lines[0]}`;
        const response = await fetch(`${base}/json/list`, {signal: AbortSignal.timeout(5000)});
        assert.equal(response.ok, true, 'DevTools target listing failed');
        const targets = await response.json();
        const pages = targets.filter(target => target.type === 'page' && target.url.startsWith('file:'));
        if (pages.length === 0) {
            continue;
        }
        assert.equal(pages.length, 1, 'Expected exactly one isolated application Renderer');
        return {page: pages[0], browserUrl: `ws://127.0.0.1:${lines[0]}${lines[1]}`};
    }
    throw new Error('Packaged Renderer did not publish a DevTools endpoint within 20 seconds');
}

/**
 * Proves the macOS Electron runtime resolves its data root into this disposable reference.
 * @param {string} output Previously absent reference directory.
 * @return {Promise<object | null>} Actual macOS path observation, or null on Windows.
 */
async function verifyMacIsolation(output) {
    if (process.platform !== 'darwin') {
        return null;
    }
    const probeRoot = mkdtempSync(path.join(os.tmpdir(), 'courseflow-ga-path-probe-'));
    const probeFile = path.join(probeRoot, 'probe.cjs');
    writeFileSync(probeFile, 'const {app} = require("electron");\n'
        + 'console.log(JSON.stringify({appData: app.getPath("appData")}));\napp.exit(0);\n');
    try {
        const electron = createRequire(import.meta.url)('electron');
        const result = await runBoundedProcess(electron, [probeFile], {
            timeoutMilliseconds: 15_000,
            description: 'macOS isolated appData probe',
        });
        assert.equal(result.code, 0, result.stderr.toString());
        const observation = JSON.parse(result.stdout.toString().trim());
        assert.equal(observation.appData, path.join(output, 'Home', 'Library', 'Application Support'),
            'CFFIXED_USER_HOME did not isolate Electron appData; refusing to open user DATA');
        assert.equal(existsSync(output), false, 'Path probe unexpectedly created the reference directory');
        return observation;
    } finally {
        unlinkSync(probeFile);
        rmdirSync(probeRoot);
    }
}

/**
 * Requires a successful formal response without serializing successful projections during their timing.
 * @param {object} outcome Preload response.
 * @param {string} kind Expected formal response kind.
 * @return {object} Formal response value.
 */
function formalValue(outcome, kind) {
    if (!outcome.ok) {
        assert.fail(JSON.stringify(outcome));
    }
    assert.equal(outcome.value.kind, kind);
    return outcome.value;
}

/** Runs the bounded experiment; every failed round remains in the report and fails the process. */
async function main() {
    const output = parseOutput(process.argv.slice(2));
    assert.equal(process.cwd(), REPOSITORY, 'Run from the Course-Flow repository root');
    assert.ok(process.platform === 'win32' || process.platform === 'darwin', 'Unsupported platform');
    const wrapper = findWrapper();
    const source = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
    const worktreeStatus = execFileSync('git', ['status', '--short'], {encoding: 'utf8'}).trim();
    assert.equal(worktreeStatus, '', 'Commit the source and measurement tools before seeding packaged evidence');
    delete process.env.ELECTRON_RUN_AS_NODE;
    process.env.LOCALAPPDATA = path.join(output, 'Local');
    process.env.APPDATA = path.join(output, 'Roaming');
    process.env.CFFIXED_USER_HOME = path.join(output, 'Home');
    const macIsolation = await verifyMacIsolation(output);
    const seeded = await runBoundedProcess(process.execPath, [
        path.join(REPOSITORY, 'scripts', 'measure-ga-reference.mjs'), '--output', output, '--seed-only',
    ], {timeoutMilliseconds: 180_000, description: 'formal reference seed'});
    const seedFailure = seeded.code === 0 ? null
        : new Error(`Formal seed exited with code ${String(seeded.code)}: ${seeded.stderr.toString()}`);
    if (existsSync(output)) {
        writeFileSync(path.join(output, 'seed.stdout.txt'), seeded.stdout);
        writeFileSync(path.join(output, 'seed.stderr.txt'), seeded.stderr);
    }
    if (seedFailure) {
        throw seedFailure;
    }
    assert.equal(existsSync(output), true, 'Formal seed did not create the reference output directory');
    const seed = JSON.parse(readFileSync(path.join(output, 'kernel-measurements.json'), 'utf8'));
    const reference = JSON.parse(readFileSync(path.join(output, 'reference-setup.json'), 'utf8'));
    assert.equal(seed.appBuildId, `development:${source}`);
    assert.equal(seed.status, 'seeded-no-measurements');
    const report = {
        status: 'running',
        sourceCommit: source,
        worktreeStatus,
        wrapper,
        startedAt: new Date().toISOString(),
        fixtureVersion: seed.fixture.version,
        workspaceId: seed.workspaceId,
        initialRevision: reference.workspaceRevision,
        macIsolation,
        device: {
            platform: process.platform,
            architecture: process.arch,
            osRelease: os.release(),
            osVersion: os.version(),
            cpuModel: os.cpus()[0]?.model,
            logicalProcessors: os.cpus().length,
            totalMemoryBytes: os.totalmem(),
            freeMemoryBytesAtStart: os.freemem(),
            driverNode: process.version,
            powerStorageAndCompetingLoad: 'not observed by this script',
        },
        methodology: {
            startup: '20 independent packaged processes; OS caches retained; same disposable Chromium profile',
            startupEndpoint: 'spawn call to first PLAN DOM actionable and two animation frames; read-only observation',
            startupOverhead: 'Includes spawn, DevTools discovery/connection/front activation/polling and frame wait',
            queryAndCommit: 'Renderer performance.now around formal preload API await; includes Main/Workspace IPC',
            excludedFromRequestTiming: 'External CDP, assertion/serialization, and setup version query before a commit',
            clock: 'Actual packaged system clock; differs from the fixed host-kernel 2026-09-10T13:30:00.000Z clock',
            backup: 'Reference remains unconfigured; no background-overlap claim',
            completeG7: false,
        },
        startupRounds: [],
        queryGroups: [],
        commitSamples: [],
        observations: {},
        notMeasured: [
            'other platform; physical input, accessibility and human visual acceptance',
            'OS cache-cold startup and compositor presentation timing',
            'actual backup overlap and its query/commit budgets or incremental cost',
            'ADR event-loop, WAL/checkpoint, integrity/FK, migration, backup/restore stage and resource measurements',
            'complete G7 verdict',
        ],
    };
    const save = () => writeFileSync(path.join(output, 'packaged-measurements.json'),
        `${JSON.stringify(report, null, 2)}\n`);
    const portFile = path.join(path.dirname(seed.dataSlotsRoot), 'Chromium', 'Session', 'DevToolsActivePort');
    try {
        const smoke = await runBoundedProcess(process.execPath, [
            path.join(REPOSITORY, 'scripts', 'run-packaged-smoke.mjs'),
        ], {timeoutMilliseconds: 30_000, description: 'isolated packaged smoke'});
        report.packagedSmoke = {
            code: smoke.code,
            signal: smoke.signal,
            stdout: smoke.stdout.toString(),
            stderr: smoke.stderr.toString(),
            scope: 'Existing packaged smoke in the same isolated DATA environment; no timing claim',
        };
        assert.equal(smoke.code, 0, report.packagedSmoke.stderr);
        assert.ok(report.packagedSmoke.stdout.includes(
            `PASS packaged smoke ${process.platform}/${process.arch} ${seed.appBuildId} `,
        ), 'Isolated packaged smoke must confirm the exact seeded build');
        for (let index = 0; index < 20; index += 1) {
            if (existsSync(portFile)) {
                unlinkSync(portFile);
            }
            const round = {index, startedAt: new Date().toISOString(), status: 'running'};
            report.startupRounds.push(round);
            let page;
            let browserUrl;
            const started = performance.now();
            const lifetime = runBoundedProcess(wrapper, ['--remote-debugging-port=0'], {
                timeoutMilliseconds: index === 19 ? 120_000 : 30_000,
                description: `packaged round ${index + 1}`,
            });
            // Attach immediately so a spawn/timeout failure cannot become an unhandled rejection.
            const exited = lifetime.then(result => ({result}), error => ({error}));
            try {
                round.phase = 'devtools-endpoint';
                const endpoint = await Promise.race([
                    rendererEndpoint(portFile),
                    lifetime.then(() => { throw new Error('Packaged process exited before Renderer readiness'); }),
                ]);
                browserUrl = endpoint.browserUrl;
                round.phase = 'renderer-connection';
                page = await connect(endpoint.page.webSocketDebuggerUrl);
                await page.send('Page.bringToFront');
                round.phase = 'first-plan-frames';
                let ready;
                const deadline = performance.now() + 20_000;
                while (!ready && performance.now() < deadline) {
                    ready = await page.evaluate(`(async () => {
                        const view = document.querySelector('.workspace-grid--today');
                        const control = view?.querySelector('button:not(:disabled), a[href]');
                        const active = document.querySelector('.primary-nav [aria-current="page"]');
                        if (!view || !control?.getClientRects().length || active?.textContent !== 'Today'
                            || document.querySelector('.data-mode-status') || !window.courseFlowWindow) {
                            return null;
                        }
                        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                        return {heading: document.querySelector('#today-page-title')?.textContent,
                            width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
                            visibilityState: document.visibilityState, hasFocus: document.hasFocus(),
                            systemTime: new Date().toISOString()};
                    })()`);
                    if (!ready) {
                        await delay(25);
                    }
                }
                assert.ok(ready, 'First PLAN view never became actionable');
                round.milliseconds = performance.now() - started;
                round.firstPlan = ready;
                round.phase = 'bootstrap-identity';
                const bootstrap = await page.evaluate('window.courseFlow.query()');
                assert.equal(bootstrap.ok, true, JSON.stringify(bootstrap));
                round.bootstrap = bootstrap.value;
                assert.equal(bootstrap.value.appBuildId, seed.appBuildId, 'Packaged build must match the seed source');
                assert.equal(bootstrap.value.workspaceData.kind, 'ready');
                assert.equal(bootstrap.value.workspaceData.workspaceId, seed.workspaceId, 'Wrong DATA root');
                assert.equal(bootstrap.value.workspaceData.revision, reference.workspaceRevision);
                report.appBuildId = bootstrap.value.appBuildId;
                if (index === 19) {
                    round.phase = 'formal-request-samples';
                    const browser = await connect(browserUrl);
                    try {
                        report.browserVersion = await browser.send('Browser.getVersion');
                    } catch (error) {
                        report.browserVersion = {notObserved: error.message};
                    } finally {
                        browser.close();
                    }
                    const build = formalValue(await page.evaluate('window.courseFlow.queryApplicationBuildStatus()'),
                        'workspace.application-build-status');
                    report.applicationBuildStatus = build.status;
                    report.initialProtection = formalValue(
                        await page.evaluate('window.courseFlow.queryDataProtection()'),
                        'workspace.data-protection-projection',
                    ).projection;
                    assert.equal(report.initialProtection.configuration.kind, 'unconfigured');
                    await measureRequests(page, report, reference);
                    report.finalProtection = formalValue(
                        await page.evaluate('window.courseFlow.queryDataProtection()'),
                        'workspace.data-protection-projection',
                    ).projection;
                    assert.equal(report.finalProtection.configuration.kind, 'unconfigured');
                }
                round.status = 'measured';
            } catch (error) {
                round.status = 'failed';
                round.error = error.stack ?? String(error);
                if (page) {
                    round.failureState = await page.evaluate(`({
                        visibilityState: document.visibilityState, hasFocus: document.hasFocus(),
                        readyState: document.readyState,
                        planDom: Boolean(document.querySelector('.workspace-grid--today')),
                    })`).catch(failure => ({error: failure.message}));
                }
                throw error;
            } finally {
                let closeError;
                try {
                    if (page) {
                        // Schedule formal close after its CDP response; the macOS app survives its last window.
                        await page.evaluate('setTimeout(() => window.courseFlowWindow.control("close"), 0); true');
                        if (process.platform === 'darwin') {
                            const browser = await connect(browserUrl);
                            try {
                                browser.requestBrowserClose();
                            } finally {
                                browser.close();
                            }
                        }
                    }
                } catch (error) {
                    closeError = error;
                    round.closeError = error.stack ?? String(error);
                } finally {
                    page?.close();
                }
                const closed = await exited;
                if (closed.error) {
                    throw closed.error;
                }
                round.exit = {code: closed.result.code, signal: closed.result.signal};
                assert.equal(closed.result.code, 0, 'Packaged process did not close normally');
                writeFileSync(path.join(output, `round-${index + 1}.stderr.txt`), closed.result.stderr);
                save();
                if (closeError) {
                    throw closeError;
                }
            }
            process.stdout.write(`Startup ${index + 1}/20: ${round.milliseconds.toFixed(2)} ms; process closed\n`);
        }
        report.observations.startup = summarize(report.startupRounds.map(round => round.milliseconds), 3000);
        for (const group of report.queryGroups) {
            report.observations[group.name] = summarize(group.samples.map(sample => sample.milliseconds), 100);
        }
        report.observations.commit = summarize(report.commitSamples.map(sample => sample.milliseconds), 200);
        const passed = Object.values(report.observations).every(observation => observation.passed);
        report.status = passed ? 'measured-endpoints-pass-not-complete-g7' : 'measured-endpoint-budget-failed';
        process.exitCode = passed ? 0 : 1;
    } catch (error) {
        report.status = 'failed';
        report.error = error.stack ?? String(error);
        throw error;
    } finally {
        report.finishedAt = new Date().toISOString();
        save();
    }
    const observations = Object.fromEntries(Object.entries(report.observations).map(([name, value]) => [name, {
        count: value.count,
        p95Milliseconds: value.p95Milliseconds,
        passed: value.passed,
    }]));
    process.stdout.write(`${JSON.stringify({status: report.status, observations}, null, 2)}\n`);
}

/**
 * Samples formal requests inside the Renderer, excluding the external measurement transport.
 * @param {object} page Connected packaged Renderer.
 * @param {object} report Report retaining each attempted request.
 * @param {object} reference Original formally seeded setup projection.
 * @return {Promise<void>} Completed baseline query and commit series.
 */
async function measureRequests(page, report, reference) {
    for (const requestedWindow of [null, {startDate: '2026-09-01', endDate: '2026-09-30'}]) {
        const group = {
            name: requestedWindow ? 'monthQuery' : 'defaultQuery',
            requestedWindow,
            warmups: [],
            samples: [],
        };
        report.queryGroups.push(group);
        for (let index = 0; index < 110; index += 1) {
            const sample = await page.evaluate(`(async () => {
                const requested = ${JSON.stringify(requestedWindow)};
                const started = performance.now();
                const outcome = await window.courseFlow.queryPlan(requested ?? undefined);
                const milliseconds = performance.now() - started;
                if (!outcome.ok) { return {milliseconds, outcome}; }
                const value = outcome.value;
                const projection = value.projection;
                return {milliseconds, outcome: {ok: true, value: {
                    kind: value.kind, appBuildId: value.appBuildId,
                    projection: {workspaceRevision: projection.workspaceRevision, term: projection.term.name,
                        evaluationContext: projection.evaluationContext},
                }}};
            })()`);
            (index < 10 ? group.warmups : group.samples).push(sample);
            const value = formalValue(sample.outcome, 'workspace.plan-projection');
            assert.equal(value.appBuildId, report.appBuildId);
            assert.equal(value.projection.workspaceRevision, reference.workspaceRevision);
            assert.equal(value.projection.term, 'G-A Reference Fall 2026');
        }
    }
    const task = reference.tasks.find(item => item.title === 'GA Task 000');
    assert.ok(task?.occurrenceId?.originalLogicalAnchor === 'once');
    for (let index = 0; index < 40; index += 1) {
        const status = index % 2 === 0 ? 'completed' : 'pending';
        const sample = await page.evaluate(`(async () => {
            const setup = await window.courseFlow.querySetup();
            if (!setup.ok) { return {phase: 'setup', outcome: setup}; }
            const projection = setup.value.projection;
            const task = projection.tasks.find(item => item.taskSeriesId === ${JSON.stringify(task.taskSeriesId)});
            if (!task) { throw new Error('Designated reference task is missing'); }
            const command = {
                commandId: crypto.randomUUID(), followUpId: crypto.randomUUID(),
                expectedRevision: projection.workspaceRevision,
                expectedPlanVersion: projection.planEntityVersion, expectedTaskSeriesVersion: task.entityVersion,
                intent: {kind: 'plan.set-task-occurrence-status', intentSchemaVersion: 2,
                    payload: {taskSeriesId: task.taskSeriesId, originalLogicalAnchor: 'once', status: '${status}'}},
            };
            const started = performance.now();
            const outcome = await window.courseFlow.setTaskOccurrenceStatus(command);
            const milliseconds = performance.now() - started;
            return {milliseconds, command, outcome};
        })()`);
        report.commitSamples.push(sample);
        const value = formalValue(sample.outcome, 'workspace.command-outcome');
        assert.equal(value.outcome.kind, 'committed');
        assert.equal(value.appBuildId, report.appBuildId);
        assert.ok(BigInt(value.outcome.revision) > BigInt(sample.command.expectedRevision));
    }
    const final = formalValue(await page.evaluate('window.courseFlow.querySetup()'), 'workspace.setup-projection');
    assert.equal(final.projection.tasks.find(item => item.taskSeriesId === task.taskSeriesId).status, 'pending');
    assert.equal(final.projection.tasks.length, 200);
    report.finalRevision = final.projection.workspaceRevision;
}

if (process.argv.length === 3 && process.argv[2] === '--self-check') {
    assert.throws(() => parseOutput([]));
    assert.throws(() => parseOutput(['--output', 'relative-directory']));
    assert.throws(() => parseOutput(['--output', REPOSITORY]));
    assert.throws(() => parseOutput(['--output', REPOSITORY, '--unknown']));
    const samples = Array.from({length: 20}, (_, index) => index + 1);
    assert.equal(summarize(samples, 19).p95Milliseconds, 19);
    assert.equal(summarize(samples, 19).p99Milliseconds, null);
    assert.equal(summarize(samples, 19).passed, true);
    assert.equal(summarize(samples, 18).passed, false);
    assert.deepEqual(summarize(samples, 19).samplesMilliseconds, samples);
    assert.equal(summarize(Array.from({length: 100}, (_, index) => index + 1), 100).p99Milliseconds, 99);
    process.stdout.write('PASS CLI refusal, nearest-rank quantiles and budget self-check; no DATA created.\n');
} else if (process.argv.length === 3 && process.argv[2] === '--help') {
    process.stdout.write('Usage: node scripts/measure-ga-packaged.mjs --output ABSOLUTE_NEW_DIRECTORY\n'
        + 'Run from the repository root after pnpm test:compile and pnpm package.\n'
        + 'Runs packaged smoke in the isolated reference before collecting any timing samples.\n'
        + 'Measures 20 process startups, two PLAN windows (10 warmups + 100 samples each), and 40 commits.\n'
        + 'Measures only this host; backup overlap and applicable ADR measurements remain outstanding.\n');
} else {
    main().catch(error => {
        process.stderr.write(`${error.stack ?? String(error)}\n`);
        process.exitCode = 1;
    });
}
