/**
 * @file Owns the fixed Workspace navigation model and keyboard target calculation.
 */

/**
 * Confirmed top-level Workspace destinations in their visible order.
 *
 * @const
 * @type {readonly object[]}
 */
export const WORKSPACE_NAVIGATION_ITEMS = [
    { id: 'today', label: 'Today' },
    { id: 'courses', label: 'Courses' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'tasks', label: 'Tasks' },
    { id: 'files', label: 'Files' },
] as const;

export type WorkspaceNavigationId = typeof WORKSPACE_NAVIGATION_ITEMS[number]['id'];
export type WorkspaceRoute = WorkspaceNavigationId;

/**
 * Returns the destination that should receive focus for one navigation key.
 *
 * @param {WorkspaceRoute} currentRoute Currently focused destination.
 * @param {string} key KeyboardEvent key value.
 * @return {WorkspaceRoute | null} Next destination, or null when the key is not a navigation key.
 */
export function navigationTargetFromKey(
    currentRoute: WorkspaceRoute,
    key: string,
): WorkspaceRoute | null {
    if (key === 'Home') {
        return WORKSPACE_NAVIGATION_ITEMS[0].id;
    }
    if (key === 'End') {
        return WORKSPACE_NAVIGATION_ITEMS.at(-1)!.id;
    }
    if (key !== 'ArrowLeft' && key !== 'ArrowRight') {
        return null;
    }

    const currentIndex = WORKSPACE_NAVIGATION_ITEMS.findIndex(item => item.id === currentRoute);
    const direction = key === 'ArrowRight' ? 1 : -1;
    const targetIndex = (
        currentIndex + direction + WORKSPACE_NAVIGATION_ITEMS.length
    ) % WORKSPACE_NAVIGATION_ITEMS.length;
    return WORKSPACE_NAVIGATION_ITEMS[targetIndex].id;
}
