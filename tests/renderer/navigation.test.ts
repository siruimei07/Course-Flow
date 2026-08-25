/**
 * @file Verifies the fixed Workspace navigation order and keyboard movement.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    navigationTargetFromKey,
    WORKSPACE_NAVIGATION_ITEMS,
} from '../../src/renderer/navigation';

test('UI-SHELL-01 exposes the five confirmed destinations in their fixed order', () => {
    assert.deepEqual(WORKSPACE_NAVIGATION_ITEMS, [
        { id: 'today', label: 'Today' },
        { id: 'courses', label: 'Courses' },
        { id: 'calendar', label: 'Calendar' },
        { id: 'tasks', label: 'Tasks' },
        { id: 'files', label: 'Files' },
    ]);
});

test('TEST-USABILITY-001 moves navigation focus with arrows and boundary keys', () => {
    assert.equal(navigationTargetFromKey('today', 'ArrowRight'), 'courses');
    assert.equal(navigationTargetFromKey('files', 'ArrowRight'), 'today');
    assert.equal(navigationTargetFromKey('today', 'ArrowLeft'), 'files');
    assert.equal(navigationTargetFromKey('calendar', 'Home'), 'today');
    assert.equal(navigationTargetFromKey('courses', 'End'), 'files');
    assert.equal(navigationTargetFromKey('tasks', 'Enter'), null);
});
