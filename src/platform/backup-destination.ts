/**
 * @file Provides narrow canonical-directory, managed-tree inspection, and write-probe capabilities.
 */

import {
    closeSync,
    fstatSync,
    lstatSync,
    mkdtempSync,
    openSync,
    realpathSync,
    readSync,
    rmdirSync,
    statSync,
} from 'node:fs';
import path from 'node:path';

export type FileSystemCapabilityFailure =
    | 'invalid-location'
    | 'location-changed'
    | 'identity-conflict'
    | 'permission';

export class FileSystemCapabilityError extends Error {
    public constructor(public readonly reason: FileSystemCapabilityFailure) {
        super('Filesystem capability failed');
        this.name = 'FileSystemCapabilityError';
    }
}

export type DirectoryCapability = Readonly<{
    canonicalPath: string;
    displayName: string | null;
    device: bigint;
    inode: bigint;
}>;

export type ManagedDirectoryTreeInput = Readonly<{
    root: DirectoryCapability;
    managedDirectoryName: string;
    marker: Readonly<{
        fileName: string;
        contents: string;
    }>;
    identityDirectoryNames: readonly string[];
}>;

export type ManagedDirectoryTree = Readonly<{
    managedDirectoryPath: string;
    managedDirectoryExists: boolean;
    managedDirectoryCapability: DirectoryCapability | null;
    identityDirectoryPaths: readonly string[];
    identityDirectoryExists: readonly boolean[];
    identityDirectoryCapabilities: readonly (DirectoryCapability | null)[];
    deepestExistingDirectoryCapability: DirectoryCapability;
}>;

function failureFor(error: unknown, fallback: FileSystemCapabilityFailure): FileSystemCapabilityError {
    if (error instanceof FileSystemCapabilityError) {
        return error;
    }
    const code = typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: unknown }).code
        : undefined;
    return new FileSystemCapabilityError(
        code === 'EACCES' || code === 'EPERM' || code === 'EROFS' ? 'permission' : fallback,
    );
}

function isWindowsDevicePath(directoryPath: string): boolean {
    return process.platform === 'win32'
        && (directoryPath.startsWith('\\\\?\\') || directoryPath.startsWith('\\\\.\\'));
}

function safeDisplayName(canonicalPath: string): string | null {
    const baseName = path.basename(canonicalPath).trim();
    return baseName.length > 0 ? baseName : null;
}

/**
 * Resolves one existing absolute directory into a revalidatable local capability.
 * @param {string} directoryPath - Platform directory path.
 * @return {DirectoryCapability} Canonical path and stable in-process identity evidence.
 */
export function resolveDirectoryCapability(directoryPath: string): DirectoryCapability {
    if (!path.isAbsolute(directoryPath) || directoryPath.includes('\0') || isWindowsDevicePath(directoryPath)) {
        throw new FileSystemCapabilityError('invalid-location');
    }
    try {
        const canonicalPath = realpathSync.native(directoryPath);
        const linkStats = lstatSync(canonicalPath);
        const stats = statSync(canonicalPath, { bigint: true });
        if (!linkStats.isDirectory() || linkStats.isSymbolicLink() || !stats.isDirectory()) {
            throw new FileSystemCapabilityError('invalid-location');
        }
        return Object.freeze({
            canonicalPath,
            displayName: safeDisplayName(canonicalPath),
            device: stats.dev,
            inode: stats.ino,
        });
    }
    catch (error) {
        throw failureFor(error, 'invalid-location');
    }
}

/**
 * Revalidates that a canonical directory capability still names the same plain directory.
 * @param {DirectoryCapability} capability - Earlier resolved directory evidence.
 * @return {void}
 */
export function verifyDirectoryCapability(capability: DirectoryCapability): void {
    let current: DirectoryCapability;
    try {
        current = resolveDirectoryCapability(capability.canonicalPath);
    }
    catch {
        throw new FileSystemCapabilityError('location-changed');
    }
    if (!directoryCapabilitiesEqual(current, capability)) {
        throw new FileSystemCapabilityError('location-changed');
    }
}

/**
 * Compares two resolved directory identities without depending on display text.
 * @param {DirectoryCapability} first - First resolved identity.
 * @param {DirectoryCapability} second - Second resolved identity.
 * @return {boolean} Whether both capabilities identify the same directory.
 */
export function directoryCapabilitiesEqual(
    first: DirectoryCapability,
    second: DirectoryCapability,
): boolean {
    return first.device === second.device
        && first.inode === second.inode;
}

function containsPath(parent: string, candidate: string): boolean {
    const relative = path.relative(parent, candidate);
    return relative === ''
        || (relative !== '..'
            && !relative.startsWith(`..${path.sep}`)
            && !path.isAbsolute(relative));
}

function capabilityContains(
    parent: DirectoryCapability,
    candidate: DirectoryCapability,
): boolean {
    if (containsPath(parent.canonicalPath, candidate.canonicalPath)
        || directoryCapabilitiesEqual(parent, candidate)) {
        return true;
    }
    let currentPath = candidate.canonicalPath;
    while (true) {
        const current = resolveDirectoryCapability(currentPath);
        if (directoryCapabilitiesEqual(parent, current)) {
            return true;
        }
        const nextPath = path.dirname(currentPath);
        if (nextPath === currentPath) {
            return false;
        }
        currentPath = nextPath;
    }
}

/**
 * Compares two canonical capabilities by component boundary rather than text prefix.
 * @param {DirectoryCapability} first - First canonical directory.
 * @param {DirectoryCapability} second - Second canonical directory.
 * @return {boolean} Whether either directory contains the other.
 */
export function directoryCapabilitiesOverlap(
    first: DirectoryCapability,
    second: DirectoryCapability,
): boolean {
    return capabilityContains(first, second) || capabilityContains(second, first);
}

function assertPathComponent(component: string): void {
    if (component.length === 0
        || component === '.'
        || component === '..'
        || component.includes('\0')
        || path.basename(component) !== component) {
        throw new TypeError('Managed directory component is invalid');
    }
}

function assertPlainDirectory(directoryPath: string): void {
    let stats: ReturnType<typeof lstatSync>;
    try {
        stats = lstatSync(directoryPath);
    }
    catch (error) {
        throw failureFor(error, 'identity-conflict');
    }
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new FileSystemCapabilityError('identity-conflict');
    }
}

function assertExactPlainFile(filePath: string, expectedContents: string): void {
    const expected = Buffer.from(expectedContents, 'utf8');
    let handle: number | null = null;
    try {
        const before = lstatSync(filePath, { bigint: true });
        if (!before.isFile() || before.isSymbolicLink()) {
            throw new FileSystemCapabilityError('identity-conflict');
        }
        handle = openSync(filePath, 'r');
        const opened = fstatSync(handle, { bigint: true });
        if (!opened.isFile()
            || opened.dev !== before.dev
            || opened.ino !== before.ino
            || opened.size !== BigInt(expected.byteLength)) {
            throw new FileSystemCapabilityError('identity-conflict');
        }
        const actual = Buffer.alloc(expected.byteLength + 1);
        let totalBytesRead = 0;
        while (totalBytesRead < actual.byteLength) {
            const bytesRead = readSync(
                handle,
                actual,
                totalBytesRead,
                actual.byteLength - totalBytesRead,
                totalBytesRead,
            );
            if (bytesRead === 0) {
                break;
            }
            totalBytesRead += bytesRead;
        }
        const closedOver = fstatSync(handle, { bigint: true });
        const after = lstatSync(filePath, { bigint: true });
        if (totalBytesRead !== expected.byteLength
            || !actual.subarray(0, totalBytesRead).equals(expected)
            || closedOver.dev !== opened.dev
            || closedOver.ino !== opened.ino
            || closedOver.size !== opened.size
            || after.isSymbolicLink()
            || after.dev !== opened.dev
            || after.ino !== opened.ino) {
            throw new FileSystemCapabilityError('identity-conflict');
        }
    }
    catch (error) {
        throw failureFor(error, 'identity-conflict');
    }
    finally {
        if (handle !== null) {
            closeSync(handle);
        }
    }
}

function inspectOptionalPlainDirectory(
    root: DirectoryCapability,
    directoryPath: string,
): DirectoryCapability | null {
    try {
        const stats = lstatSync(directoryPath, { throwIfNoEntry: false });
        if (!stats) {
            return null;
        }
        if (!stats.isDirectory() || stats.isSymbolicLink()) {
            throw new FileSystemCapabilityError('identity-conflict');
        }
        const capability = resolveDirectoryCapability(directoryPath);
        if (!containsPath(root.canonicalPath, capability.canonicalPath)) {
            throw new FileSystemCapabilityError('identity-conflict');
        }
        return capability;
    }
    catch (error) {
        throw failureFor(error, 'identity-conflict');
    }
}

/**
 * Derives exact paths and validates only identities that already exist; it never creates the tree.
 * @param {ManagedDirectoryTreeInput} input - Caller-owned names and marker bytes.
 * @return {ManagedDirectoryTree} Existing states and exact derived paths.
 */
export function inspectManagedDirectoryTree(input: ManagedDirectoryTreeInput): ManagedDirectoryTree {
    assertPathComponent(input.managedDirectoryName);
    assertPathComponent(input.marker.fileName);
    input.identityDirectoryNames.forEach(assertPathComponent);
    verifyDirectoryCapability(input.root);

    const managedDirectoryPath = path.join(input.root.canonicalPath, input.managedDirectoryName);
    const managedDirectoryCapability = inspectOptionalPlainDirectory(input.root, managedDirectoryPath);
    const managedDirectoryExists = managedDirectoryCapability !== null;
    if (managedDirectoryCapability !== null) {
        const markerPath = path.join(managedDirectoryPath, input.marker.fileName);
        assertExactPlainFile(markerPath, input.marker.contents);
    }

    const identityDirectoryPaths: string[] = [];
    const identityDirectoryExists: boolean[] = [];
    const identityDirectoryCapabilities: (DirectoryCapability | null)[] = [];
    let parentPath = managedDirectoryPath;
    let parentExists = managedDirectoryExists;
    let deepestExistingDirectoryCapability = managedDirectoryCapability
        ?? input.root;
    for (const directoryName of input.identityDirectoryNames) {
        parentPath = path.join(parentPath, directoryName);
        const capability = parentExists
            ? inspectOptionalPlainDirectory(input.root, parentPath)
            : null;
        const exists = capability !== null;
        identityDirectoryPaths.push(parentPath);
        identityDirectoryExists.push(exists);
        identityDirectoryCapabilities.push(capability);
        if (capability !== null) {
            deepestExistingDirectoryCapability = capability;
        }
        parentExists = exists;
    }
    verifyDirectoryCapability(input.root);
    return Object.freeze({
        managedDirectoryPath,
        managedDirectoryExists,
        managedDirectoryCapability,
        identityDirectoryPaths: Object.freeze(identityDirectoryPaths),
        identityDirectoryExists: Object.freeze(identityDirectoryExists),
        identityDirectoryCapabilities: Object.freeze(identityDirectoryCapabilities),
        deepestExistingDirectoryCapability,
    });
}

/**
 * Proves that one existing plain directory can create and remove an exact empty child.
 * @param {DirectoryCapability} root - Stable root capability containing the directory.
 * @param {DirectoryCapability} directory - Exact existing directory to probe.
 * @return {void}
 */
export function probeDirectoryWrite(
    root: DirectoryCapability,
    directory: DirectoryCapability,
): void {
    verifyDirectoryCapability(root);
    verifyDirectoryCapability(directory);
    if (!containsPath(root.canonicalPath, directory.canonicalPath)) {
        throw new FileSystemCapabilityError('identity-conflict');
    }
    let probePath: string | null = null;
    try {
        probePath = mkdtempSync(path.join(directory.canonicalPath, '.write-probe-'));
        assertPlainDirectory(probePath);
        rmdirSync(probePath);
        probePath = null;
    }
    catch (error) {
        throw failureFor(error, 'permission');
    }
    finally {
        if (probePath !== null) {
            try {
                rmdirSync(probePath);
            }
            catch {
                // The exact probe remains non-authoritative and is never recursively removed.
            }
        }
    }
    verifyDirectoryCapability(directory);
    verifyDirectoryCapability(root);
}
