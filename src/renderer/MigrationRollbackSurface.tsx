/**
 * @file Renders path-free migration safety and exact-build rollback surfaces.
 */

import {
    useEffect,
    useRef,
    type ReactElement,
    type SyntheticEvent,
} from 'react';

import type {
    ApplicationBuildStatus,
    MigrationRollbackArtifactProjection,
    MigrationRollbackSessionView,
    MigrationSafetyCopyProjection,
} from '../shared/workspace-migration-contract';

export type MigrationProtectionDialogMode =
    | 'overview'
    | 'delete-confirm'
    | 'rollback-preview';

export type MigrationProtectionDialogProps = Readonly<{
    buildStatus: ApplicationBuildStatus | null;
    busy: boolean;
    mode: MigrationProtectionDialogMode;
    open: boolean;
    problem: string | null;
    rollbackPreview: MigrationRollbackSessionView | null;
    safetyCopy: MigrationSafetyCopyProjection;
    onClose(): void;
    onConfirmDelete(): void;
    onConfirmRollback(): void;
    onModeChange(mode: MigrationProtectionDialogMode): void;
    onPreviewRollback(): void;
}>;

export type MigrationMaintenanceSurfaceProps = Readonly<{
    buildStatus: ApplicationBuildStatus | null;
    busy: boolean;
    problem: string | null;
    session: MigrationRollbackSessionView;
    onCancel(): void;
    onContinue(): void;
    onRetry(): void;
}>;

type RollbackBuildDetailsProps = Readonly<{
    buildStatus: ApplicationBuildStatus | null;
    session: MigrationRollbackSessionView;
}>;

/**
 * Formats the bounded canonical copy size for display.
 * @param {string} byteSize Canonical byte count.
 * @return {string} Human-readable exact size.
 */
function formattedBytes(byteSize: string): string {
    const bytes = BigInt(byteSize);
    if (bytes >= 1_048_576n && bytes % 1_048_576n === 0n) {
        return `${bytes / 1_048_576n} MB`;
    }
    if (bytes >= 1_024n && bytes % 1_024n === 0n) {
        return `${bytes / 1_024n} KB`;
    }
    return `${byteSize} bytes`;
}

/**
 * Selects the exact target artifact for the running platform.
 * @param {ApplicationBuildStatus | null} buildStatus Current application build.
 * @param {MigrationRollbackSessionView} session Current rollback session.
 * @return {MigrationRollbackArtifactProjection | null} Matching artifact when known.
 */
function currentPlatformArtifact(
    buildStatus: ApplicationBuildStatus | null,
    session: MigrationRollbackSessionView,
): MigrationRollbackArtifactProjection | null {
    const target = session.binding?.targetBuild;
    if (!target || !buildStatus) {
        return null;
    }
    const platform = buildStatus.descriptor.platform === 'darwin'
        ? 'darwin-arm64'
        : 'win32-x64';
    return target.artifacts.find(artifact => artifact.platform === platform) ?? null;
}

/**
 * Returns external manual-install instructions for the current platform.
 * @param {ApplicationBuildStatus | null} buildStatus Current application build.
 * @return {string} Platform-specific instructions.
 */
function platformInstructions(buildStatus: ApplicationBuildStatus | null): string {
    if (!buildStatus) {
        return 'Windows：在应用外卸载当前 MSI 后安装指定 MSI。macOS：用指定 DMG 替换 /Applications 中的应用。';
    }
    return buildStatus.descriptor.platform === 'darwin'
        ? '退出 CourseFlow，在应用外用指定 DMG 将 /Applications 中的应用替换为精确目标版本。'
        : '退出 CourseFlow，在应用外卸载当前 MSI 后安装指定 MSI。卸载不会删除本地工作区数据。';
}

/**
 * Renders the exact source, target, artifact, and manual-install facts.
 * @param {RollbackBuildDetailsProps} props Build and session projections.
 * @return {ReactElement | null} Exact-build details when binding exists.
 */
function RollbackBuildDetails(props: RollbackBuildDetailsProps): ReactElement | null {
    const binding = props.session.binding;
    if (!binding) {
        return null;
    }
    const artifact = currentPlatformArtifact(props.buildStatus, props.session);
    const artifacts = artifact ? [artifact] : binding.targetBuild.artifacts;
    return (
        <section
            aria-labelledby="migration-target-title"
            className="migration-target-card"
        >
            <p className="eyebrow">Exact rollback target</p>
            <h2 id="migration-target-title">CourseFlow {binding.targetBuild.releaseVersion}</h2>
            <dl className="migration-facts">
                <div>
                    <dt>原 source 版本</dt>
                    <dd>{binding.sourceBuild.releaseVersion}</dd>
                </div>
                <div>
                    <dt>Source tag</dt>
                    <dd><code>{binding.sourceBuild.tag}</code></dd>
                </div>
                <div>
                    <dt>Source 构建</dt>
                    <dd><code>{binding.sourceBuild.appBuildId}</code></dd>
                </div>
                <div>
                    <dt>Tag</dt>
                    <dd><code>{binding.targetBuild.tag}</code></dd>
                </div>
                <div>
                    <dt>目标构建</dt>
                    <dd><code>{binding.targetBuild.appBuildId}</code></dd>
                </div>
                {artifacts.map(targetArtifact => (
                    <div key={targetArtifact.platform}>
                        <dt>{artifact
                            ? '当前平台制品'
                            : targetArtifact.platform === 'darwin-arm64'
                                ? 'macOS arm64 制品'
                                : 'Windows x64 制品'}</dt>
                        <dd><code>{targetArtifact.name}</code></dd>
                        <dt>SHA-256</dt>
                        <dd><code className="migration-digest">{targetArtifact.sha256}</code></dd>
                    </div>
                ))}
            </dl>
            <p>{platformInstructions(props.buildStatus)}</p>
            <p>CourseFlow 不会在应用内下载或替换程序；下一次启动会重新核对精确构建。</p>
        </section>
    );
}

/**
 * Renders the current DATA-owned safety-copy state.
 * @param {MigrationProtectionDialogProps} props Dialog state and actions.
 * @return {ReactElement} Safety-copy overview.
 */
function SafetyCopyOverview(props: MigrationProtectionDialogProps): ReactElement {
    const safetyCopy = props.safetyCopy;
    if (safetyCopy.kind === 'absent') {
        return (
            <section className="migration-empty-card">
                <h2>没有迁移安全副本</h2>
                <p>当前没有可用于精确版本回退的迁移前结构化数据副本。</p>
            </section>
        );
    }
    if (safetyCopy.kind === 'unavailable') {
        return (
            <section className="migration-empty-card">
                <h2>迁移安全副本不可用</h2>
                <p role="alert">副本无法重新验证；当前已迁移数据保持不变，也不会提供回退动作。</p>
            </section>
        );
    }
    return (
        <section
            aria-labelledby="migration-safety-title"
            className="migration-safety-card"
        >
            <div className="migration-card-heading">
                <div>
                    <p className="eyebrow">MigrationSafetyCopy</p>
                    <h2 id="migration-safety-title">迁移安全副本</h2>
                </div>
                <span className="migration-verified-status">已验证</span>
            </div>
            <p>它只包含最近一次迁移前的结构化数据，不属于备份快照或恢复安全集。</p>
            <dl className="migration-facts">
                <div>
                    <dt>源 schema</dt>
                    <dd>{safetyCopy.sourceSchemaLevel}</dd>
                </div>
                <div>
                    <dt>源修订</dt>
                    <dd>{safetyCopy.sourceRevision}</dd>
                </div>
                <div>
                    <dt>创建时间</dt>
                    <dd>{safetyCopy.createdAt}</dd>
                </div>
                <div>
                    <dt>尺寸</dt>
                    <dd>{formattedBytes(safetyCopy.byteSize)}</dd>
                </div>
                {safetyCopy.target === null
                    ? (
                        <div>
                            <dt>精确兼容版本</dt>
                            <dd>未绑定</dd>
                        </div>
                    )
                    : (
                        <>
                            <div>
                                <dt>精确兼容版本</dt>
                                <dd>{safetyCopy.target.releaseVersion}</dd>
                            </div>
                            <div>
                                <dt>Tag</dt>
                                <dd><code>{safetyCopy.target.tag}</code></dd>
                            </div>
                        </>
                    )}
            </dl>
            {safetyCopy.target === null
                ? <p>当前构建没有已发布的精确兼容版本，副本不提供回退；它仍然完整、已验证，并可随时明确删除。</p>
                : null}
            <div className="migration-actions">
                <button
                    className="secondary-action"
                    disabled={props.busy}
                    onClick={() => props.onModeChange('delete-confirm')}
                    type="button"
                >删除迁移安全副本</button>
                {safetyCopy.target === null
                    ? null
                    : (
                        <button
                            className="primary-action"
                            disabled={props.busy}
                            onClick={props.onPreviewRollback}
                            type="button"
                        >预览精确版本回退</button>
                    )}
            </div>
        </section>
    );
}

/**
 * Renders the explicit destructive deletion confirmation.
 * @param {MigrationProtectionDialogProps} props Dialog state and actions.
 * @return {ReactElement} Safe-focus confirmation surface.
 */
function DeleteConfirmation(props: MigrationProtectionDialogProps): ReactElement {
    return (
        <section
            aria-labelledby="migration-delete-title"
            className="migration-confirmation-card"
        >
            <p className="eyebrow">明确删除</p>
            <h2 id="migration-delete-title">删除迁移安全副本？</h2>
            <p>删除后将失去本次迁移的应用版本回退能力。当前已迁移数据不会改变。</p>
            <p>CourseFlow 不会按时间、空间或启动次数自动删除此副本。</p>
            <div className="migration-actions">
                <button
                    autoFocus
                    className="secondary-action"
                    disabled={props.busy}
                    onClick={() => props.onModeChange('overview')}
                    type="button"
                >保留副本</button>
                <button
                    className="primary-action migration-destructive-action"
                    disabled={props.busy}
                    onClick={props.onConfirmDelete}
                    type="button"
                >确认删除</button>
            </div>
        </section>
    );
}

/**
 * Renders the preview-bound complete replacement impact.
 * @param {MigrationProtectionDialogProps} props Dialog state and actions.
 * @return {ReactElement} Exact rollback impact surface.
 */
function RollbackPreview(props: MigrationProtectionDialogProps): ReactElement {
    const preview = props.rollbackPreview;
    const binding = preview?.binding;
    if (!preview || preview.phase !== 'previewed' || !binding) {
        return (
            <section className="migration-confirmation-card">
                <h2>正在形成回退影响预览</h2>
                <p aria-live="polite">正在重新验证迁移安全副本和当前数据。</p>
            </section>
        );
    }
    return (
        <section
            aria-labelledby="migration-preview-title"
            className="migration-preview-card"
        >
            <p className="eyebrow">完整替换 · 不自动合并</p>
            <h2 id="migration-preview-title">确认精确版本回退影响</h2>
            <div className="migration-warning" role="note">
                <strong>迁移后新增或修改的结构化数据不会保留，也不会自动合并。</strong>
                <p>当前修订 {binding.currentData.revision} 将由迁移前修订 {binding.safetyCopy.sourceRevision} 完整替换。</p>
            </div>
            <p>真实资料库文件保持原位；目标版本会重新扫描并按磁盘事实对账。</p>
            <p>迁移后新增的结构化标签或映射可能无法继续存在。</p>
            <dl className="migration-facts">
                <div>
                    <dt>迁移前 DATA</dt>
                    <dd>schema {binding.safetyCopy.sourceSchemaLevel} · 修订 {binding.safetyCopy.sourceRevision}</dd>
                </div>
                <div>
                    <dt>当前 DATA</dt>
                    <dd>schema {binding.currentData.schemaLevel} · 修订 {binding.currentData.revision}</dd>
                </div>
                <div>
                    <dt>资料库</dt>
                    <dd>{binding.currentLibrary.kind === 'absent' ? '当前未配置' : '保持现有根并全量对账'}</dd>
                </div>
            </dl>
            <RollbackBuildDetails
                buildStatus={props.buildStatus}
                session={preview}
            />
            <div className="migration-actions">
                <button
                    autoFocus
                    className="secondary-action"
                    disabled={props.busy}
                    onClick={() => props.onModeChange('overview')}
                    type="button"
                >返回</button>
                <button
                    className="primary-action migration-destructive-action"
                    disabled={props.busy}
                    onClick={props.onConfirmRollback}
                    type="button"
                >确认数据损失并准备回退</button>
            </div>
        </section>
    );
}

/**
 * Renders the normal-workspace migration safety dialog with native modal containment.
 * @param {MigrationProtectionDialogProps} props Formal projections and exact actions.
 * @return {ReactElement} Native modal dialog.
 */
export function MigrationProtectionDialog(
    props: MigrationProtectionDialogProps,
): ReactElement {
    const dialogRef = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) {
            return;
        }
        if (props.open && !dialog.open) {
            dialog.showModal();
        }
        else if (!props.open && dialog.open) {
            dialog.close();
        }
    }, [props.open]);

    /**
     * Keeps native Escape cancellation inside the busy-state boundary.
     * @param {SyntheticEvent<HTMLDialogElement>} event Native dialog cancel event.
     * @return {void}
     */
    const cancel = (event: SyntheticEvent<HTMLDialogElement>): void => {
        event.preventDefault();
        if (!props.busy) {
            props.onClose();
        }
    };

    return (
        <dialog
            aria-labelledby="migration-dialog-title"
            className="migration-dialog"
            onCancel={cancel}
            ref={dialogRef}
        >
            <div className="migration-dialog-surface">
                <header className="migration-dialog-header">
                    <div>
                        <p className="eyebrow">本地数据保护</p>
                        <h1 id="migration-dialog-title">数据与备份</h1>
                    </div>
                    <button
                        aria-label="关闭数据与备份"
                        className="secondary-action"
                        disabled={props.busy}
                        onClick={props.onClose}
                        type="button"
                    >关闭</button>
                </header>
                <div className="migration-dialog-body">
                    {props.mode === 'overview' ? <SafetyCopyOverview {...props} /> : null}
                    {props.mode === 'delete-confirm' ? <DeleteConfirmation {...props} /> : null}
                    {props.mode === 'rollback-preview' ? <RollbackPreview {...props} /> : null}
                    <p
                        aria-live="polite"
                        className={props.problem ? 'migration-status migration-status--problem' : 'migration-status'}
                        role={props.problem ? 'alert' : undefined}
                    >{props.problem ?? (props.busy ? '正在与本地 Workspace 核对状态。' : '')}</p>
                </div>
            </div>
        </dialog>
    );
}

/**
 * Selects an accessible maintenance heading from exact session state.
 * @param {MigrationRollbackSessionView} session Current rollback session.
 * @return {string} Visible page heading.
 */
function maintenanceHeading(session: MigrationRollbackSessionView): string {
    if (session.phase === 'recovery-required') {
        return '迁移回退需要恢复';
    }
    if (session.phase === 'succeeded') {
        return '回退已完成';
    }
    if (session.phase === 'cancelled') {
        return '回退已取消';
    }
    if (session.currentBuild === 'target') {
        return '准备完成回退';
    }
    if (session.currentBuild === 'other') {
        return '当前应用版本不匹配';
    }
    return session.phase === 'planned' || session.phase === 'prepared'
        ? '正在准备迁移回退'
        : '等待目标版本';
}

/**
 * Selects the complete textual announcement for one rollback phase.
 * @param {MigrationRollbackSessionView} session Current rollback session.
 * @return {string} Phase status text.
 */
function maintenancePhaseText(session: MigrationRollbackSessionView): string {
    const labels: Readonly<Record<MigrationRollbackSessionView['phase'], string>> = {
        previewed: '影响预览等待确认',
        planned: '准备中，可以取消',
        prepared: '准备中，可以取消',
        armed: '已到切换检查点',
        'awaiting-target-build': '已到切换检查点，等待应用版本',
        completing: '正在完成回退验证',
        cancelling: '正在恢复当前数据',
        succeeded: '迁移前数据已重新打开并完成路由',
        cancelled: '迁移后数据已恢复并完成路由',
        'recovery-required': '现有证据不足以安全继续或取消',
    };
    return labels[session.phase];
}

/**
 * Renders the exclusive startup route for rollback maintenance or recovery.
 * @param {MigrationMaintenanceSurfaceProps} props Exact build state and allowed actions.
 * @return {ReactElement} Keyboard-complete maintenance page.
 */
export function MigrationMaintenanceSurface(
    props: MigrationMaintenanceSurfaceProps,
): ReactElement {
    const headingRef = useRef<HTMLHeadingElement>(null);
    useEffect(() => {
        headingRef.current?.focus();
    }, []);
    const session = props.session;
    const canCancel = session.allowedActions.includes('cancel-as-source');
    const canContinue = session.allowedActions.includes('continue-as-target');
    const recovery = session.phase === 'recovery-required';
    return (
        <main className="migration-maintenance-surface">
            <section className="migration-maintenance-card">
                <p className="eyebrow">Migration rollback</p>
                <h1
                    id="migration-maintenance-title"
                    ref={headingRef}
                    tabIndex={-1}
                >{maintenanceHeading(session)}</h1>
                <p
                    aria-atomic="true"
                    aria-live={recovery ? 'assertive' : 'polite'}
                    className="migration-phase-status"
                    role={recovery ? 'alert' : 'status'}
                >{maintenancePhaseText(session)}</p>
                {recovery ? (
                    <p>普通工作区保持关闭。CourseFlow 不会猜测、自动迁移或执行物理动作。</p>
                ) : (
                    <>
                        <p>普通工作区在回退完成或取消前保持关闭。</p>
                        <RollbackBuildDetails
                            buildStatus={props.buildStatus}
                            session={session}
                        />
                    </>
                )}
                {session.currentBuild === 'other' && session.binding ? (
                    <p>请在应用外安装精确目标版本或重新安装原 source 版本；当前构建没有安全动作。</p>
                ) : null}
                {props.problem ? <p role="alert">{props.problem}</p> : null}
                <div className="migration-actions">
                    {canCancel ? (
                        <button
                            className="secondary-action"
                            disabled={props.busy}
                            onClick={props.onCancel}
                            type="button"
                        >取消回退并恢复当前数据</button>
                    ) : null}
                    {canContinue ? (
                        <button
                            className="primary-action"
                            disabled={props.busy}
                            onClick={props.onContinue}
                            type="button"
                        >继续回退</button>
                    ) : null}
                    {!canCancel && !canContinue ? (
                        <button
                            className="secondary-action"
                            disabled={props.busy}
                            onClick={props.onRetry}
                            type="button"
                        >重新检查状态</button>
                    ) : null}
                </div>
            </section>
        </main>
    );
}
