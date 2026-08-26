/**
 * @file Verifies the semantic five-page shell independently of Workspace side effects.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { loadWorkspace, WorkspaceShell } from '../../src/renderer/App';
import type { TaskActionPresentation } from '../../src/renderer/workspace-pages';
import { BOOTSTRAP_PROTOCOL_VERSION } from '../../src/shared/bootstrap-contract';
import type { WorkspaceSetupOutcome } from '../../src/shared/workspace-setup-contract';
import type { SetupProjection } from '../../src/shared/workspace-term-contract';

const setup: SetupProjection = {
    workspaceRevision: '0',
    planEntityVersion: '0',
    minimum: {
        hasCurrentTerm: false,
        hasCurrentTermCourse: false,
        hasMeetingOrTask: false,
        isSatisfied: false,
    },
    everReachedMinimum: false,
    defaultRoute: 'setup',
    draftCheckpointVersion: '0',
    draftCheckpoint: null,
    currentTerm: null,
    terms: [],
    courses: [],
    holidayRanges: [],
    tasks: [],
};

const noop = (): void => {};
const styles = readFileSync(path.join(process.cwd(), 'src/renderer/styles.css'), 'utf8');

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

function setupOutcome(projection: SetupProjection = setup): WorkspaceSetupOutcome {
    return {
        ok: true,
        value: {
            kind: 'workspace.setup-projection',
            protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
            appBuildId: 'test-build',
            requestId: 'setup-query',
            workspaceEpoch: 'workspace-epoch',
            dataMode: 'ready',
            projection,
        },
    };
}

test('the shell exposes five ordered destinations and a separate Settings action', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceShell, {
        activePage: 'calendar',
        dataMode: 'ready',
        setup,
        plan: null,
        planProblem: null,
        onNavigate: noop,
        onCreateTask: noop,
        onOpenSetup: noop,
        onRetryPlan: noop,
        taskActions,
    }));

    const labels = ['Today', 'Courses', 'Calendar', 'Tasks', 'Files'];
    const positions = labels.map(label => html.indexOf(`>${label}</button>`));
    assert.ok(positions.every(position => position >= 0));
    assert.deepEqual(Array.from(positions).sort((left, right) => left - right), positions);
    assert.match(html, /aria-label="主导航"/);
    assert.match(html, /aria-current="page"[^>]*>Calendar/);
    assert.match(html, /aria-label="打开设置"/);
    assert.match(html, /设置未完成/);
    assert.doesNotMatch(html, /Grade|Attendance|Protect|即将推出/);

    const readOnlyHtml = renderToStaticMarkup(createElement(WorkspaceShell, {
        activePage: 'today',
        dataMode: 'read-only',
        setup,
        plan: null,
        planProblem: null,
        onNavigate: noop,
        onCreateTask: noop,
        onOpenSetup: noop,
        onRetryPlan: noop,
        taskActions: { ...taskActions, writable: false },
    }));
    assert.match(readOnlyHtml, /只读模式/);
});

test('the title region exposes three independent window controls outside its drag surface', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceShell, {
        activePage: 'calendar',
        dataMode: 'ready',
        setup,
        plan: null,
        planProblem: null,
        onNavigate: noop,
        onCreateTask: noop,
        onOpenSetup: noop,
        onRetryPlan: noop,
        taskActions,
    }));

    assert.match(html, /aria-label="窗口控件"/);
    assert.match(html, /aria-label="最小化窗口"/);
    assert.match(html, /aria-label="最大化或还原窗口"/);
    assert.match(html, /aria-label="关闭窗口"/);
    assert.match(html, /class="window-control-icon"/);
    const dragStart = /\.topbar,\s*\.startup-titlebar\s*\{/s.exec(styles)?.index ?? -1;
    assert.ok(dragStart >= 0);
    const dragBlock = styles.slice(dragStart, styles.indexOf('}', dragStart) + 1);
    assert.match(dragBlock, /-webkit-app-region:\s*drag;/);
    assert.match(dragBlock, /app-region:\s*drag;/);
    const noDragStart = /\.primary-nav,\s*\.topbar-actions,\s*\.window-controls,/s.exec(styles)?.index ?? -1;
    assert.ok(noDragStart >= 0);
    const noDragBlock = styles.slice(noDragStart, styles.indexOf('}', noDragStart) + 1);
    assert.match(noDragBlock, /-webkit-app-region:\s*no-drag;/);
    assert.match(noDragBlock, /app-region:\s*no-drag;/);
    assert.match(styles, /--titlebar-height:/);
    assert.match(styles, /--titlebar-surface:/);
    assert.match(styles, /--titlebar-border:/);
    assert.match(styles, /--titlebar-safe-inset:/);

    const reducedTransparency = styles.slice(
        styles.indexOf('@media (prefers-reduced-transparency: reduce)'),
        styles.indexOf('@media (prefers-contrast: more)'),
    );
    assert.match(
        reducedTransparency,
        /\.window-control-button--close\s*\{[^}]*color:\s*#fff;[^}]*background:\s*#292a27;/s,
    );
    const forcedColors = styles.slice(styles.indexOf('@media (forced-colors: active)'));
    assert.match(
        forcedColors,
        /\.window-control-button:hover\s*\{[^}]*color:\s*HighlightText;[^}]*background:\s*Highlight;/s,
    );
});

test('Task feedback reserves scroll space while keeping the restored control centered', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceShell, {
        activePage: 'tasks',
        dataMode: 'ready',
        setup,
        plan: null,
        planProblem: null,
        onNavigate: noop,
        onCreateTask: noop,
        onOpenSetup: noop,
        onRetryPlan: noop,
        taskActions: {
            ...taskActions,
            undo: {
                actionLabel: '撤销',
                message: '任务状态已保存，可在 6 秒内撤销。',
                submitting: false,
            },
        },
    }));

    assert.match(html, /class="workspace-frame workspace-frame--task-feedback"/);
    assert.match(
        styles,
        /\.workspace-frame--task-feedback\s+\.workspace-content\s*\{[^}]*padding-bottom:/s,
    );
});

test('startup initializes absent DATA, resumes Setup, and does not query an inapplicable PLAN', async () => {
    const calls: string[] = [];
    const bridge = {
        async query() {
            calls.push('query');
            return {
                ok: true,
                value: {
                    protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                    appBuildId: 'test-build',
                    requestId: 'bootstrap-query',
                    workspaceProcess: 'ready',
                    sqliteVersion: '3.50.4',
                    dataRootClass: 'verified-local',
                    workspaceEpoch: 'workspace-epoch',
                    workspaceData: { kind: 'absent' },
                },
            };
        },
        async initialize() {
            calls.push('initialize');
            return setupOutcome();
        },
        async querySetup() {
            calls.push('querySetup');
            return setupOutcome();
        },
        async queryPlan() {
            calls.push('queryPlan');
            return setupOutcome();
        },
    } as unknown as Window['courseFlow'];

    const result = await loadWorkspace(bridge);
    assert.equal(result.kind, 'ready');
    if (result.kind === 'ready') {
        assert.equal(result.setup.kind, 'term');
        assert.equal(result.plan, null);
        assert.equal(result.planProblem, null);
    }
    assert.deepEqual(calls, ['query', 'initialize', 'querySetup']);
});

test('a PLAN failure remains distinct from an empty Setup projection', async () => {
    const currentTerm = {
        termId: '11111111-1111-4111-8111-111111111111',
        name: 'Fall 2026',
        startDate: '2026-09-08',
        endDate: '2026-12-18',
        timeZone: 'America/Toronto',
        archived: false,
        entityVersion: '1',
    } as const;
    const currentSetup: SetupProjection = {
        ...setup,
        minimum: {
            ...setup.minimum,
            hasCurrentTerm: true,
        },
        currentTerm,
        terms: [currentTerm],
    };
    const bridge = {
        async query() {
            return {
                ok: true,
                value: {
                    protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                    appBuildId: 'test-build',
                    requestId: 'bootstrap-query',
                    workspaceProcess: 'ready',
                    sqliteVersion: '3.50.4',
                    dataRootClass: 'verified-local',
                    workspaceEpoch: 'workspace-epoch',
                    workspaceData: {
                        kind: 'ready',
                        workspaceId: '22222222-2222-4222-8222-222222222222',
                        schemaLevel: 16,
                        revision: '0',
                    },
                },
            };
        },
        async querySetup() {
            return setupOutcome(currentSetup);
        },
        async queryPlan() {
            throw new Error('offline');
        },
    } as unknown as Window['courseFlow'];

    const result = await loadWorkspace(bridge);
    assert.equal(result.kind, 'ready');
    if (result.kind === 'ready') {
        assert.equal(result.setup.kind, 'course');
        assert.equal(result.plan, null);
        assert.match(result.planProblem ?? '', /无法读取统一计划投影/);
    }
});
