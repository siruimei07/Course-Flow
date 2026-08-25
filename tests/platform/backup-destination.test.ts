/**
 * @file Verifies backup destination isolation and repository identity preparation.
 */

import assert from 'node:assert/strict';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    renameSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    directoryCapabilitiesOverlap,
    resolveDirectoryCapability,
} from '../../src/platform/backup-destination';
import {
    BackupDestinationPreparationError,
    prepareBackupDestination,
} from '../../src/protect/backup-repository';
import { BACKUP_REPOSITORY_SCHEMA } from '../../src/shared/workspace-protection-contract';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const FIRST_BACKUP_SET_ID = '22222222-2222-4222-8222-222222222222';
const SECOND_BACKUP_SET_ID = '33333333-3333-4333-8333-333333333333';

type TestRoots = Readonly<{
    root: string;
    activeData: string;
    library: string;
    destination: string;
}>;

function createRoots(t: test.TestContext): TestRoots {
    const root = mkdtempSync(path.join(tmpdir(), 'courseflow-backup-destination-'));
    const activeData = path.join(root, 'data-slots', 'active');
    const library = path.join(root, 'library-container', 'library');
    const destination = path.join(root, 'backup');
    for (const directory of [activeData, library, destination]) {
        mkdirSync(directory, { recursive: true });
    }
    t.after(() => rmSync(root, { recursive: true, force: true }));
    return { root, activeData, library, destination };
}

function preparationInput(
    roots: TestRoots,
    destinationPath: string,
    backupSetId = FIRST_BACKUP_SET_ID,
) {
    return {
        destinationPath,
        activeDataDirectoryPath: roots.activeData,
        libraryRootPath: roots.library,
        workspaceId: WORKSPACE_ID,
        backupSetId,
    } as const;
}

function assertOverlap(
    roots: TestRoots,
    destinationPath: string,
    location: 'active-data' | 'library-root',
): void {
    assert.throws(
        () => prepareBackupDestination(preparationInput(roots, destinationPath)),
        (error: unknown) => error instanceof BackupDestinationPreparationError
            && error.reason === 'location-overlap'
            && error.location === location,
    );
    assert.equal(existsSync(path.join(destinationPath, 'CourseFlow')), false);
}

test('active DATA, LibraryRoot, and backup destination reject same, ancestor, and descendant overlap', t => {
    const roots = createRoots(t);
    const activeDescendant = path.join(roots.activeData, 'nested');
    const libraryDescendant = path.join(roots.library, 'nested');
    mkdirSync(activeDescendant);
    mkdirSync(libraryDescendant);

    assertOverlap(roots, roots.activeData, 'active-data');
    assertOverlap(roots, path.dirname(roots.activeData), 'active-data');
    assertOverlap(roots, activeDescendant, 'active-data');
    assertOverlap(roots, roots.library, 'library-root');
    assertOverlap(roots, path.dirname(roots.library), 'library-root');
    assertOverlap(roots, libraryDescendant, 'library-root');
});

test('resolved directory aliases cannot hide an overlap with active DATA', t => {
    const roots = createRoots(t);
    const alias = path.join(roots.root, 'active-data-alias');
    try {
        symlinkSync(roots.activeData, alias, process.platform === 'win32' ? 'junction' : 'dir');
    }
    catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error
            ? (error as { code?: unknown }).code
            : undefined;
        if (code === 'EACCES' || code === 'EPERM') {
            t.skip('The host does not permit creating a directory alias');
            return;
        }
        throw error;
    }

    assertOverlap(roots, alias, 'active-data');
});

test('stable directory identities detect disjoint aliases and aliased ancestors', t => {
    const roots = createRoots(t);
    const activeData = resolveDirectoryCapability(roots.activeData);
    const activeDataParent = resolveDirectoryCapability(path.dirname(roots.activeData));
    const disjointDirectAlias = Object.freeze({
        ...activeData,
        canonicalPath: roots.library,
    });
    const disjointAncestorAlias = Object.freeze({
        ...activeDataParent,
        canonicalPath: roots.destination,
    });

    assert.equal(directoryCapabilitiesOverlap(activeData, disjointDirectAlias), true);
    assert.equal(directoryCapabilitiesOverlap(disjointAncestorAlias, activeData), true);
});

test('Windows device namespace paths are rejected before repository preparation', t => {
    if (process.platform !== 'win32') {
        t.skip('Windows path grammar only');
        return;
    }
    const roots = createRoots(t);
    const devicePath = `\\\\?\\${roots.destination}`;

    assert.throws(
        () => prepareBackupDestination(preparationInput(roots, devicePath)),
        (error: unknown) => error instanceof BackupDestinationPreparationError
            && error.reason === 'invalid-location',
    );
    assert.equal(existsSync(path.join(roots.destination, 'CourseFlow')), false);
});

test('repository, Workspace, and BackupSet identities remain nested and independent', t => {
    const roots = createRoots(t);
    const unrelatedPath = path.join(roots.destination, 'unrelated.txt');
    writeFileSync(unrelatedPath, 'belongs to the user');

    const first = prepareBackupDestination(preparationInput(roots, roots.destination));
    assert.equal(existsSync(first.repositoryDirectoryPath), false);
    mkdirSync(first.workspaceDirectoryPath, { recursive: true });
    writeFileSync(path.join(first.repositoryDirectoryPath, 'repository-v1.json'), JSON.stringify({
        schema: BACKUP_REPOSITORY_SCHEMA,
    }));
    mkdirSync(first.backupSetDirectoryPath);
    const firstSentinel = path.join(first.backupSetDirectoryPath, 'first-set-only.txt');
    writeFileSync(firstSentinel, 'do not select, count, or clean from another set');
    const second = prepareBackupDestination(preparationInput(
        roots,
        roots.destination,
        SECOND_BACKUP_SET_ID,
    ));

    assert.equal(readFileSync(path.join(first.repositoryDirectoryPath, 'repository-v1.json'), 'utf8'), JSON.stringify({
        schema: BACKUP_REPOSITORY_SCHEMA,
    }));
    assert.equal(first.workspaceDirectoryPath, second.workspaceDirectoryPath);
    assert.notEqual(first.backupSetDirectoryPath, second.backupSetDirectoryPath);
    assert.equal(path.basename(first.backupSetDirectoryPath), FIRST_BACKUP_SET_ID);
    assert.equal(path.basename(second.backupSetDirectoryPath), SECOND_BACKUP_SET_ID);
    assert.equal(readFileSync(firstSentinel, 'utf8'), 'do not select, count, or clean from another set');
    assert.equal(readFileSync(unrelatedPath, 'utf8'), 'belongs to the user');
    assert.deepEqual(readdirSync(first.workspaceDirectoryPath), [FIRST_BACKUP_SET_ID]);
    assert.equal(existsSync(second.backupSetDirectoryPath), false);
});

test('a selected root identity swap is rejected before configuration can commit', t => {
    const roots = createRoots(t);
    const originalDestination = path.join(roots.root, 'original-backup');
    let aliasCreationUnavailable = false;
    let failure: unknown;

    try {
        prepareBackupDestination({
            ...preparationInput(roots, roots.destination),
            failpoint(point) {
                if (point !== 'prepare.after-location-validation') {
                    return;
                }
                renameSync(roots.destination, originalDestination);
                try {
                    symlinkSync(
                        roots.activeData,
                        roots.destination,
                        process.platform === 'win32' ? 'junction' : 'dir',
                    );
                }
                catch (error) {
                    renameSync(originalDestination, roots.destination);
                    const code = typeof error === 'object' && error !== null && 'code' in error
                        ? (error as { code?: unknown }).code
                        : undefined;
                    aliasCreationUnavailable = code === 'EACCES' || code === 'EPERM';
                    throw error;
                }
            },
        });
    }
    catch (error) {
        failure = error;
    }
    if (aliasCreationUnavailable) {
        t.skip('The host does not permit replacing a directory with an alias');
        return;
    }

    assert.ok(failure instanceof BackupDestinationPreparationError);
    assert.equal(failure.reason, 'invalid-location');
    assert.equal(existsSync(path.join(roots.activeData, 'CourseFlow')), false);
    assert.equal(existsSync(path.join(originalDestination, 'CourseFlow')), false);
});

test('an existing Workspace directory replacement is rejected before the write probe', t => {
    const roots = createRoots(t);
    const repositoryDirectory = path.join(roots.destination, 'CourseFlow');
    const workspaceDirectory = path.join(repositoryDirectory, WORKSPACE_ID);
    const originalWorkspaceDirectory = path.join(repositoryDirectory, `${WORKSPACE_ID}-original`);
    mkdirSync(workspaceDirectory, { recursive: true });
    writeFileSync(path.join(repositoryDirectory, 'repository-v1.json'), JSON.stringify({
        schema: BACKUP_REPOSITORY_SCHEMA,
    }));

    assert.throws(
        () => prepareBackupDestination({
            ...preparationInput(roots, roots.destination),
            failpoint(point) {
                if (point === 'prepare.after-tree-inspection') {
                    renameSync(workspaceDirectory, originalWorkspaceDirectory);
                    mkdirSync(workspaceDirectory);
                }
            },
        }),
        (error: unknown) => error instanceof BackupDestinationPreparationError
            && error.reason === 'invalid-location',
    );
    assert.deepEqual(readdirSync(workspaceDirectory), []);
    assert.deepEqual(readdirSync(originalWorkspaceDirectory), []);
    assert.equal(existsSync(path.join(workspaceDirectory, FIRST_BACKUP_SET_ID)), false);
});

test('an existing CourseFlow directory without the exact repository marker is not claimed', t => {
    const roots = createRoots(t);
    const repositoryDirectory = path.join(roots.destination, 'CourseFlow');
    mkdirSync(repositoryDirectory);
    writeFileSync(path.join(repositoryDirectory, 'unrelated.txt'), 'not ours');

    assert.throws(
        () => prepareBackupDestination(preparationInput(roots, roots.destination)),
        (error: unknown) => error instanceof BackupDestinationPreparationError
            && error.reason === 'identity-conflict',
    );
    assert.equal(existsSync(path.join(repositoryDirectory, WORKSPACE_ID)), false);
});

test('an oversized repository marker is rejected without claiming its directory', t => {
    const roots = createRoots(t);
    const repositoryDirectory = path.join(roots.destination, 'CourseFlow');
    mkdirSync(repositoryDirectory);
    writeFileSync(path.join(repositoryDirectory, 'repository-v1.json'), 'x'.repeat(1024 * 1024));

    assert.throws(
        () => prepareBackupDestination(preparationInput(roots, roots.destination)),
        (error: unknown) => error instanceof BackupDestinationPreparationError
            && error.reason === 'identity-conflict',
    );
    assert.equal(existsSync(path.join(repositoryDirectory, WORKSPACE_ID)), false);
});

test('a repository marker link cannot establish CourseFlow ownership', t => {
    const roots = createRoots(t);
    const repositoryDirectory = path.join(roots.destination, 'CourseFlow');
    const markerTarget = path.join(roots.root, 'marker-target.json');
    mkdirSync(repositoryDirectory);
    writeFileSync(markerTarget, JSON.stringify({ schema: BACKUP_REPOSITORY_SCHEMA }));
    try {
        symlinkSync(markerTarget, path.join(repositoryDirectory, 'repository-v1.json'), 'file');
    }
    catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error
            ? (error as { code?: unknown }).code
            : undefined;
        if (code === 'EACCES' || code === 'EPERM') {
            t.skip('The host does not permit creating a file link');
            return;
        }
        throw error;
    }

    assert.throws(
        () => prepareBackupDestination(preparationInput(roots, roots.destination)),
        (error: unknown) => error instanceof BackupDestinationPreparationError
            && error.reason === 'identity-conflict',
    );
    assert.equal(existsSync(path.join(repositoryDirectory, WORKSPACE_ID)), false);
});
