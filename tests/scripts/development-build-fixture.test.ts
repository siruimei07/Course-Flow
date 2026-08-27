/**
 * @file Verifies that the exact development-build fixture stops before unsafe endpoint work begins.
 */

import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * Pinned old endpoint used by the fixture contract.
 *
 * @const
 * @type {string}
 */
const OLD_COMMIT = '2361554e7e0a18c11ed0ce3b4b1da7bab52a6940';

/**
 * Arbitrary distinct full commit used by validation-only tests.
 *
 * @const
 * @type {string}
 */
const NEW_COMMIT = '9c2150b63f62844d7434b33c2838f6cde3cdec72';

/**
 * Runner under test.
 *
 * @const
 * @type {string}
 */
const RUNNER_PATH = path.join(process.cwd(), 'scripts', 'run-development-build-fixture.mjs');

/**
 * Closed stage executable under test.
 *
 * @const
 * @type {string}
 */
const STAGE_PATH = path.join(process.cwd(), 'scripts', 'development-build-fixture-stage.cjs');

/**
 * Creates one closed endpoint descriptor for validation tests.
 *
 * @param {string} fullCommit Exact endpoint commit.
 * @param {number} schemaLevel Current DATA schema.
 * @param {readonly string[]} restoreActivation Supported activation formats.
 * @return {object} Closed endpoint descriptor.
 */
function buildDescriptor(fullCommit: string, schemaLevel: number, restoreActivation: readonly string[]) {
    const supportsMigrationRollback = schemaLevel === 16;
    return {
        fullCommit,
        appBuildId: `development:${fullCommit}`,
        workspaceProtocol: {current: 2, accepted: [2]},
        dataSchema: {
            current: schemaLevel,
            migrationSources: Array.from({length: schemaLevel - 1}, (_value, index) => index + 1),
            future: 'stop',
        },
        formats: {
            snapshotManifest: ['courseflow-snapshot-manifest-v1'],
            backupRepository: ['courseflow-backup-repository-v1'],
            restoreSafetySet: ['courseflow-restore-safety-set-v1'],
            restoreActivation,
            migrationSafetyCopy: supportsMigrationRollback
                ? ['courseflow-migration-safety-copy-v1']
                : [],
            migrationRollbackHandoff: supportsMigrationRollback
                ? ['courseflow-migration-rollback-handoff-v1']
                : [],
        },
    };
}

/**
 * Creates a valid closed fixture document.
 *
 * @return {object} Valid fixture document.
 */
function validFixture() {
    return {
        fixtureVersion: 'courseflow-development-build-fixture-v1',
        oldBuild: buildDescriptor(OLD_COMMIT, 15, []),
        newBuild: buildDescriptor(NEW_COMMIT, 16, [
            'courseflow-activation-plan-v1',
            'courseflow-activation-journal-record-v1',
            'courseflow-restore-session-control-v1',
        ]),
        dataRoot: {
            kind: 'os-temporary',
            disposable: true,
            realDataAllowed: false,
        },
    };
}

/**
 * Runs validation in a disposable directory and returns the child result.
 *
 * @param {unknown} value Candidate fixture document.
 * @return {ReturnType<typeof spawnSync>} Child execution result.
 */
function runFixtureValidation(value: unknown): ReturnType<typeof spawnSync> {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'courseflow-development-build-input-'));
    const fixturePath = path.join(fixtureRoot, 'fixture.json');
    writeFileSync(fixturePath, JSON.stringify(value));

    try {
        return spawnSync(process.execPath, [RUNNER_PATH, '--fixture', fixturePath, '--validate-only'], {
            encoding: 'utf8',
            timeout: 5_000,
            windowsHide: true,
        });
    }
    finally {
        rmSync(fixtureRoot, {recursive: true, force: true});
    }
}

test('ADR-04/08/10: fixture accepts only the closed disposable old/new build descriptor', () => {
    const result = runFixtureValidation(validFixture());

    assert.equal(result.status, 0, String(result.stderr));
    assert.equal(result.stdout, 'PASS development build fixture input validation\n');
});

test('ADR-10: fixture rejects a new endpoint without MigrationSafetyCopyV1', () => {
    const fixture = validFixture();
    fixture.newBuild.formats.migrationSafetyCopy = [];

    const result = runFixtureValidation(fixture);

    assert.equal(result.status, 1);
    assert.match(String(result.stderr), /newBuild\.formats does not match the closed fixture scope/);
});

test('ADR-10: fixture rejects a replacement for the pinned old full commit', () => {
    const fixture = validFixture();
    fixture.oldBuild.fullCommit = '0000000000000000000000000000000000000000';
    fixture.oldBuild.appBuildId = `development:${fixture.oldBuild.fullCommit}`;

    const result = runFixtureValidation(fixture);

    assert.equal(result.status, 1);
    assert.match(String(result.stderr), /oldBuild\.fullCommit must equal the pinned old endpoint/);
});

test('ADR-10: fixture rejects a mixed appBuildId before creating worktrees', () => {
    const fixture = validFixture();
    fixture.newBuild.appBuildId = `development:${OLD_COMMIT}`;

    const result = runFixtureValidation(fixture);

    assert.equal(result.status, 1);
    assert.match(String(result.stderr), /newBuild\.appBuildId must match its full commit/);
});

test('ADR-04/10: fixture rejects identical old and new endpoints', () => {
    const fixture = validFixture();
    fixture.newBuild = buildDescriptor(OLD_COMMIT, 16, [
        'courseflow-activation-plan-v1',
        'courseflow-activation-journal-record-v1',
        'courseflow-restore-session-control-v1',
    ]);

    const result = runFixtureValidation(fixture);

    assert.equal(result.status, 1);
    assert.match(String(result.stderr), /oldBuild and newBuild full commits must differ/);
});

test('ADR-04/08/10: fixture stage rejects every action outside its closed protocol', () => {
    const result = spawnSync(process.execPath, [STAGE_PATH, 'unsafe-action'], {
        encoding: 'utf8',
        timeout: 5_000,
        windowsHide: true,
    });

    assert.equal(result.status, 1);
    assert.match(String(result.stderr), /unsupported development build fixture stage action/);
});

test('ADR-10: migration fixture stage requires exact source and target build identities', () => {
    const result = spawnSync(process.execPath, [
        STAGE_PATH,
        'copy-before-write',
        path.join(tmpdir(), 'courseflow-development-build-fixture-source'),
        path.join(tmpdir(), 'courseflow-development-build-fixture-data'),
    ], {
        encoding: 'utf8',
        timeout: 5_000,
        windowsHide: true,
    });

    assert.equal(result.status, 1);
    assert.match(String(result.stderr), /wrong argument count/);
});

test('FLOW-07: handoff fixture stages accept only their closed restart arguments', () => {
    for (const action of ['handoff-arm-interrupted', 'handoff-inspect']) {
        const result = spawnSync(process.execPath, [STAGE_PATH, action], {
            encoding: 'utf8',
            timeout: 5_000,
            windowsHide: true,
        });

        assert.equal(result.status, 1);
        assert.match(String(result.stderr), /wrong argument count/);
    }
});
