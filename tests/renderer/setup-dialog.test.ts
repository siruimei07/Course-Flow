/**
 * @file Verifies the interruptible first-setup dialog structure and textual progress.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import * as setupDialogModule from '../../src/renderer/SetupDialog';
import { SetupDialog } from '../../src/renderer/SetupDialog';
import type {
    CourseDraft,
    HolidayDraft,
    MeetingDraft,
    TaskDraft,
    TermDraft,
} from '../../src/renderer/setup-draft';
import type { SetupState } from '../../src/renderer/setup-state';
import type {
    WorkspaceSetupOutcome,
    WorkspaceSetupProblem,
} from '../../src/shared/workspace-setup-contract';
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

const state: SetupState = {
    kind: 'term',
    dataMode: 'ready',
    projection: setup,
};

type SetupMutationProblemMessage = (
    problem: WorkspaceSetupProblem,
    unchangedStatement: string,
) => string;

type SetupCheckpointMatches = (
    outcome: WorkspaceSetupOutcome,
    expectedVersion: string,
    expectedCheckpoint: Readonly<{ schemaVersion: 1; opaquePayload: string }> | null,
) => boolean;

type ReconcileSetupCheckpoint = (
    outcome: WorkspaceSetupOutcome | null,
    expectedVersion: string,
    expectedCheckpoint: Readonly<{ schemaVersion: 1; opaquePayload: string }> | null,
    querySetup: () => Promise<WorkspaceSetupOutcome>,
) => Promise<WorkspaceSetupOutcome | null>;

type PendingSetupMutation = Readonly<{
    kind: 'term' | 'course' | 'meeting' | 'task' | 'holiday';
    command: Readonly<{ commandId: string }>;
}>;

type PendingSetupMutationState = Readonly<{
    pending: PendingSetupMutation | null;
}>;

type ReducePendingSetupMutation = (
    state: PendingSetupMutationState,
    event:
        | Readonly<{ kind: 'retain-unknown'; pending: PendingSetupMutation }>
        | Readonly<{ kind: 'exit-attempted' | 'branch-switch-attempted' | 'projection-advanced' }>
        | Readonly<{ kind: 'resolved' }>,
) => PendingSetupMutationState;

type RetryPendingSetupMutation = (
    pending: PendingSetupMutation,
    port: Readonly<Record<
        'createTerm' | 'createCourse' | 'createMeetingSeries' | 'createTask' | 'createHolidayRange',
        (command: Readonly<{ commandId: string }>) => Promise<WorkspaceSetupOutcome>
    >>,
) => Promise<WorkspaceSetupOutcome>;

type SetupFieldErrors = Readonly<Record<string, string>>;

type SetupSemanticFailureErrors = (
    failure:
        | Readonly<{ kind: 'term'; draft: TermDraft }>
        | Readonly<{ kind: 'course'; draft: CourseDraft }>
        | Readonly<{ kind: 'meeting'; draft: MeetingDraft }>
        | Readonly<{ kind: 'task'; draft: TaskDraft }>
        | Readonly<{ kind: 'holiday'; draft: HolidayDraft }>,
) => SetupFieldErrors;

type SetupNativeFieldErrors = (
    form: Readonly<{ elements: Readonly<{ namedItem(name: string): unknown }> }>,
    messages: Readonly<Record<string, string>>,
) => SetupFieldErrors;

type SetupFieldErrorAttributes = (
    name: string,
    errors: SetupFieldErrors,
    descriptionIds?: readonly string[],
) => Readonly<{
    'aria-describedby': string | undefined;
    'aria-invalid': true | undefined;
}>;

type FocusFirstSetupFieldError = (
    form: Readonly<{ elements: Readonly<{ namedItem(name: string): unknown }> }> | null,
    errors: SetupFieldErrors,
) => void;

type SetupChecklistStep = 'term' | 'course' | 'activity' | 'holiday';

type SetupChecklistNavigationFrom = (
    state: Exclude<SetupState, Readonly<{ kind: 'loading' }> | Readonly<{ kind: 'problem' }>>,
    activeStep: SetupChecklistStep,
    blocked: boolean,
) => Readonly<{
    previous: SetupChecklistStep | null;
    next: SetupChecklistStep | null;
}>;

/**
 * Reads a wished-for production helper without turning RED into a compile error.
 * @param {string} name Exported SetupDialog helper name.
 * @return {unknown} Runtime module member.
 */
function setupDialogHelper(name: string): unknown {
    return Reflect.get(setupDialogModule, name);
}

test('Setup normalizer failures identify the specific non-native field without changing its draft', () => {
    const candidate = setupDialogHelper('setupSemanticFailureErrors');
    assert.equal(typeof candidate, 'function');
    const semanticErrors = candidate as SetupSemanticFailureErrors;
    const termDraft: TermDraft = {
        name: '2026 秋季学期',
        startDate: '2026-09-08',
        endDate: '2026-09-01',
        timeZone: 'Not/A_Real_Zone',
    };
    const courseDraft: CourseDraft = {
        code: 'CSC108',
        name: 'Introduction to Computer Programming',
        section: '',
        instructor: '',
        color: '',
        credits: 'three',
        teachingStartDate: '2026-10-01',
        teachingEndDate: '2026-09-30',
    };
    const meetingDraft: MeetingDraft = {
        courseId: '22222222-2222-4222-8222-222222222222',
        meetingType: 'LEC',
        weekday: 'MON',
        localStart: '10:00',
        localEnd: '09:00',
        endDayOffset: 0,
        effectiveStartDate: '2026-10-01',
        effectiveEndDate: '2026-09-30',
        locationKind: 'known',
        locationValue: '   ',
    };
    const taskDraft: TaskDraft = {
        courseId: '22222222-2222-4222-8222-222222222222',
        title: '   ',
        size: 'small',
        scheduleKind: 'weekly',
        deadlineKind: 'tba',
        deadlineDate: '',
        deadlineTime: '',
        weeklyStartDate: '2026-10-01',
        weeklyWeekday: 'MON',
        weeklyDeadlineTime: '17:00',
        weeklyEndDate: '2026-09-30',
        followTeachingWeek: false,
    };
    const holidayDraft: HolidayDraft = {
        name: '   ',
        startDate: '2026-10-12',
        endDate: '2026-10-10',
    };

    assert.match(semanticErrors({ kind: 'term', draft: termDraft })['term-time-zone'] ?? '', /IANA/);
    assert.match(semanticErrors({ kind: 'term', draft: termDraft })['term-end-date'] ?? '', /开始日期/);
    assert.match(semanticErrors({ kind: 'course', draft: courseDraft })['course-credits'] ?? '', /学分/);
    assert.match(
        semanticErrors({ kind: 'course', draft: courseDraft })['course-teaching-end'] ?? '',
        /开始日期/,
    );
    assert.match(semanticErrors({ kind: 'meeting', draft: meetingDraft })['meeting-end'] ?? '', /同日/);
    assert.match(
        semanticErrors({ kind: 'meeting', draft: meetingDraft })['meeting-effective-end'] ?? '',
        /开始日期/,
    );
    assert.match(semanticErrors({ kind: 'meeting', draft: meetingDraft })['meeting-location'] ?? '', /TBA/);
    assert.match(semanticErrors({ kind: 'task', draft: taskDraft })['task-title'] ?? '', /空格/);
    assert.match(semanticErrors({ kind: 'task', draft: taskDraft })['task-weekly-end'] ?? '', /开始日期/);
    assert.match(semanticErrors({ kind: 'holiday', draft: holidayDraft })['holiday-name'] ?? '', /空格/);
    assert.match(semanticErrors({ kind: 'holiday', draft: holidayDraft })['holiday-end-date'] ?? '', /开始日期/);
    assert.deepEqual(termDraft, {
        name: '2026 秋季学期',
        startDate: '2026-09-08',
        endDate: '2026-09-01',
        timeZone: 'Not/A_Real_Zone',
    });
});

test('Setup field errors use native validity, render ARIA linkage, and focus the first invalid control', () => {
    const nativeCandidate = setupDialogHelper('setupNativeFieldErrors');
    const attributesCandidate = setupDialogHelper('setupFieldErrorAttributes');
    const focusCandidate = setupDialogHelper('focusFirstSetupFieldError');
    const fieldErrorCandidate = setupDialogHelper('SetupFieldError');
    assert.equal(typeof nativeCandidate, 'function');
    assert.equal(typeof attributesCandidate, 'function');
    assert.equal(typeof focusCandidate, 'function');
    assert.equal(typeof fieldErrorCandidate, 'function');
    const nativeErrors = nativeCandidate as SetupNativeFieldErrors;
    const fieldErrorAttributes = attributesCandidate as SetupFieldErrorAttributes;
    const focusFirstError = focusCandidate as FocusFirstSetupFieldError;
    const focusOrder: string[] = [];
    const controls = new Map<string, unknown>([
        ['term-name', {
            focus(): void {
                focusOrder.push('term-name');
            },
            validity: { valid: true },
        }],
        ['term-end-date', {
            focus(): void {
                focusOrder.push('term-end-date');
            },
            validity: { valid: false },
        }],
        ['term-time-zone', {
            focus(): void {
                focusOrder.push('term-time-zone');
            },
            validity: { valid: false },
        }],
    ]);
    const form = {
        elements: {
            namedItem(name: string): unknown {
                return controls.get(name) ?? null;
            },
        },
    };
    const errors = nativeErrors(form, {
        'term-name': '请输入学期名称。',
        'term-end-date': '结束日期不能早于开始日期。',
        'term-time-zone': '请输入有效的 IANA 时区。',
    });

    assert.deepEqual(errors, {
        'term-end-date': '结束日期不能早于开始日期。',
        'term-time-zone': '请输入有效的 IANA 时区。',
    });
    assert.deepEqual(fieldErrorAttributes('term-end-date', errors), {
        'aria-describedby': 'term-end-date-error',
        'aria-invalid': true,
    });
    assert.deepEqual(fieldErrorAttributes('term-time-zone', errors, ['term-time-zone-hint']), {
        'aria-describedby': 'term-time-zone-hint term-time-zone-error',
        'aria-invalid': true,
    });
    const html = renderToStaticMarkup(createElement(fieldErrorCandidate as never, {
        errors,
        name: 'term-end-date',
    }));
    assert.match(html, /id="term-end-date-error"/);
    assert.match(html, /class="field-error"/);
    assert.match(html, /结束日期不能早于开始日期/);

    const previousFrame = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = callback => {
        callback(0);
        return 1;
    };
    try {
        focusFirstError(form, errors);
    }
    finally {
        globalThis.requestAnimationFrame = previousFrame;
    }
    assert.deepEqual(focusOrder, ['term-end-date']);
});

test('setup is a modal checklist with an inner dark current-step layer and early Today exit', () => {
    const html = renderToStaticMarkup(createElement(SetupDialog, {
        open: true,
        state,
        onClose(): void {},
        onProjection(): void {},
    }));

    assert.match(html, /<dialog/);
    assert.match(html, /aria-modal="true"/);
    assert.doesNotMatch(html, /aria-label="窗口控件"/);
    assert.doesNotMatch(html, /aria-label="关闭窗口"/);
    assert.match(html, /完成首次设置/);
    assert.match(html, /当前学期/);
    assert.match(html, /添加课程/);
    assert.match(html, /课节或任务/);
    assert.match(html, /假期（可稍后）/);
    assert.match(html, /class="setup-progress-card"[^>]*>[\s\S]*class="setup-current-layer"/);
    assert.match(html, /保存进度并退出/);
    assert.match(html, />上一步<\/button>/);
    assert.match(html, />下一步<\/button>/);
    assert.match(html, /进入今天/);
    assert.doesNotMatch(html, /保护数据|备份|Grade|Attendance|即将推出/);
});

test('setup progress nests its real checklist inside the elevated task card over a light pad', () => {
    const html = renderToStaticMarkup(createElement(SetupDialog, {
        open: true,
        state,
        onClose(): void {},
        onProjection(): void {},
    }));
    const elevatedChecklistPattern = new RegExp([
        'class="setup-current-layer"[^>]*>',
        'class="setup-current-label"',
        '当前学期',
        'class="setup-step-list"',
        '</ol></div></div></aside>',
    ].join('[\\s\\S]*'));

    assert.match(
        html,
        /class="setup-progress-card"[^>]*>[\s\S]*设置进度[\s\S]*0%[\s\S]*class="progress-track"/,
    );
    assert.match(
        html,
        /class="setup-progress-stack"[^>]*>[\s\S]*class="setup-progress-pad"[^>]*aria-hidden="true"/,
    );
    assert.match(
        html,
        elevatedChecklistPattern,
    );
    assert.doesNotMatch(html, /当前任务/);
});

test('setup checklist navigation reaches only completed facts and the current step', () => {
    const candidate = setupDialogHelper('setupChecklistNavigationFrom');
    assert.equal(typeof candidate, 'function');
    const navigationFrom = candidate as SetupChecklistNavigationFrom;
    const currentTerm = {
        termId: '11111111-1111-4111-8111-111111111111',
        name: 'Fall 2026',
        startDate: '2026-09-08',
        endDate: '2026-12-18',
        timeZone: 'America/Toronto',
        archived: false,
        entityVersion: '1',
    } as const;
    const courseState = {
        kind: 'course',
        dataMode: 'ready',
        projection: {
            ...setup,
            minimum: {
                hasCurrentTerm: true,
                hasCurrentTermCourse: false,
                hasMeetingOrTask: false,
                isSatisfied: false,
            },
            currentTerm,
            terms: [currentTerm],
        },
    } as const satisfies SetupState;
    const activityState = {
        ...courseState,
        kind: 'activity',
        projection: {
            ...courseState.projection,
            minimum: {
                hasCurrentTerm: true,
                hasCurrentTermCourse: true,
                hasMeetingOrTask: false,
                isSatisfied: false,
            },
        },
    } as const satisfies SetupState;
    const completeState = {
        ...activityState,
        kind: 'complete',
        projection: {
            ...activityState.projection,
            minimum: {
                hasCurrentTerm: true,
                hasCurrentTermCourse: true,
                hasMeetingOrTask: true,
                isSatisfied: true,
            },
        },
    } as const satisfies SetupState;

    assert.deepEqual(navigationFrom(courseState, 'course', false), {
        previous: 'term',
        next: null,
    });
    assert.deepEqual(navigationFrom(courseState, 'term', false), {
        previous: null,
        next: 'course',
    });
    assert.deepEqual(navigationFrom(activityState, 'course', false), {
        previous: 'term',
        next: 'activity',
    });
    assert.deepEqual(navigationFrom(completeState, 'activity', false), {
        previous: 'course',
        next: 'holiday',
    });
    assert.deepEqual(navigationFrom(completeState, 'activity', true), {
        previous: null,
        next: null,
    });

    const courseHtml = renderToStaticMarkup(createElement(SetupDialog, {
        open: true,
        state: courseState,
        onClose(): void {},
        onProjection(): void {},
    }));
    assert.match(courseHtml, /<button(?![^>]*disabled)[^>]*>上一步<\/button>/);
    assert.match(courseHtml, /<button(?=[^>]*disabled)[^>]*>下一步<\/button>/);
});

test('activity setup offers the approved Meeting or Task choice without example data', () => {
    const currentTerm = {
        termId: '11111111-1111-4111-8111-111111111111',
        name: 'Fall 2026',
        startDate: '2026-09-08',
        endDate: '2026-12-18',
        timeZone: 'America/Toronto',
        archived: false,
        entityVersion: '1',
    } as const;
    const activityState: SetupState = {
        kind: 'activity',
        dataMode: 'ready',
        projection: {
            ...setup,
            workspaceRevision: '2',
            planEntityVersion: '2',
            minimum: {
                hasCurrentTerm: true,
                hasCurrentTermCourse: true,
                hasMeetingOrTask: false,
                isSatisfied: false,
            },
            currentTerm,
            terms: [currentTerm],
            holidayRanges: [{
                holidayRangeId: '44444444-4444-4444-8444-444444444444',
                termId: '55555555-5555-4555-8555-555555555555',
                name: 'Past Reading Week',
                startDate: '2026-02-16',
                endDate: '2026-02-20',
                entityVersion: '1',
            }],
            courses: [{
                courseId: '22222222-2222-4222-8222-222222222222',
                termId: currentTerm.termId,
                code: 'CSC108',
                name: 'Introduction to Computer Programming',
                section: null,
                instructor: null,
                color: null,
                credits: null,
                teachingRange: {
                    kind: 'inherit-term',
                    startDate: currentTerm.startDate,
                    endDate: currentTerm.endDate,
                },
                archived: false,
                entityVersion: '1',
                meetings: [],
            }],
        },
    };
    const html = renderToStaticMarkup(createElement(SetupDialog, {
        open: true,
        state: activityState,
        onClose(): void {},
        onProjection(): void {},
    }));

    assert.match(html, /选择添加方式/);
    assert.match(html, /aria-pressed="true"[^>]*>添加课节/);
    assert.match(html, /aria-pressed="false"[^>]*>添加任务/);
    assert.match(html, /保存课节/);
    assert.doesNotMatch(html, /示例课程|模拟数据/);

    const taskEntryHtml = renderToStaticMarkup(createElement(SetupDialog, {
        entryIntent: 'task',
        open: true,
        state: activityState,
        onClose(): void {},
        onProjection(): void {},
    }));
    assert.match(taskEntryHtml, /aria-pressed="true"[^>]*>添加任务/);
    assert.match(taskEntryHtml, /保存任务/);
    assert.doesNotMatch(taskEntryHtml, /保存课节/);
});

test('read-only setup disables editable controls as well as the submit action', () => {
    const html = renderToStaticMarkup(createElement(SetupDialog, {
        open: true,
        state: { ...state, dataMode: 'read-only' },
        onClose(): void {},
        onProjection(): void {},
    }));

    assert.match(html, /<fieldset(?=[^>]*class="form-control-group")(?=[^>]*disabled="")[^>]*>/);
    assert.match(html, /本地数据为只读/);
    assert.match(html, /只读模式；可以查看现有设置和草稿，但不能更改或丢弃。/);
    assert.match(html, />关闭</);
    assert.doesNotMatch(html, /保存进度并退出/);
    assert.doesNotMatch(html, /未提交输入会保存为本地草稿/);
});

test('a completed setup exposes an announced programmatic focus destination', () => {
    const currentTerm = {
        termId: '11111111-1111-4111-8111-111111111111',
        name: 'Fall 2026',
        startDate: '2026-09-08',
        endDate: '2026-12-18',
        timeZone: 'America/Toronto',
        archived: false,
        entityVersion: '1',
    } as const;
    const courseId = '22222222-2222-4222-8222-222222222222';
    const taskSeriesId = '33333333-3333-4333-8333-333333333333';
    const completeState: SetupState = {
        kind: 'complete',
        dataMode: 'ready',
        projection: {
            ...setup,
            workspaceRevision: '3',
            planEntityVersion: '3',
            minimum: {
                hasCurrentTerm: true,
                hasCurrentTermCourse: true,
                hasMeetingOrTask: true,
                isSatisfied: true,
            },
            everReachedMinimum: true,
            defaultRoute: 'today',
            currentTerm,
            terms: [currentTerm],
            holidayRanges: [{
                holidayRangeId: '44444444-4444-4444-8444-444444444444',
                termId: '55555555-5555-4555-8555-555555555555',
                name: 'Past Reading Week',
                startDate: '2026-02-16',
                endDate: '2026-02-20',
                entityVersion: '1',
            }],
            courses: [{
                courseId,
                termId: currentTerm.termId,
                code: 'CSC108',
                name: 'Introduction to Computer Programming',
                section: null,
                instructor: null,
                color: null,
                credits: null,
                teachingRange: {
                    kind: 'inherit-term',
                    startDate: currentTerm.startDate,
                    endDate: currentTerm.endDate,
                },
                archived: false,
                entityVersion: '1',
                meetings: [],
            }],
            tasks: [{
                taskSeriesId,
                courseId,
                title: 'Read chapter 1',
                size: 'small',
                entityVersion: '1',
                deadline: { kind: 'tba' },
                occurrenceId: { taskSeriesId, originalLogicalAnchor: 'once' },
                status: 'pending',
                reportedProgress: null,
                displayProgress: null,
                overrideKind: 'none',
            }],
        },
    };
    const html = renderToStaticMarkup(createElement(SetupDialog, {
        open: true,
        state: completeState,
        onClose(): void {},
        onProjection(): void {},
    }));

    const focusDestinationPattern = new RegExp(
        '<div(?=[^>]*aria-live="polite")(?=[^>]*aria-atomic="true")[^>]*>[\\s\\S]*?'
        + '<h2[^>]*tabindex="-1"[^>]*>你的 Today 已经可以使用</h2>',
    );
    assert.match(html, focusDestinationPattern);
    assert.match(html, /添加假期（可选）/);
    assert.match(html, /name="holiday-name"/);
    assert.match(html, /保存假期/);
    assert.match(html, /暂不添加，进入 Today/);
    assert.match(html, /继续补充/);
    assert.match(html, /添加另一门课程/);
    assert.match(html, /添加课节或任务/);
    assert.match(html, /假期<\/dt><dd>0 个/);
    assert.match(html, /当前已有 0 个假期/);
    assert.doesNotMatch(html, /当前已有 1 个假期/);

    const taskEntryHtml = renderToStaticMarkup(createElement(SetupDialog, {
        entryIntent: 'task',
        open: true,
        state: completeState,
        onClose(): void {},
        onProjection(): void {},
    }));
    assert.match(taskEntryHtml, /aria-pressed="true"[^>]*>添加任务/);
    assert.match(taskEntryHtml, /保存任务/);
    assert.doesNotMatch(taskEntryHtml, /name="holiday-name"/);
});

test('an incompatible draft does not offer a read-only discard as executable', () => {
    const html = renderToStaticMarkup(createElement(SetupDialog, {
        open: true,
        state: {
            ...state,
            dataMode: 'read-only',
            projection: {
                ...setup,
                draftCheckpointVersion: '1',
                draftCheckpoint: {
                    draftId: 'first-setup',
                    kind: 'first-setup',
                    scope: 'setup-step',
                    schemaVersion: 1,
                    updatedAt: '2026-08-24T12:00:00.000Z',
                    opaquePayload: '{}',
                },
            },
        },
        onClose(): void {},
        onProjection(): void {},
    }));

    assert.match(html, /只读模式不能丢弃这份旧草稿/);
    assert.match(
        html,
        /<button(?=[^>]*disabled="")(?=[^>]*class="secondary-action")[^>]*>丢弃旧草稿<\/button>/,
    );
    assert.doesNotMatch(html, /你可以进入 Today，或明确丢弃旧草稿/);
});

test('structured Setup mutation failures distinguish unknown from unchanged without discarding input', () => {
    const candidate = setupDialogHelper('setupMutationProblemMessage');
    assert.equal(typeof candidate, 'function');
    const problemMessage = candidate as SetupMutationProblemMessage;
    const baseProblem = {
        code: 'recovery-required',
        message: 'Workspace response was lost.',
        requestId: 'setup-request',
        appBuildId: 'test-build',
        workspaceEpoch: 'workspace-epoch',
        dataEffect: 'unknown',
    } as const satisfies WorkspaceSetupProblem;

    const unknownMessage = problemMessage(baseProblem, '正式数据没有改变。');
    const unchangedMessage = problemMessage({
        ...baseProblem,
        code: 'workspace-unavailable',
        dataEffect: 'unchanged',
    }, '正式数据没有改变。');

    assert.match(unknownMessage, /结果尚无法确认/);
    assert.match(unknownMessage, /输入.*本次请求.*仍保留/);
    assert.doesNotMatch(unknownMessage, /正式数据没有改变/);
    assert.equal(unchangedMessage, 'Workspace response was lost. 正式数据没有改变。');
});

test('a checkpoint query reconciles only unknown exact saved or discarded draft state', async () => {
    const candidate = setupDialogHelper('setupCheckpointMatches');
    const reconcileCandidate = setupDialogHelper('reconcileSetupCheckpoint');
    assert.equal(typeof candidate, 'function');
    assert.equal(typeof reconcileCandidate, 'function');
    const checkpointMatches = candidate as SetupCheckpointMatches;
    const reconcileCheckpoint = reconcileCandidate as ReconcileSetupCheckpoint;
    const opaquePayload = '{"schemaVersion":1,"step":"term"}';
    const savedOutcome: WorkspaceSetupOutcome = {
        ok: true,
        value: {
            kind: 'workspace.setup-projection',
            protocolVersion: 3,
            appBuildId: 'test-build',
            requestId: 'setup-query',
            workspaceEpoch: 'workspace-epoch',
            dataMode: 'ready',
            projection: {
                ...setup,
                draftCheckpointVersion: '1',
                draftCheckpoint: {
                    draftId: 'first-setup',
                    kind: 'first-setup',
                    scope: 'setup-step',
                    schemaVersion: 1,
                    updatedAt: '2026-08-24T12:00:00.000Z',
                    opaquePayload,
                },
            },
        },
    };
    const staleOutcome: WorkspaceSetupOutcome = {
        ...savedOutcome,
        value: {
            ...savedOutcome.value,
            projection: setup,
        },
    };
    const discardedOutcome: WorkspaceSetupOutcome = {
        ...savedOutcome,
        value: {
            ...savedOutcome.value,
            projection: {
                ...setup,
                draftCheckpointVersion: '2',
                draftCheckpoint: null,
            },
        },
    };

    assert.equal(checkpointMatches(savedOutcome, '0', { schemaVersion: 1, opaquePayload }), true);
    assert.equal(checkpointMatches(staleOutcome, '0', { schemaVersion: 1, opaquePayload }), false);
    assert.equal(checkpointMatches(discardedOutcome, '1', null), true);

    const unknownOutcome: WorkspaceSetupOutcome = {
        ok: false,
        problem: {
            code: 'recovery-required',
            message: 'Workspace response was lost.',
            requestId: 'save-draft',
            appBuildId: 'test-build',
            workspaceEpoch: 'workspace-epoch',
            dataEffect: 'unknown',
        },
    };
    let queryCount = 0;
    const reconciled = await reconcileCheckpoint(
        unknownOutcome,
        '0',
        { schemaVersion: 1, opaquePayload },
        () => {
            queryCount += 1;
            return Promise.resolve(savedOutcome);
        },
    );
    const unchangedOutcome: WorkspaceSetupOutcome = {
        ok: false,
        problem: {
            ...unknownOutcome.problem,
            code: 'workspace-unavailable',
            dataEffect: 'unchanged',
        },
    };
    const unchanged = await reconcileCheckpoint(
        unchangedOutcome,
        '0',
        { schemaVersion: 1, opaquePayload },
        () => {
            queryCount += 1;
            return Promise.resolve(savedOutcome);
        },
    );
    const conflictOutcome: WorkspaceSetupOutcome = {
        ok: false,
        problem: {
            ...unknownOutcome.problem,
            code: 'conflict',
            dataEffect: 'unchanged',
        },
    };
    const conflictReconciled = await reconcileCheckpoint(
        conflictOutcome,
        '0',
        { schemaVersion: 1, opaquePayload },
        () => {
            queryCount += 1;
            return Promise.resolve(savedOutcome);
        },
    );

    assert.equal(reconciled, savedOutcome);
    assert.equal(unchanged, null);
    assert.equal(conflictReconciled, savedOutcome);
    assert.equal(queryCount, 2);
});

test('unknown supplemental Task survives exit, branch, and projection boundaries until resolved', () => {
    const candidate = setupDialogHelper('reducePendingSetupMutation');
    assert.equal(typeof candidate, 'function');
    const reducePending = candidate as ReducePendingSetupMutation;
    const pending = Object.freeze({
        kind: 'task' as const,
        command: Object.freeze({ commandId: '77777777-7777-4777-8777-777777777777' }),
    });
    let lifecycle = reducePending({ pending: null }, { kind: 'retain-unknown', pending });

    lifecycle = reducePending(lifecycle, { kind: 'exit-attempted' });
    assert.equal(lifecycle.pending, pending);
    lifecycle = reducePending(lifecycle, { kind: 'branch-switch-attempted' });
    assert.equal(lifecycle.pending, pending);
    lifecycle = reducePending(lifecycle, { kind: 'projection-advanced' });
    assert.equal(lifecycle.pending, pending);

    lifecycle = reducePending(lifecycle, { kind: 'resolved' });
    assert.equal(lifecycle.pending, null);
});

test('unknown Setup retry sends the exact retained command for every creation form', async () => {
    const candidate = setupDialogHelper('retryPendingSetupMutation');
    assert.equal(typeof candidate, 'function');
    const retryPending = candidate as RetryPendingSetupMutation;
    const calls: Array<Readonly<{ kind: PendingSetupMutation['kind']; command: unknown }>> = [];
    const outcome: WorkspaceSetupOutcome = {
        ok: false,
        problem: {
            code: 'recovery-required',
            message: 'Workspace response was lost.',
            requestId: 'setup-retry',
            appBuildId: 'test-build',
            workspaceEpoch: 'workspace-epoch',
            dataEffect: 'unknown',
        },
    };
    const port = {
        createTerm(command: Readonly<{ commandId: string }>) {
            calls.push({ kind: 'term', command });
            return Promise.resolve(outcome);
        },
        createCourse(command: Readonly<{ commandId: string }>) {
            calls.push({ kind: 'course', command });
            return Promise.resolve(outcome);
        },
        createMeetingSeries(command: Readonly<{ commandId: string }>) {
            calls.push({ kind: 'meeting', command });
            return Promise.resolve(outcome);
        },
        createTask(command: Readonly<{ commandId: string }>) {
            calls.push({ kind: 'task', command });
            return Promise.resolve(outcome);
        },
        createHolidayRange(command: Readonly<{ commandId: string }>) {
            calls.push({ kind: 'holiday', command });
            return Promise.resolve(outcome);
        },
    };
    const pendingMutations = (['term', 'course', 'meeting', 'task', 'holiday'] as const).map((kind, index) => ({
        kind,
        command: Object.freeze({ commandId: `00000000-0000-4000-8000-00000000000${index}` }),
    }));

    for (const pending of pendingMutations) {
        await retryPending(pending, port);
        const call = calls.at(-1);
        assert.equal(call?.kind, pending.kind);
        assert.equal(call?.command, pending.command);
    }
});
