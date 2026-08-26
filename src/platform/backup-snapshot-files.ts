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
    if (!pathEntryExists(directoryPath)) {
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
    if (!pathEntryExists(repositoryDirectoryPath)) {
        const temporaryPath = ensurePlainDirectory(
            destination.canonicalPath,
            input.repositoryTemporaryName,
        );
        const temporaryMarkerPath = path.join(temporaryPath, input.repositoryMarkerName);
        if (!pathEntryExists(temporaryMarkerPath)) {
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
    if (path.dirname(stagingDirectoryPath) !== path.dirname(finalDirectoryPath)) {
        throw new Error('Snapshot publication must stay within one parent directory');
    }
    const stagingExists = pathEntryExists(stagingDirectoryPath);
    const finalExists = pathEntryExists(finalDirectoryPath);
    if (stagingExists && finalExists) {
        throw new Error('Snapshot staging and final directories both exist');
    }
    if (finalExists) {
        assertPlainDirectory(finalDirectoryPath);
        return 'already-published';
    }
    if (!stagingExists) {
        throw new Error('Snapshot staging directory is missing');
    }
    assertPlainDirectory(stagingDirectoryPath);
    renameSync(stagingDirectoryPath, finalDirectoryPath);
    assertPlainDirectory(finalDirectoryPath);
    return 'published';
}
