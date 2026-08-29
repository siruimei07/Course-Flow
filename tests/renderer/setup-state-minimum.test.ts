/**
 * @file Verifies setup routing from formal minimum facts without writable-mode inference.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { setupStateFrom } from '../../src/renderer/setup-state';
import { BOOTSTRAP_PROTOCOL_VERSION } from '../../src/shared/bootstrap-contract';
import type { WorkspaceSetupOutcome } from '../../src/shared/workspace-setup-contract';
import type { SetupProjection } from '../../src/shared/workspace-term-contract';

const term = {
    termId: '11111111-1111-4111-8111-111111111111',
    name: 'Fall 2026',
    startDate: '2026-09-08',
    endDate: '2026-12-18',
    timeZone: 'America/Toronto',
    archived: false,
    entityVersion: '1',
} as const;

const course = {
    courseId: '22222222-2222-4222-8222-222222222222',
    termId: term.termId,
    code: 'CSC108',
    name: 'Introduction to Computer Programming',
    section: null,
    instructor: null,
    color: null,
    credits: null,
    teachingRange: {
        kind: 'inherit-term',
        startDate: term.startDate,
        endDate: term.endDate,
    },
    archived: false,
    entityVersion: '1',
    meetings: [],
} as const;

function projection(overrides: Partial<SetupProjection> = {}): SetupProjection {
    return {
        workspaceRevision: '2',
        planEntityVersion: '2',
        minimum: {
            hasCurrentTerm: true,
            hasCurrentTermCourse: true,
            hasMeetingOrTask: false,
            isSatisfied: true,
        },
        everReachedMinimum: true,
        defaultRoute: 'today',
        draftCheckpointVersion: '0',
        draftCheckpoint: null,
        currentTerm: term,
        terms: [term],
        courses: [course],
        holidayRanges: [],
        tasks: [],
        ...overrides,
    };
}

function outcome(
    value: SetupProjection,
    dataMode: 'ready' | 'read-only' = 'ready',
): WorkspaceSetupOutcome {
    return {
        ok: true,
        value: {
            kind: 'workspace.setup-projection',
            protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
            appBuildId: 'test-build',
            requestId: 'setup-query',
            workspaceEpoch: 'workspace-epoch',
            dataMode,
            projection: value,
        },
    };
}

test('a Current Term alone completes first setup even without a Course', () => {
    const termOnly = projection({
        minimum: {
            hasCurrentTerm: true,
            hasCurrentTermCourse: false,
            hasMeetingOrTask: false,
            isSatisfied: true,
        },
        courses: [],
    });

    assert.equal(setupStateFrom(outcome(termOnly)).kind, 'complete');
});

test('no Current Term is the only state that still routes to first setup', () => {
    const withoutTerm = projection({
        minimum: {
            hasCurrentTerm: false,
            hasCurrentTermCourse: false,
            hasMeetingOrTask: false,
            isSatisfied: false,
        },
        currentTerm: null,
        terms: [],
        courses: [],
    });

    assert.equal(setupStateFrom(outcome(withoutTerm)).kind, 'term');
    // Supplemental facts never send a completed setup back to the wizard.
    assert.equal(setupStateFrom(outcome(projection())).kind, 'complete');
});

test('a current-Course Task satisfies the minimum when no Meeting exists', () => {
    const withTask = projection({
        minimum: {
            hasCurrentTerm: true,
            hasCurrentTermCourse: true,
            hasMeetingOrTask: true,
            isSatisfied: true,
        },
        tasks: [{
            taskSeriesId: '33333333-3333-4333-8333-333333333333',
            courseId: course.courseId,
            title: 'Read chapter 1',
            size: 'small',
            entityVersion: '1',
            deadline: { kind: 'tba' },
            occurrenceId: {
                taskSeriesId: '33333333-3333-4333-8333-333333333333',
                originalLogicalAnchor: 'once',
            },
            status: 'pending',
            reportedProgress: null,
            displayProgress: null,
            overrideKind: 'none',
        }],
    });

    assert.equal(setupStateFrom(outcome(withTask)).kind, 'complete');
});

test('read-only DATA still reports already committed minimum facts as complete', () => {
    const withMeeting = projection({
        minimum: {
            hasCurrentTerm: true,
            hasCurrentTermCourse: true,
            hasMeetingOrTask: true,
            isSatisfied: true,
        },
        courses: [{
            ...course,
            meetings: [{
                meetingSeriesId: '44444444-4444-4444-8444-444444444444',
                type: { code: 'LEC', name: 'Lecture' },
                weekday: 'MON',
                localStart: '09:00',
                localEnd: '10:00',
                endDayOffset: 0,
                effectiveRange: {
                    kind: 'inherit-course',
                    startDate: term.startDate,
                    endDate: term.endDate,
                },
                location: { kind: 'tba' },
                entityVersion: '1',
            }],
        }],
    });

    assert.equal(setupStateFrom(outcome(withMeeting, 'read-only')).kind, 'complete');
});
