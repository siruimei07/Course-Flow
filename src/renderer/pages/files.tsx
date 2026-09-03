import type { ReactElement } from 'react';
import { termContext } from './shared';
import { EmptyState, PageHeader, buttonAction } from './widgets';
import type { WorkspacePageContentProps } from '../workspace-pages';
/**
 * Renders an honest undelivered Files surface without inventing file capabilities.
 *
 * The library is not a failed read: it is a capability this version does not ship, so the
 * card names that state in the shared status vocabulary instead of reporting a problem.
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
                <div className="card-heading">
                    <h2 id="files-state-title">资料库还没有做出来</h2>
                    <p
                        className="status-label"
                        data-severity="neutral"
                    >后续版本</p>
                </div>
                <EmptyState
                    action={buttonAction('返回 Today', () => props.onNavigate('today'))}
                    headingLevel="h3"
                    id="files-empty"
                    reason={'CourseFlow 现在只管学期、课程、课节和任务。资料库会在后续版本提供；'
                        + '在那之前，课件和作业文件继续放在你自己的文件夹里，CourseFlow 不会动它们。'}
                    secondaryAction={props.setupIncomplete
                        ? buttonAction('继续设置', props.onContinueSetup)
                        : undefined}
                    title="这一页暂时没有文件列表"
                />
            </section>
        </article>
    );
}
