import type { CommandReceiptOutcome } from '../data/store/types';
import { RestoreCoordinator, RestoreSessionError } from '../protect/restore-session';
import { BOOTSTRAP_PROTOCOL_VERSION } from '../shared/bootstrap-contract';
import type { MigrationRollbackSessionView, MigrationSafetyCopyProjection, WorkspaceMigrationSuccessValue } from '../shared/workspace-migration-contract';
import { WorkspaceSetupOutcome, WorkspaceSetupProblem } from '../shared/workspace-setup-contract';
import type { WorkspaceCommandResult, WorkspaceSetupProblemCode } from '../shared/workspace-setup-contract';
import type { DataCommitProblem, WorkspaceHost } from './host';
export function problem(host: WorkspaceHost, 
    code: WorkspaceSetupProblemCode,
    message: string,
    requestId: string | null,
    dataEffect: 'unchanged' | 'unknown' = 'unchanged',
    details?: NonNullable<WorkspaceSetupProblem['details']>,
): WorkspaceSetupOutcome {
    return {
        ok: false,
        problem: {
            code,
            message,
            requestId,
            appBuildId: host.appBuildId,
            workspaceEpoch: host.workspaceEpoch(),
            dataEffect,
            ...(details === undefined ? {} : { details }),
        },
    };
}

/**
 * Preserves DATA commit semantics at the Workspace boundary.
 * @param {DataCommitProblem} problem - DATA-owned stable commit problem.
 * @param {string} requestId - Workspace request correlation identity.
 * @param {string} unchangedMessage - Domain message for an unchanged write.
 * @param {string} overlapMessage - Optional domain message for Meeting overlap.
 * @return {WorkspaceSetupOutcome} Workspace-owned structured problem.
 */
export function commitProblem(host: WorkspaceHost, 
    commitFailure: DataCommitProblem,
    requestId: string,
    unchangedMessage: string,
    overlapMessage?: string,
): WorkspaceSetupOutcome {
    if (commitFailure.code === 'decision-required'
        && commitFailure.details.reason === 'meeting-time-overlap'
        && overlapMessage !== undefined) {
        return problem(host,
            'decision-required',
            overlapMessage,
            requestId,
            'unchanged',
            commitFailure.details,
        );
    }
    if (commitFailure.code === 'operation-in-progress') {
        return problem(host,
            'operation-in-progress',
            '另一个写入正在完成；请重试，正式数据没有改变。',
            requestId,
            'unchanged',
            commitFailure.details,
        );
    }
    return problem(host, commitFailure.code, unchangedMessage, requestId);
}

/**
 * Wraps one migration success value in the common Workspace outcome.
 * @param {WorkspaceMigrationSuccessValue} value Exact success value.
 * @return {WorkspaceSetupOutcome} Common success envelope.
 */
export function migrationValue(host: WorkspaceHost, value: WorkspaceMigrationSuccessValue): WorkspaceSetupOutcome {
    return Object.freeze({ok: true as const, value});
}

export function migrationSafetyOutcome(host: WorkspaceHost, 
    requestId: string,
    safetyCopy: MigrationSafetyCopyProjection,
): WorkspaceSetupOutcome {
    return migrationValue(host, Object.freeze({
        kind: 'workspace.migration-safety-copy' as const,
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId: host.appBuildId,
        requestId,
        workspaceEpoch: host.workspaceEpoch(),
        safetyCopy,
    }));
}

export function migrationSessionOutcome(host: WorkspaceHost, 
    requestId: string,
    session: MigrationRollbackSessionView,
): WorkspaceSetupOutcome {
    return migrationValue(host, Object.freeze({
        kind: 'workspace.migration-rollback-session' as const,
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId: host.appBuildId,
        requestId,
        workspaceEpoch: host.workspaceEpoch(),
        session,
    }));
}

export function restoreSessionOutcome(host: WorkspaceHost, 
    requestId: string,
    session: ReturnType<RestoreCoordinator['query']>,
): WorkspaceSetupOutcome {
    return {
        ok: true,
        value: {
            kind: 'workspace.restore-session',
            protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
            appBuildId: host.appBuildId,
            requestId,
            workspaceEpoch: host.workspaceEpoch(),
            session,
        },
    };
}

export function restoreProblem(host: WorkspaceHost, 
    error: unknown,
    requestId: string,
    message: string,
): WorkspaceSetupOutcome {
    if (error instanceof RestoreSessionError) {
        if (error.code === 'conflict') {
            return problem(host, 'conflict', message, requestId);
        }
        if (error.code === 'identity-conflict' || error.code === 'not-found') {
            return problem(host, 'identity-conflict', message, requestId);
        }
        if (error.code === 'snapshot-incomplete'
            || error.code === 'snapshot-corrupt'
            || error.code === 'incompatible-version'
            || error.code === 'library-safety-unavailable') {
            return problem(host, 'validation', message, requestId);
        }
    }
    return problem(host, 'recovery-required', message, requestId);
}

export function backupConfigurationCommandOutcome(host: WorkspaceHost, 
    requestId: string,
    committed: CommandReceiptOutcome,
): WorkspaceSetupOutcome {
    const effect = committed.effects[0];
    if (committed.effects.length !== 1
        || effect.code !== 'protect.backup-destination-configured'
        || effect.entity.kind !== 'backup-configuration') {
        return problem(host,
            'recovery-required',
            '命令回执与备份配置事实不一致。',
            requestId,
            'unknown',
        );
    }
    const outcome: WorkspaceCommandResult = {
        kind: 'committed',
        revision: committed.revision,
        effects: [{
            code: 'protect.backup-destination-configured',
            entity: {
                kind: 'backup-configuration',
                id: effect.entity.id,
                version: effect.entity.version,
            },
        }],
        pendingFollowUps: [committed.pendingFollowUps[0]],
    };
    return {
        ok: true,
        value: {
            kind: 'workspace.command-outcome',
            protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
            appBuildId: host.appBuildId,
            requestId,
            workspaceEpoch: host.workspaceEpoch(),
            outcome,
        },
    };
}

export function termCommandOutcome(host: WorkspaceHost, 
    requestId: string,
    committed: CommandReceiptOutcome,
): WorkspaceSetupOutcome {
    const effect = committed.effects[0];
    if (committed.effects.length !== 1
        || (effect.code !== 'plan.term-created-current'
            && effect.code !== 'plan.term-end-date-updated'
            && effect.code !== 'plan.term-restored-current')
        || effect.entity.kind !== 'term') {
        return problem(host,
            'recovery-required',
            '命令回执与学期事实不一致。',
            requestId,
            'unknown',
        );
    }
    const outcome: WorkspaceCommandResult = {
        kind: 'committed',
        revision: committed.revision,
        effects: [{
            code: effect.code,
            entity: {
                kind: effect.entity.kind,
                id: effect.entity.id,
                version: effect.entity.version,
            },
        }],
        pendingFollowUps: [committed.pendingFollowUps[0]],
    };
    return {
        ok: true,
        value: {
            kind: 'workspace.command-outcome',
            protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
            appBuildId: host.appBuildId,
            requestId,
            workspaceEpoch: host.workspaceEpoch(),
            outcome,
        },
    };
}

/**
 * Maps one exact durable HolidayRange effect into the Workspace command outcome.
 * @param {string} requestId - Workspace request correlation identity.
 * @param {CommandReceiptOutcome} committed - Durable DATA receipt outcome.
 * @param {string} expectedEffect - Exact lifecycle effect required by the request.
 * @return {WorkspaceSetupOutcome} Validated command outcome or recovery problem.
 */
export function holidayRangeCommandOutcome(host: WorkspaceHost, 
    requestId: string,
    committed: CommandReceiptOutcome,
    expectedEffect:
        | 'plan.holiday-range-created'
        | 'plan.holiday-range-updated'
        | 'plan.holiday-range-deleted',
): WorkspaceSetupOutcome {
    const effect = committed.effects[0];
    if (committed.effects.length !== 1
        || effect.code !== expectedEffect
        || effect.entity.kind !== 'holiday-range') {
        return problem(host,
            'recovery-required',
            '命令回执与假期范围事实不一致。',
            requestId,
            'unknown',
        );
    }
    const outcome: WorkspaceCommandResult = {
        kind: 'committed',
        revision: committed.revision,
        effects: [{
            code: effect.code,
            entity: {
                kind: 'holiday-range',
                id: effect.entity.id,
                version: effect.entity.version,
            },
        }],
        pendingFollowUps: [committed.pendingFollowUps[0]],
    };
    return {
        ok: true,
        value: {
            kind: 'workspace.command-outcome',
            protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
            appBuildId: host.appBuildId,
            requestId,
            workspaceEpoch: host.workspaceEpoch(),
            outcome,
        },
    };
}

/**
 * Maps one exact durable Task effect into the Workspace command outcome.
 * @param {string} requestId - Workspace request correlation identity.
 * @param {CommandReceiptOutcome} committed - Durable DATA receipt outcome.
 * @param {string} expectedEffect - Exact Task effect required by the request.
 * @return {WorkspaceSetupOutcome} Validated command outcome or recovery problem.
 */
export function taskCommandOutcome(host: WorkspaceHost, 
    requestId: string,
    committed: CommandReceiptOutcome,
    expectedEffect:
        | 'plan.task-series-created'
        | 'plan.task-series-updated'
        | 'plan.task-series-deleted'
        | 'plan.task-occurrence-completed'
        | 'plan.task-occurrence-status-set'
        | 'plan.task-progress-set'
        | 'plan.task-occurrence-changed'
        | 'plan.task-occurrence-deleted'
        | 'plan.task-occurrence-state-undone',
): WorkspaceSetupOutcome {
    const effect = committed.effects[0];
    if (committed.effects.length !== 1
        || effect.code !== expectedEffect
        || effect.entity.kind !== 'task-series') {
        return problem(host,
            'recovery-required',
            '命令回执与任务事实不一致。',
            requestId,
            'unknown',
        );
    }
    const outcome: WorkspaceCommandResult = {
        kind: 'committed',
        revision: committed.revision,
        effects: [{
            code: effect.code,
            entity: {
                kind: 'task-series',
                id: effect.entity.id,
                version: effect.entity.version,
            },
        }],
        pendingFollowUps: [committed.pendingFollowUps[0]],
        ...(committed.undoCapability === undefined
            ? {}
            : { undoCapability: committed.undoCapability }),
    };
    return {
        ok: true,
        value: {
            kind: 'workspace.command-outcome',
            protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
            appBuildId: host.appBuildId,
            requestId,
            workspaceEpoch: host.workspaceEpoch(),
            outcome,
        },
    };
}

export function singleCreationCommandOutcome(host: WorkspaceHost, 
    requestId: string,
    committed: CommandReceiptOutcome,
    expectedEffect: 'plan.course-created' | 'plan.meeting-series-created',
    expectedEntityKind: 'course' | 'meeting-series',
): WorkspaceSetupOutcome {
    const effect = committed.effects[0];
    if (committed.effects.length !== 1
        || effect.code !== expectedEffect
        || effect.entity.kind !== expectedEntityKind) {
        return problem(host,
            'recovery-required',
            '命令回执与课程或课节事实不一致。',
            requestId,
            'unknown',
        );
    }
    const outcome: WorkspaceCommandResult = {
        kind: 'committed',
        revision: committed.revision,
        effects: [{
            code: expectedEffect,
            entity: {
                kind: expectedEntityKind,
                id: effect.entity.id,
                version: effect.entity.version,
            },
        }],
        pendingFollowUps: [committed.pendingFollowUps[0]],
    };
    return {
        ok: true,
        value: {
            kind: 'workspace.command-outcome',
            protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
            appBuildId: host.appBuildId,
            requestId,
            workspaceEpoch: host.workspaceEpoch(),
            outcome,
        },
    };
}

export function courseCommandOutcome(host: WorkspaceHost, 
    requestId: string,
    committed: CommandReceiptOutcome,
): WorkspaceSetupOutcome {
    const courseEffect = committed.effects[0];
    const meetingEffect = committed.effects[1];
    if (committed.effects.length !== 2
        || courseEffect.code !== 'plan.course-created'
        || courseEffect.entity.kind !== 'course'
        || meetingEffect.code !== 'plan.meeting-series-created'
        || meetingEffect.entity.kind !== 'meeting-series') {
        return problem(host,
            'recovery-required',
            '命令回执与课程事实不一致。',
            requestId,
            'unknown',
        );
    }
    const outcome: WorkspaceCommandResult = {
        kind: 'committed',
        revision: committed.revision,
        effects: [
            {
                code: courseEffect.code,
                entity: {
                    kind: 'course',
                    id: courseEffect.entity.id,
                    version: courseEffect.entity.version,
                },
            },
            {
                code: meetingEffect.code,
                entity: {
                    kind: 'meeting-series',
                    id: meetingEffect.entity.id,
                    version: meetingEffect.entity.version,
                },
            },
        ],
        pendingFollowUps: [committed.pendingFollowUps[0]],
    };
    return {
        ok: true,
        value: {
            kind: 'workspace.command-outcome',
            protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
            appBuildId: host.appBuildId,
            requestId,
            workspaceEpoch: host.workspaceEpoch(),
            outcome,
        },
    };
}

/**
 * Validates and maps a durable Meeting occurrence receipt into the Workspace contract.
 * @param {string} requestId - Request correlation identity.
 * @param {CommandReceiptOutcome} committed - Durable DATA receipt outcome.
 * @param {'plan.meeting-occurrence-changed' | 'plan.meeting-occurrence-cancelled'} expectedEffect - Intent effect.
 * @return {WorkspaceSetupOutcome} Exact Workspace command outcome or recovery problem.
 */
export function meetingOccurrenceCommandOutcome(host: WorkspaceHost, 
    requestId: string,
    committed: CommandReceiptOutcome,
    expectedEffect: 'plan.meeting-occurrence-changed' | 'plan.meeting-occurrence-cancelled',
): WorkspaceSetupOutcome {
    const effect = committed.effects[0];
    if (committed.effects.length !== 1
        || effect.code !== expectedEffect
        || effect.entity.kind !== 'meeting-series') {
        return problem(host,
            'recovery-required',
            '命令回执与课节实例事实不一致。',
            requestId,
            'unknown',
        );
    }
    const outcome: WorkspaceCommandResult = {
        kind: 'committed',
        revision: committed.revision,
        effects: [{
            code: effect.code,
            entity: {
                kind: 'meeting-series',
                id: effect.entity.id,
                version: effect.entity.version,
            },
        }],
        pendingFollowUps: [committed.pendingFollowUps[0]],
    };
    return {
        ok: true,
        value: {
            kind: 'workspace.command-outcome',
            protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
            appBuildId: host.appBuildId,
            requestId,
            workspaceEpoch: host.workspaceEpoch(),
            outcome,
        },
    };
}
