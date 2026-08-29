import {createHash, randomUUID} from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {canonicalJson} from '../shared/canonical-json';
import {inspectRestoreBeforeWorkspaceOpen} from './restore-activation';
/**
 * @file Owns the bounded ADR-10 MigrationRollbackHandoffV1 physical coordination kernel.
 */


import {
    ensureSnapshotStagingDirectory,
    listPlainDirectory,
    plainChildDirectoryExists,
    plainFileExists,
    publishBackupMember,
    publishSnapshotDirectory,
    readBoundedPlainFile,
    syncPlainFile,
} from '../platform/backup-snapshot-files';
import {
    observeRestoreDataSlot,
    renameRestoreDataSlot,
    requireRestoreSameVolume,
    type RestoreActivationFileOptions,
    type RestoreDataSlotFingerprint,
    type RestoreDataSlotObservation,
} from '../platform/restore-activation-files';
import {
    isCanonicalUnsignedSqliteInteger,
    isCanonicalUuid,
} from '../shared/workspace-data-contract';

export {
    MigrationRollbackHandoffError,
    type MigrationRollbackBaseCompletionCallbacks,
    type MigrationRollbackBootState,
    type MigrationRollbackCommand,
    type MigrationRollbackDataIdentity,
    type MigrationRollbackHandoffFacts,
    type MigrationRollbackHandoffOptions,
    type MigrationRollbackSafetyStagingPort,
    type MigrationRollbackStatus,
    type MigrationRollbackTargetCompletionCallbacks,
    type NonterminalMigrationRollbackInspection,
} from './migration-rollback-handoff/protocol';
export {
    armMigrationRollbackHandoff,
    cancelMigrationRollbackHandoff,
    continueMigrationRollbackHandoff,
    createMigrationRollbackHandoff,
    inspectMigrationRollbackBeforeWorkspaceOpen,
    inspectMigrationRollbackHandoffFacts,
    inspectNonterminalMigrationRollback,
    prepareMigrationRollbackHandoff,
} from './migration-rollback-handoff/handoff';
