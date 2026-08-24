/**
 * @file Verifies the SQLite DATA owner's failure, concurrency, and recovery semantics.
 */

import assert from 'node:assert/strict';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
    classifySqliteFailure,
    initializeWorkspaceData,
    openWorkspaceData,
    type CommandReceiptOutcome,
    type CommitFailpoint,
    type DataCommitResult,
    type SqliteDataStore,
} from '../../src/data/sqlite-data-store';
import {
    normalizeRecordSetupDecisionCommand,
    type RecordSetupDecisionCommand,
} from '../../src/shared/workspace-data-contract';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const COMMAND_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FOLLOW_UP_ID = '22222222-2222-4222-8222-222222222222';
const SECOND_COMMAND_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SECOND_FOLLOW_UP_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_WORKSPACE_ID = '99999999-9999-4999-8999-999999999999';
const SQLITE_INTEGER_MAX = '9223372036854775807';
const FIXTURE_PATH = join(__dirname, 'sqlite-data-restart.fixture.js');
const COMMITTED_OUTCOME: CommandReceiptOutcome = {
    kind: 'committed',
    revision: '1',
    effects: [{
        code: 'workspace.setup-decision-recorded',
        entity: {
            kind: 'workspace-setup',
            id: WORKSPACE_ID,
            version: '1',
        },
    }],
    pendingFollowUps: [FOLLOW_UP_ID],
};

function createTempDataSlots(t: test.TestContext): string {
    const dataSlotsRoot = mkdtempSync(join(tmpdir(), 'courseflow-data-'));
    t.after(() => rmSync(dataSlotsRoot, { recursive: true, force: true }));
    return dataSlotsRoot;
}

function makeCommand(overrides: Record<string, unknown> = {}): RecordSetupDecisionCommand {
    return normalizeRecordSetupDecisionCommand({
        commandId: COMMAND_ID,
        workspaceId: WORKSPACE_ID,
        intent: {
            kind: 'workspace.record-setup-decision',
            intentSchemaVersion: 1,
            payload: { decision: 'later' },
        },
        followUpId: FOLLOW_UP_ID,
        expectedRevision: '0',
        expectedSetupVersion: '0',
        ...overrides,
    });
}

function readSetupFacts(dataSlotsRoot: string) {
    const database = new DatabaseSync(join(dataSlotsRoot, 'active', 'workspace.sqlite'), {
        readOnly: true,
        readBigInts: true,
    });

    try {
        const setup = database.prepare(
            'SELECT last_decision, setup_decision_version FROM setup_state WHERE singleton = 1',
        ).get() as {
            last_decision: 'later' | 'skip' | null;
            setup_decision_version: bigint;
        };
        return {
            lastDecision: setup.last_decision,
            entityVersion: setup.setup_decision_version.toString(),
        };
    } finally {
        database.close();
    }
}

function setVersionCounters(dataSlotsRoot: string, revision: string, setupVersion: string): void {
    const database = new DatabaseSync(join(dataSlotsRoot, 'active', 'workspace.sqlite'));

    try {
        database.prepare(
            'UPDATE workspace_state SET revision = ? WHERE singleton = 1',
        ).run(BigInt(revision));
        database.prepare(
            'UPDATE setup_state SET setup_decision_version = ? WHERE singleton = 1',
        ).run(BigInt(setupVersion));
    } finally {
        database.close();
    }
}

async function initializeAndClose(dataSlotsRoot: string): Promise<void> {
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    await store.close();
}

function reopenReady(dataSlotsRoot: string): SqliteDataStore {
    const opened = openWorkspaceData(dataSlotsRoot);
    assert.equal(opened.kind, 'ready');
    if (opened.kind !== 'ready') {
        throw new Error('Expected ready workspace data');
    }
    return opened.store;
}

function runFailpoint(dataSlotsRoot: string, failpoint: CommitFailpoint): void {
    const result = spawnSync(process.execPath, [FIXTURE_PATH, dataSlotsRoot, failpoint]);
    assert.equal(
        result.status,
        73,
        `Failpoint ${failpoint} was not reached (status ${String(result.status)}): ${result.stderr.toString()}`,
    );
}

function assertFrozenPlainOutcome(outcome: CommandReceiptOutcome): void {
    assert.equal(Object.getPrototypeOf(outcome), Object.prototype);
    assert.equal(Object.isFrozen(outcome), true);
    assert.equal(Object.isFrozen(outcome.effects), true);
    assert.equal(Object.isFrozen(outcome.effects[0]), true);
    assert.equal(Object.isFrozen(outcome.effects[0].entity), true);
    assert.equal(Object.isFrozen(outcome.pendingFollowUps), true);
}

test('TEST-DATA-005: existing data opens into one safe mode without reset', async (t) => {
    const cases = [
        {
            name: 'absent slot',
            prepare(_dataSlotsRoot: string) {},
            options: undefined,
            expected: { kind: 'absent' },
        },
        {
            name: 'forced current read-only',
            prepare: initializeAndClose,
            options: { readOnly: true },
            expected: { kind: 'read-only' },
        },
        {
            name: 'future schema level',
            async prepare(dataSlotsRoot: string) {
                await initializeAndClose(dataSlotsRoot);
                const database = new DatabaseSync(join(dataSlotsRoot, 'active', 'workspace.sqlite'));
                database.exec('PRAGMA user_version = 9');
                database.close();
            },
            options: undefined,
            expected: {
                kind: 'recovery',
                problem: {
                    code: 'incompatible-version',
                    scope: 'workspace',
                    dataEffect: 'unchanged',
                    affectedCapabilities: ['workspace.read', 'workspace.write'],
                    allowedActions: [],
                    context: {},
                    details: { actualSchemaLevel: 9, requiredSchemaLevel: 8 },
                },
            },
        },
        {
            name: 'wrong application id',
            async prepare(dataSlotsRoot: string) {
                await initializeAndClose(dataSlotsRoot);
                const database = new DatabaseSync(join(dataSlotsRoot, 'active', 'workspace.sqlite'));
                database.exec('PRAGMA application_id = 1234');
                database.close();
            },
            options: undefined,
            expected: {
                kind: 'recovery',
                problem: {
                    code: 'integrity',
                    scope: 'workspace',
                    dataEffect: 'unchanged',
                    affectedCapabilities: ['workspace.read', 'workspace.write'],
                    allowedActions: [],
                    context: {},
                    details: { reason: 'wrong-application-id' },
                },
            },
        },
        {
            name: 'missing required index',
            async prepare(dataSlotsRoot: string) {
                await initializeAndClose(dataSlotsRoot);
                const database = new DatabaseSync(join(dataSlotsRoot, 'active', 'workspace.sqlite'));
                database.exec('DROP INDEX durable_followups_by_command');
                database.close();
            },
            options: undefined,
            expected: {
                kind: 'recovery',
                problem: {
                    code: 'integrity',
                    scope: 'workspace',
                    dataEffect: 'unchanged',
                    affectedCapabilities: ['workspace.read', 'workspace.write'],
                    allowedActions: [],
                    context: {},
                    details: { reason: 'schema-mismatch' },
                },
            },
        },
        {
            name: 'foreign key orphan',
            async prepare(dataSlotsRoot: string) {
                await initializeAndClose(dataSlotsRoot);
                const database = new DatabaseSync(join(dataSlotsRoot, 'active', 'workspace.sqlite'), {
                    enableForeignKeyConstraints: false,
                });
                database.prepare(`
                    INSERT INTO receipt_effects (
                        command_id,
                        effect_order,
                        effect_code,
                        entity_kind,
                        entity_id,
                        entity_version
                    ) VALUES (?, 0, 'workspace.setup-decision-recorded', 'workspace-setup', ?, 0)
                `).run(COMMAND_ID, WORKSPACE_ID);
                database.close();
            },
            options: undefined,
            expected: {
                kind: 'recovery',
                problem: {
                    code: 'integrity',
                    scope: 'workspace',
                    dataEffect: 'unchanged',
                    affectedCapabilities: ['workspace.read', 'workspace.write'],
                    allowedActions: [],
                    context: {},
                    details: { reason: 'database-corrupt' },
                },
            },
        },
        {
            name: 'non-SQLite bytes',
            prepare(dataSlotsRoot: string) {
                const active = join(dataSlotsRoot, 'active');
                mkdirSync(active);
                writeFileSync(join(active, 'workspace.sqlite'), Buffer.from('not a SQLite database'));
            },
            options: undefined,
            expected: {
                kind: 'recovery',
                problem: {
                    code: 'integrity',
                    scope: 'workspace',
                    dataEffect: 'unchanged',
                    affectedCapabilities: ['workspace.read', 'workspace.write'],
                    allowedActions: [],
                    context: {},
                    details: { reason: 'database-corrupt' },
                },
            },
        },
        {
            name: 'existing nonempty level zero',
            prepare(dataSlotsRoot: string) {
                const active = join(dataSlotsRoot, 'active');
                mkdirSync(active);
                const database = new DatabaseSync(join(active, 'workspace.sqlite'));
                database.exec('CREATE TABLE legacy_fact (value TEXT NOT NULL) STRICT');
                database.close();
            },
            options: undefined,
            expected: {
                kind: 'recovery',
                problem: {
                    code: 'integrity',
                    scope: 'workspace',
                    dataEffect: 'unchanged',
                    affectedCapabilities: ['workspace.read', 'workspace.write'],
                    allowedActions: [],
                    context: {},
                    details: { reason: 'nonempty-level-zero' },
                },
            },
        },
    ] as const;

    for (const openCase of cases) {
        await t.test(openCase.name, async (caseTest) => {
            const dataSlotsRoot = createTempDataSlots(caseTest);
            await openCase.prepare(dataSlotsRoot);
            const active = join(dataSlotsRoot, 'active');
            const path = join(active, 'workspace.sqlite');
            const before = existsSync(path) ? readFileSync(path) : undefined;

            const opened = openWorkspaceData(dataSlotsRoot, openCase.options);
            assert.equal(opened.sqliteVersion, process.versions.sqlite);
            if (openCase.expected.kind === 'absent') {
                assert.deepEqual(opened, {
                    kind: 'absent',
                    sqliteVersion: process.versions.sqlite,
                });
                assert.equal(existsSync(active), false);
                return;
            }

            assert.ok(before);
            assert.deepEqual(readFileSync(path), before);
            if (openCase.expected.kind === 'read-only') {
                assert.equal(opened.kind, 'read-only');
                if (opened.kind !== 'read-only') {
                    return;
                }
                assert.deepEqual(opened.store.readWorkspaceSetupSnapshot(), {
                    revision: '0',
                    setup: {
                        workspaceId: WORKSPACE_ID,
                        lastDecision: null,
                        entityVersion: '0',
                    },
                });
                assert.equal(opened.store.receipt(COMMAND_ID), null);
                assert.deepEqual(opened.store.status(), {
                    kind: 'read-only',
                    workspaceId: WORKSPACE_ID,
                    schemaLevel: 8,
                    revision: '0',
                    problem: {
                        code: 'permission',
                        scope: 'workspace',
                        dataEffect: 'unchanged',
                        affectedCapabilities: ['workspace.write'],
                        allowedActions: [],
                        context: {},
                        details: { reason: 'read-only' },
                    },
                });
                assert.deepEqual(await opened.store.commit(makeCommand()), {
                    ok: false,
                    problem: {
                        code: 'permission',
                        scope: 'workspace',
                        dataEffect: 'unchanged',
                        affectedCapabilities: ['workspace.write'],
                        allowedActions: [],
                        context: { revision: '0' },
                        details: { reason: 'read-only' },
                    },
                });
                assert.deepEqual(readFileSync(path), before);
                await opened.store.close();
                return;
            }

            assert.deepEqual(opened, {
                ...openCase.expected,
                sqliteVersion: process.versions.sqlite,
            });
            assert.equal('store' in opened, false);
            assert.equal(Object.getPrototypeOf(opened), Object.prototype);
            assert.equal(Object.isFrozen(opened), true);
            if (opened.kind === 'recovery') {
                assert.equal(Object.isFrozen(opened.problem), true);
                assert.equal(Object.isFrozen(opened.problem.affectedCapabilities), true);
                assert.equal(Object.isFrozen(opened.problem.allowedActions), true);
                assert.equal(Object.isFrozen(opened.problem.context), true);
                assert.equal(Object.isFrozen(opened.problem.details), true);
            }
        });
    }
});

test('TEST-DATA-005: SQLite owner maps only primary code and commit stage', () => {
    const cases = [
        { code: 5, stage: 'pre-commit', expected: { kind: 'retryable-unchanged', reason: 'writer-busy' } },
        { code: 8, stage: 'pre-commit', expected: { kind: 'read-only', reason: 'permission' } },
        { code: 13, stage: 'pre-commit', expected: { kind: 'failed-unchanged', reason: 'storage-full' } },
        { code: 10, stage: 'pre-commit', expected: { kind: 'failed-unchanged', reason: 'recovery-required' } },
        { code: 13, stage: 'commit-outcome-unknown', expected: { kind: 'reopen-required' } },
        { code: 10, stage: 'commit-outcome-unknown', expected: { kind: 'reopen-required' } },
    ] as const;

    for (const mapping of cases) {
        assert.deepEqual(
            classifySqliteFailure({ errcode: mapping.code }, mapping.stage),
            mapping.expected,
        );
    }
});

test('TEST-DATA-005: an existing partial active slot is recovery-required without alteration', async (t) => {
    const cases = [
        {
            name: 'empty active directory',
            prepare(active: string) {
                mkdirSync(active);
            },
            assertUnchanged(active: string) {
                assert.deepEqual(readdirSync(active), []);
            },
        },
        {
            name: 'active path is a file',
            prepare(active: string) {
                writeFileSync(active, Buffer.from('partial active slot'));
            },
            assertUnchanged(active: string) {
                assert.deepEqual(readFileSync(active), Buffer.from('partial active slot'));
            },
        },
    ] as const;

    for (const activeCase of cases) {
        await t.test(activeCase.name, (caseTest) => {
            const dataSlotsRoot = createTempDataSlots(caseTest);
            const active = join(dataSlotsRoot, 'active');
            activeCase.prepare(active);

            assert.deepEqual(openWorkspaceData(dataSlotsRoot), {
                kind: 'recovery',
                sqliteVersion: process.versions.sqlite,
                problem: {
                    code: 'recovery-required',
                    scope: 'workspace',
                    dataEffect: 'unchanged',
                    affectedCapabilities: ['workspace.read', 'workspace.write'],
                    allowedActions: [],
                    context: {},
                    details: { reason: 'database-unreadable' },
                },
            });
            activeCase.assertUnchanged(active);
        });
    }
});

test('TEST-DATA-005: an unmapped pre-COMMIT failure rolls back behind a stable DATA error', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    assert.deepEqual(await store.commit(makeCommand()), { ok: true, value: COMMITTED_OUTCOME });
    const duplicateFollowUp = makeCommand({
        commandId: SECOND_COMMAND_ID,
        followUpId: FOLLOW_UP_ID,
        expectedRevision: '1',
        expectedSetupVersion: '1',
        intent: {
            kind: 'workspace.record-setup-decision',
            intentSchemaVersion: 1,
            payload: { decision: 'skip' },
        },
    });

    let rejection: unknown;
    try {
        await store.commit(duplicateFollowUp);
    } catch (error) {
        rejection = error;
    }
    assert.ok(rejection instanceof Error);
    assert.deepEqual({ name: rejection.name, message: rejection.message }, {
        name: 'Error',
        message: 'Workspace data commit failed',
    });
    assert.equal('code' in rejection, false);
    assert.equal('errcode' in rejection, false);
    assert.equal('errstr' in rejection, false);
    assert.doesNotMatch(rejection.message, /sqlite|unique|constraint|insert|durable_followups/i);
    assert.deepEqual(store.readWorkspaceSetupSnapshot(), {
        revision: '1',
        setup: {
            workspaceId: WORKSPACE_ID,
            lastDecision: 'later',
            entityVersion: '1',
        },
    });
    assert.equal(store.status().revision, '1');
    assert.equal(store.receipt(SECOND_COMMAND_ID), null);
    assert.deepEqual(store.readPendingFollowUps(), [{
        followUpId: FOLLOW_UP_ID,
        originatingCommandId: COMMAND_ID,
        owner: 'protect',
        kind: 'backup-needed-through',
        prerequisiteRevision: '1',
        state: 'pending',
        version: '0',
    }]);
    assert.equal(store.readProtectionWatermark(), '1');
    await store.close();
});

test('TEST-DATA-001/005: a failed rollback terminalizes the sole connection before reuse', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const queuedCommand = makeCommand({
        commandId: SECOND_COMMAND_ID,
        followUpId: SECOND_FOLLOW_UP_ID,
        intent: {
            kind: 'workspace.record-setup-decision',
            intentSchemaVersion: 1,
            payload: { decision: 'skip' },
        },
    });
    const originalExec = DatabaseSync.prototype.exec;
    let failRollback = false;

    try {
        DatabaseSync.prototype.exec = function exec(sql: string): void {
            if (sql === 'ROLLBACK' && failRollback) {
                failRollback = false;
                throw new Error('Injected rollback failure');
            }
            originalExec.call(this, sql);
        };
        const first = store.commit(makeCommand(), {
            failpoint(point) {
                if (point === 'commit.after-facts') {
                    failRollback = true;
                    throw new Error('Injected pre-COMMIT failure');
                }
            },
        });
        const queued = store.commit(queuedCommand);

        const reopenError = {
            name: 'Error',
            message: 'Workspace data store requires reopen',
        };
        const settled = await Promise.allSettled([first, queued]);
        for (const result of settled) {
            assert.equal(result.status, 'rejected');
            if (result.status === 'rejected') {
                assert.deepEqual({ name: result.reason.name, message: result.reason.message }, reopenError);
            }
        }
        await assert.rejects(store.commit(queuedCommand), reopenError);
        assert.throws(() => store.readWorkspaceSetupSnapshot(), reopenError);
    } finally {
        DatabaseSync.prototype.exec = originalExec;
        await store.close();
    }

    const reopened = reopenReady(dataSlotsRoot);
    assert.deepEqual(reopened.readWorkspaceSetupSnapshot(), {
        revision: '0',
        setup: {
            workspaceId: WORKSPACE_ID,
            lastDecision: null,
            entityVersion: '0',
        },
    });
    assert.equal(reopened.receipt(COMMAND_ID), null);
    assert.equal(reopened.receipt(SECOND_COMMAND_ID), null);
    assert.deepEqual(reopened.readPendingFollowUps(), []);
    assert.equal(reopened.readProtectionWatermark(), '0');
    await reopened.close();
});

test('TEST-DATA-001: every pre-COMMIT process exit leaves all commit facts unchanged', async (t) => {
    for (const failpoint of [
        'commit.after-begin',
        'commit.after-receipt-read',
        'commit.after-expected-versions',
        'commit.after-facts',
        'commit.after-revision',
        'commit.after-receipt',
        'commit.after-followup',
        'commit.after-watermark',
        'commit.before-sqlite-commit',
    ] as const) {
        const dataSlotsRoot = createTempDataSlots(t);
        await initializeAndClose(dataSlotsRoot);

        runFailpoint(dataSlotsRoot, failpoint);

        const reopened = reopenReady(dataSlotsRoot);
        assert.equal(reopened.status().revision, '0');
        assert.deepEqual(readSetupFacts(dataSlotsRoot), {
            lastDecision: null,
            entityVersion: '0',
        });
        assert.equal(reopened.receipt(COMMAND_ID), null);
        assert.deepEqual(reopened.readPendingFollowUps(), []);
        assert.equal(reopened.readProtectionWatermark(), '0');
        await reopened.close();
    }
});

test('TEST-DATA-001/002: post-COMMIT response loss persists all facts and replays its receipt', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    await initializeAndClose(dataSlotsRoot);

    runFailpoint(dataSlotsRoot, 'commit.after-sqlite-commit');

    const reopened = reopenReady(dataSlotsRoot);
    assert.equal(reopened.status().revision, '1');
    assert.deepEqual(readSetupFacts(dataSlotsRoot), {
        lastDecision: 'later',
        entityVersion: '1',
    });
    const receipt = reopened.receipt(COMMAND_ID);
    assert.deepEqual(receipt, COMMITTED_OUTCOME);
    assert.notEqual(receipt, null);
    if (receipt) {
        assertFrozenPlainOutcome(receipt);
    }
    assert.deepEqual(reopened.readPendingFollowUps(), [{
        followUpId: FOLLOW_UP_ID,
        originatingCommandId: COMMAND_ID,
        owner: 'protect',
        kind: 'backup-needed-through',
        prerequisiteRevision: '1',
        state: 'pending',
        version: '0',
    }]);
    assert.equal(reopened.readProtectionWatermark(), '1');

    assert.deepEqual(await reopened.commit(makeCommand()), {
        ok: true,
        value: COMMITTED_OUTCOME,
    });
    assert.equal(reopened.status().revision, '1');
    assert.deepEqual(readSetupFacts(dataSlotsRoot), {
        lastDecision: 'later',
        entityVersion: '1',
    });
    await reopened.close();
});

test('TEST-DATA-002: concurrent same-command enqueues converge on one stored outcome', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);

    const [first, second] = await Promise.all([
        store.commit(makeCommand()),
        store.commit(makeCommand()),
    ]);

    assert.deepEqual(first, { ok: true, value: COMMITTED_OUTCOME });
    assert.deepEqual(second, first);
    assert.equal(store.status().revision, '1');
    assert.deepEqual(readSetupFacts(dataSlotsRoot), {
        lastDecision: 'later',
        entityVersion: '1',
    });
    await store.close();
});

test('TEST-DATA-002: changed command semantics cannot reuse a persisted CommandId', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    assert.deepEqual(await store.commit(makeCommand()), { ok: true, value: COMMITTED_OUTCOME });

    for (const changedCommand of [
        makeCommand({
            intent: {
                kind: 'workspace.record-setup-decision',
                intentSchemaVersion: 1,
                payload: { decision: 'skip' },
            },
        }),
        makeCommand({ expectedRevision: '1' }),
        makeCommand({ expectedSetupVersion: '1' }),
        makeCommand({ followUpId: '33333333-3333-4333-8333-333333333333' }),
    ]) {
        assert.deepEqual(await store.commit(changedCommand), {
            ok: false,
            problem: {
                code: 'conflict',
                scope: 'operation',
                dataEffect: 'unchanged',
                affectedCapabilities: ['workspace.write'],
                allowedActions: ['requery'],
                context: {
                    revision: '1',
                    entityVersions: [{
                        kind: 'workspace-setup',
                        id: WORKSPACE_ID,
                        version: '1',
                    }],
                },
                details: { reason: 'command-id-reused' },
            },
        });
    }

    assert.equal(store.status().revision, '1');
    assert.deepEqual(readSetupFacts(dataSlotsRoot), {
        lastDecision: 'later',
        entityVersion: '1',
    });
    await store.close();
});

test('TEST-DATA-002: a fresh command cannot write facts for another WorkspaceId', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const crossWorkspaceCommand = makeCommand({
        commandId: SECOND_COMMAND_ID,
        workspaceId: OTHER_WORKSPACE_ID,
        followUpId: SECOND_FOLLOW_UP_ID,
    });

    assert.deepEqual(await store.commit(crossWorkspaceCommand), {
        ok: false,
        problem: {
            code: 'conflict',
            scope: 'operation',
            dataEffect: 'unchanged',
            affectedCapabilities: ['workspace.write'],
            allowedActions: ['requery'],
            context: {
                revision: '0',
                entityVersions: [{
                    kind: 'workspace-setup',
                    id: WORKSPACE_ID,
                    version: '0',
                }],
            },
            details: { reason: 'expected-entity-version' },
        },
    });
    assert.equal(store.status().revision, '0');
    assert.deepEqual(readSetupFacts(dataSlotsRoot), {
        lastDecision: null,
        entityVersion: '0',
    });
    assert.equal(store.receipt(SECOND_COMMAND_ID), null);
    assert.deepEqual(store.readPendingFollowUps(), []);
    assert.equal(store.readProtectionWatermark(), '0');
    await store.close();
});

test('TEST-DATA-001: a post-COMMIT exception terminalizes the store and cancels queued work', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    const secondCommand = makeCommand({
        commandId: SECOND_COMMAND_ID,
        followUpId: SECOND_FOLLOW_UP_ID,
        expectedRevision: '1',
        expectedSetupVersion: '1',
        intent: {
            kind: 'workspace.record-setup-decision',
            intentSchemaVersion: 1,
            payload: { decision: 'skip' },
        },
    });
    const firstCommit = store.commit(makeCommand(), {
        failpoint(point) {
            if (point === 'commit.after-sqlite-commit') {
                throw new Error('Injected response loss');
            }
        },
    });
    const secondCommit = store.commit(secondCommand);

    await assert.rejects(firstCommit, {
        name: 'Error',
        message: 'Workspace data store requires reopen',
    });
    await assert.rejects(secondCommit, {
        name: 'Error',
        message: 'Workspace data store requires reopen',
    });
    await assert.rejects(store.commit(secondCommand), /requires reopen/);
    assert.throws(() => store.status(), /requires reopen/);
    assert.throws(() => store.receipt(COMMAND_ID), /requires reopen/);
    assert.throws(() => store.readPendingFollowUps(), /requires reopen/);
    assert.throws(() => store.readProtectionWatermark(), /requires reopen/);
    await store.close();
    await store.close();

    const reopened = reopenReady(dataSlotsRoot);
    assert.equal(reopened.status().revision, '1');
    assert.deepEqual(readSetupFacts(dataSlotsRoot), {
        lastDecision: 'later',
        entityVersion: '1',
    });
    assert.deepEqual(reopened.receipt(COMMAND_ID), COMMITTED_OUTCOME);
    assert.equal(reopened.receipt(SECOND_COMMAND_ID), null);
    assert.deepEqual(reopened.readPendingFollowUps(), [{
        followUpId: FOLLOW_UP_ID,
        originatingCommandId: COMMAND_ID,
        owner: 'protect',
        kind: 'backup-needed-through',
        prerequisiteRevision: '1',
        state: 'pending',
        version: '0',
    }]);
    assert.equal(reopened.readProtectionWatermark(), '1');
    await reopened.close();
});

test('TEST-DATA-003: stale expected setup version leaves committed setup facts unchanged', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    assert.deepEqual(await store.commit(makeCommand()), { ok: true, value: COMMITTED_OUTCOME });

    const staleVersionCommand = makeCommand({
        commandId: SECOND_COMMAND_ID,
        followUpId: SECOND_FOLLOW_UP_ID,
        expectedRevision: '1',
        expectedSetupVersion: '0',
        intent: {
            kind: 'workspace.record-setup-decision',
            intentSchemaVersion: 1,
            payload: { decision: 'skip' },
        },
    });

    assert.deepEqual(await store.commit(staleVersionCommand), {
        ok: false,
        problem: {
            code: 'conflict',
            scope: 'operation',
            dataEffect: 'unchanged',
            affectedCapabilities: ['workspace.write'],
            allowedActions: ['requery'],
            context: {
                revision: '1',
                entityVersions: [{
                    kind: 'workspace-setup',
                    id: WORKSPACE_ID,
                    version: '1',
                }],
            },
            details: { reason: 'expected-entity-version' },
        },
    });
    assert.equal(store.status().revision, '1');
    assert.deepEqual(readSetupFacts(dataSlotsRoot), {
        lastDecision: 'later',
        entityVersion: '1',
    });
    assert.equal(store.receipt(SECOND_COMMAND_ID), null);
    assert.deepEqual(store.readPendingFollowUps(), [{
        followUpId: FOLLOW_UP_ID,
        originatingCommandId: COMMAND_ID,
        owner: 'protect',
        kind: 'backup-needed-through',
        prerequisiteRevision: '1',
        state: 'pending',
        version: '0',
    }]);
    assert.equal(store.readProtectionWatermark(), '1');
    await store.close();
});

test('TEST-DATA-003: exhausted version counters stop writes until reopen without mutation', async t => {
    const cases = [
        { name: 'workspace revision', revision: SQLITE_INTEGER_MAX, setupVersion: '0' },
        { name: 'setup entity version', revision: '0', setupVersion: SQLITE_INTEGER_MAX },
    ] as const;
    const reopenError = {
        name: 'Error',
        message: 'Workspace data store requires reopen',
    };

    for (const current of cases) {
        await t.test(current.name, async t => {
            const dataSlotsRoot = createTempDataSlots(t);
            await initializeAndClose(dataSlotsRoot);
            setVersionCounters(dataSlotsRoot, current.revision, current.setupVersion);
            const store = reopenReady(dataSlotsRoot);
            const command = makeCommand({
                expectedRevision: current.revision,
                expectedSetupVersion: current.setupVersion,
            });
            const queuedCommand = makeCommand({
                commandId: SECOND_COMMAND_ID,
                followUpId: SECOND_FOLLOW_UP_ID,
                expectedRevision: current.revision,
                expectedSetupVersion: current.setupVersion,
            });

            const settled = await Promise.allSettled([
                store.commit(command),
                store.commit(queuedCommand),
            ]);
            for (const result of settled) {
                assert.equal(result.status, 'rejected');
                if (result.status === 'rejected') {
                    assert.deepEqual({ name: result.reason.name, message: result.reason.message }, reopenError);
                }
            }
            await assert.rejects(store.commit(queuedCommand), reopenError);
            assert.throws(() => store.status(), reopenError);
            assert.throws(() => store.readWorkspaceSetupSnapshot(), reopenError);
            await store.close();

            const reopened = reopenReady(dataSlotsRoot);
            assert.deepEqual(reopened.readWorkspaceSetupSnapshot(), {
                revision: current.revision,
                setup: {
                    workspaceId: WORKSPACE_ID,
                    lastDecision: null,
                    entityVersion: current.setupVersion,
                },
            });
            assert.equal(reopened.receipt(COMMAND_ID), null);
            assert.equal(reopened.receipt(SECOND_COMMAND_ID), null);
            assert.deepEqual(reopened.readPendingFollowUps(), []);
            assert.equal(reopened.readProtectionWatermark(), '0');
            await reopened.close();
        });
    }
});

test('TEST-DATA-003: a queued writer cannot mix revisions into a setup snapshot', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    assert.deepEqual(await store.commit(makeCommand()), { ok: true, value: COMMITTED_OUTCOME });
    const skipCommandAtVersion1 = makeCommand({
        commandId: SECOND_COMMAND_ID,
        followUpId: SECOND_FOLLOW_UP_ID,
        expectedRevision: '1',
        expectedSetupVersion: '1',
        intent: {
            kind: 'workspace.record-setup-decision',
            intentSchemaVersion: 1,
            payload: { decision: 'skip' },
        },
    });
    let queuedCommit: Promise<DataCommitResult> | undefined;

    const snapshot = store.readWorkspaceSetupSnapshot({
        failpoint(point) {
            if (point === 'read.after-revision') {
                queuedCommit = store.commit(skipCommandAtVersion1);
            }
        },
    });

    assert.deepEqual(snapshot, {
        revision: '1',
        setup: {
            workspaceId: WORKSPACE_ID,
            lastDecision: 'later',
            entityVersion: '1',
        },
    });
    assert.equal(Object.getPrototypeOf(snapshot), Object.prototype);
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.setup), true);
    assert.ok(queuedCommit);
    assert.equal((await queuedCommit).ok, true);
    assert.deepEqual(store.readWorkspaceSetupSnapshot(), {
        revision: '2',
        setup: {
            workspaceId: WORKSPACE_ID,
            lastDecision: 'skip',
            entityVersion: '2',
        },
    });
    await store.close();
});
