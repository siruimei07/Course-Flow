/**
 * @file Verifies migration safety, rollback confirmation, and exact-build maintenance UI.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

import {
    MigrationMaintenanceSurface,
    MigrationProtectionDialog,
} from '../../src/renderer/MigrationRollbackSurface';
import type {
    ApplicationBuildStatus,
    MigrationRollbackSessionView,
    MigrationSafetyCopyProjection,
} from '../../src/shared/workspace-migration-contract';

const noop = (): void => {};

const TARGET = Object.freeze({
    releaseVersion: '1.4.2',
    tag: 'v1.4.2',
    appBuildId: 'development:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    artifacts: Object.freeze([
        Object.freeze({
            platform: 'darwin-arm64' as const,
            name: 'CourseFlow-1.4.2-macOS-arm64.dmg',
            sha256: 'c'.repeat(64),
        }),
        Object.freeze({
            platform: 'win32-x64' as const,
            name: 'CourseFlow-1.4.2-Windows-x64.msi',
            sha256: 'd'.repeat(64),
        }),
    ] as const),
});

const SAFETY_COPY = Object.freeze({
    kind: 'verified' as const,
    integrity: 'verified' as const,
    migrationSafetyCopyId: '22222222-2222-4222-8222-222222222222',
    copyVersion: 'a'.repeat(64),
    deleteConfirmationToken: 'b'.repeat(64),
    workspaceId: '11111111-1111-4111-8111-111111111111',
    sourceRevision: '7',
    sourceSchemaLevel: '15',
    createdAt: '2026-08-27T12:00:00.000Z',
    byteSize: '4096',
    target: TARGET,
}) satisfies MigrationSafetyCopyProjection;

const BUILD_STATUS = Object.freeze({
    descriptor: Object.freeze({
        descriptorVersion: '1' as const,
        applicationId: 'io.github.siruimei07.courseflow.dev' as const,
        releaseVersion: '2.0.0-development',
        tag: 'development-source',
        appBuildId: 'development:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        fullCommit: 'a'.repeat(40),
        platform: 'win32' as const,
        architecture: 'x64' as const,
        variant: 'development' as const,
        workspaceProtocolVersion: '3' as const,
        currentSchemaLevel: '16',
        formats: Object.freeze({
            snapshot: '1' as const,
            backupRepository: '1' as const,
            restoreActivation: '1' as const,
            migrationSafetyCopy: '1' as const,
            migrationRollbackHandoff: '1' as const,
        }),
        runtimes: Object.freeze({
            electron: '43.4.1',
            chromium: '150.0.0.0',
            node: '24.19.0',
            sqlite: '3.53.1',
        }),
        rollbackTargets: Object.freeze([TARGET]),
    }),
    processMatch: Object.freeze({
        main: 'exact' as const,
        renderer: 'exact' as const,
        workspace: 'exact' as const,
        allExact: true as const,
    }),
    rollback: Object.freeze({kind: 'clear' as const}),
}) satisfies ApplicationBuildStatus;

const BINDING = Object.freeze({
    safetyCopy: SAFETY_COPY,
    currentData: Object.freeze({
        workspaceId: SAFETY_COPY.workspaceId,
        schemaLevel: '16',
        revision: '12',
    }),
    currentLibrary: Object.freeze({kind: 'absent' as const}),
    sourceBuild: Object.freeze({
        releaseVersion: '2.0.0-development',
        tag: 'development-source',
        appBuildId: BUILD_STATUS.descriptor.appBuildId,
    }),
    targetBuild: TARGET,
    impact: Object.freeze({
        replacement: 'complete' as const,
        automaticMerge: false as const,
        currentRevision: '12',
        targetRevision: '7',
        structuredDataChanges: 'discarded-after-target-revision' as const,
        libraryFiles: 'remain-in-place' as const,
        libraryReconciliation: 'full' as const,
    }),
});

function session(
    currentBuild: 'source' | 'target' | 'other',
    phase: 'previewed' | 'planned' | 'prepared' | 'armed' | 'awaiting-target-build'
        | 'completing' | 'cancelling' = 'awaiting-target-build',
): MigrationRollbackSessionView {
    const previewed = phase === 'previewed';
    const allowedActions = previewed
        ? Object.freeze(['confirm'] as const)
        : currentBuild === 'source' && phase !== 'completing'
            ? Object.freeze(['cancel-as-source'] as const)
            : currentBuild === 'target'
                && (phase === 'armed'
                    || phase === 'awaiting-target-build'
                    || phase === 'completing')
                ? Object.freeze(['continue-as-target'] as const)
                : Object.freeze([] as const);
    return Object.freeze({
        migrationRollbackSessionId: '33333333-3333-4333-8333-333333333333',
        operationId: '44444444-4444-4444-8444-444444444444',
        sessionVersion: previewed ? '0' : '4',
        phase,
        currentBuild,
        binding: BINDING,
        previewToken: previewed ? 'e'.repeat(64) : null,
        retryCommand: null,
        allowedActions,
        outcome: null,
        problem: null,
    });
}

test('UI-DATA-01 separates a verified migration safety copy from backups', () => {
    const html = renderToStaticMarkup(createElement(MigrationProtectionDialog, {
        buildStatus: BUILD_STATUS,
        busy: false,
        mode: 'overview',
        onClose: noop,
        onConfirmDelete: noop,
        onConfirmRollback: noop,
        onModeChange: noop,
        onPreviewRollback: noop,
        open: true,
        problem: null,
        rollbackPreview: null,
        safetyCopy: SAFETY_COPY,
    }));

    assert.match(html, /<dialog[^>]*aria-labelledby="migration-dialog-title"/);
    assert.match(html, /迁移安全副本/);
    assert.match(html, /已验证/);
    assert.match(html, /<dt>源 schema<\/dt><dd>15<\/dd>/);
    assert.match(html, /<dt>源修订<\/dt><dd>7<\/dd>/);
    assert.match(html, /4 KB/);
    assert.match(html, /1\.4\.2/);
    assert.match(html, /v1\.4\.2/);
    assert.match(html, />删除迁移安全副本</);
    assert.match(html, />预览精确版本回退</);
    assert.doesNotMatch(html, /BackupSet|RestoreSafetySet/);
});

test('destructive delete and rollback confirmation default focus to a safe action', () => {
    const deleteHtml = renderToStaticMarkup(createElement(MigrationProtectionDialog, {
        buildStatus: BUILD_STATUS,
        busy: false,
        mode: 'delete-confirm',
        onClose: noop,
        onConfirmDelete: noop,
        onConfirmRollback: noop,
        onModeChange: noop,
        onPreviewRollback: noop,
        open: true,
        problem: null,
        rollbackPreview: null,
        safetyCopy: SAFETY_COPY,
    }));
    assert.match(deleteHtml, /将失去本次迁移的应用版本回退能力/);
    assert.match(deleteHtml, /autofocus=""[^>]*>保留副本</);

    const rollbackHtml = renderToStaticMarkup(createElement(MigrationProtectionDialog, {
        buildStatus: BUILD_STATUS,
        busy: false,
        mode: 'rollback-preview',
        onClose: noop,
        onConfirmDelete: noop,
        onConfirmRollback: noop,
        onModeChange: noop,
        onPreviewRollback: noop,
        open: true,
        problem: null,
        rollbackPreview: session('source', 'previewed'),
        safetyCopy: SAFETY_COPY,
    }));
    assert.match(rollbackHtml, /迁移后新增或修改的结构化数据不会保留，也不会自动合并/);
    assert.match(rollbackHtml, /真实资料库文件保持原位/);
    assert.match(rollbackHtml, /重新扫描并按磁盘事实对账/);
    assert.match(rollbackHtml, /CourseFlow-1\.4\.2-Windows-x64\.msi/);
    assert.match(rollbackHtml, new RegExp('d{64}'));
    assert.match(rollbackHtml, /autofocus=""[^>]*>返回</);
    assert.doesNotMatch(rollbackHtml, /DataSlot|journal|sequence|canonicalPath|directoryPath/);
    assert.doesNotMatch(rollbackHtml, /<a\b|href=|>下载(?:<|到)/);
});

test('TEST-SHELL-005 renders exact source, target, other, and recovery actions', () => {
    const sourceHtml = renderToStaticMarkup(createElement(MigrationMaintenanceSurface, {
        buildStatus: BUILD_STATUS,
        busy: false,
        onCancel: noop,
        onContinue: noop,
        onRetry: noop,
        problem: null,
        session: session('source'),
    }));
    assert.match(sourceHtml, /tabindex="-1"[^>]*>等待目标版本/);
    assert.match(sourceHtml, /aria-live="polite"/);
    assert.match(sourceHtml, />取消回退并恢复当前数据</);
    assert.doesNotMatch(sourceHtml, />继续回退</);
    assert.match(sourceHtml, /卸载当前 MSI 后安装指定 MSI/);

    const targetHtml = renderToStaticMarkup(createElement(MigrationMaintenanceSurface, {
        buildStatus: {...BUILD_STATUS, descriptor: {
            ...BUILD_STATUS.descriptor,
            platform: 'darwin',
            architecture: 'arm64',
        }},
        busy: false,
        onCancel: noop,
        onContinue: noop,
        onRetry: noop,
        problem: null,
        session: session('target'),
    }));
    assert.match(targetHtml, /准备完成回退/);
    assert.match(targetHtml, />继续回退</);
    assert.doesNotMatch(targetHtml, />取消回退并恢复当前数据</);
    assert.match(targetHtml, /\/Applications/);

    const otherHtml = renderToStaticMarkup(createElement(MigrationMaintenanceSurface, {
        buildStatus: BUILD_STATUS,
        busy: false,
        onCancel: noop,
        onContinue: noop,
        onRetry: noop,
        problem: null,
        session: session('other'),
    }));
    assert.match(otherHtml, /当前应用版本不匹配/);
    assert.match(otherHtml, /development-source/);
    assert.match(otherHtml, new RegExp(BUILD_STATUS.descriptor.appBuildId));
    assert.doesNotMatch(otherHtml, /<button[^>]*>继续回退</);
    assert.doesNotMatch(otherHtml, /<button[^>]*>取消回退/);

    const recoveryHtml = renderToStaticMarkup(createElement(MigrationMaintenanceSurface, {
        buildStatus: BUILD_STATUS,
        busy: false,
        onCancel: noop,
        onContinue: noop,
        onRetry: noop,
        problem: null,
        session: {
            migrationRollbackSessionId: null,
            operationId: null,
            sessionVersion: null,
            phase: 'recovery-required',
            currentBuild: 'recovery-required',
            binding: null,
            previewToken: null,
            retryCommand: null,
            allowedActions: [],
            outcome: null,
            problem: {code: 'recovery-required'},
        },
    }));
    assert.match(recoveryHtml, /需要恢复/);
    assert.match(recoveryHtml, /role="alert"/);
    assert.doesNotMatch(recoveryHtml, /<button[^>]*>继续回退|<button[^>]*>取消回退/);

    const unknownPlatformHtml = renderToStaticMarkup(createElement(MigrationMaintenanceSurface, {
        buildStatus: null,
        busy: false,
        onCancel: noop,
        onContinue: noop,
        onRetry: noop,
        problem: '当前构建状态不可用。',
        session: session('other'),
    }));
    assert.match(unknownPlatformHtml, /Windows/);
    assert.match(unknownPlatformHtml, /macOS/);
    assert.match(unknownPlatformHtml, /CourseFlow-1\.4\.2-macOS-arm64\.dmg/);
    assert.match(unknownPlatformHtml, /CourseFlow-1\.4\.2-Windows-x64\.msi/);
    assert.match(unknownPlatformHtml, new RegExp('c{64}'));
    assert.match(unknownPlatformHtml, new RegExp('d{64}'));
});
