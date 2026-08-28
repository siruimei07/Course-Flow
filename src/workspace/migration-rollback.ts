/**
 * Returns the only registered migration safety copy without exposing a path.
 * @param {string} requestId Request correlation identity.
 * @return {WorkspaceSetupOutcome} Current MigrationSafetyCopy projection.
 */
import { randomUUID } from 'node:crypto';
import { consumeMigrationSafetyCopyAfterRollback, deleteMigrationSafetyCopy as deleteMigrationSafetyCopyArtifact, inspectMigrationSafetyCopy, stageMigrationSafetyCopyForRollback } from '../data/sqlite-data-store';
import { workspaceDataRuntimeVersion } from '../data/store/database';
import { openWorkspaceDataWithMigrations } from '../data/store/open';
import { observeRestoreDataSlot } from '../platform/restore-activation-files';
import { MigrationRollbackHandoffError, armMigrationRollbackHandoff, cancelMigrationRollbackHandoff, continueMigrationRollbackHandoff, createMigrationRollbackHandoff, inspectMigrationRollbackBeforeWorkspaceOpen, inspectMigrationRollbackHandoffFacts, prepareMigrationRollbackHandoff } from '../protect/migration-rollback-handoff';
import type { MigrationRollbackDataIdentity } from '../protect/migration-rollback-handoff';
import { bindMigrationRollbackConfirmation, createMigrationRollbackPreview, migrationRollbackConfirmationDigest } from '../protect/migration-rollback-session';
import type { MigrationRollbackPreviewFacts } from '../protect/migration-rollback-session';
import type { ConfirmMigrationRollbackCommand, DeleteMigrationSafetyCopyCommand, MigrationRollbackActionCommand, MigrationSafetyCopyProjection } from '../shared/workspace-migration-contract';
import { WorkspaceSetupOutcome } from '../shared/workspace-setup-contract';
import { dataStateFrom, migrationOpenOptions } from './host';
import type { WorkspaceHost } from './host';
import { reconcileWorkspaceLifecycle } from './lifecycle-routing';
import { currentMigrationRollbackBoot, migrationOperationsAreClear, migrationViewFrom, tryRestoreMigrationRollbackBinding } from './migration-boot';
import { migrationSafetyOutcome, migrationSessionOutcome, problem } from './outcomes';
import { migrationRollbackEvidenceProblem, migrationRollbackRecoveryView, migrationSafetyCopyProjection, sourceBuildProjection } from './projections';
import { startDurableBackup } from './protection';
export function queryMigrationSafetyCopy(host: WorkspaceHost, requestId: string): WorkspaceSetupOutcome {
    return migrationSafetyOutcome(host,
        requestId,
        migrationSafetyCopyProjection(inspectMigrationSafetyCopy(host.dataSlotsRoot)),
    );
}

/**
 * Explicitly deletes one freshly matched migration safety copy.
 * @param {string} requestId Request correlation identity.
 * @param {DeleteMigrationSafetyCopyCommand} command Exact observed copy identity.
 * @return {WorkspaceSetupOutcome} Absent projection after logical deletion commits.
 */
export function deleteMigrationSafetyCopy(host: WorkspaceHost, 
    requestId: string,
    command: DeleteMigrationSafetyCopyCommand,
): WorkspaceSetupOutcome {
    if (host.migrationRequestInFlight()) {
        return problem(host,
            'operation-in-progress',
            '另一个迁移维护操作正在完成。',
            requestId,
        );
    }
    host.setMigrationRequestInFlight(true);
    try {
        if (host.options.readOnly || host.dataState().status.kind === 'read-only') {
            return problem(host, 'permission', '迁移安全副本未删除。', requestId);
        }
        if (host.preparedMigrationRollback() || !migrationOperationsAreClear(host)) {
            return problem(host,
                'operation-in-progress',
                '恢复或迁移回退正在进行，迁移安全副本未删除。',
                requestId,
            );
        }
        deleteMigrationSafetyCopyArtifact(
            host.dataSlotsRoot,
            command.migrationSafetyCopyId,
            command.expectedCopyVersion,
            command.confirmationToken,
        );
        return migrationSafetyOutcome(host,
            requestId,
            migrationSafetyCopyProjection(inspectMigrationSafetyCopy(host.dataSlotsRoot)),
        );
    }
    catch (error) {
        const code = error instanceof TypeError ? 'validation' : 'conflict';
        return problem(host, code, '迁移安全副本未删除。', requestId);
    }
    finally {
        host.setMigrationRequestInFlight(false);
    }
}

/**
 * Creates a fresh rollback preview bound to closed DATA and the current build.
 * @param {string} requestId Request correlation identity.
 * @return {Promise<WorkspaceSetupOutcome>} Preview session or unchanged problem.
 */
export async function previewMigrationRollback(host: WorkspaceHost, requestId: string): Promise<WorkspaceSetupOutcome> {
    if (host.migrationRequestInFlight()) {
        return problem(host,
            'operation-in-progress',
            '另一个迁移维护操作正在完成。',
            requestId,
        );
    }
    host.setMigrationRequestInFlight(true);
    try {
        if (host.options.readOnly || host.dataState().status.kind !== 'ready') {
            return problem(host, 'permission', '当前工作区不能预览迁移回退。', requestId);
        }
        if (!host.options.activityControlRoot || !migrationOperationsAreClear(host)) {
            return problem(host,
                'operation-in-progress',
                '恢复或迁移回退正在进行。',
                requestId,
            );
        }
        const facts = await captureMigrationRollbackPreviewFacts(host, true);
        const prepared = createMigrationRollbackPreview(facts, Object.freeze({
            migrationRollbackSessionId: randomUUID(),
            operationId: randomUUID(),
        }));
        host.setPreparedMigrationRollback(prepared);
        host.setMigrationRollbackBinding(prepared.view.binding);
        return migrationSessionOutcome(host, requestId, prepared.view);
    }
    catch {
        return problem(host,
            'recovery-required',
            '无法形成一致的迁移回退预览。',
            requestId,
        );
    }
    finally {
        host.setMigrationRequestInFlight(false);
    }
}

/**
 * Queries the current preview, durable maintenance, or recovery session.
 * @param {string} requestId Request correlation identity.
 * @param {string | null} migrationRollbackSessionId Exact session or current session.
 * @return {WorkspaceSetupOutcome} Current rollback session projection.
 */
export function queryMigrationRollback(host: WorkspaceHost, 
    requestId: string,
    migrationRollbackSessionId: string | null,
): WorkspaceSetupOutcome {
    const preview = host.preparedMigrationRollback()?.view;
    if (preview
        && (migrationRollbackSessionId === null
            || preview.migrationRollbackSessionId === migrationRollbackSessionId)) {
        return migrationSessionOutcome(host, requestId, preview);
    }
    const boot = currentMigrationRollbackBoot(host);
    if (boot.kind === 'clear') {
        return problem(host, 'validation', '当前没有迁移回退会话。', requestId);
    }
    if (boot.kind === 'recovery-required') {
        return migrationSessionOutcome(host, requestId, migrationRollbackRecoveryView());
    }
    if (migrationRollbackSessionId !== null
        && boot.migrationRollbackSessionId !== migrationRollbackSessionId) {
        return problem(host, 'validation', '迁移回退会话身份不匹配。', requestId);
    }
    return migrationSessionOutcome(host, requestId, migrationViewFrom(host, boot));
}

/**
 * Converts a preview confirmation into the durable R6-03 handoff.
 * @param {string} requestId Request correlation identity.
 * @param {ConfirmMigrationRollbackCommand} command Preview-bound confirmation.
 * @return {Promise<WorkspaceSetupOutcome>} Maintenance status after durable progress.
 */
export async function confirmMigrationRollback(host: WorkspaceHost, 
    requestId: string,
    command: ConfirmMigrationRollbackCommand,
): Promise<WorkspaceSetupOutcome> {
    if (host.migrationRequestInFlight()) {
        return problem(host,
            'operation-in-progress',
            '另一个迁移维护操作正在完成。',
            requestId,
        );
    }
    host.setMigrationRequestInFlight(true);
    let refreshedFacts: MigrationRollbackPreviewFacts | null = null;
    try {
        const activityControlRoot = host.options.activityControlRoot;
        if (!activityControlRoot) {
            return problem(host, 'validation', '当前构建没有迁移回退控制根。', requestId);
        }
        let handoffFacts;
        const prepared = host.preparedMigrationRollback();
        if (prepared) {
            host.setMigrationMaintenance(true);
            refreshedFacts = await captureMigrationRollbackPreviewFacts(host, false);
            try {
                handoffFacts = bindMigrationRollbackConfirmation(
                    prepared,
                    command,
                    refreshedFacts,
                );
            }
            catch {
                host.setMigrationMaintenance(false);
                await reopenMigrationData(host, refreshedFacts.currentData);
                startDurableBackup(host);
                host.setPreparedMigrationRollback(null);
                host.setMigrationRollbackBinding(null);
                return problem(host,
                    'conflict',
                    '迁移回退影响已变化，请重新预览。',
                    requestId,
                );
            }
            host.setMigrationRollbackBinding(prepared.view.binding);
            createMigrationRollbackHandoff(
                activityControlRoot,
                host.dataSlotsRoot,
                handoffFacts,
            );
        }
        else {
            handoffFacts = inspectMigrationRollbackHandoffFacts(
                activityControlRoot,
                host.dataSlotsRoot,
                command.migrationRollbackSessionId,
            );
            if (handoffFacts.previewDigest !== command.previewToken
                || handoffFacts.confirmationDigest
                    !== migrationRollbackConfirmationDigest(command)) {
                return problem(host, 'conflict', '迁移回退确认与原预览不匹配。', requestId);
            }
            host.setMigrationMaintenance(true);
            tryRestoreMigrationRollbackBinding(host, currentMigrationRollbackBoot(host));
        }
        let status = inspectMigrationRollbackBeforeWorkspaceOpen(
            activityControlRoot,
            host.dataSlotsRoot,
            host.appBuildId,
        );
        if (status.kind === 'maintenance' && status.phase === 'planned') {
            status = prepareMigrationRollbackHandoff(
                activityControlRoot,
                host.dataSlotsRoot,
                command.migrationRollbackSessionId,
                input => stageMigrationSafetyCopyForRollback(
                    host.dataSlotsRoot,
                    input.migrationSafetyCopyId,
                    input.candidateSlotName,
                ),
            );
        }
        if (status.kind === 'maintenance'
            && (status.phase === 'prepared'
                || status.phase === 'armed'
                || status.phase === 'awaiting-target-build')) {
            status = armMigrationRollbackHandoff(
                activityControlRoot,
                host.dataSlotsRoot,
                Object.freeze({
                    action: 'confirm' as const,
                    commandId: command.commandId,
                    migrationRollbackSessionId: command.migrationRollbackSessionId,
                    expectedSessionVersion: '2',
                    currentAppBuildId: host.appBuildId,
                }),
            );
        }
        host.setPreparedMigrationRollback(null);
        host.setMigrationRollbackBoot(status);
        const outcome = migrationSessionOutcome(host,
            requestId,
            migrationViewFrom(host, status),
        );
        host.setWorkspaceEpoch(randomUUID());
        return outcome;
    }
    catch (error) {
        if (error instanceof MigrationRollbackHandoffError
            && error.code === 'build-mismatch') {
            return problem(host,
                'build-mismatch',
                '当前应用构建不能执行这项迁移回退动作。',
                requestId,
            );
        }
        if (error instanceof MigrationRollbackHandoffError
            && error.code === 'command-conflict') {
            return problem(host,
                'conflict',
                '迁移回退命令身份已被不同动作使用。',
                requestId,
            );
        }
        const activityControlRoot = host.options.activityControlRoot;
        if (activityControlRoot) {
            const boot = inspectMigrationRollbackBeforeWorkspaceOpen(
                activityControlRoot,
                host.dataSlotsRoot,
                host.appBuildId,
            );
            host.setMigrationRollbackBoot(boot);
            if (boot.kind === 'maintenance') {
                host.setMigrationMaintenance(true);
                host.setPreparedMigrationRollback(null);
                tryRestoreMigrationRollbackBinding(host, boot);
                const outcome = migrationSessionOutcome(host,
                    requestId,
                    migrationViewFrom(host, boot),
                );
                host.setWorkspaceEpoch(randomUUID());
                return outcome;
            }
            if (boot.kind === 'clear') {
                if (refreshedFacts && !host.dataState().store) {
                    await reopenMigrationData(host, refreshedFacts.currentData);
                }
                if (host.dataState().store) {
                    host.setMigrationMaintenance(false);
                    host.setPreparedMigrationRollback(null);
                    host.setMigrationRollbackBinding(null);
                    startDurableBackup(host);
                    return problem(host,
                        'conflict',
                        '迁移回退影响已变化，请重新预览。',
                        requestId,
                    );
                }
            }
        }
        if (refreshedFacts && !host.dataState().store) {
            try {
                await reopenMigrationData(host, refreshedFacts.currentData);
                host.setMigrationMaintenance(false);
                startDurableBackup(host);
            }
            catch {
                host.setMigrationMaintenance(true);
            }
        }
        const code = error instanceof MigrationRollbackHandoffError
            && error.code === 'build-mismatch'
            ? 'build-mismatch'
            : 'recovery-required';
        return problem(host, code, '迁移回退确认未能安全完成。', requestId);
    }
    finally {
        host.setMigrationRequestInFlight(false);
    }
}

/**
 * Cancels as the exact source build and restores the retained migrated DATA.
 * @param {string} requestId Request correlation identity.
 * @param {MigrationRollbackActionCommand} command Exact session action.
 * @return {Promise<WorkspaceSetupOutcome>} Terminal or retryable maintenance state.
 */
export async function cancelMigrationRollback(host: WorkspaceHost, 
    requestId: string,
    command: MigrationRollbackActionCommand,
): Promise<WorkspaceSetupOutcome> {
    return completeMigrationRollback(host, requestId, command, 'cancel-as-source');
}

/**
 * Continues as the exact rollback target and consumes the installed safety copy.
 * @param {string} requestId Request correlation identity.
 * @param {MigrationRollbackActionCommand} command Exact session action.
 * @return {Promise<WorkspaceSetupOutcome>} Terminal or retryable maintenance state.
 */
export async function continueMigrationRollback(host: WorkspaceHost, 
    requestId: string,
    command: MigrationRollbackActionCommand,
): Promise<WorkspaceSetupOutcome> {
    return completeMigrationRollback(host, requestId, command, 'continue-as-target');
}

/**
 * Runs one exact-build terminal branch through reopen, Library, and FLOW-00 gates.
 * @param {string} requestId Request correlation identity.
 * @param {MigrationRollbackActionCommand} command Exact action command.
 * @param {'cancel-as-source' | 'continue-as-target'} action Exact build branch.
 * @return {Promise<WorkspaceSetupOutcome>} Terminal or pending state.
 */
export async function completeMigrationRollback(host: WorkspaceHost, 
    requestId: string,
    command: MigrationRollbackActionCommand,
    action: 'cancel-as-source' | 'continue-as-target',
): Promise<WorkspaceSetupOutcome> {
    if (host.migrationRequestInFlight()) {
        return problem(host,
            'operation-in-progress',
            '另一个迁移维护操作正在完成。',
            requestId,
        );
    }
    host.setMigrationRequestInFlight(true);
    try {
        const activityControlRoot = host.options.activityControlRoot;
        if (!activityControlRoot) {
            return problem(host, 'validation', '当前构建没有迁移回退控制根。', requestId);
        }
        const kernelCommand = Object.freeze({
            action,
            commandId: command.commandId,
            migrationRollbackSessionId: command.migrationRollbackSessionId,
            expectedSessionVersion: command.expectedSessionVersion,
            currentAppBuildId: host.appBuildId,
        });
        const callbacks = Object.freeze({
            reopen: (expected: MigrationRollbackDataIdentity) => (
                reopenMigrationData(host, expected)
            ),
            libraryReconcile: async () => {
                // MOD-LIBRARY is absent in R6; the explicit empty binding is already reconciled.
            },
            flow00: () => runMigrationRollbackFlow00(host),
        });
        const status = action === 'cancel-as-source'
            ? await cancelMigrationRollbackHandoff(
                activityControlRoot,
                host.dataSlotsRoot,
                kernelCommand,
                callbacks,
            )
            : await continueMigrationRollbackHandoff(
                activityControlRoot,
                host.dataSlotsRoot,
                kernelCommand,
                Object.freeze({
                    ...callbacks,
                    consumeSafetyCopy: async input => {
                        consumeMigrationSafetyCopyAfterRollback(
                            host.dataSlotsRoot,
                            input.migrationSafetyCopyId,
                            input.operationId,
                        );
                    },
                }),
            );
        host.setMigrationRollbackBoot(status);
        const outcome = migrationSessionOutcome(host,
            requestId,
            migrationViewFrom(host, status),
        );
        if (status.kind === 'succeeded' || status.kind === 'cancelled') {
            host.setMigrationMaintenance(false);
            host.setPreparedMigrationRollback(null);
            startDurableBackup(host);
            host.setWorkspaceEpoch(randomUUID());
        }
        return outcome;
    }
    catch (error) {
        if (error instanceof MigrationRollbackHandoffError
            && error.code === 'build-mismatch') {
            return problem(host,
                'build-mismatch',
                '当前应用构建不能执行这项迁移回退动作。',
                requestId,
            );
        }
        if (error instanceof MigrationRollbackHandoffError
            && error.code === 'command-conflict') {
            return problem(host,
                'conflict',
                '迁移回退命令身份已被不同动作使用。',
                requestId,
            );
        }
        const activityControlRoot = host.options.activityControlRoot;
        if (activityControlRoot) {
            const boot = inspectMigrationRollbackBeforeWorkspaceOpen(
                activityControlRoot,
                host.dataSlotsRoot,
                host.appBuildId,
            );
            host.setMigrationRollbackBoot(boot);
            if (boot.kind === 'maintenance') {
                host.setMigrationMaintenance(true);
                tryRestoreMigrationRollbackBinding(host, boot);
                return migrationSessionOutcome(host, requestId, migrationViewFrom(host, boot));
            }
        }
        return problem(host,
            'recovery-required',
            '迁移回退仍需维护，未报告完成。',
            requestId,
            'unknown',
        );
    }
    finally {
        host.setMigrationRequestInFlight(false);
    }
}

/**
 * Captures the current closed DATA identity and reopens it when requested.
 * @param {boolean} reopenAfterCapture Whether normal operation resumes after capture.
 * @return {Promise<MigrationRollbackPreviewFacts>} Fresh owner-private facts.
 */
export async function captureMigrationRollbackPreviewFacts(host: WorkspaceHost, 
    reopenAfterCapture: boolean,
): Promise<MigrationRollbackPreviewFacts> {
    const status = host.dataState().status;
    if (status.kind !== 'ready' || !host.dataState().store) {
        throw new Error('Migration rollback requires writable DATA');
    }
    const expected: MigrationRollbackDataIdentity = Object.freeze({
        workspaceId: status.workspaceId,
        schemaLevel: status.schemaLevel.toString(),
        revision: status.revision,
    });
    await closeDataForMigration(host);
    try {
        const safetyStatus = inspectMigrationSafetyCopy(host.dataSlotsRoot);
        if (safetyStatus.kind !== 'verified') {
            throw new Error('Migration safety copy is unavailable');
        }
        const active = observeRestoreDataSlot(host.dataSlotsRoot, 'active');
        const member = active.kind === 'present' ? active.fingerprint.members[0] : undefined;
        if (active.kind !== 'present'
            || active.fingerprint.members.length !== 1
            || member?.path !== 'workspace.sqlite') {
            throw new Error('Active DATA closure changed');
        }
        return Object.freeze({
            safetyCopy: Object.freeze({
                projection: migrationSafetyCopyProjection(safetyStatus) as Extract<
                    MigrationSafetyCopyProjection,
                    Readonly<{kind: 'verified'}>
                >,
                closedDataSlotDigest: safetyStatus.metadata.closedDataSlotDigest,
            }),
            currentData: Object.freeze({
                ...expected,
                byteLength: member.byteLength,
                digest: member.sha256,
                slotFingerprint: active.fingerprint.slotFingerprint,
            }),
            currentLibrary: Object.freeze({kind: 'absent' as const}),
            sourceBuild: sourceBuildProjection(host.appBuildId, host.options),
        });
    }
    catch (error) {
        if (!reopenAfterCapture) {
            await reopenMigrationData(host, expected);
            startDurableBackup(host);
        }
        throw error;
    }
    finally {
        if (reopenAfterCapture) {
            await reopenMigrationData(host, expected);
            startDurableBackup(host);
        }
    }
}

/**
 * Closes background owners and DATA before physical rollback evidence is observed.
 * @return {Promise<void>} Completion after the active connection is closed.
 */
export async function closeDataForMigration(host: WorkspaceHost): Promise<void> {
    const store = host.dataState().store;
    if (!store) {
        throw new Error('Workspace DATA is not open');
    }
    try {
        store.setPostCommitHint(null);
    }
    catch {
        // A terminal connection may already have detached its hint.
    }
    await host.backupCoordinator()?.close();
    host.setBackupCoordinator(undefined);
    if (host.restoreCoordinator()?.requiresMaintenance()) {
        throw new Error('Restore maintenance blocks MigrationRollback');
    }
    host.setRestoreCoordinator(undefined);
    await store.close();
    host.setDataState(Object.freeze({
        sqliteVersion: host.dataState().sqliteVersion,
        status: Object.freeze({
            kind: 'recovery' as const,
            problem: migrationRollbackEvidenceProblem(),
        }),
    }));
}

/**
 * Opens the exact DATA chosen by the handoff and rejects any identity drift.
 * @param {MigrationRollbackDataIdentity} expected Exact durable identity.
 * @return {Promise<void>} Completion after the validated store is adopted.
 */
export async function reopenMigrationData(host: WorkspaceHost, expected: MigrationRollbackDataIdentity): Promise<void> {
    const openedStore = host.dataState().store;
    if (openedStore) {
        const status = openedStore.status();
        if (status.workspaceId === expected.workspaceId
            && status.schemaLevel.toString() === expected.schemaLevel
            && status.revision === expected.revision) {
            return;
        }
        await openedStore.close();
    }
    const opened = await openWorkspaceDataWithMigrations(
        host.dataSlotsRoot,
        migrationOpenOptions(host.appBuildId, host.options),
    );
    host.setDataState(dataStateFrom(opened));
    const status = host.dataState().status;
    if (opened.kind !== 'ready'
        || status.kind !== 'ready'
        || status.workspaceId !== expected.workspaceId
        || status.schemaLevel.toString() !== expected.schemaLevel
        || status.revision !== expected.revision) {
        if (opened.kind === 'ready' || opened.kind === 'read-only') {
            await opened.store.close();
        }
        host.setDataState(Object.freeze({
            sqliteVersion: workspaceDataRuntimeVersion(),
            status: Object.freeze({
                kind: 'recovery' as const,
                problem: migrationRollbackEvidenceProblem(),
            }),
        }));
        throw new Error('Migration rollback reopened DATA identity changed');
    }
}

/**
 * Runs FLOW-00 after the selected DATA is open and before a terminal receipt.
 * @return {Promise<void>} Completion after lifecycle reconciliation succeeds.
 */
export async function runMigrationRollbackFlow00(host: WorkspaceHost): Promise<void> {
    const openedStore = host.dataState().store;
    if (!openedStore) {
        throw new Error('Migration rollback DATA is not open');
    }
    const projection = openedStore.readSetupProjection();
    const problem = await reconcileWorkspaceLifecycle(host, randomUUID(), projection);
    if (problem !== null) {
        throw new Error('FLOW-00 reconciliation did not complete');
    }
}
