/**
 * @file Executes one closed stage against compiled code in a disposable exact-build worktree.
 */

'use strict';

const assert = require('node:assert/strict');
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
    emit({
        action: 'describe-build',
        workspaceProtocol: bootstrap.BOOTSTRAP_PROTOCOL_VERSION,
        dataSchema: schema.CURRENT_SCHEMA_LEVEL,
        backupRepository: protection.BACKUP_REPOSITORY_SCHEMA,
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
 * @return {Promise<void>} Completion signal.
 */
async function proveCopyBeforeWrite(sourceRoot, dataRoot) {
    const data = loadCompiledModule(sourceRoot, 'data/sqlite-data-store');
    const beforeFacts = readActiveFacts(dataRoot);
    const beforeHash = hashActiveDatabase(dataRoot);
    let reachedSafetyBoundary = false;
    const opened = await data.openWorkspaceDataWithMigrations(dataRoot, {
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

    const safetyNames = readdirSync(dataRoot)
        .filter(name => name.startsWith('migration-safety-level-15-'))
        .sort();
    assert.equal(safetyNames.length, 1);
    const safetyFacts = readDatabaseFacts(path.join(dataRoot, safetyNames[0], 'workspace.sqlite'));
    requireStableFacts(safetyFacts, '15', '1');
    emit({
        action: 'copy-before-write',
        activeHash: afterHash,
        activeFacts: afterFacts,
        safetyFacts,
        safetyCopyCount: safetyNames.length,
    });
}

/**
 * Migrates the old DATA through the new build and closes it cleanly.
 *
 * @param {string} sourceRoot Exact new-build source root.
 * @param {string} dataRoot Disposable DataSlots root.
 * @return {Promise<void>} Completion signal.
 */
async function migrateData(sourceRoot, dataRoot) {
    const data = loadCompiledModule(sourceRoot, 'data/sqlite-data-store');
    const opened = await data.openWorkspaceDataWithMigrations(dataRoot);
    assert.equal(opened.kind, 'ready');
    const snapshot = opened.store.readWorkspaceSetupSnapshot();
    await opened.store.close();
    const facts = readActiveFacts(dataRoot);
    requireStableFacts(facts, '16', '2');
    assert.equal(snapshot.revision, '2');
    assert.equal(snapshot.setup.lastDecision, 'later');
    emit({action: 'migrate', facts, snapshot});
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
    const opened = data.openWorkspaceData(dataRoot);
    assert.equal(opened.kind, 'ready');
    const status = opened.store.status();
    const snapshot = opened.store.readWorkspaceSetupSnapshot();
    await opened.store.close();
    requireStableFacts(readActiveFacts(dataRoot), '16', '2');
    assert.equal(status.revision, '2');
    assert.equal(snapshot.setup.lastDecision, 'later');
    emit({action: 'reopen', status, snapshot});
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

    const requiredCount = action === 'describe-build' ? 1 : 2;
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
            await proveCopyBeforeWrite(sourceRoot, dataRoot);
            return;
        case 'migrate':
            await migrateData(sourceRoot, dataRoot);
            return;
        case 'reopen':
            await reopenData(sourceRoot, dataRoot);
            return;
        default:
            rejectFutureSchema(sourceRoot, dataRoot);
    }
}

main().catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`FAIL development build fixture stage: ${message}\n`);
    process.exitCode = 1;
});
