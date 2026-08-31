import type { ReactElement } from 'react';
import { termContext } from './shared';
import { EmptyState, PageHeader, buttonAction } from './widgets';
import type { WorkspacePageContentProps } from '../workspace-pages';
/**
 * Renders an honest unavailable Files surface without inventing file capabilities.
 *
 * @param {WorkspacePageContentProps} props Existing setup state and bounded exit handlers.
 * @return {ReactElement} Files page.
 */
export function FilesPage(props: WorkspacePageContentProps): ReactElement {
    return (
        <article
            aria-labelledby="files-page-title"
            className="workspace-page workspace-page--files"
        >
            <PageHeader
                context={termContext(props.setup)}
                headingId="files-page-title"
                title="文件"
            />
            <section
                aria-labelledby="files-state-title"
                className="content-card files-state-card"
            >
                <h2 id="files-state-title">资料库事实不可用</h2>
                <EmptyState
                    action={buttonAction('返回 Today', () => props.onNavigate('today'))}
                    headingLevel="h3"
                    id="files-empty"
                    reason="当前 Workspace 没有提供资料库投影，因此不能判断文件列表是否为空。"
                    secondaryAction={props.setupIncomplete
                        ? buttonAction('继续设置', props.onContinueSetup)
                        : undefined}
                    title="无法显示文件列表"
                />
            </section>
        </article>
    );
}
