/**
 * @file Owns the fixed management surface model shared by the Shell and its dialogs.
 */

/**
 * Confirmed management surfaces in their visible order.
 *
 * @const
 * @type {readonly object[]}
 */
export const MANAGEMENT_SURFACES = [
    { id: 'term', label: '学期' },
    { id: 'course', label: '课程' },
    { id: 'meeting', label: '课节' },
    { id: 'task', label: '任务' },
    { id: 'holiday', label: '假期' },
] as const;

export type ManagementSurfaceId = typeof MANAGEMENT_SURFACES[number]['id'];

/**
 * Returns the surface that should receive focus for one navigation key.
 *
 * @param {ManagementSurfaceId} currentSurface Currently focused surface.
 * @param {string} key KeyboardEvent key value.
 * @return {ManagementSurfaceId | null} Next surface, or null when the key is not a navigation key.
 */
export function managementSurfaceFromKey(
    currentSurface: ManagementSurfaceId,
    key: string,
): ManagementSurfaceId | null {
    if (key === 'Home') {
        return MANAGEMENT_SURFACES[0].id;
    }
    if (key === 'End') {
        return MANAGEMENT_SURFACES.at(-1)!.id;
    }
    if (key !== 'ArrowUp' && key !== 'ArrowDown') {
        return null;
    }

    const currentIndex = MANAGEMENT_SURFACES.findIndex(item => item.id === currentSurface);
    const direction = key === 'ArrowDown' ? 1 : -1;
    const targetIndex = (
        currentIndex + direction + MANAGEMENT_SURFACES.length
    ) % MANAGEMENT_SURFACES.length;
    return MANAGEMENT_SURFACES[targetIndex].id;
}
