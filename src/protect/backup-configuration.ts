/**
 * @file Owns backup configuration identity and coordinates narrow PLATFORM and DATA ports.
 */

import { randomUUID } from 'node:crypto';

import {
    prepareBackupDestination,
    validateBackupDestinationLocation,
} from './backup-repository';
import {
    BACKUP_REPOSITORY_SCHEMA,
    normalizeAcceptedConfigureBackupDestinationCommand,
    type AcceptedConfigureBackupDestinationCommand,
    type ConfigureBackupDestinationCommand,
    type DataProtectionProjection,
} from '../shared/workspace-protection-contract';

type StoredBackupDestination = AcceptedConfigureBackupDestinationCommand['destination'];

export type BackupConfigurationQueryPort = Readonly<{
    readProtection(): DataProtectionProjection;
}>;

export type BackupConfigurationDataPort<CommitResult> = BackupConfigurationQueryPort & Readonly<{
    readDestinationForCommand(commandId: string): StoredBackupDestination | null;
    commit(command: AcceptedConfigureBackupDestinationCommand): Promise<CommitResult>;
}>;

export type ConfigureBackupDestinationInput = Readonly<{
    command: ConfigureBackupDestinationCommand;
    selectedDirectoryPath: string;
    activeDataDirectoryPath: string;
    libraryRootPath: string | null;
}>;

/**
 * Reads the PROTECT-owned path-free projection through its narrowed DATA port.
 * @param {BackupConfigurationQueryPort} data - Workspace-adapted DATA capability.
 * @return {DataProtectionProjection} Current legal configuration state.
 */
export function readDataProtectionProjection(
    data: BackupConfigurationQueryPort,
): DataProtectionProjection {
    return data.readProtection();
}

/**
 * Validates a destination, assigns one stable identity, then delegates the formal commit to DATA.
 * @param {BackupConfigurationDataPort<CommitResult>} data - Narrow DATA capability.
 * @param {ConfigureBackupDestinationInput} input - Path-free intent plus trusted PLATFORM facts.
 * @return {Promise<CommitResult>} DATA-owned durable receipt or structured problem.
 */
export async function configureBackupDestination<CommitResult>(
    data: BackupConfigurationDataPort<CommitResult>,
    input: ConfigureBackupDestinationInput,
): Promise<CommitResult> {
    const storedDestination = data.readDestinationForCommand(input.command.commandId);
    let destination: StoredBackupDestination;
    if (storedDestination === null) {
        const backupSetId = randomUUID();
        const prepared = prepareBackupDestination({
            destinationPath: input.selectedDirectoryPath,
            activeDataDirectoryPath: input.activeDataDirectoryPath,
            libraryRootPath: input.libraryRootPath,
            workspaceId: input.command.workspaceId,
            backupSetId,
        });
        destination = {
            backupSetId,
            canonicalPath: prepared.canonicalDestinationPath,
            displayName: prepared.destinationDisplayName,
            repositorySchema: BACKUP_REPOSITORY_SCHEMA,
        };
    }
    else {
        const selected = validateBackupDestinationLocation({
            destinationPath: input.selectedDirectoryPath,
            activeDataDirectoryPath: input.activeDataDirectoryPath,
            libraryRootPath: input.libraryRootPath,
        });
        destination = selected.canonicalDestinationPath === storedDestination.canonicalPath
            ? storedDestination
            : {
                ...storedDestination,
                canonicalPath: selected.canonicalDestinationPath,
                displayName: selected.destinationDisplayName,
            };
    }
    const accepted = normalizeAcceptedConfigureBackupDestinationCommand({
        ...input.command,
        destination,
    });
    return data.commit(accepted);
}
