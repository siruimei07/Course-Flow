/**
 * @file Verifies narrow same-volume DATA sibling staging and capacity boundaries.
 */

import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    observeRestoreDataSlot,
    requireRestoreSameVolume,
    stageRestoreDataSlot,
} from '../../src/platform/restore-activation-files';

function createDirectory(prefix: string): string {
    return mkdtempSync(path.join(tmpdir(), prefix));
}

test('ADR-08: activation roots must prove the same local volume', t => {
    const activityControlRoot = createDirectory('courseflow-restore-volume-control-');
    const dataSlotsRoot = createDirectory('courseflow-restore-volume-data-');
    t.after(() => {
        rmSync(activityControlRoot, {recursive: true, force: true});
        rmSync(dataSlotsRoot, {recursive: true, force: true});
    });

    assert.throws(() => requireRestoreSameVolume(
        activityControlRoot,
        dataSlotsRoot,
        {sameVolume: () => false},
    ), /same volume/);
    assert.doesNotThrow(() => requireRestoreSameVolume(
        activityControlRoot,
        dataSlotsRoot,
        {sameVolume: () => true},
    ));
});

test('TEST-DATA-006: candidate staging accepts exact capacity and rejects one byte less', t => {
    const sourceRoot = createDirectory('courseflow-restore-stage-source-');
    const dataSlotsRoot = createDirectory('courseflow-restore-stage-data-');
    t.after(() => {
        rmSync(sourceRoot, {recursive: true, force: true});
        rmSync(dataSlotsRoot, {recursive: true, force: true});
    });
    const sourcePath = path.join(sourceRoot, 'workspace.sqlite');
    const bytes = Buffer.from('closed-candidate');
    writeFileSync(sourcePath, bytes);

    assert.throws(() => stageRestoreDataSlot(
        sourcePath,
        dataSlotsRoot,
        '.restore-candidate-insufficient',
        {availableBytes: () => BigInt(bytes.byteLength - 1)},
    ), /capacity/);
    assert.deepEqual(
        observeRestoreDataSlot(dataSlotsRoot, '.restore-candidate-insufficient'),
        {kind: 'absent'},
    );

    const staged = stageRestoreDataSlot(
        sourcePath,
        dataSlotsRoot,
        '.restore-candidate-exact',
        {availableBytes: () => BigInt(bytes.byteLength)},
    );
    const observed = observeRestoreDataSlot(dataSlotsRoot, '.restore-candidate-exact');
    assert.equal(observed.kind, 'present');
    assert.equal(
        observed.kind === 'present' ? observed.fingerprint.slotFingerprint : null,
        staged.slotFingerprint,
    );
});
