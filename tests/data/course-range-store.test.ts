/**
 * @file Verifies Course and Meeting range intent persistence and boundaries.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
    initializeWorkspaceData,
    openWorkspaceData,
    type SqliteDataStore,
} from '../../src/data/sqlite-data-store';
import {
    normalizeCreateCourseWithMeetingCommand,
    type CourseTeachingRangeIntent,
    type MeetingEffectiveRangeIntent,
} from '../../src/shared/workspace-course-contract';
import { normalizeCreateTermCommand } from '../../src/shared/workspace-term-contract';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

function createTempDataSlots(t: test.TestContext): string {
    const dataSlotsRoot = mkdtempSync(join(tmpdir(), 'courseflow-range-'));
    t.after(() => rmSync(dataSlotsRoot, { recursive: true, force: true }));
    return dataSlotsRoot;
}

async function createCurrentTerm(store: SqliteDataStore): Promise<void> {
    const result = await store.commit(normalizeCreateTermCommand({
        commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        followUpId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
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
    }));
    assert.equal(result.ok, true);
}

function makeCourseCommand(options: Readonly<{
    teachingRange?: CourseTeachingRangeIntent;
    effectiveRange?: MeetingEffectiveRangeIntent;
}> = {}) {
    return normalizeCreateCourseWithMeetingCommand({
        commandId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        followUpId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        overlapDecision: 'review',
        expectedRevision: '1',
        expectedPlanVersion: '1',
        intent: {
            kind: 'plan.create-course-with-first-meeting',
            intentSchemaVersion: 3,
            payload: {
                course: {
                    code: 'CSC108',
                    name: 'Introduction to Computer Programming',
                    section: 'LEC0101',
                    instructor: 'Ada Lovelace',
                    color: 'blue',
                    credits: '3',
                    teachingRange: options.teachingRange ?? { kind: 'inherit-term' },
                },
                meeting: {
                    type: 'LEC',
                    weekday: 'MON',
                    localStart: '09:00',
                    localEnd: '10:00',
                    endDayOffset: 0,
                    effectiveRange: options.effectiveRange ?? { kind: 'inherit-course' },
                    location: { kind: 'known', value: 'BA 1170' },
                },
            },
        },
    });
}

test('A-COURSE-007/TEST-PLAN-001: Course inherits Term and Meeting inherits Course at exact boundaries', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    await createCurrentTerm(store);

    const result = await store.commit(makeCourseCommand());

    assert.equal(result.ok, true);
    const course = store.readSetupProjection().courses[0];
    assert.deepEqual(course?.teachingRange, {
        kind: 'inherit-term',
        startDate: '2026-09-08',
        endDate: '2026-12-18',
    });
    assert.deepEqual(course?.meetings[0]?.effectiveRange, {
        kind: 'inherit-course',
        startDate: '2026-09-08',
        endDate: '2026-12-18',
    });
    await store.close();
});

test('A-COURSE-007/TEST-PLAN-002/Q-CONTINUITY-01: legal shorter ranges survive reopen'
    + ' with stable identity', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    await createCurrentTerm(store);
    const committed = await store.commit(makeCourseCommand({
        teachingRange: {
            kind: 'explicit',
            startDate: '2026-09-15',
            endDate: '2026-12-10',
        },
        effectiveRange: {
            kind: 'explicit',
            startDate: '2026-09-16',
            endDate: '2026-12-09',
        },
    }));
    assert.equal(committed.ok, true);
    if (!committed.ok) {
        throw new Error('Expected Course and Meeting commit');
    }
    const courseId = committed.value.effects[0].entity.id;
    const meetingSeriesId = committed.value.effects[1].entity.id;
    await store.close();

    const opened = openWorkspaceData(dataSlotsRoot);
    assert.equal(opened.kind, 'ready');
    if (opened.kind !== 'ready') {
        throw new Error('Expected ready DATA after reopen');
    }
    const course = opened.store.readSetupProjection().courses[0];
    assert.equal(course?.courseId, courseId);
    assert.equal(course?.meetings[0]?.meetingSeriesId, meetingSeriesId);
    assert.deepEqual(course?.teachingRange, {
        kind: 'explicit',
        startDate: '2026-09-15',
        endDate: '2026-12-10',
    });
    assert.deepEqual(course?.meetings[0]?.effectiveRange, {
        kind: 'explicit',
        startDate: '2026-09-16',
        endDate: '2026-12-09',
    });
    await opened.store.close();
});

test('A-COURSE-007/TEST-PLAN-001: one-day Course or Meeting overflow changes no fact', async (t) => {
    const invalidRanges = [
        {
            teachingRange: {
                kind: 'explicit',
                startDate: '2026-09-07',
                endDate: '2026-12-18',
            } as const,
        },
        {
            teachingRange: {
                kind: 'explicit',
                startDate: '2026-09-08',
                endDate: '2026-12-19',
            } as const,
        },
        {
            teachingRange: {
                kind: 'explicit',
                startDate: '2026-09-15',
                endDate: '2026-12-10',
            } as const,
            effectiveRange: {
                kind: 'explicit',
                startDate: '2026-09-14',
                endDate: '2026-12-10',
            } as const,
        },
        {
            teachingRange: {
                kind: 'explicit',
                startDate: '2026-09-15',
                endDate: '2026-12-10',
            } as const,
            effectiveRange: {
                kind: 'explicit',
                startDate: '2026-09-15',
                endDate: '2026-12-11',
            } as const,
        },
    ];

    for (const [index, ranges] of invalidRanges.entries()) {
        await t.test(`overflow-${index}`, async (caseTest) => {
            const dataSlotsRoot = createTempDataSlots(caseTest);
            const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
            await createCurrentTerm(store);

            await assert.rejects(store.commit(makeCourseCommand(ranges)), TypeError);
            assert.equal(store.readSetupProjection().workspaceRevision, '1');
            assert.equal(store.readSetupProjection().courses.length, 0);
            assert.equal(store.readProtectionWatermark(), '1');
            await store.close();
        });
    }
});
