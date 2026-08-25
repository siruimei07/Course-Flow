/**
 * @file Verifies the bounded setup UI and its Renderer-only routing decisions.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { setupStateFrom } from '../../src/renderer/setup-state';
import { BOOTSTRAP_PROTOCOL_VERSION } from '../../src/shared/bootstrap-contract';
import type { WorkspaceSetupOutcome } from '../../src/shared/workspace-setup-contract';

const repositoryRoot = process.cwd();
const main = readFileSync(path.join(repositoryRoot, 'src/renderer/main.tsx'), 'utf8');
const app = readFileSync(path.join(repositoryRoot, 'src/renderer/App.tsx'), 'utf8');
const setupDialog = readFileSync(path.join(repositoryRoot, 'src/renderer/SetupDialog.tsx'), 'utf8');
const pages = readFileSync(path.join(repositoryRoot, 'src/renderer/workspace-pages.tsx'), 'utf8');
const renderer = [main, app, setupDialog, pages].join('\n');
const styles = readFileSync(path.join(repositoryRoot, 'src/renderer/styles.css'), 'utf8');
const termSetup = setupDialog.slice(
    setupDialog.indexOf('function TermForm'),
    setupDialog.indexOf('function CourseForm'),
);
const courseSetup = setupDialog.slice(
    setupDialog.indexOf('function CourseForm'),
    setupDialog.indexOf('function MeetingForm'),
);
const meetingSetup = setupDialog.slice(
    setupDialog.indexOf('function MeetingForm'),
    setupDialog.indexOf('function TaskForm'),
);

test('UI-SETUP-01 exposes Current Term, standalone Course, then a Meeting or Task choice', () => {
    assert.match(renderer, /当前学期/);
    assert.match(renderer, /学期名称/);
    assert.match(renderer, /开始日期/);
    assert.match(renderer, /结束日期/);
    assert.match(renderer, /默认时区/);
    assert.match(renderer, /创建并继续/);
    assert.match(app, /bridge\.initialize/);
    assert.match(app, /bridge\.querySetup/);
    assert.match(renderer, /courseFlow\.createTerm/);
    assert.match(renderer, /课程代码/);
    assert.match(renderer, /课程名称/);
    assert.match(renderer, /节号（可选）/);
    assert.match(renderer, /授课教师（可选）/);
    assert.match(renderer, /颜色（可选）/);
    assert.match(renderer, /学分（可选）/);
    assert.match(renderer, /课节类型/);
    assert.match(renderer, /LEC — Lecture/);
    assert.match(renderer, /TUT — Tutorial/);
    assert.match(renderer, /PRA — Practical/);
    assert.match(renderer, /星期/);
    assert.match(renderer, /开始时间/);
    assert.match(renderer, /结束时间/);
    assert.match(renderer, /生效开始日期/);
    assert.match(renderer, /生效结束日期/);
    assert.match(renderer, /地点/);
    assert.match(renderer, /待定/);
    assert.match(renderer, /课程教学开始日期/);
    assert.match(renderer, /课程教学结束日期/);
    assert.match(renderer, /保存课程并继续/);
    assert.match(renderer, /courseFlow\.createCourse/);
    assert.match(renderer, /选择添加方式/);
    assert.match(renderer, /添加课节/);
    assert.match(renderer, /添加任务/);
    assert.match(renderer, /courseFlow\.createMeetingSeries/);
    assert.doesNotMatch(termSetup, /overlapDecision/);
    assert.doesNotMatch(courseSetup, /overlapDecision/);
    assert.match(meetingSetup, /overlapDecision:\s*'review'/);
    assert.match(meetingSetup, /overlapDecision:\s*'continue'/);
    assert.match(renderer, /添加课节或任务/);
    assert.match(renderer, /courseFlow\.createTask/);
    assert.match(renderer, /精确时间/);
    assert.match(renderer, /每周重复/);
    assert.match(renderer, /跟随教学周/);
    assert.match(renderer, /生效开始日期/);
    assert.doesNotMatch(setupDialog, /courseFlow\.createCourseWithMeeting/);
    assert.doesNotMatch(renderer, /课节教师|新增课节|拆分规则|成绩|保护数据|备份/);
});

test('UI-SETUP-01 keeps the confirmed light surface and keyboard/reduced-motion affordances', () => {
    assert.match(styles, /color-scheme:\s*light/);
    assert.match(styles, /:focus-visible/);
    assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)/);
    assert.match(styles, /\.setup-modal/);
    assert.match(styles, /\.setup-progress-card/);
    assert.match(styles, /\.setup-form/);
});

test('WP-R4-06 exposes interruptible setup over the five-page Workspace shell', () => {
    assert.match(renderer, /Today/);
    assert.match(renderer, /Courses/);
    assert.match(renderer, /Calendar/);
    assert.match(renderer, /Tasks/);
    assert.match(renderer, /Files/);
    assert.match(renderer, /<dialog/);
    assert.match(renderer, /showModal/);
    assert.match(renderer, /保存进度并退出/);
    assert.match(renderer, /进入今天/);
    assert.match(renderer, /onCancel/);
    assert.match(app, /initialWorkspaceSurfaceFrom/);
    assert.match(app, /bridge\.queryPlan/);
    assert.match(app, /SetupDialog/);
    assert.match(styles, /backdrop-filter/);
    assert.match(styles, /@media \(prefers-contrast:\s*more\)/);
    assert.match(styles, /@media \(forced-colors:\s*active\)/);
});

test('WP-R4-06 closes the native modal before restoring focus and gives the skip target focus', () => {
    assert.match(setupDialog, /const closeDialog = [\s\S]*dialog\.close\(\);[\s\S]*props\.onClose/);
    assert.match(app, /returnTarget\?\.isConnected/);
    assert.match(app, /<main[\s\S]*id="workspace-content"[\s\S]*tabIndex=\{-1\}/);
});

test('WP-R4-06 does not let stale completion focus override direct Task entry', () => {
    const cancellableFocusPattern = new RegExp(
        'const completionFocusFrame = globalThis\\.requestAnimationFrame'
        + '[\\s\\S]{0,200}return \\(\\) => [^{;]*'
        + 'globalThis\\.cancelAnimationFrame\\(completionFocusFrame\\)',
    );
    assert.match(
        setupDialog,
        /useEffect\(\(\) => \{\s*if \(!props\.open[\s\S]{0,500}props\.entryIntent === 'task'/,
    );
    assert.match(setupDialog, cancellableFocusPattern);
});

test('WP-R4-06 blocks competing setup exits and edits while a draft or formal command is pending', () => {
    assert.match(setupDialog, /const \[commandBusy, setCommandBusy\] = useState\(false\)/);
    assert.match(setupDialog, /useReducer\(\s*reducePendingSetupMutation/);
    assert.match(setupDialog, /const hasPendingMutation = pendingMutation !== null/);
    assert.match(setupDialog, /disabled=\{savingCheckpoint \|\| commandBusy \|\| hasPendingMutation\}/);
    assert.match(setupDialog, /inputLocked=\{hasPendingMutation\}/);
    assert.match(setupDialog, /selectionBlocked=\{hasPendingMutation\}/);
    assert.match(setupDialog, /onBusyChange=\{setCommandBusy\}/);
    assert.match(
        setupDialog,
        /const hasUncommittedDraft = isDirty\.current \|\| \(checkpoint !== null/,
    );
    assert.match(
        setupDialog,
        /disabled=\{savingCheckpoint[\s\S]{0,160}hasPendingMutation[\s\S]{0,80}hasUncommittedDraft\}/,
    );
});

test('rejected setup command transport keeps its idempotent request and reports an unknown result', () => {
    assert.match(termSetup, /let command = props\.pendingCommand/);
    assert.match(courseSetup, /let command = props\.pendingCommand/);
    assert.match(meetingSetup, /let command = props\.pendingCommand/);
    assert.equal((setupDialog.match(/props\.onUnknown\(command\)/g) ?? []).length >= 5, true);
    assert.match(setupDialog, /精确重试未确认请求/);
    assert.equal((setupDialog.match(/结果尚无法确认/g) ?? []).length >= 5, true);
    assert.doesNotMatch(
        setupDialog,
        /无法连接本地 Workspace；正式数据没有改变，全部输入仍保留。/,
    );
});

test('UI-SETUP-01 activity choice supports arrow keys without relying on pointer input', () => {
    assert.match(setupDialog, /event\.key !== 'ArrowLeft'/);
    assert.match(setupDialog, /event\.key !== 'ArrowRight'/);
    assert.match(setupDialog, /activity-choice-meeting/);
    assert.match(setupDialog, /activity-choice-task/);
});

test('UI-SETUP-01 reports formal minimum completion independently of writable mode', () => {
    const projection = {
        workspaceRevision: '2',
        planEntityVersion: '2',
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
        currentTerm: {
            termId: '11111111-1111-4111-8111-111111111111',
            name: 'Fall 2026',
            startDate: '2026-09-08',
            endDate: '2026-12-18',
            timeZone: 'America/Toronto',
            archived: false,
            entityVersion: '1',
        },
        terms: [{
            termId: '11111111-1111-4111-8111-111111111111',
            name: 'Fall 2026',
            startDate: '2026-09-08',
            endDate: '2026-12-18',
            timeZone: 'America/Toronto',
            archived: false,
            entityVersion: '1',
        }],
        courses: [{
            courseId: '22222222-2222-4222-8222-222222222222',
            termId: '11111111-1111-4111-8111-111111111111',
            code: 'CSC108',
            name: 'Introduction to Computer Programming',
            section: null,
            instructor: null,
            color: null,
            credits: null,
            teachingRange: {
                kind: 'inherit-term',
                startDate: '2026-09-08',
                endDate: '2026-12-18',
            },
            archived: false,
            entityVersion: '1',
            meetings: [{
                meetingSeriesId: '33333333-3333-4333-8333-333333333333',
                type: { code: 'LEC', name: 'Lecture' },
                weekday: 'MON',
                localStart: '09:00',
                localEnd: '10:00',
                endDayOffset: 0,
                effectiveRange: {
                    kind: 'inherit-course',
                    startDate: '2026-09-08',
                    endDate: '2026-12-18',
                },
                location: { kind: 'tba' },
                entityVersion: '1',
            }],
        }],
        holidayRanges: [],
        tasks: [],
    } as const;

    /** Builds the same successful setup outcome under each supported DATA mode. */
    const outcome = (dataMode: 'ready' | 'read-only'): WorkspaceSetupOutcome => ({
        ok: true,
        value: {
            kind: 'workspace.setup-projection',
            protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
            appBuildId: 'test-build',
            requestId: 'setup-query',
            workspaceEpoch: 'workspace-epoch',
            dataMode,
            projection,
        },
    });

    assert.equal(setupStateFrom(outcome('ready')).kind, 'complete');
    assert.equal(setupStateFrom(outcome('read-only')).kind, 'complete');
});
