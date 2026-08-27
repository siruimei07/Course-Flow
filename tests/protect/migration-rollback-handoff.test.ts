/**
 * @file Verifies the bounded MigrationRollbackHandoffV1 physical coordination kernel.
 */

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    armMigrationRollbackHandoff,
    cancelMigrationRollbackHandoff,
    continueMigrationRollbackHandoff,
    createMigrationRollbackHandoff,
    inspectMigrationRollbackBeforeWorkspaceOpen,
    inspectNonterminalMigrationRollback,
    prepareMigrationRollbackHandoff,
    type MigrationRollbackCommand,
    type MigrationRollbackBaseCompletionCallbacks,
    type MigrationRollbackHandoffFacts,
} from '../../src/protect/migration-rollback-handoff';
import {
    RestoreCoordinator,
    RestoreSessionError,
} from '../../src/protect/restore-session';
import {
    observeRestoreDataSlot,
    stageRestoreDataSlot,
} from '../../src/platform/restore-activation-files';
import {canonicalJson} from '../../src/shared/canonical-json';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const SAFETY_COPY_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const OPERATION_ID = '44444444-4444-4444-8444-444444444444';
const CONFIRM_COMMAND_ID = '55555555-5555-4555-8555-555555555555';
const CONTINUE_COMMAND_ID = '66666666-6666-4666-8666-666666666666';
const CANCEL_COMMAND_ID = '77777777-7777-4777-8777-777777777777';
const SECOND_COMMAND_ID = '88888888-8888-4888-8888-888888888888';
const SOURCE_BUILD = 'courseflow-2.0.0+source';
const TARGET_BUILD = 'courseflow-1.0.0+target';

type Fixture = Readonly<{
    root: string;
    activityControlRoot: string;
    dataSlotsRoot: string;
    safetyDatabasePath: string;
    facts: MigrationRollbackHandoffFacts;
}>;

function sha256(bytes: string): string {
    return createHash('sha256').update(bytes, 'utf8').digest('hex');
}

function indexedUuid(namespace: string, index: number): string {
    return `${namespace}-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

function createFixture(t: test.TestContext): Fixture {
    const root = mkdtempSync(path.join(tmpdir(), 'courseflow-migration-rollback-'));
    const activityControlRoot = path.join(root, 'control');
    const dataSlotsRoot = path.join(root, 'data-slots');
    const activeSlot = path.join(dataSlotsRoot, 'active');
    const safetyDatabasePath = path.join(root, 'safety.sqlite');
    mkdirSync(activityControlRoot);
    mkdirSync(dataSlotsRoot);
    mkdirSync(activeSlot);
    writeFileSync(path.join(activeSlot, 'workspace.sqlite'), 'current-migrated-data');
    writeFileSync(safetyDatabasePath, 'migration-safety-data');
    const active = observeRestoreDataSlot(dataSlotsRoot, 'active');
    assert.equal(active.kind, 'present');
    t.after(() => rmSync(root, {recursive: true, force: true}));
    return {
        root,
        activityControlRoot,
        dataSlotsRoot,
        safetyDatabasePath,
        facts: Object.freeze({
            migrationRollbackSessionId: SESSION_ID,
            operationId: OPERATION_ID,
            sourceAppBuildId: SOURCE_BUILD,
            currentAppBuildId: SOURCE_BUILD,
            targetAppBuildId: TARGET_BUILD,
            sourceReleaseVersion: '2.0.0',
            currentReleaseVersion: '2.0.0',
            targetReleaseVersion: '1.0.0',
            previewDigest: sha256('preview'),
            confirmationDigest: sha256('confirmation'),
            safetyCopy: Object.freeze({
                migrationSafetyCopyId: SAFETY_COPY_ID,
                workspaceId: WORKSPACE_ID,
                schemaLevel: '15',
                revision: '7',
                byteLength: Buffer.byteLength('migration-safety-data').toString(),
                digest: sha256('migration-safety-data'),
            }),
            currentData: Object.freeze({
                workspaceId: WORKSPACE_ID,
                schemaLevel: '16',
                revision: '9',
                byteLength: Buffer.byteLength('current-migrated-data').toString(),
                digest: sha256('current-migrated-data'),
                slotFingerprint: active.kind === 'present'
                    ? active.fingerprint.slotFingerprint
                    : '',
            }),
        }),
    };
}

function command(
    action: MigrationRollbackCommand['action'],
    commandId: string,
    expectedSessionVersion: string,
    currentAppBuildId: string,
): MigrationRollbackCommand {
    return Object.freeze({
        action,
        commandId,
        migrationRollbackSessionId: SESSION_ID,
        expectedSessionVersion,
        currentAppBuildId,
    });
}

function stageSafetyCopy(fixture: Fixture) {
    return (input: Readonly<{
        migrationSafetyCopyId: string;
        candidateSlotName: string;
    }>) => {
        assert.equal(input.migrationSafetyCopyId, SAFETY_COPY_ID);
        return stageRestoreDataSlot(
            fixture.safetyDatabasePath,
            fixture.dataSlotsRoot,
            input.candidateSlotName,
        );
    };
}

async function prepareAndArm(fixture: Fixture): Promise<void> {
    createMigrationRollbackHandoff(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
        fixture.facts,
    );
    prepareMigrationRollbackHandoff(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
        SESSION_ID,
        stageSafetyCopy(fixture),
    );
    armMigrationRollbackHandoff(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
        command('confirm', CONFIRM_COMMAND_ID, '2', SOURCE_BUILD),
    );
}

function successfulCallbacks(events: string[]): MigrationRollbackBaseCompletionCallbacks {
    return {
        async reopen(expected): Promise<void> {
            events.push(`reopen:${expected.schemaLevel}:${expected.revision}`);
        },
        async libraryReconcile(): Promise<void> {
            events.push('library');
        },
        async flow00(): Promise<void> {
            events.push('flow00');
        },
    };
}

test('persists a canonical closed handoff without paths or diagnostic payloads', t => {
    const fixture = createFixture(t);
    const status = createMigrationRollbackHandoff(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
        fixture.facts,
    );
    assert.equal(status.phase, 'planned');
    assert.deepEqual(status.allowedActions, ['cancel-as-source']);
    assert.equal(inspectNonterminalMigrationRollback(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
    ).kind, 'nonterminal');

    const journal = path.join(
        fixture.activityControlRoot,
        'migration-rollback',
        OPERATION_ID,
        'journal',
    );
    const recordName = readdirSync(journal).find(name => !name.startsWith('.tmp-'));
    assert.ok(recordName);
    const bytes = readFileSync(path.join(journal, recordName));
    const text = bytes.toString('utf8');
    assert.equal(text, JSON.stringify(JSON.parse(text)));
    assert.equal(text.includes(fixture.root), false);
    for (const forbidden of ['message', 'stack', 'rawError', 'payload', 'path']) {
        assert.equal(text.includes(`\"${forbidden}\"`), false);
    }
    assert.deepEqual(Object.keys(JSON.parse(text) as object).sort(), [
        'after',
        'allowedActorAppBuildIds',
        'before',
        'command',
        'handoff',
        'kind',
        'limitsVersion',
        'phase',
        'previousRecordDigest',
        'receiptDigest',
        'recordDigest',
        'schema',
        'sequence',
    ]);
});

test('operation storage accepts the exact limit and rejects one-over before writing', async t => {
    const fixture = createFixture(t);
    const migrationRoot = path.join(fixture.activityControlRoot, 'migration-rollback');
    const firstSessionId = indexedUuid('30000000', 1);
    const firstOperationId = indexedUuid('40000000', 1);
    const firstCommandId = indexedUuid('70000000', 1);
    const firstFacts = Object.freeze({
        ...fixture.facts,
        migrationRollbackSessionId: firstSessionId,
        operationId: firstOperationId,
    });
    createMigrationRollbackHandoff(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
        firstFacts,
    );
    await cancelMigrationRollbackHandoff(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
        Object.freeze({
            action: 'cancel-as-source' as const,
            commandId: firstCommandId,
            migrationRollbackSessionId: firstSessionId,
            expectedSessionVersion: '1',
            currentAppBuildId: SOURCE_BUILD,
        }),
        successfulCallbacks([]),
    );
    const templateJournal = path.join(migrationRoot, firstOperationId, 'journal');
    const templates = readdirSync(templateJournal).sort().map(name => (
        JSON.parse(readFileSync(path.join(templateJournal, name), 'utf8')) as Record<string, unknown>
    ));
    for (let index = 2; index <= 256; index += 1) {
        const migrationRollbackSessionId = indexedUuid('30000000', index);
        const operationId = indexedUuid('40000000', index);
        const commandId = indexedUuid('70000000', index);
        const journal = path.join(migrationRoot, operationId, 'journal');
        mkdirSync(journal, {recursive: true});
        let previousRecordDigest: string | null = null;
        for (const template of templates) {
            const record = structuredClone(template);
            record.handoff = {
                ...(record.handoff as Record<string, unknown>),
                migrationRollbackSessionId,
                operationId,
            };
            if (record.command) {
                const commandEvidence = record.command as Record<string, unknown>;
                const action = commandEvidence.action as string;
                const expectedSessionVersion = commandEvidence.expectedSessionVersion as string;
                const currentAppBuildId = commandEvidence.currentAppBuildId as string;
                record.command = {
                    ...commandEvidence,
                    commandId,
                    commandDigest: sha256(canonicalJson({
                        action,
                        commandId,
                        migrationRollbackSessionId,
                        expectedSessionVersion,
                        currentAppBuildId,
                    })),
                };
            }
            record.previousRecordDigest = previousRecordDigest;
            if (record.kind === 'cancelled') {
                record.receiptDigest = sha256(canonicalJson({
                    schema: 'courseflow-migration-rollback-receipt-v1',
                    migrationRollbackSessionId,
                    operationId,
                    outcome: 'cancelled',
                    workspaceId: WORKSPACE_ID,
                    revision: fixture.facts.currentData.revision,
                }));
            }
            delete record.recordDigest;
            const recordDigest = sha256(canonicalJson(record));
            record.recordDigest = recordDigest;
            previousRecordDigest = recordDigest;
            writeFileSync(
                path.join(
                    journal,
                    `${String(record.sequence).padStart(6, '0')}-${String(record.kind)}-${recordDigest}`,
                ),
                canonicalJson(record),
            );
        }
    }
    const before = readdirSync(migrationRoot).sort();
    assert.equal(before.length, 256);

    const oneOverSessionId = indexedUuid('30000000', 257);
    const oneOverOperationId = indexedUuid('40000000', 257);
    assert.throws(() => createMigrationRollbackHandoff(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
        Object.freeze({
            ...fixture.facts,
            migrationRollbackSessionId: oneOverSessionId,
            operationId: oneOverOperationId,
        }),
    ), /recovery-required/);
    assert.deepEqual(readdirSync(migrationRoot).sort(), before);
    assert.equal(before.includes(oneOverOperationId), false);
    assert.equal(before.includes(`.tmp-${oneOverOperationId}`), false);
    assert.equal(inspectMigrationRollbackBeforeWorkspaceOpen(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
        SOURCE_BUILD,
    ).kind, 'cancelled');
});

test('restarts exact planned publication without exposing an incomplete operation', async t => {
    for (const failpoint of [
        'handoff.planned.after-temp-write',
        'handoff.operation.before-publish',
    ]) {
        await t.test(failpoint, t => {
            const fixture = createFixture(t);
            assert.throws(() => createMigrationRollbackHandoff(
                fixture.activityControlRoot,
                fixture.dataSlotsRoot,
                fixture.facts,
                {
                    failpoint(point): void {
                        if (point === failpoint) {
                            throw new Error(point);
                        }
                    },
                },
            ), /recovery-required/);
            assert.equal(inspectMigrationRollbackBeforeWorkspaceOpen(
                fixture.activityControlRoot,
                fixture.dataSlotsRoot,
                SOURCE_BUILD,
            ).kind, 'recovery-required');

            const resumed = createMigrationRollbackHandoff(
                fixture.activityControlRoot,
                fixture.dataSlotsRoot,
                fixture.facts,
            );

            assert.equal(resumed.phase, 'planned');
            assert.deepEqual(readdirSync(path.join(
                fixture.activityControlRoot,
                'migration-rollback',
            )), [OPERATION_ID]);
        });
    }
});

test('changed facts cannot claim or poison an interrupted planned publication', t => {
    const fixture = createFixture(t);
    assert.throws(() => createMigrationRollbackHandoff(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
        fixture.facts,
        {
            failpoint(point): void {
                if (point === 'handoff.operation.before-publish') {
                    throw new Error(point);
                }
            },
        },
    ), /recovery-required/);
    assert.throws(() => createMigrationRollbackHandoff(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
        Object.freeze({...fixture.facts, previewDigest: sha256('changed-preview')}),
    ), /recovery-required/);

    const resumed = createMigrationRollbackHandoff(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
        fixture.facts,
    );

    assert.equal(resumed.phase, 'planned');
});

test('accepts a complete current DataSlot fingerprint with closed WAL and SHM members', t => {
    const fixture = createFixture(t);
    writeFileSync(path.join(fixture.dataSlotsRoot, 'active', 'workspace.sqlite-wal'), '');
    writeFileSync(path.join(fixture.dataSlotsRoot, 'active', 'workspace.sqlite-shm'), '');
    const observed = observeRestoreDataSlot(fixture.dataSlotsRoot, 'active');
    assert.equal(observed.kind, 'present');
    assert.equal(observed.kind === 'present' ? observed.fingerprint.members.length : 0, 3);
    const facts: MigrationRollbackHandoffFacts = Object.freeze({
        ...fixture.facts,
        currentData: Object.freeze({
            ...fixture.facts.currentData,
            slotFingerprint: observed.kind === 'present'
                ? observed.fingerprint.slotFingerprint
                : '',
        }),
    });
    const status = createMigrationRollbackHandoff(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
        facts,
    );
    assert.equal(status.phase, 'planned');
});

test('planned and prepared cancellation preserve current migrated DATA', async t => {
    for (const phase of ['planned', 'prepared'] as const) {
        await t.test(phase, async t => {
            const fixture = createFixture(t);
            createMigrationRollbackHandoff(
                fixture.activityControlRoot,
                fixture.dataSlotsRoot,
                fixture.facts,
            );
            if (phase === 'prepared') {
                prepareMigrationRollbackHandoff(
                    fixture.activityControlRoot,
                    fixture.dataSlotsRoot,
                    SESSION_ID,
                    stageSafetyCopy(fixture),
                );
            }
            const result = await cancelMigrationRollbackHandoff(
                fixture.activityControlRoot,
                fixture.dataSlotsRoot,
                command('cancel-as-source', CANCEL_COMMAND_ID, phase === 'planned' ? '1' : '2', SOURCE_BUILD),
                successfulCallbacks([]),
            );
            assert.equal(result.phase, 'cancelled');
            assert.equal(
                readFileSync(path.join(fixture.dataSlotsRoot, 'active', 'workspace.sqlite'), 'utf8'),
                'current-migrated-data',
            );
        });
    }
});

test('classifies exact source, target, and other builds with closed allowed actions', async t => {
    const fixture = createFixture(t);
    await prepareAndArm(fixture);
    const source = inspectMigrationRollbackBeforeWorkspaceOpen(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
        SOURCE_BUILD,
    );
    const target = inspectMigrationRollbackBeforeWorkspaceOpen(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
        TARGET_BUILD,
    );
    const other = inspectMigrationRollbackBeforeWorkspaceOpen(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
        'courseflow-unknown',
    );
    assert.equal(source.currentBuild, 'source');
    assert.deepEqual(source.allowedActions, ['cancel-as-source']);
    assert.equal(target.currentBuild, 'target');
    assert.deepEqual(target.allowedActions, ['continue-as-target']);
    assert.equal(other.currentBuild, 'other');
    assert.deepEqual(other.allowedActions, []);
    assert.equal('dataSlotsRoot' in source, false);
    assert.equal(JSON.stringify(source).includes(fixture.root), false);
});

test('target continuation becomes terminal only after reopen, Library reconcile, and FLOW-00', async t => {
    const fixture = createFixture(t);
    await prepareAndArm(fixture);
    const events: string[] = [];
    await assert.rejects(
        continueMigrationRollbackHandoff(
            fixture.activityControlRoot,
            fixture.dataSlotsRoot,
            command('continue-as-target', CONTINUE_COMMAND_ID, '4', TARGET_BUILD),
            {
                async reopen(): Promise<void> {
                    events.push('reopen');
                },
                async libraryReconcile(): Promise<void> {
                    events.push('library');
                },
                async flow00(): Promise<void> {
                    events.push('flow00');
                },
                async consumeSafetyCopy(input): Promise<void> {
                    events.push(`consume:${input.migrationSafetyCopyId}:${input.operationId}`);
                    throw new Error('private consume failure');
                },
            },
        ),
        /completion-pending/,
    );
    assert.deepEqual(events, [
        'reopen',
        'library',
        'flow00',
        `consume:${SAFETY_COPY_ID}:${OPERATION_ID}`,
    ]);
    assert.notEqual(inspectMigrationRollbackBeforeWorkspaceOpen(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
        TARGET_BUILD,
    ).phase, 'succeeded');

    events.length = 0;
    const succeeded = await continueMigrationRollbackHandoff(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
        command('continue-as-target', CONTINUE_COMMAND_ID, '4', TARGET_BUILD),
        {
            ...successfulCallbacks(events),
            async consumeSafetyCopy(input): Promise<void> {
                events.push(`consume:${input.migrationSafetyCopyId}:${input.operationId}`);
            },
        },
    );
    assert.deepEqual(events, [
        'reopen:15:7',
        'library',
        'flow00',
        `consume:${SAFETY_COPY_ID}:${OPERATION_ID}`,
    ]);
    assert.equal(succeeded.phase, 'succeeded');
    assert.deepEqual(succeeded.allowedActions, []);
    assert.equal(
        readFileSync(path.join(fixture.dataSlotsRoot, 'active', 'workspace.sqlite'), 'utf8'),
        'migration-safety-data',
    );

    await assert.rejects(
        continueMigrationRollbackHandoff(
            fixture.activityControlRoot,
            fixture.dataSlotsRoot,
            command('continue-as-target', CONTINUE_COMMAND_ID, '4', SOURCE_BUILD),
            {
                ...successfulCallbacks([]),
                async consumeSafetyCopy(): Promise<void> {
                    return;
                },
            },
        ),
        /command-conflict/,
    );
});

test('source cancellation restores retained migrated DATA after response loss', async t => {
    const fixture = createFixture(t);
    createMigrationRollbackHandoff(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
        fixture.facts,
    );
    prepareMigrationRollbackHandoff(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
        SESSION_ID,
        stageSafetyCopy(fixture),
    );
    assert.throws(() => armMigrationRollbackHandoff(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
        command('confirm', CONFIRM_COMMAND_ID, '2', SOURCE_BUILD),
        {
            failpoint(point): void {
                if (point === 'physical.after-install-safety-action') {
                    throw new Error('lost response');
                }
            },
        },
    ), /activation-pending/);
    const recovered = inspectMigrationRollbackBeforeWorkspaceOpen(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
        SOURCE_BUILD,
    );
    assert.deepEqual(recovered.allowedActions, ['cancel-as-source']);

    const events: string[] = [];
    const cancelled = await cancelMigrationRollbackHandoff(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
        command('cancel-as-source', CANCEL_COMMAND_ID, '4', SOURCE_BUILD),
        successfulCallbacks(events),
    );
    assert.deepEqual(events, ['reopen:16:9', 'library', 'flow00']);
    assert.equal(cancelled.phase, 'cancelled');
    assert.equal(
        readFileSync(path.join(fixture.dataSlotsRoot, 'active', 'workspace.sqlite'), 'utf8'),
        'current-migrated-data',
    );
});

test('terminal receipt survives ordinary active DATA evolution on later boots', async t => {
    await t.test('succeeded', async t => {
        const fixture = createFixture(t);
        await prepareAndArm(fixture);
        await continueMigrationRollbackHandoff(
            fixture.activityControlRoot,
            fixture.dataSlotsRoot,
            command('continue-as-target', CONTINUE_COMMAND_ID, '4', TARGET_BUILD),
            {
                ...successfulCallbacks([]),
                async consumeSafetyCopy(): Promise<void> {
                    return;
                },
            },
        );
        writeFileSync(
            path.join(fixture.dataSlotsRoot, 'active', 'workspace.sqlite'),
            'post-rollback-target-write',
        );

        const boot = inspectMigrationRollbackBeforeWorkspaceOpen(
            fixture.activityControlRoot,
            fixture.dataSlotsRoot,
            TARGET_BUILD,
        );

        assert.equal(boot.kind, 'succeeded');
        assert.equal(boot.outcome, 'succeeded');
    });

    await t.test('cancelled', async t => {
        const fixture = createFixture(t);
        await prepareAndArm(fixture);
        await cancelMigrationRollbackHandoff(
            fixture.activityControlRoot,
            fixture.dataSlotsRoot,
            command('cancel-as-source', CANCEL_COMMAND_ID, '4', SOURCE_BUILD),
            successfulCallbacks([]),
        );
        writeFileSync(
            path.join(fixture.dataSlotsRoot, 'active', 'workspace.sqlite'),
            'post-cancel-source-write',
        );

        const boot = inspectMigrationRollbackBeforeWorkspaceOpen(
            fixture.activityControlRoot,
            fixture.dataSlotsRoot,
            SOURCE_BUILD,
        );

        assert.equal(boot.kind, 'cancelled');
        assert.equal(boot.outcome, 'cancelled');
    });
});

test('preparation observes a staged safety slot before retrying a lost response', t => {
    const fixture = createFixture(t);
    createMigrationRollbackHandoff(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
        fixture.facts,
    );
    assert.throws(() => prepareMigrationRollbackHandoff(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
        SESSION_ID,
        stageSafetyCopy(fixture),
        {
            failpoint(point): void {
                if (point === 'physical.after-stage-safety') {
                    throw new Error('lost stage response');
                }
            },
        },
    ), /activation-pending/);
    const prepared = prepareMigrationRollbackHandoff(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
        SESSION_ID,
        stageSafetyCopy(fixture),
    );
    assert.equal(prepared.phase, 'prepared');
});

test('refuses a new handoff when Restore control evidence is not clear or committed', t => {
    const fixture = createFixture(t);
    mkdirSync(path.join(fixture.activityControlRoot, 'restore'));
    mkdirSync(path.join(fixture.activityControlRoot, 'restore', 'not-an-operation'));
    assert.throws(() => createMigrationRollbackHandoff(
        fixture.activityControlRoot,
        fixture.dataSlotsRoot,
        fixture.facts,
    ), /recovery-required/);
});

test('Restore start preserves the global mutex with MigrationRollback evidence', async t => {
    await t.test('nonterminal handoff conflicts before Restore opens DATA', async t => {
        const fixture = createFixture(t);
        createMigrationRollbackHandoff(
            fixture.activityControlRoot,
            fixture.dataSlotsRoot,
            fixture.facts,
        );
        const coordinator = new RestoreCoordinator(null, fixture.activityControlRoot, {
            dataSlotsRoot: fixture.dataSlotsRoot,
        });
        await assert.rejects(
            coordinator.start({
                commandId: SECOND_COMMAND_ID,
                candidateRef: SAFETY_COPY_ID,
            }),
            error => error instanceof RestoreSessionError && error.code === 'conflict',
        );
    });

    await t.test('corrupt handoff fails closed before Restore opens DATA', async t => {
        const fixture = createFixture(t);
        createMigrationRollbackHandoff(
            fixture.activityControlRoot,
            fixture.dataSlotsRoot,
            fixture.facts,
        );
        const journal = path.join(
            fixture.activityControlRoot,
            'migration-rollback',
            OPERATION_ID,
            'journal',
        );
        const recordName = readdirSync(journal).find(name => !name.startsWith('.tmp-'))!;
        const recordPath = path.join(journal, recordName);
        const record = JSON.parse(readFileSync(recordPath, 'utf8')) as Record<string, unknown>;
        record.extra = true;
        writeFileSync(recordPath, JSON.stringify(record));
        const coordinator = new RestoreCoordinator(null, fixture.activityControlRoot, {
            dataSlotsRoot: fixture.dataSlotsRoot,
        });
        await assert.rejects(
            coordinator.start({
                commandId: SECOND_COMMAND_ID,
                candidateRef: SAFETY_COPY_ID,
            }),
            error => error instanceof RestoreSessionError
                && error.code === 'current-data-unavailable',
        );
    });
});

test('durable continue or cancel command locks recovery to its exact actor after response loss', async t => {
    for (const action of ['continue-as-target', 'cancel-as-source'] as const) {
        await t.test(action, async t => {
            const fixture = createFixture(t);
            await prepareAndArm(fixture);
            const isContinue = action === 'continue-as-target';
            const operation = isContinue
                ? continueMigrationRollbackHandoff(
                    fixture.activityControlRoot,
                    fixture.dataSlotsRoot,
                    command(action, SECOND_COMMAND_ID, '4', TARGET_BUILD),
                    {
                        ...successfulCallbacks([]),
                        async consumeSafetyCopy(): Promise<void> {
                            return;
                        },
                    },
                    {
                        failpoint(point): void {
                            if (point === 'handoff.command-continue.after-publish') {
                                throw new Error('lost command response');
                            }
                        },
                    },
                )
                : cancelMigrationRollbackHandoff(
                    fixture.activityControlRoot,
                    fixture.dataSlotsRoot,
                    command(action, SECOND_COMMAND_ID, '4', SOURCE_BUILD),
                    successfulCallbacks([]),
                    {
                        failpoint(point): void {
                            if (point === 'handoff.command-cancel.after-publish') {
                                throw new Error('lost command response');
                            }
                        },
                    },
                );
            await assert.rejects(operation, /completion-pending/);
            const source = inspectMigrationRollbackBeforeWorkspaceOpen(
                fixture.activityControlRoot,
                fixture.dataSlotsRoot,
                SOURCE_BUILD,
            );
            const target = inspectMigrationRollbackBeforeWorkspaceOpen(
                fixture.activityControlRoot,
                fixture.dataSlotsRoot,
                TARGET_BUILD,
            );
            assert.equal(source.phase, isContinue ? 'completing' : 'cancelling');
            assert.equal(target.phase, isContinue ? 'completing' : 'cancelling');
            assert.deepEqual(source.allowedActions, isContinue ? [] : ['cancel-as-source']);
            assert.deepEqual(target.allowedActions, isContinue ? ['continue-as-target'] : []);
            assert.deepEqual(source.retryCommand, {
                action,
                commandId: SECOND_COMMAND_ID,
                expectedSessionVersion: '4',
            });
            assert.deepEqual(target.retryCommand, source.retryCommand);

            const opposite = isContinue
                ? cancelMigrationRollbackHandoff(
                    fixture.activityControlRoot,
                    fixture.dataSlotsRoot,
                    command('cancel-as-source', CANCEL_COMMAND_ID, '5', SOURCE_BUILD),
                    successfulCallbacks([]),
                )
                : continueMigrationRollbackHandoff(
                    fixture.activityControlRoot,
                    fixture.dataSlotsRoot,
                    command('continue-as-target', CONTINUE_COMMAND_ID, '5', TARGET_BUILD),
                    {
                        ...successfulCallbacks([]),
                        async consumeSafetyCopy(): Promise<void> {
                            return;
                        },
                    },
                );
            await assert.rejects(opposite, /command-conflict/);
            assert.equal(inspectMigrationRollbackBeforeWorkspaceOpen(
                fixture.activityControlRoot,
                fixture.dataSlotsRoot,
                isContinue ? TARGET_BUILD : SOURCE_BUILD,
            ).phase, isContinue ? 'completing' : 'cancelling');

            const retried = isContinue
                ? await continueMigrationRollbackHandoff(
                    fixture.activityControlRoot,
                    fixture.dataSlotsRoot,
                    command(action, SECOND_COMMAND_ID, '4', TARGET_BUILD),
                    {
                        ...successfulCallbacks([]),
                        async consumeSafetyCopy(): Promise<void> {
                            return;
                        },
                    },
                )
                : await cancelMigrationRollbackHandoff(
                    fixture.activityControlRoot,
                    fixture.dataSlotsRoot,
                    command(action, SECOND_COMMAND_ID, '4', SOURCE_BUILD),
                    successfulCallbacks([]),
                );
            assert.equal(retried.kind, isContinue ? 'succeeded' : 'cancelled');
        });
    }
});

test('durable completion commands never mask changed physical evidence', async t => {
    for (const action of ['continue-as-target', 'cancel-as-source'] as const) {
        await t.test(action, async t => {
            const fixture = createFixture(t);
            await prepareAndArm(fixture);
            const operation = action === 'continue-as-target'
                ? continueMigrationRollbackHandoff(
                    fixture.activityControlRoot,
                    fixture.dataSlotsRoot,
                    command(action, SECOND_COMMAND_ID, '4', TARGET_BUILD),
                    {
                        ...successfulCallbacks([]),
                        async consumeSafetyCopy(): Promise<void> {
                            return;
                        },
                    },
                    {
                        failpoint(point): void {
                            if (point === 'handoff.command-continue.after-publish') {
                                throw new Error(point);
                            }
                        },
                    },
                )
                : cancelMigrationRollbackHandoff(
                    fixture.activityControlRoot,
                    fixture.dataSlotsRoot,
                    command(action, SECOND_COMMAND_ID, '4', SOURCE_BUILD),
                    successfulCallbacks([]),
                    {
                        failpoint(point): void {
                            if (point === 'handoff.command-cancel.after-publish') {
                                throw new Error(point);
                            }
                        },
                    },
                );
            await assert.rejects(operation, /completion-pending/);
            writeFileSync(path.join(fixture.dataSlotsRoot, 'active', 'workspace.sqlite'), 'changed');

            const boot = inspectMigrationRollbackBeforeWorkspaceOpen(
                fixture.activityControlRoot,
                fixture.dataSlotsRoot,
                action === 'continue-as-target' ? TARGET_BUILD : SOURCE_BUILD,
            );

            assert.equal(boot.kind, 'recovery-required');
            assert.deepEqual(boot.allowedActions, []);
        });
    }
});

test('unknown control fields, changed slot bytes, and reused CommandId fail closed', async t => {
    await t.test('unknown field', t => {
        const fixture = createFixture(t);
        createMigrationRollbackHandoff(
            fixture.activityControlRoot,
            fixture.dataSlotsRoot,
            fixture.facts,
        );
        const journal = path.join(
            fixture.activityControlRoot,
            'migration-rollback',
            OPERATION_ID,
            'journal',
        );
        const recordName = readdirSync(journal).find(name => !name.startsWith('.tmp-'))!;
        const recordPath = path.join(journal, recordName);
        const record = JSON.parse(readFileSync(recordPath, 'utf8')) as Record<string, unknown>;
        record.extra = true;
        writeFileSync(recordPath, JSON.stringify(record));
        assert.equal(inspectMigrationRollbackBeforeWorkspaceOpen(
            fixture.activityControlRoot,
            fixture.dataSlotsRoot,
            SOURCE_BUILD,
        ).kind, 'recovery-required');
    });

    await t.test('changed active bytes', t => {
        const fixture = createFixture(t);
        createMigrationRollbackHandoff(
            fixture.activityControlRoot,
            fixture.dataSlotsRoot,
            fixture.facts,
        );
        writeFileSync(path.join(fixture.dataSlotsRoot, 'active', 'workspace.sqlite'), 'changed');
        assert.equal(inspectMigrationRollbackBeforeWorkspaceOpen(
            fixture.activityControlRoot,
            fixture.dataSlotsRoot,
            SOURCE_BUILD,
        ).kind, 'recovery-required');
    });

    await t.test('command id conflict', async t => {
        const fixture = createFixture(t);
        await prepareAndArm(fixture);
        await cancelMigrationRollbackHandoff(
            fixture.activityControlRoot,
            fixture.dataSlotsRoot,
            command('cancel-as-source', SECOND_COMMAND_ID, '4', SOURCE_BUILD),
            successfulCallbacks([]),
        );
        await assert.rejects(
            cancelMigrationRollbackHandoff(
                fixture.activityControlRoot,
                fixture.dataSlotsRoot,
                command('cancel-as-source', SECOND_COMMAND_ID, '4', TARGET_BUILD),
                successfulCallbacks([]),
            ),
            /command-conflict/,
        );
    });
});
