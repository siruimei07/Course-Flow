/**
 * @file Verifies transactional HolidayRange lifecycle, persistence, and recovery semantics.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
    CommittedCommandOutcomeUnknownError,
    initializeWorkspaceData,
    openWorkspaceData,
    type SqliteDataStore,
} from '../../src/data/sqlite-data-store';
import {
    normalizeCancelMeetingOccurrenceCommand,
    normalizeChangeMeetingOccurrenceCommand,
    normalizeCreateCourseWithMeetingCommand,
    type MeetingOccurrenceProjection,
} from '../../src/shared/workspace-course-contract';
import {
    normalizeCreateHolidayRangeCommand,
    normalizeDeleteHolidayRangeCommand,
    normalizeUpdateHolidayRangeCommand,
} from '../../src/shared/workspace-holiday-contract';
import {
    normalizeCreateTermCommand,
    normalizeUpdateTermEndDateCommand,
} from '../../src/shared/workspace-term-contract';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

/**
 * Creates an isolated DATA slots root.
 * @param {test.TestContext} t - Node test lifecycle context.
 * @return {string} Fresh DATA slots root.
 */
function createTempDataSlots(t: test.TestContext): string {
    const dataSlotsRoot = mkdtempSync(join(tmpdir(), 'courseflow-holiday-'));
    t.after(() => rmSync(dataSlotsRoot, { recursive: true, force: true }));
    return dataSlotsRoot;
}

/**
 * Creates the owning Current Term and returns its stable identity.
 * @param {SqliteDataStore} store - Writable DATA owner.
 * @return {Promise<string>} Stable Term identity.
 */
async function createCurrentTerm(store: SqliteDataStore): Promise<string> {
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
                startDate: '2026-09-01',
                endDate: '2026-12-20',
                timeZone: 'America/Toronto',
            },
        },
    }));
    assert.equal(result.ok, true);
    if (!result.ok) {
        throw new Error('Expected Current Term');
    }
    return result.value.effects[0].entity.id;
}

/**
 * Creates a weekly Monday Meeting and returns its stable series identity.
 * @param {SqliteDataStore} store - Writable DATA owner.
 * @param {Object} options - Optional command identities, versions, code, and explicit range.
 * @return {Promise<string>} Stable Meeting series identity.
 */
async function createWeeklyMeeting(
    store: SqliteDataStore,
    options: Readonly<{
        commandId?: string;
        followUpId?: string;
        expectedRevision?: string;
        expectedPlanVersion?: string;
        code?: string;
        explicitRange?: Readonly<{ startDate: string; endDate: string }>;
    }> = {},
): Promise<string> {
    const result = await store.commit(normalizeCreateCourseWithMeetingCommand({
        commandId: options.commandId ?? '56565656-5656-4656-8656-565656565656',
        followUpId: options.followUpId ?? '78787878-7878-4878-8878-787878787878',
        overlapDecision: 'review',
        expectedRevision: options.expectedRevision ?? '1',
        expectedPlanVersion: options.expectedPlanVersion ?? '1',
        intent: {
            kind: 'plan.create-course-with-first-meeting',
            intentSchemaVersion: 3,
            payload: {
                course: {
                    code: options.code ?? 'CSC301',
                    name: 'Software Engineering',
                    section: null,
                    instructor: null,
                    color: null,
                    credits: null,
                    teachingRange: { kind: 'inherit-term' },
                },
                meeting: {
                    type: 'LEC',
                    weekday: 'MON',
                    localStart: '09:00',
                    localEnd: '10:00',
                    endDayOffset: 0,
                    effectiveRange: options.explicitRange === undefined
                        ? { kind: 'inherit-course' }
                        : { kind: 'explicit', ...options.explicitRange },
                    location: { kind: 'tba' },
                },
            },
        },
    }));
    assert.equal(result.ok, true);
    if (!result.ok) {
        throw new Error('Expected weekly Meeting');
    }
    return result.value.effects[1]!.entity.id;
}

/**
 * Finds one occurrence by its stable logical anchor.
 * @param {readonly MeetingOccurrenceProjection[]} occurrences - Derived Meeting occurrences.
 * @param {string} anchor - Stable original logical anchor.
 * @return {MeetingOccurrenceProjection} Matching occurrence.
 */
function occurrenceAt(
    occurrences: readonly MeetingOccurrenceProjection[],
    anchor: string,
): MeetingOccurrenceProjection {
    const occurrence = occurrences.find(candidate => (
        candidate.occurrenceId.originalLogicalAnchor === anchor
    ));
    assert.ok(occurrence);
    return occurrence;
}

test('A-TERM-004/ADR-04: HolidayRange CRUD retains stable ID, revision, and tombstone', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const termId = await createCurrentTerm(store);
    const createCommand = normalizeCreateHolidayRangeCommand({
        commandId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        followUpId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        expectedRevision: '1',
        expectedPlanVersion: '1',
        intent: {
            kind: 'plan.create-holiday-range',
            intentSchemaVersion: 1,
            payload: {
                termId,
                name: 'Reading Week',
                startDate: '2026-10-12',
                endDate: '2026-10-16',
            },
        },
    });

    const created = await store.commit(createCommand);
    assert.equal(created.ok, true);
    if (!created.ok) {
        throw new Error('Expected HolidayRange creation');
    }
    assert.equal(created.value.revision, '2');
    assert.equal(created.value.effects[0].code, 'plan.holiday-range-created');
    const holidayRangeId = created.value.effects[0].entity.id;
    assert.deepEqual(store.readSetupProjection().holidayRanges, [{
        holidayRangeId,
        termId,
        name: 'Reading Week',
        startDate: '2026-10-12',
        endDate: '2026-10-16',
        entityVersion: '1',
    }]);
    assert.deepEqual(await store.commit(createCommand), created);

    const updated = await store.commit(normalizeUpdateHolidayRangeCommand({
        commandId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        followUpId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        expectedRevision: '2',
        expectedPlanVersion: '2',
        expectedHolidayRangeVersion: '1',
        overlapDecision: 'review',
        intent: {
            kind: 'plan.update-holiday-range',
            intentSchemaVersion: 1,
            payload: {
                holidayRangeId,
                name: 'Fall Break',
                startDate: '2026-10-13',
                endDate: '2026-10-15',
            },
        },
    }));
    assert.equal(updated.ok, true);
    assert.equal(updated.ok && updated.value.effects[0].entity.id, holidayRangeId);
    assert.equal(updated.ok && updated.value.effects[0].entity.version, '2');
    assert.equal(store.readSetupProjection().holidayRanges[0]?.name, 'Fall Break');

    const deleted = await store.commit(normalizeDeleteHolidayRangeCommand({
        commandId: '12121212-1212-4212-8212-121212121212',
        followUpId: '34343434-3434-4434-8434-343434343434',
        expectedRevision: '3',
        expectedPlanVersion: '3',
        expectedHolidayRangeVersion: '2',
        overlapDecision: 'review',
        intent: {
            kind: 'plan.delete-holiday-range',
            intentSchemaVersion: 1,
            payload: { holidayRangeId },
        },
    }));
    assert.equal(deleted.ok, true);
    assert.equal(deleted.ok && deleted.value.effects[0].entity.id, holidayRangeId);
    assert.equal(deleted.ok && deleted.value.effects[0].entity.version, '3');
    assert.deepEqual(store.readSetupProjection().holidayRanges, []);
    await store.close();

    const database = new DatabaseSync(join(dataSlotsRoot, 'active', 'workspace.sqlite'), {
        readOnly: true,
        readBigInts: true,
    });
    try {
        const row = database.prepare(`
            SELECT holiday_range_id, tombstoned, entity_version
            FROM holiday_ranges
        `).get() as { holiday_range_id: string; tombstoned: bigint; entity_version: bigint };
        assert.equal(row.holiday_range_id, holidayRangeId);
        assert.equal(row.tombstoned, 1n);
        assert.equal(row.entity_version, 3n);
    }
    finally {
        database.close();
    }

    const reopened = openWorkspaceData(dataSlotsRoot);
    assert.equal(reopened.kind, 'ready');
    if (reopened.kind !== 'ready') {
        throw new Error('Expected ready DATA after restart');
    }
    assert.equal(reopened.store.status().revision, '4');
    assert.deepEqual(reopened.store.readSetupProjection().holidayRanges, []);
    assert.deepEqual(reopened.store.receipt(createCommand.commandId), created.ok ? created.value : null);
    await reopened.store.close();
});

test('A-TERM-005: multiple inclusive HolidayRanges suppress boundaries with stable occurrence IDs', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const termId = await createCurrentTerm(store);
    const meetingSeriesId = await createWeeklyMeeting(store);
    const window = { startDate: '2026-09-01', endDate: '2026-09-30' } as const;
    const before = store.readMeetingSeriesDetail(meetingSeriesId, window).occurrences;

    const first = await store.commit(normalizeCreateHolidayRangeCommand({
        commandId: '90909090-9090-4090-8090-909090909090',
        followUpId: 'abababab-abab-4bab-8bab-abababababab',
        expectedRevision: '2',
        expectedPlanVersion: '2',
        intent: {
            kind: 'plan.create-holiday-range',
            intentSchemaVersion: 1,
            payload: {
                termId,
                name: 'Labour Day',
                startDate: '2026-09-07',
                endDate: '2026-09-07',
            },
        },
    }));
    assert.equal(first.ok, true);
    const second = await store.commit(normalizeCreateHolidayRangeCommand({
        commandId: 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
        followUpId: 'efefefef-efef-4fef-8fef-efefefefefef',
        expectedRevision: '3',
        expectedPlanVersion: '3',
        intent: {
            kind: 'plan.create-holiday-range',
            intentSchemaVersion: 1,
            payload: {
                termId,
                name: 'Reading Break',
                startDate: '2026-09-14',
                endDate: '2026-09-21',
            },
        },
    }));
    assert.equal(second.ok, true);

    const after = store.readMeetingSeriesDetail(meetingSeriesId, window).occurrences;
    for (const anchor of ['2026-09-07', '2026-09-14', '2026-09-21']) {
        const original = occurrenceAt(before, anchor);
        const suppressed = occurrenceAt(after, anchor);
        assert.deepEqual(suppressed.occurrenceId, original.occurrenceId);
        assert.equal(suppressed.status, 'holiday-suppressed');
    }
    assert.equal(occurrenceAt(after, '2026-09-28').status, 'scheduled');
    await store.close();
});

test('A-TERM-005: edit and delete rederive deterministically without erasing only-this overrides', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const termId = await createCurrentTerm(store);
    const meetingSeriesId = await createWeeklyMeeting(store);
    const changed = await store.commit(normalizeChangeMeetingOccurrenceCommand({
        commandId: '13131313-1313-4313-8313-131313131313',
        followUpId: '24242424-2424-4424-8424-242424242424',
        confirmationToken: null,
        impactWindow: null,
        overlapDecision: 'review',
        expectedRevision: '2',
        expectedPlanVersion: '2',
        expectedMeetingSeriesVersion: '1',
        intent: {
            kind: 'plan.change-meeting-occurrence',
            intentSchemaVersion: 2,
            payload: {
                meetingSeriesId,
                originalLogicalAnchor: '2026-09-14',
                scope: 'only-this',
                replacement: {
                    type: 'TUT',
                    weekday: 'TUE',
                    localStart: '11:00',
                    localEnd: '12:00',
                    endDayOffset: 0,
                    location: { kind: 'tba' },
                },
            },
        },
    }));
    assert.equal(changed.ok, true);
    const cancelled = await store.commit(normalizeCancelMeetingOccurrenceCommand({
        commandId: '35353535-3535-4535-8535-353535353535',
        followUpId: '46464646-4646-4646-8646-464646464646',
        expectedRevision: '3',
        expectedPlanVersion: '3',
        expectedMeetingSeriesVersion: '2',
        intent: {
            kind: 'plan.cancel-meeting-occurrence',
            intentSchemaVersion: 1,
            payload: {
                meetingSeriesId,
                originalLogicalAnchor: '2026-09-21',
            },
        },
    }));
    assert.equal(cancelled.ok, true);

    const created = await store.commit(normalizeCreateHolidayRangeCommand({
        commandId: '57575757-5757-4757-8757-575757575757',
        followUpId: '68686868-6868-4868-8868-686868686868',
        expectedRevision: '4',
        expectedPlanVersion: '4',
        intent: {
            kind: 'plan.create-holiday-range',
            intentSchemaVersion: 1,
            payload: {
                termId,
                name: 'Break',
                startDate: '2026-09-07',
                endDate: '2026-09-21',
            },
        },
    }));
    assert.equal(created.ok, true);
    if (!created.ok) {
        throw new Error('Expected HolidayRange creation');
    }
    const holidayRangeId = created.value.effects[0].entity.id;
    const window = { startDate: '2026-09-01', endDate: '2026-09-30' } as const;
    const during = store.readMeetingSeriesDetail(meetingSeriesId, window).occurrences;
    assert.equal(occurrenceAt(during, '2026-09-07').status, 'holiday-suppressed');
    assert.equal(occurrenceAt(during, '2026-09-14').status, 'scheduled');
    assert.equal(occurrenceAt(during, '2026-09-14').overrideKind, 'replaced');
    assert.equal(occurrenceAt(during, '2026-09-21').status, 'cancelled');

    const edited = await store.commit(normalizeUpdateHolidayRangeCommand({
        commandId: '79797979-7979-4979-8979-797979797979',
        followUpId: '8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a',
        expectedRevision: '5',
        expectedPlanVersion: '5',
        expectedHolidayRangeVersion: '1',
        overlapDecision: 'review',
        intent: {
            kind: 'plan.update-holiday-range',
            intentSchemaVersion: 1,
            payload: {
                holidayRangeId,
                name: 'Break moved',
                startDate: '2026-09-28',
                endDate: '2026-09-28',
            },
        },
    }));
    assert.equal(edited.ok, true);
    const afterEdit = store.readMeetingSeriesDetail(meetingSeriesId, window).occurrences;
    assert.equal(occurrenceAt(afterEdit, '2026-09-07').status, 'scheduled');
    assert.deepEqual(
        occurrenceAt(afterEdit, '2026-09-14').occurrenceId,
        occurrenceAt(during, '2026-09-14').occurrenceId,
    );
    assert.equal(occurrenceAt(afterEdit, '2026-09-14').overrideKind, 'replaced');
    assert.equal(occurrenceAt(afterEdit, '2026-09-21').status, 'cancelled');
    assert.equal(occurrenceAt(afterEdit, '2026-09-28').status, 'holiday-suppressed');

    const deleted = await store.commit(normalizeDeleteHolidayRangeCommand({
        commandId: '9b9b9b9b-9b9b-4b9b-8b9b-9b9b9b9b9b9b',
        followUpId: 'acacacac-acac-4cac-8cac-acacacacacac',
        expectedRevision: '6',
        expectedPlanVersion: '6',
        expectedHolidayRangeVersion: '2',
        overlapDecision: 'review',
        intent: {
            kind: 'plan.delete-holiday-range',
            intentSchemaVersion: 1,
            payload: { holidayRangeId },
        },
    }));
    assert.equal(deleted.ok, true);
    const afterDelete = store.readMeetingSeriesDetail(meetingSeriesId, window).occurrences;
    assert.equal(occurrenceAt(afterDelete, '2026-09-28').status, 'scheduled');
    assert.equal(occurrenceAt(afterDelete, '2026-09-14').overrideKind, 'replaced');
    assert.equal(occurrenceAt(afterDelete, '2026-09-21').status, 'cancelled');
    await store.close();
});

test('A-TERM-005: edit and delete warn only for newly unsuppressed Meeting conflicts', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const termId = await createCurrentTerm(store);
    await createWeeklyMeeting(store);
    const created = await store.commit(normalizeCreateHolidayRangeCommand({
        commandId: 'bdbdbdbd-bdbd-4dbd-8dbd-bdbdbdbdbdbd',
        followUpId: 'cececece-cece-4ece-8ece-cececececece',
        expectedRevision: '2',
        expectedPlanVersion: '2',
        intent: {
            kind: 'plan.create-holiday-range',
            intentSchemaVersion: 1,
            payload: {
                termId,
                name: 'Full break',
                startDate: '2026-09-07',
                endDate: '2026-09-28',
            },
        },
    }));
    assert.equal(created.ok, true);
    if (!created.ok) {
        throw new Error('Expected HolidayRange creation');
    }
    const holidayRangeId = created.value.effects[0].entity.id;
    await createWeeklyMeeting(store, {
        commandId: 'dfdfdfdf-dfdf-4fdf-8fdf-dfdfdfdfdfdf',
        followUpId: 'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',
        expectedRevision: '3',
        expectedPlanVersion: '3',
        code: 'CSC302',
        explicitRange: { startDate: '2026-09-07', endDate: '2026-09-28' },
    });

    const updateBase = {
        commandId: 'f2f2f2f2-f2f2-42f2-82f2-f2f2f2f2f2f2',
        followUpId: '14141414-1414-4414-8414-141414141414',
        expectedRevision: '4',
        expectedPlanVersion: '4',
        expectedHolidayRangeVersion: '1',
        intent: {
            kind: 'plan.update-holiday-range',
            intentSchemaVersion: 1,
            payload: {
                holidayRangeId,
                name: 'Middle break',
                startDate: '2026-09-14',
                endDate: '2026-09-21',
            },
        },
    } as const;
    const updateWarning = await store.commit(normalizeUpdateHolidayRangeCommand({
        ...updateBase,
        overlapDecision: 'review',
    }));
    assert.equal(updateWarning.ok, false);
    if (updateWarning.ok || updateWarning.problem.code !== 'decision-required') {
        throw new Error('Expected newly introduced conflict warning');
    }
    assert.deepEqual(updateWarning.problem.details.reason, 'meeting-time-overlap');
    if (updateWarning.problem.details.reason !== 'meeting-time-overlap') {
        throw new Error('Expected Meeting overlap warning details');
    }
    assert.deepEqual(updateWarning.problem.details.warnings.map(warning => (
        warning.proposed.occurrenceId.originalLogicalAnchor
    )), ['2026-09-07', '2026-09-28']);
    assert.equal(store.status().revision, '4');

    const updated = await store.commit(normalizeUpdateHolidayRangeCommand({
        ...updateBase,
        overlapDecision: 'continue',
    }));
    assert.equal(updated.ok, true);
    const deleteBase = {
        commandId: '25252525-2525-4525-8525-252525252525',
        followUpId: '36363636-3636-4636-8636-363636363636',
        expectedRevision: '5',
        expectedPlanVersion: '5',
        expectedHolidayRangeVersion: '2',
        intent: {
            kind: 'plan.delete-holiday-range',
            intentSchemaVersion: 1,
            payload: { holidayRangeId },
        },
    } as const;
    const deleteWarning = await store.commit(normalizeDeleteHolidayRangeCommand({
        ...deleteBase,
        overlapDecision: 'review',
    }));
    assert.equal(deleteWarning.ok, false);
    if (deleteWarning.ok || deleteWarning.problem.code !== 'decision-required') {
        throw new Error('Expected delete conflict warning');
    }
    if (deleteWarning.problem.details.reason !== 'meeting-time-overlap') {
        throw new Error('Expected Meeting overlap warning details');
    }
    assert.deepEqual(deleteWarning.problem.details.warnings.map(warning => (
        warning.proposed.occurrenceId.originalLogicalAnchor
    )), ['2026-09-14', '2026-09-21']);
    assert.equal(store.status().revision, '5');
    const deleted = await store.commit(normalizeDeleteHolidayRangeCommand({
        ...deleteBase,
        overlapDecision: 'continue',
    }));
    assert.equal(deleted.ok, true);
    await store.close();
});

test('TEST-DATA-002/004/005: HolidayRange writes are atomic, idempotent, stale-safe, and read-only-safe', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const termId = await createCurrentTerm(store);
    const command = normalizeCreateHolidayRangeCommand({
        commandId: '47474747-4747-4747-8747-474747474747',
        followUpId: '58585858-5858-4858-8858-585858585858',
        expectedRevision: '1',
        expectedPlanVersion: '1',
        intent: {
            kind: 'plan.create-holiday-range',
            intentSchemaVersion: 1,
            payload: {
                termId,
                name: 'Reading Week',
                startDate: '2026-10-12',
                endDate: '2026-10-16',
            },
        },
    });

    await assert.rejects(store.commit(command, {
        failpoint(point) {
            if (point === 'commit.after-facts') {
                throw new Error('injected HolidayRange failure');
            }
        },
    }));
    assert.equal(store.status().revision, '1');
    assert.deepEqual(store.readSetupProjection().holidayRanges, []);
    assert.equal(store.receipt(command.commandId), null);
    assert.equal(store.readProtectionWatermark(), '1');

    const committed = await store.commit(command);
    assert.equal(committed.ok, true);
    assert.deepEqual(await store.commit(command), committed);
    const reused = await store.commit(normalizeCreateHolidayRangeCommand({
        ...command,
        intent: {
            ...command.intent,
            payload: { ...command.intent.payload, name: 'Different semantics' },
        },
    }));
    assert.equal(reused.ok, false);
    assert.equal(!reused.ok && reused.problem.details.reason, 'command-id-reused');
    if (!committed.ok) {
        throw new Error('Expected committed HolidayRange');
    }
    const stale = await store.commit(normalizeUpdateHolidayRangeCommand({
        commandId: '6b6b6b6b-6b6b-4b6b-8b6b-6b6b6b6b6b6b',
        followUpId: '7c7c7c7c-7c7c-4c7c-8c7c-7c7c7c7c7c7c',
        expectedRevision: '2',
        expectedPlanVersion: '2',
        expectedHolidayRangeVersion: '0',
        overlapDecision: 'review',
        intent: {
            kind: 'plan.update-holiday-range',
            intentSchemaVersion: 1,
            payload: {
                holidayRangeId: committed.value.effects[0].entity.id,
                name: 'Stale update',
                startDate: '2026-10-12',
                endDate: '2026-10-16',
            },
        },
    }));
    assert.equal(stale.ok, false);
    if (stale.ok || stale.problem.code !== 'conflict') {
        throw new Error('Expected HolidayRange version conflict');
    }
    assert.equal(stale.problem.details.reason, 'expected-entity-version');
    assert.equal(stale.problem.context.entityVersions[0].kind, 'holiday-range');
    assert.equal(store.status().revision, '2');
    await store.close();

    const readOnly = openWorkspaceData(dataSlotsRoot, { readOnly: true });
    assert.equal(readOnly.kind, 'read-only');
    if (readOnly.kind !== 'read-only') {
        throw new Error('Expected read-only DATA');
    }
    const denied = await readOnly.store.commit(normalizeCreateHolidayRangeCommand({
        ...command,
        commandId: '69696969-6969-4969-8969-696969696969',
        followUpId: '7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a',
        expectedRevision: '2',
        expectedPlanVersion: '2',
    }));
    assert.equal(denied.ok, false);
    assert.equal(!denied.ok && denied.problem.code, 'permission');
    assert.equal(readOnly.store.status().revision, '2');
    assert.equal(readOnly.store.readSetupProjection().holidayRanges.length, 1);
    await readOnly.store.close();
});

test('TEST-DATA-004: post-COMMIT HolidayRange response loss recovers by receipt after restart', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const termId = await createCurrentTerm(store);
    const command = normalizeCreateHolidayRangeCommand({
        commandId: '8b8b8b8b-8b8b-4b8b-8b8b-8b8b8b8b8b8b',
        followUpId: '9c9c9c9c-9c9c-4c9c-8c9c-9c9c9c9c9c9c',
        expectedRevision: '1',
        expectedPlanVersion: '1',
        intent: {
            kind: 'plan.create-holiday-range',
            intentSchemaVersion: 1,
            payload: {
                termId,
                name: 'Reading Week',
                startDate: '2026-10-12',
                endDate: '2026-10-16',
            },
        },
    });
    await assert.rejects(store.commit(command, {
        failpoint(point) {
            if (point === 'commit.after-sqlite-commit') {
                throw new Error('lost HolidayRange response');
            }
        },
    }), CommittedCommandOutcomeUnknownError);
    await store.close();

    const reopened = openWorkspaceData(dataSlotsRoot);
    assert.equal(reopened.kind, 'ready');
    if (reopened.kind !== 'ready') {
        throw new Error('Expected receipt recovery DATA');
    }
    assert.equal(reopened.store.receipt(command.commandId)?.effects[0].code, 'plan.holiday-range-created');
    assert.equal(reopened.store.readSetupProjection().holidayRanges.length, 1);
    await reopened.store.close();
});

test('ADR-04/TEST-DATA-005: invalid persisted HolidayRange facts enter recovery mode', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const termId = await createCurrentTerm(store);
    await store.commit(normalizeCreateHolidayRangeCommand({
        commandId: 'adadadad-adad-4dad-8dad-adadadadadad',
        followUpId: 'bebebebe-bebe-4ebe-8ebe-bebebebebebe',
        expectedRevision: '1',
        expectedPlanVersion: '1',
        intent: {
            kind: 'plan.create-holiday-range',
            intentSchemaVersion: 1,
            payload: {
                termId,
                name: 'Reading Week',
                startDate: '2026-10-12',
                endDate: '2026-10-16',
            },
        },
    }));
    await store.close();

    const database = new DatabaseSync(join(dataSlotsRoot, 'active', 'workspace.sqlite'));
    try {
        database.exec(`
            PRAGMA ignore_check_constraints = ON;
            UPDATE holiday_ranges SET tombstoned = 2;
        `);
    }
    finally {
        database.close();
    }
    const opened = openWorkspaceData(dataSlotsRoot);
    assert.equal(opened.kind, 'recovery');
    assert.equal(opened.kind === 'recovery' && opened.problem.code, 'integrity');
});

test('A-TERM-004: a Term correction cannot strand an active HolidayRange outside its owner', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const termId = await createCurrentTerm(store);
    await store.commit(normalizeCreateHolidayRangeCommand({
        commandId: 'cfcfcfcf-cfcf-4fcf-8fcf-cfcfcfcfcfcf',
        followUpId: 'd0d0d0d0-d0d0-40d0-80d0-d0d0d0d0d0d0',
        expectedRevision: '1',
        expectedPlanVersion: '1',
        intent: {
            kind: 'plan.create-holiday-range',
            intentSchemaVersion: 1,
            payload: {
                termId,
                name: 'Reading Week',
                startDate: '2026-10-12',
                endDate: '2026-10-16',
            },
        },
    }));

    await assert.rejects(store.commit(normalizeUpdateTermEndDateCommand({
        commandId: 'e2e2e2e2-e2e2-42e2-82e2-e2e2e2e2e2e2',
        followUpId: 'f3f3f3f3-f3f3-43f3-83f3-f3f3f3f3f3f3',
        expectedRevision: '2',
        expectedPlanVersion: '2',
        expectedTermVersion: '1',
        intent: {
            kind: 'plan.update-term-end-date',
            intentSchemaVersion: 1,
            payload: { termId, endDate: '2026-10-10' },
        },
    })), TypeError);
    assert.equal(store.status().revision, '2');
    assert.equal(store.readSetupProjection().currentTerm?.endDate, '2026-12-20');
    assert.equal(store.readSetupProjection().holidayRanges.length, 1);
    await store.close();
});
