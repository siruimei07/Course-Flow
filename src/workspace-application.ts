import { randomUUID } from 'node:crypto';

import {
    CommittedCommandOutcomeUnknownError,
    initializeWorkspaceData,
    openWorkspaceDataWithMigrations,
    type CommandReceiptOutcome,
    type CommitOptions,
    type DataOpenResult,
    type OpenWorkspaceDataOptions,
    type SqliteDataStore,
} from './data/sqlite-data-store';
import {
    BOOTSTRAP_PROTOCOL_VERSION,
    isWorkspaceProbeRequest,
    type BootstrapOutcome,
    type WorkspaceDataStatus,
    type WorkspaceProbeRequest,
} from './shared/bootstrap-contract';
import {
    isWorkspaceSetupRequest,
    type CreateCourseWithMeetingRequest,
    type CreateTermRequest,
    type WorkspaceCommandResult,
    type WorkspaceSetupOutcome,
    type WorkspaceSetupProblemCode,
    type WorkspaceSetupRequest,
} from './shared/workspace-setup-contract';

export type WorkspaceApplicationOptions = OpenWorkspaceDataOptions & Readonly<{
    commitOptions?: CommitOptions;
}>;

type WorkspaceDataState = Readonly<{
    sqliteVersion: string;
    status: WorkspaceDataStatus;
    store?: SqliteDataStore;
}>;

function requestIdFrom(value: unknown): string | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return null;
    }
    const requestId = (value as { requestId?: unknown }).requestId;
    return typeof requestId === 'string' ? requestId : null;
}

function requestKindFrom(value: unknown): unknown {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return undefined;
    }
    return (value as { kind?: unknown }).kind;
}

function dataStateFrom(opened: DataOpenResult): WorkspaceDataState {
    if (opened.kind === 'absent') {
        return { sqliteVersion: opened.sqliteVersion, status: { kind: 'absent' } };
    }
    if (opened.kind === 'recovery') {
        return {
            sqliteVersion: opened.sqliteVersion,
            status: { kind: 'recovery', problem: opened.problem },
        };
    }
    return {
        sqliteVersion: opened.sqliteVersion,
        status: opened.store.status(),
        store: opened.store,
    };
}

export class WorkspaceApplication {
    private readonly workspaceEpoch = randomUUID();

    private constructor(
        private readonly dataSlotsRoot: string,
        private readonly appBuildId: string,
        private dataState: WorkspaceDataState,
        private readonly options: WorkspaceApplicationOptions,
    ) {}

    public static async open(
        dataSlotsRoot: string,
        appBuildId: string,
        options: WorkspaceApplicationOptions = {},
    ): Promise<WorkspaceApplication> {
        const opened = await openWorkspaceDataWithMigrations(dataSlotsRoot, options);
        return new WorkspaceApplication(dataSlotsRoot, appBuildId, dataStateFrom(opened), options);
    }

    public handle(request: WorkspaceProbeRequest): Promise<BootstrapOutcome>;
    public handle(request: WorkspaceSetupRequest): Promise<WorkspaceSetupOutcome>;
    public handle(request: unknown): Promise<BootstrapOutcome | WorkspaceSetupOutcome>;
    public async handle(request: unknown): Promise<BootstrapOutcome | WorkspaceSetupOutcome> {
        if (isWorkspaceProbeRequest(request, this.appBuildId)) {
            return this.bootstrap(request);
        }

        if (!isWorkspaceSetupRequest(request, this.appBuildId, this.workspaceEpoch)) {
            const value = request as { appBuildId?: unknown; workspaceEpoch?: unknown } | null;
            const requestKind = requestKindFrom(request);
            const code = value?.appBuildId !== undefined && value.appBuildId !== this.appBuildId
                ? 'build-mismatch'
                : value?.workspaceEpoch !== undefined && value.workspaceEpoch !== this.workspaceEpoch
                    ? 'stale-workspace'
                    : (requestKind === 'workspace.term.create'
                        || requestKind === 'workspace.course.create-with-first-meeting')
                        ? 'validation'
                        : 'invalid-request';
            return this.problem(code, 'Workspace 请求无效。', requestIdFrom(request));
        }

        switch (request.kind) {
            case 'workspace.initialize':
                return this.initialize(request.requestId);
            case 'workspace.setup.query':
                return this.querySetup(request.requestId);
            case 'workspace.term.create':
                return this.createTerm(request.requestId, request.command);
            case 'workspace.course.create-with-first-meeting':
                return this.createCourseWithMeeting(request.requestId, request.command);
        }
    }

    public async close(): Promise<void> {
        await this.dataState.store?.close();
    }

    private bootstrap(request: WorkspaceProbeRequest): BootstrapOutcome {
        return {
            ok: true,
            value: {
                protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                appBuildId: this.appBuildId,
                requestId: request.requestId,
                workspaceProcess: 'ready',
                sqliteVersion: this.dataState.sqliteVersion,
                dataRootClass: request.dataRootClass,
                workspaceEpoch: this.workspaceEpoch,
                workspaceData: this.dataState.status,
            },
        };
    }

    private initialize(requestId: string): WorkspaceSetupOutcome {
        if (this.dataState.status.kind === 'recovery') {
            return this.problem('recovery-required', '本地数据需要恢复，不能开始设置。', requestId);
        }
        if (this.options.readOnly) {
            return this.problem('permission', '本地数据为只读，不能开始设置。', requestId);
        }
        if (this.dataState.status.kind === 'absent') {
            try {
                const store = initializeWorkspaceData(this.dataSlotsRoot, randomUUID());
                this.dataState = {
                    sqliteVersion: this.dataState.sqliteVersion,
                    status: store.status(),
                    store,
                };
            }
            catch {
                return this.problem('workspace-unavailable', '无法创建本地工作区。', requestId);
            }
        }

        return {
            ok: true,
            value: {
                kind: 'workspace.initialized',
                protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                appBuildId: this.appBuildId,
                requestId,
                workspaceEpoch: this.workspaceEpoch,
                workspaceData: this.dataState.status,
            },
        };
    }

    private querySetup(requestId: string): WorkspaceSetupOutcome {
        if (!this.dataState.store) {
            const code = this.dataState.status.kind === 'recovery'
                ? 'recovery-required'
                : 'workspace-unavailable';
            return this.problem(code, '当前没有可读取的 setup 数据。', requestId);
        }

        try {
            return {
                ok: true,
                value: {
                    kind: 'workspace.setup-projection',
                    protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                    appBuildId: this.appBuildId,
                    requestId,
                    workspaceEpoch: this.workspaceEpoch,
                    dataMode: this.dataState.status.kind === 'read-only' ? 'read-only' : 'ready',
                    projection: this.dataState.store.readSetupProjection(),
                },
            };
        }
        catch {
            return this.problem('recovery-required', '无法读取一致的 setup 数据。', requestId);
        }
    }

    private async createTerm(
        requestId: string,
        command: CreateTermRequest['command'],
    ): Promise<WorkspaceSetupOutcome> {
        if (!this.dataState.store) {
            const code = this.dataState.status.kind === 'recovery'
                ? 'recovery-required'
                : 'workspace-unavailable';
            return this.problem(code, '当前没有可写入的本地工作区。', requestId);
        }

        try {
            const committed = await this.dataState.store.commit(command, this.options.commitOptions);
            this.dataState = {
                ...this.dataState,
                status: this.dataState.store.status(),
            };
            if (!committed.ok) {
                const code = committed.problem.code === 'permission'
                    ? 'permission'
                    : committed.problem.code === 'conflict'
                        ? 'conflict'
                        : 'workspace-unavailable';
                return this.problem(code, '当前学期未保存，正式数据没有改变。', requestId);
            }
            return this.termCommandOutcome(requestId, committed.value);
        }
        catch (error) {
            if (error instanceof CommittedCommandOutcomeUnknownError
                && error.commandId === command.commandId) {
                const receipt = await this.recoverCommittedReceipt(command.commandId);
                if (receipt) {
                    return this.termCommandOutcome(requestId, receipt);
                }
                return this.problem(
                    'recovery-required',
                    '提交结果无法从持久回执确认；请重新打开工作区后查询。',
                    requestId,
                    'unknown',
                );
            }
            const code = error instanceof TypeError ? 'validation' : 'recovery-required';
            return this.problem(code, '当前学期未保存，正式数据没有改变。', requestId);
        }
    }

    private async createCourseWithMeeting(
        requestId: string,
        command: CreateCourseWithMeetingRequest['command'],
    ): Promise<WorkspaceSetupOutcome> {
        if (!this.dataState.store) {
            const code = this.dataState.status.kind === 'recovery'
                ? 'recovery-required'
                : 'workspace-unavailable';
            return this.problem(code, '当前没有可写入的本地工作区。', requestId);
        }

        try {
            const committed = await this.dataState.store.commit(command, this.options.commitOptions);
            this.dataState = {
                ...this.dataState,
                status: this.dataState.store.status(),
            };
            if (!committed.ok) {
                const code = committed.problem.code === 'permission'
                    ? 'permission'
                    : committed.problem.code === 'conflict'
                        ? 'conflict'
                        : 'workspace-unavailable';
                return this.problem(code, '课程与首个课节未保存，正式数据没有改变。', requestId);
            }
            return this.courseCommandOutcome(requestId, committed.value);
        }
        catch (error) {
            if (error instanceof CommittedCommandOutcomeUnknownError
                && error.commandId === command.commandId) {
                const receipt = await this.recoverCommittedReceipt(command.commandId);
                if (receipt) {
                    return this.courseCommandOutcome(requestId, receipt);
                }
                return this.problem(
                    'recovery-required',
                    '提交结果无法从持久回执确认；请重新打开工作区后查询。',
                    requestId,
                    'unknown',
                );
            }
            const code = error instanceof TypeError ? 'validation' : 'recovery-required';
            return this.problem(code, '课程与首个课节未保存，正式数据没有改变。', requestId);
        }
    }

    private async recoverCommittedReceipt(commandId: string): Promise<CommandReceiptOutcome | null> {
        try {
            const reopened = await openWorkspaceDataWithMigrations(this.dataSlotsRoot, this.options);
            this.dataState = dataStateFrom(reopened);
            return this.dataState.store?.receipt(commandId) ?? null;
        }
        catch {
            return null;
        }
    }

    private termCommandOutcome(
        requestId: string,
        committed: CommandReceiptOutcome,
    ): WorkspaceSetupOutcome {
        const effect = committed.effects[0];
        if (committed.effects.length !== 1
            || effect.code !== 'plan.term-created-current'
            || effect.entity.kind !== 'term') {
            return this.problem(
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
                appBuildId: this.appBuildId,
                requestId,
                workspaceEpoch: this.workspaceEpoch,
                outcome,
            },
        };
    }

    private courseCommandOutcome(
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
            return this.problem(
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
                appBuildId: this.appBuildId,
                requestId,
                workspaceEpoch: this.workspaceEpoch,
                outcome,
            },
        };
    }

    private problem(
        code: WorkspaceSetupProblemCode,
        message: string,
        requestId: string | null,
        dataEffect: 'unchanged' | 'unknown' = 'unchanged',
    ): WorkspaceSetupOutcome {
        return {
            ok: false,
            problem: {
                code,
                message,
                requestId,
                appBuildId: this.appBuildId,
                workspaceEpoch: this.workspaceEpoch,
                dataEffect,
            },
        };
    }
}
