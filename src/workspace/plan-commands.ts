import { openWorkspaceDataWithMigrations } from '../data/store/open';
import { CommittedCommandOutcomeUnknownError } from '../data/store/types';
import type { CommandReceiptOutcome } from '../data/store/types';
import { WorkspaceSetupOutcome } from '../shared/workspace-setup-contract';
import type { CancelMeetingOccurrenceRequest, ChangeMeetingOccurrenceRequest, ChangeTaskOccurrenceRequest, CompleteTaskRequest, CreateCourseRequest, CreateCourseWithMeetingRequest, CreateHolidayRangeRequest, CreateMeetingSeriesRequest, CreateTaskRequest, CreateTermRequest, DeleteHolidayRangeRequest, DeleteTaskOccurrenceOrSeriesRequest, DeleteTaskRequest, RestoreTermAsCurrentRequest, SetTaskOccurrenceStatusRequest, SetTaskProgressRequest, UndoTaskOccurrenceStateRequest, UpdateHolidayRangeRequest, UpdateTaskRequest, UpdateTermEndDateRequest } from '../shared/workspace-setup-contract';
import { localDateInTermZone, normalizeRestoreTermAsCurrentCommand } from '../shared/workspace-term-contract';
import type { RestoreTermAsCurrentCommand } from '../shared/workspace-term-contract';
import { SYSTEM_CLOCK, dataStateFrom, migrationOpenOptions } from './host';
import type { WorkspaceHost } from './host';
import { commitProblem, courseCommandOutcome, holidayRangeCommandOutcome, meetingOccurrenceCommandOutcome, problem, singleCreationCommandOutcome, taskCommandOutcome, termCommandOutcome } from './outcomes';
export async function createTerm(host: WorkspaceHost, 
    requestId: string,
    command: CreateTermRequest['command'],
): Promise<WorkspaceSetupOutcome> {
    return commitTermCommand(host, requestId, command, '当前学期未保存，正式数据没有改变。');
}

export async function updateTermEndDate(host: WorkspaceHost, 
    requestId: string,
    command: UpdateTermEndDateRequest['command'],
): Promise<WorkspaceSetupOutcome> {
    return commitTermCommand(host, requestId, command, '学期结束日未更新，正式数据没有改变。');
}

export async function restoreTermAsCurrent(host: WorkspaceHost, 
    requestId: string,
    command: RestoreTermAsCurrentRequest['command'],
): Promise<WorkspaceSetupOutcome> {
    const openedStore = host.dataState().store;
    if (!openedStore) {
        const code = host.dataState().status.kind === 'recovery'
            ? 'recovery-required'
            : 'workspace-unavailable';
        return problem(host, code, '当前没有可写入的本地工作区。', requestId);
    }

    try {
        const projection = openedStore.readSetupProjection();
        const term = projection.terms.find(candidate => (
            candidate.termId === command.intent.payload.termId
        ));
        if (!term) {
            return problem(host, 'validation', '要恢复的学期不存在，正式数据没有改变。', requestId);
        }
        const evaluatedAt = (host.options.clock ?? SYSTEM_CLOCK).now();
        const resolvedCommand = normalizeRestoreTermAsCurrentCommand({
            ...command,
            evaluation: {
                evaluatedAt,
                termZone: term.timeZone,
                applicableDate: localDateInTermZone(evaluatedAt, term.timeZone),
            },
        });
        return commitTermCommand(host,
            requestId,
            resolvedCommand,
            '学期未恢复为当前学期，正式数据没有改变。',
        );
    }
    catch (error) {
        const code = error instanceof TypeError ? 'validation' : 'recovery-required';
        return problem(host, code, '学期未恢复为当前学期，正式数据没有改变。', requestId);
    }
}

export async function commitTermCommand(host: WorkspaceHost, 
    requestId: string,
    command:
        | CreateTermRequest['command']
        | UpdateTermEndDateRequest['command']
        | RestoreTermAsCurrentCommand,
    unchangedMessage: string,
): Promise<WorkspaceSetupOutcome> {
    const openedStore = host.dataState().store;
    if (!openedStore) {
        const code = host.dataState().status.kind === 'recovery'
            ? 'recovery-required'
            : 'workspace-unavailable';
        return problem(host, code, '当前没有可写入的本地工作区。', requestId);
    }

    try {
        const committed = await openedStore.commit(command, host.options.commitOptions);
        host.setDataState({
            ...host.dataState(),
            status: openedStore.status(),
        });
        if (!committed.ok) {
            return commitProblem(host, committed.problem, requestId, unchangedMessage);
        }
        return termCommandOutcome(host, requestId, committed.value);
    }
    catch (error) {
        if (error instanceof CommittedCommandOutcomeUnknownError
            && error.commandId === command.commandId) {
            const receipt = await recoverCommittedReceipt(host, command.commandId);
            if (receipt) {
                return termCommandOutcome(host, requestId, receipt);
            }
            return problem(host,
                'recovery-required',
                '提交结果无法从持久回执确认；请重新打开工作区后查询。',
                requestId,
                'unknown',
            );
        }
        const code = error instanceof TypeError ? 'validation' : 'recovery-required';
        return problem(host, code, unchangedMessage, requestId);
    }
}

/**
 * Commits one HolidayRange transition through DATA and preserves receipt recovery.
 * @param {string} requestId - Workspace request correlation identity.
 * @param {CreateHolidayRangeCommand | UpdateHolidayRangeCommand | DeleteHolidayRangeCommand} command
 *     - Normalized HolidayRange command.
 * @return {Promise<WorkspaceSetupOutcome>} Committed result, warning, or structured problem.
 */
export async function commitHolidayRange(host: WorkspaceHost, 
    requestId: string,
    command:
        | CreateHolidayRangeRequest['command']
        | UpdateHolidayRangeRequest['command']
        | DeleteHolidayRangeRequest['command'],
): Promise<WorkspaceSetupOutcome> {
    const openedStore = host.dataState().store;
    if (!openedStore) {
        const code = host.dataState().status.kind === 'recovery'
            ? 'recovery-required'
            : 'workspace-unavailable';
        return problem(host, code, '当前没有可写入的本地工作区。', requestId);
    }
    const expectedEffect = command.intent.kind === 'plan.create-holiday-range'
        ? 'plan.holiday-range-created' as const
        : command.intent.kind === 'plan.update-holiday-range'
            ? 'plan.holiday-range-updated' as const
            : 'plan.holiday-range-deleted' as const;

    try {
        const committed = await openedStore.commit(command, host.options.commitOptions);
        host.setDataState({
            ...host.dataState(),
            status: openedStore.status(),
        });
        if (!committed.ok) {
            return commitProblem(host,
                committed.problem,
                requestId,
                '假期范围未更改，正式数据没有改变。',
                '假期变更会恢复有时间冲突的课节；确认继续后可保存。',
            );
        }
        return holidayRangeCommandOutcome(host, requestId, committed.value, expectedEffect);
    }
    catch (error) {
        if (error instanceof CommittedCommandOutcomeUnknownError
            && error.commandId === command.commandId) {
            const receipt = await recoverCommittedReceipt(host, command.commandId);
            if (receipt) {
                return holidayRangeCommandOutcome(host, requestId, receipt, expectedEffect);
            }
            return problem(host,
                'recovery-required',
                '提交结果无法从持久回执确认；请重新打开工作区后查询。',
                requestId,
                'unknown',
            );
        }
        const code = error instanceof TypeError ? 'validation' : 'recovery-required';
        return problem(host, code, '假期范围未更改，正式数据没有改变。', requestId);
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
export async function commitTask(host: WorkspaceHost, 
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
    const openedStore = host.dataState().store;
    if (!openedStore) {
        const code = host.dataState().status.kind === 'recovery'
            ? 'recovery-required'
            : 'workspace-unavailable';
        return problem(host, code, '当前没有可写入的本地工作区。', requestId);
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
        const committed = await openedStore.commit(command, host.options.commitOptions);
        host.setDataState({
            ...host.dataState(),
            status: openedStore.status(),
        });
        if (!committed.ok) {
            return commitProblem(host,
                committed.problem,
                requestId,
                '任务未更改，正式数据没有改变。',
            );
        }
        return taskCommandOutcome(host, requestId, committed.value, expectedEffect);
    }
    catch (error) {
        if (error instanceof CommittedCommandOutcomeUnknownError
            && error.commandId === command.commandId) {
            const receipt = await recoverCommittedReceipt(host, command.commandId);
            if (receipt) {
                return taskCommandOutcome(host, requestId, receipt, expectedEffect);
            }
            return problem(host,
                'recovery-required',
                '提交结果无法从持久回执确认；请重新打开工作区后查询。',
                requestId,
                'unknown',
            );
        }
        const code = error instanceof TypeError ? 'validation' : 'recovery-required';
        return problem(host, code, '任务未更改，正式数据没有改变。', requestId);
    }
}

export async function createCourse(host: WorkspaceHost, 
    requestId: string,
    command: CreateCourseRequest['command'],
): Promise<WorkspaceSetupOutcome> {
    const openedStore = host.dataState().store;
    if (!openedStore) {
        const code = host.dataState().status.kind === 'recovery'
            ? 'recovery-required'
            : 'workspace-unavailable';
        return problem(host, code, '当前没有可写入的本地工作区。', requestId);
    }
    try {
        const committed = await openedStore.commit(command, host.options.commitOptions);
        host.setDataState({ ...host.dataState(), status: openedStore.status() });
        if (!committed.ok) {
            return commitProblem(host, committed.problem, requestId, '课程未保存，正式数据没有改变。');
        }
        return singleCreationCommandOutcome(host,
            requestId,
            committed.value,
            'plan.course-created',
            'course',
        );
    }
    catch (error) {
        if (error instanceof CommittedCommandOutcomeUnknownError
            && error.commandId === command.commandId) {
            const receipt = await recoverCommittedReceipt(host, command.commandId);
            if (receipt) {
                return singleCreationCommandOutcome(host,
                    requestId,
                    receipt,
                    'plan.course-created',
                    'course',
                );
            }
            return problem(host,
                'recovery-required',
                '提交结果无法从持久回执确认；请重新打开工作区后查询。',
                requestId,
                'unknown',
            );
        }
        const code = error instanceof TypeError ? 'validation' : 'recovery-required';
        return problem(host, code, '课程未保存，正式数据没有改变。', requestId);
    }
}

export async function createMeetingSeries(host: WorkspaceHost, 
    requestId: string,
    command: CreateMeetingSeriesRequest['command'],
): Promise<WorkspaceSetupOutcome> {
    const openedStore = host.dataState().store;
    if (!openedStore) {
        const code = host.dataState().status.kind === 'recovery'
            ? 'recovery-required'
            : 'workspace-unavailable';
        return problem(host, code, '当前没有可写入的本地工作区。', requestId);
    }
    try {
        const committed = await openedStore.commit(command, host.options.commitOptions);
        host.setDataState({ ...host.dataState(), status: openedStore.status() });
        if (!committed.ok) {
            return commitProblem(host,
                committed.problem,
                requestId,
                '课节未保存，正式数据没有改变。',
                '检测到课节时间重叠；确认继续后可按原时间保存。',
            );
        }
        return singleCreationCommandOutcome(host,
            requestId,
            committed.value,
            'plan.meeting-series-created',
            'meeting-series',
        );
    }
    catch (error) {
        if (error instanceof CommittedCommandOutcomeUnknownError
            && error.commandId === command.commandId) {
            const receipt = await recoverCommittedReceipt(host, command.commandId);
            if (receipt) {
                return singleCreationCommandOutcome(host,
                    requestId,
                    receipt,
                    'plan.meeting-series-created',
                    'meeting-series',
                );
            }
            return problem(host,
                'recovery-required',
                '提交结果无法从持久回执确认；请重新打开工作区后查询。',
                requestId,
                'unknown',
            );
        }
        const code = error instanceof TypeError ? 'validation' : 'recovery-required';
        return problem(host, code, '课节未保存，正式数据没有改变。', requestId);
    }
}

export async function createCourseWithMeeting(host: WorkspaceHost, 
    requestId: string,
    command: CreateCourseWithMeetingRequest['command'],
): Promise<WorkspaceSetupOutcome> {
    const openedStore = host.dataState().store;
    if (!openedStore) {
        const code = host.dataState().status.kind === 'recovery'
            ? 'recovery-required'
            : 'workspace-unavailable';
        return problem(host, code, '当前没有可写入的本地工作区。', requestId);
    }

    try {
        const committed = await openedStore.commit(command, host.options.commitOptions);
        host.setDataState({
            ...host.dataState(),
            status: openedStore.status(),
        });
        if (!committed.ok) {
            return commitProblem(host,
                committed.problem,
                requestId,
                '课程与首个课节未保存，正式数据没有改变。',
                '检测到课节时间重叠；确认继续后可按原时间保存。',
            );
        }
        return courseCommandOutcome(host, requestId, committed.value);
    }
    catch (error) {
        if (error instanceof CommittedCommandOutcomeUnknownError
            && error.commandId === command.commandId) {
            const receipt = await recoverCommittedReceipt(host, command.commandId);
            if (receipt) {
                return courseCommandOutcome(host, requestId, receipt);
            }
            return problem(host,
                'recovery-required',
                '提交结果无法从持久回执确认；请重新打开工作区后查询。',
                requestId,
                'unknown',
            );
        }
        const code = error instanceof TypeError ? 'validation' : 'recovery-required';
        return problem(host, code, '课程与首个课节未保存，正式数据没有改变。', requestId);
    }
}

/**
 * Commits a scoped Meeting occurrence mutation and preserves receipt recovery semantics.
 * @param {string} requestId - Request correlation identity.
 * @param {ChangeMeetingOccurrenceCommand | CancelMeetingOccurrenceCommand} command - Versioned mutation.
 * @return {Promise<WorkspaceSetupOutcome>} Committed outcome or structured problem.
 */
export async function commitMeetingOccurrence(host: WorkspaceHost, 
    requestId: string,
    command: ChangeMeetingOccurrenceRequest['command'] | CancelMeetingOccurrenceRequest['command'],
): Promise<WorkspaceSetupOutcome> {
    const openedStore = host.dataState().store;
    if (!openedStore) {
        const code = host.dataState().status.kind === 'recovery'
            ? 'recovery-required'
            : 'workspace-unavailable';
        return problem(host, code, '当前没有可写入的本地工作区。', requestId);
    }
    const expectedEffect = command.intent.kind === 'plan.cancel-meeting-occurrence'
        ? 'plan.meeting-occurrence-cancelled'
        : 'plan.meeting-occurrence-changed';

    try {
        const committed = await openedStore.commit(command, host.options.commitOptions);
        host.setDataState({
            ...host.dataState(),
            status: openedStore.status(),
        });
        if (!committed.ok) {
            return commitProblem(host,
                committed.problem,
                requestId,
                '课节实例未更改，正式数据没有改变。',
                '检测到课节时间重叠；确认继续后可按原时间保存。',
            );
        }
        return meetingOccurrenceCommandOutcome(host, requestId, committed.value, expectedEffect);
    }
    catch (error) {
        if (error instanceof CommittedCommandOutcomeUnknownError
            && error.commandId === command.commandId) {
            const receipt = await recoverCommittedReceipt(host, command.commandId);
            if (receipt) {
                return meetingOccurrenceCommandOutcome(host, requestId, receipt, expectedEffect);
            }
            return problem(host,
                'recovery-required',
                '提交结果无法从持久回执确认；请重新打开工作区后查询。',
                requestId,
                'unknown',
            );
        }
        const code = error instanceof TypeError ? 'validation' : 'recovery-required';
        return problem(host, code, '课节实例未更改，正式数据没有改变。', requestId);
    }
}

export async function recoverCommittedReceipt(host: WorkspaceHost, commandId: string): Promise<CommandReceiptOutcome | null> {
    try {
        const reopened = await openWorkspaceDataWithMigrations(
            host.dataSlotsRoot,
            migrationOpenOptions(host.appBuildId, host.options),
        );
        host.setDataState(dataStateFrom(reopened));
        return host.dataState().store?.receipt(commandId) ?? null;
    }
    catch {
        return null;
    }
}
