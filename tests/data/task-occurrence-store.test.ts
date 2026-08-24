/**
 * @file Specifies independent Task occurrence state, progress, Undo, and restart facts in DATA.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
import { normalizeCreateCourseWithMeetingCommand } from '../../src/shared/workspace-course-contract';
import { normalizeCreateHolidayRangeCommand } from '../../src/shared/workspace-holiday-contract';
import {
    normalizeChangeTaskOccurrenceCommand,
    normalizeCreateTaskCommand,
    normalizeDeleteTaskOccurrenceOrSeriesCommand,
    normalizeSetTaskOccurrenceStatusCommand,
    normalizeSetTaskProgressCommand,
    normalizeUndoTaskOccurrenceStateCommand,
    normalizeUpdateTaskCommand,
    type TaskCommand,
} from '../../src/shared/workspace-task-contract';
import { normalizeCreateTermCommand } from '../../src/shared/workspace-term-contract';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const WINDOW = Object.freeze({ startDate: '2026-09-01', endDate: '2026-09-30' });

/**
 * Creates an isolated DATA root and registers cleanup.
 * @param {test.TestContext} t - Owning Node test context.
 * @return {string} Fresh DATA slots root.
 */
function createTempDataSlots(t: test.TestContext): string {
    const root = mkdtempSync(join(tmpdir(), 'courseflow-task-occurrence-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    return root;
}

/**
 * Commits a normalized Task command and returns its durable committed outcome.
 * @param {SqliteDataStore} store - Writable DATA store.
 * @param {TaskCommand} command - Canonical Task command.
 * @return {Promise<Extract<DataCommitResult, {ok: true}>['value']>} Receipt outcome.
 */
async function commitTask(store: SqliteDataStore, command: TaskCommand) {
    const result = await store.commit(command);
    assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.problem));
    if (!result.ok) {
        throw new Error('Expected Task command to commit');
    }
    return result.value;
}

/**
 * Establishes one Current Term, Course, and large weekly Task.
 * @param {SqliteDataStore} store - Fresh writable DATA store.
 * @return {Promise<string>} Stable TaskSeriesId.
 */
async function createWeeklyTask(
    store: SqliteDataStore,
    followTeachingWeek = false,
): Promise<string> {
    const term = await store.commit(normalizeCreateTermCommand({
        commandId: randomUUID(),
        followUpId: randomUUID(),
        expectedRevision: '0',
        expectedPlanVersion: '0',
        intent: {
            kind: 'plan.create-term',
            intentSchemaVersion: 1,
            payload: {
                name: 'Occurrence Term',
                startDate: '2026-09-01',
                endDate: '2026-09-30',
                timeZone: 'America/Toronto',
            },
        },
    }));
    assert.equal(term.ok, true);
    const course = await store.commit(normalizeCreateCourseWithMeetingCommand({
        commandId: randomUUID(),
        followUpId: randomUUID(),
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
    assert.equal(course.ok, true);
    if (!course.ok) {
        throw new Error('Expected Course creation');
    }
    const created = await commitTask(store, normalizeCreateTaskCommand({
        commandId: randomUUID(),
        followUpId: randomUUID(),
        expectedRevision: '2',
        expectedPlanVersion: '2',
        intent: {
            kind: 'plan.create-task-series',
            intentSchemaVersion: 2,
            payload: {
                courseId: course.value.effects[0]!.entity.id,
                title: 'Weekly project checkpoint',
                size: 'large',
                schedule: {
                    kind: 'weekly',
                    startDate: '2026-09-05',
                    weekday: 'SAT',
                    localDeadlineTime: '17:00',
                    confirmedEndDate: '2026-09-19',
                    followTeachingWeek,
                },
            },
        },
    }));
    return created.effects[0]!.entity.id;
}

/**
 * Builds current optimistic versions for one Task series.
 * @param {SqliteDataStore} store - DATA store with the series.
 * @param {string} taskSeriesId - Stable Task series identity.
 * @return {object} Current Workspace, PLAN, and Task versions.
 */
function currentTaskVersions(store: SqliteDataStore, taskSeriesId: string) {
    const detail = store.readTaskSeriesDetail(taskSeriesId, WINDOW);
    return {
        expectedRevision: detail.workspaceRevision,
        expectedPlanVersion: detail.planEntityVersion,
        expectedTaskSeriesVersion: detail.entityVersion,
    };
}

test('A-TASK-005/008/009: occurrences keep independent state, progress, Undo, and restart facts', async t => {
    const root = createTempDataSlots(t);
    let store = initializeWorkspaceData(root, WORKSPACE_ID);
    const taskSeriesId = await createWeeklyTask(store);
    const initial = store.readTaskSeriesDetail(taskSeriesId, WINDOW);
    const [first, second, third] = initial.occurrences;
    assert.deepEqual(initial.occurrences.map(occurrence => ({
        anchor: occurrence.occurrenceId.originalLogicalAnchor,
        status: occurrence.status,
        reportedProgress: occurrence.reportedProgress,
        displayProgress: occurrence.displayProgress,
    })), [
        { anchor: '2026-09-05', status: 'pending', reportedProgress: null, displayProgress: null },
        { anchor: '2026-09-12', status: 'pending', reportedProgress: null, displayProgress: null },
        { anchor: '2026-09-19', status: 'pending', reportedProgress: null, displayProgress: null },
    ]);

    await commitTask(store, normalizeChangeTaskOccurrenceCommand({
        commandId: randomUUID(),
        followUpId: randomUUID(),
        confirmationToken: null,
        impactWindow: null,
        ...currentTaskVersions(store, taskSeriesId),
        intent: {
            kind: 'plan.change-task-occurrence',
            intentSchemaVersion: 1,
            payload: {
                taskSeriesId,
                originalLogicalAnchor: '2026-09-19',
                scope: 'only-this',
                replacement: {
                    title: third!.title,
                    size: 'small',
                    deadline: third!.deadline,
                },
            },
        },
    }));
    await assert.rejects(store.commit(normalizeSetTaskProgressCommand({
        commandId: randomUUID(),
        followUpId: randomUUID(),
        ...currentTaskVersions(store, taskSeriesId),
        intent: {
            kind: 'plan.set-task-progress',
            intentSchemaVersion: 1,
            payload: {
                taskSeriesId,
                originalLogicalAnchor: '2026-09-19',
                reportedProgress: 50,
            },
        },
    })), /pending large Task occurrence/);

    for (const [reportedProgress, expectedProgress] of [
        [0, 0],
        [100, 100],
        [null, null],
    ] as const) {
        await commitTask(store, normalizeSetTaskProgressCommand({
            commandId: randomUUID(),
            followUpId: randomUUID(),
            ...currentTaskVersions(store, taskSeriesId),
            intent: {
                kind: 'plan.set-task-progress',
                intentSchemaVersion: 1,
                payload: {
                    taskSeriesId,
                    originalLogicalAnchor: '2026-09-05',
                    reportedProgress,
                },
            },
        }));
        const projected = store.readTaskSeriesDetail(taskSeriesId, WINDOW).occurrences[0]!;
        assert.equal(projected.reportedProgress, expectedProgress);
        assert.equal(projected.displayProgress, expectedProgress);
    }

    await commitTask(store, normalizeSetTaskProgressCommand({
        commandId: randomUUID(),
        followUpId: randomUUID(),
        ...currentTaskVersions(store, taskSeriesId),
        intent: {
            kind: 'plan.set-task-progress',
            intentSchemaVersion: 1,
            payload: {
                taskSeriesId,
                originalLogicalAnchor: '2026-09-05',
                reportedProgress: 40,
            },
        },
    }));
    const completed = await commitTask(store, normalizeSetTaskOccurrenceStatusCommand({
        commandId: randomUUID(),
        followUpId: randomUUID(),
        ...currentTaskVersions(store, taskSeriesId),
        intent: {
            kind: 'plan.set-task-occurrence-status',
            intentSchemaVersion: 2,
            payload: {
                taskSeriesId,
                originalLogicalAnchor: '2026-09-05',
                status: 'completed',
            },
        },
    }));
    assert.ok(completed.undoCapability);
    await assert.rejects(store.commit(normalizeSetTaskProgressCommand({
        commandId: randomUUID(),
        followUpId: randomUUID(),
        ...currentTaskVersions(store, taskSeriesId),
        intent: {
            kind: 'plan.set-task-progress',
            intentSchemaVersion: 1,
            payload: {
                taskSeriesId,
                originalLogicalAnchor: '2026-09-05',
                reportedProgress: 50,
            },
        },
    })), /pending large Task occurrence/);
    await commitTask(store, normalizeSetTaskOccurrenceStatusCommand({
        commandId: randomUUID(),
        followUpId: randomUUID(),
        ...currentTaskVersions(store, taskSeriesId),
        intent: {
            kind: 'plan.set-task-occurrence-status',
            intentSchemaVersion: 2,
            payload: {
                taskSeriesId,
                originalLogicalAnchor: '2026-09-12',
                status: 'skipped',
            },
        },
    }));
    let detail = store.readTaskSeriesDetail(taskSeriesId, WINDOW);
    assert.deepEqual(detail.occurrences.map(occurrence => ({
        status: occurrence.status,
        reportedProgress: occurrence.reportedProgress,
        displayProgress: occurrence.displayProgress,
    })), [
        { status: 'completed', reportedProgress: 40, displayProgress: 100 },
        { status: 'skipped', reportedProgress: null, displayProgress: null },
        { status: 'pending', reportedProgress: null, displayProgress: null },
    ]);
    assert.deepEqual(detail.occurrences.map(occurrence => occurrence.occurrenceId), [
        first!.occurrenceId,
        second!.occurrenceId,
        third!.occurrenceId,
    ]);

    await commitTask(store, normalizeSetTaskOccurrenceStatusCommand({
        commandId: randomUUID(),
        followUpId: randomUUID(),
        ...currentTaskVersions(store, taskSeriesId),
        intent: {
            kind: 'plan.set-task-occurrence-status',
            intentSchemaVersion: 2,
            payload: {
                taskSeriesId,
                originalLogicalAnchor: '2026-09-12',
                status: 'pending',
            },
        },
    }));
    assert.equal(store.readTaskSeriesDetail(taskSeriesId, WINDOW).occurrences[1]!.status, 'pending');
    await commitTask(store, normalizeSetTaskOccurrenceStatusCommand({
        commandId: randomUUID(),
        followUpId: randomUUID(),
        ...currentTaskVersions(store, taskSeriesId),
        intent: {
            kind: 'plan.set-task-occurrence-status',
            intentSchemaVersion: 2,
            payload: {
                taskSeriesId,
                originalLogicalAnchor: '2026-09-12',
                status: 'skipped',
            },
        },
    }));

    await commitTask(store, normalizeSetTaskOccurrenceStatusCommand({
        commandId: randomUUID(),
        followUpId: randomUUID(),
        ...currentTaskVersions(store, taskSeriesId),
        intent: {
            kind: 'plan.set-task-occurrence-status',
            intentSchemaVersion: 2,
            payload: {
                taskSeriesId,
                originalLogicalAnchor: '2026-09-05',
                status: 'pending',
            },
        },
    }));
    detail = store.readTaskSeriesDetail(taskSeriesId, WINDOW);
    assert.deepEqual(detail.occurrences[0], {
        ...detail.occurrences[0],
        occurrenceId: first!.occurrenceId,
        status: 'pending',
        reportedProgress: 40,
        displayProgress: 40,
    });

    const progressed = await commitTask(store, normalizeSetTaskProgressCommand({
        commandId: randomUUID(),
        followUpId: randomUUID(),
        ...currentTaskVersions(store, taskSeriesId),
        intent: {
            kind: 'plan.set-task-progress',
            intentSchemaVersion: 1,
            payload: {
                taskSeriesId,
                originalLogicalAnchor: '2026-09-05',
                reportedProgress: 65,
            },
        },
    }));
    assert.ok(progressed.undoCapability);
    await commitTask(store, normalizeSetTaskOccurrenceStatusCommand({
        commandId: randomUUID(),
        followUpId: randomUUID(),
        ...currentTaskVersions(store, taskSeriesId),
        intent: {
            kind: 'plan.set-task-occurrence-status',
            intentSchemaVersion: 2,
            payload: {
                taskSeriesId,
                originalLogicalAnchor: '2026-09-19',
                status: 'skipped',
            },
        },
    }));
    const versionExpiredUndo = await store.commit(normalizeUndoTaskOccurrenceStateCommand({
        commandId: randomUUID(),
        followUpId: randomUUID(),
        ...currentTaskVersions(store, taskSeriesId),
        intent: {
            kind: 'plan.undo-task-occurrence-state',
            intentSchemaVersion: 1,
            payload: {
                token: progressed.undoCapability!.token,
                taskSeriesId,
                originalLogicalAnchor: '2026-09-05',
            },
        },
    }));
    assert.equal(versionExpiredUndo.ok, false);
    if (versionExpiredUndo.ok) {
        throw new Error('Expected version-bound Undo conflict');
    }
    assert.equal(versionExpiredUndo.problem.code, 'conflict');
    assert.equal(versionExpiredUndo.problem.dataEffect, 'unchanged');
    const latestProgress = await commitTask(store, normalizeSetTaskProgressCommand({
        commandId: randomUUID(),
        followUpId: randomUUID(),
        ...currentTaskVersions(store, taskSeriesId),
        intent: {
            kind: 'plan.set-task-progress',
            intentSchemaVersion: 1,
            payload: {
                taskSeriesId,
                originalLogicalAnchor: '2026-09-05',
                reportedProgress: 75,
            },
        },
    }));
    assert.ok(latestProgress.undoCapability);
    const undoCommand = normalizeUndoTaskOccurrenceStateCommand({
        commandId: randomUUID(),
        followUpId: randomUUID(),
        ...currentTaskVersions(store, taskSeriesId),
        intent: {
            kind: 'plan.undo-task-occurrence-state',
            intentSchemaVersion: 1,
            payload: {
                token: latestProgress.undoCapability!.token,
                taskSeriesId,
                originalLogicalAnchor: '2026-09-05',
            },
        },
    });
    const undone = await commitTask(store, undoCommand);
    assert.equal(undone.undoCapability ?? null, null);
    assert.deepEqual(await store.commit(undoCommand), { ok: true, value: undone });
    detail = store.readTaskSeriesDetail(taskSeriesId, WINDOW);
    assert.equal(detail.occurrences[0]?.reportedProgress, 65);
    assert.equal(detail.occurrences[0]?.displayProgress, 65);

    const reusedUndo = await store.commit(normalizeUndoTaskOccurrenceStateCommand({
        commandId: randomUUID(),
        followUpId: randomUUID(),
        ...currentTaskVersions(store, taskSeriesId),
        intent: {
            kind: 'plan.undo-task-occurrence-state',
            intentSchemaVersion: 1,
            payload: {
                token: latestProgress.undoCapability!.token,
                taskSeriesId,
                originalLogicalAnchor: '2026-09-05',
            },
        },
    }));
    assert.equal(reusedUndo.ok, false);
    if (reusedUndo.ok) {
        throw new Error('Expected one-time Undo conflict');
    }
    assert.equal(reusedUndo.problem.code, 'conflict');
    assert.equal(reusedUndo.problem.dataEffect, 'unchanged');

    await store.close();
    const reopened = openWorkspaceData(root);
    assert.equal(reopened.kind, 'ready');
    if (reopened.kind !== 'ready') {
        throw new Error('Expected restart to reopen DATA');
    }
    store = reopened.store;
    detail = store.readTaskSeriesDetail(taskSeriesId, WINDOW);
    assert.deepEqual(detail.occurrences.map(occurrence => ({
        id: occurrence.occurrenceId,
        status: occurrence.status,
        reportedProgress: occurrence.reportedProgress,
        displayProgress: occurrence.displayProgress,
    })), [
        { id: first!.occurrenceId, status: 'pending', reportedProgress: 65, displayProgress: 65 },
        { id: second!.occurrenceId, status: 'skipped', reportedProgress: null, displayProgress: null },
        { id: third!.occurrenceId, status: 'skipped', reportedProgress: null, displayProgress: null },
    ]);
    await store.close();
});

test('A-TASK-006: scoped changes preview, preserve segment identity, and never rewrite terminal history', async t => {
    const root = createTempDataSlots(t);
    let store = initializeWorkspaceData(root, WORKSPACE_ID);
    const taskSeriesId = await createWeeklyTask(store);
    const original = store.readTaskSeriesDetail(taskSeriesId, WINDOW);
    const originalSegmentId = original.segments[0]!.segmentId;
    const originalFirstId = original.occurrences[0]!.occurrenceId;
    const originalThird = original.occurrences[2]!;

    await commitTask(store, normalizeChangeTaskOccurrenceCommand({
        commandId: randomUUID(),
        followUpId: randomUUID(),
        confirmationToken: null,
        impactWindow: null,
        ...currentTaskVersions(store, taskSeriesId),
        intent: {
            kind: 'plan.change-task-occurrence',
            intentSchemaVersion: 1,
            payload: {
                taskSeriesId,
                originalLogicalAnchor: '2026-09-05',
                scope: 'only-this',
                replacement: {
                    title: 'One special checkpoint',
                    size: 'large',
                    deadline: { kind: 'date-only', date: '2026-09-06' },
                },
            },
        },
    }));
    let detail = store.readTaskSeriesDetail(taskSeriesId, WINDOW);
    assert.deepEqual(detail.occurrences[0]!.occurrenceId, originalFirstId);
    assert.equal(detail.occurrences[0]!.title, 'One special checkpoint');
    assert.equal(detail.occurrences[0]!.overrideKind, 'replaced');

    await commitTask(store, normalizeSetTaskOccurrenceStatusCommand({
        commandId: randomUUID(),
        followUpId: randomUUID(),
        ...currentTaskVersions(store, taskSeriesId),
        intent: {
            kind: 'plan.set-task-occurrence-status',
            intentSchemaVersion: 2,
            payload: {
                taskSeriesId,
                originalLogicalAnchor: '2026-09-19',
                status: 'completed',
            },
        },
    }));

    const impactDraft = Object.freeze({
        scope: 'this-and-future' as const,
        taskSeriesId,
        originalLogicalAnchor: '2026-09-12',
        action: 'change' as const,
        replacement: Object.freeze({
            title: 'Revised checkpoint',
            size: 'large' as const,
            weekday: 'TUE' as const,
            localDeadlineTime: '20:00',
            followTeachingWeek: false,
        }),
        requestedWindow: WINDOW,
    });
    const beforePreview = store.readTaskSeriesDetail(taskSeriesId, WINDOW);
    const preview = store.previewTaskOccurrenceChange(impactDraft);
    assert.equal(preview.basedOnRevision, beforePreview.workspaceRevision);
    assert.equal(preview.currentFutureOccurrences.length, 2);
    assert.equal(preview.futureOccurrencesAfterChange.length, 2);
    assert.equal(preview.futureOccurrencesAfterChange[0]!.title, 'Revised checkpoint');
    assert.equal(preview.futureOccurrencesAfterChange[1]!.title, originalThird.title);
    assert.equal(store.readTaskSeriesDetail(taskSeriesId, WINDOW).workspaceRevision, beforePreview.workspaceRevision);

    await commitTask(store, normalizeSetTaskProgressCommand({
        commandId: randomUUID(),
        followUpId: randomUUID(),
        ...currentTaskVersions(store, taskSeriesId),
        intent: {
            kind: 'plan.set-task-progress',
            intentSchemaVersion: 1,
            payload: {
                taskSeriesId,
                originalLogicalAnchor: '2026-09-12',
                reportedProgress: 10,
            },
        },
    }));
    const stale = await store.commit(normalizeChangeTaskOccurrenceCommand({
        commandId: randomUUID(),
        followUpId: randomUUID(),
        confirmationToken: preview.confirmationToken,
        impactWindow: preview.requestedWindow,
        expectedRevision: preview.basedOnRevision,
        expectedPlanVersion: preview.planEntityVersion,
        expectedTaskSeriesVersion: preview.taskSeriesVersion,
        intent: {
            kind: 'plan.change-task-occurrence',
            intentSchemaVersion: 1,
            payload: {
                taskSeriesId,
                originalLogicalAnchor: impactDraft.originalLogicalAnchor,
                scope: 'this-and-future',
                replacement: impactDraft.replacement,
            },
        },
    }));
    assert.equal(stale.ok, false);
    if (stale.ok) {
        throw new Error('Expected stale preview confirmation to be rejected');
    }
    assert.equal(stale.problem.code, 'decision-required');
    assert.equal(stale.problem.dataEffect, 'unchanged');

    const freshPreview = store.previewTaskOccurrenceChange(impactDraft);
    const changed = await commitTask(store, normalizeChangeTaskOccurrenceCommand({
        commandId: randomUUID(),
        followUpId: randomUUID(),
        confirmationToken: freshPreview.confirmationToken,
        impactWindow: freshPreview.requestedWindow,
        expectedRevision: freshPreview.basedOnRevision,
        expectedPlanVersion: freshPreview.planEntityVersion,
        expectedTaskSeriesVersion: freshPreview.taskSeriesVersion,
        intent: {
            kind: 'plan.change-task-occurrence',
            intentSchemaVersion: 1,
            payload: {
                taskSeriesId,
                originalLogicalAnchor: impactDraft.originalLogicalAnchor,
                scope: 'this-and-future',
                replacement: impactDraft.replacement,
            },
        },
    }));
    assert.equal(changed.effects[0]!.code, 'plan.task-occurrence-changed');
    detail = store.readTaskSeriesDetail(taskSeriesId, WINDOW);
    assert.equal(detail.segments.length, 2);
    assert.equal(detail.segments[0]!.segmentId, originalSegmentId);
    assert.equal(detail.occurrences.find(occurrence => (
        occurrence.occurrenceId.originalLogicalAnchor === '2026-09-12'
    ))!.title, 'Revised checkpoint');
    const retainedTerminal = detail.historicalStates.find(state => (
        state.occurrenceId.originalLogicalAnchor === '2026-09-19'
    ));
    assert.equal(retainedTerminal?.status, 'completed');
    assert.equal(retainedTerminal?.title, originalThird.title);
    assert.deepEqual(retainedTerminal?.deadline, originalThird.deadline);

    await assert.rejects(store.commit(normalizeUpdateTaskCommand({
        commandId: randomUUID(),
        followUpId: randomUUID(),
        ...currentTaskVersions(store, taskSeriesId),
        intent: {
            kind: 'plan.update-task-series',
            intentSchemaVersion: 2,
            payload: {
                taskSeriesId,
                courseId: detail.courseId,
                title: 'Must not overwrite history',
                size: 'large',
                schedule: {
                    kind: 'weekly',
                    startDate: '2026-09-05',
                    weekday: 'FRI',
                    localDeadlineTime: '12:00',
                    confirmedEndDate: '2026-09-19',
                    followTeachingWeek: false,
                },
            },
        },
    })), /scoped occurrence editing/);
    assert.equal(store.readTaskSeriesDetail(taskSeriesId, WINDOW).workspaceRevision, detail.workspaceRevision);

    const onlyThisDeletePreview = store.previewTaskOccurrenceChange({
        scope: 'only-this',
        taskSeriesId,
        originalLogicalAnchor: '2026-09-12',
        action: 'delete',
        requestedWindow: WINDOW,
    });
    const deleted = await commitTask(store, normalizeDeleteTaskOccurrenceOrSeriesCommand({
        commandId: randomUUID(),
        followUpId: randomUUID(),
        confirmationToken: onlyThisDeletePreview.confirmationToken,
        impactWindow: onlyThisDeletePreview.requestedWindow,
        expectedRevision: onlyThisDeletePreview.basedOnRevision,
        expectedPlanVersion: onlyThisDeletePreview.planEntityVersion,
        expectedTaskSeriesVersion: onlyThisDeletePreview.taskSeriesVersion,
        intent: {
            kind: 'plan.delete-task-occurrence-or-series',
            intentSchemaVersion: 1,
            payload: {
                taskSeriesId,
                originalLogicalAnchor: '2026-09-12',
                scope: 'only-this',
            },
        },
    }));
    assert.equal(deleted.effects[0]!.code, 'plan.task-occurrence-deleted');
    detail = store.readTaskSeriesDetail(taskSeriesId, WINDOW);
    assert.equal(detail.overrides.find(override => (
        override.occurrenceId.originalLogicalAnchor === '2026-09-12'
    ))?.kind, 'deleted');
    assert.equal(detail.occurrences.some(occurrence => (
        occurrence.occurrenceId.originalLogicalAnchor === '2026-09-12'
    )), false);
    const deletedState = detail.historicalStates.find(state => (
        state.occurrenceId.originalLogicalAnchor === '2026-09-12'
    ));
    assert.equal(deletedState?.status, 'pending');
    assert.equal(deletedState?.reportedProgress, 10);

    const segmentIds = detail.segments.map(segment => segment.segmentId);
    await store.close();
    const reopened = openWorkspaceData(root);
    assert.equal(reopened.kind, 'ready');
    if (reopened.kind !== 'ready') {
        throw new Error('Expected scoped Task facts to reopen');
    }
    store = reopened.store;
    detail = store.readTaskSeriesDetail(taskSeriesId, WINDOW);
    assert.deepEqual(detail.segments.map(segment => segment.segmentId), segmentIds);
    assert.equal(detail.historicalStates.find(state => (
        state.occurrenceId.originalLogicalAnchor === '2026-09-19'
    ))?.title, originalThird.title);
    await store.close();
});

test('A-TASK-006/TEST-WORKSPACE-002: a fresh Task preview binds every confirmed mutation field', async t => {
    const root = createTempDataSlots(t);
    const store = initializeWorkspaceData(root, WORKSPACE_ID);
    const taskSeriesId = await createWeeklyTask(store);
    const changeDraft = Object.freeze({
        scope: 'this-and-future' as const,
        taskSeriesId,
        originalLogicalAnchor: '2026-09-12',
        action: 'change' as const,
        replacement: Object.freeze({
            title: 'Revised checkpoint',
            size: 'large' as const,
            weekday: 'TUE' as const,
            localDeadlineTime: '20:00',
            followTeachingWeek: false,
        }),
        requestedWindow: WINDOW,
    });
    const changePreview = store.previewTaskOccurrenceChange(changeDraft);
    const deletePreview = store.previewTaskOccurrenceChange({
        scope: 'this-and-future',
        taskSeriesId,
        originalLogicalAnchor: changeDraft.originalLogicalAnchor,
        action: 'delete',
        requestedWindow: WINDOW,
    });
    const commands: readonly TaskCommand[] = [
        normalizeChangeTaskOccurrenceCommand({
            commandId: randomUUID(),
            followUpId: randomUUID(),
            confirmationToken: changePreview.confirmationToken,
            impactWindow: changePreview.requestedWindow,
            expectedRevision: changePreview.basedOnRevision,
            expectedPlanVersion: changePreview.planEntityVersion,
            expectedTaskSeriesVersion: changePreview.taskSeriesVersion,
            intent: {
                kind: 'plan.change-task-occurrence',
                intentSchemaVersion: 1,
                payload: {
                    taskSeriesId,
                    originalLogicalAnchor: changeDraft.originalLogicalAnchor,
                    scope: 'this-and-future',
                    replacement: { ...changeDraft.replacement, title: 'Tampered title' },
                },
            },
        }),
        normalizeDeleteTaskOccurrenceOrSeriesCommand({
            commandId: randomUUID(),
            followUpId: randomUUID(),
            confirmationToken: changePreview.confirmationToken,
            impactWindow: changePreview.requestedWindow,
            expectedRevision: changePreview.basedOnRevision,
            expectedPlanVersion: changePreview.planEntityVersion,
            expectedTaskSeriesVersion: changePreview.taskSeriesVersion,
            intent: {
                kind: 'plan.delete-task-occurrence-or-series',
                intentSchemaVersion: 1,
                payload: {
                    taskSeriesId,
                    originalLogicalAnchor: changeDraft.originalLogicalAnchor,
                    scope: 'this-and-future',
                },
            },
        }),
        normalizeDeleteTaskOccurrenceOrSeriesCommand({
            commandId: randomUUID(),
            followUpId: randomUUID(),
            confirmationToken: deletePreview.confirmationToken,
            impactWindow: deletePreview.requestedWindow,
            expectedRevision: deletePreview.basedOnRevision,
            expectedPlanVersion: deletePreview.planEntityVersion,
            expectedTaskSeriesVersion: deletePreview.taskSeriesVersion,
            intent: {
                kind: 'plan.delete-task-occurrence-or-series',
                intentSchemaVersion: 1,
                payload: {
                    taskSeriesId,
                    originalLogicalAnchor: changeDraft.originalLogicalAnchor,
                    scope: 'only-this',
                },
            },
        }),
        normalizeChangeTaskOccurrenceCommand({
            commandId: randomUUID(),
            followUpId: randomUUID(),
            confirmationToken: changePreview.confirmationToken,
            impactWindow: { startDate: WINDOW.startDate, endDate: '2026-09-29' },
            expectedRevision: changePreview.basedOnRevision,
            expectedPlanVersion: changePreview.planEntityVersion,
            expectedTaskSeriesVersion: changePreview.taskSeriesVersion,
            intent: {
                kind: 'plan.change-task-occurrence',
                intentSchemaVersion: 1,
                payload: {
                    taskSeriesId,
                    originalLogicalAnchor: changeDraft.originalLogicalAnchor,
                    scope: 'this-and-future',
                    replacement: changeDraft.replacement,
                },
            },
        }),
    ];
    const before = store.readTaskSeriesDetail(taskSeriesId, WINDOW);

    for (const command of commands) {
        const rejected = await store.commit(command);
        assert.equal(rejected.ok, false);
        if (rejected.ok) {
            throw new Error('Expected an exact Task preview binding rejection');
        }
        assert.equal(rejected.problem.code, 'decision-required');
        assert.equal(rejected.problem.dataEffect, 'unchanged');
        assert.deepEqual(store.readTaskSeriesDetail(taskSeriesId, WINDOW), before);
    }
    await store.close();
});

test('A-TASK-006/TEST-FLOW-01-COMMIT: future deletion rolls back before COMMIT and ' +
    'retains skipped history', async t => {
    const root = createTempDataSlots(t);
    let store = initializeWorkspaceData(root, WORKSPACE_ID);
    const taskSeriesId = await createWeeklyTask(store);
    const original = store.readTaskSeriesDetail(taskSeriesId, WINDOW);
    const originalSegmentId = original.segments[0]!.segmentId;
    const originalThird = original.occurrences[2]!;
    await commitTask(store, normalizeSetTaskOccurrenceStatusCommand({
        commandId: randomUUID(),
        followUpId: randomUUID(),
        ...currentTaskVersions(store, taskSeriesId),
        intent: {
            kind: 'plan.set-task-occurrence-status',
            intentSchemaVersion: 2,
            payload: {
                taskSeriesId,
                originalLogicalAnchor: '2026-09-19',
                status: 'skipped',
            },
        },
    }));

    const draft = Object.freeze({
        scope: 'this-and-future' as const,
        taskSeriesId,
        originalLogicalAnchor: '2026-09-12',
        action: 'delete' as const,
        requestedWindow: WINDOW,
    });
    const beforePreview = store.readTaskSeriesDetail(taskSeriesId, WINDOW);
    const preview = store.previewTaskOccurrenceChange(draft);
    assert.equal(preview.action, 'delete');
    assert.equal(preview.currentFutureOccurrences.length, 2);
    assert.deepEqual(preview.futureOccurrencesAfterChange, []);
    assert.equal(preview.historicalStateCount, '1');
    assert.equal(store.readTaskSeriesDetail(taskSeriesId, WINDOW).workspaceRevision, beforePreview.workspaceRevision);
    const command = normalizeDeleteTaskOccurrenceOrSeriesCommand({
        commandId: randomUUID(),
        followUpId: randomUUID(),
        confirmationToken: preview.confirmationToken,
        impactWindow: preview.requestedWindow,
        expectedRevision: preview.basedOnRevision,
        expectedPlanVersion: preview.planEntityVersion,
        expectedTaskSeriesVersion: preview.taskSeriesVersion,
        intent: {
            kind: 'plan.delete-task-occurrence-or-series',
            intentSchemaVersion: 1,
            payload: {
                taskSeriesId,
                originalLogicalAnchor: draft.originalLogicalAnchor,
                scope: 'this-and-future',
            },
        },
    });
    await assert.rejects(store.commit(command, {
        failpoint(point) {
            if (point === 'commit.before-sqlite-commit') {
                throw new Error(point);
            }
        },
    }), /Workspace data commit failed/);
    let detail = store.readTaskSeriesDetail(taskSeriesId, WINDOW);
    assert.equal(detail.workspaceRevision, beforePreview.workspaceRevision);
    assert.equal(store.receipt(command.commandId), null);
    assert.equal(store.readPendingFollowUps().some(followUp => (
        followUp.originatingCommandId === command.commandId
    )), false);

    const deleted = await commitTask(store, command);
    assert.deepEqual(await store.commit(command), { ok: true, value: deleted });
    detail = store.readTaskSeriesDetail(taskSeriesId, WINDOW);
    assert.deepEqual(detail.segments.map(segment => ({
        id: segment.segmentId,
        start: segment.logicalStartAnchor,
        end: segment.logicalEndAnchor,
    })), [{ id: originalSegmentId, start: '2026-09-05', end: '2026-09-05' }]);
    assert.deepEqual(detail.occurrences.map(occurrence => (
        occurrence.occurrenceId.originalLogicalAnchor
    )), ['2026-09-05']);
    const retainedSkipped = detail.historicalStates.find(state => (
        state.occurrenceId.originalLogicalAnchor === '2026-09-19'
    ));
    assert.equal(retainedSkipped?.status, 'skipped');
    assert.equal(retainedSkipped?.title, originalThird.title);
    assert.deepEqual(retainedSkipped?.deadline, originalThird.deadline);
    assert.equal(store.readPendingFollowUps().some(followUp => (
        followUp.originatingCommandId === command.commandId
    )), true);

    await store.close();
    const reopened = openWorkspaceData(root);
    assert.equal(reopened.kind, 'ready');
    if (reopened.kind !== 'ready') {
        throw new Error('Expected future deletion facts to reopen');
    }
    store = reopened.store;
    detail = store.readTaskSeriesDetail(taskSeriesId, WINDOW);
    assert.equal(detail.historicalStates.find(state => (
        state.occurrenceId.originalLogicalAnchor === '2026-09-19'
    ))?.status, 'skipped');
    await store.close();
});

test('A-TASK-006: a replaced occurrence remains after its teaching-week base is suppressed', async t => {
    const root = createTempDataSlots(t);
    const store = initializeWorkspaceData(root, WORKSPACE_ID);
    const taskSeriesId = await createWeeklyTask(store, true);
    const original = store.readTaskSeriesDetail(taskSeriesId, WINDOW);
    const originalOccurrence = original.occurrences.find(occurrence => (
        occurrence.occurrenceId.originalLogicalAnchor === '2026-09-12'
    ));
    assert.ok(originalOccurrence);

    await commitTask(store, normalizeChangeTaskOccurrenceCommand({
        commandId: randomUUID(),
        followUpId: randomUUID(),
        confirmationToken: null,
        impactWindow: null,
        ...currentTaskVersions(store, taskSeriesId),
        intent: {
            kind: 'plan.change-task-occurrence',
            intentSchemaVersion: 1,
            payload: {
                taskSeriesId,
                originalLogicalAnchor: '2026-09-12',
                scope: 'only-this',
                replacement: {
                    title: 'Reading Week exception',
                    size: 'small',
                    deadline: { kind: 'date-only', date: '2026-09-14' },
                },
            },
        },
    }));
    const setup = store.readSetupProjection();
    assert.ok(setup.currentTerm);
    const holiday = await store.commit(normalizeCreateHolidayRangeCommand({
        commandId: randomUUID(),
        followUpId: randomUUID(),
        expectedRevision: setup.workspaceRevision,
        expectedPlanVersion: setup.planEntityVersion,
        intent: {
            kind: 'plan.create-holiday-range',
            intentSchemaVersion: 1,
            payload: {
                termId: setup.currentTerm.termId,
                name: 'Teaching break',
                startDate: '2026-09-12',
                endDate: '2026-09-19',
            },
        },
    }));
    assert.equal(holiday.ok, true);

    const detail = store.readTaskSeriesDetail(taskSeriesId, WINDOW);
    assert.deepEqual(detail.occurrences.map(occurrence => (
        occurrence.occurrenceId.originalLogicalAnchor
    )), ['2026-09-05', '2026-09-12']);
    const exception = detail.occurrences[1]!;
    assert.deepEqual(exception.occurrenceId, originalOccurrence.occurrenceId);
    assert.equal(exception.title, 'Reading Week exception');
    assert.deepEqual(exception.deadline, { kind: 'date-only', date: '2026-09-14' });
    assert.equal(exception.overrideKind, 'replaced');
    await store.close();
});

test('A-TASK-006: future deletion retains facts for an already deleted pending occurrence', async t => {
    const root = createTempDataSlots(t);
    const store = initializeWorkspaceData(root, WORKSPACE_ID);
    const taskSeriesId = await createWeeklyTask(store);

    await commitTask(store, normalizeSetTaskProgressCommand({
        commandId: randomUUID(),
        followUpId: randomUUID(),
        ...currentTaskVersions(store, taskSeriesId),
        intent: {
            kind: 'plan.set-task-progress',
            intentSchemaVersion: 1,
            payload: {
                taskSeriesId,
                originalLogicalAnchor: '2026-09-19',
                reportedProgress: 25,
            },
        },
    }));
    const onlyThisDeletePreview = store.previewTaskOccurrenceChange({
        scope: 'only-this',
        taskSeriesId,
        originalLogicalAnchor: '2026-09-19',
        action: 'delete',
        requestedWindow: WINDOW,
    });
    await commitTask(store, normalizeDeleteTaskOccurrenceOrSeriesCommand({
        commandId: randomUUID(),
        followUpId: randomUUID(),
        confirmationToken: onlyThisDeletePreview.confirmationToken,
        impactWindow: onlyThisDeletePreview.requestedWindow,
        expectedRevision: onlyThisDeletePreview.basedOnRevision,
        expectedPlanVersion: onlyThisDeletePreview.planEntityVersion,
        expectedTaskSeriesVersion: onlyThisDeletePreview.taskSeriesVersion,
        intent: {
            kind: 'plan.delete-task-occurrence-or-series',
            intentSchemaVersion: 1,
            payload: {
                taskSeriesId,
                originalLogicalAnchor: '2026-09-19',
                scope: 'only-this',
            },
        },
    }));

    const draft = Object.freeze({
        scope: 'this-and-future' as const,
        taskSeriesId,
        originalLogicalAnchor: '2026-09-12',
        action: 'delete' as const,
        requestedWindow: WINDOW,
    });
    const preview = store.previewTaskOccurrenceChange(draft);
    const deleted = await commitTask(store, normalizeDeleteTaskOccurrenceOrSeriesCommand({
        commandId: randomUUID(),
        followUpId: randomUUID(),
        confirmationToken: preview.confirmationToken,
        impactWindow: preview.requestedWindow,
        expectedRevision: preview.basedOnRevision,
        expectedPlanVersion: preview.planEntityVersion,
        expectedTaskSeriesVersion: preview.taskSeriesVersion,
        intent: {
            kind: 'plan.delete-task-occurrence-or-series',
            intentSchemaVersion: 1,
            payload: {
                taskSeriesId,
                originalLogicalAnchor: '2026-09-12',
                scope: 'this-and-future',
            },
        },
    }));
    assert.equal(deleted.effects[0]?.code, 'plan.task-occurrence-deleted');
    const detail = store.readTaskSeriesDetail(taskSeriesId, WINDOW);
    assert.deepEqual(detail.occurrences.map(occurrence => (
        occurrence.occurrenceId.originalLogicalAnchor
    )), ['2026-09-05']);
    assert.deepEqual(detail.historicalStates.find(state => (
        state.occurrenceId.originalLogicalAnchor === '2026-09-19'
    )), {
        occurrenceId: {
            taskSeriesId,
            originalLogicalAnchor: '2026-09-19',
        },
        title: 'Weekly project checkpoint',
        size: 'large',
        deadline: {
            kind: 'timed',
            instant: '2026-09-19T21:00:00.000Z',
            timeZone: 'America/Toronto',
        },
        status: 'pending',
        reportedProgress: 25,
        displayProgress: 25,
    });
    await store.close();
});

test('A-TASK-006: future preview includes anchors shifted into the requested window', async t => {
    const root = createTempDataSlots(t);
    const store = initializeWorkspaceData(root, WORKSPACE_ID);
    const taskSeriesId = await createWeeklyTask(store);
    const preview = store.previewTaskOccurrenceChange({
        scope: 'this-and-future',
        taskSeriesId,
        originalLogicalAnchor: '2026-09-12',
        action: 'change',
        replacement: {
            title: 'Tuesday checkpoint',
            size: 'large',
            weekday: 'TUE',
            localDeadlineTime: '20:00',
            followTeachingWeek: false,
        },
        requestedWindow: { startDate: '2026-09-12', endDate: '2026-09-15' },
    });

    assert.deepEqual(preview.currentFutureOccurrences.map(occurrence => (
        occurrence.occurrenceId.originalLogicalAnchor
    )), ['2026-09-12']);
    assert.deepEqual(preview.futureOccurrencesAfterChange.map(occurrence => (
        occurrence.occurrenceId.originalLogicalAnchor
    )), ['2026-09-19']);
    assert.deepEqual(preview.futureOccurrencesAfterChange[0]?.deadline, {
        kind: 'timed',
        instant: '2026-09-16T00:00:00.000Z',
        timeZone: 'America/Toronto',
    });
    await store.close();
});
