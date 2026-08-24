/**
 * @file Verifies stable Meeting occurrence derivation and scoped rule mutations in DATA.
 */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
    CommittedCommandOutcomeUnknownError,
    initializeWorkspaceData,
    openWorkspaceData,
    type SqliteDataStore,
} from '../../src/data/sqlite-data-store';
import {
    isMeetingOccurrenceImpactProjection,
    isMeetingSeriesDetailProjection,
    normalizeCancelMeetingOccurrenceCommand,
    normalizeChangeMeetingOccurrenceCommand,
    normalizeCreateCourseWithMeetingCommand,
    type ChangeMeetingOccurrenceCommand,
    type CreateCourseWithMeetingCommand,
} from '../../src/shared/workspace-course-contract';
import {
    normalizeCreateTermCommand,
    normalizeUpdateTermEndDateCommand,
} from '../../src/shared/workspace-term-contract';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const FALL_WINDOW = Object.freeze({ startDate: '2026-09-01', endDate: '2026-12-31' });

/**
 * Creates an isolated DATA root for one occurrence test.
 * @param {test.TestContext} t - Node test lifecycle context.
 * @return {string} Temporary data-slots root.
 */
function createTempDataSlots(t: test.TestContext): string {
    const dataSlotsRoot = mkdtempSync(join(tmpdir(), 'courseflow-occurrence-'));
    t.after(() => rmSync(dataSlotsRoot, { recursive: true, force: true }));
    return dataSlotsRoot;
}

/**
 * Builds the canonical Course and initial Meeting fixture command.
 * @param {'MON' | 'SAT'} weekday - Initial Meeting weekday.
 * @return {CreateCourseWithMeetingCommand} Normalized creation command.
 */
function makeCourseCommand(weekday: 'MON' | 'SAT' = 'MON'): CreateCourseWithMeetingCommand {
    return normalizeCreateCourseWithMeetingCommand({
        commandId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        followUpId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        expectedRevision: '1',
        expectedPlanVersion: '1',
        intent: {
            kind: 'plan.create-course-with-first-meeting',
            intentSchemaVersion: 2,
            payload: {
                course: {
                    code: 'CSC108',
                    name: 'Introduction to Computer Programming',
                    section: null,
                    instructor: null,
                    color: null,
                    credits: null,
                    teachingRange: { kind: 'inherit-term' },
                },
                meeting: {
                    type: 'LEC',
                    weekday,
                    localStart: '09:00',
                    localEnd: '10:00',
                    effectiveRange: { kind: 'inherit-course' },
                    location: { kind: 'known', value: 'BA 1170' },
                },
            },
        },
    });
}

/**
 * Builds a canonical scoped Meeting occurrence change fixture.
 * @param {object} options - Identity, version, scope, and replacement overrides.
 * @return {ChangeMeetingOccurrenceCommand} Normalized occurrence change command.
 */
function makeChangeCommand(options: Readonly<{
    commandId?: string;
    followUpId?: string;
    expectedRevision?: string;
    expectedPlanVersion?: string;
    expectedMeetingSeriesVersion?: string;
    confirmationToken?: string | null;
    impactWindow?: Readonly<{ startDate: string; endDate: string }> | null;
    meetingSeriesId: string;
    originalLogicalAnchor?: string;
    scope?: 'only-this' | 'this-and-future';
    localStart?: string;
    weekday?: 'TUE' | 'SUN';
}>): ChangeMeetingOccurrenceCommand {
    const localStart = options.localStart ?? '11:00';
    return normalizeChangeMeetingOccurrenceCommand({
        commandId: options.commandId ?? '77777777-7777-4777-8777-777777777777',
        followUpId: options.followUpId ?? '88888888-8888-4888-8888-888888888888',
        confirmationToken: options.confirmationToken ?? null,
        impactWindow: options.impactWindow ?? null,
        expectedRevision: options.expectedRevision ?? '2',
        expectedPlanVersion: options.expectedPlanVersion ?? '2',
        expectedMeetingSeriesVersion: options.expectedMeetingSeriesVersion ?? '1',
        intent: {
            kind: 'plan.change-meeting-occurrence',
            intentSchemaVersion: 1,
            payload: {
                meetingSeriesId: options.meetingSeriesId,
                originalLogicalAnchor: options.originalLogicalAnchor ?? '2026-09-28',
                scope: options.scope ?? 'only-this',
                replacement: {
                    type: 'TUT',
                    weekday: options.weekday ?? 'TUE',
                    localStart,
                    localEnd: localStart === '11:00' ? '12:00' : '13:00',
                    location: { kind: 'tba' },
                },
            },
        },
    });
}

/**
 * Persists one Term, Course, and initial Meeting series.
 * @param {SqliteDataStore} store - Writable test DATA store.
 * @param {object} options - Effective range and initial weekday.
 * @return {Promise<string>} Stable seeded MeetingSeriesId.
 */
async function seedMeetingSeries(
    store: SqliteDataStore,
    options: Readonly<{
        startDate: string;
        endDate: string;
        weekday: 'MON' | 'SAT';
    }> = { startDate: '2026-09-08', endDate: '2026-12-18', weekday: 'MON' },
): Promise<string> {
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
                startDate: options.startDate,
                endDate: options.endDate,
                timeZone: 'America/Toronto',
            },
        },
    }));
    assert.equal(term.ok, true);
    const course = await store.commit(makeCourseCommand(options.weekday));
    assert.equal(course.ok, true);
    if (!course.ok) {
        throw new Error('Expected seeded Meeting series');
    }
    return course.value.effects[1]!.entity.id;
}

/**
 * Reopens an existing test DATA root and requires ready mode.
 * @param {string} dataSlotsRoot - Existing data-slots root.
 * @return {SqliteDataStore} Reopened ready DATA store.
 */
function requireReady(dataSlotsRoot: string): SqliteDataStore {
    const opened = openWorkspaceData(dataSlotsRoot);
    assert.equal(opened.kind, 'ready');
    if (opened.kind !== 'ready') {
        throw new Error('Expected ready DATA');
    }
    return opened.store;
}

/**
 * Reads the standard Fall fixture window for one Meeting series.
 * @param {SqliteDataStore} store - Open DATA store.
 * @param {string} meetingSeriesId - Stable Meeting series identity.
 * @return {MeetingSeriesDetailProjection} Bounded Meeting series detail.
 */
function readMeetingDetail(store: SqliteDataStore, meetingSeriesId: string) {
    return store.readMeetingSeriesDetail(meetingSeriesId, FALL_WINDOW);
}

/**
 * Obtains a fresh impact token and returns the corresponding confirmed command.
 * @param {SqliteDataStore} store - Open DATA store.
 * @param {ChangeMeetingOccurrenceCommand} command - Unconfirmed future-change command.
 * @return {ChangeMeetingOccurrenceCommand} Command carrying the bound token and window.
 */
function confirmFutureChange(
    store: SqliteDataStore,
    command: ChangeMeetingOccurrenceCommand,
): ChangeMeetingOccurrenceCommand {
    assert.equal(command.intent.payload.scope, 'this-and-future');
    const impact = store.previewMeetingOccurrenceChange({
        scope: 'this-and-future',
        meetingSeriesId: command.intent.payload.meetingSeriesId,
        originalLogicalAnchor: command.intent.payload.originalLogicalAnchor,
        replacement: command.intent.payload.replacement,
        requestedWindow: FALL_WINDOW,
    });
    return normalizeChangeMeetingOccurrenceCommand({
        ...command,
        confirmationToken: impact.confirmationToken,
        impactWindow: impact.requestedWindow,
    });
}

test('TEST-PLAN-005: generated Meeting occurrences keep tuple IDs across recompute and restart', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const meetingSeriesId = await seedMeetingSeries(store);

    const firstRead = readMeetingDetail(store, meetingSeriesId);
    const recomputed = readMeetingDetail(store, meetingSeriesId);
    assert.equal(firstRead.occurrences.length, 14);
    assert.deepEqual(firstRead.occurrences[0]?.occurrenceId, {
        meetingSeriesId,
        originalLogicalAnchor: '2026-09-14',
    });
    assert.deepEqual(
        recomputed.occurrences.map(occurrence => occurrence.occurrenceId),
        firstRead.occurrences.map(occurrence => occurrence.occurrenceId),
    );
    await store.close();

    const reopened = requireReady(dataSlotsRoot);
    assert.deepEqual(
        readMeetingDetail(reopened, meetingSeriesId).occurrences.map(occurrence => occurrence.occurrenceId),
        firstRead.occurrences.map(occurrence => occurrence.occurrenceId),
    );
    await reopened.close();

    const database = new DatabaseSync(join(dataSlotsRoot, 'active', 'workspace.sqlite'), { readOnly: true });
    try {
        const tables = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all() as Array<{
            name: string;
        }>;
        assert.equal(tables.some(row => row.name === 'meeting_occurrences'), false);
        assert.equal(tables.some(row => row.name === 'meeting_occurrence_overrides'), true);
    }
    finally {
        database.close();
    }
});

test('IF-PLAN-QUERY: a bounded year-9999 window terminates at the LocalDate ceiling', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const meetingSeriesId = await seedMeetingSeries(store, {
        startDate: '9999-12-20',
        endDate: '9999-12-31',
        weekday: 'MON',
    });
    const requestedWindow = { startDate: '9999-12-20', endDate: '9999-12-31' };

    const detail = store.readMeetingSeriesDetail(meetingSeriesId, requestedWindow);

    assert.deepEqual(detail.requestedWindow, requestedWindow);
    assert.deepEqual(
        detail.occurrences.map(occurrence => occurrence.occurrenceId.originalLogicalAnchor),
        ['9999-12-20', '9999-12-27'],
    );
    await store.close();
});

test('A-COURSE-007: a rule with no representable future weekday remains a valid empty series', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const meetingSeriesId = await seedMeetingSeries(store, {
        startDate: '9999-12-31',
        endDate: '9999-12-31',
        weekday: 'SAT',
    });

    const detail = store.readMeetingSeriesDetail(meetingSeriesId, {
        startDate: '9999-12-31',
        endDate: '9999-12-31',
    });

    assert.equal(detail.occurrences.length, 0);
    assert.equal(detail.segments[0]?.logicalStartAnchor, '9999-12-25');
    await store.close();
});

test('TEST-PLAN-005: inherited range recompute changes the set without drifting shared IDs', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const meetingSeriesId = await seedMeetingSeries(store);
    const initial = readMeetingDetail(store, meetingSeriesId);
    const term = store.readSetupProjection().currentTerm!;

    const shortened = await store.commit(normalizeUpdateTermEndDateCommand({
        commandId: '45454545-4545-4545-8545-454545454545',
        followUpId: '56565656-5656-4656-8656-565656565656',
        expectedRevision: '2',
        expectedPlanVersion: '2',
        expectedTermVersion: term.entityVersion,
        intent: {
            kind: 'plan.update-term-end-date',
            intentSchemaVersion: 1,
            payload: { termId: term.termId, endDate: '2026-10-09' },
        },
    }));
    assert.equal(shortened.ok, true);
    const afterShorten = readMeetingDetail(store, meetingSeriesId);
    assert.deepEqual(
        afterShorten.occurrences.map(occurrence => occurrence.occurrenceId.originalLogicalAnchor),
        ['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05'],
    );
    assert.deepEqual(
        afterShorten.occurrences.map(occurrence => occurrence.occurrenceId),
        initial.occurrences.slice(0, 4).map(occurrence => occurrence.occurrenceId),
    );

    const extended = await store.commit(normalizeUpdateTermEndDateCommand({
        commandId: '67676767-6767-4767-8767-676767676767',
        followUpId: '78787878-7878-4787-8787-787878787878',
        expectedRevision: '3',
        expectedPlanVersion: '3',
        expectedTermVersion: '2',
        intent: {
            kind: 'plan.update-term-end-date',
            intentSchemaVersion: 1,
            payload: { termId: term.termId, endDate: '2026-12-25' },
        },
    }));
    assert.equal(extended.ok, true);
    const afterExtend = readMeetingDetail(store, meetingSeriesId);
    assert.equal(afterExtend.occurrences.at(-1)?.occurrenceId.originalLogicalAnchor, '2026-12-21');
    assert.deepEqual(
        afterExtend.occurrences.slice(0, initial.occurrences.length).map(occurrence => occurrence.occurrenceId),
        initial.occurrences.map(occurrence => occurrence.occurrenceId),
    );
    assert.equal(afterExtend.entityVersion, '1');
    await store.close();
});

test('TEST-PLAN-004/005: only-this persists one target override with receipt and idempotency', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const meetingSeriesId = await seedMeetingSeries(store);
    const before = readMeetingDetail(store, meetingSeriesId);
    const command = makeChangeCommand({ meetingSeriesId });

    const committed = await store.commit(command);

    assert.equal(committed.ok, true);
    if (!committed.ok) {
        throw new Error('Expected only-this change to commit');
    }
    assert.deepEqual(committed.value, {
        kind: 'committed',
        revision: '3',
        effects: [{
            code: 'plan.meeting-occurrence-changed',
            entity: { kind: 'meeting-series', id: meetingSeriesId, version: '2' },
        }],
        pendingFollowUps: ['88888888-8888-4888-8888-888888888888'],
    });
    const after = readMeetingDetail(store, meetingSeriesId);
    assert.equal(after.workspaceRevision, '3');
    assert.equal(after.planEntityVersion, '3');
    const target = after.occurrences.find(occurrence => (
        occurrence.occurrenceId.originalLogicalAnchor === '2026-09-28'
    ));
    assert.deepEqual(target, {
        occurrenceId: { meetingSeriesId, originalLogicalAnchor: '2026-09-28' },
        segmentId: before.segments[0]!.segmentId,
        date: '2026-09-29',
        status: 'scheduled',
        overrideKind: 'replaced',
        type: 'TUT',
        weekday: 'TUE',
        localStart: '11:00',
        localEnd: '12:00',
        location: { kind: 'tba' },
    });
    for (const anchor of ['2026-09-21', '2026-10-05']) {
        assert.deepEqual(
            after.occurrences.find(occurrence => occurrence.occurrenceId.originalLogicalAnchor === anchor),
            before.occurrences.find(occurrence => occurrence.occurrenceId.originalLogicalAnchor === anchor),
        );
    }
    assert.deepEqual(await store.commit(command), committed);
    const conflict = await store.commit(makeChangeCommand({ meetingSeriesId, localStart: '12:00' }));
    assert.equal(conflict.ok, false);
    if (conflict.ok) {
        throw new Error('Expected changed semantics to conflict');
    }
    assert.equal(conflict.problem.details.reason, 'command-id-reused');
    assert.equal(store.readSetupProjection().workspaceRevision, '3');
    assert.equal(store.readSetupProjection().planEntityVersion, '3');
    assert.equal(store.readProtectionWatermark(), '3');
    await store.close();
});

test('TEST-PLAN-004/005: this-and-future splits one series without rewriting history or IDs', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const meetingSeriesId = await seedMeetingSeries(store);
    const before = readMeetingDetail(store, meetingSeriesId);
    const originalSegmentId = before.segments[0]!.segmentId;
    const command = confirmFutureChange(store, makeChangeCommand({
        meetingSeriesId,
        originalLogicalAnchor: '2026-10-12',
        scope: 'this-and-future',
    }));

    const committed = await store.commit(command);

    assert.equal(committed.ok, true);
    if (!committed.ok) {
        throw new Error('Expected future split to commit');
    }
    assert.equal(committed.value.revision, '3');
    assert.deepEqual(committed.value.effects, [{
        code: 'plan.meeting-occurrence-changed',
        entity: { kind: 'meeting-series', id: meetingSeriesId, version: '2' },
    }]);
    const after = readMeetingDetail(store, meetingSeriesId);
    assert.equal(after.workspaceRevision, '3');
    assert.equal(after.planEntityVersion, '3');
    assert.equal(after.meetingSeriesId, meetingSeriesId);
    assert.equal(after.segments.length, 2);
    assert.deepEqual(after.segments[0], {
        segmentId: originalSegmentId,
        logicalStartAnchor: '2026-09-14',
        logicalEndAnchor: '2026-10-05',
        type: 'LEC',
        weekday: 'MON',
        localStart: '09:00',
        localEnd: '10:00',
        location: { kind: 'known', value: 'BA 1170' },
    });
    assert.notEqual(after.segments[1]?.segmentId, originalSegmentId);
    assert.deepEqual(after.segments[1], {
        segmentId: after.segments[1]!.segmentId,
        logicalStartAnchor: '2026-10-12',
        logicalEndAnchor: null,
        type: 'TUT',
        weekday: 'TUE',
        localStart: '11:00',
        localEnd: '12:00',
        location: { kind: 'tba' },
    });
    const historicalBefore = before.occurrences.filter(occurrence => (
        occurrence.occurrenceId.originalLogicalAnchor < '2026-10-12'
    ));
    const historicalAfter = after.occurrences.filter(occurrence => (
        occurrence.occurrenceId.originalLogicalAnchor < '2026-10-12'
    ));
    assert.deepEqual(historicalAfter, historicalBefore);
    assert.deepEqual(
        after.occurrences.map(occurrence => occurrence.occurrenceId),
        before.occurrences.map(occurrence => occurrence.occurrenceId),
    );
    const splitOccurrence = after.occurrences.find(occurrence => (
        occurrence.occurrenceId.originalLogicalAnchor === '2026-10-12'
    ));
    assert.equal(splitOccurrence?.date, '2026-10-13');
    assert.equal(splitOccurrence?.segmentId, after.segments[1]!.segmentId);
    assert.equal(store.readSetupProjection().courses[0]?.meetings.length, 1);
    assert.equal(store.readSetupProjection().courses[0]?.meetings[0]?.weekday, 'TUE');
    await store.close();

    const reopened = requireReady(dataSlotsRoot);
    assert.deepEqual(readMeetingDetail(reopened, meetingSeriesId), after);
    await reopened.close();
});

test('TEST-PLAN-004: a retroactive future split replaces every later segment', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const meetingSeriesId = await seedMeetingSeries(store);
    const original = readMeetingDetail(store, meetingSeriesId);
    const firstSplit = await store.commit(confirmFutureChange(store, makeChangeCommand({
        meetingSeriesId,
        originalLogicalAnchor: '2026-10-12',
        scope: 'this-and-future',
    })));
    assert.equal(firstSplit.ok, true);

    const replacement = await store.commit(confirmFutureChange(store, makeChangeCommand({
        commandId: '13131313-1313-4313-8313-131313131313',
        followUpId: '24242424-2424-4424-8424-242424242424',
        expectedRevision: '3',
        expectedPlanVersion: '3',
        expectedMeetingSeriesVersion: '2',
        meetingSeriesId,
        originalLogicalAnchor: '2026-09-28',
        scope: 'this-and-future',
        localStart: '12:00',
    })));
    assert.equal(replacement.ok, true);

    const after = readMeetingDetail(store, meetingSeriesId);
    assert.equal(after.segments.length, 2);
    assert.equal(after.segments[0]?.logicalEndAnchor, '2026-09-21');
    assert.equal(after.segments[1]?.logicalStartAnchor, '2026-09-28');
    assert.equal(after.segments[1]?.logicalEndAnchor, null);
    assert.deepEqual(
        after.occurrences.filter(occurrence => (
            occurrence.occurrenceId.originalLogicalAnchor < '2026-09-28'
        )),
        original.occurrences.filter(occurrence => (
            occurrence.occurrenceId.originalLogicalAnchor < '2026-09-28'
        )),
    );
    assert.equal(
        after.occurrences.find(occurrence => (
            occurrence.occurrenceId.originalLogicalAnchor === '2026-10-12'
        ))?.localStart,
        '12:00',
    );
    await store.close();
});

test('TEST-PLAN-004: a future split takes effect at a target that had an only-this override', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const meetingSeriesId = await seedMeetingSeries(store);
    const onlyThis = await store.commit(makeChangeCommand({ meetingSeriesId }));
    assert.equal(onlyThis.ok, true);
    const unconfirmed = makeChangeCommand({
        commandId: 'bdbdbdbd-bdbd-4dbd-8dbd-bdbdbdbdbdbd',
        followUpId: 'cececece-cece-4ece-8ece-cececececece',
        expectedRevision: '3',
        expectedPlanVersion: '3',
        expectedMeetingSeriesVersion: '2',
        meetingSeriesId,
        scope: 'this-and-future',
        localStart: '12:00',
    });
    const blocked = await store.commit(unconfirmed);
    assert.equal(blocked.ok, false);
    if (blocked.ok) {
        throw new Error('Expected future split to require a preview');
    }
    assert.equal(blocked.problem.code, 'decision-required');
    assert.equal(store.receipt(unconfirmed.commandId), null);
    assert.equal(store.readSetupProjection().workspaceRevision, '3');

    const requestedWindow = { startDate: '2026-09-20', endDate: '2026-10-31' };
    const impact = store.previewMeetingOccurrenceChange({
        scope: 'this-and-future',
        meetingSeriesId,
        originalLogicalAnchor: unconfirmed.intent.payload.originalLogicalAnchor,
        replacement: unconfirmed.intent.payload.replacement,
        requestedWindow,
    });
    assert.equal(isMeetingOccurrenceImpactProjection(impact), true);
    assert.equal(impact.basedOnRevision, '3');
    assert.deepEqual(impact.affectedEntities, [{
        kind: 'meeting-series',
        id: meetingSeriesId,
        version: '2',
    }]);
    assert.equal(impact.effects[0].targetOverrideAction, 'clear');
    assert.equal(impact.effects[0].laterOverrideAction, 'retain');
    assert.deepEqual(impact.warnings.map(warning => warning.code), [
        'preview-window-truncated-history',
        'preview-window-truncated-future',
        'target-override-will-be-cleared',
    ]);
    assert.deepEqual(impact.recoverability, {
        kind: 'permanent',
        reason: 'meeting-rule-split-has-no-undo',
    });
    assert.deepEqual(impact.unresolvedReferences, []);
    assert.equal(impact.futureOverrideCount, '1');
    assert.equal(impact.currentFutureOccurrences[0]?.localStart, '11:00');
    assert.equal(impact.currentFutureOccurrences[0]?.overrideKind, 'replaced');
    assert.equal(impact.futureOccurrencesAfterChange[0]?.localStart, '12:00');
    assert.equal(impact.futureOccurrencesAfterChange[0]?.overrideKind, null);
    assert.equal(isMeetingOccurrenceImpactProjection({
        ...impact,
        replacement: null,
    }), false);
    assert.equal(isMeetingOccurrenceImpactProjection({
        ...impact,
        futureOccurrencesAfterChange: [
            impact.futureOccurrencesAfterChange[0]!,
            impact.futureOccurrencesAfterChange[0]!,
        ],
    }), false);
    assert.equal(isMeetingOccurrenceImpactProjection({
        ...impact,
        futureOccurrencesAfterChange: new Array(impact.futureOccurrencesAfterChange.length),
    }), false);
    assert.equal(isMeetingOccurrenceImpactProjection({
        ...impact,
        effects: [{ ...impact.effects[0], targetOverrideAction: 'none' }],
    }), false);
    assert.equal(isMeetingOccurrenceImpactProjection({
        ...impact,
        warnings: impact.warnings.filter(warning => (
            warning.code !== 'target-override-will-be-cleared'
        )),
    }), false);
    assert.equal(isMeetingOccurrenceImpactProjection({
        ...impact,
        historyOutsideRequestedWindow: false,
    }), false);
    assert.equal(isMeetingOccurrenceImpactProjection({
        ...impact,
        targetDateAfterChange: '2026-09-30',
    }), false);
    assert.equal(isMeetingOccurrenceImpactProjection({
        ...impact,
        affectedFutureSegmentCount: '0',
        effects: [{ ...impact.effects[0], affectedFutureSegmentCount: '0' }],
    }), false);
    assert.equal(isMeetingOccurrenceImpactProjection({
        ...impact,
        currentFutureOccurrences: impact.currentFutureOccurrences.filter(occurrence => (
            occurrence.occurrenceId.originalLogicalAnchor !== impact.originalLogicalAnchor
        )),
    }), false);
    assert.equal(isMeetingOccurrenceImpactProjection({
        ...impact,
        currentFutureOccurrences: impact.currentFutureOccurrences.map(occurrence => (
            occurrence.occurrenceId.originalLogicalAnchor === impact.originalLogicalAnchor
                ? { ...occurrence, overrideKind: null }
                : occurrence
        )),
    }), false);
    assert.equal(isMeetingOccurrenceImpactProjection({
        ...impact,
        futureOccurrencesAfterChange: impact.futureOccurrencesAfterChange.filter(occurrence => (
            occurrence.occurrenceId.originalLogicalAnchor !== impact.originalLogicalAnchor
        )),
    }), false);
    assert.equal(isMeetingOccurrenceImpactProjection({
        ...impact,
        futureOccurrencesAfterChange: impact.futureOccurrencesAfterChange.map(occurrence => (
            occurrence.occurrenceId.originalLogicalAnchor === impact.originalLogicalAnchor
                ? { ...occurrence, localStart: '08:00' }
                : occurrence
        )),
    }), false);
    assert.doesNotThrow(() => {
        assert.equal(isMeetingOccurrenceImpactProjection({
            ...impact,
            futureOccurrencesAfterChange: impact.futureOccurrencesAfterChange.map((occurrence, index) => (
                index === 0 ? { ...occurrence, weekday: 'BAD' } : occurrence
            )),
        }), false);
    });

    const invalidDetail = readMeetingDetail(store, meetingSeriesId);
    assert.equal(isMeetingSeriesDetailProjection({
        ...invalidDetail,
        occurrences: invalidDetail.occurrences.map((occurrence, index) => (
            index === 0 ? { ...occurrence, location: null } : occurrence
        )),
    }), false);
    assert.equal(isMeetingSeriesDetailProjection({
        ...invalidDetail,
        occurrences: invalidDetail.occurrences.map((occurrence, index) => (
            index === 0 ? { ...occurrence, date: '2027-01-01' } : occurrence
        )),
    }), false);
    const cyclicLocation: Record<string, unknown> = { kind: 'known', value: 'BA 1170' };
    cyclicLocation.self = cyclicLocation;
    assert.doesNotThrow(() => {
        assert.equal(isMeetingOccurrenceImpactProjection({
            ...impact,
            replacement: { ...impact.replacement, location: cyclicLocation },
        }), false);
    });
    const prototypeLessOccurrences = [...impact.futureOccurrencesAfterChange];
    Object.setPrototypeOf(prototypeLessOccurrences, null);
    assert.doesNotThrow(() => {
        assert.equal(isMeetingOccurrenceImpactProjection({
            ...impact,
            futureOccurrencesAfterChange: prototypeLessOccurrences,
        }), false);
    });
    assert.notEqual(
        store.previewMeetingOccurrenceChange({
            ...unconfirmed.intent.payload,
            scope: 'this-and-future',
            requestedWindow: FALL_WINDOW,
        }).confirmationToken,
        impact.confirmationToken,
    );

    const tampered = normalizeChangeMeetingOccurrenceCommand({
        ...unconfirmed,
        confirmationToken: '0'.repeat(64),
        impactWindow: requestedWindow,
    });
    const rejectedTamper = await store.commit(tampered);
    assert.equal(rejectedTamper.ok, false);
    if (rejectedTamper.ok) {
        throw new Error('Expected a tampered confirmation token to be rejected');
    }
    assert.equal(rejectedTamper.problem.code, 'decision-required');
    assert.equal(store.receipt(tampered.commandId), null);

    const confirmed = normalizeChangeMeetingOccurrenceCommand({
        ...unconfirmed,
        confirmationToken: impact.confirmationToken,
        impactWindow: impact.requestedWindow,
    });
    const future = await store.commit(confirmed);
    assert.equal(future.ok, true);

    const after = readMeetingDetail(store, meetingSeriesId);
    const target = after.occurrences.find(occurrence => (
        occurrence.occurrenceId.originalLogicalAnchor === '2026-09-28'
    ));
    assert.equal(target?.localStart, '12:00');
    assert.equal(target?.overrideKind, null);
    assert.equal(after.occurrences.find(occurrence => (
        occurrence.occurrenceId.originalLogicalAnchor === '2026-10-05'
    ))?.localStart, '12:00');
    assert.equal(isMeetingSeriesDetailProjection(after), true);
    assert.equal(isMeetingSeriesDetailProjection({
        ...after,
        segments: after.segments.map((segment, index) => (
            index === 1
                ? { ...segment, logicalStartAnchor: after.segments[0]!.logicalStartAnchor }
                : segment
        )),
    }), false);
    const occurrenceOnNewSegment = after.occurrences.find(occurrence => (
        occurrence.occurrenceId.originalLogicalAnchor >= '2026-09-28'
    ))!;
    assert.equal(isMeetingSeriesDetailProjection({
        ...after,
        occurrences: after.occurrences.map(occurrence => (
            occurrence === occurrenceOnNewSegment
                ? { ...occurrence, segmentId: after.segments[0]!.segmentId }
                : occurrence
        )),
    }), false);
    await store.close();
});

test('ImpactPreview truncation flags require an actual matching occurrence outside the window', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const meetingSeriesId = await seedMeetingSeries(store, {
        startDate: '2026-09-06',
        endDate: '2026-09-15',
        weekday: 'MON',
    });

    const impact = store.previewMeetingOccurrenceChange({
        scope: 'this-and-future',
        meetingSeriesId,
        originalLogicalAnchor: '2026-09-07',
        replacement: {
            type: 'LEC',
            weekday: 'MON',
            localStart: '11:00',
            localEnd: '12:00',
            location: { kind: 'tba' },
        },
        requestedWindow: { startDate: '2026-09-07', endDate: '2026-09-14' },
    });

    assert.equal(impact.historyOutsideRequestedWindow, false);
    assert.equal(impact.futureOutsideRequestedWindow, false);
    assert.deepEqual(impact.warnings, []);

    const movedOutsideWindow = await store.commit(makeChangeCommand({
        meetingSeriesId,
        originalLogicalAnchor: '2026-09-14',
        weekday: 'TUE',
    }));
    assert.equal(movedOutsideWindow.ok, true);
    const impactWithRetainedOverride = store.previewMeetingOccurrenceChange({
        scope: 'this-and-future',
        meetingSeriesId,
        originalLogicalAnchor: '2026-09-07',
        replacement: impact.replacement,
        requestedWindow: impact.requestedWindow,
    });
    assert.equal(impactWithRetainedOverride.futureOverrideCount, '1');
    assert.equal(impactWithRetainedOverride.futureOutsideRequestedWindow, true);
    assert.deepEqual(impactWithRetainedOverride.warnings, [
        { code: 'preview-window-truncated-future' },
    ]);

    const movedInsideWindow = await store.commit(makeChangeCommand({
        commandId: '91919191-9191-4191-8191-919191919191',
        followUpId: '92929292-9292-4292-8292-929292929292',
        expectedRevision: '3',
        expectedPlanVersion: '3',
        expectedMeetingSeriesVersion: '2',
        meetingSeriesId,
        originalLogicalAnchor: '2026-09-14',
        weekday: 'SUN',
    }));
    assert.equal(movedInsideWindow.ok, true);
    const impactWithOverrideInside = store.previewMeetingOccurrenceChange({
        scope: 'this-and-future',
        meetingSeriesId,
        originalLogicalAnchor: '2026-09-07',
        replacement: impact.replacement,
        requestedWindow: { startDate: '2026-09-07', endDate: '2026-09-13' },
    });
    assert.equal(impactWithOverrideInside.futureOutsideRequestedWindow, false);
    assert.deepEqual(impactWithOverrideInside.warnings, []);
    await store.close();
});

test('FLOW-01: a stale future-impact token is decision-required and leaves facts unchanged', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const meetingSeriesId = await seedMeetingSeries(store);
    const command = makeChangeCommand({
        commandId: 'dfdfdfdf-dfdf-4fdf-8fdf-dfdfdfdfdfdf',
        followUpId: 'e0e0e0e0-e0e0-40e0-80e0-e0e0e0e0e0e0',
        meetingSeriesId,
        originalLogicalAnchor: '2026-10-12',
        scope: 'this-and-future',
    });
    const impact = store.previewMeetingOccurrenceChange({
        ...command.intent.payload,
        scope: 'this-and-future',
        requestedWindow: FALL_WINDOW,
    });
    const confirmed = normalizeChangeMeetingOccurrenceCommand({
        ...command,
        confirmationToken: impact.confirmationToken,
        impactWindow: impact.requestedWindow,
    });
    const term = store.readSetupProjection().currentTerm!;
    const changedRange = await store.commit(normalizeUpdateTermEndDateCommand({
        commandId: 'f1f1f1f1-f1f1-41f1-81f1-f1f1f1f1f1f1',
        followUpId: '02020202-0202-4202-8202-020202020202',
        expectedRevision: '2',
        expectedPlanVersion: '2',
        expectedTermVersion: term.entityVersion,
        intent: {
            kind: 'plan.update-term-end-date',
            intentSchemaVersion: 1,
            payload: { termId: term.termId, endDate: '2026-12-19' },
        },
    }));
    assert.equal(changedRange.ok, true);

    const stale = await store.commit(confirmed);

    assert.equal(stale.ok, false);
    if (stale.ok) {
        throw new Error('Expected stale impact confirmation to be rejected');
    }
    assert.equal(stale.problem.code, 'decision-required');
    assert.equal(store.receipt(confirmed.commandId), null);
    assert.equal(store.readSetupProjection().workspaceRevision, '3');
    assert.equal(store.readProtectionWatermark(), '3');
    assert.equal(readMeetingDetail(store, meetingSeriesId).segments.length, 1);
    await store.close();
});

test('A-COURSE-007: a shortened inherited range rejects writes to a dormant occurrence', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const meetingSeriesId = await seedMeetingSeries(store);
    const term = store.readSetupProjection().currentTerm!;
    const shortened = await store.commit(normalizeUpdateTermEndDateCommand({
        commandId: '35353535-3535-4535-8535-353535353535',
        followUpId: '46464646-4646-4646-8646-464646464646',
        expectedRevision: '2',
        expectedPlanVersion: '2',
        expectedTermVersion: term.entityVersion,
        intent: {
            kind: 'plan.update-term-end-date',
            intentSchemaVersion: 1,
            payload: { termId: term.termId, endDate: '2026-10-09' },
        },
    }));
    assert.equal(shortened.ok, true);
    const command = makeChangeCommand({
        commandId: '57575757-5757-4757-8757-575757575757',
        followUpId: '68686868-6868-4868-8868-686868686868',
        expectedRevision: '3',
        expectedPlanVersion: '3',
        meetingSeriesId,
        originalLogicalAnchor: '2026-12-14',
    });

    await assert.rejects(store.commit(command), TypeError);
    assert.equal(store.receipt(command.commandId), null);
    assert.equal(store.readSetupProjection().workspaceRevision, '3');
    assert.equal(store.readSetupProjection().planEntityVersion, '3');
    assert.equal(store.readProtectionWatermark(), '3');
    assert.equal(readMeetingDetail(store, meetingSeriesId).occurrences.length, 4);
    await store.close();
});

test('TEST-PLAN-004/005: a future override sleeps outside a shortened range and revives by tuple ID', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const meetingSeriesId = await seedMeetingSeries(store);
    const changed = await store.commit(makeChangeCommand({
        meetingSeriesId,
        originalLogicalAnchor: '2026-12-14',
    }));
    assert.equal(changed.ok, true);
    const changedOccurrence = readMeetingDetail(store, meetingSeriesId).occurrences.find(occurrence => (
        occurrence.occurrenceId.originalLogicalAnchor === '2026-12-14'
    ))!;
    const term = store.readSetupProjection().currentTerm!;
    const shortened = await store.commit(normalizeUpdateTermEndDateCommand({
        commandId: '79797979-7979-4979-8979-797979797979',
        followUpId: '8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a',
        expectedRevision: '3',
        expectedPlanVersion: '3',
        expectedTermVersion: term.entityVersion,
        intent: {
            kind: 'plan.update-term-end-date',
            intentSchemaVersion: 1,
            payload: { termId: term.termId, endDate: '2026-10-09' },
        },
    }));
    assert.equal(shortened.ok, true);
    assert.equal(readMeetingDetail(store, meetingSeriesId).occurrences.some(occurrence => (
        occurrence.occurrenceId.originalLogicalAnchor === '2026-12-14'
    )), false);

    const extended = await store.commit(normalizeUpdateTermEndDateCommand({
        commandId: '9b9b9b9b-9b9b-4b9b-8b9b-9b9b9b9b9b9b',
        followUpId: 'acacacac-acac-4cac-8cac-acacacacacac',
        expectedRevision: '4',
        expectedPlanVersion: '4',
        expectedTermVersion: '2',
        intent: {
            kind: 'plan.update-term-end-date',
            intentSchemaVersion: 1,
            payload: { termId: term.termId, endDate: '2026-12-25' },
        },
    }));
    assert.equal(extended.ok, true);
    const revived = readMeetingDetail(store, meetingSeriesId).occurrences.find(occurrence => (
        occurrence.occurrenceId.originalLogicalAnchor === '2026-12-14'
    ));
    assert.deepEqual(revived?.occurrenceId, changedOccurrence.occurrenceId);
    assert.equal(revived?.overrideKind, 'replaced');
    assert.equal(revived?.localStart, changedOccurrence.localStart);
    await store.close();
});

test('TEST-PLAN-005: range membership follows the canonical rule anchor, not an override date', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const meetingSeriesId = await seedMeetingSeries(store);
    const changed = await store.commit(makeChangeCommand({
        meetingSeriesId,
        originalLogicalAnchor: '2026-10-12',
        weekday: 'SUN',
    }));
    assert.equal(changed.ok, true);
    const term = store.readSetupProjection().currentTerm!;
    const shortened = await store.commit(normalizeUpdateTermEndDateCommand({
        commandId: '14141414-1414-4414-8414-141414141414',
        followUpId: '25252525-2525-4525-8525-252525252525',
        expectedRevision: '3',
        expectedPlanVersion: '3',
        expectedTermVersion: term.entityVersion,
        intent: {
            kind: 'plan.update-term-end-date',
            intentSchemaVersion: 1,
            payload: { termId: term.termId, endDate: '2026-10-11' },
        },
    }));
    assert.equal(shortened.ok, true);
    assert.equal(readMeetingDetail(store, meetingSeriesId).occurrences.some(occurrence => (
        occurrence.occurrenceId.originalLogicalAnchor === '2026-10-12'
    )), false);
    const cancel = normalizeCancelMeetingOccurrenceCommand({
        commandId: '36363636-3636-4636-8636-363636363636',
        followUpId: '47474747-4747-4747-8747-474747474747',
        expectedRevision: '4',
        expectedPlanVersion: '4',
        expectedMeetingSeriesVersion: '2',
        intent: {
            kind: 'plan.cancel-meeting-occurrence',
            intentSchemaVersion: 1,
            payload: { meetingSeriesId, originalLogicalAnchor: '2026-10-12' },
        },
    });

    await assert.rejects(store.commit(cancel), TypeError);
    assert.equal(store.receipt(cancel.commandId), null);
    assert.equal(store.readSetupProjection().workspaceRevision, '4');
    assert.equal(store.readProtectionWatermark(), '4');
    await store.close();
});

test('A-COURSE-005: cancelling only-this stores a target-only cancellation override', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const meetingSeriesId = await seedMeetingSeries(store);
    const before = readMeetingDetail(store, meetingSeriesId);
    const command = normalizeCancelMeetingOccurrenceCommand({
        commandId: '99999999-9999-4999-8999-999999999999',
        followUpId: 'abababab-abab-4bab-8bab-abababababab',
        expectedRevision: '2',
        expectedPlanVersion: '2',
        expectedMeetingSeriesVersion: '1',
        intent: {
            kind: 'plan.cancel-meeting-occurrence',
            intentSchemaVersion: 1,
            payload: {
                meetingSeriesId,
                originalLogicalAnchor: '2026-10-05',
            },
        },
    });

    const committed = await store.commit(command);

    assert.equal(committed.ok, true);
    if (!committed.ok) {
        throw new Error('Expected cancellation to commit');
    }
    assert.deepEqual(committed.value.effects, [{
        code: 'plan.meeting-occurrence-cancelled',
        entity: { kind: 'meeting-series', id: meetingSeriesId, version: '2' },
    }]);
    const after = readMeetingDetail(store, meetingSeriesId);
    const target = after.occurrences.find(occurrence => (
        occurrence.occurrenceId.originalLogicalAnchor === '2026-10-05'
    ));
    assert.equal(target?.status, 'cancelled');
    assert.equal(target?.overrideKind, 'cancelled');
    assert.deepEqual(target?.occurrenceId, {
        meetingSeriesId,
        originalLogicalAnchor: '2026-10-05',
    });
    assert.deepEqual(
        after.occurrences.filter(occurrence => occurrence.occurrenceId.originalLogicalAnchor !== '2026-10-05'),
        before.occurrences.filter(occurrence => occurrence.occurrenceId.originalLogicalAnchor !== '2026-10-05'),
    );
    await store.close();
});

test('FLOW-01: occurrence pre-COMMIT failure rolls back override, receipt, versions, and watermark', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const meetingSeriesId = await seedMeetingSeries(store);
    const before = readMeetingDetail(store, meetingSeriesId);
    const command = makeChangeCommand({ meetingSeriesId });

    await assert.rejects(store.commit(command, {
        failpoint(point) {
            if (point === 'commit.after-facts') {
                throw new Error('injected occurrence failure');
            }
        },
    }));

    assert.deepEqual(readMeetingDetail(store, meetingSeriesId), before);
    assert.equal(store.receipt(command.commandId), null);
    assert.equal(store.readSetupProjection().workspaceRevision, '2');
    assert.equal(store.readSetupProjection().planEntityVersion, '2');
    assert.equal(store.readProtectionWatermark(), '2');
    await store.close();
});

test('FLOW-01/TEST-DATA-004: post-COMMIT loss recovers an occurrence receipt after reopen', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const meetingSeriesId = await seedMeetingSeries(store);
    const command = makeChangeCommand({ meetingSeriesId });

    await assert.rejects(store.commit(command, {
        failpoint(point) {
            if (point === 'commit.after-sqlite-commit') {
                throw new Error('lost occurrence response');
            }
        },
    }), CommittedCommandOutcomeUnknownError);
    await store.close();

    const reopened = requireReady(dataSlotsRoot);
    const receipt = reopened.receipt(command.commandId);
    assert.equal(receipt?.revision, '3');
    assert.equal(receipt?.effects[0]?.code, 'plan.meeting-occurrence-changed');
    assert.deepEqual(await reopened.commit(command), { ok: true, value: receipt });
    assert.equal(
        readMeetingDetail(reopened, meetingSeriesId).occurrences
            .find(occurrence => occurrence.occurrenceId.originalLogicalAnchor === '2026-09-28')
            ?.overrideKind,
        'replaced',
    );
    await reopened.close();
});

test('TEST-DATA-005: read-only and stale-version occurrence changes remain unchanged', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const meetingSeriesId = await seedMeetingSeries(store);
    const stale = await store.commit(makeChangeCommand({
        commandId: '12121212-1212-4212-8212-121212121212',
        followUpId: '34343434-3434-4434-8434-343434343434',
        meetingSeriesId,
        expectedMeetingSeriesVersion: '0',
    }));
    assert.equal(stale.ok, false);
    if (stale.ok) {
        throw new Error('Expected stale series conflict');
    }
    assert.equal(stale.problem.code, 'conflict');
    if (stale.problem.code !== 'conflict') {
        throw new Error('Expected conflict problem');
    }
    assert.equal(stale.problem.details.reason, 'expected-entity-version');
    assert.deepEqual(stale.problem.context.entityVersions, [{
        kind: 'meeting-series',
        id: meetingSeriesId,
        version: '1',
    }]);
    await store.close();

    const opened = openWorkspaceData(dataSlotsRoot, { readOnly: true });
    assert.equal(opened.kind, 'read-only');
    if (opened.kind !== 'read-only') {
        throw new Error('Expected read-only DATA');
    }
    const command = makeChangeCommand({ meetingSeriesId });
    const rejected = await opened.store.commit(command);
    assert.equal(rejected.ok, false);
    if (rejected.ok) {
        throw new Error('Expected permission rejection');
    }
    assert.equal(rejected.problem.code, 'permission');
    assert.equal(readMeetingDetail(opened.store, meetingSeriesId).entityVersion, '1');
    assert.equal(opened.store.receipt(command.commandId), null);
    await opened.store.close();
});
