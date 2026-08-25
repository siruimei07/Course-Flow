/**
 * @file Owns backup location policy and repository, Workspace, and BackupSet identities.
 */

import {
    directoryCapabilitiesEqual,
    directoryCapabilitiesOverlap,
    FileSystemCapabilityError,
    inspectManagedDirectoryTree,
    probeDirectoryWrite,
    resolveDirectoryCapability,
    verifyDirectoryCapability,
    type DirectoryCapability,
} from '../platform/backup-destination';
import { isCanonicalUuid } from '../shared/workspace-data-contract';
import { BACKUP_REPOSITORY_SCHEMA } from '../shared/workspace-protection-contract';

const REPOSITORY_DIRECTORY_NAME = 'CourseFlow';
const REPOSITORY_MARKER_NAME = 'repository-v1.json';
const REPOSITORY_MARKER = JSON.stringify({ schema: BACKUP_REPOSITORY_SCHEMA });

export type BackupLocationOverlap = 'active-data' | 'library-root';
export type BackupDestinationPreparationFailure =
    | 'invalid-location'
    | 'location-overlap'
    | 'identity-conflict'
    | 'permission';
export type BackupDestinationPreparationPoint =
    | 'prepare.after-location-validation'
    | 'prepare.after-tree-inspection';

export class BackupDestinationPreparationError extends Error {
    public constructor(
        public readonly reason: BackupDestinationPreparationFailure,
        public readonly location: BackupLocationOverlap | null = null,
    ) {
        super('Backup destination preparation failed');
        this.name = 'BackupDestinationPreparationError';
    }
}

export type BackupDestinationLocationInput = Readonly<{
    destinationPath: string;
    activeDataDirectoryPath: string;
    libraryRootPath: string | null;
}>;

export type PrepareBackupDestinationInput = BackupDestinationLocationInput & Readonly<{
    workspaceId: string;
    backupSetId: string;
    failpoint?: (point: BackupDestinationPreparationPoint) => void;
}>;

export type ValidatedBackupDestinationLocation = Readonly<{
    canonicalDestinationPath: string;
    destinationDisplayName: string;
    destinationCapability: DirectoryCapability;
    activeDataCapability: DirectoryCapability;
    libraryRootCapability: DirectoryCapability | null;
}>;

export type BackupDestinationPreparation = ValidatedBackupDestinationLocation & Readonly<{
    workspaceId: string;
    backupSetId: string;
    repositoryDirectoryPath: string;
    workspaceDirectoryPath: string;
    backupSetDirectoryPath: string;
}>;

function preparationFailure(error: unknown): BackupDestinationPreparationError {
    if (error instanceof BackupDestinationPreparationError) {
        return error;
    }
    if (error instanceof FileSystemCapabilityError) {
        if (error.reason === 'permission') {
            return new BackupDestinationPreparationError('permission');
        }
        if (error.reason === 'identity-conflict') {
            return new BackupDestinationPreparationError('identity-conflict');
        }
    }
    return new BackupDestinationPreparationError('invalid-location');
}

function verifyLocation(location: ValidatedBackupDestinationLocation): void {
    verifyDirectoryCapability(location.destinationCapability);
    verifyDirectoryCapability(location.activeDataCapability);
    if (location.libraryRootCapability !== null) {
        verifyDirectoryCapability(location.libraryRootCapability);
    }
}

/**
 * Resolves and validates the three user-location boundaries without claiming repository content.
 * @param {BackupDestinationLocationInput} input - Selected and active location paths.
 * @return {ValidatedBackupDestinationLocation} Canonical location facts and capabilities.
 */
export function validateBackupDestinationLocation(
    input: BackupDestinationLocationInput,
): ValidatedBackupDestinationLocation {
    try {
        const destinationCapability = resolveDirectoryCapability(input.destinationPath);
        const activeDataCapability = resolveDirectoryCapability(input.activeDataDirectoryPath);
        if (directoryCapabilitiesOverlap(destinationCapability, activeDataCapability)) {
            throw new BackupDestinationPreparationError('location-overlap', 'active-data');
        }
        const libraryRootCapability = input.libraryRootPath === null
            ? null
            : resolveDirectoryCapability(input.libraryRootPath);
        if (libraryRootCapability !== null
            && directoryCapabilitiesOverlap(destinationCapability, libraryRootCapability)) {
            throw new BackupDestinationPreparationError('location-overlap', 'library-root');
        }
        return Object.freeze({
            canonicalDestinationPath: destinationCapability.canonicalPath,
            destinationDisplayName: destinationCapability.displayName ?? 'Backup location',
            destinationCapability,
            activeDataCapability,
            libraryRootCapability,
        });
    }
    catch (error) {
        throw preparationFailure(error);
    }
}

/**
 * Validates existing ownership, derives exact identity paths, and probes writes without creating identities.
 * Repository publication remains owned by the later persisted backup operation.
 * @param {PrepareBackupDestinationInput} input - Selected path and PROTECT-owned identities.
 * @return {BackupDestinationPreparation} Validated configuration and derived identity paths.
 */
export function prepareBackupDestination(
    input: PrepareBackupDestinationInput,
): BackupDestinationPreparation {
    if (!isCanonicalUuid(input.workspaceId) || !isCanonicalUuid(input.backupSetId)) {
        throw new TypeError('Workspace and BackupSet identities must be canonical UUIDs');
    }
    try {
        const location = validateBackupDestinationLocation(input);
        input.failpoint?.('prepare.after-location-validation');
        const tree = inspectManagedDirectoryTree({
            root: location.destinationCapability,
            managedDirectoryName: REPOSITORY_DIRECTORY_NAME,
            marker: {
                fileName: REPOSITORY_MARKER_NAME,
                contents: REPOSITORY_MARKER,
            },
            identityDirectoryNames: [input.workspaceId, input.backupSetId],
        });
        if (tree.identityDirectoryExists[1]) {
            throw new BackupDestinationPreparationError('identity-conflict');
        }
        input.failpoint?.('prepare.after-tree-inspection');
        probeDirectoryWrite(
            location.destinationCapability,
            tree.deepestExistingDirectoryCapability,
        );
        const revalidatedTree = inspectManagedDirectoryTree({
            root: location.destinationCapability,
            managedDirectoryName: REPOSITORY_DIRECTORY_NAME,
            marker: {
                fileName: REPOSITORY_MARKER_NAME,
                contents: REPOSITORY_MARKER,
            },
            identityDirectoryNames: [input.workspaceId, input.backupSetId],
        });
        const sameManagedDirectory = tree.managedDirectoryCapability === null
            ? revalidatedTree.managedDirectoryCapability === null
            : revalidatedTree.managedDirectoryCapability !== null
                && directoryCapabilitiesEqual(
                    tree.managedDirectoryCapability,
                    revalidatedTree.managedDirectoryCapability,
                );
        const sameIdentityDirectories = tree.identityDirectoryCapabilities.every(
            (capability, index) => {
                const revalidated = revalidatedTree.identityDirectoryCapabilities[index] ?? null;
                return capability === null
                    ? revalidated === null
                    : revalidated !== null && directoryCapabilitiesEqual(capability, revalidated);
            },
        );
        if (!sameManagedDirectory || !sameIdentityDirectories) {
            throw new BackupDestinationPreparationError('identity-conflict');
        }
        verifyLocation(location);
        return Object.freeze({
            ...location,
            workspaceId: input.workspaceId,
            backupSetId: input.backupSetId,
            repositoryDirectoryPath: tree.managedDirectoryPath,
            workspaceDirectoryPath: tree.identityDirectoryPaths[0]!,
            backupSetDirectoryPath: tree.identityDirectoryPaths[1]!,
        });
    }
    catch (error) {
        throw preparationFailure(error);
    }
}
