/**
 * @file Verifies the revision-bound DATA source for unified PLAN projections.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
    initializeWorkspaceData,
    type SqliteDataStore,
} from '../../src/data/sqlite-data-store';
import { normalizeCreateCourseWithMeetingCommand } from '../../src/shared/workspace-course-contract';
import { normalizeCreateHolidayRangeCommand } from '../../src/shared/workspace-holiday-contract';
import {
    buildPlanProjection,
    createPlanEvaluationContext,
} from '../../src/shared/workspace-plan-contract';
import { normalizeCreateTaskCommand, type TaskSchedule } from '../../src/shared/workspace-task-contract';
import { normalizeCreateTermCommand } from '../../src/shared/workspace-term-contract';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

/**
 * Creates an isolated DATA slots root.
 * @param {test.TestContext} t - Owning Node test context.
 * @return {string} Fresh temporary DATA slots root.
 */
function createTempDataSlots(t: test.TestContext): string {
    const root = mkdtempSync(join(tmpdir(), 'courseflow-plan-projection-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    return root;
}

/**
 * Commits one command and returns its first stable entity identity.
 * @param {SqliteDataStore} store - Writable DATA store.
 * @param {Parameters<SqliteDataStore['commit']>[0]} command - Normalized PLAN command.
 * @return {Promise<string>} Stable created entity identity.
 */
async function commitCreatedEntity(
    store: SqliteDataStore,
    command: Parameters<SqliteDataStore['commit']>[0],
): Promise<string> {
    const result = await store.commit(command);
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) {
        throw new Error('Expected committed PLAN entity');
    }
    return result.value.effects[0]!.entity.id;
}

/**
 * Seeds one Current Term and Course with a Thursday lecture.
 * @param {SqliteDataStore} store - Writable DATA store.
 * @return {Promise<object>} Stable Term and Course identities.
 */
async function createCurrentPlan(store: SqliteDataStore): Promise<Readonly<{
    termId: string;
    courseId: string;
}>> {
    const termId = await commitCreatedEntity(store, normalizeCreateTermCommand({
        commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        followUpId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        expectedRevision: '0',
        expectedPlanVersion: '0',
        intent: {
            kind: 'plan.create-term',
            intentSchemaVersion: 1,
            payload: {
                name: 'Fall 2026',
                startDate: '2026-09-01',
                endDate: '2026-09-30',
                timeZone: 'America/Toronto',
            },
        },
    }));
    const courseId = await commitCreatedEntity(store, normalizeCreateCourseWithMeetingCommand({
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
                    code: 'CSC301',
                    name: 'Software Engineering',
                    section: null,
                    instructor: null,
                    color: null,
                    credits: null,
                    teachingRange: { kind: 'inherit-term' },
                },
                meeting: {
                    type: 'LEC',
                    weekday: 'THU',
                    localStart: '09:00',
                    localEnd: '10:00',
                    endDayOffset: 0,
                    effectiveRange: { kind: 'inherit-course' },
                    location: { kind: 'tba' },
                },
            },
        },
    }));
    return { termId, courseId };
}

/**
 * Creates one once Task at the next optimistic versions.
 * @param {SqliteDataStore} store - Writable DATA store.
 * @param {object} task - Exact test Task facts.
 * @return {Promise<string>} Stable Task series identity.
 */
async function createTask(
    store: SqliteDataStore,
    task: Readonly<{
        commandId: string;
        followUpId: string;
        courseId: string;
        title: string;
        size: 'small' | 'large';
        schedule: TaskSchedule;
        expectedRevision: string;
    }>,
): Promise<string> {
    return commitCreatedEntity(store, normalizeCreateTaskCommand({
        commandId: task.commandId,
        followUpId: task.followUpId,
        expectedRevision: task.expectedRevision,
        expectedPlanVersion: task.expectedRevision,
        intent: {
            kind: 'plan.create-task-series',
            intentSchemaVersion: 2,
            payload: {
                courseId: task.courseId,
                title: task.title,
                size: task.size,
                schedule: task.schedule,
            },
        },
    }));
}

test('TEST-WORKSPACE-001: PLAN source composes one revision and EvaluationContext', async t => {
    const root = createTempDataSlots(t);
    const store = initializeWorkspaceData(root, WORKSPACE_ID);
    const { termId, courseId } = await createCurrentPlan(store);
    const smallTaskSeriesId = await createTask(store, {
        commandId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        followUpId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        courseId,
        title: 'Submit today',
        size: 'small',
        schedule: { kind: 'once', deadline: { kind: 'date-only', date: '2026-09-10' } },
        expectedRevision: '2',
    });
    const largeTaskSeriesId = await createTask(store, {
        commandId: '12121212-1212-4212-8212-121212121212',
        followUpId: '13131313-1313-4313-8313-131313131313',
        courseId,
        title: 'Timed tomorrow',
        size: 'large',
        schedule: {
            kind: 'once',
            deadline: {
                kind: 'timed',
                instant: '2026-09-11T14:00:00.000Z',
                timeZone: 'America/Toronto',
            },
        },
        expectedRevision: '3',
    });
    const tbaTaskSeriesId = await createTask(store, {
        commandId: '14141414-1414-4414-8414-141414141414',
        followUpId: '15151515-1515-4515-8515-151515151515',
        courseId,
        title: 'Awaiting deadline',
        size: 'small',
        schedule: { kind: 'once', deadline: { kind: 'tba' } },
        expectedRevision: '4',
    });
    await commitCreatedEntity(store, normalizeCreateHolidayRangeCommand({
        commandId: '16161616-1616-4616-8616-161616161616',
        followUpId: '17171717-1717-4717-8717-171717171717',
        expectedRevision: '5',
        expectedPlanVersion: '5',
        intent: {
            kind: 'plan.create-holiday-range',
            intentSchemaVersion: 1,
            payload: {
                termId,
                name: 'Reading Day',
                startDate: '2026-09-10',
                endDate: '2026-09-10',
            },
        },
    }));

    let crossedSnapshotSeam = false;
    let queuedTask: Promise<string> | undefined;
    const source = store.readPlanProjectionSource({
        failpoint(point) {
            crossedSnapshotSeam = point === 'read.after-revision';
            queuedTask = createTask(store, {
                commandId: '18181818-1818-4818-8818-181818181818',
                followUpId: '19191919-1919-4919-8919-191919191919',
                courseId,
                title: 'Queued future task',
                size: 'small',
                schedule: { kind: 'once', deadline: { kind: 'date-only', date: '2026-09-20' } },
                expectedRevision: '6',
            });
        },
    });
    const context = createPlanEvaluationContext(
        '2026-09-10T13:30:00.000Z',
        source.term.timeZone,
    );
    const projection = buildPlanProjection(source, context);

    assert.equal(crossedSnapshotSeam, true);
    assert.equal(source.workspaceRevision, '6');
    assert.equal(source.taskSources.length, 3);
    assert.deepEqual(projection.attendance, {
        availability: 'unavailable',
        todayMeetingCountBasis: 'meeting-end-state',
    });
    assert.deepEqual(context, {
        evaluatedAt: '2026-09-10T13:30:00.000Z',
        termZone: 'America/Toronto',
        applicableDate: '2026-09-10',
        requestedWindow: { startDate: '2026-09-07', endDate: '2026-09-13' },
    });
    assert.deepEqual(projection.tasks.map(task => ({
        title: task.occurrence.title,
        classification: task.classification,
    })).sort((first, second) => first.title.localeCompare(second.title)), [
        { title: 'Awaiting deadline', classification: 'TBA' },
        { title: 'Submit today', classification: 'today' },
        { title: 'Timed tomorrow', classification: 'near-due' },
    ]);
    assert.deepEqual(projection.meetings.map(meeting => ({
        date: meeting.occurrence.date,
        classification: meeting.classification,
    })), [
        { date: '2026-09-03', classification: 'ended' },
        { date: '2026-09-10', classification: 'holiday-suppressed' },
        { date: '2026-09-17', classification: 'upcoming' },
        { date: '2026-09-24', classification: 'upcoming' },
    ]);
    assert.deepEqual(projection.today.summary, {
        completed: 0,
        pending: 1,
        contributions: {
            tasks: { completed: 0, pending: 1 },
            meetings: { completed: 0, pending: 0 },
        },
        excluded: {
            skippedTasks: 0,
            priorOverdueTasks: 0,
            tbaTasks: 1,
            cancelledMeetings: 0,
            holidaySuppressedMeetings: 1,
            missedMeetings: 0,
            unmarkedMeetings: 0,
        },
    });
    assert.equal(projection.next.small.kind, 'task');
    assert.equal(projection.next.large.kind, 'task');
    if (projection.next.small.kind === 'task' && projection.next.large.kind === 'task') {
        assert.equal(projection.next.small.task.occurrence.occurrenceId.taskSeriesId, smallTaskSeriesId);
        assert.equal(projection.next.large.task.occurrence.occurrenceId.taskSeriesId, largeTaskSeriesId);
    }
    assert.deepEqual(projection.tbaTasks.map(task => task.occurrence.occurrenceId.taskSeriesId), [
        tbaTaskSeriesId,
    ]);
    assert.deepEqual(projection.termProgress, { elapsedDays: 10, totalDays: 30, ratio: 1 / 3 });
    assert.equal(
        projection.today.tasks[0]!.occurrence,
        projection.week.tasks.find(task => (
            task.occurrence.occurrenceId.taskSeriesId === smallTaskSeriesId
        ))!.occurrence,
    );
    assert.equal(projection.week.meetings.length, 0);
    assert.deepEqual(projection.week.holidayRanges.map(range => range.name), ['Reading Day']);
    assert.ok(queuedTask);
    await queuedTask;
    const afterQueuedCommit = store.readPlanProjectionSource();
    assert.equal(afterQueuedCommit.workspaceRevision, '7');
    assert.equal(afterQueuedCommit.taskSources.length, 4);
    await store.close();
});
