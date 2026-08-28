/**
 * Returns the exact local development build descriptor and rollback classification.
 * @param {string} requestId Request correlation identity.
 * @return {WorkspaceSetupOutcome} Path-free ApplicationBuildStatus outcome.
 */
import { CURRENT_SCHEMA_LEVEL } from '../data/schema';
import { workspaceDataRuntimeVersion } from '../data/store/database';
import { BOOTSTRAP_PROTOCOL_VERSION } from '../shared/bootstrap-contract';
import { WORKSPACE_PROTOCOL_VERSION } from '../shared/workspace-migration-contract';
import type { ApplicationBuildStatus } from '../shared/workspace-migration-contract';
import { WorkspaceSetupOutcome } from '../shared/workspace-setup-contract';
import type { WorkspaceHost } from './host';
import { currentMigrationRollbackBoot } from './migration-boot';
import { migrationValue, problem } from './outcomes';
import { migrationRollbackTargetProjection } from './projections';
export function queryApplicationBuildStatus(host: WorkspaceHost, requestId: string): WorkspaceSetupOutcome {
    try {
        const match = /^development:([0-9a-f]{40})$/.exec(host.appBuildId);
        if (!match
            || (process.platform !== 'darwin' && process.platform !== 'win32')
            || (process.arch !== 'arm64' && process.arch !== 'x64')
            || (process.platform === 'darwin') !== (process.arch === 'arm64')) {
            throw new Error('Application build identity is unsupported');
        }
        const boot = currentMigrationRollbackBoot(host);
        let rollback: ApplicationBuildStatus['rollback'] = Object.freeze({kind: 'clear'});
        if (boot.kind === 'recovery-required') {
            rollback = Object.freeze({kind: 'recovery-required'});
        }
        else if (boot.kind === 'maintenance'
            && boot.currentBuild
            && boot.requiredBuilds) {
            rollback = Object.freeze({
                kind: 'classified' as const,
                currentBuild: boot.currentBuild,
                sourceAppBuildId: boot.requiredBuilds.sourceAppBuildId,
                targetAppBuildId: boot.requiredBuilds.targetAppBuildId,
            });
        }
        const status: ApplicationBuildStatus = Object.freeze({
            descriptor: Object.freeze({
                descriptorVersion: '1' as const,
                applicationId: 'io.github.siruimei07.courseflow.dev' as const,
                releaseVersion: host.options.applicationRelease?.releaseVersion
                    ?? '0.0.0-development',
                tag: host.options.applicationRelease?.tag ?? host.appBuildId,
                appBuildId: host.appBuildId,
                fullCommit: match[1]!,
                platform: process.platform,
                architecture: process.arch,
                variant: 'development' as const,
                workspaceProtocolVersion: WORKSPACE_PROTOCOL_VERSION,
                currentSchemaLevel: CURRENT_SCHEMA_LEVEL.toString(),
                formats: Object.freeze({
                    snapshot: '1' as const,
                    backupRepository: '1' as const,
                    restoreActivation: '1' as const,
                    migrationSafetyCopy: '1' as const,
                    migrationRollbackHandoff: '1' as const,
                }),
                runtimes: Object.freeze({
                    electron: process.versions.electron ?? 'not-running-in-electron',
                    chromium: process.versions.chrome ?? 'not-running-in-electron',
                    node: process.versions.node,
                    sqlite: workspaceDataRuntimeVersion(),
                }),
                rollbackTargets: host.options.migrationRollbackTarget
                    ? Object.freeze([
                        migrationRollbackTargetProjection(
                            host.options.migrationRollbackTarget,
                        ),
                    ])
                    : Object.freeze([]),
            }),
            processMatch: Object.freeze({
                main: 'exact' as const,
                renderer: 'exact' as const,
                workspace: 'exact' as const,
                allExact: true as const,
            }),
            rollback,
        });
        return migrationValue(host, {
            kind: 'workspace.application-build-status',
            protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
            appBuildId: host.appBuildId,
            requestId,
            workspaceEpoch: host.workspaceEpoch(),
            status,
        });
    }
    catch {
        return problem(host,
            'recovery-required',
            '无法确认当前应用构建身份。',
            requestId,
        );
    }
}
