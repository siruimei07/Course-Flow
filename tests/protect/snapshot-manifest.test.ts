/**
 * @file Verifies the canonical snapshot manifest and every V1 format ceiling.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    assertSnapshotFormatLimitsV1,
    createSnapshotManifestV1,
    type SnapshotFormatLimitFacts,
} from '../../src/protect/snapshot-manifest';

const EXPECTED_ROOT_DIGEST = '80ab042cae9f655d3bf751a84a90cff50c39564a29718b91daec4ba491774cb0';
const EXPECTED_DATABASE_DIGEST = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
const EXPECTED_MANIFEST_BYTES = ''
    + '{"backupSequence":"7","backupSetId":"22222222-2222-4222-8222-222222222222",'
    + '"createdAt":"2026-08-25T12:34:56.000Z","database":{"actualRevision":"12",'
    + '"applicationId":"1128680535","memberPath":"workspace.sqlite","schemaLevel":"13"},'
    + '"digest":{"algorithm":"sha-256","encoding":"lowercase-hex","value":"'
    + EXPECTED_ROOT_DIGEST
    + '"},"library":{"state":"absent"},"limitsVersion":"snapshot-format-limits-v1",'
    + '"manifestEncoding":"courseflow-canonical-json-v1","manifestFormatVersion":"1",'
    + '"members":[{"byteLength":"4","path":"workspace.sqlite","role":"database","sha256":"'
    + EXPECTED_DATABASE_DIGEST
    + '"}],"modules":[{"formatVersion":"1","moduleId":"MOD-DATA"},'
    + '{"formatVersion":"1","moduleId":"MOD-PLAN"},'
    + '{"formatVersion":"1","moduleId":"MOD-PROTECT"},'
    + '{"formatVersion":"1","moduleId":"MOD-WORKSPACE"}],'
    + '"schema":"courseflow-snapshot-manifest-v1","snapshotFormatVersion":"1",'
    + '"snapshotId":"11111111-1111-4111-8111-111111111111",'
    + '"totals":{"libraryFileCount":"0","memberCount":"1","rawBytes":"4"},'
    + '"workspaceId":"33333333-3333-4333-8333-333333333333"}';

const EXACT_LIMITS: SnapshotFormatLimitFacts = {
    manifestBytes: 67_108_864n,
    libraryFileCount: 100_000n,
    memberCount: 100_002n,
    totalRawBytes: 1_099_511_627_776n,
    pathKeyComponents: 128n,
    pathKeyBytes: 32_768n,
    stringBytes: 32_768n,
};

test('TEST-PROTECT-002: SnapshotManifestV1 has fixed canonical golden bytes and root digest', () => {
    const actual = createSnapshotManifestV1({
        snapshotId: '11111111-1111-4111-8111-111111111111',
        backupSetId: '22222222-2222-4222-8222-222222222222',
        backupSequence: '7',
        createdAt: '2026-08-25T12:34:56.000Z',
        workspaceId: '33333333-3333-4333-8333-333333333333',
        database: {
            applicationId: '1128680535',
            schemaLevel: '13',
            actualRevision: '12',
            memberPath: 'workspace.sqlite',
        },
        modules: [
            {moduleId: 'MOD-WORKSPACE', formatVersion: '1'},
            {moduleId: 'MOD-PROTECT', formatVersion: '1'},
            {moduleId: 'MOD-PLAN', formatVersion: '1'},
            {moduleId: 'MOD-DATA', formatVersion: '1'},
        ],
        library: {state: 'absent'},
        members: [{
            path: 'workspace.sqlite',
            role: 'database',
            byteLength: '4',
            sha256: EXPECTED_DATABASE_DIGEST,
        }],
    });

    assert.equal(actual.toString('utf8'), EXPECTED_MANIFEST_BYTES);
});

test('TEST-PROTECT-002: every SnapshotFormatLimitsV1 endpoint passes and one-over fails', () => {
    assert.doesNotThrow(() => assertSnapshotFormatLimitsV1(EXACT_LIMITS));

    for (const field of Object.keys(EXACT_LIMITS) as Array<keyof SnapshotFormatLimitFacts>) {
        assert.throws(
            () => assertSnapshotFormatLimitsV1({
                ...EXACT_LIMITS,
                [field]: EXACT_LIMITS[field] + 1n,
            }),
            error => error instanceof Error
                && error.name === 'SnapshotFormatLimitError'
                && error.message === field,
            `${field} one-over must fail`,
        );
    }
});
