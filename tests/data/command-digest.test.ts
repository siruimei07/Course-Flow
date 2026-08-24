/**
 * @file Verifies canonical command digest projections and permanent SHA-256 vectors.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    digestCancelMeetingOccurrence,
    digestChangeMeetingOccurrence,
    digestCreateHolidayRange,
    digestDeleteHolidayRange,
    digestRecordSetupDecision,
    digestUpdateHolidayRange,
} from '../../src/data/command-digest';
import {
    cancelMeetingOccurrenceDigestProjection,
    changeMeetingOccurrenceDigestProjection,
    normalizeAcceptedChangeMeetingOccurrenceCommand,
    normalizeCancelMeetingOccurrenceCommand,
} from '../../src/shared/workspace-course-contract';
import {
    normalizeRecordSetupDecisionCommand,
    recordSetupDecisionDigestProjection,
} from '../../src/shared/workspace-data-contract';
import {
    normalizeCreateHolidayRangeCommand,
    normalizeDeleteHolidayRangeCommand,
    normalizeUpdateHolidayRangeCommand,
} from '../../src/shared/workspace-holiday-contract';
import { canonicalJson } from '../../src/shared/canonical-json';

const GOLDEN_CANONICAL_TEXT = '{"durableFollowUps":[{"followUpId":"22222222-2222-4222-8222-222222222222",'
    + '"kind":"backup-needed-through","owner":"protect"}],"encoding":"courseflow-canonical-json-v1",'
    + '"expectedEntityVersions":[{"entityId":"11111111-1111-4111-8111-111111111111",'
    + '"entityKind":"workspace-setup","version":"0"}],"expectedRevision":"0",'
    + '"intent":{"intentSchemaVersion":1,"kind":"workspace.record-setup-decision",'
    + '"payload":{"decision":"later"}}}';
const GOLDEN_SHA256 = '556616ce11b365703b18bc6e3d7802a0e399a42c345df879016e6c02f5ddc90c';
const CHANGE_OCCURRENCE_GOLDEN_CANONICAL_TEXT = '{"confirmationToken":'
    + '"1111111111111111111111111111111111111111111111111111111111111111",'
    + '"durableFollowUps":[{"followUpId":"88888888-8888-4888-8888-888888888888",'
    + '"kind":"backup-needed-through","owner":"protect"}],'
    + '"encoding":"courseflow-canonical-json-v1","expectedEntityVersions":'
    + '[{"entityId":"singleton","entityKind":"plan-state","version":"2"},'
    + '{"entityId":"44444444-4444-4444-8444-444444444444","entityKind":"meeting-series",'
    + '"version":"1"}],"expectedRevision":"2","impactWindow":{"endDate":"2026-12-31",'
    + '"startDate":"2026-09-01"},"intent":{"intentSchemaVersion":1,'
    + '"kind":"plan.change-meeting-occurrence","payload":'
    + '{"meetingSeriesId":"44444444-4444-4444-8444-444444444444",'
    + '"originalLogicalAnchor":"2026-09-14","replacement":{"localEnd":"12:00",'
    + '"localStart":"11:00","location":{"kind":"tba"},"type":"TUT","weekday":"TUE"},'
    + '"scope":"this-and-future"}}}';
const CHANGE_OCCURRENCE_GOLDEN_SHA256 = '4afd0691566f3e42c65920c5e788c2f366e931d4591c91991a06979f43338d52';
const CANCEL_OCCURRENCE_GOLDEN_CANONICAL_TEXT = '{"durableFollowUps":'
    + '[{"followUpId":"abababab-abab-4bab-8bab-abababababab","kind":"backup-needed-through",'
    + '"owner":"protect"}],"encoding":"courseflow-canonical-json-v1","expectedEntityVersions":'
    + '[{"entityId":"singleton","entityKind":"plan-state","version":"2"},'
    + '{"entityId":"44444444-4444-4444-8444-444444444444","entityKind":"meeting-series",'
    + '"version":"1"}],"expectedRevision":"2","intent":{"intentSchemaVersion":1,'
    + '"kind":"plan.cancel-meeting-occurrence","payload":'
    + '{"meetingSeriesId":"44444444-4444-4444-8444-444444444444",'
    + '"originalLogicalAnchor":"2026-10-05"}}}';
const CANCEL_OCCURRENCE_GOLDEN_SHA256 = 'bf9d443ecc67f4ce2572cf36d73118aad1c7b5b4e4bb1fb979d5bc0e876da34c';
const CREATE_HOLIDAY_RANGE_GOLDEN_SHA256 =
    '36f6fcc2bcc8302b76add1e1be17343f5261e45578a903cabfe4d7a4513f74ea';
const UPDATE_HOLIDAY_RANGE_GOLDEN_SHA256 =
    'd628451426e507c84d93d1a878a813c10e9f450b5e080ce0915e9b7bdbb6f755';
const DELETE_HOLIDAY_RANGE_GOLDEN_SHA256 =
    '191f081dbc67480cca88dfeecde864732d9ef57181a149b2aedfe09b5bdc3636';

const CHANGE_OCCURRENCE_COMMAND = normalizeAcceptedChangeMeetingOccurrenceCommand({
    commandId: '77777777-7777-4777-8777-777777777777',
    followUpId: '88888888-8888-4888-8888-888888888888',
    confirmationToken: '1'.repeat(64),
    impactWindow: { startDate: '2026-09-01', endDate: '2026-12-31' },
    expectedRevision: '2',
    expectedPlanVersion: '2',
    expectedMeetingSeriesVersion: '1',
    intent: {
        kind: 'plan.change-meeting-occurrence',
        intentSchemaVersion: 1,
        payload: {
            meetingSeriesId: '44444444-4444-4444-8444-444444444444',
            originalLogicalAnchor: '2026-09-14',
            scope: 'this-and-future',
            replacement: {
                type: 'TUT',
                weekday: 'TUE',
                localStart: '11:00',
                localEnd: '12:00',
                location: { kind: 'tba' },
            },
        },
    },
});

const CANCEL_OCCURRENCE_COMMAND = normalizeCancelMeetingOccurrenceCommand({
    commandId: '99999999-9999-4999-8999-999999999999',
    followUpId: 'abababab-abab-4bab-8bab-abababababab',
    expectedRevision: '2',
    expectedPlanVersion: '2',
    expectedMeetingSeriesVersion: '1',
    intent: {
        kind: 'plan.cancel-meeting-occurrence',
        intentSchemaVersion: 1,
        payload: {
            meetingSeriesId: '44444444-4444-4444-8444-444444444444',
            originalLogicalAnchor: '2026-10-05',
        },
    },
});

const HOLIDAY_COMMAND_BASE = {
    commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    followUpId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    expectedRevision: '4',
    expectedPlanVersion: '4',
} as const;

const CREATE_HOLIDAY_RANGE_COMMAND = normalizeCreateHolidayRangeCommand({
    ...HOLIDAY_COMMAND_BASE,
    intent: {
        kind: 'plan.create-holiday-range',
        intentSchemaVersion: 1,
        payload: {
            termId: '22222222-2222-4222-8222-222222222222',
            name: 'Reading Week',
            startDate: '2026-10-12',
            endDate: '2026-10-16',
        },
    },
});

const UPDATE_HOLIDAY_RANGE_COMMAND = normalizeUpdateHolidayRangeCommand({
    ...HOLIDAY_COMMAND_BASE,
    expectedHolidayRangeVersion: '1',
    overlapDecision: 'review',
    intent: {
        kind: 'plan.update-holiday-range',
        intentSchemaVersion: 1,
        payload: {
            holidayRangeId: '33333333-3333-4333-8333-333333333333',
            name: 'Fall Break',
            startDate: '2026-10-13',
            endDate: '2026-10-15',
        },
    },
});

const DELETE_HOLIDAY_RANGE_COMMAND = normalizeDeleteHolidayRangeCommand({
    ...HOLIDAY_COMMAND_BASE,
    expectedHolidayRangeVersion: '2',
    overlapDecision: 'continue',
    intent: {
        kind: 'plan.delete-holiday-range',
        intentSchemaVersion: 1,
        payload: { holidayRangeId: '33333333-3333-4333-8333-333333333333' },
    },
});

function makeCommand(overrides: Record<string, unknown> = {}) {
    return normalizeRecordSetupDecisionCommand({
        commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        workspaceId: '11111111-1111-4111-8111-111111111111',
        intent: {
            kind: 'workspace.record-setup-decision',
            intentSchemaVersion: 1,
            payload: { decision: 'later' },
        },
        followUpId: '22222222-2222-4222-8222-222222222222',
        expectedRevision: '0',
        expectedSetupVersion: '0',
        ...overrides,
    });
}

test('TEST-DATA-002: canonical command digest matches the v1 golden vector', () => {
    const command = makeCommand();

    assert.equal(canonicalJson(recordSetupDecisionDigestProjection(command)), GOLDEN_CANONICAL_TEXT);
    assert.equal(Buffer.from(digestRecordSetupDecision(command)).toString('hex'), GOLDEN_SHA256);
});

test('record setup digest excludes command identity but changes with semantic payload', () => {
    const original = makeCommand();
    const reordered = makeCommand({
        intent: {
            payload: { decision: 'later' },
            intentSchemaVersion: 1,
            kind: 'workspace.record-setup-decision',
        },
    });

    assert.deepEqual(digestRecordSetupDecision(original), digestRecordSetupDecision(reordered));
    assert.deepEqual(
        digestRecordSetupDecision(original),
        digestRecordSetupDecision(makeCommand({ commandId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })),
    );
    assert.notDeepEqual(
        digestRecordSetupDecision(original),
        digestRecordSetupDecision(makeCommand({
            intent: {
                kind: 'workspace.record-setup-decision',
                intentSchemaVersion: 1,
                payload: { decision: 'skip' },
            },
        })),
    );
    assert.notDeepEqual(
        digestRecordSetupDecision(original),
        digestRecordSetupDecision(makeCommand({ expectedSetupVersion: '1' })),
    );
    assert.notDeepEqual(
        digestRecordSetupDecision(original),
        digestRecordSetupDecision(makeCommand({ followUpId: '33333333-3333-4333-8333-333333333333' })),
    );
});

test('normalizeRecordSetupDecisionCommand accepts only canonical 64-bit unsigned strings', () => {
    for (const field of ['expectedRevision', 'expectedSetupVersion'] as const) {
        for (const version of ['0', '9223372036854775807']) {
            assert.equal(makeCommand({ [field]: version })[field], version);
        }

        for (const version of ['01', '9223372036854775808']) {
            assert.throws(() => makeCommand({ [field]: version }), TypeError);
        }
    }
});

test('normalizeRecordSetupDecisionCommand rejects unknown or malformed DTO fields', () => {
    const valid = {
        commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        workspaceId: '11111111-1111-4111-8111-111111111111',
        intent: {
            kind: 'workspace.record-setup-decision',
            intentSchemaVersion: 1,
            payload: { decision: 'later' },
        },
        followUpId: '22222222-2222-4222-8222-222222222222',
        expectedRevision: '0',
        expectedSetupVersion: '0',
    };

    for (const value of [
        { ...valid, extra: true },
        { ...valid, commandId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' },
        { ...valid, expectedRevision: 0 },
        { ...valid, intent: { ...valid.intent, payload: { decision: 'choice' } } },
        { ...valid, intent: { ...valid.intent, payload: { decision: 'later', extra: true } } },
    ]) {
        assert.throws(() => normalizeRecordSetupDecisionCommand(value), TypeError);
    }
});

test('ADR-04: Meeting occurrence command digests match permanent golden vectors', () => {
    assert.equal(
        canonicalJson(changeMeetingOccurrenceDigestProjection(CHANGE_OCCURRENCE_COMMAND)),
        CHANGE_OCCURRENCE_GOLDEN_CANONICAL_TEXT,
    );
    assert.equal(
        Buffer.from(digestChangeMeetingOccurrence(CHANGE_OCCURRENCE_COMMAND)).toString('hex'),
        CHANGE_OCCURRENCE_GOLDEN_SHA256,
    );
    assert.equal(
        canonicalJson(cancelMeetingOccurrenceDigestProjection(CANCEL_OCCURRENCE_COMMAND)),
        CANCEL_OCCURRENCE_GOLDEN_CANONICAL_TEXT,
    );
    assert.equal(
        Buffer.from(digestCancelMeetingOccurrence(CANCEL_OCCURRENCE_COMMAND)).toString('hex'),
        CANCEL_OCCURRENCE_GOLDEN_SHA256,
    );
});

test('ADR-04: future-change digest binds confirmation window and versions, not command identity', () => {
    assert.deepEqual(
        digestChangeMeetingOccurrence(CHANGE_OCCURRENCE_COMMAND),
        digestChangeMeetingOccurrence(normalizeAcceptedChangeMeetingOccurrenceCommand({
            ...CHANGE_OCCURRENCE_COMMAND,
            commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        })),
    );
    for (const changed of [
        { confirmationToken: '2'.repeat(64) },
        { impactWindow: { startDate: '2026-09-08', endDate: '2026-12-31' } },
        { expectedRevision: '3' },
        { expectedPlanVersion: '3' },
        { expectedMeetingSeriesVersion: '2' },
    ]) {
        assert.notDeepEqual(
            digestChangeMeetingOccurrence(CHANGE_OCCURRENCE_COMMAND),
            digestChangeMeetingOccurrence(normalizeAcceptedChangeMeetingOccurrenceCommand({
                ...CHANGE_OCCURRENCE_COMMAND,
                ...changed,
            })),
        );
    }
});

test('ADR-04/TEST-DATA-002: HolidayRange command digests match permanent golden vectors', () => {
    assert.equal(
        Buffer.from(digestCreateHolidayRange(CREATE_HOLIDAY_RANGE_COMMAND)).toString('hex'),
        CREATE_HOLIDAY_RANGE_GOLDEN_SHA256,
    );
    assert.equal(
        Buffer.from(digestUpdateHolidayRange(UPDATE_HOLIDAY_RANGE_COMMAND)).toString('hex'),
        UPDATE_HOLIDAY_RANGE_GOLDEN_SHA256,
    );
    assert.equal(
        Buffer.from(digestDeleteHolidayRange(DELETE_HOLIDAY_RANGE_COMMAND)).toString('hex'),
        DELETE_HOLIDAY_RANGE_GOLDEN_SHA256,
    );
});
