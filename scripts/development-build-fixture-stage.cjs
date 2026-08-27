/**
 * @file Executes one closed stage against compiled code in a disposable exact-build worktree.
 */

'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {readFileSync, readdirSync} = require('node:fs');
const {tmpdir} = require('node:os');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');

/**
 * Stable Workspace identity used only inside the disposable fixture.
 *
 * @const
 * @type {string}
 */
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

/**
 * Stable setup command identity used only inside the disposable fixture.
 *
 * @const
 * @type {string}
 */
const COMMAND_ID = '22222222-2222-4222-8222-222222222222';

/**
 * Stable follow-up identity used only inside the disposable fixture.
 *
 * @const
 * @type {string}
 */
const FOLLOW_UP_ID = '33333333-3333-4333-8333-333333333333';

/**
 * Stable handoff identities used only inside the disposable fixture.
 *
 * @const
 * @type {Readonly<Record<string, string>>}
 */
const HANDOFF_IDS = Object.freeze({
    session: '44444444-4444-4444-8444-444444444444',
    operation: '55555555-5555-4555-8555-555555555555',
    confirmCommand: '66666666-6666-4666-8666-666666666666',
    continueCommand: '77777777-7777-4777-8777-777777777777',
    cancelCommand: '88888888-8888-4888-8888-888888888888',
});

/**
 * Closed development-only rollback artifacts carried by the fixture metadata.
 *
 * @const
 * @type {ReadonlyArray<Readonly<Record<string, string>>>}
 */
const ROLLBACK_ARTIFACTS = Object.freeze([
    Object.freeze({
        platform: 'darwin-arm64',
        name: 'CourseFlow-0.0.0-development-old-macOS-arm64.dmg',
        sha256: 'c'.repeat(64),
    }),
    Object.freeze({
        platform: 'win32-x64',
        name: 'CourseFlow-0.0.0-development-old-Windows-x64.msi',
        sha256: 'd'.repeat(64),
    }),
]);

/**
 * Requires one exact development AppBuildId at the fixture process boundary.
 *
 * @param {unknown} value Candidate identity.
 * @param {string} label Error label.
 * @return {string} Validated identity.
 */
function requireDevelopmentBuildId(value, label) {
    if (typeof value !== 'string' || !/^development:[0-9a-f]{40}$/.test(value)) {
        throw new Error(`${label} must be an exact development AppBuildId`);
    }
    return value;
}

/**
 * Builds the closed development-only binding required before migration writes.
 *
 * @param {string} sourceAppBuildId Build creating the safety copy.
 * @param {string} targetAppBuildId Exact rollback build.
 * @return {Readonly<Record<string, unknown>>} DATA migration binding.
 */
function migrationSafetyBinding(sourceAppBuildId, targetAppBuildId) {
    return Object.freeze({
        createdByAppBuildId: requireDevelopmentBuildId(sourceAppBuildId, 'source AppBuildId'),
        rollbackTarget: Object.freeze({
            releaseVersion: '0.0.0-development-old',
            tag: 'development-old',
            appBuildId: requireDevelopmentBuildId(targetAppBuildId, 'target AppBuildId'),
            artifacts: ROLLBACK_ARTIFACTS,
        }),
    });
}

/**
 * Resolves a path only when it belongs to this fixture's OS-temporary tree.
 *
 * @param {unknown} value Candidate path.
 * @param {string} label Error label.
 * @return {string} Validated absolute path.
 */
function requireDisposablePath(value, label) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) {
        throw new Error(`${label} must be absolute`);
    }
    const resolved = path.resolve(value);
    const relative = path.relative(path.resolve(tmpdir()), resolved);
    const firstSegment = relative.split(path.sep)[0];
    if (!relative
        || relative.startsWith(`..${path.sep}`)
        || path.isAbsolute(relative)
        || !firstSegment.startsWith('courseflow-development-build-fixture-')) {
        throw new Error(`${label} must stay inside the disposable fixture root`);
    }
    return resolved;
}

/**
 * Loads one CommonJS module emitted by the endpoint test compiler.
 *
 * @param {string} sourceRoot Exact-build source root.
 * @param {string} relativePath Module path below compiled src.
 * @return {Record<string, unknown>} Loaded module exports.
 */
function loadCompiledModule(sourceRoot, relativePath) {
    const modulePath = path.join(sourceRoot, '.test-dist', 'src', `${relativePath}.js`);
    return require(modulePath);
}

/**
 * Reads closed DATA facts from one database without invoking migration code.
 *
 * @param {string} databasePath SQLite database path.
 * @return {Record<string, string | null>} Stable database facts.
 */
function readDatabaseFacts(databasePath) {
    const database = new DatabaseSync(databasePath, {readOnly: true, readBigInts: true});
    try {
        const application = database.prepare('PRAGMA application_id').get();
        const schema = database.prepare('PRAGMA user_version').get();
        const workspace = database.prepare(
            'SELECT workspace_id, revision FROM workspace_state WHERE singleton = 1',
        ).get();
        const setup = database.prepare(
            'SELECT last_decision, setup_decision_version FROM setup_state WHERE singleton = 1',
        ).get();
        return {
            applicationId: application.application_id.toString(),
            schemaLevel: schema.user_version.toString(),
            workspaceId: workspace.workspace_id,
            revision: workspace.revision.toString(),
            lastDecision: setup.last_decision,
            setupVersion: setup.setup_decision_version.toString(),
        };
    }
    finally {
        database.close();
    }
}

/**
 * Reads stable facts from the active DataSlot.
 *
 * @param {string} dataRoot Disposable DataSlots root.
 * @return {Record<string, string | null>} Stable database facts.
 */
function readActiveFacts(dataRoot) {
    return readDatabaseFacts(path.join(dataRoot, 'active', 'workspace.sqlite'));
}

/**
 * Hashes the closed active database to prove a stop path did not write it.
 *
 * @param {string} dataRoot Disposable DataSlots root.
 * @return {string} Lowercase SHA-256.
 */
function hashActiveDatabase(dataRoot) {
    return createHash('sha256')
        .update(readFileSync(path.join(dataRoot, 'active', 'workspace.sqlite')))
        .digest('hex');
}

/**
 * Requires the stable setup fact used across all fixture restarts.
 *
 * @param {Record<string, string | null>} facts Observed database facts.
 * @param {string} expectedSchema Expected schema level.
 * @param {string} expectedRevision Expected Workspace revision.
 * @return {void}
 */
function requireStableFacts(facts, expectedSchema, expectedRevision) {
    assert.equal(facts.schemaLevel, expectedSchema);
    assert.equal(facts.workspaceId, WORKSPACE_ID);
    assert.equal(facts.revision, expectedRevision);
    assert.equal(facts.lastDecision, 'later');
    assert.equal(facts.setupVersion, '1');
}

/**
 * Revalidates the registered V1 safety copy and returns path-free evidence.
 *
 * @param {string} sourceRoot Exact new-build source root.
 * @param {Record<string, unknown>} data Compiled DATA module.
 * @param {string} dataRoot Disposable DataSlots root.
 * @param {Readonly<Record<string, unknown>>} binding Expected build binding.
 * @return {Readonly<Record<string, unknown>>} Verified path-free evidence.
 */
function requireMigrationSafetyEvidence(sourceRoot, data, dataRoot, binding) {
    const {canonicalJson} = loadCompiledModule(sourceRoot, 'shared/canonical-json');
    const status = data.inspectMigrationSafetyCopy(dataRoot);
    assert.equal(status.kind, 'verified');
    const metadata = status.metadata;
    assert.deepEqual(Object.keys(metadata).sort(), [
        'schema',
        'limitsVersion',
        'digestVersion',
        'migrationSafetyCopyId',
        'workspaceId',
        'sourceRevision',
        'sourceSchemaLevel',
        'sourceDataSlotProvenance',
        'targetSchemaLevel',
        'createdAt',
        'byteSize',
        'closedDataSlotDigest',
        'createdByAppBuildId',
        'rollbackTarget',
        'replacesMigrationSafetyCopyId',
        'metadataDigest',
    ].sort());
    assert.equal(metadata.schema, 'courseflow-migration-safety-copy-v1');
    assert.equal(metadata.limitsVersion, 'migration-safety-copy-limits-v1');
    assert.equal(metadata.digestVersion, 'sha256-v1');
    assert.match(metadata.migrationSafetyCopyId, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    assert.equal(metadata.workspaceId, WORKSPACE_ID);
    assert.equal(metadata.sourceRevision, '1');
    assert.equal(metadata.sourceSchemaLevel, '15');
    assert.deepEqual(Object.keys(metadata.sourceDataSlotProvenance).sort(), [
        'schema',
        'slotDevice',
        'slotInode',
        'databaseDevice',
        'databaseInode',
    ].sort());
    assert.equal(
        metadata.sourceDataSlotProvenance.schema,
        'courseflow-data-slot-stable-identity-v1',
    );
    for (const key of ['slotDevice', 'slotInode', 'databaseDevice', 'databaseInode']) {
        const identity = metadata.sourceDataSlotProvenance[key];
        assert.match(identity, /^(0|[1-9][0-9]*)$/);
        assert.ok(BigInt(identity) <= 18_446_744_073_709_551_615n);
    }
    const provenanceJson = JSON.stringify(metadata.sourceDataSlotProvenance);
    assert.equal(provenanceJson.includes('dataRoot'), false);
    assert.equal(provenanceJson.includes('sourceRoot'), false);
    assert.equal(metadata.targetSchemaLevel, '16');
    assert.equal(new Date(metadata.createdAt).toISOString(), metadata.createdAt);
    assert.equal(metadata.createdByAppBuildId, binding.createdByAppBuildId);
    assert.deepEqual(metadata.rollbackTarget, binding.rollbackTarget);
    assert.equal(metadata.replacesMigrationSafetyCopyId, null);
    assert.match(metadata.metadataDigest, /^[0-9a-f]{64}$/);

    const safetyNames = readdirSync(dataRoot)
        .filter(name => name.startsWith('migration-safety-copy-'))
        .sort();
    assert.deepEqual(safetyNames, [`migration-safety-copy-${metadata.migrationSafetyCopyId}`]);
    const safetyRoot = path.join(dataRoot, safetyNames[0]);
    assert.deepEqual(readdirSync(safetyRoot).sort(), [
        'migration-safety-copy-v1.json',
        'workspace.sqlite',
    ]);
    const metadataBytes = readFileSync(path.join(safetyRoot, 'migration-safety-copy-v1.json'));
    assert.equal(metadataBytes.toString('utf8'), canonicalJson(metadata));
    const metadataWithoutDigest = {...metadata};
    delete metadataWithoutDigest.metadataDigest;
    assert.equal(metadata.metadataDigest, createHash('sha256')
        .update(canonicalJson(metadataWithoutDigest), 'utf8')
        .digest('hex'));
    const databaseBytes = readFileSync(path.join(safetyRoot, 'workspace.sqlite'));
    assert.equal(metadata.byteSize, String(databaseBytes.byteLength));
    assert.equal(metadata.closedDataSlotDigest, createHash('sha256')
        .update(databaseBytes)
        .digest('hex'));
    const safetyFacts = readDatabaseFacts(path.join(safetyRoot, 'workspace.sqlite'));
    requireStableFacts(safetyFacts, '15', '1');
    return Object.freeze({metadata, safetyFacts});
}

/**
 * Returns the operation-owned deterministic handoff slot name.
 *
 * @param {'rollback'} role Closed role used by fixture observations.
 * @return {string} Direct-child slot name.
 */
function migrationRollbackSlotName(role) {
    return `.migration-rollback-${role}-${HANDOFF_IDS.operation}`;
}

/**
 * Counts durable canonical records without exposing the journal path.
 *
 * @param {string} activityControlRoot Stable fixture control root.
 * @return {number} Published record count.
 */
function migrationRollbackRecordCount(activityControlRoot) {
    return readdirSync(path.join(
        activityControlRoot,
        'migration-rollback',
        HANDOFF_IDS.operation,
        'journal',
    )).filter(name => !name.startsWith('.tmp-')).length;
}

/**
 * Reads path-free facts proving inspection did not perform another physical switch.
 *
 * @param {string} dataRoot Disposable DataSlots root.
 * @return {Readonly<Record<string, unknown>>} Active and rollback DATA evidence.
 */
function migrationRollbackPhysicalEvidence(dataRoot) {
    const rollbackSlotName = migrationRollbackSlotName('rollback');
    const activeFacts = readActiveFacts(dataRoot);
    const rollbackFacts = readDatabaseFacts(path.join(
        dataRoot,
        rollbackSlotName,
        'workspace.sqlite',
    ));
    requireStableFacts(activeFacts, '15', '1');
    requireStableFacts(rollbackFacts, '16', '2');
    return Object.freeze({
        activeFacts,
        activeHash: hashActiveDatabase(dataRoot),
        rollbackFacts,
        rollbackHash: createHash('sha256')
            .update(readFileSync(path.join(dataRoot, rollbackSlotName, 'workspace.sqlite')))
            .digest('hex'),
    });
}

/**
 * Reads the active DATA facts after one terminal branch.
 *
 * @param {string} dataRoot Disposable DataSlots root.
 * @return {Readonly<Record<string, unknown>>} Path-free active evidence.
 */
function migrationRollbackTerminalEvidence(dataRoot) {
    return Object.freeze({
        activeFacts: readActiveFacts(dataRoot),
        activeHash: hashActiveDatabase(dataRoot),
    });
}

/**
 * Builds exact immutable handoff facts from current and safety DATA evidence.
 *
 * @param {string} sourceRoot Exact new-build source root.
 * @param {string} dataRoot Disposable DataSlots root.
 * @param {string} sourceAppBuildId Exact current/source build.
 * @param {string} targetAppBuildId Exact rollback target build.
 * @return {Readonly<Record<string, unknown>>} Closed handoff facts.
 */
function migrationRollbackFacts(
    sourceRoot,
    dataRoot,
    sourceAppBuildId,
    targetAppBuildId,
) {
    const data = loadCompiledModule(sourceRoot, 'data/sqlite-data-store');
    const platform = loadCompiledModule(sourceRoot, 'platform/restore-activation-files');
    const status = data.inspectMigrationSafetyCopy(dataRoot);
    assert.equal(status.kind, 'verified');
    const metadata = status.metadata;
    assert.equal(metadata.createdByAppBuildId, sourceAppBuildId);
    assert.equal(metadata.rollbackTarget.appBuildId, targetAppBuildId);
    const currentFacts = readActiveFacts(dataRoot);
    requireStableFacts(currentFacts, '16', '2');
    const currentSlot = platform.observeRestoreDataSlot(dataRoot, 'active');
    assert.equal(currentSlot.kind, 'present');
    const currentDatabaseBytes = readFileSync(path.join(dataRoot, 'active', 'workspace.sqlite'));
    return Object.freeze({
        migrationRollbackSessionId: HANDOFF_IDS.session,
        operationId: HANDOFF_IDS.operation,
        sourceAppBuildId,
        currentAppBuildId: sourceAppBuildId,
        targetAppBuildId,
        sourceReleaseVersion: '0.0.0-development-new',
        currentReleaseVersion: '0.0.0-development-new',
        targetReleaseVersion: metadata.rollbackTarget.releaseVersion,
        previewDigest: createHash('sha256').update('fixture rollback preview', 'utf8').digest('hex'),
        confirmationDigest: createHash('sha256')
            .update('fixture rollback confirmation', 'utf8')
            .digest('hex'),
        safetyCopy: Object.freeze({
            migrationSafetyCopyId: metadata.migrationSafetyCopyId,
            workspaceId: metadata.workspaceId,
            schemaLevel: metadata.sourceSchemaLevel,
            revision: metadata.sourceRevision,
            byteLength: metadata.byteSize,
            digest: metadata.closedDataSlotDigest,
        }),
        currentData: Object.freeze({
            workspaceId: currentFacts.workspaceId,
            schemaLevel: currentFacts.schemaLevel,
            revision: currentFacts.revision,
            byteLength: String(currentDatabaseBytes.byteLength),
            digest: createHash('sha256').update(currentDatabaseBytes).digest('hex'),
            slotFingerprint: currentSlot.fingerprint.slotFingerprint,
        }),
    });
}

/**
 * Emits exactly one JSON evidence line.
 *
 * @param {unknown} value Evidence value.
 * @return {void}
 */
function emit(value) {
    process.stdout.write(`${JSON.stringify(value)}\n`);
}

/**
 * Reports the endpoint's compiled protocol, schema, and backup format identity.
 *
 * @param {string} sourceRoot Exact-build source root.
 * @return {void}
 */
function describeBuild(sourceRoot) {
    const schema = loadCompiledModule(sourceRoot, 'data/schema');
    const bootstrap = loadCompiledModule(sourceRoot, 'shared/bootstrap-contract');
    const protection = loadCompiledModule(sourceRoot, 'shared/workspace-protection-contract');
    let migrationSafetyCopyReader = false;
    let migrationRollbackHandoffReader = false;
    try {
        const data = loadCompiledModule(sourceRoot, 'data/sqlite-data-store');
        const handoff = loadCompiledModule(sourceRoot, 'protect/migration-rollback-handoff');
        migrationSafetyCopyReader = typeof data.inspectMigrationSafetyCopy === 'function'
            && typeof data.stageMigrationSafetyCopyForRollback === 'function'
            && typeof data.consumeMigrationSafetyCopyAfterRollback === 'function';
        migrationRollbackHandoffReader = typeof handoff.inspectMigrationRollbackBeforeWorkspaceOpen
            === 'function';
    }
    catch {
        migrationSafetyCopyReader = false;
        migrationRollbackHandoffReader = false;
    }
    const fullCommit = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
        windowsHide: true,
    }).trim();
    emit({
        action: 'describe-build',
        fullCommit,
        appBuildId: `development:${fullCommit}`,
        workspaceProtocol: bootstrap.BOOTSTRAP_PROTOCOL_VERSION,
        dataSchema: schema.CURRENT_SCHEMA_LEVEL,
        backupRepository: protection.BACKUP_REPOSITORY_SCHEMA,
        readers: {
            migrationSafetyCopyV1: migrationSafetyCopyReader,
            migrationRollbackHandoffV1: migrationRollbackHandoffReader,
        },
    });
}

/**
 * Uses the old build's DATA owner to create real old-schema facts.
 *
 * @param {string} sourceRoot Exact old-build source root.
 * @param {string} dataRoot Disposable DataSlots root.
 * @return {Promise<void>} Completion signal.
 */
async function createOldData(sourceRoot, dataRoot) {
    const data = loadCompiledModule(sourceRoot, 'data/sqlite-data-store');
    const contract = loadCompiledModule(sourceRoot, 'shared/workspace-data-contract');
    const store = data.initializeWorkspaceData(dataRoot, WORKSPACE_ID);
    const outcome = await store.commit(contract.normalizeRecordSetupDecisionCommand({
        commandId: COMMAND_ID,
        workspaceId: WORKSPACE_ID,
        intent: {
            kind: 'workspace.record-setup-decision',
            intentSchemaVersion: 1,
            payload: {decision: 'later'},
        },
        followUpId: FOLLOW_UP_ID,
        expectedRevision: '0',
        expectedSetupVersion: '0',
    }));
    assert.equal(outcome.ok, true);
    await store.close();
    const facts = readActiveFacts(dataRoot);
    requireStableFacts(facts, '15', '1');
    emit({action: 'old-create', facts});
}

/**
 * Stops after the new build has validated a safety copy but before schema write.
 *
 * @param {string} sourceRoot Exact new-build source root.
 * @param {string} dataRoot Disposable DataSlots root.
 * @param {string} sourceAppBuildId Exact new build identity.
 * @param {string} targetAppBuildId Exact old rollback build identity.
 * @return {Promise<void>} Completion signal.
 */
async function proveCopyBeforeWrite(
    sourceRoot,
    dataRoot,
    sourceAppBuildId,
    targetAppBuildId,
) {
    const data = loadCompiledModule(sourceRoot, 'data/sqlite-data-store');
    const binding = migrationSafetyBinding(sourceAppBuildId, targetAppBuildId);
    const beforeFacts = readActiveFacts(dataRoot);
    const beforeHash = hashActiveDatabase(dataRoot);
    let reachedSafetyBoundary = false;
    const opened = await data.openWorkspaceDataWithMigrations(dataRoot, {
        migrationSafetyCopy: binding,
        migrationFailpoint(point) {
            if (point === 'migration.after-safety-copy') {
                reachedSafetyBoundary = true;
                throw new Error('fixture stop after validated safety copy');
            }
        },
    });
    assert.equal(reachedSafetyBoundary, true);
    assert.equal(opened.kind, 'recovery');
    const afterFacts = readActiveFacts(dataRoot);
    const afterHash = hashActiveDatabase(dataRoot);
    assert.deepEqual(afterFacts, beforeFacts);
    assert.equal(afterHash, beforeHash);
    requireStableFacts(afterFacts, '15', '1');

    const safety = requireMigrationSafetyEvidence(sourceRoot, data, dataRoot, binding);
    emit({
        action: 'copy-before-write',
        activeHash: afterHash,
        activeFacts: afterFacts,
        safetyFacts: safety.safetyFacts,
        safetyMetadata: safety.metadata,
        safetyCopyCount: 1,
    });
}

/**
 * Migrates the old DATA through the new build and closes it cleanly.
 *
 * @param {string} sourceRoot Exact new-build source root.
 * @param {string} dataRoot Disposable DataSlots root.
 * @param {string} sourceAppBuildId Exact new build identity.
 * @param {string} targetAppBuildId Exact old rollback build identity.
 * @return {Promise<void>} Completion signal.
 */
async function migrateData(sourceRoot, dataRoot, sourceAppBuildId, targetAppBuildId) {
    const data = loadCompiledModule(sourceRoot, 'data/sqlite-data-store');
    const binding = migrationSafetyBinding(sourceAppBuildId, targetAppBuildId);
    const beforeSafety = requireMigrationSafetyEvidence(sourceRoot, data, dataRoot, binding);
    const opened = await data.openWorkspaceDataWithMigrations(dataRoot, {
        migrationSafetyCopy: binding,
    });
    assert.equal(opened.kind, 'ready');
    const snapshot = opened.store.readWorkspaceSetupSnapshot();
    await opened.store.close();
    const facts = readActiveFacts(dataRoot);
    requireStableFacts(facts, '16', '2');
    assert.equal(snapshot.revision, '2');
    assert.equal(snapshot.setup.lastDecision, 'later');
    const afterSafety = requireMigrationSafetyEvidence(sourceRoot, data, dataRoot, binding);
    assert.equal(
        afterSafety.metadata.migrationSafetyCopyId,
        beforeSafety.metadata.migrationSafetyCopyId,
    );
    emit({action: 'migrate', facts, snapshot, safetyMetadata: afterSafety.metadata});
}

/**
 * Reopens migrated DATA in a distinct process without invoking migration.
 *
 * @param {string} sourceRoot Exact new-build source root.
 * @param {string} dataRoot Disposable DataSlots root.
 * @return {Promise<void>} Completion signal.
 */
async function reopenData(sourceRoot, dataRoot) {
    const data = loadCompiledModule(sourceRoot, 'data/sqlite-data-store');
    const schema = loadCompiledModule(sourceRoot, 'data/schema');
    const expectedSchema = String(schema.CURRENT_SCHEMA_LEVEL);
    const expectedRevision = expectedSchema === '15' ? '1' : '2';
    const opened = data.openWorkspaceData(dataRoot);
    assert.equal(opened.kind, 'ready');
    const status = opened.store.status();
    const snapshot = opened.store.readWorkspaceSetupSnapshot();
    await opened.store.close();
    requireStableFacts(readActiveFacts(dataRoot), expectedSchema, expectedRevision);
    assert.equal(status.revision, expectedRevision);
    assert.equal(snapshot.setup.lastDecision, 'later');
    const safetyStatus = data.inspectMigrationSafetyCopy(dataRoot);
    emit({
        action: 'reopen',
        status,
        snapshot,
        safetyCopy: safetyStatus.kind,
        ...(safetyStatus.kind === 'verified' ? {safetyMetadata: safetyStatus.metadata} : {}),
    });
}

/**
 * Interrupts after the write-ahead install action but before its observed record.
 *
 * @param {string} sourceRoot Exact new-build source root.
 * @param {string} dataRoot Disposable DataSlots root.
 * @param {string} activityControlRoot Stable fixture control root.
 * @param {string} sourceAppBuildId Exact current/source build.
 * @param {string} targetAppBuildId Exact rollback target build.
 * @return {Promise<void>} Completion signal.
 */
async function armInterruptedMigrationRollback(
    sourceRoot,
    dataRoot,
    activityControlRoot,
    sourceAppBuildId,
    targetAppBuildId,
) {
    const handoff = loadCompiledModule(sourceRoot, 'protect/migration-rollback-handoff');
    const data = loadCompiledModule(sourceRoot, 'data/sqlite-data-store');
    const opened = data.openWorkspaceData(dataRoot);
    assert.equal(opened.kind, 'ready');
    opened.store.prepareForRestoreActivation();
    await opened.store.close();
    const facts = migrationRollbackFacts(
        sourceRoot,
        dataRoot,
        sourceAppBuildId,
        targetAppBuildId,
    );
    const safetyStatus = data.inspectMigrationSafetyCopy(dataRoot);
    assert.equal(safetyStatus.kind, 'verified');
    const planned = handoff.createMigrationRollbackHandoff(
        activityControlRoot,
        dataRoot,
        facts,
    );
    assert.equal(planned.phase, 'planned');
    assert.equal(planned.sessionVersion, '1');
    const prepared = handoff.prepareMigrationRollbackHandoff(
        activityControlRoot,
        dataRoot,
        HANDOFF_IDS.session,
        ({migrationSafetyCopyId, candidateSlotName}) => (
            data.stageMigrationSafetyCopyForRollback(
                dataRoot,
                migrationSafetyCopyId,
                candidateSlotName,
            )
        ),
    );
    assert.equal(prepared.phase, 'prepared');
    assert.equal(prepared.sessionVersion, '2');
    let interruptionCode = null;
    try {
        handoff.armMigrationRollbackHandoff(
            activityControlRoot,
            dataRoot,
            Object.freeze({
                action: 'confirm',
                commandId: HANDOFF_IDS.confirmCommand,
                migrationRollbackSessionId: HANDOFF_IDS.session,
                expectedSessionVersion: '2',
                currentAppBuildId: sourceAppBuildId,
            }),
            {
                failpoint(point) {
                    if (point === 'physical.after-install-safety-action') {
                        throw new Error(point);
                    }
                },
            },
        );
    }
    catch (error) {
        interruptionCode = error?.code ?? null;
    }
    assert.equal(interruptionCode, 'activation-pending');
    emit({
        action: 'handoff-arm-interrupted',
        interruptionCode,
        journalRecordCount: migrationRollbackRecordCount(activityControlRoot),
        physical: migrationRollbackPhysicalEvidence(dataRoot),
        safetyCopyCount: readdirSync(dataRoot)
            .filter(name => name.startsWith('migration-safety-copy-')).length,
    });
}

/**
 * Creates fixture-owned completion ports with a real exact-build DATA reopen.
 *
 * The Library and FLOW-00 callbacks are observable ports only; this fixture does not implement
 * the R6-04 or R6-05 owners that will eventually supply them.
 *
 * @param {Record<string, unknown>} data Exact-build compiled DATA module.
 * @param {string} dataRoot Disposable DataSlots root.
 * @param {string[]} events Ordered completion evidence.
 * @param {boolean} readOnly Whether the exact-build reopen must preserve closed bytes.
 * @return {Readonly<Record<string, unknown>>} Completion callbacks.
 */
function migrationRollbackCompletionCallbacks(data, dataRoot, events, readOnly = false) {
    return Object.freeze({
        async reopen(expected) {
            const opened = data.openWorkspaceData(dataRoot, {readOnly});
            assert.equal(opened.kind, readOnly ? 'read-only' : 'ready');
            await opened.store.close();
            const facts = readActiveFacts(dataRoot);
            assert.equal(facts.workspaceId, expected.workspaceId);
            assert.equal(facts.schemaLevel, expected.schemaLevel);
            assert.equal(facts.revision, expected.revision);
            const mode = readOnly ? 'reopen-read-only' : 'reopen';
            events.push(`${mode}:${facts.schemaLevel}:${facts.revision}`);
        },
        async libraryReconcile() {
            events.push('library-reconcile-fixture-port');
        },
        async flow00() {
            events.push('flow00-fixture-port');
        },
    });
}

/**
 * Cancels the armed handoff through the exact source build in a fresh process.
 *
 * @param {string} sourceRoot Exact source-build source root.
 * @param {string} dataRoot Disposable DataSlots root.
 * @param {string} activityControlRoot Stable fixture control root.
 * @param {string} sourceAppBuildId Exact source build identity.
 * @return {Promise<void>} Completion signal.
 */
async function cancelMigrationRollback(
    sourceRoot,
    dataRoot,
    activityControlRoot,
    sourceAppBuildId,
) {
    const handoff = loadCompiledModule(sourceRoot, 'protect/migration-rollback-handoff');
    const data = loadCompiledModule(sourceRoot, 'data/sqlite-data-store');
    const events = [];
    const status = await handoff.cancelMigrationRollbackHandoff(
        activityControlRoot,
        dataRoot,
        Object.freeze({
            action: 'cancel-as-source',
            commandId: HANDOFF_IDS.cancelCommand,
            migrationRollbackSessionId: HANDOFF_IDS.session,
            expectedSessionVersion: '4',
            currentAppBuildId: sourceAppBuildId,
        }),
        migrationRollbackCompletionCallbacks(data, dataRoot, events),
    );
    assert.equal(status.kind, 'cancelled');
    assert.equal(status.phase, 'cancelled');
    requireStableFacts(readActiveFacts(dataRoot), '16', '2');
    const safetyStatus = data.inspectMigrationSafetyCopy(dataRoot);
    assert.equal(safetyStatus.kind, 'verified');
    emit({
        action: 'handoff-cancel',
        status,
        events,
        safetyCopy: safetyStatus.kind,
        journalRecordCount: migrationRollbackRecordCount(activityControlRoot),
        physical: migrationRollbackTerminalEvidence(dataRoot),
    });
}

/**
 * Continues the armed handoff through the exact rollback-target build in a fresh process.
 *
 * @param {string} sourceRoot Exact rollback-target source root.
 * @param {string} dataRoot Disposable DataSlots root.
 * @param {string} activityControlRoot Stable fixture control root.
 * @param {string} targetAppBuildId Exact rollback-target build identity.
 * @return {Promise<void>} Completion signal.
 */
async function continueMigrationRollback(
    sourceRoot,
    dataRoot,
    activityControlRoot,
    targetAppBuildId,
) {
    const handoff = loadCompiledModule(sourceRoot, 'protect/migration-rollback-handoff');
    const data = loadCompiledModule(sourceRoot, 'data/sqlite-data-store');
    const events = [];
    const callbacks = migrationRollbackCompletionCallbacks(data, dataRoot, events, true);
    const status = await handoff.continueMigrationRollbackHandoff(
        activityControlRoot,
        dataRoot,
        Object.freeze({
            action: 'continue-as-target',
            commandId: HANDOFF_IDS.continueCommand,
            migrationRollbackSessionId: HANDOFF_IDS.session,
            expectedSessionVersion: '4',
            currentAppBuildId: targetAppBuildId,
        }),
        Object.freeze({
            ...callbacks,
            async consumeSafetyCopy(input) {
                data.consumeMigrationSafetyCopyAfterRollback(
                    dataRoot,
                    input.migrationSafetyCopyId,
                    input.operationId,
                );
                events.push('consume-safety-copy');
            },
        }),
    );
    assert.equal(status.kind, 'succeeded');
    assert.equal(status.phase, 'succeeded');
    requireStableFacts(readActiveFacts(dataRoot), '15', '1');
    const safetyStatus = data.inspectMigrationSafetyCopy(dataRoot);
    assert.equal(safetyStatus.kind, 'absent');
    emit({
        action: 'handoff-continue',
        status,
        events,
        safetyCopy: safetyStatus.kind,
        journalRecordCount: migrationRollbackRecordCount(activityControlRoot),
        physical: migrationRollbackTerminalEvidence(dataRoot),
    });
}

/**
 * Performs one fresh-process, exact-build boot inspection without physical continuation.
 *
 * @param {string} sourceRoot Exact new-build source root.
 * @param {string} dataRoot Disposable DataSlots root.
 * @param {string} activityControlRoot Stable fixture control root.
 * @param {string} currentAppBuildId Calling build identity.
 * @return {void}
 */
function inspectMigrationRollback(
    sourceRoot,
    dataRoot,
    activityControlRoot,
    currentAppBuildId,
) {
    const handoff = loadCompiledModule(sourceRoot, 'protect/migration-rollback-handoff');
    const status = handoff.inspectMigrationRollbackBeforeWorkspaceOpen(
        activityControlRoot,
        dataRoot,
        currentAppBuildId,
    );
    assert.equal('dataSlotsRoot' in status, false);
    assert.equal(JSON.stringify(status).includes(activityControlRoot), false);
    const physical = status.kind === 'maintenance'
        ? migrationRollbackPhysicalEvidence(dataRoot)
        : migrationRollbackTerminalEvidence(dataRoot);
    emit({
        action: 'handoff-inspect',
        status,
        journalRecordCount: migrationRollbackRecordCount(activityControlRoot),
        physical,
    });
}

/**
 * Proves the old build stops on the new schema without changing bytes.
 *
 * @param {string} sourceRoot Exact old-build source root.
 * @param {string} dataRoot Disposable DataSlots root.
 * @return {void}
 */
function rejectFutureSchema(sourceRoot, dataRoot) {
    const data = loadCompiledModule(sourceRoot, 'data/sqlite-data-store');
    const beforeHash = hashActiveDatabase(dataRoot);
    const opened = data.openWorkspaceData(dataRoot);
    assert.equal(opened.kind, 'recovery');
    assert.equal(opened.problem.code, 'incompatible-version');
    assert.equal(opened.problem.details.actualSchemaLevel, 16);
    assert.equal(opened.problem.details.requiredSchemaLevel, 15);
    const afterHash = hashActiveDatabase(dataRoot);
    assert.equal(afterHash, beforeHash);
    emit({action: 'reject-future-schema', problem: opened.problem, activeHash: afterHash});
}

/**
 * Proves both compiled protocol readers reject the other build identity.
 *
 * @param {string} oldSourceRoot Exact old-build source root.
 * @param {string} newSourceRoot Exact new-build source root.
 * @param {string} oldBuildId Exact old build identity.
 * @param {string} newBuildId Exact new build identity.
 * @return {void}
 */
function rejectMixedBuilds(oldSourceRoot, newSourceRoot, oldBuildId, newBuildId) {
    const oldBootstrap = loadCompiledModule(oldSourceRoot, 'shared/bootstrap-contract');
    const newBootstrap = loadCompiledModule(newSourceRoot, 'shared/bootstrap-contract');
    const oldRequest = oldBootstrap.makeBootstrapRequest('old-build-request', oldBuildId);
    const newRequest = newBootstrap.makeBootstrapRequest('new-build-request', newBuildId);
    assert.equal(oldBootstrap.isBootstrapRequest(oldRequest, oldBuildId), true);
    assert.equal(newBootstrap.isBootstrapRequest(newRequest, newBuildId), true);
    assert.equal(oldBootstrap.isBootstrapRequest(newRequest, oldBuildId), false);
    assert.equal(newBootstrap.isBootstrapRequest(oldRequest, newBuildId), false);
    emit({
        action: 'reject-mixed-builds',
        oldAcceptsNew: false,
        newAcceptsOld: false,
    });
}

/**
 * Requires the exact argument count for one stage action.
 *
 * @param {string[]} args Stage arguments.
 * @param {number} count Required count.
 * @return {void}
 */
function requireArgumentCount(args, count) {
    if (args.length !== count) {
        throw new Error('development build fixture stage received the wrong argument count');
    }
}

/**
 * Dispatches the closed stage protocol.
 *
 * @return {Promise<void>} Completion signal.
 */
async function main() {
    const [action, ...args] = process.argv.slice(2);
    if (![
        'describe-build',
        'old-create',
        'copy-before-write',
        'migrate',
        'reopen',
        'handoff-arm-interrupted',
        'handoff-inspect',
        'handoff-cancel',
        'handoff-continue',
        'reject-future-schema',
        'reject-mixed-builds',
    ].includes(action)) {
        throw new Error('unsupported development build fixture stage action');
    }

    if (action === 'reject-mixed-builds') {
        requireArgumentCount(args, 4);
        rejectMixedBuilds(
            requireDisposablePath(args[0], 'old source root'),
            requireDisposablePath(args[1], 'new source root'),
            args[2],
            args[3],
        );
        return;
    }

    let requiredCount = 2;
    if (action === 'describe-build') {
        requiredCount = 1;
    }
    else if (action === 'handoff-arm-interrupted') {
        requiredCount = 5;
    }
    else if (['handoff-inspect', 'handoff-cancel', 'handoff-continue'].includes(action)
        || ['copy-before-write', 'migrate'].includes(action)) {
        requiredCount = 4;
    }
    requireArgumentCount(args, requiredCount);
    const sourceRoot = requireDisposablePath(args[0], 'source root');
    if (action === 'describe-build') {
        describeBuild(sourceRoot);
        return;
    }
    const dataRoot = requireDisposablePath(args[1], 'data root');
    switch (action) {
        case 'old-create':
            await createOldData(sourceRoot, dataRoot);
            return;
        case 'copy-before-write':
            await proveCopyBeforeWrite(sourceRoot, dataRoot, args[2], args[3]);
            return;
        case 'migrate':
            await migrateData(sourceRoot, dataRoot, args[2], args[3]);
            return;
        case 'reopen':
            await reopenData(sourceRoot, dataRoot);
            return;
        case 'handoff-arm-interrupted':
            await armInterruptedMigrationRollback(
                sourceRoot,
                dataRoot,
                requireDisposablePath(args[2], 'activity control root'),
                requireDevelopmentBuildId(args[3], 'source AppBuildId'),
                requireDevelopmentBuildId(args[4], 'target AppBuildId'),
            );
            return;
        case 'handoff-inspect':
            inspectMigrationRollback(
                sourceRoot,
                dataRoot,
                requireDisposablePath(args[2], 'activity control root'),
                requireDevelopmentBuildId(args[3], 'current AppBuildId'),
            );
            return;
        case 'handoff-cancel':
            await cancelMigrationRollback(
                sourceRoot,
                dataRoot,
                requireDisposablePath(args[2], 'activity control root'),
                requireDevelopmentBuildId(args[3], 'source AppBuildId'),
            );
            return;
        case 'handoff-continue':
            await continueMigrationRollback(
                sourceRoot,
                dataRoot,
                requireDisposablePath(args[2], 'activity control root'),
                requireDevelopmentBuildId(args[3], 'target AppBuildId'),
            );
            return;
        default:
            rejectFutureSchema(sourceRoot, dataRoot);
    }
}

main().catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error && error.cause instanceof Error
        ? `: ${error.cause.message}`
        : '';
    process.stderr.write(`FAIL development build fixture stage: ${message}${cause}\n`);
    process.exitCode = 1;
});
