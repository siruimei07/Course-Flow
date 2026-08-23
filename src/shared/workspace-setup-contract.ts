import {
    isCourseProjection,
    normalizeCreateCourseWithMeetingCommand,
    type CreateCourseWithMeetingCommand,
} from './workspace-course-contract';
import {
    BOOTSTRAP_PROTOCOL_VERSION,
    type WorkspaceDataStatus,
} from './bootstrap-contract';
import {
    isCanonicalUnsignedSqliteInteger,
    isCanonicalUuid,
} from './workspace-data-contract';
import {
    normalizeCreateTermCommand,
    type CreateTermCommand,
    type SetupProjection,
} from './workspace-term-contract';

export const WORKSPACE_SETUP_CHANNEL = 'courseflow:workspace-setup' as const;

type WorkspaceRequestBase = Readonly<{
    protocolVersion: typeof BOOTSTRAP_PROTOCOL_VERSION;
    appBuildId: string;
    requestId: string;
    workspaceEpoch: string;
}>;

export type InitializeWorkspaceRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.initialize';
}>;

export type SetupQueryRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.setup.query';
}>;

export type CreateTermRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.term.create';
    command: CreateTermCommand;
}>;

export type CreateCourseWithMeetingRequest = WorkspaceRequestBase & Readonly<{
    kind: 'workspace.course.create-with-first-meeting';
    command: CreateCourseWithMeetingCommand;
}>;

export type WorkspaceSetupRequest =
    | InitializeWorkspaceRequest
    | SetupQueryRequest
    | CreateTermRequest
    | CreateCourseWithMeetingRequest;

type WorkspaceCommandEffect = Readonly<{
    code:
        | 'plan.term-created-current'
        | 'plan.course-created'
        | 'plan.meeting-series-created';
    entity: Readonly<{
        kind: 'term' | 'course' | 'meeting-series';
        id: string;
        version: string;
    }>;
}>;

export type WorkspaceCommandResult = Readonly<{
    kind: 'committed';
    revision: string;
    effects: readonly [WorkspaceCommandEffect, ...WorkspaceCommandEffect[]];
    pendingFollowUps: readonly [string];
}>;

export type WorkspaceSetupProblemCode =
    | 'invalid-request'
    | 'build-mismatch'
    | 'stale-workspace'
    | 'workspace-unavailable'
    | 'validation'
    | 'permission'
    | 'conflict'
    | 'recovery-required';

export type WorkspaceSetupProblem = Readonly<{
    code: WorkspaceSetupProblemCode;
    message: string;
    requestId: string | null;
    appBuildId: string;
    workspaceEpoch: string;
    dataEffect: 'unchanged' | 'unknown';
}>;

export type WorkspaceSetupOutcome =
    | Readonly<{
        ok: true;
        value: Readonly<{
            kind: 'workspace.initialized';
            protocolVersion: typeof BOOTSTRAP_PROTOCOL_VERSION;
            appBuildId: string;
            requestId: string;
            workspaceEpoch: string;
            workspaceData: WorkspaceDataStatus;
        }>;
    }>
    | Readonly<{
        ok: true;
        value: Readonly<{
            kind: 'workspace.setup-projection';
            protocolVersion: typeof BOOTSTRAP_PROTOCOL_VERSION;
            appBuildId: string;
            requestId: string;
            workspaceEpoch: string;
            dataMode: 'ready' | 'read-only';
            projection: SetupProjection;
        }>;
    }>
    | Readonly<{
        ok: true;
        value: Readonly<{
            kind: 'workspace.command-outcome';
            protocolVersion: typeof BOOTSTRAP_PROTOCOL_VERSION;
            appBuildId: string;
            requestId: string;
            workspaceEpoch: string;
            outcome: WorkspaceCommandResult;
        }>;
    }>
    | Readonly<{ ok: false; problem: WorkspaceSetupProblem }>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function hasExactDataKeys(value: unknown, expectedKeys: readonly string[]): value is Record<string, unknown> {
    if (!isPlainObject(value)) {
        return false;
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    return keys.length === expectedKeys.length
        && keys.every((key) => typeof key === 'string' && expectedKeys.includes(key))
        && expectedKeys.every((key) => {
            const descriptor = descriptors[key];
            return descriptor !== undefined && 'value' in descriptor && descriptor.enumerable;
        });
}

function isRequestBase(value: Record<string, unknown>): boolean {
    return value.protocolVersion === BOOTSTRAP_PROTOCOL_VERSION
        && typeof value.appBuildId === 'string'
        && value.appBuildId.length > 0
        && typeof value.requestId === 'string'
        && value.requestId.length > 0
        && isCanonicalUuid(value.workspaceEpoch);
}

export function makeInitializeWorkspaceRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
): InitializeWorkspaceRequest {
    return {
        kind: 'workspace.initialize',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
    };
}

export function makeSetupQueryRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
): SetupQueryRequest {
    return {
        kind: 'workspace.setup.query',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
    };
}

export function makeCreateTermRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: CreateTermCommand,
): CreateTermRequest {
    return {
        kind: 'workspace.term.create',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        command: normalizeCreateTermCommand(command),
    };
}

export function makeCreateCourseWithMeetingRequest(
    requestId: string,
    appBuildId: string,
    workspaceEpoch: string,
    command: CreateCourseWithMeetingCommand,
): CreateCourseWithMeetingRequest {
    return {
        kind: 'workspace.course.create-with-first-meeting',
        protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
        appBuildId,
        requestId,
        workspaceEpoch,
        command: normalizeCreateCourseWithMeetingCommand(command),
    };
}

export function isWorkspaceSetupRequest(
    value: unknown,
    expectedBuildId: string,
    expectedWorkspaceEpoch: string,
): value is WorkspaceSetupRequest {
    if (!isPlainObject(value)
        || value.appBuildId !== expectedBuildId
        || value.workspaceEpoch !== expectedWorkspaceEpoch
        || !isRequestBase(value)) {
        return false;
    }

    if (value.kind === 'workspace.initialize' || value.kind === 'workspace.setup.query') {
        return hasExactDataKeys(value, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
        ]);
    }
    if ((value.kind !== 'workspace.term.create'
            && value.kind !== 'workspace.course.create-with-first-meeting')
        || !hasExactDataKeys(value, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
            'command',
        ])) {
        return false;
    }

    try {
        if (value.kind === 'workspace.term.create') {
            normalizeCreateTermCommand(value.command);
        }
        else {
            normalizeCreateCourseWithMeetingCommand(value.command);
        }
        return true;
    }
    catch {
        return false;
    }
}

function isTermProjection(value: unknown): boolean {
    return hasExactDataKeys(value, [
        'termId',
        'name',
        'startDate',
        'endDate',
        'timeZone',
        'entityVersion',
    ])
        && isCanonicalUuid(value.termId)
        && typeof value.name === 'string'
        && typeof value.startDate === 'string'
        && typeof value.endDate === 'string'
        && typeof value.timeZone === 'string'
        && isCanonicalUnsignedSqliteInteger(value.entityVersion);
}

function isSetupProjection(value: unknown): boolean {
    return hasExactDataKeys(value, [
        'workspaceRevision',
        'planEntityVersion',
        'currentTerm',
        'terms',
        'courses',
    ])
        && isCanonicalUnsignedSqliteInteger(value.workspaceRevision)
        && isCanonicalUnsignedSqliteInteger(value.planEntityVersion)
        && (value.currentTerm === null || isTermProjection(value.currentTerm))
        && Array.isArray(value.terms)
        && value.terms.every(isTermProjection)
        && Array.isArray(value.courses)
        && value.courses.every(isCourseProjection);
}

function isWorkspaceCommandResult(value: unknown): value is WorkspaceCommandResult {
    if (!hasExactDataKeys(value, ['kind', 'revision', 'effects', 'pendingFollowUps'])
        || value.kind !== 'committed'
        || !isCanonicalUnsignedSqliteInteger(value.revision)
        || !Array.isArray(value.effects)
        || (value.effects.length !== 1 && value.effects.length !== 2)
        || !Array.isArray(value.pendingFollowUps)
        || value.pendingFollowUps.length !== 1
        || !isCanonicalUuid(value.pendingFollowUps[0])) {
        return false;
    }

    const isEffect = (
        effect: unknown,
        code: WorkspaceCommandEffect['code'],
        entityKind: WorkspaceCommandEffect['entity']['kind'],
    ): boolean => hasExactDataKeys(effect, ['code', 'entity'])
        && effect.code === code
        && hasExactDataKeys(effect.entity, ['kind', 'id', 'version'])
        && effect.entity.kind === entityKind
        && isCanonicalUuid(effect.entity.id)
        && isCanonicalUnsignedSqliteInteger(effect.entity.version);
    if (value.effects.length === 1) {
        return isEffect(value.effects[0], 'plan.term-created-current', 'term');
    }
    return isEffect(value.effects[0], 'plan.course-created', 'course')
        && isEffect(value.effects[1], 'plan.meeting-series-created', 'meeting-series');
}

export function isWorkspaceSetupOutcome(
    value: unknown,
    expectedBuildId: string,
    expectedRequestId: string,
    expectedWorkspaceEpoch: string,
): value is WorkspaceSetupOutcome {
    if (!isPlainObject(value)) {
        return false;
    }

    if (value.ok === false) {
        const problem = value.problem;
        return hasExactDataKeys(value, ['ok', 'problem'])
            && hasExactDataKeys(problem, [
                'code',
                'message',
                'requestId',
                'appBuildId',
                'workspaceEpoch',
                'dataEffect',
            ])
            && [
                'invalid-request',
                'build-mismatch',
                'stale-workspace',
                'workspace-unavailable',
                'validation',
                'permission',
                'conflict',
                'recovery-required',
            ].includes(problem.code as string)
            && typeof problem.message === 'string'
            && problem.message.length > 0
            && problem.requestId === expectedRequestId
            && problem.appBuildId === expectedBuildId
            && problem.workspaceEpoch === expectedWorkspaceEpoch
            && (problem.dataEffect === 'unchanged'
                || (problem.code === 'recovery-required' && problem.dataEffect === 'unknown'));
    }

    if (value.ok !== true || !hasExactDataKeys(value, ['ok', 'value']) || !isPlainObject(value.value)) {
        return false;
    }
    const outcome = value.value;
    const common = outcome.protocolVersion === BOOTSTRAP_PROTOCOL_VERSION
        && outcome.appBuildId === expectedBuildId
        && outcome.requestId === expectedRequestId
        && outcome.workspaceEpoch === expectedWorkspaceEpoch;
    if (!common) {
        return false;
    }

    if (outcome.kind === 'workspace.setup-projection') {
        return hasExactDataKeys(outcome, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
            'dataMode',
            'projection',
        ])
            && (outcome.dataMode === 'ready' || outcome.dataMode === 'read-only')
            && isSetupProjection(outcome.projection);
    }
    if (outcome.kind === 'workspace.command-outcome') {
        return hasExactDataKeys(outcome, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
            'outcome',
        ])
            && isWorkspaceCommandResult(outcome.outcome);
    }
    return outcome.kind === 'workspace.initialized'
        && hasExactDataKeys(outcome, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
            'workspaceData',
        ])
        && isPlainObject(outcome.workspaceData)
        && (outcome.workspaceData.kind === 'ready' || outcome.workspaceData.kind === 'read-only');
}
