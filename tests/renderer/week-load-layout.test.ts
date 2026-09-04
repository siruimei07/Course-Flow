/**
 * @file Pins the week-load peak chip inside its column in a real browser. The chip is a nowrap
 * label centred in one of seven equal grid tracks, so whether it fits is a layout result: the
 * label, the token font size, the chip padding and the width the card leaves each track decide it
 * together, and none of that is a fact a text assertion can reach. The six other chips are empty
 * and hidden, which is why an overlap check between siblings never saw the overflow.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { WorkspaceShell } from '../../src/renderer/App';
import type { TaskActionPresentation } from '../../src/renderer/workspace-pages';
import type {
    CourseProjection,
    MeetingOccurrenceProjection,
} from '../../src/shared/workspace-course-contract';
import { buildPlanProjection, type PlanProjection } from '../../src/shared/workspace-plan-contract';
import type { SetupProjection, TermProjection } from '../../src/shared/workspace-term-contract';
import { evaluateAtWidths, skipWithoutBrowser } from './headless-chrome.fixture';
import { readRendererStyles } from './renderer-styles.fixture';

const noop = (): void => {};

const TERM: TermProjection = {
    termId: '11111111-1111-4111-8111-111111111111',
    name: 'Fall 2026',
    startDate: '2026-09-07',
    endDate: '2026-12-18',
    timeZone: 'America/Toronto',
    archived: false,
    entityVersion: '1',
};

/** One series per slot so each occurrence below has a series of its own to point at. */
const SERIES = {
    wednesdayLecture: '33333333-3333-4333-8333-333333333331',
    wednesdayTutorial: '33333333-3333-4333-8333-333333333332',
    wednesdayPractical: '33333333-3333-4333-8333-333333333333',
    thursdayLecture: '33333333-3333-4333-8333-333333333334',
};

function series(
    meetingSeriesId: string,
    weekday: 'WED' | 'THU',
    localStart: string,
    localEnd: string,
    code: 'LEC' | 'TUT' | 'PRA',
): CourseProjection['meetings'][number] {
    return {
        meetingSeriesId,
        type: { code, name: ({ LEC: 'Lecture', TUT: 'Tutorial', PRA: 'Practical' } as const)[code] },
        weekday,
        localStart,
        localEnd,
        endDayOffset: 0,
        effectiveRange: { kind: 'inherit-course', startDate: TERM.startDate, endDate: TERM.endDate },
        location: { kind: 'known', value: 'BA 1170' },
        entityVersion: '1',
    };
}

const COURSE: CourseProjection = {
    courseId: '22222222-2222-4222-8222-222222222222',
    termId: TERM.termId,
    code: 'CSC108',
    name: 'Introduction to Computer Programming',
    section: 'L0101',
    instructor: 'Ada Lovelace',
    color: 'blue',
    credits: '0.5',
    teachingRange: { kind: 'inherit-term', startDate: TERM.startDate, endDate: TERM.endDate },
    archived: false,
    entityVersion: '1',
    meetings: [
        series(SERIES.wednesdayLecture, 'WED', '09:00', '10:00', 'LEC'),
        series(SERIES.wednesdayTutorial, 'WED', '11:00', '12:00', 'TUT'),
        series(SERIES.wednesdayPractical, 'WED', '14:00', '15:00', 'PRA'),
        series(SERIES.thursdayLecture, 'THU', '13:00', '14:00', 'LEC'),
    ],
};

/** September dates in Toronto are UTC-4, so a local hour is that hour plus four in the instant. */
function occurrence(
    meetingSeriesId: string,
    date: string,
    weekday: 'WED' | 'THU',
    localStart: string,
    localEnd: string,
    type: 'LEC' | 'TUT' | 'PRA',
): MeetingOccurrenceProjection {
    const instant = (time: string): string => {
        const hour = Number(time.slice(0, 2)) + 4;
        return `${date}T${String(hour).padStart(2, '0')}:${time.slice(3)}:00.000Z`;
    };
    return {
        occurrenceId: { meetingSeriesId, originalLogicalAnchor: date },
        segmentId: '55555555-5555-4555-8555-555555555555',
        date,
        status: 'scheduled',
        overrideKind: null,
        type,
        weekday,
        localStart,
        localEnd,
        endDayOffset: 0,
        startInstant: instant(localStart),
        endInstant: instant(localEnd),
        location: { kind: 'known', value: 'BA 1170' },
    };
}

/**
 * Wednesday carries three whole hours and is the week's peak, so the chip reads 3 小时: a label
 * with no decimal point, which is the width the shipped padding was sized for.
 */
const MEETINGS: readonly MeetingOccurrenceProjection[] = [
    occurrence(SERIES.wednesdayLecture, '2026-09-09', 'WED', '09:00', '10:00', 'LEC'),
    occurrence(SERIES.wednesdayTutorial, '2026-09-09', 'WED', '11:00', '12:00', 'TUT'),
    occurrence(SERIES.wednesdayPractical, '2026-09-09', 'WED', '14:00', '15:00', 'PRA'),
    occurrence(SERIES.thursdayLecture, '2026-09-10', 'THU', '13:00', '14:00', 'LEC'),
];

const setup: SetupProjection = {
    workspaceRevision: '5',
    planEntityVersion: '3',
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
    courses: [COURSE],
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

function plan(): PlanProjection {
    return buildPlanProjection({
        workspaceRevision: '5',
        planEntityVersion: '3',
        term: TERM,
        taskSources: [],
        meetingSources: MEETINGS.map(meeting => ({
            courseId: COURSE.courseId,
            courseCode: COURSE.code,
            occurrence: meeting,
        })),
        holidayRanges: [],
    }, {
        evaluatedAt: '2026-09-10T16:00:00.000Z',
        termZone: TERM.timeZone,
        applicableDate: '2026-09-10',
        requestedWindow: { startDate: '2026-09-07', endDate: '2026-09-13' },
    });
}

function todayPage(): string {
    const body = renderToStaticMarkup(createElement(WorkspaceShell, {
        activePage: 'today',
        dataMode: 'ready',
        setup,
        plan: plan(),
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
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>week load</title>'
        + `<style>${readRendererStyles()}</style></head><body><div id="root">${body}</div></body></html>`;
}

/** One entry per day column, and the chip against the border box of the column it sits in. */
interface WeekLoadLayout {
    readonly columns: number;
    readonly peaks: ReadonlyArray<{ readonly text: string; readonly column: number; readonly chip: number }>;
}

const MEASURE = `(() => {
    const items = [...document.querySelectorAll('.week-load > li')];
    const peaks = items.flatMap(li => {
        const chip = li.querySelector('.week-load-peak');
        return chip.textContent.trim() === '' ? [] : [{
            text: chip.textContent,
            column: li.getBoundingClientRect().width,
            chip: chip.getBoundingClientRect().width,
        }];
    });
    return { columns: items.length, peaks };
})()`;

test(
    'the week-load peak chip paints inside its column at every supported width',
    { skip: skipWithoutBrowser },
    async () => {
        const widths = [1540, 1280, 960];
        const measured = await evaluateAtWidths<WeekLoadLayout>(todayPage(), widths, MEASURE);
        for (const width of widths) {
            const layout = measured.get(width);
            assert.ok(layout !== undefined);
            assert.equal(layout.columns, 7, `${width}px: one column per day of the week`);
            assert.equal(layout.peaks.length, 1, `${width}px: exactly one day carries the value chip`);
            const [peak] = layout.peaks;
            assert.equal(peak.text, '3 小时');
            assert.ok(
                peak.chip <= peak.column,
                `${width}px: "${peak.text}" paints ${peak.chip}px wide in a ${peak.column}px column`,
            );
        }
    },
);
