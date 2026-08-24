/**
 * @file Verifies the bounded setup UI and its Renderer-only routing decisions.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { setupStateFrom } from '../../src/renderer/setup-state';
import { BOOTSTRAP_PROTOCOL_VERSION } from '../../src/shared/bootstrap-contract';
import type { WorkspaceSetupOutcome } from '../../src/shared/workspace-setup-contract';

const repositoryRoot = process.cwd();
const renderer = readFileSync(path.join(repositoryRoot, 'src/renderer/main.tsx'), 'utf8');
const styles = readFileSync(path.join(repositoryRoot, 'src/renderer/styles.css'), 'utf8');
const termSetup = renderer.slice(
    renderer.indexOf('function SetupTerm'),
    renderer.indexOf('function SetupCourse'),
);
const courseSetup = renderer.slice(
    renderer.indexOf('function SetupCourse'),
    renderer.indexOf('function SetupComplete'),
);

test('UI-SETUP-01 exposes the bounded Current Term then Course and first Meeting flow', () => {
    assert.match(renderer, /当前学期/);
    assert.match(renderer, /学期名称/);
    assert.match(renderer, /开始日期/);
    assert.match(renderer, /结束日期/);
    assert.match(renderer, /默认时区/);
    assert.match(renderer, /创建并继续/);
    assert.match(renderer, /courseFlow\.initialize/);
    assert.match(renderer, /courseFlow\.querySetup/);
    assert.match(renderer, /courseFlow\.createTerm/);
    assert.match(renderer, /课程代码/);
    assert.match(renderer, /课程名称/);
    assert.match(renderer, /节号（可选）/);
    assert.match(renderer, /授课教师（可选）/);
    assert.match(renderer, /颜色（可选）/);
    assert.match(renderer, /学分（可选）/);
    assert.match(renderer, /课节类型/);
    assert.match(renderer, /LEC — Lecture/);
    assert.match(renderer, /TUT — Tutorial/);
    assert.match(renderer, /PRA — Practical/);
    assert.match(renderer, /星期/);
    assert.match(renderer, /开始时间/);
    assert.match(renderer, /结束时间/);
    assert.match(renderer, /生效开始日期/);
    assert.match(renderer, /生效结束日期/);
    assert.match(renderer, /地点/);
    assert.match(renderer, /待定/);
    assert.match(renderer, /保存课程与课节/);
    assert.match(renderer, /courseFlow\.createCourseWithMeeting/);
    assert.doesNotMatch(termSetup, /overlapDecision/);
    assert.match(courseSetup, /overlapDecision:\s*'review'/);
    assert.match(courseSetup, /overlapDecision:\s*'continue'/);
    assert.match(renderer, /学期身份/);
    assert.match(renderer, /课程身份/);
    assert.match(renderer, /课节身份/);
    assert.match(renderer, /生效日期/);
    assert.doesNotMatch(renderer, /课节教师|新增课节|拆分规则|Today|成绩|资料库|备份/);
});

test('UI-SETUP-01 keeps the confirmed light surface and keyboard/reduced-motion affordances', () => {
    assert.match(styles, /color-scheme:\s*light/);
    assert.match(styles, /:focus-visible/);
    assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)/);
    assert.match(styles, /\.setup-layout/);
    assert.match(styles, /\.setup-progress/);
    assert.match(styles, /\.setup-form/);
});

test('UI-SETUP-01 reports completion only from writable DATA', () => {
    const projection = {
        workspaceRevision: '2',
        planEntityVersion: '2',
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
        courses: [{
            courseId: '22222222-2222-4222-8222-222222222222',
            termId: '11111111-1111-4111-8111-111111111111',
            code: 'CSC108',
            name: 'Introduction to Computer Programming',
            section: null,
            instructor: null,
            color: null,
            credits: null,
            teachingRange: {
                kind: 'inherit-term',
                startDate: '2026-09-08',
                endDate: '2026-12-18',
            },
            archived: false,
            entityVersion: '1',
            meetings: [{
                meetingSeriesId: '33333333-3333-4333-8333-333333333333',
                type: { code: 'LEC', name: 'Lecture' },
                weekday: 'MON',
                localStart: '09:00',
                localEnd: '10:00',
                endDayOffset: 0,
                effectiveRange: {
                    kind: 'inherit-course',
                    startDate: '2026-09-08',
                    endDate: '2026-12-18',
                },
                location: { kind: 'tba' },
                entityVersion: '1',
            }],
        }],
    } as const;

    /** Builds the same successful setup outcome under each supported DATA mode. */
    const outcome = (dataMode: 'ready' | 'read-only'): WorkspaceSetupOutcome => ({
        ok: true,
        value: {
            kind: 'workspace.setup-projection',
            protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
            appBuildId: 'test-build',
            requestId: 'setup-query',
            workspaceEpoch: 'workspace-epoch',
            dataMode,
            projection,
        },
    });

    assert.equal(setupStateFrom(outcome('ready')).kind, 'complete');
    const readOnlyState = setupStateFrom(outcome('read-only'));
    assert.equal(readOnlyState.kind, 'problem');
    if (readOnlyState.kind !== 'problem') {
        throw new Error('Expected read-only DATA to remain outside the completion state');
    }
    assert.match(readOnlyState.message, /只读/);
});
