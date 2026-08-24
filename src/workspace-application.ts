/**
 * @file Coordinates Workspace queries and formal DATA intents for the desktop shell.
 */

import { randomUUID } from 'node:crypto';

import {
    CommittedCommandOutcomeUnknownError,
    initializeWorkspaceData,
    openWorkspaceDataWithMigrations,
    type CommandReceiptOutcome,
    type CommitOptions,
    type DataCommitResult,
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
    type CancelMeetingOccurrenceRequest,
    type ChangeMeetingOccurrenceRequest,
    type ChangeTaskOccurrenceRequest,
    type CompleteTaskRequest,
    type CreateHolidayRangeRequest,
    type CreateCourseWithMeetingRequest,
    type CreateTaskRequest,
    type CreateTermRequest,
    type DeleteHolidayRangeRequest,
    type DeleteTaskRequest,
    type DeleteTaskOccurrenceOrSeriesRequest,
    type MeetingOccurrenceImpactRequest,
    type MeetingSeriesQueryRequest,
    type PlanQueryRequest,
    type SetTaskOccurrenceStatusRequest,
    type SetTaskProgressRequest,
    type TaskOccurrenceImpactRequest,
    type RestoreTermAsCurrentRequest,
    type UpdateTermEndDateRequest,
    type UpdateHolidayRangeRequest,
    type UpdateTaskRequest,
    type TaskSeriesQueryRequest,
    type UndoTaskOccurrenceStateRequest,
    type WorkspaceCommandResult,
    type WorkspaceSetupOutcome,
    type WorkspaceSetupProblem,
    type WorkspaceSetupProblemCode,
    type WorkspaceSetupRequest,
} from './shared/workspace-setup-contract';
import {
    buildPlanProjection,
    createPlanEvaluationContext,
} from './shared/workspace-plan-contract';
import {
    localDateInTermZone,
    normalizeReconcileWorkspaceLifecycleCommand,
    normalizeRestoreTermAsCurrentCommand,
    type RestoreTermAsCurrentCommand,
    type SetupProjection,
} from './shared/workspace-term-contract';

export interface ClockPort {
    now(): string;
}

const SYSTEM_CLOCK: ClockPort = {
    now(): string {
        return new Date().toISOString();
    },
};

export type WorkspaceApplicationOptions = OpenWorkspaceDataOptions & Readonly<{
    commitOptions?: CommitOptions;
    clock?: ClockPort;
}>;

type WorkspaceDataState = Readonly<{
    sqliteVersion: string;
    status: WorkspaceDataStatus;
    store?: SqliteDataStore;
}>;

type DataCommitProblem = Extract<DataCommitResult, { ok: false }>['problem'];

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
                        || requestKind === 'workspace.term.update-end-date'
                        || requestKind === 'workspace.term.restore-as-current'
                        || requestKind === 'workspace.holiday-range.create'
                        || requestKind === 'workspace.holiday-range.update'
                        || requestKind === 'workspace.holiday-range.delete'
                        || requestKind === 'workspace.task.create'
                        || requestKind === 'workspace.task.update'
                        || requestKind === 'workspace.task.delete'
                        || requestKind === 'workspace.task.complete'
                        || requestKind === 'workspace.task.set-occurrence-status'
                        || requestKind === 'workspace.task.set-progress'
                        || requestKind === 'workspace.task.change-occurrence'
                        || requestKind === 'workspace.task.delete-occurrence-or-series'
                        || requestKind === 'workspace.task.undo-occurrence-state'
                        || requestKind === 'workspace.plan.query'
                        || requestKind === 'workspace.task-series.query'
                        || requestKind === 'workspace.task-occurrence.preview'
                        || requestKind === 'workspace.course.create-with-first-meeting'
                        || requestKind === 'workspace.meeting-series.query'
                        || requestKind === 'workspace.meeting-occurrence.preview'
                        || requestKind === 'workspace.meeting-occurrence.change'
                        || requestKind === 'workspace.meeting-occurrence.cancel')
                        ? 'validation'
                        : 'invalid-request';
            return this.problem(code, 'Workspace 请求无效。', requestIdFrom(request));
        }

        switch (request.kind) {
            case 'workspace.initialize':
                return this.initialize(request.requestId);
            case 'workspace.setup.query':
                return this.querySetup(request.requestId);
            case 'workspace.plan.query':
                return this.queryPlan(request.requestId);
            case 'workspace.term.create':
                return this.createTerm(request.requestId, request.command);
            case 'workspace.term.update-end-date':
                return this.updateTermEndDate(request.requestId, request.command);
            case 'workspace.term.restore-as-current':
                return this.restoreTermAsCurrent(request.requestId, request.command);
            case 'workspace.holiday-range.create':
                return this.commitHolidayRange(request.requestId, request.command);
            case 'workspace.holiday-range.update':
                return this.commitHolidayRange(request.requestId, request.command);
            case 'workspace.holiday-range.delete':
                return this.commitHolidayRange(request.requestId, request.command);
            case 'workspace.task.create':
                return this.commitTask(request.requestId, request.command);
            case 'workspace.task.update':
                return this.commitTask(request.requestId, request.command);
            case 'workspace.task.delete':
                return this.commitTask(request.requestId, request.command);
            case 'workspace.task.complete':
                return this.commitTask(request.requestId, request.command);
            case 'workspace.task.set-occurrence-status':
                return this.commitTask(request.requestId, request.command);
            case 'workspace.task.set-progress':
                return this.commitTask(request.requestId, request.command);
            case 'workspace.task.change-occurrence':
                return this.commitTask(request.requestId, request.command);
            case 'workspace.task.delete-occurrence-or-series':
                return this.commitTask(request.requestId, request.command);
            case 'workspace.task.undo-occurrence-state':
                return this.commitTask(request.requestId, request.command);
            case 'workspace.course.create-with-first-meeting':
                return this.createCourseWithMeeting(request.requestId, request.command);
            case 'workspace.meeting-series.query':
                return this.queryMeetingSeries(
                    request.requestId,
                    request.meetingSeriesId,
                    request.requestedWindow,
                );
            case 'workspace.task-series.query':
                return this.queryTaskSeries(
                    request.requestId,
                    request.taskSeriesId,
                    request.requestedWindow,
                );
            case 'workspace.task-occurrence.preview':
                return this.previewTaskOccurrence(request.requestId, request.draft);
            case 'workspace.meeting-occurrence.preview':
                return this.previewMeetingOccurrence(request.requestId, request.draft);
            case 'workspace.meeting-occurrence.change':
                return this.commitMeetingOccurrence(request.requestId, request.command);
            case 'workspace.meeting-occurrence.cancel':
                return this.commitMeetingOccurrence(request.requestId, request.command);
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

    private async querySetup(requestId: string): Promise<WorkspaceSetupOutcome> {
        if (!this.dataState.store) {
            const code = this.dataState.status.kind === 'recovery'
                ? 'recovery-required'
                : 'workspace-unavailable';
            return this.problem(code, '当前没有可读取的 setup 数据。', requestId);
        }

        try {
            const initialProjection = this.dataState.store.readSetupProjection();
            const reconciled = await this.reconcileWorkspaceLifecycle(requestId, initialProjection);
            if (reconciled) {
                return reconciled;
            }
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

    /**
     * Produces all current Today and Week facts from one revision and one Clock evaluation.
     * @param {string} requestId - Request correlation identity.
     * @return {WorkspaceSetupOutcome} Unified PLAN projection or structured problem.
     */
    private queryPlan(requestId: PlanQueryRequest['requestId']): WorkspaceSetupOutcome {
        if (!this.dataState.store) {
            const code = this.dataState.status.kind === 'recovery'
                ? 'recovery-required'
                : 'workspace-unavailable';
            return this.problem(code, '当前没有可读取的计划数据。', requestId);
        }

        try {
            const evaluatedAt = (this.options.clock ?? SYSTEM_CLOCK).now();
            const source = this.dataState.store.readPlanProjectionSource();
            const context = createPlanEvaluationContext(evaluatedAt, source.term.timeZone);
            return {
                ok: true,
                value: {
                    kind: 'workspace.plan-projection',
                    protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                    appBuildId: this.appBuildId,
                    requestId,
                    workspaceEpoch: this.workspaceEpoch,
                    dataMode: this.dataState.status.kind === 'read-only' ? 'read-only' : 'ready',
                    projection: buildPlanProjection(source, context, 'unavailable'),
                },
            };
        }
        catch (error) {
            const code = error instanceof TypeError ? 'workspace-unavailable' : 'recovery-required';
            return this.problem(code, '无法读取一致的 Today 与 Week 计划数据。', requestId);
        }
    }

    /**
     * Routes a bounded Meeting series query to DATA and wraps its Workspace outcome.
     * @param {string} requestId - Request correlation identity.
     * @param {string} meetingSeriesId - Stable Meeting series identity.
     * @param {MeetingOccurrenceWindow} requestedWindow - Requested physical-date window.
     * @return {Promise<WorkspaceSetupOutcome>} Query projection or structured problem.
     */
    private async queryMeetingSeries(
        requestId: string,
        meetingSeriesId: MeetingSeriesQueryRequest['meetingSeriesId'],
        requestedWindow: MeetingSeriesQueryRequest['requestedWindow'],
    ): Promise<WorkspaceSetupOutcome> {
        if (!this.dataState.store) {
            const code = this.dataState.status.kind === 'recovery'
                ? 'recovery-required'
                : 'workspace-unavailable';
            return this.problem(code, '当前没有可读取的课节规则数据。', requestId);
        }

        try {
            return {
                ok: true,
                value: {
                    kind: 'workspace.meeting-series-projection',
                    protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                    appBuildId: this.appBuildId,
                    requestId,
                    workspaceEpoch: this.workspaceEpoch,
                    dataMode: this.dataState.status.kind === 'read-only' ? 'read-only' : 'ready',
                    projection: this.dataState.store.readMeetingSeriesDetail(meetingSeriesId, requestedWindow),
                },
            };
        }
        catch (error) {
            const code = error instanceof TypeError ? 'validation' : 'recovery-required';
            return this.problem(code, '无法读取一致的课节规则数据。', requestId);
        }
    }

    /**
     * Routes a bounded Task series query to DATA and wraps its Workspace outcome.
     * @param {string} requestId - Request correlation identity.
     * @param {string} taskSeriesId - Stable Task series identity.
     * @param {TaskSeriesQueryRequest['requestedWindow']} requestedWindow - Requested physical-date window.
     * @return {Promise<WorkspaceSetupOutcome>} Query projection or structured problem.
     */
    private async queryTaskSeries(
        requestId: string,
        taskSeriesId: TaskSeriesQueryRequest['taskSeriesId'],
        requestedWindow: TaskSeriesQueryRequest['requestedWindow'],
    ): Promise<WorkspaceSetupOutcome> {
        if (!this.dataState.store) {
            const code = this.dataState.status.kind === 'recovery'
                ? 'recovery-required'
                : 'workspace-unavailable';
            return this.problem(code, '当前没有可读取的任务规则数据。', requestId);
        }

        try {
            return {
                ok: true,
                value: {
                    kind: 'workspace.task-series-projection',
                    protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                    appBuildId: this.appBuildId,
                    requestId,
                    workspaceEpoch: this.workspaceEpoch,
                    dataMode: this.dataState.status.kind === 'read-only' ? 'read-only' : 'ready',
                    projection: this.dataState.store.readTaskSeriesDetail(taskSeriesId, requestedWindow),
                },
            };
        }
        catch (error) {
            const code = error instanceof TypeError ? 'validation' : 'recovery-required';
            return this.problem(code, '无法读取一致的任务规则数据。', requestId);
        }
    }

    /**
     * Routes a whole-rule Meeting impact draft to the DATA preview owner.
     * @param {string} requestId - Request correlation identity.
     * @param {MeetingOccurrenceImpactDraft} draft - Exact proposed future rule.
     * @return {Promise<WorkspaceSetupOutcome>} Impact projection or structured problem.
     */
    private async previewMeetingOccurrence(
        requestId: string,
        draft: MeetingOccurrenceImpactRequest['draft'],
    ): Promise<WorkspaceSetupOutcome> {
        if (!this.dataState.store) {
            const code = this.dataState.status.kind === 'recovery'
                ? 'recovery-required'
                : 'workspace-unavailable';
            return this.problem(code, '当前没有可读取的课节规则数据。', requestId);
        }

        try {
            return {
                ok: true,
                value: {
                    kind: 'workspace.meeting-occurrence-impact',
                    protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                    appBuildId: this.appBuildId,
                    requestId,
                    workspaceEpoch: this.workspaceEpoch,
                    dataMode: this.dataState.status.kind === 'read-only' ? 'read-only' : 'ready',
                    projection: this.dataState.store.previewMeetingOccurrenceChange(draft),
                },
            };
        }
        catch (error) {
            const code = error instanceof TypeError ? 'validation' : 'recovery-required';
            return this.problem(code, '无法预览课节规则影响。', requestId);
        }
    }

    /**
     * Routes a future Task split/delete draft to the DATA preview owner without committing facts.
     * @param {string} requestId - Request correlation identity.
     * @param {TaskOccurrenceImpactRequest['draft']} draft - Exact future Task change or deletion.
     * @return {Promise<WorkspaceSetupOutcome>} Impact projection or structured problem.
     */
    private async previewTaskOccurrence(
        requestId: string,
        draft: TaskOccurrenceImpactRequest['draft'],
    ): Promise<WorkspaceSetupOutcome> {
        if (!this.dataState.store) {
            const code = this.dataState.status.kind === 'recovery'
                ? 'recovery-required'
                : 'workspace-unavailable';
            return this.problem(code, '当前没有可读取的任务规则数据。', requestId);
        }

        try {
            return {
                ok: true,
                value: {
                    kind: 'workspace.task-occurrence-impact',
                    protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
                    appBuildId: this.appBuildId,
                    requestId,
                    workspaceEpoch: this.workspaceEpoch,
                    dataMode: this.dataState.status.kind === 'read-only' ? 'read-only' : 'ready',
                    projection: this.dataState.store.previewTaskOccurrenceChange(draft),
                },
            };
        }
        catch (error) {
            const code = error instanceof TypeError ? 'validation' : 'recovery-required';
            return this.problem(code, '无法预览任务规则影响。', requestId);
        }
    }

    private async reconcileWorkspaceLifecycle(
        requestId: string,
        projection: SetupProjection,
    ): Promise<WorkspaceSetupOutcome | null> {
        const term = projection.currentTerm;
        if (!term || this.dataState.status.kind === 'read-only') {
            return null;
        }

        const evaluatedAt = (this.options.clock ?? SYSTEM_CLOCK).now();
        const applicableDate = localDateInTermZone(evaluatedAt, term.timeZone);
        if (applicableDate <= term.endDate) {
            return null;
        }

        const command = normalizeReconcileWorkspaceLifecycleCommand({
            commandId: randomUUID(),
            followUpId: randomUUID(),
            expectedRevision: projection.workspaceRevision,
            expectedPlanVersion: projection.planEntityVersion,
            expectedTermVersion: term.entityVersion,
            intent: {
                kind: 'workspace.reconcile-lifecycle',
                intentSchemaVersion: 1,
                payload: {
                    termId: term.termId,
                    evaluation: {
                        evaluatedAt,
                        termZone: term.timeZone,
                        applicableDate,
                    },
                },
            },
        });

        try {
            const committed = await this.dataState.store!.commit(command, this.options.commitOptions);
            this.dataState = {
                ...this.dataState,
                status: this.dataState.store!.status(),
            };
            if (!committed.ok) {
                return this.commitProblem(
                    committed.problem,
                    requestId,
                    '学期生命周期未更新，正式数据没有改变。',
                );
            }
            return null;
        }
        catch (error) {
            if (error instanceof CommittedCommandOutcomeUnknownError
                && error.commandId === command.commandId) {
                const receipt = await this.recoverCommittedReceipt(command.commandId);
                if (receipt?.effects[0]?.code === 'plan.term-auto-archived') {
                    return null;
                }
            }
            return this.problem(
                'recovery-required',
                '无法确认学期生命周期提交结果；请重新打开工作区后查询。',
                requestId,
                error instanceof CommittedCommandOutcomeUnknownError ? 'unknown' : 'unchanged',
            );
        }
    }

    private async createTerm(
        requestId: string,
        command: CreateTermRequest['command'],
    ): Promise<WorkspaceSetupOutcome> {
        return this.commitTermCommand(requestId, command, '当前学期未保存，正式数据没有改变。');
    }

    private async updateTermEndDate(
        requestId: string,
        command: UpdateTermEndDateRequest['command'],
    ): Promise<WorkspaceSetupOutcome> {
        return this.commitTermCommand(requestId, command, '学期结束日未更新，正式数据没有改变。');
    }

    private async restoreTermAsCurrent(
        requestId: string,
        command: RestoreTermAsCurrentRequest['command'],
    ): Promise<WorkspaceSetupOutcome> {
        if (!this.dataState.store) {
            const code = this.dataState.status.kind === 'recovery'
                ? 'recovery-required'
                : 'workspace-unavailable';
            return this.problem(code, '当前没有可写入的本地工作区。', requestId);
        }

        try {
            const projection = this.dataState.store.readSetupProjection();
            const term = projection.terms.find(candidate => (
                candidate.termId === command.intent.payload.termId
            ));
            if (!term) {
                return this.problem('validation', '要恢复的学期不存在，正式数据没有改变。', requestId);
            }
            const evaluatedAt = (this.options.clock ?? SYSTEM_CLOCK).now();
            const resolvedCommand = normalizeRestoreTermAsCurrentCommand({
                ...command,
                evaluation: {
                    evaluatedAt,
                    termZone: term.timeZone,
                    applicableDate: localDateInTermZone(evaluatedAt, term.timeZone),
                },
            });
            return this.commitTermCommand(
                requestId,
                resolvedCommand,
                '学期未恢复为当前学期，正式数据没有改变。',
            );
        }
        catch (error) {
            const code = error instanceof TypeError ? 'validation' : 'recovery-required';
            return this.problem(code, '学期未恢复为当前学期，正式数据没有改变。', requestId);
        }
    }

    private async commitTermCommand(
        requestId: string,
        command:
            | CreateTermRequest['command']
            | UpdateTermEndDateRequest['command']
            | RestoreTermAsCurrentCommand,
        unchangedMessage: string,
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
                return this.commitProblem(committed.problem, requestId, unchangedMessage);
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
            return this.problem(code, unchangedMessage, requestId);
        }
    }

    /**
     * Commits one HolidayRange transition through DATA and preserves receipt recovery.
     * @param {string} requestId - Workspace request correlation identity.
     * @param {CreateHolidayRangeCommand | UpdateHolidayRangeCommand | DeleteHolidayRangeCommand} command
     *     - Normalized HolidayRange command.
     * @return {Promise<WorkspaceSetupOutcome>} Committed result, warning, or structured problem.
     */
    private async commitHolidayRange(
        requestId: string,
        command:
            | CreateHolidayRangeRequest['command']
            | UpdateHolidayRangeRequest['command']
            | DeleteHolidayRangeRequest['command'],
    ): Promise<WorkspaceSetupOutcome> {
        if (!this.dataState.store) {
            const code = this.dataState.status.kind === 'recovery'
                ? 'recovery-required'
                : 'workspace-unavailable';
            return this.problem(code, '当前没有可写入的本地工作区。', requestId);
        }
        const expectedEffect = command.intent.kind === 'plan.create-holiday-range'
            ? 'plan.holiday-range-created' as const
            : command.intent.kind === 'plan.update-holiday-range'
                ? 'plan.holiday-range-updated' as const
                : 'plan.holiday-range-deleted' as const;

        try {
            const committed = await this.dataState.store.commit(command, this.options.commitOptions);
            this.dataState = {
                ...this.dataState,
                status: this.dataState.store.status(),
            };
            if (!committed.ok) {
                return this.commitProblem(
                    committed.problem,
                    requestId,
                    '假期范围未更改，正式数据没有改变。',
                    '假期变更会恢复有时间冲突的课节；确认继续后可保存。',
                );
            }
            return this.holidayRangeCommandOutcome(requestId, committed.value, expectedEffect);
        }
        catch (error) {
            if (error instanceof CommittedCommandOutcomeUnknownError
                && error.commandId === command.commandId) {
                const receipt = await this.recoverCommittedReceipt(command.commandId);
                if (receipt) {
                    return this.holidayRangeCommandOutcome(requestId, receipt, expectedEffect);
                }
                return this.problem(
                    'recovery-required',
                    '提交结果无法从持久回执确认；请重新打开工作区后查询。',
                    requestId,
                    'unknown',
                );
            }
            const code = error instanceof TypeError ? 'validation' : 'recovery-required';
            return this.problem(code, '假期范围未更改，正式数据没有改变。', requestId);
        }
    }

    /**
     * Commits one bounded one-time Task transition and recovers uncertain receipts.
     * @param {string} requestId - Workspace request correlation identity.
     * @param {CreateTaskRequest['command'] | UpdateTaskRequest['command']
     *     | DeleteTaskRequest['command'] | CompleteTaskRequest['command']
     *     | SetTaskOccurrenceStatusRequest['command'] | SetTaskProgressRequest['command']
     *     | ChangeTaskOccurrenceRequest['command'] | DeleteTaskOccurrenceOrSeriesRequest['command']
     *     | UndoTaskOccurrenceStateRequest['command']} command - Task command.
     * @return {Promise<WorkspaceSetupOutcome>} Committed result or structured problem.
     */
    private async commitTask(
        requestId: string,
        command:
            | CreateTaskRequest['command']
            | UpdateTaskRequest['command']
            | DeleteTaskRequest['command']
            | CompleteTaskRequest['command']
            | SetTaskOccurrenceStatusRequest['command']
            | SetTaskProgressRequest['command']
            | ChangeTaskOccurrenceRequest['command']
            | DeleteTaskOccurrenceOrSeriesRequest['command']
            | UndoTaskOccurrenceStateRequest['command'],
    ): Promise<WorkspaceSetupOutcome> {
        if (!this.dataState.store) {
            const code = this.dataState.status.kind === 'recovery'
                ? 'recovery-required'
                : 'workspace-unavailable';
            return this.problem(code, '当前没有可写入的本地工作区。', requestId);
        }
        const expectedEffect = command.intent.kind === 'plan.create-task-series'
            ? 'plan.task-series-created' as const
            : command.intent.kind === 'plan.update-task-series'
                ? 'plan.task-series-updated' as const
                : command.intent.kind === 'plan.delete-task-series'
                    ? 'plan.task-series-deleted' as const
                    : command.intent.kind === 'plan.set-task-progress'
                        ? 'plan.task-progress-set' as const
                        : command.intent.kind === 'plan.change-task-occurrence'
                            ? 'plan.task-occurrence-changed' as const
                        : command.intent.kind === 'plan.delete-task-occurrence-or-series'
                                ? command.intent.payload.scope === 'whole-series'
                                    ? 'plan.task-series-deleted' as const
                                    : 'plan.task-occurrence-deleted' as const
                                : command.intent.kind === 'plan.undo-task-occurrence-state'
                                    ? 'plan.task-occurrence-state-undone' as const
                                    : command.intent.intentSchemaVersion === 1
                                        ? 'plan.task-occurrence-completed' as const
                                        : 'plan.task-occurrence-status-set' as const;

        try {
            const committed = await this.dataState.store.commit(command, this.options.commitOptions);
            this.dataState = {
                ...this.dataState,
                status: this.dataState.store.status(),
            };
            if (!committed.ok) {
                return this.commitProblem(
                    committed.problem,
                    requestId,
                    '任务未更改，正式数据没有改变。',
                );
            }
            return this.taskCommandOutcome(requestId, committed.value, expectedEffect);
        }
        catch (error) {
            if (error instanceof CommittedCommandOutcomeUnknownError
                && error.commandId === command.commandId) {
                const receipt = await this.recoverCommittedReceipt(command.commandId);
                if (receipt) {
                    return this.taskCommandOutcome(requestId, receipt, expectedEffect);
                }
                return this.problem(
                    'recovery-required',
                    '提交结果无法从持久回执确认；请重新打开工作区后查询。',
                    requestId,
                    'unknown',
                );
            }
            const code = error instanceof TypeError ? 'validation' : 'recovery-required';
            return this.problem(code, '任务未更改，正式数据没有改变。', requestId);
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
                return this.commitProblem(
                    committed.problem,
                    requestId,
                    '课程与首个课节未保存，正式数据没有改变。',
                    '检测到课节时间重叠；确认继续后可按原时间保存。',
                );
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

    /**
     * Commits a scoped Meeting occurrence mutation and preserves receipt recovery semantics.
     * @param {string} requestId - Request correlation identity.
     * @param {ChangeMeetingOccurrenceCommand | CancelMeetingOccurrenceCommand} command - Versioned mutation.
     * @return {Promise<WorkspaceSetupOutcome>} Committed outcome or structured problem.
     */
    private async commitMeetingOccurrence(
        requestId: string,
        command: ChangeMeetingOccurrenceRequest['command'] | CancelMeetingOccurrenceRequest['command'],
    ): Promise<WorkspaceSetupOutcome> {
        if (!this.dataState.store) {
            const code = this.dataState.status.kind === 'recovery'
                ? 'recovery-required'
                : 'workspace-unavailable';
            return this.problem(code, '当前没有可写入的本地工作区。', requestId);
        }
        const expectedEffect = command.intent.kind === 'plan.cancel-meeting-occurrence'
            ? 'plan.meeting-occurrence-cancelled'
            : 'plan.meeting-occurrence-changed';

        try {
            const committed = await this.dataState.store.commit(command, this.options.commitOptions);
            this.dataState = {
                ...this.dataState,
                status: this.dataState.store.status(),
            };
            if (!committed.ok) {
                return this.commitProblem(
                    committed.problem,
                    requestId,
                    '课节实例未更改，正式数据没有改变。',
                    '检测到课节时间重叠；确认继续后可按原时间保存。',
                );
            }
            return this.meetingOccurrenceCommandOutcome(requestId, committed.value, expectedEffect);
        }
        catch (error) {
            if (error instanceof CommittedCommandOutcomeUnknownError
                && error.commandId === command.commandId) {
                const receipt = await this.recoverCommittedReceipt(command.commandId);
                if (receipt) {
                    return this.meetingOccurrenceCommandOutcome(requestId, receipt, expectedEffect);
                }
                return this.problem(
                    'recovery-required',
                    '提交结果无法从持久回执确认；请重新打开工作区后查询。',
                    requestId,
                    'unknown',
                );
            }
            const code = error instanceof TypeError ? 'validation' : 'recovery-required';
            return this.problem(code, '课节实例未更改，正式数据没有改变。', requestId);
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
            || (effect.code !== 'plan.term-created-current'
                && effect.code !== 'plan.term-end-date-updated'
                && effect.code !== 'plan.term-restored-current')
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

    /**
     * Maps one exact durable HolidayRange effect into the Workspace command outcome.
     * @param {string} requestId - Workspace request correlation identity.
     * @param {CommandReceiptOutcome} committed - Durable DATA receipt outcome.
     * @param {string} expectedEffect - Exact lifecycle effect required by the request.
     * @return {WorkspaceSetupOutcome} Validated command outcome or recovery problem.
     */
    private holidayRangeCommandOutcome(
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
            return this.problem(
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
                appBuildId: this.appBuildId,
                requestId,
                workspaceEpoch: this.workspaceEpoch,
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
    private taskCommandOutcome(
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
            return this.problem(
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

    /**
     * Validates and maps a durable Meeting occurrence receipt into the Workspace contract.
     * @param {string} requestId - Request correlation identity.
     * @param {CommandReceiptOutcome} committed - Durable DATA receipt outcome.
     * @param {'plan.meeting-occurrence-changed' | 'plan.meeting-occurrence-cancelled'} expectedEffect - Intent effect.
     * @return {WorkspaceSetupOutcome} Exact Workspace command outcome or recovery problem.
     */
    private meetingOccurrenceCommandOutcome(
        requestId: string,
        committed: CommandReceiptOutcome,
        expectedEffect: 'plan.meeting-occurrence-changed' | 'plan.meeting-occurrence-cancelled',
    ): WorkspaceSetupOutcome {
        const effect = committed.effects[0];
        if (committed.effects.length !== 1
            || effect.code !== expectedEffect
            || effect.entity.kind !== 'meeting-series') {
            return this.problem(
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
                appBuildId: this.appBuildId,
                requestId,
                workspaceEpoch: this.workspaceEpoch,
                outcome,
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
    private commitProblem(
        problem: DataCommitProblem,
        requestId: string,
        unchangedMessage: string,
        overlapMessage?: string,
    ): WorkspaceSetupOutcome {
        if (problem.code === 'decision-required'
            && problem.details.reason === 'meeting-time-overlap'
            && overlapMessage !== undefined) {
            return this.problem(
                'decision-required',
                overlapMessage,
                requestId,
                'unchanged',
                problem.details,
            );
        }
        if (problem.code === 'operation-in-progress') {
            return this.problem(
                'operation-in-progress',
                '另一个写入正在完成；请重试，正式数据没有改变。',
                requestId,
                'unchanged',
                problem.details,
            );
        }
        return this.problem(problem.code, unchangedMessage, requestId);
    }

    private problem(
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
                appBuildId: this.appBuildId,
                workspaceEpoch: this.workspaceEpoch,
                dataEffect,
                ...(details === undefined ? {} : { details }),
            },
        };
    }
}
