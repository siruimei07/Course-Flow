/**
 * @file Verifies Setup transport truth through the production preload boundary.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import {
    WORKSPACE_QUERY_CHANNEL,
    type BootstrapOutcome,
} from '../src/shared/bootstrap-contract';
import {
    WORKSPACE_SETUP_CHANNEL,
    type WorkspaceSetupOutcome,
    type WorkspaceSetupRequest,
} from '../src/shared/workspace-setup-contract';
import type { CreateTermCommand } from '../src/shared/workspace-term-contract';

const APP_BUILD_ID = 'development:1234567890abcdef1234567890abcdef12345678';
const WORKSPACE_EPOCH = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const repositoryRoot = path.resolve(__dirname, '..', '..');
const preloadPath = path.join(repositoryRoot, 'src', 'preload.ts');
const compiledPreloadRoot = path.join(repositoryRoot, '.test-dist', 'preload-runtime');
const compiledPreloadPath = path.join(compiledPreloadRoot, 'preload.js');
const compiledSourceRoot = path.join(repositoryRoot, '.test-dist', 'src');
const requireFromTest = createRequire(__filename);
let compiledPreloadSource: string | null = null;

const TERM_COMMAND = {
    commandId: '33333333-3333-4333-8333-333333333333',
    followUpId: '44444444-4444-4444-8444-444444444444',
    expectedRevision: '0',
    expectedPlanVersion: '0',
    intent: {
        kind: 'plan.create-term',
        intentSchemaVersion: 1,
        payload: {
            name: 'Fall 2026',
            startDate: '2026-09-08',
            endDate: '2026-12-18',
            timeZone: 'America/Toronto',
        },
    },
} as const satisfies CreateTermCommand;

type PreloadCourseFlow = Readonly<{
    query(): Promise<BootstrapOutcome>;
    querySetup(): Promise<WorkspaceSetupOutcome>;
    createTerm(command: CreateTermCommand): Promise<WorkspaceSetupOutcome>;
}>;

type PreloadWindowFrame = Readonly<{
    control(action: 'minimize' | 'toggle-maximize' | 'close'): void;
}>;

type SetupResponder = (request: WorkspaceSetupRequest) => Promise<unknown>;

type PreloadHarness = Readonly<{
    courseFlow: PreloadCourseFlow;
    courseFlowWindow: PreloadWindowFrame | null;
    setupRequests: readonly WorkspaceSetupRequest[];
    windowControlActions: readonly string[];
}>;

/**
 * Creates a correlated ready response for the preload's bootstrap request.
 * @param {string} requestId Correlated bootstrap request identity.
 * @return {BootstrapOutcome} Valid ready Workspace response.
 */
function readyOutcome(requestId: string): BootstrapOutcome {
    return {
        ok: true,
        value: {
            protocolVersion: 2,
            appBuildId: APP_BUILD_ID,
            requestId,
            workspaceProcess: 'ready',
            sqliteVersion: '3.50.4',
            dataRootClass: 'verified-local',
            workspaceEpoch: WORKSPACE_EPOCH,
            workspaceData: {
                kind: 'ready',
                workspaceId: WORKSPACE_ID,
                schemaLevel: 11,
                revision: '0',
            },
        },
    };
}

/**
 * Executes the real preload module with only Electron's external boundary replaced.
 * @param {SetupResponder} respondToSetup Controlled Workspace setup transport.
 * @return {PreloadHarness} Exposed courseFlow API and sent setup requests.
 */
function loadPreload(respondToSetup: SetupResponder): PreloadHarness {
    const setupRequests: WorkspaceSetupRequest[] = [];
    const windowControlActions: string[] = [];
    let courseFlow: PreloadCourseFlow | null = null;
    let courseFlowWindow: PreloadWindowFrame | null = null;
    let nextRequestNumber = 1;
    if (compiledPreloadSource === null) {
        execFileSync(process.execPath, [
            path.join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
            preloadPath,
            '--ignoreConfig',
            '--target',
            'ES2023',
            '--module',
            'node16',
            '--moduleResolution',
            'node16',
            '--skipLibCheck',
            '--noCheck',
            '--outDir',
            compiledPreloadRoot,
        ], { cwd: repositoryRoot });
        compiledPreloadSource = readFileSync(compiledPreloadPath, 'utf8');
    }
    const output = compiledPreloadSource;
    const electron = {
        contextBridge: {
            exposeInMainWorld(name: string, value: unknown): void {
                if (name === 'courseFlow') {
                    courseFlow = value as PreloadCourseFlow;
                    return;
                }
                if (name === 'courseFlowWindow') {
                    courseFlowWindow = value as PreloadWindowFrame;
                    return;
                }
                assert.fail(`Unexpected preload surface: ${name}`);
            },
        },
        ipcRenderer: {
            invoke(channel: string, request: unknown): Promise<unknown> {
                if (channel === WORKSPACE_QUERY_CHANNEL) {
                    const requestId = (request as Readonly<{ requestId: string }>).requestId;
                    return Promise.resolve(readyOutcome(requestId));
                }
                assert.equal(channel, WORKSPACE_SETUP_CHANNEL);
                const setupRequest = request as WorkspaceSetupRequest;
                setupRequests.push(setupRequest);
                return respondToSetup(setupRequest);
            },
            send(channel: string, action: string): void {
                assert.equal(channel, 'courseflow:window-control');
                windowControlActions.push(action);
            },
        },
    };
    const localRequire = (specifier: string): unknown => {
        if (specifier === 'electron') {
            return electron;
        }
        if (specifier.startsWith('./shared/')) {
            return requireFromTest(path.join(compiledSourceRoot, `${specifier.slice(2)}.js`));
        }
        return requireFromTest(specifier);
    };
    const moduleRecord: { exports: Record<string, unknown> } = { exports: {} };

    vm.runInNewContext(output, {
        __COURSEFLOW_APP_BUILD_ID__: APP_BUILD_ID,
        crypto: {
            randomUUID(): string {
                return `00000000-0000-4000-8000-${String(nextRequestNumber++).padStart(12, '0')}`;
            },
        },
        exports: moduleRecord.exports,
        module: moduleRecord,
        require: localRequire,
    }, { filename: preloadPath });

    assert.notEqual(courseFlow, null);
    return {
        courseFlow: courseFlow as unknown as PreloadCourseFlow,
        courseFlowWindow,
        setupRequests,
        windowControlActions,
    };
}

/**
 * Requires one failure and returns its structured problem.
 * @param {WorkspaceSetupOutcome} outcome Preload result under examination.
 * @return {Extract<WorkspaceSetupOutcome, {ok: false}>['problem']} Structured problem.
 */
function outcomeProblem(
    outcome: WorkspaceSetupOutcome,
): Extract<WorkspaceSetupOutcome, Readonly<{ ok: false }>>['problem'] {
    assert.equal(outcome.ok, false);
    if (outcome.ok) {
        throw new Error('Expected a failed Workspace setup outcome');
    }
    return outcome.problem;
}

test('a sent mutation reports unknown when its IPC response is rejected', async () => {
    const harness = loadPreload(() => Promise.reject(new Error('response lost')));
    await harness.courseFlow.query();

    const problem = outcomeProblem(await harness.courseFlow.createTerm(TERM_COMMAND));

    assert.equal(harness.setupRequests.length, 1);
    assert.equal(problem.code, 'recovery-required');
    assert.equal(problem.dataEffect, 'unknown');
});

test('a sent mutation reports unknown when its IPC response is malformed', async () => {
    const harness = loadPreload(() => Promise.resolve({ ok: true, malformed: true }));
    await harness.courseFlow.query();

    const problem = outcomeProblem(await harness.courseFlow.createTerm(TERM_COMMAND));

    assert.equal(harness.setupRequests.length, 1);
    assert.equal(problem.code, 'recovery-required');
    assert.equal(problem.dataEffect, 'unknown');
});

test('a failed query and a mutation rejected before send remain unchanged', async () => {
    const harness = loadPreload(() => Promise.reject(new Error('query unavailable')));
    await harness.courseFlow.query();

    const queryProblem = outcomeProblem(await harness.courseFlow.querySetup());
    const requestCountAfterQuery = harness.setupRequests.length;
    const invalidCommand = null as unknown as CreateTermCommand;
    const mutationProblem = outcomeProblem(await harness.courseFlow.createTerm(invalidCommand));

    assert.equal(queryProblem.dataEffect, 'unchanged');
    assert.equal(mutationProblem.dataEffect, 'unchanged');
    assert.equal(harness.setupRequests.length, requestCountAfterQuery);
});

test('preload exposes a separate fixed-channel window control surface', () => {
    const harness = loadPreload(() => Promise.reject(new Error('unused')));
    assert.notEqual(harness.courseFlowWindow, null);

    harness.courseFlowWindow!.control('minimize');
    harness.courseFlowWindow!.control('toggle-maximize');
    harness.courseFlowWindow!.control('close');

    assert.deepEqual(harness.windowControlActions, [
        'minimize',
        'toggle-maximize',
        'close',
    ]);
});
