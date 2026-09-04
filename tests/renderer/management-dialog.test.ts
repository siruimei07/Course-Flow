/**
 * @file Verifies the management surfaces that own supplemental Term, Course, Meeting, Task and Holiday facts.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
    MANAGEMENT_SURFACES,
    ManagementDialog,
    managementSurfaceFromKey,
    type ManagementSurfaceId,
} from '../../src/renderer/ManagementDialog';
import type { ResolvedSetupState } from '../../src/renderer/SetupDialog';
import type { SetupProjection, TermProjection } from '../../src/shared/workspace-term-contract';
import { evaluateAtWidths, skipWithoutBrowser } from './headless-chrome.fixture';

const TERM: TermProjection = {
    termId: '11111111-1111-4111-8111-111111111111',
    name: 'Fall 2026',
    startDate: '2026-09-08',
    endDate: '2026-12-18',
    timeZone: 'America/Toronto',
    archived: false,
    entityVersion: '1',
};

const COURSE_ID = '22222222-2222-4222-8222-222222222222';
const TASK_SERIES_ID = '33333333-3333-4333-8333-333333333333';

const PROJECTION: SetupProjection = {
    workspaceRevision: '4',
    planEntityVersion: '4',
    minimum: {
        hasCurrentTerm: true,
        hasCurrentTermCourse: true,
        hasMeetingOrTask: true,
        isSatisfied: true,
    },
    everReachedMinimum: true,
    defaultRoute: 'today',
    draftCheckpointVersion: '0',
    draftCheckpoint: null,
    currentTerm: TERM,
    terms: [TERM],
    courses: [{
        courseId: COURSE_ID,
        termId: TERM.termId,
        code: 'CSC108',
        name: 'Introduction to Computer Programming',
        section: null,
        instructor: null,
        color: null,
        credits: null,
        teachingRange: {
            kind: 'inherit-term',
            startDate: TERM.startDate,
            endDate: TERM.endDate,
        },
        archived: false,
        entityVersion: '1',
        meetings: [{
            meetingSeriesId: '44444444-4444-4444-8444-444444444444',
            type: { code: 'LEC', name: 'Lecture' },
            weekday: 'THU',
            localStart: '13:00',
            localEnd: '14:00',
            endDayOffset: 0,
            effectiveRange: {
                kind: 'inherit-course',
                startDate: TERM.startDate,
                endDate: TERM.endDate,
            },
            location: { kind: 'tba' },
            entityVersion: '1',
        }],
    }],
    holidayRanges: [],
    tasks: [{
        taskSeriesId: TASK_SERIES_ID,
        courseId: COURSE_ID,
        title: 'Read chapter 1',
        size: 'small',
        entityVersion: '1',
        deadline: { kind: 'tba' },
        occurrenceId: { taskSeriesId: TASK_SERIES_ID, originalLogicalAnchor: 'once' },
        status: 'pending',
        reportedProgress: null,
        displayProgress: null,
        overrideKind: 'none',
    }],
};

const STATE: ResolvedSetupState = {
    kind: 'complete',
    dataMode: 'ready',
    projection: PROJECTION,
};

/**
 * Renders one management surface with inert but real callbacks.
 *
 * @param {ManagementSurfaceId} surface Surface selected by the fixed category list.
 * @param {ResolvedSetupState} state Validated setup state.
 * @return {string} Static semantic HTML.
 */
function render(surface: ManagementSurfaceId, state: ResolvedSetupState = STATE): string {
    return renderToStaticMarkup(createElement(ManagementDialog, {
        open: true,
        surface,
        state,
        onClose(): void {},
        onProjection(): void {},
        onSurfaceChange(): void {},
    }));
}

test('management is one modal surface with five ordered categories', () => {
    assert.deepEqual(MANAGEMENT_SURFACES.map(surface => surface.label), [
        '学期',
        '课程',
        '课节',
        '任务',
        '假期',
    ]);

    const html = render('course');
    assert.match(html, /<dialog/);
    assert.match(html, /aria-modal="true"/);
    assert.match(html, /aria-label="管理分类"/);
    assert.match(html, /aria-label="关闭管理页面"/);
    assert.doesNotMatch(html, /aria-label="窗口控件"/);

    const positions = MANAGEMENT_SURFACES.map(
        surface => html.indexOf(`>${surface.label}</button>`),
    );
    assert.ok(positions.every(position => position >= 0));
    assert.deepEqual(Array.from(positions).sort((left, right) => left - right), positions);
});

test('category keys move within the fixed surface list and ignore other keys', () => {
    assert.equal(managementSurfaceFromKey('term', 'ArrowDown'), 'course');
    assert.equal(managementSurfaceFromKey('course', 'ArrowUp'), 'term');
    assert.equal(managementSurfaceFromKey('term', 'ArrowUp'), 'holiday');
    assert.equal(managementSurfaceFromKey('holiday', 'ArrowDown'), 'term');
    assert.equal(managementSurfaceFromKey('task', 'Home'), 'term');
    assert.equal(managementSurfaceFromKey('task', 'End'), 'holiday');
    assert.equal(managementSurfaceFromKey('task', 'Enter'), null);
});

test('each surface exposes its own real creation form and no other', () => {
    const term = render('term');
    assert.match(term, /name="term-name"/);
    assert.doesNotMatch(term, /name="course-code"/);

    const course = render('course');
    assert.match(course, /name="course-code"/);
    assert.doesNotMatch(course, /name="meeting-course"/);

    const meeting = render('meeting');
    assert.match(meeting, /name="meeting-course"/);
    assert.match(meeting, /保存课节/);
    assert.doesNotMatch(meeting, /name="task-title"/);

    const task = render('task');
    assert.match(task, /name="task-title"/);
    assert.match(task, /保存任务/);
    assert.doesNotMatch(task, /name="meeting-course"/);

    const holiday = render('holiday');
    assert.match(holiday, /name="holiday-name"/);
    assert.match(holiday, /保存假期/);
    assert.doesNotMatch(holiday, /name="task-title"/);
});

test('each surface lists only the committed facts it owns', () => {
    assert.match(render('term'), /Fall 2026[\s\S]*当前学期/);
    assert.match(render('course'), /CSC108 · Introduction to Computer Programming/);
    assert.match(render('meeting'), /CSC108 · LEC[\s\S]*星期四 13:00-14:00[\s\S]*TBA/);
    assert.match(render('task'), /Read chapter 1[\s\S]*一次性/);
    assert.match(render('holiday'), /当前没有已保存的记录/);
});

test('read-only management disables every editable control instead of hiding the facts', () => {
    const html = render('course', { ...STATE, dataMode: 'read-only' });

    assert.match(html, /<fieldset(?=[^>]*class="form-control-group")(?=[^>]*disabled="")[^>]*>/);
    assert.match(html, /只读模式；可以查看已保存的正式数据，但不能新增或更改。/);
    assert.match(html, /CSC108 · Introduction to Computer Programming/);
});

test('management adopts new formal defaults while preserving edited and unconfirmed drafts', {
    skip: skipWithoutBrowser,
    timeout: 30000,
}, async () => {
    const { build } = await import('vite');
    const modulePath = path.resolve('src/renderer/ManagementDialog.tsx').replaceAll('\\', '/');
    const entry = path.resolve('management-lifecycle-fixture.js').replaceAll('\\', '/');
    const bundle = await build({
        configFile: false,
        logLevel: 'silent',
        define: { 'process.env.NODE_ENV': '"production"' },
        plugins: [{
            name: 'management-lifecycle',
            resolveId: id => id.endsWith('management-lifecycle-fixture.js') ? '\0management-lifecycle' : undefined,
            load: id => id === '\0management-lifecycle' ? `
                import { createElement } from 'react';
                import { createRoot } from 'react-dom/client';
                import { flushSync } from 'react-dom';
                import { ManagementDialog } from ${JSON.stringify(modulePath)};
                const root = createRoot(document.getElementById('root'));
                window.renderManagement = props => flushSync(() => {
                    root.render(createElement(ManagementDialog, props));
                });
            ` : undefined,
        }],
        build: {
            write: false,
            minify: false,
            lib: { entry, name: 'ManagementLifecycle', formats: ['iife'] },
        },
    });
    const built = Array.isArray(bundle) ? bundle[0] : bundle;
    assert.ok(built && 'output' in built);
    const chunk = built.output.find(item => item.type === 'chunk');
    assert.ok(chunk?.type === 'chunk');
    const html = '<!doctype html><html><head><meta charset="utf-8"></head><body>'
        + '<div id="root"></div><script>' + chunk.code.replaceAll('</script', '<\\/script')
        + '</script></body></html>';
    const expression = `(async () => {
        const state = ${JSON.stringify(STATE)};
        const tick = () => new Promise(resolve => setTimeout(resolve, 0));
        let props = {
            open: false, surface: 'course', state,
            onClose() {}, onProjection() {}, onSurfaceChange() {},
        };
        const render = async changes => {
            props = { ...props, ...changes };
            window.renderManagement(props);
            await tick();
        };
        const field = name => document.querySelector('[name="' + name + '"]');
        const edit = async (name, value) => {
            const input = field(name);
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            await tick();
        };
        const values = () => ['course-code', 'course-name', 'course-teaching-start', 'course-teaching-end']
            .map(name => field(name).value);
        await render({ state: { ...state, kind: 'term', projection: {
            ...state.projection, workspaceRevision: '0', currentTerm: null, terms: [], courses: [],
        } } });
        await render({ state });
        await render({ open: true });
        const defaults = values();
        await edit('course-code', 'CSC148');
        await edit('course-name', 'Introduction to Computer Science');
        let submitted = null;
        window.courseFlow = { createCourse: async command => {
            submitted = command;
            throw new Error('transport unavailable');
        } };
        field('course-code').form.requestSubmit();
        await tick();
        await tick();
        if (submitted === null) return { defaults, submitted };
        const unconfirmed = values();
        await render({ state: { ...state, projection: {
            ...state.projection, workspaceRevision: '5',
            currentTerm: { ...state.projection.currentTerm, startDate: '2026-09-09' },
        } } });
        const afterRefresh = values();
        const locked = field('course-code').closest('fieldset').disabled;
        window.courseFlow = {
            createCourse: async command => {
                if (JSON.stringify(command) !== JSON.stringify(submitted)) throw new Error('changed retry');
                return { ok: true };
            },
            querySetup: async () => ({ ok: true, value: {
                kind: 'workspace.setup-projection', dataMode: 'ready', projection: state.projection,
            } }),
        };
        document.querySelector('.settings-modal-footer button').click();
        await tick();
        await tick();
        const afterCommit = values();
        await edit('course-code', 'MAT102');
        await edit('course-teaching-start', '2026-09-10');
        const edited = values();
        await render({ open: false });
        await render({ open: true });
        const reopened = values();
        return { defaults, submitted, unconfirmed, afterRefresh, locked, afterCommit, edited, reopened };
    })()`;
    const measured = await evaluateAtWidths<{
        defaults: string[];
        submitted: { intent: { payload: { course: { teachingRange: { kind: string } } } } };
        unconfirmed: string[];
        afterRefresh: string[];
        locked: boolean;
        afterCommit: string[];
        edited: string[];
        reopened: string[];
    }>(html, [1280], expression);
    const result = measured.get(1280);
    assert.ok(result);
    assert.deepEqual(result.defaults, ['', '', TERM.startDate, TERM.endDate]);
    assert.equal(result.submitted.intent.payload.course.teachingRange.kind, 'inherit-term');
    assert.deepEqual(result.unconfirmed, ['CSC148', 'Introduction to Computer Science', TERM.startDate, TERM.endDate]);
    assert.deepEqual(result.afterRefresh, result.unconfirmed);
    assert.equal(result.locked, true);
    assert.deepEqual(result.afterCommit, result.defaults);
    assert.deepEqual(result.reopened, result.edited);
});
