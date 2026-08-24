/**
 * @file Verifies non-blocking Meeting overlap warnings over effective occurrences.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
    initializeWorkspaceData,
    openWorkspaceData,
    type DataCommitResult,
    type SqliteDataStore,
} from '../../src/data/sqlite-data-store';
import {
    normalizeCancelMeetingOccurrenceCommand,
    normalizeChangeMeetingOccurrenceCommand,
    normalizeCreateCourseWithMeetingCommand,
    type ChangeMeetingOccurrenceCommand,
    type CreateCourseWithMeetingCommand,
    type MeetingLocation,
    type MeetingWeekday,
} from '../../src/shared/workspace-course-contract';
import type { MeetingEndDayOffset } from '../../src/shared/meeting-time';
import { normalizeCreateTermCommand } from '../../src/shared/workspace-term-contract';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const WINDOW = Object.freeze({ startDate: '2026-09-01', endDate: '2026-10-31' });

/**
 * Creates an isolated DATA root for one overlap test.
 * @param {test.TestContext} t - Node test lifecycle context.
 * @return {string} Temporary data-slots root.
 */
function createTempDataSlots(t: test.TestContext): string {
    const root = mkdtempSync(join(tmpdir(), 'courseflow-overlap-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    return root;
}

/**
 * Creates the explicit-zone Term used by one overlap scenario.
 * @param {SqliteDataStore} store - Writable DATA store.
 * @param {string} startDate - Inclusive Term start.
 * @param {string} endDate - Inclusive Term end.
 * @return {Promise<void>}
 */
async function createTerm(
    store: SqliteDataStore,
    startDate: string,
    endDate: string,
): Promise<void> {
    const result = await store.commit(normalizeCreateTermCommand({
        commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        followUpId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        expectedRevision: '0',
        expectedPlanVersion: '0',
        intent: {
            kind: 'plan.create-term',
            intentSchemaVersion: 1,
            payload: {
                name: 'Explicit-zone Term',
                startDate,
                endDate,
                timeZone: 'America/Toronto',
            },
        },
    }));
    assert.equal(result.ok, true);
}

type CourseCommandOptions = Readonly<{
    commandId: string;
    followUpId: string;
    code: string;
    expectedRevision: string;
    expectedPlanVersion: string;
    weekday: MeetingWeekday;
    localStart: string;
    localEnd: string;
    endDayOffset?: MeetingEndDayOffset;
    location?: MeetingLocation;
    overlapDecision?: 'review' | 'continue';
}>;

/**
 * Builds one current Course and first Meeting command.
 * @param {CourseCommandOptions} options - Stable identity, versions, and Meeting facts.
 * @return {CreateCourseWithMeetingCommand} Normalized current command.
 */
function makeCourseCommand(options: CourseCommandOptions): CreateCourseWithMeetingCommand {
    return normalizeCreateCourseWithMeetingCommand({
        commandId: options.commandId,
        followUpId: options.followUpId,
        overlapDecision: options.overlapDecision ?? 'review',
        expectedRevision: options.expectedRevision,
        expectedPlanVersion: options.expectedPlanVersion,
        intent: {
            kind: 'plan.create-course-with-first-meeting',
            intentSchemaVersion: 3,
            payload: {
                course: {
                    code: options.code,
                    name: `${options.code} Course`,
                    section: null,
                    instructor: null,
                    color: null,
                    credits: null,
                    teachingRange: { kind: 'inherit-term' },
                },
                meeting: {
                    type: options.code === 'CSC108' ? 'LEC' : 'TUT',
                    weekday: options.weekday,
                    localStart: options.localStart,
                    localEnd: options.localEnd,
                    endDayOffset: options.endDayOffset ?? 0,
                    effectiveRange: { kind: 'inherit-course' },
                    location: options.location ?? { kind: 'known', value: 'Room 101' },
                },
            },
        },
    });
}

/**
 * Requires a successful Course commit and returns its MeetingSeriesId.
 * @param {SqliteDataStore} store - Writable DATA store.
 * @param {CreateCourseWithMeetingCommand} command - Current creation command.
 * @return {Promise<string>} Stable stored MeetingSeriesId.
 */
async function createCourse(
    store: SqliteDataStore,
    command: CreateCourseWithMeetingCommand,
): Promise<string> {
    const result = await store.commit(command);
    assert.equal(result.ok, true);
    if (!result.ok) {
        throw new Error('Expected Course creation to commit');
    }
    return result.value.effects[1]!.entity.id;
}

/**
 * Requires the non-blocking overlap decision shape.
 * @param {DataCommitResult} result - Candidate DATA commit result.
 * @return {Extract<DataCommitResult, {ok: false}>} Overlap decision result.
 */
function requireOverlapDecision(result: DataCommitResult): Extract<DataCommitResult, { ok: false }> {
    assert.equal(result.ok, false);
    if (result.ok) {
        throw new Error('Expected Meeting overlap decision');
    }
    assert.equal(result.problem.code, 'decision-required');
    assert.deepEqual(result.problem.allowedActions, ['continue']);
    assert.equal(result.problem.details.reason, 'meeting-time-overlap');
    if (result.problem.details.reason !== 'meeting-time-overlap') {
        throw new Error('Expected Meeting overlap warning details');
    }
    assert.ok(result.problem.details.warnings.length > 0);
    return result;
}

/**
 * Seeds two non-overlapping series for override, cancellation, and segment tests.
 * @param {SqliteDataStore} store - Empty writable DATA store.
 * @return {Promise<Readonly<{first: string; second: string}>>} Stable series identities.
 */
async function seedTwoSeries(
    store: SqliteDataStore,
): Promise<Readonly<{ first: string; second: string }>> {
    await createTerm(store, WINDOW.startDate, WINDOW.endDate);
    const first = await createCourse(store, makeCourseCommand({
        commandId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        followUpId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        code: 'CSC108',
        expectedRevision: '1',
        expectedPlanVersion: '1',
        weekday: 'MON',
        localStart: '09:00',
        localEnd: '10:00',
    }));
    const second = await createCourse(store, makeCourseCommand({
        commandId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        followUpId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        code: 'MAT137',
        expectedRevision: '2',
        expectedPlanVersion: '2',
        weekday: 'TUE',
        localStart: '11:00',
        localEnd: '12:00',
        location: { kind: 'tba' },
    }));
    return Object.freeze({ first, second });
}

/**
 * Builds a current only-this or future Meeting replacement command.
 * @param {object} options - Identity, versions, scope, and optional impact confirmation.
 * @return {ChangeMeetingOccurrenceCommand} Normalized replacement command.
 */
function makeChangeCommand(options: Readonly<{
    commandId: string;
    followUpId: string;
    meetingSeriesId: string;
    originalLogicalAnchor: string;
    scope: 'only-this' | 'this-and-future';
    expectedRevision: string;
    expectedPlanVersion: string;
    expectedMeetingSeriesVersion: string;
    weekday: MeetingWeekday;
    localStart: string;
    localEnd: string;
    overlapDecision?: 'review' | 'continue';
    confirmationToken?: string | null;
    impactWindow?: Readonly<{ startDate: string; endDate: string }> | null;
}>): ChangeMeetingOccurrenceCommand {
    return normalizeChangeMeetingOccurrenceCommand({
        commandId: options.commandId,
        followUpId: options.followUpId,
        confirmationToken: options.confirmationToken ?? null,
        impactWindow: options.impactWindow ?? null,
        overlapDecision: options.overlapDecision ?? 'review',
        expectedRevision: options.expectedRevision,
        expectedPlanVersion: options.expectedPlanVersion,
        expectedMeetingSeriesVersion: options.expectedMeetingSeriesVersion,
        intent: {
            kind: 'plan.change-meeting-occurrence',
            intentSchemaVersion: 2,
            payload: {
                meetingSeriesId: options.meetingSeriesId,
                originalLogicalAnchor: options.originalLogicalAnchor,
                scope: options.scope,
                replacement: {
                    type: 'TUT',
                    weekday: options.weekday,
                    localStart: options.localStart,
                    localEnd: options.localEnd,
                    endDayOffset: 0,
                    location: { kind: 'tba' },
                },
            },
        },
    });
}

test('A-COURSE-006/Q-STATE-01: warning is unchanged and explicit continue preserves both Meetings', async (t) => {
    const root = createTempDataSlots(t);
    const store = initializeWorkspaceData(root, WORKSPACE_ID);
    await createTerm(store, WINDOW.startDate, WINDOW.endDate);
    await createCourse(store, makeCourseCommand({
        commandId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        followUpId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        code: 'CSC108',
        expectedRevision: '1',
        expectedPlanVersion: '1',
        weekday: 'MON',
        localStart: '09:00',
        localEnd: '10:00',
    }));
    const reviewed = makeCourseCommand({
        commandId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        followUpId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        code: 'MAT137',
        expectedRevision: '2',
        expectedPlanVersion: '2',
        weekday: 'MON',
        localStart: '09:30',
        localEnd: '10:30',
        location: { kind: 'tba' },
    });

    const decision = requireOverlapDecision(await store.commit(reviewed));
    if (decision.problem.details.reason !== 'meeting-time-overlap') {
        throw new Error('Expected overlap warning');
    }
    const warning = decision.problem.details.warnings[0]!;
    assert.equal(warning.proposed.courseId, null);
    assert.equal(warning.proposed.commandId, reviewed.commandId);
    assert.equal(warning.proposed.courseCode, 'MAT137');
    assert.equal(warning.existing.courseCode, 'CSC108');
    assert.equal(warning.proposed.occurrenceId.originalLogicalAnchor, '2026-09-07');
    assert.equal(warning.existing.occurrenceId.originalLogicalAnchor, '2026-09-07');
    assert.deepEqual(warning.overlap, {
        startInstant: '2026-09-07T13:30:00.000Z',
        endInstant: '2026-09-07T14:00:00.000Z',
    });
    assert.equal(store.status().revision, '2');
    assert.equal(store.readSetupProjection().courses.length, 1);
    assert.equal(store.receipt(reviewed.commandId), null);

    const continuedCommand = normalizeCreateCourseWithMeetingCommand({
        ...reviewed,
        overlapDecision: 'continue',
    });
    const continued = await store.commit(continuedCommand);
    assert.equal(continued.ok, true);
    assert.equal(store.readSetupProjection().courses.length, 2);
    assert.deepEqual(
        store.readSetupProjection().courses.map(course => ({
            code: course.code,
            localStart: course.meetings[0]!.localStart,
            location: course.meetings[0]!.location,
        })),
        [
            { code: 'CSC108', localStart: '09:00', location: { kind: 'known', value: 'Room 101' } },
            { code: 'MAT137', localStart: '09:30', location: { kind: 'tba' } },
        ],
    );
    await store.close();

    const reopened = openWorkspaceData(root);
    assert.equal(reopened.kind, 'ready');
    if (reopened.kind === 'ready') {
        assert.equal(reopened.store.readSetupProjection().courses.length, 2);
        assert.deepEqual(await reopened.store.commit(continuedCommand), continued);
        await reopened.store.close();
    }
});

test('A-COURSE-006: exact Meeting boundaries do not warn', async (t) => {
    const store = initializeWorkspaceData(createTempDataSlots(t), WORKSPACE_ID);
    await createTerm(store, WINDOW.startDate, WINDOW.endDate);
    await createCourse(store, makeCourseCommand({
        commandId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        followUpId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        code: 'CSC108',
        expectedRevision: '1',
        expectedPlanVersion: '1',
        weekday: 'MON',
        localStart: '09:00',
        localEnd: '10:00',
    }));
    const adjacent = await store.commit(makeCourseCommand({
        commandId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        followUpId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        code: 'MAT137',
        expectedRevision: '2',
        expectedPlanVersion: '2',
        weekday: 'MON',
        localStart: '10:00',
        localEnd: '11:00',
    }));

    assert.equal(adjacent.ok, true);
    await store.close();
});

test('A-COURSE-006: an archived Term does not create warnings in the new Current Term', async (t) => {
    const store = initializeWorkspaceData(createTempDataSlots(t), WORKSPACE_ID);
    await createTerm(store, WINDOW.startDate, WINDOW.endDate);
    await createCourse(store, makeCourseCommand({
        commandId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        followUpId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        code: 'CSC108',
        expectedRevision: '1',
        expectedPlanVersion: '1',
        weekday: 'MON',
        localStart: '09:00',
        localEnd: '10:00',
    }));
    const nextTerm = await store.commit(normalizeCreateTermCommand({
        commandId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        followUpId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        expectedRevision: '2',
        expectedPlanVersion: '2',
        intent: {
            kind: 'plan.create-term',
            intentSchemaVersion: 1,
            payload: {
                name: 'Replacement Current Term',
                startDate: WINDOW.startDate,
                endDate: WINDOW.endDate,
                timeZone: 'America/Toronto',
            },
        },
    }));
    assert.equal(nextTerm.ok, true);

    const currentMeeting = await store.commit(makeCourseCommand({
        commandId: '12121212-1212-4212-8212-121212121212',
        followUpId: '13131313-1313-4313-8313-131313131313',
        code: 'MAT137',
        expectedRevision: '3',
        expectedPlanVersion: '3',
        weekday: 'MON',
        localStart: '09:30',
        localEnd: '10:30',
    }));
    assert.equal(currentMeeting.ok, true);
    await store.close();
});

test('Q-TIME-01: cross-day Meetings overlap on the next TermZone LocalDate', async (t) => {
    const store = initializeWorkspaceData(createTempDataSlots(t), WORKSPACE_ID);
    await createTerm(store, '2026-01-01', '2026-01-31');
    await createCourse(store, makeCourseCommand({
        commandId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        followUpId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        code: 'CSC108',
        expectedRevision: '1',
        expectedPlanVersion: '1',
        weekday: 'FRI',
        localStart: '23:30',
        localEnd: '01:30',
        endDayOffset: 1,
    }));
    const decision = requireOverlapDecision(await store.commit(makeCourseCommand({
        commandId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        followUpId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        code: 'MAT137',
        expectedRevision: '2',
        expectedPlanVersion: '2',
        weekday: 'SAT',
        localStart: '01:00',
        localEnd: '02:00',
    })));
    if (decision.problem.details.reason === 'meeting-time-overlap') {
        assert.ok(decision.problem.details.warnings.some(warning => (
            warning.overlap.startInstant === '2026-01-03T06:00:00.000Z'
            && warning.overlap.endInstant === '2026-01-03T06:30:00.000Z'
        )));
    }
    await store.close();
});

test('Q-TIME-01: DST transition overlap is compared by resolved Instants', async (t) => {
    const store = initializeWorkspaceData(createTempDataSlots(t), WORKSPACE_ID);
    await createTerm(store, '2026-03-08', '2026-03-08');
    await createCourse(store, makeCourseCommand({
        commandId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        followUpId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        code: 'CSC108',
        expectedRevision: '1',
        expectedPlanVersion: '1',
        weekday: 'SUN',
        localStart: '01:30',
        localEnd: '03:30',
    }));
    const decision = requireOverlapDecision(await store.commit(makeCourseCommand({
        commandId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        followUpId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        code: 'MAT137',
        expectedRevision: '2',
        expectedPlanVersion: '2',
        weekday: 'SUN',
        localStart: '03:00',
        localEnd: '04:00',
    })));
    if (decision.problem.details.reason === 'meeting-time-overlap') {
        assert.deepEqual(decision.problem.details.warnings[0]!.overlap, {
            startInstant: '2026-03-08T07:00:00.000Z',
            endInstant: '2026-03-08T07:30:00.000Z',
        });
    }
    await store.close();
});

test('TEST-PLAN-004: only-this overlap review leaves the target unchanged until continue', async (t) => {
    const store = initializeWorkspaceData(createTempDataSlots(t), WORKSPACE_ID);
    const series = await seedTwoSeries(store);
    const reviewed = makeChangeCommand({
        commandId: '12121212-1212-4212-8212-121212121212',
        followUpId: '13131313-1313-4313-8313-131313131313',
        meetingSeriesId: series.first,
        originalLogicalAnchor: '2026-09-14',
        scope: 'only-this',
        expectedRevision: '3',
        expectedPlanVersion: '3',
        expectedMeetingSeriesVersion: '1',
        weekday: 'TUE',
        localStart: '11:30',
        localEnd: '11:45',
    });

    requireOverlapDecision(await store.commit(reviewed));
    const unchanged = store.readMeetingSeriesDetail(series.first, WINDOW);
    assert.equal(unchanged.entityVersion, '1');
    assert.equal(unchanged.occurrences.find(occurrence => (
        occurrence.occurrenceId.originalLogicalAnchor === '2026-09-14'
    ))?.localStart, '09:00');

    const continued = await store.commit(normalizeChangeMeetingOccurrenceCommand({
        ...reviewed,
        overlapDecision: 'continue',
    }));
    assert.equal(continued.ok, true);
    const changed = store.readMeetingSeriesDetail(series.first, WINDOW);
    assert.equal(changed.entityVersion, '2');
    assert.equal(changed.occurrences.find(occurrence => (
        occurrence.occurrenceId.originalLogicalAnchor === '2026-09-14'
    ))?.localStart, '11:30');
    assert.equal(changed.occurrences.find(occurrence => (
        occurrence.occurrenceId.originalLogicalAnchor === '2026-09-21'
    ))?.localStart, '09:00');
    await store.close();
});

test('TEST-PLAN-004: replaced overrides are used before overlap evaluation', async (t) => {
    const store = initializeWorkspaceData(createTempDataSlots(t), WORKSPACE_ID);
    const series = await seedTwoSeries(store);
    const moved = await store.commit(makeChangeCommand({
        commandId: '12121212-1212-4212-8212-121212121212',
        followUpId: '13131313-1313-4313-8313-131313131313',
        meetingSeriesId: series.second,
        originalLogicalAnchor: '2026-09-15',
        scope: 'only-this',
        expectedRevision: '3',
        expectedPlanVersion: '3',
        expectedMeetingSeriesVersion: '1',
        weekday: 'WED',
        localStart: '13:00',
        localEnd: '14:00',
    }));
    assert.equal(moved.ok, true);
    const noLongerConflicting = await store.commit(makeChangeCommand({
        commandId: '14141414-1414-4414-8414-141414141414',
        followUpId: '15151515-1515-4515-8515-151515151515',
        meetingSeriesId: series.first,
        originalLogicalAnchor: '2026-09-14',
        scope: 'only-this',
        expectedRevision: '4',
        expectedPlanVersion: '4',
        expectedMeetingSeriesVersion: '1',
        weekday: 'TUE',
        localStart: '11:30',
        localEnd: '11:45',
    }));

    assert.equal(noLongerConflicting.ok, true);
    await store.close();
});

test('TEST-PLAN-004: cancelled occurrences do not occupy time or produce warnings', async (t) => {
    const store = initializeWorkspaceData(createTempDataSlots(t), WORKSPACE_ID);
    const series = await seedTwoSeries(store);
    const cancelled = await store.commit(normalizeCancelMeetingOccurrenceCommand({
        commandId: '16161616-1616-4616-8616-161616161616',
        followUpId: '17171717-1717-4717-8717-171717171717',
        expectedRevision: '3',
        expectedPlanVersion: '3',
        expectedMeetingSeriesVersion: '1',
        intent: {
            kind: 'plan.cancel-meeting-occurrence',
            intentSchemaVersion: 1,
            payload: {
                meetingSeriesId: series.second,
                originalLogicalAnchor: '2026-09-15',
            },
        },
    }));
    assert.equal(cancelled.ok, true);
    const noConflict = await store.commit(makeChangeCommand({
        commandId: '18181818-1818-4818-8818-181818181818',
        followUpId: '19191919-1919-4919-8919-191919191919',
        meetingSeriesId: series.first,
        originalLogicalAnchor: '2026-09-14',
        scope: 'only-this',
        expectedRevision: '4',
        expectedPlanVersion: '4',
        expectedMeetingSeriesVersion: '1',
        weekday: 'TUE',
        localStart: '11:30',
        localEnd: '11:45',
    }));

    assert.equal(noConflict.ok, true);
    await store.close();
});

test('TEST-PLAN-004: future segments warn, then explicit continue splits without deleting series', async (t) => {
    const store = initializeWorkspaceData(createTempDataSlots(t), WORKSPACE_ID);
    const series = await seedTwoSeries(store);
    const unconfirmed = makeChangeCommand({
        commandId: '20202020-2020-4020-8020-202020202020',
        followUpId: '21212121-2121-4121-8121-212121212121',
        meetingSeriesId: series.first,
        originalLogicalAnchor: '2026-09-14',
        scope: 'this-and-future',
        expectedRevision: '3',
        expectedPlanVersion: '3',
        expectedMeetingSeriesVersion: '1',
        weekday: 'TUE',
        localStart: '11:30',
        localEnd: '11:45',
    });
    const impact = store.previewMeetingOccurrenceChange({
        ...unconfirmed.intent.payload,
        scope: 'this-and-future',
        requestedWindow: WINDOW,
    });
    const reviewed = normalizeChangeMeetingOccurrenceCommand({
        ...unconfirmed,
        confirmationToken: impact.confirmationToken,
        impactWindow: impact.requestedWindow,
    });

    requireOverlapDecision(await store.commit(reviewed));
    assert.equal(store.readMeetingSeriesDetail(series.first, WINDOW).segments.length, 1);
    const continued = await store.commit(normalizeChangeMeetingOccurrenceCommand({
        ...reviewed,
        overlapDecision: 'continue',
    }));
    assert.equal(continued.ok, true);
    assert.equal(store.readMeetingSeriesDetail(series.first, WINDOW).segments.length, 2);
    assert.equal(store.readMeetingSeriesDetail(series.second, WINDOW).segments.length, 1);
    await store.close();
});
