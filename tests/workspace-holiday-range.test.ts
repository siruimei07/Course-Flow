/**
 * @file Verifies narrow HolidayRange commands through the single Workspace boundary.
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
    makeCreateHolidayRangeRequest,
    makeCreateTermRequest,
    makeDeleteHolidayRangeRequest,
    makeInitializeWorkspaceRequest,
    makeSetupQueryRequest,
    makeUpdateHolidayRangeRequest,
} from '../src/shared/workspace-setup-contract';

const APP_BUILD_ID = 'holiday-range-test-build';

test('A-TERM-004/TEST-DATA-004: Workspace routes and recovers HolidayRange CRUD exactly', async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'courseflow-workspace-holiday-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    let loseCreateResponse = false;
    const application = await WorkspaceApplication.open(root, APP_BUILD_ID, {
        commitOptions: {
            failpoint(point) {
                if (loseCreateResponse && point === 'commit.after-sqlite-commit') {
                    loseCreateResponse = false;
                    throw new Error(point);
                }
            },
        },
    });
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
    const term = await application.handle(makeCreateTermRequest('term', APP_BUILD_ID, epoch, {
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
    assert.equal(term.ok, true);
    if (!term.ok || term.value.kind !== 'workspace.command-outcome') {
        throw new Error('Expected Term creation');
    }
    const termId = term.value.outcome.effects[0].entity.id;

    loseCreateResponse = true;
    const created = await application.handle(makeCreateHolidayRangeRequest(
        'create-holiday',
        APP_BUILD_ID,
        epoch,
        {
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
        },
    ));
    assert.equal(created.ok, true);
    assert.equal(isWorkspaceSetupOutcome(created, APP_BUILD_ID, 'create-holiday', epoch), true);
    if (!created.ok || created.value.kind !== 'workspace.command-outcome') {
        throw new Error('Expected HolidayRange creation');
    }
    assert.equal(created.value.outcome.effects[0].code, 'plan.holiday-range-created');
    const holidayRangeId = created.value.outcome.effects[0].entity.id;

    const updated = await application.handle(makeUpdateHolidayRangeRequest(
        'update-holiday',
        APP_BUILD_ID,
        epoch,
        {
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
        },
    ));
    assert.equal(updated.ok, true);
    const projection = await application.handle(makeSetupQueryRequest(
        'query-holiday',
        APP_BUILD_ID,
        epoch,
    ));
    assert.equal(projection.ok, true);
    if (!projection.ok || projection.value.kind !== 'workspace.setup-projection') {
        throw new Error('Expected HolidayRange setup projection');
    }
    assert.equal(projection.value.projection.holidayRanges[0]?.holidayRangeId, holidayRangeId);
    assert.equal(projection.value.projection.holidayRanges[0]?.name, 'Fall Break');

    const deleted = await application.handle(makeDeleteHolidayRangeRequest(
        'delete-holiday',
        APP_BUILD_ID,
        epoch,
        {
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
        },
    ));
    assert.equal(deleted.ok, true);
    assert.equal(isWorkspaceSetupOutcome(deleted, APP_BUILD_ID, 'delete-holiday', epoch), true);
    await application.close();
});
