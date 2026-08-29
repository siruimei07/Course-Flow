import {createHash, randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {canonicalJson} from '../shared/canonical-json';
/**
 * @file Owns ADR-08 A-only Restore activation plans, journals, restart inspection, continuation, and rollback.
 */


import {
    CURRENT_SCHEMA_LEVEL,
} from '../data/schema';
import {
    inspectRestoreCompletionReceipt,
    inspectRestoreDataSlot,
    openWorkspaceData,
    type RestoreCompletionReceipt,
    type RestoreCompletionReceiptInput,
    type SqliteDataStore,
} from '../data/sqlite-data-store';
import {
    listPlainDirectory,
    plainChildDirectoryExists,
    plainFileExists,
    publishBackupMember,
    readBoundedPlainFile,
    syncPlainFile,
} from '../platform/backup-snapshot-files';
import {
    observeRestoreDataSlot,
    renameRestoreDataSlot,
    requireRestoreSameVolume,
    stageRestoreDataSlot,
    type RestoreActivationFileOptions,
    type RestoreDataSlotObservation,
} from '../platform/restore-activation-files';
import {
    isRestoreSessionView,
    type RestoreSessionActionCommand,
    type RestoreSessionView,
} from '../shared/workspace-protection-contract';
import {
    isCanonicalUnsignedSqliteInteger,
    isCanonicalUuid,
} from '../shared/workspace-data-contract';

export {
    RestoreActivationError,
    type BeginRestoreActivationInput,
    type RestoreActivationFailpoint,
    type RestoreActivationOptions,
    type RestoreActivationResult,
    type RestoreBootState,
    type RestoreTerminalEvidence,
} from './restore-activation/protocol';
export {
    beginRestoreActivation,
    continueRestoreActivation,
    inspectRestoreBeforeWorkspaceOpen,
    recordRestoreSessionControl,
    rollbackRestoreActivation,
} from './restore-activation/activation';
