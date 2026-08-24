/**
 * @file Specifies weekly Task range, HolidayRange, and time-zone behavior in DATA.
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
import { normalizeCreateCourseWithMeetingCommand } from '../../src/shared/workspace-course-contract';
import {
    normalizeCreateHolidayRangeCommand,
    normalizeDeleteHolidayRangeCommand,
} from '../../src/shared/workspace-holiday-contract';
import {
    normalizeCompleteTaskCommand,
    normalizeCreateTaskCommand,
    normalizeDeleteTaskCommand,
    normalizeUpdateTaskCommand,
    type TaskSeriesDetailProjection,
} from '../../src/shared/workspace-task-contract';
import {
    normalizeCreateTermCommand,
    normalizeUpdateTermEndDateCommand,
} from '../../src/shared/workspace-term-contract';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

/**
 * Creates an isolated DATA slots root for one weekly Task test.
 * @param {test.TestContext} t - Owning Node test context.
 * @return {string} Fresh temporary DATA slots root.
 */
function createTempDataSlots(t: test.TestContext): string {
    const dataSlotsRoot = mkdtempSync(join(tmpdir(), 'courseflow-weekly-task-'));
    t.after(() => rmSync(dataSlotsRoot, { recursive: true, force: true }));
    return dataSlotsRoot;
}

/**
 * Creates one Current Term and returns its stable identity.
 * @param {SqliteDataStore} store - Writable DATA store.
 * @param {object} dates - Inclusive Term dates and explicit TermZone.
 * @return {Promise<string>} Stable Term identity.
 */
async function createTerm(
    store: SqliteDataStore,
    dates: Readonly<{ startDate: string; endDate: string; timeZone: string }>,
): Promise<string> {
    const result = await store.commit(normalizeCreateTermCommand({
        commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        followUpId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        expectedRevision: '0',
        expectedPlanVersion: '0',
        intent: {
            kind: 'plan.create-term',
            intentSchemaVersion: 1,
            payload: { name: 'Test Term', ...dates },
        },
    }));
    assert.equal(result.ok, true);
    if (!result.ok) {
        throw new Error('Expected Current Term');
    }
    return result.value.effects[0]!.entity.id;
}

/**
 * Creates one active Course and returns its stable identity.
 * @param {SqliteDataStore} store - Writable DATA store.
 * @param {object} [teachingRange] - Explicit Course range, or omitted to inherit the Term range.
 * @return {Promise<string>} Stable Course identity.
 */
async function createCourse(
    store: SqliteDataStore,
    teachingRange?: Readonly<{ startDate: string; endDate: string }>,
): Promise<string> {
    const result = await store.commit(normalizeCreateCourseWithMeetingCommand({
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
                    teachingRange: teachingRange === undefined
                        ? { kind: 'inherit-term' }
                        : { kind: 'explicit', ...teachingRange },
                },
                meeting: {
                    type: 'LEC',
                    weekday: 'MON',
                    localStart: '09:00',
                    localEnd: '10:00',
                    endDayOffset: 0,
                    effectiveRange: { kind: 'inherit-course' },
                    location: { kind: 'tba' },
                },
            },
        },
    }));
    assert.equal(result.ok, true);
    if (!result.ok) {
        throw new Error('Expected Course');
    }
    return result.value.effects[0]!.entity.id;
}

/**
 * Reads a bounded weekly Task detail through the intended public DATA query.
 * @param {SqliteDataStore} store - DATA store holding the Task series.
 * @param {string} taskSeriesId - Stable Task series identity.
 * @param {object} requestedWindow - Inclusive physical-date projection window.
 * @return {TaskSeriesDetailProjection} Derived Task occurrence projection.
 */
function readTaskDetail(
    store: SqliteDataStore,
    taskSeriesId: string,
    requestedWindow: Readonly<{ startDate: string; endDate: string }>,
): TaskSeriesDetailProjection {
    return store.readTaskSeriesDetail(taskSeriesId, requestedWindow);
}

test('A-TASK-004/010: weekly Task includes Course boundaries and rejects out-of-range schedules', async t => {
    const dataSlotsRoot = createTempDataSlots(t);
    let store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    await createTerm(store, {
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        timeZone: 'America/Toronto',
    });
    const courseId = await createCourse(store, { startDate: '2026-09-05', endDate: '2026-09-12' });
    const weeklySchedule = {
        kind: 'weekly' as const,
        startDate: '2026-09-05',
        weekday: 'SAT' as const,
        localDeadlineTime: '23:00',
        confirmedEndDate: '2026-09-12',
        followTeachingWeek: false,
    };
    const command = normalizeCreateTaskCommand({
        commandId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        followUpId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        expectedRevision: '2',
        expectedPlanVersion: '2',
        intent: {
            kind: 'plan.create-task-series',
            intentSchemaVersion: 2,
            payload: {
                courseId,
                title: 'Weekly boundary task',
                size: 'small',
                schedule: weeklySchedule,
            },
        },
    });

    await assert.rejects(store.commit(command, {
        failpoint(point) {
            if (point === 'commit.after-facts') {
                throw new Error(point);
            }
        },
    }), /Workspace data commit failed/);
    assert.equal(store.status().revision, '2');
    assert.equal(store.receipt(command.commandId), null);
    assert.deepEqual(store.readSetupProjection().tasks, []);

    await assert.rejects(store.commit(command, {
        failpoint(point) {
            if (point === 'commit.after-sqlite-commit') {
                throw new Error(point);
            }
        },
    }), /receipt recovery/);
    await store.close();
    const recovered = openWorkspaceData(dataSlotsRoot);
    assert.equal(recovered.kind, 'ready');
    if (recovered.kind !== 'ready') {
        throw new Error('Expected weekly Task receipt recovery');
    }
    store = recovered.store;
    const receipt = store.receipt(command.commandId);
    if (receipt === null) {
        throw new Error('Expected committed weekly Task receipt');
    }
    const created = { ok: true, value: receipt } as const;
    const taskSeriesId = receipt.effects[0]!.entity.id;
    const detail = readTaskDetail(store, taskSeriesId, {
        startDate: '2026-09-01',
        endDate: '2026-09-30',
    });
    assert.deepEqual(detail.occurrences.map(occurrence => occurrence.occurrenceId.originalLogicalAnchor), [
        '2026-09-05',
        '2026-09-12',
    ]);
    assert.deepEqual(await store.commit(command), created);

    for (const schedule of [
        { ...weeklySchedule, startDate: '2026-09-04' },
        { ...weeklySchedule, confirmedEndDate: '2026-09-13' },
    ]) {
        await assert.rejects(store.commit(normalizeCreateTaskCommand({
            ...command,
            commandId: schedule.startDate === '2026-09-04'
                ? '12121212-1212-4212-8212-121212121212'
                : '13131313-1313-4313-8313-131313131313',
            followUpId: schedule.startDate === '2026-09-04'
                ? '14141414-1414-4414-8414-141414141414'
                : '15151515-1515-4515-8515-151515151515',
            expectedRevision: '3',
            expectedPlanVersion: '3',
            intent: {
                ...command.intent,
                payload: { ...command.intent.payload, schedule },
            },
        })), /Weekly Task range must produce an occurrence inside the Course range/);
    }
    assert.equal(store.status().revision, '3');
    assert.equal(store.receipt('12121212-1212-4212-8212-121212121212'), null);
    assert.equal(store.receipt('13131313-1313-4313-8313-131313131313'), null);
    const updated = await store.commit(normalizeUpdateTaskCommand({
        commandId: '30303030-3030-4030-8030-303030303030',
        followUpId: '31313131-3131-4131-8131-313131313131',
        expectedRevision: '3',
        expectedPlanVersion: '3',
        expectedTaskSeriesVersion: '1',
        intent: {
            kind: 'plan.update-task-series',
            intentSchemaVersion: 2,
            payload: {
                taskSeriesId,
                courseId,
                title: 'Updated weekly boundary task',
                size: 'large',
                schedule: {
                    ...weeklySchedule,
                    localDeadlineTime: '22:00',
                    followTeachingWeek: true,
                },
            },
        },
    }));
    assert.equal(updated.ok, true);
    const updatedDetail = readTaskDetail(store, taskSeriesId, {
        startDate: '2026-09-01',
        endDate: '2026-09-30',
    });
    assert.equal(updatedDetail.title, 'Updated weekly boundary task');
    assert.equal(updatedDetail.size, 'large');
    assert.deepEqual(updatedDetail.schedule, {
        ...weeklySchedule,
        localDeadlineTime: '22:00',
        followTeachingWeek: true,
    });
    assert.deepEqual(
        updatedDetail.occurrences.map(occurrence => occurrence.occurrenceId),
        detail.occurrences.map(occurrence => occurrence.occurrenceId),
    );
    const nonmatchingBoundary = await store.commit(normalizeCreateTaskCommand({
        commandId: '32323232-3232-4232-8232-323232323232',
        followUpId: '33333333-3333-4333-8333-333333333333',
        expectedRevision: '4',
        expectedPlanVersion: '4',
        intent: {
            kind: 'plan.create-task-series',
            intentSchemaVersion: 2,
            payload: {
                courseId,
                title: 'Mid-range weekly Task',
                size: 'small',
                schedule: {
                    kind: 'weekly',
                    startDate: '2026-09-06',
                    weekday: 'WED',
                    localDeadlineTime: '12:00',
                    confirmedEndDate: '2026-09-11',
                    followTeachingWeek: false,
                },
            },
        },
    }));
    assert.equal(nonmatchingBoundary.ok, true);
    if (!nonmatchingBoundary.ok) {
        throw new Error('Expected weekly Task with nonmatching boundary dates');
    }
    assert.deepEqual(readTaskDetail(
        store,
        nonmatchingBoundary.value.effects[0]!.entity.id,
        { startDate: '2026-09-01', endDate: '2026-09-30' },
    ).occurrences.map(occurrence => occurrence.occurrenceId.originalLogicalAnchor), [
        '2026-09-09',
    ]);
    assert.equal(store.status().revision, '5');
    await store.close();
});

test('A-TASK-004/010: a weekly Task cannot backfill an unrepresentable year-9999 weekday', async t => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    await createTerm(store, {
        startDate: '9999-12-31',
        endDate: '9999-12-31',
        timeZone: 'America/Toronto',
    });
    const courseId = await createCourse(store, { startDate: '9999-12-31', endDate: '9999-12-31' });

    await assert.rejects(store.commit(normalizeCreateTaskCommand({
        commandId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        followUpId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        expectedRevision: '2',
        expectedPlanVersion: '2',
        intent: {
            kind: 'plan.create-task-series',
            intentSchemaVersion: 2,
            payload: {
                courseId,
                title: 'Unrepresentable Saturday task',
                size: 'small',
                schedule: {
                    kind: 'weekly',
                    startDate: '9999-12-31',
                    weekday: 'SAT',
                    localDeadlineTime: '23:00',
                    confirmedEndDate: '9999-12-31',
                    followTeachingWeek: false,
                },
            },
        },
    })), /Weekly Task range must produce an occurrence inside the Course range/);
    await assert.rejects(store.commit(normalizeCreateTaskCommand({
        commandId: '32323232-3232-4232-8232-323232323232',
        followUpId: '33333333-3333-4333-8333-333333333333',
        expectedRevision: '2',
        expectedPlanVersion: '2',
        intent: {
            kind: 'plan.create-task-series',
            intentSchemaVersion: 2,
            payload: {
                courseId,
                title: 'Unrepresentable Instant task',
                size: 'small',
                schedule: {
                    kind: 'weekly',
                    startDate: '9999-12-31',
                    weekday: 'FRI',
                    localDeadlineTime: '23:00',
                    confirmedEndDate: '9999-12-31',
                    followTeachingWeek: false,
                },
            },
        },
    })), /Weekly Task deadline must resolve to canonical Instants/);
    assert.equal(store.status().revision, '2');
    assert.deepEqual(store.readSetupProjection().tasks, []);
    await store.close();
});

test('A-TASK-010: shortening a Term cannot strand a weekly Task outside an inherited Course', async t => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const termId = await createTerm(store, {
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        timeZone: 'America/Toronto',
    });
    const courseId = await createCourse(store);
    const created = await store.commit(normalizeCreateTaskCommand({
        commandId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        followUpId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        expectedRevision: '2',
        expectedPlanVersion: '2',
        intent: {
            kind: 'plan.create-task-series',
            intentSchemaVersion: 2,
            payload: {
                courseId,
                title: 'Weekly assignment',
                size: 'small',
                schedule: {
                    kind: 'weekly',
                    startDate: '2026-09-05',
                    weekday: 'SAT',
                    localDeadlineTime: '17:00',
                    confirmedEndDate: '2026-09-26',
                    followTeachingWeek: true,
                },
            },
        },
    }));
    assert.equal(created.ok, true);
    if (!created.ok) {
        throw new Error('Expected weekly Task');
    }
    const taskSeriesId = created.value.effects[0]!.entity.id;

    await assert.rejects(store.commit(normalizeUpdateTermEndDateCommand({
        commandId: '12121212-1212-4212-8212-121212121212',
        followUpId: '13131313-1313-4313-8313-131313131313',
        expectedRevision: '3',
        expectedPlanVersion: '3',
        expectedTermVersion: '1',
        intent: {
            kind: 'plan.update-term-end-date',
            intentSchemaVersion: 1,
            payload: { termId, endDate: '2026-09-15' },
        },
    })), /Corrected Term range would exclude a weekly Task/);
    assert.equal(store.status().revision, '3');
    const window = { startDate: '2026-09-01', endDate: '2026-09-30' } as const;
    assert.deepEqual(readTaskDetail(store, taskSeriesId, window).occurrences.map(occurrence => (
        occurrence.occurrenceId.originalLogicalAnchor
    )), ['2026-09-05', '2026-09-12', '2026-09-19', '2026-09-26']);
    const deleted = await store.commit(normalizeDeleteTaskCommand({
        commandId: '14141414-1414-4414-8414-141414141414',
        followUpId: '15151515-1515-4515-8515-151515151515',
        expectedRevision: '3',
        expectedPlanVersion: '3',
        expectedTaskSeriesVersion: '1',
        intent: {
            kind: 'plan.delete-task-series',
            intentSchemaVersion: 1,
            payload: { taskSeriesId },
        },
    }));
    assert.equal(deleted.ok, true);
    await assert.rejects(store.commit(normalizeUpdateTermEndDateCommand({
        commandId: '16161616-1616-4616-8616-161616161616',
        followUpId: '17171717-1717-4717-8717-171717171717',
        expectedRevision: '4',
        expectedPlanVersion: '4',
        expectedTermVersion: '1',
        intent: {
            kind: 'plan.update-term-end-date',
            intentSchemaVersion: 1,
            payload: { termId, endDate: '2026-09-15' },
        },
    })), /Corrected Term range would exclude a weekly Task/);
    await store.close();

    const reopened = openWorkspaceData(dataSlotsRoot);
    assert.equal(reopened.kind, 'ready');
    if (reopened.kind !== 'ready') {
        throw new Error('Expected ready DATA');
    }
    assert.equal(reopened.store.status().revision, '4');
    assert.deepEqual(reopened.store.readSetupProjection().tasks, []);
    await reopened.store.close();
});

test('A-TASK-004: whole-series edits convert pending once and weekly schedules '
    + 'without changing identity', async t => {
    const dataSlotsRoot = createTempDataSlots(t);
    let store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    await createTerm(store, {
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        timeZone: 'America/Toronto',
    });
    const courseId = await createCourse(store);
    const created = await store.commit(normalizeCreateTaskCommand({
        commandId: '34343434-3434-4434-8434-343434343434',
        followUpId: '35353535-3535-4535-8535-353535353535',
        expectedRevision: '2',
        expectedPlanVersion: '2',
        intent: {
            kind: 'plan.create-task-series',
            intentSchemaVersion: 1,
            payload: {
                courseId,
                title: 'Assignment',
                size: 'small',
                deadline: { kind: 'date-only', date: '2026-09-12' },
            },
        },
    }));
    assert.equal(created.ok, true);
    if (!created.ok) {
        throw new Error('Expected once Task');
    }
    const taskSeriesId = created.value.effects[0]!.entity.id;

    const weekly = await store.commit(normalizeUpdateTaskCommand({
        commandId: '36363636-3636-4636-8636-363636363636',
        followUpId: '37373737-3737-4737-8737-373737373737',
        expectedRevision: '3',
        expectedPlanVersion: '3',
        expectedTaskSeriesVersion: '1',
        intent: {
            kind: 'plan.update-task-series',
            intentSchemaVersion: 2,
            payload: {
                taskSeriesId,
                courseId,
                title: 'Weekly assignment',
                size: 'small',
                schedule: {
                    kind: 'weekly',
                    startDate: '2026-09-05',
                    weekday: 'SAT',
                    localDeadlineTime: '17:00',
                    confirmedEndDate: '2026-09-26',
                    followTeachingWeek: true,
                },
            },
        },
    }));
    assert.equal(weekly.ok, true);
    const window = { startDate: '2026-09-01', endDate: '2026-09-30' } as const;
    const weeklyDetail = readTaskDetail(store, taskSeriesId, window);
    assert.equal(weeklyDetail.schedule.kind, 'weekly');
    assert.deepEqual(weeklyDetail.occurrences.map(occurrence => (
        occurrence.occurrenceId.originalLogicalAnchor
    )), ['2026-09-05', '2026-09-12', '2026-09-19', '2026-09-26']);

    const once = await store.commit(normalizeUpdateTaskCommand({
        commandId: '38383838-3838-4838-8838-383838383838',
        followUpId: '39393939-3939-4939-8939-393939393939',
        expectedRevision: '4',
        expectedPlanVersion: '4',
        expectedTaskSeriesVersion: '2',
        intent: {
            kind: 'plan.update-task-series',
            intentSchemaVersion: 2,
            payload: {
                taskSeriesId,
                courseId,
                title: 'Final assignment',
                size: 'large',
                schedule: {
                    kind: 'once',
                    deadline: { kind: 'date-only', date: '2026-09-26' },
                },
            },
        },
    }));
    assert.equal(once.ok, true);
    assert.deepEqual(readTaskDetail(store, taskSeriesId, window).occurrences[0]?.occurrenceId, {
        taskSeriesId,
        originalLogicalAnchor: 'once',
    });
    await store.close();

    const reopened = openWorkspaceData(dataSlotsRoot);
    assert.equal(reopened.kind, 'ready');
    if (reopened.kind !== 'ready') {
        throw new Error('Expected ready DATA');
    }
    store = reopened.store;
    assert.equal(readTaskDetail(store, taskSeriesId, window).schedule.kind, 'once');
    const completed = await store.commit(normalizeCompleteTaskCommand({
        commandId: '40404040-4040-4040-8040-404040404040',
        followUpId: '41414141-4141-4141-8141-414141414141',
        expectedRevision: '5',
        expectedPlanVersion: '5',
        expectedTaskSeriesVersion: '3',
        intent: {
            kind: 'plan.set-task-occurrence-status',
            intentSchemaVersion: 1,
            payload: { taskSeriesId, originalLogicalAnchor: 'once', status: 'completed' },
        },
    }));
    assert.equal(completed.ok, true);
    await assert.rejects(store.commit(normalizeUpdateTaskCommand({
        commandId: '42424242-4242-4242-8242-424242424242',
        followUpId: '43434343-4343-4343-8343-434343434343',
        expectedRevision: '6',
        expectedPlanVersion: '6',
        expectedTaskSeriesVersion: '4',
        intent: {
            kind: 'plan.update-task-series',
            intentSchemaVersion: 2,
            payload: {
                taskSeriesId,
                courseId,
                title: 'Weekly assignment',
                size: 'large',
                schedule: {
                    kind: 'weekly',
                    startDate: '2026-09-05',
                    weekday: 'SAT',
                    localDeadlineTime: '17:00',
                    confirmedEndDate: '2026-09-26',
                    followTeachingWeek: false,
                },
            },
        },
    })), /Completed once Task cannot become weekly/);
    assert.equal(store.status().revision, '6');
    assert.equal(readTaskDetail(store, taskSeriesId, window).schedule.kind, 'once');
    await store.close();
});

test('TEST-PLAN-003: HolidayRange inclusively suppresses only followTeachingWeek weekly Tasks', async t => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const termId = await createTerm(store, {
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        timeZone: 'America/Toronto',
    });
    const courseId = await createCourse(store, { startDate: '2026-10-01', endDate: '2026-10-31' });
    const createWeekly = async (commandId: string, followUpId: string, followTeachingWeek: boolean) => {
        const result = await store.commit(normalizeCreateTaskCommand({
            commandId,
            followUpId,
            expectedRevision: store.status().revision,
            expectedPlanVersion: store.readSetupProjection().planEntityVersion,
            intent: {
                kind: 'plan.create-task-series',
                intentSchemaVersion: 2,
                payload: {
                    courseId,
                    title: followTeachingWeek ? 'Teaching-week task' : 'Calendar-week task',
                    size: 'small',
                    schedule: {
                        kind: 'weekly',
                        startDate: '2026-10-10',
                        weekday: 'SAT',
                        localDeadlineTime: '23:00',
                        confirmedEndDate: '2026-10-24',
                        followTeachingWeek,
                    },
                },
            },
        }));
        assert.equal(result.ok, true);
        if (!result.ok) {
            throw new Error('Expected weekly Task creation');
        }
        return result.value.effects[0]!.entity.id;
    };
    const followingSeriesId = await createWeekly(
        '16161616-1616-4616-8616-161616161616',
        '17171717-1717-4717-8717-171717171717',
        true,
    );
    const calendarSeriesId = await createWeekly(
        '18181818-1818-4818-8818-181818181818',
        '19191919-1919-4919-8919-191919191919',
        false,
    );
    const once = await store.commit(normalizeCreateTaskCommand({
        commandId: '20202020-2020-4020-8020-202020202020',
        followUpId: '21212121-2121-4212-8212-212121212121',
        expectedRevision: store.status().revision,
        expectedPlanVersion: store.readSetupProjection().planEntityVersion,
        intent: {
            kind: 'plan.create-task-series',
            intentSchemaVersion: 1,
            payload: {
                courseId,
                title: 'One-time deadline',
                size: 'large',
                deadline: { kind: 'date-only', date: '2026-10-10' },
            },
        },
    }));
    assert.equal(once.ok, true);
    if (!once.ok) {
        throw new Error('Expected one-time Task creation');
    }
    const holiday = await store.commit(normalizeCreateHolidayRangeCommand({
        commandId: '22222222-2222-4222-8222-222222222222',
        followUpId: '23232323-2323-4232-8232-232323232323',
        expectedRevision: store.status().revision,
        expectedPlanVersion: store.readSetupProjection().planEntityVersion,
        intent: {
            kind: 'plan.create-holiday-range',
            intentSchemaVersion: 1,
            payload: {
                termId,
                name: 'Reading Week',
                startDate: '2026-10-10',
                endDate: '2026-10-17',
            },
        },
    }));
    assert.equal(holiday.ok, true);
    const window = { startDate: '2026-10-01', endDate: '2026-10-31' };
    const followingBeforeDelete = readTaskDetail(store, followingSeriesId, window).occurrences;
    assert.deepEqual(followingBeforeDelete.map(occurrence => (
        occurrence.occurrenceId.originalLogicalAnchor
    )), ['2026-10-24']);
    assert.deepEqual(
        readTaskDetail(store, calendarSeriesId, window).occurrences.map(occurrence => (
            occurrence.occurrenceId.originalLogicalAnchor
        )),
        ['2026-10-10', '2026-10-17', '2026-10-24'],
    );
    assert.deepEqual(readTaskDetail(store, once.value.effects[0]!.entity.id, window).occurrences[0]?.deadline, {
        kind: 'date-only',
        date: '2026-10-10',
    });
    if (!holiday.ok) {
        throw new Error('Expected HolidayRange creation');
    }
    const holidayRangeId = holiday.value.effects[0]!.entity.id;
    const deleted = await store.commit(normalizeDeleteHolidayRangeCommand({
        commandId: '28282828-2828-4282-8282-282828282828',
        followUpId: '29292929-2929-4292-8292-292929292929',
        expectedRevision: '6',
        expectedPlanVersion: '6',
        expectedHolidayRangeVersion: '1',
        overlapDecision: 'review',
        intent: {
            kind: 'plan.delete-holiday-range',
            intentSchemaVersion: 1,
            payload: { holidayRangeId },
        },
    }));
    assert.equal(deleted.ok, true);
    const followingAfterDelete = readTaskDetail(store, followingSeriesId, window).occurrences;
    assert.deepEqual(followingAfterDelete.map(occurrence => (
        occurrence.occurrenceId.originalLogicalAnchor
    )), ['2026-10-10', '2026-10-17', '2026-10-24']);
    assert.deepEqual(followingAfterDelete[2]?.occurrenceId, followingBeforeDelete[0]?.occurrenceId);
    await store.close();
});

test('Q-TIME-01: weekly Task detail uses TermZone DST rules with stable IDs after restart', async t => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    await createTerm(store, {
        startDate: '2026-03-01',
        endDate: '2026-11-01',
        timeZone: 'America/Toronto',
    });
    const courseId = await createCourse(store, { startDate: '2026-03-01', endDate: '2026-11-01' });
    const created = await store.commit(normalizeCreateTaskCommand({
        commandId: '24242424-2424-4242-8242-242424242424',
        followUpId: '25252525-2525-4252-8252-252525252525',
        expectedRevision: '2',
        expectedPlanVersion: '2',
        intent: {
            kind: 'plan.create-task-series',
            intentSchemaVersion: 2,
            payload: {
                courseId,
                title: 'DST task',
                size: 'small',
                schedule: {
                    kind: 'weekly',
                    startDate: '2026-03-08',
                    weekday: 'SUN',
                    localDeadlineTime: '02:30',
                    confirmedEndDate: '2026-03-08',
                    followTeachingWeek: false,
                },
            },
        },
    }));
    assert.equal(created.ok, true);
    if (!created.ok) {
        throw new Error('Expected weekly DST Task creation');
    }
    const taskSeriesId = created.value.effects[0]!.entity.id;
    const overlap = await store.commit(normalizeCreateTaskCommand({
        commandId: '26262626-2626-4262-8262-262626262626',
        followUpId: '27272727-2727-4272-8272-272727272727',
        expectedRevision: '3',
        expectedPlanVersion: '3',
        intent: {
            kind: 'plan.create-task-series',
            intentSchemaVersion: 2,
            payload: {
                courseId,
                title: 'DST overlap task',
                size: 'small',
                schedule: {
                    kind: 'weekly',
                    startDate: '2026-11-01',
                    weekday: 'SUN',
                    localDeadlineTime: '01:30',
                    confirmedEndDate: '2026-11-01',
                    followTeachingWeek: false,
                },
            },
        },
    }));
    assert.equal(overlap.ok, true);
    if (!overlap.ok) {
        throw new Error('Expected weekly DST overlap Task creation');
    }
    const overlapSeriesId = overlap.value.effects[0]!.entity.id;
    const spring = readTaskDetail(store, taskSeriesId, { startDate: '2026-03-08', endDate: '2026-03-08' });
    const fall = readTaskDetail(store, overlapSeriesId, { startDate: '2026-11-01', endDate: '2026-11-01' });
    assert.equal(spring.occurrences[0]?.deadline.kind, 'timed');
    assert.equal(
        spring.occurrences[0]?.deadline.kind === 'timed' && spring.occurrences[0].deadline.instant,
        '2026-03-08T07:30:00.000Z',
    );
    assert.equal(
        fall.occurrences[0]?.deadline.kind === 'timed' && fall.occurrences[0].deadline.instant,
        '2026-11-01T05:30:00.000Z',
    );
    const recomputed = readTaskDetail(store, taskSeriesId, { startDate: '2026-03-08', endDate: '2026-03-08' });
    assert.deepEqual(recomputed.occurrences.map(occurrence => occurrence.occurrenceId), spring.occurrences.map(
        occurrence => occurrence.occurrenceId,
    ));
    await store.close();

    const reopened = openWorkspaceData(dataSlotsRoot);
    assert.equal(reopened.kind, 'ready');
    if (reopened.kind !== 'ready') {
        throw new Error('Expected ready DATA after restart');
    }
    assert.deepEqual(
        readTaskDetail(reopened.store, taskSeriesId, { startDate: '2026-03-08', endDate: '2026-03-08' })
            .occurrences.map(occurrence => occurrence.occurrenceId),
        spring.occurrences.map(occurrence => occurrence.occurrenceId),
    );
    await reopened.store.close();

    const readOnly = openWorkspaceData(dataSlotsRoot, { readOnly: true });
    assert.equal(readOnly.kind, 'read-only');
    if (readOnly.kind !== 'read-only') {
        throw new Error('Expected read-only DATA');
    }
    assert.equal(
        readTaskDetail(readOnly.store, overlapSeriesId, { startDate: '2026-11-01', endDate: '2026-11-01' })
            .occurrences[0]?.occurrenceId.originalLogicalAnchor,
        '2026-11-01',
    );
    await readOnly.store.close();
});
