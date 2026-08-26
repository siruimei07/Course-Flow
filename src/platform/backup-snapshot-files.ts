/**
 * @file Provides narrow plain-file staging and same-parent snapshot publication capabilities.
 */

import {createHash} from 'node:crypto';
import {
    closeSync,
    fstatSync,
    fsyncSync,
    lstatSync,
    mkdirSync,
    openSync,
    readFileSync,
    readSync,
    readdirSync,
    renameSync,
    rmdirSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import path from 'node:path';

import {
    resolveDirectoryCapability,
    verifyDirectoryCapability,
    type DirectoryCapability,
} from './backup-destination';

export type BackupSetTree = Readonly<{
    repositoryDirectoryPath: string;
    workspaceDirectoryPath: string;
    backupSetDirectoryPath: string;
}>;

export type EnsureBackupSetTreeInput = Readonly<{
    destinationPath: string;
    repositoryDirectoryName: string;
    repositoryMarkerName: string;
    repositoryMarkerBytes: Buffer;
    workspaceDirectoryName: string;
    backupSetDirectoryName: string;
    repositoryTemporaryName: string;
    afterRepositoryMarkerWrite?: () => void;
    afterRepositoryPublish?: () => void;
}>;

export type ReadBackupSetTreeInput = Readonly<{
    destinationPath: string;
    repositoryDirectoryName: string;
    repositoryMarkerName: string;
    repositoryMarkerBytes: Buffer;
    workspaceDirectoryName: string;
    backupSetDirectoryName: string;
}>;

export type PlainFileDigest = Readonly<{
    byteLength: string;
    sha256: string;
}>;

/**
 * Tests namespace entry existence without following a dangling link.
 * @param {string} entryPath - Exact entry path.
 * @return {boolean} Whether any directory entry exists.
 */
function pathEntryExists(entryPath: string): boolean {
    return lstatSync(entryPath, {throwIfNoEntry: false}) !== undefined;
}

/**
 * Restricts caller-owned identities to one portable path component.
 * @param {string} component - Candidate directory or file name.
 * @return {void}
 */
function assertComponent(component: string): void {
    if (component.length === 0
        || component === '.'
        || component === '..'
        || component.includes('\0')
        || path.basename(component) !== component) {
        throw new TypeError('Backup path component is invalid');
    }
}

/**
 * Requires one existing path to be a plain directory rather than a link.
 * @param {string} directoryPath - Exact directory path.
 * @return {void}
 */
function assertPlainDirectory(directoryPath: string): void {
    const stats = lstatSync(directoryPath);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new Error('Backup directory identity is invalid');
    }
}

/**
 * Creates or revalidates one named child directory.
 * @param {string} parentPath - Existing parent path.
 * @param {string} name - Validated child component.
 * @return {string} Exact child directory path.
 */
function ensurePlainDirectory(parentPath: string, name: string): string {
    assertComponent(name);
    const directoryPath = path.join(parentPath, name);
    if (!exactChildEntryExists(parentPath, name)) {
        mkdirSync(directoryPath);
    }
    assertPlainDirectory(directoryPath);
    return directoryPath;
}

/**
 * Reopens one file and verifies exact bytes without accepting identity replacement.
 * @param {string} filePath - Exact file path.
 * @param {Buffer} expectedBytes - Required raw bytes.
 * @return {void}
 */
function assertExactPlainFile(filePath: string, expectedBytes: Buffer): void {
    const stats = lstatSync(filePath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
        throw new Error('Backup file identity is invalid');
    }
    const actual = readFileSync(filePath);
    const after = lstatSync(filePath);
    if (!actual.equals(expectedBytes)
        || after.isSymbolicLink()
        || after.dev !== stats.dev
        || after.ino !== stats.ino
        || after.size !== stats.size) {
        throw new Error('Backup file changed while it was read');
    }
}

/**
 * Checks one child name exactly, stopping on case- or normalization-insensitive aliases.
 * @param {string} parentDirectoryPath - Existing trusted plain parent directory.
 * @param {string} childName - Exact portable component.
 * @return {boolean} Whether the exact child name exists.
 */
function exactChildEntryExists(parentDirectoryPath: string, childName: string): boolean {
    assertPlainDirectory(parentDirectoryPath);
    assertComponent(childName);
    const childPath = path.join(parentDirectoryPath, childName);
    if (readdirSync(parentDirectoryPath).includes(childName)) {
        return true;
    }
    if (pathEntryExists(childPath)) {
        throw new Error('Backup child identity conflicts');
    }
    return false;
}

/**
 * Creates or reopens the owned repository tree without claiming a pre-existing unmarked directory.
 * @param {EnsureBackupSetTreeInput} input - Exact repository identities and marker bytes.
 * @return {BackupSetTree} Revalidated BackupSet paths.
 */
export function ensureBackupSetTree(input: EnsureBackupSetTreeInput): BackupSetTree {
    [
        input.repositoryDirectoryName,
        input.repositoryMarkerName,
        input.workspaceDirectoryName,
        input.backupSetDirectoryName,
        input.repositoryTemporaryName,
    ].forEach(assertComponent);
    const destination = resolveDirectoryCapability(input.destinationPath);
    const repositoryDirectoryPath = path.join(
        destination.canonicalPath,
        input.repositoryDirectoryName,
    );
    const markerPath = path.join(repositoryDirectoryPath, input.repositoryMarkerName);
    if (!exactChildEntryExists(destination.canonicalPath, input.repositoryDirectoryName)) {
        const temporaryPath = ensurePlainDirectory(
            destination.canonicalPath,
            input.repositoryTemporaryName,
        );
        const temporaryMarkerPath = path.join(temporaryPath, input.repositoryMarkerName);
        if (!exactChildEntryExists(temporaryPath, input.repositoryMarkerName)) {
            writeFileSync(temporaryMarkerPath, input.repositoryMarkerBytes, {flag: 'wx'});
            input.afterRepositoryMarkerWrite?.();
        }
        syncPlainFile(temporaryMarkerPath);
        assertExactPlainFile(temporaryMarkerPath, input.repositoryMarkerBytes);
        ensurePlainDirectory(
            ensurePlainDirectory(temporaryPath, input.workspaceDirectoryName),
            input.backupSetDirectoryName,
        );
        renameSync(temporaryPath, repositoryDirectoryPath);
        input.afterRepositoryPublish?.();
    }
    assertPlainDirectory(repositoryDirectoryPath);
    if (!exactChildEntryExists(repositoryDirectoryPath, input.repositoryMarkerName)) {
        throw new Error('Backup repository marker is missing');
    }
    assertExactPlainFile(markerPath, input.repositoryMarkerBytes);
    const workspaceDirectoryPath = ensurePlainDirectory(
        repositoryDirectoryPath,
        input.workspaceDirectoryName,
    );
    const backupSetDirectoryPath = ensurePlainDirectory(
        workspaceDirectoryPath,
        input.backupSetDirectoryName,
    );
    verifyDirectoryCapability(destination);
    return Object.freeze({
        repositoryDirectoryPath,
        workspaceDirectoryPath,
        backupSetDirectoryPath,
    });
}

/**
 * Opens an existing repository tree read-only for a fresh snapshot-list validation.
 * @param {ReadBackupSetTreeInput} input - Exact persisted repository identities and marker bytes.
 * @return {BackupSetTree} Revalidated existing BackupSet paths.
 */
export function readBackupSetTree(input: ReadBackupSetTreeInput): BackupSetTree {
    [
        input.repositoryDirectoryName,
        input.repositoryMarkerName,
        input.workspaceDirectoryName,
        input.backupSetDirectoryName,
    ].forEach(assertComponent);
    const destination = resolveDirectoryCapability(input.destinationPath);
    if (!plainChildDirectoryExists(destination.canonicalPath, input.repositoryDirectoryName)) {
        throw new Error('Backup repository is missing');
    }
    const repositoryDirectoryPath = path.join(
        destination.canonicalPath,
        input.repositoryDirectoryName,
    );
    if (!exactChildEntryExists(repositoryDirectoryPath, input.repositoryMarkerName)) {
        throw new Error('Backup repository marker is missing');
    }
    assertExactPlainFile(
        path.join(repositoryDirectoryPath, input.repositoryMarkerName),
        input.repositoryMarkerBytes,
    );
    if (!plainChildDirectoryExists(repositoryDirectoryPath, input.workspaceDirectoryName)) {
        throw new Error('Backup Workspace directory is missing');
    }
    const workspaceDirectoryPath = path.join(
        repositoryDirectoryPath,
        input.workspaceDirectoryName,
    );
    if (!plainChildDirectoryExists(workspaceDirectoryPath, input.backupSetDirectoryName)) {
        throw new Error('BackupSet directory is missing');
    }
    const backupSetDirectoryPath = path.join(
        workspaceDirectoryPath,
        input.backupSetDirectoryName,
    );
    verifyDirectoryCapability(destination);
    return Object.freeze({
        repositoryDirectoryPath,
        workspaceDirectoryPath,
        backupSetDirectoryPath,
    });
}

/**
 * Ensures the exact operation-owned staging directory exists as a plain directory.
 * @param {string} backupSetDirectoryPath - Existing BackupSet directory.
 * @param {string} stagingDirectoryName - Persisted operation staging name.
 * @return {string} Exact staging directory path.
 */
export function ensureSnapshotStagingDirectory(
    backupSetDirectoryPath: string,
    stagingDirectoryName: string,
): string {
    assertPlainDirectory(backupSetDirectoryPath);
    return ensurePlainDirectory(backupSetDirectoryPath, stagingDirectoryName);
}

/**
 * Returns whether an exact path exists as a plain regular file.
 * @param {string} filePath - Exact operation-owned member path.
 * @return {boolean} Whether a plain file exists.
 */
export function plainFileExists(filePath: string): boolean {
    const stats = lstatSync(filePath, {throwIfNoEntry: false});
    if (!stats) {
        return false;
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
        throw new Error('Backup member identity is invalid');
    }
    return true;
}

/**
 * Returns whether one child exists under its exact case- and normalization-preserving name.
 * @param {string} parentDirectoryPath - Existing trusted plain parent directory.
 * @param {string} childDirectoryName - Exact child component owned by a durable operation.
 * @return {boolean} Whether the exact plain child directory exists.
 */
export function plainChildDirectoryExists(
    parentDirectoryPath: string,
    childDirectoryName: string,
): boolean {
    const childDirectoryPath = path.join(parentDirectoryPath, childDirectoryName);
    if (!exactChildEntryExists(parentDirectoryPath, childDirectoryName)) {
        return false;
    }
    assertPlainDirectory(childDirectoryPath);
    return true;
}

/**
 * Removes only the exact operation-owned temporary member file.
 * @param {string} filePath - Persisted operation temporary file path.
 * @return {void}
 */
export function removeTemporaryBackupFile(filePath: string): void {
    if (plainFileExists(filePath)) {
        unlinkSync(filePath);
    }
}

/**
 * Renames a complete temporary member to its immutable staging member name.
 * @param {string} temporaryPath - Existing plain temporary file.
 * @param {string} memberPath - Absent member path in the same directory.
 * @return {void}
 */
export function publishBackupMember(temporaryPath: string, memberPath: string): void {
    if (path.dirname(temporaryPath) !== path.dirname(memberPath)
        || plainFileExists(memberPath)
        || !plainFileExists(temporaryPath)) {
        throw new Error('Backup member publication precondition failed');
    }
    renameSync(temporaryPath, memberPath);
    if (!plainFileExists(memberPath)) {
        throw new Error('Backup member publication failed');
    }
}

/**
 * Writes canonical bytes once or verifies an identical idempotent replay.
 * @param {string} filePath - Exact staging member path.
 * @param {Buffer} bytes - Canonical member bytes.
 * @return {void}
 */
export function writeOrVerifyBackupFile(filePath: string, bytes: Buffer): void {
    if (!plainFileExists(filePath)) {
        writeFileSync(filePath, bytes, {flag: 'wx'});
    }
    syncPlainFile(filePath);
    assertExactPlainFile(filePath, bytes);
}

/**
 * Flushes one exact plain file through an identity-stable handle before publication.
 * @param {string} filePath - Operation-owned file to synchronize.
 * @return {void}
 */
export function syncPlainFile(filePath: string): void {
    const before = lstatSync(filePath, {bigint: true});
    if (!before.isFile() || before.isSymbolicLink()) {
        throw new Error('Backup member identity is invalid');
    }
    const handle = openSync(filePath, 'r+');
    try {
        const opened = fstatSync(handle, {bigint: true});
        if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
            throw new Error('Backup member identity changed before synchronization');
        }
        fsyncSync(handle);
        const after = fstatSync(handle, {bigint: true});
        const current = lstatSync(filePath, {bigint: true});
        if (after.dev !== opened.dev
            || after.ino !== opened.ino
            || after.size !== opened.size
            || !current.isFile()
            || current.isSymbolicLink()
            || current.dev !== opened.dev
            || current.ino !== opened.ino) {
            throw new Error('Backup member changed while it was synchronized');
        }
    }
    finally {
        closeSync(handle);
    }
}

/**
 * Reads a bounded plain file while revalidating its identity.
 * @param {string} filePath - Exact member path.
 * @param {number} maximumBytes - Inclusive raw byte ceiling.
 * @return {Buffer} Fresh member bytes.
 */
export function readBoundedPlainFile(filePath: string, maximumBytes: number): Buffer {
    const before = lstatSync(filePath);
    if (!before.isFile() || before.isSymbolicLink() || before.size > maximumBytes) {
        throw new Error('Backup member exceeds its trust boundary');
    }
    const bytes = readFileSync(filePath);
    const after = lstatSync(filePath);
    if (after.isSymbolicLink()
        || after.dev !== before.dev
        || after.ino !== before.ino
        || after.size !== before.size
        || bytes.byteLength !== before.size) {
        throw new Error('Backup member changed while it was read');
    }
    return bytes;
}

/**
 * Reads one member only after proving its named parent is a plain child directory.
 * @param {string} parentDirectoryPath - Existing trusted plain parent directory.
 * @param {string} childDirectoryName - Untrusted child component to inspect without following links.
 * @param {string} memberName - Exact plain member component.
 * @param {number} maximumBytes - Inclusive raw byte ceiling.
 * @return {Buffer} Fresh bounded member bytes.
 */
export function readBoundedPlainChildFile(
    parentDirectoryPath: string,
    childDirectoryName: string,
    memberName: string,
    maximumBytes: number,
): Buffer {
    assertPlainDirectory(parentDirectoryPath);
    assertComponent(childDirectoryName);
    assertComponent(memberName);
    const childDirectoryPath = path.join(parentDirectoryPath, childDirectoryName);
    assertPlainDirectory(childDirectoryPath);
    return readBoundedPlainFile(path.join(childDirectoryPath, memberName), maximumBytes);
}

/**
 * Computes a fresh SHA-256 and byte length from one stable plain file handle.
 * @param {string} filePath - Exact snapshot member path.
 * @param {bigint} maximumBytes - Inclusive raw byte ceiling.
 * @return {PlainFileDigest} Decimal byte length and lowercase digest.
 */
export function digestPlainFile(filePath: string, maximumBytes: bigint): PlainFileDigest {
    const before = lstatSync(filePath, {bigint: true});
    if (!before.isFile() || before.isSymbolicLink() || before.size > maximumBytes) {
        throw new Error('Backup member identity is invalid');
    }
    const handle = openSync(filePath, 'r');
    const digest = createHash('sha256');
    let total = 0n;
    try {
        const opened = fstatSync(handle, {bigint: true});
        if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
            throw new Error('Backup member identity changed before hashing');
        }
        const chunk = Buffer.allocUnsafe(64 * 1024);
        while (true) {
            const bytesRead = readSync(handle, chunk, 0, chunk.byteLength, null);
            if (bytesRead === 0) {
                break;
            }
            digest.update(chunk.subarray(0, bytesRead));
            total += BigInt(bytesRead);
        }
        const after = fstatSync(handle, {bigint: true});
        const closedPath = lstatSync(filePath, {bigint: true});
        if (after.dev !== opened.dev
            || after.ino !== opened.ino
            || after.size !== opened.size
            || !closedPath.isFile()
            || closedPath.isSymbolicLink()
            || closedPath.dev !== opened.dev
            || closedPath.ino !== opened.ino
            || total !== opened.size) {
            throw new Error('Backup member changed while hashing');
        }
        return Object.freeze({
            byteLength: total.toString(),
            sha256: digest.digest('hex'),
        });
    }
    finally {
        closeSync(handle);
    }
}

/**
 * Lists exact child names after proving the target is a plain directory.
 * @param {string} directoryPath - Snapshot staging or final directory.
 * @return {readonly string[]} Sorted child names.
 */
export function listPlainDirectory(directoryPath: string): readonly string[] {
    assertPlainDirectory(directoryPath);
    return Object.freeze(readdirSync(directoryPath).sort());
}

/**
 * Atomically publishes staging by rename within one BackupSet parent, or resumes after rename.
 * @param {string} stagingDirectoryPath - Operation staging directory.
 * @param {string} finalDirectoryPath - Immutable final snapshot directory.
 * @return {'published' | 'already-published'} Publication outcome.
 */
export function publishSnapshotDirectory(
    stagingDirectoryPath: string,
    finalDirectoryPath: string,
): 'published' | 'already-published' {
    const parentDirectoryPath = path.dirname(stagingDirectoryPath);
    if (parentDirectoryPath !== path.dirname(finalDirectoryPath)) {
        throw new Error('Snapshot publication must stay within one parent directory');
    }
    const stagingDirectoryName = path.basename(stagingDirectoryPath);
    const finalDirectoryName = path.basename(finalDirectoryPath);
    const stagingExists = plainChildDirectoryExists(
        parentDirectoryPath,
        stagingDirectoryName,
    );
    const finalExists = plainChildDirectoryExists(
        parentDirectoryPath,
        finalDirectoryName,
    );
    if (stagingExists && finalExists) {
        throw new Error('Snapshot staging and final directories both exist');
    }
    if (finalExists) {
        return 'already-published';
    }
    if (!stagingExists) {
        throw new Error('Snapshot staging directory is missing');
    }
    renameSync(stagingDirectoryPath, finalDirectoryPath);
    if (!plainChildDirectoryExists(parentDirectoryPath, finalDirectoryName)) {
        throw new Error('Snapshot final directory is missing after publication');
    }
    return 'published';
}

/**
 * Atomically moves one exact final snapshot to its persisted same-parent quarantine name.
 * @param {string} backupSetDirectoryPath - Existing BackupSet directory.
 * @param {string} snapshotDirectoryName - Registered final snapshot component.
 * @param {string} quarantineDirectoryName - Persisted cleanup quarantine component.
 * @return {'quarantined' | 'already-quarantined'} Idempotent rename outcome.
 */
export function quarantineSnapshotDirectory(
    backupSetDirectoryPath: string,
    snapshotDirectoryName: string,
    quarantineDirectoryName: string,
): 'quarantined' | 'already-quarantined' {
    assertPlainDirectory(backupSetDirectoryPath);
    assertComponent(snapshotDirectoryName);
    assertComponent(quarantineDirectoryName);
    const snapshotDirectoryPath = path.join(backupSetDirectoryPath, snapshotDirectoryName);
    const quarantineDirectoryPath = path.join(backupSetDirectoryPath, quarantineDirectoryName);
    const snapshotExists = plainChildDirectoryExists(
        backupSetDirectoryPath,
        snapshotDirectoryName,
    );
    const quarantineExists = plainChildDirectoryExists(
        backupSetDirectoryPath,
        quarantineDirectoryName,
    );
    if (snapshotExists && quarantineExists) {
        throw new Error('Snapshot final and quarantine directories both exist');
    }
    if (quarantineExists) {
        assertPlainDirectory(quarantineDirectoryPath);
        return 'already-quarantined';
    }
    if (!snapshotExists) {
        throw new Error('Snapshot cleanup source is missing');
    }
    assertPlainDirectory(snapshotDirectoryPath);
    renameSync(snapshotDirectoryPath, quarantineDirectoryPath);
    assertPlainDirectory(quarantineDirectoryPath);
    return 'quarantined';
}

/**
 * Deletes only an exact, fully enumerated quarantine directory without recursive removal.
 * @param {string} backupSetDirectoryPath - Existing BackupSet directory.
 * @param {string} quarantineDirectoryName - Persisted cleanup quarantine component.
 * @param {readonly string[]} expectedMemberNames - Complete expected plain-file closure.
 * @return {'member-deleted' | 'deleted' | 'already-deleted'} One bounded deletion outcome.
 */
export function deleteQuarantinedSnapshotDirectory(
    backupSetDirectoryPath: string,
    quarantineDirectoryName: string,
    expectedMemberNames: readonly string[],
): 'member-deleted' | 'deleted' | 'already-deleted' {
    assertPlainDirectory(backupSetDirectoryPath);
    assertComponent(quarantineDirectoryName);
    expectedMemberNames.forEach(assertComponent);
    if (new Set(expectedMemberNames).size !== expectedMemberNames.length) {
        throw new TypeError('Quarantine members must be unique');
    }
    const quarantineDirectoryPath = path.join(backupSetDirectoryPath, quarantineDirectoryName);
    if (!plainChildDirectoryExists(backupSetDirectoryPath, quarantineDirectoryName)) {
        return 'already-deleted';
    }
    assertPlainDirectory(quarantineDirectoryPath);
    const expectedMembers = new Set(expectedMemberNames);
    const observedMemberNames = readdirSync(quarantineDirectoryPath);
    if (observedMemberNames.some(memberName => !expectedMembers.has(memberName))) {
        throw new Error('Quarantine directory closure changed');
    }
    const observedMembers = new Set(observedMemberNames);
    const nextMemberName = expectedMemberNames.find(memberName => (
        observedMembers.has(memberName)
    ));
    if (nextMemberName !== undefined) {
        const directoryIdentity = lstatSync(quarantineDirectoryPath, {bigint: true});
        const memberPath = path.join(quarantineDirectoryPath, nextMemberName);
        const member = lstatSync(memberPath);
        if (!member.isFile() || member.isSymbolicLink()) {
            throw new Error('Quarantine member identity is invalid');
        }
        unlinkSync(memberPath);
        const currentDirectory = lstatSync(quarantineDirectoryPath, {bigint: true});
        if (!currentDirectory.isDirectory()
            || currentDirectory.isSymbolicLink()
            || currentDirectory.dev !== directoryIdentity.dev
            || currentDirectory.ino !== directoryIdentity.ino) {
            throw new Error('Quarantine directory identity changed during cleanup');
        }
        return 'member-deleted';
    }
    if (readdirSync(quarantineDirectoryPath).length !== 0) {
        throw new Error('Quarantine directory closure changed');
    }
    rmdirSync(quarantineDirectoryPath);
    return 'deleted';
}
