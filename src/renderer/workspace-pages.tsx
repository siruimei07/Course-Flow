import type { CSSProperties, ReactElement } from 'react';
import type { WorkspaceNavigationId } from './navigation';
import type { TaskOccurrenceAction } from './task-occurrence-actions';
import type { TaskDeadline } from '../shared/workspace-task-contract';
import type { SetupProjection, TermProjection } from '../shared/workspace-term-contract';
import { CalendarPage } from './pages/calendar';
import { CoursesPage } from './pages/courses';
import { FilesPage } from './pages/files';
import { TasksPage } from './pages/tasks';
import { TodayPage } from './pages/today';
/**
 * @file Renders the five bounded Workspace pages from existing setup and unified PLAN projections.
 */


import type {
    AgendaItemProjection,
    CalendarHolidaySegmentProjection,
    PlanMeetingProjection,
    PlanNextTaskProjection,
    PlanProjection,
    PlanTaskProjection,
    TaskTimeClassification,
    MeetingTimeClassification,
} from '../shared/workspace-plan-contract';
import type {
    CourseColor,
    CourseProjection,
    MeetingLocation,
    MeetingSeriesProjection,
} from '../shared/workspace-course-contract';

export type WorkspacePageHandlers = Readonly<{
    onNavigate: (page: WorkspaceNavigationId) => void;
    onContinueSetup: () => void;
    onCreateTask: () => void;
    onRetryPlan?: () => void;
    taskActions?: TaskActionPresentation;
}>;

export type TaskActionPresentation = Readonly<{
    writable: boolean;
    busyItemId: string | null;
    problem: string | null;
    canRunAction(task: PlanTaskProjection, action: TaskOccurrenceAction): boolean;
    undo: Readonly<{
        actionLabel: string;
        message: string;
        submitting: boolean;
    }> | null;
    onAction(task: PlanTaskProjection, action: TaskOccurrenceAction): void;
    onUndo(): void;
    onUndoHoverChange(hovered: boolean): void;
    onUndoFocusChange(focused: boolean): void;
}>;

export type WorkspacePageContentProps = WorkspacePageHandlers & Readonly<{
    setup: SetupProjection;
    plan?: PlanProjection | null;
    planProblem?: string | null;
    setupIncomplete: boolean;
}>;

export type WorkspacePageProps = WorkspacePageContentProps & Readonly<{
    page: WorkspaceNavigationId;
}>;










/**
 * Dispatches one fixed navigation destination to its pure presentation component.
 *
 * @param {WorkspacePageProps} props Existing setup/PLAN facts, route, and executable handlers.
 * @return {ReactElement} Selected Workspace page.
 */
export function WorkspacePage(props: WorkspacePageProps): ReactElement {
    const { page, ...contentProps } = props;

    if (page === 'today') {
        return <TodayPage {...contentProps} />;
    }
    if (page === 'courses') {
        return <CoursesPage {...contentProps} />;
    }
    if (page === 'calendar') {
        return <CalendarPage {...contentProps} />;
    }
    if (page === 'tasks') {
        return <TasksPage {...contentProps} />;
    }

    return <FilesPage {...contentProps} />;
}

export { CalendarPage } from './pages/calendar';
export { CoursesPage } from './pages/courses';
export { FilesPage } from './pages/files';
export { TasksPage } from './pages/tasks';
export { TodayPage } from './pages/today';
export { TaskActionNotice } from './pages/widgets';
