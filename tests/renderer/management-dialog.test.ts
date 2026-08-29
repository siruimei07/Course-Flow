/**
 * @file Verifies the management surfaces that own supplemental Term, Course, Meeting, Task and Holiday facts.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

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
    assert.match(render('meeting'), /CSC108 · LEC[\s\S]*星期四 13:00–14:00[\s\S]*TBA/);
    assert.match(render('task'), /Read chapter 1[\s\S]*一次性/);
    assert.match(render('holiday'), /当前没有已保存的记录/);
});

test('read-only management disables every editable control instead of hiding the facts', () => {
    const html = render('course', { ...STATE, dataMode: 'read-only' });

    assert.match(html, /<fieldset(?=[^>]*class="form-control-group")(?=[^>]*disabled="")[^>]*>/);
    assert.match(html, /只读模式；可以查看已保存的正式数据，但不能新增或更改。/);
    assert.match(html, /CSC108 · Introduction to Computer Programming/);
});
