import { setupStateFrom, type SetupState } from './setup-state';
import type { ManagementSurfaceId } from './management-surfaces';
import { initialDraftFrom } from './setup/checklist';
import { focusStatus } from './setup/field-errors';
import { TermForm } from './setup/forms';
import { reconcileSetupCheckpoint, reducePendingSetupMutation, retryPendingSetupMutation, setupMutationProblemMessage } from './setup/mutation';
import type { PendingSetupMutation } from './setup/mutation';
import { IncompatibleDraft, SetupComplete, SetupProgress } from './setup/progress';
/**
 * @file Renders and persists the interruptible first-setup editing flow.
 */

import {
    useEffect,
    useReducer,
    useRef,
    useState,
} from 'react';

import type {
    WorkspaceSetupOutcome,
} from '../shared/workspace-setup-contract';
import {
    decodeSetupDraft,
    encodeSetupDraft,
    type SetupDraft,
    type TermDraft,
} from './setup-draft';

export type ResolvedSetupState = Exclude<
    SetupState,
    Readonly<{ kind: 'loading' }> | Readonly<{ kind: 'problem'; message: string }>
>;

export type SetupDialogProps = Readonly<{
    open: boolean;
    state: ResolvedSetupState;
    onProjection(state: ResolvedSetupState): void;
    onClose(destination: 'current' | 'today'): void;
    onOpenManagement(surface: ManagementSurfaceId): void;
}>;

/**
 * Renders the modal first-setup flow and saves Shell drafts before every explicit exit.
 *
 * First setup owns exactly one required fact, the Current Term. Courses, Meetings,
 * Tasks and HolidayRanges are supplemental and belong to their management surfaces.
 *
 * @param {SetupDialogProps} props Setup state and lifecycle callbacks.
 * @return {JSX.Element} Native modal dialog.
 */
export function SetupDialog(props: SetupDialogProps) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const statusRef = useRef<HTMLParagraphElement>(null);
    const completionHeadingRef = useRef<HTMLHeadingElement>(null);
    const isDirty = useRef(false);
    const readOnly = props.state.dataMode === 'read-only';
    const [draft, setDraft] = useState<SetupDraft>(() => initialDraftFrom(props.state));
    const [checkpointMessage, setCheckpointMessage] = useState(readOnly
        ? '只读模式；可以查看现有设置和草稿，但不能更改或丢弃。'
        : '未提交输入会保存为本地草稿。');
    const [savingCheckpoint, setSavingCheckpoint] = useState(false);
    const [commandBusy, setCommandBusy] = useState(false);
    const [pendingMutationState, dispatchPendingMutation] = useReducer(
        reducePendingSetupMutation,
        { pending: null },
    );
    const pendingMutation = pendingMutationState.pending;
    const hasPendingMutation = pendingMutation !== null;
    const checkpoint = props.state.projection.draftCheckpoint;
    const checkpointIsIncompatible = checkpoint !== null
        && decodeSetupDraft(checkpoint.opaquePayload) === null;
    const hasUncommittedDraft = isDirty.current || (checkpoint !== null
        && !checkpointIsIncompatible);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (dialog === null) {
            return;
        }
        if (props.open && !dialog.open) {
            dialog.showModal();
        }
        if (!props.open && dialog.open) {
            dialog.close();
        }
    }, [props.open]);

    useEffect(() => {
        if (!isDirty.current) {
            setDraft(initialDraftFrom(props.state));
        }
    }, [
        props.open,
        props.state.kind,
        props.state.projection.workspaceRevision,
        props.state.projection.draftCheckpointVersion,
    ]);

    useEffect(() => {
        if (pendingMutation !== null) {
            dispatchPendingMutation({ kind: 'projection-advanced' });
        }
    }, [props.state.projection.workspaceRevision]);

    useEffect(() => {
        if (!props.open
            || props.state.kind !== 'complete'
            || (checkpoint !== null && !checkpointIsIncompatible)) {
            return;
        }
        const completionFocusFrame = globalThis.requestAnimationFrame(() => (
            completionHeadingRef.current?.focus()
        ));
        return () => globalThis.cancelAnimationFrame(completionFocusFrame);
    }, [
        checkpointIsIncompatible,
        props.open,
        props.state.kind,
        props.state.projection.draftCheckpointVersion,
    ]);

    /**
     * Updates the controlled Term draft and marks it as needing a checkpoint.
     *
     * @param {TermDraft} value Updated Term branch value.
     * @return {void}
     */
    const updateTermDraft = (value: TermDraft): void => {
        isDirty.current = true;
        setDraft(current => ({ ...current, step: 'term', term: value }));
        setCheckpointMessage('有未提交输入；请先提交当前表单，或保存进度并退出。');
    };

    const retainUnknownMutation = (pending: PendingSetupMutation): void => {
        dispatchPendingMutation({ kind: 'retain-unknown', pending });
    };

    const resolvePendingMutation = (kind: PendingSetupMutation['kind']): void => {
        if (pendingMutation?.kind === kind) {
            dispatchPendingMutation({ kind: 'resolved' });
        }
    };

    /**
     * Ends native modal focus containment before the parent restores the prior target.
     *
     * @param {'current' | 'today'} destination Surface requested after closing.
     * @return {void}
     */
    const closeDialog = (destination: 'current' | 'today'): void => {
        const dialog = dialogRef.current;
        if (dialog?.open) {
            dialog.close();
        }
        props.onClose(destination);
    };

    /**
     * Saves a dirty draft, then closes only after Workspace confirms persistence.
     *
     * @param {'current' | 'today'} destination Surface requested after closing.
     * @return {Promise<void>}
     */
    const saveAndClose = async (destination: 'current' | 'today'): Promise<void> => {
        if (savingCheckpoint || commandBusy) {
            return;
        }
        if (hasPendingMutation) {
            dispatchPendingMutation({ kind: 'exit-attempted' });
            setCheckpointMessage('正式请求结果尚未确认；请先精确重试本次请求，再退出设置。');
            focusStatus(statusRef);
            return;
        }
        if (checkpointIsIncompatible || !isDirty.current || props.state.dataMode === 'read-only') {
            closeDialog(destination);
            return;
        }

        setSavingCheckpoint(true);
        setCheckpointMessage('正在保存设置草稿…');
        const expectedVersion = props.state.projection.draftCheckpointVersion;
        const opaquePayload = encodeSetupDraft({ ...draft, step: 'term' });
        const expectedCheckpoint = { schemaVersion: 1, opaquePayload } as const;
        let outcome: WorkspaceSetupOutcome | null = null;
        try {
            outcome = await window.courseFlow.saveSetupDraftCheckpoint({
                expectedVersion,
                schemaVersion: 1,
                opaquePayload,
            });
        }
        catch {
        }
        const reconciledOutcome = await reconcileSetupCheckpoint(
            outcome,
            expectedVersion,
            expectedCheckpoint,
            () => window.courseFlow.querySetup(),
        );
        setSavingCheckpoint(false);
        if (reconciledOutcome === null) {
            setCheckpointMessage(outcome !== null && !outcome.ok
                ? setupMutationProblemMessage(outcome.problem, '草稿未保存。')
                : '草稿保存结果尚无法确认；全部输入、草稿和本次请求仍保留，请重新打开设置核对。');
            focusStatus(statusRef);
            return;
        }
        const nextState = setupStateFrom(reconciledOutcome);
        if (nextState.kind === 'problem' || nextState.kind === 'loading') {
            const message = nextState.kind === 'problem'
                ? nextState.message
                : 'Workspace 未返回可恢复的设置状态。';
            setCheckpointMessage(`草稿保存结果尚无法确认：${message}`);
            focusStatus(statusRef);
            return;
        }

        isDirty.current = false;
        setCheckpointMessage('草稿已保存；下次打开设置会继续保留这些输入。');
        props.onProjection(nextState);
        closeDialog(destination);
    };

    /**
     * Discards an incompatible checkpoint only after the user explicitly chooses it.
     *
     * @return {Promise<void>}
     */
    const discardIncompatibleCheckpoint = async (): Promise<void> => {
        if (savingCheckpoint || commandBusy || props.state.dataMode === 'read-only') {
            return;
        }

        setSavingCheckpoint(true);
        const expectedVersion = props.state.projection.draftCheckpointVersion;
        let outcome: WorkspaceSetupOutcome | null = null;
        try {
            outcome = await window.courseFlow.discardSetupDraftCheckpoint(
                expectedVersion,
            );
        }
        catch {
        }
        const reconciledOutcome = await reconcileSetupCheckpoint(
            outcome,
            expectedVersion,
            null,
            () => window.courseFlow.querySetup(),
        );
        setSavingCheckpoint(false);
        if (reconciledOutcome === null) {
            setCheckpointMessage(outcome !== null && !outcome.ok
                ? setupMutationProblemMessage(outcome.problem, '旧草稿未丢弃。')
                : '旧草稿丢弃结果尚无法确认；当前草稿和本次请求仍保留，请重新打开设置核对。');
            focusStatus(statusRef);
            return;
        }
        const nextState = setupStateFrom(reconciledOutcome);
        if (nextState.kind === 'problem' || nextState.kind === 'loading') {
            const message = nextState.kind === 'problem'
                ? nextState.message
                : 'Workspace 未返回可恢复的设置状态。';
            setCheckpointMessage(`旧草稿丢弃结果尚无法确认：${message}`);
            focusStatus(statusRef);
            return;
        }

        isDirty.current = false;
        setDraft(initialDraftFrom(nextState));
        setCheckpointMessage('旧草稿已丢弃；正式课程数据没有改变。');
        props.onProjection(nextState);
    };

    /**
     * Refreshes formal setup facts after one command and consumes its draft checkpoint.
     *
     * @return {Promise<void>}
     */
    const refreshAfterCommit = async (): Promise<void> => {
        let outcome: WorkspaceSetupOutcome;
        let settledMessage = '正式数据已保存；设置进度已刷新。';
        try {
            outcome = await window.courseFlow.querySetup();
        }
        catch {
            setCheckpointMessage('正式数据已保存，但无法刷新设置进度；请退出后重新打开。');
            focusStatus(statusRef);
            return;
        }
        if (checkpoint !== null && props.state.dataMode === 'ready') {
            const expectedVersion = props.state.projection.draftCheckpointVersion;
            let discarded: WorkspaceSetupOutcome | null = null;
            try {
                discarded = await window.courseFlow.discardSetupDraftCheckpoint(
                    expectedVersion,
                );
            }
            catch {
            }
            const reconciledDiscard = await reconcileSetupCheckpoint(
                discarded,
                expectedVersion,
                null,
                () => window.courseFlow.querySetup(),
            );
            if (reconciledDiscard !== null) {
                outcome = reconciledDiscard;
            }
            else if (discarded !== null && !discarded.ok) {
                settledMessage = discarded.problem.dataEffect === 'unknown'
                    ? `${discarded.problem.message} 正式数据已保存；旧草稿清理结果尚无法确认，`
                        + '请重新打开设置核对。'
                    : `${discarded.problem.message} 正式数据已保存；旧草稿未清理，`
                        + '下次设置会以正式进度为准。';
            }
            else {
                settledMessage = '正式数据已保存；旧草稿清理结果尚无法确认，请重新打开设置核对。';
            }
        }

        const nextState = setupStateFrom(outcome);
        if (nextState.kind === 'problem' || nextState.kind === 'loading') {
            const message = nextState.kind === 'problem'
                ? nextState.message
                : 'Workspace 未返回可恢复的设置状态。';
            setCheckpointMessage(`正式数据已保存，但无法刷新设置进度：${message}`);
            focusStatus(statusRef);
            return;
        }

        isDirty.current = false;
        setDraft(initialDraftFrom(nextState));
        setCheckpointMessage(settledMessage);
        props.onProjection(nextState);
    };

    const retryPendingMutation = async (): Promise<void> => {
        if (pendingMutation === null || savingCheckpoint || commandBusy) {
            return;
        }

        setCommandBusy(true);
        setCheckpointMessage('正在使用保留的 command ID 精确重试正式请求…');
        let outcome: WorkspaceSetupOutcome;
        try {
            outcome = await retryPendingSetupMutation(pendingMutation, window.courseFlow);
        }
        catch {
            setCommandBusy(false);
            setCheckpointMessage('无法连接本地 Workspace；结果仍未知，原请求和全部输入继续保留。');
            focusStatus(statusRef);
            return;
        }
        if (!outcome.ok && outcome.problem.dataEffect === 'unknown') {
            setCommandBusy(false);
            setCheckpointMessage(setupMutationProblemMessage(outcome.problem, '正式数据没有改变。'));
            focusStatus(statusRef);
            return;
        }

        dispatchPendingMutation({ kind: 'resolved' });
        if (!outcome.ok) {
            setCommandBusy(false);
            setCheckpointMessage(setupMutationProblemMessage(outcome.problem, '正式数据没有改变。'));
            focusStatus(statusRef);
            return;
        }

        setCheckpointMessage('原请求已由 Workspace 精确确认；正式数据已保存。');
        await refreshAfterCommit();
        setCommandBusy(false);
    };

    return (
        <dialog
            aria-labelledby="setup-dialog-title"
            aria-modal="true"
            className="setup-dialog"
            onCancel={event => {
                event.preventDefault();
                void saveAndClose('current');
            }}
            ref={dialogRef}
        >
            <div
                aria-busy={savingCheckpoint || commandBusy}
                className="setup-modal"
            >
                <header className="setup-modal-header">
                    <h1 id="setup-dialog-title">完成首次设置</h1>
                    <div className="setup-modal-actions">
                        <button
                            aria-label={readOnly ? '关闭设置' : '保存设置草稿并关闭'}
                            disabled={savingCheckpoint || commandBusy || hasPendingMutation}
                            onClick={() => void saveAndClose('current')}
                            type="button"
                        >{readOnly ? '关闭' : '保存进度并退出'}</button>
                    </div>
                </header>
                <div className="setup-modal-body">
                    <SetupProgress state={props.state} />
                    <section
                        aria-label="当前设置步骤"
                        className="setup-workspace"
                        tabIndex={-1}
                    >
                        {checkpointIsIncompatible ? (
                            <IncompatibleDraft
                                dataMode={props.state.dataMode}
                                saving={savingCheckpoint || hasPendingMutation}
                                onDiscard={() => void discardIncompatibleCheckpoint()}
                            />
                        ) : null}
                        {!checkpointIsIncompatible && props.state.kind === 'term' ? (
                            <TermForm
                                blocked={savingCheckpoint
                                    || (hasPendingMutation && pendingMutation.kind !== 'term')}
                                dataMode={props.state.dataMode}
                                draft={draft.term}
                                inputLocked={hasPendingMutation}
                                pendingCommand={pendingMutation?.kind === 'term'
                                    ? pendingMutation.command
                                    : null}
                                projection={props.state.projection}
                                onChange={updateTermDraft}
                                onBusyChange={setCommandBusy}
                                onCommitted={refreshAfterCommit}
                                onSettled={() => resolvePendingMutation('term')}
                                onUnknown={command => retainUnknownMutation({ kind: 'term', command })}
                            />
                        ) : null}
                        {!checkpointIsIncompatible && props.state.kind === 'complete' ? (
                            <SetupComplete
                                disabled={savingCheckpoint
                                    || commandBusy
                                    || readOnly
                                    || hasPendingMutation
                                    || hasUncommittedDraft}
                                headingRef={completionHeadingRef}
                                onOpenManagement={surface => {
                                    closeDialog('current');
                                    props.onOpenManagement(surface);
                                }}
                                state={props.state}
                            />
                        ) : null}
                    </section>
                </div>
                <footer className="setup-modal-footer">
                    <p
                        className="checkpoint-message"
                        ref={statusRef}
                        role="status"
                        tabIndex={-1}
                    >{checkpointMessage}</p>
                    <div className="setup-footer-actions">
                        {pendingMutation !== null ? (
                            <button
                                className="secondary-action"
                                disabled={savingCheckpoint || commandBusy}
                                onClick={() => void retryPendingMutation()}
                                type="button"
                            >精确重试未确认请求</button>
                        ) : null}
                        <button
                            className="primary-action"
                            disabled={savingCheckpoint || commandBusy || hasPendingMutation}
                            onClick={() => void saveAndClose('today')}
                            type="button"
                        >进入今天</button>
                    </div>
                </footer>
            </div>
        </dialog>
    );
}

export {
    reducePendingSetupMutation,
    retryPendingSetupMutation,
    setupMutationProblemMessage,
    setupCheckpointMatches,
    reconcileSetupCheckpoint,
    type PendingSetupMutation,
    type PendingSetupMutationState,
    type PendingSetupMutationEvent,
    type SetupMutationRetryPort,
} from './setup/mutation';
export {
    SetupFieldError,
    focusFirstSetupFieldError,
    setupFieldErrorAttributes,
    setupNativeFieldErrors,
    setupSemanticFailureErrors,
    type SetupFieldErrors,
    type SetupSemanticFailure,
} from './setup/field-errors';
