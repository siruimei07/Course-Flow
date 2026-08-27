/**
 * @file Owns WP-R6-01 restore candidate selection, preview binding, and safety sets.
 */

import {createHash, randomUUID} from 'node:crypto';
import path from 'node:path';

import {CURRENT_SCHEMA_LEVEL} from '../data/schema';
import {
    openWorkspaceData,
    type PreparedRestoreDatabaseFacts,
    type RestoreDatabaseFacts,
    type SqliteDataStore,
    type StoredRestoreCommandReceipt,
    type StoredRestoreSession,
} from '../data/sqlite-data-store';
import {
    digestPlainFile,
    ensureSnapshotStagingDirectory,
    listPlainDirectory,
    plainChildDirectoryExists,
    publishSnapshotDirectory,
    readBackupSetTree,
    readBoundedPlainFile,
    syncPlainFile,
    writeOrVerifyBackupFile,
} from '../platform/backup-snapshot-files';
import {canonicalJson} from '../shared/canonical-json';
import {
    BACKUP_REPOSITORY_SCHEMA,
    isRestoreCandidateProjection,
    isRestoreSessionView,
    normalizeCancelRestoreSessionCommand,
    normalizeResumeRestoreSessionCommand,
    normalizeRollbackRestoreSessionCommand,
    normalizeConfirmRestoreSessionCommand,
    normalizeStartRestoreSessionCommand,
    type ConfirmRestoreSessionCommand,
    type RestoreCandidateProjection,
    type RestoreImpactSummary,
    type RestoreLibraryRootBinding,
    type RestoreSessionView,
    type RestoreSessionActionCommand,
    type StartRestoreSessionCommand,
} from '../shared/workspace-protection-contract';
import {
    isCanonicalUnsignedSqliteInteger,
    isCanonicalUuid,
} from '../shared/workspace-data-contract';
import {
    SnapshotValidationError,
    validateSnapshotManifestV1,
    type ValidatedSnapshotManifestV1,
} from './snapshot-manifest';
import {
    createRestoreSafetyManifestV1,
    validateRestoreSafetyManifestV1,
} from './restore-safety-manifest';
import {inspectNonterminalMigrationRollback} from './migration-rollback-handoff';
import {
    beginRestoreActivation,
    continueRestoreActivation,
    inspectRestoreBeforeWorkspaceOpen,
    recordRestoreSessionControl,
    rollbackRestoreActivation,
    RestoreActivationError,
    type RestoreBootState,
    type RestoreTerminalEvidence,
} from './restore-activation';

const REPOSITORY_DIRECTORY_NAME = 'CourseFlow';
const REPOSITORY_MARKER_NAME = 'repository-v1.json';
const REPOSITORY_MARKER_BYTES = Buffer.from(JSON.stringify({
    schema: BACKUP_REPOSITORY_SCHEMA,
}), 'utf8');
const DATABASE_MEMBER_NAME = 'workspace.sqlite';
const MANIFEST_MEMBER_NAME = 'manifest.json';
const MANIFEST_MAXIMUM_BYTES = 67_108_864;
const SNAPSHOT_MAXIMUM_RAW_BYTES = 1_099_511_627_776n;
const SAFETY_MANIFEST_MAXIMUM_BYTES = 67_108_864;
const MODULES = Object.freeze([
    Object.freeze({moduleId: 'MOD-DATA', formatVersion: '1'}),
    Object.freeze({moduleId: 'MOD-PLAN', formatVersion: '1'}),
    Object.freeze({moduleId: 'MOD-PROTECT', formatVersion: '1'}),
    Object.freeze({moduleId: 'MOD-WORKSPACE', formatVersion: '1'}),
]);

export type RestoreCoordinatorOptions = Readonly<{
    dataSlotsRoot?: string;
    currentLibraryBinding?: () => RestoreLibraryRootBinding;
    targetBindingVersion?: () => string;
    impactSummary?: (
        candidateRevision: string,
        currentRevision: string,
    ) => RestoreImpactSummary;
    identityFactory?: () => string;
    clock?: Readonly<{now(): string}>;
    failpoint?: (point: string) => void;
}>;

type ObservedCandidate = Readonly<{
    projection: RestoreCandidateProjection;
    entryName: string;
    directoryPath: string | null;
    databasePath: string | null;
    manifest: ValidatedSnapshotManifestV1 | null;
    databaseFacts: RestoreDatabaseFacts | null;
    databaseDigest: Readonly<{byteLength: string; sha256: string}> | null;
}>;

type PreviewBinding = Readonly<{
    candidateRootDigest: string;
    candidateDatabaseDigest: string;
    currentRevision: string;
    currentLibrary: RestoreLibraryRootBinding;
    targetBindingVersion: string;
    impact: RestoreImpactSummary;
}>;

type InternalRestoreSession = {
    view: RestoreSessionView;
    candidateEntryName: string;
    candidateDatabasePath: string;
    preparedDatabasePath: string;
    binding: PreviewBinding;
    safetyRootDigest: string | null;
};

type CommandReceipt = Readonly<{
    digest: string;
    view: RestoreSessionView;
}>;

export class RestoreSessionError extends Error {
    public constructor(public readonly code: string, cause?: unknown) {
        super(code, {cause});
        this.name = 'RestoreSessionError';
    }
}

function digestValue(value: unknown): string {
    return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function sameModules(modules: readonly Readonly<{
    moduleId: string;
    formatVersion: string;
}>[]): boolean {
    return JSON.stringify(modules) === JSON.stringify(MODULES);
}

function unsupportedManifestVersion(bytes: Buffer): boolean {
    try {
        const value = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            return false;
        }
        const database = value.database as Record<string, unknown> | undefined;
        if (typeof value.schema === 'string'
            && /^courseflow-snapshot-manifest-v[1-9][0-9]*$/.test(value.schema)
            && value.schema !== 'courseflow-snapshot-manifest-v1') {
            return true;
        }
        if (value.schema !== 'courseflow-snapshot-manifest-v1') {
            return false;
        }
        const unsupportedAxis = [
            ['snapshotFormatVersion', '1'],
            ['manifestFormatVersion', '1'],
            ['manifestEncoding', 'courseflow-canonical-json-v1'],
            ['limitsVersion', 'snapshot-format-limits-v1'],
        ].some(([field, supported]) => (
            typeof value[field] === 'string' && value[field] !== supported
        ));
        if (unsupportedAxis) {
            return true;
        }
        if (typeof database?.schemaLevel === 'string'
            && isCanonicalUnsignedSqliteInteger(database.schemaLevel)
            && (BigInt(database.schemaLevel) < 13n
                || BigInt(database.schemaLevel) > BigInt(CURRENT_SCHEMA_LEVEL))) {
            return true;
        }
        return Array.isArray(value.modules)
            && value.modules.some(module => {
                if (typeof module !== 'object' || module === null || Array.isArray(module)) {
                    return false;
                }
                const record = module as Record<string, unknown>;
                if (typeof record.moduleId !== 'string'
                    || typeof record.formatVersion !== 'string') {
                    return false;
                }
                return !MODULES.some(supported => (
                    supported.moduleId === record.moduleId
                    && supported.formatVersion === record.formatVersion
                ));
            });
    }
    catch {
        return false;
    }
}

function unknownProjection(candidateRef: string): RestoreCandidateProjection {
    return Object.freeze({
        candidateRef,
        candidateKind: 'unknown-entry',
        snapshotId: null,
        status: 'unknown-entry',
        actualRevision: null,
        createdAt: null,
        compatibility: 'unknown',
    });
}

function failedSnapshotProjection(
    candidateRef: string,
    snapshotId: string,
    status: 'incomplete-or-sync-pending' | 'corrupt' | 'incompatible',
): RestoreCandidateProjection {
    return Object.freeze({
        candidateRef,
        candidateKind: 'snapshot',
        snapshotId,
        status,
        actualRevision: null,
        createdAt: null,
        compatibility: status === 'incompatible' ? 'unsupported' : 'unknown',
    });
}

function requireLibraryBinding(value: RestoreLibraryRootBinding): RestoreLibraryRootBinding {
    if (value.kind === 'absent') {
        return Object.freeze({kind: 'absent'});
    }
    if (!isCanonicalUuid(value.libraryRootId) || !isCanonicalUuid(value.rootGeneration)) {
        throw new TypeError('Current Library binding is invalid');
    }
    return Object.freeze({
        kind: 'present',
        libraryRootId: value.libraryRootId,
        rootGeneration: value.rootGeneration,
    });
}

function requireImpactSummary(value: RestoreImpactSummary): RestoreImpactSummary {
    if (value.replacement !== 'complete'
        || value.automaticMerge !== false
        || !isCanonicalUnsignedSqliteInteger(value.termCount)
        || !isCanonicalUnsignedSqliteInteger(value.courseCount)
        || !isCanonicalUnsignedSqliteInteger(value.taskSeriesCount)
        || !isCanonicalUnsignedSqliteInteger(value.currentRevision)
        || !isCanonicalUnsignedSqliteInteger(value.candidateRevision)
        || value.candidateRevision === '0') {
        throw new TypeError('Restore impact summary is invalid');
    }
    return Object.freeze({...value});
}

function candidateProblemCode(status: RestoreCandidateProjection['status']): string {
    if (status === 'incomplete-or-sync-pending') {
        return 'snapshot-incomplete';
    }
    if (status === 'corrupt') {
        return 'snapshot-corrupt';
    }
    if (status === 'incompatible') {
        return 'incompatible-version';
    }
    return 'identity-conflict';
}

/**
 * Coordinates the bounded pre-checkpoint part of RestoreSession.
 */
export class RestoreCoordinator {
    private readonly candidateRefs = new Map<string, string>();
    private readonly sessions = new Map<string, InternalRestoreSession>();
    private readonly receipts = new Map<string, CommandReceipt>();
    private mutationTail: Promise<void> = Promise.resolve();
    private store: SqliteDataStore | null;
    private terminal: RestoreTerminalEvidence | null;

    public constructor(
        store: SqliteDataStore | null,
        private readonly activityControlRoot: string,
        private readonly options: RestoreCoordinatorOptions = {},
        bootState?: RestoreBootState,
    ) {
        this.store = store;
        this.terminal = bootState?.terminal ?? null;
        listPlainDirectory(activityControlRoot);
        if ((bootState?.kind === 'committed' || bootState?.kind === 'recovery-required')
            && bootState.session) {
            this.sessions.set(bootState.session.restoreSessionId, {
                view: bootState.session,
                candidateEntryName: '',
                candidateDatabasePath: '',
                preparedDatabasePath: '',
                binding: {
                    candidateRootDigest: '',
                    candidateDatabaseDigest: '',
                    currentRevision: bootState.session.current.revision,
                    currentLibrary: bootState.session.current.libraryRoot,
                    targetBindingVersion: '0',
                    impact: bootState.session.impact,
                },
                safetyRootDigest: null,
            });
        }
        else if (store) {
            this.loadPersistedSessions();
        }
    }

    /**
     * Reconstructs a checkpointed coordinator without opening ordinary DATA.
     * @param {string} activityControlRoot - Stable external control root.
     * @param {string} dataSlotsRoot - Stable DataSlots parent.
     * @param {RestoreCoordinatorOptions} options - Recovery failpoints and clock.
     * @return {RestoreCoordinator} Recovery-only coordinator.
     */
    public static recover(
        activityControlRoot: string,
        dataSlotsRoot: string,
        options: RestoreCoordinatorOptions = {},
    ): RestoreCoordinator {
        const bootState = inspectRestoreBeforeWorkspaceOpen(activityControlRoot, dataSlotsRoot);
        if (bootState.kind !== 'recovery-required') {
            throw new RestoreSessionError('not-found');
        }
        return new RestoreCoordinator(
            null,
            activityControlRoot,
            {...options, dataSlotsRoot},
            bootState,
        );
    }

    /**
     * Returns the currently reopened DATA owner after success or rollback.
     * @return {SqliteDataStore | null} Active store, or null while recovery blocks ordinary open.
     */
    public activeStore(): SqliteDataStore | null {
        return this.store;
    }

    /**
     * Reports whether a confirmed or checkpointed session must block ordinary Workspace work.
     * @return {boolean} True while Restore maintenance is required.
     */
    public requiresMaintenance(): boolean {
        return Array.from(this.sessions.values()).some(session => (
            session.view.phase === 'protection-established'
            || session.view.phase === 'recovery-required'
        ));
    }

    /**
     * Requires the current pre-checkpoint or reopened DATA owner.
     * @return {SqliteDataStore} Live DATA store.
     */
    private requireStore(): SqliteDataStore {
        if (!this.store) {
            throw new RestoreSessionError('activation-pending');
        }
        return this.store;
    }

    private replayDurableSession(restoreSessionId: string): RestoreSessionView {
        const view = this.query(restoreSessionId);
        recordRestoreSessionControl(this.activityControlRoot, view, {
            clock: this.options.clock,
            failpoint: this.options.failpoint,
        });
        return view;
    }

    /**
     * Freshly revalidates every entry in the configured BackupSet.
     * @return {readonly RestoreCandidateProjection[]} Exact path-free candidates.
     */
    public listCandidates(): readonly RestoreCandidateProjection[] {
        const store = this.requireStore();
        const configuration = store.readBackupConfigurationForProtection();
        if (!configuration) {
            return Object.freeze([]);
        }
        const tree = readBackupSetTree({
            destinationPath: configuration.canonicalPath,
            repositoryDirectoryName: REPOSITORY_DIRECTORY_NAME,
            repositoryMarkerName: REPOSITORY_MARKER_NAME,
            repositoryMarkerBytes: REPOSITORY_MARKER_BYTES,
            workspaceDirectoryName: configuration.workspaceId,
            backupSetDirectoryName: configuration.backupSetId,
        });
        const excludedOperationEntries = new Set<string>();
        const backupOperation = store.readBackupOperation();
        if (backupOperation) {
            excludedOperationEntries.add(backupOperation.stagingDirectoryName);
        }
        const cleanupOperation = store.readBackupCleanupOperation();
        if (cleanupOperation) {
            excludedOperationEntries.add(cleanupOperation.quarantineDirectoryName);
        }
        return Object.freeze(listPlainDirectory(tree.backupSetDirectoryPath)
            .filter(entryName => !excludedOperationEntries.has(entryName))
            .map(entryName => this.observeCandidate(
                tree.backupSetDirectoryPath,
                entryName,
            ).projection));
    }

    /**
     * Revalidates and prepares only a verified opaque candidate, then returns its preview.
     * @param {StartRestoreSessionCommand} candidate - Exact start command.
     * @return {Promise<RestoreSessionView>} New or replayed preview.
     */
    public start(candidate: StartRestoreSessionCommand): Promise<RestoreSessionView> {
        const command = normalizeStartRestoreSessionCommand(candidate);
        const commandDigest = digestValue(command);
        const prior = this.receipts.get(command.commandId);
        if (prior) {
            if (prior.digest !== commandDigest) {
                return Promise.reject(new RestoreSessionError('conflict'));
            }
            return Promise.resolve(prior.view);
        }
        const replayStore = this.store;
        if (replayStore) {
            const durablePrior = replayStore.readRestoreCommandReceipt(command.commandId);
            if (durablePrior) {
                if (durablePrior.payloadDigest !== commandDigest) {
                    return Promise.reject(new RestoreSessionError('conflict'));
                }
                return Promise.resolve(this.replayDurableSession(durablePrior.restoreSessionId));
            }
        }
        const dataSlotsRoot = this.options.dataSlotsRoot;
        if (dataSlotsRoot) {
            const migration = inspectNonterminalMigrationRollback(
                this.activityControlRoot,
                dataSlotsRoot,
            );
            if (migration.kind === 'nonterminal') {
                return Promise.reject(new RestoreSessionError('conflict'));
            }
            if (migration.kind === 'recovery-required') {
                return Promise.reject(new RestoreSessionError('current-data-unavailable'));
            }
        }
        const store = this.requireStore();
        if (Array.from(this.sessions.values()).some(session => (
            session.view.phase !== 'cancelled'
            && session.view.phase !== 'succeeded'
            && session.view.phase !== 'rolled-back'
        ))) {
            return Promise.reject(new RestoreSessionError('conflict'));
        }
        try {
            const observed = this.findCandidate(command.candidateRef);
            if (observed.projection.status !== 'verified'
                || !observed.directoryPath
                || !observed.databasePath
                || !observed.manifest
                || !observed.databaseFacts
                || !observed.databaseDigest) {
                throw new RestoreSessionError(candidateProblemCode(observed.projection.status));
            }
            const restoreSessionId = this.identity();
            const operationId = this.identity();
            const operationDirectory = ensureSnapshotStagingDirectory(
                ensureSnapshotStagingDirectory(this.activityControlRoot, 'restore'),
                operationId,
            );
            ensureSnapshotStagingDirectory(operationDirectory, 'session');
            ensureSnapshotStagingDirectory(operationDirectory, 'journal');
            const validationDirectory = ensureSnapshotStagingDirectory(
                operationDirectory,
                'candidate-validation',
            );
            const preparedDatabasePath = path.join(
                validationDirectory,
                DATABASE_MEMBER_NAME,
            );
            const prepared = store.prepareRestoreCandidateDatabaseCopy(
                observed.databasePath,
                preparedDatabasePath,
            );
            const preparedDatabaseDigest = digestPlainFile(
                preparedDatabasePath,
                SNAPSHOT_MAXIMUM_RAW_BYTES,
            );
            const status = store.status();
            if (status.kind !== 'ready') {
                throw new RestoreSessionError('current-data-unavailable');
            }
            const currentLibrary = this.readCurrentLibraryBinding();
            const targetBindingVersion = this.readTargetBindingVersion();
            const impact = this.readImpact(
                prepared.actualRevision,
                status.revision,
                prepared,
            );
            const binding = Object.freeze({
                candidateRootDigest: observed.manifest.rootDigest,
                candidateDatabaseDigest: preparedDatabaseDigest.sha256,
                currentRevision: status.revision,
                currentLibrary,
                targetBindingVersion,
                impact,
            });
            const previewToken = digestValue({
                restoreSessionId,
                operationId,
                sessionVersion: '0',
                binding,
            });
            const view: RestoreSessionView = Object.freeze({
                restoreSessionId,
                operationId,
                sessionVersion: '0',
                phase: 'previewed',
                candidate: Object.freeze({
                    candidateRef: command.candidateRef,
                    snapshotId: observed.projection.snapshotId!,
                    sourceSchemaLevel: prepared.sourceSchemaLevel,
                    preparedSchemaLevel: prepared.preparedSchemaLevel,
                    actualRevision: prepared.actualRevision,
                    validationCopy: prepared.validationCopy,
                }),
                current: Object.freeze({
                    workspaceId: status.workspaceId,
                    revision: status.revision,
                    libraryRoot: currentLibrary,
                }),
                target: Object.freeze({libraryRoot: Object.freeze({kind: 'absent'})}),
                impact,
                recoverability: Object.freeze({
                    mode: 'required',
                    safetySet: Object.freeze({state: 'pending'}),
                }),
                previewToken,
                allowedActions: Object.freeze([
                    'confirm',
                    'cancel-before-checkpoint',
                ] as const),
                problem: null,
            });
            if (!isRestoreSessionView(view)) {
                throw new Error('Restore preview construction failed');
            }
            const session: InternalRestoreSession = {
                view,
                candidateEntryName: observed.entryName,
                candidateDatabasePath: observed.databasePath,
                preparedDatabasePath,
                binding,
                safetyRootDigest: null,
            };
            store.createRestoreSession(
                this.storedSession(session, null),
                this.restoreReceipt(
                    command.commandId,
                    'start',
                    commandDigest,
                    restoreSessionId,
                    '0',
                ),
            );
            this.sessions.set(restoreSessionId, session);
            recordRestoreSessionControl(this.activityControlRoot, view, {
                clock: this.options.clock,
                failpoint: this.options.failpoint,
            });
            this.receipts.set(command.commandId, Object.freeze({digest: commandDigest, view}));
            return Promise.resolve(view);
        }
        catch (error) {
            return Promise.reject(error);
        }
    }

    /**
     * Rechecks every preview binding and establishes the healthy current safety set.
     * @param {ConfirmRestoreSessionCommand} candidate - Exact confirmation command.
     * @return {Promise<RestoreSessionView>} Waiting-decision or protection-established view.
     */
    public confirm(candidate: ConfirmRestoreSessionCommand): Promise<RestoreSessionView> {
        return this.sequenceMutation(() => this.confirmOnce(candidate));
    }

    private sequenceMutation<T>(mutation: () => Promise<T>): Promise<T> {
        const result = this.mutationTail.then(mutation);
        this.mutationTail = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    }

    private async confirmOnce(
        candidate: ConfirmRestoreSessionCommand,
    ): Promise<RestoreSessionView> {
        const command = normalizeConfirmRestoreSessionCommand(candidate);
        const commandDigest = digestValue(command);
        const prior = this.receipts.get(command.commandId);
        if (prior) {
            if (prior.digest !== commandDigest) {
                throw new RestoreSessionError('conflict');
            }
            return prior.view;
        }
        const store = this.requireStore();
        const durablePrior = store.readRestoreCommandReceipt(command.commandId);
        if (durablePrior) {
            if (durablePrior.payloadDigest !== commandDigest) {
                throw new RestoreSessionError('conflict');
            }
            return this.replayDurableSession(durablePrior.restoreSessionId);
        }
        const session = this.sessions.get(command.restoreSessionId);
        if (!session
            || session.view.phase !== 'previewed'
            || session.view.sessionVersion !== command.expectedSessionVersion) {
            throw new RestoreSessionError('conflict');
        }
        const changed = this.previewChanged(session)
            || command.previewToken !== session.view.previewToken;
        if (changed) {
            const waiting = this.waitingDecision(session);
            store.advanceRestoreSession(
                this.storedSession({...session, view: waiting}, null),
                command.expectedSessionVersion,
                this.restoreReceipt(
                    command.commandId,
                    'confirm',
                    commandDigest,
                    command.restoreSessionId,
                    waiting.sessionVersion,
                ),
            );
            session.view = waiting;
            recordRestoreSessionControl(this.activityControlRoot, waiting, {
                clock: this.options.clock,
                failpoint: this.options.failpoint,
            });
            this.receipts.set(command.commandId, Object.freeze({
                digest: commandDigest,
                view: waiting,
            }));
            return waiting;
        }
        if (session.binding.currentLibrary.kind === 'present') {
            throw new RestoreSessionError('library-safety-unavailable');
        }
        const safetySetId = this.identity();
        const operationDirectory = path.join(
            this.activityControlRoot,
            'restore',
            session.view.operationId,
        );
        listPlainDirectory(operationDirectory);
        const safetyDirectory = ensureSnapshotStagingDirectory(
            operationDirectory,
            'safety',
        );
        const stagingDirectory = ensureSnapshotStagingDirectory(
            safetyDirectory,
            `.staging-${safetySetId}`,
        );
        const finalDirectory = path.join(safetyDirectory, safetySetId);
        const safetyDatabasePath = path.join(stagingDirectory, DATABASE_MEMBER_NAME);
        const safetyFacts = await store.writeRestoreSafetyDatabaseCopy(
            safetyDatabasePath,
            session.binding.currentRevision,
        );
        if (this.previewChanged(session)) {
            const waiting = this.waitingDecision(session);
            store.advanceRestoreSession(
                this.storedSession({...session, view: waiting}, null),
                command.expectedSessionVersion,
                this.restoreReceipt(
                    command.commandId,
                    'confirm',
                    commandDigest,
                    command.restoreSessionId,
                    waiting.sessionVersion,
                ),
            );
            session.view = waiting;
            recordRestoreSessionControl(this.activityControlRoot, waiting, {
                clock: this.options.clock,
                failpoint: this.options.failpoint,
            });
            this.receipts.set(command.commandId, Object.freeze({
                digest: commandDigest,
                view: waiting,
            }));
            return waiting;
        }
        syncPlainFile(safetyDatabasePath);
        const databaseDigest = digestPlainFile(
            safetyDatabasePath,
            SNAPSHOT_MAXIMUM_RAW_BYTES,
        );
        const manifestBytes = createRestoreSafetyManifestV1({
            safetySetId,
            restoreSessionId: session.view.restoreSessionId,
            operationId: session.view.operationId,
            createdAt: this.options.clock?.now() ?? new Date().toISOString(),
            workspaceId: safetyFacts.workspaceId,
            protectedRevision: safetyFacts.actualRevision,
            database: {
                memberPath: DATABASE_MEMBER_NAME,
                applicationId: safetyFacts.applicationId,
                schemaLevel: safetyFacts.schemaLevel,
                byteLength: databaseDigest.byteLength,
                sha256: databaseDigest.sha256,
            },
            library: {state: 'absent'},
        });
        writeOrVerifyBackupFile(
            path.join(stagingDirectory, MANIFEST_MEMBER_NAME),
            manifestBytes,
        );
        this.validateSafetySet(stagingDirectory, session.view, safetySetId);
        publishSnapshotDirectory(stagingDirectory, finalDirectory);
        const safetyRootDigest = this.validateSafetySet(
            finalDirectory,
            session.view,
            safetySetId,
        );
        const protectedView: RestoreSessionView = Object.freeze({
            ...session.view,
            sessionVersion: (BigInt(session.view.sessionVersion) + 1n).toString(),
            phase: 'protection-established',
            recoverability: Object.freeze({
                mode: 'required',
                safetySet: Object.freeze({
                    state: 'verified',
                    safetySetId,
                    protectedRevision: safetyFacts.actualRevision,
                }),
            }),
            previewToken: null,
            allowedActions: Object.freeze([
                'resume',
                'cancel-before-checkpoint',
            ] as const),
            problem: null,
        });
        if (!isRestoreSessionView(protectedView)) {
            throw new Error('Restore protection view construction failed');
        }
        store.advanceRestoreSession(
            this.storedSession({...session, view: protectedView}, safetyRootDigest),
            command.expectedSessionVersion,
            this.restoreReceipt(
                command.commandId,
                'confirm',
                commandDigest,
                command.restoreSessionId,
                protectedView.sessionVersion,
            ),
        );
        session.view = protectedView;
        session.safetyRootDigest = safetyRootDigest;
        recordRestoreSessionControl(this.activityControlRoot, protectedView, {
            clock: this.options.clock,
            failpoint: this.options.failpoint,
        });
        this.receipts.set(command.commandId, Object.freeze({
            digest: commandDigest,
            view: protectedView,
        }));
        return protectedView;
    }

    /**
     * Reads one in-process session without advancing it.
     * @param {string} restoreSessionId - Stable session identity.
     * @return {RestoreSessionView} Current path-free state.
     */
    public query(restoreSessionId: string): RestoreSessionView {
        if (!isCanonicalUuid(restoreSessionId)) {
            throw new TypeError('RestoreSessionId is invalid');
        }
        const session = this.sessions.get(restoreSessionId);
        if (!session) {
            throw new RestoreSessionError('not-found');
        }
        return session.view;
    }

    /**
     * Cancels a session before its armed checkpoint without replacing active DATA.
     * @param {RestoreSessionActionCommand} candidate - Version-bound path-free cancellation.
     * @return {Promise<RestoreSessionView>} Durable terminal cancellation view.
     */
    public cancelBeforeCheckpoint(
        candidate: RestoreSessionActionCommand,
    ): Promise<RestoreSessionView> {
        return this.sequenceMutation(() => this.cancelBeforeCheckpointOnce(candidate));
    }

    private async cancelBeforeCheckpointOnce(
        candidate: RestoreSessionActionCommand,
    ): Promise<RestoreSessionView> {
        const command = normalizeCancelRestoreSessionCommand(candidate);
        const commandDigest = digestValue(command);
        const prior = this.receipts.get(command.commandId);
        if (prior) {
            if (prior.digest !== commandDigest) {
                throw new RestoreSessionError('conflict');
            }
            return prior.view;
        }
        const store = this.requireStore();
        const durablePrior = store.readRestoreCommandReceipt(command.commandId);
        if (durablePrior) {
            if (durablePrior.payloadDigest !== commandDigest) {
                throw new RestoreSessionError('conflict');
            }
            return this.replayDurableSession(durablePrior.restoreSessionId);
        }
        const session = this.sessions.get(command.restoreSessionId);
        if (!session
            || (session.view.phase !== 'previewed'
                && session.view.phase !== 'waiting-decision'
                && session.view.phase !== 'protection-established')
            || session.view.sessionVersion !== command.expectedSessionVersion) {
            throw new RestoreSessionError('conflict');
        }
        const cancelled: RestoreSessionView = Object.freeze({
            ...session.view,
            sessionVersion: (BigInt(session.view.sessionVersion) + 1n).toString(),
            phase: 'cancelled',
            previewToken: null,
            allowedActions: Object.freeze([]),
            problem: null,
        });
        if (!isRestoreSessionView(cancelled)) {
            throw new Error('Restore cancellation view construction failed');
        }
        store.cancelRestoreSession(
            this.storedSession({...session, view: cancelled}, session.safetyRootDigest),
            command.expectedSessionVersion,
            this.restoreReceipt(
                command.commandId,
                'cancel',
                commandDigest,
                command.restoreSessionId,
                cancelled.sessionVersion,
            ),
        );
        session.view = cancelled;
        recordRestoreSessionControl(this.activityControlRoot, cancelled, {
            clock: this.options.clock,
            failpoint: this.options.failpoint,
        });
        this.receipts.set(command.commandId, Object.freeze({
            digest: commandDigest,
            view: cancelled,
        }));
        return cancelled;
    }

    /**
     * Arms a protected A-only session or explicitly continues its evidence-bound recovery.
     * @param {RestoreSessionActionCommand} candidate - Version-bound path-free resume command.
     * @return {Promise<RestoreSessionView>} Terminal success or a rejected recovery boundary.
     */
    public resume(candidate: RestoreSessionActionCommand): Promise<RestoreSessionView> {
        return this.sequenceMutation(() => this.resumeOnce(candidate));
    }

    private async resumeOnce(candidate: RestoreSessionActionCommand): Promise<RestoreSessionView> {
        const command = normalizeResumeRestoreSessionCommand(candidate);
        const commandDigest = digestValue(command);
        const prior = this.receipts.get(command.commandId);
        if (prior) {
            if (prior.digest !== commandDigest) {
                throw new RestoreSessionError('conflict');
            }
            return prior.view;
        }
        const session = this.sessions.get(command.restoreSessionId);
        const dataSlotsRoot = this.options.dataSlotsRoot;
        if (!session || !dataSlotsRoot) {
            throw new RestoreSessionError('not-found');
        }
        if (session.view.phase === 'succeeded') {
            throw new RestoreSessionError('conflict');
        }
        try {
            if (session.view.phase === 'protection-established') {
                this.requireActivationPreconditions(session);
            }
            const result = session.view.phase === 'protection-established'
                ? await beginRestoreActivation({
                    store: this.requireStore(),
                    activityControlRoot: this.activityControlRoot,
                    dataSlotsRoot,
                    preparedDatabasePath: session.preparedDatabasePath,
                    session: session.view,
                    candidateRootDigest: session.binding.candidateRootDigest,
                    candidateDatabaseDigest: session.binding.candidateDatabaseDigest,
                    safetyRootDigest: session.safetyRootDigest ?? '',
                    previousTerminal: this.terminal,
                    command,
                }, {
                    clock: this.options.clock,
                    failpoint: this.options.failpoint,
                })
                : session.view.phase === 'recovery-required'
                    ? await continueRestoreActivation(
                        this.activityControlRoot,
                        dataSlotsRoot,
                        command,
                        {
                            clock: this.options.clock,
                            failpoint: this.options.failpoint,
                        },
                    )
                    : null;
            if (!result) {
                throw new RestoreSessionError('conflict');
            }
            this.store = result.store;
            this.terminal = result.terminal;
            session.view = result.session;
            this.receipts.set(command.commandId, Object.freeze({
                digest: commandDigest,
                view: result.session,
            }));
            return result.session;
        }
        catch (error) {
            if (!(error instanceof RestoreActivationError)) {
                throw error;
            }
            if (error.checkpointReached) {
                this.store = null;
                const boot = inspectRestoreBeforeWorkspaceOpen(
                    this.activityControlRoot,
                    dataSlotsRoot,
                );
                if (boot.session) {
                    session.view = boot.session;
                }
                if (boot.kind === 'committed' && boot.session) {
                    this.store = this.reopenTerminalData(dataSlotsRoot, boot.session);
                    this.terminal = boot.terminal;
                    this.receipts.set(command.commandId, Object.freeze({
                        digest: commandDigest,
                        view: boot.session,
                    }));
                    return boot.session;
                }
            }
            else {
                this.reopenPreCheckpointData(dataSlotsRoot);
            }
            throw new RestoreSessionError(error.code, error);
        }
    }

    /**
     * Explicitly rolls a checkpointed A-only activation back to its old DATA sibling.
     * @param {RestoreSessionActionCommand} candidate - Version-bound path-free rollback command.
     * @return {Promise<RestoreSessionView>} Reopened rollback terminal view.
     */
    public rollback(candidate: RestoreSessionActionCommand): Promise<RestoreSessionView> {
        return this.sequenceMutation(() => this.rollbackOnce(candidate));
    }

    private async rollbackOnce(candidate: RestoreSessionActionCommand): Promise<RestoreSessionView> {
        const command = normalizeRollbackRestoreSessionCommand(candidate);
        const commandDigest = digestValue(command);
        const prior = this.receipts.get(command.commandId);
        if (prior) {
            if (prior.digest !== commandDigest) {
                throw new RestoreSessionError('conflict');
            }
            return prior.view;
        }
        const session = this.sessions.get(command.restoreSessionId);
        const dataSlotsRoot = this.options.dataSlotsRoot;
        if (!session || !dataSlotsRoot || session.view.phase !== 'recovery-required') {
            throw new RestoreSessionError('conflict');
        }
        try {
            const result = await rollbackRestoreActivation(
                this.activityControlRoot,
                dataSlotsRoot,
                command,
                {
                    clock: this.options.clock,
                    failpoint: this.options.failpoint,
                },
            );
            this.store = result.store;
            this.terminal = result.terminal;
            session.view = result.session;
            this.receipts.set(command.commandId, Object.freeze({
                digest: commandDigest,
                view: result.session,
            }));
            return result.session;
        }
        catch (error) {
            if (error instanceof RestoreActivationError) {
                this.store = null;
                const boot = inspectRestoreBeforeWorkspaceOpen(
                    this.activityControlRoot,
                    dataSlotsRoot,
                );
                if (boot.session) {
                    session.view = boot.session;
                }
                if (boot.kind === 'committed' && boot.session) {
                    this.store = this.reopenTerminalData(dataSlotsRoot, boot.session);
                    this.terminal = boot.terminal;
                    this.receipts.set(command.commandId, Object.freeze({
                        digest: commandDigest,
                        view: boot.session,
                    }));
                    return boot.session;
                }
                throw new RestoreSessionError(error.code, error);
            }
            throw error;
        }
    }

    /**
     * Reuses a still-open old store or fully reopens it after a pre-checkpoint close failure.
     * @param {string} dataSlotsRoot - Stable DataSlots parent.
     * @return {void}
     */
    private reopenPreCheckpointData(dataSlotsRoot: string): void {
        try {
            if (this.store) {
                this.store.status();
                return;
            }
        }
        catch {
            this.store = null;
        }
        const opened = openWorkspaceData(dataSlotsRoot);
        if (opened.kind !== 'ready') {
            throw new RestoreSessionError('recovery-required');
        }
        this.store = opened.store;
    }

    private reopenTerminalData(
        dataSlotsRoot: string,
        session: RestoreSessionView,
    ): SqliteDataStore {
        const opened = openWorkspaceData(dataSlotsRoot);
        const expectedRevision = session.phase === 'succeeded'
            ? session.candidate.actualRevision
            : session.current.revision;
        if (opened.kind !== 'ready'
            || opened.store.status().workspaceId !== session.current.workspaceId
            || opened.store.status().revision !== expectedRevision) {
            if (opened.kind === 'ready' || opened.kind === 'read-only') {
                void opened.store.close();
            }
            throw new RestoreSessionError('recovery-required');
        }
        return opened.store;
    }

    private loadPersistedSessions(): void {
        const store = this.requireStore();
        const configuration = store.readBackupConfigurationForProtection();
        for (const stored of store.readRestoreSessions()) {
            if (!configuration) {
                throw new Error('Persisted RestoreSession has no configured BackupSet');
            }
            const impact: RestoreImpactSummary = Object.freeze({
                replacement: 'complete',
                automaticMerge: false,
                termCount: stored.termCount,
                courseCount: stored.courseCount,
                taskSeriesCount: stored.taskSeriesCount,
                currentRevision: stored.currentRevision,
                candidateRevision: stored.candidateRevision,
            });
            const binding: PreviewBinding = Object.freeze({
                candidateRootDigest: stored.candidateRootDigest,
                candidateDatabaseDigest: stored.candidateDatabaseDigest,
                currentRevision: stored.currentRevision,
                currentLibrary: stored.currentLibrary,
                targetBindingVersion: stored.targetBindingVersion,
                impact,
            });
            if (digestValue(impact) !== stored.impactDigest
                || digestValue(binding) !== stored.bindingDigest) {
                throw new Error('Persisted RestoreSession binding is invalid');
            }
            const view = this.viewFromStored(stored, impact);
            const entryName = `snapshot-${stored.snapshotId}`;
            const operationDirectory = path.join(
                this.activityControlRoot,
                'restore',
                stored.operationId,
            );
            ensureSnapshotStagingDirectory(operationDirectory, 'session');
            ensureSnapshotStagingDirectory(operationDirectory, 'journal');
            const candidateDatabasePath = path.join(
                configuration.canonicalPath,
                REPOSITORY_DIRECTORY_NAME,
                configuration.workspaceId,
                configuration.backupSetId,
                entryName,
                DATABASE_MEMBER_NAME,
            );
            this.candidateRefs.set(entryName, stored.candidateRef);
            const session: InternalRestoreSession = {
                view,
                candidateEntryName: entryName,
                candidateDatabasePath,
                preparedDatabasePath: path.join(
                    operationDirectory,
                    'candidate-validation',
                    DATABASE_MEMBER_NAME,
                ),
                binding,
                safetyRootDigest: stored.safetyRootDigest,
            };
            if (view.phase === 'protection-established') {
                const safetySet = view.recoverability.safetySet;
                if (safetySet.state !== 'verified'
                    || this.validateSafetySet(
                        path.join(
                            operationDirectory,
                            'safety',
                            safetySet.safetySetId,
                        ),
                        view,
                        safetySet.safetySetId,
                    ) !== stored.safetyRootDigest) {
                    throw new Error('Persisted RestoreSafetySet is invalid');
                }
            }
            recordRestoreSessionControl(this.activityControlRoot, view, {
                clock: this.options.clock,
                failpoint: this.options.failpoint,
            });
            this.sessions.set(stored.restoreSessionId, session);
        }
    }

    private viewFromStored(
        stored: StoredRestoreSession,
        impact: RestoreImpactSummary,
    ): RestoreSessionView {
        const safetySet = stored.safetySetId !== null
            ? Object.freeze({
                state: 'verified' as const,
                safetySetId: stored.safetySetId!,
                protectedRevision: stored.safetyProtectedRevision!,
            })
            : Object.freeze({state: 'pending' as const});
        const allowedActions = stored.phase === 'previewed'
            ? Object.freeze(['confirm', 'cancel-before-checkpoint'] as const)
            : stored.phase === 'waiting-decision'
                ? Object.freeze(['repreview', 'cancel-before-checkpoint'] as const)
                : stored.phase === 'protection-established'
                    ? Object.freeze(['resume', 'cancel-before-checkpoint'] as const)
                    : Object.freeze([]);
        const view: RestoreSessionView = Object.freeze({
            restoreSessionId: stored.restoreSessionId,
            operationId: stored.operationId,
            sessionVersion: stored.sessionVersion,
            phase: stored.phase,
            candidate: Object.freeze({
                candidateRef: stored.candidateRef,
                snapshotId: stored.snapshotId,
                sourceSchemaLevel: stored.sourceSchemaLevel,
                preparedSchemaLevel: stored.preparedSchemaLevel,
                actualRevision: stored.candidateRevision,
                validationCopy: stored.validationCopy,
            }),
            current: Object.freeze({
                workspaceId: stored.currentWorkspaceId,
                revision: stored.currentRevision,
                libraryRoot: stored.currentLibrary,
            }),
            target: Object.freeze({libraryRoot: Object.freeze({kind: 'absent'})}),
            impact,
            recoverability: Object.freeze({mode: 'required', safetySet}),
            previewToken: stored.previewToken,
            allowedActions,
            problem: stored.problemCode === null
                ? null
                : Object.freeze({code: stored.problemCode}),
        });
        if (!isRestoreSessionView(view)) {
            throw new Error('Persisted RestoreSession view is invalid');
        }
        return view;
    }

    private storedSession(
        session: InternalRestoreSession,
        safetyRootDigest: string | null,
    ): StoredRestoreSession {
        const phase = session.view.phase;
        if (phase !== 'previewed'
            && phase !== 'waiting-decision'
            && phase !== 'protection-established'
            && phase !== 'cancelled') {
            throw new Error('Terminal RestoreSession is not stored in the pre-checkpoint table');
        }
        const problemCode = session.view.problem?.code ?? null;
        if (problemCode !== null && problemCode !== 'impact-changed') {
            throw new Error('Pre-checkpoint RestoreSession problem is invalid');
        }
        const safetySet = session.view.recoverability.safetySet;
        return Object.freeze({
            restoreSessionId: session.view.restoreSessionId,
            operationId: session.view.operationId,
            candidateRef: session.view.candidate.candidateRef,
            snapshotId: session.view.candidate.snapshotId,
            candidateRootDigest: session.binding.candidateRootDigest,
            candidateDatabaseDigest: session.binding.candidateDatabaseDigest,
            sourceSchemaLevel: session.view.candidate.sourceSchemaLevel,
            preparedSchemaLevel: session.view.candidate.preparedSchemaLevel,
            candidateRevision: session.view.candidate.actualRevision,
            validationCopy: session.view.candidate.validationCopy,
            currentWorkspaceId: session.view.current.workspaceId,
            currentRevision: session.view.current.revision,
            currentLibrary: session.view.current.libraryRoot,
            targetBindingVersion: session.binding.targetBindingVersion,
            termCount: session.view.impact.termCount,
            courseCount: session.view.impact.courseCount,
            taskSeriesCount: session.view.impact.taskSeriesCount,
            impactDigest: digestValue(session.view.impact),
            bindingDigest: digestValue(session.binding),
            previewToken: session.view.previewToken,
            phase,
            sessionVersion: session.view.sessionVersion,
            problemCode,
            safetySetId: safetySet.state === 'verified' ? safetySet.safetySetId : null,
            safetyProtectedRevision: safetySet.state === 'verified'
                ? safetySet.protectedRevision
                : null,
            safetyRootDigest,
        });
    }

    private restoreReceipt(
        commandId: string,
        commandKind: 'start' | 'confirm' | 'cancel',
        payloadDigest: string,
        restoreSessionId: string,
        resultSessionVersion: string,
    ): StoredRestoreCommandReceipt {
        return Object.freeze({
            commandId,
            commandKind,
            payloadDigest,
            restoreSessionId,
            resultSessionVersion,
        });
    }

    private identity(): string {
        const identity = this.options.identityFactory?.() ?? randomUUID();
        if (!isCanonicalUuid(identity)) {
            throw new TypeError('Restore identity factory returned an invalid UUID');
        }
        return identity;
    }

    private candidateRef(entryName: string): string {
        const existing = this.candidateRefs.get(entryName);
        if (existing) {
            return existing;
        }
        const candidateRef = this.identity();
        this.candidateRefs.set(entryName, candidateRef);
        return candidateRef;
    }

    private findCandidate(candidateRef: string): ObservedCandidate {
        const configuration = this.requireStore().readBackupConfigurationForProtection();
        if (!configuration) {
            throw new RestoreSessionError('destination-unset');
        }
        const entryName = Array.from(this.candidateRefs.entries())
            .find(([, reference]) => reference === candidateRef)?.[0];
        if (!entryName) {
            throw new RestoreSessionError('identity-conflict');
        }
        const tree = readBackupSetTree({
            destinationPath: configuration.canonicalPath,
            repositoryDirectoryName: REPOSITORY_DIRECTORY_NAME,
            repositoryMarkerName: REPOSITORY_MARKER_NAME,
            repositoryMarkerBytes: REPOSITORY_MARKER_BYTES,
            workspaceDirectoryName: configuration.workspaceId,
            backupSetDirectoryName: configuration.backupSetId,
        });
        return this.observeCandidate(tree.backupSetDirectoryPath, entryName);
    }

    private observeCandidate(
        backupSetDirectoryPath: string,
        entryName: string,
    ): ObservedCandidate {
        const candidateRef = this.candidateRef(entryName);
        const match = /^snapshot-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/
            .exec(entryName);
        if (!match || !isCanonicalUuid(match[1])) {
            return Object.freeze({
                projection: unknownProjection(candidateRef),
                entryName,
                directoryPath: null,
                databasePath: null,
                manifest: null,
                databaseFacts: null,
                databaseDigest: null,
            });
        }
        const snapshotId = match[1];
        try {
            if (!plainChildDirectoryExists(backupSetDirectoryPath, entryName)) {
                throw new Error('Snapshot directory is missing');
            }
            const directoryPath = path.join(backupSetDirectoryPath, entryName);
            const members = listPlainDirectory(directoryPath);
            if (members.some(member => (
                member !== MANIFEST_MEMBER_NAME && member !== DATABASE_MEMBER_NAME
            ))) {
                throw new SnapshotValidationError();
            }
            if (!members.includes(MANIFEST_MEMBER_NAME)
                || !members.includes(DATABASE_MEMBER_NAME)) {
                return Object.freeze({
                    projection: failedSnapshotProjection(
                        candidateRef,
                        snapshotId,
                        'incomplete-or-sync-pending',
                    ),
                    entryName,
                    directoryPath,
                    databasePath: null,
                    manifest: null,
                    databaseFacts: null,
                    databaseDigest: null,
                });
            }
            const manifestBytes = readBoundedPlainFile(
                path.join(directoryPath, MANIFEST_MEMBER_NAME),
                MANIFEST_MAXIMUM_BYTES,
            );
            if (unsupportedManifestVersion(manifestBytes)) {
                return Object.freeze({
                    projection: failedSnapshotProjection(
                        candidateRef,
                        snapshotId,
                        'incompatible',
                    ),
                    entryName,
                    directoryPath,
                    databasePath: null,
                    manifest: null,
                    databaseFacts: null,
                    databaseDigest: null,
                });
            }
            const manifest = validateSnapshotManifestV1(manifestBytes);
            const configuration = this.requireStore().readBackupConfigurationForProtection();
            if (!configuration
                || manifest.input.snapshotId !== snapshotId
                || manifest.input.backupSetId !== configuration.backupSetId
                || manifest.input.workspaceId !== configuration.workspaceId) {
                return Object.freeze({
                    projection: unknownProjection(candidateRef),
                    entryName,
                    directoryPath,
                    databasePath: null,
                    manifest: null,
                    databaseFacts: null,
                    databaseDigest: null,
                });
            }
            const databasePath = path.join(directoryPath, DATABASE_MEMBER_NAME);
            const databaseDigest = digestPlainFile(
                databasePath,
                SNAPSHOT_MAXIMUM_RAW_BYTES,
            );
            const databaseFacts = this.requireStore().inspectRestoreCandidateDatabase(databasePath);
            const member = manifest.input.members[0];
            if (!sameModules(manifest.input.modules)
                || manifest.input.backupSetId !== databaseFacts.sourceBackup.backupSetId
                || manifest.input.backupSequence !== databaseFacts.sourceBackup.backupSequence
                || manifest.input.snapshotId !== databaseFacts.sourceBackup.snapshotId
                || BigInt(databaseFacts.actualRevision)
                    < BigInt(databaseFacts.sourceBackup.targetRevision)
                || manifest.input.database.applicationId !== databaseFacts.applicationId
                || manifest.input.database.schemaLevel !== databaseFacts.schemaLevel
                || manifest.input.database.actualRevision !== databaseFacts.actualRevision
                || member.byteLength !== databaseDigest.byteLength
                || member.sha256 !== databaseDigest.sha256) {
                throw new SnapshotValidationError();
            }
            const projection: RestoreCandidateProjection = Object.freeze({
                candidateRef,
                candidateKind: 'snapshot',
                snapshotId,
                status: 'verified',
                actualRevision: databaseFacts.actualRevision,
                createdAt: manifest.input.createdAt,
                compatibility: Number(databaseFacts.schemaLevel) === CURRENT_SCHEMA_LEVEL
                    ? 'current'
                    : 'migration-required',
            });
            if (!isRestoreCandidateProjection(projection)) {
                throw new Error('Restore candidate projection construction failed');
            }
            return Object.freeze({
                projection,
                entryName,
                directoryPath,
                databasePath,
                manifest,
                databaseFacts,
                databaseDigest,
            });
        }
        catch {
            return Object.freeze({
                projection: failedSnapshotProjection(candidateRef, snapshotId, 'corrupt'),
                entryName,
                directoryPath: null,
                databasePath: null,
                manifest: null,
                databaseFacts: null,
                databaseDigest: null,
            });
        }
    }

    private readCurrentLibraryBinding(): RestoreLibraryRootBinding {
        return requireLibraryBinding(
            this.options.currentLibraryBinding?.() ?? Object.freeze({kind: 'absent'}),
        );
    }

    private readTargetBindingVersion(): string {
        const version = this.options.targetBindingVersion?.() ?? '0';
        if (!isCanonicalUnsignedSqliteInteger(version)) {
            throw new TypeError('Restore target binding version is invalid');
        }
        return version;
    }

    private readImpact(
        candidateRevision: string,
        currentRevision: string,
        prepared?: PreparedRestoreDatabaseFacts,
    ): RestoreImpactSummary {
        return requireImpactSummary(this.options.impactSummary?.(
            candidateRevision,
            currentRevision,
        ) ?? Object.freeze({
            replacement: 'complete',
            automaticMerge: false,
            termCount: prepared?.termCount ?? '0',
            courseCount: prepared?.courseCount ?? '0',
            taskSeriesCount: prepared?.taskSeriesCount ?? '0',
            currentRevision,
            candidateRevision,
        }));
    }

    private previewChanged(session: InternalRestoreSession): boolean {
        const current = this.requireStore().status();
        const impact = current.kind === 'ready' && this.options.impactSummary
            ? this.readImpact(session.view.candidate.actualRevision, current.revision)
            : session.binding.impact;
        if (current.kind !== 'ready'
            || current.workspaceId !== session.view.current.workspaceId
            || current.revision !== session.binding.currentRevision
            || JSON.stringify(this.readCurrentLibraryBinding())
                !== JSON.stringify(session.binding.currentLibrary)
            || this.readTargetBindingVersion() !== session.binding.targetBindingVersion
            || JSON.stringify(impact) !== JSON.stringify(session.binding.impact)) {
            return true;
        }
        let preparedDatabaseDigest: Readonly<{sha256: string}>;
        try {
            preparedDatabaseDigest = digestPlainFile(
                session.preparedDatabasePath,
                SNAPSHOT_MAXIMUM_RAW_BYTES,
            );
        }
        catch {
            return true;
        }
        const observed = this.findCandidate(session.view.candidate.candidateRef);
        return observed.projection.status !== 'verified'
            || observed.entryName !== session.candidateEntryName
            || observed.databasePath !== session.candidateDatabasePath
            || observed.manifest?.rootDigest !== session.binding.candidateRootDigest
            || preparedDatabaseDigest.sha256 !== session.binding.candidateDatabaseDigest;
    }

    /**
     * Revalidates every confirm-bound DATA artifact immediately before the armed checkpoint.
     * @param {InternalRestoreSession} session - Protected pre-checkpoint session.
     * @return {void}
     */
    private requireActivationPreconditions(session: InternalRestoreSession): void {
        try {
            const safety = session.view.recoverability.safetySet;
            if (this.previewChanged(session)
                || safety.state !== 'verified'
                || this.validateSafetySet(
                    path.join(
                        this.activityControlRoot,
                        'restore',
                        session.view.operationId,
                        'safety',
                        safety.safetySetId,
                    ),
                    session.view,
                    safety.safetySetId,
                ) !== session.safetyRootDigest) {
                throw new Error('Restore activation evidence changed before checkpoint');
            }
        }
        catch (error) {
            throw new RestoreSessionError('staging-failed', error);
        }
    }

    private waitingDecision(session: InternalRestoreSession): RestoreSessionView {
        const waiting: RestoreSessionView = Object.freeze({
            ...session.view,
            sessionVersion: (BigInt(session.view.sessionVersion) + 1n).toString(),
            phase: 'waiting-decision',
            recoverability: Object.freeze({
                mode: 'required',
                safetySet: Object.freeze({state: 'pending'}),
            }),
            previewToken: null,
            allowedActions: Object.freeze([
                'repreview',
                'cancel-before-checkpoint',
            ] as const),
            problem: Object.freeze({code: 'impact-changed'}),
        });
        if (!isRestoreSessionView(waiting)) {
            throw new Error('Restore waiting-decision view construction failed');
        }
        return waiting;
    }

    private validateSafetySet(
        directoryPath: string,
        session: RestoreSessionView,
        safetySetId: string,
    ): string {
        if (JSON.stringify(listPlainDirectory(directoryPath))
            !== JSON.stringify([DATABASE_MEMBER_NAME, MANIFEST_MEMBER_NAME].sort())) {
            throw new Error('Restore safety set members are invalid');
        }
        const manifest = validateRestoreSafetyManifestV1(readBoundedPlainFile(
            path.join(directoryPath, MANIFEST_MEMBER_NAME),
            SAFETY_MANIFEST_MAXIMUM_BYTES,
        ));
        const databasePath = path.join(directoryPath, DATABASE_MEMBER_NAME);
        const databaseDigest = digestPlainFile(
            databasePath,
            SNAPSHOT_MAXIMUM_RAW_BYTES,
        );
        const databaseFacts = this.requireStore().validateRestoreSafetyDatabaseCopy(
            databasePath,
            session.current.revision,
        );
        if (manifest.input.safetySetId !== safetySetId
            || manifest.input.restoreSessionId !== session.restoreSessionId
            || manifest.input.operationId !== session.operationId
            || manifest.input.workspaceId !== session.current.workspaceId
            || manifest.input.protectedRevision !== session.current.revision
            || manifest.input.database.applicationId !== databaseFacts.applicationId
            || manifest.input.database.schemaLevel !== databaseFacts.schemaLevel
            || databaseFacts.workspaceId !== session.current.workspaceId
            || databaseFacts.actualRevision !== session.current.revision
            || manifest.input.database.byteLength !== databaseDigest.byteLength
            || manifest.input.database.sha256 !== databaseDigest.sha256
            || manifest.input.library.state !== 'absent') {
            throw new Error('Restore safety set binding is invalid');
        }
        return manifest.rootDigest;
    }
}
