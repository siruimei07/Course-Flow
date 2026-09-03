/**
 * @file Verifies the semantic five-page shell independently of Workspace side effects.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { loadWorkspace, WelcomeSurface, WorkspaceShell } from '../../src/renderer/App';
import type { TaskActionPresentation } from '../../src/renderer/workspace-pages';
import { BOOTSTRAP_PROTOCOL_VERSION } from '../../src/shared/bootstrap-contract';
import type { WorkspaceSetupOutcome } from '../../src/shared/workspace-setup-contract';
import type { SetupProjection } from '../../src/shared/workspace-term-contract';
import {readyLifecycle} from '../shared/workspace-lifecycle-fixture';
import { readRendererStyles } from './renderer-styles.fixture';

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
const styles = readRendererStyles();

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

test('the shell exposes five destinations plus one Settings entry', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceShell, {
        activePage: 'calendar',
        dataMode: 'ready',
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

    const labels = ['Today', 'Courses', 'Calendar', 'Tasks', 'Files'];
    const positions = labels.map(label => html.indexOf(`>${label}</button>`));
    assert.ok(positions.every(position => position >= 0));
    assert.deepEqual(Array.from(positions).sort((left, right) => left - right), positions);
    assert.match(html, /aria-label="主导航"/);
    assert.match(html, /aria-current="page"[^>]*>Calendar/);
    assert.match(html, /aria-label="打开设置"/);
    assert.doesNotMatch(html, /aria-label="打开数据与备份"/);
    assert.match(html, /设置未完成/);
    assert.doesNotMatch(html, /Grade|Attendance|Protect|即将推出/);

    const readOnlyHtml = renderToStaticMarkup(createElement(WorkspaceShell, {
        activePage: 'today',
        dataMode: 'read-only',
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

    const closeRuleIndex = styles.indexOf(
        '.window-control-button--close',
        styles.indexOf('@media (prefers-reduced-transparency: reduce)'),
    );
    assert.ok(closeRuleIndex >= 0);
    const reducedTransparency = styles.slice(
        styles.lastIndexOf('@media (prefers-reduced-transparency: reduce)', closeRuleIndex),
        styles.indexOf('@media (prefers-contrast: more)', closeRuleIndex),
    );
    assert.match(
        reducedTransparency,
        /\.window-control-button--close\s*\{[^}]*color:\s*#fff;[^}]*background:\s*#303030;/s,
    );
    const forcedColors = styles.slice(styles.indexOf('@media (forced-colors: active)'));
    assert.match(
        forcedColors,
        /\.window-control-button:hover\s*\{[^}]*color:\s*HighlightText;[^}]*background:\s*Highlight;/s,
    );
});

test('one visual shell fills the window client area and owns the only vertical scroll', () => {
    const rule = (selector: string): string => {
        const start = styles.indexOf(`${selector} {`);
        assert.ok(start >= 0, `${selector} must exist`);
        return styles.slice(start, styles.indexOf('}', start) + 1);
    };

    assert.match(rule('body'), /padding:\s*0;/);
    assert.match(rule('body'), /overflow:\s*hidden;/);
    assert.match(rule('body'), /height:\s*100%;/);
    assert.match(rule('#root'), /height:\s*100%;/);
    assert.match(rule('.workspace-frame'), /height:\s*100%;/);
    assert.match(rule('.workspace-frame'), /min-height:\s*0;/);
    assert.match(rule('.workspace-frame'), /grid-template-rows:\s*auto minmax\(0, 1fr\);/);
    assert.doesNotMatch(rule('.workspace-frame'), /border-radius:/);
    assert.match(rule('.startup-frame'), /height:\s*100%;/);

    const content = rule('.workspace-content');
    assert.match(content, /min-height:\s*0;/);
    assert.match(content, /overflow-y:\s*auto;/);
    assert.match(content, /scrollbar-width:\s*none;/);
    assert.doesNotMatch(content, /overflow-y:\s*hidden;/);
    assert.match(
        styles,
        /\.workspace-content::-webkit-scrollbar[^{]*\{[^}]*display:\s*none;/s,
    );
});

test('stacked first-setup panels never overlap and a single panel still fills the workspace', () => {
    const rule = (selector: string): string => {
        const start = styles.indexOf(`${selector} {`);
        assert.ok(start >= 0, `${selector} must exist`);
        return styles.slice(start, styles.indexOf('}', start) + 1);
    };

    // A percentage min-height on a grid item desynchronizes the row size from the
    // item size, so the completion summary painted over the holiday form beneath it.
    assert.doesNotMatch(rule('.setup-step-panel'), /min-height:\s*\d+%/);
    assert.match(rule('.setup-workspace'), /align-content:\s*stretch;/);
    assert.match(rule('.setup-workspace'), /overflow-y:\s*auto;/);
});

test('course cards stay compact instead of filling half the Courses page', () => {
    const rule = (selector: string): string => {
        const start = styles.indexOf(`${selector} {`);
        assert.ok(start >= 0, `${selector} must exist`);
        return styles.slice(start, styles.indexOf('}', start) + 1);
    };

    assert.match(
        rule('.workspace-grid--courses'),
        /grid-template-columns:\s*repeat\(auto-fill, minmax\(21rem, 1fr\)\);/,
    );
    assert.match(rule('.course-card'), /padding:\s*clamp\(/);
    assert.match(rule('.workspace-grid--courses'), /list-style:\s*none;/);
    // Slice 15: the five-row hairline spec sheet and its 5.6px colour band are gone for good.
    assert.doesNotMatch(styles, /\.course-card \.course-facts|\.course-card--|\.meeting-rule-list/);
    // Course identity is one dot plus one hairline, inset so the card radius cannot clip its ends.
    assert.match(rule('.course-card::before'), /height:\s*1px;/);
    assert.match(rule('.course-card::before'), /right:\s*var\(--radius-container\);/);
    assert.match(rule('.course-card::before'), /background:\s*var\(--course-accent, #b8b6ad\);/);
    // The archived badge is the one Course badge left, on its own row under the identity.
    assert.match(rule('.course-card-header .status-label'), /justify-self:\s*start;/);
    // The completion bar is the last row of every card, so one grid row shares a baseline.
    assert.match(rule('.course-progress'), /margin-top:\s*auto;/);
    assert.match(styles, /\.course-progress-bar,\r?\n\.course-progress-note \{\s*grid-column: 1 \/ -1;/);
    // One label column per card, so every chip lane starts on the same edge.
    assert.match(rule('.course-slot-groups'), /grid-template-columns:\s*minmax\(0, max-content\) minmax\(0, 1fr\);/);
    assert.match(rule('.course-slot-groups > div'), /display:\s*contents;/);
    // Every line of the card takes a declared type step; no card-local sizes survive.
    for (const selector of [
        '.course-card-code', '.course-card-name', '.course-card-credits',
        '.course-block-label', '.course-slot-groups dt', '.course-slot-chips > li',
        '.course-progress-count', '.course-progress-empty',
    ]) {
        assert.match(rule(selector), /font-size:\s*var\(--text-(xs|sm|base|md|lg)\);/, selector);
    }
    // The page-wide disclosure reuses the Task archive rather than growing a second vocabulary.
    assert.match(styles, /\.task-archive,\r?\n\.course-archive \{[^}]*border-top: 1px solid var\(--line\);/);
    assert.match(styles, /\.task-archive > summary,\r?\n\.course-archive > summary \{[^}]*cursor: pointer;/);
    assert.doesNotMatch(rule('.course-archive > summary'), /transform/);
});

test('the stylesheet keeps fixed type steps, three radius tiers and themed browser surfaces', () => {
    const rule = (selector: string): string => {
        const start = styles.indexOf(`${selector} {`);
        assert.ok(start >= 0, `${selector} must exist`);
        return styles.slice(start, styles.indexOf('}', start) + 1);
    };

    // D12: product UI uses a fixed rem scale; only spacing may stay fluid.
    assert.doesNotMatch(styles, /font-size:\s*clamp\(/);

    // D13: exactly three corner-radius tiers, declared once and explained in place.
    const root = styles.slice(0, styles.indexOf('}'));
    assert.match(root, /--radius-container:/);
    assert.match(root, /--radius-piece:/);
    assert.match(root, /--radius-pill:/);
    assert.match(root, /--radius-mark: 4px;/);
    assert.match(styles, /Three corner-radius tiers and nothing else/);
    const radii = new Set(
        (styles.match(/border-radius:\s*[^;]+;/g) ?? [])
            .map(declaration => declaration.replace(/\s+/g, ' ').trim()),
    );
    const allowed = new Set([
        'border-radius: var(--radius-container);',
        'border-radius: var(--radius-piece);',
        'border-radius: var(--radius-pill);',
        // Slice 12: the only non-surface radius is a chart bar's rounded data end.
        'border-radius: var(--radius-mark) var(--radius-mark) 0 0;',
        'border-radius: 0;',
        'border-radius: 50%;',
        'border-radius: inherit;',
    ]);
    assert.deepEqual(
        [...radii].filter(value => !allowed.has(value)),
        [],
        'every corner radius must come from the three declared tiers',
    );

    // D14: a coloured callout edge never grows into a bar.
    assert.match(rule('.status-banner'), /border-left:\s*1px solid/);

    // D16: the surfaces the browser would otherwise theme for us.
    assert.match(styles, /::selection\s*\{[^}]*background:/s);
    assert.match(styles, /caret-color:/);
    assert.match(rule('.today-headline-stats dd'), /font-variant-numeric:\s*tabular-nums;/);

    // The Today grid is the four-column layout the spec fixes, on the existing breakpoints.
    assert.match(
        rule('.workspace-grid--today'),
        /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\);/,
    );
    assert.match(rule('.workspace-grid--today'), /gap:\s*12px;/);
    assert.match(styles, /@media \(max-width: 1080px\)/);
    assert.match(styles, /@media \(max-width: 820px\)/);
});

test('Task feedback reserves scroll space while keeping the restored control centered', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceShell, {
        activePage: 'tasks',
        dataMode: 'ready',
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

test('FLOW-00 routes absent DATA to welcome without an implicit physical initialization command', async () => {
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
                    workspaceLifecycle: {
                        ...readyLifecycle,
                        route: 'welcome',
                        workspaceRevision: null,
                        operations: [],
                        pendingFollowUps: [],
                    },
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
    assert.equal(result.kind, 'welcome');
    assert.deepEqual(calls, ['query']);
});

test('welcome exposes one explicit keyboard-operable local initialization command', () => {
    const html = renderToStaticMarkup(createElement(WelcomeSurface, {onStart: noop}));
    assert.match(html, /欢迎使用 CourseFlow/);
    assert.match(html, /<button[^>]*type="button"[^>]*>开始新的本地工作区<\/button>/);
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
            isSatisfied: true,
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
                        schemaLevel: 17,
                        revision: '0',
                    },
                    workspaceLifecycle: {
                        ...readyLifecycle,
                        mode: 'limited',
                        route: 'setup',
                        workspaceRevision: '0',
                        capabilities: {
                            ...readyLifecycle.capabilities,
                            'library.read': 'unavailable',
                            'library.write': 'unavailable',
                        },
                        moduleHealth: {
                            ...readyLifecycle.moduleHealth,
                            'MOD-LIBRARY': 'unavailable',
                        },
                        operations: [],
                        pendingFollowUps: [],
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
        assert.equal(result.workspaceMode, 'limited');
        assert.equal(result.route, 'setup');
        assert.equal(result.setup.kind, 'complete');
        assert.equal(result.plan, null);
        assert.match(result.planProblem ?? '', /无法读取统一计划投影/);
    }
});

test('TEST-SHELL-005 routes rollback evidence to the dedicated recovery surface', async () => {
    const calls: string[] = [];
    const bridge = {
        async query() {
            calls.push('query');
            return {
                ok: true,
                value: {
                    protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                    appBuildId: 'development:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                    requestId: 'bootstrap-query',
                    workspaceProcess: 'ready',
                    sqliteVersion: '3.53.1',
                    dataRootClass: 'verified-local',
                    workspaceEpoch: '11111111-1111-4111-8111-111111111111',
                    workspaceData: {
                        kind: 'recovery',
                        problem: {
                            code: 'recovery-required',
                            scope: 'workspace',
                            dataEffect: 'unchanged',
                            affectedCapabilities: ['workspace.read', 'workspace.write'],
                            allowedActions: [],
                            context: {},
                            details: {reason: 'migration-rollback-evidence'},
                        },
                    },
                    workspaceLifecycle: {
                        ...readyLifecycle,
                        mode: 'recovery',
                        route: 'recovery',
                        workspaceRevision: null,
                        operations: [],
                        pendingFollowUps: [],
                    },
                },
            };
        },
        async queryApplicationBuildStatus() {
            calls.push('queryApplicationBuildStatus');
            return {
                ok: false,
                problem: {
                    code: 'recovery-required',
                    message: 'Build status unavailable.',
                    requestId: 'build-status',
                    appBuildId: 'development:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                    workspaceEpoch: '11111111-1111-4111-8111-111111111111',
                    dataEffect: 'unchanged',
                },
            };
        },
        async queryMigrationRollbackStatus(sessionId: string | null) {
            calls.push(`queryMigrationRollbackStatus:${String(sessionId)}`);
            return {
                ok: true,
                value: {
                    kind: 'workspace.migration-rollback-session',
                    protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                    appBuildId: 'development:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                    requestId: 'rollback-status',
                    workspaceEpoch: '11111111-1111-4111-8111-111111111111',
                    session: {
                        migrationRollbackSessionId: null,
                        operationId: null,
                        sessionVersion: null,
                        phase: 'recovery-required',
                        currentBuild: 'recovery-required',
                        binding: null,
                        previewToken: null,
                        allowedActions: [],
                        outcome: null,
                        problem: {code: 'recovery-required'},
                    },
                },
            };
        },
        async querySetup() {
            calls.push('querySetup');
            return setupOutcome();
        },
    } as unknown as Window['courseFlow'];

    const result = await loadWorkspace(bridge);
    assert.equal(result.kind as string, 'migration-maintenance');
    const maintenance = result as unknown as Readonly<{
        kind: string;
        session: Readonly<{phase: string}>;
    }>;
    assert.equal(maintenance.session.phase, 'recovery-required');
    assert.deepEqual(calls, [
        'query',
        'queryApplicationBuildStatus',
        'queryMigrationRollbackStatus:null',
    ]);
});

for (const route of ['maintenance', 'recovery'] as const) {
    test(`FLOW-00 consumes the Workspace ${route} route before ordinary queries`, async () => {
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
                        sqliteVersion: '3.53.1',
                        dataRootClass: 'verified-local',
                        workspaceEpoch: '11111111-1111-4111-8111-111111111111',
                        workspaceData: {
                            kind: 'ready',
                            workspaceId: '22222222-2222-4222-8222-222222222222',
                            schemaLevel: 17,
                            revision: '4',
                        },
                        workspaceLifecycle: {
                            ...readyLifecycle,
                            mode: route === 'maintenance' ? 'maintenance' : 'recovery',
                            route,
                            workspaceRevision: '4',
                            operations: [],
                            pendingFollowUps: [],
                        },
                    },
                };
            },
            async querySetup() {
                calls.push('querySetup');
                return setupOutcome();
            },
        } as unknown as Window['courseFlow'];

        const result = await loadWorkspace(bridge);
        assert.equal(result.kind, route);
        assert.deepEqual(calls, ['query']);
    });
}

test('page-level facts and the page action share one header cell and never span the title', () => {
    const rule = (selector: string): string => {
        const start = styles.indexOf(`${selector} {`);
        assert.ok(start >= 0, `${selector} must exist`);
        return styles.slice(start, styles.indexOf('}', start) + 1);
    };

    // Slice 13: the action used to take grid-row 1 / 3 and grid-column 1 / -1 at once and sat on the H1.
    assert.match(rule('.workspace-page-side'), /grid-column:\s*2;/);
    assert.match(rule('.workspace-page-side'), /grid-row:\s*1 \/ 3;/);
    assert.doesNotMatch(rule('.workspace-page-actions'), /grid-column|grid-row|padding-top/);
    assert.doesNotMatch(rule('.workspace-page-facts'), /grid-column|grid-row/);
    // The Task page's chip and row buttons answer a press and never hover outside a fine pointer.
    assert.match(rule('.task-direct-actions button:active:not(:disabled)'), /transform:\s*scale\(0\.98\)/);
    const hoverRules = new RegExp([
        '\\.task-direct-actions button:hover', '\\.task-filter-chip:hover',
        '\\.task-rows > li:hover', '\\.task-archive > summary:hover',
    ].join('|'));
    assert.doesNotMatch(styles.slice(0, styles.indexOf('@media (hover: hover) and (pointer: fine)')), hoverRules);
    assert.doesNotMatch(styles.slice(styles.indexOf('@media (prefers-reduced-motion: reduce)')), hoverRules);
});
