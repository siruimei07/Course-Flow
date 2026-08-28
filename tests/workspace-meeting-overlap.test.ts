/**
 * @file Verifies overlap review and explicit continue through the Workspace boundary.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { WorkspaceApplication } from '../src/workspace/application';
import { makeBootstrapRequest } from '../src/shared/bootstrap-contract';
import {
    isWorkspaceSetupOutcome,
    makeCreateCourseWithMeetingRequest,
    makeCreateTermRequest,
    makeInitializeWorkspaceRequest,
} from '../src/shared/workspace-setup-contract';

const APP_BUILD_ID = 'overlap-test-build';

test('A-COURSE-006: Workspace returns object/time warnings and accepts explicit continue', async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'courseflow-workspace-overlap-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const application = await WorkspaceApplication.open(root, APP_BUILD_ID);
    const bootstrap = await application.handle({
        ...makeBootstrapRequest('bootstrap', APP_BUILD_ID),
        dataRootClass: 'verified-local' as const,
    });
    assert.equal(bootstrap.ok, true);
    if (!bootstrap.ok || !('workspaceEpoch' in bootstrap.value)) {
        throw new Error('Expected Workspace bootstrap');
    }
    const epoch = bootstrap.value.workspaceEpoch;
    await application.handle(makeInitializeWorkspaceRequest('initialize', APP_BUILD_ID, epoch));
    await application.handle(makeCreateTermRequest('term', APP_BUILD_ID, epoch, {
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
                endDate: '2026-10-31',
                timeZone: 'America/Toronto',
            },
        },
    }));

    const firstCommand = {
        commandId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        followUpId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        overlapDecision: 'review' as const,
        expectedRevision: '1',
        expectedPlanVersion: '1',
        intent: {
            kind: 'plan.create-course-with-first-meeting' as const,
            intentSchemaVersion: 3 as const,
            payload: {
                course: {
                    code: 'CSC108',
                    name: 'Programming',
                    section: null,
                    instructor: null,
                    color: null,
                    credits: null,
                    teachingRange: { kind: 'inherit-term' as const },
                },
                meeting: {
                    type: 'LEC' as const,
                    weekday: 'MON' as const,
                    localStart: '09:00',
                    localEnd: '10:00',
                    endDayOffset: 0 as const,
                    effectiveRange: { kind: 'inherit-course' as const },
                    location: { kind: 'known' as const, value: 'Room 101' },
                },
            },
        },
    };
    const first = await application.handle(makeCreateCourseWithMeetingRequest(
        'first',
        APP_BUILD_ID,
        epoch,
        firstCommand,
    ));
    assert.equal(first.ok, true);

    const reviewedCommand = {
        ...firstCommand,
        commandId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        followUpId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        expectedRevision: '2',
        expectedPlanVersion: '2',
        intent: {
            ...firstCommand.intent,
            payload: {
                course: {
                    ...firstCommand.intent.payload.course,
                    code: 'MAT137',
                    name: 'Calculus',
                },
                meeting: {
                    ...firstCommand.intent.payload.meeting,
                    type: 'TUT' as const,
                    localStart: '09:30',
                    localEnd: '10:30',
                    location: { kind: 'tba' as const },
                },
            },
        },
    };
    const reviewed = await application.handle(makeCreateCourseWithMeetingRequest(
        'reviewed',
        APP_BUILD_ID,
        epoch,
        reviewedCommand,
    ));
    assert.equal(reviewed.ok, false);
    if (reviewed.ok) {
        throw new Error('Expected Workspace overlap warning');
    }
    assert.equal(reviewed.problem.code, 'decision-required');
    assert.equal(reviewed.problem.details?.reason, 'meeting-time-overlap');
    assert.equal(reviewed.problem.details?.warnings[0]?.existing.courseCode, 'CSC108');
    assert.equal(isWorkspaceSetupOutcome(reviewed, APP_BUILD_ID, 'reviewed', epoch), true);

    const continued = await application.handle(makeCreateCourseWithMeetingRequest(
        'continued',
        APP_BUILD_ID,
        epoch,
        { ...reviewedCommand, overlapDecision: 'continue' },
    ));
    assert.equal(continued.ok, true);
    assert.equal(isWorkspaceSetupOutcome(continued, APP_BUILD_ID, 'continued', epoch), true);
    await application.close();
});
