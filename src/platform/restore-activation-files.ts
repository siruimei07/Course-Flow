/**
 * @file Provides narrow same-volume staging, observation, and sibling rename capabilities for Restore DATA slots.
 */

import {createHash} from 'node:crypto';
import {
    constants as fsConstants,
    copyFileSync,
    lstatSync,
    statfsSync,
} from 'node:fs';
import path from 'node:path';

import {canonicalJson} from '../shared/canonical-json';
import {
    digestPlainFile,
    ensureSnapshotStagingDirectory,
    listPlainDirectory,
    plainChildDirectoryExists,
    publishSnapshotDirectory,
    syncPlainFile,
    type PlainFileDigest,
} from './backup-snapshot-files';

const DATABASE_MEMBER_NAME = 'workspace.sqlite';
const DATA_SLOT_MEMBER_NAMES = Object.freeze([
    DATABASE_MEMBER_NAME,
    `${DATABASE_MEMBER_NAME}-shm`,
    `${DATABASE_MEMBER_NAME}-wal`,
]);
const MAXIMUM_DATABASE_BYTES = 1_099_511_627_776n;

export type RestoreDataSlotFingerprint = Readonly<{
    schema: 'courseflow-data-slot-fingerprint-v1';
    members: readonly Readonly<{
        path: string;
        byteLength: string;
        sha256: string;
    }>[];
    slotFingerprint: string;
}>;

export type RestoreDataSlotObservation =
    | Readonly<{kind: 'absent'}>
    | Readonly<{kind: 'present'; fingerprint: RestoreDataSlotFingerprint}>;

export type RestoreActivationFileOptions = Readonly<{
    availableBytes?: (directoryPath: string) => bigint;
    sameVolume?: (leftPath: string, rightPath: string) => boolean;
}>;

/**
 * Requires an existing path to be a plain directory.
 * @param {string} directoryPath - Exact directory path.
 * @return {void}
 */
function requirePlainDirectory(directoryPath: string): void {
    const stats = lstatSync(directoryPath);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new Error('Restore directory identity is invalid');
    }
}

/**
 * Requires one portable direct-child component.
 * @param {string} name - Candidate child name.
 * @return {void}
 */
function requireChildName(name: string): void {
    if (name.length === 0
        || name === '.'
        || name === '..'
        || name.includes('\0')
        || path.basename(name) !== name) {
        throw new TypeError('Restore slot name is invalid');
    }
}

/**
 * Reads conservative currently available bytes for one target filesystem.
 * @param {string} directoryPath - Existing target parent.
 * @return {bigint} Available bytes.
 */
function readAvailableBytes(directoryPath: string): bigint {
    const facts = statfsSync(directoryPath, {bigint: true});
    return facts.bavail * facts.bsize;
}

/**
 * Computes the canonical slot fingerprint from one stable database-member digest.
 * @param {PlainFileDigest} member - Fresh database member digest.
 * @return {RestoreDataSlotFingerprint} Closed one-member DataSlot fingerprint.
 */
function slotFingerprint(
    members: readonly Readonly<{name: string; digest: PlainFileDigest}>[],
): RestoreDataSlotFingerprint {
    const facts = Object.freeze({
        schema: 'courseflow-data-slot-fingerprint-v1' as const,
        members: Object.freeze(members.map(member => Object.freeze({
            path: member.name,
            byteLength: member.digest.byteLength,
            sha256: member.digest.sha256,
        }))),
    });
    return Object.freeze({
        ...facts,
        slotFingerprint: createHash('sha256')
            .update(canonicalJson(facts), 'utf8')
            .digest('hex'),
    });
}

/**
 * Proves that control records and DATA siblings reside on one local filesystem volume.
 * @param {string} activityControlRoot - Stable external control root.
 * @param {string} dataSlotsRoot - Stable parent of every DataSlot.
 * @param {RestoreActivationFileOptions} options - Narrow deterministic test overrides.
 * @return {void}
 */
export function requireRestoreSameVolume(
    activityControlRoot: string,
    dataSlotsRoot: string,
    options: RestoreActivationFileOptions = {},
): void {
    requirePlainDirectory(activityControlRoot);
    requirePlainDirectory(dataSlotsRoot);
    const sameVolume = options.sameVolume
        ? options.sameVolume(activityControlRoot, dataSlotsRoot)
        : lstatSync(activityControlRoot, {bigint: true}).dev
            === lstatSync(dataSlotsRoot, {bigint: true}).dev;
    if (!sameVolume) {
        throw new Error('Restore roots are not on the same volume');
    }
}

/**
 * Freshly observes an exact, closed, one-member DATA sibling.
 * @param {string} dataSlotsRoot - Trusted DataSlots parent.
 * @param {string} slotName - Exact direct-child name.
 * @return {RestoreDataSlotObservation} Absent or fingerprinted present state.
 */
export function observeRestoreDataSlot(
    dataSlotsRoot: string,
    slotName: string,
): RestoreDataSlotObservation {
    requirePlainDirectory(dataSlotsRoot);
    requireChildName(slotName);
    if (!plainChildDirectoryExists(dataSlotsRoot, slotName)) {
        return Object.freeze({kind: 'absent' as const});
    }
    const slotPath = path.join(dataSlotsRoot, slotName);
    const memberNames = listPlainDirectory(slotPath);
    if (!memberNames.includes(DATABASE_MEMBER_NAME)
        || memberNames.some(name => !DATA_SLOT_MEMBER_NAMES.includes(name))) {
        throw new Error('Restore DataSlot closure is invalid');
    }
    return Object.freeze({
        kind: 'present' as const,
        fingerprint: slotFingerprint(memberNames.map(name => ({
            name,
            digest: digestPlainFile(path.join(slotPath, name), MAXIMUM_DATABASE_BYTES),
        }))),
    });
}

/**
 * Copies one closed validation database into an absent target-volume sibling and reopens its bytes.
 * @param {string} sourceDatabasePath - Validated closed database member.
 * @param {string} dataSlotsRoot - Trusted target DataSlots parent.
 * @param {string} candidateSlotName - Operation-owned candidate sibling name.
 * @param {RestoreActivationFileOptions} options - Capacity test override.
 * @return {RestoreDataSlotFingerprint} Fresh target sibling fingerprint.
 */
export function stageRestoreDataSlot(
    sourceDatabasePath: string,
    dataSlotsRoot: string,
    candidateSlotName: string,
    options: RestoreActivationFileOptions = {},
): RestoreDataSlotFingerprint {
    requirePlainDirectory(dataSlotsRoot);
    requireChildName(candidateSlotName);
    const source = lstatSync(sourceDatabasePath, {bigint: true});
    if (!source.isFile() || source.isSymbolicLink() || source.size > MAXIMUM_DATABASE_BYTES) {
        throw new Error('Restore candidate database identity is invalid');
    }
    const availableBytes = options.availableBytes?.(dataSlotsRoot)
        ?? readAvailableBytes(dataSlotsRoot);
    if (availableBytes < source.size) {
        throw new Error('Restore staging capacity is insufficient');
    }
    if (plainChildDirectoryExists(dataSlotsRoot, candidateSlotName)) {
        throw new Error('Restore candidate sibling already exists');
    }
    const candidatePath = ensureSnapshotStagingDirectory(dataSlotsRoot, candidateSlotName);
    const databasePath = path.join(candidatePath, DATABASE_MEMBER_NAME);
    copyFileSync(sourceDatabasePath, databasePath, fsConstants.COPYFILE_EXCL);
    syncPlainFile(databasePath);
    const observed = observeRestoreDataSlot(dataSlotsRoot, candidateSlotName);
    if (observed.kind !== 'present') {
        throw new Error('Restore candidate sibling was not observed');
    }
    return observed.fingerprint;
}

/**
 * Executes or idempotently observes one exact same-parent DATA sibling rename.
 * @param {string} dataSlotsRoot - Trusted DataSlots parent.
 * @param {string} sourceSlotName - Expected source child.
 * @param {string} targetSlotName - Required absent target child.
 * @param {string} expectedFingerprint - Exact source/target slot fingerprint.
 * @return {Readonly<object>} Fresh after-state observations.
 */
export function renameRestoreDataSlot(
    dataSlotsRoot: string,
    sourceSlotName: string,
    targetSlotName: string,
    expectedFingerprint: string,
): Readonly<{
    source: RestoreDataSlotObservation;
    target: RestoreDataSlotObservation;
}> {
    requireChildName(sourceSlotName);
    requireChildName(targetSlotName);
    if (!/^[0-9a-f]{64}$/.test(expectedFingerprint) || sourceSlotName === targetSlotName) {
        throw new TypeError('Restore rename fingerprint is invalid');
    }
    const beforeSource = observeRestoreDataSlot(dataSlotsRoot, sourceSlotName);
    const beforeTarget = observeRestoreDataSlot(dataSlotsRoot, targetSlotName);
    if (beforeSource.kind === 'present'
        && beforeSource.fingerprint.slotFingerprint === expectedFingerprint
        && beforeTarget.kind === 'absent') {
        publishSnapshotDirectory(
            path.join(dataSlotsRoot, sourceSlotName),
            path.join(dataSlotsRoot, targetSlotName),
        );
    }
    else if (!(beforeSource.kind === 'absent'
        && beforeTarget.kind === 'present'
        && beforeTarget.fingerprint.slotFingerprint === expectedFingerprint)) {
        throw new Error('Restore DATA rename evidence is ambiguous');
    }
    const source = observeRestoreDataSlot(dataSlotsRoot, sourceSlotName);
    const target = observeRestoreDataSlot(dataSlotsRoot, targetSlotName);
    if (source.kind !== 'absent'
        || target.kind !== 'present'
        || target.fingerprint.slotFingerprint !== expectedFingerprint) {
        throw new Error('Restore DATA rename observation failed');
    }
    return Object.freeze({source, target});
}
