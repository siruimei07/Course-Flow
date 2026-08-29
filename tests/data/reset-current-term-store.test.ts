/**
 * @file Verifies the explicit Current Term reset and everything it must not touch.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
    initializeWorkspaceData,
    openWorkspaceData,
    type SqliteDataStore,
} from '../../src/data/sqlite-data-store';
import { normalizeAcceptedCreateCourseWithMeetingCommand } from '../../src/shared/workspace-course-contract';
import { normalizeCreateHolidayRangeCommand } from '../../src/shared/workspace-holiday-contract';
import { normalizeCreateTaskCommand } from '../../src/shared/workspace-task-contract';
import {
    normalizeCreateTermCommand,
    normalizeResetCurrentTermCommand,
} from '../../src/shared/workspace-term-contract';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const RESET_COMMAND_ID = '99999999-9999-4999-8999-999999999999';
const RESET_FOLLOW_UP_ID = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/**
 * Creates an isolated DATA slots root for one test.
 * @param {test.TestContext} t Owning Node test context.
 * @return {string} Fresh DATA slots root.
 */
function createTempDataSlots(t: test.TestContext): string {
    const dataSlotsRoot = mkdtempSync(join(tmpdir(), 'courseflow-reset-'));
    t.after(() => rmSync(dataSlotsRoot, { recursive: true, force: true }));
    return dataSlotsRoot;
}

/**
 * Commits one Current Term with a Course, MeetingSeries, Task and HolidayRange.
 * @param {SqliteDataStore} store Opened DATA store.
 * @return {Promise<string>} Stable Current Term identity.
 */
async function createPopulatedTerm(store: SqliteDataStore): Promise<string> {
    const term = await store.commit(normalizeCreateTermCommand({
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
    assert.equal(term.ok, true);
    if (!term.ok) {
        throw new Error('Expected Current Term');
    }

    const course = await store.commit(normalizeAcceptedCreateCourseWithMeetingCommand({
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
                    code: 'CSC207',
                    name: 'Software Design',
                    section: null,
                    instructor: null,
                    color: null,
                    credits: null,
                    teachingRange: { kind: 'inherit-term' },
                },
                meeting: {
                    type: 'LEC',
                    weekday: 'TUE',
                    localStart: '09:00',
                    localEnd: '11:00',
                    endDayOffset: 0,
                    effectiveRange: { kind: 'inherit-course' },
                    location: { kind: 'tba' },
                },
            },
        },
    }));
    assert.equal(course.ok, true);
    if (!course.ok) {
        throw new Error('Expected Course and MeetingSeries');
    }
    const courseId = course.value.effects[0].entity.id;

    const task = await store.commit(normalizeCreateTaskCommand({
        commandId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        followUpId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        expectedRevision: '2',
        expectedPlanVersion: '2',
        intent: {
            kind: 'plan.create-task-series',
            intentSchemaVersion: 2,
            payload: {
                courseId,
                title: 'Read chapter 1',
                size: 'small',
                schedule: { kind: 'once', deadline: { kind: 'tba' } },
            },
        },
    }));
    assert.equal(task.ok, true);

    const holiday = await store.commit(normalizeCreateHolidayRangeCommand({
        commandId: '12121212-1212-4212-8212-121212121212',
        followUpId: '13131313-1313-4313-8313-131313131313',
        expectedRevision: '3',
        expectedPlanVersion: '3',
        intent: {
            kind: 'plan.create-holiday-range',
            intentSchemaVersion: 1,
            payload: {
                termId: term.value.effects[0].entity.id,
                name: 'Reading Week',
                startDate: '2026-10-12',
                endDate: '2026-10-16',
            },
        },
    }));
    assert.equal(holiday.ok, true);
    return term.value.effects[0].entity.id;
}

/**
 * Builds a reset command for one Term at the given expected versions.
 * @param {string} termId Current Term identity.
 * @param {object} overrides Optional expected-version and confirmation overrides.
 * @return {ReturnType<typeof normalizeResetCurrentTermCommand>} Normalized command.
 */
function makeResetCommand(termId: string, overrides: Readonly<{
    expectedRevision?: string;
    expectedPlanVersion?: string;
    expectedTermVersion?: string;
    confirmedTermName?: string;
    commandId?: string;
    followUpId?: string;
}> = {}) {
    return normalizeResetCurrentTermCommand({
        commandId: overrides.commandId ?? RESET_COMMAND_ID,
        followUpId: overrides.followUpId ?? RESET_FOLLOW_UP_ID,
        expectedRevision: overrides.expectedRevision ?? '4',
        expectedPlanVersion: overrides.expectedPlanVersion ?? '4',
        expectedTermVersion: overrides.expectedTermVersion ?? '1',
        intent: {
            kind: 'plan.reset-current-term',
            intentSchemaVersion: 1,
            payload: {
                termId,
                confirmedTermName: overrides.confirmedTermName ?? 'Fall 2026',
            },
        },
    });
}

/**
 * Counts every plan row that a reset must remove.
 * @param {string} dataSlotsRoot DATA slots root.
 * @return {Record<string, number>} Row counts by table.
 */
function planRowCounts(dataSlotsRoot: string): Record<string, number> {
    const database = new DatabaseSync(join(dataSlotsRoot, 'active', 'workspace.sqlite'), {
        readOnly: true,
    });
    try {
        const counts: Record<string, number> = {};
        for (const table of [
            'terms',
            'courses',
            'meeting_series',
            'meeting_segments',
            'task_series',
            'task_segments',
            'holiday_ranges',
            'command_receipts',
        ]) {
            counts[table] = (database.prepare(
                `SELECT count(*) AS count FROM ${table}`,
            ).get() as { count: number }).count;
        }
        return counts;
    }
    finally {
        database.close();
    }
}

test('A-TERM-002: an explicit reset deletes the Current Term and every fact it owns', async t => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const termId = await createPopulatedTerm(store);

    const before = planRowCounts(dataSlotsRoot);
    assert.deepEqual(
        [before.terms, before.courses, before.meeting_series, before.task_series, before.holiday_ranges],
        [1, 1, 1, 1, 1],
    );
    assert.ok(before.meeting_segments > 0);
    assert.ok(before.task_segments >= 0);

    const reset = await store.commit(makeResetCommand(termId));
    assert.equal(reset.ok, true);
    if (!reset.ok) {
        throw new Error('Expected a committed reset');
    }
    assert.equal(reset.value.kind, 'committed');
    assert.equal(reset.value.revision, '5');
    assert.deepEqual(reset.value.effects.map(effect => effect.code), ['plan.current-term-reset']);
    assert.equal(reset.value.effects[0].entity.kind, 'term');
    assert.equal(reset.value.effects[0].entity.id, termId);

    const projection = store.readSetupProjection();
    assert.equal(projection.currentTerm, null);
    assert.deepEqual(projection.terms, []);
    assert.deepEqual(projection.courses, []);
    assert.deepEqual(projection.tasks, []);
    assert.deepEqual(projection.holidayRanges, []);
    assert.equal(projection.minimum.isSatisfied, false);
    // The last Term is gone, so an explicit reset returns the app to first setup.
    assert.equal(projection.everReachedMinimum, false);
    assert.equal(projection.defaultRoute, 'setup');
    assert.equal(store.readProtectionWatermark(), '5');

    const after = planRowCounts(dataSlotsRoot);
    assert.deepEqual(
        [
            after.terms,
            after.courses,
            after.meeting_series,
            after.meeting_segments,
            after.task_series,
            after.task_segments,
            after.holiday_ranges,
        ],
        [0, 0, 0, 0, 0, 0, 0],
    );
    // The append-only receipt ledger is never rewritten by a domain reset.
    assert.equal(after.command_receipts, before.command_receipts + 1);
    await store.close();

    const reopened = openWorkspaceData(dataSlotsRoot);
    assert.equal(reopened.kind, 'ready');
    if (reopened.kind !== 'ready') {
        throw new Error('Expected reopened DATA');
    }
    assert.equal(reopened.store.readSetupProjection().currentTerm, null);
    await reopened.store.close();
});

test('A-TERM-002: a reset replays idempotently and refuses a mismatched confirmation', async t => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const termId = await createPopulatedTerm(store);

    await assert.rejects(
        store.commit(makeResetCommand(termId, { confirmedTermName: 'fall 2026' })),
        TypeError,
    );
    assert.notEqual(store.readSetupProjection().currentTerm, null);

    const first = await store.commit(makeResetCommand(termId));
    assert.equal(first.ok, true);
    const replay = await store.commit(makeResetCommand(termId));
    assert.equal(replay.ok, true);
    if (!first.ok || !replay.ok) {
        throw new Error('Expected both reset attempts to succeed');
    }
    assert.deepEqual(replay.value, first.value);
    assert.equal(store.readSetupProjection().currentTerm, null);
    await store.close();
});

test('A-TERM-002: a stale expected version leaves every Current Term fact unchanged', async t => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const termId = await createPopulatedTerm(store);

    const stale = await store.commit(makeResetCommand(termId, { expectedRevision: '3' }));
    assert.equal(stale.ok, false);
    if (stale.ok) {
        throw new Error('Expected a conflict');
    }
    assert.equal(stale.problem.code, 'conflict');
    assert.equal(store.readSetupProjection().currentTerm?.termId, termId);
    assert.deepEqual(planRowCounts(dataSlotsRoot).courses, 1);

    // A Term that is not the Current Term can never be reset by this command.
    await assert.rejects(
        store.commit(makeResetCommand('55555555-5555-4555-8555-555555555555', {
            commandId: '66666666-6666-4666-8666-666666666666',
            followUpId: '77777777-7777-4777-8777-777777777777',
        })),
        TypeError,
    );
    assert.equal(store.readSetupProjection().currentTerm?.termId, termId);
    await store.close();
});
