/**
 * @file Verifies the settings surface, its categories and the entries it hands off to.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
    AboutSettings,
    DataSettings,
    SETTINGS_CATEGORIES,
    SettingsDialog,
    safetyCopySummary,
    settingsCategoryFromKey,
} from '../../src/renderer/SettingsDialog';
import type {
    ApplicationBuildStatus,
    MigrationSafetyCopyProjection,
} from '../../src/shared/workspace-migration-contract';
import type { SetupProjection } from '../../src/shared/workspace-term-contract';

const noop = (): void => {};

const setup: SetupProjection = {
    workspaceRevision: '2',
    planEntityVersion: '2',
    minimum: {
        hasCurrentTerm: true,
        hasCurrentTermCourse: false,
        hasMeetingOrTask: false,
        isSatisfied: false,
    },
    everReachedMinimum: false,
    defaultRoute: 'setup',
    draftCheckpointVersion: '0',
    draftCheckpoint: null,
    currentTerm: {
        termId: '11111111-1111-4111-8111-111111111111',
        name: 'Fall 2026',
        startDate: '2026-09-08',
        endDate: '2026-12-18',
        timeZone: 'America/Toronto',
        archived: false,
        entityVersion: '1',
    },
    terms: [{
        termId: '11111111-1111-4111-8111-111111111111',
        name: 'Fall 2026',
        startDate: '2026-09-08',
        endDate: '2026-12-18',
        timeZone: 'America/Toronto',
        archived: false,
        entityVersion: '1',
    }],
    courses: [],
    holidayRanges: [],
    tasks: [],
};

const buildStatus: ApplicationBuildStatus = {
    descriptor: {
        descriptorVersion: '1',
        applicationId: 'io.github.siruimei07.courseflow.dev',
        releaseVersion: '0.0.0',
        tag: 'development',
        appBuildId: 'development:abc123',
        fullCommit: '0'.repeat(40),
        platform: 'win32',
        architecture: 'x64',
        variant: 'development',
        workspaceProtocolVersion: '3',
        currentSchemaLevel: '16',
        formats: {
            snapshot: '1',
            backupRepository: '1',
            restoreActivation: '1',
            migrationSafetyCopy: '1',
            migrationRollbackHandoff: '1',
        },
        runtimes: {
            electron: '43.4.1',
            chromium: '142.0.0.0',
            node: '24.19.0',
            sqlite: '3.53.1',
        },
        rollbackTargets: [],
    },
    processMatch: {main: 'exact', renderer: 'exact', workspace: 'exact', allExact: true},
    rollback: {kind: 'clear'},
};

type SettingsProps = Parameters<typeof SettingsDialog>[0];

function settingsProps(overrides: Partial<SettingsProps> = {}): SettingsProps {
    return {
        buildStatus,
        dataMode: 'ready',
        open: true,
        safetyCopy: {kind: 'absent'} as MigrationSafetyCopyProjection,
        setup,
        onClose: noop,
        onOpenDataProtection: noop,
        onOpenManagement: noop,
        onProjection: noop,
        onOpenSetup: noop,
        ...overrides,
    };
}

function render(overrides: Partial<SettingsProps> = {}): string {
    return renderToStaticMarkup(createElement(SettingsDialog, settingsProps(overrides)));
}

test('settings is one modal surface with three ordered categories and no window controls', () => {
    const html = render();

    assert.deepEqual(SETTINGS_CATEGORIES.map(category => category.label), [
        '学期与课程',
        '数据与备份',
        '关于与版本',
    ]);
    assert.match(html, /<dialog/);
    assert.match(html, /aria-modal="true"/);
    assert.match(html, /aria-label="设置分类"/);
    assert.match(html, /aria-label="关闭设置"/);
    assert.doesNotMatch(html, /aria-label="窗口控件"/);
    assert.doesNotMatch(html, /aria-label="最小化窗口"/);

    const positions = SETTINGS_CATEGORIES.map(
        category => html.indexOf(`>${category.label}</button>`),
    );
    assert.ok(positions.every(position => position >= 0));
    assert.deepEqual(Array.from(positions).sort((left, right) => left - right), positions);
});

test('settings opens on Term facts and keeps the setup entry inside that category', () => {
    const html = render();

    assert.match(html, /aria-current="true"[^>]*>学期与课程/);
    assert.match(html, /Fall 2026/);
    assert.match(html, /2026-09-08 至 2026-12-18/);
    assert.match(html, /America\/Toronto/);
    assert.match(html, />管理学期<\/button>/);
    assert.match(html, />管理课程<\/button>/);
    assert.match(html, />管理课节<\/button>/);
    assert.match(html, />管理任务<\/button>/);
    assert.match(html, />管理假期<\/button>/);
    assert.doesNotMatch(html, />打开数据与备份<\/button>/);
    assert.doesNotMatch(html, /AppBuildId/);
});

test('category keys move within the fixed category list and ignore other keys', () => {
    assert.equal(settingsCategoryFromKey('term', 'ArrowDown'), 'data');
    assert.equal(settingsCategoryFromKey('data', 'ArrowUp'), 'term');
    assert.equal(settingsCategoryFromKey('term', 'ArrowUp'), 'about');
    assert.equal(settingsCategoryFromKey('about', 'ArrowDown'), 'term');
    assert.equal(settingsCategoryFromKey('about', 'Home'), 'term');
    assert.equal(settingsCategoryFromKey('term', 'End'), 'about');
    assert.equal(settingsCategoryFromKey('term', 'ArrowLeft'), null);
    assert.equal(settingsCategoryFromKey('term', 'Enter'), null);
});

test('safety copy states stay distinct instead of collapsing into one default', () => {
    assert.equal(safetyCopySummary({kind: 'absent'}), '没有迁移安全副本');
    assert.equal(safetyCopySummary({kind: 'unavailable'}), '副本无法重新验证');
    assert.match(
        safetyCopySummary({
            kind: 'verified',
            integrity: 'verified',
            migrationSafetyCopyId: '22222222-2222-4222-8222-222222222222',
            copyVersion: '1',
            deleteConfirmationToken: '33333333-3333-4333-8333-333333333333',
            workspaceId: '44444444-4444-4444-8444-444444444444',
            sourceSchemaLevel: '15',
            sourceRevision: '9',
            createdAt: '2026-08-29T00:00:00.000Z',
            byteSize: '4096',
            target: {
                releaseVersion: '0.0.0',
                tag: 'development',
                appBuildId: 'development:abc123',
                artifacts: [
                    {platform: 'win32-x64', name: 'a', sha256: '0'.repeat(64)},
                    {platform: 'darwin-arm64', name: 'b', sha256: '0'.repeat(64)},
                ],
            },
        }),
        /已验证，源 schema 15/,
    );
});

test('the data category summarizes protection and routes to the surface that owns it', () => {
    const html = renderToStaticMarkup(createElement(DataSettings, settingsProps({
        dataMode: 'read-only',
        safetyCopy: {kind: 'unavailable'},
    })));

    assert.match(html, /只读模式/);
    assert.match(html, /副本无法重新验证/);
    assert.match(html, />打开数据与备份<\/button>/);
});

test('the about category reports the exact build identity, or its absence', () => {
    const html = renderToStaticMarkup(createElement(AboutSettings, settingsProps()));

    assert.match(html, /development:abc123/);
    assert.match(html, /43\.4\.1/);
    assert.match(html, /3\.53\.1/);
    assert.match(html, /win32 · x64/);

    const withoutStatus = renderToStaticMarkup(
        createElement(AboutSettings, settingsProps({buildStatus: null})),
    );

    assert.doesNotMatch(withoutStatus, /development:abc123/);
    assert.match(withoutStatus, /当前无法读取精确构建身份/);
});

test('the Current Term reset stays disabled until the exact Term name is retyped', () => {
    const html = render();

    assert.match(html, /重置当前学期/);
    assert.match(html, /name="reset-term-confirmation"/);
    // A disabled destructive button is the resting state: nothing is typed yet.
    assert.match(html, /<button class="destructive-action" disabled=""/);
    assert.match(html, /永久删除/);
    assert.match(html, /其他学期与本地备份不受影响/);
});

test('read-only data cannot reach the reset, and a missing Term offers nothing to reset', () => {
    const readOnly = render({dataMode: 'read-only'});
    assert.match(readOnly, /只读模式不能重置当前学期。/);
    assert.match(readOnly, /<button class="destructive-action" disabled=""/);

    const withoutTerm = render({
        setup: {
            ...setup,
            minimum: {...setup.minimum, hasCurrentTerm: false},
            currentTerm: null,
            terms: [],
        },
    });
    assert.match(withoutTerm, /还没有当前学期，没有可以重置的东西。/);
    assert.doesNotMatch(withoutTerm, /name="reset-term-confirmation"/);
    assert.doesNotMatch(withoutTerm, /destructive-action/);
});
