/**
 * @file Verifies Meeting occurrence queries and mutations through the Workspace boundary.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { WorkspaceApplication } from '../src/workspace-application';
import { makeBootstrapRequest } from '../src/shared/bootstrap-contract';
import {
    isWorkspaceSetupOutcome,
    makeChangeMeetingOccurrenceRequest,
    makeCreateCourseWithMeetingRequest,
    makeCreateTermRequest,
    makeInitializeWorkspaceRequest,
    makeMeetingOccurrenceImpactRequest,
    makeMeetingSeriesQueryRequest,
} from '../src/shared/workspace-setup-contract';

const APP_BUILD_ID = 'test-build';
const FALL_WINDOW = Object.freeze({ startDate: '2026-09-01', endDate: '2026-12-31' });

/**
 * Creates an isolated Workspace DATA root for one boundary test.
 * @param {test.TestContext} t - Node test lifecycle context.
 * @return {string} Temporary data-slots root.
 */
function createTempDataSlots(t: test.TestContext): string {
    const dataSlotsRoot = mkdtempSync(join(tmpdir(), 'courseflow-workspace-occurrence-'));
    t.after(() => rmSync(dataSlotsRoot, { recursive: true, force: true }));
    return dataSlotsRoot;
}

/**
 * Bootstraps the Workspace application and returns its process epoch.
 * @param {WorkspaceApplication} application - Workspace application under test.
 * @return {Promise<string>} Active Workspace epoch.
 */
async function bootstrap(application: WorkspaceApplication): Promise<string> {
    const outcome = await application.handle({
        ...makeBootstrapRequest('bootstrap', APP_BUILD_ID),
        dataRootClass: 'verified-local' as const,
    });
    assert.equal(outcome.ok, true);
    if (!outcome.ok || !('workspaceEpoch' in outcome.value)) {
        throw new Error('Expected bootstrap outcome');
    }
    return outcome.value.workspaceEpoch;
}

test('FLOW-01/02: Workspace exposes bounded occurrence query and scoped mutation outcomes', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const application = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID);
    const workspaceEpoch = await bootstrap(application);
    await application.handle(makeInitializeWorkspaceRequest('initialize', APP_BUILD_ID, workspaceEpoch));
    await application.handle(makeCreateTermRequest('term', APP_BUILD_ID, workspaceEpoch, {
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
    const created = await application.handle(makeCreateCourseWithMeetingRequest(
        'course',
        APP_BUILD_ID,
        workspaceEpoch,
        {
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
                        weekday: 'MON',
                        localStart: '09:00',
                        localEnd: '10:00',
                        effectiveRange: { kind: 'inherit-course' },
                        location: { kind: 'known', value: 'BA 1170' },
                    },
                },
            },
        },
    ));
    assert.equal(created.ok, true);
    if (!created.ok || created.value.kind !== 'workspace.command-outcome') {
        throw new Error('Expected Course command outcome');
    }
    const meetingSeriesId = created.value.outcome.effects[1]!.entity.id;

    const before = await application.handle(makeMeetingSeriesQueryRequest(
        'series-before',
        APP_BUILD_ID,
        workspaceEpoch,
        meetingSeriesId,
        FALL_WINDOW,
    ));
    assert.equal(before.ok, true);
    if (!before.ok || before.value.kind !== 'workspace.meeting-series-projection') {
        throw new Error('Expected Meeting series projection');
    }
    assert.equal(isWorkspaceSetupOutcome(
        before,
        APP_BUILD_ID,
        'series-before',
        workspaceEpoch,
    ), true);
    assert.equal(before.value.projection.workspaceRevision, '2');
    const changed = await application.handle(makeChangeMeetingOccurrenceRequest(
        'change',
        APP_BUILD_ID,
        workspaceEpoch,
        {
            commandId: '77777777-7777-4777-8777-777777777777',
            followUpId: '88888888-8888-4888-8888-888888888888',
            confirmationToken: null,
            impactWindow: null,
            expectedRevision: '2',
            expectedPlanVersion: '2',
            expectedMeetingSeriesVersion: '1',
            intent: {
                kind: 'plan.change-meeting-occurrence',
                intentSchemaVersion: 1,
                payload: {
                    meetingSeriesId,
                    originalLogicalAnchor: '2026-09-28',
                    scope: 'only-this',
                    replacement: {
                        type: 'TUT',
                        weekday: 'TUE',
                        localStart: '11:00',
                        localEnd: '12:00',
                        location: { kind: 'tba' },
                    },
                },
            },
        },
    ));
    assert.equal(changed.ok, true);
    if (!changed.ok || changed.value.kind !== 'workspace.command-outcome') {
        throw new Error('Expected occurrence command outcome');
    }
    assert.equal(isWorkspaceSetupOutcome(changed, APP_BUILD_ID, 'change', workspaceEpoch), true);
    assert.equal(changed.value.outcome.effects[0]?.code, 'plan.meeting-occurrence-changed');

    const after = await application.handle(makeMeetingSeriesQueryRequest(
        'series-after',
        APP_BUILD_ID,
        workspaceEpoch,
        meetingSeriesId,
        FALL_WINDOW,
    ));
    assert.equal(after.ok, true);
    if (!after.ok || after.value.kind !== 'workspace.meeting-series-projection') {
        throw new Error('Expected updated Meeting series projection');
    }
    assert.equal(isWorkspaceSetupOutcome(after, APP_BUILD_ID, 'series-after', workspaceEpoch), true);
    assert.equal(after.value.projection.workspaceRevision, '3');
    assert.deepEqual(
        after.value.projection.occurrences.map(occurrence => occurrence.occurrenceId),
        before.value.projection.occurrences.map(occurrence => occurrence.occurrenceId),
    );
    assert.equal(
        after.value.projection.occurrences
            .find(occurrence => occurrence.occurrenceId.originalLogicalAnchor === '2026-09-28')
            ?.overrideKind,
        'replaced',
    );

    const futureCommand = {
        commandId: '99999999-9999-4999-8999-999999999999',
        followUpId: 'abababab-abab-4bab-8bab-abababababab',
        confirmationToken: null,
        impactWindow: null,
        expectedRevision: '3',
        expectedPlanVersion: '3',
        expectedMeetingSeriesVersion: '2',
        intent: {
            kind: 'plan.change-meeting-occurrence' as const,
            intentSchemaVersion: 1 as const,
            payload: {
                meetingSeriesId,
                originalLogicalAnchor: '2026-10-12',
                scope: 'this-and-future' as const,
                replacement: {
                    type: 'TUT' as const,
                    weekday: 'TUE' as const,
                    localStart: '13:00',
                    localEnd: '14:00',
                    location: { kind: 'tba' as const },
                },
            },
        },
    };
    const decision = await application.handle(makeChangeMeetingOccurrenceRequest(
        'future-without-preview',
        APP_BUILD_ID,
        workspaceEpoch,
        futureCommand,
    ));
    assert.equal(decision.ok, false);
    if (decision.ok) {
        throw new Error('Expected Workspace decision-required outcome');
    }
    assert.equal(decision.problem.code, 'decision-required');
    assert.equal(isWorkspaceSetupOutcome(
        decision,
        APP_BUILD_ID,
        'future-without-preview',
        workspaceEpoch,
    ), true);

    const preview = await application.handle(makeMeetingOccurrenceImpactRequest(
        'future-preview',
        APP_BUILD_ID,
        workspaceEpoch,
        {
            ...futureCommand.intent.payload,
            scope: 'this-and-future',
            requestedWindow: FALL_WINDOW,
        },
    ));
    assert.equal(preview.ok, true);
    if (!preview.ok || preview.value.kind !== 'workspace.meeting-occurrence-impact') {
        throw new Error('Expected Workspace occurrence impact preview');
    }
    assert.equal(isWorkspaceSetupOutcome(
        preview,
        APP_BUILD_ID,
        'future-preview',
        workspaceEpoch,
    ), true);
    assert.equal(preview.value.projection.basedOnRevision, '3');
    assert.equal(preview.value.projection.futureOccurrencesAfterChange[0]?.localStart, '13:00');

    const future = await application.handle(makeChangeMeetingOccurrenceRequest(
        'future-confirmed',
        APP_BUILD_ID,
        workspaceEpoch,
        {
            ...futureCommand,
            confirmationToken: preview.value.projection.confirmationToken,
            impactWindow: preview.value.projection.requestedWindow,
        },
    ));
    assert.equal(future.ok, true);
    if (!future.ok || future.value.kind !== 'workspace.command-outcome') {
        throw new Error('Expected confirmed Workspace future split');
    }
    assert.equal(future.value.outcome.revision, '4');
    await application.close();

    const readOnly = await WorkspaceApplication.open(dataSlotsRoot, APP_BUILD_ID, { readOnly: true });
    const readOnlyEpoch = await bootstrap(readOnly);
    const readOnlyPreview = await readOnly.handle(makeMeetingOccurrenceImpactRequest(
        'read-only-preview',
        APP_BUILD_ID,
        readOnlyEpoch,
        {
            ...futureCommand.intent.payload,
            originalLogicalAnchor: '2026-11-09',
            scope: 'this-and-future',
            requestedWindow: FALL_WINDOW,
        },
    ));
    assert.equal(readOnlyPreview.ok, true);
    if (!readOnlyPreview.ok || readOnlyPreview.value.kind !== 'workspace.meeting-occurrence-impact') {
        throw new Error('Expected read-only impact preview');
    }
    assert.equal(readOnlyPreview.value.dataMode, 'read-only');
    await readOnly.close();
});
