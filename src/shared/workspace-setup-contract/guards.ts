import { BOOTSTRAP_PROTOCOL_VERSION } from '../bootstrap-contract';
import { isCanonicalInstant } from '../meeting-time';
import { CourseProjection, MAX_MEETING_OVERLAP_WARNINGS, normalizeAcceptedCreateCourseWithMeetingCommand, normalizeCancelMeetingOccurrenceCommand, normalizeCreateCourseCommand, normalizeCreateMeetingSeriesCommand, normalizeMeetingOccurrenceImpactDraft } from '../workspace-course-contract';
import { isCourseProjection, isMeetingOccurrenceImpactProjection, isMeetingOccurrenceWindow, isMeetingOverlapWarning, isMeetingSeriesDetailProjection } from '../workspace-course-contract/guards';
import { normalizeChangeMeetingOccurrenceCommand } from '../workspace-course-contract/makers';
import { isCanonicalUnsignedSqliteInteger, isCanonicalUuid } from '../workspace-data-contract';
import { HolidayRangeProjection, isHolidayRangeProjection, normalizeCreateHolidayRangeCommand, normalizeDeleteHolidayRangeCommand, normalizeUpdateHolidayRangeCommand } from '../workspace-holiday-contract';
import { isWorkspaceMigrationRequest, isWorkspaceMigrationSuccessValue } from '../workspace-migration-contract';
import { isPlanProjection } from '../workspace-plan-contract/guards';
import { isDataProtectionProjection, isRestoreSessionView, normalizeCancelRestoreSessionCommand, normalizeConfigureBackupDestinationCommand, normalizeConfirmRestoreSessionCommand, normalizeResumeRestoreSessionCommand, normalizeRollbackRestoreSessionCommand, normalizeStartRestoreSessionCommand } from '../workspace-protection-contract';
import { WorkspaceSetupOutcome } from '../workspace-setup-contract';
import type { WorkspaceCommandResult, WorkspaceProcessRequest, WorkspaceSetupRequest } from '../workspace-setup-contract';
import { normalizeRestoreTermAsCurrentRequestCommand } from './makers';
import { hasExactDataKeys, sameTermProjection } from './types';
import type { WorkspaceCommandEffect } from './types';
import { TaskProjection, isTaskOccurrenceWindow, normalizeChangeTaskOccurrenceCommand, normalizeCompleteTaskCommand, normalizeCreateTaskCommand, normalizeDeleteTaskCommand, normalizeDeleteTaskOccurrenceOrSeriesCommand, normalizeSetTaskOccurrenceStatusCommand, normalizeSetTaskProgressCommand, normalizeTaskOccurrenceImpactDraft, normalizeUndoTaskOccurrenceStateCommand, normalizeUpdateTaskCommand } from '../workspace-task-contract';
import { isTaskOccurrenceImpactProjection, isTaskProjection, isTaskSeriesDetailProjection } from '../workspace-task-contract/guards';
import { MAX_SETUP_DRAFT_PAYLOAD_BYTES, SETUP_DRAFT_SCHEMA_VERSION, SetupDraftCheckpoint, SetupProjection, TermProjection, isCanonicalLocalDate, normalizeCreateTermCommand, normalizeUpdateTermEndDateCommand } from '../workspace-term-contract';
export function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

/**
 * Accepts JSON syntax within the first-setup draft byte boundary without interpreting Shell fields.
 * @param {unknown} value - Candidate opaque payload.
 * @return {boolean} Whether the payload is bounded JSON text.
 */
export function isSetupDraftPayload(value: unknown): value is string {
    if (typeof value !== 'string'
        || new TextEncoder().encode(value).byteLength > MAX_SETUP_DRAFT_PAYLOAD_BYTES) {
        return false;
    }
    try {
        JSON.parse(value);
        return true;
    }
    catch {
        return false;
    }
}

/**
 * Validates the exact Workspace projection envelope around a Shell-owned setup draft.
 * @param {unknown} value - Candidate checkpoint projection.
 * @return {boolean} Whether the checkpoint matches the supported version.
 */
export function isSetupDraftCheckpoint(value: unknown): value is SetupDraftCheckpoint {
    return hasExactDataKeys(value, [
        'draftId',
        'kind',
        'scope',
        'schemaVersion',
        'updatedAt',
        'opaquePayload',
    ])
        && value.draftId === 'first-setup'
        && value.kind === 'first-setup'
        && value.scope === 'setup-step'
        && value.schemaVersion === SETUP_DRAFT_SCHEMA_VERSION
        && isCanonicalInstant(value.updatedAt)
        && isSetupDraftPayload(value.opaquePayload);
}

export function isRequestBase(value: Record<string, unknown>): boolean {
    return value.protocolVersion === BOOTSTRAP_PROTOCOL_VERSION
        && typeof value.appBuildId === 'string'
        && value.appBuildId.length > 0
        && typeof value.requestId === 'string'
        && value.requestId.length > 0
        && isCanonicalUuid(value.workspaceEpoch);
}

export function isWorkspaceSetupRequest(
    value: unknown,
    expectedBuildId: string,
    expectedWorkspaceEpoch: string,
): value is WorkspaceSetupRequest {
    if (isWorkspaceMigrationRequest(value, expectedBuildId, expectedWorkspaceEpoch)) {
        return true;
    }
    if (!isPlainObject(value)
        || value.appBuildId !== expectedBuildId
        || value.workspaceEpoch !== expectedWorkspaceEpoch
        || !isRequestBase(value)) {
        return false;
    }

    if (value.kind === 'workspace.plan.query') {
        // The Calendar may ask for an explicit week; every other fact still comes
        // from the same single evaluation, so this is the only optional key.
        const planQueryWindow = value.requestedWindow;
        return hasExactDataKeys(value, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
        ])
            || (hasExactDataKeys(value, [
                'kind',
                'protocolVersion',
                'appBuildId',
                'requestId',
                'workspaceEpoch',
                'requestedWindow',
            ]) && isMeetingOccurrenceWindow(planQueryWindow));
    }
    if (value.kind === 'workspace.initialize'
        || value.kind === 'workspace.setup.query'
        || value.kind === 'workspace.protection.query') {
        return hasExactDataKeys(value, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
        ]);
    }
    if (value.kind === 'workspace.setup-draft.save') {
        return hasExactDataKeys(value, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
            'input',
        ])
            && hasExactDataKeys(value.input, ['expectedVersion', 'schemaVersion', 'opaquePayload'])
            && isCanonicalUnsignedSqliteInteger(value.input.expectedVersion)
            && value.input.schemaVersion === SETUP_DRAFT_SCHEMA_VERSION
            && isSetupDraftPayload(value.input.opaquePayload);
    }
    if (value.kind === 'workspace.setup-draft.discard') {
        return hasExactDataKeys(value, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
            'expectedVersion',
        ]) && isCanonicalUnsignedSqliteInteger(value.expectedVersion);
    }
    if (value.kind === 'workspace.restore.query') {
        return hasExactDataKeys(value, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
            'restoreSessionId',
        ]) && isCanonicalUuid(value.restoreSessionId);
    }
    if (value.kind === 'workspace.meeting-series.query') {
        return hasExactDataKeys(value, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
            'meetingSeriesId',
            'requestedWindow',
        ])
            && isCanonicalUuid(value.meetingSeriesId)
            && isMeetingOccurrenceWindow(value.requestedWindow);
    }
    if (value.kind === 'workspace.task-series.query') {
        return hasExactDataKeys(value, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
            'taskSeriesId',
            'requestedWindow',
        ])
            && isCanonicalUuid(value.taskSeriesId)
            && isTaskOccurrenceWindow(value.requestedWindow);
    }
    if (value.kind === 'workspace.task-occurrence.preview') {
        if (!hasExactDataKeys(value, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
            'draft',
        ])) {
            return false;
        }
        try {
            normalizeTaskOccurrenceImpactDraft(value.draft);
            return true;
        }
        catch {
            return false;
        }
    }
    if (value.kind === 'workspace.meeting-occurrence.preview') {
        if (!hasExactDataKeys(value, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
            'draft',
        ])) {
            return false;
        }
        try {
            normalizeMeetingOccurrenceImpactDraft(value.draft);
            return true;
        }
        catch {
            return false;
        }
    }
    if ((value.kind !== 'workspace.term.create'
            && value.kind !== 'workspace.term.update-end-date'
            && value.kind !== 'workspace.term.restore-as-current'
            && value.kind !== 'workspace.holiday-range.create'
            && value.kind !== 'workspace.holiday-range.update'
            && value.kind !== 'workspace.holiday-range.delete'
            && value.kind !== 'workspace.task.create'
            && value.kind !== 'workspace.task.update'
            && value.kind !== 'workspace.task.delete'
            && value.kind !== 'workspace.task.complete'
            && value.kind !== 'workspace.task.set-occurrence-status'
            && value.kind !== 'workspace.task.set-progress'
            && value.kind !== 'workspace.task.change-occurrence'
            && value.kind !== 'workspace.task.delete-occurrence-or-series'
            && value.kind !== 'workspace.task.undo-occurrence-state'
            && value.kind !== 'workspace.course.create'
            && value.kind !== 'workspace.meeting-series.create'
            && value.kind !== 'workspace.course.create-with-first-meeting'
            && value.kind !== 'workspace.meeting-occurrence.change'
            && value.kind !== 'workspace.meeting-occurrence.cancel'
            && value.kind !== 'workspace.restore.start'
            && value.kind !== 'workspace.restore.confirm'
            && value.kind !== 'workspace.restore.cancel'
            && value.kind !== 'workspace.restore.resume'
            && value.kind !== 'workspace.restore.rollback'
            && value.kind !== 'workspace.protection.configure')
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
        if (value.kind === 'workspace.protection.configure') {
            normalizeConfigureBackupDestinationCommand(value.command);
        }
        else if (value.kind === 'workspace.restore.start') {
            normalizeStartRestoreSessionCommand(value.command);
        }
        else if (value.kind === 'workspace.restore.confirm') {
            normalizeConfirmRestoreSessionCommand(value.command);
        }
        else if (value.kind === 'workspace.restore.cancel') {
            normalizeCancelRestoreSessionCommand(value.command);
        }
        else if (value.kind === 'workspace.restore.resume') {
            normalizeResumeRestoreSessionCommand(value.command);
        }
        else if (value.kind === 'workspace.restore.rollback') {
            normalizeRollbackRestoreSessionCommand(value.command);
        }
        else if (value.kind === 'workspace.term.create') {
            normalizeCreateTermCommand(value.command);
        }
        else if (value.kind === 'workspace.term.update-end-date') {
            normalizeUpdateTermEndDateCommand(value.command);
        }
        else if (value.kind === 'workspace.term.restore-as-current') {
            normalizeRestoreTermAsCurrentRequestCommand(value.command);
        }
        else if (value.kind === 'workspace.holiday-range.create') {
            normalizeCreateHolidayRangeCommand(value.command);
        }
        else if (value.kind === 'workspace.holiday-range.update') {
            normalizeUpdateHolidayRangeCommand(value.command);
        }
        else if (value.kind === 'workspace.holiday-range.delete') {
            normalizeDeleteHolidayRangeCommand(value.command);
        }
        else if (value.kind === 'workspace.task.create') {
            normalizeCreateTaskCommand(value.command);
        }
        else if (value.kind === 'workspace.task.update') {
            normalizeUpdateTaskCommand(value.command);
        }
        else if (value.kind === 'workspace.task.delete') {
            normalizeDeleteTaskCommand(value.command);
        }
        else if (value.kind === 'workspace.task.complete') {
            normalizeCompleteTaskCommand(value.command);
        }
        else if (value.kind === 'workspace.task.set-occurrence-status') {
            normalizeSetTaskOccurrenceStatusCommand(value.command);
        }
        else if (value.kind === 'workspace.task.set-progress') {
            normalizeSetTaskProgressCommand(value.command);
        }
        else if (value.kind === 'workspace.task.change-occurrence') {
            normalizeChangeTaskOccurrenceCommand(value.command);
        }
        else if (value.kind === 'workspace.task.delete-occurrence-or-series') {
            normalizeDeleteTaskOccurrenceOrSeriesCommand(value.command);
        }
        else if (value.kind === 'workspace.task.undo-occurrence-state') {
            normalizeUndoTaskOccurrenceStateCommand(value.command);
        }
        else if (value.kind === 'workspace.course.create') {
            normalizeCreateCourseCommand(value.command);
        }
        else if (value.kind === 'workspace.meeting-series.create') {
            normalizeCreateMeetingSeriesCommand(value.command);
        }
        else if (value.kind === 'workspace.course.create-with-first-meeting') {
            normalizeAcceptedCreateCourseWithMeetingCommand(value.command);
        }
        else if (value.kind === 'workspace.meeting-occurrence.change') {
            normalizeChangeMeetingOccurrenceCommand(value.command);
        }
        else {
            normalizeCancelMeetingOccurrenceCommand(value.command);
        }
        return true;
    }
    catch {
        return false;
    }
}

/**
 * Validates requests accepted by the Workspace utility process after Main adaptation.
 * @param {unknown} value - Candidate process request.
 * @param {string} expectedBuildId - Active application build identity.
 * @param {string} expectedWorkspaceEpoch - Active Workspace process epoch.
 * @return {boolean} Whether the request is safe for Workspace dispatch.
 */
export function isWorkspaceProcessRequest(
    value: unknown,
    expectedBuildId: string,
    expectedWorkspaceEpoch: string,
): value is WorkspaceProcessRequest {
    if (isWorkspaceSetupRequest(value, expectedBuildId, expectedWorkspaceEpoch)) {
        return value.kind !== 'workspace.protection.configure';
    }
    if (!isPlainObject(value)
        || value.kind !== 'workspace.protection.configure-selected'
        || value.appBuildId !== expectedBuildId
        || value.workspaceEpoch !== expectedWorkspaceEpoch
        || !isRequestBase(value)
        || !hasExactDataKeys(value, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
            'command',
            'selectedDirectoryPath',
        ])
        || typeof value.selectedDirectoryPath !== 'string'
        || value.selectedDirectoryPath.length === 0
        || value.selectedDirectoryPath.length > 32_767
        || value.selectedDirectoryPath.includes('\0')) {
        return false;
    }
    try {
        normalizeConfigureBackupDestinationCommand(value.command);
        return true;
    }
    catch {
        return false;
    }
}

export function isTermProjection(value: unknown): boolean {
    return hasExactDataKeys(value, [
        'termId',
        'name',
        'startDate',
        'endDate',
        'timeZone',
        'archived',
        'entityVersion',
    ])
        && isCanonicalUuid(value.termId)
        && typeof value.name === 'string'
        && typeof value.startDate === 'string'
        && typeof value.endDate === 'string'
        && typeof value.timeZone === 'string'
        && typeof value.archived === 'boolean'
        && isCanonicalUnsignedSqliteInteger(value.entityVersion);
}

export function isSetupProjection(value: unknown): boolean {
    if (!hasExactDataKeys(value, [
        'workspaceRevision',
        'planEntityVersion',
        'minimum',
        'everReachedMinimum',
        'defaultRoute',
        'draftCheckpointVersion',
        'draftCheckpoint',
        'currentTerm',
        'terms',
        'courses',
        'holidayRanges',
        'tasks',
    ])
        || !isCanonicalUnsignedSqliteInteger(value.workspaceRevision)
        || !isCanonicalUnsignedSqliteInteger(value.planEntityVersion)
        || !hasExactDataKeys(value.minimum, [
            'hasCurrentTerm',
            'hasCurrentTermCourse',
            'hasMeetingOrTask',
            'isSatisfied',
        ])
        || typeof value.minimum.hasCurrentTerm !== 'boolean'
        || typeof value.minimum.hasCurrentTermCourse !== 'boolean'
        || typeof value.minimum.hasMeetingOrTask !== 'boolean'
        || typeof value.minimum.isSatisfied !== 'boolean'
        || typeof value.everReachedMinimum !== 'boolean'
        || (value.defaultRoute !== 'setup' && value.defaultRoute !== 'today')
        || !isCanonicalUnsignedSqliteInteger(value.draftCheckpointVersion)
        || (value.draftCheckpoint !== null && !isSetupDraftCheckpoint(value.draftCheckpoint))
        || (value.currentTerm !== null && !isTermProjection(value.currentTerm))
        || !Array.isArray(value.terms)
        || !value.terms.every(isTermProjection)
        || !Array.isArray(value.courses)
        || !value.courses.every(isCourseProjection)
        || !Array.isArray(value.holidayRanges)
        || !value.holidayRanges.every(isHolidayRangeProjection)
        || !Array.isArray(value.tasks)
        || !value.tasks.every(isTaskProjection)) {
        return false;
    }

    const minimum = value.minimum as SetupProjection['minimum'];
    const terms = value.terms as TermProjection[];
    const courses = value.courses as CourseProjection[];
    const holidayRanges = value.holidayRanges as HolidayRangeProjection[];
    const tasks = value.tasks as TaskProjection[];
    if (value.currentTerm !== null) {
        const currentTerm = value.currentTerm as TermProjection;
        const storedTerm = terms.find(term => term.termId === currentTerm.termId);
        if (!storedTerm || !sameTermProjection(currentTerm, storedTerm)) {
            return false;
        }
    }
    const currentTerm = value.currentTerm as TermProjection | null;
    const currentTermCourses = currentTerm === null
        ? []
        : courses.filter(course => course.termId === currentTerm.termId && !course.archived);
    const hasMeetingOrTask = currentTermCourses.some(course => course.meetings.length > 0
        || tasks.some(task => task.courseId === course.courseId));
    if (minimum.hasCurrentTerm !== (currentTerm !== null)
        || minimum.hasCurrentTermCourse !== (currentTermCourses.length > 0)
        || minimum.hasMeetingOrTask !== hasMeetingOrTask
        || minimum.isSatisfied !== minimum.hasCurrentTerm
        || value.defaultRoute !== (value.everReachedMinimum ? 'today' : 'setup')) {
        return false;
    }
    return courses.every(course => {
        const term = terms.find(candidate => candidate.termId === course.termId);
        return term !== undefined
            && course.teachingRange.startDate >= term.startDate
            && course.teachingRange.endDate <= term.endDate
            && (course.teachingRange.kind !== 'inherit-term'
                || (course.teachingRange.startDate === term.startDate
                    && course.teachingRange.endDate === term.endDate));
    }) && holidayRanges.every(holidayRange => {
        const term = terms.find(candidate => candidate.termId === holidayRange.termId);
        return term !== undefined
            && holidayRange.startDate >= term.startDate
            && holidayRange.endDate <= term.endDate;
    }) && tasks.every(task => courses.some(course => course.courseId === task.courseId));
}

export function isWorkspaceCommandResult(value: unknown): value is WorkspaceCommandResult {
    if (!hasExactDataKeys(value, ['kind', 'revision', 'effects', 'pendingFollowUps'])
        && !hasExactDataKeys(value, ['kind', 'revision', 'effects', 'pendingFollowUps', 'undoCapability'])) {
        return false;
    }
    if (value.kind !== 'committed'
        || !isCanonicalUnsignedSqliteInteger(value.revision)
        || !Array.isArray(value.effects)
        || (value.effects.length !== 1 && value.effects.length !== 2)
        || !Array.isArray(value.pendingFollowUps)
        || value.pendingFollowUps.length !== 1
        || !isCanonicalUuid(value.pendingFollowUps[0])) {
        return false;
    }

    const undoCapability = 'undoCapability' in value ? value.undoCapability : null;
    if (undoCapability !== null
        && (!hasExactDataKeys(undoCapability, [
            'token',
            'taskSeriesId',
            'originalLogicalAnchor',
            'committedRevision',
            'validThroughTaskSeriesVersion',
        ])
            || typeof undoCapability.token !== 'string'
            || !/^[0-9a-f]{64}$/.test(undoCapability.token)
            || !isCanonicalUuid(undoCapability.taskSeriesId)
            || (undoCapability.originalLogicalAnchor !== 'once'
                && !isCanonicalLocalDate(undoCapability.originalLogicalAnchor))
            || !isCanonicalUnsignedSqliteInteger(undoCapability.committedRevision)
            || !isCanonicalUnsignedSqliteInteger(undoCapability.validThroughTaskSeriesVersion))) {
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
    const effectsAreValid = value.effects.length === 1
        ? isEffect(value.effects[0], 'plan.term-created-current', 'term')
            || isEffect(value.effects[0], 'plan.term-end-date-updated', 'term')
            || isEffect(value.effects[0], 'plan.term-restored-current', 'term')
            || isEffect(value.effects[0], 'plan.course-created', 'course')
            || isEffect(value.effects[0], 'plan.meeting-series-created', 'meeting-series')
            || isEffect(value.effects[0], 'plan.meeting-occurrence-changed', 'meeting-series')
            || isEffect(value.effects[0], 'plan.meeting-occurrence-cancelled', 'meeting-series')
            || isEffect(value.effects[0], 'plan.holiday-range-created', 'holiday-range')
            || isEffect(value.effects[0], 'plan.holiday-range-updated', 'holiday-range')
            || isEffect(value.effects[0], 'plan.holiday-range-deleted', 'holiday-range')
            || isEffect(value.effects[0], 'plan.task-series-created', 'task-series')
            || isEffect(value.effects[0], 'plan.task-series-updated', 'task-series')
            || isEffect(value.effects[0], 'plan.task-series-deleted', 'task-series')
            || isEffect(value.effects[0], 'plan.task-occurrence-completed', 'task-series')
            || isEffect(value.effects[0], 'plan.task-occurrence-status-set', 'task-series')
            || isEffect(value.effects[0], 'plan.task-progress-set', 'task-series')
            || isEffect(value.effects[0], 'plan.task-occurrence-changed', 'task-series')
            || isEffect(value.effects[0], 'plan.task-occurrence-deleted', 'task-series')
            || isEffect(value.effects[0], 'plan.task-occurrence-state-undone', 'task-series')
            || isEffect(
                value.effects[0],
                'protect.backup-destination-configured',
                'backup-configuration',
            )
        : isEffect(value.effects[0], 'plan.course-created', 'course')
            && isEffect(value.effects[1], 'plan.meeting-series-created', 'meeting-series');
    if (!effectsAreValid || undoCapability === null) {
        return effectsAreValid;
    }

    const reversibleEffect = value.effects.length === 1
        ? value.effects[0] as WorkspaceCommandEffect
        : null;
    return reversibleEffect !== null
        && [
            'plan.task-occurrence-completed',
            'plan.task-occurrence-status-set',
            'plan.task-progress-set',
        ].includes(reversibleEffect.code)
        && undoCapability.committedRevision === value.revision
        && undoCapability.taskSeriesId === reversibleEffect.entity.id
        && undoCapability.validThroughTaskSeriesVersion === reversibleEffect.entity.version;
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
        const problemKeys = [
            'code',
            'message',
            'requestId',
            'appBuildId',
            'workspaceEpoch',
            'dataEffect',
        ];
        const hasProblemDetails = hasExactDataKeys(problem, [...problemKeys, 'details']);
        const overlapDetailsAreValid = hasProblemDetails
            && problem.code === 'decision-required'
            && hasExactDataKeys(problem.details, ['reason', 'warnings'])
            && problem.details.reason === 'meeting-time-overlap'
            && Array.isArray(problem.details.warnings)
            && problem.details.warnings.length > 0
            && problem.details.warnings.length <= MAX_MEETING_OVERLAP_WARNINGS
            && problem.details.warnings.length === Object.keys(problem.details.warnings).length
            && problem.details.warnings.every(isMeetingOverlapWarning);
        const writerBusyDetailsAreValid = hasProblemDetails
            && problem.code === 'operation-in-progress'
            && hasExactDataKeys(problem.details, ['reason'])
            && problem.details.reason === 'writer-busy';
        const backupOverlapDetailsAreValid = hasProblemDetails
            && problem.code === 'validation'
            && hasExactDataKeys(problem.details, ['reason', 'location'])
            && problem.details.reason === 'backup-location-overlap'
            && (problem.details.location === 'active-data'
                || problem.details.location === 'library-root');
        return hasExactDataKeys(value, ['ok', 'problem'])
            && ((hasExactDataKeys(problem, problemKeys) && problem.code !== 'operation-in-progress')
                || overlapDetailsAreValid
                || writerBusyDetailsAreValid
                || backupOverlapDetailsAreValid)
            && [
                'invalid-request',
                'build-mismatch',
                'stale-workspace',
                'workspace-unavailable',
                'validation',
                'permission',
                'conflict',
                'decision-required',
                'operation-in-progress',
                'identity-conflict',
                'user-cancelled',
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

    if (isWorkspaceMigrationSuccessValue(
        outcome,
        expectedBuildId,
        expectedRequestId,
        expectedWorkspaceEpoch,
    )) {
        return true;
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
    if (outcome.kind === 'workspace.plan-projection') {
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
            && isPlanProjection(outcome.projection);
    }
    if (outcome.kind === 'workspace.data-protection-projection') {
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
            && isDataProtectionProjection(outcome.projection);
    }
    if (outcome.kind === 'workspace.restore-session') {
        return hasExactDataKeys(outcome, [
            'kind',
            'protocolVersion',
            'appBuildId',
            'requestId',
            'workspaceEpoch',
            'session',
        ]) && isRestoreSessionView(outcome.session);
    }
    if (outcome.kind === 'workspace.meeting-series-projection') {
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
            && isMeetingSeriesDetailProjection(outcome.projection);
    }
    if (outcome.kind === 'workspace.task-series-projection') {
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
            && isTaskSeriesDetailProjection(outcome.projection);
    }
    if (outcome.kind === 'workspace.task-occurrence-impact') {
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
            && isTaskOccurrenceImpactProjection(outcome.projection);
    }
    if (outcome.kind === 'workspace.meeting-occurrence-impact') {
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
            && isMeetingOccurrenceImpactProjection(outcome.projection);
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
