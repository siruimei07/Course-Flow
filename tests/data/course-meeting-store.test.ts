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
    type CreateCourseWithMeetingCommand,
    type MeetingLocation,
    type MeetingTypeCode,
} from '../../src/shared/workspace-course-contract';
import { normalizeCreateTermCommand } from '../../src/shared/workspace-term-contract';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const COURSE_COMMAND_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const COURSE_FOLLOW_UP_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function createTempDataSlots(t: test.TestContext): string {
    const dataSlotsRoot = mkdtempSync(join(tmpdir(), 'courseflow-course-'));
    t.after(() => rmSync(dataSlotsRoot, { recursive: true, force: true }));
    return dataSlotsRoot;
}

function makeCourseCommand(options: Readonly<{
    commandId?: string;
    followUpId?: string;
    expectedRevision?: string;
    expectedPlanVersion?: string;
    type?: MeetingTypeCode;
    location?: MeetingLocation;
    courseName?: string;
    effectiveStartDate?: string;
    effectiveEndDate?: string;
}> = {}): CreateCourseWithMeetingCommand {
    return normalizeCreateCourseWithMeetingCommand({
        commandId: options.commandId ?? COURSE_COMMAND_ID,
        followUpId: options.followUpId ?? COURSE_FOLLOW_UP_ID,
        expectedRevision: options.expectedRevision ?? '1',
        expectedPlanVersion: options.expectedPlanVersion ?? '1',
        intent: {
            kind: 'plan.create-course-with-first-meeting',
            intentSchemaVersion: 1,
            payload: {
                course: {
                    code: 'CSC108',
                    name: options.courseName ?? 'Introduction to Computer Programming',
                    section: 'LEC0101',
                    instructor: 'Ada Lovelace',
                    color: 'blue',
                    credits: '3',
                },
                meeting: {
                    type: options.type ?? 'LEC',
                    weekday: 'MON',
                    localStart: '09:00',
                    localEnd: '10:00',
                    effectiveStartDate: options.effectiveStartDate ?? '2026-09-08',
                    effectiveEndDate: options.effectiveEndDate ?? '2026-12-18',
                    location: options.location ?? { kind: 'known', value: 'BA 1170' },
                },
            },
        },
    });
}

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
                startDate: '2026-09-08',
                endDate: '2026-12-18',
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

function requireReady(dataSlotsRoot: string): SqliteDataStore {
    const opened = openWorkspaceData(dataSlotsRoot);
    assert.equal(opened.kind, 'ready');
    if (opened.kind !== 'ready') {
        throw new Error('Expected ready DATA');
    }
    return opened.store;
}

test('A-COURSE-001–004/FLOW-01: Course and first Meeting commit atomically in the Current Term', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const termId = await createCurrentTerm(store);

    const committed = await store.commit(makeCourseCommand());

    assert.equal(committed.ok, true);
    if (!committed.ok) {
        throw new Error('Expected Course/Meeting commit');
    }
    assert.equal(committed.value.revision, '2');
    assert.deepEqual(committed.value.effects.map(effect => effect.code), [
        'plan.course-created',
        'plan.meeting-series-created',
    ]);
    const courseId = committed.value.effects[0].entity.id;
    const meetingSeriesId = committed.value.effects[1].entity.id;
    const projection = store.readSetupProjection();
    assert.deepEqual(projection.courses, [{
        courseId,
        termId,
        code: 'CSC108',
        name: 'Introduction to Computer Programming',
        section: 'LEC0101',
        instructor: 'Ada Lovelace',
        color: 'blue',
        credits: '3',
        entityVersion: '1',
        meetings: [{
            meetingSeriesId,
            type: { code: 'LEC', name: 'Lecture' },
            weekday: 'MON',
            localStart: '09:00',
            localEnd: '10:00',
            effectiveStartDate: '2026-09-08',
            effectiveEndDate: '2026-12-18',
            location: { kind: 'known', value: 'BA 1170' },
            entityVersion: '1',
        }],
    }]);
    assert.equal(projection.workspaceRevision, '2');
    assert.equal(projection.planEntityVersion, '2');
    await store.close();
});

test('A-COURSE-003/TEST-PLAN-002: LEC, TUT, and PRA round-trip with understandable names', async (t) => {
    const names = { LEC: 'Lecture', TUT: 'Tutorial', PRA: 'Practical' } as const;

    for (const type of ['LEC', 'TUT', 'PRA'] as const) {
        await t.test(type, async (caseTest) => {
            const dataSlotsRoot = createTempDataSlots(caseTest);
            const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
            await createCurrentTerm(store);
            await store.commit(makeCourseCommand({ type }));
            assert.deepEqual(store.readSetupProjection().courses[0]?.meetings[0]?.type, {
                code: type,
                name: names[type],
            });
            await store.close();
        });
    }
});

test('Q-CONTINUITY-01: CourseId, MeetingSeriesId, fields, and TBA survive DATA reopen', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    await createCurrentTerm(store);
    const committed = await store.commit(makeCourseCommand({ location: { kind: 'tba' } }));
    assert.equal(committed.ok, true);
    if (!committed.ok) {
        throw new Error('Expected Course/Meeting commit');
    }
    const courseId = committed.value.effects[0].entity.id;
    const meetingSeriesId = committed.value.effects[1].entity.id;
    await store.close();

    const reopened = requireReady(dataSlotsRoot);
    const course = reopened.readSetupProjection().courses[0];
    assert.equal(course?.courseId, courseId);
    assert.equal(course?.meetings[0]?.meetingSeriesId, meetingSeriesId);
    assert.deepEqual(course?.meetings[0]?.location, { kind: 'tba' });
    assert.equal(course?.instructor, 'Ada Lovelace');
    await reopened.close();
});

test('TEST-DATA-002: matching CommandId replays while changed Course semantics conflict', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    await createCurrentTerm(store);
    const command = makeCourseCommand();
    const committed = await store.commit(command);

    assert.deepEqual(await store.commit(command), committed);
    const conflict = await store.commit(makeCourseCommand({ courseName: 'Changed meaning' }));
    assert.equal(conflict.ok, false);
    if (conflict.ok) {
        throw new Error('Expected CommandId conflict');
    }
    assert.equal(conflict.problem.details.reason, 'command-id-reused');
    assert.equal(store.readSetupProjection().courses.length, 1);
    assert.equal(store.readSetupProjection().workspaceRevision, '2');
    await store.close();
});

test('TEST-DATA-001: pre-COMMIT failure leaves no Course, Meeting, receipt, revision, or watermark', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    await createCurrentTerm(store);

    await assert.rejects(store.commit(makeCourseCommand(), {
        failpoint(point) {
            if (point === 'commit.after-facts') {
                throw new Error('injected pre-COMMIT failure');
            }
        },
    }));

    assert.equal(store.readSetupProjection().courses.length, 0);
    assert.equal(store.readSetupProjection().workspaceRevision, '1');
    assert.equal(store.readSetupProjection().planEntityVersion, '1');
    assert.equal(store.receipt(COURSE_COMMAND_ID), null);
    assert.equal(store.readProtectionWatermark(), '1');
    await store.close();
});

test('TEST-DATA-004: post-COMMIT response loss converges through both effects after reopen', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    await createCurrentTerm(store);

    await assert.rejects(store.commit(makeCourseCommand(), {
        failpoint(point) {
            if (point === 'commit.after-sqlite-commit') {
                throw new Error('response lost');
            }
        },
    }));
    await store.close();

    const reopened = requireReady(dataSlotsRoot);
    const receipt = reopened.receipt(COURSE_COMMAND_ID);
    assert.equal(receipt?.revision, '2');
    assert.equal(receipt?.effects.length, 2);
    assert.equal(reopened.readSetupProjection().courses[0]?.courseId, receipt?.effects[0]?.entity.id);
    assert.equal(
        reopened.readSetupProjection().courses[0]?.meetings[0]?.meetingSeriesId,
        receipt?.effects[1]?.entity.id,
    );
    assert.deepEqual(await reopened.commit(makeCourseCommand()), { ok: true, value: receipt });
    await reopened.close();
});

test('TEST-PLAN-001: Meeting range outside Current Term changes no persistent fact', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    await createCurrentTerm(store);

    await assert.rejects(store.commit(makeCourseCommand({ effectiveStartDate: '2026-09-07' })), TypeError);
    assert.equal(store.readSetupProjection().courses.length, 0);
    assert.equal(store.readSetupProjection().workspaceRevision, '1');
    assert.equal(store.receipt(COURSE_COMMAND_ID), null);
    await store.close();
});

test('TEST-PLAN-001/007: end <= start is rejected before a DATA transaction begins', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    await createCurrentTerm(store);
    const command = makeCourseCommand();
    let enteredTransaction = false;

    assert.throws(() => store.commit({
        ...command,
        intent: {
            ...command.intent,
            payload: {
                ...command.intent.payload,
                meeting: {
                    ...command.intent.payload.meeting,
                    localEnd: command.intent.payload.meeting.localStart,
                },
            },
        },
    }, {
        failpoint(point) {
            enteredTransaction = point === 'commit.after-begin';
        },
    }), TypeError);
    assert.equal(enteredTransaction, false);
    assert.equal(store.readSetupProjection().workspaceRevision, '1');
    assert.equal(store.readSetupProjection().courses.length, 0);
    assert.equal(store.receipt(COURSE_COMMAND_ID), null);
    await store.close();
});

test('TEST-DATA-005: read-only DATA rejects Course/Meeting without claiming success', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const initialized = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    await createCurrentTerm(initialized);
    await initialized.close();
    const opened = openWorkspaceData(dataSlotsRoot, { readOnly: true });
    assert.equal(opened.kind, 'read-only');
    if (opened.kind !== 'read-only') {
        throw new Error('Expected read-only DATA');
    }

    const rejected = await opened.store.commit(makeCourseCommand());
    assert.equal(rejected.ok, false);
    if (rejected.ok) {
        throw new Error('Expected read-only rejection');
    }
    assert.equal(rejected.problem.code, 'permission');
    assert.equal(rejected.problem.dataEffect, 'unchanged');
    assert.equal(opened.store.readSetupProjection().courses.length, 0);
    await opened.store.close();
});

test('Q-CONSIST-01: Term, Course, and Meeting are materialized from one ReadSnapshot', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    await createCurrentTerm(store);
    const pending = store.commit(makeCourseCommand());
    let crossedSnapshotSeam = false;

    const beforeCommit = store.readSetupProjection({
        failpoint(point) {
            crossedSnapshotSeam = point === 'read.after-revision';
        },
    });

    assert.equal(crossedSnapshotSeam, true);
    assert.equal(beforeCommit.workspaceRevision, '1');
    assert.equal(beforeCommit.courses.length, 0);
    assert.equal((await pending).ok, true);
    const afterCommit = store.readSetupProjection();
    assert.equal(afterCommit.workspaceRevision, '2');
    assert.equal(afterCommit.courses.length, 1);
    assert.equal(afterCommit.courses[0]?.meetings.length, 1);
    await store.close();
});
